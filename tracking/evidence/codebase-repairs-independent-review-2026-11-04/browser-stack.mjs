// U02 review browser fixture (independent of the repair's script, same review ports).
// Throwaway database on CREATOR_TEST_DATABASE_URL, production-built UI, worker off, no live
// provider, no source fetching. Seeds one older-prompt pass (independent_review) and one
// current-prompt pass (patch_build) so both labels can be compared. Create the marker file
// .verification/review-2026-11-04/stop-browser to close the stack and drop its database.
import { readFile, access } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { createApi } from '../../../apps/api/dist/index.js';
import { freshDatabase } from '../../../tests/dist/pg-harness.js';
import { ConnectionStore } from '../../../packages/db/dist/index.js';
import {
  BUILD_ROLE_PROMPTS,
  canonicalHash,
} from '../../../packages/domain/dist/index.js';
import { preview } from '../../../node_modules/vite/dist/node/index.js';

const STOP = '.verification/review-2026-11-04/stop-browser';
const after = [];
const db = await freshDatabase({
  after(fn) {
    after.push(fn);
  },
  skip() {
    throw Error('test DB required');
  },
});
process.env.CREATOR_API_PORT = '4330';
process.env.CREATOR_PREVIEW_PORT = '4340';
process.env.CREATOR_WEB_PORT = '5183';
const api = createApi({
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  CREATOR_API_PORT: '4330',
  CREATOR_PREVIEW_PORT: '4340',
  CREATOR_WEB_PORT: '5183',
  CREATOR_DATABASE_URL: db.url,
  CREATOR_WORKER: 'off',
  CREATOR_LIVE_PROVIDER: 'none',
  CREATOR_SOURCE_FETCH: 'off',
  CREATOR_DEV_LOGIN_CODE: 'u02-review-walk-code-0123456789abcdefgh',
});
await api.ready();
await new Promise((r) => api.server.listen(4330, '127.0.0.1', r));
await new Promise((r) => api.preview.listen(4340, '127.0.0.1', r));
const store = new ConnectionStore(db.pool);
const owner = { actorId: '00000000-0000-4000-8000-000000000001' };
const ws = await store.createWorkspace(owner, {
  name: 'U02 review fixture',
  record_mode: 'fixture',
});
const settings = JSON.parse(
  await readFile('config/connections/chatgpt-plan.json', 'utf8'),
);
const conn = await store.createPlanConnection(owner, ws.id, {
  label: 'U02 qualification fixture',
  settings,
});
const insert = async (taskClass, systemText) => {
  const manifest = {
    cases: [{ input: [{ role: 'system', text: systemText }] }],
  };
  await db.pool.query(
    `insert into plan_qualifications (id, connection_id, model_id, task_class, manifest, manifest_hash, min_held_out_cases, floor, state, development, held_out, created_by) values ($1,$2,'fixture-model',$3,$4,$5,3,$6,'qualified',$7,$7,$8)`,
    [
      randomUUID(),
      conn.id,
      taskClass,
      manifest,
      canonicalHash(manifest),
      { numerator: 1, denominator: 1 },
      { passed: 3, total: 3 },
      owner.actorId,
    ],
  );
};
await insert(
  'independent_review',
  'independent-reviewer/0: older fixture prompt',
);
await insert('patch_build', BUILD_ROLE_PROMPTS.builder);
const web = await preview({
  root: 'apps/web',
  configFile: 'apps/web/vite.config.ts',
});
console.log(
  JSON.stringify({
    web: 'http://127.0.0.1:5183',
    workspace: ws.id,
    connection: conn.id,
    fixture_only: true,
    worker: 'off',
  }),
);
let closing = false;
const timer = setInterval(async () => {
  if (closing) return;
  try {
    await access(STOP);
  } catch {
    return;
  }
  closing = true;
  clearInterval(timer);
  await new Promise((r) => web.httpServer.close(r));
  await api.close();
  for (const fn of after.reverse()) await fn();
  console.log('Browser fixture closed and database removed.');
  process.exit(0);
}, 500);
