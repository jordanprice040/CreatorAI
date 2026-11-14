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
  // X03: code versions (artifact commits), models used, and resource/cost records.
  'code_version',
  'model',
  'cost',
]);
export type SearchType = z.infer<typeof SearchTypeSchema>;
export const SEARCH_TYPES = SearchTypeSchema.options;
/** An IANA time zone name the runtime knows (checked again by PostgreSQL when used). */
export const TimeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+){0,2}$/)
  .refine((tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
      return true;
    } catch {
      return false;
    }
  }, 'Unknown time zone.');
/** A calendar date, read in the query's time zone. */
export const LocalDateSchema = z.iso.date();
/**
 * P02: the order a list is read in, applied on the server before any limit. Newest and
 * Oldest use when each item was created (a record's first version, an event's time), with
 * the id as a stable tie-break. Relevance ranks word matches and is never applied silently:
 * the result says which order it actually used.
 */
export const SearchSortSchema = z.enum(['newest', 'oldest', 'relevance']);
export type SearchSort = z.infer<typeof SearchSortSchema>;
/** An opaque page cursor; it is bound to the sort, type and filters that produced it. */
export const PageCursorSchema = z
  .string()
  .max(600)
  .regex(/^[A-Za-z0-9_-]+$/);
export const SearchQuerySchema = z
  .strictObject({
    q: z.string().trim().max(200),
    types: z.array(SearchTypeSchema).min(1).max(7),
    kind: StoredKindSchema.nullable(),
    status: StoredStatusSchema.nullable(),
    limit: z.number().int().min(1).max(50),
    /** X03: inclusive local dates, interpreted in `tz`, applied to each hit's time. */
    from: LocalDateSchema.nullable().default(null),
    to: LocalDateSchema.nullable().default(null),
    tz: TimeZoneSchema.default('UTC'),
    /** P02: newest first unless the person picks another order. */
    sort: SearchSortSchema.default('newest'),
    /** P02: the next page of one type; `types` must then name exactly that type. */
    after: PageCursorSchema.nullable().default(null),
  })
  .refine((q) => !q.from || !q.to || q.from <= q.to, {
    message: 'from must not be after to.',
    path: ['to'],
  })
  .refine((q) => q.after === null || q.types.length === 1, {
    message: 'A page cursor continues one type; name only that type.',
    path: ['after'],
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
  /** X03: occurred_at as wall-clock time in the query's zone, with its UTC offset. */
  occurred_local: z.string().max(40),
  /** The record to open for this hit (a passage's source, an event's subject). */
  subject: z.strictObject({ id, kind: z.string().max(40) }).nullable(),
  /** X03: amounts of a cost hit (a model's total for a model hit); null otherwise. */
  amounts: z
    .strictObject({
      reserved: nanoUsd,
      incurred: nanoUsd,
      unknown: nanoUsd,
      /** Fixture amounts are simulated units, never money. */
      fixture: z.boolean(),
    })
    .nullable(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;
/**
 * X03: what each searched type could and could not match, so an empty result is not read as
 * "nothing exists". Redacted records, passages without text and unsupported or oversized
 * media are counted, never shown.
 */
export const SearchCoverageSchema = z.strictObject({
  searchable: counter,
  excluded: z.strictObject({
    redacted: counter,
    no_text: counter,
    unsupported_media: counter,
  }),
  latest_change_at: timestamp.nullable(),
});
export const SearchResultSchema = z.strictObject({
  query: SearchQuerySchema,
  mode: z.enum(['browse', 'id', 'text']),
  fixture: z.boolean(),
  hits: z.array(SearchHitSchema).max(350),
  /** Matches per type before the limit; computed only over what the caller may read. */
  counts: z.partialRecord(SearchTypeSchema, counter),
  truncated: z.boolean(),
  /**
   * P02: the order actually applied. Relevance needs words, so an id search or a browse is
   * read newest first and says so here; types without a word rank are always by time.
   */
  order: SearchSortSchema,
  /** P02: per type, the cursor for its next page; absent when that type has no more. */
  next: z.partialRecord(SearchTypeSchema, PageCursorSchema).default({}),
  coverage: z.partialRecord(SearchTypeSchema, SearchCoverageSchema),
  freshness: z.strictObject({
    /** The database time the search read at. */
    as_of: timestamp,
    /** Audit events not yet in the activity history (activity search lags by these). */
    activity_pending: counter,
  }),
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

/** P02: Library orders. Updated is offered separately from Newest, which is creation time. */
export const LibrarySortSchema = z.enum([
  'newest',
  'oldest',
  'updated',
  'name',
]);
export type LibrarySort = z.infer<typeof LibrarySortSchema>;
export const LibraryPageSchema = z.strictObject({
  entities: z.array(StoredEntitySchema).max(500),
  /** Records matching the filters (counted only for a member, before paging). */
  total: counter,
  sort: LibrarySortSchema,
  /** Pass as `after` with the same sort and filters; null when this is the last page. */
  next: PageCursorSchema.nullable(),
});
export type LibraryPage = z.infer<typeof LibraryPageSchema>;

/**
 * P01: where an activity subject or search hit opens. The server checks the subject is in
 * this workspace and follows it to what a page shows (a task to its workflow, an artifact to
 * its newest code version, a selection to its problem). A subject that is missing, in
 * another workspace or unknown reads the same, `missing`, so nothing private leaks.
 */
export const DestinationSchema = z.strictObject({
  state: z.enum(['available', 'archived', 'redacted', 'missing', 'unchecked']),
  /** What to focus: a page-specific kind (`workflow`, `code_version`, `problem_scores` …). */
  focus: z.strictObject({ kind: z.string().max(40), id }).nullable(),
});
export type Destination = z.infer<typeof DestinationSchema>;

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
  /**
   * UX pass P-2: where the most recent selection sends the main path. `count` is how many
   * active problems have a recorded selection. `latest` is the newest of them: `software` when
   * it selected an option for build, `non_code` when it advanced a non-code option (existing
   * tool, process change, human-led, hybrid, investigate) toward a proposal, `none` when it
   * advanced neither. For `non_code`, `proposal` is the most recently changed active proposal
   * for one of those options (null when none is saved yet).
   */
  selections: z.strictObject({
    count: counter,
    latest: z
      .strictObject({
        id,
        problem_id: id,
        created_at: timestamp,
        route: z.enum(['software', 'non_code', 'none']),
        proposal: z
          .strictObject({
            id,
            version,
            title: z.string().max(500),
            /** Required sections that are not written yet ("Unknown yet"). */
            unknown_core: counter,
            /** The newest review of the current version says ready. */
            reviewed: z.boolean(),
            /** The newest review of the current version asks for changes. */
            revise: z.boolean(),
          })
          .nullable(),
      })
      .nullable(),
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
