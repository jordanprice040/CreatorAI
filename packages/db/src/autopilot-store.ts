import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AUTOPILOT_SETTINGS_DEFAULT,
  AllowAndContinueRequestSchema,
  AutopilotSettingsValuesSchema,
  SETTING_FOR_STOP,
  SaveAutopilotSettingsRequestSchema,
  settingOn,
  settingIsOn,
  AUTOPILOT_SETTING_TEXT,
  type AutopilotSettings,
  type AutopilotSettingsValues,
  AUTOPILOT_MAX_STEPS,
  AUTOPILOT_POLICY_VERSION,
  autopilotContinuable,
  autopilotEndsApprovals,
  AutopilotConfigSchema,
  AutopilotControlRequestSchema,
  AutopilotStepSchema,
  ROUTINE_STAGE_ACTIONS,
  routineStopFix,
  StartAutopilotRequestSchema,
  autopilotStagesNeeded,
  autopilotSummary,
  cutText,
  parse,
  z,
  type Autopilot,
  type AutopilotOutcome,
  type AutopilotStage,
  type AutopilotStep,
  type RoutinePolicyChange,
} from '@creator/contracts';
import {
  canonicalHash,
  nextAutopilotStage,
  suggestClaims,
} from '@creator/domain';
import { WebDiscoveryStore } from './web-discovery-store.js';
import { routineStopReason } from './routine-stops.js';
import {
  fail,
  iso,
  isPgError,
  normalize,
  recordedActor,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

// ADR-0092 (P13): autopilot records. The runner (apps/api/src/autopilot.ts) drives the steps; every
// change goes through `advanceAutopilot`, which names the version it read, so a cancel between
// two steps always wins and a step that moved on is never written over. Only the workspace owner
// starts, stops or continues an autopilot; nothing here admits a step (each step's own route does).

export const toAutopilot = (r: Row): Autopilot => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  run_id: String(r.run_id),
  fixture: Boolean(r.fixture),
  config: AutopilotConfigSchema.parse(r.config),
  config_hash: String(r.config_hash),
  summary: (r.summary as string[]).map(String),
  policy_version: String(r.policy_version),
  state: r.state as Autopilot['state'],
  stage: r.stage as AutopilotStage,
  outcome: (r.outcome ?? null) as AutopilotOutcome | null,
  explanation: String(r.explanation),
  steps: parse(z.array(AutopilotStepSchema), r.steps),
  calls_reserved: Number(r.calls_reserved),
  version: Number(r.version),
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
  finished_at: r.finished_at ? iso(r.finished_at) : null,
  active: false,
  automation_id: r.automation_id ? String(r.automation_id) : null,
  routine_policy_id: r.routine_policy_id ? String(r.routine_policy_id) : null,
  approvals_ended_at: r.approvals_ended_at ? iso(r.approvals_ended_at) : null,
});

/** What the runner may change in one guarded step. */
export interface AutopilotPatch {
  stage?: AutopilotStage;
  steps?: AutopilotStep[];
  calls_reserved?: number;
  explanation?: string;
  /** Set to finish the autopilot. */
  outcome?: AutopilotOutcome;
}

export class AutopilotStore extends WebDiscoveryStore {
  /**
   * The owner starts an autopilot on a run that has routine approvals covering its steps. The
   * start records the confirmed summary; it admits nothing by itself.
   */
  async startAutopilot(
    ctxIn: CommandContext,
    wsIn: string,
    runIn: string,
    raw: unknown,
    /**
     * Re-review 2 N-2: a check the caller runs only for a new start (not for a repeated one the
     * idempotency key already recorded), after the owner check and the run lock.
     */
    beforeNew?: (c: PoolClient) => Promise<void>,
  ): Promise<Autopilot> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const runId = uuid(runIn);
    const req = parse(StartAutopilotRequestSchema, raw);
    const summary = autopilotSummary(req.config);
    if (JSON.stringify(summary) !== JSON.stringify(req.summary_seen))
      throw fail(
        'VERSION_CONFLICT',
        'The autopilot summary changed since it was shown. Read it again and confirm it.',
      );
    if (Date.parse(req.config.limits.ends_at) <= Date.now() + 60_000)
      throw fail(
        'INVALID_CONTRACT',
        'The autopilot must end at least a minute from now.',
      );
    try {
      const id = await this.idempotent(
        ws,
        ctx,
        { op: 'autopilot.start', runId, req },
        async (c) => {
          await this.requireOwner(
            c,
            ws,
            ctx.actorId,
            'Only the workspace owner, signed in as a person, can start an autopilot.',
          );
          await this.lockRun(c, ws, runId);
          await beforeNew?.(c);
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
              'The run is cancelled or human-only; an autopilot uses a model.',
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
              'Autopilots are not used for frozen study runs; their conditions stay as frozen.',
            );
          // P33 (review L-1): the approvals change and the start succeed or fail together; the
          // run is checked first, so a refused run never writes a policy (review 2 N-2).
          // P-11: approvals made here are this autopilot's own and end with it.
          const own = await this.applyRoutinePolicyChange(
            c,
            ctx,
            ws,
            runId,
            req.routine_policy,
          );
          await this.checkAutopilotPolicy(c, ws, runId, req.config);
          if (req.config.start) {
            const p = (
              await c.query(
                `select version, status from entities
                  where workspace_id = $1 and id = $2 and kind = 'problem'`,
                [ws, req.config.start.problem.id.toLowerCase()],
              )
            ).rows[0] as Row | undefined;
            if (!p || p.status !== 'active')
              throw fail(
                'NOT_FOUND',
                'The problem to start from was not found.',
              );
            if (Number(p.version) !== req.config.start.problem.version)
              throw fail(
                'VERSION_CONFLICT',
                `The problem is now version ${String(p.version)}; read it again and start from that.`,
              );
          }
          const id = randomUUID();
          const first = nextAutopilotStage(req.config, [])!;
          await c.query(
            `insert into autopilots (id, workspace_id, run_id, fixture, config, config_hash, summary,
               policy_version, state, stage, explanation, version, created_by, routine_policy_id)
             select $1, w.id, $3, w.fixture, $4, $5, $6, $7, 'running', $8, $9, 1, $10, $11
             from workspaces w where w.id = $2`,
            [
              id,
              ws,
              runId,
              JSON.stringify(req.config),
              canonicalHash(req.config),
              summary,
              AUTOPILOT_POLICY_VERSION,
              first,
              'Starting.',
              ctx.actorId,
              own,
            ],
          );
          await this.append(c, ctx, {
            workspaceId: ws,
            action: 'autopilot.started',
            subjectKind: 'autopilot',
            subjectId: id,
            subjectVersion: 1,
            contentHash: canonicalHash(req.config),
            payload: {
              research: !!req.config.research,
              route: req.config.resource_setup.kind,
              max_calls: req.config.limits.max_calls,
              ends_at: req.config.limits.ends_at,
            },
            relatedIds: [runId],
          });
          return id;
        },
      );
      return this.getAutopilot(ctx, ws, id);
    } catch (e) {
      if (isPgError(e, '23505', 'autopilots_one_running'))
        throw fail(
          'INVALID_TRANSITION',
          'An autopilot is already running on this run. Wait for it or stop it first.',
        );
      throw e;
    }
  }

  /**
   * ADR-0099 (P33, review L-1): sets or widens the run's routine approvals in the caller's
   * transaction (after the run lock), with the same checks and records as Monitor › Approvals.
   */
  protected async applyRoutinePolicyChange(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    runId: string,
    change: RoutinePolicyChange,
  ) {
    if (!change) return null;
    if (change.kind === 'new')
      return (
        await this.setRoutinePolicyIn(
          c,
          ctx,
          ws,
          runId,
          this.checkRoutineInput(change.policy),
        )
      ).id;
    const { expected_version, ...rest } = change.policy;
    const input = this.checkRoutineInput(rest);
    const policyId = uuid(change.policy_id);
    const owned = await c.query(
      `select workspace_id, run_id, stop_on, confirmed_at, status
         from routine_policies where workspace_id = $1 and id = $2`,
      [ws, policyId],
    );
    const row = owned.rows[0] as Row | undefined;
    if (String(row?.run_id ?? '') !== runId)
      throw fail(
        'INVALID_CONTRACT',
        'The routine approvals to change are not this run’s.',
      );
    // Review 3 L-1: a revision is a fresh confirmation, which would clear a person-rejects stop
    // without the owner seeing it. A level only widens approvals that stopped for steps or time;
    // a stop condition stays for the owner to look at under Monitor › Approvals.
    const stopped =
      row!.status === 'active'
        ? await routineStopReason(c, {
            workspace_id: String(row!.workspace_id),
            run_id: String(row!.run_id),
            stop_on: row!.stop_on as string[],
            confirmed_at: row!.confirmed_at as Date,
          })
        : null;
    if (stopped)
      throw fail(
        'INVALID_TRANSITION',
        `This run’s routine approvals stopped: ${stopped} ${routineStopFix(stopped)}`,
      );
    await this.reviseRoutinePolicyIn(
      c,
      ctx,
      ws,
      policyId,
      expected_version,
      input,
    );
    return null;
  }

  /**
   * The run's active routine policy must cover every stage the autopilot's steps need, its data
   * class, and last at least until the autopilot's end time; otherwise the start is refused with
   * what to change, instead of every step stopping to ask.
   */
  protected async checkAutopilotPolicy(
    c: PoolClient,
    ws: string,
    runId: string,
    config: Autopilot['config'],
  ) {
    const policy = (
      await c.query(
        `select stages, data_classes, expires_at from routine_policies
          where workspace_id = $1 and run_id = $2 and status = 'active'`,
        [ws, runId],
      )
    ).rows[0] as Row | undefined;
    const needed = autopilotStagesNeeded(!!config.research, config.start);
    if (!policy)
      throw fail(
        'ACCESS_DENIED',
        `Turn on routine approvals for this run first (Monitor › Approvals), covering ${needed.join(', ').replaceAll('_', ' ')}. An autopilot never approves steps itself.`,
      );
    const stages = (policy.stages as string[]).map(String);
    const missing = needed.filter((s) => !stages.includes(s));
    const problems: string[] = [];
    if (missing.length)
      problems.push(
        `The run's routine approvals do not cover ${missing.join(', ').replaceAll('_', ' ')} (${missing
          .flatMap((s) => ROUTINE_STAGE_ACTIONS[s])
          .join(', ')}).`,
      );
    const classes = (policy.data_classes as string[]).map(String);
    if (!classes.includes(config.data_class))
      problems.push(
        `The routine approvals do not cover ${config.data_class.replaceAll('_', ' ')} data.`,
      );
    if (config.research && !classes.includes('public'))
      problems.push('Searching the web needs public data covered as well.');
    if (Date.parse(iso(policy.expires_at)) < Date.parse(config.limits.ends_at))
      problems.push(
        `The routine approvals end at ${iso(policy.expires_at).slice(0, 16).replace('T', ' ')} UTC, before the autopilot would; set the autopilot to end earlier or change the approvals.`,
      );
    if (problems.length)
      throw fail(
        'ACCESS_DENIED',
        `${problems.join(' ')} Change them under Monitor › Approvals, then start again.`,
      );
  }

  async getAutopilot(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
  ): Promise<Autopilot> {
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
        `select * from autopilots where workspace_id = $1 and id = $2${lock ? ' for update' : ''}`,
        [ws, id],
      )
    ).rows[0] as Row | undefined;
    if (!row) throw fail('NOT_FOUND', 'Autopilot not found.');
    return toAutopilot(row);
  }

  async listAutopilots(
    ctxIn: CommandContext,
    wsIn: string,
    runId?: string | null,
  ): Promise<Autopilot[]> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from autopilots where workspace_id = $1 and ($2::uuid is null or run_id = $2)
          order by created_at desc, id desc limit 20`,
        [ws, runId ? uuid(runId) : null],
      );
      return (rows as Row[]).map(toAutopilot);
    });
  }

  /**
   * One guarded change by the runner: refused (null) when the autopilot is no longer running or
   * someone changed it since `expected` was read. Finishing writes the audit event.
   */
  async advanceAutopilot(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    expected: number,
    patch: AutopilotPatch,
  ): Promise<Autopilot | null> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const cur = await this.#read(c, ws, id, true);
      if (cur.state !== 'running' || cur.version !== expected) return null;
      const steps = patch.steps ?? cur.steps;
      if (steps.length > AUTOPILOT_MAX_STEPS)
        throw fail(
          'LIMIT_EXCEEDED',
          `An autopilot records at most ${AUTOPILOT_MAX_STEPS} steps.`,
        );
      const reserved = patch.calls_reserved ?? cur.calls_reserved;
      if (reserved > cur.config.limits.max_calls)
        throw fail(
          'LIMIT_EXCEEDED',
          'A step would set aside more calls than the autopilot has.',
        );
      const finished = patch.outcome !== undefined;
      const { rows } = await c.query(
        `update autopilots set stage = $3, steps = $4, calls_reserved = $5, explanation = $6,
           state = $7, outcome = $8, finished_at = $9, version = version + 1,
           updated_at = clock_timestamp()
         where workspace_id = $1 and id = $2 returning *`,
        [
          ws,
          id,
          patch.stage ?? cur.stage,
          JSON.stringify(parse(z.array(AutopilotStepSchema), steps)),
          reserved,
          cutText(patch.explanation ?? cur.explanation, 1200),
          finished ? 'finished' : 'running',
          finished ? patch.outcome : null,
          finished ? new Date().toISOString() : null,
        ],
      );
      let next = toAutopilot(rows[0] as Row);
      if (finished) next = await this.#endOwnApprovals(c, ctx, next);
      if (finished)
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'autopilot.finished',
          subjectKind: 'autopilot',
          subjectId: id,
          subjectVersion: next.version,
          contentHash: next.config_hash,
          payload: {
            outcome: next.outcome,
            stage: next.stage,
            calls_reserved: next.calls_reserved,
            steps: next.steps.length,
          },
          relatedIds: [
            next.run_id,
            ...next.steps.flatMap((s) => (s.child ? [s.child.id] : [])),
          ],
        });
      return next;
    });
  }

  /**
   * P-11 (ADR-0100): when an autopilot ends other than by waiting for a person's input, the
   * routine approvals made for it when it started end too (run, policy, grant, then the audit
   * log; the autopilot row is already locked). Approvals the run already had keep their terms.
   */
  async #endOwnApprovals(
    c: PoolClient,
    ctx: CommandContext,
    a: Autopilot,
  ): Promise<Autopilot> {
    if (
      !a.routine_policy_id ||
      a.approvals_ended_at ||
      !autopilotEndsApprovals(a)
    )
      return a;
    await this.endRoutinePolicyIn(
      c,
      ctx,
      a.workspace_id,
      a.routine_policy_id,
      `The autopilot they were made for ended (${(a.outcome ?? 'finished').replaceAll('_', ' ')}).`,
    );
    const { rows } = await c.query(
      `update autopilots set approvals_ended_at = clock_timestamp()
        where workspace_id = $1 and id = $2 returning *`,
      [a.workspace_id, a.id],
    );
    return toAutopilot(rows[0] as Row);
  }

  /** The owner stops a running autopilot. What it made so far is kept. */
  async cancelAutopilot(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    raw: unknown,
  ): Promise<Autopilot> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    const req = parse(AutopilotControlRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(
        c,
        ws,
        ctx.actorId,
        'Only the workspace owner can stop an autopilot.',
      );
      const cur = await this.#read(c, ws, id, true);
      if (cur.state !== 'running')
        throw fail('INVALID_TRANSITION', 'The autopilot has already finished.');
      const now = new Date().toISOString();
      const steps = cur.steps.map((s) =>
        s.state === 'running'
          ? {
              ...s,
              state: 'stopped' as const,
              note: `${s.note} Stopped by the owner.`.trim().slice(0, 1200),
              finished_at: now,
            }
          : s,
      );
      const { rows } = await c.query(
        `update autopilots set state = 'finished', outcome = 'cancelled', steps = $3,
           explanation = $4, finished_at = clock_timestamp(), version = version + 1,
           updated_at = clock_timestamp()
         where workspace_id = $1 and id = $2 returning *`,
        [
          ws,
          id,
          JSON.stringify(steps),
          `Stopped by the owner${req.reason ? `: ${req.reason}` : '.'} Everything made so far is kept.`.slice(
            0,
            1200,
          ),
        ],
      );
      const next = await this.#endOwnApprovals(
        c,
        ctx,
        toAutopilot(rows[0] as Row),
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'autopilot.finished',
        subjectKind: 'autopilot',
        subjectId: id,
        subjectVersion: next.version,
        contentHash: next.config_hash,
        payload: {
          outcome: 'cancelled',
          stage: next.stage,
          reason: req.reason ?? null,
        },
        relatedIds: [next.run_id],
      });
      return next;
    });
  }

  /**
   * The owner continues an autopilot that stopped for a person, an approval, a limit or a failed
   * step: the stopped step is tried again (a new attempt), and finished steps are kept as they are.
   */
  async retryAutopilot(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    raw: unknown,
  ): Promise<Autopilot> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    const req = parse(AutopilotControlRequestSchema, raw);
    try {
      return await this.tx(async (c) => {
        await this.requireOwner(
          c,
          ws,
          ctx.actorId,
          'Only the workspace owner can continue an autopilot.',
        );
        const cur = await this.#read(c, ws, id, true);
        if (req.expected_version === undefined)
          throw fail('INVALID_CONTRACT', 'Name the version you continue from.');
        return this.#retryIn(c, ctx, ws, cur, req.expected_version, {
          reason: req.reason ?? null,
        });
      });
    } catch (e) {
      if (isPgError(e, '23505', 'autopilots_one_running'))
        throw fail(
          'INVALID_TRANSITION',
          'Another autopilot is running on this run. Wait for it or stop it first.',
        );
      throw e;
    }
  }

  async #retryIn(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    cur: Autopilot,
    expected: number,
    extra: {
      reason: string | null;
      allowed?: string;
      settings_version?: number;
    },
  ): Promise<Autopilot> {
    if (cur.version !== expected)
      throw fail(
        'VERSION_CONFLICT',
        `The autopilot is at version ${cur.version}.`,
      );
    const can = autopilotContinuable(cur);
    if (!can.ok)
      throw fail(
        'INVALID_TRANSITION',
        cur.state === 'running'
          ? 'The autopilot is still running.'
          : can.reason,
      );
    if (Date.parse(cur.config.limits.ends_at) <= Date.now())
      throw fail(
        'EXPIRED',
        "The autopilot's end time has passed; start a new autopilot.",
      );
    await this.lockRun(c, ws, cur.run_id);
    const run = (
      await c.query(
        'select state from run_controls where workspace_id = $1 and run_id = $2',
        [ws, cur.run_id],
      )
    ).rows[0] as Row;
    if (run.state !== 'active')
      throw fail('INVALID_TRANSITION', 'The run is no longer active.');
    await this.checkAutopilotPolicy(c, ws, cur.run_id, cur.config);
    const { rows } = await c.query(
      `update autopilots set state = 'running', outcome = null, finished_at = null,
         explanation = $3, version = version + 1, updated_at = clock_timestamp()
       where workspace_id = $1 and id = $2 returning *`,
      [ws, cur.id, `Continuing at ${cur.stage.replaceAll('_', ' ')}.`],
    );
    const next = toAutopilot(rows[0] as Row);
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'autopilot.continued',
      subjectKind: 'autopilot',
      subjectId: cur.id,
      subjectVersion: next.version,
      contentHash: next.config_hash,
      payload: {
        after: cur.outcome,
        stage: cur.stage,
        reason: extra.reason,
        ...(extra.allowed
          ? { allowed: extra.allowed, settings_version: extra.settings_version }
          : {}),
      },
      relatedIds: [next.run_id],
    });
    return next;
  }

  // ---- ADR-0100: the owner's autopilot settings -------------------------------------------

  /** The workspace's autopilot settings as stored (defaults, version 0, before the first save). */
  protected async readAutopilotSettings(
    c: PoolClient,
    ws: string,
    lock = false,
  ): Promise<{
    values: AutopilotSettingsValues;
    version: number;
    row: Row | null;
  }> {
    const row = (
      await c.query(
        `select * from autopilot_settings where workspace_id = $1${lock ? ' for update' : ''}`,
        [ws],
      )
    ).rows[0] as Row | undefined;
    if (!row)
      return { values: AUTOPILOT_SETTINGS_DEFAULT, version: 0, row: null };
    return {
      // A switch added later reads as off for a row saved before it existed.
      values: AutopilotSettingsValuesSchema.parse({
        ...AUTOPILOT_SETTINGS_DEFAULT,
        ...(row.settings as object),
      }),
      version: Number(row.version),
      row,
    };
  }

  async autopilotSettings(
    ctxIn: CommandContext,
    wsIn: string,
  ): Promise<AutopilotSettings> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const r = await this.readAutopilotSettings(c, ws);
      return {
        workspace_id: ws,
        values: r.values,
        version: r.version,
        updated_by: r.row ? String(r.row.updated_by) : null,
        updated_at: r.row ? iso(r.row.updated_at) : null,
        can_change:
          !ctx.autopilot && (await this.isPolicyOwner(c, ws, ctx.actorId)),
      };
    });
  }

  /** Writes the settings in the caller's transaction (owner checked by the caller). */
  async #writeSettings(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    expected: number,
    values: AutopilotSettingsValues,
    why: string,
  ) {
    const cur = await this.readAutopilotSettings(c, ws, true);
    if (cur.version !== expected)
      throw fail(
        'VERSION_CONFLICT',
        `The autopilot settings are at version ${cur.version}; read them again.`,
      );
    const version = cur.version + 1;
    if (cur.row)
      await c.query(
        `update autopilot_settings set settings = $2, version = $3, updated_by = $4,
           updated_at = clock_timestamp() where workspace_id = $1`,
        [ws, JSON.stringify(values), version, ctx.actorId],
      );
    else
      try {
        await c.query(
          `insert into autopilot_settings (workspace_id, settings, version, updated_by)
           values ($1, $2, 1, $3)`,
          [ws, JSON.stringify(values), ctx.actorId],
        );
      } catch (e) {
        if (isPgError(e, '23505'))
          throw fail(
            'VERSION_CONFLICT',
            'The autopilot settings were just saved elsewhere; read them again.',
          );
        throw e;
      }
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'autopilot_settings.saved',
      subjectKind: 'workspace',
      subjectId: ws,
      subjectVersion: version,
      contentHash: canonicalHash(values),
      payload: {
        before: cur.values,
        after: values,
        why,
      },
      relatedIds: [],
    });
    return version;
  }

  /** The owner saves the workspace's autopilot settings (named version; audited). */
  async saveAutopilotSettings(
    ctxIn: CommandContext,
    wsIn: string,
    raw: unknown,
  ): Promise<AutopilotSettings> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const req = parse(SaveAutopilotSettingsRequestSchema, raw);
    if (ctx.autopilot)
      throw fail(
        'HUMAN_ONLY_DENIED',
        'An autopilot cannot change its own settings.',
      );
    await this.tx(async (c) => {
      await this.requireOwner(
        c,
        ws,
        ctx.actorId,
        'Only the workspace owner can change the autopilot settings.',
      );
      await this.#writeSettings(
        c,
        ctx,
        ws,
        req.expected_version,
        req.values,
        'saved',
      );
    });
    return this.autopilotSettings(ctx, ws);
  }

  /**
   * "Allow this from now on and continue": turns on the setting the stop names and continues the
   * autopilot, in one transaction, so neither happens without the other.
   */
  async allowAndContinueAutopilot(
    ctxIn: CommandContext,
    wsIn: string,
    idIn: string,
    raw: unknown,
  ): Promise<Autopilot> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const id = uuid(idIn);
    const req = parse(AllowAndContinueRequestSchema, raw);
    if (ctx.autopilot)
      throw fail(
        'HUMAN_ONLY_DENIED',
        'An autopilot cannot change its own settings.',
      );
    try {
      return await this.tx(async (c) => {
        await this.requireOwner(
          c,
          ws,
          ctx.actorId,
          'Only the workspace owner can change the autopilot settings.',
        );
        const cur = await this.#read(c, ws, id, true);
        const kind = cur.steps.at(-1)?.stop_kind ?? null;
        const named = kind ? SETTING_FOR_STOP[kind] : undefined;
        if (
          !named ||
          (named !== req.setting &&
            !(
              named === 'gather_evidence' &&
              req.setting === 'max_extra_searches'
            ))
        )
          throw fail(
            'INVALID_CONTRACT',
            'This stop is not one that setting covers; read the autopilot again.',
          );
        if (cur.version !== req.expected_version)
          throw fail(
            'VERSION_CONFLICT',
            `The autopilot is at version ${cur.version}.`,
          );
        const can = autopilotContinuable(cur);
        if (!can.ok) throw fail('INVALID_TRANSITION', can.reason);
        // ADR-0098: the run is locked before anything is appended to the audit log.
        await this.lockRun(c, ws, cur.run_id);
        const before = await this.readAutopilotSettings(c, ws);
        // Re-review 2 L-1: an Allow that changes nothing would only stop here again.
        if (
          before.version === req.settings_version &&
          settingIsOn(before.values, req.setting)
        )
          throw fail(
            'INVALID_TRANSITION',
            `“${AUTOPILOT_SETTING_TEXT[req.setting].label}” is already on; Allow would change nothing.`,
          );
        const version = await this.#writeSettings(
          c,
          ctx,
          ws,
          req.settings_version,
          settingOn(before.values, req.setting),
          `allowed from autopilot ${id} at ${kind}`,
        );
        return this.#retryIn(c, ctx, ws, cur, req.expected_version, {
          reason: null,
          allowed: req.setting,
          settings_version: version,
        });
      });
    } catch (e) {
      if (isPgError(e, '23505', 'autopilots_one_running'))
        throw fail(
          'INVALID_TRANSITION',
          'Another autopilot is running on this run. Wait for it or stop it first.',
        );
      throw e;
    }
  }

  /**
   * ADR-0100 "Gather evidence when it is thin": links recorded claims whose title or statement
   * name an option (or the problem) to it, as a person's "Link claims" suggestions would, for
   * the problem's active options that have no claim linked (or the options named). Each link is
   * asserted by the Autopilot agent with its reason, audited, and can be undone with Unlink.
   */
  async autopilotLinkClaims(
    ctxIn: CommandContext,
    wsIn: string,
    problemIn: string,
    only: readonly string[] | null,
    /**
     * Review 1 L-5: the autopilot's data class. On public or synthetic data it links only claims
     * supported by sources that were all fetched from the web, never one resting on a file, a
     * note, or nothing, that may have been recorded for another project.
     */
    dataClass: string = 'public',
  ): Promise<{ claim_id: string; to_id: string; to_title: string }[]> {
    const ctx = normalize(ctxIn);
    const ws = uuid(wsIn);
    const problemId = uuid(problemIn);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const problem = (
        await c.query(
          `select id, version, title from entities
            where workspace_id = $1 and id = $2 and kind = 'problem' and status = 'active'
            for update`,
          [ws, problemId],
        )
      ).rows[0] as Row | undefined;
      if (!problem) throw fail('NOT_FOUND', 'The problem was not found.');
      const options = (
        await c.query(
          `select a.id, a.version, a.title from entities a
             join entity_links o on o.from_id = a.id and o.to_id = $2
              and o.relation = 'derived_from' and o.retracted_at is null
            where a.workspace_id = $1 and a.kind = 'alternative' and a.status = 'active'
            order by a.created_at, a.id limit 8`,
          [ws, problemId],
        )
      ).rows as Row[];
      const links = (
        await c.query(
          `select from_id, to_id from entity_links
            where workspace_id = $1 and relation in ('supports','contradicts')
              and from_kind = 'claim' and retracted_at is null
              and to_id = any($2::uuid[])`,
          [ws, [problemId, ...options.map((o) => String(o.id))]],
        )
      ).rows as Row[];
      const claims = (
        (
          await c.query(
            `select e.id, e.version, e.title, e.body from entities e
              where e.workspace_id = $1 and e.kind = 'claim' and e.status = 'active'
                and ($2::boolean or (exists (
                  select 1 from claim_support cs where cs.claim_id = e.id
                    and cs.stance = 'supports' and cs.retracted_at is null)
                  and not exists (
                  select 1 from claim_support cs where cs.claim_id = e.id
                    and cs.stance = 'supports' and cs.retracted_at is null
                    and not exists (select 1 from source_retrievals r
                      where r.source_id = cs.source_id and r.state = 'fetched'))))
              order by e.created_at desc, e.id desc limit 500`,
            [ws, dataClass !== 'public' && dataClass !== 'synthetic'],
          )
        ).rows as Row[]
      ).map((r) => ({
        id: String(r.id),
        version: Number(r.version),
        title: String(r.title),
        text: String(
          (r.body as { statement?: string } | null)?.statement ?? '',
        ),
      }));
      const linkedTo = (to: string) =>
        new Set(
          links
            .filter((l) => String(l.to_id) === to)
            .map((l) => String(l.from_id)),
        );
      const wanted = only?.map((x) => x.toLowerCase()) ?? null;
      const targets: {
        id: string;
        version: number;
        title: string;
        kind: 'alternative' | 'problem';
      }[] = [
        ...options
          .filter((o) =>
            wanted
              ? wanted.includes(String(o.id))
              : linkedTo(String(o.id)).size === 0,
          )
          .map((o) => ({
            id: String(o.id),
            version: Number(o.version),
            title: String(o.title),
            kind: 'alternative' as const,
          })),
        ...(!wanted && linkedTo(problemId).size === 0
          ? [
              {
                id: problemId,
                version: Number(problem.version),
                title: String(problem.title),
                kind: 'problem' as const,
              },
            ]
          : []),
      ];
      const made: { claim_id: string; to_id: string; to_title: string }[] = [];
      for (const t of targets) {
        const to = String(t.id);
        // Ranked over every claim (linked ones included), so a repeated call adds only a new
        // strong match, never the next-weakest claim left over.
        const already = linkedTo(to);
        const picks = suggestClaims(
          { title: t.title },
          claims,
          new Set(),
          3,
        ).filter((c) => !already.has(c.id));
        for (const claim of picks) {
          const linkId = randomUUID();
          const ins = await c.query(
            `insert into entity_links (id, workspace_id, relation, from_id, from_kind,
               from_version, to_id, to_kind, to_version, rationale, asserted_by)
             values ($1,$2,'supports',$3,'claim',$4,$5,$6,$7,$8,$9) on conflict do nothing`,
            [
              linkId,
              ws,
              claim.id,
              claim.version,
              to,
              t.kind,
              Number(t.version),
              `Its title or statement names this ${t.kind === 'problem' ? 'problem' : 'option'}; linked by an autopilot under the owner's setting “Gather evidence when it is thin” (ADR-0100). Unlink it if it is not evidence about this.`,
              recordedActor(ctx),
            ],
          );
          if (!ins.rowCount) continue;
          await this.append(c, ctx, {
            workspaceId: ws,
            action: 'link.created',
            subjectKind: 'link',
            subjectId: linkId,
            subjectVersion: null,
            contentHash: null,
            payload: {
              relation: 'supports',
              from_kind: 'claim',
              from_version: claim.version,
              to_kind: t.kind,
              to_version: Number(t.version),
              suggested: true,
            },
            relatedIds: [claim.id, to],
          });
          made.push({
            claim_id: claim.id,
            to_id: to,
            to_title: String(t.title),
          });
        }
      }
      return made;
    });
  }

  /** Autopilots a stopped studio left running, for the runner to pick up after a restart. */
  async runningAutopilots(): Promise<
    { workspace_id: string; id: string; created_by: string }[]
  > {
    const { rows } = await this.pool.query(
      `select workspace_id, id, created_by from autopilots where state = 'running'
        order by created_at limit 100`,
    );
    return (rows as Row[]).map((r) => ({
      workspace_id: String(r.workspace_id),
      id: String(r.id),
      created_by: String(r.created_by),
    }));
  }
}
