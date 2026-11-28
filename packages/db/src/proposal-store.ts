import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  CreateProposalRequestSchema,
  HumilityBodySchema,
  PROPOSAL_KINDS,
  PROPOSAL_SECTIONS,
  ProposalDraftValueSchema,
  ProposalReviewRequestSchema,
  ReviseProposalRequestSchema,
  parse,
  type ClaimEvidence,
  type HumilityBody,
  type ProposalBody,
  type ProposalDetail,
  type ProposalDraft,
  type ProposalReview,
  type ProposalSectionDraft,
  type ProposalSummary,
  type ResponseExplanation,
  type ScorecardBody,
  type Selection,
  type StoredEntity,
  AUTOPILOT_QUOTE_CHECK_LABEL,
} from '@creator/contracts';
import {
  draftProposal,
  explainResponse,
  humilityGate,
  proposalChecks,
  proposalFileName,
  proposalMarkdown,
  selectionReport,
  type ChecksContext,
  type HumilityVerdict,
} from '@creator/domain';
import { CatalogStore } from './catalog-store.js';
import { PROBLEM_CLAIMS_SQL, toSelection } from './selection-store.js';
import {
  contentHashOf,
  fail,
  iso,
  normalize,
  toEntity,
  uuid,
  validateBody,
  type CommandContext,
  type Row,
} from './store.js';

const SOFTWARE = ['build', 'hybrid'];

/** ADR-0101: one "Draft the missing sections" record as the page reads it. */
export const toSectionDraft = (r: Row): ProposalSectionDraft => {
  const values: ProposalSectionDraft['values'] = {};
  for (const [k, v] of Object.entries(
    (r.draft_values as Record<string, unknown> | null) ?? {},
  )) {
    const ok = ProposalDraftValueSchema.safeParse(v);
    if (ok.success) values[k as keyof typeof values] = ok.data;
  }
  return {
    id: String(r.id),
    proposal_id: String(r.proposal_id),
    proposal_version: Number(r.proposal_version),
    state: String(r.state) as ProposalSectionDraft['state'],
    connection_kind: String(r.connection_kind),
    fixture: Boolean(r.fixture),
    model_id: String(r.model_id),
    sections: (r.sections ?? []) as ProposalSectionDraft['sections'],
    values,
    dropped: Number(r.dropped ?? 0),
    reason:
      r.reason === null || r.reason === undefined ? null : String(r.reason),
    sent:
      r.state === 'refused' || r.redacted_at
        ? null
        : {
            instructions_version: String(r.instructions_version),
            instructions_hash: String(r.instructions_hash),
            input: String(r.input),
            sections_sent: Number(r.sections_sent ?? 0),
          },
    requested_by: String(r.requested_by),
    created_at: iso(r.created_at),
    finished_at: r.finished_at ? iso(r.finished_at) : null,
  };
};
type Kind = ProposalBody['response'];
const isProposalKind = (k: string): k is Kind =>
  (PROPOSAL_KINDS as readonly string[]).includes(k);

/**
 * ADR-0077 (P09): why a response was chosen, and versioned non-code proposals (migration 49).
 * The explanation is computed on read; a proposal is a `proposal` entity written only here, so
 * its option, selection and citations are checked; reviews are bound to one exact version.
 */
export class ProposalStore extends CatalogStore {
  /** The problem's current (latest) selection, if any. */
  private async currentSelection(
    c: PoolClient,
    ws: string,
    problemId: string,
  ): Promise<Selection | null> {
    const { rows } = await c.query(
      `select * from selections where workspace_id = $1 and problem_id = $2
        order by created_at desc, id desc limit 1`,
      [ws, problemId],
    );
    return rows[0] ? toSelection(rows[0] as Row, true) : null;
  }

  private async explain(c: PoolClient, ws: string, problemId: string) {
    const {
      problem,
      candidates,
      evidence,
      linked_hash,
      problem_linked_hash,
      team_hash,
    } = await this.gather(c, ws, problemId);
    const report = selectionReport({
      problem: {
        id: problem.id,
        version: problem.version,
        title: problem.title,
      },
      candidates,
      shortlist_size: 3,
      evidence,
      linked_hash,
      problem_linked_hash,
      // Merge review L-1: the same inputs as recordSelection, so team staleness and the
      // report hash agree.
      team_hash,
    });
    const ids = candidates.map((x) => x.alternative.id);
    const alts = (
      await c.query(
        `select id, body from entities where workspace_id = $1 and id = any($2::uuid[])`,
        [ws, ids],
      )
    ).rows as { id: string; body: Row | null }[];
    const rationales = new Map(
      alts.map((a) => [
        String(a.id).toLowerCase(),
        String(a.body?.rationale ?? ''),
      ]),
    );
    const cards = new Map<string, ScorecardBody>();
    for (const x of candidates)
      for (const s of x.scorecards)
        cards.set(s.id.toLowerCase(), s.body as ScorecardBody);
    const reviews = new Map<
      string,
      {
        id: string;
        version: number;
        body: HumilityBody;
        verdict: HumilityVerdict;
      }
    >();
    const software = candidates.filter((x) =>
      SOFTWARE.includes(x.alternative.kind),
    );
    if (software.length) {
      const { rows } = await c.query(
        `select distinct on (body->'subject'->>'id') * from entities
          where workspace_id = $1 and kind = 'humility_review' and status = 'active'
            and body->'subject'->>'id' = any($2::text[])
          order by body->'subject'->>'id', updated_at desc, id`,
        [ws, software.map((x) => x.alternative.id)],
      );
      for (const r of rows.map((x: Row) => toEntity(x))) {
        const body = HumilityBodySchema.safeParse(r.body);
        if (!body.success) continue;
        const alt = software.find(
          (x) =>
            x.alternative.id.toLowerCase() ===
            body.data.subject.id.toLowerCase(),
        )!;
        reviews.set(alt.alternative.id.toLowerCase(), {
          id: r.id,
          version: r.version,
          body: body.data,
          verdict: humilityGate(
            { id: r.id, version: r.version, status: r.status, body: r.body },
            { id: alt.alternative.id, version: alt.alternative.version },
            alt.alternative.kind === 'hybrid' ? 'hybrid' : 'software',
          ),
        });
      }
    }
    const explanation = explainResponse({
      report,
      selection: await this.currentSelection(c, ws, problemId),
      rationales,
      cards,
      reviews,
    });
    return { problem, explanation };
  }

  /** Why the chosen response was chosen, and what would make a software route preferable. */
  async responseExplanation(
    ctx: CommandContext,
    ws: string,
    problemId: string,
  ): Promise<ResponseExplanation> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    problemId = uuid(problemId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return (await this.explain(c, ws, problemId)).explanation;
    });
  }

  /**
   * The option must be a non-code response (or a hybrid's whole plan) that the problem's
   * current selection advanced. Returns the option, its problem and that selection.
   */
  private async proposalSubject(
    c: PoolClient,
    ws: string,
    alternativeId: string,
  ) {
    const a = await c.query(
      `select * from entities where workspace_id = $1 and id = $2 and kind = 'alternative'`,
      [ws, alternativeId],
    );
    if (!a.rows[0]) throw fail('NOT_FOUND', 'Option not found.');
    const option = toEntity(a.rows[0] as Row);
    if (option.status !== 'active')
      throw fail('INVALID_TRANSITION', `The option is ${option.status}.`);
    const kind = String(option.body?.kind ?? '');
    if (!isProposalKind(kind))
      throw fail(
        'INVALID_CONTRACT',
        `A ${kind.replaceAll('_', ' ')} outcome has no plan to propose.`,
      );
    const p = await c.query(
      `select e.* from entity_links l join entities e on e.id = l.to_id
        where l.workspace_id = $1 and l.from_id = $2 and l.relation = 'derived_from'
          and l.to_kind = 'problem' and l.retracted_at is null and e.status = 'active'
        order by l.created_at desc limit 1`,
      [ws, option.id],
    );
    if (!p.rows[0])
      throw fail('INVALID_TRANSITION', 'The option has no active problem.');
    const problem = toEntity(p.rows[0] as Row);
    const selection = await this.currentSelection(c, ws, problem.id);
    const choice = selection?.dispositions.find(
      (d) => d.alternative.id.toLowerCase() === option.id,
    );
    // ADR-0138: custom software has a proposal only as a validation plan; selected for a
    // build, it goes to a spec instead.
    if (
      !selection ||
      !choice ||
      !(
        kind === 'build'
          ? ['proceed_to_validation']
          : ['recommend_alternative', 'proceed_to_validation']
      ).includes(choice.disposition)
    )
      throw fail(
        'INVALID_TRANSITION',
        kind === 'build'
          ? 'Custom software has a proposal only as a validation plan: record a selection that takes it to validation first (selected for a build, it goes to a spec).'
          : 'Record a selection that recommends this option (or proceeds to validate it) before writing its proposal.',
      );
    if (choice.alternative.version !== option.version)
      throw fail(
        'VERSION_CONFLICT',
        'The option changed since it was selected; select it again before writing its proposal.',
      );
    return { option, kind, problem, selection };
  }

  protected async problemClaims(c: PoolClient, ws: string, problemId: string) {
    const { rows } = await c.query<{ id: string; relation: string }>(
      `select distinct on (x.from_id) x.from_id::text as id, x.relation from (${PROBLEM_CLAIMS_SQL}) x
        order by x.from_id, (x.relation = 'contradicts') desc, x.created_at`,
      [ws, problemId],
    );
    return new Map(
      rows.map((r) => [
        r.id.toLowerCase(),
        r.relation === 'contradicts'
          ? ('contradicts' as const)
          : ('supports' as const),
      ]),
    );
  }

  /** A first draft built from the records; nothing is saved. */
  async proposalDraft(
    ctx: CommandContext,
    ws: string,
    alternativeId: string,
  ): Promise<ProposalDraft> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    alternativeId = uuid(alternativeId);
    const draft = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { option, kind, problem, selection } = await this.proposalSubject(
        c,
        ws,
        alternativeId,
      );
      const linked = await this.problemClaims(c, ws, problem.id);
      const claims = linked.size
        ? (
            await c.query(
              `select id, version, title, body from entities where workspace_id = $1
                 and id = any($2::uuid[]) and status = 'active' order by created_at, id`,
              [ws, [...linked.keys()]],
            )
          ).rows.map((r: Row) => ({
            id: String(r.id),
            version: Number(r.version),
            statement: String((r.body as Row | null)?.statement ?? r.title),
            relation: linked.get(String(r.id).toLowerCase())!,
          }))
        : [];
      const { explanation } = await this.explain(c, ws, problem.id);
      return draftProposal({
        problem,
        option,
        response: kind as Kind,
        selection,
        claims,
        explanation,
      });
    });
    return { ...draft, checks: await this.checksFor(ctx, ws, draft.body) };
  }

  /** The checks of one proposal body, against the records as they are now. */
  private async checksFor(ctx: CommandContext, ws: string, body: ProposalBody) {
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.checksIn(c, ws, body);
    });
  }

  /** checksFor inside the caller's transaction (the caller checked the role). */
  private async checksIn(c: PoolClient, ws: string, body: ProposalBody) {
    const cited = [
      ...new Set(
        Object.values(body.sections).flatMap((s) =>
          s.claims.map((x) => x.id.toLowerCase()),
        ),
      ),
    ];
    const base = await (async () => {
      const p = await c.query(
        `select version, status from entities where workspace_id = $1 and id = $2 and kind = 'problem'`,
        [ws, body.problem.id.toLowerCase()],
      );
      const o = await c.query(
        `select version, status from entities where workspace_id = $1 and id = $2 and kind = 'alternative'`,
        [ws, body.alternative.id.toLowerCase()],
      );
      const s = await c.query(
        `select id from selections where workspace_id = $1 and problem_id = $2
          order by created_at desc, id desc limit 1`,
        [ws, body.problem.id.toLowerCase()],
      );
      const linked = await this.problemClaims(
        c,
        ws,
        body.problem.id.toLowerCase(),
      );
      const found = cited.length
        ? (
            await c.query(
              `select * from entities
                where workspace_id = $1 and kind = 'claim' and id = any($2::uuid[])`,
              [ws, cited],
            )
          ).rows
        : [];
      // Evidence for every cited active claim, read in this one transaction. A failure fails
      // the request: a reference never silently loses its evidence status (review L-5).
      const evidence = new Map<string, ClaimEvidence>();
      for (const r of found as Row[])
        if (String(r.status) === 'active')
          evidence.set(
            String(r.id).toLowerCase(),
            await this.claimEvidenceIn(c, ws, r),
          );
      const pr = p.rows[0] as Row | undefined;
      const or = o.rows[0] as Row | undefined;
      return {
        problem_version:
          pr && pr.status === 'active' ? Number(pr.version) : null,
        option: or
          ? { version: Number(or.version), status: String(or.status) }
          : null,
        selection_current:
          String((s.rows[0] as Row | undefined)?.id ?? '') ===
          body.selection_id.toLowerCase(),
        linked,
        found: found as Row[],
        evidence,
      };
    })();
    const claims: Map<
      string,
      ChecksContext['claims'] extends ReadonlyMap<string, infer V> ? V : never
    > = new Map();
    for (const r of base.found) {
      const id = String(r.id).toLowerCase();
      const status = String(r.status);
      let evidenceStatus = status;
      let sources: ProposalDetail['checks']['references'][number]['sources'] =
        [];
      if (status === 'active') {
        const ev = base.evidence.get(id);
        if (ev) {
          evidenceStatus = ev.status;
          sources = ev.rows.slice(0, 10).map((x) => ({
            title: x.source_title.slice(0, 500),
            url: x.source_url.slice(0, 2000),
            stance: x.support.stance,
            freshness: x.freshness,
            quote: x.support.quote,
          }));
        }
      }
      claims.set(id, {
        version: Number(r.version),
        status,
        statement:
          status === 'redacted'
            ? '(redacted)'
            : `${
                base.evidence
                  .get(id)
                  ?.labels.includes(AUTOPILOT_QUOTE_CHECK_LABEL)
                  ? `${AUTOPILOT_QUOTE_CHECK_LABEL}: `
                  : ''
              }${String((r.body as Row | null)?.statement ?? r.title)}`.slice(
                0,
                2000,
              ),
        evidence_status: evidenceStatus,
        relation: base.linked.get(id) ?? 'not_linked',
        sources,
      });
    }
    return proposalChecks(body, {
      problem_version: base.problem_version,
      option: base.option,
      selection_current: base.selection_current,
      claims,
      contrary_linked: [...base.linked]
        .filter(([, r]) => r === 'contradicts')
        .map(([id]) => id),
    });
  }

  /** Cited claims must be claims of this workspace at the version cited, and active. */
  private async checkCitations(c: PoolClient, ws: string, body: ProposalBody) {
    const refs = Object.values(body.sections).flatMap((s) => s.claims);
    if (!refs.length) return;
    const { rows } = await c.query<{
      id: string;
      version: number;
      status: string;
    }>(
      `select id::text, version, status from entities
        where workspace_id = $1 and kind = 'claim' and id = any($2::uuid[])`,
      [ws, [...new Set(refs.map((r) => r.id.toLowerCase()))]],
    );
    for (const r of refs) {
      const f = rows.find((x) => x.id === r.id.toLowerCase());
      if (!f || f.status === 'redacted')
        throw fail(
          'MISSING_EVIDENCE',
          `Claim ${r.id.slice(0, 8)} is not a claim in this workspace.`,
        );
      if (f.status !== 'active')
        throw fail(
          'VERSION_CONFLICT',
          `Claim ${r.id.slice(0, 8)} is ${f.status}; cite active claims.`,
        );
      if (Number(f.version) !== r.version)
        throw fail(
          'VERSION_CONFLICT',
          `Claim ${r.id.slice(0, 8)} is now version ${f.version}; cite the current version.`,
        );
    }
  }

  async createProposal(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateProposalRequestSchema, raw);
    const id = await this.idempotent(
      ws,
      ctx,
      { op: 'proposal.create', req },
      async (c) => {
        await this.role(c, ws, ctx.actorId, true);
        const { option, kind, problem, selection } = await this.proposalSubject(
          c,
          ws,
          req.body.alternative.id.toLowerCase(),
        );
        if (
          req.body.alternative.version !== option.version ||
          req.body.problem.id.toLowerCase() !== problem.id ||
          req.body.problem.version !== problem.version ||
          req.body.selection_id.toLowerCase() !== selection.id ||
          req.body.response !== kind
        )
          throw fail(
            'VERSION_CONFLICT',
            'The option, its problem or the selection changed since this draft was made; start a fresh draft.',
          );
        await this.checkCitations(c, ws, req.body);
        const body = validateBody(
          'proposal',
          await this.markDrafts(c, ws, null, req.body),
        );
        const e = await this.insertEntity(
          c,
          ctx,
          ws,
          'proposal',
          req.title,
          body,
        );
        await this.linkTo(
          c,
          ctx,
          ws,
          'derived_from',
          e,
          option,
          'Proposal for the recommended option.',
        );
        return e.id;
      },
    );
    return this.proposalDetail(ctx, ws, id);
  }

  /**
   * A new version. The option and problem stay the same; a later selection or changed option
   * shows as a check rather than blocking the person from finishing their document.
   */
  async reviseProposal(
    ctx: CommandContext,
    ws: string,
    proposalId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    proposalId = uuid(proposalId);
    const req = parse(ReviseProposalRequestSchema, raw);
    await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const current = await this.lockCurrent(
        c,
        ws,
        proposalId,
        req.expected_version,
      );
      if (current.kind !== 'proposal')
        throw fail('NOT_FOUND', 'Proposal not found.');
      if (current.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          `A ${current.status} proposal cannot be revised.`,
        );
      const before = current.body as unknown as ProposalBody;
      const same = (
        a: { id: string; version: number },
        b: { id: string; version: number },
      ) => a.id.toLowerCase() === b.id.toLowerCase() && a.version === b.version;
      if (
        !same(before.problem, req.body.problem) ||
        !same(before.alternative, req.body.alternative) ||
        before.selection_id.toLowerCase() !==
          req.body.selection_id.toLowerCase() ||
        before.response !== req.body.response
      )
        throw fail(
          'INVALID_CONTRACT',
          'A revision keeps the proposal’s problem, option and selection; start a new proposal for a different one.',
        );
      await this.checkCitations(c, ws, req.body);
      const body = validateBody(
        'proposal',
        await this.markDrafts(c, ws, proposalId, req.body),
      );
      const hash = contentHashOf('proposal', req.title, body);
      if (hash === current.content_hash)
        throw fail(
          'DUPLICATE',
          'Revision is identical to the current version.',
        );
      await this.writeVersion(c, ctx, current, {
        status: 'active',
        title: req.title,
        body,
        hash,
        reason: req.reason,
        corrects: null,
        action: 'entity.revised',
        payload: {},
      });
    });
    return this.proposalDetail(ctx, ws, proposalId);
  }

  /**
   * ADR-0101: a section's draft mark names a completed draft of this proposal that drafted
   * that section. The model and whether the text was edited are set here from the draft
   * record, so the page cannot claim a person wrote model text, or the reverse.
   */
  private async markDrafts(
    c: PoolClient,
    ws: string,
    proposalId: string | null,
    body: ProposalBody,
  ): Promise<ProposalBody> {
    const marked = PROPOSAL_SECTIONS.filter((k) => body.sections[k].draft);
    if (!marked.length) return body;
    if (!proposalId)
      throw fail(
        'INVALID_CONTRACT',
        'A new proposal has no model drafts yet; save it first, then draft its missing sections.',
      );
    const ids = [
      ...new Set(marked.map((k) => body.sections[k].draft!.id.toLowerCase())),
    ];
    const rows = (
      await c.query(
        `select id::text as id, model_id, draft_values, state from proposal_section_drafts
          where workspace_id = $1 and proposal_id = $2 and id = any($3::uuid[])`,
        [ws, proposalId, ids],
      )
    ).rows as Row[];
    const sections = { ...body.sections };
    for (const k of marked) {
      const mark = sections[k].draft!;
      const row = rows.find((r) => r.id === mark.id.toLowerCase());
      const value = ProposalDraftValueSchema.safeParse(
        (row?.draft_values as Record<string, unknown> | undefined)?.[k],
      );
      if (
        !row ||
        row.state !== 'completed' ||
        !value.success ||
        value.data.state !== 'written'
      )
        throw fail(
          'INVALID_CONTRACT',
          `The model draft named for “${k.replaceAll('_', ' ')}” is not a draft of that section for this proposal.`,
        );
      sections[k] = {
        ...sections[k],
        draft: {
          id: mark.id.toLowerCase(),
          model_id: String(row.model_id),
          edited: sections[k].text.trim() !== value.data.text.trim(),
        },
      };
    }
    return { ...body, sections };
  }

  /** ADR-0101: the newest model drafts of a proposal's missing sections. */
  async listProposalSectionDrafts(
    ctx: CommandContext,
    ws: string,
    proposalId: string,
  ): Promise<ProposalSectionDraft[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    proposalId = uuid(proposalId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from proposal_section_drafts where workspace_id = $1 and proposal_id = $2
          order by created_at desc, id desc limit 20`,
        [ws, proposalId],
      );
      return rows.map((r) => toSectionDraft(r as Row));
    });
  }

  async listProposals(
    ctx: CommandContext,
    ws: string,
    problemId?: string,
  ): Promise<ProposalSummary[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const problem = problemId ? uuid(problemId) : null;
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from entities where workspace_id = $1 and kind = 'proposal'
           and status in ('active', 'archived')
           and ($2::text is null or lower(body->'problem'->>'id') = $2)
         order by updated_at desc, id desc limit 200`,
        [ws, problem],
      );
      return rows.map((r: Row) => {
        const e = toEntity(r);
        const b = e.body as unknown as ProposalBody;
        return {
          id: e.id,
          version: e.version,
          status: e.status,
          title: e.title,
          response: b.response,
          problem: b.problem,
          alternative: b.alternative,
          updated_at: e.updated_at,
        };
      });
    });
  }

  /** One version of a proposal (the current one by default) with its checks and reviews. */
  async proposalDetail(
    ctx: CommandContext,
    ws: string,
    proposalId: string,
    version?: number,
  ): Promise<ProposalDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    proposalId = uuid(proposalId);
    const got = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'proposal'`,
        [ws, proposalId],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Proposal not found.');
      const e = toEntity(rows[0] as Row);
      if (e.status === 'redacted')
        throw fail('NOT_FOUND', 'Proposal was redacted.');
      const versions = (
        await c.query(
          `select version, title, body, content_hash, reason, actor_id, created_at
             from entity_versions where entity_id = $1 and workspace_id = $2 and body is not null
            order by version desc`,
          [e.id, ws],
        )
      ).rows as Row[];
      const want = version ?? e.version;
      const shown = versions.find((v) => Number(v.version) === want);
      if (!shown)
        throw fail('NOT_FOUND', `Proposal version ${want} not found.`);
      const reviews = (
        await c.query(
          `select r.*, a.display_name from proposal_reviews r join actors a on a.id = r.reviewer
            where r.workspace_id = $1 and r.proposal_id = $2 order by r.created_at desc, r.id`,
          [ws, e.id],
        )
      ).rows as Row[];
      const titles = (
        await c.query<{ id: string; title: string }>(
          'select id::text, title from entities where workspace_id = $1 and id = any($2::uuid[])',
          [
            ws,
            [
              String((e.body?.problem as Row).id).toLowerCase(),
              String((e.body?.alternative as Row).id).toLowerCase(),
            ],
          ],
        )
      ).rows;
      return { e, versions, shown, reviews, titles };
    });
    const { e, versions, shown, reviews, titles } = got;
    const body = shown.body as unknown as ProposalBody;
    const title = (id: string) =>
      titles.find((t) => t.id === id.toLowerCase())?.title ?? '(not found)';
    return {
      proposal: {
        id: e.id,
        version: e.version,
        status: e.status,
        title: String(shown.title),
        content_hash: String(shown.content_hash),
        body,
        created_at: e.created_at,
        updated_at: e.updated_at,
      },
      shown_version: Number(shown.version),
      versions: versions.map((v) => ({
        version: Number(v.version),
        title: String(v.title),
        content_hash: String(v.content_hash),
        reason: (v.reason as string | null) ?? null,
        actor_id: String(v.actor_id),
        created_at: iso(v.created_at),
      })),
      checks: await this.checksFor(ctx, ws, body),
      reviews: reviews.map((r): ProposalReview => ({
        id: String(r.id),
        proposal_id: String(r.proposal_id),
        version: Number(r.proposal_version),
        content_hash: String(r.content_hash),
        verdict: r.verdict as ProposalReview['verdict'],
        marks: r.marks as ProposalReview['marks'],
        comments: String(r.comments),
        reviewer: String(r.reviewer),
        reviewer_name: String(r.display_name),
        created_at: iso(r.created_at),
        current: Number(r.proposal_version) === e.version,
        self_review:
          String(r.reviewer) ===
          String(
            versions.find(
              (v) => Number(v.version) === Number(r.proposal_version),
            )?.actor_id ?? '',
          ),
      })),
      problem_title: title(body.problem.id),
      option_title: title(body.alternative.id),
    };
  }

  /** Feedback on one exact version; refused if the proposal moved on since it was read. */
  async reviewProposal(
    ctx: CommandContext,
    ws: string,
    proposalId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    proposalId = uuid(proposalId);
    const req = parse(ProposalReviewRequestSchema, raw);
    await this.idempotent(
      ws,
      ctx,
      { op: 'proposal.review', proposalId, req },
      async (c) => {
        await this.role(c, ws, ctx.actorId, true);
        const { rows } = await c.query(
          `select * from entities where workspace_id = $1 and id = $2 and kind = 'proposal' for update`,
          [ws, proposalId],
        );
        if (!rows[0]) throw fail('NOT_FOUND', 'Proposal not found.');
        const e: StoredEntity = toEntity(rows[0] as Row);
        if (e.status !== 'active')
          throw fail(
            'INVALID_TRANSITION',
            `A ${e.status} proposal cannot be reviewed.`,
          );
        if (e.version !== req.version || e.content_hash !== req.content_hash)
          throw fail(
            'VERSION_CONFLICT',
            `The proposal is now version ${e.version}; review the current version.`,
          );
        if (req.verdict === 'revise' && !req.comments)
          throw fail('INVALID_CONTRACT', 'Say what to revise.');
        // Review L-3: "ready" is refused while the document checks still find a blocker or an
        // unknown core section; the reviewer can still ask for a revision.
        if (req.verdict === 'ready') {
          const checks = await this.checksIn(
            c,
            ws,
            e.body as unknown as ProposalBody,
          );
          if (!checks.ready_for_review)
            throw fail(
              'INVALID_TRANSITION',
              'This version is not ready for review: a core section is unknown or a check found a blocker. Ask for a revision instead.',
            );
        }
        const reviewId = randomUUID();
        await c.query(
          `insert into proposal_reviews (id, workspace_id, proposal_id, proposal_version, content_hash,
           verdict, marks, comments, reviewer) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            reviewId,
            ws,
            e.id,
            e.version,
            e.content_hash,
            req.verdict,
            req.marks,
            req.comments,
            ctx.actorId,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'proposal.reviewed',
          subjectKind: 'proposal',
          subjectId: e.id,
          subjectVersion: e.version,
          contentHash: e.content_hash,
          payload: { verdict: req.verdict, marks: req.marks },
        });
        return reviewId;
      },
    );
    return this.proposalDetail(ctx, ws, proposalId);
  }

  /** The canonical Markdown export of one version, with a file name that carries the version. */
  async proposalExport(
    ctx: CommandContext,
    ws: string,
    proposalId: string,
    version?: number,
  ) {
    const d = await this.proposalDetail(ctx, ws, proposalId, version);
    return {
      name: proposalFileName(d.proposal.title, d.shown_version),
      version: d.shown_version,
      markdown: proposalMarkdown({
        id: d.proposal.id,
        version: d.shown_version,
        title: d.proposal.title,
        content_hash: d.proposal.content_hash,
        body: d.proposal.body,
        checks: d.checks,
        problem_title: d.problem_title,
        option_title: d.option_title,
        saved_at:
          d.versions.find((v) => v.version === d.shown_version)?.created_at ??
          d.proposal.updated_at,
      }),
    };
  }
}
