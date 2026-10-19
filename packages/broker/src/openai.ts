import type { Usage } from '@creator/contracts';
import type {
  AdapterOutcome,
  AdapterRequest,
  ModelAdapter,
} from './adapters.js';

/**
 * OpenAI Responses API adapter (POST /v1/responses), written against the official reference
 * retrieved 2026-10-18. The key stays in this backend object; it is sent only to the
 * configured base URL and never returned, logged or stored.
 */
export interface OpenAIConfig {
  apiKey: string;
  model_id: string;
  /** https://api.openai.com/v1, or a loopback URL for contract tests. */
  baseUrl?: string;
}
const OFFICIAL = 'https://api.openai.com/v1';
const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
/** Validates the base URL and key; returns the normalized base. Shared with the batch adapter. */
export function openAIBase(config: OpenAIConfig): string {
  const base = new URL(config.baseUrl ?? OFFICIAL);
  if (
    base.toString().replace(/\/$/, '') !== OFFICIAL &&
    !(base.protocol === 'http:' && LOOPBACK.has(base.hostname))
  )
    throw new Error('OpenAI base URL must be the official API or loopback.');
  if (!/^[A-Za-z0-9_-]{20,300}$/.test(config.apiKey))
    throw new Error('OpenAI API key is malformed.');
  return base.toString().replace(/\/$/, '');
}
/** The Responses request body for one call (also one batch line's body, X02). */
export function responsesBody(req: AdapterRequest) {
  return {
    model: req.model_id,
    input: req.input.map((m) => ({ role: m.role, content: m.text })),
    max_output_tokens: req.max_output_tokens,
    // Data minimisation: do not ask the provider to retain the response.
    store: false,
  };
}
/** Maps a successful Responses body to an outcome; anything unusable is unknown, not zero. */
export function responseOutcome(body: Record<string, unknown>): AdapterOutcome {
  const usage = normalizeOpenAIUsage(body.usage);
  const text = outputText(body);
  if (!usage || text === null || typeof body.status !== 'string')
    return {
      kind: 'unknown',
      reason_code: 'malformed_response',
      message: 'Response lacked usable usage or output.',
    };
  const details = body.incomplete_details as
    { reason?: unknown } | null | undefined;
  return {
    kind: 'completed',
    response_id: typeof body.id === 'string' ? body.id.slice(0, 200) : null,
    text,
    vector: null,
    usage,
    incomplete_reason:
      body.status === 'completed'
        ? null
        : typeof details?.reason === 'string'
          ? details.reason.slice(0, 80)
          : body.status.slice(0, 80),
  };
}

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
/**
 * Maps Responses usage to disjoint categories. `cached_tokens` and `cache_write_tokens` are
 * parts of `input_tokens`; `reasoning_tokens` is part of `output_tokens` and billed as
 * output, so it is never added again. Anything inconsistent is malformed, not zero.
 */
export function normalizeOpenAIUsage(raw: unknown): Usage | null {
  if (!raw || typeof raw !== 'object') return null;
  const u = raw as Record<string, unknown>;
  const inDetails = (u.input_tokens_details ?? {}) as Record<string, unknown>;
  const outDetails = (u.output_tokens_details ?? {}) as Record<string, unknown>;
  const input = u.input_tokens;
  const output = u.output_tokens;
  const cached = inDetails.cached_tokens ?? 0;
  const written = inDetails.cache_write_tokens ?? 0;
  const reasoning = outDetails.reasoning_tokens ?? 0;
  if (![input, output, cached, written, reasoning].every(isCount)) return null;
  const [i, o, c, w, r] = [
    input,
    output,
    cached,
    written,
    reasoning,
  ] as number[];
  if (c! + w! > i! || r! > o!) return null;
  if (isCount(u.total_tokens) && u.total_tokens !== i! + o!) return null;
  return {
    uncached_input_tokens: i! - c! - w!,
    cached_input_tokens: c!,
    cache_write_tokens: w!,
    output_tokens: o!,
    reasoning_tokens: r!,
    tool_calls: {},
  };
}

function outputText(body: Record<string, unknown>): string | null {
  if (!Array.isArray(body.output)) return null;
  let text = '';
  for (const item of body.output as Record<string, unknown>[]) {
    if (item?.type !== 'message' || !Array.isArray(item.content)) continue;
    for (const part of item.content as Record<string, unknown>[])
      if (part?.type === 'output_text' && typeof part.text === 'string')
        text += part.text;
  }
  return text;
}

export class OpenAIAdapter implements ModelAdapter {
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
    return { provider: this.provider, model_id: this.model_id, live: true };
  }

  async call(
    req: AdapterRequest,
    signal: AbortSignal,
  ): Promise<AdapterOutcome> {
    if (req.action !== 'model.generate' && req.action !== 'model.summarize')
      return {
        kind: 'rejected',
        reason_code: 'unsupported',
        retry_after_ms: null,
        message: `The OpenAI adapter does not implement ${req.action}.`,
      };
    let response: Response;
    try {
      response = await fetch(`${this.#base}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.#key}`,
        },
        body: JSON.stringify(responsesBody(req)),
        signal,
      });
    } catch (e) {
      if (signal.aborted) throw e;
      // The request may have reached the provider before the connection failed.
      return {
        kind: 'unknown',
        reason_code: 'network_error',
        message: 'Connection failed.',
      };
    }
    if (response.status === 429) {
      const retry = Number(response.headers.get('retry-after'));
      await response.body?.cancel().catch(() => undefined);
      return {
        kind: 'rejected',
        reason_code: 'rate_limited',
        retry_after_ms:
          Number.isFinite(retry) && retry >= 0 ? retry * 1000 : null,
        message: 'Provider rate limit.',
      };
    }
    if (response.status === 401 || response.status === 403) {
      await response.body?.cancel().catch(() => undefined);
      return {
        kind: 'rejected',
        reason_code: 'auth_failed',
        retry_after_ms: null,
        message: 'Provider refused the credentials.',
      };
    }
    if (response.status >= 400 && response.status < 500) {
      await response.body?.cancel().catch(() => undefined);
      return {
        kind: 'rejected',
        reason_code: 'invalid_request',
        retry_after_ms: null,
        message: `Provider rejected the request (${response.status}).`,
      };
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        kind: 'unknown',
        reason_code: 'provider_error',
        message: `Provider error ${response.status}.`,
      };
    }
    let body: Record<string, unknown>;
    try {
      body = (await response.json()) as Record<string, unknown>;
    } catch {
      return {
        kind: 'unknown',
        reason_code: 'malformed_response',
        message: 'Response was not JSON.',
      };
    }
    return responseOutcome(body);
  }
}
