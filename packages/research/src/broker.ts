import { createHash } from 'node:crypto';
import {
  ContractError,
  SOURCE_POLICY_VERSION,
  SourceFetchRequestSchema,
  SourcePolicySchema,
  parse,
  type Retention,
  type Retrieval,
  type SourcePolicy,
} from '@creator/contracts';
import {
  canonicalHash,
  checkUrl,
  classifyStatus,
  sourcePolicyHash,
  urlKey,
} from '@creator/domain';
import type {
  CommandContext,
  ResearchStore,
  RetrievalFinish,
} from '@creator/db';
import { HttpFetchAdapter, type SourceAdapter } from './adapters.js';
import { extractDocument } from './extract.js';

const sha256 = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
const NO_POLICY_HASH = sha256('no source policy configured');

/**
 * The one application path from a run to a web page. Order for every fetch: the URL is checked
 * against the owner-approved policy; admission (T03) and an in-flight record commit together;
 * only then is the adapter contacted, one hop at a time, with every redirect target re-checked;
 * the outcome is recorded once. Retrieved text is stored as evidence and is never executed,
 * followed or treated as instructions, so a page cannot cause any further action.
 */
export class SourceBroker {
  readonly #inflight = new Map<string, Set<AbortController>>();
  cancelRun(runId: string): number {
    const active = this.#inflight.get(runId.toLowerCase());
    if (!active) return 0;
    for (const controller of active)
      controller.abort(new Error('run cancelled'));
    return active.size;
  }
  constructor(
    private readonly store: ResearchStore,
    private readonly adapters: {
      fixture: SourceAdapter;
      live: SourceAdapter | null;
    },
    private readonly policies: {
      fixture: SourcePolicy;
      live: SourcePolicy | null;
    },
  ) {
    if (adapters.fixture.kind !== 'fixture')
      throw new Error('The fixture slot must hold the fixture adapter.');
    if (adapters.live && adapters.live.kind !== 'http')
      throw new Error('The live slot must hold a live adapter.');
    if ((adapters.live === null) !== (policies.live === null))
      throw new Error('A live adapter needs a live policy, and only then.');
  }

  get liveConfigured() {
    return this.adapters.live !== null;
  }
  get livePolicy() {
    return this.policies.live;
  }

  async fetch(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<Retrieval> {
    const req = parse(SourceFetchRequestSchema, raw);
    const fixture = await this.store.isFixtureWorkspace(ctx, ws);
    // Never a fallback: a real workspace without a live adapter is denied, not served fixtures.
    const adapter = fixture ? this.adapters.fixture : this.adapters.live;
    const policy = fixture ? this.policies.fixture : this.policies.live;
    const verdict = policy ? checkUrl(req.url, policy) : null;
    const begun = await this.store.beginRetrieval(ctx, ws, runId, req, {
      requestHash: canonicalHash({ run_id: runId.toLowerCase(), request: req }),
      policyHash: policy ? sourcePolicyHash(policy) : NO_POLICY_HASH,
      adapter: adapter?.kind ?? 'none',
      urlKey: verdict?.ok ? urlKey(verdict.url.toString()) : req.url,
      block:
        verdict && !verdict.ok
          ? {
              reason_code: verdict.reason_code,
              explanation: verdict.explanation,
            }
          : null,
      maxFetchesPerRun: policy?.max_fetches_per_run ?? 0,
      staleAfterMs: (policy?.timeout_ms ?? 60_000) * 2 + 60_000,
    });
    if (begun.kind === 'done') return begun.retrieval;
    if (!adapter || !policy || !verdict?.ok)
      throw new Error('unreachable: admitted fetch without adapter or policy');
    const controller = new AbortController();
    const key = runId.toLowerCase();
    const active = this.#inflight.get(key) ?? new Set<AbortController>();
    active.add(controller);
    this.#inflight.set(key, active);
    let finish: RetrievalFinish;
    try {
      finish = await this.run(
        adapter,
        policy,
        verdict.url,
        verdict.retention,
        begun.prior,
        controller,
      );
    } catch {
      finish = {
        state: 'failed',
        reason_code: 'adapter_error',
        explanation: 'The source adapter failed before a usable outcome.',
        final_url: null,
        redirects: [],
        http_status: null,
        content_type: null,
        bytes: null,
        content_hash: null,
      };
    } finally {
      active.delete(controller);
      if (!active.size) this.#inflight.delete(key);
    }
    return this.store.finishRetrieval(ctx, begun.retrieval.id, finish);
  }

  private async run(
    adapter: SourceAdapter,
    policy: SourcePolicy,
    start: URL,
    startRetention: Retention,
    prior: number,
    controller: AbortController,
  ): Promise<RetrievalFinish> {
    const timer = setTimeout(
      () => controller.abort(new Error('fetch time limit')),
      policy.timeout_ms,
    );
    const redirects: { url: string; status: number }[] = [];
    let url = start;
    let retention = startRetention;
    const stop = (
      state: 'blocked' | 'failed' | 'too_large' | 'unsupported_type',
      reason_code: string,
      explanation: string,
      extra: Partial<{
        http_status: number;
        content_type: string | null;
        bytes: number;
        content_hash: string;
        final_url: string;
      }> = {},
    ): RetrievalFinish => ({
      state,
      reason_code,
      explanation,
      final_url: extra.final_url ?? null,
      redirects,
      http_status: extra.http_status ?? null,
      content_type: extra.content_type ?? null,
      bytes: extra.bytes ?? null,
      content_hash: extra.content_hash ?? null,
    });
    try {
      for (let hop = 0; ; hop += 1) {
        const out = await adapter.fetchHop({
          url,
          signal: controller.signal,
          maxBytes: policy.max_bytes,
          prior,
        });
        if (
          controller.signal.aborted &&
          controller.signal.reason instanceof Error &&
          controller.signal.reason.message === 'run cancelled'
        )
          return stop(
            'failed',
            'run_cancelled',
            'Source retrieval stopped because the run was cancelled.',
          );
        if (out.kind === 'blocked')
          return stop('blocked', out.reason_code, out.explanation);
        if (out.kind === 'error')
          return stop('failed', out.reason_code, out.explanation);
        const final_url = url.toString();
        const content_type = out.content_type;
        const http_status = out.status;
        const cls = classifyStatus(out.status);
        if (cls === 'redirect') {
          redirects.push({ url: final_url, status: out.status });
          if (!out.location)
            return stop(
              'failed',
              'redirect_without_location',
              'The server redirected without saying where.',
              { http_status },
            );
          if (hop >= policy.max_redirects)
            return stop(
              'blocked',
              'too_many_redirects',
              `More than ${policy.max_redirects} redirects.`,
              { http_status },
            );
          let next: string;
          try {
            next = new URL(out.location, url).toString();
          } catch {
            return stop(
              'blocked',
              'malformed_redirect',
              'The redirect target is not a valid URL.',
              { http_status },
            );
          }
          const verdict = checkUrl(next, policy);
          if (!verdict.ok)
            return stop(
              'blocked',
              verdict.reason_code,
              `Refused redirect to ${next.slice(0, 300)}: ${verdict.explanation}`,
              { http_status },
            );
          url = verdict.url;
          retention = verdict.retention;
          continue;
        }
        if (cls === 'inaccessible' || cls === 'removed')
          return {
            state: cls,
            final_url,
            redirects,
            http_status,
            content_type,
            retention,
            reason_code: `http_${out.status}`,
            explanation:
              cls === 'inaccessible'
                ? `The server refused access (HTTP ${out.status}); the content was not read.`
                : `The page is gone (HTTP ${out.status}).`,
          };
        if (cls === 'failed')
          return stop(
            'failed',
            `http_${out.status}`,
            `The server answered HTTP ${out.status}; nothing was recorded as content.`,
            { http_status, content_type, final_url },
          );
        if (out.truncated)
          return stop(
            'too_large',
            'byte_limit',
            `The response exceeded ${policy.max_bytes} bytes; reading stopped and nothing was kept.`,
            { http_status, content_type, final_url },
          );
        const content_hash = sha256(out.body);
        const bytes = out.body.length;
        const media = content_type?.split(';')[0]?.trim().toLowerCase() ?? '';
        if (out.content_encoding && out.content_encoding !== 'identity')
          return stop(
            'unsupported_type',
            'content_encoding',
            `Encoded responses (${out.content_encoding.slice(0, 40)}) are not decoded.`,
            { http_status, content_type, final_url, bytes, content_hash },
          );
        if (!(policy.content_types as string[]).includes(media))
          return stop(
            'unsupported_type',
            'content_type',
            `${media || 'An unlabeled response'} is not an allowed content type; only its hash was kept.`,
            { http_status, content_type, final_url, bytes, content_hash },
          );
        return {
          state: 'fetched',
          final_url,
          redirects,
          http_status,
          content_type: content_type ?? media,
          bytes,
          content_hash,
          retention,
          doc: extractDocument(out.body, content_type, url),
          max_passages: policy.max_passages,
          max_excerpt_chars: policy.max_excerpt_chars,
        };
      }
    } finally {
      clearTimeout(timer);
    }
  }
}

const list = (v: string | undefined) =>
  (v ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean);
/**
 * A live fetch adapter exists only when the owner opts in and names the approved hosts. The
 * policy is still enforced per hop, and each fetch still needs a covering grant.
 */
export function sourceConfigFromEnv(env: Record<string, string | undefined>): {
  adapter: SourceAdapter | null;
  policy: SourcePolicy | null;
} {
  const mode = env.CREATOR_SOURCE_FETCH ?? 'off';
  if (mode === 'off') return { adapter: null, policy: null };
  if (mode !== 'live')
    throw new ContractError(
      'INVALID_CONFIG',
      'CREATOR_SOURCE_FETCH must be off or live.',
    );
  const hashOnly = list(env.CREATOR_SOURCE_HASH_ONLY_HOSTS);
  const hosts = list(env.CREATOR_SOURCE_HOSTS);
  if (!hosts.length && !hashOnly.length)
    throw new ContractError(
      'INVALID_CONFIG',
      'CREATOR_SOURCE_FETCH=live needs CREATOR_SOURCE_HOSTS (comma-separated approved hosts).',
    );
  const policy = parse(
    SourcePolicySchema,
    {
      version: SOURCE_POLICY_VERSION,
      protocols: ['https'],
      ports: [443],
      // Hash-only rules come first so a host listed in both keeps no excerpts.
      hosts: [
        ...hashOnly.map((host) => ({ host, retention: 'hash_only' })),
        ...hosts.map((host) => ({ host, retention: 'excerpts' })),
      ],
      max_bytes: 2_000_000,
      timeout_ms: 15_000,
      max_redirects: 3,
      content_types: ['text/html', 'application/xhtml+xml', 'text/plain'],
      max_passages: 200,
      max_excerpt_chars: 1000,
      max_fetches_per_run: 100,
    },
    'INVALID_CONFIG',
  );
  return { adapter: new HttpFetchAdapter(), policy };
}
