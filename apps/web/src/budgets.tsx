import { useEffect, useState, type FormEvent } from 'react';
import {
  BrokerCallResultSchema,
  BrokerStatusSchema,
  EnvelopeSchema,
  PricingSnapshotSchema,
  ReservationSchema,
  RunControlSchema,
  WorkspaceSchema,
  z,
  type BrokerCallResult,
  type Envelope,
  type PricingSnapshot,
  type Reservation,
  type RunControl,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';

/** Exact decimal display of nano-USD. Fixture amounts are simulated units, not money. */
function money(nano: string | null, fixture: boolean): string {
  if (nano === null) return '—';
  const v = BigInt(nano);
  const whole = v / 1_000_000_000n;
  const frac = (v % 1_000_000_000n).toString().padStart(9, '0').slice(0, 6);
  return `${fixture ? '' : '$'}${whole}.${frac}${fixture ? ' sim' : ''}`;
}
const share = (part: string, cap: string) =>
  BigInt(cap) === 0n
    ? 0
    : Math.min(100, Number((BigInt(part) * 1000n) / BigInt(cap)) / 10);

function Bar({ e }: { e: Envelope }) {
  const parts: [string, string, string][] = [
    ['incurred', e.incurred, 'Charged'],
    ['reserved', e.reserved, 'Reserved in flight'],
    ['unknown', e.unknown, 'Unknown outcome (held)'],
    ['allocated', e.allocated, 'Moved to child budgets'],
  ];
  return (
    <>
      <div className="meter" aria-hidden="true">
        {parts.map(([k, v]) => (
          <span
            key={k}
            className={`m-${k}`}
            style={{ width: `${share(v, e.cap)}%` }}
          />
        ))}
      </div>
      <dl className="balances">
        {parts.map(([k, v, label]) => (
          <div key={k}>
            <dt>
              <i className={`dot m-${k}`} aria-hidden="true" /> {label}
            </dt>
            <dd>{money(v, e.fixture)}</dd>
          </div>
        ))}
        <div>
          <dt>Available</dt>
          <dd>
            <strong>{money(e.available, e.fixture)}</strong> of{' '}
            {money(e.cap, e.fixture)}
          </dd>
        </div>
        {e.rollup_incurred !== e.incurred && (
          <div>
            <dt>Including child budgets</dt>
            <dd>{money(e.rollup_incurred, e.fixture)} charged</dd>
          </div>
        )}
      </dl>
    </>
  );
}

const STATUS_NOTE: Record<Reservation['status'], string> = {
  denied: 'Not sent',
  in_flight: 'In flight',
  settled: 'Charged',
  released: 'Not charged',
  unknown: 'Unknown — held',
};

/** Budgets, the calls charged against them, and why any call was refused. */
export function Budgets({ session }: { session: SessionInfo }) {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [pricing, setPricing] = useState<PricingSnapshot[]>([]);
  const [runs, setRuns] = useState<RunControl[]>([]);
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  const [prompt, setPrompt] = useState('');
  const [envelopeId, setEnvelopeId] = useState('');
  const [runId, setRunId] = useState('');
  const [last, setLast] = useState<BrokerCallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const current = workspaces.find((w) => w.id === workspace);
  async function load() {
    if (!workspace) return;
    setError('');
    try {
      const [e, r, p, rr] = await Promise.all([
        api(z.array(EnvelopeSchema), `workspaces/${workspace}/budgets`),
        api(z.array(ReservationSchema), `workspaces/${workspace}/reservations`),
        api(z.array(PricingSnapshotSchema), `workspaces/${workspace}/pricing`),
        api(z.array(RunControlSchema), `workspaces/${workspace}/runs`),
      ]);
      setEnvelopes(e);
      setReservations(r);
      setPricing(p);
      setRuns(rr.filter((x) => x.state === 'active'));
      setEnvelopeId((c) =>
        e.some((x) => x.id === c)
          ? c
          : (e.find((x) => x.status === 'active')?.id ?? ''),
      );
      setRunId((c) =>
        rr.some((x) => x.run_id === c)
          ? c
          : (rr.find((x) => x.state === 'active')?.run_id ?? ''),
      );
    } catch (err) {
      setError(message(err));
    }
  }
  useEffect(() => {
    void (async () => {
      try {
        const s = await api(BrokerStatusSchema, 'broker/status');
        setStatus(s.note);
        const list = await api(z.array(WorkspaceSchema), 'workspaces');
        setWorkspaces(list);
        setWorkspace(list[0]?.id ?? '');
      } catch (err) {
        setError(message(err));
      }
    })();
  }, []);
  useEffect(() => {
    void load();
  }, [workspace]);
  async function noCharge(r: Reservation) {
    try {
      await api(
        ReservationSchema,
        `workspaces/${workspace}/reservations/${r.id}/reconcile`,
        {
          csrf: session.csrf_token,
          body: {
            outcome: 'no_charge',
            evidence:
              'Owner checked provider records from the web page: no charge.',
          },
        },
      );
    } catch (err) {
      setError(message(err));
    }
    await load();
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    const price = pricing[0];
    if (!price) return;
    setBusy(true);
    setError('');
    try {
      setLast(
        await api(
          BrokerCallResultSchema,
          `workspaces/${workspace}/runs/${runId}/model-calls`,
          {
            csrf: session.csrf_token,
            body: {
              envelope_id: envelopeId,
              action_type: 'model.generate',
              task_id: null,
              logical_operation_id: crypto.randomUUID(),
              pricing_snapshot_id: price.id,
              data_class: 'synthetic',
              input: [{ role: 'user', text: prompt.trim() }],
              max_output_tokens: 200,
              output_format: 'text',
              tool: null,
              max_attempts: 1,
              timeout_ms: 30000,
              justification: 'Owner test call from the web page.',
            },
            timeoutMs: 40000,
          },
        ),
      );
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
    await load();
  }
  return (
    <section className="panel records" aria-labelledby="budget-title">
      <div className="eyebrow">04 / BUDGETS AND METERED CALLS</div>
      <h2 id="budget-title">Budgets and spending</h2>
      <p>
        Every model or tool call reserves its maximum possible cost before it is
        sent and is charged from the provider's reported usage afterwards. A
        call that could exceed a budget is not sent. Unknown outcomes stay held
        until reconciled; they are never treated as free.
      </p>
      {status && <p className="small">{status}</p>}
      <div className="connection">
        <label htmlFor="bws" className="inline">
          Workspace
        </label>
        <select
          id="bws"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          {workspaces.length === 0 && (
            <option value="">No workspaces yet</option>
          )}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.record_mode === 'fixture' ? 'FIXTURE' : 'real'}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      {current?.record_mode === 'fixture' && (
        <p className="notice">
          Fixture workspace: amounts are simulated units from the deterministic
          adapter, not money.
        </p>
      )}
      <div className="records-grid">
        <div>
          <h3>Budgets</h3>
          {envelopes.length === 0 ? (
            <p className="small">
              No budgets. Without one, no model or tool call can be sent. Create
              one with <code>pnpm cli budget-create</code>.
            </p>
          ) : (
            envelopes.map((e) => (
              <article key={e.id} className="decision">
                <div className="decision-head">
                  <span className="kind">{e.kind}</span>
                  <strong>{e.name}</strong>
                  <span className={`badge state-${e.status}`}>{e.status}</span>
                </div>
                <Bar e={e} />
                <p className="small">
                  {e.in_flight} of {e.max_in_flight} calls in flight
                  {e.run_id ? ` · run ${e.run_id.slice(0, 8)}` : ''}
                  {e.ends_at
                    ? ` · ${when(e.starts_at!)} – ${when(e.ends_at)}`
                    : ''}
                </p>
              </article>
            ))
          )}
          {current?.record_mode === 'fixture' &&
            envelopes.length > 0 &&
            runs.length > 0 &&
            pricing.length > 0 && (
              <form onSubmit={submit}>
                <h3>Try a fixture call</h3>
                <label htmlFor="bprompt">Prompt</label>
                <input
                  id="bprompt"
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                />
                <label htmlFor="benv">Budget</label>
                <select
                  id="benv"
                  value={envelopeId}
                  onChange={(e) => setEnvelopeId(e.target.value)}
                >
                  {envelopes.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.name} · {e.status}
                    </option>
                  ))}
                </select>
                <label htmlFor="brun">Run</label>
                <select
                  id="brun"
                  value={runId}
                  onChange={(e) => setRunId(e.target.value)}
                >
                  {runs.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {words(r.autonomy_mode)} · {r.run_id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                <button
                  className="primary"
                  disabled={busy || !prompt.trim() || !envelopeId || !runId}
                  type="submit"
                >
                  Reserve and send <span aria-hidden="true">→</span>
                </button>
                {last && (
                  <p className="small" role="status">
                    <strong>{words(last.status)}</strong> (
                    {words(last.reason_code)}): {last.explanation}
                    {last.output?.text ? ` Output: “${last.output.text}”` : ''}
                  </p>
                )}
              </form>
            )}
        </div>
        <div>
          <h3>Recent calls</h3>
          {reservations.length === 0 ? (
            <p className="small">No calls yet.</p>
          ) : (
            <ul>
              {reservations.slice(0, 40).map((r) => (
                <li key={r.id}>
                  <span className={`kind res-${r.status}`}>
                    {STATUS_NOTE[r.status]}
                  </span>{' '}
                  {words(r.action_type)} · {r.provider}/{r.model_id} · attempt{' '}
                  {r.attempt}
                  <br />
                  <small>
                    {words(r.reason_code)} · reserved{' '}
                    {money(r.reserved, r.fixture)} · charged{' '}
                    {money(r.incurred, r.fixture)}
                    {r.usage
                      ? ` · ${r.usage.uncached_input_tokens + r.usage.cached_input_tokens + r.usage.cache_write_tokens} in / ${r.usage.output_tokens} out tokens`
                      : ''}{' '}
                    · {when(r.created_at)}
                  </small>
                  <br />
                  <small>{r.explanation}</small>
                  {r.status === 'unknown' && (
                    <>
                      {' '}
                      <button className="text" onClick={() => void noCharge(r)}>
                        Confirm no charge
                      </button>{' '}
                      <small>
                        (for a charge, use pnpm cli reconcile with the
                        provider's usage)
                      </small>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
