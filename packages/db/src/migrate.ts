import type { Pool, PoolClient } from 'pg';
import { ContractError } from '@creator/contracts';
import { migrations, migrationChecksum } from './migrations.js';

const MIGRATION_LOCK = 4_310_002;
const LEDGER = `create table if not exists schema_migrations (
  version integer primary key,
  name text not null,
  checksum char(64) not null,
  applied_at timestamptz not null default now()
)`;

async function appliedVersions(pool: Pool | PoolClient) {
  const exists = await pool.query<{ ok: boolean }>(
    `select to_regclass('schema_migrations') is not null as ok`,
  );
  if (!exists.rows[0]?.ok) return [];
  const { rows } = await pool.query<{ version: number; checksum: string }>(
    'select version, checksum from schema_migrations order by version',
  );
  return rows;
}
function compare(applied: { version: number; checksum: string }[]) {
  for (const row of applied) {
    const known = migrations.find((m) => m.version === row.version);
    if (!known)
      throw new ContractError(
        'INVALID_CONFIG',
        `Database has migration ${row.version}, which this code does not know. Upgrade the code.`,
      );
    if (migrationChecksum(known) !== row.checksum)
      throw new ContractError(
        'INVALID_CONFIG',
        `Applied migration ${row.version} differs from the code; migrations must not be edited.`,
      );
  }
}

/** Applies pending migrations in order, each in its own transaction, under an advisory lock. */
export async function migrate(pool: Pool): Promise<number[]> {
  const client = await pool.connect();
  const applied: number[] = [];
  try {
    await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK]);
    await client.query(LEDGER);
    // Use the lock-holding connection: a second pool connection may not exist (max: 1).
    const done = await appliedVersions(client);
    compare(done);
    for (const m of migrations) {
      if (done.some((d) => d.version === m.version)) continue;
      await client.query('begin');
      try {
        await client.query(m.sql);
        await client.query(
          'insert into schema_migrations (version, name, checksum) values ($1, $2, $3)',
          [m.version, m.name, migrationChecksum(m)],
        );
        await client.query('commit');
        applied.push(m.version);
      } catch (error) {
        await client.query('rollback');
        throw error;
      }
    }
    return applied;
  } finally {
    await client
      .query('select pg_advisory_unlock($1)', [MIGRATION_LOCK])
      .catch(() => undefined);
    client.release();
  }
}

/** Startup gate: the service refuses to serve records from an unmigrated or mismatched schema. */
/**
 * ADR-0123: the highest applied migration, when every applied one is known to this code
 * unchanged. Used for the backup taken before an upgrade, when the schema is older on purpose.
 */
export async function assertSchemaKnown(pool: Pool): Promise<number> {
  const done = await appliedVersions(pool);
  compare(done);
  if (!done.length)
    throw new ContractError(
      'STORAGE_UNAVAILABLE',
      'The database has no Creator Agent schema to back up.',
    );
  return Math.max(...done.map((d) => d.version));
}

export async function assertSchemaCurrent(pool: Pool): Promise<number> {
  const done = await appliedVersions(pool);
  compare(done);
  const latest = migrations.at(-1)?.version ?? 0;
  if (done.length !== migrations.length) {
    // Review of PR #181, L-1: with numbers reserved out of order (61 merged before 56), the
    // highest applied number can equal the code's; name what is missing instead.
    const have = new Set(done.map((d) => d.version));
    const missing = migrations
      .map((m) => m.version)
      .filter((v) => !have.has(v));
    throw new ContractError(
      'STORAGE_UNAVAILABLE',
      `Database schema is missing migration${missing.length === 1 ? '' : 's'} ${missing.join(', ')} (code expects ${latest}). Run pnpm db:migrate.`,
    );
  }
  return latest;
}
