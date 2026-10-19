import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  DesktopJobRequestSchema,
  DesktopJobSchema,
  DesktopJobLeaseSchema,
  DesktopJobStartSchema,
  DesktopJobFinishSchema,
  parse,
  type DesktopJob,
} from '@creator/contracts';
import { canonicalHash } from '@creator/domain';
import { DesktopStore } from './desktop-store.js';
import { fail, iso, uuid, type CommandContext, type Row } from './store.js';
import { ORCHESTRATOR_ACTOR_ID } from './workflow-store.js';

const secretHash = (s: string) => createHash('sha256').update(s).digest('hex');
const limits = {
  runtime_ms: 20000,
  memory_bytes: 268435456,
  network: 'none',
  max_attempts: 1,
  local_compute_billing: 'not_metered_by_studio',
} as const;

function job(r: Row): DesktopJob {
  return parse(DesktopJobSchema, {
    ...Object.fromEntries(
      [
        'id',
        'device_id',
        'workspace_id',
        'owner_id',
        'request_id',
        'artifact_id',
        'product_id',
        'manifest_sha256',
        'archive_sha256',
        'input',
        'state',
        'fence',
        'lease_id',
        'execution_id',
        'reconciled_outcome_hash',
        'cancel_requested',
      ].map((k) => [k, r[k]]),
    ),
    lease_expires_at: r.lease_expires_at ? iso(r.lease_expires_at) : null,
    created_at: iso(r.created_at),
    expires_at: iso(r.expires_at),
    report: r.report ?? null,
    verification: 'worker_report_only',
    limits,
  });
}

export class DesktopJobStore extends DesktopStore {
  protected override async desktopControlChanged(
    c: PoolClient,
    deviceId: string,
    state: string,
  ) {
    if (state === 'active') return;
    await c.query(
      `update desktop_jobs set cancel_requested=true,
      state=case when state in ('queued','leased') then 'cancelled' else state end
      where device_id=$1 and state in ('queued','leased','running')`,
      [deviceId],
    );
  }
  private async expireJobs(c: PoolClient) {
    // An expired dispatched job is never requeued; its actual outcome needs reconciliation.
    const expired =
      await c.query(`update desktop_jobs set state=case when state='running' then 'reconciling' else 'expired' end,
      cancel_requested=true where (state='queued' and expires_at<=clock_timestamp()) or
      (state in ('leased','running') and (lease_expires_at<=clock_timestamp() or expires_at<=clock_timestamp())) returning *`);
    if (expired.rows.length) {
      await c.query(
        `insert into actors(id,kind,display_name) values($1,'system','Workflow orchestrator') on conflict(id) do nothing`,
        [ORCHESTRATOR_ACTOR_ID],
      );
      for (const row of expired.rows)
        await this.auditJob(
          c,
          row as Row,
          'desktop.job_expired',
          { state: row.state, reason: 'expired_no_retry' },
          ORCHESTRATOR_ACTOR_ID,
        );
    }
  }
  private async worker(c: PoolClient, token: string, allowStopped = false) {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token))
      throw fail('UNAUTHENTICATED', 'Worker credential required.');
    const d = await c.query(
      `select * from desktop_devices where token_hash=$1 and kind='worker' for update`,
      [secretHash(token)],
    );
    const row = d.rows[0] as Row | undefined;
    if (!row) throw fail('UNAUTHENTICATED', 'Worker identity not found.');
    if (
      !allowStopped &&
      (row.state !== 'active' || Date.parse(iso(row.expires_at)) <= Date.now())
    )
      throw fail('ACCESS_DENIED', 'Worker is not active.');
    return row;
  }
  private async jobRow(c: PoolClient, jobId: string) {
    const r = await c.query(
      `select j.*, r.report from desktop_jobs j left join desktop_job_reports r on r.job_id=j.id where j.id=$1 for update of j`,
      [uuid(jobId)],
    );
    if (!r.rows[0]) throw fail('NOT_FOUND', 'Paired job not found.');
    return r.rows[0] as Row;
  }
  private async auditJob(
    c: PoolClient,
    row: Row,
    action: string,
    payload: Record<string, unknown> = {},
    actorId = String(row.owner_id),
  ) {
    await this.append(
      c,
      { actorId },
      {
        workspaceId: String(row.workspace_id),
        action,
        subjectKind: 'desktop_job',
        subjectId: String(row.id),
        subjectVersion: null,
        contentHash: String(row.manifest_sha256),
        payload: {
          device_id: row.device_id,
          artifact_id: row.artifact_id,
          authorized_by: row.owner_id,
          ...payload,
        },
      },
    );
  }
  async queueDesktopJob(ctx: CommandContext, deviceId: string, input: unknown) {
    const v = parse(DesktopJobRequestSchema, input);
    return this.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock(4310017)');
      const d = await c.query(
        `select * from desktop_devices where id=$1 and owner_id=$2 for update`,
        [uuid(deviceId), ctx.actorId],
      );
      const device = d.rows[0] as Row | undefined;
      if (!device || !device.workspace_id)
        throw fail('NOT_FOUND', 'Worker not found.');
      await this.requireOwner(c, String(device.workspace_id), ctx.actorId);
      const existing = await c.query(
        `select j.*, r.report from desktop_jobs j left join desktop_job_reports r on r.job_id=j.id where device_id=$1 and request_id=$2`,
        [deviceId, v.request_id],
      );
      if (existing.rows[0]) {
        if (existing.rows[0].request_hash !== canonicalHash(v))
          throw fail('IDEMPOTENCY_CONFLICT', 'Job request changed.');
        return job(existing.rows[0] as Row);
      }
      if (
        device.kind !== 'worker' ||
        device.state !== 'active' ||
        Date.parse(iso(device.expires_at)) <= Date.now() ||
        !(device.capabilities as string[]).includes('artifact.run')
      )
        throw fail(
          'ACCESS_DENIED',
          'Pair an active execution-capable worker first.',
        );
      await this.expireJobs(c);
      const active = await c.query(
        `select count(*)::int n, count(*) filter(where workspace_id=$1)::int scoped from desktop_jobs where state in ('queued','leased','running','reconciling')`,
        [device.workspace_id],
      );
      if (Number(active.rows[0]?.n) >= 3 || Number(active.rows[0]?.scoped) >= 1)
        throw fail(
          'LIMIT_EXCEEDED',
          'A prior paired job is active or needs reconciliation.',
        );
      const rate = await c.query(
        `select count(*)::int n from desktop_jobs where created_at>clock_timestamp()-interval '1 hour'`,
      );
      if (Number(rate.rows[0]?.n) >= 20)
        throw fail(
          'LIMIT_EXCEEDED',
          'Local paired jobs are capped at 20 per hour.',
        );
      const artifact = await this.artifact(
        c,
        String(device.workspace_id),
        v.artifact_id,
      );
      if (artifact.summary.manifest_sha256 !== v.manifest_sha256)
        throw fail('EVIDENCE_MISMATCH', 'Artifact manifest changed.');
      if (
        artifact.manifest.state !== 'verified' ||
        artifact.manifest.availability.runnable_demo.state !== 'available'
      )
        throw fail('INVALID_TRANSITION', 'Artifact is not runnable.');
      const r = await c.query(
        `insert into desktop_jobs(id,device_id,workspace_id,owner_id,request_id,request_hash,artifact_id,product_id,manifest_sha256,archive_sha256,input,fence)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) returning *`,
        [
          randomUUID(),
          deviceId,
          device.workspace_id,
          ctx.actorId,
          v.request_id,
          canonicalHash(v),
          v.artifact_id,
          artifact.manifest.product_id,
          v.manifest_sha256,
          artifact.manifest.package.sha256,
          JSON.stringify(v.input),
          device.fence,
        ],
      );
      await this.auditJob(c, r.rows[0] as Row, 'desktop.job_queued', {
        limits,
        local_compute_cost: 'unknown_not_zero',
      });
      return job(r.rows[0] as Row);
    });
  }
  async listDesktopJobs(ctx: CommandContext, deviceId: string) {
    return this.tx(async (c) => {
      const d = await c.query(
        `select * from desktop_devices where id=$1 and owner_id=$2`,
        [uuid(deviceId), ctx.actorId],
      );
      if (!d.rows[0]) throw fail('NOT_FOUND', 'Worker not found.');
      if (d.rows[0].workspace_id)
        await this.requireOwner(c, String(d.rows[0].workspace_id), ctx.actorId);
      await this.expireJobs(c);
      const r = await c.query(
        `select j.*, r.report from desktop_jobs j left join desktop_job_reports r on r.job_id=j.id where device_id=$1 order by created_at desc limit 50`,
        [deviceId],
      );
      return r.rows.map((r) => job(r as Row));
    });
  }
  async leaseDesktopJob(token: string) {
    return this.tx(async (c) => {
      const device = await this.worker(c, token);
      await this.requireOwner(
        c,
        String(device.workspace_id),
        String(device.owner_id),
      );
      if (!(device.capabilities as string[]).includes('artifact.run'))
        throw fail(
          'ACCESS_DENIED',
          'Presence capability does not authorize execution.',
        );
      await this.expireJobs(c);
      const r = await c.query(
        `select * from desktop_jobs where device_id=$1 and state='queued' order by created_at limit 1 for update`,
        [device.id],
      );
      const row = r.rows[0] as Row | undefined;
      if (!row) return null;
      if (row.fence !== device.fence) {
        await c.query(
          `update desktop_jobs set state='cancelled',cancel_requested=true where id=$1`,
          [row.id],
        );
        return null;
      }
      const leased = await c.query(
        `update desktop_jobs set state='leased',lease_id=$2,lease_expires_at=clock_timestamp()+interval '10 seconds' where id=$1 returning *`,
        [row.id, randomUUID()],
      );
      await this.auditJob(
        c,
        leased.rows[0] as Row,
        'desktop.job_leased',
        {},
        String(device.id),
      );
      return job(leased.rows[0] as Row);
    });
  }
  async desktopJobForOwner(ctx: CommandContext, jobId: string) {
    return this.tx(async (c) => {
      const row = await this.jobRow(c, jobId);
      await this.requireOwner(c, String(row.workspace_id), ctx.actorId);
      if (row.owner_id !== ctx.actorId)
        throw fail('NOT_FOUND', 'Job not found.');
      return job(row);
    });
  }
  async cancelDesktopJob(ctx: CommandContext, jobId: string) {
    return this.tx(async (c) => {
      const row = await this.jobRow(c, jobId);
      await this.requireOwner(c, String(row.workspace_id), ctx.actorId);
      if (row.owner_id !== ctx.actorId)
        throw fail('NOT_FOUND', 'Job not found.');
      if (
        !['queued', 'leased', 'running', 'reconciling'].includes(
          String(row.state),
        ) ||
        row.cancel_requested
      )
        return job(row);
      const r = await c.query(
        `update desktop_jobs set cancel_requested=true,
        state=case when state in ('queued','leased') then 'cancelled' else state end where id=$1 returning *`,
        [jobId],
      );
      await this.auditJob(c, row, 'desktop.job_cancel_requested');
      return job({ ...r.rows[0], report: row.report } as Row);
    });
  }
  async reconcileDesktopJob(
    ctx: CommandContext,
    jobId: string,
    executionId: string,
    outcomeHash: string,
  ) {
    return this.tx(async (c) => {
      const row = await this.jobRow(c, jobId);
      await this.requireOwner(c, String(row.workspace_id), ctx.actorId);
      if (row.owner_id !== ctx.actorId || row.execution_id !== executionId)
        throw fail('NOT_FOUND', 'Job execution not found.');
      if (row.reconciled_outcome_hash === outcomeHash) return job(row);
      if (row.state !== 'reconciling')
        throw fail(
          'INVALID_TRANSITION',
          'Only an uncertain job can be reconciled.',
        );
      const r = await c.query(
        `update desktop_jobs set state='cancelled',cancel_requested=true,reconciled_outcome_hash=$2,lease_expires_at=null where id=$1 returning *`,
        [jobId, outcomeHash],
      );
      await this.auditJob(c, row, 'desktop.job_reconciled_stopped', {
        execution_id: executionId,
        local_outcome_hash: outcomeHash,
        redispatched: false,
      });
      return job({ ...r.rows[0], report: row.report } as Row);
    });
  }
  private async validLease(c: PoolClient, row: Row, device: Row) {
    if (
      device.state !== 'active' ||
      row.cancel_requested ||
      row.fence !== device.fence ||
      Date.parse(iso(device.expires_at)) <= Date.now() ||
      Date.parse(iso(row.expires_at)) <= Date.now() ||
      !row.lease_expires_at ||
      Date.parse(iso(row.lease_expires_at)) <= Date.now()
    )
      return false;
    try {
      await this.requireOwner(
        c,
        String(device.workspace_id),
        String(device.owner_id),
      );
    } catch {
      return false;
    }
    return (device.capabilities as string[]).includes('artifact.run');
  }
  async checkDesktopJob(
    token: string,
    jobId: string,
    input: unknown,
    start = false,
  ) {
    const request = start
      ? parse(DesktopJobStartSchema, input)
      : parse(DesktopJobLeaseSchema, input);
    const { lease_id } = request;
    return this.tx(async (c) => {
      const device = await this.worker(c, token, true);
      const row = await this.jobRow(c, jobId);
      if (row.device_id !== device.id || row.lease_id !== lease_id)
        throw fail('ACCESS_DENIED', 'Job lease identity mismatch.');
      const valid = await this.validLease(c, row, device);
      if (start) {
        if (!valid || row.state !== 'leased')
          throw fail('LEASE_LOST', 'Job cannot start or was already started.');
        const a = await this.artifact(
          c,
          String(row.workspace_id),
          String(row.artifact_id),
        );
        if (
          a.summary.manifest_sha256 !== row.manifest_sha256 ||
          a.manifest.state !== 'verified' ||
          a.manifest.availability.runnable_demo.state !== 'available'
        )
          throw fail('EVIDENCE_MISMATCH', 'Artifact is no longer runnable.');
        await c.query(
          `update desktop_jobs set state='running', execution_id=$2, lease_expires_at=least(expires_at,clock_timestamp()+interval '10 seconds') where id=$1`,
          [jobId, 'execution_id' in request ? request.execution_id : null],
        );
        await this.auditJob(
          c,
          row,
          'desktop.job_started',
          {},
          String(device.id),
        );
        return { continue: true };
      }
      if (!valid || row.state !== 'running') {
        if (row.state === 'running')
          await c.query(
            `update desktop_jobs set cancel_requested=true where id=$1`,
            [jobId],
          );
        return { continue: false };
      }
      await c.query(
        `update desktop_jobs set lease_expires_at=least(expires_at,clock_timestamp()+interval '10 seconds') where id=$1`,
        [jobId],
      );
      return { continue: true };
    });
  }
  async finishDesktopJob(token: string, jobId: string, input: unknown) {
    const v = parse(DesktopJobFinishSchema, input);
    return this.tx(async (c) => {
      // A revoked identity may submit only its already-issued lease's bounded final observation.
      const device = await this.worker(c, token, true);
      const row = await this.jobRow(c, jobId);
      if (row.device_id !== device.id || row.lease_id !== v.lease_id)
        throw fail('ACCESS_DENIED', 'Job lease identity mismatch.');
      if (row.report) {
        if (canonicalHash(row.report) !== canonicalHash(v.report))
          throw fail('IDEMPOTENCY_CONFLICT', 'Reported outcome is immutable.');
        return job(row);
      }
      if (!['running', 'reconciling', 'cancelled'].includes(String(row.state)))
        throw fail('INVALID_TRANSITION', 'Job was not started.');
      if (
        row.manifest_sha256 !== v.report.manifest_sha256 ||
        row.archive_sha256 !== v.report.archive_sha256 ||
        row.execution_id !== v.report.execution_id
      )
        throw fail('EVIDENCE_MISMATCH', 'Reported artifact changed.');
      const valid = await this.validLease(c, row, device);
      const uncertain =
        row.state === 'reconciling' ||
        ['lost', 'cleanup_required'].includes(v.report.state) ||
        (!valid && !row.cancel_requested);
      const state = uncertain
        ? 'reconciling'
        : row.cancel_requested || device.state !== 'active'
          ? 'cancelled'
          : 'completed';
      await c.query(
        `insert into desktop_job_reports(job_id,report,report_hash) values($1,$2,$3)`,
        [jobId, JSON.stringify(v.report), canonicalHash(v.report)],
      );
      const updated = await c.query(
        `update desktop_jobs set state=$2,lease_expires_at=null where id=$1 returning *`,
        [jobId, state],
      );
      await this.auditJob(
        c,
        row,
        'desktop.job_reported',
        {
          state,
          report_hash: canonicalHash(v.report),
          verification: 'worker_report_only',
        },
        String(device.id),
      );
      return job({ ...updated.rows[0], report: v.report } as Row);
    });
  }
}
