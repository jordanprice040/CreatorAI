import { z } from './primitives.js';

// X06 hosted operation contracts: readiness, the owner operations status and smoke reports.

const environment = z.enum(['local', 'test', 'staging', 'live']);
const sha = z.string().regex(/^[0-9a-f]{40}$/);
const hash = z.string().regex(/^[0-9a-f]{64}$/);

/**
 * `verified` only when an owner-recorded passing verification matches this exact commit,
 * configuration and schema; `stale` when the latest one checked something else.
 */
export const VerificationStateSchema = z.enum([
  'verified',
  'unverified',
  'stale',
  'failed',
]);
export const ReadinessSchema = z.strictObject({
  ready: z.boolean(),
  mode: z.enum(['local', 'hosted']),
  environment,
  build_commit: sha.nullable(),
  config_hash: hash,
  schema_version: z.number().int().nullable(),
  verification: VerificationStateSchema,
  checks: z.array(z.strictObject({ name: z.string(), ok: z.boolean() })),
  public_origins: z
    .strictObject({ web: z.string(), api: z.string(), preview: z.string() })
    .nullable(),
});
export type Readiness = z.infer<typeof ReadinessSchema>;

export const SmokeCheckSchema = z.strictObject({
  name: z.string().max(60),
  ok: z.boolean(),
  required: z.boolean(),
  detail: z.string().max(500),
});
export const SmokeReportSchema = z.strictObject({
  format: z.literal('creator-smoke/1'),
  target: z.string().max(300),
  declared_environment: environment,
  environment: environment.nullable(),
  build_commit: sha.nullable(),
  config_hash: hash.nullable(),
  started_at: z.iso.datetime(),
  finished_at: z.iso.datetime(),
  passed: z.boolean(),
  checks: z.array(SmokeCheckSchema).max(30),
});
export type SmokeReport = z.infer<typeof SmokeReportSchema>;

export const VerificationRequestSchema = z.strictObject({
  smoke_report: SmokeReportSchema,
  confirmation: z.string().max(200).optional(),
});

const count = z.number().int().nonnegative();
const seconds = z.number().nonnegative().nullable();
const nano = z.string().regex(/^-?[0-9]+$/);
export const LocalWorkerAvailabilitySchema = z.enum([
  'online',
  'unreachable',
  'paused',
  'shutdown',
  'revoked',
  'expired',
]);
export const OpsStatusSchema = z.strictObject({
  readiness: ReadinessSchema,
  checks: z.array(
    z.strictObject({ name: z.string(), ok: z.boolean(), detail: z.string() }),
  ),
  identity: z
    .strictObject({
      environment,
      claimed_at: z.iso.datetime(),
      version: z.number().int(),
    })
    .nullable(),
  latest_verification: z
    .strictObject({
      id: z.uuid(),
      environment,
      build_commit: sha,
      config_hash: hash,
      schema_version: z.number().int(),
      result: z.enum(['passed', 'failed']),
      checks: z.unknown(),
      smoke_report_sha256: hash,
      confirmation: z.string().nullable(),
      recorded_by: z.uuid(),
      created_at: z.iso.datetime(),
    })
    .nullable(),
  metrics: z.strictObject({
    observed_at: z.iso.datetime(),
    queue: z.strictObject({
      workflows_live: z.record(z.string(), count),
      tasks_open: z.record(z.string(), count),
      oldest_queued_task_seconds: seconds,
      outbox_pending: count,
      outbox_oldest_pending_seconds: seconds,
    }),
    workers: z.strictObject({
      workflow_leases_active: count,
      workflow_leases_expired: count,
      local: z.record(LocalWorkerAvailabilitySchema, count),
      local_last_seen: z.array(
        z.strictObject({
          id: z.uuid(),
          label: z.string(),
          availability: LocalWorkerAvailabilitySchema,
          last_seen_at: z.iso.datetime().nullable(),
        }),
      ),
      local_jobs_open: count,
    }),
    budget: z.strictObject({
      envelopes_active: count,
      envelopes_overrun: count,
      reserved_nano: nano,
      unknown_nano: nano,
      incurred_nano: nano,
      reservations_in_flight: count,
      reservations_unknown: count,
    }),
    index: z.strictObject({
      context_entries_current: count,
      context_newest_indexed_seconds: seconds,
      saved_queries: count,
    }),
    webhooks: z.strictObject({
      accepted_24h: count,
      rejected_signature_24h: count,
      last_received_seconds: seconds,
    }),
    uncertain: z.record(z.string(), count),
  }),
  alerts: z.array(
    z.strictObject({
      id: z.string(),
      metric: z.string(),
      above: z.number(),
      severity: z.enum(['info', 'warning', 'critical']),
      summary: z.string(),
      value: z.number().nullable(),
      state: z.enum(['firing', 'ok', 'no_data']),
    }),
  ),
  alert_delivery: z.literal('none'),
});
export type OpsStatus = z.infer<typeof OpsStatusSchema>;
export const UncertainActionSchema = z.strictObject({
  subsystem: z.string(),
  id: z.uuid(),
  workspace_id: z.uuid().nullable(),
  state: z.string(),
  since: z.iso.datetime(),
  runbook: z.string(),
});
