import { z, id, hash, version, timestamp } from './primitives.js';
import { ExplorationClaimSchema } from './exploration.js';
import { GateStatusSchema, RubricIdSchema } from './selection.js';
import { PacketTeamSchema } from './team.js';

// P08 automatic assessments (ADR-0074). A system assessor proposes 1–5 ratings with written,
// evidence-linked rationales for every option of one problem on the rubrics that apply; the
// application checks every reference against the packet, writes one scorecard per option and
// rubric with its provenance, and computes totals, ranks and gates itself. A person's edit is a
// new scorecard of their own that names the system card it replaces; the system card is kept.
// Nothing here selects, freezes, builds or grants anything.
const short = z.string().trim().min(1).max(300);
const para = z.string().trim().min(1).max(1200);

export const ASSESSMENT_POLICY_VERSION = 'assessment/1.0' as const;

const optionRef = z.string().regex(/^O[1-8]$/);
const claimRef = z.string().regex(/^C[1-9][0-9]?$/);

/**
 * A claim as the packet holds it: the exploration form plus its link to the problem. ADR-0091:
 * a claim linked to one or more options (claim supports alternative) names them in `options`;
 * absent, it is linked to the problem only.
 */
export const AssessmentClaimSchema = ExplorationClaimSchema.extend({
  relation: z.enum(['supports', 'contradicts']),
  options: z.array(optionRef).min(1).max(8).optional(),
});
export type AssessmentClaim = z.infer<typeof AssessmentClaimSchema>;

export const AssessmentOptionSchema = z.strictObject({
  ref: optionRef,
  alternative_id: id,
  version,
  kind: z.string().max(40),
  title: z.string().max(500),
  rationale: z.string().max(1200),
  tradeoffs: z.array(z.string().max(300)).max(8),
  uncertainty: z.string().max(600),
  /** Suitability for every option; software opportunity only for build and hybrid. */
  rubrics: z.array(RubricIdSchema).min(1).max(2),
});
export type AssessmentOption = z.infer<typeof AssessmentOptionSchema>;

export const PacketRubricSchema = z.strictObject({
  id: RubricIdSchema,
  version: short,
  hash,
  criteria: z
    .array(
      z.strictObject({
        key: z.string().max(60),
        label: z.string().max(100),
        anchors: z.strictObject({
          1: z.string().max(300),
          3: z.string().max(300),
          5: z.string().max(300),
        }),
      }),
    )
    .min(1)
    .max(10),
});

export const AssessmentPacketSchema = z.strictObject({
  packet_version: z.literal('assessment-packet/1'),
  kind: z.literal('untrusted_evidence/1'),
  authority: z.literal('none'),
  problem: z.strictObject({
    id,
    version,
    title: z.string().max(500),
    statement: z.string().max(2000),
    affected_group: z.string().max(500).nullable(),
    outcome_measure: z.string().max(300).nullable(),
  }),
  options: z.array(AssessmentOptionSchema).min(1).max(8),
  claims: z.array(AssessmentClaimSchema).max(30),
  rubrics: z.array(PacketRubricSchema).min(1).max(2),
  /** What the packet left out, so a thin assessment can be read honestly. */
  notes: z.array(z.string().max(300)).max(10),
  /**
   * ADR-0090: what the owner says the team can run, install and do with data. Absent when no
   * team profile has been saved (and on packets built before schema 56).
   */
  team: PacketTeamSchema.optional(),
  assessed_at: timestamp,
});
export type AssessmentPacket = z.infer<typeof AssessmentPacketSchema>;

export const AssessmentTaskContextSchema = z.strictObject({
  context_version: z.literal('assessment-context/1'),
  role_version: short,
  packet_hash: hash,
  /**
   * The option refs this task rates (one batch of the workflow's packet), when the packet is
   * split so each answer fits the route's output cap. Absent: every option in the packet.
   */
  options: z.array(optionRef).min(1).max(8).optional(),
});
export type AssessmentTaskContext = z.infer<typeof AssessmentTaskContextSchema>;

const gate = z.strictObject({ status: GateStatusSchema, note: para });

/** One option on one rubric, as the assessor answers it (untrusted until checked). */
export const AssessorRatingSchema = z.strictObject({
  option: optionRef,
  rubric: RubricIdSchema,
  ratings: z.record(
    z.string().max(60),
    z.strictObject({
      /** 1–5, or null for unknown. Unknown is not a neutral score. */
      rating: z.number().int().min(1).max(5).nullable(),
      claim_refs: z.array(claimRef).max(10),
      rationale: para,
    }),
  ),
  confidence: z.strictObject({
    level: z.enum(['low', 'medium', 'high']),
    rationale: para,
  }),
  /** Suitability only: software influence recorded descriptively, outside the total. */
  software_influence: z
    .strictObject({
      rating: z.number().int().min(1).max(5).nullable(),
      note: para,
    })
    .nullable(),
  gates: z.strictObject({ ethics: gate, access: gate }),
  checks: z.strictObject({
    target_users: short,
    current_workaround: short,
    contrary_evidence: short,
    measurable_outcome: short,
    validation_plan: short,
    maintenance: short,
  }),
  uncertainty: short,
});
export type AssessorRating = z.infer<typeof AssessorRatingSchema>;

export const AssessorOutputSchema = z.strictObject({
  fixture: z.boolean().optional(),
  summary: para,
  assessments: z.array(AssessorRatingSchema).min(1).max(16),
  /** What the assessor could not judge from this packet. */
  not_covered: z.array(short).max(8),
});
export type AssessorOutput = z.infer<typeof AssessorOutputSchema>;

export const AssessmentResultSchema = z.strictObject({
  packet_hash: hash,
  task: z.strictObject({ task_id: id, output_hash: hash }).nullable(),
  summary: z.string().max(1200).nullable(),
  /** The scorecards written, one per option and rubric. */
  scorecards: z.array(
    z.strictObject({
      id,
      version,
      option: optionRef,
      alternative_id: id,
      rubric: RubricIdSchema,
      unknown: z.array(z.string().max(60)),
    }),
  ),
  /** Earlier system scorecards this run replaced (archived, kept in history). */
  replaced: z.array(id),
  not_covered: z.array(z.string().max(300)).max(8),
  notes: z.array(z.string().max(300)).max(10),
});
export type AssessmentResult = z.infer<typeof AssessmentResultSchema>;

/** What an assessment of this problem would send now. */
export const AssessmentPreviewSchema = z.strictObject({
  packet: AssessmentPacketSchema,
  packet_hash: hash,
  /** The packet without its read time: a start compares it. */
  preview_hash: hash,
  /** ADR-0085: the largest request's counted input (role text plus its part of the packet). */
  chars: z.number().int().min(0),
  /** The route's per-request input cap the requests were sized to. */
  limit: z.number().int().min(0),
  /** How many model requests the assessment takes (a few options each). */
  requests: z.number().int().min(1).max(8),
  /** Each request's counted input, in order. Every request reads the same claims. */
  request_chars: z.array(z.number().int().min(0)).min(1).max(8),
  /** Linked claims no request reads because of the input cap. */
  claims_left_out: z.number().int().min(0),
  /** Linked claims past the 30-claim maximum; no cap reads them. */
  claims_over_max: z.number().int().min(0),
  /** The smallest input cap (to a thousand) that reads every claim left out for size, if any. */
  cap_for_all: z.number().int().min(0).nullable(),
  /**
   * ADR-0091: per option, the claims linked to that option itself and how many of them the
   * packet reads. An option with none read is rated on the problem's claims alone, so its
   * ratings are likely to come back unknown and its range wide.
   */
  option_coverage: z
    .array(
      z.strictObject({
        ref: optionRef,
        alternative_id: id,
        linked: z.number().int().min(0),
        read: z.number().int().min(0),
      }),
    )
    .max(8),
  /** Claims the packet reads that are linked to the problem itself (not only to options). */
  problem_claims_read: z.number().int().min(0),
});
export type AssessmentPreview = z.infer<typeof AssessmentPreviewSchema>;
