import test from 'node:test';
import assert from 'node:assert/strict';
import { callPlanResponses } from '@creator/broker';
import { createServer } from 'node:http';
import { once } from 'node:events';
const encode = (v: unknown) => JSON.stringify(v);
const events = [
  { type: 'response.created', response: { id: 'resp-local' } },
  { type: 'response.output_text.delta', delta: 'partial' },
  {
    type: 'response.completed',
    response: { id: 'resp-local', usage: { output_tokens: 1 } },
  },
];
async function run(text: string, max = 100) {
  return callPlanResponses({
    api_base: 'http://fixture.invalid',
    access_token: 'fixture-only',
    model: 'fixture',
    instructions: 'fixture',
    input: 'fixture',
    timeout_ms: 100,
    max_output_chars: max,
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(c) {
            const b = new TextEncoder().encode(text);
            for (const v of b) c.enqueue(Uint8Array.of(v));
            c.close();
          },
        }),
        { headers: { 'content-type': 'text/event-stream' } },
      ),
  });
}
test('completion survives LF, CRLF, CR and arbitrary byte boundaries', async () => {
  for (const ending of ['\n', '\r\n', '\r']) {
    const r = await run(
      events.map((e) => 'data: ' + encode(e) + ending + ending).join(''),
    );
    assert.equal(r.kind, 'completed');
    assert.equal(r.response_id, 'resp-local');
  }
});
test('completed-event fallback cannot bypass the local output cap', async () => {
  const r = await run(
    'data: ' +
      encode({
        type: 'response.completed',
        response: {
          id: 'resp-local',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: 'x'.repeat(101) }],
            },
          ],
        },
      }) +
      '\n\n',
  );
  assert.equal(r.kind, 'failed');
  assert.equal('reason_code' in r && r.reason_code, 'studio_output_cap');
});
test('truncated stream stays unknown and preserves observed response identity and character count', async () => {
  const r = await run(
    events
      .slice(0, 2)
      .map((e) => 'data: ' + encode(e) + '\n\n')
      .join(''),
  );
  assert.equal(r.kind, 'unknown');
  assert.equal(r.response_id, 'resp-local');
  assert.equal(r.output_chars, 7);
  assert.equal('retry_allowed' in r && r.retry_allowed, false);
});

test('real stalled HTTP stream times out once and keeps partial evidence without retry', async (t) => {
  let calls = 0;
  const server = createServer((_req, res) => {
    calls++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    res.write(
      events
        .slice(0, 2)
        .map((e) => 'data: ' + encode(e) + '\n\n')
        .join(''),
    );
  });
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const r = await callPlanResponses({
    api_base: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    access_token: 'fixture',
    model: 'fixture',
    instructions: 'fixture',
    input: 'fixture',
    timeout_ms: 250,
    max_output_chars: 100,
  });
  assert.equal(r.kind, 'unknown');
  assert.equal('reason_code' in r && r.reason_code, 'timeout');
  assert.equal(r.response_id, 'resp-local');
  assert.equal(r.output_chars, 7);
  assert.equal(calls, 1);
});
