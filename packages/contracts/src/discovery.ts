import { z, id, hash, version, counter, timestamp } from './primitives.js';

// T07 locator and competing responses. A search brief bounds the question; an evidence packet
// built by application code from T06 claim evidence is the only material every role sees;
// proposals start from the same packet and never from each other's answers. Model output is
// validated here and checked against the packet before it counts.
const short = z.string().trim().min(1).max(300);
const para = z.string().trim().min(1).max(1200);

/** The National Academy of Engineering Grand Challenges: optional seeds, never the theme itself. */
export const NAE_GRAND_CHALLENGES = [
  'Make solar energy economical',
  'Provide energy from fusion',
  'Develop carbon sequestration methods',
  'Manage the nitrogen cycle',
  'Provide access to clean water',
  'Restore and improve urban infrastructure',
  'Advance health informatics',
  'Engineer better medicines',
  'Reverse-engineer the brain',
  'Prevent nuclear terror',
  'Secure cyberspace',
  'Enhance virtual reality',
  'Advance personalized learning',
  'Engineer the tools of scientific discovery',
] as const;
export const NaeSeedSchema = z.enum(NAE_GRAND_CHALLENGES);
const squash = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();

/**
 * The locator's search brief, stored as a versioned `search_brief` record. A seed may inspire
 * the theme but cannot stand in for it, and the problem must name what would be measured.
 */
export const SearchBriefBodySchema = z
  .strictObject({
    theme: short,
    /** Two fields whose intersection the locator should examine for a transferable mechanism. */
    fields: z.tuple([short, short]),
    target_users: short,
    /** Geography or setting, where it matters. */
    context: short.nullable(),
    measurable_problem: para,
    /** What would be measured to tell whether the problem improved. */
    outcome_measure: short,
    data_and_tools: z.array(short).max(10),
    time_limit: short,
    budget_limit: short,
    nae_seed: NaeSeedSchema.nullable(),
    constraints: z.array(short).max(10),
  })
  .superRefine((b, ctx) => {
    if (squash(b.fields[0]) === squash(b.fields[1]))
      ctx.addIssue({
        code: 'custom',
        path: ['fields'],
        message: 'Name two different fields.',
      });
    if (b.nae_seed && squash(b.theme) === squash(b.nae_seed))
      ctx.addIssue({
        code: 'custom',
        path: ['theme'],
        message:
          'A Grand Challenge is a seed, not a theme: narrow it to a specific setting or group.',
      });
  });
export type SearchBriefBody = z.infer<typeof SearchBriefBodySchema>;

/** What an evidence claim bears on in the brief. One claim may bear on several. */
export const EvidenceRoleSchema = z.enum([
  'problem',
  'affected_users',
  'urgency',
  'workaround',
  'existing_tool',
  'tool_gap',
  'data',
  'mechanism',
]);
export type EvidenceRole = z.infer<typeof EvidenceRoleSchema>;

/** Response types a designer may be assigned. Each maps to a catalog outcome. */
export const ResponseTypeSchema = z.enum([
  'software',
  'existing_tool',
  'process_change',
  'human_led',
  'hybrid',
]);
export type ResponseType = z.infer<typeof ResponseTypeSchema>;
export const RESPONSE_OUTCOME = {
  software: 'build',
  existing_tool: 'use_existing',
  process_change: 'change_process',
  human_led: 'human_led',
  hybrid: 'hybrid',
} as const satisfies Record<ResponseType, string>;

const claimRef = z.string().regex(/^C[1-9][0-9]?$/);
const catalogRef = z.string().regex(/^K[1-9][0-9]?$/);
const proposalRef = z.string().regex(/^P[1-5]$/);
const refs = z.array(claimRef).max(30);

// ---- Evidence packet (built by application code, bound by hash) ------------------------

const EvidenceStatus = z.enum([
  'supported',
  'contested',
  'contradicted',
  'inferred',
  'needs_recheck',
  'inaccessible',
  'insufficient',
]);
export const PacketClaimSchema = z.strictObject({
  ref: claimRef,
  claim_id: id,
  version,
  statement: z.string().max(2000),
  basis: z.enum(['observation', 'inference']).nullable(),
  bears_on: z.array(EvidenceRoleSchema).min(1),
  status: EvidenceStatus,
  labels: z.array(z.string().max(500)).max(20),
  independent_origins: counter,
  contrary_origins: counter,
  /** Verified quotes only (T06 checks each against the stored passage). Untrusted text. */
  passages: z
    .array(
      z.strictObject({
        source: z.string().max(80),
        url: z.string().max(2000),
        stance: z.enum([
          'supports',
          'contradicts',
          'does_not_support',
          'inaccessible',
        ]),
        support_type: z.string().max(40).nullable(),
        freshness: z.string().max(40),
        quote: z.string().max(400).nullable(),
      }),
    )
    .max(4),
});
export type PacketClaim = z.infer<typeof PacketClaimSchema>;
export const CatalogEntrySchema = z.strictObject({
  ref: catalogRef,
  id,
  kind: z.enum(['problem', 'idea', 'alternative']),
  version,
  title: z.string().max(500),
  summary: z.string().max(400),
});
export type CatalogEntry = z.infer<typeof CatalogEntrySchema>;
export const SufficiencySchema = z.strictObject({
  verdict: z.enum(['sufficient', 'insufficient']),
  /** Best evidence status per role that the packet covers; absent roles have none. */
  by_role: z.partialRecord(EvidenceRoleSchema, EvidenceStatus),
  reasons: z.array(z.string().max(500)).max(20),
});
export type Sufficiency = z.infer<typeof SufficiencySchema>;
export const EvidencePacketSchema = z.strictObject({
  packet_version: z.literal('discovery-packet/1'),
  kind: z.literal('untrusted_evidence/1'),
  authority: z.literal('none'),
  brief: z.strictObject({
    id,
    version,
    content_hash: hash,
    title: z.string().max(500),
    body: SearchBriefBodySchema,
  }),
  claims: z.array(PacketClaimSchema).min(1).max(30),
  catalog: z.array(CatalogEntrySchema).max(40),
  /** Older catalog entries left out so the packet fits one model message. */
  catalog_beyond_limit: counter.optional(),
  sufficiency: SufficiencySchema,
  max_age_days: counter,
  assessed_at: timestamp,
});
export type EvidencePacket = z.infer<typeof EvidencePacketSchema>;

// ---- Task context ----------------------------------------------------------------------

export const DiscoveryTaskKindSchema = z.enum([
  'locate',
  'propose',
  'skeptic',
  'revise',
]);
export type DiscoveryTaskKind = z.infer<typeof DiscoveryTaskKindSchema>;
/**
 * What one discovery task may see, by hash. The worker renders model input from this context,
 * the packet (verified against `packet_hash`) and the listed inputs (verified by output hash)
 * and nothing else, so a first proposal whose inputs name only the locator cannot have seen a
 * sibling's answer.
 */
export const DiscoveryTaskContextSchema = z.strictObject({
  context_version: z.literal('discovery-context/1'),
  role_version: short,
  packet_hash: hash,
  perspective: ResponseTypeSchema.nullable(),
  /** P1..P5 for propose/revise tasks; null for the locator and skeptic. */
  proposal: proposalRef.nullable(),
  round: counter.max(2),
  inputs: z
    .array(
      z.strictObject({
        task_id: id,
        output_hash: hash,
        kind: DiscoveryTaskKindSchema,
        label: z.string().max(40),
      }),
    )
    .max(8),
  /** Skeptic only: catalog entries that application code found similar to a proposal. */
  catalog_matches: z
    .array(
      z.strictObject({
        proposal: proposalRef,
        catalog: catalogRef,
        similarity: z.number().min(0).max(1),
      }),
    )
    .max(40),
});
export type DiscoveryTaskContext = z.infer<typeof DiscoveryTaskContextSchema>;

// ---- Role outputs ----------------------------------------------------------------------

export const LocatorOutputSchema = z
  .strictObject({
    fixture: z.boolean().optional(),
    problem_statement: para,
    affected_users: short,
    observable_problem: short,
    urgency: z.strictObject({
      frequency: short,
      severity: z.enum(['low', 'medium', 'high', 'unknown']),
      claim_refs: refs,
    }),
    workarounds: z
      .array(z.strictObject({ description: short, claim_refs: refs }))
      .max(8),
    alternatives: z
      .array(z.strictObject({ description: short, claim_refs: refs }))
      .max(8),
    software_hypothesis: z
      .strictObject({
        hypothesis: para,
        measurable_outcome: short,
        claim_refs: refs,
      })
      .nullable(),
    /**
     * Cross-field reasoning names a mechanism that transfers from one field to the other and
     * why it should; naming the two fields is not enough.
     */
    cross_field: z
      .strictObject({
        from_field: short,
        to_field: short,
        transferred_mechanism: z.string().trim().min(30).max(800),
        why_it_transfers: z.string().trim().min(30).max(800),
        claim_refs: refs.min(1),
      })
      .nullable(),
    cross_field_absent_reason: short.nullable(),
    evidence_strength: z.enum([
      'well_supported',
      'exploratory',
      'insufficient',
    ]),
    gaps: z.array(short).max(8),
  })
  .superRefine((o, ctx) => {
    if ((o.cross_field === null) === (o.cross_field_absent_reason === null))
      ctx.addIssue({
        code: 'custom',
        message:
          'Give either a cross-field mechanism or the reason none was found.',
      });
  });
export type LocatorOutput = z.infer<typeof LocatorOutputSchema>;

export const ProposalOutputSchema = z.strictObject({
  fixture: z.boolean().optional(),
  perspective: ResponseTypeSchema,
  title: z.string().trim().min(1).max(200),
  mechanism: para,
  intended_users: short,
  smallest_version: para,
  measurable_outcome: short,
  feasibility: para,
  maintenance: short,
  software_warranted: z.strictObject({
    verdict: z.enum(['yes', 'no', 'unclear']),
    reason: para,
  }),
  recommendation: z.enum(['recommend', 'consider', 'not_recommended']),
  claim_refs: refs,
  assumptions: z
    .array(z.strictObject({ statement: short, would_change: short }))
    .max(6),
  novelty: short.nullable(),
  /** Revisions only: how the revision answers the skeptic's findings. */
  response_to_findings: para.nullable().default(null),
});
export type ProposalOutput = z.infer<typeof ProposalOutputSchema>;

export const FindingTypeSchema = z.enum([
  'counterevidence',
  'duplicate',
  'infeasible_assumption',
  'novelty_overclaim',
  'weak_evidence',
  'cheaper_test',
  'other',
]);
export const SkepticOutputSchema = z.strictObject({
  fixture: z.boolean().optional(),
  summary: para,
  reviews: z
    .array(
      z.strictObject({
        proposal: proposalRef,
        verdict: z.enum(['stands', 'revise', 'reject']),
        findings: z
          .array(
            z.strictObject({
              type: FindingTypeSchema,
              detail: para,
              claim_refs: refs,
              catalog_ref: catalogRef.nullable(),
            }),
          )
          .max(8),
        cheaper_test: short.nullable(),
      }),
    )
    .min(1)
    .max(5),
});
export type SkepticOutput = z.infer<typeof SkepticOutputSchema>;

// ---- Result ----------------------------------------------------------------------------

export const ProposalDispositionSchema = z.enum([
  'candidate',
  'duplicate',
  'rejected',
  'insufficient_evidence',
  'not_recommended',
  'unreviewed',
  'failed',
]);
export type ProposalDisposition = z.infer<typeof ProposalDispositionSchema>;
export const DiscoveryResultSchema = z.strictObject({
  outcome: z.enum(['candidates', 'no_candidates', 'insufficient_evidence']),
  packet_hash: hash,
  sufficiency: SufficiencySchema,
  locator: z
    .strictObject({
      task_id: id,
      output_hash: hash,
      mechanism_support: z.enum(['supported', 'unsupported', 'none']),
    })
    .nullable(),
  /** Response types the owner left out, with the reason given at start. */
  excluded: z.array(
    z.strictObject({ perspective: ResponseTypeSchema, reason: short }),
  ),
  proposals: z.array(
    z.strictObject({
      proposal: proposalRef,
      perspective: ResponseTypeSchema,
      task_id: id.nullable(),
      output_hash: hash.nullable(),
      revisions: counter,
      title: z.string().max(200).nullable(),
      recommendation: z
        .enum(['recommend', 'consider', 'not_recommended'])
        .nullable(),
      verdict: z.enum(['stands', 'revise', 'reject']).nullable(),
      disposition: ProposalDispositionSchema,
      reasons: z.array(z.string().max(500)).max(10),
      duplicate_of: z
        .strictObject({ id, kind: z.string().max(40), similarity: z.number() })
        .nullable(),
      /** Skeptic findings kept with the proposal, including dissent that was not resolved. */
      dissent: z.array(z.string().max(1200)).max(16),
    }),
  ),
  /**
   * Evidence that first proposals were independent: every round-0 proposal context shares the
   * packet and lists only the locator as input.
   */
  independence: z.strictObject({
    verified: z.boolean(),
    packet_hash: hash,
    shared_inputs: z.array(id),
    proposal_contexts: z.array(
      z.strictObject({ task_id: id, context_hash: hash }),
    ),
    problems: z.array(z.string().max(300)),
  }),
  revision_rounds: counter,
  skeptic_passes: counter,
  /** Catalog records written when the run finished: the problem and one alternative each. */
  catalog_records: z.strictObject({
    problem: z.strictObject({ id, version }).nullable(),
    alternatives: z.array(
      z.strictObject({ proposal: proposalRef, id, version }),
    ),
  }),
});
export type DiscoveryResult = z.infer<typeof DiscoveryResultSchema>;
