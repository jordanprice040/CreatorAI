#!/usr/bin/env node
// ADR-0105: in-app recipe benchmarks (config/recipe-benchmarks, the v5 copies of the November 6
// benchmarks). The studio loads and checks them itself (packages/executor/src/recipe-benchmarks.ts).
//
//   node scripts/recipe-benchmarks.mjs freeze <benchmark-id>   (once; refuses to overwrite)
//
// A freeze hashes every file of the benchmark, the reviewed web checker (web benchmark) and the
// studio's pass-bar rules (packages/executor/src/recipe-scoring.ts). It is written before any run
// and never changed after; a change is a new benchmark version.
import { createHash } from 'node:crypto';
import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIR = join(ROOT, 'config/recipe-benchmarks');
const sha = (b) => createHash('sha256').update(b).digest('hex');
// Review 1 N-3: never freeze tool leftovers (Python's __pycache__, dotfiles); the studio ignores
// them too (recipe-benchmarks.ts ignoredBenchmarkFile).
const ignored = (n) => n === '__pycache__' || n.startsWith('.');
const walk = (d) =>
  readdirSync(d)
    .filter((n) => !ignored(n))
    .sort()
    .flatMap((n) =>
      statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)],
    );

export function freezeFiles(id) {
  const base = join(DIR, id);
  const out = {};
  for (const f of walk(base))
    if (relative(base, f) !== 'FREEZE.json')
      out[relative(base, f).replaceAll('\\', '/')] = sha(readFileSync(f));
  if (id.startsWith('p15-'))
    out['checker:web_recipe.py'] = sha(
      readFileSync(join(ROOT, 'packages/executor/worker/web_recipe.py')),
    );
  out['scorer:recipe-scoring.ts'] = sha(
    readFileSync(join(ROOT, 'packages/executor/src/recipe-scoring.ts')),
  );
  return out;
}

const [cmd, id] = process.argv.slice(2);
if (cmd === 'freeze' && id) {
  const path = join(DIR, id, 'FREEZE.json');
  if (existsSync(path))
    throw new Error('Already frozen; publish a new version');
  writeFileSync(
    path,
    JSON.stringify(
      {
        format: 'recipe-benchmark-freeze/1',
        benchmark_id: id,
        files: freezeFiles(id),
      },
      null,
      2,
    ) + '\n',
  );
  console.log(JSON.stringify({ frozen: id }));
} else {
  console.error('usage: freeze <benchmark-id>');
  process.exit(2);
}
