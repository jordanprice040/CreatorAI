// Mutation sanity check: each mutant of the core must make the fixture tests fail.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = 'C:/dev/creator_agent';
const work = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'mut');
const core = fs.readFileSync(path.join(repo, 'scripts/theme-intent-cw01-core-fixture.mjs'), 'utf8');
const mutants = {
  shell_running: ["if (sh.exit_ft !== null) return fail('SHELL_NOT_RUNNING');", ''],
  autorun_unavailable: ["if (o.result === 'unavailable') return fail('AUTORUN_UNAVAILABLE');", ''],
  autorun_unknown: ["if (o.result !== 'absent') return fail('AUTORUN_UNKNOWN');", ''],
  b_parent: ['const link = backendParent(r, ctx);\n  if (!link.ok) return link;\n  return counts(', 'return counts('],
  job_unknown: ["if (job.in_job !== false) return fail('JOB_CONTEXT_UNKNOWN');", ''],
  connection: ["return fail('CONNECTION_CHANGED', 'ownership_unavailable');", "return pass();"],
  pgctl_instance: ['pc.pid !== launch.pid || pc.creation_ft !== launch.creation_ft', 'pc.pid !== launch.pid'],
  null_type: ["if (c.null_type !== '0') return fail('NULL_ACTIVITY_TYPE', to);", ''],
  line7: ["if (l[6] !== '') return fail('PIDFILE_LINE7_NOT_EMPTY');", ''],
  gate: ["receipt.fixture !== false ||", ''],
  terminal: ["if (TERMINAL.includes(run.state)) return refuse('TERMINAL_STATE');", ''],
  sql_hash: ["s.sql_asset_sha256 !== SQL_ASSET.sha256", 'false'],
};
const results = {};
for (const [name, [from, to]] of Object.entries(mutants)) {
  if (!core.includes(from)) { results[name] = 'PATTERN_NOT_FOUND'; continue; }
  fs.rmSync(work, { recursive: true, force: true });
  for (const p of ['tests/theme-intent-cw01-core-fixture.test.mjs', 'scripts/theme-intent-cw01-observer-sql-v2.sql', 'docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md']) {
    fs.mkdirSync(path.dirname(path.join(work, p)), { recursive: true });
    fs.copyFileSync(path.join(repo, p), path.join(work, p));
  }
  fs.writeFileSync(path.join(work, 'scripts/theme-intent-cw01-core-fixture.mjs'), core.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(work, 'tests/theme-intent-cw01-core-fixture.test.mjs')], { encoding: 'utf8' });
  const fail = /^# fail (\d+)/m.exec(r.stdout)?.[1];
  results[name] = fail && fail !== '0' ? 'killed(' + fail + ')' : 'SURVIVED';
}
fs.rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(results, null, 1));
