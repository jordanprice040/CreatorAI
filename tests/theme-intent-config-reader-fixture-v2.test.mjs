import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  projectConfig,
  readFixtureConfig,
  sameFileSnapshot,
} from '../scripts/theme-intent-config-reader-fixture-v2.mjs';
const parent = fileURLToPath(new URL('../.verification/', import.meta.url));
const digest = (b) => crypto.createHash('sha256').update(b).digest('hex');
const config = () => ({
  format: 'creator-desktop-config/1',
  database: {
    mode: 'managed',
    port: 55455,
    name: 'SENTINEL_PRIVATE_NAME',
    user: 'SENTINEL_PRIVATE_USER',
    label: 'SENTINEL_LABEL',
  },
  pg_bin: 'C:/fixture/PostgreSQL/18/bin',
  origin: { private: 'SENTINEL_ORIGIN' },
  products_root: 'SENTINEL_PRODUCTS',
  close_behavior: 'background',
  launch_at_login: false,
  created_at: 'synthetic',
});
const bytes = (v) => Buffer.from(JSON.stringify(v));
async function removeFixture(root) {
  const resolved = path.resolve(root);
  assert.equal(path.dirname(resolved), path.resolve(parent));
  assert.match(
    path.basename(resolved),
    /^theme-config-reader-v2-[a-zA-Z0-9_-]+$/,
  );
  await fs.rm(resolved, { recursive: true, force: true });
}
test('projection exposes only approved fields; mismatch exposes no values', () => {
  const raw = bytes(config());
  const result = projectConfig(raw, digest(raw));
  assert.deepEqual(result, {
    fixture: true,
    status: 'projected_not_operationally_verified',
    database: { mode: 'managed', port: 55455 },
    pg_bin: 'C:/fixture/PostgreSQL/18/bin',
    config_hash_matches: true,
  });
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL/);
  assert.deepEqual(projectConfig(raw, '0'.repeat(64)), {
    fixture: true,
    status: 'blocked',
    config_hash_matches: false,
  });
});
test('malformed, unsupported, unsafe and unexpected values refuse with redacted errors', () => {
  const cases = [Buffer.from('{SENTINEL'), Buffer.alloc(32769)];
  for (const alter of [
    (c) => (c.database.port = 1),
    (c) => (c.database.port = 65536),
    (c) => (c.database.port = '55455'),
    (c) => (c.database.mode = 'external'),
    (c) => (c.pg_bin = 'relative'),
    (c) => (c.pg_bin = 'C:/x/../bin'),
    (c) => (c.secret = 'SENTINEL'),
    (c) => (c.database.password = 'SENTINEL'),
    (c) => (c.format = 'wrong'),
  ]) {
    const c = config();
    alter(c);
    cases.push(bytes(c));
  }
  for (const raw of cases)
    assert.throws(
      () => projectConfig(raw, digest(raw)),
      /^Error: CONFIG_READER_REFUSED$/,
    );
});
test('only disposable fixture root can be read, file bytes unchanged', async () => {
  await fs.mkdir(parent, { recursive: true });
  const root = await fs.mkdtemp(path.join(parent, 'theme-config-reader-v2-'));
  try {
    await fs.writeFile(
      path.join(root, 'SYNTHETIC_FIXTURE_ONLY'),
      'theme-config-reader-fixture/2\n',
    );
    const raw = bytes(config());
    await fs.writeFile(path.join(root, 'studio.json'), raw);
    assert.equal(
      (await readFixtureConfig(root, digest(raw))).config_hash_matches,
      true,
    );
    assert.deepEqual(await fs.readFile(path.join(root, 'studio.json')), raw);
    await fs.unlink(path.join(root, 'SYNTHETIC_FIXTURE_ONLY'));
    await assert.rejects(
      readFixtureConfig(root, digest(raw)),
      /CONFIG_READER_REFUSED/,
    );
  } finally {
    await removeFixture(root);
  }
});
test('operational-looking and traversal roots rejected before reading', async () => {
  for (const root of [
    'C:/Users/jorda/AppData/Local/com.creatoragent.studio',
    path.join(parent, 'theme-config-reader-v2-fixture', '..', 'other'),
  ])
    await assert.rejects(
      readFixtureConfig(root, '0'.repeat(64)),
      /CONFIG_READER_REFUSED/,
    );
});
test('junction fixture root refused', async () => {
  await fs.mkdir(parent, { recursive: true });
  const target = await fs.mkdtemp(path.join(parent, 'theme-config-reader-v2-'));
  const link = target + '-link';
  try {
    await fs.symlink(target, link, 'junction');
    await assert.rejects(
      readFixtureConfig(link, '0'.repeat(64)),
      /CONFIG_READER_REFUSED/,
    );
  } finally {
    await fs.unlink(link).catch(() => {});
    await removeFixture(target);
  }
});
test('direct invocation has no operational command or echoed argument', () => {
  const result = spawnSync(
    process.execPath,
    ['scripts/theme-intent-config-reader-fixture-v2.mjs', 'SENTINEL_SECRET'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 2);
  assert.equal(result.stdout, '');
  assert.doesNotMatch(result.stderr, /SENTINEL/);
});

test('hard-linked config or marker is refused before projection', async () => {
  await fs.mkdir(parent, { recursive: true });
  for (const name of ['studio.json', 'SYNTHETIC_FIXTURE_ONLY']) {
    const root = await fs.mkdtemp(path.join(parent, 'theme-config-reader-v2-'));
    const outside = await fs.mkdtemp(
      path.join(parent, 'theme-config-reader-v2-'),
    );
    try {
      const raw = bytes(config());
      await fs.writeFile(path.join(root, 'studio.json'), raw);
      await fs.writeFile(
        path.join(root, 'SYNTHETIC_FIXTURE_ONLY'),
        'theme-config-reader-fixture/2\n',
      );
      const original = path.join(outside, 'outside-file');
      await fs.writeFile(
        original,
        name === 'studio.json' ? raw : 'theme-config-reader-fixture/2\n',
      );
      await fs.unlink(path.join(root, name));
      await fs.link(original, path.join(root, name));
      assert.equal(
        (await fs.lstat(path.join(root, name), { bigint: true })).nlink,
        2n,
      );
      await assert.rejects(
        readFixtureConfig(root, digest(raw)),
        /CONFIG_READER_REFUSED/,
      );
    } finally {
      await removeFixture(root);
      await removeFixture(outside);
    }
  }
});
test('file and marker symbolic links refused', async () => {
  await fs.mkdir(parent, { recursive: true });
  for (const name of ['studio.json', 'SYNTHETIC_FIXTURE_ONLY']) {
    const root = await fs.mkdtemp(path.join(parent, 'theme-config-reader-v2-'));
    try {
      const raw = bytes(config());
      await fs.writeFile(path.join(root, 'studio.json'), raw);
      await fs.writeFile(
        path.join(root, 'SYNTHETIC_FIXTURE_ONLY'),
        'theme-config-reader-fixture/2\n',
      );
      const original = path.join(root, 'original');
      await fs.rename(path.join(root, name), original);
      await fs.symlink(original, path.join(root, name), 'file');
      await assert.rejects(
        readFixtureConfig(root, digest(raw)),
        /CONFIG_READER_REFUSED/,
      );
    } finally {
      await removeFixture(root);
    }
  }
});
test('pg_bin display and Windows path tricks refused', () => {
  for (const bin of [
    'C:/bin\u202e',
    'C:/bin\u007f',
    'C:/bin ',
    'C:/bin.',
    'C:/bin:stream',
    'C://bin',
    'C:/bin/',
    'C:/a//bin',
    'C:/a/../bin',
    'C:/a/./bin',
  ]) {
    const c = config();
    c.pg_bin = bin;
    const raw = bytes(c);
    assert.throws(
      () => projectConfig(raw, digest(raw)),
      /CONFIG_READER_REFUSED/,
    );
  }
});
test('snapshot checks detect hard-link growth, exact bigint identity and changed size/time', () => {
  const base = {
    isFile: () => true,
    nlink: 1n,
    ino: 9007199254740993n,
    dev: 1n,
    size: 12n,
    mtimeNs: 11n,
    ctimeNs: 22n,
  };
  assert.equal(sameFileSnapshot(base, base, base, base, 12), true);
  for (const change of [
    { nlink: 2n },
    { ino: 9007199254740992n },
    { size: 13n },
    { mtimeNs: 12n },
    { ctimeNs: 23n },
    { isFile: () => false },
  ])
    for (const index of [1, 2, 3]) {
      const args = [base, base, base, base, 12];
      args[index] = { ...base, ...change };
      assert.equal(sameFileSnapshot(...args), false);
    }
  assert.equal(sameFileSnapshot(base, base, base, base, 11), false);
});
test('invalid UTF8 refused even in unprojected fields', () => {
  const raw = Buffer.concat([
    Buffer.from('{"label":"'),
    Buffer.from([0xff]),
    Buffer.from('"}'),
  ]);
  assert.throws(() => projectConfig(raw, digest(raw)), /CONFIG_READER_REFUSED/);
});

test('documented exact desktop key input vectors distinguish slash spellings', () => {
  const key = (root) =>
    crypto
      .createHash('sha256')
      .update(root.toLowerCase(), 'utf8')
      .digest('hex')
      .slice(0, 16);
  const local = 'C:\\Users\\jorda\\AppData\\Local';
  const joined = local + '\\com.creatoragent.studio';
  assert.equal(key(joined), 'd8c7860557013e56');
  assert.equal(key(local + '\\' + 'com.creatoragent.studio'), key(joined));
  assert.equal(
    key('C:/Users/jorda/AppData/Local/com.creatoragent.studio'),
    '93553bda48f70dd2',
  );
  assert.notEqual(key(joined), key(joined.replaceAll('\\', '/')));
});
