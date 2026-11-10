import { createHash } from 'node:crypto';

// Direct Responses path for ChatGPT plan usage (Path A). Preview requirements (docs read
// 2026-10-20): store:false, stream:true, instructions instead of system items, and no
// max_output_tokens, temperature, metadata or previous_response_id. Output length is
// therefore capped here by ending the stream. Success is only response.completed.

export type PlanObservedOutcome =
  | {
      kind: 'completed';
      text: string;
      output_chars: number;
      output_tokens: number | null;
      response_id: string | null;
      output_hash: string;
      /** Only when the request opted into web search: the search calls the stream reported. */
      search_calls?: PlanSearchCall[];
    }
  | {
      kind: 'failed' | 'rejected' | 'unknown';
      reason_code: string;
      message: string;
      response_id: string | null;
      output_chars: number | null;
      /** What the failure says about the account; applied by the store, never inferred. */
      eligibility?: 'not_eligible' | 'temporarily_unavailable';
      quota?: 'exhausted' | 'unavailable';
      sign_in_invalid?: boolean;
      model_refused?: boolean;
      retry_allowed: boolean;
      /** Search calls seen before the request stopped (opt-in web search only). */
      search_calls?: PlanSearchCall[];
    };

export interface PlanCallInput {
  api_base: string;
  access_token: string;
  model: string;
  instructions: string;
  input: string;
  timeout_ms: number;
  max_output_chars: number;
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  web_search?: PlanWebSearch;
}

export interface PlanErrorClass {
  reason_code: string;
  eligibility?: 'not_eligible' | 'temporarily_unavailable';
  quota?: 'exhausted' | 'unavailable';
  sign_in_invalid?: boolean;
  model_refused?: boolean;
  retry_allowed: boolean;
}

/** Recovery for the documented structured codes; anything else is a plain refusal. */
export function classifyPlanError(
  status: number,
  code: string | null,
  param: string | null,
): PlanErrorClass {
  const reason_code = code ?? `http_${status}`;
  switch (code) {
    case 'subscription_sharing_user_not_eligible':
      return { reason_code, eligibility: 'not_eligible', retry_allowed: false };
    case 'subscription_sharing_usage_limit_exceeded':
      return { reason_code, quota: 'exhausted', retry_allowed: false };
    case 'subscription_sharing_usage_unavailable':
      return { reason_code, quota: 'unavailable', retry_allowed: true };
    case 'subscription_sharing_user_unavailable':
      return {
        reason_code,
        eligibility: 'temporarily_unavailable',
        retry_allowed: true,
      };
    case 'subscription_sharing_invalid_user':
      return { reason_code, sign_in_invalid: true, retry_allowed: false };
    case 'subscription_sharing_unsupported_capability':
      return {
        reason_code,
        model_refused: param === 'model',
        retry_allowed: false,
      };
    case 'subscription_sharing_route_not_supported':
    case 'chatpass_v2_scope_not_authorized':
    case 'chatpass_v2_invalid_authorization_context':
      return { reason_code, retry_allowed: false };
  }
  if (status === 401)
    return { reason_code, sign_in_invalid: true, retry_allowed: false };
  if (status === 503) return { reason_code, retry_allowed: true };
  return { reason_code, retry_allowed: false };
}

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
function errorParts(body: unknown): {
  code: string | null;
  param: string | null;
} {
  if (body && typeof body === 'object') {
    const e = (body as { error?: unknown }).error;
    if (e && typeof e === 'object') {
      const o = e as { code?: unknown; param?: unknown };
      return {
        code: typeof o.code === 'string' ? o.code.slice(0, 120) : null,
        param: typeof o.param === 'string' ? o.param.slice(0, 120) : null,
      };
    }
  }
  // Direct-route admission can answer {"detail": "..."}: diagnostic text, not a code.
  return { code: null, param: null };
}

/**
 * Opt-in hosted web search for one plan request (search-route test, November 10, 2026). Not
 * wired to any route, UI or workflow: only an owner-run caller passes it. The plan route has no
 * `max_tool_calls`, so `max_calls` is enforced here by ending the stream; a search may already
 * have run when that happens. Search output is discovery only: the guarded fetcher, not this
 * response, produces evidence.
 */
export interface PlanWebSearch {
  /** 1–10 search calls; one more ends the stream with an unknown outcome. */
  max_calls: number;
  /** At most 100 hosts each; the provider accepts one list or the other, not both. */
  allowed_domains?: string[];
  blocked_domains?: string[];
}

/** One `web_search_call` the provider reported, trimmed to bounded plain fields. */
export interface PlanSearchCall {
  id: string | null;
  status: string | null;
  action: string | null;
  queries: string[];
  sources: string[];
}

const DOMAIN = /^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/;
export function checkPlanWebSearch(w: PlanWebSearch): string | null {
  if (!Number.isInteger(w.max_calls) || w.max_calls < 1 || w.max_calls > 10)
    return 'max_calls must be 1 to 10.';
  if (w.allowed_domains?.length && w.blocked_domains?.length)
    return 'Give allowed or blocked domains, not both.';
  for (const list of [w.allowed_domains ?? [], w.blocked_domains ?? []]) {
    if (list.length > 100) return 'At most 100 domains.';
    if (list.some((d) => !DOMAIN.test(d)))
      return 'Domains are lowercase host names without a scheme.';
  }
  return null;
}

export function planRequestBody(
  model: string,
  instructions: string,
  input: string,
  webSearch?: PlanWebSearch,
) {
  const base = {
    model,
    instructions,
    input: [{ role: 'user', content: input }],
    store: false,
    stream: true,
  };
  if (!webSearch) return base;
  const filters = webSearch.allowed_domains?.length
    ? { allowed_domains: webSearch.allowed_domains }
    : webSearch.blocked_domains?.length
      ? { blocked_domains: webSearch.blocked_domains }
      : null;
  return {
    ...base,
    tools: [
      {
        type: 'web_search',
        external_web_access: true,
        ...(filters ? { filters } : {}),
      },
    ],
    tool_choice: 'required',
    include: ['web_search_call.action.sources'],
  };
}

const str = (v: unknown, n: number) =>
  typeof v === 'string' ? v.slice(0, n) : null;
/** Bounded copy of a provider `web_search_call` item; anything else returns null. */
export function searchCallOf(item: unknown): PlanSearchCall | null {
  if (!item || typeof item !== 'object') return null;
  const it = item as Record<string, unknown>;
  if (it.type !== 'web_search_call') return null;
  const action = (
    it.action && typeof it.action === 'object' ? it.action : {}
  ) as Record<string, unknown>;
  const queries = [
    ...(typeof action.query === 'string' ? [action.query] : []),
    ...(Array.isArray(action.queries) ? action.queries : []),
  ]
    .filter((q): q is string => typeof q === 'string')
    .slice(0, 20)
    .map((q) => q.slice(0, 500));
  const sources = (Array.isArray(action.sources) ? action.sources : [])
    .map((s) =>
      s && typeof s === 'object' ? (s as Record<string, unknown>).url : null,
    )
    .filter(
      (u): u is string =>
        typeof u === 'string' && u.length <= 4000 && /^https?:\/\//i.test(u),
    )
    .slice(0, 100);
  return {
    id: str(it.id, 200),
    status: str(it.status, 40),
    action: str(action.type, 40),
    queries,
    sources,
  };
}

export async function callPlanResponses(
  o: PlanCallInput,
): Promise<PlanObservedOutcome> {
  if (!o.web_search) return streamPlanResponses(o, null);
  const invalid = checkPlanWebSearch(o.web_search);
  if (invalid)
    return {
      kind: 'rejected',
      reason_code: 'invalid_web_search',
      message: invalid,
      response_id: null,
      output_chars: null,
      retry_allowed: false,
      search_calls: [],
    };
  const calls: PlanSearchCall[] = [];
  const out = await streamPlanResponses(o, calls);
  return { ...out, search_calls: calls };
}

async function streamPlanResponses(
  o: PlanCallInput,
  calls: PlanSearchCall[] | null,
): Promise<PlanObservedOutcome> {
  const seen = new Set<string>();
  /** Records a search call once; true when it goes past the caller's cap. */
  const record = (item: unknown): boolean => {
    if (!calls) return false;
    const c = searchCallOf(item);
    if (!c) return false;
    if (c.id) {
      const prior = seen.has(c.id);
      seen.add(c.id);
      if (prior) {
        const i = calls.findIndex((x) => x.id === c.id);
        if (i >= 0 && c.sources.length >= calls[i]!.sources.length)
          calls[i] = c;
        return false;
      }
    }
    calls.push(c);
    return calls.length > (o.web_search?.max_calls ?? Infinity);
  };
  if (o.signal?.aborted)
    return {
      kind: 'rejected',
      reason_code: 'cancelled_before_dispatch',
      message: 'Request cancelled before dispatch.',
      response_id: null,
      output_chars: null,
      retry_allowed: false,
    };
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(new Error('timeout')),
    o.timeout_ms,
  );
  const onAbort = () => controller.abort(o.signal?.reason);
  o.signal?.addEventListener('abort', onAbort, { once: true });
  let responseId: string | null = null;
  let text = '';
  try {
    let res: Response;
    try {
      res = await (o.fetchImpl ?? fetch)(`${o.api_base}/responses`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${o.access_token}`,
        },
        body: JSON.stringify(
          planRequestBody(o.model, o.instructions, o.input, o.web_search),
        ),
        redirect: 'manual',
        signal: controller.signal,
      });
    } catch {
      // The request may have reached the provider before the connection failed.
      return {
        kind: 'unknown',
        reason_code: 'network_error',
        message: 'Connection failed.',
        response_id: null,
        output_chars: null,
        retry_allowed: false,
      };
    }
    const requestId = res.headers.get('x-request-id');
    if (res.status !== 200) {
      let body: unknown = null;
      try {
        body = await res.json();
      } catch {
        body = null;
      }
      const { code, param } = errorParts(body);
      return {
        kind: 'rejected',
        message: `Plan request refused before streaming (${res.status}).`,
        response_id: requestId,
        output_chars: null,
        ...classifyPlanError(res.status, code, param),
      };
    }
    if (!res.body)
      return {
        kind: 'unknown',
        reason_code: 'no_stream',
        message: 'No response stream.',
        response_id: requestId,
        output_chars: null,
        retry_allowed: false,
      };
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = '';
    let previousCR = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      // Normalize SSE line endings across arbitrary transport chunks. A CR is
      // one newline; its optional following LF must not become a blank line.
      for (const ch of value) {
        if (ch === '\n' && previousCR) {
          previousCR = false;
          continue;
        }
        previousCR = ch === '\r';
        buf += previousCR ? '\n' : ch;
      }
      let sep: number;
      while ((sep = buf.indexOf('\n\n')) >= 0) {
        const block = buf.slice(0, sep);
        buf = buf.slice(sep + 2);
        const data = block
          .split('\n')
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).trimStart())
          .join('\n');
        if (!data || data === '[DONE]') continue;
        let ev: Record<string, unknown>;
        try {
          ev = JSON.parse(data) as Record<string, unknown>;
        } catch {
          continue;
        }
        const response = (ev.response ?? {}) as Record<string, unknown>;
        if (typeof response.id === 'string')
          responseId = response.id.slice(0, 200);
        switch (ev.type) {
          case 'response.output_item.added':
          case 'response.output_item.done':
            if (record(ev.item)) {
              controller.abort(new Error('search cap'));
              await reader.cancel().catch(() => {});
              // The extra search may already have run and counted against plan usage.
              return {
                kind: 'unknown',
                reason_code: 'studio_search_cap',
                message: `The studio ended the stream after more than ${o.web_search!.max_calls} search calls.`,
                response_id: responseId,
                output_chars: text.length,
                retry_allowed: false,
              };
            }
            break;
          case 'response.output_text.delta':
            if (typeof ev.delta === 'string') text += ev.delta;
            if (text.length > o.max_output_chars) {
              controller.abort(new Error('output cap'));
              await reader.cancel().catch(() => {});
              return {
                kind: 'failed',
                reason_code: 'studio_output_cap',
                message: 'The studio ended the stream at the output cap.',
                response_id: responseId,
                output_chars: text.length,
                retry_allowed: false,
              };
            }
            break;
          case 'response.completed': {
            const usage = (response.usage ?? {}) as Record<string, unknown>;
            const out = Number(usage.output_tokens);
            if (!text) text = completedText(response);
            if (calls && Array.isArray(response.output))
              for (const item of response.output) record(item);
            if (text.length > o.max_output_chars) {
              controller.abort(new Error('output cap'));
              await reader.cancel().catch(() => {});
              return {
                kind: 'failed',
                reason_code: 'studio_output_cap',
                message: 'The studio ended the stream at the output cap.',
                response_id: responseId,
                output_chars: text.length,
                retry_allowed: false,
              };
            }
            await reader.cancel().catch(() => {});
            return {
              kind: 'completed',
              text,
              output_chars: text.length,
              output_tokens: Number.isSafeInteger(out) && out >= 0 ? out : null,
              response_id: responseId,
              output_hash: sha(text),
            };
          }
          case 'response.incomplete':
            await reader.cancel().catch(() => {});
            return {
              kind: 'failed',
              reason_code: 'incomplete',
              message: 'The response was incomplete.',
              response_id: responseId,
              output_chars: text.length,
              retry_allowed: false,
            };
          case 'response.failed':
          case 'error': {
            const err = (response.error ?? ev.error ?? ev) as Record<
              string,
              unknown
            >;
            const code = typeof err.code === 'string' ? err.code : null;
            const param = typeof err.param === 'string' ? err.param : null;
            await reader.cancel().catch(() => {});
            return {
              kind: 'failed',
              message: 'The response failed after streaming began.',
              response_id: responseId,
              output_chars: text.length,
              ...classifyPlanError(0, code ?? 'response_failed', param),
            };
          }
        }
      }
    }
    return {
      kind: 'unknown',
      reason_code: 'stream_interrupted',
      message: 'The stream ended without response.completed.',
      response_id: responseId,
      output_chars: text.length,
      retry_allowed: false,
    };
  } catch (e) {
    const timedOut = controller.signal.aborted && !o.signal?.aborted;
    return {
      kind: 'unknown',
      reason_code: timedOut
        ? 'timeout'
        : o.signal?.aborted
          ? 'cancelled'
          : 'stream_error',
      message: e instanceof Error ? e.message.slice(0, 200) : 'Stream failed.',
      response_id: responseId,
      output_chars: text.length,
      retry_allowed: false,
    };
  } finally {
    clearTimeout(timer);
    o.signal?.removeEventListener('abort', onAbort);
  }
}

function completedText(response: Record<string, unknown>): string {
  let t = '';
  for (const item of (Array.isArray(response.output)
    ? response.output
    : []) as Record<string, unknown>[])
    if (item?.type === 'message' && Array.isArray(item.content))
      for (const part of item.content as Record<string, unknown>[])
        if (part?.type === 'output_text' && typeof part.text === 'string')
          t += part.text;
  return t;
}
