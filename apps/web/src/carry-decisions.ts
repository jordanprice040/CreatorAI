// Keep a recorded decision when the report changes (owner pilot, Oct 30: "a changed score
// invalidates the whole Compare and decide decision"). The latest selection's dispositions
// are carried into the form for the current report, and only the options whose own inputs
// changed (version, scores, gates) are flagged for review. Pure and import-free, so it can
// be tested without a browser. The server still binds every selection to the exact report
// hash it was made on and re-checks gates and overrides; this only fills the form.

/** The parts of a ranked candidate (contracts RankedCandidate) this module compares. */
export interface CarryScore {
  numerator: string;
  denominator: string;
  display: string;
}
export interface CarryCandidate {
  alternative: { id: string; version: number };
  status: string;
  score: CarryScore | null;
  range: { lower: CarryScore; upper: CarryScore } | null;
  rank: number | null;
  gates: {
    ethics_access: string;
    humility: string;
    blocked: Partial<Record<string, string[]>>;
  };
}
export interface CarryRanking {
  candidates: CarryCandidate[];
}
export interface CarryReport {
  problem: { id: string; version: number };
  opportunity: CarryRanking;
  suitability: CarryRanking;
  report_hash: string;
}
export interface CarryDisposition {
  alternative: { id: string; version: number };
  disposition: string;
  reasons: string[];
  reverse_if: string;
}
export interface CarrySelection {
  id: string;
  report: CarryReport;
  dispositions: CarryDisposition[];
  rationale: string;
  override_reason: string | null;
}

export interface CarriedRow {
  disposition: string;
  reasons: string;
  reverse_if: string;
}
/**
 * kept: nothing about this option changed, the earlier decision stands as filled in.
 * changed: its version, scores or gates changed; the decision is filled in but needs review.
 * blocked: the earlier disposition is now blocked by a gate, so it was cleared.
 * new: the option was not part of the earlier decision.
 */
export type CarryStatus = 'kept' | 'changed' | 'blocked' | 'new';
export interface CarriedOption {
  status: CarryStatus;
  row: CarriedRow;
  /** What changed for this option, in words, for the review flag. */
  changes: string[];
  /** Changes that are informational only, such as a rank moved by another option. */
  notes: string[];
}
export interface Carried {
  /** The selection the decisions came from, or null when there is none. */
  from: string | null;
  /** True when the report is exactly the one the decision was made on. */
  same_report: boolean;
  problem_version_changed: boolean;
  options: Record<string, CarriedOption>;
  rationale: string;
  override_reason: string;
  /** Options whose earlier decision no longer applies (removed from the problem). */
  dropped: number;
}

const BLANK: CarriedRow = { disposition: '', reasons: '', reverse_if: '' };
const words = (s: string) => s.replaceAll('_', ' ');
const scoreText = (c: CarryCandidate) =>
  c.score
    ? c.score.display
    : c.range
      ? `${words(c.status)} (${c.range.lower.display}–${c.range.upper.display})`
      : words(c.status);
const sameScore = (a: CarryScore | null, b: CarryScore | null) =>
  a === b ||
  (!!a &&
    !!b &&
    // Exact fractions: compare cross-multiplied, so 2/4 equals 1/2.
    BigInt(a.numerator) * BigInt(b.denominator) ===
      BigInt(b.numerator) * BigInt(a.denominator));
const sameRange = (a: CarryCandidate['range'], b: CarryCandidate['range']) =>
  a === b ||
  (!!a && !!b && sameScore(a.lower, b.lower) && sameScore(a.upper, b.upper));

function index(r: CarryRanking) {
  return new Map(r.candidates.map((c) => [c.alternative.id.toLowerCase(), c]));
}

/** Compare one ranking's entry for an option: score changes flag, rank moves are notes. */
function compareRanking(
  label: string,
  before: CarryCandidate | undefined,
  after: CarryCandidate | undefined,
  changes: string[],
  notes: string[],
) {
  if (!before && !after) return;
  if (!before || !after) {
    changes.push(
      after
        ? `${label}: now ranked (${scoreText(after)})`
        : `${label}: no longer ranked`,
    );
    return;
  }
  if (
    before.status !== after.status ||
    !sameScore(before.score, after.score) ||
    !sameRange(before.range, after.range)
  )
    changes.push(`${label} ${scoreText(before)} → ${scoreText(after)}`);
  else if (before.rank !== after.rank)
    notes.push(
      `${label} rank ${before.rank ?? 'none'} → ${after.rank ?? 'none'} (other options moved)`,
    );
}

/**
 * Carry the latest selection into a form for `report`. `alternatives` lists the options the
 * form shows (id and current version). With no earlier selection, every option is new.
 */
export function carryDecisions(
  previous: CarrySelection | null,
  report: CarryReport,
  alternatives: { id: string; version: number }[],
): Carried {
  const options: Record<string, CarriedOption> = {};
  if (!previous) {
    for (const a of alternatives)
      options[a.id] = { status: 'new', row: BLANK, changes: [], notes: [] };
    return {
      from: null,
      same_report: false,
      problem_version_changed: false,
      options,
      rationale: '',
      override_reason: '',
      dropped: 0,
    };
  }
  const same = previous.report.report_hash === report.report_hash;
  const was = new Map(
    previous.dispositions.map((d) => [d.alternative.id.toLowerCase(), d]),
  );
  const oldSuit = index(previous.report.suitability);
  const oldOpp = index(previous.report.opportunity);
  const newSuit = index(report.suitability);
  const newOpp = index(report.opportunity);
  const shown = new Set<string>();
  for (const a of alternatives) {
    const key = a.id.toLowerCase();
    shown.add(key);
    const d = was.get(key);
    if (!d) {
      options[a.id] = {
        status: 'new',
        row: BLANK,
        changes: ['New option since your last decision'],
        notes: [],
      };
      continue;
    }
    const row: CarriedRow = {
      disposition: d.disposition,
      reasons: d.reasons.join(' '),
      reverse_if: d.reverse_if,
    };
    const changes: string[] = [];
    const notes: string[] = [];
    if (!same) {
      if (d.alternative.version !== a.version)
        changes.push(
          `Option revised: version ${d.alternative.version} → ${a.version}`,
        );
      compareRanking(
        'Suitability',
        oldSuit.get(key),
        newSuit.get(key),
        changes,
        notes,
      );
      compareRanking(
        'Software opportunity',
        oldOpp.get(key),
        newOpp.get(key),
        changes,
        notes,
      );
      const before = oldSuit.get(key)?.gates;
      const after = newSuit.get(key)?.gates;
      if (before && after) {
        if (before.ethics_access !== after.ethics_access)
          changes.push(
            `Ethics and access ${words(before.ethics_access)} → ${words(after.ethics_access)}`,
          );
        if (before.humility !== after.humility)
          changes.push(
            `Humility review ${words(before.humility)} → ${words(after.humility)}`,
          );
      }
    }
    const blockedNow = newSuit.get(key)?.gates.blocked[d.disposition] ?? [];
    if (blockedNow.length) {
      options[a.id] = {
        status: 'blocked',
        // The reasons stay as a starting point; only the blocked choice is cleared.
        row: { ...row, disposition: '' },
        changes: [
          ...changes,
          `“${words(d.disposition)}” is now blocked: ${blockedNow[0]}`,
        ],
        notes,
      };
      continue;
    }
    options[a.id] = {
      status: changes.length ? 'changed' : 'kept',
      row,
      changes,
      notes,
    };
  }
  return {
    from: previous.id,
    same_report: same,
    problem_version_changed:
      previous.report.problem.version !== report.problem.version,
    options,
    rationale: previous.rationale,
    override_reason: previous.override_reason ?? '',
    dropped: [...was.keys()].filter((k) => !shown.has(k)).length,
  };
}

/** Options that need the owner to look again before the decision can be recorded. */
export function needsReview(c: Carried): string[] {
  return Object.entries(c.options)
    .filter(([, o]) => o.status === 'changed' || o.status === 'blocked')
    .map(([id]) => id);
}
