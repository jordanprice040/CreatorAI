import { randomBytes } from 'node:crypto';
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
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
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
  backupTag,
  studioTag,
  checkBackup,
  createBackup,
  listBackups,
  migrations,
  pruneDailyBackups,
  restoreBackup,
  sha256File,
} from '@creator/db';

/** How often the daily backup checks whether today's has been taken (and once at start). */
const DAILY_TICK_MS = 10 * 60 * 1000;
const FIRST_TICK_MS = 2 * 60 * 1000;
const ROUTE = /^\/api\/settings\/backups(?:\/([^/]+)(?:\/([a-z-]+))?)?$/;

/** Review L-6: `..bk` is a child; only `..` itself or `../…` climbs out. */
export const inside = (child: string, parent: string) => {
  const r = relative(parent, child);
  if (r === '') return true;
  if (isAbsolute(r) || r === '..' || r.startsWith(`..${sep}`)) return false;
  return true;
};
/** Databases a restore must never fill (review M-1). */
const SYSTEM_DATABASES = new Set(['postgres', 'template0', 'template1']);
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

  // Review N-1: the server's own answer, not the URL path (which may be empty).
  let own: { name: string; tag: string } | null = null;
  async function studio() {
    if (!own) {
      const { rows } = await o.pool!.query<{ d: string }>(
        'select current_database() as d',
      );
      own = { name: rows[0]!.d, tag: await studioTag(o.pool!) };
    }
    return own;
  }

  async function view() {
    const { store: s } = need();
    const settings = await s.settings(resolve(o.defaultFolder));
    const me = await studio();
    const listed = await listBackups(settings.folder, me.tag);
    const runs = await s.runs();
    return parse(BackupsViewSchema, {
      settings,
      backups: listed.backups,
      folder_problem: listed.problem,
      runs: runs.runs,
      running: runs.running,
      last_daily: runs.lastDaily,
      other_studio_backups: listed.other_studio,
      database_name: me.name,
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
    const name = backupFolderName('manual', now(), (await studio()).tag);
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
    const { lastDaily, running } = await store.runs();
    if (lastDaily?.day === day || running) return null;
    const tag = (await studio()).tag;
    const name = backupFolderName('daily', at, tag);
    let run: BackupRun | null;
    // Review N-4: close() may have run during the awaits above.
    if (closed) return null;
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
        tag,
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
    const b = (
      await listBackups(settings.folder, (await studio()).tag)
    ).backups.find((x) => x.name === valid);
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
      // Audit 2026-11-19 L-3: streamed, never read into memory whole.
      const ok =
        (await sha256File(join(dir, 'database.dump'))).sha256 ===
        m.database.sha256;
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
    if (input.database_name === (await studio()).name)
      throw new ContractError(
        'INVALID_CONTRACT',
        'That is the database this studio uses. Restore into a new one.',
      );
    await checkTarget(url, input.database_name);
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
      target: { database_name: input.database_name, products_root: target },
    });
    job(run!, async () => {
      // Only what this restore created is removed if it fails.
      const madeFolder = !(await stat(target).then(
        () => true,
        () => false,
      ));
      // Audit 2026-11-19 L-4: restore also accepts an existing folder holding no files; if it
      // fails, what it copied there is removed again so the next attempt is not refused. The
      // empty folders the person had made there stay (review of #250, nit 2).
      const before = madeFolder
        ? null
        : await readdir(target, { recursive: true, withFileTypes: true }).then(
            (list) =>
              list.every((d) => d.isDirectory())
                ? new Set(list.map((d) => join(d.parentPath, d.name)))
                : null,
            () => null,
          );
      await checkTarget(url, input.database_name);
      const madeDb = await createDatabase(url, input.database_name);
      try {
        const check = await restoreBackup({
          backupDir: join(folder, b.name),
          databaseUrl: targetUrl.toString(),
          productsRoot: target,
          pgBinDir: o.pgBinDir,
        });
        const bad = check.artifacts.filter((a) => !a.ok);
        // Review L-2: a copy that fails its final check is removed like any other failure.
        if (!check.ok)
          throw new ContractError(
            'EVIDENCE_MISMATCH',
            check.audit_chain.ok
              ? `${bad.length} product package(s) in the restored copy did not match their recorded hashes.`
              : 'The restored audit history did not verify.',
          );
        return {
          ok: true,
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
        // Re-review N-3: say "removed" only for what was removed, and name what may remain.
        const ok = (p: Promise<unknown>) =>
          p.then(
            () => true,
            () => false,
          );
        const dbGone = madeDb
          ? await ok(dropDatabase(url, input.database_name))
          : null;
        const dirGone = madeFolder
          ? await ok(rm(target, { recursive: true, force: true }))
          : before
            ? await ok(
                readdir(target, { recursive: true, withFileTypes: true }).then(
                  async (list) => {
                    // Shallowest first: removing a new folder takes what is inside it.
                    const added = list
                      .map((d) => join(d.parentPath, d.name))
                      .filter((p) => !before.has(p))
                      .sort((a, b) => a.length - b.length);
                    for (const p of added)
                      await rm(p, { recursive: true, force: true });
                  },
                ),
              )
            : null;
        const dirText = madeFolder
          ? `folder ${target}`
          : `files copied into folder ${target}`;
        const removed = [
          dbGone === true && `database ${input.database_name}`,
          dirGone === true && dirText,
        ].filter(Boolean);
        const left = [
          dbGone === false && `database ${input.database_name}`,
          dirGone === false && dirText,
        ].filter(Boolean);
        throw new ContractError(
          e instanceof ContractError ? e.code : 'STORAGE_UNAVAILABLE',
          `${errorText(e)}${removed.length ? ` The ${removed.join(' and ')} this restore created ${removed.length > 1 ? 'were' : 'was'} removed.` : ''}${left.length ? ` The ${left.join(' and ')} this restore created could not be removed; remove ${left.length > 1 ? 'them' : 'it'} before reusing the name.` : ''}`,
        );
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
      const run = await checkOne(session.actor_id, decoded(item));
      return { status: 202, value: parse(BackupStartedSchema, { run }) };
    }
    if (item && action === 'restore') {
      const run = await restoreOne(
        session.actor_id,
        decoded(item),
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
    const tag = (await studio()).tag;
    // Review L-3/L-5: this studio's own unfinished folders only, upgrade ones too.
    for (const folder of new Set([settings.folder, resolve(o.defaultFolder)])) {
      const names = await readdir(folder).catch(() => [] as string[]);
      for (const n of names)
        if (
          /^(manual|daily|pre-upgrade)-[0-9a-zA-Z-]+\.partial$/.test(n) &&
          backupTag(n) === tag
        )
          await rm(join(folder, n), { recursive: true, force: true });
    }
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

/** Review N-6: a malformed escape is a bad request, not a server failure. */
function decoded(item: string) {
  try {
    return decodeURIComponent(item);
  } catch {
    throw new ContractError('INVALID_CONTRACT', 'Not a backup folder name.');
  }
}
/**
 * Review M-1: never a system or template database, nor one that refuses connections; an
 * existing database is allowed only if it is empty (restoreBackup checks that again).
 */
async function checkTarget(url: string, name: string) {
  if (SYSTEM_DATABASES.has(name))
    throw new ContractError(
      'INVALID_CONTRACT',
      `${name} is a PostgreSQL system database. Restore into a new one.`,
    );
  await withAdmin(url, async (p) => {
    const { rows } = await p.query<{ t: boolean; c: boolean }>(
      'select datistemplate as t, datallowconn as c from pg_database where datname = $1',
      [name],
    );
    const r = rows[0];
    if (r && (r.t || !r.c))
      throw new ContractError(
        'INVALID_CONTRACT',
        `${name} is a template or closed database. Restore into a new one.`,
      );
  });
}
