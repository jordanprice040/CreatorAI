import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { createServer, request as httpRequest, type Server } from 'node:http';
import { createInterface } from 'node:readline';
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { migrationChecksum, migrations } from '@creator/db';
import {
  guardOwnership,
  inspectDatabase,
  ownershipMac,
  parseStudioInput,
  sourceFetchEnv,
  STUDIO_PROTOCOL,
  webHandler,
} from '@creator/api/studio';
import { sourceConfigFromEnv } from '@creator/research';
import { TEST_DB_ENV, freshDatabase } from './pg-harness.js';

// §2.1 installed-studio service: the protocol the desktop supervisor relies on. Runs the
// compiled child (or the staged single-file bundle with CREATOR_TEST_STUDIO_BUNDLE) as a
// real process over stdin/stdout, against disposable PostgreSQL databases.
const ENTRY = process.env.CREATOR_TEST_STUDIO_BUNDLE
  ? resolve(process.env.CREATOR_TEST_STUDIO_BUNDLE)
  : resolve('apps/api/dist/studio-main.js');
const PG_BIN = process.env.CREATOR_PG_BIN || null;
type Event = Record<string, unknown> & { event: string };
// A stand-in UI so these checks do not depend on a prior web build (CI runs them unbuilt).
const WEB_ROOT = await mkdtemp(join(tmpdir(), 'creator-studio-ui-'));
await writeFile(
  join(WEB_ROOT, 'index.html'),
  '<!doctype html><html><body><div id="root"></div></body></html>',
);

function studio(mode: string, input: Record<string, unknown>) {
  const proc = spawn(process.execPath, [ENTRY, mode], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { SystemRoot: process.env.SystemRoot, PATH: process.env.PATH },
  });
  const events: Event[] = [];
  const waiters: { name: string; ok: (e: Event) => void }[] = [];
  let log = '';
  proc.stderr.on('data', (d: Buffer) => (log += d.toString()));
  createInterface({ input: proc.stdout }).on('line', (l) => {
    const e = JSON.parse(l) as Event;
    events.push(e);
    for (const w of waiters.filter((w) => w.name === e.event)) w.ok(e);
  });
  const exit = new Promise<number>((r) => proc.on('exit', (c) => r(c ?? -1)));
  proc.stdin.write(JSON.stringify(input) + '\n');
  return {
    proc,
    events,
    exit,
    log: () => log,
    next(name: string, ms = 30000) {
      const seen = events.find((e) => e.event === name);
      if (seen) return Promise.resolve(seen);
      return new Promise<Event>((ok, fail) => {
        const t = setTimeout(
          () =>
            fail(
              new Error(
                `no ${name} event; got ${JSON.stringify(events)}; log ${log}`,
              ),
            ),
          ms,
        );
        waiters.push({
          name,
          ok: (e) => {
            clearTimeout(t);
            ok(e);
          },
        });
      });
    },
  };
}
async function home() {
  const dir = await mkdtemp(join(tmpdir(), 'creator-studio-'));
  return dir;
}
function input(url: string, dir: string, extra: Record<string, unknown> = {}) {
  return {
    protocol: STUDIO_PROTOCOL,
    database_url: url,
    products_root: join(dir, 'products'),
    backups_dir: join(dir, 'backups'),
    pg_bin: PG_BIN,
    web_root: WEB_ROOT,
    owner_secret: randomBytes(32).toString('hex'),
    login_code: randomBytes(32).toString('base64url'),
    worker_distro: null,
    source: null,
    ...extra,
  };
}
async function emptyDatabase(t: test.TestContext) {
  const admin = process.env[TEST_DB_ENV];
  if (!admin) {
    t.skip(`PostgreSQL gate not run: ${TEST_DB_ENV} is not set`);
    return null;
  }
  const name = `creator_test_${randomBytes(6).toString('hex')}`;
  const pool = new pg.Pool({ connectionString: admin, max: 1 });
  pool.on('error', () => undefined);
  t.after(async () => {
    await pool.query(`drop database if exists ${name} with (force)`);
    await pool.end();
  });
  const url = new URL(admin);
  url.pathname = `/${name}`;
  return { url: url.toString(), name, admin: pool };
}
function get(port: number, path: string, headers: Record<string, string> = {}) {
  return new Promise<{
    status: number;
    body: string;
    headers: Record<string, unknown>;
  }>((ok, fail) => {
    const req = httpRequest(
      {
        host: '127.0.0.1',
        port,
        path,
        headers: { Host: `127.0.0.1:${port}`, ...headers },
      },
      (res) => {
        let body = '';
        res.on('data', (d: Buffer) => (body += d.toString()));
        res.on('end', () =>
          ok({ status: res.statusCode ?? 0, body, headers: res.headers }),
        );
      },
    );
    req.on('error', fail);
    req.end();
  });
}
const listenOn = (s: Server, port: number) =>
  new Promise<void>((r) => s.listen(port, '127.0.0.1', () => r()));

test('studio input refuses relative paths, unknown fields and a wrong protocol', () => {
  const ok = input('postgresql://u:p@127.0.0.1:5432/x', resolve('.'));
  assert.equal(
    parseStudioInput(JSON.stringify(ok)).database_url,
    ok.database_url,
  );
  for (const bad of [
    { ...ok, products_root: 'products' },
    { ...ok, extra: 1 },
    { ...ok, protocol: 'creator-studio/0' },
    { ...ok, owner_secret: 'short' },
  ])
    assert.throws(() => parseStudioInput(JSON.stringify(bad)));
  assert.throws(() => parseStudioInput('not json'));
});

test('studio input starts the live adapter and approves only owner-named host names', () => {
  const ok = input('postgresql://u:p@127.0.0.1:5432/x', resolve('.'));
  // An older desktop sends no list: the adapter exists for Settings (ADR-0056), but no
  // website is approved, so every fetch is refused until the owner adds one.
  assert.deepEqual(parseStudioInput(JSON.stringify(ok)).source_hosts, []);
  const empty = sourceConfigFromEnv(sourceFetchEnv([]));
  assert.ok(empty.adapter);
  assert.equal(empty.policy, null);
  const hosts = ['tasvideos.org', 'www.speedrun.com'];
  const parsed = parseStudioInput(
    JSON.stringify({ ...ok, source_hosts: hosts }),
  );
  assert.deepEqual(sourceFetchEnv(parsed.source_hosts), {
    CREATOR_SOURCE_FETCH: 'live',
    CREATOR_SOURCE_HOSTS: 'tasvideos.org,www.speedrun.com',
  });
  // The broker accepts exactly that configuration.
  assert.ok(sourceConfigFromEnv(sourceFetchEnv(hosts)).adapter);
  for (const bad of [
    'https://www.speedrun.com',
    'speedrun.com:443',
    'speedrun.com/x',
    'Speedrun.com',
    '127.0.0.1',
    'localhost',
  ])
    assert.throws(
      () => parseStudioInput(JSON.stringify({ ...ok, source_hosts: [bad] })),
      `${bad} should be refused`,
    );
  assert.throws(() =>
    parseStudioInput(
      JSON.stringify({
        ...ok,
        source_hosts: Array.from({ length: 21 }, (_, i) => `h${i}.example.com`),
      }),
    ),
  );
});

test('UI origin serves the built app, falls back for routes and refuses traversal and foreign hosts', async (t) => {
  const root = await home();
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'assets'));
  await writeFile(
    join(root, 'index.html'),
    '<!doctype html><title>studio</title>',
  );
  await writeFile(join(root, 'assets', 'app.js'), 'console.log(1)');
  await writeFile(
    join(resolve(root, '..'), 'outside-secret.txt'),
    'secret',
  ).catch(() => undefined);
  let apiCalls = 0;
  const port = 45173;
  const secret = randomBytes(32).toString('hex');
  const server = createServer(
    webHandler(
      root,
      (_req, res) => {
        apiCalls++;
        res.end('{"api":true}');
      },
      port,
    ),
  );
  guardOwnership(server, port, secret);
  await listenOn(server, port);
  t.after(() => server.close());
  assert.match((await get(port, '/')).body, /studio/);
  assert.match((await get(port, '/catalog/deep/route')).body, /studio/);
  const asset = await get(port, '/assets/app.js');
  assert.equal(asset.status, 200);
  assert.match(String(asset.headers['content-type']), /javascript/);
  assert.equal((await get(port, '/assets/missing.js')).status, 404);
  for (const p of [
    '/../outside-secret.txt',
    '/%2e%2e/outside-secret.txt',
    '/assets/..%5c..%5coutside-secret.txt',
  ])
    assert.ok([400, 404].includes((await get(port, p)).status), p);
  assert.equal(
    (await get(port, '/', { Host: 'evil.example:45173' })).status,
    403,
  );
  assert.equal((await get(port, '/api/health')).body, '{"api":true}');
  assert.equal(apiCalls, 1);
  // Ownership: a fresh nonce gets the HMAC for this port; a bad nonce gets nothing.
  const nonce = randomBytes(32).toString('hex');
  const proof = JSON.parse(
    (await get(port, '/__creator/ownership', { 'x-creator-nonce': nonce }))
      .body,
  ) as { mac: string };
  assert.equal(proof.mac, ownershipMac(secret, port, nonce));
  assert.notEqual(proof.mac, ownershipMac(secret, port + 1, nonce));
  assert.equal(
    (await get(port, '/__creator/ownership', { 'x-creator-nonce': 'zz' }))
      .status,
    400,
  );
});

test('installed studio: new studio, serve, sign in, record survives quit and relaunch', async (t) => {
  const db = await emptyDatabase(t);
  if (!db) return;
  const dir = await home();
  t.after(() => rm(dir, { recursive: true, force: true }));
  await db.admin.query(`create database ${db.name}`);
  const base = input(db.url, dir);
  // Serving refuses an unmigrated database and reports it instead of migrating.
  const early = studio('serve', base);
  const migrationNeeded = await early.next('needs_migration');
  assert.equal(migrationNeeded.current, 0);
  assert.equal(await early.exit, 3);
  const init = studio('init', base);
  const created = await init.next('result');
  assert.equal(await init.exit, 0, init.log());
  assert.equal(
    (created.result as { applied: number[] }).applied.length,
    migrations.length,
  );
  const again = studio('init', base);
  assert.equal((await again.next('error')).code, 'INVALID_CONTRACT');
  assert.equal(await again.exit, 1);

  const first = studio('serve', base);
  await first.next('ready', 60000);
  for (const port of [5173, 4310, 4320]) {
    const nonce = randomBytes(32).toString('hex');
    const r = await get(port, '/__creator/ownership', {
      'x-creator-nonce': nonce,
    });
    assert.equal(
      (JSON.parse(r.body) as { mac: string }).mac,
      ownershipMac(base.owner_secret, port, nonce),
    );
  }
  const status = await fetch('http://127.0.0.1:5173/api/auth/status').then(
    (r) => r.json(),
  );
  assert.equal((status as { managed_by?: string }).managed_by, 'desktop_app');
  assert.match(
    await fetch('http://127.0.0.1:5173/').then((r) => r.text()),
    /<div id="root">|<html/,
  );
  const login = await fetch('http://127.0.0.1:5173/api/auth/dev-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5173',
    },
    body: JSON.stringify({ code: base.login_code }),
  });
  assert.equal(login.status, 200);
  const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;
  const csrf = ((await login.json()) as { csrf_token: string }).csrf_token;
  const name = `Lifecycle ${randomBytes(4).toString('hex')}`;
  const made = await fetch('http://127.0.0.1:5173/api/workspaces', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5173',
      Cookie: cookie,
      'X-CSRF-Token': csrf,
    },
    body: JSON.stringify({ name, record_mode: 'real' }),
  });
  assert.ok(made.ok, await made.clone().text());
  first.proc.stdin.end(); // the supervisor quit: stdin closes
  await first.next('stopped');
  assert.equal(await first.exit, 0);
  await assert.rejects(get(5173, '/'));

  // Relaunch with a new launch secret and code: the old sign-in cookie still names the
  // stored session (it persists until expiry or sign-out), and the record is there.
  const relaunch = {
    ...base,
    owner_secret: randomBytes(32).toString('hex'),
    login_code: randomBytes(32).toString('base64url'),
  };
  const second = studio('serve', relaunch);
  await second.next('ready', 60000);
  t.after(() => second.proc.kill());
  const list = await fetch('http://127.0.0.1:5173/api/workspaces', {
    headers: { Cookie: cookie },
  });
  assert.equal(list.status, 200);
  assert.ok(
    ((await list.json()) as { name: string }[]).some((w) => w.name === name),
  );
  // The previous launch's code no longer signs anyone in.
  const stale = await fetch('http://127.0.0.1:5173/api/auth/dev-login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5173',
    },
    body: JSON.stringify({ code: base.login_code }),
  });
  assert.equal(stale.status, 401);
  // Revocation: sign-out ends the stored session for every later launch.
  const out = await fetch('http://127.0.0.1:5173/api/auth/logout', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: 'http://127.0.0.1:5173',
      Cookie: cookie,
      'X-CSRF-Token': csrf,
    },
    body: '{}',
  });
  assert.equal(out.status, 200);
  assert.equal(
    (
      await fetch('http://127.0.0.1:5173/api/auth/session', {
        headers: { Cookie: cookie },
      })
    ).status,
    401,
  );
  second.proc.stdin.write('{"cmd":"shutdown"}\n');
  await second.next('stopped');
  assert.equal(await second.exit, 0);
});

test('an occupied port is reported, never shared, and nothing else starts serving', async (t) => {
  const fresh = await freshDatabase(t);
  if (!fresh) return;
  const dir = await home();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const squatter = createServer((_q, r) => r.end('not the studio'));
  await listenOn(squatter, 5173);
  t.after(() => squatter.close());
  const s = studio('serve', input(fresh.url, dir));
  const e = await s.next('error', 60000);
  assert.equal(e.code, 'PORT_IN_USE');
  assert.equal(e.port, 5173);
  assert.equal(await s.exit, 5);
  await assert.rejects(get(4310, '/api/health'));
  assert.equal((await get(5173, '/')).body, 'not the studio');
});

test('unreachable database is an actionable error, not a crash loop', async () => {
  const dir = await home();
  const s = studio(
    'serve',
    input('postgresql://creator:x@127.0.0.1:9/creator_studio', dir),
  );
  const e = await s.next('error');
  assert.equal(e.code, 'DATABASE_UNAVAILABLE');
  assert.equal(await s.exit, 4);
  await rm(dir, { recursive: true, force: true });
});

test('upgrade takes a verified backup first, then migrates under the lock', async (t) => {
  const db = await emptyDatabase(t);
  if (!db) return;
  if (!PG_BIN) return t.skip('CREATOR_PG_BIN not set: pg_dump needed');
  await db.admin.query(`create database ${db.name}`);
  const pool = new pg.Pool({ connectionString: db.url, max: 1 });
  pool.on('error', () => undefined);
  await pool.query(
    `create table schema_migrations (version integer primary key, name text not null, checksum char(64) not null, applied_at timestamptz not null default now())`,
  );
  for (const m of migrations.slice(0, -1)) {
    await pool.query(m.sql);
    await pool.query(
      'insert into schema_migrations (version, name, checksum) values ($1,$2,$3)',
      [m.version, m.name, migrationChecksum(m)],
    );
  }
  await pool.end();
  const dir = await home();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const base = input(db.url, dir);
  const before = studio('serve', base);
  const need = await before.next('needs_migration');
  assert.equal(need.current, migrations.at(-2)!.version);
  assert.equal(await before.exit, 3);
  const up = studio('migrate', base);
  const r = (await up.next('result', 120000)).result as {
    applied: number[];
    backup: { dir: string; database: { sha256: string } };
  };
  assert.equal(await up.exit, 0, up.log());
  assert.deepEqual(r.applied, [migrations.at(-1)!.version]);
  const manifest = JSON.parse(
    await readFile(join(r.backup.dir, 'backup-manifest.json'), 'utf8'),
  ) as { schema_from: number };
  assert.equal(manifest.schema_from, migrations.at(-2)!.version);
  assert.ok((await readdir(r.backup.dir)).includes('database.dump'));
});

test('adoption copies a studio through a verified backup and leaves the source untouched', async (t) => {
  const source = await freshDatabase(t);
  const target = await emptyDatabase(t);
  if (!source || !target) return;
  if (!PG_BIN) return t.skip('CREATOR_PG_BIN not set: pg_dump needed');
  const ws = '11111111-2222-4333-8444-555555555555';
  await source.pool.query(
    `insert into actors (id, kind, display_name) values ('00000000-0000-4000-8000-000000000001','human','Local owner') on conflict do nothing`,
  );
  await source.pool.query(
    `insert into workspaces (id, name, record_mode, fixture, created_by) values ($1, 'Adopted studio', 'real', false, '00000000-0000-4000-8000-000000000001')`,
    [ws],
  );
  const dir = await home();
  t.after(() => rm(dir, { recursive: true, force: true }));
  const srcProducts = join(dir, 'source-products');
  await mkdir(join(srcProducts, 'p1'), { recursive: true });
  await writeFile(join(srcProducts, 'p1', 'note.txt'), 'kept');
  const before = await source.pool.query(
    'select count(*)::int as n from audit_events',
  );
  const base = input(target.url, dir, {
    source: { database_url: source.url, products_root: srcProducts },
  });
  const a = studio('adopt', base);
  const r = (await a.next('result', 120000)).result as {
    ok: boolean;
    workspaces: { name: string }[];
    check: { audit_chain: { ok: boolean } };
  };
  assert.equal(await a.exit, 0, a.log());
  assert.equal(r.ok, true);
  assert.deepEqual(
    r.workspaces.map((w) => w.name),
    ['Adopted studio'],
  );
  assert.equal(
    await readFile(join(dir, 'products', 'p1', 'note.txt'), 'utf8'),
    'kept',
  );
  const after = await source.pool.query(
    'select count(*)::int as n from audit_events',
  );
  assert.equal(after.rows[0].n, before.rows[0].n);
  // A second adoption into the now non-empty target is refused before the restore writes.
  const twice = studio('adopt', base);
  assert.equal((await twice.next('error', 120000)).code, 'INVALID_CONTRACT');
  assert.notEqual(await twice.exit, 0);
});

// PR #136 review M3: a database that skipped a known migration (43 applied before 42 existed)
// must read as needing migration, not as current; a version this code does not know is newer.
test('inspectDatabase compares the set of applied migrations, not only the highest', async (t) => {
  const fresh = await freshDatabase(t);
  if (!fresh) return;
  const latest = migrations.at(-1)!.version;
  const current = await inspectDatabase(fresh.url);
  assert.equal(current.applied, latest);
  assert.equal(current.expected, latest);
  assert.equal(current.unknown_newer, false);
  const gap = migrations.at(-3)!.version;
  await fresh.pool.query('delete from schema_migrations where version = $1', [
    gap,
  ]);
  const skipped = await inspectDatabase(fresh.url);
  assert.equal(skipped.applied, migrations.at(-4)!.version);
  assert.notEqual(skipped.applied, skipped.expected);
  assert.equal(skipped.unknown_newer, false);
  await fresh.pool.query(
    `insert into schema_migrations (version, name, checksum) values (9999, 'future', repeat('0', 64))`,
  );
  assert.equal((await inspectDatabase(fresh.url)).unknown_newer, true);
});
