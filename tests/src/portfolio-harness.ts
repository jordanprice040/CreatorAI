import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Pool } from 'pg';
import type { PortfolioStore, CommandContext } from '@creator/db';
import type { PortfolioLane, StartWorkflowRequest } from '@creator/contracts';

export async function portfolioFixture(
  store: PortfolioStore,
  pool: Pool,
  ctx: CommandContext,
) {
  await store.ensureActor({
    id: ctx.actorId,
    kind: 'human',
    display_name: 'Portfolio fixture owner',
  });
  const ws = (
    await store.createWorkspace(ctx, {
      name: 'X09 synthetic portfolio',
      record_mode: 'fixture',
    })
  ).id;
  const root = await store.createEnvelope(ctx, ws, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Portfolio owner funds',
    cap_nano_usd: '1000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 16,
  });
  const period = async (name: string, cap: string) =>
    store.createEnvelope(ctx, ws, {
      parent_id: root.id,
      kind: 'period',
      run_id: null,
      name,
      cap_nano_usd: cap,
      starts_at: new Date(Date.now() - 86400000).toISOString(),
      ends_at: new Date(Date.now() + 86400000).toISOString(),
      max_in_flight: 16,
    });
  const maintenance = await period('Protected maintenance', '400000000');
  const exploration = await period('Exploration and improvement', '600000000');
  const policy = {
    expected_version: 0,
    mode: 'normal',
    root_envelope_id: root.id,
    maintenance_envelope_id: maintenance.id,
    reserve_floor_nano_usd: '100000000',
    max_active: 4,
    max_review_backlog: 2,
    max_starts_per_tick: 2,
    tick_interval_seconds: 15,
    rationale: 'Synthetic acceptance only.',
  };
  await store.configurePortfolio(ctx, ws, policy);
  const problem = await store.createEntity(ctx, ws, {
    kind: 'problem',
    title: 'Synthetic maintenance problem',
    body: {
      statement: 'Inspect versioned evidence before building.',
      affected_group: 'Synthetic reviewers',
      uncertainty: 'No real validation.',
    },
  });
  const source = await store.createEntity(ctx, ws, {
    kind: 'source',
    title: 'Synthetic source pin',
    body: {
      url: 'https://health.fixture.test/reports/clinic-access-2025',
      retrieval_status: 'inaccessible',
      content_hash: null,
      retrieved_at: new Date().toISOString(),
      published_at: null,
      independent_origin: 'synthetic fixture',
      observation: 'Manual fixture reference; no retrieval yet.',
      uncertainty: 'Synthetic.',
    },
  });
  const pricing = await store.createPricing(
    ctx,
    ws,
    JSON.parse(
      readFileSync(
        new URL('../../config/pricing/fixture-model-v1.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  async function run(lane: PortfolioLane, cap = '100000000') {
    const e = await store.createEntity(ctx, ws, {
      kind: 'run',
      title: lane + ' synthetic work',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    await store.registerRun(ctx, ws, {
      run: { id: e.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: [],
      initial_grants: [],
    });
    await store.assignPortfolioRun(ctx, ws, {
      run_id: e.id,
      lane,
      rationale: 'Test allocation.',
    });
    await store.createStandingGrant(ctx, ws, {
      run_id: e.id,
      action_types: ['model.generate', 'model.summarize'],
      target_kind: null,
      max_amount_nano_usd: '100000000',
      allow_irreversible: false,
      allow_external_effects: true,
      data_classes: ['synthetic'],
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      rationale: 'Covered fixture operations only.',
    });
    await store.createStandingGrant(ctx, ws, {
      run_id: e.id,
      action_types: ['source.fetch'],
      target_kind: null,
      max_amount_nano_usd: null,
      allow_irreversible: false,
      allow_external_effects: false,
      data_classes: ['public'],
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      rationale: 'Read the approved local synthetic source corpus only.',
    });
    const budget = await store.createEnvelope(ctx, ws, {
      parent_id: lane === 'maintenance' ? maintenance.id : exploration.id,
      kind: 'run',
      run_id: e.id,
      name: lane + ' run',
      cap_nano_usd: cap,
      starts_at: null,
      ends_at: null,
      max_in_flight: 4,
    });
    const request: StartWorkflowRequest = {
      role: 'r05_skeptic',
      subject: { id: problem.id, version: 1 },
      constraints: ['Synthetic data only.'],
      perspectives: ['evidence'],
      envelope_id: budget.id,
      pricing_snapshot_id: pricing.id,
      data_class: 'synthetic',
      limits: {
        max_children: 2,
        max_concurrency: 1,
        max_depth: 1,
        max_attempts: 1,
        max_repairs: 0,
        max_calls: 4,
        max_output_tokens: 400,
        call_timeout_ms: 5000,
        max_wall_seconds: 600,
      },
    };
    return { id: e.id, budget, request };
  }
  const due = () => new Date(Date.now() - 86400000).toISOString();
  const resetTick = () =>
    pool.query(
      "update portfolio_policies set next_tick_at=clock_timestamp()-interval '1 second' where workspace_id=$1",
      [ws],
    );
  return {
    ws,
    root,
    maintenance,
    exploration,
    policy,
    problem,
    source,
    pricing,
    run,
    due,
    resetTick,
    newId: randomUUID,
  };
}
