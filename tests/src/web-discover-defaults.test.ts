import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// P04: routine Discover settings, presets, the default plan choice and setup blockers. The
// module has no imports, so it loads directly.
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

type Settings = {
  timeLimit: string;
  budgetLimit: string;
  constraints: string;
  dataAndTools: string;
  dataClass: string;
  revisions: number;
  oversight: string;
  allowCalls: boolean;
  route: string;
};
type Plan = {
  id: string;
  blockers: string[];
  allowedDataClasses: string[];
  models: { id: string; qualified: string[] }[];
};
type Mod = {
  studioDefaults(fixture: boolean): Settings;
  parsePreset(raw: unknown, fixture: boolean): Partial<Settings>;
  startingSettings(fixture: boolean, preset: Partial<Settings>): Settings;
  sourceOf(
    key: keyof Settings,
    value: unknown,
    fixture: boolean,
    preset: Partial<Settings>,
  ): string;
  parsePresentation(raw: unknown): string;
  defaultPlanChoice(
    plans: Plan[],
    dataClass: string,
    taskClasses: string[],
  ): { connection: string; model: string };
  missingTaskTexts(
    subject: string,
    missing: string[],
    allowed: string[],
  ): string[];
  QUALIFY_IN_APP: string[];
  discoverSetupBlockers(input: Record<string, unknown>): {
    text: string;
    fix?: { view: string };
  }[];
};

const CLASSES = ['research_synthesis', 'candidate_generation', 'scoring'];

test('studio defaults match the form the studio always started with', async () => {
  const m = await load<Mod>('discover-defaults.ts');
  assert.deepEqual(m.studioDefaults(false), {
    timeLimit: 'Six weeks',
    budgetLimit: 'No extra metered spending',
    constraints: 'Use permitted public evidence only.',
    dataAndTools: '',
    dataClass: 'public',
    revisions: 1,
    oversight: 'human_in_loop',
    allowCalls: true,
    route: 'subscription',
  });
  const f = m.studioDefaults(true);
  assert.equal(f.dataClass, 'synthetic');
  assert.equal(f.route, 'api');
});

test('a preset keeps only well-formed known fields and cannot widen a fixture', async () => {
  const m = await load<Mod>('discover-defaults.ts');
  assert.deepEqual(m.parsePreset(null, false), {});
  assert.deepEqual(m.parsePreset([1, 2], false), {});
  assert.deepEqual(
    m.parsePreset(
      {
        timeLimit: 'Two weeks',
        revisions: 7,
        oversight: 'autonomous',
        route: 'local',
        allowCalls: 'yes',
        dataClass: 'private_approved',
        max_calls: 999,
        grants: ['model.generate'],
      },
      false,
    ),
    { timeLimit: 'Two weeks' },
  );
  // Private sharing is never carried by a preset (review N-5); public still is.
  assert.deepEqual(m.parsePreset({ dataClass: 'public' }, false), {
    dataClass: 'public',
  });
  // A blank time limit or budget constraint keeps the studio default (review L-2).
  assert.deepEqual(
    m.parsePreset(
      { timeLimit: '   ', budgetLimit: '', constraints: '' },
      false,
    ),
    { constraints: '' },
  );
  assert.equal(
    m.startingSettings(false, m.parsePreset({ timeLimit: ' ' }, false))
      .timeLimit,
    'Six weeks',
  );
  // A fixture workspace keeps synthetic data whatever a preset says.
  assert.deepEqual(m.parsePreset({ dataClass: 'public' }, true), {});
  assert.deepEqual(m.parsePreset({ timeLimit: 'x'.repeat(301) }, false), {});
});

test('each value says whether it is a studio default, the preset, or an edit', async () => {
  const m = await load<Mod>('discover-defaults.ts');
  const preset = m.parsePreset({ revisions: 2 }, false);
  const start = m.startingSettings(false, preset);
  assert.equal(start.revisions, 2);
  assert.equal(start.timeLimit, 'Six weeks');
  assert.equal(m.sourceOf('revisions', 2, false, preset), 'preset');
  assert.equal(m.sourceOf('revisions', 0, false, preset), 'edited');
  assert.equal(m.sourceOf('timeLimit', 'Six weeks', false, preset), 'studio');
  assert.equal(m.sourceOf('timeLimit', 'Today', false, preset), 'edited');
  assert.equal(m.parsePresentation('advanced'), 'advanced');
  assert.equal(m.parsePresentation(null), 'guided');
  assert.equal(m.parsePresentation('other'), 'guided');
});

test('the default connection is one that can run a discovery, not just the first', async () => {
  const m = await load<Mod>('discover-defaults.ts');
  const blocked: Plan = {
    id: 'a',
    blockers: ['Sign in again.'],
    allowedDataClasses: ['public'],
    models: [{ id: 'm1', qualified: CLASSES }],
  };
  const noPublic: Plan = {
    id: 'b',
    blockers: [],
    allowedDataClasses: ['synthetic'],
    models: [{ id: 'm1', qualified: CLASSES }],
  };
  const partly: Plan = {
    id: 'c',
    blockers: [],
    allowedDataClasses: ['public'],
    models: [
      { id: 'weak', qualified: ['scoring'] },
      { id: 'good', qualified: CLASSES },
    ],
  };
  assert.deepEqual(
    m.defaultPlanChoice([blocked, noPublic, partly], 'public', CLASSES),
    { connection: 'c', model: 'good' },
  );
  // None ready: the first connection, so its blockers say what to set up.
  assert.deepEqual(
    m.defaultPlanChoice([blocked, noPublic], 'public', CLASSES),
    {
      connection: 'a',
      model: 'm1',
    },
  );
  assert.deepEqual(m.defaultPlanChoice([], 'public', CLASSES), {
    connection: '',
    model: '',
  });
});

test('setup blockers name the step and the tab that fixes it; defaults never clear them', async () => {
  const m = await load<Mod>('discover-defaults.ts');
  const base = {
    route: 'subscription',
    connectionError: '',
    plan: null,
    dataClass: 'public',
    model: '',
    unqualified: [],
    envelopes: 0,
    usableEnvelopes: 0,
    pricing: 0,
    fixture: false,
  };
  const none = m.discoverSetupBlockers(base);
  assert.equal(none.length, 1);
  assert.equal(none[0]!.fix?.view, 'models');
  const unq = m.discoverSetupBlockers({
    ...base,
    plan: { blockers: [], allowedDataClasses: ['synthetic'] },
    model: 'm1',
    unqualified: ['scoring'],
  });
  assert.deepEqual(
    unq.map((b) => b.text),
    [
      'This connection does not permit the selected evidence sharing class.',
      'The model is not qualified for scoring. Qualify the model for scoring under Models and connections › Qualify a model.',
    ],
  );
  // P23 item 8: a task the connection does not allow is named as that, with its fix.
  const notAllowed = m.discoverSetupBlockers({
    ...base,
    plan: {
      blockers: [],
      allowedDataClasses: ['public'],
      allowedTaskClasses: ['research_synthesis'],
    },
    model: 'm1',
    unqualified: ['research_synthesis', 'scoring'],
  });
  assert.deepEqual(
    notAllowed.map((b) => [b.text, b.fix?.view]),
    [
      [
        "Scoring is not allowed on this connection, so the model can't be qualified for it yet. Allow it under Models and connections (Allow all tasks, or tick it in Change caps or allowed work). Qualify the model for scoring under Models and connections › Qualify a model.",
        'models',
      ],
      [
        "The model is not qualified for research synthesis. The app can't qualify research synthesis yet; that is planned for a later update.",
        'models',
      ],
    ],
  );
  const ready = m.discoverSetupBlockers({
    ...base,
    plan: { blockers: [], allowedDataClasses: ['public'] },
    model: 'm1',
  });
  assert.deepEqual(ready, []);
  const api = m.discoverSetupBlockers({ ...base, route: 'api', envelopes: 2 });
  assert.deepEqual(
    api.map((b) => b.fix?.view),
    ['budgets', 'budgets'],
  );
  assert.match(api[0]!.text, /belongs to its own run/);
  assert.deepEqual(
    m.discoverSetupBlockers({
      ...base,
      route: 'api',
      envelopes: 1,
      usableEnvelopes: 1,
      pricing: 1,
    }),
    [],
  );
});

test("Discover's model access names the plan the connection runs on", async () => {
  const m = await load<{
    routeText(
      kind: 'api' | 'subscription',
      plan: { kind?: string; label: string } | undefined,
      model: string,
      fixture: boolean,
      budget: string | undefined,
    ): string;
    plansOffered(kinds: readonly string[]): string;
  }>('discover-defaults.ts');
  const claude = m.routeText(
    'subscription',
    { kind: 'claude_code', label: 'Claude Code' },
    'claude-sonnet',
    false,
    undefined,
  );
  assert.equal(claude, 'Claude plan · Claude Code · claude-sonnet');
  assert.equal(
    m.routeText(
      'subscription',
      { kind: 'chatgpt_plan', label: 'Work' },
      '',
      false,
      undefined,
    ),
    'ChatGPT plan · Work · no verified model',
  );
  assert.equal(
    m.routeText('api', undefined, '', true, 'Studio budget'),
    'Fixture · budget Studio budget',
  );
  assert.equal(m.plansOffered(['claude_code']), 'Claude plan');
  assert.equal(m.plansOffered(['chatgpt_plan']), 'ChatGPT plan');
  assert.equal(
    m.plansOffered(['claude_code', 'chatgpt_plan', 'claude_code']),
    'ChatGPT or Claude plan',
  );
  assert.equal(m.plansOffered([]), 'Subscription plan');
});

test('PR #172 review M-1: "not qualified" texts point only at fixes that exist', async () => {
  const m = await load<Mod>('discover-defaults.ts');
  // The Chat discovery card on a connection allowing only summarization: the discovery roles
  // can be allowed in the app, but only scoring can be qualified there.
  const card = m.missingTaskTexts(
    'gpt-6-astra',
    ['research_synthesis', 'candidate_generation', 'scoring'],
    ['summarization'],
  );
  assert.equal(card.length, 1);
  assert.match(
    card[0]!,
    /^Research synthesis, candidate generation and scoring are not allowed on this connection/,
  );
  assert.match(card[0]!, /Allow all tasks, or tick them in Change caps/);
  assert.match(
    card[0]!,
    /Qualify gpt-6-astra for scoring under Models and connections › Qualify a model\./,
  );
  assert.match(
    card[0]!,
    /can't qualify research synthesis and candidate generation yet; that is planned/,
  );
  assert.doesNotMatch(card.join(' '), /Allow this task/);
  // Explore for me once research synthesis is allowed: never sent to Qualify a model for it.
  const explore = m.missingTaskTexts(
    'gpt-6-astra',
    ['research_synthesis'],
    ['research_synthesis'],
  );
  assert.deepEqual(explore, [
    "gpt-6-astra is not qualified for research synthesis. The app can't qualify research synthesis yet; that is planned for a later update.",
  ]);
  assert.doesNotMatch(explore[0]!, /Qualify a model/);
  assert.deepEqual(m.missingTaskTexts('m', [], ['scoring']), []);
});
