import { z, id, timestamp, counter } from './primitives.js';

// ADR-0123 (F1): backups and restore in Settings. A backup is the T17 pair (a pg_dump of the
// records database plus a byte copy of the product store, bound by a manifest of SHA-256
// hashes), made by the same code as `pnpm backup create`. Only the studio owner (the person
// recorded as the studio spending manager, ADR-0113) can see or use any of this.

/** How a backup folder came to exist, read from its name (the manifest format is unchanged). */
export const BackupKindSchema = z.enum([
  'manual',
  'daily',
  'pre_upgrade',
  'adopt',
  'other',
]);
export type BackupKind = z.infer<typeof BackupKindSchema>;

export const BACKUP_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,199}$/;
export const BackupNameSchema = z
  .string()
  .regex(BACKUP_NAME, 'Not a backup folder name.')
  .refine((n) => !n.endsWith('.partial'), 'Not a finished backup.');

export const BackupEntrySchema = z.strictObject({
  name: BackupNameSchema,
  kind: BackupKindSchema,
  /** `creator-backup/1` (database and products) or the older database-only upgrade format. */
  format: z.enum(['creator-backup/1', 'creator-premigration/1']),
  created_at: timestamp,
  schema_version: counter,
  /** Database dump plus every product file, as the manifest records them. */
  bytes: counter,
  product_files: counter,
  /** Whether this version of the app can restore it (same schema, full format). */
  restorable: z.boolean(),
  /** Made by another studio, or an earlier copy of this one: listed and restorable, never pruned. */
  other_studio: z.boolean(),
  /** Why not, in a sentence, when it can't. */
  restore_note: z.string().max(400).nullable(),
});
export type BackupEntry = z.infer<typeof BackupEntrySchema>;

export const BackupSettingsSchema = z.strictObject({
  /** 0 while the defaults apply and nothing has been saved. */
  version: counter,
  daily_enabled: z.boolean(),
  keep_daily: z.number().int().min(1).max(60),
  folder: z.string().min(3).max(1000),
  /** The studio's configured folder, which the defaults use. */
  default_folder: z.string().min(3).max(1000),
  updated_at: timestamp.nullable(),
});
export type BackupSettings = z.infer<typeof BackupSettingsSchema>;

export const BackupSettingsInputSchema = z.strictObject({
  expected_version: counter,
  daily_enabled: z.boolean(),
  keep_daily: z.number().int().min(1).max(60),
  folder: z.string().trim().min(3).max(1000),
});
export type BackupSettingsInput = z.infer<typeof BackupSettingsInputSchema>;

export const BackupRunTriggerSchema = z.enum([
  'manual',
  'daily',
  'check',
  'restore',
]);
export const BackupRunStatusSchema = z.enum([
  'running',
  'succeeded',
  'failed',
  'interrupted',
]);
export const BackupRunSchema = z.strictObject({
  id,
  trigger: BackupRunTriggerSchema,
  status: BackupRunStatusSchema,
  /** The backup made, checked or restored. */
  backup_name: z.string().max(200).nullable(),
  started_at: timestamp,
  finished_at: timestamp.nullable(),
  error: z.string().max(2000).nullable(),
  /** A restore's target and verification summary; a check's hash count. */
  result: z.record(z.string(), z.unknown()).nullable(),
});
export type BackupRun = z.infer<typeof BackupRunSchema>;

export const BackupsViewSchema = z.strictObject({
  settings: BackupSettingsSchema,
  /** Newest first. Folders that are not finished backups are left out. */
  backups: z.array(BackupEntrySchema),
  /** A problem reading the folder (missing, not readable), or null. */
  folder_problem: z.string().max(400).nullable(),
  /** Newest first, at most 20. */
  runs: z.array(BackupRunSchema).max(20),
  running: BackupRunSchema.nullable(),
  /** The last daily backup attempt (one per UTC day), and how it ended. */
  last_daily: z
    .strictObject({
      day: z.iso.date(),
      status: BackupRunStatusSchema,
      error: z.string().max(2000).nullable(),
    })
    .nullable(),
  /** How many listed backups were made by another studio or an earlier copy of this one. */
  other_studio_backups: counter,
  /** The database the studio uses (`current_database()`), so a restore target can't reuse it. */
  database_name: z.string().max(63),
  schema_version: counter,
});
export type BackupsView = z.infer<typeof BackupsViewSchema>;

export const RestoreInputSchema = z.strictObject({
  /** A new database on the same server; created if missing, refused unless empty. */
  database_name: z
    .string()
    .regex(
      /^[a-z][a-z0-9_]{0,62}$/,
      'Use lowercase letters, digits and underscores, starting with a letter.',
    ),
  /** A new, absent or empty folder for the restored product store. */
  products_root: z.string().trim().min(3).max(1000),
});
export type RestoreInput = z.infer<typeof RestoreInputSchema>;

export const BackupStartedSchema = z.strictObject({ run: BackupRunSchema });
export type BackupStarted = z.infer<typeof BackupStartedSchema>;
