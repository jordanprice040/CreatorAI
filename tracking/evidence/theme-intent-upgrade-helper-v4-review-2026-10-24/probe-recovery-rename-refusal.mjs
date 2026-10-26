// Independent v4 review probe: what a rename refusal at the recovery step
// rename(install -> .theme-intent-installer-<id>) (scripts/theme-intent-upgrade-v4.mjs:735)
// leaves behind, and whether a second, separately approved recovery completes from that state.
// The refusal is induced deterministically by a test-owned process holding a file open inside
// the freshly installed fixture program directory. This shows one mechanism that produces the
// same EPERM; it does not establish the cause of the retained first-run refusal.
// Disposable root under ignored .verification, synthetic credentials, fixture installer only.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, cp, readdir, lstat, rm } from 'node:fs/promises';
import { join } from 'node:path';
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
  files,
} from '../../../scripts/theme-intent-upgrade-v4-core.mjs';

const bin = 'C:/Program Files/PostgreSQL/18/bin';
const root = join(ROOT, '.verification', 'theme-v4-review-rename-' + Date.now());
const home = join(root, 'home'),
  install = join(root, 'program'),
  products = join(root, 'products');
const password = 'b'.repeat(64);
const port = Number(process.argv[2] ?? 55457);
const stamp = () => randomUUID().replaceAll('-', '').slice(0, 12);
const exists = (p) =>
  lstat(p).then(
    () => true,
    () => false,
  );
let cfg, deps, context, review;
const out = { format: 'theme-intent-v4-review-rename-probe/1', root, port, steps: {} };

async function ctl(action) {
  await command(join(bin, 'pg_ctl.exe'), [
    action,
    '-D',
    join(home, 'postgres', 'data'),
    ...(action === 'start'
      ? ['-l', join(root, 'postgres.log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1`]
      : ['-m', 'fast']),
    '-w',
    '-t',
    '60',
  ]);
}
const pool = (database) =>
  new deps.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database, max: 1 });
async function seed() {
  const name = 'helper_' + stamp();
  await ctl('start');
  try {
    const admin = pool('postgres');
    await admin.query(`create database ${name}`);
    await admin.end();
    const q = pool(name);
    try {
      await q.query('create table schema_migrations(version integer primary key,name text,checksum char(64))');
      for (const m of deps.migrations.slice(0, 28)) {
        await q.query(m.sql);
        await q.query('insert into schema_migrations values($1,$2,$3)', [m.version, m.name, deps.migrationChecksum(m)]);
      }
      const actor = randomUUID(),
        ws = randomUUID();
      await q.query("insert into actors(id,kind,display_name) values($1,'human','Probe sentinel')", [actor]);
      await q.query(
        "insert into workspaces(id,name,record_mode,fixture,created_by) values($1,'Probe','fixture',true,$2)",
        [ws, actor],
      );
      await q.query(
        "insert into entities(id,workspace_id,fixture,kind,version,status,title,body,content_hash,created_by) values($1,$2,true,'problem',1,'active','Probe entity',$3,$4,$5)",
        [randomUUID(), ws, { text: 'probe body' }, 'a'.repeat(64), actor],
      );
    } finally {
      await q.end();
    }
  } finally {
    await ctl('stop');
  }
  return name;
}
async function call(phase, s, { approval, installSwitch = false } = {}) {
  const args = [
    '-NoProfile',
    '-File',
    join(ROOT, 'scripts', installSwitch ? 'install-theme-intent-v4.ps1' : 'upgrade-theme-intent-v4.ps1'),
    '-EvidenceDir',
    s.e,
    '-SessionId',
    s.id,
    '-ReviewFile',
    review,
    '-TestContext',
    context,
  ];
  if (installSwitch) args.push('-InstallAndMigrateApproved');
  else args.push('-Phase', phase);
  if (phase === 'recover') args.push('-CoordinatedRecoveryApproved');
  if (approval) args.push('-ApprovalFile', approval);
  return command('powershell.exe', args, { timeout: 300000, allowFailure: true });
}
async function recoveryDecision(s) {
  const p = join(root, 'recover-' + stamp() + '.json');
  const d = {
    format: 'theme-intent-owner-recovery-approval/4',
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    prepared_sha256: await hash(join(s.e, 'prepared.json')),
    fixture: true,
    owner_decision: 'SYNTHETIC REVIEW PROBE RECOVERY ONLY',
    decision_id: stamp(),
    restore_schema28_program_protected_products: true,
    reinstall_predecessor_and_relocate_config: true,
  };
  await save(p, d);
  return { p, id: d.decision_id };
}
const normalInstaller = await readFile(join(ROOT, 'tests/fixtures/theme-intent-v4-installer.ps1'), 'utf8');
const holderPid = join(root, 'holder.pid');
// Same copy as the fixture installer, then a detached test-owned process holds one copied file
// open (read share only) for a bounded time, as any process with an open handle would.
const holdingInstaller = [
  normalInstaller,
  "$held=Join-Path $InstallDir 'creator-desktop.exe'",
  "$cmd='$f=[IO.File]::Open(''' + $held + ''',''Open'',''Read'',''Read''); Start-Sleep 30; $f.Close()'",
  "$p=Start-Process powershell.exe -PassThru -WindowStyle Hidden -ArgumentList ('-NoProfile -Command ' + $cmd)",
  "Set-Content -LiteralPath '" + holderPid.replaceAll("'", "''") + "' -Value $p.Id",
  'Start-Sleep -Milliseconds 1500',
  '',
].join('\n');

let fail;
try {
  assert.ok(!(await listening(port)), 'Probe port already occupied');
  await mkdir(root);
  await writeFile(join(root, 'TEST_ONLY'), 'synthetic helper test\n');
  for (const p of [home, products, join(home, 'secrets'), join(home, 'plan-credentials')])
    await mkdir(p, { recursive: true });
  await writeFile(join(products, 'sentinel.txt'), 'probe product');
  await writeFile(join(home, 'plan-credentials/vault'), 'probe vault');
  await writeFile(join(root, 'initpw'), password + '\n');
  await command(join(bin, 'initdb.exe'), [
    '-D',
    join(home, 'postgres', 'data'),
    '-U',
    'postgres',
    '--auth=scram-sha-256',
    '--encoding=UTF8',
    '--no-locale',
    `--pwfile=${join(root, 'initpw')}`,
  ]);
  await command('powershell.exe', [
    '-NoProfile',
    '-Command',
    "Add-Type -AssemblyName System.Security; [IO.File]::WriteAllBytes('" +
      join(home, 'secrets/postgres.dpapi').replaceAll("'", "''") +
      "',[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('" +
      password +
      "'),[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres'),[Security.Cryptography.DataProtectionScope]::CurrentUser))",
  ]);
  deps = await loadDatabase();
  cfg = {
    database: { mode: 'managed', user: 'postgres', name: 'helper_initial', port },
    pg_bin: bin,
    products_root: products,
  };
  await mkdir(install);
  await cp(join(ROOT, '.verification/discovery-semantics-v2-artifacts/studio'), join(install, 'studio'), {
    recursive: true,
  });
  await cp(
    join(ROOT, '.verification/discovery-semantics-v2-artifacts/packaged-creator-desktop.exe'),
    join(install, 'creator-desktop.exe'),
  );
  context = join(root, 'context.json');
  await save(context, {
    format: 'theme-intent-helper-test-layout/4',
    root,
    home,
    install,
    installer: join(root, 'fixture-installer.ps1'),
  });
  await writeFile(join(root, 'fixture-installer.ps1'), normalInstaller);
  review = join(root, 'review.json');
  await save(review, {
    format: 'theme-intent-helper-simulated-review/4',
    status: 'fixture_only',
    prior_implementation_involvement: false,
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    helper_sha256: await bindings(),
  });
  cfg.database.name = await seed();
  await writeFile(join(home, 'studio.json'), JSON.stringify(cfg));
  const s = { id: 'probe-' + stamp() };
  s.e = join(root, 'evidence-' + s.id);
  let r = await call('before', s);
  assert.equal(r.code, 0, r.stderr);
  const approval = join(root, 'approve.json');
  await save(approval, {
    format: 'theme-intent-owner-install-approval/4',
    candidate_plan_hash: CANDIDATE,
    installation_plan_hash: PLAN,
    prepared_sha256: await hash(join(s.e, 'prepared.json')),
    install_and_migrate_28_to_29: true,
    owner_decision: 'SYNTHETIC REVIEW PROBE ONLY',
    fixture: true,
    approved_at: new Date().toISOString(),
  });
  r = await call('admit', s, { approval });
  assert.equal(r.code, 0, r.stderr);
  r = await call('install', s, { approval, installSwitch: true });
  assert.equal(r.code, 0, r.stderr);
  out.steps.forward_install = { schema29_verified: (await readdir(s.e)).some((p) => p.startsWith('verification-')) };
  const plan = await read(join(ROOT, 'tracking/evidence/theme-intent-package-2026-10-23/installation-plan.json'));
  const configBefore = await hash(join(home, 'studio.json'));
  const secretsBefore = await files(join(home, 'secrets'));

  // Recovery 1: refusal induced at the post-installer rename.
  await writeFile(join(root, 'fixture-installer.ps1'), holdingInstaller);
  const first = await recoveryDecision(s);
  r = await call('recover', s, { approval: first.p });
  const ev = await readdir(s.e);
  const sibling = (k) => install + '.theme-intent-' + k + '-' + first.id;
  out.steps.recovery_1 = {
    exit_code: r.code,
    eperm_rename_at_installer_step: /EPERM[^\n]*rename[^\n]*theme-intent-installer-/.test(r.stderr),
    stack_line_735: /theme-intent-upgrade-v4\.mjs:735/.test(r.stderr),
    wrapper_message: /Helper stopped; preserve intents\/evidence/.test(r.stderr),
    listening_after: await listening(port),
    lease_after: await exists(join(home, 'theme-intent-v4.lock')),
    left_owned_lock_marker: ev.some((p) => p.startsWith('phase-left-owned-lock-')),
    recovery_intent: ev.includes('recovery-intent-' + first.id + '.json'),
    recovery_installer_receipt: ev.includes('recovery-installer-' + first.id + '.json'),
    recovery_result: ev.includes('recovery-result-' + first.id + '.json'),
    config_unchanged: (await hash(join(home, 'studio.json'))) === configBefore,
    secrets_unchanged: JSON.stringify(await files(join(home, 'secrets'))) === JSON.stringify(secretsBefore),
    quarantine_is_target_program:
      (await hash(join(sibling('failed'), 'creator-desktop.exe'))) === plan.packaged_desktop_sha256,
    replacement_present: await exists(sibling('restored')),
    generated_absent: !(await exists(sibling('installer'))),
    install_dir_is_predecessor_installer_output:
      (await hash(join(install, 'creator-desktop.exe'))) === plan.expected_predecessor_native_sha256,
  };
  assert.notEqual(r.code, 0);
  // Wait for the test-owned holder to exit (bounded), then restore the normal fixture installer.
  const pid = Number((await readFile(holderPid, 'utf8')).trim());
  for (let i = 0; i < 400; i++) {
    try {
      process.kill(pid, 0);
    } catch {
      break;
    }
    await new Promise((ok) => setTimeout(ok, 100));
  }
  await writeFile(join(root, 'fixture-installer.ps1'), normalInstaller);
  await ctl('start');
  try {
    const q = pool('postgres');
    out.steps.recovery_1.orphan_restore_databases = (
      await q.query("select count(*)::int n from pg_database where datname like 'helper_restore_%'")
    ).rows[0].n;
    await q.end();
  } finally {
    await ctl('stop');
  }

  // Recovery 2: a new, separately approved decision from the state recovery 1 left behind.
  const second = await recoveryDecision(s);
  r = await call('recover', s, { approval: second.p });
  out.steps.recovery_2 = { exit_code: r.code, stderr_tail: r.code ? r.stderr.slice(-1500) : '' };
  assert.equal(r.code, 0, r.stderr);
  const result = await read(join(s.e, 'recovery-result-' + second.id + '.json'));
  const next = await read(join(home, 'studio.json'));
  await ctl('start');
  try {
    const q = pool(next.database.name);
    out.steps.recovery_2.restored_entities = (await q.query('select count(*)::int n from entities')).rows[0].n;
    out.steps.recovery_2.restored_schema = (await q.query('select max(version)::int n from schema_migrations')).rows[0].n;
    await q.end();
  } finally {
    await ctl('stop');
  }
  Object.assign(out.steps.recovery_2, {
    schema: result.schema,
    program_verified: result.program_verified,
    config_points_to_restored: next.database.name === result.restored_database,
    install_dir_is_predecessor:
      (await hash(join(install, 'creator-desktop.exe'))) === plan.expected_predecessor_native_sha256,
    secrets_restored: JSON.stringify(await files(join(home, 'secrets'))) === JSON.stringify(secretsBefore),
    listening_after: await listening(port),
    lease_after: await exists(join(home, 'theme-intent-v4.lock')),
    leftover_siblings: (await readdir(root)).filter((p) => p.startsWith('program.theme-intent-')).sort(),
  });
} catch (e) {
  fail = String(e?.stack ?? e).slice(0, 3000);
} finally {
  if (await listening(port)) await ctl('stop').catch(() => {});
  out.error = fail ?? null;
  out.listening_after = await listening(port);
  out.removing_root = !fail;
  if (!fail) await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 500 });
  out.root_removed = !(await exists(root));
  console.log(JSON.stringify(out, null, 2));
}
