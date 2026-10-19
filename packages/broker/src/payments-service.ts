import { createHash, randomUUID } from 'node:crypto';
import { ContractError, type PaymentConnection } from '@creator/contracts';
import { NANO_PER_CENT, verifyWebhook } from '@creator/domain';
import type { CommandContext, PaymentStore } from '@creator/db';
import {
  FixtureProcessor,
  ProcessorUnavailable,
  StripeTestProcessor,
  eventSubject,
  type PaymentProcessor,
} from './payments.js';

// Reads and projection updates share the store's workspace lock: overlapping deliveries
// cannot apply a snapshot read before another delivery's refund or settlement observation.

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

export class PaymentService {
  readonly #fixtures = new Map<string, FixtureProcessor>();
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
    try {
      return await this.store.recordRailBalance(ctx, ws, railId, () =>
        this.#read(async () => (await this.#boundProcessor(conn)).balance()),
      );
    } catch (e) {
      if (
        e instanceof ContractError &&
        ['STORAGE_UNAVAILABLE', 'ACCESS_DENIED'].includes(e.code)
      )
        await this.store.setRailStatus(ctx, ws, railId, {
          status: 'unavailable',
          reason:
            'Processor balance observation failed; verify the rail before restoring availability.',
        });
      throw e;
    }
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
    const reject = async (status: number, why: string) => {
      await this.store.recordPaymentEvent(conn.id, 'rejected', why, {
        payload_hash,
      });
      return { status, body: { error: why } };
    };
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
      if (e instanceof ProcessorUnavailable || !(e instanceof ContractError)) {
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
