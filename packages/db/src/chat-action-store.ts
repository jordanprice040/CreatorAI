import type { PoolClient } from 'pg';
import {
  CHAT_FILL_TEXT_MAX,
  CHAT_HISTORY_TURNS,
  ChatActionInputSchema,
  ChatActionOutcomeSchema,
  ChatActionSubjectSchema,
  parse,
  z,
  type ChatAction,
  type ChatActionFill,
  type ChatActionFillQuestion,
  type ChatActionKind,
  type ChatActionState,
  type ChatActionSubject,
} from '@creator/contracts';
import { fail, iso, type Row } from './store.js';
import { chatEscape } from './chat-store.js';

// ADR-0083 (P20): the SQL behind Chat's action cards. The store methods in connection-store.ts
// hold the transaction, the role check and the audit events.

export const toChatAction = (r: Row): ChatAction => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  conversation_id: String(r.conversation_id),
  message_id: r.message_id ? String(r.message_id) : null,
  answer_id: r.answer_id ? String(r.answer_id) : null,
  again_of: r.again_of ? String(r.again_of) : null,
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
): Promise<{ count: number; work: number; subjects: Set<string> }> {
  const { rows } = await c.query(
    `select action, subject_id::text as subject_id, payload from audit_events
     where workspace_id = $1 and causation_id = $2 and actor_id = $3`,
    [ws, sentEvent, actor],
  );
  return {
    count: rows.length,
    work: rows.filter(
      (r) => !refusalRecord({ action: r.action, payload: r.payload }),
    ).length,
    subjects: new Set(rows.map((r) => String(r.subject_id))),
  };
}

/**
 * Re-review L-6: an event that only records a route's refusal (a study-run denial, a blocked
 * fetch, an action the policy did not allow). A refused send whose only events are these did
 * none of the requested work, so it ends `refused`, not `partial`.
 */
export function refusalRecord(e: { action: unknown; payload: unknown }) {
  const p = (e.payload ?? {}) as Record<string, unknown>;
  return (
    (typeof e.action === 'string' && e.action.endsWith('_denied')) ||
    (e.action === 'source.fetch_recorded' && p.state !== 'fetched') ||
    (e.action === 'action.evaluated' && p.verdict !== 'allow')
  );
}

/** Refuses a change made against an older version of the card. */
export function cardVersion(card: ChatAction, expected: number) {
  if (card.version !== expected)
    throw fail(
      'VERSION_CONFLICT',
      'This card changed since you opened it; reload the conversation and try again.',
    );
}

/** ADR-0096 (P31): one "Fill in with <model>" press, as the page shows it. */
export const toChatActionFill = (r: Row): ChatActionFill => ({
  id: String(r.id),
  action_id: String(r.action_id),
  conversation_id: String(r.conversation_id),
  client_id: String(r.client_id),
  state: String(r.state) as ChatActionFill['state'],
  connection_kind: String(
    r.connection_kind,
  ) as ChatActionFill['connection_kind'],
  fixture: Boolean(r.fixture),
  model_id: String(r.model_id),
  plan_request_id: r.plan_request_id ? String(r.plan_request_id) : null,
  values: Object.fromEntries(
    Object.entries((r.fill_values as Record<string, unknown> | null) ?? {}).map(
      ([k, v]) => [k, String(v)],
    ),
  ),
  dropped: Number(r.dropped ?? 0),
  reason: r.reason === null || r.reason === undefined ? null : String(r.reason),
  // A refusal sent nothing, so it shows no "what was sent".
  sent:
    r.state === 'refused'
      ? null
      : {
          instructions_version: String(r.instructions_version),
          instructions_hash: String(r.instructions_hash),
          records: Boolean(r.records),
          history_items: Number(r.history_items),
          input_chars: String(r.input).length,
          input: String(r.input),
        },
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  finished_at: r.finished_at ? iso(r.finished_at) : null,
});

export async function chatActionFills(
  c: PoolClient,
  conversation: string,
): Promise<ChatActionFill[]> {
  const { rows } = await c.query(
    `select * from (select * from chat_action_fills where conversation_id = $1
       order by created_at desc, id desc limit 2000) newest order by created_at, id`,
    [conversation],
  );
  return rows.map((r) => toChatActionFill(r as Row));
}

/**
 * ADR-0096 (P31): exactly what a fill sends with its fixed instructions: the conversation
 * (oldest turns dropped first to fit), the card's step and its questions. Question help and
 * answers so far can quote studio records, so they go only when `records` is true.
 */
export function fillInput(p: {
  step: string;
  history: { who: 'person' | 'assistant'; text: string }[];
  questions: ChatActionFillQuestion[];
  records: boolean;
  maxChars: number;
}): { input: string; history_items: number } | null {
  const qs = p.questions
    .map((q) =>
      [
        `- key: ${q.key} (${q.type === 'long' ? 'a paragraph' : 'one line'}, at most ${CHAT_FILL_TEXT_MAX[q.type]} characters)`,
        `  Label: ${chatEscape(q.label)}`,
        `  Question: ${chatEscape(q.prompt)}`,
        ...(p.records && q.help ? [`  Help: ${chatEscape(q.help)}`] : []),
        ...(p.records && q.current
          ? [`  Answer so far: ${chatEscape(q.current)}`]
          : []),
      ].join('\n'),
    )
    .join('\n');
  const tail = `<card>\nStep: ${chatEscape(p.step)}\n</card>\n\n<questions>\n${qs}\n</questions>`;
  let turns = p.history.slice(-CHAT_HISTORY_TURNS);
  const build = () =>
    turns.length
      ? `<conversation>\n${turns.map((t) => `${t.who === 'person' ? 'Person' : 'Assistant'}: ${chatEscape(t.text)}`).join('\n\n')}\n</conversation>\n\n`
      : '';
  while (turns.length && build().length + tail.length > p.maxChars)
    turns = turns.slice(1);
  if (build().length + tail.length > p.maxChars) return null;
  return { input: `${build()}${tail}`, history_items: turns.length };
}
