import { randomUUID } from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import {
  ContractError,
  parse,
  SessionInfoSchema,
  WorkspaceSchema,
} from '@creator/contracts';
import {
  ConnectionStore,
  OPERATIONS_ACTOR_ID,
  OpsStore,
  SAMPLE_WORKSPACE_NAME,
  TesterStore,
} from '@creator/db';
import { freshDatabase } from './pg-harness.js';
import { listen, oidcSignIn, testIdp } from './oidc-idp.js';

// ADR-0075 (P11 G1/G2): allow-listed tester accounts sign in as their own actors, see only
// their own synthetic sample workspace, never reach the owner's studio or deployment-wide
// settings, and stop working when they expire or are removed.

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof ContractError ? e.code : String(e);
  }
  return 'resolved';
};

test('tester accounts: own actor, own sample workspace, no owner powers, expiry and removal', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const idp = await testIdp();
  t.after(idp.close);
  const probe = createServer();
  const apiPort = await listen(probe);
  await new Promise<void>((r) => probe.close(() => r()));
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_OIDC_ISSUER: idp.state.issuer,
    CREATOR_OIDC_CLIENT_ID: 'creator-local',
    CREATOR_OIDC_REDIRECT_URI: `http://127.0.0.1:${apiPort}/api/auth/oidc/callback`,
    CREATOR_OIDC_OWNER_SUBJECT: 'owner-subject',
    CREATOR_WEB_ORIGIN: 'http://127.0.0.1:5173',
    CREATOR_WORKER: 'off',
  });
  api.server.listen(apiPort, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const base = `http://127.0.0.1:${apiPort}/api`;

  async function signInAs(subject: string) {
    idp.state.subject = subject;
    const { response } = await oidcSignIn(base);
    if (response.status !== 302) return { status: response.status };
    const cookie = response.headers.getSetCookie()[0]?.split(';')[0] ?? '';
    const session = parse(
      SessionInfoSchema,
      await (
        await fetch(`${base}/auth/session`, { headers: { Cookie: cookie } })
      ).json(),
    );
    return {
      status: 302,
      session,
      read: { Cookie: cookie },
      write: {
        Cookie: cookie,
        'X-CSRF-Token': session.csrf_token,
        'Content-Type': 'application/json',
      },
    };
  }
  const get = (path: string, h: Record<string, string>) =>
    fetch(`${base}${path}`, { headers: h });
  const post = (path: string, h: Record<string, string>, body: unknown) =>
    fetch(`${base}${path}`, {
      method: 'POST',
      headers: h,
      body: JSON.stringify(body),
    });

  // The owner signs in and keeps a private workspace with one record.
  const owner = await signInAs('owner-subject');
  assert.equal(owner.session?.account, 'owner');
  const ownerWs = parse(
    WorkspaceSchema,
    await (
      await post('/workspaces', owner.write!, {
        name: 'Owner studio',
        record_mode: 'real',
      })
    ).json(),
  );

  // Before any account exists, a stranger is refused and gets no cookie.
  const stranger = await signInAs('tester-a');
  assert.equal(stranger.status, 403);

  const ops = new OpsStore(db.pool);
  await ops.ensureOperationsActor();
  const testers = new TesterStore(db.pool);
  const ctx = { actorId: OPERATIONS_ACTOR_ID };
  const later = new Date(Date.now() + 7 * 86_400_000).toISOString();
  // The issuer is matched without a trailing slash, as providers differ.
  const a = await testers.addTester(ctx, {
    issuer: `${idp.state.issuer}/`,
    subject: 'tester-a',
    display_name: 'Tester A',
    expires_at: later,
    owner_subject: 'owner-subject',
  });
  const b = await testers.addTester(ctx, {
    issuer: idp.state.issuer,
    subject: 'tester-b',
    display_name: 'Tester B',
    expires_at: later,
    workspace_role: 'viewer',
  });
  assert.equal(a.state, 'active');
  assert.equal(a.workspace_role, 'editor');
  assert.ok(
    a.workspace_id && b.workspace_id && a.workspace_id !== b.workspace_id,
  );
  // The owner's own subject, a duplicate, a past expiry and an unknown role are refused.
  const bad = (over: Record<string, unknown>) =>
    code(
      testers.addTester(ctx, {
        issuer: idp.state.issuer,
        subject: 'tester-c',
        display_name: 'Tester C',
        expires_at: later,
        owner_subject: 'owner-subject',
        ...over,
      } as never),
    );
  assert.equal(await bad({ subject: 'owner-subject' }), 'INVALID_CONTRACT');
  assert.equal(await bad({ subject: 'tester-a' }), 'DUPLICATE');
  assert.equal(
    await bad({ expires_at: new Date(Date.now() - 1000).toISOString() }),
    'INVALID_CONTRACT',
  );
  assert.equal(await bad({ workspace_role: 'owner' }), 'INVALID_CONTRACT');

  // Tester A signs in as their own actor and sees only their sample workspace.
  const ta = await signInAs('tester-a');
  assert.equal(ta.status, 302);
  assert.equal(ta.session!.account, 'tester');
  assert.equal(ta.session!.actor_id, a.actor_id);
  assert.notEqual(ta.session!.actor_id, owner.session!.actor_id);
  const listed = (await (await get('/workspaces', ta.read!)).json()) as {
    id: string;
    name: string;
    role: string;
    record_mode: string;
  }[];
  assert.deepEqual(
    listed.map((w) => [w.id, w.name, w.role, w.record_mode]),
    [[a.workspace_id, SAMPLE_WORKSPACE_NAME, 'editor', 'fixture']],
  );
  const sample = (await (
    await get(`/workspaces/${a.workspace_id}/entities`, ta.read!)
  ).json()) as { items?: unknown[] } | unknown[];
  const items = Array.isArray(sample) ? sample : (sample.items ?? []);
  assert.ok(items.length >= 7, `sample has ${items.length} records`);
  // An editor may add to their own sample.
  assert.equal(
    (
      await post(`/workspaces/${a.workspace_id}/entities`, ta.write!, {
        kind: 'claim',
        title: 'My claim',
        body: {
          statement: 'A tester note.',
          basis: 'inference',
          uncertainty: 'Test.',
        },
      })
    ).status,
    201,
  );

  // Cross-account denial: the owner's and the other tester's workspaces do not exist for A.
  for (const ws of [ownerWs.id, b.workspace_id!]) {
    assert.equal(
      (await get(`/workspaces/${ws}/entities`, ta.read!)).status,
      404,
    );
    assert.equal((await get(`/workspaces/${ws}/files`, ta.read!)).status, 404);
    assert.equal((await get(`/workspaces/${ws}/notes`, ta.read!)).status, 404);
  }
  // The owner cannot see testers' workspaces either unless added.
  assert.equal(
    (await get(`/workspaces/${a.workspace_id}/entities`, owner.read!)).status,
    404,
  );
  // No owner powers: new workspaces, membership, Settings, plan connections, operations.
  assert.equal(
    (
      await post('/workspaces', ta.write!, {
        name: 'Mine',
        record_mode: 'real',
      })
    ).status,
    403,
  );
  assert.equal((await get('/settings/spending', ta.read!)).status, 403);
  assert.equal(
    (await post('/settings/spending', ta.write!, { ceiling_usd: '1000' }))
      .status,
    403,
  );
  assert.equal(
    (await get(`/workspaces/${a.workspace_id}/plan-connections`, ta.read!))
      .status,
    403,
  );
  assert.equal(
    (await get(`/workspaces/${a.workspace_id}/payment-connections`, ta.read!))
      .status,
    403,
  );
  assert.equal((await get('/ops/status', ta.read!)).status, 403);
  assert.equal((await get('/desktop/devices', ta.read!)).status, 403);
  // ADR-0081 (P21 review L-4): the current-model choice points at the owner's own plan
  // connections, so a tester can neither read nor switch it.
  assert.equal(
    (await get(`/workspaces/${a.workspace_id}/model-choice`, ta.read!)).status,
    403,
  );
  assert.equal(
    (
      await post(`/workspaces/${a.workspace_id}/model-choice`, ta.write!, {
        expected_version: 0,
        connection_id: randomUUID(),
        model_id: 'm',
      })
    ).status,
    403,
  );
  // The owner still has them.
  assert.equal((await get('/settings/spending', owner.read!)).status, 200);

  // Defence in depth in the store: even a tester that somehow owned a workspace gets no
  // deployment-wide powers.
  await db.pool.query(
    `insert into workspace_members (workspace_id, actor_id, role) values ($1, $2, 'owner')`,
    [ownerWs.id, a.actor_id],
  );
  const store = new ConnectionStore(db.pool);
  const actx = { actorId: a.actor_id };
  assert.equal(await code(store.runtimeCeiling(actx)), 'ACCESS_DENIED');
  assert.equal(
    await code(store.createWorkspace(actx, { name: 'x', record_mode: 'real' })),
    'ACCESS_DENIED',
  );
  assert.equal(
    await code(store.addMember(actx, ownerWs.id, b.actor_id, 'viewer')),
    'ACCESS_DENIED',
  );
  assert.equal(
    await code(
      store.createPlanConnection(actx, ownerWs.id, {
        label: 'x',
        settings: JSON.parse(
          readFileSync(
            new URL(
              '../../config/connections/chatgpt-plan.json',
              import.meta.url,
            ),
            'utf8',
          ),
        ) as unknown,
      }),
    ),
    'ACCESS_DENIED',
  );
  await db.pool.query(
    'delete from workspace_members where workspace_id = $1 and actor_id = $2',
    [ownerWs.id, a.actor_id],
  );
  // Review L-1: the owner cannot make a tester a workspace owner through membership either.
  const ownerCtx = { actorId: owner.session!.actor_id };
  assert.equal(
    await code(store.addMember(ownerCtx, ownerWs.id, a.actor_id, 'owner')),
    'ACCESS_DENIED',
  );
  assert.equal(
    (
      await db.pool.query(
        'select count(*)::int as n from workspace_members where actor_id = $1',
        [a.actor_id],
      )
    ).rows[0].n,
    1,
  );

  // A viewer tester reads but cannot write.
  const tb = await signInAs('tester-b');
  assert.equal(
    (await get(`/workspaces/${b.workspace_id}/entities`, tb.read!)).status,
    200,
  );
  assert.equal(
    (
      await post(`/workspaces/${b.workspace_id}/entities`, tb.write!, {
        kind: 'claim',
        title: 'No',
        body: { statement: 'x', basis: 'inference', uncertainty: 'x' },
      })
    ).status,
    403,
  );
  // Review N-1: a viewer is refused before the server reads the local product store.
  const reg = await post(`/workspaces/${b.workspace_id}/artifacts`, tb.write!, {
    product_id: '00000000-0000-4000-8000-0000000000aa',
    artifact_id: '00000000-0000-4000-8000-0000000000bb',
    manifest_sha256: 'a'.repeat(64),
  });
  assert.equal(reg.status, 403);
  assert.equal(
    ((await reg.json()) as { error: { code: string } }).error.code,
    'ACCESS_DENIED',
  );

  // Reset retires A's workspace (kept, not deleted) and seeds a fresh one.
  const reset = await testers.resetTester(ctx, a.actor_id);
  assert.notEqual(reset.workspace_id, a.workspace_id);
  assert.equal(reset.retired_workspaces, 1);
  assert.equal(
    (await get(`/workspaces/${a.workspace_id}/entities`, ta.read!)).status,
    404,
  );
  const fresh = (await (await get('/workspaces', ta.read!)).json()) as {
    id: string;
  }[];
  assert.deepEqual(
    fresh.map((w) => w.id),
    [reset.workspace_id],
  );
  const kept = await db.pool.query(
    'select count(*)::int as n from entities where workspace_id = $1',
    [a.workspace_id],
  );
  assert.equal(kept.rows[0].n, 8);

  // Expiry ends A's existing session and refuses a new sign-in.
  await db.pool.query(
    `update tester_accounts set expires_at = now() - interval '1 second' where actor_id = $1`,
    [a.actor_id],
  );
  assert.equal((await get('/auth/session', ta.read!)).status, 401);
  assert.equal((await signInAs('tester-a')).status, 403);
  assert.equal((await testers.tester(a.actor_id)).state, 'expired');

  // Removal revokes B's sessions, takes B out of its workspace and keeps the records.
  const removed = await testers.removeTester(
    ctx,
    b.actor_id,
    'Review window ended',
  );
  assert.equal(removed.state, 'disabled');
  assert.equal(removed.workspace_id, null);
  assert.equal((await get('/auth/session', tb.read!)).status, 401);
  assert.equal((await signInAs('tester-b')).status, 403);
  assert.equal(
    await code(testers.removeTester(ctx, b.actor_id, 'again')),
    'INVALID_TRANSITION',
  );
  assert.equal(
    await code(testers.resetTester(ctx, b.actor_id)),
    'INVALID_TRANSITION',
  );
  // The owner is unaffected throughout.
  assert.equal((await get('/auth/session', owner.read!)).status, 200);
  const all = await testers.listTesters();
  assert.deepEqual(
    all.map((x) => [x.display_name, x.state]),
    [
      ['Tester A', 'expired'],
      ['Tester B', 'disabled'],
    ],
  );

  // Review N-3: extend refuses a removed account unless restoring; restore re-enables it with a
  // fresh sample workspace, and the tester can sign in again.
  const soon = new Date(Date.now() + 30 * 60_000).toISOString();
  assert.equal(
    await code(testers.extendTester(ctx, b.actor_id, soon)),
    'INVALID_TRANSITION',
  );
  const restored = await testers.extendTester(ctx, b.actor_id, soon, true);
  assert.equal(restored.state, 'active');
  assert.ok(restored.workspace_id && restored.workspace_id !== b.workspace_id);
  assert.equal(restored.retired_workspaces, 1);
  const tb2 = await signInAs('tester-b');
  assert.equal(tb2.status, 302);
  // Review N-2: the session never outlasts the account (30 minutes, under the session hours).
  assert.equal(
    Date.parse(tb2.session!.expires_at),
    Date.parse(restored.expires_at),
  );
  // Extending an expired account brings it back without a new workspace.
  const extended = await testers.extendTester(ctx, a.actor_id, later);
  assert.equal(extended.state, 'active');
  assert.equal(extended.workspace_id, reset.workspace_id);
  assert.equal(
    await code(testers.extendTester(ctx, a.actor_id, '2000-01-01T00:00:00Z')),
    'INVALID_CONTRACT',
  );
});

test('tester reset: concurrent resets leave exactly one current workspace', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const ops = new OpsStore(db.pool);
  await ops.ensureOperationsActor();
  const testers = new TesterStore(db.pool);
  const ctx = { actorId: OPERATIONS_ACTOR_ID };
  const a = await testers.addTester(ctx, {
    issuer: 'https://id.example.org',
    subject: 'tester-a',
    display_name: 'Tester A',
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  await Promise.all([
    testers.resetTester(ctx, a.actor_id),
    testers.resetTester(ctx, a.actor_id),
    testers.resetTester(ctx, a.actor_id),
  ]);
  const { rows } = await db.pool.query(
    `select count(*) filter (where retired_at is null)::int as current,
            count(*)::int as total from tester_workspaces where actor_id = $1`,
    [a.actor_id],
  );
  assert.deepEqual(rows[0], { current: 1, total: 4 });
  const member = await db.pool.query(
    'select count(*)::int as n from workspace_members where actor_id = $1',
    [a.actor_id],
  );
  assert.equal(member.rows[0].n, 1);
});
