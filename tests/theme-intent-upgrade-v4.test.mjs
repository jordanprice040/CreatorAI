import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdir,
  writeFile,
  readFile,
  cp,
  readdir,
  lstat,
  symlink,
  rename,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ROOT,
  CANDIDATE,
  PLAN,
  command,
  save,
  read,
  hash,
  bindings,
  loadDatabase,
  listening,
  canonicalHash,
  files,
  reviewCheck,
  paths,
  layout,
} from '../scripts/theme-intent-upgrade-v4-core.mjs';

const bin = 'C:/Program Files/PostgreSQL/18/bin';
const root = join(ROOT, '.verification', 'theme-helper-v4-' + Date.now());
const home = join(root, 'home'),
  install = join(root, 'program'),
  products = join(root, 'products');
// Match the managed desktop's generated hexadecimal credential format.
const password = 'a'.repeat(64);
const port = 55455;
let context, review, cfg, deps;
const observed = [];
const stamp = () => randomUUID().replaceAll('-', '').slice(0, 12);
async function ctl(action) {
  await command(join(bin, 'pg_ctl.exe'), [
    action,
    '-D',
    join(home, 'postgres', 'data'),
    ...(action === 'start'
      ? [
          '-l',
          join(root, 'postgres.log'),
          '-o',
          `-p ${port} -c listen_addresses=127.0.0.1`,
        ]
      : ['-m', 'fast']),
    '-w',
    '-t',
    '60',
  ]);
}
function pool(database = cfg.database.name) {
  return new deps.Pool({
    host: '127.0.0.1',
    port,
    user: 'postgres',
    password,
    database,
    max: 1,
  });
}
async function database() {
  const name = 'helper_' + stamp();
  await ctl('start');
  try {
    const admin = pool('postgres');
    await admin.query(`create database ${name}`);
    await admin.end();
    const q = pool(name);
    try {
      await q.query(
        'create table schema_migrations(version integer primary key,name text,checksum char(64))',
      );
      for (const m of deps.migrations.slice(0, 28)) {
        await q.query(m.sql);
        await q.query('insert into schema_migrations values($1,$2,$3)', [
          m.version,
          m.name,
          deps.migrationChecksum(m),
        ]);
      }
      const actor = randomUUID(),
        ws = randomUUID(),
        entity = randomUUID(),
        conn = randomUUID();
      await q.query(
        "insert into actors(id,kind,display_name) values($1,'human','Synthetic sentinel')",
        [actor],
      );
      await q.query(
        "insert into workspaces(id,name,record_mode,fixture,created_by) values($1,'Helper fixture','fixture',true,$2)",
        [ws, actor],
      );
      await q.query(
        "insert into entities(id,workspace_id,fixture,kind,version,status,title,body,content_hash,created_by) values($1,$2,true,'problem',1,'active','Preserve sentinel',$3,$4,$5)",
        [
          entity,
          ws,
          { text: 'synthetic persisted body' },
          'a'.repeat(64),
          actor,
        ],
      );
      await q.query(
        "insert into plan_connections(id,workspace_id,fixture,version,label,settings,settings_hash,ext_agent_host_id,sign_in,credits,eligibility,quota,created_by) values($1,$2,true,1,'Synthetic connection',$3,$4,$5,'{}','{}','{}','{}',$6)",
        [
          conn,
          ws,
          { synthetic: true },
          'b'.repeat(64),
          'urn:uuid:' + randomUUID(),
          actor,
        ],
      );
      await q.query(
        "insert into plan_model_access(connection_id,model_id,path,access,request_id) values($1,'synthetic','responses','verified',$2)",
        [conn, randomUUID()],
      );
      await q.query(
        "insert into plan_requests(id,connection_id,logical_operation_id,path,purpose,model_id,data_class,state,created_by,finished_at) values($1,$2,$3,'responses','verification','synthetic','synthetic','completed',$4,clock_timestamp())",
        [randomUUID(), conn, randomUUID(), actor],
      );
      await q.query(
        "insert into plan_verification_grants(id,connection_id,model_id,path,max_requests,expires_at,created_by) values($1,$2,'synthetic','responses',1,now()+interval '1 day',$3)",
        [randomUUID(), conn, actor],
      );
      await q.query(
        "insert into plan_qualifications(id,connection_id,model_id,task_class,manifest,manifest_hash,min_held_out_cases,floor,state,development,held_out,created_by) values($1,$2,'synthetic','fixture','{}',$3,3,'{}','qualified','{}','{}',$4)",
        [randomUUID(), conn, 'c'.repeat(64), actor],
      );
      return { name, actor, ws, entity, conn };
    } finally {
      await q.end();
    }
  } finally {
    await ctl('stop');
  }
}
async function setDatabase(name) {
  cfg.database.name = name;
  await writeFile(join(home, 'studio.json'), JSON.stringify(cfg));
}
async function predecessor() {
  await mkdir(install, { recursive: true });
  await cp(
    join(ROOT, '.verification/discovery-semantics-v2-artifacts/studio'),
    join(install, 'studio'),
    { recursive: true, force: true },
  );
  await cp(
    join(
      ROOT,
      '.verification/discovery-semantics-v2-artifacts/packaged-creator-desktop.exe',
    ),
    join(install, 'creator-desktop.exe'),
    { force: true },
  );
}
async function call(
  phase,
  s,
  {
    approval,
    failAt,
    child,
    reviewPath = review,
    installSwitch = false,
    clock,
    hold,
    cwd,
    staleFile,
  } = {},
) {
  if (
    phase === 'recover' &&
    !staleFile &&
    (await lstat(join(home, 'theme-intent-v4.lock')).then(
      () => true,
      () => false,
    ))
  )
    staleFile = await staleDecision(s, phase);
  if (failAt?.startsWith('hard-crash-')) {
    const p = join(root, 'crash-request-' + stamp() + '.json');
    await save(p, {
      phase,
      evidence: s.e,
      session: s.id,
      review: reviewPath,
      test_context: context,
      approval,
      fail_at: failAt,
      presecret: false,
      install_and_migrate_approved: phase === 'install',
      coordinated_recovery_approved: phase === 'recover',
      stale_decision: staleFile,
    });
    // Real CLI process-death probe; wrapper/DPAPI composition is exercised by the normal cases.
    return command(
      process.execPath,
      [join(ROOT, 'scripts/theme-intent-upgrade-v4.mjs'), p],
      {
        input: JSON.stringify({ password }),
        exitOnly: true,
        allowFailure: true,
        timeout: 180000,
      },
    );
  }
  const script = installSwitch
    ? 'install-theme-intent-v4.ps1'
    : 'upgrade-theme-intent-v4.ps1';
  const args = [
    '-NoProfile',
    '-File',
    join(ROOT, 'scripts', script),
    '-EvidenceDir',
    s.e,
    '-SessionId',
    s.id,
    '-ReviewFile',
    reviewPath,
    '-TestContext',
    context,
  ];
  if (installSwitch) args.push('-InstallAndMigrateApproved');
  else args.push('-Phase', phase);
  if (phase === 'recover') args.push('-CoordinatedRecoveryApproved');
  if (staleFile) args.push('-StaleDecisionFile', staleFile);
  if (approval) args.push('-ApprovalFile', approval);
  if (failAt) args.push('-FailAt', failAt);
  if (child) args.push('-ChildFixture', child);
  if (clock) args.push('-TestClockMs', String(clock));
  if (hold) args.push('-HoldLockMs', String(hold));
  return command('powershell.exe', args, {
    timeout: 180000,
    allowFailure: true,
    cwd,
  });
}
async function staleDecision(s, phase, overrides = {}) {
  const lock = join(home, 'theme-intent-v4.lock'),
    old = await read(lock),
    p = join(root, 'stale-' + stamp() + '.json');
  await save(p, {
    format: 'theme-intent-owner-stale-state-release/4',
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    helper_sha256: await bindings(),
    fixture: true,
    owner_decision: 'SYNTHETIC STALE RELEASE ONLY',
    release_stale_state: true,
    resume_phase: phase,
    session_id: s.id,
    studio_home: home,
    data_dir: join(home, 'postgres', 'data'),
    evidence_dir: s.e,
    config_sha256: await hash(join(home, 'studio.json')),
    context_sha256: await hash(context),
    lock_sha256: await hash(lock),
    lock_pid: old.pid,
    lock_token: old.token,
    allow_stop_owned_cluster: true,
    ...overrides,
  });
  return p;
}
async function session() {
  const id = 'test-' + stamp();
  return { id, e: join(root, 'evidence-' + id) };
}
async function approve(s, at = Date.now()) {
  const p = join(root, 'approve-' + s.id + '.json');
  await save(p, {
    format: 'theme-intent-owner-install-approval/4',
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    prepared_sha256: await hash(join(s.e, 'prepared.json')),
    install_and_migrate_28_to_29: true,
    owner_decision: 'SYNTHETIC TEST ONLY',
    fixture: true,
    approved_at: new Date(at).toISOString(),
  });
  return p;
}
async function recover(s, { failAt } = {}) {
  const p = join(root, 'recover-' + stamp() + '.json');
  const decision = {
    format: 'theme-intent-owner-recovery-approval/4',
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    prepared_sha256: await hash(join(s.e, 'prepared.json')),
    fixture: true,
    owner_decision: 'SYNTHETIC RECOVERY ONLY',
    decision_id: stamp(),
    restore_schema28_program_protected_products: true,
    reinstall_predecessor_and_relocate_config: true,
    allow_stop_owned_cluster: true,
  };
  const lock = join(home, 'theme-intent-v4.lock');
  if (
    await lstat(lock).then(
      () => true,
      () => false,
    )
  )
    decision.stale_lock_sha256 = await hash(lock);
  await save(p, decision);
  const r = await call('recover', s, { approval: p, failAt });
  if (failAt) {
    assert.notEqual(r.code, 0);
    return;
  }
  assert.equal(r.code, 0, r.stderr);
  assert.ok(!(await listening(port)));
  const out = await read(
    join(s.e, 'recovery-result-' + decision.decision_id + '.json'),
  );
  assert.equal(out.schema, 28);
  return out;
}

test(
  'v4 real wrapper lifecycle, populated state, admission, faults and recovery',
  { timeout: 900000 },
  async (t) => {
    assert.ok(!(await listening(port)), 'Disposable port already occupied');
    await mkdir(root);
    await writeFile(join(root, 'TEST_ONLY'), 'synthetic helper test\n');
    for (const p of [
      home,
      products,
      join(home, 'secrets'),
      join(home, 'plan-credentials'),
    ])
      await mkdir(p, { recursive: true });
    await writeFile(join(products, 'sentinel.txt'), 'synthetic product');
    await writeFile(
      join(home, 'plan-credentials/vault'),
      'synthetic plan vault',
    );
    const pwfile = join(root, 'initpw');
    await writeFile(pwfile, password + '\n');
    await command(join(bin, 'initdb.exe'), [
      '-D',
      join(home, 'postgres', 'data'),
      '-U',
      'postgres',
      '--auth=scram-sha-256',
      '--encoding=UTF8',
      '--no-locale',
      `--pwfile=${pwfile}`,
    ]);
    await command('powershell.exe', [
      '-NoProfile',
      '-Command',
      "Add-Type -AssemblyName System.Security; $p=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('" +
        Buffer.from(password).toString('base64') +
        "')); [IO.File]::WriteAllBytes('" +
        join(home, 'secrets/postgres.dpapi').replaceAll("'", "''") +
        "',[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($p),[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres'),[Security.Cryptography.DataProtectionScope]::CurrentUser))",
    ]);
    cfg = {
      database: {
        mode: 'managed',
        user: 'postgres',
        name: 'helper_initial',
        port,
      },
      pg_bin: bin,
      products_root: products,
    };
    deps = await loadDatabase();
    await predecessor();
    context = join(root, 'context.json');
    await save(context, {
      format: 'theme-intent-helper-test-layout/4',
      root,
      home,
      install,
      installer: join(root, 'fixture-installer.ps1'),
    });
    await cp(
      join(ROOT, 'tests/fixtures/theme-intent-v4-installer.ps1'),
      join(root, 'fixture-installer.ps1'),
    );
    review = join(root, 'review.json');
    await save(review, {
      format: 'theme-intent-helper-simulated-review/4',
      status: 'fixture_only',
      prior_implementation_involvement: false,
      candidate_plan_hash: CANDIDATE,
      installation_plan_hash: PLAN,
      helper_sha256: await bindings(),
    });
    await writeFile(join(home, 'studio.json'), JSON.stringify(cfg));
    try {
      await t.test(
        'native layout fails pre-secret with the credential unavailable',
        async () => {
          const data = join(home, 'postgres', 'data');
          const moved = join(home, 'postgres', 'fixture-cluster-held');
          const blob = join(home, 'secrets/postgres.dpapi');
          await rename(data, moved);
          await rename(blob, blob + '.held');
          // A valid flat version marker must never cause adoption of the wrong directory.
          await writeFile(join(home, 'postgres', 'PG_VERSION'), '18\n');
          try {
            const s = await session();
            const r = await call('before', s);
            assert.notEqual(r.code, 0);
            assert.match(r.stderr, /Pre-secret/);
            assert.match(r.stderr, /postgres.*data/s);
            assert.ok(!r.stderr.includes('ReadAllBytes'));
            await assert.rejects(lstat(s.e));
            await assert.rejects(lstat(join(home, 'theme-intent-v4.lock')));
            assert.ok(!(await listening(port)));
            observed.push(
              'native layout presecret failure with unavailable DPAPI',
            );
          } finally {
            await rename(moved, data);
            await rename(blob + '.held', blob);
          }
        },
      );
      await t.test(
        'blocked review rejects before DPAPI or backup access',
        async () => {
          const bad = join(root, 'blocked.json');
          await save(bad, {
            format: 'theme-intent-helper-simulated-review/4',
            status: 'blocked_changes_required',
          });
          const s = await session();
          const r = await call('before', s, { reviewPath: bad });
          assert.notEqual(r.code, 0);
          assert.match(r.stderr, /Pre-secret/);
          await assert.rejects(lstat(s.e));
          observed.push('blocked review presecret');
        },
      );
      await t.test(
        'junction ancestors and operational reuse of fixture review are rejected',
        async () => {
          const alias = join(root, 'alias-home');
          await symlink(home, alias, 'junction');
          const bad = join(root, 'bad-context.json');
          const c = await read(context);
          c.home = alias;
          await save(bad, c);
          const { plan } =
            await import('../scripts/theme-intent-upgrade-v4-core.mjs').then(
              (m) => m.packageCheck(),
            );
          await assert.rejects(layout(bad, plan), /Reparse point/);
          await assert.rejects(reviewCheck(review, false));
        },
      );
      const seeded = await database();
      await setDatabase(seeded.name);
      await t.test(
        'running qualifications block the real before phase',
        async () => {
          await ctl('start');
          let q = pool();
          await q.query("update plan_qualifications set state='running'");
          await q.end();
          await ctl('stop');
          const blocked = await session();
          const r = await call('before', blocked);
          assert.notEqual(r.code, 0);
          assert.match(r.stderr, /Active\/uncertain/);
          assert.ok(!(await listening(port)));
          await ctl('start');
          q = pool();
          await q.query("update plan_qualifications set state='qualified'");
          await q.end();
          await ctl('stop');
        },
      );
      await t.test(
        'a pre-existing managed cluster is not silently adopted or stopped',
        async () => {
          await ctl('start');
          try {
            const r = await call('before', await session());
            assert.notEqual(r.code, 0);
            assert.ok(await listening(port));
          } finally {
            await ctl('stop');
          }
        },
      );
      for (const point of ['before-snapshot', 'before-protected-copy'])
        await t.test(
          'partial before death: ' +
            point +
            ' can release without prepared data or credentials',
          async () => {
            const partial = await session();
            const r = await call('before', partial, {
              failAt: 'hard-crash-' + point,
            });
            assert.equal(r.code, 77, r.stderr);
            assert.ok(await listening(port));
            await assert.rejects(lstat(join(partial.e, 'prepared.json')));
            await assert.rejects(
              lstat(
                join(
                  home,
                  'backups',
                  'theme-intent-v4-' + partial.id,
                  'protected/studio.json',
                ),
              ),
            );
            const bad = await staleDecision(partial, 'release', {
              lock_sha256: '0'.repeat(64),
            });
            assert.notEqual(
              (await call('release', partial, { staleFile: bad })).code,
              0,
            );
            assert.ok(await listening(port));
            const opts = join(home, 'postgres/data/postmaster.opts'),
              originalOpts = await readFile(opts, 'utf8');
            await writeFile(
              opts,
              originalOpts.replace(
                /creator-upgrade-[0-9a-f-]+/,
                'foreign-owner',
              ),
            );
            const denied = await staleDecision(partial, 'release');
            assert.notEqual(
              (await call('release', partial, { staleFile: denied })).code,
              0,
            );
            assert.ok(await listening(port));
            await writeFile(opts, originalOpts);
            const blob = join(home, 'secrets/postgres.dpapi'),
              held = join(root, 'held-dpapi-' + stamp());
            await (await import('node:fs/promises')).rename(blob, held);
            try {
              const permit = await staleDecision(partial, 'release');
              const done = await call('release', partial, {
                staleFile: permit,
              });
              assert.equal(done.code, 0, done.stderr);
              assert.ok(!(await listening(port)));
              await assert.rejects(lstat(join(home, 'theme-intent-v4.lock')));
              assert.ok(
                (await readdir(partial.e)).some((p) =>
                  p.startsWith('retired-lock-'),
                ),
              );
            } finally {
              await (await import('node:fs/promises')).rename(held, blob);
            }
            const next = await session();
            const nextBefore = await call('before', next);
            assert.equal(nextBefore.code, 0, nextBefore.stderr);
            observed.push('partial before released ' + point);
          },
        );
      const s = await session();
      await t.test(
        'before owns cluster lifecycle and copies sensitive data only to ignored home backups',
        async () => {
          const r = await call('before', s);
          assert.equal(r.code, 0, r.stderr);
          assert.ok(!(await listening(port)));
          const prepared = await read(join(s.e, 'prepared.json'));
          assert.ok(prepared.backup.startsWith(join(home, 'backups')));
          for (const p of await readdir(s.e)) assert.match(p, /\.json$/);
          assert.ok(
            (await readdir(s.e)).some((p) => p.startsWith('cluster-stopped-')),
          );
          assert.ok(await lstat(join(prepared.backup, 'database.dump')));
          observed.push('before populated snapshot/lifecycle');
        },
      );
      const auth = await approve(s);
      await t.test(
        'reusing a session in another evidence directory cannot overwrite its backup',
        async () => {
          const prepared = await read(join(s.e, 'prepared.json'));
          const beforeHash = await hash(join(prepared.backup, 'database.dump'));
          const r = await call('before', { id: s.id, e: s.e + '-different' });
          assert.notEqual(r.code, 0);
          assert.equal(
            await hash(join(prepared.backup, 'database.dump')),
            beforeHash,
          );
        },
      );
      await t.test('expired admission fails before mutation', async () => {
        const a = await read(auth);
        a.approved_at = '2000-01-01T00:00:00Z';
        const old = join(root, 'expired.json');
        await save(old, a);
        const r = await call('install', s, {
          approval: old,
          installSwitch: true,
        });
        assert.notEqual(r.code, 0);
        await assert.rejects(lstat(join(s.e, 'admission.json')));
      });
      await t.test(
        'real wrapper installs fixture payload then migrates via exact candidate child',
        async () => {
          const admitted = await call('admit', s, { approval: auth });
          assert.equal(admitted.code, 0, admitted.stderr);
          const r = await call('install', s, {
            approval: auth,
            installSwitch: true,
            cwd: root,
          });
          assert.equal(r.code, 0, r.stderr);
          const out = await read(join(s.e, 'migration-result.json'));
          assert.deepEqual(out.result.applied, [29]);
          assert.ok(
            (await readdir(s.e)).some((p) => p.startsWith('verification-')),
          );
          assert.ok(!(await listening(port)));
          observed.push('all successful phases via PowerShell/candidate');
        },
      );
      await t.test(
        'read-only verification repeat is allowed and mutations cannot repeat',
        async () => {
          let r = await call('after', s, { approval: auth });
          assert.equal(r.code, 0, r.stderr);
          r = await call('migrate', s, { approval: auth });
          assert.notEqual(r.code, 0);
          assert.ok(!(await listening(port)));
        },
      );
      await t.test(
        'death during after resumes schema29 forward without rollback or repeated effects',
        async () => {
          const effectHashes = {};
          for (const p of [
            'installer-intent.json',
            'installer-outcome.json',
            'migration-intent.json',
            'migration-result.json',
          ])
            effectHashes[p] = await hash(join(s.e, p));
          const cfgHash = await hash(join(home, 'studio.json'));
          const r = await call('after', s, {
            approval: auth,
            failAt: 'hard-crash-during-after',
          });
          assert.equal(r.code, 77, r.stderr);
          assert.ok(await listening(port));
          const stale = await staleDecision(s, 'after');
          const resumed = await call('after', s, {
            approval: auth,
            staleFile: stale,
          });
          assert.equal(resumed.code, 0, resumed.stderr);
          assert.ok(!(await listening(port)));
          for (const [p, h] of Object.entries(effectHashes))
            assert.equal(await hash(join(s.e, p)), h);
          assert.equal(await hash(join(home, 'studio.json')), cfgHash);
          assert.ok(
            !(await readdir(s.e)).some((p) => p.startsWith('recovery-intent-')),
          );
          observed.push('after death resumed forward');
        },
      );
      await t.test(
        'per-studio lock rejects concurrent actual wrapper runs',
        async () => {
          const results = await Promise.all([
            call('after', s, { approval: auth, hold: 3000 }),
            call('after', s, { approval: auth, hold: 3000 }),
          ]);
          assert.equal(results.filter((r) => r.code === 0).length, 1);
          assert.match(
            results.find((r) => r.code !== 0).stderr,
            /EEXIST|mutex unavailable/,
          );
          assert.ok(!(await listening(port)));
        },
      );
      await t.test(
        'coordinated recovery restores populated schema28/program/config/credentials/products',
        async () => {
          await ctl('start');
          let source = pool();
          await source.query(
            "update actors set display_name='New work must not be discarded'",
          );
          await source.end();
          await ctl('stop');
          await assert.rejects(recover(s));
          assert.ok(!(await listening(port)));
          await ctl('start');
          source = pool();
          await source.query(
            "update actors set display_name='Synthetic sentinel'",
          );
          await source.end();
          await ctl('stop');
          const r = await recover(s);
          const next = await read(join(home, 'studio.json'));
          assert.equal(next.database.name, r.restored_database);
          await ctl('start');
          try {
            const q = pool(next.database.name);
            assert.equal(
              (await q.query('select count(*)::int n from entities')).rows[0].n,
              1,
            );
            assert.equal(
              (await q.query('select count(*)::int n from plan_qualifications'))
                .rows[0].n,
              1,
            );
            await q.end();
          } finally {
            await ctl('stop');
          }
          observed.push('populated coordinated recovery');
        },
      );
      for (const point of [
        'after-admission',
        'after-installer',
        'after-migration-intent',
        'after-migration-child',
        'hard-crash-after-migration-intent',
        'hard-crash-after-migration-result',
      ])
        await t.test(
          'crash-window ' + point + ' has explicit recovery',
          async () => {
            const seeded = await database();
            await setDatabase(seeded.name);
            const s = await session();
            assert.equal((await call('before', s)).code, 0);
            const a = await approve(s);
            const r = await call('install', s, {
              approval: a,
              installSwitch: true,
              failAt: point,
            });
            assert.notEqual(r.code, 0, point);
            if (point.startsWith('hard-crash')) {
              assert.ok(await listening(port));
              assert.notEqual(
                (await call('reconcile', s, { approval: a })).code,
                0,
              );
              if (point === 'hard-crash-after-migration-result') {
                const resultHash = await hash(
                  join(s.e, 'migration-result.json'),
                );
                const stale = await staleDecision(s, 'reconcile');
                const reconciled = await call('reconcile', s, {
                  approval: a,
                  staleFile: stale,
                });
                assert.equal(reconciled.code, 0, reconciled.stderr);
                const latest = (await readdir(s.e)).find((p) =>
                  p.startsWith('reconciliation-'),
                );
                assert.equal(
                  (await read(join(s.e, latest))).forward_state_verified,
                  true,
                );
                const after = await call('after', s, { approval: a });
                assert.equal(after.code, 0, after.stderr);
                assert.equal(
                  await hash(join(s.e, 'migration-result.json')),
                  resultHash,
                );
                assert.ok(
                  !(await readdir(s.e)).some((p) =>
                    p.startsWith('recovery-intent-'),
                  ),
                );
                observed.push('post-result death verified forward');
              }
            } else {
              assert.ok(!(await listening(port)));
              assert.equal(
                (await call('reconcile', s, { approval: a })).code,
                0,
              );
            }
            await recover(s);
            observed.push(point + ' recovery');
          },
        );
      for (const kind of ['nonzero', 'malformed', 'timeout'])
        await t.test(
          'migration child ' + kind + ' is retained and not retried',
          async () => {
            const seeded = await database();
            await setDatabase(seeded.name);
            const s = await session();
            assert.equal((await call('before', s)).code, 0);
            const a = await approve(s);
            const p = join(root, 'child-' + kind + '.mjs');
            await writeFile(
              p,
              kind === 'timeout'
                ? 'setInterval(()=>{},1000);'
                : kind === 'nonzero'
                  ? "let raw='';for await(const c of process.stdin)raw+=c;process.stderr.write(decodeURIComponent(new URL(JSON.parse(raw).database_url).password));process.exit(2);"
                  : "console.log('malformed');",
            );
            const r = await call('install', s, {
              approval: a,
              installSwitch: true,
              child: p,
            });
            assert.notEqual(r.code, 0);
            const out = await read(join(s.e, 'migration-child.json'));
            if (kind === 'timeout') assert.equal(out.timed_out, true);
            if (kind === 'nonzero') {
              assert.equal(out.exit_code, 2);
              assert.ok(!out.stderr_redacted.includes(password));
              assert.match(out.stderr_redacted, /<REDACTED>/);
            }
            assert.notEqual(
              (await call('migrate', s, { approval: a, child: p })).code,
              0,
            );
            await recover(s);
            observed.push('child ' + kind);
          },
        );
      await t.test(
        'old admission cannot expire post-mutation read-only verification',
        async () => {
          const seeded = await database();
          await setDatabase(seeded.name);
          const s = await session();
          const clock = Date.now() - 24 * 3600 * 1000;
          const b = await call('before', s, { clock });
          assert.equal(b.code, 0, b.stderr);
          const a = await approve(s, clock);
          const installed = await call('install', s, {
            approval: a,
            installSwitch: true,
            clock,
          });
          assert.equal(installed.code, 0, installed.stderr);
          const check = await call('after', s, { approval: a });
          assert.equal(check.code, 0, check.stderr);
          await recover(s, { failAt: 'hard-crash-after-protected-move' });
          assert.ok(await listening(port));
          await assert.rejects(lstat(join(home, 'secrets')));
          await recover(s);
          observed.push('aged verification and interrupted protected recovery');
        },
      );
    } finally {
      if (await listening(port)) await ctl('stop');
      await writeFile(
        join(root, 'test-summary.json'),
        JSON.stringify({
          fixture: true,
          root,
          observed,
          listening_after: await listening(port),
        }),
      );
    }
  },
);
