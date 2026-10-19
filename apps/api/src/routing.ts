import type { ModelBroker } from '@creator/broker';
import { runPromotionBenchmark } from '@creator/broker';
import type { CommandContext, RoutingStore } from '@creator/db';

/** X01 routing routes under /api/workspaces/:ws/route-*. Returns false when not matched. */
export async function routingRoutes(r: {
  store: RoutingStore;
  broker: ModelBroker;
  ctx: CommandContext;
  ws: string;
  collection: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  url: URL;
  body: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  const { store, broker, ctx, ws, collection, item, action, method, send } = r;
  const get = method === 'GET';
  const post = method === 'POST';
  switch (collection) {
    case 'route-registries':
      if (!item && get)
        return send(200, await store.listModelRegistries(ctx, ws), false);
      if (!item && post)
        return send(
          201,
          await store.registerModelRegistry(ctx, ws, await r.body()),
          true,
        );
      break;
    case 'route-policies':
      if (!item && get)
        return send(200, await store.listRoutePolicies(ctx, ws), false);
      if (!item && post)
        return send(
          201,
          await store.setRoutePolicy(ctx, ws, await r.body()),
          true,
        );
      break;
    case 'route-benchmarks':
      if (!item && post)
        return send(
          201,
          await store.registerBenchmark(ctx, ws, await r.body()),
          true,
        );
      break;
    case 'route-promotions':
      if (!item && get)
        return send(200, await store.listPromotions(ctx, ws), false);
      if (!item && post)
        return send(
          201,
          await store.createPromotion(ctx, ws, await r.body()),
          true,
        );
      if (item && !action && get)
        return send(200, await store.getPromotion(ctx, ws, item), false);
      if (item && action === 'benchmark' && post)
        return send(
          200,
          await runPromotionBenchmark(
            store,
            broker,
            ctx,
            ws,
            item,
            await r.body(),
          ),
          true,
        );
      if (item && action === 'benchmark-results' && get)
        return send(200, await store.benchmarkResults(ctx, ws, item), false);
      if (item && action === 'advance' && post)
        return send(
          200,
          await store.advancePromotion(ctx, ws, item, await r.body()),
          true,
        );
      if (item && action === 'rollback' && post)
        return send(
          200,
          await store.rollbackPromotion(ctx, ws, item, await r.body()),
          true,
        );
      break;
    case 'route-decisions': {
      if (!item && get) {
        const run = r.url.searchParams.get('run');
        return send(
          200,
          await store.listRouteDecisions(ctx, ws, run ? { runId: run } : {}),
          false,
        );
      }
      if (!item && post)
        return send(
          201,
          await store.decideRoute(ctx, ws, await r.body()),
          true,
        );
      if (item && !action && get)
        return send(200, await store.getRouteDecision(ctx, ws, item), false);
      if (item && action === 'call' && post) {
        const variant =
          r.url.searchParams.get('variant') === 'shadow' ? 'shadow' : 'primary';
        return send(
          200,
          await broker.callRouted(ctx, ws, item, variant, await r.body()),
          true,
        );
      }
      if (item && action === 'outcomes' && get)
        return send(200, await store.listRouteOutcomes(ctx, ws, item), false);
      if (item && action === 'outcomes' && post)
        return send(
          201,
          await store.recordRouteOutcome(ctx, ws, item, await r.body()),
          true,
        );
      if (item && action === 'escalate' && post)
        return send(
          201,
          await store.escalateRoute(ctx, ws, item, await r.body()),
          true,
        );
      break;
    }
    default:
      return false;
  }
  return false;
}
