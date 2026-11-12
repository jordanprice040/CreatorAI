import { useEffect, useRef, useState } from 'react';
import { useOnShow } from './page-active.js';

const MINUTE = 60_000;

/**
 * The end time `hours` from now, on the minute; a blank, zero or bad number means now. With
 * `maxDays`, never later than that many days from now (rounded down to the minute), as the
 * server refuses anything past it.
 */
export function endAfter(
  hours: number | string,
  maxDays?: number,
  now = Date.now(),
): string {
  const h = Number(hours);
  const ms = Number.isFinite(h) && h > 0 ? h * 3_600_000 : 0;
  const end = Math.ceil((now + ms) / MINUTE) * MINUTE;
  const latest =
    maxDays === undefined
      ? end
      : Math.floor((now + maxDays * 86_400_000 - MINUTE) / MINUTE) * MINUTE;
  return new Date(Math.min(end, latest)).toISOString();
}

/** How close an end time may come before a form open on it works it out again. */
export const END_TIME_MARGIN_MS = 5 * MINUTE;

/**
 * Audit 2026-11-12 N-4: the end time a form confirms. It is fixed while the person reads the
 * summary (so what they confirm is what is sent), and worked out again when the hours change.
 * When the page is shown again or the window comes back into view, it is worked out again from
 * now unless `keep` is true (the summary is confirmed); a confirmed end time is worked out again
 * only if it has passed or is within `END_TIME_MARGIN_MS` (PR #191 review R-N2), so switching
 * windows does not untick a confirmation for nothing. The second value sets it again now.
 */
export function useEndTime(
  hours: number | string,
  maxDays?: number,
  keep = false,
) {
  const [endsAt, setEndsAt] = useState(() => endAfter(hours, maxDays));
  const current = useRef(endsAt);
  current.current = endsAt;
  const kept = useRef(keep);
  kept.current = keep;
  const again = () => setEndsAt(endAfter(hours, maxDays));
  const ifClose = () => {
    if (!kept.current || endTimeClose(current.current)) again();
  };
  useEffect(again, [hours, maxDays]);
  useOnShow(ifClose);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const seen = () => {
      if (document.visibilityState === 'visible') ifClose();
    };
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [hours, maxDays]);
  return [endsAt, again] as const;
}

/** Whether an end time has passed or is within the margin. */
export function endTimeClose(endsAt: string, now = Date.now()): boolean {
  return Date.parse(endsAt) < now + END_TIME_MARGIN_MS;
}
