import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import {
  CONTEXT_POLICY_VERSION,
  type Batch,
  type PackItem,
  type ProviderCapability,
} from '@creator/contracts';
import {
  cacheKey,
  capabilityRefusal,
  renderPack,
  verifyCompaction,
} from '@creator/domain';
import {
  FixtureAdapter,
  OpenAIBatchAdapter,
  batchStatus,
  lineOutcome,
} from '@creator/broker';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const item = (
  text: string,
  pin: PackItem['pin'] = null,
  key = sha(text).slice(0, 8),
): PackItem => ({
  origin: 'index',
  corpus: 'notes',
  key,
  kind: 'note',
  data_class: 'synthetic',
  version: 1,
  content_hash: sha(text),
  locator: null,
  record: null,
  pin,
  derived_from: [],
  handoff_id: null,
  tokens: Math.ceil(text.length / 4),
  text,
});

test('cache keys separate every scope and version component', () => {
  const base = {
    workspace_id: '00000000-0000-4000-8000-000000000001',
    project_id: null,
    data_class: 'synthetic' as const,
    action_type: 'model.generate',
    tool: null,
    model: { provider: 'fixture' as const, model_id: 'fixture-context-v1' },
    pricing_hash: 'a'.repeat(64),
    input_hash: 'b'.repeat(64),
    pack_hash: null,
    output_format: 'text',
    max_output_tokens: 100,
    policy_version: CONTEXT_POLICY_VERSION,
  };
  const k = cacheKey(base);
  const variants = [
    { workspace_id: '00000000-0000-4000-8000-000000000002' },
    { project_id: '00000000-0000-4000-8000-000000000003' },
    { data_class: 'public' as const },
    { action_type: 'model.summarize' },
    { model: { provider: 'fixture' as const, model_id: 'fixture-lossy-v1' } },
    { pricing_hash: 'c'.repeat(64) },
    { input_hash: 'd'.repeat(64) },
    { pack_hash: 'e'.repeat(64) },
    { max_output_tokens: 101 },
    { policy_version: 'context/2.0' },
  ];
  const keys = new Set([
    k,
    ...variants.map((v) => cacheKey({ ...base, ...v })),
  ]);
  assert.equal(keys.size, variants.length + 1);
  assert.equal(cacheKey({ ...base }), k, 'deterministic');
});

test('capability states: fixture only in fixture workspaces, verified only in real ones', () => {
  const cap = (state: ProviderCapability['state']): ProviderCapability => ({
    provider: 'openai',
    model_id: 'm',
    feature: 'prompt_caching',
    state,
    source_url: 'https://example.com/doc',
    retrieved_at: '2026-10-19T00:00:00.000Z',
    evidence: 'test',
    batch: null,
    output_opaque: false,
  });
  assert.equal(capabilityRefusal(false, undefined), 'capability_missing');
  assert.equal(
    capabilityRefusal(false, cap('unsupported')),
    'capability_unsupported',
  );
  assert.equal(
    capabilityRefusal(false, cap('documented')),
    'capability_unverified',
  );
  assert.equal(
    capabilityRefusal(false, cap('fixture')),
    'capability_unverified',
  );
  assert.equal(capabilityRefusal(false, cap('verified')), null);
  assert.equal(
    capabilityRefusal(true, cap('verified')),
    'capability_unverified',
  );
  assert.equal(capabilityRefusal(true, cap('fixture')), null);
});

test('rendering keeps the pinned prefix identical across tasks; verification catches edits', () => {
  const pinned = item('Never store participant names.', 'constraint', 'c');
  const other = item('Retention was 62 percent.', null, 'r');
  const a = renderPack({ items: [other, pinned] }, [
    { role: 'user', text: 'Question A' },
  ]);
  const b = renderPack({ items: [pinned, other] }, [
    { role: 'user', text: 'Question B' },
  ]);
  assert.deepEqual(a.slice(0, 2), b.slice(0, 2), 'cacheable prefix is stable');
  assert.match(a[1]!.text, /Never store participant names/);
  const original = { items: [pinned, other], required_facts: ['62 percent'] };
  assert.deepEqual(verifyCompaction(original, [pinned, other]), {
    missing_pins: [],
    missing_facts: [],
  });
  const edited = { ...pinned, text: 'Avoid storing participant names.' };
  const v = verifyCompaction(original, [edited, item('Retention was high.')]);
  assert.equal(
    v.missing_pins.length,
    1,
    'a reworded constraint does not count as kept',
  );
  assert.deepEqual(v.missing_facts, ['62 percent']);
});

test('fixture prompt cache: first prefix use writes, the repeat reads; short prefixes are not cached', async () => {
  const a = new FixtureAdapter('fixture-context-v1', { promptCache: true });
  const long = 'Standing rule text. '.repeat(80);
  const req = (q: string) => ({
    action: 'model.generate' as const,
    model_id: 'fixture-context-v1',
    input: [
      { role: 'system' as const, text: 'Preamble.' },
      { role: 'user' as const, text: long },
      { role: 'user' as const, text: q },
    ],
    max_output_tokens: 20,
    output_format: 'text' as const,
    tool: null,
  });
  const signal = new AbortController().signal;
  const one = await a.call(req('first'), signal);
  const two = await a.call(req('second'), signal);
  assert.ok(one.kind === 'completed' && two.kind === 'completed');
  if (one.kind !== 'completed' || two.kind !== 'completed') return;
  assert.ok(
    one.usage.cache_write_tokens > 0 && one.usage.cached_input_tokens === 0,
  );
  assert.equal(two.usage.cached_input_tokens, one.usage.cache_write_tokens);
  assert.equal(two.usage.cache_write_tokens, 0);
  const short = await a.call(
    {
      ...req('x'),
      input: req('x').input.map((m, i) =>
        i === 1 ? { ...m, text: 'short' } : m,
      ),
    },
    signal,
  );
  assert.ok(
    short.kind === 'completed' &&
      short.usage.cached_input_tokens === 0 &&
      short.usage.cache_write_tokens === 0,
  );
});

test('batch result lines: expiry and request errors are not charged, others are unknown', () => {
  assert.deepEqual(
    lineOutcome({
      custom_id: 'a',
      response: null,
      error: { code: 'batch_expired', message: 'x' },
    }).kind,
    'rejected',
  );
  const e = lineOutcome({
    custom_id: 'a',
    response: { status_code: 400, body: {} },
    error: null,
  });
  assert.ok(e.kind === 'rejected' && e.reason_code === 'invalid_request');
  assert.equal(
    lineOutcome({ custom_id: 'a', response: { status_code: 500, body: {} } })
      .kind,
    'unknown',
  );
  assert.equal(
    lineOutcome({ custom_id: 'a', response: { status_code: 429, body: {} } })
      .kind,
    'unknown',
  );
  assert.equal(
    lineOutcome({ custom_id: 'a', response: { status_code: 200, body: {} } })
      .kind,
    'unknown',
  );
});

test('batch status comes from item reservations, not the provider status alone', () => {
  const b = (statuses: [string, string, string | null][]): Batch =>
    ({
      items: statuses.map(([status, reason_code, out]) => ({
        custom_id: reason_code,
        logical_operation_id: '00000000-0000-4000-8000-000000000001',
        reservation_id: null,
        status,
        reason_code,
        late: false,
        incurred_nano: null,
        output: out === null ? null : { text: out, json: null },
      })),
    }) as unknown as Batch;
  assert.equal(
    batchStatus(b([['settled', 'settled', 'x']]), 'completed', true).status,
    'completed',
  );
  assert.equal(
    batchStatus(
      b([
        ['settled', 'settled', 'x'],
        ['unknown', 'batch_result_missing', null],
      ]),
      'expired',
      true,
    ).status,
    'unknown',
  );
  assert.equal(
    batchStatus(
      b([
        ['settled', 'settled', 'x'],
        ['released', 'batch_expired', null],
      ]),
      'expired',
      true,
    ).status,
    'partial',
  );
  assert.equal(
    batchStatus(b([['released', 'batch_expired', null]]), 'expired', true)
      .status,
    'expired',
  );
  assert.equal(
    batchStatus(b([['in_flight', 'reserved', null]]), 'in_progress', false)
      .status,
    'submitted',
  );
});

test('OpenAI batch adapter (loopback contract): upload, create, poll, output and error files', async (t) => {
  const seen: {
    method: string;
    url: string;
    auth: string | undefined;
    body: string;
  }[] = [];
  let status = 'in_progress';
  const server = createServer((req, res) => {
    let body = '';
    req.on('data', (c: Buffer) => (body += c.toString('utf8')));
    req.on('end', () => {
      seen.push({
        method: req.method ?? '',
        url: req.url ?? '',
        auth: req.headers.authorization,
        body,
      });
      const json = (v: unknown, code = 200) => {
        res.writeHead(code, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(v));
      };
      if (req.method === 'POST' && req.url === '/v1/files')
        return json({ id: 'file-in' });
      if (req.method === 'POST' && req.url === '/v1/batches')
        return json({ id: 'batch_1', status: 'validating' });
      if (req.method === 'GET' && req.url === '/v1/batches/batch_1')
        return json(
          status === 'completed'
            ? {
                id: 'batch_1',
                status,
                output_file_id: 'file-out',
                error_file_id: 'file-err',
              }
            : { id: 'batch_1', status },
        );
      if (req.url === '/v1/files/file-out/content') {
        res.writeHead(200);
        return res.end(
          `${JSON.stringify({
            id: 'r1',
            custom_id: 'a',
            response: {
              status_code: 200,
              body: {
                id: 'resp_1',
                status: 'completed',
                output: [
                  {
                    type: 'message',
                    content: [{ type: 'output_text', text: 'Done' }],
                  },
                ],
                usage: {
                  input_tokens: 10,
                  input_tokens_details: { cached_tokens: 0 },
                  output_tokens: 2,
                  output_tokens_details: { reasoning_tokens: 0 },
                  total_tokens: 12,
                },
              },
            },
            error: null,
          })}\n`,
        );
      }
      if (req.url === '/v1/files/file-err/content') {
        res.writeHead(200);
        return res.end(
          `${JSON.stringify({ custom_id: 'b', response: null, error: { code: 'batch_expired', message: 'expired' } })}\n${JSON.stringify({ custom_id: 'zz', response: null, error: { code: 'batch_expired' } })}\n`,
        );
      }
      json({ error: 'not found' }, 404);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as { port: number }).port;
  const key = 'sk-test-0123456789abcdefghijklmnop';
  const adapter = new OpenAIBatchAdapter({
    apiKey: key,
    model_id: 'gpt-6-astra',
    baseUrl: `http://127.0.0.1:${port}/v1`,
  });
  assert.equal(JSON.stringify(adapter).includes(key), false);
  assert.throws(
    () =>
      new OpenAIBatchAdapter({
        apiKey: key,
        model_id: 'm',
        baseUrl: 'https://evil.example/v1',
      }),
  );
  const call = (text: string) => ({
    action: 'model.generate' as const,
    model_id: 'gpt-6-astra',
    input: [{ role: 'user' as const, text }],
    max_output_tokens: 16,
    output_format: 'text' as const,
    tool: null,
  });
  const signal = new AbortController().signal;
  const sub = await adapter.submit(
    [
      { custom_id: 'a', request: call('A') },
      { custom_id: 'b', request: call('B') },
    ],
    signal,
  );
  assert.deepEqual(sub, { kind: 'submitted', provider_batch_id: 'batch_1' });
  const upload = seen[0]!;
  assert.equal(upload.auth, `Bearer ${key}`);
  assert.match(upload.body, /name="purpose"\r\n\r\nbatch/);
  const line = JSON.parse(
    upload.body.split(/\r?\n/).find((l) => l.startsWith('{"custom_id":"a"'))!,
  );
  assert.deepEqual(line, {
    custom_id: 'a',
    method: 'POST',
    url: '/v1/responses',
    body: {
      model: 'gpt-6-astra',
      input: [{ role: 'user', content: 'A' }],
      max_output_tokens: 16,
      store: false,
    },
  });
  assert.deepEqual(JSON.parse(seen[1]!.body), {
    input_file_id: 'file-in',
    endpoint: '/v1/responses',
    completion_window: '24h',
  });
  const pending = await adapter.poll('batch_1', ['a', 'b'], signal);
  assert.ok(
    pending.kind === 'status' &&
      !pending.terminal &&
      pending.results.length === 0,
  );
  status = 'completed';
  const done = await adapter.poll('batch_1', ['a', 'b'], signal);
  assert.ok(done.kind === 'status' && done.terminal);
  if (done.kind !== 'status') return;
  assert.deepEqual(
    done.results.map((r) => [r.custom_id, r.outcome.kind]),
    [
      ['a', 'completed'],
      ['b', 'rejected'],
    ],
    'lines for unknown custom ids are ignored',
  );
  const a = done.results[0]!.outcome;
  assert.ok(
    a.kind === 'completed' &&
      a.text === 'Done' &&
      a.usage.uncached_input_tokens === 10,
  );
});
