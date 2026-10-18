import { useEffect, useState, type FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  FixtureResponseSchema,
  HealthSchema,
  parse,
  type FixtureResponse,
} from '@creator/contracts';
import { Records } from './records.js';
import { Oversight, SignIn, useSession } from './oversight.js';
import { Budgets } from './budgets.js';
import { Workflows } from './workflows.js';
import { Evidence } from './evidence.js';
import './style.css';

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
function App() {
  const [health, setHealth] = useState('Checking connection…');
  const [persistent, setPersistent] = useState(false);
  const [goal, setGoal] = useState(
    'Compare a shared checklist with custom software',
  );
  const [outcome, setOutcome] = useState('use_existing');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<FixtureResponse | null>(null);
  const [error, setError] = useState('');
  const auth = useSession(persistent);
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
        `Connected · fixture provider · ${
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
    <div className="shell">
      <header>
        <a className="brand" href="/">
          CA<span>Creator Agent</span>
        </a>
        <span className="local">LOCAL STUDIO · T03</span>
      </header>
      <main>
        <div className="eyebrow">THE STARTING POINT</div>
        <h1>
          A clear record.
          <br />A bounded next step.
        </h1>
        <p className="intro">
          Explore how a task becomes a structured outcome, including decisions
          that do not require new software.
        </p>
        <aside className="notice">
          <strong>Fixture demonstration</strong>
          <span>
            Deterministic synthetic responses. No AI calls, research or
            spending. Fixture runs below are not saved.
          </span>
        </aside>
        <div className="connection">
          <span role="status">{health}</span>
          <button className="secondary" onClick={() => void checkHealth()}>
            Check connection
          </button>
        </div>
        <div className="workspace">
          <section className="panel">
            <div className="eyebrow">01 / ASSIGNMENT</div>
            <h2>Try a bounded task</h2>
            <p>
              Choose the simulated disposition. This tests the local application
              path, not the quality of a recommendation.
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
            <div className="eyebrow">02 / INSPECTABLE RESULT</div>
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
                    <dt>Discovery method</dt>
                    <dd>{result.execution.discovery_method}</dd>
                  </div>
                  <div>
                    <dt>Provider cost</dt>
                    <dd>0 nano-USD · fixture only</dd>
                  </div>
                </dl>
                <p className="small">
                  Stage labels are simulated. No sources were retrieved, no
                  product was built, and no study was run. Reloading clears this
                  result.
                </p>
                <details>
                  <summary>Inspect contract and version bindings</summary>
                  <pre>{JSON.stringify(result, null, 2)}</pre>
                </details>
              </>
            ) : (
              <div className="empty">
                <span aria-hidden="true">◎</span>
                <p>
                  One task. Explicit limits.
                  <br />
                  An outcome you can inspect.
                </p>
                <small>Nothing runs until you submit.</small>
              </div>
            )}
          </section>
        </div>
        {persistent && !auth.session && (
          <SignIn mode={auth.mode} error={auth.error} signIn={auth.signIn} />
        )}
        {auth.session && (
          <Oversight session={auth.session} signOut={auth.signOut} />
        )}
        {auth.session && <Budgets session={auth.session} />}
        {auth.session && <Workflows session={auth.session} />}
        {auth.session && <Evidence session={auth.session} />}
        {(!persistent || auth.session) && <Records persistent={persistent} />}
        <footer>
          <span>Schema 1.0 · Local control</span>
          <span>
            Live calls need a provider, pricing, a grant and a budget.
          </span>
        </footer>
      </main>
    </div>
  );
}
const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');
createRoot(root).render(<App />);
