// When the top bar's usage button reads again (PR #127 review L-1, N-1). Builds,
// qualifications and an answer the browser stopped waiting for keep making plan requests on
// the server after the click that started them, so after any write in this window, and while
// a read shows a plan request running, the button reads every few seconds instead of every
// minute. No imports, so tests load it directly.

export const REFRESH_MS = 60_000;
export const FAST_MS = 3_000;
export const WATCH_MS = 30_000;

/** How long until the next read: soon while watching (and the window is shown), else a minute. */
export function nextReadMs(now: number, watchUntil: number, hidden: boolean) {
  return !hidden && now < watchUntil ? FAST_MS : REFRESH_MS;
}

/** A read that shows a plan request running keeps watching until WATCH_MS after it. */
export function watchAfterRead(
  plans: readonly { in_flight: number }[],
  now: number,
  watchUntil: number,
) {
  return plans.some((p) => p.in_flight > 0)
    ? Math.max(watchUntil, now + WATCH_MS)
    : watchUntil;
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
