// Records the independent v3 review receipt from executed evidence, then validates it with the
// helper's own operational reviewCheck(). Writes only new files in this review directory.
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ROOT, CANDIDATE, PLAN, read, hash, sha, save, bindings, reviewCheck } from '../../../scripts/theme-intent-upgrade-v3-core.mjs';
const rel = 'tracking/evidence/theme-intent-upgrade-helper-v3-review-2026-10-24';
const dir = join(ROOT, rel), repair = 'tracking/evidence/theme-intent-upgrade-helper-v3-2026-10-23/';
const helper_sha256 = await bindings();
const repairReceipt = await read(join(ROOT, repair, 'repair-receipt.json'));
assert.deepEqual(helper_sha256, repairReceipt.helper_sha256);
const hv = await read(join(dir, 'hash-verification.json'));
assert.equal(hv.mismatches.length, 0);
const runs = {};
for (const kind of ['guards', 'e2e']) {
  const run = await read(join(ROOT, repair, `independent-review-20261024-${kind}-run.json`));
  const tap = await readFile(join(ROOT, repair, `independent-review-20261024-${kind}.tap`), 'utf8');
  assert.equal(sha(tap), run.tap_sha256);
  assert.equal(run.exit_code, 0); assert.equal(run.sources_unchanged, true); assert.equal(run.timed_out, false);
  for (const [p, h] of Object.entries(helper_sha256)) assert.equal(run.source_sha256[p], h, p);
  const n = (k) => Number(tap.match(new RegExp('# ' + k + ' ([0-9]+)'))[1]);
  runs[kind] = { tests: n('tests'), pass: n('pass'), fail: n('fail'), skipped: n('skipped'), todo: n('todo'), cancelled: n('cancelled'), tap_sha256: run.tap_sha256, run_receipt_sha256: await hash(join(ROOT, repair, `independent-review-20261024-${kind}-run.json`)) };
}
assert.deepEqual([runs.guards.pass, runs.guards.fail, runs.e2e.pass, runs.e2e.fail, runs.e2e.skipped], [8, 0, 25, 0, 0]);
const probe = await read(join(dir, 'probe-external-kill.json'));
assert.ok(!probe.error && probe.listening_after === false);
const p = probe.probes;
assert.equal(p.p1_external_kill_during_before.release.code, 0);
assert.equal(p.p1_external_kill_during_before.after_kill.mutex.acquired, true);
assert.equal(p.p2_untagged_restart_competing_cluster.untagged_restart_refused, true);
assert.notEqual(p.p3_desktop_relaunch_mid_run.release_while_desktop_running.code, 0);
assert.equal(p.p4_forward_after_external_kill.after_resume.code, 0);
assert.equal(p.p4_forward_after_external_kill.effect_hashes_unchanged, true);
const artifact_sha256 = {};
for (const f of (await readdir(dir)).sort()) if (f !== 'reviewer-receipt.json') artifact_sha256[rel + '/' + f] = await hash(join(dir, f));
for (const f of ['docs/THEME_INTENT_UPGRADE_HELPER_V3_REVIEW_2026-10-24.md', repair + 'repair-receipt.json', 'docs/THEME_INTENT_UPGRADE_HELPER_V3_2026-10-23.md',
  'scripts/run-theme-intent-v3-tests.mjs', 'tests/theme-intent-upgrade-v3.test.mjs', 'tests/theme-intent-upgrade-v3-guards.test.mjs', 'tests/fixtures/theme-intent-v3-installer.ps1'])
  artifact_sha256[f] = await hash(join(ROOT, f));
const out = join(dir, 'reviewer-receipt.json');
await save(out, {
  format: 'theme-intent-upgrade-independent-review/3',
  status: 'supported_exact_helper',
  supported_for_next_step: 'operational_before_preparation_only_with_separate_owner_authorization',
  reviewed_at: new Date().toISOString(),
  reviewer: 'separate U02 model reviewer',
  prior_implementation_involvement: false,
  candidate_plan_hash: CANDIDATE,
  installation_plan_hash: PLAN,
  helper_sha256,
  artifact_sha256,
  findings: { high: [], medium: [], low: [
    'L1 stale-decision resume_phase not restricted to documented set (cleanup-only)',
    'L2 migrate continuation not gated by install_and_migrate_approved switch (bound via admission; no repeat)',
    'L3 Local\\ mutex namespace and unnormalized path spelling; lease remains exclusive',
    'L4 death during migration child remains rollback-only for acceptance (deliberate)',
    'L5 runner/evidence details; desktop relaunch reports failure conservatively; stray lease temp file possible'] },
  v2_findings: { resolved: ['M1', 'M2', 'L-a (install/recover)', 'L-b', 'L-g', 'L-h'], unchanged_documented_limits: ['L-c', 'L-d', 'L-e', 'L-f'] },
  checks: {
    receipt_hashes: { helper: hv.helper_sha256, artifact: hv.artifact_sha256, v2_artifact: hv.v2_artifact_sha256, mismatched: 0 },
    bindings_equal: hv.bindings_equal_receipt, check_exit: 0, ps5_parse_errors: 0,
    historical_runs: { guards: hv.runs.guards, e2e: hv.runs.e2e },
    rerun_label: 'independent-review-20261024', rerun: runs,
    external_kill_probe: { port: probe.port, p1_before_release_without_credentials: true, p2_untagged_cluster_refused: true, p3_desktop_relaunch_conservative: true, p4_forward_after_resume_effects_unchanged: true, admit_scoped_cleanup_accepted: true, listening_after: false },
  },
  not_demonstrated: ['real NSIS', 'registry/shortcut (/NS skips shortcuts)', 'native UI acceptance', 'operational schema-29 installation', 'desktop coordination outside mutex', 'Ctrl+C/window-close delivery', 'host executable trust', 'operational-scale timing'],
  installation_approval: false, owner_authorization: false, operational_access: false, nsis_executed: false, provider_calls: 0, full_C54: 'partial',
});
await reviewCheck(out, false);
console.log('Recorded and validated supported exact-helper review receipt; ' + Object.keys(helper_sha256).length + ' bindings, ' + Object.keys(artifact_sha256).length + ' artifacts.');
