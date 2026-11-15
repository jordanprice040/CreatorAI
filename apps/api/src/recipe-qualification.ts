import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  ContractError,
  RECIPE_BENCHMARK_IDS,
  RECIPE_BENCHMARK_INFO,
  RecipeBenchmarkIdSchema,
  SpecBodySchema,
  StartRecipeQualificationRequestSchema,
  parse,
  recipeQualificationMaxRequests,
  type RecipeAttemptResult,
  type RecipeBenchmarkOffers,
  type RecipePassBar,
  type RecipeQualificationRecord,
  type SpecBody,
} from '@creator/contracts';
import type { CommandContext, ConnectionStore } from '@creator/db';
import type { PlanConnectionService } from '@creator/broker';
import {
  BUILD_ROLE_PROMPTS,
  frozenBrowserCases,
  frozenCases,
  taskHashes,
} from '@creator/domain';
import {
  ArtifactSupervisor,
  BuildSupervisor,
  ExecutionSupervisor,
  ProductSupervisor,
  RECIPE_BENCHMARKS_ROOT,
  barsPassed,
  bindingSchema,
  casePassed,
  digest,
  infrastructureStop,
  loadRecipeBenchmark,
  onlyBusyRefusal,
  refusalError,
  readTar,
  recipeFreezeProblems,
  structureBar,
  type BuildPorts,
  type RecipeBenchmark,
} from '@creator/executor';

// ADR-0105 (B1): build (recipe) qualifications run by the studio itself. Each attempt is one
// build of the frozen benchmark spec in a product store of its own (never the studio's products,
// Gallery or catalog), through the same BuildSupervisor, isolated worker QA and packaging as any
// build. The owner's start is the one approval for its attempts' builder and reviewer requests;
// admission checks each one against the attempt (connection, model, build, request limit).

/** How long a lease lasts without renewal; a crashed process's qualification is taken over after it. */
export const RECIPE_LEASE_MS = 120_000;
const RENEW_MS = 30_000;
const POLL_MS = 15_000;
/** One attempt's build deadline: a passing attempt takes minutes, so an hour means it is stuck. */
export const RECIPE_ATTEMPT_DEADLINE_MS = 60 * 60_000;
/**
 * Re-review L-3: how long a role request waits, at most, for another request on its connection
 * (a chat answer, an autopilot step, a model check) to finish. Longer than any one request may
 * run (the Claude Code connection allows 180 s), so a request that was sent always finishes or
 * is cut off inside it.
 */
export const RECIPE_ROLE_BUSY_WAIT_MS = 4 * 60_000;
const ROLE_BUSY_POLL_MS = 5_000;

/**
 * Sends one role request, waiting (bounded) while the only refusal is another request running
 * on the connection. Any other refusal comes back as a build reason that keeps its refusal
 * codes, which the scorer reads (`infrastructureStop`).
 */
export async function sendWhenFree<T>(
  send: () => Promise<T>,
  opts: {
    boundMs?: number;
    pollMs?: number;
    stopped?: () => boolean;
  } = {},
): Promise<T> {
  const until = Date.now() + (opts.boundMs ?? RECIPE_ROLE_BUSY_WAIT_MS);
  for (;;) {
    try {
      return await send();
    } catch (e) {
      if (
        onlyBusyRefusal(e) &&
        Date.now() < until &&
        !(opts.stopped?.() ?? false)
      ) {
        await new Promise((r) =>
          setTimeout(r, opts.pollMs ?? ROLE_BUSY_POLL_MS),
        );
        continue;
      }
      throw refusalError(e) ?? e;
    }
  }
}

/** Unexpected errors in a row after which a qualification is stopped instead of retried. */
export const RECIPE_MAX_FAILURES = 3;

/** The prompt hashes a build records (artifacts.ts buildRoles hashes the same strings). */
export const currentRolePromptHashes = () => ({
  builder_prompt_sha256: digest(BUILD_ROLE_PROMPTS.builder),
  reviewer_prompt_sha256: digest(BUILD_ROLE_PROMPTS.reviewer),
});

/** What Qualify offers: each in-app benchmark, whether it may run now, and its request bound. */
export async function recipeBenchmarkOffers(
  root = RECIPE_BENCHMARKS_ROOT,
): Promise<RecipeBenchmarkOffers> {
  return {
    benchmarks: await Promise.all(
      RECIPE_BENCHMARK_IDS.map(async (id) => {
        const info = RECIPE_BENCHMARK_INFO[id];
        return {
          ...info,
          caps: { ...info.caps },
          max_requests: recipeQualificationMaxRequests(info),
          freeze_problems: await recipeFreezeProblems(id, root),
        };
      }),
    ),
    role_prompts: currentRolePromptHashes(),
  };
}

/** The owner's start: the studio binds the frozen benchmark and the current role prompts. */
export async function startRecipeQualification(
  store: ConnectionStore,
  ctx: CommandContext,
  ws: string,
  connectionId: string,
  raw: unknown,
  root = RECIPE_BENCHMARKS_ROOT,
): Promise<RecipeQualificationRecord> {
  const req = parse(StartRecipeQualificationRequestSchema, raw);
  const bench = await loadRecipeBenchmark(req.benchmark_id, root).catch(
    (e: unknown) => {
      throw new ContractError(
        'INVALID_CONFIG',
        `This benchmark can't run: ${e instanceof Error ? e.message : String(e)}`,
      );
    },
  );
  return store.startRecipeQualification(ctx, ws, connectionId, req, {
    recipe: bench.info.recipe,
    attempts_needed: bench.info.attempts,
    freeze_sha256: bench.freeze_sha256,
    ...currentRolePromptHashes(),
  });
}

type RunnerStore = Pick<
  ConnectionStore,
  | 'leaseRecipeQualification'
  | 'renewRecipeQualificationLease'
  | 'releaseRecipeQualificationLease'
  | 'nextRecipeAttempt'
  | 'recordRecipeAttemptBuild'
  | 'recipeAttemptRunning'
  | 'finishRecipeAttempt'
  | 'abandonRecipeQualification'
  | 'getRecipeQualification'
>;

const message = (e: unknown) =>
  (e instanceof ContractError
    ? [e.message, ...e.details].join(' ')
    : e instanceof Error
      ? e.message
      : String(e)
  ).slice(0, 2000);

/**
 * Runs started build qualifications one attempt after another under a database lease, like
 * the qualification queue (ADR-0088): the person can leave the page, and a studio that stops
 * leaves the lease to expire; the next process marks the interrupted attempt invalid (it is
 * never re-sent) and replaces it once, as the frozen rules allow.
 */
export class RecipeQualificationRunner {
  readonly holder: string;
  readonly #active = new Map<string, Promise<void>>();
  readonly #failures = new Map<string, number>();
  #timer: ReturnType<typeof setInterval> | null = null;
  #sweeping: Promise<void> | null = null;
  #stopped = false;

  constructor(
    private readonly deps: {
      store: RunnerStore;
      service: Pick<PlanConnectionService, 'buildRole' | 'buildRolesReady'>;
      /** The qualification harness's own product store and worker (never the studio's). */
      products: ProductSupervisor;
      executor: ExecutionSupervisor;
      root?: URL;
      leaseMs?: number;
      deadlineMs?: number;
      onError?: (e: unknown) => void;
    },
    holder: string = randomUUID(),
  ) {
    this.holder = holder;
  }

  start() {
    if (this.#timer) return;
    this.#stopped = false;
    this.#timer = setInterval(() => this.kick(), POLL_MS);
    this.#timer.unref();
    this.kick();
  }

  kick() {
    if (this.#stopped || this.#sweeping) return;
    this.#sweeping = this.sweep()
      .catch((e: unknown) => this.deps.onError?.(e))
      .finally(() => {
        this.#sweeping = null;
      });
  }

  async stop() {
    this.#stopped = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    await this.#sweeping;
  }

  async sweep() {
    const ms = this.deps.leaseMs ?? RECIPE_LEASE_MS;
    while (!this.#stopped) {
      const lease = await this.deps.store.leaseRecipeQualification(
        this.holder,
        ms,
        [...this.#active.keys()],
      );
      if (!lease) return;
      const work = this.#work(lease.id, lease.workspace_id, lease.created_by)
        .then(() => {
          this.#failures.delete(lease.id);
        })
        .catch((e: unknown) => this.#failed(lease.id, e))
        .finally(() => this.#active.delete(lease.id));
      this.#active.set(lease.id, work);
    }
  }

  /** Waits for every qualification this runner is working on (tests). */
  async idle() {
    await this.#sweeping;
    await Promise.allSettled([...this.#active.values()]);
  }

  async #work(id: string, ws: string, actorId: string) {
    const { store } = this.deps;
    const ms = this.deps.leaseMs ?? RECIPE_LEASE_MS;
    const renew = setInterval(
      () => {
        void store
          .renewRecipeQualificationLease(id, this.holder, ms)
          .catch((e: unknown) => this.deps.onError?.(e));
      },
      Math.min(RENEW_MS, Math.max(1000, Math.floor(ms / 4))),
    );
    renew.unref();
    // A waiting qualification keeps its short lease, so it is looked at again when it lapses.
    let keepLease = false;
    try {
      const ctx: CommandContext = { actorId };
      const q = await store.getRecipeQualification(ctx, ws, id);
      const benchmarkId = RecipeBenchmarkIdSchema.parse(q.benchmark_id);
      const info = RECIPE_BENCHMARK_INFO[benchmarkId];
      while (!this.#stopped) {
        const next = await store.nextRecipeAttempt(
          id,
          this.holder,
          info.caps.max_calls,
        );
        if (next.kind === 'end') return;
        if (next.kind === 'wait') {
          keepLease = true;
          return;
        }
        const out = await this.#attempt(ctx, ws, q, next.attempt_id).catch(
          (e: unknown) => ({
            state: 'invalid' as const,
            reason: `The studio could not finish this attempt: ${message(e)}`,
            repairs: null,
            result: null,
          }),
        );
        await store.finishRecipeAttempt(next.attempt_id, this.holder, out);
      }
    } finally {
      clearInterval(renew);
      if (!keepLease)
        await store
          .releaseRecipeQualificationLease(id, this.holder)
          .catch((e: unknown) => this.deps.onError?.(e));
    }
  }

  async #failed(id: string, e: unknown) {
    this.deps.onError?.(e);
    const n = (this.#failures.get(id) ?? 0) + 1;
    this.#failures.set(id, n);
    if (n < RECIPE_MAX_FAILURES) return;
    this.#failures.delete(id);
    await this.deps.store
      .abandonRecipeQualification(id, this.holder, message(e))
      .catch((x: unknown) => this.deps.onError?.(x));
  }

  /** One attempt: a build of the frozen spec, its package, then the post-build bars. */
  async #attempt(
    ctx: CommandContext,
    ws: string,
    q: RecipeQualificationRecord,
    attemptId: string,
  ): Promise<{
    state: 'passed' | 'failed' | 'invalid';
    reason: string;
    repairs: number | null;
    result: RecipeAttemptResult | null;
  }> {
    const { store, service, products, executor } = this.deps;
    const started = Date.now();
    const bench: RecipeBenchmark = await loadRecipeBenchmark(
      RecipeBenchmarkIdSchema.parse(q.benchmark_id),
      this.deps.root,
    );
    if (bench.freeze_sha256 !== q.freeze_sha256)
      return {
        state: 'invalid',
        reason:
          'The frozen benchmark on this computer is not the one this qualification started with.',
        repairs: null,
        result: null,
      };
    const { info } = bench;
    // The spec is the frozen content itself; the qualification stands in for the selection.
    const spec: SpecBody = SpecBodySchema.parse({
      format: 'spec/1',
      alternative: { id: q.id, version: 1 },
      selection_id: q.id,
      ...bench.content,
    });
    const hashes = taskHashes(spec);
    const binding = bindingSchema.parse({
      workspace_id: ws,
      owner_id: q.created_by,
      spec_id: q.id,
      spec_version: 1,
      spec_hash: digest(JSON.stringify(bench.content)),
      freeze_id: attemptId,
      tasks: spec.tasks
        .filter((t) => t.file_scope.length)
        .map((t) => ({
          key: t.key,
          hash: hashes[t.key],
          file_scope: t.file_scope,
        })),
    });
    const assigned = spec.tasks.find((t) => t.role === 'builder');
    if (!assigned) throw new Error('The frozen spec has no builder task.');
    const product = await products.create(binding, undefined, info.recipe);
    const task = await products.createTask(
      product.id,
      assigned.key,
      product.initial_commit,
      binding,
    );
    const web = info.recipe === 'static-web/1';
    const cases = (
      web
        ? frozenBrowserCases(spec, assigned.acceptance)
        : frozenCases(spec, assigned.acceptance)
    ).map(({ held_out: _, ...c }) => c);
    const target = { connection_id: q.connection_id, model_id: q.model_id };
    const plan = {
      format: 'build-plan/1' as const,
      run_id: attemptId,
      envelope_id: attemptId,
      pricing_snapshot_id: attemptId,
      humility_review: { id: q.id, version: 1 },
      data_class: 'synthetic' as const,
      max_repairs: info.caps.max_repairs,
      max_calls: info.caps.max_calls,
      timeout_ms: info.caps.timeout_ms,
      max_output_tokens: info.caps.max_output_tokens,
      deadline: new Date(
        Date.now() + (this.deps.deadlineMs ?? RECIPE_ATTEMPT_DEADLINE_MS),
      ).toISOString(),
      cases,
      plan_roles: target,
    };
    const ports: BuildPorts = {
      current: async () => ({ binding, spec }),
      assertActive: async () => {
        if (!(await store.recipeAttemptRunning(attemptId, this.holder)))
          throw new Error(
            'The build qualification was stopped, or this studio no longer runs it.',
          );
      },
      // The owner's start of the qualification is this build's one approval; the attempt
      // records the build it covers, within the frozen limits.
      authorize: async (p, scope) => {
        if (
          scope.route !== 'plan_roles' ||
          scope.connection_id !== q.connection_id ||
          scope.model_id !== q.model_id ||
          scope.request_limit !== info.caps.max_calls ||
          scope.max_repairs !== info.caps.max_repairs ||
          p.data_class !== 'synthetic'
        )
          throw new Error(
            'The build differs from the frozen qualification limits.',
          );
        if (
          !(await store.recordRecipeAttemptBuild(attemptId, this.holder, {
            product_id: scope.product_id,
            build_id: scope.build_id,
          }))
        )
          throw new Error('The attempt already has a build, or it ended.');
        return {
          covered_by: 'recipe_qualification',
          recipe_qualification_id: q.id,
          attempt_id: attemptId,
          started_by: q.created_by,
          scope,
        };
      },
      call: async () => {
        throw new Error('Build qualifications use the plan roles only.');
      },
      planRole: async (t, request) =>
        sendWhenFree(
          () =>
            service.buildRole(ctx, ws, t.connection_id, {
              role: t.role,
              model_id: t.model_id,
              run_id: null,
              build_id: t.build_id,
              data_class: t.data_class,
              input: request.input,
              timeout_ms: request.timeout_ms,
              logical_operation_id: request.logical_operation_id,
              recipe_attempt_id: attemptId,
            }),
          { stopped: () => this.#stopped },
        ),
      planRolesReady: async (t) =>
        service.buildRolesReady(ctx, ws, t.connection_id, {
          model_id: t.model_id,
          run_id: null,
          data_class: t.data_class,
        }),
    };
    const outcome = await new BuildSupervisor(products, executor).run(
      product.id,
      task.id,
      product.initial_commit,
      plan,
      ports,
    );
    const bars: RecipePassBar[] = [];
    const result = (
      extra: Partial<RecipeAttemptResult> = {},
    ): RecipeAttemptResult => ({
      bars,
      build_reason: outcome.reason,
      manifest_sha256: null,
      archive_sha256: null,
      extended: null,
      wall_ms: Date.now() - started,
      ...extra,
    });
    if (outcome.state !== 'verified_candidate') {
      const invalid = infrastructureStop(outcome.reason);
      bars.push({
        key: 'build_verified',
        passed: false,
        detail: outcome.reason.slice(0, 600),
      });
      return {
        state: invalid ? 'invalid' : 'failed',
        reason: invalid
          ? `Stopped before a verdict (infrastructure): ${outcome.reason}`
          : `The build did not verify: ${outcome.reason}`,
        repairs: outcome.repairs,
        result: result(),
      };
    }
    bars.push({
      key: 'build_verified',
      passed: true,
      detail: `Verified in ${outcome.calls} requests and ${outcome.repairs} repair rounds; QA passed every frozen case and the reviewer approved.`,
    });
    bars.push({
      key: 'requests_within_cap',
      passed: outcome.calls <= info.caps.max_calls,
      // Review 1 N-1: the build itself stops at its cap, so this records the count rather than
      // catching an overrun.
      detail: `${outcome.calls} of at most ${info.caps.max_calls} requests (the build's own cap).`,
    });
    const artifacts = new ArtifactSupervisor(products, executor);
    const packaged = await artifacts.package(product.id, outcome.id, ports);
    const m = packaged.manifest;
    if (m.state === 'blocked')
      return {
        state: 'invalid',
        reason:
          'The worker could not finish the package re-check (infrastructure); no verdict.',
        repairs: outcome.repairs,
        result: result({ manifest_sha256: packaged.manifest_sha256 }),
      };
    bars.push({
      key: 'package_verified',
      passed: m.state === 'verified',
      detail:
        m.state === 'verified'
          ? `The exported package passed all ${m.tests.package.length} frozen cases again in the worker.`
          : `The exported package failed its re-check: ${m.tests.package.filter((c) => !c.passed).length} cases.`,
    });
    let extended: RecipeAttemptResult['extended'] = null;
    if (bench.extended.length || info.scale === 'larger') {
      const archive = await readFile(
        join(artifacts.dir(product.id, m.id), 'source.tar'),
      );
      if (digest(archive) !== m.package.sha256)
        throw new Error('The exported archive changed after packaging.');
      const files = readTar(archive);
      if (bench.extended.length) {
        const failed: string[] = [];
        for (const ext of bench.extended) {
          const e = await executor.runPackage(
            product.id,
            task.id,
            outcome.commit,
            files,
            q.created_by,
            m.package.sha256,
            () => {},
            ext.case,
          );
          if (!['succeeded', 'failed'].includes(e.state))
            return {
              state: 'invalid',
              reason: `The worker did not finish extended case ${ext.id} (${e.state}); no verdict.`,
              repairs: outcome.repairs,
              result: result({
                manifest_sha256: packaged.manifest_sha256,
                archive_sha256: m.package.sha256,
              }),
            };
          if (!casePassed(e, ext.case)) failed.push(ext.id);
        }
        extended = {
          passed: bench.extended.length - failed.length,
          total: bench.extended.length,
          failed,
        };
        bars.push({
          key: 'extended_cases',
          passed: !failed.length,
          detail: failed.length
            ? `${extended.passed} of ${extended.total} extended cases passed; failed: ${failed.join(', ')}.`
            : `All ${extended.total} extended cases passed.`,
        });
      }
      if (info.scale === 'larger')
        bars.push(
          structureBar(
            files.map((f) => ({
              path: f.path,
              content: f.content.toString('utf8'),
            })),
          ),
        );
    }
    const ok = barsPassed(bars);
    return {
      state: ok ? 'passed' : 'failed',
      reason: ok
        ? 'Every pass bar met.'
        : `Missed: ${bars
            .filter((b) => !b.passed)
            .map((b) => b.detail)
            .join(' ')}`,
      repairs: outcome.repairs,
      result: result({
        manifest_sha256: packaged.manifest_sha256,
        archive_sha256: m.package.sha256,
        extended,
      }),
    };
  }
}
