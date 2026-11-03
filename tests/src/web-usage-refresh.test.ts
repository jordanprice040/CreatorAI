import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// PR #127 review L-1, N-1, N-2: the usage button keeps reading every few seconds while plan
// work may still be running after the click that started it, and the chat answers card shows a
// fresh count against the limit from the same read. usage-refresh.ts has no imports.
type Settings = { used_24h: number; daily_limit: number; version: number };
type Refresh = {
  REFRESH_MS: number;
  FAST_MS: number;
  WATCH_MS: number;
  nextReadMs: (now: number, watchUntil: number, hidden: boolean) => number;
  watchAfterRead: (
    plans: { in_flight: number }[],
    now: number,
    watchUntil: number,
  ) => number;
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
  // A write in this window starts a watch; nothing running is seen yet (a build's first request
  // has not started), but reads stay fast for the watch.
  let until = t0 + r.WATCH_MS;
  assert.equal(r.nextReadMs(t0 + 300, until, false), r.FAST_MS);
  // A read sees a request running (a build, or an answer the browser stopped waiting for): the
  // watch extends past the original window, so the request's end is counted within seconds.
  const seen = t0 + r.WATCH_MS - 1_000;
  until = r.watchAfterRead([{ in_flight: 0 }, { in_flight: 1 }], seen, until);
  assert.equal(until, seen + r.WATCH_MS);
  assert.equal(r.nextReadMs(t0 + r.WATCH_MS + 5_000, until, false), r.FAST_MS);
  // Nothing running: the watch is not extended, and once over reads go back to every minute.
  assert.equal(r.watchAfterRead([{ in_flight: 0 }], until - 1, until), until);
  assert.equal(r.nextReadMs(until, until, false), r.REFRESH_MS);
  // A hidden window never reads fast.
  assert.equal(r.nextReadMs(t0, until, true), r.REFRESH_MS);
  // A watch already further out is never shortened by a later read.
  assert.equal(
    r.watchAfterRead([{ in_flight: 2 }], t0, t0 + 10 * r.WATCH_MS),
    t0 + 10 * r.WATCH_MS,
  );
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
