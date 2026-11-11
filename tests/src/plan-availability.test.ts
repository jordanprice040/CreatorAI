import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createApi } from '@creator/api';
import { MemoryVault, PlanConnectionService } from '@creator/broker';
import {
  CreateVerificationGrantRequestSchema,
  PlanAdmissionRequestSchema,
} from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { fakePlan } from './plan-fakes.js';

test('availability check contract cannot turn a one-shot check into private task/build work', () => {
  const request = {
    connection_id: randomUUID(),
    logical_operation_id: randomUUID(),
    path: 'responses',
    purpose: 'availability_recheck',
    model_id: 'm',
    task_class: null,
    data_class: 'synthetic',
    run_id: null,
    build_id: null,
    grant_id: randomUUID(),
    qualification_id: null,
    input_chars: 100,
  };
  PlanAdmissionRequestSchema.parse(request);
  for (const patch of [
    { grant_id: null },
    { data_class: 'private_approved' },
    { task_class: 'research_synthesis' },
    { run_id: randomUUID() },
    { path: 'codex', build_id: randomUUID() },
    { qualification_id: randomUUID() },
  ])
    assert.equal(
      PlanAdmissionRequestSchema.safeParse({ ...request, ...patch }).success,
      false,
    );
  assert.equal(
    CreateVerificationGrantRequestSchema.safeParse({
      expected_version: 1,
      model_id: 'm',
      path: 'codex',
      expires_in_minutes: 5,
      intent: 'availability_recheck',
    }).success,
    false,
  );
});

test('authenticated availability API: intent-bound, atomic one-shot, preserves access, quota/unknown outcomes never retry', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const fake = await fakePlan({
    responses: [
      { kind: 'text', text: 'ok' },
      { kind: 'text', text: 'ok' },
      {
        kind: 'error',
        status: 429,
        code: 'subscription_sharing_usage_limit_exceeded',
      },
      { kind: 'cut', text: 'partial' },
    ],
  });
  t.after(() => fake.close());
  let opened = '';
  const api = createApi(
    {
      CREATOR_DATABASE_URL: db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
      CREATOR_WORKER: 'off',
    },
    {
      planService: (store) =>
        new PlanConnectionService({
          store,
          vault: new MemoryVault(),
          fixtureEndpoints: {
            auth_base: fake.auth_base,
            api_base: fake.api_base,
          },
          openBrowser: (url) => {
            opened = url;
          },
          callbackPort: 0,
        }),
    },
  );
  t.after(() => api.close());
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const post = async (path: string, body: unknown, headers = auth.write) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const get = async (path: string) =>
    (
      await fetch(`${base}/${path}`, { headers: auth.read })
    ).json() as Promise<any>;
  const ws = (
    await post('workspaces', {
      name: 'Availability fixture only',
      record_mode: 'fixture',
    })
  ).body.id;
  const settings = JSON.parse(
    readFileSync(
      new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
      'utf8',
    ),
  );
  const connection = (
    await post(`workspaces/${ws}/plan-connections`, {
      label: 'Fixture check',
      settings,
    })
  ).body;
  const path = `workspaces/${ws}/plan-connections/${connection.id}`;
  await post(path + '/sign-in', { open_browser: true });
  assert.equal(await fake.approve(opened), 200);
  let d = await get(path);
  for (let i = 0; d.connection.sign_in.state !== 'signed_in' && i < 100; i++) {
    await new Promise((r) => setTimeout(r, 20));
    d = await get(path);
  }
  assert.equal(d.connection.sign_in.state, 'signed_in');
  const { CREDITS_OFF_STATEMENT } = await import('@creator/contracts');
  await post(path + '/credits', {
    expected_version: d.connection.version,
    statement: CREDITS_OFF_STATEMENT,
    checked_on: '2026-10-22',
  });
  d = await get(path);
  await post(path + '/accept-caps', {
    expected_version: d.connection.version,
    settings_hash: d.connection.settings_hash,
  });
  const grant = async (intent?: string) => {
    const current = await get(path);
    const g = await post(path + '/verification-grants', {
      expected_version: current.connection.version,
      model_id: 'fixture-model',
      path: 'responses',
      expires_in_minutes: 5,
      ...(intent ? { intent } : {}),
    });
    assert.equal(g.status, 201);
    return g.body;
  };
  const check = (
    g: any,
    endpoint = 'availability-recheck',
    model = 'fixture-model',
  ) => post(path + '/' + endpoint, { grant_id: g.id, model_id: model });
  const premature = await grant('availability_recheck');
  assert.equal(
    (await check(premature)).status,
    403,
    'availability cannot establish initial model access',
  );
  assert.equal(fake.responseRequests.length, 0);
  const initial = await grant();
  assert.equal((await check(initial, 'verify')).body.verified, true);
  const before = await get(path);
  const originalAccess = before.model_access;
  const originalSettingsHash = before.connection.settings_hash;
  const legacy = await grant();
  assert.equal(
    (await check(legacy, 'verify')).status,
    403,
    'initial verification still refuses already-verified model',
  );
  assert.equal(
    (await check(legacy)).status,
    403,
    'legacy/initial grant cannot authorize availability',
  );
  assert.equal(fake.responseRequests.length, 1);
  const onceGrant = await grant('availability_recheck');
  assert.equal(
    (await check(onceGrant, 'verify')).status,
    403,
    'availability grant cannot be used as initial verification',
  );
  assert.equal(
    (await check(onceGrant, 'availability-recheck', 'other-model')).status,
    403,
  );
  const noCsrf = await post(
    path + '/availability-recheck',
    { grant_id: onceGrant.id, model_id: 'fixture-model' },
    auth.read as typeof auth.write,
  );
  assert.equal(noCsrf.status, 403);
  const concurrent = await Promise.all([check(onceGrant), check(onceGrant)]);
  assert.deepEqual(concurrent.map((r) => r.status).sort(), [200, 403]);
  assert.equal(concurrent.find((r) => r.status === 200)!.body.available, true);
  assert.equal(
    fake.responseRequests.length,
    2,
    'only one additional upstream call',
  );
  assert.equal((await check(onceGrant)).status, 403, 'used grant cannot retry');
  let after = await get(path);
  assert.deepEqual(after.model_access, originalAccess);
  // P22 review L-6: the recheck is shown with its own time and result.
  assert.deepEqual(before.last_rechecks, []);
  assert.equal(after.last_rechecks.length, 1);
  assert.equal(after.last_rechecks[0].model_id, 'fixture-model');
  assert.equal(after.last_rechecks[0].state, 'completed');
  assert.ok(Date.parse(after.last_rechecks[0].finished_at) > 0);
  assert.deepEqual(after.qualifications, before.qualifications);
  assert.equal(after.connection.settings_hash, originalSettingsHash);
  assert.equal(after.connection.quota.state, 'available');
  const expired = await grant('availability_recheck');
  await db.pool.query(
    "update plan_verification_grants set expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [expired.id],
  );
  assert.equal((await check(expired)).status, 403);
  assert.equal(fake.responseRequests.length, 2);
  const quotaGrant = await grant('availability_recheck');
  const exhausted = await check(quotaGrant);
  assert.equal(exhausted.status, 200);
  assert.equal(exhausted.body.available, false);
  after = await get(path);
  assert.equal(after.connection.quota.state, 'exhausted');
  // The latest recheck replaces the earlier one in what the page shows.
  assert.equal(after.last_rechecks.length, 1);
  assert.notEqual(after.last_rechecks[0].state, 'completed');
  assert.deepEqual(
    after.model_access,
    originalAccess,
    'provider refusal does not overwrite original verified access',
  );
  assert.equal((await check(quotaGrant)).status, 403);
  assert.equal(fake.responseRequests.length, 3);
  await post(path + '/quota-recheck', {
    expected_version: after.connection.version,
  });
  const cutGrant = await grant('availability_recheck');
  const interrupted = await check(cutGrant);
  assert.equal(interrupted.body.available, false);
  after = await get(path);
  assert.equal(after.usage.unresolved, 1);
  const another = await grant('availability_recheck');
  assert.equal(
    (await check(another)).status,
    403,
    'uncertain delivery blocks even a new grant',
  );
  assert.equal(fake.responseRequests.length, 4);
  assert.deepEqual(after.model_access, originalAccess);
  const records = await get(path + '/requests');
  assert.equal(
    records.filter((r: any) => r.purpose === 'availability_recheck').length,
    3,
  );
  assert.equal(records.filter((r: any) => r.state === 'unknown').length, 1);
  for (const r of fake.responseRequests) {
    assert.equal(r.body.store, false);
    assert.equal(
      r.body.instructions,
      'This is a connection check from Creator Agent. Reply with exactly the word: ok',
    );
    assert.deepEqual(r.body.input, [
      { role: 'user', content: 'Reply with exactly: ok' },
    ]);
  }
});
