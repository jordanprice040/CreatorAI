import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import net from 'node:net';
import {
  ROOT,
  CANDIDATE,
  PLAN,
  save,
  bindings,
  reviewCheck,
  paths,
  managed,
  phaseLock,
  listening,
  command,
} from '../scripts/theme-intent-upgrade-v2-core.mjs';
const root = join(ROOT, '.verification', 'theme-v2-guards-' + Date.now());
await mkdir(root);
test('sensitive backups cannot enter the tracked repository', async () => {
  await assert.rejects(
    paths(
      {
        home: join(ROOT, 'unapproved-backup-home'),
        install: join(root, 'install'),
        fixture: false,
      },
      join(ROOT, 'tracking/evidence/test-only-never-created'),
      'guards',
    ),
    /Sensitive backup/,
  );
});
test('tampered runtime dependency binding is rejected before loading dependencies', async () => {
  const p = join(root, 'bad-review.json');
  const helper_sha256 = await bindings();
  helper_sha256['packages/db/dist/migrations.js'] = '0'.repeat(64);
  await save(p, {
    format: 'theme-intent-helper-simulated-review/2',
    status: 'fixture_only',
    prior_implementation_involvement: false,
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    helper_sha256,
  });
  await assert.rejects(reviewCheck(p, true));
});
test('different evidence directories share one exclusive studio lock', async () => {
  const home = join(root, 'lock-home');
  await mkdir(home);
  const unlock = await phaseLock(home, 'first-evidence', 'before');
  try {
    await assert.rejects(phaseLock(home, 'second-evidence', 'before'), {
      code: 'EEXIST',
    });
  } finally {
    await unlock();
  }
  const last = await phaseLock(home, 'second-evidence', 'before');
  await last();
});
test('a foreign loopback listener is refused and remains untouched', async () => {
  const home = join(root, 'foreign-home'),
    e = join(root, 'foreign-evidence');
  await mkdir(join(home, 'postgres'), { recursive: true });
  await mkdir(e);
  await writeFile(join(home, 'postgres/PG_VERSION'), '18\n');
  const server = net.createServer((s) => s.end());
  await new Promise((ok, fail) => {
    server.once('error', fail);
    server.listen(0, '127.0.0.1', ok);
  });
  const port = server.address().port;
  try {
    await assert.rejects(
      managed(
        { pg_bin: 'C:/Program Files/PostgreSQL/18/bin', database: { port } },
        home,
        e,
        () => {
          throw new Error('Must not start body');
        },
      ),
      /Foreign listener/,
    );
    assert.ok(await listening(port));
  } finally {
    await new Promise((ok) => server.close(ok));
  }
});
test('install and recovery wrappers deny missing explicit switches before reading files', async () => {
  for (const name of ['install', 'recover']) {
    const r = await command(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        join(ROOT, 'scripts', name + '-theme-intent-v2.ps1'),
        '-EvidenceDir',
        root,
        '-SessionId',
        'denied',
        '-ReviewFile',
        join(root, 'nonexistent'),
        '-ApprovalFile',
        join(root, 'nonexistent'),
      ],
      { allowFailure: true },
    );
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /approval required/);
    assert.ok(!r.stderr.includes('Pre-secret'));
  }
});
