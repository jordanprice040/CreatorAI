import type { PoolClient } from 'pg';
import {
  ChatActionInputSchema,
  ChatActionOutcomeSchema,
  ChatActionSubjectSchema,
  parse,
  z,
  type ChatAction,
  type ChatActionKind,
  type ChatActionState,
  type ChatActionSubject,
} from '@creator/contracts';
import { fail, iso, type Row } from './store.js';

// ADR-0083 (P20): the SQL behind Chat's action cards. The store methods in connection-store.ts
// hold the transaction, the role check and the audit events.

export const toChatAction = (r: Row): ChatAction => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  conversation_id: String(r.conversation_id),
  message_id: r.message_id ? String(r.message_id) : null,
  answer_id: r.answer_id ? String(r.answer_id) : null,
  origin: String(r.origin) as ChatAction['origin'],
  kind: String(r.kind) as ChatActionKind,
  input: parse(ChatActionInputSchema, r.input),
  subjects: parse(z.array(ChatActionSubjectSchema), r.subjects),
  state: String(r.state) as ChatActionState,
  version: Number(r.version),
  reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
  outcome: r.outcome ? parse(ChatActionOutcomeSchema, r.outcome) : null,
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  sent_by: r.sent_by ? String(r.sent_by) : null,
  sent_at: r.sent_at ? iso(r.sent_at) : null,
  sent_event_id: r.sent_event_id ? String(r.sent_event_id) : null,
  finished_at: r.finished_at ? iso(r.finished_at) : null,
});

export async function chatActions(
  c: PoolClient,
  conversation: string,
): Promise<ChatAction[]> {
  const { rows } = await c.query(
    `select * from (select * from chat_actions where conversation_id = $1
       order by created_at desc, id desc limit 2000) newest order by created_at, id`,
    [conversation],
  );
  return rows.map((r) => toChatAction(r as Row));
}

/** One card of a conversation, locked, or NOT_FOUND. */
export async function chatAction(
  c: PoolClient,
  ws: string,
  conversation: string,
  id: string,
): Promise<ChatAction> {
  const { rows } = await c.query(
    `select * from chat_actions where workspace_id = $1 and conversation_id = $2 and id = $3
     for update`,
    [ws, conversation, id],
  );
  if (!rows[0]) throw fail('NOT_FOUND', 'Card not found.');
  return toChatAction(rows[0] as Row);
}

/**
 * Why a card can no longer be sent: a record it was made from changed version, is no longer
 * active, or a decision it answers is no longer waiting. Null when every subject is as it was.
 */
export async function chatActionStale(
  c: PoolClient,
  ws: string,
  subjects: ChatActionSubject[],
): Promise<string | null> {
  const entities = subjects.filter((s) => s.kind === 'entity').map((s) => s.id);
  const decisions = subjects
    .filter((s) => s.kind === 'decision')
    .map((s) => s.id);
  const found = new Map<string, { version: number; live: boolean }>();
  if (entities.length) {
    const { rows } = await c.query(
      `select id, version, status from entities
       where workspace_id = $1 and id = any($2::uuid[])`,
      [ws, entities],
    );
    for (const r of rows as Row[])
      found.set(`entity:${String(r.id)}`, {
        version: Number(r.version),
        live: r.status === 'active',
      });
  }
  if (decisions.length) {
    const { rows } = await c.query(
      `select id, version, status from decision_requests
       where workspace_id = $1 and id = any($2::uuid[])`,
      [ws, decisions],
    );
    for (const r of rows as Row[])
      found.set(`decision:${String(r.id)}`, {
        version: Number(r.version),
        live: r.status === 'pending',
      });
  }
  for (const s of subjects) {
    const now = found.get(`${s.kind}:${s.id.toLowerCase()}`);
    if (!now)
      return `“${s.label}” is no longer in this workspace, so nothing was sent.`;
    if (!now.live)
      return s.kind === 'decision'
        ? `“${s.label}” is no longer waiting for an answer, so nothing was sent.`
        : `“${s.label}” was archived since this card was made, so nothing was sent.`;
    if (now.version !== s.version)
      return `“${s.label}” changed since this card was made (version ${s.version}, now ${now.version}), so nothing was sent. Ask again for a card made from the current version.`;
  }
  return null;
}

/** Audit events in the workspace that name this send as their cause, written by the sender. */
export async function chatActionEvents(
  c: PoolClient,
  ws: string,
  sentEvent: string,
  actor: string,
): Promise<number> {
  const { rows } = await c.query(
    `select count(*)::int as n from audit_events
     where workspace_id = $1 and causation_id = $2 and actor_id = $3`,
    [ws, sentEvent, actor],
  );
  return Number(rows[0]?.n ?? 0);
}

/** Refuses a change made against an older version of the card. */
export function cardVersion(card: ChatAction, expected: number) {
  if (card.version !== expected)
    throw fail(
      'VERSION_CONFLICT',
      'This card changed since you opened it; reload the conversation and try again.',
    );
}
