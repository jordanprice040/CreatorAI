import type { PoolClient } from 'pg';
import {
  CHAT_DAILY_LIMIT_DEFAULT,
  CHAT_HISTORY_TURNS,
  ChatTargetSchema,
  parse,
  type ChatAnswer,
  type ChatAnswerState,
  type ChatSettings,
  type ChatConversation,
  type ChatIntent,
  type ChatMessage,
} from '@creator/contracts';
import { fail, iso, type Row } from './store.js';

// ADR-0055 studio chat, first version: the SQL behind the conversation routes. The store
// methods in connection-store.ts hold the transaction, the role check and the audit event.

const LAST_TEXT_MAX = 160;
const like = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

const toConversation = (r: Row): ChatConversation => {
  const last = r.last_text === null ? null : String(r.last_text);
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    title: String(r.title),
    messages: Number(r.messages ?? 0),
    last_text:
      last === null
        ? null
        : last.length > LAST_TEXT_MAX
          ? `${last.slice(0, LAST_TEXT_MAX - 1)}…`
          : last,
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
};

export const toChatMessage = (r: Row): ChatMessage => ({
  id: String(r.id),
  conversation_id: String(r.conversation_id),
  seq: Number(r.seq),
  client_id: String(r.client_id),
  author_id: String(r.author_id),
  text: String(r.text),
  intent: String(r.intent) as ChatIntent,
  target: parse(ChatTargetSchema, r.target),
  created_at: iso(r.created_at),
});

const CONVERSATION_SELECT = `
select c.*,
 (select count(*) from chat_messages m where m.conversation_id = c.id) as messages,
 (select m.text from chat_messages m where m.conversation_id = c.id
   order by m.seq desc limit 1) as last_text
from chat_conversations c`;

/** One conversation of a workspace, or NOT_FOUND (also for another workspace's id). */
export async function chatConversation(
  c: PoolClient,
  ws: string,
  id: string,
  lock = false,
): Promise<ChatConversation> {
  if (lock)
    await c.query(
      'select id from chat_conversations where workspace_id = $1 and id = $2 for update',
      [ws, id],
    );
  const { rows } = await c.query(
    `${CONVERSATION_SELECT} where c.workspace_id = $1 and c.id = $2`,
    [ws, id],
  );
  if (!rows[0]) throw fail('NOT_FOUND', 'Conversation not found.');
  return toConversation(rows[0] as Row);
}

/**
 * A workspace's conversations, most recently active first. `q` matches the title or the text
 * of any message, case-insensitively.
 */
export async function chatConversations(
  c: PoolClient,
  ws: string,
  q: string,
): Promise<ChatConversation[]> {
  const search = q.trim().slice(0, 200);
  const { rows } = await c.query(
    `${CONVERSATION_SELECT}
     where c.workspace_id = $1
       and ($2 = '' or c.title ilike $3 or exists (
         select 1 from chat_messages m where m.conversation_id = c.id and m.text ilike $3))
     order by c.updated_at desc, c.id limit 200`,
    [ws, search, like(search)],
  );
  return rows.map((r) => toConversation(r as Row));
}

export async function chatMessages(
  c: PoolClient,
  conversation: string,
): Promise<ChatMessage[]> {
  // PR #98 L-4 (full audit 2026-11-02): past 2000 messages, the newest are kept, not the oldest.
  const { rows } = await c.query(
    `select * from (select * from chat_messages where conversation_id = $1
       order by seq desc limit 2000) newest order by seq`,
    [conversation],
  );
  return rows.map((r) => toChatMessage(r as Row));
}

// ADR-0057: chat answers from a connected plan.

export const toChatAnswer = (r: Row): ChatAnswer => ({
  id: String(r.id),
  conversation_id: String(r.conversation_id),
  message_id: String(r.message_id),
  client_id: String(r.client_id),
  state: String(r.state) as ChatAnswerState,
  connection_id: String(r.connection_id),
  connection_kind: String(r.connection_kind) as ChatAnswer['connection_kind'],
  fixture: Boolean(r.fixture),
  model_id: String(r.model_id),
  plan_request_id: r.plan_request_id ? String(r.plan_request_id) : null,
  text: r.text === null ? null : String(r.text),
  reason: r.reason === null ? null : String(r.reason),
  sent:
    r.state === 'refused'
      ? null
      : {
          instructions_version: String(r.instructions_version),
          instructions_hash: String(r.instructions_hash),
          history_items: Number(r.history_items),
          snapshot: Boolean(r.snapshot),
          input_chars: String(r.input).length,
          input: String(r.input),
        },
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  finished_at: r.finished_at ? iso(r.finished_at) : null,
});

export async function chatAnswers(
  c: PoolClient,
  conversation: string,
): Promise<ChatAnswer[]> {
  const { rows } = await c.query(
    'select * from chat_answers where conversation_id = $1 order by created_at, id limit 4000',
    [conversation],
  );
  return rows.map((r) => toChatAnswer(r as Row));
}

/** Chat requests sent on a connection in the last 24 hours (admitted, any outcome). */
export async function chatUsed24h(
  c: PoolClient,
  connection: string | null,
): Promise<number> {
  if (!connection) return 0;
  const { rows } = await c.query(
    `select count(*)::int as n from plan_requests
     where connection_id = $1 and purpose = 'chat'
       and started_at > clock_timestamp() - interval '24 hours'`,
    [connection],
  );
  return Number(rows[0]?.n ?? 0);
}

export async function chatSettings(
  c: PoolClient,
  ws: string,
  lock = false,
): Promise<ChatSettings> {
  const { rows } = await c.query(
    `select * from chat_settings where workspace_id = $1${lock ? ' for update' : ''}`,
    [ws],
  );
  const r = rows[0] as Row | undefined;
  const connection = r?.connection_id ? String(r.connection_id) : null;
  return {
    workspace_id: ws,
    enabled: Boolean(r?.enabled ?? false),
    connection_id: connection,
    model_id: r?.model_id ? String(r.model_id) : null,
    include_snapshot: Boolean(r?.include_snapshot ?? true),
    daily_limit: Number(r?.daily_limit ?? CHAT_DAILY_LIMIT_DEFAULT),
    version: Number(r?.version ?? 0),
    updated_by: r?.updated_by ? String(r.updated_by) : null,
    updated_at: r?.updated_at ? iso(r.updated_at) : null,
    used_24h: await chatUsed24h(c, connection),
  };
}

/**
 * Review L-5: text from records and messages cannot close or open the data blocks the input
 * is wrapped in, so angle brackets are written as entities.
 */
export const chatEscape = (s: string) =>
  s.replace(/</g, '&lt;').replace(/>/g, '&gt;');

const clip = (s: unknown, n: number) => {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return chatEscape(t.length > n ? `${t.slice(0, n - 1)}…` : t);
};

/** Review L-3: an unfinished study attempt on an active run in the workspace. */
export async function chatStudyOpen(
  c: PoolClient,
  ws: string,
): Promise<boolean> {
  const { rows } = await c.query(
    `select 1 from study_attempts a
     join run_controls rc on rc.workspace_id = a.workspace_id and rc.run_id = a.run_id
     where a.workspace_id = $1 and rc.state = 'active'
       and not exists (select 1 from study_events e where e.attempt_id = a.id and e.kind = 'finished')
     limit 1`,
    [ws],
  );
  return rows.length > 0;
}

/**
 * A short, fixed-shape picture of the workspace for chat (ADR-0057): names, states and counts
 * from records only. It never reads credentials, file paths, source page text, evidence bodies
 * or product code, so none of those can be sent.
 */
export async function chatSnapshot(c: PoolClient, ws: string): Promise<string> {
  const w = (
    await c.query('select name, record_mode from workspaces where id = $1', [
      ws,
    ])
  ).rows[0] as Row | undefined;
  const runs = await c.query(
    `select e.title, coalesce(rc.state, 'unknown') as state, rc.autonomy_mode, e.created_at
     from entities e left join run_controls rc on rc.workspace_id = e.workspace_id and rc.run_id = e.id
     where e.workspace_id = $1 and e.kind = 'run' and e.status = 'active'
     order by e.created_at desc limit 8`,
    [ws],
  );
  const counts = await c.query(
    `select kind, count(*)::int as n from entities
     where workspace_id = $1 and status = 'active' and kind in ('problem','idea','product','specification','source','claim')
     group by kind order by kind`,
    [ws],
  );
  const recent = await c.query(
    `select kind, title from entities
     where workspace_id = $1 and status = 'active' and kind in ('problem','idea','product','specification')
     order by updated_at desc limit 8`,
    [ws],
  );
  const decisions = await c.query(
    `select kind, reason from decision_requests
     where workspace_id = $1 and status = 'pending' order by created_at desc limit 6`,
    [ws],
  );
  const attention = await c.query(
    `select role, state, reason from workflows
     where workspace_id = $1 and state in ('waiting_human','paused_operator','reconciling','failed')
     order by updated_at desc limit 5`,
    [ws],
  );
  const lines = [
    `Workspace: ${clip(w?.name, 120)} (${w?.record_mode === 'fixture' ? 'fixture data' : 'real records'})`,
    `Snapshot taken: ${new Date().toISOString()}`,
    `Record counts: ${counts.rows.map((r: Row) => `${r.kind} ${r.n}`).join(', ') || 'none'}`,
    'Newest runs:',
    ...(runs.rows.length
      ? runs.rows.map(
          (r: Row) =>
            `- ${clip(r.title, 120)} (${r.state}${r.autonomy_mode ? `, ${r.autonomy_mode}` : ''}, started ${iso(r.created_at).slice(0, 10)})`,
        )
      : ['- none']),
    'Recently changed problems, ideas, specs and products:',
    ...(recent.rows.length
      ? recent.rows.map((r: Row) => `- ${r.kind}: ${clip(r.title, 120)}`)
      : ['- none']),
    `Approvals waiting for the owner: ${decisions.rows.length}`,
    ...decisions.rows.map((r: Row) => `- ${r.kind}: ${clip(r.reason, 160)}`),
    'Work needing attention:',
    ...(attention.rows.length
      ? attention.rows.map(
          (r: Row) => `- ${r.role} ${r.state}: ${clip(r.reason, 160)}`,
        )
      : ['- none']),
  ];
  return lines.join('\n');
}

/**
 * The input for one answer: the snapshot (when on), the earlier turns of the conversation up to
 * the asked message, and the question. Older turns are dropped first to fit `maxChars`.
 */
export function chatInput(p: {
  snapshot: string | null;
  history: { who: 'person' | 'assistant'; text: string }[];
  question: string;
  maxChars: number;
}): { input: string; history_items: number; snapshot: boolean } {
  const head = p.snapshot
    ? `<studio_snapshot>\n${p.snapshot}\n</studio_snapshot>\n\n`
    : '';
  const tail = `Question:\n${chatEscape(p.question)}`;
  let turns = p.history.slice(-CHAT_HISTORY_TURNS);
  const build = () =>
    turns.length
      ? `<conversation>\n${turns.map((t) => `${t.who === 'person' ? 'Person' : 'Assistant'}: ${chatEscape(t.text)}`).join('\n\n')}\n</conversation>\n\n`
      : '';
  while (
    turns.length &&
    head.length + build().length + tail.length > p.maxChars
  )
    turns = turns.slice(1);
  let input = `${head}${build()}${tail}`;
  let snapshot = head !== '';
  // The snapshot goes last if even the bare question does not fit with it.
  if (input.length > p.maxChars) {
    input = tail;
    snapshot = false;
  }
  return { input, history_items: input === tail ? 0 : turns.length, snapshot };
}
