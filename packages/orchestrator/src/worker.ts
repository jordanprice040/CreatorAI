import { randomUUID } from 'node:crypto';
import { ContractError, type BrokerCallResult } from '@creator/contracts';
import { roleInput } from '@creator/domain';
import {
  ORCHESTRATOR_ACTOR_ID,
  validateOutput,
  type CommandContext,
  type TaskLease,
  type TaskOutcome,
  type WorkflowStore,
} from '@creator/db';
import type { ModelBroker } from '@creator/broker';

export interface WorkerOptions {
  /** Shown on leases and in history; unique per process. */
  workerId?: string;
  leaseMs?: number;
  heartbeatMs?: number;
  pollMs?: number;
  /** Tasks this worker runs at once (each workflow also has its own concurrency limit). */
  capacity?: number;
  log?: (message: string) => void;
}

/**
 * Runs workflow tasks from the database. All state is durable: a worker can stop or crash at
 * any point, and another (or the same one after restart) continues from what was committed.
 * The browser is not involved; closing the page does not stop work, and stopping a worker
 * does not cancel a workflow.
 */
export class Worker {
  readonly id: string;
  readonly #running = new Map<string, Promise<void>>();
  readonly #ctx: CommandContext = { actorId: ORCHESTRATOR_ACTOR_ID };
  readonly #leaseMs: number;
  readonly #heartbeatMs: number;
  readonly #pollMs: number;
  readonly #capacity: number;
  readonly #log: (m: string) => void;
  #timer: NodeJS.Timeout | null = null;
  #ticking: Promise<number> | null = null;
  /** Test fault injection: a crashed worker stops heartbeating and never commits. */
  frozen = false;
  /** Test fault injection: a partitioned worker stops heartbeating but still tries to commit. */
  stallHeartbeats = false;

  constructor(
    private readonly store: WorkflowStore,
    private readonly broker: ModelBroker,
    options: WorkerOptions = {},
  ) {
    this.id = options.workerId ?? `worker-${randomUUID().slice(0, 8)}`;
    this.#leaseMs = options.leaseMs ?? 30_000;
    this.#heartbeatMs = options.heartbeatMs ?? Math.floor(this.#leaseMs / 3);
    this.#pollMs = options.pollMs ?? 1000;
    this.#capacity = options.capacity ?? 4;
    this.#log = options.log ?? (() => undefined);
  }

  start() {
    if (this.#timer) return;
    this.#timer = setInterval(() => {
      if (!this.#ticking)
        this.#ticking = this.tick()
          .catch((e: unknown) => {
            this.#log(`worker tick failed: ${(e as Error).message}`);
            return 0;
          })
          .finally(() => (this.#ticking = null));
    }, this.#pollMs);
    this.#timer.unref();
  }
  /** Stops taking work and waits for running tasks to report. Workflows keep their state. */
  async stop() {
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#ticking;
    await Promise.allSettled([...this.#running.values()]);
  }
  get running() {
    return this.#running.size;
  }

  /** One pass: recover leases, wake decisions, settle unknowns, coordinate, then lease work. */
  async tick(): Promise<number> {
    let progress = 0;
    progress += await this.store.sweepLeases(this.#ctx);
    progress += await this.store.wakeWaiting(this.#ctx);
    progress += await this.store.reconcileTasks(this.#ctx);
    for (const id of await this.store.liveWorkflowIds())
      if (await this.store.coordinateWorkflow(this.#ctx, id)) progress += 1;
    const leases = await this.store.claimTasks(
      this.#ctx,
      this.id,
      this.#capacity - this.#running.size,
      this.#leaseMs,
    );
    for (const lease of leases) {
      const run = this.execute(lease).finally(() =>
        this.#running.delete(lease.task.id),
      );
      this.#running.set(lease.task.id, run);
    }
    return progress + leases.length;
  }
  /** Test and CLI helper: ticks until nothing moves and nothing is running. */
  async settle(maxTicks = 200) {
    for (let i = 0; i < maxTicks; i += 1) {
      const moved = await this.tick();
      if (this.#running.size)
        await Promise.allSettled([...this.#running.values()]);
      else if (!moved) return;
    }
  }

  private async execute(lease: TaskLease) {
    const { task } = lease;
    let lost = false;
    const beat = setInterval(() => {
      if (this.frozen || this.stallHeartbeats) return;
      this.store
        .heartbeat(task.id, lease.token, this.#leaseMs)
        .then(({ held, cancel }) => {
          if (!held) lost = true;
          if (cancel) this.broker.cancelRun(lease.runId);
        })
        .catch(() => undefined);
    }, this.#heartbeatMs);
    beat.unref();
    try {
      const result = await this.broker.call(
        this.#ctx,
        lease.workspaceId,
        lease.runId,
        {
          envelope_id: lease.envelopeId,
          action_type:
            task.kind === 'critique' ? 'model.generate' : 'model.summarize',
          task_id: task.id,
          logical_operation_id: task.logical_operation_id,
          pricing_snapshot_id: lease.pricingSnapshotId,
          data_class: lease.dataClass,
          input: roleInput(task.kind, task.context, lease.critiques),
          max_output_tokens: lease.limits.max_output_tokens,
          output_format: 'json',
          tool: null,
          max_attempts: lease.limits.max_attempts,
          timeout_ms: lease.limits.call_timeout_ms,
          justification: `Workflow ${lease.workflowId}: ${task.kind} ${task.ordinal}${task.repair ? ` repair ${task.repair}` : ''} (R05 skeptic).`,
        },
      );
      if (this.frozen) return;
      if (lost) this.#log(`lease on ${task.id} was lost during the call`);
      await this.store.commitTask(
        this.#ctx,
        task.id,
        lease.token,
        outcomeOf(task.kind, result),
      );
    } catch (e) {
      if (e instanceof ContractError && e.code === 'LEASE_LOST') {
        this.#log(`stale worker ${this.id}: ${e.message}`);
        return;
      }
      if (this.frozen) return;
      // A failure before or after the broker: the lease expires and the next delivery replays
      // the same logical operation, which the broker never dispatches twice.
      this.#log(`task ${task.id} failed in worker: ${(e as Error).message}`);
    } finally {
      clearInterval(beat);
    }
  }
}

/** Maps a broker result to a task outcome. Unknown never becomes a retry. */
export function outcomeOf(
  kind: 'critique' | 'synthesis',
  r: BrokerCallResult,
): TaskOutcome {
  switch (r.status) {
    case 'succeeded': {
      const output = validateOutput(kind, r.output?.json);
      return output
        ? { state: 'succeeded', reason: 'succeeded', output }
        : { state: 'failed', reason: 'invalid_output' };
    }
    case 'failed':
      return { state: 'failed', reason: r.reason_code };
    case 'denied':
      return { state: 'failed', reason: `denied:${r.reason_code}` };
    case 'needs_human':
      return r.decision_id
        ? {
            state: 'waiting_human',
            reason: r.reason_code,
            decisionId: r.decision_id,
          }
        : { state: 'needs_human', reason: r.reason_code };
    case 'cancelled':
      return { state: 'cancelled', reason: 'cancelled_in_flight' };
    case 'unknown':
    case 'in_flight':
      return { state: 'reconciling', reason: r.reason_code };
  }
}
