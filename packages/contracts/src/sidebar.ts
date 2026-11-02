import { z, id, timestamp } from './primitives.js';

// The right-hand sidebar (ADR-0060): a notepad per person per workspace, and a read-only list
// of what is in progress now. Notes are the person's own scratch text: they are never sent to
// a model, never written to the audit trail and never treated as evidence or a decision.

/** Longest note, in characters. */
export const NOTE_MAX = 100_000;

export const WorkspaceNoteSchema = z.strictObject({
  workspace_id: id,
  text: z.string().max(NOTE_MAX),
  /** 0 until the first save. */
  version: z.number().int().min(0),
  updated_at: timestamp.nullable(),
});
export type WorkspaceNote = z.infer<typeof WorkspaceNoteSchema>;

export const WorkspaceNoteRequestSchema = z.strictObject({
  /** The version the text was based on; a stale one is refused so another window's text is not lost. */
  expected_version: z.number().int().min(0),
  text: z
    .string()
    .max(
      NOTE_MAX,
      `Notes are limited to ${NOTE_MAX.toLocaleString('en-US')} characters.`,
    ),
});

export const ActivityNowKindSchema = z.enum([
  /** A model request on a plan connection that has not finished. */
  'plan_request',
  /** A workflow (for example a skeptic review) that is not finished. */
  'workflow',
  /** A product run on a paired computer that has not finished. */
  'desktop_job',
]);
export type ActivityNowKind = z.infer<typeof ActivityNowKindSchema>;

export const ActivityNowItemSchema = z.strictObject({
  kind: ActivityNowKindSchema,
  id,
  /** Plain words, such as "Qualifying a model". */
  label: z.string().max(200),
  /** Extra detail, such as the model or the state; may be empty. */
  detail: z.string().max(200),
  state: z.string().max(40),
  /** For a plan request, what it is for (qualification, chat, codex_build…); otherwise null. */
  purpose: z.string().max(40).nullable(),
  run_id: id.nullable(),
  started_at: timestamp,
});
export type ActivityNowItem = z.infer<typeof ActivityNowItemSchema>;

/** Most items returned per kind. */
export const ACTIVITY_NOW_MAX = 10;

export const ActivityNowSchema = z.strictObject({
  items: z.array(ActivityNowItemSchema).max(ACTIVITY_NOW_MAX * 3),
  generated_at: timestamp,
});
export type ActivityNow = z.infer<typeof ActivityNowSchema>;
