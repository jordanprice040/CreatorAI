import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// The step-9 page map: five pages holding the earlier screens as tabs. pages.ts has no
// imports, so it loads directly.
async function load<T>(file: string) {
  const source = await readFile(`apps/web/src/${file}`, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as T;
  new Function('exports', code)(exports);
  return exports;
}

type Route = { view: string; ws: string; id: string; q: string };
type Section = { view: string; slug: string; label: string; group?: string };
type Pages = {
  PAGES: { key: string; label: string; sections: Section[] }[];
  parseRoute: (hash: string) => Route;
  routeHash: (r: Route) => string;
  placeLabel: (view: string, from?: string) => string;
  tabsOf: (page: { sections: Section[] }) => { label: string }[];
};

/** Every screen the studio had before the page map; none may be lost. */
const OLD_VIEWS = [
  'overview',
  'submit',
  'catalog',
  'compare',
  'evidence',
  'decisions',
  'runs',
  'budgets',
  'scores',
  'search',
  'activity',
  'studies',
  'build',
  'gallery',
  'desktop',
  'operations',
  'marketing',
  'portfolio',
  'models',
  'settings',
  'github',
  'payments',
];

test('every earlier screen is a tab of exactly one page, with a unique address', async () => {
  const { PAGES, routeHash, parseRoute } = await load<Pages>('pages.ts');
  assert.equal(PAGES.length, 5);
  const views = PAGES.flatMap((p) => p.sections.map((s) => s.view));
  for (const v of OLD_VIEWS)
    assert.equal(views.filter((x) => x === v).length, 1, v);
  assert.equal(new Set(views).size, views.length);
  // Each view's address reads back as the same view.
  const hashes = new Set<string>();
  for (const view of views) {
    const hash = routeHash({ view, ws: 'w1', id: '', q: '' });
    hashes.add(hash);
    assert.equal(parseRoute(hash).view, view, hash);
  }
  assert.equal(hashes.size, views.length);
});

test('addresses from before the page map still open the same screen', async () => {
  const { parseRoute, routeHash } = await load<Pages>('pages.ts');
  for (const view of OLD_VIEWS) {
    const r = parseRoute(`#/${view}?ws=w1&id=abc&q=x%20y`);
    assert.equal(r.view, view, view);
    assert.deepEqual([r.ws, r.id, r.q], ['w1', 'abc', 'x y']);
  }
  // A legacy address is rewritten to its page and tab, keeping what was open.
  assert.equal(
    routeHash(parseRoute('#/decisions?ws=w1&id=d9')),
    '#/monitor/approvals?ws=w1&id=d9',
  );
  assert.equal(
    routeHash(parseRoute('#/compare?ws=w1')),
    '#/projects/decide?ws=w1',
  );
});

test('a page without a known tab opens its first tab; anything else opens the monitor', async () => {
  const { parseRoute } = await load<Pages>('pages.ts');
  assert.equal(parseRoute('#/projects').view, 'path');
  assert.equal(parseRoute('#/projects/nope?ws=w1').view, 'path');
  assert.equal(parseRoute('#/sources?ws=w1').view, 'evidence');
  assert.equal(parseRoute('#/connections').view, 'models');
  assert.equal(parseRoute('#/settings/study').view, 'studies');
  assert.equal(parseRoute('').view, 'overview');
  assert.equal(parseRoute('#/unknown?ws=w1').view, 'overview');
  assert.equal(parseRoute('#login=abc').view, 'overview');
});

test('buttons name the page only when the tab is on another page', async () => {
  const { placeLabel, tabsOf, PAGES } = await load<Pages>('pages.ts');
  assert.equal(placeLabel('build', 'compare'), 'Build');
  assert.equal(placeLabel('build', 'overview'), 'Projects › Build');
  assert.equal(placeLabel('payments'), 'Projects › Launch › Sell');
  // The three launch screens share one tab.
  const projects = PAGES.find((p) => p.key === 'projects')!;
  assert.deepEqual(
    tabsOf(projects).map((t) => t.label),
    [
      'Path',
      'Discover',
      'Decide',
      'Scores and specs',
      'Build',
      'Try',
      'Launch',
    ],
  );
});
