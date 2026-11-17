import { readFileSync } from 'node:fs';
import {
  LOCAL_MODEL_DEFAULT_TIMEOUT_MS,
  LOCAL_MODEL_MAX_RESPONSE_BYTES,
  LocalModelsConfigSchema,
  isCloudModelName,
  parse,
  type LocalModelCheck,
  type LocalModelInventoryEntry,
  type LocalModelPin,
  type LocalModelsConfig,
  type Usage,
} from '@creator/contracts';
import type { AdapterOutcome, AdapterRequest } from './adapters.js';

// ADR-0127 (F11, first slice): an adapter for a local Ollama server, written against the
// official API reference (docs.ollama.com/api, retrieved 2026-11-17: /api/version, /api/tags,
// /api/chat). Design only: tests run it against a fake loopback server. It is not wired into
// any route yet, and nothing here downloads, creates, copies, pushes or deletes a model.

/**
 * The only paths the adapter ever requests. Model management (`/api/pull`, `/api/create`,
 * `/api/copy`, `/api/push`, `/api/delete`) is deliberately absent: a download is a device
 * step that needs the owner's typed OK and is done by the owner, outside the studio.
 */
export const OLLAMA_PATHS = {
  version: '/api/version',
  tags: '/api/tags',
  chat: '/api/chat',
} as const;
type OllamaPath = (typeof OLLAMA_PATHS)[keyof typeof OLLAMA_PATHS];

/** IP loopback only: `localhost` is a name the hosts file can point elsewhere. */
const LOOPBACK = new Set(['127.0.0.1', '[::1]']);

/** Validates the configured address; returns the normalized origin. */
export function ollamaBase(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error('The local model address is not a URL.');
  }
  if (url.protocol !== 'http:' || !LOOPBACK.has(url.hostname))
    throw new Error(
      'The local model address must be http://127.0.0.1 or http://[::1] on this computer.',
    );
  if (
    url.username ||
    url.password ||
    (url.pathname !== '/' && url.pathname !== '') ||
    url.search ||
    url.hash
  )
    throw new Error(
      'The local model address takes a host and port only, with no path, query or sign-in.',
    );
  return url.origin;
}

/** Reads and checks `config/local-models.json` (owner-written; the studio never writes it). */
export function loadLocalModelsConfig(path: string): LocalModelsConfig {
  const config = parse(
    LocalModelsConfigSchema,
    JSON.parse(readFileSync(path, 'utf8')) as unknown,
  );
  ollamaBase(config.base_url);
  return config;
}

type Fetched =
  | { kind: 'ok'; status: number; body: unknown }
  | { kind: 'http'; status: number; body: unknown }
  | { kind: 'redirect'; status: number }
  | { kind: 'network'; timedOut: boolean }
  | { kind: 'malformed'; message: string };

const isCount = (v: unknown): v is number =>
  typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
const str = (v: unknown, max: number) =>
  typeof v === 'string' ? v.slice(0, max) : null;

async function readCapped(response: Response, cap: number): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return '';
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > cap) {
      await reader.cancel().catch(() => undefined);
      throw new RangeError('too large');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/** One request to the local server. Never follows a redirect and never sends credentials. */
async function request(
  base: string,
  path: OllamaPath,
  init: { method: 'GET' } | { method: 'POST'; body: unknown },
  signal: AbortSignal | undefined,
  timeoutMs: number,
): Promise<Fetched> {
  const timer = AbortSignal.timeout(timeoutMs);
  const both = signal ? AbortSignal.any([signal, timer]) : timer;
  let response: Response;
  try {
    response = await fetch(`${base}${path}`, {
      method: init.method,
      ...(init.method === 'POST'
        ? {
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(init.body),
          }
        : {}),
      redirect: 'manual',
      signal: both,
    });
  } catch (e) {
    if (signal?.aborted) throw e;
    return { kind: 'network', timedOut: timer.aborted };
  }
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel().catch(() => undefined);
    return { kind: 'redirect', status: response.status };
  }
  let text: string;
  try {
    text = await readCapped(response, LOCAL_MODEL_MAX_RESPONSE_BYTES);
  } catch (e) {
    if (signal?.aborted) throw e;
    if (e instanceof RangeError)
      return { kind: 'malformed', message: 'The response was too large.' };
    return { kind: 'network', timedOut: timer.aborted };
  }
  let body: unknown = null;
  try {
    body = text ? (JSON.parse(text) as unknown) : null;
  } catch {
    if (response.ok)
      return { kind: 'malformed', message: 'The response was not JSON.' };
  }
  return response.ok
    ? { kind: 'ok', status: response.status, body }
    : { kind: 'http', status: response.status, body };
}

const errorText = (body: unknown) => {
  const e = (body as { error?: unknown } | null)?.error;
  return typeof e === 'string' ? e.slice(0, 200) : null;
};

/** Maps one `/api/tags` entry as reported; no detail is filled in that the server left out. */
export function inventoryEntry(raw: unknown): LocalModelInventoryEntry | null {
  if (!raw || typeof raw !== 'object') return null;
  const m = raw as Record<string, unknown>;
  const name = str(m.name, 300) ?? str(m.model, 300);
  if (!name) return null;
  const d = (m.details ?? {}) as Record<string, unknown>;
  return {
    name,
    digest: str(m.digest, 200),
    size_bytes: isCount(m.size) ? m.size : null,
    family: str(d.family, 200),
    parameter_size: str(d.parameter_size, 100),
    quantization_level: str(d.quantization_level, 100),
    remote:
      Boolean(m.remote_host) ||
      Boolean(m.remote_model) ||
      isCloudModelName(name),
  };
}

/**
 * Maps a non-streamed `/api/chat` answer. Missing counts are malformed, not zero.
 *
 * Provisional reading of the token counts (ADR-0127; to verify on a real server in the
 * hardware-check slice): the docs call `prompt_eval_count` "Number of tokens in the prompt" and
 * `prompt_eval_cached_count` "Number of prompt tokens read from the cache", but do not say
 * whether the first includes the second. It is read as including it; when the cached count is
 * larger, that reading cannot hold, so `prompt_eval_count` is taken as the uncached part
 * instead. Either way the answer is kept.
 *
 * Thinking is turned off in the request (`think: false`), so `eval_count` is read as answer
 * tokens and reasoning as 0.
 */
export function chatOutcome(body: unknown, model: string): AdapterOutcome {
  const malformed = (message: string): AdapterOutcome => ({
    kind: 'unknown',
    reason_code: 'malformed_response',
    message,
  });
  if (!body || typeof body !== 'object')
    return malformed('The local model answer was empty.');
  const b = body as Record<string, unknown>;
  if (b.model !== model)
    return malformed('The local server answered for a different model.');
  const message = b.message as { content?: unknown } | undefined;
  if (b.done !== true || typeof message?.content !== 'string')
    return malformed('The local model answer was incomplete.');
  const prompt = b.prompt_eval_count;
  const output = b.eval_count;
  const cached = b.prompt_eval_cached_count ?? 0;
  if (!isCount(prompt) || !isCount(output) || !isCount(cached))
    return malformed('The local model answer lacked usable token counts.');
  const usage: Usage = {
    uncached_input_tokens: cached > prompt ? prompt : prompt - cached,
    cached_input_tokens: cached,
    cache_write_tokens: 0,
    output_tokens: output,
    reasoning_tokens: 0,
    tool_calls: {},
  };
  const reason = str(b.done_reason, 80);
  return {
    kind: 'completed',
    response_id: null,
    text: message.content,
    vector: null,
    usage,
    incomplete_reason:
      reason === null || reason === 'stop'
        ? null
        : reason === 'length'
          ? 'max_output_tokens'
          : reason,
  };
}

/** The read-only side of a local Ollama server: its version and installed models. */
export class OllamaClient {
  readonly base: string;
  constructor(
    baseUrl: string,
    readonly timeoutMs = 10_000,
  ) {
    this.base = ollamaBase(baseUrl);
  }

  /** The server's reported version, or null when it cannot be read. */
  async version(signal?: AbortSignal): Promise<string | null> {
    const r = await request(
      this.base,
      OLLAMA_PATHS.version,
      { method: 'GET' },
      signal,
      this.timeoutMs,
    );
    return r.kind === 'ok'
      ? str((r.body as { version?: unknown } | null)?.version, 100)
      : null;
  }

  async inventory(
    signal?: AbortSignal,
  ): Promise<
    | { kind: 'ok'; models: LocalModelInventoryEntry[] }
    | { kind: 'unreachable' | 'malformed'; message: string }
  > {
    const r = await request(
      this.base,
      OLLAMA_PATHS.tags,
      { method: 'GET' },
      signal,
      this.timeoutMs,
    );
    if (r.kind === 'network')
      return {
        kind: 'unreachable',
        message: r.timedOut
          ? 'The local model server did not answer in time.'
          : 'No local model server answered at the configured address.',
      };
    if (r.kind !== 'ok')
      return {
        kind: 'malformed',
        message: 'The configured address did not answer like an Ollama server.',
      };
    const list = (r.body as { models?: unknown } | null)?.models;
    if (!Array.isArray(list))
      return {
        kind: 'malformed',
        message: 'The installed-model list was not in the documented shape.',
      };
    const models = list
      .map(inventoryEntry)
      .filter((m): m is LocalModelInventoryEntry => m !== null);
    return { kind: 'ok', models };
  }

  /** Whether a pinned model is installed, local, and the exact build the owner chose. */
  async check(
    pin: LocalModelPin,
    signal?: AbortSignal,
  ): Promise<LocalModelCheck> {
    const result = (
      status: LocalModelCheck['status'],
      installed: string | null,
      message: string,
    ): LocalModelCheck => ({
      name: pin.name,
      status,
      pinned_digest: pin.digest,
      installed_digest: installed,
      message,
    });
    if (isCloudModelName(pin.name))
      return result('remote_model', null, 'Ollama cloud models are not local.');
    const inv = await this.inventory(signal);
    if (inv.kind !== 'ok') return result(inv.kind, null, inv.message);
    const found = inv.models.find((m) => m.name === pin.name);
    if (!found)
      return result(
        'not_installed',
        null,
        'The local model server does not list this model.',
      );
    if (found.remote)
      return result(
        'remote_model',
        found.digest,
        'The server marks this model as running remotely.',
      );
    if (found.digest !== pin.digest)
      return result(
        'digest_changed',
        found.digest,
        'The installed model is a different build from the one pinned.',
      );
    return result('ready', found.digest, 'Installed and matches the pin.');
  }
}

/**
 * One pinned local model. Spends no money (`live: false` in the broker's sense) but is a real
 * model, so a later slice routes it through qualification like any other route. Each call first
 * checks the pin, so a replaced or removed model is refused rather than silently used.
 */
export class OllamaAdapter {
  readonly provider = 'ollama' as const;
  readonly live = false;
  readonly model_id: string;
  readonly digest: string;
  readonly #client: OllamaClient;
  readonly #timeoutMs: number;
  readonly #contextTokens: number | null;
  constructor(config: {
    base_url: string;
    pin: LocalModelPin;
    request_timeout_ms?: number;
    context_tokens?: number | null;
  }) {
    if (isCloudModelName(config.pin.name))
      throw new Error('Ollama cloud models are not local.');
    this.#client = new OllamaClient(config.base_url);
    this.model_id = config.pin.name;
    this.digest = config.pin.digest;
    this.#timeoutMs =
      config.request_timeout_ms ?? LOCAL_MODEL_DEFAULT_TIMEOUT_MS;
    this.#contextTokens = config.context_tokens ?? null;
  }
  toJSON() {
    return {
      provider: this.provider,
      model_id: this.model_id,
      digest: this.digest,
      live: false,
    };
  }

  /** The `/api/chat` body for one call: non-streamed, no tools, output capped. */
  chatBody(req: AdapterRequest) {
    return {
      model: this.model_id,
      messages: req.input.map((m) => ({ role: m.role, content: m.text })),
      stream: false,
      // Documented boolean: no thinking output, so the output cap goes to the answer.
      think: false,
      ...(req.output_format === 'json' ? { format: 'json' } : {}),
      options: {
        num_predict: req.max_output_tokens,
        ...(this.#contextTokens === null
          ? {}
          : { num_ctx: this.#contextTokens }),
      },
    };
  }

  async call(
    req: AdapterRequest,
    signal: AbortSignal,
  ): Promise<AdapterOutcome> {
    const refuse = (
      reason_code: 'unsupported' | 'invalid_request',
      message: string,
    ): AdapterOutcome => ({
      kind: 'rejected',
      reason_code,
      retry_after_ms: null,
      message,
    });
    if (req.action !== 'model.generate' && req.action !== 'model.summarize')
      return refuse(
        'unsupported',
        `The local model adapter does not implement ${req.action}.`,
      );
    if (req.tool !== null)
      return refuse('unsupported', 'The local model adapter offers no tools.');
    if (req.model_id !== this.model_id)
      return refuse('invalid_request', 'The request names a different model.');
    const pin = await this.#client.check(
      { name: this.model_id, digest: this.digest },
      signal,
    );
    // Nothing was sent to the model, so every not-ready check is a definite refusal. The
    // message starts with the check's status so records can tell the cases apart.
    if (pin.status !== 'ready')
      return refuse('unsupported', `${pin.status}: ${pin.message}`);
    const r = await request(
      this.#client.base,
      OLLAMA_PATHS.chat,
      { method: 'POST', body: this.chatBody(req) },
      signal,
      this.#timeoutMs,
    );
    switch (r.kind) {
      case 'network':
        // The server may have started generating before the connection failed.
        return {
          kind: 'unknown',
          reason_code: 'network_error',
          message: r.timedOut
            ? 'The local model did not finish in time.'
            : 'The connection to the local model server failed.',
        };
      case 'redirect':
        return refuse(
          'invalid_request',
          `The local model server redirected (${r.status}); redirects are not followed.`,
        );
      case 'malformed':
        return {
          kind: 'unknown',
          reason_code: 'malformed_response',
          message: r.message,
        };
      case 'http':
        if (r.status >= 400 && r.status < 500)
          return refuse(
            'invalid_request',
            `The local model server refused the request (${r.status})${
              errorText(r.body) ? `: ${errorText(r.body)}` : ''
            }.`,
          );
        return {
          kind: 'unknown',
          reason_code: 'provider_error',
          message: `Local model server error ${r.status}.`,
        };
      case 'ok':
        return chatOutcome(r.body, this.model_id);
    }
  }
}
