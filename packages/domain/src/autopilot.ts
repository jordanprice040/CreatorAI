import {
  AUTOPILOT_STAGE_LABEL,
  METERED_WALL_MAX_SECONDS,
  WORKFLOW_WALL_MAX_SECONDS,
  kindAllows,
  type AutopilotConfig,
  type AutopilotOutcome,
  type AutopilotStage,
  type AutopilotStep,
  type ErrorCode,
  type ExplorationResult,
  type SelectRequest,
  type SelectionDisposition,
  type SelectionReport,
  type WorkflowLimits,
} from '@creator/contracts';

// P13 (ADR-0092): the fixed rules an autopilot uses between steps. Pure functions, so every choice
// an autopilot makes can be checked without a model or a database.

/** The step after the steps so far, or null when the path is complete. */
export function nextAutopilotStage(
  config: Pick<AutopilotConfig, 'research'>,
  steps: readonly AutopilotStep[],
): AutopilotStage | null {
  const done = steps.filter((s) => s.state === 'done' || s.state === 'skipped');
  const last = done.at(-1);
  if (!last) return config.research ? 'research' : 'explore';
  switch (last.stage) {
    case 'research':
      return 'explore';
    case 'explore':
      return 'brief';
    case 'brief':
      return 'discover';
    case 'discover':
      return 'assess';
    case 'assess':
      return 'select';
    case 'select':
      return last.option?.kind === 'build' ? 'spec' : 'proposal';
    default:
      return null;
  }
}

/** The most recent step of a stage that carried a problem or option forward. */
export function carried(
  steps: readonly AutopilotStep[],
  stage: AutopilotStage,
): AutopilotStep | undefined {
  return [...steps]
    .reverse()
    .find((s) => s.stage === stage && s.state === 'done');
}

export type ChildLimits =
  | { ok: true; limits: WorkflowLimits; calls: number }
  | { ok: false; outcome: AutopilotOutcome; reason: string };

/**
 * A step's workflow limits, sized from what the autopilot has left. A step sets aside its whole
 * maximum (`max_calls`) before it starts, so the autopilot never goes past its own limit.
 */
export function autopilotChildLimits(input: {
  stage: 'explore' | 'discover' | 'assess';
  route: 'api' | 'subscription' | 'local';
  /** The plan connection's request timeout and per-run request cap (plan routes only). */
  timeout_ms: number | null;
  per_run: number | null;
  /** Calls left in the autopilot's limit. */
  remaining: number;
  /** Seconds until the autopilot ends. */
  seconds_left: number;
  /** Discovery: response types; assessment: requests the preview counted. */
  width: number;
}): ChildLimits {
  const plan = input.route === 'subscription';
  const width = Math.max(1, Math.min(8, input.width));
  // The fewest calls that let the step finish once (WorkflowLimits: (children + 1) × attempts).
  const floor =
    input.stage === 'explore'
      ? 2
      : input.stage === 'discover'
        ? width + 2
        : width + 1;
  const wanted =
    input.stage === 'explore' ? 2 : input.stage === 'discover' ? 24 : 2 * width;
  const cap = Math.min(
    wanted,
    input.remaining,
    input.per_run ?? Number.MAX_SAFE_INTEGER,
  );
  const label = AUTOPILOT_STAGE_LABEL[input.stage];
  if (cap < floor)
    return {
      ok: false,
      outcome: 'limit_reached',
      reason:
        input.per_run !== null && input.per_run < floor
          ? `${label} needs at least ${floor} plan requests, above the connection's per-run cap of ${input.per_run}. Raise the cap under Models and connections, then continue.`
          : `${label} needs at least ${floor} model calls; the autopilot has ${Math.max(0, input.remaining)} left of its limit.`,
    };
  const timeout = plan ? (input.timeout_ms ?? 60_000) : 30_000;
  const wallMax = plan ? WORKFLOW_WALL_MAX_SECONDS : METERED_WALL_MAX_SECONDS;
  const wanted_wall = Math.min(
    wallMax,
    Math.max(600, Math.ceil((cap * timeout) / 1000) + 60),
  );
  const wall = Math.min(wanted_wall, Math.floor(input.seconds_left));
  if (wall < 60)
    return {
      ok: false,
      outcome: 'limit_reached',
      reason: `The autopilot's end time leaves ${Math.max(0, Math.floor(input.seconds_left))} s, too little for ${label.toLowerCase()}.`,
    };
  return {
    ok: true,
    calls: cap,
    limits: {
      max_children: input.stage === 'explore' ? 1 : width,
      max_concurrency: plan || input.stage !== 'discover' ? 1 : 2,
      max_depth: 1,
      max_attempts: 1,
      max_repairs: 1,
      max_calls: cap,
      max_output_tokens:
        input.stage === 'discover'
          ? 4000
          : input.stage === 'explore'
            ? 6000
            : 8000,
      call_timeout_ms: timeout,
      max_wall_seconds: wall,
    },
  };
}

/**
 * The exploration candidate an autopilot carries on with: the explorer's first card that
 * application code kept as a `candidate` (duplicates, excluded topics and thin evidence are not).
 */
export function pickExplored(
  result: ExplorationResult,
):
  | { ok: true; ref: string; title: string; claims: string[] }
  | { ok: false; outcome: AutopilotOutcome; reason: string } {
  const first = result.candidates.find((c) => c.disposition === 'candidate');
  if (!first) {
    const why = result.candidates
      .map((c) => `${c.ref} ${c.disposition.replaceAll('_', ' ')}`)
      .join('; ');
    return {
      ok: false,
      outcome: 'insufficient_evidence',
      reason: result.candidates.length
        ? `The exploration found no candidate problem (${why}).`.slice(0, 1100)
        : 'The exploration found no candidate problem in the recorded claims.',
    };
  }
  return {
    ok: true,
    ref: first.ref,
    title: first.title,
    claims: [...new Set(first.claims.map((c) => c.claim_id.toLowerCase()))],
  };
}

/** The advancing choice an option of this kind takes in an autopilot, or null. */
export function autopilotDisposition(
  kind: string,
): SelectionDisposition | null {
  if (kind === 'build') return 'select_for_build';
  if (kindAllows(kind, 'recommend_alternative')) return 'recommend_alternative';
  return null;
}

export type AutopilotChoice =
  | {
      ok: true;
      option: { id: string; version: number; kind: string; title: string };
      request: Omit<SelectRequest, 'data_class'>;
    }
  | { ok: false; outcome: AutopilotOutcome; reason: string };

const clip = (s: string, n = 1100) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * The autopilot's selection rule (no blind "highest number wins"): the option ranked first on
 * suitability is advanced only when it is fully scored, no other option shares its rank, the
 * first place holds when each criterion is removed or doubled, and no gate blocks its choice;
 * a software option must also lead the opportunity ranking. Every other option is deferred with
 * that reason. Anything else stops for a person.
 */
export function autopilotChoice(report: SelectionReport): AutopilotChoice {
  const all = report.suitability.candidates;
  if (!all.length)
    return {
      ok: false,
      outcome: 'no_eligible_option',
      reason: 'The problem has no options to choose from.',
    };
  const ranked = all.filter((c) => c.rank !== null && c.score !== null);
  if (!ranked.length)
    return {
      ok: false,
      outcome: 'needs_person',
      reason:
        'No option is fully scored on suitability (unknown ratings are not neutral), so the ranking cannot choose. Score the options under Decide, then continue.',
    };
  const best = Math.min(...ranked.map((c) => c.rank!));
  const top = ranked.filter((c) => c.rank === best);
  if (top.length > 1)
    return {
      ok: false,
      outcome: 'needs_person',
      reason: clip(
        `${top.map((c) => `“${c.alternative.title}”`).join(' and ')} tie for first on suitability; a tie is not broken by a rule. Choose under Decide, or score them again, then continue.`,
      ),
    };
  const chosen = top[0]!;
  const unstable = report.suitability.sensitivity.scenarios.filter(
    (s) => s.top_changed,
  );
  if (unstable.length)
    return {
      ok: false,
      outcome: 'needs_person',
      reason: clip(
        `“${chosen.alternative.title}” ranks first, but not when the weights change (${unstable
          .slice(0, 4)
          .map((s) => s.name)
          .join(
            ', ',
          )}). A close ranking is a judgment for a person under Decide.`,
      ),
    };
  const kind = chosen.alternative.kind;
  const disposition = autopilotDisposition(kind);
  if (!disposition)
    return {
      ok: false,
      outcome: 'no_eligible_option',
      reason: `The first-ranked option “${chosen.alternative.title}” is a ${kind.replaceAll('_', ' ')} outcome, which cannot be advanced.`,
    };
  const discovery = chosen.gates.discovery;
  if (discovery && discovery !== 'candidate')
    return {
      ok: false,
      outcome: 'no_eligible_option',
      reason: `Discovery marked the first-ranked option “${chosen.alternative.title}” ${discovery.replaceAll('_', ' ')}, so it is not advanced.`,
    };
  const blocked = chosen.gates.blocked[disposition] ?? [];
  if (blocked.length)
    return {
      ok: false,
      outcome: 'needs_person',
      reason: clip(
        `“${chosen.alternative.title}” ranks first but cannot be ${disposition.replaceAll('_', ' ')} yet: ${blocked.join(' ')}`,
      ),
    };
  if (disposition === 'select_for_build') {
    const opp = report.opportunity.candidates.filter(
      (c) => c.rank !== null && c.score !== null,
    );
    const lead = opp.length ? Math.min(...opp.map((c) => c.rank!)) : null;
    const leaders = opp.filter((c) => c.rank === lead);
    if (
      leaders.length !== 1 ||
      leaders[0]!.alternative.id !== chosen.alternative.id
    )
      return {
        ok: false,
        outcome: 'needs_person',
        reason: `“${chosen.alternative.title}” leads on suitability but not alone on opportunity; building it would need an override reason, which is a person's judgment.`,
      };
  }
  const score = chosen.score?.display ?? 'n/a';
  return {
    ok: true,
    option: {
      id: chosen.alternative.id,
      version: chosen.alternative.version,
      kind,
      title: chosen.alternative.title,
    },
    request: {
      problem: { id: report.problem.id, version: report.problem.version },
      report_hash: report.report_hash,
      dispositions: all.map((c) =>
        c.alternative.id === chosen.alternative.id
          ? {
              alternative: {
                id: c.alternative.id,
                version: c.alternative.version,
              },
              disposition,
              reasons: [
                `Ranked first on suitability (${score}) with no tie, and first under every weight check.`,
                'Chosen by the autopilot rule from the automatic assessment; no gate blocked it.',
              ],
              reverse_if:
                'A person scores the options differently, a gate or claim changes, or another option ranks first.',
            }
          : {
              alternative: {
                id: c.alternative.id,
                version: c.alternative.version,
              },
              disposition: 'defer' as const,
              reasons: [
                c.rank === null
                  ? 'Not fully scored on suitability; the autopilot advances only the first-ranked option.'
                  : `Ranked ${c.rank} on suitability; the autopilot advances only the first-ranked option.`,
              ],
              reverse_if:
                'A person compares the options and prefers this one, or it ranks first after new evidence.',
            },
      ),
      override_reason: null,
      rationale: clip(
        `Recorded by an unattended autopilot under the run's routine approvals (ADR-0092). “${chosen.alternative.title}” ranked first on suitability (${score}) with no tie, the first place held when each criterion was removed or doubled, and no gate blocked ${disposition.replaceAll('_', ' ')}. The scores are the automatic assessment's; a person can record a different selection at any time.`,
      ),
      shortlist_size: 3,
    },
  };
}

/** How a refused step ends the autopilot, from the refusal's code. */
export function refusalOutcome(code: ErrorCode | null): AutopilotOutcome {
  switch (code) {
    case 'SCOPE_EXCEEDED':
    case 'LIMIT_EXCEEDED':
    case 'BUDGET_EXCEEDED':
      return 'limit_reached';
    case 'ACCESS_DENIED':
    case 'HUMAN_ONLY_DENIED':
    case 'LIVE_DISABLED':
    case 'EXPIRED':
      return 'needs_authority';
    default:
      return 'failed';
  }
}
