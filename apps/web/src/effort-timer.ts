/**
 * ADR-0122 (F13): the study effort timer's clock, kept free of the DOM so tests can drive it.
 * Every moment of a step falls in exactly one bucket:
 * - active: the page is visible and focused, and the person edited within the idle window;
 * - wait: otherwise, a studio request is in flight (the person is waiting on the studio);
 * - idle: otherwise, the page is visible and focused but the person is not editing (reading,
 *   say);
 * - away: the rest (the page is hidden or another window has focus).
 * It only measures time; it records nothing about who the person is.
 */
export type EffortTotals = {
  active_ms: number;
  wait_ms: number;
  idle_ms: number;
  away_ms: number;
};

export class EffortClock {
  #last: number;
  #visible: boolean;
  #focused: boolean;
  #lastInput: number | null = null;
  #inFlight = 0;
  #totals: EffortTotals = {
    active_ms: 0,
    wait_ms: 0,
    idle_ms: 0,
    away_ms: 0,
  };
  readonly idleMs: number;

  constructor(
    now: number,
    s: { visible: boolean; focused: boolean },
    idleMs: number,
  ) {
    this.#last = now;
    this.#visible = s.visible;
    this.#focused = s.focused;
    this.idleMs = idleMs;
  }

  /** Splits the time since the last signal into the buckets, then moves the clock to `now`. */
  #advance(now: number) {
    const from = this.#last;
    const to = Math.max(from, now);
    this.#last = to;
    if (to === from) return;
    const activeEnd =
      this.#visible && this.#focused && this.#lastInput !== null
        ? Math.min(to, this.#lastInput + this.idleMs)
        : from;
    const active = Math.max(0, activeEnd - from);
    const rest = to - from - active;
    this.#totals.active_ms += active;
    if (this.#inFlight > 0) this.#totals.wait_ms += rest;
    else if (this.#visible && this.#focused) this.#totals.idle_ms += rest;
    else this.#totals.away_ms += rest;
  }

  edited(now: number) {
    this.#advance(now);
    this.#lastInput = this.#last;
  }
  visibility(now: number, visible: boolean) {
    this.#advance(now);
    this.#visible = visible;
  }
  focus(now: number, focused: boolean) {
    this.#advance(now);
    this.#focused = focused;
  }
  requestStarted(now: number) {
    this.#advance(now);
    this.#inFlight += 1;
  }
  requestEnded(now: number) {
    this.#advance(now);
    this.#inFlight = Math.max(0, this.#inFlight - 1);
  }
  /** Whole milliseconds up to `now`; the server checks them against its own clock. */
  totals(now: number): EffortTotals {
    this.#advance(now);
    return {
      active_ms: Math.floor(this.#totals.active_ms),
      wait_ms: Math.floor(this.#totals.wait_ms),
      idle_ms: Math.floor(this.#totals.idle_ms),
      away_ms: Math.floor(this.#totals.away_ms),
    };
  }
}

/** "1 min 05 s" style text for the live readout. */
export function effortText(ms: number) {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  return m ? `${m} min ${String(s % 60).padStart(2, '0')} s` : `${s} s`;
}
