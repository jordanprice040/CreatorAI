// Read-only authoritative full-record reconciliation; API request history is paginated.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { canonicalHash } from '../packages/domain/dist/index.js';
const d = 'tracking/evidence/discovery-semantics-v2-runner/',
  a =
    'tracking/evidence/discovery-semantics-v2-live-authorization/availability/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const suite = await read(d + 'execution-outcome.json'),
  probe = await read(a + 'result.json'),
  grant = await read(a + 'grant.json'),
  before = await read(
    'tracking/evidence/discovery-semantics-v2-installation/before.json',
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
  const requests = (await pool.query('select * from plan_requests order by id'))
    .rows;
  const ids = new Set([
    probe.request_id,
    ...suite.results.map((x) => x.request_id),
  ]);
  assert.equal(ids.size, 13);
  assert.equal(requests.length, before.requests + 13);
  assert.equal(
    hash(requests.filter((x) => !ids.has(x.id))),
    before.hashes.requests,
  );
  assert.ok(requests.every((r) => !['in_flight', 'unknown'].includes(r.state)));
  for (const id of ids) {
    const r = requests.find((r) => r.id === id);
    assert.ok(r);
    assert.equal(r.state, 'completed');
  }
  const pr = requests.find((r) => r.id === probe.request_id);
  assert.equal(pr.grant_id, grant.id);
  assert.equal(pr.purpose, 'availability_recheck');
  const grants = (
    await pool.query('select * from plan_verification_grants order by id')
  ).rows;
  const g = grants.find((g) => g.id === grant.id);
  assert.equal(g.used, 1);
  assert.equal(g.max_requests, 1);
  assert.equal(g.intent, 'availability_recheck');
  assert.equal(
    hash(grants.filter((g) => g.id !== grant.id)),
    before.hashes.grants,
  );
  const qs = (await pool.query('select * from plan_qualifications order by id'))
    .rows;
  const qids = new Set(suite.decisions.map((q) => q.id));
  assert.equal(
    hash(qs.filter((q) => !qids.has(q.id))),
    before.hashes.qualifications,
  );
  assert.equal(
    hash(
      (
        await pool.query(
          'select * from plan_model_access order by connection_id,model_id,path',
        )
      ).rows,
    ),
    before.hashes.access,
  );
  const conn = (
    await pool.query(
      'select settings_hash,credits from plan_connections where id=$1',
      ['7529f8ef-8579-4685-80fc-5df300130667'],
    )
  ).rows[0];
  assert.equal(conn.settings_hash, before.settings_hash);
  assert.equal(conn.credits.state, 'confirmed_off');
  const result = {
    format: 'research14-readiness-prior-record-reconciliation/1',
    verified_at: new Date().toISOString(),
    mode: 'read_only_sql',
    saved_requests: requests.length,
    request_states: Object.fromEntries(
      [...new Set(requests.map((r) => r.state))].map((s) => [
        s,
        requests.filter((r) => r.state === s).length,
      ]),
    ),
    new_requests: 13,
    suite_requests: 12,
    availability_requests: 1,
    all_new_requests_completed: true,
    old44_requests_unchanged: true,
    old_grants_access_qualifications_unchanged: true,
    new_availability_grant_used_once: true,
    settings_credits_unchanged: true,
    active: 0,
    unknown: 0,
    provider_calls: 0,
    api_history_page_limit_observed: 50,
  };
  await writeFile(
    'tracking/evidence/discovery-research14-readiness/full-record-reconciliation.json',
    JSON.stringify(result, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify(result));
} finally {
  delete secret.password;
  await pool.end();
}
