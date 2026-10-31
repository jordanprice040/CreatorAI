import type { PoolClient } from 'pg';
import {
  BUILD_APPROVAL_MAX_REPAIRS,
  BUILD_APPROVAL_MAX_REQUESTS,
  type BuildApproval,
  type BuildApprovalRequest,
  type DataClassSchema,
  type z,
} from '@creator/contracts';
import { iso, type Row } from './store.js';

/**
 * ADR-0054: one owner approval per build of a frozen spec. These helpers read the immutable
 * approval record and decide, inside the plan-request transaction, whether it still covers one
 * more builder or reviewer request.
 */
export function toBuildApproval(r: Row): BuildApproval {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    run_id: String(r.run_id),
    product_id: String(r.product_id),
    task_id: String(r.task_id),
    spec: { id: String(r.spec_id), version: Number(r.spec_version) },
    spec_hash: String(r.spec_hash),
    plan_hash: String(r.plan_hash),
    route: r.route as BuildApproval['route'],
    connection_id: r.connection_id === null ? null : String(r.connection_id),
    model_id: r.model_id === null ? null : String(r.model_id),
    data_class: r.data_class as BuildApproval['data_class'],
    humility_review: {
      id: String(r.humility_review_id),
      version: Number(r.humility_review_version),
    },
    request_limit: Number(r.request_limit),
    max_repairs: Number(r.max_repairs),
    admission_id: String(r.admission_id),
    grant_id: String(r.grant_id),
    grant_version: Number(r.grant_version),
    decision_id: r.decision_id === null ? null : String(r.decision_id),
    expires_at: iso(r.expires_at),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
  };
}

const ROUTE_LABEL: Record<BuildApprovalRequest['route'], string> = {
  broker: 'metered model broker',
  codex_plan: 'Codex on the ChatGPT plan',
  plan_roles: 'builder and reviewer on the ChatGPT plan',
};

/**
 * What approving covers, written by the studio (never the caller) and shown as the Approve
 * option's consequence. A pending decision for the same spec keeps the text of the build that
 * first asked, so the ceiling every build is held to is stated as well.
 */
export function buildApprovalScopeNote(r: BuildApprovalRequest): string {
  return (
    `One approval covers this whole build (${ROUTE_LABEL[r.route]}): its repair rounds and ` +
    `builder and reviewer requests, up to ${r.max_repairs} repair ` +
    `round${r.max_repairs === 1 ? '' : 's'} and ${r.request_limit} requests ` +
    `(never more than ${BUILD_APPROVAL_MAX_REPAIRS} and ${BUILD_APPROVAL_MAX_REQUESTS}).`
  );
}

/**
 * Why the approval of `build_id` does not cover one more plan build-role request now (empty:
 * covered). Runs in the plan-request transaction after the connection lock, so two requests of
 * one build cannot both take its last slot.
 */
export async function buildApprovalBlockers(
  c: PoolClient,
  ws: string,
  actorId: string,
  req: {
    build_id: string;
    run_id: string;
    model_id: string;
    data_class: z.infer<typeof DataClassSchema>;
  },
  connectionId: string,
  now: number,
): Promise<string[]> {
  const row = (
    await c.query(
      'select * from build_approvals where id = $1 and workspace_id = $2',
      [req.build_id, ws],
    )
  ).rows[0] as Row | undefined;
  if (!row)
    return [
      'This build has no recorded approval; start the build again so it asks once.',
    ];
  const a = toBuildApproval(row);
  const out: string[] = [];
  if (a.created_by !== actorId)
    out.push('Only the owner whose build was approved can send its requests.');
  if (a.run_id !== req.run_id)
    out.push('The request names a different run from the approved build.');
  if (
    a.route !== 'plan_roles' ||
    a.connection_id !== connectionId ||
    a.model_id !== req.model_id
  )
    out.push('The approved build uses a different route, connection or model.');
  if (a.data_class !== req.data_class)
    out.push(
      'The request names a different data class from the approved build.',
    );
  if (Date.parse(a.expires_at) <= now)
    out.push('The build approval ended at the build deadline.');
  const used = Number(
    (
      await c.query<{ n: string }>(
        'select count(*) as n from plan_requests where build_id = $1',
        [a.id],
      )
    ).rows[0]!.n,
  );
  if (used >= a.request_limit)
    out.push(
      `The build's approved request limit (${a.request_limit}) is reached.`,
    );
  // The authority behind it must still stand: a consumed one-time grant exactly as consumed,
  // or a standing grant unchanged, unrevoked and unexpired.
  const g = (
    await c.query('select * from grants where id = $1 and workspace_id = $2', [
      a.grant_id,
      ws,
    ])
  ).rows[0] as Row | undefined;
  const grantHolds =
    !!g &&
    (g.scope === 'once'
      ? g.status === 'consumed' && Number(g.version) === a.grant_version + 1
      : g.status === 'active' &&
        Number(g.version) === a.grant_version &&
        Date.parse(iso(g.expires_at)) > now);
  if (!grantHolds)
    out.push(
      'The grant behind this build approval was revoked, changed or has expired.',
    );
  const review = (
    await c.query(
      `select version, status from entities where workspace_id = $1 and id = $2
         and kind = 'humility_review'`,
      [ws, a.humility_review.id],
    )
  ).rows[0] as Row | undefined;
  if (
    !review ||
    Number(review.version) !== a.humility_review.version ||
    review.status !== 'active'
  )
    out.push(
      'The humility review behind this build changed or is no longer active.',
    );
  return out;
}
