import { Fragment, useState, type FormEvent } from 'react';
import {
  ArtifactSummarySchema,
  EntitlementSchema,
  OfferSchema,
  PaymentConnectionSchema,
  z,
  type PaymentConnection,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { money } from './budgets.js';
import { usdToNano } from './amounts.js';
import { Funding } from './funding.js';
import { Checkout } from './checkout.js';
import { Empty, Status, shortId, useLoad, type View } from './ui.js';

const BalancesSchema = z.strictObject({
  balances: z.record(z.string(), z.string()),
  total_nano: z.string(),
});
const CONNECTION_STATUS: Record<string, string> = {
  unverified: 'not verified yet',
  active: 'verified',
  rejected: 'rejected',
  revoked: 'revoked by you',
};
const ACCOUNT_LABEL: Record<string, string> = {
  processor_pending: 'Held by the processor (pending)',
  processor_available: 'Held by the processor (available)',
  bank: 'At the bank',
  revenue: 'Revenue',
  processing_fees: 'Processing fees',
  refunds: 'Refunds',
  dispute_losses: 'Dispute losses',
  dispute_fees: 'Dispute fees',
  owner_funding: 'Your own funding',
};
/**
 * The ledger stores debits positive and credits negative. Revenue and owner funding are
 * credit accounts, so their balances are negative there; flip them so every line reads as a
 * positive amount of what it names.
 */
const CREDIT_NORMAL = new Set(['revenue', 'owner_funding']);
export const asShown = (account: string, nano: string) =>
  CREDIT_NORMAL.has(account) ? (-BigInt(nano)).toString() : nano;

/** Archiving an offer can't be undone, so it asks first and says what happens. */
function ArchiveOffer({
  label,
  busy,
  archive,
}: {
  label: string;
  busy: boolean;
  archive: () => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);
  if (!asking)
    return (
      <>
        {' '}
        <button
          className="secondary stop"
          disabled={busy}
          onClick={() => setAsking(true)}
        >
          Archive…
        </button>
      </>
    );
  return (
    <span
      className="confirm-inline"
      role="group"
      aria-label={`Archive ${label}`}
    >
      Stop selling {label}? This can&apos;t be undone; people who already bought
      it keep access.
      <button className="secondary" autoFocus onClick={() => setAsking(false)}>
        Keep selling
      </button>
      <button
        className="secondary danger"
        disabled={busy}
        onClick={() => void archive().then(() => setAsking(false))}
      >
        Archive for good
      </button>
    </span>
  );
}

/**
 * Payments, entitlements and reinvestment (X07, docs/PAYMENTS.md). Only fixture and processor
 * test mode exist; live payments are not built. Amounts and access come from the processor
 * as read by the server, never from this page. Owner funding, funding sources, commitments
 * and reinvestment are in funding.tsx.
 */
export function Payments({
  session,
  workspace,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const fixture = workspace.record_mode === 'fixture';
  const viewer = workspace.role === 'viewer';
  const data = useLoad(async () => {
    const [connections, offers, balances, entitlements, artifacts] =
      await Promise.all([
        api(z.array(PaymentConnectionSchema), `${base}/payment-connections`),
        api(z.array(OfferSchema), `${base}/payment-offers`),
        api(BalancesSchema, `${base}/ledger/balances`),
        api(z.array(EntitlementSchema), `${base}/entitlements`),
        api(z.array(ArtifactSummarySchema), `${base}/artifacts`),
      ]);
    return { connections, offers, balances, entitlements, artifacts };
  }, [workspace.id]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  /** Bumped after an add succeeds: the forms remount closed and empty, so they can't add twice. */
  const [connAdded, setConnAdded] = useState(0);
  const [offerAdded, setOfferAdded] = useState(0);
  const act = async (work: () => Promise<string>) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await work());
      data.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const d = data.data;
  // Only a verified, current release can be sold; failed, blocked or replaced builds can't.
  const verified =
    d?.artifacts.filter((a) => a.state === 'verified' && a.current) ?? [];
  // Fixture workspaces count in simulated units, so their amounts never read as dollars.
  const usd = (nano: string) => money(nano, !!fixture);

  return (
    <section className="panel" aria-labelledby="pay-title">
      <h2 id="pay-title">Payments</h2>
      <p>
        Sell a verified release through a payment processor and see what came
        in. Access is granted only after the server reads the payment from the
        processor; a checkout page or a webhook never grants it by itself.
      </p>
      <p className="notice">
        Live payments aren&apos;t built. Connections work only in fixture
        workspaces, with the simulated processor or a processor&apos;s test
        mode, so nothing here is real money.
      </p>
      <div aria-live="polite">
        {notice && <p className="notice ok">{notice}</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <Status
        loading={data.loading && !d}
        error={data.error}
        retry={data.reload}
      >
        {d && (
          <>
            <h3>Processor connections</h3>
            {d.connections.length === 0 ? (
              <Empty>
                {fixture
                  ? 'No processor connected yet. Add one below.'
                  : 'Payments need a fixture workspace; real workspaces cannot connect a processor yet.'}
              </Empty>
            ) : (
              <ul className="rows">
                {d.connections.map((c) => (
                  <ConnectionRow
                    key={c.id}
                    c={c}
                    base={base}
                    session={session}
                    busy={busy}
                    viewer={viewer}
                    act={act}
                  />
                ))}
              </ul>
            )}
            {fixture && !viewer && (
              <details className="gh-add" key={`conn-${connAdded}`}>
                <summary>Add a processor connection</summary>
                <AddConnection
                  done={() => setConnAdded((n) => n + 1)}
                  base={base}
                  session={session}
                  busy={busy}
                  act={act}
                />
              </details>
            )}

            <h3>Offers</h3>
            {d.offers.length === 0 ? (
              <Empty>No offers. An offer sells one verified release.</Empty>
            ) : (
              <ul className="rows">
                {d.offers.map((o) => (
                  <li key={o.id}>
                    <strong>{o.label}</strong> · {usd(o.price_nano_usd)}{' '}
                    <span
                      className={`badge ${o.status === 'active' ? 'ok' : ''}`}
                    >
                      {o.status}
                    </span>
                    <small>
                      {' '}
                      · release {shortId(o.artifact_id)} · {when(o.created_at)}
                    </small>
                    {!viewer && o.status === 'active' && (
                      <ArchiveOffer
                        label={o.label}
                        busy={busy}
                        archive={() =>
                          act(async () => {
                            await api(
                              OfferSchema,
                              `${base}/payment-offers/${o.id}/archive`,
                              { csrf: session.csrf_token, body: {} },
                            );
                            return `${o.label} archived; existing buyers keep access.`;
                          })
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
            {!viewer &&
              d.connections.some((c) => c.status === 'active') &&
              (verified.length === 0 ? (
                <p className="small">
                  {d.artifacts.some((a) => a.state === 'verified')
                    ? 'Only the current release of a spec can be sold; package its latest build, which then appears in '
                    : 'To sell something, package a verified build first; it then appears in '}
                  <button className="text" onClick={() => open('gallery')}>
                    Gallery
                  </button>
                  .
                </p>
              ) : (
                <details className="gh-add" key={`offer-${offerAdded}`}>
                  <summary>Create an offer</summary>
                  <AddOffer
                    done={() => setOfferAdded((n) => n + 1)}
                    base={base}
                    session={session}
                    connections={d.connections.filter(
                      (c) => c.status === 'active',
                    )}
                    artifacts={verified}
                    busy={busy}
                    act={act}
                  />
                </details>
              ))}

            <Checkout
              session={session}
              workspace={workspace}
              offers={d.offers}
              connections={d.connections}
              entitlements={d.entitlements}
              changed={data.reload}
            />

            <h3>Money in</h3>
            {Object.keys(d.balances.balances).length === 0 ? (
              <Empty>No payments recorded yet.</Empty>
            ) : (
              <dl className="facts">
                {Object.entries(d.balances.balances).map(([k, v]) => (
                  <Fragment key={k}>
                    <dt>{ACCOUNT_LABEL[k] ?? words(k)}</dt>
                    <dd>{usd(asShown(k, v))}</dd>
                  </Fragment>
                ))}
              </dl>
            )}
            <p className="small">
              A double-entry ledger: payments as the processor reports them,
              plus funding you record yourself. Corrections are new entries;
              nothing is edited.
            </p>

            <h3>Buyer access</h3>
            {d.entitlements.length === 0 ? (
              <Empty>No one has bought access yet.</Empty>
            ) : (
              <ul className="rows">
                {d.entitlements.map((e) => (
                  <li key={e.id}>
                    <span
                      className={`badge ${e.status === 'active' ? 'ok' : e.status === 'suspended' ? 'warn' : 'bad'}`}
                    >
                      {e.status}
                    </span>{' '}
                    {e.customer_ref}
                    <small>
                      {' '}
                      · offer {shortId(e.offer_id)} · {e.reason} ·{' '}
                      {when(e.updated_at)}
                    </small>
                  </li>
                ))}
              </ul>
            )}

            <Funding
              session={session}
              workspace={workspace}
              connections={d.connections}
              changed={data.reload}
              open={open}
            />
          </>
        )}
      </Status>
    </section>
  );
}

type Act = (work: () => Promise<string>) => Promise<void>;

function ConnectionRow({
  c,
  base,
  session,
  busy,
  viewer,
  act,
}: {
  c: PaymentConnection;
  base: string;
  session: SessionInfo;
  busy: boolean;
  viewer: boolean;
  act: Act;
}) {
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const b = c.body;
  return (
    <li>
      <div>
        <strong>{b.label}</strong>{' '}
        <span
          className={`badge ${c.status === 'active' ? 'ok' : c.status === 'unverified' ? 'warn' : 'bad'}`}
        >
          {CONNECTION_STATUS[c.status] ?? words(c.status)}
        </span>
        <small>
          {' '}
          ·{' '}
          {b.processor === 'fixture'
            ? 'simulated processor'
            : 'Stripe test mode'}{' '}
          · account {b.account_id}
          {b.secret_key_env ? ` · key in ${b.secret_key_env}` : ''} · webhook
          secret in {b.webhook_secret_env}
        </small>
      </div>
      {c.verification && (
        <p className="small">
          Last checked {when(c.verification.checked_at)}:{' '}
          {words(c.verification.result)}
          {c.verification.reason ? ` · ${c.verification.reason}` : ''}
        </p>
      )}
      {c.status_reason && c.status_reason !== c.verification?.reason && (
        <p className="small">{c.status_reason}</p>
      )}
      {!viewer && c.status !== 'revoked' && (
        <div className="actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const r = await api(
                  z.unknown(),
                  `${base}/payment-connections/${c.id}/verify`,
                  { csrf: session.csrf_token, body: {} },
                );
                const status = PaymentConnectionSchema.safeParse(
                  (r as { connection?: unknown }).connection ?? r,
                );
                return `${b.label}: ${
                  status.success
                    ? (CONNECTION_STATUS[status.data.status] ??
                      words(status.data.status))
                    : 'checked'
                }.`;
              })
            }
          >
            Verify the account
          </button>
          {!revoking ? (
            <button
              className="secondary stop"
              disabled={busy}
              onClick={() => setRevoking(true)}
            >
              Revoke…
            </button>
          ) : (
            <span className="confirm-inline" role="group" aria-label="Revoke">
              Revoke {b.label} for good? It can&apos;t be verified or used
              again.
              <label className="inline" htmlFor={`revoke-${c.id}`}>
                Why
              </label>
              <input
                id={`revoke-${c.id}`}
                autoFocus
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <button className="secondary" onClick={() => setRevoking(false)}>
                Keep
              </button>
              <button
                className="secondary danger"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void act(async () => {
                    await api(
                      PaymentConnectionSchema,
                      `${base}/payment-connections/${c.id}/revoke`,
                      {
                        csrf: session.csrf_token,
                        body: {
                          expected_version: c.version,
                          reason: reason.trim(),
                        },
                      },
                    );
                    setRevoking(false);
                    return `${b.label} revoked.`;
                  })
                }
              >
                Revoke for good
              </button>
            </span>
          )}
        </div>
      )}
    </li>
  );
}

function AddConnection({
  done,
  base,
  session,
  busy,
  act,
}: {
  done: () => void;
  base: string;
  session: SessionInfo;
  busy: boolean;
  act: Act;
}) {
  const [processor, setProcessor] = useState<'fixture' | 'stripe'>('fixture');
  const [label, setLabel] = useState('Simulated processor');
  const [account, setAccount] = useState('acct_fixture0001');
  const [keyEnv, setKeyEnv] = useState('CREATOR_STRIPE_TEST_KEY');
  const [hookEnv, setHookEnv] = useState('CREATOR_PAYMENTS_HOOK');
  function submit(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      const c = await api(
        PaymentConnectionSchema,
        `${base}/payment-connections`,
        {
          csrf: session.csrf_token,
          body: {
            label: label.trim(),
            processor,
            mode: processor === 'fixture' ? 'fixture' : 'test',
            account_id: account.trim(),
            secret_key_env: processor === 'stripe' ? keyEnv.trim() : null,
            webhook_secret_env: hookEnv.trim(),
          },
        },
      );
      done();
      return `${c.body.label} added. Verify it before creating offers.`;
    });
  }
  return (
    <form onSubmit={submit} className="gh-form">
      <label htmlFor="pc-proc">Processor</label>
      <select
        id="pc-proc"
        value={processor}
        onChange={(e) => {
          const p = e.target.value as 'fixture' | 'stripe';
          setProcessor(p);
          setLabel(
            p === 'fixture' ? 'Simulated processor' : 'Stripe test mode',
          );
          setAccount(p === 'fixture' ? 'acct_fixture0001' : '');
        }}
      >
        <option value="fixture">Simulated processor (no network)</option>
        <option value="stripe">Stripe test mode</option>
      </select>
      <div className="two">
        <div>
          <label htmlFor="pc-label">Name</label>
          <input
            id="pc-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="pc-acct">Account it must belong to</label>
          <input
            id="pc-acct"
            placeholder="acct_…"
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          />
        </div>
        {processor === 'stripe' && (
          <div>
            <label htmlFor="pc-key">
              Environment variable holding the test key
            </label>
            <input
              id="pc-key"
              value={keyEnv}
              onChange={(e) => setKeyEnv(e.target.value)}
            />
          </div>
        )}
        <div>
          <label htmlFor="pc-hook">
            Environment variable holding the webhook secret
          </label>
          <input
            id="pc-hook"
            value={hookEnv}
            onChange={(e) => setHookEnv(e.target.value)}
          />
        </div>
      </div>
      <p className="small">
        Names only: the secrets themselves go in the studio&apos;s environment
        (names start with CREATOR_STRIPE_ or CREATOR_PAYMENTS_). A live key is
        refused before any call.
      </p>
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || !label.trim() || !account.trim() || !hookEnv.trim()}
        >
          Add connection
        </button>
      </div>
    </form>
  );
}

function AddOffer({
  done,
  base,
  session,
  connections,
  artifacts,
  busy,
  act,
}: {
  done: () => void;
  base: string;
  session: SessionInfo;
  connections: PaymentConnection[];
  artifacts: z.infer<typeof ArtifactSummarySchema>[];
  busy: boolean;
  act: Act;
}) {
  // Fall back to the first valid option when the lists change under the open form.
  const [connPick, setConnectionId] = useState('');
  const connectionId = connections.some((c) => c.id === connPick)
    ? connPick
    : (connections[0]?.id ?? '');
  const [artifactPick, setArtifactId] = useState('');
  const artifactId = artifacts.some((a) => a.id === artifactPick)
    ? artifactPick
    : (artifacts[0]?.id ?? '');
  const gone = [
    connPick && connPick !== connectionId ? 'processor' : null,
    artifactPick && artifactPick !== artifactId ? 'release' : null,
  ].filter(Boolean);
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');
  const nano = usdToNano(price);
  const wholeCents = nano !== null && BigInt(nano) % 10_000_000n === 0n;
  return (
    <form
      className="gh-form"
      onSubmit={(e) => {
        e.preventDefault();
        const artifact = artifacts.find((a) => a.id === artifactId);
        if (!artifact || !nano || !wholeCents) return;
        void act(async () => {
          const o = await api(OfferSchema, `${base}/payment-offers`, {
            csrf: session.csrf_token,
            body: {
              connection_id: connectionId,
              artifact_id: artifact.id,
              manifest_sha256: artifact.manifest_sha256,
              label: label.trim(),
              price_nano_usd: nano,
            },
          });
          done();
          return `Offer "${o.label}" created.`;
        });
      }}
    >
      <div className="two">
        <div>
          <label htmlFor="po-conn">Processor</label>
          <select
            id="po-conn"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.body.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="po-art">Release</label>
          <select
            id="po-art"
            value={artifactId}
            onChange={(e) => setArtifactId(e.target.value)}
          >
            {artifacts.map((a) => (
              <option key={a.id} value={a.id}>
                {shortId(a.id)} · spec v{a.spec.version} ·{' '}
                {a.commit.slice(0, 10)}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="po-label">Name buyers see</label>
          <input
            id="po-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="po-price">
            Price (whole cents; simulated in fixture workspaces)
          </label>
          <input
            id="po-price"
            inputMode="decimal"
            placeholder="25.00"
            value={price}
            onChange={(e) => setPrice(e.target.value)}
          />
        </div>
      </div>
      {gone.length > 0 && (
        <p className="small" role="status">
          The {gone.join(' and ')} you picked {gone.length > 1 ? 'are' : 'is'}{' '}
          no longer available; the form now uses the first one listed. Check
          before creating the offer.
        </p>
      )}
      {price.trim() && (!nano || !wholeCents) && (
        <p className="error">
          Enter a price in dollars and cents, like 25 or 9.99.
        </p>
      )}
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={
            busy || !label.trim() || !nano || !wholeCents || !artifactId
          }
        >
          Create offer
        </button>
      </div>
    </form>
  );
}
