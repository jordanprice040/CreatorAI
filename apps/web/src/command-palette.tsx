import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import {
  SearchResultSchema,
  type SearchHit,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { clip } from './ui.js';
import { canOpen, useOpenSubject } from './destinations.js';
import type { View } from './pages.js';
import {
  SHORTCUTS,
  grouped,
  isPaletteKey,
  isShortcutsKey,
  moveActive,
  rankItems,
  staticItems,
  workspaceItems,
  type PaletteItem,
} from './palette-rules.js';
import './palette.css';

// ADR-0119 (F6): Ctrl+K opens a search of pages, forms, projects and records; "?" shows the
// shortcuts. Choosing an item only opens a page, a form, a record or the notes panel. Records
// come from the workspace's own search, which checks membership on the server before it
// builds any hit, and a record opens through the same destination check as Search.

const DEBOUNCE_MS = 180;

/** The record a hit opens, as Search reads it. */
function subjectOf(h: SearchHit): { kind: string; id: string } | null {
  if (h.type === 'decision') return { kind: 'decision', id: h.id };
  return h.subject ?? null;
}

function hitItems(
  hits: readonly SearchHit[],
  group: PaletteItem['group'],
): PaletteItem[] {
  const items: PaletteItem[] = [];
  for (const h of hits) {
    const s = subjectOf(h);
    if (!s || !canOpen(s.kind)) continue;
    items.push({
      key: `${group}:${h.type}:${h.id}`,
      group,
      label: clip(h.title || words(h.kind), 110),
      hint: `${words(h.kind)} · ${when(h.occurred_at)}`,
      target: { to: 'subject', kind: s.kind, id: s.id },
    });
  }
  return items;
}

type Remote = {
  key: string;
  projects: PaletteItem[];
  records: PaletteItem[];
  fixture: boolean;
  error: string;
};

export function CommandPalette({
  workspace,
  workspaces,
  open,
  switchWorkspace,
  showNotes,
}: {
  workspace: Workspace;
  workspaces: readonly Workspace[];
  open: (view: View, id?: string, q?: string) => void;
  switchWorkspace: (ws: string) => void;
  showNotes: () => void;
}) {
  const [shown, setShown] = useState(false);
  const [sheet, setSheet] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const [remote, setRemote] = useState<Remote>({
    key: '',
    projects: [],
    records: [],
    fixture: false,
    error: '',
  });
  const dialog = useRef<HTMLDialogElement>(null);
  const sheetDialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const sheetClose = useRef<HTMLButtonElement>(null);
  const returnTo = useRef<Element | null>(null);
  const opener = useOpenSubject(workspace.id, (view, id) => {
    close();
    open(view, id);
  });

  function remember() {
    // Focus goes back where it was, unless it was inside the other dialog.
    const el = document.activeElement;
    if (el && !el.closest('.palette, .shortcut-sheet')) returnTo.current = el;
  }
  function restore() {
    const el = returnTo.current;
    returnTo.current = null;
    if (el instanceof HTMLElement && el.isConnected) el.focus();
  }
  function close() {
    setShown(false);
    opener.clear();
  }
  function openPalette() {
    remember();
    setSheet(false);
    setQuery('');
    setActive(0);
    opener.clear();
    setShown(true);
  }
  function openSheet() {
    remember();
    setShown(false);
    setSheet(true);
  }

  // Global keys. Ctrl+K toggles the palette from anywhere; "?" opens the sheet unless the
  // person is typing. Ctrl+. stays with the side panel (aside.tsx).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.isComposing) return;
      if (isPaletteKey(e)) {
        e.preventDefault();
        if (shown) close();
        else openPalette();
      } else if (
        !shown &&
        !sheet &&
        isShortcutsKey(e, e.target instanceof Element ? e.target : null)
      ) {
        e.preventDefault();
        openSheet();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The native modal dialog keeps focus inside and makes the page behind it inert.
  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (shown && !d.open) {
      d.showModal();
      input.current?.focus();
    } else if (!shown && d.open) {
      d.close();
      if (!sheet) restore();
    }
  }, [shown]);
  useEffect(() => {
    const d = sheetDialog.current;
    if (!d) return;
    if (sheet && !d.open) {
      d.showModal();
      sheetClose.current?.focus();
    } else if (!sheet && d.open) {
      d.close();
      if (!shown) restore();
    }
  }, [sheet]);

  // Records: recent ones and projects (problems) with no words; matching ones with words.
  // Only while open, debounced, and a late answer for older words is dropped.
  const q = query.trim();
  const remoteKey = `${workspace.id}|${q}`;
  useEffect(() => {
    if (!shown) return;
    let live = true;
    const base = `workspaces/${workspace.id}/search`;
    const timer = window.setTimeout(
      () => {
        const read = (p: Record<string, string>) =>
          api(SearchResultSchema, `${base}?${new URLSearchParams(p)}`);
        const reads = q
          ? [read({ q, types: 'record,decision', limit: '8' })]
          : [
              read({ q: '', types: 'record', kind: 'problem', limit: '5' }),
              read({ q: '', types: 'record,decision', limit: '6' }),
            ];
        Promise.all(reads)
          .then((results) => {
            if (!live) return;
            const [first, second] = results;
            setRemote({
              key: remoteKey,
              projects: q ? [] : hitItems(first!.hits, 'Projects'),
              records: q
                ? hitItems(first!.hits, 'Matching records')
                : hitItems(second!.hits, 'Recent records'),
              fixture: results.some((r) => r.fixture),
              error: '',
            });
          })
          .catch((e: unknown) => {
            if (!live) return;
            setRemote({
              key: remoteKey,
              projects: [],
              records: [],
              fixture: false,
              error: message(e),
            });
          });
      },
      q ? DEBOUNCE_MS : 0,
    );
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [shown, remoteKey]);

  const local = useMemo(
    () => [
      ...staticItems(workspace.role),
      ...workspaceItems(workspaces, workspace.id),
    ],
    [workspace.id, workspace.role, workspaces],
  );
  const fresh = remote.key === remoteKey;
  const items = useMemo(() => {
    const ranked = rankItems(local, q);
    // A search by words keeps "Search records for …" as the way to see every match.
    const searchAll: PaletteItem[] = q
      ? [
          {
            key: 'search-all',
            group: 'Matching records',
            label: `Search all records for “${q}”`,
            hint: 'Opens Sources › Search',
            target: { to: 'view', view: 'search', q },
          },
        ]
      : [];
    const remoteItems = fresh
      ? [...remote.projects, ...remote.records, ...searchAll]
      : searchAll;
    // Dedupe a record that is both a project and recent.
    const seen = new Set<string>();
    const byTarget = (i: PaletteItem) =>
      i.target.to === 'subject' ? `${i.target.kind}:${i.target.id}` : i.key;
    const all = [...ranked, ...remoteItems].filter((i) => {
      const k = byTarget(i);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return grouped(all).flatMap((g) => g.items);
  }, [local, q, fresh, remote]);
  const groups = grouped(items);
  const current = Math.min(active, Math.max(items.length - 1, 0));
  const activeItem = items[current];
  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    if (!activeItem) return;
    document
      .getElementById(optionId(activeItem))
      ?.scrollIntoView({ block: 'nearest' });
  }, [activeItem?.key]);

  function choose(item: PaletteItem) {
    const t = item.target;
    if (t.to === 'subject') {
      // Stays open until the server says where it opens, or why it can't.
      void opener.openSubject(t.kind, t.id, item.key);
      return;
    }
    if (t.to === 'shortcuts') {
      openSheet();
      return;
    }
    close();
    if (t.to === 'view') open(t.view, undefined, t.q);
    else if (t.to === 'workspace') switchWorkspace(t.ws);
    else showNotes();
  }

  function onInputKey(e: ReactKeyboardEvent<HTMLInputElement>) {
    const next = moveActive(current, items.length, e.key);
    if (next !== null) {
      e.preventDefault();
      setActive(next);
    } else if (e.key === 'Enter' && activeItem) {
      e.preventDefault();
      choose(activeItem);
    }
  }

  const status = !fresh
    ? 'Searching records…'
    : remote.error
      ? `Records could not be read: ${remote.error}`
      : `${items.length} result${items.length === 1 ? '' : 's'}`;

  return (
    <>
      <dialog
        ref={dialog}
        className="palette"
        aria-label="Command palette"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
        onKeyDown={(e) => {
          // Esc belongs to the palette here, not to the side panel behind it.
          if (e.key === 'Escape') e.stopPropagation();
        }}
        onClick={(e) => {
          // A click on the backdrop (the dialog box itself, outside its content) closes it.
          if (e.target === dialog.current) close();
        }}
      >
        {shown && (
          <div className="palette-body">
            <div className="palette-search">
              <label htmlFor="palette-input" className="sr-only">
                Go to a page, form or record
              </label>
              <input
                id="palette-input"
                ref={input}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls="palette-list"
                aria-autocomplete="list"
                aria-activedescendant={
                  activeItem ? optionId(activeItem) : undefined
                }
                autoComplete="off"
                spellCheck={false}
                placeholder="Go to a page, form or record…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onInputKey}
              />
              <kbd className="palette-esc" aria-hidden="true">
                Esc
              </kbd>
            </div>
            <p className="palette-note small">
              Opens pages and forms only. Nothing starts until you use the form
              there.
              {fresh && remote.fixture && (
                <>
                  {' '}
                  <strong>Fixture records.</strong>
                </>
              )}
            </p>
            {opener.notice && (
              <p className="palette-notice small" role="alert">
                {opener.notice.text}
              </p>
            )}
            <div
              id="palette-list"
              role="listbox"
              aria-label="Results"
              className="palette-list"
            >
              {groups.map((g) => (
                <div
                  key={g.group}
                  role="group"
                  aria-labelledby={`palette-g-${slug(g.group)}`}
                >
                  <div
                    id={`palette-g-${slug(g.group)}`}
                    className="palette-group"
                    role="presentation"
                  >
                    {g.group}
                  </div>
                  {g.items.map((item) => (
                    <div
                      key={item.key}
                      id={optionId(item)}
                      role="option"
                      aria-selected={item === activeItem}
                      aria-busy={opener.busy === item.key || undefined}
                      className="palette-option"
                      onMouseMove={() => {
                        const i = items.indexOf(item);
                        if (i !== current) setActive(i);
                      }}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => choose(item)}
                    >
                      <span className="palette-label">{item.label}</span>
                      {item.hint && (
                        <span className="palette-hint">{item.hint}</span>
                      )}
                    </div>
                  ))}
                </div>
              ))}
              {items.length === 0 && (
                <p className="palette-empty small">
                  Nothing matches. Try other words, or press Enter on
                  &ldquo;Search all records&rdquo;.
                </p>
              )}
            </div>
            <p className="sr-only" role="status">
              {status}
            </p>
            <p className="palette-foot small" aria-hidden="true">
              <span>
                <kbd>↑</kbd> <kbd>↓</kbd> move
              </span>
              <span>
                <kbd>Enter</kbd> open
              </span>
              <span>
                <kbd>?</kbd> shortcuts
              </span>
              {!fresh && <span>Searching…</span>}
            </p>
          </div>
        )}
      </dialog>
      <dialog
        ref={sheetDialog}
        className="shortcut-sheet"
        aria-labelledby="shortcut-title"
        onCancel={(e) => {
          e.preventDefault();
          setSheet(false);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') e.stopPropagation();
        }}
        onClick={(e) => {
          if (e.target === sheetDialog.current) setSheet(false);
        }}
      >
        {sheet && (
          <div className="sheet-body">
            <h2 id="shortcut-title">Keyboard shortcuts</h2>
            <p className="small">
              On a Mac, use <kbd>Cmd</kbd> where this says <kbd>Ctrl</kbd>.
            </p>
            <table className="shortcut-table">
              <thead>
                <tr>
                  <th scope="col">Keys</th>
                  <th scope="col">What it does</th>
                </tr>
              </thead>
              <tbody>
                {SHORTCUTS.map((s) => (
                  <tr key={s.does}>
                    <td>
                      {s.keys.map((k, i) => (
                        <span key={k}>
                          {i > 0 && (s.keys[0] === 'Ctrl' ? ' + ' : ' ')}
                          <kbd>{k}</kbd>
                        </span>
                      ))}
                    </td>
                    <td>{s.does}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="sheet-actions">
              <button className="secondary" onClick={openPalette}>
                Open the command palette
              </button>
              <button ref={sheetClose} onClick={() => setSheet(false)}>
                Close
              </button>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-');
const optionId = (item: PaletteItem) =>
  `palette-o-${slug(item.key)}-${hash(item.key)}`;
/** Keeps ids unique when two keys slug alike. */
function hash(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}
