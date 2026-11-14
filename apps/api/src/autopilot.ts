import { createHash } from 'node:crypto';
import {
  AUTOPILOT_STAGE_LABEL,
  ContractError,
  ExplorationResultSchema,
  WebDiscoveryScopeSchema,
  MODEL_ONLY_ETHICS_NOTE,
  autopilotNextSteps,
  type Autopilot,
  type AutopilotFallback,
  type AutopilotSettings,
  type AutopilotStopKind,
  type AutopilotOutcome,
  type AutopilotStage,
  type AutopilotStep,
  type ErrorCode,
  type WebDiscovery,
  type Workflow,
} from '@creator/contracts';
import {
  autopilotChildLimits,
  autopilotChoice,
  autopilotProblem,
  carried,
  notAdmitted,
  nextAutopilotStage,
  personChoice,
  pickExplored,
  refusalOutcome,
} from '@creator/domain';
import type { CommandContext, ConnectionStore } from '@creator/db';
import type { WebDiscoveryRunner } from './web-discovery.js';

/** What the research step needs of web discovery (P12); tests pass a stand-in. */
export interface AutopilotWeb {
  start(
    ctx: CommandContext,
    ws: string,
    runId: string,
    body: unknown,
  ): Promise<{ id: string }>;
  read(ctx: CommandContext, ws: string, id: string): Promise<WebDiscovery>;
  isActive(id: string): boolean;
  resume(ctx: CommandContext, ws: string, id: string): Promise<unknown>;
  cancel(
    ctx: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ): Promise<unknown>;
}
export function webResearch(
  runner: WebDiscoveryRunner,
  store: ConnectionStore,
): AutopilotWeb {
  return {
    start: (ctx, ws, runId, body) => runner.start(ctx, ws, runId, body),
    read: (ctx, ws, id) => store.getWebDiscovery(ctx, ws, id),
    isActive: (id) => runner.isActive(id),
    resume: (ctx, ws, id) => runner.resume(ctx, ws, id),
    cancel: (ctx, ws, id, body) => runner.cancel(ctx, ws, id, body),
  };
}

// ADR-0092 (P13): drives one autopilot through the run's main path in this studio process. Each
// step records its exact request and idempotency key before it is sent, starts the same server
// operation the forms use (admitted there, by the run's routine approvals), waits for the
// durable workflow it started, and then chooses the next step by fixed rules. A step that needs
// a person, an approval or more budget stops the autopilot with that reason; Continue tries the
// stopped step again. A restart picks up a running autopilot where it was: a repeated start
// returns what the first one made.

const TERMINAL = new Set(['succeeded', 'failed', 'cancelled']);

const said = (e: unknown) =>
  e instanceof ContractError
    ? [e.message, ...e.details].join(' ').slice(0, 1000)
    : e instanceof Error
      ? e.message.slice(0, 300)
      : 'The step failed.';
const codeOf = (e: unknown): ErrorCode | null =>
  e instanceof ContractError ? e.code : null;

/** ADR-0100: the kind of stop a refused step made, from the refusal's code and words. */
export function refusalKind(e: unknown): AutopilotStopKind {
  const text = said(e).toLowerCase();
  if (text.includes('per-run request cap')) return 'run_cap';
  if (text.includes('daily') && text.includes('cap')) return 'daily_cap';
  const code = codeOf(e);
  if (code === 'BUDGET_EXCEEDED' || code === 'LIMIT_EXCEEDED')
    return 'call_limit';
  if (code === 'EXPIRED') return 'end_time';
  const outcome = refusalOutcome(code);
  if (outcome === 'needs_authority') return 'approval';
  if (outcome === 'failed') return 'failed_step';
  return 'other';
}

/** A stable idempotency key per autopilot step attempt. */
export function autopilotKey(
  id: string,
  stage: AutopilotStage,
  attempt: number,
) {
  const h = createHash('sha256')
    .update(`autopilot:${id.toLowerCase()}:${stage}:${attempt}`)
    .digest('hex')
    .slice(0, 32);
  return `autopilot:${h}`;
}

/** `final`: Continue cannot get past this stop; why, and what to do instead (review L-3). */
type Stop = {
  outcome: AutopilotOutcome;
  note: string;
  final?: string;
  /** The question the stop left open for a person, if any. */
  asked?: string;
  /** ADR-0100: what kind of stop, for the matching setting and next steps. */
  kind?: AutopilotStopKind;
};
/**
 * ADR-0100: a planned fallback the owner's settings allow instead of a stop. `retry` tries the
 * same step again (a new attempt), `skip` passes over it, `gather` adds a step that links
 * claims and may search the web, then goes back to `request.then`.
 */
type Fallback = {
  fallback: AutopilotFallback;
  then:
    | { kind: 'retry' }
    | { kind: 'skip' }
    | { kind: 'gather'; request: GatherRequest };
  child?: AutopilotStep['child'];
};
type GatherRequest = {
  then: 'explore' | 'brief' | 'assess' | 'select';
  reason: string;
  /** Link suggested claims for this problem (its options with none, or those named). */
  problem_id: string | null;
  options: string[] | null;
  /** The web search question, or null for links only. */
  question: string | null;
  /** Filled in when the step finishes: claims linked or added. */
  added?: number;
};
type Done = {
  note: string;
  problem?: AutopilotStep['problem'];
  option?: AutopilotStep['option'];
  child?: AutopilotStep['child'];
  /** Ends the autopilot after this step (the path's last step). */
  outcome?: AutopilotOutcome;
  /** Replaces the step's recorded request (a gather step records what it added). */
  request?: Record<string, unknown>;
  /** The owner's settings that let the step go on instead of stopping. */
  fallback?: AutopilotFallback;
};
type Result = { stop: Stop } | { done: Done } | { redo: Fallback };

const stopOf = (l: {
  outcome: AutopilotOutcome;
  reason: string;
  final?: string;
  kind?: AutopilotStopKind;
}): Stop => ({
  outcome: l.outcome,
  note: l.reason,
  ...(l.final ? { final: l.final } : {}),
  ...(l.kind ? { kind: l.kind } : {}),
});

export interface AutopilotRunnerOptions {
  /** How often a running workflow is read again. */
  pollMs?: number;
  /** Called on every wait (tests use it to run the workflow worker). */
  onWait?: () => Promise<unknown>;
  /** How often `watch` looks for running autopilots no driver holds (review L-7). */
  recoverMs?: number;
}

export class AutopilotRunner {
  readonly #live = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >();
  readonly #pollMs: number;
  readonly #onWait: (() => Promise<unknown>) | null;
  readonly #recoverMs: number;
  #watch: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: ConnectionStore,
    private readonly web: AutopilotWeb | null,
    options: AutopilotRunnerOptions = {},
  ) {
    this.#pollMs = options.pollMs ?? 2000;
    this.#onWait = options.onWait ?? null;
    this.#recoverMs = options.recoverMs ?? 60_000;
  }

  isActive(id: string) {
    return this.#live.has(id.toLowerCase());
  }
  with(a: Autopilot): Autopilot {
    return { ...a, active: this.isActive(a.id), next: autopilotNextSteps(a) };
  }

  async allowAndContinue(
    ctx: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    const a = await this.store.allowAndContinueAutopilot(ctx, ws, id, body);
    this.#launch(a.created_by, ws, a.id);
    return this.with(a);
  }
  /** Resolves when this autopilot's driver has stopped (tests and shutdown). */
  async settled(id: string) {
    await this.#live.get(id.toLowerCase())?.done;
  }
  /** Stops every driver in this process without changing records (shutdown). */
  async close() {
    if (this.#watch) clearInterval(this.#watch);
    this.#watch = null;
    for (const { abort } of this.#live.values())
      abort.abort(new Error('closing'));
    await Promise.all([...this.#live.values()].map((l) => l.done));
  }

  async start(ctx: CommandContext, ws: string, runId: string, body: unknown) {
    const a = await this.store.startAutopilot(ctx, ws, runId, body);
    this.#launch(a.created_by, ws, a.id);
    return this.with(a);
  }

  async retry(ctx: CommandContext, ws: string, id: string, body: unknown) {
    const a = await this.store.retryAutopilot(ctx, ws, id, body);
    this.#launch(a.created_by, ws, a.id);
    return this.with(a);
  }

  async cancel(ctx: CommandContext, ws: string, id: string, body: unknown) {
    const a = await this.store.cancelAutopilot(ctx, ws, id, body);
    this.#live.get(a.id)?.abort.abort(new Error('cancelled'));
    // Stop the step's own work too; what it made so far stays.
    await this.#cancelChild(
      ctx,
      ws,
      a.steps.at(-1)?.child,
      'The autopilot was stopped.',
    );
    return this.with(a);
  }

  /** Cancels a step's running workflow or web discovery; finished ones are left as they are. */
  async #cancelChild(
    ctx: CommandContext,
    ws: string,
    child: AutopilotStep['child'] | undefined,
    reason: string,
  ) {
    if (child?.kind === 'workflow')
      await this.#cancelWorkflow(ctx, ws, child.id, reason);
    if (child?.kind === 'web_discovery' && this.web)
      await this.web
        .read(ctx, ws, child.id)
        .then((d) =>
          ['searching', 'fetching', 'reading'].includes(d.state)
            ? this.web!.cancel(ctx, ws, d.id, {
                expected_version: d.version,
                reason,
              })
            : null,
        )
        .catch(() => null);
  }

  /** Picks up autopilots a stopped studio left running. */
  async recover() {
    for (const r of await this.store.runningAutopilots())
      this.#launch(r.created_by, r.workspace_id, r.id);
  }

  /**
   * Recovers now and then again every `recoverMs`, so an autopilot whose driver stopped on an
   * error it could not even record (a database blip) is picked up without a restart (review L-7).
   */
  watch() {
    const tick = () =>
      void this.recover()
        .then(() => this.automate())
        .catch(() => undefined);
    tick();
    if (this.#watch) return;
    this.#watch = setInterval(tick, this.#recoverMs);
    this.#watch.unref?.();
  }

  /**
   * ADR-0099 (P33): starts a selection autopilot for each assessment an active "Automate
   * selection" level has not acted on yet (the store checks the owner, run and policy again),
   * and drives it. Runs with `watch`, and once after the owner sets a level.
   */
  async automate() {
    // A call during a pass asks for one more pass after it, so nothing waits a minute (N-4).
    if (this.#automating) {
      this.#again = true;
      return;
    }
    this.#automating = true;
    try {
      do {
        this.#again = false;
        for (const due of await this.store.dueAutomations()) {
          const started = await this.store
            .startAutomationAutopilot(due)
            .catch(() => null);
          if (started)
            this.#launch(started.created_by, due.workspace_id, started.id);
        }
      } while (this.#again);
    } finally {
      this.#automating = false;
    }
  }
  #automating = false;
  #again = false;

  #launch(actorId: string, ws: string, id: string) {
    const key = id.toLowerCase();
    if (this.#live.has(key)) return;
    const abort = new AbortController();
    // The owner's authority, recorded as the autopilot's step (ADR-0092, review H-1).
    const ctx: CommandContext = { actorId, autopilot: { id: key } };
    const done = this.#drive(ctx, ws, key, abort.signal)
      .catch(async (e: unknown) => {
        if (abort.signal.aborted) return;
        const a = await this.store.getAutopilot(ctx, ws, key).catch(() => null);
        if (a?.state === 'running')
          await this.#finish(ctx, ws, a, {
            outcome: 'failed',
            note: `The ${AUTOPILOT_STAGE_LABEL[a.stage].toLowerCase()} step stopped: ${said(e)}`,
          }).catch(() => null);
      })
      .finally(() => this.#live.delete(key));
    this.#live.set(key, { abort, done });
  }

  async #drive(
    ctx: CommandContext,
    ws: string,
    id: string,
    signal: AbortSignal,
  ) {
    for (;;) {
      if (signal.aborted) return;
      const a = await this.store.getAutopilot(ctx, ws, id);
      if (a.state !== 'running') return;
      const last = a.steps.at(-1);
      let step: AutopilotStep;
      let current: Autopilot | null = a;
      if (last && last.state === 'running') step = last;
      else {
        // A stopped last step is the one Continue tries again; otherwise the next step.
        const stage =
          last && last.state === 'stopped'
            ? last.stage
            : nextAutopilotStage(a.config, a.steps);
        if (!stage) {
          await this.#finish(ctx, ws, a, {
            outcome: 'failed',
            note: 'The autopilot had no step left to take.',
          });
          return;
        }
        current = await this.#begin(ctx, ws, a, stage, last);
        if (!current) continue;
        step = current.steps.at(-1)!;
        if (step.state !== 'running') continue;
      }
      if (Date.parse(current.config.limits.ends_at) <= Date.now()) {
        // The step's own work stops too (review L-2).
        await this.#cancelChild(
          ctx,
          ws,
          step.child,
          "The autopilot's end time passed.",
        );
        await this.#finish(ctx, ws, current, {
          outcome: 'limit_reached',
          kind: 'end_time',
          note: "The autopilot's end time passed; the step's work was stopped and what it made is kept.",
        });
        return;
      }
      const r = await this.#run(ctx, ws, current, step, signal);
      if (signal.aborted) return;
      const fresh = await this.store.getAutopilot(ctx, ws, id);
      if (fresh.state !== 'running') return;
      if ('stop' in r) {
        await this.#finish(ctx, ws, fresh, r.stop);
        return;
      }
      if ('redo' in r) {
        await this.#redo(ctx, ws, fresh, r.redo);
        continue;
      }
      const done = r.done;
      const now = new Date().toISOString();
      const steps = fresh.steps.map((s, i) =>
        i === fresh.steps.length - 1
          ? {
              ...s,
              state: 'done' as const,
              note: done.note.slice(0, 1200),
              child: done.child ?? s.child,
              problem: done.problem ?? s.problem,
              option: done.option ?? s.option,
              ...(done.request ? { request: done.request } : {}),
              ...(done.fallback ? { fallback: done.fallback } : {}),
              finished_at: now,
            }
          : s,
      );
      const next = nextAutopilotStage(fresh.config, steps);
      await this.store.advanceAutopilot(ctx, ws, id, fresh.version, {
        steps,
        stage: done.outcome ? fresh.stage : (next ?? fresh.stage),
        explanation: done.note,
        ...(done.outcome ? { outcome: done.outcome } : {}),
      });
      if (done.outcome) return;
    }
  }

  /**
   * Records a new step with its exact request, key and the calls it sets aside, before anything
   * is sent. A retry whose earlier attempt left a workflow still working or finished carries it on.
   */
  async #begin(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
    stage: AutopilotStage,
    previous: AutopilotStep | undefined,
  ): Promise<Autopilot | null> {
    // Every attempt of a stage gets its own key, also after a fallback went back to it (a
    // repeated key would return the first attempt's workflow).
    const attempt = a.steps.filter((s) => s.stage === stage).length + 1;
    const now = new Date().toISOString();
    const base: AutopilotStep = {
      stage,
      attempt,
      state: 'running',
      child: null,
      calls: 0,
      problem: null,
      option: null,
      request: null,
      key: autopilotKey(a.id, stage, attempt),
      note: `${AUTOPILOT_STAGE_LABEL[stage]}.`,
      started_at: now,
      finished_at: null,
    };
    // Carry on the earlier attempt's workflow when it was not refused or failed.
    if (previous?.stage === stage && previous.child?.kind === 'workflow') {
      const wf = await this.store
        .getWorkflow(ctx, ws, previous.child.id)
        .catch(() => null);
      if (
        wf &&
        wf.workflow.state !== 'failed' &&
        wf.workflow.state !== 'cancelled'
      )
        return this.store.advanceAutopilot(ctx, ws, a.id, a.version, {
          stage,
          steps: [
            ...a.steps,
            {
              ...base,
              child: previous.child,
              problem: previous.problem,
              request: previous.request,
              key: previous.key,
              note: 'Carrying on with the workflow the earlier attempt started.',
            },
          ],
          explanation: `${AUTOPILOT_STAGE_LABEL[stage]}: carrying on.`,
        });
    }
    let planned:
      | {
          request: Record<string, unknown> | null;
          calls: number;
          problem?: AutopilotStep['problem'];
        }
      | Stop;
    try {
      planned = await this.#plan(ctx, ws, a, stage);
    } catch (e) {
      planned = {
        outcome: refusalOutcome(codeOf(e)),
        kind: refusalKind(e),
        note: said(e),
      };
    }
    if ('outcome' in planned) {
      return this.store.advanceAutopilot(ctx, ws, a.id, a.version, {
        stage,
        steps: [
          ...a.steps,
          {
            ...base,
            state: 'stopped',
            note: planned.note.slice(0, 1200),
            no_retry: planned.final ?? null,
            stop_kind: planned.kind ?? null,
            finished_at: now,
          },
        ],
        explanation: planned.note,
        outcome: planned.outcome,
      });
    }
    return this.store.advanceAutopilot(ctx, ws, a.id, a.version, {
      stage,
      steps: [
        ...a.steps,
        {
          ...base,
          request: planned.request,
          calls: planned.calls,
          problem: planned.problem ?? null,
        },
      ],
      calls_reserved: a.calls_reserved + planned.calls,
      explanation: `${AUTOPILOT_STAGE_LABEL[stage]}.`,
    });
  }

  async #routeCaps(ctx: CommandContext, ws: string, a: Autopilot) {
    const r = a.config.resource_setup;
    if (r.kind !== 'subscription')
      return { timeout_ms: null, per_run: null, per_run_used: 0 };
    const caps = (
      await this.store.planConnectionDetail(ctx, ws, r.connection_id)
    ).connection.settings.caps.responses;
    // ADR-0100 (live run 2): the per-run cap counts the whole run, so size from what is left.
    const room = await this.store.planRunRoom(
      ctx,
      ws,
      r.connection_id,
      a.run_id,
    );
    return {
      timeout_ms: caps.request_timeout_ms,
      per_run: caps.max_requests_per_run,
      per_run_used: room.used,
    };
  }

  /** ADR-0100: plan requests left on this run for a web search's 2 requests, or why not. */
  async #searchRoom(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
    connectionId: string,
  ): Promise<Stop | null> {
    // A connection that cannot be read is refused by the search's own admission instead.
    const room = await this.store
      .planRunRoom(ctx, ws, connectionId, a.run_id)
      .catch(() => null);
    if (!room) return null;
    if (room.per_run - room.used < 2)
      return {
        outcome: 'limit_reached',
        kind: 'run_cap',
        note: `Searching the web needs 2 plan requests; this run has used ${room.used} of the plan connection's ${room.per_run} requests per run. Raise the per-run cap under Models and connections › Change caps, accept it, then continue.`,
      };
    if (room.daily_left < 2)
      return {
        outcome: 'limit_reached',
        kind: 'daily_cap',
        note: `Searching the web needs 2 plan requests; the connection's daily cap leaves ${room.daily_left}. Add 20 requests (Models and connections) or wait, then continue.`,
      };
    return null;
  }

  /** The exact request of a step, from the records the earlier steps made. */
  async #plan(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
    stage: AutopilotStage,
  ): Promise<
    | {
        request: Record<string, unknown> | null;
        calls: number;
        problem?: AutopilotStep['problem'];
      }
    | Stop
  > {
    const c = a.config;
    const remaining = c.limits.max_calls - a.calls_reserved;
    const seconds_left = (Date.parse(c.limits.ends_at) - Date.now()) / 1000;
    const limitsFor = async (
      s: 'explore' | 'discover' | 'assess',
      width: number,
    ) =>
      autopilotChildLimits({
        stage: s,
        route: c.resource_setup.kind,
        ...(await this.#routeCaps(ctx, ws, a)),
        remaining,
        seconds_left,
        width,
      });
    switch (stage) {
      case 'research': {
        if (!c.research) return { request: null, calls: 0 };
        if (remaining < 2)
          return {
            outcome: 'limit_reached',
            kind: 'call_limit',
            note: `Searching the web needs 2 plan requests; the autopilot has ${remaining} left.`,
            final:
              'Its call limit is used up and cannot be raised; start a new autopilot with a higher limit.',
          };
        const capped = await this.#searchRoom(
          ctx,
          ws,
          a,
          c.research.connection_id,
        );
        if (capped) return capped;
        return {
          calls: 2,
          request: {
            connection_id: c.research.connection_id,
            model_id: c.research.model_id,
            scope: c.research.scope,
            input_hash: c.research.input_hash,
          },
        };
      }
      case 'explore': {
        const l = await limitsFor('explore', 1);
        if (!l.ok) return stopOf(l);
        return {
          calls: l.calls,
          request: {
            scope: c.explore,
            resource_setup: c.resource_setup,
            data_class: c.data_class,
            limits: l.limits,
          },
        };
      }
      case 'brief':
        return { request: null, calls: 0 };
      case 'discover': {
        const brief = carried(a.steps, 'brief');
        const ex = carried(a.steps, 'explore');
        if (!brief?.child || !ex?.child)
          return {
            outcome: 'failed',
            note: 'The brief to discover from is missing.',
          };
        const picked = (brief.request?.claims as string[] | undefined) ?? [];
        const l = await limitsFor('discover', c.perspectives.length);
        if (!l.ok) return stopOf(l);
        return {
          calls: l.calls,
          request: {
            brief: {
              id: brief.child.id,
              version: Number(brief.request?.brief_version ?? 1),
            },
            evidence: picked.slice(0, 30).map((claim_id) => ({
              claim_id,
              bears_on: c.evidence_roles,
            })),
            perspectives: c.perspectives,
            excluded: c.excluded,
            max_revisions: c.max_revisions,
            max_age_days: c.explore.max_age_days,
            resource_setup: c.resource_setup,
            data_class: c.data_class,
            limits: l.limits,
          },
        };
      }
      case 'assess': {
        const problem = autopilotProblem(c, a.steps);
        if (!problem)
          return {
            outcome: 'failed',
            note: 'The problem to assess is missing.',
          };
        const found = { problem };
        const preview = await this.store.previewAssessment(
          ctx,
          ws,
          found.problem.id,
          c.resource_setup.kind === 'subscription'
            ? c.resource_setup.connection_id
            : null,
        );
        if (preview.packet.problem.version !== found.problem.version) {
          // ADR-0100 "try the next candidate": assess the problem as it is now.
          if (!(await this.#settings(ctx, ws)).values.next_candidate)
            return {
              outcome: 'needs_person',
              kind: 'other',
              note: 'The problem changed after it was found; assess it by hand or start a new autopilot.',
            };
          found.problem = {
            id: found.problem.id,
            version: preview.packet.problem.version,
          };
        }
        const l = await limitsFor('assess', preview.requests);
        if (!l.ok) return stopOf(l);
        return {
          calls: l.calls,
          problem: found.problem,
          request: {
            problem: found.problem,
            resource_setup: c.resource_setup,
            data_class: c.data_class,
            limits: l.limits,
            preview_hash: preview.preview_hash,
          },
        };
      }
      case 'gather': {
        // Continue after a stopped gather step tries the same gathering again.
        const last = a.steps.at(-1);
        const request =
          last?.stage === 'gather' ? (last.request as GatherRequest) : null;
        if (!request)
          return { outcome: 'failed', note: 'The fallback step is missing.' };
        const { added: _, ...again } = request;
        return {
          request: again,
          calls: again.question ? Math.min(2, Math.max(0, remaining)) : 0,
        };
      }
      default:
        return { request: null, calls: 0 };
    }
  }

  /** ADR-0100: the owner's autopilot settings as they are now. */
  async #settings(ctx: CommandContext, ws: string): Promise<AutopilotSettings> {
    return this.store.autopilotSettings(ctx, ws);
  }

  /** The fallback record a step keeps (the setting, its version, the stop it replaced). */
  #fb(
    settings: AutopilotSettings,
    setting: AutopilotFallback['setting'],
    instead_of: AutopilotStopKind,
    note: string,
  ): AutopilotFallback {
    return {
      setting,
      settings_version: settings.version,
      instead_of,
      note: note.slice(0, 600),
    };
  }

  /** Failed attempts of this stage so far (each a stopped step that failed). */
  #failures(a: Autopilot, stage: AutopilotStage) {
    return a.steps.filter(
      (s) =>
        s.stage === stage &&
        s.state === 'stopped' &&
        s.fallback?.instead_of === 'failed_step',
    ).length;
  }

  /** ADR-0100: a failed step is tried again when the owner allows retries and some are left. */
  async #retryOr(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
    step: AutopilotStep,
    stop: Stop,
  ): Promise<Result> {
    if (stop.outcome !== 'failed') return { stop };
    const settings = await this.#settings(ctx, ws);
    if (this.#failures(a, step.stage) >= settings.values.retry_failed)
      return { stop: { ...stop, kind: stop.kind ?? 'failed_step' } };
    return {
      redo: {
        fallback: this.#fb(
          settings,
          'retry_failed',
          'failed_step',
          `${stop.note} Trying the step again (the owner's setting “retry a failed step”).`,
        ),
        then: { kind: 'retry' },
      },
    };
  }

  /**
   * ADR-0100: the web search a gather step may run, or why not: the setting, the searches left,
   * a plan connection to search on, public or synthetic data, and the calls left.
   */
  #searchRoute(
    a: Autopilot,
    settings: AutopilotSettings,
  ): { connection_id: string; model_id: string } | string {
    const v = settings.values;
    if (!v.gather_evidence) return 'Gathering evidence is off.';
    const used = a.steps.filter(
      (s) =>
        s.stage === 'gather' && s.state !== 'stopped' && s.request?.question,
    ).length;
    if (used >= v.max_extra_searches)
      return `It has used ${used} of the ${v.max_extra_searches} extra web search${v.max_extra_searches === 1 ? '' : 'es'} the settings allow.`;
    if (!this.web) return 'Web search is not running in this studio.';
    if (a.config.data_class !== 'public' && a.config.data_class !== 'synthetic')
      return 'Web search reads public pages; this autopilot works on other data.';
    if (a.config.limits.max_calls - a.calls_reserved < 2)
      return 'Its call limit leaves fewer than the 2 requests a search takes.';
    const r = a.config.research;
    if (r) return { connection_id: r.connection_id, model_id: r.model_id };
    const s = a.config.resource_setup;
    if (s.kind === 'subscription')
      return { connection_id: s.connection_id, model_id: s.model_id };
    return 'Web search runs only on a ChatGPT plan connection, and this autopilot uses another route.';
  }

  /** Gather rounds already taken for this target, and whether the last one added anything. */
  #gathered(a: Autopilot, then: GatherRequest['then'][]) {
    const rounds = a.steps.filter(
      (s) =>
        s.stage === 'gather' &&
        s.state === 'done' &&
        then.includes((s.request as GatherRequest | null)?.then ?? 'explore'),
    );
    const last = rounds.at(-1)?.request as GatherRequest | undefined;
    return { rounds: rounds.length, lastAdded: last?.added ?? null };
  }

  async #run(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
    step: AutopilotStep,
    signal: AbortSignal,
  ): Promise<Result> {
    const keyed: CommandContext = step.key
      ? { ...ctx, idempotencyKey: step.key }
      : ctx;
    try {
      switch (step.stage) {
        case 'research':
          return await this.#research(ctx, keyed, ws, a, step, signal);
        case 'explore':
        case 'discover':
        case 'assess':
          return await this.#workflowStep(ctx, keyed, ws, a, step, signal);
        case 'brief':
          return await this.#brief(ctx, ws, a);
        case 'select':
          return await this.#select(ctx, keyed, ws, a);
        case 'gather':
          return await this.#gather(ctx, keyed, ws, a, step, signal);
        case 'proposal':
          return await this.#proposal(ctx, keyed, ws, a);
        case 'spec': {
          const sel = carried(a.steps, 'select');
          return {
            stop: {
              outcome: 'needs_person',
              kind: 'spec',
              note: `“${sel?.option?.title ?? 'The option'}” was selected for a bounded build. Writing and freezing its spec stays with you for now (Build › Spec); the autopilot does not write specs.`,
              final:
                'Writing and freezing the spec stays with you (Build › Spec); Continue cannot do it.',
            },
          };
        }
      }
    } catch (e) {
      const stop: Stop = {
        outcome: refusalOutcome(codeOf(e)),
        kind: refusalKind(e),
        note: `${AUTOPILOT_STAGE_LABEL[step.stage]} was refused: ${said(e)}`,
      };
      return this.#retryOr(ctx, ws, a, step, stop).catch(() => ({ stop }));
    }
  }

  async #record(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
    child: NonNullable<AutopilotStep['child']>,
  ) {
    const cur = await this.store.getAutopilot(ctx, ws, a.id);
    if (cur.state !== 'running') return null;
    return this.store.advanceAutopilot(ctx, ws, a.id, cur.version, {
      steps: cur.steps.map((s, i) =>
        i === cur.steps.length - 1 ? { ...s, child } : s,
      ),
    });
  }

  async #research(
    ctx: CommandContext,
    keyed: CommandContext,
    ws: string,
    a: Autopilot,
    step: AutopilotStep,
    signal: AbortSignal,
  ): Promise<Result> {
    if (!step.request) return { done: { note: 'No web search asked for.' } };
    const r = await this.#search(ctx, keyed, ws, a, step, step.request, signal);
    if ('stop' in r) {
      if (r.stop.outcome === 'cancelled' || r.stop.kind === 'end_time')
        return r;
      // ADR-0100: a search that cannot run or keeps failing is skipped (the owner's "try the
      // next candidate"): the autopilot explores the claims already recorded instead.
      if (r.stop.outcome === 'failed') {
        const retried = await this.#retryOr(ctx, ws, a, step, r.stop);
        if ('redo' in retried) return retried;
      }
      const settings = await this.#settings(ctx, ws);
      if (
        settings.values.next_candidate &&
        (r.stop.outcome === 'failed' || r.stop.kind === 'other')
      )
        return {
          redo: {
            fallback: this.#fb(
              settings,
              'next_candidate',
              r.stop.kind ?? 'failed_step',
              `${r.stop.note} Skipped the web search and explored the recorded claims instead.`,
            ),
            then: { kind: 'skip' },
          },
        };
      return r;
    }
    const d = r.d;
    const admitted = d.proposals.filter(
      (p) => p.decision === 'admitted',
    ).length;
    const pending = d.proposals.filter(
      (p) => p.check === 'verified' && p.decision === 'pending',
    ).length;
    return {
      done: {
        child: { kind: 'web_discovery', id: d.id },
        note: `${d.explanation} ${admitted} claim${admitted === 1 ? '' : 's'} added by the run's routine approvals${pending ? `; ${pending} checked claim${pending === 1 ? '' : 's'} wait for you under Discover › Search the web` : ''}.`.slice(
          0,
          1200,
        ),
      },
    };
  }

  /** Starts (or finds) a step's web discovery and waits for it to finish. */
  async #search(
    ctx: CommandContext,
    keyed: CommandContext,
    ws: string,
    a: Autopilot,
    step: AutopilotStep,
    request: Record<string, unknown>,
    signal: AbortSignal,
  ): Promise<{ stop: Stop } | { d: WebDiscovery }> {
    if (!this.web)
      return {
        stop: {
          outcome: 'needs_authority',
          kind: 'other',
          note: 'Web search needs the plan connection service and the source fetcher, which this studio is not running.',
        },
      };
    let id = step.child?.kind === 'web_discovery' ? step.child.id : undefined;
    if (!id) {
      const d = await this.web.start(keyed, ws, a.run_id, request);
      id = d.id;
      const child = { kind: 'web_discovery' as const, id };
      if (!(await this.#record(ctx, ws, a, child))) {
        // Stopped between the start and the record: stop what was just started (review L-1).
        await this.#cancelChild(ctx, ws, child, 'The autopilot was stopped.');
        return { stop: { outcome: 'cancelled', note: 'Stopped.' } };
      }
    }
    for (;;) {
      const d = await this.web.read(ctx, ws, id);
      if (['searching', 'fetching', 'reading'].includes(d.state)) {
        // A discovery a stopped studio left: resume it (a request already out is not repeated).
        if (!this.web.isActive(d.id)) await this.web.resume(ctx, ws, d.id);
        if (!(await this.#wait(signal, a))) {
          if (!signal.aborted)
            await this.#cancelChild(
              ctx,
              ws,
              { kind: 'web_discovery', id },
              "The autopilot's end time passed.",
            );
          return this.#late(a) as { stop: Stop };
        }
        continue;
      }
      if (d.state === 'done') return { d };
      return {
        stop: {
          outcome: d.state === 'cancelled' ? 'cancelled' : 'failed',
          note: `The web search ended ${d.state}: ${d.explanation}`.slice(
            0,
            1200,
          ),
        },
      };
    }
  }

  /**
   * ADR-0100: a fallback that gathers evidence. It links recorded claims that name the problem's
   * options (or the problem), runs one web search when the request asks for one, links again
   * with the claims that search added, and records how many it added. With nothing added, a
   * return to explore stops (exploring again would find the same), and a return to assess goes
   * straight on to choosing (the settings then decide).
   */
  async #gather(
    ctx: CommandContext,
    keyed: CommandContext,
    ws: string,
    a: Autopilot,
    step: AutopilotStep,
    signal: AbortSignal,
  ): Promise<Result> {
    const req = step.request as GatherRequest | null;
    if (!req)
      return {
        stop: { outcome: 'failed', note: 'The fallback step is missing.' },
      };
    let linked = 0;
    let searched = 0;
    const notes: string[] = [];
    const link = async () => {
      if (!req.problem_id) return;
      const made = await this.store.autopilotLinkClaims(
        ctx,
        ws,
        req.problem_id,
        req.options,
      );
      linked += made.length;
      if (made.length)
        notes.push(
          `Linked ${made.length} recorded claim${made.length === 1 ? '' : 's'} whose text names ${[
            ...new Set(made.map((m) => `“${m.to_title}”`)),
          ]
            .slice(0, 4)
            .join(', ')}.`,
        );
    };
    await link();
    if (req.question) {
      const settings = await this.#settings(ctx, ws);
      const route = this.#searchRoute(
        { ...a, steps: a.steps.slice(0, -1) },
        settings,
      );
      if (typeof route === 'string') notes.push(`No web search: ${route}`);
      else {
        const capped = await this.#searchRoom(ctx, ws, a, route.connection_id);
        if (capped && !linked) return { stop: capped };
        if (capped) notes.push(`No web search: ${capped.note}`);
        else {
          const scope = WebDiscoveryScopeSchema.parse({
            ...(a.config.research?.scope ?? {}),
            question: req.question.slice(0, 300),
          });
          const preview = await this.store.previewWebDiscovery(ctx, ws, scope);
          const r = await this.#search(
            ctx,
            keyed,
            ws,
            a,
            step,
            {
              connection_id: route.connection_id,
              model_id: route.model_id,
              scope,
              input_hash: preview.input_hash,
            },
            signal,
          );
          if ('stop' in r) {
            if (r.stop.outcome === 'cancelled' || r.stop.kind === 'end_time')
              return r;
            notes.push(`The web search did not finish: ${r.stop.note}`);
          } else {
            searched = r.d.proposals.filter(
              (p) => p.decision === 'admitted',
            ).length;
            const pending = r.d.proposals.filter(
              (p) => p.check === 'verified' && p.decision === 'pending',
            ).length;
            notes.push(
              `Searched the web for “${req.question.slice(0, 160)}”: ${searched} claim${searched === 1 ? '' : 's'} added by the run's routine approvals${pending ? `, ${pending} waiting for you under Discover › Search the web` : ''}.`,
            );
            if (searched) await link();
          }
        }
      }
    }
    const added = linked + searched;
    if (!added && req.then === 'explore')
      return {
        stop: {
          outcome: 'insufficient_evidence',
          kind: 'thin_evidence',
          note: `${req.reason} The autopilot gathered evidence but found nothing new. ${notes.join(' ')}`.slice(
            0,
            1200,
          ),
        },
      };
    const then = !added && req.then === 'assess' ? 'select' : req.then;
    return {
      done: {
        request: { ...req, then, added },
        note: `${notes.join(' ') || 'Nothing new was found.'} ${
          then === 'select' && req.then === 'assess'
            ? 'Nothing new to assess, so it goes on to choose.'
            : `Going back to ${AUTOPILOT_STAGE_LABEL[then].toLowerCase()}.`
        }`.slice(0, 1200),
      },
    };
  }

  /** Explore, discover and assess: start (or find) the workflow, wait, read its result. */
  async #workflowStep(
    ctx: CommandContext,
    keyed: CommandContext,
    ws: string,
    a: Autopilot,
    step: AutopilotStep,
    signal: AbortSignal,
  ): Promise<Result> {
    let id = step.child?.id;
    if (!id) {
      const started =
        step.stage === 'explore'
          ? await this.store.startExploration(keyed, ws, a.run_id, step.request)
          : step.stage === 'discover'
            ? await this.store.startDiscovery(keyed, ws, a.run_id, step.request)
            : await this.store.startAssessment(
                keyed,
                ws,
                a.run_id,
                step.request,
              );
      id = started.workflow.id;
      if (!(await this.#record(ctx, ws, a, { kind: 'workflow', id }))) {
        // Stopped between the start and the record: stop what was just started (review L-1).
        await this.#cancelWorkflow(ctx, ws, id, 'The autopilot was stopped.');
        return { stop: { outcome: 'cancelled', note: 'Stopped.' } };
      }
    }
    let wf: Workflow;
    for (;;) {
      wf = (await this.store.getWorkflow(ctx, ws, id)).workflow;
      if (TERMINAL.has(wf.state)) break;
      if (wf.state === 'waiting_human')
        return {
          stop: {
            outcome: 'needs_authority',
            kind: 'approval',
            note: `${AUTOPILOT_STAGE_LABEL[step.stage]} is waiting for a decision (Monitor › Approvals): ${wf.reason}. Answer it, then continue the autopilot.`.slice(
              0,
              1200,
            ),
          },
        };
      if (wf.state === 'paused_operator')
        return {
          stop: {
            outcome: 'needs_person',
            kind: 'paused',
            note: `${AUTOPILOT_STAGE_LABEL[step.stage]} was paused by a person. Resume it, then continue the autopilot.`,
          },
        };
      if (!(await this.#wait(signal, a))) {
        if (!signal.aborted)
          await this.#cancelWorkflow(
            ctx,
            ws,
            id,
            "The autopilot's end time passed.",
          );
        return this.#late(a);
      }
    }
    const child = { kind: 'workflow' as const, id };
    if (wf.state !== 'succeeded')
      return this.#retryOr(ctx, ws, a, step, {
        outcome: wf.state === 'cancelled' ? 'cancelled' : 'failed',
        note: `${AUTOPILOT_STAGE_LABEL[step.stage]} ended ${wf.state}: ${wf.reason}`.slice(
          0,
          1200,
        ),
      });
    const result = wf.result;
    if (step.stage === 'explore') {
      const r = ExplorationResultSchema.parse(result?.exploration);
      const pick = pickExplored(r);
      if (!pick.ok)
        return this.#thin(ctx, ws, a, child, pick.reason, 'explore', {
          questions: [...r.directions.map((d) => d.question), ...r.not_covered],
        });
      return {
        done: {
          child,
          note: `The exploration found ${r.candidates.filter((x) => x.disposition === 'candidate').length} candidate problem(s); the first, ${pick.ref} “${pick.title}”, goes on.`.slice(
            0,
            1200,
          ),
        },
      };
    }
    if (step.stage === 'discover') {
      const d = result?.discovery;
      if (!d || d.outcome === 'insufficient_evidence')
        return this.#thin(
          ctx,
          ws,
          a,
          child,
          `Discovery found the evidence insufficient: ${wf.reason}`,
          'discover',
          {},
        );
      const problem = d.catalog_records.problem;
      if (!problem || !d.catalog_records.alternatives.length)
        return this.#thin(
          ctx,
          ws,
          a,
          child,
          `Discovery proposed no option to assess (${d.outcome.replaceAll('_', ' ')}).`,
          'discover',
          { outcome: 'no_eligible_option' },
        );
      return {
        done: {
          child,
          problem: { id: problem.id, version: problem.version },
          note: `Discovery recorded a problem with ${d.catalog_records.alternatives.length} option(s).${
            (step.request?.evidence as unknown[] | undefined)?.length === 30 &&
            ((
              carried(a.steps, 'brief')?.request?.claims as
                unknown[] | undefined
            )?.length ?? 0) > 30
              ? ` It read the first 30 of the brief's ${(carried(a.steps, 'brief')!.request!.claims as unknown[]).length} claims (discovery reads at most 30).`
              : ''
          }`,
        },
      };
    }
    const n = result?.assessment?.scorecards.length ?? 0;
    return {
      done: {
        child,
        note: `The assessment wrote ${n} system scorecard${n === 1 ? '' : 's'}.`,
      },
    };
  }

  /**
   * ADR-0100: thin evidence at explore or discover. With the owner's settings: try the
   * exploration's next candidate problem (discover only), or gather evidence (link claims and
   * search the web with the explorer's own questions) and explore again; otherwise stop.
   */
  async #thin(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
    child: AutopilotStep['child'],
    reason: string,
    at: 'explore' | 'discover',
    opts: { questions?: string[]; outcome?: AutopilotOutcome },
  ): Promise<Result> {
    const stop: Result = {
      stop: {
        outcome: opts.outcome ?? 'insufficient_evidence',
        kind: 'thin_evidence',
        note: reason.slice(0, 1200),
      },
    };
    const settings = await this.#settings(ctx, ws);
    if (at === 'discover' && settings.values.next_candidate) {
      const left = await this.#candidatesLeft(ctx, ws, a);
      if (left > 0)
        return {
          redo: {
            child,
            fallback: this.#fb(
              settings,
              'next_candidate',
              'thin_evidence',
              `${reason} Trying the exploration's next candidate problem.`,
            ),
            then: {
              kind: 'gather',
              request: {
                then: 'brief',
                reason: 'Trying the next candidate problem.',
                problem_id: null,
                options: null,
                question: null,
              },
            },
          },
        };
    }
    const route = this.#searchRoute(a, settings);
    if (typeof route === 'string') {
      if (settings.values.gather_evidence)
        (stop as { stop: Stop }).stop.note =
          `${reason} It could not gather more evidence: ${route}`.slice(
            0,
            1200,
          );
      return stop;
    }
    const asked = new Set(
      a.steps.flatMap((s) =>
        s.stage === 'gather' && s.request?.question
          ? [String(s.request.question).toLowerCase()]
          : [],
      ),
    );
    const brief = carried(a.steps, 'brief');
    const question = [
      ...(opts.questions ?? []),
      ...(brief?.note
        ? [brief.note.replace(/^Brief “([^”]+)”.*$/s, '$1')]
        : []),
      ...a.config.explore.interests,
    ]
      .map((q) => q.trim())
      .find((q) => q && !asked.has(q.toLowerCase()));
    if (!question) {
      (stop as { stop: Stop }).stop.note =
        `${reason} It has already searched the web for every question it had (${asked.size}); add claims or search the web with another question, then start again.`.slice(
          0,
          1200,
        );
      return stop;
    }
    return {
      redo: {
        child,
        fallback: this.#fb(
          settings,
          'gather_evidence',
          'thin_evidence',
          `${reason} Gathering evidence, then exploring again.`,
        ),
        then: {
          kind: 'gather',
          request: {
            then: 'explore',
            reason: reason.slice(0, 600),
            problem_id: null,
            options: null,
            question: question.slice(0, 300),
          },
        },
      },
    };
  }

  /** Candidate problems the newest exploration has that no brief has been written from yet. */
  async #candidatesLeft(ctx: CommandContext, ws: string, a: Autopilot) {
    const ex = carried(a.steps, 'explore');
    if (!ex?.child) return 0;
    const wf = (await this.store.getWorkflow(ctx, ws, ex.child.id)).workflow;
    const r = ExplorationResultSchema.parse(wf.result?.exploration);
    const kept = r.candidates.filter((c) => c.disposition === 'candidate');
    return kept.length - this.#briefsSince(a);
  }

  /** Briefs written since the newest exploration finished (each from the next candidate). */
  #briefsSince(a: Autopilot) {
    let at = -1;
    a.steps.forEach((s, i) => {
      if (s.stage === 'explore' && s.state === 'done') at = i;
    });
    return a.steps
      .slice(at + 1)
      .filter((s) => s.stage === 'brief' && s.state === 'done').length;
  }

  async #brief(ctx: CommandContext, ws: string, a: Autopilot): Promise<Result> {
    const ex = carried(a.steps, 'explore');
    if (!ex?.child)
      return {
        stop: { outcome: 'failed', note: 'The exploration is missing.' },
      };
    const wf = (await this.store.getWorkflow(ctx, ws, ex.child.id)).workflow;
    const pick = pickExplored(
      ExplorationResultSchema.parse(wf.result?.exploration),
      this.#briefsSince(a),
    );
    if (!pick.ok)
      return {
        stop: {
          outcome: pick.outcome,
          kind: 'thin_evidence',
          note: pick.reason,
        },
      };
    // The request (which candidate, which claims) is recorded before the brief is written; the
    // brief's version is added after. A repeated write returns the same brief for the same card.
    const before = await this.store.getAutopilot(ctx, ws, a.id);
    const recorded = await this.store.advanceAutopilot(
      ctx,
      ws,
      a.id,
      before.version,
      {
        steps: before.steps.map((s, i) =>
          i === before.steps.length - 1
            ? { ...s, request: { candidate: pick.ref, claims: pick.claims } }
            : s,
        ),
      },
    );
    if (!recorded) return { stop: { outcome: 'cancelled', note: 'Stopped.' } };
    const made = await this.store.createExploredBrief(
      ctx,
      ws,
      ex.child.id,
      pick.ref,
      {
        reason: `Chosen by an autopilot: the first candidate of the shortlist (ADR-0092).`,
      },
    );
    // The brief's claims ride on the step's request, for discovery to read.
    const cur = await this.store.getAutopilot(ctx, ws, a.id);
    await this.store.advanceAutopilot(ctx, ws, a.id, cur.version, {
      steps: cur.steps.map((s, i) =>
        i === cur.steps.length - 1
          ? {
              ...s,
              request: {
                candidate: pick.ref,
                claims: pick.claims,
                brief_version: made.brief.version,
              },
            }
          : s,
      ),
    });
    return {
      done: {
        child: { kind: 'search_brief', id: made.brief.id },
        note: `Brief “${made.brief.title}” written from ${pick.ref}, with ${pick.claims.length} claim${pick.claims.length === 1 ? '' : 's'}.`.slice(
          0,
          1200,
        ),
      },
    };
  }

  async #select(
    ctx: CommandContext,
    keyed: CommandContext,
    ws: string,
    a: Autopilot,
  ): Promise<Result> {
    const problem = autopilotProblem(a.config, a.steps);
    if (!problem)
      return { stop: { outcome: 'failed', note: 'The problem is missing.' } };
    // A choice you recorded under Decide while the autopilot waited is the choice (review M-1).
    const current =
      (await this.store.listSelections(ctx, ws, problem.id)).find(
        (x) => x.current,
      ) ?? null;
    // An autopilot that starts at a recorded problem keeps a choice a person already made there
    // (review 2 L-2); otherwise only one made after it began counts (an older one predates it).
    const mine = personChoice(
      current,
      a.config.start ? new Date(0).toISOString() : a.created_at,
    );
    if (mine.kind !== 'none') {
      // A choice made on other scores than today's (for example before this autopilot's own
      // assessment) is not acted on past them, whether it would carry on or end the run: the
      // person looks again (review 3 L-1, review 4 L-1).
      const now = await this.store.selectionReport(
        ctx,
        ws,
        problem.id,
        current!.report.suitability.sensitivity.shortlist_size,
      );
      if (now.report_hash !== current!.report_hash)
        return {
          stop: {
            outcome: 'needs_person',
            kind: 'person_choice',
            note: `Your choice under Decide${
              mine.kind === 'carry' ? ` (“${mine.option.title}”)` : ''
            } was made on other scores than the current ones${
              a.steps.some((s) => s.stage === 'assess' && s.state === 'done')
                ? ', before this autopilot’s assessment'
                : ''
            }. Review it under Decide and record it again (or choose another), then continue.`,
          },
        };
    }
    if (mine.kind === 'stop')
      return {
        stop: {
          outcome: mine.outcome,
          kind: 'person_choice',
          note: mine.reason,
        },
      };
    if (mine.kind === 'carry') {
      return {
        done: {
          child: { kind: 'selection', id: current!.id },
          problem: current!.problem,
          option: mine.option,
          note: `Going on with your choice under Decide: “${mine.option.title}” (${mine.disposition.replaceAll('_', ' ')}).${
            a.steps.some((s) => s.stage === 'select' && s.asked)
              ? ' The question the autopilot left under Monitor › Approvals is answered by this choice; you can leave it to expire.'
              : ''
          }`.slice(0, 1200),
        },
      };
    }
    const report = await this.store.selectionReport(ctx, ws, problem.id);
    const settings = await this.#settings(ctx, ws);
    const S = settings.values;
    // ADR-0100: when more evidence could settle the stop (unknown ratings, an open gate), gather
    // it and assess again before any setting chooses past it.
    const strict = autopilotChoice(report, {
      ...S,
      choose_with_unknowns: false,
      next_candidate: false,
    });
    if (
      !strict.ok &&
      (strict.kind === 'unknown_ratings' || strict.kind === 'gate_blocked') &&
      S.gather_evidence &&
      // Choosing from recorded scores never calls a model, so it never assesses again.
      a.config.start?.stage !== 'select'
    ) {
      const g = this.#gathered(a, ['assess', 'select']);
      if (g.rounds < 1 + S.max_extra_searches && g.lastAdded !== 0) {
        const route = this.#searchRoute(a, settings);
        const rows = report.suitability.candidates.filter((c) =>
          (strict.options ?? []).some((o) => o.id === c.alternative.id),
        );
        const first = rows[0];
        const question = first
          ? `${first.alternative.title}${first.unknown_criteria.length ? `: ${first.unknown_criteria.map((x) => x.replaceAll('_', ' ')).join(', ')}` : ''}`
          : report.problem.title;
        return {
          redo: {
            fallback: this.#fb(
              settings,
              'gather_evidence',
              strict.kind,
              `${strict.reason} Gathering evidence for ${rows.length ? rows.map((r) => `“${r.alternative.title}”`).join(', ') : 'the options'}, then assessing again.`,
            ),
            then: {
              kind: 'gather',
              request: {
                then: 'assess',
                reason: strict.reason.slice(0, 600),
                problem_id: report.problem.id,
                options: rows.length ? rows.map((r) => r.alternative.id) : null,
                question: typeof route === 'string' ? null : question,
              },
            },
          },
        };
      }
    }
    const choice = autopilotChoice(report, S);
    if (!choice.ok)
      return {
        stop: {
          outcome: choice.outcome,
          kind: choice.kind,
          note: choice.reason,
        },
      };
    const out = await this.store.select(keyed, ws, a.run_id, {
      ...choice.request,
      data_class: a.config.data_class,
    });
    if (out.status !== 'recorded' || !out.selection) {
      const n = notAdmitted(choice.option.title, out.admission);
      const ethics = /ethic/i.test(
        `${out.admission.reason_code} ${out.admission.explanation}`,
      );
      return {
        stop: {
          outcome: 'needs_authority',
          kind: ethics ? 'model_ethics' : 'approval',
          note: n.note,
          ...(n.asked ? { asked: n.asked } : {}),
        },
      };
    }
    const flagged = out.selection.rationale.startsWith(MODEL_ONLY_ETHICS_NOTE);
    return {
      done: {
        child: { kind: 'selection', id: out.selection.id },
        problem: { id: report.problem.id, version: report.problem.version },
        option: choice.option,
        ...(choice.fallbacks[0]
          ? {
              fallback: {
                ...choice.fallbacks[0],
                settings_version: settings.version,
              },
            }
          : flagged
            ? {
                fallback: this.#fb(
                  settings,
                  'choose_model_ethics',
                  'model_ethics',
                  MODEL_ONLY_ETHICS_NOTE,
                ),
              }
            : {}),
        note: `Chose “${choice.option.title}” (${choice.request.dispositions.find((d) => d.alternative.id === choice.option.id)!.disposition.replaceAll('_', ' ')}); the other options are deferred.${
          choice.fallbacks.length
            ? ` With the owner's autopilot settings: ${choice.fallbacks.map((f) => f.note).join(' ')}`
            : ''
        }${flagged ? ` ${MODEL_ONLY_ETHICS_NOTE}` : ''}`.slice(0, 1200),
      },
    };
  }

  async #proposal(
    ctx: CommandContext,
    keyed: CommandContext,
    ws: string,
    a: Autopilot,
  ): Promise<Result> {
    const sel = carried(a.steps, 'select');
    if (!sel?.option)
      return {
        stop: { outcome: 'failed', note: 'The chosen option is missing.' },
      };
    const draft = await this.store.proposalDraft(ctx, ws, sel.option.id);
    const flagged = sel.note.includes(MODEL_ONLY_ETHICS_NOTE);
    const made = await this.store.createProposal(keyed, ws, {
      title: draft.title,
      // ADR-0100: a choice past model-only ethics says so at the top of its proposal.
      body: flagged
        ? {
            ...draft.body,
            summary: `${MODEL_ONLY_ETHICS_NOTE} ${draft.body.summary}`.slice(
              0,
              1200,
            ),
          }
        : draft.body,
    });
    return {
      done: {
        child: { kind: 'proposal', id: made.proposal.id },
        outcome: 'proposal',
        note: `Saved the proposal “${draft.title}” for “${sel.option.title}”, drafted from the records; sections the records cannot fill say so. Review it under Proposals.`.slice(
          0,
          1200,
        ),
      },
    };
  }

  /** Waits one poll; false when the autopilot's end time passed or it was stopped. */
  async #wait(signal: AbortSignal, a: Autopilot): Promise<boolean> {
    if (signal.aborted) return false;
    if (Date.parse(a.config.limits.ends_at) <= Date.now()) return false;
    if (this.#onWait) await this.#onWait();
    await new Promise<void>((resolve) => {
      const t = setTimeout(resolve, this.#pollMs);
      signal.addEventListener(
        'abort',
        () => {
          clearTimeout(t);
          resolve();
        },
        { once: true },
      );
    });
    return !signal.aborted;
  }

  #late(a: Autopilot): Result {
    return {
      stop: {
        outcome: 'limit_reached',
        kind: 'end_time',
        note: `The autopilot's end time (${a.config.limits.ends_at.slice(0, 16).replace('T', ' ')} UTC) passed; the step's work was stopped and what it made is kept.`,
      },
    };
  }

  async #cancelWorkflow(
    ctx: CommandContext,
    ws: string,
    id: string,
    reason: string,
  ) {
    await this.store
      .getWorkflow(ctx, ws, id)
      .then((d) =>
        d.workflow.finished_at
          ? null
          : this.store.controlWorkflow(ctx, ws, id, 'cancel', {
              expected_version: d.workflow.version,
              reason,
            }),
      )
      .catch(() => null);
  }

  /**
   * ADR-0100: records a planned fallback instead of a stop. The step keeps the setting that
   * allowed it; `retry` leaves it stopped so the next pass tries it again, `skip` marks it
   * skipped, and `gather` adds the gather step (its key and the calls a search sets aside are
   * recorded before anything is sent).
   */
  async #redo(ctx: CommandContext, ws: string, a: Autopilot, r: Fallback) {
    const now = new Date().toISOString();
    const steps: AutopilotStep[] = a.steps.map((s, i) =>
      i === a.steps.length - 1 && s.state === 'running'
        ? {
            ...s,
            state:
              r.then.kind === 'skip'
                ? ('skipped' as const)
                : ('stopped' as const),
            child: r.child ?? s.child,
            note: r.fallback.note.slice(0, 1200),
            fallback: r.fallback,
            stop_kind: r.fallback.instead_of,
            finished_at: now,
          }
        : s,
    );
    let reserved = a.calls_reserved;
    if (r.then.kind === 'gather') {
      const attempt = steps.filter((s) => s.stage === 'gather').length + 1;
      const calls = r.then.request.question
        ? Math.min(2, Math.max(0, a.config.limits.max_calls - reserved))
        : 0;
      reserved += calls;
      steps.push({
        stage: 'gather',
        attempt,
        state: 'running',
        child: null,
        calls,
        problem: null,
        option: null,
        request: r.then.request,
        key: autopilotKey(a.id, 'gather', attempt),
        note: `${AUTOPILOT_STAGE_LABEL.gather}: ${r.then.request.reason}`.slice(
          0,
          1200,
        ),
        started_at: now,
        finished_at: null,
      });
    }
    const stage =
      r.then.kind === 'gather'
        ? 'gather'
        : r.then.kind === 'skip'
          ? (nextAutopilotStage(a.config, steps) ?? a.stage)
          : a.stage;
    await this.store.advanceAutopilot(ctx, ws, a.id, a.version, {
      steps,
      stage,
      calls_reserved: reserved,
      explanation: r.fallback.note,
    });
  }

  async #finish(ctx: CommandContext, ws: string, a: Autopilot, stop: Stop) {
    const now = new Date().toISOString();
    const steps = a.steps.map((s, i) =>
      i === a.steps.length - 1 && s.state === 'running'
        ? {
            ...s,
            state: 'stopped' as const,
            note: stop.note.slice(0, 1200),
            no_retry: stop.final ?? null,
            stop_kind: stop.kind ?? 'other',
            ...(stop.asked ? { asked: stop.asked } : {}),
            finished_at: now,
          }
        : s,
    );
    return this.store.advanceAutopilot(ctx, ws, a.id, a.version, {
      steps,
      explanation: stop.note,
      outcome: stop.outcome,
    });
  }
}
