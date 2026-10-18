import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ArtifactSupervisor,
  BuildSupervisor,
  ExecutionSupervisor,
  ProductSupervisor,
  digest,
  readTar,
  writeTar,
  type Binding,
  type BuildPlan,
  type BuildPorts,
} from '@creator/executor';
import {
  BUILD_FIXTURE_CASES,
  BUILD_FIXTURE_SOURCE,
  BUILD_FIXTURE_SPEC,
  buildFixtureAnswer,
  taskHashes,
} from '@creator/domain';
import type { BrokerCallResult, SpecBody } from '@creator/contracts';
import { TestDoubleExecutor } from './artifact-double.js';

test('source archives are deterministic and the reader refuses anything it did not write', () => {
  const files = [
    { path: 'readme.md', content: Buffer.from('# x\n') },
    {
      path: `src/${'a'.repeat(90)}/${'b'.repeat(60)}.py`,
      content: Buffer.from('print(1)\n'),
    },
  ];
  const a = writeTar(files);
  assert.deepEqual(a, writeTar(files));
  assert.deepEqual(
    readTar(a).map((f) => [f.path, f.content.toString()]),
    files.map((f) => [f.path, f.content.toString()]),
  );
  // A header byte change breaks its checksum.
  const header = Buffer.from(a);
  header[0] = 'x'.charCodeAt(0);
  assert.throws(() => readTar(header), /checksum/);
  assert.throws(
    () => readTar(a.subarray(0, a.length - 512)),
    /trailer|Truncated/,
  );
  assert.throws(
    () => writeTar([{ path: '../escape', content: Buffer.from('') }]),
    /Invalid|contract/i,
  );
  const traversal = writeTar([{ path: 'abc', content: Buffer.from('x') }]);
  traversal.write('../a', 0);
  // Re-sign the forged header so only the path rule can reject it.
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : traversal[i]!;
  traversal.write(sum.toString(8).padStart(6, '0') + '\0 ', 148);
  assert.throws(() => readTar(traversal), /path refused/);
  const link = writeTar([{ path: 'abc', content: Buffer.from('x') }]);
  link[156] = 0x32;
  assert.throws(() => readTar(link), /checksum|regular/);
  const dup = writeTar([
    { path: 'abc', content: Buffer.from('x') },
    { path: 'abc', content: Buffer.from('y') },
  ]);
  assert.throws(() => readTar(dup), /Duplicate/);
});

/** A verified fixture build using the test double; returns everything a package needs. */
export async function verifiedBuild(t: test.TestContext) {
  const parent = resolve('.verification/artifact-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(root.startsWith(parent));
    await rm(root, { recursive: true, force: true });
  });
  const spec: SpecBody = {
    ...structuredClone(BUILD_FIXTURE_SPEC),
    format: 'spec/1',
    alternative: { id: randomUUID(), version: 1 },
    selection_id: randomUUID(),
  };
  const binding: Binding = {
    workspace_id: randomUUID(),
    owner_id: randomUUID(),
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: digest('spec'),
    freeze_id: randomUUID(),
    tasks: [{ key: 'T1', hash: taskHashes(spec).T1!, file_scope: ['src'] }],
  };
  const products = new ProductSupervisor(join(root, 'products'));
  const double = new TestDoubleExecutor(products);
  const product = await products.create(binding);
  const task = await products.createTask(
    product.id,
    'T1',
    product.initial_commit,
    binding,
  );
  const plan: BuildPlan = {
    format: 'build-plan/1',
    run_id: randomUUID(),
    envelope_id: randomUUID(),
    pricing_snapshot_id: randomUUID(),
    humility_review: { id: randomUUID(), version: 1 },
    data_class: 'synthetic',
    max_repairs: 0,
    max_calls: 2,
    timeout_ms: 10000,
    max_output_tokens: 3000,
    deadline: new Date(Date.now() + 300000).toISOString(),
    cases: structuredClone(BUILD_FIXTURE_CASES),
  };
  const ports: BuildPorts = {
    current: async () => ({ binding, spec }),
    assertActive: async () => {},
    authorize: async () => ({ verdict: 'allow', fixture: true }),
    call: async (_run, r) => {
      const json: unknown = JSON.parse(buildFixtureAnswer(r.input)!);
      return {
        status: 'succeeded',
        reason_code: 'fixture',
        explanation: 'Test-only port',
        logical_operation_id: r.logical_operation_id,
        attempts: [],
        output: { text: JSON.stringify(json), json, vector: null },
        decision_id: null,
        fixture: true,
        replayed: false,
      } satisfies BrokerCallResult;
    },
  };
  const build = await new BuildSupervisor(products, double).run(
    product.id,
    task.id,
    product.initial_commit,
    plan,
    ports,
  );
  assert.equal(build.state, 'verified_candidate', build.reason);
  return { root, products, double, product, task, binding, spec, ports, build };
}

test('a verified candidate packages to a manifest bound to its commit, spec, task, QA and package checks', async (t) => {
  const s = await verifiedBuild(t);
  const artifacts = new ArtifactSupervisor(s.products, s.double);
  const { manifest, manifest_sha256 } = await artifacts.package(
    s.product.id,
    s.build.id,
    s.ports,
  );
  assert.equal(manifest.state, 'verified');
  assert.equal(manifest.repository.commit, s.build.commit);
  assert.equal(manifest.spec.hash, s.binding.spec_hash);
  assert.equal(manifest.task.hash, s.binding.tasks[0]!.hash);
  assert.equal(manifest.tests.package.length, 2);
  // The package runs used the re-extracted archive and saw the exact tested input.
  assert.deepEqual(
    s.double.runs.filter((r) => r.source === 'exported_package').length,
    2,
  );
  assert.ok(
    manifest.tests.package.every(
      (c, i) => c.input_hash === manifest.tests.build_qa[i]!.input_hash,
    ),
  );
  assert.equal(manifest.availability.native_installer.state, 'unavailable');
  assert.ok(manifest.limitations.some((l) => /not isolation evidence/.test(l)));
  const dir = artifacts.dir(s.product.id, manifest.id);
  const archive = await readFile(join(dir, 'source.tar'));
  assert.equal(digest(archive), manifest.package.sha256);
  assert.equal(
    readTar(archive)
      .find((f) => f.path === 'src/main.py')!
      .content.toString(),
    BUILD_FIXTURE_SOURCE,
  );
  assert.equal(
    digest(await readFile(join(dir, 'manifest.json'))),
    manifest_sha256,
  );
  // Immutable files: a second write is refused rather than overwritten.
  await assert.rejects(
    writeFile(join(dir, 'manifest.json'), '{}', { flag: 'wx' }),
    /EEXIST/,
  );
  // Hash mismatch: changed archive bytes are refused on open and start.
  const tampered = Buffer.from(archive);
  tampered[tampered.length - 1030] = 0x41;
  await writeFile(join(dir, 'source.tar'), tampered);
  await assert.rejects(
    artifacts.open(s.product.id, manifest.id, manifest_sha256),
    /Package hash mismatch/,
  );
  await assert.rejects(
    artifacts.start(
      s.product.id,
      manifest.id,
      manifest_sha256,
      s.binding.owner_id,
      {
        args: [],
        stdin: '',
      },
    ),
    /hash mismatch/,
  );
  await assert.rejects(
    artifacts.open(s.product.id, manifest.id, digest('other manifest')),
    /Manifest hash mismatch/,
  );
});

test('a package whose re-extracted run differs is kept but not offered as a runnable demo', async (t) => {
  const s = await verifiedBuild(t);
  s.double.packageOutput = 'drifted\n';
  const artifacts = new ArtifactSupervisor(s.products, s.double);
  const { manifest, manifest_sha256 } = await artifacts.package(
    s.product.id,
    s.build.id,
    s.ports,
  );
  assert.equal(manifest.state, 'failed');
  assert.equal(manifest.availability.runnable_demo.state, 'unavailable');
  assert.equal(manifest.availability.source_archive.state, 'available');
  await assert.rejects(
    artifacts.start(
      s.product.id,
      manifest.id,
      manifest_sha256,
      s.binding.owner_id,
      {
        args: [],
        stdin: '',
      },
    ),
    /not verified/,
  );
});

test('without the reviewed worker the exported package is blocked, never run on this host', async (t) => {
  const s = await verifiedBuild(t);
  if (process.platform === 'win32')
    return t.skip('Host has the reviewed backend');
  const real = new ExecutionSupervisor(s.products);
  const artifacts = new ArtifactSupervisor(s.products, real);
  const { manifest } = await artifacts.package(
    s.product.id,
    s.build.id,
    s.ports,
  );
  assert.equal(manifest.state, 'blocked');
  assert.equal(manifest.tests.package.length, 1);
  assert.match(
    manifest.tests.package[0]!.reason ?? '',
    /Isolation unavailable/,
  );
  assert.equal(manifest.availability.runnable_demo.state, 'unavailable');
});

test('only verified candidates package; changed commits invalidate packaging; revisions start from package bytes', async (t) => {
  const s = await verifiedBuild(t);
  const artifacts = new ArtifactSupervisor(s.products, s.double);
  const { manifest, manifest_sha256 } = await artifacts.package(
    s.product.id,
    s.build.id,
    s.ports,
  );
  const opened = await artifacts.open(
    s.product.id,
    manifest.id,
    manifest_sha256,
  );
  const revision = await s.products.create(s.binding, {
    files: opened.files,
    lineage: {
      artifact_id: manifest.id,
      manifest_sha256,
      product_id: s.product.id,
      commit: manifest.repository.commit,
    },
  });
  assert.equal(revision.base?.artifact_id, manifest.id);
  assert.equal(
    await readFile(join(s.products.repo(revision.id), 'src/main.py'), 'utf8'),
    BUILD_FIXTURE_SOURCE,
  );
  await s.products.apply(
    s.product.id,
    s.task.id,
    {
      expected_commit: s.build.commit,
      changes: [
        {
          path: 'src/main.py',
          before_hash: digest(BUILD_FIXTURE_SOURCE),
          content: 'print("changed")\n',
        },
      ],
    },
    s.binding,
  );
  await assert.rejects(
    artifacts.package(s.product.id, s.build.id, s.ports),
    /Changed candidate/,
  );
});
