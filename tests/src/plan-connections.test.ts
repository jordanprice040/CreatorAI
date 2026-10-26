import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CREDITS_OFF_STATEMENT,
  ContractError,
  PlanConnectionSchema,
  type ErrorCode,
  type PlanConnection,
} from '@creator/contracts';
import { ConnectionStore, type CommandContext } from '@creator/db';
import {
  AGENT_NAME_HINT,
  DYNAMIC_CLIENT,
  MemoryVault,
  PLAN_SCOPES,
  PlanConnectionService,
  authorizationUrl,
  callPlanResponses,
  checkedEndpoints,
  classifyPlanError,
  discover,
  loopbackCallback,
  planRequestBody,
  planVaultFromEnv,
  verifyIdToken,
  exchangeCode,
} from '@creator/broker';
import { admissionBlockers, connectionBlockers } from '@creator/domain';
import { freshDatabase } from './pg-harness.js';
import { fakePlan } from './plan-fakes.js';

const root = new URL('../../', import.meta.url);
const read = (p: string) =>
  JSON.parse(readFileSync(new URL(p, root), 'utf8')) as unknown;
const SETTINGS = read(
  'config/connections/chatgpt-plan.json',
) as PlanConnection['settings'];
const rejects = (code: ErrorCode, p: Promise<unknown>, detail?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(
      e.code,
      code,
      `${e.code}: ${e.message} ${e.details.join(' | ')}`,
    );
    if (detail)
      assert.ok(
        e.details.some((d) => detail.test(d)),
        e.details.join(' | '),
      );
    return true;
  });
const owner: CommandContext = { actorId: randomUUID() };
const until = async (f: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

test('proposed plan settings parse and keep code_build, private data and credits out', () => {
  assert.equal(SETTINGS.plan_type, 'plus');
  assert.deepEqual(SETTINGS.allowed_data_classes, ['synthetic', 'public']);
  assert.deepEqual(SETTINGS.allowed_task_classes, [
    'summarization',
    'specification',
  ]);
  assert.equal(SETTINGS.caps.shared.max_in_flight, 1);
});

test('plan request body follows the preview limits and the error codes map to states', () => {
  const body = planRequestBody('m', 'i', 'x');
  assert.equal(body.store, false);
  assert.equal(body.stream, true);
  for (const k of [
    'max_output_tokens',
    'temperature',
    'metadata',
    'previous_response_id',
  ])
    assert.equal(k in body, false);
  assert.deepEqual(
    classifyPlanError(403, 'subscription_sharing_user_not_eligible', null),
    {
      reason_code: 'subscription_sharing_user_not_eligible',
      eligibility: 'not_eligible',
      retry_allowed: false,
    },
  );
  assert.equal(
    classifyPlanError(429, 'subscription_sharing_usage_limit_exceeded', null)
      .quota,
    'exhausted',
  );
  assert.equal(
    classifyPlanError(503, 'subscription_sharing_usage_unavailable', null)
      .retry_allowed,
    true,
  );
  assert.equal(
    classifyPlanError(
      400,
      'subscription_sharing_unsupported_capability',
      'model',
    ).model_refused,
    true,
  );
  assert.equal(
    classifyPlanError(
      400,
      'subscription_sharing_unsupported_capability',
      'tools',
    ).model_refused,
    false,
  );
  assert.equal(classifyPlanError(401, null, null).sign_in_invalid, true);
});

test('only official endpoints are accepted for real connections', () => {
  assert.throws(() =>
    checkedEndpoints(
      {
        auth_base: 'https://evil.example',
        api_base: 'https://api.openai.com/v1',
      },
      false,
    ),
  );
  assert.throws(() =>
    checkedEndpoints(
      { auth_base: 'http://127.0.0.1:1', api_base: 'http://127.0.0.1:1/v1' },
      false,
    ),
  );
  assert.ok(
    checkedEndpoints(
      { auth_base: 'http://127.0.0.1:1', api_base: 'http://127.0.0.1:1/v1' },
      true,
    ),
  );
});

test('first registration uses the dynamic client with the name hint; later ones do not', () => {
  const e = {
    auth_base: 'https://auth.openai.com',
    api_base: 'https://api.openai.com/v1',
  };
  const first = new URL(
    authorizationUrl({
      endpoints: e,
      host_id: 'urn:uuid:x',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      client_id: null,
    }).url,
  );
  assert.equal(first.searchParams.get('client_id'), DYNAMIC_CLIENT);
  assert.equal(first.searchParams.get('agent_name_hint'), AGENT_NAME_HINT);
  assert.equal(first.searchParams.get('scope'), PLAN_SCOPES);
  assert.equal(first.searchParams.get('resource'), 'https://api.openai.com/v1');
  assert.equal(first.searchParams.get('code_challenge_method'), 'S256');
  const later = new URL(
    authorizationUrl({
      endpoints: e,
      host_id: 'urn:uuid:x',
      redirect_uri: 'http://127.0.0.1:1455/auth/callback',
      client_id: 'app_1',
      id_token_hint: 't',
    }).url,
  );
  assert.equal(later.searchParams.get('client_id'), 'app_1');
  assert.equal(later.searchParams.has('agent_name_hint'), false);
  assert.equal(later.searchParams.get('id_token_hint'), 't');
});

test('loopback callback refuses a wrong state and a different client id', async () => {
  const e = {
    auth_base: 'http://127.0.0.1:9',
    api_base: 'http://127.0.0.1:9/v1',
  };
  let a: ReturnType<typeof authorizationUrl> | null = null;
  const cb = await loopbackCallback(() => a, { port: 0, timeout_ms: 5000 });
  a = authorizationUrl({
    endpoints: e,
    host_id: 'urn:uuid:x',
    redirect_uri: cb.redirect_uri,
    client_id: 'app_1',
  });
  assert.equal(
    (await fetch(`${cb.redirect_uri}?state=nope&code=c`)).status,
    400,
  );
  assert.equal(
    (await fetch(`${cb.redirect_uri}?state=${a.state}&code=c&client_id=app_2`))
      .status,
    400,
  );
  await assert.rejects(cb.result, /different client id/);
});

test('ID tokens are checked for nonce and audience', async (t) => {
  const fake = await fakePlan({ nonce_override: 'wrong' });
  t.after(() => fake.close());
  const e = { auth_base: fake.auth_base, api_base: fake.api_base };
  const a = authorizationUrl({
    endpoints: e,
    host_id: 'urn:uuid:x',
    redirect_uri: 'http://127.0.0.1:1/auth/callback',
    client_id: null,
  });
  const r = await fetch(a.url, { redirect: 'manual' });
  const code = new URL(r.headers.get('location')!).searchParams.get('code')!;
  const tokens = await exchangeCode({
    endpoints: e,
    client_id: fake.issuedClient,
    code,
    verifier: a.verifier,
    redirect_uri: a.redirect_uri,
  });
  const d = await discover(e);
  await assert.rejects(
    verifyIdToken({
      id_token: tokens.id_token!,
      discovery: d,
      client_id: fake.issuedClient,
      nonce: a.nonce,
    }),
    /nonce/,
  );
  await assert.rejects(
    verifyIdToken({
      id_token: tokens.id_token!,
      discovery: d,
      client_id: 'other',
      nonce: 'wrong',
    }),
    /audience/,
  );
  assert.equal(
    (
      await verifyIdToken({
        id_token: tokens.id_token!,
        discovery: d,
        client_id: fake.issuedClient,
        nonce: 'wrong',
      })
    ).subject,
    'user-1',
  );
});

test('the Responses stream counts only response.completed and enforces the output cap', async (t) => {
  const fake = await fakePlan({
    responses: [
      { kind: 'text', text: 'ok' },
      { kind: 'text', text: 'x'.repeat(900) },
      { kind: 'cut', text: 'partial' },
      {
        kind: 'error',
        status: 429,
        code: 'subscription_sharing_usage_limit_exceeded',
      },
    ],
  });
  t.after(() => fake.close());
  const call = (max = 600) =>
    callPlanResponses({
      api_base: fake.api_base,
      access_token: 'at-x',
      model: 'm',
      instructions: 'i',
      input: 'x',
      timeout_ms: 5000,
      max_output_chars: max,
    });
  const ok = await call();
  assert.equal(ok.kind, 'completed');
  assert.equal(ok.kind === 'completed' && ok.text, 'ok');
  const capped = await call();
  assert.equal(capped.kind, 'failed');
  assert.equal(
    'reason_code' in capped && capped.reason_code,
    'studio_output_cap',
  );
  const cut = await call();
  assert.equal(cut.kind, 'unknown');
  assert.equal('reason_code' in cut && cut.reason_code, 'stream_interrupted');
  const limited = await call();
  assert.equal(limited.kind, 'rejected');
  assert.equal('quota' in limited && limited.quota, 'exhausted');
  assert.equal(fake.responseRequests[0]!.body.store, false);
  assert.equal(fake.responseRequests[0]!.auth, 'Bearer at-x');
});

test('pure admission keeps sign-in, credits, caps, model access and qualification separate', () => {
  const now = new Date();
  const conn = {
    id: randomUUID(),
    settings: SETTINGS,
    caps_accepted_at: null,
    sign_in: { state: 'not_signed_in', plan_usage_granted: false },
    credits: { state: 'unconfirmed' },
    eligibility: { state: 'unknown' },
    quota: { state: 'unknown' },
  } as unknown as PlanConnection;
  const b = connectionBlockers(conn);
  assert.ok(b.some((x) => /not signed in/i.test(x)));
  assert.ok(b.some((x) => /credits/i.test(x)));
  assert.ok(b.some((x) => /caps/i.test(x)));
  const ready = {
    ...conn,
    caps_accepted_at: now.toISOString(),
    sign_in: { ...conn.sign_in, state: 'signed_in', plan_usage_granted: true },
    credits: { state: 'confirmed_off' },
  } as unknown as PlanConnection;
  assert.deepEqual(connectionBlockers(ready), []);
  const usage = {
    last_24h_requests: 0,
    last_24h_codex_builds: 0,
    run_requests: 0,
    build_requests: 0,
    in_flight: 0,
    unresolved: 0,
  };
  const request = {
    connection_id: ready.id,
    logical_operation_id: randomUUID(),
    path: 'responses' as const,
    purpose: 'task' as const,
    model_id: 'm',
    task_class: 'summarization' as const,
    data_class: 'public' as const,
    run_id: null,
    build_id: null,
    grant_id: null,
    qualification_id: null,
    input_chars: 10,
  };
  const blocked = admissionBlockers({
    connection: ready,
    request,
    access: [],
    qualifications: [],
    grant: null,
    usage,
    now,
  });
  assert.ok(blocked.some((x) => /verified access/.test(x)));
  assert.ok(blocked.some((x) => /not qualified/.test(x)));
  const verifiedOnly = admissionBlockers({
    connection: ready,
    request,
    access: [
      {
        connection_id: ready.id,
        model_id: 'm',
        path: 'responses',
        access: 'verified',
      },
    ] as never,
    qualifications: [],
    grant: null,
    usage,
    now,
  });
  assert.deepEqual(verifiedOnly, [
    'Model m is not qualified for summarization on this connection.',
  ]);
  assert.ok(
    admissionBlockers({
      connection: ready,
      request: { ...request, data_class: 'private_approved' },
      access: [],
      qualifications: [],
      grant: null,
      usage,
      now,
    }).some((x) => /private_approved/.test(x)),
  );
  assert.ok(
    admissionBlockers({
      connection: ready,
      request,
      access: [],
      qualifications: [],
      grant: null,
      usage: { ...usage, in_flight: 1 },
      now,
    }).some((x) => /one at a time/.test(x)),
  );
});

test('no vault means no sign-in, and file-dev is never chosen implicitly', () => {
  assert.equal(planVaultFromEnv({}), null);
  if (process.platform !== 'win32') {
    assert.equal(planVaultFromEnv({ CREATOR_PLAN_VAULT_DIR: '/tmp/x' }), null);
    assert.equal(
      planVaultFromEnv({
        CREATOR_PLAN_VAULT_DIR: '/tmp/x',
        CREATOR_PLAN_VAULT: 'file-dev',
      })?.kind,
      'file-dev',
    );
  }
});

async function setup(
  t: test.TestContext,
  opts: Parameters<typeof fakePlan>[0] = {},
) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const fake = await fakePlan(opts);
  t.after(() => fake.close());
  const vault = new MemoryVault();
  const service = new PlanConnectionService({
    store,
    vault,
    fixtureEndpoints: { auth_base: fake.auth_base, api_base: fake.api_base },
    openBrowser: () => {},
    callbackPort: 0,
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Plan fixture',
    record_mode: 'fixture',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  const signIn = async () => {
    const s = await service.beginSignIn(owner, ws.id, conn.id, {
      open_browser: false,
    });
    assert.equal(await fake.approve(s.authorization_url), 200);
    await until(() => service.signInStatus(conn.id)?.state !== 'pending');
    return service.signInStatus(conn.id)!;
  };
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  const ready = async () => {
    let c = await current();
    await store.attestPlanCredits(owner, ws.id, c.id, {
      expected_version: c.version,
      statement: CREDITS_OFF_STATEMENT,
      checked_on: '2026-10-20',
    });
    c = await current();
    await store.acceptPlanCaps(owner, ws.id, c.id, {
      expected_version: c.version,
      settings_hash: c.settings_hash,
    });
    return current();
  };
  return { db, store, fake, vault, service, ws, conn, signIn, current, ready };
}

test('a real workspace connection refuses loopback endpoints and uses the official hosts', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const real = await s.store.createWorkspace(owner, {
    name: 'Real',
    record_mode: 'real',
  });
  const c = await s.store.createPlanConnection(owner, real.id, {
    label: 'Plan',
    settings: SETTINGS,
  });
  assert.equal(c.fixture, false);
  assert.equal(s.service.endpointsFor(c).auth_base, 'https://auth.openai.com');
  assert.match(c.ext_agent_host_id, /^urn:uuid:/);
});

test('credits confirmation remains readable by the UI after reloading', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.ready();
  PlanConnectionSchema.parse(await s.current());
});

test('sign-in, credits, caps, verification and qualification are separate recorded states', async (t) => {
  const s = await setup(t, {
    responses: [
      { kind: 'text', text: 'ok' },
      { kind: 'text', text: '{"fixture":true,"summary":"s"}' },
    ],
  });
  if (!s) return;
  const { store, service, ws, conn, fake } = s;
  // Nothing is admitted before sign-in, credits confirmation and cap acceptance.
  await rejects(
    'INVALID_TRANSITION',
    store.createPlanVerificationGrant(owner, ws.id, conn.id, {
      expected_version: 1,
      model_id: 'm',
      path: 'responses',
      expires_in_minutes: 5,
    }),
  );
  const signed = await s.signIn();
  assert.equal(signed.state, 'completed');
  let c = await s.current();
  assert.equal(c.sign_in.state, 'signed_in');
  assert.equal(c.sign_in.issued_client_id, fake.issuedClient);
  assert.equal(c.sign_in.plan_usage_granted, true);
  assert.equal(
    JSON.stringify(c).includes('at-'),
    false,
    'tokens never reach the record',
  );
  assert.equal(fake.tokenRequests[0]!.client_id, fake.issuedClient);
  await rejects(
    'INVALID_TRANSITION',
    store.createPlanVerificationGrant(owner, ws.id, conn.id, {
      expected_version: c.version,
      model_id: 'm',
      path: 'responses',
      expires_in_minutes: 5,
    }),
    /credits/i,
  );
  c = await s.ready();
  assert.deepEqual(
    (await store.planConnectionDetail(owner, ws.id, c.id)).blockers,
    [],
  );
  // Signed in with credits off and caps accepted still does not admit a task.
  await rejects(
    'ACCESS_DENIED',
    service.invoke(owner, ws.id, {
      connection_id: c.id,
      purpose: 'task',
      model_id: 'm',
      task_class: 'summarization',
      data_class: 'public',
      run_id: null,
      instructions: 'i',
      input: 'x',
    }),
    /verified access/,
  );
  const grant = await store.createPlanVerificationGrant(owner, ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  const v = await service.verifyModel(owner, ws.id, c.id, {
    id: grant.id,
    model_id: 'm',
  });
  assert.equal(v.verified, true);
  await rejects(
    'ACCESS_DENIED',
    service.verifyModel(owner, ws.id, c.id, { id: grant.id, model_id: 'm' }),
    /already used|already verified/,
  );
  let d = await store.planConnectionDetail(owner, ws.id, c.id);
  assert.deepEqual(
    d.model_access.map((a) => [a.model_id, a.access]),
    [['m', 'verified']],
  );
  assert.equal(d.connection.eligibility.state, 'eligible');
  // Verified is still not qualified.
  await rejects(
    'ACCESS_DENIED',
    service.invoke(owner, ws.id, {
      connection_id: c.id,
      purpose: 'task',
      model_id: 'm',
      task_class: 'summarization',
      data_class: 'public',
      run_id: null,
      instructions: 'i',
      input: 'x',
    }),
    /not qualified/,
  );
  const q = await store.startPlanQualification(owner, ws.id, c.id, {
    expected_version: d.connection.version,
    model_id: 'm',
    manifest: read('config/routing/benchmark.fixture.json'),
    min_held_out_cases: 8,
    floor: { numerator: 7, denominator: 8 },
  });
  const done = await service.runQualification(owner, ws.id, q.id);
  assert.equal(
    done.state === 'decided' && done.qualification.state,
    'qualified',
  );
  const ok = await service.invoke(owner, ws.id, {
    connection_id: c.id,
    purpose: 'task',
    model_id: 'm',
    task_class: 'summarization',
    data_class: 'public',
    run_id: randomUUID(),
    instructions: 'i',
    input: 'x',
  });
  assert.equal(ok.outcome.kind, 'completed');
  // A different task class stays blocked.
  await rejects(
    'ACCESS_DENIED',
    service.invoke(owner, ws.id, {
      connection_id: c.id,
      purpose: 'task',
      model_id: 'm',
      task_class: 'specification',
      data_class: 'public',
      run_id: null,
      instructions: 'i',
      input: 'x',
    }),
    /not qualified for specification/,
  );
  d = await store.planConnectionDetail(owner, ws.id, c.id);
  assert.equal(d.usage.in_flight, 0);
  // Changing settings withdraws cap acceptance, which blocks inference again.
  await store.updatePlanSettings(owner, ws.id, c.id, {
    expected_version: d.connection.version,
    settings: {
      ...SETTINGS,
      caps: {
        ...SETTINGS.caps,
        shared: { ...SETTINGS.caps.shared, max_model_requests_per_day: 39 },
      },
    },
  });
  assert.ok(
    (await store.planConnectionDetail(owner, ws.id, c.id)).blockers.some((b) =>
      /caps/i.test(b),
    ),
  );
});

test('provider refusals are recorded as eligibility and quota states and stop admission', async (t) => {
  const s = await setup(t, {
    responses: [
      {
        kind: 'error',
        status: 403,
        code: 'subscription_sharing_user_not_eligible',
      },
    ],
  });
  if (!s) return;
  await s.signIn();
  const c = await s.ready();
  const g = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  const v = await s.service.verifyModel(owner, s.ws.id, c.id, {
    id: g.id,
    model_id: 'm',
  });
  assert.equal(v.verified, false);
  const d = await s.store.planConnectionDetail(owner, s.ws.id, c.id);
  assert.equal(d.connection.eligibility.state, 'not_eligible');
  assert.equal(
    d.connection.eligibility.reason_code,
    'subscription_sharing_user_not_eligible',
  );
  assert.ok(d.blockers.some((b) => /eligible/i.test(b)));
  assert.equal(
    d.model_access.length,
    0,
    'an eligibility refusal says nothing about the model',
  );
});

test('one request at a time: a concurrent admission is refused while one is in flight', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.signIn();
  const c = await s.ready();
  const g1 = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  const c2 = await s.current();
  const g2 = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: c2.version,
    model_id: 'n',
    path: 'responses',
    expires_in_minutes: 5,
  });
  const admit = (grant: string, model: string) =>
    s.store.admitPlanRequest(owner, s.ws.id, {
      connection_id: c.id,
      logical_operation_id: randomUUID(),
      path: 'responses',
      purpose: 'verification',
      model_id: model,
      task_class: null,
      data_class: 'synthetic',
      run_id: null,
      build_id: null,
      grant_id: grant,
      qualification_id: null,
      input_chars: 10,
    });
  const results = await Promise.allSettled([
    admit(g1.id, 'm'),
    admit(g2.id, 'n'),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const refused = results.find(
    (r) => r.status === 'rejected',
  ) as PromiseRejectedResult;
  assert.ok(
    (refused.reason as ContractError).details.some((d) =>
      /one at a time/.test(d),
    ),
  );
  // An in-flight request left by a crash blocks further work until the owner reconciles it.
  const left = results.find(
    (r) => r.status === 'fulfilled',
  ) as PromiseFulfilledResult<{ request_id: string }>;
  await s.store.settlePlanRequest(left.value.request_id, {
    state: 'unknown',
    reason_code: 'timeout',
    upstream_request_id: null,
    output_chars: null,
  });
  const d = await s.store.planConnectionDetail(owner, s.ws.id, c.id);
  assert.equal(d.usage.unresolved, 1);
  await s.db.pool.query('update plan_requests set output_chars=7 where id=$1', [
    left.value.request_id,
  ]);
  await assert.rejects(
    s.store.reconcilePlanRequest(owner, s.ws.id, c.id, left.value.request_id, {
      expected_version: d.connection.version,
      outcome: 'did_not_run',
      note: 'Cannot contradict observed output.',
    }),
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'INVALID_TRANSITION' &&
      /observed output/.test(e.message),
  );
  const other =
    results.findIndex((r) => r.status === 'rejected') === 0 ? g1 : g2;
  await rejects('ACCESS_DENIED', admit(other.id, other.model_id), /reconcile/);
  await s.store.reconcilePlanRequest(
    owner,
    s.ws.id,
    c.id,
    left.value.request_id,
    {
      expected_version: d.connection.version,
      outcome: 'ran',
      note: 'Checked the provider usage page.',
    },
  );
  assert.ok(await admit(other.id, other.model_id));
});

test('unknown duplicate refuses redispatch and retains durable observations', async (t) => {
  const s = await setup(t, { responses: [{ kind: 'cut', text: 'partial' }] });
  if (!s) return;
  await s.signIn();
  const c = await s.ready();
  const grant = await s.store.createPlanVerificationGrant(
    owner,
    s.ws.id,
    c.id,
    {
      expected_version: c.version,
      model_id: 'm',
      path: 'responses',
      expires_in_minutes: 5,
    },
  );
  const request = {
    connection_id: c.id,
    logical_operation_id: randomUUID(),
    purpose: 'verification' as const,
    model_id: 'm',
    task_class: null,
    data_class: 'synthetic' as const,
    run_id: null,
    grant_id: grant.id,
    instructions: 'fixture',
    input: 'fixture',
  };
  const first = await s.service.invoke(owner, s.ws.id, request);
  await rejects('DUPLICATE', s.service.invoke(owner, s.ws.id, request));
  assert.equal(first.outcome.kind, 'unknown');
  const [saved] = await s.store.planRequests(owner, s.ws.id, c.id);
  assert.equal(saved!.state, 'unknown');
  assert.equal(saved!.upstream_request_id, first.outcome.response_id);
  assert.equal(saved!.output_chars, 7);
  assert.equal(s.fake.responseRequests.length, 1);
});

test('a terminal refresh error requires a new sign-in and keeps the registration', async (t) => {
  const s = await setup(t, { refresh: 'invalid_grant' });
  if (!s) return;
  await s.signIn();
  const ref = (await s.store.planCredentialRef(owner, s.ws.id, s.conn.id))
    .credential_ref!;
  const cred = (await s.vault.get(ref))!;
  await s.vault.put(ref, {
    ...cred,
    expires_at: new Date(Date.now() + 1000).toISOString(),
  });
  const both = await Promise.allSettled([
    s.service.accessToken(owner, s.ws.id, s.conn.id),
    s.service.accessToken(owner, s.ws.id, s.conn.id),
  ]);
  assert.ok(both.every((r) => r.status === 'rejected'));
  assert.equal(
    s.fake.tokenRequests.filter((r) => r.grant_type === 'refresh_token').length,
    1,
    'refreshes are serialized',
  );
  const c = await s.current();
  assert.equal(c.sign_in.state, 'reauthorization_required');
  assert.equal(c.sign_in.issued_client_id, s.fake.issuedClient);
});

test('refresh rotates the token, and sign-out revokes it and deletes the saved sign-in', async (t) => {
  const s = await setup(t, { refresh: 'rotate' });
  if (!s) return;
  await s.signIn();
  const ref = (await s.store.planCredentialRef(owner, s.ws.id, s.conn.id))
    .credential_ref!;
  const cred = (await s.vault.get(ref))!;
  await s.vault.put(ref, {
    ...cred,
    expires_at: new Date(Date.now() + 1000).toISOString(),
  });
  const t1 = await s.service.accessToken(owner, s.ws.id, s.conn.id);
  assert.notEqual(t1.token, cred.access_token);
  const rotated = (await s.vault.get(ref))!;
  assert.notEqual(rotated.refresh_token, cred.refresh_token);
  await s.service.signOut(owner, s.ws.id, s.conn.id);
  assert.deepEqual(s.fake.revoked, [rotated.refresh_token]);
  assert.equal(await s.vault.get(ref), null);
  assert.equal((await s.current()).sign_in.state, 'signed_out');
});

test('a sign-in that grants no plan usage scope is recorded but admits nothing', async (t) => {
  const s = await setup(t, { scope: 'openid profile email offline_access' });
  if (!s) return;
  const r = await s.signIn();
  assert.equal(r.state === 'completed' && r.plan_usage_granted, false);
  await s.ready();
  assert.ok(
    (
      await s.store.planConnectionDetail(owner, s.ws.id, s.conn.id)
    ).blockers.some((b) => /plan usage/i.test(b)),
  );
});

test('production discovery-contract qualification grades role outputs through the plan service using loopback only', async (t) => {
  const manifest = read(
    'config/connections/benchmarks/discovery-synthetic-v3/research_synthesis.json',
  ) as import('@creator/contracts').BenchmarkManifest;
  const controls = read(
    'config/connections/benchmarks/discovery-synthetic-v3/author-controls.json',
  ) as { task_class: string; case_id: string; gold: unknown }[];
  const s = await setup(t, {
    responses: [
      { kind: 'text', text: 'ok' },
      ...manifest.cases.map((c) => ({
        kind: 'text' as const,
        text: JSON.stringify(
          controls.find(
            (x) =>
              x.task_class === manifest.task_class && x.case_id === c.case_id,
          )!.gold,
        ),
      })),
    ],
  });
  if (!s) return;
  await s.signIn();
  let conn = await s.ready();
  conn = await s.store.updatePlanSettings(owner, s.ws.id, conn.id, {
    expected_version: conn.version,
    settings: {
      ...conn.settings,
      allowed_task_classes: [
        ...conn.settings.allowed_task_classes,
        'research_synthesis',
      ],
    },
  });
  conn = await s.store.acceptPlanCaps(owner, s.ws.id, conn.id, {
    expected_version: conn.version,
    settings_hash: conn.settings_hash,
  });
  const grant = await s.store.createPlanVerificationGrant(
    owner,
    s.ws.id,
    conn.id,
    {
      expected_version: conn.version,
      model_id: 'm',
      path: 'responses',
      expires_in_minutes: 5,
    },
  );
  await s.service.verifyModel(owner, s.ws.id, conn.id, {
    id: grant.id,
    model_id: 'm',
  });
  conn = (await s.store.planConnectionDetail(owner, s.ws.id, conn.id))
    .connection;
  const q = await s.store.startPlanQualification(owner, s.ws.id, conn.id, {
    expected_version: conn.version,
    model_id: 'm',
    manifest: { ...manifest, fixture: true },
    min_held_out_cases: 4,
    floor: { numerator: 1, denominator: 1 },
  });
  const result = await s.service.runQualification(owner, s.ws.id, q.id);
  assert.equal(result.state, 'decided');
  if (result.state === 'decided') {
    assert.equal(result.qualification.state, 'qualified');
    assert.equal(result.qualification.held_out.passed, 4);
  }
  assert.equal(s.fake.responseRequests.length, 7);
});
