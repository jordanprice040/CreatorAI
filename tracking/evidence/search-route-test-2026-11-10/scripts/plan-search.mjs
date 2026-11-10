// Plan-route web search test (Jordan approved 2026-11-10 22:19 UTC: "I would like this done as
// well"). Runs from C:\dev\creator_agent (branch claude/project-thread-vfaz4e) against the dev
// database only. Goes through PlanConnectionService.invoke, so admission, the request record and
// the token stay inside the studio code; this script never sees the token. Chat answers are
// switched on for the test with the owner's setting and switched back off afterwards.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const R = 'C:\\dev\\creator_agent';
const imp = (p) => import(pathToFileURL(join(R, p)).href);
const { default: pg } = await import(pathToFileURL(join(R, 'packages', 'db', 'node_modules', 'pg', 'lib', 'index.js')).href);
const { ConnectionStore } = await imp('packages/db/dist/index.js');
const { PlanConnectionService, planVaultFromEnv } = await imp('packages/broker/dist/index.js');

const WS = '88df6c10-7310-4ec0-b623-7f48046bc447';
const CONN = '4e4a7bec-c1ca-4f31-8f87-b11ed5fc81d4';
const MODEL = 'gpt-6-astra';
const ctx = { actorId: '00000000-0000-4000-8000-000000000001', correlationId: randomUUID() };
const OUT = join(R, 'tracking', 'evidence', 'search-route-test-2026-11-10', 'plan-route');
mkdirSync(OUT, { recursive: true });
const line = readFileSync(join(R, '.env.docker'), 'utf8').split(/\r?\n/).find((l) => l.startsWith('CREATOR_DOCKER_PASSWORD='));
const pw = line.split('=').slice(1).join('=').trim().replace(/^['"]|['"]$/g, '');
const pool = new pg.Pool({ host: '127.0.0.1', port: 55433, user: 'creator', password: pw, database: 'creator_studio', max: 2 });
const store = new ConnectionStore(pool);
const svc = new PlanConnectionService({
  store,
  vault: planVaultFromEnv({ CREATOR_PLAN_VAULT_DIR: join(R, '.creator', 'studio', 'plan-vault') }),
  claudeCode: null,
});
const QUERIES = [
  ['q1-broad', 'Recurring problems that small community organisations report with volunteer scheduling'],
  ['q2-crossfield', 'Methods from aviation checklists applied to home medication management'],
  ['q3-gap', 'Independent evidence on whether shared volunteer calendars or scheduling tools reduce volunteer no-shows'],
];
const INSTRUCTIONS =
  'Use the web search tool (at most 3 searches) to find current, publicly accessible web pages relevant to the research question. Do not answer from memory; only report URLs that appeared in your search results. Return only a JSON object: {"candidates":[{"url":"...","title":"...","why":"one short line"}]} with up to 10 candidates from distinct pages, most useful first.';

// Chat answers carry the owner's text as private_approved, which this connection does not
// allow yet; widen it for the test only, re-accept the same caps, and put it back afterwards.
const conn0 = (await store.planCredentialRef(ctx, WS, CONN)).connection;
writeFileSync(join(OUT, 'connection-settings-before.json'), JSON.stringify({ version: conn0.version, settings: conn0.settings, caps_accepted_at: conn0.caps_accepted_at }, null, 2));
const wideSettings = { ...conn0.settings, allowed_data_classes: [...new Set([...conn0.settings.allowed_data_classes, 'private_approved'])] };
const w = await store.updatePlanSettings(ctx, WS, CONN, { expected_version: conn0.version, settings: wideSettings });
const conn1 = (await store.planCredentialRef(ctx, WS, CONN)).connection;
await store.acceptPlanCaps(ctx, WS, CONN, { expected_version: conn1.version, settings_hash: w.settings_hash ?? conn1.settings_hash });
const before = await store.chatSettings(ctx, WS);
writeFileSync(join(OUT, 'chat-settings-before.json'), JSON.stringify(before, null, 2));
const on = await store.setChatSettings(ctx, WS, {
  expected_version: before.version, enabled: true, connection_id: CONN, model_id: MODEL,
  include_snapshot: false, daily_limit: Math.max(before.daily_limit, 5),
});
const runs = [];
try {
  for (const [id, q] of QUERIES) {
    const started = new Date();
    const t0 = Date.now();
    const r = await svc.invoke(ctx, WS, {
      connection_id: CONN, purpose: 'chat', model_id: MODEL, task_class: null,
      data_class: 'private_approved', run_id: null,
      instructions: INSTRUCTIONS, input: `Question: ${q}`,
      logical_operation_id: randomUUID(), max_output_chars: 8000,
      web_search: { max_calls: 3 },
    });
    const row = { id, query: q, started_at: started.toISOString(), elapsed_ms: Date.now() - t0, request_id: r.request_id, admission: r.admission ?? null, outcome: r.outcome };
    writeFileSync(join(OUT, `${id}.json`), JSON.stringify(row, null, 2));
    runs.push(row);
    console.log(id, r.outcome.kind, r.outcome.reason_code ?? '', 'calls', r.outcome.search_calls?.length, 'ms', row.elapsed_ms);
    if (r.outcome.kind !== 'completed' && !r.outcome.retry_allowed && r.outcome.kind !== 'failed') break;
  }
} finally {
  const after = await store.setChatSettings(ctx, WS, {
    expected_version: on.version, enabled: before.enabled, connection_id: before.connection_id,
    model_id: before.model_id, include_snapshot: before.include_snapshot, daily_limit: before.daily_limit,
  });
  writeFileSync(join(OUT, 'chat-settings-after.json'), JSON.stringify(after, null, 2));
  const c2 = (await store.planCredentialRef(ctx, WS, CONN)).connection;
  const back = await store.updatePlanSettings(ctx, WS, CONN, { expected_version: c2.version, settings: conn0.settings });
  const c3 = (await store.planCredentialRef(ctx, WS, CONN)).connection;
  await store.acceptPlanCaps(ctx, WS, CONN, { expected_version: c3.version, settings_hash: back.settings_hash ?? c3.settings_hash });
  const c4 = (await store.planCredentialRef(ctx, WS, CONN)).connection;
  writeFileSync(join(OUT, 'connection-settings-after.json'), JSON.stringify({ version: c4.version, settings: c4.settings, caps_accepted_at: c4.caps_accepted_at, same_settings_as_before: JSON.stringify(c4.settings) === JSON.stringify(conn0.settings) }, null, 2));
  await pool.end();
}
