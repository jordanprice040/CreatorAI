// Fixture-only preparation. No operational entry point or automatic configuration discovery.
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const fixtureParent = fileURLToPath(
  new URL('../.verification/', import.meta.url),
);
const limit = 32768;
const digest = (bytes) =>
  crypto.createHash('sha256').update(bytes).digest('hex');
const invalid = () => {
  throw new Error('CONFIG_READER_REFUSED');
};
function keys(value, allowed) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !allowed.includes(key))
  )
    invalid();
}
export function projectConfig(bytes, expectedHash) {
  if (
    !Buffer.isBuffer(bytes) ||
    bytes.length > limit ||
    !/^[a-f0-9]{64}$/.test(expectedHash)
  )
    invalid();
  if (digest(bytes) !== expectedHash)
    return { fixture: true, status: 'blocked', config_hash_matches: false };
  let config;
  try {
    config = JSON.parse(bytes.toString('utf8'));
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
  const bin = config.pg_bin;
  if (
    config.format !== 'creator-desktop-config/1' ||
    mode !== 'managed' ||
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    typeof bin !== 'string' ||
    bin.length > 512 ||
    !/^[A-Za-z]:[\\/]/.test(bin) ||
    /[\x00-\x1f]/.test(bin) ||
    bin.split(/[\\/]/).some((part) => part === '..' || part === '.')
  )
    invalid();
  return {
    fixture: true,
    status: 'projected_not_operationally_verified',
    database: { mode, port },
    pg_bin: bin,
    config_hash_matches: true,
  };
}
async function noLinks(target) {
  for (let current = target; ; current = path.dirname(current)) {
    const st = await fs.lstat(current);
    if (st.isSymbolicLink()) invalid();
    if (path.dirname(current) === current) break;
  }
}
export async function readFixtureConfig(root, expectedHash) {
  // Only direct synthetic fixture directories are accepted; no saved studio path.
  const resolved = path.resolve(root);
  if (
    path.dirname(resolved) !== path.resolve(fixtureParent) ||
    !/^theme-config-reader-[a-zA-Z0-9_-]+$/.test(path.basename(resolved))
  )
    invalid();
  try {
    await noLinks(resolved);
    const marker = path.join(resolved, 'SYNTHETIC_FIXTURE_ONLY');
    await noLinks(marker);
    if (
      (await fs.readFile(marker, 'utf8')) !== 'theme-config-reader-fixture/1\n'
    )
      invalid();
    const target = path.join(resolved, 'studio.json');
    await noLinks(target);
    const before = await fs.lstat(target);
    if (!before.isFile() || before.size > limit) invalid();
    const file = await fs.open(target, 'r');
    try {
      const opened = await file.stat();
      if (
        !opened.isFile() ||
        opened.dev !== before.dev ||
        opened.ino !== before.ino
      )
        invalid();
      const bytes = Buffer.alloc(limit + 1);
      const { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
      await noLinks(target);
      const after = await fs.lstat(target);
      const final = await file.stat();
      if (
        after.ino !== opened.ino ||
        after.dev !== opened.dev ||
        final.size !== opened.size ||
        final.mtimeMs !== opened.mtimeMs ||
        bytesRead !== final.size
      )
        invalid();
      return projectConfig(bytes.subarray(0, bytesRead), expectedHash);
    } finally {
      await file.close();
    }
  } catch {
    invalid();
  }
}
if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  process.stderr.write(
    'Fixture-only library; no operational CLI is implemented.\n',
  );
  process.exitCode = 2;
}
