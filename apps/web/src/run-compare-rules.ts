import type { RunComparison, RunComparisonSide } from '@creator/contracts';
import { money } from './amounts.js';

// ADR-0120 (F7): the rows of the side-by-side table, worked out from the comparison alone so
// the page only lays them out. No imports beyond contracts types and amounts, so tests load it.

export type CompareRow = {
  /** The group the row sits in (Evidence, Options, …). */
  group: string;
  label: string;
  a: string;
  b: string;
  /** The two columns read differently. */
  differs: boolean;
};

const OUTCOME: Record<string, string> = {
  proposal: 'Finished with a proposal',
  insufficient_evidence: 'Stopped: not enough evidence',
  no_eligible_option: 'Stopped: no option can go ahead',
  needs_person: 'Stopped for a person',
  needs_authority: 'Stopped: needs an approval',
  limit_reached: 'Stopped: limit reached',
  failed: 'Stopped: a step failed',
  cancelled: 'Stopped by you',
};

const words = (s: string) => s.replaceAll('_', ' ');

/** "2 h 05 min", "4 min 10 s", "35 s". */
export function duration(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  if (h) return `${h} h ${String(m).padStart(2, '0')} min`;
  if (m) return `${m} min ${String(r).padStart(2, '0')} s`;
  return `${r} s`;
}

export function outcomeText(side: RunComparisonSide): string {
  const a = side.autopilot;
  if (a.state === 'running') return 'Still running';
  return a.outcome ? (OUTCOME[a.outcome] ?? words(a.outcome)) : 'Finished';
}

function choiceText(side: RunComparisonSide): string {
  const c = side.choice;
  if (!c) return 'No choice recorded';
  const by =
    c.by === 'autopilot'
      ? ' (chosen by the autopilot)'
      : c.by === 'person'
        ? ' (chosen by a person)'
        : '';
  const how = c.disposition ? `${words(c.disposition)}: ` : '';
  return `${how}${c.title} · ${words(c.kind)}${by}`;
}

function buildText(side: RunComparisonSide): string {
  if (!side.builds.length) return 'No build';
  const latest = side.builds.find((b) => b.current) ?? side.builds[0]!;
  const more =
    side.builds.length > 1 ? ` (${side.builds.length} packages)` : '';
  return `${latest.state === 'verified' ? 'Verified' : latest.state === 'failed' ? 'Failed' : 'Blocked'}${more}`;
}

function stopsText(side: RunComparisonSide): string {
  if (!side.stops.length) return 'Never stopped';
  const forPerson = side.stops.filter(
    (s) => s.decision_id || s.kind !== null,
  ).length;
  const stages = [...new Set(side.stops.map((s) => words(s.stage)))].join(', ');
  return `${side.stops.length} stop${side.stops.length === 1 ? '' : 's'} (at ${stages})${forPerson ? `, ${forPerson} asked a person or a setting` : ''}`;
}

function topOption(side: RunComparisonSide): string {
  const top = side.options.ranked[0];
  if (!top) return '—';
  return `${top.title}${top.score ? ` · ${top.score}` : ''}`;
}

/** The table's rows, in reading order: what it did, what it found, what it chose, what it used. */
export function compareRows(c: RunComparison): CompareRow[] {
  const fx = (s: RunComparisonSide) => s.autopilot.fixture;
  const rows: [string, string, (s: RunComparisonSide) => string][] = [
    ['Run', 'Result', outcomeText],
    [
      'Run',
      'Route',
      (s) =>
        `${words(s.autopilot.route)}${s.autopilot.models.length ? ` · ${s.autopilot.models.join(', ')}` : ''}`,
    ],
    [
      'Run',
      'Started at',
      (s) =>
        s.autopilot.started_at_stage === 'start'
          ? 'The beginning'
          : words(s.autopilot.started_at_stage),
    ],
    ['Run', 'Problem', (s) => s.problem?.title ?? 'No problem reached'],
    [
      'Evidence',
      'Web search',
      (s) =>
        s.evidence.searched_web
          ? `${s.evidence.leads} leads, ${s.evidence.pages_read} pages read`
          : 'Did not search',
    ],
    [
      'Evidence',
      'Claims from the search',
      (s) =>
        s.evidence.searched_web
          ? `${s.evidence.claims_admitted} kept of ${s.evidence.claims_proposed} proposed`
          : '—',
    ],
    [
      'Evidence',
      'Claims on the problem now',
      (s) =>
        `${s.evidence.problem_supports} support, ${s.evidence.problem_contradicts} contradict`,
    ],
    [
      'Options',
      'Options scored',
      (s) =>
        s.options.scores_from === 'none'
          ? 'Not scored'
          : String(s.options.count),
    ],
    ['Options', 'Top option', topOption],
    ['Stops', 'Where it stopped', stopsText],
    ['Choice', 'Choice', choiceText],
    ['Choice', 'Proposal', (s) => s.proposal?.title ?? 'None'],
    ['Choice', 'Build', buildText],
    ['Use', 'Requests', (s) => `${s.requests.used} of ${s.requests.limit}`],
    [
      'Use',
      'Model calls and plan requests',
      (s) =>
        `${s.requests.model_attempts} calls, ${s.requests.plan_requests} plan requests`,
    ],
    [
      'Use',
      'Money',
      (s) =>
        `${money(s.money.incurred, fx(s))} spent${s.money.unknown !== '0' ? `, ${money(s.money.unknown, fx(s))} unknown` : ''}`,
    ],
    [
      'Use',
      'Time',
      (s) =>
        `${duration(s.time.elapsed_seconds)} in all, ${duration(s.time.working_seconds)} working`,
    ],
  ];
  return rows.map(([group, label, f]) => {
    const a = f(c.a);
    const b = f(c.b);
    return { group, label, a, b, differs: a !== b };
  });
}

/** `a,b` in the address; anything else names no pair. */
export function pairFrom(id: string): [string, string] | null {
  const [a, b, ...rest] = id.split(',');
  if (!a || !b || rest.length || a === b) return null;
  return [a, b];
}

/**
 * The pair to show first: the address's pair, else the two latest finished autopilots (newest
 * on the right), else none.
 */
export function defaultPair(
  autopilots: readonly { id: string; state: string; created_at: string }[],
  fromAddress: string,
): [string, string] | null {
  const named = pairFrom(fromAddress);
  if (named) return named;
  const done = autopilots
    .filter((a) => a.state === 'finished')
    .sort((x, y) => y.created_at.localeCompare(x.created_at));
  return done.length >= 2 ? [done[1]!.id, done[0]!.id] : null;
}
