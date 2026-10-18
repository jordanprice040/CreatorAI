import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  CreateScorecardRequestSchema,
  CreateSpecRequestSchema,
  FreezeSpecRequestSchema,
  ReviseScorecardRequestSchema,
  ReviseSpecRequestSchema,
  SelectRequestSchema,
  SpecBodySchema,
  parse,
  type Admission,
  type FreezeOutcome,
  type ScorecardBody,
  type SelectOutcome,
  type Selection,
  type SelectionReport,
  type SpecBody,
  type SpecFreeze,
  type SpecStatus,
  type StoredEntity,
} from '@creator/contracts';
import {
  canonicalHash,
  checkSelection,
  humilityGate,
  selectionReport,
  taskHashes,
  taskImpact,
  validateSpec,
  type CandidateInput,
  type HumilityState,
} from '@creator/domain';
import { DiscoveryStore } from './discovery-store.js';
import {
  contentHashOf,
  fail,
  normalize,
  toEntity,
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
function toSelection(r: Row, current: boolean): Selection {
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
    created_at: iso(r.created_at),
    current,
  };
}
function toFreeze(r: Row): SpecFreeze {
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
const contentOf = (b: SpecBody) => {
  const { format: _f, alternative: _a, selection_id: _s, ...content } = b;
  return content;
};

/**
 * T08 scoring, selection and specifications (migration 7). Scores are computed on read from
 * the current scorecards; a selection stores the report it was made from, so the original
 * ranking survives any override. Selecting and freezing are admitted actions under the run's
 * policy (T03), after deterministic gates that no score can clear.
 */
export class SelectionStore extends DiscoveryStore {
  // ---- Scorecards ----------------------------------------------------------------------

  async recordScorecard(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateScorecardRequestSchema, raw);
    const body = validateBody('scorecard', req.body) as ScorecardBody;
    return this.idempotent(ws, ctx, { op: 'scorecard', req }, async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const subject = await this.checkScorecard(c, ws, body);
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
      const found = await c.query<{ id: string; version: number }>(
        `select v.entity_id as id, v.version from entity_versions v
           join entities e on e.id = v.entity_id
          where e.workspace_id = $1 and e.kind in ('claim', 'source') and e.status <> 'redacted'
            and (v.entity_id, v.version) in (select * from unnest($2::uuid[], $3::int[]))`,
        [ws, refs.map((r) => r.id.toLowerCase()), refs.map((r) => r.version)],
      );
      for (const r of refs)
        if (
          !found.rows.some(
            (f) => f.id === r.id.toLowerCase() && f.version === r.version,
          )
        )
          throw fail(
            'MISSING_EVIDENCE',
            `Evidence ${r.id} v${r.version} is not a claim or source version in this workspace.`,
          );
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
  private async gather(c: PoolClient, ws: string, problemId: string) {
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
      };
    });
    return { problem, candidates };
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
      const { problem, candidates } = await this.gather(c, ws, problemId);
      return selectionReport({
        problem: {
          id: problem.id,
          version: problem.version,
          title: problem.title,
        },
        candidates,
        shortlist_size: shortlistSize,
      });
    });
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
      const { problem, candidates } = await this.gather(c, ws, problemId);
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
        flags: [],
        justification: req.rationale,
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
           admission_id, actor_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
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
          req.rationale,
          admission.id,
          ctx.actorId,
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
        const body = validateBody('specification', {
          format: 'spec/1',
          alternative: { id: alt.id, version: alt.version },
          selection_id: selection.id,
          ...req.content,
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
      const body = validateBody('specification', {
        format: 'spec/1',
        alternative: before.alternative,
        selection_id: before.selection_id,
        ...req.content,
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
      const { problem, candidates } = await this.gather(
        c,
        ws,
        selection.problem.id,
      );
      const report = selectionReport({
        problem: {
          id: problem.id,
          version: problem.version,
          title: problem.title,
        },
        candidates,
        shortlist_size: 3,
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
