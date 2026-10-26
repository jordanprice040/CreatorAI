import {
  z,
  id,
  hash,
  timestamp,
  counter,
  nanoUsd,
  version,
} from './primitives.js';
import {
  EvidencePacketSchema,
  DiscoveryTaskContextSchema,
  DiscoveryTaskKindSchema,
  FindingTypeSchema,
} from './discovery.js';
import { DataClassSchema } from './oversight.js';
import { MeteredActionSchema, ProviderSchema } from './budget.js';

// X01 model registry and qualified routing. The registry describes what each model can do
// and at what documented price; route policies say how to choose; promotions are the only
// way a model other than the reference baseline becomes eligible, and only on held-out
// evidence. Nothing here grants authority or spends: the broker still enforces grants and
// budgets for every routed call.
const short = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(1200);
/** An exact fraction in [0, 1]; compared by cross-multiplication, never floats. */
export const RateSchema = z
  .strictObject({
    numerator: counter.max(1_000_000),
    denominator: counter.min(1).max(1_000_000),
  })
  .refine((r) => r.numerator <= r.denominator, 'A rate cannot exceed 1.');
export type Rate = z.infer<typeof RateSchema>;
export const ModelRefSchema = z.strictObject({
  provider: ProviderSchema,
  model_id: short,
});
export type ModelRef = z.infer<typeof ModelRefSchema>;

export const ROUTING_POLICY_VERSION = 'routing/1.0' as const;
export const TaskClassSchema = z.enum([
  'research_synthesis',
  'candidate_generation',
  'scoring',
  'specification',
  'code_build',
  'independent_review',
  'summarization',
  'embedding',
]);
export type TaskClass = z.infer<typeof TaskClassSchema>;

/**
 * `fixture` models exist only in fixture workspaces. `documented` means the provider
 * publishes the model; it does not prove this account can call it. Only `verified` (an
 * accessible API id recorded with evidence) is routable in a real workspace.
 */
export const ModelAvailabilitySchema = z
  .strictObject({
    state: z.enum(['fixture', 'documented', 'verified', 'withdrawn']),
    verified_api_model_id: short.nullable(),
    verified_at: timestamp.nullable(),
    evidence: note,
  })
  .superRefine((a, ctx) => {
    if ((a.state === 'verified') !== (a.verified_api_model_id !== null))
      ctx.addIssue({
        code: 'custom',
        message:
          'A verified model records its accessible API id, and only then.',
      });
    if (a.state === 'verified' && a.verified_at === null)
      ctx.addIssue({
        code: 'custom',
        message: 'A verified model records when it was verified.',
      });
  });
export const RegistryModelSchema = z.strictObject({
  provider: ProviderSchema,
  model_id: short,
  /** canonicalHash of the pricing snapshot body this entry was registered with. */
  pricing_hash: hash,
  availability: ModelAvailabilitySchema,
  task_classes: z.array(TaskClassSchema).min(1).max(8),
  tools: z.array(short).max(20),
  /** Data classes the owner allows this provider/model to receive. */
  data_classes: z.array(DataClassSchema).min(1).max(3),
  latency: z.strictObject({
    p95_ms: counter.min(1).nullable(),
    basis: z.enum(['fixture', 'measured', 'unknown']),
  }),
  notes: note,
});
export type RegistryModel = z.infer<typeof RegistryModelSchema>;
export const ModelRegistryBodySchema = z
  .strictObject({
    format: z.literal('model-registry/1'),
    registry_version: short,
    recorded_on: z.iso.date(),
    fixture: z.boolean(),
    /** The owner's preferred reference model: the baseline every route is judged against. */
    reference_model: ModelRefSchema,
    models: z.array(RegistryModelSchema).min(1).max(50),
  })
  .superRefine((r, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    const keys = r.models.map((m) => `${m.provider}/${m.model_id}`);
    if (new Set(keys).size !== keys.length)
      issue('Each model appears once in a registry version.');
    if (
      !r.models.some(
        (m) =>
          m.provider === r.reference_model.provider &&
          m.model_id === r.reference_model.model_id,
      )
    )
      issue('The reference model must be a registry entry.');
    for (const m of r.models)
      if (r.fixture !== (m.availability.state === 'fixture'))
        issue(
          `${m.model_id}: fixture registries hold only fixture models, and real ones none.`,
        );
  });
export type ModelRegistryBody = z.infer<typeof ModelRegistryBodySchema>;
export const RegisterRegistryRequestSchema = z.strictObject({
  registry: ModelRegistryBodySchema,
  /** Pricing bodies the entries refer to by hash; created in the workspace if missing. */
  pricing: z.array(z.unknown()).min(1).max(50),
});
export const ModelRegistrySchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  registry_hash: hash,
  body: ModelRegistryBodySchema,
  /** pricing_snapshots id for each `provider/model_id`. */
  pricing_snapshot_ids: z.record(short, id),
  created_by: id,
  created_at: timestamp,
});
export type ModelRegistry = z.infer<typeof ModelRegistrySchema>;

export const RoutePolicyScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('workspace') }),
  z.strictObject({ kind: z.literal('project'), project_id: id }),
]);
export type RoutePolicyScope = z.infer<typeof RoutePolicyScopeSchema>;
/**
 * fixed: one named model, never a substitute. auto: the best held-out accepted rate among
 * qualified routes. economy: the lowest cost per accepted result among qualified routes at
 * or above the quality floor; otherwise the reference baseline.
 */
export const RoutePolicyBodySchema = z
  .strictObject({
    format: z.literal('route-policy/1'),
    mode: z.enum(['fixed', 'auto', 'economy']),
    fixed_model: ModelRefSchema.nullable(),
    quality_floor: RateSchema.nullable(),
    /** Optional allow-list; null admits every registry model that qualifies. */
    allowed_models: z.array(ModelRefSchema).min(1).max(50).nullable(),
    rationale: note,
  })
  .superRefine((p, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if ((p.mode === 'fixed') !== (p.fixed_model !== null))
      issue('Name a fixed model exactly when the mode is fixed.');
    if ((p.mode === 'economy') !== (p.quality_floor !== null))
      issue('Economy needs a quality floor, and only economy uses one.');
  });
export type RoutePolicyBody = z.infer<typeof RoutePolicyBodySchema>;
export const SetRoutePolicyRequestSchema = z.strictObject({
  scope: RoutePolicyScopeSchema,
  body: RoutePolicyBodySchema,
});
export const RoutePolicySchema = z.strictObject({
  id,
  workspace_id: id,
  scope: RoutePolicyScopeSchema,
  version,
  policy_hash: hash,
  body: RoutePolicyBodySchema,
  created_by: id,
  created_at: timestamp,
});
export type RoutePolicy = z.infer<typeof RoutePolicySchema>;

export const RouteRequestSchema = z
  .strictObject({
    run_id: id,
    task_id: id.nullable(),
    project_id: id.nullable(),
    logical_operation_id: id,
    task_class: TaskClassSchema,
    action_type: MeteredActionSchema,
    tools: z.array(short).max(20),
    data_class: DataClassSchema,
    estimated_input_tokens: counter.min(1),
    max_output_tokens: counter.min(1).max(200000),
    max_latency_ms: counter.min(1).nullable(),
  })
  .superRefine((r, ctx) => {
    if ((r.action_type === 'tool.search_public') !== r.tools.length > 0)
      ctx.addIssue({
        code: 'custom',
        message: 'Name tools exactly when the action is a tool call.',
      });
  });
export type RouteRequest = z.infer<typeof RouteRequestSchema>;

/** Why a route was or was not eligible; every candidate gets one. */
export const RouteReasonSchema = z.enum([
  'eligible_reference_baseline',
  'eligible_promoted',
  'eligible_canary',
  'model_unverified',
  'model_withdrawn',
  'not_allowed_by_policy',
  'action_unsupported',
  'task_class_unsupported',
  'tool_unsupported',
  'privacy_incompatible',
  'context_exceeded',
  'latency_unknown',
  'latency_exceeded',
  'not_promoted',
  'canary_not_selected',
  'below_quality_floor',
]);
export type RouteReason = z.infer<typeof RouteReasonSchema>;
export const RouteCandidateSchema = z.strictObject({
  provider: ProviderSchema,
  model_id: short,
  eligible: z.boolean(),
  reasons: z.array(RouteReasonSchema).min(1),
  held_out_accepted: RateSchema.nullable(),
  cost_per_accepted_nano: nanoUsd.nullable(),
  promotion_id: id.nullable(),
});
export type RouteCandidate = z.infer<typeof RouteCandidateSchema>;
export const RouteRoleSchema = z.enum([
  'reference_baseline',
  'fixed',
  'auto',
  'economy',
  'canary',
  'escalation',
]);
export const RouteDecisionSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  status: z.enum(['routed', 'refused']),
  reason_code: short,
  explanation: z.string().max(1200),
  request: RouteRequestSchema,
  policy_id: id.nullable(),
  policy_version: version.nullable(),
  policy_hash: hash.nullable(),
  registry_id: id,
  registry_version: short,
  registry_hash: hash,
  model: ModelRefSchema.nullable(),
  pricing_snapshot_id: id.nullable(),
  pricing_hash: hash.nullable(),
  role: RouteRoleSchema.nullable(),
  promotion_id: id.nullable(),
  criteria_hash: hash.nullable(),
  /** A shadow candidate evaluated alongside, never served. */
  shadow: z
    .strictObject({
      model: ModelRefSchema,
      promotion_id: id,
      pricing_snapshot_id: id,
      logical_operation_id: id,
    })
    .nullable(),
  escalated_from: id.nullable(),
  candidates: z.array(RouteCandidateSchema),
  created_by: id,
  created_at: timestamp,
});
export type RouteDecision = z.infer<typeof RouteDecisionSchema>;

/**
 * Objective outcome signals only. There is deliberately no confidence field: a model's own
 * certainty never accepts a result or triggers escalation.
 */
export const ObjectiveSignalSchema = z.enum([
  'accepted',
  'schema_invalid',
  'incomplete_output',
  'acceptance_check_failed',
  'review_rejected',
  'provider_error',
]);
export type ObjectiveSignal = z.infer<typeof ObjectiveSignalSchema>;
export const RecordRouteOutcomeRequestSchema = z.strictObject({
  variant: z.enum(['primary', 'shadow']),
  signal: ObjectiveSignalSchema,
  /** Review, repair and tool operations whose cost belongs to this result. */
  related_operation_ids: z.array(id).max(20),
  note: note.nullable(),
});
export const CostSummarySchema = z.strictObject({
  incurred_nano: nanoUsd,
  unknown_nano: nanoUsd,
  operations: counter,
});
export type CostSummary = z.infer<typeof CostSummarySchema>;
export const RouteOutcomeSchema = z.strictObject({
  id,
  decision_id: id,
  variant: z.enum(['primary', 'shadow']),
  provider: ProviderSchema,
  model_id: short,
  promotion_id: id.nullable(),
  signal: ObjectiveSignalSchema,
  accepted: z.boolean(),
  related_operation_ids: z.array(id),
  cost: CostSummarySchema,
  note: note.nullable(),
  created_by: id,
  created_at: timestamp,
});
export type RouteOutcome = z.infer<typeof RouteOutcomeSchema>;
export const EscalateRouteRequestSchema = z.strictObject({
  logical_operation_id: id,
});

// Held-out benchmark. Expected values are written before any result and the manifest hash
// binds every result, so criteria and labels cannot move after results are seen.
const BenchmarkAssertionSchema = z
  .strictObject({
    // Opt-in identity binding; omitted on every historical assertion.
    select: z
      .strictObject({
        proposal: z.string().regex(/^P[1-5]$/),
        finding: z
          .strictObject({
            type: FindingTypeSchema,
            catalog_ref: z
              .string()
              .regex(/^K[1-9][0-9]?$/)
              .nullable()
              .optional(),
            claim_ref: z
              .string()
              .regex(/^C[1-9][0-9]?$/)
              .optional(),
          })
          .optional(),
      })
      .optional(),
    path: z.array(z.string().min(1).max(80)).min(1).max(8),
    op: z.enum(['equals', 'one_of', 'includes', 'nonempty']),
    value: z
      .union([z.string().max(200), z.boolean(), z.number().finite(), z.null()])
      .optional(),
    values: z
      .array(
        z.union([
          z.string().max(200),
          z.boolean(),
          z.number().finite(),
          z.null(),
        ]),
      )
      .min(1)
      .max(10)
      .optional(),
  })
  .superRefine((a, ctx) => {
    if ((a.op === 'equals' || a.op === 'includes') && a.value === undefined)
      ctx.addIssue({
        code: 'custom',
        message: 'This assertion needs a value.',
      });
    if (a.op === 'one_of' && !a.values)
      ctx.addIssue({ code: 'custom', message: 'one_of needs values.' });
  });
export const BenchmarkCheckSchema = z.discriminatedUnion('kind', [
  z
    .strictObject({
      kind: z.literal('discovery_contract'),
      task_kind: DiscoveryTaskKindSchema,
      packet: EvidencePacketSchema,
      context: DiscoveryTaskContextSchema,
      assertions: z.array(BenchmarkAssertionSchema).min(1).max(20),
    })
    .superRefine((c, ctx) => {
      for (const a of c.assertions) {
        if (!a.select) continue;
        if (c.task_kind !== 'skeptic')
          ctx.addIssue({
            code: 'custom',
            message: 'Identity selection requires a skeptic task.',
          });
        const labels = c.context.inputs
          .filter((i) => i.kind === 'propose' || i.kind === 'revise')
          .map((i) => i.label.split(' ')[0]);
        if (labels.filter((p) => p === a.select!.proposal).length !== 1)
          ctx.addIssue({
            code: 'custom',
            message: 'Selection requires one supplied proposal identity.',
          });
        const f = a.select.finding;
        if (f?.claim_ref && !c.packet.claims.some((r) => r.ref === f.claim_ref))
          ctx.addIssue({
            code: 'custom',
            message: 'Selected claim is not in the packet.',
          });
        if (
          f?.catalog_ref &&
          !c.packet.catalog.some((r) => r.ref === f.catalog_ref)
        )
          ctx.addIssue({
            code: 'custom',
            message: 'Selected catalog entry is not in the packet.',
          });
      }
    }),
  z.strictObject({
    kind: z.literal('json_keys'),
    keys: z.array(short).min(1).max(20),
  }),
  z.strictObject({
    kind: z.literal('contains_all'),
    phrases: z.array(short).min(1).max(20),
  }),
  z.strictObject({ kind: z.literal('exact_label'), label: short }),
]);
export type BenchmarkCheck = z.infer<typeof BenchmarkCheckSchema>;
export const BenchmarkCaseSchema = z.strictObject({
  case_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
  split: z.enum(['development', 'held_out']),
  input: z
    .array(
      z.strictObject({
        role: z.enum(['system', 'user']),
        text: z.string().min(1).max(20000),
      }),
    )
    .min(1)
    .max(10),
  output_format: z.enum(['text', 'json']),
  max_output_tokens: counter.min(1).max(200000),
  check: BenchmarkCheckSchema,
});
export const BenchmarkManifestSchema = z
  .strictObject({
    format: z.literal('route-benchmark/1'),
    name: short,
    fixture: z.boolean(),
    task_class: TaskClassSchema,
    data_class: DataClassSchema,
    cases: z.array(BenchmarkCaseSchema).min(2).max(200),
    provenance: note,
  })
  .superRefine((b, ctx) => {
    for (const c of b.cases)
      if (c.check.kind === 'discovery_contract') {
        const required =
          c.check.task_kind === 'locate'
            ? 'research_synthesis'
            : c.check.task_kind === 'skeptic'
              ? 'scoring'
              : 'candidate_generation';
        if (b.task_class !== required || c.output_format !== 'json')
          ctx.addIssue({
            code: 'custom',
            message: 'Discovery check task class/output format mismatch.',
          });
      }
    const ids = b.cases.map((c) => c.case_id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Case ids must be unique.' });
    if (!b.cases.some((c) => c.split === 'held_out'))
      ctx.addIssue({
        code: 'custom',
        message: 'A benchmark needs held-out cases.',
      });
  });
export type BenchmarkManifest = z.infer<typeof BenchmarkManifestSchema>;
export const RouteBenchmarkSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  manifest_hash: hash,
  manifest: BenchmarkManifestSchema,
  created_by: id,
  created_at: timestamp,
});
export type RouteBenchmark = z.infer<typeof RouteBenchmarkSchema>;
export const BenchmarkResultSchema = z.strictObject({
  promotion_id: id,
  benchmark_id: id,
  manifest_hash: hash,
  provider: ProviderSchema,
  model_id: short,
  case_id: short,
  split: z.enum(['development', 'held_out']),
  signal: ObjectiveSignalSchema,
  passed: z.boolean(),
  logical_operation_id: id,
  cost: CostSummarySchema,
  created_at: timestamp,
});
export type BenchmarkResult = z.infer<typeof BenchmarkResultSchema>;

/** Fixed before any result for the promotion exists; its hash binds every evaluation. */
export const PromotionCriteriaSchema = z
  .strictObject({
    format: z.literal('promotion-criteria/1'),
    min_held_out_cases: counter.min(3).max(200),
    quality_floor: RateSchema,
    /** Largest allowed drop below the baseline's held-out accepted rate. */
    max_regression: RateSchema,
    shadow_min_outcomes: counter.min(1).max(1000),
    canary_fraction: RateSchema,
    canary_max_decisions: counter.min(1).max(10000),
    canary_min_outcomes: counter.min(1).max(1000),
    /** After promotion, this many outcomes below the floor roll the route back. */
    rollback_window: counter.min(1).max(1000),
  })
  .superRefine((c, ctx) => {
    if (c.canary_fraction.numerator * 4 > c.canary_fraction.denominator)
      ctx.addIssue({
        code: 'custom',
        message: 'A canary serves at most a quarter of eligible decisions.',
      });
    if (c.canary_min_outcomes > c.canary_max_decisions)
      ctx.addIssue({
        code: 'custom',
        message: 'The canary cap must allow its minimum outcomes.',
      });
  });
export type PromotionCriteria = z.infer<typeof PromotionCriteriaSchema>;
export const CreatePromotionRequestSchema = z.strictObject({
  registry_id: id,
  task_class: TaskClassSchema,
  candidate: ModelRefSchema,
  benchmark_id: id,
  criteria: PromotionCriteriaSchema,
  rationale: note,
});
export const PromotionStateSchema = z.enum([
  'candidate',
  'shadow',
  'canary',
  'promoted',
  'rejected',
  'rolled_back',
]);
export const SavingsClaimSchema = z.enum([
  'measured',
  'not_claimed_fixture',
  'not_claimed_unknown_cost',
  'not_claimed_no_accepted',
  'not_claimed_not_cheaper',
]);
export const ArmSummarySchema = z.strictObject({
  provider: ProviderSchema,
  model_id: short,
  cases: counter,
  accepted: counter,
  accepted_rate: RateSchema.nullable(),
  cost: CostSummarySchema,
  cost_per_accepted_nano: nanoUsd.nullable(),
});
export type ArmSummary = z.infer<typeof ArmSummarySchema>;
export const PromotionEvaluationSchema = z.strictObject({
  stage: z.enum(['benchmark', 'shadow', 'canary', 'post_promotion']),
  passed: z.boolean(),
  reasons: z.array(short),
  candidate: ArmSummarySchema,
  baseline: ArmSummarySchema.nullable(),
  savings_claim: SavingsClaimSchema,
});
export type PromotionEvaluation = z.infer<typeof PromotionEvaluationSchema>;
export const PromotionSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  version,
  registry_id: id,
  task_class: TaskClassSchema,
  candidate: ModelRefSchema,
  baseline: ModelRefSchema,
  benchmark_id: id,
  manifest_hash: hash,
  criteria: PromotionCriteriaSchema,
  criteria_hash: hash,
  state: PromotionStateSchema,
  canary_decisions: counter,
  evaluations: z.array(PromotionEvaluationSchema),
  reason: z.string().max(1200),
  rationale: note,
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
});
export type Promotion = z.infer<typeof PromotionSchema>;
export const RunBenchmarkRequestSchema = z.strictObject({
  run_id: id,
  envelope_id: id,
  timeout_ms: counter.min(100).max(600000),
});
export const PromotionTransitionRequestSchema = z.strictObject({
  expected_version: version,
  reason: note,
});
