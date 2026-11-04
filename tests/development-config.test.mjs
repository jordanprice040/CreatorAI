import test from 'node:test';
import assert from 'node:assert/strict';
import { supportedNode, requireSupportedNode } from '../scripts/runtime.mjs';
import { inferenceNotice } from '../scripts/dev-status.mjs';
import { createApi } from '../apps/api/dist/index.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';

test('runtime floor rejects unpatched and unsupported majors before packaging', () => {
  for (const v of [
    '22.21.0',
    '22.23.3',
    '24.19.0',
    '24.22.1',
    '23.99.0',
    '26.0.0',
    '22.23.4-rc.1',
  ]) {
    assert.equal(supportedNode(v), false, v);
    assert.throws(() => requireSupportedNode(v), /unsupported/);
  }
  for (const v of ['22.23.4', 'v22.24.0', '24.22.2', '24.23.0'])
    assert.equal(supportedNode(v), true, v);
});

test('startup notice describes the actual factory configuration and never discloses its key', async (t) => {
  for (const live of [false, true]) {
    const api = createApi(
      live
        ? {
            CREATOR_LIVE_PROVIDER: 'openai',
            OPENAI_API_KEY: 'synthetic-key-never-sent',
          }
        : {},
    );
    t.after(() => api.close());
    const notice = inferenceNotice(api.inference);
    assert.equal(api.inference.api_model !== null, live);
    assert.match(
      notice,
      live
        ? /API adapter openai\/.+ configured \(unverified\)/
        : /no live API adapter configured/,
    );
    assert.match(notice, /Fixture workspaces use synthetic responses/);
    assert.match(notice, /Real calls require/);
    assert.ok(!notice.includes('synthetic-key'));
    assert.ok(!notice.includes('no real AI'));
  }
  assert.match(
    inferenceNotice({ api_model: null, plan_connections: true }),
    /plan connections available when configured/,
  );
});

test('the compiled API startup reports a configured adapter without promising no live calls', async (t) => {
  const freePort = async () => {
    const server = createServer();
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const port = server.address().port;
    await new Promise((r) => server.close(r));
    return port;
  };
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    windowsHide: true,
    env: {
      SystemRoot: process.env.SystemRoot,
      PATH: process.env.PATH,
      CREATOR_API_PORT: String(await freePort()),
      CREATOR_PREVIEW_PORT: String(await freePort()),
      CREATOR_LIVE_PROVIDER: 'openai',
      OPENAI_API_KEY: 'synthetic-startup-key-never-sent',
      CREATOR_DEV_LOGIN_CODE: 'synthetic-startup-login-code-only',
      CREATOR_WORKER: 'off',
    },
  });
  const exited = once(child, 'exit');
  t.after(async () => {
    child.kill();
    await exited;
  });
  let stdout = '';
  child.stdout.on('data', (b) => {
    stdout += b;
  });
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(Error('API startup message not observed')),
      10000,
    );
    child.stdout.on('data', () => {
      if (stdout.includes('Calls require')) {
        clearTimeout(timeout);
        resolve();
      }
    });
    child.once('error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
  });
  assert.match(stdout, /API adapter openai\/.+ configured, unverified/);
  assert.ok(!stdout.includes('no live calls'));
  assert.ok(!stdout.includes('synthetic-startup-key'));
});
