// Fixture-only v2: importing or directly invoking this module never reads a saved studio.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const fixtureParent = fileURLToPath(
  new URL('../.verification/', import.meta.url),
);
const limit = 32768;
const invalid = () => {
  throw new Error('CONFIG_READER_REFUSED');
};
const digest = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid();
}
export function validBin(bin) {
  if (
    typeof bin !== 'string' ||
    bin.length > 512 ||
    !/^[A-Za-z]:[\\/]/.test(bin) ||
    /[^\x20-\x7e]/.test(bin) ||
    /[:<>"|?*]/.test(bin.slice(2))
  )
    return false;
  return bin
    .slice(3)
    .split(/[\\/]/)
    .every(
      (part) =>
        part.length > 0 && part !== '.' && part !== '..' && !/[ .]$/.test(part),
    );
}
// Projection is meaningful only when expectedHash identifies a natively accepted file.
// This function does not establish that provenance or inherit any caller's path confinement.
export function projectConfig(bytes, expectedHash) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > limit ||
    typeof expectedHash !== 'string' ||
    !/^[a-f0-9]{64}$/.test(expectedHash)
  )
    invalid();
  if (digest(bytes) !== expectedHash)
    return { fixture: true, status: 'blocked', config_hash_matches: false };
  let config;
  try {
    config = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(bytes),
    );
  } catch {
    invalid();
  }
  keys(config, [
    'format',
    'database',
    'pg_bin',
    'products_root',
    'close_behavior',
    'launch_at_login',
    'origin',
    'created_at',
  ]);
  keys(config.database, ['mode', 'port', 'name', 'user', 'label']);
  const { mode, port } = config.database;
  if (
    config.format !== 'creator-desktop-config/1' ||
    mode !== 'managed' ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    !validBin(config.pg_bin)
  )
    invalid();
  return {
    fixture: true,
    status: 'projected_not_operationally_verified',
    database: { mode, port },
    pg_bin: config.pg_bin,
    config_hash_matches: true,
  };
}
async function noReparse(target) {
  const ancestors = [];
  for (let current = target; ; current = path.dirname(current)) {
    const st = await fs.lstat(current, { bigint: true });
    if (st.isSymbolicLink()) invalid();
    ancestors.push(current);
    if (path.dirname(current) === current) break;
  }
  if (process.platform === 'win32') {
    // FileAttributes.ReparsePoint covers tags that Node's isSymbolicLink does not.
    // Only the already confined fixture path ancestry is supplied; no command interpolation.
    const command =
      "$ErrorActionPreference='Stop'; try { $paths=ConvertFrom-Json ([Console]::In.ReadToEnd()); foreach($p in $paths) { if (([IO.File]::GetAttributes($p) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { exit 3 } }; [Console]::Out.Write('clear') } catch { exit 4 }";
    const result = spawnSync(
      path.join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      ['-NoProfile', '-NonInteractive', '-Command', command],
      {
        input: JSON.stringify(ancestors),
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
        maxBuffer: 1024,
      },
    );
    if (result.error || result.status !== 0 || result.stdout !== 'clear')
      invalid();
  }
}
export function sameFileSnapshot(before, opened, after, final, bytesRead) {
  return (
    [before, opened, after, final].every(
      (st) =>
        st.isFile() &&
        st.nlink === 1n &&
        st.ino === before.ino &&
        st.dev === before.dev &&
        st.size === before.size &&
        st.mtimeNs === before.mtimeNs &&
        st.ctimeNs === before.ctimeNs,
    ) && BigInt(bytesRead) === final.size
  );
}
async function readSingleFile(target, maximum) {
  await noReparse(target);
  const before = await fs.lstat(target, { bigint: true });
  if (!before.isFile() || before.nlink !== 1n || before.size > BigInt(maximum))
    invalid();
  const file = await fs.open(target, 'r');
  try {
    const opened = await file.stat({ bigint: true });
    if (
      !opened.isFile() ||
      opened.nlink !== 1n ||
      opened.ino !== before.ino ||
      opened.dev !== before.dev ||
      opened.size > BigInt(maximum)
    )
      invalid();
    const bytes = Buffer.alloc(maximum + 1);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    await noReparse(target);
    const after = await fs.lstat(target, { bigint: true });
    const final = await file.stat({ bigint: true });
    if (!sameFileSnapshot(before, opened, after, final, bytesRead)) invalid();
    return bytes.subarray(0, bytesRead);
  } finally {
    await file.close();
  }
}
export async function readFixtureConfig(root, expectedHash) {
  if (typeof root !== 'string') invalid();
  const resolved = path.resolve(root);
  if (
    path.dirname(resolved) !== path.resolve(fixtureParent) ||
    !/^theme-config-reader-v2-[a-zA-Z0-9_-]+$/.test(path.basename(resolved))
  )
    invalid();
  try {
    await noReparse(resolved);
    const marker = await readSingleFile(
      path.join(resolved, 'SYNTHETIC_FIXTURE_ONLY'),
      64,
    );
    if (marker.toString('utf8') !== 'theme-config-reader-fixture/2\n')
      invalid();
    return projectConfig(
      await readSingleFile(path.join(resolved, 'studio.json'), limit),
      expectedHash,
    );
  } catch {
    invalid();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stderr.write(
    'Fixture-only v2 library; no operational CLI is implemented.\n',
  );
  process.exitCode = 2;
}
