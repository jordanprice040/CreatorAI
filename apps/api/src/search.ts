import { z, parse, RemoveMemberRequestSchema } from '@creator/contracts';
import type { SearchService } from '@creator/broker';
import type { CommandContext, SearchStore } from '@creator/db';

const AddMemberRequestSchema = z.strictObject({
  actor_id: z.uuid(),
  role: z.enum(['owner', 'editor', 'viewer']),
});

/**
 * X03 routes: saved queries, semantic search, audit questions and plans, lineage graphs and
 * exports, and workspace membership. Returns false when not matched.
 */
export async function searchRoutes(r: {
  store: SearchStore;
  service: SearchService;
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
  const p = r.url.searchParams;
  switch (collection) {
    case 'saved-queries':
      if (!item && get)
        return send(200, await store.listSavedQueries(ctx, ws), false);
      if (!item && post)
        return send(201, await store.saveQuery(ctx, ws, await r.body()), true);
      if (item && !action && get)
        return send(200, await store.getSavedQuery(ctx, ws, item), false);
      if (item && action === 'run' && get) {
        await store.drainOutbox();
        return send(200, await store.runSavedQuery(ctx, ws, item), false);
      }
      if (item && action === 'archive' && post)
        return send(200, await store.archiveSavedQuery(ctx, ws, item), true);
      break;
    case 'semantic-search':
      if (!item && post)
        return send(
          200,
          await service.semanticSearch(ctx, ws, await r.body()),
          true,
        );
      break;
    case 'audit-questions':
      if (!item && post) {
        await store.drainOutbox();
        return send(
          200,
          await service.askQuestion(ctx, ws, await r.body()),
          true,
        );
      }
      break;
    case 'audit-plans':
      // A plan given directly (for example one saved from an earlier answer). It is held to
      // the same strict schema and runs in the same read-only transaction.
      if (!item && post) {
        await store.drainOutbox();
        const body = (await r.body()) as { question?: unknown; plan?: unknown };
        return send(
          200,
          await store.answerPlan(ctx, ws, body?.plan, {
            question: String(body?.question ?? '(plan given directly)').slice(
              0,
              500,
            ),
            compiler: 'rules',
          }),
          false,
        );
      }
      break;
    case 'lineage-verify':
      if (!item && post)
        return send(
          200,
          await store.verifyLineageExport(ctx, ws, await r.body()),
          false,
        );
      break;
    case 'entities':
      if (
        item &&
        (action === 'lineage-graph' || action === 'lineage-export') &&
        get
      ) {
        const req: Record<string, unknown> = {};
        if (p.get('direction')) req.direction = p.get('direction');
        if (p.get('depth')) req.depth = Number(p.get('depth'));
        if (p.get('max_nodes')) req.max_nodes = Number(p.get('max_nodes'));
        return send(
          200,
          action === 'lineage-graph'
            ? await store.lineageGraph(ctx, ws, item, req)
            : await store.exportLineage(ctx, ws, item, req),
          false,
        );
      }
      break;
    case 'members':
      if (!item && post) {
        const b = parse(AddMemberRequestSchema, await r.body());
        await store.addMember(ctx, ws, b.actor_id, b.role);
        return send(201, { actor_id: b.actor_id, role: b.role }, true);
      }
      if (item && action === 'remove' && post) {
        const b = parse(RemoveMemberRequestSchema, {
          ...((await r.body()) as object),
          actor_id: item,
        });
        return send(
          200,
          await store.removeMember(ctx, ws, b.actor_id, b.reason),
          true,
        );
      }
      break;
    default:
      return false;
  }
  return false;
}
