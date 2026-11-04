import { lazy, useEffect, useRef, useState, type FormEvent } from 'react';
import { PageLoad } from './page-load.js';
import { AsideButton, RightSidebar, useAside } from './aside.js';
import { createRoot } from 'react-dom/client';
import {
  FixtureResponseSchema,
  HealthSchema,
  WorkspaceSchema,
  parse,
  z,
  type FixtureResponse,
  type Workspace,
} from '@creator/contracts';
import { Catalog } from './catalog.js';
import { Oversight, SignIn, api, message, useSession } from './oversight.js';
import { Budgets } from './budgets.js';
import { Workflows } from './workflows.js';
import { Evidence } from './evidence.js';
import { Scoring } from './selection.js';
import { Overview } from './overview.js';
import { Submit } from './submit.js';
import { Compare } from './compare.js';
import { Search } from './search.js';
import { Activity } from './activity.js';
import { Gallery } from './gallery.js';
import { BuildView } from './build.js';
import { DesktopDevices } from './desktop.js';
import { DesktopApp } from './desktop-app.js';
import { Settings } from './settings.js';
import {
  Icon,
  PAGES,
  pageOf,
  tabsOf,
  useActors,
  useRoute,
  viewLabel,
  type View,
} from './ui.js';
import { useTheme } from './theme.js';
import './style.css';
import { PageDrafts } from './page-drafts.js';
import { UsageIndicator } from './usage.js';
import { NextStep, useStudioFacts } from './next-step.js';
import { useActivityDots } from './activity-dots.js';
import { dotText, type MarkedView } from './activity-marks.js';
import { PathView } from './path.js';
import { nextStep } from './next-rules.js';
import { routeHash } from './pages.js';
import { Chat } from './chat.js';
import type { Prefill } from './prefill.js';

// Declared once: visited pages keep their component identity and session-memory drafts.
const Operations = lazy(() =>
  import('./operations.js').then((m) => ({ default: m.Operations })),
);
const GitHub = lazy(() =>
  import('./github.js').then((m) => ({ default: m.GitHub })),
);
const Payments = lazy(() =>
  import('./payments.js').then((m) => ({ default: m.Payments })),
);
const Marketing = lazy(() =>
  import('./marketing.js').then((m) => ({ default: m.Marketing })),
);
const Models = lazy(() =>
  import('./models.js').then((m) => ({ default: m.Models })),
);
const Portfolio = lazy(() =>
  import('./portfolio.js').then((m) => ({ default: m.Portfolio })),
);
const Studies = lazy(() =>
  import('./study.js').then((m) => ({ default: m.Studies })),
);

const choices = [
  ['use_existing', 'Use an existing tool'],
  ['change_process', 'Change a process'],
  ['human_led', 'Human-led response'],
  ['hybrid', 'Combine people and tools'],
  ['build', 'Consider custom software'],
  ['investigate', 'Investigate further'],
  ['defer', 'Defer pending evidence'],
  ['decline', 'Decline the proposal'],
  ['failed', 'Simulate a failed attempt'],
];
async function readResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body && typeof body === 'object' && 'error' in body
        ? JSON.stringify(body.error)
        : `API error ${response.status}`;
    throw new Error(message);
  }
  return body;
}

/** The T01 stateless fixture task: shown when no database is configured. */
function FixtureDemo() {
  const [goal, setGoal] = useState(
    'Compare a shared checklist with custom software',
  );
  const [outcome, setOutcome] = useState('use_existing');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FixtureResponse | null>(null);
  const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    try {
      const response = await fetch('/api/fixture', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ goal, outcome }),
        signal: AbortSignal.timeout(5000),
      });
      setResult(parse(FixtureResponseSchema, await readResponse(response)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'The request failed.');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="workspace">
      <section className="panel">
        <h2>Try a bounded task</h2>
        <span className="badge">Stateless fixture</span>
        <p>
          Choose the simulated disposition. This tests the local application
          path, not the quality of a recommendation. Nothing is saved.
        </p>
        <form onSubmit={(event) => void submit(event)}>
          <label htmlFor="goal">Task brief</label>
          <textarea
            id="goal"
            required
            maxLength={500}
            rows={4}
            value={goal}
            onChange={(e) => setGoal(e.target.value)}
          />
          <label htmlFor="outcome">Fixture outcome</label>
          <select
            id="outcome"
            value={outcome}
            onChange={(e) => setOutcome(e.target.value)}
          >
            {choices.map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button
            className="primary"
            disabled={busy || !goal.trim()}
            type="submit"
          >
            {busy ? 'Running fixture…' : 'Run fixture'}
            <span aria-hidden="true">↗</span>
          </button>
        </form>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>
      <section className="panel result" aria-live="polite">
        <h2>
          {result
            ? 'Outcome recorded in this view'
            : 'Your result will appear here'}
        </h2>
        {result ? (
          <>
            <span className="badge">SYNTHETIC · FIXTURE</span>
            <p className="summary">{result.result.summary}</p>
            <dl>
              <div>
                <dt>Product stage</dt>
                <dd>{result.product.stage.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt>Execution</dt>
                <dd>{result.execution.state}</dd>
              </div>
              <div>
                <dt>Research condition</dt>
                <dd>{result.execution.condition.replaceAll('_', ' ')}</dd>
              </div>
              <div>
                <dt>Provider cost</dt>
                <dd>0 nano-USD · fixture only</dd>
              </div>
            </dl>
            <details>
              <summary>Inspect contract and version bindings</summary>
              <pre>{JSON.stringify(result, null, 2)}</pre>
            </details>
          </>
        ) : (
          <div className="empty">
            <span aria-hidden="true">◎</span>
            <p>Nothing runs until you submit.</p>
          </div>
        )}
      </section>
    </div>
  );
}

const LAST_WORKSPACE = 'creator.workspace';
/** The path step last seen on Projects, per workspace, for the Projects nav dot. */
const SEEN_STEP = 'creator.path-seen';
/** Remembers the open workspace in this browser only; a blocked store just forgets it. */
function rememberWorkspace(id: string) {
  try {
    localStorage.setItem(LAST_WORKSPACE, id);
  } catch {
    // Private windows and blocked storage fall back to the newest workspace.
  }
}
/** The workspace to open when the address names none: the last one used here, else the newest. */
function startingWorkspace(list: Workspace[]) {
  let last: string | null = null;
  try {
    last = localStorage.getItem(LAST_WORKSPACE);
  } catch {
    last = null;
  }
  if (last && list.some((w) => w.id === last)) return last;
  return list.reduce((a, b) => (b.created_at > a.created_at ? b : a)).id;
}
/** A workspace's name in the switcher; a shared name gets its creation date to tell them apart. */
function workspaceLabel(w: Workspace, all: Workspace[]) {
  const twin = all.some((o) => o.id !== w.id && o.name === w.name);
  const created = new Date(w.created_at).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
  return [
    w.name,
    // The id prefix still tells twins apart when they were created the same minute.
    ...(twin ? [`${created} (${w.id.slice(0, 4)})`] : []),
    w.record_mode === 'fixture' ? 'fixture' : 'real',
    ...(w.role !== 'owner' ? [w.role] : []),
  ].join(' · ');
}

/** Creates a workspace; fixture workspaces hold only synthetic records. */
function NewWorkspace({
  csrf,
  created,
}: {
  csrf: string;
  created: (w: Workspace) => void;
}) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [mode, setMode] = useState<'fixture' | 'real'>('fixture');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    try {
      created(
        await api(WorkspaceSchema, 'workspaces', {
          csrf,
          body: { name: name.trim(), record_mode: mode },
        }),
      );
      setOpen(false);
      setName('');
    } catch (err) {
      setError(message(err));
    }
  }
  if (!open)
    return (
      <button className="secondary" onClick={() => setOpen(true)}>
        New workspace
      </button>
    );
  return (
    <form className="inline-form" onSubmit={(e) => void submit(e)}>
      <label htmlFor="nwname" className="inline">
        Name
      </label>
      <input
        id="nwname"
        required
        maxLength={300}
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <label htmlFor="nwmode" className="inline">
        Records
      </label>
      <select
        id="nwmode"
        value={mode}
        onChange={(e) => setMode(e.target.value as 'fixture' | 'real')}
      >
        <option value="fixture">Fixture (synthetic only)</option>
        <option value="real">Real</option>
      </select>
      <button className="secondary strong" disabled={!name.trim()}>
        Create
      </button>
      <button
        type="button"
        className="secondary"
        onClick={() => setOpen(false)}
      >
        Cancel
      </button>
      {error && (
        <span className="error" role="alert">
          {error}
        </span>
      )}
    </form>
  );
}

/** A small dot saying what is new behind a link; the words are in the tooltip and for readers. */
function ActivityDot({ text }: { text: string }) {
  return (
    <span className="nav-dot activity-dot" title={text}>
      <span className="sr-only">: {text}</span>
    </span>
  );
}

/**
 * The tab row of the current page, and a second row for a tab that holds several sections
 * (Launch). Links carry real addresses, so they open in a new tab too.
 */
function PageTabs({
  view,
  ws,
  open,
  unseen,
}: {
  view: View;
  ws: string;
  open: (view: View) => void;
  /** Tabs with something new since they were last open (activity dots). */
  unseen: readonly MarkedView[];
}) {
  const page = pageOf(view);
  const tabs = tabsOf(page);
  const active = tabs.find((t) => t.sections.some((s) => s.view === view));
  // A page with one screen (Chat) needs no tab row.
  if (tabs.length === 1 && tabs[0]!.sections.length === 1) return null;
  const link = (
    target: View,
    label: string,
    current: boolean,
    views: readonly View[],
  ) => {
    const news = current ? '' : dotText(views, unseen);
    return (
      <a
        href={routeHash({ view: target, ws, id: '', q: '' })}
        aria-current={current ? 'page' : undefined}
        onClick={(e) => {
          e.preventDefault();
          open(target);
        }}
      >
        {label}
        {news && <ActivityDot text={news} />}
      </a>
    );
  };
  return (
    <nav className="page-tabs" aria-label={`${page.label} tabs`}>
      <ul className="tabs">
        {tabs.map((t) => (
          <li key={t.label}>
            {link(
              t === active ? view : t.sections[0]!.view,
              t.label,
              t === active,
              // The open tab of a group still shows a dot for its other sections' news.
              t.sections.map((x) => x.view).filter((v) => v !== view),
            )}
          </li>
        ))}
      </ul>
      {active && active.sections.length > 1 && (
        <ul className="subtabs" aria-label={`${active.label} sections`}>
          {active.sections.map((s) => (
            <li key={s.view}>
              {link(s.view, s.label, s.view === view, [s.view])}
            </li>
          ))}
        </ul>
      )}
    </nav>
  );
}

function App() {
  const [health, setHealth] = useState('Checking connection…');
  // The full health line, shown on hover; the bar keeps a short form so it fits on one row.
  const [healthDetail, setHealthDetail] = useState('');
  const [tone, setTone] = useState<'checking' | 'ok' | 'warn' | 'down'>(
    'checking',
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useTheme();
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const auth = useSession(persistent === true);
  const { route, go, lastIn } = useRoute();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [wsError, setWsError] = useState('');
  async function checkHealth() {
    setHealth('Checking connection…');
    setHealthDetail('');
    setTone('checking');
    try {
      const data = parse(
        HealthSchema,
        await readResponse(
          await fetch('/api/health', { signal: AbortSignal.timeout(5000) }),
        ),
      );
      setPersistent(data.persistent);
      setTone(data.persistent ? 'ok' : 'warn');
      const storage = data.persistent
        ? 'records saved in PostgreSQL'
        : data.storage === 'unavailable'
          ? 'database unavailable'
          : 'persistence off';
      const degraded = data.maintenance.degraded
        ? 'maintenance degraded (see /api/health)'
        : '';
      // Full audit 2026-11-02: the long line wrapped the top bar onto two rows on most pages,
      // and "live adapters configured, unverified" read like a fault. Problems stay in the bar;
      // the rest is on hover.
      setHealth(
        ['Connected', data.persistent ? '' : storage, degraded]
          .filter(Boolean)
          .join(' · '),
      );
      setHealthDetail(
        [
          'Connected to the local API',
          data.live_enabled
            ? 'live adapters configured (each model and connection is verified separately)'
            : 'fixture provider only',
          storage,
          degraded,
        ]
          .filter(Boolean)
          .join(' · '),
      );
    } catch {
      setPersistent(false);
      setTone('down');
      setHealth('API unavailable · start the local API and retry');
      setHealthDetail('');
    }
  }
  useEffect(() => {
    void checkHealth();
  }, []);
  async function loadWorkspaces(select?: string) {
    setWsError('');
    try {
      const list = await api(z.array(WorkspaceSchema), 'workspaces');
      setWorkspaces(list);
      const keep = select ?? route.ws;
      if (!list.some((w) => w.id === keep) && list[0])
        go({ ws: startingWorkspace(list) }, true);
      else if (select) go({ ws: select }, true);
    } catch (e) {
      setWsError(message(e));
    }
  }
  useEffect(() => {
    if (auth.session) void loadWorkspaces();
  }, [auth.session]);
  const workspace = workspaces?.find((w) => w.id === route.ws) ?? null;
  useEffect(() => {
    if (workspace) rememberWorkspace(workspace.id);
  }, [workspace?.id]);
  // An address without a known workspace (edited by hand, or an old link) opens the usual
  // starting workspace instead of the "no workspace yet" page.
  // A workspace created a moment ago may not be in the cached list yet, so an unknown id
  // reloads the list once; loadWorkspaces then redirects only if it is still unknown.
  const rechecked = useRef('');
  useEffect(() => {
    if (!workspaces || workspaces.length === 0 || workspace) return;
    if (route.ws && rechecked.current !== route.ws) {
      rechecked.current = route.ws;
      void loadWorkspaces();
    } else go({ ws: startingWorkspace(workspaces), id: '' }, true);
  }, [workspaces, route.ws]);
  const names = useActors(workspace?.id ?? '');
  const studio = Boolean(persistent && auth.session && workspace);
  const facts = useStudioFacts(
    studio ? workspace : null,
    route.view,
    auth.managed,
  );
  // The Projects dot marks a path step the person has not seen yet: it shows when the
  // step changes and clears once Projects is opened (PR #97 review L-2). Remembered in this
  // browser only; a blocked store just shows the dot again.
  const pathStep = facts ? nextStep('path', facts) : null;
  const stepKey = pathStep ? `${pathStep.tone}:${pathStep.text}` : '';
  const [seenStep, setSeenStep] = useState<Record<string, string>>(() => {
    try {
      return JSON.parse(localStorage.getItem(SEEN_STEP) ?? '{}') as Record<
        string,
        string
      >;
    } catch {
      return {};
    }
  });
  const onProjects = pageOf(route.view).key === 'projects';
  useEffect(() => {
    if (!workspace || !stepKey || !onProjects) return;
    if (seenStep[workspace.id] === stepKey) return;
    const next = { ...seenStep, [workspace.id]: stepKey };
    setSeenStep(next);
    try {
      localStorage.setItem(SEEN_STEP, JSON.stringify(next));
    } catch {
      // Private windows: the dot comes back next time, which is harmless.
    }
  }, [workspace?.id, stepKey, onProjects]);
  const newStep =
    workspace !== null &&
    pathStep !== null &&
    pathStep.tone !== 'clear' &&
    !onProjects &&
    seenStep[workspace.id] !== stepKey;
  const aside = useAside();
  // Activity dots: something finished on a tab the person is not on (a run, an approval, a
  // build, a Chat reply). Cleared by opening that tab.
  const unseen = useActivityDots(
    studio ? workspace!.id : null,
    route.view,
    facts?.buildKeys,
  );
  const open = (view: View, id?: string, q?: string) =>
    go({
      view,
      ...(id === undefined ? {} : { id }),
      ...(q === undefined ? {} : { q }),
    });
  // A value Chat hands to the fetch form (Sources) or the theme field (Discover). It only
  // fills the field; the person still submits the form there.
  // PR #98 L-1: a hand-off fills its field once, in the workspace it came from. The page
  // calls `used` after filling, so "Reset these fields" or a later visit starts empty.
  const [prefill, setPrefill] = useState<{
    ws: string;
    view: 'evidence' | 'submit';
    value: string;
    nonce: number;
  } | null>(null);
  const prefillSeq = useRef(0);
  const fill = (view: 'evidence' | 'submit', value: string) => {
    if (!workspace) return;
    setPrefill({
      ws: workspace.id,
      view,
      value,
      nonce: ++prefillSeq.current,
    });
    open(view);
  };
  const prefillFor = (view: 'evidence' | 'submit', ws: string): Prefill =>
    prefill && prefill.view === view && prefill.ws === ws
      ? {
          value: prefill.value,
          nonce: prefill.nonce,
          used: () =>
            setPrefill((p) => (p?.nonce === prefill.nonce ? null : p)),
        }
      : null;

  function body(pageRoute = route) {
    const workspace = workspaces?.find((w) => w.id === pageRoute.ws) ?? null;
    const focus = (id: string) => go({ id }, true, pageRoute.view);
    const open = (view: View, id?: string, q?: string) =>
      go(
        {
          view,
          ...(id === undefined ? {} : { id }),
          ...(q === undefined ? {} : { q }),
        },
        false,
        pageRoute.view,
      );
    if (persistent === null) return <p className="small">Connecting…</p>;
    if (!persistent) return <FixtureDemo />;
    if (!auth.session)
      return (
        <SignIn
          mode={auth.mode}
          managed={auth.managed}
          error={auth.error}
          signIn={auth.signIn}
        />
      );
    if (wsError)
      return (
        <div className="error-box" role="alert">
          <p className="error">{wsError}</p>
          <button className="secondary" onClick={() => void loadWorkspaces()}>
            Try again
          </button>
        </div>
      );
    if (!workspaces) return <p className="small">Loading workspaces…</p>;
    if (!workspace)
      return (
        <section className="panel">
          <h2>No workspace yet</h2>
          {auth.managed ? (
            <p>
              Create a fixture workspace to explore with synthetic data, or a
              real workspace for your own records.
            </p>
          ) : (
            <p>
              Create a fixture workspace to explore with synthetic data, or run{' '}
              <code>pnpm cli seed-selection</code> for a filled-in
              demonstration.
            </p>
          )}
          <NewWorkspace
            csrf={auth.session.csrf_token}
            created={(w) => void loadWorkspaces(w.id)}
          />
        </section>
      );
    const s = auth.session;
    switch (pageRoute.view) {
      case 'chat':
        return (
          <Chat
            key={workspace.id}
            session={s}
            workspace={workspace}
            facts={facts}
            focus={pageRoute.id}
            onFocus={focus}
            open={(view) => open(view)}
            fill={fill}
          />
        );
      case 'path':
        return <PathView facts={facts} open={open} />;
      case 'portfolio':
        return (
          <Portfolio key={workspace.id} workspace={workspace} session={s} />
        );
      case 'marketing':
        return (
          <Marketing key={workspace.id} workspace={workspace} session={s} />
        );
      case 'models':
        return <Models key={workspace.id} workspace={workspace} session={s} />;
      case 'operations':
        return <Operations />;
      case 'settings':
        return <Settings session={s} workspace={workspace} open={open} />;
      case 'payments':
        return (
          <Payments
            key={workspace.id}
            session={s}
            workspace={workspace}
            open={open}
          />
        );
      case 'github':
        return (
          <GitHub
            key={workspace.id}
            session={s}
            workspace={workspace}
            open={open}
          />
        );
      case 'desktop':
        return (
          <DesktopDevices
            key={workspace.id}
            workspace={workspace}
            session={s}
          />
        );
      case 'overview':
        return <Overview session={s} workspace={workspace} open={open} />;
      case 'submit':
        return (
          <Submit
            session={s}
            workspace={workspace}
            open={open}
            prefill={prefillFor('submit', workspace.id)}
          />
        );
      case 'catalog':
        return (
          <Catalog
            session={s}
            workspace={workspace}
            focus={pageRoute.id}
            onFocus={focus}
            names={names}
            open={open}
          />
        );
      case 'compare':
        return (
          <Compare
            session={s}
            workspace={workspace}
            focus={pageRoute.id}
            onFocus={focus}
            open={open}
          />
        );
      case 'evidence':
        return (
          <Evidence
            session={s}
            workspace={workspace}
            focus={pageRoute.id}
            onFocus={focus}
            prefill={prefillFor('evidence', workspace.id)}
          />
        );
      case 'decisions':
        return (
          <Oversight
            session={s}
            workspace={workspace}
            focus={pageRoute.id}
            names={names}
          />
        );
      case 'runs':
        return (
          <Workflows
            session={s}
            workspace={workspace}
            focus={pageRoute.id}
            onFocus={focus}
          />
        );
      case 'budgets':
        return <Budgets session={s} workspace={workspace} />;
      case 'scores':
        return (
          <Scoring
            session={s}
            workspace={workspace}
            focus={pageRoute.id}
            onFocus={focus}
            open={open}
          />
        );
      case 'search':
        return (
          <Search
            workspace={workspace}
            q={pageRoute.q}
            setQ={(q) => go({ q }, true)}
            open={open}
          />
        );
      case 'activity':
        return (
          <Activity
            workspace={workspace}
            q={pageRoute.q}
            setQ={(q) => go({ q }, true)}
            focus={pageRoute.id}
            open={open}
          />
        );
      case 'studies':
        return <Studies workspace={workspace} session={s} />;
      case 'build':
        return <BuildView workspace={workspace} session={s} open={open} />;
      case 'gallery':
        return (
          <Gallery
            workspace={workspace}
            session={s}
            focus={pageRoute.id}
            open={open}
          />
        );
    }
  }
  const signedIn = persistent && auth.session;
  const inStudio = Boolean(signedIn && workspace);
  const label = viewLabel(route.view);
  const pageLabel = pageOf(route.view).label;
  useEffect(() => {
    document.title = inStudio
      ? `${label === pageLabel ? label : `${label} · ${pageLabel}`} · Creator Agent`
      : 'Creator Agent · Local studio';
  }, [inStudio, label, pageLabel]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);
  // In the studio it sits in the sidebar foot, so it never wraps onto its own topbar line.
  const themeButton = (
    <button
      className="ghost icon-button theme-button"
      onClick={theme.toggle}
      aria-label={theme.theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
      title={theme.theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
    >
      <Icon name={theme.theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
  return (
    <div
      className={inStudio ? 'shell' : 'shell single'}
      data-aside={
        inStudio && workspace && auth.session
          ? aside.mode === 'docked'
            ? aside.isOpen
              ? 'docked'
              : 'rail'
            : aside.mode
          : undefined
      }
    >
      <a
        className="skip"
        href="#content"
        onClick={(e) => {
          // The hash holds the route, so focus the content instead of navigating.
          e.preventDefault();
          document.getElementById('content')?.focus();
        }}
      >
        Skip to content
      </a>
      {inStudio && workspace && (
        <aside
          id="sidebar"
          className="sidebar"
          data-open={menuOpen ? 'true' : undefined}
        >
          <a
            className="brand"
            href={routeHash({
              view: 'overview',
              ws: workspace.id,
              id: '',
              q: '',
            })}
          >
            <span className="mark" aria-hidden="true">
              CA
            </span>
            Creator Agent
          </a>
          <div className="wsbar">
            <label htmlFor="ws">Workspace</label>
            <select
              id="ws"
              value={workspace.id}
              title={workspaceLabel(workspace, workspaces!)}
              onChange={(e) => {
                setMenuOpen(false);
                go({ ws: e.target.value, id: '' });
              }}
            >
              {workspaces!.map((w) => (
                <option key={w.id} value={w.id}>
                  {workspaceLabel(w, workspaces!)}
                </option>
              ))}
            </select>
            <NewWorkspace
              csrf={auth.session!.csrf_token}
              created={(w) => void loadWorkspaces(w.id)}
            />
          </div>
          <nav aria-label="Pages">
            <ul className="page-nav">
              {PAGES.map((page) => {
                const target = lastIn(page.key) ?? page.sections[0]!.view;
                const here = pageOf(route.view).key === page.key;
                const waiting =
                  page.key === 'monitor' && facts ? facts.pending : 0;
                const ready = page.key === 'projects' && newStep;
                // On the page itself its tab row carries the dots instead.
                const news = here
                  ? ''
                  : dotText(
                      page.sections.map((x) => x.view),
                      unseen,
                    );
                return (
                  <li key={page.key}>
                    <a
                      href={routeHash({
                        view: target,
                        ws: workspace.id,
                        id: '',
                        q: '',
                      })}
                      aria-current={here ? 'page' : undefined}
                      onClick={(e) => {
                        e.preventDefault();
                        setMenuOpen(false);
                        open(target);
                      }}
                    >
                      <span>{page.label}</span>
                      {waiting > 0 && (
                        <span
                          className="nav-count"
                          title={`${waiting} waiting for you`}
                        >
                          {waiting}
                          <span className="sr-only"> waiting for you</span>
                        </span>
                      )}
                      {(ready || news) && (
                        <ActivityDot
                          text={[
                            ready ? 'The path has a new step for you' : '',
                            news,
                          ]
                            .filter(Boolean)
                            .join('; ')}
                        />
                      )}
                    </a>
                  </li>
                );
              })}
            </ul>
          </nav>
          <div className="sidebar-foot">
            {themeButton}
            <span>Local control</span>
            <span>Models are used only through connections you approve.</span>
          </div>
        </aside>
      )}
      {inStudio && menuOpen && (
        <div
          className="scrim"
          aria-hidden="true"
          onClick={() => setMenuOpen(false)}
        />
      )}
      <div className="column">
        {signedIn && auth.error && (
          <p role="alert" className="error">
            {auth.error}
          </p>
        )}
        <header className="topbar">
          {inStudio ? (
            <>
              <button
                className="ghost icon-button menu-button"
                aria-expanded={menuOpen}
                aria-controls="sidebar"
                aria-label={menuOpen ? 'Close navigation' : 'Open navigation'}
                onClick={() => setMenuOpen((v) => !v)}
              >
                <Icon name={menuOpen ? 'close' : 'menu'} />
              </button>
              <p className="crumbs">
                {pageLabel === label ? (
                  <strong>{label}</strong>
                ) : (
                  <>
                    <span>{pageLabel}</span>
                    <span aria-hidden="true">/</span>
                    <strong>{label}</strong>
                  </>
                )}
              </p>
              <h1 className="sr-only">Creator Agent: {label}</h1>
            </>
          ) : (
            <>
              <span className="brand">
                <span className="mark" aria-hidden="true">
                  CA
                </span>
                Creator Agent
              </span>
              <h1 className="sr-only">Creator Agent local studio</h1>
            </>
          )}
          <div className="topbar-end">
            <span
              role="status"
              className={`conn conn-${tone}`}
              title={healthDetail || undefined}
            >
              <span className="dot" aria-hidden="true" />
              {health}
            </span>
            {!persistent && persistent !== null && (
              <button className="secondary" onClick={() => void checkHealth()}>
                Check connection
              </button>
            )}
            {signedIn && (
              <span className="who">
                {auth.session!.display_name} ·{' '}
                {auth.managed
                  ? 'this computer'
                  : auth.session!.method === 'dev_local'
                    ? 'local development'
                    : 'OIDC'}{' '}
                <button className="text" onClick={() => void auth.signOut()}>
                  Sign out
                </button>
              </span>
            )}
            {inStudio && signedIn && workspace && (
              <UsageIndicator key={workspace.id} workspace={workspace} />
            )}
            {inStudio && workspace && auth.session && (
              <AsideButton aside={aside} />
            )}
            {!inStudio && themeButton}
          </div>
        </header>
        {workspace?.record_mode === 'fixture' && signedIn && (
          <p className="mode-banner" role="note">
            <Icon name="info" />
            <span>
              <strong>Fixture mode.</strong> Synthetic records and a
              deterministic model adapter. Amounts are simulated units, not
              money. Nothing here is real research or a real recommendation.
            </span>
          </p>
        )}
        <main id="content" tabIndex={-1}>
          <DesktopApp.Provider value={auth.managed}>
            {inStudio && workspace && (
              <>
                <NextStep
                  facts={facts}
                  view={route.view}
                  open={(view) => open(view)}
                />
                <PageTabs
                  view={route.view}
                  ws={workspace.id}
                  open={(view) => open(view)}
                  unseen={unseen}
                />
              </>
            )}
            {inStudio && auth.session ? (
              <PageDrafts
                key={`${auth.session.csrf_token}:${workspace?.id}`}
                route={route}
                render={(page) => <PageLoad>{body(page)}</PageLoad>}
              />
            ) : (
              <PageLoad>{body()}</PageLoad>
            )}
          </DesktopApp.Provider>
        </main>
        {!inStudio && (
          <footer className="foot">
            <span>Local control</span>
            <span>Models are used only through connections you approve.</span>
          </footer>
        )}
      </div>
      {inStudio && workspace && auth.session && (
        <RightSidebar
          workspace={workspace}
          actor={auth.session.actor_id}
          csrf={auth.session.csrf_token}
          aside={aside}
          open={(view, id) => open(view, id)}
        />
      )}
    </div>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
