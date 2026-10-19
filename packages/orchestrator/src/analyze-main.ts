import { join, resolve } from 'node:path';
import { ANALYSIS_FIXTURES } from '@creator/domain';
import { runAnalysis, writeFixtureInput } from './analysis-files.js';

// `pnpm analyze <evaluation-dir> <out-dir>`: T16 tables and figures from a T15 output folder
// whose reviewers/*/ratings.csv files have been filled in. Needs no database or network.
// `pnpm analyze fixtures <out-root>`: writes each labelled synthetic fixture as input files,
// then analyzes it from those files into <out-root>/<scenario>/output.
const [first, second] = process.argv.slice(2);
if (!first || !second) {
  console.error(
    'Usage: pnpm analyze <evaluation-dir> <out-dir>\n       pnpm analyze fixtures <out-root>',
  );
  process.exit(1);
}
try {
  const runs =
    first === 'fixtures'
      ? Object.entries(ANALYSIS_FIXTURES).map(([name, make]) => {
          const root = resolve(second, name);
          writeFixtureInput(join(root, 'input'), make());
          return {
            name,
            input: join(root, 'input'),
            out: join(root, 'output'),
          };
        })
      : [{ name: first, input: first, out: second }];
  let failed = 0;
  for (const r of runs) {
    const { analysis, checks } = runAnalysis(r.input, r.out);
    console.log(`\n${r.name}: ${analysis.label}`);
    for (const c of checks)
      console.log(`${c.status.padEnd(4)} ${c.id}: ${c.detail}`);
    for (const g of analysis.gaps) console.log(`gap  ${g}`);
    failed += checks.filter((c) => c.status === 'fail').length;
    console.log(
      `Analysis ${analysis.analysis_hash} (${analysis.data_kind}) written to ${resolve(r.out)}.`,
    );
  }
  if (failed) {
    console.error(`${failed} check(s) failed.`);
    process.exitCode = 1;
  }
} catch (e) {
  const err = e as { message: string; details?: string[] };
  console.error(
    `Refused: ${err.message}${err.details?.length ? `\n  ${err.details.join('\n  ')}` : ''}`,
  );
  process.exitCode = 2;
}
