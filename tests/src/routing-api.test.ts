import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const exec = promisify(execFile);

test('routing API and CLI: registry, policy, benchmark, routed and shadow calls, outcome', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const cliEnv = {
    ...process.env,
    CREATOR_API_URL: `http://127.0.0.1:${port}`,
    CREATOR_SESSION_FILE: join(
      await mkdtemp(join(tmpdir(), 'creator-cli-')),
      's.json',
    ),
  };
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, ['apps/cli/dist/main.js', ...args], {
          env: cliEnv,
          timeout: 30000,
        })
      ).stdout,
    );
  await cli('login', LOGIN_CODE);
  const ws = (
    await post('workspaces', { name: 'Routing API', record_mode: 'fixture' })
  ).body.id as string;
  const runEntity = (
    await post(`workspaces/${ws}/entities`, {
      kind: 'run',
      title: 'Routed run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    })
  ).body;
  const run = (
    await post(`workspaces/${ws}/runs`, {
      run: { id: runEntity.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    })
  ).body.run_id as string;
  await post(`workspaces/${ws}/grants`, {
    run_id: run,
    action_types: ['model.generate'],
    target_kind: null,
    max_amount_nano_usd: '100000000',
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    rationale: 'Routine fixture generation.',
  });
  const envelope = (
    await post(`workspaces/${ws}/budgets`, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Routing budget',
      cap_nano_usd: '100000000000',
      starts_at: null,
      ends_at: null,
      max_in_flight: 4,
    })
  ).body.id as string;

  const reg = await cli(
    'route-registry-add',
    ws,
    'config/routing/model-registry.fixture.json',
  );
  assert.equal(reg.body.reference_model.model_id, 'fixture-model-v1');
  const pol = await cli(
    'route-policy-set',
    ws,
    JSON.stringify({
      format: 'route-policy/1',
      mode: 'auto',
      fixed_model: null,
      quality_floor: null,
      allowed_models: null,
      rationale: 'Best held-out accepted rate.',
    }),
  );
  assert.equal(pol.version, 1);
  const bench = await cli(
    'route-benchmark-add',
    ws,
    'config/routing/benchmark.fixture.json',
  );
  const promo = await cli(
    'route-promotion-create',
    ws,
    JSON.stringify({
      registry_id: reg.id,
      task_class: 'summarization',
      candidate: { provider: 'fixture', model_id: 'fixture-economy-v1' },
      benchmark_id: bench.id,
      criteria: {
        format: 'promotion-criteria/1',
        min_held_out_cases: 8,
        quality_floor: { numerator: 7, denominator: 8 },
        max_regression: { numerator: 1, denominator: 20 },
        shadow_min_outcomes: 1,
        canary_fraction: { numerator: 1, denominator: 4 },
        canary_max_decisions: 5,
        canary_min_outcomes: 1,
        rollback_window: 3,
      },
      rationale: 'Cheaper fixture route.',
    }),
  );
  const shadow = await cli(
    'route-benchmark-run',
    ws,
    promo.id,
    run,
    envelope,
    '5000',
  );
  assert.equal(shadow.state, 'shadow');

  const op = randomUUID();
  const decision = await cli(
    'route-decide',
    ws,
    JSON.stringify({
      run_id: run,
      task_id: null,
      project_id: null,
      logical_operation_id: op,
      task_class: 'summarization',
      action_type: 'model.generate',
      tools: [],
      data_class: 'synthetic',
      estimated_input_tokens: 300,
      max_output_tokens: 100,
      max_latency_ms: null,
    }),
  );
  assert.equal(decision.role, 'reference_baseline');
  assert.equal(decision.policy_version, 1);
  assert.equal(decision.shadow.model.model_id, 'fixture-economy-v1');
  const brokerRequest = (opId: string, pricing: string) =>
    JSON.stringify({
      envelope_id: envelope,
      action_type: 'model.generate',
      task_id: null,
      logical_operation_id: opId,
      pricing_snapshot_id: pricing,
      data_class: 'synthetic',
      input: [{ role: 'user', text: 'Summarize as JSON.' }],
      max_output_tokens: 100,
      output_format: 'json',
      tool: null,
      max_attempts: 1,
      timeout_ms: 5000,
      justification: 'Routed CLI call.',
    });
  const served = await cli(
    'route-call',
    ws,
    decision.id,
    brokerRequest(op, decision.pricing_snapshot_id),
  );
  assert.equal(served.status, 'succeeded');
  assert.equal(served.served, true);
  const shadowCall = await cli(
    'route-call',
    ws,
    decision.id,
    brokerRequest(
      decision.shadow.logical_operation_id,
      decision.shadow.pricing_snapshot_id,
    ),
    '--shadow',
  );
  assert.equal(shadowCall.served, false);
  assert.equal(shadowCall.model.model_id, 'fixture-economy-v1');
  const recorded = await cli(
    'route-outcome',
    ws,
    decision.id,
    JSON.stringify({
      variant: 'shadow',
      signal: 'accepted',
      related_operation_ids: [],
      note: null,
    }),
  );
  assert.equal(recorded.outcome.accepted, true);
  assert.notEqual(recorded.outcome.cost.incurred_nano, '0');
  const advanced = await cli(
    'route-advance',
    ws,
    promo.id,
    String(recorded.promotion.version),
    'Shadow outcome meets the floor.',
  );
  assert.equal(advanced.state, 'canary');
  const listed = await cli('route-decisions', ws, run);
  assert.equal(listed.length, 1);
  // A refused route is recorded as a decision, not returned as an error.
  const refused = await post(`workspaces/${ws}/route-decisions`, {
    ...decision.request,
    logical_operation_id: randomUUID(),
    data_class: 'public',
  });
  assert.equal(refused.status, 201);
  assert.equal(refused.body.status, 'refused');
});
