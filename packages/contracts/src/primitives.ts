import { z } from 'zod';

export { z };
export const SCHEMA_VERSION = '1.0' as const;
export const schemaVersion = z.literal(SCHEMA_VERSION);
export const id = z.uuid();
export const text = z.string().trim().min(1).max(8000);
export const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const timestamp = z.iso.datetime();
export const counter = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
export const version = counter.min(1);
// Money never enters JSON as a floating-point number or an unbounded BigInt.
export const nanoUsd = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
export const MoneySchema = z.strictObject({
  currency: z.literal('USD'),
  unit: z.literal('nano'),
  amount: nanoUsd,
});
export const ConditionSchema = z.enum([
  'autonomous',
  'human_in_loop',
  'human_only',
]);
export const DiscoverySchema = z.enum([
  'structured',
  'open_ended',
  'human_defined',
]);
export const OutcomeSchema = z.enum([
  'build',
  'use_existing',
  'change_process',
  'human_led',
  'hybrid',
  'investigate',
  'defer',
  'decline',
  'failed',
]);
export const ExecutionStateSchema = z.enum([
  'queued',
  'admitted',
  'running',
  'waiting_dependency',
  'waiting_human',
  'paused_budget',
  'paused_operator',
  'reconciling',
  'succeeded',
  'failed',
  'cancelled',
]);
export const ProductStageSchema = z.enum([
  'captured',
  'researched',
  'alternatives_compared',
  'experiment_ready',
  'build_ready',
  'building',
  'verifying',
  'ready_to_try',
  'iterating',
  'release_candidate',
  'released',
  'maintained',
  'archived',
  'existing_solution_recommended',
  'nonsoftware_recommended',
  'human_led_recommended',
  'hybrid_recommended',
  'deferred',
  'rejected',
  'failed',
]);
export const EntityKindSchema = z.enum([
  'source',
  'claim',
  'problem',
  'idea',
  'alternative',
  'assessment',
  'decision',
  'specification',
  'task',
  'run',
  'product',
  'artifact',
  'test',
  'review',
  'protocol',
  'packet',
  'policy',
  'config',
  'prompt',
  'grant',
  'assumption',
  'humility_review',
]);
export const EntityRefSchema = z.strictObject({
  kind: EntityKindSchema,
  id,
  workspace_id: id,
  version,
  sha256: hash,
});
export const RecordFields = {
  schema_version: schemaVersion,
  id,
  workspace_id: id,
  version,
  created_at: timestamp,
};
export const EvidenceSchema = z.strictObject({
  source: EntityRefSchema,
  locator: text,
  passage: text,
});
export const ErrorCodeSchema = z.enum([
  'INVALID_CONTRACT',
  'INVALID_CONFIG',
  'INVALID_TRANSITION',
  'VERSION_CONFLICT',
  'MISSING_EVIDENCE',
  'EVIDENCE_MISMATCH',
  'SCOPE_EXCEEDED',
  'LIMIT_EXCEEDED',
  'EXPIRED',
  'HUMAN_ONLY_DENIED',
  'LIVE_DISABLED',
  'RESULT_MISMATCH',
  'ORIGIN_DENIED',
  'BODY_TOO_LARGE',
  'NOT_FOUND',
  'ACCESS_DENIED',
  'DUPLICATE',
  'IDEMPOTENCY_CONFLICT',
  'STORAGE_UNAVAILABLE',
  'UNAUTHENTICATED',
  'CSRF_DENIED',
  'INTERNAL_ERROR',
]);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;
export class ContractError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details: readonly string[] = [],
  ) {
    super(message);
    this.name = 'ContractError';
  }
}
export function parse<T>(
  schema: z.ZodType<T>,
  value: unknown,
  code: ErrorCode = 'INVALID_CONTRACT',
): T {
  const result = schema.safeParse(value);
  if (!result.success)
    throw new ContractError(
      code,
      'Input does not satisfy the versioned contract.',
      result.error.issues.map(
        (i) => `${i.path.join('.') || '(root)'}: ${i.message}`,
      ),
    );
  return result.data;
}
export type EntityRef = z.infer<typeof EntityRefSchema>;
export type Outcome = z.infer<typeof OutcomeSchema>;
export type ExecutionState = z.infer<typeof ExecutionStateSchema>;
export type ProductStage = z.infer<typeof ProductStageSchema>;
