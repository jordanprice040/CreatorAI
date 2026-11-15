import { z, id, hash, version, counter } from './primitives.js';
import { ScopePathSchema } from './execution.js';
import { DataClassSchema } from './oversight.js';
import { BrowserCaseSchema, type BuildRecipe } from './web-recipe.js';
import {
  ChecklistItemRefSchema,
  GateKindSchema,
  TeamCapabilityKeySchema,
} from './team.js';

// T08 scoring, selection and frozen specifications (context/SCORING_RUBRIC.md). Ratings are
// ordinal judgments with evidence; arithmetic over them is done in code with exact rationals.
// Nothing here grants authority: selection and freezing are admitted actions (T03).
const short = z.string().trim().min(1).max(300);
const note = z.string().trim().min(1).max(1200);
const ref = z.strictObject({ id, version });

// ---- Rubrics ---------------------------------------------------------------------------

export const RubricIdSchema = z.enum(['opportunity', 'suitability']);
export type RubricId = z.infer<typeof RubricIdSchema>;
export interface RubricCriterion {
  key: string;
  label: string;
  anchors: { 1: string; 3: string; 5: string };
}
export interface RubricDefinition {
  id: RubricId;
  version: string;
  status: 'proposed' | 'frozen';
  criteria: readonly RubricCriterion[];
  /** Relative integer weights; normalized by their sum. Equal until a pilot changes them. */
  weights: Readonly<Record<string, number>>;
}
const equal = (keys: readonly string[]) =>
  Object.fromEntries(keys.map((k) => [k, 1]));

export const OPPORTUNITY_CRITERIA = [
  'urgency',
  'benefit',
  'software_influence',
  'feasibility',
  'differentiation',
  'evidence_quality',
] as const;
export const SUITABILITY_CRITERIA = [
  'problem_fit',
  'expected_outcome',
  'feasibility_burden',
  'evidence_support',
  'maintenance_burden',
  'stakeholder_acceptability',
] as const;

/** Software-opportunity ranking: only for candidates with a software part. */
export const OPPORTUNITY_RUBRIC: RubricDefinition = {
  id: 'opportunity',
  version: 'opportunity-rubric/1.0',
  status: 'proposed',
  criteria: [
    {
      key: 'urgency',
      label: 'Urgency/severity',
      anchors: {
        1: 'Minor or weakly supported inconvenience',
        3: 'Repeated consequential difficulty for an identified group',
        5: 'Strong corroboration of frequent or severe impact within the defined scope',
      },
    },
    {
      key: 'benefit',
      label: 'Potential benefit',
      anchors: {
        1: 'Unclear outcome or marginal plausible improvement',
        3: 'Specific plausible outcome with an assessable measure',
        5: 'Substantial plausible improvement with strong mechanism/evidence and a validation plan',
      },
    },
    {
      key: 'software_influence',
      label: 'Software influence',
      anchors: {
        1: "Main constraint is outside software's control",
        3: 'Software can materially help one part, with dependencies',
        5: 'A clear mechanism directly improves the target outcome and can be measured',
      },
    },
    {
      key: 'feasibility',
      label: 'Feasibility',
      anchors: {
        1: 'Required resources/data/skills unavailable',
        3: 'Bounded prototype possible; important risks remain',
        5: 'Resources and data are accessible and critical feasibility risks have been tested or strongly supported',
      },
    },
    {
      key: 'differentiation',
      label: 'Differentiation',
      anchors: {
        1: 'Existing alternatives address the need similarly',
        3: 'A specific incremental advantage or underserved use case',
        5: 'Clearly supported meaningful difference against the alternatives actually examined',
      },
    },
    {
      key: 'evidence_quality',
      label: 'Evidence quality',
      anchors: {
        1: 'Unsupported assertions or poor sources',
        3: 'Credible relevant evidence with some corroboration/gaps',
        5: 'Multiple independent, directly relevant sources, contrary evidence considered, traceable support',
      },
    },
  ],
  weights: equal(OPPORTUNITY_CRITERIA),
};

/** Cross-option suitability: every response type, software influence excluded from the total. */
export const SUITABILITY_RUBRIC: RubricDefinition = {
  id: 'suitability',
  version: 'suitability-rubric/1.0',
  status: 'proposed',
  criteria: [
    {
      key: 'problem_fit',
      label: 'Problem fit',
      anchors: {
        1: 'Does not address the observed cause',
        3: 'Addresses an important part of the need',
        5: 'Directly addresses the central observed need for the specified users',
      },
    },
    {
      key: 'expected_outcome',
      label: 'Expected outcome',
      anchors: {
        1: 'No credible improvement mechanism',
        3: 'Plausible improvement and measurable criterion',
        5: 'Strongly supported improvement mechanism and a feasible validation path',
      },
    },
    {
      key: 'feasibility_burden',
      label: 'Feasibility/resource burden',
      anchors: {
        1: 'Requires unavailable resources or unjustified effort',
        3: 'Achievable with known gaps and bounded effort',
        5: 'Available resources and a proportionate, well-supported path',
      },
    },
    {
      key: 'evidence_support',
      label: 'Evidence support',
      anchors: {
        1: 'Critical premises unsupported',
        3: 'Relevant support with stated gaps',
        5: 'Independent relevant support and contrary evidence addressed',
      },
    },
    {
      key: 'maintenance_burden',
      label: 'Maintenance burden',
      anchors: {
        1: 'Ongoing obligations cannot be supported',
        3: 'Manageable obligations with a plausible owner',
        5: 'Low/proportionate obligations with an explicit sustainable owner/process',
      },
    },
    {
      key: 'stakeholder_acceptability',
      label: 'Stakeholder acceptability',
      anchors: {
        1: 'Known serious unresolved conflict or exclusion',
        3: 'Relevant stakeholders considered; validation still needed',
        5: 'Strong evidence of contextual fit and affected-user input, with residual limits stated',
      },
    },
  ],
  weights: equal(SUITABILITY_CRITERIA),
};
export const RUBRICS: Record<RubricId, RubricDefinition> = {
  opportunity: OPPORTUNITY_RUBRIC,
  suitability: SUITABILITY_RUBRIC,
};

// ---- Scorecards (one reviewer's ratings of one alternative version) ---------------------

// P08 (ADR-0074): system scorecards carry their provenance; a person's edit names the card.
/** Where a system scorecard came from: every version it was made against. */
export const SystemAssessmentSchema = z.strictObject({
  format: z.literal('system-assessment/1'),
  workflow_id: id,
  task_id: id,
  output_hash: hash,
  packet_hash: hash,
  role_version: short,
  prompt_hash: hash,
  rubric_hash: hash,
  route: z.enum(['fixture', 'api', 'subscription']),
  provider: z.string().max(40).nullable(),
  model_id: z.string().max(200),
  problem: z.strictObject({ id, version }),
  /**
   * Every claim the assessor read, with a hash of its active support rows at that time: a newer
   * claim version, a retraction or new support marks the assessment stale.
   */
  evidence: z
    .array(z.strictObject({ id, version, support_hash: hash }))
    .max(30),
  /**
   * A hash of every claim linked to the problem when the packet was built, including any past
   * the packet's limit: a claim linked or unlinked since then marks the assessment stale.
   */
  linked_hash: hash,
  /**
   * ADR-0090: the team profile version the packet carried (0: none saved), for the record.
   * Absent on assessments before schema 56 (read as 0).
   */
  team_version: z.number().int().min(0).optional(),
  /**
   * A hash of what the model read from the team block ('' for none). The assessment is stale only
   * when the current block hashes differently, so a profile save that changes nothing the model
   * reads (or a re-check that found the same) keeps it current.
   */
  team_hash: z.string().max(64).optional(),
  /** How many capabilities the team block answered (yes or no); the auto-clear rule needs one. */
  team_answers: z.number().int().min(0).max(100).optional(),
  /** ADR-0097: the gate checklist version the packet carried (0: none). Absent before schema 60. */
  checklist_version: z.number().int().min(0).optional(),
  /** A hash of the checklist items the model read ('' for none); a change makes it stale. */
  checklist_hash: z.string().max(64).optional(),
  /** On suitability cards: the assessor's answer to every checklist item, as checked by code. */
  checklist: z
    .record(
      ChecklistItemRefSchema,
      z.strictObject({
        gate: GateKindSchema,
        text: z.string().max(300),
        answer: z.enum(['pass', 'fail', 'unknown']),
        evidence_refs: z.array(z.strictObject({ id, version })).max(10),
        team_refs: z.array(TeamCapabilityKeySchema).max(11),
        note: z.string().max(200),
      }),
    )
    .optional(),
  /** On suitability cards: the team capabilities the assessor says the option needs. */
  access_needs: z.array(TeamCapabilityKeySchema).max(11).optional(),
  uncertainty: short,
});
export type SystemAssessment = z.infer<typeof SystemAssessmentSchema>;

/** A person's edit of a system scorecard: their own card, naming the card it replaces. */
export const ScorecardEditSchema = z.strictObject({
  scorecard: z.strictObject({ id, version }),
  reason: short,
});

/** 1–5 ordinal, or null for unknown. Unknown is not a neutral score. */
export const RatingSchema = z.number().int().min(1).max(5).nullable();
export const CriterionRatingSchema = z
  .strictObject({
    rating: RatingSchema,
    /** Claims or sources the rating rests on, at exact versions. */
    evidence_refs: z.array(ref).max(20),
    rationale: note,
  })
  .superRefine((r, ctx) => {
    if (r.rating !== null && r.evidence_refs.length === 0)
      ctx.addIssue({
        code: 'custom',
        message:
          'A rating needs written evidence; use unknown (null) when there is none.',
      });
  });
export const GateStatusSchema = z.enum(['clear', 'resolved', 'unresolved']);
export const ScorecardBodySchema = z
  .strictObject({
    format: z.literal('scorecard/1'),
    rubric: RubricIdSchema,
    rubric_version: short,
    subject: ref,
    reviewer: z.strictObject({
      kind: z.enum(['human', 'model', 'fixture']),
      label: short,
    }),
    ratings: z.record(z.string(), CriterionRatingSchema),
    /** A categorical judgment with a reason, not a probability. */
    confidence: z.strictObject({
      level: z.enum(['low', 'medium', 'high']),
      rationale: note,
    }),
    /** Suitability only: recorded descriptively, never part of the cross-option total. */
    software_influence: z
      .strictObject({ rating: RatingSchema, note })
      .nullable(),
    /** Ethics and access are gates, separate from the numeric score. */
    gates: z.strictObject({
      ethics: z.strictObject({ status: GateStatusSchema, note }),
      access: z.strictObject({ status: GateStatusSchema, note }),
    }),
    /** Only on system scorecards, written by an assessment workflow (ADR-0074). */
    assessment: SystemAssessmentSchema.optional(),
    /** Only on a person's card that replaces a system scorecard (ADR-0074). */
    edit_of: ScorecardEditSchema.optional(),
    /** The rubric's evidence and selection checks for every assessed candidate. */
    checks: z.strictObject({
      target_users: short,
      current_workaround: short,
      contrary_evidence: short,
      alternatives_checked: z
        .array(
          z.strictObject({
            name: short,
            checked_on: z.iso.date(),
          }),
        )
        .max(20),
      measurable_outcome: short,
      validation_plan: short,
      maintenance: short,
    }),
  })
  .superRefine((s, ctx) => {
    const rubric = RUBRICS[s.rubric];
    if (s.rubric_version !== rubric.version)
      ctx.addIssue({
        code: 'custom',
        path: ['rubric_version'],
        message: `This rubric is at ${rubric.version}.`,
      });
    const keys = rubric.criteria.map((c) => c.key);
    const given = Object.keys(s.ratings);
    if (given.length !== keys.length || !keys.every((k) => given.includes(k)))
      ctx.addIssue({
        code: 'custom',
        path: ['ratings'],
        message: `Rate every criterion (or mark it unknown): ${keys.join(', ')}.`,
      });
    if (s.assessment && s.reviewer.kind === 'human')
      ctx.addIssue({
        code: 'custom',
        path: ['reviewer'],
        message: 'A system assessment is not a person’s scorecard.',
      });
    if (s.edit_of && (s.reviewer.kind !== 'human' || s.assessment))
      ctx.addIssue({
        code: 'custom',
        path: ['edit_of'],
        message:
          'Only a person’s own scorecard can replace a system scorecard.',
      });
    if ((s.rubric === 'suitability') !== (s.software_influence !== null))
      ctx.addIssue({
        code: 'custom',
        path: ['software_influence'],
        message:
          'Suitability scorecards record software influence descriptively; opportunity scorecards rate it as a criterion.',
      });
  });
export type ScorecardBody = z.infer<typeof ScorecardBodySchema>;
export const CreateScorecardRequestSchema = z.strictObject({
  title: short,
  body: z.record(z.string(), z.unknown()),
});
export const ReviseScorecardRequestSchema = z.strictObject({
  expected_version: version,
  title: short,
  body: z.record(z.string(), z.unknown()),
  reason: short,
});

// ---- Ranking report (computed, never stored as truth) ----------------------------------

/** An exact rational score on 0–100; display has at most one decimal. */
export const ExactScoreSchema = z.strictObject({
  numerator: z.string().regex(/^-?[0-9]+$/),
  denominator: z.string().regex(/^[1-9][0-9]*$/),
  display: z.string().regex(/^[0-9]{1,3}\.[0-9]$/),
});
export type ExactScore = z.infer<typeof ExactScoreSchema>;
export const SelectionDispositionSchema = z.enum([
  'select_for_build',
  'proceed_to_validation',
  'recommend_alternative',
  'research_further',
  'defer',
  'reject',
]);
export type SelectionDisposition = z.infer<typeof SelectionDispositionSchema>;
/**
 * Whether an option of this kind can ever take the disposition. A disposition its kind rules
 * out stays blocked whatever reviews or scores say (the domain's kind blocks); the web leaves
 * such choices out of its short summaries (P18 re-review R3-1, N-1).
 */
export function kindAllows(
  kind: string,
  disposition: SelectionDisposition,
): boolean {
  if (disposition === 'select_for_build')
    return ['build', 'hybrid'].includes(kind);
  if (disposition === 'recommend_alternative')
    return ['use_existing', 'change_process', 'human_led', 'hybrid'].includes(
      kind,
    );
  if (disposition === 'proceed_to_validation') return kind !== 'failed';
  return true;
}
export const ADVANCING_DISPOSITIONS: readonly SelectionDisposition[] = [
  'select_for_build',
  'proceed_to_validation',
  'recommend_alternative',
];
export const GateReportSchema = z.strictObject({
  ethics_access: z.enum(['clear', 'unresolved', 'not_assessed']),
  discovery: z.string().max(40).nullable(),
  humility: z.enum([
    'passing',
    'failing',
    'needs_judgment',
    'missing',
    'not_applicable',
  ]),
  /** Why each disposition is blocked for this candidate, when it is. */
  blocked: z.partialRecord(
    SelectionDispositionSchema,
    z.array(z.string().max(300)),
  ),
  /**
   * ADR-0090: each gate on its own: who raised which concern, and the owner's confirmation if
   * one counts. Absent on reports computed before schema 56.
   */
  gate_details: z
    .array(
      z.strictObject({
        gate: GateKindSchema,
        state: z.enum([
          'clear',
          'confirmed',
          'auto_cleared',
          'unresolved',
          'not_assessed',
        ]),
        concerns: z
          .array(
            z.strictObject({
              /** scorecard id@version, as a confirmation names it. */
              scorecard: z.string().max(80),
              by: z.enum(['system', 'person']),
              reviewer: z.string().max(300),
              note: z.string().max(1200),
            }),
          )
          .max(40),
        /** The owner's confirmation, or the owner's auto-clear rule, that clears it. */
        confirmation: z
          .strictObject({
            by: z.enum(['owner', 'rule']),
            /** The confirmation's id; null for the rule. */
            id: id.nullable(),
            /** The rule's version; null for the owner's confirmation. */
            rule_version: z.number().int().min(1).nullable(),
            /** Which rule mode cleared it (team_profile or model); null for the owner. */
            rule_mode: z
              .enum(['team_profile', 'model', 'checklist'])
              .nullable()
              .optional(),
            reason: z.string().max(300),
            created_at: z.string().max(40),
          })
          .nullable(),
        /** Why an earlier confirmation of this gate no longer counts, if one exists. */
        stale_confirmation: z.string().max(300).nullable(),
        /** Whether any current card (an assessment or a person's) looked at this gate. */
        assessed: z.boolean().optional(),
        /** Who clears gates in this workspace now (the owner's gate rule, ADR-0090). */
        rule: z
          .enum(['owner', 'team_profile', 'model', 'checklist'])
          .optional(),
        /**
         * ADR-0097: what the automatic assessments answered on the owner's checklist for this
         * gate, when the current ones answered it: items not passed, and (access) needed
         * capabilities the app could not confirm in the team profile.
         */
        checklist: z
          .strictObject({
            version: z.number().int().min(1),
            items: z.number().int().min(0).max(12),
            failing: z
              .array(
                z.strictObject({
                  item: ChecklistItemRefSchema,
                  text: z.string().max(300),
                  answer: z.enum(['fail', 'unknown', 'missing']),
                  note: z.string().max(200),
                }),
              )
              .max(12),
            needs: z.array(TeamCapabilityKeySchema).max(11),
            needs_missing: z.array(TeamCapabilityKeySchema).max(11),
          })
          .optional(),
      }),
    )
    .max(2)
    .optional(),
});
export const RankedCandidateSchema = z.strictObject({
  alternative: z.strictObject({
    id,
    version,
    kind: z.string().max(40),
    title: z.string().max(500),
  }),
  status: z.enum(['complete', 'incomplete', 'unscored']),
  /** Mean of current complete scorecards' scores; null unless every current one is complete. */
  score: ExactScoreSchema.nullable(),
  /** Labeled interval: unknowns at 1 and 5, and the spread between reviewers. */
  range: z
    .strictObject({ lower: ExactScoreSchema, upper: ExactScoreSchema })
    .nullable(),
  unknown_criteria: z.array(z.string().max(60)),
  rank: counter.min(1).nullable(),
  overlaps_with: z.array(id),
  disagreements: z.array(
    z.strictObject({
      criterion: z.string().max(60),
      ratings: z.array(
        z.strictObject({
          scorecard_id: id,
          reviewer: z.string().max(300),
          rating: RatingSchema,
        }),
      ),
    }),
  ),
  scorecards: z.array(
    z.strictObject({
      id,
      version,
      reviewer: z.string().max(300),
      reviewer_kind: z.string().max(20),
      confidence: z.string().max(10),
      score: ExactScoreSchema.nullable(),
      lower: ExactScoreSchema,
      upper: ExactScoreSchema,
      stale: z.boolean(),
      stale_reason: z.string().max(300).nullable(),
      /** ADR-0074: every reason it is stale (the first is `stale_reason`). */
      stale_reasons: z.array(z.string().max(300)).max(40).optional(),
      /** ADR-0074: written by an automatic assessment, not by a person. */
      system: z.boolean().optional(),
      /** ADR-0074: the person's card that replaces this system card; it is not counted. */
      superseded_by: id.nullable().optional(),
      /** ADR-0074: the system card this person's card replaces. */
      edit_of: id.nullable().optional(),
    }),
  ),
  gates: GateReportSchema,
});
export type RankedCandidate = z.infer<typeof RankedCandidateSchema>;

/**
 * UX pass P-4: whether an option can advance (build, validate or be recommended), and what
 * stands in the way. `now`: some advancing choice is open. `after_gates`: the ethics and access
 * gate is the only block on some advancing choice, so confirming it lets the option advance.
 * `never`: something besides that gate blocks every advancing choice its kind allows, so
 * confirming the gate alone changes nothing; `blocks` says what (the gate's own text left out).
 *
 * The domain puts the gate's reason first in every advancing choice's list whenever the gate is
 * not clear and the option's kind allows that choice (a kind's own block comes only for choices
 * it rules out); the domain tests pin that order.
 */
export function advanceOutlook(
  c: Pick<RankedCandidate, 'alternative' | 'gates'>,
): {
  state: 'now' | 'after_gates' | 'never';
  /** The advancing choices open now (now) or once the gate is confirmed (after_gates). */
  choices: SelectionDisposition[];
  /** For `never`: each other reason, once, with the choices it blocks. */
  blocks: { reason: string; choices: SelectionDisposition[] }[];
} {
  const allowed = ADVANCING_DISPOSITIONS.filter((d) =>
    kindAllows(c.alternative.kind, d),
  );
  const gated = c.gates.ethics_access !== 'clear';
  const rest = (d: SelectionDisposition) => {
    const all = c.gates.blocked[d] ?? [];
    return gated ? all.slice(1) : all;
  };
  const open = allowed.filter((d) => !(c.gates.blocked[d] ?? []).length);
  if (open.length) return { state: 'now', choices: open, blocks: [] };
  const after = gated ? allowed.filter((d) => !rest(d).length) : [];
  if (after.length) return { state: 'after_gates', choices: after, blocks: [] };
  const blocks: { reason: string; choices: SelectionDisposition[] }[] = [];
  // A kind that allows no advancing choice (a failed outcome): say why, from the kind's blocks.
  const why = allowed.length
    ? allowed.map((d) => [d, rest(d)] as const)
    : ADVANCING_DISPOSITIONS.map(
        (d) => [d, (c.gates.blocked[d] ?? []).slice(0, 1)] as const,
      );
  for (const [d, reasons] of why)
    for (const reason of reasons) {
      const b = blocks.find((x) => x.reason === reason);
      if (b) b.choices.push(d);
      else blocks.push({ reason, choices: [d] });
    }
  return { state: 'never', choices: [], blocks };
}
export const SensitivitySchema = z.strictObject({
  shortlist_size: counter,
  baseline: z.array(id),
  scenarios: z.array(
    z.strictObject({
      name: z.string().max(100),
      weights: z.record(z.string(), counter),
      ranking: z.array(z.strictObject({ id, display: z.string() })),
      shortlist: z.array(id),
      shortlist_changed: z.boolean(),
      top_changed: z.boolean(),
    }),
  ),
  stable: z.boolean(),
  note: z.string().max(500),
});
export const RubricRankingSchema = z.strictObject({
  rubric: RubricIdSchema,
  rubric_version: z.string().max(60),
  rubric_hash: hash,
  candidates: z.array(RankedCandidateSchema),
  /** Candidates outside this ranking (e.g. non-software in the opportunity ranking). */
  excluded: z.array(z.strictObject({ id, reason: z.string().max(300) })),
  sensitivity: SensitivitySchema,
});
export type RubricRanking = z.infer<typeof RubricRankingSchema>;
export const SelectionReportSchema = z.strictObject({
  report_version: z.literal('selection-report/1'),
  problem: z.strictObject({ id, version, title: z.string().max(500) }),
  opportunity: RubricRankingSchema,
  suitability: RubricRankingSchema,
  /** Hash of everything above; a selection names the report its author saw. */
  report_hash: hash,
});
export type SelectionReport = z.infer<typeof SelectionReportSchema>;

// ---- Selection -------------------------------------------------------------------------

export const SelectRequestSchema = z.strictObject({
  problem: ref,
  report_hash: hash,
  dispositions: z
    .array(
      z.strictObject({
        alternative: ref,
        disposition: SelectionDispositionSchema,
        reasons: z.array(short).min(1).max(6),
        /** What evidence or change would reverse this disposition. */
        reverse_if: short,
      }),
    )
    .min(1)
    .max(40),
  /** Required when an advanced candidate is outranked by one that is not advanced. */
  override_reason: note.nullable(),
  rationale: note,
  shortlist_size: counter.min(1).max(10).default(3),
  /** Data class of the material the decision covers, matched against grants. */
  data_class: DataClassSchema,
});
export type SelectRequest = z.infer<typeof SelectRequestSchema>;
export const OverrideSchema = z.strictObject({
  alternative: id,
  ranking: RubricIdSchema,
  original_rank: counter.nullable(),
  original_score: z.string().max(10).nullable(),
  outranked_by: z.array(
    z.strictObject({
      id,
      rank: counter.nullable(),
      score: z.string().max(10).nullable(),
    }),
  ),
});
export const SelectionSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  problem: ref,
  report_hash: hash,
  /** The report as computed when the selection was made: original scores and ranks stay. */
  report: SelectionReportSchema,
  dispositions: SelectRequestSchema.shape.dispositions,
  overrides: z.array(OverrideSchema),
  override_reason: note.nullable(),
  rationale: note,
  admission_id: id,
  actor_id: id,
  /** ADR-0092: the autopilot that recorded it (its actor is then the Autopilot agent); null for a person. */
  autopilot_id: id.nullable().optional(),
  created_at: z.iso.datetime(),
  /** Computed on read: a later selection for the problem replaces this one. */
  current: z.boolean(),
});
export type Selection = z.infer<typeof SelectionSchema>;
export const SelectOutcomeSchema = z.strictObject({
  status: z.enum(['recorded', 'needs_human', 'denied', 'deferred']),
  admission: z.strictObject({
    id,
    verdict: z.string().max(20),
    reason_code: z.string().max(80),
    explanation: z.string().max(1200),
    decision_id: id.nullable(),
  }),
  selection: SelectionSchema.nullable(),
});
export type SelectOutcome = z.infer<typeof SelectOutcomeSchema>;

// ---- Specifications --------------------------------------------------------------------

const taskKey = z.string().regex(/^T[1-9][0-9]?$/);
const checkKey = z.string().regex(/^A[1-9][0-9]?$/);
const flowKey = z.string().regex(/^F[1-9][0-9]?$/);
export const SpecContentSchema = z.strictObject({
  audience: short,
  problem_statement: note,
  user_flows: z
    .array(
      z.strictObject({
        key: flowKey,
        name: short,
        steps: z.array(short).min(1).max(12),
      }),
    )
    .min(1)
    .max(10),
  scope: z.array(short).min(1).max(20),
  non_goals: z.array(short).min(1).max(20),
  data_contracts: z
    .array(
      z.strictObject({
        name: short,
        description: short,
        data_class: z.enum(['synthetic', 'public', 'private_approved']),
      }),
    )
    .max(20),
  acceptance_checks: z
    .array(
      z.strictObject({
        key: checkKey,
        flow: flowKey.nullable(),
        statement: short,
        /** What is measured or observed, so the check can be executed later. */
        measure: short,
        method: z.enum([
          'automated_test',
          'browser_check',
          'manual_review',
          'metric',
        ]),
        /**
         * Executable cases for an automated test, frozen with the spec so a build cannot pick
         * its own tests. Held-out cases run in QA but are never shown to builder or reviewer.
         */
        cases: z
          .array(
            z.strictObject({
              args: z.array(z.string().max(500)).max(12),
              stdin: z.string().max(4000),
              stdout: z.string().max(12000),
              exit_code: z.number().int().min(0).max(125),
              held_out: z.boolean(),
            }),
          )
          .min(1)
          .max(10)
          .optional(),
        /**
         * ADR-0078: frozen browser cases for a browser check (static-web/1 recipe). Held-out
         * cases run in QA but are never shown to builder or reviewer.
         */
        browser_cases: z.array(BrowserCaseSchema).min(1).max(10).optional(),
      }),
    )
    .min(1)
    .max(30),
  risks: z.array(z.strictObject({ risk: short, mitigation: short })).max(20),
  maintenance: z.strictObject({
    owner: short,
    obligations: z.array(short).min(1).max(10),
    review_interval: short,
  }),
  tasks: z
    .array(
      z.strictObject({
        key: taskKey,
        title: short,
        role: z.enum(['builder', 'reviewer', 'qa', 'designer', 'owner']),
        /** Paths this task may change; a path also covers everything beneath it. */
        file_scope: z.array(ScopePathSchema).max(20),
        depends_on: z.array(taskKey).max(20),
        acceptance: z.array(checkKey).max(30),
        deliverable: short,
      }),
    )
    .min(1)
    .max(40),
});
export type SpecContent = z.infer<typeof SpecContentSchema>;
/**
 * The spec schema as JSON Schema: every limit, key pattern and case field a drafted spec is read
 * into. spec-cases-v2's fingerprint includes it (review 3 of PR #206), so a change to case
 * limits or held-out fields changes the fingerprint and needs a new spec-cases version.
 */
export function specContentSchemaJson(): unknown {
  return z.toJSONSchema(SpecContentSchema);
}
/**
 * ADR-0107 (B2): how a saved spec version says model drafts went into it. The studio sets it
 * from the draft ids the form sends; the person never types it. `edited` compares the saved
 * content (routine upkeep fields and held-out ticks aside) with the drafted spec; `held_out`
 * says whether the studio's random pick was kept or changed.
 */
export const SpecDraftedMarkSchema = z.strictObject({
  drafts: z
    .array(
      z.strictObject({
        id,
        kind: z.enum(['spec', 'edge_case']),
        model_id: z.string().max(120),
      }),
    )
    .min(1)
    .max(40),
  edited: z.boolean(),
  held_out: z.enum(['studio_pick', 'changed', 'none']),
});
export type SpecDraftedMark = z.infer<typeof SpecDraftedMarkSchema>;
/** Stored `specification` body for T08 specs (the T02 summary form remains valid). */
export const SpecBodySchema = SpecContentSchema.extend({
  format: z.literal('spec/1'),
  alternative: ref,
  selection_id: id,
  drafted: SpecDraftedMarkSchema.optional(),
});
export type SpecBody = z.infer<typeof SpecBodySchema>;
/** ADR-0107: the completed model drafts (a spec, edge cases) whose text the person used. */
const draftIds = z.array(id).max(40).optional();
export const CreateSpecRequestSchema = z.strictObject({
  selection_id: id,
  alternative: ref,
  title: short,
  content: SpecContentSchema,
  draft_ids: draftIds,
});
export const ReviseSpecRequestSchema = z.strictObject({
  expected_version: version,
  title: short,
  content: SpecContentSchema,
  reason: short,
  draft_ids: draftIds,
});
export const FreezeSpecRequestSchema = z.strictObject({
  spec: ref,
  justification: note,
  data_class: DataClassSchema,
});
export const SpecProblemSchema = z.strictObject({
  code: z.enum([
    'cycle',
    'ownership_conflict',
    'unknown_dependency',
    'unknown_check',
    'unknown_flow',
    'uncovered_check',
    'duplicate_key',
  ]),
  detail: z.string().max(500),
});
export type SpecProblem = z.infer<typeof SpecProblemSchema>;
export const SpecTaskStatusSchema = z.strictObject({
  key: z.string().max(4),
  title: z.string().max(300),
  task_hash: hash,
  frozen_hash: hash.nullable(),
  status: z.enum(['frozen', 'changed', 'added', 'unfrozen']),
});
export const SpecFreezeSchema = z.strictObject({
  id,
  workspace_id: id,
  run_id: id,
  spec: ref,
  content_hash: hash,
  selection_id: id,
  task_hashes: z.record(z.string(), hash),
  admission_id: id,
  actor_id: id,
  created_at: z.iso.datetime(),
});
export type SpecFreeze = z.infer<typeof SpecFreezeSchema>;
export const SpecStatusSchema = z.strictObject({
  spec: z.strictObject({
    id,
    version,
    status: z.string().max(20),
    title: z.string().max(500),
    content_hash: hash,
  }),
  problems: z.array(SpecProblemSchema),
  /** True when the current version is the latest frozen version. */
  frozen_current: z.boolean(),
  latest_freeze: SpecFreezeSchema.nullable(),
  tasks: z.array(SpecTaskStatusSchema),
  removed_tasks: z.array(z.string().max(4)),
  /** Why the current version could not be frozen now (selection, gates, validation). */
  blockers: z.array(z.string().max(300)),
});
export type SpecStatus = z.infer<typeof SpecStatusSchema>;
export const FreezeOutcomeSchema = z.strictObject({
  status: z.enum(['frozen', 'needs_human', 'denied', 'deferred']),
  admission: SelectOutcomeSchema.shape.admission,
  freeze: SpecFreezeSchema.nullable(),
});
export type FreezeOutcome = z.infer<typeof FreezeOutcomeSchema>;

/** The most executable cases one build runs (the build plan's limit). */
export const MAX_BUILD_CASES = 10;
const METHOD_NAMES: Record<string, string> = {
  automated_test: 'automated test',
  browser_check: 'browser check',
  manual_review: 'manual review',
  metric: 'metric',
};
type BuildDataClass = 'synthetic' | 'public' | 'private_approved';
const DATA_RANK: Record<BuildDataClass, number> = {
  synthetic: 0,
  public: 1,
  private_approved: 2,
};
const DATA_NAMES: Record<BuildDataClass, string> = {
  synthetic: 'synthetic',
  public: 'public',
  private_approved: 'approved private',
};
/**
 * The lowest build data class that covers every frozen data contract of a spec (the build
 * refuses a lower one). Synthetic when the spec declares no contracts.
 */
export function contractDataClass(s: SpecContent): BuildDataClass {
  return s.data_contracts.reduce<BuildDataClass>(
    (top, c) => (DATA_RANK[c.data_class] > DATA_RANK[top] ? c.data_class : top),
    'synthetic',
  );
}
/** A data class in words, e.g. "approved private" for `private_approved`. */
export function dataClassName(c: string): string {
  return DATA_NAMES[c as BuildDataClass] ?? c;
}
/**
 * Why a plan connection would refuse a build of this data class, in words; null when its settings
 * allow it. The plan-role preflight refuses the same, but only after the build is recorded.
 */
export function connectionDataBlocker(
  allowed: readonly BuildDataClass[],
  dataClass: BuildDataClass,
  connectionLabel: string,
): string | null {
  if (allowed.includes(dataClass)) return null;
  return `The plan connection "${connectionLabel}" doesn't allow ${DATA_NAMES[dataClass]} data, and this build is classified for it. Allow ${DATA_NAMES[dataClass]} data under Models and connections › Change caps or allowed work, then accept the changed caps, or choose another builder.`;
}
const listed = (keys: readonly string[]) =>
  keys.length === 1
    ? keys[0]!
    : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]!}`;
/**
 * Why the studio's reviewed builder cannot build this task of a spec, in words for people; empty
 * when it can. The build itself enforces the same rules: this only explains them before Start.
 */
/**
 * ADR-0078: the reviewed recipe a task builds with. Every check browser → static-web/1; every
 * check an automated test → python-build/1; anything else has no recipe (buildBlockers says why).
 */
export function taskRecipe(
  s: SpecContent,
  taskKey: string,
): BuildRecipe | null {
  const task = s.tasks.find((t) => t.key === taskKey);
  if (!task) return null;
  const checks = s.acceptance_checks.filter((a) =>
    task.acceptance.includes(a.key),
  );
  if (!checks.length) return null;
  if (checks.every((a) => a.method === 'browser_check' && a.browser_cases))
    return 'static-web/1';
  if (checks.every((a) => a.method === 'automated_test' && a.cases))
    return 'python-build/1';
  return null;
}
/**
 * ADR-0078: the recipe a product made from this spec builds with. Its buildable tasks must agree;
 * a spec with none keeps python-build/1 (buildBlockers then says what is missing).
 */
export function specRecipe(s: SpecContent): BuildRecipe | 'mixed' {
  const found = new Set(
    s.tasks
      .filter((t) => t.role === 'builder')
      .map((t) => taskRecipe(s, t.key))
      .filter((r): r is BuildRecipe => r !== null),
  );
  if (found.size > 1) return 'mixed';
  return [...found][0] ?? 'python-build/1';
}
export function buildBlockers(
  s: SpecContent,
  taskKey: string,
  /** The class the build would be sent with, when known: it must cover every data contract. */
  dataClass?: BuildDataClass,
): string[] {
  const fix =
    'Revise the spec under Build, freeze the new version under Scores and specs, then create a product from it.';
  const out: string[] = [];
  const task = s.tasks.find((t) => t.key === taskKey);
  if (!task) return [`Task ${taskKey} is not in this spec version.`];
  const above = dataClass
    ? s.data_contracts.filter(
        (c) => DATA_RANK[c.data_class] > DATA_RANK[dataClass],
      )
    : [];
  const data = above.length
    ? `The spec's data ${above.length === 1 ? 'contract' : 'contracts'} ${listed(above.map((c) => `"${c.name}" (${DATA_NAMES[c.data_class]})`))} ${above.length === 1 ? 'is' : 'are'} above the ${DATA_NAMES[dataClass!]} data this build is classified for. ${dataClass === 'synthetic' ? 'A fixture workspace builds only with synthetic data: mark the contract synthetic, or build it in a real workspace.' : `Classify the build for ${DATA_NAMES[contractDataClass(s)]} data (the plan's data_class "${contractDataClass(s)}"); the Build page does this itself.`}`
    : null;
  if (task.role !== 'builder' || task.depends_on.length)
    return [
      `Task ${taskKey} can't be built here: the studio builds only builder tasks that depend on no other task.`,
    ];
  if (data) out.push(data);
  const checks = s.acceptance_checks.filter((a) =>
    task.acceptance.includes(a.key),
  );
  if (!checks.length)
    return [
      ...out,
      `Task ${taskKey} delivers no acceptance checks, so there is nothing to test the build against. Give it at least one automated-test check with test cases. ${fix}`,
    ];
  // ADR-0078: a task whose every check is a browser check builds with the static-web/1
  // recipe; otherwise the Python rules below apply, as before.
  if (checks.every((a) => a.method === 'browser_check')) {
    const empty = checks.filter((a) => !a.browser_cases?.length);
    if (empty.length)
      out.push(
        `${empty.length === 1 ? 'Check' : 'Checks'} ${listed(empty.map((a) => a.key))} of task ${taskKey} ${empty.length === 1 ? 'has' : 'have'} no browser cases. A web build needs at least one browser case (a page and its steps) for each browser check.`,
      );
    const cases = checks.flatMap((a) => a.browser_cases ?? []);
    if (cases.length > MAX_BUILD_CASES)
      out.push(
        `Task ${taskKey} has ${cases.length} browser cases across its checks, and a build runs at most ${MAX_BUILD_CASES}. Remove cases, or move a check to another task.`,
      );
    if (!empty.length && !cases.some((c) => c.held_out))
      out.push(
        `None of task ${taskKey}'s browser cases is held out. Mark at least one case held out, so QA checks something the builder never saw.`,
      );
    if (!task.file_scope.some((p) => p === 'site' || p.startsWith('site/')))
      out.push(
        `Task ${taskKey} may not change anything under site/, where a web build's pages live. Add site (or a path under it) to the task's file scope.`,
      );
    if (out.length) out.push(fix);
    return out;
  }
  const browser = checks.filter(
    (a) => a.method === 'browser_check' && a.browser_cases?.length,
  );
  if (browser.length)
    out.push(
      `Task ${taskKey} mixes browser checks (${listed(browser.map((a) => a.key))}) with other checks. A task builds either a command-line program (automated tests) or a static web page (browser checks), not both; split it into two tasks.`,
    );
  const other = checks.filter(
    (a) =>
      a.method !== 'automated_test' &&
      !(a.method === 'browser_check' && a.browser_cases?.length),
  );
  if (other.length)
    out.push(
      `${other.length === 1 ? 'Check' : 'Checks'} ${listed(other.map((a) => `${a.key} (${METHOD_NAMES[a.method] ?? a.method})`))} of task ${taskKey} ${other.length === 1 ? 'is not an automated test' : 'are not automated tests'}. The studio builds a task only when every check it delivers is an automated test with test cases; change the method or take the check off the task.`,
    );
  const empty = checks.filter(
    (a) => a.method === 'automated_test' && !a.cases?.length,
  );
  if (empty.length)
    out.push(
      `${empty.length === 1 ? 'Check' : 'Checks'} ${listed(empty.map((a) => a.key))} of task ${taskKey} ${empty.length === 1 ? 'has' : 'have'} no test cases. A build needs at least one test case for each automated-test check: use "Add a case" under the check in the spec form.`,
    );
  const cases = checks.flatMap((a) => a.cases ?? []);
  if (cases.length > MAX_BUILD_CASES)
    out.push(
      `Task ${taskKey} has ${cases.length} test cases across its checks, and a build runs at most ${MAX_BUILD_CASES}. Remove cases, or move a check to another task.`,
    );
  if (!other.length && !empty.length && !cases.some((c) => c.held_out))
    out.push(
      `None of task ${taskKey}'s test cases is held out. Tick "Held out (only QA sees this case)" on at least one case, so QA checks something the builder never saw.`,
    );
  if (out.length) out.push(fix);
  return out;
}
