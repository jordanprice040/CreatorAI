import {
  z,
  id,
  hash,
  timestamp,
  counter,
  version,
  nanoUsd,
  ExecutionStateSchema,
} from './primitives.js';
import { DataClassSchema, TargetRefSchema } from './oversight.js';
import { ReservationSchema } from './budget.js';
import { PLAN_REQUEST_TIMEOUT_MAX_MS } from './connections.js';
import {
  DiscoveryResultSchema,
  DiscoveryTaskContextSchema,
  DiscoveryTaskKindSchema,
  EvidenceRoleSchema,
  ResponseTypeSchema,
} from './discovery.js';
import {
  ExplorationResultSchema,
  ExplorationTaskContextSchema,
  ExploreScopeSchema,
} from './exploration.js';

// T05 durable orchestration. A workflow is one finite coordinator run of one bounded role
// for a registered run; its state lives in PostgreSQL, not in a browser or a worker's memory.
const short = z.string().trim().min(1).max(300);
const note = z.string().trim().min(1).max(1200);

export const ORCHESTRATION_POLICY_VERSION = 'orchestration/1.0' as const;
/**
 * Bounded roles connected end to end: the T05 skeptic review (R05) and the T07 discovery run
 * (R02 locator, R04 designers, R05 skeptic and bounded revision).
 */
export const WorkflowRoleSchema = z.enum([
  'r05_skeptic',
  'r02_discovery',
  /** C53 "Explore for me": one explorer task over the workspace's claims (ADR-0065). */
  'r01_exploration',
]);
export type WorkflowRole = z.infer<typeof WorkflowRoleSchema>;
export const WorkflowStateSchema = ExecutionStateSchema.exclude([
  'admitted',
  'paused_budget',
]);
export type WorkflowState = z.infer<typeof WorkflowStateSchema>;
export const WorkflowControlSchema = z.enum(['run', 'pause', 'cancel']);
export const TaskStateSchema = z.enum([
  'waiting_dependency',
  'queued',
  'leased',
  'waiting_human',
  'reconciling',
  'succeeded',
  'failed',
  'needs_human',
  'cancelled',
]);
export type TaskState = z.infer<typeof TaskStateSchema>;
export const TERMINAL_TASK_STATES: readonly TaskState[] = [
  'succeeded',
  'failed',
  'needs_human',
  'cancelled',
];
export const TaskKindSchema = z.enum([
  'critique',
  'synthesis',
  ...DiscoveryTaskKindSchema.options,
  'explore',
]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

/** Metered (API) and local calls: the broker's own per-call timeout bound (budget.ts). */
export const METERED_CALL_TIMEOUT_MAX_MS = 600_000;
/** Metered (API) and local workflows: the one-day wall time they had before ADR-0062. */
export const METERED_WALL_MAX_SECONDS = 86_400;
/**
 * ADR-0062: a plan-backed (subscription) call may run as long as the connection's request
 * timeout, which has no owner maximum beyond the timer bound; a workflow's wall time must be
 * able to hold its largest call budget (60 calls) at that timeout, one at a time.
 */
export const WORKFLOW_WALL_MAX_SECONDS =
  60 * Math.ceil(PLAN_REQUEST_TIMEOUT_MAX_MS / 1000);

/** Hard ceilings; a workflow's own limits must sit inside them. */
export const WorkflowLimitsSchema = z
  .strictObject({
    max_children: counter.min(1).max(8),
    max_concurrency: counter.min(1).max(4),
    max_depth: z.literal(1),
    /** Provider attempts per logical call (broker retries on definitive refusals only). */
    max_attempts: counter.min(1).max(3),
    /** New calls after a known bad output (malformed or incomplete), per task. */
    max_repairs: counter.max(2),
    /** Total provider attempts the workflow may cause, including repairs and retries. */
    max_calls: counter.min(2).max(60),
    max_output_tokens: counter.min(16).max(8000),
    /** Up to the plan timer bound; metered and local runs are held to 600 s below. */
    call_timeout_ms: counter.min(100).max(PLAN_REQUEST_TIMEOUT_MAX_MS),
    max_wall_seconds: counter.min(5).max(WORKFLOW_WALL_MAX_SECONDS),
  })
  .superRefine((l, ctx) => {
    if (l.max_calls < (l.max_children + 1) * l.max_attempts)
      ctx.addIssue({
        code: 'custom',
        message:
          'max_calls must cover one call per perspective plus the synthesis, at max_attempts each.',
      });
  });
export type WorkflowLimits = z.infer<typeof WorkflowLimitsSchema>;

export const StartWorkflowRequestSchema = z
  .strictObject({
    knowledge_keys: z
      .array(z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/))
      .max(4)
      .optional(),
    role: z.literal('r05_skeptic'),
    /** The record under review, pinned to one version; its content hash is bound at start. */
    subject: TargetRefSchema,
    /** Immutable constraints every task receives verbatim. */
    constraints: z.array(short).max(10),
    perspectives: z.array(short).min(1).max(8),
    envelope_id: id,
    pricing_snapshot_id: id,
    data_class: DataClassSchema,
    limits: WorkflowLimitsSchema,
  })
  .superRefine((r, ctx) => {
    if (r.perspectives.length > r.limits.max_children)
      ctx.addIssue({
        code: 'custom',
        message: 'More perspectives than max_children.',
      });
    if (new Set(r.perspectives).size !== r.perspectives.length)
      ctx.addIssue({ code: 'custom', message: 'Perspectives must differ.' });
    // PR #123 re-review L-2: this workflow is always metered, so it keeps the broker's 600 s
    // per-call bound and the one-day wall time it had before ADR-0062.
    if (r.limits.call_timeout_ms > METERED_CALL_TIMEOUT_MAX_MS)
      ctx.addIssue({
        code: 'custom',
        message: 'API workflow calls time out within 600 seconds.',
      });
    if (r.limits.max_wall_seconds > METERED_WALL_MAX_SECONDS)
      ctx.addIssue({
        code: 'custom',
        message: 'API workflows end within one day.',
      });
  });
export type StartWorkflowRequest = z.infer<typeof StartWorkflowRequestSchema>;
export const WorkflowControlRequestSchema = z.strictObject({
  expected_version: version,
  reason: short,
});

/** Task-specific context: only what the task needs, by reference and hash. */
export const SkepticTaskContextSchema = z.strictObject({
  context_version: z.literal('skeptic-context/1'),
  role_version: short,
  subject: z.strictObject({
    id,
    version,
    kind: z.string().max(40),
    content_hash: hash,
    title: z.string().max(500),
    excerpt: z.string().max(4000),
  }),
  constraints: z.array(short),
  perspective: short.nullable(),
  /** Synthesis only: the critique outputs it combines, by task id and output hash. */
  inputs: z.array(
    z.strictObject({ task_id: id, output_hash: hash, perspective: short }),
  ),
});
export type SkepticTaskContext = z.infer<typeof SkepticTaskContextSchema>;
export const TaskContextSchema = z.discriminatedUnion('context_version', [
  SkepticTaskContextSchema,
  DiscoveryTaskContextSchema,
  ExplorationTaskContextSchema,
]);
export type TaskContext = z.infer<typeof TaskContextSchema>;

/**
 * T07: start a discovery run from a pinned search brief and chosen claim evidence. Every
 * response type is either assigned to a designer or excluded with a reason.
 */
export const WorkflowResourceSetupSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('api'),
    envelope_id: id,
    pricing_snapshot_id: id,
  }),
  z.strictObject({
    kind: z.literal('subscription'),
    connection_id: id,
    model_id: short,
    settings_hash: hash,
    /** ADR-0062: bounded by the connection's accepted output cap (checked at start), no more. */
    max_output_chars: counter.min(100),
  }),
  z.strictObject({ kind: z.literal('local'), model_id: short }),
]);
export type WorkflowResourceSetup = z.infer<typeof WorkflowResourceSetupSchema>;
export const DISCOVERY_TASK_CLASSES = {
  locate: 'research_synthesis',
  propose: 'candidate_generation',
  revise: 'candidate_generation',
  skeptic: 'scoring',
} as const;
/**
 * ADR-0065: the explorer narrows recorded evidence into problems, the locator's kind of work,
 * so it runs as research_synthesis and is admitted under the locator's qualification.
 */
export const EXPLORATION_TASK_CLASS = 'research_synthesis' as const;
/** The plan task class of a workflow task kind, or undefined for a metered-only kind. */
export const workflowTaskClass = (kind: string) =>
  kind === 'explore'
    ? EXPLORATION_TASK_CLASS
    : DISCOVERY_TASK_CLASSES[kind as keyof typeof DISCOVERY_TASK_CLASSES];

export const StartDiscoveryRequestSchema = z
  .strictObject({
    brief: TargetRefSchema,
    evidence: z
      .array(
        z.strictObject({
          claim_id: id,
          bears_on: z.array(EvidenceRoleSchema).min(1).max(8),
        }),
      )
      .min(1)
      .max(30),
    perspectives: z.array(ResponseTypeSchema).min(2).max(5),
    excluded: z
      .array(z.strictObject({ perspective: ResponseTypeSchema, reason: short }))
      .max(3),
    max_revisions: counter.max(2),
    max_age_days: counter.min(1).max(3650).default(180),
    envelope_id: id.nullable().optional(),
    pricing_snapshot_id: id.nullable().optional(),
    resource_setup: WorkflowResourceSetupSchema.optional(),
    data_class: DataClassSchema,
    limits: WorkflowLimitsSchema,
  })
  .superRefine((r, ctx) => {
    if (!r.resource_setup && (!r.envelope_id || !r.pricing_snapshot_id))
      ctx.addIssue({
        code: 'custom',
        message: 'Choose resource setup or legacy API budget/pricing.',
      });
    if (r.resource_setup && (r.envelope_id || r.pricing_snapshot_id))
      ctx.addIssue({
        code: 'custom',
        message:
          'Use either typed resource setup or legacy budget/pricing, not both.',
      });
    // ADR-0062: only plan-backed calls may outlast the broker's 600 s per-call bound; the
    // subscription start also checks the timeout against the connection's accepted cap.
    if (r.resource_setup?.kind !== 'subscription') {
      if (r.limits.call_timeout_ms > METERED_CALL_TIMEOUT_MAX_MS)
        ctx.addIssue({
          code: 'custom',
          message:
            'API and local workflow calls time out within 600 seconds; only plan-backed calls follow the connection timeout.',
        });
      if (r.limits.max_wall_seconds > METERED_WALL_MAX_SECONDS)
        ctx.addIssue({
          code: 'custom',
          message:
            'API and local workflows end within one day; only plan-backed runs may run longer.',
        });
    }
    const named = [...r.perspectives, ...r.excluded.map((e) => e.perspective)];
    if (new Set(named).size !== named.length)
      ctx.addIssue({
        code: 'custom',
        message:
          'Name each response type once, as a perspective or an exclusion.',
      });
    if (named.length !== ResponseTypeSchema.options.length)
      ctx.addIssue({
        code: 'custom',
        message:
          'Every response type must be assigned or excluded with a reason.',
      });
    if (!r.perspectives.some((p) => p !== 'software'))
      ctx.addIssue({
        code: 'custom',
        message: 'Include at least one response that is not new software.',
      });
    if (r.perspectives.length > r.limits.max_children)
      ctx.addIssue({
        code: 'custom',
        message: 'More perspectives than max_children.',
      });
    const ids = r.evidence.map((e) => e.claim_id.toLowerCase());
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'List each claim once.' });
    // Locator, one proposal per perspective and at least one skeptic pass.
    if (
      r.limits.max_calls <
      (r.perspectives.length + 2) * r.limits.max_attempts
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'max_calls must cover the locator, one call per perspective and a skeptic pass, at max_attempts each.',
      });
  });
export type StartDiscoveryRequest = z.infer<typeof StartDiscoveryRequestSchema>;

/**
 * C53: start an exploration with no theme. The scope is optional narrowing; the run, resource
 * setup, data class and limits are the same kinds discovery uses.
 */
export const StartExplorationRequestSchema = z
  .strictObject({
    scope: ExploreScopeSchema.default(ExploreScopeSchema.parse({})),
    resource_setup: WorkflowResourceSetupSchema,
    data_class: DataClassSchema,
    limits: WorkflowLimitsSchema,
    /**
     * The `preview_hash` of the preview the owner saw; the start is refused if what it would
     * send differs (PR #131 re-review R-N4). Optional for the CLI.
     */
    preview_hash: hash.optional(),
  })
  .superRefine((r, ctx) => {
    if (r.resource_setup.kind !== 'subscription') {
      if (r.limits.call_timeout_ms > METERED_CALL_TIMEOUT_MAX_MS)
        ctx.addIssue({
          code: 'custom',
          message: 'API and local workflow calls time out within 600 seconds.',
        });
      if (r.limits.max_wall_seconds > METERED_WALL_MAX_SECONDS)
        ctx.addIssue({
          code: 'custom',
          message: 'API and local workflows end within one day.',
        });
    }
  });
export type StartExplorationRequest = z.infer<
  typeof StartExplorationRequestSchema
>;

// Role outputs. The runtime validates them; a malformed answer is a known failure, charged.
const severity = z.enum(['low', 'medium', 'high']);
export const CritiqueOutputSchema = z.strictObject({
  fixture: z.boolean().optional(),
  summary: z.string().trim().min(1).max(2000),
  objections: z
    .array(
      z.strictObject({
        claim: short,
        severity,
        evidence_needed: short,
      }),
    )
    .max(10)
    .default([]),
});
export const SynthesisOutputSchema = z.strictObject({
  fixture: z.boolean().optional(),
  summary: z.string().trim().min(1).max(2000),
  disposition: z
    .enum(['proceed', 'investigate', 'revise', 'defer', 'decline'])
    .default('investigate'),
  disconfirming_test: short.nullable().default(null),
});
export type CritiqueOutput = z.infer<typeof CritiqueOutputSchema>;
export type SynthesisOutput = z.infer<typeof SynthesisOutputSchema>;

export const WorkflowTaskSchema = z.strictObject({
  id,
  workflow_id: id,
  kind: TaskKindSchema,
  ordinal: counter,
  round: counter,
  repair: counter,
  repair_of: id.nullable(),
  depth: counter,
  logical_operation_id: id,
  state: TaskStateSchema,
  reason: short,
  version,
  deliveries: counter,
  lease_owner: z.string().max(100).nullable(),
  lease_token: z
    .string()
    .regex(/^[0-9]+$/)
    .nullable(),
  lease_expires_at: timestamp.nullable(),
  decision_id: id.nullable(),
  context: TaskContextSchema,
  context_hash: hash,
  output: z.unknown().nullable(),
  output_hash: hash.nullable(),
  created_at: timestamp,
  finished_at: timestamp.nullable(),
});
export type WorkflowTask = z.infer<typeof WorkflowTaskSchema>;

export const WorkflowOutcomeSchema = z.enum([
  'succeeded',
  'partial',
  'failed',
  'needs_human',
  'declined',
  'cancelled',
  'deadline_exceeded',
  'insufficient_evidence',
]);
export const WorkflowResultSchema = z.strictObject({
  outcome: WorkflowOutcomeSchema,
  explanation: note,
  synthesis: SynthesisOutputSchema.nullable(),
  critiques: z.array(
    z.strictObject({
      task_id: id,
      perspective: short,
      state: TaskStateSchema,
      output_hash: hash.nullable(),
    }),
  ),
  fixture: z.boolean(),
  /** Discovery runs only. */
  discovery: DiscoveryResultSchema.optional(),
  /** Explorations only (ADR-0065). */
  exploration: ExplorationResultSchema.optional(),
});
export type WorkflowResult = z.infer<typeof WorkflowResultSchema>;
export const WorkflowUsageSchema = z.strictObject({
  attempts: counter,
  reserved: nanoUsd,
  incurred: nanoUsd,
  unknown: nanoUsd,
  in_flight: counter,
});
export const WorkflowSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  fixture: z.boolean(),
  version,
  role: WorkflowRoleSchema,
  role_version: short,
  prompt_hash: hash,
  policy_version: short,
  subject: TargetRefSchema,
  context_hash: hash,
  constraints: z.array(short),
  perspectives: z.array(short),
  limits: WorkflowLimitsSchema,
  envelope_id: id.nullable(),
  pricing_snapshot_id: id.nullable(),
  resource_setup: WorkflowResourceSetupSchema.optional(),
  data_class: DataClassSchema,
  state: WorkflowStateSchema,
  reason: short,
  control: WorkflowControlSchema,
  steps: counter,
  deadline_at: timestamp,
  result: WorkflowResultSchema.nullable(),
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
  finished_at: timestamp.nullable(),
});
export type Workflow = z.infer<typeof WorkflowSchema>;
export const WorkflowDetailSchema = z.strictObject({
  workflow: WorkflowSchema,
  tasks: z.array(WorkflowTaskSchema),
  usage: WorkflowUsageSchema,
  reservations: z.array(ReservationSchema),
  subscription_usage: z
    .strictObject({
      requests: counter,
      in_flight: counter,
      unresolved: counter,
    })
    .optional(),
});
export type WorkflowDetail = z.infer<typeof WorkflowDetailSchema>;
