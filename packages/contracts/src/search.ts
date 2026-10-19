import {
  z,
  id,
  hash,
  timestamp,
  counter,
  nanoUsd,
  version,
} from './primitives.js';
import { StoredKindSchema, StoredStatusSchema } from './storage.js';
import { DataClassSchema, DecisionStatusSchema } from './oversight.js';
import { ModelRefSchema } from './routing.js';
import { BrokerCallResultSchema } from './budget.js';
import {
  LocalDateSchema,
  SearchHitSchema,
  SearchQuerySchema,
  SearchTypeSchema,
  TimeZoneSchema,
} from './catalog.js';

// X03: saved queries, metered semantic search over access-safe lexical candidates,
// natural-language audit questions compiled into fixed read-only plans, and bounded lineage
// graphs with integrity-checked exports. Nothing here carries SQL: plans name an intent from
// a closed list and typed parameters, and the application owns every query text.
const short = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(1200);

export const SavedQueryKindSchema = z.enum(['search', 'question']);
export const SaveQueryRequestSchema = z.strictObject({
  name: z.string().trim().min(1).max(120),
  kind: SavedQueryKindSchema,
  /** A search query or an audit question request; validated for its kind when saved and run. */
  body: z.record(z.string(), z.unknown()),
});
export type SaveQueryRequest = z.infer<typeof SaveQueryRequestSchema>;
export const SavedQuerySchema = z.strictObject({
  id,
  workspace_id: id,
  name: z.string().max(120),
  kind: SavedQueryKindSchema,
  body: z.record(z.string(), z.unknown()),
  body_hash: hash,
  created_by: id,
  created_at: timestamp,
  archived_at: timestamp.nullable(),
});
export type SavedQuery = z.infer<typeof SavedQuerySchema>;

/** Types semantic search may rank: the ones with readable text. */
export const SemanticTypeSchema = SearchTypeSchema.extract([
  'record',
  'passage',
  'decision',
]);
export const SemanticSearchRequestSchema = z.strictObject({
  q: z.string().trim().min(1).max(200),
  types: z.array(SemanticTypeSchema).min(1).max(3).default(['record']),
  kind: StoredKindSchema.nullable().default(null),
  /** The run and envelope the embedding calls are metered under. */
  run_id: id,
  envelope_id: id,
  /** The embedding model and its dated pricing; it must be listed for this workspace's mode. */
  model: ModelRefSchema,
  pricing_snapshot_id: id,
  /** Stable identity of this search: a repeat replays its embeddings instead of paying again. */
  operation_id: id,
  data_class: DataClassSchema,
  /** Access-safe lexical candidates to embed (text matches first, then recent records). */
  pool: z.number().int().min(1).max(40).default(20),
  limit: z.number().int().min(1).max(20).default(10),
  justification: note,
});
export type SemanticSearchRequest = z.infer<typeof SemanticSearchRequestSchema>;
export const SemanticHitSchema = SearchHitSchema.extend({
  /** Cosine similarity to the query, rounded to 4 places. */
  similarity: z.number().min(-1).max(1),
  /** Whether the lexical stage matched this item (otherwise it was a recent-item fill). */
  lexical_match: z.boolean(),
});
export const SemanticSearchResultSchema = z.strictObject({
  status: z.enum(['ranked', 'partial', 'failed']),
  reason_code: z.string().max(80),
  explanation: z.string().max(1200),
  fixture: z.boolean(),
  model: ModelRefSchema,
  query: z.strictObject({
    q: z.string().max(200),
    types: z.array(SemanticTypeSchema),
    kind: StoredKindSchema.nullable(),
  }),
  pool: z.strictObject({
    candidates: counter,
    lexical_matches: counter,
    embedded: counter,
  }),
  hits: z.array(SemanticHitSchema).max(20),
  metering: z.strictObject({
    calls: counter,
    replayed: counter,
    reserved: nanoUsd,
    incurred: nanoUsd,
    unknown: nanoUsd,
    logical_operation_ids: z.array(id).max(41),
  }),
});
export type SemanticSearchResult = z.infer<typeof SemanticSearchResultSchema>;

/**
 * A record named in a question: an id (or its first 8+ characters) or an exact title. The
 * store resolves it only among records the caller can read; redacted titles never match.
 */
export const SubjectRefSchema = z.union([
  z.strictObject({
    id: z.string().regex(/^[0-9a-f]{8}[0-9a-f-]{0,28}$/i),
  }),
  z.strictObject({
    title: z.string().trim().min(1).max(200),
    kind: StoredKindSchema.nullable(),
  }),
]);
export type SubjectRef = z.infer<typeof SubjectRefSchema>;
export const AuditWindowSchema = z
  .strictObject({
    from: LocalDateSchema.nullable(),
    to: LocalDateSchema.nullable(),
    tz: TimeZoneSchema,
  })
  .refine((w) => !w.from || !w.to || w.from <= w.to, {
    message: 'from must not be after to.',
  });
export type AuditWindow = z.infer<typeof AuditWindowSchema>;
export const AUDIT_PLAN_VERSION = 'audit-plan/1' as const;
const planBase = {
  version: z.literal(AUDIT_PLAN_VERSION),
  limit: z.number().int().min(1).max(200),
};
const depth = z.number().int().min(1).max(8);
export const AuditPlanSchema = z.discriminatedUnion('intent', [
  z.strictObject({
    ...planBase,
    intent: z.literal('source_to_product'),
    subject: SubjectRefSchema,
    /** From a product back to its sources, or from a source forward to its products. */
    direction: z.enum(['to_sources', 'to_products']),
    depth,
  }),
  z.strictObject({
    ...planBase,
    intent: z.literal('lineage'),
    subject: SubjectRefSchema,
    direction: z.enum(['upstream', 'downstream']),
    depth,
  }),
  z.strictObject({
    ...planBase,
    intent: z.literal('run_cost'),
    run: SubjectRefSchema,
  }),
  z.strictObject({
    ...planBase,
    intent: z.literal('subject_cost'),
    /** Products, ideas or problems; runs are found through part_of lineage and builds. */
    subjects: z.array(SubjectRefSchema).min(1).max(10),
  }),
  z.strictObject({
    ...planBase,
    intent: z.literal('decisions'),
    run: SubjectRefSchema.nullable(),
    status: DecisionStatusSchema.nullable(),
    window: AuditWindowSchema,
  }),
  z.strictObject({
    ...planBase,
    intent: z.literal('activity'),
    subject: SubjectRefSchema.nullable(),
    action_prefix: z
      .string()
      .regex(/^[a-z_]+(\.[a-z_]*)?$/)
      .nullable(),
    window: AuditWindowSchema,
  }),
  z.strictObject({
    ...planBase,
    intent: z.literal('redactions'),
    window: AuditWindowSchema,
  }),
  z.strictObject({
    ...planBase,
    intent: z.literal('model_usage'),
    model_id: z
      .string()
      .regex(/^[A-Za-z0-9._:-]{1,100}$/)
      .nullable(),
    window: AuditWindowSchema,
  }),
]);
export type AuditPlan = z.infer<typeof AuditPlanSchema>;
export type AuditIntent = AuditPlan['intent'];
export const AUDIT_INTENTS = AuditPlanSchema.options.map(
  (o) => o.shape.intent.value,
);

/** Fields of a model-compiled question's broker call; required for compiler `model`. */
export const AuditModelCallSchema = z.strictObject({
  run_id: id,
  envelope_id: id,
  pricing_snapshot_id: id,
  model: ModelRefSchema,
  operation_id: id,
  data_class: DataClassSchema,
});
export const AuditQuestionRequestSchema = z
  .strictObject({
    question: z.string().trim().min(1).max(500),
    tz: TimeZoneSchema.default('UTC'),
    /** `rules` compiles locally; `model` asks a metered model for a plan, then validates it. */
    compiler: z.enum(['rules', 'model']).default('rules'),
    model_call: AuditModelCallSchema.nullable().default(null),
    limit: z.number().int().min(1).max(200).default(50),
  })
  .refine((r) => (r.compiler === 'model') === (r.model_call !== null), {
    message: 'Give model_call exactly when the compiler is model.',
    path: ['model_call'],
  });
export type AuditQuestionRequest = z.infer<typeof AuditQuestionRequestSchema>;
export const AuditCompileResultSchema = z.discriminatedUnion('status', [
  z.strictObject({ status: z.literal('compiled'), plan: AuditPlanSchema }),
  z.strictObject({
    status: z.literal('unsupported'),
    reason: z.string().max(500),
    suggestions: z.array(z.string().max(200)).max(10),
  }),
]);
export type AuditCompileResult = z.infer<typeof AuditCompileResultSchema>;

const cell = z.union([z.string().max(1000), z.number(), z.boolean(), z.null()]);
export const SupportingRecordSchema = z.strictObject({
  type: z.enum([
    'record',
    'link',
    'reservation',
    'usage',
    'decision',
    'event',
    'artifact',
  ]),
  id,
});
export const ResolvedSubjectSchema = z.strictObject({
  ref: z.string().max(220),
  id,
  kind: StoredKindSchema,
  status: StoredStatusSchema,
  /** Null for a redacted record: its title is gone. */
  title: z.string().max(500).nullable(),
});
export const AuditAnswerSchema = z.strictObject({
  question: z.string().max(500),
  compiler: z.enum(['rules', 'model']),
  status: z.enum([
    'answered',
    'unsupported',
    'needs_subject',
    'refused_plan',
    'compile_failed',
  ]),
  explanation: z.string().max(1200),
  plan: AuditPlanSchema.nullable(),
  plan_hash: hash.nullable(),
  /** Always true: plans execute in a read-only transaction with a statement timeout. */
  read_only: z.literal(true),
  fixture: z.boolean(),
  as_of: timestamp,
  subjects: z.array(ResolvedSubjectSchema).max(10),
  /** For an ambiguous or unknown subject: readable records it might mean. */
  candidates: z
    .array(
      z.strictObject({
        id,
        kind: StoredKindSchema,
        title: z.string().max(500),
      }),
    )
    .max(10),
  columns: z.array(z.string().max(60)).max(20),
  rows: z.array(z.record(z.string(), cell)).max(200),
  /** Aggregates computed once per distinct record (shared expenses are not repeated). */
  totals: z.record(z.string(), z.string().max(200)).nullable(),
  supporting: z.array(SupportingRecordSchema).max(1000),
  truncated: z.boolean(),
  notes: z.array(z.string().max(500)).max(20),
  /** The metered compile call, for compiler `model`. */
  compile_call: BrokerCallResultSchema.nullable(),
});
export type AuditAnswer = z.infer<typeof AuditAnswerSchema>;

export const LineageMediaSchema = z.enum([
  'text',
  'unsupported_type',
  'too_large',
  'not_retrieved',
]);
export const LineageNodeSchema = z.strictObject({
  id,
  kind: StoredKindSchema,
  version,
  status: StoredStatusSchema,
  /** Null for a redacted record (a tombstone keeps identity, version and hash only). */
  title: z.string().max(500).nullable(),
  content_hash: hash,
  depth: counter,
  /** Sources only: whether their latest retrieval had text the studio could read. */
  media: LineageMediaSchema.nullable(),
});
export type LineageNode = z.infer<typeof LineageNodeSchema>;
export const LineageEdgeSchema = z.strictObject({
  id,
  relation: z.string().max(40),
  /** Provenance direction: the origin and the record derived from it. */
  origin: id,
  descendant: id,
  from_version: version,
  to_version: version,
  depth: counter.min(1),
});
export type LineageEdge = z.infer<typeof LineageEdgeSchema>;
export const LineageGraphRequestSchema = z.strictObject({
  direction: z.enum(['upstream', 'downstream', 'both']).default('upstream'),
  depth: depth.default(8),
  max_nodes: z.number().int().min(1).max(500).default(200),
});
export const LineageGraphSchema = z.strictObject({
  workspace_id: id,
  fixture: z.boolean(),
  root: id,
  direction: z.enum(['upstream', 'downstream', 'both']),
  depth: depth,
  max_nodes: counter,
  nodes: z.array(LineageNodeSchema).max(500),
  edges: z.array(LineageEdgeSchema).max(2000),
  truncated: z.strictObject({ depth: z.boolean(), nodes: z.boolean() }),
  as_of: timestamp,
});
export type LineageGraph = z.infer<typeof LineageGraphSchema>;
export const LINEAGE_EXPORT_FORMAT = 'creator-lineage/1' as const;
export const LineageExportSchema = z.strictObject({
  format: z.literal(LINEAGE_EXPORT_FORMAT),
  exported_by: id,
  exported_at: timestamp,
  graph: LineageGraphSchema,
  /** SHA-256 of the canonical JSON of `graph`. */
  graph_sha256: hash,
});
export type LineageExport = z.infer<typeof LineageExportSchema>;
export const LineageProblemSchema = z.strictObject({
  code: z.enum([
    'hash_mismatch',
    'workspace_mismatch',
    'missing',
    'version_changed',
    'now_redacted',
    'contains_redacted_text',
    'link_retracted',
    'link_missing',
  ]),
  id: id.nullable(),
  detail: z.string().max(500),
});
export const LineageVerifyResultSchema = z.strictObject({
  ok: z.boolean(),
  hash_ok: z.boolean(),
  checked_nodes: counter,
  checked_edges: counter,
  problems: z.array(LineageProblemSchema).max(1000),
  as_of: timestamp,
});
export type LineageVerifyResult = z.infer<typeof LineageVerifyResultSchema>;

export const RemoveMemberRequestSchema = z.strictObject({
  actor_id: id,
  reason: short,
});
export { SearchQuerySchema as SavedSearchBodySchema };

/** config/search/semantic-models.json: embedding models allowed per workspace mode. */
export const SemanticModelsConfigSchema = z.strictObject({
  version: z.string().max(40),
  fixture: z.array(ModelRefSchema).max(10),
  real: z.array(ModelRefSchema).max(10),
  notes: note,
});
export type SemanticModelsConfig = z.infer<typeof SemanticModelsConfigSchema>;
