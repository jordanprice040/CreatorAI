import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { RUBRICS, ScorecardBodySchema } from '@creator/contracts';

type Draft = {
  ratings: Record<
    string,
    { rating: string; evidence: string[]; rationale: string }
  >;
  confidence: { level: string; rationale: string };
  influence: { rating: string; note: string };
  ethics: { status: string; note: string };
  access: { status: string; note: string };
  checks: Record<string, string>;
  alternatives_checked: { name: string; checked_on: string }[];
};
type Out =
  | { body: Record<string, unknown>; errors: null }
  | { body: null; errors: Record<string, string> };
type Fields = {
  rubricsFor: (kind: string) => string[];
  emptyDraft: (
    criteria: readonly string[],
    prefill?: { target_users?: string; measurable_outcome?: string },
  ) => Draft;
  draftFromBody: (
    body: unknown,
    criteria: readonly string[],
    keepJudgments?: boolean,
  ) => Draft;
  earlierPicks: (body: unknown) => {
    ratings: Record<string, string>;
    influence: string | null;
    ethics: string;
    access: string;
    confidence: string;
  };
  draftToBody: (
    d: Draft,
    o: {
      rubric: 'opportunity' | 'suitability';
      rubricVersion: string;
      criteria: readonly string[];
      subject: { id: string; version: number };
      reviewer: string;
    },
  ) => Out;
};

// scorecard-fields.ts has no imports, so it loads without a browser or stubs.
async function load(): Promise<Fields> {
  const source = await readFile('apps/web/src/scorecard-fields.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Fields;
  new Function('exports', code)(exports);
  return exports;
}

const subject = { id: '0b5e7a52-3c8e-4a9b-9a51-1f3d7c2e9a10', version: 2 };
const claim = '7f1c2d3e-4b5a-4c6d-8e9f-0a1b2c3d4e5f@3';
const opts = (rubric: 'opportunity' | 'suitability') => ({
  rubric,
  rubricVersion: RUBRICS[rubric].version,
  criteria: RUBRICS[rubric].criteria.map((c) => c.key),
  subject,
  reviewer: 'Jordan',
});

function filled(f: Fields, rubric: 'opportunity' | 'suitability'): Draft {
  const d = f.emptyDraft(opts(rubric).criteria, { target_users: 'Gamers' });
  for (const [i, k] of Object.keys(d.ratings).entries())
    d.ratings[k] =
      i === 0
        ? { rating: 'unknown', evidence: [], rationale: 'Not enough data.' }
        : { rating: '4', evidence: [claim], rationale: 'Two sources agree.' };
  d.confidence = { level: 'medium', rationale: 'Few sources.' };
  d.influence = { rating: '3', note: 'Software helps one part.' };
  d.ethics = { status: 'clear', note: 'None found.' };
  d.access = { status: 'resolved', note: 'Works offline.' };
  for (const k of Object.keys(d.checks)) d.checks[k] ||= 'unknown';
  d.alternatives_checked = [
    { name: 'A spreadsheet', checked_on: '2026-11-02' },
  ];
  return d;
}

test('a filled form gives a scorecard the server schema accepts, for both rubrics', async () => {
  const f = await load();
  for (const rubric of ['suitability', 'opportunity'] as const) {
    const out = f.draftToBody(filled(f, rubric), opts(rubric));
    assert.equal(out.errors, null, JSON.stringify(out.errors));
    const parsed = ScorecardBodySchema.safeParse(out.body);
    assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
    assert.equal(parsed.data.reviewer.kind, 'human');
    assert.equal(
      parsed.data.software_influence === null,
      rubric !== 'suitability',
    );
    const first = Object.values(parsed.data.ratings)[0]!;
    assert.equal(first.rating, null, 'Unknown stays unknown, never a number');
  }
});

test('nothing is pre-picked: an empty form names every judgment still to make', async () => {
  const f = await load();
  const o = opts('suitability');
  const d = f.emptyDraft(o.criteria, {
    target_users: 'Gamers',
    measurable_outcome: 'Missed inputs per minute',
  });
  // Only text the discovery record states is filled in.
  assert.equal(d.checks.target_users, 'Gamers');
  assert.equal(d.checks.measurable_outcome, 'Missed inputs per minute');
  const out = f.draftToBody(d, o);
  assert.equal(out.body, null);
  for (const k of o.criteria) assert.ok(out.errors![`ratings.${k}.rating`]);
  assert.ok(out.errors!['confidence.level']);
  assert.ok(out.errors!['ethics.status']);
  assert.ok(out.errors!['access.status']);
  assert.ok(out.errors!['influence.rating']);
});

test('a rating without evidence is refused before it reaches the server', async () => {
  const f = await load();
  const d = filled(f, 'opportunity');
  const k = Object.keys(d.ratings)[1]!;
  d.ratings[k]!.evidence = [];
  const out = f.draftToBody(d, opts('opportunity'));
  assert.match(out.errors![`ratings.${k}.evidence`]!, /needs evidence/);
});

test('revising starts from the stored card and round-trips it unchanged', async () => {
  const f = await load();
  const o = opts('suitability');
  const first = f.draftToBody(filled(f, 'suitability'), o);
  const again = f.draftToBody(f.draftFromBody(first.body, o.criteria), o);
  assert.deepEqual(again.body, first.body);
});

test('only software kinds are offered the opportunity rubric', async () => {
  const f = await load();
  assert.deepEqual(f.rubricsFor('build'), ['suitability', 'opportunity']);
  assert.deepEqual(f.rubricsFor('hybrid'), ['suitability', 'opportunity']);
  assert.deepEqual(f.rubricsFor('process_change'), ['suitability']);
});

test('a card of an older option version keeps its text but every judgment is picked again (review M-1)', async () => {
  const f = await load();
  const o = opts('suitability');
  const first = f.draftToBody(filled(f, 'suitability'), o);
  const d = f.draftFromBody(first.body, o.criteria, false);
  for (const k of o.criteria) {
    assert.equal(d.ratings[k]!.rating, '');
    assert.ok(d.ratings[k]!.rationale, 'reasons stay as a start');
  }
  assert.equal(d.influence.rating, '');
  assert.equal(d.ethics.status, '');
  assert.equal(d.access.status, '');
  assert.equal(d.confidence.level, '');
  assert.deepEqual(d.ratings[o.criteria[1]!]!.evidence, [claim]);
  // Saving it as it stands is refused: nothing carries over without a fresh pick.
  const out = f.draftToBody(d, { ...o, subject: { ...subject, version: 3 } });
  assert.equal(out.body, null);
  assert.ok(out.errors!['ethics.status']);
  assert.ok(out.errors!['confidence.level']);
  const was = f.earlierPicks(first.body);
  assert.equal(was.ratings[o.criteria[0]!], 'Unknown');
  assert.equal(was.ratings[o.criteria[1]!], '4');
  assert.equal(was.ethics, 'clear');
});
