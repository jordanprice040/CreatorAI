import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import { z, parse } from '@creator/contracts';

/**
 * The owner's overall ceiling on new runtime spending (config/spending.json, 2026-10-20;
 * changed since only by a signed-in person in Settings, ADR-0043).
 * Every paid dispatch in a real workspace reserves through BudgetStore.prepareAttempt, and
 * final study attempts hold their caps through StudyStore.holdBudget; both check this one
 * ceiling under one lock, so no budget, portfolio, reinvestment or study path can pass it.
 */
const SpendingSchema = z.strictObject({
  schema: z.literal('runtime-spend/1'),
  ceiling_usd: z.string(),
  ceiling_nano_usd: z.string().regex(/^(0|[1-9][0-9]{0,24})$/),
  effective_from: z.iso.datetime(),
  decided_by: z.string().min(1),
  decided_on: z.string(),
  source: z.string(),
  covers: z.string(),
  change_rule: z.string(),
});
export type SpendingConfig = z.infer<typeof SpendingSchema>;

export function readSpendingConfig(
  path: string | URL = new URL(
    '../../../config/spending.json',
    import.meta.url,
  ),
): SpendingConfig {
  return parse(
    SpendingSchema,
    JSON.parse(readFileSync(path, 'utf8')) as unknown,
    'INVALID_CONFIG',
  );
}

/**
 * The ceiling in force: the latest owner change made in Settings (migration 30), else the
 * configured value. Read under the runtime-ceiling lock so a change and a dispatch serialize.
 */
export async function currentCeiling(c: PoolClient, config: SpendingConfig) {
  const { rows } = await c.query<{ version: number; ceiling: string }>(
    `select version, ceiling_nano::text as ceiling from runtime_ceiling_changes
      order by version desc limit 1`,
  );
  const latest = rows[0];
  return latest
    ? {
        ceiling_nano_usd: latest.ceiling,
        version: Number(latest.version),
        source: 'settings' as const,
      }
    : {
        ceiling_nano_usd: config.ceiling_nano_usd,
        version: 0,
        source: 'config' as const,
      };
}

export interface RuntimeExposure {
  ceiling_nano_usd: string;
  exposure_nano_usd: string;
  unknown_calls: number;
  /** True when the asking run belongs to an open final study attempt already held at its cap. */
  covered_by_hold: boolean;
}

/**
 * Locks the ceiling and reads what already counts against it: settled cost, held exposure of
 * in-flight and unknown paid calls since `effective_from`, and open final study attempts at
 * their full cap (their own calls are not counted twice). Call inside the deciding transaction.
 */
export async function runtimeExposure(
  c: PoolClient,
  config: SpendingConfig,
  scope: { ws: string; runId: string } | null = null,
): Promise<RuntimeExposure> {
  await c.query("select pg_advisory_xact_lock(hashtext('runtime-ceiling'))");
  const ceiling = await currentCeiling(c, config);
  const { rows } = await c.query<{
    exposure: string;
    unknown: number;
    covered: boolean;
  }>(
    `with open_holds as (
       select h.cap_nano, t.workspace_id, t.run_id from study_budget_holds h
         join study_attempts t on t.id = h.attempt_id
        where h.ledger = 't15-final' and not exists (
          select 1 from study_events e where e.attempt_id = h.attempt_id and e.kind = 'finished'))
     select ((select coalesce(sum(cap_nano), 0) from open_holds) +
       (select coalesce(sum(case when r.status = 'settled' then coalesce(r.incurred_nano, 0)
                                 when r.status in ('in_flight', 'unknown') then r.reserved_nano
                                 else 0 end), 0)
          from budget_reservations r
         where not r.fixture and r.created_at >= $1 and not exists (
           select 1 from open_holds o where o.workspace_id = r.workspace_id and o.run_id = r.run_id)
       ))::text as exposure,
       (select count(*)::int from budget_reservations where not fixture and status = 'unknown') as unknown,
       exists(select 1 from open_holds where workspace_id = $2 and run_id = $3) as covered`,
    [config.effective_from, scope?.ws ?? null, scope?.runId ?? null],
  );
  return {
    ceiling_nano_usd: ceiling.ceiling_nano_usd,
    exposure_nano_usd: rows[0]!.exposure,
    unknown_calls: Number(rows[0]!.unknown),
    covered_by_hold: rows[0]!.covered === true,
  };
}

/**
 * Null when `amount` fits; otherwise the reason code and explanation for the refusal. A call
 * inside an open final study attempt is already counted at that attempt's full cap, so only
 * the unknown-cost rule applies to it (the attempt's own cap is enforced by the study gate).
 */
export function ceilingRefusal(
  e: RuntimeExposure,
  amount: bigint,
): { reason_code: string; explanation: string } | null {
  if (e.unknown_calls > 0)
    return {
      reason_code: 'runtime_unknown_cost',
      explanation: `${e.unknown_calls} earlier paid call(s) have an unknown cost; reconcile them before any new paid dispatch.`,
    };
  if (e.covered_by_hold) return null;
  const left = BigInt(e.ceiling_nano_usd) - BigInt(e.exposure_nano_usd);
  if (amount > left)
    return {
      reason_code: 'runtime_ceiling',
      explanation: `The owner's overall runtime ceiling has ${left < 0n ? 0n : left} nano-USD left; this needs ${amount}.`,
    };
  return null;
}
