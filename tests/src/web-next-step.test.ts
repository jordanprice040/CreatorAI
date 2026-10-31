import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// The step-9 navigation rules: these web modules have no imports, so they load directly.
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

type Facts = Record<string, unknown>;
type Step = {
  tone: string;
  text: string;
  action?: { label: string; view: string };
};
type Rules = {
  failedNote: (view: string, f: Facts) => string | null;
  nextStep: (view: string, f: Facts) => Step;
  pipelineStep: (f: Facts) => Step;
  decisionsNote: (view: string, f: Facts) => string | null;
};

/** A workspace at the end of the path: everything recorded, a packaged verified build. */
const done: Facts = {
  fixture: false,
  owner: true,
  desktop: false,
  pending: 0,
  attention: 0,
  failed: 0,
  runs: 1,
  budgets: 1,
  pricing: 1,
  sources: 3,
  claims: 3,
  problems: 1,
  alternatives: 4,
  scorecards: 1,
  reviews: 1,
  specs: 1,
  frozenSpecs: 1,
  product: {
    current: true,
    build: 'verified',
    packaging: false,
    packaged: true,
  },
  artifacts: 1,
  planConnections: 1,
};

test('the main path names the first missing step and the page that takes it', async () => {
  const { pipelineStep } = await load<Rules>('next-rules.ts');
  const empty = {
    ...done,
    claims: 0,
    problems: 0,
    alternatives: 0,
    scorecards: 0,
    reviews: 0,
    specs: 0,
    frozenSpecs: 0,
    product: null,
    artifacts: 0,
  };
  assert.equal(pipelineStep(empty).action?.view, 'evidence');
  assert.equal(pipelineStep({ ...empty, claims: 2 }).action?.view, 'submit');
  const scored = pipelineStep({
    ...empty,
    claims: 2,
    problems: 1,
    alternatives: 3,
  });
  assert.equal(scored.action?.view, 'compare');
  assert.match(scored.text, /pnpm cli scorecard/);
  assert.equal(
    pipelineStep({ ...done, frozenSpecs: 0 }).action?.view,
    'scores',
  );
  assert.equal(pipelineStep(done).action?.view, 'gallery');
});

test('the desktop app is never told to run a command it does not have', async () => {
  const { pipelineStep } = await load<Rules>('next-rules.ts');
  const step = pipelineStep({ ...done, scorecards: 0, desktop: true });
  assert.doesNotMatch(step.text, /pnpm cli/);
  assert.match(step.text, /desktop app does not have/);
});

test('each build state gets its own next step; a stopped build reads as blocked', async () => {
  const { pipelineStep } = await load<Rules>('next-rules.ts');
  const at = (product: Facts) =>
    pipelineStep({
      ...done,
      product: { ...(done.product as Facts), ...product },
    });
  assert.equal(at({ build: 'checkpoint' }).tone, 'blocked');
  assert.equal(at({ build: 'failed' }).tone, 'blocked');
  assert.equal(at({ build: 'running' }).tone, 'clear');
  assert.match(at({ packaged: false }).text, /Package it/);
  assert.match(at({ current: false }).text, /spec changed/);
});

test('pages that cannot act yet say why and link to where it is fixed', async () => {
  const { nextStep } = await load<Rules>('next-rules.ts');
  const build = nextStep('build', { ...done, frozenSpecs: 0 });
  assert.equal(build.tone, 'blocked');
  assert.equal(build.action?.view, 'scores');
  const budget = nextStep('build', { ...done, pricing: 0 });
  assert.equal(budget.action?.view, 'budgets');
  assert.match(budget.text, /pricing snapshot/);
  const gallery = nextStep('gallery', { ...done, artifacts: 0 });
  assert.equal(gallery.tone, 'blocked');
  assert.equal(gallery.action?.view, 'build');
  assert.equal(
    nextStep('submit', { ...done, claims: 0 }).action?.view,
    'evidence',
  );
  assert.equal(nextStep('payments', { ...done, artifacts: 0 }).tone, 'blocked');
});

test('waiting decisions come first on the monitor and show as a note elsewhere', async () => {
  const { nextStep, decisionsNote } = await load<Rules>('next-rules.ts');
  const waiting = { ...done, pending: 2 };
  assert.equal(nextStep('overview', waiting).action?.view, 'decisions');
  assert.match(nextStep('decisions', waiting).text, /2 decisions/);
  assert.equal(decisionsNote('build', waiting), '2 decisions wait for you');
  assert.equal(decisionsNote('decisions', waiting), null);
  assert.equal(decisionsNote('build', done), null);
  assert.equal(nextStep('decisions', done).tone, 'clear');
});

test('every view has a step', async () => {
  const { nextStep } = await load<Rules>('next-rules.ts');
  const ui = await readFile('apps/web/src/ui.tsx', 'utf8');
  const block = /export const VIEWS = \[([\s\S]*?)\] as const;/.exec(ui)![1]!;
  const views = [...block.matchAll(/\['([a-z]+)'/g)].map((m) => m[1]!);
  assert.ok(views.length > 20);
  for (const view of views) {
    const step = nextStep(view, done);
    assert.ok(step && step.text.length > 0, view);
  }
});

type Versions = {
  newestFirst: <T extends { created_at: string }>(list: T[]) => T[];
  productVersions: (
    products: {
      product: {
        id: string;
        binding: { spec_id: string; spec_version: number };
      };
      builds: { started_at: string }[];
    }[],
  ) => { specId: string; versions: { product: { id: string } }[] }[];
};

test('lists open on the newest item and keep the rest in order', async () => {
  const { newestFirst } = await load<Versions>('versions.ts');
  const list = [
    { id: 'old', created_at: '2026-10-28T10:00:00Z' },
    { id: 'new', created_at: '2026-10-31T10:00:00Z' },
    { id: 'mid', created_at: '2026-10-30T10:00:00Z' },
  ];
  assert.deepEqual(
    newestFirst(list).map((x) => x.id),
    ['new', 'mid', 'old'],
  );
  assert.equal(list[0]!.id, 'old', 'the input is not reordered');
});

test('products group by spec with the latest version first, unbuilt counting as newest', async () => {
  const { productVersions } = await load<Versions>('versions.ts');
  const p = (id: string, spec: string, v: number, ...starts: string[]) => ({
    product: { id, binding: { spec_id: spec, spec_version: v } },
    builds: starts.map((started_at) => ({ started_at })),
  });
  const groups = productVersions([
    p('v2', 'timing', 2, '2026-10-31T06:00:00Z'),
    p('csv', 'csv', 1, '2026-10-28T11:00:00Z'),
    p('v4-old', 'timing', 4, '2026-10-31T07:05:00Z'),
    p('v3', 'timing', 3, '2026-10-31T07:00:00Z'),
    p('v4-fresh', 'timing', 4),
  ]);
  assert.deepEqual(
    groups.map((g) => g.specId),
    ['timing', 'csv'],
  );
  assert.deepEqual(
    groups[0]!.versions.map((v) => v.product.id),
    ['v4-fresh', 'v4-old', 'v3', 'v2'],
  );
});

test('a failed run step is a note, not a permanent block', async () => {
  const { nextStep, failedNote } = await load<Rules>('next-rules.ts');
  const old = { ...done, failed: 3 };
  assert.equal(nextStep('overview', old).tone, 'next');
  assert.equal(nextStep('runs', old).action?.view, 'gallery');
  assert.match(failedNote('overview', old) ?? '', /3 run steps failed/);
  assert.equal(failedNote('build', old), null);
  assert.equal(nextStep('overview', { ...done, attention: 1 }).tone, 'blocked');
});

type Defaults = {
  modelGrantCovers: (
    g: Record<string, unknown>,
    run: Record<string, unknown>,
    dataClass: string,
    now: number,
  ) => boolean;
  envelopeFor: (
    list: { id: string; run_id: string | null }[],
    runId: string,
  ) => { id: string } | undefined;
  artifactForBuild: (
    artifacts: {
      id: string;
      commit: string;
      spec: { id: string; version: number };
    }[],
    build: { commit: string | null },
    spec: { spec_id: string; spec_version: number },
  ) => { id: string } | undefined;
};

test('the model-grant default follows the server: run, data class and autonomous initial grants', async () => {
  const { modelGrantCovers } = await load<Defaults>('build-defaults.ts');
  const now = Date.parse('2026-10-31T12:00:00Z');
  const g = {
    id: 'g1',
    version: 1,
    scope: 'standing',
    status: 'active',
    run_id: null,
    action_types: ['model.generate'],
    data_classes: ['public'],
    expires_at: '2026-11-01T00:00:00Z',
  };
  const run = {
    run_id: 'r1',
    autonomy_mode: 'human_in_loop',
    initial_grants: [],
  };
  assert.equal(modelGrantCovers(g, run, 'public', now), true);
  assert.equal(modelGrantCovers(g, run, 'synthetic', now), false);
  assert.equal(
    modelGrantCovers({ ...g, run_id: 'r2' }, run, 'public', now),
    false,
  );
  assert.equal(
    modelGrantCovers({ ...g, scope: 'once' }, run, 'public', now),
    false,
  );
  const auto = { ...run, autonomy_mode: 'autonomous_within_scope' };
  assert.equal(modelGrantCovers(g, auto, 'public', now), false);
  assert.equal(
    modelGrantCovers(
      g,
      { ...auto, initial_grants: [{ id: 'g1', version: 1 }] },
      'public',
      now,
    ),
    true,
  );
  assert.equal(
    modelGrantCovers(g, run, 'public', Date.parse('2026-11-02T00:00:00Z')),
    false,
  );
});

test('the default budget is never one bound to another run', async () => {
  const { envelopeFor } = await load<Defaults>('build-defaults.ts');
  const newest = [
    { id: 'child-of-r2', run_id: 'r2' },
    { id: 'shared', run_id: null },
  ];
  assert.equal(envelopeFor(newest, 'r1')?.id, 'shared');
  assert.equal(envelopeFor(newest, 'r2')?.id, 'child-of-r2');
  assert.equal(envelopeFor([{ id: 'x', run_id: 'r2' }], 'r1'), undefined);
});

test('a build counts as packaged when Gallery holds its commit, even after a restart', async () => {
  const { artifactForBuild } = await load<Defaults>('build-defaults.ts');
  const spec = { spec_id: 's', spec_version: 4 };
  const artifacts = [
    { id: 'a-v3', commit: 'c3', spec: { id: 's', version: 3 } },
    { id: 'a-v4', commit: 'c4', spec: { id: 's', version: 4 } },
  ];
  assert.equal(artifactForBuild(artifacts, { commit: 'c4' }, spec)?.id, 'a-v4');
  assert.equal(artifactForBuild(artifacts, { commit: 'c3' }, spec), undefined);
  assert.equal(artifactForBuild(artifacts, { commit: null }, spec), undefined);
});
