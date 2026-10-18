import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  OPPORTUNITY_RUBRIC,
  SUITABILITY_RUBRIC,
  type ScorecardBody,
  type SpecContent,
} from '@creator/contracts';
import {
  FIXTURE_SPEC,
  checkSelection,
  displayScore,
  fixtureScorecards,
  scoreRatings,
  selectionReport,
  taskHashes,
  taskImpact,
  validateSpec,
  type CandidateInput,
} from '@creator/domain';

const ev = [{ id: randomUUID(), version: 1 }];
const all = (keys: readonly { key: string }[], r: number | null) =>
  Object.fromEntries(keys.map((k) => [k.key, r]));

test('score formula is exact, displayed once, and never renormalizes around unknowns', () => {
  const o = OPPORTUNITY_RUBRIC;
  assert.deepEqual(scoreRatings(o, all(o.criteria, 5)), { n: 100n, d: 1n });
  assert.deepEqual(scoreRatings(o, all(o.criteria, 1)), { n: 0n, d: 1n });
  // 100 × (2+3+3+2+2+2) / 24 = 175/3
  const r = {
    urgency: 3,
    benefit: 4,
    software_influence: 4,
    feasibility: 3,
    differentiation: 3,
    evidence_quality: 3,
  };
  assert.deepEqual(scoreRatings(o, r), { n: 175n, d: 3n });
  assert.equal(displayScore({ n: 175n, d: 3n }), '58.3');
  assert.equal(displayScore({ n: 225n, d: 4n }), '56.3');
  assert.equal(displayScore({ n: 0n, d: 1n }), '0.0');
  assert.equal(displayScore({ n: 100n, d: 1n }), '100.0');
  // One unknown: no score (not the average of the other five), bounds at 1 and 5.
  const partial = { ...r, differentiation: null };
  assert.equal(scoreRatings(o, partial), null);
  assert.deepEqual(scoreRatings(o, partial, undefined, 1), { n: 50n, d: 1n });
  assert.deepEqual(scoreRatings(o, partial, undefined, 5), { n: 200n, d: 3n });
  // Weights are relative integers; doubling one criterion changes the result exactly.
  assert.deepEqual(scoreRatings(o, r, { ...o.weights, benefit: 2 }), {
    n: 425n,
    d: 7n,
  });
});

function candidate(
  kind: string,
  cards: Record<string, number | null>[],
  rubric: 'opportunity' | 'suitability' = 'suitability',
): CandidateInput {
  const id = randomUUID();
  const base = fixtureScorecards([{ id, version: 1, kind: 'build' }], ev).find(
    (c) => c.body.rubric === rubric,
  )!.body;
  return {
    alternative: { id, version: 1, kind, title: `${kind} ${id.slice(0, 4)}` },
    scorecards: cards.map((ratings) => ({
      id: randomUUID(),
      version: 1,
      status: 'active',
      body: {
        ...base,
        software_influence:
          rubric === 'suitability' ? base.software_influence : null,
        ratings: Object.fromEntries(
          Object.entries(ratings).map(([k, v]) => [
            k,
            v === null
              ? { rating: null, evidence_refs: [], rationale: 'Unknown.' }
              : { rating: v, evidence_refs: ev, rationale: 'Rated.' },
          ]),
        ),
      } satisfies ScorecardBody,
    })),
    discovery: null,
    humility: kind === 'build' ? 'passing' : 'not_applicable',
    humility_reasons: [],
  };
}
const suit = (
  values: [number, number, number, number, number, number],
): Record<string, number> =>
  Object.fromEntries(
    SUITABILITY_RUBRIC.criteria.map((c, i) => [c.key, values[i]!]),
  );

test('sensitivity reports a top change when one weight decides the order', () => {
  // A leads on problem fit only; B is a little better elsewhere. Equal weights: A wins.
  const a = candidate('use_existing', [suit([5, 3, 3, 3, 3, 3])]);
  const b = candidate('human_led', [suit([1, 4, 4, 3, 3, 3])]);
  const c = candidate('change_process', [suit([1, 1, 1, 1, 1, 1])]);
  const r = selectionReport({
    problem: { id: randomUUID(), version: 1, title: 'P' },
    candidates: [a, b, c],
    shortlist_size: 1,
  });
  const s = r.suitability.sensitivity;
  assert.deepEqual(s.baseline, [a.alternative.id]);
  const without = s.scenarios.find((x) => x.name === 'without problem_fit')!;
  assert.equal(without.top_changed, true);
  assert.deepEqual(without.shortlist, [b.alternative.id]);
  assert.equal(s.stable, false);
  // The report is a pure function of its inputs.
  assert.equal(
    selectionReport({
      problem: r.problem,
      candidates: [c, b, a],
      shortlist_size: 1,
    }).report_hash,
    r.report_hash,
  );
});

test('stale scorecards are listed but not counted; an advanced peer is not an override', () => {
  const a = candidate('use_existing', [suit([5, 5, 5, 5, 5, 5])]);
  const b = candidate('human_led', [suit([3, 3, 3, 3, 3, 3])]);
  const moved = { ...b, alternative: { ...b.alternative, version: 2 } };
  const r = selectionReport({
    problem: { id: randomUUID(), version: 1, title: 'P' },
    candidates: [a, moved],
    shortlist_size: 3,
  });
  const row = r.suitability.candidates.find(
    (x) => x.alternative.id === b.alternative.id,
  )!;
  assert.equal(row.status, 'unscored');
  assert.equal(row.scorecards[0]!.stale, true);
  assert.equal(row.gates.ethics_access, 'not_assessed');
  // Advancing the lower-ranked candidate is an override unless the leader advances too.
  const d = (
    id: string,
    disposition: 'recommend_alternative' | 'defer' | 'reject',
  ) => ({
    alternative: { id, version: id === b.alternative.id ? 2 : 1 },
    disposition,
    reasons: ['x'],
    reverse_if: 'y',
  });
  const r2 = selectionReport({
    problem: r.problem,
    candidates: [a, candidate('human_led', [suit([3, 3, 3, 3, 3, 3])])],
    shortlist_size: 3,
  });
  const [lead, second] = r2.suitability.candidates;
  const over = checkSelection(r2, {
    dispositions: [
      d(lead!.alternative.id, 'defer'),
      {
        ...d(second!.alternative.id, 'recommend_alternative'),
        alternative: { id: second!.alternative.id, version: 1 },
      },
    ],
    override_reason: null,
  });
  assert.equal(over.override_reason_missing, true);
  assert.equal(over.overrides[0]!.outranked_by[0]!.id, lead!.alternative.id);
  const both = checkSelection(r2, {
    dispositions: [
      d(lead!.alternative.id, 'recommend_alternative'),
      {
        ...d(second!.alternative.id, 'recommend_alternative'),
        alternative: { id: second!.alternative.id, version: 1 },
      },
    ],
    override_reason: null,
  });
  assert.deepEqual(both.overrides, []);
  assert.deepEqual(both.blocked, []);
});

const spec = (tasks: SpecContent['tasks']): SpecContent => ({
  ...FIXTURE_SPEC,
  tasks,
});
const task = (
  key: string,
  depends_on: string[],
  file_scope: string[],
  acceptance = ['A1', 'A2', 'A3', 'A4'],
): SpecContent['tasks'][number] => ({
  key,
  title: key,
  role: 'builder',
  file_scope,
  depends_on,
  acceptance,
  deliverable: key,
});

test('task graph checks: cycles, unknown references, coverage and parallel ownership', () => {
  assert.deepEqual(validateSpec(FIXTURE_SPEC), []);
  const codes = (s: SpecContent) =>
    validateSpec(s)
      .map((p) => p.code)
      .sort();
  assert.deepEqual(
    codes(spec([task('T1', ['T2'], ['a']), task('T2', ['T1'], ['b'])])),
    ['cycle'],
  );
  assert.deepEqual(codes(spec([task('T1', ['T9'], ['a'])])), [
    'unknown_dependency',
  ]);
  assert.deepEqual(codes(spec([task('T1', [], ['a'], ['A1', 'A2', 'A3'])])), [
    'uncovered_check',
  ]);
  // A path covers what is beneath it; ordered tasks may share it, parallel ones may not.
  assert.deepEqual(
    codes(spec([task('T1', [], ['src']), task('T2', [], ['src/web'])])),
    ['ownership_conflict'],
  );
  assert.deepEqual(
    codes(spec([task('T1', [], ['src']), task('T2', ['T1'], ['src/web'])])),
    [],
  );
  assert.deepEqual(
    codes(spec([task('T1', [], ['src/web']), task('T2', [], ['src/webapp'])])),
    [],
  );
});

test('task hashes follow content and dependencies, not array order', () => {
  const h = taskHashes(FIXTURE_SPEC);
  assert.deepEqual(
    taskHashes({ ...FIXTURE_SPEC, tasks: [...FIXTURE_SPEC.tasks].reverse() }),
    h,
  );
  // Rewording a check changes only the tasks that deliver it (and their dependants).
  const reworded = {
    ...FIXTURE_SPEC,
    acceptance_checks: FIXTURE_SPEC.acceptance_checks.map((a) =>
      a.key === 'A1' ? { ...a, statement: `${a.statement} Exactly.` } : a,
    ),
  };
  const impact = taskImpact(reworded, h);
  assert.deepEqual(
    impact.tasks.map((t) => [t.key, t.status]),
    [
      ['T1', 'changed'],
      ['T2', 'changed'],
      ['T3', 'changed'],
      ['T4', 'changed'],
    ],
  );
  const dropT4 = taskImpact(
    { ...FIXTURE_SPEC, tasks: FIXTURE_SPEC.tasks.slice(0, 3) },
    h,
  );
  assert.deepEqual(dropT4.removed, ['T4']);
  assert.ok(dropT4.tasks.every((t) => t.status === 'frozen'));
});
