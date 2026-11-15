import { z, id, hash } from './primitives.js';

// ADR-0121 (F10): Monitor > Storage. Disk used per project and the one cleanup the studio
// offers: removing old build workspaces whose latest commit is already in a verified package.

const bytes = z.number().int().min(0);
const reason = z.string().max(300);

export const StorageProjectSchema = z.strictObject({
  workspace_id: id,
  name: z.string().max(500),
  fixture: z.boolean(),
  products: z.number().int().min(0),
  /** Each product's own Git repository (its integration history). */
  repositories: bytes,
  /** Task and merge checkouts the builds work in; the only thing cleanup removes. */
  build_workspaces: bytes,
  build_workspace_count: z.number().int().min(0),
  /** Package archives and manifests. Never removed by cleanup. */
  packages: bytes,
  verified_packages: z.number().int().min(0),
  /** Build, run and terminal records kept as evidence. */
  records: bytes,
  /** Uploaded workspace files, every version, stored in the database. */
  files: bytes,
  /** Previews keep no files of their own; these are counts of their records. */
  previews_live: z.number().int().min(0),
  previews_ended: z.number().int().min(0),
  /** A thesis study uses this project: nothing in it is ever cleaned. */
  study: z.boolean(),
});
export type StorageProject = z.infer<typeof StorageProjectSchema>;

export const StorageStudioItemSchema = z.strictObject({
  key: z.enum([
    'plan_qualification_builds',
    'build_qualification_builds',
    'backups',
  ]),
  label: z.string().max(200),
  bytes: bytes.nullable(),
  note: z.string().max(400),
});
export type StorageStudioItem = z.infer<typeof StorageStudioItemSchema>;

export const CleanupCandidateSchema = z.strictObject({
  product_id: id,
  workspace_id: id,
  /** The folder's name under the product's worktrees folder. */
  name: id,
  kind: z.enum(['task', 'merge']),
  head: z.string().regex(/^[a-f0-9]{40}$/),
  bytes,
  last_changed_at: z.iso.datetime(),
});
export type CleanupCandidate = z.infer<typeof CleanupCandidateSchema>;

export const CleanupKeptSchema = z.strictObject({
  product_id: id,
  workspace_id: id.nullable(),
  name: z.string().max(200),
  bytes,
  reason,
});
export type CleanupKept = z.infer<typeof CleanupKeptSchema>;

export const PackageCheckSchema = z.strictObject({
  artifact_id: id,
  product_id: id,
  ok: z.boolean(),
  reason: reason.nullable(),
});
export type PackageCheck = z.infer<typeof PackageCheckSchema>;

export const CleanupPlanSchema = z.strictObject({
  older_than_days: z.number().int().min(1).max(365),
  /** Binds the confirmation to exactly this list: a changed list needs a new confirmation. */
  plan_hash: hash,
  remove: z.array(CleanupCandidateSchema),
  keep: z.array(CleanupKeptSchema),
  remove_bytes: bytes,
  packages_checked: z.number().int().min(0),
  packages_failed: z.array(PackageCheckSchema),
});
export type CleanupPlan = z.infer<typeof CleanupPlanSchema>;

export const StorageCleanupRecordSchema = z.strictObject({
  id: id,
  occurred_at: z.iso.datetime(),
  action: z.enum(['storage.cleanup.intent', 'storage.cleanup.outcome']),
  removed: z.number().int().min(0),
  failed: z.number().int().min(0),
  bytes_freed: bytes,
  packages_ok: z.boolean().nullable(),
  /** An intent with no outcome: the cleanup stopped part-way (review L-4). */
  interrupted: z.boolean(),
});
export type StorageCleanupRecord = z.infer<typeof StorageCleanupRecordSchema>;

export const StorageReportSchema = z.strictObject({
  measured_at: z.iso.datetime(),
  projects: z.array(StorageProjectSchema),
  /** Studio-wide folders; shown to the studio owner only. */
  studio: z.array(StorageStudioItemSchema),
  cleanup: CleanupPlanSchema,
  history: z.array(StorageCleanupRecordSchema),
});
export type StorageReport = z.infer<typeof StorageReportSchema>;

export const STORAGE_CLEANUP_CONFIRMATION = 'remove old build workspaces';

export const StorageCleanupRequestSchema = z.strictObject({
  older_than_days: z.number().int().min(1).max(365),
  plan_hash: hash,
  /** Typed by the page when the person presses the confirming button. */
  confirmation: z.literal(STORAGE_CLEANUP_CONFIRMATION),
});
export type StorageCleanupRequest = z.infer<typeof StorageCleanupRequestSchema>;

export const StorageCleanupResultSchema = z.strictObject({
  removed: z.array(CleanupCandidateSchema),
  failed: z.array(
    z.strictObject({ product_id: id, name: z.string().max(200), reason }),
  ),
  bytes_freed: bytes,
  /** Every verified package hashed again after the removal; all must still match. */
  packages_checked: z.number().int().min(0),
  packages_changed: z.array(PackageCheckSchema),
});
export type StorageCleanupResult = z.infer<typeof StorageCleanupResultSchema>;
