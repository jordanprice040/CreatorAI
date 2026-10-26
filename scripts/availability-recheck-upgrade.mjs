// Supported migration/backup plus before/after integrity. Password arrives only on stdin.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { canonicalHash } from '../packages/domain/dist/index.js';
const dir = 'tracking/evidence/availability-recheck-implementation/';
const home = 'C:/Users/jorda/AppData/Local/com.creatoragent.studio';
const install = 'C:/Users/jorda/AppData/Local/Creator Agent';
const phase = process.argv[2];
assert.ok(['before', 'migrate', 'after'].includes(phase));
let raw = '';
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw);
raw = '';
const cfg = JSON.parse(await readFile(join(home, 'studio.json'), 'utf8'));
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
const sha = (b) => createHash('sha256').update(b).digest('hex');
const save = (name, obj) =>
  writeFile(dir + name, JSON.stringify(obj, null, 2) + '\n', { flag: 'wx' });
async function state() {
  const requests = (await pool.query('select * from plan_requests order by id'))
    .rows;
  assert.ok(
    !requests.some((r) => r.state === 'unknown' || r.state === 'in_flight'),
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
    (
      await pool.query(
        "select count(*)::int as n from workflows where state not in ('succeeded','failed','cancelled')",
      )
    ).rows[0].n,
    0,
  );
  const conn = (
    await pool.query(
      'select settings_hash,quota,credits from plan_connections where id=$1',
      ['7529f8ef-8579-4685-80fc-5df300130667'],
    )
  ).rows[0];
  assert.equal(
    conn.settings_hash,
    '5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533',
  );
  assert.equal(conn.credits.state, 'confirmed_off');
  const grants = (
    await pool.query('select * from plan_verification_grants order by id')
  ).rows.map(({ intent, ...r }) => r);
  return {
    schema: (
      await pool.query('select max(version)::int as n from schema_migrations')
    ).rows[0].n,
    requests: requests.length,
    request_records_hash: canonicalHash(JSON.parse(JSON.stringify(requests))),
    grants_hash_without_new_intent: canonicalHash(
      JSON.parse(JSON.stringify(grants)),
    ),
    model_access_hash: canonicalHash(
      JSON.parse(
        JSON.stringify(
          (
            await pool.query(
              'select * from plan_model_access order by connection_id,model_id,path',
            )
          ).rows,
        ),
      ),
    ),
    qualifications_hash: canonicalHash(
      JSON.parse(
        JSON.stringify(
          (await pool.query('select * from plan_qualifications order by id'))
            .rows,
        ),
      ),
    ),
    ...conn,
  };
}
try {
  if (phase === 'before') {
    const observed = await state();
    assert.equal(observed.schema, 27);
    await save('before-upgrade.json', observed);
    const rollback =
      'C:/dev/creator_agent/.verification/availability-recheck-program-rollback';
    await mkdir(rollback);
    await cp(install, rollback, {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    const files = {};
    async function walk(base, rel = '') {
      for (const f of await readdir(join(base, rel), { withFileTypes: true })) {
        const p = join(rel, f.name);
        if (f.isDirectory()) await walk(base, p);
        else files[p] = sha(await readFile(join(base, p)));
      }
    }
    await walk(install);
    for (const [p, h] of Object.entries(files))
      assert.equal(sha(await readFile(join(rollback, p))), h);
    await save('program-rollback.json', {
      dir: rollback,
      files,
      verified: true,
    });
    console.log(
      JSON.stringify({
        phase,
        schema: observed.schema,
        requests: observed.requests,
        rollback_files: Object.keys(files).length,
      }),
    );
  } else if (phase === 'migrate') {
    assert.equal((await state()).schema, 27);
    const plan = JSON.parse(
      await readFile(dir + 'candidate-plan.json', 'utf8'),
    );
    assert.equal(
      sha(await readFile(join(install, 'studio/bundle-manifest.json'))),
      plan.bundle_manifest_sha256,
    );
    await save('migration.lock', {
      at: new Date().toISOString(),
      from: 27,
      to: 28,
    });
    const payload = {
      protocol: 'creator-studio/1',
      database_url: `postgresql://${cfg.database.user}:${encodeURIComponent(secret.password)}@127.0.0.1:${cfg.database.port}/${cfg.database.name}`,
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
    child.stdout.on('data', (c) => {
      out += c;
    });
    child.stderr.resume();
    child.stdin.end(JSON.stringify(payload) + '\n');
    const exitCode = await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('exit', resolve);
    });
    assert.equal(
      exitCode,
      0,
      'Supported migration failed; do not repeat blindly.',
    );
    const event = out
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
      .find((e) => e.event === 'result');
    assert.ok(event?.result?.backup);
    assert.equal(event.result.from, 27);
    assert.equal(event.result.to, 28);
    const backup = event.result.backup;
    assert.equal(
      sha(await readFile(join(backup.dir, 'database.dump'))),
      backup.database.sha256,
    );
    await save('migration-result.json', {
      ...event.result,
      backup_hash_verified: true,
    });
    console.log(
      JSON.stringify({ phase, from: 27, to: 28, backup_hash_verified: true }),
    );
  } else {
    const observed = await state();
    assert.equal(observed.schema, 28);
    const before = JSON.parse(
      await readFile(dir + 'before-upgrade.json', 'utf8'),
    );
    for (const key of [
      'requests',
      'request_records_hash',
      'grants_hash_without_new_intent',
      'model_access_hash',
      'qualifications_hash',
      'settings_hash',
    ])
      assert.deepEqual(observed[key], before[key], key);
    const intents = (
      await pool.query(
        'select intent,count(*)::int as n from plan_verification_grants group by intent',
      )
    ).rows;
    assert.ok(intents.every((r) => r.intent === 'model_access'));
    await save('after-upgrade.json', {
      ...observed,
      intents,
      records_preserved: true,
    });
    console.log(
      JSON.stringify({
        phase,
        schema: observed.schema,
        requests: observed.requests,
        records_preserved: true,
      }),
    );
  }
} finally {
  delete secret.password;
  await pool.end();
}
