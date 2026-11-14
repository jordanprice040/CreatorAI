import { z, id, hash, version, timestamp } from './primitives.js';

// ADR-0090: the team profile and people's gate confirmations.
//
// The team profile is what the workspace owner says the team can run, install and do with data,
// ticked by hand ("declared") or filled in by a built-in check that the studio ran on its own
// computer ("check"). It is sent with every automatic assessment so the assessor can answer
// access questions such as "can the team install Python tools?" instead of flagging them as not
// established. A model can read it but never write it.
//
// A gate confirmation is a person's (the owner's) one-click answer to an ethics or access gate on
// one option version, with a one-line reason. It is a person's decision: it lets a gate the
// automatic assessment raised (or could only look at) count as clear, without rewriting the
// system card's ratings, which are kept unchanged.

/** The capabilities the profile can hold, fixed in code. `check` names a built-in check. */
export const TEAM_CAPABILITIES = [
  { key: 'python', label: 'Run Python', check: true },
  { key: 'pip', label: 'Install Python packages (pip)', check: true },
  { key: 'java', label: 'Run Java', check: true },
  { key: 'node', label: 'Run Node.js', check: true },
  { key: 'git', label: 'Use Git', check: true },
  { key: 'docker', label: 'Run Docker containers', check: true },
  { key: 'jupyter', label: 'Run Jupyter notebooks', check: true },
  {
    key: 'installs_allowed',
    label: 'Install new software on the team’s computers',
    check: false,
  },
  {
    key: 'internet',
    label: 'Use the internet from the team’s computers',
    check: false,
  },
  {
    key: 'data_stays_local',
    label: 'Keep data on our own computers (never upload it)',
    check: false,
  },
  {
    key: 'paid_tools',
    label: 'Pay for software or online services',
    check: false,
  },
] as const;
export type TeamCapabilityKey = (typeof TEAM_CAPABILITIES)[number]['key'];
export const TeamCapabilityKeySchema = z.enum(
  TEAM_CAPABILITIES.map((c) => c.key) as [
    TeamCapabilityKey,
    ...TeamCapabilityKey[],
  ],
);
export const capabilityLabel = (key: string) =>
  TEAM_CAPABILITIES.find((c) => c.key === key)?.label ?? key;
export const CHECKABLE_CAPABILITIES = TEAM_CAPABILITIES.filter(
  (c) => c.check,
).map((c) => c.key);

export const TeamCapabilityStatusSchema = z.enum(['yes', 'no', 'unknown']);

/** A built-in check's record: what ran, where, when, and what it found. */
export const CapabilityCheckSchema = z.strictObject({
  /** The command line that ran, for the record (fixed in code, never model-written). */
  command: z.string().max(200),
  /** What the check found, for example "Python 3.12.1". */
  detail: z.string().max(200),
  output_hash: hash,
  /** The computer the studio runs on (its host name); kept out of model packets. */
  machine: z.string().max(120),
  checked_at: timestamp,
});
export type CapabilityCheck = z.infer<typeof CapabilityCheckSchema>;

export const TeamCapabilitySchema = z.strictObject({
  key: TeamCapabilityKeySchema,
  status: TeamCapabilityStatusSchema,
  /** declared: ticked by the owner. check: set by a built-in check that passed. */
  basis: z.enum(['declared', 'check']),
  note: z.string().trim().max(300).nullable(),
  check: CapabilityCheckSchema.nullable(),
});
export type TeamCapability = z.infer<typeof TeamCapabilitySchema>;

const uniqueKeys = (xs: readonly { key: string }[], ctx: z.RefinementCtx) => {
  const seen = new Set<string>();
  for (const x of xs) {
    if (seen.has(x.key))
      ctx.addIssue({
        code: 'custom',
        message: `The capability ${x.key} is listed twice.`,
      });
    seen.add(x.key);
  }
};

export const TeamProfileBodySchema = z.strictObject({
  capabilities: z
    .array(TeamCapabilitySchema)
    .max(TEAM_CAPABILITIES.length)
    .superRefine(uniqueKeys),
  /** Anything else the assessor should know about the team, in the owner's words. */
  notes: z.string().max(1000),
});
export type TeamProfileBody = z.infer<typeof TeamProfileBodySchema>;

export const TeamProfileSchema = z.strictObject({
  /** 0 while nothing has been saved. */
  version: z.number().int().min(0),
  profile: TeamProfileBodySchema,
  updated_at: timestamp.nullable(),
  /** Whether the person reading it may change it (the workspace owner). */
  can_edit: z.boolean(),
  /**
   * The computer the studio runs on now, so the page can say where a check would run. Only the
   * owner gets it (null for everyone else, and when built-in checks are not available).
   */
  machine: z.string().max(120).nullable(),
  /** False in a hosted deployment: a check there would test the server, not the team's computer. */
  checks_available: z.boolean(),
});
export type TeamProfile = z.infer<typeof TeamProfileSchema>;

export const SaveTeamProfileRequestSchema = z.strictObject({
  /** The version the page showed; 0 when none was saved. */
  expected_version: z.number().int().min(0),
  capabilities: z
    .array(
      z.strictObject({
        key: TeamCapabilityKeySchema,
        status: TeamCapabilityStatusSchema,
        note: z.string().trim().max(300).nullable().optional(),
      }),
    )
    .max(TEAM_CAPABILITIES.length)
    .superRefine(uniqueKeys),
  notes: z.string().max(1000),
});
export type SaveTeamProfileRequest = z.infer<
  typeof SaveTeamProfileRequestSchema
>;

export const RunCapabilityCheckRequestSchema = z.strictObject({
  expected_version: z.number().int().min(0),
  capability: TeamCapabilityKeySchema,
});
export type RunCapabilityCheckRequest = z.infer<
  typeof RunCapabilityCheckRequestSchema
>;
export const CapabilityCheckResultSchema = z.strictObject({
  capability: TeamCapabilityKeySchema,
  passed: z.boolean(),
  /** What was found, or why it was not found. */
  detail: z.string().max(300),
  /** Whether the profile got a new version (a re-check that found the same thing does not). */
  saved: z.boolean(),
  /** The profile after the check: a passing check saves a new version; a failed one does not. */
  profile: TeamProfileSchema,
});
export type CapabilityCheckResult = z.infer<typeof CapabilityCheckResultSchema>;

/** The team block an assessment packet carries (no host names or people's names). */
export const PacketTeamSchema = z.strictObject({
  version: version,
  capabilities: z
    .array(
      z.strictObject({
        /** ADR-0097: the capability's key, which a checklist answer cites (absent before it). */
        key: TeamCapabilityKeySchema.optional(),
        capability: z.string().max(100),
        status: TeamCapabilityStatusSchema,
        /** "declared by the owner" or "found by a built-in check on the studio's computer (…)". */
        basis: z.string().max(120),
        note: z.string().max(300).nullable(),
      }),
    )
    .max(TEAM_CAPABILITIES.length),
  notes: z.string().max(1000),
});
export type PacketTeam = z.infer<typeof PacketTeamSchema>;

// ---- Gate confirmations -------------------------------------------------------------------

export const GateKindSchema = z.enum(['ethics', 'access']);
export type GateKind = z.infer<typeof GateKindSchema>;

/** One line: why a gate is fine for an option (single and one-step confirmations, review N-3). */
const gateReason = z.string().trim().min(3).max(300);

export const ConfirmGateRequestSchema = z.strictObject({
  alternative: z.strictObject({ id, version }),
  gate: GateKindSchema,
  /** One line: why this gate is fine for this option. */
  reason: gateReason,
  /**
   * The concerns the page showed for this gate (scorecard id@version of each card that raised
   * one). The server refuses the confirmation when they differ from the current ones, so a
   * concern raised after the page loaded is never confirmed unseen.
   */
  concerns_seen: z.array(z.string().max(80)).max(40),
});
export type ConfirmGateRequest = z.infer<typeof ConfirmGateRequestSchema>;

export const GateConfirmationSchema = z.strictObject({
  id,
  alternative_id: id,
  alternative_version: version,
  gate: GateKindSchema,
  reason: z.string().max(300),
  /** The concerns it answered (scorecard id@version). A later concern makes it stale. */
  concerns: z.array(z.string().max(80)).max(40),
  actor_id: z.string().max(200),
  created_at: timestamp,
});
export type GateConfirmation = z.infer<typeof GateConfirmationSchema>;

/**
 * UX pass P-4 (as Jordan revised it): the owner confirms ethics and access for several options in
 * one step. One shared reason per gate kind covers every ticked item that has no reason of its
 * own; an item may give its own reason instead. Every item is checked exactly as a single
 * confirmation is, and all of them are written together or none is. Each confirmation stores
 * the reason that applied to its option and gate, and its event records whether that reason
 * was the shared one or the option's own.
 */
export const ConfirmGatesRequestSchema = z
  .strictObject({
    shared: z.strictObject({
      ethics: gateReason.nullable(),
      access: gateReason.nullable(),
    }),
    items: z
      .array(
        z.strictObject({
          alternative: z.strictObject({ id, version }),
          gate: GateKindSchema,
          concerns_seen: z.array(z.string().max(80)).max(40),
          /** This option's own reason for this gate; null uses the shared one. */
          reason: gateReason.nullable(),
        }),
      )
      .min(1)
      .max(80),
  })
  .superRefine((r, ctx) => {
    const seen = new Set<string>();
    r.items.forEach((x, i) => {
      const key = `${x.alternative.id.toLowerCase()}:${x.gate}`;
      if (seen.has(key))
        ctx.addIssue({
          code: 'custom',
          path: ['items', i],
          message: 'Each option and gate is confirmed at most once.',
        });
      seen.add(key);
      if (x.reason === null && r.shared[x.gate] === null)
        ctx.addIssue({
          code: 'custom',
          path: ['items', i, 'reason'],
          message: `Give a shared ${x.gate} reason or this option's own.`,
        });
    });
  });
export type ConfirmGatesRequest = z.infer<typeof ConfirmGatesRequestSchema>;

export const GateReasonFromSchema = z.enum(['shared', 'own']);
export type GateReasonFrom = z.infer<typeof GateReasonFromSchema>;

export const ConfirmGatesResultSchema = z.strictObject({
  /** Ties the confirmations written in this one step together in their events. */
  batch_id: id,
  confirmations: z.array(
    z.strictObject({
      confirmation: GateConfirmationSchema,
      reason_from: GateReasonFromSchema,
    }),
  ),
});
export type ConfirmGatesResult = z.infer<typeof ConfirmGatesResultSchema>;

/** Which reason applies to one item of a batch: its own when given, else the shared one. */
export function gateItemReason(
  r: Pick<ConfirmGatesRequest, 'shared'>,
  item: Pick<ConfirmGatesRequest['items'][number], 'gate' | 'reason'>,
): { reason: string; from: GateReasonFrom } {
  return item.reason !== null
    ? { reason: item.reason, from: 'own' }
    : { reason: r.shared[item.gate] ?? '', from: 'shared' };
}

// ---- The owner's gate rule: who clears a gate ------------------------------------------------

/**
 * Who clears the ethics and access gates in a workspace (ADR-0090; Jordan's decisions of
 * November 11 and 12, 2026). The owner picks it; agents never can.
 *  - owner: a person clears every gate (their own scorecard, or Clear: I confirm). The default.
 *  - team_profile: the access gate also clears when every current automatic assessment read a
 *    team profile that answers at least one capability and found no access concern. Ethics still
 *    needs a person.
 *  - model: both gates also clear on the model's word: every current automatic assessment found
 *    no concern on that gate. No person looks at a gate cleared this way, and a routine approval
 *    policy can then select the option; the gate says so wherever it is shown.
 *  - checklist (ADR-0097): a gate also clears when every current automatic assessment passed
 *    every item of the owner's gate checklist for it, each pass citing the packet; access also
 *    needs every capability the assessment says the option needs to be Yes in the current team
 *    profile, found by a check on this computer (or declared by the owner when no check can test
 *    it). Any fail or unknown keeps the gate open and is listed for the owner.
 * In every mode a concern raised by anyone still blocks and comes to the owner, and changing the
 * mode ends every clear the earlier one made.
 */
export const GATE_CLEAR_MODES = [
  'owner',
  'team_profile',
  'model',
  'checklist',
] as const;
export const GateClearModeSchema = z.enum(GATE_CLEAR_MODES);
export type GateClearMode = z.infer<typeof GateClearModeSchema>;

export const GateRuleSchema = z.strictObject({
  /** 0 while it was never set (owner). */
  version: z.number().int().min(0),
  mode: GateClearModeSchema,
  updated_at: timestamp.nullable(),
  can_edit: z.boolean(),
});
export type GateRule = z.infer<typeof GateRuleSchema>;
export const SetGateRuleRequestSchema = z.strictObject({
  expected_version: z.number().int().min(0),
  mode: GateClearModeSchema,
});
export type SetGateRuleRequest = z.infer<typeof SetGateRuleRequestSchema>;

// ---- The owner's gate checklist (ADR-0097) ---------------------------------------------------

/**
 * What the owner wants checked before an ethics or access gate may clear on its own: up to 12
 * short items, each for one gate. Only the owner writes it; every save is a new version. The
 * automatic assessment answers every item pass, fail or unknown, citing the packet; under the
 * checklist gate rule, code clears a gate only when every item for it passed.
 */
export const MAX_CHECKLIST_ITEMS = 12;
export const ChecklistItemRefSchema = z.string().regex(/^K(?:[1-9]|1[0-2])$/);
export const GateChecklistItemSchema = z.strictObject({
  gate: GateKindSchema,
  text: z.string().trim().min(3).max(300),
});
export type GateChecklistItem = z.infer<typeof GateChecklistItemSchema>;

/** A starter list the owner can adopt and edit; never applied without the owner saving it. */
export const STARTER_GATE_CHECKLIST: readonly GateChecklistItem[] = [
  {
    gate: 'ethics',
    text: 'Personal or sensitive data about people is used only with their consent or another clear, lawful basis.',
  },
  {
    gate: 'ethics',
    text: 'The option does not track, profile or monitor people without their knowledge.',
  },
  {
    gate: 'ethics',
    text: 'No group of people is harmed, left out or treated unfairly by the option.',
  },
  {
    gate: 'access',
    text: 'The team can run and install everything the option needs (see the team profile).',
  },
  {
    gate: 'access',
    text: 'The option needs no paid tool or service the team has not said it can pay for.',
  },
  {
    gate: 'access',
    text: 'Data stays where the team profile says it must (for example, on the team’s own computers).',
  },
];

export const GateChecklistSchema = z.strictObject({
  /** 0 while nothing has been saved. */
  version: z.number().int().min(0),
  items: z
    .array(GateChecklistItemSchema.extend({ ref: ChecklistItemRefSchema }))
    .max(MAX_CHECKLIST_ITEMS),
  updated_at: timestamp.nullable(),
  can_edit: z.boolean(),
});
export type GateChecklist = z.infer<typeof GateChecklistSchema>;

export const SaveGateChecklistRequestSchema = z.strictObject({
  expected_version: z.number().int().min(0),
  items: z.array(GateChecklistItemSchema).max(MAX_CHECKLIST_ITEMS),
});
export type SaveGateChecklistRequest = z.infer<
  typeof SaveGateChecklistRequestSchema
>;

/** The checklist block an assessment packet carries. */
export const PacketChecklistSchema = z.strictObject({
  version,
  items: z
    .array(GateChecklistItemSchema.extend({ ref: ChecklistItemRefSchema }))
    .min(1)
    .max(MAX_CHECKLIST_ITEMS),
});
export type PacketChecklist = z.infer<typeof PacketChecklistSchema>;
