import type { PoolClient } from 'pg';
import {
  ACTIVITY_NOW_MAX,
  type ActivityNowItem,
  type WorkspaceNote,
} from '@creator/contracts';
import { iso, type Row } from './store.js';

// ADR-0059 right-hand sidebar: the SQL behind the notepad and the "Running now" list. The store
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
    `select pr.id, pr.purpose, pr.model_id, pr.task_class, pr.run_id, pr.started_at
     from plan_requests pr join plan_connections pc on pc.id = pr.connection_id
     where pc.workspace_id = $1 and pr.state = 'in_flight'
     order by pr.started_at desc limit $2`,
    [ws, ACTIVITY_NOW_MAX],
  );
  for (const r of plan.rows as Row[]) {
    const purpose = String(r.purpose);
    items.push({
      kind: 'plan_request',
      id: String(r.id),
      label: PLAN_PURPOSE[purpose] ?? words(purpose),
      detail: [r.model_id, r.task_class ? words(String(r.task_class)) : null]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 200),
      state: 'waiting for the model',
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
    items.push({
      kind: 'workflow',
      id: String(r.id),
      label: WORKFLOW_ROLE[role] ?? words(role),
      // The reason often just repeats the state ("running"); show it only when it adds something.
      detail:
        String(r.reason ?? '') === String(r.state)
          ? ''
          : String(r.reason ?? '').slice(0, 200),
      state: words(String(r.state)),
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
      state: words(String(r.state)),
      purpose: null,
      run_id: null,
      started_at: iso(r.created_at),
    });
  return items.sort((a, b) => b.started_at.localeCompare(a.started_at));
}
