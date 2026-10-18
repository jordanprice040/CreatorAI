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

/** Fixed development login code for test servers (never a real deployment value). */
export const LOGIN_CODE = 'test-login-code-0123456789abcdefghij';
/** Signs in with the development code; returns headers for reads and for writes. */
export async function login(base: string) {
  const response = await fetch(`${base}/auth/dev-login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code: LOGIN_CODE }),
  });
  if (!response.ok) throw new Error(`login failed: ${response.status}`);
  const session = (await response.json()) as { csrf_token: string };
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0] ?? '';
  return {
    cookie,
    csrf: session.csrf_token,
    read: { Cookie: cookie },
    write: { Cookie: cookie, 'X-CSRF-Token': session.csrf_token },
  };
}
