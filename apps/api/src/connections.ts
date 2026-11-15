import type { PlanConnectionService } from '@creator/broker';
import { ContractError, parse, z } from '@creator/contracts';
import type { CommandContext, ConnectionStore } from '@creator/db';
import {
  recipeBenchmarkOffers,
  startRecipeQualification,
} from './recipe-qualification.js';
import {
  PLAN_ROLE_CONTEXT_MAX,
  PlanRelay,
  codexBuilder,
  linuxCodexLauncher,
  wslCodexLauncher,
  type CodexLauncher,
} from '@creator/executor';

/**
 * The Codex jail launcher from configuration: WSL2 on Windows (CREATOR_CODEX_DIR is the WSL
 * path of the pinned binaries); on Linux only with the explicit development opt-in.
 */
export function codexLauncherFromEnv(
  env: Record<string, string | undefined>,
): CodexLauncher | null {
  const dir = env.CREATOR_CODEX_DIR;
  if (!dir) return null;
  if (process.platform === 'win32')
    return wslCodexLauncher({
      distro: env.CREATOR_WORKER_DISTRO ?? 'Ubuntu',
      codex_dir: dir,
    });
  if (env.CREATOR_CODEX_LINUX === 'dev' && env.CREATOR_CODEX_BWRAP)
    return linuxCodexLauncher({
      codex_dir: dir,
      bwrap: env.CREATOR_CODEX_BWRAP,
    });
  return null;
}
const CodexBuildBody = z.strictObject({
  build_id: z.uuid(),
  run_id: z.uuid(),
  model_id: z.string().min(1).max(120),
  data_class: z.enum(['synthetic', 'public', 'private_approved']),
  packet: z
    .object({
      candidate: z.string().regex(/^[0-9a-f]{40}$/),
      files: z
        .array(
          z.object({ path: z.string().min(1).max(300), content: z.string() }),
        )
        .max(200),
      task: z.object({
        file_scope: z.array(z.string().min(1).max(300)).min(1).max(20),
      }),
    })
    .passthrough()
    // Full audit L-11: the same runaway ceiling the executor and plan-role calls use; the 1 MiB
    // body allowance alone let a packet reach about five times that.
    .refine((p) => JSON.stringify(p).length <= PLAN_ROLE_CONTEXT_MAX, {
      message: `The builder packet exceeds ${PLAN_ROLE_CONTEXT_MAX} characters.`,
    }),
});
/**
 * Ingress allowance for a build-calls body. The input is a JSON packet sent as a JSON string, so
 * escaping can roughly double it, and UTF-8 adds up to 3 bytes a character; 1 MiB covers an
 * input at PLAN_ROLE_CONTEXT_MAX with room to spare. A codex-builds body carries the same
 * builder packet (as an object, not a string), so it gets the same allowance rather than the
 * ordinary 64 KiB (PR #89 re-review L-B).
 */
export const PLAN_BUILD_CALL_MAX_BODY = 1024 * 1024;
const BuildCallBody = z.strictObject({
  role: z.enum(['builder', 'reviewer']),
  run_id: z.uuid(),
  // ADR-0054: the build whose one approval covers this request.
  build_id: z.uuid(),
  model_id: z.string().min(1).max(120),
  data_class: z.enum(['synthetic', 'public', 'private_approved']),
  // ADR-0053: the executor's runaway ceiling. The binding bound is the connection's accepted
  // max_input_chars, which plan admission enforces on instructions plus input.
  input: z.string().min(1).max(PLAN_ROLE_CONTEXT_MAX),
  timeout_ms: z.number().int().min(100).max(120000),
  logical_operation_id: z.uuid(),
});
/**
 * One T12 build-role request on the plan's direct Responses path (ADR-0048), for the CLI's
 * route and for builds the studio service runs itself. The role prompt is fixed server-side.
 */
export async function runPlanBuildCall(
  service: PlanConnectionService | null,
  ctx: CommandContext,
  ws: string,
  connectionId: string,
  raw: unknown,
) {
  const b = parse(BuildCallBody, raw);
  if (!service)
    throw new ContractError(
      'INVALID_CONFIG',
      'The ChatGPT plan service is not configured.',
    );
  return service.buildRole(ctx, ws, connectionId, b);
}
const BuildRolesReadyBody = z.strictObject({
  model_id: z.string().min(1).max(120),
  run_id: z.uuid(),
  data_class: z.enum(['synthetic', 'public', 'private_approved']),
});
/** Why a build's plan roles would be refused now (ADR-0048); sends no model request. */
export async function planBuildRolesReady(
  service: PlanConnectionService | null,
  ctx: CommandContext,
  ws: string,
  connectionId: string,
  raw: unknown,
) {
  const b = parse(BuildRolesReadyBody, raw);
  if (!service)
    throw new ContractError(
      'INVALID_CONFIG',
      'The ChatGPT plan service is not configured.',
    );
  return {
    blockers: await service.buildRolesReady(ctx, ws, connectionId, b),
    // ADR-0109 review L-5: the input cap a build's later parts must fit.
    max_input_chars: await service.buildRoleInputCap(ctx, ws, connectionId),
  };
}
/** Codex turns per build in this process; the per-build request cap is the durable limit. */
const codexTurns = new Map<string, number>();

/** ADR-0042 ChatGPT-plan routes under /api/workspaces/:ws/<collection>. Matched separately. */
export const CONNECTIONS_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(plan-connections|plan-qualifications|plan-qualification-queues|plan-benchmarks|recipe-qualifications|recipe-benchmarks)(?:\/([^/]+)(?:\/(recipe-qualifications|stop|settings|accept-caps|credits|credits-withdraw|sign-in|sign-out|verification-grants|verify|availability-recheck|qualifications|requests|reconcile|quota-recheck|codex-builds|build-calls|build-roles-ready|run|finish|claude-code-check|qualification-queues|cancel|copy|extra-requests))?)?$/;

const VerifyBody = z.strictObject({
  grant_id: z.uuid(),
  model_id: z.string().min(1).max(120),
});
const SignInBody = z.strictObject({ open_browser: z.boolean().default(true) });
const ReconcileBody = z.strictObject({ request_id: z.uuid() }).passthrough();
const RecheckBody = z.strictObject({
  expected_version: z.number().int().positive(),
});

/**
 * One supervised Codex turn for a T12 build (ADR-0042), for the CLI's route and for builds the
 * studio service runs itself (ADR-0046). The plan relay admits each request.
 */
export async function runCodexBuild(
  r: {
    store: ConnectionStore;
    service: PlanConnectionService | null;
    codex: CodexLauncher | null;
  },
  ctx: CommandContext,
  ws: string,
  connectionId: string,
  raw: unknown,
): Promise<Record<string, unknown>> {
  const b = parse(CodexBuildBody, raw);
  if (!r.codex)
    throw new ContractError(
      'INVALID_CONFIG',
      'The pinned Codex CLI is not configured for the studio (CREATOR_CODEX_DIR).',
    );
  const { connection } = await r.store.planConnectionDetail(
    ctx,
    ws,
    connectionId,
  );
  const caps = connection.settings.caps.codex;
  const turns = codexTurns.get(b.build_id) ?? 0;
  if (turns >= caps.max_turns_per_build)
    throw new ContractError(
      'LIMIT_EXCEEDED',
      'The per-build Codex turn cap is reached.',
    );
  codexTurns.set(b.build_id, turns + 1);
  if (!r.service)
    throw new ContractError(
      'INVALID_CONFIG',
      'The ChatGPT plan service is not configured.',
    );
  const admit = r.service.codexAdmission(ctx, ws, {
    connection_id: connectionId,
    model_id: b.model_id,
    run_id: b.run_id,
    build_id: b.build_id,
    data_class: b.data_class,
  });
  let record: unknown = null;
  const out = await codexBuilder({
    launcher: r.codex,
    model: b.model_id,
    timeout_ms: caps.build_timeout_ms,
    relay: async () =>
      new PlanRelay({
        admit,
        request_timeout_ms:
          connection.settings.caps.responses.request_timeout_ms,
        onViolation: () => {},
      }),
    record: async (result) => {
      const { files: _, ...evidence } = result;
      record = evidence;
    },
  })(b.packet as Parameters<ReturnType<typeof codexBuilder>>[0]);
  return { ...out, evidence: record };
}

export async function connectionRoutes(r: {
  store: ConnectionStore;
  service: PlanConnectionService | null;
  codex: CodexLauncher | null;
  /** ADR-0088: told when a queue is started, so it begins at once instead of at the next poll. */
  queue?: { kick(): void } | null;
  /** ADR-0105: build qualifications; told when one starts, so it begins at once. */
  recipes?: { kick(): void } | null;
  ctx: CommandContext;
  ws: string;
  collection: string;
  item: string | undefined;
  action: string | undefined;
  method: string;
  body: () => Promise<unknown>;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  const { store, ctx, ws, collection, item, action, method, send } = r;
  const get = method === 'GET';
  const post = method === 'POST';
  const service = () => {
    if (!r.service)
      throw new ContractError(
        'INVALID_CONFIG',
        'The ChatGPT plan service is not configured.',
      );
    return r.service;
  };
  // ADR-0089 (P34): the discovery benchmarks Qualify a model offers.
  if (collection === 'plan-benchmarks')
    return !item && get
      ? send(200, await store.planBenchmarks(ctx, ws), false)
      : false;
  if (collection === 'plan-qualifications' && item && get && !action)
    return send(
      200,
      await store.planQualificationResults(ctx, ws, item),
      false,
    );
  if (collection === 'plan-qualifications' && item && post) {
    if (action === 'run')
      return send(200, await service().runQualification(ctx, ws, item), true);
    if (action === 'finish')
      return send(
        200,
        await store.finishPlanQualification(ctx, ws, item),
        true,
      );
    return false;
  }
  if (collection === 'plan-qualification-queues' && item) {
    if (get && !action)
      return send(
        200,
        await store.planQualificationQueue(ctx, ws, item),
        false,
      );
    if (post && action === 'cancel')
      return send(
        200,
        await store.cancelQualificationQueue(ctx, ws, item),
        true,
      );
    return false;
  }
  // ADR-0105 (B1): build qualifications, the in-app benchmarks they run, and Stop.
  if (collection === 'recipe-benchmarks')
    return !item && get
      ? send(200, await recipeBenchmarkOffers(), false)
      : false;
  if (collection === 'recipe-qualifications' && item) {
    if (get && !action)
      return send(
        200,
        await store.getRecipeQualification(ctx, ws, item),
        false,
      );
    if (post && action === 'stop')
      return send(
        200,
        await store.stopRecipeQualification(ctx, ws, item, await r.body()),
        true,
      );
    return false;
  }
  if (collection !== 'plan-connections') return false;
  if (item && action === 'recipe-qualifications') {
    if (get)
      return send(
        200,
        await store.listRecipeQualifications(ctx, ws, item),
        false,
      );
    if (post) {
      if (!r.recipes)
        throw new ContractError(
          'INVALID_CONFIG',
          'Build qualifications need the plan service and a database.',
        );
      const started = await startRecipeQualification(
        store,
        ctx,
        ws,
        item,
        await r.body(),
      );
      r.recipes.kick();
      return send(201, started, true);
    }
    return false;
  }
  if (!item) {
    if (get) return send(200, await store.listPlanConnections(ctx, ws), false);
    if (post)
      return send(
        201,
        await store.createPlanConnection(ctx, ws, await r.body()),
        true,
      );
    return false;
  }
  if (!action && get) {
    const detail = await store.planConnectionDetail(ctx, ws, item);
    return send(
      200,
      { ...detail, sign_in_attempt: r.service?.signInStatus(item) ?? null },
      false,
    );
  }
  if (action === 'requests' && get)
    return send(200, await store.planRequests(ctx, ws, item), false);
  if (!post) return false;
  switch (action) {
    case 'settings':
      return send(
        200,
        await store.updatePlanSettings(ctx, ws, item, await r.body()),
        true,
      );
    case 'copy':
      // ADR-0095 (P30): a new connection in another workspace the same owner owns.
      return send(
        201,
        await store.copyPlanConnection(ctx, ws, item, await r.body()),
        true,
      );
    case 'accept-caps':
      return send(
        200,
        await store.acceptPlanCaps(ctx, ws, item, await r.body()),
        true,
      );
    case 'extra-requests':
      return send(
        200,
        await store.grantExtraRequests(ctx, ws, item, await r.body()),
        true,
      );
    case 'credits':
      return send(
        200,
        await store.attestPlanCredits(ctx, ws, item, await r.body()),
        true,
      );
    case 'credits-withdraw':
      return send(
        200,
        await store.withdrawPlanCredits(ctx, ws, item, await r.body()),
        true,
      );
    case 'sign-in': {
      const b = parse(SignInBody, await r.body());
      return send(202, await service().beginSignIn(ctx, ws, item, b), true);
    }
    case 'sign-out':
      return send(200, await service().signOut(ctx, ws, item), true);
    case 'claude-code-check':
      // ADR-0050: reads `claude auth status` on this computer; no model request.
      return send(200, await service().checkClaudeCode(ctx, ws, item), true);
    case 'verification-grants':
      return send(
        201,
        await store.createPlanVerificationGrant(ctx, ws, item, await r.body()),
        true,
      );
    case 'verify': {
      const b = parse(VerifyBody, await r.body());
      return send(
        200,
        await service().verifyModel(ctx, ws, item, {
          id: b.grant_id,
          model_id: b.model_id,
        }),
        true,
      );
    }
    case 'availability-recheck': {
      const b = parse(VerifyBody, await r.body());
      return send(
        200,
        await service().recheckAvailability(ctx, ws, item, {
          id: b.grant_id,
          model_id: b.model_id,
        }),
        true,
      );
    }
    case 'qualifications':
      return send(
        201,
        await store.startPlanQualification(ctx, ws, item, await r.body()),
        true,
      );
    case 'qualification-queues': {
      if (!r.service)
        throw new ContractError(
          'INVALID_CONFIG',
          'The ChatGPT plan service is not configured.',
        );
      const queue = await store.startQualificationQueue(
        ctx,
        ws,
        item,
        await r.body(),
      );
      r.queue?.kick();
      return send(201, queue, true);
    }
    case 'reconcile': {
      const { request_id, ...rest } = parse(ReconcileBody, await r.body()) as {
        request_id: string;
      } & Record<string, unknown>;
      return send(
        200,
        await store.reconcilePlanRequest(ctx, ws, item, request_id, rest),
        true,
      );
    }
    case 'codex-builds':
      // One supervised Codex turn for a T12 build. T12 itself applies, reviews and tests it.
      return send(
        200,
        await runCodexBuild(
          { store, service: r.service, codex: r.codex },
          ctx,
          ws,
          item,
          await r.body(),
        ),
        true,
      );
    case 'build-calls':
      // One fresh builder or reviewer request for a T12 build (ADR-0048).
      return send(
        200,
        await runPlanBuildCall(r.service, ctx, ws, item, await r.body()),
        true,
      );
    case 'build-roles-ready':
      return send(
        200,
        await planBuildRolesReady(r.service, ctx, ws, item, await r.body()),
        false,
      );
    case 'quota-recheck': {
      const b = parse(RecheckBody, await r.body());
      return send(
        200,
        await store.resetPlanQuotaObservation(
          ctx,
          ws,
          item,
          b.expected_version,
        ),
        true,
      );
    }
  }
  return false;
}
