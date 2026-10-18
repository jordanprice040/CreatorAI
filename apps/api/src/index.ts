import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import pg from 'pg';
import {
  ContractError,
  contractSchemas,
  HealthSchema,
  parse,
  id as idSchema,
} from '@creator/contracts';
import { runFixture, serviceConfig } from '@creator/domain';
import {
  Store,
  assertSchemaCurrent,
  databaseUrl,
  type CommandContext,
} from '@creator/db';

const MAX_BODY = 65536;
function respond(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function readJson(req: IncomingMessage): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new ContractError('INVALID_CONTRACT', 'Expected application/json.');
  if (Number(req.headers['content-length'] ?? 0) > MAX_BODY) {
    req.resume();
    throw new ContractError('BODY_TOO_LARGE', 'Request exceeds 64 KiB.');
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > MAX_BODY)
      throw new ContractError('BODY_TOO_LARGE', 'Request exceeds 64 KiB.');
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } catch {
    throw new ContractError('INVALID_CONTRACT', 'Malformed JSON.');
  }
}
// Local single-owner deployment: requests act as this configured actor. There is no
// authentication yet (T03); the loopback Host/Origin checks below are the boundary.
export const DEFAULT_OWNER_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
const CONNECTION_FAILURES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'ENOTFOUND',
  '57P01',
  '3D000',
  '28P01',
]);
function storageError(error: unknown): ContractError | null {
  if (error === null || typeof error !== 'object' || !('code' in error))
    return null;
  const code = String(error.code);
  if (CONNECTION_FAILURES.has(code) || code.startsWith('08'))
    return new ContractError('STORAGE_UNAVAILABLE', 'Database unavailable.');
  if (code.startsWith('23') || code === 'P0001')
    return new ContractError(
      'INVALID_CONTRACT',
      'A database integrity rule rejected the change.',
    );
  return null;
}
function header(req: IncomingMessage, name: string): string | undefined {
  const v = req.headers[name];
  return typeof v === 'string' && v !== '' ? v : undefined;
}
const statusFor: Partial<Record<ContractError['code'], number>> = {
  INTERNAL_ERROR: 500,
  NOT_FOUND: 404,
  ORIGIN_DENIED: 403,
  ACCESS_DENIED: 403,
  SCOPE_EXCEEDED: 403,
  BODY_TOO_LARGE: 413,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  DUPLICATE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STORAGE_UNAVAILABLE: 503,
};
const RECORD_ROUTE =
  /^\/api\/workspaces(?:\/([^/]+)(?:\/(entities|links|history)(?:\/([^/]+)(?:\/(revisions|archive|redact|lineage|retract))?)?)?)?$/;

export function createApi(env: Record<string, string | undefined> = {}) {
  const config = serviceConfig(env);
  const dbUrl = databaseUrl(env.CREATOR_DATABASE_URL);
  const ownerId = parse(
    idSchema,
    env.CREATOR_OWNER_ACTOR_ID ?? DEFAULT_OWNER_ACTOR_ID,
    'INVALID_CONFIG',
  );
  const pool = dbUrl
    ? new pg.Pool({
        connectionString: dbUrl,
        max: 5,
        connectionTimeoutMillis: 3000,
      })
    : null;
  // Idle-client errors (server restart, network drop) must not crash the API; requests then see STORAGE_UNAVAILABLE.
  pool?.on('error', (e) =>
    console.error(`PostgreSQL idle client error: ${e.message}`),
  );
  const store = pool ? new Store(pool) : null;
  let storage: 'postgresql' | 'not_configured' | 'unavailable' = pool
    ? 'unavailable'
    : 'not_configured';
  async function init() {
    if (!pool || !store) return;
    await assertSchemaCurrent(pool);
    await store.ensureActor({
      id: ownerId,
      kind: 'human',
      display_name: 'Local owner',
    });
    storage = 'postgresql';
    await store.drainOutbox();
  }
  let ready = init();
  ready.catch(() => undefined);
  // A database that was down or unmigrated at startup is re-checked on the next request.
  async function ensureReady() {
    try {
      await ready;
    } catch {
      ready = init();
      await ready;
    }
  }
  // Outbox relay: deliveries are idempotent, so a crash between projection and ack is safe.
  const relay = store
    ? setInterval(() => {
        if (storage === 'postgresql')
          void store.drainOutbox().catch(() => undefined);
      }, 1000)
    : null;
  relay?.unref();

  async function records(req: IncomingMessage, res: ServerResponse, url: URL) {
    const match = RECORD_ROUTE.exec(url.pathname);
    if (!match) return false;
    if (!store)
      throw new ContractError(
        'STORAGE_UNAVAILABLE',
        'Persistence is not configured; set CREATOR_DATABASE_URL.',
      );
    await ensureReady().catch((e: unknown) => {
      throw e instanceof ContractError
        ? e
        : (storageError(e) ??
            new ContractError('STORAGE_UNAVAILABLE', 'Database unavailable.'));
    });
    const [, ws, collection, item, action] = match;
    const correlation = header(req, 'x-correlation-id');
    const causation = header(req, 'x-causation-id');
    const key = header(req, 'idempotency-key');
    const ctx: CommandContext = {
      actorId: ownerId,
      ...(correlation ? { correlationId: correlation } : {}),
      ...(causation ? { causationId: causation } : {}),
      ...(key ? { idempotencyKey: key } : {}),
    };
    const method = req.method ?? 'GET';
    const send = async (status: number, value: unknown, mutated: boolean) => {
      if (mutated) await store.drainOutbox().catch(() => undefined);
      respond(res, status, value);
      return true;
    };
    if (!ws) {
      if (method === 'GET')
        return send(200, await store.listWorkspaces(ctx), false);
      if (method === 'POST')
        return send(
          201,
          await store.createWorkspace(ctx, await readJson(req)),
          true,
        );
    } else if (collection === 'entities' && !item) {
      if (method === 'GET') {
        const kind = url.searchParams.get('kind');
        const status = url.searchParams.get('status');
        return send(
          200,
          await store.listEntities(ctx, ws, {
            ...(kind ? { kind } : {}),
            ...(status ? { status } : {}),
          }),
          false,
        );
      }
      if (method === 'POST')
        return send(
          201,
          await store.createEntity(ctx, ws, await readJson(req)),
          true,
        );
    } else if (collection === 'entities' && item) {
      if (method === 'GET' && !action)
        return send(200, await store.getEntity(ctx, ws, item), false);
      if (method === 'GET' && action === 'lineage') {
        const direction = url.searchParams.get('direction') ?? 'upstream';
        if (direction !== 'upstream' && direction !== 'downstream')
          throw new ContractError(
            'INVALID_CONTRACT',
            'direction must be upstream or downstream.',
          );
        return send(200, await store.lineage(ctx, ws, item, direction), false);
      }
      if (method === 'POST' && action === 'revisions')
        return send(
          200,
          await store.reviseEntity(ctx, ws, item, await readJson(req)),
          true,
        );
      if (method === 'POST' && action === 'archive')
        return send(
          200,
          await store.archiveEntity(ctx, ws, item, await readJson(req)),
          true,
        );
      if (method === 'POST' && action === 'redact')
        return send(
          200,
          await store.redactEntity(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'links') {
      if (method === 'POST' && !item)
        return send(
          201,
          await store.createLink(ctx, ws, await readJson(req)),
          true,
        );
      if (method === 'POST' && item && action === 'retract')
        return send(
          200,
          await store.retractLink(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'history' && !item) {
      if (method === 'GET') {
        await store.drainOutbox();
        const subject = url.searchParams.get('subject');
        return send(
          200,
          await store.listHistory(
            ctx,
            ws,
            subject ? { subjectId: subject } : {},
          ),
          false,
        );
      }
    }
    throw new ContractError('NOT_FOUND', 'Route not found.');
  }

  const server = createServer((req, res) => {
    void (async () => {
      // Restrict Host and browser origins even for this stateless, fixture-only local service.
      const localPort = req.socket.localPort;
      if (
        req.headers.host !== `127.0.0.1:${localPort}` &&
        req.headers.host !== `localhost:${localPort}`
      )
        throw new ContractError(
          'ORIGIN_DENIED',
          'Only loopback Host headers are accepted.',
        );
      const origin = req.headers.origin;
      if (
        origin &&
        ![
          `http://127.0.0.1:${config.web_port}`,
          `http://localhost:${config.web_port}`,
          `http://127.0.0.1:${localPort}`,
          `http://localhost:${localPort}`,
        ].includes(origin)
      )
        throw new ContractError('ORIGIN_DENIED', 'Browser origin denied.');
      if (req.method === 'GET' && req.url === '/api/health')
        return respond(
          res,
          200,
          parse(HealthSchema, {
            schema_version: '1.0',
            status: 'ok',
            service: 'creator-agent-api',
            data_mode: 'fixture',
            provider: 'deterministic-fixture-v1',
            live_enabled: false,
            persistent: storage === 'postgresql',
            storage,
          }),
        );
      if (req.method === 'POST' && req.url === '/api/fixture')
        return respond(res, 200, runFixture(await readJson(req)));
      if (req.method === 'POST' && req.url === '/api/validate') {
        const body = await readJson(req);
        if (
          !body ||
          typeof body !== 'object' ||
          !('kind' in body) ||
          !('value' in body) ||
          Object.keys(body).length !== 2 ||
          typeof body.kind !== 'string' ||
          !Object.hasOwn(contractSchemas, body.kind)
        )
          throw new ContractError(
            'INVALID_CONTRACT',
            'Expected {kind, value} with a registered contract kind.',
          );
        const schema =
          contractSchemas[body.kind as keyof typeof contractSchemas];
        const validated = schema.safeParse(body.value);
        if (!validated.success)
          throw new ContractError(
            'INVALID_CONTRACT',
            'Contract validation failed.',
            validated.error.issues.map(
              (i) => `${i.path.join('.')}: ${i.message}`,
            ),
          );
        return respond(res, 200, {
          valid: true,
          schema_version: '1.0',
          kind: body.kind,
          note: 'Structural validation only; not authorization or verified evidence.',
        });
      }
      if (await records(req, res, new URL(req.url ?? '/', 'http://local')))
        return;
      throw new ContractError('NOT_FOUND', 'Route not found.');
    })().catch((error: unknown) => {
      const e =
        error instanceof ContractError
          ? error
          : (storageError(error) ??
            new ContractError('INTERNAL_ERROR', 'Unexpected server failure.'));
      const status = statusFor[e.code] ?? 400;
      if (!res.destroyed && !res.headersSent)
        respond(res, status, {
          error: { code: e.code, message: e.message, details: e.details },
        });
    });
  });
  server.requestTimeout = 10000;
  server.headersTimeout = 10000;
  async function close() {
    if (relay) clearInterval(relay);
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool?.end();
  }
  return { server, config, store, ready: () => ready, close };
}
