import { randomBytes } from 'node:crypto';
import {
  BalanceSnapshotSchema,
  ContractError,
  PaymentSnapshotSchema,
  PayoutSnapshotSchema,
  parse,
  type BalanceSnapshot,
  type PaymentSnapshot,
  type PayoutSnapshot,
} from '@creator/contracts';
import { signWebhook } from '@creator/domain';

// X07 payment processor adapters: a deterministic fixture and a Stripe test-mode adapter.
// Adapters only observe and create checkout sessions; the store decides what any of it means.
// Every snapshot is re-validated, and a live-mode object is refused by the caller.

export interface CheckoutInput {
  offer_id: string;
  label: string;
  price_cents: number;
  customer_ref: string;
  success_url: string;
  cancel_url: string;
  idempotency_key: string;
}
export interface PaymentProcessor {
  readonly kind: 'fixture' | 'stripe';
  /** The account the credential belongs to, and whether the credential is live. */
  account(): Promise<{ id: string; livemode: boolean }>;
  createCheckout(
    i: CheckoutInput,
  ): Promise<{ session_id: string; url: string }>;
  payment(id: string): Promise<PaymentSnapshot>;
  payout(id: string): Promise<PayoutSnapshot>;
  balance(): Promise<BalanceSnapshot>;
}
/** The processor did not answer usably; nothing is inferred from silence. */
export class ProcessorUnavailable extends Error {}

/** Which object a verified event is about. The body's amounts and states are never used. */
export function eventSubject(
  event: Record<string, unknown>,
): { kind: 'payment' | 'payout'; id: string } | null {
  const data = event.data as { object?: Record<string, unknown> } | undefined;
  const o = data?.object;
  if (!o || typeof o.object !== 'string') return null;
  const str = (v: unknown) =>
    typeof v === 'string'
      ? v
      : v &&
          typeof v === 'object' &&
          typeof (v as { id?: unknown }).id === 'string'
        ? (v as { id: string }).id
        : null;
  switch (o.object) {
    case 'payment_intent':
      return str(o.id) ? { kind: 'payment', id: str(o.id)! } : null;
    case 'charge':
    case 'refund':
    case 'dispute': {
      const pi = str(o.payment_intent);
      return pi ? { kind: 'payment', id: pi } : null;
    }
    case 'payout':
      return str(o.id) ? { kind: 'payout', id: str(o.id)! } : null;
    default:
      return null;
  }
}

// ---- Fixture ----------------------------------------------------------------------------------

const rid = (p: string) => `${p}_fx${randomBytes(8).toString('hex')}`;
/**
 * A labelled in-memory processor for fixture workspaces and tests. It simulates a test-mode
 * account (fees 2.9% + 30 cents, fixture values) and signs events like the real one, so the
 * webhook path is exercised end to end. Nothing it reports is money.
 */
export class FixtureProcessor implements PaymentProcessor {
  readonly kind = 'fixture' as const;
  readonly payments = new Map<string, PaymentSnapshot>();
  readonly payouts = new Map<string, PayoutSnapshot>();
  readonly checkouts = new Map<string, CheckoutInput>();
  available = 0;
  pending = 0;
  /** Set to simulate an outage: every observation then fails. */
  down = false;
  livemode = false;
  constructor(readonly accountId = 'acct_fixture0001') {}
  #up() {
    if (this.down) throw new ProcessorUnavailable('Fixture processor is down.');
  }
  async account() {
    this.#up();
    return { id: this.accountId, livemode: this.livemode };
  }
  async createCheckout(i: CheckoutInput) {
    this.#up();
    const id = rid('cs');
    this.checkouts.set(id, i);
    return { session_id: id, url: `https://checkout.invalid/fixture/${id}` };
  }
  async payment(id: string) {
    this.#up();
    const p = this.payments.get(id);
    if (!p) throw new ContractError('NOT_FOUND', 'No such fixture payment.');
    return structuredClone(p);
  }
  async payout(id: string) {
    this.#up();
    const p = this.payouts.get(id);
    if (!p) throw new ContractError('NOT_FOUND', 'No such fixture payout.');
    return structuredClone(p);
  }
  async balance() {
    this.#up();
    return {
      livemode: this.livemode,
      available_cents: this.available,
      pending_cents: this.pending,
    };
  }
  /** A buyer completes checkout: captured, funds pending. */
  pay(session: string, amountCents?: number) {
    const c = this.checkouts.get(session);
    if (!c) throw new Error('unknown checkout');
    const amount = amountCents ?? c.price_cents;
    const fee = Math.round(amount * 0.029) + 30;
    const id = rid('pi');
    this.payments.set(id, {
      id,
      livemode: this.livemode,
      currency: 'usd',
      amount,
      status: 'succeeded',
      metadata: { offer_id: c.offer_id, customer_ref: c.customer_ref },
      charge: {
        id: rid('ch'),
        balance_transaction: {
          id: rid('txn'),
          amount,
          fee,
          net: amount - fee,
          status: 'pending',
          available_on: new Date(Date.now() + 2 * 86_400_000).toISOString(),
        },
      },
      refunds: [],
      disputes: [],
    });
    this.pending += amount - fee;
    return id;
  }
  /** Funds become available; `at` backdates settlement so holdbacks can be tested. */
  settle(pi: string, at = new Date()) {
    const bt = this.payments.get(pi)!.charge!.balance_transaction;
    if (bt.status === 'available') return;
    bt.status = 'available';
    bt.available_on = at.toISOString();
    this.pending -= bt.net;
    this.available += bt.net;
  }
  refund(pi: string, amount: number) {
    const p = this.payments.get(pi)!;
    const id = rid('re');
    p.refunds.push({ id, amount, status: 'succeeded' });
    this.available -= amount;
    return id;
  }
  dispute(pi: string, fee = 1500) {
    const p = this.payments.get(pi)!;
    const id = rid('dp');
    p.disputes.push({
      id,
      amount: p.amount,
      status: 'open',
      funds_amount: -p.amount,
      funds_fee: fee,
    });
    this.available -= p.amount + fee;
    return id;
  }
  closeDispute(pi: string, id: string, outcome: 'won' | 'lost') {
    const d = this.payments.get(pi)!.disputes.find((x) => x.id === id)!;
    d.status = outcome;
    if (outcome === 'won') {
      d.funds_amount += d.amount;
      this.available += d.amount;
    }
  }
  payoutNow(amount: number) {
    const id = rid('po');
    this.payouts.set(id, {
      id,
      livemode: this.livemode,
      currency: 'usd',
      amount,
      status: 'paid',
    });
    this.available -= amount;
    return id;
  }
  failPayout(id: string) {
    const p = this.payouts.get(id)!;
    if (p.status === 'paid') this.available += p.amount;
    p.status = 'failed';
  }
  /** A signed event naming an object, as the processor would deliver it. */
  event(
    type: string,
    object: Record<string, unknown>,
    secret: string,
    opts: { id?: string; t?: number; livemode?: boolean } = {},
  ) {
    const raw = Buffer.from(
      JSON.stringify({
        id: opts.id ?? rid('evt'),
        object: 'event',
        type,
        livemode: opts.livemode ?? this.livemode,
        created: Math.floor(Date.now() / 1000),
        data: { object },
      }),
    );
    const t = opts.t ?? Math.floor(Date.now() / 1000);
    return { raw, signature: signWebhook(raw, secret, t) };
  }
}

// ---- Stripe test mode -------------------------------------------------------------------------

const STRIPE_API = 'https://api.stripe.com';
/** Test-mode keys only. A live key is refused before any call is made. */
export const TEST_KEY = /^(?:sk|rk)_test_[A-Za-z0-9]{8,200}$/;

function form(data: Record<string, string | number>): URLSearchParams {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) p.append(k, String(v));
  return p;
}
type J = Record<string, unknown>;
const obj = (v: unknown): J =>
  v && typeof v === 'object' ? (v as J) : ({} as J);
const iso = (unix: unknown) => new Date(Number(unix ?? 0) * 1000).toISOString();

/**
 * Stripe REST adapter, test mode only (API host fixed; no version pinned, so the account's
 * default applies). Contract-checked against a local double; no live Stripe call has been
 * observed by this project.
 */
export class StripeTestProcessor implements PaymentProcessor {
  readonly kind = 'stripe' as const;
  readonly #key: string;
  readonly #fetch: typeof fetch;
  constructor(key: string, opts: { fetch?: typeof fetch } = {}) {
    if (!TEST_KEY.test(key))
      throw new ContractError(
        'LIVE_DISABLED',
        'Only Stripe test-mode keys are accepted; live activation is a separate owner decision.',
      );
    this.#key = key;
    this.#fetch = opts.fetch ?? fetch;
  }
  async #call(
    method: 'GET' | 'POST',
    path: string,
    body?: URLSearchParams,
    idempotency?: string,
  ): Promise<J> {
    let res: Response;
    try {
      res = await this.#fetch(`${STRIPE_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.#key}`,
          ...(body
            ? { 'Content-Type': 'application/x-www-form-urlencoded' }
            : {}),
          ...(idempotency ? { 'Idempotency-Key': idempotency } : {}),
        },
        ...(body ? { body: body.toString() } : {}),
        signal: AbortSignal.timeout(15_000),
        redirect: 'error',
      });
    } catch (e) {
      throw new ProcessorUnavailable(
        `Stripe unreachable: ${(e as Error).message}`,
      );
    }
    const data = obj(await res.json().catch(() => ({})));
    if (res.status === 404)
      throw new ContractError('NOT_FOUND', 'Stripe has no such object.');
    if (res.status === 401 || res.status === 403)
      throw new ContractError('ACCESS_DENIED', 'Stripe refused the test key.');
    if (!res.ok)
      throw new ProcessorUnavailable(
        `Stripe answered ${res.status}: ${String(obj(data.error).message ?? '').slice(0, 200)}`,
      );
    return data;
  }
  async account() {
    const a = await this.#call('GET', '/v1/account');
    // The key prefix decides the mode; the account object does not report it.
    return { id: String(a.id ?? ''), livemode: false };
  }
  async createCheckout(i: CheckoutInput) {
    const s = await this.#call(
      'POST',
      '/v1/checkout/sessions',
      form({
        mode: 'payment',
        success_url: i.success_url,
        cancel_url: i.cancel_url,
        client_reference_id: i.customer_ref,
        'line_items[0][quantity]': 1,
        'line_items[0][price_data][currency]': 'usd',
        'line_items[0][price_data][unit_amount]': i.price_cents,
        'line_items[0][price_data][product_data][name]': i.label,
        'metadata[offer_id]': i.offer_id,
        'payment_intent_data[metadata][offer_id]': i.offer_id,
        'payment_intent_data[metadata][customer_ref]': i.customer_ref,
      }),
      i.idempotency_key,
    );
    return { session_id: String(s.id), url: String(s.url) };
  }
  async payment(id: string): Promise<PaymentSnapshot> {
    const pi = await this.#call(
      'GET',
      `/v1/payment_intents/${encodeURIComponent(id)}?expand[]=latest_charge.balance_transaction`,
    );
    const refunds = await this.#call(
      'GET',
      `/v1/refunds?payment_intent=${encodeURIComponent(id)}&limit=100`,
    );
    const disputes = await this.#call(
      'GET',
      `/v1/disputes?payment_intent=${encodeURIComponent(id)}&limit=20`,
    );
    const charge = obj(pi.latest_charge);
    const bt = obj(charge.balance_transaction);
    const status = String(pi.status);
    return parse(PaymentSnapshotSchema, {
      id: pi.id,
      livemode: pi.livemode === true,
      currency: pi.currency,
      amount: pi.amount,
      status:
        status === 'succeeded' ||
        status === 'processing' ||
        status === 'canceled'
          ? status
          : status.startsWith('requires_')
            ? 'requires_payment'
            : 'failed',
      metadata: obj(pi.metadata),
      charge:
        typeof bt.id === 'string'
          ? {
              id: charge.id,
              balance_transaction: {
                id: bt.id,
                amount: bt.amount,
                fee: bt.fee,
                net: bt.net,
                status: bt.status === 'available' ? 'available' : 'pending',
                available_on: iso(bt.available_on),
              },
            }
          : null,
      refunds: ((refunds.data as J[] | undefined) ?? []).map((r) => ({
        id: r.id,
        amount: r.amount,
        status: ['pending', 'succeeded', 'failed', 'canceled'].includes(
          String(r.status),
        )
          ? r.status
          : 'pending',
      })),
      disputes: ((disputes.data as J[] | undefined) ?? []).map((d) => {
        const txns = (d.balance_transactions as J[] | undefined) ?? [];
        return {
          id: d.id,
          amount: d.amount,
          status:
            d.status === 'won' ? 'won' : d.status === 'lost' ? 'lost' : 'open',
          funds_amount: txns.reduce((s, t) => s + Number(t.amount ?? 0), 0),
          funds_fee: txns.reduce((s, t) => s + Number(t.fee ?? 0), 0),
        };
      }),
    });
  }
  async payout(id: string) {
    const p = await this.#call('GET', `/v1/payouts/${encodeURIComponent(id)}`);
    return parse(PayoutSnapshotSchema, {
      id: p.id,
      livemode: p.livemode === true,
      currency: p.currency,
      amount: p.amount,
      status: p.status,
    });
  }
  async balance() {
    const b = await this.#call('GET', '/v1/balance');
    const usd = (list: unknown) =>
      ((list as J[] | undefined) ?? [])
        .filter((x) => x.currency === 'usd')
        .reduce((s, x) => s + Number(x.amount ?? 0), 0);
    return parse(BalanceSnapshotSchema, {
      livemode: b.livemode === true,
      available_cents: usd(b.available),
      pending_cents: usd(b.pending),
    });
  }
}
