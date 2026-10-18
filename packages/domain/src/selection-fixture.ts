import {
  OPPORTUNITY_RUBRIC,
  SUITABILITY_RUBRIC,
  type HumilityBody,
  type ScorecardBody,
  type SelectRequest,
  type SelectionReport,
  type SpecContent,
} from '@creator/contracts';

// T08 fixture material for the clinic no-show scenario: labeled synthetic reviewers, ratings
// chosen to show ties, disagreement, an incomplete assessment and a suitability ranking where
// a non-software response leads. These are demonstration inputs, not assessments of anything.

type Ref = { id: string; version: number };
type Ratings = Record<string, number | null>;
const OPPORTUNITY: Partial<Record<string, Ratings[]>> = {
  // Two reviewers who disagree on differentiation (58.3 and 54.2; mean 56.3).
  build: [
    {
      urgency: 3,
      benefit: 4,
      software_influence: 4,
      feasibility: 3,
      differentiation: 3,
      evidence_quality: 3,
    },
    {
      urgency: 3,
      benefit: 4,
      software_influence: 4,
      feasibility: 3,
      differentiation: 2,
      evidence_quality: 3,
    },
  ],
  // Differentiation unknown: incomplete, shown with labeled bounds.
  hybrid: [
    {
      urgency: 3,
      benefit: 3,
      software_influence: 3,
      feasibility: 4,
      differentiation: null,
      evidence_quality: 3,
    },
  ],
};
const SUITABILITY: Partial<Record<string, Ratings>> = {
  use_existing: {
    problem_fit: 4,
    expected_outcome: 3,
    feasibility_burden: 5,
    evidence_support: 3,
    maintenance_burden: 4,
    stakeholder_acceptability: 3,
  },
  human_led: {
    problem_fit: 3,
    expected_outcome: 3,
    feasibility_burden: 4,
    evidence_support: 3,
    maintenance_burden: 3,
    stakeholder_acceptability: 4,
  },
  build: {
    problem_fit: 4,
    expected_outcome: 4,
    feasibility_burden: 3,
    evidence_support: 3,
    maintenance_burden: 2,
    stakeholder_acceptability: 3,
  },
  // Ties the software response at 54.2.
  change_process: {
    problem_fit: 3,
    expected_outcome: 2,
    feasibility_burden: 5,
    evidence_support: 2,
    maintenance_burden: 4,
    stakeholder_acceptability: 3,
  },
  hybrid: {
    problem_fit: 4,
    expected_outcome: 4,
    feasibility_burden: 3,
    evidence_support: null,
    maintenance_burden: 3,
    stakeholder_acceptability: 3,
  },
};

const checks = (kind: string): ScorecardBody['checks'] => ({
  target_users:
    'Scheduling staff at three rural outpatient clinics (synthetic).',
  current_workaround: 'Reminder messages and ad hoc same-day phone calls.',
  contrary_evidence:
    'Contested claim that rural first-appointment waits rose (fixture).',
  alternatives_checked: [
    { name: 'Existing scheduling-system reminders', checked_on: '2026-10-18' },
    { name: 'Front-desk confirmation calls', checked_on: '2026-10-18' },
  ],
  measurable_outcome:
    'Share of first-appointment slots left unused each month.',
  validation_plan:
    kind === 'build'
      ? 'Two-week manual flagging from an export before any build.'
      : 'Four-week before/after comparison at one clinic.',
  maintenance:
    kind === 'build'
      ? 'Monthly model refresh and an owner for the export.'
      : 'Named coordinator; no software upkeep.',
});

function card(
  rubric: 'opportunity' | 'suitability',
  subject: Ref,
  kind: string,
  ratings: Ratings,
  reviewer: string,
  evidence: Ref[],
): ScorecardBody {
  const def =
    rubric === 'opportunity' ? OPPORTUNITY_RUBRIC : SUITABILITY_RUBRIC;
  return {
    format: 'scorecard/1',
    rubric,
    rubric_version: def.version,
    subject,
    reviewer: { kind: 'fixture', label: reviewer },
    ratings: Object.fromEntries(
      def.criteria.map((c) => {
        const r = ratings[c.key] ?? null;
        return [
          c.key,
          r === null
            ? {
                rating: null,
                evidence_refs: [],
                rationale: `Unknown: no evidence in the packet bears on ${c.label.toLowerCase()} (fixture).`,
              }
            : {
                rating: r,
                evidence_refs: evidence.slice(0, 2),
                rationale: `Rated ${r} against the anchor "${c.anchors[r >= 4 ? 5 : r <= 2 ? 1 : 3]}" (fixture).`,
              },
        ];
      }),
    ),
    confidence: {
      level: 'medium',
      rationale: 'Synthetic fixture evidence; one contested claim.',
    },
    software_influence:
      rubric === 'suitability'
        ? {
            rating: kind === 'build' ? 4 : kind === 'hybrid' ? 3 : 1,
            note: 'Recorded descriptively; not part of the cross-option total.',
          }
        : null,
    gates: {
      ethics: {
        status: 'clear',
        note: 'Synthetic data only; no patient records are used.',
      },
      access: {
        status: 'clear',
        note: 'Staff-facing; no change to how patients book.',
      },
    },
    checks: checks(kind),
  };
}

/** Scorecards for each candidate: opportunity for software kinds, suitability for all. */
export function fixtureScorecards(
  candidates: readonly { id: string; version: number; kind: string }[],
  evidence: Ref[],
): { title: string; body: ScorecardBody }[] {
  const out: { title: string; body: ScorecardBody }[] = [];
  for (const c of candidates) {
    const subject = { id: c.id, version: c.version };
    (OPPORTUNITY[c.kind] ?? []).forEach((r, i) =>
      out.push({
        title: `Opportunity scorecard ${i + 1} (${c.kind})`,
        body: card(
          'opportunity',
          subject,
          c.kind,
          r,
          `Fixture reviewer ${i === 0 ? 'A' : 'B'}`,
          evidence,
        ),
      }),
    );
    const s = SUITABILITY[c.kind];
    if (s)
      out.push({
        title: `Suitability scorecard (${c.kind})`,
        body: card(
          'suitability',
          subject,
          c.kind,
          s,
          'Fixture reviewer A',
          evidence,
        ),
      });
  }
  return out;
}

/** A passing humility review of the software alternative's exact version. */
export function fixtureHumilityReview(
  subject: Ref,
  evidence: Ref[],
): HumilityBody {
  const cmp = (assessment: string, viable: boolean) => ({
    assessment,
    viable,
    evidence_refs: evidence.slice(0, 2),
  });
  return {
    subject,
    outcome_that_matters: 'Fewer unused first-appointment slots each month.',
    whose_perspective:
      'Clinic scheduling staff and patients waiting for a first visit.',
    evidence: {
      supported: ['No-shows leave first-appointment slots unused (fixture).'],
      inferred: ['Predicted no-show risk can target confirmation calls.'],
      disputed: ['Whether rural waits rose between 2022 and 2025.'],
      unknown: ['Prediction quality on this clinic population.'],
    },
    comparisons: {
      software: cmp(
        'Flags high-risk slots for double-booking; needs history.',
        true,
      ),
      existing_tool: cmp('Reminders exist but do not predict no-shows.', true),
      process_change: cmp(
        'Confirmation calls duplicate existing practice.',
        true,
      ),
      human_led: cmp(
        'A coordinator can own unused slots; does not scale.',
        true,
      ),
      hybrid: cmp(
        'Flags plus coordinator follow-up; most promising later.',
        true,
      ),
      defer_decline: cmp(
        'Waiting leaves slots unused; low cost of a pilot.',
        false,
      ),
    },
    software_part: 'Risk flags from historical no-show data.',
    human_part: 'Staff decide whether to double-book or call.',
    burden_risks: ['Extra phone calls for staff', 'Double-booking crowding'],
    disconfirming_test:
      'Manual flagging for two weeks shows no fewer unused slots.',
    change_course_trigger:
      'Unused slots do not fall by a quarter within the pilot.',
    ethical: {
      status: 'none_identified',
      note: 'Synthetic data; staff keep every booking decision.',
    },
    disposition: 'build',
    rationale:
      'A bounded prototype is cheap to test against the manual baseline (fixture).',
    dissent: [
      'The reminder tool may be enough once configured (fixture reviewer).',
    ],
  };
}

/** The demonstration decision: build the software, recommend the tool, keep the rest's reasons. */
export function fixtureDispositions(
  report: SelectionReport,
): SelectRequest['dispositions'] {
  return report.suitability.candidates.map((c) => {
    const alternative = {
      id: c.alternative.id,
      version: c.alternative.version,
    };
    switch (c.alternative.kind) {
      case 'build':
        return {
          alternative,
          disposition: 'select_for_build' as const,
          reasons: [
            'Gates pass and a two-week manual baseline exists to compare against.',
          ],
          reverse_if: 'The manual flagging pilot shows no fewer unused slots.',
        };
      case 'use_existing':
        return {
          alternative,
          disposition: 'recommend_alternative' as const,
          reasons: [
            'Highest suitability; turn on reminders now regardless of the build.',
          ],
          reverse_if: 'Reminders are already fully configured at every clinic.',
        };
      case 'human_led':
        return {
          alternative,
          disposition: 'defer' as const,
          reasons: ['No coordinator time is available this quarter (fixture).'],
          reverse_if: 'A coordinator is funded.',
        };
      case 'hybrid':
        return {
          alternative,
          disposition: 'research_further' as const,
          reasons: ['Assessment incomplete: evidence support is unknown.'],
          reverse_if: 'Evidence on combined flags and follow-up appears.',
        };
      default:
        return {
          alternative,
          disposition: 'reject' as const,
          reasons: c.gates.discovery
            ? [`Discovery found it ${c.gates.discovery.replaceAll('_', ' ')}.`]
            : ['Lower suitability than the recommended options.'],
          reverse_if: 'It proves distinct from the existing catalog entry.',
        };
    }
  });
}

/** A specification for the selected no-show flagging prototype (synthetic). */
export const FIXTURE_SPEC: SpecContent = {
  audience: 'Scheduling staff at three rural outpatient clinics (synthetic).',
  problem_statement:
    'First-appointment slots go unused when patients do not attend; staff cannot see which slots are at risk.',
  user_flows: [
    {
      key: 'F1',
      name: "Review tomorrow's at-risk slots",
      steps: [
        'Open the daily list',
        'See slots flagged with a risk band',
        'Choose call, double-book or leave',
      ],
    },
    {
      key: 'F2',
      name: 'Record what happened',
      steps: ['Mark attended or no-show', 'See the monthly unused-slot share'],
    },
  ],
  scope: [
    'Import a CSV export of past appointments',
    'Risk bands from historical no-show rates',
    'Daily list and outcome recording',
  ],
  non_goals: [
    'No patient-facing messages',
    'No connection to live scheduling systems',
    'No automatic double-booking',
  ],
  data_contracts: [
    {
      name: 'appointments.csv',
      description:
        'Synthetic export: slot time, clinic, first visit, attended.',
      data_class: 'synthetic',
    },
  ],
  acceptance_checks: [
    {
      key: 'A1',
      flow: null,
      statement: 'A malformed export is rejected with the failing row named.',
      measure: 'Import of the malformed fixture fails with a row number.',
      method: 'automated_test',
    },
    {
      key: 'A2',
      flow: 'F1',
      statement: 'Risk bands match the documented rate calculation.',
      measure: 'Bands for the fixture history equal hand-computed values.',
      method: 'automated_test',
    },
    {
      key: 'A3',
      flow: 'F1',
      statement: 'Staff can act on every flagged slot from the list.',
      measure:
        'Browser check: call, double-book and leave each record a choice.',
      method: 'browser_check',
    },
    {
      key: 'A4',
      flow: 'F2',
      statement:
        'The monthly unused-slot share is shown from recorded outcomes.',
      measure: 'Share equals unused slots divided by first-appointment slots.',
      method: 'automated_test',
    },
  ],
  risks: [
    {
      risk: 'Flags crowd clinics through double-booking',
      mitigation: 'Staff choose; no automatic action.',
    },
  ],
  maintenance: {
    owner: 'Clinic operations lead (synthetic)',
    obligations: [
      'Refresh rates monthly from a new export',
      'Review bands quarterly',
    ],
    review_interval: 'Quarterly',
  },
  tasks: [
    {
      key: 'T1',
      title: 'Import and validate the export',
      role: 'builder',
      file_scope: ['src/import'],
      depends_on: [],
      acceptance: ['A1'],
      deliverable: 'CSV importer with row-level errors',
    },
    {
      key: 'T2',
      title: 'Compute risk bands',
      role: 'builder',
      file_scope: ['src/risk'],
      depends_on: ['T1'],
      acceptance: ['A2'],
      deliverable: 'Rate calculation and bands',
    },
    {
      key: 'T3',
      title: 'Daily list and outcome screens',
      role: 'builder',
      file_scope: ['src/web'],
      depends_on: ['T2'],
      acceptance: ['A3', 'A4'],
      deliverable: 'Two screens',
    },
    {
      key: 'T4',
      title: 'Acceptance tests and browser checks',
      role: 'qa',
      file_scope: ['tests'],
      depends_on: ['T2', 'T3'],
      acceptance: ['A1', 'A2', 'A3', 'A4'],
      deliverable: 'Executed checks bound to the candidate',
    },
  ],
};

/** A revision that changes only the screens task, to show which tasks it invalidates. */
export function fixtureSpecRevision(s: SpecContent): SpecContent {
  return {
    ...s,
    tasks: s.tasks.map((t) =>
      t.key === 'T3'
        ? { ...t, title: 'Daily list, outcome screens and a printable list' }
        : t,
    ),
  };
}
