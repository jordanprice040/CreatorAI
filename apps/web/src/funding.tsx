import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Money } from './money.js';
import {
  CapacitySchema,
  ReinvestmentPolicySchema,
  z,
  type Capacity,
  type PaymentConnection,
  type ReinvestmentPolicy,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { money } from './budgets.js';
import { usdToNano } from './amounts.js';
import { ShowOlder, useOlder } from './older.js';
import { Empty, Status, shortId, useLoad, type View } from './ui.js';

const nano = z.string().regex(/^-?(0|[1-9][0-9]{0,29})$/);
const RailSchema = z.object({
  id: z.string(),
  kind: z.enum(['processor_balance', 'owner_attested']),
  label: z.string(),
  status: z.enum(['available', 'unavailable']),
  status_reason: z.string().nullable(),
  connection_id: z.string().nullable(),
  available_nano: nano.nullable(),
  source: z.string().nullable(),
  observed_at: z.string().nullable(),
  expires_at: z.string().nullable(),
});
export type Rail = z.infer<typeof RailSchema>;
const CommitmentSchema = z.object({
  id: z.string(),
  kind: z.enum(['reserve', 'liability', 'tax']),
  label: z.string(),
  amount_nano_usd: nano,
  status: z.enum(['open', 'closed']),
  created_at: z.string(),
  closed_at: z.string().nullable(),
});
const AllocationRowSchema = z.object({
  id: z.string(),
  amount_nano: nano,
  requested_nano: nano,
  envelope_id: z.string(),
  policy_version: z.number(),
  target: z.enum(['standalone', 'portfolio']),
  created_at: z.string(),
});
const TrancheSchema = z.object({
  id: z.string(),
  earned_nano: nano,
  cap_nano: nano,
  consumed_nano: nano,
  disputed: z.boolean(),
  settled_at: z.string(),
  eligible_at: z.string(),
});

/** What stops more earnings becoming budget right now, in the owner's terms. */
export const BINDING_LABEL: Record<string, string> = {
  policy_disabled: 'reinvesting is off',
  losses_outstanding: 'losses to repay first',
  eligible_tranches: 'earnings past their waiting period',
  surplus: 'surplus after costs',
  usable_liquidity: 'usable cash',
  period_cap: "this period's limit",
};
const COMMITMENT_KIND: Record<string, string> = {
  reserve: 'Reserve',
  liability: 'Bill or debt',
  tax: 'Tax set aside',
};

/** "12.5" → 1250 basis points; whole hundredths of a percent from 0 to 100, else null. */
export function percentToBps(text: string): number | null {
  const m = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(text.trim().replace(/%$/, ''));
  if (!m) return null;
  const bps = Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0'));
  return bps <= 10_000 ? bps : null;
}

/** Whether a funding source counts toward usable cash now, and why not if it doesn't. */
export function railState(
  rail: Rail,
  activeConnections: ReadonlySet<string>,
  now: number,
): { counts: boolean; note: string } {
  if (rail.status !== 'available')
    return {
      counts: false,
      note: `marked unavailable${rail.status_reason ? `: ${rail.status_reason}` : ''}`,
    };
  if (
    rail.kind === 'processor_balance' &&
    !activeConnections.has(rail.connection_id ?? '')
  )
    return { counts: false, note: 'its processor connection is not verified' };
  if (!rail.expires_at || rail.available_nano === null)
    return {
      counts: false,
      note:
        rail.kind === 'owner_attested'
          ? 'no balance recorded yet'
          : 'balance not read yet',
    };
  if (Date.parse(rail.expires_at) <= now)
    return {
      counts: false,
      note: `balance from ${when(rail.observed_at ?? rail.expires_at)} is out of date`,
    };
  return { counts: true, note: `counts until ${when(rail.expires_at)}` };
}

/**
 * Keeps one idempotency key while the same request is retried (a timeout, a lost response),
 * so a retry can't record money twice; a changed request gets a new key.
 */
export function requestKeys(prefix: string, mint = () => crypto.randomUUID()) {
  let held: { signature: string; key: string } | null = null;
  return {
    key(body: unknown) {
      const signature = JSON.stringify(body);
      if (held?.signature !== signature)
        held = { signature, key: `${prefix}:${mint()}` };
      return held.key;
    },
    clear() {
      held = null;
    },
  };
}
function useRequestKey(prefix: string) {
  const ref = useRef<ReturnType<typeof requestKeys> | null>(null);
  ref.current ??= requestKeys(prefix);
  return ref.current;
}

type PolicyLimits = Pick<
  ReinvestmentPolicy,
  | 'enabled'
  | 'eligible_bps'
  | 'holdback_days'
  | 'period_days'
  | 'period_cap_nano_usd'
  | 'min_reserve_nano_usd'
>;
/**
 * Whether saving `next` lets more earnings become budget, or sooner, than the current policy:
 * turning it on, a larger share or period limit, a shorter waiting period or period, or a
 * smaller reserve. Those saves ask first.
 */
export function loosens(prev: PolicyLimits | null, next: PolicyLimits) {
  if (!next.enabled) return false;
  if (!prev?.enabled) return true;
  return (
    next.eligible_bps > prev.eligible_bps ||
    next.holdback_days < prev.holdback_days ||
    next.period_days < prev.period_days ||
    BigInt(next.period_cap_nano_usd) > BigInt(prev.period_cap_nano_usd) ||
    BigInt(next.min_reserve_nano_usd) < BigInt(prev.min_reserve_nano_usd)
  );
}

type Act = (work: () => Promise<string>) => Promise<boolean>;

/**
 * Owner funding, funding sources, commitments and the reinvestment policy and allocations
 * (X07, docs/PAYMENTS.md). Nothing reinvests automatically (owner decision #49): earnings
 * become budget only when the owner sets an enabled policy and then asks for an allocation,
 * and the server bounds every allocation. Spending from that budget still sits under the
 * overall runtime ceiling in Settings. Only the workspace owner can change any of this.
 */
export function Funding({
  session,
  workspace,
  connections,
  changed,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  connections: PaymentConnection[];
  changed: () => void;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const owner = workspace.role === 'owner';
  const fixture = workspace.record_mode === 'fixture';
  // `usd` is exact, for sentences and confirmations; `show` is the display amount (P-9).
  const usd = (n: string) => money(n, fixture);
  const show = (n: string) => <Money nano={n} fixture={fixture} />;
  const data = useLoad(async () => {
    const [capacity, policy, rails, commitments, allocations, tranches] =
      await Promise.all([
        api(CapacitySchema, `${base}/reinvestment`),
        api(ReinvestmentPolicySchema.nullable(), `${base}/reinvestment/policy`),
        api(z.array(RailSchema), `${base}/funding-rails`),
        api(z.array(CommitmentSchema), `${base}/commitments`),
        api(z.array(AllocationRowSchema), `${base}/reinvestment/allocations`),
        api(z.array(TrancheSchema), `${base}/reinvestment/tranches`),
      ]);
    // Portfolio allocations need a portfolio policy; if it can't be read, don't offer them.
    const portfolio = await api(
      z.object({ state: z.object({}).nullable() }),
      `${base}/portfolio`,
    ).then(
      (v) => v.state !== null,
      () => false,
    );
    return {
      capacity,
      policy,
      rails,
      commitments,
      allocations,
      tranches,
      portfolio,
    };
  }, [workspace.id]);
  // Read newest first; allocations past the newest 200 come a page at a time (audit L-9).
  const allocations = useOlder(
    data.data?.allocations,
    AllocationRowSchema,
    `${base}/reinvestment/allocations`,
    200,
  );
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  /** Bumped after a form succeeds so it remounts closed and empty. */
  const [done, setDone] = useState(0);
  const act: Act = async (work) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      setNotice(await work());
      setDone((n) => n + 1);
      data.reload();
      changed();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    } finally {
      setBusy(false);
    }
  };
  const d = data.data;
  const active = new Set(
    connections.filter((c) => c.status === 'active').map((c) => c.id),
  );
  const now = Date.now();
  const forms = { base, session, busy, act, usd, show };

  return (
    <>
      <h3 id="funding">Funding and reinvesting</h3>
      <p className="small">
        Record money you put in, the cash you can draw on, and what you owe.
        Earnings become budget only when you turn reinvesting on and then ask
        for it; nothing reinvests automatically. Budget made from earnings still
        stays under your overall spending ceiling in{' '}
        <button className="text" onClick={() => open('settings')}>
          Settings
        </button>
        .
      </p>
      {!owner && (
        <p className="small">
          Only the workspace owner can record funding or change reinvesting.
        </p>
      )}
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
        stale={data.stale}
        retry={data.reload}
      >
        {d && (
          <>
            <CapacityFacts capacity={d.capacity} usd={show} />
            {BigInt(d.capacity.outstanding_losses_nano) > 0n && owner && (
              <div className="actions">
                <button
                  className="secondary"
                  disabled={busy}
                  onClick={() =>
                    void act(async () => {
                      await api(
                        z.unknown(),
                        `${base}/reinvestment/settle-losses`,
                        { csrf: session.csrf_token, body: {} },
                      );
                      return 'Checked for budget to reclaim and earnings to repay losses with.';
                    })
                  }
                >
                  Repay losses now
                </button>
                <span className="small">
                  A refund or dispute arrived after its earnings were
                  reinvested. New allocations wait until this is repaid.
                </span>
              </div>
            )}

            <h4>Reinvesting policy</h4>
            <PolicySummary policy={d.policy} usd={show} />
            {owner && (
              <details className="gh-add" key={`policy-${done}`}>
                <summary>
                  {d.policy ? 'Change the policy' : 'Set a policy'}
                </summary>
                <PolicyForm policy={d.policy} {...forms} />
              </details>
            )}

            <h4>Turn earnings into budget</h4>
            {d.allocations.length === 0 ? (
              <Empty>No earnings have been turned into budget.</Empty>
            ) : (
              <ul className="rows">
                {allocations.items.map((a) => (
                  <li key={a.id}>
                    <strong>{show(a.amount_nano)}</strong>
                    {a.amount_nano !== a.requested_nano && (
                      <> of {show(a.requested_nano)} asked</>
                    )}{' '}
                    <span className="badge">
                      {a.target === 'portfolio' ? 'portfolio' : 'own budget'}
                    </span>
                    <small>
                      {' '}
                      · policy v{a.policy_version} · budget{' '}
                      {shortId(a.envelope_id)} · {when(a.created_at)}
                    </small>
                  </li>
                ))}
              </ul>
            )}
            <ShowOlder list={allocations} what="allocations" />
            {owner &&
              (d.capacity.enabled && BigInt(d.capacity.capacity_nano) > 0n ? (
                <details className="gh-add" key={`alloc-${done}`}>
                  <summary>Turn earnings into a budget</summary>
                  <AllocateForm
                    capacity={d.capacity}
                    portfolio={d.portfolio}
                    {...forms}
                  />
                </details>
              ) : (
                <p className="small">
                  {d.capacity.enabled
                    ? `Nothing can become budget right now: limited by ${BINDING_LABEL[d.capacity.binding] ?? words(d.capacity.binding)}.`
                    : 'Turn reinvesting on in the policy above before turning earnings into budget.'}
                </p>
              ))}
            <Tranches tranches={d.tranches} now={now} usd={show} />

            <h4>Funding sources</h4>
            <p className="small">
              Cash you can draw on. A processor balance counts for 15 minutes
              after it is read; a balance you record yourself counts for 24
              hours. Only fresh balances of available sources count as usable
              cash.
            </p>
            {d.rails.length === 0 ? (
              <Empty>
                No funding sources, so there is no usable cash and nothing can
                become budget.
              </Empty>
            ) : (
              <ul className="rows">
                {d.rails.map((r) => (
                  <RailRow
                    key={r.id}
                    rail={r}
                    state={railState(r, active, now)}
                    owner={owner}
                    {...forms}
                  />
                ))}
              </ul>
            )}
            {owner && (
              <details className="gh-add" key={`rail-${done}`}>
                <summary>Add a funding source</summary>
                <AddRail
                  connections={connections.filter(
                    (c) =>
                      c.status === 'active' &&
                      !d.rails.some((r) => r.connection_id === c.id),
                  )}
                  {...forms}
                />
              </details>
            )}

            <h4>Money you owe or set aside</h4>
            <Commitments commitments={d.commitments} owner={owner} {...forms} />
            {owner && (
              <details className="gh-add" key={`commit-${done}`}>
                <summary>Add a commitment</summary>
                <AddCommitment {...forms} />
              </details>
            )}

            {owner && (
              <>
                <h4>Your own funding</h4>
                <p className="small">
                  Money you put in yourself is recorded in the ledger as your
                  funding. It is never counted as earnings, never reinvested,
                  and doesn&apos;t raise your spending ceiling.
                </p>
                <details className="gh-add" key={`fund-${done}`}>
                  <summary>Record money you put in</summary>
                  <OwnerFunding {...forms} />
                </details>
              </>
            )}
          </>
        )}
      </Status>
    </>
  );
}

type Forms = {
  base: string;
  session: SessionInfo;
  busy: boolean;
  act: Act;
  usd: (n: string) => string;
  /** The display amount: cents in Standard, exact on request (P-9). */
  show: (n: string) => ReactNode;
};

function CapacityFacts({
  capacity: c,
  usd,
}: {
  capacity: Capacity;
  usd: (n: string) => ReactNode;
}) {
  return (
    <dl className="facts">
      <dt>Could become budget now</dt>
      <dd>
        <strong>{usd(c.capacity_nano)}</strong>{' '}
        <small>limited by {BINDING_LABEL[c.binding] ?? words(c.binding)}</small>
      </dd>
      <dt>Earnings past their waiting period</dt>
      <dd>{usd(c.eligible_tranches_nano)}</dd>
      <dt>Surplus after costs</dt>
      <dd>{usd(c.surplus_nano)}</dd>
      <dt>Usable cash</dt>
      <dd>
        {usd(c.usable_liquidity_nano)}{' '}
        <small>
          {usd(c.parts.rails_available_nano)} in fresh funding sources, less{' '}
          {usd(c.parts.min_reserve_nano)} reserve,{' '}
          {usd(c.parts.commitments_nano)} owed or set aside and{' '}
          {usd(c.parts.unspent_reinvested_nano)} reinvested budget not yet spent
        </small>
      </dd>
      {c.policy_version !== null && (
        <>
          <dt>Left this period</dt>
          <dd>{usd(c.period_remaining_nano)}</dd>
        </>
      )}
      {BigInt(c.outstanding_losses_nano) > 0n && (
        <>
          <dt>Losses to repay first</dt>
          <dd>{usd(c.outstanding_losses_nano)}</dd>
        </>
      )}
      {c.parts.unavailable_rails.length > 0 && (
        <>
          <dt>Not counted</dt>
          <dd>{c.parts.unavailable_rails.join('; ')}</dd>
        </>
      )}
    </dl>
  );
}

function PolicySummary({
  policy: p,
  usd,
}: {
  policy: ReinvestmentPolicy | null;
  usd: (n: string) => ReactNode;
}) {
  if (!p)
    return (
      <p className="small">
        Off. No policy is set, so no earnings can become budget.
      </p>
    );
  return (
    <>
      <p className="small">
        <span className={`badge ${p.enabled ? 'ok' : ''}`}>
          {p.enabled ? 'on' : 'off'}
        </span>{' '}
        Version {p.version}, set {when(p.created_at)}.
      </p>
      <dl className="facts">
        <dt>Share of each sale&apos;s earnings</dt>
        <dd>{p.eligible_bps / 100}%</dd>
        <dt>Waiting period after a sale settles</dt>
        <dd>{p.holdback_days} days</dd>
        <dt>Most per period</dt>
        <dd>
          {usd(p.period_cap_nano_usd)} every {p.period_days} days
        </dd>
        <dt>Cash kept in reserve</dt>
        <dd>{usd(p.min_reserve_nano_usd)}</dd>
        <dt>Why</dt>
        <dd>{p.rationale}</dd>
      </dl>
    </>
  );
}

function PolicyForm({
  policy,
  base,
  session,
  busy,
  act,
  usd,
}: Forms & { policy: ReinvestmentPolicy | null }) {
  const nanoText = (n: string | undefined) =>
    n === undefined ? '' : money(n, true).replace(/ sim$/, '');
  const [enabled, setEnabled] = useState(policy?.enabled ?? false);
  const [share, setShare] = useState(
    policy ? String(policy.eligible_bps / 100) : '',
  );
  // 30 days is the waiting period the server already uses when no policy exists.
  const [holdback, setHoldback] = useState(String(policy?.holdback_days ?? 30));
  const [periodDays, setPeriodDays] = useState(
    policy ? String(policy.period_days) : '',
  );
  const [cap, setCap] = useState(nanoText(policy?.period_cap_nano_usd));
  const [reserve, setReserve] = useState(
    nanoText(policy?.min_reserve_nano_usd),
  );
  const [rationale, setRationale] = useState('');
  const [confirming, setConfirming] = useState(false);
  const bps = percentToBps(share);
  const holdbackDays = /^\d{1,3}$/.test(holdback.trim())
    ? Number(holdback)
    : null;
  const period = /^\d{1,3}$/.test(periodDays.trim())
    ? Number(periodDays)
    : null;
  const capNano = usdToNano(cap);
  const reserveNano = usdToNano(reserve);
  const problems = [
    share.trim() && bps === null && 'Share must be a percentage from 0 to 100.',
    holdback.trim() &&
      (holdbackDays === null || holdbackDays > 365) &&
      'Waiting period must be 0 to 365 days.',
    periodDays.trim() &&
      (period === null || period < 1 || period > 366) &&
      'Period must be 1 to 366 days.',
    cap.trim() && !capNano && 'Enter the period limit in dollars, like 10.',
    reserve.trim() && !reserveNano && 'Enter the reserve in dollars, like 50.',
  ].filter(Boolean) as string[];
  const complete =
    bps !== null &&
    holdbackDays !== null &&
    holdbackDays <= 365 &&
    period !== null &&
    period >= 1 &&
    period <= 366 &&
    !!capNano &&
    !!reserveNano &&
    !!rationale.trim();
  const asksFirst =
    complete &&
    loosens(policy, {
      enabled,
      eligible_bps: bps!,
      holdback_days: holdbackDays!,
      period_days: period!,
      period_cap_nano_usd: capNano!,
      min_reserve_nano_usd: reserveNano!,
    });
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!complete) return;
    if (asksFirst && !confirming) {
      setConfirming(true);
      return;
    }
    void act(async () => {
      const p = await api(
        ReinvestmentPolicySchema,
        `${base}/reinvestment/policy`,
        {
          csrf: session.csrf_token,
          body: {
            enabled,
            eligible_bps: bps,
            holdback_days: holdbackDays,
            period_days: period,
            period_cap_nano_usd: capNano,
            min_reserve_nano_usd: reserveNano,
            rationale: rationale.trim(),
          },
        },
      );
      return `Policy version ${p.version} saved; reinvesting is ${p.enabled ? 'on' : 'off'}.`;
    }).then(() => setConfirming(false));
  }
  return (
    <form className="gh-form" onSubmit={submit}>
      <fieldset>
        <legend>Reinvesting</legend>
        <label>
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => {
              setEnabled(e.target.checked);
              setConfirming(false);
            }}
          />{' '}
          On: allow earnings to be turned into budget when I ask
        </label>
        <p className="small">
          Even when on, nothing happens by itself. Each budget is created only
          when you ask for it below, and never more than every limit allows.
        </p>
      </fieldset>
      <div className="two">
        <div>
          <label htmlFor="rp-share">
            Share of each sale&apos;s earnings (%)
          </label>
          <input
            id="rp-share"
            inputMode="decimal"
            value={share}
            onChange={(e) => {
              setShare(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div>
          <label htmlFor="rp-hold">Waiting period after a sale (days)</label>
          <input
            id="rp-hold"
            inputMode="numeric"
            value={holdback}
            onChange={(e) => {
              setHoldback(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div>
          <label htmlFor="rp-cap">Most per period (dollars)</label>
          <input
            id="rp-cap"
            inputMode="decimal"
            value={cap}
            onChange={(e) => {
              setCap(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div>
          <label htmlFor="rp-days">Period length (days)</label>
          <input
            id="rp-days"
            inputMode="numeric"
            value={periodDays}
            onChange={(e) => {
              setPeriodDays(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div>
          <label htmlFor="rp-reserve">Cash to keep in reserve (dollars)</label>
          <input
            id="rp-reserve"
            inputMode="decimal"
            value={reserve}
            onChange={(e) => {
              setReserve(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
      </div>
      <label htmlFor="rp-why">Why these values</label>
      <textarea
        id="rp-why"
        rows={2}
        maxLength={1200}
        value={rationale}
        onChange={(e) => setRationale(e.target.value)}
      />
      <p className="small">
        The share applies to what a sale earns after processor fees. The waiting
        period covers refunds and disputes. A new version applies from now on;
        earlier versions stay on record.
      </p>
      {problems.map((p) => (
        <p className="error" key={p}>
          {p}
        </p>
      ))}
      {confirming && complete && (
        <p className="notice" role="status">
          {policy?.enabled
            ? 'Allow more to be reinvested?'
            : 'Turn reinvesting on?'}{' '}
          Up to {share}% of each settled sale&apos;s earnings, after{' '}
          {holdbackDays} days, could become budget, at most {usd(capNano)} every{' '}
          {period} days, keeping {usd(reserveNano)} in reserve. You still decide
          each budget yourself.
        </p>
      )}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !complete}>
          {confirming
            ? policy?.enabled
              ? 'Yes, save these limits'
              : 'Yes, save and turn on'
            : 'Save policy'}
        </button>
        {confirming && (
          <button
            type="button"
            className="secondary"
            onClick={() => setConfirming(false)}
          >
            Not yet
          </button>
        )}
      </div>
    </form>
  );
}

function AllocateForm({
  capacity,
  base,
  session,
  busy,
  act,
  usd,
  portfolio,
}: Forms & { capacity: Capacity; portfolio: boolean }) {
  const [amount, setAmount] = useState('');
  const [name, setName] = useState('Reinvested earnings');
  const [target, setTarget] = useState<'standalone' | 'portfolio'>(
    'standalone',
  );
  const [maxInFlight, setMaxInFlight] = useState('1');
  const [partial, setPartial] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const request = useRequestKey('reinvest');
  const amountNano = usdToNano(amount);
  const inFlight = /^\d{1,2}$/.test(maxInFlight.trim())
    ? Number(maxInFlight)
    : null;
  const over =
    amountNano !== null && BigInt(amountNano) > BigInt(capacity.capacity_nano);
  const valid =
    !!amountNano &&
    BigInt(amountNano) > 0n &&
    (!over || partial) &&
    !!name.trim() &&
    inFlight !== null &&
    inFlight >= 1 &&
    inFlight <= 32;
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const body = {
      amount_nano_usd: amountNano,
      allow_partial: partial,
      envelope_name: name.trim(),
      max_in_flight: inFlight,
      target,
    };
    void act(async () => {
      const a = await api(z.unknown(), `${base}/reinvestment/allocations`, {
        csrf: session.csrf_token,
        body,
        idempotencyKey: request.key(body),
      });
      request.clear();
      const got = (a as { amount_nano_usd?: string }).amount_nano_usd;
      return `Created a budget of ${got ? usd(got) : 'the allowed amount'} from earnings.`;
    }).then((ok) => ok && setConfirming(false));
  }
  return (
    <form className="gh-form" onSubmit={submit}>
      <p className="small">
        Up to {usd(capacity.capacity_nano)} can become budget now. The server
        checks every limit again when you confirm.
      </p>
      <div className="two">
        <div>
          <label htmlFor="ra-amount">Amount (dollars)</label>
          <input
            id="ra-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div>
          <label htmlFor="ra-name">Budget name</label>
          <input
            id="ra-name"
            maxLength={200}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div>
          <label htmlFor="ra-target">Use it for</label>
          <select
            id="ra-target"
            value={target}
            onChange={(e) => {
              setTarget(e.target.value as 'standalone' | 'portfolio');
              setConfirming(false);
            }}
          >
            <option value="standalone">Its own budget</option>
            <option value="portfolio" disabled={!portfolio}>
              This workspace&apos;s portfolio runs
              {portfolio ? '' : ' (no portfolio policy)'}
            </option>
          </select>
        </div>
        <div>
          <label htmlFor="ra-flight">Most paid calls at once</label>
          <input
            id="ra-flight"
            inputMode="numeric"
            value={maxInFlight}
            onChange={(e) => {
              setMaxInFlight(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
      </div>
      <fieldset>
        <legend>If the amount is more than allowed</legend>
        <label>
          <input
            type="checkbox"
            checked={partial}
            onChange={(e) => {
              setPartial(e.target.checked);
              setConfirming(false);
            }}
          />{' '}
          Take what the limits allow instead of refusing
        </label>
      </fieldset>
      {amount.trim() && !amountNano && (
        <p className="error">Enter an amount in dollars, like 5 or 2.50.</p>
      )}
      {over && !partial && (
        <p className="error">
          That is more than the {usd(capacity.capacity_nano)} allowed now.
        </p>
      )}
      {(inFlight === null || inFlight < 1 || inFlight > 32) && (
        <p className="error">Most paid calls at once must be 1 to 32.</p>
      )}
      {confirming && valid && (
        <p className="notice" role="status">
          Create a budget of {usd(over ? capacity.capacity_nano : amountNano)}{' '}
          named &quot;{name.trim()}&quot; from earnings? This can&apos;t be
          undone. Spending from it still stays under your overall spending
          ceiling.
        </p>
      )}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !valid}>
          {confirming ? 'Yes, create the budget' : 'Review'}
        </button>
        {confirming && (
          <button
            type="button"
            className="secondary"
            onClick={() => setConfirming(false)}
          >
            Not yet
          </button>
        )}
      </div>
    </form>
  );
}

/** The most settled sales the server sends in one page. */
const TRANCHE_PAGE = 500;

function Tranches({
  tranches,
  now,
  usd,
}: {
  tranches: z.infer<typeof TrancheSchema>[];
  now: number;
  usd: (n: string) => ReactNode;
}) {
  if (tranches.length === 0)
    return (
      <p className="small">
        No settled sales yet. Each settled sale adds earnings here; pending
        payments, your own funding and payouts never do.
      </p>
    );
  // The server sends the newest settled first, at most 500 (audit L-9).
  const shown = tranches.slice(0, 10);
  return (
    <details>
      <summary>
        Earnings from settled sales (
        {tranches.length >= TRANCHE_PAGE
          ? `${TRANCHE_PAGE} or more`
          : tranches.length}
        {tranches.length > shown.length ? `, latest ${shown.length} shown` : ''}
        )
      </summary>
      <ul className="rows">
        {shown.map((t) => (
          <li key={t.id}>
            {usd(t.earned_nano)} earned · {usd(t.cap_nano)} may be reinvested ·{' '}
            {usd(t.consumed_nano)} used{' '}
            {t.disputed ? (
              <span className="badge warn">disputed</span>
            ) : Date.parse(t.eligible_at) > now ? (
              <span className="badge">waiting until {when(t.eligible_at)}</span>
            ) : (
              <span className="badge ok">eligible</span>
            )}
            <small> · settled {when(t.settled_at)}</small>
          </li>
        ))}
      </ul>
    </details>
  );
}

function RailRow({
  rail: r,
  state,
  owner,
  base,
  session,
  busy,
  act,
  usd,
  show,
}: Forms & {
  rail: Rail;
  state: { counts: boolean; note: string };
  owner: boolean;
}) {
  const [mode, setMode] = useState<'' | 'attest' | 'status'>('');
  const [amount, setAmount] = useState('');
  const [text, setText] = useState('');
  const amountNano = usdToNano(amount);
  const close = () => {
    setMode('');
    setAmount('');
    setText('');
  };
  const path = `${base}/funding-rails/${r.id}`;
  const nextStatus = r.status === 'available' ? 'unavailable' : 'available';
  return (
    <li>
      <div>
        <strong>{r.label}</strong>{' '}
        <span className={`badge ${state.counts ? 'ok' : 'warn'}`}>
          {state.counts ? 'counts' : 'not counted'}
        </span>
        <small>
          {' '}
          ·{' '}
          {r.kind === 'owner_attested'
            ? 'balance you record'
            : 'processor balance'}
          {r.available_nano !== null && <> · last {show(r.available_nano)}</>} ·{' '}
          {state.note}
        </small>
      </div>
      {owner && mode === '' && (
        <div className="actions">
          {r.kind === 'owner_attested' ? (
            <button
              className="secondary"
              disabled={busy}
              onClick={() => setMode('attest')}
            >
              Record balance…
            </button>
          ) : (
            <button
              className="secondary"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const o = await api(z.unknown(), `${path}/observe`, {
                    csrf: session.csrf_token,
                    body: {},
                  });
                  const n = (o as { available_nano?: string }).available_nano;
                  return `${r.label}: ${n ? `${usd(n)} available` : 'balance read'}.`;
                })
              }
            >
              Read balance
            </button>
          )}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => setMode('status')}
          >
            {r.status === 'available' ? 'Mark unavailable…' : 'Mark available…'}
          </button>
        </div>
      )}
      {mode === 'attest' && (
        <form
          className="gh-form"
          onSubmit={(e) => {
            e.preventDefault();
            if (!amountNano || !text.trim()) return;
            void act(async () => {
              await api(z.unknown(), `${path}/attest`, {
                csrf: session.csrf_token,
                body: {
                  available_nano_usd: amountNano,
                  evidence: text.trim(),
                },
              });
              close();
              return `${r.label}: ${usd(amountNano)} recorded; it counts for 24 hours.`;
            });
          }}
        >
          <div className="two">
            <div>
              <label htmlFor={`ra-${r.id}`}>Available now (dollars)</label>
              <input
                id={`ra-${r.id}`}
                inputMode="decimal"
                autoFocus
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`re-${r.id}`}>Where you checked</label>
              <input
                id={`re-${r.id}`}
                maxLength={1200}
                placeholder="Bank app, Oct 27 statement"
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </div>
          </div>
          {amount.trim() && !amountNano && (
            <p className="error">Enter an amount in dollars, like 120.</p>
          )}
          <div className="actions">
            <button
              className="primary"
              type="submit"
              disabled={busy || !amountNano || !text.trim()}
            >
              Record balance
            </button>
            <button type="button" className="secondary" onClick={close}>
              Cancel
            </button>
          </div>
        </form>
      )}
      {mode === 'status' && (
        <span
          className="confirm-inline"
          role="group"
          aria-label={`Mark ${r.label} ${nextStatus}`}
        >
          {nextStatus === 'unavailable'
            ? `Stop counting ${r.label}?`
            : `Count ${r.label} again? Only do this after checking it.`}
          <label className="inline" htmlFor={`rs-${r.id}`}>
            Why
          </label>
          <input
            id={`rs-${r.id}`}
            autoFocus
            maxLength={1200}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          <button className="secondary" onClick={close}>
            Cancel
          </button>
          <button
            className={`secondary ${nextStatus === 'unavailable' ? 'danger' : ''}`}
            disabled={busy || !text.trim()}
            onClick={() =>
              void act(async () => {
                await api(z.unknown(), `${path}/status`, {
                  csrf: session.csrf_token,
                  body: { status: nextStatus, reason: text.trim() },
                });
                close();
                return `${r.label} marked ${nextStatus}.`;
              })
            }
          >
            Mark {nextStatus}
          </button>
        </span>
      )}
    </li>
  );
}

function AddRail({
  connections,
  base,
  session,
  busy,
  act,
}: Forms & { connections: PaymentConnection[] }) {
  const [kind, setKind] = useState<'owner_attested' | 'processor_balance'>(
    'owner_attested',
  );
  const [label, setLabel] = useState('');
  const [connPick, setConnPick] = useState('');
  const connectionId = connections.some((c) => c.id === connPick)
    ? connPick
    : (connections[0]?.id ?? '');
  const processor = kind === 'processor_balance';
  const request = useRequestKey('rail');
  return (
    <form
      className="gh-form"
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          const body = {
            label: label.trim(),
            kind,
            connection_id: processor ? connectionId : null,
          };
          await api(z.unknown(), `${base}/funding-rails`, {
            csrf: session.csrf_token,
            body,
            idempotencyKey: request.key(body),
          });
          request.clear();
          return `${label.trim()} added. ${processor ? 'Read its balance' : 'Record its balance'} so it counts.`;
        });
      }}
    >
      <div className="two">
        <div>
          <label htmlFor="rl-kind">Kind</label>
          <select
            id="rl-kind"
            value={kind}
            onChange={(e) =>
              setKind(e.target.value as 'owner_attested' | 'processor_balance')
            }
          >
            <option value="owner_attested">
              An account whose balance I record
            </option>
            <option value="processor_balance" disabled={!connections.length}>
              A verified processor&apos;s balance
              {connections.length ? '' : ' (none without a source)'}
            </option>
          </select>
        </div>
        {processor && (
          <div>
            <label htmlFor="rl-conn">Processor</label>
            <select
              id="rl-conn"
              value={connectionId}
              onChange={(e) => setConnPick(e.target.value)}
            >
              {connections.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.body.label}
                </option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label htmlFor="rl-label">Name</label>
          <input
            id="rl-label"
            maxLength={200}
            placeholder={processor ? 'Processor balance' : 'Business checking'}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
      </div>
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || !label.trim() || (processor && !connectionId)}
        >
          Add funding source
        </button>
      </div>
    </form>
  );
}

function Commitments({
  commitments,
  owner,
  base,
  session,
  busy,
  act,
  show,
}: Forms & {
  commitments: z.infer<typeof CommitmentSchema>[];
  owner: boolean;
}) {
  const [closing, setClosing] = useState('');
  const open = commitments.filter((c) => c.status === 'open');
  const closed = commitments.filter((c) => c.status === 'closed');
  return (
    <>
      <p className="small">
        Open commitments are held back from usable cash until you close them.
      </p>
      {open.length === 0 ? (
        <Empty>Nothing owed or set aside.</Empty>
      ) : (
        <ul className="rows">
          {open.map((c) => (
            <li key={c.id}>
              <strong>{c.label}</strong> · {show(c.amount_nano_usd)}{' '}
              <span className="badge">{COMMITMENT_KIND[c.kind] ?? c.kind}</span>
              <small> · since {when(c.created_at)}</small>
              {owner &&
                (closing === c.id ? (
                  <span
                    className="confirm-inline"
                    role="group"
                    aria-label={`Close ${c.label}`}
                  >
                    {' '}
                    Close {c.label}? It stops being held back and can&apos;t be
                    reopened.
                    <button
                      className="secondary"
                      autoFocus
                      onClick={() => setClosing('')}
                    >
                      Keep
                    </button>
                    <button
                      className="secondary danger"
                      disabled={busy}
                      onClick={() =>
                        void act(async () => {
                          await api(
                            z.unknown(),
                            `${base}/commitments/${c.id}/close`,
                            { csrf: session.csrf_token, body: {} },
                          );
                          setClosing('');
                          return `${c.label} closed.`;
                        })
                      }
                    >
                      Close for good
                    </button>
                  </span>
                ) : (
                  <>
                    {' '}
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => setClosing(c.id)}
                    >
                      Close…
                    </button>
                  </>
                ))}
            </li>
          ))}
        </ul>
      )}
      {closed.length > 0 && (
        <details>
          <summary>Closed ({closed.length})</summary>
          <ul className="rows">
            {closed.map((c) => (
              <li key={c.id}>
                {c.label} · {show(c.amount_nano_usd)}
                <small>
                  {' '}
                  · {COMMITMENT_KIND[c.kind] ?? c.kind} · closed{' '}
                  {c.closed_at ? when(c.closed_at) : ''}
                </small>
              </li>
            ))}
          </ul>
        </details>
      )}
    </>
  );
}

function AddCommitment({ base, session, busy, act }: Forms) {
  const [kind, setKind] = useState<'reserve' | 'liability' | 'tax'>(
    'liability',
  );
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const amountNano = usdToNano(amount);
  const valid = !!label.trim() && !!amountNano && BigInt(amountNano) > 0n;
  const request = useRequestKey('commitment');
  return (
    <form
      className="gh-form"
      onSubmit={(e) => {
        e.preventDefault();
        if (!valid) return;
        void act(async () => {
          const body = {
            kind,
            label: label.trim(),
            amount_nano_usd: amountNano,
          };
          await api(z.unknown(), `${base}/commitments`, {
            csrf: session.csrf_token,
            body,
            idempotencyKey: request.key(body),
          });
          request.clear();
          return `${label.trim()} added; it is held back from usable cash.`;
        });
      }}
    >
      <div className="two">
        <div>
          <label htmlFor="cm-kind">Kind</label>
          <select
            id="cm-kind"
            value={kind}
            onChange={(e) =>
              setKind(e.target.value as 'reserve' | 'liability' | 'tax')
            }
          >
            {Object.entries(COMMITMENT_KIND).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="cm-label">What it is</label>
          <input
            id="cm-label"
            maxLength={200}
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="cm-amount">Amount (dollars)</label>
          <input
            id="cm-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </div>
      </div>
      {amount.trim() && (!amountNano || BigInt(amountNano) === 0n) && (
        <p className="error">Enter an amount above zero, like 40.</p>
      )}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !valid}>
          Add commitment
        </button>
      </div>
    </form>
  );
}

function OwnerFunding({ base, session, busy, act, usd }: Forms) {
  const [amount, setAmount] = useState('');
  const [evidence, setEvidence] = useState('');
  const [confirming, setConfirming] = useState(false);
  const request = useRequestKey('owner-funding');
  const amountNano = usdToNano(amount);
  const valid = !!amountNano && BigInt(amountNano) > 0n && !!evidence.trim();
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!valid) return;
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const body = { amount_nano_usd: amountNano, evidence: evidence.trim() };
    void act(async () => {
      await api(z.unknown(), `${base}/ledger/owner-funding`, {
        csrf: session.csrf_token,
        body,
        idempotencyKey: request.key(body),
      });
      request.clear();
      return `${usd(amountNano!)} recorded as your own funding.`;
    }).then((ok) => ok && setConfirming(false));
  }
  return (
    <form className="gh-form" onSubmit={submit}>
      <div className="two">
        <div>
          <label htmlFor="of-amount">Amount (dollars)</label>
          <input
            id="of-amount"
            inputMode="decimal"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
        <div>
          <label htmlFor="of-evidence">Where it came from</label>
          <input
            id="of-evidence"
            maxLength={1200}
            placeholder="Transfer from personal savings, Oct 27"
            value={evidence}
            onChange={(e) => {
              setEvidence(e.target.value);
              setConfirming(false);
            }}
          />
        </div>
      </div>
      {amount.trim() && (!amountNano || BigInt(amountNano) === 0n) && (
        <p className="error">Enter an amount above zero, like 100.</p>
      )}
      {confirming && valid && (
        <p className="notice" role="status">
          Record {usd(amountNano!)} as money you put in? Ledger entries
          can&apos;t be edited or removed afterwards.
        </p>
      )}
      <div className="actions">
        <button className="primary" type="submit" disabled={busy || !valid}>
          {confirming ? 'Yes, record it' : 'Review'}
        </button>
        {confirming && (
          <button
            type="button"
            className="secondary"
            onClick={() => setConfirming(false)}
          >
            Not yet
          </button>
        )}
      </div>
    </form>
  );
}
