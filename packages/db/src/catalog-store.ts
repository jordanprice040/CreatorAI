import type { PoolClient } from 'pg';
import {
  z,
  SearchQuerySchema,
  StoredKindSchema,
  parse,
  type ActivityPage,
  type ActorSummary,
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
      let truncated = false;
      for (const type of query.types) {
        const { rows, total } = await this.searchType(c, ws, type, mode, query);
        counts[type] = total;
        if (total > rows.length) truncated = true;
        hits.push(...rows);
        coverage[type] = await this.searchCoverage(c, ws, type);
      }
      return {
        query,
        mode,
        fixture: Boolean(head.fixture),
        hits,
        counts,
        truncated,
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
  ): Promise<{ rows: SearchHit[]; total: number }> {
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
    const total = (rows: Row[]) => Number(rows[0]?.total ?? 0);
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
    const lim = () => p(query.limit);
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
      const order =
        mode === 'text'
          ? `ts_rank(${ENTITY_DOC}, ${tq()}) desc, e.updated_at desc`
          : 'e.updated_at desc';
      const { rows } = await c.query(
        `select e.*, ${headline} as headline, count(*) over () as total
           from entities e
          where e.workspace_id = $1 and (${kind}::text is null or e.kind = ${kind})
            and (${status}::text is null or e.status = ${status}) and ${where}
            and ${within('e.updated_at')}
          order by ${order} limit ${lim()}`,
        args,
      );
      return {
        total: total(rows),
        rows: rows.map((r: Row) => ({
          ...base,
          id: String(r.id),
          kind: String(r.kind),
          title: String(r.title),
          status: String(r.status),
          version: Number(r.version),
          snippet: segments(r.headline as string | null),
          occurred_at: iso(r.updated_at),
          occurred_local: local(r.updated_at),
          subject: { id: String(r.id), kind: String(r.kind) },
        })),
      };
    }
    if (type === 'passage') {
      // Passages need a query; a browse lists none. Redacted sources have no excerpt left.
      if (mode === 'browse') return { rows: [], total: 0 };
      const where =
        mode === 'id' ? idMatch('p.id') : `${PASSAGE_DOC} @@ ${tq()}`;
      const headline =
        mode === 'text'
          ? `ts_headline('english', p.excerpt, ${tq()}, ${optsRef()})`
          : 'left(p.excerpt, 240)';
      const { rows } = await c.query(
        `select p.id, p.source_id, p.source_version, p.ordinal, p.created_at, e.title,
                e.status, e.version as current_version, ${headline} as headline,
                count(*) over () as total
           from source_passages p
           join entities e on e.workspace_id = p.workspace_id and e.id = p.source_id
          where p.workspace_id = $1 and p.excerpt is not null and e.status <> 'redacted'
            and ${where} and ${within('p.created_at')}
          order by p.created_at desc, p.ordinal limit ${lim()}`,
        args,
      );
      return {
        total: total(rows),
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
      const { rows } = await c.query(
        `select d.id, d.kind, d.status, d.version, d.run_id, d.created_at,
                d.request->>'question' as question, ${headline} as headline,
                count(*) over () as total
           from decision_requests d
          where d.workspace_id = $1 and ${where} and ${within('d.created_at')}
          order by d.created_at desc limit ${lim()}`,
        args,
      );
      return {
        total: total(rows),
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
      const { rows } = await c.query(
        `select am.id, am.entity_id, am.commit, am.state, am.spec_version, am.created_at,
                e.title, ${headline} as headline, count(*) over () as total
           from artifact_manifests am
           join entities e on e.workspace_id = am.workspace_id and e.id = am.entity_id
          where am.workspace_id = $1 and ${where} and ${within('am.created_at')}
          order by am.created_at desc limit ${lim()}`,
        args,
      );
      return {
        total: total(rows),
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
      if (mode === 'id') return { rows: [], total: 0 };
      const where =
        mode === 'browse'
          ? 'true'
          : `(m.model_id ilike ${likeRef()} or m.provider ilike ${likeRef()})`;
      const { rows } = await c.query(
        `with m as (
           select provider, model_id, count(*) filter (where status <> 'denied') as calls,
                  count(*) filter (where status = 'denied') as denied,
                  coalesce(sum(reserved_nano) filter (where status = 'in_flight'), 0) as reserved,
                  coalesce(sum(incurred_nano) filter (where status = 'settled'), 0) as incurred,
                  coalesce(sum(reserved_nano) filter (where status = 'unknown'), 0) as unknown,
                  bool_and(fixture) as fixture, max(created_at) as last_at
             from budget_reservations
            where workspace_id = $1 and ${within('created_at')}
            group by provider, model_id)
         select m.*, count(*) over () as total from m where ${where}
          order by m.last_at desc limit ${lim()}`,
        args,
      );
      return {
        total: total(rows),
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
      const { rows } = await c.query(
        `select r.id, r.run_id, r.action_type, r.provider, r.model_id, r.attempt, r.status,
                r.reserved_nano, r.incurred_nano, r.fixture, r.created_at,
                ${headline} as headline, count(*) over () as total
           from budget_reservations r
          where r.workspace_id = $1 and ${where} and ${within('r.created_at')}
          order by r.created_at desc, r.id limit ${lim()}`,
        args,
      );
      return {
        total: total(rows),
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
    const { rows } = await c.query(
      `select h.*, ${headline} as headline, count(*) over () as total
         from history_projection h
        where h.workspace_id = $1 and ${where} and ${within('h.occurred_at')}
        order by h.sequence desc limit ${lim()}`,
      args,
    );
    return {
      total: total(rows),
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
