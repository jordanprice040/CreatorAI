#!/usr/bin/env node
// P14 repo benchmarks CLI. The grading rules live in the frozen config/repo-benchmarks/grader.mjs.
//
//   node scripts/p14-benchmark.mjs verify [--set v2|v3|v4]
//   node scripts/p14-benchmark.mjs score <benchmark-id> <product-dir> [--runner bwrap|direct] [--trusted]
//   node scripts/p14-benchmark.mjs compare-spec <benchmark-id> <stored-spec.json>
//   node scripts/p14-benchmark.mjs freeze --set <set>   (once per set; refuses to overwrite)
//
// Each set is a frozen grader with its own FREEZE.json: v2 is config/repo-benchmarks/grader.mjs,
// v3 and v4 are config/repo-benchmarks/v3/ and v4/grader.mjs. score and compare-spec pick the set from the
// benchmark id's version suffix.
//
// `score` runs generated code. The default runner is Bubblewrap with no network and a read-only
// copy of the product (Linux or WSL2). `--runner direct` runs it without isolation and is
// refused unless `--trusted` is given: only for the reference solutions in this repository or a
// throwaway container, never on the studio host with real data. `score` refuses while the freeze
// is broken. `verify` also needs `pnpm build:code` (it reads the spec schema from contracts/dist).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// The v2 grader stays the default export surface, as before v3 existed.
export * from '../config/repo-benchmarks/grader.mjs';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SETS = {
  v2: join(ROOT, 'config/repo-benchmarks/grader.mjs'),
  v3: join(ROOT, 'config/repo-benchmarks/v3/grader.mjs'),
  v4: join(ROOT, 'config/repo-benchmarks/v4/grader.mjs'),
};
/** The frozen grader module of a set. */
export async function loadSet(name = 'v2') {
  if (!(name in SETS)) throw new Error(`Unknown benchmark set ${name}`);
  return import(pathToFileURL(SETS[name]).href);
}
/** The set a benchmark id belongs to, from its version suffix (p14-...-v3 is set v3). */
export const setOf = (id) => /-(v[0-9]+)$/.exec(id ?? '')?.[1] ?? 'v2';

/** Freeze problems plus the studio's own spec schema and build rules; empty when all hold. */
export async function verify(set = 'v2') {
  const { BENCHMARKS, freezeProblems, loadBenchmark } = await loadSet(set);
  const { SpecContentSchema, buildBlockers, MAX_BUILD_CASES } = await import(
    pathToFileURL(join(ROOT, 'packages/contracts/dist/index.js')).href
  );
  const problems = freezeProblems();
  for (const id of BENCHMARKS) {
    const b = loadBenchmark(id);
    const parsed = SpecContentSchema.safeParse(b.spec.content);
    if (!parsed.success)
      problems.push(
        `${id}: spec does not match the studio's spec schema: ${parsed.error.message}`,
      );
    else {
      // The studio trims text fields; the frozen text must already be in that form.
      if (JSON.stringify(parsed.data) !== JSON.stringify(b.spec.content))
        problems.push(`${id}: spec changes when the studio parses it`);
      for (const t of parsed.data.tasks)
        for (const msg of buildBlockers(parsed.data, t.key, 'synthetic'))
          problems.push(`${id} ${t.key}: ${msg}`);
    }
    if (b.cases.length > MAX_BUILD_CASES)
      problems.push(`${id}: more than ${MAX_BUILD_CASES} build cases`);
    if (b.expectations.benchmark_id !== id || b.spec.benchmark_id !== id)
      problems.push(`${id}: benchmark id mismatch`);
  }
  return problems;
}

async function main(argv) {
  const at = argv.indexOf('--set');
  const named = at >= 0 ? argv[at + 1] : null;
  if (at >= 0) argv = argv.filter((_, i) => i !== at && i !== at + 1);
  const [cmd, ...rest] = argv;
  if (cmd === 'verify') {
    const set = named ?? 'v2';
    const problems = await verify(set);
    for (const p of problems) console.error(`FAIL ${p}`);
    if (problems.length) process.exit(1);
    const { BENCHMARKS } = await loadSet(set);
    console.log(
      `OK set ${set}: ${BENCHMARKS.length} frozen benchmarks intact and buildable`,
    );
    return;
  }
  if (cmd === 'freeze') {
    if (!named) throw new Error('freeze needs --set <set>');
    const { BENCHMARKS, FREEZE_FILE, frozenFiles } = await loadSet(named);
    if (existsSync(FREEZE_FILE))
      throw new Error(
        'FREEZE.json exists: a frozen version is never re-frozen; add a new benchmark version instead',
      );
    writeFileSync(
      FREEZE_FILE,
      JSON.stringify(
        {
          format: 'p14-benchmark-freeze/2',
          frozen_at: new Date().toISOString(),
          note: `Set ${named}. Written by the author before any studio or model run of this set; the git commit and this file hash (recorded in docs/REPO_BENCHMARKS_P14_2026-11-06.md) are the anchor.`,
          benchmarks: BENCHMARKS,
          files: frozenFiles(),
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Frozen');
    return;
  }
  if (cmd === 'compare-spec') {
    const [id, file] = rest;
    if (!id || !file)
      throw new Error('usage: compare-spec <benchmark-id> <stored-spec.json>');
    const { compareSpec, freezeProblems } = await loadSet(setOf(id));
    const problems = [
      ...freezeProblems(),
      ...compareSpec(id, JSON.parse(readFileSync(file, 'utf8'))),
    ];
    for (const p of problems) console.error(`FAIL ${p}`);
    if (problems.length) process.exit(1);
    console.log(`OK the stored spec equals the frozen ${id} spec`);
    return;
  }
  if (cmd === 'score') {
    const [id, dir, ...flags] = rest;
    if (!id || !dir)
      throw new Error(
        'usage: score <benchmark-id> <product-dir> [--runner bwrap|direct] [--trusted]',
      );
    const kind = flags.includes('--runner')
      ? flags[flags.indexOf('--runner') + 1]
      : 'bwrap';
    if (kind !== 'bwrap' && kind !== 'direct')
      throw new Error('runner is bwrap or direct');
    if (kind === 'direct' && !flags.includes('--trusted'))
      throw new Error(
        '--runner direct runs generated code without isolation; add --trusted only for the reference solutions or a throwaway container',
      );
    const { score } = await loadSet(setOf(id));
    const result = score(id, dir, { kind });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  }
  throw new Error(
    'usage: verify [--set s] | score <id> <dir> | compare-spec <id> <file> | freeze --set s',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
