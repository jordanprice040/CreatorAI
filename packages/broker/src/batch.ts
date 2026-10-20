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
    recordFile?: (fileId: string) => Promise<void>,
  ): Promise<BatchSubmitOutcome>;
  poll(
    providerBatchId: string,
    customIds: string[],
    signal: AbortSignal,
    recordFile?: (fileId: string) => Promise<void>,
  ): Promise<BatchPollOutcome>;
  deleteFile?(fileId: string, signal: AbortSignal): Promise<boolean>;
}

const TERMINAL = new Set(['completed', 'expired', 'failed', 'cancelled']);
export const BATCH_FILE_RETENTION_SECONDS = 48 * 3600;
export const BATCH_RESULT_LIMITS = {
  bytes: 8 * 1024 * 1024,
  lineBytes: 256 * 1024,
  lines: 10000,
} as const;

async function readBounded(
  response: Response,
  maxBytes: number,
  consume: (text: string) => void,
) {
  if (Number(response.headers.get('content-length') ?? 0) > maxBytes) {
    await response.body?.cancel();
    throw new Error('Provider response exceeds byte limit');
  }
  if (!response.body) throw new Error('Provider returned no body');
  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes)
        throw new Error('Provider response exceeds byte limit');
      consume(decoder.decode(value, { stream: true }));
    }
    consume(decoder.decode());
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function boundedJson(response: Response) {
  let text = '';
  await readBounded(response, 256 * 1024, (chunk) => {
    text += chunk;
  });
  return JSON.parse(text) as Record<string, unknown>;
}

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
    recordFile?: (fileId: string) => Promise<void>,
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
    // Expiry covers a crash after upload or an uncertain creation response with no batch ID.
    form.append('expires_after[anchor]', 'created_at');
    form.append('expires_after[seconds]', String(BATCH_FILE_RETENTION_SECONDS));
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
    const fileBody = (await boundedJson(file).catch(() => null)) as {
      id?: unknown;
    } | null;
    if (!file.ok || typeof fileBody?.id !== 'string')
      return {
        kind: 'rejected',
        message: `File upload was refused (${file.status}); nothing was submitted.`,
      };
    try {
      await recordFile?.(fileBody.id);
    } catch {
      await this.deleteFile(fileBody.id, AbortSignal.timeout(10000));
      return {
        kind: 'rejected',
        message: 'Input file could not be journalled; no batch was created.',
      };
    }
    let batch: Response;
    try {
      batch = await fetch(`${this.#base}/batches`, {
        method: 'POST',
        headers: { ...this.#auth(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          input_file_id: fileBody.id,
          endpoint: '/v1/responses',
          completion_window: '24h',
          output_expires_after: {
            anchor: 'created_at',
            seconds: BATCH_FILE_RETENTION_SECONDS,
          },
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
    const body = (await boundedJson(batch).catch(() => null)) as {
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
    recordFile?: (fileId: string) => Promise<void>,
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
    const b = (await boundedJson(res).catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!res.ok || !b || typeof b.status !== 'string')
      return { kind: 'error', message: `Poll ended ${res.status}.` };
    const status = b.status;
    const terminal = TERMINAL.has(status);
    const results: { custom_id: string; outcome: AdapterOutcome }[] = [];
    const wanted = new Set(customIds);
    const seen = new Set<string>();
    try {
      for (const key of ['input_file_id', 'output_file_id', 'error_file_id']) {
        const id = b[key];
        if (typeof id === 'string') await recordFile?.(id);
      }
    } catch {
      return {
        kind: 'error',
        message: 'Provider files could not be journalled.',
      };
    }
    for (const key of ['output_file_id', 'error_file_id'] as const) {
      const fileId = b[key];
      if (typeof fileId !== 'string') continue;
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
        let pending = '',
          lines = 0;
        const line = (text: string) => {
          if (
            ++lines > BATCH_RESULT_LIMITS.lines ||
            Buffer.byteLength(text) > BATCH_RESULT_LIMITS.lineBytes
          )
            throw new Error('Batch result line limit');
          if (!text.trim()) return;
          const row = JSON.parse(text) as Record<string, unknown>;
          if (!row || typeof row !== 'object' || Array.isArray(row))
            throw new Error('Invalid batch record');
          const id = row.custom_id;
          if (typeof id !== 'string' || !wanted.has(id)) return;
          if (seen.has(id)) throw new Error('Duplicate batch result');
          seen.add(id);
          results.push({ custom_id: id, outcome: lineOutcome(row) });
        };
        await readBounded(f, BATCH_RESULT_LIMITS.bytes, (chunk) => {
          pending += chunk;
          let end;
          while ((end = pending.indexOf('\n')) !== -1) {
            line(pending.slice(0, end));
            pending = pending.slice(end + 1);
          }
          if (Buffer.byteLength(pending) > BATCH_RESULT_LIMITS.lineBytes)
            throw new Error('Batch result line limit');
        });
        if (pending) line(pending);
      } catch {
        return {
          kind: 'error',
          message:
            'Result file unreadable, malformed or beyond bounded limits; costs remain unresolved.',
        };
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

  async deleteFile(fileId: string, signal: AbortSignal): Promise<boolean> {
    try {
      const res = await fetch(
        `${this.#base}/files/${encodeURIComponent(fileId)}`,
        { method: 'DELETE', headers: this.#auth(), signal },
      );
      if (res.status === 404) {
        await res.body?.cancel();
        return true;
      }
      const body = await boundedJson(res);
      return res.ok && body.id === fileId && body.deleted === true;
    } catch {
      return false;
    }
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
