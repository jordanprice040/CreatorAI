import { useEffect, useRef, useState } from 'react';
import {
  ActivityNowSchema,
  ActivityPageSchema,
  NOTE_MAX,
  NOTE_TITLE_MAX,
  WorkspaceNoteListSchema,
  WorkspaceNoteSchema,
  type WorkspaceNoteSummary,
  type ActivityEntry,
  type ActivityNowItem,
  type Workspace,
  type WorkspaceNote,
} from '@creator/contracts';
import { api, ApiError, message, when } from './oversight.js';
import { Icon, eventText, type View } from './ui.js';
import { canOpen, useOpenSubject } from './destinations.js';
import './aside.css';
import {
  noteFileName,
  noteSlot,
  readNoteDraft,
  takeLegacyNoteDraft,
  trackNoteSave,
  writeNoteDraft,
  type NoteDraft,
} from './note-drafts.js';
import { Markdown } from './markdown-view.js';
import { useViewMode } from './view-mode.js';
import { revealWhenShown } from './discovery-progress.js';

// ADR-0060: the right-hand sidebar. Two tabs, Activity (what is running now and the latest
// audit events) and Notes (the person's own named notes for this workspace, saved as they
// type; ADR-0073).
// It docks open on wide windows, folds to a rail on mid-size ones and is a drawer on small
// ones; see `useAsideMode`.

export type AsideTab = 'activity' | 'notes';
/** docked: in the page grid; rail: a strip, the panel slides over; drawer: top-bar button. */
export type AsideMode = 'docked' | 'rail' | 'drawer';

const DOCKED_MIN = 1500;
const RAIL_MIN = 1100;
const PREFS_KEY = 'creator.aside';
const SEEN_KEY = 'creator.aside-seen';
const POLL_MS = 15_000;
const RECENT = 15;
const SAVE_DELAY_MS = 900;

type Prefs = { docked: boolean; tab: AsideTab };

function readJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...(JSON.parse(raw) as object) } : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private windows or blocked storage: the choice just is not remembered.
  }
}

function modeFor(width: number): AsideMode {
  return width >= DOCKED_MIN ? 'docked' : width >= RAIL_MIN ? 'rail' : 'drawer';
}

/**
 * The sidebar's layout state. On a docked window the open/folded choice is remembered on this
 * device; the rail's overlay and the small-window drawer always start closed.
 */
export function useAside() {
  const [mode, setMode] = useState<AsideMode>(() =>
    typeof window === 'undefined' ? 'docked' : modeFor(window.innerWidth),
  );
  const [prefs, setPrefs] = useState<Prefs>(() =>
    readJson<Prefs>(PREFS_KEY, { docked: true, tab: 'activity' }),
  );
  const [overlay, setOverlay] = useState(false);
  useEffect(() => {
    const docked = window.matchMedia(`(min-width: ${DOCKED_MIN}px)`);
    const rail = window.matchMedia(`(min-width: ${RAIL_MIN}px)`);
    const update = () => {
      setMode(docked.matches ? 'docked' : rail.matches ? 'rail' : 'drawer');
      setOverlay(false);
    };
    docked.addEventListener('change', update);
    rail.addEventListener('change', update);
    return () => {
      docked.removeEventListener('change', update);
      rail.removeEventListener('change', update);
    };
  }, []);
  const save = (next: Prefs) => {
    setPrefs(next);
    writeJson(PREFS_KEY, next);
  };
  const isOpen = mode === 'docked' ? prefs.docked : overlay;
  const setOpen = (open: boolean) => {
    if (mode === 'docked') save({ ...prefs, docked: open });
    else setOverlay(open);
  };
  const show = (tab: AsideTab) => {
    if (mode === 'docked') save({ ...prefs, tab, docked: true });
    else {
      save({ ...prefs, tab });
      setOverlay(true);
    }
  };
  // Ctrl+. (Cmd+. on a Mac) opens or folds the sidebar; Esc closes the overlay or drawer.
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === '.') {
        e.preventDefault();
        setOpen(!isOpen);
      } else if (e.key === 'Escape' && mode !== 'docked' && overlay) {
        setOverlay(false);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });
  return {
    mode,
    isOpen,
    tab: prefs.tab,
    setOpen,
    show,
    setTab: (tab: AsideTab) => save({ ...prefs, tab }),
  };
}
export type Aside = ReturnType<typeof useAside>;

/** True while the browser window is visible; polling pauses when it is hidden. */
function useVisible() {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return visible;
}

/**
 * What is running now and the latest activity, read every 15 seconds while the window is
 * visible. `unseen` counts entries newer than the last ones shown in the Activity tab.
 */
function useActivityFeed(ws: string) {
  const visible = useVisible();
  const [now, setNow] = useState<ActivityNowItem[]>([]);
  const [recent, setRecent] = useState<ActivityEntry[]>([]);
  const [error, setError] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    setNow([]);
    setRecent([]);
    setLoaded(false);
    setError('');
  }, [ws]);
  useEffect(() => {
    if (!visible) return;
    let live = true;
    const load = async () => {
      try {
        const [running, page] = await Promise.all([
          api(ActivityNowSchema, `workspaces/${ws}/activity-now`),
          api(ActivityPageSchema, `workspaces/${ws}/activity?limit=${RECENT}`),
        ]);
        if (!live) return;
        setNow(running.items);
        setRecent(page.entries);
        setError('');
      } catch (e) {
        if (live) setError(message(e));
      } finally {
        if (live) setLoaded(true);
      }
    };
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [ws, visible, tick]);
  return { now, recent, error, loaded, reload: () => setTick((t) => t + 1) };
}

const seq = (s: string) => BigInt(s);
function readSeen(): Record<string, string> {
  return readJson<Record<string, string>>(SEEN_KEY, {});
}

function elapsed(iso: string, at: number) {
  const s = Math.max(0, Math.round((at - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h} h ${m % 60} min`;
  return `${Math.floor(h / 24)} days`;
}

function nowTarget(
  item: ActivityNowItem,
  standard: boolean,
): [View, string?, string?] {
  if (item.kind === 'workflow') {
    // ADR-0103 (review L-2): Standard opens where the work shows (the third value is the
    // Discover panel heading to show); Runs is an Advanced tab.
    if (standard && item.purpose === 'r02_discovery')
      return ['submit', '', `dp-${item.id}`];
    if (standard && item.purpose === 'r01_exploration')
      return ['submit', '', 'explore-title'];
    // Re-review L-A: Decide opens on the problem being assessed, not the last one viewed.
    if (standard && item.purpose === 'r08_assessment')
      return item.subject_id ? ['compare', item.subject_id] : ['compare'];
    return ['runs', item.id];
  }
  if (item.kind === 'desktop_job') return ['desktop'];
  if (item.kind === 'qualification_queue') return ['models'];
  if (item.purpose === 'chat') return ['chat'];
  if (
    item.purpose === 'qualification' ||
    item.purpose === 'verification' ||
    item.purpose === 'availability_recheck'
  )
    return ['models'];
  return item.run_id ? ['build', item.run_id] : ['build'];
}

/** The sidebar itself. Rendered only inside a workspace, next to the page. */
export function RightSidebar({
  workspace,
  actor,
  csrf,
  aside,
  open,
}: {
  workspace: Workspace;
  /** The signed-in person; notes and their safety copies are theirs alone. */
  actor: string;
  csrf: string;
  aside: Aside;
  open: (view: View, id?: string) => void;
}) {
  const feed = useActivityFeed(workspace.id);
  // Only work that is actually moving counts as running (review L-3).
  const running = feed.now.filter((i) => i.active).length;
  const [seen, setSeen] = useState(readSeen);
  const latest = feed.recent[0]?.sequence ?? null;
  const seenHere = seen[workspace.id] ?? null;
  // What was already seen when the Activity tab came into view; newer entries are marked.
  const [markFrom, setMarkFrom] = useState<string | null>(seenHere);
  const showingActivity = aside.isOpen && aside.tab === 'activity';
  useEffect(() => {
    if (showingActivity) setMarkFrom(seen[workspace.id] ?? null);
  }, [showingActivity, workspace.id]);
  useEffect(() => {
    if (!showingActivity || !latest || latest === seenHere) return;
    const next = { ...readSeen(), [workspace.id]: latest };
    writeJson(SEEN_KEY, next);
    setSeen(next);
  }, [showingActivity, latest, seenHere, workspace.id]);
  const unseen =
    seenHere === null
      ? 0
      : feed.recent.filter((e) => seq(e.sequence) > seq(seenHere)).length;
  const isNew = (e: ActivityEntry) =>
    markFrom !== null && seq(e.sequence) > seq(markFrom);
  const go = (view: View, id?: string) => {
    if (aside.mode !== 'docked') aside.setOpen(false);
    open(view, id);
  };
  // P01: completed work opens its result through the same check as the Activity tab.
  const opener = useOpenSubject(workspace.id, go);

  const rail = (
    <nav className="aside-rail" aria-label="Sidebar">
      <button
        className="ghost icon-button"
        aria-label={`Activity${unseen ? `, ${unseen} new` : ''}${running ? `, ${running} running` : ''}`}
        title="Activity (Ctrl+.)"
        aria-pressed={aside.isOpen && aside.tab === 'activity'}
        onClick={() => aside.show('activity')}
      >
        <Icon name="pulse" />
        {(unseen > 0 || running > 0) && (
          <span
            className={running ? 'rail-dot running' : 'rail-dot'}
            aria-hidden="true"
          />
        )}
      </button>
      <button
        className="ghost icon-button"
        aria-label="Notes"
        title="Notes"
        aria-pressed={aside.isOpen && aside.tab === 'notes'}
        onClick={() => aside.show('notes')}
      >
        <Icon name="note" />
      </button>
    </nav>
  );

  const panel = (
    <section
      id="right-sidebar"
      className="aside-panel"
      aria-label="Activity and notes"
      data-mode={aside.mode}
    >
      <header className="aside-head">
        <div className="aside-tabs" role="tablist" aria-label="Sidebar">
          {(
            [
              ['activity', 'Activity'],
              ['notes', 'Notes'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              role="tab"
              id={`aside-tab-${key}`}
              aria-selected={aside.tab === key}
              aria-controls={`aside-${key}`}
              className={aside.tab === key ? 'active' : ''}
              onClick={() => aside.setTab(key)}
            >
              {label}
              {key === 'activity' && running > 0 && (
                <span className="nav-count">{running}</span>
              )}
            </button>
          ))}
        </div>
        <button
          className="ghost icon-button"
          aria-label={
            aside.mode === 'docked' ? 'Fold the sidebar' : 'Close the sidebar'
          }
          title={
            aside.mode === 'docked'
              ? 'Fold the sidebar (Ctrl+.)'
              : 'Close (Esc)'
          }
          onClick={() => aside.setOpen(false)}
        >
          <Icon name={aside.mode === 'docked' ? 'fold' : 'close'} />
        </button>
      </header>
      <div
        id="aside-activity"
        role="tabpanel"
        aria-labelledby="aside-tab-activity"
        hidden={aside.tab !== 'activity'}
        className="aside-body"
      >
        <ActivityTab feed={feed} isNew={isNew} go={go} opener={opener} />
      </div>
      <div
        id="aside-notes"
        role="tabpanel"
        aria-labelledby="aside-tab-notes"
        hidden={aside.tab !== 'notes'}
        className="aside-body notes-body"
      >
        <Notes
          key={`${actor}:${workspace.id}`}
          ws={workspace.id}
          actor={actor}
          csrf={csrf}
        />
      </div>
    </section>
  );

  if (aside.mode === 'docked')
    return (
      <aside
        className="right-aside"
        data-open={aside.isOpen ? 'true' : 'false'}
      >
        {aside.isOpen ? panel : rail}
      </aside>
    );
  return (
    <>
      {aside.mode === 'rail' && <aside className="right-aside">{rail}</aside>}
      {aside.isOpen && (
        <>
          <div
            className="scrim aside-scrim"
            aria-hidden="true"
            onClick={() => aside.setOpen(false)}
          />
          <aside className="right-aside overlay">{panel}</aside>
        </>
      )}
    </>
  );
}

/** The top-bar button that opens the sidebar on small windows (drawer mode). */
export function AsideButton({ aside }: { aside: Aside }) {
  if (aside.mode !== 'drawer') return null;
  return (
    <button
      className="ghost icon-button"
      aria-expanded={aside.isOpen}
      aria-controls="right-sidebar"
      aria-label="Open activity and notes"
      title="Activity and notes"
      onClick={() => aside.setOpen(!aside.isOpen)}
    >
      <Icon name="panel" />
    </button>
  );
}

function ActivityTab({
  feed,
  isNew,
  go,
  opener,
}: {
  feed: ReturnType<typeof useActivityFeed>;
  isNew: (e: ActivityEntry) => boolean;
  go: (view: View, id?: string) => void;
  opener: ReturnType<typeof useOpenSubject>;
}) {
  const { standard } = useViewMode();
  const [at, setAt] = useState(() => Date.now());
  useEffect(() => {
    const t = window.setInterval(() => setAt(Date.now()), 30_000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => setAt(Date.now()), [feed.now]);
  if (!feed.loaded) return <p className="small">Loading…</p>;
  return (
    <>
      {feed.error && (
        <p className="error small" role="alert">
          {feed.error}{' '}
          <button className="text" onClick={feed.reload}>
            Try again
          </button>
        </p>
      )}
      <h3 className="aside-h">Running now</h3>
      {feed.now.length === 0 ? (
        <p className="small">Nothing running.</p>
      ) : (
        <ul className="aside-list">
          {feed.now.map((item) => {
            const [view, id, heading] = nowTarget(item, standard);
            return (
              <li key={`${item.kind}:${item.id}`}>
                <button
                  className="aside-row"
                  onClick={() => {
                    go(view, id);
                    if (heading) revealWhenShown(heading);
                  }}
                >
                  <span className="aside-row-top">
                    <span
                      className={item.active ? 'spinner-dot' : 'idle-dot'}
                      aria-hidden="true"
                    />
                    <strong>{item.label}</strong>
                    <span className="aside-time">
                      {elapsed(item.started_at, at)}
                    </span>
                  </span>
                  <span className="aside-row-sub">
                    {[item.state, item.detail].filter(Boolean).join(' · ')}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      <h3 className="aside-h">Recent</h3>
      {feed.recent.length === 0 ? (
        <p className="small">No activity yet.</p>
      ) : (
        <ol className="aside-list">
          {feed.recent.map((e) => {
            const linked = canOpen(e.subject_kind);
            const body = (
              <>
                <span className="aside-row-top">
                  {isNew(e) && (
                    <span className="nav-dot" aria-label="New" role="img" />
                  )}
                  <span className="aside-text">
                    <strong>
                      {e.actor.display_name}
                      {e.actor.kind === 'human' ? '' : ` (${e.actor.kind})`}
                    </strong>{' '}
                    {eventText(e.summary)}
                  </span>
                </span>
                <time className="aside-row-sub" dateTime={e.occurred_at}>
                  {when(e.occurred_at)}
                </time>
              </>
            );
            return (
              <li key={e.event_id}>
                {linked ? (
                  <button
                    className="aside-row"
                    aria-busy={opener.busy === e.event_id}
                    onClick={() =>
                      void opener.openSubject(
                        e.subject_kind,
                        e.subject_id,
                        e.event_id,
                      )
                    }
                  >
                    {body}
                  </button>
                ) : (
                  <div className="aside-row">{body}</div>
                )}
                {opener.notice?.key === e.event_id && (
                  <p className="small aside-row-sub" role="status">
                    {opener.notice.text}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
      <button className="text aside-more" onClick={() => go('activity')}>
        See all activity
      </button>
    </>
  );
}

type SaveState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; at: string }
  | { kind: 'failed'; error: string }
  | { kind: 'conflict'; theirs: WorkspaceNote };

/** Keepalive requests are limited to 64 KiB by browsers; stay under it. */
const KEEPALIVE_MAX = 60_000;
const CURRENT_NOTE_KEY = 'creator.notes-current.';

type EditorControls = { flush: () => Promise<void>; text: () => string };

/**
 * ADR-0073 (P06): the person's own named notes for this workspace. A switcher picks the note;
 * each can be renamed, archived (kept, read-only) and restored, exported as a Markdown file,
 * and shown as formatted Markdown. Only the author can see them and they are never sent to a
 * model. The single notepad of ADR-0060 became the note called "Notes".
 */
function Notes({
  ws,
  actor,
  csrf,
}: {
  ws: string;
  actor: string;
  csrf: string;
}) {
  const [notes, setNotes] = useState<WorkspaceNoteSummary[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [current, setCurrentState] = useState<string | null>(null);
  const [naming, setNaming] = useState<{
    kind: 'new' | 'rename';
    value: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState(false);
  /** The note whose text the editor has loaded; Export waits for it (review N-3). */
  const [readyId, setReadyId] = useState<string | null>(null);
  const controls = useRef<EditorControls | null>(null);
  const rememberKey = `${CURRENT_NOTE_KEY}${actor}.${ws}`;

  const setCurrent = (id: string | null) => {
    setCurrentState(id);
    try {
      if (id) localStorage.setItem(rememberKey, id);
    } catch {
      // Not remembered on this device.
    }
  };

  async function load() {
    setLoadError('');
    try {
      let list = (await api(WorkspaceNoteListSchema, `workspaces/${ws}/notes`))
        .notes;
      // Text typed in the old single notepad and not yet saved moves to the note it became,
      // or, if that notepad was never saved, starts one.
      const legacy = takeLegacyNoteDraft(actor, ws);
      if (legacy) {
        const notepad = list.find((n) => n.from_notepad);
        if (notepad) {
          if (!readNoteDraft(actor, noteSlot(ws, notepad.id)))
            writeNoteDraft(actor, noteSlot(ws, notepad.id), {
              text: legacy.text,
              base_version: Math.max(1, legacy.base_version),
            });
          // That note already has unsaved text here: keep the old copy too, for a later load
          // to hand over once that text is saved (PR #142 review N-2).
          else writeNoteDraft(actor, ws, legacy);
        } else if (legacy.text.trim()) {
          try {
            const made = await api(
              WorkspaceNoteSchema,
              `workspaces/${ws}/notes`,
              {
                body: { title: 'Notes', text: legacy.text },
                csrf,
                quiet: true,
              },
            );
            list = [summary(made), ...list];
          } catch {
            writeNoteDraft(actor, ws, legacy);
          }
        }
      }
      setNotes(list);
      let remembered: string | null = null;
      try {
        remembered = localStorage.getItem(rememberKey);
      } catch {
        // Nothing remembered.
      }
      const pick =
        list.find((n) => n.id === remembered) ??
        list.find((n) => n.status === 'active') ??
        null;
      setCurrentState(pick?.id ?? null);
    } catch (e) {
      setLoadError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, [ws]);

  const note = notes?.find((n) => n.id === current) ?? null;
  const replace = (n: WorkspaceNote | WorkspaceNoteSummary) =>
    setNotes((list) =>
      list ? list.map((x) => (x.id === n.id ? summary(n) : x)) : list,
    );

  async function act(run: () => Promise<void>) {
    setBusy(true);
    setError('');
    try {
      await run();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  const create = (title: string) =>
    act(async () => {
      await controls.current?.flush();
      const made = await api(WorkspaceNoteSchema, `workspaces/${ws}/notes`, {
        body: { title, text: '' },
        csrf,
        quiet: true,
      });
      setNotes((list) => [summary(made), ...(list ?? [])]);
      setCurrent(made.id);
      setNaming(null);
      setPreview(false);
    });
  const rename = (title: string) =>
    act(async () => {
      if (!note) return;
      replace(
        await api(
          WorkspaceNoteSchema,
          `workspaces/${ws}/notes/${note.id}/rename`,
          { body: { title }, csrf, quiet: true },
        ),
      );
      setNaming(null);
    });
  const archive = (archived: boolean) =>
    act(async () => {
      if (!note) return;
      // Unsaved text is saved before the note becomes read-only.
      if (archived) await controls.current?.flush();
      replace(
        await api(
          WorkspaceNoteSchema,
          `workspaces/${ws}/notes/${note.id}/archive`,
          { body: { archived }, csrf, quiet: true },
        ),
      );
    });
  const exportNote = () => {
    if (!note) return;
    const url = URL.createObjectURL(
      new Blob([controls.current?.text() ?? ''], {
        type: 'text/markdown;charset=utf-8',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = noteFileName(note.title);
    a.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  if (loadError)
    return (
      <p className="error small" role="alert">
        Notes could not load: {loadError}{' '}
        <button className="text" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  if (!notes) return <p className="small">Loading…</p>;
  const active = notes.filter((n) => n.status === 'active');
  const archived = notes.filter((n) => n.status === 'archived');
  const nameForm = naming && (
    <form
      className="notes-name"
      onSubmit={(e) => {
        e.preventDefault();
        const title = naming.value.trim();
        if (!title) return;
        void (naming.kind === 'new' ? create(title) : rename(title));
      }}
    >
      <label htmlFor={`note-name-${ws}`} className="sr-only">
        {naming.kind === 'new' ? 'Name for the new note' : 'New name'}
      </label>
      <input
        id={`note-name-${ws}`}
        autoFocus
        value={naming.value}
        maxLength={NOTE_TITLE_MAX}
        placeholder="Note name"
        onChange={(e) => setNaming({ ...naming, value: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation();
            setNaming(null);
          }
        }}
      />
      <button className="secondary" disabled={busy || !naming.value.trim()}>
        {naming.kind === 'new' ? 'Create' : 'Rename'}
      </button>
      <button type="button" className="text" onClick={() => setNaming(null)}>
        Cancel
      </button>
    </form>
  );
  if (!notes.length)
    return (
      <div className="notes-empty">
        <p className="small">
          Keep private notes while you work. Only you can see them; they are
          saved in this workspace and never sent to a model.
        </p>
        {nameForm ?? (
          <button
            className="secondary"
            onClick={() => setNaming({ kind: 'new', value: 'Notes' })}
          >
            Start a note
          </button>
        )}
        {error && <p className="error small">{error}</p>}
      </div>
    );
  return (
    <>
      <div className="notes-bar">
        <label htmlFor={`note-pick-${ws}`} className="sr-only">
          Note
        </label>
        <select
          id={`note-pick-${ws}`}
          value={current ?? ''}
          onChange={(e) => {
            setCurrent(e.target.value || null);
            setNaming(null);
            setError('');
          }}
        >
          {!note && <option value="">Choose a note</option>}
          {active.map((n) => (
            <option key={n.id} value={n.id}>
              {n.title}
            </option>
          ))}
          {archived.length > 0 && (
            <optgroup label="Archived">
              {archived.map((n) => (
                <option key={n.id} value={n.id}>
                  {n.title}
                </option>
              ))}
            </optgroup>
          )}
        </select>
        <button
          className="text"
          disabled={busy}
          onClick={() => setNaming({ kind: 'new', value: '' })}
        >
          New
        </button>
      </div>
      {nameForm}
      {note && (
        <>
          <div className="notes-tools" role="group" aria-label="This note">
            <div className="notes-mode" role="radiogroup" aria-label="Show">
              <button
                role="radio"
                aria-checked={!preview}
                className={!preview ? 'on' : ''}
                onClick={() => setPreview(false)}
              >
                {note.status === 'archived' ? 'Text' : 'Write'}
              </button>
              <button
                role="radio"
                aria-checked={preview}
                className={preview ? 'on' : ''}
                onClick={() => setPreview(true)}
              >
                Preview
              </button>
            </div>
            <button
              className="text"
              disabled={busy}
              onClick={() => setNaming({ kind: 'rename', value: note.title })}
            >
              Rename
            </button>
            <button
              className="text"
              onClick={exportNote}
              disabled={readyId !== note.id}
            >
              Export
            </button>
            <button
              className="text"
              disabled={busy}
              onClick={() => void archive(note.status === 'active')}
            >
              {note.status === 'active' ? 'Archive' : 'Restore'}
            </button>
          </div>
          {note.status === 'archived' && (
            <p className="small notes-archived">
              Archived. Restore it to edit; the text is kept either way.
            </p>
          )}
          {error && <p className="error small">{error}</p>}
          <NoteEditor
            key={note.id}
            ws={ws}
            actor={actor}
            csrf={csrf}
            note={note}
            preview={preview}
            controls={controls}
            onSaved={replace}
            onReady={setReadyId}
          />
        </>
      )}
      {!note && error && <p className="error small">{error}</p>}
    </>
  );
}

function summary(
  n: WorkspaceNote | WorkspaceNoteSummary,
): WorkspaceNoteSummary {
  if (!('text' in n)) return n;
  const { text, ...rest } = n;
  return { ...rest, chars: text.length };
}

/**
 * One note's text. Saved a moment after typing stops, when the field loses focus, when another
 * note is picked or the notepad closes, and (best effort) when the page is closed. A save from
 * another window since this one loaded is never overwritten silently: the person picks which
 * text to keep. A failed save waits for more typing or "Try again" (review L-1).
 */
function NoteEditor({
  ws,
  actor,
  csrf,
  note: summaryIn,
  preview,
  controls,
  onSaved,
  onReady,
}: {
  ws: string;
  actor: string;
  csrf: string;
  note: WorkspaceNoteSummary;
  preview: boolean;
  controls: React.MutableRefObject<EditorControls | null>;
  onSaved: (note: WorkspaceNote) => void;
  onReady: (id: string) => void;
}) {
  const id = summaryIn.id;
  const readOnly = summaryIn.status === 'archived';
  const path = `workspaces/${ws}/notes/${id}`;
  const slot = noteSlot(ws, id);
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const base = useRef<WorkspaceNote | null>(null);
  const pending = useRef<string | null>(null);
  const saving = useRef(false);
  /** The save now on its way, so Archive can wait for it (review L-1). */
  const inFlight = useRef<Promise<void> | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const stateRef = useRef(state);
  stateRef.current = state;
  const textRef = useRef(text);
  textRef.current = text;
  const readOnlyRef = useRef(readOnly);
  readOnlyRef.current = readOnly;

  /** The text of a save now in flight, kept with the draft (review L-A). */
  const sending = useRef<string | null>(null);
  const writeDraft = (draft: NoteDraft | null) =>
    writeNoteDraft(actor, slot, draft);
  const keepDraft = (value: string) =>
    writeDraft({
      text: value,
      base_version: base.current?.version ?? 1,
      ...(sending.current !== null ? { sent: sending.current } : {}),
    });

  async function load() {
    setLoadError('');
    try {
      const note = await api(WorkspaceNoteSchema, path);
      base.current = note;
      let draft = readNoteDraft(actor, slot);
      // Review L-A: a save that was in flight when the page reloaded landed as the next
      // version; the draft is based on it, not on someone else's change.
      if (
        draft &&
        draft.sent !== undefined &&
        note.version === draft.base_version + 1 &&
        note.text === draft.sent
      )
        draft = { text: draft.text, base_version: note.version };
      if (draft && draft.text !== note.text && note.status === 'active') {
        // Unsaved text from earlier in this tab comes back. If the server moved on since it
        // was typed, the person chooses; otherwise it is simply saved now.
        setText(draft.text);
        pending.current = draft.text;
        if (draft.base_version === note.version) {
          setState({ kind: 'idle' });
          schedule();
        } else {
          base.current = { ...note, version: draft.base_version };
          setState({ kind: 'conflict', theirs: note });
        }
      } else {
        // An archived note keeps any unsaved copy until it is restored.
        if (note.status === 'active') writeDraft(null);
        setText(note.text);
        setState({ kind: 'saved', at: note.updated_at });
      }
      setLoaded(true);
      onReady(id);
    } catch (e) {
      setLoadError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);
  // Review L-1: text kept in this tab while the note was archived comes back when it is
  // restored, and is saved as usual.
  const wasReadOnly = useRef(readOnly);
  useEffect(() => {
    const restored = wasReadOnly.current && !readOnly;
    wasReadOnly.current = readOnly;
    if (!restored || !loaded || !base.current) return;
    const draft = readNoteDraft(actor, slot);
    if (!draft || draft.text === textRef.current) return;
    setText(draft.text);
    pending.current = draft.text;
    if (draft.base_version === base.current.version) schedule();
    else {
      const theirs = base.current;
      base.current = { ...theirs, version: draft.base_version };
      setState({ kind: 'conflict', theirs });
    }
  }, [readOnly]);

  async function flush() {
    window.clearTimeout(timer.current);
    if (
      saving.current ||
      pending.current === null ||
      !base.current ||
      readOnlyRef.current
    )
      return;
    const value = pending.current;
    pending.current = null;
    saving.current = true;
    let release = () => {};
    inFlight.current = new Promise<void>((r) => {
      release = r;
    });
    sending.current = value;
    keepDraft(value);
    let ok = false;
    setState({ kind: 'saving' });
    try {
      const note = await trackNoteSave(
        api(WorkspaceNoteSchema, path, {
          body: { expected_version: base.current.version, text: value },
          csrf,
          quiet: true,
        }),
      );
      base.current = note;
      ok = true;
      if (pending.current === null) writeDraft(null);
      else keepDraft(pending.current);
      setState({ kind: 'saved', at: note.updated_at });
      onSaved(note);
    } catch (e) {
      pending.current ??= value;
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        try {
          const theirs = await api(WorkspaceNoteSchema, path);
          setState({ kind: 'conflict', theirs });
        } catch (e2) {
          setState({ kind: 'failed', error: message(e2) });
        }
      } else {
        setState({ kind: 'failed', error: message(e) });
      }
    } finally {
      saving.current = false;
      sending.current = null;
      inFlight.current = null;
      release();
    }
    // Typing that arrived during a successful save goes out next; after a failure nothing
    // retries on its own (review L-1).
    if (ok && pending.current !== null) schedule();
  }
  function schedule() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // While a conflict is open, nothing saves until the person chooses.
      if (stateRef.current.kind !== 'conflict') void flush();
    }, SAVE_DELAY_MS);
  }
  controls.current = {
    // Waits for a save already in flight, then saves whatever was typed during it, so Archive
    // never leaves typed text behind (review L-1).
    flush: async () => {
      while (inFlight.current) await inFlight.current;
      if (stateRef.current.kind !== 'conflict') await flush();
    },
    text: () => textRef.current,
  };
  // Save what is left when another note is picked, the notepad closes or the workspace
  // changes. During a conflict the text stays in the draft and the choice comes back next time.
  useEffect(
    () => () => {
      window.clearTimeout(timer.current);
      if (stateRef.current.kind !== 'conflict') void flush();
    },
    [],
  );
  // Review L-4: closing or reloading the page sends what is left with keepalive when it fits;
  // the draft in session storage covers a reload either way.
  useEffect(() => {
    const leave = () => {
      if (
        pending.current === null ||
        saving.current ||
        !base.current ||
        readOnlyRef.current ||
        stateRef.current.kind === 'conflict'
      )
        return;
      const body = JSON.stringify({
        expected_version: base.current.version,
        text: pending.current,
      });
      if (new Blob([body]).size > KEEPALIVE_MAX) return;
      try {
        void fetch(`/api/${path}`, {
          method: 'POST',
          keepalive: true,
          headers: {
            'Content-Type': 'application/json',
            'X-CSRF-Token': csrf,
          },
          body,
        }).catch(() => undefined);
      } catch {
        // The draft is still kept for a reload.
      }
    };
    window.addEventListener('pagehide', leave);
    return () => window.removeEventListener('pagehide', leave);
  }, [path, csrf]);

  function change(value: string) {
    setText(value);
    pending.current = value;
    keepDraft(value);
    if (state.kind === 'failed') setState({ kind: 'idle' });
    if (state.kind !== 'conflict') schedule();
  }
  function keepMine() {
    if (state.kind !== 'conflict') return;
    base.current = state.theirs;
    pending.current = text;
    keepDraft(text);
    setState({ kind: 'idle' });
    void flush();
  }
  function useTheirs() {
    if (state.kind !== 'conflict') return;
    base.current = state.theirs;
    pending.current = null;
    writeDraft(null);
    setText(state.theirs.text);
    setState({ kind: 'saved', at: state.theirs.updated_at });
  }

  if (loadError)
    return (
      <p className="error small" role="alert">
        This note could not load: {loadError}{' '}
        <button className="text" onClick={() => void load()}>
          Try again
        </button>
      </p>
    );
  if (!loaded) return <p className="small">Loading…</p>;
  const near = text.length > NOTE_MAX * 0.9;
  return (
    <>
      {state.kind === 'conflict' && (
        <div className="notice" role="alert">
          <p>
            This note was changed in another window (
            {when(state.theirs.updated_at)}). Which text do you want to keep?
          </p>
          <div className="actions">
            <button className="secondary" onClick={useTheirs}>
              Use the other window's text
            </button>
            <button className="secondary strong" onClick={keepMine}>
              Keep what is here
            </button>
          </div>
        </div>
      )}
      {preview ? (
        <div
          className="notes-preview"
          aria-label={`${summaryIn.title}, formatted`}
        >
          {text.trim() ? (
            <Markdown text={text} />
          ) : (
            <p className="small">Nothing written yet.</p>
          )}
        </div>
      ) : (
        <>
          <label htmlFor={`notes-${id}`} className="sr-only">
            {summaryIn.title}
          </label>
          <textarea
            id={`notes-${id}`}
            className="notes-field"
            value={text}
            readOnly={readOnly}
            maxLength={NOTE_MAX}
            spellCheck
            placeholder="Jot down anything while you work. Markdown works: # headings, - lists, **bold**, `code`. Only you can see these notes; they are never sent to a model."
            onChange={(e) => change(e.target.value)}
            onBlur={() => {
              if (state.kind !== 'conflict') void flush();
            }}
          />
        </>
      )}
      <p className="notes-status small" aria-live="polite">
        {state.kind === 'saving' && 'Saving…'}
        {state.kind === 'saved' && `Saved ${when(state.at)}`}
        {state.kind === 'failed' && (
          <span className="error">
            Not saved: {state.error}{' '}
            <button className="text" onClick={() => void flush()}>
              Try again
            </button>
          </span>
        )}
        {near && (
          <span>
            {' '}
            · {text.length.toLocaleString()} of {NOTE_MAX.toLocaleString()}{' '}
            characters
          </span>
        )}
      </p>
    </>
  );
}
