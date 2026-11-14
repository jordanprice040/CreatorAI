import { z, id, timestamp } from './primitives.js';

// The right-hand sidebar (ADR-0060): a notepad per person per workspace, and a read-only list
// of what is in progress now. Notes are the person's own scratch text: they are never sent to
// a model, never written to the audit trail and never treated as evidence or a decision.

/** Longest note, in characters. */
export const NOTE_MAX = 100_000;

/** Longest note title, in characters. */
export const NOTE_TITLE_MAX = 120;
/** Most notes (active and archived) one person may keep in one workspace. */
export const NOTES_PER_PERSON_MAX = 200;

const noteText = z
  .string()
  .max(
    NOTE_MAX,
    `Notes are limited to ${NOTE_MAX.toLocaleString('en-US')} characters.`,
  );
const noteTitle = z
  .string()
  .trim()
  .min(1, 'A note needs a name.')
  .max(
    NOTE_TITLE_MAX,
    `Note names are limited to ${NOTE_TITLE_MAX} characters.`,
  )
  .refine(
    (t) => !/[\u0000-\u001f\u007f]/.test(t),
    'Note names cannot hold control characters.',
  );

/**
 * ADR-0073 (P06): one of a person's named notes in a workspace. Private to its author. `version`
 * counts text saves only; renaming or archiving does not change it, so an open editor's next
 * save is not refused because the note was renamed elsewhere.
 */
export const WorkspaceNoteSchema = z.strictObject({
  id,
  workspace_id: id,
  title: z.string().min(1).max(NOTE_TITLE_MAX),
  text: z.string().max(NOTE_MAX),
  version: z.number().int().min(1),
  status: z.enum(['active', 'archived']),
  /** The note the single ADR-0060 notepad became (migration 46). */
  from_notepad: z.boolean(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type WorkspaceNote = z.infer<typeof WorkspaceNoteSchema>;

export const WorkspaceNoteSummarySchema = WorkspaceNoteSchema.omit({
  text: true,
}).extend({ chars: z.number().int().min(0) });
export type WorkspaceNoteSummary = z.infer<typeof WorkspaceNoteSummarySchema>;

/** The person's notes in a workspace, most recently changed first. */
export const WorkspaceNoteListSchema = z.strictObject({
  notes: z.array(WorkspaceNoteSummarySchema).max(NOTES_PER_PERSON_MAX),
});
export type WorkspaceNoteList = z.infer<typeof WorkspaceNoteListSchema>;

export const WorkspaceNoteRequestSchema = z.strictObject({
  /** The version the text was based on; a stale one is refused so another window's text is not lost. */
  expected_version: z.number().int().min(1),
  text: noteText,
});
export const NoteCreateRequestSchema = z.strictObject({
  title: noteTitle,
  text: noteText.default(''),
});
export const NoteRenameRequestSchema = z.strictObject({ title: noteTitle });
export const NoteArchiveRequestSchema = z.strictObject({
  archived: z.boolean(),
});

export const ActivityNowKindSchema = z.enum([
  /** A model request on a plan connection that has not finished. */
  'plan_request',
  /** A workflow (for example a skeptic review) that is not finished. */
  'workflow',
  /** A product run on a paired computer that has not finished. */
  'desktop_job',
  /** ADR-0088 (P24): qualifications the studio is running one after another. */
  'qualification_queue',
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
  /** True while it is actually moving (spinner); false when paused, waiting for someone or stale. */
  active: z.boolean(),
  /**
   * For a plan request, what it is for (qualification, chat, codex_build…); for a workflow, its
   * role (r02_discovery…, ADR-0103); otherwise null.
   */
  purpose: z.string().max(40).nullable(),
  run_id: id.nullable(),
  /** For a workflow, what it works on (an assessment's problem, ADR-0103); otherwise null. */
  subject_id: id.nullable(),
  started_at: timestamp,
});
export type ActivityNowItem = z.infer<typeof ActivityNowItemSchema>;

/** Most items returned per kind. */
export const ACTIVITY_NOW_MAX = 10;

export const ActivityNowSchema = z.strictObject({
  items: z.array(ActivityNowItemSchema).max(ACTIVITY_NOW_MAX * 4),
  generated_at: timestamp,
});
export type ActivityNow = z.infer<typeof ActivityNowSchema>;
