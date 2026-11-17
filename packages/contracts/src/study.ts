import { SearchBriefBodySchema } from './discovery.js';
import {
  z,
  id,
  text,
  hash,
  counter,
  timestamp,
  nanoUsd,
  ConditionSchema,
  DiscoverySchema,
} from './primitives.js';

const frozenText = z.strictObject({ version: text, text });
const ref = z.strictObject({ id, version: counter.min(1) });
/**
 * An implementation task frozen in the owner's workspace. Every hash is checked against the
 * stored spec, its freeze and its humility review before a study can bind it.
 */
export const StudyImplementationSchema = z.strictObject({
  spec_id: id,
  spec_version: counter.min(1),
  spec_hash: hash,
  freeze_id: id,
  task_key: z.string().regex(/^T[1-9][0-9]?$/),
  task_hash: hash,
  humility_review: ref,
  max_repairs: counter.max(2),
  timeout_ms: counter.min(100).max(60000),
  max_output_tokens: counter.min(100).max(16000),
});
/** A study-governance item is either explicitly unresolved or decided in the adopted freeze. */
export const GovernanceItemSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('unresolved'), decision: text }),
  z.strictObject({
    status: z.literal('decided'),
    decision: text,
    choice: text,
    reference: text,
  }),
]);
export const StudyGovernanceSchema = z.strictObject({
  label: text,
  participants: GovernanceItemSchema,
  reviewers: GovernanceItemSchema,
  human_subjects: GovernanceItemSchema,
  task_selection: GovernanceItemSchema,
  model: z.strictObject({
    owner_preference: text,
    verified_model_id: text.nullable(),
    decision: text,
  }),
  budget: z.strictObject({ ledger_cap_nano_usd: nanoUsd }),
});
export const StudyPacketSchema = z
  .strictObject({
    version: text,
    stratum: z.enum(['decision', 'implementation']),
    problem: text.max(1200),
    initial_resources: z
      .array(
        z.strictObject({ locator: text.max(1000), snapshot: text.max(2000) }),
      )
      .max(30),
    outcome: text.max(300),
    structured_brief: SearchBriefBodySchema,
    time_cap_seconds: counter.min(5).max(86400),
    implementation: StudyImplementationSchema.optional(),
  })
  .superRefine((p, ctx) => {
    if (p.implementation && p.stratum !== 'implementation')
      ctx.addIssue({
        code: 'custom',
        message: 'Only the implementation stratum binds a frozen build task.',
      });
    if (
      p.problem !== p.structured_brief.measurable_problem ||
      p.outcome !== p.structured_brief.outcome_measure
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'The structured brief must use exactly the same problem and outcome as the shared packet.',
      });
  });
export const StudyConfigSchema = z.strictObject({
  model_version: text,
  pricing_version: text,
  tool_access: z.array(text).max(20),
  candidate_count: counter.min(2).max(5),
  max_calls: counter.min(7).max(60),
  max_output_tokens: counter.min(16).max(8000),
  max_cost_nano_usd: nanoUsd,
  max_retries: counter.max(2),
});
export const CreateStudySchema = z.strictObject({
  schema_version: z.literal('study/1'),
  /** false only for a final record bound to an adopted freeze; see the store's record gate. */
  synthetic: z.boolean(),
  title: text,
  protocol: frozenText,
  packet: StudyPacketSchema,
  config: StudyConfigSchema,
  rubric: frozenText,
  intervention_policy: frozenText,
  analysis_plan: frozenText,
  missing_data_policy: frozenText,
  stop_retry_rules: frozenText,
  primary_outcomes: z.array(text).min(1).max(10),
  assignment_seed: text,
  governance: StudyGovernanceSchema.optional(),
  evaluation: z.strictObject({ freeze_hash: hash }).optional(),
});
export const AssignStudySchema = z.strictObject({
  manifest_hash: hash,
  comparison: z.enum(['autonomy', 'discovery']).default('autonomy'),
  participant_actor_id: id,
  participant_code: text,
  prior_familiarity: text,
  condition: ConditionSchema,
  discovery_method: DiscoverySchema,
  continuation_of: id.nullable(),
});
export const StudyArtifactSchema = z.strictObject({
  kind: z.enum(['document', 'code', 'artifact']),
  name: text,
  content: z.string().max(24000),
});
export const StudyTestSchema = z.strictObject({
  artifact_id: id,
  artifact_hash: hash,
  check: z.enum(['contains', 'equals', 'json_valid']),
  expected: z.string().max(8000),
});
export const StudyInterventionSchema = z.strictObject({
  type: z.enum(['clarification', 'judgment', 'authorization', 'feedback']),
  gate: z.enum(['fixed', 'dynamic']),
  reason: text,
  trigger: text,
  stage: text,
  data_shown: text,
  human_input: text,
  resulting_change: text,
  prevented_problem: z.enum(['yes', 'no', 'unknown']),
  human_active_minutes: z.number().min(0).max(1440),
  wait_seconds: counter.max(86400),
});
/**
 * ADR-0122 (F13): the study effort timer. In study mode only, the Study page times the
 * participant's steps in the browser and sends the totals with the record that ends each step.
 * It only measures; it never names, describes or classifies the person.
 *
 * ADR-0129: steps now cover the human-only condition and the finish too. A step started since
 * ADR-0129 is an `attempt` step: it runs while the participant has the attempt open and is ended
 * by the next intervention, saved entry or finish (`ended_by`). Steps started under ADR-0122 are
 * `intervention` steps and only an intervention ends them.
 */
export const STUDY_EFFORT_TIMER_VERSION = 'study-effort-timer/1';
/** Edits within this window keep a focused, visible page counted as active effort. */
export const STUDY_EFFORT_IDLE_MS = 60_000;
/** Allowance for request latency when the browser totals are checked against the server clock. */
export const STUDY_EFFORT_CLOCK_SLACK_MS = 5_000;
const effortMs = counter.max(86_400_000);
/**
 * Measured totals for one step, in milliseconds. `active_ms`: the page was visible and focused
 * and the person edited within the idle window. `wait_ms`: otherwise, a studio request was in
 * flight (the person was waiting on the studio). `idle_ms`: otherwise, the page was visible and
 * focused but the person was not editing (reading, say). `away_ms`: the rest (the page was hidden
 * or another window had focus).
 */
export const StudyEffortSchema = z.strictObject({
  step_id: id,
  timer_version: z.literal(STUDY_EFFORT_TIMER_VERSION),
  active_ms: effortMs,
  wait_ms: effortMs,
  idle_ms: effortMs,
  away_ms: effortMs,
});
export type StudyEffort = z.infer<typeof StudyEffortSchema>;
/**
 * ADR-0129 (review M-1): every refusal that is about the step time only, not the record it came
 * with, ends with this sentence, so the Study page stops the timer only then and keeps the step
 * running on any other refusal (a submit without an entry, say).
 */
export const STUDY_EFFORT_REFUSAL = 'The refusal is about the step time only.';
/** Starting a step takes no input. */
export const StartStudyEffortStepSchema = z.strictObject({});
/** The intervention body the API accepts: the frozen intervention fields plus optional timing. */
export const StudyInterventionRequestSchema = StudyInterventionSchema.extend({
  effort: StudyEffortSchema.optional(),
});
/** ADR-0129: a saved entry may end the running step, like an intervention. */
export const StudyArtifactRequestSchema = StudyArtifactSchema.extend({
  effort: StudyEffortSchema.optional(),
});
/** Where a step began: under ADR-0122 at the intervention form, since ADR-0129 on the attempt. */
export const STUDY_EFFORT_STEP_KINDS = ['intervention', 'attempt'] as const;
/** The record that ended a measured step. */
export const STUDY_EFFORT_ENDS = ['intervention', 'entry', 'finish'] as const;
export type StudyEffortEnd = (typeof STUDY_EFFORT_ENDS)[number];
export const StudyEffortStepSchema = z.strictObject({
  id,
  attempt_id: id,
  step: z.enum(STUDY_EFFORT_STEP_KINDS),
  synthetic: z.boolean(),
  started_at: timestamp,
  measured: z
    .strictObject({
      event_id: id,
      ended_by: z.enum(STUDY_EFFORT_ENDS),
      timer_version: z.literal(STUDY_EFFORT_TIMER_VERSION),
      active_ms: effortMs,
      wait_ms: effortMs,
      idle_ms: effortMs,
      away_ms: effortMs,
      wall_ms: counter,
      recorded_at: timestamp,
    })
    .nullable(),
});
export type StudyEffortStep = z.infer<typeof StudyEffortStepSchema>;
export const FinishStudyAttemptSchema = z.strictObject({
  status: z.enum([
    'submitted',
    'failed',
    'cancelled',
    'needs_human',
    'budget_exhausted',
  ]),
  summary: text,
  human_active_minutes: z.number().min(0).max(1440),
  human_wait_seconds: counter.max(86400),
});
/** ADR-0129: the finish may end the running step; its reported figures stay as they are. */
export const FinishStudyAttemptRequestSchema = FinishStudyAttemptSchema.extend({
  effort: StudyEffortSchema.optional(),
});
export const StudyAttemptSchema = z.strictObject({
  id,
  study_id: id,
  workspace_id: id,
  run_id: id,
  synthetic: z.boolean(),
  participant_actor_id: id,
  participant_code: text,
  prior_familiarity: text,
  condition: ConditionSchema,
  discovery_method: DiscoverySchema,
  comparison: z.enum(['autonomy', 'discovery']),
  order: counter.min(1),
  continuation_of: id.nullable(),
  primary: z.boolean(),
  manifest_hash: hash,
  context_hash: hash,
  state: z.enum([
    'assigned',
    'submitted',
    'failed',
    'cancelled',
    'needs_human',
    'budget_exhausted',
  ]),
  created_at: z.string(),
  finished_at: z.string().nullable(),
});
export const StudySummarySchema = z.strictObject({
  id,
  title: text,
  synthetic: z.boolean(),
  manifest_hash: hash,
  status: z.enum(['draft_not_frozen', 'final_record']),
  created_at: z.string(),
});
export type StudyInput = z.infer<typeof CreateStudySchema>;
export type StudyImplementation = z.infer<typeof StudyImplementationSchema>;
export type StudyGovernance = z.infer<typeof StudyGovernanceSchema>;
export type StudyAssignment = z.infer<typeof AssignStudySchema>;
export type StudyAttempt = z.infer<typeof StudyAttemptSchema>;
export type StudySummary = z.infer<typeof StudySummarySchema>;
