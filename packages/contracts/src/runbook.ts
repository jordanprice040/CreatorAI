import { z, id, hash, version, counter } from './primitives.js';

// ADR-0080 (P16): an implementation runbook exported for a separate coding model or person.
// The bundle is computed by application code from one saved spec or proposal version and the
// records it follows; no model writes it. It is a set of plain files plus this manifest, and it
// must be usable without Creator Agent's database.

export const RUNBOOK_FORMAT = 'runbook/1';
/** The largest bundle the studio writes (all files together, before the archive). */
export const RUNBOOK_MAX_BYTES = 2 * 1024 * 1024;
export const RUNBOOK_MAX_FILES = 80;

const ref = z.strictObject({ id, version });
/** A bundle path: forward slashes, portable names, no dot segments. */
export const RunbookPathSchema = z
  .string()
  .max(120)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*(\/[A-Za-z0-9][A-Za-z0-9._-]*)*$/);

export const RunbookPromptSchema = z.strictObject({
  /** Position in the order the prompts are meant to be pasted, from 1. */
  order: counter.min(1),
  path: RunbookPathSchema,
  step: z.enum(['setup', 'slice', 'review_repair', 'verify_export', 'action']),
  title: z.string().max(400),
  /** The spec task this prompt implements, for a slice. */
  task: z.string().max(4).nullable(),
  /** Paths of the prompts that must have passed their gate first. */
  prerequisites: z.array(RunbookPathSchema).max(60),
});
export type RunbookPrompt = z.infer<typeof RunbookPromptSchema>;

export const RunbookManifestSchema = z.strictObject({
  format: z.literal(RUNBOOK_FORMAT),
  /** software: from a spec. action: a non-code plan, from a proposal. */
  kind: z.enum(['software', 'action']),
  title: z.string().max(500),
  subject: z.strictObject({
    type: z.enum(['specification', 'proposal']),
    id,
    version,
    content_hash: hash,
    /** When this version was saved; the bundle carries no export time. */
    saved_at: z.iso.datetime(),
  }),
  /** The freeze of exactly this spec version, when there is one; null means not frozen. */
  freeze: z
    .strictObject({ id, frozen_at: z.iso.datetime(), content_hash: hash })
    .nullable(),
  problem: ref.nullable(),
  option: ref,
  selection: z.strictObject({
    id,
    /** False when a later selection for the problem replaced it. */
    current: z.boolean(),
  }),
  /** The studio recipe the spec's checks fit, when one does. A fit is not a qualification. */
  recipe: z.enum(['python-build/1', 'static-web/1', 'mixed', 'none']),
  prompts: z.array(RunbookPromptSchema).min(1).max(60),
  /** What was left out on purpose, by count; none of it is in any file. */
  withheld: z.strictObject({
    held_out_cases: counter,
    redacted_secrets: counter,
    redacted_paths: counter,
  }),
  /** What a reader should know before relying on the bundle. */
  warnings: z.array(z.string().max(500)).max(40),
  /** Every other file in the bundle, sorted by path. */
  files: z
    .array(
      z.strictObject({ path: RunbookPathSchema, bytes: counter, sha256: hash }),
    )
    .min(1)
    .max(RUNBOOK_MAX_FILES),
  /** SHA-256 over the sorted "path sha256" lines of `files`. */
  bundle_hash: hash,
});
export type RunbookManifest = z.infer<typeof RunbookManifestSchema>;

/** What the app shows before a download: the manifest and the archive's name and size. */
export const RunbookSummarySchema = z.strictObject({
  name: z.string().max(200),
  archive_bytes: counter,
  manifest: RunbookManifestSchema,
});
export type RunbookSummary = z.infer<typeof RunbookSummarySchema>;

export const SaveRunbookFileRequestSchema = z.strictObject({
  version: version.optional(),
  upload_key: id,
});
