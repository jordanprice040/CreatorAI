// Read-only recovery of the receipt after a helper asserted an omitted API field.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../packages/domain/dist/index.js';
const dir = 'tracking/evidence/availability-recheck-live-2026-10-22/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const provider = await read(dir + 'provider-result.json');
const grant = await read(dir + 'grant.json');
const before = await read(dir + 'before.json');
const after = await read(dir + 'after.json');
const upgradeBefore = await read(
  'tracking/evidence/availability-recheck-implementation/before-upgrade.json',
);
let raw = '';
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw);
raw = '';
const cfg = await read(
  'C:/Users/jorda/AppData/Local/com.creatoragent.studio/studio.json',
);
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
  statement_timeout: 15000,
  connectionTimeoutMillis: 10000,
});
const hash = (v) => canonicalHash(JSON.parse(JSON.stringify(v)));
try {
  const r = (
    await pool.query('select * from plan_requests where id=$1', [
      provider.request_id,
    ])
  ).rows[0];
  assert.equal(r.grant_id, grant.id);
  assert.equal(r.purpose, 'availability_recheck');
  assert.equal(r.state, 'completed');
  assert.equal(r.output_hash, createHash('sha256').update('ok').digest('hex'));
  const savedGrant = (
    await pool.query('select * from plan_verification_grants where id=$1', [
      grant.id,
    ])
  ).rows[0];
  assert.equal(savedGrant.used, 1);
  assert.equal(savedGrant.max_requests, 1);
  assert.equal(savedGrant.intent, 'availability_recheck');
  assert.equal(savedGrant.model_id, r.model_id);
  assert.equal(savedGrant.connection_id, r.connection_id);
  const records = (await pool.query('select * from plan_requests order by id'))
    .rows;
  assert.equal(records.length, before.request_ids.length + 1);
  assert.ok(
    records.every((p) => p.state !== 'in_flight' && p.state !== 'unknown'),
  );
  assert.equal(
    hash(records.filter((p) => p.id !== r.id)),
    upgradeBefore.request_records_hash,
  );
  assert.equal(
    hash(
      (
        await pool.query(
          'select * from plan_model_access order by connection_id,model_id,path',
        )
      ).rows,
    ),
    upgradeBefore.model_access_hash,
  );
  assert.equal(
    hash(
      (await pool.query('select * from plan_qualifications order by id')).rows,
    ),
    upgradeBefore.qualifications_hash,
  );
  const oldGrants = (
    await pool.query(
      'select * from plan_verification_grants where id<>$1 order by id',
      [grant.id],
    )
  ).rows.map(({ intent, ...g }) => g);
  assert.equal(hash(oldGrants), upgradeBefore.grants_hash_without_new_intent);
  assert.deepEqual(after.model_access, before.model_access);
  assert.deepEqual(after.qualifications, before.qualifications);
  const conn = (
    await pool.query(
      'select settings_hash,credits,quota from plan_connections where id=$1',
      [r.connection_id],
    )
  ).rows[0];
  assert.equal(conn.settings_hash, upgradeBefore.settings_hash);
  assert.equal(conn.credits.state, 'confirmed_off');
  assert.equal(conn.quota.state, 'available');
  assert.equal(
    (await pool.query('select max(version)::int as n from schema_migrations'))
      .rows[0].n,
    28,
  );
  assert.equal(
    (
      await pool.query(
        "select count(*)::int as n from workflow_tasks where state='leased'",
      )
    ).rows[0].n,
    0,
  );
  const requestsLast24h = (
    await pool.query(
      "select count(*)::int as n from plan_requests where connection_id=$1 and started_at>clock_timestamp()-interval '24 hours'",
      [r.connection_id],
    )
  ).rows[0].n;
  const result = {
    finalized_at: new Date().toISOString(),
    available: provider.available,
    request_id: r.id,
    grant_id: r.grant_id,
    grant_used: savedGrant.used,
    outcome: provider.outcome,
    quota: conn.quota,
    schema: 28,
    saved_requests: records.length,
    prior_35_request_records_unchanged: true,
    prior_grants_access_qualifications_unchanged: true,
    settings_unchanged: true,
    credits: conn.credits.state,
    last_24h_requests: requestsLast24h,
    remaining_daily_requests: 40 - requestsLast24h,
    in_flight: 0,
    unresolved: 0,
    new_provider_requests: 1,
    retry: false,
    qualification_dispatched: false,
    helper_final_assertion_recovered_read_only: true,
    recovery_reason:
      'API PlanRequestSchema omits grant_id; exact persisted binding verified via SELECT, without repeating provider delivery.',
  };
  await writeFile(
    dir + 'final-result.json',
    JSON.stringify(result, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify(result));
} finally {
  delete secret.password;
  await pool.end();
}
