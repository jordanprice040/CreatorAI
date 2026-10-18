import type {
  EvidenceRole,
  ResponseType,
  SearchBriefBody,
  SupportType,
} from '@creator/contracts';

// Synthetic discovery scenarios for fixture runs and tests (T07). Every page lives on a
// reserved `.fixture.test` host and every figure is invented; none of this is evidence about
// the real world. Each scenario exercises one acceptance case end to end.

export interface FixturePage {
  url: string;
  title: string;
  paragraphs: string[];
}
export interface ScenarioClaim {
  statement: string;
  bears_on: EvidenceRole[];
  /** How the claim's evidence is recorded through the T06 claim-support path. */
  support:
    | {
        evidence: 'passage';
        url: string;
        needle: string;
        stance: 'supports' | 'contradicts' | 'does_not_support';
        support_type: SupportType;
        quote: string | null;
      }[]
    | { evidence: 'inaccessible_source'; url: string }[];
}
export interface DiscoveryScenario {
  key: 'software' | 'existing_tool' | 'insufficient';
  title: string;
  brief: SearchBriefBody;
  claims: ScenarioClaim[];
  /** Catalog records that exist before the run (the known duplicate lives here). */
  catalog: { kind: 'idea'; title: string; summary: string }[];
  perspectives: ResponseType[];
  excluded: { perspective: ResponseType; reason: string }[];
  /** URLs to fetch through the source broker before recording support. */
  fetch: string[];
}

const p = (url: string, title: string, paragraphs: string[]): FixturePage => ({
  url,
  title,
  paragraphs,
});
export const DISCOVERY_PAGES: FixturePage[] = [
  p(
    'https://health.fixture.test/reports/no-shows-2025',
    'Missed first appointments at rural clinics, 2025',
    [
      'Missed first appointments at rural clinics (synthetic fixture).',
      'Rural clinics recorded a 23 percent no-show rate for first appointments in 2025.',
      'Each missed first appointment left a slot unused that could have gone to a patient on the waiting list.',
    ],
  ),
  p(
    'https://health.fixture.test/guides/scheduling-exports',
    'Exporting appointment histories',
    [
      'Guide to scheduling exports (synthetic fixture).',
      'All clinics in the region use scheduling systems that export appointment histories, including attendance, as CSV files.',
    ],
  ),
  p(
    'https://journal.fixture.test/articles/scheduling-systems-review',
    'A review of clinic scheduling systems',
    [
      'Review of three clinic scheduling systems (synthetic fixture).',
      'All three systems send automated text reminders before appointments.',
      'None of the three systems predicts which booked patients are likely to miss their appointment.',
    ],
  ),
  p(
    'https://journal.fixture.test/articles/overbooking-transfer',
    'From airline seats to clinic slots',
    [
      'Applying overbooking to outpatient slots (synthetic fixture).',
      'Airlines set overbooking levels from historical no-show rates so that seats expected to go empty are sold again.',
      'A pilot at two outpatient clinics used the same calculation to double-book slots with a high predicted no-show probability and cut unused slots by a third.',
    ],
  ),
  p(
    'https://news.fixture.test/2026/04/clinic-reminder-calls',
    'How front desks keep slots filled',
    [
      'Clinic front desks (synthetic fixture).',
      'Front-desk staff phone patients the day before appointments to confirm attendance.',
      'Staff said the calls take about an hour each afternoon.',
    ],
  ),
  p(
    'https://community.fixture.test/foodbank/volunteer-survey',
    'Food bank volunteer coordination survey',
    [
      'Volunteer coordination survey (synthetic fixture).',
      'Volunteer coordinators at the food bank reported that 30 percent of Saturday shifts were understaffed in 2025.',
      'Coordinators currently fill gaps by texting regular volunteers on Friday evenings.',
    ],
  ),
  p(
    'https://reviews.fixture.test/volunteer-signup-services',
    'Volunteer sign-up services compared',
    [
      'Comparison of free volunteer sign-up services (synthetic fixture).',
      'Free volunteer sign-up services already let coordinators publish shifts, collect sign-ups and send automatic reminders.',
      'Coordinators who switched reported fewer unfilled shifts within two months.',
    ],
  ),
];

const passage = (
  url: string,
  needle: string,
  quote: string,
  support_type: SupportType = 'observation',
  stance: 'supports' | 'contradicts' = 'supports',
) => ({
  evidence: 'passage' as const,
  url,
  needle,
  stance,
  support_type,
  quote,
});

const WAITS_REPORT = 'https://health.fixture.test/reports/clinic-access-2025';
const SURVEY = 'https://journal.fixture.test/articles/wait-time-survey';
const NO_SHOWS = DISCOVERY_PAGES[0]!.url;
const EXPORTS = DISCOVERY_PAGES[1]!.url;
const SYSTEMS = DISCOVERY_PAGES[2]!.url;
const OVERBOOKING = DISCOVERY_PAGES[3]!.url;
const CALLS = DISCOVERY_PAGES[4]!.url;
const FOODBANK = DISCOVERY_PAGES[5]!.url;
const SIGNUP = DISCOVERY_PAGES[6]!.url;
const PAYWALLED = 'https://journal.fixture.test/articles/paywalled-study';

export const DISCOVERY_SCENARIOS: DiscoveryScenario[] = [
  {
    key: 'software',
    title: 'Unused first-appointment slots at rural clinics',
    brief: {
      theme: 'Unused first-appointment slots at rural clinics',
      fields: ['airline revenue management', 'primary care scheduling'],
      target_users: 'Front-desk staff and clinic managers at rural clinics',
      context: 'One synthetic rural health region',
      measurable_problem:
        'First-appointment slots go unused when booked patients do not attend, while others wait.',
      outcome_measure:
        'Share of first-appointment slots left unused each month',
      data_and_tools: ['Scheduling system CSV exports'],
      time_limit: 'Six weeks',
      budget_limit: 'Fixture budget only; no paid services',
      nae_seed: 'Advance health informatics',
      constraints: ['Synthetic data only.', 'No patient-identifying data.'],
    },
    claims: [
      {
        statement:
          'Rural clinics recorded a 23 percent no-show rate for first appointments in 2025.',
        bears_on: ['problem', 'affected_users'],
        support: [
          passage(
            NO_SHOWS,
            '23 percent',
            'recorded a 23 percent no-show rate for first appointments in 2025',
          ),
        ],
      },
      {
        statement: 'Rural first-appointment waits rose between 2022 and 2025.',
        bears_on: ['urgency'],
        support: [
          passage(
            WAITS_REPORT,
            '41 days',
            'was 41 days, up from 29 days in 2022',
          ),
          passage(
            SURVEY,
            'fell slightly',
            'fell slightly, from a mean of 35 days in 2022 to 33 days in 2025',
            'observation',
            'contradicts',
          ),
        ],
      },
      {
        statement:
          'Clinic scheduling systems export appointment histories with attendance.',
        bears_on: ['data'],
        support: [
          passage(
            EXPORTS,
            'export appointment histories',
            'export appointment histories, including attendance, as CSV files',
          ),
        ],
      },
      {
        statement:
          'The clinics’ scheduling systems send reminders but do not predict no-shows.',
        bears_on: ['existing_tool', 'tool_gap'],
        support: [
          passage(
            SYSTEMS,
            'predicts which booked patients',
            'None of the three systems predicts which booked patients are likely to miss their appointment',
          ),
        ],
      },
      {
        statement:
          'Airline overbooking calculations from historical no-show rates have been used to double-book outpatient slots with a high predicted no-show probability.',
        bears_on: ['mechanism'],
        support: [
          passage(
            OVERBOOKING,
            'used the same calculation',
            'used the same calculation to double-book slots with a high predicted no-show probability',
          ),
        ],
      },
      {
        statement:
          'Front-desk staff phone patients the day before appointments to confirm attendance.',
        bears_on: ['workaround'],
        support: [
          passage(
            CALLS,
            'phone patients the day before',
            'phone patients the day before appointments to confirm attendance',
          ),
        ],
      },
    ],
    catalog: [
      {
        kind: 'idea',
        title:
          'Phone patients the day before appointments to confirm attendance',
        summary:
          'Earlier idea: reception calls each booked patient the day before to confirm or release the slot.',
      },
    ],
    perspectives: [
      'software',
      'existing_tool',
      'process_change',
      'human_led',
      'hybrid',
    ],
    excluded: [],
    fetch: [
      WAITS_REPORT,
      SURVEY,
      NO_SHOWS,
      EXPORTS,
      SYSTEMS,
      OVERBOOKING,
      CALLS,
    ],
  },
  {
    key: 'existing_tool',
    title: 'Understaffed Saturday shifts at a food bank',
    brief: {
      theme: 'Understaffed volunteer shifts at a community food bank',
      fields: ['retail workforce scheduling', 'volunteer management'],
      target_users: 'Volunteer coordinators at one community food bank',
      context: null,
      measurable_problem:
        'Saturday distribution shifts often run short of volunteers.',
      outcome_measure: 'Share of Saturday shifts below their volunteer target',
      data_and_tools: ['Coordinator spreadsheets'],
      time_limit: 'Four weeks',
      budget_limit: 'No paid software',
      nae_seed: null,
      constraints: ['Synthetic data only.'],
    },
    claims: [
      {
        statement:
          'Food bank coordinators reported that 30 percent of Saturday shifts were understaffed in 2025.',
        bears_on: ['problem', 'urgency'],
        support: [
          passage(
            FOODBANK,
            '30 percent',
            'reported that 30 percent of Saturday shifts were understaffed in 2025',
          ),
        ],
      },
      {
        statement:
          'Free volunteer sign-up services already publish shifts, collect sign-ups and send reminders.',
        bears_on: ['existing_tool'],
        support: [
          passage(
            SIGNUP,
            'publish shifts',
            'let coordinators publish shifts, collect sign-ups and send automatic reminders',
          ),
        ],
      },
      {
        statement:
          'Coordinators fill gaps by texting regular volunteers on Friday evenings.',
        bears_on: ['workaround'],
        support: [
          passage(
            FOODBANK,
            'texting regular volunteers',
            'fill gaps by texting regular volunteers on Friday evenings',
          ),
        ],
      },
    ],
    catalog: [],
    perspectives: ['software', 'existing_tool', 'process_change'],
    excluded: [
      {
        perspective: 'human_led',
        reason:
          'The coordinators already lead this work; a new role is out of scope for one site.',
      },
      {
        perspective: 'hybrid',
        reason:
          'Covered by the process-change and existing-tool designers for this small brief.',
      },
    ],
    fetch: [FOODBANK, SIGNUP],
  },
  {
    key: 'insufficient',
    title: 'Course e-book availability for students',
    brief: {
      theme: 'Course e-book availability at a university library',
      fields: ['streaming media licensing', 'academic libraries'],
      target_users: 'Undergraduates who need assigned e-books',
      context: null,
      measurable_problem:
        'Students may wait for assigned e-books because of concurrent-loan limits.',
      outcome_measure:
        'Days between a student requesting an e-book and opening it',
      data_and_tools: [],
      time_limit: 'Four weeks',
      budget_limit: 'No paid services',
      nae_seed: 'Advance personalized learning',
      constraints: ['Synthetic data only.'],
    },
    claims: [
      {
        statement:
          'Students wait more than a week for assigned course e-books.',
        bears_on: ['problem', 'affected_users'],
        support: [{ evidence: 'inaccessible_source', url: PAYWALLED }],
      },
      {
        statement: 'The library’s licences limit concurrent e-book loans.',
        bears_on: ['mechanism'],
        support: [],
      },
    ],
    catalog: [],
    perspectives: [
      'software',
      'existing_tool',
      'process_change',
      'human_led',
      'hybrid',
    ],
    excluded: [],
    fetch: [PAYWALLED],
  },
];
