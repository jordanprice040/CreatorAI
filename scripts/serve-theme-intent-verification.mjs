import { createRequire } from 'node:module';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '../apps/api/dist/index.js';
import { migrate, Store } from '../packages/db/dist/index.js';
import { writeFile } from 'node:fs/promises';
const require = createRequire(
  new URL('../packages/db/package.json', import.meta.url),
);
const { Pool } = require('pg');
const admin = new Pool({
  connectionString: 'postgresql://postgres@127.0.0.1:55448/postgres',
});
const db = 'creator_theme_ui_20261023';
await admin.query('create database ' + db);
await admin.end();
const url = 'postgresql://postgres@127.0.0.1:55448/' + db;
const pool = new Pool({ connectionString: url });
await migrate(pool);
const api = createApi({
  CREATOR_DATABASE_URL: url,
  CREATOR_DEV_LOGIN_CODE: 'test-login-code-0123456789abcdefghij',
  CREATOR_WORKER: 'off',
  CREATOR_API_PORT: '4318',
  CREATOR_WEB_PORT: '5188',
  CREATOR_PREVIEW_PORT: '4328',
});
await api.ready();
const store = new Store(pool);
const a = await store.createWorkspace(
  { actorId: DEFAULT_OWNER_ACTOR_ID },
  { name: 'Theme draft browser test', record_mode: 'real' },
);
const b = await store.createWorkspace(
  { actorId: DEFAULT_OWNER_ACTOR_ID },
  { name: 'Other draft workspace', record_mode: 'real' },
);
await writeFile(
  'tracking/evidence/theme-intent-implementation-2026-10-23/browser-environment.json',
  JSON.stringify(
    {
      workspace: a.id,
      other_workspace: b.id,
      api_port: 4318,
      web_port: 5188,
      database: db,
      mode: 'isolated_test_database_real_API_no_providers',
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
api.server.listen(4318, '127.0.0.1');
console.log('Isolated draft API ready on 4318');
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await api.close();
    await pool.end();
    process.exit(0);
  });
