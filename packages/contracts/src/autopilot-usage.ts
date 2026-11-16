import { z, id, counter } from './primitives.js';
import { QuotaStateSchema } from './connections.js';
import {
  AUTO_RESUME_MAX_CHECKS,
  AutopilotConfigSchema,
  autopilotContinuable,
  type Autopilot,
  type AutopilotAutoResume,
  type AutopilotConfig,
  type AutopilotStage,
} from './autopilot.js';
import type { AutopilotStopKind } from './autopilot-settings.js';

// ADR-0124 (F2): the usage check before an autopilot starts, and continuing by itself after a
// usage limit. The counts are the same per-step floors the start check and each step's limits
// use (autopilotChildLimits), and the connection figures are the ones plan admission reads, so
// "needed" and "left" never come from a second estimate. The plan account's own usage limit is
// not visible to the studio; the check says so instead of guessing.

/** Stops that pass with time: the plan account's own usage limit and the connection's daily cap. */
export const AUTO_RESUME_KINDS: readonly AutopilotStopKind[] = [
  'usage_limit',
  'daily_cap',
];

/** The fewest plan requests one step needs to finish once (autopilotChildLimits' floor). */
export function autopilotStageFloor(
  stage: AutopilotStage,
  c: Pick<AutopilotConfig, 'perspectives'>,
): number {
  switch (stage) {
    case 'research':
    case 'explore':
    case 'gather':
      return 2;
    case 'discover':
      return c.perspectives.length + 2;
    case 'assess':
      // At least one request and its repair; the preview counts more once options exist.
      return 2;
    default:
      return 0;
  }
}

/**
 * The fewest requests this autopilot needs from one plan connection to reach its end: each
 * step's floor, summed over the steps that use that connection. A start at selection makes no
 * model call. Counts only the shortest path; retries, gathering and revisions use more.
 */
export function autopilotRequestFloor(
  c: AutopilotConfig,
  connectionId: string,
): number {
  const conn = connectionId.toLowerCase();
  const main =
    c.resource_setup.kind === 'subscription' &&
    c.resource_setup.connection_id.toLowerCase() === conn;
  const research = c.research?.connection_id.toLowerCase() === conn ? 2 : 0;
  if (!main) return research;
  if (c.start)
    return c.start.stage === 'assess' ? autopilotStageFloor('assess', c) : 0;
  return (
    research +
    (['explore', 'discover', 'assess'] as const).reduce(
      (n, s) => n + autopilotStageFloor(s, c),
      0,
    )
  );
}

/**
 * How long after a usage-limit stop the next automatic check waits: 1, 2, then 4 hours. Each
 * check may send one request that the plan refuses again, so checks are few and spaced.
 */
export function autoResumeWaitMs(checks: number): number {
  return Math.min(4, 2 ** Math.max(0, checks)) * 3_600_000;
}

/**
 * Where an opted-in autopilot stands on continuing by itself (undefined when it did not opt in).
 * Waiting needs a stop on a limit that passes with time, a stop Continue can pick up (end time,
 * approvals, outcome), checks left, and a next check before its end time.
 */
export function autoResumeView(
  a: Pick<Autopilot, 'config' | 'state' | 'outcome' | 'steps'> &
    Partial<Pick<Autopilot, 'approvals_ended_at'>>,
  record: { checks: number; turned_off_at: string | null },
  now = Date.now(),
): AutopilotAutoResume | undefined {
  if (!a.config.resume_after_limit) return undefined;
  const base = {
    checks: record.checks,
    max: AUTO_RESUME_MAX_CHECKS,
    next_check_at: null,
    turned_off_at: record.turned_off_at,
  };
  if (record.turned_off_at) return { ...base, state: 'turned_off' };
  if (record.checks >= AUTO_RESUME_MAX_CHECKS)
    return { ...base, state: 'used_up' };
  const last = a.steps.at(-1);
  const kind = last?.stop_kind ?? null;
  if (
    a.state !== 'finished' ||
    a.outcome !== 'limit_reached' ||
    !kind ||
    !AUTO_RESUME_KINDS.includes(kind) ||
    !autopilotContinuable(a, now).ok
  )
    return { ...base, state: 'on' };
  if (kind === 'daily_cap') return { ...base, state: 'waiting' };
  const stoppedAt = Date.parse(last?.finished_at ?? '') || now;
  const next = stoppedAt + autoResumeWaitMs(record.checks);
  if (next >= Date.parse(a.config.limits.ends_at))
    return { ...base, state: 'on' };
  return {
    ...base,
    state: 'waiting',
    next_check_at: new Date(next).toISOString(),
  };
}

/** The draft the start form would send, and the run it would use (none yet for a new run). */
export const AutopilotUsageCheckRequestSchema = z.strictObject({
  config: AutopilotConfigSchema,
  run_id: id.nullable().default(null),
});

export const AutopilotUsageFitSchema = z.enum([
  /** Room for at least the shortest path on the run and today. */
  'fits',
  /** The run's per-run cap cannot hold it; the start is refused. */
  'per_run',
  /** Not enough of the daily cap left today; it would stop and wait (or continue by itself). */
  'daily',
  /** The connection refuses requests now (sign-in, caps, the plan's usage limit, …). */
  'blocked',
]);

export const AutopilotUsageCheckSchema = z.strictObject({
  connections: z
    .array(
      z.strictObject({
        connection_id: id,
        label: z.string().max(200),
        /** The fewest requests the autopilot needs from this connection (autopilotRequestFloor). */
        need: counter,
        /** The most it may use: its call limit, or what the per-run cap leaves, if lower. */
        up_to: counter,
        per_run: counter,
        per_run_left: counter,
        daily_cap: counter,
        daily_left: counter,
        quota: QuotaStateSchema,
        blockers: z.array(z.string().max(600)).max(12),
        fit: AutopilotUsageFitSchema,
        /** One sentence for the form. */
        line: z.string().max(600),
      }),
    )
    .max(2),
  /** What the check cannot see (always said). */
  note: z.string().max(600),
});
export type AutopilotUsageCheck = z.infer<typeof AutopilotUsageCheckSchema>;

export const AUTOPILOT_USAGE_NOTE =
  "These are the studio's own caps. The plan account's own usage limit is not visible to the studio, so a run that fits here can still stop on it.";

/** Turning off continuing by itself (always allowed to the owner; it only removes automation). */
export const AutoResumeOffRequestSchema = z.strictObject({
  expected_version: z.number().int().min(1).optional(),
});
