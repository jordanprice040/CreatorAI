import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { migrate } from '../packages/db/dist/index.js';

const require = createRequire(
  new URL('../packages/db/package.json', import.meta.url),
);
const pg = require('pg');
const url = new URL(process.env.CREATOR_TEST_DATABASE_URL);
assert.ok(
  ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname),
  'Disposable loopback test server required',
);
const out = resolve(process.argv[2] ?? '.verification/t19-rehearsal');
const name = `creator_test_t19_${randomBytes(6).toString('hex')}`;
const admin = new pg.Pool({ connectionString: url.toString(), max: 1 });
let created = false;
try {
  await admin.query(`create database ${name}`);
  created = true;
  url.pathname = `/${name}`;
  const db = new pg.Pool({ connectionString: url.toString(), max: 1 });
  try {
    await migrate(db);
  } finally {
    await db.end();
  }
  mkdirSync(out, { recursive: true });
  const run = (script, args) => {
    const result = spawnSync(process.execPath, [script, ...args], {
      env: { ...process.env, CREATOR_DATABASE_URL: url.toString() },
      encoding: 'utf8',
      windowsHide: true,
    });
    process.stdout.write(result.stdout ?? '');
    process.stderr.write(result.stderr ?? '');
    if (result.error) throw result.error;
    assert.equal(result.status, 0, `${script} failed`);
  };
  run('packages/orchestrator/dist/evaluate-main.js', [
    'rehearsal',
    join(out, 'private-evaluation'),
  ]);
  const pkg = JSON.parse(
    readFileSync(
      join(out, 'private-evaluation/evaluation-package.json'),
      'utf8',
    ),
  );
  assert.equal(pkg.empirical_results, false);
  assert.equal(pkg.mode, 'rehearsal');
  assert.equal(pkg.schedule.slots.length, 26);
  assert.ok(pkg.checks.every((c) => c.status !== 'fail'));
  run('packages/orchestrator/dist/analyze-main.js', [
    join(out, 'private-evaluation'),
    join(out, 'public-analysis'),
  ]);
  const analysis = JSON.parse(
    readFileSync(join(out, 'public-analysis/analysis.json'), 'utf8'),
  );
  assert.equal(analysis.data_kind, 'not_empirical');
  console.log(
    'PASS: 26-slot fixture A/B/C and discovery rehearsal; analysis remains not empirical. Private evaluation folder must not be distributed.',
  );
} finally {
  if (created) await admin.query(`drop database ${name} with (force)`);
  await admin.end();
}
