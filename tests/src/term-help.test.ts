import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

// F12 term help: the studio's own words carry one short definition each, shown on hover,
// keyboard focus or a tap in the Standard view, and dismissable without moving (WCAG 1.4.13).

type TipState = { open: boolean; pinned: boolean };
type TipEvent = 'enter' | 'leave' | 'focus' | 'blur' | 'click' | 'escape';
type Terms = {
  TERMS: Record<string, { label: string; definition: string }>;
  TERM_KEYS: string[];
  TIP_CLOSED: TipState;
  nextTip: (s: TipState, e: TipEvent) => TipState;
  GUTTER: number;
  tipShift: (termLeft: number, width: number, room: number) => number;
};

const web = createRequire(
  new URL('../../apps/web/src/term.tsx', import.meta.url),
);

/** A web module compiled for Node; `stubs` stand in for its sibling imports. */
async function compile<T>(file: string, stubs: Record<string, unknown> = {}) {
  const code = ts.transpileModule(
    await readFile(`apps/web/src/${file}`, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {} as T;
  new Function('require', 'exports', code)(
    (n: string) => (n in stubs ? stubs[n] : web(n)),
    exports,
  );
  return exports;
}

const load = () => compile<Terms>('terms.ts');

const run = (t: Terms, events: TipEvent[]) =>
  events.reduce((s, e) => t.nextTip(s, e), t.TIP_CLOSED);

test('hover and focus show a definition; leaving or blurring closes it', async () => {
  const t = await load();
  assert.deepEqual(run(t, ['enter']), { open: true, pinned: false });
  assert.deepEqual(run(t, ['enter', 'leave']), t.TIP_CLOSED);
  assert.deepEqual(run(t, ['focus']), { open: true, pinned: false });
  assert.deepEqual(run(t, ['focus', 'blur']), t.TIP_CLOSED);
});

test('a tap or click pins it open until a second click, blur or Escape', async () => {
  const t = await load();
  // Touch has no hover: a tap alone opens it, and it stays when the pointer "leaves".
  assert.deepEqual(run(t, ['click', 'leave']), { open: true, pinned: true });
  assert.deepEqual(run(t, ['enter', 'click', 'leave']), {
    open: true,
    pinned: true,
  });
  assert.deepEqual(run(t, ['click', 'click']), t.TIP_CLOSED);
  assert.deepEqual(run(t, ['click', 'blur']), t.TIP_CLOSED);
  // Mouse: pressing focuses the button first, then the click pins it.
  assert.deepEqual(run(t, ['enter', 'focus', 'click']), {
    open: true,
    pinned: true,
  });
});

test('Escape closes it however it was opened, without moving pointer or focus', async () => {
  const t = await load();
  for (const opened of [['enter'], ['focus'], ['click']] as TipEvent[][]) {
    assert.deepEqual(run(t, [...opened, 'escape']), t.TIP_CLOSED, opened[0]);
  }
  // Still hovering after Escape: it stays closed until the pointer comes back.
  assert.deepEqual(run(t, ['enter', 'escape', 'leave']), t.TIP_CLOSED);
  assert.deepEqual(run(t, ['enter', 'escape', 'leave', 'enter']), {
    open: true,
    pinned: false,
  });
});

test('every definition is short, plain and unique to its term', async () => {
  const t = await load();
  assert.deepEqual(t.TERM_KEYS, Object.keys(t.TERMS));
  const labels = new Set<string>();
  for (const k of t.TERM_KEYS) {
    const { label, definition } = t.TERMS[k]!;
    assert.ok(!labels.has(label.toLowerCase()), `two terms called ${label}`);
    labels.add(label.toLowerCase());
    assert.ok(definition.length >= 40 && definition.length <= 240, k);
    assert.match(definition, /^[A-Z].*\.$/, `${k} reads as a sentence`);
    // Standard shows no internal names (UX pass 6.J).
    assert.doesNotMatch(definition, /\bADR\b|\bP\d+\b|_[a-z]/, k);
  }
  // The terms the feature idea named, and the UX pass's list of words to explain.
  for (const k of [
    'claim',
    'passage',
    'gate',
    'held_out_case',
    'qualification',
    'reservation',
    'routine_approval',
    'humility_review',
    'freeze',
  ])
    assert.ok(k in t.TERMS, k);
});

test('every glossary word is explained on at least one page', async () => {
  // Which words a page may name is already typed (TermKey); this catches a word nobody uses.
  const t = await load();
  const dir = 'apps/web/src';
  const used = new Set<string>();
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.tsx')) continue;
    const src = await readFile(`${dir}/${f}`, 'utf8');
    for (const m of src.matchAll(/<Term term="([a-z_]+)"/g)) used.add(m[1]!);
  }
  assert.deepEqual(
    t.TERM_KEYS.filter((k) => !used.has(k)),
    [],
    'a glossary word no page explains',
  );
});

test('a definition near the window edge moves left but not past the gutter', async () => {
  const { tipShift, GUTTER } = await load();
  const room = 390 - GUTTER; // a 390 px phone
  assert.equal(tipShift(20, 320, room), 0); // fits as it is
  assert.equal(tipShift(207, 320, room), -(207 + 320 - room)); // ends at the gutter
  assert.equal(tipShift(300, 400, room), -(300 - GUTTER)); // starts at the gutter at most
  assert.equal(tipShift(10, 500, room), 0); // already at the edge: no move right
});

test('Standard renders a described button; Advanced renders the plain word', async () => {
  const t = await load();
  const server = web('react-dom/server') as {
    renderToStaticMarkup: (e: unknown) => string;
  };
  const { createElement } = web('react') as {
    createElement: (c: unknown, p: unknown, ...k: unknown[]) => unknown;
  };
  const render = async (standard: boolean) => {
    const mod = await compile<{ Term: unknown }>('term.tsx', {
      './view-mode.js': { useViewMode: () => ({ standard }) },
      './terms.js': t,
      './term.css': {},
    });
    return server.renderToStaticMarkup(
      createElement(mod.Term, { term: 'claim' }, 'claims'),
    );
  };
  assert.equal(await render(false), 'claims');
  const html = await render(true);
  const described = /aria-describedby="([^"]+)"/.exec(html)?.[1];
  assert.ok(described, html);
  // The description is the definition alone, so a reader doesn't say the word twice.
  assert.ok(
    html.includes(
      `<span id="${described}">${t.TERMS.claim!.definition}</span>`,
    ),
  );
  assert.match(html, /<strong aria-hidden="true">Claim:<\/strong>/);
  assert.match(
    html,
    /<button type="button" class="term"[^>]*>claims<\/button>/,
  );
  // A tooltip trigger, not a disclosure: no expanded or collapsed state is announced.
  assert.doesNotMatch(html, /aria-expanded|aria-controls/);
  assert.match(html, /role="tooltip"[^>]*hidden=""/);
});
