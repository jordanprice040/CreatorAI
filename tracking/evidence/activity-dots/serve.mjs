// Activity dots walk server: the dev studio on THROWAWAY ports 5183/4330/4340 and a throwaway
// database, with a fixture Claude Code connection answered by the test suite's fake `claude`
// (tests/dist/claude-fake.js). No real model is ever called. Same setup as
// tracking/evidence/chat-answers/serve.mjs, plus private text allowed and chat answers turned
// on, and one fixture run the walk can ask approvals on (written straight to the throwaway
// database by walk.mjs, standing in for an agent asking).
// Usage: CREATOR_DATABASE_URL=postgres://…/<throwaway> node tracking/evidence/activity-dots/serve.mjs
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'vite';
import {
  createApi,
  DEFAULT_OWNER_ACTOR_ID,
} from '../../../apps/api/dist/index.js';
import { PlanConnectionService } from '../../../packages/broker/dist/index.js';
import { ConnectionStore, migrate } from '../../../packages/db/dist/index.js';
import {
  SUBSCRIBED,
  setFake,
  writeFakeClaude,
} from '../../../tests/dist/claude-fake.js';
import { CLAUDE_EXTRA_USAGE_OFF_STATEMENT } from '../../../packages/contracts/dist/index.js';

const pg = createRequire(
  new URL('../../../packages/db/package.json', import.meta.url),
)('pg');
const url = process.env.CREATOR_DATABASE_URL;
if (!url || !/throwaway|walk/.test(url))
  throw new Error('Use a throwaway database whose name contains "walk".');
const dir = mkdtempSync(join(tmpdir(), 'chat-walk-'));
const host = {
  bin: writeFakeClaude(join(dir, 'bin')),
  config_dir: join(dir, 'config'),
  work_dir: join(dir, 'config', 'empty-workdir'),
};
setFake(host.config_dir, {
  status: SUBSCRIBED,
  text: 'A frame timer that runs in the terminal is the smallest first build: it needs no account, no payments and no web hosting. Start with one practice mode and add others once you have used it for a week.\n\nThis is advice only; open Projects › Discover to start a discovery yourself.',
});
const env = {
  ...process.env,
  CREATOR_API_PORT: '4330',
  CREATOR_WEB_PORT: '5183',
  CREATOR_PREVIEW_PORT: '4340',
  CREATOR_DEV_LOGIN_CODE: 'walk-login-code-0123456789abcdefghijkl',
  CREATOR_WORKER: 'off',
};
for (const [k, v] of Object.entries(env)) process.env[k] = v;
const service = (store, extra) =>
  new PlanConnectionService({
    store,
    vault: null,
    claudeCode: host,
    claudeCodeFixtureEnv: { CREATOR_CLAUDE_STAND_IN: 'fake' },
    ...extra,
  });
const pool = new pg.Pool({ connectionString: url });
await migrate(pool);
const {
  server: api,
  preview,
  config,
  ready,
} = createApi(env, {
  planService: service,
});
await new Promise((r) => api.listen(config.api_port, config.host, r));
await new Promise((r) => preview.listen(config.preview_port, config.host, r));
await ready();

const store = new ConnectionStore(pool);
const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };
const svc = service(store, {});
const ws = await store.createWorkspace(owner, {
  name: 'Timing studio (walk)',
  record_mode: 'fixture',
});
const settings = JSON.parse(
  readFileSync(
    new URL('../../../config/connections/claude-code.json', import.meta.url),
    'utf8',
  ),
);
let conn = await store.createPlanConnection(owner, ws.id, {
  kind: 'claude_code',
  label: 'Claude Code on this computer',
  settings: {
    ...settings,
    allowed_data_classes: [
      ...settings.allowed_data_classes,
      'private_approved',
    ],
  },
});
const cur = async () =>
  (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
await svc.checkClaudeCode(owner, ws.id, conn.id);
conn = await cur();
await store.attestPlanCredits(owner, ws.id, conn.id, {
  expected_version: conn.version,
  statement: CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  checked_on: '2026-11-01',
});
conn = await cur();
await store.acceptPlanCaps(owner, ws.id, conn.id, {
  expected_version: conn.version,
  settings_hash: conn.settings_hash,
});
conn = await cur();
const g = await store.createPlanVerificationGrant(owner, ws.id, conn.id, {
  expected_version: conn.version,
  model_id: 'claude-sonnet-5-5',
  path: 'responses',
  expires_in_minutes: 30,
});
await svc.verifyModel(owner, ws.id, conn.id, {
  id: g.id,
  model_id: 'claude-sonnet-5-5',
});
await store.setChatSettings(owner, ws.id, {
  expected_version: 0,
  enabled: true,
  connection_id: conn.id,
  model_id: 'claude-sonnet-5-5',
  include_snapshot: false,
  daily_limit: 20,
});
const runEntity = await store.createEntity(owner, ws.id, {
  kind: 'run',
  title: 'Activity dots walk run',
  body: {
    state: 'queued',
    experiment_condition: 'human_in_loop',
    discovery_method: 'structured',
    config_hash: null,
  },
});
const run = await store.registerRun(owner, ws.id, {
  run: { id: runEntity.id, version: 1 },
  autonomy_mode: 'human_in_loop',
  stage_gates: null,
  initial_grants: [],
});
await pool.end();

const web = await createServer({
  root: 'apps/web',
  configFile: 'apps/web/vite.config.ts',
});
await web.listen();
console.log(`READY ws=${ws.id} run=${run.run_id} conn=${conn.id}`);
