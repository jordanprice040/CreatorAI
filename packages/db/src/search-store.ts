import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AuditPlanSchema,
  AuditQuestionRequestSchema,
  LINEAGE_EXPORT_FORMAT,
  LineageExportSchema,
  LineageGraphRequestSchema,
  SaveQueryRequestSchema,
  SearchQuerySchema,
  SemanticSearchRequestSchema,
  StoredKindSchema,
  StoredStatusSchema,
  parse,
  provenanceOrigin,
  type AuditAnswer,
  type AuditWindow,
  type LineageEdge,
  type LineageExport,
  type LineageGraph,
  type LineageNode,
  type LineageVerifyResult,
  type SavedQuery,
  type SearchHit,
  type SearchResult,
  type SemanticSearchRequest,
  type SubjectRef,
} from '@creator/contracts';
import {
  canonicalHash,
  compileAuditQuestion,
  localTimestamp,
} from '@creator/domain';
import { ContextStore } from './context-store.js';
import {
  DECISION_DOC,
  ENTITY_DOC,
  ENTITY_TEXT,
  PASSAGE_DOC,
  segments,
} from './catalog-store.js';
import {
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const money = (v: unknown) => BigInt(String(v ?? 0)).toString();
const ORIGIN_IS_TO = Object.entries(provenanceOrigin)
  .filter(([, side]) => side === 'to')
  .map(([relation]) => relation);
/** How long one audit plan may run before PostgreSQL cancels it. */
const PLAN_TIMEOUT_MS = 5000;

/** A semantic-search candidate: a readable item and the text that will be embedded. */
export interface SemanticCandidate {
  hit: SearchHit;
  text: string;
  lexical: boolean;
}
type Resolved =
  | {
      ok: true;
      entity: {
        id: string;
        kind: string;
        status: string;
        title: string | null;
      };
    }
  | {
      ok: false;
      reason: 'unknown' | 'ambiguous' | 'redacted_title';
      candidates: { id: string; kind: string; title: string }[];
    };
interface WalkEdge {
  id: string;
  relation: string;
  origin: string;
  descendant: string;
  from_version: number;
  to_version: number;
  depth: number;
}

/**
 * X03: saved queries, the access-safe candidate stage of semantic search, natural-language
 * audit questions executed as fixed read-only plans, and bounded lineage graphs with exports
 * whose integrity can be re-checked. Every read checks membership before it touches content.
 */
export class SearchStore extends ContextStore {
  /** A read-only transaction with a statement timeout, after the membership check. */
  protected async readOnly<T>(
    ctx: CommandContext,
    ws: string,
    fn: (c: PoolClient, fixture: boolean) => Promise<T>,
  ): Promise<T> {
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      // Allowed mid-transaction (only the reverse is restricted); nothing below can write.
      await c.query('set transaction read only');
      await c.query(`set local statement_timeout = ${PLAN_TIMEOUT_MS}`);
      const w = await c.query('select fixture from workspaces where id = $1', [
        ws,
      ]);
      return fn(c, Boolean(w.rows[0]?.fixture));
    });
  }

  // ---- saved queries ----

  async saveQuery(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<SavedQuery> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SaveQueryRequestSchema, raw);
    const body = savedBody(req.kind, req.body);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const id = randomUUID();
      const bodyHash = canonicalHash(body);
      const { rows } = await c.query(
        `insert into saved_queries (id, workspace_id, name, kind, body, body_hash, created_by)
         values ($1, $2, $3, $4, $5, $6, $7) returning *`,
        [id, ws, req.name, req.kind, body, bodyHash, ctx.actorId],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'query.saved',
        subjectKind: 'saved_query',
        subjectId: id,
        subjectVersion: null,
        contentHash: bodyHash,
        payload: { kind: req.kind },
      });
      return toSaved(rows[0] as Row);
    });
  }

  async listSavedQueries(
    ctx: CommandContext,
    ws: string,
  ): Promise<SavedQuery[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from saved_queries where workspace_id = $1 and archived_at is null
          order by lower(name), created_at limit 200`,
        [ws],
      );
      return rows.map((r: Row) => toSaved(r));
    });
  }

  async getSavedQuery(
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<SavedQuery> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    id = uuid(id);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from saved_queries where workspace_id = $1 and id = $2',
        [ws, id],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Saved query not found.');
      return toSaved(rows[0] as Row);
    });
  }

  async archiveSavedQuery(
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<SavedQuery> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    id = uuid(id);
    return this.tx(async (c) => {
      const role = await this.role(c, ws, ctx.actorId, true);
      const { rows } = await c.query(
        `select * from saved_queries where workspace_id = $1 and id = $2 and archived_at is null
          for update`,
        [ws, id],
      );
      const row = rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Active saved query not found.');
      if (role !== 'owner' && String(row.created_by) !== ctx.actorId)
        throw fail(
          'ACCESS_DENIED',
          'Only its author or an owner can archive a saved query.',
        );
      const updated = await c.query(
        `update saved_queries set archived_at = clock_timestamp(), archived_by = $3
          where workspace_id = $1 and id = $2 returning *`,
        [ws, id, ctx.actorId],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'query.archived',
        subjectKind: 'saved_query',
        subjectId: id,
        subjectVersion: null,
        contentHash: String(row.body_hash),
        payload: { kind: String(row.kind) },
      });
      return toSaved(updated.rows[0] as Row);
    });
  }

  /**
   * Runs a saved query as the caller, with the caller's current access: saving a query
   * never stores a permission, and the body is validated again before it runs.
   */
  async runSavedQuery(
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<
    | { saved: SavedQuery; kind: 'search'; result: SearchResult }
    | { saved: SavedQuery; kind: 'question'; result: AuditAnswer }
  > {
    const saved = await this.getSavedQuery(ctx, ws, id);
    if (saved.archived_at)
      throw fail('INVALID_TRANSITION', 'This saved query is archived.');
    if (saved.kind === 'search')
      return {
        saved,
        kind: 'search',
        result: await this.search(ctx, ws, saved.body),
      };
    return {
      saved,
      kind: 'question',
      result: await this.askQuestion(ctx, ws, saved.body),
    };
  }

  // ---- semantic search: the access-safe lexical stage ----

  /**
   * Candidates for semantic ranking: items the caller can read that match the words first,
   * then the most recent readable items, never redacted text. Nothing is embedded here.
   */
  async semanticCandidates(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<{
    req: SemanticSearchRequest;
    fixture: boolean;
    candidates: SemanticCandidate[];
  }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SemanticSearchRequestSchema, raw);
    return this.readOnly(ctx, ws, async (c, fixture) => {
      const tq = `websearch_to_tsquery('english', $2)`;
      const all: SemanticCandidate[] = [];
      const local = (v: unknown) => localTimestamp(iso(v), 'UTC');
      if (req.types.includes('record')) {
        const { rows } = await c.query(
          `select e.id, e.kind, e.title, e.status, e.version, e.updated_at,
                  left(${ENTITY_TEXT}, 2000) as text,
                  (${ENTITY_DOC} @@ ${tq} or e.title ilike $3) as lexical
             from entities e
            where e.workspace_id = $1 and e.status <> 'redacted'
              and ($4::text is null or e.kind = $4)
            order by 8 desc, ts_rank(${ENTITY_DOC}, ${tq}) desc, e.updated_at desc
            limit $5`,
          [ws, req.q, like(req.q), req.kind, req.pool],
        );
        for (const r of rows as Row[])
          all.push({
            lexical: Boolean(r.lexical),
            text: String(r.text),
            hit: {
              type: 'record',
              id: String(r.id),
              match: 'text',
              kind: String(r.kind),
              title: String(r.title),
              status: String(r.status),
              version: Number(r.version),
              snippet: segments(String(r.text).slice(0, 240)),
              occurred_at: iso(r.updated_at),
              occurred_local: local(r.updated_at),
              subject: { id: String(r.id), kind: String(r.kind) },
              amounts: null,
            },
          });
      }
      if (req.types.includes('passage')) {
        const { rows } = await c.query(
          `select p.id, p.source_id, p.source_version, p.ordinal, p.created_at, p.excerpt,
                  e.title, (${PASSAGE_DOC} @@ ${tq}) as lexical
             from source_passages p
             join entities e on e.workspace_id = p.workspace_id and e.id = p.source_id
            where p.workspace_id = $1 and p.excerpt is not null and e.status <> 'redacted'
              and $3::text is not null
            order by 8 desc, p.created_at desc, p.ordinal limit $4`,
          [ws, req.q, req.q, req.pool],
        );
        for (const r of rows as Row[])
          all.push({
            lexical: Boolean(r.lexical),
            text: String(r.excerpt),
            hit: {
              type: 'passage',
              id: String(r.id),
              match: 'text',
              kind: 'passage',
              title:
                `${String(r.title)} · passage ${Number(r.ordinal) + 1}`.slice(
                  0,
                  500,
                ),
              status: 'current',
              version: Number(r.source_version),
              snippet: segments(String(r.excerpt).slice(0, 240)),
              occurred_at: iso(r.created_at),
              occurred_local: local(r.created_at),
              subject: { id: String(r.source_id), kind: 'source' },
              amounts: null,
            },
          });
      }
      if (req.types.includes('decision')) {
        const { rows } = await c.query(
          `select d.id, d.kind, d.status, d.version, d.run_id, d.created_at,
                  d.request->>'question' as question,
                  left((d.request->>'question') || ' · ' || coalesce(d.request->>'uncertainty', ''), 2000) as text,
                  (${DECISION_DOC} @@ ${tq}) as lexical
             from decision_requests d where d.workspace_id = $1 and $3::text is not null
            order by 9 desc, d.created_at desc limit $4`,
          [ws, req.q, req.q, req.pool],
        );
        for (const r of rows as Row[])
          all.push({
            lexical: Boolean(r.lexical),
            text: String(r.text),
            hit: {
              type: 'decision',
              id: String(r.id),
              match: 'text',
              kind: `${String(r.kind)} decision`,
              title: String(r.question).slice(0, 500),
              status: String(r.status),
              version: Number(r.version),
              snippet: segments(String(r.text).slice(0, 240)),
              occurred_at: iso(r.created_at),
              occurred_local: local(r.created_at),
              subject: { id: String(r.run_id), kind: 'run' },
              amounts: null,
            },
          });
      }
      all.sort(
        (a, b) =>
          Number(b.lexical) - Number(a.lexical) ||
          b.hit.occurred_at.localeCompare(a.hit.occurred_at),
      );
      return { req, fixture, candidates: all.slice(0, req.pool) };
    });
  }

  // ---- audit questions ----

  /** Compiles a question with the local rules and answers it (no model, no spend). */
  async askQuestion(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<AuditAnswer> {
    const req = parse(AuditQuestionRequestSchema, raw);
    if (req.compiler !== 'rules')
      throw fail(
        'INVALID_CONTRACT',
        'Model-compiled questions go through the broker service.',
      );
    const compiled = compileAuditQuestion(req.question, {
      tz: req.tz,
      limit: req.limit,
    });
    if (compiled.status === 'unsupported')
      return this.unanswered(ctx, ws, {
        question: req.question,
        compiler: 'rules',
        status: 'unsupported',
        explanation: `${compiled.reason} Try: ${compiled.suggestions.slice(0, 4).join(' · ')}`,
      });
    return this.answerPlan(ctx, ws, compiled.plan, {
      question: req.question,
      compiler: 'rules',
    });
  }

  /** An answer with no plan run (unsupported, refused or failed), after the access check. */
  async unanswered(
    ctx: CommandContext,
    ws: string,
    a: {
      question: string;
      compiler: 'rules' | 'model';
      status: 'unsupported' | 'refused_plan' | 'compile_failed';
      explanation: string;
      compile_call?: AuditAnswer['compile_call'];
    },
  ): Promise<AuditAnswer> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.readOnly(ctx, ws, async (c, fixture) => ({
      question: a.question,
      compiler: a.compiler,
      status: a.status,
      explanation: a.explanation.slice(0, 1200),
      plan: null,
      plan_hash: null,
      read_only: true,
      fixture,
      as_of: iso((await c.query('select now() as t')).rows[0]?.t),
      subjects: [],
      candidates: [],
      columns: [],
      rows: [],
      totals: null,
      supporting: [],
      truncated: false,
      notes: [],
      compile_call: a.compile_call ?? null,
    }));
  }

  /**
   * Executes one validated plan in a read-only transaction. Each intent has fixed SQL; the
   * plan only supplies bound parameters (ids, titles, dates, limits).
   */
  async answerPlan(
    ctx: CommandContext,
    ws: string,
    rawPlan: unknown,
    meta: {
      question: string;
      compiler: 'rules' | 'model';
      compile_call?: AuditAnswer['compile_call'];
    },
  ): Promise<AuditAnswer> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const plan = parse(AuditPlanSchema, rawPlan);
    const planHash = canonicalHash(plan);
    return this.readOnly(ctx, ws, async (c, fixture) => {
      const asOf = iso((await c.query('select now() as t')).rows[0]?.t);
      const answer: AuditAnswer = {
        question: meta.question,
        compiler: meta.compiler,
        status: 'answered',
        explanation: '',
        plan,
        plan_hash: planHash,
        read_only: true,
        fixture,
        as_of: asOf,
        subjects: [],
        candidates: [],
        columns: [],
        rows: [],
        totals: null,
        supporting: [],
        truncated: false,
        notes: fixture
          ? ['Fixture workspace: amounts are simulated units, never money.']
          : [],
        compile_call: meta.compile_call ?? null,
      };
      const resolve = async (
        ref: SubjectRef,
        kinds: readonly string[] | null,
      ): Promise<string | null> => {
        const r = await this.resolveSubject(c, ws, ref, kinds);
        const label = 'id' in ref ? ref.id : `"${ref.title}"`;
        if (!r.ok) {
          answer.status = 'needs_subject';
          answer.candidates.push(
            ...r.candidates
              .slice(0, 10 - answer.candidates.length)
              .map((x) => ({ ...x, kind: StoredKindSchema.parse(x.kind) })),
          );
          answer.explanation =
            r.reason === 'ambiguous'
              ? `${label} matches more than one readable record; name one by id.`
              : r.reason === 'redacted_title'
                ? `${label} names no readable record (redacted titles cannot be matched).`
                : `${label} names no readable${kinds ? ` ${kinds.join(' or ')}` : ''} record in this workspace.`;
          return null;
        }
        answer.subjects.push({
          ref: label.slice(0, 220),
          id: r.entity.id,
          kind: StoredKindSchema.parse(r.entity.kind),
          status: StoredStatusSchema.parse(r.entity.status),
          title: r.entity.title,
        });
        return r.entity.id;
      };
      const local = (v: unknown, tz = 'UTC') => localTimestamp(iso(v), tz);
      switch (plan.intent) {
        case 'lineage':
        case 'source_to_product': {
          const kinds =
            plan.intent === 'source_to_product'
              ? plan.direction === 'to_sources'
                ? ['product', 'artifact', 'specification', 'idea', 'problem']
                : ['source', 'claim']
              : null;
          const root = await resolve(plan.subject, kinds);
          if (!root) return answer;
          const direction =
            plan.intent === 'lineage'
              ? plan.direction
              : plan.direction === 'to_sources'
                ? 'upstream'
                : 'downstream';
          const edges = await this.walk(c, ws, root, direction, plan.depth);
          const nodes = await this.nodes(
            c,
            ws,
            new Map([
              [root, 0],
              ...edges.map(
                (e) =>
                  [
                    direction === 'upstream' ? e.origin : e.descendant,
                    e.depth,
                  ] as const,
              ),
            ]),
          );
          const want =
            plan.intent === 'lineage'
              ? null
              : plan.direction === 'to_sources'
                ? ['source']
                : ['product'];
          const shown = nodes
            .filter((n) => n.id !== root && (!want || want.includes(n.kind)))
            .sort((a, b) => a.depth - b.depth || a.kind.localeCompare(b.kind));
          answer.columns = [
            'depth',
            'kind',
            'id',
            'title',
            'status',
            'version',
            'media',
            'via',
          ];
          answer.rows = shown.slice(0, plan.limit).map((n) => ({
            depth: n.depth,
            kind: n.kind,
            id: n.id,
            title: n.title,
            status: n.status,
            version: n.version,
            media: n.media,
            via: edges
              .filter(
                (e) =>
                  (direction === 'upstream' ? e.origin : e.descendant) === n.id,
              )
              .map((e) => e.relation)
              .filter((v, i, a) => a.indexOf(v) === i)
              .join(', '),
          }));
          answer.truncated = shown.length > plan.limit;
          answer.supporting = [
            ...nodes.map((n) => ({ type: 'record' as const, id: n.id })),
            ...edges.map((e) => ({ type: 'link' as const, id: e.id })),
          ].slice(0, 1000);
          answer.totals = {
            [want ? `${want[0]}s` : 'records']: String(shown.length),
            links: String(edges.length),
          };
          const redacted = shown.filter((n) => n.status === 'redacted').length;
          if (redacted)
            answer.notes.push(
              `${redacted} record(s) on these paths are redacted: shown as tombstones (id, kind, version) without titles.`,
            );
          const unsupported = shown.filter(
            (n) => n.media === 'unsupported_type' || n.media === 'too_large',
          ).length;
          if (unsupported)
            answer.notes.push(
              `${unsupported} source(s) had media the studio could not read (unsupported type or too large); their content was never searchable.`,
            );
          answer.explanation =
            shown.length === 0
              ? `No ${want ? `${want[0]}s` : 'records'} are linked ${direction} of this record within ${plan.depth} hops.`
              : `${shown.length} ${want ? `${want[0]}(s)` : 'record(s)'} found ${direction} within ${plan.depth} hops through active links.`;
          return answer;
        }
        case 'run_cost': {
          const run = await resolve(plan.run, ['run']);
          if (!run) return answer;
          return this.costAnswer(
            c,
            ws,
            answer,
            [{ subject: run, runs: [run] }],
            plan.limit,
          );
        }
        case 'subject_cost': {
          const groups: { subject: string; runs: string[] }[] = [];
          for (const ref of plan.subjects) {
            const id = await resolve(ref, null);
            if (!id) return answer;
            groups.push({ subject: id, runs: await this.runsFor(c, ws, id) });
          }
          return this.costAnswer(c, ws, answer, groups, plan.limit);
        }
        case 'decisions': {
          const run = plan.run ? await resolve(plan.run, ['run']) : null;
          if (plan.run && !run) return answer;
          const w = windowSql(plan.window, 'd.created_at', 5);
          const { rows } = await c.query(
            `select d.id, d.kind, d.status, d.run_id, d.created_at, d.request->>'question' as question,
                    count(*) over () as total
               from decision_requests d
              where d.workspace_id = $1 and ($2::uuid is null or d.run_id = $2)
                and ($3::text is null or d.status = $3) and ${w.sql}
              order by d.created_at desc limit $4`,
            [ws, run, plan.status, plan.limit, ...w.args],
          );
          answer.columns = [
            'created',
            'id',
            'kind',
            'status',
            'run_id',
            'question',
          ];
          answer.rows = (rows as Row[]).map((r) => ({
            created: local(r.created_at, plan.window.tz),
            id: String(r.id),
            kind: String(r.kind),
            status: String(r.status),
            run_id: String(r.run_id),
            question: String(r.question).slice(0, 1000),
          }));
          const n = Number(rows[0]?.total ?? 0);
          answer.truncated = n > rows.length;
          answer.totals = { decisions: String(n) };
          answer.supporting = (rows as Row[]).map((r) => ({
            type: 'decision' as const,
            id: String(r.id),
          }));
          answer.explanation = `${n} decision(s) match${windowText(plan.window)}.`;
          return answer;
        }
        case 'activity': {
          const subject = plan.subject
            ? await resolve(plan.subject, null)
            : null;
          if (plan.subject && !subject) return answer;
          const w = windowSql(plan.window, 'h.occurred_at', 5);
          const { rows } = await c.query(
            `select h.event_id, h.sequence, h.occurred_at, h.action, h.summary, h.subject_kind,
                    h.subject_id, a.display_name, a.kind as actor_kind, count(*) over () as total
               from history_projection h join actors a on a.id = h.actor_id
              where h.workspace_id = $1
                and ($2::uuid is null or h.subject_id = $2 or $2 = any(h.related_ids))
                and ($3::text is null or h.action like $3 || '%') and ${w.sql}
              order by h.sequence desc limit $4`,
            [ws, subject, plan.action_prefix, plan.limit, ...w.args],
          );
          answer.columns = [
            'when',
            'actor',
            'actor_kind',
            'action',
            'summary',
            'subject_kind',
            'subject_id',
          ];
          answer.rows = (rows as Row[]).map((r) => ({
            when: local(r.occurred_at, plan.window.tz),
            actor: String(r.display_name),
            actor_kind: String(r.actor_kind),
            action: String(r.action),
            summary: String(r.summary).slice(0, 1000),
            subject_kind: String(r.subject_kind),
            subject_id: String(r.subject_id),
          }));
          const n = Number(rows[0]?.total ?? 0);
          answer.truncated = n > rows.length;
          answer.totals = { events: String(n) };
          answer.supporting = (rows as Row[]).map((r) => ({
            type: 'event' as const,
            id: String(r.event_id),
          }));
          answer.explanation = `${n} audit event(s) match${windowText(plan.window)}.`;
          return answer;
        }
        case 'redactions': {
          const w = windowSql(plan.window, 'h.occurred_at', 3);
          const { rows } = await c.query(
            `select h.event_id, h.occurred_at, h.subject_kind, h.subject_id, h.subject_version,
                    a.display_name, count(*) over () as total
               from history_projection h join actors a on a.id = h.actor_id
              where h.workspace_id = $1 and h.action = 'entity.redacted' and ${w.sql}
              order by h.sequence desc limit $2`,
            [ws, plan.limit, ...w.args],
          );
          answer.columns = ['when', 'kind', 'id', 'tombstone_version', 'actor'];
          answer.rows = (rows as Row[]).map((r) => ({
            when: local(r.occurred_at, plan.window.tz),
            kind: String(r.subject_kind),
            id: String(r.subject_id),
            tombstone_version:
              r.subject_version === null ? null : Number(r.subject_version),
            actor: String(r.display_name),
          }));
          const n = Number(rows[0]?.total ?? 0);
          answer.truncated = n > rows.length;
          answer.totals = { redactions: String(n) };
          answer.supporting = (rows as Row[]).flatMap((r) => [
            { type: 'event' as const, id: String(r.event_id) },
            { type: 'record' as const, id: String(r.subject_id) },
          ]);
          answer.explanation = `${n} record(s) were redacted${windowText(plan.window)}. Their titles and bodies are gone; tombstones keep identity, version and hash.`;
          return answer;
        }
        case 'model_usage': {
          const w = windowSql(plan.window, 'created_at', 4);
          const { rows } = await c.query(
            `select provider, model_id, count(*) filter (where status <> 'denied') as calls,
                    count(*) filter (where status = 'denied') as denied,
                    coalesce(sum(incurred_nano) filter (where status = 'settled'), 0) as incurred,
                    coalesce(sum(reserved_nano) filter (where status = 'unknown'), 0) as unknown,
                    coalesce(sum(reserved_nano) filter (where status = 'in_flight'), 0) as reserved,
                    min(created_at) as first_at, max(created_at) as last_at
               from budget_reservations
              where workspace_id = $1 and ($2::text is null or model_id = $2) and ${w.sql}
              group by provider, model_id order by max(created_at) desc limit $3`,
            [ws, plan.model_id, plan.limit, ...w.args],
          );
          answer.columns = [
            'provider',
            'model_id',
            'calls',
            'denied',
            'incurred_nano',
            'unknown_nano',
            'reserved_nano',
            'last_used',
          ];
          answer.rows = (rows as Row[]).map((r) => ({
            provider: String(r.provider),
            model_id: String(r.model_id),
            calls: Number(r.calls),
            denied: Number(r.denied),
            incurred_nano: money(r.incurred),
            unknown_nano: money(r.unknown),
            reserved_nano: money(r.reserved),
            last_used: local(r.last_at, plan.window.tz),
          }));
          answer.totals = {
            models: String(rows.length),
            incurred_nano: (rows as Row[])
              .reduce((s, r) => s + BigInt(money(r.incurred)), 0n)
              .toString(),
          };
          answer.explanation = rows.length
            ? `${rows.length} model(s) were called${windowText(plan.window)}.`
            : `No model calls${windowText(plan.window)}.`;
          return answer;
        }
      }
    });
  }

  /** Finds the one readable record a reference names; redacted titles never match. */
  private async resolveSubject(
    c: PoolClient,
    ws: string,
    ref: SubjectRef,
    kinds: readonly string[] | null,
  ): Promise<Resolved> {
    const kindFilter = kinds ? [...kinds] : null;
    const view = (r: Row) => ({
      id: String(r.id),
      kind: String(r.kind),
      status: String(r.status),
      title: r.status === 'redacted' ? null : String(r.title),
    });
    if ('id' in ref) {
      const v = ref.id.toLowerCase();
      const { rows } = await c.query(
        `select id, kind, status, title from entities
          where workspace_id = $1 and ${v.length === 36 ? 'id = $2::uuid' : `id::text like $2 || '%'`}
            and ($3::text[] is null or kind = any($3))
          order by updated_at desc limit 6`,
        [ws, v, kindFilter],
      );
      if (rows.length === 1) return { ok: true, entity: view(rows[0] as Row) };
      return {
        ok: false,
        reason: rows.length ? 'ambiguous' : 'unknown',
        candidates: (rows as Row[])
          .filter((r) => r.status !== 'redacted')
          .map((r) => ({
            id: String(r.id),
            kind: String(r.kind),
            title: String(r.title),
          })),
      };
    }
    const kind = ref.kind ? [ref.kind] : kindFilter;
    const { rows } = await c.query(
      `select id, kind, status, title from entities
        where workspace_id = $1 and status <> 'redacted' and lower(title) = lower($2)
          and ($3::text[] is null or kind = any($3))
        order by updated_at desc limit 6`,
      [ws, ref.title, kind],
    );
    if (rows.length === 1) return { ok: true, entity: view(rows[0] as Row) };
    if (rows.length > 1)
      return {
        ok: false,
        reason: 'ambiguous',
        candidates: (rows as Row[]).map((r) => ({
          id: String(r.id),
          kind: String(r.kind),
          title: String(r.title),
        })),
      };
    const near = await c.query(
      `select id, kind, title from entities
        where workspace_id = $1 and status <> 'redacted' and title ilike $2
          and ($3::text[] is null or kind = any($3))
        order by updated_at desc limit 5`,
      [ws, like(ref.title), kind],
    );
    return {
      ok: false,
      reason: 'unknown',
      candidates: (near.rows as Row[]).map((r) => ({
        id: String(r.id),
        kind: String(r.kind),
        title: String(r.title),
      })),
    };
  }

  /** Runs a subject's cost covers: runs part_of it (or its descendants) and its builds. */
  private async runsFor(
    c: PoolClient,
    ws: string,
    subject: string,
  ): Promise<string[]> {
    const edges = await this.walk(c, ws, subject, 'downstream', 8);
    const ids = [subject, ...edges.map((e) => e.descendant)];
    const { rows } = await c.query(
      `select id from entities where workspace_id = $1 and kind = 'run' and id = any($2::uuid[])
       union
       select f.run_id from artifact_manifests am join spec_freezes f on f.id = am.freeze_id
        where am.workspace_id = $1 and (am.product_id = $3 or am.entity_id = $3)`,
      [ws, ids, subject],
    );
    return (rows as Row[]).map((r) => String(r.id)).sort();
  }

  /**
   * Cost per subject and combined. Each reservation is summed once: per subject over its
   * distinct runs, and in the combined total over the union of runs, so a run shared by two
   * products is never counted twice.
   */
  private async costAnswer(
    c: PoolClient,
    ws: string,
    answer: AuditAnswer,
    groups: { subject: string; runs: string[] }[],
    limit: number,
  ): Promise<AuditAnswer> {
    const totals = async (runs: string[]) =>
      (
        await c.query(
          `select count(*) filter (where status <> 'denied') as calls,
                  count(*) filter (where status = 'denied') as denied,
                  coalesce(sum(incurred_nano) filter (where status = 'settled'), 0) as incurred,
                  coalesce(sum(reserved_nano) filter (where status = 'unknown'), 0) as unknown,
                  coalesce(sum(reserved_nano) filter (where status = 'in_flight'), 0) as reserved
             from budget_reservations where workspace_id = $1 and run_id = any($2::uuid[])`,
          [ws, runs],
        )
      ).rows[0] as Row;
    const union = [...new Set(groups.flatMap((g) => g.runs))].sort();
    const share = new Map<string, number>();
    for (const g of groups)
      for (const r of new Set(g.runs)) share.set(r, (share.get(r) ?? 0) + 1);
    const shared = [...share.values()].filter((n) => n > 1).length;
    const all = await totals(union);
    const { rows } = await c.query(
      `select r.id, r.run_id, r.action_type, r.provider, r.model_id, r.status, r.reserved_nano,
              r.incurred_nano, r.created_at, u.id as usage_id
         from budget_reservations r left join usage_records u on u.reservation_id = r.id
        where r.workspace_id = $1 and r.run_id = any($2::uuid[])
        order by r.created_at, r.id limit $3`,
      [ws, union, Math.min(limit, 200) + 1],
    );
    const single =
      groups.length === 1 &&
      groups[0]!.runs.length === 1 &&
      groups[0]!.runs[0] === groups[0]!.subject;
    if (groups.length > 1 || !single) {
      answer.columns = [
        'subject_id',
        'runs',
        'shared_runs',
        'calls',
        'incurred_nano',
        'unknown_nano',
        'reserved_nano',
      ];
      for (const g of groups) {
        const t = await totals(g.runs);
        answer.rows.push({
          subject_id: g.subject,
          runs: g.runs.length,
          shared_runs: g.runs.filter((r) => (share.get(r) ?? 0) > 1).length,
          calls: Number(t.calls),
          incurred_nano: money(t.incurred),
          unknown_nano: money(t.unknown),
          reserved_nano: money(t.reserved),
        });
      }
    } else {
      answer.columns = [
        'reservation_id',
        'action',
        'model',
        'status',
        'incurred_nano',
        'held_nano',
        'when',
      ];
      answer.rows = (rows as Row[]).slice(0, limit).map((r) => ({
        reservation_id: String(r.id),
        action: String(r.action_type),
        model: `${String(r.provider)}/${String(r.model_id)}`,
        status: String(r.status),
        incurred_nano: r.incurred_nano === null ? '0' : money(r.incurred_nano),
        held_nano: ['unknown', 'in_flight'].includes(String(r.status))
          ? money(r.reserved_nano)
          : '0',
        when: iso(r.created_at),
      }));
      answer.truncated = rows.length > limit;
    }
    answer.totals = {
      runs: String(union.length),
      shared_runs: String(shared),
      calls: String(Number(all.calls)),
      denied_calls: String(Number(all.denied)),
      incurred_nano: money(all.incurred),
      unknown_nano: money(all.unknown),
      reserved_nano: money(all.reserved),
    };
    answer.supporting = [
      ...union.map((id) => ({ type: 'record' as const, id })),
      ...(rows as Row[])
        .slice(0, limit)
        .flatMap((r) => [
          { type: 'reservation' as const, id: String(r.id) },
          ...(r.usage_id
            ? [{ type: 'usage' as const, id: String(r.usage_id) }]
            : []),
        ]),
    ].slice(0, 1000);
    if (shared)
      answer.notes.push(
        `${shared} run(s) are shared by more than one subject; the combined total counts each of their charges once.`,
      );
    if (BigInt(money(all.unknown)) > 0n)
      answer.notes.push(
        'Some charges are unknown (held, not settled): the true total may be higher than incurred.',
      );
    answer.explanation = union.length
      ? `${union.length} run(s), ${Number(all.calls)} metered call(s); settled ${money(all.incurred)} nano-USD${answer.fixture ? ' (simulated)' : ''}.`
      : 'No runs are linked to this record (part_of lineage or builds), so no cost is attributed.';
    return answer;
  }

  /** Active links walked toward origins (upstream) or descendants, to maxDepth hops. */
  private async walk(
    c: PoolClient,
    ws: string,
    root: string,
    direction: 'upstream' | 'downstream',
    maxDepth: number,
  ): Promise<WalkEdge[]> {
    const [near, far] =
      direction === 'upstream'
        ? ['descendant_id', 'origin_id']
        : ['origin_id', 'descendant_id'];
    const { rows } = await c.query(
      `with recursive edges as (
         select id, relation, from_version, to_version,
           case when relation = any($4::text[]) then to_id else from_id end as origin_id,
           case when relation = any($4::text[]) then from_id else to_id end as descendant_id
         from entity_links where workspace_id = $1 and retracted_at is null
       ), walk (link_id, next_id, depth, path) as (
         select e.id, e.${far}, 1, array[e.id] from edges e where e.${near} = $2
         union all
         select e.id, e.${far}, w.depth + 1, w.path || e.id
         from walk w join edges e on e.${near} = w.next_id
         where w.depth < $3 and not e.id = any(w.path)
       )
       select distinct on (e.id) e.*, w.depth
       from walk w join edges e on e.id = w.link_id
       order by e.id, w.depth`,
      [ws, root, maxDepth, ORIGIN_IS_TO],
    );
    return (rows as Row[])
      .map((r) => ({
        id: String(r.id),
        relation: String(r.relation),
        origin: String(r.origin_id),
        descendant: String(r.descendant_id),
        from_version: Number(r.from_version),
        to_version: Number(r.to_version),
        depth: Number(r.depth),
      }))
      .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  }

  /** Nodes for ids at their shortest depth; redacted ones as tombstones; sources' media. */
  private async nodes(
    c: PoolClient,
    ws: string,
    depths: Map<string, number>,
  ): Promise<LineageNode[]> {
    const best = new Map<string, number>();
    for (const [id, d] of depths) best.set(id, Math.min(d, best.get(id) ?? d));
    const ids = [...best.keys()];
    const { rows } = await c.query(
      `select e.id, e.kind, e.version, e.status, e.title, e.content_hash,
              (select r.state from source_retrievals r
                where r.source_id = e.id and r.state <> 'in_flight'
                order by r.finished_at desc limit 1) as retrieval
         from entities e where e.workspace_id = $1 and e.id = any($2::uuid[])`,
      [ws, ids],
    );
    return (rows as Row[])
      .map((r) => ({
        id: String(r.id),
        kind: StoredKindSchema.parse(r.kind),
        version: Number(r.version),
        status: StoredStatusSchema.parse(r.status),
        title: r.status === 'redacted' ? null : String(r.title),
        content_hash: String(r.content_hash),
        depth: best.get(String(r.id)) ?? 0,
        media:
          r.kind !== 'source'
            ? null
            : r.retrieval === 'fetched'
              ? ('text' as const)
              : r.retrieval === 'unsupported_type' ||
                  r.retrieval === 'too_large'
                ? (r.retrieval as 'unsupported_type' | 'too_large')
                : ('not_retrieved' as const),
      }))
      .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id));
  }

  // ---- lineage graphs and exports ----

  async lineageGraph(
    ctx: CommandContext,
    ws: string,
    entityId: string,
    raw: unknown,
  ): Promise<LineageGraph> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    entityId = uuid(entityId);
    const req = parse(LineageGraphRequestSchema, raw ?? {});
    return this.readOnly(ctx, ws, async (c, fixture) => {
      const root = await c.query(
        'select 1 from entities where workspace_id = $1 and id = $2',
        [ws, entityId],
      );
      if (!root.rows[0]) throw fail('NOT_FOUND', 'Record not found.');
      const dirs: ('upstream' | 'downstream')[] =
        req.direction === 'both' ? ['upstream', 'downstream'] : [req.direction];
      // One hop past the limit tells whether the depth bound cut anything off.
      const edges: LineageEdge[] = [];
      const depths = new Map<string, number>([[entityId, 0]]);
      let deeper = false;
      for (const d of dirs) {
        for (const e of await this.walk(c, ws, entityId, d, req.depth + 1)) {
          if (e.depth > req.depth) {
            deeper = true;
            continue;
          }
          if (!edges.some((x) => x.id === e.id)) edges.push(e);
          const far = d === 'upstream' ? e.origin : e.descendant;
          depths.set(far, Math.min(e.depth, depths.get(far) ?? e.depth));
        }
      }
      const all = await this.nodes(c, ws, depths);
      const kept = all.slice(0, req.max_nodes);
      const keep = new Set(kept.map((n) => n.id));
      return {
        workspace_id: ws,
        fixture,
        root: entityId,
        direction: req.direction,
        depth: req.depth,
        max_nodes: req.max_nodes,
        nodes: kept,
        edges: edges
          .filter((e) => keep.has(e.origin) && keep.has(e.descendant))
          .sort((a, b) => a.depth - b.depth || a.id.localeCompare(b.id)),
        truncated: { depth: deeper, nodes: all.length > kept.length },
        as_of: iso((await c.query('select now() as t')).rows[0]?.t),
      };
    });
  }

  /** A lineage graph with a hash over its canonical JSON, for verification later. */
  async exportLineage(
    ctx: CommandContext,
    ws: string,
    entityId: string,
    raw: unknown,
  ): Promise<LineageExport> {
    ctx = normalize(ctx);
    const graph = await this.lineageGraph(ctx, ws, entityId, raw);
    return {
      format: LINEAGE_EXPORT_FORMAT,
      exported_by: ctx.actorId,
      exported_at: new Date().toISOString(),
      graph,
      graph_sha256: canonicalHash(graph),
    };
  }

  /**
   * Re-checks an export: its hash, then each node and link against the workspace now.
   * An export that still holds a title of a record redacted since is flagged so its copy
   * can be destroyed; links retracted since are reported.
   */
  async verifyLineageExport(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<LineageVerifyResult> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const bundle = parse(LineageExportSchema, raw);
    return this.readOnly(ctx, ws, async (c) => {
      const problems: LineageVerifyResult['problems'] = [];
      const hashOk = canonicalHash(bundle.graph) === bundle.graph_sha256;
      if (!hashOk)
        problems.push({
          code: 'hash_mismatch',
          id: null,
          detail:
            'The graph does not match its recorded SHA-256; it was changed after export.',
        });
      const g = bundle.graph;
      if (g.workspace_id !== ws) {
        problems.push({
          code: 'workspace_mismatch',
          id: null,
          detail: 'This export belongs to another workspace.',
        });
        return {
          ok: false,
          hash_ok: hashOk,
          checked_nodes: 0,
          checked_edges: 0,
          problems,
          as_of: iso((await c.query('select now() as t')).rows[0]?.t),
        };
      }
      const now = await c.query(
        'select id, version, status from entities where workspace_id = $1 and id = any($2::uuid[])',
        [ws, g.nodes.map((n) => n.id)],
      );
      const cur = new Map((now.rows as Row[]).map((r) => [String(r.id), r]));
      for (const n of g.nodes) {
        const r = cur.get(n.id);
        if (!r) {
          problems.push({
            code: 'missing',
            id: n.id,
            detail: `The ${n.kind} is not in this workspace.`,
          });
          continue;
        }
        if (r.status === 'redacted' && n.status !== 'redacted')
          problems.push({
            code: 'now_redacted',
            id: n.id,
            detail: `The ${n.kind} was redacted after this export.`,
          });
        if (r.status === 'redacted' && n.title !== null)
          problems.push({
            code: 'contains_redacted_text',
            id: n.id,
            detail:
              'The export still holds the title of a redacted record; destroy this copy and export again.',
          });
        if (Number(r.version) !== n.version)
          problems.push({
            code: 'version_changed',
            id: n.id,
            detail: `Exported v${n.version}; now v${String(r.version)}.`,
          });
      }
      const links = await c.query(
        'select id, retracted_at from entity_links where workspace_id = $1 and id = any($2::uuid[])',
        [ws, g.edges.map((e) => e.id)],
      );
      const lk = new Map((links.rows as Row[]).map((r) => [String(r.id), r]));
      for (const e of g.edges) {
        const r = lk.get(e.id);
        if (!r)
          problems.push({
            code: 'link_missing',
            id: e.id,
            detail: 'The link is not in this workspace.',
          });
        else if (r.retracted_at !== null)
          problems.push({
            code: 'link_retracted',
            id: e.id,
            detail: `The ${e.relation} link was retracted after this export.`,
          });
      }
      return {
        ok: problems.length === 0,
        hash_ok: hashOk,
        checked_nodes: g.nodes.length,
        checked_edges: g.edges.length,
        problems: problems.slice(0, 1000),
        as_of: iso((await c.query('select now() as t')).rows[0]?.t),
      };
    });
  }
}

function savedBody(kind: 'search' | 'question', body: unknown) {
  if (kind === 'search') return parse(SearchQuerySchema, body);
  const q = parse(AuditQuestionRequestSchema, body);
  if (q.compiler !== 'rules')
    throw fail(
      'INVALID_CONTRACT',
      'Saved questions use the rules compiler; a model-compiled question is metered per ask.',
    );
  return q;
}
function toSaved(r: Row): SavedQuery {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    name: String(r.name),
    kind: r.kind as SavedQuery['kind'],
    body: r.body as Record<string, unknown>,
    body_hash: String(r.body_hash),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    archived_at: r.archived_at === null ? null : iso(r.archived_at),
  };
}
/** Window bounds as bound parameters starting at $first; dates are local to the zone. */
function windowSql(w: AuditWindow, col: string, first: number) {
  const parts: string[] = [];
  const args: unknown[] = [w.tz];
  const tz = `$${first}`;
  if (w.from) {
    args.push(w.from);
    parts.push(
      `${col} >= ($${first + args.length - 1}::date)::timestamp at time zone ${tz}`,
    );
  }
  if (w.to) {
    args.push(w.to);
    parts.push(
      `${col} < (($${first + args.length - 1}::date + 1)::timestamp at time zone ${tz})`,
    );
  }
  return {
    sql: parts.length ? parts.join(' and ') : `${tz}::text is not null`,
    args,
  };
}
function windowText(w: AuditWindow) {
  if (!w.from && !w.to) return '';
  if (w.from && w.to)
    return w.from === w.to
      ? ` on ${w.from} (${w.tz})`
      : ` from ${w.from} to ${w.to} (${w.tz})`;
  return w.from ? ` since ${w.from} (${w.tz})` : ` up to ${w.to} (${w.tz})`;
}
