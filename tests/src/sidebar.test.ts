import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ContractError,
  NOTE_MAX,
  NOTE_TITLE_MAX,
  NOTES_PER_PERSON_MAX,
  type PlanConnection,
} from '@creator/contracts';
import { createApi } from '@creator/api';
import { ConnectionStore, migrate, type CommandContext } from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0060/ADR-0073 right-hand sidebar. Named notes belong to one person in one workspace, a
// stale window cannot overwrite newer text, and they leave no trace in the activity history.
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

test('named notes are private to their author, versioned, archived not deleted, and never audited', async (t) => {
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
  assert.deepEqual(await store.listWorkspaceNotes(owner, a.id), { notes: [] });

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
  const ideas = await store.createWorkspaceNote(owner, a.id, {
    title: '  Ideas  ',
  });
  assert.deepEqual(
    [ideas.title, ideas.text, ideas.version, ideas.status, ideas.from_notepad],
    ['Ideas', '', 1, 'active', false],
  );
  const v2 = await store.saveWorkspaceNote(owner, a.id, ideas.id, {
    expected_version: 1,
    text: 'first idea',
  });
  assert.equal(v2.version, 2);
  // The same text again is not a new version.
  const same = await store.saveWorkspaceNote(owner, a.id, ideas.id, {
    expected_version: 2,
    text: 'first idea',
  });
  assert.equal(same.version, 2);
  // A window that loaded version 1 cannot overwrite version 2.
  await assert.rejects(
    store.saveWorkspaceNote(owner, a.id, ideas.id, {
      expected_version: 1,
      text: 'stale',
    }),
    isCode('VERSION_CONFLICT'),
  );
  // Renaming keeps the text version, so an open editor's next save still goes through.
  const renamed = await store.renameWorkspaceNote(owner, a.id, ideas.id, {
    title: 'Product ideas',
  });
  assert.deepEqual([renamed.title, renamed.version], ['Product ideas', 2]);
  const todo = await store.createWorkspaceNote(owner, a.id, {
    title: 'To do',
    text: '- [ ] call',
  });
  // Newest change first, without the text.
  const list = (await store.listWorkspaceNotes(owner, a.id)).notes;
  assert.deepEqual(
    list.map((n) => [n.title, n.chars]),
    [
      ['To do', 10],
      ['Product ideas', 10],
    ],
  );
  assert.equal('text' in list[0]!, false);
  // Archived notes keep their text, refuse edits until restored, and stay listed.
  const archived = await store.setWorkspaceNoteArchived(owner, a.id, todo.id, {
    archived: true,
  });
  assert.deepEqual(
    [archived.status, archived.text],
    ['archived', '- [ ] call'],
  );
  await assert.rejects(
    store.saveWorkspaceNote(owner, a.id, todo.id, {
      expected_version: 1,
      text: 'x',
    }),
    isCode('INVALID_TRANSITION'),
  );
  const restored = await store.setWorkspaceNoteArchived(owner, a.id, todo.id, {
    archived: false,
  });
  assert.equal(restored.status, 'active');
  assert.equal(
    (
      await store.saveWorkspaceNote(owner, a.id, todo.id, {
        expected_version: 1,
        text: '- [x] call',
      })
    ).version,
    2,
  );
  // Nothing about notes reaches the audit history, so names and text cannot appear there.
  assert.equal(await audit(), before);

  // Another workspace has its own notes.
  assert.deepEqual(await store.listWorkspaceNotes(owner, b.id), { notes: [] });
  // Another member sees only their own notes and cannot read, save, rename or archive the
  // owner's: they are not found.
  assert.deepEqual(await store.listWorkspaceNotes(viewer, a.id), { notes: [] });
  await assert.rejects(
    store.workspaceNote(viewer, a.id, ideas.id),
    isCode('NOT_FOUND'),
  );
  await assert.rejects(
    store.saveWorkspaceNote(viewer, a.id, ideas.id, {
      expected_version: 2,
      text: 'x',
    }),
    isCode('NOT_FOUND'),
  );
  await assert.rejects(
    store.renameWorkspaceNote(viewer, a.id, ideas.id, { title: 'mine' }),
    isCode('NOT_FOUND'),
  );
  await assert.rejects(
    store.setWorkspaceNoteArchived(viewer, a.id, ideas.id, { archived: true }),
    isCode('NOT_FOUND'),
  );
  // The owner's note id used in another workspace is not found either.
  await assert.rejects(
    store.workspaceNote(owner, b.id, ideas.id),
    isCode('NOT_FOUND'),
  );
  // A viewer may keep notes of their own.
  const scratch = await store.createWorkspaceNote(viewer, a.id, {
    title: 'Scratch',
    text: 'viewer scratch',
  });
  // Notes leave with the person: removed and re-added, the viewer starts empty.
  await store.removeMember(owner, a.id, viewer.actorId, 'test');
  await store.addMember(owner, a.id, viewer.actorId, 'viewer');
  assert.deepEqual(await store.listWorkspaceNotes(viewer, a.id), { notes: [] });
  await assert.rejects(
    store.workspaceNote(viewer, a.id, scratch.id),
    isCode('NOT_FOUND'),
  );
  // A non-member cannot list, read, create or write, and cannot learn the workspace exists.
  await assert.rejects(
    store.listWorkspaceNotes(stranger, a.id),
    isCode('NOT_FOUND'),
  );
  await assert.rejects(
    store.createWorkspaceNote(stranger, a.id, { title: 'x' }),
    isCode('NOT_FOUND'),
  );
  // Too long, an empty or control-character name, or an extra field, is refused.
  await assert.rejects(
    store.saveWorkspaceNote(owner, a.id, ideas.id, {
      expected_version: 2,
      text: 'x'.repeat(NOTE_MAX + 1),
    }),
    isCode('INVALID_CONTRACT'),
  );
  for (const title of ['   ', 'a\nb', 'x'.repeat(NOTE_TITLE_MAX + 1)])
    await assert.rejects(
      store.createWorkspaceNote(owner, a.id, { title }),
      isCode('INVALID_CONTRACT'),
    );
  await assert.rejects(
    store.saveWorkspaceNote(owner, a.id, ideas.id, {
      expected_version: 2,
      text: 'x',
      actor_id: viewer.actorId,
    }),
    isCode('INVALID_CONTRACT'),
  );
  const full = await store.saveWorkspaceNote(owner, a.id, ideas.id, {
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
  const note = await store.createWorkspaceNote(owner, ws.id, {
    title: 'Race',
    text: 'base',
  });
  const results = await Promise.allSettled(
    ['left', 'right', 'third'].map((text) =>
      store.saveWorkspaceNote(owner, ws.id, note.id, {
        expected_version: 1,
        text,
      }),
    ),
  );
  const won = results.filter((r) => r.status === 'fulfilled');
  assert.equal(won.length, 1);
  for (const r of results)
    if (r.status === 'rejected')
      assert.ok(isCode('VERSION_CONFLICT')(r.reason));
  const after = await store.workspaceNote(owner, ws.id, note.id);
  assert.equal(after.version, 2);
  assert.equal(
    after.text,
    (won[0] as PromiseFulfilledResult<{ text: string }>).value.text,
  );
});

test('creating notes at once never passes the per-person limit', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner = await person(store, 'owner');
  const ws = await store.createWorkspace(owner, {
    name: 'Many',
    record_mode: 'fixture',
  });
  for (let i = 0; i < NOTES_PER_PERSON_MAX - 2; i++)
    await store.createWorkspaceNote(owner, ws.id, { title: `n${i}` });
  const results = await Promise.allSettled(
    [1, 2, 3, 4].map((i) =>
      store.createWorkspaceNote(owner, ws.id, { title: `race ${i}` }),
    ),
  );
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 2);
  for (const r of results)
    if (r.status === 'rejected') assert.ok(isCode('LIMIT_EXCEEDED')(r.reason));
  assert.equal(
    (await store.listWorkspaceNotes(owner, ws.id)).notes.length,
    NOTES_PER_PERSON_MAX,
  );
});

test('migration 46 turns each saved notepad into a note named "Notes", unchanged', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner = await person(store, 'owner');
  const other = await person(store, 'other');
  const ws = await store.createWorkspace(owner, {
    name: 'Old',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, other.actorId, 'viewer');
  // Test-only layout before 46: no named notes yet, two people with a saved notepad.
  await db.pool.query(
    'drop table personal_notes; delete from schema_migrations where version = 46',
  );
  const at = '2026-10-01T12:00:00.000Z';
  await db.pool.query(
    `insert into workspace_notes (workspace_id, actor_id, text, version, updated_at)
     values ($1, $2, 'old **notes**', 7, $4), ($1, $3, 'theirs', 1, $4)`,
    [ws.id, owner.actorId, other.actorId, at],
  );
  assert.deepEqual(await migrate(db.pool), [46]);
  const [note] = (await store.listWorkspaceNotes(owner, ws.id)).notes;
  const full = await store.workspaceNote(owner, ws.id, note!.id);
  assert.deepEqual(
    [
      full.title,
      full.text,
      full.version,
      full.status,
      full.from_notepad,
      full.updated_at,
    ],
    ['Notes', 'old **notes**', 7, 'active', true, at],
  );
  const theirs = (await store.listWorkspaceNotes(other, ws.id)).notes;
  assert.deepEqual(
    theirs.map((n) => [n.title, n.chars]),
    [['Notes', 6]],
  );
  // The original rows are kept as they were.
  assert.equal(
    Number(
      (await db.pool.query('select count(*)::int as n from workspace_notes'))
        .rows[0].n,
    ),
    2,
  );
  // An editor that loaded version 7 before the upgrade saves on top of it.
  assert.equal(
    (
      await store.saveWorkspaceNote(owner, ws.id, note!.id, {
        expected_version: 7,
        text: 'new',
      })
    ).version,
    8,
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
  assert.ok(now.items.every((i) => i.active));
  // Review L-2: a request cut off long ago is shown as stale, not as running.
  // A request still inside the longest allowed timeout (30 minutes) is not stale.
  await add(conn.id, 'verification', 'in_flight', 40 * 60_000);
  await add(conn.id, 'task', 'in_flight', 46 * 60_000);
  const later = await store.activityNow(owner, ws.id);
  const stale = later.items.find((i) => i.purpose === 'task')!;
  assert.equal(stale.active, false);
  assert.match(stale.state, /no answer recorded/);
  assert.equal(
    later.items.find((i) => i.purpose === 'verification')!.active,
    true,
  );
  // ADR-0062: timeouts have no 30-minute maximum now, so the stale point follows the
  // connection's own timeout (plus 15 minutes): a 2-hour request timeout keeps a 90-minute-old
  // request running, while one older than 2 h 15 min is stale.
  const slow = await store.createPlanConnection(owner, ws.id, {
    label: 'Slow plan',
    settings: {
      ...SETTINGS,
      caps: {
        ...SETTINGS.caps,
        responses: {
          ...SETTINGS.caps.responses,
          request_timeout_ms: 7_200_000,
        },
      },
    },
  });
  await add(slow.id, 'chat', 'in_flight', 90 * 60_000);
  await add(slow.id, 'qualification', 'in_flight', 140 * 60_000);
  const slowItems = (await store.activityNow(owner, ws.id)).items.filter(
    (i) => i.started_at < new Date(Date.now() - 80 * 60_000).toISOString(),
  );
  assert.deepEqual(
    slowItems.map((i) => [i.purpose, i.active]),
    [
      ['chat', true],
      ['qualification', false],
    ],
  );
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
    (await call('POST', `workspaces/${ws}/notes`, { title: 'x' }, auth.read))
      .status,
    403,
  );
  const made = await call('POST', `workspaces/${ws}/notes`, {
    title: 'Plan',
    text: 'hello',
  });
  assert.equal(made.status, 201);
  assert.equal(made.body.version, 1);
  const id = made.body.id as string;
  const note = `workspaces/${ws}/notes/${id}`;
  assert.equal(
    (await call('POST', note, { expected_version: 1, text: 'x' }, auth.read))
      .status,
    403,
  );
  const saved = await call('POST', note, { expected_version: 1, text: 'hi' });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.version, 2);
  const stale = await call('POST', note, {
    expected_version: 1,
    text: 'again',
  });
  assert.equal(stale.status, 409);
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  assert.equal((await call('GET', note)).body.text, 'hi');
  const list = await call('GET', `workspaces/${ws}/notes`);
  assert.deepEqual(
    list.body.notes.map((n: { title: string }) => n.title),
    ['Plan'],
  );
  const renamed = await call('POST', `${note}/rename`, {
    title: 'Launch plan',
  });
  assert.deepEqual([renamed.status, renamed.body.title], [200, 'Launch plan']);
  const archived = await call('POST', `${note}/archive`, { archived: true });
  assert.deepEqual([archived.status, archived.body.status], [200, 'archived']);
  const refused = await call('POST', note, { expected_version: 2, text: 'no' });
  assert.equal(refused.body.error.code, 'INVALID_TRANSITION');
  await call('POST', `${note}/archive`, { archived: false });
  assert.equal(
    (await call('GET', `workspaces/${ws}/notes/${randomUUID()}`)).status,
    404,
  );
  assert.equal((await call('GET', `${note}/rename`)).status, 404);
  // Review M-1: a full-length note saves through the route even when JSON spells every
  // character as an escape (control characters become \u00XX, six bytes each).
  const longest = '\u0001'.repeat(NOTE_MAX);
  const big = await call('POST', note, {
    expected_version: 2,
    text: longest,
  });
  assert.equal(big.status, 200);
  assert.equal(big.body.text.length, NOTE_MAX);
  const tooBig = await call('POST', note, {
    expected_version: 3,
    text: longest + 'x',
  });
  assert.equal(tooBig.status, 400);
  const now = await call('GET', `workspaces/${ws}/activity-now`);
  assert.equal(now.status, 200);
  assert.deepEqual(now.body.items, []);
  assert.equal(
    (await call('POST', `workspaces/${ws}/activity-now`, {})).status,
    404,
  );
});
