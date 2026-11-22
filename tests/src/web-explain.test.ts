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

test('PointList and SectionFold: the same text in both modes, folded only in Standard', async () => {
  const points = ['First point.', 'Second point.'];
  const std = await explain(true);
  const adv = await explain(false);
  const folded = std('PointList', { title: 'What it does', points });
  assert.match(folded, /^<details class="point-list">/);
  assert.match(folded, /2 points, open to read/);
  const open = adv('PointList', { title: 'What it does', points });
  assert.doesNotMatch(open, /details/);
  for (const p of points) {
    assert.ok(folded.includes(p));
    assert.ok(open.includes(p));
  }
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
