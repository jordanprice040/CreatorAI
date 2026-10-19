import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BenchmarkManifestSchema,
  CreatePromotionRequestSchema,
  EscalateRouteRequestSchema,
  ModelRegistryBodySchema,
  PricingSnapshotBodySchema,
  PromotionTransitionRequestSchema,
  RecordRouteOutcomeRequestSchema,
  RegisterRegistryRequestSchema,
  RouteRequestSchema,
  SetRoutePolicyRequestSchema,
  parse,
  type BenchmarkManifest,
  type BenchmarkResult,
  type CostSummary,
  type ModelRef,
  type ModelRegistry,
  type PricingSnapshotBody,
  type Promotion,
  type PromotionEvaluation,
  type RouteBenchmark,
  type RouteDecision,
  type RouteOutcome,
  type RoutePolicy,
  type RouteRequest,
} from '@creator/contracts';
import {
  benchmarkOperationId,
  canonicalHash,
  checkOutput,
  chooseRoute,
  derivedId,
  evaluateBenchmark,
  evaluateStage,
  modelKey,
  sameModel,
  sumCosts,
} from '@creator/domain';
import { ArtifactStore } from './artifact-store.js';
import {
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

const toRegistry = (r: Row): ModelRegistry => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  fixture: Boolean(r.fixture),
  registry_hash: String(r.registry_hash),
  body: r.body as ModelRegistry['body'],
  pricing_snapshot_ids: r.pricing_snapshot_ids as Record<string, string>,
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
});
const toPolicy = (r: Row): RoutePolicy => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  scope: r.scope as RoutePolicy['scope'],
  version: Number(r.version),
  policy_hash: String(r.policy_hash),
  body: r.body as RoutePolicy['body'],
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
});
const toBenchmark = (r: Row): RouteBenchmark => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  fixture: Boolean(r.fixture),
  manifest_hash: String(r.manifest_hash),
  manifest: r.manifest as BenchmarkManifest,
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
});
const toPromotion = (r: Row): Promotion => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  fixture: Boolean(r.fixture),
  version: Number(r.version),
  registry_id: String(r.registry_id),
  task_class: r.task_class as Promotion['task_class'],
  candidate: r.candidate as ModelRef,
  baseline: r.baseline as ModelRef,
  benchmark_id: String(r.benchmark_id),
  manifest_hash: String(r.manifest_hash),
  criteria: r.criteria as Promotion['criteria'],
  criteria_hash: String(r.criteria_hash),
  state: r.state as Promotion['state'],
  canary_decisions: Number(r.canary_decisions),
  evaluations: r.evaluations as PromotionEvaluation[],
  reason: String(r.reason),
  rationale: String(r.rationale),
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});
const nullable = (v: unknown) => (v === null || v === undefined ? null : v);
const toDecision = (r: Row): RouteDecision => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  fixture: Boolean(r.fixture),
  status: r.status as RouteDecision['status'],
  reason_code: String(r.reason_code),
  explanation: String(r.explanation),
  request: r.request as RouteRequest,
  policy_id: nullable(r.policy_id) as string | null,
  policy_version: r.policy_version === null ? null : Number(r.policy_version),
  policy_hash: nullable(r.policy_hash) as string | null,
  registry_id: String(r.registry_id),
  registry_version: String(r.registry_version),
  registry_hash: String(r.registry_hash),
  model:
    r.model_id === null
      ? null
      : {
          provider: r.provider as ModelRef['provider'],
          model_id: String(r.model_id),
        },
  pricing_snapshot_id: nullable(r.pricing_snapshot_id) as string | null,
  pricing_hash: nullable(r.pricing_hash) as string | null,
  role: nullable(r.role) as RouteDecision['role'],
  promotion_id: nullable(r.promotion_id) as string | null,
  criteria_hash: nullable(r.criteria_hash) as string | null,
  shadow: nullable(r.shadow) as RouteDecision['shadow'],
  escalated_from: nullable(r.escalated_from) as string | null,
  candidates: r.candidates as RouteDecision['candidates'],
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
});
const toOutcome = (r: Row): RouteOutcome => ({
  id: String(r.id),
  decision_id: String(r.decision_id),
  variant: r.variant as RouteOutcome['variant'],
  provider: r.provider as ModelRef['provider'],
  model_id: String(r.model_id),
  promotion_id: nullable(r.promotion_id) as string | null,
  signal: r.signal as RouteOutcome['signal'],
  accepted: Boolean(r.accepted),
  related_operation_ids: r.related_operation_ids as string[],
  cost: r.cost as CostSummary,
  note: nullable(r.note) as string | null,
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
});
const scopeKey = (s: RoutePolicy['scope']) =>
  s.kind === 'workspace'
    ? 'workspace'
    : `project:${s.project_id.toLowerCase()}`;
const ACTIVE = ['shadow', 'canary', 'promoted'];

/**
 * X01 model registry and qualified routing. Owners register registries, policies,
 * benchmarks and promotions; members ask for decisions and record objective outcomes. Every
 * decision row names the policy, registry and pricing versions it used, and is immutable.
 */
export class RoutingStore extends ArtifactStore {
  private async fixtureOf(c: PoolClient, ws: string) {
    const { rows } = await c.query<{ fixture: boolean }>(
      'select fixture from workspaces where id = $1',
      [ws],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Workspace not found.');
    return rows[0].fixture;
  }
  /** Settled cost and held (unknown or in-flight) exposure of these operations. */
  private async operationCost(
    c: PoolClient,
    ws: string,
    ops: string[],
    runId: string | null = null,
  ): Promise<CostSummary> {
    const { rows } = await c.query(
      `select logical_operation_id::text as op,
         coalesce(sum(incurred_nano) filter (where status = 'settled'), 0)::text as incurred,
         coalesce(sum(reserved_nano) filter (where status in ('unknown','in_flight')), 0)::text as unknown,
         bool_and($3::uuid is null or run_id = $3) as same_run
       from budget_reservations where workspace_id = $1 and logical_operation_id = any($2::uuid[])
       group by logical_operation_id`,
      [ws, ops, runId],
    );
    if (rows.some((r) => !r.same_run))
      throw fail(
        'SCOPE_EXCEEDED',
        'Related operations must belong to the same run.',
      );
    return sumCosts(
      rows.map((r) => ({
        incurred_nano: String(r.incurred),
        unknown_nano: String(r.unknown),
        operations: 1,
      })),
    );
  }
  private async latestRegistry(c: PoolClient, ws: string) {
    const { rows } = await c.query(
      'select * from route_registries where workspace_id = $1 order by created_at desc, id limit 1',
      [ws],
    );
    if (!rows[0])
      throw fail(
        'NOT_FOUND',
        'No model registry is registered in this workspace.',
      );
    return toRegistry(rows[0] as Row);
  }
  private async registryPricing(c: PoolClient, reg: ModelRegistry) {
    const ids = Object.values(reg.pricing_snapshot_ids);
    const { rows } = await c.query(
      'select id::text, body, snapshot_hash from pricing_snapshots where id = any($1::uuid[])',
      [ids],
    );
    const byId = new Map(rows.map((r) => [String(r.id), r as Row]));
    const pricing = new Map<string, PricingSnapshotBody>();
    const hashes = new Map<string, string>();
    for (const [key, id] of Object.entries(reg.pricing_snapshot_ids)) {
      const r = byId.get(id);
      if (!r) continue;
      pricing.set(key, r.body as PricingSnapshotBody);
      hashes.set(key, String(r.snapshot_hash));
    }
    return { pricing, hashes };
  }
  private async lockPromotion(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      'select * from route_promotions where workspace_id = $1 and id = $2 for update',
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Promotion not found.');
    return toPromotion(rows[0] as Row);
  }
  private async writePromotion(
    c: PoolClient,
    ctx: CommandContext,
    p: Promotion,
    next: {
      state?: Promotion['state'];
      evaluation?: PromotionEvaluation;
      reason?: string;
      canary?: boolean;
    },
  ): Promise<Promotion> {
    const { rows } = await c.query(
      `update route_promotions set version = version + $7, state = $3,
         evaluations = evaluations || $4::jsonb, reason = $5,
         canary_decisions = canary_decisions + $6, updated_at = clock_timestamp()
       where workspace_id = $1 and id = $2 returning *`,
      [
        p.workspace_id,
        p.id,
        next.state ?? p.state,
        JSON.stringify(next.evaluation ? [next.evaluation] : []),
        next.reason ?? p.reason,
        next.canary ? 1 : 0,
        // The canary counter is bookkeeping; only state and evaluations change the version.
        next.state || next.evaluation ? 1 : 0,
      ],
    );
    const updated = toPromotion(rows[0] as Row);
    if (next.state && next.state !== p.state)
      await this.append(c, ctx, {
        workspaceId: p.workspace_id,
        action: `route.promotion_${next.state}`,
        subjectKind: 'route_promotion',
        subjectId: p.id,
        subjectVersion: updated.version,
        contentHash: p.criteria_hash,
        payload: {
          from: p.state,
          to: next.state,
          candidate: modelKey(p.candidate),
          task_class: p.task_class,
          reasons: next.evaluation?.reasons ?? [],
        },
      });
    return updated;
  }

  async registerModelRegistry(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ModelRegistry> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RegisterRegistryRequestSchema, raw);
    const body = parse(ModelRegistryBodySchema, req.registry);
    const pricing = req.pricing.map((p) => parse(PricingSnapshotBodySchema, p));
    const registryHash = canonicalHash(body);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const fixture = await this.fixtureOf(c, ws);
      if (fixture !== body.fixture)
        throw fail(
          'SCOPE_EXCEEDED',
          fixture
            ? 'A fixture workspace can only hold a fixture registry.'
            : 'A real workspace cannot hold fixture models.',
        );
      const prior = await c.query(
        'select * from route_registries where workspace_id = $1 and registry_version = $2',
        [ws, body.registry_version],
      );
      if (prior.rows[0]) {
        const existing = toRegistry(prior.rows[0] as Row);
        if (existing.registry_hash !== registryHash)
          throw fail(
            'DUPLICATE',
            'That registry version is already registered with different content; publish a new version.',
          );
        return existing;
      }
      const ids: Record<string, string> = {};
      for (const m of body.models) {
        const p = pricing.find((x) => canonicalHash(x) === m.pricing_hash);
        if (!p || p.provider !== m.provider || p.model_id !== m.model_id)
          throw fail(
            'PRICING_MISSING',
            `No supplied pricing for ${m.model_id} matches its pricing_hash.`,
          );
        const found = await c.query(
          'select id::text from pricing_snapshots where workspace_id = $1 and snapshot_hash = $2 order by created_at limit 1',
          [ws, m.pricing_hash],
        );
        let id = found.rows[0]?.id as string | undefined;
        if (!id) {
          id = randomUUID();
          await c.query(
            `insert into pricing_snapshots (id, workspace_id, fixture, provider, model_id, basis,
               body, snapshot_hash, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              id,
              ws,
              fixture,
              p.provider,
              p.model_id,
              p.basis,
              p,
              m.pricing_hash,
              ctx.actorId,
            ],
          );
          await this.append(c, ctx, {
            workspaceId: ws,
            action: 'pricing.recorded',
            subjectKind: 'pricing',
            subjectId: id,
            subjectVersion: null,
            contentHash: m.pricing_hash,
            payload: {
              provider: p.provider,
              model_id: p.model_id,
              basis: p.basis,
            },
          });
        }
        ids[modelKey(m)] = id;
      }
      const id = randomUUID();
      const { rows } = await c.query(
        `insert into route_registries (id, workspace_id, fixture, registry_version, registry_hash,
           body, pricing_snapshot_ids, created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          id,
          ws,
          fixture,
          body.registry_version,
          registryHash,
          body,
          ids,
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'route.registry_registered',
        subjectKind: 'route_registry',
        subjectId: id,
        subjectVersion: null,
        contentHash: registryHash,
        payload: {
          registry_version: body.registry_version,
          reference_model: modelKey(body.reference_model),
          models: body.models.map(modelKey),
        },
      });
      return toRegistry(rows[0] as Row);
    });
  }
  async listModelRegistries(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from route_registries where workspace_id = $1 order by created_at desc',
        [ws],
      );
      return rows.map((r: Row) => toRegistry(r));
    });
  }

  async setRoutePolicy(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<RoutePolicy> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SetRoutePolicyRequestSchema, raw);
    const key = scopeKey(req.scope);
    return this.idempotent(ws, ctx, { op: 'route.policy', req }, async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      await c.query('select pg_advisory_xact_lock(hashtext($1))', [
        `${ws}:${key}`,
      ]);
      const { rows: v } = await c.query(
        'select coalesce(max(version), 0) as v from route_policies where workspace_id = $1 and scope_key = $2',
        [ws, key],
      );
      const version = Number(v[0]?.v ?? 0) + 1;
      const id = randomUUID();
      const hash = canonicalHash({ scope: req.scope, body: req.body });
      const { rows } = await c.query(
        `insert into route_policies (id, workspace_id, scope_key, scope, version, policy_hash, body,
           created_by) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [id, ws, key, req.scope, version, hash, req.body, ctx.actorId],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'route.policy_set',
        subjectKind: 'route_policy',
        subjectId: id,
        subjectVersion: version,
        contentHash: hash,
        payload: { scope: key, mode: req.body.mode },
      });
      return toPolicy(rows[0] as Row);
    });
  }
  async listRoutePolicies(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from route_policies where workspace_id = $1 order by scope_key, version desc',
        [ws],
      );
      return rows.map((r: Row) => toPolicy(r));
    });
  }

  async registerBenchmark(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<RouteBenchmark> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const manifest = parse(BenchmarkManifestSchema, raw);
    const hash = canonicalHash(manifest);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const fixture = await this.fixtureOf(c, ws);
      if (fixture !== manifest.fixture)
        throw fail(
          'SCOPE_EXCEEDED',
          'Fixture benchmarks belong to fixture workspaces, and real ones to real workspaces.',
        );
      const prior = await c.query(
        'select * from route_benchmarks where workspace_id = $1 and manifest_hash = $2',
        [ws, hash],
      );
      if (prior.rows[0]) return toBenchmark(prior.rows[0] as Row);
      const id = randomUUID();
      const { rows } = await c.query(
        `insert into route_benchmarks (id, workspace_id, fixture, manifest_hash, manifest, created_by)
         values ($1,$2,$3,$4,$5,$6) returning *`,
        [id, ws, fixture, hash, manifest, ctx.actorId],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'route.benchmark_registered',
        subjectKind: 'route_benchmark',
        subjectId: id,
        subjectVersion: null,
        contentHash: hash,
        payload: {
          task_class: manifest.task_class,
          held_out: manifest.cases.filter((x) => x.split === 'held_out').length,
          development: manifest.cases.filter((x) => x.split === 'development')
            .length,
        },
      });
      return toBenchmark(rows[0] as Row);
    });
  }

  async createPromotion(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<Promotion> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreatePromotionRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const fixture = await this.fixtureOf(c, ws);
      const reg = await c.query(
        'select * from route_registries where workspace_id = $1 and id = $2',
        [ws, uuid(req.registry_id)],
      );
      if (!reg.rows[0]) throw fail('NOT_FOUND', 'Registry not found.');
      const registry = toRegistry(reg.rows[0] as Row);
      const bench = await c.query(
        'select * from route_benchmarks where workspace_id = $1 and id = $2',
        [ws, uuid(req.benchmark_id)],
      );
      if (!bench.rows[0]) throw fail('NOT_FOUND', 'Benchmark not found.');
      const benchmark = toBenchmark(bench.rows[0] as Row);
      const baseline = registry.body.reference_model;
      const entry = registry.body.models.find((m) =>
        sameModel(m, req.candidate),
      );
      if (!entry) throw fail('NOT_FOUND', 'Candidate is not in that registry.');
      if (sameModel(req.candidate, baseline))
        throw fail(
          'INVALID_TRANSITION',
          'The reference baseline is the yardstick; it is not promoted.',
        );
      if (benchmark.manifest.task_class !== req.task_class)
        throw fail(
          'INVALID_CONTRACT',
          'The benchmark measures a different task class.',
        );
      if (!entry.task_classes.includes(req.task_class))
        throw fail(
          'INVALID_CONTRACT',
          'The candidate does not declare this task class.',
        );
      const heldOut = benchmark.manifest.cases.filter(
        (x) => x.split === 'held_out',
      ).length;
      if (heldOut < req.criteria.min_held_out_cases)
        throw fail(
          'INVALID_CONTRACT',
          'The benchmark has fewer held-out cases than the criteria require.',
        );
      const id = randomUUID();
      const criteriaHash = canonicalHash(req.criteria);
      try {
        const { rows } = await c.query(
          `insert into route_promotions (id, workspace_id, fixture, registry_id, task_class, candidate,
             candidate_key, baseline, benchmark_id, manifest_hash, criteria, criteria_hash, state,
             rationale, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'candidate',$13,$14) returning *`,
          [
            id,
            ws,
            fixture,
            registry.id,
            req.task_class,
            req.candidate,
            modelKey(req.candidate),
            baseline,
            benchmark.id,
            benchmark.manifest_hash,
            req.criteria,
            criteriaHash,
            req.rationale,
            ctx.actorId,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'route.promotion_candidate',
          subjectKind: 'route_promotion',
          subjectId: id,
          subjectVersion: 1,
          contentHash: criteriaHash,
          payload: {
            candidate: modelKey(req.candidate),
            baseline: modelKey(baseline),
            task_class: req.task_class,
            manifest_hash: benchmark.manifest_hash,
          },
        });
        return toPromotion(rows[0] as Row);
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw fail(
            'DUPLICATE',
            'This candidate already has an active promotion for that task class.',
          );
        throw e;
      }
    });
  }
  async listPromotions(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from route_promotions where workspace_id = $1 order by created_at desc',
        [ws],
      );
      return rows.map((r: Row) => toPromotion(r));
    });
  }
  async getPromotion(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from route_promotions where workspace_id = $1 and id = $2',
        [ws, uuid(id)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Promotion not found.');
      return toPromotion(rows[0] as Row);
    });
  }

  /** What a benchmark run needs: the frozen cases and both arms' pricing. */
  async benchmarkPlan(ctx: CommandContext, ws: string, promotionId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const p = await this.lockPromotion(c, ws, promotionId);
      if (p.state !== 'candidate')
        throw fail(
          'INVALID_TRANSITION',
          'Only a candidate promotion runs its held-out benchmark, once.',
        );
      const bench = await c.query(
        'select * from route_benchmarks where id = $1',
        [p.benchmark_id],
      );
      const reg = await c.query(
        'select * from route_registries where id = $1',
        [p.registry_id],
      );
      const registry = toRegistry(reg.rows[0] as Row);
      return {
        promotion: p,
        manifest: toBenchmark(bench.rows[0] as Row).manifest,
        arms: [p.candidate, p.baseline].map((m) => ({
          model: m,
          pricing_snapshot_id: registry.pricing_snapshot_ids[modelKey(m)]!,
        })),
      };
    });
  }
  /**
   * Records the benchmark from the broker's own reservations (outputs and costs are read
   * here, not supplied by the caller), scores each case objectively and applies the held-out
   * gate: pass moves the candidate to shadow, failure rejects it. Results are final.
   */
  async recordBenchmark(
    ctx: CommandContext,
    ws: string,
    promotionId: string,
  ): Promise<Promotion> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const p = await this.lockPromotion(c, ws, promotionId);
      if (p.state !== 'candidate')
        throw fail(
          'INVALID_TRANSITION',
          'The benchmark for this promotion is already recorded.',
        );
      const bench = toBenchmark(
        (
          await c.query('select * from route_benchmarks where id = $1', [
            p.benchmark_id,
          ])
        ).rows[0] as Row,
      );
      if (bench.manifest_hash !== p.manifest_hash)
        throw fail('EVIDENCE_MISMATCH', 'Benchmark manifest changed.');
      const rows: Record<'candidate' | 'baseline', BenchmarkResult[]> = {
        candidate: [],
        baseline: [],
      };
      for (const [arm, model] of [
        ['candidate', p.candidate],
        ['baseline', p.baseline],
      ] as const)
        for (const k of bench.manifest.cases) {
          const op = benchmarkOperationId(p.id, model, k.case_id);
          const { rows: res } = await c.query(
            `select status, model_id, provider, result from budget_reservations
             where workspace_id = $1 and logical_operation_id = $2 order by created_at desc, attempt desc limit 1`,
            [ws, op],
          );
          const last = res[0] as Row | undefined;
          if (!last)
            throw fail(
              'MISSING_EVIDENCE',
              `No broker call recorded for ${modelKey(model)} on case ${k.case_id}.`,
            );
          if (last.status === 'denied' || last.status === 'in_flight')
            throw fail(
              'MISSING_EVIDENCE',
              `Case ${k.case_id} for ${modelKey(model)} was ${String(last.status)}; finish the run before recording.`,
            );
          if (
            last.model_id !== model.model_id ||
            last.provider !== model.provider
          )
            throw fail(
              'EVIDENCE_MISMATCH',
              `Case ${k.case_id} was answered by another model.`,
            );
          const result = (last.result ?? {}) as {
            status?: string;
            reason_code?: string;
            output?: { text: string; json: unknown } | null;
          };
          const signal = checkOutput(k.check, result.output ?? null, {
            succeeded: result.status === 'succeeded',
            reason_code: result.reason_code ?? String(last.status),
          });
          const cost = await this.operationCost(c, ws, [op]);
          const row: BenchmarkResult = {
            promotion_id: p.id,
            benchmark_id: bench.id,
            manifest_hash: bench.manifest_hash,
            provider: model.provider,
            model_id: model.model_id,
            case_id: k.case_id,
            split: k.split,
            signal,
            passed: signal === 'accepted',
            logical_operation_id: op,
            cost,
            created_at: new Date().toISOString(),
          };
          await c.query(
            `insert into route_benchmark_results (id, workspace_id, promotion_id, benchmark_id,
               manifest_hash, provider, model_id, case_id, split, signal, passed,
               logical_operation_id, cost) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
            [
              randomUUID(),
              ws,
              p.id,
              bench.id,
              bench.manifest_hash,
              model.provider,
              model.model_id,
              k.case_id,
              k.split,
              signal,
              row.passed,
              op,
              cost,
            ],
          );
          rows[arm].push(row);
        }
      const toRow = (r: BenchmarkResult) => ({
        accepted: r.passed,
        cost: r.cost,
        split: r.split,
      });
      const evaluation = evaluateBenchmark(
        p.criteria,
        p.candidate,
        p.baseline,
        rows.candidate.map(toRow),
        rows.baseline.map(toRow),
        p.fixture,
      );
      return this.writePromotion(c, ctx, p, {
        state: evaluation.passed ? 'shadow' : 'rejected',
        evaluation,
        reason: evaluation.passed
          ? 'Held-out gate passed; shadow evaluation next.'
          : `Held-out gate failed: ${evaluation.reasons.join(', ')}.`,
      });
    });
  }
  async benchmarkResults(ctx: CommandContext, ws: string, promotionId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from route_benchmark_results where workspace_id = $1 and promotion_id = $2 order by model_id, case_id',
        [ws, uuid(promotionId)],
      );
      return rows.map((r: Row) => ({
        promotion_id: String(r.promotion_id),
        benchmark_id: String(r.benchmark_id),
        manifest_hash: String(r.manifest_hash),
        provider: r.provider as ModelRef['provider'],
        model_id: String(r.model_id),
        case_id: String(r.case_id),
        split: r.split as BenchmarkResult['split'],
        signal: r.signal as BenchmarkResult['signal'],
        passed: Boolean(r.passed),
        logical_operation_id: String(r.logical_operation_id),
        cost: r.cost as CostSummary,
        created_at: iso(r.created_at),
      }));
    });
  }

  /**
   * Owner step for shadow → canary and canary → promoted. The gate for the current stage is
   * re-evaluated from recorded outcomes; the owner can stop a promotion but never override a
   * failing gate.
   */
  async advancePromotion(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ): Promise<Promotion> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(PromotionTransitionRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const p = await this.lockPromotion(c, ws, id);
      if (p.version !== req.expected_version)
        throw fail('VERSION_CONFLICT', 'The promotion changed; reload it.');
      if (p.state !== 'shadow' && p.state !== 'canary')
        throw fail(
          'INVALID_TRANSITION',
          p.state === 'candidate'
            ? 'Run and record the held-out benchmark first.'
            : `A ${p.state} promotion cannot advance.`,
        );
      const stage = p.state;
      const outcomes = await this.promotionOutcomes(c, p.id, stage);
      const evaluation = evaluateStage(
        stage,
        p.criteria,
        p.candidate,
        outcomes,
        p.fixture,
      );
      if (!evaluation.passed)
        throw fail(
          'INVALID_TRANSITION',
          `The ${stage} gate is not met: ${evaluation.reasons.join(', ')}.`,
        );
      return this.writePromotion(c, ctx, p, {
        state: stage === 'shadow' ? 'canary' : 'promoted',
        evaluation,
        reason: req.reason,
      });
    });
  }
  /** Stops a shadow, canary or promoted route; later decisions use the baseline again. */
  async rollbackPromotion(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ): Promise<Promotion> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(PromotionTransitionRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const p = await this.lockPromotion(c, ws, id);
      if (p.version !== req.expected_version)
        throw fail('VERSION_CONFLICT', 'The promotion changed; reload it.');
      if (!ACTIVE.includes(p.state))
        throw fail(
          'INVALID_TRANSITION',
          `A ${p.state} promotion cannot be rolled back.`,
        );
      return this.writePromotion(c, ctx, p, {
        state: 'rolled_back',
        reason: req.reason,
      });
    });
  }
  private async promotionOutcomes(
    c: PoolClient,
    promotionId: string,
    stage: 'shadow' | 'canary' | 'post_promotion',
  ) {
    const { rows } = await c.query(
      `select o.accepted, o.cost from route_outcomes o join route_decisions d on d.id = o.decision_id
       where o.promotion_id = $1 and (
         ($2 = 'shadow' and o.variant = 'shadow') or
         ($2 = 'canary' and o.variant = 'primary' and d.role = 'canary') or
         ($2 = 'post_promotion' and o.variant = 'primary' and d.role in ('auto','economy','fixed')))
       order by o.created_at, o.id`,
      [promotionId, stage],
    );
    return rows.map((r) => ({
      accepted: Boolean(r.accepted),
      cost: r.cost as CostSummary,
    }));
  }

  async decideRoute(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
    escalation: { from: RouteDecision } | null = null,
  ): Promise<RouteDecision> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const request = parse(RouteRequestSchema, raw);
    const norm: RouteRequest = {
      ...request,
      run_id: request.run_id.toLowerCase(),
      task_id: request.task_id?.toLowerCase() ?? null,
      project_id: request.project_id?.toLowerCase() ?? null,
      logical_operation_id: request.logical_operation_id.toLowerCase(),
    };
    const requestHash = canonicalHash({
      request: norm,
      escalated_from: escalation?.from.id ?? null,
    });
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const fixture = await this.fixtureOf(c, ws);
      const prior = await c.query(
        'select * from route_decisions where workspace_id = $1 and logical_operation_id = $2',
        [ws, norm.logical_operation_id],
      );
      if (prior.rows[0]) {
        if (prior.rows[0].request_hash !== requestHash)
          throw fail(
            'IDEMPOTENCY_CONFLICT',
            'This operation was already routed for a different request.',
          );
        return toDecision(prior.rows[0] as Row);
      }
      const run = await c.query(
        'select 1 from run_controls where workspace_id = $1 and run_id = $2',
        [ws, norm.run_id],
      );
      if (!run.rowCount)
        throw fail('NOT_FOUND', 'Run is not registered for oversight.');
      const registry = await this.latestRegistry(c, ws);
      const scopes = norm.project_id
        ? [`project:${norm.project_id}`, 'workspace']
        : ['workspace'];
      const pol = await c.query(
        `select * from route_policies where workspace_id = $1 and scope_key = any($2)
         order by (scope_key = 'workspace'), version desc limit 1`,
        [ws, scopes],
      );
      if (!pol.rows[0])
        throw fail('NOT_FOUND', 'No route policy covers this request.');
      const policy = toPolicy(pol.rows[0] as Row);
      const { pricing, hashes } = await this.registryPricing(c, registry);
      const promos = await c.query(
        `select * from route_promotions where workspace_id = $1 and registry_id = $2
           and task_class = $3 and state = any($4) order by created_at for update`,
        [ws, registry.id, norm.task_class, ACTIVE],
      );
      const promotions = promos.rows.map((r: Row) => toPromotion(r));
      const choice = chooseRoute(
        {
          fixture,
          registry: registry.body,
          pricing,
          policy: policy.body,
          request: norm,
          promotions,
        },
        (p) => p.canary_decisions < p.criteria.canary_max_decisions,
        escalation
          ? { failed: escalation.from.model ?? registry.body.reference_model }
          : null,
      );
      const id = randomUUID();
      const routed = choice.status === 'routed' ? choice : null;
      const key = routed ? modelKey(routed.model) : null;
      const shadow =
        routed?.shadow &&
        registry.pricing_snapshot_ids[modelKey(routed.shadow.candidate)]
          ? {
              model: routed.shadow.candidate,
              promotion_id: routed.shadow.id,
              pricing_snapshot_id:
                registry.pricing_snapshot_ids[
                  modelKey(routed.shadow.candidate)
                ]!,
              logical_operation_id: derivedId('route-shadow', id),
            }
          : null;
      if (routed?.role === 'canary' && routed.promotion)
        await this.writePromotion(c, ctx, routed.promotion, { canary: true });
      const insert = c.query(
        `insert into route_decisions (id, workspace_id, fixture, run_id, logical_operation_id,
           request_hash, status, reason_code, explanation, request, policy_id, policy_version,
           policy_hash, registry_id, registry_version, registry_hash, provider, model_id,
           pricing_snapshot_id, pricing_hash, role, promotion_id, criteria_hash, shadow,
           escalated_from, candidates, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,
           $23,$24,$25,$26,$27) returning *`,
        [
          id,
          ws,
          fixture,
          norm.run_id,
          norm.logical_operation_id,
          requestHash,
          choice.status,
          routed
            ? 'routed'
            : choice.status === 'refused'
              ? choice.reason_code
              : '',
          choice.explanation,
          norm,
          policy.id,
          policy.version,
          policy.policy_hash,
          registry.id,
          registry.body.registry_version,
          registry.registry_hash,
          routed?.model.provider ?? null,
          routed?.model.model_id ?? null,
          key ? registry.pricing_snapshot_ids[key] : null,
          key ? (hashes.get(key) ?? null) : null,
          routed?.role ?? null,
          routed?.promotion?.id ?? null,
          routed?.promotion?.criteria_hash ?? null,
          shadow ? JSON.stringify(shadow) : null,
          escalation?.from.id ?? null,
          JSON.stringify(choice.candidates),
          ctx.actorId,
        ],
      );
      const { rows } = await insert.catch((e: unknown) => {
        if ((e as { code?: string }).code === '23505')
          throw fail(
            'DUPLICATE',
            escalation
              ? 'This decision was already escalated once.'
              : 'This operation was routed concurrently; retry to read it.',
          );
        throw e;
      });
      await this.append(c, ctx, {
        workspaceId: ws,
        action: routed ? 'route.decided' : 'route.refused',
        subjectKind: 'route_decision',
        subjectId: id,
        subjectVersion: null,
        contentHash: requestHash,
        relatedIds: [norm.run_id],
        payload: {
          status: choice.status,
          model: key,
          role: routed?.role ?? null,
          policy_version: policy.version,
          registry_version: registry.body.registry_version,
          reason_code: routed
            ? 'routed'
            : (choice as { reason_code: string }).reason_code,
        },
      });
      return toDecision(rows[0] as Row);
    });
  }
  async getRouteDecision(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from route_decisions where workspace_id = $1 and id = $2',
        [ws, uuid(id)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Route decision not found.');
      return toDecision(rows[0] as Row);
    });
  }
  async listRouteDecisions(
    ctx: CommandContext,
    ws: string,
    filter: { runId?: string } = {},
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from route_decisions where workspace_id = $1 and ($2::uuid is null or run_id = $2)
         order by created_at desc limit 200`,
        [ws, filter.runId ? uuid(filter.runId) : null],
      );
      return rows.map((r: Row) => toDecision(r));
    });
  }

  /**
   * Records an objective outcome. Cost is read from the broker's reservations for the
   * decision's operation plus named review/repair/tool operations of the same run. Canary and
   * post-promotion outcomes that fall below the floor roll the promotion back at once.
   */
  async recordRouteOutcome(
    ctx: CommandContext,
    ws: string,
    decisionId: string,
    raw: unknown,
  ): Promise<{ outcome: RouteOutcome; promotion: Promotion | null }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RecordRouteOutcomeRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const { rows: dr } = await c.query(
        'select * from route_decisions where workspace_id = $1 and id = $2',
        [ws, uuid(decisionId)],
      );
      if (!dr[0]) throw fail('NOT_FOUND', 'Route decision not found.');
      const d = toDecision(dr[0] as Row);
      const target =
        req.variant === 'primary'
          ? d.model && {
              model: d.model,
              op: d.request.logical_operation_id,
              promotion: d.promotion_id,
            }
          : d.shadow && {
              model: d.shadow.model,
              op: d.shadow.logical_operation_id,
              promotion: d.shadow.promotion_id,
            };
      if (!target)
        throw fail(
          'INVALID_TRANSITION',
          req.variant === 'primary'
            ? 'A refused decision has no outcome.'
            : 'This decision has no shadow candidate.',
        );
      const related = [
        ...new Set(req.related_operation_ids.map((o) => o.toLowerCase())),
      ];
      if (related.includes(target.op))
        throw fail(
          'INVALID_CONTRACT',
          'Related operations exclude the routed call itself.',
        );
      const own = await this.operationCost(
        c,
        ws,
        [target.op],
        d.request.run_id,
      );
      if (own.operations === 0)
        throw fail(
          'MISSING_EVIDENCE',
          'No broker call was made under this decision; nothing to judge.',
        );
      const extra = await this.operationCost(c, ws, related, d.request.run_id);
      if (extra.operations !== related.length)
        throw fail(
          'MISSING_EVIDENCE',
          'A related operation has no broker record.',
        );
      const cost = sumCosts([own, extra]);
      const id = randomUUID();
      let inserted;
      try {
        inserted = await c.query(
          `insert into route_outcomes (id, workspace_id, decision_id, variant, provider, model_id,
             promotion_id, signal, accepted, related_operation_ids, cost, note, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) returning *`,
          [
            id,
            ws,
            d.id,
            req.variant,
            target.model.provider,
            target.model.model_id,
            target.promotion,
            req.signal,
            req.signal === 'accepted',
            JSON.stringify(related),
            cost,
            req.note,
            ctx.actorId,
          ],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw fail('DUPLICATE', 'This outcome is already recorded.');
        throw e;
      }
      const outcome = toOutcome(inserted.rows[0] as Row);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'route.outcome_recorded',
        subjectKind: 'route_decision',
        subjectId: d.id,
        subjectVersion: null,
        contentHash: null,
        payload: {
          variant: req.variant,
          signal: req.signal,
          model: modelKey(target.model),
        },
      });
      let promotion: Promotion | null = null;
      if (target.promotion) {
        const p = await this.lockPromotion(c, ws, target.promotion);
        const stage =
          req.variant === 'shadow'
            ? p.state === 'shadow'
              ? 'shadow'
              : null
            : d.role === 'canary'
              ? p.state === 'canary'
                ? 'canary'
                : null
              : p.state === 'promoted'
                ? 'post_promotion'
                : null;
        promotion = p;
        if (stage) {
          const rows = await this.promotionOutcomes(c, p.id, stage);
          const ev = evaluateStage(
            stage,
            p.criteria,
            p.candidate,
            rows,
            p.fixture,
          );
          if (ev.reasons.includes('below_quality_floor'))
            promotion = await this.writePromotion(c, ctx, p, {
              state: stage === 'shadow' ? 'rejected' : 'rolled_back',
              evaluation: ev,
              reason: `Objective ${stage} outcomes fell below the quality floor; ${
                stage === 'shadow' ? 'rejected' : 'rolled back automatically'
              }.`,
            });
        }
      }
      return { outcome, promotion };
    });
  }
  async listRouteOutcomes(ctx: CommandContext, ws: string, decisionId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from route_outcomes where workspace_id = $1 and decision_id = $2 order by created_at',
        [ws, uuid(decisionId)],
      );
      return rows.map((r: Row) => toOutcome(r));
    });
  }

  /**
   * Objective escalation: only after a recorded primary outcome that failed an objective
   * check, and only once per decision. The retry goes to the reference baseline.
   */
  async escalateRoute(
    ctx: CommandContext,
    ws: string,
    decisionId: string,
    raw: unknown,
  ): Promise<RouteDecision> {
    const req = parse(EscalateRouteRequestSchema, raw);
    const from = await this.getRouteDecision(ctx, ws, decisionId);
    const outcomes = await this.listRouteOutcomes(ctx, ws, decisionId);
    const primary = outcomes.find((o) => o.variant === 'primary');
    if (!primary || primary.accepted)
      throw fail(
        'INVALID_TRANSITION',
        'Escalation needs a recorded objective failure of the routed result.',
      );
    if (
      req.logical_operation_id.toLowerCase() ===
      from.request.logical_operation_id
    )
      throw fail('INVALID_CONTRACT', 'An escalation is a new operation.');
    return this.decideRoute(
      ctx,
      ws,
      { ...from.request, logical_operation_id: req.logical_operation_id },
      { from },
    );
  }
}
