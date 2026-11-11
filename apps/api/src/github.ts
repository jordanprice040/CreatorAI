import type { IncomingMessage } from 'node:http';
import { ContractError } from '@creator/contracts';
import type { GitHubService } from '@creator/broker';
import type { CommandContext, GitHubStore } from '@creator/db';

/** X04 routes under /api/workspaces/:ws/github-*. Matched separately from RECORD_ROUTE. */
export const GITHUB_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(github-connections|github-repositories|github-operations|github-reviews)(?:\/([^/]+)(?:\/(verify|revoke|reconcile|deliveries|checks))?)?$/;
/** GitHub delivers here (through the owner's local forwarder; the API binds to loopback). */
export const GITHUB_WEBHOOK_ROUTE = /^\/api\/github\/webhooks\/([^/]+)$/;
const MAX_WEBHOOK = 1024 * 1024;

export async function githubRoutes(r: {
  store: GitHubStore;
  service: GitHubService;
  ctx: CommandContext;
  ws: string;
  collection: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  body: () => Promise<unknown>;
  query?: URLSearchParams;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  const { store, service, ctx, ws, collection, item, action, method, send } = r;
  const get = method === 'GET';
  const post = method === 'POST';
  switch (collection) {
    case 'github-connections':
      if (!item && get)
        return send(200, await store.listGitHubConnections(ctx, ws), false);
      if (!item && post)
        return send(
          201,
          await store.registerGitHubConnection(ctx, ws, await r.body()),
          true,
        );
      if (item && !action && get)
        return send(200, await store.getGitHubConnection(ctx, ws, item), false);
      if (item && action === 'verify' && post)
        return send(200, await service.verify(ctx, ws, item), true);
      if (item && action === 'revoke' && post)
        return send(
          200,
          await store.revokeGitHubConnection(ctx, ws, item, await r.body()),
          true,
        );
      if (item && action === 'deliveries' && get)
        return send(
          200,
          await store.listGitHubDeliveries(ctx, ws, item),
          false,
        );
      break;
    case 'github-repositories':
      if (!item && get)
        return send(200, await store.listGitHubRepositories(ctx, ws), false);
      // P22: read-only; ?pr=<number>.
      if (item && action === 'checks' && get) {
        const pr = Number(r.query?.get('pr') ?? '');
        if (!Number.isSafeInteger(pr) || pr < 1)
          throw new ContractError(
            'INVALID_CONTRACT',
            'Name the pull request number as ?pr=<number>.',
          );
        return send(200, await service.pullChecks(ctx, ws, item, pr), false);
      }
      break;
    case 'github-operations':
      if (!item && get)
        return send(200, await store.listGitHubOperations(ctx, ws), false);
      if (!item && post)
        return send(201, await service.operate(ctx, ws, await r.body()), true);
      if (item && !action && get)
        return send(200, await store.getGitHubOperation(ctx, ws, item), false);
      if (item && action === 'reconcile' && post)
        return send(200, await service.reconcile(ctx, ws, item), true);
      break;
    case 'github-reviews':
      if (!item && post)
        return send(
          201,
          await store.recordGitHubReview(ctx, ws, await r.body()),
          true,
        );
      break;
  }
  return false;
}

/** The raw body, byte for byte: the signature covers exactly what GitHub sent. */
export async function readRaw(req: IncomingMessage): Promise<Buffer> {
  if (Number(req.headers['content-length'] ?? 0) > MAX_WEBHOOK) {
    req.resume();
    throw new ContractError('BODY_TOO_LARGE', 'Webhook exceeds 1 MiB.');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const b = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    size += b.length;
    if (size > MAX_WEBHOOK)
      throw new ContractError('BODY_TOO_LARGE', 'Webhook exceeds 1 MiB.');
    chunks.push(b);
  }
  return Buffer.concat(chunks);
}
