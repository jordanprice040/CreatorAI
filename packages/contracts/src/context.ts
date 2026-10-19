import {
  z,
  id,
  hash,
  timestamp,
  counter,
  version,
  nanoUsd,
} from './primitives.js';
import { DataClassSchema } from './oversight.js';
import {
  BrokerCallResultSchema,
  MeteredActionSchema,
  ProviderSchema,
} from './budget.js';
import {
  BenchmarkCheckSchema,
  CostSummarySchema,
  ModelRefSchema,
  RateSchema,
  SavingsClaimSchema,
  TaskClassSchema,
} from './routing.js';

// X02 context selection, caching, compaction and batches. Application code selects what a
// task may see, binds it by hash with provenance, and proves that pinned constraints,
// objections, acceptance criteria and authority survive compaction. Provider prompt caching
// (billed through usage) and result caching (a call that is not made) are kept apart. A cache
// entry is data, never a permission: every hit is admitted again. Batches reserve every
// item's exposure before submission and settle each item on its own.
const short = z.string().trim().min(1).max(200);
const note = z.string().trim().min(1).max(1200);
export const CONTEXT_POLICY_VERSION = 'context/1.0' as const;

// ---- Provider capabilities -------------------------------------------------------------

export const ContextFeatureSchema = z.enum([
  'prompt_caching',
  'batch',
  'provider_compaction',
]);
export type ContextFeature = z.infer<typeof ContextFeatureSchema>;
/**
 * `documented` means the provider publishes the feature; it is not proof this account can use
 * it. In a real workspace only `verified` is usable; in a fixture workspace only `fixture`.
 */
export const CapabilityStateSchema = z.enum([
  'fixture',
  'documented',
  'verified',
  'unsupported',
]);
export const ProviderCapabilitySchema = z
  .strictObject({
    provider: ProviderSchema,
    model_id: short,
    feature: ContextFeatureSchema,
    state: CapabilityStateSchema,
    source_url: z.url({ protocol: /^https$/ }).nullable(),
    retrieved_at: timestamp.nullable(),
    evidence: note,
    /** Batch only: the batch price (its own snapshot), window and item limit. */
    batch: z
      .strictObject({
        pricing_hash: hash,
        completion_window_ms: counter.min(1000).max(7 * 86_400_000),
        max_items: counter.min(1).max(50000),
      })
      .nullable(),
    /** True when the provider's output cannot be read back (e.g. encrypted compaction items). */
    output_opaque: z.boolean(),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if (
      (c.feature === 'batch' && c.state !== 'unsupported') !==
      (c.batch !== null)
    )
      issue(
        'A usable batch capability names its batch price and window, and only then.',
      );
    if (c.state === 'documented' && (!c.source_url || !c.retrieved_at))
      issue(
        'A documented capability needs its official source URL and retrieval time.',
      );
  });
export type ProviderCapability = z.infer<typeof ProviderCapabilitySchema>;
export const CapabilityRegistryBodySchema = z
  .strictObject({
    format: z.literal('context-capabilities/1'),
    capabilities_version: short,
    recorded_on: z.iso.date(),
    fixture: z.boolean(),
    capabilities: z.array(ProviderCapabilitySchema).min(1).max(100),
  })
  .superRefine((r, ctx) => {
    const keys = r.capabilities.map(
      (c) => `${c.provider}/${c.model_id}/${c.feature}`,
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Each provider/model/feature appears once.',
      });
    for (const c of r.capabilities)
      if (
        r.fixture
          ? !['fixture', 'unsupported'].includes(c.state)
          : c.state === 'fixture'
      )
        ctx.addIssue({
          code: 'custom',
          message: `${c.model_id} ${c.feature}: fixture registries hold only fixture or unsupported capabilities, and real ones no fixture capability.`,
        });
  });
export type CapabilityRegistryBody = z.infer<
  typeof CapabilityRegistryBodySchema
>;
export const RegisterCapabilitiesRequestSchema = z.strictObject({
  registry: CapabilityRegistryBodySchema,
  /** Batch pricing bodies the entries refer to by hash; created if missing. */
  pricing: z.array(z.unknown()).max(50),
});
export const CapabilityRegistrySchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  registry_hash: hash,
  body: CapabilityRegistryBodySchema,
  /** pricing_snapshots id for each batch pricing hash. */
  batch_pricing_snapshot_ids: z.record(hash, id),
  created_by: id,
  created_at: timestamp,
});
export type CapabilityRegistry = z.infer<typeof CapabilityRegistrySchema>;

// ---- Incremental index -----------------------------------------------------------------

export const CorpusSchema = z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/);
export const IndexKeySchema = z
  .string()
  .min(1)
  .max(300)
  .regex(
    /^[^\u0000-\u001f]+$/,
    'Index keys cannot contain control characters.',
  );
export const ContextRefSchema = z.strictObject({
  corpus: CorpusSchema,
  key: IndexKeySchema,
});
export type ContextRef = z.infer<typeof ContextRefSchema>;
export const IndexEntryKindSchema = z.enum([
  'code',
  'note',
  'source',
  'record',
]);
export const IndexRequestSchema = z
  .strictObject({
    corpus: CorpusSchema,
    kind: z.enum(['code', 'note', 'source']),
    data_class: DataClassSchema,
    items: z
      .array(
        z.strictObject({
          key: IndexKeySchema,
          locator: z.string().trim().min(1).max(2000).nullable(),
          text: z.string().min(1).max(16000),
        }),
      )
      .max(500),
    /** True: keys absent from `items` are marked removed (a full snapshot of the corpus). */
    complete: z.boolean(),
    /** Explicit removals, for a snapshot sent in several requests (the request size is bounded). */
    removed_keys: z.array(IndexKeySchema).max(5000).default([]),
  })
  .superRefine((r, ctx) => {
    const keys = r.items.map((i) => i.key);
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({ code: 'custom', message: 'Index keys must be unique.' });
    if (r.removed_keys.some((k) => keys.includes(k)))
      ctx.addIssue({
        code: 'custom',
        message: 'A key cannot be both sent and removed.',
      });
  });
export const RecordIndexKindSchema = z.enum([
  'source',
  'claim',
  'problem',
  'idea',
  'alternative',
  'assessment',
  'decision',
  'specification',
]);
export const IndexRecordsRequestSchema = z.strictObject({
  corpus: CorpusSchema,
  data_class: DataClassSchema,
  kinds: z.array(RecordIndexKindSchema).min(1).max(8),
});
export const IndexEntrySchema = z.strictObject({
  corpus: CorpusSchema,
  key: IndexKeySchema,
  kind: IndexEntryKindSchema,
  data_class: DataClassSchema,
  /** Increments each time the content hash changes. */
  version,
  content_hash: hash,
  locator: z.string().max(2000).nullable(),
  record: z.strictObject({ id, version }).nullable(),
  tokens: counter,
  status: z.enum(['current', 'removed']),
  indexed_at: timestamp,
  updated_at: timestamp,
});
export type IndexEntry = z.infer<typeof IndexEntrySchema>;
export const IndexResultSchema = z.strictObject({
  corpus: CorpusSchema,
  added: counter,
  updated: counter,
  unchanged: counter,
  removed: counter,
  current: counter,
});
export type IndexResult = z.infer<typeof IndexResultSchema>;

// ---- Context packs ---------------------------------------------------------------------

/** What must survive compaction verbatim. `authority` is added by the application only. */
export const PinKindSchema = z.enum([
  'constraint',
  'objection',
  'acceptance_criterion',
  'authority',
]);
export type PinKind = z.infer<typeof PinKindSchema>;
const fact = z.string().trim().min(3).max(500);
export const BuildPackRequestSchema = z.strictObject({
  run_id: id,
  task_id: id.nullable(),
  project_id: id.nullable(),
  task_class: TaskClassSchema,
  data_class: DataClassSchema,
  purpose: note,
  query: z.array(z.string().trim().min(2).max(80)).min(1).max(20),
  token_budget: counter.min(64).max(60000),
  /** Every current entry of these corpora is a candidate, ranked by relevance. */
  corpora: z.array(CorpusSchema).max(10),
  /** Explicit candidates, ranked first. */
  include: z.array(ContextRefSchema).max(100),
  pins: z
    .array(
      ContextRefSchema.extend({
        pin: PinKindSchema.exclude(['authority']),
      }),
    )
    .max(50),
  /** Phrases that must appear in the pack, and survive any compaction. */
  required_facts: z.array(fact).max(50),
  handoffs: z.array(id).max(5),
});
export type BuildPackRequest = z.infer<typeof BuildPackRequestSchema>;
const SourceRefSchema = z.strictObject({
  corpus: CorpusSchema,
  key: IndexKeySchema,
  content_hash: hash,
});
export const PackItemSchema = z.strictObject({
  origin: z.enum(['index', 'authority', 'handoff', 'compaction']),
  corpus: CorpusSchema.nullable(),
  key: IndexKeySchema.nullable(),
  kind: z.enum(['code', 'note', 'source', 'record', 'authority', 'summary']),
  data_class: DataClassSchema,
  version: version.nullable(),
  content_hash: hash,
  locator: z.string().max(2000).nullable(),
  record: z.strictObject({ id, version }).nullable(),
  pin: PinKindSchema.nullable(),
  /** Index entries (or a handoff's sources) a derived item was made from. */
  derived_from: z.array(SourceRefSchema).max(200),
  handoff_id: id.nullable(),
  tokens: counter,
  text: z.string().min(1).max(16000),
});
export type PackItem = z.infer<typeof PackItemSchema>;
export const ExclusionReasonSchema = z.enum([
  'token_budget',
  'data_class',
  'removed',
  'not_found',
  'not_relevant',
  'handoff_stale',
]);
export const ContextPackSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  format: z.literal('context-pack/1'),
  policy_version: z.literal(CONTEXT_POLICY_VERSION),
  run_id: id,
  task_id: id.nullable(),
  project_id: id.nullable(),
  task_class: TaskClassSchema,
  data_class: DataClassSchema,
  purpose: note,
  query: z.array(z.string()),
  /** Hash of the item contents in render order: equal content, equal hash. */
  pack_hash: hash,
  /** Hash of the stable prefix (authority and pins), rendered first so providers can cache it. */
  prefix_hash: hash,
  token_budget: counter,
  tokens: counter,
  items: z.array(PackItemSchema),
  excluded: z.array(
    z.strictObject({
      corpus: z.string(),
      key: z.string(),
      reason: ExclusionReasonSchema,
    }),
  ),
  required_facts: z.array(z.string()),
  compacted_from: id.nullable(),
  handoffs: z.array(id),
  created_by: id,
  created_at: timestamp,
});
export type ContextPack = z.infer<typeof ContextPackSchema>;

// ---- Compaction -----------------------------------------------------------------------

export const CompactRequestSchema = z.discriminatedUnion('method', [
  /** Deterministic sentence selection by application code; no model call, no spend. */
  z.strictObject({
    method: z.literal('extractive'),
    token_budget: counter.min(64).max(60000),
  }),
  /** One metered summarization call; its output must pass the same verification. */
  z.strictObject({
    method: z.literal('model'),
    token_budget: counter.min(64).max(60000),
    model: ModelRefSchema.nullable(),
    envelope_id: id,
    pricing_snapshot_id: id,
    logical_operation_id: id,
    timeout_ms: counter.min(100).max(600000),
  }),
  /** Provider-side compaction: capability-checked; refused when its output is unverifiable. */
  z.strictObject({
    method: z.literal('provider'),
    token_budget: counter.min(64).max(60000),
    model: ModelRefSchema,
  }),
]);
export type CompactRequest = z.infer<typeof CompactRequestSchema>;
export const CompactionSchema = z.strictObject({
  id,
  workspace_id: id,
  pack_id: id,
  method: z.enum(['extractive', 'model', 'provider']),
  status: z.enum(['accepted', 'rejected', 'refused']),
  reason_code: short,
  explanation: z.string().max(1200),
  result_pack_id: id.nullable(),
  /** The metered summarization call, whose cost is compaction overhead. */
  operation_id: id.nullable(),
  missing_pins: z.array(z.string()),
  missing_facts: z.array(z.string()),
  tokens_before: counter,
  tokens_after: counter.nullable(),
  created_by: id,
  created_at: timestamp,
});
export type Compaction = z.infer<typeof CompactionSchema>;

// ---- Handoffs -------------------------------------------------------------------------

export const CreateHandoffRequestSchema = z.strictObject({
  pack_id: id,
  summary: z.string().trim().min(1).max(8000),
  from_task_id: id.nullable(),
});
export const HandoffSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  pack_id: id,
  pack_hash: hash,
  from_task_id: id.nullable(),
  summary: z.string(),
  /** Index entries the summary rests on; the handoff is stale once any of them changes. */
  sources: z.array(SourceRefSchema),
  pins: z.array(
    ContextRefSchema.extend({ pin: PinKindSchema.exclude(['authority']) }),
  ),
  required_facts: z.array(z.string()),
  handoff_hash: hash,
  created_by: id,
  created_at: timestamp,
});
export type Handoff = z.infer<typeof HandoffSchema>;

// ---- Result cache and context calls --------------------------------------------------

const message = z.strictObject({
  role: z.enum(['system', 'user', 'assistant']),
  text: z.string().min(1).max(20000),
});
export const CachePolicySchema = z.strictObject({
  /** use: serve a valid entry; refresh: always call and replace; off: never read or store. */
  mode: z.enum(['use', 'refresh', 'off']),
  /** The caller's freshness requirement. */
  max_age_seconds: counter.min(1).max(30 * 86400),
  /** Index entries the answer depends on, besides the pack's own items. */
  deps: z.array(ContextRefSchema).max(100),
});
export const ContextCallRequestSchema = z.strictObject({
  run_id: id,
  envelope_id: id,
  pricing_snapshot_id: id,
  /** Null: the broker's configured model for this workspace kind. */
  model: ModelRefSchema.nullable(),
  pack_id: id.nullable(),
  project_id: id.nullable(),
  action_type: MeteredActionSchema,
  task_id: id.nullable(),
  logical_operation_id: id,
  data_class: DataClassSchema,
  messages: z.array(message).min(1).max(10),
  max_output_tokens: counter.min(1).max(200000),
  output_format: z.enum(['text', 'json']),
  tool: short.nullable(),
  max_attempts: counter.min(1).max(3),
  timeout_ms: counter.min(100).max(600000),
  justification: note,
  cache: CachePolicySchema,
});
export type ContextCallRequest = z.infer<typeof ContextCallRequestSchema>;
export const CacheEntrySchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  cache_key: hash,
  scope: z.strictObject({
    project_id: id.nullable(),
    data_class: DataClassSchema,
    action_type: MeteredActionSchema,
    tool: z.string().nullable(),
  }),
  version: z.strictObject({
    policy_version: z.string(),
    provider: ProviderSchema,
    model_id: z.string(),
    pricing_hash: hash,
    input_hash: hash,
    pack_hash: hash.nullable(),
  }),
  deps: z.array(
    SourceRefSchema.extend({
      record: z.strictObject({ id, version }).nullable(),
    }),
  ),
  source_operation_id: id,
  source_run_id: id,
  status: z.enum(['valid', 'invalidated']),
  invalidated_reason: z.string().nullable(),
  invalidated_at: timestamp.nullable(),
  hits: counter,
  created_at: timestamp,
});
export type CacheEntry = z.infer<typeof CacheEntrySchema>;
export const InvalidateCacheRequestSchema = z.strictObject({ reason: note });
export const ContextCallResultSchema = z.strictObject({
  cache: z.enum(['hit', 'miss', 'refresh', 'off', 'not_stored']),
  cache_entry_id: id.nullable(),
  /** Why an entry was not served (stale dependency, expired...), when one existed. */
  cache_note: z.string().max(400).nullable(),
  status: BrokerCallResultSchema.shape.status,
  reason_code: short,
  explanation: z.string().max(1200),
  output: BrokerCallResultSchema.shape.output,
  /** For a hit: the call that produced the answer, whose recorded cost was avoided. */
  source_operation_id: id.nullable(),
  admission_id: id.nullable(),
  broker: BrokerCallResultSchema.nullable(),
  fixture: z.boolean(),
});
export type ContextCallResult = z.infer<typeof ContextCallResultSchema>;

// ---- Batches --------------------------------------------------------------------------

export const SubmitBatchRequestSchema = z
  .strictObject({
    batch_operation_id: id,
    run_id: id,
    envelope_id: id,
    model: ModelRefSchema,
    /** The batch price snapshot the capability names (never the synchronous price). */
    pricing_snapshot_id: id,
    action_type: z.enum(['model.generate', 'model.summarize']),
    data_class: DataClassSchema,
    items: z
      .array(
        z.strictObject({
          custom_id: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/),
          logical_operation_id: id,
          task_id: id.nullable(),
          input: z.array(message).min(1).max(20),
          max_output_tokens: counter.min(1).max(200000),
          output_format: z.enum(['text', 'json']),
        }),
      )
      .min(1)
      .max(32),
    justification: note,
  })
  .superRefine((b, ctx) => {
    const ids = b.items.map((i) => i.custom_id);
    const ops = b.items.map((i) => i.logical_operation_id.toLowerCase());
    if (new Set(ids).size !== ids.length || new Set(ops).size !== ops.length)
      ctx.addIssue({
        code: 'custom',
        message: 'Batch items need unique custom ids and operation ids.',
      });
  });
export type SubmitBatchRequest = z.infer<typeof SubmitBatchRequestSchema>;
export const BatchStatusSchema = z.enum([
  'refused',
  'submitting',
  'submitted',
  'completed',
  'partial',
  'expired',
  'failed',
  'unknown',
]);
export const BatchItemSchema = z.strictObject({
  custom_id: z.string(),
  logical_operation_id: id,
  reservation_id: id.nullable(),
  status: z.enum(['denied', 'in_flight', 'settled', 'released', 'unknown']),
  reason_code: z.string(),
  late: z.boolean(),
  incurred_nano: nanoUsd.nullable(),
  output: z
    .strictObject({ text: z.string(), json: z.unknown().nullable() })
    .nullable(),
});
export const BatchSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  run_id: id,
  batch_operation_id: id,
  provider: ProviderSchema,
  model_id: z.string(),
  pricing_snapshot_id: id,
  capability_registry_id: id.nullable(),
  status: BatchStatusSchema,
  reason_code: short,
  explanation: z.string().max(1200),
  provider_batch_id: z.string().max(200).nullable(),
  items: z.array(BatchItemSchema),
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
});
export type Batch = z.infer<typeof BatchSchema>;

// ---- Quality and total-cost comparison ----------------------------------------------

export const ContextEvaluationRequestSchema = z
  .strictObject({
    run_id: id,
    envelope_id: id,
    baseline_pack_id: id,
    candidate_pack_id: id,
    model: ModelRefSchema.nullable(),
    pricing_snapshot_id: id,
    cases: z
      .array(
        z.strictObject({
          case_id: z.string().regex(/^[a-z0-9][a-z0-9_-]{0,63}$/),
          question: z.string().trim().min(1).max(2000),
          check: BenchmarkCheckSchema,
        }),
      )
      .min(2)
      .max(50),
    /** Largest allowed drop in accepted rate from the baseline pack. Fixed before results. */
    max_regression: RateSchema,
    max_output_tokens: counter.min(1).max(8000),
    timeout_ms: counter.min(100).max(600000),
    rationale: note,
  })
  .superRefine((r, ctx) => {
    const ids = r.cases.map((c) => c.case_id);
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: 'custom', message: 'Case ids must be unique.' });
  });
export type ContextEvaluationRequest = z.infer<
  typeof ContextEvaluationRequestSchema
>;
export const ContextArmSchema = z.strictObject({
  pack_id: id,
  pack_hash: hash,
  tokens: counter,
  cases: counter,
  accepted: counter,
  accepted_rate: RateSchema.nullable(),
  /** The evaluated calls themselves. */
  calls: CostSummarySchema,
  /** Work spent producing this context (e.g. a compaction call). */
  overhead: CostSummarySchema,
  total: CostSummarySchema,
  cost_per_accepted_nano: nanoUsd.nullable(),
});
export type ContextArm = z.infer<typeof ContextArmSchema>;
/** Savings are never claimed for a context that lost quality. */
export const ContextSavingsClaimSchema = z.enum([
  ...SavingsClaimSchema.options,
  'not_claimed_quality_drop',
]);
export const ContextEvaluationSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  run_id: id,
  manifest_hash: hash,
  request: ContextEvaluationRequestSchema,
  state: z.enum(['pending', 'evaluated']),
  baseline: ContextArmSchema.nullable(),
  candidate: ContextArmSchema.nullable(),
  quality_maintained: z.boolean().nullable(),
  reasons: z.array(z.string()),
  savings_claim: ContextSavingsClaimSchema.nullable(),
  created_by: id,
  created_at: timestamp,
  evaluated_at: timestamp.nullable(),
});
export type ContextEvaluation = z.infer<typeof ContextEvaluationSchema>;

// ---- Usage report ---------------------------------------------------------------------

export const ContextUsageReportSchema = z.strictObject({
  workspace_id: id,
  fixture: z.boolean(),
  run_id: id.nullable(),
  generated_at: timestamp,
  /** Provider-side prefix caching, read from the provider's (or fixture's) usage records. */
  provider_prompt_cache: z.strictObject({
    settled_calls: counter,
    uncached_input_tokens: counter,
    cached_input_tokens: counter,
    cache_write_tokens: counter,
    /** Cached tokens at the input rate minus their cached price, less any write premium. */
    net_saving_nano: z.string().regex(/^-?(0|[1-9][0-9]{0,29})$/),
    basis: z.enum(['provider_usage', 'fixture_simulation', 'none']),
    reservation_ids: z.array(id),
  }),
  /** Application-side reuse: calls that were not made. */
  result_cache: z.strictObject({
    hits: counter,
    refused_hits: counter,
    misses: counter,
    stores: counter,
    invalidations: counter,
    /** Recorded cost of the source calls each hit reused. */
    avoided: CostSummarySchema,
    source_operation_ids: z.array(id),
  }),
  compaction: z.strictObject({
    attempts: counter,
    accepted: counter,
    rejected: counter,
    refused: counter,
    overhead: CostSummarySchema,
    operation_ids: z.array(id),
  }),
  batches: z.strictObject({
    batches: counter,
    items: counter,
    settled: counter,
    late_settled: counter,
    released: counter,
    unknown: counter,
    in_flight: counter,
    denied: counter,
    cost: CostSummarySchema,
  }),
  evaluations: z.strictObject({
    evaluated: counter,
    quality_maintained: counter,
  }),
  savings_claim: z.enum([
    'measured',
    'not_claimed_fixture',
    'not_claimed_unknown_cost',
    'not_claimed_no_data',
  ]),
  notes: z.array(z.string()),
});
export type ContextUsageReport = z.infer<typeof ContextUsageReportSchema>;
