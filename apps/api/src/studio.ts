import { createHash, createHmac } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  createServer,
  type IncomingMessage,
  type RequestListener,
  type Server,
  type ServerResponse,
} from 'node:http';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { extname, isAbsolute, join, resolve, sep } from 'node:path';
import { promisify } from 'node:util';
import pg from 'pg';
import { ContractError, z, parse } from '@creator/contracts';
import {
  createBackup,
  databaseUrl,
  migrate,
  migrations,
  restoreBackup,
} from '@creator/db';
import { createApi } from './index.js';

/**
 * §2.1 installed studio service (ADR-0041). The desktop supervisor starts this as its only
 * child: one process serves the production UI, the API with its in-process workflow worker,
 * and the private preview origin. Configuration and secrets arrive as one JSON line on stdin
 * (never argv or environment); events leave as JSON lines on stdout; logs go to stderr.
 * Nothing here reads the source checkout.
 */
export const STUDIO_PROTOCOL = 'creator-studio/1';
const PORTS = { web: 5173, api: 4310, preview: 4320 } as const;

const absolute = z
  .string()
  .min(3)
  .max(1000)
  .refine((p) => isAbsolute(p), 'Must be an absolute path.');
const url = z.string().min(1).max(2000);
export const StudioInputSchema = z.strictObject({
  protocol: z.literal(STUDIO_PROTOCOL),
  database_url: url,
  products_root: absolute,
  backups_dir: absolute,
  pg_bin: absolute.nullable(),
  web_root: absolute.nullable(),
  owner_secret: z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .nullable(),
  login_code: z
    .string()
    .regex(/^[A-Za-z0-9_-]{43}$/)
    .nullable(),
  worker_distro: z
    .string()
    .regex(/^[A-Za-z0-9._-]{1,64}$/)
    .nullable(),
  source: z
    .strictObject({ database_url: url, products_root: absolute })
    .nullable(),
});
export type StudioInput = z.infer<typeof StudioInputSchema>;
export type StudioEvent = Record<string, unknown> & { event: string };
type Emit = (e: StudioEvent) => void;

const sha256 = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');

/** Proof that a listener belongs to this launch: HMAC over a fresh nonce and its port. */
export function ownershipMac(secret: string, port: number, nonce: string) {
  return createHmac('sha256', Buffer.from(secret, 'hex'))
    .update(`${STUDIO_PROTOCOL}:${port}:${nonce}`)
    .digest('hex');
}
function json(res: ServerResponse, status: number, value: unknown) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  res.end(JSON.stringify(value));
}
const loopbackHost = (req: IncomingMessage, port: number) =>
  [`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host ?? '');

/** Answers the supervisor's ownership challenge before any other handler sees the request. */
export function guardOwnership(server: Server, port: number, secret: string) {
  const handlers = server.listeners('request') as RequestListener[];
  server.removeAllListeners('request');
  server.on('request', (req: IncomingMessage, res: ServerResponse) => {
    if (req.url === '/__creator/ownership') {
      const nonce = req.headers['x-creator-nonce'];
      if (
        req.method !== 'GET' ||
        !loopbackHost(req, port) ||
        typeof nonce !== 'string' ||
        !/^[0-9a-f]{64}$/.test(nonce)
      )
        return json(res, 400, { error: 'bad ownership challenge' });
      return json(res, 200, {
        protocol: STUDIO_PROTOCOL,
        mac: ownershipMac(secret, port, nonce),
      });
    }
    for (const h of handlers) h.call(server, req, res);
  });
}

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
};

/**
 * Production UI origin: the built web app plus same-origin /api, handed to the API's own
 * request handler in-process (the Vite proxy's job in development). Host is checked so a
 * rebinding page cannot read the studio; the API still applies its own Host/Origin/CSRF rules.
 */
export function webHandler(root: string, api: RequestListener, port: number) {
  const base = resolve(root);
  return (req: IncomingMessage, res: ServerResponse) => {
    void (async () => {
      const raw = req.url ?? '/';
      if (raw === '/api' || raw.startsWith('/api/') || raw.startsWith('/api?'))
        return api(req, res);
      if (!loopbackHost(req, port))
        return json(res, 403, {
          error: 'Only loopback Host headers are accepted.',
        });
      if (req.method !== 'GET' && req.method !== 'HEAD')
        return json(res, 405, { error: 'Method not allowed.' });
      let path: string;
      try {
        path = decodeURIComponent(new URL(raw, 'http://studio').pathname);
      } catch {
        return json(res, 400, { error: 'Bad path.' });
      }
      const parts = path.split('/').filter(Boolean);
      if (
        parts.some(
          (p) =>
            p === '..' || p === '.' || p.includes('\\') || p.includes('\0'),
        )
      )
        return json(res, 400, { error: 'Bad path.' });
      let file = join(base, ...parts);
      if (file !== base && !file.startsWith(base + sep))
        return json(res, 400, { error: 'Bad path.' });
      const isFile = await stat(file).then(
        (s) => s.isFile(),
        () => false,
      );
      if (!isFile) {
        // Client-side routes fall back to the app; missing assets stay 404.
        if (extname(path)) return json(res, 404, { error: 'Not found.' });
        file = join(base, 'index.html');
      }
      const body = await readFile(file);
      res.writeHead(200, {
        'Content-Type': TYPES[extname(file)] ?? 'application/octet-stream',
        'Content-Length': body.length,
        'Cache-Control':
          parts[0] === 'assets'
            ? 'public, max-age=31536000, immutable'
            : 'no-cache',
        'X-Content-Type-Options': 'nosniff',
        'Referrer-Policy': 'no-referrer',
        'X-Frame-Options': 'DENY',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
    })().catch(() => {
      if (!res.headersSent) json(res, 500, { error: 'Could not read the UI.' });
      else res.destroy();
    });
  };
}

/** Splits the password out so pg tools get it by environment, never argv. */
function pgTarget(raw: string) {
  const u = new URL(raw);
  const password = decodeURIComponent(u.password);
  u.password = '';
  return {
    dbname: u.toString(),
    env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
  };
}
const latest = () => migrations.at(-1)!.version;

export type DatabaseState = {
  reachable: boolean;
  applied: number;
  expected: number;
  unknown_newer: boolean;
  empty: boolean;
  workspaces: { name: string; record_mode: string }[];
  error: string | null;
};
/** Read-only look at a database: schema position and workspace names, no secrets. */
export async function inspectDatabase(raw: string): Promise<DatabaseState> {
  const expected = latest();
  const target = databaseUrl(raw, 'local');
  if (!target) throw new ContractError('INVALID_CONFIG', 'No database URL.');
  const pool = new pg.Pool({
    connectionString: target,
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => undefined);
  try {
    const tables = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    const ledger = await pool.query<{ ok: boolean }>(
      `select to_regclass('public.schema_migrations') is not null as ok`,
    );
    let applied = 0;
    let unknownNewer = false;
    if (ledger.rows[0]?.ok) {
      const { rows } = await pool.query<{ version: number }>(
        'select version from schema_migrations order by version',
      );
      applied = rows.at(-1)?.version ?? 0;
      unknownNewer = rows.some((r) => r.version > expected);
    }
    const ws = await pool.query<{ ok: boolean }>(
      `select to_regclass('public.workspaces') is not null as ok`,
    );
    const workspaces = ws.rows[0]?.ok
      ? (
          await pool.query<{ name: string; record_mode: string }>(
            'select name, record_mode from workspaces order by created_at, id limit 20',
          )
        ).rows
      : [];
    return {
      reachable: true,
      applied,
      expected,
      unknown_newer: unknownNewer,
      empty: tables.rows[0]!.n === 0,
      workspaces,
      error: null,
    };
  } catch (e) {
    return {
      reachable: false,
      applied: 0,
      expected,
      unknown_newer: false,
      empty: false,
      workspaces: [],
      error: e instanceof Error ? e.message : 'Database unavailable.',
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Creates the named database on the same server when it does not exist yet. */
export async function ensureDatabase(raw: string): Promise<boolean> {
  const u = new URL(raw);
  const name = decodeURIComponent(u.pathname.slice(1));
  if (!/^[a-z_][a-z0-9_]{0,62}$/.test(name))
    throw new ContractError(
      'INVALID_CONFIG',
      'Database names must be lowercase letters, digits and underscores.',
    );
  u.pathname = '/postgres';
  const pool = new pg.Pool({
    connectionString: u.toString(),
    max: 1,
    connectionTimeoutMillis: 5000,
  });
  pool.on('error', () => undefined);
  try {
    const { rows } = await pool.query(
      'select 1 from pg_database where datname = $1',
      [name],
    );
    if (rows.length) return false;
    await pool.query(`create database "${name}"`);
    return true;
  } finally {
    await pool.end().catch(() => undefined);
  }
}

const run = promisify(execFile);
const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** Before any migration: a custom-format dump, its hash, and a readable table of contents. */
async function preMigrationBackup(input: StudioInput, from: number) {
  const dir = join(input.backups_dir, `pre-migrate-v${from}-${stamp()}`);
  await mkdir(dir, { recursive: true });
  const dump = join(dir, 'database.dump');
  const target = pgTarget(input.database_url);
  const bin = (n: string) => (input.pg_bin ? join(input.pg_bin, n) : n);
  try {
    await run(
      bin('pg_dump'),
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--file=${dump}`,
        `--dbname=${target.dbname}`,
      ],
      { env: target.env, maxBuffer: 16 * 1024 * 1024 },
    );
    await run(bin('pg_restore'), ['--list', dump], {
      maxBuffer: 64 * 1024 * 1024,
    });
  } catch (e) {
    const err = e as { code?: string; stderr?: string };
    throw new ContractError(
      'STORAGE_UNAVAILABLE',
      err.code === 'ENOENT'
        ? 'PostgreSQL tools (pg_dump, pg_restore) were not found; set the PostgreSQL folder in setup.'
        : `Pre-migration backup failed: ${String(err.stderr ?? '').trim() || 'no output'}`,
    );
  }
  const bytes = await readFile(dump);
  const manifest = {
    format: 'creator-premigration/1',
    created_at: new Date().toISOString(),
    schema_from: from,
    schema_to: latest(),
    database: {
      file: 'database.dump',
      sha256: sha256(bytes),
      bytes: bytes.length,
    },
  };
  await writeFile(
    join(dir, 'backup-manifest.json'),
    JSON.stringify(manifest, null, 2) + '\n',
    { flag: 'wx' },
  );
  return { dir, ...manifest };
}

async function withPool<T>(raw: string, f: (p: pg.Pool) => Promise<T>) {
  const pool = new pg.Pool({ connectionString: raw, max: 1 });
  pool.on('error', () => undefined);
  try {
    return await f(pool);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

/** Owner-approved upgrade: verified backup first, then the existing advisory-locked migrate. */
export async function migrateStudio(input: StudioInput) {
  const before = await inspectDatabase(input.database_url);
  if (!before.reachable)
    throw new ContractError(
      'STORAGE_UNAVAILABLE',
      before.error ?? 'Database unavailable.',
    );
  if (before.unknown_newer)
    throw new ContractError(
      'INVALID_CONFIG',
      `The database has migrations newer than this app (${before.applied} > ${before.expected}); install a matching app version.`,
    );
  const backup = before.empty
    ? null
    : await preMigrationBackup(input, before.applied);
  const applied = await withPool(input.database_url, (p) => migrate(p));
  return { applied, backup, from: before.applied, to: latest() };
}

/** A new, empty studio: only into an empty database. */
export async function initStudio(input: StudioInput) {
  const created = await ensureDatabase(input.database_url);
  const state = await inspectDatabase(input.database_url);
  if (!state.reachable)
    throw new ContractError(
      'STORAGE_UNAVAILABLE',
      state.error ?? 'Database unavailable.',
    );
  if (!state.empty)
    throw new ContractError(
      'INVALID_CONTRACT',
      'That database already holds records. Adopt or connect to it instead of creating a new studio.',
    );
  await mkdir(input.products_root, { recursive: true });
  const applied = await withPool(input.database_url, (p) => migrate(p));
  return { created_database: created, applied };
}

/**
 * Adoption of an existing studio: T17 backup of the source (database snapshot plus product
 * store), restore into an empty target and product directory, and the full restore check.
 * The source is only read. A failed check leaves the configuration unchanged.
 */
export async function adoptStudio(input: StudioInput) {
  const source = input.source;
  if (!source)
    throw new ContractError('INVALID_CONTRACT', 'Choose the studio to adopt.');
  const srcProducts = await stat(source.products_root).then(
    (s) => s.isDirectory(),
    () => false,
  );
  if (!srcProducts)
    throw new ContractError(
      'INVALID_CONFIG',
      'The source product folder does not exist.',
    );
  const from = await inspectDatabase(source.database_url);
  if (!from.reachable)
    throw new ContractError(
      'STORAGE_UNAVAILABLE',
      `The studio to adopt is not reachable: ${from.error ?? 'unknown error'}`,
    );
  if (from.applied !== from.expected)
    throw new ContractError(
      'INVALID_CONFIG',
      `The studio to adopt is at schema ${from.applied}; this app expects ${from.expected}. Upgrade it with matching code first.`,
    );
  await ensureDatabase(input.database_url);
  const dir = join(input.backups_dir, `adopt-${stamp()}`);
  await mkdir(input.backups_dir, { recursive: true });
  const manifest = await createBackup({
    databaseUrl: source.database_url,
    productsRoot: source.products_root,
    outDir: dir,
    pgBinDir: input.pg_bin ?? undefined,
  });
  const check = await restoreBackup({
    backupDir: dir,
    databaseUrl: input.database_url,
    productsRoot: input.products_root,
    pgBinDir: input.pg_bin ?? undefined,
  });
  return {
    ok: check.ok,
    backup_dir: dir,
    workspaces: from.workspaces,
    schema_version: manifest.schema_version,
    counts: manifest.counts,
    products_files: manifest.products.length,
    check,
  };
}

function listen(server: Server, port: number) {
  return new Promise<void>((ok, fail) => {
    const onError = (e: NodeJS.ErrnoException) => {
      server.off('listening', onListening);
      fail(
        e.code === 'EADDRINUSE'
          ? Object.assign(
              new ContractError(
                'INVALID_CONFIG',
                `Port ${port} is already in use by another program.`,
              ),
              { port, studio_code: 'PORT_IN_USE' },
            )
          : e,
      );
    };
    const onListening = () => {
      server.off('error', onError);
      ok();
    };
    server.once('error', onError);
    server.once('listening', onListening);
    server.listen(port, '127.0.0.1');
  });
}

/**
 * Serves until `stop` resolves (stdin closed or a shutdown command), then closes the API, its
 * worker, previews and the UI origin. Returns the process exit code.
 */
export async function serveStudio(
  input: StudioInput,
  emit: Emit,
  stop: Promise<void>,
): Promise<number> {
  if (!input.owner_secret || !input.login_code || !input.web_root)
    throw new ContractError(
      'INVALID_CONTRACT',
      'Serving needs the launch secret, login code and UI.',
    );
  const state = await inspectDatabase(input.database_url);
  if (!state.reachable) {
    emit({
      event: 'error',
      code: 'DATABASE_UNAVAILABLE',
      message: state.error,
    });
    return 4;
  }
  if (state.unknown_newer) {
    emit({
      event: 'error',
      code: 'DATABASE_NEWER',
      message: `The database has migrations newer than this app (${state.applied}). Install a matching app version.`,
    });
    return 6;
  }
  if (state.applied !== state.expected) {
    emit({
      event: 'needs_migration',
      current: state.applied,
      expected: state.expected,
      empty: state.empty,
    });
    return 3;
  }
  await stat(join(input.web_root, 'index.html')).catch(() => {
    throw new ContractError(
      'INVALID_CONFIG',
      'The installed UI is missing; reinstall the app.',
    );
  });
  const env: Record<string, string> = {
    CREATOR_DATABASE_URL: input.database_url,
    CREATOR_PRODUCTS_ROOT: input.products_root,
    CREATOR_AUTH_MODE: 'dev_local',
    CREATOR_DEV_LOGIN_CODE: input.login_code,
    CREATOR_DESKTOP_MANAGED: '1',
    // ADR-0042: DPAPI-protected ChatGPT sign-in, beside the studio's products folder.
    CREATOR_PLAN_VAULT_DIR: join(input.products_root, '..', 'plan-credentials'),
    ...(input.worker_distro
      ? { CREATOR_WORKER_DISTRO: input.worker_distro }
      : {}),
  };
  const api = createApi(env);
  const apiHandler = api.server.listeners('request')[0] as RequestListener;
  const web = createServer(webHandler(input.web_root, apiHandler, PORTS.web));
  web.requestTimeout = 10000;
  web.headersTimeout = 10000;
  guardOwnership(api.server, PORTS.api, input.owner_secret);
  guardOwnership(api.preview, PORTS.preview, input.owner_secret);
  guardOwnership(web, PORTS.web, input.owner_secret);
  const closeAll = async () => {
    web.closeAllConnections();
    await new Promise<void>((r) =>
      web.listening ? web.close(() => r()) : r(),
    );
    await api.close();
  };
  try {
    await listen(api.server, PORTS.api);
    await listen(api.preview, PORTS.preview);
    await listen(web, PORTS.web);
    await api.ready();
  } catch (e) {
    const port = (e as { port?: number }).port;
    emit({
      event: 'error',
      code: port ? 'PORT_IN_USE' : 'STARTUP_FAILED',
      ...(port ? { port } : {}),
      message: e instanceof Error ? e.message : 'Startup failed.',
    });
    await closeAll().catch(() => undefined);
    return port ? 5 : 1;
  }
  emit({
    event: 'ready',
    ports: PORTS,
    schema_version: state.expected,
    worker: api.worker ? 'in_process' : 'off',
  });
  await stop;
  emit({ event: 'stopping' });
  await closeAll();
  emit({ event: 'stopped' });
  return 0;
}

export function parseStudioInput(line: string): StudioInput {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    throw new ContractError('INVALID_CONTRACT', 'Malformed studio input.');
  }
  return parse(StudioInputSchema, value, 'INVALID_CONTRACT');
}
