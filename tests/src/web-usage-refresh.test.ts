import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// PR #127 review L-1, N-1, N-2: the usage button keeps reading every few seconds while plan
// work may still be running after the click that started it, and the chat answers card shows a
// fresh count against the limit from the same read. usage-refresh.ts has no imports.
type Settings = { used_24h: number; daily_limit: number; version: number };
type Watch = { until: number; cap: number };
type Refresh = {
  REFRESH_MS: number;
  FAST_MS: number;
  WATCH_MS: number;
  MAX_WATCH_MS: number;
  NO_WATCH: Watch;
  nextReadMs: (now: number, w: Watch, hidden: boolean) => number;
  watchAfterWrite: (now: number, w: Watch) => Watch;
  watchAfterRead: (
    plans: { in_flight: number }[],
    now: number,
    w: Watch,
    writeOpen?: boolean,
  ) => Watch;
  withFreshCount: (prev: Settings | null, fresh: Settings) => Settings;
};
async function load(): Promise<Refresh> {
  const source = await readFile('apps/web/src/usage-refresh.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Refresh;
  new Function('exports', code)(exports);
  return exports;
}

test('usage reads stay fast while a background plan request runs, then fall back', async () => {
  const r = await load();
  assert.ok(r.FAST_MS < r.REFRESH_MS);
  const t0 = 1_000_000;
  const running = [{ in_flight: 0 }, { in_flight: 1 }];
  // Idle: a running request seen at the minute's read (CLI, another window) starts nothing.
  assert.deepEqual(r.watchAfterRead(running, t0, r.NO_WATCH), r.NO_WATCH);
  assert.equal(r.nextReadMs(t0, r.NO_WATCH, false), r.REFRESH_MS);
  // A write in this window starts a watch; nothing is running yet (a build's first request has
  // not started), but reads stay fast for the watch.
  let w = r.watchAfterWrite(t0, r.NO_WATCH);
  assert.equal(r.nextReadMs(t0 + 300, w, false), r.FAST_MS);
  // A read sees a request running (a build, or an answer the browser stopped waiting for): the
  // watch extends past the original window, so the request's end is counted within seconds.
  const seen = t0 + r.WATCH_MS - 1_000;
  w = r.watchAfterRead(running, seen, w);
  assert.equal(w.until, seen + r.WATCH_MS);
  assert.equal(r.nextReadMs(t0 + r.WATCH_MS + 5_000, w, false), r.FAST_MS);
  // Nothing running: not extended, and once over, reads go back to every minute.
  assert.deepEqual(r.watchAfterRead([{ in_flight: 0 }], w.until - 1, w), w);
  assert.equal(r.nextReadMs(w.until, w, false), r.REFRESH_MS);
  // A hidden window never reads fast.
  assert.equal(r.nextReadMs(t0, w, true), r.REFRESH_MS);
});

test('a request stuck in flight cannot keep the watch going past its cap', async () => {
  const r = await load();
  const t0 = 1_000_000;
  const stuck = [{ in_flight: 1 }];
  let w = r.watchAfterWrite(t0, r.NO_WATCH);
  // Every fast read sees the stuck request; the watch stops at the cap all the same.
  let now = t0;
  let reads = 0;
  while (r.nextReadMs(now, w, false) === r.FAST_MS && reads < 10_000) {
    now += r.FAST_MS;
    w = r.watchAfterRead(stuck, now, w);
    reads++;
  }
  assert.ok(now <= t0 + r.MAX_WATCH_MS + r.FAST_MS);
  assert.ok(reads <= r.MAX_WATCH_MS / r.FAST_MS + 1);
  // Later minute reads still see it running, but no new watch starts without a write.
  assert.deepEqual(r.watchAfterRead(stuck, now + r.REFRESH_MS, w), w);
  assert.equal(r.nextReadMs(now + r.REFRESH_MS, w, false), r.REFRESH_MS);
  // A new write starts a new, again capped, watch.
  const later = now + 5 * r.REFRESH_MS;
  const w2 = r.watchAfterWrite(later, w);
  assert.equal(w2.cap, later + r.MAX_WATCH_MS);
  assert.equal(r.nextReadMs(later + 1, w2, false), r.FAST_MS);
});

test('a long write from this window keeps the count live past the cap until it ends', async () => {
  // PR #170 review L-1: a qualification run is one request that can last an hour.
  const r = await load();
  const running = [{ in_flight: 1 }];
  const t0 = 1_000_000;
  let w = r.watchAfterWrite(t0, r.NO_WATCH);
  // Eleven minutes in, with the run still open here, reads stay fast.
  for (let now = t0; now <= t0 + 11 * 60_000; now += r.FAST_MS)
    w = r.watchAfterRead(running, now, w, true);
  const later = t0 + 11 * 60_000 + 1;
  assert.equal(r.nextReadMs(later, w, false), r.FAST_MS);
  assert.ok(w.cap > t0 + r.MAX_WATCH_MS);
  // Once the write has ended, a request still shown in flight (stuck, or from elsewhere) keeps
  // the watch only until the cap that is now fixed.
  const capped = w.cap;
  let now = later;
  for (; now < capped + r.WATCH_MS; now += r.FAST_MS)
    w = r.watchAfterRead(running, now, w, false);
  assert.equal(w.cap, capped);
  assert.equal(r.nextReadMs(now, w, false), r.REFRESH_MS);
  // No request in flight: an open write alone does not start or move anything.
  assert.deepEqual(r.watchAfterRead([{ in_flight: 0 }], now, w, true), w);
});

test('the chat card takes count and limit from the fresh read but keeps its version', async () => {
  const r = await load();
  const filled = { used_24h: 0, daily_limit: 20, version: 3 };
  // Another tab saved a new limit (version 4) and two answers were asked since.
  const fresh = { used_24h: 2, daily_limit: 7, version: 4 };
  assert.deepEqual(r.withFreshCount(filled, fresh), {
    used_24h: 2,
    daily_limit: 7,
    version: 3,
  });
  assert.deepEqual(r.withFreshCount(null, fresh), fresh);
});
