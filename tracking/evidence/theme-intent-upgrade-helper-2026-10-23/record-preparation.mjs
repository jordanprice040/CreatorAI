import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import {
  CANDIDATE,
  PLAN,
  helperHashes,
  hash,
  save,
} from '../../../scripts/theme-intent-upgrade-core.mjs';
const dir = 'tracking/evidence/theme-intent-upgrade-helper-2026-10-23/';
const tap = await readFile(dir + 'tests-reviewed.tap', 'utf8');
assert.match(tap, /# tests 10\r?\n/);
assert.match(tap, /# pass 10\r?\n/);
assert.match(tap, /# fail 0\r?\n/);
assert.match(tap, /# skipped 0\r?\n/);
const helpers = await helperHashes();
const artifacts = { ...helpers };
for (const path of [
  'tests/theme-intent-upgrade.test.mjs',
  'docs/THEME_INTENT_UPGRADE_HELPER_2026-10-23.md',
  ...(await readdir(dir))
    .filter(
      (p) => p.endsWith('.tap') || p.endsWith('.txt') || p.endsWith('.mjs'),
    )
    .map((p) => dir + p),
])
  artifacts[path] = await hash(path);
await save(dir + 'implementation-receipt.json', {
  format: 'theme-intent-upgrade-helper-preparation/1',
  status: 'implemented_tested_self_reviewed_independent_review_required',
  at: new Date().toISOString(),
  candidate_plan_hash: CANDIDATE,
  installation_plan_hash: PLAN,
  helper_sha256: helpers,
  artifact_sha256: artifacts,
  tests: {
    transcript: dir + 'tests-reviewed.tap',
    passed: 10,
    failed: 0,
    skipped: 0,
    scope:
      'contract gates; disposable full28-to29 state fingerprints; synthetic database snapshot restore',
  },
  static_preflight: 'passed',
  powershell_parse: 'passed',
  format: 'passed',
  review: {
    type: 'implementation_involved_model_self_review',
    independent: false,
    human_acceptance: false,
    remaining_material_findings: [],
    repairs: [
      'schema28-compatible custom backup contract',
      'independent helper hash binding',
      'current complete program equals rollback at admission',
      'fresh approval near mutation',
      'twelve active/uncertain work categories',
    ],
  },
  operational_configuration_accessed: false,
  operational_credentials_accessed: false,
  operational_database_accessed: false,
  provider_calls: 0,
  workflows_activated: 0,
  installed: false,
  operational_migration: false,
  full_studio_restore_rehearsed: false,
  test_listeners_stopped: true,
  next: 'U02 independent exact-helper review; then fresh backup/readiness and new exact owner installation/migration decision',
  full_C54: 'partial',
});
console.log(
  'Recorded exact helper preparation and self-review; no independent review or installation approval claimed.',
);
