import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  PricingSnapshotBodySchema,
  parse,
  type BrokerCallRequest,
} from '@creator/contracts';
import { maxExposure, usageCost } from '@creator/domain';
import { OpenAIAdapter, normalizeOpenAIUsage } from '@creator/broker';

const astra = parse(
  PricingSnapshotBodySchema,
  JSON.parse(
    readFileSync(
      new URL('../../config/pricing/openai-gpt-6-astra.json', import.meta.url),
      'utf8',
    ),
  ),
);
const request = (text: string, max = 1000): BrokerCallRequest => ({
  envelope_id: randomUUID(),
  action_type: 'model.generate',
  task_id: null,
  logical_operation_id: randomUUID(),
  pricing_snapshot_id: randomUUID(),
  data_class: 'synthetic',
  input: [{ role: 'user', text }],
  max_output_tokens: max,
  output_format: 'text',
  tool: null,
  max_attempts: 1,
  timeout_ms: 1000,
  justification: 'Exposure check.',
});

test('maximum exposure bounds input by UTF-8 bytes at the highest input rate', () => {
  const e = maxExposure(astra, request('héllo')); // 6 bytes
  assert.equal(e.max_input_tokens, 6 + 32 + 64);
  // Cache writes ($12.50/M) cost more than plain input, so the bound uses them.
  assert.equal(e.amount, String(102n * 12_500n + 1000n * 50_000n));
  assert.equal(e.long_context, false);
  // Above 272K input tokens the documented surcharge applies to the whole request.
  const big = maxExposure(astra, request('x'.repeat(300_000), 10));
  assert.equal(big.long_context, true);
  assert.equal(
    big.amount,
    String(300_096n * 12_500n * 2n + (10n * 50_000n * 3n) / 2n),
  );
  assert.throws(
    () => maxExposure(astra, request('x', 200_000)),
    (e: unknown) => e instanceof ContractError && e.code === 'LIMIT_EXCEEDED',
  );
  assert.throws(
    () =>
      maxExposure(astra, {
        ...request('x'),
        action_type: 'model.embed',
      }),
    (e: unknown) => e instanceof ContractError && e.code === 'PRICING_MISSING',
  );
});

test('usage is priced in disjoint categories; reasoning is not charged twice', () => {
  // From the official Responses example: reasoning_tokens is part of output_tokens.
  const u = normalizeOpenAIUsage({
    input_tokens: 81,
    input_tokens_details: { cached_tokens: 0, cache_write_tokens: 0 },
    output_tokens: 1035,
    output_tokens_details: { reasoning_tokens: 832 },
    total_tokens: 1116,
  });
  assert.ok(u);
  assert.equal(u.reasoning_tokens, 832);
  assert.equal(usageCost(astra, u), String(81n * 10_000n + 1035n * 50_000n));
  const cached = normalizeOpenAIUsage({
    input_tokens: 1000,
    input_tokens_details: { cached_tokens: 600, cache_write_tokens: 300 },
    output_tokens: 10,
    output_tokens_details: { reasoning_tokens: 0 },
    total_tokens: 1010,
  });
  assert.deepEqual(
    [
      cached?.uncached_input_tokens,
      cached?.cached_input_tokens,
      cached?.cache_write_tokens,
    ],
    [100, 600, 300],
  );
  assert.equal(
    usageCost(astra, cached!),
    String(100n * 10_000n + 600n * 1_000n + 300n * 12_500n + 10n * 50_000n),
  );
  // Inconsistent usage is malformed, never silently zero.
  for (const bad of [
    {
      input_tokens: 5,
      input_tokens_details: { cached_tokens: 6 },
      output_tokens: 1,
    },
    {
      input_tokens: 5,
      output_tokens: 1,
      output_tokens_details: { reasoning_tokens: 2 },
    },
    { input_tokens: 5, output_tokens: 1, total_tokens: 99 },
    { input_tokens: -1, output_tokens: 1 },
    { output_tokens: 1 },
    null,
  ])
    assert.equal(normalizeOpenAIUsage(bad), null);
  assert.throws(
    () =>
      usageCost(astra, {
        ...u,
        tool_calls: { web_search: 1 },
      }),
    (e: unknown) => e instanceof ContractError && e.code === 'PRICING_MISSING',
  );
});

test('pricing snapshots must say where documented prices came from', () => {
  const body = JSON.parse(JSON.stringify(astra)) as Record<string, unknown>;
  assert.equal(
    PricingSnapshotBodySchema.safeParse({ ...body, source_url: null }).success,
    false,
  );
  assert.equal(
    PricingSnapshotBodySchema.safeParse({ ...body, basis: 'fixture' }).success,
    false,
  );
  assert.equal(
    PricingSnapshotBodySchema.safeParse({
      ...body,
      rates: { ...(body.rates as object), output: '0.5' },
    }).success,
    false,
  );
});

test('OpenAI adapter speaks the Responses API and maps outcomes without leaking the key', async (t) => {
  const seen: { auth: string | undefined; body: Record<string, unknown> }[] =
    [];
  const replies: ((res: import('node:http').ServerResponse) => void)[] = [
    (res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'resp_1',
          status: 'completed',
          incomplete_details: null,
          output: [
            { type: 'reasoning', id: 'rs_1', summary: [] },
            {
              type: 'message',
              role: 'assistant',
              content: [
                { type: 'output_text', text: 'Hello', annotations: [] },
              ],
            },
          ],
          usage: {
            input_tokens: 20,
            input_tokens_details: { cached_tokens: 4, cache_write_tokens: 0 },
            output_tokens: 30,
            output_tokens_details: { reasoning_tokens: 25 },
            total_tokens: 50,
          },
        }),
      );
    },
    (res) => {
      res.writeHead(429, { 'Retry-After': '2' });
      res.end('{}');
    },
    (res) => {
      res.writeHead(500);
      res.end('{}');
    },
    (res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end('{"status":"completed","output":[]}');
    },
    (res) => {
      res.writeHead(401);
      res.end('{}');
    },
    (res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'resp_2',
          status: 'incomplete',
          incomplete_details: { reason: 'max_output_tokens' },
          output: [],
          usage: { input_tokens: 10, output_tokens: 5, total_tokens: 15 },
        }),
      );
    },
  ];
  const server = createServer((req: IncomingMessage, res) => {
    let raw = '';
    req.on('data', (c: Buffer) => (raw += c.toString()));
    req.on('end', () => {
      seen.push({
        auth: req.headers.authorization,
        body: JSON.parse(raw) as Record<string, unknown>,
      });
      assert.equal(req.url, '/v1/responses');
      replies.shift()!(res);
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as { port: number }).port;
  const key = 'sk-test-0123456789abcdefghijklmnop';
  const adapter = new OpenAIAdapter({
    apiKey: key,
    model_id: 'gpt-6-astra',
    baseUrl: `http://127.0.0.1:${port}/v1`,
  });
  assert.equal(JSON.stringify(adapter).includes(key), false);
  const req = {
    action: 'model.generate' as const,
    model_id: 'gpt-6-astra',
    input: [
      { role: 'system' as const, text: 'Be brief.' },
      { role: 'user' as const, text: 'Hi' },
    ],
    max_output_tokens: 64,
    output_format: 'text' as const,
    tool: null,
  };
  const signal = new AbortController().signal;
  const ok = await adapter.call(req, signal);
  assert.equal(ok.kind, 'completed');
  if (ok.kind === 'completed') {
    assert.equal(ok.text, 'Hello');
    assert.deepEqual(ok.usage, {
      uncached_input_tokens: 16,
      cached_input_tokens: 4,
      cache_write_tokens: 0,
      output_tokens: 30,
      reasoning_tokens: 25,
      tool_calls: {},
    });
  }
  assert.equal(seen[0]?.auth, `Bearer ${key}`);
  assert.equal(seen[0]?.body.model, 'gpt-6-astra');
  assert.equal(seen[0]?.body.store, false);
  assert.equal(seen[0]?.body.max_output_tokens, 64);
  const limited = await adapter.call(req, signal);
  assert.deepEqual(
    limited.kind === 'rejected' && [
      limited.reason_code,
      limited.retry_after_ms,
    ],
    ['rate_limited', 2000],
  );
  assert.deepEqual((await adapter.call(req, signal)).kind, 'unknown');
  const malformed = await adapter.call(req, signal);
  assert.equal(
    malformed.kind === 'unknown' && malformed.reason_code,
    'malformed_response',
  );
  const auth = await adapter.call(req, signal);
  assert.equal(auth.kind === 'rejected' && auth.reason_code, 'auth_failed');
  const partial = await adapter.call(req, signal);
  assert.equal(
    partial.kind === 'completed' && partial.incomplete_reason,
    'max_output_tokens',
  );
  assert.equal(seen.length, 6);
  // Embeddings are not implemented for this adapter: refused without a request.
  const embed = await adapter.call({ ...req, action: 'model.embed' }, signal);
  assert.equal(embed.kind === 'rejected' && embed.reason_code, 'unsupported');
  assert.equal(seen.length, 6);
  assert.throws(
    () =>
      new OpenAIAdapter({
        apiKey: key,
        model_id: 'gpt-6-astra',
        baseUrl: 'https://example.com/v1',
      }),
  );
});
