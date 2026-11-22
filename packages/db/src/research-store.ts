import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  ChangeEvidenceSitesRequestSchema,
  ClaimSupportRequestSchema,
  FileSourceRequestSchema,
  RetractSupportRequestSchema,
  SourceFetchRequestSchema,
  isAllowedLink,
  parse,
  type ClaimEvidence,
  type EvidenceSiteChange,
  type EvidenceSiteMode,
  type ClaimSupport,
  type ClaimSupportRequest,
  type FileSourceResult,
  type Passage,
  type Retention,
  type Retrieval,
  type RetrievalState,
  type SourceDetail,
  type SourceSummary,
  type StoredEntity,
  AUTOPILOT_QUOTE_CHECK_LABEL,
  SOURCE_MAX_PASSAGES,
  UPLOAD_PASSAGE_MAX_CHARS,
  UPLOAD_PASSAGE_TARGET_CHARS,
  uploadSourceUrl,
} from '@creator/contracts';
import {
  assessClaimEvidence,
  passageCheck,
  passageLabels,
  canonicalHash,
  looksLikeInstructions,
  quoteInPassage,
  uploadedTextPassages,
  urlKey,
} from '@creator/domain';
import { webDiscoveryFetchRefusal } from './web-discovery-gates.js';
import { WorkflowStore } from './workflow-store.js';
import {
  contentHashOf,
  fail,
  iso,
  isPgError,
  normalize,
  toEntity,
  uuid,
  validateBody,
  type CommandContext,
  type Row,
} from './store.js';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const DAY_MS = 86_400_000;

/** What the broker extracted from a fetched document; full text never reaches the database. */
export interface ExtractedDocument {
  title: string | null;
  published_at: string | null;
  canonical_url: string | null;
  text_hash: string;
  /** Hash of whitespace- and case-normalized text, used to find reposts. */
  fingerprint: string;
  /**
   * `boilerplate` (ADR-0086): page furniture (site chrome, text outside the marked article,
   * interface labels). Offsets and the text hash still cover every paragraph.
   */
  paragraphs: {
    text: string;
    start: number;
    end: number;
    boilerplate?: boolean;
  }[];
  instruction_like: boolean;
}
type Hop = { url: string; status: number };
export interface FetchMeta {
  requestHash: string;
  policyHash: string;
  adapter: 'fixture' | 'http' | 'none';
  urlKey: string;
  /** Set when the policy refused the requested URL before any admission or contact. */
  block: { reason_code: string; explanation: string } | null;
  maxFetchesPerRun: number;
  /** An in-flight attempt older than this is presumed lost (crash) when replayed or swept. */
  staleAfterMs: number;
  /**
   * ADR-0086: a page chosen by this web discovery. Its start is the owner's one approval for
   * its fetches, so the fetch is covered when the discovery is fetching and lists this URL.
   */
  webDiscoveryId?: string | null;
}
export type RetrievalFinish =
  | {
      state: 'fetched';
      final_url: string;
      redirects: Hop[];
      http_status: number;
      content_type: string;
      bytes: number;
      content_hash: string;
      retention: Retention;
      doc: ExtractedDocument;
      max_passages: number;
      max_excerpt_chars: number;
    }
  | {
      state: 'inaccessible' | 'removed';
      final_url: string;
      redirects: Hop[];
      http_status: number;
      content_type: string | null;
      retention: Retention;
      reason_code: string;
      explanation: string;
    }
  | {
      state: 'blocked' | 'failed' | 'too_large' | 'unsupported_type';
      final_url: string | null;
      redirects: Hop[];
      http_status: number | null;
      content_type: string | null;
      bytes: number | null;
      content_hash: string | null;
      reason_code: string;
      explanation: string;
    };
export type BeginResult =
  | { kind: 'done'; retrieval: Retrieval }
  | { kind: 'go'; retrieval: Retrieval; prior: number };

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
function toRetrieval(r: Row, replayed = false): Retrieval {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    fixture: Boolean(r.fixture),
    run_id: r.run_id ? String(r.run_id) : null,
    task_id: r.task_id ? String(r.task_id) : null,
    logical_operation_id: String(r.logical_operation_id),
    adapter: r.adapter as Retrieval['adapter'],
    policy_hash: String(r.policy_hash),
    requested_url: String(r.requested_url),
    final_url: r.final_url ? String(r.final_url) : null,
    redirects: (r.redirects as Hop[]) ?? [],
    state: r.state as RetrievalState,
    reason_code: String(r.reason_code),
    explanation: String(r.explanation),
    http_status: num(r.http_status),
    content_type: r.content_type ? String(r.content_type) : null,
    bytes: num(r.bytes),
    content_hash: r.content_hash ? String(r.content_hash) : null,
    text_hash: r.text_hash ? String(r.text_hash) : null,
    source_id: r.source_id ? String(r.source_id) : null,
    source_version: num(r.source_version),
    changed: r.changed === null ? null : Boolean(r.changed),
    instruction_like: Boolean(r.instruction_like),
    admission_id: r.admission_id ? String(r.admission_id) : null,
    decision_id: r.decision_id ? String(r.decision_id) : null,
    actor_id: String(r.actor_id),
    started_at: iso(r.started_at),
    finished_at: r.finished_at ? iso(r.finished_at) : null,
    replayed,
    file: r.file_id
      ? { id: String(r.file_id), version: Number(r.file_version) }
      : null,
  };
}
function toPassage(r: Row): Passage {
  return {
    id: String(r.id),
    source_id: String(r.source_id),
    source_version: Number(r.source_version),
    ordinal: Number(r.ordinal),
    locator: {
      kind: 'text_offsets/1',
      paragraph: Number(r.paragraph),
      start: Number(r.char_start),
      end: Number(r.char_end),
      text_hash: String(r.text_hash),
    },
    excerpt: r.excerpt === null ? null : String(r.excerpt),
    excerpt_truncated: Boolean(r.excerpt_truncated),
    passage_hash: String(r.passage_hash),
    instruction_like: Boolean(r.instruction_like),
    boilerplate: Boolean(r.boilerplate),
  };
}
function toSupport(r: Row): ClaimSupport {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    claim_id: String(r.claim_id),
    claim_version: Number(r.claim_version),
    source_id: String(r.source_id),
    source_version: Number(r.source_version),
    passage_id: r.passage_id ? String(r.passage_id) : null,
    stance: r.stance as ClaimSupport['stance'],
    support_type: (r.support_type ?? null) as ClaimSupport['support_type'],
    quote: r.quote === null ? null : String(r.quote),
    rationale: String(r.rationale),
    link_id: r.link_id ? String(r.link_id) : null,
    asserted_by: String(r.asserted_by),
    created_at: iso(r.created_at),
    retracted_at: r.retracted_at ? iso(r.retracted_at) : null,
    retraction_reason: r.retraction_reason ? String(r.retraction_reason) : null,
  };
}
/**
 * ADR-0134: the uploaded file (and its state now) behind a source's current version, as `up`
 * and `wf`; both null for fetched pages and for a purged file's `wf`.
 */
const UPLOAD_JOIN = `
  left join lateral (select u.file_id, u.file_version from source_retrievals u
    where u.source_id = rs.source_id and u.source_version = e.version and u.adapter = 'upload'
    order by u.started_at limit 1) up on true
  left join workspace_files wf on wf.id = up.file_id`;
const SUMMARY_SQL = `
  select rs.source_id, rs.url_key, rs.origin_cluster, rs.cluster_reason, rs.created_at as rs_created,
    e.version, e.fixture, e.title, e.body, e.status,
    (select count(*) from research_sources o
      where o.workspace_id = rs.workspace_id and o.origin_cluster = rs.origin_cluster) as cluster_size,
    lr.id as lr_id, lr.state as lr_state, lr.finished_at as lr_finished,
    (select max(f.finished_at) from source_retrievals f where f.source_id = rs.source_id
      and f.state = 'fetched' and f.content_hash = e.body->>'content_hash') as last_fetched_at,
    exists (select 1 from source_passages p where p.source_id = rs.source_id
      and p.source_version = e.version and p.instruction_like) as instruction_like,
    up.file_id, up.file_version, wf.current_version as file_current, wf.status as file_status
  from research_sources rs join entities e on e.id = rs.source_id
  ${UPLOAD_JOIN}
  left join lateral (select x.id, x.state, x.finished_at from source_retrievals x
    where x.source_id = rs.source_id and x.finished_at is not null
    order by x.finished_at desc, x.started_at desc limit 1) lr on true
  where rs.workspace_id = $1 and e.status <> 'redacted'`;
function toSummary(r: Row): SourceSummary {
  const body = r.body as Row;
  const retrieval = (body.retrieval ?? {}) as Row;
  return {
    id: String(r.source_id),
    version: Number(r.version),
    fixture: Boolean(r.fixture),
    title: String(r.title),
    url: String(body.url),
    retrieval_status:
      body.retrieval_status as SourceSummary['retrieval_status'],
    content_hash: (body.content_hash as string | null) ?? null,
    published_at: (body.published_at as string | null) ?? null,
    retention: (retrieval.retention as Retention | undefined) ?? 'excerpts',
    origin_cluster: String(r.origin_cluster),
    cluster_reason: String(r.cluster_reason),
    cluster_size: Number(r.cluster_size),
    last_fetched_at: r.last_fetched_at ? iso(r.last_fetched_at) : null,
    latest_retrieval: r.lr_id
      ? {
          id: String(r.lr_id),
          state: r.lr_state as RetrievalState,
          finished_at: iso(r.lr_finished),
        }
      : null,
    instruction_like: Boolean(r.instruction_like),
    upload: r.file_id
      ? {
          file_id: String(r.file_id),
          file_version: Number(r.file_version),
          file_current_version: r.file_current ? Number(r.file_current) : null,
          file_status: (r.file_status ?? 'purged') as
            'active' | 'deleted' | 'purged',
        }
      : null,
  };
}

/**
 * T06 storage: retrieval attempts, broker-written source versions, passages and claim
 * support. Admission for each fetch commits with its in-flight row; the network call happens
 * between transactions, and its outcome is recorded exactly once.
 */
export class ResearchStore extends WorkflowStore {
  async beginRetrieval(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
    meta: FetchMeta,
  ): Promise<BeginResult> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(SourceFetchRequestSchema, raw);
    const op = req.logical_operation_id.toLowerCase();
    const replay = async (): Promise<BeginResult | null> => {
      const row = await this.tx(async (c) => {
        await this.role(c, ws, ctx.actorId, false);
        const { rows } = await c.query(
          'select * from source_retrievals where workspace_id = $1 and logical_operation_id = $2',
          [ws, op],
        );
        return rows[0] as Row | undefined;
      });
      if (!row) return null;
      if (row.request_hash !== meta.requestHash || String(row.run_id) !== runId)
        throw fail(
          'IDEMPOTENCY_CONFLICT',
          'This logical operation was already submitted with a different request.',
        );
      if (
        row.state === 'in_flight' &&
        Date.now() - Date.parse(iso(row.started_at)) > meta.staleAfterMs
      )
        return {
          kind: 'done',
          retrieval: {
            ...(await this.finishRetrieval(ctx, String(row.id), interrupted)),
            replayed: true,
          },
        };
      return { kind: 'done', retrieval: toRetrieval(row, true) };
    };
    const earlier = await replay();
    if (earlier) return earlier;
    try {
      return await this.tx(async (c) => {
        await this.role(c, ws, ctx.actorId, true);
        await this.lockRun(c, ws, runId);
        const insert = async (
          state: RetrievalState,
          reason: string,
          explanation: string,
          admission: { id: string | null; decision: string | null } = {
            id: null,
            decision: null,
          },
        ) => {
          const { rows } = await c.query(
            `insert into source_retrievals (id, workspace_id, fixture, run_id, task_id,
               logical_operation_id, request_hash, adapter, policy_hash, requested_url, url_key,
               state, reason_code, explanation, admission_id, decision_id, actor_id, finished_at)
             select $1, w.id, w.fixture, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
               case when $11 = 'in_flight' then null else now() end
             from workspaces w where w.id = $2 returning *`,
            [
              randomUUID(),
              ws,
              runId,
              req.task_id?.toLowerCase() ?? null,
              op,
              meta.requestHash,
              meta.adapter,
              meta.policyHash,
              req.url,
              meta.urlKey,
              state,
              reason,
              explanation.slice(0, 1200),
              admission.id,
              admission.decision,
              ctx.actorId,
            ],
          );
          const row = rows[0] as Row;
          if (state !== 'in_flight')
            await this.append(c, ctx, {
              workspaceId: ws,
              action: 'source.fetch_recorded',
              subjectKind: 'retrieval',
              subjectId: String(row.id),
              subjectVersion: null,
              contentHash: null,
              payload: { state, reason_code: reason },
              relatedIds: [runId],
            });
          return toRetrieval(row);
        };
        if (meta.block)
          return {
            kind: 'done' as const,
            retrieval: await insert(
              'blocked',
              meta.block.reason_code,
              meta.block.explanation,
            ),
          };
        if (meta.adapter === 'none')
          return {
            kind: 'done' as const,
            retrieval: await insert(
              'denied',
              'live_fetch_not_configured',
              'This real workspace has no configured live fetch adapter; fixture pages are never substituted.',
            ),
          };
        const used = await c.query<{ n: string }>(
          `select count(*) as n from source_retrievals where workspace_id = $1 and run_id = $2
             and state not in ('denied', 'needs_human', 'blocked')`,
          [ws, runId],
        );
        if (Number(used.rows[0]?.n ?? 0) >= meta.maxFetchesPerRun)
          return {
            kind: 'done' as const,
            retrieval: await insert(
              'denied',
              'fetch_limit_reached',
              `This run already used its ${meta.maxFetchesPerRun} fetches.`,
            ),
          };
        if (meta.webDiscoveryId) {
          const refused = await webDiscoveryFetchRefusal(
            c,
            ws,
            runId,
            ctx.actorId,
            meta.webDiscoveryId,
            req.url,
          );
          if (refused)
            return {
              kind: 'done' as const,
              retrieval: await insert('denied', refused.code, refused.text),
            };
          const retrieval = await insert(
            'in_flight',
            'admitted',
            `Covered by the owner's start of web discovery ${meta.webDiscoveryId.toLowerCase()}; fetching under the source policy.`,
          );
          const prior = await c.query<{ n: string }>(
            `select count(*) as n from source_retrievals where workspace_id = $1 and url_key = $2
               and state in ('fetched', 'inaccessible', 'removed')`,
            [ws, meta.urlKey],
          );
          return {
            kind: 'go' as const,
            retrieval,
            prior: Number(prior.rows[0]?.n ?? 0),
          };
        }
        // The URL hash rides in the binding's spec slot, so an approve-once grant covers
        // exactly this URL and nothing else.
        const admission = await this.admitIn(
          c,
          ctx,
          ws,
          runId,
          {
            action_type: 'source.fetch',
            task_id: req.task_id,
            target: null,
            spec_hash: sha256(meta.urlKey),
            amount_nano_usd: null,
            data_class: 'public',
            assumption_ids: [],
            humility_review: null,
            flags: [],
            justification: `Fetch ${meta.urlKey} — ${req.justification}`.slice(
              0,
              1200,
            ),
          },
          meta.urlKey,
        );
        if (admission.outcome !== 'admitted')
          return {
            kind: 'done' as const,
            retrieval: await insert(
              admission.outcome === 'denied' ? 'denied' : 'needs_human',
              admission.reason_code,
              admission.explanation,
              { id: admission.id, decision: admission.decision_id },
            ),
          };
        const retrieval = await insert(
          'in_flight',
          'admitted',
          'Admitted; fetching under the source policy.',
          { id: admission.id, decision: null },
        );
        const prior = await c.query<{ n: string }>(
          `select count(*) as n from source_retrievals where workspace_id = $1 and url_key = $2
             and state in ('fetched', 'inaccessible', 'removed')`,
          [ws, meta.urlKey],
        );
        return {
          kind: 'go' as const,
          retrieval,
          prior: Number(prior.rows[0]?.n ?? 0),
        };
      });
    } catch (e) {
      if (!isPgError(e, '23505')) throw e;
      const raced = await replay();
      if (!raced) throw e;
      return raced;
    }
  }

  /** Records the outcome of an in-flight retrieval once; a later call returns it unchanged. */
  async finishRetrieval(
    ctx: CommandContext,
    retrievalId: string,
    f: RetrievalFinish,
  ): Promise<Retrieval> {
    ctx = normalize(ctx);
    return this.tx(async (c) => {
      const { rows } = await c.query(
        'select * from source_retrievals where id = $1 for update',
        [uuid(retrievalId)],
      );
      const r = rows[0] as Row | undefined;
      if (!r) throw fail('NOT_FOUND', 'Retrieval not found.');
      if (r.state !== 'in_flight') return toRetrieval(r);
      const ws = String(r.workspace_id);
      const source =
        f.state === 'fetched' ||
        f.state === 'inaccessible' ||
        f.state === 'removed'
          ? await this.recordSource(c, ctx, ws, r, f)
          : null;
      const fetched = f.state === 'fetched' ? f : null;
      const reason = fetched
        ? source?.redacted
          ? 'source_redacted'
          : source?.changed
            ? 'new_version'
            : 'unchanged'
        : 'reason_code' in f
          ? f.reason_code
          : 'unknown';
      const explanation = fetched
        ? source?.redacted
          ? 'Fetched, but the source was redacted; no text was kept.'
          : source?.changed
            ? `Recorded source v${source.version} with ${Math.min(fetched.doc.paragraphs.length, fetched.max_passages)} passages.`
            : `Content matches source v${source?.version}; no new version.`
        : 'explanation' in f
          ? f.explanation
          : '';
      const updated = await c.query(
        `update source_retrievals set state = $2, reason_code = $3, explanation = $4,
           final_url = $5, redirects = $6, http_status = $7, content_type = $8, bytes = $9,
           content_hash = $10, text_hash = $11, source_id = $12, source_version = $13,
           changed = $14, instruction_like = $15, finished_at = now()
         where id = $1 returning *`,
        [
          r.id,
          f.state,
          reason,
          explanation.slice(0, 1200),
          f.final_url,
          JSON.stringify(f.redirects),
          f.http_status,
          f.content_type,
          'bytes' in f ? f.bytes : null,
          'content_hash' in f ? f.content_hash : null,
          fetched?.doc.text_hash ?? null,
          source?.id ?? null,
          source?.version ?? null,
          source ? source.changed : null,
          fetched?.doc.instruction_like ?? false,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'source.fetch_finished',
        subjectKind: 'retrieval',
        subjectId: String(r.id),
        subjectVersion: null,
        contentHash: 'content_hash' in f ? f.content_hash : null,
        payload: {
          state: f.state,
          reason_code: reason,
          http_status: f.http_status,
          changed: source?.changed ?? false,
        },
        relatedIds: [
          ...(r.run_id ? [String(r.run_id)] : []),
          ...(source ? [source.id] : []),
        ],
      });
      return toRetrieval(updated.rows[0] as Row);
    });
  }

  /** Finds or creates the source for the final URL and writes a version when it changed. */
  private async recordSource(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    r: Row,
    f: Extract<
      RetrievalFinish,
      { state: 'fetched' | 'inaccessible' | 'removed' }
    >,
    /** ADR-0134: the uploaded file this text came from, instead of a fetched page. */
    upload: { name: string; version: number; truncated: boolean } | null = null,
  ): Promise<{
    id: string;
    version: number;
    changed: boolean;
    redacted: boolean;
  }> {
    const key = urlKey(f.final_url);
    await c.query('select pg_advisory_xact_lock(hashtextextended($1, 6))', [
      `${ws} ${key}`,
    ]);
    const status =
      f.state === 'fetched'
        ? 'available'
        : f.state === 'inaccessible'
          ? 'inaccessible'
          : 'removed';
    const contentHash = f.state === 'fetched' ? f.content_hash : null;
    const doc = f.state === 'fetched' ? f.doc : null;
    const canonical =
      doc?.canonical_url && urlKey(doc.canonical_url) !== key
        ? urlKey(doc.canonical_url)
        : null;
    const existing = (
      await c.query(
        `select rs.origin_cluster, rs.cluster_reason, e.* from research_sources rs
           join entities e on e.id = rs.source_id
         where rs.workspace_id = $1 and rs.url_key = $2 for update of e`,
        [ws, key],
      )
    ).rows[0] as Row | undefined;
    let cluster = existing
      ? {
          id: String(existing.origin_cluster),
          reason: String(existing.cluster_reason),
        }
      : null;
    const sourceId = existing ? String(existing.id) : randomUUID();
    if (!cluster) {
      // Same normalized text, or one names the other (or the same page) as canonical: one origin.
      const match = (
        await c.query(
          `select source_id, origin_cluster, url_key, canonical_key, fingerprint
             from research_sources
           where workspace_id = $1 and (
             ($2::char(64) is not null and fingerprint = $2)
             or ($3::text is not null and (url_key = $3 or canonical_key = $3))
             or canonical_key = $4)
           order by created_at limit 1`,
          [ws, doc?.fingerprint ?? null, canonical, key],
        )
      ).rows[0] as Row | undefined;
      cluster = match
        ? {
            id: String(match.origin_cluster),
            reason:
              doc && match.fingerprint === doc.fingerprint
                ? `same text as ${String(match.url_key)}`
                : `canonical link shared with ${String(match.url_key)}`,
          }
        : { id: sourceId, reason: 'own origin' };
      cluster.reason = cluster.reason.slice(0, 500);
    }
    if (existing) {
      const current = toEntity(existing);
      if (current.status !== 'active')
        return {
          id: current.id,
          version: current.version,
          changed: false,
          redacted: current.status === 'redacted',
        };
      if (
        current.body?.content_hash === contentHash &&
        current.body?.retrieval_status === status
      )
        return {
          id: current.id,
          version: current.version,
          changed: false,
          redacted: false,
        };
    }
    const host = new URL(f.final_url);
    const title = (
      upload?.name ||
      doc?.title ||
      `${host.hostname}${host.pathname}`
    ).slice(0, 500);
    const body = validateBody('source', {
      url: f.final_url,
      retrieval_status: status,
      content_hash: contentHash,
      retrieved_at: new Date().toISOString(),
      published_at: doc?.published_at ?? null,
      independent_origin:
        `origin ${cluster.id.slice(0, 8)} (${cluster.reason})`.slice(0, 500),
      observation: upload
        ? `Uploaded file “${upload.name}” v${upload.version}: ${f.state === 'fetched' ? Math.min(f.doc.paragraphs.length, f.max_passages) : 0} passages from its text${upload.truncated ? ' (the file’s kept text was cut)' : ''}.`.slice(
            0,
            2000,
          )
        : f.state === 'fetched'
          ? `Fetched ${f.bytes} bytes of ${f.content_type}; ${Math.min(f.doc.paragraphs.length, f.max_passages)} passages extracted.`
          : `The server answered HTTP ${f.http_status}; the content was not readable.`,
      uncertainty: upload
        ? 'Shows what the uploaded document says; that does not make it true, and nobody outside checked where it came from.'
        : f.state === 'fetched'
          ? 'Shows what the page said when it was retrieved; that does not make it true.'
          : 'Nothing about the content is known beyond the server’s response.',
      retrieval: {
        retrieval_id: String(r.id),
        final_url: f.final_url,
        access: upload
          ? 'uploaded'
          : f.state === 'fetched'
            ? 'public'
            : f.state === 'inaccessible'
              ? 'restricted'
              : 'gone',
        extraction: f.state === 'fetched' ? 'extracted' : 'none',
        retention: f.retention,
        text_hash: doc?.text_hash ?? null,
        canonical_url: doc?.canonical_url ?? null,
        origin_cluster: cluster.id,
        policy_hash: String(r.policy_hash),
      },
    });
    let version: number;
    if (existing) {
      const updated = await this.writeVersion(c, ctx, toEntity(existing), {
        status: 'active',
        title,
        body,
        hash: contentHashOf('source', title, body),
        reason: upload
          ? `Used file version ${upload.version} as evidence.`
          : status === 'available'
            ? 'Re-fetched; the content changed.'
            : `Re-fetched; the page is now ${status}.`,
        corrects: null,
        action: 'entity.revised',
        payload: {},
      });
      version = updated.version;
    } else {
      await this.insertEntity(c, ctx, ws, 'source', title, body, sourceId);
      await c.query(
        `insert into research_sources (source_id, workspace_id, fixture, url_key, canonical_key,
           fingerprint, origin_cluster, cluster_reason)
         select $1, w.id, w.fixture, $3, $4, $5, $6, $7 from workspaces w where w.id = $2`,
        [
          sourceId,
          ws,
          key,
          canonical,
          doc?.fingerprint ?? null,
          cluster.id,
          cluster.reason,
        ],
      );
      version = 1;
    }
    if (f.state === 'fetched') {
      // ADR-0086 (walkthrough item 15): page text first, furniture only in the room left, so
      // a page's navigation and labels never use up its passage limit.
      const indexed = f.doc.paragraphs.map((p, paragraph) => ({
        ...p,
        paragraph,
      }));
      const passages = [
        ...indexed.filter((p) => !p.boilerplate),
        ...indexed.filter((p) => p.boilerplate),
      ]
        .slice(0, f.max_passages)
        .map((p, i) => ({
          id: randomUUID(),
          ordinal: i,
          paragraph: p.paragraph,
          boilerplate: Boolean(p.boilerplate),
          char_start: p.start,
          char_end: p.end,
          excerpt:
            f.retention === 'excerpts'
              ? p.text.slice(0, f.max_excerpt_chars)
              : null,
          excerpt_truncated:
            f.retention === 'excerpts' && p.text.length > f.max_excerpt_chars,
          passage_hash: sha256(p.text),
          instruction_like: looksLikeInstructions(p.text),
        }));
      await c.query(
        `insert into source_passages (id, workspace_id, source_id, source_version, ordinal,
           paragraph, char_start, char_end, text_hash, excerpt, excerpt_truncated, passage_hash,
           instruction_like, retrieval_id, boilerplate)
         select x.id, $1, $2, $3, x.ordinal, x.paragraph, x.char_start, x.char_end, $4,
           x.excerpt, x.excerpt_truncated, x.passage_hash, x.instruction_like, $5, x.boilerplate
         from jsonb_to_recordset($6::jsonb) as x(id uuid, ordinal int, paragraph int,
           char_start int, char_end int, excerpt text, excerpt_truncated boolean,
           passage_hash char(64), instruction_like boolean, boilerplate boolean)`,
        [
          ws,
          sourceId,
          version,
          f.doc.text_hash,
          r.id,
          JSON.stringify(passages),
        ],
      );
    }
    return { id: sourceId, version, changed: true, redacted: false };
  }

  /** Presumes in-flight attempts older than the limit lost (process crash) and closes them. */
  async sweepRetrievals(ctx: CommandContext, olderThanMs: number) {
    const { rows } = await this.pool.query<{ id: string }>(
      `select id from source_retrievals where state = 'in_flight'
         and started_at < now() - make_interval(secs => $1::double precision / 1000)`,
      [olderThanMs],
    );
    for (const r of rows) await this.finishRetrieval(ctx, r.id, interrupted);
    return rows.length;
  }

  async listRetrievals(
    ctx: CommandContext,
    ws: string,
    filter: { runId?: string } = {},
  ): Promise<Retrieval[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from source_retrievals where workspace_id = $1
           and ($2::uuid is null or run_id = $2) order by started_at desc limit 200`,
        [ws, filter.runId ? uuid(filter.runId) : null],
      );
      return rows.map((r: Row) => toRetrieval(r));
    });
  }

  async listSources(ctx: CommandContext, ws: string): Promise<SourceSummary[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(`${SUMMARY_SQL} order by rs.created_at`, [
        ws,
      ]);
      return rows.map((r: Row) => toSummary(r));
    });
  }

  async getSource(
    ctx: CommandContext,
    ws: string,
    sourceId: string,
  ): Promise<SourceDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    sourceId = uuid(sourceId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(`${SUMMARY_SQL} and rs.source_id = $2`, [
        ws,
        sourceId,
      ]);
      const row = rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Retrieved source not found.');
      const source = toSummary(row);
      const passages = await c.query(
        `select * from source_passages where source_id = $1 and source_version = $2
           order by ordinal`,
        [sourceId, source.version],
      );
      const retrievals = await c.query(
        `select * from source_retrievals where workspace_id = $1
           and (source_id = $2 or url_key = $3) order by started_at desc limit 200`,
        [ws, sourceId, row.url_key],
      );
      const same = await c.query(
        `select rs.source_id, rs.url_key from research_sources rs
           join entities e on e.id = rs.source_id
         where rs.workspace_id = $1 and rs.origin_cluster = $2 and rs.source_id <> $3
           and e.status <> 'redacted' order by rs.created_at`,
        [ws, source.origin_cluster, sourceId],
      );
      return {
        source,
        passages: passages.rows.map((p: Row) => toPassage(p)),
        retrievals: retrievals.rows.map((r: Row) => toRetrieval(r)),
        same_origin: same.rows.map((s: Row) => ({
          id: String(s.source_id),
          url: String(s.url_key),
        })),
      };
    });
  }

  /**
   * ADR-0134: makes the current version of an uploaded file a source, so claims can cite its
   * passages like a fetched page's. Nothing is fetched and no run or permission is used: the
   * text is the file's own kept text, read by an editor of the workspace. The same file always
   * maps to the same source; a newer file version writes a new source version, so support
   * cited from the old one shows as changed until it is re-assessed.
   */
  async sourceFromFile(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<FileSourceResult> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(FileSourceRequestSchema, raw);
    const fileId = req.file_id.toLowerCase();
    return this.idempotent(ws, ctx, { op: 'file_source', req }, async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const file = (
        await c.query(
          `select f.name, f.status, f.current_version, v.sha256, v.size_bytes, v.media_type,
               v.text_content, v.text_truncated
             from workspace_files f
               join workspace_file_versions v on v.file_id = f.id and v.version = $3
             where f.workspace_id = $1 and f.id = $2 for share of f`,
          [ws, fileId, req.file_version],
        )
      ).rows[0] as Row | undefined;
      if (!file) throw fail('NOT_FOUND', 'File version not found.');
      if (file.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          'This file is deleted; restore it before using it as evidence.',
        );
      if (Number(file.current_version) !== req.file_version)
        throw fail(
          'VERSION_CONFLICT',
          `The file is now at v${String(file.current_version)}; use that version.`,
        );
      if (file.text_content === null)
        throw fail(
          'INVALID_CONTRACT',
          'This file has no readable text to quote. Text, Markdown, CSV, JSON and code files can be used as evidence.',
        );
      const text = String(file.text_content);
      const split = uploadedTextPassages(text, {
        target: UPLOAD_PASSAGE_TARGET_CHARS,
        max: UPLOAD_PASSAGE_MAX_CHARS,
        maxPassages: SOURCE_MAX_PASSAGES,
      });
      if (!split.passages.length)
        throw fail('INVALID_CONTRACT', 'This file has no text to quote.');
      const url = uploadSourceUrl(fileId);
      const name = String(file.name);
      const truncated = Boolean(file.text_truncated);
      const started = (
        await c.query(
          `insert into source_retrievals (id, workspace_id, fixture, run_id, task_id,
               logical_operation_id, request_hash, adapter, policy_hash, requested_url, url_key,
               state, reason_code, explanation, actor_id, file_id, file_version)
             select $1, w.id, w.fixture, null, null, $3, $4, 'upload', $5, $6, $7,
               'in_flight', 'started', '', $8, $9, $10
             from workspaces w where w.id = $2 returning *`,
          [
            randomUUID(),
            ws,
            randomUUID(),
            canonicalHash({ op: 'file_source', file: fileId, req }),
            sha256('upload-evidence/1'),
            url,
            urlKey(url),
            ctx.actorId,
            fileId,
            req.file_version,
          ],
        )
      ).rows[0] as Row;
      const doc: ExtractedDocument = {
        title: name,
        published_at: null,
        canonical_url: null,
        text_hash: sha256(text),
        fingerprint: sha256(
          text
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim(),
        ),
        paragraphs: split.passages,
        instruction_like: split.passages.some((p) =>
          looksLikeInstructions(p.text),
        ),
      };
      const source = await this.recordSource(
        c,
        ctx,
        ws,
        started,
        {
          state: 'fetched',
          final_url: url,
          redirects: [],
          http_status: 0,
          content_type: String(file.media_type),
          bytes: Number(file.size_bytes),
          content_hash: String(file.sha256),
          retention: 'excerpts',
          doc,
          max_passages: SOURCE_MAX_PASSAGES,
          max_excerpt_chars: UPLOAD_PASSAGE_MAX_CHARS,
        },
        { name, version: req.file_version, truncated },
      );
      if (source.redacted)
        throw fail(
          'INVALID_TRANSITION',
          'The source made from this file was redacted; its text cannot be used again.',
        );
      const reason = source.changed ? 'new_version' : 'unchanged';
      await c.query(
        `update source_retrievals set state = 'fetched', reason_code = $2, explanation = $3,
             final_url = $4, content_type = $5, bytes = $6, content_hash = $7, text_hash = $8,
             source_id = $9, source_version = $10, changed = $11, instruction_like = $12,
             finished_at = now()
           where id = $1`,
        [
          started.id,
          reason,
          source.changed
            ? `Recorded source v${source.version} from file v${req.file_version} with ${split.passages.length} passages.`
            : `File v${req.file_version} is already source v${source.version}; no new version.`,
          url,
          String(file.media_type),
          Number(file.size_bytes),
          String(file.sha256),
          doc.text_hash,
          source.id,
          source.version,
          source.changed,
          doc.instruction_like,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'source.file_used',
        subjectKind: 'retrieval',
        subjectId: String(started.id),
        subjectVersion: null,
        contentHash: String(file.sha256),
        payload: {
          file_id: fileId,
          file_version: req.file_version,
          changed: source.changed,
          passages: split.passages.length,
        },
        relatedIds: [fileId, source.id],
      });
      const summary = (
        await c.query(`${SUMMARY_SQL} and rs.source_id = $2`, [ws, source.id])
      ).rows[0] as Row;
      const kept = Number(
        (
          await c.query(
            `select count(*) as n from source_passages
                where source_id = $1 and source_version = $2`,
            [source.id, source.version],
          )
        ).rows[0]?.n ?? 0,
      );
      return {
        source: toSummary(summary),
        changed: source.changed,
        passages: kept,
        partial: split.partial || truncated,
        retrieval_id: String(started.id),
      };
    });
  }

  /**
   * Records how one passage (or an inaccessible source) bears on the current claim version.
   * Supporting and contradicting rows must quote text that is actually in the stored passage
   * of the source's current version; nothing else can be cited.
   */
  async addClaimSupport(
    ctx: CommandContext,
    ws: string,
    claimId: string,
    raw: unknown,
  ): Promise<ClaimSupport> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    claimId = uuid(claimId);
    const req = parse(ClaimSupportRequestSchema, raw);
    try {
      return await this.idempotent(
        ws,
        ctx,
        { op: 'claim_support', claimId, req },
        async (c) => {
          await this.role(c, ws, ctx.actorId, true);
          return this.addClaimSupportIn(c, ctx, ws, claimId, req);
        },
      );
    } catch (e) {
      if (isPgError(e, '23505', 'claim_support_active'))
        throw fail(
          'DUPLICATE',
          'This evidence is already recorded for this claim version.',
        );
      throw e;
    }
  }

  /** One support row in the caller's transaction (ADR-0086 adds claims and support together). */
  protected async addClaimSupportIn(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    claimId: string,
    req: ClaimSupportRequest,
  ): Promise<ClaimSupport> {
    const claimRow = (
      await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'claim' for share`,
        [ws, claimId],
      )
    ).rows[0] as Row | undefined;
    if (!claimRow) throw fail('NOT_FOUND', 'Claim not found.');
    const claim = toEntity(claimRow);
    if (claim.status !== 'active')
      throw fail(
        'INVALID_TRANSITION',
        `A ${claim.status} claim takes no new evidence.`,
      );
    if (claim.version !== req.claim_version)
      throw fail(
        'VERSION_CONFLICT',
        `The claim is at v${claim.version}; assess that version.`,
      );
    let source: StoredEntity;
    let passage: Row | null = null;
    if (req.evidence === 'passage') {
      passage =
        ((
          await c.query(
            'select * from source_passages where workspace_id = $1 and id = $2',
            [ws, req.passage_id.toLowerCase()],
          )
        ).rows[0] as Row | undefined) ?? null;
      if (!passage) throw fail('NOT_FOUND', 'Passage not found.');
      source = await this.lockSource(c, ws, String(passage.source_id));
      if (Number(passage.source_version) !== source.version)
        throw fail(
          'VERSION_CONFLICT',
          `That passage is from source v${String(passage.source_version)}; the source is now v${source.version}. Assess the current version.`,
        );
      if (req.stance !== 'does_not_support') {
        if (passage.excerpt === null)
          throw fail(
            'EVIDENCE_MISMATCH',
            'No excerpt is kept for this passage (hash-only retention or redaction), so a quote cannot be verified.',
          );
        if (!quoteInPassage(String(passage.excerpt), req.quote ?? ''))
          throw fail(
            'EVIDENCE_MISMATCH',
            'The quote does not occur in the stored passage. Cite text the source actually contains.',
          );
      }
    } else {
      source = await this.lockSource(c, ws, req.source_id.toLowerCase());
      if (source.version !== req.source_version)
        throw fail('VERSION_CONFLICT', `The source is at v${source.version}.`);
      if (source.body?.retrieval_status === 'available')
        throw fail(
          'INVALID_CONTRACT',
          'This source is available; cite one of its passages instead.',
        );
    }
    const stance =
      req.evidence === 'passage' ? req.stance : ('inaccessible' as const);
    const linkId =
      stance === 'supports' || stance === 'contradicts'
        ? await this.linkIn(
            c,
            ctx,
            ws,
            stance,
            source,
            claim,
            req.rationale.slice(0, 500),
          )
        : null;
    const { rows } = await c.query(
      `insert into claim_support (id, workspace_id, claim_id, claim_version, source_id,
               source_version, passage_id, stance, support_type, quote, rationale, link_id, asserted_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
      [
        randomUUID(),
        ws,
        claim.id,
        claim.version,
        source.id,
        source.version,
        passage ? passage.id : null,
        stance,
        req.evidence === 'passage' ? req.support_type : null,
        req.evidence === 'passage' ? req.quote : null,
        req.rationale,
        linkId,
        ctx.actorId,
      ],
    );
    const support = toSupport(rows[0] as Row);
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'claim.support_recorded',
      subjectKind: 'claim_support',
      subjectId: support.id,
      subjectVersion: null,
      contentHash: null,
      payload: {
        stance,
        support_type: support.support_type,
        claim_version: claim.version,
        source_version: source.version,
      },
      relatedIds: [claim.id, source.id],
    });
    return support;
  }

  private async lockSource(c: PoolClient, ws: string, sourceId: string) {
    const row = (
      await c.query(
        `select e.* from research_sources rs join entities e on e.id = rs.source_id
         where rs.workspace_id = $1 and rs.source_id = $2 for share of e`,
        [ws, sourceId],
      )
    ).rows[0] as Row | undefined;
    if (!row) throw fail('NOT_FOUND', 'Retrieved source not found.');
    const source = toEntity(row);
    if (source.status !== 'active')
      throw fail(
        'INVALID_TRANSITION',
        `A ${source.status} source cannot be cited.`,
      );
    return source;
  }

  /** Reuses the active source→claim link at these exact versions, or creates it. */
  private async linkIn(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    relation: 'supports' | 'contradicts',
    from: StoredEntity,
    to: StoredEntity,
    rationale: string,
  ): Promise<string> {
    const found = await c.query<{ id: string }>(
      `select id from entity_links where workspace_id = $1 and relation = $2 and from_id = $3
         and from_version = $4 and to_id = $5 and to_version = $6 and retracted_at is null`,
      [ws, relation, from.id, from.version, to.id, to.version],
    );
    if (found.rows[0]) return found.rows[0].id;
    if (!isAllowedLink(relation, from, to))
      throw fail(
        'INVALID_CONTRACT',
        `${from.kind} cannot ${relation} ${to.kind}.`,
      );
    const linkId = randomUUID();
    await c.query(
      `insert into entity_links (id, workspace_id, relation, from_id, from_kind, from_version,
         to_id, to_kind, to_version, rationale, asserted_by)
       values ($1, $2, $3, $4, 'source', $5, $6, 'claim', $7, $8, $9)`,
      [
        linkId,
        ws,
        relation,
        from.id,
        from.version,
        to.id,
        to.version,
        rationale,
        ctx.actorId,
      ],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'link.created',
      subjectKind: 'link',
      subjectId: linkId,
      subjectVersion: null,
      contentHash: null,
      payload: {
        relation,
        from_kind: 'source',
        from_version: from.version,
        to_kind: 'claim',
        to_version: to.version,
      },
      relatedIds: [from.id, to.id],
    });
    return linkId;
  }

  async retractClaimSupport(
    ctx: CommandContext,
    ws: string,
    supportId: string,
    raw: unknown,
  ): Promise<ClaimSupport> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    supportId = uuid(supportId);
    const req = parse(RetractSupportRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const row = (
        await c.query(
          'select * from claim_support where workspace_id = $1 and id = $2 for update',
          [ws, supportId],
        )
      ).rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Claim evidence not found.');
      if (row.retracted_at)
        throw fail('INVALID_TRANSITION', 'Already retracted.');
      const { rows } = await c.query(
        `update claim_support set retracted_at = now(), retracted_by = $2, retraction_reason = $3
         where id = $1 returning *`,
        [supportId, ctx.actorId, req.reason],
      );
      if (row.link_id) {
        const others = await c.query(
          'select 1 from claim_support where link_id = $1 and retracted_at is null',
          [row.link_id],
        );
        if (others.rowCount === 0) {
          const link = await c.query(
            `update entity_links set retracted_at = now(), retracted_by = $2, retraction_reason = $3
             where id = $1 and retracted_at is null returning *`,
            [row.link_id, ctx.actorId, req.reason],
          );
          const l = link.rows[0] as Row | undefined;
          if (l)
            await this.append(c, ctx, {
              workspaceId: ws,
              action: 'link.retracted',
              subjectKind: 'link',
              subjectId: String(l.id),
              subjectVersion: null,
              contentHash: null,
              payload: {
                relation: l.relation,
                from_kind: l.from_kind,
                from_version: l.from_version,
                to_kind: l.to_kind,
                to_version: l.to_version,
              },
              relatedIds: [String(l.from_id), String(l.to_id)],
            });
        }
      }
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'claim.support_retracted',
        subjectKind: 'claim_support',
        subjectId: supportId,
        subjectVersion: null,
        contentHash: null,
        payload: {},
        relatedIds: [String(row.claim_id), String(row.source_id)],
      });
      return toSupport(rows[0] as Row);
    });
  }

  /** The claim's evidence now: freshness per row, origin clusters and an explicit status. */
  async claimEvidence(
    ctx: CommandContext,
    ws: string,
    claimId: string,
    maxAgeDays = 180,
  ): Promise<ClaimEvidence> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    claimId = uuid(claimId);
    if (!Number.isInteger(maxAgeDays) || maxAgeDays < 0 || maxAgeDays > 36500)
      throw fail('INVALID_CONTRACT', 'max_age_days must be 0–36500.');
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const claimRow = (
        await c.query(
          `select * from entities where workspace_id = $1 and id = $2 and kind = 'claim'`,
          [ws, claimId],
        )
      ).rows[0] as Row | undefined;
      if (!claimRow) throw fail('NOT_FOUND', 'Claim not found.');
      return this.claimEvidenceIn(c, ws, claimRow, maxAgeDays);
    });
  }

  /** claimEvidence inside the caller's transaction, for a claim row it already read. */
  protected async claimEvidenceIn(
    c: PoolClient,
    ws: string,
    claimRow: Row,
    maxAgeDays = 180,
  ): Promise<ClaimEvidence> {
    const claim = toEntity(claimRow);
    const claimId = claim.id;
    const { rows } = await c.query(
      `select cs.*, e.version as source_current_version, e.title as source_title,
         e.body as source_body, rs.origin_cluster, rs.url_key,
         (select x.state from source_retrievals x where x.source_id = cs.source_id
            and x.finished_at is not null order by x.finished_at desc, x.started_at desc
            limit 1) as latest_state,
         (select max(f.finished_at) from source_retrievals f where f.source_id = cs.source_id
            and f.state = 'fetched' and f.content_hash = e.body->>'content_hash') as last_fetched_at,
         nc.finished_at as last_checked_at,
         (nc.source_id is not null and nc.source_id <> cs.source_id) as moved,
         (select cp.passage_hash from source_passages cp where cp.id = cs.passage_id)
           as cited_passage_hash,
         case when cs.source_version <> e.version then
           array(select np.passage_hash from source_passages np where np.source_id = cs.source_id
             and np.source_version = e.version) end as current_hashes,
         case when cs.source_version <> e.version and cs.quote is not null then
           array(select np.excerpt from source_passages np where np.source_id = cs.source_id
             and np.source_version = e.version) end as current_excerpts,
         not exists (select 1 from source_passages xp where xp.source_id = cs.source_id
             and xp.source_version = e.version
             and (xp.excerpt is null or xp.excerpt_truncated)) as excerpts_complete,
         (select count(*) from source_passages cp2 where cp2.source_id = cs.source_id
             and cp2.source_version = e.version) as current_passages,
         up.file_id, up.file_version, wf.current_version as file_current,
         wf.status as file_status
       from claim_support cs
         join entities e on e.id = cs.source_id
         join research_sources rs on rs.source_id = cs.source_id
         ${UPLOAD_JOIN}
         -- F8: the newest check that reached the page, by the cited address or by the source
         -- (a cited address that now redirects is recorded under the target's source).
         left join lateral (select k.finished_at, k.source_id from source_retrievals k
           where k.workspace_id = cs.workspace_id
             and (k.url_key = rs.url_key or k.source_id = cs.source_id)
             and k.state in ('fetched', 'inaccessible', 'removed')
           order by k.finished_at desc, k.started_at desc limit 1) nc on true
       where cs.workspace_id = $1 and cs.claim_id = $2
       order by cs.created_at`,
      [ws, claimId],
    );
    const assessment = assessClaimEvidence({
      claim_version: claim.version,
      now: Date.now(),
      max_age_ms: maxAgeDays * DAY_MS,
      rows: rows.map((r: Row) => ({
        stance: r.stance as ClaimSupport['stance'],
        support_type: (r.support_type ?? null) as ClaimSupport['support_type'],
        claim_version: Number(r.claim_version),
        source_version: Number(r.source_version),
        source_current_version: Number(r.source_current_version),
        latest_state: (r.latest_state ?? null) as RetrievalState | null,
        last_fetched_at: r.last_fetched_at ? iso(r.last_fetched_at) : null,
        origin_cluster: String(r.origin_cluster),
        retracted: r.retracted_at !== null,
        // ADR-0134 review 1 M-2: the studio knows when an uploaded file changes.
        ...(r.file_id
          ? {
              file:
                r.file_status !== 'active'
                  ? ('gone' as const)
                  : Number(r.file_current) !== Number(r.file_version)
                    ? ('newer_version' as const)
                    : ('current' as const),
            }
          : {}),
      })),
    });
    // F8 (ADR-0126): what the newest check found for each cited passage; a flag only.
    const checks = rows.map((r: Row) =>
      passageCheck({
        latest_state: (r.latest_state ?? null) as RetrievalState | null,
        moved: Boolean(r.moved),
        source_version: Number(r.source_version),
        source_current_version: Number(r.source_current_version),
        cited_passage_hash: r.cited_passage_hash
          ? String(r.cited_passage_hash)
          : null,
        quote: r.quote === null ? null : String(r.quote),
        current_hashes: ((r.current_hashes ?? []) as string[]).map(String),
        current_excerpts: (r.current_excerpts ?? []) as (string | null)[],
        excerpts_complete: Boolean(r.excerpts_complete),
        passages_complete: Number(r.current_passages) < SOURCE_MAX_PASSAGES,
      }),
    );
    const flagged = passageLabels(
      checks.map((check, i) => ({
        check,
        freshness: assessment.rows[i]!.freshness,
      })),
    );
    const body = claim.body as Row | null;
    return {
      claim: {
        id: claim.id,
        version: claim.version,
        title: claim.title,
        statement: body ? String(body.statement) : null,
        basis: body ? (body.basis as 'observation' | 'inference') : null,
      },
      status: assessment.status,
      // P-12 (ADR-0100): a claim the autopilot accepted on its quote check alone says so
      // wherever it informs discovery, assessment or a proposal.
      labels: (
        await c.query(
          `select 1 from web_discovery_claims where claim_id = $1 and admitted_via = 'autopilot'
            limit 1`,
          [claim.id],
        )
      ).rowCount
        ? [AUTOPILOT_QUOTE_CHECK_LABEL, ...assessment.labels, ...flagged].slice(
            0,
            20,
          )
        : [...assessment.labels, ...flagged].slice(0, 20),
      explanation: assessment.explanation,
      independent_origins: assessment.independent_origins,
      contrary_origins: assessment.contrary_origins,
      max_age_days: maxAgeDays,
      rows: rows.map((r: Row, i: number) => ({
        support: toSupport(r),
        freshness: assessment.rows[i]!.freshness,
        counted: assessment.rows[i]!.counted,
        origin_cluster: String(r.origin_cluster),
        source_title: String(r.source_title),
        source_url: String((r.source_body as Row | null)?.url ?? r.url_key),
        source_current_version: Number(r.source_current_version),
        last_checked_at: r.last_checked_at ? iso(r.last_checked_at) : null,
        passage_check: checks[i]!,
      })),
    };
  }

  // ---- Owner-approved evidence websites (ADR-0056, migration 35) ----------------------------

  /**
   * The latest owner change in Settings for this workspace, or null while the list the studio
   * started with applies. Read for every live fetch, so a change applies to the next one.
   */
  async savedEvidenceSites(
    ctx: CommandContext,
    ws: string,
  ): Promise<{
    version: number;
    mode: EvidenceSiteMode;
    hosts: string[];
  } | null> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return latestEvidenceSites(c, ws);
    });
  }

  async evidenceSiteHistory(
    ctx: CommandContext,
    ws: string,
  ): Promise<EvidenceSiteChange[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from evidence_site_changes where workspace_id = $1
          order by version desc limit 50`,
        [ws],
      );
      return rows.map((r: Row) => ({
        version: Number(r.version),
        mode: r.mode as EvidenceSiteMode,
        hosts: r.hosts as string[],
        previous_mode: r.previous_mode as EvidenceSiteMode,
        previous_hosts: r.previous_hosts as string[],
        reason: String(r.reason),
        actor_id: String(r.actor_id),
        created_at: iso(r.created_at),
      }));
    });
  }

  /**
   * Records a new evidence-website version. Only a workspace owner signed in as a person may
   * change it; agents, workers and system actors are refused. The caller names the version it
   * saw (0 while the startup list applies), and the change, its reason and its audit event
   * commit together under a per-workspace lock taken before the audit-chain lock (ADR-0047).
   */
  async changeEvidenceSites(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
    startup: { mode: EvidenceSiteMode; hosts: string[] },
  ): Promise<{ version: number; mode: EvidenceSiteMode; hosts: string[] }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const body = parse(ChangeEvidenceSitesRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      await c.query(
        "select pg_advisory_xact_lock(hashtext('evidence-sites:' || $1::text))",
        [ws],
      );
      const cur = (await latestEvidenceSites(c, ws)) ?? {
        version: 0,
        ...startup,
      };
      const sorted = (h: readonly string[]) => JSON.stringify([...h].sort());
      if (
        body.expected_version !== cur.version ||
        // The startup list can change on a restart while the page is open (PR #103 L6).
        (cur.version === 0 &&
          body.expected_startup &&
          (body.expected_startup.mode !== cur.mode ||
            sorted(body.expected_startup.hosts) !== sorted(cur.hosts)))
      )
        throw fail(
          'VERSION_CONFLICT',
          'The evidence websites changed since this page loaded them; reload and decide again.',
        );
      const hosts = [...body.hosts].sort();
      if (body.mode === cur.mode && JSON.stringify(hosts) === sorted(cur.hosts))
        throw fail(
          'INVALID_CONTRACT',
          'Nothing changed: the mode and websites are the same as now.',
        );
      const version = cur.version + 1;
      const payload = {
        version,
        mode: body.mode,
        hosts,
        previous_mode: cur.mode,
        previous_hosts: cur.hosts,
        reason: body.reason,
      };
      const eventId = await this.append(c, ctx, {
        workspaceId: ws,
        action: 'evidence_sites.changed',
        subjectKind: 'evidence_sites',
        subjectId: ws,
        subjectVersion: version,
        contentHash: canonicalHash(payload),
        payload,
      });
      await c.query(
        `insert into evidence_site_changes (workspace_id, version, mode, hosts, previous_mode,
           previous_hosts, reason, actor_id, event_id)
         values ($1, $2, $3, $4::jsonb, $5, $6::jsonb, $7, $8, $9)`,
        [
          ws,
          version,
          body.mode,
          JSON.stringify(hosts),
          cur.mode,
          JSON.stringify(cur.hosts),
          body.reason,
          ctx.actorId,
          eventId,
        ],
      );
      return { version, mode: body.mode, hosts };
    });
  }
}

const interrupted: RetrievalFinish = {
  state: 'failed',
  final_url: null,
  redirects: [],
  http_status: null,
  content_type: null,
  bytes: null,
  content_hash: null,
  reason_code: 'interrupted',
  explanation:
    'The fetch did not record an outcome (the process stopped). Nothing was kept; fetch again with a new operation id.',
};

async function latestEvidenceSites(c: PoolClient, ws: string) {
  const { rows } = await c.query(
    `select version, mode, hosts from evidence_site_changes where workspace_id = $1
      order by version desc limit 1`,
    [ws],
  );
  const r = rows[0] as Row | undefined;
  return r
    ? {
        version: Number(r.version),
        mode: r.mode as EvidenceSiteMode,
        hosts: r.hosts as string[],
      }
    : null;
}
