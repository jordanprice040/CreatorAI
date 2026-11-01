import type { PoolClient } from 'pg';
import {
  ChatTargetSchema,
  parse,
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
  const { rows } = await c.query(
    'select * from chat_messages where conversation_id = $1 order by seq limit 2000',
    [conversation],
  );
  return rows.map((r) => toChatMessage(r as Row));
}
