import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BrokerCallResultSchema,
  BuildApprovalResultSchema,
  buildBlockers,
  specRecipe,
  connectionDataBlocker,
  ContractError,
  EntityDetailSchema,
  GrantSchema,
  RunControlSchema,
  SpecBodySchema,
  SpecStatusSchema,
  WorkspaceSchema,
  parse,
  recipePasses,
  z,
  type SpecBody,
} from '@creator/contracts';
import type { CommandContext, ConnectionStore } from '@creator/db';
import type { ModelBroker } from '@creator/broker';
import {
  BUILD_FIXTURE_SPEC,
  fixtureHumilityReview,
  frozenBrowserCases,
  frozenCases,
} from '@creator/domain';
import {
  BuildSupervisor,
  ReapUnverified,
  bindingSchema,
  buildOutcomeSchema,
  buildPlanSchema,
  planRoleResultSchema,
  type ArtifactSupervisor,
  type Binding,
  type BuildOutcome,
  type BuildPorts,
  type BuildProgress,
  type Product,
} from '@creator/executor';

/**
 * ADR-0046: product builds and packaging started from the studio itself (the desktop app has
 * no CLI). The same supervisors the CLI uses run in this process; their ports call the store
 * and broker directly under the signed-in owner's context instead of over HTTP, with the same
 * checks. Generated code still runs only in the execution worker.
 */
export const PRODUCTS_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(products)(?:\/([^/]+)(?:\/(tasks|builds|package|recover))?)?$/;

const uuid = z.uuid();
const CreateProductBody = z.strictObject({ spec_id: uuid });
const CreateTaskBody = z.strictObject({
  task_key: z.string().regex(/^T[1-9][0-9]?$/),
  expected_commit: z.string().regex(/^[0-9a-f]{40}$/),
});
// The executable cases are frozen in the spec, so the caller never supplies them.
const StartBuildBody = z.strictObject({
  task_id: uuid,
  expected_commit: z.string().regex(/^[0-9a-f]{40}$/),
  plan: buildPlanSchema.omit({ cases: true }),
});
const PackageBody = z.strictObject({ build_id: uuid });
const SampleBody = z.strictObject({ spec_id: uuid });
// The sample spec goes into an existing spec, or is written from a build selection.
const SampleSpecBody = z.union([
  SampleBody,
  z.strictObject({
    selection_id: uuid,
    alternative: z.strictObject({ id: uuid, version: z.number().int().min(1) }),
  }),
]);

type Job =
  | { state: 'running' }
  | { state: 'failed'; error: string }
  | { state: 'done'; artifact_id?: string };
/** A JSON round trip, then the contract: the same shapes the CLI reads over HTTP. */
const via = <T>(schema: z.ZodType<T>, value: unknown): T =>
  parse(schema, JSON.parse(JSON.stringify(value)));
/**
 * The caller's context without its request Idempotency-Key. Store commands replay on that key,
 * so a background build reusing it would replay one admission for every round and build.
 */
const bare = ({ idempotencyKey: _, ...ctx }: CommandContext): CommandContext =>
  ctx;
const reason = (e: unknown) =>
  (e instanceof Error ? e.message : String(e)).slice(0, 2000);
/** Product-store errors say what is wrong (stale base, missing Git): pass them on. */
const refusal = (e: unknown): never => {
  throw e instanceof ContractError
    ? e
    : new ContractError('INVALID_TRANSITION', reason(e));
};

export class StudioBuilds {
  /** Builds and packages started by this process; restarts forget them (state is on disk). */
  private readonly builds = new Map<string, Job>();
  /** Products with a build or recovery running here; a second start is refused, not queued. */
  private readonly building = new Set<string>();
  private readonly packages = new Map<string, Job>();
  constructor(
    private readonly store: ConnectionStore,
    private readonly broker: ModelBroker,
    private readonly artifacts: ArtifactSupervisor,
    private readonly codex?: (
      ctx: CommandContext,
      ws: string,
      connectionId: string,
      body: unknown,
    ) => Promise<unknown>,
    // ADR-0048: builder and reviewer as fresh plan Responses requests, when a plan names it.
    private readonly planRole?: (
      ctx: CommandContext,
      ws: string,
      connectionId: string,
      body: unknown,
    ) => Promise<unknown>,
    private readonly planRolesReady?: (
      ctx: CommandContext,
      ws: string,
      connectionId: string,
      body: unknown,
    ) => Promise<unknown>,
    /** Test seam (B3): wraps a build's ports, for scripted fixture role answers. */
    private readonly wrapPorts: (ports: BuildPorts) => BuildPorts = (p) => p,
  ) {}
  private get supervisor() {
    return new BuildSupervisor(
      this.artifacts.products,
      this.artifacts.executor,
    );
  }

  /** The current active frozen spec as a binding; only the workspace owner may build. */
  private async frozen(
    ctx: CommandContext,
    ws: string,
    specId: string,
  ): Promise<{ binding: Binding; spec: SpecBody }> {
    const workspaces = via(
      z.array(WorkspaceSchema),
      await this.store.listWorkspaces(ctx),
    );
    if (!workspaces.some((w) => w.id === ws && w.role === 'owner'))
      throw new ContractError(
        'ACCESS_DENIED',
        'Only the workspace owner can build products.',
      );
    const [status, detail] = await Promise.all([
      this.store
        .specStatus(ctx, ws, specId)
        .then((s) => via(SpecStatusSchema, s)),
      this.store
        .getEntity(ctx, ws, specId)
        .then((d) => via(EntityDetailSchema, d)),
    ]);
    const freeze = status.latest_freeze;
    if (
      !status.frozen_current ||
      !freeze ||
      status.spec.status !== 'active' ||
      status.problems.length ||
      status.blockers.length ||
      detail.entity.version !== status.spec.version ||
      detail.entity.content_hash !== status.spec.content_hash ||
      freeze.content_hash !== status.spec.content_hash
    )
      throw new ContractError(
        'INVALID_TRANSITION',
        'A current active frozen specification is required.',
      );
    const spec = parse(SpecBodySchema, detail.entity.body);
    return {
      spec,
      binding: parse(bindingSchema, {
        workspace_id: ws,
        owner_id: ctx.actorId,
        spec_id: specId,
        spec_version: status.spec.version,
        spec_hash: status.spec.content_hash,
        freeze_id: freeze.id,
        tasks: spec.tasks
          .filter((t) => t.file_scope.length)
          .map((t) => ({
            key: t.key,
            hash: freeze.task_hashes[t.key],
            file_scope: t.file_scope,
          })),
      }),
    };
  }

  /** A product of this workspace that this person owns. */
  private async product(
    ctx: CommandContext,
    ws: string,
    productId: string,
  ): Promise<Product> {
    const p = await this.artifacts.products
      .product(parse(uuid, productId))
      .catch(() => {
        throw new ContractError('NOT_FOUND', 'Product not found.');
      });
    if (p.binding.workspace_id !== ws)
      throw new ContractError('NOT_FOUND', 'Product not found.');
    if (p.integration_owner !== ctx.actorId)
      throw new ContractError(
        'ACCESS_DENIED',
        'Only the owner who created this product can build it.',
      );
    return p;
  }

  /** The CLI's build ports, against the store and broker in this process (ADR-0046). */
  private ports(
    request: CommandContext,
    ws: string,
    product: Product,
  ): BuildPorts {
    const ctx = bare(request);
    let coverage: { grant_id: string; grant_version: number } | null = null;
    let humility: { id: string; version: number } | null = null;
    const ports: BuildPorts = {
      current: async () => {
        const current = await this.frozen(ctx, ws, product.binding.spec_id);
        this.artifacts.products.assertBinding(product, current.binding);
        return current;
      },
      assertActive: async (runId) => {
        const runs = via(
          z.array(RunControlSchema),
          await this.store.listRuns(ctx, ws),
        );
        const run = runs.find((r) => r.run_id === runId);
        if (
          !run ||
          run.state !== 'active' ||
          run.experiment_condition === 'human_only' ||
          run.autonomy_mode === 'human_only'
        )
          throw new Error(
            'An active non-human-only registered run is required',
          );
        if (coverage && humility) {
          const [grants, review] = await Promise.all([
            this.store
              .listGrants(ctx, ws)
              .then((g) => via(z.array(GrantSchema), g)),
            this.store
              .getEntity(ctx, ws, humility.id)
              .then((d) => via(EntityDetailSchema, d)),
          ]);
          const grant = grants.find((g) => g.id === coverage!.grant_id);
          if (
            !grant ||
            grant.version !==
              coverage.grant_version + (grant.scope === 'once' ? 1 : 0) ||
            grant.status !== (grant.scope === 'once' ? 'consumed' : 'active') ||
            Date.parse(grant.expires_at) <= Date.now() ||
            review.entity.version !== humility.version ||
            review.entity.status !== 'active'
          )
            throw new Error(
              'Build authority or humility review changed or expired',
            );
        }
      },
      // ADR-0054: the build's one approval, recorded with its stated limits.
      authorize: async (plan, scope) => {
        const { admission, approval } = via(
          BuildApprovalResultSchema,
          await this.store.admitBuild(ctx, ws, plan.run_id, {
            build_id: scope.build_id,
            product_id: scope.product_id,
            task_id: scope.task_id,
            spec: {
              id: product.binding.spec_id,
              version: product.binding.spec_version,
            },
            spec_hash: product.binding.spec_hash,
            plan_hash: scope.plan_hash,
            route: scope.route,
            connection_id: scope.connection_id,
            model_id: scope.model_id,
            data_class: plan.data_class,
            humility_review: plan.humility_review,
            request_limit: scope.request_limit,
            max_repairs: scope.max_repairs,
            expires_at: scope.expires_at,
          }),
        );
        if (admission.verdict !== 'allow' || !approval)
          throw new Error(
            `Build admission ${admission.outcome}; decision ${admission.decision_id ?? 'none'}`,
          );
        if (!admission.covered_by)
          throw new Error('Build admission has no covering grant');
        coverage = admission.covered_by;
        humility = plan.humility_review;
        return { admission, approval };
      },
      call: async (runId, request) =>
        via(
          BrokerCallResultSchema,
          await this.broker.call(ctx, ws, runId, request),
        ),
    };
    if (this.codex) {
      const codex = this.codex;
      ports.codexBuilder = async (target, packet) => {
        const { evidence: _, ...out } = (await codex(
          ctx,
          ws,
          target.connection_id,
          {
            build_id: target.build_id,
            run_id: target.run_id,
            model_id: target.model_id,
            data_class: target.data_class,
            packet,
          },
        )) as Record<string, unknown>;
        return out;
      };
    }
    if (this.planRole) {
      const planRole = this.planRole;
      ports.planRole = async (target, request) =>
        via(
          planRoleResultSchema,
          await planRole(ctx, ws, target.connection_id, {
            role: target.role,
            run_id: target.run_id,
            build_id: target.build_id,
            model_id: target.model_id,
            data_class: target.data_class,
            ...request,
          }),
        );
    }
    if (this.planRolesReady) {
      const ready = this.planRolesReady;
      // Review L-5: the same answer carries the connection's input cap, which the build reads
      // right after its preflight.
      const caps = new Map<string, number>();
      ports.planRolesReady = async (target) => {
        const r = via(
          z.strictObject({
            blockers: z.array(z.string()),
            max_input_chars: z.number().int().positive(),
          }),
          await ready(ctx, ws, target.connection_id, {
            model_id: target.model_id,
            run_id: target.run_id,
            data_class: target.data_class,
          }),
        );
        caps.set(target.connection_id, r.max_input_chars);
        return r.blockers;
      };
      ports.planRoleInputCap = async (target) => {
        const cap = caps.get(target.connection_id);
        if (cap === undefined)
          throw new Error('The plan roles preflight has not run');
        return cap;
      };
    }
    return this.wrapPorts(ports);
  }

  /** What one product's builds show: the outcome on disk, or what this process knows. */
  private async buildList(productId: string) {
    const dir = join(this.artifacts.products.dir(productId), 'builds');
    const names = await readdir(dir).catch(() => [] as string[]);
    const out = [];
    for (const name of names) {
      if (!uuid.safeParse(name).success) continue;
      const read = async (file: string) =>
        JSON.parse(await readFile(join(dir, name, file), 'utf8')) as unknown;
      const intent = (await read('intent.json').catch(() => null)) as {
        task_id: string;
        started_at: string;
      } | null;
      if (!intent) continue;
      const outcome = await read('outcome.json')
        .then((o) => buildOutcomeSchema.parse(o) as BuildOutcome)
        .catch(() => null);
      const job = this.builds.get(name);
      const running = !outcome && job?.state === 'running';
      out.push({
        id: name,
        task_id: intent.task_id,
        started_at: intent.started_at,
        state: outcome
          ? outcome.state
          : job?.state === 'running'
            ? 'running'
            : job?.state === 'failed'
              ? 'failed'
              : 'interrupted',
        reason: outcome?.reason ?? (job?.state === 'failed' ? job.error : null),
        commit: outcome?.commit ?? null,
        fixture: outcome?.fixture ?? null,
        finished_at: outcome?.finished_at ?? null,
        package: this.packages.get(name) ?? null,
        progress: null as BuildProgress | null,
        running,
      });
    }
    out.sort((a, b) => b.started_at.localeCompare(a.started_at));
    // B3: the timeline and failure details of each task's newest build. Older builds keep their
    // one line; an unreadable folder shows no timeline rather than failing the whole list.
    const seen = new Set<string>();
    for (const b of out) {
      if (seen.has(b.task_id)) continue;
      seen.add(b.task_id);
      b.progress = await this.supervisor
        .progress(productId, b.id, b.running)
        .catch(() => null);
    }
    return out.map(({ running: _, ...b }) => b);
  }

  async list(ctx: CommandContext, ws: string) {
    // Reading needs workspace access; listing workspaces checks the session.
    const workspaces = via(
      z.array(WorkspaceSchema),
      await this.store.listWorkspaces(ctx),
    );
    if (!workspaces.some((w) => w.id === ws))
      throw new ContractError('NOT_FOUND', 'Workspace not found.');
    const root = this.artifacts.products.root;
    const names = await readdir(root).catch(() => [] as string[]);
    const out = [];
    for (const name of names) {
      if (!uuid.safeParse(name).success) continue;
      const p = await this.artifacts.products.product(name).catch(() => null);
      if (!p || p.binding.workspace_id !== ws) continue;
      const tasks = await this.artifacts.products.tasks(p.id);
      out.push({
        product: p,
        // Each task's current candidate: where the next build continues (F12, ADR-0054).
        tasks: await Promise.all(
          tasks.map(async (t) => ({
            ...t,
            head: await this.artifacts.products
              .taskHead(p.id, t.id)
              .catch(() => null),
          })),
        ),
        builds: await this.buildList(p.id),
      });
    }
    return out;
  }

  /**
   * Fixture workspaces only: the $0 sample. Puts the synthetic checklist content (the one
   * spec the fixture builder answers for) into a spec as a new version; freezing it stays
   * the owner's step, under its usual admission.
   */
  async sampleSpec(ctx: CommandContext, ws: string, raw: unknown) {
    const req = parse(SampleSpecBody, raw);
    await this.fixtureOnly(ctx, ws);
    if ('selection_id' in req)
      return this.store.createSpec(ctx, ws, {
        selection_id: req.selection_id,
        alternative: req.alternative,
        title: 'Synthetic checklist sample',
        content: BUILD_FIXTURE_SPEC,
      });
    const spec_id = req.spec_id;
    const status = via(
      SpecStatusSchema,
      await this.store.specStatus(ctx, ws, spec_id),
    );
    return this.store.reviseSpec(ctx, ws, spec_id, {
      expected_version: status.spec.version,
      title: 'Synthetic checklist sample',
      content: BUILD_FIXTURE_SPEC,
      reason: 'Fixture build sample: synthetic content, no product claim',
    });
  }
  /** Fixture workspaces only: a labelled synthetic humility review of the spec's version. */
  async sampleReview(ctx: CommandContext, ws: string, raw: unknown) {
    const { spec_id } = parse(SampleBody, raw);
    await this.fixtureOnly(ctx, ws);
    const status = via(
      SpecStatusSchema,
      await this.store.specStatus(ctx, ws, spec_id),
    );
    return this.store.createEntity(ctx, ws, {
      kind: 'humility_review',
      title: `Synthetic humility review (fixture sample) v${status.spec.version}`,
      body: fixtureHumilityReview(
        { id: spec_id, version: status.spec.version },
        [],
      ),
    });
  }
  private async fixtureOnly(ctx: CommandContext, ws: string) {
    if (!(await this.store.isFixtureWorkspace(ctx, ws)))
      throw new ContractError(
        'SCOPE_EXCEEDED',
        'The build sample is synthetic and only exists in fixture workspaces.',
      );
  }

  async create(ctx: CommandContext, ws: string, raw: unknown) {
    const { spec_id } = parse(CreateProductBody, raw);
    const { binding, spec } = await this.frozen(ctx, ws, spec_id);
    // ADR-0078: the frozen checks choose the recipe, and with it the reviewed template.
    const recipe = specRecipe(spec);
    if (recipe === 'mixed')
      throw new ContractError(
        'INVALID_TRANSITION',
        'This spec has tasks for a command-line program and tasks for a static web page. A product builds one kind: split them into two specs.',
      );
    return this.artifacts.products
      .create(binding, undefined, recipe)
      .catch(refusal);
  }

  async createTask(
    ctx: CommandContext,
    ws: string,
    productId: string,
    raw: unknown,
  ) {
    const req = parse(CreateTaskBody, raw);
    const p = await this.product(ctx, ws, productId);
    const { binding } = await this.ports(ctx, ws, p).current();
    return this.artifacts.products
      .createTask(p.id, req.task_key, req.expected_commit, binding)
      .catch(refusal);
  }

  /**
   * Starts a build and answers once its intent is recorded; the build goes on in this process.
   * A refusal before that (admission, stale candidate, plan) is the request's error.
   */
  async startBuild(
    ctx: CommandContext,
    ws: string,
    productId: string,
    raw: unknown,
  ): Promise<{ build_id: string; state: 'running' }> {
    const req = parse(StartBuildBody, raw);
    const p = await this.product(ctx, ws, productId);
    if (this.building.has(p.id))
      throw new ContractError(
        'VERSION_CONFLICT',
        'A build of this product is already running; wait for it to finish.',
      );
    this.building.add(p.id);
    try {
      return await this.begin(ctx, ws, p, req);
    } catch (e) {
      this.building.delete(p.id);
      throw e;
    }
  }
  private async begin(
    ctx: CommandContext,
    ws: string,
    p: Product,
    req: z.infer<typeof StartBuildBody>,
  ): Promise<{ build_id: string; state: 'running' }> {
    const ports = this.ports(ctx, ws, p);
    const { spec } = await ports.current();
    const task = await this.artifacts.products.task(p.id, req.task_id);
    // Said in words before the build starts; the build supervisor enforces the same rules.
    const blockers = buildBlockers(spec, task.key, req.plan.data_class);
    if (blockers.length)
      throw new ContractError(
        'INVALID_TRANSITION',
        `This build can't start yet. ${blockers.join(' ')}`,
      );
    // A plan connection admits only the data classes its settings allow; refused here, in words,
    // before a build is recorded (the plan-role preflight checks it again).
    const target = req.plan.plan_roles ?? req.plan.codex_plan_builder;
    if (target) {
      const detail = await this.store.planConnectionDetail(
        bare(ctx),
        ws,
        target.connection_id,
      );
      const refusal = connectionDataBlocker(
        detail.connection.settings.allowed_data_classes,
        req.plan.data_class,
        detail.connection.label,
      );
      if (refusal)
        throw new ContractError(
          'INVALID_TRANSITION',
          `This build can't start yet. ${refusal}`,
        );
    }
    const assigned = spec.tasks.find((t) => t.key === task.key);
    // B3: a static web product's cases are its browser cases (ADR-0078). Before this the app
    // sent none, so every web build started from the Build page was refused.
    const frozen: { held_out: boolean }[] =
      p.recipe === 'static-web/1'
        ? frozenBrowserCases(spec, assigned?.acceptance ?? [])
        : frozenCases(spec, assigned?.acceptance ?? []);
    const cases = frozen.map(({ held_out: _, ...c }) => c);
    return new Promise((resolve, reject) => {
      let started: string | null = null;
      this.supervisor
        .run(
          p.id,
          req.task_id,
          req.expected_commit,
          { ...req.plan, cases },
          ports,
          (buildId) => {
            started = buildId;
            this.builds.set(buildId, { state: 'running' });
            resolve({ build_id: buildId, state: 'running' });
          },
        )
        .finally(() => this.building.delete(p.id))
        .then(
          (outcome) => this.builds.set(outcome.id, { state: 'done' }),
          (e: unknown) => {
            if (started)
              this.builds.set(started, { state: 'failed', error: reason(e) });
            else
              reject(
                e instanceof ContractError
                  ? e
                  : new ContractError('INVALID_TRANSITION', reason(e)),
              );
          },
        );
    });
  }

  /**
   * After the app closed or crashed mid-build: releases the product's locks whose process is
   * gone. Never while a build of it runs here; interrupted builds stay recorded, never resent.
   */
  async recover(ctx: CommandContext, ws: string, productId: string) {
    const p = await this.product(ctx, ws, productId);
    if (this.building.has(p.id))
      throw new ContractError(
        'VERSION_CONFLICT',
        'A build or recovery of this product is running; wait for it.',
      );
    // Held for the whole recovery: no build of it starts, and no second recovery runs.
    this.building.add(p.id);
    try {
      return await this.recoverHeld(bare(ctx), ws, p);
    } finally {
      this.building.delete(p.id);
    }
  }
  /**
   * In order: the management lock (reconciliation needs it), then every acceptance run the
   * crash left running, reconciled by the executor, which verifies the WSL2 worker stopped and
   * then frees the dispatch lock and pending marker, then the build lock, then a dispatch lock
   * left with no worker. A refusal stops recovery there, saying why; nothing is resent.
   */
  private async recoverHeld(ctx: CommandContext, ws: string, p: Product) {
    const products = this.artifacts.products,
      executor = this.artifacts.executor;
    const released: string[] = [];
    const reconciled: string[] = [];
    const step = async <T>(work: () => Promise<T>) => work().catch(refusal);
    if (
      await step(() => products.recoverDeadLock('product', p.id, ctx.actorId))
    )
      released.push('product');
    // A reconciliation that cannot verify the worker stopped (WSL failing) says what to do.
    const settle = async (product: string, execution: string) => {
      const before = await executor.status(product, execution);
      const record = await executor
        .reconcile(product, execution, ctx.actorId)
        .catch((e: unknown) =>
          refusal(
            // Only a failed reap (WSL failing, or no WSL backend) gets the WSL advice; locks,
            // missing files and ownership refusals stand as they are.
            e instanceof ReapUnverified
              ? new Error(
                  `${reason(e).replace(/\.$/, '')}. The test run could not be confirmed stopped: check that WSL works (wsl.exe in a terminal), then Recover again.`,
                )
              : e,
          ),
        );
      // Listed only when it changed now; an already settled run just had its marker freed.
      if (before.state !== record.state) reconciled.push(execution);
    };
    for (const e of await step(() => executor.executions(p.id)))
      if (['running', 'cleanup_required'].includes(e.state))
        await settle(p.id, e.id);
    if (await step(() => products.recoverDeadLock('builds', p.id, ctx.actorId)))
      released.push('builds');
    // The studio-wide marker may name another product's run; only one of this owner's.
    const marker = await readFile(
      join(products.root, 'pending-worker.json'),
      'utf8',
    )
      .then(
        (t) => JSON.parse(t) as { product_id?: string; execution_id?: string },
      )
      .catch(() => null);
    if (marker?.product_id && marker.execution_id) {
      const owner = await products.product(marker.product_id).catch(() => null);
      if (
        owner &&
        owner.binding.workspace_id === ws &&
        owner.integration_owner === ctx.actorId
      ) {
        // Another product's run that is genuinely still going: this product's own locks are
        // already free; the studio waits for that run instead of failing the whole recovery.
        const live = await executor
          .status(owner.id, marker.execution_id)
          .then(
            (e) =>
              e.state === 'running' &&
              owner.id !== p.id &&
              this.building.has(owner.id),
          )
          .catch(() => false);
        if (live)
          return {
            product_id: p.id,
            released,
            reconciled,
            waiting:
              'Another product is running a test now; build again when it finishes.',
          };
        await settle(owner.id, marker.execution_id);
      }
    }
    if (
      await step(() => products.recoverDeadLock('dispatch', p.id, ctx.actorId))
    )
      released.push('dispatch');
    return { product_id: p.id, released, reconciled, waiting: null };
  }

  /** Packages a verified build in the worker, then lists it in Gallery. Runs in the background. */
  async package(
    ctx: CommandContext,
    ws: string,
    productId: string,
    raw: unknown,
  ): Promise<{ build_id: string; state: 'running' }> {
    const { build_id } = parse(PackageBody, raw);
    const p = await this.product(ctx, ws, productId);
    if (this.packages.get(build_id)?.state === 'running')
      throw new ContractError(
        'VERSION_CONFLICT',
        'That build is already being packaged.',
      );
    // Reserved before the first await, so a second request for this build is refused.
    const previous = this.packages.get(build_id);
    this.packages.set(build_id, { state: 'running' });
    try {
      return await this.packageReserved(ctx, ws, p, build_id);
    } catch (e) {
      if (previous) this.packages.set(build_id, previous);
      else this.packages.delete(build_id);
      throw e;
    }
  }
  private async packageReserved(
    ctx: CommandContext,
    ws: string,
    p: Product,
    build_id: string,
  ): Promise<{ build_id: string; state: 'running' }> {
    const ports = this.ports(ctx, ws, p);
    // The same re-checks packaging starts with, so a stale build is refused now, not later.
    const outcome = await this.supervisor
      .status(p.id, build_id, ports)
      .catch((e: unknown) => {
        throw new ContractError('INVALID_TRANSITION', reason(e));
      });
    if (outcome.state !== 'verified_candidate')
      throw new ContractError(
        'INVALID_TRANSITION',
        'Only a verified build can be packaged.',
      );
    void (async () => {
      try {
        const packaged = await this.artifacts.package(
          p.id,
          build_id,
          ports,
          undefined,
          undefined,
          // ADR-0105: the connection's build qualification records decide the trial label.
          async (roles) =>
            recipePasses(
              await this.store
                .listRecipeQualifications(bare(ctx), ws, roles.connection_id)
                .catch(() => []),
            ),
        );
        // As the register route does: re-read and re-hash what is on disk before listing it.
        const { manifest, manifest_sha256 } = await this.artifacts.manifest(
          p.id,
          packaged.manifest.id,
          packaged.manifest_sha256,
        );
        await this.artifacts.open(p.id, packaged.manifest.id, manifest_sha256);
        await this.store.registerArtifact(
          bare(ctx),
          ws,
          manifest,
          manifest_sha256,
        );
        this.packages.set(build_id, {
          state: 'done',
          artifact_id: packaged.manifest.id,
        });
      } catch (e) {
        this.packages.set(build_id, { state: 'failed', error: reason(e) });
      }
    })();
    return { build_id, state: 'running' };
  }
}

export async function productRoutes(o: {
  service: StudioBuilds;
  ctx: CommandContext;
  ws: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  body: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  const { service, ctx, ws, item, action, method, send } = o;
  if (!item && method === 'GET')
    return send(200, await service.list(ctx, ws), false);
  if (!item && method === 'POST')
    return send(201, await service.create(ctx, ws, await o.body()), true);
  if (item === 'sample-spec' && !action && method === 'POST')
    return send(200, await service.sampleSpec(ctx, ws, await o.body()), true);
  if (item === 'sample-review' && !action && method === 'POST')
    return send(201, await service.sampleReview(ctx, ws, await o.body()), true);
  if (item && action === 'tasks' && method === 'POST')
    return send(
      201,
      await service.createTask(ctx, ws, item, await o.body()),
      true,
    );
  if (item && action === 'builds' && method === 'POST')
    return send(
      202,
      await service.startBuild(ctx, ws, item, await o.body()),
      true,
    );
  if (item && action === 'recover' && method === 'POST')
    return send(200, await service.recover(ctx, ws, item), true);
  if (item && action === 'package' && method === 'POST')
    return send(
      202,
      await service.package(ctx, ws, item, await o.body()),
      true,
    );
  return false;
}
