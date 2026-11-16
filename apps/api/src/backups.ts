import { createHash, randomBytes } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import pg from 'pg';
import {
  BackupNameSchema,
  BackupsViewSchema,
  BackupStartedSchema,
  ContractError,
  RestoreInputSchema,
  parse,
  type BackupEntry,
  type BackupRun,
  type SessionInfo,
} from '@creator/contracts';
import {
  BackupStore,
  PARTIAL_SUFFIX,
  backupFolderName,
  checkBackup,
  createBackup,
  listBackups,
  migrations,
  pruneDailyBackups,
  restoreBackup,
} from '@creator/db';

/** How often the daily backup checks whether today's has been taken (and once at start). */
const DAILY_TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_MS = 2 * 60 * 1000;
const ROUTE = /^\/api\/settings\/backups(?:\/([^/]+)(?:\/([a-z-]+))?)?$/;

const inside = (child: string, parent: string) => {
  const r = relative(parent, child);
  return r === '' || (!!r && !r.startsWith('..') && !isAbsolute(r));
};
const errorText = (e: unknown) =>
  e instanceof Error ? e.message : 'The backup step failed.';

/**
 * ADR-0123 (F1): Settings › Backups for the local studio. Back up now, the daily backup while
 * the app runs (keep the newest N), a hash check of any backup, and restore into a new
 * database and folder. Every one of them is the T17 code (`createBackup`, `checkBackup`,
 * `restoreBackup`) that `pnpm backup` runs, as a background job recorded in `backup_runs`.
 * Only the studio owner reaches any of it; the studio in use is never written to or replaced.
 */
export function createBackups(o: {
  pool: pg.Pool | null;
  databaseUrl: string | null;
  productsRoot: string;
  defaultFolder: string;
  pgBinDir?: string | undefined;
  /** Hosted deployments use their operator's backups (docs/HOSTED_OPERATION.md), not this. */
  local: boolean;
  ensureReady: () => Promise<void>;
  requireSession: (
    req: IncomingMessage,
    mutating: boolean,
  ) => Promise<SessionInfo>;
  log: (m: string) => void;
  /** Test seams. */
  now?: () => Date;
  tickMs?: { first: number; every: number };
}) {
  const store = o.pool ? new BackupStore(o.pool) : null;
  const now = o.now ?? (() => new Date());
  const productsRoot = resolve(o.productsRoot);
  let current: Promise<void> | null = null;
  let timer: NodeJS.Timeout | null = null;
  let closed = false;

  function need() {
    if (!store || !o.databaseUrl || !o.local)
      throw new ContractError(
        'INVALID_CONFIG',
        o.local
          ? 'Backups need the studio database (PostgreSQL).'
          : 'Backups in Settings are for the local studio; hosted deployments use their own.',
      );
    return { store, url: o.databaseUrl };
  }
  async function owner(req: IncomingMessage, mutating: boolean) {
    const s = need();
    const session = await o.requireSession(req, mutating);
    await o.ensureReady();
    await s.store.requireStudioOwner(session.actor_id);
    return { ...s, session };
  }

  /** An absolute folder outside the product store that this process can write to. */
  async function checkFolder(raw: string): Promise<string> {
    if (!isAbsolute(raw))
      throw new ContractError(
        'INVALID_CONTRACT',
        'Enter the full path of the backups folder, such as C:\\CreatorAgentBackups.',
      );
    const folder = resolve(raw);
    if (inside(folder, productsRoot) || inside(productsRoot, folder))
      throw new ContractError(
        'INVALID_CONTRACT',
        'Choose a folder outside the studio’s product folder, so a backup never copies itself.',
      );
    const probe = join(
      folder,
      `.write-check-${randomBytes(6).toString('hex')}`,
    );
    try {
      await mkdir(folder, { recursive: true });
      await writeFile(probe, 'ok', { flag: 'wx' });
      await rm(probe);
    } catch (e) {
      throw new ContractError(
        'INVALID_CONFIG',
        `The studio can't write to that folder (${(e as NodeJS.ErrnoException).code ?? 'error'}).`,
      );
    }
    return folder;
  }

  const dbName = () =>
    o.databaseUrl
      ? decodeURIComponent(new URL(o.databaseUrl).pathname.slice(1))
      : '';

  async function view() {
    const { store: s } = need();
    const settings = await s.settings(resolve(o.defaultFolder));
    const listed = await listBackups(settings.folder);
    const runs = await s.runs();
    return parse(BackupsViewSchema, {
      settings,
      backups: listed.backups,
      folder_problem: listed.problem,
      runs: runs.runs,
      running: runs.running,
      last_daily_day: runs.lastDailyDay,
      database_name: dbName(),
      schema_version: migrations.at(-1)!.version,
    });
  }

  /** Runs the work after the run is recorded, and records how it ended. One at a time. */
  function job(
    run: BackupRun,
    work: () => Promise<Record<string, unknown>>,
  ): void {
    const s = store!;
    current = (async () => {
      try {
        const result = await work();
        const failed = result.ok === false;
        await s.finishRun(run.id, {
          status: failed ? 'failed' : 'succeeded',
          error: failed
            ? typeof result.problem === 'string'
              ? result.problem
              : 'The check did not pass.'
            : null,
          result,
        });
      } catch (e) {
        o.log(`Backup ${run.trigger} failed: ${errorText(e)}`);
        await s
          .finishRun(run.id, { status: 'failed', error: errorText(e) })
          .catch((err: unknown) =>
            o.log(`Recording the backup outcome failed: ${errorText(err)}`),
          );
      } finally {
        current = null;
      }
    })();
  }

  /** Writes into `<name>.partial` and renames when the manifest is written, so a crash
   * never leaves a folder that looks finished. */
  async function makeBackup(folder: string, name: string, url: string) {
    await mkdir(folder, { recursive: true });
    const partial = join(folder, name + PARTIAL_SUFFIX);
    try {
      const manifest = await createBackup({
        databaseUrl: url,
        productsRoot,
        outDir: partial,
        pgBinDir: o.pgBinDir,
      });
      await rename(partial, join(folder, name));
      return {
        schema_version: manifest.schema_version,
        bytes:
          manifest.database.bytes +
          manifest.products.reduce((n, p) => n + p.bytes, 0),
        product_files: manifest.products.length,
      };
    } catch (e) {
      await rm(partial, { recursive: true, force: true }).catch(
        () => undefined,
      );
      throw e;
    }
  }

  async function backupNow(actorId: string) {
    const { store: s, url } = need();
    const settings = await s.settings(resolve(o.defaultFolder));
    const name = backupFolderName('manual', now());
    const run = await s.startRun({
      trigger: 'manual',
      actorId,
      backupName: name,
    });
    job(run!, () => makeBackup(settings.folder, name, url));
    return run!;
  }

  /** The daily backup: at most one attempt per UTC day, then keep the newest N. */
  async function daily(): Promise<BackupRun | null> {
    if (closed || !store || !o.databaseUrl || !o.local) return null;
    await o.ensureReady();
    const settings = await store.settings(resolve(o.defaultFolder));
    if (!settings.daily_enabled) return null;
    const at = now();
    const day = at.toISOString().slice(0, 10);
    const { lastDailyDay, running } = await store.runs();
    if (lastDailyDay === day || running) return null;
    const name = backupFolderName('daily', at);
    let run: BackupRun | null;
    try {
      run = await store.startRun({
        trigger: 'daily',
        actorId: null,
        backupName: name,
        dailyDay: day,
      });
    } catch (e) {
      // Something else started meanwhile; the next tick tries again.
      if (e instanceof ContractError && e.code === 'VERSION_CONFLICT')
        return null;
      throw e;
    }
    if (!run) return null;
    const url = o.databaseUrl;
    job(run, async () => {
      const made = await makeBackup(settings.folder, name, url);
      const removed = await pruneDailyBackups(
        settings.folder,
        settings.keep_daily,
      );
      return { ...made, kept: settings.keep_daily, removed };
    });
    return run;
  }

  async function find(
    name: string,
  ): Promise<{ folder: string; b: BackupEntry }> {
    const { store: s } = need();
    const valid = parse(BackupNameSchema, name);
    const settings = await s.settings(resolve(o.defaultFolder));
    const b = (await listBackups(settings.folder)).backups.find(
      (x) => x.name === valid,
    );
    if (!b)
      throw new ContractError('NOT_FOUND', 'No such backup in the folder.');
    return { folder: settings.folder, b };
  }

  async function checkOne(actorId: string, name: string) {
    const { store: s } = need();
    const { folder, b } = await find(name);
    const run = await s.startRun({
      trigger: 'check',
      actorId,
      backupName: b.name,
    });
    job(run!, async () => {
      const dir = join(folder, b.name);
      if (b.format === 'creator-backup/1') {
        // Its own schema: this checks the bytes, not whether this app can restore it.
        const m = await checkBackup(dir, { schema: b.schema_version });
        return { ok: true, files: m.products.length + 1 };
      }
      const m = JSON.parse(
        await readFile(join(dir, 'backup-manifest.json'), 'utf8'),
      ) as { database: { sha256: string } };
      const dump = await readFile(join(dir, 'database.dump'));
      const ok =
        createHash('sha256').update(dump).digest('hex') === m.database.sha256;
      return ok
        ? { ok, files: 1 }
        : { ok, problem: 'database.dump does not match the backup manifest.' };
    });
    return run!;
  }

  async function restoreOne(actorId: string, name: string, raw: unknown) {
    const { store: s, url } = need();
    const input = parse(RestoreInputSchema, raw);
    const { folder, b } = await find(name);
    if (!b.restorable)
      throw new ContractError(
        'INVALID_CONFIG',
        b.restore_note ?? 'This app version cannot restore that backup.',
      );
    if (input.database_name === dbName())
      throw new ContractError(
        'INVALID_CONTRACT',
        'That is the database this studio uses. Restore into a new one.',
      );
    if (!isAbsolute(input.products_root))
      throw new ContractError(
        'INVALID_CONTRACT',
        'Enter the full path of a new folder for the restored product files.',
      );
    const target = resolve(input.products_root);
    if (
      inside(target, productsRoot) ||
      inside(productsRoot, target) ||
      inside(target, folder) ||
      inside(folder, target)
    )
      throw new ContractError(
        'INVALID_CONTRACT',
        'Choose a new folder that is not inside (or around) the studio’s product folder or the backups folder.',
      );
    const targetUrl = new URL(url);
    targetUrl.pathname = `/${input.database_name}`;
    const run = await s.startRun({
      trigger: 'restore',
      actorId,
      backupName: b.name,
    });
    job(run!, async () => {
      // Only what this restore created is removed if it fails.
      const madeFolder = !(await stat(target).then(
        () => true,
        () => false,
      ));
      const madeDb = await createDatabase(url, input.database_name);
      try {
        const check = await restoreBackup({
          backupDir: join(folder, b.name),
          databaseUrl: targetUrl.toString(),
          productsRoot: target,
          pgBinDir: o.pgBinDir,
        });
        const bad = check.artifacts.filter((a) => !a.ok);
        return {
          ok: check.ok,
          ...(check.ok
            ? {}
            : {
                problem: check.audit_chain.ok
                  ? `${bad.length} product package(s) did not match their recorded hashes.`
                  : 'The restored audit history did not verify.',
              }),
          database_name: input.database_name,
          products_root: target,
          schema_version: check.schema_version,
          audit_chain_ok: check.audit_chain.ok,
          audit_events: check.audit_chain.events,
          artifacts_checked: check.artifacts.length,
          artifacts_bad: bad.length,
          workspaces: await countWorkspaces(targetUrl.toString()),
        };
      } catch (e) {
        if (madeDb)
          await dropDatabase(url, input.database_name).catch(() => undefined);
        if (madeFolder)
          await rm(target, { recursive: true, force: true }).catch(
            () => undefined,
          );
        throw e;
      }
    });
    return run!;
  }

  async function route(
    req: IncomingMessage,
    url: URL,
    body: () => Promise<unknown>,
  ): Promise<{ status: number; value: unknown } | null> {
    const m = ROUTE.exec(url.pathname);
    if (!m) return null;
    const method = req.method ?? 'GET';
    const [, item, action] = m;
    if (!item && method === 'GET') {
      await owner(req, false);
      return { status: 200, value: await view() };
    }
    if (method !== 'POST')
      throw new ContractError('NOT_FOUND', 'Unknown backups route.');
    const { store: s, session } = await owner(req, true);
    if (item === 'settings' && !action) {
      await s.saveSettings(session.actor_id, await body(), checkFolder);
      return { status: 200, value: await view() };
    }
    if (item === 'runs' && !action) {
      const run = await backupNow(session.actor_id);
      return { status: 202, value: parse(BackupStartedSchema, { run }) };
    }
    if (item && action === 'check') {
      const run = await checkOne(session.actor_id, decodeURIComponent(item));
      return { status: 202, value: parse(BackupStartedSchema, { run }) };
    }
    if (item && action === 'restore') {
      const run = await restoreOne(
        session.actor_id,
        decodeURIComponent(item),
        await body(),
      );
      return { status: 202, value: parse(BackupStartedSchema, { run }) };
    }
    throw new ContractError('NOT_FOUND', 'Unknown backups route.');
  }

  /** Startup: interrupted runs are recorded as such and their partial folders removed. */
  async function recover() {
    if (!store) return;
    await store.sweepInterrupted();
    const settings = await store.settings(resolve(o.defaultFolder));
    const names = await readdir(settings.folder).catch(() => [] as string[]);
    for (const n of names)
      if (/^(manual|daily)-[0-9TZ-]+\.partial$/.test(n))
        await rm(join(settings.folder, n), { recursive: true, force: true });
  }

  function start() {
    if (!store || !o.local || timer) return;
    const tick = () =>
      void daily().catch((e: unknown) =>
        o.log(`Daily backup not started: ${errorText(e)}`),
      );
    const every = o.tickMs?.every ?? DAILY_TICK_MS;
    const first = setTimeout(() => {
      tick();
      timer = setInterval(tick, every);
      timer.unref();
    }, o.tickMs?.first ?? FIRST_TICK_MS);
    first.unref();
    timer = first;
  }
  async function close() {
    closed = true;
    if (timer) clearInterval(timer);
    timer = null;
    // A backup in progress finishes (or fails) and records itself before the pool closes.
    await current?.catch(() => undefined);
  }
  return { route, recover, start, close, daily, idle: () => current };
}

async function withAdmin<T>(url: string, f: (p: pg.Pool) => Promise<T>) {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  pool.on('error', () => undefined);
  try {
    return await f(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}
/** Creates the database if it is missing; returns whether this call made it. */
async function createDatabase(url: string, name: string) {
  return withAdmin(url, async (p) => {
    const { rows } = await p.query(
      'select 1 from pg_database where datname = $1',
      [name],
    );
    if (rows.length) return false;
    try {
      // The name matched ^[a-z][a-z0-9_]{0,62}$, so quoting it is enough.
      await p.query(`create database "${name}"`);
    } catch (e) {
      throw new ContractError(
        'INVALID_CONFIG',
        `The new database could not be created: ${errorText(e)}. Create it yourself (empty) and try again.`,
      );
    }
    return true;
  });
}
async function dropDatabase(url: string, name: string) {
  await withAdmin(url, (p) =>
    p.query(`drop database if exists "${name}" with (force)`),
  );
}
async function countWorkspaces(url: string) {
  return withAdmin(url, async (p) => {
    const { rows } = await p.query<{ n: number }>(
      'select count(*)::int as n from workspaces',
    );
    return rows[0]!.n;
  });
}
