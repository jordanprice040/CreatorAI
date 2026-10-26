import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test(
  'DPAPI saves and restores sign-in with the installed studio minimal PATH',
  {
    skip: process.platform !== 'win32',
  },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), 'creator-plan-vault-'));
    try {
      const moduleUrl = new URL(
        '../../packages/broker/dist/plan-vault.js',
        import.meta.url,
      ).href;
      const script = `import { DpapiVault } from ${JSON.stringify(moduleUrl)};
      const vault = new DpapiVault(${JSON.stringify(dir)});
      const ref = 'chatgpt-plan/10000000-0000-4000-8000-000000000001';
      const fixture = { access_token: 'synthetic-test-only' };
      await vault.put(ref, fixture);
      if ((await vault.get(ref))?.access_token !== fixture.access_token) throw new Error('Saved sign-in did not round trip');
      await vault.delete(ref);
      if (await vault.get(ref) !== null) throw new Error('Sign-out did not remove the sign-in');
      console.log('round-trip verified');`;
      const system = process.env.SystemRoot ?? 'C:\\Windows';
      const result = await promisify(execFile)(
        process.execPath,
        ['--input-type=module', '-e', script],
        {
          env: {
            SystemRoot: system,
            PATH: `${system}\\System32;${system}`,
            TEMP: tmpdir(),
            TMP: tmpdir(),
          },
          windowsHide: true,
        },
      );
      assert.match(result.stdout, /round-trip verified/);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
);
