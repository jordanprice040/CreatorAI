import type { MarketingStore, CommandContext } from '@creator/db';
import { MarketingReasonSchema, parse, z } from '@creator/contracts';

export const MARKETING_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(marketing-campaigns|marketing-suppressions)(?:\/([^/]+)(?:\/(grant|cancel|revoke|deliver|reconcile|observe))?)?$/;
export async function marketingRoutes(r: {
  store: MarketingStore;
  ctx: CommandContext;
  ws: string;
  collection: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  body: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}) {
  const { store, ctx, ws, item, action, collection, method, send } = r;
  if (collection === 'marketing-suppressions' && method === 'POST' && !item)
    return send(
      201,
      await store.suppressMarketing(ctx, ws, await r.body()),
      true,
    );
  if (collection !== 'marketing-campaigns') return false;
  if (!item && method === 'GET')
    return send(200, await store.listCampaigns(ctx, ws), false);
  if (!item && method === 'POST')
    return send(201, await store.draftCampaign(ctx, ws, await r.body()), true);
  if (item && !action && method === 'GET')
    return send(200, await store.inspectCampaign(ctx, ws, item), false);
  if (!item || method !== 'POST') return false;
  const body = await r.body();
  switch (action) {
    case 'grant':
      return send(201, await store.grantCampaign(ctx, ws, item, body), true);
    case 'cancel':
      return send(200, await store.controlCampaign(ctx, ws, item, body), true);
    case 'deliver':
      return send(200, await store.deliverCampaign(ctx, ws, item, body), true);
    case 'observe':
      return send(201, await store.observeMarketing(ctx, ws, item, body), true);
    case 'revoke': {
      const b = parse(
        MarketingReasonSchema.extend({ grant_id: z.uuid() }),
        body,
      );
      return send(
        200,
        await store.controlCampaign(
          ctx,
          ws,
          item,
          { reason: b.reason },
          b.grant_id,
        ),
        true,
      );
    }
    case 'reconcile': {
      const b = parse(z.strictObject({ delivery_id: z.uuid() }), body);
      return send(
        200,
        await store.reconcileMarketing(ctx, ws, item, b.delivery_id),
        true,
      );
    }
  }
  return false;
}
