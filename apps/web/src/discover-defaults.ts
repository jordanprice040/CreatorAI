// P04 (R10–R12): the routine settings of a discovery start, where each value came from, and
// a project preset the person can save. Pure functions with no imports, so the rules load in
// tests without a browser. Defaults only fill routine fields: they never add evidence, claim
// a qualification, grant permission or raise a cap. The server still checks every request.

export type DataClass = 'synthetic' | 'public' | 'private_approved';
export type Oversight = 'human_in_loop' | 'supervised';
export type RouteKind = 'api' | 'subscription';

/** The routine fields of the Discover form that a default or a preset may fill. */
export type RoutineSettings = {
  timeLimit: string;
  budgetLimit: string;
  constraints: string;
  dataAndTools: string;
  dataClass: DataClass;
  revisions: number;
  oversight: Oversight;
  allowCalls: boolean;
  route: RouteKind;
};

export type SettingSource = 'studio' | 'preset' | 'edited';

export const SOURCE_TEXT: Record<SettingSource, string> = {
  studio: 'studio default',
  preset: 'your saved preset',
  edited: 'changed here',
};

/** The studio's own defaults, the same values the form always started with. */
export function studioDefaults(fixture: boolean): RoutineSettings {
  return {
    timeLimit: 'Six weeks',
    budgetLimit: fixture
      ? 'Fixture budget only; no paid services'
      : 'No extra metered spending',
    constraints: fixture
      ? 'Synthetic data only.'
      : 'Use permitted public evidence only.',
    dataAndTools: '',
    dataClass: fixture ? 'synthetic' : 'public',
    revisions: 1,
    oversight: 'human_in_loop',
    allowCalls: true,
    route: fixture ? 'api' : 'subscription',
  };
}

const DATA_CLASSES: readonly DataClass[] = [
  'synthetic',
  'public',
  'private_approved',
];

/**
 * Reads a stored preset, keeping only well-formed known fields. Anything else (an older
 * shape, a hand edit, a value outside the form's choices) is dropped, so a preset can never
 * put an unchecked value into the form. A fixture workspace never takes a non-synthetic
 * data class from a preset, and no preset holds the private class. A blank time limit or
 * budget constraint is dropped, so the studio default stays.
 */
export function parsePreset(
  raw: unknown,
  fixture: boolean,
): Partial<RoutineSettings> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: Partial<RoutineSettings> = {};
  const text = (
    k: 'timeLimit' | 'budgetLimit' | 'constraints' | 'dataAndTools',
    max: number,
  ) => {
    const v = r[k];
    if (typeof v === 'string' && v.length <= max) out[k] = v;
  };
  // The brief needs both; a blank one would only fail later inside a folded field (review L-2).
  const filled = (k: 'timeLimit' | 'budgetLimit') => {
    const v = r[k];
    if (typeof v === 'string' && v.trim() && v.length <= 300) out[k] = v;
  };
  filled('timeLimit');
  filled('budgetLimit');
  text('constraints', 4000);
  text('dataAndTools', 4000);
  if (
    typeof r.dataClass === 'string' &&
    (DATA_CLASSES as readonly string[]).includes(r.dataClass) &&
    (!fixture || r.dataClass === 'synthetic') &&
    // Sharing private data is always chosen on purpose for each start, never by a preset
    // (review N-5).
    r.dataClass !== 'private_approved'
  )
    out.dataClass = r.dataClass as DataClass;
  if (r.revisions === 0 || r.revisions === 1 || r.revisions === 2)
    out.revisions = r.revisions;
  if (r.oversight === 'human_in_loop' || r.oversight === 'supervised')
    out.oversight = r.oversight;
  if (typeof r.allowCalls === 'boolean') out.allowCalls = r.allowCalls;
  if (r.route === 'api' || r.route === 'subscription') out.route = r.route;
  return out;
}

/** The starting values: the studio defaults with the saved preset laid over them. */
export function startingSettings(
  fixture: boolean,
  preset: Partial<RoutineSettings>,
): RoutineSettings {
  return { ...studioDefaults(fixture), ...preset };
}

/** Where the value now in the form came from. */
export function sourceOf<K extends keyof RoutineSettings>(
  key: K,
  value: RoutineSettings[K],
  fixture: boolean,
  preset: Partial<RoutineSettings>,
): SettingSource {
  if (key in preset) return preset[key] === value ? 'preset' : 'edited';
  return studioDefaults(fixture)[key] === value ? 'studio' : 'edited';
}

/** A preset is kept per person and per workspace. */
export const presetKey = (actor: string, ws: string) =>
  `creator.discover-preset.${actor}.${ws}`;

/** Guided or Advanced, kept per person (not per workspace): it is how they like to work. */
export const presentationKey = (actor: string) =>
  `creator.presentation.${actor}`;

export type Presentation = 'guided' | 'advanced';

export const parsePresentation = (raw: unknown): Presentation =>
  raw === 'advanced' ? 'advanced' : 'guided';

/** A plan connection as the Discover form sees it (a subset of the API's detail). */
export type PlanChoice = {
  id: string;
  blockers: readonly string[];
  allowedDataClasses: readonly string[];
  /** Verified Responses models, each with the task classes it is qualified for. */
  models: readonly { id: string; qualified: readonly string[] }[];
};

/**
 * The default connection and model for a discovery start: the first connection with no
 * blockers that allows the data class and has a verified model qualified for every task
 * class a discovery uses. When none is ready, the first connection and its first verified
 * model, so the blockers it shows say what to set up. A choice the person made is kept even
 * when it is not ready: the form then shows why it cannot start.
 */
export function defaultPlanChoice(
  plans: readonly PlanChoice[],
  dataClass: string,
  taskClasses: readonly string[],
): { connection: string; model: string } {
  for (const p of plans) {
    if (p.blockers.length || !p.allowedDataClasses.includes(dataClass))
      continue;
    const m = p.models.find((x) =>
      taskClasses.every((tc) => x.qualified.includes(tc)),
    );
    if (m) return { connection: p.id, model: m.id };
  }
  const first = plans[0];
  return { connection: first?.id ?? '', model: first?.models[0]?.id ?? '' };
}

/** The tabs a setup step can send the person to; a literal union so a typo fails to compile. */
export type SetupView = 'models' | 'budgets';

/** One reason something cannot start yet, with the tab that can fix it when there is one. */
export type Blocker = {
  text: string;
  fix?: { view: SetupView; label: string };
};

/**
 * Plain-words setup steps for a discovery start. Missing evidence or brief fields are not
 * here: they are things to write, not setup. A default never clears one of these.
 */
export function discoverSetupBlockers(input: {
  route: RouteKind;
  connectionError: string;
  plan: {
    blockers: readonly string[];
    allowedDataClasses: readonly string[];
    /** P23 item 8: so a task that is not allowed is named as such, not as "not qualified". */
    allowedTaskClasses?: readonly string[];
  } | null;
  dataClass: string;
  model: string;
  unqualified: readonly string[];
  envelopes: number;
  usableEnvelopes: number;
  pricing: number;
  fixture: boolean;
}): Blocker[] {
  const models = {
    view: 'models' as const,
    label: 'Open Models and connections',
  };
  const budgets = { view: 'budgets' as const, label: 'Open Budgets' };
  if (input.route === 'subscription') {
    const out: Blocker[] = [];
    if (input.connectionError) out.push({ text: input.connectionError });
    if (!input.plan)
      out.push({
        text: 'Add and verify a ChatGPT-plan connection.',
        fix: models,
      });
    else {
      for (const b of input.plan.blockers) out.push({ text: b, fix: models });
      if (!input.plan.allowedDataClasses.includes(input.dataClass))
        out.push({
          text: 'This connection does not permit the selected evidence sharing class.',
          fix: models,
        });
      if (!input.model && input.plan.blockers.length === 0)
        out.push({
          text: 'This connection has no verified model yet.',
          fix: models,
        });
      for (const tc of input.unqualified)
        out.push({
          text:
            input.plan.allowedTaskClasses &&
            !input.plan.allowedTaskClasses.includes(tc)
              ? `${tc.replaceAll('_', ' ')} is not allowed on this connection, so the model can't be qualified for it yet. Allow it under Models and connections, then qualify it.`
              : `The model is not qualified for ${tc.replaceAll('_', ' ')}.`,
          fix: models,
        });
    }
    return out;
  }
  const out: Blocker[] = [];
  if (input.envelopes === 0)
    out.push({ text: 'Add an active budget.', fix: budgets });
  else if (input.usableEnvelopes === 0)
    out.push({
      text: 'No active budget can be used by this run: a run or task budget belongs to its own run. Choose another run, or add a shared budget.',
      fix: budgets,
    });
  if (input.pricing === 0)
    out.push({
      text: input.fixture
        ? 'Add fixture pricing.'
        : 'Add a pricing snapshot for the model.',
      fix: budgets,
    });
  return out;
}

/** ADR-0082: the plan a connection runs on, by name, for summaries and option labels. */
export const planName = (kind: string | undefined) =>
  kind === 'claude_code' ? 'Claude plan' : 'ChatGPT plan';

/**
 * The model-access part of Discover's routine summary. A plan route names its plan (Claude
 * or ChatGPT), so a Claude Code connection never reads as the ChatGPT plan.
 */
export function routeText(
  kind: 'api' | 'subscription',
  plan: { kind?: string; label: string } | undefined,
  model: string,
  fixture: boolean,
  budgetName: string | undefined,
) {
  return kind === 'subscription'
    ? `${plan ? planName(plan.kind) : 'Plan'} · ${plan?.label ?? 'no connection yet'} · ${model || 'no verified model'}`
    : `${fixture ? 'Fixture' : 'API'} · budget ${budgetName ?? 'none yet'}`;
}

/** The "Model access" option label: the plans the workspace's connections run on. */
export function plansOffered(kinds: readonly string[]) {
  const names = [...new Set(kinds.map(planName))].sort();
  if (!names.length) return 'Subscription plan';
  if (names.length === 1) return names[0]!;
  return names.map((n) => n.replace(' plan', '')).join(' or ') + ' plan';
}
