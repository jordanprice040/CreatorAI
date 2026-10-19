import { z, id, hash, timestamp, version, nanoUsd } from './primitives.js';
import { StartWorkflowRequestSchema } from './orchestration.js';

export const PortfolioLaneSchema = z.enum([
  'maintenance',
  'improvement',
  'exploration',
]);
export type PortfolioLane = z.infer<typeof PortfolioLaneSchema>;
const note = z.string().trim().min(1).max(1200);
export const PortfolioPolicyRequestSchema = z.strictObject({
  expected_version: z.number().int().min(0),
  mode: z.enum(['normal', 'conserve', 'maintenance_only', 'paused']),
  root_envelope_id: id,
  maintenance_envelope_id: id,
  reserve_floor_nano_usd: nanoUsd,
  max_active: z.number().int().min(1).max(16),
  max_review_backlog: z.number().int().min(1).max(100),
  max_starts_per_tick: z.number().int().min(1).max(8),
  tick_interval_seconds: z.number().int().min(15).max(86400),
  rationale: note,
});
export type PortfolioPolicyRequest = z.infer<
  typeof PortfolioPolicyRequestSchema
>;
export const PortfolioRunRequestSchema = z.strictObject({
  run_id: id,
  lane: PortfolioLaneSchema,
  rationale: note,
});
export const PortfolioScheduleRequestSchema = z.strictObject({
  label: z.string().trim().min(1).max(200),
  run_id: id,
  lane: PortfolioLaneSchema,
  interval_seconds: z.number().int().min(60).max(31536000),
  first_due_at: timestamp,
  operation: z.discriminatedUnion('kind', [
    z.strictObject({
      kind: z.literal('health_check'),
      artifact_id: id,
      manifest_sha256: hash,
    }),
    z.strictObject({
      kind: z.literal('source_refresh'),
      source_id: id,
      source_version: version,
      source_hash: hash,
    }),
    z.strictObject({
      kind: z.literal('review'),
      request: StartWorkflowRequestSchema,
    }),
  ]),
});
export type PortfolioScheduleRequest = z.infer<
  typeof PortfolioScheduleRequestSchema
>;
export const PortfolioReasonSchema = z.strictObject({ reason: note });
export const PortfolioJobReconcileSchema = z.strictObject({
  job_id: id,
  reason: note,
});
export const PortfolioHealthDecisionSchema = z.strictObject({
  artifact_id: id,
  expected_job_id: id,
  choice: z.enum(['defer', 'reopen']),
  reason: note,
});
export const KnowledgeProposalSchema = z.strictObject({
  key: z.string().regex(/^[a-z][a-z0-9_-]{0,59}$/),
  kind: z.enum(['component', 'lesson', 'prompt', 'skill']),
  title: z.string().trim().min(1).max(200),
  guidance: z.array(z.string().trim().min(1).max(120)).min(1).max(4),
  permitted_lanes: z.array(PortfolioLaneSchema).min(1).max(3),
  data_class: z.enum(['synthetic', 'public']),
  permitted_use: z.literal('task_review_guidance'),
  provenance: z
    .array(
      z.strictObject({
        entity_id: id,
        version,
        content_hash: hash,
        locator: note,
      }),
    )
    .min(1)
    .max(8),
  limitations: note,
});
export type KnowledgeProposal = z.infer<typeof KnowledgeProposalSchema>;
export const KnowledgeReviewSchema = z.strictObject({
  body_hash: hash,
  regression_id: id,
  reason: note,
});
export const KnowledgeActivationSchema = z.strictObject({
  candidate_id: id,
  expected_active_id: id.nullable(),
  reason: note,
});
