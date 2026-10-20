import type { PoolClient } from 'pg';
import type { PortfolioLane, PortfolioPolicyRequest } from '@creator/contracts';
import { portfolioReason } from '@creator/domain';
import { fail } from './store.js';
import { workflowKnowledgeValid } from './knowledge-context.js';

export type PortfolioPolicy = PortfolioPolicyRequest & {
  version: number;
  workspace_id: string;
  next_tick_at: Date;
};
const n = (v: unknown) => BigInt(String(v ?? 0));
export async function portfolioState(
  c: PoolClient,
  ws: string,
  runId: string | null,
) {
  const p = (
    await c.query('select * from portfolio_policies where workspace_id=$1', [
      ws,
    ])
  ).rows[0];
  if (!p) return null;
  const policy = {
    ...p.body,
    version: Number(p.version),
    workspace_id: ws,
    next_tick_at: p.next_tick_at,
  } as PortfolioPolicy;
  const lane = (
    await c.query(
      'select lane from portfolio_run_lanes where workspace_id=$1 and run_id=$2',
      [ws, runId],
    )
  ).rows[0]?.lane as PortfolioLane | undefined;
  const reserve = (
    await c.query(
      `select * from budget_envelopes where workspace_id=$1 and id=$2`,
      [ws, policy.maintenance_envelope_id],
    )
  ).rows[0];
  const available =
    reserve?.status === 'active' &&
    (!reserve.starts_at ||
      new Date(reserve.starts_at).getTime() <= Date.now()) &&
    (!reserve.ends_at || new Date(reserve.ends_at).getTime() > Date.now())
      ? n(reserve.cap_nano) -
        n(reserve.allocated_nano) -
        n(reserve.reserved_nano) -
        n(reserve.unknown_nano) -
        n(reserve.incurred_nano)
      : 0n;
  const counts = (
    await c.query(
      `select
    (select count(*) from portfolio_schedules s join run_controls r on r.workspace_id=s.workspace_id and r.run_id=s.run_id
      where s.workspace_id=$1 and not s.cancelled and r.state='active' and s.lane='maintenance' and s.next_due_at<=clock_timestamp()) +
    (select count(*) from portfolio_jobs where workspace_id=$1 and lane='maintenance' and run_id is distinct from $2::uuid and state in ('dispatching','unknown')) +
    (select count(*) from workflows w join portfolio_run_lanes l on l.workspace_id=w.workspace_id and l.run_id=w.run_id
      where w.workspace_id=$1 and l.lane='maintenance' and w.run_id is distinct from $2::uuid and w.finished_at is null) as maintenance_due,
    (select count(*) from decision_requests where workspace_id=$1 and status='pending')+
    (select count(*) from artifact_feedback where workspace_id=$1 and status='submitted') as reviews,
    -- Older work keeps its slot and newer work waits. Counting every other unfinished
    -- workflow would make each run wait on the others, and none would ever lease.
    (select count(*) from workflows w where w.workspace_id=$1 and w.run_id is distinct from $2::uuid and w.finished_at is null
      and not exists (select 1 from workflows o where o.workspace_id=$1 and o.run_id=$2::uuid
        and o.finished_at is null and o.created_at <= w.created_at))+
    (select count(*) from portfolio_jobs where workspace_id=$1 and run_id is distinct from $2::uuid and state in ('dispatching','unknown')) as active,
    (select count(*) from portfolio_health where workspace_id=$1 and state not in ('package_integrity_passed','owner_deferred')) as unhealthy`,
      [ws, runId],
    )
  ).rows[0];
  return {
    policy,
    lane: lane ?? 'exploration',
    reserve_available: available.toString(),
    maintenance_due: Number(counts.maintenance_due),
    review_backlog: Number(counts.reviews),
    active: Number(counts.active),
    unhealthy: Number(counts.unhealthy),
  };
}
export async function portfolioActionGate(
  c: PoolClient,
  ws: string,
  runId: string,
  action: string,
) {
  if (
    ![
      'model.generate',
      'model.summarize',
      'model.embed',
      'tool.search_public',
      'source.fetch',
      'product.commit_build',
    ].includes(action)
  )
    return null;
  // Frozen study work never inherits changing portfolio policy or reusable knowledge.
  if (
    (
      await c.query(
        'select 1 from study_attempts where workspace_id=$1 and run_id=$2',
        [ws, runId],
      )
    ).rowCount
  )
    return null;
  if (!(await workflowKnowledgeValid(c, ws, runId)))
    return 'knowledge_binding_invalid';
  if (
    (
      await c.query(
        'select 1 from portfolio_schedules where workspace_id=$1 and run_id=$2 and cancelled',
        [ws, runId],
      )
    ).rowCount
  )
    return 'portfolio_schedule_cancelled';
  const s = await portfolioState(c, ws, runId);
  if (!s) return null;
  return portfolioReason({
    mode: s.policy.mode,
    lane: s.lane,
    maintenanceDue: s.maintenance_due,
    reviewBacklog: s.review_backlog,
    maxReviewBacklog: s.policy.max_review_backlog,
    reserveAvailable: BigInt(s.reserve_available),
    reserveFloor: BigInt(s.policy.reserve_floor_nano_usd),
    active: s.active,
    capacity: s.policy.max_active,
    unhealthy: s.unhealthy,
  });
}
export async function portfolioEffectFence(
  c: PoolClient,
  ws: string,
  runId: string,
  key: string | undefined,
) {
  if (!key?.startsWith('portfolio-job:')) return;
  const { rows } = await c.query(
    `select j.state,s.cancelled from portfolio_jobs j join portfolio_schedules s on s.id=j.schedule_id
    where j.workspace_id=$1 and j.run_id=$2 and j.id::text=$3 for update of j`,
    [ws, runId, key.slice('portfolio-job:'.length)],
  );
  if (
    !rows[0] ||
    rows[0].cancelled ||
    !['dispatching', 'unknown'].includes(rows[0].state)
  )
    throw fail(
      'LEASE_LOST',
      'Portfolio job is fenced; no dispatch is allowed.',
    );
}
export async function portfolioEnvelopeGate(
  c: PoolClient,
  ws: string,
  runId: string,
  envelopeId: string,
) {
  const s = await portfolioState(c, ws, runId);
  if (!s) return null;
  if (
    (
      await c.query(
        'select 1 from study_attempts where workspace_id=$1 and run_id=$2',
        [ws, runId],
      )
    ).rowCount
  )
    return null;
  const chain = (
    await c.query(
      `with recursive parents as (
    select id,parent_id from budget_envelopes where workspace_id=$1 and id=$2
    union all select b.id,b.parent_id from budget_envelopes b join parents p on p.parent_id=b.id where b.workspace_id=$1)
    select id from parents`,
      [ws, envelopeId],
    )
  ).rows.map((r) => r.id);
  if (!chain.includes(s.policy.root_envelope_id))
    return 'portfolio_budget_outside_root';
  const maintenance = chain.includes(s.policy.maintenance_envelope_id);
  if (maintenance !== (s.lane === 'maintenance'))
    return 'portfolio_budget_lane_mismatch';
  return null;
}
