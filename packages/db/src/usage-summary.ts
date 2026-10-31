import type { PoolClient } from 'pg';
import {
  parse,
  UsageSummarySchema,
  type PlanCaps,
  type UsageSummary,
} from '@creator/contracts';
import { runtimeExposure, type SpendingConfig } from './runtime-ceiling.js';
import { iso, type Row } from './store.js';

/**
 * The usage indicator's read model (runbook step 9). Counts use the same rows and the same
 * rolling-window expression as plan admission (ConnectionStore #usage), so "remaining" here is
 * what admission would allow next, not an estimate. Nothing is written.
 */
export async function usageSummary(
  c: PoolClient,
  ws: string,
  spending: SpendingConfig,
  canSeeCost: boolean,
): Promise<UsageSummary> {
  const now = await c.query<{ now: Date }>('select clock_timestamp() as now');
  const conns = await c.query(
    `select p.id, p.kind, p.label, p.fixture, p.settings, p.quota,
       count(r.id) filter (where r.started_at > clock_timestamp() - interval '24 hours') as day,
       count(distinct r.build_id) filter (where r.path = 'codex'
         and r.started_at > clock_timestamp() - interval '24 hours') as builds,
       min(r.started_at) filter (where r.started_at > clock_timestamp() - interval '24 hours') as oldest,
       max(r.started_at) filter (where r.started_at > clock_timestamp() - interval '24 hours') as newest,
       count(r.id) filter (where r.state = 'in_flight') as in_flight,
       count(r.id) filter (where r.state = 'unknown') as unresolved,
       count(r.id) as total
     from plan_connections p left join plan_requests r on r.connection_id = p.id
     where p.workspace_id = $1
     group by p.id order by p.created_at limit 50`,
    [ws],
  );
  const runs = await c.query(
    `select connection_id, run_id, count(*) as n, max(started_at) as last
       from plan_requests
      where run_id is not null and path = 'responses'
        and connection_id in (select id from plan_connections where workspace_id = $1)
      group by connection_id, run_id
     having max(started_at) > clock_timestamp() - interval '24 hours'
      order by max(started_at) desc`,
    [ws],
  );
  const later = (t: unknown) =>
    t
      ? new Date(new Date(t as Date).getTime() + 86_400_000).toISOString()
      : null;
  const plans = (conns.rows as Row[]).map((r) => {
    const caps = (r.settings as { caps: PlanCaps }).caps;
    const used = Number(r.day);
    const cap = caps.shared.max_model_requests_per_day;
    const quota = r.quota as { state: string; observed_at: string | null };
    return {
      connection_id: String(r.id),
      kind: (r.kind ?? 'chatgpt_plan') as 'chatgpt_plan' | 'claude_code',
      label: String(r.label),
      fixture: Boolean(r.fixture),
      daily: {
        used,
        cap,
        remaining: Math.max(0, cap - used),
        next_frees_at: later(r.oldest),
        clears_at: later(r.newest),
      },
      codex_builds: {
        used: Number(r.builds),
        cap: caps.codex.max_builds_per_day,
      },
      runs: (runs.rows as Row[])
        .filter((x) => String(x.connection_id) === String(r.id))
        .slice(0, 10)
        .map((x) => ({
          run_id: String(x.run_id),
          requests: Number(x.n),
          cap: caps.responses.max_requests_per_run,
          last_request_at: iso(x.last),
        })),
      in_flight: Number(r.in_flight),
      unresolved: Number(r.unresolved),
      provider_quota: {
        state: quota.state,
        observed_at: quota.observed_at
          ? new Date(quota.observed_at).toISOString()
          : null,
      },
      total_requests: Number(r.total),
    };
  });
  const app = await c.query(
    `select
       count(*) filter (where r.started_at > clock_timestamp() - interval '24 hours') as day,
       count(*) filter (where r.started_at > clock_timestamp() - interval '7 days') as week,
       count(*) as total
     from plan_requests r join plan_connections p on p.id = r.connection_id
     where p.workspace_id = $1`,
    [ws],
  );
  let api_cost: UsageSummary['api_cost'] = null;
  if (canSeeCost) {
    // The same locked read the Settings ceiling view and every paid dispatch use.
    const e = await runtimeExposure(c, spending);
    const paid = await c.query(
      `select count(*) as n from budget_reservations
        where not fixture and created_at >= $1`,
      [spending.effective_from],
    );
    const left = BigInt(e.ceiling_nano_usd) - BigInt(e.exposure_nano_usd);
    api_cost = {
      ceiling_nano_usd: e.ceiling_nano_usd,
      exposure_nano_usd: e.exposure_nano_usd,
      remaining_nano_usd: (left > 0n ? left : 0n).toString(),
      counted_since: iso(spending.effective_from),
      unknown_calls: e.unknown_calls,
      paid_calls: Number((paid.rows[0] as Row).n),
    };
  }
  const a = app.rows[0] as Row;
  return parse(UsageSummarySchema, {
    as_of: iso(now.rows[0]!.now),
    workspace_id: ws,
    plans,
    app: {
      plan_requests_24h: Number(a.day),
      plan_requests_7d: Number(a.week),
      plan_requests_total: Number(a.total),
    },
    api_cost,
    api_cost_hidden_reason: canSeeCost
      ? null
      : 'Only a person who owns a workspace can see API spending against the ceiling.',
  });
}
