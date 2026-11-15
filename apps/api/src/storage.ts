import type { IncomingMessage } from 'node:http';
import {
  ContractError,
  CleanupPlanSchema,
  StorageCleanupRequestSchema,
  StorageCleanupResultSchema,
  StorageReportSchema,
  parse,
  type CleanupPlan,
  type SessionInfo,
  type StorageCleanupRecord,
  type StorageProject,
  type StorageStudioItem,
} from '@creator/contracts';
import {
  checkPackages,
  cleanupPlanHash,
  diskSize,
  planWorkspaceCleanup,
  productDiskUsage,
  removeWorkspaces,
  type CleanupInputs,
  type ProductSupervisor,
} from '@creator/executor';
import type { StorageStore } from '@creator/db';

/** How old a build workspace must be before the cleanup offers to remove it. */
export const DEFAULT_CLEANUP_DAYS = 14;

/**
 * ADR-0121 (F10): Monitor > Storage. `GET /api/storage` measures disk per project and shows
 * what the cleanup would remove; `POST /api/storage/cleanup` removes exactly that list after
 * the person confirms it. Owner sessions only, and only the person's own projects.
 */
export function createStorage(o: {
  store: StorageStore | null;
  products: ProductSupervisor;
  /** Studio-wide folders beside the product store (qualification builds). */
  studioRoots: { plan: string; recipe: string };
  ownerId: string;
  ensureReady: () => Promise<void>;
  requireSession: (
    req: IncomingMessage,
    mutating: boolean,
  ) => Promise<SessionInfo>;
}) {
  let cleaning = false;

  function needStore(): StorageStore {
    if (!o.store)
      throw new ContractError(
        'STORAGE_UNAVAILABLE',
        'The storage page needs PostgreSQL; set CREATOR_DATABASE_URL.',
      );
    return o.store;
  }

  async function inputs(session: SessionInfo, days: number) {
    const store = needStore();
    await o.ensureReady();
    const ctx = { actorId: session.actor_id };
    const workspaces = await store.ownedWorkspaces(ctx);
    const owned = new Set(workspaces.map((w) => w.workspace_id));
    // Every verified package in the person's projects is hashed before and after.
    const packages = (await store.verifiedPackages()).filter((p) =>
      owned.has(p.workspace_id),
    );
    const checks = await checkPackages(o.products, packages);
    const cleanup: CleanupInputs = {
      packages,
      checks,
      protectedWorkspaces: await store.studyWorkspaces(),
      workspaces: owned,
      olderThanDays: days,
      now: new Date(),
    };
    return { store, ctx, workspaces, packages, cleanup };
  }

  async function plan(cleanup: CleanupInputs): Promise<CleanupPlan> {
    const { remove, keep } = await planWorkspaceCleanup(o.products, cleanup);
    return parse(CleanupPlanSchema, {
      older_than_days: cleanup.olderThanDays,
      plan_hash: cleanupPlanHash(cleanup.olderThanDays, remove),
      remove,
      keep,
      remove_bytes: remove.reduce((n, r) => n + r.bytes, 0),
      packages_checked: cleanup.checks.length,
      packages_failed: cleanup.checks.filter((c) => !c.ok),
    });
  }

  async function report(session: SessionInfo, days: number) {
    const { store, ctx, workspaces, packages, cleanup } = await inputs(
      session,
      days,
    );
    const usage = await productDiskUsage(o.products);
    const projects: StorageProject[] = workspaces.map((w) => {
      const mine = usage.filter((u) => u.workspace_id === w.workspace_id);
      const sum = (k: keyof (typeof mine)[number]) =>
        mine.reduce((n, u) => n + Number(u[k]), 0);
      return {
        workspace_id: w.workspace_id,
        name: w.name,
        fixture: w.fixture,
        products: mine.length,
        repositories: sum('repository'),
        build_workspaces: sum('build_workspaces'),
        build_workspace_count: sum('build_workspace_count'),
        packages: sum('packages'),
        verified_packages: packages.filter(
          (p) => p.workspace_id === w.workspace_id,
        ).length,
        records: sum('records'),
        files: w.files,
        previews_live: w.previews_live,
        previews_ended: w.previews_ended,
        study: w.study,
      };
    });
    const studio: StorageStudioItem[] =
      session.actor_id === o.ownerId
        ? [
            {
              key: 'plan_qualification_builds',
              label: 'Builder qualification answers',
              bytes: (await diskSize(o.studioRoots.plan)).bytes,
              note: 'Kept as qualification evidence; not part of any project.',
            },
            {
              key: 'build_qualification_builds',
              label: 'Build qualification products',
              bytes: (await diskSize(o.studioRoots.recipe)).bytes,
              note: 'Kept as qualification evidence; not part of any project.',
            },
            {
              key: 'backups',
              label: 'Backups',
              bytes: null,
              note: 'Backups go to a folder you choose (pnpm backup create), so the studio does not measure them yet.',
            },
          ]
        : [];
    const history: StorageCleanupRecord[] = (
      await store.cleanupHistory(ctx)
    ).map((e) => {
      const p = e.payload;
      const count = (v: unknown) => (Array.isArray(v) ? v.length : 0);
      return {
        id: e.id,
        occurred_at: e.occurred_at,
        action: e.action,
        removed: count(
          e.action === 'storage.cleanup.intent' ? p.remove : p.removed,
        ),
        failed: count(p.failed),
        bytes_freed: Number(p.bytes_freed ?? 0),
        packages_ok:
          e.action === 'storage.cleanup.outcome'
            ? count(p.packages_changed) === 0
            : null,
      };
    });
    return parse(StorageReportSchema, {
      measured_at: new Date().toISOString(),
      projects,
      studio,
      cleanup: await plan(cleanup),
      history,
    });
  }

  async function clean(session: SessionInfo, raw: unknown) {
    const req = parse(StorageCleanupRequestSchema, raw);
    const { store, ctx, cleanup } = await inputs(session, req.older_than_days);
    const now = await plan(cleanup);
    if (now.plan_hash !== req.plan_hash)
      throw new ContractError(
        'VERSION_CONFLICT',
        'What the cleanup would remove changed since you looked. Review the new list and confirm again.',
      );
    if (!now.remove.length)
      throw new ContractError(
        'INVALID_TRANSITION',
        'There are no old build workspaces to remove.',
      );
    const okBefore = new Set(
      cleanup.checks.filter((c) => c.ok).map((c) => c.artifact_id),
    );
    // Recorded before anything is removed, so a crash mid-way still leaves the intent.
    await store.recordCleanup(ctx, 'storage.cleanup.intent', {
      older_than_days: req.older_than_days,
      plan_hash: now.plan_hash,
      remove: now.remove,
      packages_checked: now.packages_checked,
      packages_failed: now.packages_failed.map((c) => c.artifact_id),
    });
    let result: Awaited<ReturnType<typeof removeWorkspaces>> = {
      removed: [],
      failed: [],
    };
    let error: unknown = null;
    try {
      result = await removeWorkspaces(o.products, now.remove, cleanup);
    } catch (e) {
      error = e;
    }
    const after = await checkPackages(o.products, cleanup.packages);
    const changed = after.filter((c) => !c.ok && okBefore.has(c.artifact_id));
    const out = parse(StorageCleanupResultSchema, {
      removed: result.removed,
      failed: error
        ? [
            ...result.failed,
            ...now.remove
              .filter(
                (r) =>
                  !result.removed.some(
                    (x) => x.product_id === r.product_id && x.name === r.name,
                  ) &&
                  !result.failed.some(
                    (x) => x.product_id === r.product_id && x.name === r.name,
                  ),
              )
              .map((r) => ({
                product_id: r.product_id,
                name: r.name,
                reason: 'The cleanup stopped before reaching it.',
              })),
          ]
        : result.failed,
      bytes_freed: result.removed.reduce((n, r) => n + r.bytes, 0),
      packages_checked: after.length,
      packages_changed: changed,
    });
    await store.recordCleanup(ctx, 'storage.cleanup.outcome', {
      plan_hash: now.plan_hash,
      ...out,
    });
    if (error) throw error;
    return out;
  }

  /** Handles /api/storage and /api/storage/cleanup; returns null for other paths. */
  async function route(
    req: IncomingMessage,
    url: URL,
    body: () => Promise<unknown>,
  ): Promise<{ status: number; value: unknown } | null> {
    const method = req.method ?? 'GET';
    if (url.pathname === '/api/storage' && method === 'GET') {
      const session = await o.requireSession(req, false);
      const raw = url.searchParams.get('older_than_days');
      const days = raw === null ? DEFAULT_CLEANUP_DAYS : Number(raw);
      if (!Number.isInteger(days) || days < 1 || days > 365)
        throw new ContractError(
          'INVALID_CONTRACT',
          'older_than_days must be a whole number of days from 1 to 365.',
        );
      return { status: 200, value: await report(session, days) };
    }
    if (url.pathname === '/api/storage/cleanup' && method === 'POST') {
      const session = await o.requireSession(req, true);
      if (cleaning)
        throw new ContractError(
          'VERSION_CONFLICT',
          'A cleanup is already running; wait for it to finish.',
        );
      cleaning = true;
      try {
        return { status: 200, value: await clean(session, await body()) };
      } finally {
        cleaning = false;
      }
    }
    return null;
  }
  return { route };
}
