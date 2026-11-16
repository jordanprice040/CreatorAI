// ADR-0119 (F6): the command palette's items, ranking and keys. Pure data and functions with
// only the page map as an import, so the rules load in Node tests without a browser. The
// palette only moves the person somewhere: every item opens a page, a form, a record or a
// panel. Nothing here starts work; that still takes the page's own form and approvals.

import { PAGES, pageOf, placeLabel, sectionOf, type View } from './pages.js';

export type PaletteGroup =
  | 'Actions'
  | 'Pages'
  | 'Workspaces'
  | 'Projects'
  | 'Recent records'
  | 'Matching records';

/** Where choosing an item goes. None of these writes anything. */
export type PaletteTarget =
  | { to: 'view'; view: View; q?: string }
  | { to: 'workspace'; ws: string }
  | { to: 'subject'; kind: string; id: string }
  | { to: 'notes' }
  | { to: 'shortcuts' };

export type PaletteItem = {
  key: string;
  group: PaletteGroup;
  label: string;
  /** Where it goes or what it is, e.g. "Projects › Decide". */
  hint: string;
  /** Extra words it answers to; never shown. */
  words?: string;
  target: PaletteTarget;
};

export type Role = 'owner' | 'editor' | 'viewer';

/**
 * Forms the palette can open, by who may use them in this workspace. A viewer cannot change
 * records, so only reading items are listed; starting an autopilot is the owner's (ADR-0111).
 * Opening a form fills nothing and submits nothing.
 */
const ACTIONS: {
  label: string;
  view?: View;
  words: string;
  roles: readonly Role[];
  target?: PaletteTarget;
}[] = [
  {
    label: 'Start an autopilot',
    view: 'autopilot',
    words: 'run automatic new',
    roles: ['owner'],
  },
  {
    label: 'Start a discovery',
    view: 'submit',
    words: 'new problem theme find discover',
    roles: ['owner', 'editor'],
  },
  {
    label: 'Fetch a source',
    view: 'evidence',
    words: 'add url evidence claim page',
    roles: ['owner', 'editor'],
  },
  {
    label: 'Review approvals',
    view: 'decisions',
    words: 'approve waiting decisions requests',
    roles: ['owner', 'editor', 'viewer'],
  },
  {
    label: 'Write a note',
    words: 'notes sidebar memo',
    roles: ['owner', 'editor', 'viewer'],
    target: { to: 'notes' },
  },
  {
    label: 'Show keyboard shortcuts',
    words: 'keys help hotkeys',
    roles: ['owner', 'editor', 'viewer'],
    target: { to: 'shortcuts' },
  },
];

/** Where a view is, naming a one-tab page once ("Autopilot", not "Autopilot › Autopilot"). */
function placeName(view: View): string {
  const page = pageOf(view);
  return sectionOf(view).label === page.label ? page.label : placeLabel(view);
}

/** The items that need no server read: actions for this role, then every tab of every page. */
export function staticItems(role: Role): PaletteItem[] {
  const actions = ACTIONS.filter((a) => a.roles.includes(role)).map(
    (a): PaletteItem => ({
      key: `action:${a.label}`,
      group: 'Actions',
      label: a.label,
      hint: a.view ? `Opens ${placeName(a.view)}` : '',
      words: a.words,
      target: a.target ?? { to: 'view', view: a.view! },
    }),
  );
  // Every tab, including those Standard leaves out of the navigation: their routes open
  // anyway (ADR-0082), and a search by name is how a person finds one.
  const pages = PAGES.flatMap((page) =>
    page.sections.map((s): PaletteItem => ({
      key: `view:${s.view}`,
      group: 'Pages',
      label: s.label === page.label ? s.label : `${page.label} › ${s.label}`,
      hint: s.group ? `${page.label} › ${s.group}` : '',
      words: s.slug,
      target: { to: 'view', view: s.view },
    })),
  );
  return [...actions, ...pages];
}

/** Other workspaces the person belongs to (the server lists only those). */
export function workspaceItems(
  workspaces: readonly { id: string; name: string; role: Role }[],
  current: string,
): PaletteItem[] {
  return workspaces
    .filter((w) => w.id !== current)
    .map((w) => ({
      key: `ws:${w.id}`,
      group: 'Workspaces',
      label: `Switch to ${w.name}`,
      hint: `Workspace · ${w.role}`,
      words: 'workspace switch',
      target: { to: 'workspace', ws: w.id },
    }));
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD');

/**
 * Items whose text holds every word of the query, best first: a label that starts with the
 * query, then one with a word starting with it, then any other match. Ties keep their order.
 * An empty query keeps every item in order.
 */
export function rankItems(
  items: readonly PaletteItem[],
  query: string,
): PaletteItem[] {
  const q = norm(query.trim());
  if (!q) return [...items];
  const terms = q.split(/\s+/);
  const scored: { item: PaletteItem; score: number; i: number }[] = [];
  items.forEach((item, i) => {
    const label = norm(item.label);
    const all = `${label} ${norm(item.hint)} ${norm(item.words ?? '')}`;
    if (!terms.every((t) => all.includes(t))) return;
    const score = label.startsWith(q)
      ? 0
      : label.split(/[\s›]+/).some((w) => w.startsWith(terms[0]!))
        ? 1
        : label.includes(terms[0]!)
          ? 2
          : 3;
    scored.push({ item, score, i });
  });
  return scored
    .sort((a, b) => a.score - b.score || a.i - b.i)
    .map((s) => s.item);
}

/** Groups in display order, each with its items; empty groups are left out. */
export function grouped(
  items: readonly PaletteItem[],
): { group: PaletteGroup; items: PaletteItem[] }[] {
  const order: PaletteGroup[] = [
    'Actions',
    'Pages',
    'Projects',
    'Matching records',
    'Recent records',
    'Workspaces',
  ];
  return order
    .map((group) => ({
      group,
      items: items.filter((i) => i.group === group),
    }))
    .filter((g) => g.items.length > 0);
}

/** The next active index for an arrow, Home or End key, wrapping at the ends. */
export function moveActive(
  index: number,
  count: number,
  key: string,
): number | null {
  if (count === 0) return null;
  if (key === 'ArrowDown') return (index + 1) % count;
  if (key === 'ArrowUp') return (index - 1 + count) % count;
  if (key === 'Home') return 0;
  if (key === 'End') return count - 1;
  return null;
}

type KeyLike = {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  shiftKey?: boolean;
};
type TargetLike = {
  tagName?: string;
  type?: string;
  isContentEditable?: boolean;
} | null;

/** Ctrl+K (Cmd+K on a Mac) opens or closes the palette, from anywhere, even a text field. */
export const isPaletteKey = (e: KeyLike, mac = false) =>
  // Cmd on a Mac (Ctrl+K there deletes to the end of a line), Ctrl elsewhere; never with
  // Shift or Alt, so Ctrl+Shift+K stays the browser's (review 1, N-1).
  (mac ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey) &&
  !e.altKey &&
  !e.shiftKey &&
  e.key.toLowerCase() === 'k';

const TEXT_INPUTS = new Set([
  '',
  'text',
  'search',
  'email',
  'url',
  'tel',
  'password',
  'number',
  'date',
  'datetime-local',
  'time',
  'month',
  'week',
]);

/** Whether the key is going into something the person types in, so "?" is a character there. */
export function isTyping(t: TargetLike): boolean {
  if (!t) return false;
  if (t.isContentEditable) return true;
  const tag = (t.tagName ?? '').toUpperCase();
  if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return tag === 'INPUT' && TEXT_INPUTS.has((t.type ?? '').toLowerCase());
}

/** "?" opens the shortcuts sheet, but never while the person is typing. */
export const isShortcutsKey = (e: KeyLike, target: TargetLike) =>
  e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey && !isTyping(target);

/** The sheet's list. Every shortcut here is wired; the test reads this list. */
export const SHORTCUTS: readonly { keys: string[]; does: string }[] = [
  { keys: ['Ctrl', 'K'], does: 'Open or close the command palette' },
  { keys: ['?'], does: 'Show this list of shortcuts (not while typing)' },
  { keys: ['Ctrl', '.'], does: 'Open or fold the side panel' },
  { keys: ['↑', '↓'], does: 'Move through palette results' },
  { keys: ['Home', 'End'], does: 'Jump to the first or last result' },
  { keys: ['Enter'], does: 'Open the highlighted result' },
  { keys: ['Esc'], does: 'Close the palette, this list or the side panel' },
];
