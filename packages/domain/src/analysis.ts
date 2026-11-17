import { ContractError, z } from '@creator/contracts';
import { canonicalHash } from './rules.js';
import { REVIEWER_RUBRIC } from './evaluation.js';

/**
 * T16 analysis. Reads only the files a T15 evaluation run writes (package, private key, raw
 * study exports) plus the reviewers' filled ratings.csv files, and turns them into tables.
 * It computes descriptive summaries per task; it never imputes a rating, estimates power or
 * states that one arm is better. Whether the result is empirical is derived from the inputs.
 */
/** analysis/2 (ADR-0129): the human effort table gained the measured_* columns. */
export const ANALYSIS_VERSION = 'analysis/2';

/** Implementation defaults. The freeze (RD2, RD4) may replace any of them before final data. */
export const ANALYSIS_PLAN = {
  version: 'analysis-plan/2',
  status:
    'Implementation default, not an owner decision; adopt or replace it in the protocol freeze.',
  unit: 'Task. Arms are paired within a task; a run is one observation however many ideas it contains.',
  primary_attempt:
    'The last attempt in each slot gives the outcome (a permitted retry replaces an infrastructure failure); every attempt counts for resources.',
  quality:
    'Per reviewer: mean of the five rubric dimensions when all five are present. Per slot: mean over reviewers with complete ratings. Missing ratings are never imputed.',
  implementation:
    'Share of executed frozen cases (held-out included) passed by the last attempt; accepted when submitted and every case passed.',
  discovery:
    'Per theme: mean over repeats for each method, then open-ended minus structured. Repeats are not independent observations.',
  uncertainty: {
    rule: 'Range, median and sign counts over tasks always; a percentile bootstrap over tasks only when there are at least bootstrap_min_tasks pairs.',
    bootstrap_min_tasks: 10,
    resamples: 2000,
    interval: 0.95,
  },
  agreement:
    'Quadratic-weighted kappa per dimension for exactly two reviewers, plus every disagreement of two points or more.',
  cost: 'Cost per accepted outcome counts every attempt (failures and retries). Undefined when nothing was accepted; a lower bound when billing is unknown or in flight.',
  exploratory:
    'Per-protocol completion (ran slots only) is exploratory and reported apart from the assigned-condition tables.',
  measured_effort:
    'Measured human time (study-effort-timer/1) is summed over every attempt of a timed condition (human-only and assisted) from the raw exports, beside the reported figures and never replacing them; an attempt counts as completely timed only when its finish was timed and no step was left open. Measured columns are null for a group with no timed attempt, and nothing is imputed for an untimed attempt.',
} as const;

const digits = z.string().regex(/^(0|[1-9][0-9]{0,29})$/);
const num = z.number().finite();
const MeasurementsSchema = z.looseObject({
  human_active_minutes: num.nullable(),
  human_wait_seconds: num.nullable(),
  intervention_active_minutes: num,
  intervention_wait_seconds: num,
  wall_seconds: num.nullable(),
  known_simulated_spend_nano_usd: digits,
  unknown_simulated_exposure_nano_usd: digits,
  in_flight_simulated_exposure_nano_usd: digits,
  calls: z.number().int().min(0),
  retries: z.number().int().min(0),
});
const ARM = z.enum(['A', 'B', 'C', 'D-structured', 'D-open']);
const FlowRowSchema = z.looseObject({
  slot_id: z.string().min(1),
  sequence: z.number().int(),
  task_key: z.string().min(1),
  arm: ARM,
  condition: z.string(),
  discovery_method: z.string(),
  repeat: z.number().int().min(1),
  state: z.string(),
  reasons: z.array(z.string()),
  outcome: z.string().nullable(),
  attempts: z.array(
    z.looseObject({
      attempt_id: z.string().min(1),
      state: z.string(),
      retry_of: z.string().nullable(),
      human_source: z.string(),
      classification: z.looseObject({ class: z.string(), reason: z.string() }),
      measurements: MeasurementsSchema,
    }),
  ),
});
const PackageSchema = z.looseObject({
  schema_version: z.literal('evaluation-package/1'),
  mode: z.enum(['final', 'rehearsal']),
  freeze: z.looseObject({ origin: z.string(), freeze_hash: z.string() }),
  schedule: z.looseObject({
    schedule_hash: z.string(),
    tasks: z.array(
      z.looseObject({
        key: z.string(),
        role: z.enum(['autonomy', 'discovery']),
        stratum: z.enum(['decision', 'implementation']),
      }),
    ),
    slots: z.array(z.looseObject({ slot_id: z.string() })),
  }),
  flow: z.array(FlowRowSchema),
  source_support_audits: z.array(
    z.looseObject({
      slot_id: z.string(),
      attempt_id: z.string(),
      sources: z.array(z.looseObject({ verified: z.boolean() })),
    }),
  ),
  functional_checks: z.array(
    z.looseObject({
      slot_id: z.string(),
      attempt_id: z.string(),
      passed: z.boolean(),
      held_out: z.boolean().optional(),
      backend: z.string().nullable().optional(),
      executor: z.string(),
    }),
  ),
  package_hash: z.string(),
});
const KeySchema = z.looseObject({
  codes: z.record(
    z.string(),
    z.looseObject({ slot_id: z.string(), attempt_id: z.string() }),
  ),
});
/** ADR-0122/0129: optional, so exports made before the timer read as before. */
const MeasuredEffortSchema = z.looseObject({
  subject: z.string(),
  // Absent before ADR-0129; false for the autonomous condition, which is never timed.
  condition_timed: z.boolean().optional(),
  steps: z.array(
    z.looseObject({
      measured: z
        .looseObject({
          // Absent in exports made before ADR-0129, when every measured step was an intervention.
          ended_by: z.string().optional(),
          active_ms: num.min(0),
          wait_ms: num.min(0),
          idle_ms: num.min(0),
          away_ms: num.min(0),
        })
        .nullable(),
    }),
  ),
});
const ExportSchema = z.looseObject({
  schema_version: z.literal('study-export/1'),
  synthetic: z.boolean(),
  attempts: z.array(
    z.looseObject({
      id: z.string(),
      participant_actor_id: z.string(),
      participant_code: z.string(),
      prior_familiarity: z.string().optional(),
      measurements: MeasurementsSchema,
      measured_effort: MeasuredEffortSchema.optional(),
    }),
  ),
  raw_events: z.array(
    z.looseObject({
      attempt_id: z.string().nullable(),
      kind: z.string(),
      payload: z.record(z.string(), z.unknown()),
    }),
  ),
});
export const AnalysisOptionsSchema = z.strictObject({
  /** Owner's acceptance rule for the decision stratum; null leaves it undefined. */
  decision_min_mean_rating: z.number().min(1).max(5).nullable(),
  /** Who set it: an owner decision reference, or a fixture label. */
  basis: z.string().min(1),
});
export const FixtureMarkerSchema = z.strictObject({
  schema_version: z.literal('analysis-fixture/1'),
  label: z.literal('VERIFICATION FIXTURE: synthetic data, not empirical'),
  scenario: z.string(),
  covers: z.array(z.string()),
});

export interface AnalysisInput {
  package: unknown;
  key: unknown;
  /** Filled ratings.csv text per reviewer directory name. */
  ratings: { reviewer: string; csv: string }[];
  exports: { key: string; body: unknown }[];
  options?: unknown;
  fixture?: unknown;
  /** Raw-data references: every input file and its SHA-256, recorded verbatim. */
  sources: { path: string; sha256: string }[];
}

function read<T>(schema: z.ZodType<T>, value: unknown, what: string): T {
  const r = schema.safeParse(value);
  if (!r.success)
    throw new ContractError(
      'INVALID_CONTRACT',
      `${what} does not match the expected shape.`,
      r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`),
    );
  return r.data;
}

const DIMS = REVIEWER_RUBRIC.dimensions;
type Dim = (typeof DIMS)[number];
export interface RatingRow {
  reviewer: string;
  code: string;
  values: Record<Dim, number | null>;
  has_note: boolean;
}

/**
 * RFC 4180 records, so reviewer notes with commas, quotes or line breaks stay in their column.
 * Each record keeps the line it starts on; blank lines are skipped.
 */
function csvRecords(text: string) {
  const out: { line: number; cells: string[] }[] = [];
  let cells: string[] = [];
  let cur = '';
  let quoted = false;
  let line = 1;
  let start = 1;
  const end = () => {
    cells.push(cur);
    if (cells.length > 1 || cells[0]!.trim()) out.push({ line: start, cells });
    cells = [];
    cur = '';
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch === '\n') line++;
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      cells.push(cur);
      cur = '';
    } else if (ch === '\n') {
      end();
      start = line;
    } else cur += ch;
  }
  end();
  return { records: out, unterminated: quoted ? start : null };
}

/** Parses a reviewer's ratings.csv. Blank cells are missing; anything else must be 1-5. */
export function parseRatings(reviewer: string, csv: string) {
  const { records, unterminated } = csvRecords(csv.replace(/\r\n?/g, '\n'));
  const header = (records[0]?.cells ?? []).map((h) => h.trim());
  const want = ['item', 'code', ...DIMS, 'notes'];
  if (header.join(',') !== want.join(','))
    throw new ContractError(
      'INVALID_CONTRACT',
      `${reviewer}/ratings.csv header must be ${want.join(',')}.`,
    );
  const problems: string[] = unterminated
    ? [`line ${unterminated}: a quoted cell is never closed.`]
    : [];
  const rows: RatingRow[] = [];
  for (const { line, cells } of records.slice(1)) {
    if (cells.length !== want.length) {
      problems.push(`line ${line}: expected ${want.length} columns.`);
      continue;
    }
    const values = {} as Record<Dim, number | null>;
    DIMS.forEach((d, i) => {
      const cell = cells[i + 2]!.trim();
      if (!cell) values[d] = null;
      else if (/^[1-5]$/.test(cell)) values[d] = Number(cell);
      else {
        values[d] = null;
        problems.push(`line ${line}: ${d} "${cell}" is not 1-5.`);
      }
    });
    rows.push({
      reviewer,
      code: cells[1]!.trim(),
      values,
      has_note: Boolean(cells[want.length - 1]!.trim()),
    });
  }
  if (problems.length)
    throw new ContractError(
      'INVALID_CONTRACT',
      `${reviewer}/ratings.csv has invalid ratings.`,
      problems,
    );
  return rows;
}

const mean = (xs: number[]) =>
  xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null;
const round = (x: number | null) =>
  x === null ? null : Math.round(x * 10000) / 10000;
function median(xs: number[]) {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
const sumBig = (xs: string[]) => xs.reduce((n, x) => n + BigInt(x), 0n);
/** Exact nano-USD as a decimal dollar string (no floating point). */
export function usd(nano: bigint) {
  const neg = nano < 0n;
  const v = neg ? -nano : nano;
  const whole = v / 1_000_000_000n;
  const frac = (v % 1_000_000_000n).toString().padStart(9, '0');
  return `${neg ? '-' : ''}${whole}.${frac}`;
}

/** Deterministic PRNG (mulberry32) seeded from the input hash, so reruns match exactly. */
function prng(seedHex: string) {
  let a = parseInt(seedHex.slice(0, 8), 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Summary of task-level paired differences; a bootstrap only when the plan's minimum is met. */
export function summarizeDifferences(diffs: number[], seedHex: string) {
  const u = ANALYSIS_PLAN.uncertainty;
  const base = {
    n_pairs: diffs.length,
    min: round(diffs.length ? Math.min(...diffs) : null),
    median: round(median(diffs)),
    max: round(diffs.length ? Math.max(...diffs) : null),
    positive: diffs.filter((d) => d > 0).length,
    zero: diffs.filter((d) => d === 0).length,
    negative: diffs.filter((d) => d < 0).length,
  };
  if (diffs.length < u.bootstrap_min_tasks)
    return {
      ...base,
      interval: null,
      interval_note: `Not computed: ${diffs.length} task pair(s), below the plan minimum of ${u.bootstrap_min_tasks}. Report the range, not an interval.`,
    };
  const rand = prng(seedHex);
  const means: number[] = [];
  for (let r = 0; r < u.resamples; r++) {
    let s = 0;
    for (let i = 0; i < diffs.length; i++)
      s += diffs[Math.floor(rand() * diffs.length)]!;
    means.push(s / diffs.length);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor(((1 - u.interval) / 2) * (u.resamples - 1))]!;
  const hi = means[Math.ceil((1 - (1 - u.interval) / 2) * (u.resamples - 1))]!;
  return {
    ...base,
    interval: { level: u.interval, low: round(lo), high: round(hi) },
    interval_note: `Percentile bootstrap of the mean difference over ${diffs.length} tasks, ${u.resamples} resamples; describes these tasks only.`,
  };
}

/** Quadratic-weighted kappa on a 1-5 scale; null when it is undefined (no variation). */
export function weightedKappa(pairs: [number, number][]) {
  if (!pairs.length) return null;
  const k = 5;
  const n = pairs.length;
  const w = (i: number, j: number) => ((i - j) * (i - j)) / ((k - 1) * (k - 1));
  const p = Array(k + 1).fill(0) as number[];
  const q = Array(k + 1).fill(0) as number[];
  let observed = 0;
  for (const [a, b] of pairs) {
    p[a]! += 1 / n;
    q[b]! += 1 / n;
    observed += w(a, b) / n;
  }
  let expected = 0;
  for (let i = 1; i <= k; i++)
    for (let j = 1; j <= k; j++) expected += w(i, j) * p[i]! * q[j]!;
  return expected === 0 ? null : round(1 - observed / expected);
}

export interface AnalysisCheck {
  id: string;
  status: 'pass' | 'fail';
  detail: string;
}
const check = (id: string, ok: boolean, detail: string): AnalysisCheck => ({
  id,
  status: ok ? 'pass' : 'fail',
  detail,
});

const PAIRS = [
  ['B', 'A'],
  ['C', 'A'],
  ['C', 'B'],
] as const;
const TERMINAL = [
  'submitted',
  'failed',
  'cancelled',
  'needs_human',
  'budget_exhausted',
] as const;

export function analyze(input: AnalysisInput) {
  const pkg = read(PackageSchema, input.package, 'evaluation-package.json');
  const key = read(KeySchema, input.key, 'private/assignment-key.json');
  const exports = input.exports.map((e) => ({
    key: e.key,
    body: read(ExportSchema, e.body, `private/raw-exports/${e.key}.json`),
  }));
  const options = read(
    AnalysisOptionsSchema,
    input.options ?? {
      decision_min_mean_rating: null,
      basis: 'No acceptance rule supplied; decision acceptance is undefined.',
    },
    'analysis-options.json',
  );
  const fixture =
    input.fixture === undefined || input.fixture === null
      ? null
      : read(FixtureMarkerSchema, input.fixture, 'FIXTURE.json');
  const ratings = input.ratings.flatMap((r) => parseRatings(r.reviewer, r.csv));
  const reviewers = [...new Set(input.ratings.map((r) => r.reviewer))].sort();

  // Inputs decide what this is; a fixture marker or any synthetic export is never empirical.
  const syntheticExports = exports.filter((e) => e.body.synthetic).length;
  const empirical =
    !fixture &&
    pkg.mode === 'final' &&
    pkg.freeze.origin === 'adopted' &&
    exports.length > 0 &&
    syntheticExports === 0;
  const dataKind = fixture
    ? 'synthetic_verification_fixture'
    : empirical
      ? 'final_records'
      : 'not_empirical';
  const label = fixture
    ? fixture.label
    : empirical
      ? 'Final study records under the adopted freeze. Tables only; interpretation belongs in the thesis.'
      : 'NOT EMPIRICAL: rehearsal or synthetic study records.';

  const roles = new Map(pkg.schedule.tasks.map((t) => [t.key, t]));
  const flow = pkg.flow.map((f) => {
    const task = roles.get(f.task_key);
    if (!task)
      throw new ContractError(
        'INVALID_CONTRACT',
        `Flow slot ${f.slot_id} names unknown task ${f.task_key}.`,
      );
    return { ...f, stratum: task.stratum, comparison: task.role };
  });
  const slotById = new Map(flow.map((f) => [f.slot_id, f]));
  const attempts = flow.flatMap((f) =>
    f.attempts.map((a, i) => ({
      ...a,
      slot: f,
      primary: i === f.attempts.length - 1,
    })),
  );
  const primaryAttempt = new Map(
    attempts.filter((a) => a.primary).map((a) => [a.slot.slot_id, a]),
  );

  // Ratings: per reviewer, per slot, complete only when every dimension is present.
  const codeToSlot = new Map(
    Object.entries(key.codes).map(([code, v]) => [code, v]),
  );
  const ratingProblems: string[] = [];
  const seen = new Set<string>();
  for (const r of ratings) {
    const target = codeToSlot.get(r.code);
    if (!target) ratingProblems.push(`${r.reviewer}: unknown code ${r.code}.`);
    else if (
      primaryAttempt.get(target.slot_id)?.attempt_id !== target.attempt_id
    )
      ratingProblems.push(
        `${r.reviewer}: code ${r.code} does not map to the last attempt of a flow slot.`,
      );
    const k = `${r.reviewer}\u0000${r.code}`;
    if (seen.has(k))
      ratingProblems.push(`${r.reviewer}: code ${r.code} rated twice.`);
    seen.add(k);
  }
  const reviewed = [...codeToSlot.entries()].map(([code, v]) => ({
    code,
    ...v,
  }));
  const ratingTable = reviewed
    .map((item) => {
      const slot = slotById.get(item.slot_id);
      const per = reviewers.map((rev) => {
        const row = ratings.find(
          (r) => r.reviewer === rev && r.code === item.code,
        );
        const present = row ? DIMS.filter((d) => row.values[d] !== null) : [];
        return {
          reviewer: rev,
          status: !row
            ? 'absent'
            : present.length === DIMS.length
              ? 'complete'
              : present.length
                ? 'partial'
                : 'blank',
          mean:
            row && present.length === DIMS.length
              ? mean(DIMS.map((d) => row.values[d]!))
              : null,
          values: row?.values ?? null,
        };
      });
      const complete = per.filter((p) => p.mean !== null);
      const dimension_means = Object.fromEntries(
        DIMS.map((d) => [
          d,
          round(
            mean(
              per
                .map((p) => p.values?.[d] ?? null)
                .filter((v): v is number => v !== null),
            ),
          ),
        ]),
      ) as Record<Dim, number | null>;
      return {
        slot_id: item.slot_id,
        attempt_id: item.attempt_id,
        task_key: slot?.task_key ?? null,
        arm: slot?.arm ?? null,
        repeat: slot?.repeat ?? null,
        slot_state: slot?.state ?? null,
        reviewer_status: Object.fromEntries(
          per.map((p) => [p.reviewer, p.status]),
        ),
        complete_reviewers: complete.length,
        quality: round(mean(complete.map((p) => p.mean!))),
        dimension_means,
      };
    })
    .sort((a, b) =>
      `${a.task_key}${a.arm}${a.repeat}` < `${b.task_key}${b.arm}${b.repeat}`
        ? -1
        : 1,
    );
  const quality = new Map(ratingTable.map((r) => [r.slot_id, r.quality]));

  // Functional checks on the last attempt of each implementation slot.
  const checksBy = new Map<string, typeof pkg.functional_checks>();
  for (const c of pkg.functional_checks) {
    const list = checksBy.get(c.attempt_id) ?? [];
    list.push(c);
    checksBy.set(c.attempt_id, list);
  }
  const functionalTable = flow
    .filter((f) => f.stratum === 'implementation')
    .map((f) => {
      const last = primaryAttempt.get(f.slot_id);
      const cs = last ? (checksBy.get(last.attempt_id) ?? []) : [];
      const passed = cs.filter((c) => c.passed).length;
      return {
        slot_id: f.slot_id,
        task_key: f.task_key,
        arm: f.arm,
        slot_state: f.state,
        cases: cs.length,
        passed,
        held_out_cases: cs.filter((c) => c.held_out).length,
        held_out_passed: cs.filter((c) => c.held_out && c.passed).length,
        pass_share: cs.length ? round(passed / cs.length) : null,
        backends: [...new Set(cs.map((c) => c.backend ?? c.executor))].sort(),
        accepted:
          f.state === 'submitted' && cs.length > 0 && passed === cs.length,
      };
    });
  const passShare = new Map(
    functionalTable.map((r) => [r.slot_id, r.pass_share]),
  );

  // Acceptance per slot; decision acceptance needs the owner's threshold.
  const threshold = options.decision_min_mean_rating;
  const accepted = (f: (typeof flow)[number]) => {
    if (f.stratum === 'implementation')
      return functionalTable.find((r) => r.slot_id === f.slot_id)!.accepted;
    if (threshold === null) return null;
    const q = quality.get(f.slot_id) ?? null;
    return f.state === 'submitted' && q !== null && q >= threshold;
  };

  // Group keys: comparison, stratum, arm. Every slot lands in exactly one group.
  const groupKey = (f: (typeof flow)[number]) =>
    `${f.comparison}|${f.stratum}|${f.arm}`;
  const groups = [...new Set(flow.map(groupKey))].sort();
  const inGroup = (g: string) => flow.filter((f) => groupKey(f) === g);
  const head = (g: string) => {
    const [comparison, stratum, arm] = g.split('|');
    return { comparison: comparison!, stratum: stratum!, arm: arm! };
  };

  const completionTable = groups.map((g) => {
    const slots = inGroup(g);
    const at = attempts.filter((a) => groupKey(a.slot) === g);
    const count = (s: string) => slots.filter((f) => f.state === s).length;
    const submitted = count('submitted');
    return {
      ...head(g),
      assigned: slots.length,
      blocked: count('blocked'),
      deferred: count('deferred'),
      missing: count('missing'),
      ran: slots.filter((f) => f.attempts.length).length,
      ...Object.fromEntries(TERMINAL.map((s) => [s, count(s)])),
      attempts: at.length,
      retries: at.filter((a) => a.retry_of !== null).length,
      infrastructure_failures: at.filter(
        (a) => a.classification.class === 'instrumentation',
      ).length,
      completion: `${submitted}/${slots.length}`,
      completion_share: slots.length ? round(submitted / slots.length) : null,
    };
  });

  const resourcesTable = groups.map((g) => {
    const at = attempts.filter((a) => groupKey(a.slot) === g);
    const m = at.map((a) => a.measurements);
    const known = sumBig(m.map((x) => x.known_simulated_spend_nano_usd));
    const unknown = sumBig(m.map((x) => x.unknown_simulated_exposure_nano_usd));
    const inFlight = sumBig(
      m.map((x) => x.in_flight_simulated_exposure_nano_usd),
    );
    const acc = inGroup(g).map(accepted);
    const nAccepted = acc.filter((x) => x === true).length;
    const defined = !acc.includes(null);
    const complete = unknown === 0n && inFlight === 0n;
    return {
      ...head(g),
      attempts: at.length,
      calls: m.reduce((n, x) => n + x.calls, 0),
      provider_retries: m.reduce((n, x) => n + x.retries, 0),
      known_spend_nano_usd: known.toString(),
      known_spend_usd: usd(known),
      unknown_exposure_usd: usd(unknown),
      in_flight_exposure_usd: usd(inFlight),
      billing: complete ? 'complete' : 'incomplete: unknown or in-flight',
      accepted: defined ? nAccepted : null,
      cost_per_accepted_usd:
        !defined || nAccepted === 0 ? null : usd(known / BigInt(nAccepted)),
      cost_per_accepted_note: !defined
        ? 'Undefined: no acceptance rule for this stratum (analysis-options.json).'
        : nAccepted === 0
          ? 'Undefined: zero accepted outcomes. Total known spend stays visible.'
          : complete
            ? 'Known spend over accepted outcomes (floor to 1 nano-USD).'
            : 'Lower bound: some billing is unknown or still in flight.',
    };
  });

  // ADR-0129: measured time from the raw exports, by attempt id (each attempt is in exactly one
  // export; the reconciliation checks that).
  const measuredById = new Map(
    exports.flatMap((e) =>
      e.body.attempts.flatMap((a) =>
        // Review L-2: the autonomous condition carries an untimed block; it is not measured.
        a.measured_effort && a.measured_effort.condition_timed !== false
          ? [[a.id, a.measured_effort] as const]
          : [],
      ),
    ),
  );
  const effortTable = groups.map((g) => {
    const at = attempts.filter((a) => groupKey(a.slot) === g);
    const reported = at.filter(
      (a) => a.measurements.human_active_minutes !== null,
    );
    const measured = at.flatMap((a) => {
      const m = measuredById.get(a.attempt_id);
      return m ? [m] : [];
    });
    const timedSteps = measured.flatMap((m) =>
      m.steps.flatMap((s) => (s.measured ? [s.measured] : [])),
    );
    const ms = (k: 'active_ms' | 'wait_ms' | 'idle_ms' | 'away_ms') =>
      timedSteps.reduce((n, s) => n + s[k], 0);
    const finishTimed = (m: (typeof measured)[number]) =>
      m.steps.some((s) => s.measured?.ended_by === 'finish');
    const timedAttempts = measured.filter((m) =>
      m.steps.some((s) => s.measured !== null),
    );
    const subjects = [...new Set(timedAttempts.map((m) => m.subject))];
    // Null, not 0, when nothing in the group was timed (the autonomous arm, older exports).
    const anyTimed = timedAttempts.length > 0;
    const orNull = (x: number) => (anyTimed ? round(x) : null);
    const walls = inGroup(g)
      .map((f) => primaryAttempt.get(f.slot_id)?.measurements.wall_seconds)
      .filter((w): w is number => typeof w === 'number');
    return {
      ...head(g),
      human_active_minutes: round(
        reported.reduce((n, a) => n + a.measurements.human_active_minutes!, 0),
      ),
      intervention_active_minutes: round(
        at.reduce((n, a) => n + a.measurements.intervention_active_minutes, 0),
      ),
      human_wait_seconds: round(
        at.reduce((n, a) => n + (a.measurements.human_wait_seconds ?? 0), 0) +
          at.reduce((n, a) => n + a.measurements.intervention_wait_seconds, 0),
      ),
      human_time_missing: at.length - reported.length,
      wall_seconds_median: round(median(walls)),
      wall_seconds_min: round(walls.length ? Math.min(...walls) : null),
      wall_seconds_max: round(walls.length ? Math.max(...walls) : null),
      wall_seconds_n: walls.length,
      wall_seconds_missing: inGroup(g).length - walls.length,
      measured_active_minutes: orNull(ms('active_ms') / 60_000),
      measured_studio_wait_seconds: orNull(ms('wait_ms') / 1000),
      measured_on_page_not_editing_minutes: orNull(ms('idle_ms') / 60_000),
      measured_page_not_in_front_minutes: orNull(ms('away_ms') / 60_000),
      measured_steps: timedSteps.length,
      measured_unfinished_steps: measured.reduce(
        (n, m) => n + m.steps.filter((s) => !s.measured).length,
        0,
      ),
      measured_complete_attempts: measured.filter(
        (m) => finishTimed(m) && m.steps.every((s) => s.measured),
      ).length,
      measured_untimed_attempts: at.length - timedAttempts.length,
      measured_subject:
        subjects.length === 0
          ? null
          : subjects.length === 1
            ? subjects[0]!
            : 'mixed',
      source:
        'Human minutes are participant-reported; measured_* come from the Study page timer (study-effort-timer/1) beside them, not the autonomous condition; wall time is server-observed.',
    };
  });

  // Events from the raw exports, attributed to the flow slot of each attempt.
  const attemptSlot = new Map(attempts.map((a) => [a.attempt_id, a.slot]));
  const events = exports.flatMap((e) => e.body.raw_events);
  const interventions = events.filter(
    (e) =>
      e.kind === 'interventions' &&
      e.attempt_id &&
      attemptSlot.has(e.attempt_id),
  );
  const interventionTable = groups
    .map((g) => {
      const list = interventions.filter(
        (e) => groupKey(attemptSlot.get(e.attempt_id!)!) === g,
      );
      const by = (field: string, value: string) =>
        list.filter((e) => e.payload[field] === value).length;
      return {
        ...head(g),
        interventions: list.length,
        clarification: by('type', 'clarification'),
        judgment: by('type', 'judgment'),
        authorization: by('type', 'authorization'),
        feedback: by('type', 'feedback'),
        fixed_gate: by('gate', 'fixed'),
        dynamic_gate: by('gate', 'dynamic'),
        prevented_problem_yes: by('prevented_problem', 'yes'),
        prevented_problem_no: by('prevented_problem', 'no'),
        prevented_problem_unknown: by('prevented_problem', 'unknown'),
        active_minutes: round(
          list.reduce((n, e) => n + Number(e.payload.human_active_minutes), 0),
        ),
      };
    })
    .filter((r) => r.interventions > 0 || r.arm === 'B');

  const evidenceTable = groups
    .map((g) => {
      const audits = pkg.source_support_audits.filter((a) => {
        const s = slotById.get(a.slot_id);
        return s && groupKey(s) === g;
      });
      const sources = audits.flatMap((a) => a.sources);
      return {
        ...head(g),
        audited_attempts: audits.length,
        sources: sources.length,
        verified: sources.filter((s) => s.verified).length,
        unverified: sources.filter((s) => !s.verified).length,
        attempts_with_unverified: audits.filter((a) =>
          a.sources.some((s) => !s.verified),
        ).length,
      };
    })
    .filter((r) => r.audited_attempts > 0);

  // Paired comparisons over tasks.
  const seed = canonicalHash(input.sources);
  const valueOf = (f: (typeof flow)[number]) =>
    f.stratum === 'implementation'
      ? (passShare.get(f.slot_id) ?? null)
      : (quality.get(f.slot_id) ?? null);
  const autonomyTasks = pkg.schedule.tasks.filter((t) => t.role === 'autonomy');
  const pairedTable = (['decision', 'implementation'] as const).flatMap(
    (stratum) => {
      const tasks = autonomyTasks.filter((t) => t.stratum === stratum);
      return PAIRS.map(([x, y]) => {
        const diffs: number[] = [];
        const rows: {
          task_key: string;
          x: number | null;
          y: number | null;
          difference: number | null;
          excluded: string | null;
        }[] = [];
        for (const t of tasks) {
          const fx = flow.find((f) => f.task_key === t.key && f.arm === x);
          const fy = flow.find((f) => f.task_key === t.key && f.arm === y);
          const vx = fx ? valueOf(fx) : null;
          const vy = fy ? valueOf(fy) : null;
          const excluded =
            vx === null || vy === null
              ? [
                  vx === null ? `${x} ${fx?.state ?? 'absent'}, no value` : '',
                  vy === null ? `${y} ${fy?.state ?? 'absent'}, no value` : '',
                ]
                  .filter(Boolean)
                  .join('; ')
              : null;
          const d = excluded ? null : vx! - vy!;
          if (d !== null) diffs.push(d);
          rows.push({
            task_key: t.key,
            x: vx,
            y: vy,
            difference: round(d),
            excluded,
          });
        }
        return {
          stratum,
          outcome:
            stratum === 'decision'
              ? 'mean reviewer quality (1-5)'
              : 'share of frozen cases passed',
          contrast: `${x} - ${y}`,
          tasks: tasks.length,
          ...summarizeDifferences(
            diffs,
            canonicalHash({ seed, stratum, x, y }),
          ),
          rows,
        };
      });
    },
  );

  const themes = pkg.schedule.tasks.filter((t) => t.role === 'discovery');
  const discoveryRows = themes.map((t) => {
    const per = (arm: 'D-structured' | 'D-open') => {
      const slots = flow.filter((f) => f.task_key === t.key && f.arm === arm);
      const vals = slots
        .map((f) => quality.get(f.slot_id) ?? null)
        .filter((v): v is number => v !== null);
      return { mean: mean(vals), used: vals.length, repeats: slots.length };
    };
    const s = per('D-structured');
    const o = per('D-open');
    return {
      task_key: t.key,
      structured_mean: round(s.mean),
      structured_repeats_rated: `${s.used}/${s.repeats}`,
      open_mean: round(o.mean),
      open_repeats_rated: `${o.used}/${o.repeats}`,
      difference_open_minus_structured:
        s.mean === null || o.mean === null ? null : round(o.mean - s.mean),
    };
  });
  const discoveryDiffs = discoveryRows
    .map((r) => r.difference_open_minus_structured)
    .filter((d): d is number => d !== null);
  const discoveryTable = {
    contrast: 'D-open - D-structured (theme means over repeats)',
    themes: themes.length,
    ...summarizeDifferences(
      discoveryDiffs,
      canonicalHash({ seed, discovery: true }),
    ),
    rows: discoveryRows,
  };

  // Agreement between exactly two reviewers.
  const agreement =
    reviewers.length === 2
      ? {
          reviewers: reviewers.length,
          dimensions: DIMS.map((d) => {
            const pairs: [number, number][] = [];
            for (const item of reviewed) {
              const a = ratings.find(
                (r) => r.reviewer === reviewers[0] && r.code === item.code,
              )?.values[d];
              const b = ratings.find(
                (r) => r.reviewer === reviewers[1] && r.code === item.code,
              )?.values[d];
              if (a != null && b != null) pairs.push([a, b]);
            }
            return {
              dimension: d,
              items_rated_by_both: pairs.length,
              weighted_kappa: weightedKappa(pairs),
              kappa_note:
                pairs.length === 0
                  ? 'No item rated by both reviewers.'
                  : weightedKappa(pairs) === null
                    ? 'Undefined: no variation in the ratings.'
                    : 'Quadratic weights, 1-5 scale.',
            };
          }),
          disagreements: reviewed.flatMap((item) =>
            DIMS.flatMap((d) => {
              const a = ratings.find(
                (r) => r.reviewer === reviewers[0] && r.code === item.code,
              )?.values[d];
              const b = ratings.find(
                (r) => r.reviewer === reviewers[1] && r.code === item.code,
              )?.values[d];
              return a != null && b != null && Math.abs(a - b) >= 2
                ? [
                    {
                      slot_id: item.slot_id,
                      task_key: slotById.get(item.slot_id)?.task_key ?? null,
                      arm: slotById.get(item.slot_id)?.arm ?? null,
                      dimension: d,
                      [reviewers[0]!]: a,
                      [reviewers[1]!]: b,
                    },
                  ]
                : [];
            }),
          ),
        }
      : {
          reviewers: reviewers.length,
          dimensions: [],
          disagreements: [],
          note: `Agreement needs exactly two reviewers' ratings; ${reviewers.length} supplied.`,
        };

  const deviations = [
    ...events
      .filter((e) => e.kind === 'deviations')
      .map((e) => {
        const s = e.attempt_id ? attemptSlot.get(e.attempt_id) : undefined;
        return {
          source: 'recorded deviation',
          slot_id: s?.slot_id ?? null,
          task_key: s?.task_key ?? null,
          arm: s?.arm ?? null,
          reason: String(e.payload.reason),
          impact: String(e.payload.impact),
        };
      }),
    ...flow
      .filter((f) => f.state === 'blocked' || f.state === 'deferred')
      .map((f) => ({
        source: `slot ${f.state}`,
        slot_id: f.slot_id,
        task_key: f.task_key,
        arm: f.arm,
        reason: f.reasons.join(' '),
        impact: 'No outcome; kept in the assigned denominator.',
      })),
  ];

  // Exploratory: completion among slots that ran (per-protocol), never the primary table.
  const perProtocol = groups.map((g) => {
    const ran = inGroup(g).filter(
      (f) =>
        f.attempts.length &&
        !f.attempts.every((a) => a.classification.class === 'instrumentation'),
    );
    const submitted = ran.filter((f) => f.state === 'submitted').length;
    return {
      ...head(g),
      ran_without_only_infrastructure_failure: ran.length,
      submitted,
      completion: `${submitted}/${ran.length}`,
    };
  });

  // Reconciliation: each attempt counted once, totals equal across independent sums.
  const exportAttempts = exports.flatMap((e) =>
    e.body.attempts.map((a) => ({ ...a, export: e.key })),
  );
  const exportCount = new Map<string, number>();
  for (const a of exportAttempts)
    exportCount.set(a.id, (exportCount.get(a.id) ?? 0) + 1);
  const flowIds = attempts.map((a) => a.attempt_id);
  const unscheduled = exportAttempts.filter((a) => !attemptSlot.has(a.id));
  const spendFields = [
    'known_simulated_spend_nano_usd',
    'unknown_simulated_exposure_nano_usd',
    'in_flight_simulated_exposure_nano_usd',
  ] as const;
  const mismatched = attempts.filter((a) => {
    const e = exportAttempts.find((x) => x.id === a.attempt_id);
    return (
      !e ||
      spendFields.some((k) => e.measurements[k] !== a.measurements[k]) ||
      e.measurements.calls !== a.measurements.calls
    );
  });
  const grandFlow = sumBig(
    attempts.map((a) => a.measurements.known_simulated_spend_nano_usd),
  );
  const grandExport = sumBig(
    exportAttempts.map((a) => a.measurements.known_simulated_spend_nano_usd),
  );
  const grandUnscheduled = sumBig(
    unscheduled.map((a) => a.measurements.known_simulated_spend_nano_usd),
  );
  const grandTable = sumBig(resourcesTable.map((r) => r.known_spend_nano_usd));
  const participants = new Set(
    exportAttempts
      .filter((a) => attemptSlot.get(a.id)?.condition !== 'autonomous')
      .map((a) => a.participant_actor_id),
  ).size;
  const scheduleIds = new Set(pkg.schedule.slots.map((s) => s.slot_id));

  const totals = {
    assigned_slots: flow.length,
    attempts: attempts.length,
    unscheduled_attempts: unscheduled.length,
    known_spend_usd: usd(grandExport),
    known_spend_unscheduled_usd: usd(grandUnscheduled),
    unknown_exposure_usd: usd(
      sumBig(
        exportAttempts.map(
          (a) => a.measurements.unknown_simulated_exposure_nano_usd,
        ),
      ),
    ),
    in_flight_exposure_usd: usd(
      sumBig(
        exportAttempts.map(
          (a) => a.measurements.in_flight_simulated_exposure_nano_usd,
        ),
      ),
    ),
    accepted: {
      implementation: functionalTable.filter((r) => r.accepted).length,
      decision:
        threshold === null
          ? null
          : flow.filter((f) => f.stratum === 'decision' && accepted(f)).length,
    },
    distinct_human_participants: participants,
    reviewers: reviewers.length,
  };

  const reconciliation = [
    check(
      'slots.match_schedule',
      flow.length === scheduleIds.size &&
        flow.every((f) => scheduleIds.has(f.slot_id)) &&
        new Set(flow.map((f) => f.slot_id)).size === flow.length,
      `${flow.length} flow rows for ${scheduleIds.size} scheduled slots, each once.`,
    ),
    check(
      'slots.groups_partition',
      completionTable.reduce((n, r) => n + r.assigned, 0) === flow.length,
      'Every slot is counted in exactly one comparison/stratum/arm group.',
    ),
    check(
      'attempts.unique',
      new Set(flowIds).size === flowIds.length,
      `${flowIds.length} attempts in the flow, none in two slots.`,
    ),
    check(
      'attempts.in_one_export',
      flowIds.every((id) => exportCount.get(id) === 1) &&
        [...exportCount.values()].every((n) => n === 1),
      'Every flow attempt appears in exactly one raw export, once.',
    ),
    check(
      'attempts.measurements_match_export',
      mismatched.length === 0,
      mismatched.length
        ? `Flow and export disagree for ${mismatched.map((a) => a.attempt_id).join(', ')}.`
        : 'Flow measurements equal the raw export for every attempt (spend, exposure, calls).',
    ),
    check(
      'spend.totals_reconcile',
      grandTable === grandFlow && grandFlow + grandUnscheduled === grandExport,
      `Group sum ${usd(grandTable)} = flow sum ${usd(grandFlow)}; plus unscheduled ${usd(grandUnscheduled)} = export sum ${usd(grandExport)} USD.`,
    ),
    check(
      'ratings.codes_valid',
      ratingProblems.length === 0,
      ratingProblems.length
        ? ratingProblems.join(' ')
        : `${ratings.length} rating rows from ${reviewers.length} reviewer(s), each code known, mapped to a slot's last attempt and rated once per reviewer.`,
    ),
    check(
      'functional.bound_to_flow',
      pkg.functional_checks.every(
        (c) => attemptSlot.get(c.attempt_id)?.slot_id === c.slot_id,
      ),
      `${pkg.functional_checks.length} functional checks each bind an attempt of their slot.`,
    ),
    check(
      'export.kind_consistent',
      !(pkg.mode === 'final' && syntheticExports > 0),
      pkg.mode === 'final' && syntheticExports > 0
        ? 'A final package includes synthetic exports.'
        : `${exports.length} export(s), ${syntheticExports} synthetic; data kind ${dataKind}.`,
    ),
  ];

  const missingRatings = ratingTable.filter(
    (r) => r.complete_reviewers < reviewers.length,
  );
  const gaps = [
    ...(empirical
      ? []
      : [`Not empirical (${dataKind}): no table here is a study finding.`]),
    ...(reviewers.length === 0
      ? [
          'No reviewer ratings supplied: decision quality is missing for every slot.',
        ]
      : []),
    ...(missingRatings.length
      ? [
          `${missingRatings.length} reviewed item(s) lack complete ratings from every reviewer; no rating is imputed.`,
        ]
      : []),
    ...(threshold === null
      ? [
          'No decision acceptance rule: cost per accepted decision outcome is undefined.',
        ]
      : []),
    ...(totals.unknown_exposure_usd !== usd(0n) ||
    totals.in_flight_exposure_usd !== usd(0n)
      ? ['Some billing is unknown or in flight: spend totals are lower bounds.']
      : []),
    ...(flow.some((f) => f.state === 'blocked')
      ? [
          `${flow.filter((f) => f.state === 'blocked').length} slot(s) blocked; they stay in the assigned denominators.`,
        ]
      : []),
    'Potential benefit and observed user impact are not measured by the current study contracts; they are reported as not measured, never inferred from quality ratings.',
    'Intervention necessity (necessary, missed, unnecessary) needs owner coding that the current contracts do not record; only the recorded intervention fields are summarised.',
  ];
  const limitations = [
    ...(participants <= 1
      ? [
          `${participants} distinct human participant: human-arm results describe one person's repeated work, not human work in general, and repeated observations from that person are not independent.`,
        ]
      : []),
    `${autonomyTasks.length} autonomy task(s) and ${themes.length} discovery theme(s): no power calculation and no general comparative claim.`,
    'One provider model serves every AI role, so its errors may be correlated across arms.',
    'Ideas inside one run are rated together as one item and are not counted as separate observations.',
  ];

  const body = {
    schema_version: ANALYSIS_VERSION,
    analysis_version: ANALYSIS_VERSION,
    data_kind: dataKind,
    empirical,
    label,
    fixture,
    plan: ANALYSIS_PLAN,
    options,
    inputs: {
      package_hash: pkg.package_hash,
      schedule_hash: pkg.schedule.schedule_hash,
      freeze: pkg.freeze,
      mode: pkg.mode,
      files: input.sources,
    },
    totals,
    prespecified: {
      completion: completionTable,
      decision_quality: ratingTable,
      functional_completion: functionalTable,
      paired_comparisons: pairedTable,
      discovery_comparison: discoveryTable,
      resources: resourcesTable,
      human_effort_and_latency: effortTable,
      interventions: interventionTable,
      evidence_validity: evidenceTable,
      reviewer_agreement: agreement,
    },
    exploratory: { per_protocol_completion: perProtocol },
    not_measured: {
      potential_benefit: 'not measured by the current study contracts',
      observed_user_impact: 'not measured by the current study contracts',
    },
    deviations,
    gaps,
    limitations,
    reconciliation,
  };
  const privacy = privacyScan(body, exportAttempts, key);
  const result = { ...body, reconciliation: [...reconciliation, privacy] };
  return { ...result, analysis_hash: canonicalHash(result) };
}
export type Analysis = ReturnType<typeof analyze>;

/** Participant codes, actor ids, familiarity notes and the blinding secret never leave private/. */
function privacyScan(
  body: unknown,
  exportAttempts: {
    participant_actor_id: string;
    participant_code: string;
    prior_familiarity?: string | undefined;
  }[],
  key: Record<string, unknown>,
) {
  const text = JSON.stringify(body);
  const secret = typeof key.secret === 'string' ? [key.secret] : [];
  const tokens = [
    ...new Set([
      ...exportAttempts.flatMap((a) => [
        a.participant_actor_id,
        a.participant_code,
        ...(a.prior_familiarity ? [a.prior_familiarity] : []),
      ]),
      ...secret,
    ]),
  ].filter((t) => t.length >= 4);
  const leaked = tokens.filter((t) => text.includes(t));
  return check(
    'privacy.no_participant_metadata',
    leaked.length === 0,
    leaked.length
      ? `${leaked.length} private value(s) appear in the analysis output.`
      : `None of ${tokens.length} private participant or key values appears in the output.`,
  );
}

/** Words that would turn a table into a comparative or inferential claim. */
export const CLAIM_WORDS =
  /\b(significant(ly)?|superior(ity)?|outperform(s|ed)?|statistical power|proves?|better than|worse than)\b/i;
