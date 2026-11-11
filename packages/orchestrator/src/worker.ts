import { randomUUID } from 'node:crypto';
import {
  ContractError,
  workflowTaskClass,
  type BrokerCallResult,
  type TaskKind,
} from '@creator/contracts';
import {
  canonicalHash,
  discoveryRoleInput,
  explorationRoleInput,
  assessmentRoleInput,
  planTaskText,
  roleInput,
} from '@creator/domain';
import {
  ORCHESTRATOR_ACTOR_ID,
  isDiscoveryKind,
  validateOutput,
  type CommandContext,
  type TaskLease,
  type TaskOutcome,
  type WorkflowStore,
} from '@creator/db';
import type { ModelBroker, PlanConnectionService } from '@creator/broker';

export interface WorkerOptions {
  planService?: PlanConnectionService | undefined;
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
  readonly #planControllers = new Map<string, AbortController>();
  readonly optionsPlanService: PlanConnectionService | undefined;
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
    this.optionsPlanService = options.planService;
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
          if (!held) {
            lost = true;
            this.#planControllers.get(lease.runId)?.abort();
          }
          if (cancel) {
            this.broker.cancelRun(lease.runId);
            this.#planControllers.get(lease.runId)?.abort();
          }
        })
        .catch(() => undefined);
    }, this.#heartbeatMs);
    beat.unref();
    try {
      const discovery =
        task.context.context_version === 'discovery-context/1' &&
        isDiscoveryKind(task.kind) &&
        lease.discovery
          ? {
              kind: task.kind,
              context: task.context,
              ...lease.discovery,
            }
          : null;
      const exploration =
        task.context.context_version === 'exploration-context/1' &&
        task.kind === 'explore' &&
        lease.exploration
          ? lease.exploration
          : null;
      const assessment =
        task.context.context_version === 'assessment-context/1' &&
        task.kind === 'assess' &&
        lease.assessment
          ? lease.assessment
          : null;
      const check = assessment
        ? { assessment: assessment.packet }
        : exploration
          ? { exploration: exploration.packet }
          : discovery
            ? { packet: discovery.packet, context: discovery.context }
            : undefined;
      const input = assessment
        ? assessmentRoleInput(assessment.packet)
        : exploration
          ? explorationRoleInput(exploration.packet)
          : discovery
            ? discoveryRoleInput(
                discovery.kind,
                discovery.context,
                discovery.packet,
                discovery.inputs,
              )
            : task.context.context_version === 'skeptic-context/1' &&
                (task.kind === 'critique' || task.kind === 'synthesis')
              ? roleInput(task.kind, task.context, lease.critiques)
              : null;
      if (!input)
        throw new Error(
          `task ${task.id} has a context this worker cannot render`,
        );
      if (lease.resourceSetup?.kind === 'subscription') {
        if (!this.optionsPlanService) {
          await this.store.commitTask(this.#ctx, task.id, lease.token, {
            state: 'failed',
            reason: 'subscription_dispatch_not_configured',
          });
          return;
        }
        const setup = lease.resourceSetup;
        const abort = new AbortController();
        this.#planControllers.set(lease.runId, abort);
        try {
          // The same rendering the assessment uses to size its requests (ADR-0085).
          const { instructions, input: userInput } = planTaskText(input);
          const response = await this.optionsPlanService.invoke(
            this.#ctx,
            lease.workspaceId,
            {
              connection_id: setup.connection_id,
              model_id: setup.model_id,
              purpose: 'task',
              task_class: workflowTaskClass(task.kind),
              data_class: lease.dataClass,
              run_id: lease.runId,
              logical_operation_id: task.logical_operation_id,
              instructions,
              input: userInput,
              workflow: {
                task_id: task.id,
                lease_token: lease.token,
                input_hash: canonicalHash(input),
              },
              timeout_ms: Math.max(
                1,
                Math.min(
                  lease.limits.call_timeout_ms,
                  Date.parse(lease.deadlineAt) - Date.now(),
                ),
              ),
              max_output_chars: setup.max_output_chars,
              signal: abort.signal,
            },
          );
          let outcome: TaskOutcome;
          if (response.admission)
            outcome = response.admission.decision_id
              ? {
                  state: 'waiting_human',
                  reason: response.admission.reason_code,
                  decisionId: response.admission.decision_id,
                }
              : { state: 'failed', reason: response.admission.reason_code };
          else if (response.outcome.kind === 'completed') {
            let json: unknown;
            try {
              json = JSON.parse(response.outcome.text);
            } catch {
              json = null;
            }
            const output = validateOutput(task.kind, json, check);
            outcome = output
              ? { state: 'succeeded', reason: 'succeeded', output }
              : { state: 'failed', reason: 'invalid_output' };
          } else
            outcome = {
              state:
                response.outcome.kind === 'unknown' ? 'reconciling' : 'failed',
              reason: response.outcome.reason_code,
            };
          if (!this.frozen)
            await this.store.commitTask(
              this.#ctx,
              task.id,
              lease.token,
              outcome,
            );
        } catch (e) {
          if (
            e instanceof ContractError &&
            e.code !== 'LEASE_LOST' &&
            !this.frozen
          )
            await this.store.commitTask(this.#ctx, task.id, lease.token, {
              state: 'failed',
              reason: `${e.code}: ${e.details.join('; ') || e.message}`.slice(
                0,
                300,
              ),
            });
          else throw e;
        } finally {
          this.#planControllers.delete(lease.runId);
        }
        return;
      }
      const result = await this.broker.call(
        this.#ctx,
        lease.workspaceId,
        lease.runId,
        {
          envelope_id: lease.envelopeId,
          action_type:
            task.kind === 'synthesis' ? 'model.summarize' : 'model.generate',
          task_id: task.id,
          logical_operation_id: task.logical_operation_id,
          pricing_snapshot_id: lease.pricingSnapshotId,
          data_class: lease.dataClass,
          input,
          max_output_tokens: lease.limits.max_output_tokens,
          output_format: 'json',
          tool: null,
          max_attempts: lease.limits.max_attempts,
          timeout_ms: lease.limits.call_timeout_ms,
          justification: `Workflow ${lease.workflowId}: ${task.kind} ${task.ordinal}${task.round ? ` round ${task.round}` : ''}${task.repair ? ` repair ${task.repair}` : ''} (${ROLE_NAMES[task.kind]}).`,
        },
      );
      if (this.frozen) return;
      if (lost) this.#log(`lease on ${task.id} was lost during the call`);
      await this.store.commitTask(
        this.#ctx,
        task.id,
        lease.token,
        outcomeOf(task.kind, result, check),
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

const ROLE_NAMES: Record<TaskKind, string> = {
  critique: 'R05 skeptic',
  synthesis: 'R05 skeptic',
  locate: 'R02 locator',
  propose: 'R04 designer',
  revise: 'R04 designer revision',
  skeptic: 'R05 skeptic',
  explore: 'R01 explorer',
  assess: 'R08 assessor',
};

/** Maps a broker result to a task outcome. Unknown never becomes a retry. */
export function outcomeOf(
  kind: TaskKind,
  r: BrokerCallResult,
  discovery?: Parameters<typeof validateOutput>[2],
): TaskOutcome {
  switch (r.status) {
    case 'succeeded': {
      const output = validateOutput(kind, r.output?.json, discovery);
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
