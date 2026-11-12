import { useState, type FormEvent, type ReactNode } from 'react';
import {
  CheckoutSchema,
  EntitlementSchema,
  OfferSchema,
  TestCheckoutStateSchema,
  z,
  type Checkout as CheckoutRow,
  type Entitlement,
  type Offer,
  type PaymentConnection,
  type SessionInfo,
  type TestBuyerAction,
  type TestCheckoutState,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { money } from './budgets.js';
import { Empty, Status, shortId, useLoad } from './ui.js';

/** What each processor step means to the owner. */
const ACTION_LABEL: Record<TestBuyerAction, string> = {
  pay: 'Pay',
  settle: 'Settle the funds',
  refund: 'Refund in full',
  dispute: 'Buyer disputes the charge',
  dispute_won: 'You win the dispute',
  dispute_lost: 'You lose the dispute',
};
const EVENT_LABEL: Record<string, string> = {
  'payment_intent.succeeded': 'Payment succeeded',
  'charge.updated': 'Funds settled',
  'refund.created': 'Refund issued',
  'charge.dispute.created': 'Dispute opened',
  'charge.dispute.closed': 'Dispute closed',
};
const SIGNATURE_LABEL: Record<string, string> = {
  valid: 'signed correctly',
  wrong_secret: 'wrong secret',
  expired: 'old timestamp',
};
/** The server's answer to a delivery, in the owner's terms. */
function deliveryText(
  d: TestCheckoutState['events'][number]['deliveries'][number],
) {
  const how = SIGNATURE_LABEL[d.signature] ?? d.signature;
  if (d.outcome === 'in_flight') return `${how}: delivering…`;
  if (d.outcome === 'applied') return `${how}: applied`;
  if (d.outcome === 'duplicate') return `${how}: already applied, ignored`;
  if (d.http_status === 400 && d.signature !== 'valid')
    return `${how}: refused (${words(d.outcome)}), nothing recorded`;
  return `${how}: ${words(d.outcome)} (${d.http_status})`;
}
const ACCESS_TEXT: Record<string, string> = {
  active: 'Has access',
  suspended: 'Access paused while a dispute is open',
  revoked: 'Access revoked for good',
};
/** Only Stripe's own hosted checkout is shown as a link; anything else stays plain text. */
export const stripeCheckoutUrl = (url: string | null) =>
  url && /^https:\/\/checkout\.stripe\.com\//.test(url) ? url : null;
/** Where checkout sends the buyer back: the studio's inert return page. */
function returnUrl() {
  const origin = /^https?:$/.test(window.location.protocol)
    ? window.location.origin
    : 'http://127.0.0.1';
  return `${origin}/api/payments/return`;
}
const newBuyerRef = () =>
  `test-buyer-${Math.random().toString(16).slice(2, 8)}`;

/**
 * Checkout in test mode (runbook step 3, docs/PAYMENTS.md). The owner opens a checkout for an
 * offer and plays the buyer. With the simulated processor, a test buyer pays, and the owner
 * delivers the signed events the processor would send, in any order, twice, or spoiled, to
 * see that only a correctly signed delivery read back from the processor changes access.
 * Stripe test mode sends the buyer to Stripe's test page instead. Live checkout isn't built.
 */
export function Checkout({
  session,
  workspace,
  offers,
  connections,
  entitlements,
  replaced,
  changed,
}: {
  session: SessionInfo;
  workspace: Workspace;
  offers: Offer[];
  connections: PaymentConnection[];
  entitlements: Entitlement[];
  /** Offers whose release a newer build or spec version replaced; they can't be bought. */
  replaced: ReadonlySet<string>;
  changed: () => void;
}) {
  const owner = workspace.role === 'owner';
  const base = `workspaces/${workspace.id}`;
  const fixture = workspace.record_mode === 'fixture';
  const list = useLoad(
    async () =>
      owner ? api(z.array(CheckoutSchema), `${base}/payment-checkouts`) : [],
    [workspace.id, owner],
  );
  const [picked, setPicked] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const active = offers.filter(
    (o) => o.status === 'active' && !replaced.has(o.id),
  );
  const offerById = new Map(offers.map((o) => [o.id, o]));
  const connById = new Map(connections.map((c) => [c.id, c]));
  const checkouts = list.data ?? [];
  const selected = checkouts.find((c) => c.id === picked) ?? null;
  // PR #125 review L-2: the open checkout's offer and its buyer's access are read by id, so a
  // checkout for an offer past the loaded pages still shows them. Read again whenever the page's
  // lists are (`entitlements` changes on each reload). Newest matching access wins.
  const own = useLoad(async () => {
    if (!selected) return null;
    const [offer, access] = await Promise.all([
      offerById.get(selected.offer_id) ??
        api(OfferSchema, `${base}/payment-offers/${selected.offer_id}`),
      api(
        z.array(EntitlementSchema),
        `${base}/entitlements?${new URLSearchParams({
          offer_id: selected.offer_id,
          customer_ref: selected.customer_ref,
          limit: '1',
        }).toString()}`,
      ),
    ]);
    return { id: selected.id, offer, access: access[0] ?? null };
  }, [selected?.id, offers, entitlements]);
  // Only an answer for the checkout now open counts, not one still shown from the last pick.
  const ownFor = own.data && own.data.id === selected?.id ? own.data : null;

  if (!owner)
    return (
      <>
        <h3>Checkout (test mode)</h3>
        <p className="small">
          Only the workspace owner can open test checkouts.
        </p>
      </>
    );
  return (
    <>
      <h3>Checkout (test mode)</h3>
      <p className="small">
        Try an offer from the buyer&apos;s side. With the simulated processor
        you play the buyer here, then deliver the processor&apos;s signed events
        yourself. Stripe test mode sends you to Stripe&apos;s test checkout
        page. Live checkout isn&apos;t built.
      </p>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {active.length === 0 ? (
        <Empty>
          {offers.some((o) => o.status === 'active')
            ? 'Every active offer sells a replaced release; archive it and offer the current release.'
            : 'Create an offer first; a checkout sells one active offer.'}
        </Empty>
      ) : (
        <OpenCheckout
          base={base}
          session={session}
          offers={active}
          busy={busy}
          fixture={fixture}
          opened={(c) => {
            setError('');
            list.reload();
            setPicked(c.id);
          }}
          setBusy={setBusy}
          setError={setError}
        />
      )}
      <Status
        loading={list.loading && !list.data}
        error={list.error}
        stale={list.stale || own.stale}
        retry={list.reload}
      >
        {checkouts.length > 0 && (
          <ul className="rows" aria-label="Recent checkouts">
            {checkouts.map((c) => {
              const o = offerById.get(c.offer_id);
              return (
                <li key={c.id} className={c.id === picked ? 'focused' : ''}>
                  <strong>{o?.label ?? `offer ${shortId(c.offer_id)}`}</strong>{' '}
                  <span
                    className={`badge ${c.state === 'open' ? 'ok' : 'bad'}`}
                  >
                    {c.state === 'open' ? 'opened' : 'failed'}
                  </span>
                  <small>
                    {' '}
                    · buyer {c.customer_ref} · {when(c.created_at)}
                    {c.reason ? ` · ${c.reason}` : ''}
                  </small>
                  {c.state === 'open' && c.id !== picked && (
                    <>
                      {' '}
                      <button
                        className="secondary"
                        onClick={() => setPicked(c.id)}
                      >
                        Continue
                      </button>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Status>
      {selected && selected.state === 'open' && (
        <CheckoutDetail
          key={selected.id}
          base={base}
          session={session}
          checkout={selected}
          offer={offerById.get(selected.offer_id) ?? ownFor?.offer ?? null}
          connection={
            connById.get(
              (offerById.get(selected.offer_id) ?? ownFor?.offer)
                ?.connection_id ?? '',
            ) ?? null
          }
          access={
            ownFor?.access ??
            entitlements.find(
              (e) =>
                e.offer_id === selected.offer_id &&
                e.customer_ref === selected.customer_ref,
            ) ??
            null
          }
          fixture={fixture}
          changed={changed}
          close={() => setPicked('')}
        />
      )}
    </>
  );
}

function OpenCheckout({
  base,
  session,
  offers,
  busy,
  fixture,
  opened,
  setBusy,
  setError,
}: {
  base: string;
  session: SessionInfo;
  offers: Offer[];
  busy: boolean;
  fixture: boolean;
  opened: (c: CheckoutRow) => void;
  setBusy: (b: boolean) => void;
  setError: (e: string) => void;
}) {
  const [offerPick, setOffer] = useState('');
  const offerId = offers.some((o) => o.id === offerPick)
    ? offerPick
    : (offers[0]?.id ?? '');
  const [buyer, setBuyer] = useState(newBuyerRef);
  const validBuyer = /^[A-Za-z0-9_.:-]{3,100}$/.test(buyer);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const c = await api(CheckoutSchema, `${base}/payment-checkouts`, {
        csrf: session.csrf_token,
        body: {
          offer_id: offerId,
          customer_ref: buyer,
          success_url: returnUrl(),
          cancel_url: returnUrl(),
        },
      });
      if (c.state === 'failed')
        setError(
          `The processor didn't open a checkout: ${c.reason ?? 'no reason given'}.`,
        );
      setBuyer(newBuyerRef());
      opened(c);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="gh-form" onSubmit={(e) => void submit(e)}>
      <div className="two">
        <div>
          <label htmlFor="co-offer">Offer</label>
          <select
            id="co-offer"
            value={offerId}
            onChange={(e) => setOffer(e.target.value)}
          >
            {offers.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label} · {money(o.price_nano_usd, fixture)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="co-buyer">Buyer reference</label>
          <input
            id="co-buyer"
            value={buyer}
            maxLength={100}
            aria-describedby="co-buyer-note"
            onChange={(e) => setBuyer(e.target.value.trim())}
          />
          <p className="small" id="co-buyer-note">
            A label for this test buyer, not a real person or email. Letters,
            digits and . _ : - only.
          </p>
        </div>
      </div>
      {!validBuyer && buyer && (
        <p className="error">Use 3 to 100 letters, digits or . _ : -</p>
      )}
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || !offerId || !validBuyer}
        >
          Open checkout
        </button>
      </div>
    </form>
  );
}

function CheckoutDetail({
  base,
  session,
  checkout,
  offer,
  connection,
  access,
  fixture,
  changed,
  close,
}: {
  base: string;
  session: SessionInfo;
  checkout: CheckoutRow;
  offer: Offer | null;
  connection: PaymentConnection | null;
  access: Entitlement | null;
  fixture: boolean;
  changed: () => void;
  close: () => void;
}) {
  const simulated = connection?.body.processor === 'fixture';
  const accessLine = (
    <p className="small" role="status">
      Buyer access:{' '}
      <span
        className={`badge ${access?.status === 'active' ? 'ok' : access?.status === 'suspended' ? 'warn' : access ? 'bad' : ''}`}
      >
        {access
          ? (ACCESS_TEXT[access.status] ?? words(access.status))
          : 'No access yet'}
      </span>
    </p>
  );
  return (
    <section className="test-checkout" aria-labelledby="co-detail">
      <div className="decision-head">
        <h4 id="co-detail">
          {offer?.label ?? 'Offer'} for {checkout.customer_ref}
        </h4>
        <button className="text" onClick={close}>
          Close
        </button>
      </div>
      {simulated ? (
        <SimulatedBuyer
          base={base}
          session={session}
          checkout={checkout}
          offer={offer}
          fixture={fixture}
          accessLine={accessLine}
          changed={changed}
        />
      ) : (
        <StripeTestCheckout
          base={base}
          session={session}
          checkout={checkout}
          connection={connection}
          accessLine={accessLine}
          changed={changed}
        />
      )}
    </section>
  );
}

function SimulatedBuyer({
  base,
  session,
  checkout,
  offer,
  fixture,
  accessLine,
  changed,
}: {
  base: string;
  session: SessionInfo;
  checkout: CheckoutRow;
  offer: Offer | null;
  fixture: boolean;
  accessLine: ReactNode;
  changed: () => void;
}) {
  const path = `${base}/payment-checkouts/${checkout.id}`;
  const load = useLoad(
    () => api(TestCheckoutStateSchema, `${path}/buyer`),
    [checkout.id],
  );
  const [state, setState] = useState<TestCheckoutState | null>(null);
  const s = state ?? load.data;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [left, setLeft] = useState(false);
  const [spoil, setSpoil] = useState<
    Record<string, 'wrong_secret' | 'expired'>
  >({});
  const send = async (suffix: string, body: unknown) => {
    setBusy(true);
    setError('');
    try {
      setState(
        await api(TestCheckoutStateSchema, `${path}/${suffix}`, {
          csrf: session.csrf_token,
          body,
        }),
      );
      changed();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const price = offer ? money(offer.price_nano_usd, fixture) : '';
  const centsShown = (c: number) =>
    money((BigInt(c) * 10_000_000n).toString(), fixture);
  const waiting =
    s?.events.filter((e) =>
      e.deliveries.every(
        (d) => d.outcome !== 'applied' && d.outcome !== 'duplicate',
      ),
    ).length ?? 0;
  return (
    <Status
      loading={load.loading && !s}
      error={load.error}
      stale={load.stale}
      retry={load.reload}
    >
      {s && (
        <>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {!s.available && (
            <p className="notice">
              The simulated processor no longer has this checkout: the studio
              restarted, or newer test checkouts replaced it. Open a new one to
              keep testing; what was already delivered stays in the ledger.
            </p>
          )}
          {s.available && !s.payment && (
            <div className="buyer-page" aria-label="Simulated checkout page">
              <p className="eyebrow">Simulated checkout page · test only</p>
              <p>
                <strong>{offer?.label ?? 'This offer'}</strong>
                {price && <> · {price}</>}
              </p>
              {left ? (
                <p className="small">
                  The buyer left without paying. Nothing was charged and no
                  access was granted.
                </p>
              ) : (
                <p className="small">
                  No card is asked for: the simulated processor takes the
                  payment when the buyer presses Pay.
                </p>
              )}
              <div className="actions">
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() => void send('buyer', { action: 'pay' })}
                >
                  Pay {price}
                </button>
                {!left && (
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setLeft(true)}
                  >
                    Leave without paying
                  </button>
                )}
              </div>
            </div>
          )}
          {s.payment && (
            <>
              <p className="small">
                Back on the return page, the buyer reads: &ldquo;Access is
                granted only after the payment processor confirms the payment to
                the studio; returning here does not grant it.&rdquo;
              </p>
              <dl className="facts">
                <dt>Payment at the processor</dt>
                <dd>
                  {s.payment.id} · {centsShown(s.payment.amount_cents)}
                </dd>
                <dt>Funds</dt>
                <dd>{s.payment.settled ? 'settled' : 'pending'}</dd>
                <dt>Refunded</dt>
                <dd>
                  {s.payment.refunded_cents === 0
                    ? 'nothing'
                    : s.payment.refunded_cents >= s.payment.amount_cents
                      ? 'in full'
                      : centsShown(s.payment.refunded_cents)}
                </dd>
                <dt>Dispute</dt>
                <dd>
                  {s.payment.dispute === 'none' ? 'none' : s.payment.dispute}
                </dd>
              </dl>
            </>
          )}
          {accessLine}
          {s.available && s.payment && s.allowed.length > 0 && (
            <div
              className="actions"
              role="group"
              aria-label="What the processor does next"
            >
              {s.allowed.map((a) => (
                <button
                  key={a}
                  className="secondary"
                  disabled={busy}
                  onClick={() => void send('buyer', { action: a })}
                >
                  {ACTION_LABEL[a]}
                </button>
              ))}
            </div>
          )}
          {s.events.length > 0 && (
            <>
              <h4>Processor events</h4>
              <p className="small">
                Each step above queues the event a processor would send. Nothing
                changes in the studio until you deliver it. Deliver in any order
                or more than once: the server reads the payment back from the
                processor each time, so the result is the same.
                {waiting > 0 && ` ${waiting} not applied yet.`}
              </p>
              <ul className="rows" aria-label="Processor events">
                {s.events.map((e) => (
                  <li key={e.id}>
                    <strong>{EVENT_LABEL[e.type] ?? e.type}</strong>
                    <small> · queued {when(e.queued_at)}</small>
                    {e.deliveries.length > 0 && (
                      <ul className="small">
                        {e.deliveries.map((d, i) => (
                          <li key={i}>
                            {when(d.at)} · {deliveryText(d)}
                          </li>
                        ))}
                      </ul>
                    )}
                    <div className="row-actions">
                      <button
                        className="secondary"
                        disabled={busy || !s.available}
                        onClick={() =>
                          void send('deliver', {
                            event_id: e.id,
                            signature: 'valid',
                          })
                        }
                      >
                        {e.deliveries.some((d) => d.signature === 'valid')
                          ? 'Deliver again'
                          : 'Deliver'}
                      </button>
                      <label className="sr-only" htmlFor={`spoil-${e.id}`}>
                        Spoiled delivery for {EVENT_LABEL[e.type] ?? e.type}
                      </label>
                      <select
                        id={`spoil-${e.id}`}
                        value={spoil[e.id] ?? 'wrong_secret'}
                        onChange={(ev) =>
                          setSpoil({
                            ...spoil,
                            [e.id]: ev.target.value as
                              'wrong_secret' | 'expired',
                          })
                        }
                      >
                        <option value="wrong_secret">
                          with the wrong secret
                        </option>
                        <option value="expired">with an old timestamp</option>
                      </select>
                      <button
                        className="secondary"
                        disabled={busy || !s.available}
                        onClick={() =>
                          void send('deliver', {
                            event_id: e.id,
                            signature: spoil[e.id] ?? 'wrong_secret',
                          })
                        }
                      >
                        Deliver spoiled
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </Status>
  );
}

function StripeTestCheckout({
  base,
  session,
  checkout,
  connection,
  accessLine,
  changed,
}: {
  base: string;
  session: SessionInfo;
  checkout: CheckoutRow;
  connection: PaymentConnection | null;
  accessLine: ReactNode;
  changed: () => void;
}) {
  const url = stripeCheckoutUrl(checkout.url);
  const [pi, setPi] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  return (
    <>
      <p className="small">
        Pay on Stripe&apos;s test checkout page with one of Stripe&apos;s test
        cards. Stripe then sends its signed events to the studio through your
        forwarder (the Stripe CLI); access appears below once one is read back.
      </p>
      {url ? (
        <p>
          <a href={url} target="_blank" rel="noreferrer noopener">
            Open Stripe test checkout
          </a>
        </p>
      ) : (
        <p className="small">
          No Stripe checkout link was returned
          {checkout.url ? ` (${checkout.url})` : ''}.
        </p>
      )}
      {accessLine}
      {connection && (
        <form
          className="inline-form"
          onSubmit={(e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            setNote('');
            api(z.unknown(), `${base}/payments/${connection.id}/reconcile`, {
              csrf: session.csrf_token,
              body: { payment_id: pi.trim() },
            })
              .then((r) => {
                const o = (r as { outcome?: unknown }).outcome;
                setNote(
                  `Read from Stripe: ${typeof o === 'string' ? words(o) : 'done'}.`,
                );
                changed();
              })
              .catch((err: unknown) => setError(message(err)))
              .finally(() => setBusy(false));
          }}
        >
          <label htmlFor="co-pi">Missed an event? Read a payment by id</label>
          <input
            id="co-pi"
            placeholder="pi_…"
            value={pi}
            onChange={(e) => setPi(e.target.value)}
          />
          <button
            className="secondary"
            type="submit"
            disabled={busy || !/^pi_[A-Za-z0-9_]{1,120}$/.test(pi.trim())}
          >
            Read payment
          </button>
        </form>
      )}
      {note && <p className="notice ok">{note}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}
