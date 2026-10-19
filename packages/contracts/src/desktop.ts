import { z, id, hash, timestamp } from './primitives.js';
import { RunInputSchema } from './artifacts.js';

export const DesktopCapabilitySchema = z.enum([
  'artifact.verify',
  'artifact.run',
]);

export const DesktopChallengeRequestSchema = z
  .strictObject({
    kind: z.enum(['desktop_login', 'worker']),
    proof_hash: hash,
    label: z.string().trim().min(1).max(80),
    workspace_id: id.nullable(),
    // Declarations are not evidence of isolation and grant no dispatch authority.
    capabilities: z.array(DesktopCapabilitySchema).max(2),
  })
  .refine(
    (v) =>
      v.kind === 'worker'
        ? v.workspace_id !== null
        : v.workspace_id === null && v.capabilities.length === 0,
    'Worker pairing needs a workspace; desktop login has no worker capabilities.',
  );
export const DesktopClaimSchema = z.strictObject({
  proof: z.string().regex(/^[a-f0-9]{64}$/),
});
export const DesktopChallengeSchema = z.strictObject({
  id,
  kind: z.enum(['desktop_login', 'worker']),
  label: z.string(),
  workspace_id: id.nullable(),
  capabilities: z.array(DesktopCapabilitySchema),
  comparison_code: z.string(),
  expires_at: timestamp,
  approved: z.boolean(),
});
export const DesktopDeviceSchema = z.strictObject({
  id,
  workspace_id: id.nullable(),
  label: z.string(),
  kind: z.enum(['desktop_login', 'worker']),
  capabilities: z.array(DesktopCapabilitySchema),
  state: z.enum(['active', 'paused', 'shutdown', 'revoked']),
  created_at: timestamp,
  expires_at: timestamp,
  last_seen_at: timestamp.nullable(),
  lease_expires_at: timestamp.nullable(),
  fence: z.number().int().nonnegative(),
});
export const DesktopControlSchema = z.strictObject({
  state: z.enum(['active', 'paused', 'shutdown', 'revoked']),
});
export const DesktopHeartbeatSchema = z.strictObject({
  fence: z.number().int().nonnegative(),
});
export type DesktopChallengeRequest = z.infer<
  typeof DesktopChallengeRequestSchema
>;
export type DesktopChallenge = z.infer<typeof DesktopChallengeSchema>;
export type DesktopDevice = z.infer<typeof DesktopDeviceSchema>;

export const DesktopJobRequestSchema = z.strictObject({
  request_id: id,
  artifact_id: id,
  manifest_sha256: hash,
  input: RunInputSchema,
});
export const DesktopJobReportSchema = z.strictObject({
  execution_id: id.nullable(),
  manifest_sha256: hash,
  archive_sha256: hash,
  backend: z.literal('wsl2-bwrap-systemd'),
  state: z.enum([
    'succeeded',
    'failed',
    'blocked',
    'cancelled',
    'lost',
    'cleanup_required',
  ]),
  stdout: z.string().max(8000),
  stdout_truncated: z.boolean(),
  exit_code: z.number().int().nullable(),
  reason: z.string().max(500).nullable(),
});
export const DesktopJobSchema = z.strictObject({
  id,
  device_id: id,
  workspace_id: id,
  owner_id: id,
  request_id: id,
  artifact_id: id,
  product_id: id,
  manifest_sha256: hash,
  archive_sha256: hash,
  input: RunInputSchema,
  state: z.enum([
    'queued',
    'leased',
    'running',
    'completed',
    'cancelled',
    'expired',
    'reconciling',
  ]),
  fence: z.number().int().nonnegative(),
  lease_id: id.nullable(),
  execution_id: id.nullable(),
  reconciled_outcome_hash: hash.nullable(),
  lease_expires_at: timestamp.nullable(),
  created_at: timestamp,
  expires_at: timestamp,
  cancel_requested: z.boolean(),
  report: DesktopJobReportSchema.nullable(),
  verification: z.literal('worker_report_only'),
  limits: z.strictObject({
    runtime_ms: z.literal(20000),
    memory_bytes: z.literal(268435456),
    network: z.literal('none'),
    max_attempts: z.literal(1),
    local_compute_billing: z.literal('not_metered_by_studio'),
  }),
});
export const DesktopJobLeaseSchema = z.strictObject({ lease_id: id });
export const DesktopJobStartSchema = z.strictObject({
  lease_id: id,
  execution_id: id,
});
export const DesktopJobFinishSchema = z.strictObject({
  lease_id: id,
  report: DesktopJobReportSchema,
});
export type DesktopJob = z.infer<typeof DesktopJobSchema>;
export type DesktopJobReport = z.infer<typeof DesktopJobReportSchema>;
