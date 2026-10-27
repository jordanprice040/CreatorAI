import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '../api/dist/index.js';
import { migrate } from '../../packages/db/dist/index.js';

const require = createRequire(
  new URL('../../packages/db/package.json', import.meta.url),
);
const pg = require('pg');
const adminUrl = process.env.CREATOR_TEST_DATABASE_URL;
if (!adminUrl) throw new Error('Set a disposable CREATOR_TEST_DATABASE_URL');
const address = new URL(adminUrl);
assert.equal(
  address.hostname,
  '127.0.0.1',
  'Acceptance harness uses a loopback test cluster only',
);
const admin = new pg.Pool({ connectionString: adminUrl, max: 1 });
const name = `creator_signin_${randomBytes(6).toString('hex')}`;
let pool;
let api;
let web;
let native;
// A throwaway studio home: the probe never touches the installed app's WebView2 data.
const home = await mkdtemp(join(tmpdir(), 'creator-probe-'));

// Removes the throwaway home once the probe has exited. Its WebView2 helper processes can
// hold the profile a little longer, so busy files are retried (linear backoff, about 11 s).
async function removeHome() {
  if (native && native.exitCode === null && native.signalCode === null) {
    native.kill();
    await once(native, 'close');
  }
  await rm(home, {
    recursive: true,
    force: true,
    maxRetries: 10,
    retryDelay: 200,
  }).catch((e) =>
    console.error(`Throwaway home left at ${home}: ${e.message}`),
  );
}
const secure = process.env.CREATOR_TEST_NATIVE_SECURE === '1';
const code = 'test-login-code-0123456789abcdefghij';
try {
  await admin.query(`create database ${name}`);
  address.pathname = `/${name}`;
  pool = new pg.Pool({ connectionString: address.href, max: 1 });
  await migrate(pool);
  api = createApi({
    CREATOR_DATABASE_URL: address.href,
    CREATOR_DEV_LOGIN_CODE: code,
    CREATOR_COOKIE_SECURE: secure ? 'true' : 'false',
    CREATOR_WORKER: 'off',
  });
  api.server.listen(4310, '127.0.0.1');
  await once(api.server, 'listening');
  await api.ready();
  await api.store.createWorkspace(
    { actorId: DEFAULT_OWNER_ACTOR_ID },
    { name: 'Native sign-in acceptance fixture', record_mode: 'fixture' },
  );
  web = spawn(
    process.execPath,
    [
      resolve('node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
      '--strictPort',
    ],
    { cwd: resolve('apps/web'), windowsHide: true, stdio: 'ignore' },
  );
  let ready = false;
  for (let i = 0; i < 100; i++) {
    if (web.exitCode !== null) throw new Error('Fixture web preview failed');
    try {
      ready = (
        await fetch('http://127.0.0.1:5173/', {
          signal: AbortSignal.timeout(500),
        })
      ).ok;
      if (ready) break;
    } catch {}
    await sleep(100);
  }
  assert.ok(ready);
  console.log(
    `Fixture browser sign-in code: ${code}. Secure cookie test: ${secure}.`,
  );
  native = spawn(
    resolve('apps/desktop/src-tauri/target/debug/creator-desktop.exe'),
    ['--signin-probe'],
    {
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CREATOR_STUDIO_HOME: home },
    },
  );
  let output = '';
  let errors = '';
  native.stdout.on('data', (b) => {
    output += b.toString();
    process.stdout.write(b);
  });
  native.stderr.on('data', (b) => {
    errors = (errors + b.toString()).slice(-4000);
  });
  const timer = setTimeout(() => native.kill(), 270000);
  const [exitCode] = await once(native, 'close');
  clearTimeout(timer);
  assert.equal(exitCode, 0, errors);
  assert.ok(
    output.includes(`NATIVE_SIGNIN_AUTHENTICATED ${DEFAULT_OWNER_ACTOR_ID}`),
    output,
  );
  const devices = await pool.query(
    `select d.id, d.session_hash, s.token_hash from desktop_devices d join auth_sessions s on s.token_hash=d.session_hash where d.kind='desktop_login'`,
  );
  assert.equal(devices.rows.length, 1);
  assert.ok(devices.rows[0].session_hash);
  const sessions = await pool.query(
    'select count(*)::int n from auth_sessions',
  );
  assert.equal(
    sessions.rows[0].n,
    2,
    'Browser and desktop must have different sessions',
  );
  const evidence = {
    at: new Date().toISOString(),
    state: 'native_browser_handoff_verified',
    secure_cookie: secure,
    platform: process.platform,
    browser: 'isolated Edge via development Playwright MCP',
    native_cookie_authenticated_fetch: true,
    separate_browser_and_desktop_sessions: true,
    fixture: true,
    limitations: [
      'Probe routes the approval URL to isolated Edge instead of invoking the personal default-browser handler.',
      'No live OIDC provider, installer, update or editor interaction acceptance.',
    ],
  };
  await writeFile(
    `tracking/evidence/x05/native-signin${secure ? '-secure' : ''}.json`,
    JSON.stringify(evidence, null, 2) + '\n',
  );
  console.log(JSON.stringify(evidence));
} finally {
  await removeHome();
  web?.kill();
  if (api) await api.close();
  if (pool) await pool.end();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
}
