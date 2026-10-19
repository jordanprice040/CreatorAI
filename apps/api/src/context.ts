import type { ContextService } from '@creator/broker';
import type { CommandContext, ContextStore } from '@creator/db';

/** X02 context routes under /api/workspaces/:ws/context-*. Returns false when not matched. */
export async function contextRoutes(r: {
  store: ContextStore;
  service: ContextService;
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
  const { store, service, ctx, ws, collection, item, action, method, send } = r;
  const get = method === 'GET';
  const post = method === 'POST';
  const run = r.url.searchParams.get('run');
  switch (collection) {
    case 'context-capabilities':
      if (!item && get)
        return send(200, await store.listCapabilities(ctx, ws), false);
      if (!item && post)
        return send(
          201,
          await store.registerCapabilities(ctx, ws, await r.body()),
          true,
        );
      break;
    case 'context-index':
      if (!item && get)
        return send(
          200,
          await store.listIndex(ctx, ws, r.url.searchParams.get('corpus')),
          false,
        );
      if (!item && post)
        return send(200, await store.indexItems(ctx, ws, await r.body()), true);
      if (item === 'records' && !action && post)
        return send(
          200,
          await store.indexRecords(ctx, ws, await r.body()),
          true,
        );
      break;
    case 'context-packs':
      if (!item && get)
        return send(200, await store.listPacks(ctx, ws, run), false);
      if (!item && post)
        return send(201, await store.buildPack(ctx, ws, await r.body()), true);
      if (item && !action && get)
        return send(200, await store.getPack(ctx, ws, item), false);
      if (item && action === 'compact' && post) {
        const body = await r.body();
        const method = (body as { method?: unknown } | null)?.method;
        return send(
          201,
          method === 'model'
            ? await service.compactWithModel(ctx, ws, item, body)
            : await store.compactPack(ctx, ws, item, body),
          true,
        );
      }
      if (item && action === 'compactions' && get)
        return send(200, await store.listCompactions(ctx, ws, item), false);
      break;
    case 'context-handoffs':
      if (!item && post)
        return send(
          201,
          await store.createHandoff(ctx, ws, await r.body()),
          true,
        );
      if (item && !action && get)
        return send(200, await store.getHandoff(ctx, ws, item), false);
      break;
    case 'context-calls':
      if (!item && post)
        return send(
          200,
          await service.contextCall(ctx, ws, await r.body()),
          true,
        );
      break;
    case 'context-cache':
      if (!item && get) return send(200, await store.listCache(ctx, ws), false);
      if (item && action === 'invalidate' && post)
        return send(
          200,
          await store.invalidateCacheEntry(ctx, ws, item, await r.body()),
          true,
        );
      break;
    case 'context-batches':
      if (!item && post)
        return send(
          201,
          await service.submitBatch(ctx, ws, await r.body()),
          true,
        );
      if (item && !action && get)
        return send(200, await store.getBatch(ctx, ws, item), false);
      if (item && action === 'poll' && post)
        return send(200, await service.pollBatch(ctx, ws, item), true);
      break;
    case 'context-evaluations':
      if (!item && post)
        return send(
          201,
          await store.createContextEvaluation(ctx, ws, await r.body()),
          true,
        );
      if (item && !action && get)
        return send(
          200,
          await store.getContextEvaluation(ctx, ws, item),
          false,
        );
      if (item && action === 'run' && post)
        return send(
          200,
          await service.runContextEvaluation(ctx, ws, item),
          true,
        );
      break;
    case 'context-usage':
      if (!item && get)
        return send(200, await store.contextUsage(ctx, ws, run), false);
      break;
    default:
      return false;
  }
  return false;
}
