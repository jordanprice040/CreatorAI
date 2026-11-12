import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CREDITS_OFF_STATEMENT,
  ContractError,
  CopyPlanConnectionResultSchema,
  type ErrorCode,
  type PlanConnection,
} from '@creator/contracts';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { MemoryVault, PlanConnectionService } from '@creator/broker';
import { once } from 'node:events';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { fakePlan } from './plan-fakes.js';

// ADR-0095 (P30): copying a connection into another workspace the same person owns. The copy
// carries the settings only: no sign-in, model checks, qualifications, credits statement or
// accepted caps, and the source is left exactly as it was.

const root = new URL('../../', import.meta.url);
const read = (p: string) =>
  JSON.parse(readFileSync(new URL(p, root), 'utf8')) as unknown;
const SETTINGS = read(
  'config/connections/chatgpt-plan.json',
) as PlanConnection['settings'];
const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(e.code, code, `${e.code}: ${e.message}`);
    if (message) assert.match(e.message, message);
    return true;
  });
const owner: CommandContext = { actorId: randomUUID() };
const other: CommandContext = { actorId: randomUUID() };
const until = async (f: () => boolean, ms = 5000) => {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ConnectionStore(db.pool);
  for (const [a, name] of [
    [owner, 'owner'],
    [other, 'other'],
  ] as const)
    await store.ensureActor({
      id: a.actorId,
      kind: 'human',
      display_name: name,
    });
  const fake = await fakePlan({
    responses: [{ kind: 'text', text: 'ok' }],
  });
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
    name: 'Source',
    record_mode: 'fixture',
  });
  const target = await store.createWorkspace(owner, {
    name: 'Target',
    record_mode: 'fixture',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: {
      ...SETTINGS,
      caps: {
        ...SETTINGS.caps,
        shared: { ...SETTINGS.caps.shared, max_model_requests_per_day: 70 },
      },
    },
  });
  // The source is fully set up: signed in, credits off, caps accepted, a model verified and
  // qualified, and Chat answers on with that model.
  const s = await service.beginSignIn(owner, ws.id, conn.id, {
    open_browser: false,
  });
  assert.equal(await fake.approve(s.authorization_url), 200);
  await until(() => service.signInStatus(conn.id)?.state !== 'pending');
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  let c = await current();
  await store.attestPlanCredits(owner, ws.id, c.id, {
    expected_version: c.version,
    statement: CREDITS_OFF_STATEMENT,
    checked_on: '2026-11-12',
  });
  c = await current();
  await store.acceptPlanCaps(owner, ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  c = await current();
  const grant = await store.createPlanVerificationGrant(owner, ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  assert.equal(
    (
      await service.verifyModel(owner, ws.id, c.id, {
        id: grant.id,
        model_id: 'm',
      })
    ).verified,
    true,
  );
  await store.setChatSettings(owner, ws.id, {
    expected_version: 0,
    enabled: true,
    connection_id: c.id,
    model_id: 'm',
    include_snapshot: false,
    daily_limit: 7,
  });
  // A qualification row, as the Run would leave it, without sending the benchmark's cases.
  await db.pool.query(
    `insert into plan_qualifications (id, connection_id, model_id, task_class, manifest,
       manifest_hash, min_held_out_cases, floor, state, development, held_out, created_by, decided_at)
     values ($1,$2,'m','summarization','{}',$3,8,'{}','qualified','[]','[]',$4,clock_timestamp())`,
    [randomUUID(), c.id, 'a'.repeat(64), owner.actorId],
  );
  return { db, store, service, vault, ws, target, conn: await current() };
}

/** Everything the source has that a copy must not change. */
async function snapshot(s: NonNullable<Awaited<ReturnType<typeof setup>>>) {
  const d = await s.store.planConnectionDetail(owner, s.ws.id, s.conn.id);
  const raw = await s.db.pool.query(
    'select * from plan_connections where id = $1',
    [s.conn.id],
  );
  return {
    row: raw.rows[0],
    access: d.model_access,
    qualifications: d.qualifications,
    chat: await s.store.chatSettings(owner, s.ws.id),
  };
}

test('ADR-0095: a copy has the settings and nothing else, and the source is unchanged', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ws, target, conn } = s;
  const before = await snapshot(s);
  assert.equal(before.access.length, 1);
  assert.equal(before.qualifications.length, 1);
  const credentialBefore = (
    await store.planCredentialRef(owner, ws.id, conn.id)
  ).credential_ref;
  assert.ok(credentialBefore);

  const out = CopyPlanConnectionResultSchema.parse(
    await store.copyPlanConnection(owner, ws.id, conn.id, {
      expected_version: conn.version,
      target_workspace_id: target.id,
    }),
  );
  const copy = out.connection;
  assert.equal(out.chat_answers, 'copied');
  assert.equal(copy.workspace_id, target.id);
  assert.notEqual(copy.id, conn.id);
  assert.equal(copy.label, conn.label);
  assert.equal(copy.kind, conn.kind);
  assert.equal(copy.version, 1);
  assert.deepEqual(copy.settings, conn.settings);
  assert.equal(copy.settings_hash, conn.settings_hash);
  // Nothing the source earned comes along.
  assert.equal(copy.caps_accepted_at, null);
  assert.equal(copy.sign_in.state, 'not_signed_in');
  assert.equal(copy.credits.state, 'unconfirmed');
  assert.equal(copy.eligibility.state, 'unknown');
  assert.notEqual(copy.ext_agent_host_id, conn.ext_agent_host_id);
  assert.equal(
    (await store.planCredentialRef(owner, target.id, copy.id)).credential_ref,
    null,
  );
  const d = await store.planConnectionDetail(owner, target.id, copy.id);
  assert.deepEqual(d.model_access, []);
  assert.deepEqual(d.qualifications, []);
  assert.ok(d.blockers.length > 0);
  const grants = await s.db.pool.query(
    'select 1 from plan_verification_grants where connection_id = $1',
    [copy.id],
  );
  assert.equal(grants.rowCount, 0);
  // A model call on the copy is refused until the owner signs in, accepts and verifies there.
  await rejects(
    'INVALID_TRANSITION',
    store.createPlanVerificationGrant(owner, target.id, copy.id, {
      expected_version: copy.version,
      model_id: 'm',
      path: 'responses',
      expires_in_minutes: 5,
    }),
  );

  // Chat answers in the target use the copy, with the source's model and choices.
  const chat = await store.chatSettings(owner, target.id);
  assert.equal(chat.connection_id, copy.id);
  assert.equal(chat.model_id, 'm');
  assert.equal(chat.enabled, true);
  assert.equal(chat.include_snapshot, false);
  assert.equal(chat.daily_limit, 7);
  assert.equal(chat.version, 1);

  // The source: same row, version, sign-in, model checks, qualifications and chat setting.
  assert.deepEqual(await snapshot(s), before);
  assert.equal(
    (await store.planCredentialRef(owner, ws.id, conn.id)).credential_ref,
    credentialBefore,
  );

  // Provenance: the copy's first event names the source; the source's audit names the copy.
  const ev = await s.db.pool.query(
    `select body from plan_connection_events where connection_id = $1 and kind = 'created'`,
    [copy.id],
  );
  assert.deepEqual(ev.rows[0].body.copied_from, {
    workspace_id: ws.id,
    connection_id: conn.id,
    version: conn.version,
    settings_hash: conn.settings_hash,
  });
  const audit = await s.db.pool.query(
    `select workspace_id, subject_id, payload from audit_events where action = 'connection.copied'`,
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].workspace_id, ws.id);
  assert.equal(audit.rows[0].subject_id, conn.id);
  assert.equal(audit.rows[0].payload.copy_connection_id, copy.id);

  // The same name again is refused; another name works, and the target's own Chat answers
  // setting is left alone.
  await rejects(
    'DUPLICATE',
    store.copyPlanConnection(owner, ws.id, conn.id, {
      expected_version: conn.version,
      target_workspace_id: target.id,
    }),
    /choose another name/,
  );
  const second = await store.copyPlanConnection(owner, ws.id, conn.id, {
    expected_version: conn.version,
    target_workspace_id: target.id,
    label: 'ChatGPT plan 2',
  });
  assert.equal(second.chat_answers, 'target_has_own');
  assert.equal(
    (await store.chatSettings(owner, target.id)).connection_id,
    copy.id,
  );
  const third = await store.copyPlanConnection(owner, ws.id, conn.id, {
    expected_version: conn.version,
    target_workspace_id: target.id,
    label: 'ChatGPT plan 3',
    chat_answers: false,
  });
  assert.equal(third.chat_answers, 'not_requested');
});

test('ADR-0095: only the owner of both workspaces copies, within fixture or real, at the version seen', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ws, target, conn } = s;
  const body = {
    expected_version: conn.version,
    target_workspace_id: target.id,
  };
  // An editor of the source who owns the target cannot copy.
  const theirs = await store.createWorkspace(other, {
    name: 'Theirs',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, other.actorId, 'editor');
  await rejects(
    'ACCESS_DENIED',
    store.copyPlanConnection(other, ws.id, conn.id, {
      ...body,
      target_workspace_id: theirs.id,
    }),
    /owner of both/,
  );
  // The owner of the source who is only an editor of the target cannot copy either.
  await store.addMember(other, theirs.id, owner.actorId, 'editor');
  await rejects(
    'ACCESS_DENIED',
    store.copyPlanConnection(owner, ws.id, conn.id, {
      ...body,
      target_workspace_id: theirs.id,
    }),
    /owner of both/,
  );
  // A workspace the person is not in is not found, as everywhere else.
  const elsewhere = await store.createWorkspace(other, {
    name: 'Elsewhere',
    record_mode: 'fixture',
  });
  await rejects(
    'NOT_FOUND',
    store.copyPlanConnection(owner, ws.id, conn.id, {
      ...body,
      target_workspace_id: elsewhere.id,
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    store.copyPlanConnection(owner, ws.id, conn.id, {
      ...body,
      target_workspace_id: ws.id,
    }),
    /another workspace/,
  );
  const real = await store.createWorkspace(owner, {
    name: 'Real',
    record_mode: 'real',
  });
  await rejects(
    'INVALID_CONTRACT',
    store.copyPlanConnection(owner, ws.id, conn.id, {
      ...body,
      target_workspace_id: real.id,
    }),
    /fixture workspace/,
  );
  await rejects(
    'VERSION_CONFLICT',
    store.copyPlanConnection(owner, ws.id, conn.id, {
      ...body,
      expected_version: conn.version - 1,
    }),
  );
  const none = await s.db.pool.query(
    'select count(*)::int as n from plan_connections where workspace_id <> $1',
    [ws.id],
  );
  assert.equal(none.rows[0].n, 0);
});

test('ADR-0095: two copies with one name at once give one copy and one DUPLICATE', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ws, target, conn } = s;
  const body = {
    expected_version: conn.version,
    target_workspace_id: target.id,
    label: 'Same name',
  };
  const results = await Promise.allSettled([
    store.copyPlanConnection(owner, ws.id, conn.id, body),
    store.copyPlanConnection(owner, ws.id, conn.id, body),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const failed = results.find((r) => r.status === 'rejected');
  assert.ok(
    failed?.status === 'rejected' &&
      failed.reason instanceof ContractError &&
      failed.reason.code === 'DUPLICATE',
    String(failed?.status === 'rejected' && failed.reason),
  );
});

test('ADR-0095: the copy route answers 201 with the copy, and the target lists it', async (t) => {
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
  const auth = await login(base);
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ws = (await post('workspaces', { name: 'A', record_mode: 'fixture' }))
    .body.id as string;
  const target = (
    await post('workspaces', { name: 'B', record_mode: 'fixture' })
  ).body.id as string;
  const conn = await post(`workspaces/${ws}/plan-connections`, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  assert.equal(conn.status, 201);
  const copied = await post(
    `workspaces/${ws}/plan-connections/${conn.body.id}/copy`,
    { expected_version: 1, target_workspace_id: target },
  );
  assert.equal(copied.status, 201, JSON.stringify(copied.body));
  const out = CopyPlanConnectionResultSchema.parse(copied.body);
  assert.equal(out.chat_answers, 'source_not_using');
  const listed = (await (
    await fetch(`${base}/workspaces/${target}/plan-connections`, {
      headers: auth.read,
    })
  ).json()) as { id: string }[];
  assert.deepEqual(
    listed.map((x) => x.id),
    [out.connection.id],
  );
});
