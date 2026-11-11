import { useEffect, useState, type FormEvent } from 'react';
import {
  BrokerCallResultSchema,
  BrokerStatusSchema,
  EnvelopeSchema,
  PricingSnapshotSchema,
  ReservationSchema,
  RunControlSchema,
  z,
  type BrokerCallResult,
  type Envelope,
  type PricingSnapshot,
  type Reservation,
  type RunControl,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, ApiError, message, when, words } from './oversight.js';
import { newestFirst } from './versions.js';
import { ShowOlder, useOlder } from './older.js';
import { runLabel } from './labels.js';
import { runNames } from './ui.js';
// The same file `pnpm cli pricing-add` takes; bundled so a fixture studio needs no CLI.
import fixturePricing from '../../../config/pricing/fixture-model-v1.json';
import { useOnShow } from './page-active.js';
import { DOCUMENTED_PRICING } from './pricing-bundle.js';
import {
  longContextText,
  noChargeEvidence,
  perMillion,
  samePricing,
} from './pricing-fields.js';
import { RecordCharge } from './charge.js';
import {
  budgetCloseBlocker,
  REASON_MAX,
  STALE_CODES,
  STALE_NOTE,
} from './owner-actions.js';
import { ReasonForm } from './reason-form.js';

/**
 * Exact decimal display of nano-USD: every non-zero digit is kept, trailing zeros past the
 * cents are dropped. Fixture amounts are simulated units, not money.
 */
export function money(nano: string | null, fixture: boolean): string {
  if (nano === null) return '—';
  const v = BigInt(nano);
  const sign = v < 0n ? '-' : '';
  const abs = v < 0n ? -v : v;
  const whole = abs / 1_000_000_000n;
  const frac = (abs % 1_000_000_000n)
    .toString()
    .padStart(9, '0')
    .replace(/0+$/, '')
    .padEnd(2, '0');
  return `${sign}${fixture ? '' : '$'}${whole}.${frac}${fixture ? ' sim' : ''}`;
}
/**
 * Stored settlement notes ("Charged 55770000 of 428537500 reserved.") repeat the amounts
 * already shown above them, in raw nano units; the list leaves them out.
 */
const RAW_AMOUNT_NOTE =
  /^(Charged|Reserved) \d+ (of \d+ reserved|for attempt \d+)\.$/;
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

// ADR-0082: what the fund form starts from when no budget is active yet.
const BUDGET_DEFAULT_NAME = 'Studio budget';
const FIXTURE_DEFAULT_CAP = '100';
const REAL_DEFAULT_CAP = '0.00';

/** Budgets, the calls charged against them, and why any call was refused. */
export function Budgets({
  session,
  workspace: current,
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const workspace = current.id;
  const [fundName, setFundName] = useState('');
  const [fundCap, setFundCap] = useState('');
  // The cap the form filled in itself, so the default note goes once the person types.
  const [defaultCap, setDefaultCap] = useState('');
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  // Budgets past the newest 200 come one page at a time (audit L-9).
  const shownEnvelopes = useOlder(
    envelopes,
    EnvelopeSchema,
    `workspaces/${workspace}/budgets`,
    200,
  );
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [pricing, setPricing] = useState<PricingSnapshot[]>([]);
  const [runs, setRuns] = useState<RunControl[]>([]);
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const [status, setStatus] = useState('');
  const [error, setError] = useState('');
  // "Confirm no charge" asks where the owner checked first (review of PR #116, L-2).
  const [noChargeFor, setNoChargeFor] = useState('');
  const [noChargeWhere, setNoChargeWhere] = useState('');
  const [noChargeError, setNoChargeError] = useState('');
  const [noChargeBusy, setNoChargeBusy] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [envelopeId, setEnvelopeId] = useState('');
  const [runId, setRunId] = useState('');
  const [last, setLast] = useState<BrokerCallResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [charging, setCharging] = useState('');
  // The budget whose "Close this budget…" form is open (was `pnpm cli budget-close` only).
  const [closing, setClosing] = useState('');
  async function load() {
    if (!workspace) return;
    setError('');
    try {
      const [e0, r, p, rr0, n] = await Promise.all([
        api(z.array(EnvelopeSchema), `workspaces/${workspace}/budgets`),
        api(z.array(ReservationSchema), `workspaces/${workspace}/reservations`),
        api(z.array(PricingSnapshotSchema), `workspaces/${workspace}/pricing`),
        api(z.array(RunControlSchema), `workspaces/${workspace}/runs`),
        runNames(`workspaces/${workspace}`),
      ]);
      // Newest first, so the pickers open on the latest budget and run.
      const e = newestFirst(e0);
      const rr = newestFirst(rr0);
      setEnvelopes(e);
      // ADR-0082 (P19): with no active budget yet, the form starts from a visible default:
      // simulated units in a fixture workspace, and $0 (the plan route spends nothing) in a
      // real one. A default never raises a cap above zero real money.
      if (!e.some((x) => x.status === 'active')) {
        setFundName((v) => v || BUDGET_DEFAULT_NAME);
        const cap =
          current.record_mode === 'fixture'
            ? FIXTURE_DEFAULT_CAP
            : REAL_DEFAULT_CAP;
        setFundCap((v) => v || cap);
        // Shown only while the cap is still this value and the person has not typed.
        setDefaultCap(cap);
      }
      setReservations(r);
      setPricing(p);
      setRuns(rr.filter((x) => x.state === 'active'));
      setNames(n);
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
      } catch (err) {
        setError(message(err));
      }
    })();
  }, []);
  useEffect(() => {
    void load();
  }, [workspace]);
  useOnShow(() => void load());
  async function noCharge(r: Reservation) {
    const checked = noChargeEvidence(noChargeWhere);
    if ('error' in checked) {
      setNoChargeError(checked.error);
      return;
    }
    // Full audit 2026-11-02 (PR #116 N-6): one request at a time, as the charge form does.
    if (noChargeBusy) return;
    setNoChargeBusy(true);
    try {
      await api(
        ReservationSchema,
        `workspaces/${workspace}/reservations/${r.id}/reconcile`,
        {
          csrf: session.csrf_token,
          body: { outcome: 'no_charge', evidence: checked.evidence },
        },
      );
      setNoChargeFor('');
      setNoChargeWhere('');
      setNoChargeError('');
    } catch (err) {
      setNoChargeError(message(err));
    } finally {
      setNoChargeBusy(false);
    }
    await load();
  }
  /** Funds a new top-level budget. A cap is a whole number with up to six decimals. */
  async function fund(e: FormEvent) {
    e.preventDefault();
    const m = /^(\d{1,12})(?:\.(\d{1,6}))?$/.exec(fundCap.trim());
    if (!m) {
      setError('Enter the cap as a number with up to six decimals.');
      return;
    }
    const nano = (
      BigInt(m[1]!) * 1_000_000_000n +
      BigInt((m[2] ?? '').padEnd(9, '0'))
    ).toString();
    setBusy(true);
    setError('');
    try {
      const created = await api(
        EnvelopeSchema,
        `workspaces/${workspace}/budgets`,
        {
          csrf: session.csrf_token,
          body: {
            parent_id: null,
            kind: 'global',
            run_id: null,
            name: fundName.trim(),
            cap_nano_usd: nano,
            starts_at: null,
            ends_at: null,
            max_in_flight: 4,
          },
        },
      );
      setFundName('');
      setFundCap('');
      setEnvelopeId(created.id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
    await load();
  }
  /** Adds the bundled fixture pricing (simulated units); the server refuses it elsewhere. */
  /**
   * Adds the bundled fixture pricing (simulated units) or a bundled documented price; the
   * server refuses fixture pricing in a real workspace and documented pricing in a fixture one.
   */
  async function addPricing(body: unknown) {
    setBusy(true);
    setError('');
    try {
      await api(PricingSnapshotSchema, `workspaces/${workspace}/pricing`, {
        csrf: session.csrf_token,
        body,
      });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
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
      <h2 id="budget-title">Budgets and pricing</h2>
      <p>
        Every model or tool call reserves its maximum possible cost before it is
        sent and is charged from the provider's reported usage afterwards. A
        call that could exceed a budget is not sent. Unknown outcomes stay held
        until reconciled; they are never treated as free.
      </p>
      {status && <p className="small">{status}</p>}
      <div className="connection">
        <button className="secondary" onClick={() => void load()}>
          Refresh
        </button>
      </div>
      <div className="records-grid">
        <div>
          <h3>Budgets</h3>
          {envelopes.length === 0 ? (
            <p className="small">
              No budgets. Without one, no model or tool call can be sent.
            </p>
          ) : (
            shownEnvelopes.items.map((e) => (
              <article key={e.id} className="decision">
                <div className="decision-head">
                  <span className="kind">{e.kind}</span>
                  <strong>{e.name}</strong>
                  <span className={`badge state-${e.status}`}>{e.status}</span>
                </div>
                <Bar e={e} />
                <p className="small">
                  {e.in_flight} in flight now · at most {e.max_in_flight} at
                  once
                  {e.run_id ? ` · run ${e.run_id.slice(0, 8)}` : ''}
                  {e.ends_at
                    ? ` · ${when(e.starts_at!)} – ${when(e.ends_at)}`
                    : ''}
                  {e.closed_at ? ` · closed ${when(e.closed_at)}` : ''}
                </p>
                {/* Closing is owner-only on the server, so only the owner is offered it. */}
                {current.role === 'owner' &&
                  e.status !== 'closed' &&
                  // PR #129 re-review N-5: a blocker found on the reload (a call began after
                  // the page loaded) replaces an open form, so it does not invite a retry
                  // that is refused the same way.
                  (budgetCloseBlocker(e) ? (
                    <p className="small">{budgetCloseBlocker(e)}</p>
                  ) : closing === e.id ? (
                    <ReasonForm
                      id={`close-${e.id}`}
                      label="Why close this budget"
                      placeholder="e.g. the pilot is finished"
                      note={`No new call can draw on a closed budget. ${
                        e.parent_id
                          ? 'What it has not spent goes back to its parent budget.'
                          : 'What it has not spent is no longer available.'
                      } This can't be undone; fund a new budget if you need one later. The studio records that you gave a reason, not its words.`}
                      confirm="Close this budget"
                      busyLabel="Closing…"
                      keep="Keep it open"
                      max={REASON_MAX.budget}
                      onCancel={() => setClosing('')}
                      onConfirm={async (reason) => {
                        try {
                          await api(
                            EnvelopeSchema,
                            `workspaces/${workspace}/budgets/${e.id}/close`,
                            {
                              csrf: session.csrf_token,
                              body: { expected_version: e.version, reason },
                            },
                          );
                        } catch (err) {
                          // PR #129 review L-3: read the budget again so a retry sends its
                          // current version instead of failing the same way every time.
                          if (
                            err instanceof ApiError &&
                            STALE_CODES.includes(err.code)
                          ) {
                            await load();
                            return message(err) + STALE_NOTE;
                          }
                          return message(err);
                        }
                        setClosing('');
                        await load();
                        return null;
                      }}
                    />
                  ) : (
                    <button className="text" onClick={() => setClosing(e.id)}>
                      Close this budget…
                    </button>
                  ))}
              </article>
            ))
          )}
          <ShowOlder list={shownEnvelopes} what="budgets" />
          {current.role !== 'viewer' && (
            <form onSubmit={(e) => void fund(e)}>
              <h3>Fund a budget</h3>
              <label htmlFor="fname">Name</label>
              <input
                id="fname"
                required
                maxLength={200}
                value={fundName}
                onChange={(e) => setFundName(e.target.value)}
              />
              <label htmlFor="fcap">
                Cap{' '}
                {current.record_mode === 'fixture'
                  ? '(simulated units)'
                  : '(US dollars)'}
              </label>
              <input
                id="fcap"
                required
                inputMode="decimal"
                placeholder="e.g. 5.00"
                value={fundCap}
                onChange={(e) => {
                  setFundCap(e.target.value);
                  setDefaultCap('');
                }}
              />
              {defaultCap !== '' && fundCap === defaultCap && (
                <p className="small">
                  {current.record_mode === 'fixture'
                    ? `Studio default: ${FIXTURE_DEFAULT_CAP} simulated units, enough for a few fixture discoveries and builds. No money is involved.`
                    : 'Studio default: $0. Discoveries and builds on a connected plan cost nothing and still name a budget. Raise it only for metered API calls; the overall spending ceiling in Settings still applies.'}
                </p>
              )}
              <button
                className="secondary"
                type="submit"
                disabled={busy || !fundName.trim() || !fundCap.trim()}
              >
                Fund budget
              </button>
            </form>
          )}
          <h3>Pricing snapshots</h3>
          {pricing.length === 0 ? (
            <p className="small">
              None yet. A model call or discovery run needs one to reserve its
              maximum cost.
            </p>
          ) : (
            <ul className="small">
              {pricing.map((p) => (
                <li key={p.id}>
                  {p.body.provider}/{p.body.model_id} · {p.body.basis}
                  {p.body.basis === 'documented' &&
                    ` · prices as of ${p.body.retrieved_at.slice(0, 10)}`}{' '}
                  · added {when(p.created_at)}
                </li>
              ))}
            </ul>
          )}
          {current.role === 'owner' &&
            (current.record_mode === 'fixture' ? (
              !pricing.some(
                (p) => p.body.model_id === fixturePricing.model_id,
              ) && (
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() => void addPricing(fixturePricing)}
                >
                  Add fixture pricing (simulated units)
                </button>
              )
            ) : (
              <DocumentedPricing
                pricing={pricing}
                busy={busy}
                add={(body) => void addPricing(body)}
              />
            ))}
          {current.record_mode === 'fixture' &&
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
                      {runLabel(r, names)}
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
                  {!RAW_AMOUNT_NOTE.test(r.explanation) && (
                    <>
                      <br />
                      <small>{r.explanation}</small>
                    </>
                  )}
                  {r.reconcile_evidence && (
                    <>
                      <br />
                      <small className="reconcile-evidence">
                        Where you checked: {r.reconcile_evidence}
                      </small>
                    </>
                  )}
                  {r.status === 'unknown' && (
                    <>
                      {' '}
                      {/* PR #116 N-5: reconciling is owner-only on the server, so only the
                          owner is offered it, like "Record a charge…". */}
                      {current.role === 'owner' &&
                        charging !== r.id &&
                        noChargeFor !== r.id && (
                          <button
                            className="text"
                            onClick={() => {
                              setCharging('');
                              setNoChargeFor(r.id);
                              setNoChargeWhere('');
                              setNoChargeError('');
                            }}
                          >
                            Confirm no charge…
                          </button>
                        )}{' '}
                      {noChargeFor === r.id && (
                        <form
                          className="inline-form no-charge"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void noCharge(r);
                          }}
                        >
                          <label htmlFor={`nc-${r.id}`}>
                            Where you checked that there was no charge
                          </label>
                          <input
                            id={`nc-${r.id}`}
                            value={noChargeWhere}
                            maxLength={1150}
                            placeholder="e.g. provider usage page for Nov 2, no request at that time"
                            aria-invalid={noChargeError ? true : undefined}
                            aria-describedby={
                              noChargeError ? `nc-${r.id}-error` : undefined
                            }
                            onChange={(e) => {
                              setNoChargeWhere(e.target.value);
                              setNoChargeError('');
                            }}
                          />
                          {noChargeError && (
                            <p
                              id={`nc-${r.id}-error`}
                              className="error"
                              role="alert"
                            >
                              {noChargeError}
                            </p>
                          )}
                          <p className="small">
                            This releases the hold and closes the call for good.
                            It can't be undone.
                          </p>
                          <button type="submit" disabled={noChargeBusy}>
                            {noChargeBusy ? 'Confirming…' : 'Confirm no charge'}
                          </button>{' '}
                          <button
                            type="button"
                            className="secondary"
                            disabled={noChargeBusy}
                            onClick={() => setNoChargeFor('')}
                          >
                            Keep it open
                          </button>
                        </form>
                      )}
                      {current.role === 'owner' &&
                        charging !== r.id &&
                        noChargeFor !== r.id && (
                          <button
                            className="text"
                            onClick={() => {
                              setNoChargeFor('');
                              setCharging(r.id);
                            }}
                          >
                            Record a charge…
                          </button>
                        )}
                      {charging === r.id && (
                        <RecordCharge
                          base={`workspaces/${workspace}`}
                          session={session}
                          reservation={r}
                          pricing={pricing.find(
                            (p) => p.id === r.pricing_snapshot_id,
                          )}
                          done={() => {
                            setCharging('');
                            void load();
                          }}
                          cancel={() => setCharging('')}
                        />
                      )}
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

/**
 * The documented prices bundled with the studio that this workspace doesn't hold yet. Each
 * is the dated copy of the provider's published page in config/pricing: the billed price is
 * unverified until a real charge is reconciled against it.
 */
function DocumentedPricing({
  pricing,
  busy,
  add,
}: {
  pricing: PricingSnapshot[];
  busy: boolean;
  add: (body: unknown) => void;
}) {
  const missing = DOCUMENTED_PRICING.filter(
    (d) => !pricing.some((p) => samePricing(p.body, d.body)),
  );
  if (missing.length === 0)
    return (
      <p className="small">
        Every documented price bundled with the studio is added. Newer prices
        come with a studio update.
      </p>
    );
  return (
    <ul className="small pricing-offers">
      {missing.map((d) => (
        <li key={d.file}>
          <strong>{d.label}</strong>: {perMillion(d.body.rates.input)} input,{' '}
          {perMillion(d.body.rates.cached_input)} cached input,{' '}
          {perMillion(d.body.rates.cache_write)} cache writes,{' '}
          {perMillion(d.body.rates.output)} output per million tokens.{' '}
          {longContextText(d.body.long_context)} From{' '}
          <a href={d.body.source_url} target="_blank" rel="noreferrer">
            the provider's model page
          </a>{' '}
          as of {d.body.retrieved_at.slice(0, 10)}. The billed price is not
          verified.{' '}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => add(d.body)}
          >
            Add this pricing
          </button>
        </li>
      ))}
    </ul>
  );
}
