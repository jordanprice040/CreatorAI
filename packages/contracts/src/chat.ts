import { z, id, timestamp } from './primitives.js';

// Studio chat, first version (runbook step 9, ADR-0055). A front door, not a second engine:
// conversations are saved per workspace, and each message the person writes is sorted into
// one of a few intents by fixed rules below. The studio's answers and action cards are worked
// out from current records each time they are shown, so nothing in a conversation can grant
// authority, start work or stand in for a record. No model is called; replies in words are a
// later, separately approved step.

/** What a message asks for. Decided on the server with `classifyChat`; never sent by a client. */
export const ChatIntentSchema = z.enum([
  /** "What's next?" */
  'next',
  /** "Why is it blocked?" */
  'why_blocked',
  /** A message with a web address: offer to add it as a source. */
  'add_source',
  /** "Save this idea: …": the message is the saved idea. */
  'save_idea',
  /** "Start a discovery about …": offer Discover with the theme filled in. */
  'start_discovery',
  /** "What's waiting for me?" */
  'approvals',
  /** Anything else: kept as a note. */
  'note',
]);
export type ChatIntent = z.infer<typeof ChatIntentSchema>;

export const CHAT_TEXT_MAX = 4000;
export const CHAT_TITLE_MAX = 120;

/** What an intent refers to: the address to add, or the idea or theme text. */
export const ChatTargetSchema = z.strictObject({
  url: z.url().max(2000).optional(),
  text: z.string().max(CHAT_TEXT_MAX).optional(),
});
export type ChatTarget = z.infer<typeof ChatTargetSchema>;

const URL_RE = /\bhttps?:\/\/[^\s<>"')\]]+/i;
const strip = (s: string) =>
  s
    .replace(/^[\s:,.\-–—]+/, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Sorts one message into an intent with fixed, visible rules, in this order: a web address,
 * "save/remember …", "start/run a discovery …" or "research …", waiting approvals, why
 * something is blocked, what's next. Everything else is a note. Pure and deterministic, so
 * the server and tests agree on every message.
 */
export function classifyChat(raw: string): {
  intent: ChatIntent;
  target: ChatTarget;
} {
  const text = raw.trim();
  const lower = text.toLowerCase();
  const url = URL_RE.exec(text)?.[0]?.replace(/[.,;:!?]+$/, '');
  if (url && z.url().max(2000).safeParse(url).success)
    return { intent: 'add_source', target: { url } };
  const save =
    /^(?:please\s+)?(?:save|remember|note(?:\s+down)?)\b(?:\s+(?:this|that|an?|my))?(?:\s+(?:idea|thought|note))?\b(.*)$/is.exec(
      text,
    );
  if (save) {
    const idea = strip(save[1] ?? '');
    return { intent: 'save_idea', target: idea ? { text: idea } : {} };
  }
  const discover =
    /^(?:please\s+)?(?:(?:start|run|begin|kick\s+off)\s+(?:a\s+|the\s+)?discovery|research|discover|explore)\b(?:\s+(?:on|about|into|for))?(.*)$/is.exec(
      text,
    );
  if (discover) {
    const theme = strip(discover[1] ?? '');
    return {
      intent: 'start_discovery',
      target: theme ? { text: theme } : {},
    };
  }
  if (
    /\b(approv\w*|decisions?|waiting (?:on|for) me|needs? me|my answer)\b/.test(
      lower,
    )
  )
    return { intent: 'approvals', target: {} };
  if (/\b(why|blocked|stuck|can'?t|cannot|won'?t)\b/.test(lower))
    return { intent: 'why_blocked', target: {} };
  if (
    /\b(what'?s|what is|what do i do|whats)\s+next\b|\bnext step\b|^next\??$|\bwhere (?:am i|do i start)\b/.test(
      lower,
    )
  )
    return { intent: 'next', target: {} };
  return { intent: 'note', target: {} };
}

/** A conversation's title from its first message: the first words, cut at a word. */
export function chatTitle(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= 60) return flat || 'New conversation';
  const cut = flat.slice(0, 60);
  const space = cut.lastIndexOf(' ');
  return `${(space > 30 ? cut.slice(0, space) : cut).trim()}…`;
}

export const ChatConversationSchema = z.strictObject({
  id,
  workspace_id: id,
  title: z.string().min(1).max(CHAT_TITLE_MAX),
  messages: z.number().int().min(0),
  /** The newest message's text, shortened, for the list. */
  last_text: z.string().nullable(),
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
});
export type ChatConversation = z.infer<typeof ChatConversationSchema>;

export const ChatMessageSchema = z.strictObject({
  id,
  conversation_id: id,
  seq: z.number().int().min(1),
  client_id: id,
  author_id: id,
  text: z.string().min(1).max(CHAT_TEXT_MAX),
  intent: ChatIntentSchema,
  target: ChatTargetSchema,
  created_at: timestamp,
});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;

export const ChatDetailSchema = z.strictObject({
  conversation: ChatConversationSchema,
  messages: z.array(ChatMessageSchema),
});
export type ChatDetail = z.infer<typeof ChatDetailSchema>;

export const ChatCreateRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(CHAT_TITLE_MAX).optional(),
});
export const ChatMessageRequestSchema = z.strictObject({
  /** Chosen by the client once per message, so a retried send never adds it twice. */
  client_id: id,
  text: z.string().trim().min(1).max(CHAT_TEXT_MAX),
});
export const ChatRenameRequestSchema = z.strictObject({
  title: z.string().trim().min(1).max(CHAT_TITLE_MAX),
});
