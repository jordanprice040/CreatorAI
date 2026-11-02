import { useEffect, useRef, useState } from 'react';
import {
  ActivityNowSchema,
  ActivityPageSchema,
  NOTE_MAX,
  WorkspaceNoteSchema,
  type ActivityEntry,
  type ActivityNowItem,
  type Workspace,
  type WorkspaceNote,
} from '@creator/contracts';
import { api, ApiError, message, when } from './oversight.js';
import { Icon, eventText, subjectTarget, type View } from './ui.js';
import './aside.css';

// ADR-0060: the right-hand sidebar. Two tabs, Activity (what is running now and the latest
// audit events) and Notes (the person's own notepad for this workspace, saved as they type).
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

function nowTarget(item: ActivityNowItem): [View, string?] {
  if (item.kind === 'workflow') return ['runs', item.id];
  if (item.kind === 'desktop_job') return ['desktop'];
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
  csrf,
  aside,
  open,
}: {
  workspace: Workspace;
  csrf: string;
  aside: Aside;
  open: (view: View, id?: string) => void;
}) {
  const feed = useActivityFeed(workspace.id);
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

  const rail = (
    <nav className="aside-rail" aria-label="Sidebar">
      <button
        className="ghost icon-button"
        aria-label={`Activity${unseen ? `, ${unseen} new` : ''}${feed.now.length ? `, ${feed.now.length} running` : ''}`}
        title="Activity (Ctrl+.)"
        aria-pressed={aside.isOpen && aside.tab === 'activity'}
        onClick={() => aside.show('activity')}
      >
        <Icon name="pulse" />
        {(unseen > 0 || feed.now.length > 0) && (
          <span
            className={feed.now.length ? 'rail-dot running' : 'rail-dot'}
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
              {key === 'activity' && feed.now.length > 0 && (
                <span className="nav-count">{feed.now.length}</span>
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
        <ActivityTab feed={feed} isNew={isNew} go={go} />
      </div>
      <div
        id="aside-notes"
        role="tabpanel"
        aria-labelledby="aside-tab-notes"
        hidden={aside.tab !== 'notes'}
        className="aside-body notes-body"
      >
        <Notes key={workspace.id} ws={workspace.id} csrf={csrf} />
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
}: {
  feed: ReturnType<typeof useActivityFeed>;
  isNew: (e: ActivityEntry) => boolean;
  go: (view: View, id?: string) => void;
}) {
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
            const [view, id] = nowTarget(item);
            return (
              <li key={`${item.kind}:${item.id}`}>
                <button className="aside-row" onClick={() => go(view, id)}>
                  <span className="aside-row-top">
                    <span className="spinner-dot" aria-hidden="true" />
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
            const target = subjectTarget(e.subject_kind, e.subject_id);
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
                {target ? (
                  <button
                    className="aside-row"
                    onClick={() => go(target[0], target[1])}
                  >
                    {body}
                  </button>
                ) : (
                  <div className="aside-row">{body}</div>
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

/**
 * The person's own notes for this workspace. Saved a moment after typing stops, when the
 * field loses focus and when the sidebar closes. A save from another window since this one
 * loaded is never overwritten silently: the person picks which text to keep.
 */
function Notes({ ws, csrf }: { ws: string; csrf: string }) {
  const [text, setText] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [state, setState] = useState<SaveState>({ kind: 'idle' });
  const base = useRef<WorkspaceNote | null>(null);
  const pending = useRef<string | null>(null);
  const saving = useRef(false);
  const timer = useRef<number | undefined>(undefined);

  async function load() {
    setLoadError('');
    try {
      const note = await api(WorkspaceNoteSchema, `workspaces/${ws}/notes`);
      base.current = note;
      setText(note.text);
      setState(
        note.updated_at
          ? { kind: 'saved', at: note.updated_at }
          : { kind: 'idle' },
      );
      setLoaded(true);
    } catch (e) {
      setLoadError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, [ws]);

  async function flush() {
    window.clearTimeout(timer.current);
    if (saving.current || pending.current === null || !base.current) return;
    const value = pending.current;
    pending.current = null;
    saving.current = true;
    setState({ kind: 'saving' });
    try {
      const note = await api(WorkspaceNoteSchema, `workspaces/${ws}/notes`, {
        body: { expected_version: base.current.version, text: value },
        csrf,
        quiet: true,
      });
      base.current = note;
      setState({
        kind: 'saved',
        at: note.updated_at ?? new Date().toISOString(),
      });
    } catch (e) {
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        try {
          const theirs = await api(
            WorkspaceNoteSchema,
            `workspaces/${ws}/notes`,
          );
          pending.current = value;
          setState({ kind: 'conflict', theirs });
        } catch (e2) {
          pending.current ??= value;
          setState({ kind: 'failed', error: message(e2) });
        }
      } else {
        pending.current ??= value;
        setState({ kind: 'failed', error: message(e) });
      }
    } finally {
      saving.current = false;
    }
    // Typing that arrived during the save goes out next.
    if (pending.current !== null && !saving.current) schedule();
  }
  function schedule() {
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      // While a conflict is open, nothing saves until the person chooses.
      if (stateRef.current.kind !== 'conflict') void flush();
    }, SAVE_DELAY_MS);
  }
  const stateRef = useRef(state);
  stateRef.current = state;
  // Save what is left when the sidebar closes or the workspace changes.
  useEffect(
    () => () => {
      if (stateRef.current.kind !== 'conflict') void flush();
    },
    [],
  );

  function change(value: string) {
    setText(value);
    pending.current = value;
    if (state.kind !== 'conflict') schedule();
  }
  function keepMine() {
    if (state.kind !== 'conflict') return;
    base.current = state.theirs;
    pending.current = text;
    setState({ kind: 'idle' });
    void flush();
  }
  function useTheirs() {
    if (state.kind !== 'conflict') return;
    base.current = state.theirs;
    pending.current = null;
    setText(state.theirs.text);
    setState(
      state.theirs.updated_at
        ? { kind: 'saved', at: state.theirs.updated_at }
        : { kind: 'idle' },
    );
  }

  if (loadError)
    return (
      <p className="error small" role="alert">
        Notes could not load: {loadError}{' '}
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
            These notes were changed in another window
            {state.theirs.updated_at
              ? ` (${when(state.theirs.updated_at)})`
              : ''}
            . Which text do you want to keep?
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
      <label htmlFor={`notes-${ws}`} className="sr-only">
        Your notes for this workspace
      </label>
      <textarea
        id={`notes-${ws}`}
        className="notes-field"
        value={text}
        maxLength={NOTE_MAX}
        spellCheck
        placeholder="Jot down anything while you work. Only you can see these notes; they are saved in this workspace and never sent to a model."
        onChange={(e) => change(e.target.value)}
        onBlur={() => {
          if (state.kind !== 'conflict') void flush();
        }}
      />
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
