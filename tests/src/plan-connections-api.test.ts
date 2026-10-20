import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createApi } from '@creator/api';
import { MemoryVault, PlanConnectionService } from '@creator/broker';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { fakePlan } from './plan-fakes.js';

const exec = promisify(execFile);

test('plan connection API and CLI: create, block, sign in, confirm credits, accept caps, verify once', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const fake = await fakePlan();
  t.after(() => fake.close());
  let opened = '';
  const api = createApi(
    {
      CREATOR_DATABASE_URL: db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
      CREATOR_WORKER: 'off',
    },
    {
      planService: (store) =>
        new PlanConnectionService({
          store,
          vault: new MemoryVault(),
          fixtureEndpoints: {
            auth_base: fake.auth_base,
            api_base: fake.api_base,
          },
          openBrowser: (url) => (opened = url),
          callbackPort: 0,
        }),
    },
  );
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
  const get = async (path: string) =>
    (await (
      await fetch(`${base}/${path}`, { headers: auth.read })
    ).json()) as any;
  const cliEnv = {
    ...process.env,
    CREATOR_API_URL: `http://127.0.0.1:${port}`,
    CREATOR_SESSION_FILE: join(
      await mkdtemp(join(tmpdir(), 'creator-cli-')),
      's.json',
    ),
  };
  const cli = async (...args: string[]) => {
    try {
      return JSON.parse(
        (
          await exec(process.execPath, ['apps/cli/dist/main.js', ...args], {
            env: cliEnv,
            timeout: 30000,
          })
        ).stdout,
      );
    } catch (e) {
      throw new Error(
        `${args[0]}: ${(e as { stdout?: string }).stdout ?? ''} ${(e as { stderr?: string }).stderr ?? String(e)}`,
      );
    }
  };
  await cli('login', LOGIN_CODE);
  const ws = (
    await post('workspaces', { name: 'Plan API', record_mode: 'fixture' })
  ).body.id as string;
  const conn = await cli('plan-connect', ws, 'ChatGPT plan');
  assert.equal(conn.sign_in.state, 'not_signed_in');
  let detail = await get(`workspaces/${ws}/plan-connections/${conn.id}`);
  assert.ok(detail.blockers.length >= 3);
  // A paraphrased credits statement is not an attestation.
  const wrong = await post(
    `workspaces/${ws}/plan-connections/${conn.id}/credits`,
    {
      expected_version: 1,
      statement: 'credits are off',
      checked_on: '2026-10-20',
    },
  );
  assert.equal(wrong.status, 400);
  await post(`workspaces/${ws}/plan-connections/${conn.id}/sign-in`, {
    open_browser: true,
  });
  assert.ok(opened.startsWith(`${fake.auth_base}/api/accounts/authorize?`));
  assert.equal(await fake.approve(opened), 200);
  for (
    let i = 0;
    i < 100 && detail.connection.sign_in.state !== 'signed_in';
    i++
  ) {
    await new Promise((r) => setTimeout(r, 30));
    detail = await get(`workspaces/${ws}/plan-connections/${conn.id}`);
  }
  assert.equal(detail.connection.sign_in.state, 'signed_in');
  await cli(
    'plan-credits-off',
    ws,
    conn.id,
    String(detail.connection.version),
    '2026-10-20',
  );
  detail = await get(`workspaces/${ws}/plan-connections/${conn.id}`);
  await cli(
    'plan-accept-caps',
    ws,
    conn.id,
    String(detail.connection.version),
    detail.connection.settings_hash,
  );
  detail = await get(`workspaces/${ws}/plan-connections/${conn.id}`);
  assert.deepEqual(detail.blockers, []);
  const grant = await cli(
    'plan-verify-approve',
    ws,
    conn.id,
    String(detail.connection.version),
    'fixture-plan-model',
  );
  const verified = await cli(
    'plan-verify',
    ws,
    conn.id,
    grant.id,
    'fixture-plan-model',
  );
  assert.equal(verified.verified, true);
  assert.equal(fake.responseRequests.length, 1);
  const again = await post(
    `workspaces/${ws}/plan-connections/${conn.id}/verify`,
    { grant_id: grant.id, model_id: 'fixture-plan-model' },
  );
  assert.equal(again.status, 403);
  assert.equal(
    fake.responseRequests.length,
    1,
    'a used approval sends nothing',
  );
  // Without the pinned Codex CLI configured, the Codex builder route refuses before any request.
  const codex = await post(
    `workspaces/${ws}/plan-connections/${conn.id}/codex-builds`,
    {
      build_id: crypto.randomUUID(),
      run_id: crypto.randomUUID(),
      model_id: 'fixture-plan-model',
      data_class: 'synthetic',
      packet: {
        candidate: 'a'.repeat(40),
        files: [],
        task: { file_scope: ['src'] },
      },
    },
  );
  assert.equal(codex.body.code ?? codex.body.error?.code, 'INVALID_CONFIG');
  const requests = await cli('plan-requests', ws, conn.id);
  assert.deepEqual(
    requests.map((r: { state: string; purpose: string }) => [
      r.purpose,
      r.state,
    ]),
    [['verification', 'completed']],
  );
});
