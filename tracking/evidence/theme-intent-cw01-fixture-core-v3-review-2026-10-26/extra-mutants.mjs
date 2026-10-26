// Reviewer-only extra mutants for v3 R-1/R-2/R-3 edges; isolated copy, removed afterwards.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = 'C:/dev/creator_agent';
const work = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'xmut');
const core = fs.readFileSync(path.join(repo, 'scripts/theme-intent-cw01-core-fixture-v3.mjs'), 'utf8');
const mutants = {
  baseline_unmutated: ['', ''],
  r1_bound_plus_1ms: ['attestation_max_age_ms: 120000', 'attestation_max_age_ms: 120001'],
  r1_bound_minus_1ms: ['attestation_max_age_ms: 120000', 'attestation_max_age_ms: 119999'],
  r1_ctx_not_recorded: ['attestation_affirmed_at_ms: e.attestation.affirmed_at_ms,', ''],
  r2_drop_order_only: ['exited === null ||\n        exited < created', 'exited === null'],
  r2_drop_null_only: ['exited === null ||\n        exited < created', 'exited < created'],
  r2_revert_to_spawn: ['s.observed_at_ms < ftMs(exited) ||', 's.observed_at_ms < spawnMs ||'],
  r3_shallow_copy_A: ['ctx: { sqlA: snapshot(e) }', 'ctx: { sqlA: { ...e } }'],
  r3_unfrozen_copy_B: ['ctx: { sqlB: snapshot(e) }', 'ctx: { sqlB: JSON.parse(JSON.stringify(e)) }'],
};
const results = {};
for (const [name, [from, to]] of Object.entries(mutants)) {
  if (!core.includes(from)) { results[name] = 'PATTERN_NOT_FOUND'; continue; }
  fs.rmSync(work, { recursive: true, force: true });
  for (const p of ['tests/theme-intent-cw01-core-fixture-v3.test.mjs', 'scripts/theme-intent-cw01-observer-sql-v2.sql', 'docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md']) {
    fs.mkdirSync(path.dirname(path.join(work, p)), { recursive: true });
    fs.copyFileSync(path.join(repo, p), path.join(work, p));
  }
  fs.writeFileSync(path.join(work, 'scripts/theme-intent-cw01-core-fixture-v3.mjs'), core.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(work, 'tests/theme-intent-cw01-core-fixture-v3.test.mjs')], { encoding: 'utf8' });
  const fail = /^# fail (\d+)/m.exec(r.stdout)?.[1];
  results[name] = name === 'baseline_unmutated' ? (fail === '0' ? 'pass' : 'BASELINE_FAILED') : (fail && fail !== '0' ? 'killed(' + fail + ')' : 'SURVIVED');
}
fs.rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(results, null, 1));
