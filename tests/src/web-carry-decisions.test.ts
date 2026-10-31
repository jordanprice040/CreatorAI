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
  row: { disposition: string; reasons: string; reverse_if: string };
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
    gates: { ethics_access: 'clear', humility: 'passing', blocked: {} },
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
      gates: { ethics_access: 'unresolved', humility: 'passing', blocked: {} },
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
