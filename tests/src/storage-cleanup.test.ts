import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
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
  productDiskUsage,
  removeWorkspaces,
  restoreBuildWorkspace,
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
import { createApi, createStorage } from '@creator/api';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { freshDatabase, login, LOGIN_CODE } from './pg-harness.js';

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
  assert.deepEqual(report.projects[0].moved_aside, []);
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

test('review M-1 and L-5: ignored files, links, unregistered folders and a left Git lock keep a workspace', async (t) => {
  const { products, p, task, tree, inputs } = await setup(t);
  const repo = products.repo(p.id);
  const reasonOf = async (name: string) =>
    (await planWorkspaceCleanup(products, await inputs())).keep.find(
      (k) => k.name === name,
    )?.reason ?? '';
  // An ignored file (a person's exclude rule) would be deleted by `git worktree remove`.
  await mkdir(join(repo, '.git', 'info'), { recursive: true });
  await writeFile(join(repo, '.git', 'info', 'exclude'), '*.local\n');
  await writeFile(join(tree, 'src', 'my-notes.local'), 'mine');
  await age(tree, 30 * DAY);
  assert.match(await reasonOf(task.id), /ignored files/);
  await rm(join(tree, 'src', 'my-notes.local'));
  await age(tree, 30 * DAY);
  // A Git step left its lock in the workspace's admin folder.
  const lock = join(repo, '.git', 'worktrees', task.id, 'index.lock');
  await writeFile(lock, '');
  assert.match(await reasonOf(task.id), /interrupted/);
  await rm(lock);
  // A link named like a workspace, and a folder Git doesn't know.
  const linked = randomUUID();
  await symlink(tree, join(products.dir(p.id), 'worktrees', linked));
  assert.match(await reasonOf(linked), /Not a plain folder/);
  const loose = randomUUID();
  await mkdir(join(products.dir(p.id), 'worktrees', loose));
  // No `.git` file: Git can't open it, so the advice says what to do (review L-7).
  assert.match(await reasonOf(loose), /Git can no longer open it/);
  const plan = await planWorkspaceCleanup(products, await inputs());
  assert.deepEqual(
    plan.remove.map((r) => r.name),
    [task.id],
  );
  // Projects whose product record can't be read are listed only for the studio owner (N-3).
  const broken = randomUUID();
  await mkdir(join(products.root, broken, 'worktrees', randomUUID()), {
    recursive: true,
  });
  const keepFor = async (includeUnreadable: boolean) =>
    (
      await planWorkspaceCleanup(products, await inputs({ includeUnreadable }))
    ).keep.filter((k) => k.product_id === broken).length;
  assert.equal(await keepFor(false), 0);
  assert.equal(await keepFor(true), 1);
});

test('review M-2: a removal Git could not finish is moved aside, and the task checkout comes back', async (t) => {
  const { products, p, task, built, tree, inputs } = await setup(t);
  const o = await inputs();
  const plan = await planWorkspaceCleanup(products, o);
  assert.equal(plan.remove.length, 1);
  // A file nothing may delete (like one held open on Windows) makes Git's delete fail part-way.
  const stuck = join(tree, 'src', 'main.py');
  const chattr = async (flag: string, path: string) =>
    promisify(execFile)('chattr', [flag, path]).then(
      () => true,
      () => false,
    );
  const asideDir = join(products.dir(p.id), 'worktrees-removed');
  // Clears the flag wherever the file ended up, so the test folder can be deleted.
  const unstick = async () => {
    await chattr('-i', stuck);
    for (const n of await readdir(asideDir).catch(() => [] as string[]))
      await chattr('-i', join(asideDir, n, 'src', 'main.py'));
  };
  if (!(await chattr('+i', stuck))) {
    t.diagnostic(
      'chattr is not available here; the failed-removal path was not exercised',
    );
  } else {
    let out;
    try {
      out = await removeWorkspaces(products, plan.remove, o);
    } finally {
      await unstick();
    }
    assert.equal(out.removed.length, 0);
    assert.equal(out.failed.length, 1);
    assert.match(out.failed[0]!.reason, /moved to worktrees-removed\//);
    assert.equal(await exists(tree), false);
    assert.equal((await readdir(asideDir)).length, 1);
    assert.equal(await products.taskHead(p.id, task.id), built.commit);
    assert.equal(await restoreTaskWorkspace(products, p.id, task.id), true);
    assert.equal(await git(tree, ['rev-parse', 'HEAD']), built.commit);
  }
  // A half-removed folder whose registration Git already dropped is moved aside on restore.
  await git(products.repo(p.id), ['worktree', 'remove', tree]).catch(
    () => undefined,
  );
  await mkdir(join(tree, 'src'), { recursive: true });
  await writeFile(join(tree, 'src', 'left.txt'), 'leftover');
  assert.equal(await restoreTaskWorkspace(products, p.id, task.id), true);
  assert.equal(await git(tree, ['rev-parse', 'HEAD']), built.commit);
  assert.equal(await git(tree, ['status', '--porcelain']), '');
  assert.ok(
    (await readdir(join(products.dir(p.id), 'worktrees-removed'))).length >= 1,
  );
});

test('review L-7: a leftover that could not be moved aside gets advice that works, and moved-aside folders are measured', async (t) => {
  const { products, p, task, built, tree, inputs } = await setup(t);
  const o = await inputs();
  const plan = await planWorkspaceCleanup(products, o);
  const stuck = join(tree, 'src', 'main.py');
  const chattr = async (flag: string) =>
    promisify(execFile)('chattr', [flag, stuck]).then(
      () => true,
      () => false,
    );
  if (!(await chattr('+i'))) {
    t.diagnostic('chattr is not available here; this path was not exercised');
    return;
  }
  // Something already sits where moved-aside folders go, so the move fails too.
  const asideDir = join(products.dir(p.id), 'worktrees-removed');
  await writeFile(asideDir, 'in the way');
  let out;
  try {
    out = await removeWorkspaces(products, plan.remove, o);
  } finally {
    await chattr('-i');
  }
  assert.equal(out.failed.length, 1);
  assert.match(out.failed[0]!.reason, /could not be moved aside/);
  assert.match(out.failed[0]!.reason, /build that task again/);
  assert.doesNotMatch(out.failed[0]!.reason, /run the cleanup again/);
  // The next plan names it as a leftover with the same advice, not as an unknown folder.
  await age(tree, 30 * DAY);
  const again = await planWorkspaceCleanup(products, o);
  assert.equal(again.remove.length, 0);
  assert.match(
    again.keep.find((k) => k.name === task.id)?.reason ?? '',
    /failed part-way.*build that task again/,
  );
  // Review N-6: reading a build's status never moves anything, even a leftover.
  const buildId = randomUUID();
  await mkdir(join(products.dir(p.id), 'builds', buildId), { recursive: true });
  await writeFile(
    join(products.dir(p.id), 'builds', buildId, 'intent.json'),
    JSON.stringify({ task_id: task.id }),
  );
  await rm(asideDir);
  assert.equal(
    await restoreBuildWorkspace(products, p.id, buildId, {
      onlyIfMissing: true,
    }),
    false,
  );
  assert.equal(await exists(asideDir), false);
  assert.equal(await exists(stuck), true);
  // Building the task again moves it aside once nothing is in the way.
  assert.equal(await restoreTaskWorkspace(products, p.id, task.id), true);
  assert.equal(await git(tree, ['rev-parse', 'HEAD']), built.commit);
  const [usage] = await productDiskUsage(products);
  assert.equal(usage!.moved_aside?.count, 1);
  assert.ok(usage!.moved_aside!.bytes > 0);
  assert.equal(usage!.moved_aside!.folder, asideDir);
});

test('review L-6: a checkout that opens is never moved aside, whatever Git lists', async (t) => {
  const { products, p, task, tree, inputs } = await setup(t);
  const repo = products.repo(p.id);
  // A person's uncommitted work in the checkout.
  await writeFile(join(tree, 'src', 'wip.py'), 'not committed\n');
  const stillThere = async () => {
    assert.equal(await exists(join(tree, 'src', 'wip.py')), true);
    assert.equal(
      await exists(join(products.dir(p.id), 'worktrees-removed')),
      false,
    );
  };
  // Git records the checkout under another path (a store reached by another path).
  const gitdirFile = join(repo, '.git', 'worktrees', task.id, 'gitdir');
  const recorded = await readFile(gitdirFile, 'utf8');
  await writeFile(gitdirFile, '/somewhere/else/.git\n');
  assert.equal(await restoreTaskWorkspace(products, p.id, task.id), false);
  await stillThere();
  const kept = async () =>
    (await planWorkspaceCleanup(products, await inputs())).keep.find(
      (k) => k.name === task.id,
    )?.reason ?? '';
  assert.match(await kept(), /^Not a registered Git workspace/);
  await writeFile(gitdirFile, recorded);
  // `worktree list` itself fails: a broken shared config breaks every Git call.
  const config = join(repo, '.git', 'config');
  const good = await readFile(config, 'utf8');
  await writeFile(config, `${good}\n[broken\n`);
  try {
    assert.equal(await restoreTaskWorkspace(products, p.id, task.id), false);
    await stillThere();
    assert.match(await kept(), /could not list/);
  } finally {
    await writeFile(config, good);
  }
  // The work is still in the checkout, where the build's own check finds it and says why.
  assert.notEqual(await git(tree, ['status', '--porcelain']), '');
});

test('the storage routes need a signed-in session, and cleanup needs the CSRF token', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const parent = resolve('.verification/storage-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'api-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
    CREATOR_PRODUCTS_ROOT: join(root, 'products'),
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  assert.equal((await fetch(`${base}/storage`)).status, 401);
  const auth = await login(base);
  const report = await fetch(`${base}/storage`, { headers: auth.read });
  assert.equal(report.status, 200);
  const body = (await report.json()) as { cleanup: { plan_hash: string } };
  const post = (headers: Record<string, string>) =>
    fetch(`${base}/storage/cleanup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({
        older_than_days: 14,
        plan_hash: body.cleanup.plan_hash,
        confirmation: STORAGE_CLEANUP_CONFIRMATION,
      }),
    });
  assert.equal((await post(auth.read)).status, 403);
  // Signed in with the token: refused only because there is nothing to remove.
  const done = await post(auth.write);
  assert.equal(done.status, 409);
  assert.match(JSON.stringify(await done.json()), /no old build workspaces/);
});

test('review L-4: an intent with no outcome shows as interrupted in history', async (t) => {
  const { products } = await setup(t);
  const at = new Date().toISOString();
  const ev = (action: string, plan_hash: string) => ({
    id: randomUUID(),
    occurred_at: at,
    action,
    payload: { plan_hash, remove: [{}], removed: [{}], failed: [] },
  });
  // Newest first, as the store returns them.
  const events = [
    ev('storage.cleanup.outcome', 'b'),
    ev('storage.cleanup.intent', 'b'),
    ev('storage.cleanup.intent', 'a'),
  ];
  const store = {
    ownedWorkspaces: async () => [],
    studyWorkspaces: async () => new Set<string>(),
    verifiedPackages: async () => [],
    cleanupHistory: async () => events,
  } as unknown as StorageStore;
  const routes = createStorage({
    store,
    products,
    studioRoots: { plan: products.root, recipe: products.root },
    ownerId: randomUUID(),
    ensureReady: async () => {},
    requireSession: async () => ({ actor_id: randomUUID() }) as SessionInfo,
  });
  const r = (await routes.route(
    { method: 'GET' } as IncomingMessage,
    new URL('http://x/api/storage'),
    async () => undefined,
  ))!.value as { history: { action: string; interrupted: boolean }[] };
  assert.deepEqual(
    r.history.map((h) => h.interrupted),
    [false, false, true],
  );
});
