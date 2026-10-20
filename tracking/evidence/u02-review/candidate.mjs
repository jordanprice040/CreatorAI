import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import {
  migrate,
  assertSchemaCurrent,
} from '../../../packages/db/dist/index.js';

const require = createRequire(
  new URL('../../../tests/package.json', import.meta.url),
);
const pg = require('pg');
const root = new URL('../../../', import.meta.url);
const base = '1cf6d6332ece2ad36ad22eea50349b447b791c11';
const current = await import('../../../packages/db/dist/migrations.js');
const oldText = execFileSync(
  'git',
  ['show', `${base}:packages/db/src/migrations.ts`],
  { encoding: 'utf8' },
);
const js = ts.transpileModule(oldText, {
  compilerOptions: { module: ts.ModuleKind.ESNext },
}).outputText;
const old = await import(
  `data:text/javascript;base64,${Buffer.from(js).toString('base64')}`
);
assert.equal(old.migrations.length, 23);
assert.equal(current.migrations.length, 24);
for (const m of old.migrations)
  assert.equal(
    current.migrationChecksum(current.migrations[m.version - 1]),
    old.migrationChecksum(m),
  );
const manifest = JSON.parse(
  readFileSync(new URL('../audit-fixes/source-hashes.json', import.meta.url)),
);
const hashes = {};
for (const [path, expected] of Object.entries(manifest.sha256)) {
  hashes[path] = createHash('sha256')
    .update(readFileSync(new URL(path, root)))
    .digest('hex');
  assert.equal(hashes[path], expected, path);
}
const admin = new pg.Pool({
  connectionString: process.env.CREATOR_TEST_DATABASE_URL,
  max: 1,
});
const name = `creator_review_${randomUUID().replaceAll('-', '')}`;
let pool;
try {
  await admin.query(`create database ${name}`);
  const url = new URL(process.env.CREATOR_TEST_DATABASE_URL);
  url.pathname = `/${name}`;
  pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
  await pool.query(
    'create table schema_migrations(version integer primary key,name text not null,checksum char(64) not null,applied_at timestamptz not null default now())',
  );
  for (const m of old.migrations) {
    await pool.query('begin');
    await pool.query(m.sql);
    await pool.query(
      'insert into schema_migrations(version,name,checksum) values($1,$2,$3)',
      [m.version, m.name, old.migrationChecksum(m)],
    );
    await pool.query('commit');
  }
  const actor = randomUUID();
  await pool.query(
    "insert into actors(id,kind,display_name) values($1,'human','Review preservation sentinel')",
    [actor],
  );
  assert.deepEqual(await migrate(pool), [24]);
  assert.deepEqual(await migrate(pool), []);
  assert.equal(await assertSchemaCurrent(pool), 24);
  assert.equal(
    (await pool.query('select display_name from actors where id=$1', [actor]))
      .rows[0].display_name,
    'Review preservation sentinel',
  );
  const result = {
    candidate: execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
    }).trim(),
    base,
    hashes,
    historical_migrations_unchanged: 23,
    upgrade_applied: [24],
    second_apply: [],
    schema_current: 24,
    existing_actor_preserved: true,
  };
  writeFileSync(
    new URL('candidate.json', import.meta.url),
    `${JSON.stringify(result, null, 2)}\n`,
  );
  console.log(
    'PASS: 14 hashes; migrations 1–23 unchanged; 23→24 upgrade; repeat apply; schema gate; existing actor preserved.',
  );
} finally {
  await pool?.end();
  await admin.query(`drop database if exists ${name} with (force)`);
  await admin.end();
}
