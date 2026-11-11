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
import {
  ConnectionStore,
  heldOutKeys,
  promptHash,
  migrate,
  type CommandContext,
  type ManifestCase,
} from '@creator/db';
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
import {
  BUILD_ROLE_PROMPTS,
  canonicalHash,
  fixtureHumilityReview,
  admissionBlockers,
  connectionBlockers,
} from '@creator/domain';
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

test('proposed plan settings parse, allow every task (ADR-0084) and keep private data and credits out', () => {
  assert.equal(SETTINGS.plan_type, 'plus');
  assert.deepEqual(SETTINGS.allowed_data_classes, ['synthetic', 'public']);
  // ADR-0084 (Jordan's Decision A) replaced the least-privilege task default; acceptance of
  // the caps is still the gate before anything runs.
  assert.deepEqual(SETTINGS.allowed_task_classes, [
    'research_synthesis',
    'candidate_generation',
    'scoring',
    'specification',
    'summarization',
    'patch_build',
    'independent_review',
    'code_build',
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
  // PR #75 review L-2: the newest decided qualification counts. A later failure withdraws an
  // earlier pass, a later pass restores it, and a running or abandoned one decides nothing.
  const q = (state: string, decided: string | null, created: string) => ({
    id: randomUUID(),
    connection_id: ready.id,
    model_id: 'm',
    task_class: 'summarization',
    state,
    decided_at: decided,
    created_at: created,
  });
  const qualifiedWith = (qualifications: unknown[]) =>
    !admissionBlockers({
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
      qualifications: qualifications as never,
      grant: null,
      usage,
      now,
    }).some((x) => /not qualified/.test(x));
  const pass = q('qualified', '2026-10-01T10:00:00Z', '2026-10-01T09:00:00Z');
  const fail = q('failed', '2026-10-02T10:00:00Z', '2026-10-02T09:00:00Z');
  const again = q('qualified', '2026-10-03T10:00:00Z', '2026-10-03T09:00:00Z');
  assert.equal(qualifiedWith([pass]), true);
  assert.equal(qualifiedWith([fail, pass]), false);
  assert.equal(qualifiedWith([again, fail, pass]), true);
  assert.equal(
    qualifiedWith([
      q('running', null, '2026-10-04T09:00:00Z'),
      q('abandoned', '2026-10-04T10:00:00Z', '2026-10-04T09:00:00Z'),
      pass,
    ]),
    true,
  );
  // Another model's or task class's failure does not touch this one.
  assert.equal(qualifiedWith([{ ...fail, model_id: 'other' }, pass]), true);
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
  // ADR-0053: the accepted per-request input cap is the binding bound for plan-role packets.
  const cap = SETTINGS.caps.responses.max_input_chars;
  const sized = (input_chars: number) =>
    admissionBlockers({
      connection: ready,
      request: { ...request, input_chars },
      access: [],
      qualifications: [],
      grant: null,
      usage,
      now,
    }).some((x) => /per-request input cap/.test(x));
  assert.equal(sized(cap), false);
  assert.equal(sized(cap + 1), true);
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
  // PR #86 review L-5 (ADR-0052): viewing a qualification's results shows its held-out cases,
  // so the view is recorded once per person, and those held-out cases are refused for a
  // different prompt. The same prompt may still be retried on them.
  const manifest = read('config/routing/benchmark.fixture.json') as {
    cases: { input: { role: string; text: string }[] }[];
  };
  const views = () =>
    s.db.pool.query(
      `select body from plan_connection_events where kind = 'qualification_held_out_viewed'`,
    );
  assert.equal((await views()).rowCount, 0);
  await store.planQualificationResults(owner, ws.id, q.id);
  await store.planQualificationResults(owner, ws.id, q.id);
  const viewed = await views();
  assert.equal(viewed.rowCount, 1);
  assert.equal(viewed.rows[0].body.qualification_id, q.id);
  assert.equal(viewed.rows[0].body.held_out.length, 8);
  const revised = {
    ...manifest,
    cases: manifest.cases.map((k) => ({
      ...k,
      input: k.input.map((m) =>
        m.role === 'system' ? { ...m, text: `${m.text} Be brief.` } : m,
      ),
    })),
  };
  const version = async () =>
    (await store.planConnectionDetail(owner, ws.id, c.id)).connection.version;
  await assert.rejects(
    store.startPlanQualification(owner, ws.id, c.id, {
      expected_version: await version(),
      model_id: 'm',
      manifest: revised,
      min_held_out_cases: 8,
      floor: { numerator: 7, denominator: 8 },
    }),
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'INVALID_CONTRACT' &&
      /8 held-out cases were viewed on .* fresh held-out cases/.test(e.message),
  );
  const retry = await store.startPlanQualification(owner, ws.id, c.id, {
    expected_version: await version(),
    model_id: 'm',
    manifest,
    min_held_out_cases: 8,
    floor: { numerator: 7, denominator: 8 },
  });
  assert.equal(retry.state, 'running');
});

test('ADR-0084: a second Run of a qualification that is running is refused and nothing is sent twice', async (t) => {
  // Review of PR #169 M-1: a Run is one long request. A page that was left (or a second
  // window) could press Run again and start a second loop for the same qualification.
  let hold = false;
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  const s = await setup(t, {
    responses: [
      { kind: 'text', text: 'ok' },
      { kind: 'text', text: '{"fixture":true,"summary":"s"}' },
    ],
    beforeResponse: async () => {
      if (hold) await held;
    },
  });
  if (!s) return;
  const refused = (p: Promise<unknown>, m: RegExp) =>
    assert.rejects(
      p,
      (e: unknown) =>
        e instanceof ContractError &&
        e.code === 'INVALID_TRANSITION' &&
        m.test(e.message),
    );
  const { store, service, ws, conn, fake } = s;
  await s.signIn();
  const c = await s.ready();
  const grant = await store.createPlanVerificationGrant(owner, ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  await service.verifyModel(owner, ws.id, c.id, {
    id: grant.id,
    model_id: 'm',
  });
  const q = await store.startPlanQualification(owner, ws.id, c.id, {
    expected_version: (await s.current()).version,
    model_id: 'm',
    manifest: read('config/routing/benchmark.fixture.json'),
    min_held_out_cases: 8,
    floor: { numerator: 7, denominator: 8 },
  });
  const executing = async () =>
    (
      await store.planConnectionDetail(owner, ws.id, conn.id)
    ).qualifications.find((x) => x.id === q.id)?.executing;
  assert.equal(await executing(), false, 'started is not running');
  hold = true;
  const sent = fake.responseRequests.length;
  const first = service.runQualification(owner, ws.id, q.id);
  await until(() => fake.responseRequests.length > sent);
  assert.equal(
    await executing(),
    true,
    'the page reads the Run from the server',
  );
  // The same process (another tab, or the page after a remount) is refused.
  await refused(
    service.runQualification(owner, ws.id, q.id),
    /already running/,
  );
  // Another studio process sharing the database sees the case in flight and is refused too.
  const other = new PlanConnectionService({
    ...service.deps,
    store: new ConnectionStore(s.db.pool),
  });
  await refused(other.runQualification(owner, ws.id, q.id), /still in flight/);
  hold = false;
  release();
  const done = await first;
  assert.equal(
    done.state === 'decided' && done.qualification.state,
    'qualified',
  );
  const cases = await s.db.pool.query(
    'select case_id, count(*)::int as n from plan_requests where qualification_id = $1 group by case_id',
    [q.id],
  );
  const manifest = read('config/routing/benchmark.fixture.json') as {
    cases: unknown[];
  };
  assert.equal(cases.rows.length, manifest.cases.length);
  assert.ok(
    cases.rows.every((r) => r.n === 1),
    'every case was sent exactly once',
  );
  assert.equal(await executing(), undefined, 'a decided one is not running');
  // The claim is released, and a finished qualification is refused before anything is sent.
  const after = fake.responseRequests.length;
  await refused(
    service.runQualification(owner, ws.id, q.id),
    /already finished/,
  );
  assert.equal(fake.responseRequests.length, after);
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

test('ADR-0064: the owner closes a request a stopped studio left in flight, only once it cannot still be running', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.signIn();
  const c = await s.ready();
  const g = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  const admitted = await s.store.admitPlanRequest(owner, s.ws.id, {
    connection_id: c.id,
    logical_operation_id: randomUUID(),
    path: 'responses',
    purpose: 'verification',
    model_id: 'm',
    task_class: null,
    data_class: 'synthetic',
    run_id: null,
    build_id: null,
    grant_id: g.id,
    qualification_id: null,
    input_chars: 10,
  });
  const rid = admitted.request_id;
  const close = (store: ConnectionStore, version: number) =>
    store.reconcilePlanRequest(owner, s.ws.id, c.id, rid, {
      expected_version: version,
      outcome: 'ran',
      note: 'The app was closed while it was asking.',
    });
  // This studio is still waiting on it: shown, not closable, and the store refuses to close it.
  let d = await s.store.planConnectionDetail(owner, s.ws.id, c.id);
  assert.equal(d.open_requests.length, 1);
  assert.equal(d.open_requests[0]!.request.id, rid);
  assert.equal(d.open_requests[0]!.waiting, true);
  assert.equal(d.open_requests[0]!.closable, false);
  await assert.rejects(
    close(s.store, d.connection.version),
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'INVALID_TRANSITION' &&
      /still waiting/.test(e.message),
  );
  // After a restart nothing waits on it, but inside its timeout plus 15 minutes it may still run.
  const restarted = new ConnectionStore(s.db.pool);
  d = await restarted.planConnectionDetail(owner, s.ws.id, c.id);
  const open = d.open_requests[0]!;
  assert.equal(open.waiting, false);
  assert.equal(open.closable, false);
  // The running-now panel's point: the timeout plus 15 minutes, never under 45 minutes.
  const after =
    Date.parse(open.request.started_at) +
    Math.max(2_700_000, 900_000 + c.settings.caps.responses.request_timeout_ms);
  assert.ok(Math.abs(Date.parse(open.closable_after!) - after) < 1000);
  await assert.rejects(
    close(restarted, d.connection.version),
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'INVALID_TRANSITION' &&
      /may still be running/.test(e.message),
  );
  // Past that point it is closable; closing frees the connection but still counts as used.
  await s.db.pool.query(
    `update plan_requests set started_at = started_at - interval '1 day' where id = $1`,
    [rid],
  );
  d = await restarted.planConnectionDetail(owner, s.ws.id, c.id);
  assert.equal(d.open_requests[0]!.closable, true);
  // Part of an answer was seen: it cannot be recorded as not run (PR #128 review N-3).
  await s.db.pool.query('update plan_requests set output_chars=3 where id=$1', [
    rid,
  ]);
  await assert.rejects(
    restarted.reconcilePlanRequest(owner, s.ws.id, c.id, rid, {
      expected_version: d.connection.version,
      outcome: 'did_not_run',
      note: 'Checked.',
    }),
    /observed output/,
  );
  await close(restarted, d.connection.version);
  d = await restarted.planConnectionDetail(owner, s.ws.id, c.id);
  assert.deepEqual(d.open_requests, []);
  assert.equal(d.usage.in_flight, 0);
  const [row] = await restarted.planRequests(owner, s.ws.id, c.id);
  assert.equal(row!.state, 'reconciled');
  assert.equal(row!.reason_code, 'owner_ran');
  // A settle from the old process arriving late cannot overwrite the owner's record.
  await assert.rejects(
    s.store.settlePlanRequest(rid, {
      state: 'unknown',
      reason_code: 'timeout',
      upstream_request_id: null,
      output_chars: null,
    }),
    /already settled/,
  );
});

test('ADR-0064: a request with an unknown outcome is closable at once and still counts toward the day', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.signIn();
  const c = await s.ready();
  const g = await s.store.createPlanVerificationGrant(owner, s.ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  const { request_id } = await s.store.admitPlanRequest(owner, s.ws.id, {
    connection_id: c.id,
    logical_operation_id: randomUUID(),
    path: 'responses',
    purpose: 'verification',
    model_id: 'm',
    task_class: null,
    data_class: 'synthetic',
    run_id: null,
    build_id: null,
    grant_id: g.id,
    qualification_id: null,
    input_chars: 10,
  });
  await s.store.settlePlanRequest(request_id, {
    state: 'unknown',
    reason_code: 'timeout',
    upstream_request_id: null,
    output_chars: null,
  });
  let d = await s.store.planConnectionDetail(owner, s.ws.id, c.id);
  assert.equal(d.open_requests.length, 1);
  assert.equal(d.open_requests[0]!.closable, true);
  assert.equal(d.open_requests[0]!.waiting, false);
  assert.equal(d.open_requests[0]!.closable_after, null);
  const before = d.usage.last_24h_requests;
  // Only the owner closes a request (PR #128 review N-3).
  const editor = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'editor',
  });
  await s.store.addMember(owner, s.ws.id, editor.actorId, 'editor');
  await rejects(
    'ACCESS_DENIED',
    s.store.reconcilePlanRequest(editor, s.ws.id, c.id, request_id, {
      expected_version: d.connection.version,
      outcome: 'ran',
      note: 'Not mine to close.',
    }),
  );
  await s.store.reconcilePlanRequest(owner, s.ws.id, c.id, request_id, {
    expected_version: d.connection.version,
    outcome: 'did_not_run',
    note: 'Nothing on the plan usage page.',
  });
  d = await s.store.planConnectionDetail(owner, s.ws.id, c.id);
  assert.deepEqual(d.open_requests, []);
  assert.equal(d.usage.unresolved, 0);
  assert.equal(d.usage.last_24h_requests, before);
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
  const rotatedRef = (
    await s.store.planCredentialRef(owner, s.ws.id, s.conn.id)
  ).credential_ref!;
  assert.notEqual(rotatedRef, ref);
  assert.equal(await s.vault.get(ref), null);
  const rotated = (await s.vault.get(rotatedRef))!;
  assert.notEqual(rotated.refresh_token, cred.refresh_token);
  await s.service.signOut(owner, s.ws.id, s.conn.id);
  assert.deepEqual(s.fake.revoked, [rotated.refresh_token]);
  assert.equal(await s.vault.get(ref), null);
  assert.equal(await s.vault.get(rotatedRef), null);
  assert.equal((await s.current()).sign_in.state, 'signed_out');
});

test('Disconnect invalidates an older browser flow, including completion in another service', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.signIn();
  let release!: () => void;
  let entered!: () => void;
  const waiting = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const written: string[] = [];
  const put = s.vault.put.bind(s.vault);
  s.vault.put = async (ref, value) => {
    written.push(ref);
    await put(ref, value);
  };
  const other = new PlanConnectionService({
    ...s.service.deps,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/oauth/token')) {
        entered();
        await gate;
      }
      return fetch(url, init);
    },
  });
  const started = await other.beginSignIn(owner, s.ws.id, s.conn.id, {
    open_browser: false,
  });
  await s.fake.approve(started.authorization_url);
  await waiting;
  try {
    await s.service.signOut(owner, s.ws.id, s.conn.id);
    assert.equal((await s.current()).sign_in.state, 'signed_out');
  } finally {
    release();
  }
  await until(() => other.signInStatus(s.conn.id)?.state !== 'pending');
  assert.equal(other.signInStatus(s.conn.id)?.state, 'failed');
  assert.equal((await s.current()).sign_in.state, 'signed_out');
  for (const ref of written)
    assert.equal(
      await s.vault.get(ref),
      null,
      'stale candidate credentials removed',
    );
});

test('a late refresh cannot recreate credentials or return a token after Disconnect', async (t) => {
  const s = await setup(t, { refresh: 'rotate' });
  if (!s) return;
  await s.signIn();
  const ref = (await s.store.planCredentialRef(owner, s.ws.id, s.conn.id))
    .credential_ref!;
  const cred = (await s.vault.get(ref))!;
  await s.vault.put(ref, { ...cred, expires_at: new Date(0).toISOString() });
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const written: string[] = [];
  const put = s.vault.put.bind(s.vault);
  s.vault.put = async (key, value) => {
    written.push(key);
    await put(key, value);
  };
  const other = new PlanConnectionService({
    ...s.service.deps,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/oauth/token')) {
        entered();
        await gate;
      }
      return fetch(url, init);
    },
  });
  const refused = assert.rejects(other.accessToken(owner, s.ws.id, s.conn.id));
  await waiting;
  try {
    await s.service.signOut(owner, s.ws.id, s.conn.id);
  } finally {
    release();
  }
  await refused;
  assert.equal((await s.current()).sign_in.state, 'signed_out');
  assert.equal(await s.vault.get(ref), null);
  for (const key of written) assert.equal(await s.vault.get(key), null);
});

test('late authentication failures affect only the credential used by that request', async (t) => {
  for (const scenario of [
    'disconnect',
    'new_login',
    'new_refresh',
    'current_after_refresh',
    'legacy_unbound',
  ] as const) {
    await t.test(scenario, async (t) => {
      const s = await setup(t, {
        refresh: 'rotate',
        responses: [{ kind: 'error', status: 401, code: 'invalid_token' }],
      });
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
      if (scenario === 'current_after_refresh') {
        const ref = (await s.store.planCredentialRef(owner, s.ws.id, c.id))
          .credential_ref!;
        await s.vault.put(ref, {
          ...(await s.vault.get(ref))!,
          expires_at: new Date(0).toISOString(),
        });
      }
      let entered!: () => void, release!: () => void;
      const waiting = new Promise<void>((r) => {
        entered = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const other = new PlanConnectionService({
        ...s.service.deps,
        fetchImpl: async (url, init) => {
          if (String(url).endsWith('/responses')) {
            entered();
            await gate;
          }
          return fetch(url, init);
        },
      });
      const pending = other.invoke(owner, s.ws.id, {
        connection_id: c.id,
        logical_operation_id: randomUUID(),
        purpose: 'verification',
        model_id: 'm',
        task_class: null,
        data_class: 'synthetic',
        run_id: null,
        grant_id: grant.id,
        instructions: 'fixture',
        input: 'fixture',
      });
      await waiting;
      let before!: typeof c;
      try {
        if (scenario === 'disconnect' || scenario === 'new_login')
          await s.service.signOut(owner, s.ws.id, c.id);
        if (scenario === 'new_login') await s.signIn();
        if (scenario === 'new_refresh') {
          const ref = (await s.store.planCredentialRef(owner, s.ws.id, c.id))
            .credential_ref!;
          await s.vault.put(ref, {
            ...(await s.vault.get(ref))!,
            expires_at: new Date(0).toISOString(),
          });
          await s.service.accessToken(owner, s.ws.id, c.id);
        }
        if (scenario === 'legacy_unbound')
          await s.db.pool.query(
            'update plan_requests set auth_generation = null where connection_id = $1',
            [c.id],
          );
        before = await s.current();
      } finally {
        release();
      }
      const result = await pending;
      assert.equal(result.outcome.kind, 'rejected');
      const after = await s.current();
      assert.equal(
        after.sign_in.state,
        scenario === 'current_after_refresh'
          ? 'reauthorization_required'
          : before.sign_in.state,
      );
      assert.equal(
        after.version,
        before.version + (scenario === 'current_after_refresh' ? 1 : 0),
      );
      const [request] = await s.store.planRequests(owner, s.ws.id, c.id);
      assert.equal(
        request!.state,
        'rejected',
        'the old result is retained rather than discarded',
      );
      assert.equal(
        (await s.store.planConnectionDetail(owner, s.ws.id, c.id)).usage
          .last_24h_requests,
        1,
        'the request still counts',
      );
    });
  }
});

test('admission cannot dispatch under a replacement login', async (t) => {
  const s = await setup(t);
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
  let entered!: () => void, release!: () => void;
  const waiting = new Promise<void>((r) => {
    entered = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const other = new PlanConnectionService(s.service.deps);
  other.accessToken = async (...args) => {
    entered();
    await gate;
    return s.service.accessToken(...args);
  };
  const pending = other.invoke(owner, s.ws.id, {
    connection_id: c.id,
    logical_operation_id: randomUUID(),
    purpose: 'verification',
    model_id: 'm',
    task_class: null,
    data_class: 'synthetic',
    run_id: null,
    grant_id: grant.id,
    instructions: 'fixture',
    input: 'fixture',
  });
  await waiting;
  try {
    await s.service.signOut(owner, s.ws.id, c.id);
    await s.signIn();
  } finally {
    release();
  }
  assert.equal((await pending).outcome.kind, 'rejected');
  assert.equal(s.fake.responseRequests.length, 0);
  assert.equal((await s.current()).sign_in.state, 'signed_in');
});

test('migration 41 preserves v40 connections and pending requests without inventing auth bindings', async (t) => {
  const s = await setup(t);
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
  const admitted = await s.store.admitPlanRequest(owner, s.ws.id, {
    connection_id: c.id,
    logical_operation_id: randomUUID(),
    path: 'responses',
    purpose: 'verification',
    model_id: 'm',
    task_class: null,
    data_class: 'synthetic',
    run_id: null,
    build_id: null,
    grant_id: grant.id,
    qualification_id: null,
    input_chars: 10,
  });
  const before = await s.current();
  // Test-only v40 layout: retain the business rows, remove only the newly added columns/ledger row.
  await s.db.pool.query(
    'alter table plan_requests drop column auth_generation, drop column credential_ref; alter table plan_connections drop column auth_generation; delete from schema_migrations where version = 41',
  );
  assert.deepEqual(await migrate(s.db.pool), [41]);
  assert.deepEqual(await s.current(), before);
  const migrated = (
    await s.db.pool.query(
      'select state, auth_generation, credential_ref from plan_requests where id = $1',
      [admitted.request_id],
    )
  ).rows[0];
  assert.deepEqual(migrated, {
    state: 'in_flight',
    auth_generation: null,
    credential_ref: null,
  });
  await s.store.settlePlanRequest(
    admitted.request_id,
    {
      state: 'rejected',
      reason_code: 'invalid_token',
      upstream_request_id: null,
      output_chars: null,
    },
    { sign_in_invalid: true },
  );
  assert.deepEqual(
    await s.current(),
    before,
    'an unbound legacy failure cannot rewrite the existing login',
  );
  assert.equal(
    (await s.store.planConnectionDetail(owner, s.ws.id, c.id)).usage
      .last_24h_requests,
    1,
  );
});

test('a late result cannot rewrite a newer login’s quota, eligibility or model access', async (t) => {
  for (const scenario of [
    'stale_limit',
    'stale_success',
    'current_limit',
  ] as const) {
    await t.test(scenario, async (t) => {
      const s = await setup(t, {
        responses:
          scenario === 'stale_success'
            ? [{ kind: 'text', text: 'ok' }]
            : [
                {
                  kind: 'error',
                  status: 429,
                  code: 'subscription_sharing_usage_limit_exceeded',
                },
              ],
      });
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
      let entered!: () => void, release!: () => void;
      const waiting = new Promise<void>((r) => {
        entered = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const other = new PlanConnectionService({
        ...s.service.deps,
        fetchImpl: async (url, init) => {
          if (String(url).endsWith('/responses')) {
            entered();
            await gate;
          }
          return fetch(url, init);
        },
      });
      const pending = other.invoke(owner, s.ws.id, {
        connection_id: c.id,
        logical_operation_id: randomUUID(),
        purpose: 'verification',
        model_id: 'm',
        task_class: null,
        data_class: 'synthetic',
        run_id: null,
        grant_id: grant.id,
        instructions: 'fixture',
        input: 'fixture',
      });
      await waiting;
      try {
        if (scenario !== 'current_limit') {
          await s.service.signOut(owner, s.ws.id, c.id);
          await s.signIn();
        }
      } finally {
        release();
      }
      const result = await pending;
      const detail = await s.store.planConnectionDetail(owner, s.ws.id, c.id);
      if (scenario === 'current_limit') {
        assert.equal(result.outcome.kind, 'rejected');
        assert.equal(detail.connection.quota.state, 'exhausted');
        return;
      }
      // The newer login keeps its own (still unobserved) account state.
      assert.equal(detail.connection.sign_in.state, 'signed_in');
      assert.equal(detail.connection.quota.state, 'unknown');
      assert.equal(detail.connection.eligibility.state, 'unknown');
      assert.deepEqual(detail.model_access, []);
      assert.ok(
        !detail.blockers.some((b) => /usage limit/i.test(b)),
        'the newer login is not blocked by the old login’s limit',
      );
      const [request] = await s.store.planRequests(owner, s.ws.id, c.id);
      assert.equal(
        request!.state,
        scenario === 'stale_success' ? 'completed' : 'rejected',
        'the old outcome is still recorded',
      );
      assert.equal(detail.usage.last_24h_requests, 1, 'and still counts');
    });
  }
});

test('the Codex relay binds its admission to the login: late 401s affect only the current one', async (t) => {
  for (const scenario of ['disconnect', 'new_login', 'current'] as const) {
    await t.test(scenario, async (t) => {
      const s = await setup(t);
      if (!s) return;
      await s.signIn();
      let c = await s.ready();
      // Test-only plumbing: allow code_build, mark the model verified on the Codex path and
      // qualified for code_build. Not evidence of real entitlement or model quality.
      c = await s.store.updatePlanSettings(owner, s.ws.id, c.id, {
        expected_version: c.version,
        settings: {
          ...c.settings,
          allowed_task_classes: [
            // ADR-0084: the proposal may already allow these.
            ...new Set([...c.settings.allowed_task_classes, 'code_build']),
          ],
        },
      });
      c = await s.store.acceptPlanCaps(owner, s.ws.id, c.id, {
        expected_version: c.version,
        settings_hash: c.settings_hash,
      });
      await s.db.pool.query(
        `insert into plan_model_access (connection_id, model_id, path, access, request_id)
         values ($1, 'm', 'codex', 'verified', $2)`,
        [c.id, randomUUID()],
      );
      const manifest = { fixture: 'codex-relay-binding' };
      await s.db.pool.query(
        `insert into plan_qualifications (id,connection_id,model_id,task_class,manifest,manifest_hash,min_held_out_cases,floor,state,development,held_out,created_by,decided_at)
         values ($1,$2,'m','code_build',$3,$4,3,$5,'qualified',$6,$6,$7,clock_timestamp())`,
        [
          randomUUID(),
          c.id,
          JSON.stringify(manifest),
          canonicalHash(manifest),
          JSON.stringify({ numerator: 1, denominator: 1 }),
          JSON.stringify({ total: 3, passed: 3 }),
          owner.actorId,
        ],
      );
      const relay = await s.service.codexAdmission(owner, s.ws.id, {
        connection_id: c.id,
        model_id: 'm',
        run_id: null,
        build_id: randomUUID(),
        data_class: 'synthetic',
      })();
      const [admitted] = await s.store.planRequests(owner, s.ws.id, c.id);
      assert.equal(admitted!.path, 'codex');
      if (scenario !== 'current') await s.service.signOut(owner, s.ws.id, c.id);
      if (scenario === 'new_login') await s.signIn();
      const before = await s.current();
      await relay.settle({
        kind: 'failed',
        reason_code: 'http_401',
        http_status: 401,
        error_code: null,
        error_param: null,
        output_tokens: null,
        output_chars: 0,
        output_hash: '0'.repeat(64),
        response_id: null,
      });
      const after = await s.current();
      assert.equal(
        after.sign_in.state,
        scenario === 'current'
          ? 'reauthorization_required'
          : before.sign_in.state,
      );
      assert.equal(
        after.version,
        before.version + (scenario === 'current' ? 1 : 0),
      );
      const [settled] = await s.store.planRequests(owner, s.ws.id, c.id);
      assert.equal(settled!.state, 'failed');
    });
  }
});

test('browser sign-in survives credits, settings and cap acceptance changes', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const started = await s.service.beginSignIn(owner, s.ws.id, s.conn.id, {
    open_browser: false,
  });
  let c = await s.current();
  c = await s.store.attestPlanCredits(owner, s.ws.id, c.id, {
    expected_version: c.version,
    statement: CREDITS_OFF_STATEMENT,
    checked_on: '2026-11-04',
  });
  c = await s.store.updatePlanSettings(owner, s.ws.id, c.id, {
    expected_version: c.version,
    settings: {
      ...c.settings,
      caps: {
        ...c.settings.caps,
        responses: {
          ...c.settings.caps.responses,
          max_input_chars: c.settings.caps.responses.max_input_chars - 1,
        },
      },
    },
  });
  c = await s.store.acceptPlanCaps(owner, s.ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  await s.fake.approve(started.authorization_url);
  await until(() => s.service.signInStatus(c.id)?.state !== 'pending');
  assert.equal(s.service.signInStatus(c.id)?.state, 'completed');
  const after = await s.current();
  assert.equal(after.sign_in.state, 'signed_in');
  assert.equal(after.settings_hash, c.settings_hash);
  assert.equal(after.caps_accepted_at, c.caps_accepted_at);
  assert.equal(after.credits.state, 'confirmed_off');
});

test('browser sign-in survives a refresh and removes the credential it actually replaces', async (t) => {
  const s = await setup(t, { refresh: 'rotate' });
  if (!s) return;
  await s.signIn();
  const started = await s.service.beginSignIn(owner, s.ws.id, s.conn.id, {
    open_browser: false,
  });
  const old = (await s.store.planCredentialRef(owner, s.ws.id, s.conn.id))
    .credential_ref!;
  await s.vault.put(old, {
    ...(await s.vault.get(old))!,
    expires_at: new Date(0).toISOString(),
  });
  await s.service.accessToken(owner, s.ws.id, s.conn.id);
  const refreshed = (await s.store.planCredentialRef(owner, s.ws.id, s.conn.id))
    .credential_ref!;
  assert.notEqual(refreshed, old);
  await s.fake.approve(started.authorization_url);
  await until(() => s.service.signInStatus(s.conn.id)?.state !== 'pending');
  assert.equal(s.service.signInStatus(s.conn.id)?.state, 'completed');
  const current = (await s.store.planCredentialRef(owner, s.ws.id, s.conn.id))
    .credential_ref!;
  assert.notEqual(current, refreshed);
  assert.ok(await s.vault.get(current));
  assert.equal(await s.vault.get(old), null);
  assert.equal(await s.vault.get(refreshed), null);
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
        // ADR-0084: the proposal may already allow these.
        ...new Set([
          ...conn.settings.allowed_task_classes,
          'research_synthesis',
        ]),
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

const BOUND = {
  candidate: 'a'.repeat(40),
  spec_hash: 'b'.repeat(64),
  task_hash: 'c'.repeat(64),
};
const reviewCase = (case_id: string, split: string, prompt: string) => ({
  case_id,
  split,
  input: [
    { role: 'system', text: prompt },
    {
      role: 'user',
      text: `{"candidate":"${BOUND.candidate}","case":"${case_id}"}`,
    },
  ],
  output_format: 'json',
  max_output_tokens: 400,
  check: { kind: 'review_verdict', verdict: 'approve', ...BOUND },
});
const reviewManifest = (prompt: string = BUILD_ROLE_PROMPTS.reviewer) => ({
  format: 'route-benchmark/1',
  name: 'fixture-review-v1',
  fixture: true,
  task_class: 'independent_review',
  data_class: 'synthetic',
  cases: [
    reviewCase('rv-01', 'development', prompt),
    reviewCase('rv-02', 'held_out', prompt),
    reviewCase('rv-03', 'held_out', prompt),
    reviewCase('rv-04', 'held_out', prompt),
  ],
  provenance: 'Synthetic test manifest; checks written before any result.',
});
const APPROVE = JSON.stringify({ ...BOUND, verdict: 'approve', findings: [] });

test('build-role plan requests need the exact role prompt, a qualification and a live AI run', async (t) => {
  const s = await setup(t, {
    responses: [
      { kind: 'text', text: 'ok' },
      { kind: 'text', text: APPROVE },
    ],
  });
  if (!s) return;
  const { store, service, ws } = s;
  await s.signIn();
  let conn = await s.ready();
  conn = await store.updatePlanSettings(owner, ws.id, conn.id, {
    expected_version: conn.version,
    settings: {
      ...conn.settings,
      allowed_task_classes: [
        // ADR-0084: the proposal may already allow these.
        ...new Set([
          ...conn.settings.allowed_task_classes,
          'independent_review',
          'patch_build',
        ]),
      ],
    },
  });
  conn = await store.acceptPlanCaps(owner, ws.id, conn.id, {
    expected_version: conn.version,
    settings_hash: conn.settings_hash,
  });
  const grant = await store.createPlanVerificationGrant(owner, ws.id, conn.id, {
    expected_version: conn.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  await service.verifyModel(owner, ws.id, conn.id, {
    id: grant.id,
    model_id: 'm',
  });
  conn = await s.current();
  const start = (manifest: unknown) =>
    store.startPlanQualification(owner, ws.id, conn.id, {
      expected_version: conn.version,
      model_id: 'm',
      manifest,
      min_held_out_cases: 3,
      floor: { numerator: 1, denominator: 1 },
    });
  // A reviewer qualification must use the very prompt T12 sends.
  await rejects(
    'INVALID_CONTRACT',
    start(reviewManifest('route-benchmark/1: review this.')),
  );
  // Patch cases run code, so they are never a route benchmark and need the studio grader.
  await rejects(
    'INVALID_CONTRACT',
    store.registerBenchmark(owner, ws.id, {
      ...reviewManifest(BUILD_ROLE_PROMPTS.builder),
      task_class: 'patch_build',
      cases: reviewManifest(BUILD_ROLE_PROMPTS.builder).cases.map((c) => ({
        ...c,
        check: {
          kind: 'patch_cases',
          file_scope: ['src'],
          cases: [
            { check_key: 'A1', args: [], stdin: '', stdout: '', exit_code: 0 },
          ],
        },
      })),
    }),
  );
  const patch = await start({
    ...reviewManifest(BUILD_ROLE_PROMPTS.builder),
    task_class: 'patch_build',
    cases: reviewManifest(BUILD_ROLE_PROMPTS.builder).cases.map((c) => ({
      ...c,
      check: {
        kind: 'patch_cases',
        file_scope: ['src'],
        cases: [
          { check_key: 'A1', args: [], stdin: '', stdout: '', exit_code: 0 },
        ],
      },
    })),
  });
  const sent = s.fake.responseRequests.length;
  assert.deepEqual(await service.runQualification(owner, ws.id, patch.id), {
    state: 'stopped',
    reason: 'patch_scorer_unavailable',
  });
  assert.equal(s.fake.responseRequests.length, sent, 'nothing was sent');
  conn = await s.current();
  const q = await start(reviewManifest());
  const done = await service.runQualification(owner, ws.id, q.id);
  assert.equal(
    done.state === 'decided' && done.qualification.state,
    'qualified',
  );
  const entity = async (condition: string, mode: string) => {
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: `${mode} run`,
      body: {
        state: 'queued',
        experiment_condition: condition,
        discovery_method:
          mode === 'human_only' ? 'human_defined' : 'structured',
        config_hash: null,
      },
    });
    return (
      await store.registerRun(owner, ws.id, {
        run: { id: r.id, version: 1 },
        autonomy_mode: mode as 'human_in_loop',
        stage_gates: null,
        initial_grants: [],
      })
    ).run_id;
  };
  // ADR-0054: every build-role request names its build, whose one approval covers it.
  const call = (
    role: 'builder' | 'reviewer',
    run_id: string,
    build_id: string = randomUUID(),
  ) =>
    service.buildRole(owner, ws.id, conn.id, {
      role,
      model_id: 'm',
      run_id,
      build_id,
      data_class: 'synthetic',
      input: '{"candidate":"x"}',
      timeout_ms: 120000,
      logical_operation_id: randomUUID(),
    });
  const live = await entity('human_in_loop', 'human_in_loop');
  const human = await entity('human_only', 'human_only');
  await rejects('NOT_FOUND', call('reviewer', randomUUID()));
  await rejects('INVALID_TRANSITION', call('reviewer', human));
  // Qualified for review is not qualified for building, and the build preflight says so.
  await rejects('ACCESS_DENIED', call('builder', live));
  const ready = (run_id: string, ctx = owner) =>
    service.buildRolesReady(ctx, ws.id, conn.id, {
      model_id: 'm',
      run_id,
      data_class: 'synthetic',
    });
  // The preflight no longer asks for a model-request grant on the run: the build's one
  // approval covers its role requests.
  assert.deepEqual(await ready(live), [
    'Model m is not qualified for patch_build (the T12 builder) under its current prompt.',
  ]);
  assert.match((await ready(human))[0]!, /human-only/);
  // A frozen study assignment keeps its adopted route.
  const studyRun = await entity('human_in_loop', 'human_in_loop');
  const studyId = randomUUID();
  await s.db.pool.query(
    `insert into studies(id, workspace_id, manifest, manifest_hash, created_by)
     values ($1, $2, '{}', $3, $4)`,
    [studyId, ws.id, 'b'.repeat(64), owner.actorId],
  );
  await s.db.pool.query(
    `insert into study_attempts(id, study_id, workspace_id, run_id, assignment, context, context_hash, ordinal)
     values ($1, $2, $3, $4, '{}', '{}', $5, 1)`,
    [randomUUID(), studyId, ws.id, studyRun, 'c'.repeat(64)],
  );
  await rejects('SCOPE_EXCEEDED', call('reviewer', studyRun));
  assert.match((await ready(studyRun))[0]!, /study assignments/);
  // Owner only: an editor cannot send build-role requests.
  const editor = { actorId: randomUUID() };
  await store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'editor',
  });
  await store.addMember(owner, ws.id, editor.actorId, 'editor');
  await rejects(
    'ACCESS_DENIED',
    service.buildRole(editor, ws.id, conn.id, {
      role: 'reviewer',
      model_id: 'm',
      run_id: live,
      build_id: randomUUID(),
      data_class: 'synthetic',
      input: '{"candidate":"x"}',
      timeout_ms: 120000,
      logical_operation_id: randomUUID(),
    }),
  );
  assert.match(
    (await ready(live, editor)).join(' '),
    /Only the workspace owner/,
  );
  const before = s.fake.responseRequests.length;
  // A build with no recorded approval is refused before anything is sent.
  await rejects(
    'ACCESS_DENIED',
    call('reviewer', live),
    /no recorded approval/,
  );
  assert.equal(s.fake.responseRequests.length, before, 'nothing was sent');
  // The approval: one product.commit_build admission of the frozen target, recorded with the
  // build's limits. Without a covering grant the person is asked and nothing is recorded.
  const idea = await store.createEntity(owner, ws.id, {
    kind: 'idea',
    title: 'Synthetic idea',
    body: { summary: 'Synthetic.', uncertainty: 'Synthetic.' },
  });
  const target = await store.createEntity(owner, ws.id, {
    kind: 'product',
    title: 'Synthetic product',
    body: { stage: 'captured', summary: 'Synthetic.' },
  });
  const review = await store.createEntity(owner, ws.id, {
    kind: 'humility_review',
    title: 'Synthetic humility review',
    body: fixtureHumilityReview({ id: target.id, version: 1 }, [
      { id: idea.id, version: 1 },
    ]),
  });
  const approve = (run_id: string, over: Record<string, unknown> = {}) =>
    store.admitBuild(owner, ws.id, run_id, {
      build_id: randomUUID(),
      product_id: randomUUID(),
      task_id: randomUUID(),
      spec: { id: target.id, version: 1 },
      spec_hash: 'a'.repeat(64),
      plan_hash: 'b'.repeat(64),
      route: 'plan_roles',
      connection_id: conn.id,
      model_id: 'm',
      data_class: 'synthetic',
      humility_review: { id: review.id, version: 1 },
      request_limit: 2,
      max_repairs: 0,
      expires_at: new Date(Date.now() + 600_000).toISOString(),
      ...over,
    });
  const asked = await approve(live);
  assert.equal(asked.admission.verdict, 'request_human');
  assert.equal(asked.approval, null);
  const decision = await store.getDecision(
    owner,
    ws.id,
    asked.admission.decision_id!,
  );
  // The studio states what the one approval covers; the caller cannot word it.
  assert.equal(
    decision.options.find((o) => o.id === 'approve')!.consequence,
    `One approval covers this whole build (builder and reviewer on the ChatGPT plan via connection "${conn.label}" (${conn.id.slice(0, 8)}) with model m): its repair rounds and builder and reviewer requests, up to 0 repair rounds and 2 requests (never more than 2 and 6).`,
  );
  // Review M-1: a one-time approval admits only a build within the scope it showed. A build
  // with another route or more requests or repair rounds is not covered by it: it asks for
  // its own approval, and the approval stays unused for the build it describes.
  await store.answerDecision(owner, ws.id, decision.id, {
    choice: 'approve_once',
    option_id: null,
    rationale: 'Synthetic: this one build.',
    coverage_hash: decision.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: 1000,
    interruption: 'useful',
  });
  for (const over of [
    { route: 'broker', connection_id: null, model_id: null },
    { request_limit: 4 },
    { max_repairs: 1 },
    { model_id: 'other' },
  ]) {
    const wider = await approve(live, over);
    assert.equal(
      wider.admission.verdict,
      'request_human',
      JSON.stringify(over),
    );
    assert.notEqual(wider.admission.decision_id, decision.id);
  }
  // No build approval outlives a day, whatever deadline the build states.
  await rejects(
    'INVALID_CONTRACT',
    approve(live, {
      expires_at: new Date(Date.now() + 365 * 86_400_000).toISOString(),
    }),
  );
  const once = await approve(live);
  assert.ok(once.approval, JSON.stringify(once.admission));
  assert.equal(once.approval.decision_id, decision.id);
  assert.equal(once.approval.request_limit, 2);
  // Used once: the next build asks again.
  assert.equal((await approve(live)).admission.verdict, 'request_human');
  const commitGrant = await store.createStandingGrant(owner, ws.id, {
    run_id: live,
    action_types: ['product.commit_build'],
    target_kind: null,
    max_amount_nano_usd: null,
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 3600_000).toISOString(),
    rationale: 'Synthetic builds of this run.',
  });
  const { approval } = await approve(live);
  assert.ok(approval);
  assert.equal(approval.request_limit, 2);
  await rejects('DUPLICATE', approve(live, { build_id: approval.id }));
  const r = await call('reviewer', live, approval.id);
  assert.equal(r.status, 'succeeded');
  assert.equal(r.text, APPROVE);
  assert.equal(r.fixture, true);
  assert.equal(s.fake.responseRequests.length, before + 1);
  assert.equal(
    s.fake.responseRequests.at(-1)!.body.instructions,
    BUILD_ROLE_PROMPTS.reviewer,
    'the role prompt is fixed by the studio, not the caller',
  );
  assert.equal((await call('reviewer', live, approval.id)).status, 'succeeded');
  // The stated request limit is the ceiling: a third request is refused unsent.
  const atLimit = s.fake.responseRequests.length;
  await rejects(
    'ACCESS_DENIED',
    call('reviewer', live, approval.id),
    /approved request limit \(2\) is reached/,
  );
  assert.equal(s.fake.responseRequests.length, atLimit, 'nothing was sent');
  const { rows: ledger } = await s.db.pool.query(
    'select count(*)::int as n from plan_requests where build_id = $1',
    [approval.id],
  );
  assert.equal(ledger[0].n, 2);
  // An approval covers only its own run, route, model and data class.
  const other = await entity('human_in_loop', 'human_in_loop');
  await rejects(
    'ACCESS_DENIED',
    call('reviewer', other, approval.id),
    /different run/,
  );
  const broker = await approve(live, {
    route: 'broker',
    connection_id: null,
    model_id: null,
  });
  await rejects(
    'ACCESS_DENIED',
    call('reviewer', live, broker.approval!.id),
    /different route, connection or model/,
  );
  // Revoking the grant behind an approval stops the rest of that build.
  const second = (await approve(live)).approval!;
  const third = (await approve(live)).approval!;
  // Review L-3: each request also checks the approval's deadline, its creator and that its
  // humility review is unchanged.
  const brief = (
    await approve(live, {
      expires_at: new Date(Date.now() + 1500).toISOString(),
    })
  ).approval!;
  await new Promise((done) => setTimeout(done, 1700));
  await rejects(
    'ACCESS_DENIED',
    call('reviewer', live, brief.id),
    /ended at the build deadline/,
  );
  await rejects(
    'ACCESS_DENIED',
    service.buildRole(owner, ws.id, conn.id, {
      role: 'reviewer',
      model_id: 'm',
      run_id: live,
      build_id: third.id,
      data_class: 'public',
      input: '{"candidate":"x"}',
      timeout_ms: 120000,
      logical_operation_id: randomUUID(),
    }),
    /different data class/,
  );
  const coOwner = { actorId: randomUUID() };
  await store.ensureActor({
    id: coOwner.actorId,
    kind: 'human',
    display_name: 'co-owner',
  });
  await store.addMember(owner, ws.id, coOwner.actorId, 'owner');
  await rejects(
    'ACCESS_DENIED',
    service.buildRole(coOwner, ws.id, conn.id, {
      role: 'reviewer',
      model_id: 'm',
      run_id: live,
      build_id: third.id,
      data_class: 'synthetic',
      input: '{"candidate":"x"}',
      timeout_ms: 120000,
      logical_operation_id: randomUUID(),
    }),
    /Only the owner whose build was approved/,
  );
  assert.equal(s.fake.responseRequests.length, atLimit, 'nothing was sent');
  await store.revokeGrant(owner, ws.id, commitGrant.id, {
    expected_version: commitGrant.version,
    reason: 'Stop synthetic builds.',
  });
  await rejects(
    'ACCESS_DENIED',
    call('reviewer', live, second.id),
    /revoked, changed or has expired/,
  );
  assert.equal(s.fake.responseRequests.length, atLimit, 'nothing was sent');
  await store.reviseEntity(owner, ws.id, review.id, {
    expected_version: 1,
    title: 'Synthetic humility review',
    body: {
      ...fixtureHumilityReview({ id: target.id, version: 1 }, [
        { id: idea.id, version: 1 },
      ]),
      rationale: 'Revised after the approval.',
    },
    reason: 'Synthetic revision',
    corrects_version: null,
  });
  await rejects(
    'ACCESS_DENIED',
    call('reviewer', live, third.id),
    /humility review behind this build changed/,
  );
  // F11: the preflight refuses a run without room for both roles on this connection.
  const room = conn.settings.caps.responses.max_requests_per_run;
  const used = (
    await s.db.pool.query(
      "select count(*)::int as n from plan_requests where run_id = $1 and path = 'responses'",
      [live],
    )
  ).rows[0].n as number;
  for (let i = used; i < room - 1; i++)
    await s.db.pool.query(
      `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose, model_id,
         task_class, data_class, run_id, state, created_by, started_at)
       values ($1,$2,$3,'responses','task','m','independent_review','synthetic',$4,'completed',$5,
         now() - interval '2 days')`,
      [randomUUID(), conn.id, randomUUID(), live, owner.actorId],
    );
  assert.match(
    (await ready(live)).join(' '),
    /room for 1 more plan request on this connection; a build needs at least 2/,
  );
  // A qualification decided on an older reviewer prompt no longer admits the current one.
  const { rows } = await s.db.pool.query(
    "select id, manifest from plan_qualifications where connection_id = $1 and task_class = 'independent_review' and state = 'qualified'",
    [conn.id],
  );
  const older = rows[0].manifest;
  for (const k of older.cases)
    k.input[0].text = 'independent-reviewer/1: an earlier contract.';
  await s.db.pool.query(
    'update plan_qualifications set manifest = $2, manifest_hash = $3 where id = $1',
    [rows[0].id, older, canonicalHash(older)],
  );
  const sentBefore = s.fake.responseRequests.length;
  const historical = (
    await store.planConnectionDetail(owner, ws.id, conn.id)
  ).qualifications.find((x) => x.id === rows[0].id)!;
  assert.equal(
    historical.state,
    'qualified',
    'the recorded grade is preserved',
  );
  assert.equal(
    historical.prompt_current,
    false,
    'the UI receives the same prompt eligibility that admission enforces',
  );
  await rejects('ACCESS_DENIED', call('reviewer', live));
  assert.equal(s.fake.responseRequests.length, sentBefore, 'nothing was sent');
  assert.ok(
    (await ready(live)).includes(
      'Model m is not qualified for independent_review (the T12 reviewer) under its current prompt.',
    ),
  );
  await store.cancelRun(owner, ws.id, live, { reason: 'stop' });
  await rejects('INVALID_TRANSITION', call('reviewer', live));
});

test('a one-time build approval goes only to a build it covers, preferring the exact one, never blocking others', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ws } = s;
  const conn = await s.current();
  const second = await store.createPlanConnection(owner, ws.id, {
    label: 'Second plan',
    settings: SETTINGS,
  });
  const r = await store.createEntity(owner, ws.id, {
    kind: 'run',
    title: 'Live run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const run = (
    await store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    })
  ).run_id;
  const idea = await store.createEntity(owner, ws.id, {
    kind: 'idea',
    title: 'Synthetic idea',
    body: { summary: 'Synthetic.', uncertainty: 'Synthetic.' },
  });
  const target = await store.createEntity(owner, ws.id, {
    kind: 'product',
    title: 'Synthetic product',
    body: { stage: 'captured', summary: 'Synthetic.' },
  });
  const review = await store.createEntity(owner, ws.id, {
    kind: 'humility_review',
    title: 'Synthetic humility review',
    body: fixtureHumilityReview({ id: target.id, version: 1 }, [
      { id: idea.id, version: 1 },
    ]),
  });
  const build = (over: Record<string, unknown> = {}) => ({
    build_id: randomUUID(),
    product_id: randomUUID(),
    task_id: randomUUID(),
    spec: { id: target.id, version: 1 },
    spec_hash: 'a'.repeat(64),
    plan_hash: 'b'.repeat(64),
    route: 'plan_roles',
    connection_id: conn.id,
    model_id: 'm',
    data_class: 'synthetic',
    humility_review: { id: review.id, version: 1 },
    request_limit: 2,
    max_repairs: 0,
    expires_at: new Date(Date.now() + 600_000).toISOString(),
    ...over,
  });
  const approve = (over: Record<string, unknown> = {}) =>
    store.admitBuild(owner, ws.id, run, build(over));
  const approveOnce = async (decisionId: string) => {
    const d = await store.getDecision(owner, ws.id, decisionId);
    await store.answerDecision(owner, ws.id, d.id, {
      choice: 'approve_once',
      option_id: null,
      rationale: 'Synthetic: one build.',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: 1000,
      interruption: 'useful',
    });
    return (await store.listGrants(owner, ws.id)).find(
      (g) => g.decision_id === decisionId,
    )!.id;
  };
  const status = async (grantId: string) =>
    (await store.listGrants(owner, ws.id)).find((g) => g.id === grantId)!
      .status;
  const asks = async (over: Record<string, unknown> = {}) => {
    const a = await approve(over);
    assert.equal(a.admission.verdict, 'request_human', JSON.stringify(over));
    assert.equal(a.approval, null);
    return a.admission.decision_id!;
  };

  // A one-time approval nobody's build asked for (a generic admission's decision) does not
  // say what a build may do: the build asks for its own, and that grant stays unused.
  const generic = await store.admitAction(owner, ws.id, run, {
    action_type: 'product.commit_build',
    task_id: null,
    target: { id: target.id, version: 1 },
    spec_hash: 'a'.repeat(64),
    amount_nano_usd: null,
    data_class: 'synthetic',
    assumption_ids: [],
    humility_review: { id: review.id, version: 1 },
    flags: [],
    justification: 'Synthetic generic admission.',
  });
  assert.equal(generic.verdict, 'request_human');
  const genericGrant = await approveOnce(generic.decision_id!);
  const d1 = await asks();
  assert.notEqual(d1, generic.decision_id);
  assert.equal(await status(genericGrant), 'active');

  // Review L-B: the connection and the model are part of what the person approves, so a build
  // on another connection with the same model, or another route, asks separately and never
  // uses an approval it does not match.
  const onSecond = await asks({ connection_id: second.id });
  assert.notEqual(onSecond, d1);
  assert.match(
    (await store.getDecision(owner, ws.id, onSecond)).options.find(
      (o) => o.id === 'approve',
    )!.consequence,
    /connection "Second plan"/,
  );
  const brokerAsk = await asks({
    route: 'broker',
    connection_id: null,
    model_id: null,
  });
  const gBroker = await approveOnce(brokerAsk);
  await asks({ route: 'codex_plan', connection_id: null, model_id: null });
  assert.equal(await status(gBroker), 'active');

  // Review L-A: two approvals for two builds of one spec each go to their own build, whatever
  // order the person answered them in (here the wider one first).
  const wide = { request_limit: 6, max_repairs: 2 };
  const d2 = await asks(wide);
  assert.notEqual(d2, d1);
  const g2 = await approveOnce(d2);
  const g1 = await approveOnce(d1);
  assert.equal(await asks({ connection_id: second.id }), onSecond);
  assert.notEqual(await asks({ model_id: 'other' }), d1);
  const narrow = await approve();
  assert.equal(narrow.approval?.decision_id, d1, 'the exact approval is used');
  assert.equal(await status(g1), 'consumed');
  assert.equal(await status(g2), 'active');
  const big = await approve(wide);
  assert.equal(big.approval?.decision_id, d2);
  assert.equal(big.approval?.request_limit, 6);

  // A standing grant is not shadowed by unused one-time approvals of other builds. Its
  // approval ends when the grant ends, if that is before the build deadline.
  const standingEnds = new Date(Date.now() + 300_000);
  const standing = await store.createStandingGrant(owner, ws.id, {
    run_id: run,
    action_types: ['product.commit_build'],
    target_kind: null,
    max_amount_nano_usd: null,
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: standingEnds.toISOString(),
    rationale: 'Synthetic builds of this run.',
  });
  for (const over of [
    wide,
    { route: 'codex_plan', connection_id: null, model_id: null },
    { connection_id: second.id },
  ]) {
    const a = await approve(over);
    assert.equal(a.approval?.grant_id, standing.id, JSON.stringify(over));
    assert.equal(
      Date.parse(a.approval.expires_at),
      standingEnds.getTime(),
      'clamped to the grant',
    );
  }
  assert.equal(await status(genericGrant), 'active');
  // The matching leftover one-time approval is still taken by the build it describes.
  const broker = await approve({
    route: 'broker',
    connection_id: null,
    model_id: null,
  });
  assert.equal(broker.approval?.decision_id, brokerAsk);
  assert.equal(await status(gBroker), 'consumed');

  // Two starts of one build racing: exactly one approval, the others are duplicates.
  const racing = build();
  const results = await Promise.allSettled(
    [0, 1, 2, 3].map(() => store.admitBuild(owner, ws.id, run, racing)),
  );
  assert.equal(results.filter((x) => x.status === 'fulfilled').length, 1);
  for (const x of results)
    if (x.status === 'rejected') {
      assert.ok(x.reason instanceof ContractError, String(x.reason));
      assert.equal(x.reason.code, 'DUPLICATE');
    }
});

test('a patch-build qualification is graded by the studio scorer, and a scorer crash never wedges the connection', async (t) => {
  const s = await setup(t, {
    responses: [
      { kind: 'text', text: 'ok' },
      { kind: 'text', text: '{}' },
    ],
  });
  if (!s) return;
  const { store, ws } = s;
  await s.signIn();
  let conn = await s.ready();
  conn = await store.updatePlanSettings(owner, ws.id, conn.id, {
    expected_version: conn.version,
    settings: {
      ...conn.settings,
      allowed_task_classes: [
        // ADR-0084: the proposal may already allow these.
        ...new Set([...conn.settings.allowed_task_classes, 'patch_build']),
      ],
    },
  });
  conn = await store.acceptPlanCaps(owner, ws.id, conn.id, {
    expected_version: conn.version,
    settings_hash: conn.settings_hash,
  });
  const grant = await store.createPlanVerificationGrant(owner, ws.id, conn.id, {
    expected_version: conn.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  await s.service.verifyModel(owner, ws.id, conn.id, {
    id: grant.id,
    model_id: 'm',
  });
  const manifest = {
    ...reviewManifest(BUILD_ROLE_PROMPTS.builder),
    task_class: 'patch_build',
    cases: reviewManifest(BUILD_ROLE_PROMPTS.builder).cases.map((c) => ({
      ...c,
      check: {
        kind: 'patch_cases',
        file_scope: ['src'],
        cases: [
          { check_key: 'A1', args: [], stdin: '', stdout: '', exit_code: 0 },
        ],
      },
    })),
  };
  const withScorer = (
    scorer: () => Promise<string | { signal: string; detail: string | null }>,
  ) =>
    new PlanConnectionService({
      store,
      vault: s.vault,
      fixtureEndpoints: {
        auth_base: s.fake.auth_base,
        api_base: s.fake.api_base,
      },
      openBrowser: () => {},
      callbackPort: 0,
      patchScorer: scorer,
    });
  const start = async () =>
    store.startPlanQualification(owner, ws.id, conn.id, {
      expected_version: (await s.current()).version,
      model_id: 'm',
      manifest,
      min_held_out_cases: 3,
      floor: { numerator: 3, denominator: 3 },
    });
  const crashedQ = await start();
  const crashed = await withScorer(async () => {
    throw new Error('scorer crashed');
  }).runQualification(owner, ws.id, crashedQ.id);
  // The grader's own failure is recorded, so it is not mistaken for the model's.
  const reasons = await s.db.pool.query(
    'select signal, reason_code, output_text from plan_requests where qualification_id = $1',
    [crashedQ.id],
  );
  assert.equal(reasons.rows.length, 4);
  for (const r of reasons.rows) {
    assert.equal(r.signal, 'provider_error');
    assert.equal(r.reason_code, 'grader_error: scorer crashed');
    // A synthetic qualification answer is kept, so a failed case can be explained.
    assert.equal(r.output_text, '{}');
  }
  const verification = await s.db.pool.query(
    "select output_text from plan_requests where purpose = 'verification'",
  );
  assert.deepEqual(
    verification.rows.map((r) => r.output_text),
    [null],
    'other answers are still not kept',
  );
  assert.equal(
    crashed.state === 'decided' && crashed.qualification.state,
    'failed',
  );
  let d = await store.planConnectionDetail(owner, ws.id, conn.id);
  assert.equal(d.usage.in_flight, 0);
  assert.equal(d.usage.unresolved, 0);
  const graded: string[] = [];
  const ok = await withScorer(async () => {
    graded.push('case');
    return 'accepted';
  }).runQualification(owner, ws.id, (await start()).id);
  assert.equal(ok.state === 'decided' && ok.qualification.state, 'qualified');
  assert.equal(graded.length, 4, 'every case went through the scorer');
  d = await store.planConnectionDetail(owner, ws.id, conn.id);
  assert.equal(d.usage.in_flight, 0);
  // F10: the grader's reason and the model's answer are readable per case, in manifest order.
  const explained = await withScorer(async () => ({
    signal: 'acceptance_check_failed',
    detail: 'Check A1 failed: exit code 1, expected 0; output did not match.',
  })).runQualification(owner, ws.id, (await start()).id);
  assert.ok(explained.state === 'decided');
  const results = await store.planQualificationResults(
    owner,
    ws.id,
    explained.qualification.id,
  );
  assert.equal(results.qualification.state, 'failed');
  assert.deepEqual(
    results.cases.map((c) => [c.case_id, c.split]),
    manifest.cases.map((c) => [c.case_id, c.split]),
  );
  for (const c of results.cases) {
    assert.equal(c.state, 'completed');
    assert.equal(c.signal, 'acceptance_check_failed');
    assert.equal(
      c.reason,
      'Check A1 failed: exit code 1, expected 0; output did not match.',
    );
    assert.equal(c.answer, '{}');
  }
  const crashedResults = await store.planQualificationResults(
    owner,
    ws.id,
    crashedQ.id,
  );
  assert.equal(crashedResults.cases[0]!.reason, 'grader_error: scorer crashed');
  // Another workspace cannot read them.
  const other = await store.createWorkspace(owner, {
    name: 'Other',
    record_mode: 'fixture',
  });
  await assert.rejects(
    store.planQualificationResults(owner, other.id, crashedQ.id),
    /not found/i,
  );
});

test('PR #130 review L-1: a revised discovery role keeps the held-out case keys and changes the prompt', () => {
  const m = read(
    'config/connections/benchmarks/discovery-synthetic-v2/scoring.json',
  ) as { cases: ManifestCase[] };
  const revised = m.cases.map((k) => {
    const check = k.check as { context: { role_version: string } };
    return {
      ...k,
      input: k.input.map((x) =>
        x.role === 'system'
          ? {
              ...x,
              text: x.text.replace('r02-discovery/1.1', 'r02-discovery/9.9'),
            }
          : x,
      ),
      check: {
        ...check,
        context: { ...check.context, role_version: 'r02-discovery/9.9' },
      },
    };
  });
  assert.ok(heldOutKeys(m.cases).length > 0);
  assert.deepEqual(heldOutKeys(revised), heldOutKeys(m.cases));
  assert.notEqual(promptHash(revised), promptHash(m.cases));
});
