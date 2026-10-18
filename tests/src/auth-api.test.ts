import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
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

async function listen(server: Server): Promise<number> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return address.port;
}

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
  // A minimal local identity provider for the test; signing uses jose, not our own crypto.
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = {
    ...(await exportJWK(publicKey)),
    kid: 'test-key',
    alg: 'RS256',
    use: 'sig',
  };
  const codes = new Map<
    string,
    { challenge: string; nonce: string; sub: string }
  >();
  let subject = 'owner-subject';
  let issuer = '';
  const idp = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer);
    const send = (status: number, value: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(value));
    };
    if (url.pathname === '/.well-known/openid-configuration')
      return send(200, {
        issuer,
        authorization_endpoint: `${issuer}/authorize`,
        token_endpoint: `${issuer}/token`,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        id_token_signing_alg_values_supported: ['RS256'],
        code_challenge_methods_supported: ['S256'],
        token_endpoint_auth_methods_supported: ['none'],
      });
    if (url.pathname === '/jwks') return send(200, { keys: [jwk] });
    if (url.pathname === '/authorize') {
      const code = randomUUID();
      codes.set(code, {
        challenge: url.searchParams.get('code_challenge') ?? '',
        nonce: url.searchParams.get('nonce') ?? '',
        sub: subject,
      });
      const back = new URL(url.searchParams.get('redirect_uri') ?? '');
      back.searchParams.set('code', code);
      back.searchParams.set('state', url.searchParams.get('state') ?? '');
      res.writeHead(302, { Location: back.href });
      return res.end();
    }
    if (url.pathname === '/token') {
      let raw = '';
      req.on('data', (c: Buffer) => (raw += c.toString()));
      req.on('end', () => {
        void (async () => {
          const form = new URLSearchParams(raw);
          const grant = codes.get(form.get('code') ?? '');
          codes.delete(form.get('code') ?? '');
          const verifier = form.get('code_verifier') ?? '';
          if (
            !grant ||
            createHash('sha256').update(verifier).digest('base64url') !==
              grant.challenge
          )
            return send(400, { error: 'invalid_grant' });
          const id_token = await new SignJWT({ nonce: grant.nonce })
            .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
            .setIssuer(issuer)
            .setAudience('creator-local')
            .setSubject(grant.sub)
            .setIssuedAt()
            .setExpirationTime('5m')
            .sign(privateKey);
          send(200, {
            access_token: randomUUID(),
            token_type: 'Bearer',
            expires_in: 300,
            id_token,
          });
        })();
      });
      return;
    }
    send(404, {});
  });
  const idpPort = await listen(idp);
  issuer = `http://127.0.0.1:${idpPort}`;
  t.after(() => new Promise<void>((r) => idp.close(() => r())));

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
    const start = await fetch(`${base}/auth/oidc/login`, {
      redirect: 'manual',
    });
    assert.equal(start.status, 302);
    const authorize = new URL(start.headers.get('location') ?? '');
    assert.equal(authorize.searchParams.get('code_challenge_method'), 'S256');
    const atIdp = await fetch(authorize, { redirect: 'manual' });
    const callback = atIdp.headers.get('location') ?? '';
    return {
      callback,
      response: await fetch(callback, { redirect: 'manual' }),
    };
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
  subject = 'someone-else';
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
