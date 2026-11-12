import test from 'node:test';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import { LOGIN_CODE, login } from './pg-harness.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CREDITS_OFF_STATEMENT,
  ContractError,
  DISCOVERY_TASK_CLASSES,
  StartDiscoveryRequestSchema,
  WorkflowDetailSchema,
} from '@creator/contracts';
import {
  canonicalHash,
  DISCOVERY_SCENARIOS,
  EXPLORATION_MARKER,
  discoveryFixtureAnswer,
  discoveryRoleInput,
  explorationFixtureAnswer,
} from '@creator/domain';
import { ConnectionStore, ORCHESTRATOR_ACTOR_ID } from '@creator/db';
import {
  FixtureAdapter,
  MemoryVault,
  PlanConnectionService,
  callPlanResponses,
} from '@creator/broker';
import { Worker } from '@creator/orchestrator';
import { discoverySetup, owner } from './discovery-harness.js';
import { fakePlan } from './plan-fakes.js';
import { currentDiscoveryQualificationFixture } from './discovery-contract-fixtures.js';

async function setup(t: test.TestContext) {
  const h = await discoverySetup(t, new FixtureAdapter());
  if (!h) return null;
  const store = new ConnectionStore(h.db.pool);
  const upstream = await fakePlan();
  t.after(() => upstream.close());
  let calls = 0;
  let mode: 'normal' | 'unknown' | 'pending' = 'normal';
  const service = new PlanConnectionService({
    store,
    vault: new MemoryVault(),
    fixtureEndpoints: {
      auth_base: upstream.auth_base,
      api_base: upstream.api_base,
    },
    openBrowser: () => {},
    callbackPort: 0,
    fetchImpl: async (url, init) => {
      if (!String(url).endsWith('/responses')) return fetch(url, init);
      calls++;
      if (mode === 'pending')
        return new Promise<Response>((_resolve, reject) => {
          if (init?.signal?.aborted) reject(new Error('aborted'));
          else
            init?.signal?.addEventListener(
              'abort',
              () => reject(new Error('aborted')),
              { once: true },
            );
        });
      if (mode === 'unknown')
        return new Response(
          'data: {"type":"response.output_text.delta","delta":"partial"}\n\n',
          { headers: { 'content-type': 'text/event-stream' } },
        );
      const body = JSON.parse(String(init?.body));
      const messages = body.instructions.includes('[discovery-task:')
        ? [
            { role: 'system', text: body.instructions },
            ...JSON.parse(body.input[0].content),
          ]
        : [];
      const explore = body.instructions.includes(EXPLORATION_MARKER)
        ? explorationFixtureAnswer([
            { role: 'system', text: body.instructions },
            ...JSON.parse(body.input[0].content),
          ])
        : null;
      const text =
        explore ?? (messages.length ? discoveryFixtureAnswer(messages)! : 'ok');
      const ev = (v: unknown) => `data: ${JSON.stringify(v)}\n\n`;
      return new Response(
        ev({ type: 'response.output_text.delta', delta: text }) +
          ev({
            type: 'response.completed',
            response: { id: `fixture-${calls}`, usage: { output_tokens: 10 } },
          }),
        { headers: { 'content-type': 'text/event-stream' } },
      );
    },
  });
  const defaults = JSON.parse(
    readFileSync(
      new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
      'utf8',
    ),
  );
  const conn = await store.createPlanConnection(owner, h.ws.id, {
    label: 'Fixture discovery route',
    settings: {
      ...defaults,
      allowed_task_classes: [...new Set(Object.values(DISCOVERY_TASK_CLASSES))],
      caps: {
        ...defaults.caps,
        responses: {
          max_requests_per_run: 40,
          request_timeout_ms: 5000,
          max_output_chars: 60000,
          max_input_chars: 200000,
        },
        shared: { max_in_flight: 1, max_model_requests_per_day: 100 },
      },
    },
  });
  const signed = await service.beginSignIn(owner, h.ws.id, conn.id, {
    open_browser: false,
  });
  await upstream.approve(signed.authorization_url);
  for (
    let i = 0;
    i < 100 && service.signInStatus(conn.id)?.state === 'pending';
    i++
  )
    await new Promise((r) => setTimeout(r, 10));
  let c = (await store.planConnectionDetail(owner, h.ws.id, conn.id))
    .connection;
  await store.attestPlanCredits(owner, h.ws.id, c.id, {
    expected_version: c.version,
    statement: CREDITS_OFF_STATEMENT,
    checked_on: '2026-10-20',
  });
  c = (await store.planConnectionDetail(owner, h.ws.id, conn.id)).connection;
  await store.acceptPlanCaps(owner, h.ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  c = (await store.planConnectionDetail(owner, h.ws.id, conn.id)).connection;
  const grant = await store.createPlanVerificationGrant(owner, h.ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  await service.verifyModel(owner, h.ws.id, c.id, {
    id: grant.id,
    model_id: 'm',
  });
  const resource = {
    kind: 'subscription' as const,
    connection_id: c.id,
    model_id: 'm',
    settings_hash: c.settings_hash,
    max_output_chars: 60000,
  };
  const runId = await h.run();
  const scenario = DISCOVERY_SCENARIOS[0]!;
  const seeded = await h.seed(scenario, runId);
  const legacy = h.request(scenario, seeded);
  const { envelope_id: _, pricing_snapshot_id: __, ...rest } = legacy;
  const req = {
    ...rest,
    resource_setup: resource,
    limits: { ...legacy.limits, max_concurrency: 1, max_calls: 30 },
  };
  // Explicit test-only qualified fixtures test plumbing, never model quality or real entitlement.
  const qualify = async (
    classes: Iterable<string> = new Set(Object.values(DISCOVERY_TASK_CLASSES)),
  ) => {
    for (const task_class of classes as Iterable<
      (typeof DISCOVERY_TASK_CLASSES)[keyof typeof DISCOVERY_TASK_CLASSES]
    >) {
      const qualifiedManifest =
        currentDiscoveryQualificationFixture(task_class);
      await h.db.pool.query(
        `insert into plan_qualifications (id,connection_id,model_id,task_class,manifest,manifest_hash,min_held_out_cases,floor,state,development,held_out,created_by) values ($1,$2,'m',$3,$4,$5,3,$6,'qualified',$7,$7,$8)`,
        [
          randomUUID(),
          conn.id,
          task_class,
          JSON.stringify(qualifiedManifest),
          canonicalHash(qualifiedManifest),
          JSON.stringify({ numerator: 1, denominator: 1 }),
          JSON.stringify({ total: 3, passed: 3 }),
          owner.actorId,
        ],
      );
    }
  };
  const worker = () =>
    new Worker(store, h.broker, {
      planService: service,
      leaseMs: 5000,
      heartbeatMs: 50,
    });
  return {
    ...h,
    store,
    service,
    conn,
    resource,
    runId,
    req,
    qualify,
    worker,
    calls: () => calls,
    setMode: (m: typeof mode) => {
      mode = m;
    },
  };
}

test('subscription discovery needs role qualifications, no envelope/pricing, and preserves legacy request hashes', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const legacy = {
    ...s.req,
    envelope_id: randomUUID(),
    pricing_snapshot_id: randomUUID(),
  };
  delete (legacy as Partial<typeof legacy>).resource_setup;
  assert.equal(
    canonicalHash(StartDiscoveryRequestSchema.parse(legacy)),
    canonicalHash(legacy),
  );
  await assert.rejects(
    s.store.startDiscovery(owner, s.ws.id, s.runId, s.req),
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'ACCESS_DENIED' &&
      e.details.some((d) => d.includes('not qualified')),
  );
  assert.equal(s.calls(), 1);
  await s.qualify();
  const started = await s.store.startDiscovery(owner, s.ws.id, s.runId, s.req);
  await assert.rejects(
    s.db.pool.query(
      "update workflows set resource_setup=jsonb_set(resource_setup,'{model_id}','\"other\"'),version=version+1 where id=$1",
      [started.workflow.id],
    ),
    /resource setup is immutable/,
  );
  assert.equal(started.workflow.envelope_id, null);
  assert.equal(started.workflow.pricing_snapshot_id, null);
  await s.worker().settle();
  const result = await s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
  WorkflowDetailSchema.parse(result);
  assert.equal(
    result.workflow.state,
    'succeeded',
    JSON.stringify(result.tasks.map((t) => [t.kind, t.reason])),
  );
  assert.ok(result.subscription_usage!.requests > 2);
  assert.equal(result.subscription_usage!.unresolved, 0);
  assert.equal(result.reservations.length, 0);
  assert.equal(result.usage.attempts, 0);
  assert.equal(
    (
      await s.db.pool.query(
        'select count(*)::int as n from budget_reservations where run_id=$1',
        [s.runId],
      )
    ).rows[0].n,
    0,
  );
});

// ADR-0081 (P21 review L-4): switching the current model after a discovery started does not
// change the route it recorded; every plan request it makes stays on its own model.
test('a discovery started before a model switch keeps its recorded model', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualify();
  const started = await s.store.startDiscovery(owner, s.ws.id, s.runId, s.req);
  let c = (await s.store.planConnectionDetail(owner, s.ws.id, s.conn.id))
    .connection;
  const g = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm2',
    path: 'responses',
    expires_in_minutes: 5,
  });
  await s.service.verifyModel(owner, s.ws.id, c.id, {
    id: g.id,
    model_id: 'm2',
  });
  const switched = await s.store.setModelChoice(owner, s.ws.id, {
    expected_version: 0,
    connection_id: s.conn.id,
    model_id: 'm2',
  });
  assert.equal(switched.choice.model_id, 'm2');
  await s.worker().settle();
  const result = await s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
  assert.equal(result.workflow.state, 'succeeded');
  assert.equal(
    (result.workflow.resource_setup as { model_id?: string }).model_id,
    'm',
  );
  const models = await s.db.pool.query(
    `select distinct model_id from plan_requests where run_id = $1 and purpose = 'task'`,
    [s.runId],
  );
  assert.deepEqual(
    models.rows.map((r) => r.model_id),
    ['m'],
  );
});

test('exploration on a plan needs only the locator qualification and spends nothing metered (ADR-0065)', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const req = {
    scope: { max_candidates: 2 },
    resource_setup: s.resource,
    data_class: 'synthetic' as const,
    limits: {
      max_children: 1,
      max_concurrency: 1,
      max_depth: 1,
      max_attempts: 1,
      max_repairs: 1,
      max_calls: 2,
      max_output_tokens: 4000,
      call_timeout_ms: 5000,
      max_wall_seconds: 600,
    },
  };
  await assert.rejects(
    s.store.startExploration(owner, s.ws.id, s.runId, req),
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'ACCESS_DENIED' &&
      e.message === 'Exploration route is not ready.' &&
      e.details.some((d) => d.includes('not qualified')) &&
      // ADR-0087: the refusal also carries its code and what its fix needs.
      e.reasons.some(
        (r) =>
          r.code === 'not_qualified' &&
          r.task_class === 'research_synthesis' &&
          r.model_id === s.resource.model_id &&
          r.connection_id === s.resource.connection_id,
      ),
  );
  await s.qualify(['research_synthesis']);
  const started = await s.store.startExploration(owner, s.ws.id, s.runId, req);
  await s.worker().settle();
  const done = await s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
  assert.equal(done.workflow.state, 'succeeded', done.workflow.reason);
  assert.equal(done.workflow.result?.exploration?.outcome, 'candidates');
  assert.ok(done.workflow.result!.exploration!.candidates.length <= 2);
  assert.equal(done.subscription_usage!.requests, 1);
  assert.equal(done.reservations.length, 0);
  const plan = await s.db.pool.query(
    'select task_class from plan_requests where run_id=$1',
    [s.runId],
  );
  assert.deepEqual(
    plan.rows.map((r) => r.task_class),
    ['research_synthesis'],
  );
});

test('subscription workflow replay survives restart without redispatch, binds input', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualify();
  const started = await s.store.startDiscovery(owner, s.ws.id, s.runId, s.req);
  const ctx = { actorId: ORCHESTRATOR_ACTOR_ID };
  const [lease] = await s.store.claimTasks(ctx, 'fixture-first', 1, 5000);
  assert.ok(lease?.discovery);
  const input = discoveryRoleInput(
    'locate',
    lease.task.context as never,
    lease.discovery.packet,
    lease.discovery.inputs,
  );
  const request = {
    connection_id: s.conn.id,
    purpose: 'task' as const,
    model_id: 'm',
    task_class: 'research_synthesis' as const,
    data_class: 'synthetic' as const,
    run_id: s.runId,
    instructions: input
      .filter((m) => m.role !== 'user')
      .map((m) => m.text)
      .join('\n'),
    input: JSON.stringify(input.filter((m) => m.role === 'user')),
    logical_operation_id: lease.task.logical_operation_id,
    workflow: {
      task_id: lease.task.id,
      lease_token: lease.token,
      input_hash: canonicalHash(input),
    },
  };
  const [a, b] = await Promise.all([
    s.service.invoke(ctx, s.ws.id, request),
    s.service.invoke(ctx, s.ws.id, request),
  ]);
  assert.ok([a.outcome.kind, b.outcome.kind].includes('completed'));
  assert.equal(s.calls(), 2);
  await assert.rejects(
    s.service.invoke(ctx, s.ws.id, { ...request, input: 'changed input' }),
    (e) => e instanceof ContractError && e.code === 'EVIDENCE_MISMATCH',
  );
  await s.db.pool.query(
    "update workflow_tasks set lease_expires_at=now()-interval '1 second', version=version+1 where id=$1",
    [lease.task.id],
  );
  await s.worker().settle();
  const done = await s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
  assert.equal(
    done.workflow.state,
    'succeeded',
    JSON.stringify(done.tasks.map((t) => t.reason)),
  );
  assert.equal(
    (
      await s.db.pool.query(
        'select count(*)::int as n from plan_requests where workflow_task_id=$1',
        [lease.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test('subscription setup refuses stale settings, concurrent jobs, human-only runs, unsupported local routes and unapproved data', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualify();
  for (const req of [
    {
      ...s.req,
      resource_setup: { ...s.resource, settings_hash: 'a'.repeat(64) },
    },
    { ...s.req, limits: { ...s.req.limits, max_concurrency: 2 } },
    { ...s.req, data_class: 'private_approved' },
    {
      ...s.req,
      resource_setup: { kind: 'local', model_id: 'not-implemented' },
    },
  ])
    await assert.rejects(
      s.store.startDiscovery(owner, s.ws.id, s.runId, req),
      (e) => e instanceof ContractError,
    );
  const human = await s.run('human_only');
  await assert.rejects(
    s.store.startDiscovery(owner, s.ws.id, human, s.req),
    (e) => e instanceof ContractError && e.code === 'HUMAN_ONLY_DENIED',
  );
  assert.equal(s.calls(), 1);
});

test('unknown subscription requests hold work without retry and explicit reconciliation releases the task', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualify();
  s.setMode('unknown');
  const started = await s.store.startDiscovery(owner, s.ws.id, s.runId, {
    ...s.req,
    limits: { ...s.req.limits, max_repairs: 0 },
  });
  await s.worker().settle();
  const pending = await s.store.getWorkflow(
    owner,
    s.ws.id,
    started.workflow.id,
  );
  assert.ok(pending.tasks.some((t) => t.state === 'reconciling'));
  assert.equal(s.calls(), 2);
  await s.worker().settle();
  assert.equal(s.calls(), 2);
  const detail = await s.store.planConnectionDetail(owner, s.ws.id, s.conn.id);
  const [request] = await s.store.planRequests(owner, s.ws.id, s.conn.id);
  assert.equal(request!.state, 'unknown');
  await s.store.reconcilePlanRequest(owner, s.ws.id, s.conn.id, request!.id, {
    expected_version: detail.connection.version,
    outcome: 'ran',
    note: 'Fixture outcome explicitly reconciled without a usable result.',
  });
  await s.worker().settle();
  const done = await s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
  assert.ok(done.tasks.every((t) => t.state !== 'reconciling'));
  assert.equal(s.calls(), 2);
});

test('missing grants wait durably and cancellation aborts an admitted subscription call without redispatch', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualify();
  for (const grant of await s.store.listGrants(owner, s.ws.id))
    if (grant.run_id === s.runId && grant.status === 'active')
      await s.store.revokeGrant(owner, s.ws.id, grant.id, {
        expected_version: grant.version,
        reason: 'Fixture revocation.',
      });
  const started = await s.store.startDiscovery(owner, s.ws.id, s.runId, s.req);
  await s.worker().settle();
  const waiting = await s.store.getWorkflow(
    owner,
    s.ws.id,
    started.workflow.id,
  );
  assert.ok(
    waiting.tasks.some((t) => t.state === 'waiting_human'),
    JSON.stringify(waiting.tasks.map((t) => t.reason)),
  );
  assert.equal(s.calls(), 1);
  await s.store.cancelRun(owner, s.ws.id, s.runId, {
    reason: 'Cancel fixture waiting work.',
  });
  const secondRun = await s.run();
  s.setMode('pending');
  const next = await s.store.startDiscovery(owner, s.ws.id, secondRun, s.req);
  const worker = s.worker();
  await worker.tick();
  for (let i = 0; i < 100 && s.calls() < 2; i++)
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(s.calls(), 2);
  await s.store.cancelRun(owner, s.ws.id, secondRun, {
    reason: 'Cancel fixture pending request.',
  });
  await worker.settle();
  assert.equal(
    (await s.store.getWorkflow(owner, s.ws.id, next.workflow.id)).workflow
      .state,
    'cancelled',
  );
  assert.equal(s.calls(), 2);
  const requests = await s.store.planRequests(owner, s.ws.id, s.conn.id);
  assert.equal(requests[0]!.state, 'unknown');
});

test('authenticated HTTP discovery dispatches on the embedded worker with typed plan setup', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const s = await setup(t);
  if (!s) return;
  await s.qualify();
  const app = createApi(
    {
      CREATOR_DATABASE_URL: s.db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
      CREATOR_OWNER_ACTOR_ID: owner.actorId,
      CREATOR_WORKER_POLL_MS: '20',
      CREATOR_MAINTENANCE: 'off',
    },
    { planService: () => s.service },
  );
  await app.ready();
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  closeApi = app.close;
  const base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const path = `${base}/workspaces/${s.ws.id}/runs/${s.runId}/discoveries`;
  assert.equal(
    (
      await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(s.req),
      })
    ).status,
    401,
  );
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...auth.write },
    body: JSON.stringify(s.req),
  });
  assert.equal(response.status, 201, await response.clone().text());
  const start = WorkflowDetailSchema.parse(await response.json());
  for (let i = 0; i < 200; i++) {
    const detail = WorkflowDetailSchema.parse(
      await (
        await fetch(
          `${base}/workspaces/${s.ws.id}/workflows/${start.workflow.id}`,
          { headers: auth.read },
        )
      ).json(),
    );
    if (detail.workflow.finished_at) {
      assert.equal(
        detail.workflow.state,
        'succeeded',
        JSON.stringify(detail.tasks.map((t) => t.reason)),
      );
      assert.ok(detail.subscription_usage!.requests > 0);
      return;
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.fail('embedded subscription worker did not finish');
});

test('cancellation during credential lookup cannot start a later provider request', async () => {
  const controller = new AbortController();
  controller.abort();
  let dispatched = false;
  const outcome = await callPlanResponses({
    api_base: 'http://127.0.0.1:1',
    access_token: 'fixture',
    model: 'm',
    instructions: 'fixture',
    input: 'fixture',
    timeout_ms: 1000,
    max_output_chars: 500,
    signal: controller.signal,
    fetchImpl: async () => {
      dispatched = true;
      throw new Error('should not dispatch');
    },
  });
  assert.equal(dispatched, false);
  assert.equal(outcome.kind, 'rejected');
});

test('typed API resources preserve the existing budgeted discovery path', async (t) => {
  const h = await discoverySetup(t, new FixtureAdapter());
  if (!h) return;
  const runId = await h.run();
  const scenario = DISCOVERY_SCENARIOS[0]!;
  const seeded = await h.seed(scenario, runId);
  const legacy = h.request(scenario, seeded);
  const { envelope_id, pricing_snapshot_id, ...rest } = legacy;
  const req = {
    ...rest,
    resource_setup: { kind: 'api', envelope_id, pricing_snapshot_id },
  };
  const start = await h.store.startDiscovery(owner, h.ws.id, runId, req);
  await h.worker.settle();
  const detail = await h.store.getWorkflow(owner, h.ws.id, start.workflow.id);
  assert.equal(detail.workflow.state, 'succeeded');
  assert.ok(detail.reservations.length);
  assert.equal(detail.subscription_usage, undefined);
});

test('a qualified task name with stale role-prompt evidence cannot unlock discovery', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualify();
  const { rows } = await s.db.pool.query(
    "select id,manifest from plan_qualifications where connection_id=$1 and task_class='research_synthesis'",
    [s.conn.id],
  );
  const stale = rows[0].manifest;
  stale.cases[0].input[0].text = 'An obsolete unrelated role prompt.';
  await s.db.pool.query(
    'update plan_qualifications set manifest=$2,manifest_hash=$3 where id=$1',
    [rows[0].id, stale, canonicalHash(stale)],
  );
  await assert.rejects(
    s.store.startDiscovery(owner, s.ws.id, s.runId, s.req),
    (e) => e instanceof ContractError && e.code === 'ACCESS_DENIED',
  );
  assert.equal(s.calls(), 1);
});

for (const historicalVersion of [1, 2, 3])
  test(`historical v${historicalVersion} qualification cannot unlock the revised role contract`, async (t) => {
    const s = await setup(t);
    if (!s) return;
    await s.qualify();
    const stale = {
      ...JSON.parse(
        readFileSync(
          new URL(
            `../../config/connections/benchmarks/discovery-synthetic-v${historicalVersion}/research_synthesis.json`,
            import.meta.url,
          ),
          'utf8',
        ),
      ),
      fixture: true,
    };
    await s.db.pool.query(
      "update plan_qualifications set manifest=$2,manifest_hash=$3 where connection_id=$1 and task_class='research_synthesis'",
      [s.conn.id, stale, canonicalHash(stale)],
    );
    await assert.rejects(
      s.store.startDiscovery(owner, s.ws.id, s.runId, s.req),
      (e) => e instanceof ContractError && e.code === 'ACCESS_DENIED',
    );
    assert.equal(s.calls(), 1);
  });
