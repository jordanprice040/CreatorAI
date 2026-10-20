import {
  CompactRequestSchema,
  ContractError,
  SubmitBatchRequestSchema,
  parse,
  type Batch,
  type BrokerCallResult,
  type Compaction,
  type ContextCallResult,
  type ContextEvaluation,
  type ContextPack,
} from '@creator/contracts';
import { batchItemBrokerRequest, brokerRequestHash } from '@creator/domain';
import type { CommandContext, ContextStore } from '@creator/db';
import type { ModelBroker } from './broker.js';
import { toFinish } from './broker.js';
import type { BatchAdapter } from './batch.js';

/**
 * X02: the broker-side paths for context work. Every model call still goes through
 * ModelBroker (admission, reservation, settlement); the store only plans requests and later
 * verifies the broker's records for exactly those requests.
 */
export class ContextService {
  constructor(
    private readonly store: ContextStore,
    private readonly broker: ModelBroker,
    private readonly batches: BatchAdapter[] = [],
  ) {}

  #batchAdapter(fixture: boolean, provider: string, modelId: string) {
    return (
      this.batches.find(
        (a) =>
          a.live === !fixture &&
          a.provider === provider &&
          a.model_id === modelId,
      ) ?? null
    );
  }

  /**
   * A call with an optional context pack and result cache. A fresh entry is served only after
   * admission allows this action now; otherwise the broker makes (and meters) the call.
   */
  async contextCall(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ContextCallResult> {
    const prep = await this.store.prepareContextCall(ctx, ws, raw);
    if (prep.req.cache.mode === 'use' && prep.entry && !prep.stale) {
      const hit = await this.store.serveCacheHit(ctx, ws, prep);
      if (hit.reason_code !== 'cache_entry_invalidated') return hit;
    }
    const result = await this.broker.callModel(
      ctx,
      ws,
      prep.req.run_id,
      prep.model,
      prep.request,
    );
    const rec = await this.store.recordContextCall(ctx, ws, prep);
    return {
      cache: rec.cache,
      cache_entry_id: rec.entry_id,
      cache_note:
        rec.note ??
        (prep.entry && prep.stale
          ? `The cached entry was not served: ${prep.stale}.`
          : null),
      status: result.status,
      reason_code: result.reason_code,
      explanation: result.explanation,
      output: result.output,
      source_operation_id: null,
      admission_id: result.attempts.at(-1)?.decision_id ?? null,
      broker: result,
      fixture: result.fixture,
    };
  }

  /** Model compaction: one metered summarization call, then the survival check. */
  async compactWithModel(
    ctx: CommandContext,
    ws: string,
    packId: string,
    raw: unknown,
  ): Promise<{
    compaction: Compaction;
    pack: ContextPack | null;
    broker: BrokerCallResult;
  }> {
    const req = parse(CompactRequestSchema, raw);
    const plan = await this.store.compactionRequest(ctx, ws, packId, req);
    const model =
      plan.req.method === 'model' && plan.req.model ? plan.req.model : null;
    const broker = model
      ? await this.broker.callModel(
          ctx,
          ws,
          plan.pack.run_id,
          model,
          plan.request,
        )
      : await this.broker.call(ctx, ws, plan.pack.run_id, plan.request);
    const recorded = await this.store.recordModelCompaction(
      ctx,
      ws,
      packId,
      req,
    );
    return { ...recorded, broker };
  }

  /** Runs every planned case for both packs through the broker, then scores the records. */
  async runContextEvaluation(
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<ContextEvaluation> {
    const { evaluation, calls } = await this.store.contextEvaluationPlan(
      ctx,
      ws,
      id,
    );
    if (evaluation.state === 'evaluated') return evaluation;
    const model = evaluation.request.model;
    for (const call of calls)
      if (model)
        await this.broker.callModel(ctx, ws, evaluation.run_id, model, call);
      else await this.broker.call(ctx, ws, evaluation.run_id, call);
    return this.store.recordContextEvaluation(ctx, ws, id);
  }

  /**
   * Records the batch, reserves every item's maximum exposure (all or nothing), then submits.
   * A refused submission releases the reservations; an uncertain one holds them as unknown.
   */
  async submitBatch(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<Batch> {
    const parsed = parse(SubmitBatchRequestSchema, raw);
    const fixture = await this.store.isFixtureWorkspace(ctx, ws);
    const adapter = this.#batchAdapter(
      fixture,
      parsed.model.provider,
      parsed.model.model_id,
    );
    const begun = await this.store.beginBatch(
      ctx,
      ws,
      parsed,
      adapter !== null,
    );
    if (begun.existing || begun.batch.status !== 'submitting')
      return begun.batch;
    const { req, windowMs } = begun;
    const batchId = begun.batch.id;
    const reserved: { custom_id: string; reservation: string }[] = [];
    let denied: string | null = null;
    for (const item of req.items) {
      const request = batchItemBrokerRequest(req, item, windowMs);
      const prep = await this.store.prepareAttempt(
        ctx,
        ws,
        req.run_id,
        request,
        {
          provider: req.model.provider,
          model_id: req.model.model_id,
          adapterAvailable: true,
          requestHash: brokerRequestHash(req.run_id, request),
          attempt: 1,
          // The reservation is held for the whole completion window, then swept to unknown.
          timeoutMs: windowMs,
        },
      );
      await this.store.attachBatchItem(
        ctx,
        ws,
        batchId,
        item.custom_id,
        prep.reservation.id,
      );
      if (prep.kind === 'denied') {
        denied = `${item.custom_id}: ${prep.reservation.reason_code}`;
        break;
      }
      reserved.push({
        custom_id: item.custom_id,
        reservation: prep.reservation.id,
      });
    }
    const releaseAll = async (reason: string, explanation: string) => {
      for (const r of reserved)
        await this.store.finishAttempt(ctx, r.reservation, {
          kind: 'release',
          reasonCode: reason,
          explanation,
          result: { status: 'failed', reason_code: reason },
        });
    };
    if (denied) {
      await releaseAll(
        'batch_item_denied',
        'Another item of this batch was denied; nothing was sent.',
      );
      await this.store.setBatchStatus(ctx, ws, batchId, {
        status: 'refused',
        reason: 'batch_item_denied',
        explanation: `Every item must be admitted and reserved before submission; ${denied}.`,
      });
      return this.store.getBatch(ctx, ws, batchId);
    }
    const out = await adapter!.submit(
      req.items.map((i) => {
        const r = batchItemBrokerRequest(req, i, windowMs);
        return {
          custom_id: i.custom_id,
          request: {
            action: r.action_type,
            model_id: adapter!.model_id,
            input: r.input,
            max_output_tokens: r.max_output_tokens,
            output_format: r.output_format,
            tool: null,
          },
        };
      }),
      AbortSignal.timeout(120000),
      (fileId) => this.store.recordBatchFile(ctx, ws, batchId, fileId),
    );
    if (out.kind === 'submitted')
      await this.store.setBatchStatus(ctx, ws, batchId, {
        status: 'submitted',
        reason: 'submitted',
        explanation: `Submitted ${reserved.length} reserved items; poll for results.`,
        providerBatchId: out.provider_batch_id,
      });
    else if (out.kind === 'rejected') {
      await releaseAll(
        'batch_rejected',
        `${out.message} Nothing was processed.`,
      );
      await this.store.setBatchStatus(ctx, ws, batchId, {
        status: 'failed',
        reason: 'batch_rejected',
        explanation: out.message,
      });
    } else {
      for (const r of reserved)
        await this.store.finishAttempt(ctx, r.reservation, {
          kind: 'unknown',
          reasonCode: 'batch_submit_unknown',
          explanation: `${out.message} Held until reconciled.`,
          result: { status: 'unknown', reason_code: 'batch_submit_unknown' },
        });
      await this.store.setBatchStatus(ctx, ws, batchId, {
        status: 'unknown',
        reason: 'batch_submit_unknown',
        explanation: out.message,
      });
    }
    const saved = await this.store.getBatch(ctx, ws, batchId);
    if (out.kind === 'rejected')
      await this.#cleanupFiles(ctx, ws, saved, adapter!);
    return saved;
  }

  /**
   * Settles whatever results the provider reports. A terminal batch with items still missing
   * holds them as unknown; a later poll that finds them settles them late, exactly once.
   */
  async #cleanupFiles(
    ctx: CommandContext,
    ws: string,
    batch: Batch,
    adapter: BatchAdapter,
  ) {
    if (
      !adapter.deleteFile ||
      batch.items.some(
        (i) => i.status === 'in_flight' || i.status === 'unknown',
      )
    )
      return;
    for (const file of await this.store.pendingBatchFiles(ctx, ws, batch.id)) {
      if (await adapter.deleteFile(file, AbortSignal.timeout(10000)))
        await this.store.batchFileDeleted(ctx, ws, batch.id, file);
    }
  }
  async pollBatch(ctx: CommandContext, ws: string, id: string): Promise<Batch> {
    const data = await this.store.batchForPoll(ctx, ws, id);
    const { batch } = data;
    if (['refused', 'submitting'].includes(batch.status)) return batch;
    const adapter = this.#batchAdapter(
      batch.fixture,
      batch.provider,
      batch.model_id,
    );
    if (!adapter)
      throw new ContractError(
        'INVALID_CONFIG',
        'No batch adapter is configured for this model here.',
      );
    if (
      ['completed', 'partial', 'failed', 'expired'].includes(batch.status) &&
      batch.items.every((i) => !['in_flight', 'unknown'].includes(i.status))
    ) {
      await this.#cleanupFiles(ctx, ws, batch, adapter);
      return batch;
    }
    if (!batch.provider_batch_id) return batch;
    const ids = batch.items.map((i) => i.custom_id);
    const polled = await adapter.poll(
      batch.provider_batch_id,
      ids,
      AbortSignal.timeout(120000),
      (fileId) => this.store.recordBatchFile(ctx, ws, batch.id, fileId),
    );
    if (polled.kind === 'error') {
      for (const item of batch.items)
        if (item.reservation_id && item.status === 'in_flight')
          await this.store.finishAttempt(ctx, item.reservation_id, {
            kind: 'unknown',
            reasonCode: 'batch_result_unreadable',
            explanation: polled.message,
            result: {
              status: 'unknown',
              reason_code: 'batch_result_unreadable',
            },
          });
      await this.store.setBatchStatus(ctx, ws, id, {
        status: 'unknown',
        reason: 'batch_result_unreadable',
        explanation: polled.message,
      });
      return this.store.getBatch(ctx, ws, id);
    }
    const items = new Map(batch.items.map((i) => [i.custom_id, i]));
    const seen = new Set<string>();
    for (const r of polled.results) {
      const item = items.get(r.custom_id);
      const request = data.requests.get(r.custom_id);
      if (!item?.reservation_id || !request || seen.has(r.custom_id)) continue;
      seen.add(r.custom_id);
      if (item.status !== 'in_flight' && item.status !== 'unknown') continue;
      await this.store.finishAttempt(
        ctx,
        item.reservation_id,
        toFinish(
          r.outcome,
          request,
          data.pricing,
          adapter.live,
          item.status === 'unknown',
        ),
      );
    }
    if (polled.terminal)
      for (const item of batch.items)
        if (
          item.reservation_id &&
          item.status === 'in_flight' &&
          !seen.has(item.custom_id)
        )
          await this.store.finishAttempt(ctx, item.reservation_id, {
            kind: 'unknown',
            reasonCode: 'batch_result_missing',
            explanation: `The batch ended ${polled.status} without a result for this item; the provider may have charged. A later result settles it.`,
            result: { status: 'unknown', reason_code: 'batch_result_missing' },
          });
    const now = await this.store.getBatch(ctx, ws, id);
    const next = batchStatus(now, polled.status, polled.terminal);
    await this.store.setBatchStatus(ctx, ws, id, next);
    const saved = await this.store.getBatch(ctx, ws, id);
    if (polled.terminal) await this.#cleanupFiles(ctx, ws, saved, adapter);
    return saved;
  }
}

/** The batch's own status from its items' reservations, never from the provider alone. */
export function batchStatus(
  b: Batch,
  providerStatus: string,
  terminal: boolean,
): { status: Batch['status']; reason: string; explanation: string } {
  const by = (s: string) => b.items.filter((i) => i.status === s).length;
  const settled = b.items.filter(
    (i) =>
      i.status === 'settled' &&
      i.output !== null &&
      i.reason_code.startsWith('settled'),
  );
  const pending = by('in_flight') + by('unknown');
  const n = b.items.length;
  if (!terminal && pending)
    return {
      status: 'submitted',
      reason: `provider_${providerStatus}`,
      explanation: `Provider status ${providerStatus}; ${n - pending} of ${n} items have results.`,
    };
  if (by('unknown'))
    return {
      status: 'unknown',
      reason: 'results_missing',
      explanation: `${by('unknown')} of ${n} items have no result; their exposure stays held until a late result or reconciliation.`,
    };
  if (settled.length === n)
    return {
      status: 'completed',
      reason: 'completed',
      explanation: `All ${n} items settled.`,
    };
  if (!by('settled'))
    return {
      status: providerStatus === 'expired' ? 'expired' : 'failed',
      reason: `provider_${providerStatus}`,
      explanation: `No item ran; every reservation was released (provider status ${providerStatus}).`,
    };
  return {
    status: 'partial',
    reason: 'partial',
    explanation: `${by('settled')} of ${n} items settled; ${by('released')} released without charge.`,
  };
}
