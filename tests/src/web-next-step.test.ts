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
  // Scoring has a form now (Decide › Score an option), so it never sends anyone to the CLI.
  assert.match(scored.text, /Score an option/);
  assert.doesNotMatch(scored.text, /pnpm cli|command line/);
  assert.equal(
    pipelineStep({ ...done, frozenSpecs: 0 }).action?.view,
    'scores',
  );
  // Writing a spec has a form now (Build › Write a spec), so it never sends anyone to the CLI.
  const review = pipelineStep({ ...done, reviewed: false });
  assert.match(review.text, /Add a humility review/);
  assert.doesNotMatch(review.text, /pnpm cli|command line/);
  const spec = pipelineStep({ ...done, specs: 0, frozenSpecs: 0 });
  assert.match(spec.text, /Write a spec/);
  assert.doesNotMatch(spec.text, /pnpm cli|command line/);
  assert.equal(pipelineStep(done).action?.view, 'gallery');
});

// Uses accepted feedback: revising from it is the one main-path step still CLI-only, now that
// scoring, specs and the humility review have forms (review of PR #112, N-3).
test('the desktop app is never told to run a command it does not have', async () => {
  const { pipelineStep } = await load<Rules>('next-rules.ts');
  // Revising from accepted feedback has a form under Try now (audit L-8).
  const step = pipelineStep({
    ...done,
    desktop: true,
    product: {
      ...(done.product as Facts),
      feedback: { total: 1, accepted: 1, undecided: 0 },
    },
  });
  assert.doesNotMatch(step.text, /pnpm cli|command line/);
  assert.match(step.text, /under Try/);
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
    build: { commit: string | null; state: string },
    spec: { spec_id: string; spec_version: number },
  ) => { id: string } | undefined;
};

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

// Final UX pass P-10: after Prepare task, the build form opened on another project's newer run.
test("the build form's run defaults to the spec's own run", async () => {
  const { buildRunDefault } = await load<{
    buildRunDefault: (
      newestFirst: { run_id: string; autonomy_mode: string }[],
      specRun: string | null,
    ) => string;
  }>('build-defaults.ts');
  const runs = [
    { run_id: 'other-project', autonomy_mode: 'supervised' },
    { run_id: 'spec-run', autonomy_mode: 'supervised' },
  ];
  // The spec's run wins over a newer run.
  assert.equal(buildRunDefault(runs, 'spec-run'), 'spec-run');
  // Without it (ended, human-only, or unknown) the newest run that can build.
  assert.equal(buildRunDefault(runs, null), 'other-project');
  assert.equal(buildRunDefault(runs, 'ended'), 'other-project');
  assert.equal(
    buildRunDefault(
      [runs[0]!, { run_id: 'spec-run', autonomy_mode: 'human_only' }],
      'spec-run',
    ),
    'other-project',
  );
  assert.equal(buildRunDefault([], 'spec-run'), '');
});

test('a build counts as packaged when Gallery holds its commit, even after a restart', async () => {
  const { artifactForBuild } = await load<Defaults>('build-defaults.ts');
  const spec = { spec_id: 's', spec_version: 4 };
  const artifacts = [
    { id: 'a-v3', commit: 'c3', spec: { id: 's', version: 3 } },
    { id: 'a-v4', commit: 'c4', spec: { id: 's', version: 4 } },
  ];
  const v = 'verified_candidate';
  assert.equal(
    artifactForBuild(artifacts, { commit: 'c4', state: v }, spec)?.id,
    'a-v4',
  );
  assert.equal(
    artifactForBuild(artifacts, { commit: 'c3', state: v }, spec),
    undefined,
  );
  assert.equal(
    artifactForBuild(artifacts, { commit: null, state: v }, spec),
    undefined,
  );
  // PR #194 L-2: a stopped build that shares the packaged commit (a build resumed from its
  // kept candidate verified it) is not the packaged one.
  assert.equal(
    artifactForBuild(artifacts, { commit: 'c4', state: 'checkpoint' }, spec),
    undefined,
  );
});

// PR #194 M-1: "blocked" in a stop reason is not a lock, so it never shows the Recover notice.
test('only interrupted builds, left locks and unresolved test runs ask for Recover', async () => {
  const { needsRecover } = await load<{
    needsRecover: (
      b: { state: string; reason: string | null } | undefined,
    ) => boolean;
  }>('build-defaults.ts');
  const stop = (reason: string) => ({ state: 'checkpoint', reason });
  assert.equal(needsRecover(undefined), false);
  assert.equal(needsRecover({ state: 'interrupted', reason: null }), true);
  assert.equal(needsRecover(stop('Error: Product builds is locked')), true);
  assert.equal(
    needsRecover(
      stop('A worker outcome needs reconciliation before another dispatch'),
    ),
    true,
  );
  assert.equal(
    needsRecover(
      stop(
        'Error: The worker did not finish check A1 (cleanup_required: x; execution e). The candidate is kept; Recover this product first, then build again.',
      ),
    ),
    true,
  );
  assert.equal(
    needsRecover(
      stop(
        'Error: The worker did not finish check A1 (blocked: Error: Isolation unavailable; execution e). The candidate is kept; build again once the worker runs.',
      ),
    ),
    false,
  );
  assert.equal(needsRecover(stop('Error: Reviewer blocked candidate')), false);
  assert.equal(needsRecover(stop('Error: Builder blocked: no patch')), false);
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
      'done',
      'next',
      'later',
      'later',
      'later',
      'later',
    ],
  );
  assert.equal(step.text, pipelineStep(unfrozen).text);
  assert.equal(stages[5]!.view, 'scores');
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

type MoreRules = Omit<Rules, 'pathStages'> & {
  pathStages: (f: Facts) => {
    stages: { key: string; state: string; text: string | null; view: string }[];
    step: Step;
    finished: boolean;
  };
  lineStyle: (view: string, f: Facts) => 'full' | 'short';
  pathSummary: (f: Facts) => { text: string; view: string };
};

const tried = (feedback: Facts) => ({
  ...done,
  product: { ...(done.product as Facts), feedback },
});

test('recording feedback on the newest package finishes Try, and Next moves on (audit item 3)', async () => {
  const { pipelineStep, pathStages, nextStep } =
    await load<MoreRules>('next-rules.ts');
  // No feedback yet: Try is still next, as before.
  assert.equal(pathStages(done).finished, false);
  assert.equal(
    pathStages(tried({ total: 0, accepted: 0, undecided: 0 })).stages.at(-1)
      ?.state,
    'next',
  );
  // Feedback recorded but not decided: Try is done and nothing is "next" any more.
  const undecided = tried({ total: 1, accepted: 0, undecided: 1 });
  const path = pathStages(undecided);
  assert.equal(path.finished, true);
  assert.ok(
    path.stages.every((s) => s.state === 'done' || s.state === 'skipped'),
  );
  assert.equal(path.step.tone, 'clear');
  assert.doesNotMatch(path.step.text, /^Try the newest/);
  assert.match(path.step.text, /Accept one under Try/);
  assert.deepEqual(nextStep('path', undecided), path.step);
  assert.deepEqual(nextStep('gallery', undecided), pipelineStep(undecided));
  // Accepted feedback: the next step is the revision, named for where the person is.
  const accepted = tried({ total: 2, accepted: 1, undecided: 0 });
  const revise = pipelineStep(accepted);
  assert.equal(revise.tone, 'next');
  // The form under Try is the route on the web and in the desktop app alike (audit L-8).
  assert.match(revise.text, /Revise the spec from this feedback/);
  assert.equal(revise.action?.view, 'gallery');
  // Several accepted items make one revision: the first one moves the spec on (PR #121 L-1).
  assert.match(
    pipelineStep(tried({ total: 3, accepted: 2, undecided: 0 })).text,
    /once from your 2 accepted feedback items.*all their changes in that one revision/,
  );
  for (const desktop of [false, true])
    assert.doesNotMatch(
      pipelineStep({ ...accepted, desktop }).text,
      /command line|pnpm cli/,
    );
  // Everything decided (declined, or praise only): the path is finished for this product.
  const closed = pipelineStep(tried({ total: 1, accepted: 0, undecided: 0 }));
  assert.equal(closed.tone, 'clear');
  assert.match(closed.text, /path is finished/);
  assert.equal(closed.action?.view, 'submit');
  // A revised spec makes the product stale, so the path goes back to building it.
  assert.match(
    pipelineStep({
      ...accepted,
      product: { ...(accepted.product as Facts), current: false },
    }).text,
    /spec changed/,
  );
});

test('a finished path never reads "Next:" on pages that only repeat it', async () => {
  const { nextStep } = await load<MoreRules>('next-rules.ts');
  const finished = tried({ total: 1, accepted: 0, undecided: 0 });
  const approvals = nextStep('decisions', finished);
  assert.equal(approvals.tone, 'clear');
  assert.doesNotMatch(approvals.text, /Next:/);
  assert.match(nextStep('decisions', done).text, /Next: Try/);
});

test('the full line shows on Projects and on pages it is about; elsewhere a short summary', async () => {
  const { lineStyle, pathSummary } = await load<MoreRules>('next-rules.ts');
  for (const view of ['path', 'build', 'gallery', 'submit', 'marketing'])
    assert.equal(lineStyle(view, done), 'full', view);
  for (const view of ['settings', 'models', 'chat', 'catalog', 'decisions'])
    assert.equal(lineStyle(view, done), 'short', view);
  // Pages whose own line is about them keep it in full.
  assert.equal(lineStyle('budgets', { ...done, budgets: 0 }), 'full');
  assert.equal(lineStyle('models', { ...done, planConnections: 0 }), 'full');
  assert.equal(lineStyle('chat', { ...done, pending: 2 }), 'full');
  assert.equal(lineStyle('decisions', { ...done, pending: 1 }), 'full');
  assert.equal(lineStyle('overview', { ...done, attention: 1 }), 'full');
  // The summary names the current stage, or that the path is finished.
  assert.deepEqual(pathSummary(done), { text: 'Try is next', view: 'gallery' });
  assert.deepEqual(pathSummary({ ...done, frozenSpecs: 0 }), {
    text: 'Freeze is next',
    view: 'scores',
  });
  assert.equal(
    pathSummary({
      ...done,
      product: { ...(done.product as Facts), build: 'failed' },
    }).text,
    'Build is blocked',
  );
  assert.equal(
    pathSummary(tried({ total: 1, accepted: 0, undecided: 1 })).text,
    'finished for this product',
  );
  assert.equal(
    pathSummary(tried({ total: 1, accepted: 1, undecided: 0 })).text,
    'revising from your feedback is next',
  );
});

test('"works as intended" alone finishes the path; praise never waits for a decision (PR #101 review M-1)', async () => {
  const { feedbackCounts, pipelineStep, nextStep } = await load<
    MoreRules & {
      feedbackCounts: (list: { category: string; status: string }[]) => Facts;
    }
  >('next-rules.ts');
  // What the one-click button records: a submitted praise item.
  const praise = { category: 'praise', status: 'submitted' };
  const finished = tried(feedbackCounts([praise]));
  const step = pipelineStep(finished);
  assert.equal(step.tone, 'clear');
  assert.match(step.text, /path is finished/);
  assert.doesNotMatch(step.text, /Accept one/);
  assert.doesNotMatch(nextStep('settings', finished).text, /Revise/);
  // Even an accepted praise item does not make a revision next.
  assert.match(
    pipelineStep(tried(feedbackCounts([{ ...praise, status: 'accepted' }])))
      .text,
    /path is finished/,
  );
  // A change request next to it still waits for a decision, and accepting it means revise.
  const change = { category: 'change_request', status: 'submitted' };
  assert.match(
    pipelineStep(tried(feedbackCounts([praise, change]))).text,
    /Accept one under Try/,
  );
  assert.match(
    pipelineStep(
      tried(feedbackCounts([praise, { ...change, status: 'accepted' }])),
    ).text,
    /Revise the spec/,
  );
});

test('Try names an earlier open stage instead of "All clear" (PR #101 review L-3)', async () => {
  const { nextStep, pathStages } = await load<MoreRules>('next-rules.ts');
  const unreviewed = {
    ...tried({ total: 1, accepted: 0, undecided: 0 }),
    reviewed: false,
  };
  const gallery = nextStep('gallery', unreviewed);
  assert.deepEqual(gallery, pathStages(unreviewed).step);
  assert.match(gallery.text, /humility review/);
  assert.notEqual(gallery.tone, 'clear');
});

// UX pass P-2: the Path branches after Selection.
const atSelection: Facts = {
  ...done,
  specs: 0,
  frozenSpecs: 0,
  reviewed: false,
  product: null,
  artifacts: 0,
};
const chose = (
  route: string | null,
  proposal: Facts | null = null,
  count = 1,
): Facts => ({
  ...atSelection,
  selection: { count, route, proposal },
});
const proposalFacts = (p: Facts = {}) => ({
  title: 'Use csvkit',
  unknownCore: 0,
  reviewed: false,
  revise: false,
  ...p,
});

test('a non-code selection branches the Path to Proposal and Review, and it finishes (P-2)', async () => {
  const { pathStages, nextStep, pathSummary } =
    await load<MoreRules>('next-rules.ts');
  const keys = (f: Facts) =>
    pathStages(f).stages.map((s) => `${s.key}:${s.state}`);
  // No proposal yet: Proposal is next and opens Proposals; no build stages are shown.
  assert.deepEqual(keys(chose('non_code')), [
    'evidence:done',
    'discovery:done',
    'scores:done',
    'selection:done',
    'proposal:next',
    'proposal_review:later',
  ]);
  const start = pathStages(chose('non_code'));
  assert.equal(start.step.action?.view, 'proposals');
  assert.match(start.step.text, /Start a proposal/);
  // Required sections still unknown: the step counts them and offers the model draft.
  const unknown = pathStages(
    chose('non_code', proposalFacts({ unknownCore: 5 })),
  );
  assert.match(unknown.step.text, /5 required sections are still Unknown yet/);
  assert.match(unknown.step.text, /Draft the missing sections/);
  assert.equal(unknown.finished, false);
  // Complete but not reviewed: Review is next; a "revise" review says to revise first.
  const review = pathStages(chose('non_code', proposalFacts()));
  assert.deepEqual(
    review.stages.slice(-2).map((s) => s.state),
    ['done', 'next'],
  );
  assert.match(review.step.text, /^Review the proposal/);
  assert.match(
    pathStages(chose('non_code', proposalFacts({ revise: true }))).step.text,
    /^Revise the proposal/,
  );
  // Reviewed as ready: the path is finished, and every line agrees.
  const finished = chose('non_code', proposalFacts({ reviewed: true }));
  const end = pathStages(finished);
  assert.equal(end.finished, true);
  assert.ok(end.stages.every((s) => s.state === 'done'));
  assert.match(end.step.text, /path is finished/);
  assert.deepEqual(nextStep('path', finished), end.step);
  assert.deepEqual(nextStep('proposals', finished), end.step);
  assert.equal(
    pathSummary(finished).text,
    'finished: the proposal is reviewed',
  );
  // A reviewed version with required sections unknown again (a later revision) is not done.
  assert.equal(
    pathStages(
      chose('non_code', proposalFacts({ reviewed: true, unknownCore: 1 })),
    ).finished,
    false,
  );
});

test('a software selection goes on to Spec, and a selection that advanced nothing ends the Path (P-2)', async () => {
  const { pathStages, pathSummary } = await load<MoreRules>('next-rules.ts');
  // Software: Selection is done once recorded, and Spec is next on Build.
  const sw = pathStages(chose('software'));
  const spec = sw.stages.find((s) => s.key === 'spec')!;
  assert.equal(sw.stages.find((s) => s.key === 'selection')?.state, 'done');
  assert.equal(spec.state, 'next');
  assert.equal(spec.view, 'build');
  assert.match(spec.text ?? '', /Write a spec/);
  assert.equal(sw.stages.at(-1)?.key, 'try');
  // Nothing advanced: no stages after Selection, the path ends with a clear note.
  const none = pathStages(chose('none'));
  assert.equal(none.stages.at(-1)?.key, 'selection');
  assert.equal(none.finished, true);
  assert.equal(none.step.tone, 'clear');
  assert.match(none.step.text, /chose no option to build/);
  assert.equal(pathSummary(chose('none')).text, 'waiting on another selection');
  // Before any selection, Selection is next and Spec says where each choice goes.
  const before = pathStages(chose(null, null, 0));
  assert.equal(before.stages.find((s) => s.key === 'selection')?.state, 'next');
  assert.match(
    before.stages.find((s) => s.key === 'spec')?.text ?? '',
    /non-code choice goes to Proposal and Review/,
  );
  // Selections not read (older facts): a spec still stands for a selection, as before.
  assert.equal(
    pathStages(done).stages.find((s) => s.key === 'selection')?.state,
    'done',
  );
});
