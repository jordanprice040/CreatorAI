import { z, id, hash, version, timestamp } from './primitives.js';
import {
  DataClassSchema,
  type RoutinePolicy,
  type RoutinePolicyInput,
  type RoutineStage,
} from './oversight.js';
import { WorkflowResourceSetupSchema } from './orchestration.js';
import {
  AUTOPILOT_MIN_CALLS,
  AutopilotConfigSchema,
  autopilotRoutinePolicy,
  autopilotStagesNeeded,
  type AutopilotConfig,
} from './autopilot.js';

// P33 (ADR-0099): automation levels for a project (a run). Four presets over what already exists,
// so no level adds authority of its own:
//   manual     nothing is automated (routine approvals, if any, stay as the owner set them);
//   selection  "Automate selection": whenever an assessment on this run finishes, the studio starts
//              a selection-only autopilot (P13) on that problem, which chooses by P13's fixed rule
//              and writes a proposal for a non-code option, or stops for a person;
//   rest       "Automate the rest": an autopilot entering the path part way, at assessment or
//              selection of a problem already recorded on a running project;
//   whole      "Whole process": P13's autopilot from the start, on a new run.
// Each level's routine approvals are a P10 policy preset (ADR-0079) the owner confirms as one
// summary; the autopilots it starts are admitted only by that policy. External effects, value
// questions and a gate only the model cleared still stop for a person (ADR-0090, ADR-0092).

export const AUTOMATION_POLICY_VERSION = 'automation/1.0' as const;

export const AutomationLevelSchema = z.enum([
  'manual',
  'selection',
  'rest',
  'whole',
]);
export type AutomationLevel = z.infer<typeof AutomationLevelSchema>;

export const AUTOMATION_LEVEL_TEXT: Record<
  AutomationLevel,
  { label: string; text: string }
> = {
  manual: {
    label: 'Manual',
    text: 'You take every step. Nothing is automated beyond routine approvals you set yourself.',
  },
  selection: {
    label: 'Automate selection',
    text: 'You run the evidence, discovery and assessment. Each time an assessment on this run finishes, the studio chooses by its fixed rule and writes a proposal for a non-code option, or stops and asks you.',
  },
  rest: {
    label: 'Automate the rest',
    text: 'For a project already going: from a recorded problem, the studio assesses the options (or uses the scores already recorded), chooses by its fixed rule and writes a proposal, or stops and asks you.',
  },
  whole: {
    label: 'Whole process',
    text: 'A new run where the studio takes every step from the evidence to a proposal (Run it for me), stopping where a step needs you.',
  },
};

/** The routine stages each level needs on the run's policy. */
export function automationStagesNeeded(
  level: Exclude<AutomationLevel, 'manual'>,
  opts: { research?: boolean; start?: 'assess' | 'select' } = {},
): RoutineStage[] {
  if (level === 'selection') return ['selection'];
  if (level === 'rest')
    return autopilotStagesNeeded(false, {
      stage: opts.start ?? 'assess',
      problem: { id: '00000000-0000-4000-8000-000000000000', version: 1 },
    });
  return autopilotStagesNeeded(!!opts.research);
}

/** Selections one "Automate selection" level may admit over its life (each one is one step). */
export const AUTOMATION_SELECTION_ACTIONS = 20;

/** What the owner chooses for "Automate selection" on a run. */
export const RunAutomationConfigSchema = z.strictObject({
  /**
   * The route named on the autopilots it starts. Choosing makes no model call (it reads the
   * scores already recorded), so this only fixes which route the records name.
   */
  resource_setup: WorkflowResourceSetupSchema,
  /** The data class its selections are admitted under (the run's policy must cover it). */
  data_class: DataClassSchema,
  /** It starts nothing after this; at most 90 days ahead. */
  ends_at: timestamp,
});
export type RunAutomationConfig = z.infer<typeof RunAutomationConfigSchema>;

export const SetRunAutomationRequestSchema = z.strictObject({
  level: z.literal('selection'),
  config: RunAutomationConfigSchema,
  /** The summary lines the owner confirmed; refused when they differ from `runAutomationSummary`. */
  summary_seen: z.array(z.string().max(600)).min(1).max(20),
});
export type SetRunAutomationRequest = z.infer<
  typeof SetRunAutomationRequestSchema
>;

export const StopRunAutomationRequestSchema = z.strictObject({
  expected_version: version.optional(),
  reason: z.string().trim().min(1).max(300).optional(),
});

export const RunAutomationSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  fixture: z.boolean(),
  level: z.literal('selection'),
  config: RunAutomationConfigSchema,
  config_hash: hash,
  summary: z.array(z.string().max(600)),
  policy_version: z.string().max(40),
  state: z.enum(['active', 'stopped']),
  /** Why it stopped (the owner, its end time, the run's approvals no longer cover it). */
  stop_reason: z.string().max(600).nullable(),
  version,
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
  stopped_at: timestamp.nullable(),
  /** Autopilots it has started, newest first (at most 10 listed). */
  autopilots: z
    .array(
      z.strictObject({
        id,
        problem_id: id,
        state: z.enum(['running', 'finished']),
        outcome: z.string().max(40).nullable(),
        created_at: timestamp,
      }),
    )
    .max(10),
  /** Every autopilot it has started. */
  started: z.number().int().min(0),
});
export type RunAutomation = z.infer<typeof RunAutomationSchema>;

/** The lines the owner confirms for "Automate selection". */
export function runAutomationSummary(c: RunAutomationConfig): string[] {
  const until = new Date(c.ends_at).toISOString();
  return [
    'Automate selection on this run: each time an assessment of a problem on this run finishes, the studio starts an autopilot that chooses for that problem. It checks for finished assessments about once a minute.',
    'It chooses only when one option ranks first on suitability with no tie, every option that could be chosen is fully scored, the ranking holds when any criterion is removed or doubled, and nothing blocks that choice. Otherwise it stops and says why. Its choice is recorded as the autopilot’s, not yours.',
    'If an option’s ethics gate was cleared only on the model’s word, it stops and asks you before choosing it. A problem you have already chosen for since its assessment is left to you.',
    'For a non-code option it then saves a proposal drafted from the records. A software option needs your humility review and its spec stays with you, so it stops there.',
    `It makes no model call. Selections are admitted by this run's routine approvals for ${c.data_class.replaceAll('_', ' ')} data; it starts nothing after ${until.slice(0, 10)} ${until.slice(11, 16)} UTC.`,
    'It never publishes, sends messages, spends money, changes permissions or answers a question for you. Set the level back to Manual at any time; what it made so far is kept.',
  ];
}

/**
 * The autopilot "Automate selection" starts for one problem: enter at `select` of the problem at
 * its current version, the smallest call limit (it makes no model call), ending with the level.
 */
export function automationAutopilotConfig(
  c: RunAutomationConfig,
  problem: { id: string; version: number },
): AutopilotConfig {
  return AutopilotConfigSchema.parse({
    resource_setup: c.resource_setup,
    data_class: c.data_class,
    limits: { max_calls: AUTOPILOT_MIN_CALLS, ends_at: c.ends_at },
    start: { stage: 'select', problem },
  });
}

/** The routine approvals a run with no policy gets for "Automate selection". */
export function selectionRoutinePolicy(
  c: Pick<RunAutomationConfig, 'data_class' | 'ends_at'>,
): RoutinePolicyInput {
  return {
    stages: ['selection'],
    data_classes: [c.data_class],
    max_actions: AUTOMATION_SELECTION_ACTIONS,
    max_total_nano_usd: null,
    stop_on: ['person_rejects', 'unknown_outcome'],
    expires_at: new Date(c.ends_at).toISOString(),
    rationale:
      'Set up with Automate selection: choosing for problems assessed on this run, nothing else.',
  };
}

/** The routine approvals a run with no policy gets for "Automate the rest" (P13's preset). */
export function restRoutinePolicy(
  c: AutopilotConfig,
  maxTotalNanoUsd: string | null,
): RoutinePolicyInput {
  return {
    ...autopilotRoutinePolicy(c, maxTotalNanoUsd),
    rationale:
      'Set up with Automate the rest: the steps its autopilot takes on this run, nothing else.',
  };
}

/** A policy's chosen values, for a revision. */
export function policyInputOf(p: RoutinePolicy): RoutinePolicyInput {
  return {
    stages: [...p.stages].sort(),
    data_classes: [...p.data_classes].sort(),
    max_actions: p.max_actions,
    max_total_nano_usd: p.max_total_nano_usd,
    stop_on: [...p.stop_on].sort(),
    expires_at: new Date(p.expires_at).toISOString(),
    rationale: p.rationale,
  };
}

/**
 * What a level still needs from a run's active policy: null when the policy already covers it,
 * otherwise the revised policy (the stages, data classes and end time added; `extraActions`
 * more steps; money left as it was unless the level needs more). The owner confirms the revised
 * summary as a revision, which the oversight store records as widened.
 */
export function policyCovering(
  current: RoutinePolicyInput,
  need: {
    stages: readonly RoutineStage[];
    data_classes: readonly RoutinePolicyInput['data_classes'][number][];
    ends_at: string;
    extraActions: number;
    max_total_nano_usd?: string | null;
  },
): RoutinePolicyInput | null {
  const stages = [...new Set([...current.stages, ...need.stages])].sort();
  const classes = [
    ...new Set([...current.data_classes, ...need.data_classes]),
  ].sort();
  const ends = Math.max(
    Date.parse(current.expires_at),
    Date.parse(need.ends_at),
  );
  const money =
    need.max_total_nano_usd == null
      ? current.max_total_nano_usd
      : current.max_total_nano_usd === null ||
          BigInt(need.max_total_nano_usd) > BigInt(current.max_total_nano_usd)
        ? need.max_total_nano_usd
        : current.max_total_nano_usd;
  const covered =
    stages.length === current.stages.length &&
    classes.length === current.data_classes.length &&
    ends === Date.parse(current.expires_at) &&
    money === current.max_total_nano_usd;
  if (covered) return null;
  return {
    ...current,
    stages,
    data_classes: classes,
    expires_at: new Date(ends).toISOString(),
    max_actions: current.max_actions + need.extraActions,
    max_total_nano_usd: money,
  };
}
