import { lstat, mkdir, readdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { canonical, readJson, withLock } from './files.js';
import { git } from './git.js';
import { checked, digest, id, productSchema, sha } from './contracts.js';
import type { ProductSupervisor } from './products.js';

/**
 * ADR-0121 (F10): disk used by the product store, and the one cleanup the studio offers.
 *
 * Cleanup removes only build workspaces: a task's checkout (`worktrees/<task>`) once its
 * latest commit is in a verified package whose bytes still match their recorded hashes, and a
 * finished merge checkout (`worktrees/<operation>`) whose merge is in the repository. Git
 * removes the checkout with `git worktree remove` (never forced), so the commits stay on the
 * task's or merge's branch and a task's checkout can be made again from its branch
 * (`restoreTaskWorkspace`, which a new build of that task runs first). Repositories, packages,
 * build and run records, previews, files and backups are never touched.
 */

export type DiskSize = { bytes: number; files: number; newest: number };

/** Bytes under a folder, without following links. A missing folder is zero. */
export async function diskSize(dir: string): Promise<DiskSize> {
  const out: DiskSize = { bytes: 0, files: 0, newest: 0 };
  const walk = async (path: string): Promise<void> => {
    let st;
    try {
      st = await lstat(path);
    } catch {
      return;
    }
    out.newest = Math.max(out.newest, st.mtimeMs);
    if (!st.isDirectory()) {
      out.bytes += st.size;
      out.files += 1;
      return;
    }
    let names: string[];
    try {
      names = await readdir(path);
    } catch {
      return;
    }
    for (const n of names) await walk(join(path, n));
  };
  await walk(dir);
  return out;
}

export type ProductDiskUsage = {
  product_id: string;
  workspace_id: string;
  repository: number;
  build_workspaces: number;
  build_workspace_count: number;
  packages: number;
  records: number;
};

const isId = (n: string) => id.safeParse(n).success;

/** Every product in the store whose product.json reads, with its disk split by kind. */
export async function productDiskUsage(
  products: ProductSupervisor,
): Promise<ProductDiskUsage[]> {
  const names = await readdir(products.root).catch(() => [] as string[]);
  const out: ProductDiskUsage[] = [];
  for (const name of names.sort()) {
    if (!isId(name)) continue;
    const p = await products.product(name).catch(() => null);
    if (!p) continue;
    const dir = products.dir(name);
    const total = await diskSize(dir);
    const repository = await diskSize(join(dir, 'repo'));
    const trees = await diskSize(join(dir, 'worktrees'));
    const packages = await diskSize(join(dir, 'artifacts'));
    const count = (await readdir(join(dir, 'worktrees')).catch(() => []))
      .length;
    out.push({
      product_id: p.id,
      workspace_id: p.binding.workspace_id,
      repository: repository.bytes,
      build_workspaces: trees.bytes,
      build_workspace_count: count,
      packages: packages.bytes,
      records: Math.max(
        0,
        total.bytes - repository.bytes - trees.bytes - packages.bytes,
      ),
    });
  }
  return out;
}

/** A verified package as the database records it. */
export type PackageRef = {
  artifact_id: string;
  product_id: string;
  task_id: string;
  commit: string;
  manifest_sha256: string;
  archive_sha256: string;
};
export type PackageCheck = {
  artifact_id: string;
  product_id: string;
  ok: boolean;
  reason: string | null;
};

/** Hashes each package's manifest and archive on disk against the recorded hashes. */
export async function checkPackages(
  products: ProductSupervisor,
  refs: PackageRef[],
): Promise<PackageCheck[]> {
  const out: PackageCheck[] = [];
  for (const r of refs) {
    const dir = join(
      products.dir(r.product_id),
      'artifacts',
      checked(id, r.artifact_id),
    );
    let reason: string | null = null;
    try {
      const manifest = await readFile(
        await canonical(join(dir, 'manifest.json')),
      );
      const archive = await readFile(await canonical(join(dir, 'source.tar')));
      if (digest(manifest) !== r.manifest_sha256)
        reason = 'Its manifest no longer matches the recorded hash.';
      else if (digest(archive) !== r.archive_sha256)
        reason = 'Its archive no longer matches the recorded hash.';
    } catch (e) {
      reason =
        (e as NodeJS.ErrnoException).code === 'ENOENT'
          ? 'Its files are missing from the product store.'
          : 'Its files could not be read.';
    }
    out.push({
      artifact_id: r.artifact_id,
      product_id: r.product_id,
      ok: reason === null,
      reason,
    });
  }
  return out;
}

export type WorkspaceCandidate = {
  product_id: string;
  workspace_id: string;
  name: string;
  kind: 'task' | 'merge';
  head: string;
  bytes: number;
  last_changed_at: string;
};
export type KeptWorkspace = {
  product_id: string;
  workspace_id: string | null;
  name: string;
  bytes: number;
  reason: string;
};
export type CleanupInputs = {
  packages: PackageRef[];
  checks: PackageCheck[];
  /** Workspaces (projects) whose products are never cleaned, such as thesis study ones. */
  protectedWorkspaces: ReadonlySet<string>;
  /** Only products in these workspaces are considered at all (the person's own). */
  workspaces: ReadonlySet<string>;
  olderThanDays: number;
  now: Date;
};

const exists = (p: string) =>
  lstat(p).then(
    () => true,
    () => false,
  );
const same = (a: string, b: string) =>
  process.platform === 'win32'
    ? resolve(a).toLowerCase() === resolve(b).toLowerCase()
    : resolve(a) === resolve(b);
async function tip(repo: string, ref: string): Promise<string | null> {
  return git(repo, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])
    .then((s) => (sha.safeParse(s).success ? s : null))
    .catch(() => null);
}

/** Whether this product is busy: a build or a Git step holds one of its locks. */
async function busy(products: ProductSupervisor, productId: string) {
  const dir = products.dir(productId);
  return (
    (await exists(join(dir, 'supervisor.lock'))) ||
    (await exists(join(dir, 'builds', 'supervisor.lock')))
  );
}

/**
 * Decides one checkout: a candidate, or kept with the reason in words. Run when planning and
 * again under the product's locks just before removal.
 */
async function judge(
  products: ProductSupervisor,
  productId: string,
  workspaceId: string,
  name: string,
  o: CleanupInputs,
  registered: string[],
): Promise<WorkspaceCandidate | KeptWorkspace> {
  const path = join(products.dir(productId), 'worktrees', name);
  const size = await diskSize(path);
  const keep = (reason: string): KeptWorkspace => ({
    product_id: productId,
    workspace_id: workspaceId,
    name,
    bytes: size.bytes,
    reason,
  });
  const st = await lstat(path).catch(() => null);
  if (!st || !st.isDirectory() || st.isSymbolicLink())
    return keep('Not a plain folder; left for a person to look at.');
  if (!isId(name)) return keep('Not a folder the studio made; left alone.');
  if (!registered.some((r) => same(r, path)))
    return keep('Not a registered Git workspace; left alone.');
  const repo = products.repo(productId);
  if (await exists(join(repo, '.git', 'worktrees', name, 'index.lock')))
    return keep('A Git step was interrupted here; left for recovery.');
  const kind: 'task' | 'merge' = (await exists(
    join(products.dir(productId), 'tasks', `${name}.json`),
  ))
    ? 'task'
    : 'merge';
  let status: string, head: string;
  try {
    await canonical(path);
    status = await git(path, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ]);
    head = await git(path, ['rev-parse', '--verify', 'HEAD']);
  } catch {
    return keep('Git could not read this workspace; left alone.');
  }
  if (status) return keep('Has changes that are not committed.');
  const branch =
    kind === 'task'
      ? `refs/heads/task/${name}`
      : `refs/heads/integration-review/${name}`;
  if ((await tip(repo, branch)) !== head)
    return keep('Its latest commit is not saved on its branch.');
  if (kind === 'task') {
    const pkgs = o.packages.filter(
      (p) =>
        p.product_id === productId && p.task_id === name && p.commit === head,
    );
    if (!pkgs.length)
      return keep('No verified package of its latest commit yet.');
    const good = pkgs.some(
      (p) => o.checks.find((c) => c.artifact_id === p.artifact_id)?.ok,
    );
    if (!good)
      return keep(
        'Its verified package does not match its recorded hashes; kept until that is looked at.',
      );
  } else {
    const main = await tip(repo, 'HEAD');
    const merged =
      main !== null &&
      (await git(repo, ['merge-base', '--is-ancestor', head, main]).then(
        () => true,
        () => false,
      ));
    if (!merged) return keep('Its merge is not in the repository yet.');
  }
  const cutoff = o.now.getTime() - o.olderThanDays * 86_400_000;
  if (size.newest > cutoff)
    return keep(`Changed in the last ${o.olderThanDays} days.`);
  return {
    product_id: productId,
    workspace_id: workspaceId,
    name,
    kind,
    head,
    bytes: size.bytes,
    last_changed_at: new Date(size.newest).toISOString(),
  };
}

async function registeredTrees(repo: string): Promise<string[]> {
  const list = await git(repo, ['worktree', 'list', '--porcelain']).catch(
    () => '',
  );
  return list
    .split('\n')
    .filter((l) => l.startsWith('worktree '))
    .map((l) => l.slice('worktree '.length));
}

const isCandidate = (
  v: WorkspaceCandidate | KeptWorkspace,
): v is WorkspaceCandidate => !('reason' in v);

/** What "Remove old build workspaces" would remove now, and why everything else stays. */
export async function planWorkspaceCleanup(
  products: ProductSupervisor,
  o: CleanupInputs,
): Promise<{ remove: WorkspaceCandidate[]; keep: KeptWorkspace[] }> {
  const remove: WorkspaceCandidate[] = [];
  const keep: KeptWorkspace[] = [];
  const names = await readdir(products.root).catch(() => [] as string[]);
  for (const productId of names.sort()) {
    if (!isId(productId)) continue;
    const raw = await readJson(
      join(products.dir(productId), 'product.json'),
    ).catch(() => null);
    const parsed = productSchema.safeParse(raw);
    const ws = parsed.success ? parsed.data.binding.workspace_id : null;
    if (ws !== null && !o.workspaces.has(ws)) continue;
    const trees = (
      await readdir(join(products.dir(productId), 'worktrees')).catch(
        () => [] as string[],
      )
    ).sort();
    if (!trees.length) continue;
    const all = async (reason: string) => {
      for (const name of trees)
        keep.push({
          product_id: productId,
          workspace_id: ws,
          name,
          bytes: (
            await diskSize(join(products.dir(productId), 'worktrees', name))
          ).bytes,
          reason,
        });
    };
    if (ws === null) {
      if (!o.workspaces.size) continue;
      await all('Its product record could not be read; left alone.');
      continue;
    }
    if (o.protectedWorkspaces.has(ws)) {
      await all(
        'A thesis study uses this project; study builds are never cleaned.',
      );
      continue;
    }
    if (await busy(products, productId)) {
      await all('A build or Git step is running in this product.');
      continue;
    }
    const registered = await registeredTrees(products.repo(productId));
    for (const name of trees) {
      const v = await judge(products, productId, ws, name, o, registered);
      if (isCandidate(v)) remove.push(v);
      else keep.push(v);
    }
  }
  return { remove, keep };
}

/** Binds a confirmation to the exact list shown: product, folder and commit of each. */
export function cleanupPlanHash(
  olderThanDays: number,
  remove: WorkspaceCandidate[],
): string {
  return digest(
    JSON.stringify({
      older_than_days: olderThanDays,
      remove: remove
        .map((r) => [r.product_id, r.name, r.kind, r.head])
        .sort((a, b) => a.join('/').localeCompare(b.join('/'))),
    }),
  );
}

/**
 * Removes confirmed checkouts, one product at a time under its build lock and its Git lock
 * (the same order a build takes them), judging each again first: anything that changed since
 * the plan is left and reported. `git worktree remove` without --force refuses a checkout
 * with changes, so nothing uncommitted is ever lost.
 */
export async function removeWorkspaces(
  products: ProductSupervisor,
  confirmed: WorkspaceCandidate[],
  o: CleanupInputs,
): Promise<{
  removed: WorkspaceCandidate[];
  failed: { product_id: string; name: string; reason: string }[];
}> {
  const removed: WorkspaceCandidate[] = [];
  const failed: { product_id: string; name: string; reason: string }[] = [];
  const byProduct = new Map<string, WorkspaceCandidate[]>();
  for (const c of confirmed)
    byProduct.set(c.product_id, [...(byProduct.get(c.product_id) ?? []), c]);
  for (const [productId, list] of byProduct) {
    const dir = products.dir(checked(id, productId));
    const builds = join(dir, 'builds');
    try {
      await canonical(builds, true);
      await mkdir(builds, { recursive: true });
      await withLock(builds, () =>
        withLock(dir, async () => {
          const repo = products.repo(productId);
          const registered = await registeredTrees(repo);
          for (const c of list) {
            const now = await judge(
              products,
              productId,
              c.workspace_id,
              c.name,
              o,
              registered,
            );
            if (!isCandidate(now) || now.head !== c.head) {
              failed.push({
                product_id: productId,
                name: c.name,
                reason: isCandidate(now)
                  ? 'It moved to a newer commit since you confirmed; left alone.'
                  : now.reason,
              });
              continue;
            }
            try {
              await git(repo, [
                'worktree',
                'remove',
                join(dir, 'worktrees', checked(id, c.name)),
              ]);
              removed.push(now);
            } catch (e) {
              failed.push({
                product_id: productId,
                name: c.name,
                reason: `Git refused to remove it: ${(e instanceof Error ? e.message : String(e)).slice(0, 200)}`,
              });
            }
          }
        }),
      );
    } catch (e) {
      for (const c of list)
        if (
          !removed.some(
            (r) => r.product_id === productId && r.name === c.name,
          ) &&
          !failed.some((f) => f.product_id === productId && f.name === c.name)
        )
          failed.push({
            product_id: productId,
            name: c.name,
            reason: /locked/i.test(String(e))
              ? 'A build or Git step started in this product; left alone.'
              : (e instanceof Error ? e.message : String(e)).slice(0, 300),
          });
    }
  }
  return { removed, failed };
}

/**
 * Makes a task's checkout again from its branch after a cleanup removed it. Returns false when
 * the checkout is already there. The checkout is the branch's exact commit, so a build
 * continues from where it stopped.
 */
export async function restoreTaskWorkspace(
  products: ProductSupervisor,
  productId: string,
  taskId: string,
): Promise<boolean> {
  await products.task(productId, taskId);
  const tree = products.worktree(productId, taskId);
  if (await exists(tree)) return false;
  return withLock(products.dir(productId), async () => {
    if (await exists(tree)) return false;
    const repo = products.repo(productId);
    const at = await tip(repo, `refs/heads/task/${taskId}`);
    if (!at)
      throw new Error(
        "This task's workspace is gone and its branch is missing; create a new product from the spec.",
      );
    await git(repo, ['worktree', 'prune']);
    await git(repo, ['worktree', 'add', tree, `task/${taskId}`]);
    return true;
  });
}

/** The same, for the task a recorded build ran in (packaging re-reads that checkout). */
export async function restoreBuildWorkspace(
  products: ProductSupervisor,
  productId: string,
  buildId: string,
): Promise<boolean> {
  const intent = (await readJson(
    join(
      products.dir(productId),
      'builds',
      checked(id, buildId),
      'intent.json',
    ),
  ).catch(() => null)) as { task_id?: unknown } | null;
  const task = id.safeParse(intent?.task_id);
  return task.success
    ? restoreTaskWorkspace(products, productId, task.data)
    : false;
}
