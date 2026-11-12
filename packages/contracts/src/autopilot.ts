import { z, id, hash, version, counter, timestamp } from './primitives.js';
import {
  DataClassSchema,
  type RoutinePolicyInput,
  type RoutineStage,
} from './oversight.js';
import { EvidenceRoleSchema, ResponseTypeSchema } from './discovery.js';
import { ExploreScopeSchema } from './exploration.js';
import { WebDiscoveryScopeSchema } from './web-discovery.js';
import { WorkflowResourceSetupSchema } from './orchestration.js';

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

/** Outcomes a person can continue from (the stopped step is tried again). */
export const AUTOPILOT_RETRYABLE: readonly AutopilotOutcome[] = [
  'needs_person',
  'needs_authority',
  'limit_reached',
  'failed',
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
    if (r.start && r.research)
      ctx.addIssue({
        code: 'custom',
        path: ['research'],
        message:
          'An autopilot that starts at a recorded problem does not search the web first.',
      });
  });
export type AutopilotConfig = z.infer<typeof AutopilotConfigSchema>;

export const StartAutopilotRequestSchema = z.strictObject({
  config: AutopilotConfigSchema,
  /** The summary lines the owner confirmed; refused when they differ from `autopilotSummary`. */
  summary_seen: z.array(z.string().max(600)).min(1).max(20),
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
});
export type Autopilot = z.infer<typeof AutopilotSchema>;

/**
 * Whether Continue can get past where a finished autopilot stopped, and if not, why. A stop for a
 * person or an approval, a connection cap or a failed step can be continued; a stop at the spec,
 * at the autopilot's own call limit, or after a cancel or a final result cannot.
 */
export function autopilotContinuable(
  a: Pick<Autopilot, 'state' | 'outcome' | 'steps'>,
): { ok: true } | { ok: false; reason: string } {
  if (a.state !== 'finished') return { ok: false, reason: 'It is running.' };
  if (!a.outcome || !AUTOPILOT_RETRYABLE.includes(a.outcome))
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
 * The routine approvals a new run gets when it is set up for an autopilot: exactly the stages
 * its steps need, its data, at most `max_calls` + 20 steps, until the autopilot ends. The owner
 * confirms this policy's own summary as well; nothing here widens what a routine policy can do.
 */
export function autopilotRoutinePolicy(
  c: AutopilotConfig,
  maxTotalNanoUsd: string | null,
): RoutinePolicyInput {
  return {
    stages: autopilotStagesNeeded(!!c.research, c.start),
    data_classes: [
      ...new Set([c.data_class, ...(c.research ? (['public'] as const) : [])]),
    ].sort(),
    max_actions: c.limits.max_calls + 20,
    max_total_nano_usd: maxTotalNanoUsd,
    stop_on: ['person_rejects', 'unknown_outcome'],
    expires_at: new Date(c.limits.ends_at).toISOString(),
    rationale:
      'Set up with an autopilot: the steps it takes on this run, nothing else.',
  };
}
