const { createRequire } = await import('node:module');
const require = createRequire(new URL('file:///C:/dev/creator_agent/packages/db/package.json'));
const { Pool } = require('pg');
const p = new Pool({ host: '127.0.0.1', port: 55451, user: 'postgres', database: process.argv[2], max: 1 });
const tables = ['plan_requests','workflows','workflow_tasks','budget_reservations','source_retrievals','context_batches','github_operations','marketing_deliveries','portfolio_jobs','desktop_jobs','artifact_previews','payment_operations','study_builds','plan_connections','operations','leases'];
const r = await p.query(`select conrelid::regclass::text t, pg_get_constraintdef(oid) d from pg_constraint where contype='c' and conrelid::regclass::text = any($1) and (pg_get_constraintdef(oid) ilike '%state%' or pg_get_constraintdef(oid) ilike '%status%') order by 1`, [tables]);
for (const x of r.rows) console.log(x.t, '|', x.d.replace(/::text/g,'').slice(0, 400));
// tables with state/status columns not covered by the helper
const c = await p.query(`select table_name, column_name from information_schema.columns where table_schema='public' and column_name in ('state','status') order by 1`);
console.log('ALL state/status columns:', c.rows.map(x => x.table_name + '.' + x.column_name).join(', '));
await p.end();
