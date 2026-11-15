import {
  AUTOPILOT_STAGE_LABEL,
  autopilotContinuable,
  type Autopilot,
} from '@creator/contracts';

// Live rerun 3 (November 15): after confirming gates under Decide, Jordan could not find where to
// continue the autopilot; its Continue sat on a card under Discover › Run it for me, next to an
// expired autopilot's identical button. Decide now names the autopilot waiting on this problem.

/**
 * The newest autopilot that worked on this problem and can be continued now (finished, waiting,
 * before its end time), or null; null too while any autopilot is running on it.
 */
export function waitingAutopilot(
  autopilots: readonly Autopilot[],
  problemId: string,
  now = Date.now(),
): Autopilot | null {
  const on = autopilots.filter((a) =>
    a.steps.some((s) => s.problem?.id === problemId),
  );
  // PR #211 review 2 N-1: while one is working on this problem, no older one offers Continue.
  if (on.some((a) => a.state === 'running')) return null;
  const pick =
    on
      .filter((a) => autopilotContinuable(a, now).ok)
      .sort((x, y) => Date.parse(y.created_at) - Date.parse(x.created_at))[0] ??
    null;
  // Review 3: a run has one running autopilot at a time, so one running in the same run (on
  // another problem) would refuse Continue too.
  return pick &&
    autopilots.some((a) => a.state === 'running' && a.run_id === pick.run_id)
    ? null
    : pick;
}

/** The Continue button's words: where the autopilot picks up. */
export function continueLabel(a: Pick<Autopilot, 'stage'>): string {
  return `Continue the autopilot from ${AUTOPILOT_STAGE_LABEL[a.stage].toLowerCase()}`;
}
