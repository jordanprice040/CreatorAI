import { z, id, version, counter, timestamp, nanoUsd } from './primitives.js';
import {
  HistoryEntrySchema,
  StoredEntitySchema,
  StoredKindSchema,
  StoredStatusSchema,
  WorkspaceSchema,
} from './storage.js';
import { ClaimEvidenceSchema } from './research.js';

// T09 catalog reads: search, activity, a workspace overview and a problem comparison. Every
// read checks workspace membership before it touches content, so no snippet or count is
// computed for a caller who cannot see the workspace.

export const SearchTypeSchema = z.enum([
  'record',
  'passage',
  'decision',
  'activity',
]);
export type SearchType = z.infer<typeof SearchTypeSchema>;
export const SEARCH_TYPES = SearchTypeSchema.options;
export const SearchQuerySchema = z.strictObject({
  q: z.string().trim().max(200),
  types: z.array(SearchTypeSchema).min(1).max(4),
  kind: StoredKindSchema.nullable(),
  status: StoredStatusSchema.nullable(),
  limit: z.number().int().min(1).max(50),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;
/** Highlighted text as segments, so a page never renders stored text as markup. */
export const SnippetSchema = z
  .array(z.strictObject({ text: z.string().max(600), match: z.boolean() }))
  .max(40);
export type Snippet = z.infer<typeof SnippetSchema>;
export const SearchHitSchema = z.strictObject({
  type: SearchTypeSchema,
  id,
  /** How it matched: the full id, an id prefix (8+ hex), stored text, or the title. */
  match: z.enum(['id', 'id_prefix', 'text']),
  /** Record kind, `passage`, decision kind, or audit action. */
  kind: z.string().max(60),
  title: z.string().max(500),
  status: z.string().max(40),
  version: version.nullable(),
  snippet: SnippetSchema,
  occurred_at: timestamp,
  /** The record to open for this hit (a passage's source, an event's subject). */
  subject: z.strictObject({ id, kind: z.string().max(40) }).nullable(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;
export const SearchResultSchema = z.strictObject({
  query: SearchQuerySchema,
  mode: z.enum(['browse', 'id', 'text']),
  fixture: z.boolean(),
  hits: z.array(SearchHitSchema).max(200),
  /** Matches per type before the limit; computed only over what the caller may read. */
  counts: z.partialRecord(SearchTypeSchema, counter),
  truncated: z.boolean(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const ActorSummarySchema = z.strictObject({
  id,
  kind: z.enum(['human', 'agent', 'system']),
  display_name: z.string().max(200),
});
export type ActorSummary = z.infer<typeof ActorSummarySchema>;
export const ActivityEntrySchema = HistoryEntrySchema.extend({
  actor: ActorSummarySchema,
});
export type ActivityEntry = z.infer<typeof ActivityEntrySchema>;
export const ActivityPageSchema = z.strictObject({
  entries: z.array(ActivityEntrySchema).max(200),
  /** Pass as `before` for the next older page; null when there is none. */
  next_before: z
    .string()
    .regex(/^[1-9][0-9]*$/)
    .nullable(),
});
export type ActivityPage = z.infer<typeof ActivityPageSchema>;

const WorkflowAttentionSchema = z.strictObject({
  workflow_id: id,
  run_id: id,
  role: z.string().max(40),
  state: z.string().max(40),
  reason: z.string().max(300),
  updated_at: timestamp,
});
export const OverviewSchema = z.strictObject({
  workspace: WorkspaceSchema,
  records: z.array(
    z.strictObject({
      kind: StoredKindSchema,
      active: counter,
      archived: counter,
      redacted: counter,
    }),
  ),
  runs: z.strictObject({ active: counter, cancelled: counter }),
  decisions: z.strictObject({ pending: counter, expiring_24h: counter }),
  workflows: z.partialRecord(z.string().max(40), counter),
  /** Workflows that are waiting, paused, reconciling or failed, newest first. */
  attention: z.array(WorkflowAttentionSchema).max(20),
  budget: z.strictObject({
    envelopes: counter,
    /** Sum of top-level caps; child budgets are carved out of these. */
    cap: nanoUsd,
    incurred: nanoUsd,
    reserved: nanoUsd,
    unknown: nanoUsd,
    denied_calls: counter,
  }),
  products: z.array(
    z.strictObject({
      id,
      version,
      title: z.string().max(500),
      stage: z.string().max(40),
    }),
  ),
  sources: z.strictObject({
    count: counter,
    last_fetched_at: timestamp.nullable(),
  }),
  generated_at: timestamp,
});
export type Overview = z.infer<typeof OverviewSchema>;

/** One problem with its alternatives and the evidence behind it, for side-by-side reading. */
export const ProblemComparisonSchema = z.strictObject({
  problem: StoredEntitySchema,
  brief: StoredEntitySchema.nullable(),
  claims: z.array(
    z.strictObject({
      relation: z.string().max(40),
      evidence: ClaimEvidenceSchema,
    }),
  ),
  alternatives: z.array(
    z.strictObject({
      entity: StoredEntitySchema,
      humility_review: StoredEntitySchema.nullable(),
      scorecards: counter,
    }),
  ),
  /** The discovery workflow that wrote the problem, and its run, when one did. */
  workflow_id: id.nullable(),
  run_id: id.nullable(),
  /** Assumptions recorded for that run (by run id or a part_of link). */
  assumptions: z.array(StoredEntitySchema),
  max_age_days: counter,
});
export type ProblemComparison = z.infer<typeof ProblemComparisonSchema>;
