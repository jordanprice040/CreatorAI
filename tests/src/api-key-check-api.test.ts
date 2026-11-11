import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { createApi } from '@creator/api';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// P22: the Models and connections "Test connection" (runCheck, the code the panel runs) through
// the real API routes against a loopback OpenAI Responses server: the happy path, a call that
// gets no answer in time, a provider 5xx, a failed run registration, and nothing sent without a
// grant or after cancel.
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
type Caller = {
  post: (path: string, body: unknown, timeoutMs?: number) => Promise<any>;
  get: (path: string) => Promise<any>;
};
type CheckRun = {
  outcome: { kind: string; headline: string; incurred: string } | null;
  error: string | null;
  cleanup: { budget: string; grant: string; run: string };
};
type Mod = {
  CHECK_BUDGET_NANO: string;
  CHECK_RUN_TITLE: string;
  checkRequest: (e: string, p: string, op: string) => unknown;
  pickPricing: (p: any[], m: string | null) => any;
  pickFunding: (e: any[], now: number) => any;
  runCheck: (
    c: Caller,
    base: string,
    ids: { pricingId: string; fundingId: string; operationId: string },
    stamp: string,
    now: () => number,
  ) => Promise<CheckRun>;
};

test('API key connection check: runCheck end to end, including no answer, 5xx and a failed registration', async (t) => {
  const m = await load<Mod>('api-key-check.ts');
  const key = 'sk-test-0123456789abcdefghijklmnop';
  type Reply = (res: ServerResponse) => void;
  const ok: Reply = (res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'resp_check',
        status: 'completed',
        output: [
          { type: 'message', content: [{ type: 'output_text', text: 'ok' }] },
        ],
        usage: { input_tokens: 12, output_tokens: 20, total_tokens: 32 },
      }),
    );
  };
  let next: Reply = ok;
  const seen: { auth: string | undefined; body: Record<string, unknown> }[] =
    [];
  const openai = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      seen.push({ auth: req.headers.authorization, body: JSON.parse(raw) });
      next(res);
    });
  });
  openai.listen(0, '127.0.0.1');
  await once(openai, 'listening');
  t.after(() => {
    openai.closeAllConnections();
    return new Promise<void>((r) => openai.close(() => r()));
  });
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
  // Like the panel's `api`: a server answer that is not ok throws { code }; a timeout throws
  // an error without one. `wait` stands in for the browser's own time limit on the call.
  let wait = 20_000;
  const failOn = new Set<string>();
  const caller: Caller = {
    async post(path, body, timeoutMs) {
      if ([...failOn].some((f) => path.endsWith(f)))
        throw Object.assign(new Error('Refused for the test.'), {
          code: 'TEST_REFUSED',
        });
      const r = await fetch(`${base}/${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...auth.write },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs ? wait : 20_000),
      });
      const text = await r.text();
      assert.ok(!text.includes(key), 'the key never appears in a response');
      const json = JSON.parse(text);
      if (!r.ok)
        throw Object.assign(new Error(json.error?.message ?? 'error'), {
          code: json.error?.code ?? 'ERROR',
        });
      return json;
    },
    async get(path) {
      const r = await fetch(`${base}/${path}`, { headers: auth.read });
      return r.json();
    },
  };

  const status = await caller.get('broker/status');
  assert.equal(status.live.openai, 'configured_unverified');
  assert.equal(status.live_model_id, 'gpt-6-astra');
  const ws = await caller.post('workspaces', {
    name: 'P22',
    record_mode: 'real',
  });
  const w = `workspaces/${ws.id}`;
  await caller.post(
    `${w}/pricing`,
    JSON.parse(
      await readFile('config/pricing/openai-gpt-6-astra.json', 'utf8'),
    ),
  );
  await caller.post(`${w}/budgets`, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Owner budget',
    cap_nano_usd: '1000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 4,
  });
  const price = m.pickPricing(await caller.get(`${w}/pricing`), 'gpt-6-astra');
  const funding = m.pickFunding(await caller.get(`${w}/budgets`), Date.now());
  assert.ok(price && funding);
  const check = () =>
    m.runCheck(
      caller,
      w,
      {
        pricingId: price.id,
        fundingId: funding.id,
        operationId: crypto.randomUUID(),
      },
      'test',
      Date.now,
    );
  const available = async () =>
    (await caller.get(`${w}/budgets/${funding.id}`)).available as string;
  const runs = async () =>
    (await caller.get(`${w}/runs`)) as { run_id: string; state: string }[];
  const grants = async () =>
    (await caller.get(`${w}/grants`)) as { status: string }[];

  // 1. Happy path: one call, charged from the documented price, everything closed after.
  const first = await check();
  assert.equal(first.error, null);
  assert.equal(first.outcome?.kind, 'connected');
  // 12 input × 10 000 + 20 output × 50 000 nano-USD.
  assert.equal(first.outcome?.incurred, '1120000');
  assert.deepEqual(first.cleanup, {
    budget: 'closed',
    grant: 'revoked',
    run: 'cancelled',
  });
  assert.equal(await available(), String(1_000_000_000 - 1_120_000));
  assert.equal(seen.length, 1);
  assert.equal(seen[0]!.auth, `Bearer ${key}`);
  assert.equal(seen[0]!.body.model, 'gpt-6-astra');
  assert.equal(seen[0]!.body.max_output_tokens, 256);
  assert.equal(seen[0]!.body.store, false);
  assert.ok((await grants()).every((g) => g.status !== 'active'));
  assert.ok((await runs()).every((r) => r.state === 'cancelled'));

  // 2. Provider 5xx: the server answers with an unknown outcome; its budget is kept open.
  next = (res) => {
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end('{"error":{"message":"server error"}}');
  };
  const five = await check();
  assert.equal(five.outcome?.kind, 'unknown');
  assert.match(five.outcome!.headline, /reconcile/);
  assert.equal(five.cleanup.grant, 'revoked');
  assert.equal(five.cleanup.run, 'cancelled');
  assert.equal(seen.length, 2);
  // While it is unknown, the next check is refused before anything is sent.
  const blocked = await check();
  assert.equal(blocked.outcome?.kind, 'not_sent');
  assert.equal(seen.length, 2);
  // The owner reconciles it from the provider's records; paid dispatch is open again.
  const unsettled = (
    (await caller.get(`${w}/reservations`)) as { id: string; status: string }[]
  ).filter((r) => r.status === 'unknown');
  assert.equal(unsettled.length, 1);
  await caller.post(`${w}/reservations/${unsettled[0]!.id}/reconcile`, {
    outcome: 'no_charge',
    evidence: 'Owner checked for a charge and found none: test provider log',
  });

  // 3. No answer in time (L-3): the provider hangs past the browser's wait. The panel says
  // the outcome is unknown and to reconcile, still revokes the grant and cancels the run,
  // and the budget holding the unsettled reservation is not closed.
  next = () => {};
  wait = 1_500;
  const hung = await check();
  wait = 20_000;
  assert.equal(hung.error, null);
  assert.equal(hung.outcome?.kind, 'unknown');
  assert.match(hung.outcome!.headline, /may have been sent and charged/);
  assert.equal(hung.cleanup.budget, 'kept_open');
  assert.equal(hung.cleanup.grant, 'revoked');
  assert.equal(hung.cleanup.run, 'cancelled');
  assert.equal(seen.length, 3);
  const open = ((await caller.get(`${w}/budgets`)) as any[]).filter(
    (e) => e.kind === 'run' && e.status === 'active',
  );
  assert.ok(open.length >= 1, 'an unsettled check keeps its run budget');
  assert.ok((await grants()).every((g) => g.status !== 'active'));

  // 4. Registration refused (L-4): the queued run record is archived, nothing else is made.
  next = ok;
  failOn.add('/runs');
  const before = (await runs()).length;
  const refused = await check();
  failOn.clear();
  assert.match(refused.error ?? '', /Refused for the test/);
  assert.equal(refused.outcome, null);
  assert.deepEqual(refused.cleanup, {
    budget: 'none',
    grant: 'none',
    run: 'archived',
  });
  assert.equal((await runs()).length, before);
  assert.equal(seen.length, 3);

  // 5. Without a grant, or after cancel, nothing is sent.
  const entity = await caller.post(`${w}/entities`, {
    kind: 'run',
    title: 'no grant',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const run = await caller.post(`${w}/runs`, {
    run: { id: entity.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
  });
  const env = await caller.post(`${w}/budgets`, {
    parent_id: funding.id,
    kind: 'run',
    run_id: run.run_id,
    name: 'no grant',
    cap_nano_usd: m.CHECK_BUDGET_NANO,
    starts_at: null,
    ends_at: null,
    max_in_flight: 1,
  });
  const ungranted = await caller.post(
    `${w}/runs/${run.run_id}/model-calls`,
    m.checkRequest(env.id, price.id, crypto.randomUUID()),
  );
  assert.notEqual(ungranted.status, 'succeeded');
  await caller.post(`${w}/runs/${run.run_id}/cancel`, { reason: 'done' });
  const late = await caller.post(
    `${w}/runs/${run.run_id}/model-calls`,
    m.checkRequest(env.id, price.id, crypto.randomUUID()),
  );
  assert.notEqual(late.status, 'succeeded');
  assert.equal(seen.length, 3);
});
