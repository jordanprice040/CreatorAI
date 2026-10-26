import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ROOT,
  CANDIDATE,
  PLAN,
  read,
  hash,
  save,
  bindings,
  inside,
} from '../../../scripts/theme-intent-upgrade-v2-core.mjs';
const dir = join(
  ROOT,
  'tracking/evidence/theme-intent-upgrade-helper-v2-2026-10-23',
);
for (const [name, total] of [
  ['e2e-verified.tap', 21],
  ['guards-final.tap', 5],
]) {
  const tap = await readFile(join(dir, name), 'utf8');
  assert.match(tap, new RegExp(`# tests ${total}\\r?\\n`));
  assert.match(tap, new RegExp(`# pass ${total}\\r?\\n`));
  assert.match(tap, /# fail 0\r?\n/);
  assert.match(tap, /# skipped 0\r?\n/);
}
const original = await read(
  join(
    ROOT,
    'tracking/evidence/theme-intent-upgrade-helper-2026-10-23/implementation-receipt.json',
  ),
);
for (const [p, h] of Object.entries(original.artifact_sha256))
  assert.equal(await hash(join(ROOT, p)), h, p);
const fixtures = (await readdir(join(ROOT, '.verification')))
  .filter((n) => /^theme-helper-v2-\d+$/.test(n))
  .sort();
const fixture = join(ROOT, '.verification', fixtures.at(-1));
assert.ok(inside(join(ROOT, '.verification'), fixture));
const summary = await read(join(fixture, 'test-summary.json'));
assert.equal(summary.listening_after, false);
const helper_sha256 = await bindings();
const artifact_sha256 = { ...helper_sha256 };
for (const path of [
  'tests/theme-intent-upgrade-v2.test.mjs',
  'tests/theme-intent-upgrade-v2-guards.test.mjs',
  'tests/fixtures/theme-intent-v2-installer.ps1',
  'docs/THEME_INTENT_UPGRADE_HELPER_V2_2026-10-23.md',
  'docs/THEME_INTENT_UPGRADE_HELPER_REVIEW_2026-10-23.md',
  ...(await readdir(dir))
    .filter((p) => /\.(mjs|tap|txt)$/.test(p))
    .map(
      (p) => 'tracking/evidence/theme-intent-upgrade-helper-v2-2026-10-23/' + p,
    ),
])
  artifact_sha256[path] = await hash(join(ROOT, path));
await save(join(dir, 'test-observations.json'), {
  format: 'theme-intent-helper-v2-test-observations/1',
  ...summary,
  fixture_installer: true,
  nsis_executed: false,
  operational_state_accessed: false,
});
artifact_sha256[
  'tracking/evidence/theme-intent-upgrade-helper-v2-2026-10-23/test-observations.json'
] = await hash(join(dir, 'test-observations.json'));
await save(join(dir, 'repair-receipt.json'), {
  format: 'theme-intent-upgrade-helper-repair/2',
  status: 'repaired_locally_verified_independent_v2_review_required',
  recorded_at: new Date().toISOString(),
  candidate_plan_hash: CANDIDATE,
  installation_plan_hash: PLAN,
  helper_sha256,
  artifact_sha256,
  checks: {
    e2e: {
      passed: 21,
      failed: 0,
      skipped: 0,
      includes_parent_test: true,
      transcript: 'e2e-verified.tap',
    },
    guards: {
      passed: 5,
      failed: 0,
      skipped: 0,
      transcript: 'guards-final.tap',
    },
    powershell_parse: 'passed',
    formatting_check: 'passed',
    static_package_preflight: 'passed',
    original_artifact_hashes_preserved: Object.keys(original.artifact_sha256)
      .length,
  },
  findings_addressed: [
    'H1',
    'H2',
    'M1',
    'M2',
    'M3',
    'M4',
    'M5',
    'L1',
    'L2',
    'L3',
    'L4',
    'L5',
    'L6',
    'L7',
    'L8',
  ],
  review: {
    type: 'implementation_involved_model_self_review',
    independent: false,
    supported_operational_review_created: false,
    remaining_native_acceptance: [
      'actual target/predecessor NSIS',
      'standard and custom registry/shortcut acceptance',
      'installed desktop UI',
    ],
  },
  operational_configuration_accessed: false,
  operational_credentials_accessed: false,
  operational_database_accessed: false,
  provider_calls: 0,
  workflows_activated: 0,
  nsis_executed: false,
  operational_migration: false,
  operational_recovery: false,
  fixture_recovery_rehearsed: true,
  test_listener_stopped: true,
  scope_limits: [
    'Recovery refuses later/unknown work and unavailable source databases; separate plan required',
    'DPAPI recovery is same user/machine',
    'ASCII managed password only for pinned Windows libpq',
    'Fixture-only clock and installer adapters do not authorize operations',
  ],
  next: 'Fresh independent exact-v2 helper review, then separately authorized fresh operational preparation and new exact owner install/migration decision',
  full_C54: 'partial',
});
console.log(
  `Recorded repair: 21 end-to-end tests (including parent), 5 guards; ${Object.keys(helper_sha256).length} reviewed runtime bindings; original16 artifacts unchanged. No operational support/approval claimed.`,
);
