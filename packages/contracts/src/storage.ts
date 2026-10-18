import {
  z,
  id,
  text,
  hash,
  timestamp,
  version,
  OutcomeSchema,
  ProductStageSchema,
  ExecutionStateSchema,
  ConditionSchema,
  DiscoverySchema,
} from './primitives.js';
import { LinkRelationSchema } from './records.js';
import { AssumptionBodySchema, HumilityBodySchema } from './oversight.js';
import { RetentionSchema } from './research.js';
import { SearchBriefBodySchema } from './discovery.js';

// Persistent record bodies (T02). Bodies hold references and hashes; source content and
// large artifacts stay outside the database and workflow history.
const short = z.string().trim().min(1).max(500);
const uncertainty = text.max(2000);
export const StoredKindSchema = z.enum([
  'source',
  'claim',
  'problem',
  'idea',
  'alternative',
  'assessment',
  'product',
  'specification',
  'run',
  'task',
  'decision',
  'grant',
  'artifact',
  'assumption',
  'humility_review',
  'search_brief',
]);
export type StoredKind = z.infer<typeof StoredKindSchema>;
export const RecordModeSchema = z.enum(['fixture', 'real']);

const SourceBody = z
  .strictObject({
    url: z.url().max(2000),
    retrieval_status: z.enum(['available', 'inaccessible', 'removed']),
    content_hash: hash.nullable(),
    retrieved_at: timestamp,
    published_at: timestamp.nullable(),
    independent_origin: short,
    observation: text.max(2000),
    uncertainty,
    // T06: present only on versions the source broker wrote from a real retrieval. The
    // generic record API refuses to set it, so a manual source cannot pose as retrieved.
    retrieval: z
      .strictObject({
        retrieval_id: id,
        final_url: z.url().max(2000),
        access: z.enum(['public', 'restricted', 'gone']),
        extraction: z.enum(['extracted', 'none']),
        retention: RetentionSchema,
        text_hash: hash.nullable(),
        canonical_url: z.url().max(2000).nullable(),
        origin_cluster: id,
        policy_hash: hash,
      })
      .optional(),
  })
  .superRefine((s, ctx) => {
    if (s.retrieval_status === 'available' && !s.content_hash)
      ctx.addIssue({
        code: 'custom',
        message: 'Available sources require a content hash.',
      });
  });
export const StoredBodySchemas = {
  source: SourceBody,
  claim: z.strictObject({
    statement: text.max(2000),
    basis: z.enum(['observation', 'inference']),
    uncertainty,
  }),
  problem: z.strictObject({
    statement: text.max(2000),
    affected_group: short,
    uncertainty,
  }),
  idea: z.strictObject({ summary: text.max(2000), uncertainty }),
  alternative: z.strictObject({
    kind: OutcomeSchema,
    rationale: text.max(2000),
    tradeoffs: z.array(short).min(1).max(20),
    uncertainty,
  }),
  assessment: z.strictObject({
    rubric_version: short,
    summary: text.max(2000),
    evidence_confidence: z.enum(['low', 'medium', 'high']),
    ethical_concerns: z.array(short).max(20),
  }),
  // Lifecycle fields are created at their initial value and only domain transitions may move them.
  product: z.strictObject({
    stage: ProductStageSchema,
    summary: text.max(2000),
  }),
  specification: z.strictObject({
    spec_hash: hash,
    summary: text.max(2000),
    acceptance_criteria: z.array(short).min(1).max(30),
  }),
  run: z.strictObject({
    state: ExecutionStateSchema,
    experiment_condition: ConditionSchema,
    discovery_method: DiscoverySchema,
    config_hash: hash.nullable(),
  }),
  task: z.strictObject({
    state: ExecutionStateSchema,
    role: short,
    goal: text.max(2000),
  }),
  decision: z.strictObject({
    question: text.max(2000),
    kind: z.enum(['clarification', 'judgment', 'authorization', 'feedback']),
    status: z.enum(['pending', 'answered', 'expired', 'revoked']),
    selected_option: short.nullable(),
    rationale: text.max(2000).nullable(),
  }),
  // Legacy T02 note kinds. Since T03, decisions and grants that carry authority live in their
  // own enforced tables; the generic record API refuses to create these kinds.
  grant: z.strictObject({
    action_type: short,
    scope: text.max(2000),
    expires_at: timestamp,
    status: z.enum(['active', 'revoked', 'expired']),
  }),
  artifact: z.strictObject({
    storage_uri: z
      .string()
      .max(2000)
      .regex(/^(file|artifact|fixture):\/\/\S+$/),
    sha256: hash,
    bytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
    media_type: short,
  }),
  assumption: AssumptionBodySchema,
  humility_review: HumilityBodySchema,
  search_brief: SearchBriefBodySchema,
} as const satisfies Record<StoredKind, z.ZodType>;
export const lifecycleField: Partial<
  Record<StoredKind, { field: string; initial: string }>
> = {
  product: { field: 'stage', initial: 'captured' },
  run: { field: 'state', initial: 'queued' },
  task: { field: 'state', initial: 'queued' },
};
export const MAX_BODY_BYTES = 16384;
/** Kinds whose authority is enforced elsewhere (T03 decision and grant tables). */
export const UNMANAGED_KINDS: readonly StoredKind[] = ['decision', 'grant'];

export const CreateWorkspaceRequestSchema = z.strictObject({
  name: short,
  record_mode: RecordModeSchema,
});
export const CreateEntityRequestSchema = z.strictObject({
  kind: StoredKindSchema,
  title: short,
  body: z.record(z.string(), z.unknown()),
});
export const ReviseEntityRequestSchema = z.strictObject({
  expected_version: version,
  title: short,
  body: z.record(z.string(), z.unknown()),
  reason: short,
  corrects_version: version.nullable(),
});
export const ArchiveEntityRequestSchema = z.strictObject({
  expected_version: version,
  reason: short,
});
export const RedactEntityRequestSchema = z.strictObject({
  expected_version: version,
  reason_code: z.enum(['privacy', 'legal', 'license', 'owner_request']),
});
export const CreateLinkRequestSchema = z.strictObject({
  relation: LinkRelationSchema,
  from: z.strictObject({ id, version }),
  to: z.strictObject({ id, version }),
  rationale: short,
});
export const RetractLinkRequestSchema = z.strictObject({ reason: short });

export const WorkspaceSchema = z.strictObject({
  id,
  name: short,
  record_mode: RecordModeSchema,
  role: z.enum(['owner', 'editor', 'viewer']),
  created_at: timestamp,
});
export const StoredStatusSchema = z.enum(['active', 'archived', 'redacted']);
export const StoredEntitySchema = z.strictObject({
  id,
  workspace_id: id,
  kind: StoredKindSchema,
  version,
  status: StoredStatusSchema,
  fixture: z.boolean(),
  title: z.string().max(500),
  body: z.record(z.string(), z.unknown()).nullable(),
  content_hash: hash,
  created_at: timestamp,
  updated_at: timestamp,
});
export const StoredVersionSchema = z.strictObject({
  version,
  status: StoredStatusSchema,
  title: z.string().max(500),
  body: z.record(z.string(), z.unknown()).nullable(),
  content_hash: hash,
  reason: z.string().max(500).nullable(),
  corrects_version: version.nullable(),
  actor_id: id,
  created_at: timestamp,
});
export const StoredLinkSchema = z.strictObject({
  id,
  workspace_id: id,
  relation: LinkRelationSchema,
  from: z.strictObject({ id, kind: StoredKindSchema, version }),
  to: z.strictObject({ id, kind: StoredKindSchema, version }),
  rationale: short,
  asserted_by: id,
  created_at: timestamp,
  retracted_at: timestamp.nullable(),
  retraction_reason: short.nullable(),
});
export const HistoryEntrySchema = z.strictObject({
  event_id: id,
  sequence: z.string().regex(/^[1-9][0-9]*$/),
  workspace_id: id,
  occurred_at: timestamp,
  actor_id: id,
  action: short,
  subject_kind: z.string().max(40),
  subject_id: id,
  subject_version: version.nullable(),
  content_hash: hash.nullable(),
  correlation_id: id,
  causation_id: id.nullable(),
  summary: z.string().max(1000),
});
export const EntityDetailSchema = z.strictObject({
  entity: StoredEntitySchema,
  versions: z.array(StoredVersionSchema),
  outgoing: z.array(StoredLinkSchema),
  incoming: z.array(StoredLinkSchema),
});
export type Workspace = z.infer<typeof WorkspaceSchema>;
export type StoredEntity = z.infer<typeof StoredEntitySchema>;
export type StoredVersion = z.infer<typeof StoredVersionSchema>;
export type StoredLink = z.infer<typeof StoredLinkSchema>;
export type HistoryEntry = z.infer<typeof HistoryEntrySchema>;
export type EntityDetail = z.infer<typeof EntityDetailSchema>;
export type CreateEntityRequest = z.infer<typeof CreateEntityRequestSchema>;
export type ReviseEntityRequest = z.infer<typeof ReviseEntityRequestSchema>;
export type CreateLinkRequest = z.infer<typeof CreateLinkRequestSchema>;
