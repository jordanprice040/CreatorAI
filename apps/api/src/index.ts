import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import pg from 'pg';
import {
  BrokerStatusSchema,
  ContractError,
  contractSchemas,
  HealthSchema,
  SourceBrokerStatusSchema,
  parse,
  id as idSchema,
} from '@creator/contracts';
import {
  authConfig,
  runFixture,
  serviceConfig,
  sourcePolicyHash,
} from '@creator/domain';
import {
  DiscoveryStore,
  assertSchemaCurrent,
  databaseUrl,
  ORCHESTRATOR_ACTOR_ID,
  type CommandContext,
} from '@creator/db';
import {
  FixtureAdapter,
  ModelBroker,
  liveAdapterFromEnv,
} from '@creator/broker';
import { Worker } from '@creator/orchestrator';
import {
  FIXTURE_SOURCE_POLICY,
  FixtureSourceAdapter,
  SourceBroker,
  sourceConfigFromEnv,
} from '@creator/research';
import { createAuth } from './auth.js';

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
// Local single-owner deployment: a signed-in session acts as this configured owner actor.
export const DEFAULT_OWNER_ACTOR_ID = '00000000-0000-4000-8000-000000000001';
/** System actor that records crash recovery of lost broker attempts. */
export const BROKER_ACTOR_ID = '00000000-0000-4000-8000-000000000002';
/** An in-flight fetch older than this lost its process; sweeps close it as interrupted. */
const RETRIEVAL_STALE_MS = 120_000;
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
  UNAUTHENTICATED: 401,
  CSRF_DENIED: 403,
  EXPIRED: 409,
  BUDGET_EXCEEDED: 409,
  LEASE_LOST: 409,
  HUMAN_ONLY_DENIED: 403,
  PRICING_MISSING: 409,
  SCOPE_EXCEEDED: 403,
  BODY_TOO_LARGE: 413,
  VERSION_CONFLICT: 409,
  INVALID_TRANSITION: 409,
  DUPLICATE: 409,
  IDEMPOTENCY_CONFLICT: 409,
  STORAGE_UNAVAILABLE: 503,
};
const RECORD_ROUTE =
  /^\/api\/workspaces(?:\/([^/]+)(?:\/(entities|links|history|runs|grants|decisions|pricing|budgets|reservations|workflows|sources|retrievals|claims|claim-support)(?:\/([^/]+)(?:\/(revisions|archive|redact|lineage|retract|humility-gate|cancel|actions|admissions|decisions|revoke|answer|model-calls|close|reconcile|workflows|pause|resume|source-fetches|support|evidence|discoveries|packet))?)?)?)?$/;

export function createApi(env: Record<string, string | undefined> = {}) {
  // Checked first so a hosted deployment with development login fails with that reason.
  const auth = authConfig(env);
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
  const live = liveAdapterFromEnv(env);
  const sourceConfig = sourceConfigFromEnv(env);
  const store = pool ? new DiscoveryStore(pool) : null;
  const broker = store
    ? new ModelBroker(store, { fixture: new FixtureAdapter(), live })
    : null;
  // Pages reach the app only through this broker, under the owner-approved source policy.
  const sources = store
    ? new SourceBroker(
        store,
        { fixture: new FixtureSourceAdapter(), live: sourceConfig.adapter },
        { fixture: FIXTURE_SOURCE_POLICY, live: sourceConfig.policy },
      )
    : null;
  const brokerActor = { actorId: BROKER_ACTOR_ID };
  // Workflows run on the server, not in the page: this in-process worker (or a separate
  // `pnpm worker`) continues them after restarts. CREATOR_WORKER=off leaves it to others.
  const workerMode = env.CREATOR_WORKER ?? 'on';
  if (workerMode !== 'on' && workerMode !== 'off')
    throw new ContractError(
      'INVALID_CONFIG',
      'CREATOR_WORKER must be on or off.',
    );
  const worker =
    store && broker && workerMode === 'on'
      ? new Worker(store, broker, {
          log: (m) => console.error(m),
          ...(env.CREATOR_WORKER_POLL_MS
            ? { pollMs: Number(env.CREATOR_WORKER_POLL_MS) }
            : {}),
        })
      : null;
  const authn = createAuth(auth, store, ownerId);
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
    await store.ensureActor({
      id: BROKER_ACTOR_ID,
      kind: 'system',
      display_name: 'Budget broker',
    });
    await store.ensureActor({
      id: ORCHESTRATOR_ACTOR_ID,
      kind: 'agent',
      display_name: 'Workflow worker',
    });
    storage = 'postgresql';
    await store.sweepStale(brokerActor);
    await store.sweepRetrievals(brokerActor, RETRIEVAL_STALE_MS);
    await store.drainOutbox();
    worker?.start();
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
  let ticks = 0;
  const relay = store
    ? setInterval(() => {
        if (storage !== 'postgresql') return;
        void store.drainOutbox().catch(() => undefined);
        if (++ticks % 15 === 0) {
          void store.sweepStale(brokerActor).catch(() => undefined);
          void store
            .sweepRetrievals(brokerActor, RETRIEVAL_STALE_MS)
            .catch(() => undefined);
        }
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
    const method = req.method ?? 'GET';
    const session = await authn.require(req, method !== 'GET');
    const [, ws, collection, item, action] = match;
    const correlation = header(req, 'x-correlation-id');
    const causation = header(req, 'x-causation-id');
    const key = header(req, 'idempotency-key');
    const ctx: CommandContext = {
      actorId: session.actor_id,
      ...(correlation ? { correlationId: correlation } : {}),
      ...(causation ? { causationId: causation } : {}),
      ...(key ? { idempotencyKey: key } : {}),
    };
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
      if (method === 'GET' && action === 'humility-gate')
        return send(200, await store.humilityVerdict(ctx, ws, item), false);
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
    } else if (collection === 'runs') {
      if (!item && method === 'GET')
        return send(200, await store.listRuns(ctx, ws), false);
      if (!item && method === 'POST')
        return send(
          201,
          await store.registerRun(ctx, ws, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'cancel') {
        const cancelled = await store.cancelRun(
          ctx,
          ws,
          item,
          await readJson(req),
        );
        // Stop in-flight calls too; their exposure stays held until reconciled.
        broker?.cancelRun(cancelled.run_id);
        return send(200, cancelled, true);
      }
      if (item && method === 'POST' && action === 'workflows')
        return send(
          201,
          await store.startWorkflow(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'discoveries')
        return send(
          201,
          await store.startDiscovery(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'model-calls')
        return send(
          200,
          await broker!.call(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'source-fetches')
        return send(
          200,
          await sources!.fetch(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'actions')
        return send(
          200,
          await store.admitAction(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'GET' && action === 'admissions')
        return send(200, await store.listAdmissions(ctx, ws, item), false);
      if (item && method === 'POST' && action === 'decisions')
        return send(
          201,
          await store.requestDecision(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'grants') {
      if (!item && method === 'GET')
        return send(200, await store.listGrants(ctx, ws), false);
      if (!item && method === 'POST')
        return send(
          201,
          await store.createStandingGrant(ctx, ws, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'revisions')
        return send(
          200,
          await store.reviseGrant(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'revoke')
        return send(
          200,
          await store.revokeGrant(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'decisions') {
      if (!item && method === 'GET') {
        const status = url.searchParams.get('status');
        const run = url.searchParams.get('run');
        return send(
          200,
          await store.listDecisions(ctx, ws, {
            ...(status ? { status } : {}),
            ...(run ? { runId: run } : {}),
          }),
          false,
        );
      }
      if (item && method === 'GET' && !action)
        return send(200, await store.getDecision(ctx, ws, item), false);
      if (item && method === 'POST' && action === 'answer')
        return send(
          200,
          await store.answerDecision(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'pricing' && !item) {
      if (method === 'GET')
        return send(200, await store.listPricing(ctx, ws), false);
      if (method === 'POST')
        return send(
          201,
          await store.createPricing(ctx, ws, await readJson(req)),
          true,
        );
    } else if (collection === 'budgets') {
      if (!item && method === 'GET')
        return send(200, await store.listEnvelopes(ctx, ws), false);
      if (!item && method === 'POST')
        return send(
          201,
          await store.createEnvelope(ctx, ws, await readJson(req)),
          true,
        );
      if (item && !action && method === 'GET')
        return send(200, await store.getEnvelope(ctx, ws, item), false);
      if (item && action === 'close' && method === 'POST')
        return send(
          200,
          await store.closeEnvelope(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'reservations') {
      if (!item && method === 'GET') {
        const envelope = url.searchParams.get('envelope');
        const run = url.searchParams.get('run');
        const operation = url.searchParams.get('operation');
        return send(
          200,
          await store.listReservations(ctx, ws, {
            ...(envelope ? { envelopeId: envelope } : {}),
            ...(run ? { runId: run } : {}),
            ...(operation ? { operationId: operation } : {}),
          }),
          false,
        );
      }
      if (item && action === 'reconcile' && method === 'POST')
        return send(
          200,
          await store.reconcile(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'workflows') {
      if (!item && method === 'GET') {
        const run = url.searchParams.get('run');
        return send(
          200,
          await store.listWorkflows(ctx, ws, run ? { runId: run } : {}),
          false,
        );
      }
      if (item && !action && method === 'GET')
        return send(200, await store.getWorkflow(ctx, ws, item), false);
      if (item && action === 'packet' && method === 'GET')
        return send(200, await store.discoveryPacket(ctx, ws, item), false);
      if (
        item &&
        method === 'POST' &&
        (action === 'pause' || action === 'resume' || action === 'cancel')
      ) {
        const detail = await store.controlWorkflow(
          ctx,
          ws,
          item,
          action,
          await readJson(req),
        );
        // Stop this process's in-flight calls now; other workers see it on their next heartbeat.
        if (action === 'cancel') broker?.cancelRun(detail.workflow.run_id);
        return send(200, detail, true);
      }
    } else if (collection === 'sources') {
      if (!item && method === 'GET')
        return send(200, await store.listSources(ctx, ws), false);
      if (item && !action && method === 'GET')
        return send(200, await store.getSource(ctx, ws, item), false);
    } else if (collection === 'retrievals' && !item && method === 'GET') {
      const run = url.searchParams.get('run');
      return send(
        200,
        await store.listRetrievals(ctx, ws, run ? { runId: run } : {}),
        false,
      );
    } else if (collection === 'claims' && item) {
      if (action === 'support' && method === 'POST')
        return send(
          201,
          await store.addClaimSupport(ctx, ws, item, await readJson(req)),
          true,
        );
      if (action === 'evidence' && method === 'GET') {
        const days = url.searchParams.get('max_age_days');
        return send(
          200,
          await store.claimEvidence(
            ctx,
            ws,
            item,
            days === null ? undefined : Number(days),
          ),
          false,
        );
      }
    } else if (collection === 'claim-support' && item) {
      if (action === 'retract' && method === 'POST')
        return send(
          200,
          await store.retractClaimSupport(ctx, ws, item, await readJson(req)),
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
      if (req.method === 'GET' && req.url === '/api/broker/status')
        return respond(
          res,
          200,
          parse(BrokerStatusSchema, {
            fixture_adapter: 'deterministic-fixture-broker-v1',
            live: { openai: live ? 'configured_unverified' : 'not_configured' },
            note: live
              ? `Live adapter for ${live.model_id} is configured; a call still needs pricing, a covering grant and a funded envelope. No live call has been verified.`
              : 'Fixture workspaces use the deterministic adapter. Real workspaces are denied until a live provider is configured.',
          }),
        );
      if (req.method === 'GET' && req.url === '/api/sources/status')
        return respond(
          res,
          200,
          parse(SourceBrokerStatusSchema, {
            fixture_adapter: 'deterministic-fixture-corpus-v1',
            live: sourceConfig.adapter
              ? 'configured_unverified'
              : 'not_configured',
            approved_hosts:
              sourceConfig.policy?.hosts.map(
                (h) =>
                  `${h.host}${h.retention === 'hash_only' ? ' (hash only)' : ''}`,
              ) ?? [],
            policy_hash: sourceConfig.policy
              ? sourcePolicyHash(sourceConfig.policy)
              : null,
            note: sourceConfig.adapter
              ? 'Live fetch is configured for the approved hosts; each fetch still needs a covering source.fetch grant. No live fetch has been verified.'
              : 'Fixture workspaces read the synthetic fixture corpus. Real workspaces are denied until CREATOR_SOURCE_FETCH=live and CREATOR_SOURCE_HOSTS are set.',
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
      const url = new URL(req.url ?? '/', 'http://local');
      if (
        url.pathname.startsWith('/api/auth/') &&
        url.pathname !== '/api/auth/status' &&
        store
      )
        await ensureReady().catch((e: unknown) => {
          throw e instanceof ContractError
            ? e
            : (storageError(e) ??
                new ContractError(
                  'STORAGE_UNAVAILABLE',
                  'Database unavailable.',
                ));
        });
      if (
        await authn.route(
          req,
          res,
          url,
          () => readJson(req),
          (status, value) => respond(res, status, value),
        )
      )
        return;
      if (await records(req, res, url)) return;
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
    await worker?.stop();
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await pool?.end();
  }
  return {
    server,
    config,
    store,
    broker,
    sources,
    worker,
    ready: () => ready,
    close,
    authMode: authn.mode,
    /** The development login code generated at startup, if one was not configured. */
    loginCode: authn.generatedCode,
  };
}
