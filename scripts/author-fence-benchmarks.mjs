#!/usr/bin/env node
// ADR-0110: authors the fence-accepting copies of the current T12 role benchmarks. Each copy has
// the same cases, packets, prompts and expected checks as its source, byte for byte; only the
// name, the provenance and `answer_wrapping: "one_json_fence"` differ. The sources stay frozen
// and strict. It never dispatches a model.
// Usage: pnpm build:code && node scripts/author-fence-benchmarks.mjs <out-dir>
import { mkdir, readFile, writeFile, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { BenchmarkManifestSchema } from '../packages/contracts/dist/index.js';

const out = process.argv[2];
if (!out) throw new Error('usage: author-fence-benchmarks.mjs <out-dir>');
const root = resolve(import.meta.dirname, '../config/connections/benchmarks');

const COPIES = [
  ['t12-builder-v1', 't12-builder-v3'],
  ['t12-reviewer-v2', 't12-reviewer-v3'],
];
const NOTE =
  'ADR-0110 (authored 2026-11-15): accepts exactly one ```json or bare ``` code fence around the whole answer, nothing else outside it; graded on what is inside. Made after claude-sonnet-5-5 on the local Claude Code connection failed t12-builder-v1 (record 7c054251) by fencing otherwise complete JSON; that failed record stays, and a pass here is not independent of it.';

await mkdir(out, { recursive: true });
for (const [from, to] of COPIES) {
  const target = join(out, `${to}.json`);
  // Frozen once written: never overwrite an existing version.
  if (
    await access(target).then(
      () => true,
      () => false,
    )
  )
    throw new Error(
      `${target} already exists; frozen benchmarks are not rewritten`,
    );
  const source = BenchmarkManifestSchema.parse(
    JSON.parse(await readFile(join(root, `${from}.json`), 'utf8')),
  );
  if (source.answer_wrapping !== undefined)
    throw new Error(`${from} already accepts a fence`);
  const copy = BenchmarkManifestSchema.parse({
    format: source.format,
    name: to,
    fixture: source.fixture,
    task_class: source.task_class,
    data_class: source.data_class,
    answer_wrapping: 'one_json_fence',
    cases: source.cases,
    provenance: `Same cases, packets and checks as ${from}. ${NOTE} ${source.provenance}`,
  });
  await writeFile(target, `${JSON.stringify(copy, null, 2)}\n`);
  console.log(`wrote ${target}`);
}
