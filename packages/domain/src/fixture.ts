import {
  parse,
  FixtureRequestSchema,
  RunConfigSchema,
  TaskSchema,
  TaskResultSchema,
  FixtureResponseSchema,
  ProductSchema,
  ExecutionSchema,
  type Outcome,
  type ProductStage,
  type Task,
  type RunConfig,
  type OutcomeEvidence,
  type Product,
} from '@creator/contracts';
import {
  canonicalHash,
  admitTask,
  validateResult,
  transitionExecution,
  transitionProduct,
} from './rules.js';

export function fixtureId(label: string): string {
  const h = canonicalHash(label);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
export function fixtureAssignment(
  goal = 'Compare a shared checklist with custom software',
): { config: RunConfig; task: Task } {
  const workspace = fixtureId('fixture-workspace');
  const limits = {
    max_calls: 1,
    max_input_tokens: 4096,
    max_output_tokens: 2048,
    max_wall_seconds: 30,
    max_cost_nano_usd: '0',
    max_concurrency: 1,
    max_children: 0,
    max_depth: 0,
    max_repairs: 0,
  };
  const config = parse(RunConfigSchema, {
    schema_version: '1.0',
    id: fixtureId(`run:${goal}`),
    workspace_id: workspace,
    version: 1,
    deployment_mode: 'local',
    data_mode: 'fixture',
    autonomy_mode: 'human_in_loop',
    experiment_condition: 'human_in_loop',
    discovery_method: 'structured',
    provider: 'fixture',
    live_external_effects_enabled: false,
    grant_ids: [],
    policy_version: 'fixture-policy/1.0',
    model_policy_ref: 'fixture-only/1.0',
    verified_api_model_id: null,
    pricing_ref: null,
    limits,
    deadline: '2099-01-01T00:00:00Z',
    external_tracing_enabled: false,
  });
  const task = parse(TaskSchema, {
    schema_version: '1.0',
    id: fixtureId(`task:${goal}`),
    run_id: config.id,
    project_id: fixtureId('fixture-project'),
    workspace_id: workspace,
    version: 1,
    specification: {
      kind: 'specification',
      id: fixtureId('fixture-spec'),
      workspace_id: workspace,
      version: 1,
      sha256: canonicalHash(
        'Synthetic T01 recommendation fixture; no research performed',
      ),
    },
    config_hash: canonicalHash(config),
    prompt_hash: canonicalHash('deterministic-fixture-v1'),
    role: 'fixture-demonstrator',
    experiment_condition: config.experiment_condition,
    discovery_method: config.discovery_method,
    goal,
    non_goals: [
      'No real research, model calls, generated code or external effects',
    ],
    input_refs: [],
    acceptance_criteria: [
      'Return a visibly labeled deterministic fixture disposition',
    ],
    output_schema_ref: 'task-result/1.0',
    dependencies: [],
    allowed_tools: [],
    allowed_data_classifications: ['synthetic'],
    allowed_paths: [],
    output_destinations: [],
    grant_ids: [],
    policy_version: config.policy_version,
    model_policy_ref: config.model_policy_ref,
    budget_envelope_id: fixtureId('fixture-zero-budget'),
    limits,
    deadline: config.deadline,
    depth: 0,
    parent_task_id: null,
    logical_operation_id: fixtureId(`operation:${goal}`),
    cancellation_id: fixtureId(`cancel:${goal}`),
    lease_ref: fixtureId('fixture-lease'),
  });
  return { config, task };
}
const summaries: Record<Outcome, string> = {
  build:
    'Fixture: consider a bounded software specification; no software has been generated.',
  use_existing:
    'Fixture: evaluate an existing shared checklist before commissioning software.',
  change_process:
    'Fixture: assign an owner and a recurring review of a shared checklist.',
  human_led:
    'Fixture: ask the affected people to resolve responsibilities and priorities.',
  hybrid: 'Fixture: combine a human review with an existing checklist tool.',
  investigate: 'Fixture: gather observations before selecting a response.',
  defer: 'Fixture: defer because stakeholder evidence is missing.',
  decline:
    'Fixture: decline the proposed work because its benefit is unsupported.',
  failed: 'Fixture: simulated failure; preserve the failure and its reason.',
};
export function fakeProvider(
  rawTask: unknown,
  rawConfig: unknown,
  outcome: Outcome,
  now = Date.now(),
) {
  const task = admitTask(rawTask, rawConfig, now);
  const candidate = canonicalHash({
    task,
    outcome,
    provider: 'deterministic-fixture-v1',
  });
  const evidence: OutcomeEvidence = {
    id: fixtureId(`rationale:${candidate}`),
    kind: 'rationale',
    subject_id: task.id,
    subject_version: task.version,
    spec_hash: task.specification.sha256,
    candidate_hash: candidate,
    actor_id: fixtureId('fixture-provider'),
    fixture: true,
    passed: true,
    locator: 'fixture://deterministic-disposition-v1',
  };
  const result = parse(TaskResultSchema, {
    schema_version: '1.0',
    task_id: task.id,
    task_version: task.version,
    run_id: task.run_id,
    attempt_id: fixtureId(`attempt:${candidate}`),
    config_hash: task.config_hash,
    spec_hash: task.specification.sha256,
    candidate_hash: candidate,
    fixture: true,
    status:
      outcome === 'failed'
        ? 'failed'
        : outcome === 'defer'
          ? 'deferred'
          : 'succeeded',
    outcome,
    summary: summaries[outcome],
    artifacts: [],
    claim_refs: [],
    evidence: [evidence],
    assumptions: [],
    alternatives: [],
    decision_request: null,
    cost: {
      status: 'known',
      amount: { currency: 'USD', unit: 'nano', amount: '0' },
      basis: 'fixture',
      pricing_ref: null,
    },
    checks: [],
    blockers: ['defer', 'failed'].includes(outcome) ? [summaries[outcome]] : [],
    next_permitted_action:
      'Inspect this synthetic result. No external action is authorized.',
  });
  return validateResult(task, result);
}
export function runFixture(rawRequest: unknown) {
  const request = parse(FixtureRequestSchema, rawRequest);
  const { config, task } = fixtureAssignment(request.goal);
  const result = fakeProvider(task, config, request.outcome);
  let execution = parse(ExecutionSchema, {
    schema_version: '1.0',
    id: task.run_id,
    task_id: task.id,
    version: 1,
    state: 'queued',
    condition: task.experiment_condition,
    discovery_method: task.discovery_method,
  });
  execution = transitionExecution(execution, execution.version, 'admitted');
  execution = transitionExecution(execution, execution.version, 'running');
  execution = transitionExecution(
    execution,
    execution.version,
    result.status === 'failed' ? 'failed' : 'succeeded',
    { task, result },
  );
  let product = parse(ProductSchema, {
    schema_version: '1.0',
    id: task.project_id,
    workspace_id: task.workspace_id,
    version: 1,
    stage: 'captured',
    spec_hash: result.spec_hash,
    candidate_hash: result.candidate_hash,
    builder_id: fixtureId('fixture-provider'),
    fixture: true,
  });
  function advance(
    current: Product,
    stage: ProductStage,
    kind: OutcomeEvidence['kind'],
  ): Product {
    return transitionProduct(current, current.version, stage, [
      {
        ...result.evidence[0],
        id: fixtureId(`${stage}:${result.candidate_hash}`),
        subject_id: current.id,
        subject_version: current.version,
        kind,
      },
    ]);
  }
  product = advance(product, 'researched', 'source_support');
  product = advance(product, 'alternatives_compared', 'alternatives_review');
  const terminal: Partial<Record<Outcome, ProductStage>> = {
    use_existing: 'existing_solution_recommended',
    change_process: 'nonsoftware_recommended',
    human_led: 'human_led_recommended',
    hybrid: 'hybrid_recommended',
    defer: 'deferred',
    decline: 'rejected',
    failed: 'failed',
  };
  const stage = terminal[request.outcome];
  if (stage) product = advance(product, stage, 'rationale');
  return parse(FixtureResponseSchema, {
    fixture: true,
    task,
    result,
    product,
    execution,
  });
}
