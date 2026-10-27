import {
  mkdir,
  readFile,
  writeFile,
  unlink,
  readdir,
  rename,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  bindingSchema,
  productSchema,
  taskSchema,
  changesSchema,
  id,
  sha,
  checked,
  digest,
  type Binding,
  type Product,
  type Task,
} from './contracts.js';
import {
  canonical,
  fileAt,
  jsonWrite,
  readJson,
  withLock,
  event,
  newFile,
} from './files.js';
import { git, clean, head, safeTree } from './git.js';
import type { PackageFile } from './tar.js';

export const TEMPLATE = {
  'readme.md':
    '# Reviewed Python template\nSynthetic local checklist. No dependencies or network.\n',
  'src/main.py':
    'import json\nprint(json.dumps({"template": "checklist/1", "items": ["inspect", "build", "review"]}))\n',
};
export const TEMPLATE_HASH = digest(JSON.stringify(TEMPLATE));

/** Whether a process exists (EPERM: it does, owned by someone else). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** Local owner-facing store. Never available to generated code or remote callers. */
export class ProductSupervisor {
  readonly root: string;
  constructor(root = resolve('.creator/products')) {
    this.root = resolve(root);
  }
  async initialize(): Promise<void> {
    await canonical(this.root, true);
    await mkdir(this.root, { recursive: true });
    await canonical(this.root);
  }
  dir(productId: string): string {
    return join(this.root, checked(id, productId));
  }
  async product(productId: string): Promise<Product> {
    const p = checked(
      productSchema,
      await readJson(join(this.dir(productId), 'product.json')),
    );
    if (
      p.id !== productId ||
      p.integration_owner !== p.binding.owner_id ||
      p.template_hash !== TEMPLATE_HASH
    )
      throw new Error('Product manifest identity mismatch');
    return p;
  }
  async task(productId: string, taskId: string): Promise<Task> {
    const t = checked(
      taskSchema,
      await readJson(
        join(this.dir(productId), 'tasks', `${checked(id, taskId)}.json`),
      ),
    );
    const p = await this.product(productId),
      frozen = p.binding.tasks.find((x) => x.key === t.key);
    if (
      t.id !== taskId ||
      t.product_id !== productId ||
      !frozen ||
      t.spec_task_hash !== frozen.hash ||
      JSON.stringify(t.file_scope) !== JSON.stringify(frozen.file_scope)
    )
      throw new Error('Task manifest no longer matches frozen specification');
    return t;
  }
  repo(productId: string): string {
    return join(this.dir(productId), 'repo');
  }
  worktree(productId: string, taskId: string): string {
    return join(this.dir(productId), 'worktrees', checked(id, taskId));
  }
  assertOwner(p: Product, owner: string): void {
    if (p.integration_owner !== owner)
      throw new Error(
        'Only the recorded integration owner can manage this product',
      );
  }
  assertBinding(p: Product, binding: Binding): void {
    if (
      JSON.stringify(p.binding) !==
      JSON.stringify(checked(bindingSchema, binding))
    )
      throw new Error(
        'Frozen specification or task hashes changed; create a new bound product',
      );
  }
  /**
   * Releases this product's locks whose recorded process is gone (a crash or a closed app
   * mid-build). A lock held by this process or by a live process is never touched, and the
   * management lock only once the integration repo is clean, so interrupted Git work is
   * left for a person. Released locks are kept beside it as evidence, with an event.
   */
  async recoverDeadLocks(productId: string): Promise<string[]> {
    const dir = this.dir(productId);
    const released: string[] = [];
    for (const [name, lock] of [
      ['builds', join(dir, 'builds', 'supervisor.lock')],
      ['product', join(dir, 'supervisor.lock')],
    ] as const) {
      const raw = await readFile(lock, 'utf8').catch(() => null);
      if (raw === null) continue;
      const pid = Number((JSON.parse(raw) as { pid?: unknown }).pid);
      if (!Number.isInteger(pid) || pid <= 0)
        throw new Error(
          `The ${name} lock names no process; recover it by hand.`,
        );
      if (pid === process.pid)
        throw new Error(`The ${name} lock is held by work running now.`);
      if (alive(pid))
        throw new Error(
          `The ${name} lock is held by a running process (${pid}); close it first.`,
        );
      if (name === 'product') {
        const repo = this.repo(productId);
        await safeTree(repo);
        await clean(repo);
      }
      await rename(
        lock,
        `${lock}.dead-${new Date().toISOString().replace(/[:.]/g, '-')}`,
      );
      await event(dir, 'lock.recovered', { lock: name, pid });
      released.push(name);
    }
    return released;
  }
  async create(
    raw: unknown,
    base?: { files: PackageFile[]; lineage: NonNullable<Product['base']> },
  ): Promise<Product> {
    const binding = checked(bindingSchema, raw);
    const files = base
      ? base.files.map((f) => [f.path, f.content.toString('utf8')] as const)
      : Object.entries(TEMPLATE);
    await this.initialize();
    const productId = randomUUID();
    const dir = this.dir(productId);
    await mkdir(dir);
    await mkdir(join(dir, 'tasks'));
    await mkdir(join(dir, 'worktrees'));
    await mkdir(join(dir, 'executions'));
    return withLock(dir, async () => {
      await event(dir, 'product.create.intent', {
        binding,
        template_hash: TEMPLATE_HASH,
        base: base?.lineage ?? null,
      });
      const repo = this.repo(productId);
      await mkdir(repo);
      await git(repo, ['init', '--initial-branch=integration']);
      for (const [path, content] of files) {
        await fileAt(repo, path);
        await newFile(join(repo, path), content);
      }
      await git(repo, ['add', '--', ...files.map(([path]) => path)]);
      await git(repo, [
        'commit',
        '-m',
        base
          ? `Revision base: verified package ${base.lineage.artifact_id}`
          : 'Reviewed checklist template v1',
      ]);
      const p: Product = {
        format: 'local-product/1',
        id: productId,
        binding,
        integration_owner: binding.owner_id,
        template_hash: TEMPLATE_HASH,
        initial_commit: await head(repo),
        git_version: await git(repo, ['--version']),
        ...(base ? { base: base.lineage } : {}),
      };
      await jsonWrite(join(dir, 'product.json'), p);
      await event(dir, 'product.create.outcome', p);
      return p;
    });
  }
  async createTask(
    productId: string,
    key: string,
    expectedBase: string,
    binding: Binding,
  ): Promise<Task> {
    const p = await this.product(productId);
    this.assertBinding(p, binding);
    checked(sha, expectedBase);
    const specTask = p.binding.tasks.find((t) => t.key === key);
    if (!specTask) throw new Error('Task absent from frozen spec');
    return withLock(this.dir(productId), async () => {
      const repo = this.repo(productId);
      await safeTree(repo);
      await clean(repo);
      if ((await head(repo)) !== expectedBase)
        throw new Error('Stale integration base');
      const t: Task = {
        id: randomUUID(),
        product_id: productId,
        key,
        base_commit: expectedBase,
        file_scope: specTask.file_scope,
        spec_task_hash: specTask.hash,
      };
      await event(this.dir(productId), 'task.create.intent', t);
      await git(repo, [
        'worktree',
        'add',
        '-b',
        `task/${t.id}`,
        this.worktree(productId, t.id),
        expectedBase,
      ]);
      await jsonWrite(join(this.dir(productId), 'tasks', `${t.id}.json`), t);
      await event(this.dir(productId), 'task.create.outcome', t);
      return t;
    });
  }
  async apply(
    productId: string,
    taskId: string,
    raw: unknown,
    binding: Binding,
  ): Promise<{ commit: string; changed_files: string[] }> {
    const p = await this.product(productId);
    this.assertBinding(p, binding);
    const t = await this.task(productId, taskId);
    const change = checked(changesSchema, raw);
    return withLock(this.dir(productId), async () => {
      const dir = this.worktree(productId, taskId);
      await safeTree(dir);
      await clean(dir);
      if ((await head(dir)) !== change.expected_commit)
        throw new Error('Stale task commit');
      const seen = new Set<string>();
      const paths: string[] = [];
      let bytes = 0;
      for (const c of change.changes) {
        if (seen.has(c.path)) throw new Error('Duplicate changed path');
        seen.add(c.path);
        if (
          !t.file_scope.some(
            (scope) => c.path === scope || c.path.startsWith(`${scope}/`),
          )
        )
          throw new Error('Task file scope exceeded');
        const full = await fileAt(dir, c.path);
        paths.push(full);
        let before: string | null = null;
        try {
          before = digest(await readFile(full));
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e;
        }
        if (before !== c.before_hash || (before === null && c.content === null))
          throw new Error('Stale file content');
        bytes += Buffer.byteLength(c.content ?? '');
      }
      if (bytes > 512 * 1024) throw new Error('Change byte limit exceeded');
      // An intent without an outcome is inspectable after a crash. Never reset it.
      const operation = randomUUID();
      await event(this.dir(productId), 'task.patch.intent', {
        operation,
        task: t,
        changes: change.changes.map((c) => ({
          path: c.path,
          before_hash: c.before_hash,
          after_hash: c.content === null ? null : digest(c.content),
        })),
        expected_commit: change.expected_commit,
      });
      for (const [i, c] of change.changes.entries()) {
        const full = paths[i]!;
        if (c.content === null) await unlink(full);
        else {
          await mkdir(resolve(full, '..'), { recursive: true });
          await fileAt(dir, c.path);
          await writeFile(full, c.content, {
            flag: c.before_hash === null ? 'wx' : 'w',
          });
        }
      }
      await safeTree(dir);
      await git(dir, ['add', '--', ...change.changes.map((c) => c.path)]);
      await git(dir, ['commit', '-m', `Task ${t.key} operation ${operation}`]);
      const result = {
        commit: await head(dir),
        changed_files: change.changes.map((c) => c.path),
      };
      await event(this.dir(productId), 'task.patch.outcome', {
        operation,
        ...result,
      });
      return result;
    });
  }
  async integrate(
    productId: string,
    taskId: string,
    expectedIntegration: string,
    expectedTask: string,
    binding: Binding,
  ): Promise<{
    state: 'integrated' | 'conflict';
    commit: string;
    merge_workspace: string;
  }> {
    const p = await this.product(productId);
    this.assertBinding(p, binding);
    this.assertOwner(p, binding.owner_id);
    const t = await this.task(productId, taskId);
    checked(sha, expectedIntegration);
    checked(sha, expectedTask);
    return withLock(this.dir(productId), async () => {
      const repo = this.repo(productId),
        taskDir = this.worktree(productId, taskId);
      await safeTree(repo);
      await safeTree(taskDir);
      await clean(repo);
      await clean(taskDir);
      if (
        (await head(repo)) !== expectedIntegration ||
        (await head(taskDir)) !== expectedTask
      )
        throw new Error('Stale integration or task commit');
      const files = (
        await git(taskDir, [
          'diff',
          '--name-only',
          '--no-ext-diff',
          '--no-textconv',
          `${t.base_commit}..${expectedTask}`,
          '--',
        ])
      )
        .split('\n')
        .filter(Boolean);
      for (const f of files) {
        await fileAt(taskDir, f);
        if (!t.file_scope.some((s) => f === s || f.startsWith(`${s}/`)))
          throw new Error('Committed task exceeds scope');
      }
      const operation = randomUUID(),
        mergeDir = join(this.dir(productId), 'worktrees', operation);
      await event(this.dir(productId), 'integration.intent', {
        operation,
        task_id: taskId,
        expectedIntegration,
        expectedTask,
        files,
      });
      await git(repo, [
        'worktree',
        'add',
        '-b',
        `integration-review/${operation}`,
        mergeDir,
        expectedIntegration,
      ]);
      try {
        await git(mergeDir, ['merge', '--no-ff', '--no-edit', expectedTask]);
      } catch (error) {
        const conflicts = await git(mergeDir, [
          'diff',
          '--name-only',
          '--diff-filter=U',
        ]);
        await event(this.dir(productId), 'integration.blocked', {
          operation,
          conflicts,
          error: String(error),
          merge_workspace: mergeDir,
        });
        if (!conflicts) throw error;
        return {
          state: 'conflict',
          commit: expectedIntegration,
          merge_workspace: mergeDir,
        };
      }
      // A conflicting merge lives in its own worktree; the integration checkout and user edits survive.
      await clean(repo);
      if ((await head(repo)) !== expectedIntegration)
        throw new Error(
          'Integration changed while merging; candidate preserved',
        );
      const commit = await head(mergeDir);
      await git(repo, ['merge', '--ff-only', commit]);
      await event(this.dir(productId), 'integration.outcome', {
        operation,
        commit,
        files,
      });
      return { state: 'integrated', commit, merge_workspace: mergeDir };
    });
  }
  /** Exact committed bytes of a clean task worktree, verified blob by blob against Git. */
  async committedFiles(
    productId: string,
    taskId: string,
    commit: string,
  ): Promise<PackageFile[]> {
    checked(sha, commit);
    const t = await this.task(productId, taskId);
    const dir = this.worktree(productId, t.id);
    await safeTree(dir);
    await clean(dir);
    if ((await head(dir)) !== commit) throw new Error('Stale execution commit');
    const entries = (await git(dir, ['ls-tree', '-r', commit]))
      .split('\n')
      .filter(Boolean);
    const files: PackageFile[] = [];
    let bytes = 0;
    if (entries.length > 100) throw new Error('Snapshot file limit exceeded');
    for (const entry of entries) {
      const match = /^100644 blob ([a-f0-9]{40})\t(.+)$/.exec(entry);
      if (!match)
        throw new Error('Only plain committed files can enter execution');
      const name = match[2]!;
      await fileAt(dir, name);
      const exact = await readFile(join(dir, name));
      // Hash-object proves the bytes read are the committed bytes, despite concurrent host edits.
      const blob = digestGitBlob(exact);
      if (blob !== match[1])
        throw new Error('Workspace changed while snapshotting');
      if (!Buffer.from(exact.toString('utf8')).equals(exact))
        throw new Error('Reviewed template accepts UTF-8 text only');
      bytes += exact.length;
      if (bytes > 512 * 1024) throw new Error('Snapshot byte limit exceeded');
      files.push({ path: name, content: exact });
    }
    return files;
  }
  async snapshot(
    productId: string,
    taskId: string,
    commit: string,
    destination: string,
  ): Promise<string> {
    const files = await this.committedFiles(productId, taskId, commit);
    for (const f of files)
      await newFile(join(destination, f.path), f.content.toString('utf8'));
    return inputHash(files);
  }
  async tasks(productId: string): Promise<Task[]> {
    return Promise.all(
      (await readdir(join(this.dir(productId), 'tasks')))
        .filter((n) => n.endsWith('.json'))
        .map(async (n) =>
          checked(
            taskSchema,
            await readJson(join(this.dir(productId), 'tasks', n)),
          ),
        ),
    );
  }
}
import { createHash } from 'node:crypto';
function digestGitBlob(bytes: Buffer): string {
  return createHash('sha1')
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest('hex');
}
/** Same identity for a worktree snapshot and a re-extracted package with identical files. */
export function inputHash(files: PackageFile[]): string {
  return digest(
    JSON.stringify(
      files.map((f) => ({ path: f.path, hash: digest(f.content) })),
    ),
  );
}
