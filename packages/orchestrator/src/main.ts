import pg from 'pg';
import {
  assertSchemaCurrent,
  configuredDatabaseUrl,
  OPERATIONS_ACTOR_ID,
  OpsStore,
  processEnvironment,
  SelectionStore,
} from '@creator/db';
import { deploymentConfig } from '@creator/domain';
import {
  FixtureAdapter,
  ModelBroker,
  liveAdapterFromEnv,
} from '@creator/broker';
import { Worker } from './worker.js';

// Standalone workflow worker: the same loop the API runs in-process, for running work in a
// separate process (or several). Stop with Ctrl+C; workflows keep their durable state.
const env = processEnvironment();
const deployment = deploymentConfig(env);
const url = configuredDatabaseUrl(env);
if (!url) {
  console.error('Set CREATOR_DATABASE_URL to run a workflow worker.');
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 5 });
pool.on('error', (e) =>
  console.error(`PostgreSQL idle client error: ${e.message}`),
);
await assertSchemaCurrent(pool);
// X06: a worker configured for one environment never takes work from another's database.
const ops = new OpsStore(pool);
await ops.ensureOperationsActor();
await ops.claimEnvironment(
  { actorId: OPERATIONS_ACTOR_ID },
  deployment.environment,
);
const store = new SelectionStore(pool);
const broker = new ModelBroker(store, {
  fixture: new FixtureAdapter(),
  live: liveAdapterFromEnv(env),
});
const worker = new Worker(store, broker, {
  log: (m) => console.log(m),
  ...(env.CREATOR_WORKER_POLL_MS
    ? { pollMs: Number(env.CREATOR_WORKER_POLL_MS) }
    : {}),
});
worker.start();
console.log(`Workflow worker ${worker.id} polling ${new URL(url).host}`);
for (const signal of ['SIGINT', 'SIGTERM'] as const)
  process.on(signal, () => {
    void worker.stop().then(() => pool.end());
  });
