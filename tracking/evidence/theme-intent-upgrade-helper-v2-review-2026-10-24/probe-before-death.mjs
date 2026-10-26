// Independent review probe: process death during the v2 `before` phase.
// Synthetic data only, disposable managed-layout home under ignored .verification, port 55461.
import { mkdir, writeFile, readdir, lstat, cp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
const ROOTURL = 'file:///C:/dev/creator_agent/scripts/theme-intent-upgrade-v2-core.mjs';
const core = await import(ROOTURL);
const { ROOT, CANDIDATE, PLAN, command, save, hash, bindings, loadDatabase, listening } = core;
const bin = 'C:/Program Files/PostgreSQL/18/bin';
const port = 55461;
const password = 'b'.repeat(64);
const root = join(ROOT, '.verification', 'theme-v2-review-probe-' + Date.now());
const home = join(root, 'home'), install = join(root, 'program'), products = join(root, 'products');
const log = [];
const note = (k, v) => { log.push({ at: new Date().toISOString(), step: k, ...v }); console.log(k, JSON.stringify(v)); };
const ctl = (a) => command(join(bin, 'pg_ctl.exe'), [a, '-D', join(home, 'postgres'),
  ...(a === 'start' ? ['-l', join(root, 'pg.log'), '-o', `-p ${port} -c listen_addresses=127.0.0.1`] : ['-m', 'fast']), '-w', '-t', '60']);
const cli = join(ROOT, 'scripts/theme-intent-upgrade-v2.mjs');
async function run(req, killOn) {
  const p = join(root, 'req-' + randomUUID() + '.json');
  await save(p, req);
  const child = spawn(process.execPath, [cli, p], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
  let out = '', err = '';
  child.stdout.on('data', (c) => (out += c)); child.stderr.on('data', (c) => (err += c));
  child.stdin.end(JSON.stringify({ password }));
  let killed = false;
  if (killOn) {
    const t = setInterval(async () => {
      try {
        if ((await readdir(req.evidence)).some((f) => f.startsWith(killOn))) {
          clearInterval(t); killed = true;
          spawn('taskkill.exe', ['/PID', String(child.pid), '/F'], { stdio: 'ignore' });
        }
      } catch {}
    }, 50);
    child.once('exit', () => clearInterval(t));
  }
  const code = await new Promise((ok) => child.once('exit', (c) => { child.stdout.destroy(); child.stderr.destroy(); ok(c); }));
  return { code, killed, stdout: out.slice(-600), stderr: err.split('\n').find((l) => /Error|assert/i.test(l))?.slice(0, 300) ?? err.slice(0, 300) };
}
try {
  if (await listening(port)) throw new Error('probe port busy');
  await mkdir(root); await writeFile(join(root, 'TEST_ONLY'), 'synthetic helper test\n');
  for (const p of [home, products, join(home, 'secrets'), join(home, 'plan-credentials')]) await mkdir(p, { recursive: true });
  await writeFile(join(products, 'sentinel.txt'), 'synthetic product');
  await writeFile(join(home, 'plan-credentials/vault'), 'synthetic vault');
  await writeFile(join(home, 'secrets/postgres.dpapi'), 'synthetic placeholder (CLI probe bypasses DPAPI)');
  await writeFile(join(root, 'pw'), password + '\n');
  await command(join(bin, 'initdb.exe'), ['-D', join(home, 'postgres'), '-U', 'postgres', '--auth=scram-sha-256', '--encoding=UTF8', '--no-locale', `--pwfile=${join(root, 'pw')}`]);
  const deps = await loadDatabase();
  const name = 'helper_probe';
  await ctl('start');
  try {
    const admin = new deps.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: 'postgres', max: 1 });
    await admin.query(`create database ${name}`); await admin.end();
    const q = new deps.Pool({ host: '127.0.0.1', port, user: 'postgres', password, database: name, max: 1 });
    await q.query('create table schema_migrations(version integer primary key,name text,checksum char(64))');
    for (const m of deps.migrations.slice(0, 28)) { await q.query(m.sql); await q.query('insert into schema_migrations values($1,$2,$3)', [m.version, m.name, deps.migrationChecksum(m)]); }
    await q.query("insert into actors(id,kind,display_name) values($1,'human','Probe sentinel')", [randomUUID()]);
    await q.end();
  } finally { await ctl('stop'); }
  await writeFile(join(home, 'studio.json'), JSON.stringify({ database: { mode: 'managed', user: 'postgres', name, port }, pg_bin: bin, products_root: products }));
  await mkdir(install, { recursive: true });
  await cp(join(ROOT, '.verification/discovery-semantics-v2-artifacts/studio'), join(install, 'studio'), { recursive: true });
  await cp(join(ROOT, '.verification/discovery-semantics-v2-artifacts/packaged-creator-desktop.exe'), join(install, 'creator-desktop.exe'));
  const context = join(root, 'context.json');
  await save(context, { format: 'theme-intent-helper-test-layout/2', root, home, install, installer: join(root, 'fixture-installer.ps1') });
  await cp(join(ROOT, 'tests/fixtures/theme-intent-v2-installer.ps1'), join(root, 'fixture-installer.ps1'));
  const review = join(root, 'review.json');
  await save(review, { format: 'theme-intent-helper-simulated-review/2', status: 'fixture_only', prior_implementation_involvement: false, candidate_plan_hash: CANDIDATE, installation_plan_hash: PLAN, helper_sha256: await bindings() });
  const base = { review, test_context: context, presecret: false };
  const A = { session: 'probe-a', evidence: join(root, 'evidence-a') };
  // 1. Process death during before, right after the helper started the managed cluster.
  const r1 = await run({ ...base, ...A, phase: 'before' }, 'cluster-started-');
  const lock = join(home, 'theme-intent-v2.lock');
  const lockExists = await lstat(lock).then(() => true, () => false);
  note('before killed after cluster start', { code: r1.code, killed: r1.killed, listening: await listening(port), lock_exists: lockExists, evidence: await readdir(A.evidence) });
  // 2. Fresh before with a new session.
  const r2 = await run({ ...base, session: 'probe-b', evidence: join(root, 'evidence-b'), phase: 'before' });
  note('new before after death', { code: r2.code, stderr: r2.stderr });
  // 3. Recovery with a stale-lock decision and explicit owned-cluster stop.
  const decision = join(root, 'recover.json');
  await save(decision, { format: 'theme-intent-owner-recovery-approval/2', candidate_plan_hash: CANDIDATE, installation_plan_hash: PLAN, prepared_sha256: null, fixture: true, owner_decision: 'SYNTHETIC PROBE ONLY', decision_id: 'probe-recover', restore_schema28_program_protected_products: true, reinstall_predecessor_and_relocate_config: true, allow_stop_owned_cluster: true, stale_lock_sha256: lockExists ? await hash(lock) : undefined });
  const r3 = await run({ ...base, ...A, phase: 'recover', approval: decision });
  note('recover after before death', { code: r3.code, stderr: r3.stderr });
  const r4 = await run({ ...base, ...A, phase: 'reconcile', approval: decision });
  note('reconcile after before death', { code: r4.code, stderr: r4.stderr });
  note('final state before probe cleanup', { listening: await listening(port), lock_exists: await lstat(lock).then(() => true, () => false) });
} finally {
  if (await listening(port)) { await ctl('stop'); note('probe stopped disposable cluster', { listening: await listening(port) }); }
  await writeFile(join(root, 'probe-log.json'), JSON.stringify(log, null, 2));
  await writeFile(process.argv[2] ?? join(root, 'probe-out.json'), JSON.stringify({ root, log }, null, 2));
}
