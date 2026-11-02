import { z, id, hash, version, counter } from './primitives.js';
import { ScopePathSchema } from './execution.js';
import { DataClassSchema } from './oversight.js';

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
    }),
  ),
  gates: GateReportSchema,
});
export type RankedCandidate = z.infer<typeof RankedCandidateSchema>;
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
/** Stored `specification` body for T08 specs (the T02 summary form remains valid). */
export const SpecBodySchema = SpecContentSchema.extend({
  format: z.literal('spec/1'),
  alternative: ref,
  selection_id: id,
});
export type SpecBody = z.infer<typeof SpecBodySchema>;
export const CreateSpecRequestSchema = z.strictObject({
  selection_id: id,
  alternative: ref,
  title: short,
  content: SpecContentSchema,
});
export const ReviseSpecRequestSchema = z.strictObject({
  expected_version: version,
  title: short,
  content: SpecContentSchema,
  reason: short,
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
  const other = checks.filter((a) => a.method !== 'automated_test');
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
