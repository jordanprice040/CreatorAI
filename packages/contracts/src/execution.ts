import {
  z,
  schemaVersion,
  id,
  text,
  hash,
  timestamp,
  counter,
  nanoUsd,
  ConditionSchema,
  DiscoverySchema,
  EntityRefSchema,
  OutcomeSchema,
  ExecutionStateSchema,
  ProductStageSchema,
} from './primitives.js';
import {
  CostSchema,
  AssumptionSchema,
  AlternativeSchema,
  DecisionRequestSchema,
} from './records.js';

export const LimitsSchema = z.strictObject({
  max_calls: counter.min(1),
  max_input_tokens: counter.min(1),
  max_output_tokens: counter.min(1),
  max_wall_seconds: counter.min(1).max(86400),
  max_cost_nano_usd: nanoUsd,
  max_concurrency: counter.min(1).max(32),
  max_children: counter.max(100),
  max_depth: counter.max(10),
  max_repairs: counter.max(10),
});
const policyFields = {
  schema_version: schemaVersion,
  id,
  workspace_id: id,
  version: counter.min(1),
  deployment_mode: z.enum(['local', 'hosted']),
  data_mode: z.enum(['fixture', 'live']),
  autonomy_mode: z.enum([
    'supervised',
    'human_in_loop',
    'autonomous_within_scope',
    'human_only',
  ]),
  experiment_condition: ConditionSchema,
  discovery_method: DiscoverySchema,
  provider: z.enum(['fixture', 'live']),
  live_external_effects_enabled: z.boolean(),
  grant_ids: z.array(id).max(100),
  policy_version: text,
  model_policy_ref: text,
  verified_api_model_id: text.nullable(),
  pricing_ref: EntityRefSchema.nullable(),
  limits: LimitsSchema,
  deadline: timestamp,
  external_tracing_enabled: z.literal(false),
};
export const RunConfigSchema = z
  .strictObject(policyFields)
  .superRefine((c, ctx) => {
    if (
      c.data_mode === 'fixture' &&
      (c.provider !== 'fixture' ||
        c.live_external_effects_enabled ||
        c.deployment_mode !== 'local' ||
        c.verified_api_model_id !== null ||
        c.pricing_ref !== null ||
        c.limits.max_cost_nano_usd !== '0')
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Fixture configuration must be local, free and explicitly non-live.',
      });
    if (
      c.data_mode === 'live' &&
      (c.provider !== 'live' ||
        !c.live_external_effects_enabled ||
        !c.verified_api_model_id ||
        !c.pricing_ref ||
        c.grant_ids.length === 0 ||
        BigInt(c.limits.max_cost_nano_usd) === 0n)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Paid configuration requires model/pricing identity, grants and a positive bounded cap.',
      });
    if (
      c.experiment_condition === 'human_only' &&
      (c.autonomy_mode !== 'human_only' ||
        c.discovery_method !== 'human_defined')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Human-only mode and discovery method must agree.',
      });
    if (
      c.experiment_condition !== 'human_only' &&
      (c.autonomy_mode === 'human_only' ||
        c.discovery_method === 'human_defined')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'AI configuration cannot claim human-only work.',
      });
    if (
      c.experiment_condition === 'autonomous' &&
      c.autonomy_mode !== 'autonomous_within_scope'
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Autonomous research must remain autonomous within scope.',
      });
    if (
      c.experiment_condition === 'human_in_loop' &&
      !['supervised', 'human_in_loop'].includes(c.autonomy_mode)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Assisted research requires assisted mode.',
      });
  });
// Logical relative paths only. Filesystem canonicalization/isolation is a later worker gate.
export const ScopePathSchema = z
  .string()
  .min(1)
  .max(240)
  .regex(/^[a-z0-9_-][a-z0-9_./-]*$/)
  .refine(
    (p) =>
      !p.includes('..') &&
      !p.endsWith('/') &&
      !p.split('/').some((s) => !s || s.startsWith('.')),
    'Use canonical lowercase relative resource paths.',
  );
export const TaskSchema = z
  .strictObject({
    schema_version: schemaVersion,
    id,
    run_id: id,
    project_id: id,
    workspace_id: id,
    version: counter.min(1),
    specification: EntityRefSchema,
    config_hash: hash,
    prompt_hash: hash,
    role: text,
    experiment_condition: ConditionSchema,
    discovery_method: DiscoverySchema,
    goal: text,
    non_goals: z.array(text).max(30),
    input_refs: z.array(EntityRefSchema).max(100),
    acceptance_criteria: z.array(text).min(1).max(30),
    output_schema_ref: z.literal('task-result/1.0'),
    dependencies: z.array(id).max(100),
    allowed_tools: z.array(text).max(100),
    allowed_data_classifications: z
      .array(z.enum(['synthetic', 'public', 'private_approved']))
      .min(1),
    allowed_paths: z.array(ScopePathSchema).max(100),
    output_destinations: z.array(ScopePathSchema).max(100),
    grant_ids: z.array(id).max(100),
    policy_version: text,
    model_policy_ref: text,
    budget_envelope_id: id,
    limits: LimitsSchema,
    deadline: timestamp,
    depth: counter,
    parent_task_id: id.nullable(),
    logical_operation_id: id,
    cancellation_id: id,
    lease_ref: id,
  })
  .superRefine((t, ctx) => {
    if (
      t.specification.kind !== 'specification' ||
      t.specification.workspace_id !== t.workspace_id ||
      t.input_refs.some((r) => r.workspace_id !== t.workspace_id)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Task references must belong to its workspace; specification must have the correct kind.',
      });
    if (
      t.depth > t.limits.max_depth ||
      (t.parent_task_id === null) !== (t.depth === 0) ||
      t.parent_task_id === t.id ||
      t.dependencies.includes(t.id)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Invalid task depth, parent or self-dependency.',
      });
  });
export const OutcomeEvidenceSchema = z.strictObject({
  id,
  kind: z.enum([
    'source_support',
    'alternatives_review',
    'specification',
    'build',
    'test',
    'review',
    'export',
    'authorization',
    'feedback',
    'rationale',
  ]),
  subject_id: id,
  subject_version: counter.min(1),
  spec_hash: hash,
  candidate_hash: hash,
  actor_id: id,
  fixture: z.boolean(),
  passed: z.boolean(),
  locator: text,
});
export const TaskResultSchema = z
  .strictObject({
    schema_version: schemaVersion,
    task_id: id,
    task_version: counter.min(1),
    run_id: id,
    attempt_id: id,
    config_hash: hash,
    spec_hash: hash,
    candidate_hash: hash,
    fixture: z.boolean(),
    status: z.enum([
      'succeeded',
      'failed',
      'deferred',
      'needs_human',
      'cancelled',
    ]),
    outcome: OutcomeSchema,
    summary: text,
    artifacts: z.array(EntityRefSchema).max(100),
    claim_refs: z.array(EntityRefSchema).max(100),
    evidence: z.array(OutcomeEvidenceSchema).max(100),
    assumptions: z.array(AssumptionSchema).max(30),
    alternatives: z.array(AlternativeSchema).max(20),
    decision_request: DecisionRequestSchema.nullable(),
    cost: CostSchema,
    checks: z
      .array(
        z.strictObject({ name: text, passed: z.boolean(), evidence_id: id }),
      )
      .max(100),
    blockers: z.array(text).max(30),
    next_permitted_action: text,
  })
  .superRefine((r, ctx) => {
    if (
      r.status === 'succeeded' &&
      (r.evidence.length === 0 ||
        ['defer', 'failed'].includes(r.outcome) ||
        r.blockers.length > 0)
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Success requires evidence, a completed disposition and no blockers.',
      });
    if ((r.status === 'failed') !== (r.outcome === 'failed'))
      ctx.addIssue({
        code: 'custom',
        message: 'Failed status/outcome must agree.',
      });
    if (
      ['deferred', 'needs_human', 'cancelled'].includes(r.status) &&
      r.outcome !== 'defer'
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Stopped results require defer outcome.',
      });
    if (r.status !== 'succeeded' && r.blockers.length === 0)
      ctx.addIssue({
        code: 'custom',
        message: 'Stopped results require a reason.',
      });
    if (r.status === 'needs_human' && !r.decision_request)
      ctx.addIssue({
        code: 'custom',
        message: 'Needs-human result requires a concrete request.',
      });
    if (
      r.fixture &&
      (r.cost.status !== 'known' ||
        r.cost.basis !== 'fixture' ||
        r.cost.amount.amount !== '0')
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Fixture results must report fixture zero cost.',
      });
    if (!r.fixture && r.cost.status === 'known' && r.cost.basis === 'fixture')
      ctx.addIssue({
        code: 'custom',
        message: 'Live cost cannot use fixture accounting.',
      });
  });
export const ProductSchema = z.strictObject({
  schema_version: schemaVersion,
  id,
  workspace_id: id,
  version: counter.min(1),
  stage: ProductStageSchema,
  spec_hash: hash,
  candidate_hash: hash,
  builder_id: id,
  fixture: z.boolean(),
});
export const ExecutionSchema = z.strictObject({
  schema_version: schemaVersion,
  id,
  task_id: id,
  version: counter.min(1),
  state: ExecutionStateSchema,
  condition: ConditionSchema,
  discovery_method: DiscoverySchema,
});
export const FixtureRequestSchema = z.strictObject({
  goal: text.max(500),
  outcome: OutcomeSchema,
});
const MaintenanceJobSchema = z.strictObject({
  last_success_at: z.iso.datetime().nullable(),
  last_failure_at: z.iso.datetime().nullable(),
  error_code: z.string().max(48).nullable(),
});
export const HealthSchema = z.strictObject({
  schema_version: schemaVersion,
  status: z.literal('ok'),
  service: z.literal('creator-agent-api'),
  /** `live_configured` means a live adapter is configured, not that a live call was verified. */
  data_mode: z.enum(['fixture', 'live_configured']),
  provider: z.string().max(120),
  live_enabled: z.boolean(),
  live: z.strictObject({
    model: z.enum(['not_configured', 'configured_unverified']),
    sources: z.enum(['off', 'configured_unverified']),
  }),
  persistent: z.boolean(),
  storage: z.enum(['postgresql', 'not_configured', 'unavailable']),
  maintenance: z.strictObject({
    enabled: z.boolean(),
    degraded: z.boolean(),
    jobs: z.strictObject({
      outbox: MaintenanceJobSchema,
      broker_recovery: MaintenanceJobSchema,
      retrieval_recovery: MaintenanceJobSchema,
    }),
  }),
});
export const FixtureResponseSchema = z.strictObject({
  fixture: z.literal(true),
  task: TaskSchema,
  result: TaskResultSchema,
  product: ProductSchema,
  execution: ExecutionSchema,
});
export type Limits = z.infer<typeof LimitsSchema>;
export type RunConfig = z.infer<typeof RunConfigSchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskResult = z.infer<typeof TaskResultSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type Execution = z.infer<typeof ExecutionSchema>;
export type OutcomeEvidence = z.infer<typeof OutcomeEvidenceSchema>;
export type FixtureResponse = z.infer<typeof FixtureResponseSchema>;
