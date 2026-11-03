import type { ArtifactSupervisor } from '@creator/executor';
import type { SourceBroker } from '@creator/research';
import {
  parse,
  z,
  PortfolioReasonSchema,
  PortfolioJobReconcileSchema,
} from '@creator/contracts';
import {
  pageQuery,
  type PortfolioStore,
  type CommandContext,
} from '@creator/db';

function schedulerError(e: unknown) {
  const raw = e && typeof e === 'object' && 'code' in e ? e.code : null;
  return {
    code:
      typeof raw === 'string' && /^[A-Z0-9_]{1,48}$/.test(raw)
        ? raw
        : 'SCHEDULER_FAILED',
    message: e instanceof Error ? e.message : String(e),
  };
}
export class PortfolioService {
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending: Promise<unknown> | null = null;
  constructor(
    private readonly store: PortfolioStore,
    private readonly sources: SourceBroker,
    private readonly artifacts: ArtifactSupervisor,
  ) {}
  start() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      if (!this.pending)
        this.pending = this.sweep()
          .catch((e: unknown) => {
            // The state could not even be recorded (database down); say so once per pass.
            console.error(
              `Portfolio scheduler could not record its state (${schedulerError(e).code}).`,
            );
          })
          .finally(() => {
            this.pending = null;
          });
    }, 15000);
    this.timer.unref();
  }
  async stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.pending;
  }
  /**
   * One scheduler pass. Every attempt and failure is recorded durably; a failing workspace
   * backs off and, after repeated failures, stops until its owner resumes it.
   */
  async sweep() {
    if (!(await this.store.schedulerMayAttempt('sweep'))) return;
    let owners: { workspace_id: string; created_by: string }[];
    try {
      owners = await this.store.portfolioOwners();
    } catch (e) {
      await this.store.recordSchedulerAttempt('sweep', null, schedulerError(e));
      return;
    }
    await this.store.recordSchedulerAttempt('sweep', null, null);
    for (const p of owners) {
      if (!(await this.store.schedulerMayAttempt(p.workspace_id))) continue;
      let error: { code: string; message: string } | null = null;
      try {
        await this.tick({ actorId: p.created_by }, p.workspace_id);
      } catch (e) {
        // Owner revocation or an unavailable policy fails closed, and is now visible.
        error = schedulerError(e);
      }
      await this.store.recordSchedulerAttempt(
        p.workspace_id,
        p.workspace_id,
        error,
      );
    }
  }
  async tick(ctx: CommandContext, ws: string) {
    const jobs = await this.store.claimPortfolioJobs(ctx, ws);
    const outcomes = [];
    for (const job of jobs) {
      const effectCtx = { ...ctx, idempotencyKey: 'portfolio-job:' + job.id };
      try {
        const ready = await this.store.portfolioJobReady(ctx, ws, job.id);
        const op = ready.body.operation;
        if (op.kind === 'review') {
          const workflow = await this.store.startWorkflow(
            effectCtx,
            ws,
            ready.run_id,
            op.request,
          );
          const finished = await this.store.finishPortfolioJob(
            ctx,
            ws,
            job.id,
            'succeeded',
            {
              kind: 'workflow_created',
              workflow_id: workflow.workflow.id,
              note: 'Workflow creation is not successful product review or QA.',
            },
          );
          if (finished.state === 'cancelled')
            await this.store.controlWorkflow(
              ctx,
              ws,
              workflow.workflow.id,
              'cancel',
              {
                expected_version: workflow.workflow.version,
                reason: 'Schedule cancelled during creation.',
              },
            );
          outcomes.push(finished);
        } else if (op.kind === 'source_refresh') {
          const retrieval = await this.sources.fetch(
            effectCtx,
            ws,
            ready.run_id,
            {
              url: String(ready.source_url),
              task_id: null,
              logical_operation_id: job.id,
              justification: 'Scheduled source refresh: ' + ready.body.label,
            },
          );
          outcomes.push(
            await this.store.finishPortfolioJob(
              ctx,
              ws,
              job.id,
              retrieval.state === 'fetched'
                ? 'succeeded'
                : retrieval.state === 'in_flight'
                  ? 'unknown'
                  : 'failed',
              {
                retrieval_id: retrieval.id,
                state: retrieval.state,
                reason_code: retrieval.reason_code,
              },
            ),
          );
        } else {
          const a = await this.store.artifactRecord(ctx, ws, op.artifact_id);
          if (!a.summary.current || a.summary.state !== 'verified')
            throw new Error('Artifact is stale or not verified.');
          const opened = await this.artifacts.open(
            a.manifest.product_id,
            op.artifact_id,
            op.manifest_sha256,
          );
          outcomes.push(
            await this.store.finishPortfolioJob(ctx, ws, job.id, 'succeeded', {
              kind: 'package_integrity',
              manifest_sha256: op.manifest_sha256,
              artifact_id: op.artifact_id,
              archive_sha256: opened.manifest.package.sha256,
              health_scope: 'archive_integrity_only_not_runtime_uptime',
              local_compute: 'not_metered_by_studio',
            }),
          );
        }
      } catch (e) {
        // A durable effect may have committed before its response was lost. Keep the slot.
        outcomes.push(
          await this.store.finishPortfolioJob(
            ctx,
            ws,
            job.id,
            job.body.operation.kind === 'health_check' ? 'failed' : 'unknown',
            { reason: (e as Error).message },
          ),
        );
      }
    }
    return { claimed: jobs.length, outcomes };
  }
  async reconcile(ctx: CommandContext, ws: string, id: string) {
    const { job, receipt, terminal } = await this.store.portfolioJobReceipt(
      ctx,
      ws,
      id,
    );
    if (terminal) return job;
    if (!receipt)
      return this.store.finishPortfolioJob(ctx, ws, id, 'failed', {
        reason: 'No durable receipt; closed without redispatch.',
      });
    return this.store.finishPortfolioJob(
      ctx,
      ws,
      id,
      receipt.state === 'in_flight'
        ? 'unknown'
        : receipt.state && receipt.state !== 'fetched'
          ? 'failed'
          : 'succeeded',
      {
        ...receipt,
        reconciled: true,
        note: 'Observed durable receipt; no redispatch.',
      },
    );
  }
}
export const PORTFOLIO_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(portfolio|portfolio-schedules|reusable-knowledge)(?:\/([^/]+)(?:\/(cancel|verify|review|revoke))?)?$/;
export async function portfolioRoutes(r: {
  store: PortfolioStore;
  service: PortfolioService;
  url: URL;
  ctx: CommandContext;
  ws: string;
  collection: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  body: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}) {
  const { store, service, ctx, ws, collection, item, action, method, send } = r;
  if (collection === 'portfolio') {
    if (!item && method === 'GET')
      return send(200, await store.inspectPortfolio(ctx, ws), false);
    if (method === 'POST')
      switch (item) {
        case 'policy':
          return send(
            200,
            await store.configurePortfolio(ctx, ws, await r.body()),
            true,
          );
        case 'runs':
          return send(
            201,
            await store.assignPortfolioRun(ctx, ws, await r.body()),
            true,
          );
        case 'health':
          return send(
            200,
            await store.decidePortfolioHealth(ctx, ws, await r.body()),
            true,
          );
        case 'tick':
          parse(z.strictObject({}), await r.body());
          return send(200, await service.tick(ctx, ws), true);
        case 'scheduler-resume':
          return send(
            200,
            await store.resumePortfolioScheduler(ctx, ws, await r.body()),
            true,
          );
        case 'reconcile': {
          const b = parse(PortfolioJobReconcileSchema, await r.body());
          return send(200, await service.reconcile(ctx, ws, b.job_id), true);
        }
      }
  }
  // Older schedules than the portfolio view's first page (audit L-9).
  if (collection === 'portfolio-schedules' && !item && method === 'GET')
    return send(
      200,
      await store.listPortfolioSchedules(
        ctx,
        ws,
        pageQuery((k) => r.url.searchParams.get(k)),
      ),
      false,
    );
  if (collection === 'portfolio-schedules' && method === 'POST') {
    if (!item)
      return send(
        201,
        await store.createPortfolioSchedule(ctx, ws, await r.body()),
        true,
      );
    if (action === 'cancel')
      return send(
        200,
        await store.cancelPortfolioSchedule(ctx, ws, item, await r.body()),
        true,
      );
  }
  if (collection === 'reusable-knowledge' && method === 'POST') {
    if (!item)
      return send(
        201,
        await store.proposeKnowledge(ctx, ws, await r.body()),
        true,
      );
    if (item === 'activate')
      return send(
        200,
        await store.activateKnowledge(ctx, ws, await r.body()),
        true,
      );
    if (action === 'verify') {
      parse(z.strictObject({}), await r.body());
      return send(201, await store.verifyKnowledge(ctx, ws, item), true);
    }
    if (action === 'review')
      return send(
        200,
        await store.reviewKnowledge(ctx, ws, item, await r.body()),
        true,
      );
    if (action === 'revoke') {
      const b = parse(PortfolioReasonSchema, await r.body());
      return send(200, await store.revokeKnowledge(ctx, ws, item, b), true);
    }
  }
  return false;
}
