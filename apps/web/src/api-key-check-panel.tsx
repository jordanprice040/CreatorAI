import { useEffect, useState } from 'react';
import {
  z,
  BrokerCallResultSchema,
  BrokerStatusSchema,
  EnvelopeSchema,
  PricingSnapshotSchema,
  ReservationSchema,
  type Envelope,
  type PricingSnapshot,
  type Reservation,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { money } from './budgets.js';
import { runNames } from './ui.js';
import { DOCUMENTED_PRICING } from './pricing-bundle.js';
import {
  CHECK_BUDGET_NANO,
  CHECK_MAX_OUTPUT_TOKENS,
  CHECK_PROMPT,
  checkBlockers,
  pickFunding,
  pickPricing,
  recentChecks,
  runCheck,
  type CheckCaller,
  type CheckOutcome,
} from './api-key-check.js';

/**
 * P22: "Test connection" for the metered OpenAI API key route. Plan routes keep their own
 * one-approved-call check below. Everything here goes through the server's normal routes:
 * a run, one grant, a run budget lent by a funded budget, and one broker call, so the
 * ceiling, spend limits and admission decide exactly as they would for any paid call.
 */
export function ApiKeyCheck({
  workspace,
  session,
}: {
  workspace: Workspace;
  session: SessionInfo | null;
}) {
  const base = `workspaces/${workspace.id}`;
  const owner = workspace.role === 'owner';
  const fixture = workspace.record_mode === 'fixture';
  const [live, setLive] = useState<'not_configured' | 'configured_unverified'>(
    'not_configured',
  );
  const [modelId, setModelId] = useState<string | null>(null);
  const [pricing, setPricing] = useState<PricingSnapshot[]>([]);
  const [envelopes, setEnvelopes] = useState<Envelope[]>([]);
  const [recent, setRecent] = useState<Reservation[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState('');
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState<
    (CheckOutcome & { at: string }) | null
  >(null);

  async function load() {
    const status = await api(BrokerStatusSchema, 'broker/status');
    setLive(status.live.openai);
    setModelId(status.live_model_id);
    if (fixture || !owner) {
      setLoaded(true);
      return;
    }
    const [p, e, r, names] = await Promise.all([
      api(z.array(PricingSnapshotSchema), `${base}/pricing`),
      api(z.array(EnvelopeSchema), `${base}/budgets`),
      api(z.array(ReservationSchema), `${base}/reservations`),
      runNames(base),
    ]);
    setPricing(p);
    setEnvelopes(e);
    setRecent(recentChecks(r, names));
    setLoaded(true);
  }
  useEffect(() => {
    void load().catch((e) => setError(message(e)));
  }, [workspace.id]);

  const price = pickPricing(pricing, modelId);
  const funding = pickFunding(envelopes, Date.now());
  const blockers = checkBlockers({
    owner,
    fixture,
    live,
    modelId,
    pricing: price,
    funding,
  });
  const bundled = DOCUMENTED_PRICING.find((d) => d.body.model_id === modelId);

  async function addPrice() {
    if (!bundled || !session) return;
    setBusy(true);
    setError('');
    try {
      await api(PricingSnapshotSchema, `${base}/pricing`, {
        csrf: session.csrf_token,
        body: bundled.body,
      });
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }

  async function run() {
    if (!session || !price || !funding) return;
    const csrf = session.csrf_token;
    setBusy(true);
    setConfirming(false);
    setError('');
    setOutcome(null);
    // Every step goes through the server's own routes; the server parses each answer, and
    // `api` with z.unknown() keeps ApiError (a server answer) apart from a timeout.
    const caller: CheckCaller = {
      post: (path, body, timeoutMs) =>
        // The call's result is parsed in full before it is described.
        api(
          path.endsWith('/model-calls') ? BrokerCallResultSchema : z.unknown(),
          path,
          {
            csrf,
            body,
            ...(timeoutMs ? { timeoutMs } : {}),
          },
        ),
      get: (path) => api(z.unknown(), path),
    };
    const stamp = new Date().toLocaleString(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short',
    });
    const r = await runCheck(
      caller,
      base,
      {
        pricingId: price.id,
        fundingId: funding.id,
        operationId: crypto.randomUUID(),
      },
      stamp,
      Date.now,
      setStep,
    );
    if (r.outcome) setOutcome({ ...r.outcome, at: new Date().toISOString() });
    setError(
      [
        r.error,
        r.cleanup.budget === 'kept_open'
          ? 'The check’s run budget stayed open (its call is unsettled or the close was refused); see Monitor › Budgets.'
          : null,
        r.cleanup.grant === 'not_revoked'
          ? 'The check’s grant could not be revoked; it ends by itself within 30 minutes, or revoke it under Decisions.'
          : null,
      ]
        .filter(Boolean)
        .join(' '),
    );
    setStep('');
    setBusy(false);
    await load().catch((e) => setError(message(e)));
  }

  return (
    <div className="api-key-check">
      <p>
        OpenAI API key (pay per use):{' '}
        {live === 'configured_unverified'
          ? `the API process has a key for ${modelId ?? 'a model'}.`
          : 'no key on the API process, so real workspaces never use this route.'}{' '}
        A key is not permission to spend: every call still needs a grant, a
        funded budget and room under your overall ceiling. This screen never
        changes the key.
      </p>
      {owner && !fixture && live === 'configured_unverified' && (
        <fieldset>
          <legend>Test connection</legend>
          <p className="small">
            Sends one request (“{CHECK_PROMPT}”, at most{' '}
            {CHECK_MAX_OUTPUT_TOKENS} output tokens) under its own run, with a
            model grant for this one check and a{' '}
            {money(CHECK_BUDGET_NANO, false)} run budget lent by your newest
            funded budget. The usual cost is a fraction of a cent, charged to
            your OpenAI account and counted inside your overall ceiling.
            Afterwards the unspent amount goes back, the grant is revoked and
            the run is closed.
          </p>
          {blockers.length > 0 && (
            <ul className="small">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {!price && bundled && (
            <button
              className="secondary"
              disabled={busy || !session}
              onClick={() => void addPrice()}
            >
              Add the documented price for {bundled.label}
            </button>
          )}
          {!confirming ? (
            <button
              disabled={busy || !session || !loaded || blockers.length > 0}
              onClick={() => setConfirming(true)}
            >
              Test connection…
            </button>
          ) : (
            <div className="actions">
              <span className="small">
                Send one paid request to {modelId} now, drawing on “
                {funding?.name}”?
              </span>
              <button disabled={busy} onClick={() => void run()}>
                Send one paid request
              </button>
              <button
                className="secondary"
                onClick={() => setConfirming(false)}
              >
                Not now
              </button>
            </div>
          )}
          {step && <p role="status">{step}</p>}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {outcome && (
            <div role="status">
              <p>
                <strong>{outcome.headline}</strong>
              </p>
              <p className="small">
                {when(outcome.at)} · charged {money(outcome.incurred, false)} (
                {money(outcome.reserved, false)} was reserved) · from the
                documented price, not an invoice.
                {outcome.reply !== null && outcome.reply.trim()
                  ? ` Reply: “${outcome.reply.trim().slice(0, 200)}”.`
                  : ''}
              </p>
            </div>
          )}
          {recent.length > 0 && (
            <>
              <h4>Earlier checks</h4>
              <ul className="small">
                {recent.map((r) => (
                  <li key={r.id}>
                    {when(r.created_at)} · {r.provider}/{r.model_id} ·{' '}
                    {r.status}
                    {r.reason_code !== r.status ? ` (${r.reason_code})` : ''} ·
                    charged {money(r.incurred, false)}
                  </li>
                ))}
              </ul>
            </>
          )}
        </fieldset>
      )}
    </div>
  );
}
