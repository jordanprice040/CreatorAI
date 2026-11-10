import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { BrokerCallRequestSchema, GrantSchema } from '@creator/contracts';

// P22: the API key "Test connection" choices. The module has no imports, so it loads directly.
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
  pickPricing: (p: any[], m: string | null) => any;
  pickFunding: (e: any[], now: number, need?: string) => any;
  checkBlockers: (s: any) => string[];
  checkRequest: (e: string, p: string, op: string) => unknown;
  checkGrant: (run: string, now: number) => any;
  describeResult: (r: any) => {
    kind: string;
    headline: string;
    incurred: string;
    reserved: string;
  };
  recentChecks: (r: any[], names: Map<string, string>) => any[];
};
const ID = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = Date.parse('2026-11-10T23:00:00Z');

test('pricing must be documented and match the configured model', async () => {
  const m = await load<Mod>('api-key-check.ts');
  const p = (
    id: number,
    model: string,
    basis = 'documented',
    at = '2026-10-20',
  ) => ({
    id: ID(id),
    created_at: at,
    body: {
      provider: basis === 'fixture' ? 'fixture' : 'openai',
      model_id: model,
      basis,
    },
  });
  const list = [
    p(1, 'gpt-6-astra', 'documented', '2026-10-20'),
    p(2, 'gpt-6-astra', 'documented', '2026-10-28'),
    p(3, 'gpt-6-other'),
    p(4, 'gpt-6-astra', 'fixture', '2026-11-01'),
  ];
  assert.equal(m.pickPricing(list, 'gpt-6-astra').id, ID(2));
  assert.equal(m.pickPricing(list, 'gpt-7'), null);
  assert.equal(m.pickPricing(list, null), null);
});

test('funding comes only from an active, run-free budget with room, open now', async () => {
  const m = await load<Mod>('api-key-check.ts');
  const e = (id: number, over: Record<string, unknown>) => ({
    id: ID(id),
    kind: 'global',
    status: 'active',
    run_id: null,
    available: '1000000000',
    starts_at: null,
    ends_at: null,
    created_at: `2026-11-0${id}`,
    ...over,
  });
  const none = m.pickFunding(
    [
      e(1, { status: 'closed' }),
      e(2, { run_id: ID(9), kind: 'run' }),
      e(3, { available: '49999999' }),
      e(4, {
        kind: 'period',
        starts_at: '2026-12-01T00:00:00Z',
        ends_at: '2026-12-31T00:00:00Z',
      }),
    ],
    NOW,
  );
  assert.equal(none, null);
  const pick = m.pickFunding(
    [
      e(1, {}),
      e(2, {
        kind: 'period',
        starts_at: '2026-11-01T00:00:00Z',
        ends_at: '2026-12-01T00:00:00Z',
      }),
      e(3, { available: m.CHECK_BUDGET_NANO }),
    ],
    NOW,
  );
  assert.equal(pick.id, ID(3));
});

test('blockers: owner, fixture and missing key stop everything; price and budget are listed', async () => {
  const m = await load<Mod>('api-key-check.ts');
  const ready = {
    owner: true,
    fixture: false,
    live: 'configured_unverified',
    modelId: 'gpt-6-astra',
    pricing: { id: ID(1) },
    funding: { id: ID(2) },
  };
  assert.deepEqual(m.checkBlockers(ready), []);
  assert.match(m.checkBlockers({ ...ready, owner: false })[0]!, /owner/);
  assert.match(m.checkBlockers({ ...ready, fixture: true })[0]!, /fixture/);
  assert.match(
    m.checkBlockers({ ...ready, live: 'not_configured' })[0]!,
    /OPENAI_API_KEY/,
  );
  assert.equal(
    m.checkBlockers({ ...ready, pricing: null, funding: null }).length,
    2,
  );
});

test('the request and grant are valid, minimal and bounded by the run budget', async () => {
  const m = await load<Mod>('api-key-check.ts');
  const req = BrokerCallRequestSchema.parse(
    m.checkRequest(ID(1), ID(2), ID(3)),
  );
  assert.equal(req.max_attempts, 1);
  assert.equal(req.input.length, 1);
  assert.equal(req.data_class, 'synthetic');
  assert.equal(req.tool, null);
  // Maximum output exposure at the documented $50 per 1M output tokens stays inside the budget.
  assert.ok(
    BigInt(req.max_output_tokens) * 50_000n < BigInt(m.CHECK_BUDGET_NANO),
  );
  const g = m.checkGrant(ID(4), NOW);
  assert.deepEqual(g.action_types, ['model.generate']);
  assert.equal(g.max_amount_nano_usd, m.CHECK_BUDGET_NANO);
  assert.equal(g.allow_external_effects, false);
  assert.equal(g.allow_irreversible, false);
  assert.ok(Date.parse(g.expires_at) - NOW <= 30 * 60_000);
  // The grant body is what the grants route takes (no schema drift).
  assert.ok(GrantSchema.shape.action_types.safeParse(g.action_types).success);
});

test('results read plainly; denied attempts never count as cost', async () => {
  const m = await load<Mod>('api-key-check.ts');
  const att = (
    status: string,
    incurred: string | null,
    reserved = '3000000',
  ) => ({
    provider: 'openai',
    model_id: 'gpt-6-astra',
    status,
    reserved,
    incurred,
    usage: null,
  });
  const ok = m.describeResult({
    status: 'succeeded',
    reason_code: 'ok',
    explanation: '',
    attempts: [att('settled', '420000')],
    output: { text: 'ok' },
  });
  assert.equal(ok.kind, 'connected');
  assert.match(ok.headline, /answered “ok”/);
  assert.equal(ok.incurred, '420000');
  const denied = m.describeResult({
    status: 'denied',
    reason_code: 'runtime_ceiling',
    explanation: 'Over the ceiling.',
    attempts: [att('denied', null, '0')],
    output: null,
  });
  assert.equal(denied.kind, 'not_sent');
  assert.equal(denied.incurred, '0');
  assert.match(denied.headline, /runtime_ceiling/);
  assert.equal(
    m.describeResult({
      status: 'failed',
      reason_code: 'auth_error',
      explanation: 'Invalid key.',
      attempts: [att('released', '0')],
      output: null,
    }).kind,
    'refused',
  );
  const unknown = m.describeResult({
    status: 'unknown',
    reason_code: 'timeout',
    explanation: 'No answer.',
    attempts: [att('unknown', null)],
    output: null,
  });
  assert.equal(unknown.kind, 'unknown');
  assert.match(unknown.headline, /reconcile/);
  assert.equal(
    m.describeResult({
      status: 'succeeded',
      reason_code: 'ok',
      explanation: '',
      attempts: [att('settled', '1')],
      output: { text: '' },
    }).kind,
    'connected',
  );
});

test('earlier checks are the real reservations under check runs, newest first', async () => {
  const m = await load<Mod>('api-key-check.ts');
  const names = new Map([
    [ID(1), `${m.CHECK_RUN_TITLE} · Nov 10`],
    [ID(2), 'Discovery: invoices'],
  ]);
  const r = (id: number, run: number, at: string, fixture = false) => ({
    id: ID(id),
    run_id: ID(run),
    created_at: at,
    fixture,
  });
  const out = m.recentChecks(
    [
      r(10, 1, '2026-11-10T01:00:00Z'),
      r(11, 2, '2026-11-10T02:00:00Z'),
      r(12, 1, '2026-11-10T03:00:00Z'),
      r(13, 1, '2026-11-10T04:00:00Z', true),
    ],
    names,
  );
  assert.deepEqual(
    out.map((x) => x.id),
    [ID(12), ID(10)],
  );
});
