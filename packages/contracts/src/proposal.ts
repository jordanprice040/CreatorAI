import { z, id, hash, version, counter } from './primitives.js';

// ADR-0077 (P09): why a response was chosen, and a versioned non-code proposal. The
// explanation is computed by application code from recorded scores, reviews and the
// selection; it is not a model's opinion. A proposal is a document people write and revise; it
// carries no authority, and nothing in it claims real-world execution or efficacy.

const ref = z.strictObject({ id, version });
const short = z.string().trim().min(1).max(300);
/** A title or reason: one line, no control characters, so it cannot forge export lines (L-4). */
const oneLine = short.refine((v) => !/[\p{Cc}\u2028\u2029]/u.test(v), {
  message: 'Use one line without control characters.',
});
const note = z.string().trim().min(1).max(1200);

/** Section order is the export order. References are built from the cited claims, never typed. */
export const PROPOSAL_SECTIONS = [
  'problem_users',
  'background',
  'objectives',
  'evidence',
  'contrary_evidence',
  'methods',
  'materials',
  'roles',
  'timeline',
  'costs',
  'evaluation',
  'ethics_risks',
  'limitations',
  'assumptions',
  'next_tasks',
] as const;
export type ProposalSection = (typeof PROPOSAL_SECTIONS)[number];
export const PROPOSAL_SECTION_LABELS: Record<ProposalSection, string> = {
  problem_users: 'Problem and who it affects',
  background: 'Background',
  objectives: 'Objectives',
  evidence: 'Evidence',
  contrary_evidence: 'Contrary evidence',
  methods: 'Methods and step-by-step procedure',
  materials: 'Materials and resources',
  roles: 'Roles',
  timeline: 'Timeline',
  costs: 'Cost estimates and unknowns',
  evaluation: 'Testing and evaluation criteria',
  ethics_risks: 'Ethics and risks',
  limitations: 'Limitations',
  assumptions: 'Decision-changing assumptions',
  next_tasks: 'Next tasks',
};
/** Sections a proposal is not usable without; they cannot be marked not applicable. */
export const CORE_PROPOSAL_SECTIONS: readonly ProposalSection[] = [
  'problem_users',
  'objectives',
  'evidence',
  'methods',
  'evaluation',
  'ethics_risks',
  'next_tasks',
];
/** Option kinds a proposal may describe: every non-code response, and a hybrid's whole plan. */
export const PROPOSAL_KINDS = [
  'use_existing',
  'change_process',
  'human_led',
  'hybrid',
  'investigate',
] as const;
export const PROPOSAL_SECTION_MAX = 6000;
export const PROPOSAL_MAX_BODY_BYTES = 131072;
/** Distinct claims one proposal may cite; every one gets a reference label (review L-7). */
export const PROPOSAL_MAX_CITED_CLAIMS = 60;

export const ProposalSectionBodySchema = z
  .strictObject({
    /** written: the text is the section. unknown: not known yet (the text says what is missing). */
    state: z.enum(['written', 'unknown', 'not_applicable']),
    text: z.string().trim().max(PROPOSAL_SECTION_MAX),
    claims: z.array(ref).max(20),
  })
  .superRefine((s, ctx) => {
    if (s.state !== 'unknown' && !s.text)
      ctx.addIssue({
        code: 'custom',
        path: ['text'],
        message:
          s.state === 'written'
            ? 'A written section needs its text; mark it unknown if it is not known yet.'
            : 'Say why the section does not apply.',
      });
  });
export type ProposalSectionBody = z.infer<typeof ProposalSectionBodySchema>;

export const ProposalBodySchema = z
  .strictObject({
    format: z.literal('proposal/1'),
    problem: ref,
    alternative: ref,
    response: z.enum(PROPOSAL_KINDS),
    /** The selection that advanced this option, when the proposal was started. */
    selection_id: id,
    summary: note,
    sections: z.strictObject(
      Object.fromEntries(
        PROPOSAL_SECTIONS.map((k) => [k, ProposalSectionBodySchema]),
      ) as Record<ProposalSection, typeof ProposalSectionBodySchema>,
    ),
  })
  .superRefine((b, ctx) => {
    for (const k of CORE_PROPOSAL_SECTIONS)
      if (b.sections[k].state === 'not_applicable')
        ctx.addIssue({
          code: 'custom',
          path: ['sections', k, 'state'],
          message: `${PROPOSAL_SECTION_LABELS[k]} always applies; mark it unknown until it is written.`,
        });
    const cited = new Set(
      Object.values(b.sections).flatMap((s) =>
        s.claims.map((c) => c.id.toLowerCase()),
      ),
    );
    if (cited.size > PROPOSAL_MAX_CITED_CLAIMS)
      ctx.addIssue({
        code: 'custom',
        path: ['sections'],
        message: `Cite at most ${PROPOSAL_MAX_CITED_CLAIMS} different claims in one proposal (${cited.size} cited).`,
      });
  });
export type ProposalBody = z.infer<typeof ProposalBodySchema>;

export const CreateProposalRequestSchema = z.strictObject({
  title: oneLine,
  body: ProposalBodySchema,
});
export const ReviseProposalRequestSchema = z.strictObject({
  expected_version: version,
  title: oneLine,
  body: ProposalBodySchema,
  /** What changed, e.g. "Answered review feedback on costs". */
  reason: oneLine,
});

// ---- Checks (computed on read against the exact version) --------------------------------

export const ProposalCheckSchema = z.strictObject({
  level: z.enum(['blocker', 'warning']),
  code: z.enum([
    'core_unknown',
    'evidence_uncited',
    'claim_missing',
    'claim_inactive',
    'claim_changed',
    'claim_unlinked',
    'contrary_uncited',
    'contrary_supports',
    'problem_changed',
    'option_changed',
    'option_inactive',
    'selection_replaced',
    'section_unknown',
  ]),
  section: z.enum(PROPOSAL_SECTIONS).nullable(),
  message: z.string().max(500),
});
export type ProposalCheck = z.infer<typeof ProposalCheckSchema>;
export const ProposalReferenceSchema = z.strictObject({
  label: z.string().regex(/^R[1-9][0-9]?$/),
  claim: ref,
  statement: z.string().max(2000),
  /** How the claim bears on the problem as linked now: supports, contradicts or not linked. */
  relation: z.enum(['supports', 'contradicts', 'not_linked']),
  status: z.string().max(40),
  sources: z
    .array(
      z.strictObject({
        title: z.string().max(500),
        url: z.string().max(2000),
        stance: z.string().max(40),
        freshness: z.string().max(40),
        quote: z.string().max(1000).nullable(),
      }),
    )
    .max(10),
});
export type ProposalReference = z.infer<typeof ProposalReferenceSchema>;
export const ProposalChecksSchema = z.strictObject({
  /** Every core section is written. */
  complete: z.boolean(),
  /** Complete and no blocker. Says nothing about whether the plan works in practice. */
  ready_for_review: z.boolean(),
  written: counter,
  unknown: counter,
  not_applicable: counter,
  checks: z.array(ProposalCheckSchema).max(200),
  references: z.array(ProposalReferenceSchema).max(PROPOSAL_MAX_CITED_CLAIMS),
});
export type ProposalChecks = z.infer<typeof ProposalChecksSchema>;

// ---- Reviews (feedback bound to one exact version) --------------------------------------

export const ReviewMarkSchema = z.enum(['pass', 'concern', 'not_checked']);
export const ProposalReviewRequestSchema = z.strictObject({
  version,
  content_hash: hash,
  verdict: z.enum(['ready', 'revise']),
  marks: z.strictObject({
    completeness: ReviewMarkSchema,
    citation_fidelity: ReviewMarkSchema,
    feasibility: ReviewMarkSchema,
    access: ReviewMarkSchema,
  }),
  comments: z.string().trim().max(4000),
});
export type ProposalReviewRequest = z.infer<typeof ProposalReviewRequestSchema>;
export const ProposalReviewSchema = ProposalReviewRequestSchema.extend({
  id,
  proposal_id: id,
  reviewer: id,
  reviewer_name: z.string().max(200),
  created_at: z.iso.datetime(),
  /** Computed on read: false once the proposal has a newer version. */
  current: z.boolean(),
  /** Computed on read: the reviewer saved the version reviewed (not an independent review). */
  self_review: z.boolean(),
});
export type ProposalReview = z.infer<typeof ProposalReviewSchema>;

export const ProposalVersionSchema = z.strictObject({
  version,
  title: z.string().max(500),
  content_hash: hash,
  reason: z.string().max(300).nullable(),
  actor_id: id,
  created_at: z.iso.datetime(),
});
export const ProposalSummarySchema = z.strictObject({
  id,
  version,
  status: z.string().max(20),
  title: z.string().max(500),
  response: z.enum(PROPOSAL_KINDS),
  problem: ref,
  alternative: ref,
  updated_at: z.iso.datetime(),
});
export type ProposalSummary = z.infer<typeof ProposalSummarySchema>;
export const ProposalDetailSchema = z.strictObject({
  proposal: z.strictObject({
    id,
    version,
    status: z.string().max(20),
    title: z.string().max(500),
    content_hash: hash,
    body: ProposalBodySchema,
    created_at: z.iso.datetime(),
    updated_at: z.iso.datetime(),
  }),
  /** The version shown (the current one unless an older version was asked for). */
  shown_version: version,
  versions: z.array(ProposalVersionSchema),
  checks: ProposalChecksSchema,
  reviews: z.array(ProposalReviewSchema),
  problem_title: z.string().max(500),
  option_title: z.string().max(500),
});
export type ProposalDetail = z.infer<typeof ProposalDetailSchema>;
/** A draft built from the records; nothing is saved until the person saves it. */
export const ProposalDraftSchema = z.strictObject({
  title: short,
  body: ProposalBodySchema,
  checks: ProposalChecksSchema,
});
export type ProposalDraft = z.infer<typeof ProposalDraftSchema>;
export const SaveProposalFileRequestSchema = z.strictObject({
  version,
  upload_key: id,
});

// ---- Response explanation ---------------------------------------------------------------

const optionRef = z.strictObject({
  id,
  version,
  kind: z.string().max(40),
  title: z.string().max(500),
});
export const CriterionGapSchema = z.strictObject({
  criterion: z.string().max(60),
  label: z.string().max(100),
  /** Mean of the counted cards' ratings, one decimal; null when nobody rated it. */
  rating: z.string().max(5).nullable(),
  leader_rating: z.string().max(5).nullable(),
  top_anchor: z.string().max(300),
});
export const ExplainedOptionSchema = z.strictObject({
  alternative: optionRef,
  software: z.boolean(),
  status: z.enum(['complete', 'incomplete', 'unscored']),
  rank: counter.nullable(),
  score: z.string().max(10).nullable(),
  disposition: z.string().max(40).nullable(),
  reasons: z.array(z.string().max(300)).max(6),
  reverse_if: z.string().max(300).nullable(),
  rationale: z.string().max(2000).nullable(),
});
export const SoftwareAvenueSchema = z.strictObject({
  option: ExplainedOptionSchema,
  behind_on: z.array(CriterionGapSchema).max(12),
  unknown: z.array(CriterionGapSchema).max(12),
  /** Why it cannot be selected for build now (gates, humility, discovery), from the report. */
  blockers: z.array(z.string().max(300)).max(12),
  humility: z
    .strictObject({
      review: ref,
      state: z.string().max(40),
      software_part: z.string().max(1200),
      human_part: z.string().max(1200),
      change_course_trigger: z.string().max(1200),
      disconfirming_test: z.string().max(1200),
      reasons: z.array(z.string().max(300)).max(12),
    })
    .nullable(),
  /** Specific new evidence or conditions that would make this option preferable. */
  would_prefer_if: z.array(z.string().max(600)).max(30),
});
export type SoftwareAvenue = z.infer<typeof SoftwareAvenueSchema>;
export const ResponseExplanationSchema = z.strictObject({
  explanation_version: z.literal('response-explanation/1'),
  problem: z.strictObject({ id, version, title: z.string().max(500) }),
  /** selection: from the current recorded selection; ranking: no selection yet, the leader. */
  basis: z.enum(['selection', 'ranking', 'none']),
  selection: z
    .strictObject({
      id,
      created_at: z.iso.datetime(),
      rationale: z.string().max(1200),
      /** The report the selection was made from differs from today's. */
      report_changed: z.boolean(),
    })
    .nullable(),
  chosen: z.array(ExplainedOptionSchema).max(40),
  /** The chosen response, in words: software, hybrid, existing tool, process, human-led... */
  response: z.string().max(60),
  non_code: z.boolean(),
  summary: z.string().max(1500),
  /** Per suitability criterion, chosen against the software options. */
  criteria: z
    .array(
      z.strictObject({
        criterion: z.string().max(60),
        label: z.string().max(100),
        ratings: z.record(z.string(), z.string().max(5).nullable()),
      }),
    )
    .max(12),
  /** Software and hybrid options not chosen, and what would make each preferable. */
  software_avenues: z.array(SoftwareAvenueSchema).max(40),
  /** Other options not chosen (non-code), briefly. */
  others: z.array(ExplainedOptionSchema).max(40),
  notes: z.array(z.string().max(500)).max(10),
});
export type ResponseExplanation = z.infer<typeof ResponseExplanationSchema>;
