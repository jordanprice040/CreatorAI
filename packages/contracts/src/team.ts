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
  /** The computer the studio runs on now, so the page can say where a check would run. */
  machine: z.string().max(120),
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
        capability: z.string().max(100),
        status: TeamCapabilityStatusSchema,
        /** "declared by the owner" or "checked on the studio's computer on <date>". */
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

export const ConfirmGateRequestSchema = z.strictObject({
  alternative: z.strictObject({ id, version }),
  gate: GateKindSchema,
  /** One line: why this gate is fine for this option. */
  reason: z.string().trim().min(3).max(300),
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

// ---- The owner's auto-clear rule ------------------------------------------------------------

/**
 * The owner's standing rule (ADR-0090, Jordan's decision of November 11, 2026). Off until the
 * owner turns it on. While on, a gate counts as cleared without a person's card when every
 * current automatic assessment of the option read the team profile and raised no concern on it.
 * A concern raised by anyone still blocks, and turning the rule off ends every clear it made.
 */
export const GateRuleSchema = z.strictObject({
  /** 0 while it was never set (off). */
  version: z.number().int().min(0),
  auto_clear: z.boolean(),
  updated_at: timestamp.nullable(),
  can_edit: z.boolean(),
});
export type GateRule = z.infer<typeof GateRuleSchema>;
export const SetGateRuleRequestSchema = z.strictObject({
  expected_version: z.number().int().min(0),
  auto_clear: z.boolean(),
});
export type SetGateRuleRequest = z.infer<typeof SetGateRuleRequestSchema>;
