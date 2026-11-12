import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import {
  CapabilityCheckResultSchema,
  GateChecklistSchema,
  GateRuleSchema,
  STARTER_GATE_CHECKLIST,
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
    if (file === 'git') return { exit_code: 0, output: 'git version 2.43.0' };
    return file === 'java'
      ? { exit_code: 0, output: 'openjdk version "21.0.2" 2024-01-16' }
      : { exit_code: 1, output: '' };
  });
  if (!s) return;
  const p0 = TeamProfileSchema.parse(
    await (await s.get(`${s.root}/team-profile`)).json(),
  );
  assert.equal(p0.version, 0);
  // The owner sees where checks run (a local studio).
  assert.equal(p0.checks_available, true);
  assert.ok(p0.machine);
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
  // Docker asks the engine, so a stopped engine does not pass.
  assert.deepEqual(calls, [
    ['docker', 'version', '--format', '{{.Server.Version}}'],
  ]);
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
  assert.equal(passed.saved, true);
  // Checking again and finding the same thing saves nothing, so assessments stay current.
  const again = CapabilityCheckResultSchema.parse(
    await (
      await s.post(`${s.root}/team-profile/checks`, {
        expected_version: 1,
        capability: 'java',
      })
    ).json(),
  );
  assert.equal(again.passed, true);
  assert.equal(again.saved, false);
  assert.equal(again.profile.version, 1);
  assert.match(again.detail, /Still found Java 21\.0\.2; nothing changed/);
  // A check never overrules the owner's declared No.
  const declared = TeamProfileSchema.parse(
    await (
      await s.post(`${s.root}/team-profile`, {
        expected_version: 1,
        capabilities: [
          { key: 'java', status: 'yes' },
          { key: 'git', status: 'no', note: 'Policy: no Git on lab PCs' },
        ],
        notes: '',
      })
    ).json(),
  );
  assert.equal(declared.version, 2);
  const git = CapabilityCheckResultSchema.parse(
    await (
      await s.post(`${s.root}/team-profile/checks`, {
        expected_version: 2,
        capability: 'git',
      })
    ).json(),
  );
  assert.equal(git.passed, true);
  assert.equal(git.saved, false);
  assert.match(git.detail, /you set this to No, so it stays No/);
  assert.equal(
    git.profile.profile.capabilities.find((c) => c.key === 'git')?.status,
    'no',
  );
  // A capability without a built-in check is answered by hand only.
  const none = CapabilityCheckResultSchema.parse(
    await (
      await s.post(`${s.root}/team-profile/checks`, {
        expected_version: 2,
        capability: 'installs_allowed',
      })
    ).json(),
  );
  assert.equal(none.passed, false);
  assert.match(none.detail, /no built-in check/);
  // An unknown capability is refused before anything runs.
  const bad = await s.post(`${s.root}/team-profile/checks`, {
    expected_version: 2,
    capability: 'rm -rf /',
  });
  assert.equal(bad.status, 400);
  assert.equal(calls.length, 4);
  const rule = GateRuleSchema.parse(
    await (await s.get(`${s.root}/gate-rule`)).json(),
  );
  assert.equal(rule.mode, 'owner');
});

test('ADR-0097: the gate checklist is read and saved over HTTP, and the checklist rule needs one', async (t) => {
  const s = await start(t, {}, async () => ({ exit_code: 1, output: '' }));
  if (!s) return;
  const l0 = GateChecklistSchema.parse(
    await (await s.get(`${s.root}/gate-checklist`)).json(),
  );
  assert.deepEqual([l0.version, l0.items.length, l0.can_edit], [0, 0, true]);
  const refused = await s.post(`${s.root}/gate-rule`, {
    expected_version: 0,
    mode: 'checklist',
  });
  assert.equal(refused.status, 400);
  const tooMany = await s.post(`${s.root}/gate-checklist`, {
    expected_version: 0,
    items: Array.from({ length: 13 }, (_, i) => ({
      gate: 'ethics',
      text: `Item number ${i + 1}`,
    })),
  });
  assert.equal(tooMany.status, 400);
  const saved = GateChecklistSchema.parse(
    await (
      await s.post(`${s.root}/gate-checklist`, {
        expected_version: 0,
        items: STARTER_GATE_CHECKLIST,
      })
    ).json(),
  );
  assert.equal(saved.version, 1);
  assert.equal(saved.items[3]?.ref, 'K4');
  const rule = GateRuleSchema.parse(
    await (
      await s.post(`${s.root}/gate-rule`, {
        expected_version: 0,
        mode: 'checklist',
      })
    ).json(),
  );
  assert.equal(rule.mode, 'checklist');
});
