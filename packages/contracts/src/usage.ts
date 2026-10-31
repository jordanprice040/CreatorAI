import { z, id, timestamp, counter, nanoUsd } from './primitives.js';
import { PlanProviderSchema, QuotaStateSchema } from './connections.js';

// Runbook step 9 usage indicator: one read-only summary of how much of each limit the studio
// has used. It reports the studio's own counts and caps. A provider's own plan allowance
// (ChatGPT or Claude usage limits) is not visible to the app; only the last refusal the
// studio observed (quota state) is reported, never an invented "remaining" figure.

const label = z.string().trim().min(1).max(80);

export const PlanRunUsageSchema = z.strictObject({
  run_id: id,
  /** Direct-path requests this run has made in total (the per-run cap counts all of them). */
  requests: counter,
  cap: counter,
  last_request_at: timestamp,
});
export type PlanRunUsage = z.infer<typeof PlanRunUsageSchema>;

export const PlanConnectionUsageSchema = z.strictObject({
  connection_id: id,
  kind: PlanProviderSchema,
  label,
  fixture: z.boolean(),
  /** Rolling 24 hours, both paths: the studio's own daily cap, not the provider's limit. */
  daily: z.strictObject({
    used: counter,
    cap: counter,
    remaining: counter,
    /**
     * When one more request becomes possible: the oldest request in the window leaving it, or,
     * when a lowered cap sits below what is already used, the request whose leaving brings
     * used back under the cap.
     */
    next_frees_at: timestamp.nullable(),
    /** When every request now in the window has left it. */
    clears_at: timestamp.nullable(),
  }),
  codex_builds: z.strictObject({ used: counter, cap: counter }),
  /**
   * Runs with a direct-path request in the last 24 hours, plus active runs already at their
   * lifetime per-run cap however old their last request, newest first (at most 10).
   */
  runs: z.array(PlanRunUsageSchema).max(10),
  in_flight: counter,
  /** Requests with an unknown outcome; they block new requests until reconciled. */
  unresolved: counter,
  /** The provider's own allowance as last observed by the studio (not a live reading). */
  provider_quota: z.strictObject({
    state: QuotaStateSchema,
    observed_at: timestamp.nullable(),
  }),
  total_requests: counter,
  /**
   * Why the connection refuses every request now (signed out, credits not confirmed off,
   * caps not accepted, not eligible, provider limit reached). Empty means none of these.
   */
  blockers: z.array(z.string().max(1200)).max(20),
});
export type PlanConnectionUsage = z.infer<typeof PlanConnectionUsageSchema>;

export const ApiCostUsageSchema = z.strictObject({
  ceiling_nano_usd: nanoUsd,
  /** Settled cost plus held in-flight and unknown exposure, and open study holds. */
  exposure_nano_usd: nanoUsd,
  /** Ceiling minus exposure, floored at zero. */
  remaining_nano_usd: nanoUsd,
  counted_since: timestamp,
  unknown_calls: counter,
  /** Metered (non-fixture) paid calls counted since `counted_since`, any outcome. */
  paid_calls: counter,
});
export type ApiCostUsage = z.infer<typeof ApiCostUsageSchema>;

export const UsageSummarySchema = z.strictObject({
  as_of: timestamp,
  workspace_id: id,
  plans: z.array(PlanConnectionUsageSchema).max(50),
  /** This workspace's plan requests across its connections (the app's own use). */
  app: z.strictObject({
    plan_requests_24h: counter,
    plan_requests_7d: counter,
    plan_requests_total: counter,
  }),
  /**
   * Null when the signed-in person may not see the spending ceiling (only a person who owns
   * a workspace may, ADR-0043); `api_cost_hidden_reason` then says why.
   */
  api_cost: ApiCostUsageSchema.nullable(),
  api_cost_hidden_reason: z.string().max(300).nullable(),
});
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
