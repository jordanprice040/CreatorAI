import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractError,
  type ErrorCode,
  type Task,
  type Outcome,
  type OutcomeEvidence,
} from '@creator/contracts';
import {
  fixtureAssignment,
  fixtureId,
  canonicalHash,
  runFixture,
  fakeProvider,
  admitTask,
  validateDelegation,
  validateResult,
  transitionProduct,
  transitionExecution,
} from '@creator/domain';

const rejects = (code: ErrorCode, fn: () => unknown) =>
  assert.throws(
    fn,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
test('deterministic fixture exercises all outcomes without real model or tool effects', () => {
  for (const outcome of [
    'build',
    'use_existing',
    'change_process',
    'human_led',
    'hybrid',
    'investigate',
    'defer',
    'decline',
    'failed',
  ] satisfies Outcome[]) {
    const request = { goal: 'Synthetic brief', outcome };
    const first = runFixture(request);
    assert.deepEqual(first, runFixture(request));
    assert.equal(first.result.fixture, true);
    assert.equal(
      first.execution.state,
      outcome === 'failed' ? 'failed' : 'succeeded',
    );
    assert.equal(first.result.artifacts.length, 0);
  }
});
test('missing/invalid paid limits fail before dispatch and even complete live config remains denied', () => {
  const { config, task } = fixtureAssignment();
  rejects('INVALID_CONTRACT', () =>
    admitTask(task, {
      ...config,
      limits: { ...config.limits, max_calls: null },
    }),
  );
  const live = {
    ...config,
    data_mode: 'live',
    provider: 'live',
    live_external_effects_enabled: true,
    verified_api_model_id: 'synthetic-unverified-model',
    pricing_ref: { ...task.specification, kind: 'config' },
    grant_ids: [fixtureId('synthetic-grant')],
    limits: { ...config.limits, max_cost_nano_usd: '100' },
  };
  rejects('LIVE_DISABLED', () =>
    admitTask({ ...task, config_hash: canonicalHash(live) }, live),
  );
  rejects('EXPIRED', () =>
    admitTask(task, config, Date.parse('2100-01-01T00:00:00Z')),
  );
  rejects('RESULT_MISMATCH', () =>
    admitTask({ ...task, config_hash: '0'.repeat(64) }, config),
  );
  rejects('SCOPE_EXCEEDED', () =>
    admitTask({ ...task, allowed_tools: ['fetch'] }, config),
  );
});
test('human-only configuration cannot reach even the fake provider', () => {
  const { config, task } = fixtureAssignment();
  const human = {
    ...config,
    autonomy_mode: 'human_only',
    experiment_condition: 'human_only',
    discovery_method: 'human_defined',
  };
  rejects('HUMAN_ONLY_DENIED', () =>
    fakeProvider(
      {
        ...task,
        config_hash: canonicalHash(human),
        experiment_condition: 'human_only',
        discovery_method: 'human_defined',
      },
      human,
      'use_existing',
    ),
  );
});
function delegation() {
  const { task } = fixtureAssignment();
  const parent: Task = {
    ...task,
    allowed_paths: ['work/app'],
    output_destinations: ['out/app'],
    allowed_tools: ['read'],
    limits: {
      ...task.limits,
      max_calls: 4,
      max_input_tokens: 1000,
      max_output_tokens: 1000,
      max_cost_nano_usd: '9007199254740995',
      max_concurrency: 2,
      max_children: 2,
      max_depth: 2,
    },
  };
  const child: Task = {
    ...parent,
    id: fixtureId('child'),
    parent_task_id: parent.id,
    depth: 1,
    logical_operation_id: fixtureId('child-operation'),
    allowed_paths: ['work/app/src'],
    limits: {
      ...parent.limits,
      max_calls: 2,
      max_input_tokens: 500,
      max_output_tokens: 500,
      max_concurrency: 1,
      max_children: 0,
      max_cost_nano_usd: '4503599627370497',
    },
  };
  const sibling: Task = {
    ...child,
    id: fixtureId('sibling'),
    logical_operation_id: fixtureId('sibling-operation'),
  };
  return { parent, child, sibling };
}
test('delegation contains paths, grants, classifications, research condition and depth', () => {
  const { parent, child } = delegation();
  assert.equal(validateDelegation(parent, [child]).length, 1);
  for (const bad of [
    { ...child, allowed_paths: ['work/application'] },
    { ...child, grant_ids: [fixtureId('new-grant')] },
    { ...child, allowed_tools: ['shell'] },
    { ...child, allowed_data_classifications: ['private_approved'] },
    { ...child, experiment_condition: 'autonomous' },
    { ...child, depth: 2 },
    { ...child, non_goals: [] },
  ])
    rejects('SCOPE_EXCEEDED', () => validateDelegation(parent, [bad]));
  rejects('INVALID_CONTRACT', () =>
    validateDelegation(parent, [
      { ...child, allowed_paths: ['work/app/../private'] },
    ]),
  );
  rejects('LIMIT_EXCEEDED', () =>
    validateDelegation(parent, [
      { ...child, limits: { ...child.limits, max_output_tokens: 1001 } },
    ]),
  );
});
test('sibling allocations conserve exact money and calls rather than checking children separately', () => {
  const { parent, child, sibling } = delegation();
  assert.equal(validateDelegation(parent, [child, sibling]).length, 2);
  rejects('LIMIT_EXCEEDED', () =>
    validateDelegation(parent, [
      child,
      {
        ...sibling,
        limits: { ...sibling.limits, max_cost_nano_usd: '4503599627370499' },
      },
    ]),
  );
  rejects('LIMIT_EXCEEDED', () =>
    validateDelegation(parent, [
      child,
      { ...sibling, limits: { ...sibling.limits, max_calls: 3 } },
    ]),
  );
  rejects('SCOPE_EXCEEDED', () => validateDelegation(parent, [child, child]));
});
test('results bind exact task/config/spec/version and check evidence', () => {
  const { task, result } = runFixture({
    goal: 'Synthetic task',
    outcome: 'use_existing',
  });
  rejects('RESULT_MISMATCH', () =>
    validateResult({ ...task, version: 2 }, result),
  );
  rejects('RESULT_MISMATCH', () =>
    validateResult(task, { ...result, config_hash: '0'.repeat(64) }),
  );
  rejects('EVIDENCE_MISMATCH', () =>
    validateResult(task, { ...result, candidate_hash: '0'.repeat(64) }),
  );
  rejects('MISSING_EVIDENCE', () =>
    validateResult(task, {
      ...result,
      checks: [
        {
          name: 'Invented check',
          passed: true,
          evidence_id: fixtureId('missing'),
        },
      ],
    }),
  );
  rejects('MISSING_EVIDENCE', () =>
    validateResult(task, {
      ...result,
      evidence: result.evidence.map((e) => ({ ...e, passed: false })),
    }),
  );
});
test('product transitions reject skipped stages, stale versions and stale candidate evidence', () => {
  const { product } = runFixture({ goal: 'Synthetic task', outcome: 'build' });
  const evidence: OutcomeEvidence = {
    id: fixtureId('evidence'),
    kind: 'specification',
    subject_id: product.id,
    subject_version: product.version,
    spec_hash: product.spec_hash,
    candidate_hash: product.candidate_hash,
    actor_id: fixtureId('reviewer'),
    fixture: true,
    passed: true,
    locator: 'fixture://evidence',
  };
  rejects('INVALID_TRANSITION', () =>
    transitionProduct(product, product.version, 'released', [evidence]),
  );
  rejects('VERSION_CONFLICT', () =>
    transitionProduct(product, product.version - 1, 'build_ready', [evidence]),
  );
  rejects('MISSING_EVIDENCE', () =>
    transitionProduct(product, product.version, 'build_ready', []),
  );
  rejects('EVIDENCE_MISMATCH', () =>
    transitionProduct(product, product.version, 'build_ready', [
      { ...evidence, candidate_hash: '0'.repeat(64) },
    ]),
  );
  const next = transitionProduct(product, product.version, 'build_ready', [
    evidence,
  ]);
  assert.equal(next.version, product.version + 1);
  assert.equal(
    product.stage,
    'alternatives_compared',
    'Pure transition must not mutate prior version',
  );
});
test('ready-to-try needs candidate-bound independent test/review and export evidence', () => {
  const { product } = runFixture({ goal: 'Synthetic task', outcome: 'build' });
  const current = { ...product, stage: 'verifying' };
  const evidence = ['test', 'review', 'export'].map((kind) => ({
    id: fixtureId(kind),
    kind,
    subject_id: current.id,
    subject_version: current.version,
    spec_hash: current.spec_hash,
    candidate_hash: current.candidate_hash,
    actor_id: fixtureId('independent-reviewer'),
    fixture: true,
    passed: true,
    locator: 'fixture://synthetic-check',
  }));
  assert.equal(
    transitionProduct(current, current.version, 'ready_to_try', evidence).stage,
    'ready_to_try',
  );
  rejects('MISSING_EVIDENCE', () =>
    transitionProduct(
      current,
      current.version,
      'ready_to_try',
      evidence.map((e) => ({ ...e, actor_id: current.builder_id })),
    ),
  );
  rejects('EVIDENCE_MISMATCH', () =>
    transitionProduct(
      { ...current, spec_hash: '0'.repeat(64) },
      current.version,
      'ready_to_try',
      evidence,
    ),
  );
});
test('execution cannot resurrect cancellation or silently change research dimensions', () => {
  const demo = runFixture({ goal: 'Synthetic task', outcome: 'use_existing' });
  const current = { ...demo.execution, state: 'running' };
  rejects('MISSING_EVIDENCE', () =>
    transitionExecution(current, current.version, 'succeeded'),
  );
  const cancelled = transitionExecution(current, current.version, 'cancelled');
  rejects('INVALID_TRANSITION', () =>
    transitionExecution(cancelled, cancelled.version, 'running'),
  );
  rejects('VERSION_CONFLICT', () =>
    transitionExecution(current, current.version - 1, 'cancelled'),
  );
  rejects('INVALID_TRANSITION', () =>
    transitionExecution(
      { ...current, condition: 'autonomous' },
      current.version,
      'waiting_human',
    ),
  );
  rejects('RESULT_MISMATCH', () =>
    transitionExecution(
      { ...current, condition: 'human_only' },
      current.version,
      'succeeded',
      demo,
    ),
  );
});
