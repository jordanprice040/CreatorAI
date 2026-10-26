import assert from 'node:assert/strict';
import {
  readFile,
  readdir,
  lstat,
  cp,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { join, resolve, relative, isAbsolute } from 'node:path';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../packages/domain/dist/index.js';
import {
  migrations as expected,
  migrationChecksum,
} from '../packages/db/dist/migrations.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);
export const HELPER_FILES = [
  'scripts/theme-intent-upgrade-core.mjs',
  'scripts/upgrade-theme-intent.mjs',
  'scripts/upgrade-theme-intent.ps1',
  'scripts/install-theme-intent.ps1',
];
export async function helperHashes() {
  return Object.fromEntries(
    await Promise.all(HELPER_FILES.map(async (p) => [p, await hash(p)])),
  );
}
export async function reviewed(path) {
  const r = await read(path);
  assert.equal(r.format, 'theme-intent-upgrade-independent-review/1');
  assert.equal(r.status, 'supported_exact_helper');
  assert.equal(r.prior_implementation_involvement, false);
  assert.equal(r.candidate_plan_hash, CANDIDATE);
  assert.equal(r.installation_plan_hash, PLAN);
  assert.deepEqual(r.helper_sha256, await helperHashes());
}
export async function dumpSnapshot(pool, cfg, password, output) {
  await pool.query('begin isolation level repeatable read read only');
  try {
    const id = (await pool.query('select pg_export_snapshot() id')).rows[0].id;
    const target = `postgresql://${encodeURIComponent(cfg.database.user)}@127.0.0.1:${cfg.database.port}/${encodeURIComponent(cfg.database.name)}`;
    await run(
      join(cfg.pg_bin, 'pg_dump.exe'),
      [
        '--format=custom',
        '--no-owner',
        '--no-privileges',
        `--snapshot=${id}`,
        `--file=${output}`,
        `--dbname=${target}`,
      ],
      {
        env: { ...process.env, PGPASSWORD: password },
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      },
    );
  } finally {
    await pool.query('rollback');
  }
  await run(join(cfg.pg_bin, 'pg_restore.exe'), ['--list', output], {
    windowsHide: true,
    maxBuffer: 64 * 1024 * 1024,
  });
  return hash(output);
}

export const CANDIDATE =
  '7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc';
export const PLAN =
  '27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1';
export const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
export const hash = async (p) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
export const save = (p, v) =>
  writeFile(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
export function child(root, path) {
  assert.ok(path && !isAbsolute(path) && !/[:\\]/.test(path));
  const result = resolve(root, path),
    rel = relative(resolve(root), result);
  assert.ok(rel && rel !== '..' && !rel.startsWith('..') && !isAbsolute(rel));
  return result;
}
export async function files(root, rel = '') {
  assert.ok((await lstat(root)).isDirectory(), 'Directory required');
  assert.ok(!(await lstat(root)).isSymbolicLink(), 'Links forbidden');
  const out = {};
  for (const f of await readdir(join(root, rel), { withFileTypes: true })) {
    const path = rel ? rel + '/' + f.name : f.name;
    assert.ok(!f.isSymbolicLink(), 'Links forbidden');
    if (f.isDirectory())
      Object.assign(
        out,
        await files(join(root, path)).then((v) =>
          Object.fromEntries(
            Object.entries(v).map(([k, h]) => [path + '/' + k, h]),
          ),
        ),
      );
    else {
      assert.ok(f.isFile(), 'Special files forbidden');
      out[path] = await hash(child(root, path));
    }
  }
  return out;
}
export async function copyVerified(source, target) {
  const before = await files(source);
  await mkdir(target);
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  assert.deepEqual(await files(source), before);
  assert.deepEqual(await files(target), before);
  return before;
}
export async function program(root, plan, after = false) {
  assert.equal(
    await hash(join(root, 'creator-desktop.exe')),
    after
      ? plan.packaged_desktop_sha256
      : plan.expected_predecessor_native_sha256,
  );
  const p = join(root, 'studio/bundle-manifest.json');
  assert.equal(
    await hash(p),
    after
      ? plan.expected_target_manifest_sha256
      : plan.expected_predecessor_manifest_sha256,
  );
  const manifest = await read(p);
  assert.equal(manifest.files.length, after ? 71 : 67);
  assert.equal(
    new Set(manifest.files.map((f) => f.path)).size,
    manifest.files.length,
  );
  for (const f of manifest.files) {
    const path = child(join(root, 'studio'), f.path);
    assert.ok(!(await lstat(path)).isSymbolicLink());
    assert.equal(await hash(path), f.sha256, f.path);
    assert.equal((await readFile(path)).length, f.bytes);
  }
  // Inspect the complete tree too: a symlinked parent must never escape the program root.
  await files(root);
}
export function fresh(at, now = Date.now()) {
  const age = now - Date.parse(at);
  assert.ok(
    Number.isFinite(age) && age >= 0 && age <= 15 * 60 * 1000,
    'Fresh evidence (<=15 minutes) required',
  );
}
export function approval(a, preparedHash, now = Date.now()) {
  assert.equal(a.format, 'theme-intent-owner-install-approval/1');
  assert.equal(a.candidate_plan_hash, CANDIDATE);
  assert.equal(a.installation_plan_hash, PLAN);
  assert.equal(a.prepared_sha256, preparedHash);
  assert.equal(a.install_and_migrate_28_to_29, true);
  assert.ok(typeof a.owner_decision === 'string' && a.owner_decision.trim());
  fresh(a.approved_at, now);
}
export function preserved(before, after, schema) {
  assert.equal(after.schema, schema);
  assert.deepEqual(after.hashes, before.hashes);
  assert.equal(after.studio_config_sha256, before.studio_config_sha256);
  assert.deepEqual(after.protected_files, before.protected_files);
  assert.deepEqual(after.products, before.products);
  assert.deepEqual(after.migrations.slice(0, 28), before.migrations);
  if (schema === 29) assert.equal(after.migrations.length, 29);
}
export async function state(pool, home, products, schema) {
  const zero = async (sql) =>
    assert.equal(
      (await pool.query(sql)).rows[0].n,
      0,
      'Active/uncertain work blocks upgrade',
    );
  await zero(
    'select count(*)::int n from pg_stat_activity where datname=current_database() and pid <> pg_backend_pid()',
  );
  await zero(
    "select count(*)::int n from plan_requests where state not in ('completed','failed','rejected','reconciled')",
  );
  await zero(
    "select count(*)::int n from workflows where state not in ('succeeded','failed','cancelled')",
  );
  await zero(
    "select count(*)::int n from workflow_tasks where state not in ('succeeded','failed','cancelled')",
  );
  await zero(
    "select count(*)::int n from budget_reservations where status in ('in_flight','unknown')",
  );
  await zero(
    "select count(*)::int n from source_retrievals where state='in_flight'",
  );
  await zero(
    "select count(*)::int n from context_batches where status in ('submitting','submitted','unknown')",
  );
  await zero(
    "select count(*)::int n from github_operations where state in ('dispatched','unknown')",
  );
  await zero(
    "select count(*)::int n from marketing_deliveries where state in ('dispatching','unknown')",
  );
  await zero(
    "select count(*)::int n from portfolio_jobs where state in ('dispatching','unknown')",
  );
  await zero(
    "select count(*)::int n from desktop_jobs where state not in ('completed','cancelled','expired')",
  );
  await zero(
    "select count(*)::int n from artifact_previews where state in ('starting','ready')",
  );
  const migrations = (
    await pool.query(
      'select version,name,checksum from schema_migrations order by version',
    )
  ).rows;
  assert.deepEqual(
    migrations.map((r) => r.version),
    Array.from({ length: schema }, (_, i) => i + 1),
  );
  for (const row of migrations) {
    const known = expected.find((m) => m.version === row.version);
    assert.equal(row.name, known.name);
    assert.equal(row.checksum, migrationChecksum(known));
  }
  const hashes = {};
  // Preserve all pre-existing public records, including settings, grants and historical evidence.
  for (const { tablename } of (
    await pool.query(
      "select tablename from pg_tables where schemaname='public' and tablename <> 'schema_migrations' order by tablename",
    )
  ).rows) {
    assert.match(tablename, /^[a-z_][a-z0-9_]*$/);
    hashes[tablename] = canonicalHash(
      JSON.parse(
        JSON.stringify(
          (
            await pool.query(
              `select * from "${tablename}" order by to_jsonb("${tablename}")::text`,
            )
          ).rows,
        ),
      ),
    );
  }
  const protected_files = {};
  for (const dir of ['secrets', 'plan-credentials'])
    protected_files[dir] = await files(join(home, dir));
  return {
    observed_at: new Date().toISOString(),
    schema,
    migrations,
    hashes,
    protected_files,
    products: await files(products),
    studio_config_sha256: await hash(join(home, 'studio.json')),
  };
}
