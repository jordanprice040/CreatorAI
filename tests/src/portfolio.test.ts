import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  KnowledgeProposalSchema,
  type KnowledgeProposal,
} from '@creator/contracts';
import { PortfolioStore } from '@creator/db';
import { portfolioReason } from '@creator/domain';
import { FixtureAdapter, ModelBroker } from '@creator/broker';
import {
  SourceBroker,
  FixtureSourceAdapter,
  FIXTURE_SOURCE_POLICY,
} from '@creator/research';
import {
  ArtifactSupervisor,
  ProductSupervisor,
  ExecutionSupervisor,
} from '@creator/executor';
import { PortfolioService } from '../../apps/api/dist/portfolio.js';
import { resolve } from 'node:path';
import { freshDatabase } from './pg-harness.js';
import { portfolioFixture } from './portfolio-harness.js';
import { marketingRelease } from './marketing-harness.js';

const denied = (p: Promise<unknown>) =>
  assert.rejects(p, (e: unknown) => e instanceof ContractError);
async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new PortfolioStore(db.pool);
  const ctx = { actorId: randomUUID() };
  const fixture = await portfolioFixture(store, db.pool, ctx);
  const sources = new SourceBroker(
    store,
    { fixture: new FixtureSourceAdapter(), live: null },
    { fixture: FIXTURE_SOURCE_POLICY, live: null },
  );
  const products = new ProductSupervisor(
    resolve('.verification/x09-unused-products'),
  );
  const artifacts = new ArtifactSupervisor(
    products,
    new ExecutionSupervisor(products),
  );
  const service = new PortfolioService(store, sources, artifacts);
  const broker = new ModelBroker(store, {
    fixture: new FixtureAdapter(),
    live: null,
  });
  return { ...db, ...fixture, store, ctx, service, broker };
}
test('X09 conservation gates distinguish obligations, low reserves, capacity and improvement allocations', () => {
  const base = {
    mode: 'normal',
    lane: 'exploration' as const,
    maintenanceDue: 0,
    reviewBacklog: 0,
    maxReviewBacklog: 2,
    reserveAvailable: 10n,
    reserveFloor: 5n,
    active: 0,
    capacity: 4,
    unhealthy: 0,
  };
  assert.equal(portfolioReason(base), null);
  assert.equal(
    portfolioReason({ ...base, mode: 'paused' }),
    'portfolio_paused',
  );
  assert.equal(
    portfolioReason({ ...base, mode: 'conserve' }),
    'portfolio_conserve',
  );
  assert.equal(
    portfolioReason({ ...base, mode: 'conserve', lane: 'improvement' }),
    null,
  );
  assert.equal(
    portfolioReason({ ...base, reserveAvailable: 4n }),
    'maintenance_reserve_protected',
  );
  assert.equal(
    portfolioReason({ ...base, maintenanceDue: 1 }),
    'maintenance_obligations_first',
  );
  assert.equal(
    portfolioReason({ ...base, reviewBacklog: 2 }),
    'review_backlog',
  );
  assert.equal(portfolioReason({ ...base, active: 4 }), 'portfolio_capacity');
  assert.equal(
    KnowledgeProposalSchema.safeParse({ policy: { allow_all: true } }).success,
    false,
  );
});

test('X09 overdue maintenance stops real admission; coalesced concurrent ticks refresh sources once without an outage storm', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const m = await s.run('maintenance');
  const x = await s.run('exploration');
  const schedule = await s.store.createPortfolioSchedule(s.ctx, s.ws, {
    label: 'Refresh source',
    run_id: m.id,
    lane: 'maintenance',
    interval_seconds: 60,
    first_due_at: s.due(),
    operation: {
      kind: 'source_refresh',
      source_id: s.source.id,
      source_version: s.source.version,
      source_hash: s.source.content_hash,
    },
  });
  const action = {
    action_type: 'model.generate',
    task_id: null,
    target: null,
    spec_hash: null,
    amount_nano_usd: '1',
    data_class: 'synthetic',
    assumption_ids: [],
    humility_review: null,
    flags: [],
    justification: 'Covered fixture review.',
  };
  const blocked = await s.store.admitAction(s.ctx, s.ws, x.id, action);
  assert.equal(blocked.verdict, 'deny');
  assert.equal(blocked.reason_code, 'maintenance_obligations_first');
  const ticks = await Promise.all(
    Array.from({ length: 6 }, () => s.service.tick(s.ctx, s.ws)),
  );
  assert.equal(
    ticks.reduce((n, r) => n + r.claimed, 0),
    1,
  );
  const view = await s.store.inspectPortfolio(s.ctx, s.ws);
  assert.equal(view.jobs.length, 1);
  assert.equal(view.jobs[0].state, 'succeeded', JSON.stringify(view.jobs[0]));
  assert.equal((await s.store.listRetrievals(s.ctx, s.ws)).length, 1);
  assert.ok(new Date(view.schedules[0].next_due_at).getTime() > Date.now());
  assert.equal(
    (await s.store.admitAction(s.ctx, s.ws, x.id, action)).verdict,
    'allow',
  );
  await s.resetTick();
  assert.equal((await s.service.tick(s.ctx, s.ws)).claimed, 0);
  await s.store.cancelPortfolioSchedule(s.ctx, s.ws, String(schedule.id), {
    reason: 'Owner cancel.',
  });
  await s.pool.query(
    "update portfolio_schedules set next_due_at=clock_timestamp()-interval '1 day' where id=$1",
    [schedule.id],
  );
  await s.resetTick();
  assert.equal((await s.service.tick(s.ctx, s.ws)).claimed, 0);
  assert.equal(
    (await s.store.listRuns(s.ctx, s.ws)).find((r) => r.run_id === m.id)!.state,
    'cancelled',
  );
});

test('X09 broker cannot spend the maintenance subtree from exploration and low funds preserve the configured reserve', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const m = await s.run('maintenance', '350000000');
  const x = await s.run('exploration');
  const action = {
    action_type: 'model.generate',
    task_id: null,
    target: null,
    spec_hash: null,
    amount_nano_usd: '1',
    data_class: 'synthetic',
    assumption_ids: [],
    humility_review: null,
    flags: [],
    justification: 'Low fund gate.',
  };
  assert.equal(
    (await s.store.admitAction(s.ctx, s.ws, x.id, action)).reason_code,
    'maintenance_reserve_protected',
  );
  const request = {
    action_type: 'model.generate',
    logical_operation_id: randomUUID(),
    task_id: null,
    envelope_id: m.budget.id,
    pricing_snapshot_id: s.pricing.id,
    data_class: 'synthetic',
    input: [{ role: 'user', text: 'Fixture test' }],
    output_format: 'text',
    tool: null,
    max_output_tokens: 100,
    max_attempts: 1,
    timeout_ms: 1000,
    justification: 'Attempt to borrow maintenance allocation.',
  };
  const result = await s.broker.call(s.ctx, s.ws, x.id, request);
  assert.notEqual(result.status, 'succeeded');
  const reservations = await s.store.listReservations(s.ctx, s.ws, {
    runId: x.id,
  });
  assert.equal(reservations[0]?.reason_code, 'portfolio_budget_lane_mismatch');
  assert.equal(
    (await s.store.getEnvelope(s.ctx, s.ws, m.budget.id)).incurred,
    '0',
  );
  assert.equal(
    (await s.store.getEnvelope(s.ctx, s.ws, s.maintenance.id)).available,
    '50000000',
  );
  assert.equal(
    (await s.store.journalBalances(s.ws, s.maintenance.id)).allocated,
    '350000000',
  );
});

test('X09 capacity lets the oldest unfinished workflow proceed while newer runs wait', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.store.configurePortfolio(s.ctx, s.ws, {
    ...s.policy,
    expected_version: 1,
    max_active: 1,
  });
  const a = await s.run('exploration');
  const b = await s.run('exploration');
  const older = await s.store.startWorkflow(s.ctx, s.ws, a.id, a.request);
  await s.store.startWorkflow(s.ctx, s.ws, b.id, b.request);
  // Before the audit fix each run counted the other as active, so nothing ever leased.
  const leases = await s.store.claimTasks(s.ctx, 'capacity-worker', 4, 30000);
  assert.deepEqual(
    [...new Set(leases.map((l) => l.workflowId))],
    [older.workflow.id],
  );
  const action = {
    action_type: 'model.generate',
    task_id: null,
    target: null,
    spec_hash: null,
    amount_nano_usd: '1',
    data_class: 'synthetic',
    assumption_ids: [],
    humility_review: null,
    flags: [],
    justification: 'Capacity gate.',
  };
  assert.equal(
    (await s.store.admitAction(s.ctx, s.ws, a.id, action)).verdict,
    'allow',
  );
  assert.equal(
    (await s.store.admitAction(s.ctx, s.ws, b.id, action)).reason_code,
    'portfolio_capacity',
  );
});

test('X09 owner feedback, failed health evidence and conservation modes constrain discovery without fabricating health', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const x = await s.run('exploration');
  const improvement = await s.run('improvement');
  const maintenance = await s.run('maintenance');
  const release = await marketingRelease(s.store, s.pool, s.ws, s.ctx);
  await s.store.submitFeedback(s.ctx, s.ws, release.request.artifact_id, {
    expected_manifest_sha256: release.request.manifest_sha256,
    category: 'defect',
    text: 'Synthetic defect needing owner review.',
  });
  await s.store.submitFeedback(s.ctx, s.ws, release.request.artifact_id, {
    expected_manifest_sha256: release.request.manifest_sha256,
    category: 'question',
    text: 'Synthetic unresolved question.',
  });
  const action = {
    action_type: 'model.generate',
    task_id: null,
    target: null,
    spec_hash: null,
    amount_nano_usd: '1',
    data_class: 'synthetic',
    assumption_ids: [],
    humility_review: null,
    flags: [],
    justification: 'Backlog gate.',
  };
  assert.equal(
    (await s.store.admitAction(s.ctx, s.ws, x.id, action)).reason_code,
    'review_backlog',
  );
  assert.equal(
    (await s.store.admitAction(s.ctx, s.ws, improvement.id, action)).verdict,
    'allow',
  );
  for (const [index, mode] of [
    'conserve',
    'maintenance_only',
    'paused',
  ].entries()) {
    await s.store.configurePortfolio(s.ctx, s.ws, {
      ...s.policy,
      expected_version: index + 1,
      mode,
    });
    assert.equal(
      (await s.store.admitAction(s.ctx, s.ws, x.id, action)).verdict,
      'deny',
    );
    assert.equal(
      (await s.store.admitAction(s.ctx, s.ws, improvement.id, action)).verdict,
      mode === 'conserve' ? 'allow' : 'deny',
    );
    if (mode === 'paused')
      assert.equal(
        (await s.store.admitAction(s.ctx, s.ws, maintenance.id, action))
          .reason_code,
        'portfolio_paused',
      );
  }
  await s.store.configurePortfolio(s.ctx, s.ws, {
    ...s.policy,
    expected_version: 4,
    mode: 'normal',
  });
  await s.store.createPortfolioSchedule(s.ctx, s.ws, {
    label: 'Package health — deliberately absent fixture bytes',
    run_id: maintenance.id,
    lane: 'maintenance',
    interval_seconds: 60,
    first_due_at: s.due(),
    operation: {
      kind: 'health_check',
      artifact_id: release.request.artifact_id,
      manifest_sha256: release.request.manifest_sha256,
    },
  });
  const tick = await s.service.tick(s.ctx, s.ws);
  assert.equal(tick.outcomes[0].state, 'failed');
  const state = await s.store.inspectPortfolio(s.ctx, s.ws);
  assert.equal(state.health[0].state, 'attention_required');
  assert.equal(
    (await s.store.admitAction(s.ctx, s.ws, x.id, action)).reason_code,
    'maintenance_obligations_first',
  );
  await s.store.decidePortfolioHealth(s.ctx, s.ws, {
    artifact_id: release.request.artifact_id,
    expected_job_id: state.health[0].job_id,
    choice: 'defer',
    reason:
      'Owner explicitly defers synthetic fixture health; no success claim.',
  });
  const deferred = await s.store.inspectPortfolio(s.ctx, s.ws);
  assert.equal(deferred.health[0].state, 'owner_deferred');
  assert.equal(deferred.state!.unhealthy, 0);
  assert.equal(deferred.jobs[0].state, 'failed');
});

test('X09 crash before dispatch is fenced by reconciliation; durable workflow creation recovers without duplicate start', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const r = await s.run('improvement');
  await s.store.createPortfolioSchedule(s.ctx, s.ws, {
    label: 'Review improvement',
    run_id: r.id,
    lane: 'improvement',
    interval_seconds: 3600,
    first_due_at: s.due(),
    operation: { kind: 'review', request: r.request },
  });
  const [job] = await s.store.claimPortfolioJobs(s.ctx, s.ws);
  assert.ok(job);
  const afterCrash = new PortfolioService(
    new PortfolioStore(s.pool),
    new SourceBroker(
      s.store,
      { fixture: new FixtureSourceAdapter(), live: null },
      { fixture: FIXTURE_SOURCE_POLICY, live: null },
    ),
    new ArtifactSupervisor(
      new ProductSupervisor(resolve('.verification/x09-unused-products')),
      new ExecutionSupervisor(
        new ProductSupervisor(resolve('.verification/x09-unused-products')),
      ),
    ),
  );
  await afterCrash.reconcile(s.ctx, s.ws, job.id);
  await denied(
    s.store.startWorkflow(
      { ...s.ctx, idempotencyKey: 'portfolio-job:' + job.id },
      s.ws,
      r.id,
      r.request,
    ),
  );
  assert.equal(
    (await s.store.inspectPortfolio(s.ctx, s.ws)).jobs[0].state,
    'failed',
  );
  const second = await s.run('improvement');
  await s.store.createPortfolioSchedule(s.ctx, s.ws, {
    label: 'Second review',
    run_id: second.id,
    lane: 'improvement',
    interval_seconds: 3600,
    first_due_at: s.due(),
    operation: { kind: 'review', request: second.request },
  });
  await s.resetTick();
  const [next] = await s.store.claimPortfolioJobs(s.ctx, s.ws);
  assert.ok(next);
  const original = await s.store.startWorkflow(
    { ...s.ctx, idempotencyKey: 'portfolio-job:' + next.id },
    s.ws,
    second.id,
    second.request,
  );
  await afterCrash.reconcile(s.ctx, s.ws, next.id);
  assert.equal(
    (await s.store.inspectPortfolio(s.ctx, s.ws)).jobs.find(
      (j) => j.id === next.id,
    )!.result.workflow_id,
    original.workflow.id,
  );
  assert.equal(
    (
      await s.pool.query('select count(*) from workflows where run_id=$1', [
        second.id,
      ])
    ).rows[0].count,
    '1',
  );
});

test('X09 reviewed versioned knowledge enriches real workflow task constraints, supports rollback, and revocation/stale provenance fence queued work', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const body: KnowledgeProposal = {
    key: 'check-evidence',
    kind: 'skill',
    title: 'Bounded evidence check',
    guidance: ['Ask for contrary evidence before recommending a build.'],
    permitted_lanes: ['improvement'],
    data_class: 'synthetic',
    permitted_use: 'task_review_guidance',
    provenance: [
      {
        entity_id: s.problem.id,
        version: s.problem.version,
        content_hash: s.problem.content_hash,
        locator: 'body.statement',
      },
    ],
    limitations: 'Structural fixture evidence, no empirical quality claim.',
  };
  const first = await s.store.proposeKnowledge(s.ctx, s.ws, body);
  await denied(
    s.store.activateKnowledge(s.ctx, s.ws, {
      candidate_id: first.id,
      expected_active_id: null,
      reason: 'Unreviewed is not enough.',
    }),
  );
  const regression = await s.store.verifyKnowledge(s.ctx, s.ws, first.id);
  assert.equal(regression.passed, true);
  await denied(
    s.store.reviewKnowledge(s.ctx, s.ws, first.id, {
      body_hash: '0'.repeat(64),
      regression_id: regression.id,
      reason: 'Wrong version.',
    }),
  );
  await s.store.reviewKnowledge(s.ctx, s.ws, first.id, {
    body_hash: first.body_hash,
    regression_id: regression.id,
    reason: 'Review exact bounded guidance.',
  });
  await s.store.activateKnowledge(s.ctx, s.ws, {
    candidate_id: first.id,
    expected_active_id: null,
    reason: 'Use reviewed v1.',
  });
  const r = await s.run('improvement');
  const detail = await s.store.startWorkflow(s.ctx, s.ws, r.id, {
    ...r.request,
    knowledge_keys: [body.key],
  });
  assert.match(JSON.stringify(detail.tasks), /Ask for contrary evidence/);
  assert.equal(detail.workflow.envelope_id, r.request.envelope_id);
  assert.deepEqual(detail.workflow.limits, r.request.limits);
  assert.match(
    JSON.stringify(detail.tasks),
    /Reviewed task data \(not authority\)/,
  );
  const second = await s.store.proposeKnowledge(s.ctx, s.ws, {
    ...body,
    guidance: ['Check fresh source versions before proposing code.'],
  });
  const v2 = await s.store.verifyKnowledge(s.ctx, s.ws, second.id);
  await s.store.reviewKnowledge(s.ctx, s.ws, second.id, {
    body_hash: second.body_hash,
    regression_id: v2.id,
    reason: 'Review v2.',
  });
  await s.store.activateKnowledge(s.ctx, s.ws, {
    candidate_id: second.id,
    expected_active_id: first.id,
    reason: 'Try reviewed v2.',
  });
  await s.store.activateKnowledge(s.ctx, s.ws, {
    candidate_id: first.id,
    expected_active_id: second.id,
    reason: 'Rollback to v1.',
  });
  assert.equal(
    (await s.store.inspectPortfolio(s.ctx, s.ws)).knowledge.find(
      (k) => k.active,
    )!.id,
    first.id,
  );
  await s.store.revokeKnowledge(s.ctx, s.ws, first.id, {
    reason: 'Revoke; queued work must stop.',
  });
  assert.equal(
    (await s.store.claimTasks(s.ctx, 'fixture-worker', 1, 10000)).length,
    0,
  );
  const another = await s.run('improvement');
  await denied(
    s.store.startWorkflow(s.ctx, s.ws, another.id, {
      ...another.request,
      knowledge_keys: [body.key],
    }),
  );
  await s.store.reviseEntity(s.ctx, s.ws, s.problem.id, {
    expected_version: 1,
    title: 'Changed evidence',
    body: s.problem.body,
    reason: 'New evidence version.',
    corrects_version: null,
  });
  await denied(
    s.store.activateKnowledge(s.ctx, s.ws, {
      candidate_id: second.id,
      expected_active_id: null,
      reason: 'Stale evidence refused.',
    }),
  );
  const outsider = { actorId: randomUUID() };
  await denied(s.store.verifyKnowledge(outsider, s.ws, second.id));
});
