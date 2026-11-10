import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { request } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ContractError, type SmokeReport } from '@creator/contracts';
import {
  AlertRulesSchema,
  deploymentConfig,
  deploymentConfigHash,
  evaluateAlerts,
  liveConfirmation,
  resolveSecretFiles,
  smokeCheck,
} from '@creator/domain';
import { databaseUrl, OpsStore, OPERATIONS_ACTOR_ID } from '@creator/db';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { freshDatabase, LOGIN_CODE } from './pg-harness.js';

const invalid = (fn: () => unknown, pattern?: RegExp) =>
  assert.throws(
    fn,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === 'INVALID_CONFIG' &&
      (!pattern ||
        pattern.test(`${e.message} ${JSON.stringify(e.details ?? '')}`)),
  );

const COMMIT = 'a'.repeat(40);
const TOKEN = 'metrics-token-0123456789abcdefghijklmnop';
const HOSTED = {
  CREATOR_DEPLOYMENT_MODE: 'hosted',
  CREATOR_ENVIRONMENT: 'staging',
  CREATOR_BUILD_COMMIT: COMMIT,
  CREATOR_PUBLIC_WEB_ORIGIN: 'https://studio.staging.example.test',
  CREATOR_PUBLIC_PREVIEW_ORIGIN: 'https://previews.example-preview.test',
  CREATOR_PRODUCTS_ROOT: '/srv/creator/products',
  CREATOR_METRICS_TOKEN: TOKEN,
};

test('hosted deployment configuration refuses unsafe or incomplete settings', () => {
  const local = deploymentConfig({});
  assert.equal(local.mode, 'local');
  assert.equal(local.environment, 'local');
  invalid(
    () => deploymentConfig({ CREATOR_ENVIRONMENT: 'staging' }),
    /hosted environments/,
  );
  const hosted = deploymentConfig(HOSTED);
  assert.equal(hosted.mode, 'hosted');
  assert.equal(hosted.api_origin, 'https://studio.staging.example.test');
  for (const [key, value, why] of [
    ['CREATOR_ENVIRONMENT', undefined, /environment/],
    ['CREATOR_ENVIRONMENT', 'production', /environment/],
    ['CREATOR_BUILD_COMMIT', 'abc123', /full git SHA/],
    ['CREATOR_PUBLIC_WEB_ORIGIN', 'http://studio.example.test', /web_origin/],
    ['CREATOR_PUBLIC_WEB_ORIGIN', 'https://studio.example.test/app', /bare/],
    [
      'CREATOR_PUBLIC_PREVIEW_ORIGIN',
      'https://studio.staging.example.test',
      /own host/,
    ],
    // A child of the web host could receive a parent-domain cookie.
    [
      'CREATOR_PUBLIC_PREVIEW_ORIGIN',
      'https://p.studio.staging.example.test',
      /own host/,
    ],
    ['CREATOR_PRODUCTS_ROOT', 'relative/products', /absolute/],
    ['CREATOR_METRICS_TOKEN', 'short', /32-200/],
    ['CREATOR_LISTEN_HOST', '10.0.0.5', /listen_host/],
  ] as const)
    invalid(() => deploymentConfig({ ...HOSTED, [key]: value }), why);

  // A remote database is hosted-only, and only with verified TLS.
  const remote = 'postgresql://u:p@db.example.test/creator_staging';
  invalid(() => databaseUrl(remote), /loopback/);
  invalid(() => databaseUrl(remote, 'hosted'), /verify-full/);
  invalid(() => databaseUrl(`${remote}?sslmode=require`, 'hosted'));
  assert.ok(databaseUrl(`${remote}?sslmode=verify-full`, 'hosted'));

  // The verification binding changes with what was deployed, not with secrets.
  const h = deploymentConfigHash(hosted, HOSTED);
  assert.equal(
    deploymentConfigHash(
      deploymentConfig({ ...HOSTED, CREATOR_METRICS_TOKEN: 'z'.repeat(40) }),
      HOSTED,
    ),
    h,
  );
  assert.notEqual(
    deploymentConfigHash(
      deploymentConfig({ ...HOSTED, CREATOR_BUILD_COMMIT: 'b'.repeat(40) }),
      HOSTED,
    ),
    h,
  );
  assert.notEqual(
    deploymentConfigHash(hosted, { ...HOSTED, CREATOR_GITHUB: 'live' }),
    h,
  );
});

test('secret files load into the environment without exposing values', () => {
  const files: Record<string, string> = {
    '/run/secrets/db': 'postgresql://u:hunter2@127.0.0.1/x\n',
    '/run/secrets/empty': '\n',
  };
  const read = (p: string) => {
    const v = files[p];
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  };
  const out = resolveSecretFiles(
    { CREATOR_DATABASE_URL_FILE: '/run/secrets/db', OTHER_FILE: '/x' },
    read,
  );
  assert.equal(out.env.CREATOR_DATABASE_URL, files['/run/secrets/db']!.trim());
  assert.equal(out.env.CREATOR_DATABASE_URL_FILE, undefined);
  assert.equal(out.env.OTHER_FILE, '/x');
  assert.deepEqual(out.from_files, ['CREATOR_DATABASE_URL']);
  // The CLI's sign-in state file is a path the CLI reads and writes, not a secret to load:
  // setting it beside the API or the migrations must not stop them when it does not exist yet.
  const session = resolveSecretFiles(
    { CREATOR_SESSION_FILE: '/not/there/cli-session.json' },
    read,
  );
  assert.equal(session.env.CREATOR_SESSION_FILE, '/not/there/cli-session.json');
  assert.equal(session.env.CREATOR_SESSION, undefined);
  assert.deepEqual(session.from_files, []);
  for (const env of [
    {
      CREATOR_DATABASE_URL: 'postgresql://127.0.0.1/x',
      CREATOR_DATABASE_URL_FILE: '/run/secrets/db',
    },
    { CREATOR_METRICS_TOKEN_FILE: '/run/secrets/empty' },
    { CREATOR_METRICS_TOKEN_FILE: '/run/secrets/missing' },
  ])
    assert.throws(
      () => resolveSecretFiles(env, read),
      (e: unknown) =>
        e instanceof ContractError && !e.message.includes('hunter2'),
    );
});

test('alert rules evaluate locally and report missing data as no_data', () => {
  const rules = AlertRulesSchema.parse({
    version: 't',
    delivery: 'none',
    rules: [
      { id: 'a', metric: 'x', above: 0, severity: 'warning', summary: 'x' },
      { id: 'b', metric: 'y', above: 5, severity: 'info', summary: 'y' },
      { id: 'c', metric: 'z', above: 0, severity: 'critical', summary: 'z' },
    ],
  });
  assert.deepEqual(
    evaluateAlerts(rules, { x: 1, y: 5, z: null }).map((a) => a.state),
    ['firing', 'ok', 'no_data'],
  );
  // External delivery is not a configurable option.
  assert.equal(
    AlertRulesSchema.safeParse({ ...rules, delivery: 'email' }).success,
    false,
  );
});

test('the smoke check refuses plain http off this machine and an environment mismatch', async () => {
  let called = false;
  const remote = await smokeCheck(
    'http://studio.example.test',
    'staging',
    (async () => {
      called = true;
      throw new Error('no network');
    }) as typeof fetch,
  );
  assert.equal(remote.passed, false);
  assert.equal(called, false);
  assert.equal(remote.checks[0]!.name, 'target');
  const ready = {
    ready: true,
    mode: 'local',
    environment: 'local',
    build_commit: null,
    config_hash: 'c'.repeat(64),
    schema_version: 18,
    verification: 'unverified',
    checks: [],
    public_origins: null,
  };
  const fake = (async (u: URL) => {
    const body =
      u.pathname === '/api/ready'
        ? ready
        : u.pathname === '/api/health'
          ? { status: 'ok' }
          : { error: {} };
    return new Response(JSON.stringify(body), {
      status: u.pathname === '/api/ops/status' ? 401 : 200,
      headers: {
        'cache-control': 'no-store',
        'x-content-type-options': 'nosniff',
      },
    });
  }) as unknown as typeof fetch;
  const ok = await smokeCheck('http://127.0.0.1:9', 'local', fake);
  assert.equal(ok.passed, true, JSON.stringify(ok.checks));
  const wrong = await smokeCheck('http://127.0.0.1:9', 'staging', fake);
  assert.equal(wrong.passed, false);
  assert.equal(wrong.checks.find((c) => c.name === 'environment')!.ok, false);
});

test('a paired worker accepts a hosted control origin only when asked, and only over https', async () => {
  const worker = (await import(
    new URL('../../apps/desktop/worker.mjs', import.meta.url).href
  )) as {
    workerClient(origin: string, o?: { hosted?: boolean }): unknown;
  };
  assert.throws(() => worker.workerClient('https://studio.example.test'));
  assert.ok(
    worker.workerClient('https://studio.example.test', { hosted: true }),
  );
  for (const origin of [
    'http://studio.example.test',
    'https://user:pw@studio.example.test',
    'https://studio.example.test/api',
  ])
    assert.throws(() => worker.workerClient(origin, { hosted: true }));
});

// ---- PostgreSQL-backed checks. Hosted processes run on loopback; requests carry the public
// Host header, standing in for the TLS proxy in front of a real deployment.

type Reply = { status: number; headers: Headers; text: string; json: any };
function call(
  port: number,
  path: string,
  o: {
    host?: string;
    method?: string;
    headers?: Record<string, string>;
    body?: unknown;
  } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const body = o.body === undefined ? undefined : JSON.stringify(o.body);
    const req = request(
      {
        host: '127.0.0.1',
        port,
        path,
        method: o.method ?? (body ? 'POST' : 'GET'),
        headers: {
          Host: o.host ?? `127.0.0.1:${port}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...o.headers,
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json: unknown = null;
          try {
            json = JSON.parse(text);
          } catch {
            json = null;
          }
          const headers = new Headers();
          for (const [k, v] of Object.entries(res.headers))
            if (typeof v === 'string') headers.set(k, v);
          resolve({ status: res.statusCode ?? 0, headers, text, json });
        });
      },
    );
    req.on('error', reject);
    req.end(body);
  });
}
/** fetch() that reaches the loopback API with the public Host header (the TLS proxy's job). */
function viaProxy(port: number): typeof fetch {
  return (async (input: URL | string) => {
    const u = new URL(String(input));
    const r = await call(port, u.pathname, { host: u.host });
    return new Response(r.text, { status: r.status, headers: r.headers });
  }) as typeof fetch;
}

async function hostedApi(
  t: test.TestContext,
  url: string,
  overrides: Record<string, string> = {},
) {
  const dir = await mkdtemp(join(tmpdir(), 'creator-x06-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const secret = join(dir, 'database-url');
  await writeFile(secret, `${url}\n`, { mode: 0o600 });
  const env = {
    ...HOSTED,
    CREATOR_PRODUCTS_ROOT: join(dir, 'products'),
    CREATOR_DATABASE_URL_FILE: secret,
    CREATOR_AUTH_MODE: 'oidc',
    CREATOR_OIDC_ISSUER: 'https://id.example.test',
    CREATOR_OIDC_CLIENT_ID: 'creator-staging',
    CREATOR_OIDC_REDIRECT_URI:
      'https://studio.staging.example.test/api/auth/oidc/callback',
    CREATOR_OIDC_OWNER_SUBJECT: 'owner-subject',
    CREATOR_WEB_ORIGIN: HOSTED.CREATOR_PUBLIC_WEB_ORIGIN,
    CREATOR_WORKER: 'off',
    ...overrides,
  };
  const api = createApi(env);
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  await api.ready().catch(() => undefined);
  const port = (api.server.address() as { port: number }).port;
  const host = new URL(env.CREATOR_PUBLIC_WEB_ORIGIN).host;
  // Stands in for a completed OIDC sign-in by the configured owner (OIDC itself is T03's).
  const { token, session } = await api.store!.createSession(
    DEFAULT_OWNER_ACTOR_ID,
    'oidc',
    'owner-subject',
    1,
  );
  const owner = {
    Cookie: `__Host-creator_session=${token}`,
    'X-CSRF-Token': session.csrf_token,
  };
  return { api, port, host, owner, env };
}

test('a hosted staging deployment checks readiness, protects operations, and binds verification to the exact build', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const { api, port, host, owner } = await hostedApi(t, db.url);
  const base = `https://${host}`;

  // Hosts and browser origins are the deployment's own public ones (plus loopback probes).
  assert.equal((await call(port, '/api/health', { host })).status, 200);
  assert.equal(
    (await call(port, '/api/health', { host: 'evil.example.test' })).status,
    403,
  );
  assert.equal(
    (
      await call(port, '/api/health', {
        host,
        headers: { Origin: 'http://127.0.0.1:5173' },
      })
    ).status,
    403,
  );
  // Development login is not available in a hosted deployment.
  assert.notEqual(
    (
      await call(port, '/api/auth/dev-login', {
        host,
        body: { code: LOGIN_CODE },
      })
    ).status,
    200,
  );

  const ready = await call(port, '/api/ready', { host });
  assert.equal(ready.status, 200, ready.text);
  assert.equal(ready.json.environment, 'staging');
  assert.equal(ready.json.verification, 'unverified');
  assert.equal(
    ready.json.public_origins.preview,
    HOSTED.CREATOR_PUBLIC_PREVIEW_ORIGIN,
  );
  assert.equal((await api.ops!.identity())?.environment, 'staging');

  // Operations status and metrics: owner session or the read-only scrape token.
  assert.equal((await call(port, '/api/ops/status', { host })).status, 401);
  assert.equal(
    (
      await call(port, '/api/ops/status', {
        host,
        headers: { Authorization: 'Bearer wrong-token-0123456789abcdefghijkl' },
      })
    ).status,
    401,
  );
  const status = await call(port, '/api/ops/status', {
    host,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.equal(status.status, 200, status.text);
  assert.equal(status.json.identity.environment, 'staging');
  assert.equal(status.json.alert_delivery, 'none');
  const metrics = await call(port, '/api/ops/metrics', {
    host,
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  assert.match(
    metrics.text,
    /creator_outbox_pending\{environment="staging"\} \d/,
  );
  assert.match(metrics.headers.get('content-type') ?? '', /text\/plain/);
  // The scrape token never authorizes a change.
  assert.equal(
    (
      await call(port, '/api/ops/verifications', {
        host,
        headers: { Authorization: `Bearer ${TOKEN}` },
        body: {},
      })
    ).status,
    401,
  );

  // Staging smoke check through the public origin, then an owner-recorded verification.
  const smoke = await smokeCheck(base, 'staging', viaProxy(port), COMMIT);
  assert.equal(smoke.passed, true, JSON.stringify(smoke.checks));
  assert.equal(smoke.config_hash, api.configHash);
  const wrongTarget = await smokeCheck(
    `http://127.0.0.1:${port}`,
    'staging',
    fetch,
  );
  assert.equal(
    wrongTarget.checks.find((c) => c.name === 'declared_target')?.ok,
    false,
  );
  const mismatched: SmokeReport = { ...smoke, environment: 'live' };
  assert.equal(
    (
      await call(port, '/api/ops/verifications', {
        host,
        headers: owner,
        body: { smoke_report: mismatched },
      })
    ).status,
    400,
  );
  // CSRF is required for the owner session.
  assert.equal(
    (
      await call(port, '/api/ops/verifications', {
        host,
        headers: { Cookie: owner.Cookie },
        body: { smoke_report: smoke },
      })
    ).status,
    403,
  );
  const recorded = await call(port, '/api/ops/verifications', {
    host,
    headers: owner,
    body: { smoke_report: smoke },
  });
  assert.equal(recorded.status, 201, recorded.text);
  assert.equal(recorded.json.result, 'passed');
  assert.equal(
    (await call(port, '/api/ready', { host })).json.verification,
    'verified',
  );
  assert.equal((await api.store!.verifyAuditChain()).ok, true);

  // A new build against the same database is not verified by the old record.
  const next = await hostedApi(t, db.url, {
    CREATOR_BUILD_COMMIT: 'b'.repeat(40),
  });
  assert.equal(
    (await call(next.port, '/api/ready', { host: next.host })).json
      .verification,
    'stale',
  );

  // Environment separation: a process for another environment refuses this database.
  const local = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  local.server.listen(0, '127.0.0.1');
  await once(local.server, 'listening');
  t.after(() => local.close());
  await assert.rejects(local.ready(), /belongs to the staging environment/);
  const localReady = await call(
    (local.server.address() as { port: number }).port,
    '/api/ready',
  );
  assert.equal(localReady.status, 503);
  assert.equal(
    localReady.json.checks.find((c: any) => c.name === 'database').ok,
    false,
  );
});

test('a live verification needs the typed confirmation of the exact build; relabelling into live is refused', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const { api, port, host, owner } = await hostedApi(t, db.url, {
    CREATOR_ENVIRONMENT: 'live',
    CREATOR_PUBLIC_WEB_ORIGIN: 'https://studio.example.test',
    CREATOR_WEB_ORIGIN: 'https://studio.example.test',
    CREATOR_OIDC_REDIRECT_URI:
      'https://studio.example.test/api/auth/oidc/callback',
  });
  const ready = await call(port, '/api/ready', { host });
  assert.equal(ready.json.environment, 'live');
  assert.equal(ready.json.verification, 'unverified');
  const smoke = await smokeCheck(
    `https://${host}`,
    'live',
    viaProxy(port),
    COMMIT,
  );
  assert.equal(smoke.passed, true, JSON.stringify(smoke.checks));
  for (const confirmation of [undefined, 'verify live', 'yes'])
    assert.equal(
      (
        await call(port, '/api/ops/verifications', {
          host,
          headers: owner,
          body: { smoke_report: smoke, confirmation },
        })
      ).status,
      403,
    );
  assert.equal(
    (await call(port, '/api/ready', { host })).json.verification,
    'unverified',
  );
  const ok = await call(port, '/api/ops/verifications', {
    host,
    headers: owner,
    body: {
      smoke_report: smoke,
      confirmation: liveConfirmation(COMMIT, api.configHash),
    },
  });
  assert.equal(ok.status, 201, ok.text);
  assert.equal(
    (await call(port, '/api/ready', { host })).json.verification,
    'verified',
  );
  // The database itself enforces that a passing live record carries a confirmation.
  await assert.rejects(
    db.pool.query(
      `insert into deployment_verifications (id, environment, build_commit, config_hash,
         schema_version, result, checks, smoke_report_sha256, recorded_by, audit_event_id)
       select $1, 'live', $2, $3, 18, 'passed', '{}', $3, $4, id from audit_events limit 1`,
      [randomUUID(), COMMIT, 'd'.repeat(64), DEFAULT_OWNER_ACTOR_ID],
    ),
  );

  const ops = new OpsStore(db.pool);
  const ctx = { actorId: OPERATIONS_ACTOR_ID };
  await assert.rejects(
    ops
      .relabelEnvironment(ctx, 'live', 'staging')
      .then(() => ops.relabelEnvironment(ctx, 'staging', 'live')),
    (e: unknown) => e instanceof ContractError && e.code === 'SCOPE_EXCEEDED',
  );
  assert.equal((await ops.identity())?.environment, 'staging');
  await assert.rejects(
    ops.relabelEnvironment(ctx, 'test', 'local'),
    (e: unknown) => e instanceof ContractError && e.code === 'VERSION_CONFLICT',
  );
});

test('operations metrics show unreachable local workers, and cleanup removes only expired sign-in material', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  t.after(() => api.close());
  await api.ready();
  const ops = api.ops!;
  const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };
  const ws = await api.store!.createWorkspace(owner, {
    name: 'X06 workers',
    record_mode: 'fixture',
  });
  const worker = (label: string, lease: string | null) =>
    db.pool.query(
      `insert into desktop_devices (id, kind, owner_id, workspace_id, label, capabilities,
         token_hash, state, expires_at, last_seen_at, lease_expires_at)
       values ($1, 'worker', $2, $3, $4, '["artifact.verify"]', $5, 'active',
         now() + interval '1 day', now() - interval '1 minute', ${lease ?? 'null'})`,
      [
        randomUUID(),
        DEFAULT_OWNER_ACTOR_ID,
        ws.id,
        label,
        randomBytes(32).toString('hex'),
      ],
    );
  await worker('Laptop online', `now() + interval '20 seconds'`);
  await worker('Desktop gone quiet', `now() - interval '5 minutes'`);
  await worker('Never reported', null);
  const m = await ops.metrics();
  assert.equal(m.workers.local.online, 1);
  assert.equal(m.workers.local.unreachable, 2);
  assert.equal(m.budget.unknown_nano, '0');
  const global = await api.store!.createEnvelope(owner, ws.id, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Fixture root',
    cap_nano_usd: '1000',
    max_in_flight: 1,
    starts_at: null,
    ends_at: null,
  });
  const child = await api.store!.createEnvelope(owner, ws.id, {
    parent_id: global.id,
    kind: 'period',
    run_id: null,
    name: 'Fixture child',
    cap_nano_usd: '100',
    max_in_flight: 1,
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 86400000).toISOString(),
  });
  // Labelled metrics fixture: budget admission/journal behavior is tested separately.
  await db.pool.query(
    'update budget_envelopes set reserved_nano = 10, unknown_nano = 20, incurred_nano = 40 where id = $1',
    [child.id],
  );
  const nested = await ops.metrics();
  assert.equal(nested.budget.envelopes_active, 1);
  assert.equal(nested.budget.reserved_nano, '10');
  assert.equal(nested.budget.unknown_nano, '20');
  assert.equal(nested.budget.incurred_nano, '40');
  assert.deepEqual(await ops.uncertainActions(), []);
  assert.ok('github_operations_unknown' in m.uncertain);

  // Unreachable workers are reported, never a reason to fail readiness.
  const port = (() => {
    api.server.listen(0, '127.0.0.1');
    return once(api.server, 'listening').then(
      () => (api.server.address() as { port: number }).port,
    );
  })();
  const ready = await call(await port, '/api/ready');
  assert.equal(ready.status, 200, ready.text);

  // Sessions: one long expired, one expired but still referenced, one current.
  const session = async (expires: string) => {
    const hash = randomBytes(32).toString('hex');
    await db.pool.query(
      `insert into auth_sessions (token_hash, actor_id, method, csrf_token, created_at, expires_at)
       values ($1, $2, 'dev_local', $3, now() - interval '90 days', ${expires})`,
      [hash, DEFAULT_OWNER_ACTOR_ID, randomBytes(32).toString('base64url')],
    );
    return hash;
  };
  await session(`now() - interval '60 days'`);
  const referenced = await session(`now() - interval '60 days'`);
  await session(`now() + interval '1 hour'`);
  await db.pool.query(
    `insert into desktop_devices (id, kind, owner_id, label, capabilities, session_hash, expires_at)
     values ($1, 'desktop_login', $2, 'Old desktop', '[]', $3, now() - interval '50 days')`,
    [randomUUID(), DEFAULT_OWNER_ACTOR_ID, referenced],
  );
  const retention = {
    version: 'test',
    auth_sessions_days: 30,
    oidc_logins_days: 2,
    desktop_challenges_days: 7,
  };
  const ctx = { actorId: OPERATIONS_ACTOR_ID };
  const before = await db.pool.query(
    'select count(*)::int as n from auth_sessions',
  );
  const dry = await ops.cleanup(ctx, retention, false);
  assert.deepEqual(dry, {
    applied: false,
    removed: { desktop_challenges: 0, oidc_logins: 0, auth_sessions: 1 },
  });
  assert.equal(
    (await db.pool.query('select count(*)::int as n from auth_sessions'))
      .rows[0].n,
    before.rows[0].n,
  );
  const applied = await ops.cleanup(ctx, retention, true);
  assert.equal(applied.removed.auth_sessions, 1);
  assert.equal(
    (
      await db.pool.query(
        `select count(*)::int as n from audit_events where action = 'operations.cleanup'`,
      )
    ).rows[0].n,
    1,
  );
  assert.equal((await api.store!.verifyAuditChain()).ok, true);
  assert.equal(
    (await ops.cleanup(ctx, retention, true)).removed.auth_sessions,
    0,
  );
});
