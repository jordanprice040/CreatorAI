import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ContractError,
  type BrokerCallRequest,
  type ErrorCode,
  type RouteDecision,
  type RouteRequest,
} from '@creator/contracts';
import { RoutingStore, type CommandContext } from '@creator/db';
import {
  ModelBroker,
  fixtureRouteAdapters,
  runPromotionBenchmark,
} from '@creator/broker';
import { canonicalHash, registryRequestFromConfig } from '@creator/domain';
import { freshDatabase, holdAudit, lockWaiters } from './pg-harness.js';

const root = new URL('../../', import.meta.url);
const read = (p: string) =>
  JSON.parse(readFileSync(new URL(p, root), 'utf8')) as unknown;
const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const agent: CommandContext = { actorId: randomUUID() };
const REF = { provider: 'fixture' as const, model_id: 'fixture-model-v1' };
const ECON = { provider: 'fixture' as const, model_id: 'fixture-economy-v1' };
const CHEAP = { provider: 'fixture' as const, model_id: 'fixture-bargain-v1' };
const criteria = {
  format: 'promotion-criteria/1',
  min_held_out_cases: 8,
  quality_floor: { numerator: 7, denominator: 8 },
  max_regression: { numerator: 1, denominator: 20 },
  shadow_min_outcomes: 2,
  canary_fraction: { numerator: 1, denominator: 4 },
  canary_max_decisions: 10,
  canary_min_outcomes: 2,
  rollback_window: 2,
};

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new RoutingStore(db.pool);
  for (const [a, kind] of [
    [owner, 'human'],
    [agent, 'agent'],
  ] as const)
    await store.ensureActor({ id: a.actorId, kind, display_name: kind });
  const broker = new ModelBroker(
    store,
    {
      fixture: fixtureRouteAdapters()[0]!,
      live: null,
      routes: fixtureRouteAdapters(),
    },
    { decisions: store },
  );
  async function workspace(mode: 'fixture' | 'real') {
    const ws = await store.createWorkspace(owner, {
      name: `Routing ${mode}`,
      record_mode: mode,
    });
    await store.addMember(owner, ws.id, agent.actorId, 'editor');
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: 'Routing run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    const control = await store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    });
    await store.createStandingGrant(owner, ws.id, {
      run_id: control.run_id,
      action_types: ['model.generate'],
      target_kind: null,
      max_amount_nano_usd: '100000000',
      allow_irreversible: false,
      allow_external_effects: false,
      data_classes: ['synthetic'],
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      rationale: 'Routine fixture model calls for routing checks.',
    });
    const envelope = await store.createEnvelope(owner, ws.id, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Routing budget',
      cap_nano_usd: '100000000000',
      starts_at: null,
      ends_at: null,
      max_in_flight: 32,
    });
    return { ws: ws.id, run: control.run_id, envelope: envelope.id };
  }
  return { store, broker, workspace };
}

test('X01 routing gate: versions recorded, bad routes fail, unreliable route refused, promotion and rollback', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, broker } = s;
  const { ws, run, envelope } = await s.workspace('fixture');
  const reg = await store.registerModelRegistry(
    owner,
    ws,
    registryRequestFromConfig(
      read('config/routing/model-registry.fixture.json'),
      read,
    ),
  );
  await rejects(
    'ACCESS_DENIED',
    store.setRoutePolicy(agent, ws, {
      scope: { kind: 'workspace' },
      body: {
        format: 'route-policy/1',
        mode: 'auto',
        fixed_model: null,
        quality_floor: null,
        allowed_models: null,
        rationale: 'Agents cannot set their own routing policy.',
      },
    }),
  );
  const policy = await store.setRoutePolicy(owner, ws, {
    scope: { kind: 'workspace' },
    body: {
      format: 'route-policy/1',
      mode: 'economy',
      fixed_model: null,
      quality_floor: { numerator: 7, denominator: 8 },
      allowed_models: null,
      rationale: 'Cheapest route that keeps the held-out quality floor.',
    },
  });
  const bench = await store.registerBenchmark(
    owner,
    ws,
    read('config/routing/benchmark.fixture.json'),
  );
  const request = (over: Partial<RouteRequest> = {}): RouteRequest => ({
    run_id: run,
    task_id: null,
    project_id: null,
    logical_operation_id: randomUUID(),
    task_class: 'summarization',
    action_type: 'model.generate',
    tools: [],
    data_class: 'synthetic',
    estimated_input_tokens: 400,
    max_output_tokens: 200,
    max_latency_ms: null,
    ...over,
  });
  const call = (
    d: RouteDecision,
    variant: 'primary' | 'shadow' = 'primary',
    over: Partial<BrokerCallRequest> = {},
  ) =>
    broker.callRouted(agent, ws, d.id, variant, {
      envelope_id: envelope,
      action_type: 'model.generate',
      task_id: null,
      logical_operation_id:
        variant === 'primary'
          ? d.request.logical_operation_id
          : d.shadow!.logical_operation_id,
      pricing_snapshot_id:
        variant === 'primary'
          ? d.pricing_snapshot_id
          : d.shadow!.pricing_snapshot_id,
      data_class: 'synthetic',
      input: [{ role: 'user', text: 'Summarize the synthetic note as JSON.' }],
      max_output_tokens: 200,
      output_format: 'json',
      tool: null,
      max_attempts: 1,
      timeout_ms: 5000,
      justification: 'Routed fixture call.',
      ...over,
    });
  const outcome = (
    d: RouteDecision,
    signal: 'accepted' | 'schema_invalid',
    variant: 'primary' | 'shadow' = 'primary',
  ) =>
    store.recordRouteOutcome(agent, ws, d.id, {
      variant,
      signal,
      related_operation_ids: [],
      note: null,
    });

  // 1. Before any promotion only the reference baseline is qualified; the decision names
  // exactly the policy, registry and pricing versions it used.
  const first = await store.decideRoute(agent, ws, request());
  assert.equal(first.status, 'routed');
  assert.equal(first.role, 'reference_baseline');
  assert.deepEqual(first.model, REF);
  assert.equal(first.policy_id, policy.id);
  assert.equal(first.policy_version, 1);
  assert.equal(first.policy_hash, policy.policy_hash);
  assert.equal(first.registry_hash, reg.registry_hash);
  assert.equal(first.registry_version, 'fixture-registry/2026-10-19.1');
  assert.equal(
    first.pricing_hash,
    canonicalHash(read('config/pricing/fixture-model-v1.json')),
  );
  assert.equal(
    first.pricing_snapshot_id,
    reg.pricing_snapshot_ids['fixture/fixture-model-v1'],
  );
  const served = await call(first);
  assert.equal(served.status, 'succeeded');
  assert.equal(served.attempts[0]!.model_id, REF.model_id);
  assert.equal(served.served, true);
  // The same operation is never routed twice for a different request.
  await rejects(
    'IDEMPOTENCY_CONFLICT',
    store.decideRoute(agent, ws, {
      ...first.request,
      max_output_tokens: 100,
    }),
  );
  assert.equal(
    (await store.decideRoute(agent, ws, first.request)).id,
    first.id,
  );
  // A call that differs from what the decision admitted is refused before dispatch.
  await rejects(
    'SCOPE_EXCEEDED',
    call(first, 'primary', { max_output_tokens: 201 }),
  );

  // 2. Privacy-incompatible and unsupported routes fail and are recorded as refusals.
  const pub = await store.decideRoute(
    agent,
    ws,
    request({ data_class: 'public' }),
  );
  assert.equal(pub.status, 'refused');
  assert.equal(pub.reason_code, 'no_qualified_route');
  assert.ok(
    pub.candidates.every((c) => c.reasons.includes('privacy_incompatible')),
  );
  await rejects('INVALID_TRANSITION', call(pub));
  const slow = await store.decideRoute(
    agent,
    ws,
    request({ max_latency_ms: 5 }),
  );
  assert.equal(slow.status, 'refused');

  // 3. A cheap but unreliable route fails the held-out gate and is never routed.
  const cheap = await store.createPromotion(owner, ws, {
    registry_id: reg.id,
    task_class: 'summarization',
    candidate: CHEAP,
    benchmark_id: bench.id,
    criteria,
    rationale: 'Cheapest fixture model.',
  });
  const runReq = { run_id: run, envelope_id: envelope, timeout_ms: 5000 };
  const rejected = await runPromotionBenchmark(
    store,
    broker,
    owner,
    ws,
    cheap.id,
    runReq,
  );
  assert.equal(rejected.state, 'rejected');
  const cheapEval = rejected.evaluations[0]!;
  assert.ok(cheapEval.reasons.includes('below_quality_floor'));
  assert.equal(cheapEval.candidate.cases, 8, 'held-out cases only');
  assert.equal(cheapEval.savings_claim, 'not_claimed_fixture');
  assert.ok(
    BigInt(cheapEval.candidate.cost.incurred_nano) <
      BigInt(cheapEval.baseline!.cost.incurred_nano),
    'it was cheaper, and still refused',
  );
  await rejects(
    'INVALID_TRANSITION',
    runPromotionBenchmark(store, broker, owner, ws, cheap.id, runReq),
  );
  await rejects(
    'INVALID_TRANSITION',
    store.advancePromotion(owner, ws, cheap.id, {
      expected_version: rejected.version,
      reason: 'Try anyway.',
    }),
  );
  const after = await store.decideRoute(agent, ws, request());
  assert.deepEqual(after.model, REF);
  assert.ok(
    after.candidates
      .find((c) => c.model_id === CHEAP.model_id)!
      .reasons.includes('not_promoted'),
  );

  // 4. A reliable cheaper route: held-out gate → shadow → canary → promoted.
  const econ = await store.createPromotion(owner, ws, {
    registry_id: reg.id,
    task_class: 'summarization',
    candidate: ECON,
    benchmark_id: bench.id,
    criteria,
    rationale: 'Cheaper fixture model.',
  });
  await rejects(
    'DUPLICATE',
    store.createPromotion(owner, ws, {
      registry_id: reg.id,
      task_class: 'summarization',
      candidate: ECON,
      benchmark_id: bench.id,
      criteria,
      rationale: 'Second active promotion.',
    }),
  );
  let p = await runPromotionBenchmark(
    store,
    broker,
    owner,
    ws,
    econ.id,
    runReq,
  );
  assert.equal(p.state, 'shadow');
  assert.equal(p.evaluations[0]!.savings_claim, 'not_claimed_fixture');
  const results = await store.benchmarkResults(owner, ws, econ.id);
  assert.equal(results.length, 20, 'ten cases for each arm');
  await rejects(
    'INVALID_TRANSITION',
    store.advancePromotion(owner, ws, econ.id, {
      expected_version: p.version,
      reason: 'No shadow outcomes yet.',
    }),
  );
  for (let i = 0; i < 2; i += 1) {
    const d = await store.decideRoute(agent, ws, request());
    assert.deepEqual(d.model, REF, 'the shadow is never served');
    assert.deepEqual(d.shadow?.model, ECON);
    await call(d);
    const shadow = await call(d, 'shadow');
    assert.equal(shadow.served, false);
    assert.equal(shadow.attempts[0]!.model_id, ECON.model_id);
    await outcome(d, 'accepted');
    await outcome(d, 'accepted', 'shadow');
  }
  p = await store.advancePromotion(owner, ws, econ.id, {
    expected_version: p.version,
    reason: 'Shadow outcomes meet the floor.',
  });
  assert.equal(p.state, 'canary');
  let canaries = 0;
  let others = 0;
  while (canaries < 2) {
    const d = await store.decideRoute(agent, ws, request());
    assert.equal(d.shadow, null);
    if (d.role !== 'canary') {
      others += 1;
      continue;
    }
    canaries += 1;
    assert.deepEqual(d.model, ECON);
    assert.equal(d.promotion_id, econ.id);
    assert.equal(d.criteria_hash, canonicalHash(criteria));
    const r = await call(d);
    assert.equal(r.attempts[0]!.model_id, ECON.model_id);
    await outcome(d, 'accepted');
    assert.ok(others < 60, 'the canary slice is reachable');
  }
  p = await store.getPromotion(owner, ws, econ.id);
  assert.equal(p.canary_decisions, 2);
  p = await store.advancePromotion(owner, ws, econ.id, {
    expected_version: p.version,
    reason: 'Canary outcomes meet the floor.',
  });
  assert.equal(p.state, 'promoted');
  const promoted = await store.decideRoute(agent, ws, request());
  assert.equal(promoted.role, 'economy');
  assert.deepEqual(promoted.model, ECON);
  assert.equal(
    promoted.pricing_hash,
    canonicalHash(read('config/pricing/fixture-economy-v1.json')),
  );

  // 5. Objective escalation only after a recorded failure, once, to the baseline.
  await call(promoted);
  await rejects(
    'INVALID_TRANSITION',
    store.escalateRoute(agent, ws, promoted.id, {
      logical_operation_id: randomUUID(),
    }),
  );
  await outcome(promoted, 'schema_invalid');
  const up = await store.escalateRoute(agent, ws, promoted.id, {
    logical_operation_id: randomUUID(),
  });
  assert.equal(up.role, 'escalation');
  assert.deepEqual(up.model, REF);
  assert.equal(up.escalated_from, promoted.id);
  await rejects(
    'DUPLICATE',
    store.escalateRoute(agent, ws, promoted.id, {
      logical_operation_id: randomUUID(),
    }),
  );
  await call(up);
  await outcome(up, 'schema_invalid');
  const exhausted = await store.escalateRoute(agent, ws, up.id, {
    logical_operation_id: randomUUID(),
  });
  assert.equal(exhausted.status, 'refused');
  assert.equal(exhausted.reason_code, 'escalation_exhausted');

  // 6. Post-promotion outcomes below the floor roll the route back automatically.
  const bad = await store.decideRoute(agent, ws, request());
  assert.deepEqual(bad.model, ECON);
  await call(bad);
  const rolled = await outcome(bad, 'schema_invalid');
  assert.equal(rolled.promotion?.state, 'rolled_back');
  const back = await store.decideRoute(agent, ws, request());
  assert.equal(back.role, 'reference_baseline');
  assert.deepEqual(back.model, REF);

  // 7. Manual rollback from shadow removes the shadow from later decisions.
  const again = await store.createPromotion(owner, ws, {
    registry_id: reg.id,
    task_class: 'summarization',
    candidate: ECON,
    benchmark_id: bench.id,
    criteria,
    rationale: 'Re-evaluation after rollback.',
  });
  const shadowed = await runPromotionBenchmark(
    store,
    broker,
    owner,
    ws,
    again.id,
    runReq,
  );
  assert.equal(shadowed.state, 'shadow');
  assert.deepEqual(
    (await store.decideRoute(agent, ws, request())).shadow?.model,
    ECON,
  );
  await rejects(
    'ACCESS_DENIED',
    store.rollbackPromotion(agent, ws, again.id, {
      expected_version: shadowed.version,
      reason: 'Agents cannot roll back.',
    }),
  );
  const manual = await store.rollbackPromotion(owner, ws, again.id, {
    expected_version: shadowed.version,
    reason: 'Owner stopped the evaluation.',
  });
  assert.equal(manual.state, 'rolled_back');
  assert.equal((await store.decideRoute(agent, ws, request())).shadow, null);

  // 8. A per-project fixed policy overrides the workspace policy and never substitutes.
  const project = randomUUID();
  await store.setRoutePolicy(owner, ws, {
    scope: { kind: 'project', project_id: project },
    body: {
      format: 'route-policy/1',
      mode: 'fixed',
      fixed_model: CHEAP,
      quality_floor: null,
      allowed_models: null,
      rationale: 'Project pinned to the cheapest model.',
    },
  });
  const pinned = await store.decideRoute(
    agent,
    ws,
    request({ project_id: project }),
  );
  assert.equal(pinned.status, 'refused');
  assert.equal(pinned.reason_code, 'route_unqualified');
  assert.equal(pinned.policy_version, 1);
  assert.equal(
    (await store.decideRoute(agent, ws, request())).status,
    'routed',
  );

  // Decisions are immutable records.
  await assert.rejects(
    (
      store as unknown as { pool: { query: (q: string) => Promise<unknown> } }
    ).pool.query(`update route_decisions set model_id = 'fixture-bargain-v1'`),
  );
});

test('a real workspace refuses fixture models and unverified reference models', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store } = s;
  const { ws, run } = await s.workspace('real');
  await rejects(
    'SCOPE_EXCEEDED',
    store.registerModelRegistry(
      owner,
      ws,
      registryRequestFromConfig(
        read('config/routing/model-registry.fixture.json'),
        read,
      ),
    ),
  );
  await store.registerModelRegistry(
    owner,
    ws,
    registryRequestFromConfig(read('config/routing/model-registry.json'), read),
  );
  await store.setRoutePolicy(owner, ws, {
    scope: { kind: 'workspace' },
    body: {
      format: 'route-policy/1',
      mode: 'fixed',
      fixed_model: { provider: 'openai', model_id: 'gpt-6-astra' },
      quality_floor: null,
      allowed_models: null,
      rationale: 'Owner reference model.',
    },
  });
  const d = await store.decideRoute(agent, ws, {
    run_id: run,
    task_id: null,
    project_id: null,
    logical_operation_id: randomUUID(),
    task_class: 'summarization',
    action_type: 'model.generate',
    tools: [],
    data_class: 'synthetic',
    estimated_input_tokens: 400,
    max_output_tokens: 200,
    max_latency_ms: null,
  });
  assert.equal(d.status, 'refused');
  assert.equal(d.reason_code, 'route_unsupported');
  assert.deepEqual(d.candidates[0]!.reasons, ['model_unverified']);
  await rejects(
    'SCOPE_EXCEEDED',
    store.registerBenchmark(
      owner,
      ws,
      read('config/routing/benchmark.fixture.json'),
    ),
  );
});

test('ADR-0098 re-review 3 L-2: two route outcomes of one promotion never deadlock', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, broker } = s;
  const { ws, run, envelope } = await s.workspace('fixture');
  const reg = await store.registerModelRegistry(
    owner,
    ws,
    registryRequestFromConfig(
      read('config/routing/model-registry.fixture.json'),
      read,
    ),
  );
  await store.setRoutePolicy(owner, ws, {
    scope: { kind: 'workspace' },
    body: {
      format: 'route-policy/1',
      mode: 'economy',
      fixed_model: null,
      quality_floor: { numerator: 7, denominator: 8 },
      allowed_models: null,
      rationale: 'Cheapest route that keeps the held-out quality floor.',
    },
  });
  const bench = await store.registerBenchmark(
    owner,
    ws,
    read('config/routing/benchmark.fixture.json'),
  );
  const econ = await store.createPromotion(owner, ws, {
    registry_id: reg.id,
    task_class: 'summarization',
    candidate: ECON,
    benchmark_id: bench.id,
    criteria,
    rationale: 'Cheaper fixture model.',
  });
  const p = await runPromotionBenchmark(store, broker, owner, ws, econ.id, {
    run_id: run,
    envelope_id: envelope,
    timeout_ms: 5000,
  });
  assert.equal(p.state, 'shadow');
  const decide = async () => {
    const d = await store.decideRoute(agent, ws, {
      run_id: run,
      task_id: null,
      project_id: null,
      logical_operation_id: randomUUID(),
      task_class: 'summarization',
      action_type: 'model.generate',
      tools: [],
      data_class: 'synthetic',
      estimated_input_tokens: 400,
      max_output_tokens: 200,
      max_latency_ms: null,
    });
    assert.ok(d.shadow);
    await broker.callRouted(agent, ws, d.id, 'shadow', {
      envelope_id: envelope,
      action_type: 'model.generate',
      task_id: null,
      logical_operation_id: d.shadow.logical_operation_id,
      pricing_snapshot_id: d.shadow.pricing_snapshot_id,
      data_class: 'synthetic',
      input: [{ role: 'user', text: 'Summarize the synthetic note as JSON.' }],
      max_output_tokens: 200,
      output_format: 'json',
      tool: null,
      max_attempts: 1,
      timeout_ms: 5000,
      justification: 'Routed fixture call.',
    });
    return d;
  };
  const d1 = await decide();
  const d2 = await decide();
  const pool = (store as unknown as { pool: import('pg').Pool }).pool;
  const release = await holdAudit(pool);
  // Two shadow outcomes of one promotion: each insert key-share-locks the promotion row.
  const outcome = (d: RouteDecision) =>
    store.recordRouteOutcome(agent, ws, d.id, {
      variant: 'shadow',
      signal: 'accepted',
      related_operation_ids: [],
      note: null,
    });
  const one = outcome(d1);
  await lockWaiters(pool, 1);
  const two = outcome(d2);
  await lockWaiters(pool, 2);
  await release();
  const [o, r] = await Promise.allSettled([one, two]);
  for (const x of [o, r])
    assert.ok(
      !(x.status === 'rejected' && /deadlock/i.test(String(x.reason))),
      String(x.status === 'rejected' && x.reason),
    );
});
