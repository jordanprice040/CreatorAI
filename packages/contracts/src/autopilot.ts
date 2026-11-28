import { z, id, hash, version, counter, timestamp } from './primitives.js';
import {
  DataClassSchema,
  RoutinePolicyRequestSchema,
  ReviseRoutinePolicyRequestSchema,
  type RoutinePolicyInput,
  type RoutineStage,
} from './oversight.js';
import { EvidenceRoleSchema, ResponseTypeSchema } from './discovery.js';
import { ExploreScopeSchema } from './exploration.js';
import { WebDiscoveryScopeSchema } from './web-discovery.js';
import { WorkflowResourceSetupSchema } from './orchestration.js';
import { PLAN_RECONCILE_HINT } from './connections.js';
import {
  AutopilotFallbackSchema,
  AutopilotNextSchema,
  AutopilotStopKindSchema,
  SETTING_FOR_STOP,
  AUTOPILOT_SETTING_TEXT,
  settingIsOn,
  type AutopilotSettingsValues,
  type AutopilotNext,
  type AutopilotStopKind,
} from './autopilot-settings.js';

// P13 (ADR-0092): an autopilot runs one run's whole main path without a person between steps:
// (search the web) → explore the evidence → turn the first candidate into a brief → discovery
// (problem and options) → automatic assessment → selection by a fixed rule → a proposal for a
// non-code option. Each step is the same server operation the forms use, started under the
// owner's start and admitted by the run's routine approval policy (ADR-0079), so nothing here
// grants authority. Application code chooses between steps by fixed rules and stops with an
// honest outcome when a step needs a person, an approval, or more budget than is left.

const short = z.string().trim().min(1).max(300);

export const AUTOPILOT_POLICY_VERSION = 'autopilot/1.0' as const;

/** The steps an autopilot can take, in order. `research` is optional; `proposal` ends a non-code path. */
export const AutopilotStageSchema = z.enum([
  'research',
  'explore',
  'brief',
  'discover',
  'assess',
  'select',
  'proposal',
  'spec',
  /** ADR-0100: a fallback that links claims and searches the web, then goes back a step. */
  'gather',
]);
export type AutopilotStage = z.infer<typeof AutopilotStageSchema>;

export const AUTOPILOT_STAGE_LABEL: Record<AutopilotStage, string> = {
  research: 'Search the web',
  explore: 'Explore the evidence',
  brief: 'Write the brief',
  discover: 'Find the problem and options',
  assess: 'Assess the options',
  select: 'Choose an option',
  proposal: 'Write the proposal',
  spec: 'Specify the software',
  gather: 'Gather more evidence',
};

/**
 * How a finished autopilot ended. `proposal` is the only result reached by this slice; a
 * selected software option stops as `needs_person` at `spec` (autopilots do not write specs).
 */
export const AutopilotOutcomeSchema = z.enum([
  /** A non-code proposal was saved for the chosen option. */
  'proposal',
  /** No usable evidence, no candidate problem, or discovery found the evidence insufficient. */
  'insufficient_evidence',
  /** Discovery returned no options, or the first-ranked option cannot take any advancing choice. */
  'no_eligible_option',
  /** A person's judgment is needed (a tie, an unstable ranking, ethics, humility, a spec). */
  'needs_person',
  /** A step was not admitted: no grant or policy covered it, or a connection refused it. */
  'needs_authority',
  /** The autopilot's call limit or end time, or a connection cap, was reached. */
  'limit_reached',
  /** A step failed (for example a malformed answer after its repairs). */
  'failed',
  'cancelled',
]);
export type AutopilotOutcome = z.infer<typeof AutopilotOutcomeSchema>;

/**
 * P-11 (ADR-0100): whether an autopilot that finished like this ends the routine approvals made
 * for it. They stay only while it waits for a person's input (a stop Continue can pick up); a
 * final result, a cancel or a failed step (after any retries its settings allow) ends them.
 */
export function autopilotEndsApprovals(
  a: Pick<Autopilot, 'state' | 'outcome' | 'steps'>,
): boolean {
  return (
    a.state === 'finished' &&
    (a.outcome === 'failed' ||
      // The end time is left out: an autopilot past it keeps its approvals until it ends.
      !autopilotContinuable({
        state: a.state,
        outcome: a.outcome,
        steps: a.steps,
      }).ok)
  );
}

/** Outcomes a person can continue from (the stopped step is tried again). */
export const AUTOPILOT_RETRYABLE: readonly AutopilotOutcome[] = [
  'needs_person',
  'needs_authority',
  'limit_reached',
  'failed',
];
/**
 * ADR-0100 (review 1 M-1): thin evidence and a first option that cannot be advanced end with
 * these outcomes, but a setting covers them and a person can add evidence or scores, so they are
 * stops Continue (and Allow and continue) can pick up.
 */
export const SETTLED_BUT_COVERED: readonly AutopilotOutcome[] = [
  'insufficient_evidence',
  'no_eligible_option',
];

export const AutopilotStepStateSchema = z.enum([
  'running',
  'done',
  'skipped',
  'stopped',
]);
export const AutopilotChildKindSchema = z.enum([
  'web_discovery',
  'workflow',
  'search_brief',
  'selection',
  'proposal',
]);
export const AutopilotStepSchema = z.strictObject({
  stage: AutopilotStageSchema,
  /** 1 for the first try; a retry of a stopped step adds a new attempt. */
  attempt: counter.min(1),
  state: AutopilotStepStateSchema,
  /** The record the step started or made (a workflow, a brief, a selection, a proposal). */
  child: z.strictObject({ kind: AutopilotChildKindSchema, id }).nullable(),
  /** Model calls or plan requests set aside for this step from the autopilot's limit. */
  calls: counter,
  /** The problem and option this step carried forward, when it has one. */
  problem: z.strictObject({ id, version }).nullable(),
  option: z
    .strictObject({
      id,
      version,
      kind: z.string().max(40),
      title: z.string().max(500),
    })
    .nullable(),
  /**
   * The exact request this step sends and its idempotency key, recorded before it is sent, so
   * a restart repeats the same request (the server returns what it made the first time).
   */
  request: z.record(z.string(), z.unknown()).nullable(),
  key: z.string().max(200).nullable(),
  note: z.string().max(1200),
  /**
   * Set on a stopped step that Continue cannot get past (the call limit is the autopilot's own
   * and cannot be raised; the spec is the owner's): why, and what to do instead.
   */
  no_retry: z.string().max(300).nullable().optional(),
  /** The question a stopped step left open for a person (a decision id), if any. */
  asked: id.nullable().optional(),
  /** ADR-0100: what kind of stop this was, for the matching setting and next steps. */
  stop_kind: AutopilotStopKindSchema.nullable().optional(),
  /** ADR-0100: the owner's setting that let this step take a fallback instead of stopping. */
  fallback: AutopilotFallbackSchema.nullable().optional(),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
});
export type AutopilotStep = z.infer<typeof AutopilotStepSchema>;

/**
 * The fewest calls the shortest path can use: exploring (2), discovery with two response types (4)
 * and assessing one request (2). Fewer would be certain to stop at the call limit (review N-2).
 */
export const AUTOPILOT_MIN_CALLS = 8;

export const AutopilotLimitsSchema = z.strictObject({
  /**
   * Model calls (or plan requests) the whole autopilot may use, every step together, with their
   * repairs. Each step sets aside its own maximum before it starts.
   */
  max_calls: z.number().int().min(AUTOPILOT_MIN_CALLS).max(1000),
  /** The autopilot stops when this passes; steps are sized to finish before it. */
  ends_at: timestamp,
});
export type AutopilotLimits = z.infer<typeof AutopilotLimitsSchema>;

export const AutopilotResearchSchema = z.strictObject({
  /** A ChatGPT plan connection (web search runs only there, ADR-0086). */
  connection_id: id,
  model_id: z.string().trim().min(1).max(200),
  scope: WebDiscoveryScopeSchema,
  /** The web discovery preview's input hash the owner saw. */
  input_hash: hash,
});

/**
 * Where an autopilot enters the path (for P33's "automate the rest"): from the beginning (null),
 * or at assessment or selection of a problem already recorded, at its current version.
 */
export const AutopilotStartSchema = z.strictObject({
  stage: z.enum(['assess', 'select']),
  problem: z.strictObject({ id, version }),
});
export type AutopilotStart = z.infer<typeof AutopilotStartSchema>;

export const AutopilotConfigSchema = z
  .strictObject({
    /** The model route every model step uses. */
    resource_setup: WorkflowResourceSetupSchema,
    data_class: DataClassSchema,
    /** Search the web first (P12). Null: work from the claims already recorded. */
    research: AutopilotResearchSchema.nullable().default(null),
    explore: ExploreScopeSchema.default(ExploreScopeSchema.parse({})),
    /**
     * What the chosen problem's claims show, for discovery (the owner's judgment, as on the
     * Chat card). Software options need `data` and `tool_gap`; existing tools need `existing_tool`.
     */
    evidence_roles: z
      .array(EvidenceRoleSchema)
      .min(1)
      .max(8)
      .refine((x) => new Set(x).size === x.length, 'List each role once.')
      .default(['problem']),
    perspectives: z
      .array(ResponseTypeSchema)
      .min(2)
      .max(5)
      .default(ResponseTypeSchema.options),
    excluded: z
      .array(z.strictObject({ perspective: ResponseTypeSchema, reason: short }))
      .max(3)
      .default([]),
    max_revisions: z.number().int().min(0).max(2).default(1),
    limits: AutopilotLimitsSchema,
    /** Enter the path part way, at a recorded problem (null: from the beginning). */
    start: AutopilotStartSchema.nullable().default(null),
    /**
     * ADR-0124 (F2): when the plan account's usage limit or the connection's daily request cap
     * stops it, continue by itself once that limit has room again, inside the run's approvals,
     * the call limit and the end time. Off unless the owner ticks it (absent means off).
     */
    resume_after_limit: z.boolean().optional(),
  })
  .superRefine((r, ctx) => {
    const named = [...r.perspectives, ...r.excluded.map((e) => e.perspective)];
    if (
      new Set(named).size !== named.length ||
      named.length !== ResponseTypeSchema.options.length
    )
      ctx.addIssue({
        code: 'custom',
        path: ['perspectives'],
        message:
          'Name every response type once, as a perspective or an exclusion with a reason.',
      });
    if (!r.perspectives.some((p) => p !== 'software'))
      ctx.addIssue({
        code: 'custom',
        path: ['perspectives'],
        message: 'Include at least one response that is not new software.',
      });
    if (r.research && r.data_class !== 'public' && r.data_class !== 'synthetic')
      ctx.addIssue({
        code: 'custom',
        path: ['research'],
        message: 'Web search reads public pages; use public or synthetic data.',
      });
    if (r.research && r.limits.max_calls < AUTOPILOT_MIN_CALLS + 2)
      ctx.addIssue({
        code: 'custom',
        path: ['limits', 'max_calls'],
        message: `Searching the web first takes 2 more calls: allow at least ${AUTOPILOT_MIN_CALLS + 2}.`,
      });
    if (r.resume_after_limit && r.resource_setup.kind !== 'subscription')
      ctx.addIssue({
        code: 'custom',
        path: ['resume_after_limit'],
        message:
          'Continuing after a usage limit resets is for a plan connection; an API budget or a local model has no such limit.',
      });
    if (r.start && r.research)
      ctx.addIssue({
        code: 'custom',
        path: ['research'],
        message:
          'An autopilot that starts at a recorded problem does not search the web first.',
      });
  });
export type AutopilotConfig = z.infer<typeof AutopilotConfigSchema>;

/**
 * ADR-0099 (P33, review L-1): the run's routine approvals set or widened in the same transaction
 * as the level or autopilot that needs them, so a refused start never leaves them changed.
 */
export const RoutinePolicyChangeSchema = z
  .discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('new'),
      policy: RoutinePolicyRequestSchema,
    }),
    z.strictObject({
      kind: z.literal('revise'),
      policy_id: id,
      policy: ReviseRoutinePolicyRequestSchema,
    }),
  ])
  .nullable()
  .default(null);
export type RoutinePolicyChange = z.infer<typeof RoutinePolicyChangeSchema>;

export const StartAutopilotRequestSchema = z.strictObject({
  config: AutopilotConfigSchema,
  /** The summary lines the owner confirmed; refused when they differ from `autopilotSummary`. */
  summary_seen: z.array(z.string().max(600)).min(1).max(20),
  /** The run's routine approvals to set or widen first, in the same transaction (P33). */
  routine_policy: RoutinePolicyChangeSchema,
});
export type StartAutopilotRequest = z.infer<typeof StartAutopilotRequestSchema>;

/**
 * Stop and Continue. Continue names the version the owner saw; Stop always wins (the runner
 * moves the version on between steps, and stopping is never the riskier choice).
 */
export const AutopilotControlRequestSchema = z.strictObject({
  expected_version: version.optional(),
  reason: short.optional(),
});

/**
 * ADR-0124 (F2): where an autopilot that opted in to continuing after a usage limit stands.
 * Worked out when read from its record; never stored as such.
 */
export const AutopilotAutoResumeSchema = z.strictObject({
  /**
   * `waiting`: stopped on a usage limit and will check again; `on`: opted in, not stopped on a
   * limit now; `turned_off`: the owner turned it off; `used_up`: every automatic continue is used.
   */
  state: z.enum(['on', 'waiting', 'turned_off', 'used_up']),
  /** Automatic continues made so far, and the most it may make. */
  checks: counter,
  max: counter,
  /** While waiting: when it next checks the limit (null otherwise). */
  next_check_at: timestamp.nullable(),
  turned_off_at: timestamp.nullable(),
});
export type AutopilotAutoResume = z.infer<typeof AutopilotAutoResumeSchema>;

export const AutopilotSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  fixture: z.boolean(),
  config: AutopilotConfigSchema,
  config_hash: hash,
  summary: z.array(z.string().max(600)),
  policy_version: z.string().max(40),
  state: z.enum(['running', 'finished']),
  /** The step working now, or the last one tried. */
  stage: AutopilotStageSchema,
  outcome: AutopilotOutcomeSchema.nullable(),
  /** Why it stopped or what it is doing, in plain words for the owner. */
  explanation: z.string().max(1200),
  steps: z.array(AutopilotStepSchema).max(60),
  /** Calls set aside so far, every step together; never more than `config.limits.max_calls`. */
  calls_reserved: counter,
  version,
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
  finished_at: timestamp.nullable(),
  /** True while this studio process is driving it. */
  active: z.boolean(),
  /** P33 (ADR-0099): the "Automate selection" level that started it, if one did. */
  automation_id: id.nullable(),
  /**
   * P-11 (ADR-0100): the routine approvals made for this autopilot when it started (absent when
   * it used approvals the run already had), and when they ended with it.
   */
  routine_policy_id: id.nullable().optional(),
  approvals_ended_at: timestamp.nullable().optional(),
  /** ADR-0100: what to do next when it stopped (computed when read, never stored). */
  next: z.array(AutopilotNextSchema).max(8).optional(),
  /** ADR-0124 (F2): present when the owner opted in to continuing after a usage limit. */
  auto_resume: AutopilotAutoResumeSchema.optional(),
});
export type Autopilot = z.infer<typeof AutopilotSchema>;

/**
 * Whether Continue can get past where a finished autopilot stopped, and if not, why. A stop for a
 * person or an approval, a connection cap or a failed step can be continued; a stop at the spec,
 * at the autopilot's own call limit, or after a cancel or a final result cannot.
 */
export function autopilotContinuable(
  a: Pick<Autopilot, 'state' | 'outcome' | 'steps'> &
    Partial<Pick<Autopilot, 'approvals_ended_at' | 'config'>>,
  now = Date.now(),
): { ok: true } | { ok: false; reason: string } {
  if (a.state !== 'finished') return { ok: false, reason: 'It is running.' };
  // Live rerun 3 (November 15): an old autopilot whose end time passed still showed Continue
  // (the store refuses it); it says so instead, so only a live one offers Continue.
  if (a.config && Date.parse(a.config.limits.ends_at) <= now)
    return {
      ok: false,
      reason: 'Its end time has passed; start a new autopilot.',
    };
  if (a.approvals_ended_at)
    return {
      ok: false,
      reason:
        'The routine approvals made for this autopilot ended when it stopped; start a new one.',
    };
  const covered =
    !!a.outcome &&
    SETTLED_BUT_COVERED.includes(a.outcome) &&
    !!SETTING_FOR_STOP[a.steps.at(-1)?.stop_kind ?? 'other'];
  if (!a.outcome || (!AUTOPILOT_RETRYABLE.includes(a.outcome) && !covered))
    return {
      ok: false,
      reason: `An autopilot that ended ${(a.outcome ?? 'running').replaceAll('_', ' ')} cannot continue; start a new one.`,
    };
  const last = a.steps.at(-1);
  if (last?.no_retry) return { ok: false, reason: last.no_retry };
  if (a.steps.length >= AUTOPILOT_MAX_STEPS - 4)
    return {
      ok: false,
      reason:
        'This autopilot has taken as many steps as one may; start a new one.',
    };
  return { ok: true };
}

/**
 * Autopilot friction pass (Jordan, November 28): the main-path steps still ahead of an autopilot,
 * after the one it is on (or, after a "gather more evidence" fallback, from the step it goes back
 * to). Fallbacks are not planned, so they never show here. After "Choose an option" it writes the
 * proposal; a software option stops at its spec instead, which the card says.
 */
export function autopilotPlannedStages(
  a: Pick<Autopilot, 'stage' | 'steps'>,
  /** A stopped autopilot Continue would pick up: its own stage is still ahead too. */
  stopped = false,
): AutopilotStage[] {
  const order: AutopilotStage[] = [
    'research',
    'explore',
    'brief',
    'discover',
    'assess',
    'select',
    'proposal',
  ];
  let from: string = a.stage;
  let include = stopped;
  if (from === 'gather') {
    const then = a.steps.at(-1)?.request?.then;
    if (typeof then !== 'string') return [];
    from = then;
    include = true;
  }
  const i = order.indexOf(from as AutopilotStage);
  if (i < 0) return [];
  return order.slice(include ? i : i + 1);
}

/**
 * Autopilot friction pass (November 28): the stop was a plan request with no recorded outcome
 * (or one still marked running) on the step's connection. Stops recorded before the
 * `open_request` kind existed were `connection` stops whose note names the reconcile hint.
 */
export function stopsOnOpenRequest(
  step: Pick<AutopilotStep, 'stop_kind' | 'note'> | undefined,
): boolean {
  if (!step) return false;
  if (step.stop_kind === 'open_request') return true;
  return (
    step.stop_kind === 'connection' &&
    (step.note ?? '').includes(PLAN_RECONCILE_HINT)
  );
}

/** ADR-0124 (F2): automatic continues one autopilot may make after usage limits (the database refuses more). */
export const AUTO_RESUME_MAX_CHECKS = 8;

/** Steps one autopilot may record (the database refuses more). */
export const AUTOPILOT_MAX_STEPS = 60;

/** Every route the autopilot can take, written from its settings. The owner confirms these lines. */
export function autopilotSummary(c: AutopilotConfig): string[] {
  const route =
    c.resource_setup.kind === 'subscription'
      ? `the plan connection's ${c.resource_setup.model_id}`
      : c.resource_setup.kind === 'local'
        ? `the local model ${c.resource_setup.model_id}`
        : 'the API budget and pricing chosen';
  const until = new Date(c.limits.ends_at).toISOString();
  const path = c.start
    ? [
        c.start.stage === 'assess'
          ? `It starts at the recorded problem (version ${c.start.problem.version}) and assesses every option.`
          : `It starts at the recorded problem (version ${c.start.problem.version}) and chooses from the scores already recorded; it makes no model call before choosing.`,
      ]
    : [
        c.research
          ? `First it searches the web once with ${c.research.model_id} and reads up to ${c.research.scope.max_fetches} pages; checked claims are added only where this run's routine approvals cover the evidence stage.`
          : 'It works from the claims already recorded in the workspace; it does not search the web.',
        `Then it explores the claims, writes a brief from the first candidate problem, runs discovery (${c.perspectives.length} response types, up to ${c.max_revisions} revision round${c.max_revisions === 1 ? '' : 's'}) and assesses every option.`,
        `Discovery reads the chosen problem's claims as evidence of: ${c.evidence_roles.map((r) => r.replaceAll('_', ' ')).join(', ')}.`,
      ];
  return [
    `The studio runs this run's main path for you with ${route}, one step after another, and stops with a reason when a step needs you.`,
    ...path,
    'It records a choice only when one option ranks first on suitability with no tie, every option that could be chosen is fully scored, the ranking holds when any criterion is removed or doubled, and nothing blocks that choice. The others are deferred with that reason. Its choice is recorded as the autopilot’s, not yours.',
    'If an option’s ethics gate was cleared only on the model’s word, it stops and asks you before choosing it. If you choose under Decide while it waits, Continue goes on with your choice.',
    'For a non-code option it saves a proposal drafted from the records. A software option first needs your humility review to be chosen, and writing and freezing its spec stays with you, so it stops there.',
    `Limits: at most ${c.limits.max_calls} model calls in all, each step setting aside its maximum first; it stops at ${until.slice(0, 10)} ${until.slice(11, 16)} UTC. The run's routine approvals, budgets, spending limits and connection caps still apply.`,
    ...(c.resume_after_limit
      ? [
          `If the plan account's usage limit or the connection's daily request cap stops it, it checks again later and continues by itself (at most ${AUTO_RESUME_MAX_CHECKS} times), only inside this run's routine approvals, its call limit and its end time. You can turn this off on its card.`,
        ]
      : []),
    'Where your autopilot settings (Autopilot page) allow it, it takes a planned fallback instead of stopping (gathering evidence, choosing by the worst case, breaking a tie, the next candidate, a retry); each is recorded with the setting that allowed it.',
    'It never publishes, sends messages, spends outside the run, changes permissions or answers a question for you. Stop it at any time; what it made so far is kept.',
  ];
}

/** The routine stages an autopilot's steps need the run's policy to cover (sorted). */
export function autopilotStagesNeeded(
  research: boolean,
  start: AutopilotStart | null = null,
): RoutineStage[] {
  if (start?.stage === 'select') return ['selection'];
  return (
    research
      ? ['evidence', 'model_work', 'research', 'selection']
      : ['model_work', 'selection']
  ) as RoutineStage[];
}

/**
 * ADR-0100: whether an autopilot with these settings may run a web search to gather evidence:
 * gathering is on with searches left, it uses public or synthetic data on a plan route, and it
 * does not start at selection (choosing from recorded scores never calls a model).
 */
export function autopilotMaySearch(
  c: AutopilotConfig,
  gatherSearch: boolean | undefined,
): boolean {
  return (
    !!gatherSearch &&
    c.start?.stage !== 'select' &&
    (c.data_class === 'public' || c.data_class === 'synthetic') &&
    (!!c.research || c.resource_setup.kind === 'subscription')
  );
}

/**
 * The routine approvals a new run gets when it is set up for an autopilot: exactly the stages
 * its steps need, its data, at most `max_calls` + 20 steps, until the autopilot ends. The owner
 * confirms this policy's own summary as well; nothing here widens what a routine policy can do.
 */
export function autopilotRoutinePolicy(
  c: AutopilotConfig,
  maxTotalNanoUsd: string | null,
  /**
   * ADR-0100: the owner's settings let it search the web to gather evidence, so the run's
   * approvals also cover the evidence and research stages (public data only, on a plan route).
   */
  opts: { gatherSearch?: boolean } = {},
): RoutinePolicyInput {
  const search = !!c.research || autopilotMaySearch(c, opts.gatherSearch);
  return {
    stages: [
      ...new Set([
        ...autopilotStagesNeeded(!!c.research, c.start),
        ...(search
          ? (['evidence', 'model_work', 'research'] as RoutineStage[])
          : []),
      ]),
    ].sort() as RoutineStage[],
    data_classes: [
      ...new Set([c.data_class, ...(search ? (['public'] as const) : [])]),
    ].sort(),
    max_actions: c.limits.max_calls + 20,
    max_total_nano_usd: maxTotalNanoUsd,
    stop_on: ['person_rejects', 'unknown_outcome'],
    expires_at: new Date(c.limits.ends_at).toISOString(),
    rationale:
      'Set up with an autopilot: the steps it takes on this run, nothing else.',
  };
}

const NEXT: Record<AutopilotStopKind, Omit<AutopilotNext, 'setting'>[]> = {
  thin_evidence: [
    {
      kind: 'search_web',
      label: 'Search the web',
      detail: 'Discover › Search the web adds checked claims; then continue.',
    },
    {
      kind: 'link_claims',
      label: 'Link claims',
      detail:
        'Link recorded claims to the problem or its options, then continue.',
    },
    {
      kind: 'exploration',
      label: 'Open the exploration',
      detail:
        'See what the explorer found and the research questions it suggested.',
    },
  ],
  unknown_ratings: [
    {
      kind: 'decide',
      label: 'Score under Decide',
      detail:
        'Fill in the unknown ratings (or choose yourself), then continue.',
    },
    {
      kind: 'link_claims',
      label: 'Link claims to the options',
      detail:
        'More evidence narrows unknown ratings when it is assessed again.',
    },
  ],
  tie: [
    {
      kind: 'decide',
      label: 'Choose under Decide',
      detail:
        'Pick one of the tied options; Continue goes on with your choice.',
    },
  ],
  close_ranking: [
    {
      kind: 'decide',
      label: 'Choose under Decide',
      detail: 'The leader changes with the weights; choose, then continue.',
    },
  ],
  not_advanceable: [
    {
      kind: 'decide',
      label: 'Choose under Decide',
      detail: 'Choose an option yourself, or record the result as it is.',
    },
  ],
  gate_blocked: [
    {
      kind: 'decide',
      label: 'Resolve the gate under Decide',
      detail:
        'An ethics or access gate is open; resolve it or choose another option.',
    },
    {
      kind: 'link_claims',
      label: 'Link claims to the options',
      detail: 'Evidence about the option lets the gate check be answered.',
    },
  ],
  opportunity: [
    {
      kind: 'decide',
      label: 'Choose under Decide',
      detail: 'Building it needs an override reason, which is yours to give.',
    },
  ],
  model_ethics: [
    {
      kind: 'decide',
      label: 'Check ethics under Decide',
      detail:
        'Only the model cleared its ethics gate; look at it and choose, then continue.',
    },
    {
      kind: 'approvals',
      label: 'Open Approvals',
      detail: 'The question also waits under Monitor › Approvals.',
    },
  ],
  failed_step: [
    {
      kind: 'continue',
      label: 'Continue',
      detail: 'Tries the step again as a new attempt.',
    },
  ],
  claims_held: [
    {
      kind: 'search_web',
      label: 'Review the checked claims',
      detail:
        'Discover › Search the web: add the claims you agree with (each shows its quote and page), then continue.',
    },
    {
      kind: 'continue',
      label: 'Continue',
      detail:
        'Goes on with the claims you added; while claims still wait and none were added, it stops here again.',
    },
  ],
  person_choice: [
    {
      kind: 'decide',
      label: 'Review your choice under Decide',
      detail: 'Record it again (or choose another), then continue.',
    },
  ],
  approval: [
    {
      kind: 'approvals',
      label: 'Open Approvals',
      detail:
        'Answer the question, or widen the run’s routine approvals, then continue.',
    },
  ],
  paused: [
    {
      kind: 'continue',
      label: 'Resume, then continue',
      detail:
        'A person paused the step; resume it under Monitor, then continue.',
    },
  ],
  run_cap: [
    {
      kind: 'models',
      label: 'Raise the per-run cap',
      detail:
        'Models and connections › Change caps; accept the changed caps, then continue.',
    },
  ],
  connection: [
    {
      kind: 'models',
      label: 'Fix the connection',
      detail:
        'Models and connections: the connection says what it needs (for example accepting its caps); then continue.',
    },
  ],
  open_request: [
    {
      kind: 'models',
      label: 'Close the request without a recorded outcome',
      detail:
        'Models and connections › your plan connection › Requests without a recorded outcome: close it with what you know, then continue. Nothing waits under Approvals.',
    },
  ],
  daily_cap: [
    {
      kind: 'add_requests',
      label: 'Add 20 requests',
      detail:
        'Adds 20 requests for 24 hours without changing caps; then continue.',
    },
  ],
  // PR #211 review 1 L-1: the connection stays marked used up until its usage is rechecked,
  // so the recheck comes before Continue, not as a fallback.
  usage_limit: [
    {
      kind: 'models',
      label: 'Recheck usage once the limit resets, then continue',
      detail:
        'The plan account’s own usage limit pauses requests until it resets (see your plan’s usage settings). Then recheck usage under Models and connections, and continue.',
    },
  ],
  call_limit: [
    {
      kind: 'new_autopilot',
      label: 'Start a new autopilot',
      detail:
        'This one’s call limit is used up; give the next one a higher limit.',
    },
  ],
  end_time: [
    {
      kind: 'new_autopilot',
      label: 'Start a new autopilot',
      detail: 'Its end time passed; what it made is kept.',
    },
  ],
  spec: [
    {
      kind: 'spec',
      label: 'Write the spec',
      detail: 'Build › Spec: writing and freezing it stays with you.',
    },
  ],
  other: [],
};

/**
 * ADR-0100: what a finished autopilot offers next, from its last step's stop kind: the one-click
 * setting that would have let it go on (when Continue can retry the step), then the manual steps.
 */
export function autopilotNextSteps(
  a: Pick<Autopilot, 'state' | 'outcome' | 'steps'> &
    Partial<Pick<Autopilot, 'approvals_ended_at' | 'config'>>,
  /** Re-review 2 L-1: the owner's settings now; a setting already on is not offered again. */
  settings?: AutopilotSettingsValues,
): AutopilotNext[] {
  if (a.state !== 'finished') return [];
  if (a.outcome === 'proposal')
    return [
      {
        kind: 'proposals',
        label: 'Review the proposal',
        detail: 'Proposals: sections the records could not fill say so.',
      },
    ];
  if (a.outcome === 'cancelled') return [];
  const last = a.steps.at(-1);
  const kind = last?.stop_kind ?? 'other';
  const can = autopilotContinuable(a);
  const setting = SETTING_FOR_STOP[kind];
  const out: AutopilotNext[] = [];
  if (setting && can.ok && !(settings && settingIsOn(settings, setting)))
    out.push({
      kind: 'allow_and_continue',
      label: `Allow “${AUTOPILOT_SETTING_TEXT[setting].label}” and continue`,
      detail:
        `${AUTOPILOT_SETTING_TEXT[setting].text} It stays on for later autopilots; change it under Autopilot settings.`.slice(
          0,
          300,
        ),
      setting,
    });
  out.push(
    ...NEXT[kind].filter(
      (n) => can.ok || (n.kind !== 'continue' && n.kind !== 'add_requests'),
    ),
  );
  if (!can.ok && !out.some((n) => n.kind === 'new_autopilot'))
    out.push({
      kind: 'new_autopilot',
      label: 'Start a new autopilot',
      detail: can.reason.slice(0, 300),
    });
  return out.slice(0, 8);
}
