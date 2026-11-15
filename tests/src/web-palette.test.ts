import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadWeb } from './web-module.js';

// ADR-0119 (F6): the command palette's rules. It lists every tab, offers forms only to roles
// that may use them, never starts work itself, and keeps its keys out of text fields.

type Target = { to: string; view?: string; ws?: string };
type Item = {
  key: string;
  group: string;
  label: string;
  hint: string;
  target: Target;
};
type Rules = {
  staticItems: (role: string) => Item[];
  workspaceItems: (
    ws: { id: string; name: string; role: string }[],
    current: string,
  ) => Item[];
  rankItems: (items: Item[], q: string) => Item[];
  grouped: (items: Item[]) => { group: string; items: Item[] }[];
  moveActive: (i: number, n: number, key: string) => number | null;
  isPaletteKey: (e: object, mac?: boolean) => boolean;
  isShortcutsKey: (e: object, t: object | null) => boolean;
  isTyping: (t: object | null) => boolean;
  SHORTCUTS: { keys: string[]; does: string }[];
};
type Pages = {
  PAGES: { key: string; sections: { view: string }[] }[];
};

const rules = () => loadWeb('palette-rules.ts') as Promise<Rules>;
const key = (k: string, mods: Partial<Record<string, boolean>> = {}) => ({
  key: k,
  ctrlKey: false,
  metaKey: false,
  altKey: false,
  shiftKey: false,
  ...mods,
});

test('the palette lists every tab once, including ones Standard hides', async () => {
  const r = await rules();
  const { PAGES } = (await loadWeb('pages.ts')) as Pages;
  const views = PAGES.flatMap((p) => p.sections.map((s) => s.view));
  const pageItems = r.staticItems('viewer').filter((i) => i.group === 'Pages');
  assert.deepEqual(
    pageItems.map((i) => i.target.view),
    views,
  );
  assert.ok(pageItems.some((i) => i.label === 'Monitor › Workers'));
});

test('forms are offered only to roles that may use them', async () => {
  const r = await rules();
  const actions = (role: string) =>
    r
      .staticItems(role)
      .filter((i) => i.group === 'Actions')
      .map((i) => i.label);
  assert.ok(actions('owner').includes('Start an autopilot'));
  assert.ok(!actions('editor').includes('Start an autopilot'));
  assert.ok(actions('editor').includes('Start a discovery'));
  for (const writing of [
    'Start an autopilot',
    'Start a discovery',
    'Fetch a source',
  ])
    assert.ok(!actions('viewer').includes(writing), writing);
  assert.ok(actions('viewer').includes('Review approvals'));
  // A one-tab page is named once (review 1, N-3).
  const hint = (label: string) =>
    r.staticItems('owner').find((i) => i.label === label)!.hint;
  assert.equal(hint('Start an autopilot'), 'Opens Autopilot');
  assert.equal(hint('Start a discovery'), 'Opens Projects › Discover');
});

test('every item only moves the person somewhere', async () => {
  const r = await rules();
  const items = [
    ...r.staticItems('owner'),
    ...r.workspaceItems(
      [
        { id: 'a', name: 'Alpha', role: 'owner' },
        { id: 'b', name: 'Beta', role: 'viewer' },
      ],
      'a',
    ),
  ];
  for (const i of items)
    assert.ok(
      ['view', 'workspace', 'notes', 'shortcuts'].includes(i.target.to),
      i.label,
    );
  // The component reads with GET only: no CSRF token, no request body, no idempotency key.
  const src = await readFile('apps/web/src/command-palette.tsx', 'utf8');
  assert.doesNotMatch(src, /csrf|body:|idempotencyKey|method:/);
});

test('workspace items list only the other workspaces', async () => {
  const r = await rules();
  const items = r.workspaceItems(
    [
      { id: 'a', name: 'Alpha', role: 'owner' },
      { id: 'b', name: 'Beta', role: 'viewer' },
    ],
    'a',
  );
  assert.deepEqual(
    items.map((i) => [i.label, i.target.ws]),
    [['Switch to Beta', 'b']],
  );
});

test('ranking puts a label that starts with the words first and needs every word', async () => {
  const r = await rules();
  const items = r.staticItems('owner');
  assert.equal(r.rankItems(items, 'decide')[0]!.label, 'Projects › Decide');
  assert.equal(r.rankItems(items, 'work')[0]!.label, 'Monitor › Workers');
  // Every word must match somewhere (label, place or slug).
  assert.ok(
    r
      .rankItems(items, 'monitor bud')
      .every((i) => /budget/i.test(i.label + i.hint)),
  );
  assert.deepEqual(r.rankItems(items, 'zzzz-nothing'), []);
  assert.deepEqual(
    r.rankItems(items, '  ').map((i) => i.key),
    items.map((i) => i.key),
  );
});

test('groups come in a fixed order and empty ones are left out', async () => {
  const r = await rules();
  const g = r.grouped([
    {
      key: 'w',
      group: 'Workspaces',
      label: 'w',
      hint: '',
      target: { to: 'workspace' },
    },
    {
      key: 'a',
      group: 'Actions',
      label: 'a',
      hint: '',
      target: { to: 'view' },
    },
  ]);
  assert.deepEqual(
    g.map((x) => x.group),
    ['Actions', 'Workspaces'],
  );
});

test('arrow keys wrap, Home and End jump, other keys do nothing', async () => {
  const r = await rules();
  assert.equal(r.moveActive(2, 3, 'ArrowDown'), 0);
  assert.equal(r.moveActive(0, 3, 'ArrowUp'), 2);
  assert.equal(r.moveActive(1, 3, 'Home'), 0);
  assert.equal(r.moveActive(1, 3, 'End'), 2);
  assert.equal(r.moveActive(0, 0, 'ArrowDown'), null);
  assert.equal(r.moveActive(0, 3, 'a'), null);
});

test('Ctrl+K and Cmd+K open the palette; "?" never fires inside a text field', async () => {
  const r = await rules();
  // Ctrl elsewhere, Cmd on a Mac (where Ctrl+K deletes to the end of a line).
  assert.ok(r.isPaletteKey(key('k', { ctrlKey: true })));
  assert.ok(!r.isPaletteKey(key('k', { metaKey: true })));
  assert.ok(r.isPaletteKey(key('K', { metaKey: true }), true));
  assert.ok(!r.isPaletteKey(key('k', { ctrlKey: true }), true));
  assert.ok(!r.isPaletteKey(key('k')));
  assert.ok(!r.isPaletteKey(key('k', { ctrlKey: true, altKey: true })));
  // Ctrl+Shift+K stays the browser's (review 1, N-1).
  assert.ok(!r.isPaletteKey(key('K', { ctrlKey: true, shiftKey: true })));
  const q = key('?', { shiftKey: true });
  assert.ok(r.isShortcutsKey(q, null));
  assert.ok(r.isShortcutsKey(q, { tagName: 'BUTTON' }));
  assert.ok(r.isShortcutsKey(q, { tagName: 'INPUT', type: 'checkbox' }));
  for (const t of [
    { tagName: 'INPUT', type: 'text' },
    { tagName: 'INPUT', type: '' },
    { tagName: 'INPUT', type: 'search' },
    { tagName: 'TEXTAREA' },
    { tagName: 'SELECT' },
    { tagName: 'DIV', isContentEditable: true },
  ])
    assert.ok(!r.isShortcutsKey(q, t), JSON.stringify(t));
  assert.ok(!r.isShortcutsKey(key('?', { ctrlKey: true }), null));
});

test('the shortcuts sheet lists the keys that are wired, including Ctrl+.', async () => {
  const r = await rules();
  const listed = r.SHORTCUTS.map((s) => s.keys.join('+'));
  assert.ok(listed.includes('Ctrl+K'));
  assert.ok(listed.includes('?'));
  assert.ok(listed.includes('Ctrl+.'));
  // Ctrl+. still belongs to the side panel, and the palette is mounted in the studio shell.
  const aside = await readFile('apps/web/src/aside.tsx', 'utf8');
  assert.match(aside, /e\.key === '\.'/);
  const main = await readFile('apps/web/src/main.tsx', 'utf8');
  assert.match(main, /<CommandPalette\b/);
});
