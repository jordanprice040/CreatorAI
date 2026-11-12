import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Audit 2026-11-12 L-1, L-2 and N-4: the real hooks run against a small stand-in for React's
// state, ref and effect slots (no DOM and no new test dependency).

const nodeRequire = createRequire(
  new URL('../../apps/web/package.json', import.meta.url),
);

/** Hook slots kept across "renders"; effects run when their dependencies change. */
function hookHost() {
  let cursor = 0;
  const slots: unknown[] = [];
  const effects: {
    deps: unknown[] | undefined;
    cleanup: void | (() => void);
  }[] = [];
  let effectCursor = 0;
  const pending: (() => void)[] = [];
  const react = {
    useState: (initial: unknown) => {
      const i = cursor++;
      if (!(i in slots))
        slots[i] = typeof initial === 'function' ? initial() : initial;
      return [
        slots[i],
        (next: unknown) => {
          slots[i] =
            typeof next === 'function'
              ? (next as (v: unknown) => unknown)(slots[i])
              : next;
        },
      ];
    },
    useRef: (initial: unknown) => {
      const i = cursor++;
      if (!(i in slots)) slots[i] = { current: initial };
      return slots[i];
    },
    useEffect: (fn: () => void | (() => void), deps?: unknown[]) => {
      const i = effectCursor++;
      const prev = effects[i];
      const changed =
        !prev ||
        !deps ||
        !prev.deps ||
        deps.length !== prev.deps.length ||
        deps.some((d, k) => !Object.is(d, prev.deps![k]));
      if (!changed) return;
      pending.push(() => {
        if (typeof prev?.cleanup === 'function') prev.cleanup();
        effects[i] = { deps, cleanup: fn() };
      });
    },
    useContext: (c: { value: unknown }) => c.value,
    createContext: (value: unknown) => ({ value }),
  };
  return {
    react,
    /** Runs one render of `hook`, then its effects. */
    render<T>(hook: () => T): T {
      cursor = 0;
      effectCursor = 0;
      const out = hook();
      for (const run of pending.splice(0)) run();
      return out;
    },
    unmount() {
      for (const e of effects)
        if (typeof e?.cleanup === 'function') e.cleanup();
    },
  };
}

function load<T>(file: string, stubs: Record<string, unknown>): T {
  const code = ts.transpileModule(
    readFileSync(`apps/web/src/${file}`, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  const exports = {} as T;
  new Function('require', 'exports', code)(
    (name: string) => (name in stubs ? stubs[name] : nodeRequire(name)),
    exports,
  );
  return exports;
}

const settle = () => new Promise<void>((r) => setImmediate(r));

type Loaded<T> = {
  data: T | null;
  error: string;
  stale: string;
  loading: boolean;
  refresh: () => void;
  reload: () => void;
};

test('a failed background refresh keeps what the view shows; a full load still clears it', async () => {
  const host = hookHost();
  const ui = load<{
    useLoad: <T>(f: () => Promise<T>, deps: unknown[]) => Loaded<T>;
  }>('ui.tsx', {
    react: host.react,
    './page-active.js': { useOnShow: () => {} },
    './oversight.js': { message: (e: Error) => e.message },
    './pages.js': {},
    './labels.js': {},
  });
  let answer: () => Promise<string[]> = async () => ['one'];
  const hook = () => ui.useLoad(() => answer(), ['ws']);
  let v = host.render(hook);
  await settle();
  v = host.render(hook);
  assert.deepEqual(v.data, ['one']);

  // A poll fails: the data stays (so a panel's "still running" stays true and it keeps
  // polling), the error box is not shown, and the stale note says why.
  answer = async () => {
    throw new Error('Database unavailable.');
  };
  v.refresh();
  v = host.render(hook);
  await settle();
  v = host.render(hook);
  assert.deepEqual(v.data, ['one']);
  assert.equal(v.error, '');
  assert.equal(v.stale, 'Database unavailable.');

  // The next poll that works clears the note.
  answer = async () => ['two'];
  v.refresh();
  v = host.render(hook);
  await settle();
  v = host.render(hook);
  assert.deepEqual(v.data, ['two']);
  assert.equal(v.stale, '');

  // A full reload (Try again) that fails still shows the error, as before.
  answer = async () => {
    throw new Error('Gone.');
  };
  v.reload();
  v = host.render(hook);
  await settle();
  v = host.render(hook);
  assert.equal(v.data, null);
  assert.equal(v.error, 'Gone.');
  host.unmount();
});

test('a first load that fails is an error even when it was a quiet read', async () => {
  const host = hookHost();
  let show: (() => void) | null = null;
  const ui = load<{
    useLoad: <T>(f: () => Promise<T>, deps: unknown[]) => Loaded<T>;
  }>('ui.tsx', {
    react: host.react,
    './page-active.js': {
      useOnShow: (f: () => void) => {
        show = f;
      },
    },
    './oversight.js': { message: (e: Error) => e.message },
    './pages.js': {},
    './labels.js': {},
  });
  const hook = () =>
    ui.useLoad(async () => {
      throw new Error('No database.');
    }, ['ws']);
  let v = host.render(hook);
  await settle();
  v = host.render(hook);
  assert.equal(v.error, 'No database.');
  // Coming back to the page reads quietly, but with nothing shown yet it is still an error.
  show!();
  v = host.render(hook);
  await settle();
  v = host.render(hook);
  assert.equal(v.error, 'No database.');
  assert.equal(v.stale, '');
  host.unmount();
});

test('polls run only while the page is shown and the window is visible', async () => {
  const realDocument = (globalThis as { document?: unknown }).document;
  const doc = { visibilityState: 'visible' };
  (globalThis as { document?: unknown }).document = doc;
  try {
    const host = hookHost();
    const active = { value: true };
    const pa = load<{
      usePoll: (tick: () => void, ms: number, enabled: boolean) => void;
    }>('page-active.ts', {
      react: { ...host.react, useContext: () => active.value },
    });
    let ticks = 0;
    let enabled = true;
    const hook = () => pa.usePoll(() => ticks++, 5, enabled);
    const wait = () => new Promise((r) => setTimeout(r, 40));
    host.render(hook);
    await wait();
    assert.ok(ticks > 0, 'polls while shown');
    // The window is hidden (minimised or another browser tab): no reads.
    doc.visibilityState = 'hidden';
    let before = ticks;
    await wait();
    assert.equal(ticks, before);
    doc.visibilityState = 'visible';
    // Another studio page is shown: the interval stops.
    active.value = false;
    host.render(hook);
    before = ticks;
    await wait();
    assert.equal(ticks, before);
    // Back on the page it polls again; nothing running stops it.
    active.value = true;
    host.render(hook);
    await wait();
    assert.ok(ticks > before);
    enabled = false;
    host.render(hook);
    before = ticks;
    await wait();
    assert.equal(ticks, before);
    host.unmount();
  } finally {
    (globalThis as { document?: unknown }).document = realDocument;
  }
});

test('end times are on the minute, never in the past, and capped where the server caps them', () => {
  const host = hookHost();
  const { endAfter } = load<{
    endAfter: (h: number | string, maxDays?: number, now?: number) => string;
  }>('end-time.ts', {
    react: host.react,
    './page-active.js': { useOnShow: () => {} },
  });
  const now = Date.parse('2026-11-12T10:00:30.000Z');
  assert.equal(endAfter(2, undefined, now), '2026-11-12T12:01:00.000Z');
  assert.equal(endAfter('24', undefined, now), '2026-11-13T10:01:00.000Z');
  for (const bad of ['', 'x', -3, Number.NaN])
    assert.equal(endAfter(bad, undefined, now), '2026-11-12T10:01:00.000Z');
  // 100 days asked, 90 allowed: the last whole minute before the 90-day limit.
  assert.equal(endAfter(2400, 90, now), '2027-02-10T09:59:00.000Z');
});

test('review R-N4: a refresh that lands with new dependencies is a full load', async () => {
  const host = hookHost();
  const ui = load<{
    useLoad: <T>(f: () => Promise<T>, deps: unknown[]) => Loaded<T>;
  }>('ui.tsx', {
    react: host.react,
    './page-active.js': { useOnShow: () => {} },
    './oversight.js': { message: (e: Error) => e.message },
    './pages.js': {},
    './labels.js': {},
  });
  let ws = 'A';
  let answer: () => Promise<string> = async () => 'A data';
  const hook = () => ui.useLoad(() => answer(), [ws]);
  let v = host.render(hook);
  await settle();
  v = host.render(hook);
  assert.equal(v.data, 'A data');
  // Workspace B is picked in the same render as a poll's refresh, and B's read fails.
  answer = async () => {
    throw new Error('B unavailable.');
  };
  ws = 'B';
  v.refresh();
  v = host.render(hook);
  await settle();
  v = host.render(hook);
  assert.equal(v.data, null, 'A’s data is not shown as B’s');
  assert.equal(v.error, 'B unavailable.');
  assert.equal(v.stale, '');
  host.unmount();
});

test('review R-N2: an end time is read again only once it is close or past', () => {
  const host = hookHost();
  const { endTimeClose } = load<{
    endTimeClose: (endsAt: string, now?: number) => boolean;
  }>('end-time.ts', {
    react: host.react,
    './page-active.js': { useOnShow: () => {} },
  });
  const now = Date.parse('2026-11-12T10:00:00.000Z');
  assert.equal(endTimeClose('2026-11-12T11:00:00.000Z', now), false);
  assert.equal(endTimeClose('2026-11-12T10:04:00.000Z', now), true);
  assert.equal(endTimeClose('2026-11-12T09:00:00.000Z', now), true);
});

test('review R-L2: every view that reads with useLoad shows when a refresh failed', () => {
  const dir = 'apps/web/src';
  const missing: string[] = [];
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.tsx'))) {
    if (f === 'ui.tsx') continue;
    const text = readFileSync(`${dir}/${f}`, 'utf8');
    for (const m of text.matchAll(/const (\w+) = useLoad\b/g))
      if (!text.includes(`${m[1]}.stale`)) missing.push(`${f}: ${m[1]}`);
  }
  assert.deepEqual(missing, []);
});
