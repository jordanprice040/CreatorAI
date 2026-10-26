import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, symlink } from 'node:fs/promises';
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
  dataPath,
  verifyDataLayout,
  phaseLock,
  listening,
  command,
  studioGuard,
  staleCheck,
  read,
  hash,
} from '../scripts/theme-intent-upgrade-v4-core.mjs';
const root = join(ROOT, '.verification', 'theme-v4-guards-' + Date.now());
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
    format: 'theme-intent-helper-simulated-review/4',
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
  assert.equal(
    (await read(join(home, 'theme-intent-v4.lock'))).pid,
    process.pid,
  );
  assert.ok((await read(join(home, 'theme-intent-v4.lock'))).token);
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
test('process-lifetime studio guard serializes separate helper processes', async () => {
  const home = join(root, 'mutex-home');
  await mkdir(home);
  let entered, release;
  const ready = new Promise((ok) => (entered = ok)),
    wait = new Promise((ok) => (release = ok));
  const first = studioGuard(home, async () => {
    entered();
    await wait;
  });
  await ready;
  try {
    await assert.rejects(
      studioGuard(home, async () => assert.fail('Concurrent body ran')),
      /mutex unavailable/,
    );
  } finally {
    release();
    await first;
  }
});
test('stale release refuses a still-live lock owner without side effects', async () => {
  const home = join(root, 'live-home'),
    e = join(root, 'live-e');
  await mkdir(home);
  await mkdir(e);
  await save(join(home, 'studio.json'), { synthetic: true });
  const unlock = await phaseLock(home, e, 'before', { session: 'live', home });
  const old = unlock.record;
  const decision = join(root, 'live-release.json');
  await save(decision, {
    format: 'theme-intent-owner-stale-state-release/4',
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    helper_sha256: await bindings(),
    fixture: true,
    owner_decision: 'SYNTHETIC',
    release_stale_state: true,
    resume_phase: 'release',
    session_id: 'live',
    studio_home: home,
    data_dir: join(home, 'postgres', 'data'),
    evidence_dir: e,
    config_sha256: await hash(join(home, 'studio.json')),
    context_sha256: null,
    lock_sha256: await hash(join(home, 'theme-intent-v4.lock')),
    lock_pid: old.pid,
    lock_token: old.token,
  });
  try {
    await assert.rejects(
      staleCheck(
        { stale_decision: decision, session: 'live', phase: 'release' },
        { home, fixture: true },
        {},
        e,
      ),
      /still alive/,
    );
    assert.equal(
      (await read(join(home, 'theme-intent-v4.lock'))).token,
      old.token,
    );
  } finally {
    await unlock();
  }
});
test('a foreign loopback listener is refused and remains untouched', async () => {
  const home = join(root, 'foreign-home'),
    e = join(root, 'foreign-evidence');
  await mkdir(join(home, 'postgres', 'data'), { recursive: true });
  await mkdir(e);
  await writeFile(join(home, 'postgres/data/PG_VERSION'), '18\n');
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
        join(ROOT, 'scripts', name + '-theme-intent-v4.ps1'),
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
test('inner wrapper also requires install/recovery confirmation switches', async () => {
  const dummy = join(root, 'dummy-review.json');
  await save(dummy, {});
  for (const phase of ['install', 'recover']) {
    const r = await command(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        join(ROOT, 'scripts/upgrade-theme-intent-v4.ps1'),
        '-Phase',
        phase,
        '-EvidenceDir',
        root,
        '-SessionId',
        'guard',
        '-ReviewFile',
        dummy,
      ],
      { allowFailure: true },
    );
    assert.notEqual(r.code, 0);
    assert.match(r.stderr, /Explicit .* switch required on the inner path/);
  }
});

test('desktop PGDATA contract is nested; the old helper reproduces ENOENT', async () => {
  const home = join(root, 'native-layout-home');
  await mkdir(join(home, 'postgres', 'data'), { recursive: true });
  await writeFile(join(home, 'postgres', 'data', 'PG_VERSION'), '18\n');
  const source = await readFile(
    join(ROOT, 'apps/desktop/src-tauri/src/home.rs'),
    'utf8',
  );
  assert.match(
    source,
    /pub fn pg_data[\s\S]*?self\.root\.join\("postgres"\)\.join\("data"\)/,
  );
  const old = await import('../scripts/theme-intent-upgrade-v3-core.mjs');
  await assert.rejects(
    old.managed({}, home, root, () => assert.fail('Old body ran')),
    { code: 'ENOENT' },
  );
  assert.equal(await verifyDataLayout(home), join(home, 'postgres', 'data'));
  assert.equal(dataPath(home), join(home, 'postgres', 'data'));
});
test('flat-only and unsupported-version layouts fail closed without fallback', async () => {
  const home = join(root, 'flat-layout-home');
  await mkdir(join(home, 'postgres'), { recursive: true });
  await writeFile(join(home, 'postgres', 'PG_VERSION'), '18\n');
  await assert.rejects(verifyDataLayout(home), { code: 'ENOENT' });
  await mkdir(join(home, 'postgres', 'data'));
  await writeFile(join(home, 'postgres', 'data', 'PG_VERSION'), '17\n');
  await assert.rejects(verifyDataLayout(home), /17.*18|strictly equal/s);
});
test('a junction at the nested cluster is rejected before any PG command', async () => {
  const home = join(root, 'junction-layout-home'),
    target = join(root, 'junction-target');
  await mkdir(join(home, 'postgres'), { recursive: true });
  await mkdir(target);
  await writeFile(join(target, 'PG_VERSION'), '18\n');
  await symlink(target, dataPath(home), 'junction');
  await assert.rejects(verifyDataLayout(home), /Reparse point/);
});
