import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { connect } from 'node:net';
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { createApi } from '@creator/api';
import { webHandler } from '@creator/api/studio';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// PR #141 review R-M1: every request's body must arrive within 10 s. Only an upload the caller
// may make, declared within the size limit, gets longer; a refusal closes the connection
// instead of draining a slow body.

type Slow = {
  closedAt: Promise<number>;
  response: () => string;
  isOpen: () => boolean;
  stop: () => void;
};

/** Sends `head`, then one byte of body each second until stopped or closed. */
function slowSender(port: number, head: string, bytes = Infinity): Slow {
  let sent = 0;
  const started = Date.now();
  const sock = connect(port, '127.0.0.1');
  let data = '';
  let open = true;
  sock.setEncoding('latin1');
  sock.on('data', (d: string) => (data += d));
  sock.on('error', () => undefined);
  const closedAt = new Promise<number>((r) =>
    sock.on('close', () => {
      open = false;
      clearInterval(drip);
      r(Date.now() - started);
    }),
  );
  sock.write(head);
  const drip = setInterval(() => {
    if (open && !sock.destroyed && sent < bytes) {
      sock.write('x');
      sent++;
    }
  }, 1000);
  return {
    closedAt,
    response: () => data,
    isOpen: () => open,
    stop: () => {
      clearInterval(drip);
      sock.destroy();
    },
  };
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

test('body deadlines: refused slow uploads close within 10 s; an authorised upload may take longer', async (t) => {
  let closeApi = async () => undefined as unknown;
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
    CREATOR_FILE_MAX_BYTES: '4096',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const created = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.write },
    body: JSON.stringify({ name: 'Deadlines', record_mode: 'fixture' }),
  });
  const ws = ((await created.json()) as { id: string }).id;

  let handle: ReturnType<typeof webHandler> = (_req, res) => res.end();
  const web = createServer((req, res) => handle(req, res));
  web.listen(0, '127.0.0.1');
  await once(web, 'listening');
  t.after(() => web.close());
  const webPort = (web.address() as { port: number }).port;
  handle = webHandler(
    '/nonexistent-web-root',
    (_req, res) => res.end('{}'),
    webPort,
  );

  const upload = (length: number, cookie?: { cookie: string; csrf: string }) =>
    [
      `POST /api/workspaces/${ws}/files HTTP/1.1`,
      `Host: 127.0.0.1:${port}`,
      'Content-Type: application/octet-stream',
      `Content-Length: ${length}`,
      'X-File-Name: slow.txt',
      `X-Upload-Key: ${randomUUID()}`,
      ...(cookie
        ? [`Cookie: ${cookie.cookie}`, `X-CSRF-Token: ${cookie.csrf}`]
        : []),
      '',
      '',
    ].join('\r\n');

  // No session, a huge declared size: refused at once and closed, not held for 30 minutes.
  const anon = slowSender(port, upload(2_000_000_000));
  // A member's upload declared over the size limit: refused and closed too.
  const big = slowSender(port, upload(10_000, auth));
  // A body on the web port outside /api (refused with 405) gets the same 10 s bound.
  const webPost = slowSender(
    webPort,
    `POST / HTTP/1.1\r\nHost: 127.0.0.1:${webPort}\r\nContent-Length: 1000000\r\n\r\n`,
  );
  // A member's upload within the limit, still arriving after 10 s.
  const ok = slowSender(port, upload(14, auth), 14);
  t.after(() => [anon, big, webPost, ok].forEach((s) => s.stop()));

  const limit = 11_500;
  const closed = await Promise.all(
    [anon, big, webPost].map((s) =>
      Promise.race([s.closedAt, wait(limit + 500).then(() => Infinity)]),
    ),
  );
  for (const ms of closed) assert.ok(ms <= limit, `closed after ${ms} ms`);
  assert.match(anon.response(), /^HTTP\/1\.1 401/);
  assert.match(big.response(), /^HTTP\/1\.1 413/);
  assert.match(webPost.response(), /^HTTP\/1\.1 405/);

  // Its body is complete only after about 14 s, past the ordinary deadline, and it is stored.
  const deadline = Date.now() + 20_000;
  while (!/\r\n\r\n/.test(ok.response()) && Date.now() < deadline)
    await wait(200);
  assert.match(ok.response(), /^HTTP\/1\.1 201/);
  assert.match(ok.response(), /"stored":true/);
});
