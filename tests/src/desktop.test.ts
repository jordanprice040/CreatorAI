import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  ContractError,
  DesktopChallengeRequestSchema,
} from '@creator/contracts';
import { DesktopStore, PAIRING_LIMITS } from '@creator/db';
import { createApi, visitorKey } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const proof = () => randomBytes(32).toString('hex');
const VISITOR = hash('visitor-a');
const rejects = (code: string, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );

test('desktop pairing schema refuses arbitrary capabilities and login scope expansion', () => {
  const request = {
    kind: 'desktop_login',
    label: 'Windows test',
    proof_hash: hash(proof()),
    workspace_id: null,
    capabilities: [],
  };
  assert.ok(DesktopChallengeRequestSchema.safeParse(request).success);
  assert.equal(
    DesktopChallengeRequestSchema.safeParse({
      ...request,
      capabilities: ['exec'],
    }).success,
    false,
  );
  assert.equal(
    DesktopChallengeRequestSchema.safeParse({
      ...request,
      workspace_id: randomUUID(),
    }).success,
    false,
  );
});

test('durable one-time pairing: proof binding, concurrent claims, expiry, revoked approvals, controls and scoped presence', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  let store = new DesktopStore(db.pool);
  const owner = { actorId: randomUUID() };
  const outsider = { actorId: randomUUID() };
  for (const ctx of [owner, outsider])
    await store.ensureActor({
      id: ctx.actorId,
      kind: 'human',
      display_name: 'Synthetic desktop test',
    });
  const ws = (
    await store.createWorkspace(owner, {
      name: 'Pairing fixture',
      record_mode: 'fixture',
    })
  ).id;
  const browser = await store.createSession(
    owner.actorId,
    'dev_local',
    null,
    1,
  );
  const p = proof();
  const request = {
    kind: 'worker',
    label: 'Synthetic worker',
    proof_hash: hash(p),
    workspace_id: ws,
    capabilities: ['artifact.verify'],
  };
  const c = await store.beginDesktop(request, VISITOR);
  await rejects(
    'NOT_FOUND',
    store.approveDesktop(
      outsider,
      c.id,
      hash(
        (await store.createSession(outsider.actorId, 'dev_local', null, 1))
          .token,
      ),
    ),
  );
  assert.equal((await store.claimDesktop(c.id, { proof: p })).state, 'pending');
  await rejects('EXPIRED', store.claimDesktop(c.id, { proof: proof() }));
  await store.approveDesktop(owner, c.id, hash(browser.token));
  store = new DesktopStore(db.pool); // A new instance has no in-memory pairing state.
  const claims = await Promise.allSettled([
    store.claimDesktop(c.id, { proof: p }),
    store.claimDesktop(c.id, { proof: p }),
  ]);
  assert.equal(claims.filter((r) => r.status === 'fulfilled').length, 1);
  const claimed = claims.find((r) => r.status === 'fulfilled');
  assert.ok(
    claimed?.status === 'fulfilled' && claimed.value.state === 'paired',
  );
  if (claimed?.status !== 'fulfilled' || claimed.value.state !== 'paired')
    return;
  const d = claimed.value;
  const heartbeat = await store.heartbeatDesktop(d.token, { fence: 0 });
  assert.equal(heartbeat.lease?.purpose, 'presence_only');
  assert.equal(heartbeat.lease?.workspace_id, ws);
  await rejects(
    'NOT_FOUND',
    store.controlDesktop(outsider, d.device.id, { state: 'revoked' }),
  );
  assert.deepEqual(await store.desktopDevices(outsider), []);
  await store.controlDesktop(owner, d.device.id, { state: 'paused' });
  assert.equal(
    (await store.heartbeatDesktop(d.token, { fence: 0 })).lease,
    null,
  );
  await store.controlDesktop(owner, d.device.id, { state: 'active' });
  const stale = await store.heartbeatDesktop(d.token, { fence: 0 });
  assert.equal(stale.lease, null);
  assert.ok(
    (await store.heartbeatDesktop(d.token, { fence: stale.device.fence }))
      .lease,
  );
  await store.controlDesktop(owner, d.device.id, { state: 'shutdown' });
  assert.equal(
    (await store.heartbeatDesktop(d.token, { fence: 2 })).lease,
    null,
  );
  await store.controlDesktop(owner, d.device.id, { state: 'revoked' });
  await rejects(
    'UNAUTHENTICATED',
    store.heartbeatDesktop(d.token, { fence: 4 }),
  );
  await rejects(
    'INVALID_TRANSITION',
    store.controlDesktop(owner, d.device.id, { state: 'active' }),
  );
  const raw = await db.pool.query(
    'select token_hash from desktop_devices where id=$1',
    [d.device.id],
  );
  assert.equal(raw.rows[0]?.token_hash, hash(d.token));
  assert.notEqual(raw.rows[0]?.token_hash, d.token);
  const expProof = proof();
  const expired = await store.beginDesktop(
    { ...request, proof_hash: hash(expProof) },
    VISITOR,
  );
  await db.pool.query(
    `update desktop_challenges set expires_at=clock_timestamp()-interval '1 second' where id=$1`,
    [expired.id],
  );
  await rejects('EXPIRED', store.claimDesktop(expired.id, { proof: expProof }));
  const revokedProof = proof();
  const revoked = await store.beginDesktop(
    { ...request, proof_hash: hash(revokedProof) },
    VISITOR,
  );
  await store.approveDesktop(owner, revoked.id, hash(browser.token));
  await store.endSession(browser.token);
  await rejects(
    'UNAUTHENTICATED',
    store.claimDesktop(revoked.id, { proof: revokedProof }),
  );
});

test('real HTTP desktop sign-in issues a separate revocable session; CSRF and worker credential boundaries', async (t) => {
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
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const browser = await login(base);
  const workerModule = (await import(
    new URL('../../apps/desktop/worker.mjs', import.meta.url).href
  )) as {
    workerClient(origin: string): {
      begin(
        workspaceId: string,
        label: string,
      ): Promise<{ challenge: { id: string }; proof: string }>;
      claim(
        id: string,
        proof: string,
      ): Promise<{ state: string; token: string; device: { id: string } }>;
      heartbeat(
        token: string,
        fence: number,
      ): Promise<{
        device: { state: string; fence: number };
        lease: { purpose: string } | null;
      }>;
    };
  };
  assert.throws(
    () => workerModule.workerClient('https://example.org'),
    /loopback/,
  );
  const post = (path: string, body: unknown, headers = {}) =>
    fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const p = proof();
  const request = await post('desktop/challenges', {
    kind: 'desktop_login',
    label: '<script>untrusted label</script>',
    proof_hash: hash(p),
    workspace_id: null,
    capabilities: [],
  });
  assert.equal(request.status, 201);
  const c = (await request.json()) as { id: string; comparison_code: string };
  assert.equal(c.comparison_code, hash(p).slice(0, 8).toUpperCase());
  assert.equal(
    (await post(`desktop/challenges/${c.id}/approve`, {}, browser.read)).status,
    403,
  );
  assert.equal(
    (await post(`desktop/challenges/${c.id}/approve`, {}, browser.write))
      .status,
    200,
  );
  const claimed = await post(`desktop/challenges/${c.id}/claim`, { proof: p });
  const d = (await claimed.json()) as { token: string; device: { id: string } };
  assert.equal(claimed.status, 200);
  const desktopCookie = `creator_session=${d.token}`;
  assert.equal(
    (
      await fetch(`${base}/auth/session`, {
        headers: { Cookie: desktopCookie },
      })
    ).status,
    200,
  );
  assert.equal(
    (
      await post(
        'desktop/heartbeat',
        { fence: 0 },
        { Authorization: `Bearer ${d.token}` },
      )
    ).status,
    401,
  );
  assert.equal(
    (await post(`desktop/challenges/${c.id}/claim`, { proof: p })).status,
    409,
  );
  const page = await fetch(`${base}/desktop/approve?id=${c.id}`);
  assert.match(
    page.headers.get('content-security-policy') ?? '',
    /frame-ancestors 'none'/,
  );
  assert.doesNotMatch(await page.text(), /<script>untrusted label/);
  const devices = await fetch(`${base}/desktop/devices`, {
    headers: browser.read,
  });
  assert.doesNotMatch(await devices.text(), new RegExp(d.token));
  assert.equal(
    (
      await post(
        `desktop/devices/${d.device.id}/control`,
        { state: 'revoked' },
        browser.write,
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await fetch(`${base}/auth/session`, {
        headers: { Cookie: desktopCookie },
      })
    ).status,
    401,
  );
  assert.equal(
    (await fetch(`${base}/auth/session`, { headers: browser.read })).status,
    200,
  );
  const workspace = await post(
    'workspaces',
    { name: 'Worker API fixture', record_mode: 'fixture' },
    browser.write,
  );
  const ws = ((await workspace.json()) as { id: string }).id;
  const client = workerModule.workerClient(base.slice(0, -4));
  const workerChallenge = await client.begin(ws, 'Actual outbound client');
  assert.equal(
    (
      await post(
        `desktop/challenges/${workerChallenge.challenge.id}/approve`,
        {},
        browser.write,
      )
    ).status,
    200,
  );
  const paired = await client.claim(
    workerChallenge.challenge.id,
    workerChallenge.proof,
  );
  assert.equal(paired.state, 'paired');
  assert.equal(
    (await client.heartbeat(paired.token, 0)).lease?.purpose,
    'presence_only',
  );
  assert.equal(
    (
      await fetch(`${base}/auth/session`, {
        headers: { Cookie: `creator_session=${paired.token}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (
      await post(
        `desktop/devices/${paired.device.id}/control`,
        { state: 'revoked' },
        browser.write,
      )
    ).status,
    200,
  );
  await assert.rejects(client.heartbeat(paired.token, 0), /HTTP 401/);
});

test('pairing limits: one visitor cannot use up the server; expiry frees a pending slot; approval still needs the owner', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new DesktopStore(db.pool);
  const begin = (visitor: string) =>
    store.beginDesktop(
      {
        kind: 'desktop_login',
        label: 'Limit test',
        proof_hash: hash(proof()),
        workspace_id: null,
        capabilities: [],
      },
      hash(visitor),
    );
  const L = PAIRING_LIMITS;
  assert.ok(
    L.visitorPending < L.serverPending && L.visitorRecent < L.serverRecent,
  );
  // One visitor reaches its pending limit; others are unaffected.
  const mine = [];
  for (let i = 0; i < L.visitorPending; i += 1) mine.push(await begin('noisy'));
  await rejects('LIMIT_EXCEEDED', begin('noisy'));
  const quiet = await begin('quiet');
  // An expired request no longer counts as pending, but still counts toward the rate.
  await db.pool.query(
    `update desktop_challenges set expires_at=clock_timestamp()-interval '1 second' where id=$1`,
    [mine[0]!.id],
  );
  const recentLeft = L.visitorRecent - L.visitorPending;
  for (let i = 0; i < recentLeft; i += 1) {
    await db.pool.query(
      `update desktop_challenges set expires_at=clock_timestamp()-interval '1 second'
        where visitor_hash=$1 and expires_at > clock_timestamp()`,
      [hash('noisy')],
    );
    assert.ok(await begin('noisy'));
  }
  await db.pool.query(
    `update desktop_challenges set expires_at=clock_timestamp()-interval '1 second' where visitor_hash=$1`,
    [hash('noisy')],
  );
  await rejects('LIMIT_EXCEEDED', begin('noisy')); // rate, not pending
  // The overall pending bound holds across many visitors.
  let opened = 1; // 'quiet'
  for (let v = 0; opened < L.serverPending; v += 1)
    for (let i = 0; i < L.visitorPending && opened < L.serverPending; i += 1) {
      await begin(`crowd-${v}`);
      opened += 1;
    }
  await rejects('LIMIT_EXCEEDED', begin('newcomer'));
  // Challenges expire five minutes after they open.
  const { rows } = await db.pool.query(
    `select max(expires_at - created_at) < interval '5 minutes 1 second' as short from desktop_challenges`,
  );
  assert.equal(rows[0].short, true);
  // Approval requires a signed-in owner session: an unknown session cannot complete it.
  await rejects(
    'UNAUTHENTICATED',
    store.approveDesktop(
      { actorId: randomUUID() },
      quiet.id,
      hash('no-session'),
    ),
  );
  await rejects('INVALID_CONTRACT', store.beginDesktop({}, 'not-a-hash'));
});

test('the visitor key uses the proxy-appended address only when hosted, and stores a salted hash', () => {
  const req = (xff: string | undefined, remote: string) =>
    ({
      headers: xff === undefined ? {} : { 'x-forwarded-for': xff },
      socket: { remoteAddress: remote },
    }) as never;
  const salt = 's';
  // A client-supplied first entry cannot change who is counted in hosted mode.
  assert.equal(
    visitorKey(req('1.1.1.1, 203.0.113.9', '10.0.0.2'), true, salt),
    visitorKey(req('9.9.9.9,203.0.113.9', '10.0.0.2'), true, salt),
  );
  assert.equal(
    visitorKey(req('203.0.113.9', '10.0.0.2'), true, salt),
    hash(`${salt}\n203.0.113.9`),
  );
  // Locally, forwarded headers are ignored entirely.
  assert.equal(
    visitorKey(req('203.0.113.9', '127.0.0.1'), false, salt),
    visitorKey(req(undefined, '127.0.0.1'), false, salt),
  );
  assert.notEqual(
    visitorKey(req(undefined, '127.0.0.1'), false, 'other'),
    visitorKey(req(undefined, '127.0.0.1'), false, salt),
  );
});
