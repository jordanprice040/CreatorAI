import { createHash } from 'node:crypto';
import {
  ContractError,
  parse,
  TaskSchema,
  TaskResultSchema,
  RunConfigSchema,
  ProductSchema,
  ExecutionSchema,
  OutcomeEvidenceSchema,
  ExecutionStateSchema,
  ProductStageSchema,
  counter,
  type Task,
  type TaskResult,
  type ProductStage,
  type ExecutionState,
  type OutcomeEvidence,
  type Limits,
} from '@creator/contracts';

export function canonicalHash(value: unknown): string {
  function order(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(order);
    if (v !== null && typeof v === 'object')
      return Object.fromEntries(
        Object.entries(v)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, val]) => [k, order(val)]),
      );
    return v;
  }
  return createHash('sha256')
    .update(JSON.stringify(order(value)))
    .digest('hex');
}
function requireRule(
  ok: boolean,
  code: ConstructorParameters<typeof ContractError>[0],
  message: string,
): asserts ok {
  if (!ok) throw new ContractError(code, message);
}
const within = (child: string, parent: string) =>
  child === parent || child.startsWith(`${parent}/`);
function subset<T>(child: readonly T[], parent: readonly T[]): boolean {
  return child.every((v) => parent.includes(v));
}
const sumLimits = [
  'max_calls',
  'max_input_tokens',
  'max_output_tokens',
  'max_concurrency',
  'max_repairs',
] as const;
function checkLimits(child: Limits, parent: Limits): void {
  for (const key of [
    ...sumLimits,
    'max_wall_seconds',
    'max_depth',
    'max_children',
  ] as const)
    requireRule(
      child[key] <= parent[key],
      'LIMIT_EXCEEDED',
      `${key} exceeds parent.`,
    );
  requireRule(
    BigInt(child.max_cost_nano_usd) <= BigInt(parent.max_cost_nano_usd),
    'LIMIT_EXCEEDED',
    'Cost cap exceeds parent.',
  );
}

/** Pure admission prerequisite, NOT paid authorization/reservation. Live is always denied in T01. */
export function admitTask(
  rawTask: unknown,
  rawConfig: unknown,
  now = Date.now(),
): Task {
  const task = parse(TaskSchema, rawTask);
  const config = parse(RunConfigSchema, rawConfig);
  requireRule(
    Number.isFinite(now),
    'INVALID_CONFIG',
    'Invalid admission clock.',
  );
  requireRule(
    task.config_hash === canonicalHash(config) &&
      task.run_id === config.id &&
      task.workspace_id === config.workspace_id &&
      task.experiment_condition === config.experiment_condition &&
      task.discovery_method === config.discovery_method,
    'RESULT_MISMATCH',
    'Task is not bound to this run configuration.',
  );
  requireRule(
    task.policy_version === config.policy_version &&
      task.model_policy_ref === config.model_policy_ref &&
      subset(task.grant_ids, config.grant_ids),
    'SCOPE_EXCEEDED',
    'Task authority exceeds run.',
  );
  checkLimits(task.limits, config.limits);
  requireRule(
    Date.parse(task.deadline) > now && Date.parse(config.deadline) > now,
    'EXPIRED',
    'Task or run deadline elapsed.',
  );
  requireRule(
    Date.parse(task.deadline) <= Date.parse(config.deadline),
    'LIMIT_EXCEEDED',
    'Task deadline exceeds run.',
  );
  requireRule(
    task.experiment_condition !== 'human_only',
    'HUMAN_ONLY_DENIED',
    'Human-only work cannot dispatch a provider, including a simulated provider.',
  );
  requireRule(
    config.data_mode === 'fixture' && config.provider === 'fixture',
    'LIVE_DISABLED',
    'Live dispatch requires later policy, budget and provider gates.',
  );
  requireRule(
    task.allowed_tools.length === 0 &&
      task.allowed_paths.length === 0 &&
      task.output_destinations.length === 0 &&
      task.allowed_data_classifications.every((v) => v === 'synthetic'),
    'SCOPE_EXCEEDED',
    'Fixture provider has no tools, filesystem or non-synthetic data access.',
  );
  return task;
}

/** Checks an entire proposed sibling allocation; no resource reservation is performed. */
export function validateDelegation(
  rawParent: unknown,
  rawChildren: readonly unknown[],
): Task[] {
  const parent = parse(TaskSchema, rawParent);
  const children = rawChildren.map((c) => parse(TaskSchema, c));
  requireRule(
    children.length <= parent.limits.max_children,
    'LIMIT_EXCEEDED',
    'Too many child tasks.',
  );
  requireRule(
    new Set(children.map((c) => c.id)).size === children.length &&
      new Set(children.map((c) => c.logical_operation_id)).size ===
        children.length,
    'SCOPE_EXCEEDED',
    'Duplicate child or operation identity.',
  );
  for (const c of children) {
    requireRule(
      c.parent_task_id === parent.id &&
        c.depth === parent.depth + 1 &&
        c.id !== parent.id &&
        c.logical_operation_id !== parent.logical_operation_id,
      'SCOPE_EXCEEDED',
      'Invalid child identity/depth.',
    );
    requireRule(
      c.workspace_id === parent.workspace_id &&
        c.run_id === parent.run_id &&
        c.project_id === parent.project_id &&
        c.config_hash === parent.config_hash &&
        canonicalHash(c.specification) ===
          canonicalHash(parent.specification) &&
        c.experiment_condition === parent.experiment_condition &&
        c.discovery_method === parent.discovery_method,
      'SCOPE_EXCEEDED',
      'Child changed scope, specification or research condition.',
    );
    requireRule(
      c.policy_version === parent.policy_version &&
        c.model_policy_ref === parent.model_policy_ref &&
        c.budget_envelope_id === parent.budget_envelope_id &&
        c.cancellation_id === parent.cancellation_id &&
        subset(c.grant_ids, parent.grant_ids) &&
        subset(c.allowed_tools, parent.allowed_tools) &&
        subset(
          c.allowed_data_classifications,
          parent.allowed_data_classifications,
        ) &&
        subset(parent.non_goals, c.non_goals),
      'SCOPE_EXCEEDED',
      'Child expanded authority or removed non-goals.',
    );
    requireRule(
      c.allowed_paths.every((p) =>
        parent.allowed_paths.some((base) => within(p, base)),
      ) &&
        c.output_destinations.every((p) =>
          parent.output_destinations.some((base) => within(p, base)),
        ) &&
        c.input_refs.every((r) =>
          parent.input_refs.some((p) => canonicalHash(p) === canonicalHash(r)),
        ),
      'SCOPE_EXCEEDED',
      'Child expanded paths or input data.',
    );
    checkLimits(c.limits, parent.limits);
    requireRule(
      Date.parse(c.deadline) <= Date.parse(parent.deadline),
      'LIMIT_EXCEEDED',
      'Child deadline exceeds parent.',
    );
  }
  for (const key of sumLimits)
    requireRule(
      children.reduce((s, c) => s + BigInt(c.limits[key]), 0n) <=
        BigInt(parent.limits[key]),
      'LIMIT_EXCEEDED',
      `Sibling ${key} allocations exceed parent.`,
    );
  requireRule(
    children.reduce((s, c) => s + BigInt(c.limits.max_cost_nano_usd), 0n) <=
      BigInt(parent.limits.max_cost_nano_usd),
    'LIMIT_EXCEEDED',
    'Sibling costs exceed parent.',
  );
  requireRule(
    children.reduce((s, c) => s + c.limits.max_children + 1, 0) <=
      parent.limits.max_children,
    'LIMIT_EXCEEDED',
    'Descendant allocations exceed parent.',
  );
  return children;
}

export function validateResult(
  rawTask: unknown,
  rawResult: unknown,
): TaskResult {
  const task = parse(TaskSchema, rawTask);
  const result = parse(TaskResultSchema, rawResult);
  requireRule(
    result.task_id === task.id &&
      result.task_version === task.version &&
      result.run_id === task.run_id &&
      result.config_hash === task.config_hash &&
      result.spec_hash === task.specification.sha256,
    'RESULT_MISMATCH',
    'Result belongs to another task, version, spec or configuration.',
  );
  requireRule(
    new Set(result.evidence.map((e) => e.id)).size === result.evidence.length,
    'EVIDENCE_MISMATCH',
    'Duplicate evidence identity.',
  );
  for (const e of result.evidence)
    requireRule(
      e.subject_id === task.id &&
        e.subject_version === task.version &&
        e.spec_hash === result.spec_hash &&
        e.candidate_hash === result.candidate_hash &&
        e.fixture === result.fixture,
      'EVIDENCE_MISMATCH',
      'Evidence is not bound to this candidate.',
    );
  for (const check of result.checks)
    requireRule(
      result.evidence.some(
        (e) => e.id === check.evidence_id && e.passed === check.passed,
      ),
      'MISSING_EVIDENCE',
      'Check has no matching evidence.',
    );
  requireRule(
    result.artifacts.every(
      (r) => r.workspace_id === task.workspace_id && r.kind === 'artifact',
    ) &&
      result.claim_refs.every(
        (r) => r.workspace_id === task.workspace_id && r.kind === 'claim',
      ) &&
      result.assumptions.every((r) => r.workspace_id === task.workspace_id) &&
      result.alternatives.every((r) => r.workspace_id === task.workspace_id),
    'SCOPE_EXCEEDED',
    'Result references cross scope or incorrect entity types.',
  );
  if (result.decision_request)
    requireRule(
      result.decision_request.task_id === task.id &&
        result.decision_request.run_id === task.run_id &&
        result.decision_request.workspace_id === task.workspace_id,
      'RESULT_MISMATCH',
      'Decision belongs to another task.',
    );
  if (task.experiment_condition === 'autonomous')
    requireRule(
      result.status !== 'needs_human' && result.decision_request === null,
      'SCOPE_EXCEEDED',
      'Autonomous runs defer; they cannot obtain task-specific human assistance.',
    );
  if (result.status === 'succeeded')
    requireRule(
      result.evidence.every((e) => e.passed) &&
        result.checks.every((c) => c.passed),
      'MISSING_EVIDENCE',
      'Success cannot contain failed acceptance evidence.',
    );
  return result;
}

const productEdges: Record<ProductStage, readonly ProductStage[]> = {
  captured: ['researched', 'deferred', 'rejected', 'failed'],
  researched: ['alternatives_compared', 'deferred', 'rejected', 'failed'],
  alternatives_compared: [
    'experiment_ready',
    'build_ready',
    'existing_solution_recommended',
    'nonsoftware_recommended',
    'human_led_recommended',
    'hybrid_recommended',
    'deferred',
    'rejected',
    'failed',
  ],
  experiment_ready: ['build_ready', 'deferred', 'archived', 'failed'],
  build_ready: ['building', 'deferred', 'failed'],
  building: ['verifying', 'failed'],
  verifying: ['ready_to_try', 'building', 'failed'],
  ready_to_try: ['iterating', 'release_candidate', 'archived'],
  iterating: ['building', 'deferred', 'failed'],
  release_candidate: ['released', 'iterating', 'archived'],
  released: ['maintained', 'archived'],
  maintained: ['iterating', 'archived'],
  archived: [],
  existing_solution_recommended: ['archived'],
  nonsoftware_recommended: ['archived'],
  human_led_recommended: ['archived'],
  hybrid_recommended: ['archived'],
  deferred: ['archived'],
  rejected: ['archived'],
  failed: ['archived'],
};
const stageEvidence: Partial<
  Record<ProductStage, readonly OutcomeEvidence['kind'][]>
> = {
  researched: ['source_support'],
  alternatives_compared: ['alternatives_review'],
  build_ready: ['specification'],
  experiment_ready: ['specification'],
  building: ['specification'],
  verifying: ['build'],
  ready_to_try: ['test', 'review', 'export'],
  release_candidate: ['test', 'review', 'export'],
  released: ['test', 'review', 'export', 'authorization'],
  iterating: ['feedback'],
};
/** Evidence is supplied by a trusted caller, never promoted from a model's ready claim. */
export function transitionProduct(
  rawCurrent: unknown,
  expectedVersion: number,
  rawTarget: unknown,
  rawEvidence: readonly unknown[],
) {
  const current = parse(ProductSchema, rawCurrent);
  const target = parse(ProductStageSchema, rawTarget);
  parse(counter.min(1), expectedVersion);
  requireRule(
    current.version === expectedVersion,
    'VERSION_CONFLICT',
    'Stale product version.',
  );
  requireRule(
    productEdges[current.stage].includes(target),
    'INVALID_TRANSITION',
    `${current.stage} cannot transition to ${target}.`,
  );
  const evidence = rawEvidence.map((e) => parse(OutcomeEvidenceSchema, e));
  for (const e of evidence)
    requireRule(
      e.subject_id === current.id &&
        e.subject_version === current.version &&
        e.spec_hash === current.spec_hash &&
        e.candidate_hash === current.candidate_hash &&
        e.fixture === current.fixture &&
        e.passed,
      'EVIDENCE_MISMATCH',
      'Evidence must pass and bind the exact product candidate.',
    );
  for (const kind of stageEvidence[target] ?? ['rationale'])
    requireRule(
      evidence.some(
        (e) =>
          e.kind === kind &&
          (!['test', 'review'].includes(kind) ||
            e.actor_id !== current.builder_id),
      ),
      'MISSING_EVIDENCE',
      `Missing ${kind} evidence (independent for test/review).`,
    );
  return parse(ProductSchema, {
    ...current,
    stage: target,
    version: current.version + 1,
  });
}
const executionEdges: Record<ExecutionState, readonly ExecutionState[]> = {
  queued: ['admitted', 'waiting_dependency', 'cancelled', 'failed'],
  admitted: ['running', 'cancelled', 'failed'],
  running: [
    'waiting_human',
    'paused_budget',
    'paused_operator',
    'reconciling',
    'succeeded',
    'failed',
    'cancelled',
  ],
  waiting_dependency: ['queued', 'cancelled', 'failed'],
  waiting_human: ['queued', 'cancelled', 'failed'],
  paused_budget: ['queued', 'cancelled', 'failed'],
  paused_operator: ['queued', 'cancelled', 'failed'],
  reconciling: ['succeeded', 'failed', 'cancelled'],
  succeeded: [],
  failed: [],
  cancelled: [],
};
export function transitionExecution(
  rawCurrent: unknown,
  expectedVersion: number,
  rawTarget: unknown,
  completion?: { task: unknown; result: unknown },
) {
  const current = parse(ExecutionSchema, rawCurrent);
  const target = parse(ExecutionStateSchema, rawTarget);
  parse(counter.min(1), expectedVersion);
  requireRule(
    current.version === expectedVersion,
    'VERSION_CONFLICT',
    'Stale execution version.',
  );
  requireRule(
    executionEdges[current.state].includes(target),
    'INVALID_TRANSITION',
    `${current.state} cannot transition to ${target}.`,
  );
  requireRule(
    !(target === 'waiting_human' && current.condition === 'autonomous'),
    'INVALID_TRANSITION',
    'Autonomous research cannot wait for task-specific human help.',
  );
  if (target === 'succeeded') {
    requireRule(
      completion !== undefined,
      'MISSING_EVIDENCE',
      'Completion requires a validated task result.',
    );
    const task = parse(TaskSchema, completion.task);
    const result = validateResult(task, completion.result);
    requireRule(
      task.id === current.task_id &&
        task.run_id === current.id &&
        task.experiment_condition === current.condition &&
        task.discovery_method === current.discovery_method &&
        ['succeeded', 'deferred'].includes(result.status),
      'RESULT_MISMATCH',
      'Result cannot complete this execution.',
    );
  }
  return parse(ExecutionSchema, {
    ...current,
    state: target,
    version: current.version + 1,
  });
}
