import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AUTOMATION_POLICY_VERSION,
  AUTOPILOT_POLICY_VERSION,
  RunAutomationConfigSchema,
  SetRunAutomationRequestSchema,
  StopRunAutomationRequestSchema,
  automationAutopilotConfig,
  autopilotSummary,
  parse,
  runAutomationSummary,
  type RunAutomation,
} from '@creator/contracts';
import { canonicalHash, nextAutopilotStage } from '@creator/domain';
import { AutopilotStore } from './autopilot-store.js';
import {
  fail,
  iso,
  isPgError,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

// ADR-0099 (P33): "Automate selection" on a run. The owner sets it once, confirming its summary,
// on a run whose routine approvals cover selection; while it is active the studio starts a
// selection-only autopilot (ADR-0092) for each assessment that finishes on the run. Starting one
// is the owner's standing choice carried out by the studio, so it is checked again each time:
// the setter must still be the owner, the run active and its policy still covering selection.
// When any of that fails the level stops itself with the reason; nothing is widened for it.

const toAutomation = (r: Row, started: Row[] = []): RunAutomation => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  run_id: String(r.run_id),
  fixture: Boolean(r.fixture),
  level: 'selection',
  config: RunAutomationConfigSchema.parse(r.config),
  config_hash: String(r.config_hash),
  summary: (r.summary as string[]).map(String),
  policy_version: String(r.policy_version),
  state: r.state as RunAutomation['state'],
  stop_reason: r.stop_reason ? String(r.stop_reason) : null,
  version: Number(r.version),
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
  stopped_at: r.stopped_at ? iso(r.stopped_at) : null,
  autopilots: started
    .filter((a) => String(a.automation_id) === String(r.id))
    .slice(0, 10)
    .map((a) => ({
      id: String(a.id),
      problem_id: String(a.problem_id),
      state: a.state as 'running' | 'finished',
      outcome: a.outcome ? String(a.outcome) : null,
      created_at: iso(a.created_at),
    })),
  started: started.filter((a) => String(a.automation_id) === String(r.id))
    .length,
});

/** A finished assessment an active "Automate selection" level has not acted on yet. */
export interface DueAutomation {
  workspace_id: string;
  automation_id: string;
  run_id: string;
  workflow_id: string;
  problem_id: string;
}

export class AutomationStore extends AutopilotStore {
  /** The owner sets "Automate selection" on a run. */
  async setRunAutomation(
    ctxIn: CommandContext,
    wsIn: string,
    runIn: string,
    raw: unknown,
  ): Promise<RunAutomation> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const runId = uuid(runIn);
    const req = parse(SetRunAutomationRequestSchema, raw);
    const summary = runAutomationSummary(req.config);
    if (JSON.stringify(summary) !== JSON.stringify(req.summary_seen))
      throw fail(
        'VERSION_CONFLICT',
        'The summary changed since it was shown. Read it again and confirm it.',
      );
    const ends = Date.parse(req.config.ends_at);
    if (ends <= Date.now() + 60_000 || ends > Date.now() + 90 * 86_400_000)
      throw fail(
        'INVALID_CONTRACT',
        'Automate selection needs an end time between a minute and 90 days from now.',
      );
    try {
      const id = await this.idempotent(
        ws,
        ctx,
        { op: 'automation.set', runId, req },
        async (c) => {
          await this.requireOwner(
            c,
            ws,
            ctx.actorId,
            'Only the workspace owner, signed in as a person, can set how a project is automated.',
          );
          await this.lockRun(c, ws, runId);
          await this.#checkRun(c, ws, runId);
          await this.checkAutopilotPolicy(
            c,
            ws,
            runId,
            this.#probeConfig(req.config),
          );
          const id = randomUUID();
          await c.query(
            `insert into run_automations (id, workspace_id, run_id, fixture, level, config,
               config_hash, summary, policy_version, state, version, created_by)
             select $1, w.id, $3, w.fixture, 'selection', $4, $5, $6, $7, 'active', 1, $8
             from workspaces w where w.id = $2`,
            [
              id,
              ws,
              runId,
              JSON.stringify(req.config),
              canonicalHash(req.config),
              summary,
              AUTOMATION_POLICY_VERSION,
              ctx.actorId,
            ],
          );
          await this.append(c, ctx, {
            workspaceId: ws,
            action: 'automation.set',
            subjectKind: 'run_automation',
            subjectId: id,
            subjectVersion: 1,
            contentHash: canonicalHash(req.config),
            payload: {
              level: 'selection',
              data_class: req.config.data_class,
              ends_at: req.config.ends_at,
            },
            relatedIds: [runId],
          });
          return id;
        },
      );
      return this.#get(ws, id);
    } catch (e) {
      if (isPgError(e, '23505', 'run_automations_one_active'))
        throw fail(
          'INVALID_TRANSITION',
          'This run already automates selection. Set it back to Manual first to change it.',
        );
      throw e;
    }
  }

  /** The owner sets a run back to Manual. Autopilots it started are stopped by the caller. */
  async stopRunAutomation(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    raw: unknown,
  ): Promise<RunAutomation> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    const req = parse(StopRunAutomationRequestSchema, raw);
    await this.tx(async (c) => {
      await this.requireOwner(
        c,
        ws,
        ctx.actorId,
        'Only the workspace owner can change how a project is automated.',
      );
      const cur = await this.#lock(c, ws, id);
      if (cur.state !== 'active')
        throw fail('INVALID_TRANSITION', 'It is already set back to Manual.');
      if (
        req.expected_version !== undefined &&
        req.expected_version !== Number(cur.version)
      )
        throw fail(
          'VERSION_CONFLICT',
          `It is at version ${String(cur.version)}.`,
        );
      await this.#stop(
        c,
        ctx,
        cur,
        `Set back to Manual by the owner${req.reason ? `: ${req.reason}` : '.'}`,
      );
    });
    return this.#get(ws, id);
  }

  async listRunAutomations(
    ctxIn: CommandContext,
    wsIn: string,
  ): Promise<RunAutomation[]> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from run_automations where workspace_id = $1
          order by created_at desc, id desc limit 30`,
        [ws],
      );
      return this.#withStarted(c, ws, rows as Row[]);
    });
  }

  /**
   * Stops levels whose end time passed, then lists the finished assessments active levels have
   * not acted on: an assessment on the level's run that succeeded after the level was set, with
   * no autopilot of the level for it, no choice recorded for its problem since it finished, and
   * no autopilot running on the run (one runs per run; the rest wait for the next look).
   */
  async dueAutomations(): Promise<DueAutomation[]> {
    const expired = await this.pool.query(
      `select id, workspace_id from run_automations
        where state = 'active' and (config->>'ends_at')::timestamptz <= clock_timestamp()
        limit 50`,
    );
    for (const e of expired.rows as Row[])
      await this.tx(async (c) => {
        const cur = await this.#lock(c, String(e.workspace_id), String(e.id));
        if (cur.state === 'active')
          await this.#stop(
            c,
            { actorId: String(cur.created_by) },
            cur,
            'Its end time passed.',
          );
      });
    const { rows } = await this.pool.query(
      `select distinct on (a.id) a.workspace_id, a.id as automation_id, a.run_id,
              w.id as workflow_id, w.subject_id as problem_id
         from run_automations a
         join workflows w on w.workspace_id = a.workspace_id and w.run_id = a.run_id
        where a.state = 'active'
          and w.role = 'r08_assessment' and w.state = 'succeeded'
          and w.finished_at >= a.created_at
          and not exists (select 1 from autopilots p
                           where p.automation_id = a.id and p.trigger_workflow_id = w.id)
          and not exists (select 1 from selections s
                           where s.workspace_id = a.workspace_id and s.problem_id = w.subject_id
                             and s.created_at >= w.finished_at)
          and not exists (select 1 from autopilots r
                           where r.workspace_id = a.workspace_id and r.run_id = a.run_id
                             and r.state = 'running')
          -- An assessment an autopilot ran as its own step is that autopilot's to choose on.
          and not exists (select 1 from autopilots x
                           where x.workspace_id = a.workspace_id and x.run_id = a.run_id
                             and x.steps @> jsonb_build_array(jsonb_build_object('child',
                                   jsonb_build_object('kind', 'workflow', 'id', w.id::text))))
          -- A newer assessment of the same problem supersedes this one.
          and not exists (select 1 from workflows n
                           where n.workspace_id = w.workspace_id and n.run_id = w.run_id
                             and n.role = 'r08_assessment' and n.subject_id = w.subject_id
                             and n.created_at > w.created_at)
        order by a.id, w.finished_at
        limit 20`,
    );
    return (rows as Row[]).map((r) => ({
      workspace_id: String(r.workspace_id),
      automation_id: String(r.automation_id),
      run_id: String(r.run_id),
      workflow_id: String(r.workflow_id),
      problem_id: String(r.problem_id),
    }));
  }

  /**
   * Starts the selection autopilot for one due assessment, under the owner who set the level and
   * recorded as the autopilot. Null when there is nothing to start now (already started, or
   * another autopilot runs on the run); when the level can no longer act, it stops with why.
   */
  async startAutomationAutopilot(
    due: DueAutomation,
  ): Promise<{ id: string; created_by: string } | null> {
    const ws = uuid(due.workspace_id);
    const autopilotId = randomUUID();
    try {
      return await this.tx(async (c) => {
        await this.lockRun(c, ws, uuid(due.run_id));
        const cur = await this.#lock(c, ws, uuid(due.automation_id));
        if (cur.state !== 'active') return null;
        const owner = String(cur.created_by);
        const ctx: CommandContext = {
          actorId: owner,
          autopilot: { id: autopilotId },
        };
        const config = RunAutomationConfigSchema.parse(cur.config);
        const stopWith = async (reason: string) => {
          await this.#stop(c, { actorId: owner }, cur, reason);
          return null;
        };
        if (!(await this.isPolicyOwner(c, ws, owner)))
          return stopWith(
            'The person who set it is no longer the workspace owner.',
          );
        try {
          await this.#checkRun(c, ws, String(cur.run_id));
        } catch (e) {
          return stopWith(e instanceof Error ? e.message : 'The run changed.');
        }
        const problem = (
          await c.query(
            `select version, status from entities
              where workspace_id = $1 and id = $2 and kind = 'problem'`,
            [ws, due.problem_id],
          )
        ).rows[0] as Row | undefined;
        if (!problem || problem.status !== 'active') return null;
        const ap = automationAutopilotConfig(config, {
          id: due.problem_id,
          version: Number(problem.version),
        });
        try {
          await this.checkAutopilotPolicy(c, ws, String(cur.run_id), ap);
        } catch (e) {
          return stopWith(
            `The run's routine approvals no longer cover it: ${e instanceof Error ? e.message : ''}`.slice(
              0,
              600,
            ),
          );
        }
        const summary = autopilotSummary(ap);
        await c.query(
          `insert into autopilots (id, workspace_id, run_id, fixture, config, config_hash, summary,
             policy_version, state, stage, explanation, version, created_by, automation_id,
             trigger_workflow_id)
           select $1, w.id, $3, w.fixture, $4, $5, $6, $7, 'running', $8, $9, 1, $10, $11, $12
           from workspaces w where w.id = $2`,
          [
            autopilotId,
            ws,
            String(cur.run_id),
            JSON.stringify(ap),
            canonicalHash(ap),
            summary,
            AUTOPILOT_POLICY_VERSION,
            nextAutopilotStage(ap, [])!,
            'Started by Automate selection after an assessment finished.',
            owner,
            String(cur.id),
            due.workflow_id,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'autopilot.started',
          subjectKind: 'autopilot',
          subjectId: autopilotId,
          subjectVersion: 1,
          contentHash: canonicalHash(ap),
          payload: {
            research: false,
            route: ap.resource_setup.kind,
            max_calls: ap.limits.max_calls,
            ends_at: ap.limits.ends_at,
            automation_id: String(cur.id),
            assessment_workflow_id: due.workflow_id,
          },
          relatedIds: [String(cur.run_id), String(cur.id), due.workflow_id],
        });
        return { id: autopilotId, created_by: owner };
      });
    } catch (e) {
      // Another autopilot started on the run, or this assessment was taken, meanwhile.
      if (
        isPgError(e, '23505', 'autopilots_one_running') ||
        isPgError(e, '23505', 'autopilots_one_per_trigger')
      )
        return null;
      throw e;
    }
  }

  /** The run must be active, use a model and not be a frozen study run. */
  async #checkRun(c: PoolClient, ws: string, runId: string) {
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
        'The run is cancelled or human-only; automation is not used there.',
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
        'Automation is not used for frozen study runs; their conditions stay as frozen.',
      );
  }

  /** A stand-in autopilot config with the level's stage, data class and end time. */
  #probeConfig(config: RunAutomation['config']) {
    return automationAutopilotConfig(config, {
      id: '00000000-0000-4000-8000-000000000000',
      version: 1,
    });
  }

  async #lock(c: PoolClient, ws: string, id: string) {
    const row = (
      await c.query(
        'select * from run_automations where workspace_id = $1 and id = $2 for update',
        [ws, id],
      )
    ).rows[0] as Row | undefined;
    if (!row) throw fail('NOT_FOUND', 'Automation not found.');
    return row;
  }

  async #stop(c: PoolClient, ctx: CommandContext, cur: Row, reason: string) {
    const { rows } = await c.query(
      `update run_automations set state = 'stopped', stopped_at = clock_timestamp(),
         updated_at = clock_timestamp(), version = version + 1, stop_reason = $2
        where id = $1 returning version`,
      [cur.id, reason.slice(0, 600)],
    );
    await this.append(c, ctx, {
      workspaceId: String(cur.workspace_id),
      action: 'automation.stopped',
      subjectKind: 'run_automation',
      subjectId: String(cur.id),
      subjectVersion: Number((rows[0] as Row).version),
      contentHash: String(cur.config_hash),
      payload: { level: 'selection', reason: reason.slice(0, 600) },
      relatedIds: [String(cur.run_id)],
    });
  }

  async #withStarted(c: PoolClient, ws: string, rows: Row[]) {
    if (!rows.length) return [];
    const started = await c.query(
      `select id, automation_id, state, outcome, created_at, config->'start'->'problem'->>'id' as problem_id
         from autopilots where workspace_id = $1 and automation_id = any($2::uuid[])
        order by created_at desc, id desc`,
      [ws, rows.map((r) => r.id)],
    );
    return rows.map((r) => toAutomation(r, started.rows as Row[]));
  }

  async #get(ws: string, id: string): Promise<RunAutomation> {
    return this.tx(async (c) => {
      const row = (
        await c.query(
          'select * from run_automations where workspace_id = $1 and id = $2',
          [ws, id],
        )
      ).rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Automation not found.');
      return (await this.#withStarted(c, ws, [row]))[0]!;
    });
  }
}
