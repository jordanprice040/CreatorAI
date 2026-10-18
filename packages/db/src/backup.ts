import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, sep } from 'node:path';
import pg from 'pg';
import { ContractError } from '@creator/contracts';
import { databaseUrl } from './config.js';
import { assertSchemaCurrent } from './migrate.js';
import { migrations } from './migrations.js';
import { Store } from './store.js';

/**
 * T17 local backup: a pg_dump custom-format archive of the records database plus a byte copy of
 * the local product store (repositories, packages and manifests), bound together by a manifest
 * of SHA-256 hashes. Restore refuses a non-empty target and re-checks every hash first; the
 * restored copy is then verified the same way the API verifies downloads.
 */
export const BACKUP_FORMAT = 'creator-backup/1';

const run = promisify(execFile);
const sha256 = (b: Buffer | string) =>
  createHash('sha256').update(b).digest('hex');
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export type BackupFile = { path: string; sha256: string; bytes: number };
export type BackupManifest = {
  format: typeof BACKUP_FORMAT;
  created_at: string;
  schema_version: number;
  database: { file: 'database.dump'; sha256: string; bytes: number };
  products: BackupFile[];
  counts: Record<string, number>;
};
export type RestoreCheck = {
  ok: boolean;
  schema_version: number;
  audit_chain: { ok: boolean; events: number; broken_at: string | null };
  counts: Record<string, number>;
  artifacts: {
    id: string;
    product_id: string;
    ok: boolean;
    problem: string | null;
  }[];
};

const COUNTED = [
  'entities',
  'entity_links',
  'audit_events',
  'decision_requests',
  'budget_envelopes',
  'budget_reservations',
  'workflows',
  'research_sources',
  'spec_freezes',
  'study_attempts',
  'artifact_manifests',
  'artifact_feedback',
] as const;

/** Splits the password out so it reaches pg tools by environment, never by argv or logs. */
function pgTarget(raw: string) {
  const url = new URL(databaseUrl(raw)!);
  const password = decodeURIComponent(url.password);
  url.password = '';
  return {
    dbname: url.toString(),
    env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}) },
  };
}
async function tool(bin: string, args: string[], env: NodeJS.ProcessEnv) {
  try {
    await run(bin, args, { env, maxBuffer: 16 * 1024 * 1024 });
  } catch (e) {
    const err = e as { code?: string; stderr?: string };
    if (err.code === 'ENOENT')
      throw new ContractError(
        'INVALID_CONFIG',
        `${bin} was not found. Install the PostgreSQL client tools or set CREATOR_PG_BIN.`,
      );
    // pg tool messages name the database, never the password (it is not in argv).
    throw new ContractError(
      'STORAGE_UNAVAILABLE',
      `${bin} failed: ${String(err.stderr ?? '').trim() || 'no output'}`,
    );
  }
}
const pgBin = (name: string, dir?: string) => (dir ? join(dir, name) : name);

async function counts(pool: pg.Pool) {
  const out: Record<string, number> = {};
  for (const table of COUNTED) {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from ${table}`,
    );
    out[table] = rows[0]!.n;
  }
  return out;
}

/** Lists regular files under root, refusing links so a backup never follows one out. */
async function files(root: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isSymbolicLink())
        throw new ContractError(
          'INVALID_CONTRACT',
          `Refusing to back up a link: ${relative(root, path)}`,
        );
      if (entry.isDirectory()) await walk(path);
      else if (entry.isFile()) out.push(path);
      else
        throw new ContractError(
          'INVALID_CONTRACT',
          `Refusing to back up a special file: ${relative(root, path)}`,
        );
    }
  };
  if (await exists(root)) await walk(root);
  return out.sort();
}
async function exists(path: string) {
  try {
    await lstat(path);
    return true;
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw e;
  }
}
/** Manifest paths always use '/', and may not climb out of the products directory. */
function safeRelative(path: string) {
  const parts = path.split('/');
  if (
    !path ||
    path.startsWith('/') ||
    parts.some((p) => p === '' || p === '.' || p === '..' || p.includes('\\'))
  )
    throw new ContractError(
      'INVALID_CONTRACT',
      `Unsafe path in backup manifest: ${path}`,
    );
  return join(...parts);
}

export async function createBackup(o: {
  databaseUrl: string;
  productsRoot: string;
  outDir: string;
  pgBinDir?: string | undefined;
}): Promise<BackupManifest> {
  if (await exists(o.outDir))
    throw new ContractError(
      'INVALID_CONTRACT',
      'The backup directory already exists; choose a new one.',
    );
  const pool = new pg.Pool({ connectionString: o.databaseUrl, max: 1 });
  pool.on('error', () => undefined);
  try {
    const schema = await assertSchemaCurrent(pool);
    await mkdir(join(o.outDir, 'products'), { recursive: true });
    const target = pgTarget(o.databaseUrl);
    const dump = join(o.outDir, 'database.dump');
    await tool(
      pgBin('pg_dump', o.pgBinDir),
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--file=${dump}`,
        `--dbname=${target.dbname}`,
      ],
      target.env,
    );
    const products: BackupFile[] = [];
    for (const file of await files(o.productsRoot)) {
      const rel = relative(o.productsRoot, file).split(sep).join('/');
      const bytes = await readFile(file);
      const to = join(o.outDir, 'products', safeRelative(rel));
      await mkdir(dirname(to), { recursive: true });
      await writeFile(to, bytes, { flag: 'wx' });
      products.push({ path: rel, sha256: sha256(bytes), bytes: bytes.length });
    }
    const dumpBytes = await readFile(dump);
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      created_at: new Date().toISOString(),
      schema_version: schema,
      database: {
        file: 'database.dump',
        sha256: sha256(dumpBytes),
        bytes: dumpBytes.length,
      },
      products,
      // Counted after the dump; a concurrent writer can only make these lower than the dump.
      counts: await counts(pool),
    };
    await writeFile(
      join(o.outDir, 'backup-manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      { flag: 'wx' },
    );
    return manifest;
  } finally {
    await pool.end();
  }
}

/** Re-reads every backed-up file and refuses the backup if any hash or size differs. */
export async function checkBackup(dir: string): Promise<BackupManifest> {
  const manifest = JSON.parse(
    await readFile(join(dir, 'backup-manifest.json'), 'utf8'),
  ) as BackupManifest;
  if (manifest.format !== BACKUP_FORMAT)
    throw new ContractError('INVALID_CONTRACT', 'Not a Creator Agent backup.');
  const latest = migrations.at(-1)!.version;
  if (manifest.schema_version !== latest)
    throw new ContractError(
      'INVALID_CONFIG',
      `The backup is at schema ${manifest.schema_version}; this code expects ${latest}. Restore with the matching code version.`,
    );
  const dump = await readFile(join(dir, 'database.dump'));
  if (sha256(dump) !== manifest.database.sha256)
    throw new ContractError(
      'EVIDENCE_MISMATCH',
      'database.dump does not match the backup manifest.',
    );
  const listed = new Set<string>();
  for (const f of manifest.products) {
    const bytes = await readFile(join(dir, 'products', safeRelative(f.path)));
    if (sha256(bytes) !== f.sha256 || bytes.length !== f.bytes)
      throw new ContractError(
        'EVIDENCE_MISMATCH',
        `products/${f.path} does not match the backup manifest.`,
      );
    listed.add(f.path);
  }
  for (const file of await files(join(dir, 'products'))) {
    const rel = relative(join(dir, 'products'), file).split(sep).join('/');
    if (!listed.has(rel))
      throw new ContractError(
        'EVIDENCE_MISMATCH',
        `products/${rel} is not in the backup manifest.`,
      );
  }
  return manifest;
}

/**
 * Restores into an empty database and an absent or empty products directory. Nothing is
 * written until the whole backup has been re-hashed.
 */
export async function restoreBackup(o: {
  backupDir: string;
  databaseUrl: string;
  productsRoot: string;
  pgBinDir?: string | undefined;
}): Promise<RestoreCheck> {
  const manifest = await checkBackup(o.backupDir);
  if ((await exists(o.productsRoot)) && (await files(o.productsRoot)).length)
    throw new ContractError(
      'INVALID_CONTRACT',
      'The products directory is not empty; restore into a new one.',
    );
  const pool = new pg.Pool({ connectionString: o.databaseUrl, max: 1 });
  pool.on('error', () => undefined);
  try {
    const { rows } = await pool.query<{ n: number }>(
      `select count(*)::int as n from pg_tables where schemaname = 'public'`,
    );
    if (rows[0]!.n !== 0)
      throw new ContractError(
        'INVALID_CONTRACT',
        'The target database is not empty; create a new database to restore into.',
      );
  } finally {
    await pool.end();
  }
  const target = pgTarget(o.databaseUrl);
  await tool(
    pgBin('pg_restore', o.pgBinDir),
    [
      '--no-owner',
      '--no-privileges',
      '--exit-on-error',
      '--single-transaction',
      `--dbname=${target.dbname}`,
      join(o.backupDir, 'database.dump'),
    ],
    target.env,
  );
  for (const f of manifest.products) {
    const to = join(o.productsRoot, safeRelative(f.path));
    await mkdir(dirname(to), { recursive: true });
    await copyFile(join(o.backupDir, 'products', safeRelative(f.path)), to);
  }
  const check = await verifyRestore(o.databaseUrl, o.productsRoot);
  for (const [table, n] of Object.entries(manifest.counts))
    if ((check.counts[table] ?? 0) < n) {
      check.ok = false;
      throw new ContractError(
        'EVIDENCE_MISMATCH',
        `Restored ${table} has ${check.counts[table]} rows; the backup recorded ${n}.`,
      );
    }
  return check;
}

/**
 * Checks a database and product store together: schema current, audit chain intact, and every
 * catalogued artifact's manifest and package present with the recorded hashes.
 */
export async function verifyRestore(
  url: string,
  productsRoot: string,
): Promise<RestoreCheck> {
  const pool = new pg.Pool({ connectionString: url, max: 1 });
  pool.on('error', () => undefined);
  try {
    const schema = await assertSchemaCurrent(pool);
    const audit = await new Store(pool).verifyAuditChain();
    const { rows } = await pool.query<{
      id: string;
      product_id: string;
      manifest_sha256: string;
      archive_sha256: string;
    }>(
      'select id, product_id, manifest_sha256, archive_sha256 from artifact_manifests order by created_at, id',
    );
    const artifacts: RestoreCheck['artifacts'] = [];
    for (const a of rows) {
      let problem: string | null = null;
      if (!ID.test(a.id) || !ID.test(a.product_id)) problem = 'bad id';
      else {
        const dir = join(productsRoot, a.product_id, 'artifacts', a.id);
        const read = async (name: string) => {
          try {
            return await readFile(join(dir, name));
          } catch {
            return null;
          }
        };
        const m = await read('manifest.json');
        const tar = await read('source.tar');
        if (!m) problem = 'manifest.json missing';
        else if (sha256(m) !== a.manifest_sha256)
          problem = 'manifest hash mismatch';
        else if (!tar) problem = 'source.tar missing';
        else if (sha256(tar) !== a.archive_sha256)
          problem = 'package hash mismatch';
      }
      artifacts.push({
        id: a.id,
        product_id: a.product_id,
        ok: problem === null,
        problem,
      });
    }
    return {
      ok: audit.ok && artifacts.every((a) => a.ok),
      schema_version: schema,
      audit_chain: audit,
      counts: await counts(pool),
      artifacts,
    };
  } finally {
    await pool.end();
  }
}
