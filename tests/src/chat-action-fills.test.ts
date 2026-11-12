import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  CHAT_FILL_INSTRUCTIONS,
  CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  ContractError,
  fillableKey,
  readFillValues,
  type ErrorCode,
  type PlanConnection,
} from '@creator/contracts';
import { ConnectionStore, fillInput, type CommandContext } from '@creator/db';
import { PlanConnectionService, type ClaudeCodeHost } from '@creator/broker';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import {
  SUBSCRIBED,
  fakeCalls,
  setFake,
  writeFakeClaude,
} from './claude-fake.js';

// ADR-0096 (P31): "Fill in with <model>" on a Chat card. The chat model proposes text for a
// draft card's descriptive questions, under exactly the chat answer's admission. The proposal
// is recorded with what was sent; it answers nothing, changes nothing on the card, and the
// card is still sent only by the person's Send. Everything runs a fake `claude`.

const root = new URL('../../', import.meta.url);
const SETTINGS = JSON.parse(
  readFileSync(new URL('config/connections/claude-code.json', root), 'utf8'),
) as PlanConnection['settings'];
const MODEL = 'claude-test-model';
const owner: CommandContext = { actorId: randomUUID() };
const rejects = (code: ErrorCode, p: Promise<unknown>, detail?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(
      e.code,
      code,
      `${e.code}: ${e.message} ${e.details.join(' | ')}`,
    );
    if (detail) assert.match([e.message, ...e.details].join(' | '), detail);
    return true;
  });

const Q = {
  theme: {
    key: 'theme',
    label: 'Theme',
    prompt: 'What should the discovery look into? Name a setting or group.',
    type: 'text' as const,
  },
  users: {
    key: 'target_users',
    label: 'Who is affected',
    prompt: 'Who is affected?',
    help: 'Passage: SECRET-RECORD-TEXT',
    type: 'text' as const,
    current: 'SECRET-ANSWER-SO-FAR',
  },
};

test('fill replies: only text for the asked questions is read; judgments are never fillable', () => {
  const got = readFillValues(
    '```json\n{"values": {"theme": "  Rural clinic waits ", "target_users": "", "oversight": "supervised", "measurable_problem": 3}}\n```',
    [Q.theme, Q.users],
  );
  assert.deepEqual(got.values, { theme: 'Rural clinic waits' });
  assert.equal(got.dropped, 3);
  assert.equal(got.readable, true);
  assert.equal(
    readFillValues('{"values": {"theme": "x"}}', [Q.theme]).values.theme,
    'x',
  );
  // Too long for a one-line field is dropped, not cut.
  assert.equal(
    readFillValues(JSON.stringify({ values: { theme: 'x'.repeat(501) } }), [
      Q.theme,
    ]).dropped,
    1,
  );
  assert.equal(readFillValues('Sure! Here you go.', [Q.theme]).readable, false);
  assert.equal(readFillValues('{"theme": "x"}', [Q.theme]).readable, false);

  // Descriptive text only: no pick, rating, gate, stance, reason, decision or routine setting.
  for (const [kind, key] of [
    ['start_discovery', 'theme'],
    ['start_discovery', 'field_b'],
    ['cite_claim', 'statement'],
    ['cite_claim', 'quote'],
    ['fetch_source', 'url'],
    ['save_proposal', 's_problem'],
  ] as const)
    assert.ok(fillableKey(kind, key), `${kind}.${key}`);
  for (const [kind, key] of [
    ['start_discovery', 'claims'],
    ['start_discovery', 'oversight'],
    ['start_discovery', 'budget_limit'],
    ['cite_claim', 'stance'],
    ['cite_claim', 'rationale'],
    ['fetch_source', 'run'],
    ['fund_budget', 'cap'],
    ['answer_decision', 'rationale'],
    ['score_option', 'w_impact'],
    ['record_choice', 'why_x'],
    ['save_proposal', 'option'],
  ] as const)
    assert.ok(!fillableKey(kind, key), `${kind}.${key}`);
});

test('fill input: studio records in help and earlier answers go only when allowed; old turns drop first', () => {
  const history = [
    { who: 'person' as const, text: 'old turn '.repeat(40) },
    { who: 'person' as const, text: 'Clinic <waits> are long' },
  ];
  const withRecords = fillInput({
    step: 'Start a discovery',
    history,
    questions: [Q.theme, Q.users],
    records: true,
    maxChars: 10_000,
  })!;
  assert.match(withRecords.input, /SECRET-RECORD-TEXT/);
  assert.match(withRecords.input, /SECRET-ANSWER-SO-FAR/);
  assert.match(withRecords.input, /Clinic &lt;waits&gt; are long/);
  const without = fillInput({
    step: 'Start a discovery',
    history,
    questions: [Q.theme, Q.users],
    records: false,
    maxChars: 10_000,
  })!;
  assert.doesNotMatch(without.input, /SECRET/);
  assert.match(without.input, /key: target_users/);
  const tight = fillInput({
    step: 'Start a discovery',
    history,
    questions: [Q.theme],
    records: false,
    maxChars: 600,
  })!;
  assert.equal(tight.history_items, 1);
  assert.doesNotMatch(tight.input, /old turn/);
  assert.equal(
    fillInput({
      step: 'x',
      history,
      questions: [Q.theme],
      records: false,
      maxChars: 50,
    }),
    null,
  );
});

function fakeHost(text: string): ClaudeCodeHost {
  const dir = mkdtempSync(join(tmpdir(), 'creator-fill-'));
  const bin = writeFakeClaude(join(dir, 'bin'));
  const config_dir = join(dir, 'config');
  setFake(config_dir, { status: SUBSCRIBED, text });
  return { bin, config_dir, work_dir: join(config_dir, 'empty-workdir') };
}

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const host = fakeHost(
    JSON.stringify({
      values: {
        theme: 'Rural clinic waits',
        target_users: 'Rural patients',
        oversight: 'supervised',
        claims: ['x'],
      },
    }),
  );
  const service = new PlanConnectionService({
    store,
    vault: null,
    claudeCode: host,
    claudeCodeFixtureEnv: { CREATOR_CLAUDE_STAND_IN: 'fake' },
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Card fills',
    record_mode: 'fixture',
  });
  let conn = await store.createPlanConnection(owner, ws.id, {
    kind: 'claude_code',
    label: 'Claude Code on this computer',
    settings: SETTINGS,
  });
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  await service.checkClaudeCode(owner, ws.id, conn.id);
  conn = await current();
  await store.attestPlanCredits(owner, ws.id, conn.id, {
    expected_version: conn.version,
    statement: CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
    checked_on: '2026-11-01',
  });
  conn = await current();
  await store.acceptPlanCaps(owner, ws.id, conn.id, {
    expected_version: conn.version,
    settings_hash: conn.settings_hash,
  });
  conn = await current();
  const g = await store.createPlanVerificationGrant(owner, ws.id, conn.id, {
    expected_version: conn.version,
    model_id: MODEL,
    path: 'responses',
    expires_in_minutes: 30,
  });
  await service.verifyModel(owner, ws.id, conn.id, {
    id: g.id,
    model_id: MODEL,
  });
  let c = await current();
  await store.updatePlanSettings(owner, ws.id, c.id, {
    expected_version: c.version,
    settings: {
      ...c.settings,
      allowed_data_classes: [
        ...c.settings.allowed_data_classes,
        'private_approved',
      ],
    },
  });
  c = await current();
  await store.acceptPlanCaps(owner, ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  const runs = () =>
    fakeCalls(host.config_dir).filter((x) => x.args[0] === '-p');
  const chat = await store.createChat(owner, ws.id, {});
  await store.postChatMessage(owner, ws.id, chat.id, {
    client_id: randomUUID(),
    text: 'I keep hearing that rural patients wait weeks for a clinic slot.',
  });
  const card = (kind = 'start_discovery') =>
    store.createChatAction(owner, ws.id, chat.id, {
      client_id: randomUUID(),
      kind,
      input: { _op: randomUUID() },
    });
  return { db, store, service, host, ws, conn, chat, runs, card };
}

test('fill in with the model: owner only, chat admission, proposals only, card unchanged, retried once', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, service, ws, chat } = s;
  const card = await s.card();
  // The model check during setup ran once; count from here.
  const before = s.runs().length;
  const fill = (
    who: CommandContext,
    over: Record<string, unknown> = {},
    cardId = card.id,
  ) =>
    service.chatActionFill(who, ws.id, chat.id, cardId, {
      client_id: randomUUID(),
      expected_version: 1,
      questions: [Q.theme, Q.users],
      ...over,
    });

  // Chat answers are off: refused before anything is recorded or sent.
  await rejects('ACCESS_DENIED', fill(owner), /turned off/);
  await store.setChatSettings(owner, ws.id, {
    expected_version: 0,
    enabled: true,
    connection_id: s.conn.id,
    model_id: MODEL,
    include_snapshot: false,
    daily_limit: 3,
  });

  // A model never proposes a pick, a judgment or a routine setting; the store checks the keys.
  await rejects(
    'ACCESS_DENIED',
    fill(owner, {
      questions: [
        Q.theme,
        { key: 'oversight', label: 'Oversight', prompt: 'How?', type: 'text' },
      ],
    }),
    /descriptive text[\s\S]*oversight/,
  );
  const decision = await s.card('answer_decision');
  await rejects(
    'ACCESS_DENIED',
    fill(
      owner,
      {
        questions: [
          { key: 'rationale', label: 'Why', prompt: 'Why?', type: 'long' },
        ],
      },
      decision.id,
    ),
  );
  // Only the owner asks, as for chat answers.
  const editor: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'editor',
  });
  await store.addMember(owner, ws.id, editor.actorId, 'editor');
  await rejects('ACCESS_DENIED', fill(editor));
  // Against an older version of the card.
  await rejects('VERSION_CONFLICT', fill(owner, { expected_version: 2 }));
  assert.equal(s.runs().length, before, 'nothing was sent');

  const cid = randomUUID();
  const done = await fill(owner, { client_id: cid });
  assert.equal(done.state, 'completed', done.reason ?? '');
  assert.deepEqual(done.values, {
    theme: 'Rural clinic waits',
    target_users: 'Rural patients',
  });
  assert.equal(done.dropped, 2);
  assert.match(done.reason ?? '', /2 proposals were left out/);
  assert.ok(done.plan_request_id);
  // Exactly that input went, with the fixed fill instructions, and without studio records
  // (the owner's chat setting leaves them out).
  assert.equal(s.runs().length, before + 1);
  const sent = s.runs().at(-1)!;
  assert.equal(sent.stdin, done.sent?.input);
  assert.equal(sent.system, CHAT_FILL_INSTRUCTIONS);
  assert.equal(done.sent?.records, false);
  assert.match(done.sent?.input ?? '', /rural patients wait weeks/);
  assert.doesNotMatch(done.sent?.input ?? '', /SECRET/);

  // It answered nothing: the card is as it was.
  const detail = await store.chatDetail(owner, ws.id, chat.id);
  const after = detail.actions.find((a) => a.id === card.id)!;
  assert.equal(after.version, 1);
  assert.equal(after.state, 'draft');
  assert.deepEqual(Object.keys(after.input), ['_op']);
  assert.deepEqual(
    detail.fills.map((f) => f.id),
    [done.id],
  );

  // A retried press returns the same fill and sends nothing.
  const again = await fill(owner, { client_id: cid });
  assert.equal(again.id, done.id);
  assert.equal(s.runs().length, before + 1);

  // Fills count against the daily chat limit, like answers (3 here).
  await fill(owner);
  const limited = await fill(owner);
  assert.equal(limited.state, 'completed');
  const over = await fill(owner);
  assert.equal(over.state, 'refused');
  assert.match(over.reason ?? '', /daily chat limit/);
  assert.equal(over.sent, null);
  assert.equal(s.runs().length, before + 3);

  // A reply that is not the asked JSON proposes nothing.
  await store.setChatSettings(owner, ws.id, {
    expected_version: 1,
    enabled: true,
    connection_id: s.conn.id,
    model_id: MODEL,
    include_snapshot: true,
    daily_limit: 10,
  });
  // A brace in prose before the JSON does not hide it (review N-5).
  setFake(s.host.config_dir, {
    status: SUBSCRIBED,
    text: 'Fill {key} like this:\n```json\n{"values": {"theme": "Clinic waits"}}\n```',
  });
  const braced = await fill(owner);
  assert.deepEqual(braced.values, { theme: 'Clinic waits' });
  // Review L-3: the answer so far comes from the saved card, not from the page, and the
  // length of each question is the server's (an address is one line).
  const saved = await store.updateChatAction(owner, ws.id, chat.id, card.id, {
    expected_version: 1,
    input: { ...card.input, target_users: 'SAVED-ON-THE-CARD' },
    subjects: [],
  });
  setFake(s.host.config_dir, { status: SUBSCRIBED, text: 'Happy to help!' });
  const prose = await fill(owner, {
    expected_version: saved.version,
    questions: [Q.theme, { ...Q.users, type: 'long' }],
  });
  assert.match(prose.sent?.input ?? '', /SAVED-ON-THE-CARD/);
  assert.doesNotMatch(prose.sent?.input ?? '', /SECRET-ANSWER-SO-FAR/);
  assert.match(prose.sent?.input ?? '', /key: target_users \(one line/);
  assert.equal(prose.state, 'completed');
  assert.deepEqual(prose.values, {});
  assert.match(prose.reason ?? '', /not the JSON/);
  // With studio records allowed, the question help and answers so far go too.
  assert.equal(prose.sent?.records, true);
  assert.match(prose.sent?.input ?? '', /SECRET-RECORD-TEXT/);

  // Settled fills never change.
  await assert.rejects(
    s.db.pool.query(
      `update chat_action_fills set fill_values = '{}' where id = $1`,
      [done.id],
    ),
    /change only once/,
  );
  // The audit trail names the fill, card and keys, never the words.
  const audit = await s.db.pool.query(
    `select action, payload::text as p from audit_events
     where action like 'chat.action_fill%' order by sequence`,
  );
  assert.ok(audit.rows.some((r) => r.action === 'chat.action_fill_requested'));
  for (const r of audit.rows) {
    assert.doesNotMatch(String(r.p), /Rural clinic waits|rural patients/i);
  }
  assert.ok(
    (
      await s.db.pool.query(
        `select 1 from audit_events where action = 'chat.action_filled'`,
      )
    ).rows.length >= 4,
  );

  // A sent card is no longer filled in.
  await store.sendChatAction(owner, ws.id, chat.id, card.id, {
    expected_version: saved.version,
  });
  await rejects(
    'INVALID_TRANSITION',
    fill(owner, { expected_version: saved.version }),
  );

  // The conversation (cards and fills with it) can still be deleted, whichever cascade
  // reaches the fills first (review M-1). Recreating the cards' conversation key gives its
  // cascade trigger a newer name, so the conversation's cascade reaches the fills while their
  // card still exists, as after a backup restore.
  await s.db.pool.query(`alter table chat_actions
    drop constraint chat_actions_workspace_id_conversation_id_fkey,
    add constraint chat_actions_workspace_id_conversation_id_fkey
      foreign key (workspace_id, conversation_id)
      references chat_conversations (workspace_id, id) on delete cascade`);
  const deleted = await store.deleteChat(owner, ws.id, chat.id);
  assert.equal(deleted.id, chat.id);
  assert.equal(
    (await s.db.pool.query('select count(*)::int as n from chat_action_fills'))
      .rows[0].n,
    0,
  );
});

test('fill route: owner only over HTTP, refused while chat answers are off', async (t) => {
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
    await call('POST', 'workspaces', {
      name: 'Fill routes',
      record_mode: 'fixture',
    })
  ).body.id as string;
  const chat = (await call('POST', `workspaces/${ws}/chats`, {})).body
    .id as string;
  const card = await call('POST', `workspaces/${ws}/chats/${chat}/actions`, {
    client_id: randomUUID(),
    kind: 'start_discovery',
    input: {},
  });
  assert.equal(card.status, 201, JSON.stringify(card.body));
  const path = `workspaces/${ws}/chats/${chat}/actions/${card.body.id}/fill`;
  const off = await call('POST', path, {
    client_id: randomUUID(),
    expected_version: 1,
    questions: [Q.theme],
  });
  assert.equal(off.status, 403, JSON.stringify(off.body));
  assert.match(off.body.error?.message ?? JSON.stringify(off.body), /off/);
  const bad = await call('POST', path, {
    client_id: randomUUID(),
    expected_version: 1,
    questions: [],
  });
  assert.equal(bad.status, 400);
  const detail = await call('GET', `workspaces/${ws}/chats/${chat}`);
  assert.deepEqual(detail.body.fills, []);
});
