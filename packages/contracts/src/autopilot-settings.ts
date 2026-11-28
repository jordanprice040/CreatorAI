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
  /**
   * Break a tie for first by a fixed order: opportunity rank, fewer unknowns, better worst case,
   * then (ADR-0139) the option that builds least, then the title.
   */
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
  /**
   * Jordan, November 14 (P-12): let the autopilot use web claims whose only check is that their
   * quotes were found word for word. Off by default, so they wait for a person; never part of
   * Hands-off. Each one it uses is labelled `AUTOPILOT_QUOTE_CHECK_LABEL`.
   */
  accept_quote_checked_claims: z.boolean(),
  /**
   * ADR-0101 (P-5): after saving a proposal, ask the chat model to draft its unknown plan
   * sections. The drafts wait under their sections; a person still uses each one.
   */
  draft_proposal_sections: z.boolean(),
  /**
   * ADR-0137 (Jordan, November 28): on a plan connection (no per-request charge), close a request
   * whose outcome is unknown as "it ran, or the studio cannot tell" and go on, instead of
   * stopping for the owner. Never applies to paid API calls. Part of Hands-off.
   */
  close_unknown_plan_requests: z.boolean(),
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
  accept_quote_checked_claims: false,
  draft_proposal_sections: false,
  close_unknown_plan_requests: false,
};

/**
 * Hands-off: every fallback except the two switches the owner turns on one by one (choosing past
 * model-only ethics and accepting quote-checked web claims), which keep the values they had.
 */
export function handsOff(v: AutopilotSettingsValues): AutopilotSettingsValues {
  return {
    gather_evidence: true,
    max_extra_searches: 3,
    choose_with_unknowns: true,
    break_ties: true,
    keep_close_leader: true,
    next_candidate: true,
    retry_failed: Math.max(1, v.retry_failed),
    choose_model_ethics: v.choose_model_ethics,
    accept_quote_checked_claims: v.accept_quote_checked_claims,
    draft_proposal_sections: true,
    close_unknown_plan_requests: true,
  };
}
/** The switches Hands-off leaves as they are. */
export const NOT_HANDS_OFF: readonly (keyof AutopilotSettingsValues)[] = [
  'choose_model_ethics',
  'accept_quote_checked_claims',
];
/**
 * The Hands-off switches that are not on yet. ADR-0101 review 1 L-3: Hands-off saved before
 * drafting joined it reads as off until the owner turns it on again, so the page names what is
 * missing.
 */
export function handsOffMissing(
  v: AutopilotSettingsValues,
): (keyof AutopilotSettingsValues)[] {
  const h = handsOff(v);
  return (Object.keys(h) as (keyof AutopilotSettingsValues)[]).filter(
    (k) =>
      !NOT_HANDS_OFF.includes(k) &&
      !(typeof h[k] === 'number'
        ? Number(v[k]) >= Number(h[k])
        : v[k] === h[k]),
  );
}
export function isHandsOff(v: AutopilotSettingsValues): boolean {
  return handsOffMissing(v).length === 0;
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
  /** P-12: a web search found claims checked only by their quotes, which wait for a person. */
  'claims_held',
  'person_choice',
  'approval',
  'paused',
  'run_cap',
  'daily_cap',
  /** Live rerun 3 (November 15): the plan account's own usage limit, which resets by itself. */
  'usage_limit',
  /** Review 1 L-2: the connection refused for its own setup (caps not accepted, sign-in, …). */
  'connection',
  /**
   * Autopilot friction pass (November 28): an earlier plan request on the connection has an
   * unknown outcome (or is still marked running); only the owner closing it under Models and
   * connections lets any request start there again (invariant 5).
   */
  'open_request',
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
  claims_held: 'accept_quote_checked_claims',
  open_request: 'close_unknown_plan_requests',
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
    text: 'A tie for first goes to the better opportunity rank, then fewer unknowns, then the better worst case, then the option that builds least (an existing tool first, software last), then the title.',
  },
  keep_close_leader: {
    label: 'Keep the leader of a close ranking',
    text: 'Keeps the option first under your weights when a weight check would change the leader.',
  },
  next_candidate: {
    label: 'Try the next candidate',
    text: 'Moves on to the next candidate problem when discovery finds too little, goes on with the recorded problem when everything an exploration finds is already recorded, and moves to the next option it may advance when the first is blocked or cannot be advanced.',
  },
  retry_failed: {
    label: 'Retry a failed step',
    text: 'Tries a step whose answer failed or was malformed again, as a new attempt.',
  },
  choose_model_ethics: {
    label: 'Choose when only the model cleared ethics',
    text: 'Chooses an option whose ethics gate only the model cleared; the selection and proposal say “Ethics checked by the model only: look at it”.',
  },
  accept_quote_checked_claims: {
    label: 'Accept quote-checked web claims',
    text: 'Lets the autopilot use claims from its web searches whose only check is that their quotes were found word for word. Off: they wait for you under Discover › Search the web. Each one used is labelled “Accepted by autopilot · quote check only”, with its source passage.',
  },
  close_unknown_plan_requests: {
    label: 'Close unknown plan requests',
    text: 'When a ChatGPT plan or Claude Code request ends without a recorded outcome (for example a web search the studio cut off), records it as “it ran, or I cannot tell” and goes on, instead of stopping until you close it. It still counts toward the daily cap. Paid API calls always wait for you.',
  },
  draft_proposal_sections: {
    label: 'Draft a proposal’s missing sections',
    text: 'After saving a proposal, asks your chat model to draft the plan sections that are still Unknown yet: one of the autopilot’s calls, counted toward the daily chat limit too, and only when Chat answers allow studio records. Each draft waits under its section on Proposals; nothing is used until you use it and save. Part of Hands-off since November 14, 2026, so Hands-off saved before then reads as off until you turn it on again.',
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

/**
 * Re-review 2 L-1: whether "Allow this from now on" would change nothing, because the setting is
 * already on (for the evidence searches, at least one; for retries, at least one).
 */
export function settingIsOn(
  v: AutopilotSettingsValues,
  key: keyof AutopilotSettingsValues,
): boolean {
  const on = settingOn(v, key);
  return (Object.keys(on) as (keyof AutopilotSettingsValues)[]).every(
    (k) => on[k] === v[k],
  );
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

/** P-12: the label a quote-checked web claim the autopilot accepted carries wherever it is used. */
export const AUTOPILOT_QUOTE_CHECK_LABEL =
  'Accepted by autopilot · quote check only' as const;

/** ADR-0100: the flag on a selection (and its proposal) an autopilot made past model-only ethics. */
export const MODEL_ONLY_ETHICS_NOTE =
  'Ethics checked by the model only: look at it.' as const;
