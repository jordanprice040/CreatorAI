import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type IncomingMessage } from 'node:http';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// P22: the Models and connections "Test connection" sequence, through the real API routes,
// against a loopback OpenAI Responses server: one call, cost settled from the documented price,
// unspent budget returned, grant revoked, run cancelled, and nothing sent without a grant.
async function load<T>(file: string) {
  const source = await readFile(`apps/web/src/${file}`, 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as T;
  new Function('exports', code)(exports);
  return exports;
}
type Mod = {
  CHECK_BUDGET_NANO: string;
  CHECK_RUN_TITLE: string;
  checkRequest: (e: string, p: string, op: string) => unknown;
  checkGrant: (run: string, now: number) => unknown;
  pickPricing: (p: any[], m: string | null) => any;
  pickFunding: (e: any[], now: number) => any;
  describeResult: (r: any) => { kind: string; incurred: string };
};

test('API key connection check: one bounded call, then budget, grant and run are closed', async (t) => {
  const m = await load<Mod>('api-key-check.ts');
  const key = 'sk-test-0123456789abcdefghijklmnop';
  const seen: { auth: string | undefined; body: Record<string, unknown> }[] =
    [];
  const openai = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'resp_check',
          status: 'completed',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'ok' }],
            },
          ],
          usage: { input_tokens: 12, output_tokens: 20, total_tokens: 32 },
        }),
      );
    });
  });
  openai.listen(0, '127.0.0.1');
  await once(openai, 'listening');
  t.after(() => new Promise<void>((r) => openai.close(() => r())));
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_LIVE_PROVIDER: 'openai',
    OPENAI_API_KEY: key,
    CREATOR_OPENAI_BASE_URL: `http://127.0.0.1:${(openai.address() as { port: number }).port}/v1`,
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const call = async (path: string, body?: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers:
        body === undefined
          ? auth.read
          : { 'Content-Type': 'application/json', ...auth.write },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await r.text();
    assert.ok(!text.includes(key), 'the key never appears in a response');
    return { status: r.status, body: JSON.parse(text) as any };
  };

  const status = (await call('broker/status')).body;
  assert.equal(status.live.openai, 'configured_unverified');
  assert.equal(status.live_model_id, 'gpt-6-astra');

  const ws = (await call('workspaces', { name: 'P22', record_mode: 'real' }))
    .body;
  const w = `workspaces/${ws.id}`;
  const priceBody = JSON.parse(
    await readFile('config/pricing/openai-gpt-6-astra.json', 'utf8'),
  );
  assert.equal((await call(`${w}/pricing`, priceBody)).status, 201);
  const parent = await call(`${w}/budgets`, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Owner budget',
    cap_nano_usd: '1000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 4,
  });
  assert.equal(parent.status, 201);
  const price = m.pickPricing((await call(`${w}/pricing`)).body, 'gpt-6-astra');
  const funding = m.pickFunding((await call(`${w}/budgets`)).body, Date.now());
  assert.ok(price && funding);

  // The same steps the panel takes.
  const entity = await call(`${w}/entities`, {
    kind: 'run',
    title: `${m.CHECK_RUN_TITLE} · test`,
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const run = (
    await call(`${w}/runs`, {
      run: { id: entity.body.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    })
  ).body;
  const envelope = (
    await call(`${w}/budgets`, {
      parent_id: funding.id,
      kind: 'run',
      run_id: run.run_id,
      name: m.CHECK_RUN_TITLE,
      cap_nano_usd: m.CHECK_BUDGET_NANO,
      starts_at: null,
      ends_at: null,
      max_in_flight: 1,
    })
  ).body;

  // Without the grant nothing is sent.
  const ungranted = await call(
    `${w}/runs/${run.run_id}/model-calls`,
    m.checkRequest(envelope.id, price.id, crypto.randomUUID()),
  );
  assert.notEqual(ungranted.body.status, 'succeeded');
  assert.equal(seen.length, 0);

  const grant = (
    await call(`${w}/grants`, m.checkGrant(run.run_id, Date.now()))
  ).body;
  const result = await call(
    `${w}/runs/${run.run_id}/model-calls`,
    m.checkRequest(envelope.id, price.id, crypto.randomUUID()),
  );
  assert.equal(result.status, 200, JSON.stringify(result.body));
  const outcome = m.describeResult(result.body);
  assert.equal(outcome.kind, 'connected');
  // 12 input × 10 000 + 20 output × 50 000 nano-USD at the documented price.
  assert.equal(outcome.incurred, '1120000');
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.auth, `Bearer ${key}`);
  assert.equal(seen[0]!.body.model, 'gpt-6-astra');
  assert.equal(seen[0]!.body.max_output_tokens, 256);
  assert.equal(seen[0]!.body.store, false);

  // Clean-up returns the unspent amount and ends the authority.
  const current = (await call(`${w}/budgets/${envelope.id}`)).body;
  const closed = await call(`${w}/budgets/${envelope.id}/close`, {
    expected_version: current.version,
    reason: 'The API key connection check finished.',
  });
  assert.equal(closed.body.status, 'closed');
  const after = (await call(`${w}/budgets/${funding.id}`)).body;
  assert.equal(after.available, String(1_000_000_000 - 1_120_000));
  assert.equal(
    (
      await call(`${w}/grants/${grant.id}/revoke`, {
        expected_version: grant.version,
        reason: 'done',
      })
    ).body.status,
    'revoked',
  );
  assert.equal(
    (await call(`${w}/runs/${run.run_id}/cancel`, { reason: 'done' })).body
      .state,
    'cancelled',
  );
  // A cancelled run sends nothing more.
  const late = await call(
    `${w}/runs/${run.run_id}/model-calls`,
    m.checkRequest(envelope.id, price.id, crypto.randomUUID()),
  );
  assert.notEqual(late.body.status, 'succeeded');
  assert.equal(seen.length, 1);
});
