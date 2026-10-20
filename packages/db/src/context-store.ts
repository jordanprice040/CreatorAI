import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BuildPackRequestSchema,
  CapabilityRegistryBodySchema,
  CompactRequestSchema,
  ContextCallRequestSchema,
  ContextEvaluationRequestSchema,
  CONTEXT_POLICY_VERSION,
  CreateHandoffRequestSchema,
  IndexRecordsRequestSchema,
  IndexRequestSchema,
  InvalidateCacheRequestSchema,
  PricingSnapshotBodySchema,
  RegisterCapabilitiesRequestSchema,
  SubmitBatchRequestSchema,
  parse,
  type Batch,
  type BrokerCallRequest,
  type CacheEntry,
  type CapabilityRegistry,
  type Compaction,
  type ContextCallRequest,
  type ContextCallResult,
  type ContextEvaluation,
  type ContextPack,
  type ContextUsageReport,
  type CostSummary,
  type Handoff,
  type IndexEntry,
  type IndexResult,
  type ModelRef,
  type PackItem,
  type PricingSnapshotBody,
  type ProviderCapability,
  type SubmitBatchRequest,
} from '@creator/contracts';
import {
  dataClassAllows,
  authorityItem,
  brokerRequestHash,
  cacheKey,
  canonicalHash,
  capabilityRefusal,
  checkOutput,
  compactionBrokerRequest,
  compareContextArms,
  contextCallBrokerRequest,
  estimateTokens,
  evaluationBrokerRequest,
  extractiveCompact,
  modelCompactionItems,
  modelKey,
  orderItems,
  packHashes,
  refKey,
  renderPack,
  selectPack,
  sumCosts,
  textHash,
  verifyCompaction,
  type IndexCandidate,
} from '@creator/domain';
import { toGrant, toRun } from './oversight-store.js';
import { toPricing } from './budget-store.js';
import { RoutingStore } from './routing-store.js';
import {
  fail,
  isPgError,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

const big = (v: unknown) => BigInt(String(v ?? '0'));
const ZERO: CostSummary = {
  incurred_nano: '0',
  unknown_nano: '0',
  operations: 0,
};
type Rendered = { role: 'system' | 'user' | 'assistant'; text: string };

const toEntry = (r: Row): IndexEntry => ({
  corpus: String(r.corpus),
  key: String(r.key),
  kind: r.kind as IndexEntry['kind'],
  data_class: r.data_class as IndexEntry['data_class'],
  version: Number(r.version),
  content_hash: String(r.content_hash),
  locator: (r.locator as string | null) ?? null,
  record: (r.record as IndexEntry['record']) ?? null,
  tokens: Number(r.tokens),
  status: r.status as IndexEntry['status'],
  indexed_at: iso(r.indexed_at),
  updated_at: iso(r.updated_at),
});
const toCandidate = (r: Row): IndexCandidate => ({
  ...toEntry(r),
  text: String(r.text),
});
const toPack = (r: Row): ContextPack => r.body as ContextPack;
const toCompaction = (r: Row): Compaction => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  pack_id: String(r.pack_id),
  method: r.method as Compaction['method'],
  status: r.status as Compaction['status'],
  reason_code: String(r.reason_code),
  explanation: String(r.explanation),
  result_pack_id: (r.result_pack_id as string | null) ?? null,
  operation_id: (r.operation_id as string | null) ?? null,
  missing_pins: r.missing_pins as string[],
  missing_facts: r.missing_facts as string[],
  tokens_before: Number(r.tokens_before),
  tokens_after: r.tokens_after === null ? null : Number(r.tokens_after),
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
});
const toCapabilities = (r: Row): CapabilityRegistry => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  fixture: Boolean(r.fixture),
  registry_hash: String(r.registry_hash),
  body: r.body as CapabilityRegistry['body'],
  batch_pricing_snapshot_ids: r.batch_pricing_snapshot_ids as Record<
    string,
    string
  >,
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
});
const toCacheEntry = (r: Row): CacheEntry => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  fixture: Boolean(r.fixture),
  cache_key: String(r.cache_key),
  scope: r.scope as CacheEntry['scope'],
  version: r.version as CacheEntry['version'],
  deps: r.deps as CacheEntry['deps'],
  source_operation_id: String(r.source_operation_id),
  source_run_id: String(r.source_run_id),
  status: r.status as CacheEntry['status'],
  invalidated_reason: (r.invalidated_reason as string | null) ?? null,
  invalidated_at: r.invalidated_at ? iso(r.invalidated_at) : null,
  hits: Number(r.hits),
  created_at: iso(r.created_at),
});
const toEvaluation = (r: Row): ContextEvaluation => {
  const res = (r.result ?? null) as Pick<
    ContextEvaluation,
    | 'baseline'
    | 'candidate'
    | 'quality_maintained'
    | 'reasons'
    | 'savings_claim'
  > | null;
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    fixture: Boolean(r.fixture),
    run_id: String(r.run_id),
    manifest_hash: String(r.manifest_hash),
    request: r.request as ContextEvaluation['request'],
    state: r.state as ContextEvaluation['state'],
    baseline: res?.baseline ?? null,
    candidate: res?.candidate ?? null,
    quality_maintained: res?.quality_maintained ?? null,
    reasons: res?.reasons ?? [],
    savings_claim: res?.savings_claim ?? null,
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    evaluated_at: r.evaluated_at ? iso(r.evaluated_at) : null,
  };
};
/** Every string inside a record body, in order, for indexing. */
function strings(v: unknown, out: string[] = []): string[] {
  if (typeof v === 'string') out.push(v);
  else if (Array.isArray(v)) for (const x of v) strings(x, out);
  else if (v && typeof v === 'object')
    for (const x of Object.values(v)) strings(x, out);
  return out;
}
/** Index entries a pack's items rest on: the items themselves or what they were derived from. */
function packSources(pack: ContextPack) {
  const out = new Map<
    string,
    {
      corpus: string;
      key: string;
      content_hash: string;
      record: { id: string; version: number } | null;
    }
  >();
  for (const i of pack.items) {
    if (i.origin === 'index' && i.corpus && i.key)
      out.set(refKey({ corpus: i.corpus, key: i.key }), {
        corpus: i.corpus,
        key: i.key,
        content_hash: i.content_hash,
        record: i.record,
      });
    for (const d of i.derived_from)
      if (!out.has(refKey(d))) out.set(refKey(d), { ...d, record: null });
  }
  return [...out.values()];
}

export interface PreparedContextCall {
  fixture: boolean;
  model: ModelRef;
  pack: ContextPack | null;
  request: BrokerCallRequest;
  cache_key: string;
  input_hash: string;
  pricing_hash: string;
  entry: CacheEntry | null;
  /** Why an existing entry cannot be served; null when it can, or when there is none. */
  stale: string | null;
}

/**
 * X02 context selection, caching, compaction and batches (migration 13). Selection,
 * compaction verification and cache validity are decided here from recorded state; results
 * are always read back from the broker's own reservations, never accepted from callers.
 */
export class ContextStore extends RoutingStore {
  private async wsFixture(c: PoolClient, ws: string) {
    const { rows } = await c.query<{ fixture: boolean }>(
      'select fixture from workspaces where id = $1',
      [ws],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Workspace not found.');
    return rows[0].fixture;
  }
  /** Settled cost and held (unknown or in-flight) exposure of these operations. */
  private async costOf(
    c: PoolClient,
    ws: string,
    ops: string[],
  ): Promise<CostSummary> {
    if (!ops.length) return ZERO;
    const { rows } = await c.query(
      `select logical_operation_id::text as op,
         coalesce(sum(incurred_nano) filter (where status = 'settled'), 0)::text as incurred,
         coalesce(sum(reserved_nano) filter (where status in ('unknown','in_flight')), 0)::text as unknown
       from budget_reservations where workspace_id = $1 and logical_operation_id = any($2::uuid[])
       group by logical_operation_id`,
      [ws, ops],
    );
    return sumCosts(
      rows.map((r) => ({
        incurred_nano: String(r.incurred),
        unknown_nano: String(r.unknown),
        operations: 1,
      })),
    );
  }
  private async pricingOf(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      'select * from pricing_snapshots where workspace_id = $1 and id = $2',
      [ws, uuid(id)],
    );
    if (!rows[0])
      throw fail('PRICING_MISSING', 'No pricing snapshot with that id here.');
    return toPricing(rows[0] as Row);
  }
  private async packIn(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      'select * from context_packs where workspace_id = $1 and id = $2',
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Context pack not found.');
    return toPack(rows[0] as Row);
  }
  /** The latest capability for a model and feature, from the newest registry. */
  private async capabilityOf(
    c: PoolClient,
    ws: string,
    model: ModelRef,
    feature: ProviderCapability['feature'],
  ) {
    const { rows } = await c.query(
      'select * from context_capabilities where workspace_id = $1 order by created_at desc, id limit 1',
      [ws],
    );
    if (!rows[0]) return { registry: null, cap: undefined };
    const registry = toCapabilities(rows[0] as Row);
    return {
      registry,
      cap: registry.body.capabilities.find(
        (x) =>
          x.provider === model.provider &&
          x.model_id === model.model_id &&
          x.feature === feature,
      ),
    };
  }
  /** Last attempt of an operation as the broker recorded it. */
  private async lastAttempt(c: PoolClient, ws: string, op: string) {
    const { rows } = await c.query(
      `select id, status, provider, model_id, request_hash, result, reason_code from budget_reservations
       where workspace_id = $1 and logical_operation_id = $2 order by created_at desc, attempt desc limit 1`,
      [ws, op.toLowerCase()],
    );
    return (rows[0] as Row | undefined) ?? null;
  }

  // ---- Capabilities ------------------------------------------------------------------

  async registerCapabilities(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<CapabilityRegistry> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RegisterCapabilitiesRequestSchema, raw);
    const body = parse(CapabilityRegistryBodySchema, req.registry);
    const pricing = req.pricing.map((p) => parse(PricingSnapshotBodySchema, p));
    const registryHash = canonicalHash(body);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const fixture = await this.wsFixture(c, ws);
      if (fixture !== body.fixture)
        throw fail(
          'SCOPE_EXCEEDED',
          fixture
            ? 'A fixture workspace can only hold fixture capabilities.'
            : 'A real workspace cannot hold fixture capabilities.',
        );
      const prior = await c.query(
        'select * from context_capabilities where workspace_id = $1 and capabilities_version = $2',
        [ws, body.capabilities_version],
      );
      if (prior.rows[0]) {
        const existing = toCapabilities(prior.rows[0] as Row);
        if (existing.registry_hash !== registryHash)
          throw fail(
            'DUPLICATE',
            'That capabilities version is already registered with different content; publish a new version.',
          );
        return existing;
      }
      const ids: Record<string, string> = {};
      for (const cap of body.capabilities) {
        if (!cap.batch) continue;
        const p = pricing.find(
          (x) => canonicalHash(x) === cap.batch!.pricing_hash,
        );
        if (!p || p.provider !== cap.provider || p.model_id !== cap.model_id)
          throw fail(
            'PRICING_MISSING',
            `No supplied batch pricing for ${cap.model_id} matches its pricing_hash.`,
          );
        ids[cap.batch.pricing_hash] = await this.ensurePricing(
          c,
          ctx,
          ws,
          fixture,
          p,
        );
      }
      const id = randomUUID();
      const { rows } = await c.query(
        `insert into context_capabilities (id, workspace_id, fixture, capabilities_version,
           registry_hash, body, batch_pricing_snapshot_ids, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          id,
          ws,
          fixture,
          body.capabilities_version,
          registryHash,
          body,
          ids,
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'context.capabilities_registered',
        subjectKind: 'context_capabilities',
        subjectId: id,
        subjectVersion: null,
        contentHash: registryHash,
        payload: {
          capabilities_version: body.capabilities_version,
          capabilities: body.capabilities.map(
            (x) => `${x.provider}/${x.model_id}/${x.feature}:${x.state}`,
          ),
        },
      });
      return toCapabilities(rows[0] as Row);
    });
  }
  private async ensurePricing(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    fixture: boolean,
    p: PricingSnapshotBody,
  ) {
    const h = canonicalHash(p);
    const found = await c.query(
      'select id::text from pricing_snapshots where workspace_id = $1 and snapshot_hash = $2 order by created_at limit 1',
      [ws, h],
    );
    const existing = found.rows[0]?.id as string | undefined;
    if (existing) return existing;
    const id = randomUUID();
    await c.query(
      `insert into pricing_snapshots (id, workspace_id, fixture, provider, model_id, basis,
         body, snapshot_hash, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [id, ws, fixture, p.provider, p.model_id, p.basis, p, h, ctx.actorId],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'pricing.recorded',
      subjectKind: 'pricing',
      subjectId: id,
      subjectVersion: null,
      contentHash: h,
      payload: { provider: p.provider, model_id: p.model_id, basis: p.basis },
    });
    return id;
  }
  async listCapabilities(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from context_capabilities where workspace_id = $1 order by created_at desc',
        [ws],
      );
      return rows.map((r: Row) => toCapabilities(r));
    });
  }

  // ---- Incremental index -------------------------------------------------------------

  private async upsertEntries(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    corpus: string,
    complete: boolean,
    removeKeys: string[],
    items: {
      key: string;
      kind: IndexEntry['kind'];
      data_class: IndexEntry['data_class'];
      locator: string | null;
      record: IndexEntry['record'];
      text: string;
      removed?: boolean;
    }[],
  ): Promise<IndexResult> {
    const fixture = await this.wsFixture(c, ws);
    // One indexer per corpus at a time, so counts and removals are consistent.
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [
      `context-index:${ws}:${corpus}`,
    ]);
    const { rows: existing } = await c.query(
      'select * from context_index_entries where workspace_id = $1 and corpus = $2',
      [ws, corpus],
    );
    const byKey = new Map(existing.map((r) => [String(r.key), r as Row]));
    const result: IndexResult = {
      corpus,
      added: 0,
      updated: 0,
      unchanged: 0,
      removed: 0,
      current: 0,
    };
    const seen = new Set<string>();
    for (const i of items) {
      seen.add(i.key);
      const hash = textHash(i.text);
      const prior = byKey.get(i.key);
      const status = i.removed ? 'removed' : 'current';
      if (
        prior &&
        prior.content_hash === hash &&
        prior.status === status &&
        prior.locator === i.locator &&
        prior.data_class === i.data_class &&
        prior.kind === i.kind &&
        canonicalHash(prior.record ?? null) === canonicalHash(i.record)
      ) {
        result.unchanged += 1;
        continue;
      }
      if (!prior) {
        if (i.removed) continue;
        await c.query(
          `insert into context_index_entries (workspace_id, fixture, corpus, key, kind, data_class,
             version, content_hash, locator, record, text, tokens, status)
           values ($1,$2,$3,$4,$5,$6,1,$7,$8,$9,$10,$11,'current')`,
          [
            ws,
            fixture,
            corpus,
            i.key,
            i.kind,
            i.data_class,
            hash,
            i.locator,
            i.record,
            i.text,
            estimateTokens(i.text),
          ],
        );
        result.added += 1;
        continue;
      }
      await c.query(
        `update context_index_entries set kind = $4, data_class = $5,
           version = version + case when content_hash = $6 then 0 else 1 end,
           content_hash = $6, locator = $7, record = $8, text = $9, tokens = $10, status = $11,
           updated_at = clock_timestamp()
         where workspace_id = $1 and corpus = $2 and key = $3`,
        [
          ws,
          corpus,
          i.key,
          i.kind,
          i.data_class,
          hash,
          i.locator,
          i.record,
          i.text,
          estimateTokens(i.text),
          status,
        ],
      );
      if (i.removed) result.removed += 1;
      else result.updated += 1;
    }
    const drop = new Set(removeKeys);
    for (const [key, r] of byKey)
      if (
        (complete || drop.has(key)) &&
        !seen.has(key) &&
        r.status === 'current'
      ) {
        await c.query(
          `update context_index_entries set status = 'removed', updated_at = clock_timestamp()
             where workspace_id = $1 and corpus = $2 and key = $3`,
          [ws, corpus, key],
        );
        result.removed += 1;
      }
    const { rows: count } = await c.query<{ n: number }>(
      `select count(*)::int as n from context_index_entries where workspace_id = $1 and corpus = $2 and status = 'current'`,
      [ws, corpus],
    );
    result.current = Number(count[0]?.n ?? 0);
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'context.indexed',
      subjectKind: 'context_corpus',
      subjectId: ws,
      subjectVersion: null,
      contentHash: null,
      payload: { ...result },
    });
    return result;
  }
  /** Code or note corpora posted by the owner's tools. Only changed items are rewritten. */
  async indexItems(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(IndexRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      return this.upsertEntries(
        c,
        ctx,
        ws,
        req.corpus,
        req.complete,
        req.removed_keys,
        req.items.map((i) => ({
          key: i.key,
          kind: req.kind,
          data_class: req.data_class,
          locator: i.locator,
          record: null,
          text: i.text,
        })),
      );
    });
  }
  /**
   * Workspace records (sources, claims, problems...) as a corpus keyed by kind and id.
   * Archived or redacted records are marked removed, so packs and cache entries built on
   * them become stale.
   */
  async indexRecords(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(IndexRecordsRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const { rows } = await c.query(
        `select id::text, kind, version, status, title, body from entities
         where workspace_id = $1 and kind = any($2::text[]) order by kind, id limit 5000`,
        [ws, req.kinds],
      );
      return this.upsertEntries(
        c,
        ctx,
        ws,
        req.corpus,
        true,
        [],
        rows.map((r) => ({
          key: `${String(r.kind)}:${String(r.id)}`,
          kind: 'record' as const,
          data_class: req.data_class,
          locator: `record:${String(r.kind)}/${String(r.id)}`,
          record: { id: String(r.id), version: Number(r.version) },
          text: [String(r.title), ...strings(r.body)]
            .join('\n')
            .slice(0, 16000),
          removed: r.status !== 'active',
        })),
      );
    });
  }
  async listIndex(ctx: CommandContext, ws: string, corpus: string | null) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from context_index_entries where workspace_id = $1 and ($2::text is null or corpus = $2)
         order by corpus, key limit 2000`,
        [ws, corpus],
      );
      return rows.map((r: Row) => toEntry(r));
    });
  }

  // ---- Packs -------------------------------------------------------------------------

  private async insertPack(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    fixture: boolean,
    base: Omit<
      ContextPack,
      | 'id'
      | 'workspace_id'
      | 'fixture'
      | 'pack_hash'
      | 'prefix_hash'
      | 'tokens'
      | 'created_by'
      | 'created_at'
      | 'format'
      | 'policy_version'
    >,
  ): Promise<ContextPack> {
    const items = orderItems(base.items);
    const { pack_hash, prefix_hash } = packHashes(items);
    const pack: ContextPack = {
      id: randomUUID(),
      workspace_id: ws,
      fixture,
      format: 'context-pack/1',
      policy_version: CONTEXT_POLICY_VERSION,
      ...base,
      items,
      pack_hash,
      prefix_hash,
      tokens: items.reduce((s, i) => s + i.tokens, 0),
      created_by: ctx.actorId,
      created_at: new Date().toISOString(),
    };
    await c.query(
      `insert into context_packs (id, workspace_id, fixture, run_id, pack_hash, prefix_hash, body,
         compacted_from, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        pack.id,
        ws,
        fixture,
        pack.run_id,
        pack_hash,
        prefix_hash,
        pack,
        pack.compacted_from,
        ctx.actorId,
      ],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: pack.compacted_from
        ? 'context.pack_compacted'
        : 'context.pack_built',
      subjectKind: 'context_pack',
      subjectId: pack.id,
      subjectVersion: null,
      contentHash: pack_hash,
      payload: {
        run_id: pack.run_id,
        task_class: pack.task_class,
        items: items.length,
        pins: items.filter((i) => i.pin).length,
        tokens: pack.tokens,
        token_budget: pack.token_budget,
        excluded: pack.excluded.length,
        compacted_from: pack.compacted_from,
        prefix_hash,
      },
      relatedIds: [
        pack.run_id,
        ...(pack.compacted_from ? [pack.compacted_from] : []),
      ],
    });
    return pack;
  }
  async buildPack(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ContextPack> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(BuildPackRequestSchema, raw);
    const runId = req.run_id.toLowerCase();
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const fixture = await this.wsFixture(c, ws);
      const run = toRun(
        ((
          await c.query(
            'select * from run_controls where workspace_id = $1 and run_id = $2',
            [ws, runId],
          )
        ).rows[0] ??
          fail('NOT_FOUND', 'Run is not registered for oversight.')) as Row,
      );
      if (run.state === 'cancelled')
        throw fail('INVALID_TRANSITION', 'The run is cancelled.');
      const grants = (
        await c.query(
          `select * from grants where workspace_id = $1 and status = 'active'
             and (run_id is null or run_id = $2) and expires_at > now() order by id`,
          [ws, runId],
        )
      ).rows.map((r: Row) => toGrant(r));
      // Handoffs: their pins and facts carry forward; the summary only while its sources hold.
      const handoffs: Handoff[] = [];
      for (const h of req.handoffs) {
        const { rows } = await c.query(
          'select body from context_handoffs where workspace_id = $1 and id = $2',
          [ws, uuid(h)],
        );
        if (!rows[0]) throw fail('NOT_FOUND', 'Handoff not found.');
        handoffs.push(rows[0].body as Handoff);
      }
      const pins = [...req.pins];
      for (const h of handoffs)
        for (const p of h.pins)
          if (!pins.some((x) => refKey(x) === refKey(p))) pins.push(p);
      const facts = [
        ...new Set([
          ...req.required_facts,
          ...handoffs.flatMap((h) => h.required_facts),
        ]),
      ];
      const refs = [
        ...req.include,
        ...pins,
        ...handoffs.flatMap((h) => h.sources),
      ];
      const { rows: entryRows } = await c.query(
        `select * from context_index_entries where workspace_id = $1 and (corpus = any($2::text[])
           or (corpus, key) in (select * from unnest($3::text[], $4::text[])))`,
        [ws, req.corpora, refs.map((r) => r.corpus), refs.map((r) => r.key)],
      );
      const entries = new Map(
        entryRows.map((r) => {
          const e = toCandidate(r as Row);
          return [refKey(e), e] as const;
        }),
      );
      const handoffItems: PackItem[] = [];
      const stale: string[] = [];
      for (const h of handoffs) {
        const fresh = h.sources.every((s) => {
          const e = entries.get(refKey(s));
          return (
            e && e.status === 'current' && e.content_hash === s.content_hash
          );
        });
        const hPack = await this.packIn(c, ws, h.pack_id);
        if (!fresh) {
          stale.push(h.id);
          continue;
        }
        if (!dataClassAllows(req.data_class, hPack.data_class))
          throw fail(
            'SCOPE_EXCEEDED',
            `Handoff ${h.id} carries ${hPack.data_class} context; this pack is ${req.data_class}.`,
          );
        handoffItems.push({
          origin: 'handoff',
          corpus: null,
          key: null,
          kind: 'summary',
          data_class: hPack.data_class,
          version: null,
          content_hash: textHash(h.summary),
          locator: `handoff:${h.id}`,
          record: null,
          pin: null,
          derived_from: h.sources,
          handoff_id: h.id,
          tokens: estimateTokens(h.summary),
          text: h.summary,
        });
      }
      // Handoff sources are only freshness evidence, never candidates themselves.
      const candidates = new Map(
        [...entries].filter(
          ([k, e]) =>
            req.corpora.includes(e.corpus) ||
            req.include.some((r) => refKey(r) === k) ||
            pins.some((r) => refKey(r) === k),
        ),
      );
      const sel = selectPack({
        query: req.query,
        token_budget: req.token_budget,
        data_class: req.data_class,
        required_facts: facts,
        pins,
        include: req.include,
        corpora: req.corpora,
        entries: candidates,
        authority: authorityItem(run, grants, req.data_class),
        handoffs: handoffItems,
        staleHandoffs: stale,
      });
      return this.insertPack(c, ctx, ws, fixture, {
        run_id: runId,
        task_id: req.task_id?.toLowerCase() ?? null,
        project_id: req.project_id?.toLowerCase() ?? null,
        task_class: req.task_class,
        data_class: req.data_class,
        purpose: req.purpose,
        query: req.query,
        token_budget: req.token_budget,
        items: sel.items,
        excluded: sel.excluded,
        required_facts: facts,
        compacted_from: null,
        handoffs: req.handoffs.map((h) => h.toLowerCase()),
      });
    });
  }
  async getPack(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.packIn(c, ws, id);
    });
  }
  async listPacks(ctx: CommandContext, ws: string, runId: string | null) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from context_packs where workspace_id = $1 and ($2::uuid is null or run_id = $2)
         order by created_at desc limit 200`,
        [ws, runId ? uuid(runId) : null],
      );
      return rows.map((r: Row) => toPack(r));
    });
  }

  // ---- Compaction --------------------------------------------------------------------

  private async recordCompaction(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    pack: ContextPack,
    v: {
      method: Compaction['method'];
      budget: number;
      items: PackItem[] | null;
      reason: string | null;
      explanation: string;
      operationId: string | null;
    },
  ): Promise<{ compaction: Compaction; pack: ContextPack | null }> {
    let status: Compaction['status'] = 'refused';
    let reason = v.reason ?? 'refused';
    let explanation = v.explanation;
    let missing = {
      missing_pins: [] as string[],
      missing_facts: [] as string[],
    };
    let result: ContextPack | null = null;
    let tokensAfter: number | null = null;
    if (v.items) {
      missing = verifyCompaction(pack, v.items);
      tokensAfter = v.items.reduce((s, i) => s + i.tokens, 0);
      if (missing.missing_pins.length || missing.missing_facts.length) {
        status = 'rejected';
        reason = missing.missing_pins.length
          ? 'pins_lost'
          : 'required_facts_lost';
        explanation = `Compaction lost ${[...missing.missing_pins, ...missing.missing_facts].join('; ').slice(0, 800)}; the original pack stays in use.`;
      } else if (tokensAfter > v.budget) {
        status = 'rejected';
        reason = 'over_budget';
        explanation = `The compacted context needs ${tokensAfter} tokens; the budget is ${v.budget}.`;
      } else if (v.items.some((i) => i.text.length > 16000)) {
        status = 'rejected';
        reason = 'item_too_long';
        explanation = 'A compacted item is longer than one pack item may be.';
      } else {
        status = 'accepted';
        reason = 'verified';
        explanation = `Every pin and required fact survived; ${pack.tokens} → ${tokensAfter} tokens.`;
        result = await this.insertPack(c, ctx, ws, pack.fixture, {
          run_id: pack.run_id,
          task_id: pack.task_id,
          project_id: pack.project_id,
          task_class: pack.task_class,
          data_class: pack.data_class,
          purpose: pack.purpose,
          query: pack.query,
          token_budget: v.budget,
          items: v.items,
          excluded: pack.excluded,
          required_facts: pack.required_facts,
          compacted_from: pack.id,
          handoffs: pack.handoffs,
        });
      }
    }
    const id = randomUUID();
    const { rows } = await c.query(
      `insert into context_compactions (id, workspace_id, pack_id, method, status, reason_code,
         explanation, result_pack_id, operation_id, missing_pins, missing_facts, tokens_before,
         tokens_after, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
      [
        id,
        ws,
        pack.id,
        v.method,
        status,
        reason,
        explanation.slice(0, 1200),
        result?.id ?? null,
        v.operationId,
        JSON.stringify(missing.missing_pins),
        JSON.stringify(missing.missing_facts),
        pack.tokens,
        tokensAfter,
        ctx.actorId,
      ],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: `context.compaction_${status}`,
      subjectKind: 'context_pack',
      subjectId: pack.id,
      subjectVersion: null,
      contentHash: pack.pack_hash,
      payload: {
        method: v.method,
        reason_code: reason,
        missing_pins: missing.missing_pins.length,
        missing_facts: missing.missing_facts.length,
        result_pack_id: result?.id ?? null,
      },
      relatedIds: v.operationId ? [v.operationId] : [],
    });
    return { compaction: toCompaction(rows[0] as Row), pack: result };
  }
  /**
   * Extractive and provider compaction. The provider route is capability-checked and refused
   * when its output could not be verified (opaque) while pins or required facts must survive.
   */
  async compactPack(
    ctx: CommandContext,
    ws: string,
    packId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CompactRequestSchema, raw);
    if (req.method === 'model')
      throw fail(
        'INVALID_CONTRACT',
        'Model compaction runs through the broker (context compaction route), not this store call.',
      );
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const pack = await this.packIn(c, ws, packId);
      if (req.method === 'extractive') {
        const { items } = extractiveCompact(pack, req.token_budget);
        return this.recordCompaction(c, ctx, ws, pack, {
          method: 'extractive',
          budget: req.token_budget,
          items,
          reason: null,
          explanation: '',
          operationId: null,
        });
      }
      const fixture = await this.wsFixture(c, ws);
      const { cap } = await this.capabilityOf(
        c,
        ws,
        req.model,
        'provider_compaction',
      );
      const refusal = capabilityRefusal(fixture, cap);
      const opaque =
        cap?.output_opaque &&
        (pack.required_facts.length > 0 ||
          pack.items.some((i) => i.pin !== null));
      return this.recordCompaction(c, ctx, ws, pack, {
        method: 'provider',
        budget: req.token_budget,
        items: null,
        reason:
          refusal ??
          (opaque ? 'output_unverifiable' : 'adapter_not_implemented'),
        explanation: refusal
          ? `Provider compaction for ${modelKey(req.model)} is ${refusal.replace('capability_', '')} here.`
          : opaque
            ? 'The provider returns an opaque compaction item, so surviving pins and facts cannot be checked; refused.'
            : 'No adapter implements provider compaction yet.',
        operationId: null,
      });
    });
  }
  /** The broker request model compaction must use; the result is verified against it. */
  async compactionRequest(
    ctx: CommandContext,
    ws: string,
    packId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CompactRequestSchema, raw);
    if (req.method !== 'model')
      throw fail('INVALID_CONTRACT', 'Only model compaction calls the broker.');
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const pack = await this.packIn(c, ws, packId);
      const done = await c.query(
        'select 1 from context_compactions where workspace_id = $1 and operation_id = $2',
        [ws, req.logical_operation_id.toLowerCase()],
      );
      if (done.rowCount)
        throw fail(
          'DUPLICATE',
          'That compaction operation is already recorded.',
        );
      return { pack, request: compactionBrokerRequest(pack, req), req };
    });
  }
  /** Reads the summarization the broker recorded for this exact request, then verifies it. */
  async recordModelCompaction(
    ctx: CommandContext,
    ws: string,
    packId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CompactRequestSchema, raw);
    if (req.method !== 'model')
      throw fail('INVALID_CONTRACT', 'Only model compaction calls the broker.');
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const pack = await this.packIn(c, ws, packId);
      const request = compactionBrokerRequest(pack, req);
      const op = request.logical_operation_id;
      const last = await this.lastAttempt(c, ws, op);
      if (!last)
        throw fail(
          'MISSING_EVIDENCE',
          'No broker call is recorded for this compaction.',
        );
      if (String(last.request_hash) !== brokerRequestHash(pack.run_id, request))
        throw fail(
          'EVIDENCE_MISMATCH',
          'The recorded call is not the compaction request for this pack.',
        );
      const result = (last.result ?? {}) as {
        status?: string;
        reason_code?: string;
        output?: { text: string } | null;
      };
      if (last.status === 'in_flight')
        throw fail(
          'MISSING_EVIDENCE',
          'The compaction call is still in flight.',
        );
      const ok = last.status === 'settled' && result.status === 'succeeded';
      return this.recordCompaction(c, ctx, ws, pack, {
        method: 'model',
        budget: req.token_budget,
        items: ok
          ? modelCompactionItems(pack, result.output?.text ?? '')
          : null,
        reason: ok
          ? null
          : `call_${String(result.reason_code ?? last.reason_code)}`,
        explanation: ok
          ? ''
          : `The summarization call ended ${String(last.status)} (${String(result.reason_code ?? last.reason_code)}); nothing to verify.`,
        operationId: op,
      });
    });
  }
  async listCompactions(ctx: CommandContext, ws: string, packId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from context_compactions where workspace_id = $1 and pack_id = $2 order by created_at',
        [ws, uuid(packId)],
      );
      return rows.map((r: Row) => toCompaction(r));
    });
  }

  // ---- Handoffs ----------------------------------------------------------------------

  async createHandoff(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<Handoff> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateHandoffRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const pack = await this.packIn(c, ws, req.pack_id);
      const missing = pack.required_facts.filter(
        (f) =>
          !req.summary.toLowerCase().includes(f.toLowerCase()) &&
          !pack.items.some(
            (i) => i.pin && i.text.toLowerCase().includes(f.toLowerCase()),
          ),
      );
      if (missing.length)
        throw fail(
          'MISSING_EVIDENCE',
          `The handoff summary drops required facts not held by a pin: ${missing.join('; ').slice(0, 800)}`,
        );
      const body = {
        run_id: pack.run_id,
        pack_id: pack.id,
        pack_hash: pack.pack_hash,
        from_task_id: req.from_task_id?.toLowerCase() ?? null,
        summary: req.summary,
        sources: packSources(pack).map(({ record: _r, ...s }) => s),
        pins: pack.items
          .filter((i) => i.pin && i.pin !== 'authority' && i.corpus && i.key)
          .map((i) => ({
            corpus: i.corpus!,
            key: i.key!,
            pin: i.pin as Exclude<PackItem['pin'], 'authority' | null>,
          })),
        required_facts: pack.required_facts,
      };
      const handoff: Handoff = {
        id: randomUUID(),
        workspace_id: ws,
        ...body,
        handoff_hash: canonicalHash(body),
        created_by: ctx.actorId,
        created_at: new Date().toISOString(),
      };
      await c.query(
        `insert into context_handoffs (id, workspace_id, run_id, pack_id, handoff_hash, body, created_by)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [
          handoff.id,
          ws,
          pack.run_id,
          pack.id,
          handoff.handoff_hash,
          handoff,
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'context.handoff_created',
        subjectKind: 'context_handoff',
        subjectId: handoff.id,
        subjectVersion: null,
        contentHash: handoff.handoff_hash,
        payload: {
          pack_id: pack.id,
          sources: handoff.sources.length,
          pins: handoff.pins.length,
        },
        relatedIds: [pack.id, pack.run_id],
      });
      return handoff;
    });
  }
  async getHandoff(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select body from context_handoffs where workspace_id = $1 and id = $2',
        [ws, uuid(id)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Handoff not found.');
      return rows[0].body as Handoff;
    });
  }

  // ---- Result cache ------------------------------------------------------------------

  /** Why an entry may not be served now, or null when it is fresh and its sources hold. */
  private async staleness(
    c: PoolClient,
    ws: string,
    e: CacheEntry,
    maxAgeSeconds: number,
  ): Promise<string | null> {
    if (e.status !== 'valid') return 'invalidated';
    if (Date.now() - new Date(e.created_at).getTime() > maxAgeSeconds * 1000)
      return 'expired';
    if (e.deps.length) {
      const { rows } = await c.query(
        `select corpus, key, content_hash, status from context_index_entries where workspace_id = $1
           and (corpus, key) in (select * from unnest($2::text[], $3::text[]))`,
        [ws, e.deps.map((d) => d.corpus), e.deps.map((d) => d.key)],
      );
      const now = new Map(rows.map((r) => [refKey(r as never), r as Row]));
      for (const d of e.deps) {
        const r = now.get(refKey(d));
        if (!r || r.status !== 'current' || r.content_hash !== d.content_hash)
          return `dependency_changed:${d.corpus}/${d.key}`;
      }
      const records = e.deps.filter((d) => d.record);
      if (records.length) {
        const { rows: ents } = await c.query(
          'select id::text, version, status from entities where workspace_id = $1 and id = any($2::uuid[])',
          [ws, records.map((d) => d.record!.id)],
        );
        for (const d of records) {
          const r = ents.find((x) => x.id === d.record!.id);
          if (
            !r ||
            r.status !== 'active' ||
            Number(r.version) !== d.record!.version
          )
            return `record_changed:${d.record!.id}`;
        }
      }
    }
    return null;
  }
  private async invalidate(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    entryId: string,
    reason: string,
    runId: string | null,
  ) {
    const { rowCount } = await c.query(
      `update context_cache_entries set status = 'invalidated', invalidated_reason = $3,
         invalidated_at = clock_timestamp(), invalidated_by = $4
       where workspace_id = $1 and id = $2 and status = 'valid'`,
      [ws, entryId, reason.slice(0, 400), ctx.actorId],
    );
    if (rowCount)
      await this.contextEvent(c, ctx, ws, {
        kind: 'cache_invalidated',
        runId,
        packId: null,
        entryId,
        operationId: null,
        detail: { reason: reason.slice(0, 400) },
      });
  }
  private async contextEvent(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    e: {
      kind: string;
      runId: string | null;
      packId: string | null;
      entryId: string | null;
      operationId: string | null;
      detail: Row;
    },
  ) {
    await c.query(
      `insert into context_events (id, workspace_id, run_id, kind, pack_id, cache_entry_id,
         operation_id, detail, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        randomUUID(),
        ws,
        e.runId,
        e.kind,
        e.packId,
        e.entryId,
        e.operationId,
        e.detail,
        ctx.actorId,
      ],
    );
  }
  /**
   * Renders the call (pack first, then the task), computes its cache key and looks up an
   * entry. Lookup never serves: a hit must still pass admission in `serveCacheHit`.
   */
  async prepareContextCall(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<PreparedContextCall & { req: ContextCallRequest }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(ContextCallRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const fixture = await this.wsFixture(c, ws);
      const pricing = await this.pricingOf(c, ws, req.pricing_snapshot_id);
      const model: ModelRef = req.model ?? {
        provider: pricing.body.provider,
        model_id: pricing.body.model_id,
      };
      if (
        pricing.body.provider !== model.provider ||
        pricing.body.model_id !== model.model_id
      )
        throw fail(
          'PRICING_MISSING',
          `That pricing is not for ${modelKey(model)}.`,
        );
      const pack = req.pack_id ? await this.packIn(c, ws, req.pack_id) : null;
      if (pack && pack.run_id !== req.run_id.toLowerCase())
        throw fail(
          'SCOPE_EXCEEDED',
          'A pack is used only in the run it was built for.',
        );
      if (pack && pack.data_class !== req.data_class)
        throw fail(
          'SCOPE_EXCEEDED',
          `The pack is ${pack.data_class}; declare the call with the same data class.`,
        );
      const input: Rendered[] = pack
        ? renderPack(pack, req.messages)
        : req.messages;
      const request = contextCallBrokerRequest(req, input);
      const input_hash = canonicalHash(input);
      const key = cacheKey({
        workspace_id: ws,
        project_id: req.project_id?.toLowerCase() ?? null,
        data_class: req.data_class,
        action_type: req.action_type,
        tool: req.tool,
        model,
        pricing_hash: pricing.snapshot_hash,
        input_hash,
        pack_hash: pack?.pack_hash ?? null,
        output_format: req.output_format,
        max_output_tokens: req.max_output_tokens,
        policy_version: CONTEXT_POLICY_VERSION,
      });
      let entry: CacheEntry | null = null;
      let stale: string | null = null;
      if (req.cache.mode === 'use') {
        const { rows } = await c.query(
          `select * from context_cache_entries where workspace_id = $1 and cache_key = $2 and status = 'valid'`,
          [ws, key],
        );
        entry = rows[0] ? toCacheEntry(rows[0] as Row) : null;
        if (entry) {
          stale = await this.staleness(c, ws, entry, req.cache.max_age_seconds);
          // A changed source invalidates for everyone; an age limit is only this caller's.
          if (stale && stale !== 'expired')
            await this.invalidate(
              c,
              ctx,
              ws,
              entry.id,
              stale,
              req.run_id.toLowerCase(),
            );
        }
      }
      return {
        req,
        fixture,
        model,
        pack,
        request,
        cache_key: key,
        input_hash,
        pricing_hash: pricing.snapshot_hash,
        entry,
        stale,
      };
    });
  }
  /**
   * Serves a fresh entry only after the run's current grants admit this exact action now. The
   * entry carries no authority: a revoked grant or a stopped run refuses the hit.
   */
  async serveCacheHit(
    ctx: CommandContext,
    ws: string,
    prep: PreparedContextCall & { req: ContextCallRequest },
  ): Promise<ContextCallResult> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const { req } = prep;
    const entry = prep.entry!;
    const runId = req.run_id.toLowerCase();
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const run = await this.lockRun(c, ws, runId);
      const study = await c.query(
        'select 1 from study_attempts where workspace_id = $1 and run_id = $2',
        [ws, runId],
      );
      const refuse = async (
        reason: string,
        explanation: string,
        admission: string | null,
        needsHuman = false,
      ) => {
        await this.contextEvent(c, ctx, ws, {
          kind: 'cache_hit_refused',
          runId,
          packId: prep.pack?.id ?? null,
          entryId: entry.id,
          operationId: req.logical_operation_id.toLowerCase(),
          detail: { reason_code: reason },
        });
        return {
          cache: 'hit' as const,
          cache_entry_id: entry.id,
          cache_note: 'A valid entry exists but was not served.',
          status: needsHuman ? ('needs_human' as const) : ('denied' as const),
          reason_code: reason,
          explanation,
          output: null,
          source_operation_id: null,
          admission_id: admission,
          broker: null,
          fixture: prep.fixture,
        };
      };
      // Study runs use only frozen, application-rendered contexts; no reuse across attempts.
      if (study.rowCount)
        return refuse(
          'study_context_denied',
          'Study runs never read the result cache.',
          null,
        );
      if (
        run.autonomy_mode === 'human_only' &&
        req.action_type === 'tool.search_public'
      )
        return refuse(
          'human_only_broker_denied',
          'Human-only work cannot use model-broker tools.',
          null,
        );
      const admission = await this.admitIn(c, ctx, ws, runId, {
        action_type: req.action_type,
        task_id: req.task_id?.toLowerCase() ?? null,
        target: null,
        spec_hash: null,
        amount_nano_usd:
          run.state === 'active' && run.autonomy_mode !== 'human_only'
            ? '0'
            : null,
        data_class: req.data_class,
        assumption_ids: [],
        humility_review: null,
        flags: [],
        justification:
          `${req.justification} (served from the result cache)`.slice(0, 1200),
      });
      if (
        admission.verdict !== 'allow' ||
        run.state !== 'active' ||
        run.autonomy_mode === 'human_only'
      )
        return refuse(
          admission.verdict === 'allow'
            ? 'run_not_active'
            : admission.reason_code,
          admission.verdict === 'allow'
            ? 'The run is not active.'
            : admission.explanation,
          admission.id,
          ['needs_human', 'waiting_human'].includes(admission.outcome),
        );
      const { rows } = await c.query(
        `update context_cache_entries set hits = hits + 1 where workspace_id = $1 and id = $2
           and status = 'valid' returning output`,
        [ws, entry.id],
      );
      if (!rows[0])
        return refuse(
          'cache_entry_invalidated',
          'The entry was invalidated meanwhile.',
          admission.id,
        );
      await this.contextEvent(c, ctx, ws, {
        kind: 'cache_hit',
        runId,
        packId: prep.pack?.id ?? null,
        entryId: entry.id,
        operationId: req.logical_operation_id.toLowerCase(),
        detail: {
          source_operation_id: entry.source_operation_id,
          admission_id: admission.id,
        },
      });
      return {
        cache: 'hit',
        cache_entry_id: entry.id,
        cache_note: null,
        status: 'succeeded',
        reason_code: 'cache_hit',
        explanation: `Served the recorded answer of operation ${entry.source_operation_id}; no provider call was made. Admission ${admission.id} allowed it.`,
        output: rows[0].output as ContextCallResult['output'],
        source_operation_id: entry.source_operation_id,
        admission_id: admission.id,
        broker: null,
        fixture: prep.fixture,
      };
    });
  }
  /**
   * After a broker call: records the miss and, for a succeeded read-only call, stores the
   * answer the broker recorded for exactly this request, with its dependencies' hashes.
   */
  async recordContextCall(
    ctx: CommandContext,
    ws: string,
    prep: PreparedContextCall & { req: ContextCallRequest },
  ): Promise<{
    cache: ContextCallResult['cache'];
    entry_id: string | null;
    note: string | null;
  }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const { req } = prep;
    const runId = req.run_id.toLowerCase();
    const op = req.logical_operation_id.toLowerCase();
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      await this.contextEvent(c, ctx, ws, {
        kind: req.cache.mode === 'off' ? 'pack_call' : 'cache_miss',
        runId,
        packId: prep.pack?.id ?? null,
        entryId: null,
        operationId: op,
        detail: { mode: req.cache.mode, stale: prep.stale },
      });
      if (req.cache.mode === 'off')
        return { cache: 'off' as const, entry_id: null, note: null };
      const last = await this.lastAttempt(c, ws, op);
      const result = (last?.result ?? {}) as {
        status?: string;
        output?: unknown;
      };
      if (
        !last ||
        last.status !== 'settled' ||
        result.status !== 'succeeded' ||
        String(last.request_hash) !== brokerRequestHash(runId, prep.request) ||
        last.provider !== prep.model.provider ||
        last.model_id !== prep.model.model_id
      )
        return {
          cache: 'not_stored' as const,
          entry_id: null,
          note: 'Only a settled, succeeded call for this exact request is cached.',
        };
      const deps = new Map(
        (prep.pack ? packSources(prep.pack) : []).map((d) => [refKey(d), d]),
      );
      const wanted = [...deps.values(), ...req.cache.deps];
      const { rows: current } = wanted.length
        ? await c.query(
            `select corpus, key, content_hash, record, status from context_index_entries
             where workspace_id = $1 and (corpus, key) in (select * from unnest($2::text[], $3::text[]))`,
            [ws, wanted.map((d) => d.corpus), wanted.map((d) => d.key)],
          )
        : { rows: [] as Row[] };
      const at = new Map(
        current.map((r) => [
          refKey(r as { corpus: string; key: string }),
          r as Row,
        ]),
      );
      // An answer built on context that has already changed is never stored.
      for (const d of deps.values()) {
        const r = at.get(refKey(d));
        if (!r || r.status !== 'current' || r.content_hash !== d.content_hash)
          return {
            cache: 'not_stored' as const,
            entry_id: null,
            note: `Pack source ${d.corpus}/${d.key} changed after the pack was built; rebuild it.`,
          };
      }
      for (const d of req.cache.deps) {
        const r = at.get(refKey(d));
        if (!r || r.status !== 'current')
          return {
            cache: 'not_stored' as const,
            entry_id: null,
            note: `Dependency ${d.corpus}/${d.key} is not a current index entry.`,
          };
        deps.set(refKey(d), {
          corpus: d.corpus,
          key: d.key,
          content_hash: String(r.content_hash),
          record: (r.record as IndexEntry['record']) ?? null,
        });
      }
      if (req.cache.mode === 'refresh') {
        const { rows } = await c.query(
          `select id from context_cache_entries where workspace_id = $1 and cache_key = $2 and status = 'valid'`,
          [ws, prep.cache_key],
        );
        for (const r of rows)
          await this.invalidate(
            c,
            ctx,
            ws,
            String(r.id),
            'superseded_by_refresh',
            runId,
          );
      }
      const id = randomUUID();
      try {
        await c.query('savepoint cache_store');
        await c.query(
          `insert into context_cache_entries (id, workspace_id, fixture, cache_key, scope, version, deps,
             output, source_operation_id, source_run_id, status, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'valid',$11)`,
          [
            id,
            ws,
            prep.fixture,
            prep.cache_key,
            {
              project_id: req.project_id?.toLowerCase() ?? null,
              data_class: req.data_class,
              action_type: req.action_type,
              tool: req.tool,
            },
            {
              policy_version: CONTEXT_POLICY_VERSION,
              provider: prep.model.provider,
              model_id: prep.model.model_id,
              pricing_hash: prep.pricing_hash,
              input_hash: prep.input_hash,
              pack_hash: prep.pack?.pack_hash ?? null,
            },
            JSON.stringify([...deps.values()]),
            JSON.stringify(result.output ?? null),
            op,
            runId,
            ctx.actorId,
          ],
        );
      } catch (e) {
        if (!isPgError(e, '23505', 'context_cache_one_valid')) throw e;
        await c.query('rollback to savepoint cache_store');
        return {
          cache: 'not_stored' as const,
          entry_id: null,
          note: 'A valid entry for this key already exists.',
        };
      }
      await this.contextEvent(c, ctx, ws, {
        kind: 'cache_store',
        runId,
        packId: prep.pack?.id ?? null,
        entryId: id,
        operationId: op,
        detail: { deps: deps.size },
      });
      return {
        cache:
          req.cache.mode === 'refresh'
            ? ('refresh' as const)
            : ('miss' as const),
        entry_id: id,
        note: null,
      };
    });
  }
  async listCache(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from context_cache_entries where workspace_id = $1 order by created_at desc limit 500',
        [ws],
      );
      return rows.map((r: Row) => toCacheEntry(r));
    });
  }
  async invalidateCacheEntry(
    ctx: CommandContext,
    ws: string,
    entryId: string,
    raw: unknown,
  ): Promise<CacheEntry> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(InvalidateCacheRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const { rows } = await c.query(
        'select * from context_cache_entries where workspace_id = $1 and id = $2',
        [ws, uuid(entryId)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Cache entry not found.');
      await this.invalidate(
        c,
        ctx,
        ws,
        String(rows[0].id),
        `manual: ${req.reason}`,
        null,
      );
      const { rows: now } = await c.query(
        'select * from context_cache_entries where id = $1',
        [rows[0].id],
      );
      return toCacheEntry(now[0] as Row);
    });
  }

  // ---- Batches -----------------------------------------------------------------------

  /**
   * Records a batch, or refuses it: the model needs a usable batch capability, the request
   * must name that capability's batch price, and an adapter must exist. A repeated
   * batch_operation_id returns the recorded batch.
   */
  async beginBatch(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
    adapterAvailable: boolean,
  ): Promise<{
    batch: Batch;
    existing: boolean;
    req: SubmitBatchRequest;
    windowMs: number;
    pricing: PricingSnapshotBody;
  }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SubmitBatchRequestSchema, raw);
    const requestHash = canonicalHash(req);
    const id = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const fixture = await this.wsFixture(c, ws);
      const prior = await c.query(
        'select id, request_hash from context_batches where workspace_id = $1 and batch_operation_id = $2',
        [ws, req.batch_operation_id.toLowerCase()],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash)
          throw fail(
            'IDEMPOTENCY_CONFLICT',
            'This batch operation was already submitted with a different request.',
          );
        return { id: String(prior.rows[0].id), existing: true };
      }
      const { registry, cap } = await this.capabilityOf(
        c,
        ws,
        req.model,
        'batch',
      );
      const pricing = await this.pricingOf(c, ws, req.pricing_snapshot_id);
      const used = await c.query(
        'select 1 from budget_reservations where workspace_id = $1 and logical_operation_id = any($2::uuid[]) limit 1',
        [ws, req.items.map((i) => i.logical_operation_id.toLowerCase())],
      );
      let refusal: [string, string] | null = null;
      const r = capabilityRefusal(fixture, cap);
      if (r)
        refusal = [
          r,
          `Batch for ${modelKey(req.model)} is ${r.replace('capability_', '')} in this workspace.`,
        ];
      else if (pricing.snapshot_hash !== cap!.batch!.pricing_hash)
        refusal = [
          'batch_pricing_mismatch',
          'Batch items must be priced with the batch price the capability names, not another snapshot.',
        ];
      else if (req.items.length > cap!.batch!.max_items)
        refusal = [
          'batch_too_large',
          `At most ${cap!.batch!.max_items} items per batch.`,
        ];
      else if (!adapterAvailable)
        refusal = [
          'batch_adapter_missing',
          'No batch adapter is configured for this model here.',
        ];
      else if (used.rowCount)
        refusal = [
          'operation_reused',
          'A batch item reuses an operation id that already has attempts.',
        ];
      const batchId = randomUUID();
      await c.query(
        `insert into context_batches (id, workspace_id, fixture, run_id, batch_operation_id, request_hash,
           provider, model_id, pricing_snapshot_id, capability_registry_id, status, reason_code,
           explanation, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          batchId,
          ws,
          fixture,
          req.run_id.toLowerCase(),
          req.batch_operation_id.toLowerCase(),
          requestHash,
          req.model.provider,
          req.model.model_id,
          pricing.id,
          registry?.id ?? null,
          refusal ? 'refused' : 'submitting',
          refusal?.[0] ?? 'submitting',
          refusal?.[1] ?? 'Reserving each item before submission.',
          ctx.actorId,
        ],
      );
      for (const i of req.items)
        await c.query(
          `insert into context_batch_items (batch_id, custom_id, logical_operation_id, request)
           values ($1,$2,$3,$4)`,
          [batchId, i.custom_id, i.logical_operation_id.toLowerCase(), i],
        );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: refusal ? 'context.batch_refused' : 'context.batch_started',
        subjectKind: 'context_batch',
        subjectId: batchId,
        subjectVersion: null,
        contentHash: requestHash,
        payload: {
          model: modelKey(req.model),
          items: req.items.length,
          reason_code: refusal?.[0] ?? null,
        },
        relatedIds: [req.run_id.toLowerCase()],
      });
      return { id: batchId, existing: false };
    });
    const batch = await this.getBatch(ctx, ws, id.id);
    const caps = await this.tx((c) =>
      this.capabilityOf(c, ws, req.model, 'batch'),
    );
    const pricing = await this.tx((c) =>
      this.pricingOf(c, ws, req.pricing_snapshot_id),
    );
    return {
      batch,
      existing: id.existing,
      req,
      windowMs: caps.cap?.batch?.completion_window_ms ?? 60000,
      pricing: pricing.body,
    };
  }
  async attachBatchItem(
    ctx: CommandContext,
    ws: string,
    batchId: string,
    customId: string,
    reservationId: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      await c.query(
        `update context_batch_items i set reservation_id = $3 from context_batches b
         where b.id = i.batch_id and b.workspace_id = $4 and i.batch_id = $1 and i.custom_id = $2
           and i.reservation_id is null`,
        [uuid(batchId), customId, uuid(reservationId), ws],
      );
    });
  }
  async setBatchStatus(
    ctx: CommandContext,
    ws: string,
    batchId: string,
    v: {
      status: Batch['status'];
      reason: string;
      explanation: string;
      providerBatchId?: string;
    },
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const { rows } = await c.query(
        `update context_batches set status = $3, reason_code = $4, explanation = $5,
           provider_batch_id = coalesce($6, provider_batch_id), updated_at = clock_timestamp()
         where workspace_id = $1 and id = $2 and status <> $3
           and status not in ('completed','partial','failed','expired','refused') returning id`,
        [
          ws,
          uuid(batchId),
          v.status,
          v.reason,
          v.explanation.slice(0, 1200),
          v.providerBatchId ?? null,
        ],
      );
      if (rows[0])
        await this.append(c, ctx, {
          workspaceId: ws,
          action: `context.batch_${v.status}`,
          subjectKind: 'context_batch',
          subjectId: uuid(batchId),
          subjectVersion: null,
          contentHash: null,
          payload: { reason_code: v.reason },
        });
    });
  }
  async recordBatchFile(
    ctx: CommandContext,
    ws: string,
    batchId: string,
    fileId: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    batchId = uuid(batchId);
    if (!/^[A-Za-z0-9_-]{1,200}$/.test(fileId))
      throw fail('INVALID_CONTRACT', 'Invalid provider file ID.');
    await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const b = await c.query(
        'select id from context_batches where workspace_id=$1 and id=$2 for update',
        [ws, batchId],
      );
      if (!b.rowCount) throw fail('NOT_FOUND', 'Batch not found.');
      const count = await c.query(
        'select count(*)::int n from context_batch_files where batch_id=$1',
        [batchId],
      );
      if (
        count.rows[0].n >= 3 &&
        !(
          await c.query(
            'select 1 from context_batch_files where batch_id=$1 and file_id=$2',
            [batchId, fileId],
          )
        ).rowCount
      )
        throw fail(
          'LIMIT_EXCEEDED',
          'A batch has only input, output and error files.',
        );
      const inserted = await c.query(
        'insert into context_batch_files(batch_id,file_id) values($1,$2) on conflict do nothing returning file_id',
        [batchId, fileId],
      );
      if (inserted.rowCount)
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'context.batch_file_recorded',
          subjectKind: 'context_batch',
          subjectId: batchId,
          subjectVersion: null,
          contentHash: null,
          payload: { file_id: fileId },
        });
    });
  }
  async pendingBatchFiles(
    ctx: CommandContext,
    ws: string,
    batchId: string,
  ): Promise<string[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    batchId = uuid(batchId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const r = await c.query(
        'select f.file_id from context_batch_files f join context_batches b on b.id=f.batch_id where b.workspace_id=$1 and b.id=$2 and f.deleted_at is null order by f.file_id',
        [ws, batchId],
      );
      return r.rows.map((r) => String(r.file_id));
    });
  }
  async batchFileDeleted(
    ctx: CommandContext,
    ws: string,
    batchId: string,
    fileId: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    batchId = uuid(batchId);
    await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const r = await c.query(
        'update context_batch_files f set deleted_at=clock_timestamp() from context_batches b where f.batch_id=b.id and b.workspace_id=$1 and b.id=$2 and f.file_id=$3 and f.deleted_at is null returning f.file_id',
        [ws, batchId, fileId],
      );
      if (r.rowCount)
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'context.batch_file_deleted',
          subjectKind: 'context_batch',
          subjectId: batchId,
          subjectVersion: null,
          contentHash: null,
          payload: { file_id: fileId },
        });
    });
  }
  async getBatch(ctx: CommandContext, ws: string, id: string): Promise<Batch> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from context_batches where workspace_id = $1 and id = $2',
        [ws, uuid(id)],
      );
      const b = rows[0] as Row | undefined;
      if (!b) throw fail('NOT_FOUND', 'Batch not found.');
      const { rows: items } = await c.query(
        `select i.custom_id, i.logical_operation_id::text as op, i.reservation_id::text as rid,
           r.status, r.reason_code, r.incurred_nano::text as incurred, r.result
         from context_batch_items i left join budget_reservations r on r.id = i.reservation_id
         where i.batch_id = $1 order by i.custom_id`,
        [b.id],
      );
      return {
        id: String(b.id),
        workspace_id: String(b.workspace_id),
        fixture: Boolean(b.fixture),
        run_id: String(b.run_id),
        batch_operation_id: String(b.batch_operation_id),
        provider: b.provider as Batch['provider'],
        model_id: String(b.model_id),
        pricing_snapshot_id: String(b.pricing_snapshot_id),
        capability_registry_id:
          (b.capability_registry_id as string | null) ?? null,
        status: b.status as Batch['status'],
        reason_code: String(b.reason_code),
        explanation: String(b.explanation),
        provider_batch_id: (b.provider_batch_id as string | null) ?? null,
        items: items.map((i) => {
          const result = (i.result ?? null) as {
            output?: { text: string; json: unknown };
          } | null;
          return {
            custom_id: String(i.custom_id),
            logical_operation_id: String(i.op),
            reservation_id: (i.rid as string | null) ?? null,
            status: (i.status ?? 'denied') as Batch['items'][number]['status'],
            reason_code: String(i.reason_code ?? 'not_submitted'),
            late: i.reason_code === 'settled_late',
            incurred_nano: (i.incurred as string | null) ?? null,
            output: result?.output
              ? { text: result.output.text, json: result.output.json ?? null }
              : null,
          };
        }),
        created_by: String(b.created_by),
        created_at: iso(b.created_at),
        updated_at: iso(b.updated_at),
      };
    });
  }
  /** What a poll needs: each item's request and reservation, and the batch price. */
  async batchForPoll(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const batch = await this.getBatch(ctx, ws, id);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const { rows } = await c.query(
        'select custom_id, request from context_batch_items where batch_id = $1',
        [batch.id],
      );
      const pricing = await this.pricingOf(c, ws, batch.pricing_snapshot_id);
      const { rows: b } = await c.query(
        'select request_hash from context_batches where id = $1',
        [batch.id],
      );
      return {
        batch,
        pricing: pricing.body,
        requests: new Map(
          rows.map((r) => [
            String(r.custom_id),
            r.request as SubmitBatchRequest['items'][number],
          ]),
        ),
        request_hash: String(b[0]?.request_hash),
      };
    });
  }

  // ---- Quality and total-cost comparison ---------------------------------------------

  async createContextEvaluation(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ContextEvaluation> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(ContextEvaluationRequestSchema, raw);
    const manifestHash = canonicalHash(req);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const fixture = await this.wsFixture(c, ws);
      const prior = await c.query(
        'select * from context_evaluations where workspace_id = $1 and manifest_hash = $2',
        [ws, manifestHash],
      );
      if (prior.rows[0]) return toEvaluation(prior.rows[0] as Row);
      const base = await this.packIn(c, ws, req.baseline_pack_id);
      const cand = await this.packIn(c, ws, req.candidate_pack_id);
      if (base.id === cand.id)
        throw fail('INVALID_CONTRACT', 'Compare two different packs.');
      if (base.data_class !== cand.data_class)
        throw fail(
          'SCOPE_EXCEEDED',
          'Both packs must carry the same data class.',
        );
      const pricing = await this.pricingOf(c, ws, req.pricing_snapshot_id);
      if (
        req.model &&
        (pricing.body.provider !== req.model.provider ||
          pricing.body.model_id !== req.model.model_id)
      )
        throw fail(
          'PRICING_MISSING',
          'That pricing is not for the named model.',
        );
      const id = randomUUID();
      const { rows } = await c.query(
        `insert into context_evaluations (id, workspace_id, fixture, run_id, manifest_hash, request,
           state, created_by) values ($1,$2,$3,$4,$5,$6,'pending',$7) returning *`,
        [
          id,
          ws,
          fixture,
          req.run_id.toLowerCase(),
          manifestHash,
          req,
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'context.evaluation_created',
        subjectKind: 'context_evaluation',
        subjectId: id,
        subjectVersion: null,
        contentHash: manifestHash,
        payload: {
          baseline_pack_id: base.id,
          candidate_pack_id: cand.id,
          cases: req.cases.length,
        },
        relatedIds: [base.id, cand.id],
      });
      return toEvaluation(rows[0] as Row);
    });
  }
  /** Every broker request the comparison needs, in order. */
  async contextEvaluationPlan(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const ev = await this.evaluationIn(c, ws, id);
      const packs = {
        baseline: await this.packIn(c, ws, ev.request.baseline_pack_id),
        candidate: await this.packIn(c, ws, ev.request.candidate_pack_id),
      };
      const calls: BrokerCallRequest[] = [];
      for (const arm of ['baseline', 'candidate'] as const)
        for (const k of ev.request.cases)
          calls.push(
            evaluationBrokerRequest(ev.id, ev.request, arm, packs[arm], k),
          );
      return { evaluation: ev, calls };
    });
  }
  private async evaluationIn(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      'select * from context_evaluations where workspace_id = $1 and id = $2',
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Context evaluation not found.');
    return toEvaluation(rows[0] as Row);
  }
  /** Overhead spent producing a pack: its compaction calls, back along the chain. */
  private async packOverhead(c: PoolClient, ws: string, pack: ContextPack) {
    const ops: string[] = [];
    let at: string | null = pack.id;
    for (let depth = 0; at && depth < 20; depth += 1) {
      const { rows }: { rows: Row[] } = await c.query(
        `select k.operation_id::text as op, p.compacted_from::text as parent from context_packs p
         left join context_compactions k on k.result_pack_id = p.id where p.workspace_id = $1 and p.id = $2`,
        [ws, at],
      );
      if (rows[0]?.op) ops.push(String(rows[0].op));
      at = (rows[0]?.parent as string | null) ?? null;
    }
    return this.costOf(c, ws, ops);
  }
  /** Scores each case from the broker's records for exactly the planned requests. */
  async recordContextEvaluation(
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<ContextEvaluation> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const { rows: locked } = await c.query(
        'select * from context_evaluations where workspace_id = $1 and id = $2 for update',
        [ws, uuid(id)],
      );
      if (!locked[0]) throw fail('NOT_FOUND', 'Context evaluation not found.');
      const ev = toEvaluation(locked[0] as Row);
      if (ev.state === 'evaluated') return ev;
      const arms = {} as Record<
        'baseline' | 'candidate',
        Parameters<typeof compareContextArms>[0]['baseline']
      >;
      for (const arm of ['baseline', 'candidate'] as const) {
        const pack = await this.packIn(
          c,
          ws,
          arm === 'baseline'
            ? ev.request.baseline_pack_id
            : ev.request.candidate_pack_id,
        );
        let accepted = 0;
        const ops: string[] = [];
        for (const k of ev.request.cases) {
          const request = evaluationBrokerRequest(
            ev.id,
            ev.request,
            arm,
            pack,
            k,
          );
          const last = await this.lastAttempt(
            c,
            ws,
            request.logical_operation_id,
          );
          if (!last || last.status === 'denied' || last.status === 'in_flight')
            throw fail(
              'MISSING_EVIDENCE',
              `Case ${k.case_id} (${arm}) has no finished broker call yet.`,
            );
          if (
            String(last.request_hash) !== brokerRequestHash(ev.run_id, request)
          )
            throw fail(
              'EVIDENCE_MISMATCH',
              `Case ${k.case_id} (${arm}) was not answered for the planned request.`,
            );
          const result = (last.result ?? {}) as {
            status?: string;
            reason_code?: string;
            output?: { text: string; json: unknown } | null;
          };
          const signal = checkOutput(k.check, result.output ?? null, {
            succeeded: result.status === 'succeeded',
            reason_code: result.reason_code ?? String(last.status),
          });
          if (signal === 'accepted') accepted += 1;
          ops.push(request.logical_operation_id);
        }
        arms[arm] = {
          pack_id: pack.id,
          pack_hash: pack.pack_hash,
          tokens: pack.tokens,
          cases: ev.request.cases.length,
          accepted,
          calls: await this.costOf(c, ws, ops),
          overhead: await this.packOverhead(c, ws, pack),
        };
      }
      const result = compareContextArms({
        fixture: ev.fixture,
        max_regression: ev.request.max_regression,
        baseline: arms.baseline,
        candidate: arms.candidate,
      });
      const { rows } = await c.query(
        `update context_evaluations set state = 'evaluated', result = $3, evaluated_at = clock_timestamp()
         where workspace_id = $1 and id = $2 returning *`,
        [ws, ev.id, result],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'context.evaluation_recorded',
        subjectKind: 'context_evaluation',
        subjectId: ev.id,
        subjectVersion: null,
        contentHash: ev.manifest_hash,
        payload: {
          quality_maintained: result.quality_maintained,
          savings_claim: result.savings_claim,
        },
      });
      return toEvaluation(rows[0] as Row);
    });
  }
  async getContextEvaluation(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.evaluationIn(c, ws, id);
    });
  }

  // ---- Usage report ------------------------------------------------------------------

  /**
   * Overhead and savings, each traceable to reservations: provider prompt caching from usage
   * records; result-cache reuse from the source calls each hit avoided; compaction and batch
   * cost from their own operations. Fixture numbers are simulated units, never claimed.
   */
  async contextUsage(
    ctx: CommandContext,
    ws: string,
    runId: string | null,
  ): Promise<ContextUsageReport> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const run = runId ? uuid(runId) : null;
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const fixture = await this.wsFixture(c, ws);
      const { rows: usage } = await c.query(
        `select r.id::text, u.usage, p.body as pricing from budget_reservations r
           join usage_records u on u.reservation_id = r.id
           join pricing_snapshots p on p.id = r.pricing_snapshot_id
         where r.workspace_id = $1 and ($2::uuid is null or r.run_id = $2) and r.status = 'settled'
           and r.action_type like 'model.%' order by r.created_at`,
        [ws, run],
      );
      let uncached = 0;
      let cached = 0;
      let written = 0;
      let saving = 0n;
      const cachedIds: string[] = [];
      for (const r of usage) {
        const u = r.usage as {
          uncached_input_tokens: number;
          cached_input_tokens: number;
          cache_write_tokens: number;
        };
        const rates = (r.pricing as PricingSnapshotBody).rates;
        uncached += u.uncached_input_tokens;
        cached += u.cached_input_tokens;
        written += u.cache_write_tokens;
        saving +=
          BigInt(u.cached_input_tokens) *
            (big(rates.input) - big(rates.cached_input)) -
          BigInt(u.cache_write_tokens) *
            (big(rates.cache_write) - big(rates.input));
        if (
          (u.cached_input_tokens || u.cache_write_tokens) &&
          cachedIds.length < 200
        )
          cachedIds.push(String(r.id));
      }
      const { rows: events } = await c.query(
        `select kind, cache_entry_id::text as entry, detail from context_events
         where workspace_id = $1 and ($2::uuid is null or run_id = $2)`,
        [ws, run],
      );
      const count = (k: string) => events.filter((e) => e.kind === k).length;
      const hits = events.filter((e) => e.kind === 'cache_hit');
      const sources = hits.map((h) =>
        String((h.detail as Row).source_operation_id),
      );
      const avoided = sumCosts(
        await Promise.all(sources.map((op) => this.costOf(c, ws, [op]))),
      );
      const { rows: comp } = await c.query(
        `select k.status, k.operation_id::text as op from context_compactions k
           join context_packs p on p.id = k.pack_id
         where k.workspace_id = $1 and ($2::uuid is null or p.run_id = $2)`,
        [ws, run],
      );
      const compOps = comp.filter((k) => k.op).map((k) => String(k.op));
      const { rows: items } = await c.query(
        `select r.status, r.reason_code, i.logical_operation_id::text as op from context_batch_items i
           join context_batches b on b.id = i.batch_id
           left join budget_reservations r on r.id = i.reservation_id
         where b.workspace_id = $1 and ($2::uuid is null or b.run_id = $2)`,
        [ws, run],
      );
      const { rows: batchCount } = await c.query<{ n: number }>(
        `select count(*)::int as n from context_batches where workspace_id = $1 and ($2::uuid is null or run_id = $2)`,
        [ws, run],
      );
      const st = (s: string) => items.filter((i) => i.status === s).length;
      const batchCost = await this.costOf(
        c,
        ws,
        items.filter((i) => i.status).map((i) => String(i.op)),
      );
      const { rows: evals } = await c.query(
        `select result from context_evaluations where workspace_id = $1 and ($2::uuid is null or run_id = $2)
           and state = 'evaluated'`,
        [ws, run],
      );
      const overhead = await this.costOf(c, ws, compOps);
      const anything = hits.length > 0 || cached > 0;
      const unknown =
        avoided.unknown_nano !== '0' ||
        overhead.unknown_nano !== '0' ||
        batchCost.unknown_nano !== '0';
      return {
        workspace_id: ws,
        fixture,
        run_id: run,
        generated_at: new Date().toISOString(),
        provider_prompt_cache: {
          settled_calls: usage.length,
          uncached_input_tokens: uncached,
          cached_input_tokens: cached,
          cache_write_tokens: written,
          net_saving_nano: saving.toString(),
          basis: usage.length
            ? fixture
              ? 'fixture_simulation'
              : 'provider_usage'
            : 'none',
          reservation_ids: cachedIds,
        },
        result_cache: {
          hits: hits.length,
          refused_hits: count('cache_hit_refused'),
          misses: count('cache_miss'),
          stores: count('cache_store'),
          invalidations: count('cache_invalidated'),
          avoided,
          source_operation_ids: [...new Set(sources)].slice(0, 200),
        },
        compaction: {
          attempts: comp.length,
          accepted: comp.filter((k) => k.status === 'accepted').length,
          rejected: comp.filter((k) => k.status === 'rejected').length,
          refused: comp.filter((k) => k.status === 'refused').length,
          overhead,
          operation_ids: compOps.slice(0, 200),
        },
        batches: {
          batches: Number(batchCount[0]?.n ?? 0),
          items: items.length,
          settled: st('settled'),
          late_settled: items.filter((i) => i.reason_code === 'settled_late')
            .length,
          released: st('released'),
          unknown: st('unknown'),
          in_flight: st('in_flight'),
          denied: items.filter((i) => !i.status || i.status === 'denied')
            .length,
          cost: batchCost,
        },
        evaluations: {
          evaluated: evals.length,
          quality_maintained: evals.filter(
            (e) => (e.result as Row).quality_maintained === true,
          ).length,
        },
        savings_claim: fixture
          ? 'not_claimed_fixture'
          : !anything
            ? 'not_claimed_no_data'
            : unknown
              ? 'not_claimed_unknown_cost'
              : 'measured',
        notes: [
          'Provider prompt-cache savings use each call’s pricing snapshot rates and ignore long-context multipliers.',
          'Result-cache avoided cost is the recorded cost of the source call, counted once per hit.',
          ...(fixture
            ? [
                'Fixture workspace: all amounts are simulated units; no saving is claimed.',
              ]
            : []),
        ],
      };
    });
  }
}
