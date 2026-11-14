import { z, id, version, counter, timestamp } from './primitives.js';

// ADR-0100: the owner's autopilot settings, one versioned record per workspace. Each switch lets an
// autopilot (Run it for me, Automate the rest, Automate selection) take a planned fallback instead
// of stopping for a person at one kind of stop. All are off until the owner turns them on; none
// grants authority (every step is still admitted by the run's routine approvals), raises a budget
// or a connection cap, or overrides a gate the selection rules refuse for everyone.

export const AutopilotSettingsValuesSchema = z.strictObject({
  /** Link claims, search the web and explore or assess again when evidence is thin. */
  gather_evidence: z.boolean(),
  /** Extra web searches one autopilot may run to gather evidence (2 plan requests each). */
  max_extra_searches: z.number().int().min(0).max(3),
  /** Choose by the worst case (each unknown rating at 1) when options are not fully scored. */
  choose_with_unknowns: z.boolean(),
  /** Break a tie for first by a fixed order: opportunity rank, fewer unknowns, better worst case. */
  break_ties: z.boolean(),
  /** Keep the leader under the owner's weights when a weight check changes the leader. */
  keep_close_leader: z.boolean(),
  /** Move on to the next candidate problem, or the next option the rule can advance. */
  next_candidate: z.boolean(),
  /** Try a step whose answer failed or was malformed again, up to this many times. */
  retry_failed: z.number().int().min(0).max(2),
  /**
   * Jordan, November 14: choose an option whose ethics gate only the model cleared, flagged on
   * the record for a person to look at. Off by default and never part of Hands-off.
   */
  choose_model_ethics: z.boolean(),
});
export type AutopilotSettingsValues = z.infer<
  typeof AutopilotSettingsValuesSchema
>;

export const AUTOPILOT_SETTINGS_DEFAULT: AutopilotSettingsValues = {
  gather_evidence: false,
  max_extra_searches: 0,
  choose_with_unknowns: false,
  break_ties: false,
  keep_close_leader: false,
  next_candidate: false,
  retry_failed: 0,
  choose_model_ethics: false,
};

/** Hands-off: every fallback except the ethics switch, which keeps the value it had. */
export function handsOff(v: AutopilotSettingsValues): AutopilotSettingsValues {
  return {
    gather_evidence: true,
    max_extra_searches: 3,
    choose_with_unknowns: true,
    break_ties: true,
    keep_close_leader: true,
    next_candidate: true,
    retry_failed: 1,
    choose_model_ethics: v.choose_model_ethics,
  };
}
export function isHandsOff(v: AutopilotSettingsValues): boolean {
  const h = handsOff(v);
  return (Object.keys(h) as (keyof AutopilotSettingsValues)[]).every(
    (k) => k === 'choose_model_ethics' || v[k] === h[k],
  );
}

export const AutopilotSettingsSchema = z.strictObject({
  workspace_id: id,
  values: AutopilotSettingsValuesSchema,
  /** 0 until the owner first saves. */
  version: counter,
  updated_by: id.nullable(),
  updated_at: timestamp.nullable(),
  /** Whether the reader may change them (the owner). */
  can_change: z.boolean(),
});
export type AutopilotSettings = z.infer<typeof AutopilotSettingsSchema>;

export const SaveAutopilotSettingsRequestSchema = z.strictObject({
  /** The version the owner saw (0 before the first save). */
  expected_version: counter,
  values: AutopilotSettingsValuesSchema,
});

/** The kind of stop an autopilot made, so the card can offer the matching fallback or next step. */
export const AutopilotStopKindSchema = z.enum([
  'thin_evidence',
  'unknown_ratings',
  'tie',
  'close_ranking',
  'not_advanceable',
  'gate_blocked',
  'opportunity',
  'model_ethics',
  'failed_step',
  'person_choice',
  'approval',
  'paused',
  'run_cap',
  'daily_cap',
  'call_limit',
  'end_time',
  'spec',
  'other',
]);
export type AutopilotStopKind = z.infer<typeof AutopilotStopKindSchema>;

/** The setting that would have let the autopilot take a fallback at this kind of stop. */
export const SETTING_FOR_STOP: Partial<
  Record<AutopilotStopKind, keyof AutopilotSettingsValues>
> = {
  thin_evidence: 'gather_evidence',
  unknown_ratings: 'choose_with_unknowns',
  tie: 'break_ties',
  close_ranking: 'keep_close_leader',
  not_advanceable: 'next_candidate',
  gate_blocked: 'next_candidate',
  opportunity: 'next_candidate',
  model_ethics: 'choose_model_ethics',
  failed_step: 'retry_failed',
};

export const AUTOPILOT_SETTING_TEXT: Record<
  keyof AutopilotSettingsValues,
  { label: string; text: string }
> = {
  gather_evidence: {
    label: 'Gather evidence when it is thin',
    text: 'Links recorded claims that name the problem or its options, searches the web (on a plan connection, public data only) and explores or assesses again.',
  },
  max_extra_searches: {
    label: 'Extra web searches per autopilot',
    text: 'Each takes 2 plan requests from the autopilot’s limit.',
  },
  choose_with_unknowns: {
    label: 'Choose with unknown ratings',
    text: 'Ranks by the worst case (each unknown at 1) and chooses the option whose worst case is best, when exactly one is.',
  },
  break_ties: {
    label: 'Break ties',
    text: 'A tie for first goes to the better opportunity rank, then fewer unknowns, then the better worst case.',
  },
  keep_close_leader: {
    label: 'Keep the leader of a close ranking',
    text: 'Keeps the option first under your weights when a weight check would change the leader.',
  },
  next_candidate: {
    label: 'Try the next candidate',
    text: 'Moves on to the next candidate problem when discovery finds too little, and to the next option it may advance when the first is blocked or cannot be advanced.',
  },
  retry_failed: {
    label: 'Retry a failed step',
    text: 'Tries a step whose answer failed or was malformed again, as a new attempt.',
  },
  choose_model_ethics: {
    label: 'Choose when only the model cleared ethics',
    text: 'Chooses an option whose ethics gate only the model cleared; the selection and proposal say “Ethics checked by the model only: look at it”.',
  },
};

/** The value a setting takes when "Allow this from now on" turns it on. */
export function settingOn(
  v: AutopilotSettingsValues,
  key: keyof AutopilotSettingsValues,
): AutopilotSettingsValues {
  if (key === 'max_extra_searches' || key === 'gather_evidence')
    return {
      ...v,
      gather_evidence: true,
      max_extra_searches: Math.max(1, v.max_extra_searches),
    };
  if (key === 'retry_failed')
    return { ...v, retry_failed: Math.max(1, v.retry_failed) };
  return { ...v, [key]: true };
}

export const AllowAndContinueRequestSchema = z.strictObject({
  /** The autopilot version the owner saw. */
  expected_version: version,
  /** The settings version the owner saw (0 before the first save). */
  settings_version: counter,
  /** The setting to turn on; it must be the one this stop names. */
  setting: AutopilotSettingsValuesSchema.keyof(),
});

/** A next step offered on a stopped autopilot. */
export const AutopilotNextKindSchema = z.enum([
  'allow_and_continue',
  'continue',
  'decide',
  'approvals',
  'search_web',
  'link_claims',
  'exploration',
  'models',
  'add_requests',
  'spec',
  'proposals',
  'new_autopilot',
]);
export const AutopilotNextSchema = z.strictObject({
  kind: AutopilotNextKindSchema,
  label: z.string().max(120),
  detail: z.string().max(300),
  /** For allow_and_continue: the setting it turns on. */
  setting: AutopilotSettingsValuesSchema.keyof().optional(),
});
export type AutopilotNext = z.infer<typeof AutopilotNextSchema>;

/** Why a step's fallback was taken, recorded on the step for provenance. */
export const AutopilotFallbackSchema = z.strictObject({
  setting: AutopilotSettingsValuesSchema.keyof(),
  settings_version: counter,
  /** The stop it replaced. */
  instead_of: AutopilotStopKindSchema,
  note: z.string().max(600),
});
export type AutopilotFallback = z.infer<typeof AutopilotFallbackSchema>;

export type AutopilotSettingKey = keyof AutopilotSettingsValues;

/** ADR-0100: the flag on a selection (and its proposal) an autopilot made past model-only ethics. */
export const MODEL_ONLY_ETHICS_NOTE =
  'Ethics checked by the model only: look at it.' as const;
