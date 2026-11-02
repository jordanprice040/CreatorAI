// Chat Markdown walk server: the same throwaway setup as ../chat-answers/serve.mjs (ports
// 5183/4330/4340, a throwaway database, a FAKE `claude`; no real model), but the fake answers
// with Markdown: the answer from Jordan's 2026-11-02 screenshot plus code, a table, links and
// hostile HTML/link text, so the walk can check what renders and what stays text.
// Usage: CREATOR_DATABASE_URL=postgres://…/<walk db> node tracking/evidence/chat-markdown/serve.mjs
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
  text: [
    '**Creator Agent is a personal product studio:** a workspace for turning a problem or opportunity into an evidence-backed product concept and specification.',
    '',
    'Based on your studio snapshot, it organizes **sources, claims, problems, and specifications**, with discovery and evidence-gathering runs that involve human input.',
    '',
    '### Its purpose',
    'To make product exploration more structured:',
    '- Identify a specific problem and who experiences it.',
    '- Gather evidence rather than rely only on assumptions.',
    '  - Nested: keep the *sources* you used.',
    '- Define what a potential solution should do.',
    '',
    '### How to use it',
    '1. Open **Projects › Discover** and enter a theme.',
    '2. Run `pnpm cli login <code>` if you use the terminal.',
    '3. Compare options:',
    '',
    '| Option | Cost | Notes |',
    '| :--- | ---: | --- |',
    '| Existing tool | $0 | Try first |',
    '| Custom build | $0–$5 | Needs a spec |',
    '',
    '```',
    'python timing.py --practice',
    '```',
    '',
    '> This is advice only; nothing was started.',
    '',
    'Read more at https://example.com/docs. Unsafe: [click me](javascript:alert(1)) <img src=x onerror=alert(1)> <script>alert(2)</script>',
  ].join('\n'),
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
  name: 'Markdown studio (walk)',
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
