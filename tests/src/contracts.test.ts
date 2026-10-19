import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  MoneySchema,
  CostSchema,
  SourceSchema,
  ClaimSchema,
  AlternativeSchema,
  AssumptionSchema,
  DecisionRequestSchema,
  EntityLinkSchema,
  ExperimentAssignmentSchema,
  TaskSchema,
  RunConfigSchema,
  TaskResultSchema,
  parse,
  ContractError,
} from '@creator/contracts';
import {
  fixtureAssignment,
  fixtureId,
  canonicalHash,
  runFixture,
  serviceConfig,
} from '@creator/domain';

const { task } = fixtureAssignment();
const base = {
  schema_version: '1.0',
  id: fixtureId('record'),
  workspace_id: task.workspace_id,
  version: 1,
  created_at: '2026-10-17T00:00:00Z',
};
const ref = (kind: string) => ({
  ...task.specification,
  kind,
  id: fixtureId(kind),
});
const money = (amount: unknown) => ({ currency: 'USD', unit: 'nano', amount });

test('exact-money JSON preserves integers above Number.MAX_SAFE_INTEGER and rejects coercion', () => {
  const value = parse(MoneySchema, money('900719925474099300000'));
  assert.equal(
    JSON.parse(JSON.stringify(value)).amount,
    '900719925474099300000',
  );
  for (const amount of [
    1,
    0.1,
    '-1',
    '01',
    '1e6',
    '1.5',
    ' 1',
    null,
    '9'.repeat(31),
  ])
    assert.equal(MoneySchema.safeParse(money(amount)).success, false);
  assert.equal(
    parse(CostSchema, {
      status: 'unknown',
      reserved_maximum: null,
      reason: 'Provider outcome not known',
    }).status,
    'unknown',
  );
  assert.equal(
    CostSchema.safeParse({
      status: 'unknown',
      amount: money('0'),
      reason: 'unknown',
    }).success,
    false,
  );
});
test('versioned task/config schemas reject placeholders, missing caps, unknown fields and malformed paths', () => {
  assert.throws(
    () => parse(TaskSchema, { ...task, schema_version: '2.0' }),
    ContractError,
  );
  for (const value of [
    { ...task, allowed_paths: ['../secrets'] },
    { ...task, allowed_paths: ['C:/Users'] },
    { ...task, allowed_paths: ['/tmp'] },
    { ...task, limits: { ...task.limits, max_calls: null } },
    { ...task, role: '' },
    { ...task, auto_approve: true },
  ])
    assert.equal(TaskSchema.safeParse(value).success, false);
  for (const [name, schema] of [
    ['TASK_CONTRACT', TaskSchema],
    ['RUN_CONFIG', RunConfigSchema],
  ] as const) {
    const template: unknown = JSON.parse(
      readFileSync(`templates/${name}.example.json`, 'utf8'),
    );
    assert.equal(
      schema.safeParse(template).success,
      false,
      'Design templates are not executable assignments',
    );
  }
});
test('source/claim contracts require version/hash/locator and keep inference and contrary evidence', () => {
  const source = {
    ...base,
    url: 'https://example.org/source',
    title: 'Synthetic source',
    source_version: 'v1',
    content_hash: canonicalHash('source'),
    retrieved_at: base.created_at,
    published_at: null,
    retrieval_status: 'available',
    independent_origin: 'synthetic-origin',
    observation: 'Fixture observation',
    uncertainty: 'Synthetic, not real research',
  };
  assert.equal(SourceSchema.safeParse(source).success, true);
  assert.equal(
    SourceSchema.safeParse({ ...source, content_hash: null }).success,
    false,
  );
  const evidence = {
    source: ref('source'),
    locator: 'paragraph 2',
    passage: 'Synthetic supporting passage',
  };
  const claim = {
    ...base,
    statement: 'Synthetic inference',
    basis: 'inference',
    support: [evidence],
    contrary_evidence: [{ ...evidence, passage: 'Synthetic disagreement' }],
    uncertainty: 'Not validated',
  };
  assert.equal(parse(ClaimSchema, claim).contrary_evidence.length, 1);
  assert.equal(ClaimSchema.safeParse({ ...claim, support: [] }).success, false);
  assert.equal(
    ClaimSchema.safeParse({ ...claim, support: [{ ...evidence, locator: '' }] })
      .success,
    false,
  );
  assert.equal(
    ClaimSchema.safeParse({
      ...claim,
      support: [
        {
          ...evidence,
          source: { ...ref('source'), workspace_id: fixtureId('other') },
        },
      ],
    }).success,
    false,
  );
});
test('alternatives and assumptions preserve non-code outcomes, tradeoffs and disconfirmation', () => {
  for (const kind of [
    'build',
    'use_existing',
    'change_process',
    'human_led',
    'hybrid',
    'investigate',
    'defer',
    'decline',
    'failed',
  ]) {
    assert.equal(
      AlternativeSchema.safeParse({
        ...base,
        kind,
        title: 'Option',
        rationale: 'Synthetic rationale',
        evidence_refs: [],
        tradeoffs: ['Requires owner time'],
        uncertainty: 'Unknown benefit',
      }).success,
      true,
    );
  }
  const assumption = {
    ...base,
    statement: 'People want this',
    consequence_if_wrong: 'Wasted work',
    would_change_decision: 'User interviews disagree',
    status: 'unresolved',
    evidence_refs: [],
  };
  assert.equal(AssumptionSchema.safeParse(assumption).success, true);
  assert.equal(
    AssumptionSchema.safeParse({ ...assumption, would_change_decision: '' })
      .success,
    false,
  );
});
test('decision request cannot invent an answer, choose an absent option or answer after expiry', () => {
  const decision = {
    ...base,
    run_id: task.run_id,
    task_id: task.id,
    kind: 'judgment',
    reason_code: 'CONFLICTING_VALUES',
    question: 'Which priority matters?',
    assumption: 'Unknown preference',
    consequence_if_wrong: 'Wrong outcome',
    evidence_refs: [],
    options: [
      { id: 'a', label: 'Proceed', tradeoff: 'Uses time' },
      { id: 'defer', label: 'Defer', tradeoff: 'Delays work' },
    ],
    recommendation: 'defer',
    blocked_task_ids: [task.id],
    unblocked_work: [],
    binding: {
      action_type: 'select_option',
      target: ref('task'),
      content_hash: canonicalHash('content'),
      spec_hash: task.specification.sha256,
      amount_cap: null,
      expires_at: '2026-10-18T00:00:00Z',
    },
    status: 'pending',
    response: null,
  };
  assert.equal(DecisionRequestSchema.safeParse(decision).success, true);
  assert.equal(
    DecisionRequestSchema.safeParse({ ...decision, status: 'answered' })
      .success,
    false,
  );
  for (const response of [
    {
      actor_id: fixtureId('human'),
      option_id: 'missing',
      responded_at: base.created_at,
      rationale: 'Reason',
    },
    {
      actor_id: fixtureId('human'),
      option_id: 'a',
      responded_at: '2026-10-19T00:00:00Z',
      rationale: 'Reason',
    },
  ])
    assert.equal(
      DecisionRequestSchema.safeParse({
        ...decision,
        status: 'answered',
        response,
      }).success,
      false,
    );
});
test('typed many-to-many links reject cross-workspace and impossible relations', () => {
  const link = {
    ...base,
    relation: 'supports',
    from: ref('source'),
    to: ref('claim'),
    asserted_by: fixtureId('actor'),
    rationale: 'Synthetic support',
  };
  assert.equal(EntityLinkSchema.safeParse(link).success, true);
  assert.equal(
    EntityLinkSchema.safeParse({ ...link, to: ref('artifact') }).success,
    false,
  );
  assert.equal(
    EntityLinkSchema.safeParse({
      ...link,
      to: { ...ref('claim'), workspace_id: fixtureId('other') },
    }).success,
    false,
  );
});
test('experiment assignment keeps condition/method separate and excludes generative human-only setup', () => {
  const assignment = {
    ...base,
    study_id: fixtureId('study'),
    participant_code: 'SYNTHETIC-01',
    protocol: ref('protocol'),
    task_packet: ref('packet'),
    condition: 'human_only',
    discovery_method: 'human_defined',
    phase: 'pilot',
    allowed_tools: ['ordinary-editor'],
    generative_tools_allowed: false,
    prompt_hash: null,
    rubric_hash: canonicalHash('rubric'),
    assignment_seed: 'fixture-seed',
    previous_assignment_id: null,
  };
  assert.equal(ExperimentAssignmentSchema.safeParse(assignment).success, true);
  assert.equal(
    ExperimentAssignmentSchema.safeParse({
      ...assignment,
      generative_tools_allowed: true,
    }).success,
    false,
  );
  assert.equal(
    ExperimentAssignmentSchema.safeParse({
      ...assignment,
      prompt_hash: canonicalHash('hidden-helper'),
    }).success,
    false,
  );
  assert.equal(
    ExperimentAssignmentSchema.safeParse({
      ...assignment,
      discovery_method: 'structured',
    }).success,
    false,
  );
});
test('result success cannot replace missing evidence or unknown usage with fixture claims', () => {
  const { result } = runFixture({
    goal: 'Synthetic task',
    outcome: 'use_existing',
  });
  assert.equal(
    TaskResultSchema.safeParse({ ...result, evidence: [] }).success,
    false,
  );
  assert.equal(
    TaskResultSchema.safeParse({
      ...result,
      cost: { status: 'unknown', reserved_maximum: null, reason: 'Unknown' },
    }).success,
    false,
  );
  assert.equal(
    TaskResultSchema.safeParse({ ...result, fixture: false }).success,
    false,
  );
  assert.equal(
    TaskResultSchema.safeParse({ ...result, status: 'failed' }).success,
    false,
  );
});
test('service configuration rejects unknown modes/live/invalid ports and binds loopback locally', () => {
  assert.equal(serviceConfig({}).host, '127.0.0.1');
  // X06: hosted is an explicit mode; its own checks live in deploymentConfig.
  assert.equal(
    serviceConfig({
      CREATOR_DEPLOYMENT_MODE: 'hosted',
      CREATOR_LISTEN_HOST: '0.0.0.0',
    }).host,
    '0.0.0.0',
  );
  for (const env of [
    { CREATOR_DEPLOYMENT_MODE: 'cloud' },
    { CREATOR_HOST: '0.0.0.0' },
    { CREATOR_PROVIDER: 'live' },
    { CREATOR_DATA_MODE: 'live' },
    { CREATOR_LIVE_ENABLED: 'true' },
    { CREATOR_API_PORT: 'NaN' },
    { CREATOR_API_PORT: '65536' },
    { CREATOR_API_PORT: '5173' },
  ])
    assert.throws(
      () => serviceConfig(env),
      (e: unknown) => e instanceof ContractError && e.code === 'INVALID_CONFIG',
    );
});
