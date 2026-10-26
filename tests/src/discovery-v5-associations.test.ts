import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { checkOutput } from '@creator/domain';
const root = new URL(
  '../../config/connections/benchmarks/discovery-synthetic-v5/',
  import.meta.url,
);
const read = (f: string) => JSON.parse(readFileSync(new URL(f, root), 'utf8'));
const controls = read('author-controls.json');
const score = (c: any, j: any) =>
  checkOutput(
    c.check,
    { json: j, text: JSON.stringify(j) },
    { succeeded: true, reason_code: 'ok' },
  );
test('fresh skeptic cases are order-independent but reject misplaced, detached and ambiguous findings', () => {
  for (const c of read('scoring.json').cases) {
    const gold = controls.find((x: any) => x.case_id === c.case_id).gold;
    const reversed = structuredClone(gold);
    reversed.reviews.reverse();
    for (const r of reversed.reviews) r.findings.reverse();
    assert.equal(score(c, reversed), 'accepted');
    const index = gold.reviews.findIndex((r: any) => r.findings.length);
    for (const mutate of [
      (j: any) => j.reviews[index].findings.splice(0),
      (j: any) =>
        j.reviews[index].findings.push(
          structuredClone(j.reviews[index].findings[0]),
        ),
      (j: any) => (j.reviews[index].findings[0].claim_refs = ['C1']),
    ]) {
      const j = structuredClone(gold);
      mutate(j);
      assert.notEqual(score(c, j), 'accepted');
    }
    if (gold.reviews.length > 1) {
      const wrong = structuredClone(gold);
      [wrong.reviews[0].findings, wrong.reviews[1].findings] = [
        wrong.reviews[1].findings,
        wrong.reviews[0].findings,
      ];
      assert.notEqual(score(c, wrong), 'accepted');
    }
  }
});
test('explicit novelty serialization rejects prose denial while allowing other wording and conditional software verdicts', () => {
  for (const c of read('candidate_generation.json').cases) {
    const gold = controls.find((x: any) => x.case_id === c.case_id).gold;
    const denial = { ...gold, novelty: 'No originality is established.' };
    assert.equal(score(c, denial), 'acceptance_check_failed');
    assert.equal(
      score(c, {
        ...gold,
        feasibility:
          gold.feasibility + ' No real-world benefit is established.',
      }),
      'accepted',
    );
    if (c.case_id === 'design-dev-phonetic-check')
      assert.equal(
        score(c, {
          ...gold,
          software_warranted: {
            ...gold.software_warranted,
            verdict: 'unclear',
          },
        }),
        'accepted',
      );
  }
});
test('revision coverage and narrative entailment remain disclosed substantive review requirements', () => {
  const c = read('candidate_generation.json').cases.at(-1);
  const gold = controls.find((x: any) => x.case_id === c.case_id).gold;
  assert.equal(
    score(c, { ...gold, response_to_findings: 'I read the findings.' }),
    'accepted',
  );
  for (const cls of ['research_synthesis', 'candidate_generation', 'scoring'])
    for (const x of read(cls + '.json').cases) {
      assert.equal(
        score(
          x,
          controls.find((r: any) => r.case_id === x.case_id).manual_negative,
        ),
        'accepted',
      );
    }
});
