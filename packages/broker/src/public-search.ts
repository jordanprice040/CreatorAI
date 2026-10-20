import { createHash } from 'node:crypto';
import { ContractError, type SourcePolicy } from '@creator/contracts';
import { checkUrl, sourcePolicyHash } from '@creator/domain';
import {
  usage,
  type AdapterOutcome,
  type AdapterRequest,
  type ModelAdapter,
} from './adapters.js';

export const BRAVE_SEARCH_ID = 'brave-web-search-v1';
const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const unknown = (
  reason_code: 'network_error' | 'provider_error' | 'malformed_response',
): AdapterOutcome => ({
  kind: 'unknown',
  reason_code,
  message: 'Search outcome or billing is uncertain; reconcile before retrying.',
});
const rejected = (message: string): AdapterOutcome => ({
  kind: 'rejected',
  reason_code: 'invalid_request',
  retry_after_ms: null,
  message,
});

/** Raw indexed discovery results only. No source passage or claim is created here. */
export class BraveSearchAdapter implements ModelAdapter {
  readonly provider = 'brave' as const;
  readonly model_id = BRAVE_SEARCH_ID;
  readonly live = true;
  readonly #key: string;
  constructor(
    key: string,
    private readonly policy: SourcePolicy,
    private readonly transport: typeof fetch = fetch,
  ) {
    if (!key || /[\r\n]/.test(key))
      throw new Error('A valid Brave secret reference is required.');
    this.#key = key;
  }
  toJSON() {
    return { provider: this.provider, model_id: this.model_id, live: true };
  }

  async call(
    req: AdapterRequest,
    signal: AbortSignal,
  ): Promise<AdapterOutcome> {
    if (
      req.action !== 'tool.search_public' ||
      req.tool !== 'search_public' ||
      req.model_id !== this.model_id
    )
      return rejected('This adapter supports only its public-search tool.');
    let query: string;
    let domains: string[];
    try {
      if (req.input.length !== 1 || req.input[0]?.role !== 'user')
        throw new Error();
      const body = JSON.parse(req.input[0].text) as Record<string, unknown>;
      if (
        Object.keys(body).some((k) => !['query', 'domains'].includes(k)) ||
        typeof body.query !== 'string' ||
        !body.query.trim() ||
        body.query.length > 300 ||
        !Array.isArray(body.domains) ||
        !body.domains.length ||
        body.domains.length > 5
      )
        throw new Error();
      query = body.query.trim();
      domains = body.domains.map((d) => {
        if (
          typeof d !== 'string' ||
          !/^[a-z0-9]+(?:[.-][a-z0-9]+)*\.[a-z]{2,}$/.test(d) ||
          !checkUrl(`https://${d}/`, this.policy).ok
        )
          throw new Error();
        return d;
      });
    } catch {
      return rejected(
        'Supply one user JSON object with query and 1–5 approved exact domains.',
      );
    }
    if (signal.aborted) return unknown('network_error');
    const url = new URL(ENDPOINT);
    const sentQuery = `(${query}) (${domains.map((d) => `site:${d}`).join(' OR ')})`;
    if (sentQuery.length > 400)
      return rejected('Query plus approved domains exceeds 400 characters.');
    url.search = new URLSearchParams({
      q: sentQuery,
      count: '10',
      result_filter: 'web',
      text_decorations: 'false',
      spellcheck: 'false',
      safesearch: 'strict',
    }).toString();
    let response: Response;
    try {
      response = await this.transport(url, {
        headers: {
          Accept: 'application/json',
          'X-Subscription-Token': this.#key,
        },
        signal,
        redirect: 'manual',
      });
    } catch {
      return unknown('network_error');
    }
    // No documented no-charge guarantee is assumed for provider errors, including 429.
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      return {
        kind: 'unknown',
        reason_code: 'provider_error',
        message: `Search returned HTTP ${response.status}; billing is uncertain. Reconcile before retrying.`,
      };
    }
    try {
      if (!response.body) return unknown('malformed_response');
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let bytes = 0;
      while (true) {
        const part = await reader.read();
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > 1_000_000) {
          await reader.cancel();
          return unknown('malformed_response');
        }
        chunks.push(part.value);
      }
      const raw = Buffer.concat(chunks);
      const body = JSON.parse(raw.toString('utf8')) as {
        web?: { results?: unknown };
      };
      if (!Array.isArray(body.web?.results))
        return unknown('malformed_response');
      const results = body.web.results
        .slice(0, 10)
        .flatMap((row: unknown, rank: number) => {
          if (!row || typeof row !== 'object') return [];
          const r = row as Record<string, unknown>;
          if (
            typeof r.url !== 'string' ||
            r.url.length > 4000 ||
            typeof r.title !== 'string'
          )
            return [];
          const verdict = checkUrl(r.url, this.policy);
          if (!verdict.ok || !domains.includes(verdict.url.hostname)) return [];
          return [
            {
              rank: rank + 1,
              title: r.title.slice(0, 500),
              url: verdict.url.toString(),
              snippet:
                typeof r.description === 'string'
                  ? r.description.slice(0, 2000)
                  : null,
              evidence_status: 'unverified_search_snippet',
            },
          ];
        });
      return {
        kind: 'completed',
        response_id: null,
        vector: null,
        incomplete_reason: null,
        usage: usage(0, 0, { search_public: 1 }),
        text: JSON.stringify({
          version: 'public-search/1',
          provider: this.provider,
          endpoint: ENDPOINT,
          query,
          sent_query: sentQuery,
          domains,
          policy_hash: sourcePolicyHash(this.policy),
          retrieved_at: new Date().toISOString(),
          response_hash: createHash('sha256').update(raw).digest('hex'),
          results,
          warning:
            'Discovery only. Fetch each URL through SourceBroker before quoting or supporting a claim.',
        }),
      };
    } catch {
      return unknown('malformed_response');
    }
  }
}

export function publicSearchFromEnv(
  env: Record<string, string | undefined>,
  policy: SourcePolicy | null,
) {
  const mode = env.CREATOR_PUBLIC_SEARCH ?? 'off';
  if (mode === 'off') return null;
  if (mode !== 'brave' || !policy || !env.CREATOR_BRAVE_SEARCH_API_KEY)
    throw new ContractError(
      'INVALID_CONFIG',
      'Brave search needs an approved live source policy and CREATOR_BRAVE_SEARCH_API_KEY secret reference.',
    );
  return new BraveSearchAdapter(env.CREATOR_BRAVE_SEARCH_API_KEY, policy);
}
