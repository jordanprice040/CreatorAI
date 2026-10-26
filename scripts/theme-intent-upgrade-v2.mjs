import assert from 'node:assert/strict';
import {
  mkdir,
  cp,
  readFile,
  rename,
  writeFile,
  lstat,
} from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { randomUUID } from 'node:crypto';
import {
  ROOT,
  CANDIDATE,
  PLAN,
  read,
  hash,
  save,
  atomic,
  canonicalHash,
  bindings,
  packageCheck,
  layout,
  reviewCheck,
  paths,
  inside,
  noLinks,
  files,
  copyVerified,
  program,
  fresh,
  command,
  quit,
  managed,
  loadDatabase,
  snapshot,
  databaseUrl,
  preserved,
  phaseLock,
} from './theme-intent-upgrade-v2-core.mjs';

if (process.argv[2] === '--bindings') {
  console.log(JSON.stringify(await bindings()));
  process.exit(0);
}
const { plan, candidate } = await packageCheck();
if (process.argv[2] === '--check') {
  console.log(
    'Exact frozen candidate/plan/package verified; no operational access.',
  );
  process.exit(0);
}
const req = await read(resolve(process.argv[2]));
assert.ok(
  [
    'before',
    'admit',
    'install',
    'migrate',
    'after',
    'reconcile',
    'recover',
  ].includes(req.phase),
);
const l = await layout(req.test_context, plan);
await reviewCheck(req.review, l.fixture); // Every phase, including before; no config/secret loaded yet.
await quit();
const { e, backup } = await paths(l, req.evidence, req.session);
const cfg = await read(
  req.phase === 'recover'
    ? join(backup, 'protected/studio.json')
    : join(l.home, 'studio.json'),
);
assert.equal(cfg.database.mode, 'managed');
await noLinks(l.home);
await noLinks(l.install);
await noLinks(cfg.products_root);
await noLinks(cfg.pg_bin);
assert.ok(
  !inside(cfg.products_root, backup) &&
    resolve(cfg.products_root) !== resolve(backup),
);
if (l.fixture) {
  assert.ok(inside(l.root, cfg.products_root));
  assert.ok(cfg.database.port >= 55450 && cfg.database.port <= 55499);
  assert.match(cfg.database.name, /^helper_/);
}
let prepared, owner;
if (req.phase !== 'before') {
  prepared = await read(join(e, 'prepared.json'));
  assert.equal(prepared.format, 'theme-intent-upgrade-prepared/2');
  assert.equal(prepared.candidate_plan_hash, CANDIDATE);
  assert.equal(prepared.installation_plan_hash, PLAN);
  assert.equal(prepared.fixture, l.fixture);
  assert.equal(prepared.backup, backup);
  assert.equal(
    prepared.context_sha256,
    req.test_context ? await hash(req.test_context) : null,
  );
  assert.deepEqual(prepared.helper_sha256, await bindings());
  assert.equal(await hash(join(e, 'before.json')), prepared.before_sha256);
  assert.equal(await hash(join(e, 'backup.json')), prepared.backup_sha256);
}
function decision(a, kind) {
  assert.equal(a.format, `theme-intent-owner-${kind}/2`);
  assert.equal(a.candidate_plan_hash, CANDIDATE);
  assert.equal(a.installation_plan_hash, PLAN);
  assert.equal(a.prepared_sha256, preparedHash);
  assert.ok(a.owner_decision?.trim());
  assert.equal(a.fixture, l.fixture);
}
const preparedHash = prepared ? await hash(join(e, 'prepared.json')) : null;
const now = () =>
  l.fixture && req.test_clock_ms ? Number(req.test_clock_ms) : Date.now();
const freshAdmission = (at) => fresh(at, now());
if (['admit', 'install'].includes(req.phase)) {
  owner = await read(req.approval);
  decision(owner, 'install-approval');
  assert.equal(owner.install_and_migrate_28_to_29, true);
  freshAdmission(owner.approved_at);
  freshAdmission(prepared.prepared_at);
}
if (req.phase === 'recover') {
  owner = await read(req.approval);
  decision(owner, 'recovery-approval');
  assert.equal(owner.restore_schema28_program_protected_products, true);
  assert.equal(owner.reinstall_predecessor_and_relocate_config, true);
  assert.match(owner.decision_id, /^[a-z0-9-]{1,64}$/);
}
async function admission() {
  const a = await read(join(e, 'admission.json'));
  assert.equal(a.prepared_sha256, preparedHash);
  assert.equal(a.candidate_plan_hash, CANDIDATE);
  assert.equal(a.installation_plan_hash, PLAN);
  assert.equal(await hash(req.approval), a.approval_sha256);
  return a;
}
if (['migrate', 'after', 'reconcile'].includes(req.phase)) await admission();
const credential =
  req.phase === 'recover'
    ? join(backup, 'protected/secrets/postgres.dpapi')
    : join(l.home, 'secrets/postgres.dpapi');
await noLinks(credential);
if (req.phase === 'recover') {
  const b = await read(join(e, 'backup.json'));
  assert.equal(
    await hash(credential),
    b.trees.protected['secrets/postgres.dpapi'],
  );
}
if (req.phase === 'before') {
  await assert.rejects(lstat(e), { code: 'ENOENT' });
  await assert.rejects(lstat(backup), { code: 'ENOENT' });
}
if (req.presecret) {
  console.log(
    JSON.stringify({
      credential_path: credential,
      presecret_passed: true,
      fixture: l.fixture,
    }),
  );
  process.exit(0);
}
let input = '';
for await (const c of process.stdin) input += c;
const secret = JSON.parse(input);
input = '';
assert.equal(typeof secret.password, 'string');
assert.ok(
  /^[\x20-\x7e]+$/.test(secret.password),
  'Pinned Windows libpq path requires an ASCII managed credential; no credential fallback',
);
// The independent binding check precedes both dependency import and credential use.
const deps = await loadDatabase();
if (req.phase === 'before') {
  await mkdir(e);
}
await noLinks(backup);
// Recovery alone may retire a proven stale phase lock under its separately bound decision.
const globalLock = join(l.home, 'theme-intent-v2.lock');
if (req.phase === 'recover' && owner.stale_lock_sha256) {
  assert.equal(await hash(globalLock), owner.stale_lock_sha256);
  const old = await read(globalLock);
  assert.equal(old.evidence, e);
  assert.ok(Number.isInteger(old.pid) && old.pid > 0);
  let alive = true;
  try {
    process.kill(old.pid, 0);
  } catch (err) {
    if (err.code === 'ESRCH') alive = false;
    else throw err;
  }
  assert.ok(!alive, 'Lock owner still alive');
  await rename(globalLock, join(e, 'retired-lock-' + randomUUID() + '.json'));
}
const unlock = await phaseLock(l.home, e, req.phase);
if (l.fixture && req.hold_lock_ms)
  await new Promise((ok) =>
    setTimeout(ok, Math.min(Number(req.hold_lock_ms), 3000)),
  );
async function verifyBackup() {
  const b = await read(join(e, 'backup.json'));
  assert.equal(b.format, 'theme-intent-upgrade-backup/2');
  assert.equal(b.schema, 28);
  for (const [dir, map] of Object.entries(b.trees))
    assert.deepEqual(await files(join(backup, dir)), map);
  assert.equal(await hash(join(backup, 'database.dump')), b.dump_sha256);
  await command(join(cfg.pg_bin, 'pg_restore.exe'), [
    '--list',
    join(backup, 'database.dump'),
  ]);
  return b;
}
const current = (schema) => snapshot(pool, l, cfg, schema, deps);
let pool;
const fault = (point) => {
  if (l.fixture && req.fail_at === 'hard-crash-' + point) process.exit(77);
  if (l.fixture && req.fail_at === point)
    throw new Error('Synthetic fault: ' + point);
};
async function installer(previous = false) {
  if (l.fixture) {
    await command(
      'powershell.exe',
      [
        '-NoProfile',
        '-File',
        l.installer,
        '-InstallDir',
        l.install,
        '-Payload',
        join(
          ROOT,
          previous
            ? '.verification/discovery-semantics-v2-artifacts'
            : candidate.extracted_payload_dir,
        ),
        '-Previous',
        String(previous),
      ],
      { timeout: 600000 },
    );
    return { code: 0, timed_out: false, fixture: true };
  }
  const path = resolve(
    ROOT,
    previous ? plan.rollback.previous_installer_path : plan.installer_path,
  );
  assert.equal(
    await hash(path),
    previous ? plan.rollback.previous_installer_sha256 : plan.installer_sha256,
  );
  const r = await command(path, ['/S', '/NS'], {
    timeout: 600000,
    allowFailure: true,
  });
  return {
    code: r.code,
    timed_out: r.timed_out,
    stdout_sha256: canonicalHash(r.stdout),
    stderr_sha256: canonicalHash(r.stderr),
  };
}
async function admit() {
  await verifyBackup();
  const before = await read(join(e, 'before.json'));
  preserved(before, await current(28), 28);
  await program(l.install, plan);
  assert.deepEqual(
    await files(l.install),
    (await read(join(e, 'backup.json'))).trees.program,
  );
  await quit();
  freshAdmission(owner.approved_at);
  freshAdmission(prepared.prepared_at);
  freshAdmission((await read(join(e, 'backup.json'))).created_at);
  const record = {
    format: 'theme-intent-upgrade-admission/2',
    at: new Date(now()).toISOString(),
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    prepared_sha256: preparedHash,
    approval_sha256: await hash(req.approval),
  };
  try {
    await save(join(e, 'admission.json'), record);
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const previous = await admission();
    freshAdmission(previous.at);
    // Reuse admission only before any installer intent; never repeat an uncertain effect.
    await assert.rejects(lstat(join(e, 'installer-intent.json')), {
      code: 'ENOENT',
    });
    return;
  }
  fault('after-admission');
}
async function migrate() {
  const a = await admission(),
    outcome = await read(join(e, 'installer-outcome.json'));
  assert.equal(outcome.admission_sha256, await hash(join(e, 'admission.json')));
  assert.equal(
    outcome.installer_intent_sha256,
    await hash(join(e, 'installer-intent.json')),
  );
  const installIntent = await read(join(e, 'installer-intent.json'));
  assert.equal(installIntent.admission_sha256, outcome.admission_sha256);
  assert.equal(outcome.installer_sha256, plan.installer_sha256);
  assert.equal(outcome.exit_code, 0);
  assert.equal(outcome.timed_out, false);
  assert.ok(Date.parse(outcome.completed_at) >= Date.parse(a.at));
  assert.ok(Date.parse(outcome.completed_at) >= Date.parse(installIntent.at));
  await verifyBackup();
  preserved(await read(join(e, 'before.json')), await current(28), 28);
  await program(l.install, plan, true);
  await quit();
  await save(join(e, 'migration-intent.json'), {
    at: new Date().toISOString(),
    admission_sha256: await hash(join(e, 'admission.json')),
    installer_outcome_sha256: await hash(join(e, 'installer-outcome.json')),
  });
  fault('after-migration-intent');
  const payload = {
    protocol: 'creator-studio/1',
    database_url: databaseUrl(cfg).replace(
      '@',
      ':' + encodeURIComponent(secret.password) + '@',
    ),
    products_root: cfg.products_root,
    backups_dir: join(l.home, 'backups'),
    pg_bin: cfg.pg_bin,
    web_root: null,
    owner_secret: null,
    login_code: null,
    worker_distro: null,
    source: null,
  };
  let exe = join(l.install, 'studio/node/node.exe'),
    args = [join(l.install, 'studio/service/app/dist/studio.mjs'), 'migrate'],
    timeout = 600000;
  if (l.fixture && req.child_fixture) {
    assert.ok(inside(l.root, req.child_fixture));
    exe = process.execPath;
    args = [req.child_fixture];
    timeout = 200;
  }
  const r = await command(exe, args, {
    input: JSON.stringify(payload) + '\n',
    timeout,
    allowFailure: true,
    secret: secret.password,
  });
  await save(join(e, 'migration-child.json'), {
    at: new Date().toISOString(),
    exit_code: r.code,
    timed_out: r.timed_out,
    stderr_redacted: r.stderr.slice(0, 1500),
    stdout_sha256: canonicalHash(r.stdout),
  });
  assert.ok(
    r.code === 0 && !r.timed_out,
    'Migration child failed/uncertain; reconcile or recover, never repeat',
  );
  const result = r.stdout
    .trim()
    .split('\n')
    .map((s) => JSON.parse(s))
    .find((v) => v.event === 'result')?.result;
  assert.equal(result.from, 28);
  assert.equal(result.to, 29);
  assert.deepEqual(result.applied, [29]);
  assert.ok(inside(join(l.home, 'backups'), result.backup.dir));
  assert.equal(
    await hash(join(result.backup.dir, 'database.dump')),
    result.backup.database.sha256,
  );
  fault('after-migration-child');
  await save(join(e, 'migration-result.json'), {
    at: new Date().toISOString(),
    intent_sha256: await hash(join(e, 'migration-intent.json')),
    result,
  });
}
async function after() {
  await verifyBackup();
  await program(l.install, plan, true);
  const result = await read(join(e, 'migration-result.json'));
  assert.equal(
    result.intent_sha256,
    await hash(join(e, 'migration-intent.json')),
  );
  const intent = await read(join(e, 'migration-intent.json'));
  assert.equal(
    intent.installer_outcome_sha256,
    await hash(join(e, 'installer-outcome.json')),
  );
  assert.equal(intent.admission_sha256, await hash(join(e, 'admission.json')));
  assert.equal(result.result.from, 28);
  assert.equal(result.result.to, 29);
  assert.deepEqual(result.result.applied, [29]);
  assert.equal(
    await hash(join(result.result.backup.dir, 'database.dump')),
    result.result.backup.database.sha256,
  );
  const now = await current(29);
  preserved(await read(join(e, 'before.json')), now, 29);
  await save(join(e, 'verification-' + randomUUID() + '.json'), {
    at: new Date().toISOString(),
    schema: 29,
    prepared_sha256: preparedHash,
    migration_result_sha256: await hash(join(e, 'migration-result.json')),
    state: now,
    installed_ui_acceptance: false,
    fixture: l.fixture,
  });
}
try {
  await managed(
    cfg,
    l.home,
    e,
    async () => {
      pool = new deps.Pool({
        host: '127.0.0.1',
        port: cfg.database.port,
        database: req.phase === 'recover' ? 'postgres' : cfg.database.name,
        user: cfg.database.user,
        password: secret.password,
        max: 1,
        connectionTimeoutMillis: 10000,
        statement_timeout: 60000,
      });
      try {
        if (req.phase === 'before') {
          await program(l.install, plan);
          await mkdir(dirname(backup), { recursive: true });
          await mkdir(backup); // A reused session must never overwrite an earlier dump.
          const before = await snapshot(
            pool,
            l,
            cfg,
            28,
            deps,
            join(backup, 'database.dump'),
            secret.password,
          );
          await save(join(e, 'before.json'), before);
          const trees = {
            program: await copyVerified(l.install, join(backup, 'program')),
            products: await copyVerified(
              cfg.products_root,
              join(backup, 'products'),
            ),
          };
          await mkdir(join(backup, 'protected'));
          await cp(
            join(l.home, 'studio.json'),
            join(backup, 'protected/studio.json'),
            { force: false, errorOnExist: true },
          );
          for (const dir of ['secrets', 'plan-credentials'])
            await copyVerified(
              join(l.home, dir),
              join(backup, 'protected', dir),
            );
          trees.protected = await files(join(backup, 'protected'));
          await save(join(e, 'backup.json'), {
            format: 'theme-intent-upgrade-backup/2',
            schema: 28,
            created_at: new Date(now()).toISOString(),
            dump_sha256: await hash(join(backup, 'database.dump')),
            trees,
          });
          await verifyBackup();
          preserved(before, await current(28), 28);
          await save(join(e, 'prepared.json'), {
            format: 'theme-intent-upgrade-prepared/2',
            prepared_at: new Date(now()).toISOString(),
            candidate_plan_hash: CANDIDATE,
            installation_plan_hash: PLAN,
            fixture: l.fixture,
            backup,
            context_sha256: req.test_context
              ? await hash(req.test_context)
              : null,
            helper_sha256: await bindings(),
            before_sha256: await hash(join(e, 'before.json')),
            backup_sha256: await hash(join(e, 'backup.json')),
          });
        } else if (req.phase === 'admit') await admit();
        else if (req.phase === 'install') {
          // Validate installer resolution/hash before consuming admission, even from another cwd.
          assert.equal(
            await hash(resolve(ROOT, plan.installer_path)),
            plan.installer_sha256,
          );
          await admit();
          const intent = {
            at: new Date().toISOString(),
            admission_sha256: await hash(join(e, 'admission.json')),
            installer_sha256: plan.installer_sha256,
          };
          await save(join(e, 'installer-intent.json'), intent);
          const r = await installer();
          fault('after-installer');
          await save(join(e, 'installer-outcome.json'), {
            completed_at: new Date().toISOString(),
            admission_sha256: intent.admission_sha256,
            installer_sha256: plan.installer_sha256,
            installer_intent_sha256: await hash(
              join(e, 'installer-intent.json'),
            ),
            exit_code: r.code,
            ...r,
          });
          assert.ok(r.code === 0 && !r.timed_out, 'Installer failed/uncertain');
          await migrate();
          await after();
        } else if (req.phase === 'migrate') await migrate();
        else if (req.phase === 'after') await after();
        else if (req.phase === 'reconcile') {
          await verifyBackup();
          const schema = (
            await pool.query(
              'select max(version)::int n from schema_migrations',
            )
          ).rows[0].n;
          assert.ok([28, 29].includes(schema));
          const observed = await current(schema);
          preserved(await read(join(e, 'before.json')), observed, schema);
          let target = false;
          try {
            await program(l.install, plan, true);
            target = true;
          } catch {
            await program(l.install, plan);
          }
          await save(join(e, 'reconciliation-' + randomUUID() + '.json'), {
            at: new Date().toISOString(),
            schema,
            target_program: target,
            state_preserved: true,
            next: 'Explicit recovery; no installer or migration retry authorized',
            prepared_sha256: preparedHash,
          });
        } else if (req.phase === 'recover') {
          await verifyBackup();
          // This bounded upgrade rollback cannot discard later work or reset unknown exposure.
          // A changed/unavailable source database needs a separately reviewed recovery plan.
          const sourcePool = new deps.Pool({
            host: '127.0.0.1',
            port: cfg.database.port,
            database: cfg.database.name,
            user: cfg.database.user,
            password: secret.password,
            max: 1,
          });
          try {
            const version = (
              await sourcePool.query(
                'select max(version)::int n from schema_migrations',
              )
            ).rows[0].n;
            assert.ok([28, 29].includes(version));
            const source = await snapshot(
              sourcePool,
              { home: join(backup, 'protected') },
              { ...cfg, products_root: join(backup, 'products') },
              version,
              deps,
            );
            preserved(await read(join(e, 'before.json')), source, version);
          } finally {
            await sourcePool.end();
          }
          const id = owner.decision_id;
          const stage = join(l.home, 'backups', 'theme-intent-recovery-' + id);
          await noLinks(stage);
          await mkdir(stage);
          await save(join(e, 'recovery-intent-' + id + '.json'), {
            at: new Date().toISOString(),
            approval_sha256: await hash(req.approval),
            prepared_sha256: preparedHash,
            stage,
          });
          await copyVerified(join(backup, 'protected'), join(stage, 'home'));
          await copyVerified(join(backup, 'products'), join(stage, 'products'));
          await copyVerified(join(backup, 'program'), join(stage, 'program'));
          const name = 'helper_restore_' + randomUUID().replaceAll('-', '');
          await pool.query(`create database ${name}`);
          await command(
            join(cfg.pg_bin, 'pg_restore.exe'),
            [
              '--exit-on-error',
              '--no-owner',
              '--no-privileges',
              '--single-transaction',
              `--dbname=${databaseUrl(cfg, name)}`,
              join(backup, 'database.dump'),
            ],
            {
              env: { ...process.env, PGPASSWORD: secret.password },
              timeout: 600000,
              secret: secret.password,
            },
          );
          const restored = new deps.Pool({
            host: '127.0.0.1',
            port: cfg.database.port,
            database: name,
            user: cfg.database.user,
            password: secret.password,
            max: 1,
          });
          try {
            const restoredCfg = {
              ...cfg,
              products_root: join(stage, 'products'),
            };
            preserved(
              await read(join(e, 'before.json')),
              await snapshot(
                restored,
                { home: join(stage, 'home') },
                restoredCfg,
                28,
                deps,
              ),
              28,
            );
          } finally {
            await restored.end();
          }
          const quarantine = l.install + '.theme-intent-failed-' + id;
          const replacement = l.install + '.theme-intent-restored-' + id;
          const generated = l.install + '.theme-intent-installer-' + id;
          for (const p of [quarantine, replacement, generated]) {
            assert.equal(dirname(resolve(p)), dirname(resolve(l.install)));
            await noLinks(p);
            await assert.rejects(lstat(p), { code: 'ENOENT' });
          }
          await copyVerified(join(stage, 'program'), replacement);
          await noLinks(quarantine);
          const exists = async (p) =>
            lstat(p).then(
              () => true,
              (err) => {
                if (err.code === 'ENOENT') return false;
                throw err;
              },
            );
          if (await exists(l.install)) await rename(l.install, quarantine);
          await mkdir(l.install);
          // Preserve failed program bytes before replaying the predecessor's shell integration.
          const installResult = await installer(true);
          await save(
            join(e, 'recovery-installer-' + id + '.json'),
            installResult,
          );
          assert.ok(
            installResult.code === 0 && !installResult.timed_out,
            'Predecessor installer failed; preserve recovery stage',
          );
          await rename(l.install, generated);
          await rename(replacement, l.install);
          for (const dir of ['secrets', 'plan-credentials']) {
            if (await exists(join(l.home, dir)))
              await rename(join(l.home, dir), join(stage, 'failed-' + dir));
            fault('after-protected-move');
            await copyVerified(join(stage, 'home', dir), join(l.home, dir));
          }
          const nextCfg = await read(join(stage, 'home/studio.json'));
          nextCfg.database.name = name;
          nextCfg.products_root = join(stage, 'products');
          await atomic(join(l.home, 'studio.json'), nextCfg);
          await program(l.install, plan);
          assert.deepEqual(
            await files(l.install),
            (await read(join(e, 'backup.json'))).trees.program,
          );
          const finalPool = new deps.Pool({
            host: '127.0.0.1',
            port: cfg.database.port,
            database: name,
            user: cfg.database.user,
            password: secret.password,
            max: 1,
          });
          try {
            const expected = await read(join(e, 'before.json'));
            expected.studio_config_sha256 = await hash(
              join(l.home, 'studio.json'),
            );
            preserved(
              expected,
              await snapshot(finalPool, l, nextCfg, 28, deps),
              28,
            );
          } finally {
            await finalPool.end();
          }
          await save(join(e, 'recovery-result-' + id + '.json'), {
            at: new Date().toISOString(),
            schema: 28,
            approval_sha256: await hash(req.approval),
            restored_database: name,
            restored_products: nextCfg.products_root,
            restored_config_sha256: await hash(join(l.home, 'studio.json')),
            program_verified: true,
            quarantine,
            fixture: l.fixture,
            custom_shell_state_verified: false,
            installed_ui_acceptance: false,
          });
        }
      } finally {
        await pool.end();
      }
    },
    req.phase === 'recover' && owner.allow_stop_owned_cluster === true,
  );
  console.log(
    JSON.stringify({
      phase: req.phase,
      passed: true,
      fixture: l.fixture,
      provider_calls: 0,
    }),
  );
} finally {
  delete secret.password;
  await unlock();
}
