import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { canonicalHash } from '../packages/domain/dist/index.js';

// Run only against the disposable local fixture API; never recruits or calls a live adapter.
const dir = '.verification/t10-cli';
mkdirSync(dir, { recursive: true });
const env = {
  ...process.env,
  CREATOR_SESSION_FILE: `${dir}/session.json`,
};
if (!env.CREATOR_API_URL || !env.CREATOR_DEV_LOGIN_CODE)
  throw new Error(
    'Set CREATOR_API_URL and the disposable CREATOR_DEV_LOGIN_CODE.',
  );
const cli = (...args) =>
  JSON.parse(
    execFileSync(process.execPath, ['apps/cli/dist/main.js', ...args], {
      env,
      encoding: 'utf8',
    }),
  );
const file = (name, body) => {
  const path = `${dir}/${name}.json`;
  writeFileSync(path, JSON.stringify(body));
  return path;
};
cli('login', env.CREATOR_DEV_LOGIN_CODE);
const ws = cli('workspace-create', 'Synthetic T10 CLI acceptance', 'fixture');
const seeded = cli('study-seed', ws.id);
assert.equal(seeded.attempts.length, 3);
const attempt = (condition) =>
  seeded.attempts.find((a) => a.condition === condition);
const a = attempt('autonomous'),
  b = attempt('human_in_loop'),
  c = attempt('human_only');
const write = (id, action, body) =>
  cli('study-write', ws.id, id, action, file(`${id}-${action}`, body));
write(a.id, 'finish', {
  status: 'needs_human',
  summary: 'Synthetic stakeholder judgment stop.',
  human_active_minutes: 0,
  human_wait_seconds: 0,
});
const continuation = cli(
  'study-assign',
  ws.id,
  seeded.study.id,
  file('continuation', {
    manifest_hash: a.manifest_hash,
    participant_actor_id: a.participant_actor_id,
    participant_code: 'synthetic-owner',
    prior_familiarity: 'Linked synthetic continuation.',
    condition: 'human_in_loop',
    discovery_method: 'structured',
    continuation_of: a.id,
  }),
);
assert.equal(continuation.primary, false);
write(b.id, 'interventions', {
  type: 'judgment',
  gate: 'dynamic',
  reason: 'Synthetic choice needed',
  trigger: 'conflicting options',
  stage: 'selection',
  data_shown: 'Frozen packet',
  human_input: 'Prefer a shared checklist',
  resulting_change: 'Record a validation plan',
  prevented_problem: 'unknown',
  human_active_minutes: 2,
  wait_seconds: 3,
});
cli('study-execute', ws.id, b.id);
const artifact = write(c.id, 'artifacts', {
  kind: 'document',
  name: 'Synthetic human entry',
  content: 'Use a shared checklist and measure missed handoffs.',
});
const check = write(c.id, 'tests', {
  artifact_id: artifact.id,
  artifact_hash: artifact.content_hash,
  check: 'contains',
  expected: 'checklist',
});
assert.equal(check.passed, true);
const denied = write(c.id, 'helpers', { helper: 'model.summarize' });
assert.equal(denied.allowed, false);
write(c.id, 'finish', {
  status: 'submitted',
  summary:
    'Synthetic manually entered document; not independent human research.',
  human_active_minutes: 4,
  human_wait_seconds: 0,
});
const baseline = cli(
  'study-assign',
  ws.id,
  seeded.study.id,
  file('baseline', {
    manifest_hash: a.manifest_hash,
    participant_actor_id: a.participant_actor_id,
    participant_code: 'synthetic-owner',
    prior_familiarity: 'Synthetic secondary comparison.',
    condition: 'autonomous',
    comparison: 'discovery',
    discovery_method: 'open_ended',
    continuation_of: null,
  }),
);
assert.equal(cli('study-execute', ws.id, baseline.id).status, 'succeeded');
for (let n = 0; n < 30; n++) {
  if (
    cli('study', ws.id, seeded.study.id).attempts.find((x) => x.id === b.id)
      .state !== 'assigned'
  )
    break;
  await new Promise((resolve) => setTimeout(resolve, 200));
}
const exportPath = `${dir}/export-${seeded.study.id}.json`;
cli('study-export', ws.id, seeded.study.id, exportPath);
const exported = JSON.parse(readFileSync(exportPath, 'utf8'));
const { export_hash, ...body } = exported;
assert.equal(
  canonicalHash(body),
  export_hash,
  'Export hash verifies after JSON serialization.',
);
assert.equal(exported.attempts.find((x) => x.id === a.id).state, 'needs_human');
assert.equal(
  exported.attempts.find((x) => x.id === c.id).measurements.calls,
  0,
);
assert.equal(exported.attempts.find((x) => x.id === b.id).state, 'failed');
assert.equal(exported.empirical_results, false);
writeFileSync(
  'tracking/evidence/t10/cli-acceptance.json',
  JSON.stringify(
    {
      synthetic: true,
      checks:
        'compiled CLI → authenticated HTTP → PostgreSQL: seeded three arms; A needs_human; linked continuation; B intervention and structured insufficient-evidence stop; C verbatim artifact and executed check, helper denial; separate open-ended baseline; serialized export hash verified',
      workspace_id: ws.id,
      study_id: seeded.study.id,
      export_hash,
      attempts: exported.attempts.map((x) => ({
        id: x.id,
        condition: x.condition,
        comparison: x.comparison,
        state: x.state,
        primary: x.primary,
        measurements: x.measurements,
      })),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify(
    {
      passed: true,
      synthetic: true,
      workspace_id: ws.id,
      study_id: seeded.study.id,
      exportPath,
    },
    null,
    2,
  ),
);
