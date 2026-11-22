import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';

// Standard-mode simplification (Jordan, November 22): Standard folds explanations, lists and
// whole sections behind one line; Advanced renders them open, as before.
const require = createRequire(
  new URL('../../apps/web/package.json', import.meta.url),
);
type H = (t: unknown, p: object | null, ...c: unknown[]) => unknown;
const { createElement: h } = require('react') as { createElement: H };
const { renderToStaticMarkup } = require('react-dom/server') as {
  renderToStaticMarkup: (e: unknown) => string;
};

async function explain(standard: boolean) {
  const source = await readFile('apps/web/src/explain.tsx', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const exports: Record<string, (p: object) => unknown> = {};
  new Function('require', 'exports', code)(
    (name: string) =>
      name === './view-mode.js'
        ? { useViewMode: () => ({ standard }) }
        : require(name),
    exports,
  );
  const render = (name: string, props: object) =>
    renderToStaticMarkup(h(exports[name] as never, props));
  return render;
}

test('Explain: Standard shows one line and keeps the full text one click away; Advanced shows the text', async () => {
  const std = await explain(true);
  const html = std('Explain', { short: 'One line.', children: 'Full text.' });
  assert.match(html, /^<details class="explain-fold"><summary>/);
  assert.match(html, /One line\./);
  assert.match(html, /<p class="small">Full text\.<\/p><\/details>$/);
  assert.match(std('Explain', { children: 'x' }), /About this/);
  const adv = await explain(false);
  assert.equal(
    adv('Explain', { short: 'One line.', children: 'Full text.' }),
    '<p class="small">Full text.</p>',
  );
});

test('PointList: Standard keeps limits, data and "never" lines in view and folds the rest; Advanced shows all', async () => {
  const { routinePolicySummary } = require('@creator/contracts') as {
    routinePolicySummary: (p: object) => string[];
  };
  const points = routinePolicySummary({
    stages: ['selection'],
    data_classes: ['synthetic'],
    max_actions: 20,
    max_total_nano_usd: '5000000000',
    expires_at: '2026-11-23T06:20:00.000Z',
    stop_on: [],
  });
  const std = await explain(true);
  const adv = await explain(false);
  const folded = std('PointList', { title: 'Routine approvals', points });
  // Everything before the fold is in view; the money limit, step limit and end time are there.
  const visible = folded.slice(0, folded.indexOf('<details'));
  assert.match(visible, /up to \$5\.00 in total/);
  assert.match(visible, /at most 20 steps/);
  assert.match(visible, /ends 2026-11-23 06:20 UTC/);
  assert.match(visible, /Data: synthetic only\./);
  assert.match(visible, /Never covered: publishing/);
  assert.match(visible, /Still stops and asks you/);
  assert.doesNotMatch(visible, /For this run only/);
  assert.match(folded, /\d more points?, open to read/);
  const open = adv('PointList', { title: 'Routine approvals', points });
  assert.doesNotMatch(open, /details/);
  for (const p of points) {
    assert.ok(folded.includes(p.replaceAll("'", '&#x27;')), p);
    assert.ok(open.includes(p.replaceAll("'", '&#x27;')), p);
  }
});

test('the "I have read both summaries" box needs every folded summary opened, and a changed summary again', async () => {
  const source = await readFile('apps/web/src/explain.tsx', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const m: { allOpened?: (o: Set<string>, l: string[][]) => boolean } = {};
  new Function('require', 'exports', code)(
    (name: string) =>
      name === './view-mode.js' ? { useViewMode: () => ({}) } : require(name),
    m,
  );
  const a = ['What it does.'];
  const b = ['Limits: at most 20 steps.', 'Other.'];
  const opened = new Set<string>();
  assert.equal(m.allOpened!(opened, [a, b]), false);
  opened.add(a.join('\n'));
  assert.equal(m.allOpened!(opened, [a, b]), false);
  opened.add(b.join('\n'));
  assert.equal(m.allOpened!(opened, [a, b]), true);
  assert.equal(m.allOpened!(opened, [a, ['Limits: at most 30 steps.']]), false);
});

test('SectionFold: folded only in Standard, with the section unchanged inside', async () => {
  const std = await explain(true);
  const adv = await explain(false);
  const section = h('section', null, h('h3', null, 'Backups'));
  assert.match(
    std('SectionFold', { title: 'Backups', children: section }),
    /^<details class="section-fold"><summary>.*Backups.*<section><h3>Backups<\/h3><\/section><\/details>$/,
  );
  assert.equal(
    adv('SectionFold', { title: 'Backups', children: section }),
    '<section><h3>Backups</h3></section>',
  );
});

test('reveal opens every closed fold around its target and focuses a folded heading through its summary', async () => {
  const source = await readFile('apps/web/src/ui.tsx', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
    },
  }).outputText;
  const ui: {
    openFoldsAround?: (t: unknown) => number;
    focusTargetOf?: (t: unknown) => unknown;
  } = {};
  new Function('require', 'exports', code)(
    (name: string) =>
      name === 'react' || name.startsWith('@creator/')
        ? require(name)
        : name === './oversight.js'
          ? { message: (e: Error) => e.message }
          : {},
    ui,
  );
  // Minimal elements: a heading inside a closed section fold inside a closed outer fold.
  type El = {
    tag: string;
    cls?: string;
    open?: boolean;
    parent: El | null;
    height?: number;
  };
  const outer: El = { tag: 'details', open: false, parent: null };
  const wrap: El = { tag: 'div', parent: outer };
  const fold: El = {
    tag: 'details',
    cls: 'section-fold',
    open: false,
    parent: wrap,
  };
  const summary: El = { tag: 'summary', parent: fold };
  const heading: El = { tag: 'h3', parent: fold, height: 0 };
  const matches = (e: El, sel: string) =>
    sel === 'details'
      ? e.tag === 'details'
      : sel === 'details.section-fold'
        ? e.tag === 'details' && e.cls === 'section-fold'
        : false;
  const node = (e: El): Record<string, unknown> => ({
    el: e,
    get open() {
      return e.open === true;
    },
    set open(v: boolean) {
      e.open = v;
    },
    get parentElement() {
      return e.parent ? node(e.parent) : null;
    },
    tagName: e.tag.toUpperCase(),
    closest: (sel: string) => {
      for (let x: El | null = e; x; x = x.parent)
        if (matches(x, sel)) return node(x);
      return null;
    },
    querySelector: (sel: string) =>
      sel === ':scope > summary' && e === fold ? node(summary) : null,
    getBoundingClientRect: () => ({ height: e.height ?? 20 }),
  });
  assert.equal(ui.openFoldsAround!(node(heading)), 2);
  assert.equal(fold.open, true);
  assert.equal(outer.open, true);
  assert.equal(ui.openFoldsAround!(node(heading)), 0);
  assert.equal((ui.focusTargetOf!(node(heading)) as { el: El }).el, summary);
  heading.height = 24;
  assert.equal((ui.focusTargetOf!(node(heading)) as { el: El }).el, heading);
});
