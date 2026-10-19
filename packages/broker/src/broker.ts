import { setTimeout as sleep } from 'node:timers/promises';
import {
  BrokerCallRequestSchema,
  ContractError,
  parse,
  type BrokerCallRequest,
  type BrokerCallResult,
  type ModelRef,
  type Reservation,
  type RouteDecision,
} from '@creator/contracts';
import { canonicalHash, usageCost } from '@creator/domain';
import {
  LATE_RESULT_WINDOW_MS,
  isPgError,
  type BudgetStore,
  type CommandContext,
  type Finish,
  type Row,
} from '@creator/db';
import type { AdapterOutcome, ModelAdapter } from './adapters.js';

export interface BrokerOptions {
  /** Longest wait honoured for a provider's retry-after before the next attempt. */
  retryCapMs?: number;
  /** How long a timed-out request may still report a late result. */
  lateWindowMs?: number;
  /** X01: where routed calls read their recorded route decision. */
  decisions?: RouteDecisionSource;
}
export interface RouteDecisionSource {
  getRouteDecision(
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<RouteDecision>;
}
type Status = BrokerCallResult['status'];

/**
 * The one application-owned path to a model or metered tool. Order for every attempt:
 * admission and reservation commit together (BudgetStore.prepareAttempt); only then does the
 * adapter see the request; its outcome settles, releases or holds the reservation as unknown.
 * A denial never reaches an adapter, and a repeated logical operation never dispatches twice.
 */
export class ModelBroker {
  readonly #inflight = new Map<string, Set<AbortController>>();
  readonly #late = new Set<Promise<void>>();
  readonly #retryCap: number;
  readonly #lateWindow: number;
  readonly #decisions: RouteDecisionSource | null;
  constructor(
    private readonly store: BudgetStore,
    private readonly adapters: {
      fixture: ModelAdapter;
      live: ModelAdapter | null;
      /** X01: further adapters a route decision may name, fixture or live. */
      routes?: ModelAdapter[];
    },
    options: BrokerOptions = {},
  ) {
    if (adapters.fixture.live)
      throw new Error('The fixture slot must hold a non-live adapter.');
    if (adapters.live && !adapters.live.live)
      throw new Error('The live slot must hold a live adapter.');
    this.#retryCap = options.retryCapMs ?? 2000;
    this.#lateWindow = options.lateWindowMs ?? LATE_RESULT_WINDOW_MS;
    this.#decisions = options.decisions ?? null;
  }

  /**
   * The adapter for a named model: fixture adapters only in fixture workspaces and live ones
   * only in real workspaces. Null is recorded as a denial, never replaced.
   */
  #adapterFor(fixture: boolean, model: ModelRef): ModelAdapter | null {
    const all = [
      this.adapters.fixture,
      ...(this.adapters.live ? [this.adapters.live] : []),
      ...(this.adapters.routes ?? []),
    ];
    return (
      all.find(
        (a) =>
          a.live === !fixture &&
          a.provider === model.provider &&
          a.model_id === model.model_id,
      ) ?? null
    );
  }

  /**
   * X01: dispatches a call under a recorded route decision. The request must be the one the
   * decision admitted (operation, pricing, action, data class, size); the routed model's
   * adapter serves it, and grants and budgets are enforced exactly as for any call.
   * `shadow` runs the decision's shadow candidate under its own operation id; its output is
   * evaluation evidence and is never the served result.
   */
  async callRouted(
    ctx: CommandContext,
    ws: string,
    decisionId: string,
    variant: 'primary' | 'shadow',
    raw: unknown,
  ): Promise<BrokerCallResult & { served: boolean; model: ModelRef }> {
    if (!this.#decisions)
      throw new ContractError(
        'INVALID_CONFIG',
        'This broker has no route decision source.',
      );
    const d = await this.#decisions.getRouteDecision(ctx, ws, decisionId);
    const target =
      variant === 'primary'
        ? d.status === 'routed' && d.model && d.pricing_snapshot_id
          ? {
              model: d.model,
              pricing: d.pricing_snapshot_id,
              op: d.request.logical_operation_id,
            }
          : null
        : d.shadow
          ? {
              model: d.shadow.model,
              pricing: d.shadow.pricing_snapshot_id,
              op: d.shadow.logical_operation_id,
            }
          : null;
    if (!target)
      throw new ContractError(
        'INVALID_TRANSITION',
        variant === 'primary'
          ? `Route decision was refused (${d.reason_code}); nothing can be dispatched under it.`
          : 'This route decision has no shadow candidate.',
      );
    const req = parse(BrokerCallRequestSchema, raw);
    const r = d.request;
    if (
      req.logical_operation_id.toLowerCase() !== target.op ||
      req.pricing_snapshot_id.toLowerCase() !== target.pricing ||
      req.action_type !== r.action_type ||
      req.data_class !== r.data_class ||
      (req.task_id?.toLowerCase() ?? null) !== r.task_id ||
      req.max_output_tokens > r.max_output_tokens ||
      (req.tool ? [req.tool] : []).join() !== r.tools.join()
    )
      throw new ContractError(
        'SCOPE_EXCEEDED',
        'The call does not match the request this route decision admitted.',
      );
    const result = await this.callModel(ctx, ws, r.run_id, target.model, req);
    return { ...result, served: variant === 'primary', model: target.model };
  }

  /** Calls a named model (routed calls and benchmark runs); every other check is unchanged. */
  callModel(
    ctx: CommandContext,
    ws: string,
    runId: string,
    model: ModelRef,
    raw: unknown,
  ): Promise<BrokerCallResult> {
    return this.#call(ctx, ws, runId, raw, (fixture) => ({
      adapter: this.#adapterFor(fixture, model),
      model,
    }));
  }

  /** Requests termination of this run's in-flight calls. Their exposure stays held. */
  cancelRun(runId: string): number {
    const set = this.#inflight.get(runId.toLowerCase());
    if (!set) return 0;
    for (const c of set) c.abort(new Error('run cancelled'));
    return set.size;
  }
  /** Resolves once every pending late-result handler has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.#late.size) await Promise.allSettled([...this.#late]);
  }

  call(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<BrokerCallResult> {
    // Never a fallback: a real workspace without a live adapter is denied, not faked.
    return this.#call(ctx, ws, runId, raw, (fixture) => {
      const adapter = fixture ? this.adapters.fixture : this.adapters.live;
      return {
        adapter,
        model: {
          provider: adapter?.provider ?? 'openai',
          model_id: adapter?.model_id ?? 'not_configured',
        },
      };
    });
  }

  async #call(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
    pick: (fixture: boolean) => {
      adapter: ModelAdapter | null;
      model: ModelRef;
    },
  ): Promise<BrokerCallResult> {
    const req = parse(BrokerCallRequestSchema, raw);
    runId = runId.toLowerCase();
    const requestHash = canonicalHash({ run_id: runId, request: req });
    const replay = async () => {
      const prior = await this.store.operationAttempts(
        ctx,
        ws,
        req.logical_operation_id,
      );
      if (prior.some((p) => p.requestHash !== requestHash))
        throw new ContractError(
          'IDEMPOTENCY_CONFLICT',
          'This logical operation was already submitted with a different request.',
        );
      if (!prior.some((p) => p.reservation.status !== 'denied')) return null;
      return assemble(
        prior
          .filter(
            (p, i) =>
              p.reservation.status !== 'denied' || i === prior.length - 1,
          )
          .map((p) => p.reservation),
        prior.at(-1)?.result ?? null,
        true,
      );
    };
    const earlier = await replay();
    if (earlier) return earlier;
    const fixture = await this.store.isFixtureWorkspace(ctx, ws);
    const { adapter, model } = pick(fixture);
    const attempts: Reservation[] = [];
    for (let attempt = 1; attempt <= req.max_attempts; attempt += 1) {
      let prep;
      try {
        prep = await this.store.prepareAttempt(ctx, ws, runId, req, {
          provider: model.provider,
          model_id: model.model_id,
          adapterAvailable: adapter !== null,
          requestHash,
          attempt,
          timeoutMs: req.timeout_ms,
        });
      } catch (e) {
        // A concurrent duplicate reserved this attempt first: report its outcome instead.
        if (!isPgError(e, '23505', 'budget_reservations_attempt')) throw e;
        const raced = await replay();
        if (!raced) throw e;
        return raced;
      }
      attempts.push(prep.reservation);
      if (prep.kind === 'denied')
        return assemble(
          attempts,
          {
            status: ['needs_human', 'waiting_human'].includes(
              prep.admission?.outcome ?? '',
            )
              ? 'needs_human'
              : 'denied',
          },
          false,
        );
      const { finish, retryAfter } = await this.dispatch(
        ctx,
        adapter!,
        runId,
        req,
        prep.reservation,
        prep.pricing.body,
      );
      const done = await this.store.finishAttempt(
        ctx,
        prep.reservation.id,
        finish,
      );
      attempts[attempts.length - 1] = done.reservation;
      if (retryAfter === null || attempt === req.max_attempts)
        return assemble(attempts, finish.result, false);
      await sleep(Math.min(retryAfter, this.#retryCap));
    }
    throw new Error('unreachable');
  }

  private async dispatch(
    ctx: CommandContext,
    adapter: ModelAdapter,
    runId: string,
    req: BrokerCallRequest,
    reservation: Reservation,
    pricing: Parameters<typeof usageCost>[0],
  ): Promise<{ finish: Finish; retryAfter: number | null }> {
    const controller = new AbortController();
    const set = this.#inflight.get(runId) ?? new Set();
    set.add(controller);
    this.#inflight.set(runId, set);
    const pending: Promise<AdapterOutcome> = adapter
      .call(
        {
          action: req.action_type,
          model_id: adapter.model_id,
          input: req.input,
          max_output_tokens: req.max_output_tokens,
          output_format: req.output_format,
          tool: req.tool,
        },
        controller.signal,
      )
      .catch(() => ({
        kind: 'unknown' as const,
        reason_code: 'network_error' as const,
        message: controller.signal.aborted
          ? 'Cancelled while in flight.'
          : 'Adapter failed.',
      }));
    let timer: NodeJS.Timeout | undefined;
    const timeout = new Promise<'timeout'>((resolve) => {
      timer = setTimeout(() => resolve('timeout'), req.timeout_ms);
    });
    const first = await Promise.race([pending, timeout]);
    clearTimeout(timer);
    const forget = () => {
      set.delete(controller);
      if (!set.size) this.#inflight.delete(runId);
    };
    if (first === 'timeout') {
      // Keep listening: a late answer settles the held exposure exactly once.
      const hardStop = setTimeout(
        () => controller.abort(new Error('late window elapsed')),
        this.#lateWindow,
      );
      hardStop.unref();
      const late = pending
        .then(async (o) => {
          const f = toFinish(o, req, pricing, adapter, true);
          if (f.kind !== 'unknown')
            await this.store.finishAttempt(ctx, reservation.id, f);
        })
        .catch(() => undefined)
        .finally(() => {
          clearTimeout(hardStop);
          forget();
          this.#late.delete(late);
        });
      this.#late.add(late);
      return {
        finish: {
          kind: 'unknown',
          reasonCode: 'timeout',
          explanation:
            'No answer before the timeout; the provider may still charge. A late answer will settle it.',
          result: { status: 'unknown' },
        },
        retryAfter: null,
      };
    }
    forget();
    if (controller.signal.aborted)
      return {
        finish: {
          kind: 'unknown',
          reasonCode: 'cancelled_in_flight',
          explanation:
            'The run was cancelled while this call was in flight; any charge is held until reconciled.',
          result: { status: 'cancelled' },
        },
        retryAfter: null,
      };
    const finish = toFinish(first, req, pricing, adapter, false);
    return {
      finish,
      retryAfter:
        first.kind === 'rejected' && first.reason_code === 'rate_limited'
          ? (first.retry_after_ms ?? 1000)
          : null,
    };
  }
}

function toFinish(
  o: AdapterOutcome,
  req: BrokerCallRequest,
  pricing: Parameters<typeof usageCost>[0],
  adapter: ModelAdapter,
  late: boolean,
): Finish {
  if (o.kind === 'rejected')
    return {
      kind: 'release',
      reasonCode: o.reason_code,
      explanation: `${o.message} The provider did not process the request; nothing was charged.`,
      result: { status: 'failed', reason_code: o.reason_code },
    };
  if (o.kind === 'unknown')
    return {
      kind: 'unknown',
      reasonCode: o.reason_code,
      explanation: `${o.message} The provider may have charged; the reservation is held.`,
      result: { status: 'unknown', reason_code: o.reason_code },
    };
  try {
    usageCost(pricing, o.usage);
  } catch {
    return {
      kind: 'unknown',
      reasonCode: 'unpriced_usage',
      explanation:
        'The provider reported usage this pricing snapshot cannot price; held as unknown.',
      result: { status: 'unknown', reason_code: 'unpriced_usage' },
    };
  }
  let json: unknown = null;
  let status: Status = 'succeeded';
  let reason = 'succeeded';
  if (o.incomplete_reason) {
    status = 'failed';
    reason = 'incomplete_output';
  } else if (req.output_format === 'json') {
    try {
      json = JSON.parse(o.text) as unknown;
    } catch {
      status = 'failed';
      reason = 'malformed_output';
    }
  }
  return {
    kind: 'settle',
    usage: o.usage,
    source: adapter.live
      ? late
        ? 'late_provider_response'
        : 'provider_response'
      : 'fixture',
    providerResponseId: o.response_id,
    late,
    result: {
      status,
      reason_code: reason,
      output: { text: o.text.slice(0, 200000), json, vector: o.vector },
    },
  };
}

const EXPLAIN: Partial<Record<string, string>> = {
  succeeded: 'The call completed and was charged from authoritative usage.',
  malformed_output:
    'The model answered, and was charged, but the output failed validation.',
  incomplete_output:
    'The model stopped early (for example at max_output_tokens); it was charged.',
};

function assemble(
  attempts: Reservation[],
  result: Row | null,
  replayed: boolean,
): BrokerCallResult {
  const last = attempts.at(-1)!;
  const stored = (result ?? {}) as {
    status?: Status;
    reason_code?: string;
    output?: BrokerCallResult['output'];
  };
  const status: Status | 'in_flight' =
    last.status === 'in_flight' ? 'in_flight' : (stored.status ?? 'unknown');
  const reason = stored.reason_code ?? last.reason_code;
  return {
    status,
    reason_code: reason,
    explanation: EXPLAIN[reason] ?? last.explanation,
    logical_operation_id: last.logical_operation_id,
    attempts,
    output: stored.output ?? null,
    decision_id: last.decision_id,
    fixture: last.fixture,
    replayed,
  };
}
