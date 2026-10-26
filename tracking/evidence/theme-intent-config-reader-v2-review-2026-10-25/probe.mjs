// U02 reviewer probes for reader v2. Usage: node probe.mjs <scratch tree>. Disposable fixtures only.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const tree = path.resolve(process.argv[2]);
const parent = path.join(tree, '.verification');
const load = (n) => import(pathToFileURL(path.join(tree, 'scripts', n)).href);
const exact = await load('reader.mjs');
const noNlink = await load('reader-no-nlink.mjs');
const noPre = await load('reader-no-preopen-nlink.mjs');
const noLstat = await load('reader-no-lstat-link.mjs');
const digest = (b) => crypto.createHash('sha256').update(b).digest('hex');
const marker = 'theme-config-reader-fixture/2\n';
const cfg = (o = {}) => ({
  format: 'creator-desktop-config/1',
  database: { mode: 'managed', port: 55455, name: 'n', user: 'u', label: 'SENTINEL' },
  pg_bin: 'C:/fixture/PostgreSQL/18/bin',
  products_root: 'C:/p',
  close_behavior: 'quit',
  launch_at_login: false,
  origin: {},
  created_at: 'synthetic',
  ...o,
});
const out = {};
const outcome = async (fn) => {
  try {
    const r = await fn();
    return r && r.status ? r.status : JSON.stringify(r);
  } catch (e) {
    return `refused:${e.message}`;
  }
};
async function root() {
  await fs.mkdir(parent, { recursive: true });
  const r = await fs.mkdtemp(path.join(parent, 'theme-config-reader-v2-'));
  return r;
}
async function populate(r, raw) {
  await fs.writeFile(path.join(r, 'studio.json'), raw);
  await fs.writeFile(path.join(r, 'SYNTHETIC_FIXTURE_ONLY'), marker);
}
async function rm(r) {
  if (path.dirname(path.resolve(r)) !== parent) throw Error('unsafe cleanup');
  await fs.rm(r, { recursive: true, force: true });
}

// H1-H3: hard-link attribution across mutants (config and marker).
for (const name of ['studio.json', 'SYNTHETIC_FIXTURE_ONLY']) {
  const r = await root();
  const o = await root();
  const raw = Buffer.from(JSON.stringify(cfg()));
  await populate(r, raw);
  const orig = path.join(o, 'outside');
  await fs.writeFile(orig, name === 'studio.json' ? raw : marker);
  await fs.unlink(path.join(r, name));
  await fs.link(orig, path.join(r, name));
  const st = await fs.lstat(path.join(r, name), { bigint: true });
  out[`hardlink_${name}`] = {
    nlink: String(st.nlink),
    exact: await outcome(() => exact.readFixtureConfig(r, digest(raw))),
    no_preopen_nlink: await outcome(() => noPre.readFixtureConfig(r, digest(raw))),
    no_nlink_at_all: await outcome(() => noNlink.readFixtureConfig(r, digest(raw))),
  };
  await rm(r);
  await rm(o);
}

// R1-R3: with the lstat symlink guard removed, does the ReparsePoint attribute query refuse?
{
  const r = await root();
  const raw = Buffer.from(JSON.stringify(cfg()));
  await populate(r, raw);
  const j = r + '-junction';
  await fs.symlink(r, j, 'junction');
  out.junction_root = {
    lstat_is_symlink: (await fs.lstat(j)).isSymbolicLink(),
    exact: await outcome(() => exact.readFixtureConfig(j, digest(raw))),
    attribute_query_only: await outcome(() => noLstat.readFixtureConfig(j, digest(raw))),
  };
  await fs.unlink(j);
  for (const name of ['studio.json', 'SYNTHETIC_FIXTURE_ONLY']) {
    const r2 = await root();
    await populate(r2, raw);
    await fs.rename(path.join(r2, name), path.join(r2, 'original'));
    await fs.symlink(path.join(r2, 'original'), path.join(r2, name), 'file');
    out[`file_symlink_${name}`] = {
      exact: await outcome(() => exact.readFixtureConfig(r2, digest(raw))),
      attribute_query_only: await outcome(() => noLstat.readFixtureConfig(r2, digest(raw))),
    };
    await rm(r2);
  }
  // positive control for the mutant
  out.positive_control_attribute_only = await outcome(() =>
    noLstat.readFixtureConfig(r, digest(raw)),
  );
  out.positive_control_exact = await outcome(() => exact.readFixtureConfig(r, digest(raw)));
  const st = await fs.lstat(path.join(r, 'studio.json'), { bigint: true });
  out.windows_identity_nonzero = { ino: st.ino > 0n, dev: st.dev > 0n, ctimeNs: st.ctimeNs > 0n };
  await rm(r);
}

// P1: the fixed PowerShell command on edge-case stdin paths (scratch only).
{
  const src = await fs.readFile(path.join(tree, 'scripts', 'reader.mjs'), 'utf8');
  const command = src.match(/const command =\s*"([^"]+)";/)[1];
  const ps = path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const run = (paths) => {
    const t0 = Date.now();
    const r = spawnSync(ps, ['-NoProfile', '-NonInteractive', '-Command', command], {
      input: JSON.stringify(paths), encoding: 'utf8', windowsHide: true, timeout: 5000, maxBuffer: 1024,
    });
    return { status: r.status, stdout: r.stdout, error: r.error?.code ?? null, ms: Date.now() - t0 };
  };
  const plain = path.join(parent, 'theme-config-reader-v2-pstest');
  const uni = path.join(parent, 'pstest-\u00e9\u4e2d');
  const odd = path.join(parent, "pstest-'$(Write-Output x)[a]");
  for (const d of [plain, uni, odd]) await fs.mkdir(d, { recursive: true });
  const jn = plain + '-j';
  await fs.symlink(plain, jn, 'junction');
  out.powershell = {
    plain: run([plain]),
    junction: run([jn]),
    missing: run([path.join(parent, 'does-not-exist')]),
    non_ascii_existing: run([uni]),
    metacharacters_existing: run([odd]),
    empty_array: run([]),
  };
  await fs.unlink(jn);
  for (const d of [plain, uni, odd]) await fs.rm(d, { recursive: true, force: true });
  // SystemRoot pointing at a nonexistent directory: environment selects the executable.
  const r = await root();
  const raw = Buffer.from(JSON.stringify(cfg()));
  await populate(r, raw);
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import(${JSON.stringify(pathToFileURL(path.join(tree, 'scripts', 'reader.mjs')).href)}).then(m=>m.readFixtureConfig(${JSON.stringify(r)},${JSON.stringify(digest(raw))})).then(x=>console.log(x.status),e=>console.log('refused:'+e.message))`],
    { encoding: 'utf8', env: { ...process.env, SystemRoot: path.join(tree, 'no-such-root') } });
  out.systemroot_override_nonexistent = child.stdout.trim();
  await rm(r);
}

// G: pg_bin and parse cases not covered by the author's tests.
{
  const p = (o) => {
    const raw = Buffer.isBuffer(o) ? o : Buffer.from(typeof o === 'string' ? o : JSON.stringify(o));
    try { return exact.projectConfig(raw, digest(raw)).status; } catch (e) { return `refused`; }
  };
  out.pg_bin = Object.fromEntries(
    ['C:/NUL/bin', 'C:/x/CON', 'C:/x/com1.txt', 'C:\\a/b\\c', 'C:/%TEMP%/bin', 'C:/ bin', 'C:/PROGRA~1/bin', 'c:/x', 'C:/x\\'].map((b) => [b, p(cfg({ pg_bin: b }))]),
  );
  out.parse = {
    native_valid_null_pg_bin: p(cfg({ pg_bin: null })),
    missing_products_root: p({ format: 'creator-desktop-config/1', database: { mode: 'managed', port: 55455 }, pg_bin: 'C:/b' }),
    duplicate_port: p('{"format":"creator-desktop-config/1","database":{"mode":"managed","port":1,"port":55455},"pg_bin":"C:/b"}'),
    exponent_port: p('{"format":"creator-desktop-config/1","database":{"mode":"managed","port":5.5455e4},"pg_bin":"C:/b"}'),
    bom: p(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from(JSON.stringify(cfg()))])),
    uppercase_hash: (() => { const raw = Buffer.from(JSON.stringify(cfg())); try { return exact.projectConfig(raw, digest(raw).toUpperCase()).status; } catch { return 'refused'; } })(),
  };
  try { exact.projectConfig(Buffer.from('{SENTINEL'), digest(Buffer.from('{SENTINEL'))); } catch (e) {
    out.error_shape = { message: e.message, cause: e.cause ?? null, own_keys: Object.keys(e), sentinel_in_stack: /SENTINEL/.test(e.stack) };
  }
}
const left = (await fs.readdir(parent)).length;
out.scratch_fixtures_left = left;
console.log(JSON.stringify(out, null, 2));
