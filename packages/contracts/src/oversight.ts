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
  'spec.freeze',
  'product.commit_build',
  'release.publish',
  'message.send',
  'payment.charge',
  'grant.create',
  'policy.change',
  'budget.increase',
]);
export type ActionType = z.infer<typeof ActionTypeSchema>;
export const DataClassSchema = z.enum([
  'synthetic',
  'public',
  'private_approved',
]);
export const TargetRefSchema = z.strictObject({ id, version });

// Runs under oversight. Mode and condition are fixed at registration.
export const RegisterRunRequestSchema = z.strictObject({
  run: TargetRefSchema,
  autonomy_mode: AutonomyModeSchema,
  stage_gates: z.array(ActionTypeSchema).max(20).nullable(),
  /** Autonomous runs may use only grants listed here, at these versions. */
  initial_grants: z.array(TargetRefSchema).max(50),
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
export const HumilityOptionKeys = [
  'software',
  'existing_tool',
  'process_change',
  'human_led',
  'hybrid',
  'defer_decline',
] as const;
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
});
export type SessionInfo = z.infer<typeof SessionInfoSchema>;
export const AuthStatusSchema = z.strictObject({
  mode: AuthModeSchema,
  available: z.boolean(),
  login_path: z.string().max(200),
});
export const DevLoginRequestSchema = z.strictObject({
  code: z.string().min(32).max(200),
});
