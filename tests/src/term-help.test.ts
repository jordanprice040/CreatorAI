import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
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
};

async function load(): Promise<Terms> {
  const source = await readFile('apps/web/src/terms.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as Terms;
  new Function('exports', code)(exports);
  return exports;
}

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

test('every term is explained on at least one page, and pages name only known terms', async () => {
  const t = await load();
  const dir = 'apps/web/src';
  const used = new Set<string>();
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.tsx')) continue;
    const src = await readFile(`${dir}/${f}`, 'utf8');
    for (const m of src.matchAll(/<Term term="([a-z_]+)"/g)) used.add(m[1]!);
  }
  assert.deepEqual(
    [...used].filter((k) => !(k in t.TERMS)),
    [],
  );
  assert.deepEqual(
    t.TERM_KEYS.filter((k) => !used.has(k)),
    [],
    'a glossary word no page explains',
  );
});
