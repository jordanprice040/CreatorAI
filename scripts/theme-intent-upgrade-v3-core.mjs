// Reviewed helper code uses only Node built-ins until all runtime dependencies are bound.
import assert from 'node:assert/strict';
import {
  readFile,
  writeFile,
  readdir,
  lstat,
  mkdir,
  cp,
  realpath,
  rename,
  open,
  unlink,
  link,
} from 'node:fs/promises';
import {
  resolve,
  join,
  relative,
  dirname,
  basename,
  isAbsolute,
} from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import net from 'node:net';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const CANDIDATE =
  '7100a0393460066101e2b493cc1e5ed091e08921c92ccb96cfa643004b9ef8bc';
export const PLAN =
  '27f7952597a4e37796f64cc978712633b9f391a1210189da61ac7d57a3dc67a1';
export const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
export const sha = (b) => createHash('sha256').update(b).digest('hex');
export const hash = async (p) => sha(await readFile(p));
export function canonicalHash(value) {
  const order = (v) =>
    Array.isArray(v)
      ? v.map(order)
      : v !== null && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
              .map(([k, val]) => [k, order(val)]),
          )
        : v;
  return sha(JSON.stringify(order(value)));
}
export const save = (p, v) =>
  writeFile(p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
export async function atomic(p, v) {
  const temp = p + '.' + randomUUID() + '.tmp';
  await save(temp, v);
  await rename(temp, p);
}
export function inside(root, path) {
  const rel = relative(resolve(root), resolve(path));
  return !!rel && !rel.startsWith('..') && !isAbsolute(rel);
}
export function child(root, path) {
  assert.ok(path && !isAbsolute(path) && !/[:\\]/.test(path));
  const p = resolve(root, path);
  assert.ok(inside(root, p));
  return p;
}
export async function noLinks(path) {
  let p = resolve(path);
  while (true) {
    try {
      const s = await lstat(p);
      assert.ok(!s.isSymbolicLink(), `Reparse point forbidden: ${p}`);
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    const parent = dirname(p);
    if (p === parent) break;
    p = parent;
  }
}
export async function files(root) {
  await noLinks(root);
  assert.ok((await lstat(root)).isDirectory());
  const out = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const p = join(root, entry.name);
    assert.ok(!entry.isSymbolicLink());
    if (entry.isDirectory()) {
      for (const [k, h] of Object.entries(await files(p)))
        out[entry.name + '/' + k] = h;
    } else {
      assert.ok(entry.isFile());
      out[entry.name] = await hash(p);
    }
  }
  return out;
}
export async function copyVerified(source, target) {
  await noLinks(source);
  await noLinks(target);
  const map = await files(source);
  await mkdir(target);
  await cp(source, target, {
    recursive: true,
    force: false,
    errorOnExist: true,
  });
  assert.deepEqual(await files(target), map);
  assert.deepEqual(await files(source), map);
  return map;
}
export async function program(root, plan, target = false) {
  await noLinks(root);
  assert.equal(
    await hash(join(root, 'creator-desktop.exe')),
    target
      ? plan.packaged_desktop_sha256
      : plan.expected_predecessor_native_sha256,
  );
  const p = join(root, 'studio/bundle-manifest.json');
  assert.equal(
    await hash(p),
    target
      ? plan.expected_target_manifest_sha256
      : plan.expected_predecessor_manifest_sha256,
  );
  const m = await read(p);
  assert.equal(m.files.length, target ? 71 : 67);
  assert.equal(new Set(m.files.map((f) => f.path)).size, m.files.length);
  for (const f of m.files) {
    const p = child(join(root, 'studio'), f.path);
    await noLinks(p);
    assert.equal(await hash(p), f.sha256);
    assert.equal((await readFile(p)).length, f.bytes);
  }
}
export function fresh(at, now = Date.now()) {
  const age = now - Date.parse(at);
  assert.ok(
    Number.isFinite(age) && age >= 0 && age <= 15 * 60000,
    'Fresh admission evidence required',
  );
}
export async function command(
  exe,
  args,
  {
    input = '',
    env = process.env,
    timeout = 120000,
    allowFailure = false,
    secret = '',
    cwd,
    exitOnly = false,
  } = {},
) {
  const proc = spawn(exe, args, {
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
    env,
    cwd,
  });
  let stdout = '',
    stderr = '',
    timedOut = false;
  const cap = (c) => {
    if (stdout.length + stderr.length > 16 * 1024 * 1024) proc.kill();
    return c.toString();
  };
  proc.stdout.on('data', (c) => (stdout += cap(c)));
  proc.stderr.on('data', (c) => (stderr += cap(c)));
  proc.stdin.on('error', () => {});
  proc.stdin.end(input);
  const timer = setTimeout(() => {
    timedOut = true;
    const killer = spawn(
      'taskkill.exe',
      ['/PID', String(proc.pid), '/T', '/F'],
      { windowsHide: true, stdio: 'ignore' },
    );
    killer.on('error', () => proc.kill());
  }, timeout);
  let code;
  try {
    code = await new Promise((ok, fail) => {
      proc.once('error', fail);
      if (basename(exe).toLowerCase() === 'pg_ctl.exe' || exitOnly) {
        // The server inherits handles on Windows; wait for pg_ctl, not server EOF.
        proc.once('exit', (code) => {
          proc.stdout.destroy();
          proc.stderr.destroy();
          ok(code);
        });
      } else proc.once('close', ok);
    });
  } finally {
    clearTimeout(timer);
  }
  if (secret) {
    stdout = stdout.split(secret).join('<REDACTED>');
    stderr = stderr.split(secret).join('<REDACTED>');
  }
  const result = { code, timed_out: timedOut, stdout, stderr };
  if (!allowFailure)
    assert.ok(
      code === 0 && !timedOut,
      `Command failed (${code}, timeout=${timedOut}): ${stderr.slice(0, 1500)}`,
    );
  return result;
}
export async function bindings() {
  const out = {};
  for (const p of [
    'scripts/theme-intent-upgrade-v3-core.mjs',
    'scripts/theme-intent-upgrade-v3.mjs',
    'scripts/upgrade-theme-intent-v3.ps1',
    'scripts/install-theme-intent-v3.ps1',
    'scripts/recover-theme-intent-v3.ps1',
    'scripts/theme-intent-upgrade-v3-mutex.ps1',
    'packages/db/dist/migrations.js',
  ])
    out[p] = await hash(join(ROOT, p));
  // Resolve the installed pg dependency closure without executing any package code.
  const seen = new Set();
  async function visit(name, from) {
    const req = createRequire(from);
    let entry = req.resolve(name);
    let dir = dirname(entry);
    while (true) {
      try {
        const pkg = await read(join(dir, 'package.json'));
        if (pkg.name === name) break;
      } catch {}
      const parent = dirname(dir);
      assert.notEqual(parent, dir);
      dir = parent;
    }
    dir = await realpath(dir);
    if (seen.has(dir)) return;
    seen.add(dir);
    for (const [p, h] of Object.entries(await files(dir))) {
      if (!p.startsWith('node_modules/'))
        out[relative(ROOT, join(dir, p)).replaceAll('\\', '/')] = h;
    }
    const pkg = await read(join(dir, 'package.json'));
    for (const dep of Object.keys(pkg.dependencies ?? {}))
      await visit(dep, join(dir, 'package.json'));
    for (const dep of Object.keys(pkg.optionalDependencies ?? {})) {
      try {
        createRequire(join(dir, 'package.json')).resolve(dep);
      } catch {
        continue;
      }
      await visit(dep, join(dir, 'package.json'));
    }
  }
  await visit('pg', join(ROOT, 'packages/db/package.json'));
  return out;
}
export async function packageCheck() {
  const base = join(ROOT, 'tracking/evidence/theme-intent-package-2026-10-23');
  const plan = await read(join(base, 'installation-plan.json')),
    candidate = await read(join(base, 'candidate-plan.json'));
  assert.equal(canonicalHash(plan), PLAN);
  assert.equal(canonicalHash(candidate), CANDIDATE);
  const review = await read(
    join(
      ROOT,
      'tracking/evidence/theme-intent-package-review-2026-10-23/reviewer-receipt.json',
    ),
  );
  assert.equal(review.status, 'supported_exact_package_and_declarative_plan');
  for (const map of [candidate.source_sha256, review.artifact_sha256])
    for (const [p, h] of Object.entries(map))
      assert.equal(await hash(join(ROOT, p)), h, p);
  assert.equal(
    await hash(join(ROOT, plan.installer_path)),
    plan.installer_sha256,
  );
  assert.equal(
    await hash(join(ROOT, plan.rollback.previous_installer_path)),
    plan.rollback.previous_installer_sha256,
  );
  await program(join(ROOT, candidate.extracted_payload_dir), plan, true);
  for (const f of (
    await read(
      join(ROOT, candidate.archived_bundle_dir, 'bundle-manifest.json'),
    )
  ).files)
    assert.equal(
      await hash(child(join(ROOT, candidate.archived_bundle_dir), f.path)),
      f.sha256,
    );
  return { plan, candidate };
}
export async function layout(context, plan) {
  if (!context)
    return {
      fixture: false,
      home: plan.studio_home,
      install: plan.target_install_dir,
    };
  const c = await read(context);
  assert.equal(c.format, 'theme-intent-helper-test-layout/3');
  const root = resolve(c.root);
  assert.ok(
    inside(join(ROOT, '.verification'), root),
    'Test layouts must be inside ignored .verification',
  );
  await noLinks(root);
  assert.equal(
    await readFile(join(root, 'TEST_ONLY'), 'utf8'),
    'synthetic helper test\n',
  );
  for (const key of ['home', 'install', 'installer']) {
    assert.ok(inside(root, c[key]), key);
    await noLinks(c[key]);
  }
  return { ...c, fixture: true, root };
}
export async function reviewCheck(path, fixture) {
  const r = await read(path);
  assert.equal(
    r.format,
    fixture
      ? 'theme-intent-helper-simulated-review/3'
      : 'theme-intent-upgrade-independent-review/3',
  );
  assert.equal(r.status, fixture ? 'fixture_only' : 'supported_exact_helper');
  assert.equal(r.prior_implementation_involvement, false);
  assert.equal(r.candidate_plan_hash, CANDIDATE);
  assert.equal(r.installation_plan_hash, PLAN);
  assert.deepEqual(r.helper_sha256, await bindings());
}
export async function paths(l, evidence, session) {
  assert.match(session, /^[a-z0-9-]{1,64}$/);
  const backup = join(l.home, 'backups', 'theme-intent-v3-' + session);
  const e = resolve(evidence);
  await noLinks(e);
  await noLinks(backup);
  assert.ok(
    inside(join(ROOT, 'tracking/evidence'), e) ||
      (l.fixture && inside(l.root, e)),
    'Hash evidence only under tracking/evidence or fixture root',
  );
  for (const src of [
    l.install,
    join(l.home, 'secrets'),
    join(l.home, 'plan-credentials'),
  ]) {
    assert.ok(!inside(src, backup) && backup !== resolve(src));
  }
  assert.ok(
    !inside(ROOT, backup) || inside(join(ROOT, '.verification'), backup),
    'Sensitive backup must be outside tracked repository',
  );
  return { e, backup };
}
export async function quit() {
  const r = await command('powershell.exe', [
    '-NoProfile',
    '-Command',
    "$ErrorActionPreference='Stop'; @(Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'creator-desktop.exe' -or ($_.Name -eq 'node.exe' -and ($_.CommandLine -match 'studio[.]mjs|orchestrator|pilot-main')) }).Count",
  ]);
  assert.equal(r.stdout.trim(), '0', 'Fully quit desktop/workers');
}
export const listening = (port) =>
  new Promise((ok) => {
    const s = net.connect({ host: '127.0.0.1', port });
    s.setTimeout(1500);
    s.once('connect', () => {
      s.destroy();
      ok(true);
    });
    s.once('error', () => ok(false));
    s.once('timeout', () => {
      s.destroy();
      ok(true);
    });
  });
export async function managed(cfg, home, e, body, lease) {
  const data = join(home, 'postgres');
  await noLinks(data);
  assert.equal((await readFile(join(data, 'PG_VERSION'), 'utf8')).trim(), '18');
  const ctl = join(cfg.pg_bin, 'pg_ctl.exe');
  const status = await command(ctl, ['status', '-D', data], {
    allowFailure: true,
  });
  assert.equal(
    status.code,
    3,
    'Cluster already running or uncertain; reconcile before use',
  );
  assert.ok(
    !(await listening(cfg.database.port)),
    'Foreign listener blocks cluster start',
  );
  let started = false;
  lease.clusterTouched = true;
  await save(join(e, 'cluster-start-intent-' + randomUUID() + '.json'), {
    data,
    lease_token: lease.record.token,
    at: new Date().toISOString(),
  });
  try {
    await command(ctl, [
      'start',
      '-D',
      data,
      '-l',
      join(home, 'helper-postgres.log'),
      '-o',
      `-p ${cfg.database.port} -c listen_addresses=127.0.0.1 -c cluster_name=creator-upgrade-${lease.record.token}`,
      '-w',
      '-t',
      '60',
    ]);
    started = true;
    await save(join(e, 'cluster-started-' + randomUUID() + '.json'), {
      data,
      at: new Date().toISOString(),
      started_by_helper: true,
      lease_token: lease.record.token,
    });
    return await body();
  } finally {
    const finalStatus = await command(ctl, ['status', '-D', data], {
      allowFailure: true,
    });
    if (
      finalStatus.code === 0 &&
      (await ownedCluster(home, lease.record.token))
    ) {
      await quit(); // A desktop that was relaunched must quit before this cluster is stopped.
      await command(ctl, ['stop', '-D', data, '-m', 'fast', '-w', '-t', '60']);
      assert.ok(!(await listening(cfg.database.port)));
      await save(join(e, 'cluster-stopped-' + randomUUID() + '.json'), {
        data,
        at: new Date().toISOString(),
        stopped_by_helper: true,
      });
      lease.cleanupCompleted = true;
    } else if (finalStatus.code === 3) {
      lease.cleanupCompleted = true;
    } else {
      lease.cleanupCompleted = false;
      await save(
        join(e, 'cluster-ownership-uncertain-' + randomUUID() + '.json'),
        { at: new Date().toISOString(), started, automatic_stop: false },
      );
    }
  }
}
export async function loadDatabase() {
  assert.ok(
    !process.env.NODE_PG_FORCE_NATIVE,
    'Unbound native pg override forbidden',
  );
  const { migrations, migrationChecksum } = await import(
    pathToFileURL(join(ROOT, 'packages/db/dist/migrations.js'))
  );
  const { Pool } = createRequire(join(ROOT, 'packages/db/package.json'))('pg');
  return { migrations, migrationChecksum, Pool };
}
export async function snapshot(pool, l, cfg, schema, deps, dump, password) {
  const c = await pool.connect();
  try {
    await c.query('begin isolation level repeatable read read only');
    const s = await state(c, l.home, cfg.products_root, schema, deps);
    if (dump) {
      const id = (await c.query('select pg_export_snapshot() id')).rows[0].id;
      await command(
        join(cfg.pg_bin, 'pg_dump.exe'),
        [
          '--format=custom',
          '--no-owner',
          '--no-privileges',
          `--snapshot=${id}`,
          `--file=${dump}`,
          `--dbname=${databaseUrl(cfg)}`,
        ],
        {
          env: { ...process.env, PGPASSWORD: password },
          timeout: 600000,
          secret: password,
        },
      );
      await command(join(cfg.pg_bin, 'pg_restore.exe'), ['--list', dump], {
        timeout: 600000,
      });
    }
    return s;
  } finally {
    await c.query('rollback').catch(() => {});
    c.release();
  }
}
export function databaseUrl(cfg, name = cfg.database.name) {
  return `postgresql://${encodeURIComponent(cfg.database.user)}@127.0.0.1:${cfg.database.port}/${encodeURIComponent(name)}`;
}
export async function state(
  q,
  home,
  products,
  schema,
  { migrations, migrationChecksum },
) {
  for (const sql of [
    "select count(*)::int n from pg_stat_activity where datname=current_database() and backend_type='client backend' and pid<>pg_backend_pid()",
    "select count(*)::int n from plan_requests where state not in ('completed','failed','rejected','reconciled')",
    "select count(*)::int n from plan_qualifications where state='running'",
    "select count(*)::int n from workflows where state not in ('succeeded','failed','cancelled')",
    "select count(*)::int n from workflow_tasks where state not in ('succeeded','failed','cancelled')",
    "select count(*)::int n from budget_reservations where status in ('in_flight','unknown')",
    "select count(*)::int n from source_retrievals where state='in_flight'",
    "select count(*)::int n from context_batches where status in ('submitting','submitted','unknown')",
    "select count(*)::int n from github_operations where state in ('dispatched','unknown')",
    "select count(*)::int n from marketing_deliveries where state in ('dispatching','unknown')",
    "select count(*)::int n from portfolio_jobs where state in ('dispatching','unknown')",
    "select count(*)::int n from desktop_jobs where state not in ('completed','cancelled','expired')",
    "select count(*)::int n from artifact_previews where state in ('starting','ready')",
  ])
    assert.equal(
      (await q.query(sql)).rows[0].n,
      0,
      'Active/uncertain work blocks upgrade',
    );
  const ledger = (
    await q.query(
      'select version,name,checksum from schema_migrations order by version',
    )
  ).rows;
  assert.deepEqual(
    ledger.map((r) => r.version),
    Array.from({ length: schema }, (_, i) => i + 1),
  );
  for (const row of ledger) {
    const m = migrations.find((m) => m.version === row.version);
    assert.equal(row.name, m.name);
    assert.equal(row.checksum, migrationChecksum(m));
  }
  const hashes = {};
  for (const { tablename } of (
    await q.query(
      "select tablename from pg_tables where schemaname='public' and tablename<>'schema_migrations' order by tablename",
    )
  ).rows) {
    assert.match(tablename, /^[a-z_][a-z0-9_]*$/);
    hashes[tablename] = canonicalHash(
      JSON.parse(
        JSON.stringify(
          (
            await q.query(
              `select * from "${tablename}" order by to_jsonb("${tablename}")::text`,
            )
          ).rows,
        ),
      ),
    );
  }
  return {
    observed_at: new Date().toISOString(),
    schema,
    migrations: ledger,
    hashes,
    studio_config_sha256: await hash(join(home, 'studio.json')),
    protected_files: {
      secrets: await files(join(home, 'secrets')),
      plan_credentials: await files(join(home, 'plan-credentials')),
    },
    products: await files(products),
  };
}
export function preserved(before, after, schema) {
  assert.equal(after.schema, schema);
  for (const k of [
    'hashes',
    'studio_config_sha256',
    'protected_files',
    'products',
  ])
    assert.deepEqual(after[k], before[k], k);
  assert.deepEqual(after.migrations.slice(0, 28), before.migrations);
}
export async function phaseLock(home, e, phase, metadata = {}) {
  const p = join(home, 'theme-intent-v3.lock');
  const temp = p + '.' + randomUUID() + '.tmp';
  const record = {
    ...metadata,
    phase,
    evidence: e,
    pid: process.pid,
    at: new Date().toISOString(),
    token: randomUUID(),
  };
  const f = await open(temp, 'wx');
  try {
    await f.writeFile(JSON.stringify(record));
    await f.sync();
  } finally {
    await f.close();
  }
  try {
    await link(temp, p);
  } finally {
    await unlink(temp);
  }
  const unlock = async () => {
    assert.equal((await read(p)).token, record.token);
    await unlink(p);
  };
  unlock.record = record;
  return unlock;
}

export async function studioGuard(home, body) {
  const name =
    'Local\\CreatorAgentUpgradeV3-' + sha(resolve(home).toLowerCase());
  const proc = spawn(
    'powershell.exe',
    [
      '-NoProfile',
      '-File',
      join(ROOT, 'scripts/theme-intent-upgrade-v3-mutex.ps1'),
      '-Name',
      name,
      '-OwnerPid',
      String(process.pid),
    ],
    { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true },
  );
  let released = false,
    ready = false,
    output = '';
  proc.stderr.resume();
  proc.stdin.on('error', () => {});
  const done = new Promise((ok) => proc.once('close', ok));
  await new Promise((ok, fail) => {
    const timer = setTimeout(() => {
      proc.kill();
      fail(new Error('Studio mutex startup timed out'));
    }, 10000);
    proc.once('error', (err) => {
      clearTimeout(timer);
      fail(err);
    });
    proc.once('exit', (code) => {
      if (!ready) {
        clearTimeout(timer);
        fail(new Error('Studio mutex unavailable: ' + code));
      } else if (!released) process.exit(78);
    });
    proc.stdout.on('data', (c) => {
      output += c;
      if (output.includes('ACQUIRED')) {
        ready = true;
        clearTimeout(timer);
        ok();
      }
    });
  });
  try {
    return await body();
  } finally {
    released = true;
    proc.stdin.end('RELEASE\n');
    await done;
  }
}
export async function ownedCluster(home, token) {
  assert.match(token, /^[0-9a-f-]{36}$/);
  const opts = await readFile(join(home, 'postgres/postmaster.opts'), 'utf8');
  return opts.includes('cluster_name=creator-upgrade-' + token);
}
export async function staleCheck(req, l, cfg, e) {
  const a = await read(req.stale_decision),
    p = join(l.home, 'theme-intent-v3.lock');
  await noLinks(p);
  assert.equal(a.format, 'theme-intent-owner-stale-state-release/3');
  assert.equal(a.candidate_plan_hash, CANDIDATE);
  assert.equal(a.installation_plan_hash, PLAN);
  assert.deepEqual(a.helper_sha256, await bindings());
  assert.equal(a.fixture, l.fixture);
  assert.ok(a.owner_decision?.trim());
  assert.equal(a.release_stale_state, true);
  assert.equal(a.resume_phase, req.phase);
  assert.equal(a.session_id, req.session);
  assert.equal(resolve(a.studio_home), resolve(l.home));
  assert.equal(resolve(a.data_dir), resolve(l.home, 'postgres'));
  assert.equal(resolve(a.evidence_dir), e);
  assert.equal(a.config_sha256, await hash(join(l.home, 'studio.json')));
  assert.equal(
    a.context_sha256,
    req.test_context ? await hash(req.test_context) : null,
  );
  assert.equal(a.lock_sha256, await hash(p));
  const old = await read(p);
  assert.equal(old.evidence, e);
  assert.equal(old.session, req.session);
  assert.equal(old.home, resolve(l.home));
  assert.equal(a.lock_pid, old.pid);
  assert.equal(a.lock_token, old.token);
  assert.ok(Number.isInteger(old.pid) && old.pid > 0);
  let alive = true;
  try {
    process.kill(old.pid, 0);
  } catch (err) {
    if (err.code === 'ESRCH') alive = false;
    else throw err;
  }
  assert.ok(!alive, 'Stale-lock owner is still alive');
  return { a, old, p };
}
export async function releaseStale(req, l, cfg, e) {
  await quit();
  const { a, old, p } = await staleCheck(req, l, cfg, e);
  const ctl = join(cfg.pg_bin, 'pg_ctl.exe'),
    data = join(l.home, 'postgres');
  await noLinks(data);
  const s = await command(ctl, ['status', '-D', data], { allowFailure: true });
  let stopped = false;
  if (s.code === 0) {
    assert.equal(
      a.allow_stop_owned_cluster,
      true,
      'Separate permission to stop the owned cluster is required',
    );
    assert.ok(
      await ownedCluster(l.home, old.token),
      'Foreign cluster ownership; nothing stopped',
    );
    await quit();
    await command(ctl, ['stop', '-D', data, '-m', 'fast', '-w', '-t', '60']);
    stopped = true;
  } else assert.equal(s.code, 3, 'Cluster state uncertain; nothing retired');
  const retired = join(e, 'retired-lock-' + randomUUID() + '.json');
  await rename(p, retired);
  await save(join(e, 'stale-release-' + randomUUID() + '.json'), {
    at: new Date().toISOString(),
    decision_sha256: await hash(req.stale_decision),
    retired_lock_sha256: a.lock_sha256,
    retired_lock: retired,
    stopped_owned_cluster: stopped,
    prepared_required: false,
    credentials_read: false,
    installer_repeated: false,
    migration_repeated: false,
  });
}
