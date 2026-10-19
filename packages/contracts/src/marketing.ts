import { z, id, hash, timestamp } from './primitives.js';

// Closed test-only channel: no addresses, credentials or live adapter.
const note = z.string().trim().min(1).max(1200);
export const MarketingDraftRequestSchema = z.strictObject({
  artifact_id: id,
  manifest_sha256: hash,
  audience: z.strictObject({
    description: note,
    provenance: note,
    recipients: z
      .array(z.string().regex(/^test:[a-z0-9_.-]{1,60}$/))
      .min(1)
      .max(100),
  }),
  experiment: z.strictObject({
    hypothesis: note,
    metric: z.enum(['demo_completed', 'feedback_received']),
    success_threshold: z.number().int().min(1).max(100),
    price_hypothesis_cents: z.number().int().min(0).max(1000000).nullable(),
    stop_rule: note,
  }),
  budget_nano_usd: z.literal('0'),
  channel: z.literal('local_fixture'),
});
export type MarketingDraftRequest = z.infer<typeof MarketingDraftRequestSchema>;
export const MarketingGrantRequestSchema = z.strictObject({
  content_hash: hash,
  expires_at: timestamp,
  max_deliveries: z.number().int().min(1).max(100),
  budget_nano_usd: z.literal('0'),
  rationale: note,
});
export const MarketingDeliveryRequestSchema = z.strictObject({
  grant_id: id,
  recipient: z.string().regex(/^test:[a-z0-9_.-]{1,60}$/),
  simulation: z.enum([
    'delivered',
    'unknown_after_accept',
    'failed_before_accept',
  ]),
});
export const MarketingSuppressionRequestSchema = z.strictObject({
  recipient: z.string().regex(/^test:[a-z0-9_.-]{1,60}$/),
  reason: note,
});
export const MarketingReasonSchema = z.strictObject({ reason: note });
export const MarketingObservationSchema = z.strictObject({
  delivery_id: id,
  event_key: z.string().regex(/^[a-zA-Z0-9_.:-]{1,100}$/),
  metric: z.enum(['demo_completed', 'feedback_received']),
  note,
});
