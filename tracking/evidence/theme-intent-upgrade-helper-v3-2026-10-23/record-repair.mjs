import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ROOT,
  CANDIDATE,
  PLAN,
  read,
  hash,
  sha,
  save,
  bindings,
  inside,
} from '../../../scripts/theme-intent-upgrade-v3-core.mjs';
const dir = join(
  ROOT,
  'tracking/evidence/theme-intent-upgrade-helper-v3-2026-10-23',
);
const helper_sha256 = await bindings();
for (const [kind, total] of [
  ['guards', 8],
  ['e2e', 25],
]) {
  const run = await read(join(dir, 'first-' + kind + '-run.json'));
  assert.equal(run.exit_code, 0);
  assert.equal(run.timed_out, false);
  assert.equal(run.sources_unchanged, true);
  const tap = await readFile(join(dir, 'first-' + kind + '.tap'), 'utf8');
  assert.equal(sha(tap), run.tap_sha256);
  assert.match(tap, new RegExp(`# tests ${total}\\r?\\n`));
  assert.match(tap, new RegExp(`# pass ${total}\\r?\\n`));
  assert.match(tap, /# fail 0\r?\n/);
  assert.match(tap, /# skipped 0\r?\n/);
  for (const [p, h] of Object.entries(run.source_sha256))
    assert.equal(await hash(join(ROOT, p)), h, p);
  for (const [p, h] of Object.entries(helper_sha256))
    assert.equal(run.source_sha256[p], h, p);
}
const prior = await read(
  join(
    ROOT,
    'tracking/evidence/theme-intent-upgrade-helper-v2-2026-10-23/repair-receipt.json',
  ),
);
for (const [p, h] of Object.entries(prior.artifact_sha256))
  assert.equal(await hash(join(ROOT, p)), h, p);
const fixtureName = (await readdir(join(ROOT, '.verification')))
  .filter((p) => /^theme-helper-v3-\d+$/.test(p))
  .sort()
  .at(-1);
const fixture = join(ROOT, '.verification', fixtureName);
assert.ok(inside(join(ROOT, '.verification'), fixture));
const summary = await read(join(fixture, 'test-summary.json'));
assert.equal(summary.listening_after, false);
const artifact_sha256 = { ...helper_sha256 };
for (const p of [
  'scripts/run-theme-intent-v3-tests.mjs',
  'tests/theme-intent-upgrade-v3.test.mjs',
  'tests/theme-intent-upgrade-v3-guards.test.mjs',
  'tests/fixtures/theme-intent-v3-installer.ps1',
  'docs/THEME_INTENT_UPGRADE_HELPER_V3_2026-10-23.md',
  ...(await readdir(dir))
    .filter((p) => /\.(mjs|tap|txt|json)$/.test(p))
    .map(
      (p) => 'tracking/evidence/theme-intent-upgrade-helper-v3-2026-10-23/' + p,
    ),
])
  artifact_sha256[p] = await hash(join(ROOT, p));
await save(join(dir, 'test-observations.json'), {
  format: 'theme-intent-helper-v3-test-observations/1',
  ...summary,
  fixture_installer: true,
  nsis_executed: false,
  operational_access: false,
});
artifact_sha256[
  'tracking/evidence/theme-intent-upgrade-helper-v3-2026-10-23/test-observations.json'
] = await hash(join(dir, 'test-observations.json'));
await save(join(dir, 'repair-receipt.json'), {
  format: 'theme-intent-upgrade-helper-repair/3',
  status: 'locally_verified_independent_v3_review_required',
  recorded_at: new Date().toISOString(),
  candidate_plan_hash: CANDIDATE,
  installation_plan_hash: PLAN,
  helper_sha256,
  artifact_sha256,
  checks: {
    e2e: {
      passed: 25,
      failed: 0,
      skipped: 0,
      scenarios: 24,
      includes_parent: true,
      source_bound_run: 'first-e2e-run.json',
    },
    guards: {
      passed: 8,
      failed: 0,
      skipped: 0,
      source_bound_run: 'first-guards-run.json',
    },
    powershell_parse: 'passed',
    formatting_check: 'passed',
    static_preflight: 'passed',
    prior_v2_artifacts_preserved: Object.keys(prior.artifact_sha256).length,
  },
  findings: {
    v2_M1:
      'cleanup-only release without prepared data or credentials; startup/partial-before death tested',
    v2_M2:
      'after/reconcile can release stale state and verify forward without repeated effects or required rollback',
    L_a: 'inner and outer confirmation gates',
    L_b: 'ownership-tag stop with desktop quit check; uncertain cleanup preserves lease',
    L_e: 'NSIS shortcut claim corrected; native acceptance unverified',
    L_g: 'before/after source hashes and TAP digests checked',
    L_h: 'synced complete lease published atomically',
  },
  review: {
    independent: false,
    type: 'implementation_involved_model_self_review',
    supported_operational_receipt_created: false,
  },
  operational_configuration_accessed: false,
  operational_credentials_accessed: false,
  operational_database_accessed: false,
  retired_checkout_accessed: false,
  provider_calls: 0,
  workflows_activated: 0,
  nsis_executed: false,
  operational_installation: false,
  operational_migration: false,
  operational_recovery: false,
  operational_release: false,
  test_listener_stopped: true,
  limitations: [
    'Fresh independent v3 review required before operational preparation',
    'Native NSIS/registry/shortcut/UI acceptance unexecuted',
    'Desktop is outside helper mutex; remain fully quit',
    'System runtimes and configured PG tools are trusted host prerequisites',
    'Large-tree admission timing unverified; source metadata may contain file names',
    'Release requires readable proven-dead lease and quiescent desktop/workers; it never kills unrelated processes',
  ],
  next: 'U02 independent exact-v3 review; separately authorized fresh preparation and exact owner installation/migration decision remain later',
  full_C54: 'partial',
});
console.log(
  'Recorded source-bound v3 verification: 24 E2E scenarios + parent, 8 guards; ' +
    Object.keys(helper_sha256).length +
    ' runtime bindings. No operational approval claimed.',
);
