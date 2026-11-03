// When the top bar's usage button reads again (PR #127 review L-1, N-1). Builds,
// qualifications and an answer the browser stopped waiting for keep making plan requests on
// the server after the click that started them, so after any write in this window the button
// reads every few seconds instead of every minute, for longer while a read shows a plan request
// running, and never more than MAX_WATCH_MS after the write. No imports, so tests load it.

export const REFRESH_MS = 60_000;
export const FAST_MS = 3_000;
export const WATCH_MS = 30_000;
/**
 * The longest a watch runs after the write that started it (PR #127 re-review L-A): a request
 * left in flight by a stopped studio stays "running" until it is reconciled, and must not keep
 * a window reading every few seconds for ever.
 */
export const MAX_WATCH_MS = 10 * 60_000;

/** Fast reads until `until`; a running request can push `until` out, never past `cap`. */
export type Watch = { until: number; cap: number };
export const NO_WATCH: Watch = { until: 0, cap: 0 };

/** How long until the next read: soon while watching (and the window is shown), else a minute. */
export function nextReadMs(now: number, w: Watch, hidden: boolean) {
  return !hidden && now < w.until ? FAST_MS : REFRESH_MS;
}

/** A write in this window starts (or restarts) a watch. */
export function watchAfterWrite(now: number, w: Watch): Watch {
  return {
    until: Math.max(w.until, now + WATCH_MS),
    cap: Math.max(w.cap, now + MAX_WATCH_MS),
  };
}

/**
 * A read that shows a plan request running keeps a watch going for WATCH_MS more, up to its
 * cap. It never starts one: requests from the CLI or another window, or one stuck in flight,
 * show at the minute's read.
 */
export function watchAfterRead(
  plans: readonly { in_flight: number }[],
  now: number,
  w: Watch,
): Watch {
  if (now >= w.until || !plans.some((p) => p.in_flight > 0)) return w;
  return { ...w, until: Math.min(w.cap, Math.max(w.until, now + WATCH_MS)) };
}

/**
 * The chat answers card's settings after a fresh read on return (PR #127 review N-2): the
 * count and the limit it is shown against come from the same fresh read, while the version
 * (and so what a save is checked against) stays the one the form was filled from.
 */
export function withFreshCount<
  T extends { used_24h: number; daily_limit: number },
>(prev: T | null, fresh: T): T {
  return prev
    ? { ...prev, used_24h: fresh.used_24h, daily_limit: fresh.daily_limit }
    : fresh;
}
