import { z, id, hash, version, counter, timestamp } from './primitives.js';
import { PacketClaimSchema } from './discovery.js';
import { EvidenceSiteHostSchema } from './research.js';

// C53 theme-free discovery (ADR-0065, old runbook §2.18): "Explore for me". The owner gives no
// theme, only an optional scope. Application code builds a packet from claims already
// recorded in the workspace (as the owner reads them now, inside the scope) plus the catalog;
// one explorer task proposes a short list of problems that each cite packet claims, and
// unevidenced directions worth researching. Application code then decides what counts:
// unknown refs make the answer invalid, a problem with no usable claim is insufficient, a
// near copy of a catalog entry or an earlier pick is a duplicate, and an excluded topic is
// excluded. Nothing here starts discovery, a build, a fetch or any external action.
const short = z.string().trim().min(1).max(300);
const para = z.string().trim().min(1).max(1200);
const term = z.string().trim().min(1).max(80);

/** What the owner may narrow an exploration with. Every field is optional. */
export const ExploreScopeSchema = z
  .strictObject({
    /** Interests or fields to lean towards; not a theme, never required. */
    interests: z.array(term).max(5).default([]),
    target_groups: z.array(term).max(5).default([]),
    /** Topics to leave out: claims and problems mentioning them are dropped. */
    exclusions: z.array(term).max(10).default([]),
    /** When set, only claims with a passage from one of these websites are read. */
    only_hosts: z.array(EvidenceSiteHostSchema).max(20).default([]),
    /** Passages from these websites are ignored; a claim left with none is not read. */
    excluded_hosts: z.array(EvidenceSiteHostSchema).max(20).default([]),
    /** How many problems the explorer may return (1–5). */
    max_candidates: z.number().int().min(1).max(5).default(3),
    /** How many of the newest claims inside the scope go into the packet (1–30). */
    max_claims: z.number().int().min(1).max(30).default(30),
    /** Passages older than this many days count as stale (they are still read). */
    max_age_days: z.number().int().min(1).max(3650).default(180),
    /**
     * Claims the owner chose not to send, from the preview (PR #131 review L-2). Kept on the
     * studio side: the packet's copy of the scope always has this empty (re-review R-L1).
     */
    leave_out: z.array(id).max(200).default([]),
  })
  .superRefine((s, ctx) => {
    const both = s.only_hosts.filter((h) => s.excluded_hosts.includes(h));
    if (both.length)
      ctx.addIssue({
        code: 'custom',
        path: ['excluded_hosts'],
        message: `A website is both required and excluded: ${both.join(', ')}.`,
      });
  });
export type ExploreScope = z.infer<typeof ExploreScopeSchema>;

export const ExplorationClaimSchema = PacketClaimSchema.omit({
  bears_on: true,
});
export type ExplorationClaim = z.infer<typeof ExplorationClaimSchema>;

/** Existing problems, ideas, alternatives and search briefs, for duplicate checks. */
export const ExplorationCatalogEntrySchema = z.strictObject({
  ref: z.string().regex(/^K[1-9][0-9]?$/),
  id,
  kind: z.enum(['problem', 'idea', 'alternative', 'search_brief']),
  version,
  title: z.string().max(500),
  summary: z.string().max(400),
});
export type ExplorationCatalogEntry = z.infer<
  typeof ExplorationCatalogEntrySchema
>;

/** What the packet did not read, so an empty or narrow answer can be read honestly. */
export const NotSearchedSchema = z.strictObject({
  /**
   * Older claims not read because the packet was full: past max_claims, past the packet's
   * character budget, or past the 200 newest claims scanned.
   */
  beyond_limit: counter,
  /** Claims the owner left out in the preview. */
  left_out_by_owner: counter,
  /** Catalog entries not compared because the catalog part of the packet was full. */
  catalog_beyond_limit: counter,
  excluded_by_topic: counter,
  excluded_by_website: counter,
  /** Claims with no passage at all (nothing recorded to read). */
  without_passages: counter,
  notes: z.array(z.string().max(300)).max(10),
});
export type NotSearched = z.infer<typeof NotSearchedSchema>;

export const ExplorationPacketSchema = z.strictObject({
  packet_version: z.literal('exploration-packet/1'),
  kind: z.literal('untrusted_evidence/1'),
  authority: z.literal('none'),
  scope: ExploreScopeSchema,
  claims: z.array(ExplorationClaimSchema).max(30),
  catalog: z.array(ExplorationCatalogEntrySchema).max(40),
  /** Claims whose evidence is current (supported or contested). */
  usable_claims: counter,
  not_searched: NotSearchedSchema,
  assessed_at: timestamp,
});
export type ExplorationPacket = z.infer<typeof ExplorationPacketSchema>;

export const ExplorationTaskContextSchema = z.strictObject({
  context_version: z.literal('exploration-context/1'),
  role_version: short,
  packet_hash: hash,
});
export type ExplorationTaskContext = z.infer<
  typeof ExplorationTaskContextSchema
>;

const claimRef = z.string().regex(/^C[1-9][0-9]?$/);
const catalogRef = z.string().regex(/^K[1-9][0-9]?$/);

/** One evidenced problem card. Application code turns a chosen one into a search brief. */
export const ExplorationCandidateSchema = z
  .strictObject({
    title: z.string().trim().min(1).max(200),
    affected_users: short,
    observable_pain: para,
    /** Why this direction was chosen from the packet. */
    why_chosen: short,
    current_alternatives: z.array(short).max(5),
    outcome_measure: short,
    next_question: short,
    uncertainty: short,
    /** Two different fields whose intersection discovery should examine. */
    fields: z.tuple([short, short]),
    claim_refs: z.array(claimRef).min(1).max(10),
    /** Claims that weigh against this problem; kept, never dropped. */
    contrary_refs: z.array(claimRef).max(10),
    /** A catalog entry it resembles, if the explorer saw one. */
    catalog_ref: catalogRef.nullable(),
  })
  .superRefine((c, ctx) => {
    const sq = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
    if (sq(c.fields[0]) === sq(c.fields[1]))
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Name two different fields.',
      });
  });
export type ExplorationCandidate = z.infer<typeof ExplorationCandidateSchema>;

/** A direction worth researching that the packet cannot yet support. Never a candidate. */
export const ExplorationDirectionSchema = z.strictObject({
  direction: short,
  why: short,
  question: short,
});

export const ExplorerOutputSchema = z.strictObject({
  fixture: z.boolean().optional(),
  summary: para,
  candidates: z.array(ExplorationCandidateSchema).max(5),
  directions: z.array(ExplorationDirectionSchema).max(5),
  /** What the explorer could not assess from this packet. */
  not_covered: z.array(short).max(8),
});
export type ExplorerOutput = z.infer<typeof ExplorerOutputSchema>;

export const ExplorationDispositionSchema = z.enum([
  'candidate',
  'duplicate',
  'insufficient_evidence',
  'excluded',
]);
export type ExplorationDisposition = z.infer<
  typeof ExplorationDispositionSchema
>;

export const ExplorationResultSchema = z.strictObject({
  outcome: z.enum(['candidates', 'no_candidates']),
  packet_hash: hash,
  task: z.strictObject({ task_id: id, output_hash: hash }).nullable(),
  summary: z.string().max(1200).nullable(),
  candidates: z.array(
    z.strictObject({
      /** E1..E5, stable for this exploration. */
      ref: z.string().regex(/^E[1-5]$/),
      title: z.string().max(200),
      /** The explorer's card as it answered (untrusted text). */
      card: ExplorationCandidateSchema,
      disposition: ExplorationDispositionSchema,
      reasons: z.array(z.string().max(500)).max(10),
      duplicate_of: z
        .strictObject({ id, kind: z.string().max(40), similarity: z.number() })
        .nullable(),
      /** The claims it cites, resolved to records, with the packet's status for each. */
      claims: z
        .array(
          z.strictObject({
            ref: claimRef,
            claim_id: id,
            version,
            status: z.string().max(40),
            /** The claim's statement as the packet held it, shortened for display. */
            statement: z.string().max(300),
            contrary: z.boolean(),
          }),
        )
        .max(20),
    }),
  ),
  directions: z.array(ExplorationDirectionSchema).max(5),
  not_covered: z.array(z.string().max(300)).max(8),
  not_searched: NotSearchedSchema,
});
export type ExplorationResult = z.infer<typeof ExplorationResultSchema>;

export const CreateExploredBriefRequestSchema = z.strictObject({
  /** Why the owner picked this one; kept with the brief's audit record. */
  reason: short.default('Chosen from the exploration shortlist.'),
});

/** What an exploration with this scope would send now: the exact packet and its size. */
export const ExplorationPreviewSchema = z.strictObject({
  packet: ExplorationPacketSchema,
  packet_hash: hash,
  /** What was read, without the time it was read: the start compares it (re-review R-N4). */
  preview_hash: hash,
  chars: counter,
  limit: counter,
});
export type ExplorationPreview = z.infer<typeof ExplorationPreviewSchema>;
