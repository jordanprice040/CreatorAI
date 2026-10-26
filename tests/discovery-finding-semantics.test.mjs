import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  canonicalHash,
  checkOutput,
  discoveryRoleInput,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
} from '../packages/domain/dist/index.js';

// Author-visible local calibration only; never a qualification manifest or live holdout.
const original = JSON.parse(
  readFileSync(
    new URL(
      '../config/connections/benchmarks/discovery-followup-v1/scoring.json',
      import.meta.url,
    ),
  ),
).cases[0].check;
const packet = structuredClone(original.packet);
const statements = [
  'P1 claims a guaranteed tenfold sorting speedup without any executed comparison.',
  'P2 claims its procedure is the first of its kind without a supplied originality comparison.',
  'P3 is materially equivalent to supplied catalog procedure K1.',
  'P4 requires a prohibited private measurement; no permitted test addresses that dependency.',
  'P5 produced nine errors versus two for the manual method in the supplied simulated comparison.',
];
packet.claims = packet.claims
  .slice(0, 5)
  .map((c, i) => ({
    ...c,
    statement: statements[i],
    passages: [
      {
        ...c.passages[0],
        source: `Local calibration ${i + 1}`,
        url: `https://calibration.invalid/${i + 1}`,
        quote: statements[i],
      },
    ],
  }));
packet.brief.title = 'Author-visible local finding calibration';
packet.brief.body.measurable_problem =
  'Compare five synthetic sorting procedures; no real measurements or live calls.';
packet.brief.content_hash = canonicalHash(packet.brief.body);
packet.catalog[0].title = 'Existing sorting procedure';
packet.catalog[0].summary = 'Materially equivalent to P3, not P2.';
const context = {
  ...structuredClone(original.context),
  role_version: DISCOVERY_ROLE_VERSION,
  packet_hash: canonicalHash(packet),
  catalog_matches: [{ proposal: 'P3', catalog: 'K1', similarity: 1 }],
};
const comparison =
  'Compare one supplied mock batch with the manual method on paper; if errors are not fewer or total effort is higher, retain the manual method. This test is proposed, not executed.';
const types = [
  'weak_evidence',
  'novelty_overclaim',
  'duplicate',
  'infeasible_assumption',
  'counterevidence',
];
const output = {
  summary:
    'Synthetic calibration only; preserve missing evidence, prohibited access and the adverse comparison. No test was executed.',
  reviews: types.map((type, i) => ({
    proposal: `P${i + 1}`,
    verdict: 'revise',
    findings: [
      {
        type,
        detail: statements[i],
        claim_refs: [`C${i + 1}`],
        catalog_ref: i === 2 ? 'K1' : null,
      },
    ],
    cheaper_test: i === 3 ? null : comparison,
  })),
};
const assertions = types.map((type, i) => ({
  select: {
    proposal: `P${i + 1}`,
    finding: {
      type,
      catalog_ref: i === 2 ? 'K1' : null,
      claim_ref: `C${i + 1}`,
    },
  },
  path: ['claim_refs'],
  op: 'includes',
  value: `C${i + 1}`,
}));
assertions.push({
  select: { proposal: 'P1' },
  path: ['cheaper_test'],
  op: 'equals',
  value: comparison,
});
assertions.push({
  select: { proposal: 'P4' },
  path: ['cheaper_test'],
  op: 'equals',
  value: null,
});
const check = {
  kind: 'discovery_contract',
  task_kind: 'skeptic',
  packet,
  context,
  assertions,
};
const score = (j) =>
  checkOutput(
    check,
    { json: j, text: JSON.stringify(j) },
    { succeeded: true, reason_code: 'ok' },
  );
const mutate = (f) => {
  const j = structuredClone(output);
  f(j);
  return score(j);
};

test('actual rendered skeptic prompt publishes v1.4 definitions and unchanged JSON schema', () => {
  assert.equal(DISCOVERY_ROLE_VERSION, 'r02-discovery/1.4');
  assert.notEqual(
    DISCOVERY_PROMPT_HASH,
    '024648aca2bf927cff58d166ab957ddaecf47b2608d4bc9f0decd9b3561faf77',
  );
  const text = discoveryRoleInput('skeptic', context, packet, [])[0].text;
  for (const phrase of [
    'Finding semantics v1.4',
    'an efficacy claim alone is not a novelty claim',
    'reviews[].cheaper_test is the authoritative',
    'legacy findings[].type=cheaper_test remains permitted but optional',
    'cannot replace that required field',
    'Preserve adverse supplied observations',
  ])
    assert.ok(text.includes(phrase), phrase);
  assert.deepEqual(
    JSON.parse(text.split('Output JSON Schema:\n')[1]),
    JSON.parse(
      JSON.parse(
        readFileSync(
          new URL(
            '../config/connections/benchmarks/discovery-followup-v1/scoring.json',
            import.meta.url,
          ),
        ),
      ).cases[0].input[0].text.split('Output JSON Schema:\n')[1],
    ),
  );
});
test('calibration accepts distinct evidence/novelty labels and top-level test without duplicate finding', () =>
  assert.equal(score(output), 'accepted'));
test('unsupported benefit cannot satisfy the calibrated novelty distinction by relabeling', () =>
  assert.equal(
    mutate((j) => (j.reviews[0].findings[0].type = 'novelty_overclaim')),
    'acceptance_check_failed',
  ));
test('required originality finding cannot be borrowed from another proposal', () =>
  assert.equal(
    mutate(
      (j) =>
        ([j.reviews[0].findings, j.reviews[1].findings] = [
          j.reviews[1].findings,
          j.reviews[0].findings,
        ]),
    ),
    'acceptance_check_failed',
  ));
test('valid but detached source and catalog references cannot satisfy association', () => {
  assert.equal(
    mutate((j) => (j.reviews[2].findings[0].claim_refs = ['C2'])),
    'acceptance_check_failed',
  );
  assert.equal(
    mutate((j) => (j.reviews[2].findings[0].catalog_ref = null)),
    'acceptance_check_failed',
  );
});
test('forged source, omitted review and malformed field remain rejected', () => {
  assert.notEqual(
    mutate((j) => (j.reviews[0].findings[0].claim_refs = ['C99'])),
    'accepted',
  );
  assert.notEqual(
    mutate((j) => j.reviews.pop()),
    'accepted',
  );
  assert.notEqual(
    mutate((j) => (j.reviews[0].cheaper_test = [])),
    'accepted',
  );
});
test('a typed cheaper-test finding cannot replace the required authoritative field', () => {
  assert.equal(
    mutate((j) => {
      j.reviews[0].findings.push({
        type: 'cheaper_test',
        detail: comparison,
        claim_refs: ['C1'],
        catalog_ref: null,
      });
      delete j.reviews[0].cheaper_test;
    }),
    'schema_invalid',
  );
});
test('no permitted test stays null and the adverse observation stays associated', () => {
  assert.equal(
    mutate((j) => (j.reviews[3].cheaper_test = comparison)),
    'acceptance_check_failed',
  );
  assert.equal(
    mutate((j) => (j.reviews[4].findings[0].type = 'cheaper_test')),
    'acceptance_check_failed',
  );
});
test('semantic contradiction still needs substantive review; structural pass is not entailment', () => {
  const j = structuredClone(output);
  j.reviews[4].findings[0].detail =
    'P5 improved errors to one versus two; the later test already succeeded.';
  // Correct type/ref/shape cannot detect invented or reversed prose. This is a
  // disclosed negative calibration for the separate substantive reviewer.
  assert.equal(score(j), 'accepted');
});
test('new prompt identity does not match the locked historical qualification', () => {
  const old = JSON.parse(
    readFileSync(
      new URL(
        '../tracking/evidence/discovery-followup-v1/freeze.json',
        import.meta.url,
      ),
    ),
  );
  assert.notEqual(old.role_version, DISCOVERY_ROLE_VERSION);
  assert.notEqual(old.prompt_hash, DISCOVERY_PROMPT_HASH);
  // checkOutput can inspect old contexts; execution guards own candidate binding.
});
