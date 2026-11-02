import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ContractError,
  NOTE_MAX,
  type PlanConnection,
} from '@creator/contracts';
import { createApi } from '@creator/api';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0059 right-hand sidebar. Notes belong to one person in one workspace, a stale window
// cannot overwrite newer text, and saving them leaves no trace in the activity history.
// "Running now" lists only unfinished work of the workspace asked about.

const SETTINGS = JSON.parse(
  readFileSync(
    new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
    'utf8',
  ),
) as PlanConnection['settings'];
const isCode = (code: string) => (e: unknown) =>
  e instanceof ContractError && e.code === code;

async function person(store: ConnectionStore, name: string) {
  const ctx: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: ctx.actorId,
    kind: 'human',
    display_name: name,
  });
  return ctx;
}

test('notes are per person and per workspace, versioned, and never audited', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner = await person(store, 'owner');
  const viewer = await person(store, 'viewer');
  const stranger = await person(store, 'stranger');
  const a = await store.createWorkspace(owner, {
    name: 'A',
    record_mode: 'fixture',
  });
  const b = await store.createWorkspace(owner, {
    name: 'B',
    record_mode: 'fixture',
  });
  await store.addMember(owner, a.id, viewer.actorId, 'viewer');

  const empty = await store.workspaceNote(owner, a.id);
  assert.deepEqual(
    { text: empty.text, version: empty.version, at: empty.updated_at },
    { text: '', version: 0, at: null },
  );
  const audit = async () =>
    Number(
      (
        await db.pool.query(
          'select count(*)::int as n from audit_events where workspace_id = $1',
          [a.id],
        )
      ).rows[0].n,
    );
  const before = await audit();
  const v1 = await store.saveWorkspaceNote(owner, a.id, {
    expected_version: 0,
    text: 'first idea',
  });
  assert.equal(v1.version, 1);
  const v2 = await store.saveWorkspaceNote(owner, a.id, {
    expected_version: 1,
    text: 'first idea\nsecond idea',
  });
  assert.equal(v2.version, 2);
  // The same text again is not a new version.
  const same = await store.saveWorkspaceNote(owner, a.id, {
    expected_version: 2,
    text: 'first idea\nsecond idea',
  });
  assert.equal(same.version, 2);
  // A window that loaded version 1 cannot overwrite version 2.
  await assert.rejects(
    store.saveWorkspaceNote(owner, a.id, {
      expected_version: 1,
      text: 'stale',
    }),
    isCode('VERSION_CONFLICT'),
  );
  // A fresh first save from a second window also conflicts once a note exists.
  await assert.rejects(
    store.saveWorkspaceNote(owner, a.id, { expected_version: 0, text: 'x' }),
    isCode('VERSION_CONFLICT'),
  );
  assert.equal(
    (await store.workspaceNote(owner, a.id)).text,
    'first idea\nsecond idea',
  );
  // Saving notes writes nothing to the audit history, so their text cannot appear there.
  assert.equal(await audit(), before);

  // Another workspace has its own note.
  assert.equal((await store.workspaceNote(owner, b.id)).text, '');
  // Another member of the same workspace has their own note and cannot read the owner's.
  assert.equal((await store.workspaceNote(viewer, a.id)).text, '');
  const mine = await store.saveWorkspaceNote(viewer, a.id, {
    expected_version: 0,
    text: 'viewer scratch',
  });
  assert.equal(mine.version, 1);
  assert.equal(
    (await store.workspaceNote(owner, a.id)).text,
    'first idea\nsecond idea',
  );
  // A non-member cannot read or write, and cannot learn the workspace exists.
  await assert.rejects(
    store.workspaceNote(stranger, a.id),
    isCode('NOT_FOUND'),
  );
  await assert.rejects(
    store.saveWorkspaceNote(stranger, a.id, { expected_version: 0, text: 'x' }),
    isCode('NOT_FOUND'),
  );
  // Too long, or an extra field, is refused.
  await assert.rejects(
    store.saveWorkspaceNote(owner, a.id, {
      expected_version: 2,
      text: 'x'.repeat(NOTE_MAX + 1),
    }),
    isCode('INVALID_CONTRACT'),
  );
  await assert.rejects(
    store.saveWorkspaceNote(owner, a.id, {
      expected_version: 2,
      text: 'x',
      actor_id: viewer.actorId,
    }),
    isCode('INVALID_CONTRACT'),
  );
  const full = await store.saveWorkspaceNote(owner, a.id, {
    expected_version: 2,
    text: 'y'.repeat(NOTE_MAX),
  });
  assert.equal(full.text.length, NOTE_MAX);
});

test('two windows saving the same version at once: exactly one wins', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner = await person(store, 'owner');
  const ws = await store.createWorkspace(owner, {
    name: 'Race',
    record_mode: 'fixture',
  });
  await store.saveWorkspaceNote(owner, ws.id, {
    expected_version: 0,
    text: 'base',
  });
  const results = await Promise.allSettled(
    ['left', 'right', 'third'].map((text) =>
      store.saveWorkspaceNote(owner, ws.id, { expected_version: 1, text }),
    ),
  );
  const won = results.filter((r) => r.status === 'fulfilled');
  assert.equal(won.length, 1);
  for (const r of results)
    if (r.status === 'rejected')
      assert.ok(isCode('VERSION_CONFLICT')(r.reason));
  const note = await store.workspaceNote(owner, ws.id);
  assert.equal(note.version, 2);
  assert.equal(
    note.text,
    (won[0] as PromiseFulfilledResult<{ text: string }>).value.text,
  );
});

test('running now lists unfinished plan requests of this workspace only', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner = await person(store, 'owner');
  const ws = await store.createWorkspace(owner, {
    name: 'Now',
    record_mode: 'real',
  });
  const other = await store.createWorkspace(owner, {
    name: 'Other',
    record_mode: 'real',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'Plan',
    settings: SETTINGS,
  });
  const elsewhere = await store.createPlanConnection(owner, other.id, {
    label: 'Plan',
    settings: SETTINGS,
  });
  const add = (connection: string, purpose: string, state: string, ago = 0) =>
    db.pool.query(
      `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose,
         model_id, data_class, state, created_by, started_at)
       values ($1, $2, $3, 'responses', $4, 'gpt-x', 'synthetic', $5, $6, $7)`,
      [
        randomUUID(),
        connection,
        randomUUID(),
        purpose,
        state,
        owner.actorId,
        new Date(Date.now() - ago),
      ],
    );
  assert.deepEqual((await store.activityNow(owner, ws.id)).items, []);
  await add(conn.id, 'qualification', 'in_flight', 60_000);
  await add(conn.id, 'chat', 'in_flight');
  await add(conn.id, 'task', 'completed');
  await add(conn.id, 'task', 'unknown');
  await add(elsewhere.id, 'task', 'in_flight');
  const now = await store.activityNow(owner, ws.id);
  assert.deepEqual(
    now.items.map((i) => [i.kind, i.purpose, i.label]),
    [
      ['plan_request', 'chat', 'Chat answer'],
      ['plan_request', 'qualification', 'Qualifying a model'],
    ],
  );
  assert.equal(now.items[0]!.detail, 'gpt-x');
  const stranger = await person(store, 'stranger');
  await assert.rejects(store.activityNow(stranger, ws.id), isCode('NOT_FOUND'));
});

test('notes and running-now routes: signed in, CSRF on save, stale saves refused', async (t) => {
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
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const call = async (
    method: string,
    path: string,
    body?: unknown,
    headers: Record<string, string> = method === 'GET' ? auth.read : auth.write,
  ) => {
    const r = await fetch(`${base}/${path}`, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ws = (
    await call('POST', 'workspaces', { name: 'Notes', record_mode: 'fixture' })
  ).body.id as string;
  assert.equal(
    (await call('GET', `workspaces/${ws}/notes`, undefined, {})).status,
    401,
  );
  assert.equal(
    (
      await call(
        'POST',
        `workspaces/${ws}/notes`,
        { expected_version: 0, text: 'x' },
        auth.read,
      )
    ).status,
    403,
  );
  const saved = await call('POST', `workspaces/${ws}/notes`, {
    expected_version: 0,
    text: 'hello',
  });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, 1);
  const stale = await call('POST', `workspaces/${ws}/notes`, {
    expected_version: 0,
    text: 'again',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  const read = await call('GET', `workspaces/${ws}/notes`);
  assert.equal(read.body.text, 'hello');
  const now = await call('GET', `workspaces/${ws}/activity-now`);
  assert.equal(now.status, 200);
  assert.deepEqual(now.body.items, []);
  assert.equal(
    (await call('POST', `workspaces/${ws}/activity-now`, {})).status,
    404,
  );
});
