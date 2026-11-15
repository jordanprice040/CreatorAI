// Writes config/connections/benchmarks/spec-cases-v1.json (ADR-0107, B2). Run after
// `pnpm build:code`: node scripts/spec-cases-benchmark.mjs, then format the file with Prettier.
// Each case asks the model to draft a spec with suggested cases for a small command-line
// program the studio knows exactly (packages/domain spec-cases.ts). The drafted cases are run
// against the reference program (every case must pass) and against known-broken versions (at
// least three of the four must fail a case). Each case's system message is the spec draft
// instructions and its user message the exact draft input, so a changed prompt stops the old
// qualification from admitting spec drafts until the model is qualified again.
// The file is frozen once written: never edit it; write spec-cases-v2 instead. Each case also
// carries its program's fingerprint (the outputs of the reference and broken versions on probe
// inputs and the grades of probe replies), so a changed program or grader stops it admitting.
import { writeFileSync } from 'node:fs';
import {
  BenchmarkManifestSchema,
  SPEC_DRAFT_INSTRUCTIONS,
  SPEC_DRAFT_INSTRUCTIONS_VERSION,
  specDraftInput,
} from '../packages/contracts/dist/index.js';
import {
  SPEC_BENCHMARK_PROGRAMS,
  specCasesFingerprint,
} from '../packages/domain/dist/index.js';

const SPLITS = [
  ['wordtally', 'development'],
  ['slug', 'development'],
  ['roman', 'development'],
  ['csvsum', 'held_out'],
  ['dedupe', 'held_out'],
  ['rle', 'held_out'],
  ['grade', 'held_out'],
  ['brackets', 'held_out'],
];

const cases = SPLITS.map(([program, split]) => {
  const p = SPEC_BENCHMARK_PROGRAMS[program];
  const request = {
    problem: {
      title: p.title,
      statement: p.statement,
      affected_group: p.affected_group,
    },
    option: p.option,
  };
  const input = specDraftInput({
    kind: 'spec',
    product: 'cli',
    ...request,
    check: null,
    case_index: null,
    maxChars: Number.MAX_SAFE_INTEGER,
  });
  const mutants = Object.keys(p.mutants);
  return {
    case_id: `spec-${program}`,
    split,
    input: [
      { role: 'system', text: SPEC_DRAFT_INSTRUCTIONS },
      { role: 'user', text: input },
    ],
    output_format: 'json',
    max_output_tokens: 8000,
    check: {
      kind: 'spec_cases_contract',
      role_version: SPEC_DRAFT_INSTRUCTIONS_VERSION,
      program,
      request,
      mutants,
      min_cases: 4,
      min_caught: mutants.length - 1,
      fingerprint: specCasesFingerprint(program),
    },
  };
});

const manifest = BenchmarkManifestSchema.parse({
  format: 'route-benchmark/1',
  name: 'spec-cases-v1',
  fixture: false,
  task_class: 'specification',
  data_class: 'synthetic',
  cases,
  provenance:
    'ADR-0107 (B2), frozen 2026-11-15: eight synthetic command-line programs written for this benchmark (three development, five held out). Each case asks for a drafted spec with suggested cases under the spec draft instructions; the studio grades the cases by running them against its own reference program and four known-broken versions in process (packages/domain spec-cases.ts). Not customer data; never edit, write spec-cases-v2 instead.',
});
writeFileSync(
  new URL(
    '../config/connections/benchmarks/spec-cases-v1.json',
    import.meta.url,
  ),
  `${JSON.stringify(manifest, null, 2)}\n`,
);
console.log(`spec-cases-v1: ${cases.length} cases`);
