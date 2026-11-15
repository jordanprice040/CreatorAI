import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { STUDIO_LOCK_KEY, takeStudioLock } from '@creator/db';
import { guardStudio } from '@creator/api/studio-guard';
import { freshDatabase } from './pg-harness.js';

// ADR-0108, review 1 M-1: one studio per database, whatever ports each one uses.

test('the studio lock admits one holder per database, names it, and frees on release', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const first = await takeStudioLock(db.url, 'pnpm dev, web port 5274');
  assert.ok(first.held);
  t.after(() => (first.held ? first.lock.release() : undefined));
  const second = await takeStudioLock(db.url, 'desktop app');
  assert.equal(second.held, false);
  assert.match(
    second.held ? '' : second.message,
    /^Another Creator Agent studio is already running on this database \(pnpm dev, web port 5274\)\./,
  );
  await first.lock.release();
  const third = await takeStudioLock(db.url, 'desktop app');
  assert.ok(third.held);
  await third.lock.release();
});

const freePort = async () => {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const { port } = s.address() as { port: number };
  await new Promise((r) => s.close(r));
  return port;
};

/** Starts `scripts/dev.mjs` on its own ports and resolves with its output once it settles. */
function devStudio(url: string, ports: number[]) {
  const child = spawn(process.execPath, ['scripts/dev.mjs'], {
    windowsHide: true,
    env: {
      ...process.env,
      CREATOR_DATABASE_URL: url,
      CREATOR_API_PORT: String(ports[0]),
      CREATOR_PREVIEW_PORT: String(ports[1]),
      CREATOR_WEB_PORT: String(ports[2]),
      CREATOR_WORKER: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (out += b));
  const exited = once(child, 'exit');
  return {
    child,
    output: () => out,
    exited,
    stop: async () => {
      if (child.exitCode === null) {
        child.kill('SIGTERM');
        await exited;
      }
    },
  };
}

test('a second dev studio on the same database is refused even on other ports (review 1 M-1 repro)', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const a = devStudio(db.url, [
    await freePort(),
    await freePort(),
    await freePort(),
  ]);
  t.after(() => a.stop());
  const until = Date.now() + 60000;
  while (!/Sign-in/.test(a.output()) && Date.now() < until) {
    assert.equal(a.child.exitCode, null, a.output());
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.match(a.output(), /Sign-in/);
  // Different ports for every piece: the earlier port probe alone let this one start.
  const b = devStudio(db.url, [
    await freePort(),
    await freePort(),
    await freePort(),
  ]);
  t.after(() => b.stop());
  const [code] = await b.exited;
  assert.equal(code, 1);
  assert.match(
    b.output(),
    /Another Creator Agent studio is already running on this database \(pnpm dev, web port \d+, process \d+\)/,
  );
  // Once the first one stops, the database is free again.
  await a.stop();
  const c = devStudio(db.url, [
    await freePort(),
    await freePort(),
    await freePort(),
  ]);
  t.after(() => c.stop());
  const until2 = Date.now() + 60000;
  while (!/Sign-in/.test(c.output()) && Date.now() < until2) {
    assert.equal(c.child.exitCode, null, c.output());
    await new Promise((r) => setTimeout(r, 200));
  }
  assert.match(c.output(), /Sign-in/);
});

/** The server pid of the connection holding the studio lock in this database. */
async function holderPid(pool: pg.Pool) {
  const r = await pool.query<{ pid: number }>(
    `select l.pid from pg_locks l
      where l.locktype = 'advisory' and l.granted and l.objid = $1
        and l.database = (select oid from pg_database where datname = current_database())`,
    [STUDIO_LOCK_KEY],
  );
  return r.rows[0]?.pid ?? null;
}
const until = async (what: string, ok: () => Promise<boolean> | boolean) => {
  const end = Date.now() + 15000;
  while (!(await ok())) {
    if (Date.now() > end) throw new Error(`Timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('a dropped lock connection takes the lock again, and stops if another studio took it (review 2 L-1)', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const notes: string[] = [];
  const lost: string[] = [];
  const a = await takeStudioLock(db.url, 'studio A', {
    onNote: (n) => notes.push(n),
    onLost: (m) => lost.push(m),
    retryMs: [50],
  });
  assert.ok(a.held);
  t.after(() => (a.held ? a.lock.release() : undefined));
  // A database restart, as far as A's lock connection can tell.
  const first = await holderPid(db.pool);
  await db.pool.query('select pg_terminate_backend($1)', [first]);
  await until('lock held again', () => notes.some((n) => /held again/.test(n)));
  assert.notEqual(await holderPid(db.pool), first);
  const b = await takeStudioLock(db.url, 'studio B');
  assert.equal(b.held, false);
  assert.match(b.held ? '' : b.message, /\(studio A\)/);

  // Now another studio is waiting for the lock when A's connection drops: it gets it first,
  // and A is told to stop instead of serving unprotected.
  const other = new pg.Client({
    connectionString: db.url,
    application_name: 'creator-agent-studio studio C',
  });
  other.on('error', () => undefined);
  await other.connect();
  t.after(() => other.end().catch(() => undefined));
  const pid = await holderPid(db.pool);
  const waiting = other.query('select pg_advisory_lock($1)', [STUDIO_LOCK_KEY]);
  await until('C waits for the lock', async () => {
    const r = await db.pool.query(
      `select count(*)::int as n from pg_locks where locktype = 'advisory' and not granted and objid = $1`,
      [STUDIO_LOCK_KEY],
    );
    return r.rows[0].n === 1;
  });
  await db.pool.query('select pg_terminate_backend($1)', [pid]);
  await waiting;
  await until('A told to stop', () => lost.length === 1);
  assert.match(
    lost[0]!,
    /lost its database connection, and meanwhile another studio started on this database\. Another Creator Agent studio is already running on this database \(studio C\)/,
  );
});

test('the refusal names the holder in this database, not one in another database on the server (review 2 L-2)', async (t) => {
  const one = await freshDatabase(t);
  const two = await freshDatabase(t);
  if (!one || !two) return;
  const a = await takeStudioLock(one.url, 'studio on A');
  const b = await takeStudioLock(two.url, 'studio on B');
  assert.ok(a.held && b.held);
  t.after(async () => {
    if (a.held) await a.lock.release();
    if (b.held) await b.lock.release();
  });
  for (let i = 0; i < 3; i++) {
    const again = await takeStudioLock(two.url, 'second');
    assert.equal(again.held, false);
    assert.match(again.held ? '' : again.message, /\(studio on B\)/);
  }
});

test('the dev launchers read the URL from its file, explain a bad URL, and refuse a held database (review 2 L-3, L-4, N-1)', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const dir = await mkdtemp(join(tmpdir(), 'creator-lock-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const file = join(dir, 'database_url');
  await writeFile(file, db.url);
  const noop = () => undefined;
  const fromFile = await guardStudio(
    { CREATOR_DATABASE_URL_FILE: file },
    'from file',
    noop,
  );
  assert.ok(fromFile.ok && fromFile.lock);
  t.after(() => (fromFile.ok ? fromFile.lock?.release() : undefined));
  const second = await guardStudio(
    { CREATOR_DATABASE_URL: db.url },
    'second',
    noop,
  );
  assert.equal(second.ok, false);
  assert.match(second.ok ? '' : second.message, /\(from file\)/);
  const bad = await guardStudio(
    { CREATOR_DATABASE_URL: 'not a url' },
    'bad',
    noop,
  );
  assert.deepEqual(bad, { ok: false, message: 'Database URL is malformed.' });
  assert.deepEqual(await guardStudio({}, 'none', noop), {
    ok: true,
    lock: null,
  });

  // `pnpm dev:api` on a held database exits with the refusal instead of serving.
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    windowsHide: true,
    env: {
      ...process.env,
      CREATOR_DATABASE_URL: db.url,
      CREATOR_API_PORT: String(await freePort()),
      CREATOR_PREVIEW_PORT: String(await freePort()),
      CREATOR_WORKER: 'off',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  child.stdout.on('data', (b) => (out += b));
  child.stderr.on('data', (b) => (out += b));
  const [code] = await once(child, 'exit');
  assert.equal(code, 1, out);
  assert.match(out, /already running on this database \(from file\)/);
});
