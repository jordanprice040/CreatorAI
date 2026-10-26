// Read-only operational inspection; DPAPI values arrive only on stdin.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { PlanConnectionDetailSchema } from '../packages/contracts/dist/index.js';
let raw = '';
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw);
raw = '';
const phase = process.argv[2];
assert.ok(['preflight', 'installed', 'postrun'].includes(phase));
const plan = JSON.parse(
  await readFile(
    new URL(
      '../tracking/evidence/discovery-qualification-v4/execution-plan.json',
      import.meta.url,
    ),
  ),
);
const api = async (path) => {
  const r = await fetch('http://127.0.0.1:4310/api/' + path, {
    headers: { Cookie: `creator_session=${secret.session.token}` },
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(r.ok, `Read-only API ${r.status}`);
  return r.json();
};
const session = await api('auth/session');
assert.equal(session.authenticated, true);
const path = `workspaces/${plan.workspace_id}/plan-connections/${plan.connection_id}`;
const { sign_in_attempt, ...d } = await api(path);
const detail = PlanConnectionDetailSchema.parse(d);
assert.equal(detail.connection.settings_hash, plan.proposed_settings_hash);
if (phase !== 'postrun') {
  assert.equal(detail.usage.in_flight, 0);
  assert.equal(detail.usage.unresolved, 0);
}
const requests = await api(path + '/requests');
const cfg = JSON.parse(
  await readFile(
    'C:/Users/jorda/AppData/Local/com.creatoragent.studio/studio.json',
    'utf8',
  ),
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
  password: secret.database_password,
  max: 1,
});
try {
  const schema = (
    await pool.query(
      'select max(version)::int as version from schema_migrations',
    )
  ).rows[0].version;
  assert.equal(schema, 27);
  const leased = (
    await pool.query(
      "select count(*)::int as n from workflow_tasks where state='leased'",
    )
  ).rows[0].n;
  assert.equal(leased, 0);
  const counts = (
    await pool.query(
      'select (select count(*)::int from workflows) as workflows,(select count(*)::int from audit_events) as audit_events,(select count(*)::int from plan_requests) as plan_requests',
    )
  ).rows[0];
  const receipt = {
    at: new Date().toISOString(),
    phase,
    schema,
    leased,
    counts,
    detail,
    requests,
  };
  await writeFile(
    new URL(
      `../tracking/evidence/v4-timeout-reconciliation/${phase}-state.json`,
      import.meta.url,
    ),
    JSON.stringify(receipt, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      phase,
      schema,
      leased,
      counts,
      usage: detail.usage,
      blockers: detail.blockers,
      qualifications: detail.qualifications.map((q) => ({
        id: q.id,
        task_class: q.task_class,
        state: q.state,
        manifest_hash: q.manifest_hash,
      })),
    }),
  );
} finally {
  await pool.end();
}
