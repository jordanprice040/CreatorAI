// ADR-0135: the PostgreSQL 18 runtime a tester installer includes. Copies only what the studio
// runs (bin, lib, share), adds the Microsoft Visual C++ runtime the EDB binaries need (they do
// not carry it, and a computer without it cannot start the database) and the licence notices,
// and refuses any DLL in bin that the notices do not cover.
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const NOTICES = join(
  dirname(fileURLToPath(import.meta.url)),
  'postgres-notices',
  'THIRD_PARTY_NOTICES.txt',
);
export const VC_RUNTIME = [
  'vcruntime140.dll',
  'vcruntime140_1.dll',
  'msvcp140.dll',
];
const TOOLS = ['postgres', 'initdb', 'pg_ctl', 'pg_dump', 'pg_restore'];

// Left out: StackBuilder and its wxWidgets libraries (bin), and EDB-only modules the studio never
// loads (lib). Matched case-insensitively against the file name.
const SKIP = {
  bin: [/^stackbuilder\.exe$/i, /^wx.*\.dll$/i, /\.lib$/i],
  lib: [/^plugin_debugger\.dll$/i, /^system_stats\.dll$/i, /^uuid-ossp\.dll$/i],
};
// Every DLL left in bin must be one THIRD_PARTY_NOTICES.txt covers.
const COVERED = [
  /^libpq\.dll$/i,
  /^libecpg(_compat)?\.dll$/i,
  /^libpgtypes\.dll$/i,
  /^testplug\.dll$/i,
  /^libcrypto-3-x64\.dll$/i,
  /^libssl-3-x64\.dll$/i,
  /^icu(dt|in|io|tu|uc)\d+\.dll$/i,
  /^libxml2\.dll$/i,
  /^libxslt\.dll$/i,
  /^zlib1\.dll$/i,
  /^liblz4\.dll$/i,
  /^libzstd\.dll$/i,
  /^libcurl\.dll$/i,
  /^libwinpthread-1\.dll$/i,
  /^libintl-9\.dll$/i,
  /^libiconv-2\.dll$/i,
  /^vcruntime140(_1)?\.dll$/i,
  /^msvcp140\.dll$/i,
];

export const skipped = (part, name) =>
  (SKIP[part] ?? []).some((re) => re.test(name));

/** Names of bin DLLs that would ship without a notice (an empty list passes). */
export function uncoveredDlls(names) {
  return names.filter(
    (n) => /\.dll$/i.test(n) && !COVERED.some((re) => re.test(n)),
  );
}

/**
 * The folder holding all three Visual C++ runtime DLLs: `explicit` (--vcruntime) when given,
 * else the PostgreSQL bin, else the newest Visual Studio redistributable folder
 * (`VC\Redist\MSVC\<version>\x64\Microsoft.VC14*.CRT`). Throws when none has all three.
 */
export function findVcRuntime({ explicit, pgBin, env = process.env }) {
  const has = (d) => VC_RUNTIME.every((f) => existsSync(join(d, f)));
  if (explicit) {
    if (!has(explicit))
      throw new Error(
        `${explicit} must hold ${VC_RUNTIME.join(', ')} (the x64 Visual C++ runtime)`,
      );
    return explicit;
  }
  if (has(pgBin)) return pgBin;
  const candidates = [];
  for (const base of [env['ProgramFiles'], env['ProgramFiles(x86)']].filter(
    Boolean,
  )) {
    const vs = join(base, 'Microsoft Visual Studio');
    for (const year of list(vs))
      for (const edition of list(join(vs, year))) {
        const msvc = join(vs, year, edition, 'VC', 'Redist', 'MSVC');
        for (const ver of list(msvc))
          for (const crt of list(join(msvc, ver, 'x64')))
            if (/^Microsoft\.VC14\d\.CRT$/.test(crt))
              candidates.push(join(msvc, ver, 'x64', crt));
      }
  }
  const found = candidates.filter(has).sort(byVersion).at(-1);
  if (!found)
    throw new Error(
      `The Visual C++ runtime (${VC_RUNTIME.join(', ')}) was not found in the PostgreSQL bin or a Visual Studio redistributable folder. Install the Visual Studio Build Tools (MSVC) or pass --vcruntime <folder holding the x64 files>.`,
    );
  return found;
}

const list = (dir) => {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
};
// Sorts redistributable folders by their MSVC version (the folder above x64).
const byVersion = (a, b) => {
  const v = (p) =>
    basename(dirname(dirname(p)))
      .split('.')
      .map((n) => Number(n) || 0);
  const [x, y] = [v(a), v(b)];
  for (let i = 0; i < Math.max(x.length, y.length); i++)
    if ((x[i] ?? 0) !== (y[i] ?? 0)) return (x[i] ?? 0) - (y[i] ?? 0);
  return 0;
};

/** Refuses a folder that is not a PostgreSQL 18 runtime; returns its version. */
export function checkPostgres(dir, platform = process.platform) {
  for (const part of ['bin', 'lib', 'share'])
    if (!existsSync(join(dir, part)))
      throw new Error(
        `${dir} has no ${part} folder; pass the folder that holds bin, lib and share`,
      );
  for (const tool of TOOLS)
    if (!existsSync(join(dir, 'bin', `${tool}.exe`)))
      throw new Error(`${tool}.exe is missing from ${join(dir, 'bin')}`);
  if (!existsSync(NOTICES)) throw new Error(`${NOTICES} is missing`);
  if (platform !== 'win32') return 'unchecked';
  const text = execFileSync(join(dir, 'bin', 'postgres.exe'), ['--version'], {
    encoding: 'utf8',
  }).trim();
  const version = text.replace(/^postgres \(PostgreSQL\) /, '');
  if (version === text || version.split('.')[0] !== '18')
    throw new Error(`PostgreSQL 18 is required; ${dir} reports "${text}"`);
  return version;
}

/** Copies the runtime into `dest` and returns what it added. */
export function stagePostgres(src, dest, vcDir) {
  mkdirSync(dest, { recursive: true });
  for (const part of ['bin', 'lib', 'share'])
    cpSync(join(src, part), join(dest, part), {
      recursive: true,
      filter: (from) =>
        dirname(from) !== join(src, part) || !skipped(part, basename(from)),
    });
  for (const f of VC_RUNTIME)
    if (!existsSync(join(dest, 'bin', f)))
      copyFileSync(join(vcDir, f), join(dest, 'bin', f));
  copyFileSync(NOTICES, join(dest, 'THIRD_PARTY_NOTICES.txt'));
  const bad = uncoveredDlls(readdirSync(join(dest, 'bin')));
  if (bad.length)
    throw new Error(
      `No licence notice covers ${bad.join(', ')}. Add the component to apps/desktop/postgres-notices/THIRD_PARTY_NOTICES.txt and to COVERED in postgres-bundle.mjs, or leave it out.`,
    );
  return { vcDir };
}
