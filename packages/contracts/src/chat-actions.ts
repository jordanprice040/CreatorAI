import { z, id, timestamp } from './primitives.js';

// ADR-0083 (P20): action cards in Chat. A card is the next step of the main path, filled in from
// the conversation, that the person can check and send. It is sent by the person's browser
// through the same server routes the forms use, so every grant, cap, qualification, routine
// policy and study rule is checked there exactly as for the form. A card is never sent by a
// model and never sends itself: the person's click is the approval (or, inside a run, a routine
// policy the owner set admits the step, as it would for the form). The store keeps who proposed
// each card, who sent it, the versions it was made from (a changed record makes it stale) and
// the audit events its requests caused.

/** What a card does. Each kind has one form it stands in for. */
export const ChatActionKindSchema = z.enum([
  /** Budgets: fund a budget (and, in a fixture workspace, add the bundled fixture pricing). */
  'fund_budget',
  /** Sources: fetch one page under an evidence-gathering run. */
  'fetch_source',
  /** Sources: cite a fetched passage in a claim. */
  'cite_claim',
  /** Discover: write a brief and start a discovery run. */
  'start_discovery',
  /** Approvals: answer one waiting decision. */
  'answer_decision',
  /** Decide: score one option on its rubric. */
  'score_option',
  /** Decide: record what to do with each option of a problem. */
  'record_choice',
  /** Proposals: save a proposal for a chosen non-code option. */
  'save_proposal',
]);
export type ChatActionKind = z.infer<typeof ChatActionKindSchema>;

export const CHAT_ACTION_LABEL: Record<ChatActionKind, string> = {
  fund_budget: 'Set up a budget',
  fetch_source: 'Fetch a page',
  cite_claim: 'Record a claim',
  start_discovery: 'Start a discovery',
  answer_decision: 'Answer a waiting decision',
  score_option: 'Score an option',
  record_choice: 'Record your choice',
  save_proposal: 'Save a proposal',
};

/** Who put the card in the conversation. Neither can send it; only a person's click does. */
export const ChatActionOriginSchema = z.enum([
  /** The studio's fixed rules, from the main path ("what's next?") or a studio reply. */
  'studio',
  /** A model answer suggested it (`<propose_action>`); the person still checks and sends it. */
  'model',
]);

/**
 * A record the card was made from, at the version it saw. If any of them changes (or a
 * decision stops waiting) before the card is sent, the card is refused as stale.
 */
export const ChatActionSubjectSchema = z.strictObject({
  kind: z.enum(['entity', 'decision']),
  id,
  version: z.number().int().min(1),
  /** For the refusal text only. */
  label: z.string().trim().min(1).max(200),
});
export type ChatActionSubject = z.infer<typeof ChatActionSubjectSchema>;
export const CHAT_ACTION_SUBJECTS_MAX = 40;
const TOO_MANY_SUBJECTS = {
  message: `A card checks at most ${CHAT_ACTION_SUBJECTS_MAX} records before sending; choose fewer, or use the form.`,
};

export const ChatActionStateSchema = z.enum([
  /** Being filled in (guided questions) or ready to send. */
  'draft',
  /** The person pressed Send; the requests are on their way. */
  'sending',
  /** The form's route accepted it; the audit trail shows the events it caused. */
  'done',
  /** The form's route refused it; its reason is kept. Nothing it would have saved was saved. */
  'refused',
  /** Refused after an earlier request of the same card was saved (for example a run). */
  'partial',
  /** The browser reported success but no event names this card: shown as not confirmed. */
  'unconfirmed',
  /** A record it was made from changed, so nothing was sent. */
  'stale',
  /** The person put it away. */
  'dismissed',
]);
export type ChatActionState = z.infer<typeof ChatActionStateSchema>;

/** A card's answers: what the person (or a model hint) filled in, as the form's own values. */
export const ChatActionInputSchema = z
  .record(z.string().max(80), z.unknown())
  .refine((v) => JSON.stringify(v).length <= 64 * 1024, {
    message: 'A card holds at most 64 KiB of answers.',
  });

export const ChatActionOutcomeSchema = z.strictObject({
  /** The route's error code, when it refused. */
  code: z.string().max(60).nullable(),
  /** The route's own words, shown as they came. */
  message: z.string().max(2000).nullable(),
  /** Records the requests created, as the routes returned them. */
  records: z
    .array(
      z.strictObject({
        id,
        kind: z.string().max(40),
        label: z.string().max(200),
        /**
         * Review N-3: set by the store, never taken from the browser. True when a caused audit
         * event names this record as its subject.
         */
        in_trail: z.boolean().optional(),
      }),
    )
    .max(20),
  /** Audit events that name this card's send as their cause. */
  events: z.number().int().min(0),
});
export type ChatActionOutcome = z.infer<typeof ChatActionOutcomeSchema>;

export const ChatActionSchema = z.strictObject({
  id,
  workspace_id: id,
  conversation_id: id,
  /** The person's message it answers, if any. */
  message_id: id.nullable(),
  /** The model answer that suggested it, for origin `model`. */
  answer_id: id.nullable(),
  /** The card this one sends again with the same answers; it keeps that card's origin. */
  again_of: id.nullable(),
  origin: ChatActionOriginSchema,
  kind: ChatActionKindSchema,
  input: ChatActionInputSchema,
  subjects: z.array(ChatActionSubjectSchema).max(CHAT_ACTION_SUBJECTS_MAX),
  state: ChatActionStateSchema,
  version: z.number().int().min(1),
  /** Why it is stale, or the refusal in the studio's words. */
  reason: z.string().max(2000).nullable(),
  outcome: ChatActionOutcomeSchema.nullable(),
  created_by: id,
  created_at: timestamp,
  sent_by: id.nullable(),
  sent_at: timestamp.nullable(),
  /** The `chat.action_sent` audit event; every request of the send names it as its cause. */
  sent_event_id: id.nullable(),
  finished_at: timestamp.nullable(),
});
export type ChatAction = z.infer<typeof ChatActionSchema>;

export const ChatActionCreateRequestSchema = z.strictObject({
  /** Chosen once by the client, so a retried click never adds a second card. */
  client_id: id,
  kind: ChatActionKindSchema,
  message_id: id.nullable().default(null),
  /**
   * Review L-5: the finished card this one sends again. Its origin and model answer carry
   * over (the client can never set origin `model` itself).
   */
  again_of: id.nullable().default(null),
  input: ChatActionInputSchema.default({}),
  subjects: z
    .array(ChatActionSubjectSchema)
    .max(CHAT_ACTION_SUBJECTS_MAX, TOO_MANY_SUBJECTS)
    .default([]),
});
export const ChatActionUpdateRequestSchema = z.strictObject({
  expected_version: z.number().int().min(1),
  input: ChatActionInputSchema,
  subjects: z
    .array(ChatActionSubjectSchema)
    .max(CHAT_ACTION_SUBJECTS_MAX, TOO_MANY_SUBJECTS),
});
export const ChatActionVersionRequestSchema = z.strictObject({
  expected_version: z.number().int().min(1),
});
/** The browser's report of how the form's route answered. The store checks it against the audit trail. */
export const ChatActionOutcomeRequestSchema = z.strictObject({
  /** True when every request was accepted; false when one was refused; null when the page lost track. */
  ok: z.boolean().nullable(),
  code: z.string().trim().max(60).nullable().default(null),
  message: z.string().trim().max(2000).nullable().default(null),
  records: ChatActionOutcomeSchema.shape.records.default([]),
});
export const ChatActionSentSchema = z.strictObject({
  action: ChatActionSchema,
  /** Send it as `X-Causation-Id` (and the card id as `X-Correlation-Id`) on every request. */
  causation_id: id,
});
export type ChatActionSent = z.infer<typeof ChatActionSentSchema>;

/**
 * What a model may suggest: a kind and short hints. Hints only prefill answers the person
 * then sees; they can never carry an id of authority (grant, policy, budget cap or decision
 * answer), which the card's own questions and the server decide.
 */
export const ChatActionHintsSchema = z.strictObject({
  /** A theme, a statement or a short note, depending on the kind. */
  text: z.string().trim().min(1).max(500).optional(),
  url: z.url().max(2000).optional(),
});
export type ChatActionHints = z.infer<typeof ChatActionHintsSchema>;

/** Kinds a model may suggest. Answering a decision is never suggested by a model. */
export const MODEL_PROPOSABLE_KINDS: readonly ChatActionKind[] = [
  'fund_budget',
  'fetch_source',
  'cite_claim',
  'start_discovery',
  'score_option',
  'record_choice',
  'save_proposal',
];

const PROPOSE_RE =
  /<propose_action\s+kind\s*=\s*"([a-z_]{1,40})"\s*>([\s\S]{0,2000}?)<\/propose_action>/g;

/**
 * ADR-0083: reads the one card a model answer may suggest. The answer's text is kept as the
 * model wrote it (its hash is recorded); the page hides the tag. Anything that does not parse
 * as exactly one allowed kind with valid hints is not a card, and says why.
 */
export function readProposedAction(
  text: string,
):
  | { found: false }
  | { found: true; ok: true; kind: ChatActionKind; hints: ChatActionHints }
  | { found: true; ok: false; reason: string } {
  const all = [...text.matchAll(PROPOSE_RE)];
  if (all.length === 0) return { found: false };
  if (all.length > 1)
    return {
      found: true,
      ok: false,
      reason: 'The answer suggested more than one step; none was made a card.',
    };
  const [, kindRaw, json] = all[0]!;
  const kind = ChatActionKindSchema.safeParse(kindRaw);
  if (!kind.success || !MODEL_PROPOSABLE_KINDS.includes(kind.data))
    return {
      found: true,
      ok: false,
      reason: `The answer suggested a step the studio does not offer as a card (${String(kindRaw)}).`,
    };
  let raw: unknown = {};
  const body = (json ?? '').trim();
  if (body) {
    try {
      raw = JSON.parse(body);
    } catch {
      return {
        found: true,
        ok: false,
        reason: 'The suggested step was not readable, so no card was made.',
      };
    }
  }
  const hints = ChatActionHintsSchema.safeParse(raw);
  if (!hints.success)
    return {
      found: true,
      ok: false,
      reason:
        'The suggested step carried fields a card does not take, so no card was made.',
    };
  return { found: true, ok: true, kind: kind.data, hints: hints.data };
}

/** The answer's text without the suggestion tag, for display. */
export const withoutProposedAction = (text: string) =>
  text.replace(PROPOSE_RE, '').trim();

/** States after which a card never changes again. */
export const CHAT_ACTION_FINAL: readonly ChatActionState[] = [
  'done',
  'refused',
  'partial',
  'unconfirmed',
  'stale',
  'dismissed',
];
