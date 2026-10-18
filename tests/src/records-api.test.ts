import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFile, type ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { promisify } from 'node:util';
import { createApi } from '@creator/api';
import {
  parse,
  HealthSchema,
  EntityDetailSchema,
  HistoryEntrySchema,
  StoredEntitySchema,
  WorkspaceSchema,
  z,
} from '@creator/contracts';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
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
async function startApi(env: Record<string, string>): Promise<ChildProcess> {
  const child = spawn(process.execPath, ['apps/api/dist/main.js'], {
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const base = `http://127.0.0.1:${env.CREATOR_API_PORT}`;
  for (let i = 0; i < 100; i++) {
    try {
      const health = parse(
        HealthSchema,
        await (await fetch(`${base}/api/health`)).json(),
      );
      // Persistence reports ready only after the schema check passed.
      if (health.persistent) return child;
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  child.kill();
  throw new Error('API process did not become ready');
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill('SIGTERM');
  await once(child, 'exit');
}

test('records survive a real API process restart; HTTP enforces versions, scope and idempotency', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const port = await freePort();
  const env = {
    CREATOR_DATABASE_URL: db.url,
    CREATOR_API_PORT: String(port),
    CREATOR_WEB_PORT: String(await freePort()),
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
  };
  const base = `http://127.0.0.1:${port}/api`;
  let api = await startApi(env);
  t.after(() => stop(api));
  const auth = await login(base);
  const fetch = (url: string) => globalThis.fetch(url, { headers: auth.read });
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    globalThis.fetch(`${base}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth.write,
        ...headers,
      },
      body: JSON.stringify(body),
    });

  const ws = parse(
    WorkspaceSchema,
    await (
      await post('workspaces', { name: 'HTTP', record_mode: 'fixture' })
    ).json(),
  );
  const other = parse(
    WorkspaceSchema,
    await (
      await post('workspaces', { name: 'Other', record_mode: 'fixture' })
    ).json(),
  );
  const idea = { summary: 'Shared roster', uncertainty: 'Synthetic' };
  const key = { 'Idempotency-Key': 'http-create-idea-1' };
  const created = await post(
    `workspaces/${ws.id}/entities`,
    { kind: 'idea', title: 'Roster', body: idea },
    key,
  );
  assert.equal(created.status, 201);
  const ideaRecord = parse(StoredEntitySchema, await created.json());
  const replay = parse(
    StoredEntitySchema,
    await (
      await post(
        `workspaces/${ws.id}/entities`,
        { kind: 'idea', title: 'Roster', body: idea },
        key,
      )
    ).json(),
  );
  assert.equal(replay.id, ideaRecord.id);
  const changedKey = await post(
    `workspaces/${ws.id}/entities`,
    { kind: 'idea', title: 'Other', body: idea },
    key,
  );
  assert.equal(changedKey.status, 409);
  const revise = (expected: number, summary: string) =>
    post(`workspaces/${ws.id}/entities/${ideaRecord.id}/revisions`, {
      expected_version: expected,
      title: 'Roster',
      body: { ...idea, summary },
      reason: 'Edit',
      corrects_version: null,
    });
  assert.equal((await revise(1, 'Roster with owners')).status, 200);
  const stale = await revise(1, 'Stale');
  assert.equal(stale.status, 409);
  assert.equal((await stale.json()).error.code, 'VERSION_CONFLICT');
  const foreign = parse(
    StoredEntitySchema,
    await (
      await post(`workspaces/${other.id}/entities`, {
        kind: 'product',
        title: 'Foreign',
        body: { stage: 'captured', summary: 'Other workspace' },
      })
    ).json(),
  );
  const cross = await post(`workspaces/${other.id}/links`, {
    relation: 'derived_from',
    from: { id: foreign.id, version: 1 },
    to: { id: ideaRecord.id, version: 2 },
    rationale: 'cross',
  });
  assert.equal(cross.status, 403);
  assert.equal((await cross.json()).error.code, 'SCOPE_EXCEEDED');
  const unknownWs = await fetch(
    `${base}/workspaces/${crypto.randomUUID()}/entities`,
  );
  assert.equal(unknownWs.status, 404);
  const correlation = crypto.randomUUID();
  const product = parse(
    StoredEntitySchema,
    await (
      await post(
        `workspaces/${ws.id}/entities`,
        {
          kind: 'product',
          title: 'Roster app',
          body: { stage: 'captured', summary: 'From the roster idea' },
        },
        { 'X-Correlation-Id': correlation },
      )
    ).json(),
  );
  assert.equal(
    (
      await post(`workspaces/${ws.id}/links`, {
        relation: 'derived_from',
        from: { id: product.id, version: 1 },
        to: { id: ideaRecord.id, version: 2 },
        rationale: 'Built from v2',
      })
    ).status,
    201,
  );
  const historyBefore = z
    .array(HistoryEntrySchema)
    .parse(await (await fetch(`${base}/workspaces/${ws.id}/history`)).json());

  await stop(api);
  api = await startApi(env);

  const detail = parse(
    EntityDetailSchema,
    await (
      await fetch(`${base}/workspaces/${ws.id}/entities/${ideaRecord.id}`)
    ).json(),
  );
  assert.equal(detail.entity.version, 2);
  assert.equal(detail.versions.length, 2);
  assert.equal(detail.incoming[0]?.from.id, product.id);
  assert.equal(detail.incoming[0]?.to.version, 2);
  const historyAfter = z
    .array(HistoryEntrySchema)
    .parse(await (await fetch(`${base}/workspaces/${ws.id}/history`)).json());
  assert.deepEqual(historyAfter, historyBefore);
  assert.ok(
    historyAfter.some(
      (h) => h.subject_id === product.id && h.correlation_id === correlation,
    ),
  );
  const lineage = await (
    await fetch(
      `${base}/workspaces/${ws.id}/entities/${product.id}/lineage?direction=upstream`,
    )
  ).json();
  assert.equal(lineage[0].link.to.id, ideaRecord.id);

  const cliEnv = {
    ...process.env,
    CREATOR_API_URL: `http://127.0.0.1:${port}`,
    CREATOR_SESSION_FILE: join(
      await mkdtemp(join(tmpdir(), 'creator-cli-')),
      'session.json',
    ),
  };
  await exec(process.execPath, ['apps/cli/dist/main.js', 'login', LOGIN_CODE], {
    env: cliEnv,
    timeout: 10000,
  });
  const cli = await exec(
    process.execPath,
    ['apps/cli/dist/main.js', 'seed-lineage'],
    { env: cliEnv, timeout: 20000 },
  );
  const seeded = JSON.parse(cli.stdout);
  const idea2 = await exec(
    process.execPath,
    [
      'apps/cli/dist/main.js',
      'lineage',
      seeded.workspace.id,
      seeded.idea_with_two_descendants,
      'downstream',
    ],
    { env: cliEnv, timeout: 10000 },
  );
  assert.equal(JSON.parse(idea2.stdout).length, 2);
  const product2 = await exec(
    process.execPath,
    [
      'apps/cli/dist/main.js',
      'show',
      seeded.workspace.id,
      seeded.product_from_two_ideas,
    ],
    { env: cliEnv, timeout: 10000 },
  );
  assert.equal(JSON.parse(product2.stdout).outgoing.length, 2);
  const cliRun = (...args: string[]) =>
    exec(process.execPath, ['apps/cli/dist/main.js', ...args], {
      env: cliEnv,
      timeout: 10000,
    });
  assert.equal(JSON.parse((await cliRun('whoami')).stdout).method, 'dev_local');
  assert.deepEqual(
    JSON.parse((await cliRun('decisions', seeded.workspace.id)).stdout),
    [],
  );
  await cliRun('logout');
  await assert.rejects(cliRun('whoami'));
});

test('without a database the records API reports unavailable instead of pretending to persist', async (t) => {
  const { server, close } = createApi();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(close);
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}/api`;
  const health = parse(
    HealthSchema,
    await (await fetch(`${base}/health`)).json(),
  );
  assert.equal(health.persistent, false);
  assert.equal(health.storage, 'not_configured');
  const records = await fetch(`${base}/workspaces`);
  assert.equal(records.status, 503);
  assert.equal((await records.json()).error.code, 'STORAGE_UNAVAILABLE');
});
