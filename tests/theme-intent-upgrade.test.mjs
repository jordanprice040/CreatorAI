import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import {
  CANDIDATE,
  PLAN,
  approval,
  fresh,
  preserved,
  child,
  files,
  copyVerified,
  state,
  dumpSnapshot,
  hash,
  reviewed,
} from '../scripts/theme-intent-upgrade-core.mjs';
import {
  migrations,
  migrationChecksum,
} from '../packages/db/dist/migrations.js';
const run = promisify(execFile);
const good = {
  format: 'theme-intent-owner-install-approval/1',
  candidate_plan_hash: CANDIDATE,
  installation_plan_hash: PLAN,
  prepared_sha256: 'snapshot',
  install_and_migrate_28_to_29: true,
  owner_decision: 'Synthetic test decision only',
  approved_at: new Date().toISOString(),
};
test('exact approval rejects old grants, wrong candidate/plan/snapshot and absent migration authority', () => {
  approval(good, 'snapshot');
  for (const [key, value] of Object.entries({
    format: 'old-grant',
    candidate_plan_hash: 'old',
    installation_plan_hash: 'old',
    prepared_sha256: 'old',
    install_and_migrate_28_to_29: false,
    owner_decision: '',
  }))
    assert.throws(() => approval({ ...good, [key]: value }, 'snapshot'), key);
});
test('stale, future and invalid timestamps fail closed', () => {
  for (const v of [
    'bad',
    new Date(Date.now() + 100000).toISOString(),
    new Date(Date.now() - 16 * 60000).toISOString(),
  ])
    assert.throws(() => fresh(v));
});
test('unsafe rollback/resource paths cannot escape', () => {
  for (const v of ['../other', '/absolute', 'C:/file', 'a\\b', 'a/../../b', ''])
    assert.throws(() => child('root', v));
});
test('verified copy detects corruption and refuses directory reuse', async () => {
  const d = await mkdtemp(join(tmpdir(), 'theme-helper-'));
  await mkdir(join(d, 'source'));
  await mkdir(join(d, 'source/sub'));
  await writeFile(join(d, 'source/sub/file'), 'original');
  const map = await copyVerified(join(d, 'source'), join(d, 'copy'));
  assert.deepEqual(await files(join(d, 'copy')), map);
  await assert.rejects(copyVerified(join(d, 'source'), join(d, 'copy')));
  await writeFile(join(d, 'copy/sub/file'), 'corrupt');
  assert.notDeepEqual(await files(join(d, 'copy')), map);
});
test('schema29 acceptance binds pre-existing rows, protected config, products and prior ledger', () => {
  const before = {
    schema: 28,
    hashes: { requests: 'a', grants: 'b' },
    studio_config_sha256: 'cfg',
    protected_files: { secrets: 's' },
    products: { p: 'p' },
    migrations: Array.from({ length: 28 }, (_, i) => ({ version: i + 1 })),
  };
  const after = {
    ...before,
    schema: 29,
    migrations: [...before.migrations, { version: 29 }],
  };
  preserved(before, after, 29);
  for (const [key, value] of Object.entries({
    schema: 28,
    hashes: { requests: 'changed' },
    studio_config_sha256: 'changed',
    protected_files: {},
    products: {},
    migrations: [{ version: 29 }],
  }))
    assert.throws(() => preserved(before, { ...after, [key]: value }, 29), key);
});
test('quiescence rejects each active/unknown work category before reading records', async () => {
  for (let blocked = 0; blocked < 12; blocked++) {
    let n = 0;
    await assert.rejects(
      state(
        { query: async () => ({ rows: [{ n: n++ === blocked ? 1 : 0 }] }) },
        'unused',
        'unused',
        28,
      ),
      /Active\/uncertain/,
    );
  }
});
test('unreviewed helper cannot admit installation', async () => {
  const d = await mkdtemp(join(tmpdir(), 'theme-review-'));
  const p = join(d, 'review.json');
  await writeFile(
    p,
    JSON.stringify({
      format: 'theme-intent-upgrade-independent-review/1',
      status: 'supported_exact_helper',
      prior_implementation_involvement: true,
      candidate_plan_hash: CANDIDATE,
      installation_plan_hash: PLAN,
    }),
  );
  await assert.rejects(reviewed(p));
});
test('installer rejects missing explicit invocation approval before reading files or secrets', async () => {
  await assert.rejects(
    run(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        'scripts/install-theme-intent.ps1',
        '-EvidenceDir',
        'missing-test-only',
        '-ApprovalFile',
        'missing-test-only',
      ],
      { windowsHide: true },
    ),
    /New explicit owner/,
  );
});
test('full isolated schema28 to29 preserves table fingerprints and rejects altered ledger', async () => {
  assert.equal(process.env.THEME_HELPER_TEST_PORT, '55451');
  const require = createRequire(
    new URL('../packages/db/package.json', import.meta.url),
  );
  const { Pool } = require('pg');
  const name = `theme_state_${Date.now()}`;
  const admin = new Pool({
    host: '127.0.0.1',
    port: 55451,
    user: 'postgres',
    database: 'postgres',
  });
  await admin.query(`create database ${name}`);
  await admin.end();
  const pool = new Pool({
    host: '127.0.0.1',
    port: 55451,
    user: 'postgres',
    database: name,
    max: 1,
  });
  const root = await mkdtemp(join(tmpdir(), 'theme-state-'));
  for (const dir of ['secrets', 'plan-credentials', 'products'])
    await mkdir(join(root, dir));
  await writeFile(join(root, 'studio.json'), 'synthetic config');
  await writeFile(join(root, 'secrets/test'), 'synthetic');
  try {
    await pool.query(
      'create table schema_migrations(version integer primary key,name text,checksum char(64))',
    );
    for (const m of migrations.slice(0, 28)) {
      await pool.query(m.sql);
      await pool.query('insert into schema_migrations values($1,$2,$3)', [
        m.version,
        m.name,
        migrationChecksum(m),
      ]);
    }
    const before = await state(pool, root, join(root, 'products'), 28);
    const m = migrations[28];
    await pool.query(m.sql);
    await pool.query('insert into schema_migrations values($1,$2,$3)', [
      m.version,
      m.name,
      migrationChecksum(m),
    ]);
    preserved(before, await state(pool, root, join(root, 'products'), 29), 29);
    await pool.query(
      "update schema_migrations set checksum=repeat('0',64) where version=29",
    );
    await assert.rejects(state(pool, root, join(root, 'products'), 29));
  } finally {
    await pool.end();
  }
});
test('real isolated schema28 dump is readable and restores exact sentinel rows', async () => {
  assert.equal(
    process.env.THEME_HELPER_TEST_PORT,
    '55451',
    'Start only the disposable test cluster on 55451',
  );
  const require = createRequire(
    new URL('../packages/db/package.json', import.meta.url),
  );
  const { Pool } = require('pg');
  const cfg = {
    database: {
      user: 'postgres',
      port: 55451,
      name: `theme_dump_${Date.now()}`,
    },
    pg_bin: 'C:/Program Files/PostgreSQL/18/bin',
  };
  const admin = new Pool({
    host: '127.0.0.1',
    port: 55451,
    user: 'postgres',
    database: 'postgres',
  });
  const restoreName = cfg.database.name + '_restore';
  await admin.query(`create database ${cfg.database.name}`);
  await admin.query(`create database ${restoreName}`);
  await admin.end();
  const pool = new Pool({
    host: '127.0.0.1',
    port: 55451,
    user: 'postgres',
    database: cfg.database.name,
    max: 1,
  });
  const d = await mkdtemp(join(tmpdir(), 'theme-dump-'));
  try {
    await pool.query(
      "create table schema_migrations(version int primary key,name text,checksum text); create table sentinel(id int primary key,value text); insert into sentinel values(1,'preserved schema28')",
    );
    for (const m of migrations.slice(0, 28))
      await pool.query('insert into schema_migrations values($1,$2,$3)', [
        m.version,
        m.name,
        migrationChecksum(m),
      ]);
    const dump = join(d, 'database.dump');
    const h = await dumpSnapshot(pool, cfg, '', dump);
    assert.equal(h, await hash(dump));
    await run(
      join(cfg.pg_bin, 'pg_restore.exe'),
      [
        '--exit-on-error',
        '--no-owner',
        `--dbname=postgresql://postgres@127.0.0.1:55451/${restoreName}`,
        dump,
      ],
      { windowsHide: true },
    );
    const restored = new Pool({
      host: '127.0.0.1',
      port: 55451,
      user: 'postgres',
      database: restoreName,
    });
    try {
      assert.deepEqual((await restored.query('select * from sentinel')).rows, [
        { id: 1, value: 'preserved schema28' },
      ]);
      assert.equal(
        (await restored.query('select count(*)::int n from schema_migrations'))
          .rows[0].n,
        28,
      );
    } finally {
      await restored.end();
    }
    await writeFile(dump, 'corruption');
    assert.notEqual(await hash(dump), h);
    await assert.rejects(
      run(join(cfg.pg_bin, 'pg_restore.exe'), ['--list', dump], {
        windowsHide: true,
      }),
    );
  } finally {
    await pool.end();
  }
});
