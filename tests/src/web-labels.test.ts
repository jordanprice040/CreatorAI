import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

type Labels = {
  clipText: (text: string, max: number) => string;
  splitTitle: (title: string) => { theme: string; own: string };
  recordLabel: (
    r: { title: string; created_at: string; version?: number },
    max?: number,
  ) => string;
  runName: (id: string, names: ReadonlyMap<string, string>) => string;
  runLabel: (
    run: { run_id: string; created_at: string; autonomy_mode: string },
    names: ReadonlyMap<string, string>,
    max?: number,
  ) => string;
  groupByTheme: <T extends { title: string }>(
    list: readonly T[],
  ) => { theme: string; items: T[] }[];
  distinctLabels: <T extends { id: string }>(
    list: readonly T[],
    label: (r: T) => string,
  ) => Map<string, string>;
};

// labels.ts has no imports, so it loads without a browser or stubs.
async function labels(): Promise<Labels> {
  const source = await readFile('apps/web/src/labels.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Labels;
  new Function('exports', code)(exports);
  return exports;
}

// The pilot's three problems (Jordan's Nov 1 screenshot): identical for their first 90
// characters, so the old labels read the same.
const THEME =
  'Practicing frame-precise keyboard and mouse input timing for speedrunners and competitive gamers';
const pilot = [
  {
    id: 'a1111111-0000-4000-8000-000000000001',
    title: `${THEME}: Candidate observation: repeated inputs fall outside a specified target window, while available practice feedback fails to reveal signed timing error`,
    created_at: '2026-10-30T15:12:00Z',
  },
  {
    id: 'b2222222-0000-4000-8000-000000000002',
    title: `${THEME}: For one defined technique, record repeated misses relative to a verified target window and whether existing feedback reveals signed error`,
    created_at: '2026-10-30T16:40:00Z',
  },
  {
    id: 'c3333333-0000-4000-8000-000000000003',
    title: `${THEME}: For a defined technique, repeated inputs fall outside a verified target window and available feedback fails to expose signed timing error`,
    created_at: '2026-10-31T09:05:00Z',
  },
];

test('look-alike problem titles get labels that lead with what differs', async () => {
  const l = await labels();
  const split = l.splitTitle(pilot[0]!.title);
  assert.equal(split.theme, THEME);
  // The repeated "Candidate observation:" lead-in is dropped too.
  assert.match(split.own, /^Repeated inputs fall outside/);
  const shown = pilot.map((p) => l.recordLabel(p));
  assert.equal(new Set(shown).size, 3, 'all three read differently');
  for (const s of shown) {
    assert.ok(!s.startsWith('Practicing'), s);
    assert.ok(s.length <= 64 + 30, `short enough: ${s}`);
  }
  assert.match(shown[1]!, /^For one defined technique/);
  // A title without a theme stays whole, and a one-word tag is not a theme.
  assert.deepEqual(l.splitTitle('E-books'), { theme: '', own: 'E-books' });
  assert.equal(l.splitTitle('Discovery: speedrun timing practice').theme, '');
  // A revised record shows its version; a first version does not.
  assert.match(l.recordLabel({ ...pilot[0]!, version: 3 }), / · v3$/);
  assert.doesNotMatch(l.recordLabel({ ...pilot[0]!, version: 1 }), / · v1$/);
});

test('records group under their theme in list order', async () => {
  const l = await labels();
  const other = {
    id: 'd4444444-0000-4000-8000-000000000004',
    title:
      'Unused first-appointment slots at rural clinics: Rural clinics recorded a 23 percent no-show rate',
    created_at: '2026-10-20T10:00:00Z',
  };
  const plain = {
    id: 'e5',
    title: 'E-books',
    created_at: '2026-10-19T10:00:00Z',
  };
  const newest = [pilot[2]!, other, pilot[1]!, plain, pilot[0]!];
  const groups = l.groupByTheme(newest);
  assert.deepEqual(
    groups.map((g) => g.theme),
    [THEME, 'Unused first-appointment slots at rural clinics', ''],
  );
  assert.deepEqual(
    groups[0]!.items.map((x) => x.id),
    [pilot[2]!.id, pilot[1]!.id, pilot[0]!.id],
    'newest first inside a group',
  );
});

test('identical labels get the short id, so no two options read the same', async () => {
  const l = await labels();
  const twins = [
    { id: 'aaaaaaaa-1', title: 'Same' },
    { id: 'bbbbbbbb-2', title: 'Same' },
    { id: 'cccccccc-3', title: 'Other' },
  ];
  const shown = l.distinctLabels(twins, (r) => r.title);
  assert.equal(shown.get('aaaaaaaa-1'), 'Same · aaaaaaaa');
  assert.equal(shown.get('bbbbbbbb-2'), 'Same · bbbbbbbb');
  assert.equal(shown.get('cccccccc-3'), 'Other');
});

test('runs are named by their discovery theme, with date and short id', async () => {
  const l = await labels();
  const names = new Map([
    ['f7f014a9-0000-4000-8000-000000000001', `Discovery: ${THEME}`],
    ['01b6c903-0000-4000-8000-000000000002', 'Evidence gathering'],
  ]);
  const run = (id: string) => ({
    run_id: id,
    created_at: '2026-10-30T15:00:00Z',
    autonomy_mode: 'human_in_loop',
  });
  const a = l.runLabel(run('f7f014a9-0000-4000-8000-000000000001'), names);
  assert.match(a, /^Practicing frame-precise .*… · .+ · f7f014a9$/);
  assert.ok(!a.includes('Discovery:'));
  assert.match(
    l.runLabel(run('01b6c903-0000-4000-8000-000000000002'), names),
    /^Evidence gathering · .+ · 01b6c903$/,
  );
  // No readable run record: the oversight mode stands in for a name.
  assert.match(
    l.runLabel(run('99999999-0000-4000-8000-000000000003'), names),
    /^Human in loop run · .+ · 99999999$/,
  );
  assert.equal(l.runName('missing', names), '');
});

test('record pickers no longer default to the problem with the most options', async () => {
  // Decide and Scores and specs used to open on the "richest" problem or the oldest one;
  // both now open on the newest (the list is sorted newest first).
  for (const file of ['compare.tsx', 'selection.tsx']) {
    const src = await readFile(`apps/web/src/${file}`, 'utf8');
    assert.doesNotMatch(src, /richestProblem/, file);
    assert.match(src, /newestFirst\(/, file);
  }
});
