// ADR-0057 walk server: the dev studio on THROWAWAY ports 5183/4330/4340 and a throwaway
// database, with a fixture Claude Code connection answered by the test suite's fake `claude`
// (tests/dist/claude-fake.js). No real model is ever called. Prepares one workspace whose
// connection is signed in, credits off, caps accepted and model verified, but which does not
// yet allow private text and has chat answers off, so the walk can do those steps in the UI.
// Usage: CREATOR_DATABASE_URL=postgres://…/<throwaway> node tracking/evidence/chat-answers/serve.mjs
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
  settings,
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
await pool.end();

const web = await createServer({
  root: 'apps/web',
  configFile: 'apps/web/vite.config.ts',
});
await web.listen();
console.log(`READY ws=${ws.id} conn=${conn.id} fake=${host.config_dir}`);
