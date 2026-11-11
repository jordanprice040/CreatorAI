import {
  RUBRICS,
  ScorecardBodySchema,
  kindAllows,
  type ExactScore,
  type RankedCandidate,
  type RubricDefinition,
  type RubricId,
  type RubricRanking,
  type ScorecardBody,
  type SelectRequest,
  type SelectionDisposition,
  type SelectionReport,
  type SpecContent,
  type SpecProblem,
} from '@creator/contracts';
import { canonicalHash } from './rules.js';

// T08 deterministic scoring and selection checks (context/SCORING_RUBRIC.md). Pure functions:
// the store gathers records, these compute, and the same inputs give the same report hash.

// ---- Exact arithmetic -------------------------------------------------------------------

interface Rational {
  n: bigint;
  d: bigint;
}
const gcd = (a: bigint, b: bigint): bigint => {
  a = a < 0n ? -a : a;
  while (b) [a, b] = [b, a % b];
  return a || 1n;
};
const rat = (n: bigint, d: bigint): Rational => {
  if (d < 0n) [n, d] = [-n, -d];
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
};
const add = (a: Rational, b: Rational) => rat(a.n * b.d + b.n * a.d, a.d * b.d);
const cmp = (a: Rational, b: Rational) => {
  const l = a.n * b.d;
  const r = b.n * a.d;
  return l < r ? -1 : l > r ? 1 : 0;
};
const mean = (xs: Rational[]) => {
  const sum = xs.reduce((s, x) => add(s, x), rat(0n, 1n));
  return rat(sum.n, sum.d * BigInt(xs.length));
};
/** One decimal, half up; the unrounded rational is kept beside it for ranking. */
export function displayScore(r: { n: bigint; d: bigint }): string {
  const tenths = (r.n * 20n + r.d) / (2n * r.d);
  return `${tenths / 10n}.${tenths % 10n}`;
}
const exact = (r: Rational): ExactScore => ({
  numerator: r.n.toString(),
  denominator: r.d.toString(),
  display: displayScore(r),
});
export const fromExact = (s: ExactScore): Rational =>
  rat(BigInt(s.numerator), BigInt(s.denominator));

export const rubricHash = (r: RubricDefinition) => canonicalHash(r);

/**
 * score = 100 × Σ wᵢ(ratingᵢ − 1) / (4 Σ w). Unknowns are substituted only when `fill` is
 * given (1 for the lower bound, 5 for the upper); otherwise an unknown gives no score.
 */
export function scoreRatings(
  rubric: RubricDefinition,
  ratings: Record<string, number | null>,
  weights: Readonly<Record<string, number>> = rubric.weights,
  fill?: 1 | 5,
): Rational | null {
  let sum = 0n;
  let total = 0n;
  for (const c of rubric.criteria) {
    const w = BigInt(weights[c.key] ?? 0);
    const r = ratings[c.key] ?? fill ?? null;
    if (r === null) return null;
    sum += w * BigInt(r - 1);
    total += w;
  }
  if (total === 0n) return null;
  return rat(100n * sum, 4n * total);
}

// ---- Ranking ----------------------------------------------------------------------------

export interface ScorecardInput {
  id: string;
  version: number;
  status: string;
  body: unknown;
}
export type HumilityState =
  'passing' | 'failing' | 'needs_judgment' | 'missing' | 'not_applicable';
export interface CandidateInput {
  alternative: { id: string; version: number; kind: string; title: string };
  scorecards: readonly ScorecardInput[];
  /** The T07 disposition of the proposal this alternative came from, when it did. */
  discovery: string | null;
  humility: HumilityState;
  humility_reasons: readonly string[];
}
const SOFTWARE_KINDS = ['build', 'hybrid'];
const HARD_DISCOVERY_BLOCKS = [
  'duplicate',
  'rejected',
  'failed',
  'insufficient_evidence',
  'unreviewed',
];

interface Parsed {
  input: ScorecardInput;
  body: ScorecardBody | null;
  /** The first reason it is stale, or null when it rates current versions. */
  stale: string | null;
  stale_reasons: string[];
  /** Written by an automatic assessment (ADR-0074). */
  system: boolean;
  /** The current person's card that replaces this system card; it is then not counted. */
  superseded_by: string | null;
}
/** Current versions of the records scorecards cite or read, as the store finds them now. */
export type EvidenceVersions = Readonly<
  Record<
    string,
    { version: number; status: string; support_hash: string | null }
  >
>;
interface ParseEnv {
  problem: { id: string; version: number };
  evidence?: EvidenceVersions | undefined;
  /** The current hash of the claims linked to the problem (review M-1). */
  linked_hash?: string | undefined;
}
const shortId = (id: string) => id.slice(0, 8);
/** Why a card no longer rates what is current: option, cited evidence, problem, rubric, packet. */
function staleReasons(
  c: CandidateInput,
  body: ScorecardBody,
  env: ParseEnv,
): string[] {
  const out: string[] = [];
  if (body.subject.id !== c.alternative.id)
    out.push('Rates a different record.');
  else if (body.subject.version !== c.alternative.version)
    out.push(
      `Rates version ${body.subject.version}; the alternative is now version ${c.alternative.version}.`,
    );
  const ev = env.evidence;
  if (ev) {
    const refs = new Map<string, number>();
    for (const r of Object.values(body.ratings))
      for (const e of r.evidence_refs) refs.set(e.id.toLowerCase(), e.version);
    for (const [id, v] of [...refs].sort()) {
      const cur = ev[id];
      if (!cur || cur.status !== 'active')
        out.push(
          `Cited evidence ${shortId(id)} is ${cur ? cur.status : 'no longer in this workspace'}.`,
        );
      else if (cur.version !== v)
        out.push(
          `Cites evidence ${shortId(id)} version ${v}; it is now version ${cur.version}.`,
        );
    }
  }
  const a = body.assessment;
  if (a) {
    if (
      a.problem.id.toLowerCase() !== env.problem.id.toLowerCase() ||
      a.problem.version !== env.problem.version
    )
      out.push(
        `Assessed the problem at version ${a.problem.version}; it is now version ${env.problem.version}.`,
      );
    if (a.rubric_hash !== rubricHash(RUBRICS[body.rubric]))
      out.push('The rubric changed since this assessment.');
    if (env.linked_hash !== undefined && env.linked_hash !== a.linked_hash)
      out.push(
        'Evidence linked to the problem changed since this assessment (a claim was linked or unlinked).',
      );
    if (ev)
      for (const e of a.evidence) {
        const cur = ev[e.id.toLowerCase()];
        if (!cur || cur.status !== 'active')
          out.push(
            `Claim ${shortId(e.id)} it read is ${cur ? cur.status : 'no longer in this workspace'}.`,
          );
        else if (cur.version !== e.version)
          out.push(
            `Claim ${shortId(e.id)} it read changed (version ${e.version} → ${cur.version}).`,
          );
        else if (
          cur.support_hash !== null &&
          cur.support_hash !== e.support_hash
        )
          out.push(
            `The evidence for claim ${shortId(e.id)} changed since it was read (support added or retracted).`,
          );
      }
  }
  return [...new Set(out)];
}
function parseCards(c: CandidateInput, env: ParseEnv): Parsed[] {
  const cards: Parsed[] = c.scorecards
    .filter((s) => s.status === 'active')
    .map((s) => {
      const parsed = ScorecardBodySchema.safeParse(s.body);
      if (!parsed.success)
        return {
          input: s,
          body: null,
          stale: 'Not valid under the current rubric version.',
          stale_reasons: ['Not valid under the current rubric version.'],
          system: false,
          superseded_by: null,
        };
      const body = parsed.data;
      const reasons = staleReasons(c, body, env);
      return {
        input: s,
        body,
        stale: reasons[0] ?? null,
        stale_reasons: reasons,
        system: !!body.assessment,
        superseded_by: null,
      };
    });
  // A person's current edit replaces the system card it names (ADR-0074). If two people's
  // edits name the same card, the label shows the first by id; both count either way.
  for (const p of [...cards].sort((a, b) =>
    a.input.id < b.input.id ? -1 : 1,
  )) {
    const of = p.body?.edit_of?.scorecard.id.toLowerCase();
    if (!of || p.stale || p.body?.rubric === undefined) continue;
    const target = cards.find(
      (x) =>
        x.system &&
        x.input.id.toLowerCase() === of &&
        x.body?.rubric === p.body!.rubric,
    );
    if (target && !target.superseded_by) target.superseded_by = p.input.id;
  }
  return cards;
}
/** Cards that count: valid, current and not replaced by a person's edit. */
const counted = (p: Parsed) => !!p.body && !p.stale && !p.superseded_by;
const ratingsOf = (b: ScorecardBody) =>
  Object.fromEntries(Object.entries(b.ratings).map(([k, v]) => [k, v.rating]));

function gatesFor(c: CandidateInput, cards: Parsed[], opportunity: string) {
  const current = cards.filter(counted);
  // ADR-0074: a system assessment can raise an ethics or access concern but never clear one.
  const people = current.filter((p) => !p.system);
  const ethics = current.some(
    (p) =>
      p.body!.gates.ethics.status === 'unresolved' ||
      p.body!.gates.access.status === 'unresolved',
  )
    ? ('unresolved' as const)
    : people.length === 0
      ? ('not_assessed' as const)
      : ('clear' as const);
  const ethicsReason =
    ethics === 'unresolved'
      ? 'An ethics or access question is unresolved; it is a gate, not a score.'
      : ethics === 'not_assessed'
        ? current.length
          ? 'Only the automatic assessment looked at ethics and access; a person must confirm them (edit the assessment or score the option).'
          : 'Ethics and access have not been assessed on the current version.'
        : null;
  const blocked: Partial<Record<SelectionDisposition, string[]>> = {};
  const block = (d: SelectionDisposition, reason: string | null) => {
    if (reason) (blocked[d] ??= []).push(reason);
  };
  const kind = c.alternative.kind;
  const disc = c.discovery;
  const discReason =
    disc && disc !== 'candidate'
      ? `Discovery disposition: ${disc.replaceAll('_', ' ')}.`
      : null;
  // select_for_build
  block(
    'select_for_build',
    kindAllows(kind, 'select_for_build')
      ? null
      : `A ${kind.replaceAll('_', ' ')} response has no software to build; it cannot be made build-ready.`,
  );
  block('select_for_build', ethicsReason);
  block('select_for_build', discReason);
  if (SOFTWARE_KINDS.includes(kind) && opportunity !== 'complete')
    block(
      'select_for_build',
      `The opportunity assessment is ${opportunity}; unknown is not a neutral score.`,
    );
  if (SOFTWARE_KINDS.includes(kind) && c.humility !== 'passing')
    block(
      'select_for_build',
      c.humility === 'missing'
        ? 'No humility review of this exact version.'
        : c.humility === 'needs_judgment'
          ? 'The humility review has an unresolved serious ethical problem.'
          : `The humility review does not pass: ${c.humility_reasons.join(' ')}`.slice(
              0,
              300,
            ),
    );
  // recommend_alternative
  block(
    'recommend_alternative',
    kindAllows(kind, 'recommend_alternative')
      ? null
      : kind === 'build'
        ? 'Custom software is selected for build or validation, not recommended as an alternative.'
        : `A ${kind.replaceAll('_', ' ')} outcome is not a response to recommend.`,
  );
  block('recommend_alternative', ethicsReason);
  block('recommend_alternative', discReason);
  // proceed_to_validation
  block(
    'proceed_to_validation',
    kindAllows(kind, 'proceed_to_validation')
      ? null
      : 'A failed outcome cannot be validated.',
  );
  block('proceed_to_validation', ethicsReason);
  block(
    'proceed_to_validation',
    disc && HARD_DISCOVERY_BLOCKS.includes(disc) ? discReason : null,
  );
  return {
    ethics_access: ethics,
    discovery: disc,
    humility: c.humility,
    blocked,
  };
}

interface Scored {
  id: string;
  cards: ScorecardBody[];
  score: Rational | null;
}
function scoreUnder(
  rubric: RubricDefinition,
  s: Scored,
  weights: Readonly<Record<string, number>>,
): Rational | null {
  const scores = s.cards.map((b) =>
    scoreRatings(rubric, ratingsOf(b), weights),
  );
  if (scores.length === 0 || scores.some((x) => x === null)) return null;
  return mean(scores as Rational[]);
}
const order = (xs: { id: string; score: Rational }[]) =>
  [...xs].sort((a, b) => cmp(b.score, a.score) || (a.id < b.id ? -1 : 1));
/** Top `n`, extended to everyone tied with the n-th: a tie at the boundary is not broken. */
function shortlist(xs: { id: string; score: Rational }[], n: number) {
  const sorted = order(xs);
  const edge = sorted[Math.min(n, sorted.length) - 1];
  if (!edge) return [];
  return sorted.filter((x) => cmp(x.score, edge.score) >= 0).map((x) => x.id);
}
function sensitivity(
  rubric: RubricDefinition,
  scored: Scored[],
  n: number,
): RubricRanking['sensitivity'] {
  const complete = scored.filter((s) => s.score !== null);
  const run = (weights: Readonly<Record<string, number>>) =>
    complete.map((s) => ({ id: s.id, score: scoreUnder(rubric, s, weights)! }));
  const base = run(rubric.weights);
  const baseList = shortlist(base, n);
  const top = (xs: { id: string; score: Rational }[]) => shortlist(xs, 1);
  const baseTop = top(base);
  const same = (a: string[], b: string[]) =>
    a.length === b.length && [...a].sort().join() === [...b].sort().join();
  const scenarios = rubric.criteria.flatMap((c) =>
    (
      [
        [`without ${c.key}`, 0],
        [`double ${c.key}`, 2],
      ] as const
    ).map(([name, w]) => {
      const weights = { ...rubric.weights, [c.key]: w };
      const xs = run(weights);
      const list = shortlist(xs, n);
      return {
        name,
        weights,
        ranking: order(xs).map((x) => ({
          id: x.id,
          display: displayScore(x.score),
        })),
        shortlist: list,
        shortlist_changed: !same(list, baseList),
        top_changed: !same(top(xs), baseTop),
      };
    }),
  );
  return {
    shortlist_size: n,
    baseline: baseList,
    scenarios,
    stable: scenarios.every((s) => !s.shortlist_changed),
    note: 'Each criterion removed or doubled in turn, others unchanged. Only fully scored candidates are ranked; incomplete ones keep their labeled bounds.',
  };
}

function rankUnder(
  rubricId: RubricId,
  candidates: readonly CandidateInput[],
  parsed: Map<string, Parsed[]>,
  opportunityStatus: Map<string, string>,
  n: number,
): RubricRanking {
  const rubric = RUBRICS[rubricId];
  const eligible = candidates.filter(
    (c) =>
      rubricId === 'suitability' || SOFTWARE_KINDS.includes(c.alternative.kind),
  );
  const excluded = candidates
    .filter((c) => !eligible.includes(c))
    .map((c) => ({
      id: c.alternative.id,
      reason:
        'No software part: the software-opportunity ranking does not apply; see the suitability ranking.',
    }));
  const scored: (Scored & {
    c: CandidateInput;
    all: Parsed[];
    lower: Rational | null;
    upper: Rational | null;
  })[] = eligible.map((c) => {
    const all = (parsed.get(c.alternative.id) ?? []).filter(
      (p) => !p.body || p.body.rubric === rubricId,
    );
    const cards = all.filter(counted).map((p) => p.body!);
    const scores = cards.map((b) => scoreRatings(rubric, ratingsOf(b)));
    const lowers = cards.map((b) =>
      scoreRatings(rubric, ratingsOf(b), undefined, 1)!,
    );
    const uppers = cards.map((b) =>
      scoreRatings(rubric, ratingsOf(b), undefined, 5)!,
    );
    const pick = (xs: Rational[], dir: 1 | -1) =>
      xs.length ? xs.reduce((a, b) => (cmp(a, b) * dir >= 0 ? a : b)) : null;
    return {
      id: c.alternative.id,
      c,
      all,
      cards,
      score:
        cards.length && scores.every((x) => x !== null)
          ? mean(scores as Rational[])
          : null,
      lower: pick(lowers, -1),
      upper: pick(uppers, 1),
    };
  });
  const ranked = order(
    scored.flatMap((s) => (s.score ? [{ id: s.id, score: s.score }] : [])),
  );
  const rankOf = new Map<string, number>();
  ranked.forEach((x, i) => {
    const prev = ranked[i - 1];
    rankOf.set(
      x.id,
      prev && cmp(prev.score, x.score) === 0 ? rankOf.get(prev.id)! : i + 1,
    );
  });
  const rows: RankedCandidate[] = scored.map((s) => {
    const status =
      s.cards.length === 0 ? 'unscored' : s.score ? 'complete' : 'incomplete';
    const unknown = rubric.criteria
      .map((k) => k.key)
      .filter((k) => s.cards.some((b) => b.ratings[k]?.rating === null));
    const disagreements =
      s.cards.length < 2
        ? []
        : rubric.criteria.flatMap((k) => {
            const current = s.all.filter(counted);
            const values = current.map(
              (p) => p.body!.ratings[k.key]?.rating ?? null,
            );
            return new Set(values).size > 1
              ? [
                  {
                    criterion: k.key,
                    ratings: current.map((p) => ({
                      scorecard_id: p.input.id,
                      reviewer: p.body!.reviewer.label,
                      rating: p.body!.ratings[k.key]?.rating ?? null,
                    })),
                  },
                ]
              : [];
          });
    const overlaps = scored
      .filter(
        (o) =>
          o.id !== s.id &&
          s.lower &&
          s.upper &&
          o.lower &&
          o.upper &&
          cmp(s.lower, o.upper) <= 0 &&
          cmp(o.lower, s.upper) <= 0,
      )
      .map((o) => o.id)
      .sort();
    return {
      alternative: {
        id: s.c.alternative.id,
        version: s.c.alternative.version,
        kind: s.c.alternative.kind,
        title: s.c.alternative.title,
      },
      status,
      score: s.score ? exact(s.score) : null,
      range:
        s.lower && s.upper
          ? { lower: exact(s.lower), upper: exact(s.upper) }
          : null,
      unknown_criteria: unknown,
      rank: rankOf.get(s.id) ?? null,
      overlaps_with: overlaps,
      disagreements,
      scorecards: s.all
        .map((p) => {
          const r = p.body ? ratingsOf(p.body) : {};
          const sc = p.body ? scoreRatings(rubric, r) : null;
          const lo = p.body ? scoreRatings(rubric, r, undefined, 1) : null;
          const hi = p.body ? scoreRatings(rubric, r, undefined, 5) : null;
          return {
            id: p.input.id,
            version: p.input.version,
            reviewer: p.body?.reviewer.label ?? 'unknown',
            reviewer_kind: p.body?.reviewer.kind ?? 'unknown',
            confidence: p.body?.confidence.level ?? 'unknown',
            score: sc ? exact(sc) : null,
            lower: exact(lo ?? rat(0n, 1n)),
            upper: exact(hi ?? rat(100n, 1n)),
            stale: p.stale !== null,
            stale_reason: p.stale,
            stale_reasons: p.stale_reasons,
            system: p.system,
            superseded_by: p.superseded_by,
            edit_of: p.body?.edit_of?.scorecard.id.toLowerCase() ?? null,
          };
        })
        .sort((a, b) => (a.id < b.id ? -1 : 1)),
      gates: gatesFor(
        s.c,
        parsed.get(s.id) ?? [],
        opportunityStatus.get(s.id) ?? 'unscored',
      ),
    };
  });
  rows.sort(
    (a, b) =>
      (a.rank ?? Infinity) - (b.rank ?? Infinity) ||
      (a.range && b.range
        ? cmp(fromExact(b.range.upper), fromExact(a.range.upper))
        : a.range
          ? -1
          : b.range
            ? 1
            : 0) ||
      (a.alternative.id < b.alternative.id ? -1 : 1),
  );
  return {
    rubric: rubricId,
    rubric_version: rubric.version,
    rubric_hash: rubricHash(rubric),
    candidates: rows,
    excluded: excluded.sort((a, b) => (a.id < b.id ? -1 : 1)),
    sensitivity: sensitivity(rubric, scored, n),
  };
}

/** Both rankings and the gates for one problem's candidates, hashed as one report. */
export function selectionReport(input: {
  problem: { id: string; version: number; title: string };
  candidates: readonly CandidateInput[];
  shortlist_size: number;
  /** Current versions of cited and read evidence; without it evidence staleness is not checked. */
  evidence?: EvidenceVersions;
  /** The current hash of the problem's linked claims; without it linking is not checked. */
  linked_hash?: string;
}): SelectionReport {
  const candidates = [...input.candidates].sort((a, b) =>
    a.alternative.id < b.alternative.id ? -1 : 1,
  );
  const parsed = new Map(
    candidates.map((c) => [
      c.alternative.id,
      parseCards(c, {
        problem: input.problem,
        evidence: input.evidence,
        linked_hash: input.linked_hash,
      }),
    ]),
  );
  // Opportunity completeness feeds the build gate, so compute it first.
  const opportunity = rankUnder(
    'opportunity',
    candidates,
    parsed,
    new Map(),
    input.shortlist_size,
  );
  const status = new Map(
    opportunity.candidates.map((c) => [c.alternative.id, c.status as string]),
  );
  const opp = rankUnder(
    'opportunity',
    candidates,
    parsed,
    status,
    input.shortlist_size,
  );
  const suit = rankUnder(
    'suitability',
    candidates,
    parsed,
    status,
    input.shortlist_size,
  );
  const body = {
    report_version: 'selection-report/1' as const,
    problem: input.problem,
    opportunity: opp,
    suitability: suit,
  };
  return { ...body, report_hash: canonicalHash(body) };
}

// ---- Selection checks -------------------------------------------------------------------

export interface SelectionCheck {
  /** Gate failures: a high score or an override never clears these. */
  blocked: string[];
  /** Structural problems: missing, extra or stale candidates. */
  invalid: string[];
  overrides: {
    alternative: string;
    ranking: RubricId;
    original_rank: number | null;
    original_score: string | null;
    outranked_by: { id: string; rank: number | null; score: string | null }[];
  }[];
  override_reason_missing: boolean;
}
export function checkSelection(
  report: SelectionReport,
  req: Pick<SelectRequest, 'dispositions' | 'override_reason'>,
): SelectionCheck {
  const blocked: string[] = [];
  const invalid: string[] = [];
  const all = report.suitability.candidates;
  const byId = new Map(all.map((c) => [c.alternative.id, c]));
  const chosen = new Map<string, SelectionDisposition>();
  for (const d of req.dispositions) {
    const id = d.alternative.id.toLowerCase();
    const c = byId.get(id);
    if (!c) {
      invalid.push(`${id} is not a candidate for this problem.`);
      continue;
    }
    if (c.alternative.version !== d.alternative.version)
      invalid.push(
        `"${c.alternative.title}" is at version ${c.alternative.version}, not ${d.alternative.version}.`,
      );
    if (chosen.has(id))
      invalid.push(`"${c.alternative.title}" has more than one disposition.`);
    chosen.set(id, d.disposition);
    for (const reason of c.gates.blocked[d.disposition] ?? [])
      blocked.push(
        `"${c.alternative.title}" cannot be ${d.disposition.replaceAll('_', ' ')}: ${reason}`,
      );
  }
  for (const c of all)
    if (!chosen.has(c.alternative.id))
      invalid.push(
        `"${c.alternative.title}" needs a disposition (reject or defer still need a reason).`,
      );
  const advancing = (d: SelectionDisposition | undefined) =>
    d === 'select_for_build' ||
    d === 'proceed_to_validation' ||
    d === 'recommend_alternative';
  const overrides: SelectionCheck['overrides'] = [];
  const consider = (
    ranking: RubricRanking,
    isAdvanced: (d: SelectionDisposition | undefined) => boolean,
    applies: (d: SelectionDisposition | undefined) => boolean,
  ) => {
    for (const a of ranking.candidates) {
      if (!applies(chosen.get(a.alternative.id))) continue;
      const above = ranking.candidates.filter(
        (b) =>
          b.alternative.id !== a.alternative.id &&
          !isAdvanced(chosen.get(b.alternative.id)) &&
          b.rank !== null &&
          (a.rank === null || b.rank < a.rank),
      );
      if (above.length)
        overrides.push({
          alternative: a.alternative.id,
          ranking: ranking.rubric,
          original_rank: a.rank,
          original_score: a.score?.display ?? null,
          outranked_by: above.map((b) => ({
            id: b.alternative.id,
            rank: b.rank,
            score: b.score?.display ?? null,
          })),
        });
    }
  };
  consider(report.suitability, advancing, advancing);
  consider(
    report.opportunity,
    (d) => d === 'select_for_build',
    (d) => d === 'select_for_build',
  );
  return {
    blocked,
    invalid,
    overrides,
    override_reason_missing:
      overrides.length > 0 && req.override_reason === null,
  };
}

// ---- Specifications ---------------------------------------------------------------------

const overlaps = (p: string, q: string) =>
  p === q || q.startsWith(`${p}/`) || p.startsWith(`${q}/`);

/** Task graph and coverage checks. A spec with problems cannot be frozen. */
export function validateSpec(s: SpecContent): SpecProblem[] {
  const problems: SpecProblem[] = [];
  const dupes = (label: string, keys: string[]) => {
    const seen = new Set<string>();
    for (const k of keys) {
      if (seen.has(k))
        problems.push({
          code: 'duplicate_key',
          detail: `${label} ${k} appears twice.`,
        });
      seen.add(k);
    }
  };
  dupes(
    'Task',
    s.tasks.map((t) => t.key),
  );
  dupes(
    'Check',
    s.acceptance_checks.map((a) => a.key),
  );
  dupes(
    'Flow',
    s.user_flows.map((f) => f.key),
  );
  const tasks = new Set(s.tasks.map((t) => t.key));
  const checks = new Set(s.acceptance_checks.map((a) => a.key));
  const flows = new Set(s.user_flows.map((f) => f.key));
  for (const a of s.acceptance_checks)
    if (a.flow && !flows.has(a.flow))
      problems.push({
        code: 'unknown_flow',
        detail: `Check ${a.key} names flow ${a.flow}, which does not exist.`,
      });
  for (const t of s.tasks) {
    for (const d of t.depends_on)
      if (!tasks.has(d) || d === t.key)
        problems.push({
          code: d === t.key ? 'cycle' : 'unknown_dependency',
          detail:
            d === t.key
              ? `Task ${t.key} depends on itself.`
              : `Task ${t.key} depends on ${d}, which does not exist.`,
        });
    for (const a of t.acceptance)
      if (!checks.has(a))
        problems.push({
          code: 'unknown_check',
          detail: `Task ${t.key} names check ${a}, which does not exist.`,
        });
  }
  const covered = new Set(s.tasks.flatMap((t) => t.acceptance));
  for (const a of s.acceptance_checks)
    if (!covered.has(a.key))
      problems.push({
        code: 'uncovered_check',
        detail: `No task delivers acceptance check ${a.key}.`,
      });
  const topo = topological(s);
  if (topo.cycle.length)
    problems.push({
      code: 'cycle',
      detail: `Tasks ${topo.cycle.join(', ')} depend on each other in a cycle.`,
    });
  else {
    const reach = reachability(s);
    for (let i = 0; i < s.tasks.length; i++)
      for (let j = i + 1; j < s.tasks.length; j++) {
        const a = s.tasks[i]!;
        const b = s.tasks[j]!;
        if (reach.get(a.key)!.has(b.key) || reach.get(b.key)!.has(a.key))
          continue;
        const shared = a.file_scope.find((p) =>
          b.file_scope.some((q) => overlaps(p, q)),
        );
        if (shared)
          problems.push({
            code: 'ownership_conflict',
            detail: `Tasks ${a.key} and ${b.key} can run in parallel and both own ${shared}; order them or split the scope.`,
          });
      }
  }
  return problems;
}
function topological(s: SpecContent) {
  const deps = new Map(
    s.tasks.map((t) => [t.key, t.depends_on.filter((d) => d !== t.key)]),
  );
  const done: string[] = [];
  const left = new Set(deps.keys());
  let progress = true;
  while (left.size && progress) {
    progress = false;
    for (const k of [...left].sort())
      if (deps.get(k)!.every((d) => !left.has(d) || !deps.has(d))) {
        done.push(k);
        left.delete(k);
        progress = true;
      }
  }
  return { order: done, cycle: [...left].sort() };
}
/** For each task, every task that must finish before it (transitively). */
function reachability(s: SpecContent) {
  const deps = new Map(s.tasks.map((t) => [t.key, t.depends_on]));
  const out = new Map<string, Set<string>>();
  const visit = (k: string): Set<string> => {
    const known = out.get(k);
    if (known) return known;
    const acc = new Set<string>();
    out.set(k, acc);
    for (const d of deps.get(k) ?? [])
      if (deps.has(d)) {
        acc.add(d);
        for (const x of visit(d)) acc.add(x);
      }
    return acc;
  };
  for (const k of deps.keys()) visit(k);
  return out;
}

/**
 * A task's hash covers its own definition, the acceptance checks (and their flows) it
 * delivers, the spec-wide constraints every task works under (scope, non-goals, data
 * contracts) and the hashes of its dependencies. A changed task therefore invalidates its
 * dependants; a changed risk note or audience line invalidates the frozen version but no task.
 */
export function taskHashes(s: SpecContent): Record<string, string> {
  const shared = {
    scope: s.scope,
    non_goals: s.non_goals,
    data_contracts: s.data_contracts,
  };
  const checks = new Map(s.acceptance_checks.map((a) => [a.key, a]));
  const flows = new Map(s.user_flows.map((f) => [f.key, f]));
  const { order: sorted, cycle } = topological(s);
  const out: Record<string, string> = {};
  for (const key of [...sorted, ...cycle]) {
    const t = s.tasks.find((x) => x.key === key)!;
    out[key] = canonicalHash({
      task: t,
      checks: [...t.acceptance].sort().map((k) => {
        const a = checks.get(k) ?? null;
        return { check: a, flow: a?.flow ? (flows.get(a.flow) ?? null) : null };
      }),
      shared,
      deps: [...t.depends_on].sort().map((d) => out[d] ?? null),
    });
  }
  return out;
}

/**
 * The executable QA cases frozen with a spec, in spec order, optionally limited to some checks.
 * A build plan must carry exactly these; `held_out` stays here and never reaches a role packet.
 */
export function frozenCases(s: SpecContent, keys?: readonly string[]) {
  return s.acceptance_checks
    .filter((a) => !keys || keys.includes(a.key))
    .flatMap((a) =>
      (a.cases ?? []).map((c) => ({
        check_key: a.key,
        args: c.args,
        stdin: c.stdin,
        stdout: c.stdout,
        exit_code: c.exit_code,
        held_out: c.held_out,
      })),
    );
}

/**
 * ADR-0078: the browser cases frozen with a spec for static-web/1 builds, in spec order. Like
 * frozenCases, `held_out` stays here and never reaches a role packet.
 */
export function frozenBrowserCases(s: SpecContent, keys?: readonly string[]) {
  return s.acceptance_checks
    .filter((a) => !keys || keys.includes(a.key))
    .flatMap((a) =>
      (a.browser_cases ?? []).map((c) => ({
        check_key: a.key,
        page: c.page,
        steps: c.steps,
        held_out: c.held_out,
      })),
    );
}

/** How the current task graph compares with a frozen one. */
export function taskImpact(
  s: SpecContent,
  frozen: Record<string, string> | null,
) {
  const now = taskHashes(s);
  const tasks = s.tasks.map((t) => {
    const was = frozen?.[t.key] ?? null;
    return {
      key: t.key,
      title: t.title,
      task_hash: now[t.key]!,
      frozen_hash: was,
      status: !frozen
        ? ('unfrozen' as const)
        : was === null
          ? ('added' as const)
          : was === now[t.key]
            ? ('frozen' as const)
            : ('changed' as const),
    };
  });
  const removed = frozen
    ? Object.keys(frozen)
        .filter((k) => !(k in now))
        .sort()
    : [];
  return { tasks, removed };
}
