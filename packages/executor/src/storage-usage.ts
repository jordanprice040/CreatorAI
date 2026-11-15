import { lstat, mkdir, readdir, readFile, rename } from 'node:fs/promises';
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
  /** Review L-7: leftovers of failed removals, moved aside; null when there are none. */
  moved_aside: { folder: string; count: number; bytes: number } | null;
};

const isId = (n: string) => id.safeParse(n).success;

/** Every product in the store whose product.json reads, with its disk split by kind. */
export async function productDiskUsage(
  products: ProductSupervisor,
  /** Measure only products in these workspaces (review L-2: the person's own). */
  workspaces?: ReadonlySet<string>,
): Promise<ProductDiskUsage[]> {
  const names = await readdir(products.root).catch(() => [] as string[]);
  const out: ProductDiskUsage[] = [];
  for (const name of names.sort()) {
    if (!isId(name)) continue;
    const p = await products.product(name).catch(() => null);
    if (!p) continue;
    if (workspaces && !workspaces.has(p.binding.workspace_id)) continue;
    const dir = products.dir(name);
    const total = await diskSize(dir);
    const repository = await diskSize(join(dir, 'repo'));
    const trees = await diskSize(join(dir, 'worktrees'));
    const packages = await diskSize(join(dir, 'artifacts'));
    const asideDir = join(dir, 'worktrees-removed');
    const aside = await diskSize(asideDir);
    const asideCount = (await readdir(asideDir).catch(() => [])).length;
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
        total.bytes -
          repository.bytes -
          trees.bytes -
          packages.bytes -
          aside.bytes,
      ),
      moved_aside: asideCount
        ? { folder: asideDir, count: asideCount, bytes: aside.bytes }
        : null,
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
  /**
   * List products whose record can't be read (so their project is unknown) as kept. Only the
   * studio owner sees them (review N-3).
   */
  includeUnreadable?: boolean;
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
  return git(repo, [
    '--no-optional-locks',
    'rev-parse',
    '--verify',
    '--quiet',
    `${ref}^{commit}`,
  ])
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
    return keep(
      (await brokenCheckout(path))
        ? LEFTOVER
        : 'Not a registered Git workspace; left alone.',
    );
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
    // Read-only: no optional index lock, so a build starting meanwhile never meets one
    // (review L-2). Ignored files are listed too: `git worktree remove` deletes them (M-1).
    status = await git(path, [
      '--no-optional-locks',
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
      '--ignored=matching',
    ]);
    head = await git(path, [
      '--no-optional-locks',
      'rev-parse',
      '--verify',
      'HEAD',
    ]);
  } catch {
    return keep('Git could not read this workspace; left alone.');
  }
  const lines = status.split('\n').filter(Boolean);
  if (lines.some((l) => !l.startsWith('!! ')))
    return keep('Has changes that are not committed.');
  if (lines.length)
    return keep('Has ignored files that are not in any commit.');
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
      (await git(repo, [
        '--no-optional-locks',
        'merge-base',
        '--is-ancestor',
        head,
        main,
      ]).then(
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

/** Git's list of this repository's checkouts. A Git error throws: it is never "none" (L-6). */
async function registeredTrees(repo: string): Promise<string[]> {
  const list = await git(repo, [
    '--no-optional-locks',
    'worktree',
    'list',
    '--porcelain',
  ]);
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
      if (!o.includeUnreadable) continue;
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
    const registered = await registeredTrees(products.repo(productId)).catch(
      () => null,
    );
    if (!registered) {
      await all("Git could not list this product's workspaces; left alone.");
      continue;
    }
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
 * the plan is left and reported. A checkout with uncommitted, untracked or ignored files is
 * never offered (Git's `worktree remove` would delete ignored ones), and `git worktree remove`
 * without --force refuses changes again, so nothing outside a commit is lost.
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
            const path = join(dir, 'worktrees', checked(id, c.name));
            try {
              await git(repo, ['worktree', 'remove', path]);
              removed.push(now);
            } catch (e) {
              const why = (e instanceof Error ? e.message : String(e)).slice(
                0,
                200,
              );
              failed.push({
                product_id: productId,
                name: c.name,
                reason: await afterFailedRemove(
                  products,
                  productId,
                  c,
                  path,
                  why,
                ),
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
 * Review M-2: on Windows a file held open (an editor, the indexer, antivirus) can make Git's
 * delete fail part-way, after Git already dropped the worktree's registration. The half-deleted
 * folder would then block the product's next build and its Recover. When the folder is no
 * longer registered and the confirmed commit is still on its branch, the leftover is moved
 * aside to `worktrees-removed/` (nothing is deleted), so the task's checkout can be made again.
 */
async function afterFailedRemove(
  products: ProductSupervisor,
  productId: string,
  c: WorkspaceCandidate,
  path: string,
  why: string,
): Promise<string> {
  const repo = products.repo(productId);
  if (!(await exists(path)))
    return `Git reported an error but the folder is gone: ${why}`;
  // Review L-6: moved aside only when Git can no longer open it, never because a list
  // failed or names the folder by another path.
  if (!(await brokenCheckout(path))) return `Git refused to remove it: ${why}`;
  const branch =
    c.kind === 'task'
      ? `refs/heads/task/${c.name}`
      : `refs/heads/integration-review/${c.name}`;
  if ((await tip(repo, branch)) !== c.head)
    return `Git could not finish removing it and its branch changed; left for a person to look at: ${why}`;
  const aside = await moveAside(products, productId, path, c.name);
  return aside
    ? `Git could not finish removing it (${why}). What was left was moved to ${aside}; its commit is safe on its branch.`
    : `Git could not finish removing it, and the rest could not be moved aside (${why}). ${AFTER_STUCK}`;
}

/** Review L-7: what to do about a leftover the studio could not move aside. */
const AFTER_STUCK =
  'Close any program using it. Then, for a task, build that task again (the studio moves the leftover aside first); for a merge, or if that fails too, move the folder out of worktrees by hand. Its commit is safe on its branch.';
const LEFTOVER = `Git can no longer open it; most likely left over from a removal that failed part-way. ${AFTER_STUCK}`;

/**
 * Review L-6: positive evidence that a checkout is broken, read from the folder itself, so a
 * failed `worktree list`, a Git error (a bad shared config fails every checkout alike) or a
 * store reached by another path than the one Git recorded never counts. Broken means its
 * `.git` file is gone or names no admin folder, or that admin folder is gone (Git drops it
 * even when deleting the files fails part-way). A folder with its own `.git` directory is not
 * a studio checkout and is never called broken.
 */
async function brokenCheckout(tree: string): Promise<boolean> {
  const dotGit = join(tree, '.git');
  const st = await lstat(dotGit).catch(() => null);
  if (!st) return true;
  if (st.isDirectory()) return false;
  if (!st.isFile()) return true;
  const m = /^gitdir:\s*(.+?)\s*$/m.exec(
    await readFile(dotGit, 'utf8').catch(() => ''),
  );
  if (!m) return true;
  return !(await exists(join(resolve(tree, m[1]!), 'HEAD')));
}

/** Moves a leftover checkout into the product's `worktrees-removed/` folder. */
async function moveAside(
  products: ProductSupervisor,
  productId: string,
  path: string,
  name: string,
): Promise<string | null> {
  const into = join(products.dir(productId), 'worktrees-removed');
  const rel = `worktrees-removed/${name}-${Date.now()}`;
  try {
    await canonical(into, true);
    await mkdir(into, { recursive: true });
    await rename(path, join(products.dir(productId), rel));
  } catch {
    return null;
  }
  // The folder is already out of the way; a failed prune leaves only Git's own note of it.
  await git(products.repo(productId), ['worktree', 'prune']).catch(() => {});
  return rel;
}

/**
 * Makes a task's checkout again from its branch after a cleanup removed it. Returns false when
 * the checkout is already there. The checkout is the branch's exact commit, so a build
 * continues from where it stopped. A folder that is there but no longer a registered Git
 * workspace (a removal that failed part-way, review M-2) is moved aside first.
 */
export async function restoreTaskWorkspace(
  products: ProductSupervisor,
  productId: string,
  taskId: string,
  o: {
    /** Review N-6: make a missing checkout only; never move anything (for reads). */
    onlyIfMissing?: boolean;
    /** Review N-7: told where a broken leftover was moved, so the caller can say so. */
    onMovedAside?: (folder: string) => void;
  } = {},
): Promise<boolean> {
  await products.task(productId, taskId);
  const tree = products.worktree(productId, taskId);
  const repo = products.repo(productId);
  // Review L-6: a checkout that is there and opens is left exactly as it is, whatever
  // `worktree list` says; the build then checks it as it always did.
  const fine = async () =>
    (await exists(tree)) && !(await brokenCheckout(tree));
  if (await fine()) return false;
  if (o.onlyIfMissing && (await exists(tree))) return false;
  return withLock(products.dir(productId), async () => {
    if (await fine()) return false;
    const moved = (await exists(tree))
      ? await moveAside(products, productId, tree, taskId)
      : undefined;
    if (moved) o.onMovedAside?.(join(products.dir(productId), moved));
    if (moved === null)
      throw new Error(
        "This task's workspace was left half-removed and could not be moved aside. Close any program using it and try again, or move the folder out of worktrees by hand; its commit is safe on its branch.",
      );
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
  o: Parameters<typeof restoreTaskWorkspace>[3] = {},
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
    ? restoreTaskWorkspace(products, productId, task.data, o)
    : false;
}
