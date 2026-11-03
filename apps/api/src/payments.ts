import type { PaymentService } from '@creator/broker';
import { pageQuery, type CommandContext, type PaymentStore } from '@creator/db';

/** X07 routes under /api/workspaces/:ws/<collection>. Matched separately from RECORD_ROUTE. */
export const PAYMENTS_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(payment-connections|payment-offers|payment-checkouts|payments|payouts|ledger|entitlements|funding-rails|commitments|reinvestment)(?:\/([^/]+)(?:\/(verify|revoke|events|archive|reconcile|status|attest|observe|close|buyer|deliver))?)?$/;
/** The processor delivers here (through the owner's local forwarder; the API binds to loopback). */
export const PAYMENTS_WEBHOOK_ROUTE = /^\/api\/payments\/webhooks\/([^/]+)$/;
/**
 * Where checkout sends the buyer back. It is deliberately inert: query parameters are never
 * read, and access exists only after the backend has read the payment from the processor.
 */
export const PAYMENTS_RETURN_ROUTE = /^\/api\/payments\/return$/;
export const RETURN_BODY = {
  granted: false,
  message:
    'Thanks. Access is granted only after the payment processor confirms the payment to the studio; returning here does not grant it.',
} as const;

export async function paymentRoutes(r: {
  store: PaymentStore;
  service: PaymentService;
  ctx: CommandContext;
  /** The identity processor deliveries use; test-buyer deliveries reuse it. */
  hook: CommandContext;
  ws: string;
  collection: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  url: URL;
  body: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  const { store, service, ctx, ws, collection, item, action, method, send } = r;
  const get = method === 'GET';
  const post = method === 'POST';
  const q = (k: string) => r.url.searchParams.get(k) ?? undefined;
  const field = async (k: string) => {
    const b = (await r.body()) as Record<string, unknown> | null;
    return typeof b?.[k] === 'string' ? (b[k] as string) : '';
  };
  switch (collection) {
    case 'payment-connections':
      if (!item && get)
        return send(200, await store.listPaymentConnections(ctx, ws), false);
      if (!item && post)
        return send(
          201,
          await store.registerPaymentConnection(ctx, ws, await r.body()),
          true,
        );
      if (item && !action && get)
        return send(
          200,
          await store.getPaymentConnection(ctx, ws, item),
          false,
        );
      if (item && action === 'verify' && post)
        return send(200, await service.verify(ctx, ws, item), true);
      if (item && action === 'revoke' && post)
        return send(
          200,
          await store.revokePaymentConnection(ctx, ws, item, await r.body()),
          true,
        );
      if (item && action === 'events' && get)
        return send(200, await store.listPaymentEvents(ctx, ws, item), false);
      break;
    case 'payment-offers':
      if (!item && get)
        return send(200, await store.listOffers(ctx, ws, pageQuery(q)), false);
      if (!item && post)
        return send(
          201,
          await store.createOffer(ctx, ws, await r.body()),
          true,
        );
      if (item && item !== 'owner-funding' && !action && get)
        return send(200, await store.getOffer(ctx, ws, item), false);
      if (item && action === 'archive' && post)
        return send(200, await store.archiveOffer(ctx, ws, item), true);
      break;
    case 'payment-checkouts':
      if (!item && get)
        return send(200, await store.listCheckouts(ctx, ws), false);
      if (!item && post)
        return send(201, await service.checkout(ctx, ws, await r.body()), true);
      // Simulated processor only: a test buyer, and delivery of the events it queues.
      if (item && action === 'buyer' && get)
        return send(200, await service.testBuyerState(ctx, ws, item), false);
      if (item && action === 'buyer' && post)
        return send(
          200,
          await service.testBuyerAct(ctx, ws, item, await r.body()),
          true,
        );
      if (item && action === 'deliver' && post)
        return send(
          200,
          await service.testBuyerDeliver(ctx, r.hook, ws, item, await r.body()),
          true,
        );
      break;
    case 'payments':
      // Owner-requested backend read of one payment, e.g. after a deferred delivery.
      if (item && action === 'reconcile' && post)
        return send(
          200,
          await service.reconcilePayment(
            ctx,
            ws,
            item,
            await field('payment_id'),
          ),
          true,
        );
      break;
    case 'payouts':
      if (item && action === 'reconcile' && post)
        return send(
          200,
          await service.reconcilePayout(
            ctx,
            ws,
            item,
            await field('payout_id'),
          ),
          true,
        );
      break;
    case 'ledger':
      if (!item && get)
        return send(200, await store.listLedger(ctx, ws), false);
      if (item === 'balances' && !action && get)
        return send(200, await store.ledgerBalances(ctx, ws), false);
      if (item === 'owner-funding' && !action && post)
        return send(
          201,
          await store.recordOwnerFunding(ctx, ws, await r.body()),
          true,
        );
      break;
    case 'entitlements':
      if (!item && get)
        return send(
          200,
          await store.listEntitlements(
            ctx,
            ws,
            {
              ...(q('offer_id') ? { offer_id: q('offer_id')! } : {}),
              ...(q('customer_ref')
                ? { customer_ref: q('customer_ref')! }
                : {}),
            },
            pageQuery(q),
          ),
          false,
        );
      if (item === 'check' && !action && get)
        return send(
          200,
          await store.checkEntitlement(
            ctx,
            ws,
            q('artifact_id') ?? '',
            q('customer_ref') ?? '',
          ),
          false,
        );
      break;
    case 'funding-rails':
      if (!item && get) return send(200, await store.listRails(ctx, ws), false);
      if (!item && post)
        return send(
          201,
          await store.registerRail(ctx, ws, await r.body()),
          true,
        );
      if (item && action === 'status' && post)
        return send(
          200,
          await store.setRailStatus(ctx, ws, item, await r.body()),
          true,
        );
      if (item && action === 'attest' && post)
        return send(
          200,
          await store.attestRail(ctx, ws, item, await r.body()),
          true,
        );
      if (item && action === 'observe' && post)
        return send(200, await service.observeRail(ctx, ws, item), true);
      break;
    case 'commitments':
      if (!item && get)
        return send(200, await store.listCommitments(ctx, ws), false);
      if (!item && post)
        return send(
          201,
          await store.addCommitment(ctx, ws, await r.body()),
          true,
        );
      if (item && action === 'close' && post)
        return send(200, await store.closeCommitment(ctx, ws, item), true);
      break;
    case 'reinvestment':
      if (!item && get)
        return send(200, await store.reinvestmentCapacity(ctx, ws), false);
      if (item === 'policy' && !action && get)
        return send(200, await store.getReinvestmentPolicy(ctx, ws), false);
      if (item === 'policy' && !action && post)
        return send(
          201,
          await store.setReinvestmentPolicy(ctx, ws, await r.body()),
          true,
        );
      if (item === 'allocations' && !action && get)
        return send(
          200,
          await store.listAllocations(ctx, ws, pageQuery(q)),
          false,
        );
      if (item === 'allocations' && !action && post)
        return send(
          201,
          await store.allocateReinvestment(ctx, ws, await r.body()),
          true,
        );
      if (item === 'tranches' && !action && get)
        return send(
          200,
          await store.listTranches(ctx, ws, pageQuery(q)),
          false,
        );
      if (item === 'settle-losses' && !action && post)
        return send(200, await store.settleReinvestmentLosses(ctx, ws), true);
      break;
  }
  return false;
}
