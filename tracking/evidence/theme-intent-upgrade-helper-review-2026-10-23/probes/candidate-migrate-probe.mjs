// Disposable-cluster probe: real candidate `studio.mjs migrate` with the helper's exact payload shape.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const R = 'file:///C:/dev/creator_agent/';
const { state, preserved, hash } = await import(R + 'scripts/theme-intent-upgrade-core.mjs');
const { migrations, migrationChecksum } = await import(R + 'packages/db/dist/migrations.js');
const require = createRequire(new URL(R + 'packages/db/package.json'));
const { Pool } = require('pg');
const PORT = 55451, S = process.argv[2], name = `theme_review_${Date.now()}`;
const install = 'C:/dev/creator_agent/.verification/theme-intent-nsis-payload';
const admin = new Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' });
await admin.query(`create database ${name}`); await admin.end();
const pool = new Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: name, max: 1 });
const root = join(S, name);
for (const d of ['secrets', 'plan-credentials', 'products', 'backups']) await mkdir(join(root, d), { recursive: true });
await writeFile(join(root, 'studio.json'), 'synthetic'); await writeFile(join(root, 'products/p.txt'), 'synthetic product');
const log = {};
try {
  await pool.query('create table schema_migrations(version integer primary key,name text not null,checksum char(64) not null,applied_at timestamptz not null default now())');
  for (const m of migrations.slice(0, 28)) {
    await pool.query(m.sql);
    await pool.query('insert into schema_migrations(version,name,checksum) values($1,$2,$3)', [m.version, m.name, migrationChecksum(m)]);
  }
  // Synthetic rows wherever a table accepts default values, so fingerprints are non-trivial.
  let seeded = 0;
  for (const { tablename } of (await pool.query("select tablename from pg_tables where schemaname='public' and tablename<>'schema_migrations'")).rows) {
    await pool.query('begin');
    try { await pool.query(`insert into "${tablename}" default values`); await pool.query('commit'); seeded++; } catch { await pool.query('rollback'); }
  }
  log.seeded_tables = seeded;
  const before = await state(pool, root, join(root, 'products'), 28);
  log.before_tables = Object.keys(before.hashes).length;
  // --- verbatim shape of upgrade-theme-intent.mjs migrate payload/parse ---
  const payload = {
    protocol: 'creator-studio/1',
    database_url: `postgresql://postgres:${encodeURIComponent('')}@127.0.0.1:${PORT}/${name}`,
    products_root: join(root, 'products'), backups_dir: join(root, 'backups'),
    pg_bin: 'C:/pgsql18/pgsql/bin', web_root: null, owner_secret: null, login_code: null, worker_distro: null, source: null,
  };
  await pool.end(); // helper keeps its pool idle here; release to mirror zero-other-connection expectation
  const proc = spawn(join(install, 'studio/node/node.exe'), [join(install, 'studio/service/app/dist/studio.mjs'), 'migrate'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let out = '', err = '';
  proc.stdout.on('data', (c) => { out += c; }); proc.stderr.on('data', (c) => { err += c; });
  proc.stdin.end(JSON.stringify(payload) + '\n');
  const code = await new Promise((ok, fail) => { proc.once('error', fail); proc.once('exit', ok); });
  log.exit = code; log.stderr_tail = err.slice(-400);
  assert.equal(code, 0, out + err);
  const result = out.trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.event === 'result')?.result;
  log.result = { from: result.from, to: result.to, applied: result.applied, backup_format: result.backup?.format };
  assert.equal(result.from, 28); assert.equal(result.to, 29); assert.deepEqual(result.applied, [29]);
  assert.equal(await hash(join(result.backup.dir, 'database.dump')), result.backup.database.sha256);
  const pool2 = new Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: name, max: 1 });
  try {
    const after = await state(pool2, root, join(root, 'products'), 29);
    preserved(before, after, 29);
    log.after_preserved = true;
    // Second invocation must be a no-op (already at 29): retry semantics.
    const p2 = spawn(join(install, 'studio/node/node.exe'), [join(install, 'studio/service/app/dist/studio.mjs'), 'migrate'], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    let o2 = ''; p2.stdout.on('data', (c) => { o2 += c; }); p2.stderr.resume();
    p2.stdin.end(JSON.stringify(payload) + '\n');
    log.rerun_exit = await new Promise((ok) => p2.once('exit', ok));
    const r2 = o2.trim().split('\n').map((l) => JSON.parse(l)).find((e) => e.event === 'result')?.result;
    log.rerun = { from: r2?.from, applied: r2?.applied, new_backup_created: !!r2?.backup };
  } finally { await pool2.end(); }
  console.log(JSON.stringify({ passed: true, database: name, ...log }, null, 1));
} catch (e) {
  console.log(JSON.stringify({ passed: false, database: name, error: e.message, ...log }, null, 1));
  process.exitCode = 1;
}
