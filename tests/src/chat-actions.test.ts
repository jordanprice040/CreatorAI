import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  readProposedAction,
  withoutProposedAction,
  type ErrorCode,
} from '@creator/contracts';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0083 (P20): action cards in Chat. A card stores the answers and the records it was made
// from; the person's browser sends it through the form's own routes, each request naming the
// card's send as its cause; the store reports what happened from the audit trail, not from the
// browser's word alone. A changed record makes a card stale before anything is sent.

const rejects = (code: ErrorCode, p: Promise<unknown>, detail?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(e.code, code, `${e.code}: ${e.message}`);
    if (detail) assert.match([e.message, ...e.details].join(' | '), detail);
    return true;
  });

test('a model may suggest one allowed card with short hints, and nothing else', () => {
  const ok = readProposedAction(
    'Here is a theme.\n<propose_action kind="start_discovery">{"text": "clinic waits"}</propose_action>',
  );
  assert.deepEqual(ok, {
    found: true,
    ok: true,
    kind: 'start_discovery',
    hints: { text: 'clinic waits' },
  });
  assert.equal(
    withoutProposedAction(
      'Here.\n<propose_action kind="fund_budget"></propose_action>',
    ),
    'Here.',
  );
  assert.deepEqual(readProposedAction('No suggestion here.'), {
    found: false,
  });
  const refused = (text: string, reason: RegExp) => {
    const r = readProposedAction(text);
    assert.ok(r.found && !r.ok, text);
    assert.match((r as { reason: string }).reason, reason);
  };
  // Answering a decision is never suggested by a model, and unknown kinds are not cards.
  refused(
    '<propose_action kind="answer_decision">{}</propose_action>',
    /does not offer/,
  );
  refused(
    '<propose_action kind="grant_access">{}</propose_action>',
    /does not offer/,
  );
  // Hints never carry an id of authority, a cap or an answer.
  refused(
    '<propose_action kind="fund_budget">{"cap_nano_usd": "999"}</propose_action>',
    /fields a card does not take/,
  );
  refused(
    '<propose_action kind="fetch_source">{"url": "not a url"}</propose_action>',
    /fields a card does not take/,
  );
  refused(
    '<propose_action kind="fund_budget">{oops</propose_action>',
    /not readable/,
  );
  refused(
    '<propose_action kind="fund_budget"></propose_action> <propose_action kind="cite_claim"></propose_action>',
    /more than one/,
  );
});

test('chat cards over HTTP: a send names its requests; done, unconfirmed and refused come from the audit trail', async (t) => {
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
    extra: Record<string, string> = {},
  ) => {
    const r = await fetch(`${base}/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(method === 'GET' ? auth.read : auth.write),
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ws = (
    await call('POST', 'workspaces', { name: 'Cards', record_mode: 'fixture' })
  ).body.id as string;
  const chat = (await call('POST', `workspaces/${ws}/chats`, {})).body
    .id as string;
  const cards = `workspaces/${ws}/chats/${chat}/actions`;
  const budget = (name: string, cap = '1000000000') => ({
    parent_id: null,
    kind: 'global',
    run_id: null,
    name,
    cap_nano_usd: cap,
    starts_at: null,
    ends_at: null,
    max_in_flight: 4,
  });
  const make = async (input: Record<string, unknown> = {}) => {
    const r = await call('POST', cards, {
      client_id: randomUUID(),
      kind: 'fund_budget',
      input,
    });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };

  // A retried click returns the same card instead of adding a second.
  const client_id = randomUUID();
  const c1 = (
    await call('POST', cards, { client_id, kind: 'fund_budget', input: {} })
  ).body;
  const again = await call('POST', cards, {
    client_id,
    kind: 'fund_budget',
    input: {},
  });
  assert.equal(again.body.id, c1.id);
  assert.equal(c1.state, 'draft');
  assert.equal(c1.origin, 'studio');
  // Answers are saved against the version the page saw.
  const stale = await call('POST', `${cards}/${c1.id}`, {
    expected_version: 2,
    input: { name: 'Studio budget' },
    subjects: [],
  });
  assert.equal(stale.body.error.code, 'VERSION_CONFLICT');
  const filled = (
    await call('POST', `${cards}/${c1.id}`, {
      expected_version: 1,
      input: { name: 'Studio budget' },
      subjects: [],
    })
  ).body;
  assert.equal(filled.version, 2);

  // Send: the store records who sent it and returns the cause every request names.
  const sent = (
    await call('POST', `${cards}/${c1.id}/send`, { expected_version: 2 })
  ).body;
  assert.equal(sent.action.state, 'sending');
  assert.ok(sent.causation_id);
  const trace = {
    'X-Causation-Id': sent.causation_id,
    'X-Correlation-Id': c1.id,
  };
  // The form's own route does the work, with its own checks.
  const made = await call(
    'POST',
    `workspaces/${ws}/budgets`,
    budget('Studio budget'),
    trace,
  );
  assert.equal(made.status, 201, JSON.stringify(made.body));
  // A card already on its way cannot be sent twice.
  const twice = await call('POST', `${cards}/${c1.id}/send`, {
    expected_version: 3,
  });
  assert.equal(twice.body.error.code, 'INVALID_TRANSITION');
  const done = (
    await call('POST', `${cards}/${c1.id}/outcome`, {
      ok: true,
      records: [{ id: made.body.id, kind: 'budget', label: 'Studio budget' }],
    })
  ).body;
  assert.equal(done.state, 'done');
  assert.ok(done.outcome.events >= 1, JSON.stringify(done.outcome));
  assert.equal(done.outcome.records[0].id, made.body.id);
  // The audit trail shows who approved the step: the send event and the budget it caused.
  const events = await db.pool.query(
    `select action, actor_id, causation_id, correlation_id from audit_events
     where workspace_id = $1 and (id = $2 or causation_id = $2) order by sequence`,
    [ws, sent.causation_id],
  );
  assert.equal(events.rows[0].action, 'chat.action_sent');
  assert.ok(events.rows.length >= 2);
  for (const e of events.rows.slice(1)) {
    assert.equal(e.causation_id, sent.causation_id);
    assert.equal(e.correlation_id, c1.id);
    assert.equal(e.actor_id, events.rows[0].actor_id);
  }
  // A repeated report (a retry) returns the finished card unchanged.
  const after = (await call('POST', `${cards}/${c1.id}/outcome`, { ok: false }))
    .body;
  assert.equal(after.state, 'done');
  assert.equal(after.version, done.version);

  // The page says it worked but nothing names the send: shown as not confirmed.
  const c2 = await make();
  const s2 = (
    await call('POST', `${cards}/${c2.id}/send`, { expected_version: 1 })
  ).body;
  assert.ok(s2.causation_id);
  const u = (await call('POST', `${cards}/${c2.id}/outcome`, { ok: true }))
    .body;
  assert.equal(u.state, 'unconfirmed');
  assert.equal(u.outcome.events, 0);

  // The form's route refuses: the card keeps its reason, and nothing was saved.
  const c3 = await make();
  const s3 = (
    await call('POST', `${cards}/${c3.id}/send`, { expected_version: 1 })
  ).body;
  const no = await call(
    'POST',
    `workspaces/${ws}/budgets`,
    { ...budget('Bad'), cap_nano_usd: '-5' },
    { 'X-Causation-Id': s3.causation_id, 'X-Correlation-Id': c3.id },
  );
  assert.equal(no.status, 400);
  const r3 = (
    await call('POST', `${cards}/${c3.id}/outcome`, {
      ok: false,
      code: no.body.error.code,
      message: no.body.error.message,
    })
  ).body;
  assert.equal(r3.state, 'refused');
  assert.equal(r3.outcome.events, 0);
  assert.equal(r3.reason, no.body.error.message);

  // Put away: a draft only.
  const c4 = await make();
  const gone = (
    await call('POST', `${cards}/${c4.id}/dismiss`, { expected_version: 1 })
  ).body;
  assert.equal(gone.state, 'dismissed');
  assert.equal(
    (await call('POST', `${cards}/${c4.id}/send`, { expected_version: 2 })).body
      .error.code,
    'INVALID_TRANSITION',
  );

  // The conversation shows its cards in order.
  const detail = (await call('GET', `workspaces/${ws}/chats/${chat}`)).body;
  assert.deepEqual(
    detail.actions.map((a: { state: string }) => a.state),
    ['done', 'unconfirmed', 'refused', 'dismissed'],
  );
  // Another workspace's address cannot reach a card.
  const other = (
    await call('POST', 'workspaces', { name: 'Other', record_mode: 'fixture' })
  ).body.id as string;
  const cross = await call(
    'POST',
    `workspaces/${other}/chats/${chat}/actions/${c1.id}/dismiss`,
    { expected_version: 1 },
  );
  assert.equal(cross.body.error.code, 'NOT_FOUND');
});

test('chat cards in the store: roles, the sender alone reports, and a changed record makes a card stale', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  const owner: CommandContext = { actorId: randomUUID() };
  const editor: CommandContext = { actorId: randomUUID() };
  const viewer: CommandContext = { actorId: randomUUID() };
  for (const [who, name] of [
    [owner, 'owner'],
    [editor, 'editor'],
    [viewer, 'viewer'],
  ] as const)
    await store.ensureActor({
      id: who.actorId,
      kind: 'human',
      display_name: name,
    });
  const ws = await store.createWorkspace(owner, {
    name: 'Cards',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, editor.actorId, 'editor');
  await store.addMember(owner, ws.id, viewer.actorId, 'viewer');
  const chat = await store.createChat(owner, ws.id, {});
  const run = await store.createEntity(owner, ws.id, {
    kind: 'run',
    title: 'Evidence gathering',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const subject = {
    kind: 'entity' as const,
    id: run.id,
    version: 1,
    label: 'Evidence gathering',
  };
  const make = (who: CommandContext, subjects = [subject]) =>
    store.createChatAction(who, ws.id, chat.id, {
      client_id: randomUUID(),
      kind: 'fetch_source',
      input: { url: 'https://example.org/a' },
      subjects,
    });

  // A viewer reads cards but cannot make, fill in or send one.
  await rejects('ACCESS_DENIED', make(viewer));
  const card = await make(editor);
  await rejects(
    'ACCESS_DENIED',
    store.sendChatAction(viewer, ws.id, chat.id, card.id, {
      expected_version: 1,
    }),
  );
  // Sent by the editor: only the sender reports how it ended.
  const sent = await store.sendChatAction(editor, ws.id, chat.id, card.id, {
    expected_version: 1,
  });
  await rejects(
    'ACCESS_DENIED',
    store.finishChatAction(owner, ws.id, chat.id, card.id, { ok: true }),
  );
  // The page lost track and nothing names the send: refused, nothing was saved.
  const lost = await store.finishChatAction(editor, ws.id, chat.id, card.id, {
    ok: null,
  });
  assert.equal(lost.state, 'refused');
  assert.equal(lost.sent_event_id, sent.causation_id);

  // The run changes after the card was made: the send is refused as stale, before anything.
  const card2 = await make(owner);
  await store.reviseEntity(owner, ws.id, run.id, {
    expected_version: 1,
    title: 'Evidence gathering, renamed',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
    reason: 'rename',
    corrects_version: null,
  });
  await rejects(
    'VERSION_CONFLICT',
    store.sendChatAction(owner, ws.id, chat.id, card2.id, {
      expected_version: 1,
    }),
    /changed since this card was made \(version 1, now 2\)/,
  );
  const detail = await store.chatDetail(owner, ws.id, chat.id);
  const staleCard = detail.actions.find((a) => a.id === card2.id)!;
  assert.equal(staleCard.state, 'stale');
  assert.equal(staleCard.sent_event_id, null);
  assert.match(staleCard.reason ?? '', /nothing was sent/);
  const staleEvents = await db.pool.query(
    `select count(*)::int as n from audit_events
     where workspace_id = $1 and action = 'chat.action_stale'`,
    [ws.id],
  );
  assert.equal(staleEvents.rows[0].n, 1);

  // An archived record is stale too, with its own reason.
  const card3 = await make(owner, [{ ...subject, version: 2 }]);
  await store.archiveEntity(owner, ws.id, run.id, {
    expected_version: 2,
    reason: 'done with it',
  });
  await rejects(
    'VERSION_CONFLICT',
    store.sendChatAction(owner, ws.id, chat.id, card3.id, {
      expected_version: 1,
    }),
    /archived since this card was made/,
  );
  // A record from no workspace of this card's.
  const card4 = await make(owner, [{ ...subject, id: randomUUID() }]);
  await rejects(
    'VERSION_CONFLICT',
    store.sendChatAction(owner, ws.id, chat.id, card4.id, {
      expected_version: 1,
    }),
    /no longer in this workspace/,
  );
});
