import type { Provider } from '@creator/contracts';
import {
  FIXTURE_CONTEXT_MODEL_ID,
  FixtureAdapter,
  type AdapterOutcome,
  type AdapterRequest,
} from './adapters.js';
import {
  openAIBase,
  responseOutcome,
  responsesBody,
  type OpenAIConfig,
} from './openai.js';

/**
 * X02 noninteractive batches. An adapter submits already-reserved items and later reports
 * per-item outcomes; it never sees grants, budgets or credentials other than its own key.
 * Outcomes use the same three kinds as synchronous calls: `rejected` only when the provider
 * documents that the item was not processed (and so not charged).
 */
export interface BatchItemCall {
  custom_id: string;
  request: AdapterRequest;
}
export type BatchSubmitOutcome =
  | { kind: 'submitted'; provider_batch_id: string }
  | { kind: 'rejected'; message: string }
  | { kind: 'unknown'; message: string };
export type BatchPollOutcome =
  | {
      kind: 'status';
      /** Provider status, verbatim where it is one of the documented values. */
      status: string;
      terminal: boolean;
      results: { custom_id: string; outcome: AdapterOutcome }[];
    }
  | { kind: 'error'; message: string };

export interface BatchAdapter {
  readonly provider: Provider;
  readonly model_id: string;
  readonly live: boolean;
  submit(
    items: BatchItemCall[],
    signal: AbortSignal,
  ): Promise<BatchSubmitOutcome>;
  poll(
    providerBatchId: string,
    customIds: string[],
    signal: AbortSignal,
  ): Promise<BatchPollOutcome>;
}

const TERMINAL = new Set(['completed', 'expired', 'failed', 'cancelled']);

/**
 * Deterministic local batches. `failIds` come back as provider request errors (not charged),
 * `expireIds` as expired (not charged), and `holdBack` items are missing from the first
 * terminal poll and appear on a later one, which exercises unknown-then-late settlement.
 */
export class FixtureBatchAdapter implements BatchAdapter {
  readonly provider = 'fixture' as const;
  readonly live = false;
  readonly #model: FixtureAdapter;
  readonly #batches = new Map<
    string,
    { items: BatchItemCall[]; polls: number }
  >();
  submitted = 0;
  constructor(
    readonly model_id: string = FIXTURE_CONTEXT_MODEL_ID,
    private readonly options: {
      failIds?: string[];
      expireIds?: string[];
      holdBack?: string[];
      rejectSubmit?: boolean;
    } = {},
  ) {
    this.#model = new FixtureAdapter(model_id);
  }
  submit(items: BatchItemCall[]): Promise<BatchSubmitOutcome> {
    if (this.options.rejectSubmit)
      return Promise.resolve({
        kind: 'rejected',
        message: 'Simulated provider refused the batch file.',
      });
    this.submitted += 1;
    const id = `fixture-batch-${this.submitted}-${items.length}`;
    this.#batches.set(id, { items, polls: 0 });
    return Promise.resolve({ kind: 'submitted', provider_batch_id: id });
  }
  async poll(providerBatchId: string): Promise<BatchPollOutcome> {
    const b = this.#batches.get(providerBatchId);
    if (!b) return { kind: 'error', message: 'Unknown fixture batch.' };
    b.polls += 1;
    const fail = new Set(this.options.failIds ?? []);
    const expire = new Set(this.options.expireIds ?? []);
    const hold = new Set(b.polls === 1 ? (this.options.holdBack ?? []) : []);
    const results: { custom_id: string; outcome: AdapterOutcome }[] = [];
    for (const i of b.items) {
      if (hold.has(i.custom_id)) continue;
      if (fail.has(i.custom_id))
        results.push({
          custom_id: i.custom_id,
          outcome: {
            kind: 'rejected',
            reason_code: 'invalid_request',
            retry_after_ms: null,
            message: 'Simulated per-item request error.',
          },
        });
      else if (expire.has(i.custom_id))
        results.push({
          custom_id: i.custom_id,
          outcome: {
            kind: 'rejected',
            reason_code: 'batch_expired',
            retry_after_ms: null,
            message: 'Simulated expiry before the item ran.',
          },
        });
      else
        results.push({
          custom_id: i.custom_id,
          outcome: await this.#model.call(
            i.request,
            new AbortController().signal,
          ),
        });
    }
    return {
      kind: 'status',
      status:
        expire.size || (this.options.holdBack ?? []).length
          ? 'expired'
          : 'completed',
      terminal: true,
      results,
    };
  }
}
export function fixtureBatchAdapters(): BatchAdapter[] {
  return [new FixtureBatchAdapter()];
}

/**
 * OpenAI Batch API (Files upload with purpose=batch, POST /v1/batches against /v1/responses
 * with a 24h window, GET /v1/batches/{id}, GET /v1/files/{id}/content), written against the
 * official reference retrieved 2026-10-19. Only loopback contract tests exercise it here.
 */
export class OpenAIBatchAdapter implements BatchAdapter {
  readonly provider = 'openai' as const;
  readonly live = true;
  readonly model_id: string;
  readonly #key: string;
  readonly #base: string;
  constructor(config: OpenAIConfig) {
    this.#base = openAIBase(config);
    this.#key = config.apiKey;
    this.model_id = config.model_id;
  }
  toJSON() {
    return {
      provider: this.provider,
      model_id: this.model_id,
      live: true,
      batch: true,
    };
  }
  #auth() {
    return { Authorization: `Bearer ${this.#key}` };
  }

  async submit(
    items: BatchItemCall[],
    signal: AbortSignal,
  ): Promise<BatchSubmitOutcome> {
    const lines = items.map((i) =>
      JSON.stringify({
        custom_id: i.custom_id,
        method: 'POST',
        url: '/v1/responses',
        body: responsesBody(i.request),
      }),
    );
    const form = new FormData();
    form.append('purpose', 'batch');
    form.append(
      'file',
      new Blob([`${lines.join('\n')}\n`], { type: 'application/jsonl' }),
      'creator-batch.jsonl',
    );
    let file: Response;
    try {
      file = await fetch(`${this.#base}/files`, {
        method: 'POST',
        headers: this.#auth(),
        body: form,
        signal,
      });
    } catch {
      // An uploaded file alone runs nothing, so a failed upload is not a charge.
      return {
        kind: 'rejected',
        message: 'File upload failed; nothing was submitted.',
      };
    }
    const fileBody = (await file.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    if (!file.ok || typeof fileBody?.id !== 'string')
      return {
        kind: 'rejected',
        message: `File upload was refused (${file.status}); nothing was submitted.`,
      };
    let batch: Response;
    try {
      batch = await fetch(`${this.#base}/batches`, {
        method: 'POST',
        headers: { ...this.#auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_file_id: fileBody.id,
          endpoint: '/v1/responses',
          completion_window: '24h',
        }),
        signal,
      });
    } catch {
      return {
        kind: 'unknown',
        message:
          'Batch creation may have reached the provider before the connection failed.',
      };
    }
    const body = (await batch.json().catch(() => null)) as {
      id?: unknown;
    } | null;
    if (batch.status >= 400 && batch.status < 500)
      return {
        kind: 'rejected',
        message: `Batch creation was refused (${batch.status}).`,
      };
    if (!batch.ok || typeof body?.id !== 'string')
      return {
        kind: 'unknown',
        message: `Batch creation ended ${batch.status}; state unknown.`,
      };
    return { kind: 'submitted', provider_batch_id: body.id.slice(0, 200) };
  }

  async poll(
    providerBatchId: string,
    customIds: string[],
    signal: AbortSignal,
  ): Promise<BatchPollOutcome> {
    let res: Response;
    try {
      res = await fetch(
        `${this.#base}/batches/${encodeURIComponent(providerBatchId)}`,
        {
          headers: this.#auth(),
          signal,
        },
      );
    } catch {
      return {
        kind: 'error',
        message: 'Could not reach the provider to poll.',
      };
    }
    const b = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok || !b || typeof b.status !== 'string')
      return { kind: 'error', message: `Poll ended ${res.status}.` };
    const status = b.status;
    const terminal = TERMINAL.has(status);
    const results: { custom_id: string; outcome: AdapterOutcome }[] = [];
    const wanted = new Set(customIds);
    for (const key of ['output_file_id', 'error_file_id'] as const) {
      const fileId = b[key];
      if (typeof fileId !== 'string') continue;
      let text: string;
      try {
        const f = await fetch(
          `${this.#base}/files/${encodeURIComponent(fileId)}/content`,
          { headers: this.#auth(), signal },
        );
        if (!f.ok)
          return {
            kind: 'error',
            message: `Result file read ended ${f.status}.`,
          };
        text = await f.text();
      } catch {
        return { kind: 'error', message: 'Could not read a result file.' };
      }
      for (const line of text.split('\n')) {
        if (!line.trim()) continue;
        let row: Record<string, unknown>;
        try {
          row = JSON.parse(line) as Record<string, unknown>;
        } catch {
          continue;
        }
        const id = row.custom_id;
        if (typeof id !== 'string' || !wanted.has(id)) continue;
        results.push({ custom_id: id, outcome: lineOutcome(row) });
      }
    }
    // A batch that failed validation ran nothing (documented); every item is unprocessed.
    if (status === 'failed' && !results.length)
      for (const id of customIds)
        results.push({
          custom_id: id,
          outcome: {
            kind: 'rejected',
            reason_code: 'invalid_request',
            retry_after_ms: null,
            message: 'The batch failed validation; no request ran.',
          },
        });
    return { kind: 'status', status, terminal, results };
  }
}

/** One output- or error-file line to an outcome. */
export function lineOutcome(row: Record<string, unknown>): AdapterOutcome {
  const error = row.error as
    { code?: unknown; message?: unknown } | null | undefined;
  if (error && error.code === 'batch_expired')
    return {
      kind: 'rejected',
      reason_code: 'batch_expired',
      retry_after_ms: null,
      message: 'The item expired before it ran; documented as not charged.',
    };
  const response = row.response as
    { status_code?: unknown; body?: unknown } | null | undefined;
  const code =
    typeof response?.status_code === 'number' ? response.status_code : null;
  if (code === 200 && response?.body && typeof response.body === 'object')
    return responseOutcome(response.body as Record<string, unknown>);
  if (code !== null && code >= 400 && code < 500 && code !== 429)
    return {
      kind: 'rejected',
      reason_code: 'invalid_request',
      retry_after_ms: null,
      message: `The provider rejected this item (${code}).`,
    };
  return {
    kind: 'unknown',
    reason_code: 'provider_error',
    message: `The item ended without a usable response${code === null ? '' : ` (${code})`}.`,
  };
}
