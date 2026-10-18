import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { assertSchemaCurrent, databaseUrl, StudyStore } from '@creator/db';
import { FixtureAdapter, ModelBroker } from '@creator/broker';
import { runPilotRehearsal } from './pilot.js';

// `pnpm pilot <output-dir>`: T14 pilot rehearsal in a new fixture workspace. Fixture adapter
// only (never live). The workspace belongs to the local owner (the same identity the API's
// sign-in uses), so the owner can open it in the studio afterwards.
const url = databaseUrl(process.env.CREATOR_DATABASE_URL);
const out = process.argv[2];
if (!url || !out) {
  console.error(
    'Usage: CREATOR_DATABASE_URL=... pnpm pilot <output-dir> (writes pilot-package.json, reviewer-packet.json, reviewer-key.private.json)',
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 5 });
try {
  await assertSchemaCurrent(pool);
  const store = new StudyStore(pool);
  const broker = new ModelBroker(store, {
    fixture: new FixtureAdapter(),
    live: null,
  });
  const operator =
    process.env.CREATOR_OWNER_ACTOR_ID ??
    '00000000-0000-4000-8000-000000000001';
  await store.ensureActor({
    id: operator,
    kind: 'human',
    display_name: 'Local owner',
  });
  const result = await runPilotRehearsal(store, broker, { actorId: operator });
  const dir = resolve(out);
  mkdirSync(dir, { recursive: true });
  const write = (name: string, value: unknown) =>
    writeFileSync(join(dir, name), `${JSON.stringify(value, null, 2)}\n`);
  write('pilot-package.json', result.package);
  write('reviewer-packet.json', result.reviewer_packet);
  write('reviewer-key.private.json', result.reviewer_key);
  const failed = result.package.checks.filter((c) => c.status === 'fail');
  for (const c of result.package.checks)
    console.log(`${c.status.padEnd(4)} ${c.id}: ${c.detail}`);
  console.log(
    `Package ${result.package.package_hash} in ${dir}; ${failed.length} failed check(s). Not empirical results.`,
  );
  if (failed.length) process.exitCode = 1;
} finally {
  await pool.end();
}
