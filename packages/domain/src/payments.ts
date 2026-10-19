import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  LedgerAccount,
  PaymentSnapshot,
  PayoutSnapshot,
} from '@creator/contracts';

// X07 rules for payments, entitlements and reinvestment. Pure functions over authoritative
// processor snapshots: the store records and locks, these decide amounts and states.

/** One US cent in nano-USD. */
export const NANO_PER_CENT = 10_000_000n;
/** Seconds a signed webhook stays acceptable (the processor libraries' default). */
export const SIGNATURE_TOLERANCE_S = 300;

export type Postings = Map<LedgerAccount, bigint>;

/** The processor's signed-payload scheme: HMAC-SHA256 over `${t}.${raw body}`, hex. */
export function signWebhook(raw: Buffer, secret: string, t: number) {
  const v1 = createHmac('sha256', secret)
    .update(`${t}.`)
    .update(raw)
    .digest('hex');
  return `t=${t},v1=${v1}`;
}
export function verifyWebhook(
  header: string | null,
  raw: Buffer,
  secret: string,
  nowS: number,
  toleranceS = SIGNATURE_TOLERANCE_S,
): { ok: true; t: number } | { ok: false; reason: string } {
  if (!header) return { ok: false, reason: 'missing_signature' };
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(',')) {
    const at = part.indexOf('=');
    if (at < 1) continue;
    const k = part.slice(0, at).trim();
    const v = part.slice(at + 1).trim();
    if (k === 't' && /^[0-9]{1,12}$/.test(v)) t = Number(v);
    if (k === 'v1' && /^[a-f0-9]{64}$/.test(v)) v1.push(v);
  }
  if (t === null || v1.length === 0)
    return { ok: false, reason: 'malformed_signature' };
  const expected = Buffer.from(
    signWebhook(raw, secret, t).slice(`t=${t},v1=`.length),
    'hex',
  );
  if (!v1.some((s) => timingSafeEqual(Buffer.from(s, 'hex'), expected)))
    return { ok: false, reason: 'signature_mismatch' };
  // The timestamp is signed, so an old capture cannot be replayed with a new one.
  if (Math.abs(nowS - t) > toleranceS)
    return { ok: false, reason: 'signature_expired' };
  return { ok: true, t };
}

const nano = (c: number) => BigInt(c) * NANO_PER_CENT;
function postings(...rows: [LedgerAccount, bigint][]): Postings {
  const out: Postings = new Map();
  for (const [a, v] of rows) if (v !== 0n) out.set(a, (out.get(a) ?? 0n) + v);
  for (const [a, v] of out) if (v === 0n) out.delete(a);
  return out;
}
export function sum(p: Postings) {
  let s = 0n;
  for (const v of p.values()) s += v;
  return s;
}

/**
 * The ledger a payment snapshot implies, by economic key. Keys name the underlying economic
 * transaction (charge settlement, refund, dispute), so two webhook events about the same
 * transaction, or events in any order, converge on the same entries.
 */
export function paymentEntries(prefix: string, s: PaymentSnapshot) {
  const out = new Map<string, { memo: string; postings: Postings }>();
  const bt = s.status === 'succeeded' ? s.charge?.balance_transaction : null;
  if (bt) {
    out.set(`${prefix}:charge:${s.charge!.id}`, {
      memo: `Payment ${s.id} captured; fees as the processor reported them.`,
      postings: postings(
        ['processor_pending', nano(bt.net)],
        ['processing_fees', nano(bt.fee)],
        ['revenue', -nano(bt.amount)],
      ),
    });
    if (bt.status === 'available')
      out.set(`${prefix}:settle:${bt.id}`, {
        memo: `Funds for ${s.id} became available at the processor.`,
        postings: postings(
          ['processor_available', nano(bt.net)],
          ['processor_pending', -nano(bt.net)],
        ),
      });
  }
  for (const r of s.refunds)
    if (r.status === 'succeeded')
      out.set(`${prefix}:refund:${r.id}`, {
        memo: `Refund ${r.id} of ${s.id}.`,
        postings: postings(
          ['refunds', nano(r.amount)],
          ['processor_available', -nano(r.amount)],
        ),
      });
  for (const d of s.disputes)
    out.set(`${prefix}:dispute:${d.id}`, {
      memo: `Dispute ${d.id} of ${s.id} (${d.status}); withdrawals and reinstatements net.`,
      postings: postings(
        ['dispute_losses', -nano(d.funds_amount)],
        ['dispute_fees', nano(d.funds_fee)],
        ['processor_available', nano(d.funds_amount) - nano(d.funds_fee)],
      ),
    });
  return out;
}
/** Payouts move available funds to the bank. They are never earnings. */
export function payoutEntries(prefix: string, p: PayoutSnapshot) {
  const out = new Map<string, { memo: string; postings: Postings }>();
  if (p.status === 'paid')
    out.set(`${prefix}:payout:${p.id}`, {
      memo: `Payout ${p.id} paid to the bank.`,
      postings: postings(
        ['bank', nano(p.amount)],
        ['processor_available', -nano(p.amount)],
      ),
    });
  return out;
}
/** What must be posted so the key's total equals the desired postings (empty: nothing). */
export function correction(desired: Postings, current: Postings): Postings {
  const out: Postings = new Map();
  for (const a of new Set([...desired.keys(), ...current.keys()])) {
    const d = (desired.get(a) ?? 0n) - (current.get(a) ?? 0n);
    if (d !== 0n) out.set(a, d);
  }
  return out;
}

/** Earnings and losses of one payment as the processor reports them, in nano-USD. */
export function paymentEconomics(s: PaymentSnapshot) {
  const bt = s.status === 'succeeded' ? s.charge?.balance_transaction : null;
  // A small payment can cost more in fees than it earns. Preserve that deficit
  // as a loss rather than inserting negative earnings or dropping the payment.
  const net = bt ? nano(bt.net) : 0n;
  let loss = net < 0n ? -net : 0n;
  let refunded = 0n;
  for (const r of s.refunds)
    if (r.status === 'succeeded') refunded += nano(r.amount);
  loss += refunded;
  for (const d of s.disputes) loss += -nano(d.funds_amount) + nano(d.funds_fee);
  return {
    captured: bt !== null && bt !== undefined,
    settled: bt?.status === 'available',
    settled_at: bt?.status === 'available' ? bt.available_on : null,
    earned: net > 0n ? net : 0n,
    refunded,
    loss: loss > 0n ? loss : 0n,
    dispute_open: s.disputes.some((d) => d.status === 'open'),
    dispute_lost: s.disputes.some((d) => d.status === 'lost'),
  };
}

export interface OfferTerms {
  id: string;
  price_nano: bigint;
}
/**
 * Access follows verified payment state only: a captured payment of exactly the offer's
 * price in USD. Any refund or lost dispute revokes; an open dispute suspends.
 */
export function entitlementFor(
  s: PaymentSnapshot,
  offer: OfferTerms,
): { status: 'active' | 'suspended' | 'revoked'; reason: string } | null {
  if (s.metadata.offer_id !== offer.id) return null;
  const e = paymentEconomics(s);
  if (!e.captured) return null;
  if (
    s.currency !== 'usd' ||
    nano(s.amount) !== offer.price_nano ||
    s.charge?.balance_transaction.amount !== s.amount
  )
    return null;
  if (e.refunded > 0n)
    return { status: 'revoked', reason: 'The payment was refunded.' };
  if (e.dispute_lost)
    return { status: 'revoked', reason: 'The payment dispute was lost.' };
  if (e.dispute_open)
    return { status: 'suspended', reason: 'The payment is under dispute.' };
  return { status: 'active', reason: 'Payment verified with the processor.' };
}
/** A revoked entitlement stays revoked; other statuses follow the payment. */
export function nextEntitlementStatus(
  current: 'active' | 'suspended' | 'revoked' | null,
  wanted: 'active' | 'suspended' | 'revoked',
) {
  return current === 'revoked' ? 'revoked' : wanted;
}

/** The reinvestable share of a payment's retained earnings, rounded down. */
export function trancheCap(earned: bigint, loss: bigint, bps: number) {
  const retained = earned - loss;
  return retained > 0n ? (retained * BigInt(bps)) / 10_000n : 0n;
}

export interface Bound {
  name: string;
  value: bigint;
}
/** The least bound, never below zero, and its name (ties go to the first listed). */
export function tightest(bounds: Bound[]): {
  capacity: bigint;
  binding: string;
} {
  let best = bounds[0]!;
  for (const b of bounds) if (b.value < best.value) best = b;
  return { capacity: best.value > 0n ? best.value : 0n, binding: best.name };
}
/** Start of the policy period containing `now`. */
export function periodStart(
  anchorMs: number,
  periodDays: number,
  nowMs: number,
) {
  const len = periodDays * 86_400_000;
  const k = Math.floor((nowMs - anchorMs) / len);
  return new Date(anchorMs + Math.max(0, k) * len);
}
/** Oldest-first consumption; the last tranche may be used in part, keeping its remainder. */
export function consume(
  tranches: { id: string; remaining: bigint }[],
  amount: bigint,
) {
  const uses: { tranche_id: string; amount: bigint }[] = [];
  let left = amount;
  for (const t of tranches) {
    if (left === 0n) break;
    const take = t.remaining < left ? t.remaining : left;
    if (take > 0n) uses.push({ tranche_id: t.id, amount: take });
    left -= take;
  }
  return { uses, shortfall: left };
}
