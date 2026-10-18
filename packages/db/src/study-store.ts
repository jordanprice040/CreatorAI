import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AssignStudySchema,
  StudyArtifactSchema,
  StudyTestSchema,
  StudyInterventionSchema,
  FinishStudyAttemptSchema,
  OVERSIGHT_POLICY_VERSION,
  parse,
  z,
  text,
  id,
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
  SYNTHETIC_STUDY,
  STUDY_FIXTURE_PRICING,
} from '@creator/domain';
import { CatalogStore } from './catalog-store.js';
import {
  AUDIT_CHAIN_LOCK,
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

export class StudyStore extends CatalogStore {
  private async study(c: PoolClient, ws: string, studyId: string) {
    const r = await c.query(
      'select * from studies where workspace_id=$1 and id=$2',
      [uuid(ws), uuid(studyId)],
    );
    if (!r.rows[0]) throw fail('NOT_FOUND', 'Study not found.');
    return r.rows[0] as Row;
  }
  private summary(r: Row): StudySummary {
    return {
      id: String(r.id),
      title: (r.manifest as StudyInput).title,
      synthetic: true,
      status: 'draft_not_frozen',
      manifest_hash: String(r.manifest_hash),
      created_at: iso(r.created_at),
    };
  }
  async createStudy(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const frozen = studyManifest(raw);
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
        if (!mode.rows[0]?.fixture)
          throw fail(
            'INVALID_CONTRACT',
            'T10 studies require a synthetic fixture workspace. Recruitment is not enabled.',
          );
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
          payload: { synthetic: true },
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
  private async event(
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
    const s = await c.query('select workspace_id from studies where id=$1', [
      studyId,
    ]);
    await this.append(c, ctx, {
      workspaceId: String(s.rows[0]!.workspace_id),
      action: `study.${kind}`,
      subjectKind: 'study',
      subjectId: studyId,
      subjectVersion: null,
      contentHash,
      payload: { event_id: eventId, attempt_id: attemptId, synthetic: true },
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
        const context = studyContext(input, req);
        const attemptId = randomUUID(),
          attemptWs = randomUUID();
        const count = await c.query(
          'select count(*)::int as n from study_attempts where study_id=$1',
          [studyId],
        );
        const ordinal = Number(count.rows[0]!.n) + 1;
        await c.query(
          "insert into workspaces(id,name,record_mode,fixture,created_by) values($1,$2,'fixture',true,$3)",
          [attemptWs, `Synthetic study attempt ${ordinal}`, ctx.actorId],
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
        if (req.condition !== 'human_only') {
          const g = await this.insertGrant(c, ctx, attemptWs, {
            scope: 'standing',
            run_id: null,
            action_types: ['model.generate'],
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
        await this.event(c, ctx, studyId, attemptId, 'assigned', {
          condition: req.condition,
          discovery_method: req.discovery_method,
          primary: req.continuation_of === null,
          order: ordinal,
          context_hash: canonicalHash(context),
        });
        return this.attemptIn(c, attemptId);
      },
    );
  }
  private async attemptIn(
    c: PoolClient,
    attemptId: string,
  ): Promise<StudyAttempt> {
    const r = await c.query('select * from study_attempts where id=$1', [
      uuid(attemptId),
    ]);
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
      synthetic: true,
      ...req,
      order: Number(a.ordinal),
      primary: req.continuation_of === null,
      context_hash: String(a.context_hash),
      state: end.rows[0]?.payload.status ?? 'assigned',
      created_at: iso(a.created_at),
      finished_at: end.rows[0] ? iso(end.rows[0].created_at) : null,
    };
  }
  private async accessAttempt(
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
  private async lockAttemptForWrite(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    attemptId: string,
    ownerOnly = false,
  ) {
    const a = await this.accessAttempt(c, ctx, ws, attemptId, ownerOnly);
    await this.lockRun(c, a.workspace_id, a.run_id);
    await c.query(
      'select id from study_attempts where id=$1 for no key update',
      [attemptId],
    );
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
      return { synthetic: true, attempt: a, context: r.rows[0]!.context };
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
            ? StudyInterventionSchema
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
    const req = parse(
      schema as z.ZodType<Record<string, unknown>>,
      raw,
    ) as Record<string, unknown>;
    // Return denials after commit so the denial event is durable.
    return this.tx(async (c) => {
      const a = await this.lockAttemptForWrite(c, ctx, ws, attemptId);
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
      return this.event(c, ctx, a.study_id, attemptId, action, req);
    });
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
          measurements: {
            active_ai_seconds: 0,
            active_ai_source: 'fixture_has_no_ai_inference',
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
        synthetic: true,
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
          'Synthetic only; no participants recruited.',
          'Human timing is reported, not observed.',
          'Text checks are executed; arbitrary code execution awaits T11.',
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
      if (input.packet.stratum === 'implementation')
        throw fail(
          'INVALID_CONFIG',
          'AI implementation execution requires the isolated T11 worker; this runner never executes code on the studio host.',
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
      return { a, input };
    });
    if (!data)
      throw fail(
        'HUMAN_ONLY_DENIED',
        'Human-only work has no model execution path.',
      );
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
}
