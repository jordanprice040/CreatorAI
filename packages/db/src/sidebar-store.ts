import type { PoolClient } from 'pg';
import {
  ACTIVITY_NOW_MAX,
  type ActivityNowItem,
  type WorkspaceNote,
} from '@creator/contracts';
import { iso, type Row } from './store.js';

// ADR-0060 right-hand sidebar: the SQL behind the notepad and the "Running now" list. The store
// methods in connection-store.ts hold the transaction and the membership check.

/** The signed-in person's note for a workspace; an empty note at version 0 before the first save. */
export async function workspaceNote(
  c: PoolClient,
  ws: string,
  actor: string,
  lock = false,
): Promise<WorkspaceNote> {
  const { rows } = await c.query(
    `select text, version, updated_at from workspace_notes
     where workspace_id = $1 and actor_id = $2${lock ? ' for update' : ''}`,
    [ws, actor],
  );
  const r = rows[0] as Row | undefined;
  return {
    workspace_id: ws,
    text: r ? String(r.text) : '',
    version: r ? Number(r.version) : 0,
    updated_at: r ? iso(r.updated_at) : null,
  };
}

const PLAN_PURPOSE: Record<string, string> = {
  verification: 'Checking a model connection',
  availability_recheck: 'Rechecking model availability',
  qualification: 'Qualifying a model',
  task: 'Model request',
  codex_build: 'Building a product',
  chat: 'Chat answer',
};

const WORKFLOW_ROLE: Record<string, string> = {
  r02_discovery: 'Discovery research',
  r05_skeptic: 'Skeptic review',
};

const words = (s: string) => s.replace(/_/g, ' ');

/**
 * Review L-2: a plan request still `in_flight` this long after it started was most likely cut
 * off (studio stopped or crashed) and will stay that way until it is reconciled on Models.
 * Re-review L-C: it must outlast the request's own timeout. ADR-0062 removed the timeouts'
 * upper limits, so the wait is the connection's timeout for that kind of request (the build
 * timeout for a Codex build, else the request timeout) plus STALE_PLAN_REQUEST_MARGIN_MS, and
 * never less than STALE_PLAN_REQUEST_MS. It reads the connection's current timeout, not the one
 * in force when the request started: lowering it mid-request can only show the request as
 * stale early (a label), never send anything (PR #123 review L-2).
 */
export const STALE_PLAN_REQUEST_MS = 45 * 60_000;
export const STALE_PLAN_REQUEST_MARGIN_MS = 15 * 60_000;

/**
 * The time after which an in-flight plan request (aliased `pr`, its connection `pc`) counts as
 * cut off, by the rule above. One fragment for this panel and for when the owner may close the
 * request on Models (ADR-0064), so the two cannot disagree.
 */
export const PLAN_REQUEST_STALE_AFTER = `pr.started_at + make_interval(secs => greatest(
   ${STALE_PLAN_REQUEST_MS}::double precision,
   coalesce((pc.settings #>> case when pr.purpose = 'codex_build'
     then '{caps,codex,build_timeout_ms}'::text[]
     else '{caps,responses,request_timeout_ms}'::text[] end)::double precision, 0)
     + ${STALE_PLAN_REQUEST_MARGIN_MS}::double precision) / 1000)`;

/** Review L-3: plain words per workflow state, and whether it is moving on its own. */
const WORKFLOW_STATE: Record<string, [string, boolean]> = {
  queued: ['queued', true],
  running: ['running', true],
  reconciling: ['checking the outcome', true],
  waiting_human: ['waiting for you', false],
  waiting_dependency: ['waiting on another step', false],
  paused_operator: ['paused', false],
};
const DESKTOP_STATE: Record<string, string> = {
  queued: 'queued',
  leased: 'starting',
  running: 'running',
  reconciling: 'checking the outcome',
};

/**
 * Work in this workspace that has started and not finished, newest first: plan requests still
 * in flight, unfinished workflows and product runs on a paired computer. Names, states and times
 * only; no prompts, outputs or inputs are read.
 */
export async function activityNow(
  c: PoolClient,
  ws: string,
): Promise<ActivityNowItem[]> {
  const items: ActivityNowItem[] = [];
  const plan = await c.query(
    `select pr.id, pr.purpose, pr.model_id, pr.task_class, pr.run_id, pr.started_at,
       ${PLAN_REQUEST_STALE_AFTER} < clock_timestamp() as stale
     from plan_requests pr join plan_connections pc on pc.id = pr.connection_id
     where pc.workspace_id = $1 and pr.state = 'in_flight'
     order by pr.started_at desc limit $2`,
    [ws, ACTIVITY_NOW_MAX],
  );
  for (const r of plan.rows as Row[]) {
    const purpose = String(r.purpose);
    const stale = Boolean(r.stale);
    items.push({
      kind: 'plan_request',
      id: String(r.id),
      label: PLAN_PURPOSE[purpose] ?? words(purpose),
      detail: [r.model_id, r.task_class ? words(String(r.task_class)) : null]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 200),
      state: stale
        ? 'no answer recorded; check Models and connections'
        : 'waiting for the model',
      active: !stale,
      purpose,
      run_id: r.run_id ? String(r.run_id) : null,
      started_at: iso(r.started_at),
    });
  }
  const flows = await c.query(
    `select id, role, state, reason, run_id, created_at from workflows
     where workspace_id = $1 and state not in ('succeeded','failed','cancelled')
     order by created_at desc limit $2`,
    [ws, ACTIVITY_NOW_MAX],
  );
  for (const r of flows.rows as Row[]) {
    const role = String(r.role);
    const [stateText, active] = WORKFLOW_STATE[String(r.state)] ?? [
      words(String(r.state)),
      false,
    ];
    items.push({
      kind: 'workflow',
      id: String(r.id),
      label: WORKFLOW_ROLE[role] ?? words(role),
      // The reason often just repeats the state ("running"); show it only when it adds something.
      detail:
        String(r.reason ?? '') === String(r.state)
          ? ''
          : String(r.reason ?? '').slice(0, 200),
      state: stateText,
      active,
      purpose: null,
      run_id: String(r.run_id),
      started_at: iso(r.created_at),
    });
  }
  const jobs = await c.query(
    `select id, state, created_at from desktop_jobs
     where workspace_id = $1 and state in ('queued','leased','running','reconciling')
     order by created_at desc limit $2`,
    [ws, ACTIVITY_NOW_MAX],
  );
  for (const r of jobs.rows as Row[])
    items.push({
      kind: 'desktop_job',
      id: String(r.id),
      label: 'Running a product on your computer',
      detail: '',
      state: DESKTOP_STATE[String(r.state)] ?? words(String(r.state)),
      active: true,
      purpose: null,
      run_id: null,
      started_at: iso(r.created_at),
    });
  return items.sort((a, b) => b.started_at.localeCompare(a.started_at));
}
