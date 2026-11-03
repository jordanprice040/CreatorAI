import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { BUILD_APPROVAL_MAX_MS, buildDeadlineMs } from '@creator/contracts';

type HttpRequest = (
  url: string,
  init: {
    method?: 'GET' | 'POST';
    headers?: Record<string, string>;
    body?: string;
    timeoutMs: number;
  },
) => Promise<{
  status: number;
  ok: boolean;
  setCookies: string[];
  body: string;
}>;
// The CLI's built module (tests run after `pnpm build:code`).
const { httpRequest } = (await import(
  new URL('../../apps/cli/dist/http.js', import.meta.url).href
)) as { httpRequest: HttpRequest };

// PR #123 third review M-1: the CLI talks to the API over node:http, which has no 300 s
// headers timeout of its own (Node's fetch does). Its own timer is the only limit. Set
// CREATOR_SLOW_HTTP_TEST=1 to also hold a response past 300 s (about 5.5 minutes).
async function server(delayMs: number) {
  const s = createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () =>
      setTimeout(() => {
        res.setHeader('Set-Cookie', ['creator_session=abc; HttpOnly']);
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ method: req.method, body }));
      }, delayMs),
    );
  });
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  const port = (s.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}/api/x`, close: () => s.close() };
}

test('the CLI request returns status, cookies and body, and stops at its own timeout', async (t) => {
  const quick = await server(50);
  t.after(quick.close);
  const r = await httpRequest(quick.url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ a: 'é' }),
    timeoutMs: 5000,
  });
  assert.equal(r.status, 200);
  assert.equal(r.ok, true);
  assert.deepEqual(JSON.parse(r.body), { method: 'POST', body: '{"a":"é"}' });
  assert.deepEqual(r.setCookies, ['creator_session=abc; HttpOnly']);
  const slow = await server(2000);
  t.after(slow.close);
  await assert.rejects(
    httpRequest(slow.url, { timeoutMs: 200 }),
    /did not answer within 0 s/,
  );
});

test(
  'the CLI request waits past 300 s without response headers',
  { skip: process.env.CREATOR_SLOW_HTTP_TEST !== '1', timeout: 400_000 },
  async (t) => {
    const late = await server(310_000);
    t.after(late.close);
    const r = await httpRequest(late.url, { timeoutMs: 360_000 });
    assert.equal(r.status, 200);
  },
);

test('a Codex build from the Build form may run every round at the build timeout', () => {
  // PR #123 third review L-1: no fixed 30-minute build deadline.
  assert.equal(
    buildDeadlineMs(0, 2),
    30 * 60_000,
    'plan roles keep 30 minutes',
  );
  assert.equal(buildDeadlineMs(10 * 60_000, 0), 40 * 60_000);
  assert.equal(
    buildDeadlineMs(60 * 60_000, 2),
    210 * 60_000,
    '3 one-hour turns',
  );
  assert.equal(
    buildDeadlineMs(12 * 3_600_000, 2),
    BUILD_APPROVAL_MAX_MS - 5 * 60_000,
    'never past the approval',
  );
});
