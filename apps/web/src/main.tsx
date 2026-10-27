import { useEffect, useRef, useState, type FormEvent } from 'react';
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
import { DesktopDevices } from './desktop.js';
import { DesktopApp } from './desktop-app.js';
import { Operations } from './operations.js';
import { Settings } from './settings.js';
import { GitHub } from './github.js';
import { Payments } from './payments.js';
import { Marketing } from './marketing.js';
import { Models } from './models.js';
import { Portfolio } from './portfolio.js';
import {
  Icon,
  VIEW_GROUPS,
  useActors,
  useRoute,
  viewGroup,
  viewLabel,
  type View,
} from './ui.js';
import { useTheme } from './theme.js';
import './style.css';
import { Studies } from './study.js';
import { PageDrafts } from './page-drafts.js';

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

function App() {
  const [health, setHealth] = useState('Checking connection…');
  const [tone, setTone] = useState<'checking' | 'ok' | 'warn' | 'down'>(
    'checking',
  );
  const [menuOpen, setMenuOpen] = useState(false);
  const theme = useTheme();
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const auth = useSession(persistent === true);
  const { route, go } = useRoute();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [wsError, setWsError] = useState('');
  async function checkHealth() {
    setHealth('Checking connection…');
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
      setHealth(
        `Connected · ${data.live_enabled ? 'live adapters configured, unverified' : 'fixture provider only'} · ${
          data.persistent
            ? 'records saved in PostgreSQL'
            : data.storage === 'unavailable'
              ? 'database unavailable'
              : 'persistence off'
        }${data.maintenance.degraded ? ' · maintenance degraded (see /api/health)' : ''}`,
      );
    } catch {
      setPersistent(false);
      setTone('down');
      setHealth('API unavailable · start the local API and retry');
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
  const open = (view: View, id?: string, q?: string) =>
    go({
      view,
      ...(id === undefined ? {} : { id }),
      ...(q === undefined ? {} : { q }),
    });

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
        return <Settings session={s} open={open} />;
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
        return <Submit session={s} workspace={workspace} open={open} />;
      case 'catalog':
        return (
          <Catalog
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
  useEffect(() => {
    document.title = inStudio
      ? `${label} · Creator Agent`
      : 'Creator Agent · Local studio';
  }, [inStudio, label]);
  useEffect(() => {
    if (!menuOpen) return;
    const close = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [menuOpen]);
  const themeButton = (
    <button
      className="ghost icon-button"
      onClick={theme.toggle}
      aria-label={theme.theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
      title={theme.theme === 'dark' ? 'Use light theme' : 'Use dark theme'}
    >
      <Icon name={theme.theme === 'dark' ? 'sun' : 'moon'} />
    </button>
  );
  return (
    <div className={inStudio ? 'shell' : 'shell single'}>
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
          <a className="brand" href={`#/overview?ws=${workspace.id}`}>
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
          <nav aria-label="Views">
            {VIEW_GROUPS.map((g) => (
              <div className="nav-group" key={g.label}>
                <h2 id={`nav-${g.label}`}>{g.label}</h2>
                <ul aria-labelledby={`nav-${g.label}`}>
                  {g.views.map((key) => (
                    <li key={key}>
                      <a
                        href={`#/${key}?ws=${workspace.id}`}
                        aria-current={route.view === key ? 'page' : undefined}
                        onClick={(e) => {
                          e.preventDefault();
                          setMenuOpen(false);
                          open(key);
                        }}
                      >
                        {viewLabel(key)}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
          <div className="sidebar-foot">
            <span>Schema 1.0 · Local control</span>
            <span>
              Live calls need a provider, pricing, a grant and a budget.
            </span>
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
                <span>{viewGroup(route.view)}</span>
                <span aria-hidden="true">/</span>
                <strong>{label}</strong>
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
            <span role="status" className={`conn conn-${tone}`}>
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
            {themeButton}
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
            {inStudio && auth.session ? (
              <PageDrafts
                key={`${auth.session.csrf_token}:${workspace?.id}`}
                route={route}
                render={body}
              />
            ) : (
              body()
            )}
          </DesktopApp.Provider>
        </main>
        {!inStudio && (
          <footer className="foot">
            <span>Schema 1.0 · Local control</span>
            <span>
              Live calls need a provider, pricing, a grant and a budget.
            </span>
          </footer>
        )}
      </div>
    </div>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
