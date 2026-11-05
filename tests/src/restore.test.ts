import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  appendFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import {
  ArtifactSupervisor,
  BuildSupervisor,
  ProductSupervisor,
  digest,
  type Binding,
  type BuildPorts,
} from '@creator/executor';
import {
  BUILD_FIXTURE_CASES,
  BUILD_FIXTURE_SPEC,
  buildFixtureAnswer,
} from '@creator/domain';
import {
  SpecBodySchema,
  parse,
  type BrokerCallResult,
} from '@creator/contracts';
import {
  checkBackup,
  createBackup,
  restoreBackup,
  verifyRestore,
  FileStore,
} from '@creator/db';
import { freshDatabase, LOGIN_CODE, login, TEST_DB_ENV } from './pg-harness.js';
import { TestDoubleExecutor } from './artifact-double.js';

/** An empty, unmigrated database on the test server, dropped afterwards. */
async function emptyDatabase(t: test.TestContext) {
  const admin = new pg.Pool({
    connectionString: process.env[TEST_DB_ENV]!,
    max: 1,
  });
  admin.on('error', () => undefined);
  const name = `creator_restore_${randomBytes(6).toString('hex')}`;
  await admin.query(`create database ${name}`);
  t.after(async () => {
    await admin.query(`drop database if exists ${name} with (force)`);
    await admin.end();
  });
  const url = new URL(process.env[TEST_DB_ENV]!);
  url.pathname = `/${name}`;
  return url.toString();
}

async function startApi(url: string, products: ProductSupervisor) {
  const double = new TestDoubleExecutor(products);
  const api = createApi(
    { CREATOR_DATABASE_URL: url, CREATOR_DEV_LOGIN_CODE: LOGIN_CODE },
    { artifacts: new ArtifactSupervisor(products, double) },
  );
  api.server.listen(0, '127.0.0.1');
  api.preview.listen(0, '127.0.0.1');
  await Promise.all([
    once(api.server, 'listening'),
    once(api.preview, 'listening'),
  ]);
  await api.ready();
  const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  const auth = await login(`${origin}/api`);
  const get = async (path: string) => {
    const r = await fetch(`${origin}/api/${path}`, { headers: auth.read });
    const type = r.headers.get('content-type') ?? '';
    return {
      status: r.status,
      body: type.includes('json')
        ? ((await r.json()) as any)
        : Buffer.from(await r.arrayBuffer()),
    };
  };
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${origin}/api/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  return { api, origin, double, get, post };
}

test('a backup restores the catalog and artifact references into a new database and product store, and refuses tampering', async (t) => {
  const closers: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const c of closers.reverse()) await c();
  });
  const db = await freshDatabase(t);
  if (!db) return;
  const pgBinDir = process.env.CREATOR_PG_BIN || undefined;
  const pgDump = pgBinDir ? join(pgBinDir, 'pg_dump') : 'pg_dump';
  try {
    await promisify(execFile)(pgDump, ['--version']);
  } catch {
    t.skip(
      'Backup check not run: pg_dump not found (install PostgreSQL client tools or set CREATOR_PG_BIN)',
    );
    return;
  }
  const parent = resolve('.verification/t17-restore');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(dir.startsWith(parent));
    await rm(dir, { recursive: true, force: true });
  });

  // ---- Build the core path: records, a frozen spec, a verified package, a catalogued artifact.
  const products = new ProductSupervisor(join(dir, 'products'));
  const first = await startApi(db.url, products);
  closers.push(first.api.close);
  const store = first.api.store!;
  const cli = async (...args: string[]) => {
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['apps/cli/dist/main.js', ...args],
        {
          env: {
            ...process.env,
            CREATOR_API_URL: first.origin,
            CREATOR_SESSION_FILE: join(dir, 'session.json'),
          },
          timeout: 60000,
        },
      );
      return JSON.parse(stdout) as any;
    } catch (e) {
      throw new Error(String((e as { stdout?: string }).stdout ?? e));
    }
  };
  await cli('login', LOGIN_CODE);
  const seed = await cli('seed-selection');
  const ws: string = seed.workspace.id;
  const specId: string = seed.spec.id;
  const ctx = { actorId: DEFAULT_OWNER_ACTOR_ID };
  const before = await cli('spec', ws, specId);
  const revised = await cli(
    'spec-revise',
    ws,
    specId,
    JSON.stringify({
      expected_version: before.spec.version,
      title: 'Synthetic restorable checklist',
      content: BUILD_FIXTURE_SPEC,
      reason: 'Synthetic T17 restore check; no empirical product claim',
    }),
  );
  const freezeBody = JSON.stringify({
    spec: { id: specId, version: revised.spec.version },
    justification: 'Synthetic exact T17 freeze',
    data_class: 'synthetic',
  });
  const requested = await cli('spec-freeze', ws, seed.run, freezeBody);
  if (requested.status === 'needs_human') {
    const decision = await cli('decision', ws, requested.admission.decision_id);
    await cli(
      'answer',
      ws,
      decision.id,
      decision.coverage.coverage_hash,
      'approve_once',
      'Synthetic exact-version freeze',
    );
    assert.equal(
      (await cli('spec-freeze', ws, seed.run, freezeBody)).status,
      'frozen',
    );
  } else assert.equal(requested.status, 'frozen');
  const binding = async (): Promise<{ binding: Binding; spec: any }> => {
    const status = await store.specStatus(ctx, ws, specId);
    const detail = await store.getEntity(ctx, ws, specId);
    const spec = parse(SpecBodySchema, detail.entity.body);
    return {
      spec,
      binding: {
        workspace_id: ws,
        owner_id: DEFAULT_OWNER_ACTOR_ID,
        spec_id: specId,
        spec_version: status.spec.version,
        spec_hash: status.spec.content_hash,
        freeze_id: status.latest_freeze!.id,
        tasks: spec.tasks
          .filter((x) => x.file_scope.length)
          .map((x) => ({
            key: x.key,
            hash: status.latest_freeze!.task_hashes[x.key]!,
            file_scope: x.file_scope,
          })),
      },
    };
  };
  const ports: BuildPorts = {
    current: binding,
    assertActive: async () => {},
    authorize: async () => ({ verdict: 'allow', test_port: true }),
    call: async (_run, r) => {
      const json: unknown = JSON.parse(buildFixtureAnswer(r.input)!);
      return {
        status: 'succeeded',
        reason_code: 'fixture',
        explanation: 'Test-only port; the real broker is covered by T12 tests',
        logical_operation_id: r.logical_operation_id,
        attempts: [],
        output: { text: JSON.stringify(json), json, vector: null },
        decision_id: null,
        fixture: true,
        replayed: false,
      } satisfies BrokerCallResult;
    },
  };
  const product = await products.create((await binding()).binding);
  const task = await products.createTask(
    product.id,
    'T1',
    product.initial_commit,
    (await binding()).binding,
  );
  const build = await new BuildSupervisor(products, first.double).run(
    product.id,
    task.id,
    product.initial_commit,
    {
      format: 'build-plan/1',
      run_id: seed.run,
      envelope_id: seed.run,
      pricing_snapshot_id: seed.run,
      humility_review: { id: specId, version: 1 },
      data_class: 'synthetic',
      max_repairs: 0,
      max_calls: 2,
      timeout_ms: 10000,
      max_output_tokens: 3000,
      deadline: new Date(Date.now() + 300000).toISOString(),
      cases: BUILD_FIXTURE_CASES,
    },
    ports,
  );
  assert.equal(build.state, 'verified_candidate', build.reason);
  const pkg = await new ArtifactSupervisor(products, first.double).package(
    product.id,
    build.id,
    ports,
  );
  const reg = await first.post(`workspaces/${ws}/artifacts`, {
    product_id: product.id,
    artifact_id: pkg.manifest.id,
    manifest_sha256: pkg.manifest_sha256,
  });
  assert.equal(reg.status, 201, JSON.stringify(reg.body));
  const artifact = reg.body;
  const searchBefore = await first.get(
    `workspaces/${ws}/search?q=${encodeURIComponent('restorable')}`,
  );
  assert.equal(searchBefore.status, 200);

  // Redacted text must not come back with a restore.
  const secret = await store.createEntity(ctx, ws, {
    kind: 'idea',
    title: 'Zebracorn roster',
    body: {
      summary: 'A zebracorn rota for the clinic',
      uncertainty: 'Untested',
    },
  });
  await store.redactEntity(ctx, ws, secret.id, {
    expected_version: 1,
    reason_code: 'privacy',
  });

  // ---- Back up while the API is running.
  const backupDir = join(dir, 'backup');
  // ADR-0072: an uploaded file's exact bytes travel with the database dump.
  const fileBytes = Buffer.from([0, 1, 2, 250, 251, 252, 0x0a, 0x41]);
  const uploaded = await new FileStore(db.pool).uploadFile(ctx, ws, {
    bytes: fileBytes,
    name: 'raw.bin',
    declaredType: null,
    uploadKey: randomUUID(),
    linkEntityId: null,
    keepDuplicate: false,
  });
  const manifest = await createBackup({
    databaseUrl: db.url,
    productsRoot: join(dir, 'products'),
    outDir: backupDir,
    pgBinDir,
  });
  assert.equal(manifest.counts.artifact_manifests, 1);
  // X06: lineage and budget totals come from the dump's own snapshot.
  assert.ok(manifest.totals && manifest.totals.lineage.active > 0);
  assert.ok(manifest.totals.budget.envelopes > 0);
  assert.ok(manifest.products.some((f) => f.path.endsWith('/source.tar')));
  assert.equal(
    (await checkBackup(backupDir)).database.sha256,
    manifest.database.sha256,
  );
  await assert.rejects(
    createBackup({
      databaseUrl: db.url,
      productsRoot: join(dir, 'products'),
      outDir: backupDir,
    }),
    /already exists/,
  );

  // ---- Restore into a new database and a new product store.
  const restoredUrl = await emptyDatabase(t);
  const restoredRoot = join(dir, 'restored-products');
  const check = await restoreBackup({
    backupDir,
    databaseUrl: restoredUrl,
    productsRoot: restoredRoot,
    pgBinDir,
  });
  assert.equal(check.ok, true, JSON.stringify(check));
  assert.equal(check.audit_chain.ok, true);
  assert.deepEqual(check.counts, manifest.counts);
  assert.deepEqual(check.totals, manifest.totals);
  assert.equal(manifest.counts.workspace_file_versions, 1);
  {
    const restoredPool = new pg.Pool({ connectionString: restoredUrl, max: 1 });
    try {
      const back = await new FileStore(restoredPool).fileContent(
        ctx,
        ws,
        uploaded.file.id,
        null,
      );
      assert.deepEqual(back.bytes, fileBytes);
      assert.equal(back.sha256, uploaded.file.current.sha256);
    } finally {
      await restoredPool.end();
    }
  }
  assert.deepEqual(
    check.artifacts.map((a) => [a.id, a.ok]),
    [[artifact.id, true]],
  );
  // A second restore over the restored copy is refused before anything is written.
  await assert.rejects(
    restoreBackup({
      backupDir,
      databaseUrl: restoredUrl,
      productsRoot: join(dir, 'other-products'),
    }),
    /not empty/,
  );

  // A plain-SQL dump of the restored database holds the tombstone but none of the redacted text.
  const plain = new URL(restoredUrl);
  const password = plain.password;
  plain.password = '';
  const { stdout: sql } = await promisify(execFile)(
    pgDump,
    ['--format=plain', '--data-only', `--dbname=${plain.toString()}`],
    {
      env: { ...process.env, PGPASSWORD: password },
      maxBuffer: 64 * 1024 * 1024,
    },
  );
  assert.ok(sql.includes(secret.id));
  assert.doesNotMatch(sql, /zebracorn/i);

  // A backup whose recorded totals disagree with its dump is refused after pg_restore.
  const forged = JSON.parse(
    await readFile(join(backupDir, 'backup-manifest.json'), 'utf8'),
  );
  forged.totals.budget.incurred_nano = String(
    BigInt(forged.totals.budget.incurred_nano) + 1n,
  );
  const forgedDir = join(dir, 'forged-backup');
  await cp(backupDir, forgedDir, { recursive: true });
  await writeFile(
    join(forgedDir, 'backup-manifest.json'),
    JSON.stringify(forged),
  );
  await assert.rejects(
    restoreBackup({
      backupDir: forgedDir,
      databaseUrl: await emptyDatabase(t),
      productsRoot: join(dir, 'forged-products'),
      pgBinDir,
    }),
    /Restored budget incurred_nano/,
  );

  // ---- The restored core path works through the real API.
  const second = await startApi(
    restoredUrl,
    new ProductSupervisor(restoredRoot),
  );
  closers.push(second.api.close);
  // The restored copy keeps its environment label.
  assert.equal((await second.api.ops!.identity())?.environment, 'local');
  const searchAfter = await second.get(
    `workspaces/${ws}/search?q=${encodeURIComponent('restorable')}`,
  );
  assert.equal(searchAfter.status, 200);
  assert.deepEqual(
    searchAfter.body.hits.map((h: any) => h.id),
    searchBefore.body.hits.map((h: any) => h.id),
  );
  assert.ok(searchAfter.body.hits.length > 0);
  const detail = await second.get(`workspaces/${ws}/artifacts/${artifact.id}`);
  assert.equal(detail.status, 200);
  assert.equal(detail.body.integrity.ok, true);
  const lineage = await second.get(
    `workspaces/${ws}/entities/${artifact.entity_id}/lineage?direction=upstream`,
  );
  assert.ok(JSON.stringify(lineage.body).includes(specId));
  const dl = await second.get(
    `workspaces/${ws}/artifacts/${artifact.id}/download?sha256=${artifact.manifest_sha256}`,
  );
  assert.equal(dl.status, 200);
  assert.equal(digest(dl.body as Buffer), pkg.manifest.package.sha256);

  // ---- Tampering is caught: in the restored store, and in the backup itself.
  const tar = join(
    restoredRoot,
    product.id,
    'artifacts',
    artifact.id,
    'source.tar',
  );
  await appendFile(tar, 'x');
  const tampered = await verifyRestore(restoredUrl, restoredRoot);
  assert.equal(tampered.ok, false);
  assert.equal(tampered.artifacts[0]!.problem, 'package hash mismatch');
  const refused = await second.get(
    `workspaces/${ws}/artifacts/${artifact.id}/download?sha256=${artifact.manifest_sha256}`,
  );
  assert.equal(refused.status, 400);
  assert.match(refused.body.error.message, /hash mismatch/i);
  await writeFile(join(backupDir, 'products', 'stray.txt'), 'not listed');
  await assert.rejects(checkBackup(backupDir), /not in the backup manifest/);
});
