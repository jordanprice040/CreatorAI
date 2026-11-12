import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AUTOPILOT_MAX_STEPS,
  AUTOPILOT_POLICY_VERSION,
  autopilotContinuable,
  AutopilotConfigSchema,
  AutopilotControlRequestSchema,
  AutopilotStepSchema,
  ROUTINE_STAGE_ACTIONS,
  routineStopFix,
  StartAutopilotRequestSchema,
  autopilotStagesNeeded,
  autopilotSummary,
  parse,
  z,
  type Autopilot,
  type AutopilotOutcome,
  type AutopilotStage,
  type AutopilotStep,
  type RoutinePolicyChange,
} from '@creator/contracts';
import { canonicalHash, nextAutopilotStage } from '@creator/domain';
import { WebDiscoveryStore } from './web-discovery-store.js';
import { routineStopReason } from './routine-stops.js';
import {
  fail,
  iso,
  isPgError,
  normalize,
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
          await this.applyRoutinePolicyChange(
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
               policy_version, state, stage, explanation, version, created_by)
             select $1, w.id, $3, w.fixture, $4, $5, $6, $7, 'running', $8, $9, 1, $10
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
    if (!change) return;
    if (change.kind === 'new') {
      await this.setRoutinePolicyIn(
        c,
        ctx,
        ws,
        runId,
        this.checkRoutineInput(change.policy),
      );
      return;
    }
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
          (patch.explanation ?? cur.explanation).slice(0, 1200),
          finished ? 'finished' : 'running',
          finished ? patch.outcome : null,
          finished ? new Date().toISOString() : null,
        ],
      );
      const next = toAutopilot(rows[0] as Row);
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
      const next = toAutopilot(rows[0] as Row);
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
        if (cur.version !== req.expected_version)
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
          [ws, id, `Continuing at ${cur.stage.replaceAll('_', ' ')}.`],
        );
        const next = toAutopilot(rows[0] as Row);
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'autopilot.continued',
          subjectKind: 'autopilot',
          subjectId: id,
          subjectVersion: next.version,
          contentHash: next.config_hash,
          payload: {
            after: cur.outcome,
            stage: cur.stage,
            reason: req.reason ?? null,
          },
          relatedIds: [next.run_id],
        });
        return next;
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
