import { z, id, version, hash } from './primitives.js';

const note = z.string().trim().max(2000);
export const ThemeIntentBodySchema = z.strictObject({
  format: z.literal('theme-intent/1'),
  theme: z.string().trim().min(1).max(300),
  context: note.default(''),
  solution_constraints: note.default(''),
  questions: z.array(z.string().trim().min(1).max(300)).max(10).default([]),
  source_strategy: z
    .enum(['supplied_public_sources', 'approved_direct_fetch'])
    .default('supplied_public_sources'),
  source_urls: z
    .array(
      z
        .url()
        .max(2000)
        .refine((value) => {
          try {
            const url = new URL(value);
            return url.protocol === 'https:' && !url.username && !url.password;
          } catch {
            return false;
          }
        }, 'Use HTTPS public-source URLs without credentials.'),
    )
    .max(10)
    .default([]),
});
export type ThemeIntentBody = z.infer<typeof ThemeIntentBodySchema>;

export const ThemeResearchPlanSchema = z.strictObject({
  format: z.literal('theme-research-plan/1'),
  workspace_id: id,
  intent: z.strictObject({ id, version, content_hash: hash }),
  questions: z.array(z.string()),
  source_strategy: ThemeIntentBodySchema.shape.source_strategy,
  proposed_sources: z.array(z.string()),
  preparation_limits: z.strictObject({
    provider_requests: z.literal(0),
    source_fetches: z.literal(0),
    new_metered_spend_nano_usd: z.literal('0'),
  }),
  sharing: z.literal(
    'No data is sent externally by saving or preparing this plan.',
  ),
  execution: z.literal('not_authorized'),
  native_search: z.literal('not_integrated_account_entitlement_unknown'),
  prerequisites: z.array(z.string()),
});
