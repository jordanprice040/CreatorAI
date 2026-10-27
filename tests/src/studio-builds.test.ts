import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi } from '@creator/api';
import { ArtifactSupervisor, ProductSupervisor } from '@creator/executor';
import { BUILD_FIXTURE_SPEC } from '@creator/domain';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { TestDoubleExecutor } from './artifact-double.js';

// ADR-0046: the studio's own build routes, as the desktop app uses them. The fixture broker
// answers the builder and reviewer; the execution double stands in for the WSL2 worker
// (its manifests say so), so this covers the routes and gates, not isolation.
test('studio build routes: frozen-spec products, admission-gated builds, packaging into Gallery, refusals', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const parent = resolve('.verification/studio-builds');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(dir.startsWith(parent));
    await rm(dir, { recursive: true, force: true });
  });
  const products = new ProductSupervisor(join(dir, 'products'));
  const artifacts = new ArtifactSupervisor(
    products,
    new TestDoubleExecutor(products),
  );
  const api = createApi(
    { CREATOR_DATABASE_URL: db.url, CREATOR_DEV_LOGIN_CODE: LOGIN_CODE },
    { artifacts },
  );
  api.server.listen(0, '127.0.0.1');
  api.preview.listen(0, '127.0.0.1');
  await Promise.all([
    once(api.server, 'listening'),
    once(api.preview, 'listening'),
  ]);
  closeApi = api.close;
  await api.ready();
  const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
  const env = {
    ...process.env,
    CREATOR_API_URL: origin,
    CREATOR_SESSION_FILE: join(dir, 'session.json'),
  };
  const cli = async (...args: string[]) => {
    try {
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['apps/cli/dist/main.js', ...args],
        { env, timeout: 60000 },
      );
      return JSON.parse(stdout) as any;
    } catch (e) {
      throw new Error(String((e as { stdout?: string }).stdout ?? e));
    }
  };
  await cli('login', LOGIN_CODE);
  const auth = await login(`${origin}/api`);
  const http = async (path: string, body?: unknown, key?: string) => {
    const r = await fetch(`${origin}/api/${path}`, {
      ...(body === undefined
        ? { headers: auth.read }
        : {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...auth.write,
              ...(key ? { 'Idempotency-Key': key } : {}),
            },
            body: JSON.stringify(body),
          }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const seed = await cli('seed-selection');
  const ws: string = seed.workspace.id;
  const specId: string = seed.spec.id;
  const freeze = async (version: number) => {
    const body = JSON.stringify({
      spec: { id: specId, version },
      justification: 'Synthetic exact freeze',
      data_class: 'synthetic',
    });
    const requested = await cli('spec-freeze', ws, seed.run, body);
    if (requested.status === 'needs_human') {
      const decision = await cli(
        'decision',
        ws,
        requested.admission.decision_id,
      );
      await cli(
        'answer',
        ws,
        decision.id,
        decision.coverage.coverage_hash,
        'approve_once',
        'Synthetic exact-version freeze',
      );
      assert.equal(
        (await cli('spec-freeze', ws, seed.run, body)).status,
        'frozen',
      );
    } else assert.equal(requested.status, 'frozen');
  };
  const revise = async (content: unknown, reason: string) => {
    const before = await cli('spec', ws, specId);
    return cli(
      'spec-revise',
      ws,
      specId,
      JSON.stringify({
        expected_version: before.spec.version,
        title: 'Synthetic bounded checklist',
        content,
        reason,
      }),
    );
  };
  const base = `workspaces/${ws}/products`;
  // The $0 sample puts the synthetic checklist into the spec; a real workspace refuses it.
  const real = await http('workspaces', {
    name: 'Real records',
    record_mode: 'real',
  });
  const refusedSample = await http(
    `workspaces/${real.body.id}/products/sample-spec`,
    { spec_id: specId },
  );
  assert.equal(refusedSample.status, 403, JSON.stringify(refusedSample.body));
  const sample = await http(`${base}/sample-spec`, { spec_id: specId });
  assert.equal(sample.status, 200, JSON.stringify(sample.body));
  const v1 = sample.body;
  assert.deepEqual(
    (await cli('spec', ws, specId)).spec.version,
    v1.spec.version,
  );

  // An unfrozen spec cannot become a product.
  const unfrozen = await http(base, { spec_id: specId });
  assert.equal(unfrozen.status, 409, JSON.stringify(unfrozen.body));
  await freeze(v1.spec.version);

  const product = await http(base, { spec_id: specId });
  assert.equal(product.status, 201, JSON.stringify(product.body));
  const p = product.body;
  const task = await http(`${base}/${p.id}/tasks`, {
    task_key: 'T1',
    expected_commit: p.initial_commit,
  });
  assert.equal(task.status, 201, JSON.stringify(task.body));

  // Another workspace cannot reach this product.
  const other = await http('workspaces', {
    name: 'Other fixture',
    record_mode: 'fixture',
  });
  const foreign = await http(
    `workspaces/${other.body.id}/products/${p.id}/tasks`,
    {
      task_key: 'T1',
      expected_commit: p.initial_commit,
    },
  );
  assert.equal(foreign.status, 404, JSON.stringify(foreign.body));
  const otherList = await http(`workspaces/${other.body.id}/products`);
  assert.equal(otherList.status, 200, JSON.stringify(otherList.body));
  assert.deepEqual(otherList.body, []);

  const sampleReview = await http(`${base}/sample-review`, {
    spec_id: specId,
  });
  assert.equal(sampleReview.status, 201, JSON.stringify(sampleReview.body));
  const review = sampleReview.body;
  const [budgets, pricing] = await Promise.all([
    cli('budgets', ws),
    cli('pricing', ws),
  ]);
  const plan = {
    format: 'build-plan/1',
    run_id: seed.run,
    envelope_id: budgets[0].id,
    pricing_snapshot_id: pricing[0].id,
    humility_review: { id: review.id, version: review.version },
    data_class: 'synthetic',
    max_repairs: 0,
    max_calls: 2,
    timeout_ms: 10000,
    max_output_tokens: 3000,
    deadline: new Date(Date.now() + 600000).toISOString(),
  };
  const start = (key?: string, product = p, taskId = task.body.id) =>
    http(
      `${base}/${product.id}/builds`,
      { task_id: taskId, expected_commit: product.initial_commit, plan },
      key,
    );
  const build = async () => {
    const started = await start();
    assert.equal(started.status, 202, JSON.stringify(started.body));
    return started.body.build_id as string;
  };
  const until = async <T>(read: () => Promise<T | null>, what: string) => {
    const end = Date.now() + 60000;
    for (;;) {
      const v = await read();
      if (v) return v;
      if (Date.now() > end) throw new Error(`Timed out waiting for ${what}`);
      await sleep(200);
    }
  };
  const entry = async (buildId: string, productId = p.id) => {
    const list = await http(base);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    const mine = list.body.find((x: any) => x.product.id === productId);
    return mine.builds.find((b: any) => b.id === buildId);
  };
  const settled = (buildId: string, productId = p.id) =>
    until(async () => {
      const b = await entry(buildId, productId);
      return b && b.state !== 'running' ? b : null;
    }, `build ${buildId}`);

  // No covering grant: the build is not admitted and stops, saying why.
  const refused = await settled(await build());
  // It stops at a checkpoint naming the decision that would admit it (shown under Decisions).
  assert.equal(refused.state, 'checkpoint', JSON.stringify(refused));
  assert.match(refused.reason, /Build admission waiting_human; decision /);

  // The owner approves exactly one build under Decisions.
  const decisionId = /decision ([0-9a-f-]{36})/.exec(refused.reason)![1]!;
  const decision = await cli('decision', ws, decisionId);
  await cli(
    'answer',
    ws,
    decision.id,
    decision.coverage.coverage_hash,
    'approve_once',
    'Synthetic: one studio build',
  );
  // Two starts at once: one runs, the other is refused instead of queueing behind it. Both
  // carry the same request key, as a client retry would.
  const key = randomUUID();
  const pair = await Promise.all([start(key), start(key)]);
  assert.deepEqual(
    pair.map((r) => r.status).sort(),
    [202, 409],
    JSON.stringify(pair.map((r) => r.body)),
  );
  const verified = await settled(
    pair.find((r) => r.status === 202)!.body.build_id,
  );
  assert.equal(verified.state, 'verified_candidate', JSON.stringify(verified));
  assert.equal(verified.fixture, true);

  // That approval was for one build. Another build sent with the same request key must not
  // replay its admission: it stops and asks again.
  const p2 = (await http(base, { spec_id: specId })).body;
  const task2 = await http(`${base}/${p2.id}/tasks`, {
    task_key: 'T1',
    expected_commit: p2.initial_commit,
  });
  const again = await start(key, p2, task2.body.id);
  assert.equal(again.status, 202, JSON.stringify(again.body));
  const asked = await settled(again.body.build_id, p2.id);
  assert.equal(asked.state, 'checkpoint', JSON.stringify(asked));
  assert.match(asked.reason, /Build admission waiting_human/);

  // A checkpointed build cannot be packaged; a verified one can, into Gallery.
  const notVerified = await http(`${base}/${p.id}/package`, {
    build_id: refused.id,
  });
  assert.ok(notVerified.status >= 400, JSON.stringify(notVerified.body));
  const pkg = await http(`${base}/${p.id}/package`, { build_id: verified.id });
  assert.equal(pkg.status, 202, JSON.stringify(pkg.body));
  const packaged = await until(async () => {
    const b = await entry(verified.id);
    return b.package && b.package.state !== 'running' ? b.package : null;
  }, 'packaging');
  assert.equal(packaged.state, 'done', JSON.stringify(packaged));
  const gallery = await http(`workspaces/${ws}/artifacts`);
  assert.ok(
    gallery.body.some((a: any) => a.id === packaged.artifact_id),
    JSON.stringify(gallery.body),
  );

  // The app closed mid-build: its lock stays. A live holder is never displaced; once the
  // holder is gone, Recover releases it and the product can be built again.
  const lock = join(products.dir(p.id), 'builds', 'supervisor.lock');
  const holder = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 60000)']);
  t.after(() => holder.kill());
  const now = new Date().toISOString();
  await writeFile(
    lock,
    JSON.stringify({ pid: holder.pid, token: 'x', at: now }),
  );
  const locked = await start();
  assert.equal(locked.status, 409, JSON.stringify(locked.body));
  assert.match(JSON.stringify(locked.body), /locked/i);
  const held = await http(`${base}/${p.id}/recover`, {});
  assert.equal(held.status, 409, JSON.stringify(held.body));
  // An empty lock just created is its holder mid-write, not a crash.
  await writeFile(lock, '');
  const writing = await http(`${base}/${p.id}/recover`, {});
  assert.equal(writing.status, 409, JSON.stringify(writing.body));
  assert.match(writing.body.error.message, /being written/);
  // Written before this boot, a lock is dead whatever process now has its number.
  await writeFile(
    lock,
    JSON.stringify({ pid: holder.pid, token: 'x', at: '2000-01-01T00:00:00Z' }),
  );
  const recovered = await http(`${base}/${p.id}/recover`, {});
  assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
  assert.deepEqual(recovered.body.released, ['builds']);
  assert.deepEqual(recovered.body.reconciled, []);
  // Nothing left: recovery says nothing changed instead of claiming it recovered.
  const nothing = await http(`${base}/${p.id}/recover`, {});
  assert.deepEqual(nothing.body, {
    product_id: p.id,
    released: [],
    reconciled: [],
  });
  // The studio-wide dispatch lock of a run that crashed before launching its worker (no
  // pending marker) is released too; with a marker it waits for reconciliation.
  const dispatch = join(products.root, 'supervisor.lock');
  const marker = join(products.root, 'pending-worker.json');
  const dead = JSON.stringify({
    pid: holder.pid,
    token: 'y',
    at: '2000-01-01T00:00:00Z',
  });
  await writeFile(dispatch, dead);
  await writeFile(marker, JSON.stringify({ product_id: randomUUID() }));
  const waiting = await http(`${base}/${p.id}/recover`, {});
  assert.equal(waiting.status, 409, JSON.stringify(waiting.body));
  assert.match(waiting.body.error.message, /reconciliation first/);
  await rm(marker);
  const freed = await http(`${base}/${p.id}/recover`, {});
  assert.deepEqual(
    freed.body.released,
    ['dispatch'],
    JSON.stringify(freed.body),
  );
  holder.kill();
  const unlocked = await start();
  assert.doesNotMatch(JSON.stringify(unlocked.body), /locked/i);
  if (unlocked.status === 202) await settled(unlocked.body.build_id);

  // A changed spec invalidates the build: packaging it again is refused before any work.
  await revise(
    {
      ...BUILD_FIXTURE_SPEC,
      non_goals: [...BUILD_FIXTURE_SPEC.non_goals, 'Sync'],
    },
    'Synthetic change after the build',
  );
  const stale = await http(`${base}/${p.id}/package`, {
    build_id: verified.id,
  });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
});
