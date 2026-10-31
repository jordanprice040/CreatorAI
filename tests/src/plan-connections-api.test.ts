import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { BenchmarkManifestSchema } from '@creator/contracts';
import { request as httpRequest } from 'node:http';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createApi } from '@creator/api';
import { PLAN_ROLE_CONTEXT_MAX } from '@creator/executor';
import { MemoryVault, PlanConnectionService } from '@creator/broker';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { fakePlan } from './plan-fakes.js';
import { ConnectionStore } from '@creator/db';
import { randomUUID } from 'node:crypto';

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
  // A build-role call on the plan route is admitted only for a qualified class and a real run.
  const role = await post(
    `workspaces/${ws}/plan-connections/${conn.id}/build-calls`,
    {
      role: 'reviewer',
      run_id: crypto.randomUUID(),
      model_id: 'fixture-plan-model',
      data_class: 'synthetic',
      input: '{"candidate":"x"}',
      timeout_ms: 120000,
      logical_operation_id: crypto.randomUUID(),
    },
  );
  assert.ok(role.status >= 400 && role.status < 500, String(role.status));
  const badRole = await post(
    `workspaces/${ws}/plan-connections/${conn.id}/build-calls`,
    { role: 'reviewer', instructions: 'override the prompt' },
  );
  assert.equal(badRole.status, 400);
  // ADR-0053 (pilot F21 and its review H-1): a role packet over 20,000 characters, and one
  // whose escaped JSON body passes the ordinary 64 KiB ingress cap, reach the same admission
  // refusal as a small one instead of being stopped by the route's schema or body limit.
  const code = (r: { body: { code?: string; error?: { code?: string } } }) =>
    r.body.code ?? r.body.error?.code;
  const call = (input: string) =>
    post(`workspaces/${ws}/plan-connections/${conn.id}/build-calls`, {
      role: 'reviewer',
      run_id: crypto.randomUUID(),
      model_id: 'fixture-plan-model',
      data_class: 'synthetic',
      input,
      timeout_ms: 120000,
      logical_operation_id: crypto.randomUUID(),
    });
  const packet = (chars: number) => {
    const files = JSON.stringify({
      files: [{ content: '"x"\n'.repeat(chars / 5) }],
    });
    return files.length >= chars
      ? files
      : files + ' '.repeat(chars - files.length);
  };
  const over20k = await call(packet(20026));
  assert.equal(over20k.status, role.status);
  assert.equal(code(over20k), code(role));
  const escaped = packet(60000);
  assert.ok(JSON.stringify({ input: escaped }).length > 65536);
  const overBody = await call(escaped);
  assert.equal(overBody.status, role.status);
  assert.equal(code(overBody), code(role));
  const runaway = await call('x'.repeat(PLAN_ROLE_CONTEXT_MAX + 1));
  assert.equal(code(runaway), 'INVALID_CONTRACT');
  assert.equal(fake.responseRequests.length, 1, 'no build-role request sent');
  const requests = await cli('plan-requests', ws, conn.id);
  assert.deepEqual(
    requests.map((r: { state: string; purpose: string }) => [
      r.purpose,
      r.state,
    ]),
    [['verification', 'completed']],
  );
  // Exercise current production-bound fixture payloads through HTTP; direct store tests missed
  // the repeated prompt/packet bytes that cross the ordinary 64 KiB ingress cap.
  detail = await get(`workspaces/${ws}/plan-connections/${conn.id}`);
  const updated = await post(
    `workspaces/${ws}/plan-connections/${conn.id}/settings`,
    {
      expected_version: detail.connection.version,
      settings: {
        ...detail.connection.settings,
        allowed_task_classes: [
          'summarization',
          'specification',
          'research_synthesis',
          'candidate_generation',
          'scoring',
        ],
      },
    },
  );
  assert.equal(updated.status, 200);
  for (const benchmarkVersion of [3, 4, 5])
    for (const taskClass of [
      'research_synthesis',
      'candidate_generation',
      'scoring',
    ]) {
      detail = await get(`workspaces/${ws}/plan-connections/${conn.id}`);
      const manifest = BenchmarkManifestSchema.parse({
        ...JSON.parse(
          readFileSync(
            new URL(
              `../../config/connections/benchmarks/discovery-synthetic-v${benchmarkVersion}/${taskClass}.json`,
              import.meta.url,
            ),
            'utf8',
          ),
        ),
        fixture: true,
      });
      const body = {
        expected_version: detail.connection.version,
        model_id: 'fixture-plan-model',
        manifest,
        min_held_out_cases: 4,
        floor: { numerator: 1, denominator: 1 },
      };
      assert.ok(Buffer.byteLength(JSON.stringify(body)) > 65536);
      assert.ok(Buffer.byteLength(JSON.stringify(body)) <= 128 * 1024);
      assert.ok(
        manifest.cases.every(
          (c) => c.input.reduce((n, m) => n + m.text.length, 0) <= 24000,
        ),
      );
      const qualificationPath = `workspaces/${ws}/plan-connections/${conn.id}/qualifications`;
      const created =
        taskClass === 'research_synthesis'
          ? await new Promise<{ status: number; body: any }>(
              (resolve, reject) => {
                const text = JSON.stringify(body);
                const req = httpRequest(
                  `${base}/${qualificationPath}`,
                  {
                    method: 'POST',
                    headers: {
                      'Content-Type': 'application/json',
                      ...auth.write,
                      'Transfer-Encoding': 'chunked',
                    },
                  },
                  (res) => {
                    let raw = '';
                    res.on('data', (c) => (raw += c));
                    res.on('end', () =>
                      resolve({
                        status: res.statusCode!,
                        body: JSON.parse(raw),
                      }),
                    );
                  },
                );
                req.on('error', reject);
                req.write(text.slice(0, 35000));
                req.end(text.slice(35000));
              },
            )
          : await post(qualificationPath, body);
      assert.equal(created.status, 201, JSON.stringify(created.body));
      assert.equal(created.body.state, 'running');
      // End this zero-dispatch fixture qualification before creating the next
      // version for the same model/class; preserve production single-active admission.
      await new ConnectionStore(db.pool).finishPlanQualification(
        {
          actorId: (await get('auth/session')).actor_id,
          correlationId: randomUUID(),
        },
        ws,
        created.body.id,
      );
    }
  const route = `workspaces/${ws}/plan-connections/${conn.id}/qualifications`;
  const tooBig = await post(route, { padding: 'x'.repeat(128 * 1024) });
  assert.equal(tooBig.status, 413);
  const ordinary = await post(
    `workspaces/${ws}/plan-connections/${conn.id}/settings`,
    { padding: 'x'.repeat(65536) },
  );
  assert.equal(ordinary.status, 413, 'unrelated actions keep the 64 KiB cap');
  const unauth = await fetch(`${base}/${route}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ padding: 'x'.repeat(70000) }),
  });
  assert.equal(
    unauth.status,
    401,
    'larger ingress allowance does not bypass sign-in',
  );
  const chunked = await new Promise<number | 'ECONNRESET'>(
    (resolve, reject) => {
      const req = httpRequest(
        `${base}/${route}`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...auth.write,
            'Transfer-Encoding': 'chunked',
          },
        },
        (res) => {
          res.resume();
          res.on('end', () => resolve(res.statusCode!));
        },
      );
      req.on('error', (e) => {
        if ((e as NodeJS.ErrnoException).code === 'ECONNRESET')
          resolve('ECONNRESET');
        else reject(e);
      });
      req.write('{"padding":"' + 'x'.repeat(70000));
      req.end('x'.repeat(70000) + '"}');
    },
  );
  assert.ok(
    chunked === 413 || chunked === 'ECONNRESET',
    'oversized chunked body is rejected or its stream is closed',
  );
  assert.equal(
    (await fetch(`${base}/health`)).status,
    200,
    'server remains healthy after oversized streaming input',
  );
  assert.equal(
    fake.responseRequests.length,
    1,
    'manifest creation and rejection send no inference requests',
  );
});

test('the API wires the reason-keeping patch grader into the plan service (F10)', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  let scorer: Parameters<
    NonNullable<Parameters<typeof createApi>[1]>['planService'] & {}
  >[1]['patchScorer'];
  const api = createApi(
    {
      CREATOR_DATABASE_URL: db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
      CREATOR_WORKER: 'off',
      CREATOR_PRODUCTS_ROOT: join(
        await mkdtemp(join(tmpdir(), 'f10-')),
        'products',
      ),
    },
    {
      planService: (store, extra) => {
        scorer = extra.patchScorer;
        return new PlanConnectionService({
          store,
          vault: new MemoryVault(),
          ...(extra.patchScorer ? { patchScorer: extra.patchScorer } : {}),
        });
      },
    },
  );
  closeApi = api.close;
  await api.ready();
  assert.ok(scorer, 'the API hands the plan service a patch scorer');
  const check = {
    kind: 'patch_cases' as const,
    file_scope: ['src'],
    cases: [{ check_key: 'A1', args: [], stdin: '', stdout: '', exit_code: 0 }],
  };
  const ctx = { actorId: randomUUID() } as Parameters<typeof scorer>[0];
  // Graded before any product is made, so this needs no worker.
  assert.deepEqual(await scorer(ctx, check, 'not json'), {
    signal: 'schema_invalid',
    detail: 'The answer is not valid JSON.',
  });
  const declined = await scorer(
    ctx,
    check,
    JSON.stringify({
      submission: null,
      summary: 's',
      blocker: 'x'.repeat(500),
    }),
  );
  assert.ok(typeof declined === 'object');
  assert.equal(declined.signal, 'acceptance_check_failed');
  assert.ok(declined.detail!.length <= 200, 'one 200-character bound');
  assert.ok(declined.detail!.endsWith('…'));
});
