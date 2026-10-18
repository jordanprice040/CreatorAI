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
import {
  DiscoveryResultSchema,
  DiscoveryTaskContextSchema,
  DiscoveryTaskKindSchema,
  EvidenceRoleSchema,
  ResponseTypeSchema,
} from './discovery.js';

// T05 durable orchestration. A workflow is one finite coordinator run of one bounded role
// for a registered run; its state lives in PostgreSQL, not in a browser or a worker's memory.
const short = z.string().trim().min(1).max(300);
const note = z.string().trim().min(1).max(1200);

export const ORCHESTRATION_POLICY_VERSION = 'orchestration/1.0' as const;
/**
 * Bounded roles connected end to end: the T05 skeptic review (R05) and the T07 discovery run
 * (R02 locator, R04 designers, R05 skeptic and bounded revision).
 */
export const WorkflowRoleSchema = z.enum(['r05_skeptic', 'r02_discovery']);
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
]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

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
    call_timeout_ms: counter.min(100).max(600000),
    max_wall_seconds: counter.min(5).max(86400),
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
]);
export type TaskContext = z.infer<typeof TaskContextSchema>;

/**
 * T07: start a discovery run from a pinned search brief and chosen claim evidence. Every
 * response type is either assigned to a designer or excluded with a reason.
 */
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
    envelope_id: id,
    pricing_snapshot_id: id,
    data_class: DataClassSchema,
    limits: WorkflowLimitsSchema,
  })
  .superRefine((r, ctx) => {
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
  envelope_id: id,
  pricing_snapshot_id: id,
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
});
export type WorkflowDetail = z.infer<typeof WorkflowDetailSchema>;
