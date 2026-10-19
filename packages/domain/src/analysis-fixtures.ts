import { canonicalHash } from './rules.js';
import { REVIEWER_RUBRIC, type EvaluationArm } from './evaluation.js';

/**
 * Synthetic T16 verification fixtures. Each scenario is a complete, labelled analysis input in
 * the exact file shapes a T15 evaluation run writes, built so the expected tables can be
 * computed by hand. None of it describes a person, a model or a real task.
 */
export const FIXTURE_LABEL =
  'VERIFICATION FIXTURE: synthetic data, not empirical' as const;

type Values = (number | null)[];
interface AttemptSpec {
  state: string;
  infrastructure?: boolean;
  known?: number;
  unknown?: number;
  inFlight?: number;
  calls?: number;
  humanMinutes?: number | null;
  wall?: number | null;
  checks?: { passed: boolean; held_out: boolean }[];
  sources?: boolean[];
  interventions?: {
    type: string;
    gate: string;
    prevented_problem: string;
    minutes: number;
    wait: number;
  }[];
  deviation?: string;
  /** Per reviewer: five 1-5 values (null = blank cell); omitted = blank row. */
  ratings?: [Values | undefined, Values | undefined];
}
interface SlotSpec {
  task: string;
  arm: EvaluationArm;
  repeat?: number;
  state: string;
  reasons?: string[];
  attempts?: AttemptSpec[];
}
interface TaskSpec {
  key: string;
  role: 'autonomy' | 'discovery';
  stratum: 'decision' | 'implementation';
}

const ARMS = {
  A: ['autonomous', 'structured'],
  B: ['human_in_loop', 'structured'],
  C: ['human_only', 'human_defined'],
  'D-structured': ['autonomous', 'structured'],
  'D-open': ['autonomous', 'open_ended'],
} as const;
const PARTICIPANT = '00000000-0000-4000-8000-00000000f001';
const PARTICIPANT_CODE = 'FIXTURE-P01';
const FAMILIARITY = 'Fixture familiarity note';
const SECRET = 'fixture-blinding-secret-not-real';
const REVIEWERS = ['reviewer-1', 'reviewer-2'];
const uuid = (n: number) =>
  `00000000-0000-4000-8000-${n.toString(16).padStart(12, '0')}`;

function build(
  scenario: string,
  covers: string[],
  tasks: TaskSpec[],
  slots: SlotSpec[],
  options: { mode: 'final' | 'rehearsal'; threshold: number | null },
) {
  let next = 1;
  const freeze_hash = canonicalHash({ fixture: scenario, freeze: true });
  const flow: Record<string, unknown>[] = [];
  const audits: Record<string, unknown>[] = [];
  const checks: Record<string, unknown>[] = [];
  const codes: Record<string, { slot_id: string; attempt_id: string }> = {};
  const rows: Record<string, string[]> = Object.fromEntries(
    REVIEWERS.map((r) => [r, []]),
  );
  const exportAttempts: Record<string, Record<string, unknown>[]> = {};
  const events: Record<string, Record<string, unknown>[]> = {};
  for (const t of tasks) {
    exportAttempts[t.key] = [];
    events[t.key] = [];
  }
  slots.forEach((s, i) => {
    const task = tasks.find((t) => t.key === s.task)!;
    const repeat = s.repeat ?? 1;
    const slot_id = canonicalHash({
      scenario,
      task: s.task,
      arm: s.arm,
      repeat,
    });
    const [condition, discovery_method] = ARMS[s.arm];
    const specs = s.attempts ?? [];
    const attempts = specs.map((a, n) => {
      const attempt_id = uuid(next++);
      const measurements = {
        active_ai_seconds: 0,
        active_ai_source: 'fixture_has_no_ai_inference',
        simulated_provider_request_seconds: 0,
        human_active_minutes:
          a.humanMinutes === undefined
            ? condition === 'autonomous'
              ? 0
              : 30
            : a.humanMinutes,
        human_wait_seconds: 0,
        intervention_active_minutes: (a.interventions ?? []).reduce(
          (m, x) => m + x.minutes,
          0,
        ),
        intervention_wait_seconds: (a.interventions ?? []).reduce(
          (m, x) => m + x.wait,
          0,
        ),
        wall_seconds: a.wall === undefined ? 600 : a.wall,
        known_simulated_spend_nano_usd: String(a.known ?? 0),
        unknown_simulated_exposure_nano_usd: String(a.unknown ?? 0),
        in_flight_simulated_exposure_nano_usd: String(a.inFlight ?? 0),
        calls: a.calls ?? (condition === 'human_only' ? 0 : 3),
        retries: 0,
        denials: 0,
        failures: a.unknown ? 1 : 0,
      };
      exportAttempts[s.task]!.push({
        id: attempt_id,
        participant_actor_id: PARTICIPANT,
        participant_code: PARTICIPANT_CODE,
        prior_familiarity: FAMILIARITY,
        condition,
        state: a.state,
        measurements,
      });
      for (const x of a.interventions ?? [])
        events[s.task]!.push({
          attempt_id,
          kind: 'interventions',
          payload: {
            type: x.type,
            gate: x.gate,
            prevented_problem: x.prevented_problem,
            human_active_minutes: x.minutes,
            wait_seconds: x.wait,
          },
        });
      if (a.deviation)
        events[s.task]!.push({
          attempt_id,
          kind: 'deviations',
          payload: {
            reason: a.deviation,
            impact: 'Fixture deviation; recorded, not excluded.',
          },
        });
      if (task.stratum === 'implementation')
        for (const [k, c] of (a.checks ?? []).entries())
          checks.push({
            slot_id,
            attempt_id,
            check_key: `case-${k + 1}`,
            held_out: c.held_out,
            passed: c.passed,
            backend: 'labelled-fixture',
            executor: 'fixture-qa/1',
          });
      if (discovery_method !== 'human_defined')
        audits.push({
          slot_id,
          attempt_id,
          sources: (a.sources ?? [false]).map((verified, k) => ({
            locator: `fixture://analysis/${s.task}/${k + 1}`,
            verified,
          })),
        });
      if (task.stratum === 'decision' && n === specs.length - 1) {
        const code = canonicalHash({ SECRET, slot_id }).slice(0, 10);
        codes[code] = { slot_id, attempt_id };
        REVIEWERS.forEach((r, k) => {
          const v = a.ratings?.[k];
          const cells = v
            ? v.map((x) => (x === null ? '' : String(x)))
            : REVIEWER_RUBRIC.dimensions.map(() => '');
          rows[r]!.push(`${code},${cells.join(',')},`);
        });
      }
      return {
        attempt_id,
        state: a.state,
        retry_of: null as string | null,
        human_source: condition === 'autonomous' ? 'none' : 'participant',
        classification: a.infrastructure
          ? {
              class: 'instrumentation',
              reason: 'Fixture infrastructure failure.',
            }
          : { class: 'substantive', reason: `Task outcome: ${a.state}.` },
        measurements,
      };
    });
    attempts.forEach((a, n) => {
      a.retry_of = n ? attempts[n - 1]!.attempt_id : null;
    });
    flow.push({
      slot_id,
      sequence: i + 1,
      task_key: s.task,
      arm: s.arm,
      condition,
      discovery_method,
      repeat,
      state: s.state,
      reasons: s.reasons ?? [],
      outcome: attempts.length ? s.state : null,
      attempts,
    });
  });
  const schedule = {
    schema_version: 'evaluation-schedule/1',
    freeze_origin: options.mode === 'final' ? 'adopted' : 'rehearsal',
    freeze_hash,
    tasks: tasks.map((t) => ({ ...t, packet_hash: canonicalHash(t) })),
    slots: flow.map((f) => ({ slot_id: f.slot_id, sequence: f.sequence })),
  };
  const pkgBody = {
    schema_version: 'evaluation-package/1',
    mode: options.mode,
    empirical_results: false,
    evidence_kind: FIXTURE_LABEL,
    freeze: { origin: schedule.freeze_origin, freeze_hash },
    schedule: { ...schedule, schedule_hash: canonicalHash(schedule) },
    flow,
    source_support_audits: audits,
    functional_checks: checks,
  };
  const pkg = { ...pkgBody, package_hash: canonicalHash(pkgBody) };
  const header = ['item', 'code', ...REVIEWER_RUBRIC.dimensions, 'notes'].join(
    ',',
  );
  const ratings = Object.keys(codes).length
    ? REVIEWERS.map((r) => ({
        reviewer: r,
        csv:
          `${header}\n` +
          rows[r]!.map(
            (line, n) => `${String(n + 1).padStart(2, '0')},${line}`,
          ).join('\n') +
          '\n',
      }))
    : [];
  const exports = tasks
    .filter((t) => exportAttempts[t.key]!.length)
    .map((t) => {
      const body = {
        schema_version: 'study-export/1',
        synthetic: true,
        empirical_results: false,
        attempts: exportAttempts[t.key],
        raw_events: events[t.key],
      };
      return {
        key: t.key,
        body: { ...body, export_hash: canonicalHash(body) },
      };
    });
  return {
    scenario,
    fixture: {
      schema_version: 'analysis-fixture/1' as const,
      label: FIXTURE_LABEL,
      scenario,
      covers,
    },
    package: pkg,
    key: { private: true, secret: SECRET, codes },
    ratings,
    exports,
    options:
      options.threshold === null
        ? null
        : {
            decision_min_mean_rating: options.threshold,
            basis: 'Fixture value for verification; not an owner decision.',
          },
  };
}
export type AnalysisFixture = ReturnType<typeof build>;

const all = (n: number): Values => [n, n, n, n, n];
const M = 1_000_000; // 0.001 USD in nano-USD

/**
 * Two decision tasks, one implementation task and one discovery theme with two repeats.
 * Covers missing and partial ratings, failed and blocked runs, a permitted retry, unknown
 * billing, repeated observations from one participant, interventions and a deviation.
 */
export function mixedFixture() {
  return build(
    'mixed',
    [
      'missing ratings (blank items, one partial reviewer row)',
      'failed and blocked runs kept in assigned denominators',
      'retry after an infrastructure failure; both attempts counted for resources',
      'unknown billing (lower-bound cost)',
      'repeated observations: discovery repeats and one participant across human arms',
      'interventions and a recorded deviation',
    ],
    [
      { key: 'd1', role: 'autonomy', stratum: 'decision' },
      { key: 'd2', role: 'autonomy', stratum: 'decision' },
      { key: 'i1', role: 'autonomy', stratum: 'implementation' },
      { key: 't1', role: 'discovery', stratum: 'decision' },
    ],
    [
      {
        task: 'd1',
        arm: 'A',
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            known: 4 * M,
            wall: 300,
            ratings: [all(3), all(4)],
          },
        ],
      },
      {
        task: 'd1',
        arm: 'B',
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            known: 3 * M,
            humanMinutes: 10,
            wall: 900,
            sources: [true, false],
            interventions: [
              {
                type: 'clarification',
                gate: 'fixed',
                prevented_problem: 'yes',
                minutes: 5,
                wait: 30,
              },
            ],
            ratings: [all(4), all(5)],
          },
        ],
      },
      {
        task: 'd1',
        arm: 'C',
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            humanMinutes: 40,
            wall: 2400,
            deviation: 'Fixture: a search page showed an AI summary.',
            ratings: [all(2), all(3)],
          },
        ],
      },
      {
        task: 'd2',
        arm: 'A',
        state: 'failed',
        attempts: [{ state: 'failed', known: 2 * M, wall: 200 }],
      },
      {
        task: 'd2',
        arm: 'B',
        state: 'submitted',
        attempts: [
          {
            state: 'failed',
            infrastructure: true,
            calls: 0,
            humanMinutes: 0,
            wall: 20,
          },
          {
            state: 'submitted',
            known: 3.5 * M,
            humanMinutes: 12,
            wall: 1000,
            interventions: [
              {
                type: 'judgment',
                gate: 'dynamic',
                prevented_problem: 'unknown',
                minutes: 3,
                wait: 60,
              },
            ],
            ratings: [[3, 4, 3, 4, 3], all(4)],
          },
        ],
      },
      {
        task: 'd2',
        arm: 'C',
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            humanMinutes: 50,
            wall: 3000,
            ratings: [all(3), [4, 4, null, 4, 4]],
          },
        ],
      },
      {
        task: 'i1',
        arm: 'A',
        state: 'blocked',
        reasons: ['Fixture: no frozen build task bound for the AI builder.'],
      },
      {
        task: 'i1',
        arm: 'B',
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            known: 6 * M,
            humanMinutes: 15,
            wall: 1800,
            checks: [
              { passed: true, held_out: false },
              { passed: true, held_out: false },
              { passed: true, held_out: true },
            ],
          },
        ],
      },
      {
        task: 'i1',
        arm: 'C',
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            humanMinutes: 80,
            wall: 4800,
            checks: [
              { passed: true, held_out: false },
              { passed: true, held_out: false },
              { passed: false, held_out: true },
            ],
          },
        ],
      },
      {
        task: 't1',
        arm: 'D-structured',
        repeat: 1,
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            known: 2 * M,
            wall: 400,
            ratings: [all(3), all(3)],
          },
        ],
      },
      {
        task: 't1',
        arm: 'D-open',
        repeat: 1,
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            known: 2 * M,
            wall: 500,
            ratings: [all(4), all(4)],
          },
        ],
      },
      {
        task: 't1',
        arm: 'D-structured',
        repeat: 2,
        state: 'failed',
        attempts: [
          { state: 'failed', known: 0.5 * M, unknown: 2.5 * M, wall: 450 },
        ],
      },
      {
        task: 't1',
        arm: 'D-open',
        repeat: 2,
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            known: 2 * M,
            wall: 550,
            ratings: [all(2), all(4)],
          },
        ],
      },
    ],
    { mode: 'rehearsal', threshold: 3 },
  );
}

/** Nothing is accepted: cost per accepted outcome is undefined while total spend stays visible. */
export function zeroAcceptedFixture() {
  return build(
    'zero-accepted',
    [
      'zero accepted outcomes in every arm',
      'needs_human, budget_exhausted, cancelled and failed runs',
      'a submitted build that fails a held-out case',
    ],
    [
      { key: 'd1', role: 'autonomy', stratum: 'decision' },
      { key: 'i1', role: 'autonomy', stratum: 'implementation' },
    ],
    [
      {
        task: 'd1',
        arm: 'A',
        state: 'needs_human',
        attempts: [
          { state: 'needs_human', known: 3 * M, ratings: [all(2), all(1)] },
        ],
      },
      {
        task: 'd1',
        arm: 'B',
        state: 'budget_exhausted',
        attempts: [{ state: 'budget_exhausted', known: 7 * M }],
      },
      {
        task: 'd1',
        arm: 'C',
        state: 'cancelled',
        attempts: [{ state: 'cancelled', humanMinutes: 20 }],
      },
      {
        task: 'i1',
        arm: 'A',
        state: 'failed',
        attempts: [{ state: 'failed', known: 5 * M }],
      },
      {
        task: 'i1',
        arm: 'B',
        state: 'submitted',
        attempts: [
          {
            state: 'submitted',
            known: 4 * M,
            checks: [
              { passed: true, held_out: false },
              { passed: false, held_out: true },
            ],
          },
        ],
      },
      {
        task: 'i1',
        arm: 'C',
        state: 'failed',
        attempts: [{ state: 'failed', humanMinutes: 90 }],
      },
    ],
    { mode: 'rehearsal', threshold: 3 },
  );
}

/** The shape a final plan has today: every slot blocked, nothing ran, nothing rated. */
export function allBlockedFixture() {
  const reason = [
    'Fixture: no adopted protocol freeze (RD1-RD10).',
    'Fixture: no verified model id and live dispatch disabled (RD6).',
  ];
  const tasks: TaskSpec[] = [
    { key: 'd1', role: 'autonomy', stratum: 'decision' },
    { key: 'i1', role: 'autonomy', stratum: 'implementation' },
    { key: 't1', role: 'discovery', stratum: 'decision' },
  ];
  const slots: SlotSpec[] = [
    ...(['d1', 'i1'] as const).flatMap((task) =>
      (['A', 'B', 'C'] as const).map((arm) => ({
        task,
        arm,
        state: 'blocked',
        reasons: reason,
      })),
    ),
    ...[1, 2].flatMap((repeat) =>
      (['D-structured', 'D-open'] as const).map((arm) => ({
        task: 't1',
        arm,
        repeat,
        state: 'blocked',
        reasons: reason,
      })),
    ),
  ];
  return build(
    'all-blocked',
    [
      'final-mode package shape with an adopted-looking freeze, overridden by the fixture marker',
      'every slot blocked: no attempts, no ratings, no exports',
    ],
    tasks,
    slots,
    { mode: 'final', threshold: null },
  );
}

export const ANALYSIS_FIXTURES = {
  mixed: mixedFixture,
  'zero-accepted': zeroAcceptedFixture,
  'all-blocked': allBlockedFixture,
} as const;
