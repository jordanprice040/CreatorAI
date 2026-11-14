import {
  z,
  id,
  hash,
  timestamp,
  version,
  nanoUsd,
  ConditionSchema,
} from './primitives.js';

// T03 human oversight contracts (context/HUMAN_OVERSIGHT.md). Policy decisions are made by
// domain rules over these shapes; nothing here is permission by itself.
const short = z.string().trim().min(1).max(500);
const note = z.string().trim().min(1).max(1200);

export const OVERSIGHT_POLICY_VERSION = 'oversight/1.0' as const;
export const AutonomyModeSchema = z.enum([
  'supervised',
  'human_in_loop',
  'autonomous_within_scope',
  'human_only',
]);
export type AutonomyMode = z.infer<typeof AutonomyModeSchema>;
export const DecisionKindSchema = z.enum([
  'clarification',
  'judgment',
  'authorization',
  'feedback',
]);
export type DecisionKind = z.infer<typeof DecisionKindSchema>;
/** Why a human is asked. Model-supplied flags may add a reason; they never remove one. */
export const HumanReasonSchema = z.enum([
  'outside_grant',
  'stage_gate',
  'material_assumption',
  'stakeholder_conflict',
  'consent_access',
  'professional_judgment',
  'source_disagreement',
  'ethical_judgment',
  'output_feedback',
]);
export type HumanReason = z.infer<typeof HumanReasonSchema>;
export const ActionTypeSchema = z.enum([
  'record.revise',
  'assumption.log',
  'model.generate',
  'model.summarize',
  'model.embed',
  'tool.search_public',
  'source.fetch',
  'candidate.select',
  'spec.freeze',
  'product.commit_build',
  'release.publish',
  'message.send',
  'payment.charge',
  'grant.create',
  'policy.change',
  'budget.increase',
  // X04: GitHub mutations, each admitted with the operation's intent hash as spec_hash.
  'github.repo_create',
  'github.write',
  'github.workflow_change',
  'github.merge',
  // ADR-0086: adding a claim whose quotes the studio found word for word in fetched pages.
  'claim.admit',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;
export const DataClassSchema = z.enum([
  'synthetic',
  'public',
  'private_approved',
]);
export const TargetRefSchema = z.strictObject({ id, version });

/**
 * ADR-0079 (P10): routine approvals. An owner sets one policy for a run, at setup or while
 * it is going; code then admits the covered routine steps without asking again. A policy is realised
 * as one run-scoped standing grant that only the policy path may use, plus the limits and
 * stop conditions below. It never covers an action with an external effect.
 */
export const ROUTINE_POLICY_VERSION = 'routine/1.0' as const;
export const RoutineStageSchema = z.enum([
  'research',
  'model_work',
  'selection',
  'spec_freeze',
  'build',
  // ADR-0086 (P12): the claim-admission stage P10 left open.
  'evidence',
]);
export type RoutineStage = z.infer<typeof RoutineStageSchema>;
/** The action types each routine stage covers. Fixed in code; not a runtime setting. */
export const ROUTINE_STAGE_ACTIONS: Record<
  RoutineStage,
  readonly ActionType[]
> = {
  research: ['tool.search_public', 'source.fetch'],
  model_work: ['model.generate', 'model.summarize', 'model.embed'],
  selection: ['candidate.select'],
  spec_freeze: ['spec.freeze'],
  build: ['product.commit_build'],
  evidence: ['claim.admit'],
};
export const ROUTINE_STAGE_TEXT: Record<
  RoutineStage,
  { label: string; covers: string }
> = {
  research: {
    label: 'Research',
    covers: 'public searches and fetching public source pages',
  },
  model_work: {
    label: 'Model work',
    covers:
      'model calls that draft, summarize, assess and index (a draft stays a draft until a person accepts it)',
  },
  selection: {
    label: 'Selection',
    covers: 'recording which option is selected for a problem',
  },
  spec_freeze: {
    label: 'Specification freeze',
    covers: 'freezing a specification version, which cannot be undone',
  },
  build: {
    label: 'Build',
    covers:
      'committing to an isolated build of a frozen specification, with its review, repair rounds and private package, when the humility review passes',
  },
  evidence: {
    label: 'Evidence',
    covers:
      'adding observation claims found by web discovery when a quote of at least six words was found word for word in a fetched page (contrary quotes are added with them). The studio checks that the quote exists, not that it proves the claim; inferences always wait for you, and so do these for an autopilot’s own searches unless the owner turns on “Accept quote-checked web claims”',
  },
};
export const RoutineStopSchema = z.enum(['person_rejects', 'unknown_outcome']);
export type RoutineStop = z.infer<typeof RoutineStopSchema>;
export const ROUTINE_STOP_TEXT: Record<RoutineStop, string> = {
  person_rejects:
    'Stops after you reject any decision in this run, until you confirm the policy again.',
  unknown_outcome:
    'Stops while any paid call in this run has an unknown outcome that is not yet reconciled.',
};
const unique = <T>(a: readonly T[]) => new Set(a).size === a.length;
/** What the owner chooses. Owner-set limits have no hard-coded maximum (2026-11-03 decision). */
export const RoutinePolicyInputSchema = z.strictObject({
  stages: z
    .array(RoutineStageSchema)
    .min(1)
    .max(6)
    .refine(unique, 'List each stage once.'),
  data_classes: z
    .array(DataClassSchema)
    .min(1)
    .max(3)
    .refine(unique, 'List each data class once.'),
  /** The most steps this policy admits over its whole life, across changes. */
  max_actions: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  /**
   * The most the admitted steps' stated maximum amounts may add up to. Null: a step that
   * states an amount is never covered (an amount with no cap is unknown, not zero).
   */
  max_total_nano_usd: nanoUsd.nullable(),
  stop_on: z
    .array(RoutineStopSchema)
    .max(2)
    .refine(unique, 'List each stop condition once.'),
  expires_at: timestamp,
  rationale: note,
});
export type RoutinePolicyInput = z.infer<typeof RoutinePolicyInputSchema>;
const summaryLines = z.array(z.string().max(600)).min(1).max(20);
/** The input plus the exact summary the owner was shown; a different summary is refused. */
export const RoutinePolicyRequestSchema = RoutinePolicyInputSchema.extend({
  summary_seen: summaryLines,
});
export const ReviseRoutinePolicyRequestSchema =
  RoutinePolicyRequestSchema.extend({ expected_version: version });
export const RevokeRoutinePolicyRequestSchema = z.strictObject({
  expected_version: version,
  reason: short,
});
/**
 * Exact dollars from nano-USD, every non-zero digit kept ("$50.00", "$0.004"): the same rule
 * as the web's `money`. The routine summary is where the owner authorizes spending, so its
 * maximum is exact and in dollars (review 3 of #197, L-1; P-9).
 */
const dollars = (nano: string) => {
  const v = BigInt(nano);
  const frac = (v % 1_000_000_000n)
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0');
  return `$${v / 1_000_000_000n}.${frac}`;
};
/**
 * The one up-front summary of a routine approval policy, in the order the form shows it.
 * The studio writes it from the chosen values; the owner's request must carry the same
 * lines, so what was confirmed is exactly what code enforces.
 */
export function routinePolicySummary(p: RoutinePolicyInput): string[] {
  const order = RoutineStageSchema.options.filter((s) => p.stages.includes(s));
  const stops = RoutineStopSchema.options.filter((s) => p.stop_on.includes(s));
  const until = new Date(p.expires_at).toISOString();
  return [
    'For this run only, the studio admits the steps below without asking you each time. Its own fixed rules check every step against this policy; no model approves anything, and no approve-once record is made on your behalf.',
    ...order.map(
      (s) => `${ROUTINE_STAGE_TEXT[s].label}: ${ROUTINE_STAGE_TEXT[s].covers}.`,
    ),
    `Data: ${p.data_classes.map((c) => c.replaceAll('_', ' ')).join(', ')} only.`,
    `Limits: at most ${p.max_actions} step${p.max_actions === 1 ? '' : 's'} in total; ${
      p.max_total_nano_usd === null
        ? 'no step that states a money amount'
        : `steps that state a money amount up to ${dollars(p.max_total_nano_usd)} in total (the sum of each step's stated maximum)`
    }; ends ${until.slice(0, 10)} ${until.slice(11, 16)} UTC. Budgets, spending limits and connection request caps still apply as well.`,
    ...stops.map((s) => ROUTINE_STOP_TEXT[s]),
    'Never covered: publishing, sending messages, payments, GitHub changes, account or access changes, raising budgets, or changing this policy.',
    'Still stops and asks you: value questions and flagged concerns, a serious unresolved ethical problem, a material or refuted assumption, and any step outside the stages, data or limits above. A failed humility review is refused. Work done so far is kept.',
    'You can stop the run or revoke this policy at any time. Changing it needs you to confirm a new summary.',
  ];
}
/** True when `next` permits anything `prev` did not (a material change, recorded as such). */
export function routinePolicyWidens(
  prev: RoutinePolicyInput,
  next: RoutinePolicyInput,
): boolean {
  const more = <T>(a: readonly T[], b: readonly T[]) =>
    b.some((x) => !a.includes(x));
  return (
    more(prev.stages, next.stages) ||
    more(prev.data_classes, next.data_classes) ||
    next.max_actions > prev.max_actions ||
    (next.max_total_nano_usd !== null &&
      (prev.max_total_nano_usd === null ||
        BigInt(next.max_total_nano_usd) > BigInt(prev.max_total_nano_usd))) ||
    Date.parse(next.expires_at) > Date.parse(prev.expires_at) ||
    more(next.stop_on, prev.stop_on)
  );
}
export const RoutinePolicySchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  version,
  status: z.enum(['active', 'revoked']),
  grant_id: id,
  grant_version: version,
  stages: z.array(RoutineStageSchema),
  data_classes: z.array(DataClassSchema),
  max_actions: z.number().int(),
  max_total_nano_usd: nanoUsd.nullable(),
  stop_on: z.array(RoutineStopSchema),
  expires_at: timestamp,
  rationale: note,
  summary: summaryLines,
  policy_version: z.string().max(100),
  created_by: id,
  created_at: timestamp,
  /** When this version was confirmed; a person_rejects stop counts rejections after it. */
  confirmed_at: timestamp,
  revoked_at: timestamp.nullable(),
  revoke_reason: short.nullable(),
});
export type RoutinePolicy = z.infer<typeof RoutinePolicySchema>;
/** A policy with what it has admitted so far and whether it admits now. */
export const RoutinePolicyViewSchema = z.strictObject({
  policy: RoutinePolicySchema,
  used_actions: z.number().int(),
  used_nano_usd: nanoUsd,
  state: z.enum(['active', 'paused', 'expired', 'revoked']),
  /** Why it admits nothing now; null while active. */
  state_reason: z.string().max(400).nullable(),
  /**
   * A stop condition that holds (a person rejected a decision, an unknown outcome), reported
   * even when an end time or used-up steps is the state's reason (review 3 L-1). A revision
   * from an automation level is refused while it is set.
   */
  stop_reason: z.string().max(400).nullable(),
  recent: z
    .array(
      z.strictObject({
        admission_id: id,
        action_type: ActionTypeSchema,
        policy_grant_version: version,
        created_at: timestamp,
      }),
    )
    .max(20),
});
export type RoutinePolicyView = z.infer<typeof RoutinePolicyViewSchema>;

// Runs under oversight. Mode and condition are fixed at registration.
export const RegisterRunRequestSchema = z.strictObject({
  run: TargetRefSchema,
  autonomy_mode: AutonomyModeSchema,
  stage_gates: z.array(ActionTypeSchema).max(20).nullable(),
  /** Autonomous runs may use only grants listed here, at these versions. */
  initial_grants: z.array(TargetRefSchema).max(50),
  /**
   * ADR-0079: routine approvals chosen when the run is set up (they can also be turned on
   * later with `runs/{id}/routine-policy`). Supervised and human-in-the-loop runs only.
   */
  routine_policy: RoutinePolicyRequestSchema.nullable().optional(),
});
export const RunControlSchema = z.strictObject({
  run_id: id,
  workspace_id: id,
  autonomy_mode: AutonomyModeSchema,
  experiment_condition: ConditionSchema,
  policy_version: z.string().max(100),
  stage_gates: z.array(ActionTypeSchema),
  initial_grants: z.array(TargetRefSchema),
  state: z.enum(['active', 'cancelled']),
  cancel_reason: short.nullable(),
  created_by: id,
  created_at: timestamp,
  cancelled_at: timestamp.nullable(),
});
export type RunControl = z.infer<typeof RunControlSchema>;
export const CancelRunRequestSchema = z.strictObject({ reason: short });

// Grants: approve-once grants bind an exact target/content/spec; standing grants cover a class.
export const GrantScopeSchema = z.enum(['once', 'standing']);
export const GrantSchema = z.strictObject({
  id,
  workspace_id: id,
  version,
  scope: GrantScopeSchema,
  status: z.enum(['active', 'revoked', 'consumed']),
  run_id: id.nullable(),
  action_types: z.array(ActionTypeSchema).min(1).max(20),
  target_kind: z.string().max(40).nullable(),
  target: z
    .strictObject({ id, version, content_hash: hash, kind: z.string().max(40) })
    .nullable(),
  spec_hash: hash.nullable(),
  max_amount_nano_usd: nanoUsd.nullable(),
  allow_irreversible: z.boolean(),
  allow_external_effects: z.boolean(),
  data_classes: z.array(DataClassSchema).min(1),
  expires_at: timestamp,
  decision_id: id.nullable(),
  policy_version: z.string().max(100),
  rationale: note,
  created_by: id,
  created_at: timestamp,
  revoked_at: timestamp.nullable(),
  revoke_reason: short.nullable(),
});
export type Grant = z.infer<typeof GrantSchema>;
export const CreateStandingGrantRequestSchema = z.strictObject({
  run_id: id.nullable(),
  action_types: z.array(ActionTypeSchema).min(1).max(20),
  target_kind: z.string().trim().min(1).max(40).nullable(),
  max_amount_nano_usd: nanoUsd.nullable(),
  allow_irreversible: z.boolean(),
  allow_external_effects: z.boolean(),
  data_classes: z.array(DataClassSchema).min(1).max(3),
  expires_at: timestamp,
  rationale: note,
});
export const ReviseGrantRequestSchema = CreateStandingGrantRequestSchema.omit({
  run_id: true,
}).extend({ expected_version: version });
export const RevokeGrantRequestSchema = z.strictObject({
  expected_version: version,
  reason: short,
});

// Actions submitted for admission. Effects (model use, external effect, reversibility) come
// from the domain registry for the action type, never from the caller.
export const ActionRequestSchema = z.strictObject({
  action_type: ActionTypeSchema,
  task_id: id.nullable(),
  target: TargetRefSchema.nullable(),
  spec_hash: hash.nullable(),
  amount_nano_usd: nanoUsd.nullable(),
  data_class: DataClassSchema,
  assumption_ids: z.array(id).max(30),
  humility_review: TargetRefSchema.nullable(),
  flags: z
    .array(
      z.strictObject({
        reason: HumanReasonSchema,
        note,
        evidence_refs: z.array(TargetRefSchema).max(20),
      }),
    )
    .max(10),
  justification: note,
});
export type ActionRequest = z.infer<typeof ActionRequestSchema>;
export const BindingSchema = z.strictObject({
  action_type: ActionTypeSchema,
  run_id: id,
  target: z
    .strictObject({ id, version, content_hash: hash, kind: z.string().max(40) })
    .nullable(),
  spec_hash: hash.nullable(),
  amount_nano_usd: nanoUsd.nullable(),
  data_class: DataClassSchema,
});
export type Binding = z.infer<typeof BindingSchema>;
export const VerdictSchema = z.enum([
  'allow',
  'request_human',
  'deny',
  'defer',
]);
export const AdmissionSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  verdict: VerdictSchema,
  outcome: z.enum(['admitted', 'needs_human', 'denied', 'waiting_human']),
  reason_code: z.string().max(80),
  reasons: z.array(HumanReasonSchema),
  explanation: z.string().max(1200),
  policy_version: z.string().max(100),
  binding: BindingSchema,
  binding_hash: hash,
  covered_by: z
    .strictObject({ grant_id: id, grant_version: version })
    .nullable(),
  provisional_assumptions: z.array(id),
  decision_id: id.nullable(),
  actor_id: id,
  created_at: timestamp,
});
export type Admission = z.infer<typeof AdmissionSchema>;

/**
 * ADR-0054: one owner approval per build of a frozen spec. The build asks once, before its
 * first round; an allowed product.commit_build admission is recorded with the build's stated
 * limits, and covers its repair rounds and (on the plan route) its builder and reviewer requests.
 */
export const BuildRouteSchema = z.enum(['broker', 'codex_plan', 'plan_roles']);
export const BUILD_APPROVAL_MAX_REQUESTS = 6;
export const BUILD_APPROVAL_MAX_REPAIRS = 2;
/** The longest a build approval lasts, whatever deadline the build states (review L-1). */
export const BUILD_APPROVAL_MAX_MS = 24 * 3_600_000;
/**
 * How long a build may run from the Build form (PR #123 third review L-1). Plan-role and
 * broker builds keep 30 minutes. A Codex build runs one turn per round (first try plus each
 * repair), each up to the connection's build timeout, which has no maximum (ADR-0062), plus 30
 * minutes for review and checks; never past the build approval's 24 hours (less 5 minutes so
 * the approval's own check, made a moment later, still passes).
 */
export function buildDeadlineMs(codexBuildTimeoutMs: number, repairs: number) {
  const base = 30 * 60_000;
  return Math.min(
    BUILD_APPROVAL_MAX_MS - 5 * 60_000,
    Math.max(
      base,
      (Math.max(0, repairs) + 1) * Math.max(0, codexBuildTimeoutMs) + base,
    ),
  );
}
export const BuildApprovalRequestSchema = z
  .strictObject({
    build_id: id,
    product_id: id,
    task_id: id,
    spec: TargetRefSchema,
    spec_hash: hash,
    plan_hash: hash,
    route: BuildRouteSchema,
    connection_id: id.nullable(),
    model_id: z.string().min(1).max(120).nullable(),
    data_class: DataClassSchema,
    humility_review: TargetRefSchema,
    request_limit: z.number().int().min(2).max(BUILD_APPROVAL_MAX_REQUESTS),
    max_repairs: z.number().int().min(0).max(BUILD_APPROVAL_MAX_REPAIRS),
    expires_at: timestamp,
  })
  .refine(
    (r) =>
      (r.route === 'plan_roles') ===
      (r.connection_id !== null && r.model_id !== null),
    'Only a plan-roles build names a connection and model.',
  );
export type BuildApprovalRequest = z.infer<typeof BuildApprovalRequestSchema>;
export const BuildApprovalSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  product_id: id,
  task_id: id,
  spec: TargetRefSchema,
  spec_hash: hash,
  plan_hash: hash,
  route: BuildRouteSchema,
  connection_id: id.nullable(),
  model_id: z.string().max(120).nullable(),
  data_class: DataClassSchema,
  humility_review: TargetRefSchema,
  request_limit: z.number().int(),
  max_repairs: z.number().int(),
  admission_id: id,
  grant_id: id,
  grant_version: version,
  decision_id: id.nullable(),
  expires_at: timestamp,
  created_by: id,
  created_at: timestamp,
});
export type BuildApproval = z.infer<typeof BuildApprovalSchema>;
export const BuildApprovalResultSchema = z.strictObject({
  admission: AdmissionSchema,
  approval: BuildApprovalSchema.nullable(),
});
export type BuildApprovalResult = z.infer<typeof BuildApprovalResultSchema>;

// Decision requests use the concise format from HUMAN_OVERSIGHT.md.
export const DecisionOptionSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_-]{1,40}$/),
  label: short,
  consequence: short,
});
export const CreateDecisionRequestSchema = z
  .strictObject({
    kind: DecisionKindSchema,
    reason: HumanReasonSchema,
    task_id: id.nullable(),
    question: note,
    evidence_refs: z.array(TargetRefSchema).max(30),
    uncertainty: note,
    consequence_if_wrong: note,
    options: z.array(DecisionOptionSchema).min(2).max(4),
    recommendation: z.string().max(40).nullable(),
    recommendation_reason: note.nullable(),
    blocked_work: z.array(short).max(20),
    unblocked_work: z.array(short).max(20),
    action: ActionRequestSchema.nullable(),
    expires_at: timestamp,
  })
  .superRefine((d, ctx) => {
    const ids = d.options.map((o) => o.id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Option ids must be unique.' });
    if (d.recommendation !== null && !ids.includes(d.recommendation))
      ctx.addIssue({
        code: 'custom',
        message: 'Recommendation must name an option.',
      });
    if ((d.recommendation === null) !== (d.recommendation_reason === null))
      ctx.addIssue({
        code: 'custom',
        message: 'A recommendation needs a brief reason, and only then.',
      });
    if (d.kind === 'authorization' && d.action === null)
      ctx.addIssue({
        code: 'custom',
        message: 'Authorization requests bind the exact action they permit.',
      });
  });
export const DecisionStatusSchema = z.enum([
  'pending',
  'answered',
  'expired',
  'cancelled',
  'superseded',
]);
export const ResponseChoiceSchema = z.enum([
  'approve_once',
  'approve_standing',
  'choose_option',
  'revise',
  'request_evidence',
  'reject',
  'defer',
]);
export type ResponseChoice = z.infer<typeof ResponseChoiceSchema>;
export const AnswerDecisionRequestSchema = z.strictObject({
  choice: ResponseChoiceSchema,
  option_id: z.string().max(40).nullable(),
  rationale: note,
  /** The coverage the person saw; a changed target or preview invalidates the answer. */
  coverage_hash: hash,
  standing_expires_at: timestamp.nullable(),
  time_spent_ms: z.number().int().min(0).max(86_400_000).nullable(),
  interruption: z.enum(['useful', 'unnecessary']).nullable(),
});
export const CoverageSchema = z.strictObject({
  /** Exactly what approve-once permits: one admission of this binding. */
  once: BindingSchema.nullable(),
  /** The standing grant approve-standing would create, before expiry is chosen. */
  standing: z
    .strictObject({
      run_id: id.nullable(),
      action_types: z.array(ActionTypeSchema),
      target_kind: z.string().max(40).nullable(),
      max_amount_nano_usd: nanoUsd.nullable(),
      allow_irreversible: z.boolean(),
      allow_external_effects: z.boolean(),
      data_classes: z.array(DataClassSchema),
    })
    .nullable(),
  coverage_hash: hash,
  current: z.boolean(),
});
export type Coverage = z.infer<typeof CoverageSchema>;
export const DecisionSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  task_id: id.nullable(),
  version,
  kind: DecisionKindSchema,
  reason: HumanReasonSchema,
  status: DecisionStatusSchema,
  question: note,
  evidence_refs: z.array(TargetRefSchema),
  uncertainty: note,
  consequence_if_wrong: note,
  options: z.array(DecisionOptionSchema),
  recommendation: z.string().max(40).nullable(),
  recommendation_reason: note.nullable(),
  blocked_work: z.array(short),
  unblocked_work: z.array(short),
  binding: BindingSchema.nullable(),
  binding_hash: hash.nullable(),
  expires_at: timestamp,
  requested_by: id,
  created_at: timestamp,
  response: z
    .strictObject({
      choice: ResponseChoiceSchema,
      option_id: z.string().max(40).nullable(),
      rationale: note,
      responder_id: id,
      responded_at: timestamp,
      time_spent_ms: z.number().int().nullable(),
      interruption: z.enum(['useful', 'unnecessary']).nullable(),
      grant_id: id.nullable(),
    })
    .nullable(),
  closed_reason: short.nullable(),
  coverage: CoverageSchema,
});
export type Decision = z.infer<typeof DecisionSchema>;

// Assumptions and the pre-build humility gate are stored as versioned records.
export const AssumptionBodySchema = z
  .strictObject({
    statement: note,
    consequence_if_wrong: note,
    would_change_decision: note,
    status: z.enum(['unresolved', 'supported', 'refuted']),
    materiality: z.enum(['routine', 'material']),
    reversible: z.boolean(),
    cheap_test: note.nullable(),
    run_id: id.nullable(),
  })
  .superRefine((a, ctx) => {
    if (a.materiality === 'routine' && (!a.reversible || !a.cheap_test))
      ctx.addIssue({
        code: 'custom',
        message:
          'A routine assumption must be reversible and name a cheap test; otherwise mark it material.',
      });
  });
const comparison = z.strictObject({
  assessment: note,
  viable: z.boolean(),
  evidence_refs: z.array(TargetRefSchema).max(20),
});
export const HumilityBodySchema = z.strictObject({
  subject: TargetRefSchema,
  outcome_that_matters: note,
  whose_perspective: note,
  evidence: z.strictObject({
    supported: z.array(short).max(20),
    inferred: z.array(short).max(20),
    disputed: z.array(short).max(20),
    unknown: z.array(short).max(20),
  }),
  comparisons: z.strictObject({
    software: comparison,
    existing_tool: comparison,
    process_change: comparison,
    human_led: comparison,
    hybrid: comparison,
    defer_decline: comparison,
  }),
  software_part: note,
  human_part: note,
  burden_risks: z.array(short).max(20),
  disconfirming_test: note,
  change_course_trigger: note,
  ethical: z.strictObject({
    status: z.enum(['none_identified', 'resolved', 'unresolved_serious']),
    note,
  }),
  disposition: z.enum([
    'build',
    'use_existing',
    'change_process',
    'human_led',
    'hybrid',
    'investigate',
    'defer',
    'decline',
  ]),
  /** Concise decision explanation, not a reasoning transcript. */
  rationale: note,
  dissent: z.array(note).max(10),
});
export type HumilityBody = z.infer<typeof HumilityBodySchema>;
export const HumilityVerdictSchema = z.strictObject({
  review_id: id,
  review_version: version,
  disposition: HumilityBodySchema.shape.disposition,
  build_admissible: z.boolean(),
  needs_judgment: z.boolean(),
  reasons: z.array(z.string().max(300)),
});

// Owner sessions.
export const AuthModeSchema = z.enum(['dev_local', 'oidc']);
export const SessionInfoSchema = z.strictObject({
  authenticated: z.literal(true),
  actor_id: id,
  display_name: z.string().max(200),
  method: AuthModeSchema,
  csrf_token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expires_at: timestamp,
  /** ADR-0075: a tester account's session; absent or 'owner' for the owner. */
  account: z.enum(['owner', 'tester']).optional(),
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export const AuthStatusSchema = z.strictObject({
  mode: AuthModeSchema,
  available: z.boolean(),
  login_path: z.string().max(200),
  /** §2.1: the installed desktop app holds the local-owner code; sign in from its menu. */
  managed_by: z.literal('desktop_app').optional(),
});
export const DevLoginRequestSchema = z.strictObject({
  code: z.string().min(32).max(200),
});
