// Independent v3 review probe (fixture only). Abrupt external termination (taskkill /F) of the
// real CLI under the real PowerShell wrapper, mutex release, foreign/untagged cluster refusal,
// simulated desktop relaunch, undocumented resume_phase scope, and forward `after` resume.
// Disposable layout under ignored .verification; synthetic credentials; port 55463.
import assert from 'node:assert/strict';
import { mkdir, writeFile, readFile, cp, readdir, lstat, rename, copyFile } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  ROOT, CANDIDATE, PLAN, command, save, read, hash, bindings, loadDatabase, listening, studioGuard,
} from '../../../scripts/theme-intent-upgrade-v3-core.mjs';

const bin = 'C:/Program Files/PostgreSQL/18/bin';
const port = 55463;
const root = join(ROOT, '.verification', 'theme-v3-review-probe-' + Date.now());
const home = join(root, 'home'), install = join(root, 'program'), products = join(root, 'products');
const password = 'b'.repeat(64);
const results = { root, port, started_at: new Date().toISOString(), probes: {} };
const stamp = () => randomUUID().replaceAll('-', '').slice(0, 12);
const exists = (p) => lstat(p).then(() => true, () => false);
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
let context, review, cfg, deps;

async function ctl(action, extra = '') {
  return command(join(bin, 'pg_ctl.exe'), [action, '-D', join(home, 'postgres'),
    ...(action === 'start' ? ['-l', join(root, 'postgres.log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1${extra}`] : ['-m', 'fast']),
    '-w', '-t', '60']);
}
const pool = (database) => new deps.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database, max: 1 });
async function seed() {
  const name = 'helper_' + stamp();
  await ctl('start');
  try {
    const admin = pool('postgres');
    await admin.query(`create database ${name}`);
    await admin.end();
    const q = pool(name);
    await q.query('create table schema_migrations(version integer primary key,name text,checksum char(64))');
    for (const m of deps.migrations.slice(0, 28)) {
      await q.query(m.sql);
      await q.query('insert into schema_migrations values($1,$2,$3)', [m.version, m.name, deps.migrationChecksum(m)]);
    }
    const actor = randomUUID();
    await q.query("insert into actors(id,kind,display_name) values($1,'human','Probe sentinel')", [actor]);
    await q.end();
  } finally { await ctl('stop'); }
  cfg.database.name = name;
  await writeFile(join(home, 'studio.json'), JSON.stringify(cfg));
}
const session = () => { const id = 'probe-' + stamp(); return { id, e: join(root, 'evidence-' + id) }; };

function wrapper(script, args) {
  const proc = spawn('powershell.exe', ['-NoProfile', '-File', join(ROOT, 'scripts', script), ...args], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  let stdout = '', stderr = '';
  proc.stdout.on('data', (c) => (stdout += c));
  proc.stderr.on('data', (c) => (stderr += c));
  const done = new Promise((ok) => proc.once('exit', (code) => ok({ code, stdout, stderr: stderr.slice(-1500) })));
  return { proc, done };
}
const phaseArgs = (phase, s, extra = []) => ['-Phase', phase, '-EvidenceDir', s.e, '-SessionId', s.id, '-ReviewFile', review, '-TestContext', context, ...extra];
const run = (phase, s, extra = []) => wrapper('upgrade-theme-intent-v3.ps1', phaseArgs(phase, s, extra)).done;

async function cliChildOf(psPid) {
  const r = await command('powershell.exe', ['-NoProfile', '-Command',
    `@(Get-CimInstance Win32_Process -Filter "ParentProcessId=${psPid} and Name='node.exe'" | Where-Object { $_.CommandLine -match 'theme-intent-upgrade-v3[.]mjs' }).ProcessId -join ','`]);
  return r.stdout.trim();
}
// Start a phase through the real wrapper and taskkill /F the CLI once the helper cluster is started.
async function killAtClusterStart(phase, s, extra = []) {
  const w = wrapper('upgrade-theme-intent-v3.ps1', phaseArgs(phase, s, extra));
  const t0 = Date.now();
  let killed = null;
  while (Date.now() - t0 < 120000) {
    // Run 2: take the CLI PID from the published lease (the CIM query in run 1 was too slow for
    // the short `after` phase), then terminate as soon as the helper cluster-start receipt appears.
    const lockPath = join(home, 'theme-intent-v3.lock');
    if (!killed && (await exists(lockPath))) {
      try { killed = String((await read(lockPath)).pid); } catch {}
    }
    if (killed && (await exists(s.e)) && (await readdir(s.e)).some((p) => p.startsWith('cluster-started-'))) {
      await command('taskkill.exe', ['/PID', killed, '/F'], { allowFailure: true });
      break;
    }
    await sleep(10);
  }
  const r = await w.done;
  return { killed_cli_pid: killed, wrapper_exit: r.code, wrapper_stderr_tail: r.stderr.slice(-400) };
}
async function staleDecision(s, phase, overrides = {}) {
  const lock = join(home, 'theme-intent-v3.lock'), old = await read(lock), p = join(root, 'stale-' + stamp() + '.json');
  await save(p, {
    format: 'theme-intent-owner-stale-state-release/3', candidate_plan_hash: CANDIDATE, installation_plan_hash: PLAN,
    helper_sha256: await bindings(), fixture: true, owner_decision: 'SYNTHETIC REVIEW PROBE CLEANUP ONLY',
    release_stale_state: true, resume_phase: phase, session_id: s.id, studio_home: home, data_dir: join(home, 'postgres'),
    evidence_dir: s.e, config_sha256: await hash(join(home, 'studio.json')), context_sha256: await hash(context),
    lock_sha256: await hash(lock), lock_pid: old.pid, lock_token: old.token, allow_stop_owned_cluster: true, ...overrides,
  });
  return p;
}
async function mutexFree() {
  const t0 = Date.now();
  try { await studioGuard(home, async () => {}); return { acquired: true, ms: Date.now() - t0 }; }
  catch (e) { return { acquired: false, error: String(e.message) }; }
}
async function pidAlive(pid) { try { process.kill(pid, 0); return true; } catch { return false; } }
async function lockState() {
  const p = join(home, 'theme-intent-v3.lock');
  if (!(await exists(p))) return { present: false };
  const l = await read(p);
  return { present: true, pid: l.pid, pid_alive: await pidAlive(l.pid), phase: l.phase, session: l.session };
}

assert.ok(!(await listening(port)), 'probe port occupied');
await mkdir(root);
await writeFile(join(root, 'TEST_ONLY'), 'synthetic helper test\n');
for (const p of [home, products, join(home, 'secrets'), join(home, 'plan-credentials')]) await mkdir(p, { recursive: true });
await writeFile(join(products, 'sentinel.txt'), 'synthetic product');
await writeFile(join(home, 'plan-credentials/vault'), 'synthetic plan vault');
await writeFile(join(root, 'initpw'), password + '\n');
await command(join(bin, 'initdb.exe'), ['-D', join(home, 'postgres'), '-U', 'postgres', '--auth=scram-sha-256', '--encoding=UTF8', '--no-locale', `--pwfile=${join(root, 'initpw')}`]);
await command('powershell.exe', ['-NoProfile', '-Command',
  "Add-Type -AssemblyName System.Security; [IO.File]::WriteAllBytes('" + join(home, 'secrets/postgres.dpapi').replaceAll("'", "''") +
  "',[Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes('" + password + "'),[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:postgres'),[Security.Cryptography.DataProtectionScope]::CurrentUser))"]);
cfg = { database: { mode: 'managed', user: 'postgres', name: 'helper_initial', port }, pg_bin: bin, products_root: products };
deps = await loadDatabase();
await mkdir(install, { recursive: true });
await cp(join(ROOT, '.verification/discovery-semantics-v2-artifacts/studio'), join(install, 'studio'), { recursive: true });
await copyFile(join(ROOT, '.verification/discovery-semantics-v2-artifacts/packaged-creator-desktop.exe'), join(install, 'creator-desktop.exe'));
context = join(root, 'context.json');
await cp(join(ROOT, 'tests/fixtures/theme-intent-v3-installer.ps1'), join(root, 'fixture-installer.ps1'));
await save(context, { format: 'theme-intent-helper-test-layout/3', root, home, install, installer: join(root, 'fixture-installer.ps1') });
review = join(root, 'review.json');
await save(review, { format: 'theme-intent-helper-simulated-review/3', status: 'fixture_only', prior_implementation_involvement: false, candidate_plan_hash: CANDIDATE, installation_plan_hash: PLAN, helper_sha256: await bindings() });
await seed();

try {
  // P1: abrupt external kill during before; mutex must be free, lease retained, cleanup without DPAPI.
  {
    const s = session();
    const k = await killAtClusterStart('before', s);
    const r = { ...k, after_kill: { listening: await listening(port), lock: await lockState(), prepared: await exists(join(s.e, 'prepared.json')), mutex: await mutexFree() } };
    const blob = join(home, 'secrets/postgres.dpapi'), held = join(root, 'held-dpapi');
    await rename(blob, held);
    try {
      const rel = await run('release', s, ['-StaleDecisionFile', await staleDecision(s, 'release')]);
      r.release = { code: rel.code, stdout: rel.stdout.trim(), listening: await listening(port), lock: await lockState(),
        retired: (await readdir(s.e)).filter((p) => p.startsWith('retired-lock-')).length,
        receipt: await read(join(s.e, (await readdir(s.e)).find((p) => p.startsWith('stale-release-')))) };
    } finally { await rename(held, blob); }
    results.probes.p1_external_kill_during_before = r;
  }
  // P2: lease left, helper cluster replaced by an untagged restart (desktop-style) -> refuse, keep running.
  {
    const s = session();
    const k = await killAtClusterStart('before', s);
    await ctl('stop');
    await ctl('start'); // untagged, as the desktop would start it
    const d = await staleDecision(s, 'release');
    const refused = await run('release', s, ['-StaleDecisionFile', d]);
    const r = { ...k, untagged_restart_refused: refused.code !== 0, refused_tail: refused.stderr.slice(-300), listening_after_refusal: await listening(port), lock_after_refusal: await lockState() };
    await ctl('stop'); // the probe stops the cluster it started
    const ok = await run('release', s, ['-StaleDecisionFile', d]);
    r.release_after_stop = { code: ok.code, listening: await listening(port), lock: await lockState(),
      receipt_stopped_owned_cluster: (await read(join(s.e, (await readdir(s.e)).find((p) => p.startsWith('stale-release-'))))).stopped_owned_cluster };
    results.probes.p2_untagged_restart_competing_cluster = r;
  }
  // P3: simulated desktop relaunch mid-run (renamed node copy). Helper must not stop the cluster.
  {
    const s = session();
    const fakeDir = join(root, 'fake-desktop');
    await mkdir(fakeDir);
    await copyFile(process.execPath, join(fakeDir, 'creator-desktop.exe'));
    const w = wrapper('upgrade-theme-intent-v3.ps1', phaseArgs('before', s));
    let fake;
    const t0 = Date.now();
    while (Date.now() - t0 < 120000) {
      if ((await exists(s.e)) && (await readdir(s.e)).some((p) => p.startsWith('cluster-started-'))) {
        fake = spawn(join(fakeDir, 'creator-desktop.exe'), ['-e', 'setTimeout(()=>{},600000)'], { stdio: 'ignore', windowsHide: true });
        break;
      }
      await sleep(25);
    }
    const out = await w.done;
    const r = { wrapper_exit: out.code, stderr_tail: out.stderr.slice(-300), listening: await listening(port), lock: await lockState(),
      left_owned_lock_receipt: (await readdir(s.e)).some((p) => p.startsWith('phase-left-owned-lock-')),
      stopped_receipt: (await readdir(s.e)).some((p) => p.startsWith('cluster-stopped-')),
      prepared: await exists(join(s.e, 'prepared.json')) };
    const d = await staleDecision(s, 'release');
    const refused = await run('release', s, ['-StaleDecisionFile', d]);
    r.release_while_desktop_running = { code: refused.code, listening: await listening(port), tail: refused.stderr.slice(-200) };
    fake.kill();
    await sleep(1000);
    const ok = await run('release', s, ['-StaleDecisionFile', d]);
    r.release_after_desktop_quit = { code: ok.code, listening: await listening(port), lock: await lockState() };
    results.probes.p3_desktop_relaunch_mid_run = r;
  }
  // P4: full fixture install, then external kills during after: one cleanup scoped to admit, one to after.
  {
    const s = session();
    const b = await run('before', s);
    assert.equal(b.code, 0, b.stderr);
    const approval = join(root, 'approve-' + s.id + '.json');
    await save(approval, { format: 'theme-intent-owner-install-approval/3', candidate_plan_hash: CANDIDATE, installation_plan_hash: PLAN,
      prepared_sha256: await hash(join(s.e, 'prepared.json')), install_and_migrate_28_to_29: true, owner_decision: 'SYNTHETIC PROBE ONLY', fixture: true, approved_at: new Date().toISOString() });
    const inst = await wrapper('install-theme-intent-v3.ps1', ['-EvidenceDir', s.e, '-SessionId', s.id, '-ReviewFile', review, '-ApprovalFile', approval, '-InstallAndMigrateApproved', '-TestContext', context]).done;
    assert.equal(inst.code, 0, inst.stderr);
    const effects = {};
    for (const p of ['admission.json', 'installer-intent.json', 'installer-outcome.json', 'migration-intent.json', 'migration-result.json']) effects[p] = await hash(join(s.e, p));
    const r = { install_code: inst.code };
    // Migrate phase does not require the explicit confirmation switch; it must still refuse to repeat.
    const mig = await run('migrate', s, ['-ApprovalFile', approval]);
    r.migrate_without_switch = { code: mig.code, switch_gate_message: /Explicit .* switch/.test(mig.stderr), tail: mig.stderr.slice(-250) };
    const k1 = await killAtClusterStart('after', s, ['-ApprovalFile', approval]);
    r.kill1 = { ...k1, listening: await listening(port), lock: await lockState() };
    const admitScoped = await staleDecision(s, 'admit');
    const a = await run('admit', s, ['-ApprovalFile', approval, '-StaleDecisionFile', admitScoped]);
    r.admit_scoped_release = { code: a.code, tail: a.stderr.slice(-300), listening: await listening(port), lock: await lockState(),
      stale_release_receipts: (await readdir(s.e)).filter((p) => p.startsWith('stale-release-')).length };
    const k2 = await killAtClusterStart('after', s, ['-ApprovalFile', approval]);
    r.kill2 = { ...k2, listening: await listening(port), lock: await lockState() };
    const resumed = await run('after', s, ['-ApprovalFile', approval, '-StaleDecisionFile', await staleDecision(s, 'after')]);
    r.after_resume = { code: resumed.code, stdout: resumed.stdout.trim(), listening: await listening(port), lock: await lockState(),
      verifications: (await readdir(s.e)).filter((p) => p.startsWith('verification-')).length,
      recovery_intents: (await readdir(s.e)).filter((p) => p.startsWith('recovery-intent-')).length };
    r.effect_hashes_unchanged = true;
    for (const [p, h] of Object.entries(effects)) if ((await hash(join(s.e, p))) !== h) r.effect_hashes_unchanged = false;
    results.probes.p4_forward_after_external_kill = r;
  }
} catch (err) {
  results.error = String(err.stack || err);
} finally {
  if (await listening(port)) { try { await ctl('stop'); results.cleanup_stop = true; } catch (e) { results.cleanup_stop_error = String(e); } }
  results.listening_after = await listening(port);
  results.ended_at = new Date().toISOString();
  console.log(JSON.stringify(results, null, 2));
}
