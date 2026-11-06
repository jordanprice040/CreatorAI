import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import {
  parse,
  AdmissionSchema,
  DecisionSchema,
  RunControlSchema,
  SessionInfoSchema,
  StoredEntitySchema,
  WorkspaceSchema,
} from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { listen, oidcSignIn, testIdp } from './oidc-idp.js';

test('owner sessions: sign-in, HttpOnly cookie, CSRF, origin checks, logout and the decision API', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
  });
  const port = await listen(api.server);
  t.after(api.close);
  const base = `http://127.0.0.1:${port}/api`;
  await api.ready();

  const anonymous = await fetch(`${base}/workspaces`);
  assert.equal(anonymous.status, 401);
  assert.equal((await anonymous.json()).error.code, 'UNAUTHENTICATED');
  const wrong = await fetch(`${base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: 'x'.repeat(40) }),
  });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.headers.getSetCookie().length, 0);
  const raw = await fetch(`${base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: LOGIN_CODE }),
  });
  const cookie = raw.headers.getSetCookie()[0] ?? '';
  assert.match(
    cookie,
    /^creator_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Strict; Max-Age=\d+$/,
  );
  const auth = await login(base);

  const body = JSON.stringify({ name: 'Decisions', record_mode: 'fixture' });
  const json = { 'Content-Type': 'application/json' };
  const noCsrf = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { ...json, ...auth.read },
    body,
  });
  assert.equal(noCsrf.status, 403);
  assert.equal((await noCsrf.json()).error.code, 'CSRF_DENIED');
  const otherCsrf = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { ...json, Cookie: auth.cookie, 'X-CSRF-Token': 'A'.repeat(43) },
    body,
  });
  assert.equal(otherCsrf.status, 403);
  const foreign = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { ...json, ...auth.write, Origin: 'http://evil.example' },
    body,
  });
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.json()).error.code, 'ORIGIN_DENIED');

  const post = async (path: string, value: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { ...json, ...auth.write },
      body: JSON.stringify(value),
    });
    const data: unknown = await r.json();
    if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(data)}`);
    return data;
  };
  const get = async (path: string) =>
    (await fetch(`${base}/${path}`, { headers: auth.read })).json();
  const ws = parse(
    WorkspaceSchema,
    await post('workspaces', { name: 'Decisions', record_mode: 'fixture' }),
  );
  const runRecord = parse(
    StoredEntitySchema,
    await post(`workspaces/${ws.id}/entities`, {
      kind: 'run',
      title: 'Supervised run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    }),
  );
  const run = parse(
    RunControlSchema,
    await post(`workspaces/${ws.id}/runs`, {
      run: { id: runRecord.id, version: 1 },
      autonomy_mode: 'supervised',
      stage_gates: null,
      initial_grants: [],
    }),
  );
  assert.deepEqual(run.stage_gates, [
    'candidate.select',
    'spec.freeze',
    'product.commit_build',
    'release.publish',
  ]);
  const action = {
    action_type: 'tool.search_public',
    task_id: null,
    target: null,
    spec_hash: null,
    amount_nano_usd: null,
    data_class: 'public',
    assumption_ids: [],
    humility_review: null,
    flags: [],
    justification: 'Look up public scheduling tools.',
  };
  const asked = parse(
    AdmissionSchema,
    await post(`workspaces/${ws.id}/runs/${run.run_id}/actions`, action),
  );
  assert.equal(asked.outcome, 'waiting_human');
  const decision = parse(
    DecisionSchema,
    await get(`workspaces/${ws.id}/decisions/${asked.decision_id}`),
  );
  // The person must approve exactly the coverage they were shown.
  const answer = {
    choice: 'approve_once',
    option_id: null,
    rationale: 'Public search is fine.',
    coverage_hash: '0'.repeat(64),
    standing_expires_at: null,
    time_spent_ms: 4000,
    interruption: 'useful',
  };
  const mismatch = await fetch(
    `${base}/workspaces/${ws.id}/decisions/${decision.id}/answer`,
    {
      method: 'POST',
      headers: { ...json, ...auth.write },
      body: JSON.stringify(answer),
    },
  );
  assert.equal(mismatch.status, 409);
  await post(`workspaces/${ws.id}/decisions/${decision.id}/answer`, {
    ...answer,
    coverage_hash: decision.coverage.coverage_hash,
  });
  const admitted = parse(
    AdmissionSchema,
    await post(`workspaces/${ws.id}/runs/${run.run_id}/actions`, action),
  );
  assert.equal(admitted.verdict, 'allow');

  parse(SessionInfoSchema, await get('auth/session'));
  await post('auth/logout', {});
  assert.equal(
    (await fetch(`${base}/auth/session`, { headers: auth.read })).status,
    401,
  );
  assert.equal(
    (await fetch(`${base}/workspaces`, { headers: auth.read })).status,
    401,
  );
});

test('OIDC sign-in with authorization code + PKCE admits only the configured owner, once per attempt', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const idp = await testIdp();
  t.after(idp.close);
  const issuer = idp.state.issuer;

  // The API's port must be known for the redirect URI, so reserve it first.
  const probe = createServer();
  const apiPort = await listen(probe);
  await new Promise<void>((r) => probe.close(() => r()));
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_OIDC_ISSUER: issuer,
    CREATOR_OIDC_CLIENT_ID: 'creator-local',
    CREATOR_OIDC_REDIRECT_URI: `http://127.0.0.1:${apiPort}/api/auth/oidc/callback`,
    CREATOR_OIDC_OWNER_SUBJECT: 'owner-subject',
    CREATOR_WEB_ORIGIN: 'http://127.0.0.1:5173',
  });
  api.server.listen(apiPort, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const base = `http://127.0.0.1:${apiPort}/api`;
  assert.equal(
    (
      await fetch(`${base}/auth/dev-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: LOGIN_CODE }),
      })
    ).status,
    404,
  );

  async function signIn() {
    const out = await oidcSignIn(base);
    assert.equal(
      out.authorize.searchParams.get('code_challenge_method'),
      'S256',
    );
    return out;
  }
  const ok = await signIn();
  assert.equal(ok.response.status, 302);
  assert.equal(ok.response.headers.get('location'), 'http://127.0.0.1:5173/');
  const cookie = ok.response.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  const session = parse(
    SessionInfoSchema,
    await (
      await fetch(`${base}/auth/session`, { headers: { Cookie: cookie } })
    ).json(),
  );
  assert.equal(session.method, 'oidc');
  // Replaying the same callback fails: the attempt was single use.
  assert.equal((await fetch(ok.callback, { redirect: 'manual' })).status, 401);
  idp.state.subject = 'someone-else';
  const other = await signIn();
  assert.equal(other.response.status, 403);
  assert.equal(other.response.headers.getSetCookie().length, 0);
  // A forged state never reaches the identity provider's token endpoint.
  const forged = new URL(ok.callback);
  forged.searchParams.set('state', 'forged');
  assert.equal((await fetch(forged, { redirect: 'manual' })).status, 401);
  // Plain HTTP to a non-loopback issuer is refused at configuration time.
  assert.throws(() =>
    createApi({
      CREATOR_OIDC_ISSUER: 'http://id.example.org',
      CREATOR_OIDC_CLIENT_ID: 'x',
      CREATOR_OIDC_REDIRECT_URI: 'http://127.0.0.1:1/api/auth/oidc/callback',
      CREATOR_OIDC_OWNER_SUBJECT: 'x',
    }),
  );
});
