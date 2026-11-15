import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  rm,
  utimes,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { IncomingMessage } from 'node:http';
import {
  ProductSupervisor,
  TEMPLATE,
  checkPackages,
  cleanupPlanHash,
  digest,
  planWorkspaceCleanup,
  removeWorkspaces,
  restoreTaskWorkspace,
  type Binding,
  type CleanupInputs,
  type PackageRef,
} from '@creator/executor';
import {
  ContractError,
  STORAGE_CLEANUP_CONFIRMATION,
  type SessionInfo,
} from '@creator/contracts';
import { StorageStore, STORAGE_SUBJECT_ID } from '@creator/db';
import { createStorage } from '@creator/api';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { freshDatabase } from './pg-harness.js';

const DAY = 86_400_000;
const git = async (cwd: string, args: string[]) =>
  (await promisify(execFile)('git', args, { cwd })).stdout.trim();

async function age(path: string, ms: number) {
  const t = new Date(Date.now() - ms);
  const st = await lstat(path);
  if (st.isDirectory())
    for (const n of await readdir(path)) await age(join(path, n), ms);
  if (!st.isSymbolicLink()) await utimes(path, t, t);
}
const exists = (p: string) =>
  lstat(p).then(
    () => true,
    () => false,
  );

async function setup(t: test.TestContext) {
  const parent = resolve('.verification/storage-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(root.startsWith(parent));
    await rm(root, { recursive: true, force: true });
  });
  const products = new ProductSupervisor(join(root, 'products'));
  const ws = randomUUID();
  const binding: Binding = {
    workspace_id: ws,
    owner_id: randomUUID(),
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: digest('spec'),
    freeze_id: randomUUID(),
    tasks: [{ key: 'T1', hash: digest('task1'), file_scope: ['src'] }],
  };
  const p = await products.create(binding);
  const task = await products.createTask(p.id, 'T1', p.initial_commit, binding);
  const built = await products.apply(
    p.id,
    task.id,
    {
      expected_commit: p.initial_commit,
      changes: [
        {
          path: 'src/main.py',
          before_hash: digest(TEMPLATE['src/main.py']),
          content: 'print("built")\n',
        },
      ],
    },
    binding,
  );
  // A verified package of the task's latest commit, as the database would record it.
  const artifactId = randomUUID();
  const pkgDir = join(products.dir(p.id), 'artifacts', artifactId);
  await mkdir(pkgDir, { recursive: true });
  await writeFile(join(pkgDir, 'manifest.json'), '{"manifest":1}');
  await writeFile(join(pkgDir, 'source.tar'), 'archive bytes');
  const pkg: PackageRef = {
    artifact_id: artifactId,
    product_id: p.id,
    task_id: task.id,
    commit: built.commit,
    manifest_sha256: digest('{"manifest":1}'),
    archive_sha256: digest('archive bytes'),
  };
  const tree = products.worktree(p.id, task.id);
  await age(tree, 30 * DAY);
  const inputs = async (
    over: Partial<CleanupInputs> = {},
  ): Promise<CleanupInputs> => ({
    packages: [pkg],
    checks: await checkPackages(products, [pkg]),
    protectedWorkspaces: new Set(),
    workspaces: new Set([ws]),
    olderThanDays: 14,
    now: new Date(),
    ...over,
  });
  return {
    root,
    products,
    binding,
    p,
    task,
    built,
    pkg,
    pkgDir,
    tree,
    ws,
    inputs,
  };
}

test('cleanup removes an old, packaged, clean task workspace; its commit stays on its branch and comes back on demand', async (t) => {
  const { products, p, task, built, tree, inputs } = await setup(t);
  const o = await inputs();
  const plan = await planWorkspaceCleanup(products, o);
  assert.equal(plan.remove.length, 1, JSON.stringify(plan.keep));
  assert.equal(plan.remove[0]!.name, task.id);
  assert.equal(plan.remove[0]!.kind, 'task');
  assert.equal(plan.remove[0]!.head, built.commit);
  assert.ok(plan.remove[0]!.bytes > 0);

  const out = await removeWorkspaces(products, plan.remove, o);
  assert.deepEqual(out.failed, []);
  assert.equal(out.removed.length, 1);
  assert.equal(await exists(tree), false);
  // Commits survive on the task's branch; the next build continues from the same commit.
  assert.equal(
    await git(products.repo(p.id), ['rev-parse', `task/${task.id}`]),
    built.commit,
  );
  assert.equal(await products.taskHead(p.id, task.id), built.commit);
  // Packages untouched.
  assert.ok((await checkPackages(products, o.packages)).every((c) => c.ok));
  // Nothing left to plan.
  assert.equal((await planWorkspaceCleanup(products, o)).remove.length, 0);

  assert.equal(await restoreTaskWorkspace(products, p.id, task.id), true);
  assert.equal(await restoreTaskWorkspace(products, p.id, task.id), false);
  assert.equal(await products.taskHead(p.id, task.id), built.commit);
  assert.equal(await git(tree, ['status', '--porcelain']), '');
});

test('cleanup keeps workspaces it cannot prove are safe to remove, and says why', async (t) => {
  const { products, p, task, tree, pkg, pkgDir, ws, inputs } = await setup(t);
  const reasons = async (over: Partial<CleanupInputs> = {}) => {
    const plan = await planWorkspaceCleanup(products, await inputs(over));
    assert.equal(plan.remove.length, 0);
    return plan.keep.map((k) => k.reason).join(' | ');
  };
  // Not the person's project: not listed at all.
  const other = await planWorkspaceCleanup(
    products,
    await inputs({ workspaces: new Set([randomUUID()]) }),
  );
  assert.deepEqual(other, { remove: [], keep: [] });
  assert.match(
    await reasons({ protectedWorkspaces: new Set([ws]) }),
    /thesis study/,
  );
  assert.match(await reasons({ olderThanDays: 60 }), /last 60 days/);
  assert.match(await reasons({ packages: [] }), /No verified package/);
  assert.match(
    await reasons({ packages: [{ ...pkg, commit: 'f'.repeat(40) }] }),
    /No verified package/,
  );
  // A package whose archive changed on disk protects its workspace.
  await writeFile(join(pkgDir, 'source.tar'), 'tampered');
  assert.match(await reasons(), /does not match its recorded hashes/);
  await writeFile(join(pkgDir, 'source.tar'), 'archive bytes');
  // Uncommitted work is never removed.
  await writeFile(join(tree, 'src', 'notes.txt'), 'mine');
  await age(tree, 30 * DAY);
  assert.match(await reasons(), /not committed/);
  await rm(join(tree, 'src', 'notes.txt'));
  // Removing it touched the folder; recent changes keep it until it ages again.
  assert.match(await reasons(), /last 14 days/);
  await age(tree, 30 * DAY);
  // A running build holds the build lock.
  await mkdir(join(products.dir(p.id), 'builds'), { recursive: true });
  const lock = join(products.dir(p.id), 'builds', 'supervisor.lock');
  await writeFile(lock, '{}');
  assert.match(await reasons(), /build or Git step is running/);
  await rm(lock);
  // A stray folder the studio didn't make.
  await mkdir(join(products.dir(p.id), 'worktrees', 'stray'));
  const plan = await planWorkspaceCleanup(products, await inputs());
  assert.equal(plan.remove.length, 1);
  assert.equal(plan.remove[0]!.name, task.id);
  assert.match(
    plan.keep.find((k) => k.name === 'stray')!.reason,
    /Not a folder the studio made/,
  );
});

test('removal judges each workspace again: one that moved since the confirmation is left alone', async (t) => {
  const { products, binding, p, task, built, tree, inputs } = await setup(t);
  const o = await inputs();
  const plan = await planWorkspaceCleanup(products, o);
  assert.equal(plan.remove.length, 1);
  await products.apply(
    p.id,
    task.id,
    {
      expected_commit: built.commit,
      changes: [
        {
          path: 'src/main.py',
          before_hash: digest('print("built")\n'),
          content: 'print("newer")\n',
        },
      ],
    },
    binding,
  );
  const out = await removeWorkspaces(products, plan.remove, o);
  assert.equal(out.removed.length, 0);
  assert.equal(out.failed.length, 1);
  assert.equal(await exists(tree), true);
  // The plan hash changes with the list, so a confirmation of the old list no longer binds.
  assert.notEqual(
    cleanupPlanHash(14, plan.remove),
    cleanupPlanHash(14, (await planWorkspaceCleanup(products, o)).remove),
  );
});

test('the storage route asks for a confirmation of the exact list, records intent and outcome, and checks packages after', async (t) => {
  const { products, ws, pkg, tree } = await setup(t);
  const events: { action: string; payload: Record<string, unknown> }[] = [];
  const store = {
    ownedWorkspaces: async () => [
      {
        workspace_id: ws,
        name: 'Synthetic project',
        fixture: true,
        files: 12,
        previews_live: 0,
        previews_ended: 2,
        study: false,
      },
    ],
    studyWorkspaces: async () => new Set<string>(),
    verifiedPackages: async () => [{ ...pkg, workspace_id: ws }],
    recordCleanup: async (
      _ctx: unknown,
      action: string,
      payload: Record<string, unknown>,
    ) => {
      // The intent is on record before anything is removed.
      if (action === 'storage.cleanup.intent')
        assert.equal(await exists(tree), true);
      events.push({ action, payload });
      return randomUUID();
    },
    cleanupHistory: async () => [],
  } as unknown as StorageStore;
  const ownerId = randomUUID();
  const session = { actor_id: ownerId } as SessionInfo;
  const routes = createStorage({
    store,
    products,
    studioRoots: {
      plan: join(products.root, 'none'),
      recipe: join(products.root, 'none'),
    },
    ownerId,
    ensureReady: async () => {},
    requireSession: async () => session,
  });
  const call = async (path: string, body?: unknown) => {
    const req = {
      method: body === undefined ? 'GET' : 'POST',
    } as IncomingMessage;
    return routes.route(req, new URL(`http://x${path}`), async () => body);
  };
  const report = (await call('/api/storage'))!.value as any;
  assert.equal(report.projects[0].build_workspace_count, 1);
  assert.equal(report.projects[0].verified_packages, 1);
  assert.equal(report.projects[0].files, 12);
  assert.equal(report.studio.length, 3);
  assert.equal(report.cleanup.remove.length, 1);
  const body = {
    older_than_days: 14,
    plan_hash: report.cleanup.plan_hash,
    confirmation: STORAGE_CLEANUP_CONFIRMATION,
  };
  // No typed confirmation, no cleanup.
  await assert.rejects(
    call('/api/storage/cleanup', { ...body, confirmation: 'yes' }),
    (e: unknown) => e instanceof ContractError && e.code === 'INVALID_CONTRACT',
  );
  // A confirmation of a different list is refused.
  await assert.rejects(
    call('/api/storage/cleanup', { ...body, plan_hash: 'a'.repeat(64) }),
    (e: unknown) => e instanceof ContractError && e.code === 'VERSION_CONFLICT',
  );
  assert.equal(events.length, 0);
  assert.equal(await exists(tree), true);
  const done = (await call('/api/storage/cleanup', body))!.value as any;
  assert.equal(done.removed.length, 1);
  assert.equal(done.packages_checked, 1);
  assert.deepEqual(done.packages_changed, []);
  assert.equal(await exists(tree), false);
  assert.deepEqual(
    events.map((e) => e.action),
    ['storage.cleanup.intent', 'storage.cleanup.outcome'],
  );
  assert.equal(events[1]!.payload.plan_hash, report.cleanup.plan_hash);
  // Nothing left: a second confirmation of the same list is refused.
  await assert.rejects(
    call('/api/storage/cleanup', body),
    (e: unknown) => e instanceof ContractError,
  );
  // Someone other than the studio owner does not see studio-wide folders.
  const other = createStorage({
    store,
    products,
    studioRoots: { plan: products.root, recipe: products.root },
    ownerId: randomUUID(),
    ensureReady: async () => {},
    requireSession: async () => session,
  });
  const r = (await other.route(
    { method: 'GET' } as IncomingMessage,
    new URL('http://x/api/storage'),
    async () => undefined,
  ))!.value as any;
  assert.deepEqual(r.studio, []);
});

test('storage store lists only owned workspaces and keeps cleanups in the hash-chained audit', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new StorageStore(db.pool);
  const owner = randomUUID();
  const stranger = randomUUID();
  for (const a of [owner, stranger])
    await db.pool.query(
      `insert into actors (id, kind, display_name) values ($1, 'human', 'Synthetic')`,
      [a],
    );
  const ws = randomUUID();
  await db.pool.query(
    `insert into workspaces (id, name, record_mode, fixture, created_by) values ($1, 'Mine', 'fixture', true, $2)`,
    [ws, owner],
  );
  await db.pool.query(
    `insert into workspace_members (workspace_id, actor_id, role) values ($1, $2, 'owner'), ($1, $3, 'viewer')`,
    [ws, owner, stranger],
  );
  const mine = await store.ownedWorkspaces({ actorId: owner });
  assert.deepEqual(mine, [
    {
      workspace_id: ws,
      name: 'Mine',
      fixture: true,
      files: 0,
      previews_live: 0,
      previews_ended: 0,
      study: false,
    },
  ]);
  assert.deepEqual(await store.ownedWorkspaces({ actorId: stranger }), []);
  assert.deepEqual(await store.verifiedPackages(), []);
  assert.equal((await store.studyWorkspaces()).size, 0);
  await store.recordCleanup({ actorId: owner }, 'storage.cleanup.intent', {
    remove: [{ name: 'x' }],
  });
  await store.recordCleanup({ actorId: owner }, 'storage.cleanup.outcome', {
    removed: [{ name: 'x' }],
    failed: [],
    bytes_freed: 10,
  });
  const history = await store.cleanupHistory({ actorId: owner });
  assert.deepEqual(
    history.map((h) => h.action),
    ['storage.cleanup.outcome', 'storage.cleanup.intent'],
  );
  assert.deepEqual(await store.cleanupHistory({ actorId: stranger }), []);
  const { rows } = await db.pool.query(
    'select count(*)::int as n from audit_events where subject_id = $1',
    [STORAGE_SUBJECT_ID],
  );
  assert.equal(rows[0].n, 2);
  assert.equal((await store.verifyAuditChain()).ok, true);
});

async function loadWeb<T>(file: string) {
  const ts = (await import('typescript')).default;
  const { readFile } = await import('node:fs/promises');
  const code = ts.transpileModule(
    await readFile(`apps/web/src/${file}`, 'utf8'),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  const exports = {} as T;
  new Function('exports', code)(exports);
  return exports;
}

test('Monitor lists Storage in every view mode, and the page says sizes and results in words', async () => {
  const pages = await loadWeb<{
    PAGES: { key: string; sections: { view: string; slug: string }[] }[];
    parseRoute: (h: string) => { view: string };
    shownSections: (p: unknown, standard: boolean) => { view: string }[];
  }>('pages.ts');
  const monitor = pages.PAGES.find((p) => p.key === 'monitor')!;
  assert.ok(monitor.sections.some((s) => s.view === 'storage'));
  assert.equal(pages.parseRoute('#/monitor/storage').view, 'storage');
  assert.ok(
    pages.shownSections(monitor, true).some((s) => s.view === 'storage'),
  );
  const text = await loadWeb<{
    sizeText: (n: number | null) => string;
    removeLabel: (c: number, b: number) => string;
    resultText: (r: {
      removed: number;
      failed: number;
      bytes_freed: number;
      packages_changed: number;
    }) => string;
  }>('storage-text.ts');
  assert.equal(text.sizeText(0), '0 bytes');
  assert.equal(text.sizeText(1536), '1.5 KB');
  assert.equal(text.sizeText(20 * 1024 * 1024), '20 MB');
  assert.equal(text.sizeText(null), 'not measured');
  assert.equal(text.removeLabel(1, 2048), 'Remove 1 build workspace (2.0 KB)');
  assert.match(
    text.resultText({
      removed: 2,
      failed: 0,
      bytes_freed: 4096,
      packages_changed: 0,
    }),
    /Removed 2 build workspaces, freeing 4.0 KB\. Every verified package still matches/,
  );
  assert.match(
    text.resultText({
      removed: 0,
      failed: 1,
      bytes_freed: 0,
      packages_changed: 1,
    }),
    /1 was left alone.*1 verified package no longer matches its recorded hashes/,
  );
});

test('a finished merge workspace whose merge is in the repository can go; its branch keeps the commit', async (t) => {
  const { products, binding, p, task, built, inputs } = await setup(t);
  const merged = await products.integrate(
    p.id,
    task.id,
    p.initial_commit,
    built.commit,
    binding,
  );
  assert.equal(merged.state, 'integrated');
  await age(merged.merge_workspace, 30 * DAY);
  const o = await inputs();
  const plan = await planWorkspaceCleanup(products, o);
  const merge = plan.remove.find((r) => r.kind === 'merge');
  assert.ok(merge, JSON.stringify(plan.keep));
  const out = await removeWorkspaces(products, [merge], o);
  assert.equal(out.removed.length, 1);
  assert.equal(await exists(merged.merge_workspace), false);
  assert.equal(
    await git(products.repo(p.id), [
      'rev-parse',
      `integration-review/${merge.name}`,
    ]),
    merged.commit,
  );
});
