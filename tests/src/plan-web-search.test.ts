import test from 'node:test';
import assert from 'node:assert/strict';
import {
  callPlanResponses,
  checkPlanWebSearch,
  planRequestBody,
  searchCallOf,
  type PlanWebSearch,
} from '@creator/broker';

const sse = (evs: unknown[]) =>
  evs.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('');
const searchItem = (id: string, query: string, urls: string[]) => ({
  type: 'web_search_call',
  id,
  status: 'completed',
  action: { type: 'search', query, sources: urls.map((url) => ({ url })) },
});
async function run(text: string, web_search?: PlanWebSearch) {
  const bodies: Record<string, unknown>[] = [];
  const outcome = await callPlanResponses({
    api_base: 'http://fixture.invalid',
    access_token: 'fixture-only',
    model: 'fixture',
    instructions: 'fixture',
    input: 'fixture',
    timeout_ms: 1000,
    max_output_chars: 1000,
    ...(web_search ? { web_search } : {}),
    fetchImpl: async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
      return new Response(text, {
        headers: { 'content-type': 'text/event-stream' },
      });
    },
  });
  return { outcome, bodies };
}

test('without the opt-in the request body offers no tools', () => {
  const b = planRequestBody('m', 'i', 'x') as Record<string, unknown>;
  for (const k of ['tools', 'tool_choice', 'include'])
    assert.equal(k in b, false);
});

test('the opt-in asks for required web search with its sources and one domain list', () => {
  const b = planRequestBody('m', 'i', 'x', {
    max_calls: 2,
    blocked_domains: ['example.com'],
  }) as Record<string, unknown>;
  assert.deepEqual(b.tools, [
    {
      type: 'web_search',
      external_web_access: true,
      filters: { blocked_domains: ['example.com'] },
    },
  ]);
  assert.equal(b.tool_choice, 'required');
  assert.deepEqual(b.include, ['web_search_call.action.sources']);
  assert.equal(b.store, false);
  assert.equal('max_tool_calls' in b, false);
});

test('invalid search options are refused before anything is sent', async () => {
  assert.match(checkPlanWebSearch({ max_calls: 0 }) ?? '', /1 to 10/);
  assert.match(
    checkPlanWebSearch({
      max_calls: 1,
      allowed_domains: ['a.org'],
      blocked_domains: ['b.org'],
    }) ?? '',
    /not both/,
  );
  assert.match(
    checkPlanWebSearch({ max_calls: 1, blocked_domains: ['https://a.org'] }) ??
      '',
    /without a scheme/,
  );
  const { outcome, bodies } = await run('', { max_calls: 11 });
  assert.equal(outcome.kind, 'rejected');
  assert.equal(
    'reason_code' in outcome && outcome.reason_code,
    'invalid_web_search',
  );
  assert.equal(bodies.length, 0);
});

test('search calls are recorded once each, with bounded queries and http(s) sources only', async () => {
  const a = searchItem('ws_1', 'q one', [
    'https://a.org/1',
    'javascript:alert(1)',
  ]);
  const { outcome } = await run(
    sse([
      { type: 'response.created', response: { id: 'r1' } },
      { type: 'response.output_item.added', item: { ...a, action: {} } },
      { type: 'response.output_item.done', item: a },
      { type: 'response.output_text.delta', delta: '{"candidates":[]}' },
      {
        type: 'response.completed',
        response: { id: 'r1', output: [a], usage: { output_tokens: 3 } },
      },
    ]),
    { max_calls: 2 },
  );
  assert.equal(outcome.kind, 'completed');
  assert.deepEqual(outcome.search_calls, [
    {
      id: 'ws_1',
      status: 'completed',
      action: 'search',
      queries: ['q one'],
      sources: ['https://a.org/1'],
    },
  ]);
});

test('a completed response with no search call reports an empty list, not a search', async () => {
  const { outcome } = await run(
    sse([
      { type: 'response.output_text.delta', delta: 'from memory' },
      { type: 'response.completed', response: { id: 'r2' } },
    ]),
    { max_calls: 1 },
  );
  assert.equal(outcome.kind, 'completed');
  assert.deepEqual(outcome.search_calls, []);
});

test('one search call past the cap ends the stream as unknown and keeps what was seen', async () => {
  const { outcome } = await run(
    sse([
      {
        type: 'response.output_item.done',
        item: searchItem('ws_1', 'a', ['https://a.org/']),
      },
      {
        type: 'response.output_item.done',
        item: searchItem('ws_2', 'b', ['https://b.org/']),
      },
      { type: 'response.completed', response: { id: 'r3' } },
    ]),
    { max_calls: 1 },
  );
  assert.equal(outcome.kind, 'unknown');
  assert.equal(
    'reason_code' in outcome && outcome.reason_code,
    'studio_search_cap',
  );
  assert.equal(outcome.search_calls?.length, 2);
});

test('items that are not search calls are ignored', () => {
  assert.equal(searchCallOf({ type: 'message' }), null);
  assert.equal(searchCallOf(null), null);
});
