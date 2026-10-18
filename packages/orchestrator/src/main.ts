import pg from 'pg';
import { assertSchemaCurrent, databaseUrl, WorkflowStore } from '@creator/db';
import {
  FixtureAdapter,
  ModelBroker,
  liveAdapterFromEnv,
} from '@creator/broker';
import { Worker } from './worker.js';

// Standalone workflow worker: the same loop the API runs in-process, for running work in a
// separate process (or several). Stop with Ctrl+C; workflows keep their durable state.
const url = databaseUrl(process.env.CREATOR_DATABASE_URL);
if (!url) {
  console.error('Set CREATOR_DATABASE_URL to run a workflow worker.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 5 });
pool.on('error', (e) =>
  console.error(`PostgreSQL idle client error: ${e.message}`),
);
await assertSchemaCurrent(pool);
const store = new WorkflowStore(pool);
const broker = new ModelBroker(store, {
  fixture: new FixtureAdapter(),
  live: liveAdapterFromEnv(process.env),
});
const worker = new Worker(store, broker, {
  log: (m) => console.log(m),
  ...(process.env.CREATOR_WORKER_POLL_MS
    ? { pollMs: Number(process.env.CREATOR_WORKER_POLL_MS) }
    : {}),
});
worker.start();
console.log(`Workflow worker ${worker.id} polling ${new URL(url).host}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void worker.stop().then(() => pool.end());
  });
