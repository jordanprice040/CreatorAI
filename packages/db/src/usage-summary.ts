import type { PoolClient } from 'pg';
import {
  parse,
  UsageSummarySchema,
  type PlanCaps,
  type UsageSummary,
} from '@creator/contracts';
import { nextRequestAt } from '@creator/domain';
import { runtimeExposure, type SpendingConfig } from './runtime-ceiling.js';
import { iso, type Row } from './store.js';

/**
 * The usage indicator's read model (runbook step 9). Counts use the same rows and the same
 * rolling-window expression as plan admission (ConnectionStore #usage), so "remaining" is what
 * the studio's daily cap still allows, not an estimate. Connection-wide refusals (sign-in,
 * credits, caps, eligibility, provider limit) are reported separately as blockers, from the
 * same connectionBlockers admission uses. Nothing is written.
 */
export async function usageSummary(
  c: PoolClient,
  ws: string,
  spending: SpendingConfig,
  canSeeCost: boolean,
  /** Why the connection as a whole refuses inference now (admission's connectionBlockers). */
  blockersFor: (row: Row) => string[],
  /**
   * Whether the person may add extra requests (ADR-0094): the same test the grant uses, so a
   * tester or non-human holding the owner role is not offered it (review L-1).
   */
  workspaceOwner = false,
): Promise<UsageSummary> {
  const now = await c.query<{ now: Date }>('select clock_timestamp() as now');
  const conns = await c.query(
    `select p.*,
       count(r.id) filter (where r.started_at > clock_timestamp() - interval '24 hours') as day,
       count(distinct r.build_id) filter (where r.path = 'codex'
         and r.started_at > clock_timestamp() - interval '24 hours') as builds,
       max(r.started_at) filter (where r.started_at > clock_timestamp() - interval '24 hours') as newest,
       count(r.id) filter (where r.state = 'in_flight') as in_flight,
       count(r.id) filter (where r.state = 'unknown') as unresolved,
       count(r.id) as total
     from plan_connections p left join plan_requests r on r.connection_id = p.id
     where p.workspace_id = $1
     group by p.id order by p.created_at limit 50`,
    [ws],
  );
  // The per-run cap counts a run's requests over its whole life, so a run that is still active
  // and at its cap stays listed after its last request leaves the 24-hour window. Runs never
  // finish on their own (they can only be cancelled), so a capped run drops off once it is
  // archived, or after 7 days without a request (PR #96 review L-2).
  const runs = await c.query(
    `select r.connection_id, r.run_id, count(*) as n, max(r.started_at) as last
       from plan_requests r
       join plan_connections p on p.id = r.connection_id
       left join run_controls rc on rc.workspace_id = p.workspace_id and rc.run_id = r.run_id
       left join entities e on e.workspace_id = p.workspace_id and e.id = r.run_id
      where r.run_id is not null and r.path = 'responses' and p.workspace_id = $1
      group by r.connection_id, r.run_id, p.settings, rc.state, e.status
     having max(r.started_at) > clock_timestamp() - interval '24 hours'
         or (coalesce(rc.state, 'active') <> 'cancelled'
             and coalesce(e.status, 'active') = 'active'
             and max(r.started_at) > clock_timestamp() - interval '7 days'
             and count(*) >= (p.settings->'caps'->'responses'->>'max_requests_per_run')::bigint)
      order by max(r.started_at) desc`,
    [ws],
  );
  // Start times in the window, oldest first, to find when admission would allow one more.
  const inWindow = await c.query(
    `select connection_id, started_at from plan_requests
      where started_at > clock_timestamp() - interval '24 hours'
        and connection_id in (select id from plan_connections where workspace_id = $1)
      order by started_at`,
    [ws],
  );
  // ADR-0094: unexpired extra requests, soonest expiry first.
  const extrasRows = await c.query(
    `select connection_id, requests, expires_at from plan_extra_requests
      where expires_at > clock_timestamp()
        and connection_id in (select id from plan_connections where workspace_id = $1)
      order by expires_at, granted_at`,
    [ws],
  );
  const nowMs = new Date((now.rows[0] as { now: Date }).now).getTime();
  const later = (t: unknown) =>
    t
      ? new Date(new Date(t as Date).getTime() + 86_400_000).toISOString()
      : null;
  const plans = (conns.rows as Row[]).map((r) => {
    const caps = (r.settings as { caps: PlanCaps }).caps;
    const used = Number(r.day);
    // ADR-0094: admission's cap is the configured one plus unexpired extra requests.
    const configured = caps.shared.max_model_requests_per_day;
    const extras = (extrasRows.rows as Row[])
      .filter((x) => String(x.connection_id) === String(r.id))
      .map((x) => ({
        requests: Number(x.requests),
        expires_at: iso(x.expires_at),
      }));
    const extra = extras.reduce((n, x) => n + x.requests, 0);
    const cap = configured + extra;
    const quota = r.quota as { state: string; observed_at: string | null };
    const starts = (inWindow.rows as Row[]).filter(
      (x) => String(x.connection_id) === String(r.id),
    );
    // When admission allows one more: requests leaving the window and, at the cap, extras
    // expiring before then (nextRequestAt, ADR-0094 review L-2).
    const next = nextRequestAt(
      starts.map((x) => new Date(x.started_at as Date).getTime()),
      configured,
      extras.map((x) => ({
        requests: x.requests,
        expires_ms: Date.parse(x.expires_at),
      })),
      nowMs,
    );
    return {
      connection_id: String(r.id),
      connection_version: Number(r.version),
      kind: (r.kind ?? 'chatgpt_plan') as 'chatgpt_plan' | 'claude_code',
      label: String(r.label),
      fixture: Boolean(r.fixture),
      daily: {
        used,
        cap,
        remaining: Math.max(0, cap - used),
        configured_cap: configured,
        extra,
        extras,
        can_add_extra: workspaceOwner && used >= cap,
        next_frees_at: next === null ? null : new Date(next).toISOString(),
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
      blockers: blockersFor(r),
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
    // The same read the Settings ceiling view and every paid dispatch use, but without the
    // ceiling lock: this is display only and refreshed often, so a snapshot is enough and it
    // must not queue behind (or hold up) paid dispatches and ceiling saves.
    const e = await runtimeExposure(c, spending, null, { lock: false });
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
