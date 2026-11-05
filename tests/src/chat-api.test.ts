import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import {
  classifyChat,
  chatTitle,
  chatMentionsStudio,
  resolveChatContext,
  ChatMessageRequestSchema,
} from '@creator/contracts';
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
    ['Surprise me!', 'start_discovery', {}],
    [
      'explore for me rural clinics',
      'start_discovery',
      { text: 'rural clinics' },
    ],
    // Messages about defects are not exploration requests (PR #131 review L-4).
    ['show me problems with the build', 'note', {}],
    ['find problems in my spec', 'note', {}],
    ['show me a problem', 'note', {}],
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

// ADR-0070 (P03): a broad request is not swallowed as a studio command, and an explicit
// General choice wins over every rule.
test('chat rules leave general requests to the model; explicit General wins', () => {
  const notes = [
    'Write a short story about a lighthouse keeper.',
    'Brainstorm names for a bakery.',
    "Why can't penguins fly?",
    'Why do cats purr?',
    'How do I fix a blocked drain?',
    'Help me draft an email asking my boss to approve my vacation.',
    'What decisions should I make before buying a house?',
    "What's next for electric cars?",
    'Where do I start with learning the piano?',
    'Explain the CAP theorem with an example.',
    'Can you compare Rust and Go for a small CLI?',
    // PR #136 review L3: broad requests the older rules used to swallow.
    'Research how vaccines work',
    'Explore the themes of Hamlet',
    'Remember to be concise',
    "I'm stuck on my essay intro",
    'My drain is blocked',
    // PR #139 re-review L-C: standing instructions and remarks are not ideas to save.
    'Remember that I prefer short answers',
    'Remember I like bullet points',
    'Note that the deadline is Friday',
    'Save me a seat',
    'remember that',
    // PR #139 third review L-1: general requests that mention a stuck or blocked build.
    'How do I fix a stuck build in Jenkins?',
    'Write an email to my team saying the build is blocked',
    'Explain why npm install gets stuck on every run',
    'What causes a Docker build to get stuck?',
    'Help me write a spec for a stuck elevator alarm',
  ];
  for (const text of notes)
    assert.deepEqual(classifyChat(text), { intent: 'note', target: {} }, text);
  // Studio questions still reach their cards.
  const studio: [string, string][] = [
    ['Why is my run stuck?', 'why_blocked'],
    ["I can't start the build", 'why_blocked'],
    ['Why is the build blocked?', 'why_blocked'],
    ['What needs my approval?', 'approvals'],
    ['Are there pending approvals?', 'approvals'],
    ['approve', 'approvals'],
    ['Next step?', 'next'],
    ['What is my next step?', 'next'],
    ['so what do I do next', 'next'],
    // PR #136 review M1: short studio questions that open like general ones.
    ["What's blocked?", 'why_blocked'],
    ['Is anything blocked?', 'why_blocked'],
    ['anything stuck?', 'why_blocked'],
    ['Why is it blocked?', 'why_blocked'],
    ['What needs approval?', 'approvals'],
    ['Anything waiting?', 'approvals'],
    ["What's waiting?", 'approvals'],
    ['research input timing drills', 'start_discovery'],
    ['remember', 'save_idea'],
    // PR #139 re-review L-C: close variants.
    ['Is there anything blocked?', 'why_blocked'],
    ['Are any runs blocked?', 'why_blocked'],
    ['Everything is blocked', 'why_blocked'],
    ['Anything pending?', 'approvals'],
    ['Do I need to approve anything?', 'approvals'],
    ['remember this idea: a timer', 'save_idea'],
    // PR #139 third review L-2: real saves through "that"/"my".
    ['Remember that idea about timers', 'save_idea'],
    ['Note that idea: a timer', 'save_idea'],
    ['Remember my thought: a timer app', 'save_idea'],
    ['Note my note: buy milk', 'save_idea'],
  ];
  for (const [text, intent] of studio)
    assert.equal(classifyChat(text).intent, intent, text);
  // An explicit choice (General, My projects or Selected records): always answered with that
  // context, never a command or a source (PR #136 review M2).
  for (const scope of ['general', 'project', 'selected'] as const)
    for (const text of [
      "What's next?",
      'Why is it blocked?',
      'Save this idea: a timer',
      'research input timing drills',
      'https://example.org/a',
      "Why won't my idea work?",
    ])
      assert.deepEqual(
        classifyChat(text, scope),
        {
          intent: 'note',
          target: {},
        },
        `${scope}: ${text}`,
      );
  assert.equal(classifyChat("What's next?", 'auto').intent, 'next');

  // Studio mentions decide Automatic context; topics alone do not.
  for (const t of [
    'Summarise my ideas',
    'compare my two newest projects',
    'How is my studio doing?',
    'what do our runs show',
  ])
    assert.ok(chatMentionsStudio(t), t);
  for (const t of [
    'What are the problems with remote work?',
    'Give me product ideas for gardeners',
    'How do I add a source in Creator Agent?',
    // PR #136 review L2: ordinary uses of "the project/workspace/studio".
    'Tell me about the projects of Frank Lloyd Wright',
    "What's the best way to structure the workspace in my garage?",
    'Make a list of pros and cons of the studio apartment',
    'Suggest a name for this project',
    // PR #139 re-review L-D.
    'How should I decorate my studio apartment?',
    "What's the best desk for my workspace setup?",
  ])
    assert.ok(!chatMentionsStudio(t), t);
  const r = (
    scope: 'auto' | 'general' | 'project' | 'selected',
    text: string,
    allowStudio = true,
  ) => resolveChatContext({ scope, text, allowStudio });
  assert.deepEqual(
    [r('auto', 'Write a poem'), r('auto', 'Rank my ideas')].map((x) =>
      x.ok ? x.context : 'refused',
    ),
    ['general', 'project'],
  );
  const chosen = r('general', 'Rank my ideas');
  assert.ok(chosen.ok && chosen.context === 'general');
  const off = r('auto', 'Rank my ideas', false);
  assert.ok(
    off.ok && off.context === 'general' && /turned off/.test(off.reason),
  );
  assert.equal(r('project', 'x', false).ok, false);
  assert.equal(r('selected', 'x', false).ok, false);

  // The request shape keeps picks and scope consistent.
  const base = { client_id: randomUUID(), text: 'Hi' };
  assert.equal(ChatMessageRequestSchema.parse(base).scope, 'auto');
  assert.ok(
    !ChatMessageRequestSchema.safeParse({ ...base, scope: 'selected' }).success,
  );
  const one = randomUUID();
  assert.ok(
    !ChatMessageRequestSchema.safeParse({
      ...base,
      scope: 'general',
      selected: [one],
    }).success,
  );
  assert.ok(
    !ChatMessageRequestSchema.safeParse({
      ...base,
      scope: 'selected',
      selected: [one, one],
    }).success,
  );
  assert.ok(
    !ChatMessageRequestSchema.safeParse({
      ...base,
      scope: 'selected',
      selected: Array.from({ length: 6 }, () => randomUUID()),
    }).success,
  );
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
