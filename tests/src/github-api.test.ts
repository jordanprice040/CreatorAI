import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { createHmac } from 'node:crypto';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const exec = promisify(execFile);
const SECRET = 'api-fixture-webhook-secret-0123';

test('X04 API and CLI: connect, verify, create a repository, signed and deduplicated webhooks', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
    CREATOR_GITHUB_HOOK_SECRET: SECRET,
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const post = async (path: string, body: unknown, headers = {}) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth.write,
        ...headers,
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
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
          timeout: 30000,
        })
      ).stdout,
    );
  await cli('login', LOGIN_CODE);
  const ws = (
    await post('workspaces', { name: 'GitHub API', record_mode: 'fixture' })
  ).body.id as string;
  const runEntity = (
    await post(`workspaces/${ws}/entities`, {
      kind: 'run',
      title: 'GitHub run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    })
  ).body;
  const run = (
    await post(`workspaces/${ws}/runs`, {
      run: { id: runEntity.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    })
  ).body.run_id as string;
  await post(`workspaces/${ws}/grants`, {
    run_id: run,
    action_types: ['github.repo_create'],
    target_kind: null,
    max_amount_nano_usd: null,
    allow_irreversible: true,
    allow_external_effects: true,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 86_400_000).toISOString(),
    rationale: 'Create studio repositories in the fixture GitHub.',
  });
  const conn = await cli(
    'github-connect',
    ws,
    JSON.stringify({
      label: 'Fixture GitHub',
      mode: 'fixture',
      owner: { login: 'fixture-owner', id: 4100001, type: 'User' },
      credential: { kind: 'fixture' },
      webhook_secret_env: 'CREATOR_GITHUB_HOOK_SECRET',
      limits: {
        repo_prefix: 'ca-',
        branch_prefix: 'creator/',
        max_repositories: 3,
        max_mutations_per_hour: 20,
        max_open_prs_per_repo: 2,
      },
      required_checks: ['ci'],
      included_repositories: [],
    }),
  );
  assert.equal(conn.status, 'unverified');
  const verified = await cli('github-verify', ws, conn.id);
  assert.equal(verified.connection.status, 'active');
  const request = {
    connection_id: conn.id,
    run_id: run,
    task_id: null,
    data_class: 'synthetic',
    justification: 'Repository for the fixture product.',
    params: {
      kind: 'repo_create',
      name: 'ca-demo',
      description: 'Fixture product',
    },
  };
  const created = await post(`workspaces/${ws}/github-operations`, request, {
    'Idempotency-Key': 'x04-api-create-01',
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.state, 'succeeded');
  // Retrying the same HTTP request returns the journalled operation.
  const retried = await post(`workspaces/${ws}/github-operations`, request, {
    'Idempotency-Key': 'x04-api-create-01',
  });
  assert.equal(retried.body.id, created.body.id);
  const [repo] = await cli('github-repos', ws);
  assert.equal(repo.full_name, 'fixture-owner/ca-demo');
  assert.equal((await cli('github-ops', ws)).length, 1);

  // Webhooks: signature over the raw body; no session or CSRF token involved.
  const deliver = async (body: unknown, delivery: string, secret = SECRET) => {
    const raw = JSON.stringify(body);
    const r = await fetch(`${base}/github/webhooks/${conn.id}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-GitHub-Event': 'repository',
        'X-GitHub-Delivery': delivery,
        'X-Hub-Signature-256': `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
      },
      body: raw,
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const event = { action: 'publicized', repository: { id: repo.github_id } };
  assert.equal((await deliver(event, 'api-1', 'forged')).status, 401);
  assert.equal((await deliver(event, 'api-2')).status, 200);
  assert.equal((await deliver(event, 'api-2')).body.duplicate, true);
  assert.equal((await cli('github-repos', ws))[0].status, 'quarantined');
  const deliveries = await cli('github-deliveries', ws, conn.id);
  assert.deepEqual(
    deliveries.map((d: { status: string }) => d.status),
    ['rejected_signature', 'accepted'],
  );

  // Viewing needs a session; webhooks for unknown connections reveal nothing.
  assert.equal(
    (await fetch(`${base}/workspaces/${ws}/github-operations`)).status,
    401,
  );
  const unknown = await fetch(
    `${base}/github/webhooks/00000000-0000-4000-8000-00000000abcd`,
    {
      method: 'POST',
      body: '{}',
    },
  );
  assert.equal(unknown.status, 404);
});

test('P32 API: GitHub App setup routes list, refuse without live GitHub and check their input', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const ws = (
    await post('workspaces', { name: 'GitHub App', record_mode: 'real' })
  ).body.id as string;
  const list = await fetch(`${base}/workspaces/${ws}/github-app-setups`, {
    headers: auth.read,
  });
  assert.equal(list.status, 200);
  assert.deepEqual(await list.json(), []);
  // Live GitHub is off on this API, so nothing starts and nothing is recorded.
  const begin = await post(`workspaces/${ws}/github-app-setups`, {
    organization: null,
    open_browser: false,
  });
  assert.equal(begin.status, 400);
  assert.equal(begin.body.error.code, 'LIVE_DISABLED');
  const bad = await post(`workspaces/${ws}/github-app-setups`, {
    open_browser: false,
  });
  assert.equal(bad.status, 400);
  const missing = await post(
    `workspaces/${ws}/github-app-setups/00000000-0000-4000-8000-000000000000/abandon`,
    {},
  );
  assert.equal(missing.status, 404);
});
