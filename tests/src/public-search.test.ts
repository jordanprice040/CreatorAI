import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { createApi } from '@creator/api';
import {
  BraveSearchAdapter,
  BRAVE_SEARCH_ID,
  publicSearchFromEnv,
  type AdapterRequest,
} from '@creator/broker';
import { FIXTURE_SOURCE_POLICY } from '@creator/research';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const policy = {
  ...FIXTURE_SOURCE_POLICY,
  protocols: ['https' as const],
  hosts: [{ host: 'www.nist.gov', retention: 'excerpts' as const }],
};
const request: AdapterRequest = {
  action: 'tool.search_public',
  model_id: BRAVE_SEARCH_ID,
  input: [
    {
      role: 'user',
      text: JSON.stringify({ query: 'CSV quality', domains: ['www.nist.gov'] }),
    },
  ],
  max_output_tokens: 1,
  output_format: 'json',
  tool: 'search_public',
};
const result = {
  title: 'Quality',
  url: 'https://www.nist.gov/quality',
  description: 'Untrusted snippet',
};

test('public search: exact approved results, provenance, no snippet promotion and no credential redirect', async () => {
  let calls = 0;
  const adapter = new BraveSearchAdapter(
    'private-test-key',
    policy,
    async (url, init) => {
      calls++;
      assert.equal(new URL(String(url)).origin, 'https://api.search.brave.com');
      assert.equal(new URL(String(url)).searchParams.get('count'), '10');
      assert.equal(init?.redirect, 'manual');
      assert.equal(
        (init?.headers as Record<string, string>)['X-Subscription-Token'],
        'private-test-key',
      );
      return Response.json({
        web: {
          results: [
            result,
            { ...result, url: 'https://www.nist.gov.evil.example/x' },
            { ...result, url: 'http://127.0.0.1/x' },
            { ...result, url: 'https://user:pass@www.nist.gov/x' },
          ],
        },
      });
    },
  );
  const out = await adapter.call(request, new AbortController().signal);
  assert.equal(out.kind, 'completed');
  if (out.kind !== 'completed') return;
  const body = JSON.parse(out.text);
  assert.equal(body.results.length, 1);
  assert.equal(body.results[0].evidence_status, 'unverified_search_snippet');
  assert.equal(body.query, 'CSV quality');
  assert.match(body.response_hash, /^[a-f0-9]{64}$/);
  assert.match(body.policy_hash, /^[a-f0-9]{64}$/);
  assert.ok(Date.parse(body.retrieved_at));
  assert.deepEqual(out.usage.tool_calls, { search_public: 1 });
  assert.equal(JSON.stringify(adapter).includes('private-test-key'), false);
  const blocked = await adapter.call(
    {
      ...request,
      input: [
        {
          role: 'user',
          text: JSON.stringify({ query: 'x', domains: ['evil.example'] }),
        },
      ],
    },
    new AbortController().signal,
  );
  assert.equal(blocked.kind, 'rejected');
  assert.equal(calls, 1);
});

test('public search: rate limits, redirects, malformed, oversized and interrupted outcomes stay uncertain', async () => {
  for (const response of [
    new Response('', { status: 429 }),
    new Response('', {
      status: 302,
      headers: { Location: 'https://evil.example' },
    }),
    Response.json({ web: {} }),
    new Response('x'.repeat(1_000_001)),
  ]) {
    const adapter = new BraveSearchAdapter(
      'test-key',
      policy,
      async () => response,
    );
    assert.equal(
      (await adapter.call(request, new AbortController().signal)).kind,
      'unknown',
    );
  }
  const controller = new AbortController();
  const adapter = new BraveSearchAdapter(
    'test-key',
    policy,
    async (_u, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener(
          'abort',
          () => reject(new Error('aborted')),
          { once: true },
        );
      }),
  );
  const pending = adapter.call(request, controller.signal);
  controller.abort();
  assert.equal((await pending).kind, 'unknown');
  assert.equal(publicSearchFromEnv({}, null), null);
  assert.throws(() =>
    publicSearchFromEnv({ CREATOR_PUBLIC_SEARCH: 'brave' }, null),
  );
});

test('source-search HTTP route uses durable grants/budgets and idempotency; migration accepts Brave pricing', async (t) => {
  let close = async () => {};
  t.after(() => close());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  close = api.close;
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { ...auth.write, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const value = (await r.json()) as any;
    assert.ok(r.ok, JSON.stringify(value));
    return value;
  };
  const ws = await post('workspaces', {
    name: 'Search contract',
    record_mode: 'fixture',
  });
  const prefix = `workspaces/${ws.id}`;
  const price = await post(
    `${prefix}/pricing`,
    JSON.parse(readFileSync('config/pricing/fixture-model-v1.json', 'utf8')),
  );
  const entity = await post(`${prefix}/entities`, {
    kind: 'run',
    title: 'Search',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const run = await post(`${prefix}/runs`, {
    run: { id: entity.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
  });
  const envelope = await post(`${prefix}/budgets`, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Search',
    cap_nano_usd: '20000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 1,
  });
  const body = {
    envelope_id: envelope.id,
    action_type: 'tool.search_public',
    task_id: null,
    logical_operation_id: randomUUID(),
    pricing_snapshot_id: price.id,
    data_class: 'synthetic',
    input: request.input,
    max_output_tokens: 1,
    output_format: 'json',
    tool: 'search_public',
    max_attempts: 1,
    timeout_ms: 1000,
    justification: 'Synthetic search contract.',
  };
  const path = `${prefix}/runs/${run.run_id}/source-searches`;
  assert.equal((await post(path, body)).status, 'needs_human');
  await post(`${prefix}/grants`, {
    run_id: run.run_id,
    action_types: ['tool.search_public'],
    target_kind: null,
    max_amount_nano_usd: '20000000',
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 3600000).toISOString(),
    rationale: 'Fixture search only.',
  });
  body.logical_operation_id = randomUUID();
  const out = await post(path, body);
  assert.equal(out.status, 'succeeded');
  assert.equal(out.fixture, true);
  assert.equal((await post(path, body)).replayed, true);
  const rows = await db.pool.query('select count(*)::int n from usage_records');
  assert.equal(rows.rows[0].n, 1);
  const real = await post('workspaces', {
    name: 'Disabled live search',
    record_mode: 'real',
  });
  const realPrice = await post(`workspaces/${real.id}/pricing`, {
    ...price.body,
    provider: 'brave',
    model_id: BRAVE_SEARCH_ID,
    basis: 'documented',
    source_url:
      'https://api-dashboard.search.brave.com/api-reference/web/search/get',
  });
  assert.equal(realPrice.body.provider, 'brave');
  const realPrefix = `workspaces/${real.id}`;
  const realEntity = await post(`${realPrefix}/entities`, {
    kind: 'run',
    title: 'No fallback',
    body: entity.body,
  });
  const realRun = await post(`${realPrefix}/runs`, {
    run: { id: realEntity.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
  });
  const realEnvelope = await post(`${realPrefix}/budgets`, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Disabled search',
    cap_nano_usd: '10000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 1,
  });
  const denied = await post(
    `${realPrefix}/runs/${realRun.run_id}/source-searches`,
    {
      ...body,
      envelope_id: realEnvelope.id,
      pricing_snapshot_id: realPrice.id,
      logical_operation_id: randomUUID(),
    },
  );
  assert.equal(denied.status, 'denied');
  assert.equal(denied.reason_code, 'live_provider_not_configured');
  assert.equal(denied.attempts[0].provider, 'brave');
  assert.equal(denied.output, null);
});
