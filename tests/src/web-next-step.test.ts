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
  action?: { view: string };
};
type Rules = {
  failedNote: (view: string, f: Facts) => string | null;
  nextStep: (view: string, f: Facts) => Step;
  pipelineStep: (f: Facts) => Step;
  decisionsNote: (view: string, f: Facts) => string | null;
  pathStages: (f: Facts) => {
    stages: { key: string; state: string; text: string | null; view: string }[];
    step: Step;
  };
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
  reviewed: true,
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
    reviewed: false,
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
  const { PAGES } = await load<{
    PAGES: { sections: { view: string }[] }[];
  }>('pages.ts');
  const views = PAGES.flatMap((p) => p.sections.map((s) => s.view));
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

test('waiting steps are counted from exact per-state totals, not the capped attention list', async () => {
  const { workflowCounts, nextStep } = await load<
    Rules & {
      workflowCounts: (s: Record<string, number>) => {
        attention: number;
        failed: number;
      };
    }
  >('next-rules.ts');
  // 25 newer failures would fill the overview's 20-item attention list; the one waiting step
  // must still block (PR #90 re-review N-1).
  const steps = workflowCounts({
    failed: 25,
    waiting_human: 1,
    succeeded: 40,
    running: 2,
  });
  assert.deepEqual(steps, { attention: 1, failed: 25 });
  assert.equal(nextStep('overview', { ...done, ...steps }).tone, 'blocked');
  assert.deepEqual(workflowCounts({ paused_operator: 2, reconciling: 1 }), {
    attention: 3,
    failed: 0,
  });
  assert.deepEqual(workflowCounts({}), { attention: 0, failed: 0 });
});

test('the review step is decided for the newest frozen spec, not any frozen spec', async () => {
  const { pathSpecReviewed } = await load<{
    pathSpecReviewed: (
      frozen: { id: string; version: number }[],
      reviews: { status: string; body: unknown }[],
    ) => boolean;
  }>('next-rules.ts');
  const review = (id: string, version: number, status = 'active') => ({
    status,
    body: { subject: { id, version } },
  });
  const csv = { id: 'csv', version: 2 };
  const fresh = { id: 'new', version: 1 };
  // PR #90 re-review N-2: the CSV checker is reviewed, a newer spec is frozen without one.
  assert.equal(pathSpecReviewed([fresh, csv], [review('csv', 2)]), false);
  assert.equal(
    pathSpecReviewed([fresh, csv], [review('csv', 2), review('new', 1)]),
    true,
  );
  // A revision needs its own review; a withdrawn review does not count.
  assert.equal(pathSpecReviewed([csv], [review('csv', 1)]), false);
  assert.equal(
    pathSpecReviewed([csv], [review('csv', 2, 'superseded')]),
    false,
  );
  assert.equal(pathSpecReviewed([], [review('csv', 2)]), false);
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
  // Submit lists only the budgets the chosen run may use, so it never shows one it cannot use
  // (PR #90 re-review N-3); a new run ('') may use only shared ones.
  const { envelopesFor } = await load<{
    envelopesFor: (
      list: { id: string; run_id: string | null }[],
      runId: string,
    ) => { id: string }[];
  }>('build-defaults.ts');
  const ids = (l: { id: string }[]) => l.map((e) => e.id);
  assert.deepEqual(ids(envelopesFor(newest, 'r2')), ['child-of-r2', 'shared']);
  assert.deepEqual(ids(envelopesFor(newest, 'r1')), ['shared']);
  assert.deepEqual(ids(envelopesFor(newest, '')), ['shared']);
  assert.deepEqual(envelopesFor([{ id: 'x', run_id: 'r2' }], 'r1'), []);
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

test("the Path tab marks stages done in order and agrees with the what's-next line", async () => {
  const { pathStages, pipelineStep } = await load<Rules>('next-rules.ts');
  const states = (f: Facts) =>
    pathStages(f).stages.map((s) => `${s.key}:${s.state}`);
  // At the end of the path only trying the package is left.
  assert.deepEqual(states(done).slice(-2), ['package:done', 'try:next']);
  // An unfrozen spec: everything before Freeze is done, Freeze is next, the rest later.
  const unfrozen = { ...done, frozenSpecs: 0 };
  const { stages, step } = pathStages(unfrozen);
  assert.deepEqual(
    stages.map((s) => s.state),
    [
      'done',
      'done',
      'done',
      'done',
      'next',
      'later',
      'later',
      'later',
      'later',
    ],
  );
  assert.equal(step.text, pipelineStep(unfrozen).text);
  assert.equal(stages[4]!.view, 'scores');
  // A later record does not count past an earlier gap: unscored options stop at Scores.
  const unscored = pathStages({ ...done, scorecards: 0 }).stages;
  assert.equal(unscored.find((s) => s.state !== 'done')?.key, 'scores');
  // A running build reads as in progress, a failed one as blocked.
  const at = (build: string) =>
    pathStages({
      ...done,
      product: { ...(done.product as Facts), build },
    }).stages.find((s) => s.key === 'build')?.state;
  assert.equal(at('running'), 'running');
  assert.equal(at('failed'), 'blocked');
});

test('the Path tab says why a stage is blocked and what later stages will need', async () => {
  const { pathStages } = await load<Rules>('next-rules.ts');
  // No budget: discovery is blocked with the reason and a link to Budgets.
  const start = pathStages({
    ...done,
    budgets: 0,
    problems: 0,
    alternatives: 0,
    scorecards: 0,
    specs: 0,
    frozenSpecs: 0,
    reviewed: false,
    product: null,
  });
  const discovery = start.stages.find((s) => s.key === 'discovery')!;
  assert.equal(discovery.state, 'blocked');
  assert.equal(discovery.view, 'budgets');
  assert.match(discovery.text ?? '', /active budget/);
  // The build stage, still ahead, already says what it will need.
  const build = start.stages.find((s) => s.key === 'build')!;
  assert.equal(build.state, 'later');
  assert.match(build.text ?? '', /active budget/);
  // A non-owner is told before reaching the build that only the owner can build.
  const viewer = pathStages({ ...done, owner: false, frozenSpecs: 0 });
  assert.match(
    viewer.stages.find((s) => s.key === 'build')?.text ?? '',
    /Only the workspace owner/,
  );
});

test('the line above the tabs on Path never contradicts the Path list (PR #97 review M-1)', async () => {
  const { pathStages, nextStep } = await load<Rules>('next-rules.ts');
  const early = {
    ...done,
    problems: 0,
    alternatives: 0,
    scorecards: 0,
    specs: 0,
    frozenSpecs: 0,
    reviewed: false,
    product: null,
  };
  const cases: Facts[] = [
    { ...early, budgets: 0 },
    {
      ...done,
      owner: false,
      product: { ...(done.product as Facts), packaged: false },
    },
    {
      ...done,
      owner: false,
      product: { ...(done.product as Facts), build: 'running' },
    },
    { ...done, frozenSpecs: 0 },
    done,
  ];
  for (const f of cases) {
    const { stages, step } = pathStages(f);
    const line = nextStep('path', f);
    assert.deepEqual(line, step);
    const current = stages.find((s) =>
      ['next', 'running', 'blocked'].includes(s.state),
    )!;
    assert.equal(current.text, line.text);
    assert.equal(current.state === 'blocked', line.tone === 'blocked');
  }
  // No budget: both say discovery is blocked and point at Budgets.
  const noBudget = nextStep('path', { ...early, budgets: 0 });
  assert.equal(noBudget.tone, 'blocked');
  assert.equal(noBudget.action?.view, 'budgets');
  // A running build needs no one, so the owner rule does not turn it into a block.
  const running = pathStages({
    ...done,
    owner: false,
    product: { ...(done.product as Facts), build: 'running' },
  });
  assert.equal(running.stages.find((s) => s.key === 'build')?.state, 'running');
});

test('packaging needs no budget or pricing, and skipped scoring is not shown as done', async () => {
  const { pathStages } = await load<Rules>('next-rules.ts');
  // L-1: a verified, unpackaged build with no budget or pricing is ready to package.
  const unpackaged = pathStages({
    ...done,
    budgets: 0,
    pricing: 0,
    product: { ...(done.product as Facts), packaged: false },
  });
  const pkg = unpackaged.stages.find((s) => s.key === 'package')!;
  assert.equal(pkg.state, 'next');
  assert.match(pkg.text ?? '', /Package it/);
  // L-3: a discovery with no options skips scoring; the stage says so instead of Done.
  const noOptions = pathStages({ ...done, alternatives: 0, scorecards: 0 });
  assert.equal(
    noOptions.stages.find((s) => s.key === 'scores')?.state,
    'skipped',
  );
  assert.equal(
    pathStages(done).stages.find((s) => s.key === 'scores')?.state,
    'done',
  );
});
