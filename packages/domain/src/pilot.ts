import type { StudyInput } from '@creator/contracts';
import { canonicalHash } from './rules.js';
import { STUDY_FIXTURE_PRICING } from './study.js';

/**
 * T14 pilot rehearsal. Pilot tasks are synthetic and disjoint from any final task; no final
 * task has been chosen. Nothing here is empirical: AI arms use the fixture adapter because
 * live dispatch is disabled, and human arms are scripted plumbing entries, not participants.
 */
export const PILOT_VERSION = 'pilot/1';

const common = {
  schema_version: 'study/1' as const,
  synthetic: true as const,
  config: {
    model_version: STUDY_FIXTURE_PRICING.model_id,
    pricing_version: canonicalHash(STUDY_FIXTURE_PRICING),
    tool_access: [],
    candidate_count: 3,
    max_calls: 7,
    max_output_tokens: 2000,
    max_cost_nano_usd: '1000000000',
    max_retries: 0,
  },
  rubric: {
    version: 'pilot-rubric/1',
    text: 'Anchored 1-5 ratings of usefulness, feasibility, evidence support, differentiation and appropriateness (SCORING_RUBRIC.md anchors). Pilot calibration only.',
  },
  intervention_policy: {
    version: 'pilot-intervention/1',
    text: 'A: no task help; stop as needs_human. B: log every request and answer with type, gate, stage, data shown, input, change, active minutes and wait. C: no generative AI.',
  },
  analysis_plan: {
    version: 'pilot-analysis/1',
    text: 'Instrumentation checks and descriptive counts only. No performance comparison is computed from pilot data.',
  },
  missing_data_policy: {
    version: 'pilot-missing/1',
    text: 'Every assigned attempt stays in the flow table with its terminal state; unrun arms are reported as not run.',
  },
  stop_retry_rules: {
    version: 'pilot-stop/1',
    text: 'No retries. Stop at the time cap, budget cap or need for human judgment.',
  },
};

const autonomyProblem =
  'A fictional community tool library loses track of which volunteer holds returned items overnight.';
const autonomyOutcome =
  'Recommend a response, alternatives considered and a validation plan.';
export const PILOT_AUTONOMY: StudyInput = {
  ...common,
  title: 'Pilot rehearsal: autonomy arms (decision stratum)',
  protocol: {
    version: PILOT_VERSION,
    text: 'Pilot rehearsal of the three-arm comparison on one synthetic decision task. Instrumentation only; not a final task.',
  },
  packet: {
    version: 'pilot-autonomy/1',
    stratum: 'decision',
    problem: autonomyProblem,
    initial_resources: [
      {
        locator: 'fixture://tool-library/log',
        snapshot:
          'Synthetic log: 3 of 40 overnight returns last month had no recorded holder.',
      },
      {
        locator: 'fixture://tool-library/practice',
        snapshot:
          'Synthetic note: volunteers already use a paper sign-out sheet during the day.',
      },
    ],
    outcome: autonomyOutcome,
    structured_brief: {
      theme: 'Fictional tool library custody',
      fields: ['operations', 'information design'],
      target_users: 'Fictional volunteer staff',
      context: null,
      measurable_problem: autonomyProblem,
      outcome_measure: autonomyOutcome,
      data_and_tools: ['Synthetic return log', 'Paper sign-out sheet'],
      time_limit: 'One hour',
      budget_limit: 'Synthetic fixture budget only',
      nae_seed: null,
      constraints: ['Synthetic pilot task; no empirical conclusions.'],
    },
    time_cap_seconds: 3600,
  },
  primary_outcomes: ['Decision quality (not rated in the pilot rehearsal)'],
  assignment_seed: 'pilot-autonomy-seed-1',
};

const discoveryProblem =
  'Fictional commuters cannot tell whether a shared bike dock will have space on arrival.';
const discoveryOutcome =
  'Propose up to three responses with evidence and uncertainty.';
export const PILOT_DISCOVERY: StudyInput = {
  ...common,
  title: 'Pilot rehearsal: structured vs open-ended discovery',
  protocol: {
    version: PILOT_VERSION,
    text: 'Pilot rehearsal of one structured/open-ended discovery pair with matched packet, model, candidate count and caps.',
  },
  packet: {
    version: 'pilot-discovery/1',
    stratum: 'decision',
    problem: discoveryProblem,
    initial_resources: [
      {
        locator: 'fixture://bike-dock/survey',
        snapshot:
          'Synthetic survey: riders report arriving to full docks at peak hours.',
      },
    ],
    outcome: discoveryOutcome,
    structured_brief: {
      theme: 'Fictional bike-share dock availability',
      fields: ['transport', 'forecasting'],
      target_users: 'Fictional commuters',
      context: null,
      measurable_problem: discoveryProblem,
      outcome_measure: discoveryOutcome,
      data_and_tools: ['Synthetic rider survey'],
      time_limit: 'One hour',
      budget_limit: 'Synthetic fixture budget only',
      nae_seed: null,
      constraints: ['Synthetic pilot task; no empirical conclusions.'],
    },
    time_cap_seconds: 3600,
  },
  primary_outcomes: ['Evidence support and usefulness (not rated in pilot)'],
  assignment_seed: 'pilot-discovery-seed-1',
};

export type PilotArm = 'A' | 'B' | 'C' | 'D-structured' | 'D-open';
export interface PilotAttempt {
  arm: PilotArm;
  id: string;
  workspace_id: string;
  condition: string;
  discovery_method: string;
  state: string;
  primary: boolean;
  time_cap_seconds: number;
  /** The `finished` event payload, or null if the attempt never ended. */
  finish: Record<string, unknown> | null;
  measurements: Record<string, unknown>;
  reservations: { status: string }[];
  /** Event kinds in recorded order, with intervention payloads kept. */
  events: { kind: string; payload: Record<string, unknown> }[];
  /** The exact context the participant or runner received. */
  context: unknown;
  /** How the human part of this attempt was produced. */
  human_source: 'none' | 'scripted_rehearsal';
}
export interface PilotCheck {
  id: string;
  area:
    | 'metrics'
    | 'intervention_timing'
    | 'source_validation'
    | 'contamination'
    | 'reviewer_materials'
    | 'export';
  status: 'pass' | 'fail' | 'warn';
  detail: string;
}

/**
 * Instrumentation failures are problems with recording or running the study; substantive
 * failures are task outcomes (a stop for human judgment, insufficient evidence, budget).
 * Both are retained; only the first can justify a predefined infrastructure retry.
 */
export function classifyAttempt(a: PilotAttempt) {
  const m = a.measurements;
  if (!a.finish || a.state === 'assigned')
    return {
      class: 'instrumentation' as const,
      reason: 'Attempt never reached a terminal state.',
    };
  if (
    String(m.unknown_simulated_exposure_nano_usd ?? '0') !== '0' ||
    String(m.in_flight_simulated_exposure_nano_usd ?? '0') !== '0'
  )
    return {
      class: 'instrumentation' as const,
      reason: 'A provider outcome is unknown or still in flight.',
    };
  const outcome = String(a.finish.outcome ?? a.finish.status);
  if (outcome === 'deadline_exceeded')
    return {
      class: 'substantive' as const,
      reason: 'Time cap reached; counted against the assigned condition.',
    };
  if (a.state === 'failed' && !a.finish.outcome)
    return {
      class: 'instrumentation' as const,
      reason: 'Failed without a recorded task outcome.',
    };
  return {
    class: 'substantive' as const,
    reason: `Task outcome: ${outcome}.`,
  };
}

const REVEALING =
  /autonomous|human_in_loop|human_only|human-only|open_ended|open-ended|structured|condition|fixture_workflow|scripted/i;

function check(
  id: string,
  area: PilotCheck['area'],
  ok: boolean | 'warn',
  detail: string,
): PilotCheck {
  return {
    id,
    area,
    status: ok === 'warn' ? 'warn' : ok ? 'pass' : 'fail',
    detail,
  };
}

export function instrumentationChecks(input: {
  attempts: PilotAttempt[];
  sentinels: string[];
  export_hashes: [string, string][];
  reviewer_packet: unknown;
  reviewer_key: Record<string, string>;
}): PilotCheck[] {
  const { attempts } = input;
  const out: PilotCheck[] = [];
  const terminal = attempts.filter((a) => a.finish);
  out.push(
    check(
      'metrics.terminal',
      'metrics',
      terminal.length === attempts.length,
      `${terminal.length}/${attempts.length} attempts reached a terminal state.`,
    ),
  );
  const missingWall = attempts.filter(
    (a) => typeof a.measurements.wall_seconds !== 'number',
  );
  out.push(
    check(
      'metrics.wall_clock',
      'metrics',
      missingWall.length === 0,
      missingWall.length
        ? `No wall time for ${missingWall.map((a) => a.arm).join(', ')}.`
        : 'Every attempt has an observed wall time.',
    ),
  );
  const overCap = attempts.filter(
    (a) =>
      Number(a.measurements.wall_seconds) > a.time_cap_seconds &&
      a.finish?.outcome !== 'deadline_exceeded',
  );
  out.push(
    check(
      'metrics.time_cap',
      'metrics',
      overCap.length === 0,
      overCap.length
        ? `Over the cap without a deadline outcome: ${overCap.map((a) => a.arm).join(', ')}.`
        : 'No attempt exceeded its cap without a deadline outcome.',
    ),
  );
  const ai = attempts.filter((a) => a.condition !== 'human_only');
  const noCalls = ai.filter((a) => Number(a.measurements.calls) < 1);
  out.push(
    check(
      'metrics.ai_usage',
      'metrics',
      noCalls.length === 0,
      noCalls.length
        ? `AI arms with no recorded model call: ${noCalls.map((a) => a.arm).join(', ')}.`
        : `Every AI arm recorded calls and simulated spend (${ai.map((a) => `${a.arm}: ${String(a.measurements.calls)} calls`).join('; ')}).`,
    ),
  );
  const auto = attempts.filter((a) => a.condition === 'autonomous');
  out.push(
    check(
      'metrics.autonomous_human_effort',
      'metrics',
      auto.every((a) => a.measurements.human_active_minutes === 0),
      'Autonomous attempts record zero human task minutes.',
    ),
  );
  for (const a of attempts.filter((x) => x.condition === 'human_in_loop')) {
    const interventions = a.events.filter((e) => e.kind === 'interventions');
    const wall = Number(a.measurements.wall_seconds);
    const bad = interventions.filter(
      (e) =>
        Number(e.payload.wait_seconds) > wall ||
        Number(e.payload.human_active_minutes) * 60 > wall,
    );
    const finishAt = a.events.findIndex((e) => e.kind === 'finished');
    const late = a.events.findIndex(
      (e, i) => e.kind === 'interventions' && i > finishAt,
    );
    out.push(
      check(
        `timing.interventions.${a.arm}`,
        'intervention_timing',
        interventions.length > 0 && bad.length === 0 && late === -1,
        `${interventions.length} logged intervention(s); ${bad.length} with wait or active time longer than the attempt; ${late === -1 ? 'none' : 'some'} after finish.`,
      ),
    );
    out.push(
      check(
        `metrics.assisted_human_totals.${a.arm}`,
        'metrics',
        a.measurements.human_active_minutes === null ? 'warn' : true,
        a.measurements.human_active_minutes === null
          ? 'The workflow finish leaves assisted human totals empty; assisted effort must be summed from intervention rows (intervention_active_minutes).'
          : 'Assisted totals recorded at finish.',
      ),
    );
  }
  for (const a of attempts.filter((x) => x.discovery_method === 'structured')) {
    const outcome = String(a.finish?.outcome ?? '');
    out.push(
      check(
        `sources.unverified_snapshots.${a.arm}`,
        'source_validation',
        outcome === 'insufficient_evidence' || outcome === 'needs_human',
        `Packet snapshots are unverified, and the structured run ended with "${outcome}". Unverified snapshots must not count as supporting evidence.`,
      ),
    );
  }
  for (const a of attempts.filter((x) => x.discovery_method === 'open_ended')) {
    const ctx = a.context as Record<string, unknown>;
    const prompt = JSON.stringify(ctx.prompt ?? '');
    out.push(
      check(
        `contamination.baseline_treatment.${a.arm}`,
        'contamination',
        !('rubric' in ctx) &&
          !/skeptic|rubric|independent alternatives/i.test(prompt),
        'Open-ended baseline context has no rubric and no structured role prompt.',
      ),
    );
  }
  const leaked = attempts.filter((a) =>
    input.sentinels.some((s) => JSON.stringify(a.context).includes(s)),
  );
  out.push(
    check(
      'contamination.cross_arm_and_grader',
      'contamination',
      leaked.length === 0,
      leaked.length
        ? `Sentinel text reached: ${leaked.map((a) => a.arm).join(', ')}.`
        : `No other-arm output or grader sentinel appears in any of ${attempts.length} contexts.`,
    ),
  );
  out.push(
    check(
      'contamination.separate_workspaces',
      'contamination',
      new Set(attempts.map((a) => a.workspace_id)).size === attempts.length,
      'Each attempt has its own workspace.',
    ),
  );
  for (const a of attempts.filter((x) => x.condition === 'human_only')) {
    const allowed = a.reservations.filter((r) => r.status !== 'denied');
    out.push(
      check(
        `contamination.human_only_no_model.${a.arm}`,
        'contamination',
        allowed.length === 0 && Number(a.measurements.calls) === 0,
        `${allowed.length} admitted model reservations; ${a.events.filter((e) => e.kind === 'helper_denied').length} recorded helper denials.`,
      ),
    );
  }
  const packet = JSON.stringify(input.reviewer_packet);
  const ids = attempts.flatMap((a) => [a.id, a.workspace_id]);
  const revealing = packet.match(REVEALING);
  out.push(
    check(
      'reviewer.blinding',
      'reviewer_materials',
      !revealing && !ids.some((x) => packet.includes(x)),
      revealing
        ? `Reviewer packet contains the revealing term "${revealing[0]}".`
        : 'Reviewer packet has no condition terms, attempt ids or workspace ids.',
    ),
  );
  const keyed = Object.values(input.reviewer_key);
  out.push(
    check(
      'reviewer.key_complete',
      'reviewer_materials',
      attempts.every((a) => keyed.includes(a.id)) &&
        keyed.length === attempts.length,
      'The private key maps every packet code to exactly one assigned attempt.',
    ),
  );
  out.push(
    check(
      'export.repeatable',
      'export',
      input.export_hashes.every(([x, y]) => x === y),
      `${input.export_hashes.length} study exports re-exported to identical hashes.`,
    ),
  );
  return out;
}

/** Blinded packet: random codes, verbatim text, and no condition, method or id fields. */
export function reviewerPacket(
  items: { attempt_id: string; task: string; text: string | null }[],
  seed: string,
) {
  const coded = items
    .map((i) => ({
      ...i,
      code: canonicalHash({ seed, attempt: i.attempt_id }).slice(0, 8),
    }))
    .sort((a, b) => (a.code < b.code ? -1 : 1));
  return {
    packet: {
      schema_version: 'reviewer-packet/1',
      rubric: PILOT_AUTONOMY.rubric,
      items: coded.map((i) => ({
        code: i.code,
        task: i.task,
        submission: i.text ?? 'No submitted output.',
      })),
    },
    key: Object.fromEntries(coded.map((i) => [i.code, i.attempt_id])),
  };
}

// Documented reference price (config/pricing/openai-gpt-6-astra.json); unverified for the account.
const RATE_INPUT_NANO = 10_000n;
const RATE_OUTPUT_NANO = 50_000n;

export interface DesignOption {
  id: string;
  decision_tasks: number;
  implementation_tasks: number;
  discovery_themes: number;
  discovery_repeats: number;
  reviewers: number;
}
export const DESIGN_OPTIONS: DesignOption[] = [
  {
    id: 'minimal',
    decision_tasks: 2,
    implementation_tasks: 1,
    discovery_themes: 1,
    discovery_repeats: 1,
    reviewers: 1,
  },
  {
    id: 'proposed',
    decision_tasks: 4,
    implementation_tasks: 2,
    discovery_themes: 2,
    discovery_repeats: 2,
    reviewers: 2,
  },
  {
    id: 'historical-12-run',
    decision_tasks: 4,
    implementation_tasks: 2,
    discovery_themes: 2,
    discovery_repeats: 3,
    reviewers: 2,
  },
];

/**
 * Upper bounds, not forecasts: AI exposure assumes every call uses its full output cap and
 * the observed maximum input; human time assumes the full time cap. Reviewer minutes per
 * item is an explicit assumption until the calibration exercise measures it.
 */
export function estimateDesigns(input: {
  max_calls: number;
  max_output_tokens: number;
  observed_max_input_tokens: number;
  time_cap_minutes: number;
  implementation_time_cap_minutes: number;
  reviewer_minutes_per_item: number;
}) {
  const perRun =
    BigInt(input.max_calls) *
    (BigInt(input.observed_max_input_tokens) * RATE_INPUT_NANO +
      BigInt(input.max_output_tokens) * RATE_OUTPUT_NANO);
  const usd = (n: bigint) => (Number(n) / 1e9).toFixed(2);
  return DESIGN_OPTIONS.map((d) => {
    const tasks = d.decision_tasks + d.implementation_tasks;
    // Arms A and B use AI on every task; the discovery pair adds two AI runs per repeat.
    const discoveryRuns = d.discovery_themes * d.discovery_repeats * 2;
    const aiRuns = tasks * 2 + discoveryRuns;
    const humanMinutes =
      // C does the whole task; B is bounded by the same cap.
      2 *
      (d.decision_tasks * input.time_cap_minutes +
        d.implementation_tasks * input.implementation_time_cap_minutes);
    const items = tasks * 3 + discoveryRuns;
    return {
      ...d,
      assigned_runs: tasks * 3 + discoveryRuns,
      ai_runs: aiRuns,
      max_ai_exposure_usd: usd(perRun * BigInt(aiRuns)),
      max_participant_hours: +(humanMinutes / 60).toFixed(1),
      reviewer_items: items,
      reviewer_hours: +(
        (items * d.reviewers * input.reviewer_minutes_per_item) /
        60
      ).toFixed(1),
    };
  });
}

export interface ResearchDecision {
  id: string;
  question: string;
  options: string[];
  recommendation: string;
  blocks: string;
}
/** Consequential research decisions only the owner (with the committee) can settle. */
export const BLOCKING_DECISIONS: ResearchDecision[] = [
  {
    id: 'RD1-priority',
    question:
      'Is RQ1 (three-arm autonomy) the primary experiment, with RQ2 (discovery) as a smaller secondary study?',
    options: [
      'RQ1 primary, RQ2 secondary',
      'Both full experiments',
      'RQ1 only; RQ2 dropped',
    ],
    recommendation: 'RQ1 primary, RQ2 secondary',
    blocks: 'Counts, reviewer load and the primary outcome.',
  },
  {
    id: 'RD2-primary-outcome',
    question:
      'Confirm the primary outcomes: mean independent solution-quality rating per decision task, and functional completion for implementation tasks.',
    options: ['Confirm', 'Replace with another named outcome'],
    recommendation: 'Confirm',
    blocks: 'Freeze; the outcome must be named before final collection.',
  },
  {
    id: 'RD3-participants',
    question:
      'Who does the human-only and assisted work, and how is same-problem familiarity handled?',
    options: [
      'Jordan alone, single-participant case study, matched task variants',
      'Jordan alone, same tasks, counterbalanced order',
      'Recruit independent participants (needs RD5 first)',
    ],
    recommendation:
      'Jordan alone, single-participant case study, matched task variants',
    blocks: 'Arms B and C, task packet design and all claims about humans.',
  },
  {
    id: 'RD4-reviewers',
    question:
      'Who independently rates submissions, how many, and are they blind to condition?',
    options: [
      'Two independent human reviewers, blinded',
      'One human reviewer, blinded, plus model judge as secondary',
      'Jordan rates (not independent; reported as a limitation)',
    ],
    recommendation: 'Two independent human reviewers, blinded',
    blocks: 'The primary quality outcome and agreement statistics.',
  },
  {
    id: 'RD5-human-subjects',
    question:
      'What does the committee or UF IRB say applies to participants and reviewers?',
    options: [
      'Determination obtained (record its reference)',
      'Not human-subjects research (record who decided)',
    ],
    recommendation: 'Determination obtained (record its reference)',
    blocks:
      'Freeze, and any recruitment or collection of participant or reviewer data.',
  },
  {
    id: 'RD6-model-and-cap',
    question:
      'Which verified model id runs the AI arms, and what total live spending cap is approved for T15?',
    options: [
      'gpt-6-astra after account verification, with a stated cap',
      'Another verified model, with a stated cap',
      'Fixture only; no live AI results',
    ],
    recommendation: 'gpt-6-astra after account verification, with a stated cap',
    blocks: 'Every live AI run; no cap means no dispatch.',
  },
  {
    id: 'RD7-design-counts',
    question:
      'Which design and counts are adopted (see the estimate table), with what time caps?',
    options: ['minimal', 'proposed', 'historical-12-run'],
    recommendation: 'proposed',
    blocks: 'The assignment schedule and resource limits.',
  },
  {
    id: 'RD8-final-tasks',
    question:
      'Which domains and final tasks are used? They must be chosen without looking at pilot performance.',
    options: [
      'Owner picks from NAE themes, low-risk, disjoint from pilot tasks',
      'Committee supplies tasks',
    ],
    recommendation:
      'Owner picks from NAE themes, low-risk, disjoint from pilot tasks',
    blocks: 'Task packets and their hashes.',
  },
  {
    id: 'RD9-source-snapshots',
    question:
      'Final packets: supply sources through the verified source broker, or accept that unverified snapshots end structured runs as insufficient evidence?',
    options: [
      'Fetch and verify packet sources before freezing',
      'Keep unverified snapshots and report the outcome',
    ],
    recommendation: 'Fetch and verify packet sources before freezing',
    blocks:
      'Whether the structured arm can succeed at all on decision tasks (pilot finding).',
  },
  {
    id: 'RD10-retry-and-search',
    question:
      'Infrastructure retry rule and the human-only AI-summary rule: one retry for a run that fails before any task output, and disable/avoid search AI summaries with deviations logged?',
    options: ['Adopt both as written', 'Change either rule'],
    recommendation: 'Adopt both as written',
    blocks: 'Stop/retry rules and the human-only tool policy.',
  },
];

export interface OwnerDecision {
  id: string;
  choice: string;
  rationale: string;
}

/**
 * The proposal is frozen only when every blocking decision has an explicit owner answer that
 * is not a deferral, recorded against the exact proposal hash the owner reviewed.
 */
export function freezeProtocol(
  proposal: unknown,
  submission: { proposal_hash: string; decisions: OwnerDecision[] },
) {
  const proposalHash = canonicalHash(proposal);
  const byId = new Map(submission.decisions.map((d) => [d.id, d]));
  const blocking = BLOCKING_DECISIONS.filter((d) => {
    const answer = byId.get(d.id);
    return (
      !answer ||
      !answer.choice.trim() ||
      !answer.rationale.trim() ||
      /^(pending|defer)/i.test(answer.choice.trim())
    );
  }).map((d) => ({
    id: d.id,
    question: d.question,
    recommendation: d.recommendation,
  }));
  const unknown = submission.decisions
    .map((d) => d.id)
    .filter((id) => !BLOCKING_DECISIONS.some((d) => d.id === id));
  if (submission.proposal_hash !== proposalHash)
    return {
      status: 'blocked' as const,
      reason: 'The decisions were recorded against a different proposal.',
      proposal_hash: proposalHash,
      blocking: BLOCKING_DECISIONS.map((d) => d.id),
    };
  if (blocking.length || unknown.length)
    return {
      status: 'blocked' as const,
      reason: unknown.length
        ? `Unknown decision ids: ${unknown.join(', ')}.`
        : 'Consequential research decisions are unsettled.',
      proposal_hash: proposalHash,
      blocking: blocking.map((d) => d.id),
    };
  const manifest = {
    schema_version: 'protocol-freeze/1',
    proposal_hash: proposalHash,
    proposal,
    decisions: BLOCKING_DECISIONS.map((d) => byId.get(d.id)!),
  };
  return {
    status: 'adopted' as const,
    manifest,
    freeze_hash: canonicalHash(manifest),
  };
}

/**
 * Proposed final protocol (T14). The server freezes exactly this object, never a
 * caller-supplied one, so a freeze cannot quietly change the design the owner reviewed.
 * Items marked with a decision id stay proposals until that decision is recorded.
 */
export const PROPOSED_PROTOCOL = {
  schema_version: 'proposed-protocol/1',
  version: 'final-proposal/1',
  status: 'proposed_not_adopted',
  questions: {
    primary: 'RQ1 three-arm autonomy comparison',
    secondary: 'RQ2 structured vs open-ended discovery, smaller study',
    decision: 'RD1-priority',
  },
  primary_outcomes: {
    decision_stratum:
      'Mean independent anchored solution-quality rating per task (1-5, five dimensions kept visible)',
    implementation_stratum:
      'Frozen acceptance cases (including held-out cases) passed on the submitted version',
    decision: 'RD2-primary-outcome',
  },
  secondary_outcomes: [
    'Evidence reliability: claim census of source existence, locator accuracy and support',
    'Human judgment: necessary, missed and unnecessary interventions (owner-coded)',
    'Resource use: known spend, unknown exposure, calls, retries, active AI time, human active and wait minutes',
    'Traceability: required source/decision/spec/commit/test links present',
  ],
  task_strata: {
    decision:
      'Source-backed assessment, alternatives, recommendation, validation plan',
    implementation:
      'Bounded Python CLI task on the reviewed T11/T12 template with frozen and held-out cases',
    humility_cases:
      'Six low-risk synthetic challenge cases (existing tool, process change, missing evidence, stakeholder judgment, proceed, malicious source) with labels kept outside runtime context',
    pilot_tasks_excluded: ['pilot-autonomy/1', 'pilot-discovery/1'],
    selection_decision: 'RD8-final-tasks',
  },
  counts: {
    design: 'proposed',
    decision_tasks: 4,
    implementation_tasks: 2,
    arms_per_task: 3,
    discovery_themes: 2,
    discovery_repeats: 2,
    decision: 'RD7-design-counts',
  },
  participants_and_reviewers: {
    participants:
      'Single-participant exploratory case study (Jordan) with matched task variants; prior familiarity and order recorded; B helper never sees A output, references or hidden tests',
    reviewers:
      'Two independent human reviewers, blinded packets, randomized order, private key kept by owner; model judges secondary and labelled',
    calibration:
      'Rubric calibration on non-study examples before rating; individual ratings retained',
    decisions: ['RD3-participants', 'RD4-reviewers', 'RD5-human-subjects'],
  },
  resource_limits: {
    per_ai_run: {
      max_calls: 7,
      max_output_tokens_per_call: 2000,
      max_retries: 0,
      candidate_count: 3,
    },
    time_cap_minutes: { decision: 60, implementation: 90 },
    total_live_cap: 'unset until RD6',
    concurrency: 'one run at a time',
    decision: 'RD6-model-and-cap',
  },
  versions: {
    model: 'unverified until RD6 (reference: gpt-6-astra)',
    prompts: {
      structured: 'study-structured/1 + r02-discovery/1.0',
      open_ended: 'study-open-ended/1',
      human: 'study-human/1',
    },
    rubric:
      'pilot-rubric/1 anchors (SCORING_RUBRIC.md), recalibrated before freeze',
    intervention_policy: 'pilot-intervention/1',
  },
  sources: {
    rule: 'Packet sources fetched through the verified source broker and frozen by hash',
    decision: 'RD9-source-snapshots',
  },
  missing_data_and_stop_rules: {
    missing:
      'Every assigned run stays in the flow table; blocked, needs_human, cancelled and budget_exhausted runs keep their assigned condition; no imputation of quality ratings',
    stop: 'Stop at time cap, budget cap or need for human judgment; autonomous needs_human may get a linked assisted continuation excluded from the primary A outcome',
    retry:
      'One retry only for an infrastructure failure before any task output; every attempt retained',
    human_only_tools:
      'Avoid or disable search AI summaries; log any exposure as a deviation',
    decision: 'RD10-retry-and-search',
  },
  analysis: {
    unit: 'Task (paired across arms); ideas nested within runs are dependent',
    primary:
      'Task-level paired differences and distributions per stratum; descriptive with bootstrap intervals over tasks only where justified',
    agreement:
      'Weighted kappa or Krippendorff alpha for two reviewers plus raw disagreements',
    cost: 'Cost per accepted outcome including failures; undefined when no accepted outcome',
    exploratory:
      'Per-protocol analysis reported separately from assigned-condition',
  },
  limitations: [
    'Single participant: findings describe one person, not human work in general',
    'Small task counts: no power or general superiority claims',
    'One provider model: shared-model correlated errors across roles',
    'Fixture pilot: no pilot quality, timing or cost evidence for live models or people',
    'Reviewer time per item is assumed until calibration measures it',
  ],
} as const;
