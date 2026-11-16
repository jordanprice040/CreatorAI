import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AUTOPILOT_STAGE_LABEL,
  ContractError,
  cutText,
  cutWords,
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
  PlanRefusalCodeSchema,
  StartAutopilotRequestSchema,
  AUTOPILOT_USAGE_NOTE,
  AutopilotUsageCheckRequestSchema,
  autopilotRequestFloor,
  autopilotStageFloor,
  autopilotStepConnection,
  parse,
  type AutopilotUsageCheck,
  SETTING_FOR_STOP,
  SETTLED_BUT_COVERED,
  AUTOPILOT_SETTING_TEXT,
  settingIsOn,
  type AutopilotSettingsValues,
  PROPOSAL_DRAFTABLE_SECTIONS,
  PROPOSAL_SECTION_LABELS,
  type ProposalSectionDraft,
} from '@creator/contracts';
import {
  autopilotChildLimits,
  autopilotChoice,
  connectionRefusals,
  dailyCap,
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
  /** P-12: adds the claims a finished search holds that the run's approvals and settings allow. */
  accept(ctx: CommandContext, ws: string, id: string): Promise<unknown>;
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
    accept: (ctx, ws, id) => store.admitWebClaimsByPolicy(ctx, ws, id),
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

/** What `trimSpent` reads of a workflow: its state and what its requests used. */
export type SpentDetail = {
  workflow: { state: string };
  usage: { attempts: number; in_flight: number };
  subscription_usage?:
    | {
        requests: number;
        in_flight: number;
        unresolved: number;
      }
    | null
    | undefined;
};

/** A finished workflow with nothing in flight or unresolved: what it used is final. */
export function spentSettled(d: SpentDetail): boolean {
  const plan = d.subscription_usage;
  return (
    TERMINAL.has(d.workflow.state) &&
    !d.usage.in_flight &&
    !plan?.in_flight &&
    !plan?.unresolved
  );
}

/**
 * Workflows whose steps may still hold calls they did not use: the running step's, and those of
 * stopped steps that still set calls aside (a stop can come before its workflow finishes).
 */
export function spentCandidates(a: Autopilot): string[] {
  const ids = new Set<string>();
  a.steps.forEach((s, i) => {
    if (s.child?.kind !== 'workflow') return;
    if (
      (i === a.steps.length - 1 && s.state === 'running') ||
      (s.state === 'stopped' && s.calls > 0)
    )
      ids.add(s.child.id);
  });
  return [...ids];
}

/**
 * Live rerun (November 15): a step sets aside its workflow's worst case before anything is
 * sent. Once that workflow has finished with nothing in flight or unresolved, the steps that
 * share it keep only what it used (attempts, or plan requests, whichever is more) and the rest
 * goes back to the autopilot. Unknown outcomes keep the whole reservation (invariant 5). A
 * step carrying on an earlier attempt's workflow sets nothing aside, so the reservation is
 * trimmed on the latest step that holds it (review 1 L-1).
 */
export function trimSpent(
  a: Autopilot,
  details: ReadonlyMap<string, SpentDetail>,
): Autopilot {
  let steps = a.steps;
  let reserved = a.calls_reserved;
  for (const [child, d] of details) {
    if (!spentSettled(d)) continue;
    const plan = d.subscription_usage;
    const used = Math.max(d.usage.attempts, plan?.requests ?? 0);
    let held = 0;
    for (const s of steps) if (s.child?.id === child) held += s.calls;
    let give = held - used;
    for (let i = steps.length - 1; i >= 0 && give > 0; i--) {
      const s = steps[i]!;
      if (s.child?.id !== child || s.calls <= 0) continue;
      const take = Math.min(give, s.calls);
      steps = steps.map((x, j) =>
        j === i ? { ...x, calls: x.calls - take } : x,
      );
      reserved -= take;
      give -= take;
    }
  }
  return reserved === a.calls_reserved
    ? a
    : { ...a, steps, calls_reserved: reserved };
}

/**
 * Live rerun (November 15): a note made of a long reason and what happens next keeps the
 * second part whole; the reason is shortened at a word instead.
 */
export function fitNote(head: string, tail: string, max: number): string {
  const lead = head.trim();
  // Live rerun 3 (November 15): a long ending must not take the whole note; the reason keeps
  // at least two fifths of it (or all of itself, when shorter).
  const keep = Math.min(lead.length, Math.floor(max * 0.4));
  const end = cutWords(tail.trim(), keep ? max - keep - 1 : max);
  if (!end) return cutWords(lead, max);
  const room = max - end.length - 1;
  // PR #211 review 1 N-3: a short reason that was given room is kept whole.
  const start = room >= Math.min(20, lead.length) ? cutWords(lead, room) : '';
  return start ? `${start} ${end}` : end;
}

/**
 * Live rerun (November 15): a bare option title brought back claims that did not touch the
 * unknowns. The gather question names what is unknown, the option and the problem it is for.
 */
export function gatherQuestion(
  option: { title: string; unknown: readonly string[] } | null,
  problem: string,
): string {
  if (!option) return cutWords(problem, 300);
  // Live rerun 3 (November 15): long titles and three unknowns cut the question mid-word. The
  // titles are shortened inside it and at most two unknowns are named, so it stays whole.
  const unknown = option.unknown.slice(0, 2).map((x) => x.replaceAll('_', ' '));
  const title = cutWords(option.title, 90);
  const about = cutWords(problem, 70);
  return cutWords(
    unknown.length
      ? `What evidence shows the ${unknown.join(' and ')} of “${title}” as a response to “${about}”?`
      : `What evidence bears on “${title}” as a response to “${about}”?`,
    300,
  );
}

/**
 * Review 1 L-3: the first gather question no earlier round asked (compared without case),
 * trying the options in order and then the problem itself; undefined when all were asked.
 */
export function nextGatherQuestion(
  options: { title: string; unknown: readonly string[] }[],
  problem: string,
  asked: ReadonlySet<string>,
): { about: string | null; question: string } | undefined {
  return [
    ...options.map((o) => ({
      about: o.title as string | null,
      question: gatherQuestion(o, problem),
    })),
    { about: null, question: gatherQuestion(null, problem) },
  ].find((q) => !asked.has(q.question.toLowerCase()));
}

/**
 * Live rerun 3 (November 15): unknown ratings (option × criterion) among the options a choice
 * stopped on; null when the stop is not about unknown ratings.
 */
export function unknownCount(
  kind: string,
  rows: readonly { unknown_criteria: readonly string[] }[],
): number | null {
  return kind === 'unknown_ratings'
    ? rows.reduce((n, r) => n + r.unknown_criteria.length, 0)
    : null;
}

/**
 * Live rerun 3 (November 15) and PR #211 review 1 N-4: why gathering stopped, with both counts
 * (the last round can leave more unknowns than before, not only as many).
 */
export function stalledNote(before: number, now: number): string {
  const n = (k: number) => `${k} unknown rating${k === 1 ? '' : 's'}`;
  return `The last round of evidence left ${n(now)}, ${now === before ? 'the same as' : 'more than'} the ${before} before it, so it stops gathering and the choice is yours.`;
}

/** “A”, “B”, “C” and 2 more. */
export function namesOf(titles: string[], shown = 3): string {
  const named = titles.slice(0, shown).map((t) => `“${cutWords(t, 60)}”`);
  const more = titles.length - named.length;
  return named.join(', ') + (more > 0 ? ` and ${more} more` : '');
}

const said = (e: unknown) =>
  e instanceof ContractError
    ? cutText([e.message, ...e.details].join(' '), 1000)
    : e instanceof Error
      ? cutText(e.message, 300)
      : 'The step failed.';
const codeOf = (e: unknown): ErrorCode | null =>
  e instanceof ContractError ? e.code : null;

/** ADR-0100: the kind of stop a refused step made, from the refusal's code and words. */
export function refusalKind(e: unknown): AutopilotStopKind {
  // Review 1 L-2: a plan connection's refusal names its reason by code; read that first.
  const plan: readonly string[] = PlanRefusalCodeSchema.options;
  const reasons =
    e instanceof ContractError
      ? e.reasons.map((r) => r.code).filter((c) => plan.includes(c))
      : [];
  const text = said(e).toLowerCase();
  // Re-review 2 N-1: a connection that is not set up (caps not accepted, sign-in, …) is fixed
  // first; more requests cannot help until it is.
  // Live rerun 3 (November 15): the plan account's own usage limit resets by itself; it is a
  // limit to wait out, not a connection to fix or an approval to give.
  // PR #211 review 1 N-1: only when nothing else about the connection needs fixing.
  if (
    reasons.includes('quota_exhausted') &&
    reasons.every((c) =>
      ['quota_exhausted', 'cap_reached', 'daily_cap_reached'].includes(c),
    )
  )
    return 'usage_limit';
  if (reasons.some((c) => c !== 'cap_reached' && c !== 'daily_cap_reached'))
    return 'connection';
  if (reasons.includes('daily_cap_reached')) return 'daily_cap';
  if (reasons.includes('cap_reached') && text.includes('per-run'))
    return 'run_cap';
  if (reasons.length) return 'connection';
  if (text.includes('per-run request cap')) return 'run_cap';
  if (text.includes('daily request cap')) return 'daily_cap';
  const code = codeOf(e);
  if (code === 'BUDGET_EXCEEDED' || code === 'LIMIT_EXCEEDED')
    return 'call_limit';
  if (code === 'EXPIRED') return 'end_time';
  const outcome = refusalOutcome(code);
  if (outcome === 'needs_authority') return 'approval';
  if (outcome === 'failed') return 'failed_step';
  return 'other';
}

const USAGE_LIMIT_NOTE =
  "The plan account's usage limit was reached, so the step is not tried again now. Once it resets (see your plan's usage settings), recheck usage under Models and connections, then continue.";

/** Live rerun 3 (November 15): "Assess the options failed: <reason>", never "ended failed: failed". */
export function failedNote(
  label: string,
  wf: { state: string; reason: string | null },
): string {
  const verb = wf.state === 'cancelled' ? 'was cancelled' : 'failed';
  const reason = (wf.reason ?? '').trim();
  return reason && reason.toLowerCase() !== wf.state
    ? `${label} ${verb}: ${reason.replace(/[.\s]*$/, '').replaceAll('_', ' ')}.`
    : `${label} ${verb}.`;
}

/**
 * PR #211 review 2 N-4: a usage-limit stop whose refusal also hit a request cap names that cap's
 * own step too, so the recheck is not followed by a second refusal; empty otherwise.
 */
export function capAlso(e: unknown): string {
  if (refusalKind(e) !== 'usage_limit' || !(e instanceof ContractError))
    return '';
  const codes = e.reasons.map((r) => r.code);
  const out: string[] = [];
  // PR #211 review 3: cap_reached also covers the input, chat and Codex caps; only the per-run
  // cap is named as such (as refusalKind reads it), any other is quoted.
  for (const r of e.reasons.filter((x) => x.code === 'cap_reached')) {
    const text = (r.text ?? '').trim().replace(/[.\s]*$/, '');
    out.push(
      /per-run/i.test(text)
        ? "The connection's per-run request cap was reached too; raise it under Models and connections › Change caps."
        : `A connection cap was reached too${text ? ` (${cutWords(text, 200)})` : ''}; see Models and connections.`,
    );
  }
  if (codes.includes('daily_cap_reached'))
    out.push(
      "The connection's daily request cap was reached too; add requests under Models and connections.",
    );
  return out.length ? ` ${out.join(' ')}` : '';
}

/** A refused call's stop: its kind, and the outcome that kind implies. */
export function refusalStop(e: unknown): {
  outcome: AutopilotOutcome;
  kind: AutopilotStopKind;
} {
  const kind = refusalKind(e);
  return {
    outcome:
      kind === 'usage_limit' ? 'limit_reached' : refusalOutcome(codeOf(e)),
    kind,
  };
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
  /** The record the stopped step was about (a held web search), kept on the step. */
  child?: AutopilotStep['child'];
  /**
   * The step was refused before it made anything, so it sent no request: the calls it set aside
   * go back to the autopilot's limit (live run 2026-11-14: 32 calls were held by two refusals).
   */
  unsent?: boolean;
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
  /** As on Stop: the retried attempt sent nothing, so its calls go back. */
  unsent?: boolean;
};

/**
 * P-12: the web search whose quote-checked claims a person was asked about, when the steps just
 * before this attempt of `stage` stopped for them. It looks past repeated stops (a Continue with
 * nothing added stops again without a search of its own), so a later Allow still goes on from
 * that search instead of searching again (live run 2026-11-14).
 */
export function heldSearch(
  steps: readonly AutopilotStep[],
  stage: AutopilotStage,
): string | null {
  for (let i = steps.length - 1; i >= 0; i -= 1) {
    const s = steps[i]!;
    if (s.stage !== stage || s.stop_kind !== 'claims_held') return null;
    if (s.child?.kind === 'web_discovery') return s.child.id;
  }
  return null;
}
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
  /** Live rerun 3: unknown ratings (option × criterion) when this round was asked for. */
  unknowns?: number;
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

/** ADR-0101 (P-5): asks the chat model to draft a proposal's unknown sections (the plan service). */
export type ProposalDrafter = (
  ctx: CommandContext,
  ws: string,
  proposalId: string,
  body: unknown,
) => Promise<ProposalSectionDraft>;

/** A stable press id for the autopilot's one draft request per proposal step attempt. */
function draftClientId(key: string) {
  const h = createHash('sha256')
    .update(`autopilot-section-draft:${key}`)
    .digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-8${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export interface AutopilotRunnerOptions {
  /** ADR-0101: the chat model's section drafts, used when the owner's setting allows. */
  drafts?: ProposalDrafter;
  /** How often a running workflow is read again. */
  pollMs?: number;
  /** Called on every wait (tests use it to run the workflow worker). */
  onWait?: () => Promise<unknown>;
  /** How often `watch` looks for running autopilots no driver holds (review L-7). */
  recoverMs?: number;
}

export class AutopilotRunner {
  /**
   * Keys of steps whose start threw before it committed, so nothing was sent (review 1 of #202,
   * L-5). Only such a step gives back the calls it set aside: a start that committed may have
   * spent, and unknown spend is not zero.
   */
  readonly #refused = new Set<string>();
  /** Finished, settled workflows' use, read once (review 2 N-2); kept small. */
  readonly #settledSpend = new Map<string, SpentDetail>();
  async #starting<T>(
    ws: string,
    step: AutopilotStep,
    start: () => Promise<T>,
  ): Promise<T> {
    try {
      return await start();
    } catch (e) {
      // Third review N-1: an error, even a ContractError, can come after the start committed
      // (each start ends with a read that can fail). The start's idempotency receipt is written
      // in the same transaction, so no receipt for the step's key means nothing was sent. If
      // the receipt cannot be read, the step is treated as possibly sent.
      if (step.key) {
        const committed = await this.store
          .commandCommitted(ws, step.key)
          .catch(() => true);
        if (!committed) this.#refused.add(step.key);
      }
      throw e;
    }
  }
  readonly #live = new Map<
    string,
    { abort: AbortController; done: Promise<void> }
  >();
  readonly #pollMs: number;
  readonly #onWait: (() => Promise<unknown>) | null;
  readonly #recoverMs: number;
  readonly #drafts: ProposalDrafter | null;
  #watch: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: ConnectionStore,
    private readonly web: AutopilotWeb | null,
    options: AutopilotRunnerOptions = {},
  ) {
    this.#pollMs = options.pollMs ?? 2000;
    this.#onWait = options.onWait ?? null;
    this.#recoverMs = options.recoverMs ?? 60_000;
    this.#drafts = options.drafts ?? null;
  }

  isActive(id: string) {
    return this.#live.has(id.toLowerCase());
  }
  /** The autopilot with its live state and next steps (a setting already on is not offered). */
  with(a: Autopilot, settings?: AutopilotSettingsValues): Autopilot {
    return {
      ...a,
      active: this.isActive(a.id),
      next: autopilotNextSteps(a, settings),
    };
  }
  /** `with`, reading the owner's settings now (re-review 2 L-1). */
  async withNext(ctx: CommandContext, ws: string, a: Autopilot) {
    const s = await this.#settings(ctx, ws).catch(() => null);
    return this.with(a, s?.values);
  }

  async allowAndContinue(
    ctx: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    const a = await this.store.allowAndContinueAutopilot(ctx, ws, id, body);
    this.#launch(a.created_by, ws, a.id);
    return this.withNext(ctx, ws, a);
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
    const a = await this.store.startAutopilot(ctx, ws, runId, body, (c) =>
      this.#fitsRunCap(c, ctx, ws, runId, body),
    );
    this.#launch(a.created_by, ws, a.id);
    return this.withNext(ctx, ws, a);
  }

  /**
   * ADR-0100 (K-9, review 1 L-3, re-review 2 L-2): a whole process on a plan connection is
   * refused at the start when what is left of the connection's per-run cap on this run cannot
   * hold the least each step needs (the research search's 2 requests too, when it uses the same
   * connection). A repeated start the store has already recorded returns that autopilot.
   */
  async #fitsRunCap(
    /** The start's own transaction (round 3 nit: no second connection while it is held). */
    client: PoolClient,
    ctx: CommandContext,
    ws: string,
    runId: string,
    body: unknown,
  ) {
    const req = StartAutopilotRequestSchema.safeParse(body);
    if (!req.success) return; // The store refuses it with the contract's own message.
    const c = req.data.config;
    const r = c.resource_setup;
    if (c.start || r.kind !== 'subscription') return;
    // A savepoint keeps the start's transaction usable if the read fails.
    await client.query('savepoint autopilot_room');
    const room = await this.store
      .planRunRoomIn(client, ctx, ws, r.connection_id, runId)
      .catch(async () => {
        await client.query('rollback to savepoint autopilot_room');
        return null;
      });
    await client.query('release savepoint autopilot_room');
    if (!room) return; // A connection that cannot be read is refused by admission instead.
    // Re-review 2 L-2: each step's own floor (autopilotChildLimits): explore 2, discovery its
    // response types + 2, assessment at least 2, and the research search's 2 on this connection.
    // ADR-0124: the same count the usage check shows before the start.
    const need = autopilotRequestFloor(c, r.connection_id);
    const left = room.per_run - room.used;
    if (left < need)
      throw new ContractError(
        'LIMIT_EXCEEDED',
        `This run has ${Math.max(0, left)} of the plan connection's ${room.per_run} requests per run left, and a whole process needs at least ${need}. Raise the per-run cap under Models and connections, or start from a recorded problem.`,
      );
  }

  /**
   * ADR-0124 (F2): before a start, the requests this autopilot needs from each plan connection it
   * uses (the start check's own count) beside what the connection has left on the run and today
   * (the figures admission reads). Reads only; sends nothing.
   */
  async usageCheck(
    ctx: CommandContext,
    ws: string,
    body: unknown,
  ): Promise<AutopilotUsageCheck> {
    const req = parse(AutopilotUsageCheckRequestSchema, body);
    const c = req.config;
    const ids = [
      ...new Set(
        [
          c.resource_setup.kind === 'subscription'
            ? c.resource_setup.connection_id
            : null,
          c.research?.connection_id ?? null,
        ]
          .filter((x): x is string => !!x)
          .map((x) => x.toLowerCase()),
      ),
    ];
    const connections: AutopilotUsageCheck['connections'] = [];
    for (const id of ids) {
      const need = autopilotRequestFloor(c, id);
      // Review 1 N-2: a start at selection makes no model request; nothing to show.
      if (need === 0) continue;
      const d = await this.store.planConnectionDetail(ctx, ws, id);
      const conn = d.connection;
      const perRun = conn.settings.caps.responses.max_requests_per_run;
      const room = req.run_id
        ? await this.store.planRunRoom(ctx, ws, id, req.run_id)
        : null;
      const used = room?.used ?? 0;
      const cap = room?.daily_cap ?? dailyCap(conn.settings.caps, d.usage);
      const dailyLeft =
        room?.daily_left ?? Math.max(0, cap - d.usage.last_24h_requests);
      const perRunLeft = Math.max(0, perRun - used);
      const blockers = connectionRefusals(conn).map((x) =>
        cutText(x.text, 600),
      );
      const fit =
        blockers.length > 0
          ? ('blocked' as const)
          : perRunLeft < need
            ? ('per_run' as const)
            : dailyLeft < need
              ? ('daily' as const)
              : ('fits' as const);
      // Review 1 N-2: a connection only the web search uses takes its 2 requests (more only if
      // the settings let it gather evidence); the main route may use up to the call limit.
      const main =
        c.resource_setup.kind === 'subscription' &&
        c.resource_setup.connection_id.toLowerCase() === id;
      const upTo = Math.min(main ? c.limits.max_calls : need, perRunLeft);
      // Review 1 L-4: only a whole process on its main connection is refused at the start
      // (#fitsRunCap); anywhere else a short per-run cap stops it part way.
      const refusedAtStart = main && !c.start;
      const s = (n: number) => (n === 1 ? '' : 's');
      const counts = `This autopilot needs at least ${need} request${s(need)} from ${conn.label} (up to ${upTo}${main ? '' : ' for the web search, more if it gathers evidence'}); the connection has ${perRunLeft} of its ${perRun} per-run request${s(perRun)} left on this run and ${dailyLeft} of its ${cap} daily request${s(cap)} left today.`;
      const line =
        fit === 'fits'
          ? counts
          : fit === 'per_run'
            ? refusedAtStart
              ? `${counts} The per-run cap cannot hold it, so the start is refused: raise the cap under Models and connections.`
              : `${counts} It will stop when the per-run cap is reached: raise the cap under Models and connections first.`
            : fit === 'daily'
              ? `${counts} It will stop when the daily cap is used up${c.resume_after_limit ? ' and continue by itself once the cap has room again' : '; then add requests or wait, and continue'}.`
              : `${counts} The connection refuses requests now: ${blockers[0]}`;
      connections.push({
        connection_id: conn.id,
        label: cutText(conn.label, 200),
        need,
        up_to: upTo,
        per_run: perRun,
        per_run_left: perRunLeft,
        daily_cap: cap,
        daily_left: dailyLeft,
        quota: conn.quota.state,
        blockers: blockers.slice(0, 12),
        fit,
        line: cutText(line, 600),
      });
    }
    return { connections, note: AUTOPILOT_USAGE_NOTE };
  }

  /** ADR-0124 (F2): the owner turns off continuing by itself after a limit. */
  async turnOffAutoResume(
    ctx: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    return this.withNext(
      ctx,
      ws,
      await this.store.turnOffAutoResume(ctx, ws, id, body),
    );
  }

  /**
   * ADR-0124 (F2): continues opted-in autopilots stopped on a limit that passes with time, once
   * it is due and the connection is checked again. The daily cap is read now (no request is
   * sent): it continues when the stopped step's floor fits. The plan account's own limit cannot
   * be read, so after the wait the stale "used up" mark is cleared, as Recheck usage does, and
   * the step itself is the check: if the plan refuses again, it stops again and waits longer.
   * Never continues when the connection refuses for any other reason. Runs with `watch`.
   */
  async resumeDue(now = Date.now()) {
    for (const a of await this.store.autopilotsAwaitingResume()) {
      const view = a.auto_resume;
      if (view?.state !== 'waiting') continue;
      if (view.next_check_at && Date.parse(view.next_check_at) > now) continue;
      if (this.isActive(a.id)) continue;
      const ctx: CommandContext = {
        actorId: a.created_by,
        autopilot: { id: a.id.toLowerCase() },
      };
      const conn = await this.#limitPassed(ctx, a.workspace_id, a).catch(
        () => null,
      );
      if (!conn) continue;
      const next = await this.store
        .autoResumeAutopilot(ctx, a.workspace_id, a.id, a.version)
        .catch(() => null);
      if (!next) continue;
      // Only once it has continued: the stale "used up" mark is cleared, as Recheck usage does,
      // and the step's first request is the check. Done before the step is driven, from the
      // connection as it is now (review 1 L-3: a fresh version, and only while still marked).
      if (conn.quota === 'exhausted') await this.#clearUsedUp(ctx, a, conn.id);
      this.#launch(next.created_by, a.workspace_id, next.id);
    }
  }

  /** Clears a connection's "used up" mark as Recheck usage does, if it is still set. */
  async #clearUsedUp(ctx: CommandContext, a: Autopilot, id: string) {
    for (let i = 0; i < 2; i++) {
      const d = await this.store
        .planConnectionDetail(ctx, a.workspace_id, id)
        .catch(() => null);
      if (d?.connection.quota.state !== 'exhausted') return;
      const done = await this.store
        .resetPlanQuotaObservation(
          ctx,
          a.workspace_id,
          id,
          d.connection.version,
        )
        .then(
          () => true,
          () => false,
        );
      if (done) return;
    }
  }

  /**
   * The connection the stopped step uses when the limit that stopped `a` may have passed (null
   * when not). The connection is the one that step sends on (review 1 M-1: a gather search
   * uses the research connection too). It must refuse for nothing but the plan's usage limit,
   * and the run's per-run cap and the day's cap must each leave room for the step (review 1
   * L-3: a usage-limit stop that also hit the per-run cap is not continued for nothing).
   */
  async #limitPassed(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
  ): Promise<{ id: string; quota: string } | null> {
    const last = a.steps.at(-1);
    if (!last) return null;
    const id = autopilotStepConnection(a.config, last.stage);
    if (!id) return null;
    const d = await this.store.planConnectionDetail(ctx, ws, id);
    const others = connectionRefusals(d.connection).filter(
      (x) => x.code !== 'quota_exhausted',
    );
    if (others.length) return null;
    const need = Math.max(1, autopilotStageFloor(last.stage, a.config));
    const room = await this.store.planRunRoom(ctx, ws, id, a.run_id);
    if (room.per_run - room.used < need || room.daily_left < need) return null;
    return { id: d.connection.id, quota: d.connection.quota.state };
  }

  async retry(ctx: CommandContext, ws: string, id: string, body: unknown) {
    const a = await this.store.retryAutopilot(ctx, ws, id, body);
    this.#launch(a.created_by, ws, a.id);
    return this.withNext(ctx, ws, a);
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
        .then(() => this.resumeDue())
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
      const read = await this.store.getAutopilot(ctx, ws, id);
      if (read.state !== 'running') return;
      // Live rerun (November 15): a finished step keeps only the calls it used.
      const fresh = await this.#trimSpent(ctx, ws, read);
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
              note: cutText(done.note, 1200),
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
        calls_reserved: fresh.calls_reserved,
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
      planned = { ...refusalStop(e), note: `${said(e)}${capAlso(e)}` };
    }
    if ('outcome' in planned) {
      planned = await this.#settle(ctx, ws, planned);
      return this.store.advanceAutopilot(ctx, ws, a.id, a.version, {
        stage,
        steps: [
          ...a.steps,
          {
            ...base,
            state: 'stopped',
            note: cutText(planned.note, 1200),
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
        const request = {
          connection_id: c.research.connection_id,
          model_id: c.research.model_id,
          scope: c.research.scope,
          input_hash: c.research.input_hash,
        };
        // P-12: going on from a search whose claims waited for a person sends nothing new.
        if (this.web && heldSearch(a.steps, 'research'))
          return { calls: 0, request };
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
        return { calls: 2, request };
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
          // P-12: going on from a held search sends no new one.
          calls:
            again.question && !(this.web && heldSearch(a.steps, 'gather'))
              ? Math.min(2, Math.max(0, remaining))
              : 0,
        };
      }
      case 'proposal': {
        // ADR-0101 (review 1 L-2): asking the chat model for section drafts is one call of the
        // autopilot's own limit, decided (and reserved) when the step is planned.
        const s = await this.#settings(ctx, ws).catch(() => null);
        if (!s?.values.draft_proposal_sections)
          return { request: null, calls: 0 };
        if (!this.#drafts)
          return { request: { draft_sections: 'no_service' }, calls: 0 };
        return remaining >= 1
          ? { request: { draft_sections: 'ask' }, calls: 1 }
          : { request: { draft_sections: 'no_calls' }, calls: 0 };
      }
      default:
        return { request: null, calls: 0 };
    }
  }

  /** ADR-0100: the owner's autopilot settings as they are now. */
  async #settings(ctx: CommandContext, ws: string): Promise<AutopilotSettings> {
    return this.store.autopilotSettings(ctx, ws);
  }

  /**
   * Re-review 2 L-1: a settled stop (thin evidence, no eligible option) whose setting is already
   * on cannot be got past by Continue or Allow, so it ends the autopilot (and P-11 ends its
   * approvals) and offers a new one.
   */
  async #settle(ctx: CommandContext, ws: string, stop: Stop): Promise<Stop> {
    const setting = stop.kind ? SETTING_FOR_STOP[stop.kind] : undefined;
    if (stop.final || !setting || !SETTLED_BUT_COVERED.includes(stop.outcome))
      return stop;
    const s = await this.#settings(ctx, ws).catch(() => null);
    if (!s || !settingIsOn(s.values, setting)) return stop;
    return {
      ...stop,
      final: cutText(
        `“${AUTOPILOT_SETTING_TEXT[setting].label}” is already on and it still could not go on. Add evidence or choose under Decide, then start a new autopilot.`,
        300,
      ),
    };
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
      note: cutText(note, 600),
    };
  }

  /** Whether the autopilot's plan connection last saw its account's usage limit reached. */
  async #usageLimited(ctx: CommandContext, ws: string, a: Autopilot) {
    const r = a.config.resource_setup;
    if (r.kind !== 'subscription') return false;
    const d = await this.store
      .planConnectionDetail(ctx, ws, r.connection_id)
      .catch(() => null);
    return d?.connection.quota?.state === 'exhausted';
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
    // Live rerun 3 (November 15): while the plan account's usage limit holds, a retry is only
    // refused again; stop on the limit instead, so Continue goes on once it resets.
    if (await this.#usageLimited(ctx, ws, a))
      return {
        stop: {
          ...stop,
          outcome: 'limit_reached',
          kind: 'usage_limit',
          note: fitNote(stop.note, USAGE_LIMIT_NOTE, 1200),
        },
      };
    const settings = await this.#settings(ctx, ws);
    if (this.#failures(a, step.stage) >= settings.values.retry_failed)
      return { stop: { ...stop, kind: stop.kind ?? 'failed_step' } };
    return {
      redo: {
        fallback: this.#fb(
          settings,
          'retry_failed',
          'failed_step',
          fitNote(
            stop.note,
            "Trying the step again (the owner's setting “retry a failed step”).",
            600,
          ),
        ),
        then: { kind: 'retry' },
        ...(stop.unsent ? { unsent: true } : {}),
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
    /** Calls already set aside for the step that would search (review 1 L-1). */
    own = 0,
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
    if (a.config.limits.max_calls - (a.calls_reserved - own) < 2)
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
    return {
      rounds: rounds.length,
      lastAdded: last?.added ?? null,
      lastUnknowns: last?.unknowns ?? null,
    };
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
          return await this.#proposal(ctx, keyed, ws, a, step, signal);
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
      // Only a step whose start call itself threw sent nothing (L-5); anything else may have
      // spent, so its calls stay set aside.
      const unsent = !!step.key && this.#refused.delete(step.key);
      const stop: Stop = {
        ...refusalStop(e),
        note: `${AUTOPILOT_STAGE_LABEL[step.stage]} was refused: ${said(e)}${capAlso(e)}`,
        ...(unsent ? { unsent: true } : {}),
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
    const after = await this.#afterHeld(ctx, ws, a);
    if (after)
      return after.added || !after.waiting
        ? {
            done: {
              child: { kind: 'web_discovery', id: after.d.id },
              note: `Went on from the earlier web search: ${after.added} claim${after.added === 1 ? '' : 's'} added${after.waiting ? `, ${after.waiting} still waiting for you` : ''}.`,
            },
          }
        : this.#heldStop(after.d, after.waiting);
    const r = await this.#search(ctx, keyed, ws, a, step, step.request, signal);
    if ('stop' in r) {
      if (r.stop.outcome === 'cancelled' || r.stop.kind === 'end_time')
        return r;
      // ADR-0100: a search that cannot run or keeps failing is skipped (the owner's "try the
      // next candidate"): the autopilot explores the claims already recorded instead.
      if (r.stop.outcome === 'failed') {
        const retried = await this.#retryOr(ctx, ws, a, step, r.stop);
        // PR #211 review 1 L-2: a search that failed under the plan's usage limit stops on that
        // limit; skipping it would only be refused again at the next step.
        if (
          'redo' in retried ||
          ('stop' in retried && retried.stop.kind === 'usage_limit')
        )
          return retried;
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
              fitNote(
                r.stop.note,
                'Skipped the web search and explored the recorded claims instead.',
                600,
              ),
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
    // P-12: with nothing added and quote-checked claims held for a person, stop for them
    // before exploring without that evidence.
    const held = this.#held(d);
    if (!admitted && held) return this.#heldStop(d, held);
    return {
      done: {
        child: { kind: 'web_discovery', id: d.id },
        note: fitNote(
          d.explanation,
          `${admitted} claim${admitted === 1 ? '' : 's'} added by the run's routine approvals${pending ? `; ${pending} checked claim${pending === 1 ? '' : 's'} wait for you under Discover › Search the web` : ''}.`,
          1200,
        ),
      },
    };
  }

  /**
   * P-12 (ADR-0100): the quote-checked claims a web search found that wait for a person, because
   * the owner's setting does not let the autopilot accept them (inferences always wait).
   */
  #held(d: WebDiscovery): number {
    return d.proposals.filter(
      (p) =>
        p.check === 'verified' &&
        p.decision === 'pending' &&
        p.basis === 'observation',
    ).length;
  }

  #heldStop(d: WebDiscovery, n: number, extra = ''): { stop: Stop } {
    return {
      stop: {
        outcome: 'needs_person',
        kind: 'claims_held',
        child: { kind: 'web_discovery', id: d.id },
        note: fitNote(
          extra,
          `The web search found ${n} claim${n === 1 ? '' : 's'} whose only check is that the quotes were found word for word; ${n === 1 ? 'it waits' : 'they wait'} for you under Discover › Search the web (search ${d.id}). Add the ones you agree with and continue, or turn on “Accept quote-checked web claims”.`,
          1200,
        ),
      },
    };
  }

  /**
   * P-12: when the step before this one stopped because claims waited for a person, this attempt
   * goes on from that search instead of searching again: it accepts the waiting claims when the
   * owner's setting now allows it, and counts what was added (by the owner or by the setting).
   */
  async #afterHeld(
    ctx: CommandContext,
    ws: string,
    a: Autopilot,
  ): Promise<{ d: WebDiscovery; added: number; waiting: number } | null> {
    const cur = a.steps.at(-1);
    const id = cur ? heldSearch(a.steps.slice(0, -1), cur.stage) : null;
    if (!this.web || !id) return null;
    const settings = await this.#settings(ctx, ws);
    if (settings.values.accept_quote_checked_claims)
      await this.web.accept(ctx, ws, id);
    const d = await this.web.read(ctx, ws, id);
    return {
      d,
      added: d.proposals.filter((p) => p.decision === 'admitted').length,
      waiting: this.#held(d),
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
      const web = this.web;
      const d = await this.#starting(ws, step, () =>
        web.start(keyed, ws, a.run_id, request),
      );
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
          note: cutText(
            `The web search ended ${d.state}: ${d.explanation}`,
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
        a.config.data_class,
      );
      linked += made.length;
      for (const m of made) linkedTo.add(m.to_title);
    };
    // Live rerun (November 15): linking can run twice (before and after a search); the note
    // says once, at the start, how many claims it linked in all.
    const linkedTo = new Set<string>();
    const linkNote = () =>
      linked
        ? [
            `Linked ${linked} recorded claim${linked === 1 ? '' : 's'} whose text names ${namesOf([...linkedTo], 4)}.`,
          ]
        : [];
    await link();
    const after = await this.#afterHeld(ctx, ws, a);
    let held: { d: WebDiscovery; n: number } | null = null;
    if (after) {
      searched = after.added;
      notes.push(
        `Went on from the earlier web search: ${after.added} claim${after.added === 1 ? '' : 's'} added${after.waiting ? `, ${after.waiting} still waiting for you` : ''}.`,
      );
      if (after.added) await link();
      else if (after.waiting) held = { d: after.d, n: after.waiting };
    } else if (req.question) {
      const settings = await this.#settings(ctx, ws);
      const route = this.#searchRoute(
        { ...a, steps: a.steps.slice(0, -1) },
        settings,
        step.calls,
      );
      if (typeof route === 'string') notes.push(`No web search: ${route}`);
      else {
        const capped = await this.#searchRoom(ctx, ws, a, route.connection_id);
        if (capped && !linked) return { stop: capped };
        if (capped) notes.push(`No web search: ${capped.note}`);
        else {
          const scope = WebDiscoveryScopeSchema.parse({
            ...(a.config.research?.scope ?? {}),
            question: cutText(req.question, 300),
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
              `Searched the web for “${cutText(req.question, 160)}”: ${searched} claim${searched === 1 ? '' : 's'} added by the run's routine approvals${pending ? `, ${pending} waiting for you under Discover › Search the web` : ''}.`,
            );
            if (searched) await link();
            else if (this.#held(r.d)) held = { d: r.d, n: this.#held(r.d) };
          }
        }
      }
    }
    const added = linked + searched;
    // P-12: nothing added while quote-checked claims wait for a person: stop for them.
    if (!added && held) return this.#heldStop(held.d, held.n, req.reason);
    if (!added && req.then === 'explore')
      return {
        stop: {
          outcome: 'insufficient_evidence',
          kind: 'thin_evidence',
          note: fitNote(
            `${req.reason} The autopilot gathered evidence but found nothing new.`,
            [...linkNote(), ...notes].join(' '),
            1200,
          ),
        },
      };
    const then = !added && req.then === 'assess' ? 'select' : req.then;
    return {
      done: {
        request: { ...req, then, added },
        note: fitNote(
          [...linkNote(), ...notes].join(' ') || 'Nothing new was found.',
          then === 'select' && req.then === 'assess'
            ? 'Nothing new to assess, so it goes on to choose.'
            : `Going back to ${AUTOPILOT_STAGE_LABEL[then].toLowerCase()}.`,
          1200,
        ),
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
      const started = await this.#starting(ws, step, () =>
        step.stage === 'explore'
          ? this.store.startExploration(keyed, ws, a.run_id, step.request)
          : step.stage === 'discover'
            ? this.store.startDiscovery(keyed, ws, a.run_id, step.request)
            : this.store.startAssessment(keyed, ws, a.run_id, step.request),
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
            note: fitNote(
              `${AUTOPILOT_STAGE_LABEL[step.stage]} is waiting for a decision (Monitor › Approvals): ${wf.reason}.`,
              'Answer it, then continue the autopilot.',
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
        note: cutText(failedNote(AUTOPILOT_STAGE_LABEL[step.stage], wf), 1200),
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
          note: cutText(
            `The exploration found ${r.candidates.filter((x) => x.disposition === 'candidate').length} candidate problem(s); the first, ${pick.ref} “${pick.title}”, goes on.`,
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
        note: cutText(reason, 1200),
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
              fitNote(
                reason,
                "Trying the exploration's next candidate problem.",
                600,
              ),
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
      if (settings.values.gather_evidence) {
        // Re-review 2 L-1: with the setting on, Continue would only stop here again.
        (stop as { stop: Stop }).stop.note = fitNote(
          reason,
          `It could not gather more evidence: ${route}`,
          1200,
        );
        (stop as { stop: Stop }).stop.final = cutText(
          `It could not gather more evidence (${route.replace(/\.$/, '')}). Add claims or search the web yourself, then start a new autopilot.`,
          300,
        );
      }
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
      (stop as { stop: Stop }).stop.note = fitNote(
        reason,
        `It has already searched the web for every question it had (${asked.size}); add claims or search the web with another question, then start again.`,
        1200,
      );
      (stop as { stop: Stop }).stop.final =
        'It has already searched the web for every question it had. Add claims or search the web with another question, then start a new autopilot.';
      return stop;
    }
    return {
      redo: {
        child,
        fallback: this.#fb(
          settings,
          'gather_evidence',
          'thin_evidence',
          fitNote(reason, 'Gathering evidence, then exploring again.', 600),
        ),
        then: {
          kind: 'gather',
          request: {
            then: 'explore',
            reason: cutText(reason, 600),
            problem_id: null,
            options: null,
            question: cutText(question, 300),
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
          // Re-review 2 L-1: every candidate was tried; Continue cannot find another.
          ...(this.#briefsSince(a) > 0
            ? {
                final:
                  'The exploration has no candidate problem left to try. Add claims, then start a new autopilot.',
              }
            : {}),
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
        note: cutText(
          `Brief “${made.brief.title}” written from ${pick.ref}, with ${pick.claims.length} claim${pick.claims.length === 1 ? '' : 's'}.`,
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
          note: cutText(
            `Going on with your choice under Decide: “${mine.option.title}” (${mine.disposition.replaceAll('_', ' ')}).${
              a.steps.some((s) => s.stage === 'select' && s.asked)
                ? ' The question the autopilot left under Monitor › Approvals is answered by this choice; you can leave it to expire.'
                : ''
            }`,
            1200,
          ),
        },
      };
    }
    const report = await this.store.selectionReport(ctx, ws, problem.id);
    const settings = await this.#settings(ctx, ws);
    const S = settings.values;
    // PR #211 review 1 N-4: the two counts, named in the stop note.
    let stalled: { before: number; now: number } | null = null;
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
      const rows = report.suitability.candidates.filter((c) =>
        (strict.options ?? []).some((o) => o.id === c.alternative.id),
      );
      const unknowns = unknownCount(strict.kind, rows);
      // Live rerun 3 (November 15): four rounds went on although the unknown ratings did not
      // shrink (2, then 1, then 2 again). A round that leaves as many unknowns as the last one
      // asked about stops gathering, and the choice goes to a person or the settings.
      stalled =
        unknowns !== null &&
        g.lastUnknowns !== null &&
        unknowns >= g.lastUnknowns
          ? { before: g.lastUnknowns, now: unknowns }
          : null;
      if (
        g.rounds < 1 + S.max_extra_searches &&
        g.lastAdded !== 0 &&
        !stalled
      ) {
        const route = this.#searchRoute(a, settings);
        // Review 1 L-3: each round asks a question no earlier round asked, trying the options
        // in order and then the problem itself; with none left it only links recorded claims.
        const asked = new Set(
          a.steps.flatMap((s) =>
            s.stage === 'gather' && s.request?.question
              ? [String(s.request.question).toLowerCase()]
              : [],
          ),
        );
        const fresh = nextGatherQuestion(
          rows.map((r) => ({
            title: r.alternative.title,
            unknown: r.unknown_criteria,
          })),
          report.problem.title,
          asked,
        );
        const search = typeof route === 'string' ? undefined : fresh;
        const searching = search
          ? ` (searching the web about ${search.about ? `“${cutWords(search.about, 80)}”` : 'the problem'})`
          : '';
        return {
          redo: {
            fallback: this.#fb(
              settings,
              'gather_evidence',
              strict.kind,
              fitNote(
                strict.reason,
                `Gathering evidence for ${namesOf(rows.map((r) => r.alternative.title)) || 'the options'}${searching}, then assessing again.`,
                600,
              ),
            ),
            then: {
              kind: 'gather',
              request: {
                then: 'assess',
                reason: cutText(strict.reason, 600),
                problem_id: report.problem.id,
                options: rows.length ? rows.map((r) => r.alternative.id) : null,
                question: search?.question ?? null,
                ...(unknowns !== null ? { unknowns } : {}),
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
          note: stalled
            ? fitNote(
                choice.reason,
                stalledNote(stalled.before, stalled.now),
                1200,
              )
            : choice.reason,
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
        note: cutText(
          `Chose “${choice.option.title}” (${choice.request.dispositions.find((d) => d.alternative.id === choice.option.id)!.disposition.replaceAll('_', ' ')}); the other options are deferred.${
            choice.fallbacks.length
              ? ` With the owner's autopilot settings: ${choice.fallbacks.map((f) => f.note).join(' ')}`
              : ''
          }${flagged ? ` ${MODEL_ONLY_ETHICS_NOTE}` : ''}`,
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
    step: AutopilotStep,
    signal: AbortSignal,
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
            summary: cutText(
              `${MODEL_ONLY_ETHICS_NOTE} ${draft.body.summary}`,
              1200,
            ),
          }
        : draft.body,
    });
    const drafted = await this.#draftSections(
      ctx,
      ws,
      made.proposal,
      step,
      step.key ?? `${a.id}:${step.attempt}`,
      signal,
    );
    return {
      done: {
        child: { kind: 'proposal', id: made.proposal.id },
        outcome: 'proposal',
        note: cutText(
          `Saved the proposal “${draft.title}” for “${sel.option.title}”, drafted from the records; sections the records cannot fill say so.${drafted ? ` ${drafted}` : ''} Review it under Proposals.`,
          1200,
        ),
      },
    };
  }

  /**
   * ADR-0101 (P-5): with the owner's setting on, asks the chat model to draft the proposal's
   * unknown plan sections. The drafts only wait under their sections; a person uses each one.
   * A refusal or failure never stops the autopilot: the proposal is saved either way, and the
   * note says what happened. Null when the setting was off when the step was planned or nothing
   * is left to draft. Stop does not wait for the reply: the request carries on and its drafts
   * still appear under the sections (review 1 L-2).
   */
  async #draftSections(
    ctx: CommandContext,
    ws: string,
    p: {
      id: string;
      version: number;
      body: { sections: Record<string, { state: string }> };
    },
    step: AutopilotStep,
    key: string,
    signal: AbortSignal,
  ): Promise<string | null> {
    const plan = step.request?.draft_sections;
    if (!plan) return null;
    const sections = PROPOSAL_DRAFTABLE_SECTIONS.filter(
      (k) => p.body.sections[k]?.state === 'unknown',
    );
    if (!sections.length) return null;
    if (plan === 'no_service' || !this.#drafts)
      return 'The chat model was not asked to draft its missing sections: this studio has no plan connections.';
    if (plan === 'no_calls')
      return 'The chat model was not asked to draft its missing sections: the autopilot’s call limit is used up.';
    const stopped = new Promise<null>((resolve) => {
      if (signal.aborted) resolve(null);
      signal.addEventListener('abort', () => resolve(null), { once: true });
    });
    try {
      const d = await Promise.race([
        this.#drafts(ctx, ws, p.id, {
          client_id: draftClientId(key),
          version: p.version,
          sections,
        }),
        stopped,
      ]);
      if (!d)
        return 'The autopilot stopped before the chat model’s drafts came back; any it finishes will still appear under their sections.';
      const written = sections.filter((k) => d.values[k]?.state === 'written');
      // Review 1 L-4: a person's draft already on its way is returned in place of a new one.
      if (d.state === 'pending')
        return 'A draft of its missing sections was already on its way; it will appear under the sections on Proposals.';
      if (d.state !== 'completed')
        return `The chat model's draft of its missing sections ${d.state === 'refused' ? 'was not sent' : 'failed'}${d.reason ? `: ${d.reason}` : '.'}`;
      return written.length
        ? `${d.model_id} drafted ${written.map((k) => PROPOSAL_SECTION_LABELS[k]).join(', ')}; each draft waits under its section until a person uses it.`
        : `${d.model_id} could not draft its missing sections from the records; they stay Unknown yet.`;
    } catch (e) {
      return `The chat model was not asked to draft its missing sections: ${said(e)}`;
    }
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
   * Live rerun (November 15): a step sets aside its worst case before it starts (discovery 24,
   * an assessment two per request), so a Hands-off autopilot ran out of its 40 calls after 18
   * real requests. Once the step's workflow has finished, the step keeps what it used and gives
   * back the rest. Anything still in flight or unresolved keeps the whole reservation, since an
   * unknown outcome is not zero (invariant 5).
   */
  async #trimSpent(ctx: CommandContext, ws: string, a: Autopilot) {
    const ids = spentCandidates(a);
    if (!ids.length) return a;
    const details = new Map<string, SpentDetail>();
    for (const id of ids) {
      // Review 2 N-2: a finished workflow with nothing in flight or unresolved never changes
      // what it used, so it is read once (the trim itself is worked out on every pass).
      const known = this.#settledSpend.get(id);
      if (known) {
        details.set(id, known);
        continue;
      }
      const d = await this.store.getWorkflow(ctx, ws, id).catch(() => null);
      if (!d) continue;
      const spent: SpentDetail = {
        workflow: { state: d.workflow.state },
        usage: { attempts: d.usage.attempts, in_flight: d.usage.in_flight },
        subscription_usage: d.subscription_usage
          ? {
              requests: d.subscription_usage.requests,
              in_flight: d.subscription_usage.in_flight,
              unresolved: d.subscription_usage.unresolved,
            }
          : null,
      };
      details.set(id, spent);
      if (spentSettled(spent)) {
        if (this.#settledSpend.size >= 500) this.#settledSpend.clear();
        this.#settledSpend.set(id, spent);
      }
    }
    return trimSpent(a, details);
  }

  /**
   * ADR-0100: records a planned fallback instead of a stop. The step keeps the setting that
   * allowed it; `retry` leaves it stopped so the next pass tries it again, `skip` marks it
   * skipped, and `gather` adds the gather step (its key and the calls a search sets aside are
   * recorded before anything is sent).
   */
  async #redo(ctx: CommandContext, ws: string, a: Autopilot, r: Fallback) {
    const now = new Date().toISOString();
    let reserved = a.calls_reserved;
    const steps: AutopilotStep[] = a.steps.map((s, i) => {
      if (i !== a.steps.length - 1 || s.state !== 'running') return s;
      // A refused attempt sent nothing: give back what it set aside.
      const release = r.unsent && (r.child ?? s.child) == null ? s.calls : 0;
      reserved -= release;
      return {
        ...s,
        state:
          r.then.kind === 'skip' ? ('skipped' as const) : ('stopped' as const),
        child: r.child ?? s.child,
        calls: s.calls - release,
        note: cutText(r.fallback.note, 1200),
        fallback: r.fallback,
        stop_kind: r.fallback.instead_of,
        finished_at: now,
      };
    });
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
        note: cutText(
          `${AUTOPILOT_STAGE_LABEL.gather}: ${r.then.request.reason}`,
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

  async #finish(ctx: CommandContext, ws: string, a: Autopilot, stopIn: Stop) {
    const stop = await this.#settle(ctx, ws, stopIn);
    const now = new Date().toISOString();
    let reserved = a.calls_reserved;
    const steps = a.steps.map((s, i) => {
      if (i !== a.steps.length - 1 || s.state !== 'running') return s;
      const child = stop.child ?? s.child;
      // A refused step sent nothing: give back what it set aside.
      const release = stop.unsent && child == null ? s.calls : 0;
      reserved -= release;
      return {
        ...s,
        state: 'stopped' as const,
        child,
        calls: s.calls - release,
        note: cutText(stop.note, 1200),
        no_retry: stop.final ?? null,
        stop_kind: stop.kind ?? 'other',
        ...(stop.asked ? { asked: stop.asked } : {}),
        finished_at: now,
      };
    });
    return this.store.advanceAutopilot(ctx, ws, a.id, a.version, {
      steps,
      explanation: stop.note,
      outcome: stop.outcome,
      calls_reserved: reserved,
    });
  }
}
