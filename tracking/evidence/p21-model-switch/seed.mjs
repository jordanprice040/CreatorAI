// Walk seed (not committed): fixture workspace, Claude stand-in connection, two verified models.
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { ConnectionStore } from '../packages/db/dist/index.js';
import { PlanConnectionService } from '../packages/broker/dist/index.js';
import { DEFAULT_OWNER_ACTOR_ID } from '../apps/api/dist/index.js';
import { CLAUDE_EXTRA_USAGE_OFF_STATEMENT } from '../packages/contracts/dist/index.js';
import { SUBSCRIBED, setFake, writeFakeClaude } from './dist/claude-fake.js';

const pool = new pg.Pool({
  connectionString: process.env.CREATOR_DATABASE_URL,
});
const store = new ConnectionStore(pool);
const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };
await store.ensureActor({
  id: owner.actorId,
  kind: 'human',
  display_name: 'Owner',
});
const dir = mkdtempSync(join(tmpdir(), 'walk-'));
const config_dir = join(dir, 'config');
setFake(config_dir, { status: SUBSCRIBED, text: 'Stand-in answer.' });
const service = new PlanConnectionService({
  store,
  vault: null,
  claudeCode: {
    bin: writeFakeClaude(join(dir, 'bin')),
    config_dir,
    work_dir: join(config_dir, 'w'),
  },
  claudeCodeFixtureEnv: { CREATOR_CLAUDE_STAND_IN: 'fake' },
});
const SETTINGS = JSON.parse(
  readFileSync('config/connections/claude-code.json', 'utf8'),
);
const ws = process.env.WS
  ? { id: process.env.WS }
  : await store.createWorkspace(owner, {
      name: 'P21 walk',
      record_mode: 'fixture',
    });
let conn = await store.createPlanConnection(owner, ws.id, {
  kind: 'claude_code',
  label: 'Claude Code (stand-in)',
  settings: { ...SETTINGS, allowed_data_classes: ['synthetic', 'public'] },
});
const cur = async () =>
  (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
await service.checkClaudeCode(owner, ws.id, conn.id);
conn = await cur();
await store.attestPlanCredits(owner, ws.id, conn.id, {
  expected_version: conn.version,
  statement: CLAUDE_EXTRA_USAGE_OFF_STATEMENT,
  checked_on: '2026-11-10',
});
conn = await cur();
await store.acceptPlanCaps(owner, ws.id, conn.id, {
  expected_version: conn.version,
  settings_hash: conn.settings_hash,
});
for (const m of ['claude-walk-sonnet', 'claude-walk-haiku']) {
  conn = await cur();
  const g = await store.createPlanVerificationGrant(owner, ws.id, conn.id, {
    expected_version: conn.version,
    model_id: m,
    path: 'responses',
    expires_in_minutes: 30,
  });
  await service.verifyModel(owner, ws.id, conn.id, { id: g.id, model_id: m });
}
await store.setChatSettings(owner, ws.id, {
  expected_version: 0,
  enabled: true,
  connection_id: conn.id,
  model_id: 'claude-walk-sonnet',
  include_snapshot: true,
  daily_limit: 5,
});
console.log(JSON.stringify({ ws: ws.id, conn: conn.id }));
await pool.end();
