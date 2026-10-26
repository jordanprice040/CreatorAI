// Supported backup + read-only before/after preservation. No migration/provider call.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { canonicalHash } from '../packages/domain/dist/index.js';
import { createBackup } from '../packages/db/dist/index.js';
const d = 'tracking/evidence/discovery-semantics-v2-installation/',
  home = 'C:/Users/jorda/AppData/Local/com.creatoragent.studio',
  install = 'C:/Users/jorda/AppData/Local/Creator Agent';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hash = async (p) => sha(await readFile(p));
const plan = await read(
    'tracking/evidence/discovery-semantics-v2-package/installation-plan.json',
  ),
  candidate = await read(
    'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
  );
assert.equal(canonicalHash(candidate), plan.candidate_plan_hash);
assert.equal(await hash(plan.installer_path), plan.installer_sha256);
const review = await read(
  'tracking/evidence/discovery-semantics-v2-package-review-2026-10-22/reviewer-receipt.json',
);
assert.equal(review.status, 'supported_exact_package_and_declarative_bindings');
for (const [p, h] of Object.entries(review.artifact_sha256))
  assert.equal(await hash(p), h, p);
const phase = process.argv[2];
assert.ok(['--check', 'before', 'after'].includes(phase));
if (phase === '--check') {
  console.log(
    'Static pinned package/plan review checks passed; no credentials or DB access.',
  );
  process.exit(0);
}
let raw = '';
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw);
raw = '';
const cfg = await read(join(home, 'studio.json'));
assert.equal(cfg.database.mode, 'managed');
const require = createRequire(
  new URL('../packages/db/package.json', import.meta.url),
);
const { Pool } = require('pg');
const pool = new Pool({
  host: '127.0.0.1',
  port: cfg.database.port,
  database: cfg.database.name,
  user: cfg.database.user,
  password: secret.password,
  max: 1,
  connectionTimeoutMillis: 10000,
  statement_timeout: 15000,
});
const save = (n, v) =>
  writeFile(d + n, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
await mkdir(d, { recursive: true });
async function state() {
  const requests = (await pool.query('select * from plan_requests order by id'))
    .rows;
  assert.ok(!requests.some((r) => ['unknown', 'in_flight'].includes(r.state)));
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from workflow_tasks where state='leased'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int n from workflows where state not in ('succeeded','failed','cancelled')",
      )
    ).rows[0].n,
    0,
  );
  const schema = (
    await pool.query('select max(version)::int n from schema_migrations')
  ).rows[0].n;
  assert.equal(schema, 28);
  const hashes = {};
  for (const [name, sql] of Object.entries({
    requests: 'select * from plan_requests order by id',
    grants: 'select * from plan_verification_grants order by id',
    access:
      'select * from plan_model_access order by connection_id,model_id,path',
    qualifications: 'select * from plan_qualifications order by id',
    connections:
      'select id,version,settings,settings_hash,credits,quota from plan_connections order by id',
  }))
    hashes[name] = canonicalHash(
      JSON.parse(JSON.stringify((await pool.query(sql)).rows)),
    );
  const conn = (
    await pool.query(
      'select settings_hash,credits from plan_connections where id=$1',
      ['7529f8ef-8579-4685-80fc-5df300130667'],
    )
  ).rows[0];
  assert.equal(
    conn.settings_hash,
    '5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533',
  );
  assert.equal(conn.credits.state, 'confirmed_off');
  return {
    observed_at: new Date().toISOString(),
    schema,
    requests: requests.length,
    request_states: Object.fromEntries(
      [...new Set(requests.map((r) => r.state))].map((s) => [
        s,
        requests.filter((r) => r.state === s).length,
      ]),
    ),
    hashes,
    settings_hash: conn.settings_hash,
    credits: conn.credits.state,
    studio_config_sha256: await hash(join(home, 'studio.json')),
  };
}
async function files(base, rel = '') {
  const out = {};
  for (const f of await readdir(join(base, rel), { withFileTypes: true })) {
    const p = join(rel, f.name);
    if (f.isDirectory()) Object.assign(out, await files(base, p));
    else out[p] = await hash(join(base, p));
  }
  return out;
}
try {
  if (phase === 'before') {
    assert.equal(
      await hash(join(install, 'studio/bundle-manifest.json')),
      plan.expected_predecessor_manifest_sha256,
    );
    const before = await state();
    await save('before.json', before);
    const rollback =
      'C:/dev/creator_agent/.verification/discovery-semantics-v2-program-rollback';
    await mkdir(rollback);
    await cp(install, rollback, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const list = await files(install);
    for (const [p, h] of Object.entries(list))
      assert.equal(await hash(join(rollback, p)), h);
    await save('program-rollback.json', {
      dir: rollback,
      files: list,
      verified: true,
    });
    const backupDir = join(home, 'backups', 'discovery-semantics-v2-database');
    const backup = await createBackup({
      databaseUrl: `postgresql://${cfg.database.user}:${encodeURIComponent(secret.password)}@127.0.0.1:${cfg.database.port}/${cfg.database.name}`,
      productsRoot: cfg.products_root,
      outDir: backupDir,
      pgBinDir: cfg.pg_bin,
    });
    assert.equal(
      await hash(join(backupDir, 'database.dump')),
      backup.database.sha256,
    );
    for (const f of backup.products)
      assert.equal(await hash(join(backupDir, 'products', f.path)), f.sha256);
    const homeBackup = join(home, 'backups', 'discovery-semantics-v2-home');
    await mkdir(homeBackup);
    for (const p of ['studio.json', 'secrets', 'plan-credentials'])
      await cp(join(home, p), join(homeBackup, p), {
        recursive: true,
        errorOnExist: true,
        force: false,
      });
    const homeFiles = await files(homeBackup);
    for (const [p, h] of Object.entries(homeFiles))
      assert.equal(await hash(join(home, p)), h);
    await save('backup.json', {
      database: backup,
      dir: backupDir,
      database_hash_verified: true,
      product_hashes_verified: true,
      home_dir: homeBackup,
      home_files: homeFiles,
      program_rollback_verified: true,
      restore_rehearsed: false,
    });
    const unchanged = await state();
    assert.deepEqual(unchanged.hashes, before.hashes);
    await save('prepared.json', {
      prepared_at: new Date().toISOString(),
      installation_plan_hash: canonicalHash(plan),
      candidate_plan_hash: canonicalHash(candidate),
      backup_verified: true,
      program_rollback_files: Object.keys(list).length,
      requests: before.requests,
      provider_calls: 0,
      installed: false,
    });
    console.log(
      JSON.stringify({
        phase,
        schema: 28,
        requests: before.requests,
        backup_verified: true,
        rollback_files: Object.keys(list).length,
        provider_calls: 0,
      }),
    );
  } else {
    const before = await read(d + 'before.json'),
      after = await state();
    assert.deepEqual(after.hashes, before.hashes);
    assert.equal(after.studio_config_sha256, before.studio_config_sha256);
    assert.equal(
      await hash(join(install, 'creator-desktop.exe')),
      plan.packaged_desktop_sha256,
    );
    const bytes = await readFile(join(install, 'studio/bundle-manifest.json'));
    assert.equal(sha(bytes), plan.expected_target_manifest_sha256);
    for (const f of JSON.parse(bytes).files)
      assert.equal(await hash(join(install, 'studio', f.path)), f.sha256);
    const backup = await read(d + 'backup.json');
    assert.equal(
      await hash(join(backup.dir, 'database.dump')),
      backup.database.database.sha256,
    );
    await save('after.json', after);
    await save('installation-receipt.json', {
      status: 'verified_records_preserved',
      verified_at: new Date().toISOString(),
      candidate_plan_hash: canonicalHash(candidate),
      installation_plan_hash: canonicalHash(plan),
      installed_manifest_sha256: plan.expected_target_manifest_sha256,
      installed_desktop_sha256: plan.packaged_desktop_sha256,
      schema: 28,
      records_unchanged: true,
      settings_unchanged: true,
      credits: 'confirmed_off',
      active_requests: 0,
      unknown_requests: 0,
      backup_verified: true,
      provider_calls: 0,
    });
    console.log(
      JSON.stringify({
        phase,
        requests: after.requests,
        records_preserved: true,
        provider_calls: 0,
      }),
    );
  }
} finally {
  delete secret.password;
  await pool.end();
}
