import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// Step 9: decisions survive score changes, with only changed options flagged. The module
// has no imports, so it loads directly.
async function load<T>(file: string) {
  const source = await readFile(`apps/web/src/${file}`, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as T;
  new Function('exports', code)(exports);
  return exports;
}

type Score = { numerator: string; denominator: string; display: string };
type Candidate = {
  alternative: { id: string; version: number };
  status: string;
  score: Score | null;
  range: { lower: Score; upper: Score } | null;
  rank: number | null;
  gates: {
    ethics_access: string;
    discovery: string | null;
    humility: string;
    blocked: Partial<Record<string, string[]>>;
  };
};
type Report = {
  problem: { id: string; version: number };
  opportunity: { candidates: Candidate[] };
  suitability: { candidates: Candidate[] };
  report_hash: string;
};
type Option = {
  status: string;
  row: {
    disposition: string;
    reasons: string;
    reverse_if: string;
    reasons_list?: string[];
  };
  changes: string[];
  notes: string[];
};
type Carried = {
  from: string | null;
  same_report: boolean;
  problem_version_changed: boolean;
  options: Record<string, Option>;
  rationale: string;
  override_reason: string;
  dropped: number;
};
type Mod = {
  carryDecisions: (
    previous: unknown,
    report: Report,
    alternatives: { id: string; version: number }[],
  ) => Carried;
  needsReview: (c: Carried) => string[];
  rowReasons: (r: Option['row']) => string[];
  formGate: (
    c: Carried,
    previous: unknown,
    report: Report,
    state: {
      edited: string[];
      dispositions: Record<string, string>;
      rationale_edited: boolean;
      override_edited: boolean;
      problem_confirmed: boolean;
    },
  ) => {
    unreviewed: string[];
    unchanged: boolean;
    override_review: boolean;
    problem_review: boolean;
  };
};

const A = 'aaaaaaaa-0000-4000-8000-000000000001';
const B = 'bbbbbbbb-0000-4000-8000-000000000002';
const C = 'cccccccc-0000-4000-8000-000000000003';
const NEW = 'dddddddd-0000-4000-8000-000000000004';

const s = (n: number, d = 1): Score => ({
  numerator: String(n),
  denominator: String(d),
  display: (n / d).toFixed(1),
});
function cand(
  id: string,
  score: Score | null,
  rank: number | null,
  extra: Partial<Candidate> = {},
): Candidate {
  return {
    alternative: { id, version: 1 },
    status: score ? 'complete' : 'unscored',
    score,
    range: score ? { lower: score, upper: score } : null,
    rank,
    gates: {
      ethics_access: 'clear',
      discovery: 'candidate',
      humility: 'passing',
      blocked: {},
    },
    ...extra,
  };
}
function report(
  hash: string,
  suit: Candidate[],
  opp: Candidate[] = suit,
): Report {
  return {
    problem: { id: 'eeeeeeee-0000-4000-8000-000000000005', version: 1 },
    suitability: { candidates: suit },
    opportunity: { candidates: opp },
    report_hash: hash.repeat(64).slice(0, 64),
  };
}
const before = report('a', [
  cand(A, s(60), 1),
  cand(B, s(50), 2),
  cand(C, s(40), 3),
]);
const decided = {
  id: 'ffffffff-0000-4000-8000-000000000006',
  report: before,
  dispositions: [
    {
      alternative: { id: A, version: 1 },
      disposition: 'select_for_build',
      reasons: ['best fit'],
      reverse_if: 'fit drops',
    },
    {
      alternative: { id: B, version: 1 },
      disposition: 'defer',
      reasons: ['later'],
      reverse_if: 'cheaper',
    },
    {
      alternative: { id: C, version: 1 },
      disposition: 'reject',
      reasons: ['weak'],
      reverse_if: 'new evidence',
    },
  ],
  rationale: 'Build A first.',
  overrides: [],
  override_reason: null,
};
const alts = (ids: string[], versions: Record<string, number> = {}) =>
  ids.map((id) => ({ id, version: versions[id] ?? 1 }));

test('a changed score flags only that option and keeps every decision', async () => {
  const { carryDecisions, needsReview } = await load<Mod>('carry-decisions.ts');
  // C's score moves; A and B are untouched.
  const after = report('b', [
    cand(A, s(60), 1),
    cand(B, s(50), 2),
    cand(C, s(45), 3),
  ]);
  const c = carryDecisions(decided, after, alts([A, B, C]));
  assert.equal(c.same_report, false);
  assert.deepEqual(needsReview(c), [C]);
  assert.equal(c.options[A]!.status, 'kept');
  assert.equal(c.options[B]!.status, 'kept');
  assert.equal(c.options[C]!.status, 'changed');
  assert.match(c.options[C]!.changes.join(), /Suitability 40\.0 → 45\.0/);
  // Every row keeps the earlier disposition and its words, the changed one included.
  assert.deepEqual(c.options[A]!.row, {
    disposition: 'select_for_build',
    reasons: 'best fit',
    reverse_if: 'fit drops',
    reasons_list: ['best fit'],
  });
  assert.equal(c.options[C]!.row.disposition, 'reject');
  assert.equal(c.rationale, 'Build A first.');
});

test('a rank moved only by another option is a note, not a review flag', async () => {
  const { carryDecisions, needsReview } = await load<Mod>('carry-decisions.ts');
  // C jumps above B; B's own score is unchanged.
  const after = report('c', [
    cand(A, s(60), 1),
    cand(B, s(50), 3),
    cand(C, s(55), 2),
  ]);
  const c = carryDecisions(decided, after, alts([A, B, C]));
  assert.deepEqual(needsReview(c), [C]);
  assert.equal(c.options[B]!.status, 'kept');
  assert.match(c.options[B]!.notes.join(), /rank 2 → 3/);
});

test('equal exact fractions are not a change', async () => {
  const { carryDecisions, needsReview } = await load<Mod>('carry-decisions.ts');
  const after = report('d', [
    cand(A, s(120, 2), 1),
    cand(B, s(50), 2),
    cand(C, s(40), 3),
  ]);
  assert.deepEqual(
    needsReview(carryDecisions(decided, after, alts([A, B, C]))),
    [],
  );
});

test('gate changes and revised options are flagged', async () => {
  const { carryDecisions, needsReview } = await load<Mod>('carry-decisions.ts');
  const after = report('e', [
    cand(A, s(60), 1),
    cand(B, s(50), 2, {
      gates: {
        ethics_access: 'unresolved',
        discovery: 'candidate',
        humility: 'passing',
        blocked: {},
      },
    }),
    cand(C, s(40), 3, { alternative: { id: C, version: 2 } }),
  ]);
  const c = carryDecisions(decided, after, alts([A, B, C], { [C]: 2 }));
  assert.deepEqual(needsReview(c).sort(), [B, C].sort());
  assert.match(
    c.options[B]!.changes.join(),
    /Ethics and access clear → unresolved/,
  );
  assert.match(c.options[C]!.changes.join(), /version 1 → 2/);
});

test('a disposition the new report blocks is cleared, keeping its reasons', async () => {
  const { carryDecisions, needsReview } = await load<Mod>('carry-decisions.ts');
  const after = report('f', [
    cand(A, s(60), 1, {
      gates: {
        ethics_access: 'clear',
        discovery: 'candidate',
        humility: 'missing',
        blocked: { select_for_build: ['No humility review.'] },
      },
    }),
    cand(B, s(50), 2),
    cand(C, s(40), 3),
  ]);
  const c = carryDecisions(decided, after, alts([A, B, C]));
  assert.equal(c.options[A]!.status, 'blocked');
  assert.equal(c.options[A]!.row.disposition, '');
  assert.equal(c.options[A]!.row.reasons, 'best fit');
  assert.match(c.options[A]!.changes.join(), /now blocked: No humility review/);
  assert.deepEqual(needsReview(c), [A]);
});

test('new options start blank and removed ones are counted', async () => {
  const { carryDecisions, needsReview } = await load<Mod>('carry-decisions.ts');
  const after = report('g', [
    cand(A, s(60), 1),
    cand(B, s(50), 2),
    cand(NEW, null, null),
  ]);
  const c = carryDecisions(decided, after, alts([A, B, NEW]));
  assert.equal(c.options[NEW]!.status, 'new');
  assert.equal(c.options[NEW]!.row.disposition, '');
  assert.equal(c.dropped, 1);
  // A new option is decided from scratch; it is not one of the review flags.
  assert.deepEqual(needsReview(c), []);
});

test('the same report carries everything with nothing flagged; no selection means all new', async () => {
  const { carryDecisions, needsReview } = await load<Mod>('carry-decisions.ts');
  const same = carryDecisions(decided, before, alts([A, B, C]));
  assert.equal(same.same_report, true);
  assert.deepEqual(needsReview(same), []);
  assert.equal(same.options[B]!.row.disposition, 'defer');
  const none = carryDecisions(null, before, alts([A, B, C]));
  assert.equal(none.from, null);
  assert.ok(
    Object.values(none.options).every(
      (o) => o.status === 'new' && o.row.disposition === '',
    ),
  );
});

// Review fixes (PR #95 review M-1, M-2, L-1, L-2, L-3).

/** B ranks above A; the owner advanced A over B with a reason that names only B. */
const overridden = {
  id: 'ffffffff-0000-4000-8000-000000000007',
  report: report('h', [
    cand(B, s(60), 1),
    cand(A, s(50), 2),
    cand(C, s(40), 3),
  ]),
  dispositions: [
    {
      alternative: { id: A, version: 1 },
      disposition: 'proceed_to_validation',
      reasons: ['cheaper'],
      reverse_if: 'cost rises',
    },
    {
      alternative: { id: B, version: 1 },
      disposition: 'reject',
      reasons: ['costly'],
      reverse_if: 'funded',
    },
    {
      alternative: { id: C, version: 1 },
      disposition: 'reject',
      reasons: ['weak'],
      reverse_if: 'new evidence',
    },
  ],
  overrides: [
    { alternative: A, ranking: 'suitability', outranked_by: [{ id: B }] },
  ],
  rationale: 'Validate A.',
  override_reason: 'A is cheaper than B.',
};
const state = (over: Partial<Parameters<Mod['formGate']>[3]> = {}) => ({
  edited: [],
  dispositions: { [A]: 'proceed_to_validation', [B]: 'reject', [C]: 'reject' },
  rationale_edited: false,
  override_edited: false,
  problem_confirmed: false,
  ...over,
});

test('M-1: an advanced option newly outranked is flagged and the override reason needs review', async () => {
  const { carryDecisions, needsReview, formGate } =
    await load<Mod>('carry-decisions.ts');
  // C rises above both; A's own score did not change.
  const after = report('i', [
    cand(C, s(70), 1),
    cand(B, s(60), 2),
    cand(A, s(50), 3),
  ]);
  const c = carryDecisions(overridden, after, alts([A, B, C]));
  assert.equal(c.options[A]!.status, 'changed');
  assert.match(
    c.options[A]!.changes.join(),
    /override reason needs a fresh look/,
  );
  assert.ok(needsReview(c).includes(A));
  const g = formGate(c, overridden, after, state({ edited: [A, C] }));
  assert.equal(g.override_review, true);
  // Confirming or rewriting the reason clears it.
  assert.equal(
    formGate(
      c,
      overridden,
      after,
      state({ edited: [A, C], override_edited: true }),
    ).override_review,
    false,
  );
  // The same override set on a changed report needs no fresh reason.
  const same = report('j', [
    cand(B, s(61), 1),
    cand(A, s(50), 2),
    cand(C, s(40), 3),
  ]);
  const c2 = carryDecisions(overridden, same, alts([A, B, C]));
  assert.equal(c2.options[A]!.status, 'kept');
  assert.equal(
    formGate(c2, overridden, same, state({ edited: [B] })).override_review,
    false,
  );
});

test('M-2: a discovery gate change is flagged even when nothing is blocked', async () => {
  const { carryDecisions, needsReview } = await load<Mod>('carry-decisions.ts');
  const after = report('k', [
    cand(A, s(60), 1, {
      gates: {
        ethics_access: 'clear',
        discovery: 'needs_research',
        humility: 'passing',
        blocked: {},
      },
    }),
    cand(B, s(50), 2),
    cand(C, s(40), 3),
  ]);
  const c = carryDecisions(decided, after, alts([A, B, C]));
  assert.deepEqual(needsReview(c), [A]);
  assert.match(
    c.options[A]!.changes.join(),
    /Discovery candidate → needs research/,
  );
});

test('L-2: untouched multi-reason rows submit their list, edited ones the text', async () => {
  const { carryDecisions, rowReasons } = await load<Mod>('carry-decisions.ts');
  const long = 'x'.repeat(300);
  const prev = {
    ...decided,
    dispositions: decided.dispositions.map((d, i) =>
      i === 0 ? { ...d, reasons: [long, long] } : d,
    ),
  };
  const row = carryDecisions(prev, before, alts([A, B, C])).options[A]!.row;
  assert.deepEqual(rowReasons(row), [long, long]);
  assert.deepEqual(rowReasons({ ...row, reasons: 'shorter now' }), [
    'shorter now',
  ]);
});

test('L-1, L-3: the form gate needs every flag reviewed, refuses a duplicate, and asks about a revised problem', async () => {
  const { carryDecisions, formGate } = await load<Mod>('carry-decisions.ts');
  const after = report('l', [
    cand(A, s(60), 1),
    cand(B, s(50), 2),
    cand(C, s(45), 3),
  ]);
  const c = carryDecisions(decided, after, alts([A, B, C]));
  const dispositions = { [A]: 'select_for_build', [B]: 'defer', [C]: 'reject' };
  assert.deepEqual(
    formGate(c, decided, after, state({ dispositions })).unreviewed,
    [C],
  );
  assert.deepEqual(
    formGate(c, decided, after, state({ dispositions, edited: [C] }))
      .unreviewed,
    [],
  );
  assert.equal(
    formGate(c, decided, after, state({ dispositions })).unchanged,
    false,
  );
  // Same report, nothing touched: a duplicate. Any edit makes it a new decision.
  const same = carryDecisions(decided, before, alts([A, B, C]));
  assert.equal(
    formGate(same, decided, before, state({ dispositions })).unchanged,
    true,
  );
  assert.equal(
    formGate(
      same,
      decided,
      before,
      state({ dispositions, rationale_edited: true }),
    ).unchanged,
    false,
  );
  // A revised problem asks for confirmation even when no option changed.
  const revised = {
    ...before,
    problem: { ...before.problem, version: 2 },
    report_hash: 'm'.repeat(64),
  };
  const r = carryDecisions(decided, revised, alts([A, B, C]));
  assert.equal(
    formGate(r, decided, revised, state({ dispositions })).problem_review,
    true,
  );
  assert.equal(
    formGate(
      r,
      decided,
      revised,
      state({ dispositions, problem_confirmed: true }),
    ).problem_review,
    false,
  );
});
