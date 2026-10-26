// Mutation sanity check for core v3: each mutant must make the v3 fixture tests fail.
// Works in an isolated "mut" directory beside this script, removed afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = 'C:/dev/creator_agent';
const work = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'mut');
const core = fs.readFileSync(path.join(repo, 'scripts/theme-intent-cw01-core-fixture-v3.mjs'), 'utf8');
const mutants = {
  // v1 mutants carried forward
  shell_running: ["if (sh.exit_ft !== null) return fail('SHELL_NOT_RUNNING');", ''],
  autorun_unavailable: ["if (o.result === 'unavailable') return fail('AUTORUN_UNAVAILABLE');", ''],
  autorun_unknown: ["if (o.result !== 'absent') return fail('AUTORUN_UNKNOWN');", ''],
  b_parent: ['const link = backendParent(r, ctx);\n  if (!link.ok) return link;\n  return counts(', 'return counts('],
  job_unknown: ["if (job.in_job !== false) return fail('JOB_CONTEXT_UNKNOWN');", ''],
  connection: ["return fail('CONNECTION_CHANGED', 'ownership_unavailable');", 'return pass();'],
  pgctl_instance: ['pc.pid !== launch.pid || pc.creation_ft !== launch.creation_ft', 'pc.pid !== launch.pid'],
  null_type: ["if (c.null_type !== '0') return fail('NULL_ACTIVITY_TYPE', to);", ''],
  line7: ["if (l[6] !== '') return fail('PIDFILE_LINE7_NOT_EMPTY');", ''],
  gate: ['receipt.fixture !== false ||', ''],
  terminal: ["if (TERMINAL.includes(run.state)) return refuse('TERMINAL_STATE');", ''],
  sql_hash: ['s.sql_asset_sha256 !== SQL_ASSET.sha256', 'false'],
  // v2 repairs (F1-F3, I-3)
  f1_start_measured: ["const m = measured(e, run.ctx);\n      if (!m.ok) return { to: 'start_unknown', code: m.code };", ''],
  f1_stop_measured: ["const m = measured(e, run.ctx);\n      if (!m.ok) return { to: 'stop_unknown', code: m.code };", ''],
  f1_launch_exit_match: ['pc.exit_ft !== launch.exit_ft || ', ''],
  f2_start_outer: ['e.observed_at_ms - run.ctx.start_intent_at_ms > LIMITS.outer_deadline_ms', 'false'],
  f2_autorun_at_spawn: ['spawnMs - run.ctx.autorun_oldest_at_ms > LIMITS.autorun_max_age_ms ||', ''],
  f2_preflight_at_spawn: ['spawnMs - run.ctx.preflight_observed_at_ms > LIMITS.prespawn_max_age_ms', 'false'],
  f2_job_time: ['job.observed_at_ms > ctx.start_intent_at_ms', 'false'],
  f2_job_at_spawn: ['spawnMs - run.ctx.job_observed_at_ms > LIMITS.prespawn_max_age_ms ||', ''],
  f2_sql_total_b: ['if (b.observed_at_ms - a.connected_at_ms > LIMITS.sql_total_ms)', 'if (false)'],
  f2_connect_after_ownership: ['a.connected_at_ms < ctx.start_observed_at_ms ||', ''],
  f2_revalidation_time: ['v.observed_at_ms < bMs ||', ''],
  f2_stop_spawn_fresh: ['spawnMs - run.ctx.sqlB.observed_at_ms > LIMITS.prestop_max_age_ms', 'false'],
  f2_stop_outer: ['s.observed_at_ms - run.ctx.stop_intent_at_ms > LIMITS.outer_deadline_ms', 'false'],
  f3_snapshot: ['isObj(input) ? snapshot(input) : null', 'input'],
  f3_prior_format: ['PRIOR_RECEIPT_FORMATS.includes(receipt.format) ||', ''],
  i3_conin: ['|conin\\$|conout\\$', ''],
  // v3 repairs (R-1 to R-3)
  r1_attestation_age: ['spawnMs - run.ctx.attestation_affirmed_at_ms >', 'false && 0 >'],
  r2_stop_exit_required: ['exited === null ||\n        exited < created', 'false'],
  r2_stopped_after_exit: ['s.observed_at_ms < ftMs(exited) ||', ''],
  r3_sqlA_snapshot: ['ctx: { sqlA: snapshot(e) }', 'ctx: { sqlA: e }'],
  r3_sqlB_snapshot: ['ctx: { sqlB: snapshot(e) }', 'ctx: { sqlB: e }'],
};
const results = {};
// The unmutated core must pass first, so a baseline failure cannot count as a kill.
for (const [name, [from, to]] of Object.entries({ baseline_unmutated: ['', ''], ...mutants })) {
  if (!core.includes(from)) { results[name] = 'PATTERN_NOT_FOUND'; continue; }
  fs.rmSync(work, { recursive: true, force: true });
  for (const p of ['tests/theme-intent-cw01-core-fixture-v3.test.mjs', 'scripts/theme-intent-cw01-observer-sql-v2.sql', 'docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md']) {
    fs.mkdirSync(path.dirname(path.join(work, p)), { recursive: true });
    fs.copyFileSync(path.join(repo, p), path.join(work, p));
  }
  fs.writeFileSync(path.join(work, 'scripts/theme-intent-cw01-core-fixture-v3.mjs'), core.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(work, 'tests/theme-intent-cw01-core-fixture-v3.test.mjs')], { encoding: 'utf8' });
  const fail = /^# fail (\d+)/m.exec(r.stdout)?.[1];
  if (name === 'baseline_unmutated') results[name] = fail === '0' ? 'pass' : 'BASELINE_FAILED';
  else results[name] = fail && fail !== '0' ? 'killed(' + fail + ')' : 'SURVIVED';
}
fs.rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(results, null, 1));
