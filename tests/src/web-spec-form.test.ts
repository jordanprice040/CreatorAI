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
  nextKey: (p: string, used: string[]) => string;
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

test('new keys never reuse one still in the spec', async () => {
  const f = await load();
  assert.equal(f.nextKey('T', ['T1', 'T3']), 'T2');
  assert.equal(f.nextKey('A', []), 'A1');
});
