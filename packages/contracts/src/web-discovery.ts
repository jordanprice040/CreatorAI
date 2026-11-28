import { z, id, hash, version, counter, timestamp } from './primitives.js';
import { EvidenceSiteHostSchema, RetrievalStateSchema } from './research.js';

// P12 online discovery (ADR-0086, amends ADR-0065): "Search the web". The owner's ChatGPT plan
// connection runs the provider's own web search for one request; the studio records every
// search call and source URL apart from the model's text, which stays a draft. The studio's own
// guarded fetcher then fetches the chosen pages under the workspace's evidence-site policy, and
// a second request reads the stored passages and proposes claims. Application code checks each
// quote word for word against the stored passage; only checked claims can be added, by the
// owner or, where the run's routine approval policy covers the evidence stage, by that policy.
// No search or browser API is used, and nothing here spends money.
const short = z.string().trim().min(1).max(300);
const term = z.string().trim().min(1).max(80);

export const WEB_DISCOVERY_POLICY_VERSION = 'web-discovery/1.0' as const;
/**
 * Both requests are research synthesis (finding and reading evidence, the locator's kind of
 * work), admitted only under a qualification bound to the web discovery prompts.
 */
export const WEB_DISCOVERY_TASK_CLASS = 'research_synthesis' as const;

/** What the owner narrows a web discovery with. Every field is optional. */
/**
 * ADR-0140 (review L-2): the most search calls one web search request may make. It is the
 * plan route's own technical bound (`plan-responses.ts` accepts 1 to 10), not a policy cap.
 */
export const MAX_SEARCH_CALLS = 10;
export const WebDiscoveryScopeSchema = z.strictObject({
  /** Interests or fields to lean towards; with none, broad public seeds are used. */
  interests: z.array(term).max(5).default([]),
  target_groups: z.array(term).max(5).default([]),
  /** One evidence-gap question to answer, for example from an earlier exploration. */
  question: short.nullable().default(null),
  /** Topics to leave out: leads and claims mentioning them are dropped. */
  exclusions: z.array(term).max(10).default([]),
  /** Websites the search must not use, and whose pages are never fetched. */
  excluded_hosts: z.array(EvidenceSiteHostSchema).max(20).default([]),
  /** Search calls the one search request may make; one more stops it. */
  max_search_calls: z.number().int().min(1).max(MAX_SEARCH_CALLS).default(3),
  /** Pages the studio may fetch for this discovery (1–15). */
  max_fetches: z.number().int().min(1).max(15).default(8),
  /** Claims the reading request may propose (1–12). */
  max_claims: z.number().int().min(1).max(12).default(8),
});
export type WebDiscoveryScope = z.infer<typeof WebDiscoveryScopeSchema>;

/** Exactly what a discovery with this scope sends to the model and its web search. */
export const WebDiscoveryPreviewSchema = z.strictObject({
  scope: WebDiscoveryScopeSchema,
  /** The search request's instructions and input, verbatim. */
  instructions: z.string(),
  input: z.string(),
  input_hash: hash,
  chars: counter,
  /** Domains the search is told not to use (from excluded websites). */
  blocked_domains: z.array(z.string()),
  /**
   * Pages one run may fetch under this workspace's evidence-site rules; null when no website
   * is approved. Absent when the studio has no fetcher.
   */
  max_fetches_per_run: z.number().int().min(1).nullable().optional(),
  /** False when this studio has live fetching turned off (CREATOR_SOURCE_FETCH=off). */
  fetching_available: z.boolean().optional(),
});
export type WebDiscoveryPreview = z.infer<typeof WebDiscoveryPreviewSchema>;

export const StartWebDiscoveryRequestSchema = z.strictObject({
  connection_id: id,
  model_id: z.string().trim().min(1).max(200),
  scope: WebDiscoveryScopeSchema,
  /** The preview's input hash: what the owner saw is what is sent, or the start is refused. */
  input_hash: hash,
});
export type StartWebDiscoveryRequest = z.infer<
  typeof StartWebDiscoveryRequestSchema
>;

/**
 * PR #173 review 3 L-2 / review 4 N-D: a lone half of a surrogate pair becomes U+FFFD, since
 * PostgreSQL refuses it in stored JSON. Applied to every model-written string that is stored.
 */
const wellFormed = (s: string) =>
  s.replace(
    /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g,
    '\uFFFD',
  );
/** Model text, trimmed, bounded and well formed. */
const modelText = (min: number, max: number) =>
  z.string().trim().min(min).max(max).transform(wellFormed);

/**
 * A model's free text, clipped instead of refused (live check, November 11: one 314-character
 * "why" rejected a whole search answer). The prompt states the limits; this is the backstop.
 */
const clipped = (n: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(4000)
    .transform((s) => {
      // PR #173 review 3 L-2: never end on half of a surrogate pair (an emoji), and replace any
      // lone half the answer already held, or PostgreSQL refuses the stored JSON.
      let out = s;
      if (out.length > n) {
        let cut = n - 1;
        const last = out.charCodeAt(cut - 1);
        if (last >= 0xd800 && last <= 0xdbff) cut -= 1;
        out = `${out.slice(0, cut)}…`;
      }
      return wellFormed(out);
    });

/** What the search request answers: candidate pages, each with why it may hold evidence. */
export const ScoutOutputSchema = z.strictObject({
  summary: clipped(1200),
  leads: z
    .array(
      z.strictObject({
        // Review 5 N-1: a URL the search never listed is stored as the model wrote it.
        url: modelText(1, 2000),
        title: clipped(300),
        why: clipped(300),
        query: clipped(300).nullable(),
      }),
    )
    .max(20),
});
export type ScoutOutput = z.infer<typeof ScoutOutputSchema>;

/** One provider search call as the studio recorded it from the stream. */
export const WebSearchCallSchema = z.strictObject({
  id: z.string().max(200).nullable(),
  status: z.string().max(40).nullable(),
  action: z.string().max(40).nullable(),
  queries: z.array(z.string().max(500)).max(20),
  sources: z.array(z.string().max(4000)).max(100),
});
export type WebSearchCall = z.infer<typeof WebSearchCallSchema>;

/**
 * Where a lead's URL came from. `search_source`: the provider listed it among the pages its
 * search consulted. `model_suggested`: only the model's text named it; it is never fetched.
 */
export const LeadOriginSchema = z.enum(['search_source', 'model_suggested']);
export const LeadDispositionSchema = z.enum([
  'selected',
  'not_from_search',
  'excluded_website',
  'excluded_topic',
  'duplicate',
  'already_in_studio',
  'over_limit',
  'invalid_url',
]);
export type LeadDisposition = z.infer<typeof LeadDispositionSchema>;
/** What a fetched page turned out to be, judged from its stored passages. */
export const PageQualitySchema = z.enum([
  'usable',
  'challenge',
  'empty',
  'low_text',
  'not_fetched',
]);
export type PageQuality = z.infer<typeof PageQualitySchema>;

export const WebLeadSchema = z.strictObject({
  ordinal: counter,
  url: z.string().max(2000),
  /** Normalised for duplicate checks: no fragment, tracking parameters or `www.`. */
  url_key: z.string().max(2000),
  host: z.string().max(260),
  title: z.string().max(300),
  why: z.string().max(300),
  query: z.string().max(300).nullable(),
  origin: LeadOriginSchema,
  disposition: LeadDispositionSchema,
  reason: z.string().max(300).nullable(),
  /** Set once the studio's fetcher tried it. */
  retrieval_id: id.nullable(),
  retrieval_state: RetrievalStateSchema.nullable(),
  source_id: id.nullable(),
  source_version: version.nullable(),
  quality: PageQualitySchema.nullable(),
  quality_note: z.string().max(300).nullable(),
});
export type WebLead = z.infer<typeof WebLeadSchema>;

/** The reading packet: stored passages of the usable pages, nothing else. */
export const ReaderPacketSchema = z.strictObject({
  packet_version: z.literal('web-reader-packet/1'),
  kind: z.literal('untrusted_evidence/1'),
  authority: z.literal('none'),
  focus: z.strictObject({
    interests: z.array(z.string()),
    target_groups: z.array(z.string()),
    question: z.string().nullable(),
  }),
  max_claims: z.number().int().min(1).max(12),
  pages: z
    .array(
      z.strictObject({
        ref: z.string().regex(/^S[1-9][0-9]?$/),
        source_id: id,
        source_version: version,
        title: z.string().max(500),
        url: z.string().max(2000),
        published_at: timestamp.nullable(),
        passages: z
          .array(
            z.strictObject({
              ref: z.string().regex(/^S[1-9][0-9]?\.P[1-9][0-9]{0,2}$/),
              passage_id: id,
              text: z.string().max(2000),
            }),
          )
          .max(200),
      }),
    )
    .max(15),
  /** Passages left out because the packet was full. */
  passages_left_out: counter,
});
export type ReaderPacket = z.infer<typeof ReaderPacketSchema>;

const passageRef = z.string().regex(/^S[1-9][0-9]?\.P[1-9][0-9]{0,2}$/);
export const ReaderOutputSchema = z.strictObject({
  claims: z
    .array(
      z.strictObject({
        title: modelText(1, 200),
        statement: modelText(1, 1200),
        basis: z.enum(['observation', 'inference']),
        uncertainty: modelText(1, 300),
        evidence: z
          .array(
            z.strictObject({
              ref: passageRef,
              stance: z.enum(['supports', 'contradicts']),
              quote: modelText(8, 1000),
            }),
          )
          .min(1)
          .max(6),
      }),
    )
    .max(12),
  not_covered: z.array(modelText(1, 300)).max(8),
});
export type ReaderOutput = z.infer<typeof ReaderOutputSchema>;

/** `verified`: at least one supporting quote was found word for word; only these can be added. */
export const WebProposalCheckSchema = z.enum([
  'verified',
  'unverified',
  'excluded',
  'duplicate',
]);
export type WebProposalCheck = z.infer<typeof WebProposalCheckSchema>;

export const WebClaimProposalSchema = z.strictObject({
  id,
  ordinal: counter,
  title: z.string().max(200),
  statement: z.string().max(1200),
  basis: z.enum(['observation', 'inference']),
  uncertainty: z.string().max(300),
  evidence: z
    .array(
      z.strictObject({
        ref: z.string().max(20),
        stance: z.enum(['supports', 'contradicts']),
        quote: z.string().max(1000),
        /** Resolved by the studio; null when the reference named no packet passage. */
        passage_id: id.nullable(),
        source_id: id.nullable(),
        source_version: version.nullable(),
        url: z.string().max(2000).nullable(),
        /** True when the quote occurs in the stored passage (spaces aside). */
        verified: z.boolean(),
      }),
    )
    .max(6),
  check: WebProposalCheckSchema,
  reasons: z.array(z.string().max(300)).max(10),
  /** Distinct source-origin clusters among verified supporting quotes. */
  supporting_sources: counter,
  contradicting_sources: counter,
  decision: z.enum(['pending', 'admitted', 'dismissed']),
  claim_id: id.nullable(),
  admitted_via: z.enum(['owner', 'routine_policy', 'autopilot']).nullable(),
  decided_by: id.nullable(),
  decided_at: timestamp.nullable(),
  decision_reason: z.string().max(500).nullable(),
});
export type WebClaimProposal = z.infer<typeof WebClaimProposalSchema>;

export const WebDiscoveryStateSchema = z.enum([
  'searching',
  'fetching',
  'reading',
  'done',
  'failed',
  'cancelled',
  'interrupted',
]);
export type WebDiscoveryState = z.infer<typeof WebDiscoveryStateSchema>;
export const WebDiscoveryOutcomeSchema = z.enum([
  'claims_found',
  'no_verified_claims',
  'no_search',
  'no_leads',
  'nothing_fetchable',
]);
export type WebDiscoveryOutcome = z.infer<typeof WebDiscoveryOutcomeSchema>;

export const WebDiscoverySchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  fixture: z.boolean(),
  connection_id: id,
  model_id: z.string().max(200),
  scope: WebDiscoveryScopeSchema,
  input_hash: hash,
  policy_version: z.string().max(40),
  state: WebDiscoveryStateSchema,
  outcome: WebDiscoveryOutcomeSchema.nullable(),
  /** Why it stopped, failed or ended as it did; plain text for the owner. */
  explanation: z.string().max(1200),
  search_request_id: id.nullable(),
  read_request_id: id.nullable(),
  search_calls: z.array(WebSearchCallSchema).max(10),
  /** The search request's own summary: a model draft, never evidence. */
  draft_summary: z.string().max(1200).nullable(),
  leads: z.array(WebLeadSchema).max(20),
  packet_hash: hash.nullable(),
  not_covered: z.array(z.string().max(300)).max(8),
  proposals: z.array(WebClaimProposalSchema).max(12),
  version,
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
  finished_at: timestamp.nullable(),
  /**
   * True while this studio process is working on it. A searching, fetching or reading
   * discovery that is not active was left by a stopped studio and can be resumed.
   */
  active: z.boolean(),
});
export type WebDiscovery = z.infer<typeof WebDiscoverySchema>;

export const WebDiscoverySummarySchema = WebDiscoverySchema.pick({
  id: true,
  run_id: true,
  fixture: true,
  model_id: true,
  state: true,
  outcome: true,
  created_at: true,
  finished_at: true,
}).extend({
  title: z.string().max(300),
  leads: counter,
  fetched: counter,
  proposals: counter,
  admitted: counter,
});
export type WebDiscoverySummary = z.infer<typeof WebDiscoverySummarySchema>;

export const DecideWebClaimsRequestSchema = z.strictObject({
  proposal_ids: z.array(id).min(1).max(12),
  /** Kept with the decision's audit record. */
  reason: z.string().trim().min(1).max(500).optional(),
});
export type DecideWebClaimsRequest = z.infer<
  typeof DecideWebClaimsRequestSchema
>;
