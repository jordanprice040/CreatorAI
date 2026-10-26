// Disposable-cluster probe: helper dumpSnapshot of a real 28-migration schema, restore into an empty DB, compare state().
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
const run = promisify(execFile);
const R = 'file:///C:/dev/creator_agent/';
const { state, dumpSnapshot, hash } = await import(R + 'scripts/theme-intent-upgrade-core.mjs');
const { migrations, migrationChecksum } = await import(R + 'packages/db/dist/migrations.js');
const require = createRequire(new URL(R + 'packages/db/package.json'));
const { Pool } = require('pg');
const PORT = 55451, S = process.argv[2], name = `theme_restore_${Date.now()}`, restoreName = name + '_r';
const bin = 'C:/pgsql18/pgsql/bin';
const admin = new Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: 'postgres' });
await admin.query(`create database ${name}`); await admin.query(`create database ${restoreName}`); await admin.end();
const pool = new Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: name, max: 1 });
const root = join(S, name);
for (const d of ['secrets', 'plan-credentials', 'products']) await mkdir(join(root, d), { recursive: true });
await writeFile(join(root, 'studio.json'), 'synthetic');
const log = {};
try {
  await pool.query('create table schema_migrations(version integer primary key,name text not null,checksum char(64) not null,applied_at timestamptz not null default now())');
  for (const m of migrations.slice(0, 28)) {
    await pool.query(m.sql);
    await pool.query('insert into schema_migrations(version,name,checksum) values($1,$2,$3)', [m.version, m.name, migrationChecksum(m)]);
  }
  const before = await state(pool, root, join(root, 'products'), 28);
  const t0 = Date.now();
  const dump = join(S, name + '.dump');
  const h = await dumpSnapshot(pool, { database: { user: 'postgres', port: PORT, name }, pg_bin: bin }, '', dump);
  log.dump_ms = Date.now() - t0;
  assert.equal(h, await hash(dump));
  await pool.end();
  const r = await run(join(bin, 'pg_restore.exe'), ['--exit-on-error', '--no-owner', `--dbname=postgresql://postgres@127.0.0.1:${PORT}/${restoreName}`, dump], { windowsHide: true }).then(() => 0, (e) => e.stderr);
  log.restore_error = r || null;
  const rp = new Pool({ host: '127.0.0.1', port: PORT, user: 'postgres', database: restoreName, max: 1 });
  try {
    const restored = await state(rp, root, join(root, 'products'), 28);
    assert.deepEqual(restored.hashes, before.hashes);
    assert.deepEqual(restored.migrations, before.migrations);
    log.tables_compared = Object.keys(before.hashes).length;
    const fn = await rp.query("select count(*)::int n from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public'");
    const tg = await rp.query("select count(*)::int n from pg_trigger where not tgisinternal");
    log.restored_functions = fn.rows[0].n; log.restored_triggers = tg.rows[0].n;
  } finally { await rp.end(); }
  console.log(JSON.stringify({ passed: true, ...log }, null, 1));
} catch (e) { console.log(JSON.stringify({ passed: false, error: e.message, ...log }, null, 1)); process.exitCode = 1; }
