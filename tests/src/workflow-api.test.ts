import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  HealthSchema,
  WorkflowDetailSchema,
  parse,
  type WorkflowDetail,
} from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const exec = promisify(execFile);
async function freePort(): Promise<number> {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const address = s.address();
  await new Promise<void>((resolve) => s.close(() => resolve()));
  assert.ok(address && typeof address !== 'string');
  return address.port;
}
function launch(script: string, env: Record<string, string>) {
  return spawn(process.execPath, [script], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}
async function startApi(env: Record<string, string>): Promise<ChildProcess> {
  const child = launch('apps/api/dist/main.js', env);
  for (let i = 0; i < 100; i++) {
    try {
      const health = parse(
        HealthSchema,
        await (
          await fetch(`http://127.0.0.1:${env.CREATOR_API_PORT}/api/health`)
        ).json(),
      );
      if (health.persistent) return child;
    } catch {
      // not listening yet
    }
    await sleep(100);
  }
  child.kill();
  throw new Error('API process did not become ready');
}
async function kill(child: ChildProcess, signal: NodeJS.Signals = 'SIGTERM') {
  if (child.exitCode !== null || child.signalCode !== null) return;
  child.kill(signal);
  await once(child, 'exit');
}

test('a workflow started over HTTP survives killed worker and API processes', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const port = await freePort();
  const env = {
    CREATOR_DATABASE_URL: db.url,
    CREATOR_API_PORT: String(port),
    CREATOR_WEB_PORT: String(await freePort()),
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  };
  const base = `http://127.0.0.1:${port}/api`;
  let api = await startApi(env);
  const children: ChildProcess[] = [api];
  t.after(() => Promise.all(children.map((c) => kill(c))));
  const auth = await login(base);
  const get = async (path: string) =>
    (await (
      await fetch(`${base}/${path}`, { headers: auth.read })
    ).json()) as any;
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ws = (
    await post('workspaces', { name: 'Runs', record_mode: 'fixture' })
  ).body;
  const pricing = (
    await post(
      `workspaces/${ws.id}/pricing`,
      JSON.parse(readFileSync('config/pricing/fixture-model-v1.json', 'utf8')),
    )
  ).body;
  const idea = (
    await post(`workspaces/${ws.id}/entities`, {
      kind: 'idea',
      title: 'Shared roster',
      body: { summary: 'One roster app.', uncertainty: 'Synthetic.' },
    })
  ).body;
  const runEntity = (
    await post(`workspaces/${ws.id}/entities`, {
      kind: 'run',
      title: 'Review run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    })
  ).body;
  const run = (
    await post(`workspaces/${ws.id}/runs`, {
      run: { id: runEntity.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    })
  ).body;
  await post(`workspaces/${ws.id}/grants`, {
    run_id: run.run_id,
    action_types: ['model.generate', 'model.summarize'],
    target_kind: null,
    max_amount_nano_usd: '100000000',
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    rationale: 'Routine fixture review calls.',
  });
  const envelope = (
    await post(`workspaces/${ws.id}/budgets`, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Owner budget',
      cap_nano_usd: '1000000000',
      starts_at: null,
      ends_at: null,
      max_in_flight: 8,
    })
  ).body;
  const perspectives = ['evidence', 'existing tools', 'maintenance', 'access'];
  const started = await post(
    `workspaces/${ws.id}/runs/${run.run_id}/workflows`,
    {
      role: 'r05_skeptic',
      subject: { id: idea.id, version: 1 },
      constraints: ['Synthetic data only.'],
      perspectives,
      envelope_id: envelope.id,
      pricing_snapshot_id: pricing.id,
      data_class: 'synthetic',
      limits: {
        max_children: 4,
        max_concurrency: 1,
        max_depth: 1,
        max_attempts: 1,
        max_repairs: 0,
        max_calls: 5,
        max_output_tokens: 200,
        call_timeout_ms: 5000,
        max_wall_seconds: 600,
      },
    },
  );
  assert.equal(started.status, 201);
  const id = started.body.workflow.id as string;
  const read = async (): Promise<WorkflowDetail> =>
    parse(
      WorkflowDetailSchema,
      await get(`workspaces/${ws.id}/workflows/${id}`),
    );
  const succeeded = (d: WorkflowDetail) =>
    d.tasks.filter((x) => x.state === 'succeeded').length;

  // A separate worker process makes progress, then is killed without warning.
  const worker = launch('packages/orchestrator/dist/main.js', {
    CREATOR_DATABASE_URL: db.url,
    CREATOR_WORKER_POLL_MS: '400',
  });
  children.push(worker);
  let mid = await read();
  for (let i = 0; i < 100 && succeeded(mid) < 1; i += 1) {
    await sleep(50);
    mid = await read();
  }
  await kill(worker, 'SIGKILL');
  mid = await read();
  assert.ok(succeeded(mid) >= 1, 'a checkpoint was committed');
  assert.notEqual(mid.workflow.state, 'succeeded', 'killed before finishing');
  const doneBefore = succeeded(mid);
  // A killed worker can hold the default 30s lease; recovery must wait for expiry.
  const recoveryDeadline =
    Math.max(
      Date.now(),
      ...mid.tasks.map((task) =>
        task.lease_expires_at ? Date.parse(task.lease_expires_at) : 0,
      ),
    ) + 20_000;

  // The API also restarts, now with its in-process worker on; work continues from the DB.
  await kill(api);
  api = await startApi({
    ...env,
    CREATOR_WORKER: 'on',
    CREATOR_WORKER_POLL_MS: '100',
  });
  children.push(api);
  const auth2 = await login(base);
  let done = mid;
  while (Date.now() < recoveryDeadline && !done.workflow.finished_at) {
    await sleep(100);
    done = parse(
      WorkflowDetailSchema,
      await (
        await fetch(`${base}/workspaces/${ws.id}/workflows/${id}`, {
          headers: auth2.read,
        })
      ).json(),
    );
  }
  assert.equal(done.workflow.state, 'succeeded');
  assert.equal(done.workflow.result?.outcome, 'succeeded');
  assert.equal(
    done.usage.attempts,
    perspectives.length + 1,
    'nothing sent twice',
  );
  assert.ok(succeeded(done) > doneBefore);

  // The CLI reads the same durable state.
  const cliEnv = {
    ...process.env,
    CREATOR_API_URL: `http://127.0.0.1:${port}`,
    CREATOR_SESSION_FILE: join(
      await mkdtemp(join(tmpdir(), 'creator-cli-')),
      's.json',
    ),
  };
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, ['apps/cli/dist/main.js', ...args], {
          env: cliEnv,
          timeout: 15000,
        })
      ).stdout,
    );
  await cli('login', LOGIN_CODE);
  const shown = await cli('workflow', ws.id, id, '--wait');
  assert.equal(shown.workflow.result.outcome, 'succeeded');
  const listed = await cli('workflows', ws.id, run.run_id);
  assert.equal(listed.length, 1);
  const late = await cli(
    'workflow-cancel',
    ws.id,
    id,
    String(done.workflow.version),
    'late',
  ).catch((e: { stdout: string }) => JSON.parse(e.stdout));
  assert.match(late.message, /409/, 'a finished workflow cannot be cancelled');
});
