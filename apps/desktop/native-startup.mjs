import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createApi } from '../api/dist/index.js';

// A disposable stateless fixture API and built UI. No personal browser, DB or paid adapter.
const root = resolve(fileURLToPath(new URL('../..', import.meta.url)));
const api = createApi({ CREATOR_WORKER: 'off' });
let web;
let native;
// A throwaway studio home: the probe never touches the installed app's WebView2 data.
const home = await mkdtemp(join(tmpdir(), 'creator-probe-'));
try {
  api.server.listen(4310, '127.0.0.1');
  await once(api.server, 'listening');
  web = spawn(
    process.execPath,
    [
      resolve(root, 'node_modules/vite/bin/vite.js'),
      'preview',
      '--host',
      '127.0.0.1',
      '--port',
      '5173',
      '--strictPort',
    ],
    {
      cwd: resolve(root, 'apps/web'),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let diagnostics = '';
  web.stderr.on('data', (b) => {
    diagnostics = (diagnostics + b.toString()).slice(-4000);
  });
  let ready = false;
  for (let i = 0; i < 50; i++) {
    if (web.exitCode !== null)
      throw new Error(`Web preview failed: ${diagnostics}`);
    try {
      const r = await fetch('http://127.0.0.1:5173/', {
        signal: AbortSignal.timeout(500),
      });
      if (r.ok && (await r.text()).includes('id="root"')) {
        ready = true;
        break;
      }
    } catch {}
    await sleep(100);
  }
  assert.ok(ready, 'Built UI must be served before launching native probe');
  native = spawn(
    resolve(
      process.env.CREATOR_NATIVE_EXECUTABLE ??
        resolve(
          root,
          'apps/desktop/src-tauri/target/debug/creator-desktop.exe',
        ),
    ),
    ['--startup-probe'],
    {
      cwd: root,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CREATOR_STUDIO_HOME: home },
    },
  );
  let output = '';
  let errors = '';
  native.stdout.on('data', (b) => {
    output += b.toString();
  });
  native.stderr.on('data', (b) => {
    errors = (errors + b.toString()).slice(-4000);
  });
  const timer = setTimeout(() => native.kill(), 30000);
  const [code] = await once(native, 'close');
  clearTimeout(timer);
  assert.equal(code, 0, `Native startup failed: ${errors}`);
  assert.match(
    output,
    /NATIVE_WEBVIEW_NAVIGATION_FINISHED http:\/\/127\.0\.0\.1:5173\//,
  );
  assert.equal((await fetch('http://127.0.0.1:4310/api/health')).status, 200);
  console.log(
    JSON.stringify(
      {
        at: new Date().toISOString(),
        platform: process.platform,
        state: 'native_navigation_observed',
        native: output.trim(),
        fixture: true,
        limitations: [
          'Navigation completion is not rendered-UI, sign-in, download, pairing or launch acceptance.',
          'Window close leaves separately running API and workers alive.',
        ],
      },
      null,
      2,
    ),
  );
} finally {
  native?.kill();
  web?.kill();
  await api.close();
  await rm(home, { recursive: true, force: true, maxRetries: 5 });
}
