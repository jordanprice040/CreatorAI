import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { writeTar } from '../../packages/executor/dist/tar.js';
import {
  importArtifact,
  inspectArtifact,
  verifyArtifact,
} from './artifacts.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
function fixture() {
  const id = randomUUID();
  const h = 'a'.repeat(64);
  const content = Buffer.from(
    'Synthetic source only; not execution evidence.\n',
  );
  const archive = writeTar([{ path: 'readme.md', content }]);
  const available = { state: 'available', reason: 'Synthetic test' };
  const unavailable = { state: 'unavailable', reason: 'Not a runnable test' };
  const manifest = {
    format: 'build-manifest/1',
    id,
    created_at: new Date().toISOString(),
    state: 'blocked',
    workspace_id: randomUUID(),
    product_id: randomUUID(),
    owner_id: randomUUID(),
    spec: { id, version: 1, hash: h, freeze_id: id },
    task: { id, key: 'T1', hash: h },
    build: {
      id,
      plan_hash: h,
      prompt_hash: h,
      calls: 0,
      repairs: 0,
      fixture_roles: true,
    },
    repository: {
      commit: 'a'.repeat(40),
      base_commit: 'b'.repeat(40),
      initial_commit: 'c'.repeat(40),
      git_version: 'test',
    },
    template: { id: 'checklist/1', hash: h },
    toolchain: {
      recipe: 'python-build/1',
      recipe_hash: h,
      policy_hash: h,
      bridge_hash: h,
      backend: 'test-double',
      python: null,
      supervisor_node: process.version,
    },
    dependencies: {
      kind: 'python-stdlib-only',
      lockfile: null,
      note: 'Synthetic fixture',
    },
    package: {
      kind: 'source_archive',
      file: 'source.tar',
      media_type: 'application/x-tar',
      sha256: hash(archive),
      bytes: archive.length,
      input_hash: h,
      files: [
        { path: 'readme.md', sha256: hash(content), bytes: content.length },
      ],
    },
    availability: {
      source_archive: available,
      runnable_demo: unavailable,
      native_installer: unavailable,
    },
    startup: {
      runtime: 'none',
      command: ['none'],
      network: 'none',
      requirements: [],
      readiness_case: 'A1',
    },
    tests: {
      cases: [
        { check_key: 'A1', args: [], stdin: '', stdout: '', exit_code: 0 },
      ],
      build_qa: [],
      package: [],
    },
    costs: {
      broker_calls: 0,
      settled_nano_usd: '0',
      unsettled_attempts: 0,
      local_compute: 'not_metered_by_studio',
    },
    lineage: { previous: null, feedback_ids: [] },
    limitations: ['Synthetic bytes; no independent review or execution.'],
  };
  const bytes = Buffer.from(JSON.stringify(manifest));
  return {
    manifest,
    bytes,
    archive,
    expected: {
      workspace_id: manifest.workspace_id,
      artifact_id: id,
      manifest_sha256: hash(bytes),
    },
  };
}

test('exact catalog identity binds source bytes; verification does not promote blocked fixtures', () => {
  const f = fixture();
  assert.equal(verifyArtifact(f.bytes, f.archive, f.expected).state, 'blocked');
  assert.throws(
    () =>
      verifyArtifact(f.bytes, f.archive, {
        ...f.expected,
        workspace_id: randomUUID(),
      }),
    /scope/,
  );
  assert.throws(
    () =>
      verifyArtifact(f.bytes, f.archive, {
        ...f.expected,
        artifact_id: randomUUID(),
      }),
    /scope/,
  );
  assert.throws(
    () =>
      verifyArtifact(
        Buffer.concat([f.bytes, Buffer.from(' ')]),
        f.archive,
        f.expected,
      ),
    /Manifest hash/,
  );
  const corrupt = Buffer.from(f.archive);
  corrupt[520] ^= 1;
  assert.throws(
    () => verifyArtifact(f.bytes, corrupt, f.expected),
    /Archive hash/,
  );
  f.manifest.package.files[0].sha256 = '0'.repeat(64);
  const bytes = Buffer.from(JSON.stringify(f.manifest));
  assert.throws(
    () =>
      verifyArtifact(bytes, f.archive, {
        ...f.expected,
        manifest_sha256: hash(bytes),
      }),
    /inventory/,
  );
});

test('Windows paths with spaces, concurrent imports, re-read tamper detection and junction rejection', async (t) => {
  const base = resolve('.verification');
  await mkdir(base, { recursive: true });
  const dir = await mkdtemp(join(base, 'desktop spaces '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture();
  const manifestPath = join(dir, 'manifest.json');
  const archivePath = join(dir, 'source.tar');
  await writeFile(manifestPath, f.bytes);
  await writeFile(archivePath, f.archive);
  const options = {
    root: join(dir, 'cache with spaces'),
    manifestPath,
    archivePath,
    expected: f.expected,
  };
  const [a, b] = await Promise.all([
    importArtifact(options),
    importArtifact(options),
  ]);
  assert.notEqual(a.directory, b.directory);
  assert.equal(
    (await inspectArtifact(a.directory, f.expected)).offline,
    'read_only_snapshot',
  );
  assert.deepEqual(await readFile(join(a.directory, 'source.tar')), f.archive);
  const receipt = JSON.parse(
    await readFile(join(a.directory, 'receipt.json'), 'utf8'),
  );
  assert.ok(Number.isFinite(Date.parse(receipt.cached_at)));
  assert.equal(receipt.authorization, 'online_revalidation_required');
  const identityPath = join(dir, 'expected.json');
  await writeFile(identityPath, JSON.stringify(f.expected));
  const inspected = JSON.parse(
    execFileSync(
      process.execPath,
      ['apps/desktop/artifacts.mjs', 'inspect', b.directory, identityPath],
      { encoding: 'utf8' },
    ),
  );
  assert.equal(inspected.manifest.id, f.expected.artifact_id);
  assert.equal(inspected.cached_at, b.receipt.cached_at);
  await writeFile(
    join(b.directory, 'receipt.json'),
    JSON.stringify({ ...receipt, workspace_id: randomUUID() }),
  );
  await assert.rejects(
    inspectArtifact(b.directory, f.expected),
    /receipt mismatch/,
  );
  await writeFile(join(a.directory, 'source.tar'), 'tampered');
  await assert.rejects(
    inspectArtifact(a.directory, f.expected),
    /Archive hash/,
  );
  const link = join(dir, 'linked cache');
  await symlink(
    options.root,
    link,
    process.platform === 'win32' ? 'junction' : 'dir',
  );
  await assert.rejects(
    importArtifact({ ...options, root: link }),
    /Linked|Noncanonical/,
  );
  await assert.rejects(
    importArtifact({ ...options, manifestPath: join(link, 'missing.json') }),
    /Linked|Noncanonical/,
  );
});

test('oversized input is refused before cache creation', async (t) => {
  const dir = await mkdtemp(join(resolve('.verification'), 'desktop bounds '));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture();
  const path = join(dir, 'large.json');
  await writeFile(path, Buffer.alloc(256 * 1024 + 1));
  await assert.rejects(
    importArtifact({
      root: join(dir, 'cache'),
      manifestPath: path,
      archivePath: path,
      expected: f.expected,
    }),
    /bounded/,
  );
  await assert.rejects(readFile(join(dir, 'cache', 'receipt.json')), /ENOENT/);
});
