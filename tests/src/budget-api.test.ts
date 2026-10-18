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

test('budget API and CLI: pricing, envelopes, a metered fixture call, a refusal and the error view', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const get = async (path: string) => {
    const r = await fetch(`${base}/${path}`, { headers: auth.read });
    return { status: r.status, body: (await r.json()) as any };
  };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const status = await (await fetch(`${base}/broker/status`)).json();
  assert.equal(status.live.openai, 'not_configured');

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
          timeout: 15000,
        })
      ).stdout,
    );
  await cli('login', LOGIN_CODE);

  const ws = (
    await post('workspaces', { name: 'Budget API', record_mode: 'fixture' })
  ).body;
  const pricing = await cli(
    'pricing-add',
    ws.id,
    'config/pricing/fixture-model-v1.json',
  );
  assert.equal(pricing.body.basis, 'fixture');
  // Documented live pricing cannot be recorded in a fixture workspace.
  const live = await post(`workspaces/${ws.id}/pricing`, {
    ...pricing.body,
    provider: 'openai',
    basis: 'documented',
    model_id: 'gpt-6-astra',
    source_url: 'https://developers.openai.com/api/docs/models/gpt-6-astra',
  });
  assert.equal(live.status, 403);
  const runEntity = (
    await post(`workspaces/${ws.id}/entities`, {
      kind: 'run',
      title: 'Metered run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    })
  ).body;
  const run = (
    await post(`workspaces/${ws.id}/runs`, {
      run: { id: runEntity.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    })
  ).body;
  await post(`workspaces/${ws.id}/grants`, {
    run_id: run.run_id,
    action_types: ['model.generate'],
    target_kind: null,
    max_amount_nano_usd: '100000000',
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    rationale: 'Routine fixture generation.',
  });
  const envelope = await cli(
    'budget-create',
    ws.id,
    JSON.stringify({
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Owner test budget',
      cap_nano_usd: '20000000',
      starts_at: null,
      ends_at: null,
      max_in_flight: 3,
    }),
  );
  assert.equal(envelope.available, '20000000');
  const request = (over: Record<string, unknown> = {}) => ({
    envelope_id: envelope.id,
    action_type: 'model.generate',
    task_id: null,
    logical_operation_id: randomUUID(),
    pricing_snapshot_id: pricing.id,
    data_class: 'synthetic',
    input: [{ role: 'user', text: 'Summarize the roster problem.' }],
    max_output_tokens: 100,
    output_format: 'text',
    tool: null,
    max_attempts: 1,
    timeout_ms: 5000,
    justification: 'API check.',
    ...over,
  });
  const ok = await cli(
    'model-call',
    ws.id,
    run.run_id,
    JSON.stringify(request()),
  );
  assert.equal(ok.status, 'succeeded');
  assert.equal(ok.fixture, true);
  assert.match(ok.output.text, /^Fixture model.generate/);
  // Larger than the remaining budget: refused and visible in the error view, nothing sent.
  const big = await post(
    `workspaces/${ws.id}/runs/${run.run_id}/model-calls`,
    request({ max_output_tokens: 8000 }),
  );
  assert.equal(big.status, 200);
  assert.equal(big.body.status, 'denied');
  assert.equal(big.body.reason_code, 'budget_exceeded');
  // An action no grant covers asks a person instead of dispatching.
  const ask = await post(
    `workspaces/${ws.id}/runs/${run.run_id}/model-calls`,
    request({ action_type: 'model.summarize' }),
  );
  assert.equal(ask.body.status, 'needs_human');
  const decision = await get(
    `workspaces/${ws.id}/decisions/${ask.body.decision_id}`,
  );
  assert.equal(decision.body.binding.action_type, 'model.summarize');
  const view = await cli('reservations', ws.id);
  assert.deepEqual(
    view
      .map(
        (r: { status: string; reason_code: string }) =>
          `${r.status}:${r.reason_code}`,
      )
      .sort(),
    ['denied:budget_exceeded', 'denied:outside_grant', 'settled:settled'],
  );
  const after = await get(`workspaces/${ws.id}/budgets/${envelope.id}`);
  assert.equal(after.body.reserved, '0');
  assert.equal(
    BigInt(after.body.incurred) + BigInt(after.body.available),
    20_000_000n,
  );
  const history = await get(`workspaces/${ws.id}/history`);
  const actions = history.body.map((h: { action: string }) => h.action);
  for (const a of [
    'pricing.recorded',
    'budget.funded',
    'budget.reserved',
    'budget.settled',
    'budget.denied',
  ])
    assert.ok(actions.includes(a), a);
  // Malformed requests are rejected before any evaluation.
  const bad = await post(`workspaces/${ws.id}/runs/${run.run_id}/model-calls`, {
    ...request(),
    max_attempts: 9,
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error.code, 'INVALID_CONTRACT');
});
