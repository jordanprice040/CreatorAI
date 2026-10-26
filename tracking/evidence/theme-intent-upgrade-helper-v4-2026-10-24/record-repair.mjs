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
} from '../../../scripts/theme-intent-upgrade-v4-core.mjs';
const dir = join(
  ROOT,
  'tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24',
);
const helper_sha256 = await bindings();
for (const [kind, total] of [
  ['guards', 11],
  ['e2e', 26],
]) {
  const run = await read(join(dir, 'verified-' + kind + '-run.json'));
  assert.equal(run.exit_code, 0);
  assert.equal(run.timed_out, false);
  assert.equal(run.sources_unchanged, true);
  const tap = await readFile(join(dir, 'verified-' + kind + '.tap'), 'utf8');
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
    'tracking/evidence/theme-intent-upgrade-helper-v3-2026-10-23/repair-receipt.json',
  ),
);
for (const [p, h] of Object.entries(prior.artifact_sha256))
  assert.equal(await hash(join(ROOT, p)), h, p);
const fixtureName = (await readdir(join(ROOT, '.verification')))
  .filter((p) => /^theme-helper-v4-\d+$/.test(p))
  .sort()
  .at(-1);
const fixture = join(ROOT, '.verification', fixtureName);
assert.ok(inside(join(ROOT, '.verification'), fixture));
const summary = await read(join(fixture, 'test-summary.json'));
assert.equal(summary.listening_after, false);
const artifact_sha256 = { ...helper_sha256 };
for (const p of [
  'scripts/run-theme-intent-v4-tests.mjs',
  'tests/theme-intent-upgrade-v4.test.mjs',
  'tests/theme-intent-upgrade-v4-guards.test.mjs',
  'tests/fixtures/theme-intent-v4-installer.ps1',
  'docs/THEME_INTENT_UPGRADE_HELPER_V4_2026-10-24.md',
  ...(await readdir(dir))
    .filter((p) => /\.(mjs|tap|txt|json)$/.test(p))
    .map(
      (p) => 'tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/' + p,
    ),
])
  artifact_sha256[p] = await hash(join(ROOT, p));
await save(join(dir, 'test-observations.json'), {
  format: 'theme-intent-helper-v4-test-observations/1',
  ...summary,
  fixture_installer: true,
  nsis_executed: false,
  operational_access: false,
});
artifact_sha256[
  'tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/test-observations.json'
] = await hash(join(dir, 'test-observations.json'));
await save(join(dir, 'repair-receipt.json'), {
  format: 'theme-intent-upgrade-helper-repair/4',
  status: 'locally_verified_independent_v4_review_required',
  recorded_at: new Date().toISOString(),
  candidate_plan_hash: CANDIDATE,
  installation_plan_hash: PLAN,
  helper_sha256,
  artifact_sha256,
  checks: {
    e2e: {
      passed: 26,
      failed: 0,
      skipped: 0,
      scenarios: 25,
      includes_parent: true,
      source_bound_run: 'verified-e2e-run.json',
    },
    guards: {
      passed: 11,
      failed: 0,
      skipped: 0,
      source_bound_run: 'verified-guards-run.json',
    },
    powershell_parse: 'passed',
    formatting_check: 'passed',
    static_preflight: 'passed',
    prior_v3_artifacts_preserved: Object.keys(prior.artifact_sha256).length,
  },
  findings: {
    native_PGDATA:
      'All managed, ownership, stale data_dir and release paths use desktop postgres/data; recovery exercised there',
    presecret_layout:
      'Directory/no-links/PG_VERSION18 gate before DPAPI; actual wrapper rejects missing nested data with credential unavailable',
    fixture_fidelity:
      'Independent nested initdb path plus desktop source-contract and exact v3 regression reproduction',
    prior_review_lows:
      'Deferred and documented; no authority or continuation-policy expansion',
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
    'Fresh independent v4 review required before operational preparation',
    'Native NSIS/registry/shortcut/UI acceptance unexecuted',
    'Desktop is outside helper mutex; remain fully quit',
    'System runtimes and configured PG tools are trusted host prerequisites',
    'Large-tree admission timing unverified; source metadata may contain file names',
    'Release requires readable proven-dead lease and quiescent desktop/workers; it never kills unrelated processes',
  ],
  next: 'U02 independent exact-v4 review; separately authorized fresh preparation and exact owner installation/migration decision remain later',
  full_C54: 'partial',
});
console.log(
  'Recorded source-bound v4 verification: 25 E2E scenarios + parent, 11 guards; ' +
    Object.keys(helper_sha256).length +
    ' runtime bindings. No operational approval claimed.',
);
