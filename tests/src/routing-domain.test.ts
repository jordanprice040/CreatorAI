import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  BenchmarkManifestSchema,
  ContractError,
  PromotionCriteriaSchema,
  RoutePolicyBodySchema,
  parse,
  type PricingSnapshotBody,
  type Promotion,
  type RoutePolicyBody,
  type RouteRequest,
} from '@creator/contracts';
import {
  canonicalHash,
  checkOutput,
  chooseRoute,
  evaluateBenchmark,
  evaluateStage,
  inCanarySlice,
  modelKey,
  registryRequestFromConfig,
  summarizeArm,
} from '@creator/domain';

const root = new URL('../../', import.meta.url);
const read = (p: string) =>
  JSON.parse(readFileSync(new URL(p, root), 'utf8')) as unknown;
const load = (p: string) => registryRequestFromConfig(read(p), read);
const fixture = load('config/routing/model-registry.fixture.json');
const real = load('config/routing/model-registry.json');
const pricingMap = (r: typeof fixture) =>
  new Map<string, PricingSnapshotBody>(
    r.pricing.map((p) => [`${p.provider}/${p.model_id}`, p]),
  );
const REF = { provider: 'fixture' as const, model_id: 'fixture-model-v1' };
const ECON = { provider: 'fixture' as const, model_id: 'fixture-economy-v1' };
const CHEAP = { provider: 'fixture' as const, model_id: 'fixture-bargain-v1' };
const criteria = parse(PromotionCriteriaSchema, {
  format: 'promotion-criteria/1',
  min_held_out_cases: 8,
  quality_floor: { numerator: 7, denominator: 8 },
  max_regression: { numerator: 1, denominator: 20 },
  shadow_min_outcomes: 2,
  canary_fraction: { numerator: 1, denominator: 4 },
  canary_max_decisions: 10,
  canary_min_outcomes: 2,
  rollback_window: 2,
});
const request = (over: Partial<RouteRequest> = {}): RouteRequest => ({
  run_id: randomUUID(),
  task_id: null,
  project_id: null,
  logical_operation_id: randomUUID(),
  task_class: 'summarization',
  action_type: 'model.generate',
  tools: [],
  data_class: 'synthetic',
  estimated_input_tokens: 500,
  max_output_tokens: 200,
  max_latency_ms: null,
  ...over,
});
const policy = (over: Partial<RoutePolicyBody>): RoutePolicyBody =>
  parse(RoutePolicyBodySchema, {
    format: 'route-policy/1',
    mode: 'economy',
    fixed_model: null,
    quality_floor: { numerator: 7, denominator: 8 },
    allowed_models: null,
    rationale: 'Test policy.',
    ...over,
  });
const cost = (n: number) => ({
  incurred_nano: String(n),
  unknown_nano: '0',
  operations: 1,
});
/** A promotion carrying a benchmark evaluation with the given held-out results. */
function promotion(
  candidate: typeof ECON,
  state: Promotion['state'],
  candPass: number,
  candCost: number,
): Promotion {
  const rows = (pass: number, c: number) =>
    Array.from({ length: 8 }, (_, i) => ({
      accepted: i < pass,
      cost: cost(c),
      split: 'held_out' as const,
    }));
  const evaluation = evaluateBenchmark(
    criteria,
    candidate,
    REF,
    rows(candPass, candCost),
    rows(8, 1000),
    true,
  );
  return {
    id: randomUUID(),
    workspace_id: randomUUID(),
    fixture: true,
    version: 2,
    registry_id: randomUUID(),
    task_class: 'summarization',
    candidate,
    baseline: REF,
    benchmark_id: randomUUID(),
    manifest_hash: 'a'.repeat(64),
    criteria,
    criteria_hash: canonicalHash(criteria),
    state,
    canary_decisions: 0,
    evaluations: [evaluation],
    reason: '',
    rationale: 'Test.',
    created_by: randomUUID(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
const inputs = (
  pol: RoutePolicyBody,
  req: RouteRequest,
  promotions: Promotion[] = [],
  reg = fixture,
  isFixture = true,
) => ({
  fixture: isFixture,
  registry: reg.registry,
  pricing: pricingMap(reg),
  policy: pol,
  request: req,
  promotions,
});

test('registry config binds each model to the hash of its pricing file', () => {
  for (const r of [fixture, real])
    for (const m of r.registry.models) {
      const p = r.pricing.find((x) => x.model_id === m.model_id)!;
      assert.equal(m.pricing_hash, canonicalHash(p));
    }
  assert.equal(modelKey(real.registry.reference_model), 'openai/gpt-6-astra');
  assert.equal(real.registry.models[0]!.availability.state, 'documented');
  assert.throws(
    () =>
      registryRequestFromConfig(
        {
          ...(read('config/routing/model-registry.fixture.json') as object),
          fixture: false,
        },
        read,
      ),
    (e: unknown) => e instanceof ContractError && e.code === 'INVALID_CONFIG',
  );
});

test('unsupported, unverified and privacy-incompatible routes fail', () => {
  const unverified = chooseRoute(
    inputs(policy({}), request(), [], real, false),
    () => true,
  );
  assert.equal(unverified.status, 'refused');
  assert.ok(unverified.candidates[0]!.reasons.includes('model_unverified'));

  const cases: [Partial<RouteRequest>, string][] = [
    [{ data_class: 'public' }, 'privacy_incompatible'],
    [{ task_class: 'code_build' }, 'task_class_unsupported'],
    [{ estimated_input_tokens: 199_900 }, 'context_exceeded'],
    [{ max_latency_ms: 10 }, 'latency_exceeded'],
  ];
  for (const [over, reason] of cases) {
    const c = chooseRoute(inputs(policy({}), request(over)), () => true);
    const ref = c.candidates.find((x) => x.model_id === REF.model_id)!;
    if (reason === 'task_class_unsupported') {
      assert.equal(c.status, 'routed', 'the reference covers code_build');
      assert.ok(
        c.candidates
          .filter((x) => x.model_id !== REF.model_id)
          .every((x) => x.reasons.includes('task_class_unsupported')),
      );
    } else {
      assert.equal(c.status, 'refused', reason);
      assert.ok(ref.reasons.includes(reason as never), reason);
    }
  }
  const search = chooseRoute(
    inputs(
      policy({}),
      request({ action_type: 'tool.search_public', tools: ['search_public'] }),
    ),
    () => true,
  );
  assert.deepEqual(
    (search as { model: unknown }).model,
    REF,
    'only the reference prices the search tool',
  );
  assert.ok(
    search.candidates
      .filter((c) => c.model_id !== REF.model_id)
      .every((c) => c.reasons.includes('tool_unsupported')),
  );
});

test('a fixed route is never substituted and needs qualification', () => {
  const fixed = chooseRoute(
    inputs(
      policy({ mode: 'fixed', fixed_model: CHEAP, quality_floor: null }),
      request(),
    ),
    () => true,
  );
  assert.equal(fixed.status, 'refused');
  assert.equal(
    (fixed as { reason_code: string }).reason_code,
    'route_unqualified',
  );
  const ok = chooseRoute(
    inputs(
      policy({ mode: 'fixed', fixed_model: REF, quality_floor: null }),
      request(),
    ),
    () => true,
  );
  assert.equal(ok.status, 'routed');
  assert.deepEqual((ok as { model: unknown }).model, REF);
});

test('economy and auto choose only among qualified routes', () => {
  const none = chooseRoute(inputs(policy({}), request()), () => true);
  assert.equal(none.status, 'routed');
  assert.equal((none as { role: string }).role, 'reference_baseline');

  const promoted = promotion(ECON, 'promoted', 8, 200);
  const econ = chooseRoute(
    inputs(policy({}), request(), [promoted]),
    () => true,
  );
  assert.deepEqual((econ as { model: unknown }).model, ECON);
  assert.equal((econ as { role: string }).role, 'economy');

  // Auto values accepted rate first: equal rates, so the cheaper promoted route wins.
  const auto = chooseRoute(
    inputs(policy({ mode: 'auto', quality_floor: null }), request(), [
      promoted,
    ]),
    () => true,
  );
  assert.deepEqual((auto as { model: unknown }).model, ECON);

  // A promoted route below the floor is not chosen by economy.
  const weak = promotion(ECON, 'promoted', 6, 200);
  const floor = chooseRoute(inputs(policy({}), request(), [weak]), () => true);
  assert.deepEqual((floor as { model: unknown }).model, REF);
  assert.ok(
    floor.candidates
      .find((c) => c.model_id === ECON.model_id)!
      .reasons.includes('below_quality_floor'),
  );
  // An allow-list excludes even a promoted route.
  const allow = chooseRoute(
    inputs(policy({ allowed_models: [REF] }), request(), [promoted]),
    () => true,
  );
  assert.deepEqual((allow as { model: unknown }).model, REF);
});

test('the held-out gate refuses a cheap but unreliable route', () => {
  const rows = (pass: number, c: number, split: 'held_out' | 'development') =>
    Array.from({ length: 8 }, (_, i) => ({
      accepted: i < pass,
      cost: cost(c),
      split,
    }));
  const cheap = evaluateBenchmark(
    criteria,
    CHEAP,
    REF,
    [...rows(4, 50, 'held_out'), ...rows(8, 50, 'development')],
    rows(8, 1000, 'held_out'),
    true,
  );
  assert.equal(cheap.passed, false);
  assert.deepEqual(cheap.reasons, [
    'below_quality_floor',
    'regression_vs_baseline_exceeds_limit',
  ]);
  assert.equal(cheap.candidate.cases, 8, 'development rows never count');
  assert.equal(cheap.savings_claim, 'not_claimed_fixture');

  const good = evaluateBenchmark(
    criteria,
    ECON,
    REF,
    rows(8, 200, 'held_out'),
    rows(8, 1000, 'held_out'),
    false,
  );
  assert.equal(good.passed, true);
  assert.equal(good.savings_claim, 'measured');
  const unknown = evaluateBenchmark(
    criteria,
    ECON,
    REF,
    rows(8, 200, 'held_out').map((r, i) =>
      i ? r : { ...r, cost: { ...r.cost, unknown_nano: '7' } },
    ),
    rows(8, 1000, 'held_out'),
    false,
  );
  assert.equal(unknown.savings_claim, 'not_claimed_unknown_cost');
  const few = evaluateBenchmark(
    criteria,
    ECON,
    REF,
    rows(8, 200, 'held_out').slice(0, 5),
    rows(8, 1000, 'held_out').slice(0, 5),
    true,
  );
  assert.ok(few.reasons.includes('held_out_cases_below_minimum'));
});

test('cost per accepted result counts failed attempts and rounds up', () => {
  const s = summarizeArm(ECON, [
    { accepted: true, cost: cost(100) },
    { accepted: false, cost: cost(100) },
    { accepted: true, cost: cost(101) },
  ]);
  assert.equal(s.cost_per_accepted_nano, '151');
  assert.equal(
    summarizeArm(ECON, [{ accepted: false, cost: cost(5) }])
      .cost_per_accepted_nano,
    null,
  );
  const post = evaluateStage(
    'post_promotion',
    criteria,
    ECON,
    [
      { accepted: true, cost: cost(1) },
      { accepted: false, cost: cost(1) },
      { accepted: false, cost: cost(1) },
    ],
    true,
  );
  assert.deepEqual(post.reasons, ['below_quality_floor'], 'last window only');
});

test('canary slice is deterministic and capped by fraction', () => {
  const p = randomUUID();
  const ops = Array.from({ length: 2000 }, () => randomUUID());
  const hits = ops.filter((o) =>
    inCanarySlice(p, o, { numerator: 1, denominator: 4 }),
  ).length;
  assert.ok(hits > 400 && hits < 600, `about a quarter, got ${hits}`);
  for (const o of ops.slice(0, 20))
    assert.equal(
      inCanarySlice(p, o, { numerator: 1, denominator: 4 }),
      inCanarySlice(p, o.toUpperCase(), { numerator: 1, denominator: 4 }),
    );
  const canary = promotion(ECON, 'canary', 8, 200);
  const op = ops.find((o) =>
    inCanarySlice(canary.id, o, criteria.canary_fraction),
  )!;
  const chosen = chooseRoute(
    inputs(policy({}), request({ logical_operation_id: op }), [canary]),
    () => true,
  );
  assert.equal((chosen as { role: string }).role, 'canary');
  const capped = chooseRoute(
    inputs(policy({}), request({ logical_operation_id: op }), [canary]),
    () => false,
  );
  assert.equal((capped as { role: string }).role, 'reference_baseline');
  const fixed = chooseRoute(
    inputs(
      policy({ mode: 'fixed', fixed_model: REF, quality_floor: null }),
      request({ logical_operation_id: op }),
      [canary],
    ),
    () => true,
  );
  assert.equal(
    (fixed as { role: string }).role,
    'fixed',
    'fixed is never canaried',
  );
});

test('objective checks decide acceptance, never model confidence', () => {
  const ok = { succeeded: true, reason_code: 'succeeded' };
  assert.equal(
    checkOutput(
      { kind: 'json_keys', keys: ['summary'] },
      { text: '', json: { summary: 'x' } },
      ok,
    ),
    'accepted',
  );
  assert.equal(
    checkOutput(
      { kind: 'json_keys', keys: ['summary'] },
      { text: '{"confidence":1}', json: { confidence: 1 } },
      ok,
    ),
    'acceptance_check_failed',
  );
  assert.equal(
    checkOutput(
      { kind: 'exact_label', label: 'B' },
      { text: ' B\n', json: null },
      ok,
    ),
    'accepted',
  );
  assert.equal(
    checkOutput({ kind: 'json_keys', keys: ['a'] }, null, {
      succeeded: false,
      reason_code: 'malformed_output',
    }),
    'schema_invalid',
  );
});

test('a reviewer benchmark answer binds the exact candidate and is scored like T12 approval', () => {
  const ok = { succeeded: true, reason_code: 'succeeded' };
  const bound = {
    candidate: 'a'.repeat(40),
    spec_hash: 'b'.repeat(64),
    task_hash: 'c'.repeat(64),
  };
  const check = (verdict: 'approve' | 'changes_requested', json: unknown) =>
    checkOutput(
      { kind: 'review_verdict', verdict, ...bound },
      { text: '', json },
      ok,
    );
  assert.equal(
    check('approve', { ...bound, verdict: 'approve', findings: [] }),
    'accepted',
  );
  // An approval that still lists findings is not a T12 approval.
  assert.equal(
    check('approve', { ...bound, verdict: 'approve', findings: ['x'] }),
    'review_rejected',
  );
  assert.equal(
    check('approve', {
      ...bound,
      verdict: 'changes_requested',
      findings: ['x'],
    }),
    'review_rejected',
  );
  assert.equal(
    check('approve', {
      ...bound,
      candidate: 'd'.repeat(40),
      verdict: 'approve',
      findings: [],
    }),
    'acceptance_check_failed',
    'a review of another candidate never counts',
  );
  assert.equal(
    check('changes_requested', {
      ...bound,
      verdict: 'changes_requested',
      findings: [],
    }),
    'acceptance_check_failed',
  );
  assert.equal(
    check('changes_requested', {
      ...bound,
      verdict: 'changes_requested',
      findings: ['off by one'],
    }),
    'accepted',
  );
  assert.equal(check('approve', { verdict: 'approve' }), 'schema_invalid');
  assert.throws(
    () =>
      checkOutput(
        { kind: 'patch_cases', file_scope: ['src'], cases: [] } as never,
        { text: '{}', json: {} },
        ok,
      ),
    /patch scorer/,
  );
});

test('build-role checks only appear under their own task class with JSON output', () => {
  const base = read('config/routing/benchmark.fixture.json') as {
    cases: Record<string, unknown>[];
  };
  const review = {
    kind: 'review_verdict',
    verdict: 'approve',
    candidate: 'a'.repeat(40),
    spec_hash: 'b'.repeat(64),
    task_hash: 'c'.repeat(64),
  };
  const with_ = (task_class: string, check: unknown, output_format = 'json') =>
    BenchmarkManifestSchema.safeParse({
      ...base,
      task_class,
      cases: base.cases.map((c) => ({ ...c, check, output_format })),
    }).success;
  assert.equal(with_('independent_review', review), true);
  assert.equal(with_('summarization', review), false);
  assert.equal(with_('independent_review', review, 'text'), false);
  assert.equal(
    with_('independent_review', { kind: 'json_keys', keys: ['a'] }),
    false,
  );
});
