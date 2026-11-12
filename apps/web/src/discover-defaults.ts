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
  /** ADR-0087: owner fixes offered beside the text, in place (fix-buttons.tsx). */
  acts?: FixAction[];
};

/**
 * Plain-words setup steps for a discovery start. Missing evidence or brief fields are not
 * here: they are things to write, not setup. A default never clears one of these.
 */
export function discoverSetupBlockers(input: {
  route: RouteKind;
  connectionError: string;
  plan: {
    /** The connection, so its fixes can name it (ADR-0087). */
    id?: string;
    blockers: readonly string[];
    /** ADR-0087: the same refusals with their codes, in the same order as `blockers`. */
    refusals?: readonly { code: string; text: string }[];
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
  /** ADR-0087: which discovery tasks the app can qualify (fix-buttons `canQualifyFor`). */
  canQualify?: (task: string) => boolean;
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
      const id = input.plan.id;
      const coded = new Map(
        (input.plan.refusals ?? []).map((r) => [r.text, r.code]),
      );
      for (const b of input.plan.blockers)
        out.push({
          text: b,
          fix: models,
          ...(id && coded.get(b) === 'caps_not_accepted'
            ? { acts: [{ kind: 'accept_caps' as const, connection_id: id }] }
            : {}),
        });
      if (!input.plan.allowedDataClasses.includes(input.dataClass))
        out.push({
          text: 'This connection does not permit the selected evidence sharing class.',
          fix: models,
          ...(id
            ? {
                acts: [
                  {
                    kind: 'allow_data' as const,
                    connection_id: id,
                    data_class: input.dataClass,
                  },
                ],
              }
            : {}),
        });
      if (!input.model && input.plan.blockers.length === 0)
        out.push({
          text: 'This connection has no verified model yet.',
          fix: models,
        });
      // P23 item 8: a task the connection does not allow is named as such, and each fix
      // named is one that exists (review of PR #172, M-1).
      // Without the allowed list, every missing task is read as allowed.
      const allowed = input.plan.allowedTaskClasses ?? input.unqualified;
      const texts = missingTaskTexts('the model', input.unqualified, allowed);
      // ADR-0087: the "not allowed" sentence comes first and gets "allow (and qualify)";
      // the "not qualified" one gets "Qualify now" per task the app can qualify.
      const acts = id
        ? missingTaskFixes(
            id,
            input.model || null,
            input.unqualified,
            allowed,
            'discovery',
            input.canQualify ?? (() => false),
          )
        : [];
      const allow = acts.filter((a) => a.kind === 'allow_tasks');
      const qualify = acts.filter((a) => a.kind === 'qualify');
      const notAllowedFirst = input.unqualified.some(
        (t) => !allowed.includes(t),
      );
      texts.forEach((text, i) => {
        const mine = notAllowedFirst && i === 0 ? allow : qualify;
        out.push({ text, fix: models, ...(mine.length ? { acts: mine } : {}) });
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

/**
 * Task classes that Models and connections › Qualify a model has a benchmark for, so the app
 * itself can qualify them: the bundled benchmarks plus the discovery ones the server offers
 * (ADR-0089, P34). A test keeps this equal to both lists, and another that the server offers a
 * role-current manifest for every discovery class. The installed app has no command line, so the
 * text does not name one (re-review N-A).
 */
export const QUALIFY_IN_APP: readonly string[] = [
  'specification',
  'summarization',
  'patch_build',
  'independent_review',
  'scoring',
  'research_synthesis',
  'candidate_generation',
];

/**
 * P23 item 8: what a model missing tasks needs, in words that point only at fixes that exist.
 * `notAllowed` are tasks the connection does not allow (so they can't be qualified yet);
 * `unqualified` are allowed tasks the model is not qualified for. `subject` is the model's
 * name or "the model".
 */
export function taskBlockerTexts(
  subject: string,
  notAllowed: readonly string[],
  unqualified: readonly string[],
): string[] {
  const out: string[] = [];
  // "a", "a and b", "a, b and c" (PR #172 re-review N-B).
  const names = (xs: readonly string[]) => {
    const w = xs.map((x) => x.replaceAll('_', ' '));
    return w.length < 2
      ? (w[0] ?? '')
      : `${w.slice(0, -1).join(', ')} and ${w[w.length - 1]}`;
  };
  const sentence = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
  const qualifyHow = (xs: readonly string[]) => {
    const inApp = xs.filter((x) => QUALIFY_IN_APP.includes(x));
    const cli = xs.filter((x) => !QUALIFY_IN_APP.includes(x));
    return [
      ...(inApp.length
        ? [
            // ADR-0089: every caller is a discovery step, and scoring has two benchmarks.
            `Qualify ${subject} for ${names(inApp)} under Models and connections › Qualify a model, with the benchmarks marked "for discovery".`,
          ]
        : []),
      // A guard since P34 (PR #175 review N-2): every discovery class is in QUALIFY_IN_APP, so
      // only a task with no benchmark in the app (code build) reaches this.
      ...(cli.length
        ? [
            `The app can't qualify ${names(cli)} yet; that is planned for a later update.`,
          ]
        : []),
    ].join(' ');
  };
  if (notAllowed.length) {
    const one = notAllowed.length === 1;
    out.push(
      sentence(
        `${names(notAllowed)} ${one ? 'is' : 'are'} not allowed on this connection, so ${subject} can't be qualified for ${one ? 'it' : 'them'} yet. Allow ${one ? 'it' : 'them'} under Models and connections (Allow all tasks, or tick ${one ? 'it' : 'them'} in Change caps or allowed work). ${qualifyHow(notAllowed)}`,
      ),
    );
  }
  if (unqualified.length)
    out.push(
      // A model id keeps its own case; only "the model" starts with a capital.
      `${subject.startsWith('the ') ? sentence(subject) : subject} is not qualified for ${names(unqualified)}. ${qualifyHow(unqualified)}`,
    );
  return out;
}

/**
 * The same, from the tasks a model is missing and what the connection allows: the Chat
 * discovery card, Discover › Explore for me and Discover's setup blockers all call this, so
 * one test pins their wording (review of PR #172, N-3).
 */
export const missingTaskTexts = (
  subject: string,
  missing: readonly string[],
  allowed: readonly string[],
): string[] =>
  taskBlockerTexts(
    subject,
    missing.filter((tc) => !allowed.includes(tc)),
    missing.filter((tc) => allowed.includes(tc)),
  );

/**
 * ADR-0087 (P27): which qualifications a fix may run. Each server route counts only
 * qualifications on a benchmark for its own role: discovery and Explore for me count only
 * discovery benchmarks, automatic assessment only the assessment benchmark, and the build and
 * spec roles any (connection-store `currentForDiscoveryRole`, `currentForAssessmentRole`).
 */
export type QualifyRole = 'discovery' | 'assessment' | 'plan';

/**
 * ADR-0087 (P27): a fix a refusal offers in place (fix-buttons.tsx draws it). Every fix is the
 * owner's own Models and connections route with the same confirmation.
 */
export type FixAction =
  /** Accept the connection's current caps and allowed work, after showing them. */
  | { kind: 'accept_caps'; connection_id: string }
  /** Allow one data class on the connection. */
  | { kind: 'allow_data'; connection_id: string; data_class: string }
  /**
   * Allow tasks on the connection; with a model, then qualify it for `qualify` (the ones the
   * app has a benchmark for in this role), one after another.
   */
  | {
      kind: 'allow_tasks';
      connection_id: string;
      tasks: string[];
      model_id: string | null;
      qualify: string[];
      role: QualifyRole;
    }
  /** Start and run the app's benchmark for this role and task. */
  | {
      kind: 'qualify';
      connection_id: string;
      model_id: string;
      task_class: string;
      role: QualifyRole;
    }
  /** ADR-0094: add 20 requests to a used-up daily cap for the next 24 hours. */
  | { kind: 'extra_requests'; connection_id: string };

/**
 * The fixes for a model missing tasks: allow the ones not allowed (and then qualify them),
 * qualify the others. `canQualify` says which tasks the app has a benchmark for in `role`;
 * a task without one gets no qualify button, only the words saying so.
 */
export function missingTaskFixes(
  connection_id: string,
  /** The model to qualify; none (unverified) offers only the allow (P27 review N-2). */
  model_id: string | null,
  missing: readonly string[],
  allowed: readonly string[],
  role: QualifyRole,
  canQualify: (task: string) => boolean,
): FixAction[] {
  const notAllowed = missing.filter((t) => !allowed.includes(t));
  const out: FixAction[] = [];
  if (notAllowed.length)
    out.push({
      kind: 'allow_tasks',
      connection_id,
      tasks: notAllowed,
      model_id: model_id || null,
      qualify: model_id ? notAllowed.filter(canQualify) : [],
      role,
    });
  if (model_id)
    for (const t of missing)
      if (allowed.includes(t) && canQualify(t))
        out.push({
          kind: 'qualify',
          connection_id,
          model_id,
          task_class: t,
          role,
        });
  return out;
}
