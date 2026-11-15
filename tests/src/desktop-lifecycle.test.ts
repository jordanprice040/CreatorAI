import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { spawn, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import {
  ProductSupervisor,
  ExecutionSupervisor,
  ArtifactSupervisor,
  BuildSupervisor,
  type BuildPorts,
} from '@creator/executor';
import {
  BUILD_FIXTURE_SPEC,
  BUILD_FIXTURE_SOURCE,
  BUILD_FIXTURE_CASES,
  buildFixtureAnswer,
} from '@creator/domain';
import { SpecBodySchema, parse } from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const exec = promisify(execFile);
const real = process.env.CREATOR_TEST_ISOLATION === 'wsl2';
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
async function wait(
  check: () => Promise<boolean> | boolean,
  label: string,
  ms = 20000,
) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (await check()) return;
    await sleep(100);
  }
  throw new Error(`Timed out: ${label}`);
}

// Synthetic fixture review, real packaging/QA/worker/isolation. The --hold path is
// explicitly in this fixture's frozen scope; it is never a production artifact.
const source =
  `import sys,subprocess,time
if len(sys.argv)==3 and sys.argv[1]=='--hold':
    subprocess.Popen(['/usr/bin/python3','-I','-c','import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); print("paired_child_ready",flush=True); time.sleep(120)',sys.argv[2]],start_new_session=True)
    print('paired_parent_ready',flush=True)
    time.sleep(120)
` + BUILD_FIXTURE_SOURCE;

test(
  'paired real-process revocation and killed-worker reconciliation never redispatch',
  { skip: !real && 'Paired lifecycle acceptance requires real WSL2 isolation' },
  async (t) => {
    let closeApi = async () => {};
    t.after(() => closeApi());
    const db = await freshDatabase(t);
    if (!db) return;
    const parent = resolve('.verification/paired lifecycle');
    await mkdir(parent, { recursive: true });
    const dir = await mkdtemp(join(parent, 'case-'));
    const products = new ProductSupervisor(join(dir, 'products with spaces'));
    const artifacts = new ArtifactSupervisor(
      products,
      new ExecutionSupervisor(products),
    );
    const api = createApi(
      { CREATOR_DATABASE_URL: db.url, CREATOR_DEV_LOGIN_CODE: LOGIN_CODE },
      { artifacts },
    );
    t.after(async () => {
      assert.ok(
        dir.startsWith(parent + (process.platform === 'win32' ? '\\' : '/')),
      );
      await rm(dir, { recursive: true, force: true });
    });
    api.server.listen(0, '127.0.0.1');
    api.preview.listen(0, '127.0.0.1');
    await Promise.all([
      once(api.server, 'listening'),
      once(api.preview, 'listening'),
    ]);
    await api.ready();
    closeApi = api.close;
    const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}`;
    const auth = await login(`${origin}/api`);
    const http = async (path: string, body?: unknown) => {
      const r = await fetch(
        `${origin}/api/${path}`,
        body === undefined
          ? { headers: auth.read }
          : {
              method: 'POST',
              headers: { ...auth.write, 'Content-Type': 'application/json' },
              body: JSON.stringify(body),
            },
      );
      const value = (await r.json()) as any;
      return { status: r.status, value };
    };
    const post = async (path: string, body: unknown) => {
      const r = await http(path, body);
      assert.ok(r.status < 300, JSON.stringify(r));
      return r.value;
    };
    const cli = async (...args: string[]) =>
      JSON.parse(
        (
          await exec(process.execPath, ['apps/cli/dist/main.js', ...args], {
            windowsHide: true,
            timeout: 30000,
            env: {
              ...process.env,
              CREATOR_API_URL: origin,
              CREATOR_SESSION_FILE: join(dir, 'session.json'),
            },
          })
        ).stdout,
      );
    await cli('login', LOGIN_CODE);
    const seed = await cli('seed-selection');
    const ws = seed.workspace.id as string,
      specId = seed.spec.id as string;
    const before = await cli('spec', ws, specId);
    const revised = await cli(
      'spec-revise',
      ws,
      specId,
      JSON.stringify({
        expected_version: before.spec.version,
        title: 'Synthetic paired lifecycle fixture',
        content: {
          ...BUILD_FIXTURE_SPEC,
          scope: [
            ...BUILD_FIXTURE_SPEC.scope,
            'TEST ONLY: --hold MARKER spawns a detached signal-ignoring child and waits for cancellation or sandbox deadline',
          ],
        },
        reason:
          'Freeze synthetic lifecycle fault fixture before running it; no empirical product claim',
      }),
    );
    const freezeBody = JSON.stringify({
      spec: { id: specId, version: revised.spec.version },
      justification: 'Synthetic lifecycle fault acceptance',
      data_class: 'synthetic',
    });
    let freeze = await cli('spec-freeze', ws, seed.run, freezeBody);
    if (freeze.status === 'needs_human') {
      const d = await cli('decision', ws, freeze.admission.decision_id);
      await cli(
        'answer',
        ws,
        d.id,
        d.coverage.coverage_hash,
        'approve_once',
        'Synthetic exact-version fixture',
      );
      freeze = await cli('spec-freeze', ws, seed.run, freezeBody);
    }
    assert.equal(freeze.status, 'frozen');
    const ctx = { actorId: DEFAULT_OWNER_ACTOR_ID };
    const status = await api.store!.specStatus(ctx, ws, specId);
    const entity = await api.store!.getEntity(ctx, ws, specId);
    const spec = parse(SpecBodySchema, entity.entity.body);
    const binding = {
      workspace_id: ws,
      owner_id: ctx.actorId,
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
    };
    const ports: BuildPorts = {
      current: async () => ({ binding, spec }),
      assertActive: async () => {},
      authorize: async () => ({ test_port: true }),
      call: async (_run, r) => {
        const value = JSON.parse(buildFixtureAnswer(r.input)!);
        if (r.input[0]!.text.startsWith('builder/2:'))
          value.submission.changes[0].content = source;
        else {
          const packet = JSON.parse(r.input[1]!.text);
          assert.equal(
            packet.files.find((f: any) => f.path === 'src/main.py').content,
            source,
          );
          value.verdict = 'approve';
          value.findings = [];
        }
        return {
          status: 'succeeded',
          reason_code: 'fixture',
          explanation:
            'Synthetic fixed fixture review; not independent human/model review',
          logical_operation_id: r.logical_operation_id,
          attempts: [],
          output: { text: JSON.stringify(value), json: value, vector: null },
          decision_id: null,
          fixture: true,
          replayed: false,
        };
      },
    };
    const product = await products.create(binding);
    const task = await products.createTask(
      product.id,
      'T1',
      product.initial_commit,
      binding,
    );
    const built = await new BuildSupervisor(products, artifacts.executor).run(
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
    assert.equal(built.state, 'verified_candidate', built.reason);
    const pkg = await artifacts.package(product.id, built.id, ports);
    assert.equal(pkg.manifest.state, 'verified');
    const artifact = await post(`workspaces/${ws}/artifacts`, {
      product_id: product.id,
      artifact_id: pkg.manifest.id,
      manifest_sha256: pkg.manifest_sha256,
    });
    // Read /proc through the actual supported infrastructure. Exclude the observer;
    // match the detached child's command, rather than infer startup from DB state.
    const childPresent = async (marker: string) => {
      const script =
        "import os,pathlib,sys; marker=sys.argv[1].encode(); print(any(marker in b and b'paired_child_ready' in b for p in pathlib.Path('/proc').iterdir() if p.name.isdigit() and int(p.name)!=os.getpid() for b in [((p/'cmdline').read_bytes() if (p/'cmdline').exists() else b'')]))";
      const { stdout } = await exec(
        'wsl.exe',
        [
          '--distribution',
          'Ubuntu',
          '--exec',
          '/usr/bin/python3',
          '-I',
          '-c',
          script,
          marker,
        ],
        { windowsHide: true, timeout: 5000 },
      );
      return stdout.trim() === 'True';
    };
    for (const mode of ['revoke', 'crash'] as const)
      await t.test(mode, async () => {
        const worker = spawn(
          process.execPath,
          [
            'apps/desktop/worker.mjs',
            'run',
            ws,
            products.root,
            `Synthetic ${mode}`,
          ],
          {
            windowsHide: true,
            env: { ...process.env, CREATOR_API_URL: origin },
            stdio: ['ignore', 'pipe', 'pipe'],
          },
        );
        let output = '',
          errors = '';
        worker.stdout.on('data', (b) => {
          output = (output + b.toString()).slice(-12000);
        });
        worker.stderr.on('data', (b) => {
          errors = (errors + b.toString()).slice(-4000);
        });
        let job: any;
        try {
          await wait(
            () => /approve\?id=([a-f0-9-]{36})/.test(output),
            'pair challenge',
          );
          await post(
            `desktop/challenges/${output.match(/approve\?id=([a-f0-9-]{36})/)![1]}/approve`,
            {},
          );
          await wait(
            () => /Paired device ([a-f0-9-]{36})/.test(output),
            'worker claim',
          );
          const device = output.match(/Paired device ([a-f0-9-]{36})/)![1]!;
          const marker = `x05-${randomUUID()}`;
          job = await post(`desktop/devices/${device}/jobs`, {
            request_id: randomUUID(),
            artifact_id: artifact.id,
            manifest_sha256: pkg.manifest_sha256,
            input: { args: ['--hold', marker], stdin: '' },
          });
          const jobs = async () =>
            (await http(`desktop/devices/${device}/jobs`)).value as any[];
          await wait(async () => {
            job = (await jobs()).find((j) => j.id === job.id);
            return job.state === 'running';
          }, 'server start');
          await wait(
            () => childPresent(marker),
            'detached child actually running',
          );
          const closed = once(worker, 'close');
          if (mode === 'revoke') {
            await post(`desktop/devices/${device}/control`, {
              state: 'revoked',
            });
            await wait(async () => {
              job = (await jobs()).find((j) => j.id === job.id);
              return job.state === 'cancelled';
            }, 'revocation cancellation');
            assert.equal(job.report.state, 'cancelled');
            assert.match(job.report.stdout, /paired_child_ready/);
            const local = await artifacts.executor.status(
              product.id,
              job.execution_id,
            );
            assert.equal(local.environment.cleanup, 'inactive');
            assert.equal(local.state, 'cancelled');
          } else {
            assert.equal(
              (await http(`desktop/jobs/${job.id}/reconcile`, {})).status,
              409,
            );
            worker.kill('SIGKILL');
            await closed;
            await wait(async () => {
              job = (await jobs()).find((j) => j.id === job.id);
              return job.state === 'reconciling';
            }, 'actual lease expiry');
            assert.equal(job.report, null);
            const denied = await http(`desktop/devices/${device}/jobs`, {
              request_id: randomUUID(),
              artifact_id: artifact.id,
              manifest_sha256: pkg.manifest_sha256,
              input: { args: [], stdin: '' },
            });
            assert.equal(denied.status, 429);
            job = await post(`desktop/jobs/${job.id}/reconcile`, {});
            assert.equal(job.state, 'cancelled');
            assert.match(job.reconciled_outcome_hash, /^[a-f0-9]{64}$/);
            assert.equal(job.report, null);
            const local = await artifacts.executor.status(
              product.id,
              job.execution_id,
            );
            assert.equal(local.state, 'lost');
            assert.equal(local.environment.cleanup, 'inactive');
          }
          await wait(
            async () => !(await childPresent(marker)),
            'detached child absent after stop',
          );
          assert.equal((await jobs()).length, 1, 'no automatic retry');
          const executions = await artifacts.executor.executions(product.id);
          assert.equal(
            executions.filter((e) => e.id === job.execution_id).length,
            1,
          );
          if (mode === 'revoke') {
            await wait(
              () => worker.exitCode !== null,
              `revoked worker exits: ${errors}`,
              25000,
            );
            assert.equal(worker.exitCode, 1);
          }
        } finally {
          if (worker.exitCode === null && worker.signalCode === null) {
            const closed = once(worker, 'close');
            worker.kill('SIGKILL');
            await closed;
          }
          // Faults must not leave uncertain work silently removed with the test directory.
          if (job?.execution_id) {
            await sleep(6000);
            await artifacts.executor.reconcile(
              product.id,
              job.execution_id,
              ctx.actorId,
            );
          }
        }
      });
  },
);
