import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  type ErrorCode,
  type PaymentConnection,
} from '@creator/contracts';
import { NANO_PER_CENT } from '@creator/domain';
import { PortfolioStore, type CommandContext } from '@creator/db';
import {
  FixtureProcessor,
  PaymentService,
  StripeTestProcessor,
} from '@creator/broker';
import { freshDatabase } from './pg-harness.js';
import { verifiedRelease } from './payments-harness.js';
import { portfolioFixture } from './portfolio-harness.js';

// X07 acceptance on the labelled fixture processor (no live or test-mode Stripe call is made
// here): duplicate and out-of-order events, redirects, refunds and disputes after
// reinvestment, partial and concurrent allocations, and unavailable funding rails.
const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const editor: CommandContext = { actorId: randomUUID() };
const hook: CommandContext = { actorId: randomUUID() };
const SECRET = 'whsec_fixture_secret_0123456789';
const ENV = { CREATOR_PAYMENTS_HOOK: SECRET };
const c = (cents: number) => BigInt(cents) * NANO_PER_CENT;

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  // The full store, so portfolio policy and payments meet in one workspace.
  const store = new PortfolioStore(db.pool);
  for (const [a, kind] of [
    [owner, 'human'],
    [editor, 'human'],
    [hook, 'system'],
  ] as const)
    await store.ensureActor({ id: a.actorId, kind, display_name: kind });
  const processors = new Map<string, FixtureProcessor>();
  const service = new PaymentService(store, {
    env: ENV,
    fixture: (conn) => {
      let p = processors.get(conn.id);
      if (!p) {
        p = new FixtureProcessor('acct_fixture0001');
        processors.set(conn.id, p);
      }
      return p;
    },
  });
  async function workspace(mode: 'fixture' | 'real' = 'fixture') {
    const ws = await store.createWorkspace(owner, {
      name: `Payments ${mode}`,
      record_mode: mode,
    });
    await store.addMember(owner, ws.id, editor.actorId, 'editor');
    return ws.id;
  }
  async function connected(ws: string, account = 'acct_fixture0001') {
    const conn = await store.registerPaymentConnection(owner, ws, {
      label: 'Fixture processor',
      processor: 'fixture',
      mode: 'fixture',
      account_id: account,
      secret_key_env: null,
      webhook_secret_env: 'CREATOR_PAYMENTS_HOOK',
    });
    const verified = await service.verify(owner, ws, conn.id);
    return { conn: verified, fx: processors.get(conn.id)! };
  }
  async function offer(ws: string, conn: PaymentConnection, cents = 1000) {
    const release = await verifiedRelease(store, db!.pool, ws, owner);
    const o = await store.createOffer(owner, ws, {
      connection_id: conn.id,
      artifact_id: release.artifact_id,
      manifest_sha256: release.manifest_sha256,
      label: 'Fixture app',
      price_nano_usd: c(cents).toString(),
    });
    return { offer: o, release };
  }
  /** Buyer pays through checkout; returns the processor's payment id. */
  async function sale(
    ws: string,
    fx: FixtureProcessor,
    offerId: string,
    customer: string,
  ) {
    const co = await service.checkout(owner, ws, {
      offer_id: offerId,
      customer_ref: customer,
      success_url: 'http://127.0.0.1:5173/thanks',
      cancel_url: 'http://127.0.0.1:5173/cancel',
    });
    assert.equal(co.state, 'open');
    return fx.pay(co.processor_session_id!);
  }
  const deliver = (
    conn: PaymentConnection,
    fx: FixtureProcessor,
    type: string,
    object: Record<string, unknown>,
    opts: { id?: string; t?: number; livemode?: boolean; secret?: string } = {},
  ) => {
    const e = fx.event(type, object, opts.secret ?? SECRET, opts);
    return service.receiveWebhook(hook, conn.id, e.signature, e.raw);
  };
  const balances = async (ws: string) =>
    (await store.ledgerBalances(owner, ws)).balances;
  return {
    db,
    store,
    service,
    workspace,
    connected,
    offer,
    sale,
    deliver,
    balances,
  };
}

test('X07 redirects never grant; duplicate and out-of-order events converge on one ledger; refunds and disputes change access', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, service } = s;
  await rejects('LIVE_DISABLED', s.connected(await s.workspace('real')));
  const ws = await s.workspace();
  // Wrong account never activates; only the owner registers.
  await rejects(
    'ACCESS_DENIED',
    store.registerPaymentConnection(editor, ws, {
      label: 'x',
      processor: 'fixture',
      mode: 'fixture',
      account_id: 'acct_fixture0001',
      secret_key_env: null,
      webhook_secret_env: 'CREATOR_PAYMENTS_HOOK',
    }),
  );
  const wrong = await s.connected(ws, 'acct_someoneelse');
  assert.equal(wrong.conn.status, 'rejected');
  assert.equal(wrong.conn.verification?.result, 'wrong_account');
  await rejects('INVALID_TRANSITION', s.offer(ws, wrong.conn));
  const { conn, fx } = await s.connected(ws);
  assert.equal(conn.status, 'active');
  const { offer, release } = await s.offer(ws, conn, 1000);
  await rejects(
    'EVIDENCE_MISMATCH',
    store.createOffer(owner, ws, {
      connection_id: conn.id,
      artifact_id: release.artifact_id,
      manifest_sha256: 'f'.repeat(64),
      label: 'x',
      price_nano_usd: c(10).toString(),
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    store.createOffer(owner, ws, {
      connection_id: conn.id,
      artifact_id: release.artifact_id,
      manifest_sha256: release.manifest_sha256,
      label: 'x',
      price_nano_usd: '15',
    }),
  );

  const pi = await s.sale(ws, fx, offer.id, 'cust-a');
  // The buyer lands on the success page: nothing is granted until the backend reads payment.
  const before = await store.checkEntitlement(
    owner,
    ws,
    release.artifact_id,
    'cust-a',
  );
  assert.equal(before.granted, false);
  // A forged event (wrong secret), a stale one and a live-mode one are all refused.
  assert.equal(
    (
      await s.deliver(
        conn,
        fx,
        'payment_intent.succeeded',
        { object: 'payment_intent', id: pi },
        { secret: 'whsec_attacker' },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await s.deliver(
        conn,
        fx,
        'payment_intent.succeeded',
        { object: 'payment_intent', id: pi },
        { t: Math.floor(Date.now() / 1000) - 900 },
      )
    ).status,
    400,
  );
  assert.equal(
    (
      await s.deliver(
        conn,
        fx,
        'payment_intent.succeeded',
        { object: 'payment_intent', id: pi },
        { livemode: true },
      )
    ).status,
    400,
  );
  assert.deepEqual(await s.balances(ws), {});
  // The processor is down: the delivery is refused for retry and records no money.
  fx.down = true;
  const deferred = await s.deliver(
    conn,
    fx,
    'payment_intent.succeeded',
    { object: 'payment_intent', id: pi },
    { id: 'evt_first' },
  );
  assert.equal(deferred.status, 503);
  assert.deepEqual(await s.balances(ws), {});
  fx.down = false;
  // An event body claiming a different amount is ignored: only the backend read counts.
  const first = await s.deliver(
    conn,
    fx,
    'payment_intent.succeeded',
    { object: 'payment_intent', id: pi, amount: 999999 },
    { id: 'evt_first' },
  );
  assert.equal(first.status, 200);
  assert.equal((first.body as { outcome: string }).outcome, 'applied');
  assert.equal(
    (await store.checkEntitlement(owner, ws, release.artifact_id, 'cust-a'))
      .granted,
    true,
  );
  // Same event again, and a second distinct event about the same charge: no new money.
  assert.equal(
    (
      await s.deliver(
        conn,
        fx,
        'payment_intent.succeeded',
        { object: 'payment_intent', id: pi },
        { id: 'evt_first' },
      )
    ).body.outcome,
    'duplicate',
  );
  const again = await s.deliver(
    conn,
    fx,
    'charge.succeeded',
    { object: 'charge', id: 'ch_x', payment_intent: pi },
    { id: 'evt_second' },
  );
  assert.equal((again.body as { posted: number }).posted, 0);
  const fee = 30 + 29; // fixture fee: 2.9% + 30 cents
  assert.deepEqual(await s.balances(ws), {
    processing_fees: c(fee).toString(),
    processor_pending: c(1000 - fee).toString(),
    revenue: c(-1000).toString(),
  });

  // Out of order: the refund event arrives before the settlement event for a second sale.
  const pi2 = await s.sale(ws, fx, offer.id, 'cust-b');
  fx.settle(pi2);
  const re = fx.refund(pi2, 1000);
  await s.deliver(conn, fx, 'refund.created', {
    object: 'refund',
    id: re,
    payment_intent: pi2,
  });
  await s.deliver(conn, fx, 'payment_intent.succeeded', {
    object: 'payment_intent',
    id: pi2,
  });
  const b = await s.balances(ws);
  assert.equal(b.refunds, c(1000).toString());
  assert.equal(b.revenue, c(-2000).toString());
  assert.equal((await store.ledgerBalances(owner, ws)).total_nano, '0');
  // A refunded buyer never got access; the earlier buyer still has it.
  assert.equal(
    (await store.checkEntitlement(owner, ws, release.artifact_id, 'cust-b'))
      .granted,
    false,
  );
  const ents = await store.listEntitlements(owner, ws);
  assert.deepEqual(ents.map((e) => [e.customer_ref, e.status]).sort(), [
    ['cust-a', 'active'],
    ['cust-b', 'revoked'],
  ]);

  // Dispute: suspended while open, active again when won, ledger corrected (not edited).
  const dp = fx.dispute(pi);
  await s.deliver(conn, fx, 'charge.dispute.created', {
    object: 'dispute',
    id: dp,
    payment_intent: pi,
  });
  assert.equal(
    (await store.checkEntitlement(owner, ws, release.artifact_id, 'cust-a'))
      .granted,
    false,
  );
  fx.closeDispute(pi, dp, 'won');
  await service.reconcilePayment(owner, ws, conn.id, pi);
  assert.equal(
    (await store.checkEntitlement(owner, ws, release.artifact_id, 'cust-a'))
      .granted,
    true,
  );
  const ledger = await store.listLedger(owner, ws);
  const disputeEntries = ledger.filter((e) =>
    e.economic_key.includes(':dispute:'),
  );
  assert.deepEqual(
    disputeEntries.map((e) => [e.revision, e.kind]),
    [
      [1, 'original'],
      [2, 'correction'],
    ],
  );
  assert.equal((await s.balances(ws)).dispute_losses, undefined);
  assert.equal((await store.ledgerBalances(owner, ws)).total_nano, '0');
  // Payouts move money to the bank and are not revenue; a failed payout is reversed.
  const po = fx.payoutNow(500);
  await s.deliver(conn, fx, 'payout.paid', { object: 'payout', id: po });
  assert.equal((await s.balances(ws)).bank, c(500).toString());
  fx.failPayout(po);
  await s.deliver(conn, fx, 'payout.failed', { object: 'payout', id: po });
  assert.equal((await s.balances(ws)).bank, undefined);
  assert.equal((await s.balances(ws)).revenue, c(-2000).toString());

  // The ledger cannot be edited or unbalanced, even directly.
  await assert.rejects(
    s.db.pool.query('update finance_postings set amount_nano = 1'),
  );
  await assert.rejects(
    (async () => {
      const client = await s.db.pool.connect();
      try {
        await client.query('begin');
        const id = randomUUID();
        const ev = (await client.query('select id from audit_events limit 1'))
          .rows[0].id;
        await client.query(
          `insert into finance_entries (id, workspace_id, economic_key, revision, kind, memo,
             actor_id, event_id) values ($1,$2,'forged',1,'original','x',$3,$4)`,
          [id, ws, owner.actorId, ev],
        );
        await client.query(
          `insert into finance_postings values ($1,'bank',100), ($1,'revenue',-99)`,
          [id],
        );
        await client.query('commit');
      } finally {
        await client.query('rollback').catch(() => undefined);
        client.release();
      }
    })(),
    /unbalanced/,
  );
  // Revoked connections stop accepting events.
  await store.revokePaymentConnection(owner, ws, conn.id, {
    expected_version: (await store.getPaymentConnection(owner, ws, conn.id))
      .version,
    reason: 'Done.',
  });
  assert.equal(
    (
      await s.deliver(conn, fx, 'payment_intent.succeeded', {
        object: 'payment_intent',
        id: pi,
      })
    ).status,
    409,
  );
  const events = await store.listPaymentEvents(owner, ws, conn.id);
  assert.ok(events.some((e) => e.status === 'deferred'));
  assert.equal(
    events.some((e) => e.reason === 'signature_mismatch'),
    false,
    'Unauthenticated signature failures must not create database rows.',
  );
});

test('X07 reinvestment: seed, pending and payouts are not profit; partial, concurrent and post-refund allocations cannot create money', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, service } = s;
  const ws = await s.workspace();
  const { conn, fx } = await s.connected(ws);
  const { offer } = await s.offer(ws, conn, 10_000);
  const policy = {
    enabled: true,
    eligible_bps: 5000,
    holdback_days: 0,
    period_days: 30,
    period_cap_nano_usd: c(20_000).toString(),
    min_reserve_nano_usd: c(1000).toString(),
    rationale: 'Fixture policy: half of settled earnings, small reserve.',
  };
  const capacity = () => store.reinvestmentCapacity(owner, ws);
  const allocate = (cents: number, allow_partial = false) =>
    store.allocateReinvestment(owner, ws, {
      amount_nano_usd: c(cents).toString(),
      allow_partial,
      envelope_name: 'Reinvested fixture budget',
      max_in_flight: 2,
    });
  // Disabled by default.
  assert.equal((await capacity()).binding, 'policy_disabled');
  await rejects(
    'ACCESS_DENIED',
    store.setReinvestmentPolicy(editor, ws, policy),
  );
  await store.setReinvestmentPolicy(owner, ws, policy);
  // Seed money is funding, not earnings.
  await store.recordOwnerFunding(owner, ws, {
    amount_nano_usd: c(50_000).toString(),
    evidence: 'Fixture seed.',
  });
  const rail = await store.registerRail(owner, ws, {
    label: 'Owner bank',
    kind: 'owner_attested',
    connection_id: null,
  });
  await store.attestRail(owner, ws, rail.id, {
    available_nano_usd: c(100_000).toString(),
    evidence: 'Fixture statement.',
  });
  assert.equal((await capacity()).eligible_tranches_nano, '0');
  // Captured but pending: still nothing.
  const p1 = await s.sale(ws, fx, offer.id, 'cust-1');
  await service.reconcilePayment(owner, ws, conn.id, p1);
  assert.equal((await capacity()).capacity_nano, '0');
  // Settled: half of the net becomes eligible.
  fx.settle(p1);
  await service.reconcilePayment(owner, ws, conn.id, p1);
  const net1 = 10_000 - (290 + 30);
  let cap = await capacity();
  assert.equal(cap.eligible_tranches_nano, c(net1 / 2).toString());
  assert.equal(cap.capacity_nano, c(net1 / 2).toString());
  assert.equal(cap.binding, 'eligible_tranches');
  // A payout changes cash location, not earnings.
  const po = fx.payoutNow(2000);
  await service.reconcilePayout(owner, ws, conn.id, po);
  assert.equal(
    (await capacity()).eligible_tranches_nano,
    c(net1 / 2).toString(),
  );

  // Unavailable rail: no money to fund it, so no authority.
  await store.setRailStatus(owner, ws, rail.id, {
    status: 'unavailable',
    reason: 'Bank link down.',
  });
  cap = await capacity();
  assert.equal(cap.capacity_nano, '0');
  assert.equal(cap.binding, 'usable_liquidity');
  assert.match(cap.parts.unavailable_rails[0]!, /marked unavailable/);
  await rejects('BUDGET_EXCEEDED', allocate(100));
  await store.setRailStatus(owner, ws, rail.id, {
    status: 'available',
    reason: 'Restored.',
  });
  // A processor rail with no fresh balance counts as unavailable too.
  const prail = await store.registerRail(owner, ws, {
    label: 'Processor',
    kind: 'processor_balance',
    connection_id: conn.id,
  });
  await service.observeRail(owner, ws, prail.id);
  fx.down = true;
  await rejects(
    'STORAGE_UNAVAILABLE',
    service.observeRail(owner, ws, prail.id),
  );
  fx.down = false;
  assert.match(
    (await capacity()).parts.unavailable_rails.join(';'),
    /Processor: marked unavailable/,
  );

  // Over capacity is refused unless partial is allowed; partial keeps the remainder.
  await rejects('BUDGET_EXCEEDED', allocate(net1));
  const a1 = await allocate(1000);
  assert.equal(a1.amount_nano_usd, c(1000).toString());
  const t1 = (await store.listTranches(owner, ws))[0] as Record<
    string,
    unknown
  >;
  assert.equal(t1.consumed_nano, c(1000).toString());
  assert.equal(
    (await capacity()).eligible_tranches_nano,
    c(net1 / 2 - 1000).toString(),
  );

  // Concurrency: ten racing requests can never consume more than the tranche holds.
  const remaining = net1 / 2 - 1000;
  const racers = await Promise.allSettled(
    Array.from({ length: 10 }, () => allocate(Math.floor(remaining / 4) + 1)),
  );
  const won = racers.filter((r) => r.status === 'fulfilled').length;
  assert.equal(won, 3);
  const after = (await store.listTranches(owner, ws))[0] as Record<
    string,
    unknown
  >;
  const allocations = await store.listAllocations(owner, ws);
  const total = allocations.reduce(
    (n, a) => n + BigInt(String((a as Record<string, unknown>).amount_nano)),
    0n,
  );
  assert.equal(String(after.consumed_nano), total.toString());
  assert.ok(total <= c(net1 / 2));
  // Partial takes exactly what is left.
  const last = await allocate(10_000, true);
  assert.equal(BigInt(last.amount_nano_usd), c(net1 / 2) - total);
  assert.equal((await capacity()).capacity_nano, '0');
  // Envelopes derived from earnings are ordinary global budgets in the budget journal.
  const env = await store.getEnvelope(owner, ws, a1.envelope_id);
  assert.equal(env.kind, 'global');
  assert.deepEqual(await store.journalBalances(ws, a1.envelope_id), {
    allocated: '0',
    reserved: '0',
    unknown: '0',
    incurred: '0',
  });

  // Refund after reinvestment: idle derived envelopes give back unused authority.
  const busy = await store.createEnvelope(owner, ws, {
    parent_id: a1.envelope_id,
    kind: 'period',
    run_id: null,
    name: 'Busy child',
    cap_nano_usd: c(500).toString(),
    max_in_flight: 1,
    starts_at: new Date().toISOString(),
    ends_at: new Date(Date.now() + 86_400_000).toISOString(),
  });
  fx.refund(p1, 10_000);
  await service.reconcilePayment(owner, ws, conn.id, p1);
  cap = await capacity();
  // Every idle derived envelope was reclaimed; a1 has a carved-out child, so its share remains a loss.
  const reclaimable = net1 / 2 - 1000;
  assert.equal(cap.frozen, true);
  assert.equal(cap.binding, 'losses_outstanding');
  assert.equal(cap.outstanding_losses_nano, c(1000).toString());
  await rejects('BUDGET_EXCEEDED', allocate(1));
  const closed = await store.listEnvelopes(owner, ws);
  const reinvested = closed.filter(
    (e) => e.name === 'Reinvested fixture budget',
  );
  assert.equal(reinvested.filter((e) => e.status === 'active').length, 1);
  assert.ok(reclaimable > 0);
  // Freeing the child lets the loss be reclaimed from a1; expansion unfreezes.
  await store.closeEnvelope(owner, ws, busy.id, {
    expected_version: busy.version,
    reason: 'Done.',
  });
  assert.deepEqual(await store.settleReinvestmentLosses(owner, ws), {
    outstanding_nano: '0',
  });
  assert.equal((await capacity()).frozen, false);
  // No authority survives from refunded earnings, and nothing was created from nothing.
  assert.equal(
    (await store.listEnvelopes(owner, ws)).filter(
      (e) => e.name === 'Reinvested fixture budget' && e.status === 'active',
    ).length,
    0,
  );
  assert.equal((await capacity()).capacity_nano, '0');
  assert.equal((await store.ledgerBalances(owner, ws)).total_nano, '0');
});

test('X07 an offer for a replaced release is refused: a newer build or a newer spec version replaces it', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store } = s;
  const ws = await s.workspace();
  const { conn } = await s.connected(ws);
  const first = await verifiedRelease(store, s.db.pool, ws, owner);
  const second = await first.rebuild();
  const create = (release: { artifact_id: string; manifest_sha256: string }) =>
    store.createOffer(owner, ws, {
      connection_id: conn.id,
      artifact_id: release.artifact_id,
      manifest_sha256: release.manifest_sha256,
      label: 'Fixture app',
      price_nano_usd: c(1000).toString(),
    });
  // Both builds are verified; only the latest of the spec is current.
  await rejects('INVALID_TRANSITION', create(first));
  const offer = await create(second);
  assert.equal(offer.artifact_id, second.artifact_id);
  // A new spec version replaces every build made for the old one, including the latest.
  const spec = (
    await s.db.pool.query('select body from entities where id=$1', [
      first.spec_id,
    ])
  ).rows[0] as { body: unknown };
  await store.reviseEntity(owner, ws, first.spec_id, {
    expected_version: 1,
    title: 'Spec v2',
    body: spec.body,
    reason: 'Replaces the version both builds were made for.',
    corrects_version: null,
  });
  await rejects('INVALID_TRANSITION', create(second));
  // The refusals wrote no offers.
  const count = await s.db.pool.query(
    'select count(*)::int as n from payment_offers where workspace_id=$1',
    [ws],
  );
  assert.equal(count.rows[0].n, 1);
});

test('X07 one processor account and funding balance cannot be registered twice', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const ws = await s.workspace();
  const { conn } = await s.connected(ws);
  const rail = {
    label: 'Processor',
    kind: 'processor_balance',
    connection_id: conn.id,
  };
  const results = await Promise.allSettled([
    s.store.registerRail(owner, ws, rail),
    s.store.registerRail(owner, ws, rail),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const stripe = {
    label: 'Stripe test identity',
    processor: 'stripe',
    mode: 'test',
    account_id: 'acct_testIdentity',
    secret_key_env: 'CREATOR_STRIPE_TEST_KEY',
    webhook_secret_env: 'CREATOR_STRIPE_TEST_HOOK',
  };
  const second = await s.workspace();
  const accounts = await Promise.allSettled([
    s.store.registerPaymentConnection(owner, ws, stripe),
    s.store.registerPaymentConnection(owner, second, stripe),
  ]);
  assert.equal(accounts.filter((r) => r.status === 'fulfilled').length, 1);
  const entry = accounts.find((r) => r.status === 'fulfilled')!;
  assert.equal(entry.status, 'fulfilled');
  if (entry.status !== 'fulfilled') return;
  const connection = entry.value;
  await s.store.revokePaymentConnection(
    owner,
    connection.workspace_id,
    connection.id,
    {
      expected_version: connection.version,
      reason: 'Identity remains reserved after revocation.',
    },
  );
  await rejects(
    'DUPLICATE',
    s.store.registerPaymentConnection(owner, ws, stripe),
  );
});

test('X07 non-USD processor snapshots cannot enter the USD ledger', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const ws = await s.workspace();
  const { conn, fx } = await s.connected(ws);
  const { offer } = await s.offer(ws, conn);
  const pi = await s.sale(ws, fx, offer.id, 'cust-currency');
  fx.payments.get(pi)!.currency = 'eur';
  await rejects(
    'INVALID_CONTRACT',
    s.service.reconcilePayment(owner, ws, conn.id, pi),
  );
  assert.deepEqual(await s.store.listLedger(owner, ws), []);
  assert.deepEqual(await s.store.listEntitlements(owner, ws), []);
});

test('X07 credential account drift cannot book processor state', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const ws = await s.workspace();
  const { conn, fx } = await s.connected(ws);
  const { offer } = await s.offer(ws, conn);
  const pi = await s.sale(ws, fx, offer.id, 'cust-account');
  fx.account = async () => ({ id: 'acct_anotherMerchant', livemode: false });
  await rejects(
    'ACCESS_DENIED',
    s.service.reconcilePayment(owner, ws, conn.id, pi),
  );
  assert.deepEqual(await s.store.listLedger(owner, ws), []);
});

test('X07 fees above sale proceeds settle as a loss, never negative earnings', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const ws = await s.workspace();
  const { conn, fx } = await s.connected(ws);
  const { offer } = await s.offer(ws, conn, 10);
  const pi = await s.sale(ws, fx, offer.id, 'cust-small-sale');
  fx.settle(pi);
  await s.service.reconcilePayment(owner, ws, conn.id, pi);
  const tranche = (await s.store.listTranches(owner, ws))[0]! as Record<
    string,
    unknown
  >;
  assert.equal(tranche.earned_nano, '0');
  assert.equal(tranche.loss_nano, c(20).toString());
  assert.equal(
    (await s.store.reinvestmentCapacity(owner, ws)).surplus_nano,
    c(-20).toString(),
  );
  assert.equal((await s.store.ledgerBalances(owner, ws)).total_nano, '0');
});

test('X07 overlapping observations reject an older result without holding financial locks across reads', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const ws = await s.workspace();
  const { conn, fx } = await s.connected(ws);
  const { offer } = await s.offer(ws, conn);
  const pi = await s.sale(ws, fx, offer.id, 'cust-race');
  const payment = fx.payment.bind(fx);
  let enter!: () => void;
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let calls = 0;
  fx.payment = async (id) => {
    calls++;
    const snap = await payment(id);
    if (calls === 1) {
      enter();
      await gate;
    }
    return snap;
  };
  const before = s.service.reconcilePayment(owner, ws, conn.id, pi);
  await entered;
  fx.refund(pi, 1000);
  const outcome = before.catch((e: unknown) => e);
  try {
    const client = await s.db.pool.connect();
    try {
      await client.query('begin');
      const lock = await client.query(
        'select pg_try_advisory_xact_lock(hashtext($1)) as acquired',
        ['creator:reinvest:' + ws],
      );
      assert.equal(
        lock.rows[0].acquired,
        true,
        'Processor wait must not hold the workspace financial lock.',
      );
      await client.query(
        'select id from payment_connections where id=$1 for update nowait',
        [conn.id],
      );
      await client.query('rollback');
    } finally {
      await client.query('rollback');
      client.release();
    }
    await s.service.reconcilePayment(owner, ws, conn.id, pi);
    assert.equal(calls, 2);
  } finally {
    release();
  }
  const stale = await outcome;
  assert.ok(
    stale instanceof ContractError && stale.code === 'VERSION_CONFLICT',
  );
  assert.equal((await s.balances(ws)).refunds, c(1000).toString());
  assert.equal(
    (await s.store.listEntitlements(owner, ws))[0]?.status,
    'revoked',
  );
});

test('X07 invalid webhook signatures never write durable receipts, even with repeated bodies', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const ws = await s.workspace();
  const { conn } = await s.connected(ws);
  for (let i = 0; i < 50; i++)
    assert.equal(
      (
        await s.service.receiveWebhook(
          hook,
          conn.id,
          'invalid',
          Buffer.from('{}'),
        )
      ).status,
      400,
    );
  assert.deepEqual(await s.store.listPaymentEvents(owner, ws, conn.id), []);
});

test('X07 Stripe refuses truncated or malformed loss histories', async () => {
  for (const incomplete of ['refunds', 'disputes']) {
    const processor = new StripeTestProcessor('sk_test_contractDouble0001', {
      fetch: (async (url) => {
        const u = new URL(String(url));
        const list = u.pathname.split('/').at(-1)!;
        return new Response(
          JSON.stringify(
            list === 'refunds' || list === 'disputes'
              ? { data: [], has_more: list === incomplete }
              : { id: 'pi_123' },
          ),
          { status: 200 },
        );
      }) as typeof fetch,
    });
    await assert.rejects(
      processor.payment('pi_123'),
      /Incomplete refund or dispute history/,
    );
  }
});

test('X07 Stripe test adapter maps processor objects from a contract double', async () => {
  const calls: string[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  const stripe = new StripeTestProcessor('sk_test_contractDouble0001', {
    fetch: (async (url: string | URL, init?: RequestInit) => {
      const u = String(url);
      calls.push(
        `${init?.method ?? 'GET'} ${u.replace('https://api.stripe.com', '')}`,
      );
      assert.equal(
        (init?.headers as Record<string, string>).Authorization,
        'Bearer sk_test_contractDouble0001',
      );
      if (u.includes('/v1/payment_intents/'))
        return json({
          id: 'pi_123',
          object: 'payment_intent',
          livemode: false,
          currency: 'usd',
          amount: 1500,
          status: 'succeeded',
          metadata: { offer_id: 'o', customer_ref: 'cust-9' },
          latest_charge: {
            id: 'ch_1',
            balance_transaction: {
              id: 'txn_1',
              amount: 1500,
              fee: 74,
              net: 1426,
              status: 'pending',
              available_on: 1_800_000_000,
            },
          },
        });
      if (u.includes('/v1/refunds'))
        return json({
          has_more: false,
          data: [{ id: 're_1', amount: 500, status: 'succeeded' }],
        });
      if (u.includes('/v1/disputes'))
        return json({
          has_more: false,
          data: [
            {
              id: 'dp_1',
              amount: 1000,
              status: 'needs_response',
              balance_transactions: [{ amount: -1000, fee: 1500 }],
            },
          ],
        });
      if (u.includes('/v1/checkout/sessions')) {
        const body = new URLSearchParams(String(init?.body));
        assert.equal(
          body.get('payment_intent_data[metadata][offer_id]'),
          'offer-1',
        );
        assert.equal(
          body.get('line_items[0][price_data][unit_amount]'),
          '1500',
        );
        assert.ok((init?.headers as Record<string, string>)['Idempotency-Key']);
        return json({ id: 'cs_1', url: 'https://checkout.stripe.com/c/cs_1' });
      }
      if (u.includes('/v1/balance'))
        return json({
          livemode: false,
          available: [
            { amount: 700, currency: 'usd' },
            { amount: 9, currency: 'eur' },
          ],
          pending: [{ amount: 300, currency: 'usd' }],
        });
      if (u.includes('/v1/payouts/'))
        return json({
          id: 'po_1',
          livemode: false,
          currency: 'usd',
          amount: 50,
          status: 'in_transit',
        });
      return json({ error: { message: 'no' } }, 500);
    }) as typeof fetch,
  });
  const p = await stripe.payment('pi_123');
  assert.equal(p.charge?.balance_transaction.net, 1426);
  assert.equal(
    p.charge?.balance_transaction.available_on,
    new Date(1_800_000_000_000).toISOString(),
  );
  assert.deepEqual(p.refunds, [
    { id: 're_1', amount: 500, status: 'succeeded' },
  ]);
  assert.deepEqual(p.disputes[0], {
    id: 'dp_1',
    amount: 1000,
    status: 'open',
    funds_amount: -1000,
    funds_fee: 1500,
  });
  assert.equal(
    (
      await stripe.createCheckout({
        offer_id: 'offer-1',
        label: 'App',
        price_cents: 1500,
        customer_ref: 'cust-9',
        success_url: 'http://127.0.0.1/a',
        cancel_url: 'http://127.0.0.1/b',
        idempotency_key: 'k-1',
      })
    ).session_id,
    'cs_1',
  );
  assert.deepEqual(await stripe.balance(), {
    livemode: false,
    available_cents: 700,
    pending_cents: 300,
  });
  assert.equal((await stripe.payout('po_1')).status, 'in_transit');
  assert.ok(calls.every((c) => / \/v1\//.test(c)));
});

test('reinvested earnings stay unallocated until the owner assigns them; a portfolio allocation funds non-maintenance work only, once', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, service } = s;
  const p = await portfolioFixture(store, s.db.pool, owner);
  const ws = p.ws;
  const { conn, fx } = await s.connected(ws);
  const { offer } = await s.offer(ws, conn, 10_000);
  await store.setReinvestmentPolicy(owner, ws, {
    enabled: true,
    eligible_bps: 5000,
    holdback_days: 0,
    period_days: 30,
    period_cap_nano_usd: c(20_000).toString(),
    min_reserve_nano_usd: c(1000).toString(),
    rationale: 'Fixture policy.',
  });
  await store.recordOwnerFunding(owner, ws, {
    amount_nano_usd: c(50_000).toString(),
    evidence: 'Fixture seed.',
  });
  const rail = await store.registerRail(owner, ws, {
    label: 'Owner bank',
    kind: 'owner_attested',
    connection_id: null,
  });
  await store.attestRail(owner, ws, rail.id, {
    available_nano_usd: c(100_000).toString(),
    evidence: 'Fixture statement.',
  });
  const paid = await s.sale(ws, fx, offer.id, 'cust-1');
  fx.settle(paid);
  await service.reconcilePayment(owner, ws, conn.id, paid);
  const capacity = async () =>
    BigInt((await store.reinvestmentCapacity(owner, ws)).capacity_nano);
  const eligible = await capacity();
  assert.ok(eligible > c(2000));
  // Running the portfolio does not move earnings: they stay unallocated capacity.
  await p.resetTick();
  await store.claimPortfolioJobs(owner, ws);
  assert.equal(await capacity(), eligible);
  assert.deepEqual(await store.listAllocations(owner, ws), []);

  const allocate = (cents: number, target?: 'standalone' | 'portfolio') =>
    store.allocateReinvestment(owner, ws, {
      amount_nano_usd: c(cents).toString(),
      allow_partial: false,
      envelope_name: `Reinvested ${target ?? 'standalone'}`,
      max_in_flight: 2,
      ...(target ? { target } : {}),
    });
  const standalone = await allocate(1000);
  const funded = await allocate(1000, 'portfolio');
  assert.equal(standalone.target, 'standalone');
  assert.equal(funded.target, 'portfolio');
  // The same money cannot fund two budgets: capacity fell by exactly what was allocated.
  assert.equal(await capacity(), eligible - c(2000));
  const tranches = await store.listTranches(owner, ws);
  assert.equal(
    tranches.reduce(
      (n, x) =>
        n + BigInt(String((x as Record<string, unknown>).consumed_nano)),
      0n,
    ),
    c(2000),
  );
  await rejects(
    'BUDGET_EXCEEDED',
    store.allocateReinvestment(owner, ws, {
      amount_nano_usd: (eligible - c(2000) + 1n).toString(),
      allow_partial: false,
      envelope_name: 'Too much',
      max_in_flight: 2,
      target: 'portfolio',
    }),
  );

  const exploration = await p.run('exploration');
  const maintenance = await p.run('maintenance');
  const prepare = (runId: string, envelopeId: string) =>
    store.prepareAttempt(
      owner,
      ws,
      runId,
      {
        envelope_id: envelopeId,
        action_type: 'model.generate',
        task_id: null,
        logical_operation_id: randomUUID(),
        pricing_snapshot_id: p.pricing.id,
        data_class: 'synthetic',
        input: [{ role: 'user', text: 'hello' }],
        max_output_tokens: 100,
        output_format: 'text',
        tool: null,
        max_attempts: 1,
        timeout_ms: 5000,
        justification: 'Reinvestment gate check.',
      },
      {
        provider: 'fixture',
        model_id: 'fixture-model-v1',
        adapterAvailable: true,
        requestHash: 'a'.repeat(64),
        attempt: 1,
        timeoutMs: 5000,
      },
    );
  const outcome = async (runId: string, envelopeId: string) => {
    const r = await prepare(runId, envelopeId);
    return r.kind === 'reserved' ? 'reserved' : r.reservation.reason_code;
  };
  // A standalone allocation is not portfolio money; the portfolio allocation is.
  assert.equal(
    await outcome(exploration.id, standalone.envelope_id),
    'portfolio_budget_outside_root',
  );
  assert.equal(await outcome(exploration.id, funded.envelope_id), 'reserved');
  // Maintenance stays on its protected reserve, never on reinvested money.
  assert.equal(
    await outcome(maintenance.id, funded.envelope_id),
    'portfolio_budget_lane_mismatch',
  );
  // A workspace without a portfolio policy cannot take a portfolio allocation.
  const plain = await s.workspace();
  await rejects(
    'INVALID_TRANSITION',
    store.allocateReinvestment(owner, plain, {
      amount_nano_usd: c(1).toString(),
      allow_partial: true,
      envelope_name: 'No portfolio',
      max_in_flight: 1,
      target: 'portfolio',
    }),
  );
  // Newest first (audit L-9): the portfolio allocation was made after the standalone one.
  const listed = await store.listAllocations(owner, ws);
  assert.deepEqual(
    listed.map((a) => (a as Record<string, unknown>).target),
    ['portfolio', 'standalone'],
  );
});

test('X07 payout and balance reads release locks and recheck revocation before applying', async (t) => {
  const s = await setup(t);
  if (!s) return;
  for (const kind of ['payout', 'balance'] as const)
    await t.test(kind, async () => {
      const ws = await s.workspace();
      const { conn, fx } = await s.connected(ws);
      let enter!: () => void, release!: () => void;
      const entered = new Promise<void>((r) => {
        enter = r;
      });
      const gate = new Promise<void>((r) => {
        release = r;
      });
      const rail = await s.store.registerRail(owner, ws, {
        kind: 'processor_balance',
        connection_id: conn.id,
        label: 'Observation test',
      });
      const id = fx.payoutNow(100);
      const payout = await fx.payout(id);
      const balance = await fx.balance();
      fx.payout = async () => {
        enter();
        await gate;
        return payout;
      };
      fx.balance = async () => {
        enter();
        await gate;
        return balance;
      };
      const pending = (
        kind === 'payout'
          ? s.service.reconcilePayout(owner, ws, conn.id, id)
          : s.service.observeRail(owner, ws, rail.id)
      ).catch((e: unknown) => e);
      await entered;
      try {
        const c = await s.db.pool.connect();
        try {
          await c.query('begin');
          assert.equal(
            (
              await c.query(
                'select pg_try_advisory_xact_lock(hashtext($1)) acquired',
                ['creator:reinvest:' + ws],
              )
            ).rows[0].acquired,
            true,
          );
          await c.query(
            'select id from payment_connections where id=$1 for update nowait',
            [conn.id],
          );
        } finally {
          await c.query('rollback');
          c.release();
        }
        await s.store.revokePaymentConnection(owner, ws, conn.id, {
          expected_version: conn.version,
          reason: 'Stop while processor waits',
        });
      } finally {
        release();
      }
      const result = await pending;
      assert.ok(
        result instanceof ContractError && result.code === 'INVALID_TRANSITION',
      );
      assert.deepEqual(await s.store.listLedger(owner, ws), []);
    });
});
test('X07 a late failed balance read cannot invalidate a newer successful observation', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const ws = await s.workspace();
  const { conn, fx } = await s.connected(ws);
  const rail = await s.store.registerRail(owner, ws, {
    kind: 'processor_balance',
    connection_id: conn.id,
    label: 'Freshness test',
  });
  let enter!: () => void, release!: () => void;
  const entered = new Promise<void>((r) => {
    enter = r;
  });
  const gate = new Promise<void>((r) => {
    release = r;
  });
  let calls = 0;
  fx.balance = async () => {
    if (++calls === 1) {
      enter();
      await gate;
      throw Error('Delayed outage');
    }
    return { livemode: false, available_cents: 123, pending_cents: 0 };
  };
  const old = s.service
    .observeRail(owner, ws, rail.id)
    .catch((e: unknown) => e);
  await entered;
  try {
    await s.service.observeRail(owner, ws, rail.id);
  } finally {
    release();
  }
  assert.ok((await old) instanceof ContractError);
  const actual = (await s.store.listRails(owner, ws))[0]! as Record<
    string,
    unknown
  >;
  assert.equal(actual.status, 'available');
  assert.equal(actual.available_nano, c(123).toString());
});
