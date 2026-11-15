import {
  BUILD_APPROVAL_MAX_REPAIRS,
  BUILD_APPROVAL_MAX_REQUESTS,
  buildDeadlineMs,
  defaultBuildRequests,
  type BuildRecipe,
} from '@creator/contracts';

/**
 * ADR-0109 (B4): the Build form's per-build limits. Defaults stay 1 repair round and 2 + 2 per
 * round requests; the owner may raise them to the caps, and sees the time limit they imply
 * before approving. The server checks every limit again.
 */
export const REPAIR_OPTIONS = Array.from(
  { length: BUILD_APPROVAL_MAX_REPAIRS + 1 },
  (_, i) => i,
);

/** The request limits offered for `repairs`: the default first, then more room for parts. */
export function requestOptions(repairs: number): number[] {
  const base = defaultBuildRequests(repairs);
  const more = [8, 10, 12, 16, BUILD_APPROVAL_MAX_REQUESTS].filter(
    (n) => n > base,
  );
  return [base, ...more];
}

export interface BuildLimits {
  repairs: number;
  requests: number;
  cases: number;
  deadlineMs: number;
  /** Whole minutes, rounded up, for the person. */
  minutes: number;
}

/** The limits a build states, from the form's choices (`requests` null: the default). */
export function buildLimits(o: {
  repairs: number;
  requests: number | null;
  cases: number;
  recipe: BuildRecipe;
  codexBuildTimeoutMs: number;
}): BuildLimits {
  const requests = Math.min(
    BUILD_APPROVAL_MAX_REQUESTS,
    Math.max(o.requests ?? 0, defaultBuildRequests(o.repairs)),
  );
  const deadlineMs = buildDeadlineMs(o.codexBuildTimeoutMs, o.repairs, {
    requests,
    cases: o.cases,
    recipe: o.recipe,
  });
  return {
    repairs: o.repairs,
    requests,
    cases: o.cases,
    deadlineMs,
    minutes: Math.ceil(deadlineMs / 60_000),
  };
}

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;

/** The Limits line of "What will happen". */
export function limitsText(l: BuildLimits): string {
  return `At most ${plural(l.requests, 'model request')}, ${plural(l.repairs, 'repair round')} after a failed check; ${plural(l.cases, 'test case')} run one after another each round; the build stops after ${plural(l.minutes, 'minute')}`;
}
