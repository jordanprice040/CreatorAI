import type { PoolClient } from 'pg';
import {
  EvidenceSiteHostSchema,
  PAST_PROJECTS_MAX,
  PastProjectSchema,
  type PastProject,
  type PastProjectConnection,
} from '@creator/contracts';
import { iso, type Row } from './store.js';

/**
 * F9 "Start a similar project" (ADR-0125): the workspace's past discovery runs, newest first,
 * each with the setup a new project may start from. One entry per brief version (the newest
 * run that used it). Study runs are left out: their inputs belong to an experiment, not to a
 * project to repeat. A run whose brief was redacted, or whose recorded setup no longer reads
 * as the current contract, is skipped rather than guessed at. Claims, evidence roles,
 * decisions, approvals, grants and budgets are never read into the result. Nothing is written.
 */
export async function pastProjects(
  c: PoolClient,
  ws: string,
): Promise<PastProject[]> {
  const { rows } = await c.query(
    `select w.id, w.run_id, w.state, w.created_at, w.data_class, w.resource_setup,
            w.envelope_id,
            w.subject_id, w.subject_version,
            w.context->'perspectives' as perspectives,
            w.context->'excluded' as excluded,
            w.context->'max_revisions' as max_revisions,
            w.context->'packet'->'max_age_days' as max_age_days,
            v.title, v.body, r.autonomy_mode,
            (select a.payload->>'workflow_id' from audit_events a
              where a.workspace_id = w.workspace_id
                and a.action = 'exploration.brief_created'
                and a.subject_id = w.subject_id
              order by a.sequence desc limit 1) as exploration_id
       from workflows w
       join entity_versions v
         on v.workspace_id = w.workspace_id and v.entity_id = w.subject_id
        and v.version = w.subject_version
       left join run_controls r
         on r.workspace_id = w.workspace_id and r.run_id = w.run_id
      where w.workspace_id = $1 and w.role = 'r02_discovery' and v.body is not null
        and not exists (select 1 from study_attempts s
                         where s.workspace_id = w.workspace_id and s.run_id = w.run_id)
      order by w.created_at desc, w.id
      limit 200`,
    [ws],
  );
  const explorations = [
    ...new Set(
      rows
        .map((r: Row) => r.exploration_id)
        .filter((x): x is string => typeof x === 'string'),
    ),
  ];
  const scopes = new Map<string, Row>();
  if (explorations.length) {
    const found = await c.query(
      `select id, context->'packet'->'scope' as scope from workflows
        where workspace_id = $1 and role = 'r01_exploration'
          and id::text = any($2::text[])`,
      [ws, explorations],
    );
    for (const r of found.rows as Row[])
      if (r.scope && typeof r.scope === 'object')
        scopes.set(String(r.id), r.scope as Row);
  }
  const seen = new Set<string>();
  const out: PastProject[] = [];
  for (const r of rows as Row[]) {
    if (out.length >= PAST_PROJECTS_MAX) break;
    const key = `${String(r.subject_id)}:${Number(r.subject_version)}`;
    if (seen.has(key)) continue;
    const explorationId =
      typeof r.exploration_id === 'string' && scopes.has(r.exploration_id)
        ? r.exploration_id
        : null;
    const scope = explorationId ? scopes.get(explorationId) : undefined;
    const parsed = PastProjectSchema.safeParse({
      workflow_id: String(r.id),
      run_id: String(r.run_id),
      state: r.state,
      started_at: iso(r.created_at),
      brief: {
        id: String(r.subject_id),
        version: Number(r.subject_version),
        title: String(r.title),
        body: r.body,
      },
      settings: {
        perspectives: r.perspectives,
        excluded: r.excluded ?? [],
        max_revisions: r.max_revisions,
        max_age_days: r.max_age_days,
        data_class: r.data_class,
        oversight: r.autonomy_mode ?? null,
      },
      sites: {
        exploration_id: explorationId,
        only_hosts: hostsOf(scope?.only_hosts),
        excluded_hosts: hostsOf(scope?.excluded_hosts),
      },
      connection: connectionOf(r.resource_setup, r.envelope_id),
    });
    if (!parsed.success) continue;
    seen.add(key);
    out.push(parsed.data);
  }
  return out;
}

/** Well-formed website names only; anything else in an older scope is dropped. */
function hostsOf(v: unknown): string[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((h) => EvidenceSiteHostSchema.safeParse(h).success)
    .slice(0, 20) as string[];
}

/** The route only: never the budget, price list or settings hash a past run held. */
function connectionOf(
  v: unknown,
  envelope: unknown,
): PastProjectConnection | null {
  // A run from before typed resource setups held a budget and price list: it was metered.
  if (!v || typeof v !== 'object') return envelope ? { kind: 'api' } : null;
  const s = v as Row;
  if (s.kind === 'api') return { kind: 'api' };
  if (s.kind === 'subscription')
    return {
      kind: 'subscription',
      connection_id: String(s.connection_id),
      model_id: String(s.model_id),
    };
  if (s.kind === 'local')
    return { kind: 'local', model_id: String(s.model_id) };
  return null;
}
