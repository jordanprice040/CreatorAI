import { createHash, randomUUID } from 'node:crypto';
import {
  ContractError,
  TestBuyerRequestSchema,
  TestDeliverRequestSchema,
  parse,
  type PaymentConnection,
  type TestBuyerAction,
  type TestCheckoutState,
} from '@creator/contracts';
import { NANO_PER_CENT, verifyWebhook } from '@creator/domain';
import type { CommandContext, PaymentStore } from '@creator/db';
import {
  FixtureProcessor,
  ProcessorUnavailable,
  StripeTestProcessor,
  eventSubject,
  type PaymentProcessor,
} from './payments.js';

// Reads run outside financial transactions. The store fences older observations before applying.

export interface PaymentServiceOptions {
  /** API process environment: secret key and webhook secret variables live here. */
  env: Record<string, string | undefined>;
  /** Test seam: the fixture processor for a connection (default: one per connection). */
  fixture?: (connection: PaymentConnection) => FixtureProcessor;
  /** Test seam: the HTTP client a Stripe test-mode adapter uses. */
  stripeFetch?: typeof fetch;
}
const reason = (e: unknown) =>
  e instanceof Error ? e.message.slice(0, 300) : 'unknown error';

/** One test-buyer checkout: the simulated payment and the events waiting to be delivered. */
interface TestBuyer {
  payment: string | null;
  events: TestCheckoutState['events'];
}
const TEST_EVENT_LIMIT = 40;
const TEST_DELIVERY_LIMIT = 20;
/** Signs a deliberately wrong delivery; never a real secret. */
const WRONG_SECRET = 'whsec_test_buyer_wrong_secret';

export class PaymentService {
  readonly #fixtures = new Map<string, FixtureProcessor>();
  /** Test buyers by checkout id; in memory, like the simulated processor itself. */
  readonly #buyers = new Map<string, TestBuyer>();
  constructor(
    readonly store: PaymentStore,
    readonly opts: PaymentServiceOptions,
  ) {}
  processor(conn: PaymentConnection): PaymentProcessor {
    if (conn.body.processor === 'fixture') {
      if (this.opts.fixture) return this.opts.fixture(conn);
      let f = this.#fixtures.get(conn.id);
      if (!f) {
        f = new FixtureProcessor(conn.body.account_id);
        this.#fixtures.set(conn.id, f);
      }
      return f;
    }
    const key = this.opts.env[conn.body.secret_key_env ?? ''];
    if (!key)
      throw new ContractError(
        'INVALID_CONFIG',
        `Set ${conn.body.secret_key_env} in the API environment to use this connection.`,
      );
    return new StripeTestProcessor(key, {
      ...(this.opts.stripeFetch ? { fetch: this.opts.stripeFetch } : {}),
    });
  }
  /** Asks the processor whose credential this is; only the configured account activates. */
  async verify(ctx: CommandContext, ws: string, id: string) {
    const conn = await this.store.getPaymentConnection(ctx, ws, id);
    let observed: { id: string; livemode: boolean } | { error: string };
    try {
      observed = await this.processor(conn).account();
    } catch (e) {
      if (e instanceof ContractError && e.code === 'LIVE_DISABLED')
        observed = { id: 'live-key', livemode: true };
      else observed = { error: reason(e) };
    }
    return this.store.recordPaymentVerification(ctx, ws, id, observed);
  }
  async #boundProcessor(conn: PaymentConnection) {
    const processor = this.processor(conn);
    const account = await processor.account();
    if (account.livemode || account.id !== conn.body.account_id)
      throw new ContractError(
        'ACCESS_DENIED',
        'The current processor credential no longer matches the verified test account.',
      );
    return processor;
  }
  async checkout(ctx: CommandContext, ws: string, raw: unknown) {
    const { req, offer, connection } = await this.store.checkoutTarget(
      ctx,
      ws,
      raw,
    );
    let result: { session_id: string; url: string } | { error: string };
    try {
      result = await (
        await this.#boundProcessor(connection)
      ).createCheckout({
        offer_id: offer.id,
        label: offer.label,
        price_cents: Number(BigInt(offer.price_nano_usd) / NANO_PER_CENT),
        customer_ref: req.customer_ref,
        success_url: req.success_url,
        cancel_url: req.cancel_url,
        idempotency_key: randomUUID(),
      });
    } catch (e) {
      result = { error: reason(e) };
    }
    return this.store.recordCheckout(ctx, ws, offer, req.customer_ref, result);
  }
  // ---- Test buyer (simulated processor only) -----------------------------------------------
  // A test buyer drives the in-memory processor, then queues the signed event a real processor
  // would send. Delivery goes through receiveWebhook, so signatures, mode, de-duplication and
  // the backend read are the real path; the owner picks the order and can repeat or spoil one.

  async #testBuyer(
    ctx: CommandContext,
    ws: string,
    id: string,
    ask: string | null,
  ) {
    const target = await this.store.testBuyerTarget(ctx, ws, id, ask);
    const fx = this.processor(target.connection);
    if (!(fx instanceof FixtureProcessor))
      throw new ContractError(
        'INVALID_TRANSITION',
        'Not a simulated processor.',
      );
    const session = target.checkout.processor_session_id!;
    // Get-or-create with no await after it, so concurrent requests share one buyer and the
    // caller's allowed-check and processor change run without interleaving.
    let buyer = this.#buyers.get(target.checkout.id);
    if (!buyer) {
      buyer = { payment: null, events: [] };
      this.#buyers.set(target.checkout.id, buyer);
    }
    return {
      ...target,
      fx,
      session,
      buyer,
      available: fx.checkouts.has(session),
    };
  }
  #state(
    checkoutId: string,
    fx: FixtureProcessor,
    buyer: TestBuyer,
    available: boolean,
  ): TestCheckoutState {
    const p = buyer.payment ? fx.payments.get(buyer.payment) : undefined;
    const refunded = p?.refunds.reduce((n, r) => n + r.amount, 0) ?? 0;
    const d = p?.disputes.at(-1);
    const dispute = d?.status ?? 'none';
    const settled = p?.charge?.balance_transaction.status === 'available';
    const allowed: TestBuyerAction[] = !available
      ? []
      : !p
        ? ['pay']
        : [
            ...(settled ? [] : (['settle'] as const)),
            ...(refunded < p.amount && dispute === 'none'
              ? (['refund', 'dispute'] as const)
              : []),
            ...(dispute === 'open'
              ? (['dispute_won', 'dispute_lost'] as const)
              : []),
          ];
    return {
      checkout_id: checkoutId,
      available,
      payment: p
        ? {
            id: p.id,
            amount_cents: p.amount,
            settled,
            refunded_cents: refunded,
            dispute,
          }
        : null,
      allowed,
      events: structuredClone(buyer.events),
    };
  }
  async testBuyerState(ctx: CommandContext, ws: string, checkoutId: string) {
    const t = await this.#testBuyer(ctx, ws, checkoutId, null);
    return this.#state(t.checkout.id, t.fx, t.buyer, t.available);
  }
  async testBuyerAct(
    ctx: CommandContext,
    ws: string,
    checkoutId: string,
    raw: unknown,
  ) {
    const { action } = parse(TestBuyerRequestSchema, raw);
    const t = await this.#testBuyer(ctx, ws, checkoutId, action);
    const { fx, buyer } = t;
    if (!t.available)
      throw new ContractError(
        'INVALID_TRANSITION',
        'The simulated processor restarted and forgot this checkout; open a new one.',
      );
    if (!this.#state(t.checkout.id, fx, buyer, true).allowed.includes(action))
      throw new ContractError(
        'INVALID_TRANSITION',
        `The test buyer can't ${action.replace('_', ' ')} now.`,
      );
    if (buyer.events.length >= TEST_EVENT_LIMIT)
      throw new ContractError(
        'BUDGET_EXCEEDED',
        'This test checkout has queued enough events; open a new one.',
      );
    let pi = buyer.payment;
    let type: string;
    let object: Record<string, unknown>;
    switch (action) {
      case 'pay':
        pi = fx.pay(t.session);
        buyer.payment = pi;
        type = 'payment_intent.succeeded';
        object = { object: 'payment_intent', id: pi };
        break;
      case 'settle':
        fx.settle(pi!);
        type = 'charge.updated';
        object = {
          object: 'charge',
          id: fx.payments.get(pi!)!.charge!.id,
          payment_intent: pi,
        };
        break;
      case 'refund': {
        const p = fx.payments.get(pi!)!;
        const left = p.amount - p.refunds.reduce((n, r) => n + r.amount, 0);
        type = 'refund.created';
        object = {
          object: 'refund',
          id: fx.refund(pi!, left),
          payment_intent: pi,
        };
        break;
      }
      case 'dispute':
        type = 'charge.dispute.created';
        object = { object: 'dispute', id: fx.dispute(pi!), payment_intent: pi };
        break;
      default: {
        const d = fx.payments.get(pi!)!.disputes.at(-1)!;
        fx.closeDispute(pi!, d.id, action === 'dispute_won' ? 'won' : 'lost');
        type = 'charge.dispute.closed';
        object = { object: 'dispute', id: d.id, payment_intent: pi };
      }
    }
    // The body is fixed now; it is signed at delivery so the timestamp is the delivery's.
    const id = `evt_fxtest${randomUUID().replace(/-/g, '')}`;
    buyer.events.push({
      id,
      type,
      action,
      queued_at: new Date().toISOString(),
      deliveries: [],
    });
    this.#bodies.set(id, { type, object });
    return this.#state(t.checkout.id, fx, buyer, true);
  }
  readonly #bodies = new Map<
    string,
    { type: string; object: Record<string, unknown> }
  >();
  /**
   * Delivers one queued event through the webhook path. `hook` is the identity real
   * deliveries use, so a test delivery records exactly what a processor's would.
   */
  async testBuyerDeliver(
    ctx: CommandContext,
    hook: CommandContext,
    ws: string,
    checkoutId: string,
    raw: unknown,
  ) {
    const req = parse(TestDeliverRequestSchema, raw);
    const t = await this.#testBuyer(
      ctx,
      ws,
      checkoutId,
      `deliver:${req.signature}`,
    );
    const event = t.buyer.events.find((e) => e.id === req.event_id);
    const body = this.#bodies.get(req.event_id);
    if (!event || !body)
      throw new ContractError(
        'NOT_FOUND',
        'No such queued event for this checkout.',
      );
    if (event.deliveries.length >= TEST_DELIVERY_LIMIT)
      throw new ContractError(
        'BUDGET_EXCEEDED',
        'This event has been delivered enough times.',
      );
    const secret = this.opts.env[t.connection.body.webhook_secret_env];
    if (!secret)
      throw new ContractError(
        'INVALID_CONFIG',
        `Set ${t.connection.body.webhook_secret_env} in the API environment so deliveries can be signed and checked.`,
      );
    const now = Math.floor(Date.now() / 1000);
    const signed = t.fx.event(
      body.type,
      body.object,
      req.signature === 'wrong_secret' ? WRONG_SECRET : secret,
      { id: event.id, t: req.signature === 'expired' ? now - 600 : now },
    );
    const out = await this.receiveWebhook(
      hook,
      t.connection.id,
      signed.signature,
      signed.raw,
      now,
    );
    const b = out.body as { outcome?: unknown; error?: unknown };
    event.deliveries.push({
      at: new Date().toISOString(),
      signature: req.signature,
      http_status: out.status,
      outcome: String(b.outcome ?? b.error ?? 'answered').slice(0, 200),
    });
    return this.#state(t.checkout.id, t.fx, t.buyer, t.available);
  }

  /** Owner-requested read of one payment (recovery for a missed or deferred event). */
  async reconcilePayment(
    ctx: CommandContext,
    ws: string,
    connectionId: string,
    paymentId: string,
  ) {
    const conn = await this.store.getPaymentConnection(ctx, ws, connectionId);
    return this.store.applyPaymentSnapshot(
      ctx,
      conn.id,
      () =>
        this.#read(async () =>
          (await this.#boundProcessor(conn)).payment(paymentId),
        ),
      null,
      ws,
    );
  }
  async reconcilePayout(
    ctx: CommandContext,
    ws: string,
    connectionId: string,
    payoutId: string,
  ) {
    const conn = await this.store.getPaymentConnection(ctx, ws, connectionId);
    return this.store.applyPayoutSnapshot(
      ctx,
      conn.id,
      () =>
        this.#read(async () =>
          (await this.#boundProcessor(conn)).payout(payoutId),
        ),
      null,
      ws,
    );
  }
  /** A failed observation invalidates even a previously fresh funding rail. */
  async observeRail(ctx: CommandContext, ws: string, railId: string) {
    const conn = await this.store.railConnection(ctx, ws, railId);
    return this.store.recordRailBalance(ctx, ws, railId, () =>
      this.#read(async () => (await this.#boundProcessor(conn)).balance()),
    );
  }
  async #read<T>(f: () => Promise<T>) {
    try {
      return await f();
    } catch (e) {
      if (e instanceof ContractError) throw e;
      throw new ContractError(
        'STORAGE_UNAVAILABLE',
        `The payment processor could not be read: ${reason(e)}`,
      );
    }
  }

  /**
   * Verified webhook delivery. Order: signature, mode, de-duplication, then a backend read of
   * the named object. If the processor cannot be read the delivery is refused (503) so the
   * processor retries; nothing is recorded as money until a read succeeds.
   */
  async receiveWebhook(
    ctx: CommandContext,
    connectionId: string,
    signature: string | null,
    raw: Buffer,
    nowS = Math.floor(Date.now() / 1000),
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const payload_hash = createHash('sha256').update(raw).digest('hex');
    let conn: PaymentConnection;
    try {
      conn = await this.store.paymentConnectionForWebhook(connectionId);
    } catch {
      return { status: 404, body: { error: 'unknown endpoint' } };
    }
    // Unauthenticated traffic cannot create durable records. Verified events below retain receipts.
    const reject = (status: number, why: string) => ({
      status,
      body: { error: why },
    });
    const secret = this.opts.env[conn.body.webhook_secret_env];
    if (!secret) return reject(503, 'webhook_secret_unset');
    const verified = verifyWebhook(signature, raw, secret, nowS);
    if (!verified.ok) return reject(400, verified.reason);
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(raw.toString('utf8')) as Record<string, unknown>;
      if (!event || typeof event !== 'object' || Array.isArray(event))
        return reject(400, 'malformed_json');
    } catch {
      return reject(400, 'malformed_json');
    }
    const meta = {
      processor_event_id: String(event.id ?? '').slice(0, 200),
      event_type: String(event.type ?? '').slice(0, 100),
      payload_hash,
    };
    if (!/^evt_[A-Za-z0-9_]{1,120}$/.test(meta.processor_event_id))
      return reject(400, 'malformed_event_id');
    if (conn.status !== 'active') {
      await this.store.recordPaymentEvent(
        conn.id,
        'rejected',
        'connection_not_active',
        meta,
      );
      return { status: 409, body: { error: 'connection_not_active' } };
    }
    if (event.livemode === true) {
      await this.store.recordPaymentEvent(
        conn.id,
        'rejected',
        'live_mode_refused',
        meta,
      );
      return { status: 400, body: { error: 'live_mode_refused' } };
    }
    if (
      await this.store.paymentEventApplied(conn.id, meta.processor_event_id)
    ) {
      await this.store.recordPaymentEvent(
        conn.id,
        'duplicate',
        'Event already applied.',
        meta,
      );
      return { status: 200, body: { outcome: 'duplicate' } };
    }
    const subject = eventSubject(event);
    if (!subject) {
      await this.store.recordPaymentEvent(
        conn.id,
        'ignored',
        'Event names no payment or payout.',
        meta,
      );
      return { status: 200, body: { outcome: 'ignored' } };
    }
    try {
      if (subject.kind === 'payment') {
        const out = await this.store.applyPaymentSnapshot(
          ctx,
          conn.id,
          async () => (await this.#boundProcessor(conn)).payment(subject.id),
          meta,
        );
        if (out.outcome === 'duplicate')
          await this.store.recordPaymentEvent(
            conn.id,
            'duplicate',
            'Event already applied.',
            meta,
          );
        return { status: 200, body: out };
      }
      const out = await this.store.applyPayoutSnapshot(
        ctx,
        conn.id,
        async () => (await this.#boundProcessor(conn)).payout(subject.id),
        meta,
      );
      if (out.outcome === 'duplicate')
        await this.store.recordPaymentEvent(
          conn.id,
          'duplicate',
          'Event already applied.',
          meta,
        );
      return { status: 200, body: out };
    } catch (e) {
      if (
        e instanceof ProcessorUnavailable ||
        !(e instanceof ContractError) ||
        e.code === 'VERSION_CONFLICT'
      ) {
        await this.store.recordPaymentEvent(
          conn.id,
          'deferred',
          `Processor read failed: ${reason(e)}`,
          meta,
        );
        return { status: 503, body: { error: 'processor_unavailable' } };
      }
      await this.store.recordPaymentEvent(
        conn.id,
        'rejected',
        `${e.code}: ${e.message}`,
        meta,
      );
      return {
        status: e.code === 'NOT_FOUND' ? 404 : 400,
        body: { error: e.code },
      };
    }
  }
}
