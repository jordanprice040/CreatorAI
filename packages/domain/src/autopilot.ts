import {
  cutWords,
  AUTOPILOT_STAGE_LABEL,
  METERED_WALL_MAX_SECONDS,
  WORKFLOW_WALL_MAX_SECONDS,
  kindAllows,
  type AutopilotConfig,
  type AutopilotOutcome,
  type AutopilotStage,
  type AutopilotStep,
  type AutopilotSettingKey,
  type AutopilotSettingsValues,
  type AutopilotStopKind,
  AUTOPILOT_SETTINGS_DEFAULT,
  type ErrorCode,
  type ExactScore,
  type ExplorationResult,
  type SelectRequest,
  type Selection,
  type SelectionDisposition,
  type SelectionReport,
  type WorkflowLimits,
} from '@creator/contracts';

// P13 (ADR-0092): the fixed rules an autopilot uses between steps. Pure functions, so every choice
// an autopilot makes can be checked without a model or a database.

/** The step after the steps so far, or null when the path is complete. */
export function nextAutopilotStage(
  config: Pick<AutopilotConfig, 'research'> &
    Partial<Pick<AutopilotConfig, 'start'>>,
  steps: readonly AutopilotStep[],
): AutopilotStage | null {
  const done = steps.filter((s) => s.state === 'done' || s.state === 'skipped');
  const last = done.at(-1);
  if (!last)
    return config.start
      ? config.start.stage
      : config.research
        ? 'research'
        : 'explore';
  switch (last.stage) {
    case 'research':
      return 'explore';
    case 'explore':
      // ADR-0139: an exploration that went on with an already-recorded problem skips to its
      // assessment (no brief or discovery to write).
      return last.problem ? 'assess' : 'brief';
    case 'brief':
      return 'discover';
    case 'discover':
      return 'assess';
    case 'assess':
      return 'select';
    case 'select':
      return last.option?.kind === 'build' ? 'spec' : 'proposal';
    case 'gather': {
      // ADR-0100: a fallback goes back to the step it gathered evidence for.
      const then = last.request?.then;
      return then === 'explore' ||
        then === 'brief' ||
        then === 'assess' ||
        then === 'select'
        ? then
        : null;
    }
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

/** The problem the autopilot works on: the one discovery found, or the one it started at. */
export function autopilotProblem(
  config: Pick<AutopilotConfig, 'start'>,
  steps: readonly AutopilotStep[],
): { id: string; version: number } | null {
  // The newest finished step that carried a problem: an assessment (of the problem's current
  // version, after a person changed it; ADR-0100), a discovery, or (ADR-0139) an exploration
  // that went on with an already-recorded problem. Review 1 of #260, L-2: by position, so a
  // later exploration wins over an older assessment.
  const found = [...steps]
    .reverse()
    .find(
      (s) =>
        (s.stage === 'assess' ||
          s.stage === 'discover' ||
          s.stage === 'explore') &&
        s.state === 'done' &&
        s.problem,
    );
  return found?.problem ?? config.start?.problem ?? null;
}

export type ChildLimits =
  | { ok: true; limits: WorkflowLimits; calls: number }
  | {
      ok: false;
      outcome: AutopilotOutcome;
      reason: string;
      kind: AutopilotStopKind;
      /** Set when Continue cannot help: the autopilot's own call limit is too small. */
      final?: string;
    };

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
  /**
   * ADR-0100 (live run 2): plan requests this run has already used on the connection; the
   * per-run cap counts every step of the run together, not each step on its own.
   */
  per_run_used?: number;
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
  const used = input.per_run_used ?? 0;
  const runRoom =
    input.per_run === null ? Number.MAX_SAFE_INTEGER : input.per_run - used;
  const cap = Math.min(wanted, input.remaining, runRoom);
  const label = AUTOPILOT_STAGE_LABEL[input.stage];
  if (cap < floor) {
    const connection = input.per_run !== null && runRoom < floor;
    return {
      ok: false,
      outcome: 'limit_reached',
      kind: connection ? 'run_cap' : 'call_limit',
      reason: connection
        ? used > 0
          ? `${label} needs at least ${floor} plan requests; this run has used ${used} of the plan connection's ${input.per_run} requests per run, so ${Math.max(0, runRoom)} are left. Raise the per-run cap under Models and connections › Change caps, accept it, then continue.`
          : `${label} needs at least ${floor} plan requests, above the connection's per-run cap of ${input.per_run}. Raise the cap under Models and connections, then continue.`
        : `${label} needs at least ${floor} model calls; the autopilot has ${Math.max(0, input.remaining)} left of its limit.`,
      ...(connection
        ? {}
        : {
            final:
              'Its call limit is used up and cannot be raised; start a new autopilot with a higher limit.',
          }),
    };
  }
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
      kind: 'end_time',
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
  /** ADR-0100 "try the next candidate": how many earlier candidates were already tried. */
  skip = 0,
):
  | { ok: true; ref: string; title: string; claims: string[] }
  | { ok: false; outcome: AutopilotOutcome; reason: string } {
  const kept = result.candidates.filter((c) => c.disposition === 'candidate');
  const first = kept[skip];
  if (!first && skip > 0)
    return {
      ok: false,
      outcome: 'insufficient_evidence',
      reason: `The exploration has no candidate problem left to try (${kept.length} tried).`,
    };
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

export type ChoiceFallback = {
  setting: AutopilotSettingKey;
  instead_of: AutopilotStopKind;
  note: string;
};

export type AutopilotChoice =
  | {
      ok: true;
      option: { id: string; version: number; kind: string; title: string };
      request: Omit<SelectRequest, 'data_class'>;
      /** ADR-0100: the owner's settings that let the rule choose instead of stopping. */
      fallbacks: ChoiceFallback[];
    }
  | {
      ok: false;
      outcome: AutopilotOutcome;
      reason: string;
      kind: AutopilotStopKind;
      /** Options a person or more evidence would have to settle (for evidence gathering). */
      options?: { id: string; title: string }[];
    };

const clip = (s: string, n = 1100) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

/**
 * Live rerun 3 (November 15): sensitivity scenarios are named by criterion key ("without
 * evidence_support"); a note says them in words ("evidence support is left out").
 */
export function scenarioWords(scenarios: readonly { name: string }[]): string {
  const said = scenarios.slice(0, 4).map(({ name }) => {
    const m = /^(without|double) (.+)$/.exec(name);
    if (!m) return name.replaceAll('_', ' ');
    const what = m[2]!.replaceAll('_', ' ');
    return m[1] === 'without' ? `${what} is left out` : `${what} counts double`;
  });
  return said.length > 1
    ? `${said.slice(0, -1).join(', ')} or ${said.at(-1)}`
    : (said[0] ?? '');
}

/** How a choice reads after "cannot be …". */
const DISPOSITION_PASSIVE: Partial<Record<string, string>> = {
  select_for_build: 'selected for build',
  proceed_to_validation: 'taken to validation',
  recommend_alternative: 'recommended',
  research_further: 'sent for more research',
};

type Row = SelectionReport['suitability']['candidates'][number];
/**
 * ADR-0139: the fixed tie order's last rule before the title: an existing tool first, then a
 * process change, human-led, hybrid, and software last; any other kind after those.
 */
const LEAST_BUILD = [
  'use_existing',
  'change_process',
  'human_led',
  'hybrid',
  'build',
];
export function leastBuild(kind: string): number {
  const i = LEAST_BUILD.indexOf(kind);
  return i < 0 ? LEAST_BUILD.length : i;
}
/** a − b for exact scores (sign only). */
const cmpScore = (a: ExactScore, b: ExactScore) => {
  const l = BigInt(a.numerator) * BigInt(b.denominator);
  const r = BigInt(b.numerator) * BigInt(a.denominator);
  return l === r ? 0 : l > r ? 1 : -1;
};

/**
 * Final UX pass N-3: the tied options in one short list, each title clipped and at most three
 * named ("“A”, “B”, “C” and 2 more"), instead of one run-on sentence naming every option.
 */
export function tiedNames(titles: readonly string[]): string {
  const named = titles.slice(0, 3).map((t) => `“${clip(t.trim(), 60)}”`);
  const more = titles.length - named.length;
  if (more > 0) return `${named.join(', ')} and ${more} more`;
  return named.length > 1
    ? `${named.slice(0, -1).join(', ')} and ${named.at(-1)}`
    : (named[0] ?? '');
}

/**
 * The autopilot's selection rule (no blind "highest number wins"): the option ranked first on
 * suitability is advanced only when it is fully scored, no other option shares its rank, the
 * first place holds when each criterion is removed or doubled, and no gate blocks its choice;
 * a software option must also lead the opportunity ranking. Every other option is deferred with
 * that reason. Anything else stops for a person, unless the owner's settings (ADR-0100) name a
 * fallback for that kind of stop: rank by the worst case, break a tie by a fixed order, keep the
 * leader of a close ranking, or go on to the next option the rule may advance.
 */
export function autopilotChoice(
  report: SelectionReport,
  settings: AutopilotSettingsValues = AUTOPILOT_SETTINGS_DEFAULT,
): AutopilotChoice {
  const all = report.suitability.candidates;
  if (!all.length)
    return {
      ok: false,
      outcome: 'no_eligible_option',
      kind: 'not_advanceable',
      reason: 'The problem has no options to choose from.',
    };
  const fallbacks: ChoiceFallback[] = [];
  // Options the rule could choose: kinds that may advance, kept as candidates by discovery.
  // An option nothing marked a candidate (one a person added later, for example) is not one.
  const choosable = (c: Row) =>
    autopilotDisposition(c.alternative.kind) !== null &&
    c.gates.discovery === 'candidate';
  // Unknown ratings are not neutral: an option that could be chosen and is not fully scored
  // might rank first once scored, so the rule does not choose past it (review M-2), unless the
  // owner chose the worst case (each unknown at 1), which never counts an unknown as neutral.
  const unscored = all.filter(
    (c) => choosable(c) && (c.rank === null || c.score === null),
  );
  const worst = unscored.length > 0;
  if (worst && !settings.choose_with_unknowns)
    return {
      ok: false,
      outcome: 'needs_person',
      kind: 'unknown_ratings',
      options: unscored.map((c) => ({
        id: c.alternative.id,
        title: c.alternative.title,
      })),
      reason: clip(
        `${unscored
          .map(
            (c) =>
              `“${c.alternative.title}” is ${
                c.status === 'unscored'
                  ? 'not scored'
                  : `not fully scored (unknown: ${c.unknown_criteria.map((x) => x.replaceAll('_', ' ')).join(', ') || 'some criteria'})`
              }`,
          )
          .join(
            '; ',
          )}. Unknown ratings are not neutral, so the rule does not choose past them. Score them under Decide (or choose there yourself), then continue.`,
      ),
    };
  if (worst)
    fallbacks.push({
      setting: 'choose_with_unknowns',
      instead_of: 'unknown_ratings',
      note: `Ranked by the worst case (each unknown rating at 1) because ${unscored.length} option${unscored.length === 1 ? ' is' : 's are'} not fully scored.`,
    });
  const ranked = worst
    ? all.filter((c) => c.range !== null)
    : all.filter((c) => c.rank !== null && c.score !== null);
  if (!ranked.length)
    return {
      ok: false,
      outcome: 'needs_person',
      kind: 'unknown_ratings',
      options: all
        .filter(choosable)
        .map((c) => ({ id: c.alternative.id, title: c.alternative.title })),
      reason:
        'No option is fully scored on suitability (unknown ratings are not neutral), so the ranking cannot choose. Score the options under Decide, then continue.',
    };
  const oppRank = new Map(
    report.opportunity.candidates
      .filter((c) => c.rank !== null && c.score !== null)
      .map((c) => [c.alternative.id, c.rank!]),
  );
  // Primary order: rank (or, by the worst case, the range's lower end); then, when the owner
  // allows breaking ties, opportunity rank, fewer unknowns, the better worst case, the option
  // that builds least, then the title.
  const primary = (a: Row, b: Row) =>
    worst ? cmpScore(b.range!.lower, a.range!.lower) : a.rank! - b.rank!;
  // Autopilot friction pass (ADR-0139): then an option the rule may choose, then the option that
  // builds least (invariant 2, humility before building), then the title, so a tie the scores
  // cannot separate still has one first option.
  const tiebreak = (a: Row, b: Row) =>
    (oppRank.get(a.alternative.id) ?? Infinity) -
      (oppRank.get(b.alternative.id) ?? Infinity) ||
    a.unknown_criteria.length - b.unknown_criteria.length ||
    (a.range && b.range ? cmpScore(b.range.lower, a.range.lower) : 0) ||
    Number(!choosable(a)) - Number(!choosable(b)) ||
    leastBuild(a.alternative.kind) - leastBuild(b.alternative.kind) ||
    (a.alternative.title < b.alternative.title
      ? -1
      : a.alternative.title > b.alternative.title
        ? 1
        : 0);
  const order = [...ranked].sort(
    (a, b) => primary(a, b) || (settings.break_ties ? tiebreak(a, b) : 0),
  );
  const same = (a: Row, b: Row) =>
    primary(a, b) === 0 && (!settings.break_ties || tiebreak(a, b) === 0);
  const tiedWith = (c: Row, among: readonly Row[]) =>
    among.filter((x) => x !== c && same(x, c));
  const firstTie = order.filter((c) => primary(c, order[0]!) === 0);
  if (firstTie.length > 1 && settings.break_ties) {
    if (tiedWith(order[0]!, order).length)
      return {
        ok: false,
        outcome: 'needs_person',
        kind: 'tie',
        reason: clip(
          `${firstTie.length} options tie for first${worst ? ' by the worst case' : ' on suitability'}: ${tiedNames(firstTie.map((c) => c.alternative.title))}. The fixed order (opportunity rank, fewer unknowns, the better worst case, an option the rule may choose, the option that builds least, the title) does not separate them. Choose one under Decide and continue.`,
        ),
      };
    fallbacks.push({
      setting: 'break_ties',
      instead_of: 'tie',
      note: `${firstTie.map((c) => `“${c.alternative.title}”`).join(' and ')} tied for first; the fixed order (opportunity rank, fewer unknowns, the better worst case, an option the rule may choose, the option that builds least, the title) put “${order[0]!.alternative.title}” first.`,
    });
  } else if (firstTie.length > 1)
    return {
      ok: false,
      outcome: 'needs_person',
      kind: 'tie',
      reason: clip(
        `${firstTie.length} options tie for first${worst ? ' by the worst case' : ' on suitability'}: ${tiedNames(firstTie.map((c) => c.alternative.title))}. The autopilot breaks ties only when you allow it (Break ties). Choose one under Decide and continue: the autopilot goes on with your choice.`,
      ),
    };
  const leader = order[0]!;
  const unstable = report.suitability.sensitivity.scenarios.filter(
    (s) => s.top_changed,
  );
  if (unstable.length && !settings.keep_close_leader)
    return {
      ok: false,
      outcome: 'needs_person',
      kind: 'close_ranking',
      reason: clip(
        `“${leader.alternative.title}” ranks first, but not when the weights change (${scenarioWords(unstable)}). A close ranking is a judgment for a person: choose under Decide and continue, and the autopilot goes on with your choice.`,
      ),
    };
  if (unstable.length)
    fallbacks.push({
      setting: 'keep_close_leader',
      instead_of: 'close_ranking',
      note: `Kept the leader under the owner's weights, although another option leads when ${scenarioWords(unstable)}.`,
    });
  // Why an option cannot be advanced now, or null when it can.
  const why = (
    c: Row,
  ): {
    kind: AutopilotStopKind;
    outcome: AutopilotOutcome;
    reason: string;
  } | null => {
    const kind = c.alternative.kind;
    const disposition = autopilotDisposition(kind);
    if (!disposition)
      return {
        kind: 'not_advanceable',
        outcome: 'no_eligible_option',
        reason: `The first-ranked option “${c.alternative.title}” is a ${kind.replaceAll('_', ' ')} outcome, which cannot be advanced.`,
      };
    const discovery = c.gates.discovery;
    if (discovery !== 'candidate')
      return {
        kind: 'not_advanceable',
        outcome: 'no_eligible_option',
        reason: discovery
          ? `Discovery marked “${c.alternative.title}” ${discovery.replaceAll('_', ' ')}, so it is not advanced.`
          : `“${c.alternative.title}” did not come from discovery as a candidate, so the rule does not advance it; choose under Decide if you want it.`,
      };
    const blocked = c.gates.blocked[disposition] ?? [];
    if (blocked.length)
      return {
        kind: 'gate_blocked',
        outcome: 'needs_person',
        // Live rerun 3 (November 15): "cannot be recommend alternative yet" read garbled, and
        // a long gate reason cut off what to do next. The disposition reads as a verb, and the
        // gate text is shortened (at a word) so the last sentence stays whole.
        reason: `“${c.alternative.title}” ranks first but cannot be ${DISPOSITION_PASSIVE[disposition] ?? disposition.replaceAll('_', ' ')} yet: ${cutWords(blocked.join(' '), 700)} Resolve it, or choose under Decide yourself, then continue.`,
      };
    if (disposition === 'select_for_build') {
      const opp = report.opportunity.candidates.filter(
        (x) => x.rank !== null && x.score !== null,
      );
      const lead = opp.length ? Math.min(...opp.map((x) => x.rank!)) : null;
      const leaders = opp.filter((x) => x.rank === lead);
      if (
        leaders.length !== 1 ||
        leaders[0]!.alternative.id !== c.alternative.id
      )
        return {
          kind: 'opportunity',
          outcome: 'needs_person',
          reason: `“${c.alternative.title}” leads on suitability but not alone on opportunity; building it would need an override reason, which is a person's judgment.`,
        };
    }
    return null;
  };
  let chosen = leader;
  const leaderWhy = why(leader);
  if (leaderWhy) {
    // A defer, decline or investigate outcome ranking first is the honest result, not a stop.
    const ownKind = autopilotDisposition(leader.alternative.kind) === null;
    const next =
      settings.next_candidate && !ownKind
        ? order.find((c) => c !== leader && !why(c))
        : undefined;
    if (!next)
      return {
        ok: false,
        outcome: leaderWhy.outcome,
        kind: leaderWhy.kind,
        reason: leaderWhy.reason,
        ...(leaderWhy.kind === 'gate_blocked'
          ? {
              options: [
                { id: leader.alternative.id, title: leader.alternative.title },
              ],
            }
          : {}),
      };
    const eligible = order.filter((c) => !why(c));
    if (tiedWith(next, eligible).length)
      return {
        ok: false,
        outcome: 'needs_person',
        kind: 'tie',
        reason: clip(
          `${leaderWhy.reason} The next options the rule may advance (${[next, ...tiedWith(next, eligible)].map((c) => `“${c.alternative.title}”`).join(', ')}) tie. Choose under Decide and continue.`,
        ),
      };
    fallbacks.push({
      setting: 'next_candidate',
      instead_of: leaderWhy.kind,
      note: clip(
        `${leaderWhy.reason.replace(/ Resolve it, or choose under Decide yourself, then continue\.$/, '')} Went on to “${next.alternative.title}”, the best option the rule may advance.`,
        600,
      ),
    });
    chosen = next;
  }
  const kind = chosen.alternative.kind;
  const disposition = autopilotDisposition(kind)!;
  const score =
    (worst ? chosen.range?.lower.display : chosen.score?.display) ?? 'n/a';
  const how = worst
    ? `Best worst case on suitability (${score}, each unknown rating at 1)`
    : `Ranked ${chosen === leader ? 'first' : chosen.rank} on suitability (${score})`;
  return {
    ok: true,
    fallbacks,
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
              reasons: fallbacks.length
                ? [
                    `${how}.`.slice(0, 500),
                    ...fallbacks.map((f) =>
                      `Owner's autopilot setting “${f.setting.replaceAll('_', ' ')}”: ${f.note}`.slice(
                        0,
                        500,
                      ),
                    ),
                  ].slice(0, 10)
                : [
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
                !choosable(c)
                  ? 'Not an option the rule can advance (its kind, or discovery did not keep it as a candidate).'
                  : c === leader
                    ? `Ranked first but not advanced: ${leaderWhy?.reason ?? ''}`.slice(
                        0,
                        500,
                      )
                    : `${worst ? 'A lower worst case' : `Ranked ${c.rank}`} on suitability; the autopilot advances only the option it chose.`,
              ],
              reverse_if:
                'A person compares the options and prefers this one, or it ranks first after new evidence.',
            },
      ),
      // A next option chosen past a higher-ranked one is outranked on purpose; the reason says why.
      override_reason:
        chosen === leader && !worst
          ? null
          : clip(
              [
                worst
                  ? "The owner's autopilot setting “choose with unknown ratings” ranks by the worst case (each unknown at 1), so a fully scored option can rank lower than its own rank shows."
                  : '',
                chosen === leader
                  ? ''
                  : `The higher-ranked “${leader.alternative.title}” cannot be advanced now (${leaderWhy!.kind.replaceAll('_', ' ')}); the owner's autopilot setting “try the next candidate” goes on to the best option that can.`,
              ]
                .filter(Boolean)
                .join(' '),
              1000,
            ),
      rationale: clip(
        fallbacks.length
          ? `Recorded by an unattended autopilot under the run's routine approvals (ADR-0092), with the owner's autopilot settings (ADR-0100): ${fallbacks.map((f) => f.note).join(' ')} “${chosen.alternative.title}” was chosen (${disposition.replaceAll('_', ' ')}). The scores are the automatic assessment's; a person can record a different selection at any time.`
          : `Recorded by an unattended autopilot under the run's routine approvals (ADR-0092). “${chosen.alternative.title}” ranked first on suitability (${score}) with no tie, the first place held when each criterion was removed or doubled, and no gate blocked ${disposition.replaceAll('_', ' ')}. The scores are the automatic assessment's; a person can record a different selection at any time.`,
      ),
      shortlist_size: 3,
    },
  };
}

/** Dispositions a person's choice can carry an autopilot on with, and where each goes next. */
const CARRIED: Partial<Record<SelectionDisposition, 'proposal' | 'spec'>> = {
  recommend_alternative: 'proposal',
  proceed_to_validation: 'proposal',
  select_for_build: 'spec',
};

/**
 * A selection a person recorded for the problem while the autopilot waited (review M-1): the
 * autopilot goes on with it instead of running its rule again. Only the current selection counts,
 * only one a person made (never an autopilot's) after the autopilot began, and only when it
 * advances exactly one option; one that advances none ends the path, several stop for the person.
 */
export function personChoice(
  selection: Selection | null,
  since: string,
):
  | { kind: 'none' }
  | {
      kind: 'carry';
      option: { id: string; version: number; kind: string; title: string };
      disposition: SelectionDisposition;
    }
  | { kind: 'stop'; outcome: AutopilotOutcome; reason: string } {
  if (
    !selection ||
    !selection.current ||
    selection.autopilot_id ||
    Date.parse(selection.created_at) < Date.parse(since)
  )
    return { kind: 'none' };
  const advancing = selection.dispositions.filter(
    (d) => CARRIED[d.disposition],
  );
  if (!advancing.length)
    return {
      kind: 'stop',
      outcome: 'no_eligible_option',
      reason:
        'Your selection under Decide advances no option (each is deferred, rejected or left for research), so the autopilot ends here.',
    };
  if (advancing.length > 1)
    return {
      kind: 'stop',
      outcome: 'needs_person',
      reason:
        'Your selection under Decide advances more than one option; the autopilot carries on with one. Record a selection that advances one, then continue.',
    };
  const d = advancing[0]!;
  const row = selection.report.suitability.candidates.find(
    (c) => c.alternative.id.toLowerCase() === d.alternative.id.toLowerCase(),
  );
  if (row?.alternative.kind === 'build' && d.disposition !== 'select_for_build')
    return {
      kind: 'stop',
      outcome: 'needs_person',
      reason:
        'Your selection advances a software option without selecting it for a build; a software option goes on to a spec, which stays with you.',
    };
  return {
    kind: 'carry',
    disposition: d.disposition,
    option: {
      id: d.alternative.id.toLowerCase(),
      version: d.alternative.version,
      kind:
        d.disposition === 'select_for_build'
          ? 'build'
          : (row?.alternative.kind ?? 'unknown'),
      title: row?.alternative.title ?? 'The option you chose',
    },
  };
}

/**
 * The note for a choice the run's admission did not record, and the question it left open, if
 * any. The Approvals sentence shows only for a question still open (review 2 N-1).
 */
export function notAdmitted(
  title: string,
  admission: {
    reason_code: string;
    explanation: string;
    decision_id: string | null;
  },
): { note: string; asked: string | null } {
  const open =
    !!admission.decision_id &&
    !admission.reason_code.startsWith('already_answered');
  return {
    note: `The choice of “${title}” was not admitted (${admission.reason_code}): ${admission.explanation}${
      open
        ? ' A person decides: choose under Decide yourself (the question also waits under Monitor › Approvals), then continue, and the autopilot goes on with your choice.'
        : ''
    }`.slice(0, 1200),
    asked: open ? admission.decision_id : null,
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
