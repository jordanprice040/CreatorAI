import { randomBytes } from 'node:crypto';
import type { TestContext } from 'node:test';
import pg from 'pg';
import { migrate } from '@creator/db';

export const TEST_DB_ENV = 'CREATOR_TEST_DATABASE_URL';
/**
 * Creates and migrates a throwaway database on the configured test server, or skips the test
 * with a visible reason. `pnpm test:db` refuses to run without the server, so this skip
 * cannot stand in for the gate.
 */
export async function freshDatabase(
  t: TestContext,
): Promise<{ url: string; pool: pg.Pool } | null> {
  const admin = process.env[TEST_DB_ENV];
  if (!admin) {
    t.skip(`PostgreSQL gate not run: ${TEST_DB_ENV} is not set`);
    return null;
  }
  const name = `creator_test_${randomBytes(6).toString('hex')}`;
  const adminPool = new pg.Pool({ connectionString: admin, max: 1 });
  adminPool.on('error', () => undefined);
  await adminPool.query(`create database ${name}`);
  const url = new URL(admin);
  url.pathname = `/${name}`;
  const pool = new pg.Pool({ connectionString: url.toString(), max: 8 });
  pool.on('error', () => undefined);
  t.after(async () => {
    await pool.end();
    await adminPool.query(`drop database if exists ${name} with (force)`);
    await adminPool.end();
  });
  await migrate(pool);
  return { url: url.toString(), pool };
}
