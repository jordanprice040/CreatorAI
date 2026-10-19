import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  canonicalHash,
  type DeploymentEnvironment,
  type Retention,
} from '@creator/domain';
import { fail, iso, Store, type CommandContext, type Row } from './store.js';

/** System actor for operations run from the command line (X06). */
export const OPERATIONS_ACTOR_ID = '00000000-0000-4000-8000-000000000006';
const NIL = '00000000-0000-0000-0000-000000000000';

export type DeploymentIdentity = {
  environment: DeploymentEnvironment;
  claimed_at: string;
  version: number;
};
export type DeploymentVerification = {
  id: string;
  environment: DeploymentEnvironment;
  build_commit: string;
  config_hash: string;
  schema_version: number;
  result: 'passed' | 'failed';
  checks: unknown;
  smoke_report_sha256: string;
  confirmation: string | null;
  recorded_by: string;
  created_at: string;
};
export type LocalWorkerAvailability =
  'online' | 'unreachable' | 'paused' | 'shutdown' | 'revoked' | 'expired';
export type OpsMetrics = {
  observed_at: string;
  queue: {
    workflows_live: Record<string, number>;
    tasks_open: Record<string, number>;
    oldest_queued_task_seconds: number | null;
    outbox_pending: number;
    outbox_oldest_pending_seconds: number | null;
  };
  workers: {
    workflow_leases_active: number;
    workflow_leases_expired: number;
    local: Record<LocalWorkerAvailability, number>;
    local_last_seen: {
      id: string;
      label: string;
      availability: LocalWorkerAvailability;
      last_seen_at: string | null;
    }[];
    local_jobs_open: number;
  };
  budget: {
    envelopes_active: number;
    envelopes_overrun: number;
    reserved_nano: string;
    unknown_nano: string;
    incurred_nano: string;
    reservations_in_flight: number;
    reservations_unknown: number;
  };
  index: {
    context_entries_current: number;
    context_newest_indexed_seconds: number | null;
    saved_queries: number;
  };
  webhooks: {
    accepted_24h: number;
    rejected_signature_24h: number;
    last_received_seconds: number | null;
  };
  uncertain: Record<string, number>;
};
export type UncertainAction = {
  subsystem: string;
  id: string;
  workspace_id: string | null;
  state: string;
  since: string;
  runbook: string;
};

// Each subsystem's "outcome not known" states, with the runbook section that resolves them.
const UNCERTAIN: { key: string; runbook: string; sql: string }[] = [
  {
    key: 'budget_reservations_unknown',
    runbook: 'model-call-unknown',
    sql: `select 'budget_reservation' as subsystem, id, workspace_id, status as state,
      coalesce(finished_at, created_at) as since from budget_reservations where status = 'unknown'`,
  },
  {
    key: 'workflows_reconciling',
    runbook: 'workflow-reconciling',
    sql: `select 'workflow' as subsystem, id, workspace_id, state, updated_at as since
      from workflows where state = 'reconciling'`,
  },
  {
    key: 'workflow_tasks_reconciling',
    runbook: 'workflow-reconciling',
    sql: `select 'workflow_task' as subsystem, id, workspace_id, state, updated_at as since
      from workflow_tasks where state = 'reconciling'`,
  },
  {
    key: 'github_operations_unknown',
    runbook: 'github-unknown',
    sql: `select 'github_operation' as subsystem, id, workspace_id, state, updated_at as since
      from github_operations where state in ('unknown', 'dispatched')`,
  },
  {
    key: 'context_batches_unknown',
    runbook: 'batch-unknown',
    sql: `select 'context_batch' as subsystem, id, workspace_id, status as state, updated_at as since
      from context_batches where status in ('unknown', 'submitting')`,
  },
  {
    key: 'local_jobs_reconciling',
    runbook: 'local-job-reconciling',
    sql: `select 'local_job' as subsystem, id, workspace_id, state, created_at as since
      from desktop_jobs where state = 'reconciling'`,
  },
];

const seconds = (v: unknown) =>
  v === null || v === undefined ? null : Math.max(0, Math.round(Number(v)));
const byKey = (rows: Row[], k = 'k') =>
  Object.fromEntries(rows.map((r) => [String(r[k]), Number(r.n)]));

function verification(r: Row): DeploymentVerification {
  return {
    id: String(r.id),
    environment: r.environment as DeploymentEnvironment,
    build_commit: String(r.build_commit),
    config_hash: String(r.config_hash),
    schema_version: Number(r.schema_version),
    result: r.result as 'passed' | 'failed',
    checks: r.checks,
    smoke_report_sha256: String(r.smoke_report_sha256),
    confirmation: (r.confirmation as string | null) ?? null,
    recorded_by: String(r.recorded_by),
    created_at: iso(r.created_at),
  };
}

/**
 * X06 operations: environment identity, read-only metrics and uncertain-action listing,
 * bounded cleanup of expired sign-in material, and owner-recorded verifications. Every
 * change appends a hash-chained audit event (workspace-less, like grant policy events).
 */
export class OpsStore extends Store {
  constructor(pool: Pool) {
    super(pool);
  }

  async ensureOperationsActor() {
    await this.ensureActor({
      id: OPERATIONS_ACTOR_ID,
      kind: 'system',
      display_name: 'Operations',
    });
  }

  async identity(): Promise<DeploymentIdentity | null> {
    const { rows } = await this.pool.query('select * from deployment_identity');
    const r = rows[0] as Row | undefined;
    return r
      ? {
          environment: r.environment as DeploymentEnvironment,
          claimed_at: iso(r.claimed_at),
          version: Number(r.version),
        }
      : null;
  }

  /**
   * Binds an unlabelled database to this environment, or refuses when it already belongs
   * to another one. Called at API and worker startup and by `pnpm ops claim-environment`.
   */
  async claimEnvironment(
    ctx: CommandContext,
    environment: DeploymentEnvironment,
  ): Promise<DeploymentIdentity & { claimed_now: boolean }> {
    return this.tx(async (c) => {
      await c.query('lock table deployment_identity in exclusive mode');
      const { rows } = await c.query('select * from deployment_identity');
      const r = rows[0] as Row | undefined;
      if (r) {
        if (r.environment !== environment)
          throw fail(
            'INVALID_CONFIG',
            `This database belongs to the ${String(r.environment)} environment; this process is configured for ${environment}. Point it at the ${environment} database, or relabel a restored copy with pnpm ops claim-environment.`,
          );
        return {
          environment,
          claimed_at: iso(r.claimed_at),
          version: Number(r.version),
          claimed_now: false,
        };
      }
      const ins = await c.query(
        'insert into deployment_identity (environment) values ($1) returning *',
        [environment],
      );
      await this.audit(c, ctx, 'deployment.environment_claimed', {
        environment,
      });
      const row = ins.rows[0] as Row;
      return {
        environment,
        claimed_at: iso(row.claimed_at),
        version: 1,
        claimed_now: true,
      };
    });
  }

  /**
   * Relabels a restored copy (for example a live backup restored for a staging drill).
   * Promoting anything into live this way is refused: a live database is claimed only by a
   * live process starting against an empty or live-labelled database.
   */
  async relabelEnvironment(
    ctx: CommandContext,
    from: DeploymentEnvironment,
    to: DeploymentEnvironment,
  ): Promise<DeploymentIdentity> {
    if (to === 'live')
      throw fail(
        'SCOPE_EXCEEDED',
        'Relabelling a database as live is refused; restore a live backup into the live environment instead.',
      );
    return this.tx(async (c) => {
      await c.query('lock table deployment_identity in exclusive mode');
      const { rows } = await c.query('select * from deployment_identity');
      const r = rows[0] as Row | undefined;
      if (!r || r.environment !== from)
        throw fail(
          'VERSION_CONFLICT',
          `This database is labelled ${r ? String(r.environment) : 'with no environment'}, not ${from}.`,
        );
      const up = await c.query(
        `update deployment_identity set environment = $1, version = version + 1 returning *`,
        [to],
      );
      await this.audit(c, ctx, 'deployment.environment_relabelled', {
        from,
        to,
      });
      const row = up.rows[0] as Row;
      return {
        environment: to,
        claimed_at: iso(row.claimed_at),
        version: Number(row.version),
      };
    });
  }

  private async audit(
    c: PoolClient,
    ctx: CommandContext,
    action: string,
    payload: Record<string, unknown>,
    subjectId = NIL,
  ) {
    return this.append(c, ctx, {
      workspaceId: null,
      action,
      subjectKind: 'deployment',
      subjectId,
      subjectVersion: null,
      contentHash: canonicalHash(payload),
      payload,
    });
  }

  /** Read-only operating metrics; every query is an aggregate over existing tables. */
  async metrics(): Promise<OpsMetrics> {
    const q = async (sql: string) => (await this.pool.query(sql)).rows as Row[];
    const [
      clock,
      workflows,
      tasks,
      queued,
      outbox,
      leases,
      local,
      localJobs,
      budget,
      reservations,
      index,
      saved,
      hooks,
    ] = await Promise.all([
      q(`select clock_timestamp() as now`),
      q(
        `select state as k, count(*)::int as n from workflows where finished_at is null group by state`,
      ),
      q(
        `select state as k, count(*)::int as n from workflow_tasks where finished_at is null group by state`,
      ),
      q(
        `select extract(epoch from clock_timestamp() - min(updated_at)) as s from workflow_tasks where state = 'queued'`,
      ),
      q(`select count(*)::int as n, extract(epoch from clock_timestamp() - min(created_at)) as s
         from outbox where delivered_at is null`),
      q(`select count(*) filter (where lease_expires_at >= clock_timestamp())::int as active,
                count(*) filter (where lease_expires_at < clock_timestamp())::int as expired
         from workflow_tasks where state = 'leased'`),
      q(`select id, label, last_seen_at,
           case when state = 'revoked' then 'revoked'
                when expires_at < clock_timestamp() then 'expired'
                when state = 'shutdown' then 'shutdown'
                when state = 'paused' then 'paused'
                when lease_expires_at >= clock_timestamp() then 'online'
                else 'unreachable' end as availability
         from desktop_devices where kind = 'worker' order by created_at desc limit 50`),
      q(
        `select count(*)::int as n from desktop_jobs where state in ('queued','leased','running','reconciling')`,
      ),
      q(`select count(*) filter (where kind = 'global' and status = 'active')::int as active,
                count(*) filter (where status = 'overrun')::int as overrun,
                coalesce(sum(reserved_nano), 0)::text as reserved,
                coalesce(sum(unknown_nano), 0)::text as unknown,
                coalesce(sum(incurred_nano), 0)::text as incurred
         from budget_envelopes`),
      q(`select count(*) filter (where status = 'in_flight')::int as in_flight,
                count(*) filter (where status = 'unknown')::int as unknown
         from budget_reservations`),
      q(`select count(*)::int as n, extract(epoch from clock_timestamp() - max(indexed_at)) as s
         from context_index_entries where status = 'current'`),
      q(`select count(*)::int as n from saved_queries`),
      q(`select count(*) filter (where status = 'accepted' and received_at > clock_timestamp() - interval '24 hours')::int as ok,
                count(*) filter (where status = 'rejected_signature' and received_at > clock_timestamp() - interval '24 hours')::int as bad,
                extract(epoch from clock_timestamp() - max(received_at)) as s
         from github_webhook_deliveries`),
    ]);
    const counts: Record<string, number> = {};
    for (const u of UNCERTAIN) {
      const { rows } = await this.pool.query<{ n: number }>(
        `select count(*)::int as n from (${u.sql}) u`,
      );
      counts[u.key] = rows[0]!.n;
    }
    const availability: Record<LocalWorkerAvailability, number> = {
      online: 0,
      unreachable: 0,
      paused: 0,
      shutdown: 0,
      revoked: 0,
      expired: 0,
    };
    for (const d of local)
      availability[d.availability as LocalWorkerAvailability]++;
    const b = budget[0]!;
    return {
      observed_at: iso(clock[0]!.now),
      queue: {
        workflows_live: byKey(workflows),
        tasks_open: byKey(tasks),
        oldest_queued_task_seconds: seconds(queued[0]?.s),
        outbox_pending: Number(outbox[0]!.n),
        outbox_oldest_pending_seconds: seconds(outbox[0]!.s),
      },
      workers: {
        workflow_leases_active: Number(leases[0]!.active),
        workflow_leases_expired: Number(leases[0]!.expired),
        local: availability,
        local_last_seen: local.map((d) => ({
          id: String(d.id),
          label: String(d.label),
          availability: d.availability as LocalWorkerAvailability,
          last_seen_at: d.last_seen_at === null ? null : iso(d.last_seen_at),
        })),
        local_jobs_open: Number(localJobs[0]!.n),
      },
      // Money is recorded only on the envelope charged, not rolled into its parents.
      // Sum every level once; parent allocations are excluded from these totals.
      budget: {
        envelopes_active: Number(b.active),
        envelopes_overrun: Number(b.overrun),
        reserved_nano: String(b.reserved),
        unknown_nano: String(b.unknown),
        incurred_nano: String(b.incurred),
        reservations_in_flight: Number(reservations[0]!.in_flight),
        reservations_unknown: Number(reservations[0]!.unknown),
      },
      index: {
        context_entries_current: Number(index[0]!.n),
        context_newest_indexed_seconds: seconds(index[0]!.s),
        saved_queries: Number(saved[0]!.n),
      },
      webhooks: {
        accepted_24h: Number(hooks[0]!.ok),
        rejected_signature_24h: Number(hooks[0]!.bad),
        last_received_seconds: seconds(hooks[0]!.s),
      },
      uncertain: counts,
    };
  }

  /** Every action whose outcome is not known, oldest first, with the runbook that resolves it. */
  async uncertainActions(limit = 200): Promise<UncertainAction[]> {
    const { rows } = await this.pool.query(
      `select * from (${UNCERTAIN.map(
        (u) =>
          `select subsystem, id::text, workspace_id::text, state, since, '${u.runbook}' as runbook from (${u.sql}) x`,
      ).join(' union all ')}) u order by since, id limit $1`,
      [Math.min(Math.max(1, limit), 200)],
    );
    return (rows as Row[]).map((r) => ({
      subsystem: String(r.subsystem),
      id: String(r.id),
      workspace_id: (r.workspace_id as string | null) ?? null,
      state: String(r.state),
      since: iso(r.since),
      runbook: `docs/HOSTED_OPERATION.md#${String(r.runbook)}`,
    }));
  }

  /**
   * Removes expired sign-in material past its retention: sessions, OIDC login states and
   * pairing challenges. Records, audit history, budgets and artifacts are never touched.
   * Dry run by default; an applied run is audited with its counts.
   */
  async cleanup(
    ctx: CommandContext,
    retention: Retention,
    apply: boolean,
  ): Promise<{ applied: boolean; removed: Record<string, number> }> {
    const targets = [
      {
        table: 'auth_sessions',
        where: `coalesce(revoked_at, expires_at) < clock_timestamp() - make_interval(days => $1)
          and not exists (select 1 from desktop_devices d where d.session_hash = auth_sessions.token_hash)
          and not exists (select 1 from desktop_challenges h where h.approval_session_hash = auth_sessions.token_hash)`,
        days: retention.auth_sessions_days,
      },
      {
        table: 'oidc_logins',
        where: `expires_at < clock_timestamp() - make_interval(days => $1)`,
        days: retention.oidc_logins_days,
      },
      {
        table: 'desktop_challenges',
        where: `expires_at < clock_timestamp() - make_interval(days => $1)`,
        days: retention.desktop_challenges_days,
      },
    ];
    return this.tx(async (c) => {
      const removed: Record<string, number> = {};
      // Challenges first: an old challenge may be what keeps an old session referenced.
      for (const t of [targets[2]!, targets[1]!, targets[0]!]) {
        const r = await c.query(
          apply
            ? `delete from ${t.table} where ${t.where}`
            : `select 1 from ${t.table} where ${t.where}`,
          [t.days],
        );
        removed[t.table] = r.rowCount ?? 0;
      }
      if (apply)
        await this.audit(c, ctx, 'operations.cleanup', {
          retention_version: retention.version,
          removed,
        });
      return { applied: apply, removed };
    });
  }

  async recordVerification(
    ctx: CommandContext,
    v: Omit<DeploymentVerification, 'id' | 'created_at' | 'recorded_by'>,
  ): Promise<DeploymentVerification> {
    return this.tx(async (c) => {
      const id = randomUUID();
      const event = await this.audit(
        c,
        ctx,
        'deployment.verification_recorded',
        {
          environment: v.environment,
          build_commit: v.build_commit,
          config_hash: v.config_hash,
          schema_version: v.schema_version,
          result: v.result,
          smoke_report_sha256: v.smoke_report_sha256,
        },
        id,
      );
      const { rows } = await c.query(
        `insert into deployment_verifications (id, environment, build_commit, config_hash,
           schema_version, result, checks, smoke_report_sha256, confirmation, recorded_by,
           audit_event_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
        [
          id,
          v.environment,
          v.build_commit,
          v.config_hash,
          v.schema_version,
          v.result,
          JSON.stringify(v.checks),
          v.smoke_report_sha256,
          v.confirmation,
          ctx.actorId,
          event,
        ],
      );
      return verification(rows[0] as Row);
    });
  }

  async latestVerification(
    environment: DeploymentEnvironment,
  ): Promise<DeploymentVerification | null> {
    const { rows } = await this.pool.query(
      `select * from deployment_verifications where environment = $1
       order by created_at desc, id limit 1`,
      [environment],
    );
    return rows[0] ? verification(rows[0] as Row) : null;
  }
}

/** Flattens metrics to the numbers alert rules and the Prometheus endpoint use. */
export function flatMetrics(m: OpsMetrics): Record<string, number | null> {
  const out: Record<string, number | null> = {
    outbox_pending: m.queue.outbox_pending,
    outbox_oldest_pending_seconds: m.queue.outbox_oldest_pending_seconds,
    oldest_queued_task_seconds: m.queue.oldest_queued_task_seconds,
    workflow_leases_active: m.workers.workflow_leases_active,
    workflow_leases_expired: m.workers.workflow_leases_expired,
    local_jobs_open: m.workers.local_jobs_open,
    budget_envelopes_overrun: m.budget.envelopes_overrun,
    budget_reservations_in_flight: m.budget.reservations_in_flight,
    budget_reservations_unknown: m.budget.reservations_unknown,
    // Nano-dollars as a float are for graphs only; exact values are in the JSON status.
    budget_unknown_nano: Number(m.budget.unknown_nano),
    budget_incurred_nano: Number(m.budget.incurred_nano),
    context_entries_current: m.index.context_entries_current,
    context_newest_indexed_seconds: m.index.context_newest_indexed_seconds,
    saved_queries: m.index.saved_queries,
    webhooks_accepted_24h: m.webhooks.accepted_24h,
    webhooks_rejected_signature_24h: m.webhooks.rejected_signature_24h,
    uncertain_actions: Object.values(m.uncertain).reduce((a, b) => a + b, 0),
  };
  for (const [k, n] of Object.entries(m.workers.local))
    out[`local_workers_${k}`] = n;
  for (const [k, n] of Object.entries(m.queue.workflows_live))
    out[`workflows_${k}`] = n;
  for (const [k, n] of Object.entries(m.uncertain)) out[k] = n;
  return out;
}

/** Prometheus text exposition (0.0.4) of the flat metrics. */
export function prometheusText(
  flat: Record<string, number | null>,
  labels: { environment: string },
): string {
  const env = labels.environment.replace(/[^a-z]/g, '');
  return (
    Object.entries(flat)
      .filter(([, v]) => v !== null && Number.isFinite(v))
      .map(
        ([k, v]) =>
          `# TYPE creator_${k} gauge\ncreator_${k}{environment="${env}"} ${v}`,
      )
      .join('\n') + '\n'
  );
}
