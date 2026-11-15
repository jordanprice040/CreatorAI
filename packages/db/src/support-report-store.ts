import type { Pool } from 'pg';
import type { SupportConnection, SupportFailure } from '@creator/domain';
import { iso, type Row } from './store.js';

// ADR-0118 (F5): read-only facts for the owner's support report. Only states, reason codes,
// short explanations, ids and times are selected; credential references, account labels, key
// digits, request bodies and outputs are never read here.

const FAILURES = `
select * from (
  select updated_at as at, 'workflow' as source, id::text, workspace_id::text, fixture,
    state, reason as detail
  from workflows where state = 'failed'
  union all
  select t.updated_at, 'workflow step', t.id::text, t.workspace_id::text, w.fixture,
    t.state, t.kind || ': ' || t.reason
  from workflow_tasks t join workflows w on w.id = t.workflow_id
  where t.state in ('failed', 'needs_human')
  union all
  select coalesce(finished_at, updated_at), 'autopilot', id::text, workspace_id::text, fixture,
    outcome, stage || ': ' || explanation
  from autopilots where outcome = 'failed'
  union all
  select coalesce(finished_at, updated_at), 'web discovery', id::text, workspace_id::text,
    fixture, state, explanation
  from web_discoveries where state in ('failed', 'interrupted')
  union all
  select coalesce(r.finished_at, r.started_at), 'model request', r.id::text,
    c.workspace_id::text, c.fixture, r.state,
    r.purpose || ' ' || r.model_id || coalesce(': ' || r.reason_code, '')
  from plan_requests r join plan_connections c on c.id = r.connection_id
  where r.state in ('failed', 'rejected', 'unknown')
  union all
  select updated_at, 'github ' || kind, id::text, workspace_id::text, fixture, state,
    reason_code || ': ' || explanation
  from github_operations where state in ('failed', 'unknown')
  union all
  select created_at, 'portfolio scheduler', sequence::text, workspace_id::text, null, 'failed',
    error_code || ': ' || error
  from portfolio_scheduler_failures
  union all
  select coalesce(finished_at, created_at), 'portfolio job', id::text, workspace_id::text, null,
    state, lane
  from portfolio_jobs where state in ('failed', 'unknown')
  union all
  select coalesce(finished_at, started_at), 'recipe qualification attempt', id::text, null,
    null, state, reason
  from recipe_qualification_attempts where state in ('failed', 'invalid')
) f order by at desc, id limit $1`;

const CONNECTIONS = `
select 'model connection ' || c.kind as kind, c.id::text, c.workspace_id::text, c.fixture,
  c.label, coalesce(c.sign_in->>'state', 'unknown') as state, c.status_reason as reason,
  (select count(*)::int from plan_requests r where r.connection_id = c.id
     and r.state in ('failed', 'rejected', 'unknown')
     and r.started_at > clock_timestamp() - interval '24 hours') as problems
from plan_connections c
union all
select 'github connection', id::text, workspace_id::text, fixture, 'GitHub', status,
  status_reason,
  (select count(*)::int from github_operations o where o.connection_id = g.id
     and o.state in ('failed', 'unknown')
     and o.updated_at > clock_timestamp() - interval '24 hours')
from github_connections g
union all
select 'api key ' || provider, workspace_id::text, workspace_id::text, fixture, model_id,
  'saved', null, 0
from workspace_api_keys
order by kind, id`;

const bool = (v: unknown) =>
  v === null || v === undefined ? null : Boolean(v);
const text = (v: unknown) => (v === null || v === undefined ? null : String(v));

export async function supportFailures(
  pool: Pool,
  limit: number,
): Promise<SupportFailure[]> {
  const { rows } = await pool.query(FAILURES, [
    Math.min(Math.max(1, limit), 50),
  ]);
  return (rows as Row[]).map((r) => ({
    at: iso(r.at),
    source: String(r.source),
    id: String(r.id),
    workspace_id: text(r.workspace_id),
    fixture: bool(r.fixture),
    state: String(r.state),
    detail: text(r.detail),
  }));
}

export async function supportConnections(
  pool: Pool,
): Promise<SupportConnection[]> {
  const { rows } = await pool.query(CONNECTIONS);
  return (rows as Row[]).map((r) => ({
    kind: String(r.kind),
    id: String(r.id),
    workspace_id: text(r.workspace_id),
    fixture: bool(r.fixture),
    label: String(r.label),
    state: String(r.state),
    reason: text(r.reason),
    problems_24h: Number(r.problems),
  }));
}
