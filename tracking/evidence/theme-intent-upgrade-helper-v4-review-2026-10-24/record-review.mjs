// Records the independent v4 review receipt from executed evidence, then validates it with the
// helper's own operational reviewCheck(). Writes only a new file in this review directory.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
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
  reviewCheck,
} from '../../../scripts/theme-intent-upgrade-v4-core.mjs';
const rel = 'tracking/evidence/theme-intent-upgrade-helper-v4-review-2026-10-24';
const dir = join(ROOT, rel),
  repair = 'tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/';
const label = 'independent-review-v4-20261024';
const helper_sha256 = await bindings();
assert.deepEqual(helper_sha256, (await read(join(ROOT, repair, 'repair-receipt.json'))).helper_sha256);
assert.equal(Object.keys(helper_sha256).length, 145);
const hv = await read(join(dir, 'hash-verification.json'));
assert.equal(hv.mismatches.length, 0);
assert.deepEqual(
  [hv.v4_helper_sha256, hv.v4_artifact_sha256, hv.v3_artifact_sha256, hv.v2_artifact_sha256],
  [145, 168, 161, 162],
);
assert.ok(hv.bindings_equal_receipt && hv.bindings_key_order_equal);
for (const k of ['verified_guards', 'verified_e2e']) {
  const r = hv.runs[k];
  assert.ok(r.exit_code === 0 && !r.timed_out && r.sources_unchanged && r.tap_sha256_matches);
  assert.equal(r.pass, r.tests);
  assert.deepEqual([r.fail, r.skipped, r.cancelled, r.source_mismatches_now.length], [0, 0, 0, 0]);
}
const runs = {};
for (const kind of ['guards', 'e2e']) {
  const run = await read(join(ROOT, repair, `${label}-${kind}-run.json`));
  const tap = await readFile(join(ROOT, repair, `${label}-${kind}.tap`), 'utf8');
  assert.equal(sha(tap), run.tap_sha256);
  assert.equal(run.exit_code, 0);
  assert.equal(run.sources_unchanged, true);
  assert.equal(run.timed_out, false);
  for (const [p, h] of Object.entries(helper_sha256)) assert.equal(run.source_sha256[p], h, p);
  const n = (k) => Number(tap.match(new RegExp('# ' + k + ' ([0-9]+)'))[1]);
  runs[kind] = {
    tests: n('tests'),
    pass: n('pass'),
    fail: n('fail'),
    skipped: n('skipped'),
    todo: n('todo'),
    cancelled: n('cancelled'),
    tap_sha256: run.tap_sha256,
    run_receipt_sha256: await hash(join(ROOT, repair, `${label}-${kind}-run.json`)),
  };
}
assert.deepEqual(
  [runs.guards.pass, runs.guards.fail, runs.e2e.pass, runs.e2e.fail, runs.e2e.skipped],
  [11, 0, 26, 0, 0],
);
const p1 = await read(join(dir, 'probe-presecret-layout.json'));
assert.equal(p1.results.length, 8);
assert.ok(p1.results.slice(0, -1).every((r) => r.presecret_refusal && !r.reached_dpapi && !r.evidence_created && !r.lease_created));
assert.ok(p1.results.at(-1).reached_dpapi && p1.root_removed);
const p2 = await read(join(dir, 'probe-recovery-rename-refusal.json'));
assert.ok(!p2.error && p2.root_removed && !p2.listening_after);
assert.ok(p2.steps.recovery_1.eperm_rename_at_installer_step && p2.steps.recovery_1.config_unchanged);
assert.equal(p2.steps.recovery_2.exit_code, 0);
const p3 = await read(join(dir, 'probe-copy-rename-race.json'));
assert.ok(p3.root_removed);
const artifact_sha256 = {};
for (const f of (await readdir(dir)).sort())
  if (f !== 'reviewer-receipt.json') artifact_sha256[rel + '/' + f] = await hash(join(dir, f));
for (const f of [
  'docs/THEME_INTENT_UPGRADE_HELPER_V4_REVIEW_2026-10-24.md',
  'docs/THEME_INTENT_UPGRADE_HELPER_V4_2026-10-24.md',
  repair + 'repair-receipt.json',
  ...['sources-before.json', 'guards-run.json', 'guards.tap', 'e2e-run.json', 'e2e.tap'].map((s) => `${repair}${label}-${s}`),
  'scripts/run-theme-intent-v4-tests.mjs',
  'tests/theme-intent-upgrade-v4.test.mjs',
  'tests/theme-intent-upgrade-v4-guards.test.mjs',
  'tests/fixtures/theme-intent-v4-installer.ps1',
  'apps/desktop/src-tauri/src/home.rs',
  'apps/desktop/src-tauri/src/postgres.rs',
  'apps/desktop/src-tauri/src/studio.rs',
  'apps/desktop/src-tauri/src/main.rs',
  'tracking/evidence/theme-intent-operational-before-2026-10-24/attempt-result.json',
])
  artifact_sha256[f] = await hash(join(ROOT, f));
const out = join(dir, 'reviewer-receipt.json');
await save(out, {
  format: 'theme-intent-upgrade-independent-review/4',
  status: 'supported_exact_helper',
  supported_for_next_step: 'operational_before_preparation_only_with_separate_owner_authorization',
  reviewed_at: new Date().toISOString(),
  reviewer: 'separate U02 model reviewer (same model family as implementer; not blinded; not human acceptance)',
  prior_implementation_involvement: false,
  candidate_plan_hash: CANDIDATE,
  installation_plan_hash: PLAN,
  helper_sha256,
  artifact_sha256,
  native_layout: {
    desktop_pg_data: 'home/postgres/data (home.rs:120-122, unchanged since efe6627)',
    helper_data_path: 'home/postgres/data for managed, ownership, stale data_dir, release and recovery',
    flat_fallback: false,
  },
  findings: {
    high: [],
    medium: [],
    low: [
      'L1 transient directory-rename refusal can stop coordinated recovery midway (v4.mjs:723/735/736/739); reproduced as host transient; fails closed; second approved recovery completes; resume procedure undocumented',
      'L2 v4 ignores older-version leases/mutexes on the same home; cannot consume or retire them',
      'L3 real-wrapper layout regression asserts stderr loosely (test:423); independently confirmed by probe',
    ],
    deferred_v3_low: ['L1', 'L2', 'L3', 'L4', 'L5'],
  },
  retained_first_run_failures: {
    layout_test_setup: 'test-only change; all runtime bindings equal between first and verified runs',
    recovery_eperm: 'reproducible host-level transient (3/20 after node cp, <=65 ms); cause not identified; conservative and recoverable (probe P2)',
  },
  checks: {
    receipt_hashes: {
      v4_helper: hv.v4_helper_sha256,
      v4_artifact: hv.v4_artifact_sha256,
      v3_artifact: hv.v3_artifact_sha256,
      v3_helper: hv.v3_helper_sha256,
      v2_artifact: hv.v2_artifact_sha256,
      v2_helper: hv.v2_helper_sha256,
      mismatched: 0,
    },
    bindings_equal: true,
    check_exit: 0,
    ps5_parse_errors: 0,
    historical_runs: hv.runs,
    rerun_label: label,
    rerun: runs,
    presecret_probe: { refused: 7, control_reached_dpapi: true, credential_read_on_refusal: false },
    recovery_rename_probe: { port: p2.port, recovery_1: p2.steps.recovery_1, recovery_2: p2.steps.recovery_2 },
    copy_rename_race: p3.summary,
    listening_after: false,
  },
  not_demonstrated: [
    'real NSIS',
    'registry/shortcut (/NS skips shortcuts)',
    'native UI acceptance',
    'operational schema-29 installation',
    'desktop coordination outside mutex',
    'host executable trust',
    'operational-scale timing',
    'cause of transient rename refusals',
  ],
  installation_approval: false,
  owner_authorization: false,
  operational_access: false,
  nsis_executed: false,
  provider_calls: 0,
  full_C54: 'partial',
});
await reviewCheck(out, false);
console.log(
  'Recorded and validated supported exact-helper review receipt; ' +
    Object.keys(helper_sha256).length +
    ' bindings, ' +
    Object.keys(artifact_sha256).length +
    ' artifacts.',
);
