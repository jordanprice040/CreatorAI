import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi } from '@creator/api';
import { ArtifactSupervisor, ProductSupervisor } from '@creator/executor';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { TestDoubleExecutor } from './artifact-double.js';

// Final UX pass P-1: Build's own path, with the requests Build sends (apps/web/src/build.tsx):
// Prepare task from the first commit, then Start build from the task's head as the products
// list reports it, with StartBuild's plan (one repair round, 2 + 2 × repairs requests). The
// fixture broker answers the roles; the execution double stands in for the WSL2 worker and,
// when told to, reports the real worker's block from a host without WSL2.
test('Build after approval: start, approve, start again reaches Package and Try, also after a worker that could not run', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const parent = resolve('.verification/build-retry-web');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(dir.startsWith(parent));
    await rm(dir, { recursive: true, force: true });
  });
  const products = new ProductSupervisor(join(dir, 'products'));
  const worker = new TestDoubleExecutor(products);
  let blockCases = 0;
  const run = worker.run.bind(worker);
  worker.run = async (...a: Parameters<typeof worker.run>) => {
    const e = await run(...a);
    if (!a[5] || blockCases <= 0) return e;
    blockCases--;
    return {
      ...e,
      state: 'blocked',
      exit_code: null,
      log: '',
      reason:
        'Error: Isolation unavailable: this reviewed backend requires Windows + WSL2',
    };
  };
  const api = createApi(
    { CREATOR_DATABASE_URL: db.url, CREATOR_DEV_LOGIN_CODE: LOGIN_CODE },
    { artifacts: new ArtifactSupervisor(products, worker) },
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
  const http = async (path: string, body?: unknown) => {
    const r = await fetch(`${origin}/api/${path}`, {
      ...(body === undefined
        ? { headers: auth.read }
        : {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', ...auth.write },
            body: JSON.stringify(body),
          }),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const seed = await cli('seed-selection');
  const ws: string = seed.workspace.id;
  const specId: string = seed.spec.id;
  const base = `workspaces/${ws}/products`;
  // An approval answered the way Monitor › Approvals answers it: once, for this build.
  const approve = async (reason: string) => {
    const id = /decision ([0-9a-f-]{36})/.exec(reason)?.[1];
    assert.ok(id, reason);
    const decision = await cli('decision', ws, id);
    await cli(
      'answer',
      ws,
      decision.id,
      decision.coverage.coverage_hash,
      'approve_once',
      'Synthetic: approve this one build',
    );
  };
  const sample = await http(`${base}/sample-spec`, { spec_id: specId });
  assert.equal(sample.status, 200, JSON.stringify(sample.body));
  const freezeBody = JSON.stringify({
    spec: { id: specId, version: sample.body.spec.version },
    justification: 'Synthetic exact freeze',
    data_class: 'synthetic',
  });
  const freezing = await cli('spec-freeze', ws, seed.run, freezeBody);
  if (freezing.status === 'needs_human') {
    await approve(`decision ${freezing.admission.decision_id}`);
    assert.equal(
      (await cli('spec-freeze', ws, seed.run, freezeBody)).status,
      'frozen',
    );
  }
  const review = (await http(`${base}/sample-review`, { spec_id: specId }))
    .body;
  const [budgets, pricing] = await Promise.all([
    cli('budgets', ws),
    cli('pricing', ws),
  ]);

  const product = async () => {
    const made = await http(base, { spec_id: specId });
    assert.equal(made.status, 201, JSON.stringify(made.body));
    // Prepare task: a fresh product's task starts from its first commit.
    const task = await http(`${base}/${made.body.id}/tasks`, {
      task_key: 'T1',
      expected_commit: made.body.initial_commit,
    });
    assert.equal(task.status, 201, JSON.stringify(task.body));
    return { id: made.body.id as string, task: task.body.id as string };
  };
  const entry = async (productId: string) => {
    const list = await http(base);
    assert.equal(list.status, 200, JSON.stringify(list.body));
    return list.body.find((x: any) => x.product.id === productId);
  };
  // Start build, exactly as Build sends it: the task's head from the list, or its base.
  const startBuild = async (p: { id: string; task: string }) => {
    const task = (await entry(p.id)).tasks.find((x: any) => x.id === p.task);
    const repairs = 1;
    const started = await http(`${base}/${p.id}/builds`, {
      task_id: p.task,
      expected_commit: task.head ?? task.base_commit,
      plan: {
        format: 'build-plan/1',
        run_id: seed.run,
        envelope_id: budgets[0].id,
        pricing_snapshot_id: pricing[0].id,
        humility_review: { id: review.id, version: review.version },
        data_class: 'synthetic',
        max_repairs: repairs,
        max_calls: 2 + 2 * repairs,
        timeout_ms: 30000,
        max_output_tokens: 3000,
        deadline: new Date(Date.now() + 600000).toISOString(),
      },
    });
    assert.equal(started.status, 202, JSON.stringify(started.body));
    const end = Date.now() + 60000;
    for (;;) {
      const b = (await entry(p.id)).builds.find(
        (x: any) => x.id === started.body.build_id,
      );
      if (b && b.state !== 'running')
        return { ...b, start_note: started.body.note };
      if (Date.now() > end) throw new Error('Timed out waiting for the build');
      await sleep(200);
    }
  };
  const packageAndTry = async (p: { id: string }, buildId: string) => {
    const pkg = await http(`${base}/${p.id}/package`, { build_id: buildId });
    assert.equal(pkg.status, 202, JSON.stringify(pkg.body));
    const end = Date.now() + 60000;
    let packaged: any;
    for (;;) {
      const b = (await entry(p.id)).builds.find((x: any) => x.id === buildId);
      if (b.package && b.package.state !== 'running') {
        packaged = b.package;
        break;
      }
      if (Date.now() > end) throw new Error('Timed out waiting for packaging');
      await sleep(200);
    }
    assert.equal(packaged.state, 'done', JSON.stringify(packaged));
    // Try lists what Gallery holds.
    const gallery = await http(`workspaces/${ws}/artifacts`);
    assert.ok(
      gallery.body.some((a: any) => a.id === packaged.artifact_id),
      JSON.stringify(gallery.body),
    );
  };

  // 1. The walk's own path: the first Start build stops for approval; after approving it,
  // Start build again verifies the sample, which then packages into Try.
  {
    const p = await product();
    const asked = await startBuild(p);
    assert.equal(asked.state, 'checkpoint', JSON.stringify(asked));
    assert.match(asked.reason, /Build admission waiting_human; decision /);
    assert.equal(asked.start_note, undefined);
    await approve(asked.reason);
    const built = await startBuild(p);
    assert.equal(built.state, 'verified_candidate', JSON.stringify(built));
    assert.equal(built.fixture, true);
    await packageAndTry(p, built.id);
  }

  // 2. What the cloud walk hit: after approval, the worker could not run the cases. The
  // build stops with the worker's reason instead of "Patch changes nothing", and once the
  // worker runs, a new approval and Start build carry on from the kept candidate.
  {
    const p = await product();
    await approve((await startBuild(p)).reason);
    blockCases = 1;
    const blocked = await startBuild(p);
    assert.equal(blocked.state, 'checkpoint', JSON.stringify(blocked));
    assert.match(
      blocked.reason,
      /The worker did not finish check A1 \(blocked: Error: Isolation unavailable/,
    );
    assert.doesNotMatch(blocked.reason, /Patch changes nothing/);
    const kept = (await entry(p.id)).tasks.find((x: any) => x.id === p.task);
    assert.equal(kept.head, blocked.commit);
    assert.notEqual(kept.head, kept.base_commit);
    const again = await startBuild(p);
    assert.equal(again.state, 'checkpoint', JSON.stringify(again));
    assert.match(again.reason, /Build admission waiting_human/);
    await approve(again.reason);
    const resumed = await startBuild(p);
    assert.equal(resumed.state, 'verified_candidate', JSON.stringify(resumed));
    assert.equal(resumed.commit, blocked.commit);
    await packageAndTry(p, resumed.id);
  }

  // 3. ADR-0121 review N-7: a half-removed task workspace (Git's admin folder for it is gone)
  // is moved aside before the build starts, and the start's answer says so in one line.
  {
    const p = await product();
    await rm(join(products.repo(p.id), '.git', 'worktrees', p.task), {
      recursive: true,
      force: true,
    });
    const started = await startBuild(p);
    assert.match(
      started.start_note ?? '',
      /^A half-removed workspace was moved to .*worktrees-removed.* first;/,
    );
    const head = await promisify(execFile)('git', ['rev-parse', 'HEAD'], {
      cwd: products.worktree(p.id, p.task),
    });
    assert.match(head.stdout, /^[0-9a-f]{40}/);
  }
});
