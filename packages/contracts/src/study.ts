import { SearchBriefBodySchema } from './discovery.js';
import {
  z,
  id,
  text,
  hash,
  counter,
  nanoUsd,
  ConditionSchema,
  DiscoverySchema,
} from './primitives.js';

const frozenText = z.strictObject({ version: text, text });
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
  })
  .superRefine((p, ctx) => {
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
  synthetic: z.literal(true),
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
export const StudyAttemptSchema = z.strictObject({
  id,
  study_id: id,
  workspace_id: id,
  run_id: id,
  synthetic: z.literal(true),
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
  synthetic: z.literal(true),
  manifest_hash: hash,
  status: z.literal('draft_not_frozen'),
  created_at: z.string(),
});
export type StudyInput = z.infer<typeof CreateStudySchema>;
export type StudyAssignment = z.infer<typeof AssignStudySchema>;
export type StudyAttempt = z.infer<typeof StudyAttemptSchema>;
export type StudySummary = z.infer<typeof StudySummarySchema>;
