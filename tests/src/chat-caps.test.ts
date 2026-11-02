import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// PR #98 L-4 and PR #118 review L2: a conversation past its caps shows its newest 2000
// messages and newest 4000 answers, in order, not the oldest.
test('chat keeps the newest messages and answers past their caps', async (t) => {
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
    await call('POST', 'workspaces', { name: 'Caps', record_mode: 'real' })
  ).body.id as string;
  const chat = (await call('POST', `workspaces/${ws}/chats`, {})).body
    .id as string;
  const conn = await call('POST', `workspaces/${ws}/plan-connections`, {
    kind: 'claude_code',
    label: 'Claude Code',
    settings: {
      format: 'chatgpt-plan-settings/1',
      plan_type: 'unknown',
      shared_allowance_note: 'Shared with personal use.',
      allowed_data_classes: ['synthetic'],
      allowed_task_classes: ['summarization'],
      caps: {
        responses: {
          max_requests_per_run: 10,
          request_timeout_ms: 180000,
          max_output_chars: 16000,
          max_input_chars: 24000,
        },
        codex: {
          max_builds_per_day: 0,
          max_turns_per_build: 1,
          max_model_requests_per_build: 1,
          build_timeout_ms: 60000,
        },
        shared: { max_model_requests_per_day: 30, max_in_flight: 1 },
      },
    },
  });
  assert.equal(conn.status, 201, JSON.stringify(conn.body));
  // 2005 messages, each with two answers (4010), written straight to the test database.
  await db.pool.query(
    `insert into chat_messages (id, workspace_id, conversation_id, seq, client_id, author_id,
       text, intent, target, created_at)
     select gen_random_uuid(), $1, $2, n, gen_random_uuid(), $3, 'note ' || n, 'note', '{}',
       timestamptz '2026-11-01' + n * interval '1 second'
     from generate_series(1, 2005) n`,
    [ws, chat, DEFAULT_OWNER_ACTOR_ID],
  );
  await db.pool.query(
    `insert into chat_answers (id, workspace_id, conversation_id, message_id, client_id, state,
       connection_id, connection_kind, fixture, model_id, logical_operation_id,
       instructions_version, instructions_hash, history_items, snapshot, input, input_hash,
       text, reason, created_by, created_at, finished_at)
     select gen_random_uuid(), m.workspace_id, m.conversation_id, m.id, gen_random_uuid(),
       'failed', $2, 'claude_code', false, 'm', gen_random_uuid(), 'v1', repeat('a', 64), 0,
       false, 'in', repeat('b', 64), null, 'try ' || k, $3,
       m.created_at + k * interval '1 millisecond', m.created_at + k * interval '1 millisecond'
     from chat_messages m cross join generate_series(1, 2) k where m.conversation_id = $1`,
    [chat, conn.body.id, DEFAULT_OWNER_ACTOR_ID],
  );
  const detail = await call('GET', `workspaces/${ws}/chats/${chat}`);
  assert.equal(detail.status, 200, JSON.stringify(detail.body).slice(0, 300));
  const seqs = (detail.body.messages as { seq: number }[]).map((m) => m.seq);
  assert.equal(seqs.length, 2000);
  assert.equal(seqs[0], 6);
  assert.equal(seqs.at(-1), 2005);
  assert.ok(seqs.every((s, i) => i === 0 || s > seqs[i - 1]!));
  const answers = detail.body.answers as {
    message_id: string;
    created_at: string;
  }[];
  assert.equal(answers.length, 4000);
  // The newest message's answers are there, and the list stays oldest first.
  const newest = (detail.body.messages as { id: string }[]).at(-1)!.id;
  assert.equal(answers.filter((a) => a.message_id === newest).length, 2);
  assert.ok(
    answers.every(
      (a, i) => i === 0 || a.created_at >= answers[i - 1]!.created_at,
    ),
  );
});
