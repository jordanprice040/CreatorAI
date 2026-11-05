import type { PoolClient } from 'pg';
import {
  z,
  SearchQuerySchema,
  StoredKindSchema,
  parse,
  LibrarySortSchema,
  StoredStatusSchema,
  type ActivityPage,
  type ActorSummary,
  type Destination,
  type LibraryPage,
  type LibrarySort,
  type SearchSort,
  type ClaimEvidence,
  type Overview,
  type ProblemComparison,
  type SearchCoverageSchema,
  type SearchHit,
  type SearchQuery,
  type SearchResult,
  type SearchType,
  type Snippet,
  type StoredEntity,
} from '@creator/contracts';
import { localTimestamp } from '@creator/domain';
import { createHash } from 'node:crypto';
import { SelectionStore } from './selection-store.js';
import {
  fail,
  iso,
  normalize,
  toEntity,
  toHistory,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

// Highlight markers ts_headline puts around matches. Control characters cannot appear in
// validated record text, so splitting on them never cuts stored content.
const START = '\u0002';
const STOP = '\u0003';
const HEADLINE = `StartSel=${START}, StopSel=${STOP}, MaxWords=26, MinWords=10, MaxFragments=2, FragmentDelimiter=" … "`;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PREFIX_RE = /^[0-9a-f]{8}[0-9a-f-]{0,27}$/i;
// The same expressions as the migration 8 indexes, so the planner can use them.
export const ENTITY_DOC = `(to_tsvector('english'::regconfig, e.title)
  || jsonb_to_tsvector('english'::regconfig, coalesce(e.body, '{}'::jsonb), '["string"]'))`;
// Snippet text skips ids and hashes, which are noise to a reader; id search is separate.
export const ENTITY_TEXT = `(e.title || ' · ' || coalesce((select string_agg(v #>> '{}', ' · ')
  from jsonb_path_query(coalesce(e.body, '{}'::jsonb), 'strict $.**') v
  where jsonb_typeof(v) = 'string' and (v #>> '{}') !~ '^[0-9a-f-]{32,}$'), ''))`;
export const PASSAGE_DOC = `to_tsvector('english'::regconfig, coalesce(p.excerpt, ''))`;
export const DECISION_DOC = `jsonb_to_tsvector('english'::regconfig, d.request, '["string"]')`;
const HISTORY_DOC = `to_tsvector('english'::regconfig, h.summary)`;

/**
 * P02 page cursors. A cursor names the sort, the type and a hash of the filters it was made
 * under, so a page can never be continued under a different order or query. Time orders seek
 * past the last row's exact (microsecond) time and id; relevance continues by position.
 */
type Cursor = {
  s: string;
  ty: string;
  f: string;
  t?: string;
  i?: string;
  o?: number;
};
const encodeCursor = (c: Cursor) =>
  Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
const STALE_CURSOR =
  'That page cursor belongs to another order or filter; start again.';
function decodeCursor(raw: string, s: string, ty: string, f: string): Cursor {
  let c: Cursor;
  try {
    c = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as Cursor;
  } catch {
    throw fail(
      'INVALID_CONTRACT',
      'That page cursor is not valid; start again.',
    );
  }
  const ok =
    c !== null &&
    typeof c === 'object' &&
    c.s === s &&
    c.ty === ty &&
    c.f === f &&
    (c.o === undefined
      ? typeof c.t === 'string' &&
        c.t.length <= 64 &&
        typeof c.i === 'string' &&
        c.i.length <= 300
      : Number.isInteger(c.o) && c.o >= 0 && c.o <= 100_000);
  if (!ok) throw fail('INVALID_CONTRACT', STALE_CURSOR);
  return c;
}
const filterHash = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16);
/** Subjects whose existence the destination check reads from the entities table. */
const ENTITY_KINDS = new Set<string>(StoredKindSchema.options);
const SUBJECT_KIND_RE = /^[a-z_]{1,40}$/;
const entityState = (status: unknown): 'available' | 'archived' | 'redacted' =>
  status === 'redacted'
    ? 'redacted'
    : status === 'archived'
      ? 'archived'
      : 'available';

/** Splits a ts_headline result into plain and matched segments. */
export function segments(headline: string | null | undefined): Snippet {
  if (!headline) return [];
  const out: Snippet = [];
  let match = false;
  let buf = '';
  const push = () => {
    if (buf) out.push({ text: buf.slice(0, 600), match });
    buf = '';
  };
  for (const ch of headline) {
    if (ch === START || ch === STOP) {
      push();
      match = ch === START;
    } else buf += ch;
  }
  push();
  return out.slice(0, 40);
}
type SearchCoverage = z.infer<typeof SearchCoverageSchema>;
const money = (v: unknown) => BigInt(String(v)).toString();
/** A stable UUID-shaped id for something without its own row (a model). */
export function nameId(name: string): string {
  const h = createHash('sha256').update(name).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const ACTIVITY_ACTION_RE = /^[a-z_]+(\.[a-z_]*)?$/;
const ATTENTION_STATES = [
  'waiting_human',
  'paused_operator',
  'reconciling',
  'failed',
];

/**
 * T09 catalog reads. Each method checks membership first (non-members learn nothing, not even
 * counts) and reads only stored, already-safe text: redaction removes a record's title and
 * body and a passage's excerpt, so search cannot surface what was redacted.
 */
export class CatalogStore extends SelectionStore {
  async search(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<SearchResult> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const query = parse(SearchQuerySchema, raw);
    const q = query.q;
    const mode =
      q === ''
        ? 'browse'
        : UUID_RE.test(q) || PREFIX_RE.test(q)
          ? 'id'
          : 'text';
    return this.tx(async (c) => {
      // Membership first: a non-member gets no hit, count, coverage or freshness figure.
      await this.role(c, ws, ctx.actorId, false);
      await c.query('set transaction read only');
      const head = (
        await c.query(
          `select w.fixture, now() as as_of,
                  (select count(*) from outbox o join audit_events a on a.id = o.event_id
                    where a.workspace_id = $1 and o.delivered_at is null) as pending
             from workspaces w where w.id = $1`,
          [ws],
        )
      ).rows[0] as Row;
      const hits: SearchHit[] = [];
      const counts: SearchResult['counts'] = {};
      const coverage: SearchResult['coverage'] = {};
      const next: SearchResult['next'] = {};
      // Relevance needs words; an id search or browse is read newest first and says so.
      const order: SearchSort =
        query.sort === 'relevance' && mode !== 'text' ? 'newest' : query.sort;
      let truncated = false;
      for (const type of query.types) {
        const page = await this.searchType(c, ws, type, mode, query, order);
        counts[type] = page.total;
        if (page.next) {
          truncated = true;
          next[type] = page.next;
        }
        hits.push(...page.rows);
        coverage[type] = await this.searchCoverage(c, ws, type);
      }
      return {
        query,
        mode,
        fixture: Boolean(head.fixture),
        hits,
        counts,
        truncated,
        order,
        next,
        coverage,
        freshness: {
          as_of: iso(head.as_of),
          activity_pending: Number(head.pending ?? 0),
        },
      };
    });
  }

  /** What one type could match in this workspace, and what it can never show. */
  private async searchCoverage(
    c: PoolClient,
    ws: string,
    type: SearchType,
  ): Promise<SearchCoverage> {
    const one = async (sql: string) =>
      (await c.query(sql, [ws])).rows[0] as Row;
    const cov = (
      searchable: unknown,
      latest: unknown,
      excluded: Partial<SearchCoverage['excluded']> = {},
    ): SearchCoverage => ({
      searchable: Number(searchable ?? 0),
      excluded: { redacted: 0, no_text: 0, unsupported_media: 0, ...excluded },
      latest_change_at:
        latest === null || latest === undefined ? null : iso(latest),
    });
    if (type === 'record') {
      const r = await one(
        `select count(*) filter (where status <> 'redacted') as s,
                count(*) filter (where status = 'redacted') as r, max(updated_at) as l
           from entities where workspace_id = $1`,
      );
      return cov(r.s, r.l, { redacted: Number(r.r) });
    }
    if (type === 'passage') {
      const r = await one(
        `select count(*) filter (where p.excerpt is not null and e.status <> 'redacted') as s,
                count(*) filter (where e.status = 'redacted') as r,
                count(*) filter (where p.excerpt is null and e.status <> 'redacted') as n,
                max(p.created_at) as l,
                (select count(*) from source_retrievals where workspace_id = $1
                   and state in ('unsupported_type', 'too_large')) as u
           from source_passages p
           join entities e on e.workspace_id = p.workspace_id and e.id = p.source_id
          where p.workspace_id = $1`,
      );
      return cov(r.s, r.l, {
        redacted: Number(r.r),
        no_text: Number(r.n),
        unsupported_media: Number(r.u),
      });
    }
    if (type === 'decision') {
      const r = await one(
        'select count(*) as s, max(created_at) as l from decision_requests where workspace_id = $1',
      );
      return cov(r.s, r.l);
    }
    if (type === 'activity') {
      const r = await one(
        'select count(*) as s, max(occurred_at) as l from history_projection where workspace_id = $1',
      );
      return cov(r.s, r.l);
    }
    if (type === 'code_version') {
      const r = await one(
        `select count(*) as s, count(*) filter (where e.status = 'redacted') as r,
                max(am.created_at) as l
           from artifact_manifests am
           join entities e on e.workspace_id = am.workspace_id and e.id = am.entity_id
          where am.workspace_id = $1`,
      );
      return cov(r.s, r.l, { redacted: Number(r.r) });
    }
    if (type === 'model') {
      const r = await one(
        `select count(distinct (provider, model_id)) as s, max(created_at) as l
           from budget_reservations where workspace_id = $1`,
      );
      return cov(r.s, r.l);
    }
    const r = await one(
      'select count(*) as s, max(created_at) as l from budget_reservations where workspace_id = $1',
    );
    return cov(r.s, r.l);
  }

  private async searchType(
    c: PoolClient,
    ws: string,
    type: SearchType,
    mode: 'browse' | 'id' | 'text',
    query: SearchQuery,
    order: SearchSort,
  ): Promise<{ rows: SearchHit[]; total: number; next: string | null }> {
    // Every value is a bound parameter; the SQL below is fixed text chosen by type and mode.
    const args: unknown[] = [ws];
    const p = (v: unknown) => {
      args.push(v);
      return `$${args.length}`;
    };
    // Parameters are added on first use, so no unused (untyped) parameter is ever sent.
    const once = (v: () => unknown) => {
      let ref: string | null = null;
      return () => (ref ??= p(v()));
    };
    const full = mode === 'id' && UUID_RE.test(query.q);
    // Id mode: exact id, or an id prefix of 8+ characters (as the interface abbreviates ids).
    const idRef = once(() => query.q.toLowerCase());
    const idMatch = (col: string) =>
      full
        ? `${col} = ${idRef()}::uuid`
        : `${col}::text like ${idRef()} || '%'`;
    const match: SearchHit['match'] =
      mode === 'id' ? (full ? 'id' : 'id_prefix') : 'text';
    // The filters a cursor is bound to: the same words, filters and dates, nothing else.
    const bound = filterHash([
      query.q,
      query.kind,
      query.status,
      query.from,
      query.to,
      query.tz,
    ]);
    const cursor =
      query.after === null
        ? null
        : decodeCursor(query.after, query.sort, type, bound);
    /**
     * P02: reads one type in the chosen order, on the server, before the limit. `inner` must
     * select `sort_at` (a timestamptz), `sort_id` (text) and, when it can rank, `sort_rank`;
     * `total` counts every match before paging. One row past the limit tells whether a next
     * page exists.
     */
    const paged = async (
      inner: string,
      ranked: boolean,
      prefix = '',
    ): Promise<{ rows: Row[]; total: number; next: string | null }> => {
      const byRank = order === 'relevance' && ranked;
      const dir = order === 'oldest' ? 'asc' : 'desc';
      let seek = 'true';
      let offset = 0;
      if (cursor && byRank) {
        if (cursor.o === undefined)
          throw fail('INVALID_CONTRACT', STALE_CURSOR);
        offset = cursor.o;
      } else if (cursor) {
        if (cursor.t === undefined || cursor.i === undefined)
          throw fail('INVALID_CONTRACT', STALE_CURSOR);
        seek = `(x.sort_at, x.sort_id) ${dir === 'asc' ? '>' : '<'} (${p(cursor.t)}::timestamptz, ${p(cursor.i)}::text)`;
      }
      const sql = `${prefix} select x.*, x.sort_at::text as cursor_at from (${inner}) x
         where ${seek}
         order by ${byRank ? 'x.sort_rank desc, ' : ''}x.sort_at ${dir}, x.sort_id ${dir}
         limit ${p(query.limit + 1)}${offset ? ` offset ${p(offset)}` : ''}`;
      const { rows } = await c.query(sql, args);
      const page = (rows as Row[]).slice(0, query.limit);
      const last = page[page.length - 1];
      const more = rows.length > query.limit && last !== undefined;
      return {
        rows: page,
        // `total` is computed before the seek, so it is the same on every page.
        total: Number(rows[0]?.total ?? 0),
        next: !more
          ? null
          : encodeCursor(
              byRank
                ? { s: query.sort, ty: type, f: bound, o: offset + page.length }
                : {
                    s: query.sort,
                    ty: type,
                    f: bound,
                    t: String(last.cursor_at),
                    i: String(last.sort_id),
                  },
            ),
      };
    };
    const tqRef = once(() => query.q);
    const tq = () => `websearch_to_tsquery('english', ${tqRef()})`;
    const likeRef = once(() => like(query.q));
    const optsRef = once(() => HEADLINE);
    const tzRef = once(() => query.tz);
    const within = (col: string) =>
      [
        query.from
          ? `${col} >= (${p(query.from)}::date)::timestamp at time zone ${tzRef()}`
          : null,
        query.to
          ? `${col} < ((${p(query.to)}::date + 1)::timestamp at time zone ${tzRef()})`
          : null,
      ]
        .filter(Boolean)
        .join(' and ') || 'true';
    const local = (v: unknown) => localTimestamp(iso(v), query.tz);
    const base = {
      type,
      match,
      amounts: null,
    } as const;
    if (type === 'record') {
      const kind = p(query.kind);
      const status = p(query.status);
      const where =
        mode === 'browse'
          ? 'true'
          : mode === 'id'
            ? idMatch('e.id')
            : `(${ENTITY_DOC} @@ ${tq()} or e.title ilike ${likeRef()})`;
      const headline =
        mode === 'text'
          ? `ts_headline('english', ${ENTITY_TEXT}, ${tq()}, ${optsRef()})`
          : `left(${ENTITY_TEXT}, 240)`;
      const rank = mode === 'text' ? `ts_rank(${ENTITY_DOC}, ${tq()})` : '0';
      const { rows, total, next } = await paged(
        `select e.*, ${headline} as headline, count(*) over () as total,
                e.created_at as sort_at, e.id::text as sort_id, ${rank} as sort_rank
           from entities e
          where e.workspace_id = $1 and (${kind}::text is null or e.kind = ${kind})
            and (${status}::text is null or e.status = ${status}) and ${where}
            and ${within('e.created_at')}`,
        mode === 'text',
      );
      return {
        total,
        next,
        rows: rows.map((r: Row) => ({
          ...base,
          id: String(r.id),
          kind: String(r.kind),
          title: String(r.title),
          status: String(r.status),
          version: Number(r.version),
          snippet: segments(r.headline as string | null),
          // P02: Newest means created, so a record shows the time it is ordered by.
          occurred_at: iso(r.created_at),
          occurred_local: local(r.created_at),
          subject: { id: String(r.id), kind: String(r.kind) },
        })),
      };
    }
    if (type === 'passage') {
      // Passages need a query; a browse lists none. Redacted sources have no excerpt left.
      if (mode === 'browse') return { rows: [], total: 0, next: null };
      const where =
        mode === 'id' ? idMatch('p.id') : `${PASSAGE_DOC} @@ ${tq()}`;
      const headline =
        mode === 'text'
          ? `ts_headline('english', p.excerpt, ${tq()}, ${optsRef()})`
          : 'left(p.excerpt, 240)';
      const rank = mode === 'text' ? `ts_rank(${PASSAGE_DOC}, ${tq()})` : '0';
      const { rows, total, next } = await paged(
        `select p.id, p.source_id, p.source_version, p.ordinal, p.created_at, e.title,
                e.status, e.version as current_version, ${headline} as headline,
                count(*) over () as total, p.created_at as sort_at,
                p.id::text as sort_id, ${rank} as sort_rank
           from source_passages p
           join entities e on e.workspace_id = p.workspace_id and e.id = p.source_id
          where p.workspace_id = $1 and p.excerpt is not null and e.status <> 'redacted'
            and ${where} and ${within('p.created_at')}`,
        mode === 'text',
      );
      return {
        total,
        next,
        rows: rows.map((r: Row) => ({
          ...base,
          id: String(r.id),
          kind: 'passage',
          title: `${String(r.title)} · passage ${Number(r.ordinal) + 1}`,
          status:
            Number(r.source_version) === Number(r.current_version)
              ? 'current'
              : `older source version (v${String(r.source_version)} of v${String(r.current_version)})`,
          version: Number(r.source_version),
          snippet: segments(r.headline as string | null),
          occurred_at: iso(r.created_at),
          occurred_local: local(r.created_at),
          subject: { id: String(r.source_id), kind: 'source' },
        })),
      };
    }
    if (type === 'decision') {
      const where =
        mode === 'browse'
          ? 'true'
          : mode === 'id'
            ? idMatch('d.id')
            : `(${DECISION_DOC} @@ ${tq()} or d.request->>'question' ilike ${likeRef()})`;
      const text = `(d.request->>'question') || ' · ' || coalesce(d.request->>'uncertainty', '')`;
      const headline =
        mode === 'text'
          ? `ts_headline('english', ${text}, ${tq()}, ${optsRef()})`
          : `left(${text}, 240)`;
      const rank = mode === 'text' ? `ts_rank(${DECISION_DOC}, ${tq()})` : '0';
      const { rows, total, next } = await paged(
        `select d.id, d.kind, d.status, d.version, d.run_id, d.created_at,
                d.request->>'question' as question, ${headline} as headline,
                count(*) over () as total, d.created_at as sort_at,
                d.id::text as sort_id, ${rank} as sort_rank
           from decision_requests d
          where d.workspace_id = $1 and ${where} and ${within('d.created_at')}`,
        mode === 'text',
      );
      return {
        total,
        next,
        rows: rows.map((r: Row) => ({
          ...base,
          id: String(r.id),
          kind: `${String(r.kind)} decision`,
          title: String(r.question).slice(0, 500),
          status: String(r.status),
          version: Number(r.version),
          snippet: segments(r.headline as string | null),
          occurred_at: iso(r.created_at),
          occurred_local: local(r.created_at),
          subject: { id: String(r.run_id), kind: 'run' },
        })),
      };
    }
    if (type === 'code_version') {
      // Artifact commits and manifests. A redacted artifact keeps its commit and hashes
      // (identity, like any tombstone) but its manifest text is no longer searchable.
      const where =
        mode === 'browse'
          ? 'true'
          : mode === 'id'
            ? `(${idMatch('am.id')} or ${idMatch('am.entity_id')}
                or am.commit like ${idRef()} || '%' or am.manifest_sha256 like ${idRef()} || '%')`
            : `e.status <> 'redacted' and (jsonb_to_tsvector('english'::regconfig, am.manifest, '["string"]') @@ ${tq()}
                or e.title ilike ${likeRef()})`;
      const text = `e.title || ' · commit ' || am.commit || ' · ' || am.state`;
      const headline =
        mode === 'text'
          ? `ts_headline('english', ${text}, ${tq()}, ${optsRef()})`
          : text;
      const { rows, total, next } = await paged(
        `select am.id, am.entity_id, am.commit, am.state, am.spec_version, am.created_at,
                e.title, ${headline} as headline, count(*) over () as total,
                am.created_at as sort_at, am.id::text as sort_id
           from artifact_manifests am
           join entities e on e.workspace_id = am.workspace_id and e.id = am.entity_id
          where am.workspace_id = $1 and ${where} and ${within('am.created_at')}`,
        false,
      );
      return {
        total,
        next,
        rows: rows.map((r: Row) => ({
          ...base,
          id: String(r.id),
          kind: 'code_version',
          title: `${String(r.title)} @ ${String(r.commit).slice(0, 12)}`.slice(
            0,
            500,
          ),
          status: String(r.state),
          version: Number(r.spec_version),
          snippet: segments(r.headline as string | null),
          occurred_at: iso(r.created_at),
          occurred_local: local(r.created_at),
          subject: { id: String(r.entity_id), kind: 'artifact' },
        })),
      };
    }
    if (type === 'model') {
      // Models this workspace actually called (or was denied), with exact totals per model.
      if (mode === 'id') return { rows: [], total: 0, next: null };
      const where =
        mode === 'browse'
          ? 'true'
          : `(m.model_id ilike ${likeRef()} or m.provider ilike ${likeRef()})`;
      const { rows, total, next } = await paged(
        `select m.*, count(*) over () as total, m.last_at as sort_at,
                (m.provider || '/' || m.model_id) as sort_id
           from m where ${where}`,
        false,
        `with m as (
           select provider, model_id, count(*) filter (where status <> 'denied') as calls,
                  count(*) filter (where status = 'denied') as denied,
                  coalesce(sum(reserved_nano) filter (where status = 'in_flight'), 0) as reserved,
                  coalesce(sum(incurred_nano) filter (where status = 'settled'), 0) as incurred,
                  coalesce(sum(reserved_nano) filter (where status = 'unknown'), 0) as unknown,
                  bool_and(fixture) as fixture, max(created_at) as last_at
             from budget_reservations
            where workspace_id = $1 and ${within('created_at')}
            group by provider, model_id)`,
      );
      return {
        total,
        next,
        rows: rows.map((r: Row) => ({
          ...base,
          id: nameId(`model:${String(r.provider)}/${String(r.model_id)}`),
          kind: 'model',
          title: `${String(r.provider)}/${String(r.model_id)}`.slice(0, 500),
          status: `${String(r.calls)} calls`,
          version: null,
          snippet: [
            {
              text: `${String(r.calls)} calls, ${String(r.denied)} denied; last used ${iso(r.last_at)}`,
              match: false,
            },
          ],
          occurred_at: iso(r.last_at),
          occurred_local: local(r.last_at),
          subject: null,
          amounts: {
            reserved: money(r.reserved),
            incurred: money(r.incurred),
            unknown: money(r.unknown),
            fixture: Boolean(r.fixture),
          },
        })),
      };
    }
    if (type === 'cost') {
      const where =
        mode === 'browse'
          ? 'true'
          : mode === 'id'
            ? `(${idMatch('r.id')} or ${idMatch('r.logical_operation_id')} or ${idMatch('r.run_id')})`
            : `(r.action_type ilike ${likeRef()} or r.model_id ilike ${likeRef()} or r.reason_code ilike ${likeRef()}
                or r.status ilike ${likeRef()} or to_tsvector('english'::regconfig, r.explanation) @@ ${tq()})`;
      const headline =
        mode === 'text'
          ? `ts_headline('english', r.explanation, ${tq()}, ${optsRef()})`
          : 'left(r.explanation, 240)';
      const { rows, total, next } = await paged(
        `select r.id, r.run_id, r.action_type, r.provider, r.model_id, r.attempt, r.status,
                r.reserved_nano, r.incurred_nano, r.fixture, r.created_at,
                ${headline} as headline, count(*) over () as total,
                r.created_at as sort_at, r.id::text as sort_id
           from budget_reservations r
          where r.workspace_id = $1 and ${where} and ${within('r.created_at')}`,
        false,
      );
      return {
        total,
        next,
        rows: rows.map((r: Row) => ({
          ...base,
          id: String(r.id),
          kind: String(r.action_type),
          title:
            `${String(r.action_type)} · ${String(r.provider)}/${String(r.model_id)} · attempt ${String(r.attempt)}`.slice(
              0,
              500,
            ),
          status: String(r.status),
          version: null,
          snippet: segments(r.headline as string | null),
          occurred_at: iso(r.created_at),
          occurred_local: local(r.created_at),
          subject: { id: String(r.run_id), kind: 'run' },
          amounts: {
            reserved: r.status === 'in_flight' ? money(r.reserved_nano) : '0',
            incurred: r.incurred_nano === null ? '0' : money(r.incurred_nano),
            unknown: r.status === 'unknown' ? money(r.reserved_nano) : '0',
            fixture: Boolean(r.fixture),
          },
        })),
      };
    }
    // Activity: the audit history's safe summaries (kinds, versions, relations; no titles).
    const where =
      mode === 'browse'
        ? 'true'
        : mode === 'id'
          ? `(${idMatch('h.event_id')} or ${idMatch('h.subject_id')})`
          : `(${HISTORY_DOC} @@ ${tq()} or h.summary ilike ${likeRef()} or h.action ilike ${likeRef()})`;
    const headline =
      mode === 'text'
        ? `ts_headline('english', h.summary, ${tq()}, ${optsRef()})`
        : 'h.summary';
    const rank = mode === 'text' ? `ts_rank(${HISTORY_DOC}, ${tq()})` : '0';
    // Ties in time fall back to the audit sequence, zero-padded so text order is numeric.
    const { rows, total, next } = await paged(
      `select h.*, ${headline} as headline, count(*) over () as total,
              h.occurred_at as sort_at, lpad(h.sequence::text, 20, '0') as sort_id,
              ${rank} as sort_rank
         from history_projection h
        where h.workspace_id = $1 and ${where} and ${within('h.occurred_at')}`,
      mode === 'text',
    );
    return {
      total,
      next,
      rows: rows.map((r: Row) => ({
        ...base,
        id: String(r.event_id),
        kind: String(r.action),
        title: String(r.summary).slice(0, 500),
        status: String(r.subject_kind),
        version: r.subject_version === null ? null : Number(r.subject_version),
        snippet: segments(r.headline as string | null),
        occurred_at: iso(r.occurred_at),
        occurred_local: local(r.occurred_at),
        subject: { id: String(r.subject_id), kind: String(r.subject_kind) },
      })),
    };
  }

  /** Audit history with who did each thing, newest first, filterable and paged. */
  async activity(
    ctx: CommandContext,
    ws: string,
    filter: {
      q?: string;
      action?: string;
      subjectId?: string;
      before?: string;
      limit?: number;
    } = {},
  ): Promise<ActivityPage> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const q = filter.q?.trim() ?? '';
    if (q.length > 200)
      throw fail('INVALID_CONTRACT', 'q is at most 200 characters.');
    const action = filter.action ?? null;
    if (action !== null && !ACTIVITY_ACTION_RE.test(action))
      throw fail(
        'INVALID_CONTRACT',
        'action must look like "decision." or "budget.denied".',
      );
    const subject =
      filter.subjectId === undefined ? null : uuid(filter.subjectId);
    const before = filter.before ?? null;
    if (before !== null && !/^[1-9][0-9]{0,18}$/.test(before))
      throw fail('INVALID_CONTRACT', 'before must be a sequence number.');
    const limit = filter.limit ?? 50;
    if (!Number.isInteger(limit) || limit < 1 || limit > 200)
      throw fail('INVALID_CONTRACT', 'limit must be 1–200.');
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select h.*, a.kind as actor_kind, a.display_name as actor_name
           from history_projection h join actors a on a.id = h.actor_id
          where h.workspace_id = $1
            and ($2::text = '' or h.summary ilike $3 or h.action ilike $3
                 or ${HISTORY_DOC} @@ websearch_to_tsquery('english', $2))
            and ($4::text is null or h.action like $4 || '%')
            and ($5::uuid is null or h.subject_id = $5 or $5 = any(h.related_ids))
            and ($6::bigint is null or h.sequence < $6)
          order by h.sequence desc limit $7`,
        [ws, q, like(q), action, subject, before, limit + 1],
      );
      const page = rows.slice(0, limit);
      return {
        entries: page.map((r: Row) => ({
          ...toHistory(r),
          actor: {
            id: String(r.actor_id),
            kind: r.actor_kind as 'human' | 'agent' | 'system',
            display_name: String(r.actor_name),
          },
        })),
        next_before:
          rows.length > limit ? String(page[page.length - 1]?.sequence) : null,
      };
    });
  }

  /**
   * P02: the Library's records in a chosen order, sorted on the server before the limit and
   * continued with a cursor bound to that order and these filters. Newest and Oldest are by
   * creation; Updated is the latest version; Name is case-folded title. The id breaks ties.
   */
  async library(
    ctx: CommandContext,
    ws: string,
    filter: {
      kind?: string;
      status?: string;
      sort?: string;
      after?: string;
      limit?: number;
    } = {},
  ): Promise<LibraryPage> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const kind =
      filter.kind === undefined ? null : parse(StoredKindSchema, filter.kind);
    const status =
      filter.status === undefined
        ? null
        : parse(StoredStatusSchema, filter.status);
    const sort: LibrarySort = parse(LibrarySortSchema, filter.sort ?? 'newest');
    const limit = filter.limit ?? 100;
    if (!Number.isInteger(limit) || limit < 1 || limit > 500)
      throw fail('INVALID_CONTRACT', 'limit must be 1–500.');
    const bound = filterHash([kind, status]);
    const cursor =
      filter.after === undefined
        ? null
        : decodeCursor(filter.after, sort, 'library', bound);
    if (cursor && (cursor.t === undefined || cursor.i === undefined))
      throw fail('INVALID_CONTRACT', STALE_CURSOR);
    // Each order is one key and the id; Name keys on text, the others on time.
    const key = {
      newest: 'e.created_at',
      oldest: 'e.created_at',
      updated: 'e.updated_at',
      name: 'lower(e.title)',
    }[sort];
    const dir = sort === 'oldest' || sort === 'name' ? 'asc' : 'desc';
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await c.query('set transaction read only');
      const args: unknown[] = [ws, kind, status, limit + 1];
      let seek = 'true';
      if (cursor && sort === 'name') {
        const anchorId = uuid(cursor.i!, 'INVALID_CONTRACT');
        // Review M1: titles can be thousands of characters, too long to carry in a cursor,
        // so Name continues after the last row shown, read again by its id.
        const anchor = await c.query(
          'select 1 from entities where workspace_id = $1 and id = $2::uuid',
          [ws, anchorId],
        );
        if (anchor.rowCount === 0)
          throw fail(
            'INVALID_CONTRACT',
            'The last record shown is no longer in this workspace; start again.',
          );
        args.push(anchorId);
        seek = `(x.sort_key, x.sort_id) > (select lower(a.title), a.id::text
                  from entities a where a.workspace_id = $1 and a.id = $5::uuid)`;
      } else if (cursor) {
        args.push(cursor.t, cursor.i);
        seek = `(x.sort_key, x.sort_id) ${dir === 'asc' ? '>' : '<'} ($5::timestamptz, $6::text)`;
      }
      const { rows } = await c.query(
        `select x.*, x.sort_key::text as cursor_key from (
           select e.*, ${key} as sort_key, e.id::text as sort_id, count(*) over () as total
             from entities e
            where e.workspace_id = $1 and ($2::text is null or e.kind = $2)
              and ($3::text is null or e.status = $3)) x
          where ${seek}
          order by x.sort_key ${dir}, x.sort_id ${dir} limit $4`,
        args,
      );
      const page = (rows as Row[]).slice(0, limit);
      const last = page[page.length - 1];
      return {
        entities: page.map((r) => toEntity(r)),
        total: Number(rows[0]?.total ?? 0),
        sort,
        next:
          rows.length > limit && last
            ? encodeCursor({
                s: sort,
                ty: 'library',
                f: bound,
                t: sort === 'name' ? '' : String(last.cursor_key),
                i: String(last.sort_id),
              })
            : null,
      };
    });
  }

  /**
   * P01: where an activity subject or search hit opens. Checks the subject is in this
   * workspace and follows it to what a page focuses. Anything not found here (deleted, in
   * another workspace, or never existed) is `missing`, without saying which.
   */
  async destination(
    ctx: CommandContext,
    ws: string,
    kind: string,
    rawId: string,
  ): Promise<Destination> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    if (!SUBJECT_KIND_RE.test(kind))
      throw fail('INVALID_CONTRACT', 'kind must be a subject kind.');
    const id = uuid(rawId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await c.query('set transaction read only');
      const one = async (sql: string) =>
        (await c.query(sql, [ws, id])).rows[0] as Row | undefined;
      const missing: Destination = { state: 'missing', focus: null };
      const at = (focusKind: string, focusId: unknown): Destination => ({
        state: 'available',
        focus: { kind: focusKind, id: String(focusId) },
      });
      if (kind === 'decision') {
        // Decision requests have their own table; a stored decision record is an entity.
        const d = await one(
          'select id from decision_requests where workspace_id = $1 and id = $2',
        );
        if (d) return at('decision', d.id);
      }
      if (ENTITY_KINDS.has(kind)) {
        const e = await one(
          'select kind, status from entities where workspace_id = $1 and id = $2',
        );
        if (!e) return missing;
        const state = entityState(e.status);
        if (e.kind === 'artifact') {
          // An artifact opens at its newest code version on Try; without one, in the Library.
          if (state === 'redacted') return { state, focus: null };
          const m = await one(
            `select id from artifact_manifests where workspace_id = $1 and entity_id = $2
              order by created_at desc, id desc limit 1`,
          );
          return {
            state,
            focus: m
              ? { kind: 'code_version', id: String(m.id) }
              : { kind: 'artifact', id },
          };
        }
        // A redacted record keeps its id and versions; the Library shows what is left.
        return { state, focus: { kind: String(e.kind), id } };
      }
      const lookup: Record<string, [string, string]> = {
        workflow: [
          'select id as f from workflows where workspace_id = $1 and id = $2',
          'workflow',
        ],
        workflow_task: [
          'select workflow_id as f from workflow_tasks where workspace_id = $1 and id = $2',
          'workflow',
        ],
        code_version: [
          'select id as f from artifact_manifests where workspace_id = $1 and id = $2',
          'code_version',
        ],
        preview: [
          'select artifact_id as f from artifact_previews where workspace_id = $1 and id = $2',
          'code_version',
        ],
        chat_conversation: [
          'select id as f from chat_conversations where workspace_id = $1 and id = $2',
          'chat_conversation',
        ],
        selection: [
          'select problem_id as f from selections where workspace_id = $1 and id = $2',
          'problem_scores',
        ],
      };
      const known = Object.hasOwn(lookup, kind) ? lookup[kind] : undefined;
      // Settings, connections, money and similar subjects open their page, not an item.
      if (!known) return { state: 'unchecked', focus: null };
      const r = await one(known[0]);
      return r ? at(known[1], r.f) : missing;
    });
  }

  /** People and services that are members of, or acted in, this workspace. */
  async actors(ctx: CommandContext, ws: string): Promise<ActorSummary[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select a.id, a.kind, a.display_name from actors a
          where a.id in (select actor_id from workspace_members where workspace_id = $1)
             or a.id in (select distinct actor_id from audit_events where workspace_id = $1)
          order by a.kind, a.display_name, a.id limit 200`,
        [ws],
      );
      return rows.map((r: Row) => ({
        id: String(r.id),
        kind: r.kind as ActorSummary['kind'],
        display_name: String(r.display_name),
      }));
    });
  }

  /** Counts and what needs attention, all scoped to one workspace the caller can read. */
  async overview(ctx: CommandContext, ws: string): Promise<Overview> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const role = await this.role(c, ws, ctx.actorId, false);
      const w = (await c.query('select * from workspaces where id = $1', [ws]))
        .rows[0] as Row;
      const records = await c.query(
        `select kind, count(*) filter (where status = 'active') as active,
                count(*) filter (where status = 'archived') as archived,
                count(*) filter (where status = 'redacted') as redacted
           from entities where workspace_id = $1 group by kind order by kind`,
        [ws],
      );
      const runs = await c.query(
        `select count(*) filter (where state = 'active') as active,
                count(*) filter (where state = 'cancelled') as cancelled
           from run_controls where workspace_id = $1`,
        [ws],
      );
      const decisions = await c.query(
        `select count(*) as pending,
                count(*) filter (where expires_at < now() + interval '24 hours') as soon
           from decision_requests where workspace_id = $1 and status = 'pending'`,
        [ws],
      );
      const workflows = await c.query(
        'select state, count(*) as n from workflows where workspace_id = $1 group by state',
        [ws],
      );
      const attention = await c.query(
        `select id, run_id, role, state, reason, updated_at from workflows
          where workspace_id = $1 and state = any($2::text[])
          order by updated_at desc limit 20`,
        [ws, ATTENTION_STATES],
      );
      const budget = await c.query(
        `select count(*) as n,
                coalesce(sum(cap_nano) filter (where parent_id is null), 0) as cap,
                coalesce(sum(incurred_nano), 0) as incurred,
                coalesce(sum(reserved_nano), 0) as reserved,
                coalesce(sum(unknown_nano), 0) as unknown
           from budget_envelopes where workspace_id = $1`,
        [ws],
      );
      const denied = await c.query(
        `select count(*) as n from budget_reservations where workspace_id = $1 and status = 'denied'`,
        [ws],
      );
      const products = await c.query(
        `select id, version, title, body->>'stage' as stage from entities
          where workspace_id = $1 and kind = 'product' and status = 'active'
          order by updated_at desc limit 20`,
        [ws],
      );
      const sources = await c.query(
        `select count(*) as n,
                (select max(finished_at) from source_retrievals
                  where workspace_id = $1 and state <> 'in_flight') as last
           from research_sources where workspace_id = $1`,
        [ws],
      );
      const b = budget.rows[0] as Row;
      const money = (v: unknown) => BigInt(String(v)).toString();
      const s = sources.rows[0] as Row;
      return {
        workspace: {
          id: ws,
          name: String(w.name),
          record_mode: w.record_mode as 'fixture' | 'real',
          role,
          created_at: iso(w.created_at),
        },
        records: records.rows.map((r: Row) => ({
          kind: StoredKindSchema.parse(r.kind),
          active: Number(r.active),
          archived: Number(r.archived),
          redacted: Number(r.redacted),
        })),
        runs: {
          active: Number(runs.rows[0]?.active ?? 0),
          cancelled: Number(runs.rows[0]?.cancelled ?? 0),
        },
        decisions: {
          pending: Number(decisions.rows[0]?.pending ?? 0),
          expiring_24h: Number(decisions.rows[0]?.soon ?? 0),
        },
        workflows: Object.fromEntries(
          workflows.rows.map((r: Row) => [String(r.state), Number(r.n)]),
        ),
        attention: attention.rows.map((r: Row) => ({
          workflow_id: String(r.id),
          run_id: String(r.run_id),
          role: String(r.role),
          state: String(r.state),
          reason: String(r.reason).slice(0, 300),
          updated_at: iso(r.updated_at),
        })),
        budget: {
          envelopes: Number(b.n),
          cap: money(b.cap),
          incurred: money(b.incurred),
          reserved: money(b.reserved),
          unknown: money(b.unknown),
          denied_calls: Number(denied.rows[0]?.n ?? 0),
        },
        products: products.rows.map((r: Row) => ({
          id: String(r.id),
          version: Number(r.version),
          title: String(r.title),
          stage: String(r.stage ?? 'unknown'),
        })),
        sources: {
          count: Number(s.n),
          last_fetched_at: s.last === null ? null : iso(s.last),
        },
        generated_at: new Date().toISOString(),
      };
    });
  }

  /**
   * A problem, its alternatives and the claims linked to it, with each claim's current
   * evidence (passages, freshness, gaps). Scores come from the selection report.
   */
  async comparison(
    ctx: CommandContext,
    ws: string,
    problemId: string,
    maxAgeDays = 180,
  ): Promise<ProblemComparison> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    problemId = uuid(problemId);
    const gathered = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const p = await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'problem'`,
        [ws, problemId],
      );
      if (!p.rows[0]) throw fail('NOT_FOUND', 'Problem not found.');
      const problem = toEntity(p.rows[0] as Row);
      const linked = async (sql: string, args: unknown[]) =>
        (await c.query(sql, args)).rows as Row[];
      const brief = await linked(
        `select e.* from entity_links l join entities e on e.id = l.to_id
          where l.workspace_id = $1 and l.from_id = $2 and l.relation = 'derived_from'
            and l.to_kind = 'search_brief' and l.retracted_at is null
          order by l.created_at desc limit 1`,
        [ws, problemId],
      );
      const claims = await linked(
        `select distinct on (l.from_id) l.from_id, l.relation from entity_links l
          where l.workspace_id = $1 and l.to_id = $2 and l.from_kind = 'claim'
            and l.relation in ('supports', 'contradicts') and l.retracted_at is null
          order by l.from_id, l.created_at`,
        [ws, problemId],
      );
      const alts = (
        await linked(
          `select distinct e.* from entity_links l join entities e on e.id = l.from_id
            where l.workspace_id = $1 and l.relation = 'derived_from' and l.to_id = $2
              and l.from_kind = 'alternative' and l.retracted_at is null
            order by e.created_at, e.id`,
          [ws, problemId],
        )
      ).map(toEntity);
      const alternatives: ProblemComparison['alternatives'] = [];
      for (const a of alts) {
        const review = await linked(
          `select * from entities where workspace_id = $1 and kind = 'humility_review'
             and status = 'active' and body->'subject'->>'id' = $2
           order by updated_at desc limit 1`,
          [ws, a.id],
        );
        const cards = await linked(
          `select count(*) as n from entities where workspace_id = $1 and kind = 'scorecard'
             and status = 'active' and body->'subject'->>'id' = $2`,
          [ws, a.id],
        );
        alternatives.push({
          entity: a,
          humility_review: review[0] ? toEntity(review[0]) : null,
          scorecards: Number(cards[0]?.n ?? 0),
        });
      }
      const wf = await linked(
        `select id, run_id from workflows where workspace_id = $1
           and result->'discovery'->'catalog_records'->'problem'->>'id' = $2::text
         order by created_at desc limit 1`,
        [ws, problemId],
      );
      const runId = wf[0] ? String(wf[0].run_id) : null;
      const assumptions = runId
        ? (
            await linked(
              `select distinct e.* from entities e
                where e.workspace_id = $1 and e.kind = 'assumption' and e.status <> 'redacted'
                  and (e.body->>'run_id' = $2::text or exists (
                    select 1 from entity_links l where l.workspace_id = $1
                      and l.from_id = e.id and l.to_id = $2::uuid and l.relation = 'part_of'
                      and l.retracted_at is null))
                order by e.created_at`,
              [ws, runId],
            )
          ).map(toEntity)
        : [];
      return {
        problem,
        brief: brief[0] ? toEntity(brief[0]) : null,
        claims: claims.map((r) => ({
          id: String(r.from_id),
          relation: String(r.relation),
        })),
        alternatives,
        workflow_id: wf[0] ? String(wf[0].id) : null,
        run_id: runId,
        assumptions,
      };
    });
    const claims: { relation: string; evidence: ClaimEvidence }[] = [];
    for (const cl of gathered.claims)
      claims.push({
        relation: cl.relation,
        evidence: await this.claimEvidence(ctx, ws, cl.id, maxAgeDays),
      });
    return {
      problem: gathered.problem,
      brief: gathered.brief satisfies StoredEntity | null,
      claims,
      alternatives: gathered.alternatives,
      workflow_id: gathered.workflow_id,
      run_id: gathered.run_id,
      assumptions: gathered.assumptions,
      max_age_days: maxAgeDays,
    };
  }
}
