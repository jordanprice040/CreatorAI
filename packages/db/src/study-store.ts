import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import {
  AssignStudySchema,
  StudyArtifactSchema,
  StudyTestSchema,
  StudyInterventionRequestSchema,
  FinishStudyAttemptSchema,
  STUDY_EFFORT_CLOCK_SLACK_MS,
  STUDY_EFFORT_TIMER_VERSION,
  type StudyEffort,
  type StudyEffortStep,
  OVERSIGHT_POLICY_VERSION,
  parse,
  z,
  text,
  id,
  hash,
  ContractError,
  SpecBodySchema,
  type SpecBody,
  type StudyImplementation,
  type StudyInput,
  type StudyAssignment,
  type StudyAttempt,
  type StudySummary,
} from '@creator/contracts';
import {
  canonicalHash,
  studyManifest,
  studyContext,
  studyOrder,
  freezeProtocol,
  PROPOSED_PROTOCOL,
  type OwnerDecision,
  type FrozenProtocol,
  type EvaluationConfig,
  SYNTHETIC_STUDY,
  STUDY_FIXTURE_PRICING,
  evaluationConfig,
  finalRecordBlockers,
  frozenCases,
  implementationTaskContext,
  taskHashes,
} from '@creator/domain';
import { ProjectReportStore } from './project-report-store.js';
import {
  ceilingRefusal,
  currentSpendLimits,
  lockRuntimeCeiling,
  runtimeExposure,
  recordSpendingRefusal,
} from './runtime-ceiling.js';
import {
  AUDIT_CHAIN_LOCK,
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

/** config/evaluation.json from the repository root (or an explicit path). */
export function readEvaluationConfig(
  path: string | URL = new URL(
    '../../../config/evaluation.json',
    import.meta.url,
  ),
): EvaluationConfig {
  return evaluationConfig(JSON.parse(readFileSync(path, 'utf8')));
}

export class StudyStore extends ProjectReportStore {
  /** The reviewed evaluation configuration; record and budget gates read it, never callers. */
  evaluation: EvaluationConfig = readEvaluationConfig();
  protected async study(c: PoolClient, ws: string, studyId: string) {
    const r = await c.query(
      'select * from studies where workspace_id=$1 and id=$2',
      [uuid(ws), uuid(studyId)],
    );
    if (!r.rows[0]) throw fail('NOT_FOUND', 'Study not found.');
    return r.rows[0] as Row;
  }
  private summary(r: Row): StudySummary {
    const m = r.manifest as StudyInput & { status: StudySummary['status'] };
    return {
      id: String(r.id),
      title: m.title,
      synthetic: m.synthetic,
      status: m.status,
      manifest_hash: String(r.manifest_hash),
      created_at: iso(r.created_at),
    };
  }
  async createStudy(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const frozen = studyManifest(raw);
    const input = frozen.manifest as StudyInput;
    return this.idempotent(
      ws,
      ctx,
      { op: 'study.create', frozen },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        const mode = await c.query(
          'select fixture from workspaces where id=$1',
          [ws],
        );
        const fixture = Boolean(mode.rows[0]?.fixture);
        if (input.synthetic && !fixture)
          throw fail(
            'INVALID_CONTRACT',
            'Synthetic studies require a fixture workspace. Recruitment is not enabled.',
          );
        if (!input.synthetic) {
          // A final record exists only when every owner answer it depends on is in the freeze.
          const blockers = finalRecordBlockers(
            input,
            { workspace_fixture: fixture, freeze: await this.freezeIn(c, ws) },
            this.evaluation,
          );
          if (blockers.length)
            throw new ContractError(
              'INVALID_TRANSITION',
              'Final study record refused; these conditions are unmet.',
              blockers,
            );
        }
        if (
          input.governance &&
          input.governance.budget.ledger_cap_nano_usd !==
            this.evaluation.budget.t15_total_cap_nano_usd
        )
          throw fail(
            'INVALID_CONFIG',
            `A governed study uses the owner's $${this.evaluation.budget.t15_total_cap_usd} T15 ledger cap.`,
          );
        if (input.packet.implementation)
          await this.frozenImplementation(c, ws, input.packet.implementation);
        const studyId = randomUUID();
        const r = await c.query(
          'insert into studies(id,workspace_id,manifest,manifest_hash,created_by) values($1,$2,$3,$4,$5) returning *',
          [studyId, ws, frozen.manifest, frozen.manifest_hash, ctx.actorId],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'study.created',
          subjectKind: 'study',
          subjectId: studyId,
          subjectVersion: 1,
          contentHash: frozen.manifest_hash,
          payload: { synthetic: input.synthetic },
        });
        return this.summary(r.rows[0] as Row);
      },
    );
  }
  async listStudies(ctx: CommandContext, ws: string) {
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), normalize(ctx).actorId);
      return (
        await c.query(
          'select * from studies where workspace_id=$1 order by created_at,id',
          [ws],
        )
      ).rows.map((r) => this.summary(r as Row));
    });
  }
  /**
   * Re-reads an implementation task from the owner's stored records: exact spec version and
   * hash, its freeze and task hash, and a current humility review of that exact version.
   */
  protected async frozenImplementation(
    c: PoolClient,
    ws: string,
    impl: StudyImplementation,
  ) {
    const version = async (entityId: string, v: number, kind: string) => {
      const r = await c.query(
        `select v.title, v.body, v.content_hash, e.version as current, e.status from entity_versions v
           join entities e on e.id = v.entity_id
          where v.workspace_id=$1 and v.entity_id=$2 and v.version=$3 and e.kind=$4`,
        [ws, uuid(entityId), v, kind],
      );
      return r.rows[0] as Row | undefined;
    };
    const spec = await version(
      impl.spec_id,
      impl.spec_version,
      'specification',
    );
    if (!spec || spec.content_hash !== impl.spec_hash)
      throw fail(
        'EVIDENCE_MISMATCH',
        'The study must bind an exact stored specification version and hash.',
      );
    const body: SpecBody = parse(SpecBodySchema, spec.body);
    const f = await c.query(
      'select * from spec_freezes where workspace_id=$1 and id=$2',
      [ws, uuid(impl.freeze_id)],
    );
    const freeze = f.rows[0] as Row | undefined;
    if (
      !freeze ||
      String(freeze.spec_id) !== impl.spec_id.toLowerCase() ||
      Number(freeze.spec_version) !== impl.spec_version ||
      freeze.content_hash !== impl.spec_hash ||
      (freeze.task_hashes as Record<string, string>)[impl.task_key] !==
        impl.task_hash ||
      taskHashes(body)[impl.task_key] !== impl.task_hash
    )
      throw fail(
        'EVIDENCE_MISMATCH',
        'The study task must equal a task hash in that exact spec freeze.',
      );
    const task = body.tasks.find((t) => t.key === impl.task_key)!;
    const cases = frozenCases(body, task.acceptance);
    if (
      task.role !== 'builder' ||
      task.depends_on.length ||
      !task.file_scope.length ||
      !cases.some((x) => x.held_out) ||
      !cases.some((x) => !x.held_out)
    )
      throw fail(
        'INVALID_CONFIG',
        'A study build task must be an independent builder task with visible and held-out frozen cases.',
      );
    const review = await version(
      impl.humility_review.id,
      impl.humility_review.version,
      'humility_review',
    );
    const subject = (
      review?.body as { subject?: { id: string; version: number } }
    )?.subject;
    if (
      !review ||
      Number(review.current) !== impl.humility_review.version ||
      review.status !== 'active' ||
      subject?.id.toLowerCase() !== impl.spec_id.toLowerCase() ||
      subject.version !== impl.spec_version
    )
      throw fail(
        'EVIDENCE_MISMATCH',
        'The study needs the current humility review of that exact spec version.',
      );
    return {
      title: String(spec.title),
      body,
      review: {
        title: String(review.title),
        body: review.body as Record<string, unknown>,
        content_hash: String(review.content_hash),
      },
    };
  }
  /**
   * Holds an attempt's whole frozen cap against its study ledger before any model work. Open
   * attempts count at their cap; finished ones at settled cost plus any in-flight or unknown
   * reservation. Synthetic ledgers are per workspace; final records share one T15 ledger.
   * Returns the refusal (to be recorded and thrown after commit) or null.
   */
  protected async holdBudget(
    c: PoolClient,
    ctx: CommandContext,
    ownerWs: string,
    a: StudyAttempt,
    input: StudyInput,
  ) {
    if (!input.governance) return null;
    const ledger = await this.lockBudget(c, ownerWs, input);
    const total = BigInt(this.evaluation.budget.t15_total_cap_nano_usd);
    const cap = BigInt(input.config.max_cost_nano_usd);
    const held = await c.query(
      'select 1 from study_budget_holds where attempt_id=$1',
      [a.id],
    );
    if (held.rowCount) return null;
    const holds = await c.query(
      `select h.attempt_id, h.cap_nano, t.workspace_id, t.run_id,
              exists(select 1 from study_events e where e.attempt_id=h.attempt_id and e.kind='finished') as finished
         from study_budget_holds h join study_attempts t on t.id=h.attempt_id
        where h.ledger=$1`,
      [ledger],
    );
    let exposure = 0n;
    for (const h of holds.rows) {
      if (!h.finished) {
        exposure += BigInt(String(h.cap_nano));
        continue;
      }
      const r = await c.query(
        `select coalesce(sum(case when status='settled' then incurred_nano
                                  when status in ('in_flight','unknown') then reserved_nano
                                  else 0 end),0)::text as n
           from budget_reservations where workspace_id=$1 and run_id=$2`,
        [h.workspace_id, h.run_id],
      );
      exposure += BigInt(String(r.rows[0]!.n));
    }
    const detail = {
      ledger,
      ledger_cap_nano_usd: total.toString(),
      attempt_cap_nano_usd: cap.toString(),
      exposure_before_nano_usd: exposure.toString(),
    };
    // ADR-0113: the shared T15 ledger, the ceiling and the limits count every workspace's
    // spending, so a final attempt's event and error (readable by its workspace's owners) say
    // only which one refused it; the amounts go to the record only the spending manager reads.
    const studio = async (
      ledger: 't15-final' | 'runtime-ceiling' | 'runtime-run-limit',
      reasonCode: string,
      explanation: string,
    ) => {
      await recordSpendingRefusal(c, {
        studyAttemptId: a.id,
        ws: a.workspace_id,
        runId: a.run_id,
        reasonCode,
        explanation,
      });
      const over = {
        ledger,
        attempt_cap_nano_usd: cap.toString(),
        amounts: 'studio_spending_manager_only' as const,
      };
      await this.event(c, ctx, a.study_id, a.id, 'budget_refused', over);
      return over;
    };
    if (exposure + cap > total) {
      if (!input.synthetic)
        return studio(
          't15-final',
          'study_t15_ledger',
          `A final study attempt with a frozen cap of ${cap} nano-USD does not fit in the shared T15 study ledger of ${total} nano-USD, with ${exposure} already held or spent by final study attempts.`,
        );
      await this.event(c, ctx, a.study_id, a.id, 'budget_refused', detail);
      return detail;
    }
    // The T15 ledger sits inside the owner's overall runtime ceiling (2026-10-20).
    if (!input.synthetic) {
      const runtime = await runtimeExposure(c, this.spending);
      const refusal = ceilingRefusal(runtime, cap);
      if (refusal)
        return studio(
          'runtime-ceiling',
          refusal.reason_code,
          `A final study attempt with a frozen cap of ${cap} nano-USD does not fit under the overall runtime ceiling of ${runtime.ceiling_nano_usd} nano-USD, with ${runtime.exposure_nano_usd} already held or spent${runtime.unknown_calls > 0 ? ` and ${runtime.unknown_calls} call(s) of unknown cost` : ''}.`,
        );
      // An attempt whose frozen cap is above the owner's per-run limit (ADR-0044) would be cut
      // off part-way by dispatch, so it is refused before it starts instead.
      const { limits } = await currentSpendLimits(c);
      if (
        limits.per_run_nano_usd !== null &&
        cap > BigInt(limits.per_run_nano_usd)
      )
        return studio(
          'runtime-run-limit',
          'runtime_run_limit',
          `A final study attempt with a frozen cap of ${cap} nano-USD is above the per-run limit of ${limits.per_run_nano_usd} nano-USD.`,
        );
    }
    await c.query(
      'insert into study_budget_holds(attempt_id,ledger,cap_nano,ledger_cap_nano) values($1,$2,$3,$4)',
      [a.id, ledger, cap.toString(), total.toString()],
    );
    // A final hold raises runtime exposure, so it may cross a spend threshold (ADR-0116 N-1).
    // lockBudget already holds the runtime ceiling for a final record.
    if (!input.synthetic) await this.spendWarnings(c, false);
    // A held final attempt's event leaves out the shared ledger's exposure too (ADR-0113).
    const { exposure_before_nano_usd: _shared, ...finalHeld } = detail;
    await this.event(
      c,
      ctx,
      a.study_id,
      a.id,
      'budget_held',
      input.synthetic ? detail : finalHeld,
    );
    return null;
  }
  /**
   * Takes holdBudget's locks in its order: the study ledger, then for final records the
   * runtime ceiling. Ceiling and limit saves take the ceiling before the audit-chain lock, so a
   * caller that will hold a budget takes these first (ADR-0047). Returns the ledger name.
   */
  protected async lockBudget(
    c: PoolClient,
    ownerWs: string,
    input: StudyInput,
  ) {
    const ledger = input.synthetic ? `synthetic:${ownerWs}` : 't15-final';
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [
      `study-ledger:${ledger}`,
    ]);
    if (!input.synthetic) await lockRuntimeCeiling(c);
    return ledger;
  }
  protected async freezeIn(
    c: PoolClient,
    ws: string,
  ): Promise<FrozenProtocol | null> {
    const r = await c.query(
      "select payload from audit_events where workspace_id=$1 and action='study.protocol_frozen' order by sequence desc limit 1",
      [ws],
    );
    const p = r.rows[0]?.payload as
      | {
          freeze_hash: string;
          proposal_hash: string;
          decisions: OwnerDecision[];
        }
      | undefined;
    if (!p) return null;
    return {
      origin: 'adopted',
      freeze_hash: p.freeze_hash,
      manifest: {
        schema_version: 'protocol-freeze/1',
        proposal_hash: p.proposal_hash,
        proposal: PROPOSED_PROTOCOL,
        decisions: p.decisions,
      },
    };
  }
  protected async event(
    c: PoolClient,
    ctx: CommandContext,
    studyId: string,
    attemptId: string | null,
    kind: string,
    payload: unknown,
  ) {
    await c.query('select pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
    const eventId = randomUUID();
    const contentHash = canonicalHash(payload);
    await c.query(
      'insert into study_events(id,study_id,attempt_id,actor_id,kind,payload,content_hash) values($1,$2,$3,$4,$5,$6,$7)',
      [eventId, studyId, attemptId, ctx.actorId, kind, payload, contentHash],
    );
    // Audit stores hashes, never participant text or hidden grader content.
    const s = await c.query(
      "select workspace_id, (manifest->>'synthetic')::boolean as synthetic from studies where id=$1",
      [studyId],
    );
    await this.append(c, ctx, {
      workspaceId: String(s.rows[0]!.workspace_id),
      action: `study.${kind}`,
      subjectKind: 'study',
      subjectId: studyId,
      subjectVersion: null,
      contentHash,
      payload: {
        event_id: eventId,
        attempt_id: attemptId,
        synthetic: Boolean(s.rows[0]!.synthetic),
      },
    });
    return { id: eventId, content_hash: contentHash };
  }
  async assignStudy(
    ctx: CommandContext,
    ws: string,
    studyId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    studyId = uuid(studyId);
    const parsed = parse(AssignStudySchema, raw);
    // Ids are compared as text in assignment JSON; store them in canonical lowercase.
    const req = {
      ...parsed,
      participant_actor_id: parsed.participant_actor_id.toLowerCase(),
      continuation_of: parsed.continuation_of?.toLowerCase() ?? null,
    };
    if (req.discovery_method === 'open_ended' && req.comparison !== 'discovery')
      throw fail(
        'INVALID_CONTRACT',
        'The open-ended baseline belongs to the separate discovery comparison.',
      );
    return this.idempotent(
      ws,
      ctx,
      { op: 'study.assign', studyId, req },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        // Serialize assignment order and continuation creation.
        await c.query('select id from studies where id=$1 for no key update', [
          studyId,
        ]);
        const s = await this.study(c, ws, studyId);
        if (s.manifest_hash !== req.manifest_hash)
          throw fail(
            'VERSION_CONFLICT',
            'Assignment must bind the exact immutable manifest.',
          );
        const grader = await c.query(
          'select 1 from study_graders where study_id=$1 and actor_id=$2',
          [studyId, req.participant_actor_id],
        );
        if (grader.rowCount)
          throw fail(
            'ACCESS_DENIED',
            'A grader cannot become a participant in this study.',
          );
        const actor = await c.query('select kind from actors where id=$1', [
          req.participant_actor_id,
        ]);
        if (actor.rows[0]?.kind !== 'human')
          throw fail('ACCESS_DENIED', 'Assign a human participant identity.');
        if (req.continuation_of) {
          const original = await c.query(
            'select * from study_attempts where study_id=$1 and id=$2',
            [studyId, req.continuation_of],
          );
          const a = original.rows[0] as Row | undefined;
          const finish = await c.query(
            "select payload from study_events where attempt_id=$1 and kind='finished'",
            [req.continuation_of],
          );
          if (
            !a ||
            (a.assignment as StudyAssignment).condition !== 'autonomous' ||
            finish.rows[0]?.payload.status !== 'needs_human' ||
            req.condition !== 'human_in_loop' ||
            (a.assignment as StudyAssignment).comparison !== req.comparison ||
            (a.assignment as StudyAssignment).discovery_method !==
              req.discovery_method
          )
            throw fail(
              'INVALID_TRANSITION',
              'An assisted continuation needs a stopped autonomous original.',
            );
        }
        const input = s.manifest as StudyInput;
        const impl = input.packet.implementation;
        const frozenTask = impl
          ? await this.frozenImplementation(c, ws, impl)
          : null;
        const context = studyContext(
          input,
          req,
          impl && frozenTask
            ? implementationTaskContext(frozenTask.body, impl.task_key)
            : undefined,
        );
        const attemptId = randomUUID(),
          attemptWs = randomUUID();
        const count = await c.query(
          'select count(*)::int as n from study_attempts where study_id=$1',
          [studyId],
        );
        const ordinal = Number(count.rows[0]!.n) + 1;
        // Final records get a real-mode workspace, which no fixture adapter will serve.
        await c.query(
          'insert into workspaces(id,name,record_mode,fixture,created_by) values($1,$2,$3,$4,$5)',
          [
            attemptWs,
            `${input.synthetic ? 'Synthetic study' : 'Study'} attempt ${ordinal}`,
            input.synthetic ? 'fixture' : 'real',
            input.synthetic,
            ctx.actorId,
          ],
        );
        await c.query(
          "insert into workspace_members(workspace_id,actor_id,role) values($1,$2,'owner')",
          [attemptWs, ctx.actorId],
        );
        const run = await this.insertEntity(
          c,
          ctx,
          attemptWs,
          'run',
          'Synthetic assigned run',
          {
            state: 'queued',
            experiment_condition: req.condition,
            discovery_method: req.discovery_method,
            config_hash: String(s.manifest_hash),
          },
        );
        const mode =
          req.condition === 'autonomous'
            ? 'autonomous_within_scope'
            : req.condition;
        const initial = [];
        // Final records get no model grant: live dispatch does not exist yet (LIVE_DISABLED).
        if (req.condition !== 'human_only' && input.synthetic) {
          const g = await this.insertGrant(c, ctx, attemptWs, {
            scope: 'standing',
            run_id: null,
            action_types: impl
              ? ['model.generate', 'product.commit_build']
              : ['model.generate'],
            target_kind: null,
            target: null,
            spec_hash: null,
            max_amount_nano_usd: input.config.max_cost_nano_usd,
            allow_irreversible: false,
            allow_external_effects: false,
            data_classes: ['synthetic'],
            expires_at: new Date(
              Date.now() + input.packet.time_cap_seconds * 1000,
            ).toISOString(),
            decision_id: null,
            rationale:
              'Synthetic-only study fixture model execution inside the frozen envelope.',
          });
          if (req.condition === 'autonomous')
            initial.push({ id: g.id, version: g.version });
        }

        await c.query(
          "insert into run_controls(workspace_id,run_id,run_version,autonomy_mode,experiment_condition,policy_version,stage_gates,initial_grants,state,created_by) values($1,$2,1,$3,$4,$5,'{}',$7,'active',$6)",
          [
            attemptWs,
            run.id,
            mode,
            req.condition,
            OVERSIGHT_POLICY_VERSION,
            ctx.actorId,
            JSON.stringify(initial),
          ],
        );
        await c.query(
          'insert into study_attempts(id,study_id,workspace_id,run_id,assignment,context,context_hash,ordinal) values($1,$2,$3,$4,$5,$6,$7,$8)',
          [
            attemptId,
            studyId,
            attemptWs,
            run.id,
            req,
            context,
            canonicalHash(context),
            ordinal,
          ],
        );
        let pinned = null;
        if (impl && frozenTask) {
          // Same kind, title and body, so the copy carries the owner's exact content hash.
          const copy = await this.insertEntity(
            c,
            ctx,
            attemptWs,
            'specification',
            frozenTask.title,
            frozenTask.body as unknown as Record<string, unknown>,
          );
          if (copy.content_hash !== impl.spec_hash)
            throw fail(
              'EVIDENCE_MISMATCH',
              'The pinned specification copy changed its hash.',
            );
          const review = await this.insertEntity(
            c,
            ctx,
            attemptWs,
            'humility_review',
            frozenTask.review.title,
            {
              ...frozenTask.review.body,
              subject: { id: copy.id, version: copy.version },
            },
          );
          const source = {
            workspace_id: ws,
            spec: {
              id: impl.spec_id.toLowerCase(),
              version: impl.spec_version,
              content_hash: impl.spec_hash,
            },
            freeze_id: impl.freeze_id.toLowerCase(),
            task_key: impl.task_key,
            task_hash: impl.task_hash,
            humility_review: {
              id: impl.humility_review.id.toLowerCase(),
              version: impl.humility_review.version,
              content_hash: frozenTask.review.content_hash,
            },
          };
          await c.query(
            'insert into study_attempt_pins(attempt_id,spec_id,spec_version,spec_hash,review_id,review_version,source) values($1,$2,$3,$4,$5,$6,$7)',
            [
              attemptId,
              copy.id,
              copy.version,
              copy.content_hash,
              review.id,
              review.version,
              source,
            ],
          );
          pinned = {
            spec: {
              id: copy.id,
              version: copy.version,
              content_hash: copy.content_hash,
            },
            humility_review: {
              id: review.id,
              version: review.version,
              content_hash: review.content_hash,
            },
            source,
          };
        }
        await this.event(c, ctx, studyId, attemptId, 'assigned', {
          condition: req.condition,
          discovery_method: req.discovery_method,
          primary: req.continuation_of === null,
          order: ordinal,
          context_hash: canonicalHash(context),
          ...(pinned ? { pinned } : {}),
        });
        return this.attemptIn(c, attemptId);
      },
    );
  }
  protected async attemptIn(
    c: PoolClient,
    attemptId: string,
  ): Promise<StudyAttempt> {
    const r = await c.query(
      "select a.*, (s.manifest->>'synthetic')::boolean as synthetic from study_attempts a join studies s on s.id=a.study_id where a.id=$1",
      [uuid(attemptId)],
    );
    const a = r.rows[0] as Row | undefined;
    if (!a) throw fail('NOT_FOUND', 'Attempt not found.');
    const req = a.assignment as StudyAssignment;
    const end = await c.query(
      "select payload,created_at from study_events where attempt_id=$1 and kind='finished'",
      [attemptId],
    );
    return {
      id: String(a.id),
      study_id: String(a.study_id),
      workspace_id: String(a.workspace_id),
      run_id: String(a.run_id),
      synthetic: Boolean(a.synthetic),
      ...req,
      order: Number(a.ordinal),
      primary: req.continuation_of === null,
      context_hash: String(a.context_hash),
      state: end.rows[0]?.payload.status ?? 'assigned',
      created_at: iso(a.created_at),
      finished_at: end.rows[0] ? iso(end.rows[0].created_at) : null,
    };
  }
  protected async accessAttempt(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    attemptId: string,
    ownerOnly = false,
  ) {
    const a = await this.attemptIn(c, attemptId);
    await this.study(c, ws, a.study_id);
    if (ownerOnly || a.participant_actor_id.toLowerCase() !== ctx.actorId)
      await this.requireOwner(c, ws, ctx.actorId);
    return a;
  }
  protected async lockAttemptForWrite(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    attemptId: string,
    ownerOnly = false,
    budget = false,
  ) {
    const a = await this.accessAttempt(c, ctx, ws, attemptId, ownerOnly);
    await this.lockRun(c, a.workspace_id, a.run_id);
    await c.query(
      'select id from study_attempts where id=$1 for no key update',
      [attemptId],
    );
    if (budget && a.condition !== 'human_only') {
      const input = (await this.study(c, ws, a.study_id))
        .manifest as StudyInput;
      if (input.governance) await this.lockBudget(c, ws, input);
    }
    await c.query('select pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
    return this.accessAttempt(c, ctx, ws, attemptId, ownerOnly);
  }
  async studyDetail(ctx: CommandContext, ws: string, studyId: string) {
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), normalize(ctx).actorId);
      const s = await this.study(c, ws, studyId);
      const ids = await c.query(
        'select id from study_attempts where study_id=$1 order by ordinal',
        [studyId],
      );
      return {
        ...this.summary(s),
        manifest: s.manifest,
        recommended_order: studyOrder(
          (s.manifest as StudyInput).assignment_seed,
        ),
        attempts: await Promise.all(
          ids.rows.map((r) => this.attemptIn(c, String(r.id))),
        ),
      };
    });
  }
  async participantContext(ctx: CommandContext, ws: string, attemptId: string) {
    return this.tx(async (c) => {
      const a = await this.accessAttempt(
        c,
        normalize(ctx),
        uuid(ws),
        attemptId,
      );
      const r = await c.query(
        'select context from study_attempts where id=$1',
        [attemptId],
      );
      return {
        synthetic: a.synthetic,
        attempt: a,
        context: r.rows[0]!.context,
      };
    });
  }
  async attemptEntries(ctx: CommandContext, ws: string, attemptId: string) {
    return this.tx(async (c) => {
      await this.accessAttempt(c, normalize(ctx), uuid(ws), attemptId);
      return (
        await c.query(
          'select id,kind,payload,content_hash,created_at from study_events where attempt_id=$1 order by sequence',
          [attemptId],
        )
      ).rows;
    });
  }
  async writeAttempt(
    ctx: CommandContext,
    ws: string,
    attemptId: string,
    action: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    attemptId = uuid(attemptId);
    const schema =
      action === 'artifacts'
        ? StudyArtifactSchema
        : action === 'tests'
          ? StudyTestSchema
          : action === 'interventions'
            ? StudyInterventionRequestSchema
            : action === 'finish'
              ? FinishStudyAttemptSchema
              : action === 'deviations'
                ? z.strictObject({ reason: text, impact: text })
                : z.strictObject({
                    helper: z.enum([
                      'model.generate',
                      'model.summarize',
                      'model.rewrite',
                      'model.complete',
                      'tool.metered',
                      'workflow',
                      'discovery',
                    ]),
                  });
    const { effort, ...req } = parse(
      schema as z.ZodType<Record<string, unknown>>,
      raw,
    ) as Record<string, unknown> & { effort?: StudyEffort };
    // Return denials after commit so the denial event is durable.
    return this.tx(async (c) => {
      const a = await this.lockAttemptForWrite(c, ctx, ws, attemptId);
      // Review M-2 (#221): only the assigned person's own time is measured, never the owner's.
      if (effort) notParticipant(a, ctx);
      if (action === 'helpers')
        return {
          allowed: false,
          reason:
            a.condition === 'human_only' ? 'human_only' : 'study_context_only',
          ...(await this.event(c, ctx, a.study_id, attemptId, 'helper_denied', {
            helper: req.helper,
            condition: a.condition,
          })),
        };
      if (a.state !== 'assigned')
        throw fail(
          'INVALID_TRANSITION',
          'This attempt is terminal; preserve it and create a separate continuation when eligible.',
        );
      const s = await this.study(c, ws, a.study_id);
      const cap = (s.manifest as StudyInput).packet.time_cap_seconds;
      const elapsed = Math.max(0, Date.now() - Date.parse(a.created_at));
      if (
        elapsed > cap * 1000 &&
        action !== 'finish' &&
        action !== 'deviations'
      )
        throw fail(
          'EXPIRED',
          'The assignment time cap has elapsed; record a failed or cancelled outcome.',
        );
      if (action === 'artifacts' && a.condition === 'autonomous')
        throw fail(
          'INVALID_TRANSITION',
          'Autonomous artifacts must come from the frozen execution path, not human task help.',
        );
      if (action === 'interventions' && a.condition !== 'human_in_loop')
        throw fail(
          'INVALID_TRANSITION',
          'Only the assisted condition accepts task-specific help. Stop A as needs_human.',
        );
      if (action === 'finish') {
        if (req.status === 'submitted' && elapsed > cap * 1000)
          throw fail('EXPIRED', 'An expired attempt cannot be submitted.');
        if (req.status === 'submitted') {
          const artifacts = await c.query(
            "select 1 from study_events where attempt_id=$1 and kind='artifacts'",
            [attemptId],
          );
          if (!artifacts.rowCount)
            throw fail(
              'INVALID_TRANSITION',
              'A submission needs an artifact; submitted is not independently verified success.',
            );
        }
        return this.event(c, ctx, a.study_id, attemptId, 'finished', {
          ...req,
          wall_seconds: elapsed / 1000,
          condition: a.condition,
          primary: a.primary,
          measurement_source: 'participant_report_except_wall_clock',
        });
      }
      if (action === 'tests') {
        const r = await c.query(
          "select payload,content_hash from study_events where attempt_id=$1 and id=$2 and kind='artifacts'",
          [attemptId, req.artifact_id],
        );
        if (!r.rows[0] || r.rows[0].content_hash !== req.artifact_hash)
          throw fail(
            'VERSION_CONFLICT',
            'Test must bind an artifact in this attempt at its exact hash.',
          );
        const content = String(r.rows[0].payload.content);
        let passed = false;
        if (req.check === 'contains')
          passed = content.includes(String(req.expected));
        else if (req.check === 'equals') passed = content === req.expected;
        else {
          try {
            JSON.parse(content);
            passed = true;
          } catch {
            passed = false;
          }
        }
        return {
          ...(await this.event(c, ctx, a.study_id, attemptId, 'tests', {
            ...req,
            passed,
            executor: 'conventional-text-check/1',
            executed_at: new Date().toISOString(),
          })),
          passed,
        };
      }
      const saved = await this.event(
        c,
        ctx,
        a.study_id,
        attemptId,
        action,
        req,
      );
      if (effort) await this.#recordEffort(c, ctx, attemptId, saved.id, effort);
      return saved;
    });
  }
  /**
   * ADR-0122 (F13): starts timing one intervention step on the server clock. Only an assigned
   * attempt in the assisted condition records interventions, so only it is timed.
   */
  async startEffortStep(
    ctx: CommandContext,
    ws: string,
    attemptId: string,
  ): Promise<StudyEffortStep> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    attemptId = uuid(attemptId);
    return this.tx(async (c) => {
      const a = await this.lockAttemptForWrite(c, ctx, ws, attemptId);
      notParticipant(a, ctx);
      if (a.condition !== 'human_in_loop')
        throw fail(
          'INVALID_TRANSITION',
          'Only the assisted condition records interventions, so only it times intervention steps.',
        );
      if (a.state !== 'assigned')
        throw fail(
          'INVALID_TRANSITION',
          'This attempt is terminal; no further steps are timed.',
        );
      const cap = ((await this.study(c, ws, a.study_id)).manifest as StudyInput)
        .packet.time_cap_seconds;
      if (Date.now() - Date.parse(a.created_at) > cap * 1000)
        throw fail(
          'EXPIRED',
          'The assignment time cap has elapsed; no further steps are timed.',
        );
      const r = await c.query(
        "insert into study_effort_steps(id,study_id,attempt_id,actor_id,step) values($1,$2,$3,$4,'intervention') returning *",
        [randomUUID(), a.study_id, attemptId, ctx.actorId],
      );
      return effortStep(r.rows[0]!, a.synthetic, null);
    });
  }
  /** Every timed step of one attempt, finished or not, oldest first. */
  async effortSteps(
    ctx: CommandContext,
    ws: string,
    attemptId: string,
  ): Promise<StudyEffortStep[]> {
    ctx = normalize(ctx);
    return this.tx(async (c) => {
      const a = await this.accessAttempt(c, ctx, uuid(ws), uuid(attemptId));
      return this.#effortRows(c, a.id, a.synthetic);
    });
  }
  async #effortRows(c: PoolClient, attemptId: string, synthetic: boolean) {
    const r = await c.query(
      `select s.*, m.event_id, m.timer_version, m.active_ms, m.wait_ms, m.idle_ms,
              m.away_ms, m.wall_ms,
              m.recorded_at
         from study_effort_steps s left join study_effort_measures m on m.step_id = s.id
        where s.attempt_id = $1 order by s.started_at, s.id`,
      [attemptId],
    );
    return r.rows.map((row) =>
      effortStep(row, synthetic, row.event_id ? row : null),
    );
  }
  /**
   * Binds the browser totals to the intervention that ends the step. The step must be this
   * attempt's, started by this person and not yet measured, and the totals cannot exceed the
   * step's own time on the server clock (plus request latency).
   */
  async #recordEffort(
    c: PoolClient,
    ctx: CommandContext,
    attemptId: string,
    eventId: string,
    effort: StudyEffort,
  ) {
    const step = await c.query(
      `select s.actor_id, m.step_id as measured,
              floor(extract(epoch from (clock_timestamp() - s.started_at)) * 1000)::bigint as wall_ms
         from study_effort_steps s left join study_effort_measures m on m.step_id = s.id
        where s.id = $1 and s.attempt_id = $2 for update of s`,
      [effort.step_id, attemptId],
    );
    const row = step.rows[0];
    if (!row || String(row.actor_id).toLowerCase() !== ctx.actorId)
      throw fail(
        'NOT_FOUND',
        'The timed step does not belong to this attempt and person; start a new step.',
      );
    if (row.measured)
      throw fail(
        'INVALID_TRANSITION',
        'This step’s time is already recorded; start a new step.',
      );
    const wallMs = Number(row.wall_ms);
    const refusal = effortOverrun(effort, wallMs);
    if (refusal) throw fail('INVALID_CONTRACT', refusal);
    await c.query(
      'insert into study_effort_measures(step_id,attempt_id,event_id,timer_version,active_ms,wait_ms,idle_ms,away_ms,wall_ms) values($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [
        effort.step_id,
        attemptId,
        eventId,
        effort.timer_version,
        effort.active_ms,
        effort.wait_ms,
        effort.idle_ms,
        effort.away_ms,
        wallMs,
      ],
    );
  }
  async graderMaterial(
    ctx: CommandContext,
    ws: string,
    studyId: string,
    raw?: unknown,
  ) {
    return this.tx(async (c) => {
      await this.study(c, uuid(ws), uuid(studyId));
      const granted = await c.query(
        'select 1 from study_graders where study_id=$1 and actor_id=$2',
        [studyId, normalize(ctx).actorId],
      );
      if (!granted.rowCount)
        throw fail(
          'ACCESS_DENIED',
          'Grader access is separate from workspace membership.',
        );
      if (raw !== undefined) {
        const payload = parse(
          z.strictObject({
            kind: z.enum(['reference', 'hidden_test', 'rating']),
            content: text,
          }),
          raw,
        );
        const materialId = randomUUID();
        await c.query(
          'insert into study_grader_material(id,study_id,actor_id,payload,content_hash) values($1,$2,$3,$4,$5)',
          [materialId, studyId, ctx.actorId, payload, canonicalHash(payload)],
        );
      }
      return (
        await c.query(
          'select id,payload,content_hash,created_at from study_grader_material where study_id=$1 order by created_at,id',
          [studyId],
        )
      ).rows;
    });
  }
  async grantGrader(
    ctx: CommandContext,
    ws: string,
    studyId: string,
    raw: unknown,
  ) {
    const req = {
      actor_id: uuid(parse(z.strictObject({ actor_id: id }), raw).actor_id),
    };
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), normalize(ctx).actorId);
      await this.study(c, ws, studyId);
      await c.query('select id from studies where id=$1 for no key update', [
        studyId,
      ]);
      const actor = await c.query('select kind from actors where id=$1', [
        req.actor_id,
      ]);
      if (actor.rows[0]?.kind !== 'human')
        throw fail(
          'ACCESS_DENIED',
          'Grader material is restricted to a separate human reviewer identity.',
        );
      const prior = await c.query(
        "select 1 from study_attempts where study_id=$1 and lower(assignment->>'participant_actor_id')=$2",
        [studyId, req.actor_id],
      );
      if (prior.rowCount)
        throw fail(
          'ACCESS_DENIED',
          'Participants cannot read hidden grading material.',
        );
      await c.query(
        'insert into study_graders(study_id,actor_id) values($1,$2) on conflict do nothing',
        [studyId, req.actor_id],
      );
      return this.event(c, ctx, studyId, null, 'grader_granted', {
        actor_id: req.actor_id,
      });
    });
  }
  async exportStudy(ctx: CommandContext, ws: string, studyId: string) {
    return this.tx(async (c) => {
      await c.query('set transaction isolation level repeatable read');
      await this.requireOwner(c, uuid(ws), normalize(ctx).actorId);
      const s = await this.study(c, ws, studyId);
      const synthetic = (s.manifest as StudyInput).synthetic;
      const rows = await c.query(
        'select * from study_attempts where study_id=$1 order by ordinal',
        [studyId],
      );
      const attempts = [];
      for (const row of rows.rows) {
        const a = await this.attemptIn(c, String(row.id));
        const reservations = await c.query(
          'select * from budget_reservations where workspace_id=$1 and run_id=$2 order by created_at,id',
          [a.workspace_id, a.run_id],
        );
        const workflows = await c.query(
          'select * from workflows where workspace_id=$1 and run_id=$2 order by created_at,id',
          [a.workspace_id, a.run_id],
        );
        const tasks = await c.query(
          'select t.* from workflow_tasks t join workflows w on w.id=t.workflow_id where w.workspace_id=$1 and w.run_id=$2 order by t.created_at,t.id',
          [a.workspace_id, a.run_id],
        );
        const usage = await c.query(
          'select u.* from usage_records u join budget_reservations r on r.id=u.reservation_id where r.workspace_id=$1 and r.run_id=$2 order by u.created_at,u.id',
          [a.workspace_id, a.run_id],
        );
        const decisions = await c.query(
          'select * from decision_requests where workspace_id=$1 and run_id=$2 order by created_at,id',
          [a.workspace_id, a.run_id],
        );
        // a.workspace_id is the attempt's own workspace, created with the attempt, so this is
        // the attempt's audit trail: never the study's home workspace or another attempt's.
        const audit = await c.query(
          'select * from audit_events where workspace_id=$1 order by sequence',
          [a.workspace_id],
        );
        const execution = await c.query(
          'select kind,request_hash from study_execution_requests where attempt_id=$1',
          [a.id],
        );
        const humanEvents = await c.query(
          "select kind,payload from study_events where attempt_id=$1 and kind in ('finished','interventions') order by sequence",
          [a.id],
        );
        const finish = humanEvents.rows.find(
          (e) => e.kind === 'finished',
        )?.payload;
        const interventions = humanEvents.rows.filter(
          (e) => e.kind === 'interventions',
        );
        const effort = await this.#effortRows(c, a.id, a.synthetic);
        const timed = effort.flatMap((e) => (e.measured ? [e.measured] : []));
        const seconds = (k: 'active_ms' | 'wait_ms' | 'idle_ms' | 'away_ms') =>
          timed.reduce((n, m) => n + m[k], 0) / 1000;
        const rs = reservations.rows;
        const sum = (predicate: (r: Row) => boolean, column: string) =>
          rs
            .filter(predicate)
            .reduce((n, r) => n + BigInt(String(r[column] ?? 0)), 0n)
            .toString();
        attempts.push({
          ...a,
          context_manifest: {
            sha256: a.context_hash,
            packet_hash: (s.manifest as { hashes: Record<string, string> })
              .hashes.packet,
            content_redacted: true,
          },
          execution: execution.rows,
          // ADR-0122: measured by the Study page's browser timer, beside (never replacing) the
          // participant's own reported minutes. Synthetic studies time the operator testing the
          // workflow, so their timing is never participant data.
          measured_effort: {
            source: STUDY_EFFORT_TIMER_VERSION,
            subject: synthetic
              ? 'synthetic_operator_not_participant'
              : 'assigned_participant',
            timed_steps: timed.length,
            unfinished_steps: effort.length - timed.length,
            intervention_active_seconds: seconds('active_ms'),
            intervention_wait_seconds: seconds('wait_ms'),
            intervention_idle_seconds: seconds('idle_ms'),
            intervention_away_seconds: seconds('away_ms'),
            steps: effort,
          },
          measurements: {
            active_ai_seconds: 0,
            active_ai_source: synthetic
              ? 'fixture_has_no_ai_inference'
              : 'not_measured_no_live_dispatch',
            simulated_provider_request_seconds: rs
              .filter((r) => r.status !== 'denied' && r.finished_at)
              .reduce(
                (n, r) =>
                  n +
                  Math.max(
                    0,
                    new Date(r.finished_at).getTime() -
                      new Date(r.created_at).getTime(),
                  ) /
                    1000,
                0,
              ),
            human_active_minutes: finish?.human_active_minutes ?? null,
            human_wait_seconds: finish?.human_wait_seconds ?? null,
            intervention_active_minutes: interventions.reduce(
              (n, e) => n + Number(e.payload.human_active_minutes),
              0,
            ),
            intervention_wait_seconds: interventions.reduce(
              (n, e) => n + Number(e.payload.wait_seconds),
              0,
            ),
            wall_seconds: finish?.wall_seconds ?? null,
            known_simulated_spend_nano_usd: sum(
              (r) => r.status === 'settled',
              'incurred_nano',
            ),
            unknown_simulated_exposure_nano_usd: sum(
              (r) => r.status === 'unknown',
              'reserved_nano',
            ),
            in_flight_simulated_exposure_nano_usd: sum(
              (r) => r.status === 'in_flight',
              'reserved_nano',
            ),
            calls: rs.filter((r) => r.status !== 'denied').length,
            retries: rs.filter((r) => r.status !== 'denied' && r.attempt > 1)
              .length,
            denials: rs.filter((r) => r.status === 'denied').length,
            failures: rs.filter(
              (r) => r.status === 'released' || r.status === 'unknown',
            ).length,
          },
          reservations: rs,
          usage: usage.rows,
          audit_events: audit.rows,
          decisions: decisions.rows,
          workflows: workflows.rows.map(({ context, ...w }) => ({
            ...w,
            context_manifest: {
              sha256: canonicalHash(context),
              content_redacted: true,
            },
          })),
          task_manifests: tasks.rows.map(({ context, ...task }) => ({
            ...task,
            context_manifest: {
              sha256: canonicalHash(context),
              content_redacted: true,
            },
          })),
        });
      }
      const events = await c.query(
        'select * from study_events where study_id=$1 order by sequence',
        [studyId],
      );
      const grader = await c.query(
        'select id,content_hash from study_grader_material where study_id=$1 order by created_at,id',
        [studyId],
      );
      const graderAccess = await c.query(
        'select 1 from study_graders where study_id=$1 and actor_id=$2',
        [studyId, ctx.actorId],
      );
      const protectedMaterials = graderAccess.rowCount
        ? (
            await c.query(
              'select * from study_grader_material where study_id=$1 order by created_at,id',
              [studyId],
            )
          ).rows
        : null;
      const body = {
        schema_version: 'study-export/1',
        synthetic,
        empirical_results: false,
        study: this.summary(s),
        manifest: s.manifest,
        attempts,
        raw_events: events.rows,
        grader_manifest: grader.rows,
        grader_content: protectedMaterials,
        grader_access:
          protectedMaterials === null
            ? 'withheld_requires_grader_authority'
            : 'included',
        limitations: [
          synthetic
            ? 'Synthetic only; no participants recruited.'
            : 'Final record; no analysis has been run on it.',
          'Reported human timing is the participant’s own report. Measured step timing (study-effort-timer/1) comes from the Study page in the browser, covers only intervention steps timed there, and is checked only against the studio clock.',
          'Text checks run in the studio; code runs only in the isolated product worker.',
        ],
      };
      const normalized = JSON.parse(JSON.stringify(body)) as typeof body;
      return { ...normalized, export_hash: canonicalHash(normalized) };
    });
  }
  async seedStudy(ctx: CommandContext, ws: string) {
    const seedKey = (op: string) =>
      ctx.idempotencyKey
        ? {
            ...ctx,
            idempotencyKey: canonicalHash({ key: ctx.idempotencyKey, op }),
          }
        : ctx;
    const s = await this.createStudy(seedKey('create'), ws, SYNTHETIC_STUDY);
    const attempts = [];
    for (const condition of studyOrder(SYNTHETIC_STUDY.assignment_seed)) {
      attempts.push(
        await this.assignStudy(seedKey(condition), ws, s.id, {
          manifest_hash: s.manifest_hash,
          participant_actor_id: ctx.actorId,
          participant_code: 'synthetic-owner',
          prior_familiarity:
            'Synthetic plumbing exercise, same operator; not independent participants.',
          condition,
          discovery_method:
            condition === 'human_only' ? 'human_defined' : 'structured',
          continuation_of: null,
        }),
      );
    }
    return { synthetic: true, study: s, attempts };
  }

  /** Re-entrant setup. Every record has a stable idempotency key; provider dispatch is elsewhere. */
  async prepareStudyExecution(
    ctx: CommandContext,
    ws: string,
    attemptId: string,
  ) {
    const data = await this.tx(async (c) => {
      const a = await this.accessAttempt(
        c,
        normalize(ctx),
        uuid(ws),
        attemptId,
        true,
      );
      if (a.condition === 'human_only') {
        await this.event(c, ctx, a.study_id, a.id, 'helper_denied', {
          helper: 'execute',
          condition: a.condition,
        });
        return null;
      }
      if (a.state !== 'assigned')
        throw fail('INVALID_TRANSITION', 'Attempt is terminal.');
      const s = await this.study(c, ws, a.study_id);
      const input = s.manifest as StudyInput;
      if (!input.synthetic)
        throw fail(
          'LIVE_DISABLED',
          'Final AI attempts need live dispatch, which is disabled (config/evaluation.json). Fixture output never substitutes.',
        );
      if (input.packet.stratum === 'implementation')
        throw fail(
          'INVALID_CONFIG',
          'AI implementation attempts run through the isolated builder (study-attempts/<id>/build); this runner never executes code.',
        );
      if (
        Date.now() >
        Date.parse(a.created_at) + input.packet.time_cap_seconds * 1000
      )
        throw fail('EXPIRED', 'The assignment deadline elapsed.');
      if (
        input.config.model_version !== STUDY_FIXTURE_PRICING.model_id ||
        input.config.pricing_version !== canonicalHash(STUDY_FIXTURE_PRICING)
      )
        throw fail(
          'INVALID_CONFIG',
          'Only the pinned synthetic provider/pricing pair is available to this study runner.',
        );
      if (input.config.tool_access.length)
        throw fail(
          'INVALID_CONFIG',
          'This fixture runner has no tools; freeze an empty tool list.',
        );
      const refused = await this.holdBudget(c, ctx, ws, a, input);
      return { a, input, refused };
    });
    if (!data)
      throw fail(
        'HUMAN_ONLY_DENIED',
        'Human-only work has no model execution path.',
      );
    if (data.refused) throw budgetRefusal(data.refused);
    const { a, input } = data;
    const key = (suffix: string) => ({
      ...ctx,
      idempotencyKey: `study:${a.id}:${suffix}`,
    });
    const pricing = await this.createPricing(
      key('pricing'),
      a.workspace_id,
      STUDY_FIXTURE_PRICING,
    );
    const envelope = await this.createEnvelope(key('budget'), a.workspace_id, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Frozen synthetic study envelope',
      cap_nano_usd: input.config.max_cost_nano_usd,
      starts_at: null,
      ends_at: null,
      max_in_flight: 1,
    });
    let request: Record<string, unknown>;
    const inputBindings: Record<string, string> = {};
    if (a.discovery_method === 'open_ended') {
      const context = studyContext(input, a);
      request = {
        envelope_id: envelope.id,
        action_type: 'model.generate',
        task_id: null,
        logical_operation_id: a.id,
        pricing_snapshot_id: pricing.id,
        data_class: 'synthetic',
        input: [{ role: 'user', text: JSON.stringify(context) }],
        max_output_tokens: input.config.max_output_tokens,
        output_format: 'text',
        tool: null,
        max_attempts: 1,
        timeout_ms: 30000,
        justification: 'Synthetic open-ended baseline; frozen context only.',
      };
    } else {
      const brief = await this.createEntity(key('brief'), a.workspace_id, {
        kind: 'search_brief',
        title: 'Frozen study brief',
        body: input.packet.structured_brief,
      });
      inputBindings[brief.id] = brief.content_hash;
      const evidence = [];
      const snapshots = input.packet.initial_resources.length
        ? input.packet.initial_resources
        : [
            {
              locator: 'fixture://no-evidence',
              snapshot: 'No initial evidence was supplied.',
            },
          ];
      for (let i = 0; i < snapshots.length; i++) {
        const resource = snapshots[i]!;
        const claim = await this.createEntity(
          key(`claim-${i}`),
          a.workspace_id,
          {
            kind: 'claim',
            title: `Frozen resource ${i + 1}`,
            body: {
              statement: resource.snapshot,
              basis: 'observation',
              uncertainty: `Provided snapshot at ${resource.locator}; support has not been independently verified.`,
            },
          },
        );
        inputBindings[claim.id] = claim.content_hash;
        evidence.push({ claim_id: claim.id, bears_on: ['problem'] });
      }
      const perspectives = [
        'software',
        'existing_tool',
        'process_change',
        'human_led',
        'hybrid',
      ].slice(0, input.config.candidate_count);
      request = {
        brief: { id: brief.id, version: brief.version },
        evidence,
        perspectives,
        excluded: [
          'software',
          'existing_tool',
          'process_change',
          'human_led',
          'hybrid',
        ]
          .filter((p) => !perspectives.includes(p))
          .map((p) => ({
            perspective: p,
            reason: 'Outside the frozen candidate count.',
          })),
        max_revisions: 0,
        max_age_days: 180,
        envelope_id: envelope.id,
        pricing_snapshot_id: pricing.id,
        data_class: 'synthetic',
        limits: {
          max_children: input.config.candidate_count,
          max_concurrency: 1,
          max_depth: 1,
          max_attempts: 1,
          max_repairs: 0,
          max_calls: input.config.max_calls,
          max_output_tokens: input.config.max_output_tokens,
          call_timeout_ms: 30000,
          max_wall_seconds: input.packet.time_cap_seconds,
        },
      };
    }
    await this.tx(async (c) => {
      await c.query(
        'select id from study_attempts where id=$1 for no key update',
        [a.id],
      );
      const current = await this.attemptIn(c, a.id);
      if (current.state !== 'assigned')
        throw fail('INVALID_TRANSITION', 'Attempt ended during setup.');
      const prior = await c.query(
        'select request_hash from study_execution_requests where attempt_id=$1',
        [a.id],
      );
      const digest = canonicalHash(request);
      if (prior.rows[0] && prior.rows[0].request_hash !== digest)
        throw fail('VERSION_CONFLICT', 'Execution context changed.');
      if (!prior.rowCount) {
        await c.query(
          'insert into study_execution_requests(attempt_id,kind,request,request_hash,input_bindings) values($1,$2,$3,$4,$5)',
          [a.id, a.discovery_method, request, digest, inputBindings],
        );
        await this.event(c, ctx, a.study_id, a.id, 'execution_prepared', {
          workflow_version:
            a.discovery_method === 'structured'
              ? 'r02-discovery/1.0'
              : 'study-open-ended/1',
          request_hash: digest,
        });
      }
    });
    return { attempt: a, request };
  }

  async recordBaselineOutcome(
    ctx: CommandContext,
    ws: string,
    attemptId: string,
    result: {
      status: string;
      reason_code?: string;
      output: { text: string } | null;
    },
  ) {
    return this.tx(async (c) => {
      const a = await this.lockAttemptForWrite(c, ctx, ws, attemptId, true);
      if (a.state !== 'assigned') return a;
      if (['in_flight', 'unknown'].includes(result.status)) return a;
      const study = await this.study(c, ws, a.study_id);
      const elapsed = (Date.now() - Date.parse(a.created_at)) / 1000;
      const expired =
        elapsed > (study.manifest as StudyInput).packet.time_cap_seconds;
      if (result.status === 'succeeded' && result.output)
        await this.event(c, ctx, a.study_id, a.id, 'artifacts', {
          kind: 'document',
          name: 'Neutral baseline output',
          content: result.output.text,
          formatter: 'verbatim/1',
        });
      await this.event(c, ctx, a.study_id, a.id, 'finished', {
        status: expired
          ? 'failed'
          : result.status === 'succeeded'
            ? 'submitted'
            : result.status === 'needs_human'
              ? 'needs_human'
              : result.status === 'cancelled'
                ? 'cancelled'
                : result.reason_code === 'budget_exceeded'
                  ? 'budget_exhausted'
                  : 'failed',
        summary: expired
          ? 'Assignment deadline exceeded; late output retained.'
          : `Synthetic baseline ${result.status}; no independent quality rating.`,
        outcome: expired ? 'deadline_exceeded' : result.status,
        wall_seconds: (Date.now() - Date.parse(a.created_at)) / 1000,
        human_active_minutes: a.condition === 'autonomous' ? 0 : null,
        human_wait_seconds: a.condition === 'autonomous' ? 0 : null,
        measurement_source: 'fixture_runner',
        condition: a.condition,
        primary: a.primary,
      });
      return this.attemptIn(c, a.id);
    });
  }

  /**
   * Freezes the server's proposed protocol (never a caller-supplied one) once the signed-in
   * human owner has answered every blocking research decision against its exact hash. The
   * freeze is a hash-chained audit event, so it cannot be edited later.
   */
  async freezeStudyProtocol(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(
      z.strictObject({
        proposal_hash: hash,
        decisions: z
          .array(
            z.strictObject({
              id: z.string().max(40),
              choice: text,
              rationale: text,
            }),
          )
          .max(20),
      }),
      raw,
    );
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const result = freezeProtocol(PROPOSED_PROTOCOL, req);
      if (result.status === 'blocked')
        throw new ContractError(
          'INVALID_TRANSITION',
          `Protocol not frozen: ${result.reason}`,
          result.blocking,
        );
      await c.query('select pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'study.protocol_frozen',
        subjectKind: 'workspace',
        subjectId: ws,
        subjectVersion: null,
        contentHash: result.freeze_hash,
        payload: {
          freeze_hash: result.freeze_hash,
          proposal_hash: result.manifest.proposal_hash,
          decisions: result.manifest.decisions,
        },
      });
      return { ...result, frozen_by: ctx.actorId };
    });
  }

  /** The adopted protocol freeze rebuilt from the audit log against the proposal in code. */
  async latestProtocolFreeze(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      return this.freezeIn(c, ws);
    });
  }
  /** Binds a final evaluation schedule to the owner's audit log before anything runs. */
  async recordEvaluationSchedule(
    ctx: CommandContext,
    ws: string,
    schedule: { schedule_hash: string; freeze_hash: string; slots: unknown[] },
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      await c.query('select pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
      return this.append(c, ctx, {
        workspaceId: ws,
        action: 'evaluation.schedule_planned',
        subjectKind: 'workspace',
        subjectId: ws,
        subjectVersion: null,
        contentHash: schedule.schedule_hash,
        payload: {
          schedule_hash: schedule.schedule_hash,
          freeze_hash: schedule.freeze_hash,
          slots: schedule.slots.length,
        },
      });
    });
  }
}

/**
 * The timer measures the assigned person only: the workspace owner may act on a participant's
 * attempt, but their time is not the participant's, so they cannot time its steps.
 */
function notParticipant(a: StudyAttempt, ctx: CommandContext) {
  if (a.participant_actor_id.toLowerCase() !== ctx.actorId)
    throw fail(
      'ACCESS_DENIED',
      'Only the person assigned to this attempt can time its steps.',
    );
}

/** Null when the measured totals fit inside the step's server time, else the reason. */
export function effortOverrun(
  effort: Pick<StudyEffort, 'active_ms' | 'wait_ms' | 'idle_ms' | 'away_ms'>,
  wallMs: number,
): string | null {
  const measured =
    effort.active_ms + effort.wait_ms + effort.idle_ms + effort.away_ms;
  return measured > wallMs + STUDY_EFFORT_CLOCK_SLACK_MS
    ? `The measured time (${measured} ms) is longer than the step lasted on the studio clock (${wallMs} ms).`
    : null;
}

function effortStep(
  s: Row,
  synthetic: boolean,
  m: Row | null,
): StudyEffortStep {
  return {
    id: String(s.id),
    attempt_id: String(s.attempt_id),
    step: 'intervention',
    synthetic,
    started_at: iso(s.started_at),
    measured: m
      ? {
          event_id: String(m.event_id),
          timer_version: String(
            m.timer_version,
          ) as typeof STUDY_EFFORT_TIMER_VERSION,
          active_ms: Number(m.active_ms),
          wait_ms: Number(m.wait_ms),
          idle_ms: Number(m.idle_ms),
          away_ms: Number(m.away_ms),
          wall_ms: Number(m.wall_ms),
          recorded_at: iso(m.recorded_at),
        }
      : null,
  };
}

export function budgetRefusal(
  d:
    | {
        ledger: string;
        ledger_cap_nano_usd: string;
        attempt_cap_nano_usd: string;
        exposure_before_nano_usd: string;
      }
    | {
        ledger: string;
        attempt_cap_nano_usd: string;
        amounts: 'studio_spending_manager_only';
      },
) {
  if ('amounts' in d)
    return new ContractError(
      'BUDGET_EXCEEDED',
      `This attempt's frozen cap does not fit ${d.ledger === 't15-final' ? 'in what remains of the shared final study ledger' : `under the studio spending limit (${d.ledger})`}; nothing was dispatched. The amounts are in Settings → Spending limits, for the studio spending manager.`,
      [`ledger ${d.ledger}`, `attempt cap ${d.attempt_cap_nano_usd}`],
    );
  return new ContractError(
    'BUDGET_EXCEEDED',
    "This attempt's frozen cap does not fit in what remains of the study ledger; nothing was dispatched.",
    [
      `ledger ${d.ledger} cap ${d.ledger_cap_nano_usd} nano-USD`,
      `held or spent ${d.exposure_before_nano_usd}`,
      `attempt cap ${d.attempt_cap_nano_usd}`,
    ],
  );
}
