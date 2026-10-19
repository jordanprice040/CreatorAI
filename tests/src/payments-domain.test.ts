import test from 'node:test';
import assert from 'node:assert/strict';
import type { PaymentSnapshot } from '@creator/contracts';
import {
  NANO_PER_CENT,
  consume,
  correction,
  entitlementFor,
  nextEntitlementStatus,
  paymentEconomics,
  paymentEntries,
  payoutEntries,
  periodStart,
  signWebhook,
  sum,
  tightest,
  trancheCap,
  verifyWebhook,
} from '@creator/domain';
import { StripeTestProcessor, eventSubject } from '@creator/broker';

// X07 pure rules: webhook signatures, ledger postings by economic key, entitlement states and
// reinvestment arithmetic. No processor or database is involved.
const SECRET = 'whsec_fixture_0123456789';
const raw = Buffer.from('{"id":"evt_1","object":"event"}');

test('webhook signatures: valid, tampered, wrong secret, stale and rotated secrets', () => {
  const now = 1_800_000_000;
  const header = signWebhook(raw, SECRET, now);
  assert.deepEqual(verifyWebhook(header, raw, SECRET, now), {
    ok: true,
    t: now,
  });
  assert.equal(
    verifyWebhook(header, Buffer.from(`${raw} `), SECRET, now).ok,
    false,
  );
  assert.deepEqual(verifyWebhook(header, raw, 'whsec_other', now), {
    ok: false,
    reason: 'signature_mismatch',
  });
  // The timestamp is inside the signed payload, so it cannot be refreshed by a replayer.
  assert.deepEqual(verifyWebhook(header, raw, SECRET, now + 301), {
    ok: false,
    reason: 'signature_expired',
  });
  const forgedTime = header.replace(`t=${now}`, `t=${now + 400}`);
  assert.deepEqual(verifyWebhook(forgedTime, raw, SECRET, now + 400), {
    ok: false,
    reason: 'signature_mismatch',
  });
  // During a secret roll the processor sends one signature per active secret.
  const other = signWebhook(raw, 'whsec_old', now).split(',')[1];
  assert.equal(
    verifyWebhook(`${header},${other}`, raw, 'whsec_old', now).ok,
    true,
  );
  assert.deepEqual(verifyWebhook(null, raw, SECRET, now), {
    ok: false,
    reason: 'missing_signature',
  });
  assert.deepEqual(verifyWebhook('v1=zz', raw, SECRET, now), {
    ok: false,
    reason: 'malformed_signature',
  });
});

const base = (over: Partial<PaymentSnapshot> = {}): PaymentSnapshot => ({
  id: 'pi_1',
  livemode: false,
  currency: 'usd',
  amount: 1000,
  status: 'succeeded',
  metadata: { offer_id: 'offer-1', customer_ref: 'cust-1' },
  charge: {
    id: 'ch_1',
    balance_transaction: {
      id: 'txn_1',
      amount: 1000,
      fee: 59,
      net: 941,
      status: 'available',
      available_on: '2026-10-01T00:00:00.000Z',
    },
  },
  refunds: [],
  disputes: [],
  ...over,
});

test('ledger postings balance per economic key and corrections bring a key to the new state', () => {
  const settled = paymentEntries('c:pi_1', base());
  assert.deepEqual([...settled.keys()].sort(), [
    'c:pi_1:charge:ch_1',
    'c:pi_1:settle:txn_1',
  ]);
  for (const e of settled.values()) assert.equal(sum(e.postings), 0n);
  const charge = settled.get('c:pi_1:charge:ch_1')!.postings;
  assert.equal(charge.get('revenue'), -1000n * NANO_PER_CENT);
  assert.equal(charge.get('processing_fees'), 59n * NANO_PER_CENT);
  // A refund and a dispute withdrawal with its fee, then the dispute reinstated (won).
  const disputed = base({
    refunds: [{ id: 're_1', amount: 200, status: 'succeeded' }],
    disputes: [
      {
        id: 'dp_1',
        amount: 800,
        status: 'open',
        funds_amount: -800,
        funds_fee: 1500,
      },
    ],
  });
  const d = paymentEntries('c:pi_1', disputed);
  for (const e of d.values()) assert.equal(sum(e.postings), 0n);
  const won = paymentEntries('c:pi_1', {
    ...disputed,
    disputes: [{ ...disputed.disputes[0]!, status: 'won', funds_amount: 0 }],
  });
  const fix = correction(
    won.get('c:pi_1:dispute:dp_1')!.postings,
    d.get('c:pi_1:dispute:dp_1')!.postings,
  );
  assert.equal(sum(fix), 0n);
  assert.equal(fix.get('dispute_losses'), -800n * NANO_PER_CENT);
  assert.equal(fix.get('processor_available'), 800n * NANO_PER_CENT);
  // Unchanged state needs nothing; a vanished entry is reversed in full.
  assert.equal(correction(charge, charge).size, 0);
  assert.equal(sum(correction(new Map(), charge)), 0n);
  // Pending funds stay pending; a failed refund produces no entry.
  const pending = paymentEntries('k', {
    ...base(),
    charge: {
      ...base().charge!,
      balance_transaction: {
        ...base().charge!.balance_transaction,
        status: 'pending',
      },
    },
    refunds: [{ id: 're_2', amount: 10, status: 'failed' }],
  });
  assert.deepEqual([...pending.keys()], ['k:charge:ch_1']);
  // Payouts are transfers: bank up, processor balance down, no income account touched.
  const paid = payoutEntries('k', {
    id: 'po_1',
    livemode: false,
    currency: 'usd',
    amount: 500,
    status: 'paid',
  }).get('k:payout:po_1')!.postings;
  assert.deepEqual([...paid.keys()].sort(), ['bank', 'processor_available']);
  assert.equal(
    payoutEntries('k', {
      id: 'po_1',
      livemode: false,
      currency: 'usd',
      amount: 500,
      status: 'failed',
    }).size,
    0,
  );
});

test('entitlements follow verified payment state only', () => {
  const offer = { id: 'offer-1', price_nano: 1000n * NANO_PER_CENT };
  assert.equal(entitlementFor(base(), offer)?.status, 'active');
  assert.equal(entitlementFor(base({ amount: 999 }), offer), null);
  assert.equal(entitlementFor(base({ currency: 'eur' }), offer), null);
  assert.equal(entitlementFor(base({ status: 'processing' }), offer), null);
  assert.equal(
    entitlementFor(base({ metadata: { offer_id: 'other' } }), offer),
    null,
  );
  assert.equal(
    entitlementFor(
      base({ refunds: [{ id: 're_1', amount: 1, status: 'succeeded' }] }),
      offer,
    )?.status,
    'revoked',
  );
  const open = base({
    disputes: [
      {
        id: 'dp_1',
        amount: 1000,
        status: 'open',
        funds_amount: -1000,
        funds_fee: 15,
      },
    ],
  });
  assert.equal(entitlementFor(open, offer)?.status, 'suspended');
  assert.equal(
    entitlementFor(
      { ...open, disputes: [{ ...open.disputes[0]!, status: 'lost' }] },
      offer,
    )?.status,
    'revoked',
  );
  assert.equal(nextEntitlementStatus('revoked', 'active'), 'revoked');
  assert.equal(nextEntitlementStatus('suspended', 'active'), 'active');
});

test('reinvestment arithmetic: caps round down, losses lower them, partial use keeps the rest', () => {
  const e = paymentEconomics(
    base({ refunds: [{ id: 're_1', amount: 100, status: 'succeeded' }] }),
  );
  assert.equal(e.earned, 941n * NANO_PER_CENT);
  assert.equal(e.loss, 100n * NANO_PER_CENT);
  assert.equal(trancheCap(941n, 0n, 5000), 470n);
  assert.equal(trancheCap(941n, 941n, 5000), 0n);
  assert.equal(trancheCap(941n, 2000n, 10_000), 0n);
  const c = consume(
    [
      { id: 'a', remaining: 30n },
      { id: 'b', remaining: 50n },
    ],
    45n,
  );
  assert.deepEqual(c, {
    uses: [
      { tranche_id: 'a', amount: 30n },
      { tranche_id: 'b', amount: 15n },
    ],
    shortfall: 0n,
  });
  assert.equal(consume([{ id: 'a', remaining: 5n }], 9n).shortfall, 4n);
  assert.deepEqual(
    tightest([
      { name: 'x', value: 10n },
      { name: 'y', value: -3n },
    ]),
    { capacity: 0n, binding: 'y' },
  );
  const anchor = Date.parse('2026-01-01T00:00:00Z');
  assert.equal(
    periodStart(anchor, 30, Date.parse('2026-02-05T00:00:00Z')).toISOString(),
    '2026-01-31T00:00:00.000Z',
  );
});

test('the Stripe adapter refuses live keys and events name objects, not amounts', () => {
  assert.throws(
    () => new StripeTestProcessor('sk_live_abcdefghijklmnop'),
    /test-mode keys/,
  );
  assert.throws(() => new StripeTestProcessor('pk_test_abcdefgh'), /test-mode/);
  assert.ok(new StripeTestProcessor('sk_test_abcdefghijk'));
  assert.deepEqual(
    eventSubject({
      data: {
        object: {
          object: 'refund',
          id: 're_1',
          payment_intent: 'pi_9',
          amount: 1,
        },
      },
    }),
    { kind: 'payment', id: 'pi_9' },
  );
  assert.deepEqual(
    eventSubject({
      data: { object: { object: 'charge', payment_intent: { id: 'pi_8' } } },
    }),
    { kind: 'payment', id: 'pi_8' },
  );
  assert.equal(
    eventSubject({ data: { object: { object: 'customer', id: 'cus_1' } } }),
    null,
  );
});
