// §2.1 installed-app lifecycle acceptance (ADR-0041), scripted without UI control.
// Uses the INSTALLED app and its bundled Node/service, an isolated studio home and an
// app-managed PostgreSQL cluster. Optionally seeds that home by adopting the owner's
// existing studio read-only (pg_dump of the source; the source is never written).
//
//   node apps/desktop/studio-acceptance.mjs --pg-bin C:\pgsql18\pgsql\bin [--adopt-env C:\dev\creator_agent\.env.docker]
//
// Writes JSON evidence to tracking/evidence/desktop-2-1/. Interactive steps (setup screen,
// menu sign-in, record creation in the window) are reported as not executed.
import { execFileSync, spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { connect } from 'node:net';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : fallback;
};
const exe = resolve(
  arg(
    '--exe',
    join(process.env.LOCALAPPDATA, 'Creator Agent', 'creator-desktop.exe'),
  ),
);
const pgBin = arg('--pg-bin', 'C:\\pgsql18\\pgsql\\bin');
const adoptEnv = arg('--adopt-env', null);
const resources = join(exe, '..', 'studio');
const home = join(
  tmpdir(),
  `creator-acceptance-${randomBytes(4).toString('hex')}`,
);
const out = resolve('tracking/evidence/desktop-2-1');
const results = [];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const record = (check, ok, detail) => {
  results.push({ check, ok, detail });
  console.log(
    `${ok ? 'PASS' : 'FAIL'} ${check}${detail ? ` — ${JSON.stringify(detail)}` : ''}`,
  );
};
const ps = (script, input) =>
  execFileSync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    {
      input,
      encoding: 'utf8',
    },
  ).trim();
const processes = () =>
  JSON.parse(
    ps(
      "Get-CimInstance Win32_Process -Filter \"Name='creator-desktop.exe' or Name='node.exe' or Name='postgres.exe'\" | Select-Object ProcessId,ParentProcessId,Name,ExecutablePath,CommandLine | ConvertTo-Json -Compress",
    ) || '[]',
  );
const list = () => [].concat(processes());
const ours = () =>
  list().filter(
    (p) =>
      // Paths are compared by suffix: a packaged shell may see the install through a
      // virtualized AppData location.
      (p.Name === 'creator-desktop.exe' &&
        p.ExecutablePath?.toLowerCase().endsWith(
          '\\creator agent\\creator-desktop.exe',
        )) ||
      (p.Name === 'node.exe' &&
        p.ExecutablePath?.toLowerCase().endsWith(
          '\\creator agent\\studio\\node\\node.exe',
        )) ||
      (p.Name === 'postgres.exe' &&
        p.CommandLine?.toLowerCase().includes(home.toLowerCase())),
  );
const log = () => {
  try {
    return readFileSync(join(home, 'logs', 'supervisor.log'), 'utf8');
  } catch {
    return '';
  }
};
async function until(label, f, ms = 90000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const v = await f();
    if (v) return v;
    await sleep(500);
  }
  throw new Error(`Timed out waiting for ${label}`);
}
const portOpen = (port) =>
  new Promise((r) => {
    const s = connect(port, '127.0.0.1');
    s.once('connect', () => (s.destroy(), r(true)));
    s.once('error', () => r(false));
  });
function launch(args = []) {
  const child = spawn(exe, args, {
    env: { ...process.env, CREATOR_STUDIO_HOME: home },
    stdio: 'ignore',
    detached: true,
  });
  child.unref();
  return child;
}
const marks = () => log().split('\n').length;
async function phase(name, since, ms) {
  return until(
    `[${name}] after line ${since}`,
    () =>
      log()
        .split('\n')
        .slice(since)
        .find((l) => l.includes(`[${name}]`)),
    ms,
  );
}
const close = (pid) => {
  try {
    execFileSync('taskkill.exe', ['/PID', String(pid)], { stdio: 'ignore' });
  } catch {}
};
const kill = (pid) => {
  try {
    execFileSync('taskkill.exe', ['/F', '/PID', String(pid)], {
      stdio: 'ignore',
    });
  } catch {}
};
const pgRunning = () => {
  try {
    execFileSync(
      join(pgBin, 'pg_ctl.exe'),
      ['status', '-D', join(home, 'postgres', 'data')],
      { stdio: 'ignore' },
    );
    return true;
  } catch {
    return false;
  }
};

// DPAPI CurrentUser, same entropy scheme as the app's secret store (secret.rs).
function protect(name, value) {
  const b64 = ps(
    `Add-Type -AssemblyName System.Security; $v=[Console]::In.ReadToEnd(); $e=[Text.Encoding]::UTF8.GetBytes('creator-agent-studio/1:${name}'); [Convert]::ToBase64String([Security.Cryptography.ProtectedData]::Protect([Text.Encoding]::UTF8.GetBytes($v),$e,'CurrentUser'))`,
    value,
  );
  writeFileSync(
    join(home, 'secrets', `${name}.dpapi`),
    Buffer.from(b64, 'base64'),
  );
}
function service(mode, input) {
  return new Promise((ok, fail) => {
    const p = spawn(
      join(resources, 'node', 'node.exe'),
      [join(resources, 'service', 'app', 'dist', 'studio.mjs'), mode],
      {
        stdio: ['pipe', 'pipe', 'inherit'],
        env: {
          SystemRoot: process.env.SystemRoot,
          PATH: `${process.env.SystemRoot}\\System32`,
        },
      },
    );
    let last = null;
    let buf = '';
    p.stdout.on('data', (d) => {
      buf += d;
      for (const l of buf.split('\n').slice(0, -1)) last = JSON.parse(l);
      buf = buf.slice(buf.lastIndexOf('\n') + 1);
    });
    p.on('exit', (c) =>
      c === 0 && last?.event === 'result'
        ? ok(last.result)
        : fail(new Error(JSON.stringify(last))),
    );
    p.stdin.end(JSON.stringify(input) + '\n');
  });
}

const evidence = {
  format: 'creator-desktop-acceptance/1',
  started_at: new Date().toISOString(),
  installed_exe: exe,
  bundle: JSON.parse(
    readFileSync(join(resources, 'bundle-manifest.json'), 'utf8'),
  ),
  home_kind: 'isolated acceptance home under %TEMP%, not the owner default',
  interactive_not_executed: [
    'first-run setup screen clicks',
    'menu sign-in as local owner and record creation inside the window',
    'background/tray mode and launch-at-login toggles',
    'Windows restart',
  ],
};
delete evidence.bundle.files;
try {
  if (!existsSync(exe)) throw new Error(`Installed app not found: ${exe}`);
  for (const d of ['logs', 'secrets', 'backups'])
    mkdirSync(join(home, d), { recursive: true });
  // Seed: app-managed cluster exactly as setup creates it (scram, loopback, generated password).
  const pw = randomBytes(24).toString('hex');
  let port = 55440;
  while (await portOpen(port)) port++;
  protect('postgres', pw);
  mkdirSync(join(home, 'postgres'), { recursive: true });
  writeFileSync(join(home, 'postgres', 'init.pw'), pw);
  execFileSync(
    join(pgBin, 'initdb.exe'),
    [
      '-D',
      join(home, 'postgres', 'data'),
      '-U',
      'creator',
      '--auth=scram-sha-256',
      `--pwfile=${join(home, 'postgres', 'init.pw')}`,
      '--encoding=UTF8',
      '--no-locale',
    ],
    { stdio: 'ignore' },
  );
  rmSync(join(home, 'postgres', 'init.pw'));
  execFileSync(
    join(pgBin, 'pg_ctl.exe'),
    [
      'start',
      '-D',
      join(home, 'postgres', 'data'),
      '-l',
      join(home, 'logs', 'postgres.log'),
      '-o',
      `-p ${port} -c listen_addresses=127.0.0.1`,
      '-w',
    ],
    { stdio: 'ignore' },
  );
  const url = `postgresql://creator:${pw}@127.0.0.1:${port}/creator_studio`;
  const input = {
    protocol: 'creator-studio/1',
    database_url: url,
    products_root: join(home, 'products'),
    backups_dir: join(home, 'backups'),
    pg_bin: pgBin,
    web_root: null,
    owner_secret: null,
    login_code: null,
    worker_distro: null,
    source: null,
  };
  let origin;
  if (adoptEnv) {
    const line = readFileSync(adoptEnv, 'utf8')
      .split(/\r?\n/)
      .filter((l) => l.startsWith('CREATOR_DOCKER_PASSWORD='));
    if (line.length !== 1)
      throw new Error('Expected one CREATOR_DOCKER_PASSWORD line');
    const src = `postgresql://creator:${encodeURIComponent(line[0].slice(24))}@127.0.0.1:55433/creator_studio`;
    const r = await service('adopt', {
      ...input,
      source: {
        database_url: src,
        products_root: resolve('.creator/studio/products'),
      },
    });
    record(
      'adopt existing creator_studio read-only into the managed cluster',
      r.ok === true,
      {
        workspaces: r.workspaces,
        counts: r.counts,
        audit_chain: r.check.audit_chain,
        products_files: r.products_files,
      },
    );
    origin = {
      kind: 'adopted',
      adopted_at: new Date().toISOString(),
      from: '127.0.0.1:55433/creator_studio',
      backup_dir: r.backup_dir,
      verified: r.ok,
      workspaces: r.workspaces,
      counts: r.counts,
      audit_chain: r.check.audit_chain,
      seeded_by: 'studio-acceptance.mjs',
    };
  } else {
    const r = await service('init', input);
    record('new empty studio via bundled service', r.applied.length > 0, {
      applied: r.applied.length,
    });
    origin = {
      kind: 'new_empty',
      created_at: new Date().toISOString(),
      seeded_by: 'studio-acceptance.mjs',
    };
  }
  execFileSync(
    join(pgBin, 'pg_ctl.exe'),
    ['stop', '-D', join(home, 'postgres', 'data'), '-m', 'fast', '-w'],
    { stdio: 'ignore' },
  );
  writeFileSync(
    join(home, 'studio.json'),
    JSON.stringify(
      {
        format: 'creator-desktop-config/1',
        database: {
          mode: 'managed',
          port,
          name: 'creator_studio',
          user: 'creator',
          label: `app-managed PostgreSQL on 127.0.0.1:${port}`,
        },
        pg_bin: pgBin,
        products_root: join(home, 'products'),
        close_behavior: 'quit',
        launch_at_login: false,
        origin,
        created_at: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  const devPorts = (await Promise.all([5173, 4310, 4320].map(portOpen))).some(
    Boolean,
  );
  evidence.studio_ports_busy_before_launch = devPorts;
  if (devPorts) {
    // Another program (e.g. a development studio) owns the ports: the app must refuse it.
    const m = marks();
    launch();
    const line = await phase('failed', m);
    record(
      'occupied studio port is refused with an actionable message',
      /port/i.test(line),
      { line },
    );
    record(
      'studio window not shown on a foreign listener',
      !log()
        .split('\n')
        .slice(m)
        .some((l) => l.includes('[running]')),
    );
    const app = ours().find((p) => p.Name === 'creator-desktop.exe');
    record('app-managed PostgreSQL started from the studio home', pgRunning());
    close(app.ProcessId);
    await until(
      'quit after port conflict',
      () => !ours().some((p) => p.Name === 'creator-desktop.exe'),
      40000,
    );
    record(
      'closing the status window while not running quits and stops the database',
      !pgRunning(),
    );
    throw Object.assign(
      new Error(
        'Studio ports are held by another program; remaining launch checks need them free.',
      ),
      { soft: true },
    );
  }

  // Cold launch with nothing running.
  let m = marks();
  const t0 = Date.now();
  launch();
  await phase('running', m);
  record(
    'cold installed launch reaches running with ownership verified',
    true,
    { seconds: (Date.now() - t0) / 1000 },
  );
  const health = await (await fetch('http://127.0.0.1:4310/api/health')).json();
  record(
    'API health from installed service',
    health.status === 'ok' && health.persistent === true,
    { storage: health.storage, data_mode: health.data_mode },
  );
  const ui = await (await fetch('http://127.0.0.1:5173/')).text();
  record(
    'production UI served (no dev server)',
    ui.includes('<div id="root"') || ui.includes('<!doctype html'),
    null,
  );
  const status = await (
    await fetch('http://127.0.0.1:5173/api/auth/status')
  ).json();
  record(
    'sign-in is app-managed (code never displayed)',
    status.managed_by === 'desktop_app',
    status,
  );
  record('preview origin listening', await portOpen(4320));
  let procs = ours();
  const appPid = procs.find((p) => p.Name === 'creator-desktop.exe').ProcessId;
  const nodes = procs.filter((p) => p.Name === 'node.exe');
  record(
    'exactly one service child, owned by the app',
    nodes.length === 1 && nodes[0].ParentProcessId === appPid,
    { nodes: nodes.length },
  );
  record(
    'no repository or dev-server process involved',
    !nodes[0].CommandLine.toLowerCase().includes('creator_agent\\scripts'),
    { cmd: nodes[0].CommandLine.replace(/\s+/g, ' ').slice(0, 160) },
  );

  // Duplicate launch: the second process exits; still one supervisor and one service.
  const second = launch();
  await sleep(4000);
  procs = ours();
  record(
    'duplicate launch hands off and exits',
    procs.filter((p) => p.Name === 'creator-desktop.exe').length === 1 &&
      procs.filter((p) => p.Name === 'node.exe').length === 1,
    { second_pid: second.pid },
  );

  // Crash recovery: kill the service; the supervisor restarts it within bounds.
  m = marks();
  kill(nodes[0].ProcessId);
  await phase('running', m);
  const restarted = ours().filter((p) => p.Name === 'node.exe');
  record(
    'service crash is restarted (bounded) and ownership re-verified',
    restarted.length === 1 && restarted[0].ProcessId !== nodes[0].ProcessId,
    {
      restart_lines: log()
        .split('\n')
        .slice(m)
        .filter((l) => /Restart|exited/.test(l)),
    },
  );

  // Explicit quit via window close (close behavior = quit).
  m = marks();
  close(appPid);
  await until(
    'app exit',
    () => !ours().some((p) => p.Name === 'creator-desktop.exe'),
    60000,
  );
  record(
    'close with quit setting stops service and database gracefully',
    !ours().some((p) => p.Name === 'node.exe') &&
      !pgRunning() &&
      log().includes('quit complete'),
    { lines: log().split('\n').slice(m).filter(Boolean) },
  );

  // Relaunch: same configuration and records come back.
  m = marks();
  launch();
  await phase('running', m);
  record('relaunch after quit reaches running from saved settings', true);
  const app2 = ours().find((p) => p.Name === 'creator-desktop.exe').ProcessId;

  // Supervisor crash: job object takes the service down; the database survives and is reused.
  kill(app2);
  await until(
    'service gone with supervisor',
    () =>
      !ours().some(
        (p) => p.Name === 'node.exe' || p.Name === 'creator-desktop.exe',
      ),
    20000,
  );
  record('supervisor crash leaves no orphan service (job object)', true);
  record('database survives a supervisor crash', pgRunning());
  m = marks();
  launch();
  await phase('running', m);
  record(
    "relaunch after crash reuses the app's running database",
    log()
      .split('\n')
      .slice(m)
      .some((l) => l.includes('reusing the app')),
  );
  close(ours().find((p) => p.Name === 'creator-desktop.exe').ProcessId);
  await until('final quit', () => !ours().length, 60000);

  // Port conflict with a foreign listener on 5173.
  const squatter = createServer((_q, r) => r.end('not the studio'));
  await new Promise((r) => squatter.listen(5173, '127.0.0.1', r));
  m = marks();
  launch();
  const line = await phase('failed', m);
  record(
    'foreign listener on 5173 is refused with an actionable message',
    /5173/.test(line),
    { line },
  );
  close(ours().find((p) => p.Name === 'creator-desktop.exe').ProcessId);
  await until('quit after conflict', () => !ours().length, 60000);
  squatter.close();

  // Unavailable dependency: PostgreSQL folder missing.
  const cfg = JSON.parse(readFileSync(join(home, 'studio.json'), 'utf8'));
  writeFileSync(
    join(home, 'studio.json'),
    JSON.stringify({ ...cfg, pg_bin: join(home, 'missing-pg') }, null, 2),
  );
  m = marks();
  launch();
  const missing = await phase('failed', m);
  record(
    'missing PostgreSQL prerequisite is an actionable failure',
    /postgres/i.test(missing),
    { line: missing },
  );
  close(ours().find((p) => p.Name === 'creator-desktop.exe').ProcessId);
  await until('quit after missing dependency', () => !ours().length, 60000);
  writeFileSync(join(home, 'studio.json'), JSON.stringify(cfg, null, 2));
} catch (e) {
  if (!e.soft) record('harness', false, { error: e.message });
  else evidence.stopped_early = e.message;
} finally {
  for (const p of ours()) if (p.Name !== 'postgres.exe') kill(p.ProcessId);
  if (pgRunning())
    execFileSync(
      join(pgBin, 'pg_ctl.exe'),
      ['stop', '-D', join(home, 'postgres', 'data'), '-m', 'fast', '-w'],
      { stdio: 'ignore' },
    );
  evidence.finished_at = new Date().toISOString();
  evidence.results = results;
  evidence.supervisor_log = log().split('\n').filter(Boolean);
  mkdirSync(out, { recursive: true });
  const file = join(
    out,
    `acceptance-${evidence.started_at.replace(/[:.]/g, '-')}.json`,
  );
  writeFileSync(file, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`evidence: ${file}`);
  console.log(`home kept for inspection: ${home}`);
  process.exitCode = results.every((r) => r.ok) ? 0 : 1;
}
