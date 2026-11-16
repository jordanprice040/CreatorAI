import { randomBytes } from 'node:crypto';
import { createMaintenance } from './maintenance.js';
export { createMaintenance } from './maintenance.js';
export { createStorage } from './storage.js';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import pg from 'pg';
import {
  BrokerStatusSchema,
  BrokerCallRequestSchema,
  ContractError,
  z,
  contractSchemas,
  HealthSchema,
  SourceBrokerStatusSchema,
  SEARCH_TYPES,
  parse,
  id as idSchema,
  type PaymentConnection,
  NOTE_MAX,
  PROPOSAL_MAX_BODY_BYTES,
  SaveProposalFileRequestSchema,
  SaveRunbookFileRequestSchema,
  RunCapabilityCheckRequestSchema,
} from '@creator/contracts';
import {
  allowedHosts,
  authConfig,
  deploymentConfig,
  deploymentConfigHash,
  resolveSecretFiles,
  BLOCKING_DECISIONS,
  canonicalHash,
  PROPOSED_PROTOCOL,
  runFixture,
  serviceConfig,
  sourcePolicyHash,
  prepareThemeResearchPlan,
  checkOutcome,
} from '@creator/domain';
import { dirname, resolve } from 'node:path';
import { readFileSync } from 'node:fs';
import {
  OPERATIONS_ACTOR_ID,
  OpsStore,
  StorageStore,
  ConnectionStore,
  DEFAULT_FILE_LIMITS,
  FileStore,
  assertSchemaCurrent,
  databaseUrl,
  ORCHESTRATOR_ACTOR_ID,
  pageQuery,
  type CommandContext,
  type RunbookExport,
} from '@creator/db';
import {
  ContextService,
  FixtureAdapter,
  fixtureBatchAdapters,
  fixtureContextAdapters,
  fixtureRouteAdapters,
  fixtureSearchAdapters,
  ModelBroker,
  SearchService,
  liveAdapterFromEnv,
  liveBatchAdapterFromEnv,
  publicSearchFromEnv,
  BRAVE_SEARCH_ID,
  PlanConnectionService,
  ApiKeyService,
  QualificationQueueRunner,
  planVaultFromEnv,
  claudeCodeHostFromEnv,
  type PlanServiceDeps,
} from '@creator/broker';
import { Worker } from '@creator/orchestrator';
import {
  FixtureProcessor,
  GitHubService,
  PaymentService,
} from '@creator/broker';
import {
  FIXTURE_SOURCE_POLICY,
  FixtureSourceAdapter,
  SourceBroker,
  sourceConfigFromEnv,
} from '@creator/research';
import {
  ArtifactSupervisor,
  ExecutionSupervisor,
  ProductSupervisor,
  TerminalSupervisor,
  checkStudyCode,
  digest,
  readStudyBuild,
  gradePatchCase,
  type BuildPorts,
} from '@creator/executor';
import { createAuth } from './auth.js';
import { WebDiscoveryRunner } from './web-discovery.js';
import { AutopilotRunner, webResearch } from './autopilot.js';
import { desktopRoutes, visitorKey } from './desktop.js';
import {
  GITHUB_ROUTE,
  GITHUB_WEBHOOK_ROUTE,
  githubRoutes,
  readRaw,
} from './github.js';
import {
  PreviewRuns,
  artifactRoutes,
  createPreviewServer,
} from './artifacts.js';
import { PRODUCTS_ROUTE, StudioBuilds, productRoutes } from './products.js';
import {
  PAYMENTS_RETURN_ROUTE,
  PAYMENTS_ROUTE,
  PAYMENTS_WEBHOOK_ROUTE,
  RETURN_BODY,
  paymentRoutes,
} from './payments.js';
import { routingRoutes } from './routing.js';
import {
  CONNECTIONS_ROUTE,
  codexLauncherFromEnv,
  connectionRoutes,
  runCodexBuild,
  runPlanBuildCall,
  planBuildRolesReady,
  PLAN_BUILD_CALL_MAX_BODY,
} from './connections.js';
import { RecipeQualificationRunner } from './recipe-qualification.js';
import { contextRoutes } from './context.js';
import { searchRoutes } from './search.js';
import { STUDY_EFFORT_ROUTE, studyEffortRoutes } from './study-effort.js';
import { RUN_COMPARE_ROUTE, runCompareRoutes } from './run-compare.js';
import {
  FILES_ROUTE,
  SERVER_REQUEST_MS,
  bodyDeadline,
  UploadSlots,
  concurrentUploadsFromEnv,
  fileLimitsFromEnv,
  fileRoutes,
  INERT,
  disposition,
} from './files.js';
import { createOps } from './ops.js';
import { localIdentity, supportReportRoutes } from './support-report.js';
import { PROJECT_REPORT_ROUTE, projectReportRoutes } from './project-report.js';
import { createStorage } from './storage.js';
import {
  runCapabilityCheck,
  studioMachine,
  type CapabilityRunner,
} from './team-checks.js';

const MAX_BODY = 65536;
/**
 * ADR-0060 review M-1: a note may hold NOTE_MAX characters, and JSON can spell each as
 * \uXXXX (6 bytes), so the notes route accepts that much plus room for the envelope.
 */
const NOTES_MAX_BODY = NOTE_MAX * 6 + 1024;
/** ADR-0077: a proposal body may be PROPOSAL_MAX_BODY_BYTES, each byte spelled \uXXXX at worst. */
const PROPOSAL_MAX_REQUEST = PROPOSAL_MAX_BODY_BYTES * 6 + 4096;
function respond(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
async function readJson(
  req: IncomingMessage,
  maxBytes = MAX_BODY,
): Promise<unknown> {
  if (req.headers['content-type']?.split(';')[0]?.trim() !== 'application/json')
    throw new ContractError('INVALID_CONTRACT', 'Expected application/json.');
  const tooLarge = () =>
    new ContractError(
      'BODY_TOO_LARGE',
      `Request exceeds ${maxBytes / 1024} KiB.`,
    );
  if (Number(req.headers['content-length'] ?? 0) > maxBytes) {
    req.resume();
    throw tooLarge();
  }
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk)
      ? chunk
      : Buffer.from(chunk as string);
    size += buffer.length;
    if (size > maxBytes) throw tooLarge();
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
/** System actor that records verified GitHub webhook deliveries (X04). */
export const GITHUB_WEBHOOK_ACTOR_ID = '00000000-0000-4000-8000-000000000004';
/** System actor that records verified payment processor deliveries (X07). */
export const PAYMENT_WEBHOOK_ACTOR_ID = '00000000-0000-4000-8000-000000000007';
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
  LIMIT_EXCEEDED: 429,
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
  /^\/api\/workspaces(?:\/([^/]+)(?:\/(entities|links|history|runs|grants|routine-policies|decisions|pricing|budgets|reservations|workflows|sources|retrievals|claims|claim-support|problems|scorecards|proposals|specs|search|library|destination|activity|overview|actors|studies|study-attempts|protocol-freezes|artifacts|previews|feedback|terminals|route-registries|route-policies|route-benchmarks|route-promotions|route-decisions|context-capabilities|context-index|context-packs|context-handoffs|context-calls|context-cache|context-batches|context-evaluations|context-usage|saved-queries|semantic-search|audit-questions|audit-plans|lineage-verify|members|exploration-preview|web-discoveries|web-discovery-preview|autopilots|automations|autopilot-settings|spec-drafts)(?:\/([^/]+)(?:\/(revisions|archive|redact|lineage|retract|humility-gate|cancel|actions|admissions|build-approvals|routine-policy|decisions|revoke|answer|model-calls|close|reconcile|workflows|pause|resume|source-fetches|source-searches|support|evidence|discoveries|explorations|exploration-packet|assessments|assessment-packet|assessment-preview|explored-briefs|packet|selections|spec-freezes|report|comparison|assign|export|context|entries|artifacts|tests|interventions|finish|deviations|helpers|graders|grader-material|execute|build|build-record|binding|code-check|download|manifest|compare|feedback|previews|terminals|guide|stop|decide|revision|benchmark|benchmark-results|advance|rollback|call|outcomes|escalate|compact|compactions|invalidate|poll|run|link|lineage-graph|lineage-export|research-plan|remove|explanation|reviews|files|runbook|section-drafts|web-discoveries|admit|dismiss|autopilots|continue|automation|allow))?)?)?)?$/;

export function createApi(
  env: Record<string, string | undefined> = {},
  deps: {
    artifacts?: ArtifactSupervisor;
    /** Test seam: the interactive terminal supervisor (ADR-0058). */
    terminals?: TerminalSupervisor;
    /** Test seam: the fixture processor for a payment connection. */
    paymentFixture?: (connection: PaymentConnection) => FixtureProcessor;
    /** Test seam: ChatGPT-plan service with loopback stand-in endpoints (ADR-0042). */
    planService?: (
      store: ConnectionStore,
      extra: { patchScorer: PlanServiceDeps['patchScorer'] },
    ) => PlanConnectionService;
    /** Test seam: runs a built-in capability check's program (ADR-0090). */
    capabilityRunner?: CapabilityRunner;
    /** Test seam: the build qualification harness's worker (ADR-0105). */
    recipeExecutor?: (products: ProductSupervisor) => ExecutionSupervisor;
    /** Test seam (B3): wraps each studio build's ports, for scripted fixture role answers. */
    buildPorts?: (ports: BuildPorts) => BuildPorts;
  } = {},
) {
  // X06: NAME_FILE secrets (Docker/systemd credentials) are loaded before anything reads env.
  env = resolveSecretFiles(env, (p) => readFileSync(p, 'utf8')).env;
  // Checked first so a hosted deployment with development login fails with that reason.
  const auth = authConfig(env);
  const config = serviceConfig(env);
  const deployment = deploymentConfig(env);
  const configHash = deploymentConfigHash(deployment, env);
  const dbUrl = databaseUrl(env.CREATOR_DATABASE_URL, deployment.mode);
  if (deployment.mode === 'hosted') {
    if (!dbUrl)
      throw new ContractError(
        'INVALID_CONFIG',
        'A hosted deployment needs its durable database: set CREATOR_DATABASE_URL or CREATOR_DATABASE_URL_FILE.',
      );
    if (auth.oidc?.web_origin !== deployment.web_origin)
      throw new ContractError(
        'INVALID_CONFIG',
        'CREATOR_WEB_ORIGIN must equal CREATOR_PUBLIC_WEB_ORIGIN in a hosted deployment.',
      );
  }
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
  const publicSearch = publicSearchFromEnv(env, sourceConfig.policy);
  const store = pool ? new ConnectionStore(pool) : null;
  // ADR-0072: workspace files, with storage bounds set by the deployment.
  const fileStore = pool
    ? new FileStore(pool, fileLimitsFromEnv(env, DEFAULT_FILE_LIMITS))
    : null;
  // ADR-0075: uploads in flight per person, per API process.
  const uploadSlots = new UploadSlots(concurrentUploadsFromEnv(env));
  const codexLauncher = codexLauncherFromEnv(env);
  const ops = pool ? new OpsStore(pool) : null;
  // Local product store shared with the owner CLI. Generated code only ever runs in its worker.
  const artifacts =
    deps.artifacts ??
    (() => {
      const products = new ProductSupervisor(
        resolve(env.CREATOR_PRODUCTS_ROOT ?? '.creator/products'),
      );
      return new ArtifactSupervisor(
        products,
        new ExecutionSupervisor(
          products,
          env.CREATOR_WORKER_DISTRO ?? 'Ubuntu',
        ),
      );
    })();
  // ADR-0058: owner-started interactive sessions of verified packages, same product store.
  const terminals =
    deps.terminals ??
    new TerminalSupervisor(
      artifacts.products,
      env.CREATOR_WORKER_DISTRO ?? 'Ubuntu',
    );
  // ADR-0048: patch_build qualification answers run in a throwaway product store beside the
  // studio's, through the same isolated worker; never in the studio's own products.
  const qualificationProducts = new ProductSupervisor(
    resolve(
      dirname(resolve(env.CREATOR_PRODUCTS_ROOT ?? '.creator/products')),
      'plan-qualification-products',
    ),
  );
  const qualificationExecutor = new ExecutionSupervisor(
    qualificationProducts,
    env.CREATOR_WORKER_DISTRO ?? 'Ubuntu',
  );
  const patchScorer = (
    ctx: CommandContext,
    check: Parameters<typeof gradePatchCase>[2],
    text: string | null,
  ) =>
    // F10: the grade keeps its reason, so a failed builder case says where it failed.
    gradePatchCase(
      { products: qualificationProducts, executor: qualificationExecutor },
      ctx.actorId,
      check,
      text,
    );
  // ADR-0042: ChatGPT plan usage. Tokens live in the protected vault, never in the database.
  const planService = store
    ? (deps.planService?.(store, { patchScorer }) ??
      new PlanConnectionService({
        store,
        vault: planVaultFromEnv(env),
        // ADR-0050: the owner's own signed-in Claude Code CLI, in its dedicated folder.
        claudeCode: claudeCodeHostFromEnv(env),
        patchScorer,
      }))
    : null;
  // ADR-0088 (P24): queued qualifications run here, one after another, under a database lease.
  const qualificationQueue =
    store && planService
      ? new QualificationQueueRunner({
          store,
          service: planService,
          onError: (e) =>
            console.error(
              `Qualification queue could not record its state (${e instanceof Error ? e.message : String(e)}).`,
            ),
        })
      : null;
  // ADR-0105 (B1): build qualifications build in a product store of their own beside the
  // studio's (never its products, Gallery or catalog), through the same isolated worker.
  const recipeProducts = new ProductSupervisor(
    resolve(
      dirname(resolve(env.CREATOR_PRODUCTS_ROOT ?? '.creator/products')),
      'recipe-qualification-products',
    ),
  );
  const recipeQualifications =
    store && planService
      ? new RecipeQualificationRunner({
          store,
          service: planService,
          products: recipeProducts,
          executor:
            deps.recipeExecutor?.(recipeProducts) ??
            new ExecutionSupervisor(
              recipeProducts,
              env.CREATOR_WORKER_DISTRO ?? 'Ubuntu',
            ),
          onError: (e) =>
            console.error(
              `Build qualification could not record its state (${e instanceof Error ? e.message : String(e)}).`,
            ),
        })
      : null;
  // ADR-0093 (P28): a workspace's own OpenAI API key, sealed in the same protected vault as
  // the plan sign-ins. The studio's own key (environment) wins when both exist.
  const apiKeys = store
    ? new ApiKeyService({
        store,
        vault: planVaultFromEnv(env),
        environment: live,
        log: (m) => console.error(m),
        ...(env.CREATOR_OPENAI_BASE_URL
          ? { baseUrl: env.CREATOR_OPENAI_BASE_URL }
          : {}),
      })
    : null;
  const broker = store
    ? new ModelBroker(
        store,
        {
          fixture: new FixtureAdapter(),
          live,
          routes: [
            ...fixtureRouteAdapters(),
            ...fixtureContextAdapters(),
            ...fixtureSearchAdapters(),
            ...(publicSearch ? [publicSearch] : []),
          ],
        },
        {
          decisions: store,
          ...(apiKeys
            ? { liveFor: (ctx, ws) => apiKeys.liveFor(ctx, ws) }
            : {}),
        },
      )
    : null;
  // X02: batch adapters are looked up by model; a live one exists only with the live opt-in.
  const liveBatch = liveBatchAdapterFromEnv(env);
  const contextService =
    store && broker
      ? new ContextService(store, broker, [
          ...fixtureBatchAdapters(),
          ...(liveBatch ? [liveBatch] : []),
        ])
      : null;
  // ADR-0046: builds and packaging started from the studio (the desktop app has no CLI).
  const builds =
    store && broker
      ? new StudioBuilds(
          store,
          broker,
          artifacts,
          (ctx, ws, connection, body) =>
            runCodexBuild(
              { store, service: planService, codex: codexLauncher },
              ctx,
              ws,
              connection,
              body,
            ),
          (ctx, ws, connection, body) =>
            runPlanBuildCall(planService, ctx, ws, connection, body),
          (ctx, ws, connection, body) =>
            planBuildRolesReady(planService, ctx, ws, connection, body),
          deps.buildPorts,
        )
      : null;
  // X07: payments. Fixture and test-mode processors only; live payments are not built.
  const payments = store
    ? new PaymentService(store, {
        env,
        ...(deps.paymentFixture ? { fixture: deps.paymentFixture } : {}),
      })
    : null;
  // X04: GitHub operations; live calls need CREATOR_GITHUB=live plus a connection's grant.
  const github = store
    ? new GitHubService(store, {
        env,
        pushSource: async (productId, ws) => {
          const product = await artifacts.products
            .product(productId)
            .catch(() => {
              throw new ContractError('NOT_FOUND', 'Product not found.');
            });
          if (product.binding.workspace_id !== ws.toLowerCase())
            throw new ContractError(
              'SCOPE_EXCEEDED',
              'That product belongs to another workspace.',
            );
          return artifacts.products.repo(productId);
        },
      })
    : null;
  // X03: embedding models semantic search may call, per workspace mode (dated config).
  const searchService =
    store && broker
      ? new SearchService(
          store,
          broker,
          JSON.parse(
            readFileSync(
              new URL(
                '../../../config/search/semantic-models.json',
                import.meta.url,
              ),
              'utf8',
            ),
          ) as unknown,
        )
      : null;
  // Pages reach the app only through this broker, under the owner-approved source policy.
  const sources = store
    ? new SourceBroker(
        store,
        { fixture: new FixtureSourceAdapter(), live: sourceConfig.adapter },
        { fixture: FIXTURE_SOURCE_POLICY, live: sourceConfig.policy },
      )
    : null;
  // ADR-0086 (P12): web discovery through the plan connection's own web search.
  const webDiscovery =
    store && sources && planService
      ? new WebDiscoveryRunner(store, planService, sources)
      : null;
  // ADR-0092 (P13): autopilots drive a run's main path step by step in this process.
  const autopilot = store
    ? new AutopilotRunner(
        store,
        webDiscovery ? webResearch(webDiscovery, store) : null,
        planService
          ? {
              drafts: (ctx, ws, proposalId, body) =>
                planService.proposalSectionDraft(ctx, ws, proposalId, body),
            }
          : {},
      )
    : null;
  const brokerActor = { actorId: BROKER_ACTOR_ID };
  // Per-process salt: stored pairing visitor keys cannot be turned back into addresses.
  const visitorSalt = randomBytes(32).toString('hex');
  const portfolio =
    store && sources ? new PortfolioService(store, sources, artifacts) : null;
  const portfolioScheduler = env.CREATOR_PORTFOLIO_SCHEDULER ?? 'off';
  if (!['on', 'off'].includes(portfolioScheduler))
    throw new ContractError(
      'INVALID_CONFIG',
      'CREATOR_PORTFOLIO_SCHEDULER must be on or off.',
    );
  const maintenance = createMaintenance(store !== null);
  async function schedulerHealth() {
    const enabled = portfolioScheduler === 'on';
    const empty = {
      enabled,
      last_attempt_at: null,
      last_success_at: null,
      error_code: null,
      failing_scopes: 0,
      stopped_scopes: 0,
    };
    if (!enabled || !store) return { ...empty, state: 'off' as const };
    try {
      const s = await store.schedulerSummary();
      return {
        enabled,
        ...s,
        state: s.stopped_scopes
          ? ('stopped' as const)
          : s.failing_scopes
            ? ('failing' as const)
            : s.last_attempt_at
              ? ('ok' as const)
              : ('not_run' as const),
      };
    } catch {
      return { ...empty, state: 'unavailable' as const };
    }
  }
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
          planService: planService ?? undefined,
          log: (m) => console.error(m),
          ...(env.CREATOR_WORKER_POLL_MS
            ? { pollMs: Number(env.CREATOR_WORKER_POLL_MS) }
            : {}),
        })
      : null;
  const authn = createAuth(
    auth,
    store,
    ownerId,
    deployment.mode === 'local' && env.CREATOR_DESKTOP_MANAGED === '1',
  );
  let storage: 'postgresql' | 'not_configured' | 'unavailable' = pool
    ? 'unavailable'
    : 'not_configured';
  let schemaVersion: number | null = null;
  async function init() {
    if (!pool || !store || !ops) return;
    schemaVersion = await assertSchemaCurrent(pool);
    await ops.ensureOperationsActor();
    // Refuses a database labelled for another environment before any work starts.
    await ops.claimEnvironment(
      { actorId: OPERATIONS_ACTOR_ID },
      deployment.environment,
    );
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
    await store.ensureActor({
      id: GITHUB_WEBHOOK_ACTOR_ID,
      kind: 'system',
      display_name: 'GitHub webhook receiver',
    });
    await store.ensureActor({
      id: PAYMENT_WEBHOOK_ACTOR_ID,
      kind: 'system',
      display_name: 'Payment webhook receiver',
    });
    storage = 'postgresql';
    await maintenance.run('broker_recovery', () =>
      store.sweepStale(brokerActor),
    );
    await maintenance.run('retrieval_recovery', () =>
      store.sweepRetrievals(brokerActor, RETRIEVAL_STALE_MS),
    );
    await maintenance.run('outbox', () => store.drainOutbox());
    worker?.start();
    qualificationQueue?.start();
    recipeQualifications?.start();
    // Autopilots a stopped studio left running carry on (each step's start is idempotent).
    autopilot?.watch();
    if (portfolioScheduler === 'on') portfolio?.start();
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
        void maintenance
          .run('outbox', () => store.drainOutbox())
          .catch(() => undefined);
        if (++ticks % 15 === 0) {
          void maintenance
            .run('broker_recovery', () => store.sweepStale(brokerActor))
            .catch(() => undefined);
          void maintenance
            .run('retrieval_recovery', () =>
              store.sweepRetrievals(brokerActor, RETRIEVAL_STALE_MS),
            )
            .catch(() => undefined);
        }
      }, 1000)
    : null;
  relay?.unref();

  const previewRuns = new PreviewRuns();
  const preview = createPreviewServer(
    store,
    artifacts,
    deployment.mode === 'hosted' ? deployment.preview_origin : null,
    previewRuns,
  );
  const previewOrigin = () => {
    if (deployment.mode === 'hosted') return deployment.preview_origin;
    const a = preview.address();
    return a && typeof a === 'object' ? `http://127.0.0.1:${a.port}` : null;
  };

  // Local product-store failures are evidence problems, not server faults.
  const evidence = async <T>(work: () => Promise<T>): Promise<T> => {
    try {
      return await work();
    } catch (e) {
      if (e instanceof ContractError) throw e;
      throw new ContractError(
        'EVIDENCE_MISMATCH',
        String((e as Error).message),
      );
    }
  };
  const SETTINGS_SPENDING_ROUTE = /^\/api\/settings\/spending$/;
  const SETTINGS_LIMITS_ROUTE = /^\/api\/settings\/spending-limits$/;
  // ADR-0082 (P19): the signed-in person's own Standard/Advanced choice (no workspace).
  const VIEW_PREFERENCE_ROUTE = /^\/api\/me\/view-mode$/;
  const USAGE_ROUTE = /^\/api\/workspaces\/([^/]+)\/(usage)$/;
  const EVIDENCE_SITES_ROUTE = /^\/api\/workspaces\/([^/]+)\/(evidence-sites)$/;
  // ADR-0093 (P28): the workspace's own OpenAI API key (status, save or replace, remove).
  const API_KEY_ROUTE =
    /^\/api\/workspaces\/([^/]+)\/(api-keys)\/(openai)(?:\/(remove|model))?$/;
  const CHAT_ROUTE =
    /^\/api\/workspaces\/([^/]+)\/(chats)(?:\/([^/]+)(?:\/(messages|title|delete))?)?$/;
  // ADR-0057: a model answer to one saved message, and the owner's chat-answer setting.
  const CHAT_ANSWER_ROUTE =
    /^\/api\/workspaces\/([^/]+)\/(chats)\/([^/]+)\/messages\/([^/]+)\/answer$/;
  const CHAT_SETTINGS_ROUTE = /^\/api\/workspaces\/([^/]+)\/(chat-settings)$/;
  // ADR-0083: action cards in a conversation; their answers, send, outcome and dismissal.
  const CHAT_ACTION_ROUTE =
    /^\/api\/workspaces\/([^/]+)\/(chats)\/([^/]+)\/actions(?:\/([^/]+)(?:\/(send|outcome|dismiss|fill))?)?$/;
  // ADR-0081: the person's current connection and model (the picker beside usage).
  const MODEL_CHOICE_ROUTE = /^\/api\/workspaces\/([^/]+)\/(model-choice)$/;
  // ADR-0073: the person's named notes; one note, its rename and its archive switch.
  const NOTES_ROUTE =
    /^\/api\/workspaces\/([^/]+)\/(notes)(?:\/([^/]+)(?:\/(rename|archive))?)?$/;
  const ACTIVITY_NOW_ROUTE = /^\/api\/workspaces\/([^/]+)\/(activity-now)$/;
  // ADR-0090: the team profile and its built-in checks, the auto-clear rule, and the owner's
  // confirmation of one gate on one option.
  const TEAM_PROFILE_ROUTE =
    /^\/api\/workspaces\/([^/]+)\/(team-profile)(?:\/(checks))?$/;
  const GATE_RULE_ROUTE = /^\/api\/workspaces\/([^/]+)\/(gate-rule)$/;
  // ADR-0097: the owner's gate checklist.
  const GATE_CHECKLIST_ROUTE = /^\/api\/workspaces\/([^/]+)\/(gate-checklist)$/;
  const GATE_CONFIRM_ROUTE =
    /^\/api\/workspaces\/([^/]+)\/(problems)\/([^/]+)\/(gate-confirmations(?:\/batch)?)$/;
  async function records(req: IncomingMessage, res: ServerResponse, url: URL) {
    const match =
      RECORD_ROUTE.exec(url.pathname) ??
      GITHUB_ROUTE.exec(url.pathname) ??
      PAYMENTS_ROUTE.exec(url.pathname) ??
      CONNECTIONS_ROUTE.exec(url.pathname) ??
      PRODUCTS_ROUTE.exec(url.pathname) ??
      MARKETING_ROUTE.exec(url.pathname) ??
      PORTFOLIO_ROUTE.exec(url.pathname) ??
      SETTINGS_SPENDING_ROUTE.exec(url.pathname) ??
      SETTINGS_LIMITS_ROUTE.exec(url.pathname) ??
      VIEW_PREFERENCE_ROUTE.exec(url.pathname) ??
      USAGE_ROUTE.exec(url.pathname) ??
      EVIDENCE_SITES_ROUTE.exec(url.pathname) ??
      API_KEY_ROUTE.exec(url.pathname) ??
      CHAT_ROUTE.exec(url.pathname) ??
      CHAT_ANSWER_ROUTE.exec(url.pathname) ??
      CHAT_ACTION_ROUTE.exec(url.pathname) ??
      CHAT_SETTINGS_ROUTE.exec(url.pathname) ??
      MODEL_CHOICE_ROUTE.exec(url.pathname) ??
      NOTES_ROUTE.exec(url.pathname) ??
      FILES_ROUTE.exec(url.pathname) ??
      PROJECT_REPORT_ROUTE.exec(url.pathname) ??
      ACTIVITY_NOW_ROUTE.exec(url.pathname) ??
      TEAM_PROFILE_ROUTE.exec(url.pathname) ??
      GATE_RULE_ROUTE.exec(url.pathname) ??
      GATE_CHECKLIST_ROUTE.exec(url.pathname) ??
      GATE_CONFIRM_ROUTE.exec(url.pathname) ??
      STUDY_EFFORT_ROUTE.exec(url.pathname) ??
      RUN_COMPARE_ROUTE.exec(url.pathname);
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
    // ADR-0075: deployment-wide settings, the owner's plan connections, money, campaigns,
    // GitHub and portfolio scheduling are the owner's alone; a tester session is refused.
    const ownerOnly = [
      SETTINGS_SPENDING_ROUTE,
      SETTINGS_LIMITS_ROUTE,
      CONNECTIONS_ROUTE,
      MODEL_CHOICE_ROUTE,
      GITHUB_ROUTE,
      PAYMENTS_ROUTE,
      MARKETING_ROUTE,
      PORTFOLIO_ROUTE,
    ].some((r) => r.test(url.pathname));
    const session = await (ownerOnly ? authn.requireOwner : authn.require)(
      req,
      method !== 'GET',
    );
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
      if (mutated)
        await maintenance
          .run('outbox', () => store.drainOutbox())
          .catch(() => undefined);
      respond(res, status, value);
      return true;
    };
    // ADR-0080 (P16): the runbook of a spec or proposal version. GET returns the manifest, or
    // the archive with ?format=zip; POST saves the archive into Files, linked to its subject.
    const runbook = async (
      make: (version?: number) => Promise<RunbookExport>,
      subject: string,
    ) => {
      const v = url.searchParams.get('version');
      if (v !== null && !/^[1-9][0-9]{0,8}$/.test(v))
        throw new ContractError(
          'INVALID_CONTRACT',
          'version must be a positive integer.',
        );
      if (method === 'GET') {
        const out = await make(v === null ? undefined : Number(v));
        if (url.searchParams.get('format') !== 'zip')
          return send(
            200,
            {
              name: out.name,
              archive_bytes: out.archive.length,
              manifest: out.manifest,
            },
            false,
          );
        res.writeHead(200, {
          ...INERT,
          'Content-Type': 'application/zip',
          'Content-Length': String(out.archive.length),
          'Content-Disposition': disposition('attachment', out.name),
        });
        res.end(out.archive);
        return true;
      }
      if (method !== 'POST') return false;
      if (!fileStore)
        throw new ContractError(
          'STORAGE_UNAVAILABLE',
          'Files are not available.',
        );
      const body = parse(SaveRunbookFileRequestSchema, await readJson(req));
      const out = await make(body.version);
      return send(
        201,
        await fileStore.uploadFile(ctx, ws!, {
          bytes: out.archive,
          name: out.name,
          declaredType: 'application/zip',
          uploadKey: body.upload_key,
          linkEntityId: subject,
          keepDuplicate: false,
        }),
        true,
      );
    };
    // The owner's overall runtime ceiling: a deployment setting, changed only by a signed-in
    // person (ADR-0043). The store checks who may see or change it.
    if (SETTINGS_SPENDING_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.runtimeCeiling(ctx), false);
      if (method === 'POST')
        return send(
          200,
          await store.setRuntimeCeiling(ctx, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown settings route.');
    }
    if (
      ws &&
      item &&
      STUDY_EFFORT_ROUTE.test(url.pathname) &&
      (await studyEffortRoutes({
        store,
        ctx,
        ws,
        attemptId: item,
        method,
        body: () => readJson(req),
        send,
      }))
    )
      return true;

    // ADR-0117 (F3): the project report, a Markdown download built from the records.
    if (ws && PROJECT_REPORT_ROUTE.test(url.pathname))
      return projectReportRoutes({ store, ctx, ws, method, res });
    // The usage indicator (runbook step 9): read-only plan and API usage for one workspace.
    if (ws && USAGE_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.usageSummary(ctx, ws), false);
      throw new ContractError('NOT_FOUND', 'Unknown usage route.');
    }
    // ADR-0056 evidence websites: any member may read the list in force; only a workspace
    // owner signed in as a person may change it (the store checks), and each change is logged.
    if (ws && EVIDENCE_SITES_ROUTE.test(url.pathname)) {
      if (!sources)
        throw new ContractError(
          'STORAGE_UNAVAILABLE',
          'The source broker is not configured.',
        );
      if (method === 'GET')
        return send(200, await sources.evidenceSites(ctx, ws), false);
      if (method === 'POST')
        return send(
          200,
          await sources.changeEvidenceSites(ctx, ws, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown evidence websites route.');
    }
    // ADR-0093 (P28): any member sees whether a key is saved (last four only); only the owner,
    // signed in as a person, saves, replaces or removes it (the store checks). The body's key
    // goes straight to the vault and is never returned or logged.
    if (ws && API_KEY_ROUTE.test(url.pathname)) {
      if (!apiKeys)
        throw new ContractError(
          'STORAGE_UNAVAILABLE',
          'Persistence is not configured; set CREATOR_DATABASE_URL.',
        );
      if (method === 'GET' && !action)
        return send(200, await apiKeys.status(ctx, ws), false);
      if (method === 'POST' && !action)
        return send(
          200,
          await apiKeys.save(ctx, ws, await readJson(req)),
          true,
        );
      if (method === 'POST' && action === 'model')
        return send(
          200,
          await apiKeys.changeModel(ctx, ws, await readJson(req)),
          true,
        );
      if (method === 'POST' && action === 'remove')
        return send(
          200,
          await apiKeys.remove(ctx, ws, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown API key route.');
    }
    // ADR-0060/ADR-0073 sidebar: each person's own named notes, and what is running now.
    if (ws && NOTES_ROUTE.test(url.pathname)) {
      if (!item) {
        if (method === 'GET')
          return send(200, await store.listWorkspaceNotes(ctx, ws), false);
        if (method === 'POST')
          return send(
            201,
            await store.createWorkspaceNote(
              ctx,
              ws,
              await readJson(req, NOTES_MAX_BODY),
            ),
            true,
          );
      } else if (!action) {
        if (method === 'GET')
          return send(200, await store.workspaceNote(ctx, ws, item), false);
        if (method === 'POST')
          return send(
            200,
            await store.saveWorkspaceNote(
              ctx,
              ws,
              item,
              await readJson(req, NOTES_MAX_BODY),
            ),
            true,
          );
      } else if (method === 'POST') {
        const body = await readJson(req);
        return send(
          200,
          action === 'rename'
            ? await store.renameWorkspaceNote(ctx, ws, item, body)
            : await store.setWorkspaceNoteArchived(ctx, ws, item, body),
          true,
        );
      }
      throw new ContractError('NOT_FOUND', 'Unknown notes route.');
    }
    // ADR-0072: workspace files (upload, list, view, download, delete).
    if (ws && fileStore && FILES_ROUTE.test(url.pathname)) {
      if (
        await fileRoutes({
          store: fileStore,
          slots: uploadSlots,
          ctx,
          ws,
          item,
          action,
          method,
          url,
          req,
          res,
          json: () => readJson(req),
          send,
        })
      )
        return true;
      throw new ContractError('NOT_FOUND', 'Unknown files route.');
    }
    if (ws && TEAM_PROFILE_ROUTE.test(url.pathname)) {
      const host = {
        machine: studioMachine(),
        checks: deployment.mode !== 'hosted',
      };
      if (!item) {
        if (method === 'GET')
          return send(200, await store.teamProfile(ctx, ws, host), false);
        if (method === 'POST')
          return send(
            200,
            await store.saveTeamProfile(ctx, ws, await readJson(req), host),
            true,
          );
      } else if (method === 'POST') {
        // The owner check comes before anything runs on this computer.
        const body = parse(
          RunCapabilityCheckRequestSchema,
          await readJson(req),
        );
        await store.requireTeamProfileOwner(ctx, ws);
        if (!host.checks)
          throw new ContractError(
            'INVALID_TRANSITION',
            'Built-in checks test the computer the studio runs on, which here is the hosting server, not the team’s; tick the answers yourself.',
          );
        const ran = await runCapabilityCheck(
          body.capability,
          deps.capabilityRunner,
        );
        const current = await store.teamProfile(ctx, ws, host);
        if (!ran.passed)
          return send(
            200,
            {
              capability: body.capability,
              passed: false,
              saved: false,
              detail: ran.detail,
              profile: current,
            },
            false,
          );
        // A re-check that finds what is recorded changes nothing (assessments stay current), and
        // a check never overrules the owner's declared No.
        const outcome =
          current.version === body.expected_version
            ? checkOutcome(current.profile, body.capability, ran.check)
            : 'record';
        if (outcome !== 'record')
          return send(
            200,
            {
              capability: body.capability,
              passed: true,
              saved: false,
              detail:
                outcome === 'same'
                  ? `Still found ${ran.check.detail}; nothing changed, so your assessments stay current.`
                  : `Found ${ran.check.detail}, but you set this to No, so it stays No. Change it to Yes yourself if the team may use it.`.slice(
                      0,
                      300,
                    ),
              profile: current,
            },
            false,
          );
        return send(
          200,
          {
            capability: body.capability,
            passed: true,
            saved: true,
            detail:
              `Found ${ran.check.detail} on ${ran.check.machine}. Saved; assess options again so they read it.`.slice(
                0,
                300,
              ),
            profile: await store.recordCapabilityCheck(
              ctx,
              ws,
              body,
              ran.check,
              host,
            ),
          },
          true,
        );
      }
      throw new ContractError('NOT_FOUND', 'Unknown team profile route.');
    }
    if (ws && GATE_RULE_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.gateRule(ctx, ws), false);
      if (method === 'POST')
        return send(
          200,
          await store.setGateRule(ctx, ws, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown auto-clear rule route.');
    }
    if (ws && GATE_CHECKLIST_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.gateChecklist(ctx, ws), false);
      if (method === 'POST')
        return send(
          200,
          await store.saveGateChecklist(ctx, ws, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown gate checklist route.');
    }
    if (ws && item && GATE_CONFIRM_ROUTE.test(url.pathname)) {
      // UX pass P-4: `/batch` confirms several options' gates in one step.
      if (method === 'POST' && action === 'gate-confirmations/batch')
        return send(
          201,
          await store.confirmGates(ctx, ws, item, await readJson(req)),
          true,
        );
      if (method === 'POST')
        return send(
          201,
          await store.confirmGate(ctx, ws, item, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown gate confirmation route.');
    }
    if (ws && ACTIVITY_NOW_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.activityNow(ctx, ws), false);
      throw new ContractError('NOT_FOUND', 'Unknown activity route.');
    }
    if (ws && MODEL_CHOICE_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.modelChoice(ctx, ws), false);
      if (method === 'POST')
        return send(
          200,
          await store.setModelChoice(ctx, ws, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown model choice route.');
    }
    if (ws && CHAT_SETTINGS_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.chatSettings(ctx, ws), false);
      if (method === 'POST')
        return send(
          200,
          await store.setChatSettings(ctx, ws, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown chat settings route.');
    }
    // ADR-0057: ask the chosen plan for an answer. The plan service records what is sent,
    // admission decides, and the outcome (completed, failed or refused) is saved and returned.
    const answerMatch = CHAT_ANSWER_ROUTE.exec(url.pathname);
    if (ws && answerMatch) {
      if (method !== 'POST')
        throw new ContractError('NOT_FOUND', 'Unknown chat answer route.');
      if (!planService)
        throw new ContractError(
          'INVALID_CONFIG',
          'Plan connections are not configured, so chat cannot ask a model.',
        );
      return send(
        200,
        await planService.chatAnswer(
          ctx,
          ws,
          answerMatch[3]!,
          answerMatch[4]!,
          await readJson(req),
        ),
        true,
      );
    }
    // ADR-0083: action cards. Making, filling in or sending a card starts nothing here: the
    // browser sends the card's requests through the form's own routes, naming this send.
    const cardMatch = CHAT_ACTION_ROUTE.exec(url.pathname);
    if (ws && cardMatch && method === 'POST') {
      const [, , , conversation, card, step] = cardMatch;
      const body = await readJson(req);
      // ADR-0096 (P31): the chat model proposes text for the card's questions. It answers
      // nothing and sends nothing; the person uses the proposals and still presses Send.
      if (card && step === 'fill') {
        if (!planService)
          throw new ContractError(
            'INVALID_CONFIG',
            'Plan connections are not configured, so a card cannot ask a model.',
          );
        return send(
          200,
          await planService.chatActionFill(ctx, ws, conversation!, card, body),
          true,
        );
      }
      if (!card)
        return send(
          201,
          await store.createChatAction(ctx, ws, conversation!, body),
          true,
        );
      if (!step)
        return send(
          200,
          await store.updateChatAction(ctx, ws, conversation!, card, body),
          true,
        );
      if (step === 'send')
        return send(
          200,
          await store.sendChatAction(ctx, ws, conversation!, card, body),
          true,
        );
      if (step === 'outcome')
        return send(
          200,
          await store.finishChatAction(ctx, ws, conversation!, card, body),
          true,
        );
      return send(
        200,
        await store.dismissChatAction(ctx, ws, conversation!, card, body),
        true,
      );
    }
    if (ws && cardMatch)
      throw new ContractError('NOT_FOUND', 'Unknown chat card route.');
    // ADR-0055 studio chat: saved conversations and the person's messages. Nothing here calls a
    // model or starts work; the store decides each message's intent with fixed rules.
    if (ws && CHAT_ROUTE.test(url.pathname)) {
      if (!item && method === 'GET')
        return send(
          200,
          await store.listChats(ctx, ws, url.searchParams.get('q') ?? ''),
          false,
        );
      if (!item && method === 'POST')
        return send(
          201,
          await store.createChat(ctx, ws, await readJson(req)),
          true,
        );
      if (item && !action && method === 'GET')
        return send(200, await store.chatDetail(ctx, ws, item), false);
      if (item && action === 'messages' && method === 'POST') {
        const posted = await store.postChatMessage(
          ctx,
          ws,
          item,
          await readJson(req),
        );
        return send(
          posted.duplicate ? 200 : 201,
          posted.message,
          !posted.duplicate,
        );
      }
      if (item && action === 'title' && method === 'POST')
        return send(
          200,
          await store.renameChat(ctx, ws, item, await readJson(req)),
          true,
        );
      // ADR-0063: delete a conversation. POST like the other chat actions, so it carries CSRF.
      if (item && action === 'delete' && method === 'POST') {
        await readJson(req);
        return send(200, await store.deleteChat(ctx, ws, item), true);
      }
      throw new ContractError('NOT_FOUND', 'Unknown chat route.');
    }
    // Any signed-in person, tester or owner, reads and sets only their own view choice.
    if (VIEW_PREFERENCE_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.viewPreference(ctx), false);
      if (method === 'POST')
        return send(
          200,
          await store.setViewPreference(ctx, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown view preference route.');
    }
    // Narrower per-run and per-model limits under that ceiling (ADR-0044); same audience.
    if (SETTINGS_LIMITS_ROUTE.test(url.pathname)) {
      if (method === 'GET')
        return send(200, await store.spendLimits(ctx), false);
      if (method === 'POST')
        return send(
          200,
          await store.setSpendLimits(ctx, await readJson(req)),
          true,
        );
      throw new ContractError('NOT_FOUND', 'Unknown settings route.');
    }
    if (
      ws &&
      collection &&
      PORTFOLIO_ROUTE.test(url.pathname) &&
      (await portfolioRoutes({
        store,
        service: portfolio!,
        url,
        ctx,
        ws,
        collection,
        item,
        action,
        method,
        body: () => readJson(req),
        send,
      }))
    )
      return true;
    // ADR-0120 (F7): two autopilots side by side, read only.
    if (
      ws &&
      RUN_COMPARE_ROUTE.test(url.pathname) &&
      (await runCompareRoutes({ store, ctx, ws, method, url, send }))
    )
      return true;
    if (
      ws &&
      collection &&
      MARKETING_ROUTE.test(url.pathname) &&
      (await marketingRoutes({
        store,
        url,
        ctx,
        ws,
        collection,
        item,
        action,
        method,
        body: () => readJson(req),
        send,
      }))
    )
      return true;
    if (
      ws &&
      collection &&
      ['artifacts', 'previews', 'feedback', 'terminals'].includes(collection) &&
      (await artifactRoutes({
        store,
        artifacts,
        terminals,
        localStudio: deployment.mode === 'local',
        previewOrigin,
        previewRuns,
        ctx,
        ws,
        collection,
        item,
        action,
        method,
        url,
        res,
        body: () => readJson(req),
        send,
      }))
    )
      return true;
    if (
      ws &&
      collection?.startsWith('github-') &&
      (await githubRoutes({
        store,
        service: github!,
        ctx,
        ws,
        collection,
        item,
        action,
        method,
        body: () => readJson(req),
        query: url.searchParams,
        send,
      }))
    )
      return true;
    if (
      ws &&
      collection &&
      PAYMENTS_ROUTE.test(url.pathname) &&
      (await paymentRoutes({
        store,
        service: payments!,
        ctx,
        hook: { actorId: PAYMENT_WEBHOOK_ACTOR_ID },
        ws,
        collection,
        item,
        action,
        method,
        url,
        body: () => readJson(req),
        send,
      }))
    )
      return true;
    if (
      ws &&
      PRODUCTS_ROUTE.test(url.pathname) &&
      (await productRoutes({
        service: builds!,
        ctx,
        ws,
        item,
        action,
        method,
        body: () => readJson(req),
        send,
      }))
    )
      return true;
    if (
      ws &&
      collection &&
      CONNECTIONS_ROUTE.test(url.pathname) &&
      (await connectionRoutes({
        store,
        service: planService,
        codex: codexLauncher,
        queue: qualificationQueue,
        recipes: recipeQualifications,
        ctx,
        ws,
        collection,
        item,
        action,
        method,
        // Qualification manifests repeat bounded prompts and evidence for each case, and a
        // build-role call carries a JSON packet as a JSON string (ADR-0053); a Codex build turn
        // carries the same builder packet. Only these authenticated actions get larger ingress
        // allowances.
        body: () =>
          readJson(
            req,
            collection === 'plan-connections' && item && method === 'POST'
              ? action === 'qualifications'
                ? // A bundled benchmark manifest; assessment-synthetic-v3 is ~290 KiB minified.
                  512 * 1024
                : action === 'qualification-queues'
                  ? // ADR-0088: several bundled manifests (all six today are ~400 KiB).
                    1024 * 1024
                  : action === 'build-calls' || action === 'codex-builds'
                    ? PLAN_BUILD_CALL_MAX_BODY
                    : MAX_BODY
              : MAX_BODY,
          ),
        send,
      }))
    )
      return true;
    if (
      ws &&
      collection?.startsWith('route-') &&
      (await routingRoutes({
        store,
        broker: broker!,
        ctx,
        ws,
        collection,
        item,
        action,
        method,
        url,
        body: () => readJson(req),
        send,
      }))
    )
      return true;
    if (
      ws &&
      collection?.startsWith('context-') &&
      (await contextRoutes({
        store,
        service: contextService!,
        ctx,
        ws,
        collection,
        item,
        action,
        method,
        url,
        body: () => readJson(req),
        send,
      }))
    )
      return true;
    if (
      ws &&
      collection &&
      (await searchRoutes({
        store,
        service: searchService!,
        ctx,
        ws,
        collection,
        item,
        action,
        method,
        url,
        body: () => readJson(req),
        send,
      }))
    )
      return true;
    if (!ws) {
      if (method === 'GET')
        return send(200, await store.listWorkspaces(ctx), false);
      if (method === 'POST')
        return send(
          201,
          await store.createWorkspace(ctx, await readJson(req)),
          true,
        );
    } else if (collection === 'studies') {
      if (!item && method === 'GET')
        return send(200, await store.listStudies(ctx, ws), false);
      if (!item && method === 'POST')
        return send(
          201,
          await store.createStudy(ctx, ws, await readJson(req)),
          true,
        );
      if (item === 'seed' && method === 'POST')
        return send(201, await store.seedStudy(ctx, ws), true);
      if (item && !action && method === 'GET')
        return send(200, await store.studyDetail(ctx, ws, item), false);
      if (item && action === 'assign' && method === 'POST')
        return send(
          201,
          await store.assignStudy(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && action === 'export' && method === 'GET')
        return send(200, await store.exportStudy(ctx, ws, item), false);
      if (item && action === 'graders' && method === 'POST')
        return send(
          201,
          await store.grantGrader(ctx, ws, item, await readJson(req)),
          true,
        );
      if (
        item &&
        action === 'grader-material' &&
        (method === 'GET' || method === 'POST')
      )
        return send(
          200,
          await store.graderMaterial(
            ctx,
            ws,
            item,
            method === 'POST' ? await readJson(req) : undefined,
          ),
          method === 'POST',
        );
    } else if (collection === 'protocol-freezes' && !item) {
      if (method === 'GET')
        return send(
          200,
          {
            proposal: PROPOSED_PROTOCOL,
            proposal_hash: canonicalHash(PROPOSED_PROTOCOL),
            blocking_decisions: BLOCKING_DECISIONS,
            latest_freeze: await store.latestProtocolFreeze(ctx, ws),
          },
          false,
        );
      if (method === 'POST')
        return send(
          201,
          await store.freezeStudyProtocol(ctx, ws, await readJson(req)),
          true,
        );
    } else if (collection === 'study-attempts' && item) {
      if (action === 'execute' && method === 'POST') {
        const prepared = await store.prepareStudyExecution(ctx, ws, item);
        const a = prepared.attempt;
        if (a.discovery_method === 'structured')
          return send(
            201,
            await store.startDiscovery(
              { ...ctx, idempotencyKey: `study:${item}:workflow` },
              a.workspace_id,
              a.run_id,
              prepared.request,
            ),
            true,
          );
        const result = await broker!.call(
          ctx,
          a.workspace_id,
          a.run_id,
          prepared.request,
        );
        await store.recordBaselineOutcome(ctx, ws, item, result);
        return send(200, result, true);
      }
      // T15 implementation stratum: A/B build in the isolated builder, C submits code.
      if (action === 'build' && method === 'POST')
        return send(201, await store.prepareStudyBuild(ctx, ws, item), true);
      if (action === 'build' && method === 'GET')
        return send(200, await store.studyBuildState(ctx, ws, item), false);
      if (action === 'binding' && method === 'GET')
        return send(200, await store.studyTaskBinding(ctx, ws, item), false);
      if (action === 'build-record' && method === 'POST') {
        const body = parse(
          z.strictObject({ product_id: idSchema, build_id: idSchema }),
          await readJson(req),
        );
        const state = await store.studyBuildState(ctx, ws, item);
        // The server re-reads the local product store; a caller's summary is never trusted.
        const rec = await evidence(async () => {
          artifacts.products.assertBinding(
            await artifacts.products.product(body.product_id),
            state.binding,
          );
          const r = await readStudyBuild(
            artifacts.products,
            body.product_id,
            body.build_id,
          );
          if (
            canonicalHash(r.plan) !== canonicalHash(state.plan) ||
            r.outcome.spec_hash !== state.binding.spec_hash ||
            r.task.key !== state.implementation.task_key ||
            r.task.spec_task_hash !== state.implementation.task_hash
          )
            throw new Error(
              "The build was not run with this attempt's prepared plan and pinned task.",
            );
          return r;
        });
        return send(
          201,
          await store.recordStudyBuild(ctx, ws, item, {
            product_id: body.product_id,
            build_id: body.build_id,
            task_id: rec.task.id,
            task_key: rec.task.key,
            task_hash: rec.task.spec_task_hash,
            plan_hash: digest(JSON.stringify(rec.plan)),
            spec_hash: rec.outcome.spec_hash,
            commit: rec.outcome.commit,
            state: rec.outcome.state,
            reason: rec.outcome.reason,
            calls: rec.outcome.calls,
            repairs: rec.outcome.repairs,
            fixture: rec.outcome.fixture,
            review: rec.review,
            checks: rec.checks,
            files: rec.files,
          }),
          true,
        );
      }
      if (action === 'code-check' && method === 'POST') {
        const body = parse(
          z.strictObject({
            product_id: idSchema,
            task_id: idSchema,
            commit: z.string().regex(/^[a-f0-9]{40}$/),
          }),
          await readJson(req),
        );
        const t = await store.studyCodeCases(ctx, ws, item);
        const checked = await evidence(async () => {
          const task = await artifacts.products.task(
            body.product_id,
            body.task_id,
          );
          if (
            task.key !== t.impl.task_key ||
            task.spec_task_hash !== t.impl.task_hash
          )
            throw new Error('The submitted task is not the pinned study task.');
          return checkStudyCode(
            artifacts.products,
            artifacts.executor,
            t.binding,
            t.cases,
            body.product_id,
            body.task_id,
            body.commit,
          );
        });
        return send(
          201,
          await store.recordStudyCodeCheck(ctx, ws, item, {
            ...body,
            ...checked,
          }),
          true,
        );
      }
      if (action === 'context' && method === 'GET')
        return send(200, await store.participantContext(ctx, ws, item), false);
      if (action === 'entries' && method === 'GET')
        return send(200, await store.attemptEntries(ctx, ws, item), false);
      if (
        action &&
        [
          'artifacts',
          'tests',
          'interventions',
          'finish',
          'deviations',
          'helpers',
        ].includes(action) &&
        method === 'POST'
      )
        return send(
          201,
          await store.writeAttempt(ctx, ws, item, action, await readJson(req)),
          true,
        );
    } else if (collection === 'entities' && !item) {
      if (method === 'GET') {
        const kind = url.searchParams.get('kind');
        const status = url.searchParams.get('status');
        const rows = await store.listEntities(ctx, ws, {
          ...(kind ? { kind } : {}),
          ...(status ? { status } : {}),
        });
        // PR #136 review L5: `brief=1` lists titles only (the chat record picker), without
        // sending every record body.
        return send(
          200,
          url.searchParams.get('brief') === '1'
            ? rows.map((e) => ({
                id: e.id,
                kind: e.kind,
                status: e.status,
                title: e.title,
                updated_at: e.updated_at,
              }))
            : rows,
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
      if (method === 'GET' && action === 'research-plan') {
        const { entity } = await store.getEntity(ctx, ws, item);
        if (entity.kind !== 'theme_intent' || entity.status !== 'active')
          throw new ContractError(
            'INVALID_CONTRACT',
            'Prepare a plan from an active theme draft.',
          );
        return send(200, prepareThemeResearchPlan(entity), false);
      }
      if (method === 'GET' && action === 'humility-gate')
        return send(200, await store.humilityVerdict(ctx, ws, item), false);
      if (method === 'GET' && action === 'lineage') {
        const direction = url.searchParams.get('direction') ?? 'upstream';
        if (direction !== 'upstream' && direction !== 'downstream')
          throw new ContractError(
            'INVALID_CONTRACT',
            'direction must be upstream or downstream.',
          );
        const depth = Number(url.searchParams.get('depth') ?? 8);
        if (!Number.isInteger(depth) || depth < 1 || depth > 8)
          throw new ContractError('INVALID_CONTRACT', 'depth must be 1–8.');
        return send(
          200,
          await store.lineage(ctx, ws, item, direction, depth),
          false,
        );
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
        sources?.cancelRun(cancelled.run_id);
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
      if (item && method === 'POST' && action === 'web-discoveries') {
        if (!webDiscovery)
          throw new ContractError(
            'INVALID_CONFIG',
            'Web discovery needs the plan connection service and the source broker.',
          );
        return send(
          201,
          await webDiscovery.start(ctx, ws, item, await readJson(req)),
          true,
        );
      }
      if (item && method === 'POST' && action === 'autopilots') {
        if (!autopilot)
          throw new ContractError(
            'INVALID_CONFIG',
            'Autopilots need the PostgreSQL store.',
          );
        return send(
          201,
          await autopilot.start(ctx, ws, item, await readJson(req)),
          true,
        );
      }
      // ADR-0099 (P33): "Automate selection" on this run.
      if (item && method === 'POST' && action === 'automation') {
        if (!autopilot)
          throw new ContractError(
            'INVALID_CONFIG',
            'Automation needs the PostgreSQL store.',
          );
        const set = await store.setRunAutomation(
          ctx,
          ws,
          item,
          await readJson(req),
        );
        // An assessment that finished after the level was set is picked up now, not in a minute.
        void autopilot.automate().catch(() => undefined);
        return send(201, set, true);
      }
      if (item && method === 'POST' && action === 'explorations')
        return send(
          201,
          await store.startExploration(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'assessments')
        return send(
          201,
          await store.startAssessment(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'selections')
        return send(
          200,
          await store.select(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'spec-freezes')
        return send(
          200,
          await store.freezeSpec(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'model-calls')
        return send(
          200,
          await broker!.call(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'source-searches') {
        const body = await readJson(req);
        const searchRequest = parse(BrokerCallRequestSchema, body);
        if (
          searchRequest.action_type !== 'tool.search_public' ||
          searchRequest.tool !== 'search_public'
        )
          throw new ContractError(
            'INVALID_CONTRACT',
            'Source search requires tool.search_public and search_public.',
          );
        const fixture = await store.isFixtureWorkspace(ctx, ws);
        return send(
          200,
          await broker!.callModel(
            ctx,
            ws,
            item,
            fixture
              ? { provider: 'fixture', model_id: 'fixture-model-v1' }
              : { provider: 'brave', model_id: BRAVE_SEARCH_ID },
            searchRequest,
          ),
          true,
        );
      }
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
      // ADR-0079: routine approvals turned on for a run that is already going.
      if (item && method === 'POST' && action === 'routine-policy')
        return send(
          201,
          await store.setRoutinePolicy(ctx, ws, item, await readJson(req)),
          true,
        );
      // ADR-0054: a build's one approval (the CLI's builds; the studio calls the store).
      if (item && method === 'POST' && action === 'build-approvals')
        return send(
          200,
          await store.admitBuild(ctx, ws, item, await readJson(req)),
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
    } else if (collection === 'routine-policies') {
      // ADR-0079: a policy is created with its run (POST runs); here it is read, changed or revoked.
      if (!item && method === 'GET')
        return send(200, await store.listRoutinePolicies(ctx, ws), false);
      if (item && method === 'POST' && action === 'revisions')
        return send(
          200,
          await store.reviseRoutinePolicy(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'revoke')
        return send(
          200,
          await store.revokeRoutinePolicy(ctx, ws, item, await readJson(req)),
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
        return send(
          200,
          await store.listEnvelopes(
            ctx,
            ws,
            pageQuery((k) => url.searchParams.get(k)),
          ),
          false,
        );
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
      if (item && action === 'exploration-packet' && method === 'GET')
        return send(200, await store.explorationPacket(ctx, ws, item), false);
      if (item && action === 'assessment-packet' && method === 'GET')
        return send(200, await store.assessmentPacket(ctx, ws, item), false);
      if (item && action === 'explored-briefs' && method === 'POST') {
        const body = ((await readJson(req)) ?? {}) as Record<string, unknown>;
        const { candidate, ...rest } = body;
        const made = await store.createExploredBrief(
          ctx,
          ws,
          item,
          String(candidate ?? ''),
          rest,
        );
        return send(made.created ? 201 : 200, made, made.created);
      }
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
        if (action === 'cancel') {
          broker?.cancelRun(detail.workflow.run_id);
          sources?.cancelRun(detail.workflow.run_id);
        }
        return send(200, detail, true);
      }
    } else if (collection === 'problems' && item && method === 'GET') {
      // ADR-0077: why the chosen response was chosen, computed from the records.
      if (action === 'explanation')
        return send(200, await store.responseExplanation(ctx, ws, item), false);
      if (action === 'assessment-preview')
        return send(
          200,
          await store.previewAssessment(
            ctx,
            ws,
            item,
            url.searchParams.get('connection'),
          ),
          false,
        );
      if (action === 'report') {
        const n = url.searchParams.get('shortlist');
        return send(
          200,
          await store.selectionReport(
            ctx,
            ws,
            item,
            n === null ? undefined : Number(n),
          ),
          false,
        );
      }
      if (action === 'selections')
        return send(200, await store.listSelections(ctx, ws, item), false);
      if (action === 'comparison') {
        const days = url.searchParams.get('max_age_days');
        return send(
          200,
          await store.comparison(
            ctx,
            ws,
            item,
            days === null ? undefined : Number(days),
          ),
          false,
        );
      }
    } else if (collection === 'proposals') {
      // ADR-0077 (P09): versioned non-code proposals, their reviews and Markdown export.
      const versionOf = () => {
        const v = url.searchParams.get('version');
        if (v === null) return undefined;
        if (!/^[1-9][0-9]{0,8}$/.test(v))
          throw new ContractError(
            'INVALID_CONTRACT',
            'version must be a positive integer.',
          );
        return Number(v);
      };
      if (!item && method === 'GET')
        return send(
          200,
          await store.listProposals(
            ctx,
            ws,
            url.searchParams.get('problem') ?? undefined,
          ),
          false,
        );
      if (!item && method === 'POST')
        return send(
          201,
          await store.createProposal(
            ctx,
            ws,
            await readJson(req, PROPOSAL_MAX_REQUEST),
          ),
          true,
        );
      if (item === 'draft' && !action && method === 'GET')
        return send(
          200,
          await store.proposalDraft(
            ctx,
            ws,
            url.searchParams.get('alternative') ?? '',
          ),
          false,
        );
      if (item && !action && method === 'GET')
        return send(
          200,
          await store.proposalDetail(ctx, ws, item, versionOf()),
          false,
        );
      if (item && action === 'revisions' && method === 'POST')
        return send(
          200,
          await store.reviseProposal(
            ctx,
            ws,
            item,
            await readJson(req, PROPOSAL_MAX_REQUEST),
          ),
          true,
        );
      if (item && action === 'reviews' && method === 'POST')
        return send(
          200,
          await store.reviewProposal(ctx, ws, item, await readJson(req)),
          true,
        );
      // ADR-0101 (UX pass P-5): model drafts of a saved proposal's unknown sections. They
      // change nothing in the proposal; a person uses a draft and saves a new version.
      if (item && action === 'section-drafts' && method === 'GET')
        return send(
          200,
          await store.listProposalSectionDrafts(ctx, ws, item),
          false,
        );
      if (item && action === 'section-drafts' && method === 'POST') {
        if (!planService)
          throw new ContractError(
            'INVALID_CONFIG',
            'Plan connections are not configured, so a proposal cannot ask a model.',
          );
        return send(
          200,
          await planService.proposalSectionDraft(
            ctx,
            ws,
            item,
            await readJson(req),
          ),
          true,
        );
      }
      if (item && action === 'runbook')
        return runbook((v) => store.proposalRunbook(ctx, ws, item, v), item);
      if (item && action === 'export' && method === 'GET') {
        const out = await store.proposalExport(ctx, ws, item, versionOf());
        const bytes = Buffer.from(out.markdown, 'utf8');
        res.writeHead(200, {
          ...INERT,
          'Content-Type': 'text/markdown; charset=utf-8',
          'Content-Length': String(bytes.length),
          'Content-Disposition': disposition('attachment', out.name),
        });
        res.end(bytes);
        return true;
      }
      // Saves one version's Markdown export into Files, linked to the proposal (ADR-0072 path).
      if (item && action === 'files' && method === 'POST') {
        if (!fileStore)
          throw new ContractError(
            'STORAGE_UNAVAILABLE',
            'Files are not available.',
          );
        const body = parse(SaveProposalFileRequestSchema, await readJson(req));
        const out = await store.proposalExport(ctx, ws, item, body.version);
        return send(
          201,
          await fileStore.uploadFile(ctx, ws, {
            bytes: Buffer.from(out.markdown, 'utf8'),
            name: out.name,
            declaredType: 'text/markdown',
            uploadKey: body.upload_key,
            linkEntityId: item,
            keepDuplicate: false,
          }),
          true,
        );
      }
    } else if (collection === 'scorecards' && method === 'POST') {
      if (!item)
        return send(
          201,
          await store.recordScorecard(ctx, ws, await readJson(req)),
          true,
        );
      if (action === 'revisions')
        return send(
          200,
          await store.reviseScorecard(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'spec-drafts') {
      // ADR-0107 (B2): model drafts of a build spec, an edge case or a case explanation. They
      // change no spec; a person uses a draft in the form and saves the spec themselves.
      if (item === 'routes' && !action && method === 'GET')
        return send(
          200,
          await store.specDraftRoutes(
            ctx,
            ws,
            url.searchParams.get('selection'),
          ),
          false,
        );
      if (!item && method === 'GET') {
        const alternative = url.searchParams.get('alternative');
        if (!alternative)
          throw new ContractError(
            'INVALID_CONTRACT',
            'Name the option: ?alternative=<id>.',
          );
        return send(
          200,
          await store.listSpecDrafts(ctx, ws, alternative),
          false,
        );
      }
      if (!item && method === 'POST') {
        if (!planService)
          throw new ContractError(
            'INVALID_CONFIG',
            'Plan connections are not configured, so a spec cannot be drafted by a model.',
          );
        return send(
          200,
          await planService.specDraft(ctx, ws, await readJson(req)),
          true,
        );
      }
    } else if (collection === 'specs') {
      if (item && action === 'runbook')
        return runbook((v) => store.specRunbook(ctx, ws, item, v), item);
      if (!item && method === 'POST')
        return send(
          201,
          await store.createSpec(ctx, ws, await readJson(req)),
          true,
        );
      if (item && !action && method === 'GET')
        return send(200, await store.specStatus(ctx, ws, item), false);
      if (item && action === 'revisions' && method === 'POST')
        return send(
          200,
          await store.reviseSpec(ctx, ws, item, await readJson(req)),
          true,
        );
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
    } else if (
      collection === 'web-discovery-preview' &&
      !item &&
      method === 'POST'
    ) {
      const preview = await store.previewWebDiscovery(
        ctx,
        ws,
        await readJson(req),
      );
      return send(
        200,
        sources
          ? await sources.fetchCapFor(ctx, ws).then((f) => ({
              ...preview,
              max_fetches_per_run: f.cap,
              fetching_available: f.live,
            }))
          : preview,
        false,
      );
    } else if (collection === 'autopilots' && autopilot) {
      // ADR-0092 (P13): read, stop and continue autopilots.
      if (!item && method === 'GET') {
        const settings = await store
          .autopilotSettings(ctx, ws)
          .catch(() => null);
        return send(
          200,
          (
            await store.listAutopilots(ctx, ws, url.searchParams.get('run'))
          ).map((a) => autopilot.with(a, settings?.values)),
          false,
        );
      }
      if (item && !action && method === 'GET')
        return send(
          200,
          await autopilot.withNext(
            ctx,
            ws,
            await store.getAutopilot(ctx, ws, item),
          ),
          false,
        );
      if (item && method === 'POST' && action === 'cancel')
        return send(
          200,
          await autopilot.cancel(ctx, ws, item, await readJson(req)),
          true,
        );
      if (item && method === 'POST' && action === 'continue')
        return send(
          200,
          await autopilot.retry(ctx, ws, item, await readJson(req)),
          true,
        );
      // ADR-0100: turn on the setting this stop names and continue, in one request.
      if (item && method === 'POST' && action === 'allow')
        return send(
          200,
          await autopilot.allowAndContinue(ctx, ws, item, await readJson(req)),
          true,
        );
    } else if (collection === 'autopilot-settings' && !item) {
      // ADR-0100: the owner's autopilot settings for this workspace.
      if (method === 'GET')
        return send(200, await store.autopilotSettings(ctx, ws), false);
      if (method === 'POST')
        return send(
          200,
          await store.saveAutopilotSettings(ctx, ws, await readJson(req)),
          true,
        );
    } else if (collection === 'automations' && autopilot) {
      // ADR-0099 (P33): automation levels set on runs; Stop sets the run back to Manual and
      // stops the autopilot the level has running, if any (what it made is kept).
      if (!item && method === 'GET')
        return send(200, await store.listRunAutomations(ctx, ws), false);
      if (item && method === 'POST' && action === 'stop') {
        const stopped = await store.stopRunAutomation(
          ctx,
          ws,
          item,
          await readJson(req),
        );
        for (const a of stopped.autopilots.filter((x) => x.state === 'running'))
          await autopilot
            .cancel(ctx, ws, a.id, {
              reason: 'The project was set back to Manual.',
            })
            .catch(() => undefined);
        return send(
          200,
          await store
            .listRunAutomations(ctx, ws)
            .then((l) => l.find((x) => x.id === stopped.id) ?? stopped),
          true,
        );
      }
    } else if (collection === 'web-discoveries') {
      // ADR-0086 (P12): read, stop, resume, and decide the checked claims.
      if (!item && method === 'GET')
        return send(
          200,
          await store.listWebDiscoveries(
            ctx,
            ws,
            url.searchParams.get('run') ?? undefined,
          ),
          false,
        );
      if (item && !action && method === 'GET') {
        const d = await store.getWebDiscovery(ctx, ws, item);
        return send(200, webDiscovery ? webDiscovery.with(d) : d, false);
      }
      if (item && method === 'POST' && webDiscovery) {
        if (action === 'cancel')
          return send(
            200,
            await webDiscovery.cancel(ctx, ws, item, await readJson(req)),
            true,
          );
        if (action === 'resume')
          return send(200, await webDiscovery.resume(ctx, ws, item), true);
        if (action === 'admit')
          return send(
            200,
            webDiscovery.with(
              await store.admitWebClaims(ctx, ws, item, await readJson(req)),
            ),
            true,
          );
        if (action === 'dismiss')
          return send(
            200,
            webDiscovery.with(
              await store.dismissWebClaims(ctx, ws, item, await readJson(req)),
            ),
            true,
          );
      }
    } else if (
      collection === 'exploration-preview' &&
      !item &&
      method === 'POST'
    ) {
      return send(
        200,
        await store.previewExploration(ctx, ws, await readJson(req)),
        false,
      );
    } else if (collection === 'search' && !item && method === 'GET') {
      await maintenance.run('outbox', () => store.drainOutbox());
      const p = url.searchParams;
      const types = p.get('types');
      return send(
        200,
        await store.search(ctx, ws, {
          q: p.get('q') ?? '',
          types: types ? types.split(',') : [...SEARCH_TYPES],
          kind: p.get('kind') || null,
          status: p.get('status') || null,
          limit: Number(p.get('limit') ?? 20),
          from: p.get('from') || null,
          to: p.get('to') || null,
          ...(p.get('tz') ? { tz: p.get('tz') } : {}),
          ...(p.get('sort') ? { sort: p.get('sort') } : {}),
          ...(p.get('after') ? { after: p.get('after') } : {}),
        }),
        false,
      );
    } else if (collection === 'library' && !item && method === 'GET') {
      const p = url.searchParams;
      const filter: Parameters<typeof store.library>[2] = {};
      for (const k of ['kind', 'status', 'sort', 'after'] as const) {
        const v = p.get(k);
        if (v) filter[k] = v;
      }
      if (p.get('limit')) filter.limit = Number(p.get('limit'));
      return send(200, await store.library(ctx, ws, filter), false);
    } else if (collection === 'destination' && !item && method === 'GET') {
      return send(
        200,
        await store.destination(
          ctx,
          ws,
          url.searchParams.get('kind') ?? '',
          url.searchParams.get('id') ?? '',
        ),
        false,
      );
    } else if (collection === 'activity' && !item && method === 'GET') {
      await maintenance.run('outbox', () => store.drainOutbox());
      const p = url.searchParams;
      const filter: Parameters<typeof store.activity>[2] = {};
      const q = p.get('q');
      const a = p.get('action');
      const subject = p.get('subject');
      const before = p.get('before');
      const limit = p.get('limit');
      if (q) filter.q = q;
      if (a) filter.action = a;
      if (subject) filter.subjectId = subject;
      if (before) filter.before = before;
      if (limit) filter.limit = Number(limit);
      return send(200, await store.activity(ctx, ws, filter), false);
    } else if (collection === 'actors' && !item && method === 'GET') {
      return send(200, await store.actors(ctx, ws), false);
    } else if (collection === 'overview' && !item && method === 'GET') {
      return send(200, await store.overview(ctx, ws), false);
    } else if (collection === 'history' && !item) {
      if (method === 'GET') {
        await maintenance.run('outbox', () => store.drainOutbox());
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

  const opsRoutes = createOps({
    deployment,
    configHash,
    ops,
    productsRoot: artifacts.products.root,
    ensureReady,
    workerMode,
    schemaVersion: () => schemaVersion,
    // ADR-0075: operations status and verification are the owner's, never a tester's.
    requireSession: (req, mutating) => authn.requireOwner(req, mutating),
  });
  // ADR-0118 (F5): the owner's redacted support report on Monitor > Workers.
  const supportRoutes = supportReportRoutes({
    deployment,
    pool,
    ops,
    ensureReady,
    schemaVersion: () => schemaVersion,
    readiness: () => opsRoutes.evaluate(),
    maintenance: () => maintenance.snapshot(),
    identity: localIdentity(env),
    requireOwner: (req, mutating) => authn.requireOwner(req, mutating),
  });
  // ADR-0121 (F10): Monitor > Storage and the confirmed build-workspace cleanup.
  const storageRoutes = createStorage({
    store: pool ? new StorageStore(pool) : null,
    products: artifacts.products,
    studioRoots: {
      plan: qualificationProducts.root,
      recipe: recipeProducts.root,
    },
    ownerId,
    ensureReady,
    requireSession: (req, mutating) => authn.requireOwner(req, mutating),
  });
  const server = createServer((req, res) => {
    bodyDeadline(req, res);
    void (async () => {
      // Restrict Host and browser origins. Hosted deployments also answer to their public
      // API host (behind the TLS proxy); loopback stays allowed for local probes.
      const localPort = req.socket.localPort ?? 0;
      if (!allowedHosts(deployment, localPort).includes(req.headers.host ?? ''))
        throw new ContractError(
          'ORIGIN_DENIED',
          deployment.mode === 'local'
            ? 'Only loopback Host headers are accepted.'
            : 'Host header not accepted.',
        );
      const origin = req.headers.origin;
      if (
        origin &&
        !(
          deployment.mode === 'hosted'
            ? [deployment.web_origin, deployment.api_origin]
            : [
                `http://127.0.0.1:${config.web_port}`,
                `http://localhost:${config.web_port}`,
                `http://127.0.0.1:${localPort}`,
                `http://localhost:${localPort}`,
              ]
        ).includes(origin)
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
            // Derived from the configured adapters (audit 2026-10-18 #5); fixture is the default.
            data_mode:
              live || sourceConfig.adapter ? 'live_configured' : 'fixture',
            provider: live
              ? `${live.provider}/${live.model_id} (configured, unverified) + deterministic-fixture-v1`
              : apiKeys?.canSave
                ? 'deterministic-fixture-v1; OpenAI keys can be saved per workspace'
                : 'deterministic-fixture-v1',
            live_enabled: Boolean(live || sourceConfig.adapter),
            live: {
              model: live ? 'configured_unverified' : 'not_configured',
              sources: sourceConfig.adapter ? 'configured_unverified' : 'off',
            },
            persistent: storage === 'postgresql',
            storage,
            maintenance: maintenance.snapshot(),
            portfolio_scheduler: await schedulerHealth(),
          }),
        );
      if (req.method === 'GET' && req.url === '/api/broker/status')
        return respond(
          res,
          200,
          parse(BrokerStatusSchema, {
            fixture_adapter: 'deterministic-fixture-broker-v1',
            live: { openai: live ? 'configured_unverified' : 'not_configured' },
            live_model_id: live?.model_id ?? null,
            note: live
              ? `Live adapter for ${live.model_id} is configured; a call still needs pricing, a covering grant and a funded envelope. No live call has been verified.`
              : 'Fixture workspaces use the deterministic adapter. No OpenAI key was set when the studio started; a real workspace can use the OpenAI API route once its owner saves a key in Models and connections, and is denied until then.',
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
            // PR #103 review L4: the installed studio always turns the live adapter on, so say
            // where the websites come from instead of implying some are approved.
            note: sourceConfig.adapter
              ? `Live fetch is on. ${sourceConfig.policy ? 'The hosts above are the startup list; ' : 'The startup list names no websites; '}each workspace's Settings › Evidence websites replaces it once saved, and each fetch still needs a covering source.fetch grant.`
              : 'Live source fetching is off. Fixture workspaces read the synthetic corpus; real workspaces can fetch only after the operator approves source hosts in the studio configuration.',
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
      const opsOut = await opsRoutes.route(req, url, () => readJson(req));
      if (opsOut) {
        if (opsOut.text !== undefined) {
          res.writeHead(opsOut.status, {
            'Content-Type': 'text/plain; version=0.0.4; charset=utf-8',
            'Cache-Control': 'no-store',
            'X-Content-Type-Options': 'nosniff',
          });
          res.end(opsOut.text);
          return;
        }
        return respond(res, opsOut.status, opsOut.value);
      }
      const supportOut = await supportRoutes.route(req, url);
      if (supportOut) return respond(res, supportOut.status, supportOut.value);
      const storageOut = await storageRoutes.route(req, url, () =>
        readJson(req),
      );
      if (storageOut) return respond(res, storageOut.status, storageOut.value);
      if (url.pathname.startsWith('/api/desktop/')) {
        if (!store)
          throw new ContractError(
            'STORAGE_UNAVAILABLE',
            'Desktop pairing needs PostgreSQL.',
          );
        await ensureReady();
        await desktopRoutes({
          req,
          res,
          url,
          store,
          // ADR-0075: device pairing and desktop jobs are the owner's alone.
          auth: { ...authn, require: authn.requireOwner },
          artifacts,
          body: () => readJson(req),
          send: (status, value) => respond(res, status, value),
          visitor: visitorKey(req, deployment.mode === 'hosted', visitorSalt),
        });
        return;
      }
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
      if (PAYMENTS_RETURN_ROUTE.test(url.pathname) && req.method === 'GET')
        return respond(res, 200, RETURN_BODY);
      const payHook = PAYMENTS_WEBHOOK_ROUTE.exec(url.pathname);
      if (payHook && req.method === 'POST' && store && payments) {
        // No session or CSRF: the signature over the raw body is the authentication.
        await ensureReady();
        const out = await payments.receiveWebhook(
          { actorId: PAYMENT_WEBHOOK_ACTOR_ID },
          payHook[1]!,
          header(req, 'stripe-signature') ?? null,
          await readRaw(req),
        );
        return respond(res, out.status, out.body);
      }
      const hook = GITHUB_WEBHOOK_ROUTE.exec(url.pathname);
      if (hook && req.method === 'POST' && store && github) {
        // No session or CSRF: the HMAC signature over the raw body is the authentication.
        await ensureReady();
        const out = await github.receiveWebhook(
          { actorId: GITHUB_WEBHOOK_ACTOR_ID },
          hook[1]!,
          {
            event: header(req, 'x-github-event'),
            delivery: header(req, 'x-github-delivery'),
            signature: header(req, 'x-hub-signature-256'),
          },
          await readRaw(req),
        );
        return respond(res, out.status, out.body);
      }
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
          error: {
            code: e.code,
            message: e.message,
            details: e.details,
            ...(e.reasons.length ? { reasons: e.reasons } : {}),
          },
        });
    });
  });
  // Review L4: each request's body has its own deadline (bodyDeadline); this only caps uploads.
  server.requestTimeout = SERVER_REQUEST_MS;
  server.headersTimeout = 10000;
  async function close() {
    if (relay) clearInterval(relay);
    await worker?.stop();
    await qualificationQueue?.stop();
    await recipeQualifications?.stop();
    await autopilot?.close();
    await portfolio?.stop();
    server.closeAllConnections();
    preview.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    if (preview.listening)
      await new Promise<void>((resolve) => preview.close(() => resolve()));
    await pool?.end();
  }
  return {
    server,
    /** Separate private-preview origin; listen on config.preview_port at 127.0.0.1. */
    preview,
    artifacts,
    config,
    store,
    broker,
    sources,
    portfolio,
    worker,
    ready: () => ready,
    close,
    ops,
    deployment,
    configHash,
    authMode: authn.mode,
    inference: {
      api_model: live ? `${live.provider}/${live.model_id}` : null,
      plan_connections: planService !== null,
    },
    /** The development login code generated at startup, if one was not configured. */
    loginCode: authn.generatedCode,
  };
}
import { MARKETING_ROUTE, marketingRoutes } from './marketing.js';
import {
  PORTFOLIO_ROUTE,
  PortfolioService,
  portfolioRoutes,
} from './portfolio.js';
export { visitorKey } from './desktop.js';
export {
  RUN_COMPARE_ROUTE,
  compareRuns,
  comparisonSide,
  type RunCompareStore,
} from './run-compare.js';
export { createPreviewServer } from './artifacts.js';
export { WebDiscoveryRunner, stepId, answerJson } from './web-discovery.js';
export {
  AutopilotRunner,
  autopilotKey,
  capAlso,
  failedNote,
  fitNote,
  gatherQuestion,
  namesOf,
  nextGatherQuestion,
  refusalKind,
  refusalStop,
  stalledNote,
  spentCandidates,
  spentSettled,
  trimSpent,
  unknownCount,
  type SpentDetail,
  webResearch,
  type AutopilotWeb,
} from './autopilot.js';
export {
  checkCwd,
  checkEnv,
  runCapabilityCheck,
  type CapabilityRunner,
} from './team-checks.js';
export { supportReportRoutes } from './support-report.js';
