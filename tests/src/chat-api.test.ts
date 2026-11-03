import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { classifyChat, chatTitle } from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0055: the studio chat's first version. Conversations and the person's messages are
// saved; the server alone decides each message's intent; nothing calls a model or starts work.

test('chat messages are sorted by fixed rules, in a stable order', () => {
  const cases: [string, string, Record<string, string>][] = [
    ["What's next?", 'next', {}],
    ['where do I start', 'next', {}],
    ['Why is the build blocked?', 'why_blocked', {}],
    ['What is waiting for me to approve?', 'approvals', {}],
    [
      'Add https://www.idiocode.com/blog/frame-perfect.html please.',
      'add_source',
      { url: 'https://www.idiocode.com/blog/frame-perfect.html' },
    ],
    // A web address wins over every other rule.
    [
      'save this idea: compare https://example.org/a',
      'add_source',
      { url: 'https://example.org/a' },
    ],
    [
      'Save this idea: a practice timer for frame-perfect inputs',
      'save_idea',
      { text: 'a practice timer for frame-perfect inputs' },
    ],
    ['remember', 'save_idea', {}],
    [
      'Start a discovery about rural clinic no-shows',
      'start_discovery',
      { text: 'rural clinic no-shows' },
    ],
    [
      'research input timing drills',
      'start_discovery',
      { text: 'input timing drills' },
    ],
    // ADR-0065: no theme at all is a request to explore, not a theme called "me".
    ['Explore for me', 'start_discovery', {}],
    ['find me some problems to work on', 'start_discovery', {}],
    ['What should I build?', 'start_discovery', {}],
    ['The demo went well today.', 'note', {}],
    // "saved" is not "save": a sentence that merely mentions saving stays a note.
    ['I saved the file yesterday.', 'note', {}],
  ];
  for (const [text, intent, target] of cases)
    assert.deepEqual(classifyChat(text), { intent, target }, text);
  assert.equal(chatTitle('  short   title '), 'short title');
  const long = chatTitle(
    'A practice timer for frame-perfect inputs in fighting games with a metronome mode',
  );
  assert.ok(long.length <= 61 && long.endsWith('…'), long);
});

test('chat API: conversations, server-sorted messages, retries, search and access', async (t) => {
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
  const call = async (method: string, path: string, body?: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(method === 'GET' ? auth.read : auth.write),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ws = (
    await call('POST', 'workspaces', { name: 'Chat A', record_mode: 'fixture' })
  ).body.id as string;
  const other = (
    await call('POST', 'workspaces', { name: 'Chat B', record_mode: 'fixture' })
  ).body.id as string;

  const started = await call('POST', `workspaces/${ws}/chats`, {});
  assert.equal(started.status, 201);
  assert.equal(started.body.title, 'New conversation');
  assert.equal(started.body.messages, 0);
  const chat = started.body.id as string;

  // The client sends only words; the server decides the intent (an `intent` field is refused).
  const smuggled = await call(
    'POST',
    `workspaces/${ws}/chats/${chat}/messages`,
    {
      client_id: randomUUID(),
      text: "What's next?",
      intent: 'approvals',
    },
  );
  assert.equal(smuggled.status, 400);
  const first = randomUUID();
  const sent = await call('POST', `workspaces/${ws}/chats/${chat}/messages`, {
    client_id: first,
    text: 'Save this idea: a practice timer for frame-perfect inputs',
  });
  assert.equal(sent.status, 201);
  assert.equal(sent.body.intent, 'save_idea');
  assert.equal(sent.body.seq, 1);
  assert.deepEqual(sent.body.target, {
    text: 'a practice timer for frame-perfect inputs',
  });
  // A retried send returns the saved message instead of adding a second one.
  const retry = await call('POST', `workspaces/${ws}/chats/${chat}/messages`, {
    client_id: first,
    text: 'Save this idea: a practice timer for frame-perfect inputs',
  });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.id, sent.body.id);
  // The same id with other words is refused, not silently replaced.
  const reused = await call('POST', `workspaces/${ws}/chats/${chat}/messages`, {
    client_id: first,
    text: 'Something else',
  });
  assert.equal(reused.status, 409);
  // Several sends at once each get their own place.
  const parallel = await Promise.all(
    ['https://example.org/page', "what's next", 'why is it blocked'].map(
      (text) =>
        call('POST', `workspaces/${ws}/chats/${chat}/messages`, {
          client_id: randomUUID(),
          text,
        }),
    ),
  );
  assert.ok(parallel.every((p) => p.status === 201));
  const detail = await call('GET', `workspaces/${ws}/chats/${chat}`);
  assert.equal(detail.status, 200);
  assert.deepEqual(
    detail.body.messages.map((m: { seq: number }) => m.seq),
    [1, 2, 3, 4],
  );
  assert.deepEqual(
    new Set(detail.body.messages.map((m: { intent: string }) => m.intent)),
    new Set(['save_idea', 'add_source', 'next', 'why_blocked']),
  );
  // The first message named the conversation; renaming changes only the title.
  assert.equal(
    detail.body.conversation.title,
    'Save this idea: a practice timer for frame-perfect inputs',
  );
  const renamed = await call('POST', `workspaces/${ws}/chats/${chat}/title`, {
    title: 'Timer ideas',
  });
  assert.equal(renamed.body.title, 'Timer ideas');
  assert.equal(renamed.body.messages, 4);

  // Search matches titles and message text, and nothing from another workspace.
  await call('POST', `workspaces/${other}/chats`, { title: 'Timer in B' });
  const found = await call('GET', `workspaces/${ws}/chats?q=FRAME-PERFECT`);
  assert.deepEqual(
    found.body.map((c: { id: string }) => c.id),
    [chat],
  );
  assert.equal(
    (await call('GET', `workspaces/${ws}/chats?q=100%25`)).body.length,
    0,
  );
  assert.equal(
    (await call('GET', `workspaces/${other}/chats?q=Timer`)).body.length,
    1,
  );
  // Another workspace's address cannot reach this conversation.
  assert.equal(
    (await call('GET', `workspaces/${other}/chats/${chat}`)).status,
    404,
  );
  assert.equal(
    (
      await call('POST', `workspaces/${other}/chats/${chat}/messages`, {
        client_id: randomUUID(),
        text: 'hello',
      })
    ).status,
    404,
  );

  // Saved messages never change; the audit trail keeps the kind of ask, not the words.
  await assert.rejects(
    db.pool.query(
      `update chat_messages set text = 'edited' where conversation_id = $1`,
      [chat],
    ),
  );
  const audit = await db.pool.query(
    `select action, payload from audit_events where subject_id = $1 order by sequence`,
    [chat],
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    [
      'chat.started',
      'chat.message',
      'chat.message',
      'chat.message',
      'chat.message',
      'chat.renamed',
    ],
  );
  for (const row of audit.rows)
    assert.doesNotMatch(JSON.stringify(row.payload), /frame-perfect/);

  // A viewer reads conversations but cannot write to them.
  const store = api.store!;
  const viewer = { actorId: randomUUID() };
  await store.ensureActor({
    id: viewer.actorId,
    kind: 'human',
    display_name: 'viewer',
  });
  await store.addMember(
    { actorId: DEFAULT_OWNER_ACTOR_ID },
    ws,
    viewer.actorId,
    'viewer',
  );
  assert.equal((await store.listChats(viewer, ws)).length, 1);
  assert.equal((await store.chatDetail(viewer, ws, chat)).messages.length, 4);
  await assert.rejects(store.createChat(viewer, ws, {}), /only read/);
  await assert.rejects(
    store.postChatMessage(viewer, ws, chat, {
      client_id: randomUUID(),
      text: 'hi',
    }),
    /only read/,
  );
  // Someone outside the workspace learns nothing about it.
  const stranger = { actorId: randomUUID() };
  await store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'x',
  });
  await assert.rejects(store.listChats(stranger, ws), /not found/i);

  // ADR-0063: the delete route removes the conversation and its messages; a viewer cannot.
  await assert.rejects(store.deleteChat(viewer, ws, chat), /only read/);
  const deleted = await call(
    'POST',
    `workspaces/${ws}/chats/${chat}/delete`,
    {},
  );
  assert.equal(deleted.status, 200);
  assert.deepEqual(deleted.body, { id: chat, messages: 4, answers: 0 });
  assert.equal(
    (await call('GET', `workspaces/${ws}/chats/${chat}`)).status,
    404,
  );
  assert.equal(
    (await call('POST', `workspaces/${ws}/chats/${chat}/delete`, {})).status,
    404,
  );
  assert.equal((await call('GET', `workspaces/${ws}/chats`)).body.length, 0);
});
