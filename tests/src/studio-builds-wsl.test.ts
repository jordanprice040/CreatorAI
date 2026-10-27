import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { createApi } from '@creator/api';
import {
  ArtifactSupervisor,
  ExecutionSupervisor,
  ProductSupervisor,
  TEMPLATE,
  digest,
} from '@creator/executor';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const real = process.env.CREATOR_TEST_ISOLATION === 'wsl2';
// ADR-0046 review: the app closes while a build's acceptance run is in the real WSL2 worker.
// The run's supervisor is gone, but the worker unit, the studio-wide dispatch lock and the
// pending-worker marker remain. Recover must reconcile it (the executor verifies the unit
// stopped) and free the studio for the next build; while the supervisor lives, it must not.
test(
  'Recover reconciles an acceptance run left by a closed app, only once its supervisor is gone (real WSL2)',
  {
    skip:
      !real && 'Real isolation gate is opt-in (CREATOR_TEST_ISOLATION=wsl2)',
  },
  async (t) => {
    let closeApi = async () => {};
    t.after(() => closeApi());
    const db = await freshDatabase(t);
    if (!db) return;
    const parent = resolve('.verification/studio-builds-wsl');
    await mkdir(parent, { recursive: true });
    const dir = await mkdtemp(join(parent, 'case-'));
    t.after(async () => {
      assert.ok(dir.startsWith(parent));
      await rm(dir, { recursive: true, force: true });
    });
    const products = new ProductSupervisor(join(dir, 'products'));
    const api = createApi(
      { CREATOR_DATABASE_URL: db.url, CREATOR_DEV_LOGIN_CODE: LOGIN_CODE },
      {
        artifacts: new ArtifactSupervisor(
          products,
          new ExecutionSupervisor(products),
        ),
      },
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
    const sample = await http(`${base}/sample-spec`, { spec_id: specId });
    assert.equal(sample.status, 200, JSON.stringify(sample.body));
    const body = JSON.stringify({
      spec: { id: specId, version: sample.body.spec.version },
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
      await cli('spec-freeze', ws, seed.run, body);
    }
    const p = (await http(base, { spec_id: specId })).body;
    const task = (
      await http(`${base}/${p.id}/tasks`, {
        task_key: 'T1',
        expected_commit: p.initial_commit,
      })
    ).body;

    // A long acceptance run, started by a supervisor process that is then killed.
    const changed = await products.apply(
      p.id,
      task.id,
      {
        expected_commit: p.initial_commit,
        changes: [
          {
            path: 'src/main.py',
            before_hash: digest(TEMPLATE['src/main.py']),
            content:
              'import time\nprint("started",flush=True)\ntime.sleep(120)\n',
          },
        ],
      },
      p.binding,
    );
    const config = join(dir, 'crash.json');
    await writeFile(
      config,
      JSON.stringify({
        root: products.root,
        product_id: p.id,
        task_id: task.id,
        commit: changed.commit,
        binding: p.binding,
      }),
    );
    const child = spawn(
      process.execPath,
      [resolve('scripts/executor-crash-worker.mjs'), config],
      { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
    );
    t.after(() => child.kill('SIGKILL'));
    let text = '',
      executionId = '';
    child.stdout.on('data', (b: Buffer) => {
      text += b.toString();
      const line = text.split('\n')[0];
      if (line)
        try {
          executionId = (JSON.parse(line) as { execution_id: string })
            .execution_id;
        } catch {
          /* incomplete line */
        }
    });
    const until = Date.now() + 15000;
    while (!executionId && Date.now() < until && child.exitCode === null)
      await sleep(50);
    assert.ok(executionId, 'the run started');
    await sleep(1800);

    // While its supervisor lives, Recover refuses and the studio stays locked.
    const early = await http(`${base}/${p.id}/recover`, {});
    assert.equal(early.status, 409, JSON.stringify(early.body));
    assert.match(early.body.error.message, /Supervisor still exists/);

    const closed = once(child, 'close');
    child.kill('SIGKILL');
    await closed;
    await sleep(6500);
    const recovered = await http(`${base}/${p.id}/recover`, {});
    assert.equal(recovered.status, 200, JSON.stringify(recovered.body));
    assert.deepEqual(recovered.body.reconciled, [executionId]);
    await assert.rejects(
      readFile(join(products.root, 'supervisor.lock')),
      /ENOENT/,
    );
    await assert.rejects(
      readFile(join(products.root, 'pending-worker.json')),
      /ENOENT/,
    );
  },
);
