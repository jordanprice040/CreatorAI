import { useEffect, useState, type FormEvent } from 'react';
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
import { VIEWS, useActors, useRoute, type View } from './ui.js';
import './style.css';
import { Studies } from './study.js';

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
        <div className="eyebrow">STATELESS FIXTURE</div>
        <h2>Try a bounded task</h2>
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
        <div className="eyebrow">INSPECTABLE RESULT</div>
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
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const auth = useSession(persistent === true);
  const { route, go } = useRoute();
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [wsError, setWsError] = useState('');
  async function checkHealth() {
    setHealth('Checking connection…');
    try {
      const data = parse(
        HealthSchema,
        await readResponse(
          await fetch('/api/health', { signal: AbortSignal.timeout(5000) }),
        ),
      );
      setPersistent(data.persistent);
      setHealth(
        `Connected · fixture provider only · ${
          data.persistent
            ? 'records saved in PostgreSQL'
            : data.storage === 'unavailable'
              ? 'database unavailable'
              : 'persistence off'
        }`,
      );
    } catch {
      setPersistent(false);
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
        go({ ws: list[0].id }, true);
      else if (select) go({ ws: select }, true);
    } catch (e) {
      setWsError(message(e));
    }
  }
  useEffect(() => {
    if (auth.session) void loadWorkspaces();
  }, [auth.session]);
  const workspace = workspaces?.find((w) => w.id === route.ws) ?? null;
  const names = useActors(workspace?.id ?? '');
  const focus = (id: string) => go({ id }, true);
  const open = (view: View, id = '', q = '') => go({ view, id, q });

  function body() {
    if (persistent === null) return <p className="small">Connecting…</p>;
    if (!persistent) return <FixtureDemo />;
    if (!auth.session)
      return (
        <SignIn mode={auth.mode} error={auth.error} signIn={auth.signIn} />
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
          <p>
            Create a fixture workspace to explore with synthetic data, or run{' '}
            <code>pnpm cli seed-selection</code> for a filled-in demonstration.
          </p>
        </section>
      );
    const s = auth.session;
    switch (route.view) {
      case 'overview':
        return <Overview session={s} workspace={workspace} open={open} />;
      case 'submit':
        return <Submit session={s} workspace={workspace} open={open} />;
      case 'catalog':
        return (
          <Catalog
            workspace={workspace}
            focus={route.id}
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
            focus={route.id}
            onFocus={focus}
            open={open}
          />
        );
      case 'evidence':
        return (
          <Evidence
            session={s}
            workspace={workspace}
            focus={route.id}
            onFocus={focus}
          />
        );
      case 'decisions':
        return (
          <Oversight
            session={s}
            workspace={workspace}
            focus={route.id}
            names={names}
          />
        );
      case 'runs':
        return (
          <Workflows
            session={s}
            workspace={workspace}
            focus={route.id}
            onFocus={focus}
          />
        );
      case 'budgets':
        return <Budgets session={s} workspace={workspace} />;
      case 'scores':
        return (
          <Scoring workspace={workspace} focus={route.id} onFocus={focus} />
        );
      case 'search':
        return (
          <Search
            workspace={workspace}
            q={route.q}
            setQ={(q) => go({ q }, true)}
            open={open}
          />
        );
      case 'activity':
        return (
          <Activity
            workspace={workspace}
            q={route.q}
            setQ={(q) => go({ q }, true)}
            focus={route.id}
            open={open}
          />
        );
      case 'studies':
        return <Studies workspace={workspace} session={s} />;
      case 'gallery':
        return <Gallery workspace={workspace} open={open} />;
    }
  }
  const signedIn = persistent && auth.session;
  return (
    <div className="shell">
      <a className="skip" href="#content">
        Skip to content
      </a>
      <header>
        <a className="brand" href="#/overview">
          CA<span>Creator Agent</span>
        </a>
        <span className="local">LOCAL STUDIO · T10</span>
      </header>
      <div className="topbar">
        <span role="status" className="small">
          {health}
        </span>
        {signedIn && (
          <span className="small">
            Signed in as {auth.session!.display_name} (
            {auth.session!.method === 'dev_local'
              ? 'local development'
              : 'OIDC'}
            ){' '}
            <button className="text" onClick={() => void auth.signOut()}>
              Sign out
            </button>
          </span>
        )}
        {!persistent && (
          <button className="secondary" onClick={() => void checkHealth()}>
            Check connection
          </button>
        )}
      </div>
      {signedIn && workspaces && (
        <div className="wsbar">
          <label htmlFor="ws" className="inline">
            Workspace
          </label>
          <select
            id="ws"
            value={workspace?.id ?? ''}
            onChange={(e) => go({ ws: e.target.value, id: '' })}
          >
            {workspaces.length === 0 && (
              <option value="">No workspaces yet</option>
            )}
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name} · {w.record_mode === 'fixture' ? 'FIXTURE' : 'real'}
                {w.role !== 'owner' ? ` · ${w.role}` : ''}
              </option>
            ))}
          </select>
          <NewWorkspace
            csrf={auth.session!.csrf_token}
            created={(w) => void loadWorkspaces(w.id)}
          />
        </div>
      )}
      {workspace?.record_mode === 'fixture' && signedIn && (
        <p className="mode-banner" role="note">
          <strong>FIXTURE MODE</strong> Synthetic records and a deterministic
          model adapter. Amounts are simulated units, not money. Nothing here is
          real research or a real recommendation.
        </p>
      )}
      <div className={signedIn && workspace ? 'frame' : 'frame single'}>
        {signedIn && workspace && (
          <nav aria-label="Views">
            <ul>
              {VIEWS.map(([key, label]) => (
                <li key={key}>
                  <a
                    href={`#/${key}?ws=${workspace.id}`}
                    aria-current={route.view === key ? 'page' : undefined}
                    onClick={(e) => {
                      e.preventDefault();
                      open(key);
                    }}
                  >
                    {label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        )}
        <main id="content" tabIndex={-1}>
          {body()}
        </main>
      </div>
      <footer>
        <span>Schema 1.0 · Local control</span>
        <span>Live calls need a provider, pricing, a grant and a budget.</span>
      </footer>
    </div>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
