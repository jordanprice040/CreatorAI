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

export function planRequestBody(
  model: string,
  instructions: string,
  input: string,
) {
  return {
    model,
    instructions,
    input: [{ role: 'user', content: input }],
    store: false,
    stream: true,
  };
}

export async function callPlanResponses(
  o: PlanCallInput,
): Promise<PlanObservedOutcome> {
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
        body: JSON.stringify(planRequestBody(o.model, o.instructions, o.input)),
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
