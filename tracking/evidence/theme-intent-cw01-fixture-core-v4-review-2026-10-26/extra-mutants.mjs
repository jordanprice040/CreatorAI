// Reviewer-only extra mutants for core v4; work copies stay in this scratch folder.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const repo = 'C:/dev/creator_agent';
const work = path.join(path.dirname(new URL(import.meta.url).pathname.slice(1)), 'xmut');
const core = fs.readFileSync(path.join(repo, 'scripts/theme-intent-cw01-core-fixture-v4.mjs'), 'utf8');
const mutants = {
  x_catch_rethrows: ['  } catch {\n    return null;\n  }', '  } catch (x) {\n    throw x;\n  }'],
  x_handler_gets_input: ['const r = h.run(evidence, run);', 'const r = h.run(evidenceInput, run);'],
  x_digest_input_last: ['  const last = append(\n    cur,\n    event,\n    evidence,', '  const last = append(\n    cur,\n    event,\n    evidenceInput ?? null,'],
  x_refuse_digest_input: ["append(run, event, evidence, run.state, 'refused', code)", "append(run, event, evidenceInput ?? null, run.state, 'refused', code)"],
  x_prior_format_v3_dropped: ["  'theme-intent-cw01-fixture-receipt/3',\n", ''],
  x_store_unfrozen_B: ["return { to: 'sql_B', ctx: { sqlB: e } };", "return { to: 'sql_B', ctx: { sqlB: { ...e } } };"],
};
const results = {};
for (const [name, [from, to]] of Object.entries({ baseline_unmutated: ['', ''], ...mutants })) {
  if (!core.includes(from)) { results[name] = 'PATTERN_NOT_FOUND'; continue; }
  fs.rmSync(work, { recursive: true, force: true });
  for (const p of ['tests/theme-intent-cw01-core-fixture-v4.test.mjs', 'scripts/theme-intent-cw01-observer-sql-v2.sql', 'docs/THEME_INTENT_CW01_IMPLEMENTATION_DESIGN_2026-10-26.md']) {
    fs.mkdirSync(path.dirname(path.join(work, p)), { recursive: true });
    fs.copyFileSync(path.join(repo, p), path.join(work, p));
  }
  fs.writeFileSync(path.join(work, 'scripts/theme-intent-cw01-core-fixture-v4.mjs'), core.replace(from, to));
  const r = spawnSync(process.execPath, ['--test', path.join(work, 'tests/theme-intent-cw01-core-fixture-v4.test.mjs')], { encoding: 'utf8' });
  const fail = /^# fail (\d+)/m.exec(r.stdout)?.[1];
  if (name === 'baseline_unmutated') results[name] = fail === '0' ? 'pass' : 'BASELINE_FAILED';
  else results[name] = fail && fail !== '0' ? 'killed(' + fail + ')' : 'SURVIVED';
}
fs.rmSync(work, { recursive: true, force: true });
console.log(JSON.stringify(results, null, 1));
