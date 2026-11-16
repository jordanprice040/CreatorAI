import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { createApi, createBackups, insideFolder } from '@creator/api';
import {
  BackupStore,
  checkBackup,
  listBackups,
  migrations,
  backupTag,
  pruneDailyBackups,
} from '@creator/db';
import type { BackupsView, BackupRun } from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0123 (F1): Settings › Backups. The same T17 backup as `pnpm backup create`, owner-only,
// one job at a time, a daily backup attempted at most once per UTC day across restarts, and
// restore only into a new database and folder after every hash is checked.

const pgBinDir = process.env.CREATOR_PG_BIN || undefined;
async function havePgDump(t: TestContext) {
  try {
    await promisify(execFile)(
      pgBinDir ? join(pgBinDir, 'pg_dump') : 'pg_dump',
      ['--version'],
    );
    return true;
  } catch {
    t.skip(
      'Backups not run: pg_dump not found (install PostgreSQL client tools or set CREATOR_PG_BIN)',
    );
    return false;
  }
}
async function scratch(t: TestContext) {
  const parent = resolve('.verification/f1-backups');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  return dir;
}
const json = { 'Content-Type': 'application/json' };

test('F1-1: owner backs up from Settings (same manifest as pnpm backup), checks it and restores into a new copy; others are refused', async (t) => {
  // Registered first so the API closes before the test database is dropped.
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db || !(await havePgDump(t))) return;
  const dir = await scratch(t);
  const products = join(dir, 'products');
  await mkdir(join(products, 'p1'), { recursive: true });
  await writeFile(join(products, 'p1', 'note.txt'), 'kept');
  const backupsDir = join(dir, 'backups');
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_PRODUCTS_ROOT: products,
    CREATOR_BACKUPS_DIR: backupsDir,
    ...(pgBinDir ? { CREATOR_PG_BIN: pgBinDir } : {}),
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const store = api.store!;
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const a = await login(base);
  // The first person to create a workspace is the studio owner (ADR-0113's record).
  const ws = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { ...json, ...a.write },
    body: JSON.stringify({ name: 'Backed up', record_mode: 'real' }),
  });
  assert.equal(ws.status, 201);
  // B, another human who owns a workspace of their own, is refused everything here.
  const bId = randomUUID();
  await store.ensureActor({ id: bId, kind: 'human', display_name: 'B' });
  const bs = await store.createSession(bId, 'dev_local', null, 1);
  const b = {
    read: { Cookie: `creator_session=${bs.token}` },
    write: {
      Cookie: `creator_session=${bs.token}`,
      'X-CSRF-Token': bs.session.csrf_token,
    },
  };
  await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { ...json, ...b.write },
    body: JSON.stringify({ name: 'B', record_mode: 'real' }),
  });
  const refused = await fetch(`${base}/settings/backups`, { headers: b.read });
  assert.equal(refused.status, 403);
  const refusedRun = await fetch(`${base}/settings/backups/runs`, {
    method: 'POST',
    headers: { ...json, ...b.write },
    body: '{}',
  });
  assert.equal(refusedRun.status, 403);
  assert.equal(
    (await fetch(`${base}/settings/backups`)).status,
    401,
    'no session, no backups',
  );

  const read = async () => {
    const r = await fetch(`${base}/settings/backups`, { headers: a.read });
    assert.equal(r.status, 200);
    return (await r.json()) as BackupsView;
  };
  const post = (path: string, body: unknown = {}) =>
    fetch(`${base}/settings/backups${path}`, {
      method: 'POST',
      headers: { ...json, ...a.write },
      body: JSON.stringify(body),
    });
  const settle = async () => {
    await api.backups.idle();
    return read();
  };

  // Defaults: daily on, keep 7, the configured folder (not created until first used).
  const first = await read();
  assert.deepEqual(
    {
      v: first.settings.version,
      d: first.settings.daily_enabled,
      k: first.settings.keep_daily,
      f: first.settings.folder,
    },
    { v: 0, d: true, k: 7, f: backupsDir },
  );
  assert.equal(first.backups.length, 0);
  assert.match(first.folder_problem ?? '', /does not exist yet/);

  // Back up now: a recorded job; the finished folder holds the T17 manifest.
  const started = await post('/runs');
  assert.equal(started.status, 202);
  const run = ((await started.json()) as { run: BackupRun }).run;
  assert.equal(run.status, 'running');
  assert.equal(run.trigger, 'manual');
  const afterBackup = await settle();
  assert.equal(
    afterBackup.runs[0]!.status,
    'succeeded',
    afterBackup.runs[0]!.error ?? '',
  );
  assert.equal(afterBackup.backups.length, 1);
  const entry = afterBackup.backups[0]!;
  assert.equal(entry.kind, 'manual');
  assert.equal(entry.restorable, true);
  assert.equal(entry.product_files, 1);
  assert.equal(entry.schema_version, migrations.at(-1)!.version);
  // No partial folder is left behind.
  assert.deepEqual(await readdir(backupsDir), [entry.name]);
  const manifest = await checkBackup(join(backupsDir, entry.name));
  assert.equal(manifest.format, 'creator-backup/1');
  assert.deepEqual(
    manifest.products.map((p) => p.path),
    ['p1/note.txt'],
  );
  assert.ok(manifest.totals, 'snapshot totals, as pnpm backup create writes');
  assert.ok(manifest.counts.backup_runs! >= 1);

  // Check: re-hashes every file.
  assert.equal((await post(`/${entry.name}/check`)).status, 202);
  const checked = await settle();
  assert.equal(checked.runs[0]!.trigger, 'check');
  assert.equal(checked.runs[0]!.status, 'succeeded');
  // A changed byte is caught by the same check.
  await writeFile(
    join(backupsDir, entry.name, 'products', 'p1', 'note.txt'),
    'changed',
  );
  await post(`/${entry.name}/check`);
  const tampered = await settle();
  assert.equal(tampered.runs[0]!.status, 'failed');
  assert.match(
    tampered.runs[0]!.error ?? '',
    /does not match the backup manifest/,
  );
  await writeFile(
    join(backupsDir, entry.name, 'products', 'p1', 'note.txt'),
    'kept',
  );

  // Restore refuses the studio's own database, a folder inside the product store, unknown
  // backups and path tricks before any job starts.
  const own = new URL(db.url).pathname.slice(1);
  const ownDb = await post(`/${entry.name}/restore`, {
    database_name: own,
    products_root: join(dir, 'restored'),
  });
  assert.equal(ownDb.status, 400);
  const nested = await post(`/${entry.name}/restore`, {
    database_name: `${own}_r`,
    products_root: join(products, 'inner'),
  });
  assert.equal(nested.status, 400);
  // Review M-1: system and template databases are never a target, even though empty.
  for (const system of ['template1', 'postgres', 'template0']) {
    const r = await post(`/${entry.name}/restore`, {
      database_name: system,
      products_root: join(dir, 'restored'),
    });
    assert.equal(r.status, 400, system);
    assert.match(
      ((await r.json()) as { error: { message: string } }).error.message,
      /system database/,
    );
  }
  // Review N-6: a malformed escape is a bad request, not a server failure.
  assert.equal((await post('/%E0/check')).status, 400);
  assert.equal(
    (
      await post('/..%2F..%2Fetc/restore', {
        database_name: `${own}_r`,
        products_root: join(dir, 'restored'),
      })
    ).status,
    400,
  );
  assert.equal(
    (
      await post('/manual-nope/restore', {
        database_name: `${own}_r`,
        products_root: join(dir, 'restored'),
      })
    ).status,
    404,
  );

  // A non-empty target folder: the job fails, and the database it created is dropped again.
  const busyFolder = join(dir, 'busy');
  await mkdir(busyFolder, { recursive: true });
  await writeFile(join(busyFolder, 'x.txt'), 'x');
  const failName = `${own}_fail`;
  assert.equal(
    (
      await post(`/${entry.name}/restore`, {
        database_name: failName,
        products_root: busyFolder,
      })
    ).status,
    202,
  );
  const failed = await settle();
  assert.equal(failed.runs[0]!.status, 'failed');
  assert.match(failed.runs[0]!.error ?? '', /not empty/);
  const admin = new pg.Pool({ connectionString: db.url, max: 1 });
  admin.on('error', () => undefined);
  t.after(() => admin.end());
  const exists = async (name: string) =>
    (await admin.query('select 1 from pg_database where datname = $1', [name]))
      .rows.length === 1;
  assert.equal(await exists(failName), false);
  assert.equal(await readFile(join(busyFolder, 'x.txt'), 'utf8'), 'x');

  // A good restore: new database and folder, verified; the studio in use is untouched.
  const restoredName = `${own}_r`;
  t.after(async () => {
    const p = new pg.Pool({
      connectionString: process.env.CREATOR_TEST_DATABASE_URL,
      max: 1,
    });
    p.on('error', () => undefined);
    await p.query(`drop database if exists "${restoredName}" with (force)`);
    await p.end();
  });
  const restoredFolder = join(dir, 'restored', 'products');
  assert.equal(
    (
      await post(`/${entry.name}/restore`, {
        database_name: restoredName,
        products_root: restoredFolder,
      })
    ).status,
    202,
  );
  const restored = await settle();
  const r = restored.runs[0]!;
  assert.equal(r.status, 'succeeded', r.error ?? '');
  assert.equal(r.result!.database_name, restoredName);
  assert.equal(r.result!.audit_chain_ok, true);
  assert.equal(r.result!.workspaces, 2);
  assert.equal(
    await readFile(join(restoredFolder, 'p1', 'note.txt'), 'utf8'),
    'kept',
  );
  // The restored copy carries the backup's own run as running; a studio started on it
  // records that run as interrupted, never as finished.
  const copyUrl = new URL(db.url);
  copyUrl.pathname = `/${restoredName}`;
  const copy = new pg.Pool({ connectionString: copyUrl.toString(), max: 1 });
  copy.on('error', () => undefined);
  const copyStore = new BackupStore(copy);
  assert.equal(await copyStore.sweepInterrupted(), 1);
  assert.equal((await copyStore.runs()).running, null);
  await copy.end();

  // Settings: version-bound, folder must be absolute and outside the product store.
  const bad = await post('/settings', {
    expected_version: 0,
    daily_enabled: false,
    keep_daily: 3,
    folder: 'relative/folder',
  });
  assert.equal(bad.status, 400);
  const inside = await post('/settings', {
    expected_version: 0,
    daily_enabled: false,
    keep_daily: 3,
    folder: join(products, 'backups'),
  });
  assert.equal(inside.status, 400);
  const other = join(dir, 'elsewhere');
  const saved = await post('/settings', {
    expected_version: 0,
    daily_enabled: false,
    keep_daily: 3,
    folder: other,
  });
  assert.equal(saved.status, 200);
  const sv = (await saved.json()) as BackupsView;
  assert.deepEqual(
    [
      sv.settings.version,
      sv.settings.daily_enabled,
      sv.settings.keep_daily,
      sv.settings.folder,
    ],
    [1, false, 3, other],
  );
  assert.equal(sv.backups.length, 0, 'lists the folder now chosen');
  const stale = await post('/settings', {
    expected_version: 0,
    daily_enabled: true,
    keep_daily: 3,
    folder: other,
  });
  assert.equal(stale.status, 409);
  // B cannot change them either.
  const bSave = await fetch(`${base}/settings/backups/settings`, {
    method: 'POST',
    headers: { ...json, ...b.write },
    body: JSON.stringify({
      expected_version: 1,
      daily_enabled: true,
      keep_daily: 3,
      folder: other,
    }),
  });
  assert.equal(bSave.status, 403);
  // With the daily backup off, the daily check does nothing.
  assert.equal(await api.backups.daily(), null);
});

test('F1-2: one job at a time; the daily backup runs once per UTC day across restarts and keeps the newest N', async (t) => {
  const db = await freshDatabase(t);
  if (!db || !(await havePgDump(t))) return;
  const dir = await scratch(t);
  const products = join(dir, 'products');
  await mkdir(products, { recursive: true });
  const folder = join(dir, 'backups');
  const store = new BackupStore(db.pool);

  // The single-running rule is the database's: a second start is refused while one runs.
  const owner = randomUUID();
  await db.pool.query(
    `insert into actors (id, kind, display_name) values ($1, 'human', 'Owner')`,
    [owner],
  );
  const one = await store.startRun({
    trigger: 'manual',
    actorId: owner,
    backupName: 'manual-x',
  });
  await assert.rejects(
    store.startRun({
      trigger: 'check',
      actorId: owner,
      backupName: 'manual-x',
    }),
    /Another backup, check or restore is running/,
  );
  await store.finishRun(one!.id, { status: 'succeeded' });
  // A finished run can't be changed or deleted.
  await assert.rejects(
    db.pool.query(`update backup_runs set status = 'failed' where id = $1`, [
      one!.id,
    ]),
    /cannot change/,
  );
  await assert.rejects(
    db.pool.query('delete from backup_runs where id = $1', [one!.id]),
    /append-only/,
  );

  let clock = new Date('2026-11-16T09:00:00Z');
  const service = () =>
    createBackups({
      pool: db.pool,
      databaseUrl: db.url,
      productsRoot: products,
      defaultFolder: folder,
      pgBinDir,
      local: true,
      ensureReady: async () => undefined,
      requireSession: async () => {
        throw new Error('not used');
      },
      log: () => undefined,
      now: () => clock,
      tickMs: { first: 3_600_000, every: 3_600_000 },
    });
  const s1 = service();
  t.after(() => s1.close());
  const d1 = await s1.daily();
  assert.ok(d1, 'first daily of the day starts');
  await s1.idle();
  assert.equal(await s1.daily(), null, 'already taken today');
  // A restart (a new service on the same database) the same day does not take another.
  const s2 = service();
  t.after(() => s2.close());
  clock = new Date('2026-11-16T23:59:00Z');
  assert.equal(await s2.daily(), null);
  // Two processes racing on a new day: the unique index lets exactly one start.
  clock = new Date('2026-11-17T00:01:00Z');
  const s3 = service();
  t.after(() => s3.close());
  const race = await Promise.allSettled([s2.daily(), s3.daily()]);
  const startedCount = race.filter(
    (r) => r.status === 'fulfilled' && r.value !== null,
  ).length;
  assert.equal(startedCount, 1, JSON.stringify(race));
  await s2.idle();
  await s3.idle();

  // Settings refuse anyone but the studio owner; then the owner keeps 2 dailies.
  await assert.rejects(
    store.saveSettings(
      owner,
      { expected_version: 0, daily_enabled: true, keep_daily: 2, folder },
      async (f) => f,
    ),
    /Only the studio owner/,
  );
  await db.pool.query(
    `insert into studio_spending_manager (actor_id, source) values ($1, 'first_workspace')`,
    [owner],
  );
  await store.saveSettings(
    owner,
    { expected_version: 0, daily_enabled: true, keep_daily: 2, folder },
    async (f) => f,
  );
  // Review L-5: another studio's daily in the same folder is never pruned or listed.
  const mine = (await listBackups(folder)).backups[0]!;
  const foreign = 'daily-2026-11-01T00-00-00-000Z-s00000000';
  await mkdir(join(folder, foreign));
  await writeFile(
    join(folder, foreign, 'backup-manifest.json'),
    await readFile(join(folder, mine.name, 'backup-manifest.json')),
  );
  const tag = backupTag(mine.name)!;
  assert.match(tag, /^[0-9a-f]{8}$/);
  assert.notEqual(tag, '00000000');
  clock = new Date('2026-11-18T08:00:00Z');
  const d3 = await s1.daily();
  assert.ok(d3);
  await s1.idle();
  const list = await listBackups(folder, tag);
  assert.equal(list.other_studio, 1);
  assert.ok((await readdir(folder)).includes(foreign));
  const dailies = list.backups.filter((x) => x.kind === 'daily');
  assert.equal(dailies.length, 2, 'keep 2');
  assert.deepEqual(
    dailies.map((x) => x.name.slice(0, 16)),
    ['daily-2026-11-18', 'daily-2026-11-17'],
  );
  const last = (await store.runs()).runs[0]!;
  assert.equal(last.status, 'succeeded', last.error ?? '');
  assert.equal((last.result!.removed as string[]).length, 1);

  // pruneDailyBackups never touches other kinds, even with keep 1.
  await mkdir(join(folder, 'manual-keepme'), { recursive: true });
  await writeFile(
    join(folder, 'manual-keepme', 'backup-manifest.json'),
    await readFile(join(folder, dailies[0]!.name, 'backup-manifest.json')),
  );
  const removed = await pruneDailyBackups(folder, 1, tag);
  assert.equal(removed.length, 1);
  assert.ok((await readdir(folder)).includes('manual-keepme'));
  assert.ok((await readdir(folder)).includes(foreign));
});

test('F1-3: a folder named "..something" inside the product store counts as inside (review L-6)', () => {
  const root = resolve('/studio/products');
  assert.equal(insideFolder(join(root, '..bk'), root), true);
  assert.equal(insideFolder(join(root, 'a', 'b'), root), true);
  assert.equal(insideFolder(root, root), true);
  assert.equal(insideFolder(resolve('/studio/backups'), root), false);
  assert.equal(insideFolder(resolve('/studio'), root), false);
});
