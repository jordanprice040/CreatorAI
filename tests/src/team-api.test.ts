import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import {
  CapabilityCheckResultSchema,
  GateRuleSchema,
  TeamProfileSchema,
  z,
} from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0090 over HTTP: a built-in check runs only its fixed program, records a pass as a new
// profile version, and changes nothing on a failure.

async function start(
  t: test.TestContext,
  env: Record<string, string>,
  runner: (
    file: string,
    args: readonly string[],
  ) => Promise<{
    exit_code: number | null;
    output: string;
  }>,
) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const api = createApi(
    {
      CREATOR_DATABASE_URL: db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
      CREATOR_WORKER: 'off',
      ...env,
    },
    { capabilityRunner: runner },
  );
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const post = (path: string, body: unknown) =>
    fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
  const get = (path: string) =>
    fetch(`${base}/${path}`, { headers: auth.read });
  const ws = z.object({ id: z.string() }).parse(
    await (
      await post('workspaces', {
        name: 'Team checks',
        record_mode: 'fixture',
      })
    ).json(),
  );
  return { post, get, root: `workspaces/${ws.id}` };
}

test('a built-in check runs its fixed program and saves only a pass', async (t) => {
  const calls: string[][] = [];
  const s = await start(t, {}, async (file, args) => {
    calls.push([file, ...args]);
    return file === 'java'
      ? { exit_code: 0, output: 'openjdk version "21.0.2" 2024-01-16' }
      : { exit_code: 1, output: '' };
  });
  if (!s) return;
  const p0 = TeamProfileSchema.parse(
    await (await s.get(`${s.root}/team-profile`)).json(),
  );
  assert.equal(p0.version, 0);
  const failed = CapabilityCheckResultSchema.parse(
    await (
      await s.post(`${s.root}/team-profile/checks`, {
        expected_version: 0,
        capability: 'docker',
      })
    ).json(),
  );
  assert.equal(failed.passed, false);
  assert.equal(failed.profile.version, 0);
  assert.deepEqual(calls, [['docker', '--version']]);
  const passed = CapabilityCheckResultSchema.parse(
    await (
      await s.post(`${s.root}/team-profile/checks`, {
        expected_version: 0,
        capability: 'java',
      })
    ).json(),
  );
  assert.equal(passed.passed, true);
  assert.equal(passed.profile.version, 1);
  const java = passed.profile.profile.capabilities[0]!;
  assert.equal(java.basis, 'check');
  assert.equal(java.check?.detail, 'Java 21.0.2');
  assert.equal(java.check?.command, 'java -version');
  // A capability without a built-in check is answered by hand only.
  const none = CapabilityCheckResultSchema.parse(
    await (
      await s.post(`${s.root}/team-profile/checks`, {
        expected_version: 1,
        capability: 'installs_allowed',
      })
    ).json(),
  );
  assert.equal(none.passed, false);
  assert.match(none.detail, /no built-in check/);
  // An unknown capability is refused before anything runs.
  const bad = await s.post(`${s.root}/team-profile/checks`, {
    expected_version: 1,
    capability: 'rm -rf /',
  });
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 2);
  const rule = GateRuleSchema.parse(
    await (await s.get(`${s.root}/gate-rule`)).json(),
  );
  assert.equal(rule.auto_clear, false);
});
