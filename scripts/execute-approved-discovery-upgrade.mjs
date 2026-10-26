import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
const require = createRequire(
  new URL('../packages/db/package.json', import.meta.url),
);
const { Pool } = require('pg');
let raw = '';
for await (const c of process.stdin) raw += c;
const input = JSON.parse(raw);
raw = '';
const home = input.home,
  install = 'C:/Users/jorda/AppData/Local/Creator Agent';
const cfg = JSON.parse(await readFile(join(home, 'studio.json'), 'utf8'));
const pool = new Pool({
  host: '127.0.0.1',
  port: cfg.database.port,
  database: cfg.database.name,
  user: cfg.database.user,
  password: input.password,
  max: 1,
});
try {
  const states = (
    await pool.query(
      'select state,count(*)::int as count from plan_requests group by state',
    )
  ).rows;
  assert.ok(
    !states.some(
      (r) => ['in_flight', 'unknown'].includes(r.state) && r.count > 0,
    ),
    'Unresolved requests block upgrade',
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int as n from workflow_tasks where state='leased'",
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await pool.query('select max(version)::int as n from schema_migrations'))
      .rows[0].n,
    26,
  );
  const before = (
    await pool.query('select settings_hash from plan_connections where id=$1', [
      '7529f8ef-8579-4685-80fc-5df300130667',
    ])
  ).rows[0];
  assert.equal(
    before.settings_hash,
    '1bfab1b610b53849dadc536a712ffc0b97387686a742740aad4098a53d7351a0',
  );
  const payload = {
    protocol: 'creator-studio/1',
    database_url: `postgresql://${cfg.database.user}:${encodeURIComponent(input.password)}@127.0.0.1:${cfg.database.port}/${cfg.database.name}`,
    products_root: cfg.products_root,
    backups_dir: join(home, 'backups'),
    pg_bin: cfg.pg_bin,
    web_root: null,
    owner_secret: null,
    login_code: null,
    worker_distro: null,
    source: null,
  };
  const child = spawn(
    join(install, 'studio/node/node.exe'),
    [join(install, 'studio/service/app/dist/studio.mjs'), 'migrate'],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let out = '';
  child.stdout.on('data', (c) => (out += c));
  child.stderr.resume();
  child.stdin.end(JSON.stringify(payload) + '\n');
  const code = await new Promise((r) => child.on('exit', r));
  assert.equal(code, 0, 'Supported migration command failed');
  const event = out
    .trim()
    .split('\n')
    .map((l) => JSON.parse(l))
    .find((e) => e.event === 'result');
  assert.equal(event.result.from, 26);
  assert.equal(event.result.to, 27);
  const backup = event.result.backup;
  assert.equal(
    createHash('sha256')
      .update(await readFile(join(backup.dir, 'database.dump')))
      .digest('hex'),
    backup.database.sha256,
  );
  assert.equal(
    (await pool.query('select max(version)::int as n from schema_migrations'))
      .rows[0].n,
    27,
  );
  const receipt = {
    at: new Date().toISOString(),
    owner_approval: 'I approve all of that',
    plan_hash:
      'de5297fdbd86635a6301cf6a53147cebec4bcf467d77dabbfa56132dc16346b4',
    preflight_request_states: states,
    migration: event.result,
    backup_hash_verified: true,
  };
  await writeFile(
    new URL(
      '../tracking/evidence/discovery-qualification-prep/installed-upgrade.json',
      import.meta.url,
    ),
    JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify(receipt));
} finally {
  await pool.end();
  input.password = null;
}
