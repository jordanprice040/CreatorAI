import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { BenchmarkCheckSchema } from '@creator/contracts';
import {
  checkOutput,
  discoveryRoleInput,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
} from '@creator/domain';
const root = new URL(
  '../../config/connections/benchmarks/discovery-synthetic-v3/',
  import.meta.url,
);
const read = (s: string) => JSON.parse(readFileSync(new URL(s, root), 'utf8'));
const cases = read('scoring.json').cases;
const controls = read('author-controls.json');
const c = cases[0];
const gold = controls.find((x: any) => x.case_id === c.case_id).gold;
const bound = BenchmarkCheckSchema.parse({
  ...c.check,
  assertions: [
    {
      select: {
        proposal: 'P2',
        finding: { type: 'duplicate', catalog_ref: 'K1', claim_ref: 'C2' },
      },
      path: ['catalog_ref'],
      op: 'equals',
      value: 'K1',
    },
    {
      select: { proposal: 'P1' },
      path: ['verdict'],
      op: 'equals',
      value: 'stands',
    },
  ],
});
const score = (j: any, check = bound) =>
  checkOutput(
    check,
    { json: j, text: JSON.stringify(j) },
    { succeeded: true, reason_code: 'ok' },
  );
test('identity-bound finding and asymmetric verdict survive review/finding permutations', () => {
  assert.equal(score(gold), 'accepted');
  const j = structuredClone(gold);
  j.reviews[1].findings.push({
    type: 'other',
    detail: 'A distinct unresolved issue.',
    claim_refs: [],
    catalog_ref: null,
  });
  j.reviews[1].findings.reverse();
  j.reviews.reverse();
  assert.equal(score(j), 'accepted');
});
test('valid references on the wrong proposal or detached finding cannot satisfy association', () => {
  const wrong = structuredClone(gold);
  [wrong.reviews[0].findings, wrong.reviews[1].findings] = [
    wrong.reviews[1].findings,
    wrong.reviews[0].findings,
  ];
  assert.equal(score(wrong), 'acceptance_check_failed');
  const detached = structuredClone(gold);
  detached.reviews[1].findings[0].catalog_ref = null;
  detached.reviews[2].findings[0].catalog_ref = 'K1';
  assert.equal(score(detached), 'acceptance_check_failed');
  const ref = structuredClone(gold);
  ref.reviews[1].findings[0].claim_refs = ['C3'];
  assert.equal(score(ref), 'acceptance_check_failed');
});
test('missing or ambiguous selected finding fails; duplicate/omitted proposal fails production checks', () => {
  for (const mutate of [
    (j: any) =>
      j.reviews[1].findings.push(structuredClone(j.reviews[1].findings[0])),
    (j: any) => j.reviews[1].findings.splice(0),
    (j: any) => (j.reviews[1].proposal = 'P1'),
    (j: any) => j.reviews.splice(1, 1),
  ]) {
    const j = structuredClone(gold);
    mutate(j);
    assert.equal(score(j), 'acceptance_check_failed');
  }
});
test('null catalog selection and justified disagreement do not require a duplicate finding', () => {
  const check = BenchmarkCheckSchema.parse({
    ...c.check,
    assertions: [
      {
        select: {
          proposal: 'P3',
          finding: { type: 'novelty_overclaim', catalog_ref: null },
        },
        path: ['claim_refs'],
        op: 'includes',
        value: 'C3',
      },
      {
        select: { proposal: 'P3' },
        path: ['verdict'],
        op: 'one_of',
        values: ['revise', 'reject'],
      },
    ],
  });
  const j = structuredClone(gold);
  j.reviews[2].verdict = 'reject';
  assert.equal(score(j, check), 'accepted');
});
test('selector schema rejects unsupported identities, refs, task kinds and extra keys', () => {
  for (const select of [
    { proposal: 'P6' },
    { proposal: 'P2', finding: { type: 'invented' } },
    { proposal: 'P2', finding: { type: 'duplicate', claim_ref: 'C99' } },
    { proposal: 'P2', finding: { type: 'duplicate', catalog_ref: 'K99' } },
    { proposal: 'P2', arbitrary_path: 'reviews' },
  ])
    assert.equal(
      BenchmarkCheckSchema.safeParse({
        ...c.check,
        assertions: [
          { select, path: ['verdict'], op: 'equals', value: 'stands' },
        ],
      }).success,
      false,
    );
  const propose = read('candidate_generation.json').cases[0].check;
  assert.equal(
    BenchmarkCheckSchema.safeParse({
      ...propose,
      assertions: bound.kind === 'discovery_contract' ? bound.assertions : [],
    }).success,
    false,
  );
  const absent = cases[1].check;
  assert.equal(
    BenchmarkCheckSchema.safeParse({
      ...absent,
      assertions: bound.kind === 'discovery_contract' ? bound.assertions : [],
    }).success,
    false,
  );
});
test('legacy wildcard grading and exact preserved failed output retain their original decisions', () => {
  const j = structuredClone(gold);
  [j.reviews[0].findings, j.reviews[1].findings] = [
    j.reviews[1].findings,
    j.reviews[0].findings,
  ];
  assert.equal(score(j, BenchmarkCheckSchema.parse(c.check)), 'accepted');
  const raw = JSON.parse(
    readFileSync(
      new URL(
        '../../tracking/evidence/discovery-qualification-v3/raw-results.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ).at(-1);
  const check = BenchmarkCheckSchema.parse(
    read('candidate_generation.json').cases[0].check,
  );
  assert.equal(
    score(JSON.parse(raw.outcome.text), check),
    'acceptance_check_failed',
  );
});
test('role1.4 serializes explicit field meanings across all task kinds without changing output schemas', () => {
  assert.equal(DISCOVERY_ROLE_VERSION, 'r02-discovery/1.4');
  assert.notEqual(
    DISCOVERY_PROMPT_HASH,
    '01ef4e7c37ab9c6c50abe0d4c3ef25a22484daa8d3d1490672bc60e8007c0f00',
  );
  for (const cls of ['research_synthesis', 'candidate_generation', 'scoring'])
    for (const x of read(cls + '.json').cases) {
      const ctrl = controls.find((y: any) => y.case_id === x.case_id);
      const ctx = { ...x.check.context, role_version: DISCOVERY_ROLE_VERSION };
      const text = discoveryRoleInput(
        x.check.task_kind,
        ctx,
        x.check.packet,
        ctrl.inputs,
      )[0]!.text;
      assert.deepEqual(
        JSON.parse(text.split('Output JSON Schema:\n')[1]!),
        JSON.parse(x.input[0].text.split('Output JSON Schema:\n')[1]),
      );
      if (['propose', 'revise'].includes(x.check.task_kind)) {
        assert.ok(text.includes('Return novelty:null'));
        assert.ok(text.includes('NEW/CUSTOM'));
      } else if (x.check.task_kind === 'skeptic')
        assert.ok(text.includes('observable comparison or outcome'));
      else assert.ok(text.includes('Nonempty gaps do not replace'));
    }
});
