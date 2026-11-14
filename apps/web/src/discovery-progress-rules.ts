// Final UX pass P-6 (ADR-0103): a discovery's progress in plain words, with what to do next,
// for Discover and Decide. Only type imports, so the rules load in tests without a browser.
import type { Workflow, WorkflowTask } from '@creator/contracts';

export type ProgressTone = 'running' | 'waiting' | 'done' | 'stopped';
/** Where the line's next step happens. */
export type ProgressNext =
  'decide' | 'approvals' | 'evidence' | 'resume' | null;
export type DiscoveryLine = {
  tone: ProgressTone;
  text: string;
  next: ProgressNext;
  /** The problem a finished discovery wrote, for "Open in Decide". */
  problemId: string | null;
};

/** How long a finished discovery stays listed (unless hidden): long enough to come back to. */
export const KEEP_FINISHED_MS = 24 * 3_600_000;

const plain = (s: string) => s.replaceAll('_', ' ').replaceAll('.', ' · ');
const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;
const sentence = (s: string) => {
  const t = s.trim();
  return /[.!?]$/.test(t) ? t : `${t}.`;
};

/** What the discovery is doing now, from its newest active step. */
function stepText(tasks: readonly WorkflowTask[]): string {
  const active = tasks.filter((t) =>
    ['queued', 'leased', 'reconciling'].includes(t.state),
  );
  const proposals = tasks.filter((t) => t.kind === 'propose' && t.round === 0);
  const written = proposals.filter((t) => t.state === 'succeeded').length;
  const has = (kind: string) => active.some((t) => t.kind === kind);
  if (has('revise')) return 'Revising proposals after the skeptic’s review.';
  if (has('skeptic')) return 'A skeptic is checking the proposals.';
  if (has('propose'))
    return `Writing proposals from each perspective (${written} of ${proposals.length} done).`;
  if (has('locate'))
    return 'Reading the attached claims to locate the problem.';
  return 'Running.';
}

/**
 * One discovery in plain words. `tasks` are the workflow's steps when read (a live one), or
 * null; a finished one is described from its result alone.
 */
export function discoveryLine(
  wf: Workflow,
  tasks: readonly WorkflowTask[] | null,
): DiscoveryLine {
  const line = (
    tone: ProgressTone,
    text: string,
    next: ProgressNext = null,
    problemId: string | null = null,
  ): DiscoveryLine => ({ tone, text, next, problemId });
  if (!wf.finished_at) {
    if (tasks?.some((t) => t.state === 'waiting_human'))
      return line(
        'waiting',
        'Waiting for your approval before its next step. It carries on once you answer.',
        'approvals',
      );
    if (wf.control === 'cancel')
      return line('running', 'Stopping: it ends after the current step.');
    if (wf.state === 'paused_operator')
      return line('waiting', 'Paused. Resume it to carry on.', 'resume');
    // Review L-3: a pause asked for while a step is still running takes effect after it.
    if (wf.control === 'pause')
      return line('waiting', 'Pausing: it stops after the current step.');
    if (wf.state === 'queued') return line('running', 'Waiting to start.');
    if (wf.state === 'reconciling')
      return line(
        'running',
        'Checking a step whose result was uncertain; it carries on by itself.',
      );
    return line('running', tasks ? stepText(tasks) : 'Running.');
  }
  const d = wf.result?.discovery;
  const problemId = d?.catalog_records.problem?.id ?? null;
  if (wf.state === 'cancelled')
    return line('stopped', 'Cancelled before it finished.');
  if (wf.state === 'failed' || !wf.result) {
    const why = wf.result?.explanation || plain(wf.reason);
    return line(
      'stopped',
      `It stopped without a result: ${sentence(why)} Check the evidence and limits, then start it again.`,
      'evidence',
    );
  }
  const outcome = d?.outcome ?? wf.result.outcome;
  if (outcome === 'insufficient_evidence') {
    const why = d?.sufficiency.reasons[0];
    return line(
      'stopped',
      `It needs more evidence${why ? `: ${sentence(why)}` : '.'} Add claims (search the web or cite a source), then start again.`,
      'evidence',
    );
  }
  if (outcome === 'candidates' && d) {
    const n = d.catalog_records.alternatives.length;
    return line(
      'done',
      `Finished with ${plural(n, 'option')} to compare. Next: compare them and choose under Decide.`,
      problemId ? 'decide' : null,
      problemId,
    );
  }
  if (outcome === 'no_candidates')
    return line(
      'done',
      'Finished, but no option can go ahead. Next: read why under Decide; more evidence or a person’s judgment can change it.',
      problemId ? 'decide' : 'evidence',
      problemId,
    );
  return line(
    'done',
    sentence(wf.result.explanation || 'Finished'),
    problemId ? 'decide' : null,
    problemId,
  );
}

/** At most this many discoveries are listed, unless more are live. */
export const MAX_LISTED = 3;

/**
 * The discoveries a page lists (review M-1): every live one first, newest first, so a paused or
 * slow one is never pushed out; then, up to `MAX_LISTED` in all, finished ones from the last day
 * that the person has not hidden and that `include` accepts (Decide's own rule), newest first.
 * `keep` (the one just started here) is always listed.
 */
export function shownDiscoveries(
  list: readonly Workflow[],
  now: number,
  hidden: ReadonlySet<string>,
  keep = '',
  include: (w: Workflow) => boolean = () => true,
): Workflow[] {
  const newest = (a: Workflow, b: Workflow) =>
    b.created_at.localeCompare(a.created_at);
  const ours = list.filter((w) => w.role === 'r02_discovery');
  const live = ours.filter((w) => !w.finished_at).sort(newest);
  const finished = ours
    .filter(
      (w) =>
        w.finished_at &&
        (w.id === keep ||
          (!hidden.has(w.id) &&
            now - Date.parse(w.finished_at) < KEEP_FINISHED_MS &&
            include(w))),
    )
    .sort((a, b) => (a.id === keep ? -1 : b.id === keep ? 1 : newest(a, b)));
  const room = Math.max(
    MAX_LISTED - live.length,
    finished[0]?.id === keep && keep ? 1 : 0,
  );
  return [...live, ...finished.slice(0, room)];
}
