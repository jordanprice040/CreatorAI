import { draftedMark } from './spec-draft-gates.js';
import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  ConfirmGateRequestSchema,
  ConfirmGatesRequestSchema,
  ContractError,
  gateItemReason,
  type ConfirmGatesResult,
  CreateScorecardRequestSchema,
  CreateSpecRequestSchema,
  FreezeSpecRequestSchema,
  ReviseScorecardRequestSchema,
  ReviseSpecRequestSchema,
  SelectRequestSchema,
  SpecBodySchema,
  StartAssessmentRequestSchema,
  parse,
  type AssessmentPacket,
  type AssessmentPreview,
  type WorkflowDetail,
  type Admission,
  type FreezeOutcome,
  type GateConfirmation,
  type ScorecardBody,
  type SelectOutcome,
  type Selection,
  type SelectionReport,
  type SpecBody,
  type SpecFreeze,
  type SpecStatus,
  type StoredEntity,
  MODEL_ONLY_ETHICS_NOTE,
} from '@creator/contracts';
import {
  ASSESSMENT_PROMPT_HASH,
  ASSESSMENT_ROLE_VERSION,
  assessmentPreviewHash,
  buildAssessmentPacket,
  supportHash,
  type AssessmentInputClaim,
  type OptionCoverage,
  canonicalHash,
  checkSelection,
  humilityGate,
  selectionReport,
  taskHashes,
  taskImpact,
  modelClearedEthics,
  checklistHash,
  teamHash,
  validateSpec,
  type CandidateInput,
  type EvidenceVersions,
  type HumilityState,
} from '@creator/domain';
import type { AssessmentWorkflowContext } from './workflow-store.js';
import { TeamStore } from './team-store.js';
import {
  contentHashOf,
  fail,
  normalize,
  toEntity,
  recordedActor,
  uuid,
  validateBody,
  type CommandContext,
  type Row,
} from './store.js';

const SOFTWARE = ['build', 'hybrid'];
const outcomeOf = (a: Admission) =>
  ({
    id: a.id,
    verdict: a.verdict,
    reason_code: a.reason_code,
    explanation: a.explanation,
    decision_id: a.decision_id,
  }) satisfies SelectOutcome['admission'];
/** What a caller sees when admission did not allow the action. */
const notAllowed = (a: Admission) =>
  a.verdict === 'request_human'
    ? ('needs_human' as const)
    : a.verdict === 'deny'
      ? ('denied' as const)
      : ('deferred' as const);
const iso = (v: unknown) => new Date(v as string | Date).toISOString();
/**
 * ADR-0074: system scorecards come only from an assessment workflow. A person (or the CLI)
 * records human or labelled fixture scorecards, never a model's or one carrying provenance.
 */
function personalScorecard(body: ScorecardBody) {
  if (body.assessment || body.reviewer.kind === 'model')
    throw fail(
      'ACCESS_DENIED',
      'Model scorecards are written only by an automatic assessment; record your own ratings as a person.',
    );
}
export function toSelection(r: Row, current: boolean): Selection {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    run_id: String(r.run_id),
    problem: { id: String(r.problem_id), version: Number(r.problem_version) },
    report_hash: String(r.report_hash),
    report: r.report as SelectionReport,
    dispositions: r.dispositions as Selection['dispositions'],
    overrides: r.overrides as Selection['overrides'],
    override_reason: (r.override_reason as string | null) ?? null,
    rationale: String(r.rationale),
    admission_id: String(r.admission_id),
    actor_id: String(r.actor_id),
    autopilot_id: r.autopilot_id ? String(r.autopilot_id) : null,
    created_at: iso(r.created_at),
    current,
  };
}
export function toFreeze(r: Row): SpecFreeze {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    run_id: String(r.run_id),
    spec: { id: String(r.spec_id), version: Number(r.spec_version) },
    content_hash: String(r.content_hash),
    selection_id: String(r.selection_id),
    task_hashes: r.task_hashes as Record<string, string>,
    admission_id: String(r.admission_id),
    actor_id: String(r.actor_id),
    created_at: iso(r.created_at),
  };
}
export const contentOf = (b: SpecBody) => {
  const { format: _f, alternative: _a, selection_id: _s, ...content } = b;
  return content;
};

/**
 * T08 scoring, selection and specifications (migration 7). Scores are computed on read from
 * the current scorecards; a selection stores the report it was made from, so the original
 * ranking survives any override. Selecting and freezing are admitted actions under the run's
 * policy (T03), after deterministic gates that no score can clear.
 */
/**
 * The active claims linked to a problem ($1 workspace, $2 problem): a claim that supports or
 * contradicts it, or one the problem was derived from (a drafted problem records its claims
 * that way; it counts as support). Assessments, their staleness and Compare read the same set.
 */
export const PROBLEM_CLAIMS_SQL = `
  select l.from_id, l.relation, l.created_at from entity_links l
    join entities e on e.id = l.from_id and e.status = 'active'
   where l.workspace_id = $1 and l.to_id = $2 and l.from_kind = 'claim'
     and l.relation in ('supports', 'contradicts') and l.retracted_at is null
  union all
  select l.to_id as from_id, 'supports' as relation, l.created_at from entity_links l
    join entities e on e.id = l.to_id and e.status = 'active'
   where l.workspace_id = $1 and l.from_id = $2 and l.to_kind = 'claim'
     and l.relation = 'derived_from' and l.retracted_at is null`;

/**
 * ADR-0091: the claims an assessment reads ($1 workspace, $2 problem): the problem's claims
 * (option_id null) and the active claims that support one of its active options. Assessment
 * packets and their staleness (linked_hash) read this set; Compare still lists the problem's.
 */
export const ASSESSMENT_CLAIMS_SQL = `
  select p.from_id, p.relation, p.created_at, null::uuid as option_id
    from (${PROBLEM_CLAIMS_SQL}) p
  union all
  select l.from_id, 'supports' as relation, l.created_at, l.to_id as option_id
    from entity_links l
    join entities e on e.id = l.from_id and e.status = 'active'
    join entities a on a.id = l.to_id and a.status = 'active'
   where l.workspace_id = $1 and l.relation = 'supports' and l.from_kind = 'claim'
     and l.to_kind = 'alternative' and l.retracted_at is null
     and exists (select 1 from entity_links o
                  where o.workspace_id = $1 and o.from_id = l.to_id and o.to_id = $2
                    and o.relation = 'derived_from' and o.retracted_at is null)`;

export class SelectionStore extends TeamStore {
  // ---- Scorecards ----------------------------------------------------------------------

  async recordScorecard(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateScorecardRequestSchema, raw);
    const body = validateBody('scorecard', req.body) as ScorecardBody;
    personalScorecard(body);
    return this.idempotent(ws, ctx, { op: 'scorecard', req }, async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const subject = await this.checkScorecard(c, ws, body);
      if (body.edit_of) await this.checkEditOf(c, ws, body);
      const card = await this.insertEntity(
        c,
        ctx,
        ws,
        'scorecard',
        req.title,
        body,
      );
      await this.linkTo(
        c,
        ctx,
        ws,
        'assesses',
        card,
        subject,
        'Scorecard ratings.',
      );
      return card;
    });
  }

  /** A reviewer's changed ratings are a new version; the earlier ratings stay in history. */
  async reviseScorecard(
    ctx: CommandContext,
    ws: string,
    cardId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    cardId = uuid(cardId);
    const req = parse(ReviseScorecardRequestSchema, raw);
    const body = validateBody('scorecard', req.body) as ScorecardBody;
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const current = await this.lockCurrent(
        c,
        ws,
        cardId,
        req.expected_version,
      );
      if (current.kind !== 'scorecard' || current.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          'Only an active scorecard can be revised.',
        );
      const before = current.body as ScorecardBody;
      if (before.assessment)
        throw fail(
          'INVALID_TRANSITION',
          'An automatic assessment is kept as it was written. Edit it instead: your edit is recorded as your own scorecard and the original stays.',
        );
      personalScorecard(body);
      const was = before.edit_of?.scorecard.id.toLowerCase() ?? null;
      const now = body.edit_of?.scorecard.id.toLowerCase() ?? null;
      if (was !== now) {
        // Review M-3: a person's card may move on to replace a newer automatic assessment of
        // the same option and rubric, once the one it replaced is no longer current. It never
        // drops its edit_of, and never stops replacing an assessment that still counts.
        if (!now)
          throw fail(
            'INVALID_CONTRACT',
            'A revision keeps the system scorecard it replaces; record a new scorecard instead.',
          );
        if (was) {
          const old = await c.query(
            `select status from entities where workspace_id = $1 and id = $2`,
            [ws, was],
          );
          if (old.rows[0]?.status === 'active')
            throw fail(
              'INVALID_CONTRACT',
              'This scorecard still replaces a current automatic assessment; edit that one instead.',
            );
        }
        await this.checkEditOf(c, ws, body);
      } else if (
        now &&
        body.edit_of!.scorecard.version !== before.edit_of!.scorecard.version
      )
        throw fail(
          'INVALID_CONTRACT',
          'A revision keeps the system scorecard version it replaces.',
        );
      if (
        before.rubric !== body.rubric ||
        before.subject.id !== body.subject.id
      )
        throw fail(
          'INVALID_CONTRACT',
          'A revision keeps the rubric and subject; record a new scorecard instead.',
        );
      const subject = await this.checkScorecard(c, ws, body);
      const hash = contentHashOf('scorecard', req.title, body);
      if (hash === current.content_hash)
        throw fail(
          'DUPLICATE',
          'Revision is identical to the current version.',
        );
      const next = await this.writeVersion(c, ctx, current, {
        status: 'active',
        title: req.title,
        body,
        hash,
        reason: req.reason,
        corrects: null,
        action: 'entity.revised',
        payload: {},
      });
      await this.linkTo(
        c,
        ctx,
        ws,
        'assesses',
        next,
        subject,
        'Scorecard ratings.',
      );
      return next;
    });
  }

  /**
   * ADR-0074: an edit replaces an active system scorecard of the same option and rubric. The
   * system card stays as written; a newer automatic assessment archives it and is edited instead.
   */
  private async checkEditOf(c: PoolClient, ws: string, body: ScorecardBody) {
    const of = body.edit_of!.scorecard;
    const { rows } = await c.query(
      `select * from entities where workspace_id = $1 and id = $2 and kind = 'scorecard' for share`,
      [ws, of.id.toLowerCase()],
    );
    if (!rows[0])
      throw fail('NOT_FOUND', 'The edited scorecard was not found.');
    const card = toEntity(rows[0] as Row);
    const b = card.body as ScorecardBody;
    if (!b.assessment)
      throw fail(
        'INVALID_CONTRACT',
        'Only an automatic assessment is edited this way; revise your own scorecard instead.',
      );
    if (card.status !== 'active' || card.version !== of.version)
      throw fail(
        'VERSION_CONFLICT',
        'A newer automatic assessment replaced this one; edit the current one.',
      );
    if (
      b.rubric !== body.rubric ||
      b.subject.id.toLowerCase() !== body.subject.id.toLowerCase()
    )
      throw fail(
        'INVALID_CONTRACT',
        'An edit keeps the rubric and option of the assessment it replaces.',
      );
  }

  /** The subject must be the alternative's current version; evidence must exist here. */
  private async checkScorecard(c: PoolClient, ws: string, body: ScorecardBody) {
    const { rows } = await c.query(
      'select * from entities where workspace_id = $1 and id = $2 for share',
      [ws, body.subject.id.toLowerCase()],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Scored alternative not found.');
    const subject = toEntity(rows[0] as Row);
    if (subject.kind !== 'alternative' || subject.status !== 'active')
      throw fail('INVALID_CONTRACT', 'Scorecards rate an active alternative.');
    if (subject.version !== body.subject.version)
      throw fail(
        'VERSION_CONFLICT',
        `The alternative is at version ${subject.version}; rate the current version.`,
      );
    const refs = Object.values(body.ratings).flatMap((r) => r.evidence_refs);
    if (refs.length) {
      // Review L-1: a new rating cites the current, active version, so it is not stale on arrival.
      const found = await c.query<{
        id: string;
        version: number;
        status: string;
      }>(
        `select id, version, status from entities
          where workspace_id = $1 and kind in ('claim', 'source') and id = any($2::uuid[])`,
        [ws, refs.map((r) => r.id.toLowerCase())],
      );
      for (const r of refs) {
        const f = found.rows.find((x) => x.id === r.id.toLowerCase());
        if (!f || f.status === 'redacted')
          throw fail(
            'MISSING_EVIDENCE',
            `Evidence ${r.id} v${r.version} is not a claim or source in this workspace.`,
          );
        if (f.status !== 'active' || Number(f.version) !== r.version)
          throw fail(
            'VERSION_CONFLICT',
            f.status !== 'active'
              ? `Evidence ${r.id.slice(0, 8)} is ${f.status}; cite active evidence.`
              : `Evidence ${r.id.slice(0, 8)} is now version ${f.version}; cite the current version.`,
          );
      }
    }
    return subject;
  }

  protected async linkTo(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    relation: 'assesses' | 'derived_from' | 'implements',
    from: StoredEntity,
    to: { id: string; kind: string; version: number },
    rationale: string,
  ) {
    const linkId = randomUUID();
    const inserted = await c.query(
      `insert into entity_links (id, workspace_id, relation, from_id, from_kind, from_version,
         to_id, to_kind, to_version, rationale, asserted_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) on conflict do nothing`,
      [
        linkId,
        ws,
        relation,
        from.id,
        from.kind,
        from.version,
        to.id,
        to.kind,
        to.version,
        rationale,
        ctx.actorId,
      ],
    );
    if (!inserted.rowCount) return;
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'link.created',
      subjectKind: 'link',
      subjectId: linkId,
      subjectVersion: null,
      contentHash: null,
      payload: {
        relation,
        from_kind: from.kind,
        from_version: from.version,
        to_kind: to.kind,
        to_version: to.version,
      },
      relatedIds: [from.id, to.id],
    });
  }

  // ---- Ranking -------------------------------------------------------------------------

  /** Everything the report needs for one problem, read in the caller's transaction. */
  protected async gather(c: PoolClient, ws: string, problemId: string) {
    const p = await c.query(
      `select * from entities where workspace_id = $1 and id = $2 and kind = 'problem'`,
      [ws, problemId],
    );
    if (!p.rows[0]) throw fail('NOT_FOUND', 'Problem not found.');
    const problem = toEntity(p.rows[0] as Row);
    if (problem.status !== 'active')
      throw fail('INVALID_TRANSITION', `The problem is ${problem.status}.`);
    const alts = (
      await c.query(
        `select distinct e.* from entity_links l join entities e on e.id = l.from_id
          where l.workspace_id = $1 and l.relation = 'derived_from' and l.to_id = $2
            and l.from_kind = 'alternative' and l.retracted_at is null and e.status = 'active'
          order by e.id`,
        [ws, problemId],
      )
    ).rows.map((r: Row) => toEntity(r));
    const ids = alts.map((a) => a.id);
    const cards = (
      await c.query(
        `select * from entities where workspace_id = $1 and kind = 'scorecard'
           and status = 'active' and body->'subject'->>'id' = any($2::text[])`,
        [ws, ids],
      )
    ).rows.map((r: Row) => toEntity(r));
    const reviews = (
      await c.query(
        `select distinct on (body->'subject'->>'id') * from entities
          where workspace_id = $1 and kind = 'humility_review' and status = 'active'
            and body->'subject'->>'id' = any($2::text[])
          order by body->'subject'->>'id', updated_at desc, id`,
        [ws, ids],
      )
    ).rows.map((r: Row) => toEntity(r));
    // The T07 disposition of each proposal, from the discovery run that wrote this problem.
    const discovery = new Map<string, string>();
    const runs = await c.query<{ result: Row }>(
      `select result from workflows where workspace_id = $1 and role = 'r02_discovery'
         and result->'discovery'->'catalog_records'->'problem'->>'id' = $2`,
      [ws, problemId],
    );
    for (const r of runs.rows) {
      const d = r.result.discovery as {
        proposals: { proposal: string; disposition: string }[];
        catalog_records: { alternatives: { proposal: string; id: string }[] };
      };
      for (const a of d.catalog_records.alternatives) {
        const p = d.proposals.find((x) => x.proposal === a.proposal);
        if (p) discovery.set(a.id, p.disposition);
      }
    }
    // ADR-0090: the owner's gate confirmations and the team profile version cards read.
    const confirmations = await this.gateConfirmations(c, ws, ids);
    const team = await this.teamForPacket(c, ws);
    const team_hash = team.hash;
    const rule = await this.latestGateRule(c, ws);
    const auto_clear =
      rule.mode !== 'owner' && rule.at
        ? { version: rule.version, mode: rule.mode, at: rule.at }
        : null;
    // ADR-0097: the owner's checklist now, and what the app can vouch for in the team profile.
    const list = await this.checklistForPacket(c, ws);
    const checklist_hash = list.hash;
    const checklist = list.checklist
      ? { version: list.version, hash: list.hash, items: list.checklist.items }
      : null;
    const candidates: CandidateInput[] = alts.map((a) => {
      const kind = String(a.body?.kind);
      let humility: HumilityState = 'not_applicable';
      let reasons: string[] = [];
      if (SOFTWARE.includes(kind)) {
        const review = reviews.find(
          (r) => (r.body?.subject as Row | undefined)?.id === a.id,
        );
        if (!review) humility = 'missing';
        else {
          const v = humilityGate(
            {
              id: review.id,
              version: review.version,
              status: review.status,
              body: review.body,
            },
            { id: a.id, version: a.version },
            kind === 'hybrid' ? 'hybrid' : 'software',
          );
          humility = v.build_admissible
            ? 'passing'
            : v.needs_judgment
              ? 'needs_judgment'
              : 'failing';
          reasons = v.reasons;
        }
      }
      return {
        alternative: { id: a.id, version: a.version, kind, title: a.title },
        scorecards: cards
          .filter((s) => (s.body?.subject as Row | undefined)?.id === a.id)
          .map((s) => ({
            id: s.id,
            version: s.version,
            status: s.status,
            body: s.body,
          })),
        discovery: discovery.get(a.id) ?? null,
        humility,
        humility_reasons: reasons,
        confirmations: confirmations.filter((x) => x.alternative_id === a.id),
        auto_clear,
        checklist,
        verified: team.verified,
      };
    });
    // ADR-0074: the current version of everything a card cites or an assessment read.
    const cited = new Set<string>();
    const claimIds = new Set<string>();
    for (const s of cards) {
      const b = s.body as Partial<ScorecardBody> | null;
      for (const r of Object.values(b?.ratings ?? {}))
        for (const e of r.evidence_refs ?? []) cited.add(e.id.toLowerCase());
      for (const e of b?.assessment?.evidence ?? []) {
        cited.add(e.id.toLowerCase());
        claimIds.add(e.id.toLowerCase());
      }
    }
    const evidence: Record<
      string,
      { version: number; status: string; support_hash: string | null }
    > = {};
    if (cited.size) {
      const found = await c.query<{
        id: string;
        version: number;
        status: string;
      }>(
        'select id, version, status from entities where workspace_id = $1 and id = any($2::uuid[])',
        [ws, [...cited]],
      );
      const support = await this.supportHashes(c, ws, [...claimIds]);
      for (const r of found.rows)
        evidence[r.id] = {
          version: Number(r.version),
          status: String(r.status),
          support_hash: support.get(r.id) ?? null,
        };
    }
    return {
      problem,
      candidates,
      evidence: evidence as EvidenceVersions,
      ...(await this.linkedHashes(c, ws, problemId)),
      team_hash,
      checklist_hash,
    };
  }

  /**
   * Review M-1: the claims linked to a problem as an assessment reads them (active claims with
   * an unretracted supports/contradicts link), hashed as a set. A claim linked or unlinked
   * since an assessment marks it stale. ADR-0091: a claim supporting one of the problem's
   * options counts as claim:option, so linking evidence to an option marks it stale too.
   */
  protected async linkedClaimsHash(
    c: PoolClient,
    ws: string,
    problemId: string,
  ) {
    return (await this.linkedHashes(c, ws, problemId)).linked_hash;
  }

  /**
   * linked_hash, and problem_linked_hash: the same set without option claims, which is what
   * assessments made before ADR-0091 hashed. Review 2 L-2: an assessment whose hash equals it
   * differs only by option claims it did not read, and its stale reason says so.
   */
  protected async linkedHashes(c: PoolClient, ws: string, problemId: string) {
    const { rows } = await c.query<{ id: string; option: boolean }>(
      `select distinct case when x.option_id is null then x.from_id::text
                            else x.from_id::text || ':' || x.option_id::text end as id,
              x.option_id is not null as option
         from (${ASSESSMENT_CLAIMS_SQL}) x`,
      [ws, problemId],
    );
    return {
      linked_hash: supportHash(rows.map((r) => r.id)),
      problem_linked_hash: supportHash(
        rows.filter((r) => !r.option).map((r) => r.id),
      ),
    };
  }

  /** Each claim's active support rows, hashed (ADR-0074): new or retracted support changes it. */
  protected async supportHashes(c: PoolClient, ws: string, claims: string[]) {
    const out = new Map<string, string>();
    if (!claims.length) return out;
    const { rows } = await c.query<{ claim_id: string; ids: string[] }>(
      `select claim_id, array_agg(id::text) as ids from claim_support
        where workspace_id = $1 and claim_id = any($2::uuid[]) and retracted_at is null
        group by claim_id`,
      [ws, claims],
    );
    for (const id of claims) out.set(id, supportHash([]));
    for (const r of rows) out.set(String(r.claim_id), supportHash(r.ids));
    return out;
  }

  async selectionReport(
    ctx: CommandContext,
    ws: string,
    problemId: string,
    shortlistSize = 3,
  ): Promise<SelectionReport> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    problemId = uuid(problemId);
    if (
      !Number.isInteger(shortlistSize) ||
      shortlistSize < 1 ||
      shortlistSize > 10
    )
      throw fail('INVALID_CONTRACT', 'Shortlist size must be 1–10.');
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const {
        problem,
        candidates,
        evidence,
        linked_hash,
        problem_linked_hash,
        team_hash,
        checklist_hash,
      } = await this.gather(c, ws, problemId);
      return selectionReport({
        problem: {
          id: problem.id,
          version: problem.version,
          title: problem.title,
        },
        candidates,
        shortlist_size: shortlistSize,
        evidence,
        linked_hash,
        problem_linked_hash,
        team_hash,
        checklist_hash,
      });
    });
  }

  /**
   * ADR-0090: the owner confirms one gate of one option at its current version. The concerns the
   * page showed must be exactly the ones raised now (a later one is never confirmed unseen); a
   * person's own concern cannot be confirmed away (revise that card instead).
   */
  async confirmGate(
    ctx: CommandContext,
    ws: string,
    problemId: string,
    raw: unknown,
  ): Promise<GateConfirmation> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    problemId = uuid(problemId);
    const req = parse(ConfirmGateRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireTeamOwner(c, ws, ctx.actorId);
      const report = await this.gateReport(c, ws, problemId, [
        req.alternative.id,
      ]);
      const concerns = confirmableGate(report, req);
      return this.insertGateConfirmation(c, ctx, ws, req, concerns);
    });
  }

  /**
   * UX pass P-4: the owner confirms ethics and access for several options in one step. Every
   * item is checked as `confirmGate` checks one, against one report read under the same
   * transaction, and all are written or none is (one refusal names its option and rolls back).
   * Each confirmation keeps the reason that applied to its option and gate; its event records
   * the step's batch id and whether that reason was the shared one or the option's own.
   */
  async confirmGates(
    ctx: CommandContext,
    ws: string,
    problemId: string,
    raw: unknown,
  ): Promise<ConfirmGatesResult> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    problemId = uuid(problemId);
    const req = parse(ConfirmGatesRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireTeamOwner(c, ws, ctx.actorId);
      const report = await this.gateReport(
        c,
        ws,
        problemId,
        req.items.map((x) => x.alternative.id),
      );
      const batchId = randomUUID();
      const checked = req.items.map((item) => {
        const { reason, from } = gateItemReason(req, item);
        const one = {
          alternative: item.alternative,
          gate: item.gate,
          reason,
          concerns_seen: item.concerns_seen,
        };
        try {
          return { one, from, concerns: confirmableGate(report, one) };
        } catch (e) {
          if (!(e instanceof ContractError)) throw e;
          const row = report.suitability.candidates.find(
            (x) => x.alternative.id === item.alternative.id.toLowerCase(),
          );
          throw fail(
            e.code,
            `${row ? `“${row.alternative.title}”` : 'An option'}, ${item.gate}: ${e.message} Nothing was confirmed.`,
          );
        }
      });
      const confirmations: ConfirmGatesResult['confirmations'] = [];
      for (const x of checked)
        confirmations.push({
          confirmation: await this.insertGateConfirmation(
            c,
            ctx,
            ws,
            x.one,
            x.concerns,
            { id: batchId, reason_from: x.from },
          ),
          reason_from: x.from,
        });
      return { batch_id: batchId, confirmations };
    });
  }

  /**
   * The current report for gate confirmations, after locking each option's confirmations in id
   * order (so a one-step confirmation and a single one never deadlock).
   */
  private async gateReport(
    c: PoolClient,
    ws: string,
    problemId: string,
    alternatives: readonly string[],
  ) {
    for (const altId of [
      ...new Set(alternatives.map((x) => x.toLowerCase())),
    ].sort())
      await c.query(
        "select pg_advisory_xact_lock(hashtext('gate-confirm:' || $1::text))",
        [altId],
      );
    const {
      problem,
      candidates,
      evidence,
      linked_hash,
      problem_linked_hash,
      team_hash,
      checklist_hash,
    } = await this.gather(c, ws, problemId);
    return selectionReport({
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
      team_hash,
      checklist_hash,
    });
  }

  // ---- Automatic assessments (ADR-0074) -----------------------------------------------------

  /**
   * P08: starts an automatic assessment of every option of one problem at its current version.
   * The packet is built here from the problem, its options and the claims linked to it, as the
   * owner reads them now; it is bound by hash into the workflow and never changes. One assessor
   * task runs on the T05 workflow path (caps, leases, cancellation, plan admission). When it
   * succeeds, application code writes one system scorecard per option and rubric.
   */
  async startAssessment(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<WorkflowDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(StartAssessmentRequestSchema, raw);
    await this.studyWorkflowGate(ctx, ws, runId, null);
    const problemId = req.problem.id.toLowerCase();
    const built = await this.buildAssessment(
      ctx,
      ws,
      problemId,
      req.resource_setup.kind === 'subscription' ? req.resource_setup : null,
    );
    if (built.packet.problem.version !== req.problem.version)
      throw fail(
        'VERSION_CONFLICT',
        `The problem is at version ${built.packet.problem.version}; reload before assessing.`,
      );
    if (
      req.preview_hash &&
      assessmentPreviewHash(built.packet) !== req.preview_hash
    )
      throw fail(
        'VERSION_CONFLICT',
        'What the assessment would send changed since the preview (an option, claim or its evidence changed). Check it again, then start.',
      );
    // Each request rates a few options so its answer fits the route's output cap and its input
    // fits the route's input cap (ADR-0085); every request reads the same claims.
    const batches = built.batches;
    if (
      req.limits.max_children < batches.length ||
      req.limits.max_calls < batches.length * req.limits.max_attempts
    )
      throw fail(
        'INVALID_CONTRACT',
        `This assessment takes ${batches.length} requests (a few options each); allow at least ${batches.length} tasks and ${batches.length * req.limits.max_attempts} calls.`,
      );
    const context: AssessmentWorkflowContext = {
      packet: built.packet,
      packet_hash: canonicalHash(built.packet),
      linked_hash: built.linked_hash,
      evidence: built.evidence,
      batches,
    };
    const id = await this.idempotent(
      ws,
      ctx,
      { op: 'assessment.start', runId, req },
      async (c) => {
        // What the packet read must still be current when the workflow is bound to it.
        const now = await c.query<{
          id: string;
          version: number;
          status: string;
        }>(
          `select id, version, status from entities where workspace_id = $1 and id = any($2::uuid[])
             for share`,
          [
            ws,
            [
              problemId,
              ...built.packet.options.map((o) => o.alternative_id),
              ...built.packet.claims.map((x) => x.claim_id),
            ],
          ],
        );
        const at = (id: string) => now.rows.find((r) => r.id === id);
        const moved = [
          { id: problemId, version: built.packet.problem.version },
          ...built.packet.options.map((o) => ({
            id: o.alternative_id,
            version: o.version,
          })),
          ...built.packet.claims.map((x) => ({
            id: x.claim_id,
            version: x.version,
          })),
        ].some(
          (r) =>
            at(r.id)?.version !== r.version || at(r.id)?.status !== 'active',
        );
        const support = await this.supportHashes(
          c,
          ws,
          built.evidence.map((e) => e.id),
        );
        if (
          moved ||
          built.evidence.some((e) => support.get(e.id) !== e.support_hash) ||
          (await this.linkedClaimsHash(c, ws, problemId)) !== built.linked_hash
        )
          throw fail(
            'VERSION_CONFLICT',
            'The problem, an option or a claim changed while the packet was built; start again.',
          );
        if (
          (await this.teamForPacket(c, ws)).hash !== teamHash(built.packet.team)
        )
          throw fail(
            'VERSION_CONFLICT',
            'The team profile changed while the packet was built; start again.',
          );
        if (
          (await this.checklistForPacket(c, ws)).hash !==
          checklistHash(built.packet.checklist)
        )
          throw fail(
            'VERSION_CONFLICT',
            'Your gate checklist changed while the packet was built; start again.',
          );
        const workflowId = await this.insertWorkflow(c, ctx, ws, runId, {
          role: 'r08_assessment',
          roleVersion: ASSESSMENT_ROLE_VERSION,
          promptHash: ASSESSMENT_PROMPT_HASH,
          subject: req.problem,
          context: { ...context },
          limits: req.limits,
          envelopeId:
            req.resource_setup.kind === 'api'
              ? req.resource_setup.envelope_id
              : null,
          pricingSnapshotId:
            req.resource_setup.kind === 'api'
              ? req.resource_setup.pricing_snapshot_id
              : null,
          resourceSetup: req.resource_setup,
          dataClass: req.data_class,
          audit: {
            packet_hash: context.packet_hash,
            options: built.packet.options.length,
            claims: built.packet.claims.length,
          },
        });
        // The coordinator queues one task per batch, within the run's concurrency.
        await this.coordinateIn(c, ctx, ws, workflowId);
        return workflowId;
      },
    );
    return this.getWorkflow(ctx, ws, id);
  }

  /** What an assessment of this problem would send now, without starting anything. */
  async previewAssessment(
    ctx: CommandContext,
    ws: string,
    problemId: string,
    connectionId?: string | null,
  ): Promise<AssessmentPreview> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const built = await this.buildAssessment(
      ctx,
      ws,
      uuid(problemId),
      connectionId ? { connection_id: uuid(connectionId) } : null,
    );
    const { packet } = built;
    return {
      packet,
      packet_hash: canonicalHash(packet),
      preview_hash: assessmentPreviewHash(packet),
      chars: Math.max(...built.request_chars),
      limit: built.input_cap,
      requests: built.batches.length,
      request_chars: built.request_chars,
      claims_left_out: built.claims_left_out,
      claims_over_max: built.claims_over_max,
      cap_for_all: built.cap_for_all,
      option_coverage: built.option_coverage,
      problem_claims_read: built.problem_claims_read,
    };
  }

  /** The packet an assessment read, for inspection. */
  async assessmentPacket(ctx: CommandContext, ws: string, workflowId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    workflowId = uuid(workflowId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select 1 from workflows where workspace_id = $1 and id = $2',
        [ws, workflowId],
      );
      if (!rows.length) throw fail('NOT_FOUND', 'Workflow not found.');
      const d = await this.assessmentContextOf(c, workflowId);
      return { packet: d.packet, packet_hash: d.packet_hash };
    });
  }

  /**
   * ADR-0085: the packet and its requests, sized to the route's per-request input cap: the plan
   * connection's accepted `max_input_chars`, or the default for API, local and fixture routes.
   */
  private async buildAssessment(
    ctx: CommandContext,
    ws: string,
    problemId: string,
    route: {
      connection_id: string;
      settings_hash?: string;
      /** The run's answer cap, at most the connection's (review L-1). */
      max_output_chars?: number;
    } | null,
  ): Promise<{
    packet: AssessmentPacket;
    batches: string[][];
    request_chars: number[];
    input_cap: number;
    claims_left_out: number;
    claims_over_max: number;
    cap_for_all: number | null;
    option_coverage: OptionCoverage[];
    problem_claims_read: number;
    evidence: AssessmentWorkflowContext['evidence'];
    linked_hash: string;
  }> {
    const read = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      let cap: number | undefined;
      let outputCap: number | undefined;
      if (route) {
        const conn = await c.query<{
          settings: {
            caps?: {
              responses?: {
                max_input_chars?: number;
                max_output_chars?: number;
              };
            };
          };
          settings_hash: string;
        }>(
          'select settings, settings_hash from plan_connections where workspace_id = $1 and id = $2',
          [ws, route.connection_id.toLowerCase()],
        );
        if (!conn.rows[0]) throw fail('NOT_FOUND', 'Connection not found.');
        if (
          route.settings_hash &&
          conn.rows[0].settings_hash !== route.settings_hash
        )
          throw fail(
            'VERSION_CONFLICT',
            'Connection settings changed; refresh run setup.',
          );
        cap = conn.rows[0].settings.caps?.responses?.max_input_chars;
        // Review L-1: the worker sends the run's cap, and the plan service applies the
        // smaller of it and the connection's, so the requests are sized to that.
        const connCap = conn.rows[0].settings.caps?.responses?.max_output_chars;
        const runCap = route.max_output_chars;
        outputCap =
          connCap !== undefined && runCap !== undefined
            ? Math.min(connCap, runCap)
            : (connCap ?? runCap);
      }
      const p = await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'problem'`,
        [ws, problemId],
      );
      if (!p.rows[0]) throw fail('NOT_FOUND', 'Problem not found.');
      const problem = toEntity(p.rows[0] as Row);
      if (problem.status !== 'active')
        throw fail('INVALID_TRANSITION', `The problem is ${problem.status}.`);
      const alts = (
        await c.query(
          `select distinct e.* from entity_links l join entities e on e.id = l.from_id
            where l.workspace_id = $1 and l.relation = 'derived_from' and l.to_id = $2
              and l.from_kind = 'alternative' and l.retracted_at is null and e.status = 'active'
            order by e.created_at, e.id`,
          [ws, problemId],
        )
      ).rows.map((r: Row) => toEntity(r));
      if (!alts.length)
        throw fail(
          'INVALID_TRANSITION',
          'This problem has no options to assess.',
        );
      // ADR-0091: one row per claim: its first relation to the problem (if linked there) and
      // the options it supports.
      const rows = (
        await c.query<{
          from_id: string;
          relation: string;
          option_id: string | null;
        }>(
          `select x.from_id::text as from_id, x.relation, x.option_id::text as option_id
             from (${ASSESSMENT_CLAIMS_SQL}) x order by x.created_at, x.from_id`,
          [ws, problemId],
        )
      ).rows;
      const byId = new Map<
        string,
        { from_id: string; relation: string | null; options: string[] }
      >();
      for (const r of rows) {
        const cl = byId.get(r.from_id) ?? {
          from_id: r.from_id,
          relation: null,
          options: [],
        };
        if (r.option_id === null) cl.relation ??= r.relation;
        else if (!cl.options.includes(r.option_id))
          cl.options.push(r.option_id);
        byId.set(r.from_id, cl);
      }
      // Claim-id order, as before ADR-0091, so problems without option claims read the same.
      const claims = [...byId.values()].sort((a, b) =>
        a.from_id < b.from_id ? -1 : a.from_id > b.from_id ? 1 : 0,
      );
      const brief = (
        await c.query(
          `select e.body from entity_links l join entities e on e.id = l.to_id
            where l.workspace_id = $1 and l.from_id = $2 and l.relation = 'derived_from'
              and l.to_kind = 'search_brief' and l.retracted_at is null
            order by l.created_at desc limit 1`,
          [ws, problemId],
        )
      ).rows[0]?.body as Row | undefined;
      // ADR-0090: what the owner says the team can do goes with every assessment.
      const team = await this.teamForPacket(c, ws);
      // ADR-0097: and the owner's gate checklist, which the assessor answers item by item.
      const checklist = await this.checklistForPacket(c, ws);
      return { problem, alts, claims, brief, cap, outputCap, team, checklist };
    });
    const claims: AssessmentInputClaim[] = [];
    for (const cl of read.claims)
      claims.push({
        relation: cl.relation === 'contradicts' ? 'contradicts' : 'supports',
        evidence: await this.claimEvidence(ctx, ws, cl.from_id, 180),
        ...(cl.options.length ? { options: cl.options } : {}),
        ...(cl.relation === null ? { problem: false } : {}),
      });
    const str = (v: unknown) => (typeof v === 'string' ? v : '');
    const b = read.problem.body as Row | null;
    const plan = buildAssessmentPacket({
      problem: {
        id: read.problem.id,
        version: read.problem.version,
        title: read.problem.title,
        statement: str(b?.statement) || read.problem.title,
        affected_group: str(b?.affected_group) || null,
        outcome_measure: str(read.brief?.outcome_measure) || null,
      },
      alternatives: read.alts.map((a) => {
        const ab = a.body as Row | null;
        return {
          id: a.id,
          version: a.version,
          kind: str(ab?.kind),
          title: a.title,
          rationale: str(ab?.rationale),
          tradeoffs: Array.isArray(ab?.tradeoffs)
            ? (ab.tradeoffs as unknown[]).map(String)
            : [],
          uncertainty: str(ab?.uncertainty),
        };
      }),
      claims,
      now: new Date(),
      ...(read.cap ? { input_cap: read.cap } : {}),
      ...(read.outputCap ? { output_cap: read.outputCap } : {}),
      route: route ? 'plan' : 'other',
      team: read.team.team,
      checklist: read.checklist.checklist,
    });
    // BODY_TOO_LARGE (HTTP 413) marks the size refusal: the request the studio would send is
    // too large. Decide offers raising the cap only for it.
    if (!plan.ok) throw fail('BODY_TOO_LARGE', plan.problem);
    const { packet } = plan;
    const support = await this.tx((c) =>
      this.supportHashes(
        c,
        ws,
        packet.claims.map((x) => x.claim_id),
      ),
    );
    return {
      packet,
      batches: plan.batches,
      request_chars: plan.request_chars,
      input_cap: plan.input_cap,
      claims_left_out: plan.claims_left_out,
      claims_over_max: plan.claims_over_max,
      cap_for_all: plan.cap_for_all,
      option_coverage: plan.option_coverage,
      problem_claims_read: plan.problem_claims_read,
      // Same keys as linkedClaimsHash: a problem claim by id, an option claim as claim:option.
      linked_hash: supportHash(
        read.claims.flatMap((x) => [
          ...(x.relation !== null ? [x.from_id] : []),
          ...x.options.map((o) => `${x.from_id}:${o}`),
        ]),
      ),
      evidence: packet.claims.map((x) => ({
        id: x.claim_id,
        version: x.version,
        support_hash: support.get(x.claim_id)!,
      })),
    };
  }

  // ---- Selection -----------------------------------------------------------------------

  async select(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<SelectOutcome> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(SelectRequestSchema, raw);
    const problemId = req.problem.id.toLowerCase();
    return this.idempotent(ws, ctx, { op: 'select', runId, req }, async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      // One selection at a time per problem; the report is recomputed under the lock.
      await c.query(
        'select 1 from entities where workspace_id = $1 and id = $2 for update',
        [ws, problemId],
      );
      const {
        problem,
        candidates,
        evidence,
        linked_hash,
        problem_linked_hash,
        team_hash,
        checklist_hash,
      } = await this.gather(c, ws, problemId);
      if (problem.version !== req.problem.version)
        throw fail(
          'VERSION_CONFLICT',
          `The problem is at version ${problem.version}.`,
        );
      const report = selectionReport({
        problem: {
          id: problem.id,
          version: problem.version,
          title: problem.title,
        },
        candidates,
        shortlist_size: req.shortlist_size,
        evidence,
        linked_hash,
        problem_linked_hash,
        team_hash,
        checklist_hash,
      });
      if (report.report_hash !== req.report_hash)
        throw fail(
          'VERSION_CONFLICT',
          'Scores, gates or candidates changed since this report was read; reload it before deciding.',
        );
      const check = checkSelection(report, req);
      if (check.invalid.length)
        throw fail('INVALID_CONTRACT', check.invalid.join(' ').slice(0, 2000));
      if (check.blocked.length)
        throw fail(
          'INVALID_TRANSITION',
          check.blocked.join(' ').slice(0, 2000),
        );
      if (check.override_reason_missing)
        throw fail(
          'INVALID_CONTRACT',
          'An advanced candidate is outranked by one that is not advanced; give an override reason.',
        );
      const decision = {
        report_hash: report.report_hash,
        dispositions: req.dispositions,
        override_reason: req.override_reason,
      };
      // ADR-0100 (Jordan, November 14): the owner may let an autopilot choose an option whose
      // ethics only the model cleared. The setting is read here, in this transaction, so neither
      // the model nor the runner can grant it; the choice is then flagged on the record instead.
      const modelOnlyEthics =
        (ctx.autopilot || (await this.actorKind(c, ctx.actorId)) !== 'human') &&
        modelClearedEthics(report, req.dispositions);
      const ownerAllows =
        modelOnlyEthics &&
        !!ctx.autopilot &&
        (
          await c.query(
            `select 1 from autopilot_settings
              where workspace_id = $1 and (settings->>'choose_model_ethics')::boolean`,
            [ws],
          )
        ).rowCount === 1;
      const rationale = ownerAllows
        ? `${MODEL_ONLY_ETHICS_NOTE} ${req.rationale}`.slice(0, 1200)
        : req.rationale;
      const admission = await this.admitIn(c, ctx, ws, runId, {
        action_type: 'candidate.select',
        task_id: null,
        target: { id: problem.id, version: problem.version },
        // Approval covers exactly this report and these dispositions.
        spec_hash: canonicalHash(decision),
        amount_nano_usd: null,
        data_class: req.data_class,
        assumption_ids: [],
        humility_review: null,
        // ADR-0090 (Jordan, November 12): when an option advances while its ethics gate was
        // cleared on the model's word alone, a run's selection (a routine policy included)
        // stops and asks a person. A person selecting by hand is that person; an autopilot
        // step is not a person, though the owner started it (ADR-0092).
        flags:
          modelOnlyEthics && !ownerAllows
            ? [
                {
                  reason: 'ethical_judgment' as const,
                  note: 'An option this selection advances had its ethics gate cleared on the model’s word only (the owner’s gate rule: the model’s word, or its answers to the gate checklist); no person looked at it, so a person decides.',
                  evidence_refs: [],
                },
              ]
            : [],
        justification: rationale,
      });
      if (admission.verdict !== 'allow')
        return {
          status: notAllowed(admission),
          admission: outcomeOf(admission),
          selection: null,
        };
      const id = randomUUID();
      const { rows } = await c.query(
        `insert into selections (id, workspace_id, run_id, problem_id, problem_version,
           report_hash, report, dispositions, overrides, override_reason, rationale,
           admission_id, actor_id, autopilot_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning *`,
        [
          id,
          ws,
          runId,
          problem.id,
          problem.version,
          report.report_hash,
          JSON.stringify(report),
          JSON.stringify(req.dispositions),
          JSON.stringify(check.overrides),
          check.overrides.length ? req.override_reason : null,
          rationale,
          admission.id,
          recordedActor(ctx),
          ctx.autopilot?.id.toLowerCase() ?? null,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'selection.recorded',
        subjectKind: 'selection',
        subjectId: id,
        subjectVersion: null,
        contentHash: report.report_hash,
        payload: {
          problem_version: problem.version,
          dispositions: Object.fromEntries(
            req.dispositions.map((d) => [
              d.alternative.id.toLowerCase(),
              d.disposition,
            ]),
          ),
          overrides: check.overrides.length,
          ...(ownerAllows ? { model_only_ethics: true } : {}),
        },
        relatedIds: [
          runId,
          problem.id,
          ...req.dispositions.map((d) => d.alternative.id.toLowerCase()),
        ],
      });
      return {
        status: 'recorded',
        admission: outcomeOf(admission),
        selection: toSelection(rows[0] as Row, true),
      };
    });
  }

  async listSelections(
    ctx: CommandContext,
    ws: string,
    problemId: string,
  ): Promise<Selection[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    problemId = uuid(problemId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from selections where workspace_id = $1 and problem_id = $2
          order by created_at desc, id desc limit 50`,
        [ws, problemId],
      );
      return rows.map((r: Row, i) => toSelection(r, i === 0));
    });
  }

  /** The selection, whether it is still the latest for its problem, and its build choice. */
  private async selectionFor(
    c: PoolClient,
    ws: string,
    selectionId: string,
    alternativeId: string,
  ) {
    const { rows } = await c.query(
      `select s.*, (select l.id from selections l where l.workspace_id = s.workspace_id
           and l.problem_id = s.problem_id order by l.created_at desc, l.id desc limit 1) as latest
         from selections s where s.workspace_id = $1 and s.id = $2`,
      [ws, selectionId],
    );
    const r = rows[0] as Row | undefined;
    if (!r) throw fail('NOT_FOUND', 'Selection not found.');
    const selection = toSelection(r, r.latest === r.id);
    const choice = selection.dispositions.find(
      (d) => d.alternative.id.toLowerCase() === alternativeId,
    );
    const blockers: string[] = [];
    if (!selection.current)
      blockers.push('A later selection for this problem replaced this one.');
    if (choice?.disposition !== 'select_for_build')
      blockers.push('This selection did not select the alternative for build.');
    return { selection, choice, blockers };
  }

  // ---- Specifications ------------------------------------------------------------------

  async createSpec(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateSpecRequestSchema, raw);
    const altId = req.alternative.id.toLowerCase();
    const id = await this.idempotent(
      ws,
      ctx,
      { op: 'spec.create', req },
      async (c) => {
        await this.role(c, ws, ctx.actorId, true);
        const { selection, choice, blockers } = await this.selectionFor(
          c,
          ws,
          req.selection_id.toLowerCase(),
          altId,
        );
        if (blockers.length)
          throw fail('INVALID_TRANSITION', blockers.join(' '));
        const alt = await this.currentAlternative(c, ws, altId);
        if (
          alt.version !== req.alternative.version ||
          choice!.alternative.version !== alt.version
        )
          throw fail(
            'VERSION_CONFLICT',
            'The alternative changed since it was selected; select it again before writing a spec.',
          );
        // ADR-0107: the studio records which model drafts went into this spec.
        const drafted = await draftedMark(
          c,
          ws,
          alt.id.toLowerCase(),
          req.content,
          req.draft_ids,
          undefined,
        );
        const body = validateBody('specification', {
          format: 'spec/1',
          alternative: { id: alt.id, version: alt.version },
          selection_id: selection.id,
          ...req.content,
          ...(drafted ? { drafted } : {}),
        });
        const spec = await this.insertEntity(
          c,
          ctx,
          ws,
          'specification',
          req.title,
          body,
        );
        await this.linkTo(
          c,
          ctx,
          ws,
          'derived_from',
          spec,
          alt,
          'Specified from the selected alternative.',
        );
        return spec.id;
      },
    );
    return this.specStatus(ctx, ws, id);
  }

  async reviseSpec(
    ctx: CommandContext,
    ws: string,
    specId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    specId = uuid(specId);
    const req = parse(ReviseSpecRequestSchema, raw);
    await this.tx((c) => this.reviseSpecIn(c, ctx, ws, specId, req));
    return this.specStatus(ctx, ws, specId);
  }

  /** Writes the next spec version in the caller's transaction and returns that version. */
  protected async reviseSpecIn(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    specId: string,
    req: ReturnType<typeof ReviseSpecRequestSchema.parse>,
    payload: Record<string, unknown> = {},
  ): Promise<number> {
    {
      await this.role(c, ws, ctx.actorId, true);
      const current = await this.lockCurrent(
        c,
        ws,
        specId,
        req.expected_version,
      );
      const before = this.specBody(current);
      if (current.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          `A ${current.status} spec cannot be revised.`,
        );
      // ADR-0107: drafts named now join those of earlier versions.
      const drafted = await draftedMark(
        c,
        ws,
        before.alternative.id.toLowerCase(),
        req.content,
        req.draft_ids,
        before.drafted,
      );
      const body = validateBody('specification', {
        format: 'spec/1',
        alternative: before.alternative,
        selection_id: before.selection_id,
        ...req.content,
        ...(drafted ? { drafted } : {}),
      });
      const hash = contentHashOf('specification', req.title, body);
      if (hash === current.content_hash)
        throw fail(
          'DUPLICATE',
          'Revision is identical to the current version.',
        );
      const frozen = await this.latestFreeze(c, ws, specId);
      const impact = taskImpact(req.content, frozen?.task_hashes ?? null);
      await this.writeVersion(c, ctx, current, {
        status: 'active',
        title: req.title,
        body,
        hash,
        reason: req.reason,
        corrects: null,
        action: 'spec.revised',
        payload: {
          frozen_version: frozen?.spec.version ?? null,
          changed_tasks: impact.tasks
            .filter((t) => t.status === 'changed')
            .map((t) => t.key),
          added_tasks: impact.tasks
            .filter((t) => t.status === 'added')
            .map((t) => t.key),
          removed_tasks: impact.removed,
          ...payload,
        },
      });
      return current.version + 1;
    }
  }

  protected specBody(e: StoredEntity): SpecBody {
    if (e.kind !== 'specification' || e.body?.format !== 'spec/1')
      throw fail('NOT_FOUND', 'Specification not found.');
    return parse(SpecBodySchema, e.body);
  }

  private async currentAlternative(c: PoolClient, ws: string, altId: string) {
    const { rows } = await c.query(
      `select * from entities where workspace_id = $1 and id = $2 and kind = 'alternative'`,
      [ws, altId],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Alternative not found.');
    const alt = toEntity(rows[0] as Row);
    if (alt.status !== 'active')
      throw fail('INVALID_TRANSITION', `The alternative is ${alt.status}.`);
    return alt;
  }

  protected async latestFreeze(c: PoolClient, ws: string, specId: string) {
    const { rows } = await c.query(
      `select * from spec_freezes where workspace_id = $1 and spec_id = $2
        order by spec_version desc limit 1`,
      [ws, specId],
    );
    return rows[0] ? toFreeze(rows[0] as Row) : null;
  }

  /**
   * Why this spec version cannot be frozen now: invalid task graph, a replaced or changed
   * selection, or a gate on the selected alternative (re-checked now, so a later ethics flag or
   * a lapsed humility review stops a freeze whatever the alternative scored).
   */
  private async freezeBlockers(
    c: PoolClient,
    ws: string,
    spec: StoredEntity,
    body: SpecBody,
  ) {
    const blockers = validateSpec(body).map((p) => p.detail);
    if (spec.status !== 'active') blockers.push(`The spec is ${spec.status}.`);
    const altId = body.alternative.id.toLowerCase();
    const { selection, blockers: sel } = await this.selectionFor(
      c,
      ws,
      body.selection_id,
      altId,
    );
    blockers.push(...sel);
    const alt = await this.currentAlternative(c, ws, altId).catch(() => null);
    if (!alt || alt.version !== body.alternative.version)
      blockers.push('The selected alternative changed after it was selected.');
    else {
      const {
        problem,
        candidates,
        evidence,
        linked_hash,
        problem_linked_hash,
        team_hash,
        checklist_hash,
      } = await this.gather(c, ws, selection.problem.id);
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
        team_hash,
        checklist_hash,
      });
      const row = report.suitability.candidates.find(
        (x) => x.alternative.id === altId,
      );
      if (!row)
        blockers.push(
          'The alternative is no longer a candidate for the problem.',
        );
      else blockers.push(...(row.gates.blocked.select_for_build ?? []));
    }
    return { blockers, selection };
  }

  async freezeSpec(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<FreezeOutcome> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(FreezeSpecRequestSchema, raw);
    const specId = req.spec.id.toLowerCase();
    return this.idempotent(
      ws,
      ctx,
      { op: 'spec.freeze', runId, req },
      async (c) => {
        await this.role(c, ws, ctx.actorId, true);
        const spec = await this.lockCurrent(c, ws, specId, req.spec.version);
        const body = this.specBody(spec);
        const done = await c.query(
          'select 1 from spec_freezes where spec_id = $1 and spec_version = $2',
          [specId, spec.version],
        );
        if (done.rowCount)
          throw fail('DUPLICATE', `Version ${spec.version} is already frozen.`);
        const { blockers, selection } = await this.freezeBlockers(
          c,
          ws,
          spec,
          body,
        );
        if (blockers.length)
          throw fail('INVALID_TRANSITION', blockers.join(' ').slice(0, 2000));
        if (selection.run_id !== runId)
          throw fail(
            'SCOPE_EXCEEDED',
            'Freeze the spec under the run that selected its alternative.',
          );
        const admission = await this.admitIn(c, ctx, ws, runId, {
          action_type: 'spec.freeze',
          task_id: null,
          target: { id: spec.id, version: spec.version },
          spec_hash: spec.content_hash,
          amount_nano_usd: null,
          data_class: req.data_class,
          assumption_ids: [],
          humility_review: null,
          flags: [],
          justification: req.justification,
        });
        if (admission.verdict !== 'allow')
          return {
            status: notAllowed(admission),
            admission: outcomeOf(admission),
            freeze: null,
          };
        const id = randomUUID();
        const { rows } = await c.query(
          `insert into spec_freezes (id, workspace_id, run_id, spec_id, spec_version,
           content_hash, selection_id, task_hashes, admission_id, actor_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) returning *`,
          [
            id,
            ws,
            runId,
            spec.id,
            spec.version,
            spec.content_hash,
            selection.id,
            JSON.stringify(taskHashes(body)),
            admission.id,
            ctx.actorId,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'spec.frozen',
          subjectKind: 'specification',
          subjectId: spec.id,
          subjectVersion: spec.version,
          contentHash: spec.content_hash,
          payload: { freeze_id: id, tasks: body.tasks.length },
          relatedIds: [runId, selection.id, body.alternative.id.toLowerCase()],
        });
        return {
          status: 'frozen',
          admission: outcomeOf(admission),
          freeze: toFreeze(rows[0] as Row),
        };
      },
    );
  }

  async specStatus(
    ctx: CommandContext,
    ws: string,
    specId: string,
  ): Promise<SpecStatus> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    specId = uuid(specId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from entities where workspace_id = $1 and id = $2',
        [ws, specId],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Specification not found.');
      const spec = toEntity(rows[0] as Row);
      if (spec.status === 'redacted')
        throw fail('NOT_FOUND', 'Specification was redacted.');
      const body = this.specBody(spec);
      const freeze = await this.latestFreeze(c, ws, specId);
      const impact = taskImpact(contentOf(body), freeze?.task_hashes ?? null);
      const frozenCurrent = freeze?.spec.version === spec.version;
      const { blockers } = frozenCurrent
        ? { blockers: [] }
        : await this.freezeBlockers(c, ws, spec, body);
      return {
        spec: {
          id: spec.id,
          version: spec.version,
          status: spec.status,
          title: spec.title,
          content_hash: spec.content_hash,
        },
        problems: validateSpec(body),
        frozen_current: frozenCurrent,
        latest_freeze: freeze,
        tasks: impact.tasks,
        removed_tasks: impact.removed,
        blockers,
      };
    });
  }
}

/**
 * Whether the owner may confirm this gate of this option as the report has it now; returns the
 * concerns the confirmation answers. Shared by the single and the one-step confirmation.
 */
function confirmableGate(
  report: ReturnType<typeof selectionReport>,
  req: {
    alternative: { id: string; version: number };
    gate: 'ethics' | 'access';
    concerns_seen: readonly string[];
  },
): string[] {
  const altId = req.alternative.id.toLowerCase();
  const row = report.suitability.candidates.find(
    (x) => x.alternative.id === altId,
  );
  if (!row)
    throw fail('NOT_FOUND', 'That option is not one of this problem’s.');
  if (row.alternative.version !== req.alternative.version)
    throw fail(
      'VERSION_CONFLICT',
      `The option is now version ${row.alternative.version}; reload before confirming.`,
    );
  const detail = row.gates.gate_details?.find((d) => d.gate === req.gate);
  if (!detail) throw fail('INVALID_CONTRACT', 'Unknown gate.');
  const now = detail.concerns.map((x) => x.scorecard).sort();
  const seen = [...req.concerns_seen].map((x) => x.toLowerCase()).sort();
  if (JSON.stringify(now) !== JSON.stringify(seen))
    throw fail(
      'VERSION_CONFLICT',
      'The concerns on this gate changed since the page loaded them; reload and read them before confirming.',
    );
  if (detail.concerns.some((x) => x.by === 'person'))
    throw fail(
      'INVALID_TRANSITION',
      'A person raised this concern on their own scorecard; revise that scorecard to resolve it.',
    );
  if (!detail.assessed)
    throw fail(
      'INVALID_TRANSITION',
      `Nothing has assessed ${req.gate} on this option yet; assess the option or score it yourself before confirming.`,
    );
  if (detail.state === 'confirmed' || detail.state === 'clear')
    throw fail(
      'INVALID_TRANSITION',
      `The ${req.gate} gate is already ${detail.state === 'clear' ? 'clear from a person’s scorecard' : 'confirmed'} on this version.`,
    );
  return detail.concerns.map((x) => x.scorecard);
}
