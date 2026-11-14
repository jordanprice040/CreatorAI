import type { PoolClient } from 'pg';
import {
  ACTIVITY_NOW_MAX,
  ContractError,
  type ActivityNowItem,
  type WorkspaceNote,
  type WorkspaceNoteSummary,
} from '@creator/contracts';
import { iso, type Row } from './store.js';

// ADR-0060 right-hand sidebar: the SQL behind the notepad and the "Running now" list. The store
// methods in connection-store.ts hold the transaction and the membership check.

const NOTE_COLUMNS = `id, workspace_id, title, version, status, from_notepad, created_at, updated_at`;

function noteFields(r: Row) {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    title: String(r.title),
    version: Number(r.version),
    status: r.status as 'active' | 'archived',
    from_notepad: Boolean(r.from_notepad),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}

/** ADR-0073: one of the signed-in person's notes; another person's note is not found. */
export async function workspaceNote(
  c: PoolClient,
  ws: string,
  actor: string,
  note: string,
  lock = false,
): Promise<WorkspaceNote> {
  const { rows } = await c.query(
    `select ${NOTE_COLUMNS}, text from personal_notes
     where workspace_id = $1 and actor_id = $2 and id = $3${lock ? ' for update' : ''}`,
    [ws, actor, note],
  );
  const r = rows[0] as Row | undefined;
  if (!r) throw new ContractError('NOT_FOUND', 'Note not found.');
  return { ...noteFields(r), text: String(r.text) };
}

/** The person's notes in a workspace, most recently changed first, without their text. */
export async function workspaceNotes(
  c: PoolClient,
  ws: string,
  actor: string,
): Promise<WorkspaceNoteSummary[]> {
  const { rows } = await c.query(
    `select ${NOTE_COLUMNS}, length(text) as chars from personal_notes
     where workspace_id = $1 and actor_id = $2 order by updated_at desc, id desc`,
    [ws, actor],
  );
  return (rows as Row[]).map((r) => ({
    ...noteFields(r),
    chars: Number(r.chars),
  }));
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
  r01_exploration: 'Exploration',
  r08_assessment: 'Assessment',
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
      subject_id: null,
      started_at: iso(r.started_at),
    });
  }
  const flows = await c.query(
    `select id, role, state, reason, run_id, subject_id, created_at from workflows
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
      // ADR-0103 (review L-2): the role, so the sidebar can open where that work shows.
      purpose: role.slice(0, 40),
      run_id: String(r.run_id),
      subject_id: String(r.subject_id),
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
      subject_id: null,
      started_at: iso(r.created_at),
    });
  // ADR-0088 (P24): qualifications the studio runs one after another, with how far it got.
  const queues = await c.query(
    `select q.id, q.model_id, q.created_at, q.lease_until > clock_timestamp() as leased,
       count(i.*) as total,
       count(i.*) filter (where i.state in ('qualified','failed','stopped','cancelled')) as ended,
       min(i.task_class) filter (where i.state = 'running') as now
     from plan_qualification_queues q
     join plan_connections pc on pc.id = q.connection_id
     join plan_qualification_queue_items i on i.queue_id = q.id
     where pc.workspace_id = $1 and q.state = 'running'
     group by q.id order by q.created_at desc limit $2`,
    [ws, ACTIVITY_NOW_MAX],
  );
  for (const r of queues.rows as Row[]) {
    const leased = Boolean(r.leased);
    items.push({
      kind: 'qualification_queue',
      id: String(r.id),
      label: 'Qualifying tasks one after another',
      detail: [
        String(r.model_id),
        `${Number(r.ended)} of ${Number(r.total)} done`,
        r.now ? `now ${words(String(r.now))}` : null,
      ]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 200),
      state: leased ? 'running' : 'waiting for the studio',
      active: leased,
      purpose: null,
      run_id: null,
      subject_id: null,
      started_at: iso(r.created_at),
    });
  }
  return items.sort((a, b) => b.started_at.localeCompare(a.started_at));
}
