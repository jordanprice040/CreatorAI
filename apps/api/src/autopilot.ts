import { createHash } from 'node:crypto';
import {
  AUTOPILOT_STAGE_LABEL,
  ContractError,
  ExplorationResultSchema,
  type Autopilot,
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
type Stop = { outcome: AutopilotOutcome; note: string; final?: string };
type Done = {
  note: string;
  problem?: AutopilotStep['problem'];
  option?: AutopilotStep['option'];
  child?: AutopilotStep['child'];
  /** Ends the autopilot after this step (the path's last step). */
  outcome?: AutopilotOutcome;
};
type Result = { stop: Stop } | { done: Done };

const stopOf = (l: {
  outcome: AutopilotOutcome;
  reason: string;
  final?: string;
}): Stop => ({
  outcome: l.outcome,
  note: l.reason,
  ...(l.final ? { final: l.final } : {}),
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
    return { ...a, active: this.isActive(a.id) };
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
    void this.recover().catch(() => undefined);
    if (this.#watch) return;
    this.#watch = setInterval(
      () => void this.recover().catch(() => undefined),
      this.#recoverMs,
    );
    this.#watch.unref?.();
  }

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
    const attempt =
      previous && previous.stage === stage ? previous.attempt + 1 : 1;
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
      planned = { outcome: refusalOutcome(codeOf(e)), note: said(e) };
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
    if (r.kind !== 'subscription') return { timeout_ms: null, per_run: null };
    const caps = (
      await this.store.planConnectionDetail(ctx, ws, r.connection_id)
    ).connection.settings.caps.responses;
    return {
      timeout_ms: caps.request_timeout_ms,
      per_run: caps.max_requests_per_run,
    };
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
            note: `Searching the web needs 2 plan requests; the autopilot has ${remaining} left.`,
            final:
              'Its call limit is used up and cannot be raised; start a new autopilot with a higher limit.',
          };
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
        if (preview.packet.problem.version !== found.problem.version)
          return {
            outcome: 'needs_person',
            note: 'The problem changed after it was found; assess it by hand or start a new autopilot.',
          };
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
      default:
        return { request: null, calls: 0 };
    }
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
        case 'proposal':
          return await this.#proposal(ctx, keyed, ws, a);
        case 'spec': {
          const sel = carried(a.steps, 'select');
          return {
            stop: {
              outcome: 'needs_person',
              note: `“${sel?.option?.title ?? 'The option'}” was selected for a bounded build. Writing and freezing its spec stays with you for now (Build › Spec); the autopilot does not write specs.`,
              final:
                'Writing and freezing the spec stays with you (Build › Spec); Continue cannot do it.',
            },
          };
        }
      }
    } catch (e) {
      return {
        stop: {
          outcome: refusalOutcome(codeOf(e)),
          note: `${AUTOPILOT_STAGE_LABEL[step.stage]} was refused: ${said(e)}`,
        },
      };
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
    if (!this.web)
      return {
        stop: {
          outcome: 'needs_authority',
          note: 'Web search needs the plan connection service and the source fetcher, which this studio is not running.',
        },
      };
    let id = step.child?.id;
    if (!id) {
      const d = await this.web.start(keyed, ws, a.run_id, step.request);
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
          return this.#late(a);
        }
        continue;
      }
      if (d.state === 'done') {
        const admitted = d.proposals.filter(
          (p) => p.decision === 'admitted',
        ).length;
        const pending = d.proposals.filter(
          (p) => p.check === 'verified' && p.decision === 'pending',
        ).length;
        return {
          done: {
            child: { kind: 'web_discovery', id },
            note: `${d.explanation} ${admitted} claim${admitted === 1 ? '' : 's'} added by the run's routine approvals${pending ? `; ${pending} checked claim${pending === 1 ? '' : 's'} wait for you under Discover › Search the web` : ''}.`.slice(
              0,
              1200,
            ),
          },
        };
      }
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
      return {
        stop: {
          outcome: wf.state === 'cancelled' ? 'cancelled' : 'failed',
          note: `${AUTOPILOT_STAGE_LABEL[step.stage]} ended ${wf.state}: ${wf.reason}`.slice(
            0,
            1200,
          ),
        },
      };
    const result = wf.result;
    if (step.stage === 'explore') {
      const r = ExplorationResultSchema.parse(result?.exploration);
      const pick = pickExplored(r);
      if (!pick.ok)
        return { stop: { outcome: pick.outcome, note: pick.reason } };
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
        return {
          stop: {
            outcome: 'insufficient_evidence',
            note: `Discovery found the evidence insufficient: ${wf.reason}`.slice(
              0,
              1200,
            ),
          },
        };
      const problem = d.catalog_records.problem;
      if (!problem || !d.catalog_records.alternatives.length)
        return {
          stop: {
            outcome: 'no_eligible_option',
            note: `Discovery proposed no option to assess (${d.outcome.replaceAll('_', ' ')}).`,
          },
        };
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

  async #brief(ctx: CommandContext, ws: string, a: Autopilot): Promise<Result> {
    const ex = carried(a.steps, 'explore');
    if (!ex?.child)
      return {
        stop: { outcome: 'failed', note: 'The exploration is missing.' },
      };
    const wf = (await this.store.getWorkflow(ctx, ws, ex.child.id)).workflow;
    const pick = pickExplored(
      ExplorationResultSchema.parse(wf.result?.exploration),
    );
    if (!pick.ok) return { stop: { outcome: pick.outcome, note: pick.reason } };
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
    if (mine.kind === 'stop')
      return { stop: { outcome: mine.outcome, note: mine.reason } };
    if (mine.kind === 'carry')
      return {
        done: {
          child: { kind: 'selection', id: current!.id },
          problem: current!.problem,
          option: mine.option,
          note: `Going on with your choice under Decide: “${mine.option.title}” (${mine.disposition.replaceAll('_', ' ')}).${
            a.steps.some(
              (s) =>
                s.stage === 'select' &&
                s.state === 'stopped' &&
                /question also waits/.test(s.note),
            )
              ? ' The question the autopilot left under Monitor › Approvals is answered by this choice; you can leave it to expire.'
              : ''
          }`.slice(0, 1200),
        },
      };
    const report = await this.store.selectionReport(ctx, ws, problem.id);
    const choice = autopilotChoice(report);
    if (!choice.ok)
      return { stop: { outcome: choice.outcome, note: choice.reason } };
    const out = await this.store.select(keyed, ws, a.run_id, {
      ...choice.request,
      data_class: a.config.data_class,
    });
    if (out.status !== 'recorded' || !out.selection)
      return {
        stop: {
          outcome: 'needs_authority',
          note: `The choice of “${choice.option.title}” was not admitted (${out.admission.reason_code}): ${out.admission.explanation}${
            out.admission.decision_id &&
            !out.admission.reason_code.startsWith('already_answered')
              ? ' A person decides: choose under Decide yourself (the question also waits under Monitor › Approvals), then continue, and the autopilot goes on with your choice.'
              : ''
          }`.slice(0, 1200),
        },
      };
    return {
      done: {
        child: { kind: 'selection', id: out.selection.id },
        problem: { id: report.problem.id, version: report.problem.version },
        option: choice.option,
        note: `Chose “${choice.option.title}” (${choice.request.dispositions.find((d) => d.alternative.id === choice.option.id)!.disposition.replaceAll('_', ' ')}); the other options are deferred.`.slice(
          0,
          1200,
        ),
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
    const made = await this.store.createProposal(keyed, ws, {
      title: draft.title,
      body: draft.body,
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

  async #finish(ctx: CommandContext, ws: string, a: Autopilot, stop: Stop) {
    const now = new Date().toISOString();
    const steps = a.steps.map((s, i) =>
      i === a.steps.length - 1 && s.state === 'running'
        ? {
            ...s,
            state: 'stopped' as const,
            note: stop.note.slice(0, 1200),
            no_retry: stop.final ?? null,
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
