import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import pg from 'pg';
import { assertSchemaCurrent, databaseUrl, StudyStore } from '@creator/db';
import { FixtureAdapter, ModelBroker } from '@creator/broker';
import type { EvaluationTask } from '@creator/domain';
import { planFinalEvaluation, runEvaluationRehearsal } from './evaluation.js';

// `pnpm evaluate rehearsal <out-dir>`: T15 schedule rehearsal on synthetic tasks (fixture only).
// `pnpm evaluate final <workspace> <tasks.json> <out-dir>`: binds the owner's adopted freeze and
// final tasks to a recorded schedule; refuses without a freeze. Nothing is ever sent anywhere.
const [mode, ...args] = process.argv.slice(2);
const url = databaseUrl(process.env.CREATOR_DATABASE_URL);
const out =
  mode === 'rehearsal' ? args[0] : mode === 'final' ? args[2] : undefined;
if (!url || !out) {
  console.error(
    'Usage: CREATOR_DATABASE_URL=... pnpm evaluate rehearsal <out-dir>\n' +
      '       CREATOR_DATABASE_URL=... pnpm evaluate final <workspace-id> <tasks.json> <out-dir>',
  );
  process.exit(1);
}
const pool = new pg.Pool({ connectionString: url, max: 5 });
try {
  await assertSchemaCurrent(pool);
  const store = new StudyStore(pool);
  const operator =
    process.env.CREATOR_OWNER_ACTOR_ID ??
    '00000000-0000-4000-8000-000000000001';
  await store.ensureActor({
    id: operator,
    kind: 'human',
    display_name: 'Local owner',
  });
  const owner = { actorId: operator };
  let result;
  if (mode === 'rehearsal') {
    const broker = new ModelBroker(store, {
      fixture: new FixtureAdapter(),
      live: null,
    });
    result = await runEvaluationRehearsal(store, broker, owner);
  } else {
    const availability = JSON.parse(
      readFileSync(resolve('config/provider-availability.json'), 'utf8'),
    ) as {
      live_dispatch_enabled: boolean;
      verified_api_model_id: string | null;
    };
    const tasks = JSON.parse(
      readFileSync(args[1]!, 'utf8'),
    ) as EvaluationTask[];
    result = await planFinalEvaluation(store, owner, args[0]!, tasks, {
      live_ai: {
        enabled: availability.live_dispatch_enabled,
        verified_model_id: availability.verified_api_model_id,
      },
      final_study_records: false,
      ai_implementation: false,
    });
  }
  const dir = resolve(out);
  const write = (name: string, value: unknown) => {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      typeof value === 'string' ? value : `${JSON.stringify(value, null, 2)}\n`,
    );
  };
  write('evaluation-package.json', result.package);
  for (const [name, body] of Object.entries(result.reviewer_files))
    write(name, body);
  write('private/assignment-key.json', result.private_key);
  for (const e of result.raw_exports)
    write(`private/raw-exports/${e.key}.json`, e.body);
  for (const c of result.package.checks)
    console.log(`${c.status.padEnd(4)} ${c.id}: ${c.detail}`);
  console.log(`States: ${JSON.stringify(result.package.counts)}`);
  for (const f of result.package.reviewer_packets.owner_review_flags)
    console.log(`flag ${f}`);
  const failed = result.package.checks.filter((c) => c.status === 'fail');
  console.log(
    `Package ${result.package.package_hash} in ${dir}; ${failed.length} failed check(s). Not empirical results. reviewers/ is shareable only after owner review; private/ never is.`,
  );
  if (failed.length) process.exitCode = 1;
} catch (e) {
  const err = e as { message: string; details?: string[] };
  console.error(
    `Refused: ${err.message}${err.details?.length ? `\n  ${err.details.join('\n  ')}` : ''}`,
  );
  process.exitCode = 2;
} finally {
  await pool.end();
}
