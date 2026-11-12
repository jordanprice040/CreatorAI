import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// ADR-0091: the rules behind "Link claims" suggestions and the range explanation
// (apps/web/src/claim-suggest.ts has no imports, so it loads directly).

type Claim = { id: string; title: string; text: string };
type Mod = {
  terms(text: string): string[];
  suggestClaims(
    target: { title: string },
    claims: Claim[],
    linked?: Set<string>,
    max?: number,
  ): Claim[];
  matchesFilter(c: Claim, filter: string): boolean;
  rangeEnds(
    cards: {
      id: string;
      lower: number;
      upper: number;
      unknown: number;
      counted: boolean;
    }[],
  ): {
    low: { id: string; unknown: number }[];
    high: { id: string; unknown: number }[];
  };
};
async function rules(): Promise<Mod> {
  const source = await readFile('apps/web/src/claim-suggest.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Mod;
  new Function('exports', code)(exports);
  return exports;
}

// The CSV problem on the dev studio, in miniature: every claim mentions CSV files.
const claims: Claim[] = [
  {
    id: 'a',
    title: 'GX Core installs with pip',
    text: 'Great Expectations (GX Core) installs with pip on Python 3.10 to 3.14 and validates CSV files.',
  },
  {
    id: 'b',
    title: 'ydata-profiling report',
    text: 'ydata-profiling builds a report from a pandas DataFrame read from CSV files.',
  },
  {
    id: 'c',
    title: 'OpenRefine needs Java',
    text: 'OpenRefine runs a local server and needs Java to clean CSV files.',
  },
  {
    id: 'd',
    title: 'csvstat per-column statistics',
    text: 'csvkit csvstat prints per-column statistics for CSV files.',
  },
];

test('suggestions match the option by name; words every claim shares count for nothing', async () => {
  const m = await rules();
  assert.deepEqual(
    m
      .suggestClaims(
        { title: 'Validate CSV files with Great Expectations' },
        claims,
      )
      .map((c) => c.id),
    ['a'],
  );
  assert.deepEqual(
    m
      .suggestClaims({ title: 'Profile with ydata-profiling' }, claims)
      .map((c) => c.id),
    ['b'],
  );
  assert.deepEqual(
    m
      .suggestClaims({ title: 'Summarise columns with csvkit' }, claims)
      .map((c) => c.id),
    ['d'],
  );
  // "CSV files" is in every claim, so it suggests nothing on its own.
  assert.deepEqual(m.suggestClaims({ title: 'Handle CSV files' }, claims), []);
  // An already-linked claim is not suggested again (ids compared in lower case).
  assert.deepEqual(
    m.suggestClaims(
      { title: 'Validate with Great Expectations' },
      claims.map((c) => ({ ...c, id: c.id.toUpperCase() })),
      new Set(['a']),
    ),
    [],
  );
  assert.ok(m.matchesFilter(claims[2]!, 'java  openrefine'));
  assert.ok(!m.matchesFilter(claims[2]!, 'java pip'));
});

test('the range explanation names the counted card behind each end, with its unknowns', async () => {
  const m = await rules();
  // csvkit on the dev studio: the owner's card 54.2–70.8, the model's 20.8–70.8 (5 unknowns).
  const ends = m.rangeEnds([
    { id: 'owner', lower: 54.2, upper: 70.8, unknown: 2, counted: true },
    { id: 'model', lower: 20.8, upper: 70.8, unknown: 5, counted: true },
    { id: 'stale', lower: 0, upper: 100, unknown: 8, counted: false },
  ]);
  assert.deepEqual(ends.low, [{ id: 'model', unknown: 5 }]);
  assert.deepEqual(ends.high, [
    { id: 'owner', unknown: 2 },
    { id: 'model', unknown: 5 },
  ]);
  assert.deepEqual(
    m.rangeEnds([{ id: 'x', lower: 0, upper: 1, unknown: 1, counted: false }]),
    {
      low: [],
      high: [],
    },
  );
});
