import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:net';
import {
  PortPlanError,
  holderFromLsof,
  nameFromTasklist,
  pidFromNetstat,
  planDevPorts,
  portFree,
  portHolder,
  portInUseText,
} from '@creator/api/ports';
import { APP_PORTS, DEV_PORTS, RESERVED_PORTS } from '@creator/domain';

// ADR-0108: development runs keep off the installed app's ports and move off a port an
// unrelated program holds; the installed app's own ports never move.

/** A probe where `busy` ports are held, `studios` of them by another Creator Agent. */
const probe = (busy: number[], studios: number[] = []) => ({
  free: async (p: number) => !busy.includes(p),
  holder: async (p: number) =>
    busy.includes(p) ? { pid: 4242, name: `holder-of-${p}.exe` } : null,
  creatorAgent: async (p: number) => studios.includes(p),
});
const refused = (re: RegExp) => (e: unknown) =>
  e instanceof PortPlanError && re.test(e.message);

test('the dev range, the app ports and the reviewer ranges never overlap', () => {
  const app = Object.values(APP_PORTS);
  for (const p of Object.values(DEV_PORTS)) {
    assert.ok(!app.includes(p as never));
    assert.ok(![5183, 4330, 4340].includes(p));
    assert.ok(RESERVED_PORTS.has(p));
  }
  for (const p of app) assert.ok(RESERVED_PORTS.has(p));
});

test('free default ports are kept as they are', async () => {
  const plan = await planDevPorts({}, probe([]));
  assert.deepEqual(plan.env, {
    CREATOR_API_PORT: '4410',
    CREATOR_PREVIEW_PORT: '4420',
    CREATOR_WEB_PORT: '5273',
  });
  assert.deepEqual(plan.moved, []);
});

test('a default port an unrelated program holds moves, naming the holder, past reserved and taken ports', async () => {
  // 4411 and 4412 are busy too; the preview default 4420 must not be reused by the API.
  const plan = await planDevPorts({}, probe([4410, 4411, 4412, 5273]));
  assert.equal(plan.env.CREATOR_API_PORT, '4413');
  assert.equal(plan.env.CREATOR_PREVIEW_PORT, '4420');
  assert.equal(plan.env.CREATOR_WEB_PORT, '5274');
  assert.equal(plan.moved.length, 2);
  assert.match(
    plan.moved[0]!,
    /^Port 4410 is already in use by holder-of-4410\.exe \(process 4242\)\. The API uses 4413/,
  );
  const viaReserved = await planDevPorts(
    { CREATOR_PREVIEW_PORT: '4900', CREATOR_WEB_PORT: '4901' },
    probe([4410, 4411, 4412, 4413, 4414, 4415, 4416, 4417, 4418, 4419]),
  );
  // 4420 is the preview default (reserved), so the API goes to 4421.
  assert.equal(viaReserved.env.CREATOR_API_PORT, '4421');
});

test('a port another Creator Agent answers on is refused, never moved around', async () => {
  await assert.rejects(
    planDevPorts({}, probe([4410, 4420, 5273], [4410])),
    refused(
      /^Port 4410 is already in use by holder-of-4410\.exe \(process 4242\)\. Another Creator Agent studio is already running there/,
    ),
  );
});

test('an explicit port, OIDC sign-in or the off switch keeps the port and names the holder', async () => {
  await assert.rejects(
    planDevPorts({ CREATOR_WEB_PORT: '5273' }, probe([5273])),
    refused(/holder-of-5273\.exe.*CREATOR_WEB_PORT asks for it/),
  );
  await assert.rejects(
    planDevPorts({ CREATOR_OIDC_ISSUER: 'http://127.0.0.1:9' }, probe([5273])),
    refused(/OIDC sign-in redirects to a fixed address/),
  );
  await assert.rejects(
    planDevPorts({ CREATOR_AUTH_MODE: 'oidc' }, probe([4410])),
    refused(/OIDC/),
  );
  await assert.rejects(
    planDevPorts({ CREATOR_PORT_FALLBACK: 'off' }, probe([4420])),
    refused(
      /private preview origin cannot move because CREATOR_PORT_FALLBACK=off/,
    ),
  );
});

test('the off switch takes the usual spellings and refuses anything else', async () => {
  for (const off of ['OFF', 'false', '0', 'no', ' Off '])
    await assert.rejects(
      planDevPorts({ CREATOR_PORT_FALLBACK: off }, probe([4410])),
      refused(/cannot move because CREATOR_PORT_FALLBACK=/),
    );
  for (const on of ['on', 'TRUE', '1', 'yes'])
    assert.equal(
      (await planDevPorts({ CREATOR_PORT_FALLBACK: on }, probe([4410]))).env
        .CREATOR_API_PORT,
      '4411',
    );
  await assert.rejects(
    planDevPorts({ CREATOR_PORT_FALLBACK: 'maybe' }, probe([])),
    refused(/CREATOR_PORT_FALLBACK must be on or off/),
  );
});

test('no free port in the span is a clear refusal', async () => {
  const all = Array.from({ length: 21 }, (_, i) => 4410 + i);
  await assert.rejects(
    planDevPorts({}, probe(all)),
    refused(/No free port for the API in 4411–4430/),
  );
});

test('holder parsers read netstat, tasklist and lsof output', () => {
  const netstat = [
    'Active Connections',
    '  Proto  Local Address          Foreign Address        State           PID',
    '  TCP    127.0.0.1:4310         127.0.0.1:51234        ESTABLISHED     77',
    '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1000',
    '  TCP    127.0.0.1:5173         0.0.0.0:0              ABHÖREN         9876',
    '  TCP    [::]:4320              [::]:0                 LISTENING       5555',
  ].join('\r\n');
  assert.equal(pidFromNetstat(netstat, 5173), 9876);
  assert.equal(pidFromNetstat(netstat, 4320), 5555);
  assert.equal(pidFromNetstat(netstat, 4310), null); // only a client connection
  assert.equal(pidFromNetstat(netstat, 51735), null);
  assert.equal(
    nameFromTasklist('"node.exe","9876","Console","1","81,220 K"\r\n', 9876),
    'node.exe',
  );
  assert.equal(
    nameFromTasklist('INFO: No tasks are running which match.', 9876),
    null,
  );
  assert.deepEqual(holderFromLsof('p321\ncnode\nf23\n'), {
    pid: 321,
    name: 'node',
  });
  assert.equal(holderFromLsof(''), null);
  assert.equal(
    portInUseText(1, null),
    'Port 1 is already in use by another program.',
  );
  assert.equal(
    portInUseText(1, { pid: 2, name: null }),
    'Port 1 is already in use by process 2.',
  );
});

test('a real listener is busy and, where the system can tell, held by this process', async (t) => {
  const s = createServer();
  s.listen(0, '127.0.0.1');
  await once(s, 'listening');
  t.after(() => s.close());
  const port = (s.address() as { port: number }).port;
  assert.equal(await portFree(port), false);
  const holder = await portHolder(port);
  if (holder) assert.equal(holder.pid, process.pid);
  else t.diagnostic('no lsof/netstat here: the holder is "another program"');
});

test('a paired worker sends the owner to the web app in front of its API', async () => {
  const { approvalOrigin } = (await import(
    new URL('../../apps/desktop/worker.mjs', import.meta.url).href
  )) as {
    approvalOrigin(api: string, hosted: boolean, web?: string): string;
  };
  assert.equal(
    approvalOrigin('http://127.0.0.1:4310', false),
    'http://127.0.0.1:5173',
  );
  assert.equal(
    approvalOrigin('http://127.0.0.1:4410', false),
    'http://127.0.0.1:5273',
  );
  // A moved dev API answers the approval page itself, unless its web app is named.
  assert.equal(
    approvalOrigin('http://127.0.0.1:4411', false),
    'http://127.0.0.1:4411',
  );
  assert.equal(
    approvalOrigin('http://127.0.0.1:4411', false, 'http://127.0.0.1:5274/x'),
    'http://127.0.0.1:5274',
  );
  assert.throws(() =>
    approvalOrigin('http://127.0.0.1:4410', false, 'http://example.org'),
  );
  assert.equal(
    approvalOrigin(
      'https://api.example.org',
      true,
      'https://studio.example.org',
    ),
    'https://studio.example.org',
  );
});
