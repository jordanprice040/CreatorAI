import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { SpecContentSchema } from '@creator/contracts';
import {
  BUILD_FIXTURE_SPEC,
  FIXTURE_SPEC,
  fixtureSpecRevision,
  validateSpec,
} from '@creator/domain';

type Draft = Record<string, any>;
type Fields = {
  emptySpecDraft: (p?: Record<string, string>) => Draft;
  emptyCase: () => Draft;
  draftFromContent: (title: string, c: unknown) => Draft;
  draftToContent: (
    d: Draft,
  ) =>
    | { title: string; content: any; errors: null }
    | { title: null; content: null; errors: Record<string, string> };
  nextKey: (p: string, used: string[], stored?: string[]) => string | null;
  unwrittenOptions: <T>(sel: T[], specs: unknown[]) => T[];
  buildNotes: (c: unknown) => string[];
};

// spec-fields.ts has no imports, so it loads without a browser or stubs.
async function load(): Promise<Fields> {
  const source = await readFile('apps/web/src/spec-fields.ts', 'utf8');
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

test('the build fixture spec round-trips through the form unchanged and stays buildable', async () => {
  const f = await load();
  const out = f.draftToContent(
    f.draftFromContent('Checklist', BUILD_FIXTURE_SPEC),
  );
  assert.equal(out.errors, null, JSON.stringify(out.errors));
  assert.deepEqual(out.content, BUILD_FIXTURE_SPEC);
  assert.ok(SpecContentSchema.safeParse(out.content).success);
  assert.deepEqual(validateSpec(out.content), []);
  assert.deepEqual(f.buildNotes(out.content), []);
});

test('a new draft starts from the record text only and names every missing part', async () => {
  const f = await load();
  const d = f.emptySpecDraft({
    title: 'Timing practice tool',
    audience: 'Rhythm game players',
    problem_statement: 'Players cannot see how early or late they press.',
  });
  assert.equal(d.audience, 'Rhythm game players');
  const out = f.draftToContent(d);
  assert.equal(out.content, null);
  for (const k of [
    'flows.0.name',
    'flows.0.steps',
    'scope',
    'non_goals',
    'checks.0.statement',
    'checks.0.method',
    'tasks.0.role',
    'tasks.0.acceptance',
    'maintenance.owner',
  ])
    assert.ok(out.errors![k], `expected an error for ${k}`);
});

test('a hand-filled draft parses with the server schema; output keeps its newline and empty arguments', async () => {
  const f = await load();
  const d = f.emptySpecDraft({
    title: 'T',
    audience: 'A',
    problem_statement: 'P',
  });
  d.flows[0] = { key: 'F1', name: 'Run', steps: 'Start it\nRead output' };
  d.scope = 'CLI';
  d.non_goals = 'Web UI';
  d.checks[0] = {
    key: 'A1',
    flow: 'F1',
    statement: 'Echoes',
    measure: 'stdout',
    method: 'automated_test',
    cases: [
      { ...f.emptyCase(), args: 'a\n\nb', stdout: 'a  b' },
      {
        ...f.emptyCase(),
        args: '',
        stdout: 'none',
        newline: false,
        exit_code: '2',
        held_out: true,
      },
    ],
  };
  d.tasks[0] = {
    ...d.tasks[0],
    title: 'Build',
    role: 'builder',
    file_scope: 'src',
    acceptance: ['A1'],
    deliverable: 'Code',
  };
  d.maintenance = {
    owner: 'Jordan',
    obligations: 'Keep logs',
    review_interval: 'Monthly',
  };
  const out = f.draftToContent(d);
  assert.equal(out.errors, null, JSON.stringify(out.errors));
  const parsed = SpecContentSchema.safeParse(out.content);
  assert.ok(parsed.success, JSON.stringify(parsed.error?.issues));
  const [a, b] = parsed.data.acceptance_checks[0]!.cases!;
  assert.deepEqual(a!.args, ['a', '', 'b']);
  assert.equal(a!.stdout, 'a  b\n');
  assert.deepEqual(b!.args, []);
  assert.equal(b!.stdout, 'none');
  assert.equal(b!.exit_code, 2);
  assert.deepEqual(f.buildNotes(out.content), []);
});

test('bad paths, out-of-range exit codes and undelivered checks are caught in the form', async () => {
  const f = await load();
  const d = f.draftFromContent('Checklist', BUILD_FIXTURE_SPEC);
  d.tasks[0].file_scope = '../etc';
  d.checks[0].cases[0].exit_code = '300';
  d.tasks[0].acceptance = ['A1'];
  const out = f.draftToContent(d);
  assert.ok(out.errors!['tasks.0.file_scope']);
  assert.ok(out.errors!['checks.0.cases.0.exit_code']);
  assert.match(out.errors!['checks.1.covered']!, /No task delivers A2/);
});

test('build notes explain why the reviewed builder would refuse a valid spec', async () => {
  const f = await load();
  const noHeld = structuredClone(BUILD_FIXTURE_SPEC);
  noHeld.acceptance_checks[1]!.cases![0]!.held_out = false;
  assert.match(f.buildNotes(noHeld).join(' '), /held-out/);
  const manual = structuredClone(BUILD_FIXTURE_SPEC);
  manual.acceptance_checks[0] = {
    ...manual.acceptance_checks[0]!,
    method: 'manual_review',
  };
  delete manual.acceptance_checks[0].cases;
  assert.match(f.buildNotes(manual).join(' '), /not an automated test/);
});

test('stored specs whose automated checks have no cases still open and save unchanged', async () => {
  const f = await load();
  for (const s of [FIXTURE_SPEC, fixtureSpecRevision(FIXTURE_SPEC)]) {
    const out = f.draftToContent(f.draftFromContent('Fixture', s));
    assert.equal(out.errors, null, JSON.stringify(out.errors));
    assert.deepEqual(out.content, s);
  }
  // Valid, but not buildable by the reviewed Python builder: the notes say why.
  assert.match(
    f.buildNotes(FIXTURE_SPEC).join(' '),
    /not an automated test with cases/,
  );
});

test('new keys never reuse a key in use or given by the stored version (review L-1)', async () => {
  const f = await load();
  assert.equal(f.nextKey('T', ['T1', 'T3']), 'T4');
  assert.equal(f.nextKey('A', []), 'A1');
  // Revising: stored T2 was removed, so a new task is T3, not T2 again.
  assert.equal(f.nextKey('T', ['T1'], ['F1', 'A1', 'T1', 'T2']), 'T3');
  // Keys stop at 99 (schema limit): once T99 is given there is no new key (re-review N-B).
  assert.equal(f.nextKey('T', ['T98']), 'T99');
  assert.equal(f.nextKey('T', [], ['T99']), null);
});

test('revising keeps stored arguments the box cannot show, unless edited (review M-2)', async () => {
  const f = await load();
  const spec = structuredClone(BUILD_FIXTURE_SPEC) as any;
  const cases = spec.acceptance_checks.find((a: any) => a.cases?.length).cases;
  cases[0].args = [''];
  cases[1] = { ...cases[0], args: ['a', ''] };
  cases.push({ ...cases[0], args: ['line1\nline2'] });
  const d = f.draftFromContent('Fixture', spec);
  d.title = 'Fixture (retitled)';
  const out = f.draftToContent(d);
  assert.equal(out.errors, null, JSON.stringify(out.errors));
  const kept = out.content.acceptance_checks.find(
    (a: any) => a.cases?.length,
  ).cases;
  assert.deepEqual(
    kept.map((c: any) => c.args),
    [[''], ['a', ''], ['line1\nline2']],
  );
  // Editing the box replaces them with what is typed.
  const c0 = d.checks.find((c: any) => c.cases.length).cases[0];
  c0.args = 'x\ny';
  const edited = f.draftToContent(d);
  assert.deepEqual(
    edited.content.acceptance_checks.find((a: any) => a.cases?.length).cases[0]
      .args,
    ['x', 'y'],
  );
});

test('an option is offered again once its selection is recorded again (review M-1)', async () => {
  const f = await load();
  const alt = { id: 'AAAAAAAA-0000-4000-8000-000000000001', version: 2 };
  const spec = (selection_id: string, status = 'active') => ({
    status,
    body: { selection_id, alternative: { ...alt, id: alt.id.toLowerCase() } },
  });
  const sel = (selection_id: string) => ({ selection_id, alternative: alt });
  // Written from this selection: not offered.
  assert.deepEqual(f.unwrittenOptions([sel('s-new')], [spec('S-NEW')]), []);
  // Written from an earlier selection of the same option version: offered again.
  assert.equal(f.unwrittenOptions([sel('s-new')], [spec('s-old')]).length, 1);
  // Archived specs never count.
  assert.equal(
    f.unwrittenOptions([sel('s-new')], [spec('s-new', 'archived')]).length,
    1,
  );
});

test('a task may wait for at most 20 others (review L-3)', async () => {
  const f = await load();
  const d = f.draftFromContent('Fixture', BUILD_FIXTURE_SPEC);
  const keys = Array.from({ length: 21 }, (_, i) => `T${i + 2}`);
  for (const k of keys)
    d.tasks.push({ ...structuredClone(d.tasks[0]), key: k, depends_on: [] });
  d.tasks[0].depends_on = keys;
  const out = f.draftToContent(d);
  assert.match(out.errors?.['tasks.0.depends_on'] ?? '', /at most 20/);
});
