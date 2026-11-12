import { useEffect, useState } from 'react';
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

/**
 * Audit 2026-11-12 N-4: the end time a form confirms. It is fixed while the person reads the
 * summary (so what they confirm is what is sent), and worked out again when the hours change,
 * when the page is shown again and when the window comes back into view, so a form left open
 * overnight does not confirm an end time that has already passed. The second value sets it
 * again now (for a check just before sending).
 */
export function useEndTime(hours: number | string, maxDays?: number) {
  const [endsAt, setEndsAt] = useState(() => endAfter(hours, maxDays));
  const again = () => setEndsAt(endAfter(hours, maxDays));
  useEffect(again, [hours, maxDays]);
  useOnShow(again);
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const seen = () => {
      if (document.visibilityState === 'visible') again();
    };
    document.addEventListener('visibilitychange', seen);
    return () => document.removeEventListener('visibilitychange', seen);
  }, [hours, maxDays]);
  return [endsAt, again] as const;
}
