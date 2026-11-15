import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  DecideWebClaimsRequestSchema,
  StartWebDiscoveryRequestSchema,
  WEB_DISCOVERY_POLICY_VERSION,
  WebDiscoveryScopeSchema,
  parse,
  type WebClaimProposal,
  type WebDiscovery,
  type WebDiscoveryOutcome,
  type WebDiscoveryPreview,
  type WebDiscoveryScope,
  type WebDiscoveryState,
  type WebDiscoverySummary,
  type WebLead,
  type WebSearchCall,
  AUTOPILOT_QUOTE_CHECK_LABEL,
  ContractError,
  cutText,
} from '@creator/contracts';
import {
  SCOUT_PROMPT,
  blockedDomains,
  canonicalHash,
  scoutInput,
  scoutInputHash,
  webQuoteLongEnough,
  type CheckedProposal,
} from '@creator/domain';
import { PortfolioStore } from './portfolio-store.js';
import {
  fail,
  iso,
  isPgError,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

/** Starts the claim count a discovery's explanation ends with (replaced on each pass). */
const CLAIMS_MARK = 'Claims so far:';

type Quote = Pick<
  CheckedProposal['evidence'][number],
  'verified' | 'passage_id' | 'stance' | 'quote'
>;

/**
 * Review 1 N-1 and review 2 N-3: a claim version keeps one support row per passage. Given the
 * quotes in the order they are recorded (supporting first), this names, per passage, every
 * other distinct quote that loses the passage's row, so the kept row's rationale keeps it
 * visible instead of dropping it silently.
 */
export function droppedQuotes(
  ordered: readonly Quote[],
): Map<string, string[]> {
  const usable = (e: Quote) =>
    e.verified &&
    !!e.passage_id &&
    (e.stance !== 'supports' || webQuoteLongEnough(e.quote));
  const keeper = new Map<string, Quote>();
  for (const e of ordered)
    if (usable(e) && !keeper.has(e.passage_id!)) keeper.set(e.passage_id!, e);
  // Review 3 N-1: each distinct quote is named once per page.
  const lost = new Map<string, Quote[]>();
  for (const e of ordered) {
    const kept = usable(e) ? keeper.get(e.passage_id!) : undefined;
    if (!kept || kept === e) continue;
    const same = (x: Quote) => x.stance === e.stance && x.quote === e.quote;
    const list = lost.get(e.passage_id!) ?? [];
    if (same(kept) || list.some(same)) continue;
    lost.set(e.passage_id!, [...list, e]);
  }
  // Review 3 N-2: two are quoted, the rest counted, so the rationale never cuts a quote.
  const dropped = new Map<string, string[]>();
  for (const [passage, list] of lost) {
    const named = list
      .slice(0, 2)
      .map(
        (e) =>
          `The same page also has ${e.stance === 'supports' ? 'another supporting' : 'a contrary'} quote, not recorded as its own row: “${cutText(e.quote, 300)}”`,
      );
    const more = list.length - named.length;
    dropped.set(
      passage,
      more > 0
        ? [
            ...named,
            `It has ${more} more quote${more === 1 ? '' : 's'} not recorded as ${more === 1 ? 'its own row' : 'their own rows'}.`,
          ]
        : named,
    );
  }
  return dropped;
}

/**
 * Before the mark existed (main 9172584), a pass appended its count sentences straight after the
 * reading note. They start at the first of those known openings; the rest is the reading note.
 */
function withoutOldCount(text: string): string {
  const at = text.search(
    / (?:\d+ checked claims? waits?|The autopilot accepted \d|Your routine policy added \d|Quote-checked claims an autopilot found wait)/,
  );
  return at >= 0 ? text.slice(0, at) : text;
}

// ADR-0086 (P12): web discovery records. The runner (apps/api) drives the stages; every state
// change goes through a guarded update here, so a cancel between two steps always wins and a
// stage that already moved on is never written over.

const LIVE: readonly WebDiscoveryState[] = ['searching', 'fetching', 'reading'];
const TERMINAL: readonly WebDiscoveryState[] = [
  'done',
  'failed',
  'cancelled',
  'interrupted',
];

function toProposal(r: Row): WebClaimProposal {
  const p = r.proposal as CheckedProposal;
  return {
    id: String(r.id),
    ordinal: Number(r.ordinal),
    title: p.title,
    statement: p.statement,
    basis: p.basis,
    uncertainty: p.uncertainty,
    evidence: p.evidence,
    check: r.check_state as WebClaimProposal['check'],
    reasons: p.reasons,
    supporting_sources: p.supporting_sources,
    contradicting_sources: p.contradicting_sources,
    decision: r.decision as WebClaimProposal['decision'],
    claim_id: r.claim_id ? String(r.claim_id) : null,
    admitted_via: (r.admitted_via ?? null) as WebClaimProposal['admitted_via'],
    decided_by: r.decided_by ? String(r.decided_by) : null,
    decided_at: r.decided_at ? iso(r.decided_at) : null,
    decision_reason: r.decision_reason ? String(r.decision_reason) : null,
  };
}

function toDiscovery(r: Row, proposals: Row[]): WebDiscovery {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    run_id: String(r.run_id),
    fixture: Boolean(r.fixture),
    connection_id: String(r.connection_id),
    model_id: String(r.model_id),
    scope: WebDiscoveryScopeSchema.parse(r.scope),
    input_hash: String(r.input_hash),
    policy_version: String(r.policy_version),
    state: r.state as WebDiscoveryState,
    outcome: (r.outcome ?? null) as WebDiscoveryOutcome | null,
    explanation: String(r.explanation),
    search_request_id: r.search_request_id ? String(r.search_request_id) : null,
    read_request_id: r.read_request_id ? String(r.read_request_id) : null,
    search_calls: r.search_calls as WebSearchCall[],
    draft_summary: r.draft_summary === null ? null : String(r.draft_summary),
    leads: r.leads as WebLead[],
    packet_hash: r.packet_hash ? String(r.packet_hash) : null,
    not_covered: r.not_covered as string[],
    proposals: proposals.map(toProposal),
    version: Number(r.version),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
    finished_at: r.finished_at ? iso(r.finished_at) : null,
    active: false,
  };
}

/** The title a discovery is listed under: its focus, or "Broad search". */
export function webDiscoveryTitle(scope: WebDiscoveryScope): string {
  const parts = [
    scope.question,
    ...scope.interests,
    ...scope.target_groups,
  ].filter((x): x is string => !!x);
  return parts.length ? parts.join(' · ').slice(0, 300) : 'Broad search';
}

/** What the runner may change on a discovery in one guarded step. */
export interface WebDiscoveryPatch {
  state?: WebDiscoveryState;
  outcome?: WebDiscoveryOutcome;
  explanation?: string;
  search_calls?: WebSearchCall[];
  draft_summary?: string | null;
  leads?: WebLead[];
  packet_hash?: string;
  not_covered?: string[];
}

export class WebDiscoveryStore extends PortfolioStore {
  /** Exactly what a discovery with this scope sends; any member may look. */
  async previewWebDiscovery(
    ctxIn: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<WebDiscoveryPreview> {
    const ctx = normalize(ctxIn);
    const scope = parse(WebDiscoveryScopeSchema, raw ?? {});
    await this.tx((c) => this.role(c, uuid(ws), ctx.actorId, false));
    const input = scoutInput(scope);
    return {
      scope,
      instructions: SCOUT_PROMPT,
      input,
      input_hash: scoutInputHash(scope),
      chars: SCOUT_PROMPT.length + input.length,
      blocked_domains: blockedDomains(scope),
    };
  }

  /**
   * The owner starts one discovery on a run. The start is the one approval for its search
   * request, its reading request and fetching the pages it chooses (ADR-0086); it is refused
   * unless what is sent is what the owner previewed.
   */
  async createWebDiscovery(
    ctxIn: CommandContext,
    wsIn: string,
    runIn: string,
    raw: unknown,
  ): Promise<WebDiscovery> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const runId = uuid(runIn);
    const req = parse(StartWebDiscoveryRequestSchema, raw);
    if (scoutInputHash(req.scope) !== req.input_hash)
      throw fail(
        'VERSION_CONFLICT',
        'What the search would send is not what the preview showed. Check the preview again, then start.',
      );
    try {
      const id = await this.idempotent(
        ws,
        ctx,
        { op: 'web_discovery.start', runId, req },
        async (c) => {
          await this.requireOwner(c, ws, ctx.actorId);
          await this.lockRun(c, ws, runId);
          const run = (
            await c.query(
              'select * from run_controls where workspace_id = $1 and run_id = $2',
              [ws, runId],
            )
          ).rows[0] as Row | undefined;
          if (!run) throw fail('NOT_FOUND', 'Run is not registered.');
          if (
            run.state !== 'active' ||
            run.experiment_condition === 'human_only' ||
            run.autonomy_mode === 'human_only'
          )
            throw fail(
              'INVALID_TRANSITION',
              'The run is cancelled or human-only; web discovery uses a model.',
            );
          if (
            (
              await c.query(
                'select 1 from study_attempts where workspace_id = $1 and run_id = $2',
                [ws, runId],
              )
            ).rowCount
          )
            throw fail(
              'SCOPE_EXCEEDED',
              'Web discovery is not used for frozen study assignments.',
            );
          const conn = (
            await c.query(
              'select kind from plan_connections where workspace_id = $1 and id = $2',
              [ws, req.connection_id.toLowerCase()],
            )
          ).rows[0] as Row | undefined;
          if (!conn) throw fail('NOT_FOUND', 'Connection not found.');
          if (conn.kind !== 'chatgpt_plan')
            throw fail(
              'INVALID_CONTRACT',
              "Web search runs on a ChatGPT plan connection. The studio's Claude Code route runs without tools, so it cannot search yet.",
            );
          const id = randomUUID();
          await c.query(
            `insert into web_discoveries (id, workspace_id, fixture, run_id, connection_id, model_id,
               scope, input_hash, policy_version, state, version, created_by, autopilot_id)
             select $1, w.id, w.fixture, $3, $4, $5, $6, $7, $8, 'searching', 1, $9, $10
             from workspaces w where w.id = $2`,
            [
              id,
              ws,
              runId,
              req.connection_id.toLowerCase(),
              req.model_id,
              JSON.stringify(req.scope),
              req.input_hash,
              WEB_DISCOVERY_POLICY_VERSION,
              ctx.actorId,
              ctx.autopilot?.id ?? null,
            ],
          );
          await this.append(c, ctx, {
            workspaceId: ws,
            action: 'web_discovery.started',
            subjectKind: 'web_discovery',
            subjectId: id,
            subjectVersion: 1,
            contentHash: req.input_hash,
            payload: {
              connection_id: req.connection_id.toLowerCase(),
              model_id: req.model_id,
              max_search_calls: req.scope.max_search_calls,
              max_fetches: req.scope.max_fetches,
              max_claims: req.scope.max_claims,
            },
            relatedIds: [runId],
          });
          return id;
        },
      );
      return this.getWebDiscovery(ctx, ws, id);
    } catch (e) {
      if (isPgError(e, '23505', 'web_discoveries_one_live'))
        throw fail(
          'INVALID_TRANSITION',
          'A web discovery is already working in this workspace. Wait for it or cancel it first.',
        );
      throw e;
    }
  }

  async getWebDiscovery(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
  ): Promise<WebDiscovery> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.#read(c, ws, id);
    });
  }

  async #read(c: PoolClient, ws: string, id: string, lock = false) {
    const row = (
      await c.query(
        `select * from web_discoveries where workspace_id = $1 and id = $2${lock ? ' for update' : ''}`,
        [ws, id],
      )
    ).rows[0] as Row | undefined;
    if (!row) throw fail('NOT_FOUND', 'Web discovery not found.');
    const proposals = (
      await c.query(
        'select * from web_discovery_claims where discovery_id = $1 order by ordinal',
        [id],
      )
    ).rows as Row[];
    return toDiscovery(row, proposals);
  }

  async listWebDiscoveries(
    ctxIn: CommandContext,
    wsIn: string,
    runId?: string,
  ): Promise<WebDiscoverySummary[]> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select d.*,
           (select count(*) from web_discovery_claims k where k.discovery_id = d.id)::int as n_props,
           (select count(*) from web_discovery_claims k where k.discovery_id = d.id
              and k.decision = 'admitted')::int as n_admitted
         from web_discoveries d where d.workspace_id = $1 and ($2::uuid is null or d.run_id = $2)
         order by d.created_at desc limit 20`,
        [ws, runId ? uuid(runId) : null],
      );
      return (rows as Row[]).map((r) => {
        const leads = r.leads as WebLead[];
        return {
          id: String(r.id),
          run_id: String(r.run_id),
          fixture: Boolean(r.fixture),
          model_id: String(r.model_id),
          state: r.state as WebDiscoveryState,
          outcome: (r.outcome ?? null) as WebDiscoveryOutcome | null,
          created_at: iso(r.created_at),
          finished_at: r.finished_at ? iso(r.finished_at) : null,
          title: webDiscoveryTitle(WebDiscoveryScopeSchema.parse(r.scope)),
          leads: leads.length,
          fetched: leads.filter((l) => l.retrieval_state === 'fetched').length,
          proposals: Number(r.n_props),
          admitted: Number(r.n_admitted),
        };
      });
    });
  }

  /**
   * One guarded stage change by the runner. Null when the discovery is no longer in `from`
   * (cancelled, or another step moved it): the runner then stops without writing anything.
   */
  async advanceWebDiscovery(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    from: WebDiscoveryState,
    patch: WebDiscoveryPatch,
  ): Promise<WebDiscovery | null> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const row = (
        await c.query(
          'select * from web_discoveries where workspace_id = $1 and id = $2 for update',
          [ws, id],
        )
      ).rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Web discovery not found.');
      if (row.state !== from) return null;
      await this.#write(c, ctx, ws, row, patch);
      return this.#read(c, ws, id);
    });
  }

  async #write(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    row: Row,
    patch: WebDiscoveryPatch,
  ) {
    const state = patch.state ?? (row.state as WebDiscoveryState);
    await c.query(
      `update web_discoveries set state = $2, outcome = coalesce($3, outcome),
         explanation = coalesce($4, explanation), search_calls = coalesce($5, search_calls),
         draft_summary = case when $6::boolean then $7 else draft_summary end,
         leads = coalesce($8, leads), packet_hash = coalesce($9, packet_hash),
         not_covered = coalesce($10, not_covered), version = version + 1,
         updated_at = clock_timestamp(),
         finished_at = case when $11::boolean then clock_timestamp() else finished_at end
       where id = $1`,
      [
        row.id,
        state,
        patch.outcome ?? null,
        patch.explanation?.slice(0, 1200) ?? null,
        patch.search_calls ? JSON.stringify(patch.search_calls) : null,
        patch.draft_summary !== undefined,
        patch.draft_summary?.slice(0, 1200) ?? null,
        patch.leads ? JSON.stringify(patch.leads) : null,
        patch.packet_hash ?? null,
        patch.not_covered ? JSON.stringify(patch.not_covered) : null,
        TERMINAL.includes(state) && !TERMINAL.includes(row.state as never),
      ],
    );
    if (state !== row.state)
      await this.append(c, ctx, {
        workspaceId: ws,
        action: `web_discovery.${state}`,
        subjectKind: 'web_discovery',
        subjectId: String(row.id),
        subjectVersion: Number(row.version) + 1,
        contentHash: null,
        payload: {
          from: row.state,
          ...(patch.outcome ? { outcome: patch.outcome } : {}),
          ...(patch.explanation
            ? { explanation: patch.explanation.slice(0, 300) }
            : {}),
        },
        relatedIds: [String(row.run_id)],
      });
  }

  /** The reading answer's checked claims, recorded with the end of the discovery. */
  async finishWebDiscovery(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    result: {
      proposals: CheckedProposal[];
      packet_hash: string;
      not_covered: string[];
      outcome: WebDiscoveryOutcome;
      explanation: string;
    },
  ): Promise<WebDiscovery | null> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const row = (
        await c.query(
          'select * from web_discoveries where workspace_id = $1 and id = $2 for update',
          [ws, id],
        )
      ).rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Web discovery not found.');
      if (row.state !== 'reading') return null;
      for (const p of result.proposals)
        await c.query(
          `insert into web_discovery_claims (id, workspace_id, discovery_id, ordinal, proposal,
             proposal_hash, check_state) values ($1,$2,$3,$4,$5,$6,$7)`,
          [
            randomUUID(),
            ws,
            id,
            p.ordinal,
            JSON.stringify(p),
            canonicalHash(p),
            p.check,
          ],
        );
      await this.#write(c, ctx, ws, row, {
        state: 'done',
        outcome: result.outcome,
        explanation: result.explanation,
        packet_hash: result.packet_hash,
        not_covered: result.not_covered,
      });
      return this.#read(c, ws, id);
    });
  }

  /** The owner stops a discovery; a request already sent still settles on its own. */
  async cancelWebDiscovery(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    raw: unknown,
  ): Promise<WebDiscovery> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    const reason =
      raw && typeof raw === 'object' && 'reason' in raw
        ? String((raw as { reason: unknown }).reason).slice(0, 300)
        : 'Cancelled by the owner.';
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const row = (
        await c.query(
          'select * from web_discoveries where workspace_id = $1 and id = $2 for update',
          [ws, id],
        )
      ).rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Web discovery not found.');
      if (!LIVE.includes(row.state as WebDiscoveryState))
        throw fail(
          'INVALID_TRANSITION',
          `The discovery is already ${String(row.state)}.`,
        );
      await this.#write(c, ctx, ws, row, {
        state: 'cancelled',
        explanation: reason || 'Cancelled by the owner.',
      });
      return this.#read(c, ws, id);
    });
  }

  /** Existing claim statements and source URLs, for duplicate checks. */
  /**
   * What duplicate checks compare against: the newest 5000 active claims and 20000 source
   * URLs. Past those the checks are best effort (PR #173 review N-3); the owner still sees
   * every proposal before it is added.
   */
  async webDiscoveryKnown(
    ctxIn: CommandContext,
    wsIn: string,
  ): Promise<{ statements: string[]; urls: string[] }> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const statements = (
        await c.query<{ s: string }>(
          `select body->>'statement' as s from entities where workspace_id = $1
             and kind = 'claim' and status = 'active' order by updated_at desc limit 5000`,
          [ws],
        )
      ).rows
        .map((r) => r.s)
        .filter(Boolean);
      const urls = (
        await c.query<{ u: string }>(
          `select e.body->>'url' as u from research_sources rs join entities e
             on e.id = rs.source_id where rs.workspace_id = $1
             order by e.updated_at desc limit 20000`,
          [ws],
        )
      ).rows
        .map((r) => r.u)
        .filter(Boolean);
      return { statements, urls };
    });
  }

  /** The owner adds checked claims: one claim each, with every verified quote as support. */
  async admitWebClaims(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    raw: unknown,
  ): Promise<WebDiscovery> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    const req = parse(DecideWebClaimsRequestSchema, raw);
    await this.idempotent(
      ws,
      ctx,
      { op: 'web_discovery.admit', id, req },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        const rows = await this.#lockProposals(c, ws, id, req.proposal_ids);
        // ADR-0098 (re-review 3 L-1): the claims' sources, before the first claim appends.
        await this.#lockClaimSources(c, ws, rows);
        for (const r of rows)
          await this.#admitOne(
            c,
            ctx,
            ws,
            r,
            'owner',
            null,
            req.reason ?? 'Added by the owner from web discovery.',
          );
        return true;
      },
    );
    return this.getWebDiscovery(ctx, ws, id);
  }

  async dismissWebClaims(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    raw: unknown,
  ): Promise<WebDiscovery> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    const req = parse(DecideWebClaimsRequestSchema, raw);
    await this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const rows = await this.#lockProposals(c, ws, id, req.proposal_ids);
      for (const r of rows) {
        await c.query(
          `update web_discovery_claims set decision = 'dismissed', decided_by = $2,
             decided_at = clock_timestamp(), decision_reason = $3 where id = $1`,
          [r.id, ctx.actorId, req.reason ?? 'Dismissed by the owner.'],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'web_discovery.claim_dismissed',
          subjectKind: 'web_discovery_claim',
          subjectId: String(r.id),
          subjectVersion: null,
          contentHash: String(r.proposal_hash),
          payload: { reason: req.reason ?? null },
          relatedIds: [id],
        });
      }
    });
    return this.getWebDiscovery(ctx, ws, id);
  }

  /**
   * ADR-0086 unattended path: each pending verified claim is added only when the run's
   * routine approval policy covers the evidence stage now. The dry run comes first, so a claim
   * the policy does not cover raises no decision; it waits for the owner instead.
   */
  async admitWebClaimsByPolicy(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
  ): Promise<{ admitted: number; waiting: number; note: string | null }> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const d = (
        await c.query(
          'select run_id, state from web_discoveries where workspace_id = $1 and id = $2',
          [ws, id],
        )
      ).rows[0] as Row | undefined;
      if (!d) throw fail('NOT_FOUND', 'Web discovery not found.');
      const runId = String(d.run_id);
      await this.lockRun(c, ws, runId);
      // ADR-0098: every row this transaction writes is locked before the first claim appends to
      // the audit log: the discovery (updated at the end) and the grants each admission reads.
      await c.query('select 1 from web_discoveries where id = $1 for update', [
        id,
      ]);
      await this.lockAdmissionGrants(c, ws, runId);
      const pending = (
        await c.query(
          `select * from web_discovery_claims where discovery_id = $1 and decision = 'pending'
             and check_state = 'verified' order by ordinal for update`,
          [id],
        )
      ).rows as Row[];
      let admitted = 0;
      let note: string | null = null;
      // PR #173 review M-2: only observations (a quote that states the claim) are added
      // unattended; an inference from the quotes always waits for the owner.
      const observations = pending.filter(
        (r) => (r.proposal as CheckedProposal).basis === 'observation',
      );
      const inferences = pending.length - observations.length;
      const skipped: string[] = [];
      // Re-review R-2: with no routine policy on the run, nothing is tried and the note is short.
      const hasPolicy = !!(
        await c.query(
          `select 1 from routine_policies where workspace_id = $1 and run_id = $2
             and status = 'active'`,
          [ws, runId],
        )
      ).rowCount;
      // P-12 (ADR-0100): a search an autopilot made adds quote-checked claims only when the
      // owner's setting lets the autopilot accept them; otherwise they wait for a person.
      const auto = await this.#autopilotSearch(c, ctx, ws, id);
      const tryAdd = hasPolicy && (!auto || auto.accept) ? observations : [];
      const held =
        hasPolicy && auto && !auto.accept && observations.length
          ? 'Quote-checked claims an autopilot found wait for you: the setting “Accept quote-checked web claims” is off.'
          : '';
      // ADR-0098 (review 1 L-1): adding a claim's support share-locks the passage's source,
      // which a revision or archive locks before it appends; lock them before the first claim.
      await this.#lockClaimSources(c, ws, tryAdd);
      for (const r of tryAdd) {
        const action = {
          action_type: 'claim.admit' as const,
          task_id: null,
          target: null,
          spec_hash: String(r.proposal_hash),
          amount_nano_usd: null,
          data_class: 'public' as const,
          assumption_ids: [],
          humility_review: null,
          flags: [],
          justification: cutText(
            `Add the web discovery claim “${String((r.proposal as CheckedProposal).title)}”; its quotes were found word for word in the fetched pages.`,
            1200,
          ),
        };
        const dry = await this.wouldAdmit(c, ws, runId, action);
        if (
          dry.verdict !== 'allow' ||
          !dry.reason_code.startsWith('covered_by_routine_policy')
        ) {
          note = dry.explanation;
          break;
        }
        // PR #173 review L-3: each claim in its own savepoint, so one stale quote does not
        // undo the claims already added.
        await c.query('savepoint web_claim');
        try {
          const admission = await this.admitIn(c, ctx, ws, runId, action);
          if (admission.verdict !== 'allow') {
            await c.query('rollback to savepoint web_claim');
            note = admission.explanation;
            break;
          }
          await this.#admitOne(
            c,
            ctx,
            ws,
            r,
            auto ? 'autopilot' : 'routine_policy',
            admission.id,
            auto
              ? `${AUTOPILOT_QUOTE_CHECK_LABEL}: the owner's setting (version ${auto.version}) lets the autopilot use it; the run's routine approvals admitted it.`
              : 'Added by the routine approval policy (evidence stage).',
          );
          await c.query('release savepoint web_claim');
          admitted += 1;
        } catch (err) {
          await c.query('rollback to savepoint web_claim');
          // Only the studio's own refusals are shown as they are; anything else (a database
          // error) is named plainly instead of quoting its internals.
          skipped.push(
            `claim ${Number(r.ordinal) + 1}: ${err instanceof ContractError ? err.message : 'the studio could not record it'}`,
          );
        }
      }
      const waiting = pending.length - admitted;
      if (pending.length) {
        const summary = [
          admitted
            ? `${auto ? 'The autopilot accepted' : 'Your routine policy added'} ${admitted} checked claim${admitted === 1 ? '' : 's'}${auto ? ` (${AUTOPILOT_QUOTE_CHECK_LABEL})` : ''}; ${waiting} wait${waiting === 1 ? 's' : ''} for you.`
            : `${waiting} checked claim${waiting === 1 ? '' : 's'} wait${waiting === 1 ? 's' : ''} for you to add or dismiss.`,
          hasPolicy && inferences ? 'Inferences always wait for you.' : '',
          held,
          note ? `No routine policy added the rest: ${note}` : '',
          skipped.length ? `Not added: ${skipped.join('; ')}` : '',
        ]
          .filter(Boolean)
          .join(' ');
        // Live rerun (November 15): a later pass (the owner's setting turned on) replaces the
        // earlier pass's claim count instead of adding to it, so the note never contradicts itself.
        // Review 1 N-2: an explanation written before the mark existed drops its earlier
        // count sentences too, and the base is shortened so the mark and the count always fit.
        const tail = ` ${CLAIMS_MARK} ${cutText(summary, 600)}`;
        const prior = (
          await c.query(
            'select explanation from web_discoveries where id = $1',
            [id],
          )
        ).rows[0] as { explanation: string } | undefined;
        const before = prior?.explanation ?? '';
        const marked = before.indexOf(` ${CLAIMS_MARK}`);
        const base = (
          marked >= 0 ? before.slice(0, marked) : withoutOldCount(before)
        ).trimEnd();
        await c.query(
          `update web_discoveries set explanation = $2,
             version = version + 1, updated_at = clock_timestamp() where id = $1`,
          [id, cutText(base, 1200 - tail.length) + tail],
        );
      }
      return {
        admitted,
        waiting,
        note: note ?? (held || skipped[0] || null),
      };
    });
  }

  /**
   * P-12: whether an autopilot made this search (its step context, or a step that records it),
   * and the owner's setting on accepting quote-checked claims, read when the claims are added.
   */
  async #autopilotSearch(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    id: string,
  ): Promise<{ accept: boolean; version: number } | null> {
    // Review 1 L-6: the search records the autopilot that started it, so a person resuming it
    // after a restart still holds its quote-checked claims.
    const made =
      !!ctx.autopilot ||
      !!(
        await c.query(
          `select 1 from web_discoveries where workspace_id = $1 and id = $2
              and autopilot_id is not null
           union all
           select 1 from autopilots where workspace_id = $1
              and steps @> $3::jsonb limit 1`,
          [ws, id, JSON.stringify([{ child: { kind: 'web_discovery', id } }])],
        )
      ).rowCount;
    if (!made) return null;
    const s = (
      await c.query(
        'select settings, version from autopilot_settings where workspace_id = $1',
        [ws],
      )
    ).rows[0] as Row | undefined;
    return {
      accept:
        (s?.settings as Row | undefined)?.accept_quote_checked_claims === true,
      version: s ? Number(s.version) : 0,
    };
  }

  async #lockProposals(
    c: PoolClient,
    ws: string,
    id: string,
    ids: readonly string[],
  ): Promise<Row[]> {
    const d = (
      await c.query(
        'select state from web_discoveries where workspace_id = $1 and id = $2 for share',
        [ws, id],
      )
    ).rows[0] as Row | undefined;
    if (!d) throw fail('NOT_FOUND', 'Web discovery not found.');
    const rows = (
      await c.query(
        `select * from web_discovery_claims where discovery_id = $1 and id = any($2::uuid[])
           order by ordinal for update`,
        [id, ids.map((x) => uuid(x))],
      )
    ).rows as Row[];
    if (rows.length !== new Set(ids.map((x) => x.toLowerCase())).size)
      throw fail(
        'NOT_FOUND',
        'A proposed claim is not part of this discovery.',
      );
    for (const r of rows)
      if (r.decision !== 'pending')
        throw fail(
          'INVALID_TRANSITION',
          `Claim ${Number(r.ordinal) + 1} was already ${String(r.decision)}.`,
        );
    return rows;
  }

  /**
   * ADR-0098: share-locks, in id order, the sources behind these claims' verified quotes.
   * Adding a claim's support locks its source after the claim has appended, and an archive or
   * revision of the source locks it and then appends, so callers take these first.
   */
  async #lockClaimSources(c: PoolClient, ws: string, claims: Row[]) {
    const passages = claims.flatMap((r) =>
      (r.proposal as CheckedProposal).evidence.flatMap((e) =>
        e.verified && e.passage_id ? [e.passage_id] : [],
      ),
    );
    if (passages.length)
      await c.query(
        `select 1 from entities where workspace_id = $1 and id in
           (select source_id from source_passages where workspace_id = $1 and id = any($2::uuid[]))
         order by id for share`,
        [ws, passages],
      );
  }
  /** One claim and its verified support rows, in the caller's transaction. */
  async #admitOne(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    r: Row,
    via: 'owner' | 'routine_policy' | 'autopilot',
    admissionId: string | null,
    reason: string,
  ) {
    if (r.check_state !== 'verified')
      throw fail(
        'EVIDENCE_MISMATCH',
        `Claim ${Number(r.ordinal) + 1} has no supporting quote the studio could find word for word, so it cannot be added. Cite it by hand under Evidence instead.`,
      );
    const p = r.proposal as CheckedProposal;
    const claim = await this.insertEntity(c, ctx, ws, 'claim', p.title, {
      statement: p.statement,
      basis: p.basis,
      uncertainty: p.uncertainty,
    });
    const rationale = `From web discovery ${String(r.discovery_id)}; the studio found this quote word for word in the stored passage.`;
    let rows = 0;
    // Live rerun (November 15): one passage can hold two checked quotes for the same claim,
    // but a claim version keeps one support row per passage (claim_support_active). The
    // first quote from a passage is kept, supporting quotes before contrary ones.
    const seen = new Set<string>();
    const ordered = [
      ...p.evidence.filter((e) => e.stance === 'supports'),
      ...p.evidence.filter((e) => e.stance !== 'supports'),
    ];
    const dropped = droppedQuotes(ordered);
    for (const e of ordered) {
      // The stored excerpt is checked again by addClaimSupportIn; the length rule here.
      if (
        !e.verified ||
        !e.passage_id ||
        (e.stance === 'supports' && !webQuoteLongEnough(e.quote)) ||
        seen.has(e.passage_id)
      )
        continue;
      seen.add(e.passage_id);
      try {
        await this.addClaimSupportIn(c, ctx, ws, claim.id, {
          evidence: 'passage',
          claim_version: claim.version,
          passage_id: e.passage_id,
          stance: e.stance,
          support_type: p.basis === 'observation' ? 'quotation' : 'inference',
          quote: e.quote,
          rationale: cutText(
            [rationale, ...(dropped.get(e.passage_id) ?? [])].join(' '),
            1200,
          ),
        });
        rows += 1;
      } catch (err) {
        // The source moved to a new version since reading: that quote is not added, and the
        // claim is refused below if nothing supports it any more.
        if (
          !(err instanceof Error) ||
          !('code' in err) ||
          (err as { code: string }).code !== 'VERSION_CONFLICT'
        )
          throw err;
      }
    }
    const supported = (
      await c.query(
        `select 1 from claim_support where claim_id = $1 and stance = 'supports'`,
        [claim.id],
      )
    ).rowCount;
    if (!rows || !supported)
      throw fail(
        'VERSION_CONFLICT',
        `The pages behind claim ${Number(r.ordinal) + 1} changed since they were read, so its quotes no longer bind. Run the discovery again.`,
      );
    await c.query(
      `update web_discovery_claims set decision = 'admitted', claim_id = $2, admitted_via = $3,
         admission_id = $4, decided_by = $5, decided_at = clock_timestamp(),
         decision_reason = $6 where id = $1`,
      [r.id, claim.id, via, admissionId, ctx.actorId, reason.slice(0, 500)],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'web_discovery.claim_admitted',
      subjectKind: 'web_discovery_claim',
      subjectId: String(r.id),
      subjectVersion: null,
      contentHash: String(r.proposal_hash),
      payload: { via, claim_id: claim.id, support_rows: rows },
      relatedIds: [String(r.discovery_id), claim.id],
    });
    return claim;
  }
}
