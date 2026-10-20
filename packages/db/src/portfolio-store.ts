import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  parse,
  PortfolioPolicyRequestSchema,
  PortfolioRunRequestSchema,
  PortfolioScheduleRequestSchema,
  PortfolioReasonSchema,
  KnowledgeProposalSchema,
  KnowledgeReviewSchema,
  KnowledgeActivationSchema,
  PortfolioHealthDecisionSchema,
  type PortfolioScheduleRequest,
} from '@creator/contracts';
import { canonicalHash, renderKnowledge } from '@creator/domain';
import { MarketingStore } from './marketing-store.js';
import { portfolioActionGate, portfolioState } from './portfolio-gates.js';
import { knowledgeSources } from './knowledge-context.js';
import {
  fail,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

export type PortfolioJob = Row & {
  id: string;
  workspace_id: string;
  run_id: string;
  schedule_id: string;
  body_hash: string;
  body: PortfolioScheduleRequest;
  state: string;
  created_by: string;
};
/** Scheduler retry bounds (owner decision 2026-10-20): back off, then stop until resumed. */
export const SCHEDULER_MAX_FAILURES = 5;
export const SCHEDULER_BASE_BACKOFF_SECONDS = 30;
export const SCHEDULER_MAX_BACKOFF_SECONDS = 1800;
export class PortfolioStore extends MarketingStore {
  private async portfolioLock(c: PoolClient, ctx: CommandContext, ws: string) {
    await this.requireOwner(c, ws, ctx.actorId);
    await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      'portfolio:' + ws,
    ]);
  }
  private portfolioEvent(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    id: string,
    action: string,
    payload: Row = {},
  ) {
    return this.append(c, ctx, {
      workspaceId: ws,
      subjectKind: 'portfolio',
      subjectId: id,
      subjectVersion: null,
      action: 'portfolio.' + action,
      contentHash: null,
      payload,
    });
  }
  async configurePortfolio(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(PortfolioPolicyRequestSchema, raw);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      if (
        (
          await c.query(
            'select 1 from study_attempts where workspace_id=$1 limit 1',
            [ws],
          )
        ).rowCount
      )
        throw fail(
          'SCOPE_EXCEEDED',
          'A study workspace cannot enable changing portfolio policy.',
        );
      const prior = (
        await c.query(
          'select * from portfolio_policies where workspace_id=$1 for update',
          [ws],
        )
      ).rows[0];
      if (Number(prior?.version ?? 0) !== req.expected_version)
        throw fail('VERSION_CONFLICT', 'Portfolio policy changed.');
      const root = (
        await c.query(
          'select * from budget_envelopes where workspace_id=$1 and id=$2 for share',
          [ws, req.root_envelope_id],
        )
      ).rows[0];
      const reserve = (
        await c.query(
          'select * from budget_envelopes where workspace_id=$1 and id=$2 for share',
          [ws, req.maintenance_envelope_id],
        )
      ).rows[0];
      if (
        !root ||
        root.kind !== 'global' ||
        root.status !== 'active' ||
        !reserve ||
        reserve.parent_id !== root.id ||
        reserve.kind !== 'period' ||
        reserve.status !== 'active'
      )
        throw fail(
          'INVALID_CONTRACT',
          'Use an active global budget and its dedicated maintenance period child.',
        );
      if (BigInt(reserve.cap_nano) < BigInt(req.reserve_floor_nano_usd))
        throw fail(
          'BUDGET_EXCEEDED',
          'Reserve floor exceeds its allocated cap.',
        );
      if (
        prior &&
        (prior.body.root_envelope_id !== req.root_envelope_id ||
          prior.body.maintenance_envelope_id !== req.maintenance_envelope_id)
      )
        throw fail(
          'INVALID_TRANSITION',
          'Budget roots are fixed for this policy; create a separate workspace to change allocation identity.',
        );
      const { rows } = await c.query(
        `insert into portfolio_policies(workspace_id,version,body,created_by) values($1,1,$2,$3)
        on conflict(workspace_id) do update set version=portfolio_policies.version+1,body=excluded.body,created_by=excluded.created_by,updated_at=clock_timestamp() returning *`,
        [ws, JSON.stringify(req), ctx.actorId],
      );
      await this.portfolioEvent(c, ctx, ws, ws, 'configured', {
        version: rows[0].version,
        body: req,
      });
      return rows[0];
    });
  }
  private async assignLane(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    runId: string,
    lane: string,
    rationale: string,
  ) {
    const run = (
      await c.query(
        'select * from run_controls where workspace_id=$1 and run_id=$2',
        [ws, runId],
      )
    ).rows[0];
    if (!run || run.state !== 'active' || run.autonomy_mode === 'human_only')
      throw fail(
        'INVALID_TRANSITION',
        'Use an active non-human-only registered run.',
      );
    if (
      (
        await c.query(
          'select 1 from study_attempts where workspace_id=$1 and run_id=$2',
          [ws, runId],
        )
      ).rowCount
    )
      throw fail('SCOPE_EXCEEDED', 'Study runs cannot become portfolio work.');
    const existing = (
      await c.query(
        'select * from portfolio_run_lanes where workspace_id=$1 and run_id=$2',
        [ws, runId],
      )
    ).rows[0];
    if (existing) {
      if (existing.lane !== lane)
        throw fail('VERSION_CONFLICT', 'Run lane is immutable.');
      return existing;
    }
    const { rows } = await c.query(
      'insert into portfolio_run_lanes(workspace_id,run_id,lane,rationale,created_by) values($1,$2,$3,$4,$5) returning *',
      [ws, runId, lane, rationale, ctx.actorId],
    );
    await this.portfolioEvent(c, ctx, ws, runId, 'lane_assigned', {
      lane,
      rationale,
    });
    return rows[0];
  }
  async assignPortfolioRun(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(PortfolioRunRequestSchema, raw);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      return this.assignLane(c, ctx, ws, req.run_id, req.lane, req.rationale);
    });
  }
  async createPortfolioSchedule(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(PortfolioScheduleRequestSchema, raw);
    if (req.operation.kind !== 'review' && req.lane !== 'maintenance')
      throw fail(
        'INVALID_CONTRACT',
        'Health and source refresh are maintenance obligations.',
      );
    return this.idempotent(
      ws,
      ctx,
      { op: 'portfolio.schedule', req },
      async (c) => {
        await this.portfolioLock(c, ctx, ws);
        if (!(await portfolioState(c, ws, null)))
          throw fail('INVALID_CONFIG', 'Configure the portfolio policy first.');
        await this.assignLane(
          c,
          ctx,
          ws,
          req.run_id,
          req.lane,
          'Schedule: ' + req.label,
        );
        if (req.operation.kind === 'source_refresh') {
          const e = (
            await c.query(
              "select * from entities where workspace_id=$1 and id=$2 and kind='source' and status='active'",
              [ws, req.operation.source_id],
            )
          ).rows[0];
          if (
            !e ||
            Number(e.version) !== req.operation.source_version ||
            e.content_hash !== req.operation.source_hash
          )
            throw fail(
              'EVIDENCE_MISMATCH',
              'Pin the current source version and hash.',
            );
        } else if (req.operation.kind === 'health_check') {
          const a = await this.artifact(c, ws, req.operation.artifact_id);
          if (a.summary.manifest_sha256 !== req.operation.manifest_sha256)
            throw fail(
              'EVIDENCE_MISMATCH',
              'Artifact manifest binding changed.',
            );
        } else await this.subjectVersion(c, ws, req.operation.request.subject);
        const { rows } = await c.query(
          `insert into portfolio_schedules(id,workspace_id,run_id,lane,body,body_hash,next_due_at,created_by)
        values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
          [
            randomUUID(),
            ws,
            req.run_id,
            req.lane,
            JSON.stringify(req),
            canonicalHash(req),
            req.first_due_at,
            ctx.actorId,
          ],
        );
        await this.portfolioEvent(c, ctx, ws, String(rows[0].id), 'scheduled', {
          body_hash: canonicalHash(req),
        });
        return rows[0];
      },
    );
  }
  async inspectPortfolio(ctx: CommandContext, ws: string) {
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const state = await portfolioState(c, ws, null);
      const schedules = (
        await c.query(
          'select * from portfolio_schedules where workspace_id=$1 order by created_at limit 200',
          [ws],
        )
      ).rows;
      const jobs = (
        await c.query(
          'select * from portfolio_jobs where workspace_id=$1 order by created_at desc limit 200',
          [ws],
        )
      ).rows;
      const lanes = (
        await c.query(
          'select * from portfolio_run_lanes where workspace_id=$1',
          [ws],
        )
      ).rows;
      const health = (
        await c.query('select * from portfolio_health where workspace_id=$1', [
          ws,
        ])
      ).rows;
      const feedback = (
        await c.query(
          'select id,artifact_id,category,body,status,created_at from artifact_feedback where workspace_id=$1 order by created_at desc limit 100',
          [ws],
        )
      ).rows;
      const knowledge = (
        await c.query(
          `select k.*,h.candidate_id=k.id as active from reusable_knowledge k left join knowledge_heads h on h.workspace_id=k.workspace_id and h.key=k.key where k.workspace_id=$1 order by k.key,k.version`,
          [ws],
        )
      ).rows;
      const regressions = (
        await c.query(
          'select * from knowledge_regressions where workspace_id=$1 order by created_at desc limit 200',
          [ws],
        )
      ).rows;
      const scheduler =
        (
          await c.query(
            'select * from portfolio_scheduler_state where scope=$1',
            [ws],
          )
        ).rows[0] ?? null;
      return {
        state,
        scheduler,
        schedules,
        jobs,
        lanes,
        health,
        feedback,
        knowledge,
        regressions,
      };
    });
  }
  /** Coalesce all missed periods into one slot; persist next time before any effect. */
  async claimPortfolioJobs(
    ctx: CommandContext,
    ws: string,
  ): Promise<PortfolioJob[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const s = await portfolioState(c, ws, null);
      if (
        !s ||
        s.policy.mode === 'paused' ||
        new Date(s.policy.next_tick_at).getTime() > Date.now()
      )
        return [];
      await c.query(
        'update portfolio_policies set next_tick_at=clock_timestamp()+make_interval(secs=>$2) where workspace_id=$1',
        [ws, s.policy.tick_interval_seconds],
      );
      // A lost dispatcher cannot be retried. It keeps capacity until reconciliation.
      await c.query(
        "update portfolio_jobs set state='unknown' where workspace_id=$1 and state='dispatching' and created_at<clock_timestamp()-interval '2 minutes'",
        [ws],
      );
      const due = (
        await c.query(
          `select s.* from portfolio_schedules s join run_controls r on r.workspace_id=s.workspace_id and r.run_id=s.run_id
        where s.workspace_id=$1 and not s.cancelled and r.state='active' and s.next_due_at<=clock_timestamp()
        and not exists(select 1 from portfolio_jobs j where j.schedule_id=s.id and j.state in ('dispatching','unknown'))
        order by case s.lane when 'maintenance' then 0 when 'improvement' then 1 else 2 end,s.next_due_at,s.id limit 100`,
          [ws],
        )
      ).rows;
      const jobs: PortfolioJob[] = [];
      for (const schedule of due) {
        if (jobs.length >= s.policy.max_starts_per_tick) break;
        if (await portfolioActionGate(c, ws, schedule.run_id, 'model.generate'))
          continue;
        const id = randomUUID();
        const { rows } = await c.query(
          `insert into portfolio_jobs(id,workspace_id,schedule_id,run_id,lane,slot_at,body_hash,state)
          values($1,$2,$3,$4,$5,$6,$7,'dispatching') returning *`,
          [
            id,
            ws,
            schedule.id,
            schedule.run_id,
            schedule.lane,
            schedule.next_due_at,
            schedule.body_hash,
          ],
        );
        await c.query(
          'update portfolio_schedules set next_due_at=clock_timestamp()+make_interval(secs=>$2) where id=$1',
          [schedule.id, schedule.body.interval_seconds],
        );
        await this.portfolioEvent(c, ctx, ws, id, 'job_intent', {
          schedule_id: schedule.id,
          body_hash: schedule.body_hash,
        });
        jobs.push({
          ...rows[0],
          body: schedule.body,
          created_by: schedule.created_by,
        } as PortfolioJob);
      }
      return jobs;
    });
  }
  async portfolioJobReady(
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<PortfolioJob> {
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const row = (
        await c.query(
          `select j.*,s.body,s.created_by,s.cancelled,r.state as run_state from portfolio_jobs j
        join portfolio_schedules s on s.id=j.schedule_id join run_controls r on r.workspace_id=j.workspace_id and r.run_id=j.run_id
        where j.workspace_id=$1 and j.id=$2`,
          [ws, uuid(id)],
        )
      ).rows[0];
      if (!row) throw fail('NOT_FOUND', 'Scheduled job not found.');
      if (
        row.cancelled ||
        row.run_state !== 'active' ||
        row.state !== 'dispatching'
      )
        throw fail(
          'INVALID_TRANSITION',
          'Scheduled job cancelled or no longer dispatchable.',
        );
      const reason = await portfolioActionGate(
        c,
        ws,
        row.run_id,
        'model.generate',
      );
      if (reason) throw fail('ACCESS_DENIED', reason);
      if (row.body.operation.kind === 'source_refresh') {
        const op = row.body.operation;
        const pin = (
          await c.query(
            'select body,content_hash,status from entity_versions where workspace_id=$1 and entity_id=$2 and version=$3',
            [ws, op.source_id, op.source_version],
          )
        ).rows[0];
        const current = (
          await c.query(
            "select body,status from entities where workspace_id=$1 and id=$2 and kind='source'",
            [ws, op.source_id],
          )
        ).rows[0];
        if (
          !pin ||
          pin.content_hash !== op.source_hash ||
          pin.status !== 'active' ||
          current?.status !== 'active' ||
          pin.body.url !== current.body.url
        )
          throw fail(
            'EVIDENCE_MISMATCH',
            'Source identity changed or was withdrawn.',
          );
        row.source_url = pin.body.url;
      }
      return row as PortfolioJob;
    });
  }
  async finishPortfolioJob(
    ctx: CommandContext,
    ws: string,
    id: string,
    state: 'succeeded' | 'failed' | 'unknown',
    result: Row,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const job = (
        await c.query(
          `select j.*,s.body,s.cancelled,r.state as run_state from portfolio_jobs j join portfolio_schedules s on s.id=j.schedule_id
        join run_controls r on r.workspace_id=j.workspace_id and r.run_id=j.run_id where j.workspace_id=$1 and j.id=$2 for update of j`,
          [ws, uuid(id)],
        )
      ).rows[0];
      if (!job) throw fail('NOT_FOUND', 'Job not found.');
      if (!['dispatching', 'unknown'].includes(job.state)) return job;
      const final =
        job.cancelled || job.run_state !== 'active' ? 'cancelled' : state;
      const { rows } = await c.query(
        "update portfolio_jobs set state=$2,result=$3,finished_at=case when $2='unknown' then null else clock_timestamp() end where id=$1 returning *",
        [id, final, JSON.stringify(result)],
      );
      if (job.body.operation.kind === 'health_check' && final !== 'unknown')
        await c.query(
          `insert into portfolio_health(workspace_id,artifact_id,job_id,state,report) values($1,$2,$3,$4,$5)
        on conflict(workspace_id,artifact_id) do update set job_id=excluded.job_id,state=excluded.state,report=excluded.report,observed_at=clock_timestamp()`,
          [
            ws,
            job.body.operation.artifact_id,
            id,
            final === 'succeeded'
              ? 'package_integrity_passed'
              : 'attention_required',
            JSON.stringify(result),
          ],
        );
      await this.portfolioEvent(c, ctx, ws, id, 'job_' + final, { result });
      return rows[0];
    });
  }
  async cancelPortfolioSchedule(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(PortfolioReasonSchema, raw);
    const schedule = await this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const { rows } = await c.query(
        'update portfolio_schedules set cancelled=true where workspace_id=$1 and id=$2 returning *',
        [ws, uuid(id)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Schedule not found.');
      await this.portfolioEvent(c, ctx, ws, id, 'schedule_cancelled', {
        reason: req.reason,
      });
      return rows[0];
    });
    // Also fences all normal broker/workflow dispatch on this schedule's dedicated run.
    await this.cancelRun(ctx, ws, schedule.run_id, { reason: req.reason });
    return schedule;
  }
  async portfolioJobReceipt(ctx: CommandContext, ws: string, id: string) {
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const job = (
        await c.query(
          `select j.*,s.body,s.cancelled,r.state as run_state from portfolio_jobs j join portfolio_schedules s on s.id=j.schedule_id
        join run_controls r on r.workspace_id=j.workspace_id and r.run_id=j.run_id where j.workspace_id=$1 and j.id=$2 for update of j`,
          [ws, uuid(id)],
        )
      ).rows[0];
      if (!job) throw fail('NOT_FOUND', 'Job not found.');
      if (!['dispatching', 'unknown'].includes(job.state))
        return { job, receipt: job.result, terminal: true };
      let receipt: Row | null = null;
      if (job.body.operation.kind === 'review') {
        const row = (
          await c.query(
            'select response from command_receipts where workspace_id=$1 and idempotency_key=$2',
            [ws, 'portfolio-job:' + id],
          )
        ).rows[0];
        if (row)
          receipt = { workflow_id: row.response, kind: 'workflow_created' };
      } else if (job.body.operation.kind === 'source_refresh') {
        const row = (
          await c.query(
            'select id,state,reason_code from source_retrievals where workspace_id=$1 and run_id=$2 and logical_operation_id=$3',
            [ws, job.run_id, id],
          )
        ).rows[0];
        if (row)
          receipt = {
            retrieval_id: row.id,
            state: row.state,
            reason_code: row.reason_code,
          };
      }
      if (!receipt) {
        await c.query(
          'update portfolio_jobs set state=$3,finished_at=clock_timestamp(),result=$2 where id=$1',
          [
            id,
            JSON.stringify({
              reason: 'No durable effect receipt. Never redispatched.',
            }),
            job.cancelled || job.run_state !== 'active'
              ? 'cancelled'
              : 'failed',
          ],
        );
        await this.portfolioEvent(c, ctx, ws, id, 'job_fenced', {
          reason: 'No durable effect receipt.',
        });
      }
      return { job, receipt, terminal: false };
    });
  }
  async decidePortfolioHealth(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(PortfolioHealthDecisionSchema, raw);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const { rows } = await c.query(
        `update portfolio_health set state=$4 where workspace_id=$1 and artifact_id=$2 and job_id=$3 returning *`,
        [
          ws,
          req.artifact_id,
          req.expected_job_id,
          req.choice === 'defer' ? 'owner_deferred' : 'attention_required',
        ],
      );
      if (!rows[0])
        throw fail(
          'VERSION_CONFLICT',
          'Health evidence changed; review the current observation.',
        );
      await this.portfolioEvent(
        c,
        ctx,
        ws,
        req.artifact_id,
        'health_owner_decision',
        { ...req },
      );
      return rows[0];
    });
  }
  /**
   * Whether the scheduler may try this scope now: not stopped after repeated failures and past
   * its backoff. Scope is 'sweep' (listing workspaces) or a workspace id.
   */
  async schedulerMayAttempt(scope: string) {
    const { rows } = await this.pool.query(
      `select stopped_at is null and (next_retry_at is null or next_retry_at <= clock_timestamp()) as ok
         from portfolio_scheduler_state where scope=$1`,
      [scope],
    );
    return rows[0]?.ok ?? true;
  }
  /**
   * Records one scheduler attempt durably. A failure keeps a bounded code and message, backs
   * off exponentially and, after SCHEDULER_MAX_FAILURES in a row, stops the scope until the
   * owner resumes it. Success clears the error and the count.
   */
  async recordSchedulerAttempt(
    scope: string,
    workspaceId: string | null,
    error: { code: string; message: string } | null,
  ) {
    return this.tx(async (c) => {
      await c.query(
        `insert into portfolio_scheduler_state(scope, workspace_id) values ($1,$2)
         on conflict (scope) do nothing`,
        [scope, workspaceId],
      );
      const prev = (
        await c.query(
          'select consecutive_failures from portfolio_scheduler_state where scope=$1 for update',
          [scope],
        )
      ).rows[0] as { consecutive_failures: number };
      if (!error) {
        await c.query(
          `update portfolio_scheduler_state set last_attempt_at=clock_timestamp(), last_success_at=clock_timestamp(),
            last_error_code=null, last_error=null, consecutive_failures=0, next_retry_at=null,
            updated_at=clock_timestamp() where scope=$1`,
          [scope],
        );
        return;
      }
      const failures = Number(prev.consecutive_failures) + 1;
      // Only a workspace stops; the sweep itself (a database outage, say) just backs off.
      const stopped =
        workspaceId !== null && failures >= SCHEDULER_MAX_FAILURES;
      const backoff = Math.min(
        SCHEDULER_BASE_BACKOFF_SECONDS * 2 ** (failures - 1),
        SCHEDULER_MAX_BACKOFF_SECONDS,
      );
      const code = /^[A-Z0-9_]{1,48}$/.test(error.code)
        ? error.code
        : 'SCHEDULER_FAILED';
      const message = error.message.slice(0, 500);
      await c.query(
        `update portfolio_scheduler_state set last_attempt_at=clock_timestamp(), last_error_code=$2,
          last_error=$3, consecutive_failures=$4,
          next_retry_at=clock_timestamp()+make_interval(secs=>$5),
          stopped_at=case when $6 then coalesce(stopped_at, clock_timestamp()) else stopped_at end,
          updated_at=clock_timestamp() where scope=$1`,
        [scope, code, message, failures, backoff, stopped],
      );
      await c.query(
        `insert into portfolio_scheduler_failures(scope, workspace_id, error_code, error, consecutive_failures, stopped)
         values ($1,$2,$3,$4,$5,$6)`,
        [scope, workspaceId, code, message, failures, stopped],
      );
    });
  }
  /** Owner action: clears a stopped or backing-off workspace scope so the scheduler tries again. */
  async resumePortfolioScheduler(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const body = parse(PortfolioReasonSchema, raw);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const before = (
        await c.query(
          'select * from portfolio_scheduler_state where scope=$1 for update',
          [ws],
        )
      ).rows[0];
      if (!before) throw fail('NOT_FOUND', 'The scheduler has not run here.');
      const r = await c.query(
        `update portfolio_scheduler_state set consecutive_failures=0, next_retry_at=null, stopped_at=null,
          updated_at=clock_timestamp() where scope=$1 returning *`,
        [ws],
      );
      await this.portfolioEvent(c, ctx, ws, ws, 'scheduler_resumed', {
        reason: body.reason,
        consecutive_failures: Number(before.consecutive_failures),
        was_stopped: before.stopped_at !== null,
      });
      return r.rows[0];
    });
  }
  /** Aggregate scheduler state for the public health check: codes and times, no messages. */
  async schedulerSummary() {
    const { rows } = await this.pool.query(
      `select max(last_attempt_at) as last_attempt_at, max(last_success_at) as last_success_at,
         count(*) filter (where last_error_code is not null)::int as failing,
         count(*) filter (where stopped_at is not null)::int as stopped,
         (select last_error_code from portfolio_scheduler_state where last_error_code is not null
           order by last_attempt_at desc limit 1) as error_code
       from portfolio_scheduler_state`,
    );
    const r = rows[0] as Row;
    return {
      last_attempt_at: r.last_attempt_at
        ? new Date(String(r.last_attempt_at)).toISOString()
        : null,
      last_success_at: r.last_success_at
        ? new Date(String(r.last_success_at)).toISOString()
        : null,
      failing_scopes: Number(r.failing),
      stopped_scopes: Number(r.stopped),
      error_code: (r.error_code as string | null) ?? null,
    };
  }
  async portfolioOwners() {
    return (
      await this.pool.query(
        'select workspace_id,created_by from portfolio_policies order by workspace_id limit 100',
      )
    ).rows as { workspace_id: string; created_by: string }[];
  }
  async proposeKnowledge(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const body = parse(KnowledgeProposalSchema, raw);
    return this.idempotent(
      ws,
      ctx,
      { op: 'knowledge.propose', body },
      async (c) => {
        await this.portfolioLock(c, ctx, ws);
        await knowledgeSources(c, ws, body);
        const fixture = (
          await c.query('select fixture from workspaces where id=$1', [ws])
        ).rows[0]?.fixture;
        if (fixture !== (body.data_class === 'synthetic'))
          throw fail(
            'SCOPE_EXCEEDED',
            'Knowledge data class must match its workspace.',
          );
        const next = Number(
          (
            await c.query(
              'select coalesce(max(version),0)+1 as n from reusable_knowledge where workspace_id=$1 and key=$2',
              [ws, body.key],
            )
          ).rows[0].n,
        );
        const { rows } = await c.query(
          "insert into reusable_knowledge(id,workspace_id,key,version,body,body_hash,status,created_by) values($1,$2,$3,$4,$5,$6,'proposed',$7) returning *",
          [
            randomUUID(),
            ws,
            body.key,
            next,
            JSON.stringify(body),
            canonicalHash(body),
            ctx.actorId,
          ],
        );
        await this.portfolioEvent(
          c,
          ctx,
          ws,
          String(rows[0].id),
          'knowledge_proposed',
          { body_hash: rows[0].body_hash, version: next },
        );
        return rows[0];
      },
    );
  }
  private async knowledgeCandidate(c: PoolClient, ws: string, id: string) {
    const row = (
      await c.query(
        'select * from reusable_knowledge where workspace_id=$1 and id=$2 for update',
        [ws, uuid(id)],
      )
    ).rows[0];
    if (!row) throw fail('NOT_FOUND', 'Knowledge candidate not found.');
    return row;
  }
  async verifyKnowledge(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const row = await this.knowledgeCandidate(c, ws, id);
      const body = parse(KnowledgeProposalSchema, row.body);
      await knowledgeSources(c, ws, body);
      if (row.status !== 'proposed')
        throw fail('INVALID_TRANSITION', 'Verify a proposed candidate.');
      const base = {
        permissions: ['read_synthetic'],
        budget_nano_usd: '0',
        model: 'fixture',
        condition: 'human_in_loop',
        constraints: ['Preserve scope.'],
      };
      const guidance = renderKnowledge(body.guidance, {
        key: row.key,
        version: Number(row.version),
        hash: row.body_hash,
      });
      const after = {
        ...base,
        constraints: [...base.constraints, ...guidance],
      };
      const checks = {
        schema_valid: true,
        provenance_current: true,
        task_constraints_added:
          after.constraints.length > base.constraints.length,
        authority_unchanged:
          canonicalHash({ ...after, constraints: [] }) ===
          canonicalHash({ ...base, constraints: [] }),
        rendered_as_task_data: guidance.every((s) =>
          s.startsWith('Reviewed task data (not authority) '),
        ),
        before_hash: canonicalHash(base),
        after_hash: canonicalHash(after),
        scope: 'structural_renderer_regression_not_empirical_quality',
      };
      const passed =
        checks.task_constraints_added &&
        checks.authority_unchanged &&
        checks.rendered_as_task_data;
      const { rows } = await c.query(
        `insert into knowledge_regressions(id,workspace_id,candidate_id,body_hash,verifier_version,checks,passed,created_by)
        values($1,$2,$3,$4,'knowledge-renderer/1',$5,$6,$7) returning *`,
        [
          randomUUID(),
          ws,
          id,
          row.body_hash,
          JSON.stringify(checks),
          passed,
          ctx.actorId,
        ],
      );
      await this.portfolioEvent(c, ctx, ws, id, 'knowledge_verified', {
        regression_id: rows[0].id,
        passed,
      });
      return rows[0];
    });
  }
  async reviewKnowledge(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(KnowledgeReviewSchema, raw);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const row = await this.knowledgeCandidate(c, ws, id);
      await knowledgeSources(c, ws, parse(KnowledgeProposalSchema, row.body));
      const regression = (
        await c.query(
          'select * from knowledge_regressions where workspace_id=$1 and id=$2 and candidate_id=$3',
          [ws, req.regression_id, id],
        )
      ).rows[0];
      if (
        row.status !== 'proposed' ||
        row.body_hash !== req.body_hash ||
        !regression?.passed ||
        regression.body_hash !== req.body_hash
      )
        throw fail(
          'EVIDENCE_MISMATCH',
          'Review must bind this proposed candidate and its executed regression.',
        );
      const { rows } = await c.query(
        "update reusable_knowledge set status='reviewed' where id=$1 returning *",
        [id],
      );
      await this.portfolioEvent(c, ctx, ws, id, 'knowledge_reviewed', {
        ...req,
      });
      return rows[0];
    });
  }
  async activateKnowledge(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(KnowledgeActivationSchema, raw);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const row = await this.knowledgeCandidate(c, ws, req.candidate_id);
      await knowledgeSources(c, ws, parse(KnowledgeProposalSchema, row.body));
      if (row.status !== 'reviewed')
        throw fail(
          'ACCESS_DENIED',
          'Only reviewed, non-revoked versions can be activated or rolled back to.',
        );
      const head = (
        await c.query(
          'select * from knowledge_heads where workspace_id=$1 and key=$2',
          [ws, row.key],
        )
      ).rows[0];
      if ((head?.candidate_id ?? null) !== req.expected_active_id)
        throw fail('VERSION_CONFLICT', 'Active knowledge version changed.');
      await c.query(
        `insert into knowledge_heads(workspace_id,key,candidate_id) values($1,$2,$3) on conflict(workspace_id,key) do update set candidate_id=excluded.candidate_id`,
        [ws, row.key, row.id],
      );
      await this.portfolioEvent(c, ctx, ws, row.id, 'knowledge_activated', {
        previous_id: head?.candidate_id ?? null,
        reason: req.reason,
        body_hash: row.body_hash,
      });
      return row;
    });
  }
  async revokeKnowledge(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(PortfolioReasonSchema, raw);
    return this.tx(async (c) => {
      await this.portfolioLock(c, ctx, ws);
      const row = await this.knowledgeCandidate(c, ws, id);
      if (row.status !== 'revoked')
        await c.query(
          "update reusable_knowledge set status='revoked' where id=$1",
          [id],
        );
      await c.query(
        'delete from knowledge_heads where workspace_id=$1 and candidate_id=$2',
        [ws, id],
      );
      await this.portfolioEvent(c, ctx, ws, id, 'knowledge_revoked', {
        reason: req.reason,
      });
      return { id, status: 'revoked' };
    });
  }
}
