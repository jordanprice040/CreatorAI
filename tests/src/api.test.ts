import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { get } from 'node:http';
import { createApi } from '@creator/api';
import { parse, HealthSchema, FixtureResponseSchema } from '@creator/contracts';
import { fixtureAssignment } from '@creator/domain';
const exec = promisify(execFile);

test('real HTTP health/fixture/validation paths enforce shape, scope and bounded bodies', async (t) => {
  const { server } = createApi();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const base = `http://127.0.0.1:${address.port}`;
  const post = (
    path: string,
    body: unknown,
    headers: Record<string, string> = {},
  ) =>
    fetch(base + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  const healthInfo = parse(HealthSchema, await health.json());
  assert.equal(healthInfo.data_mode, 'fixture');
  assert.equal(healthInfo.maintenance.enabled, false);
  assert.equal(healthInfo.maintenance.degraded, false);
  assert.equal(healthInfo.portfolio_scheduler.state, 'off'); // off unless the owner turns it on
  assert.deepEqual(Object.keys(healthInfo.maintenance.jobs), [
    'outbox',
    'broker_recovery',
    'retrieval_recovery',
    'notifications',
  ]);
  const response = await post('/api/fixture', {
    goal: 'Synthetic HTTP task',
    outcome: 'human_led',
  });
  assert.equal(response.status, 200);
  assert.equal(
    parse(FixtureResponseSchema, await response.json()).product.stage,
    'human_led_recommended',
  );
  for (const body of [
    { goal: '', outcome: 'build' },
    { goal: 'task', outcome: 'build', live: true },
    { goal: 'x'.repeat(501), outcome: 'build' },
  ]) {
    const invalid = await post('/api/fixture', body);
    assert.equal(invalid.status, 400);
    assert.equal((await invalid.json()).error.code, 'INVALID_CONTRACT');
  }
  const malformed = await fetch(`${base}/api/fixture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{',
  });
  assert.equal(malformed.status, 400);
  assert.equal(
    (await post('/api/fixture', { goal: 'x'.repeat(70000), outcome: 'build' }))
      .status,
    413,
  );
  assert.equal(
    (
      await post(
        '/api/fixture',
        { goal: 'Task', outcome: 'build' },
        { Origin: 'https://untrusted.example' },
      )
    ).status,
    403,
  );
  // fetch normalizes Host on this runtime; use raw HTTP to exercise the hostile header.
  const hostileHostStatus = await new Promise<number | undefined>(
    (resolve, reject) => {
      get(
        `${base}/api/health`,
        { headers: { Host: 'untrusted.example' } },
        (res) => {
          res.resume();
          resolve(res.statusCode);
        },
      ).on('error', reject);
    },
  );
  assert.equal(hostileHostStatus, 403);
  assert.equal(
    (
      await post('/api/validate', {
        kind: 'task',
        value: fixtureAssignment().task,
      })
    ).status,
    200,
  );
  assert.equal(
    (await post('/api/validate', { kind: 'task', value: {} })).status,
    400,
  );
  assert.equal(
    (await post('/api/validate', { kind: '__proto__', value: {} })).status,
    400,
  );
  assert.equal((await fetch(`${base}/missing`)).status, 404);
});
test('compiled CLI reaches the HTTP API and fails visibly when unavailable', async (t) => {
  const { server } = createApi();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const env = {
    ...process.env,
    CREATOR_API_URL: `http://127.0.0.1:${address.port}`,
  };
  const health = await exec(
    process.execPath,
    ['apps/cli/dist/main.js', 'health'],
    { env, timeout: 10000 },
  );
  assert.equal(JSON.parse(health.stdout).status, 'ok');
  const demo = await exec(
    process.execPath,
    ['apps/cli/dist/main.js', 'demo', 'change_process', 'Synthetic CLI task'],
    { env, timeout: 10000 },
  );
  assert.equal(
    JSON.parse(demo.stdout).product.stage,
    'nonsoftware_recommended',
  );
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await assert.rejects(
    exec(process.execPath, ['apps/cli/dist/main.js', 'health'], {
      env,
      timeout: 10000,
    }),
    (e: unknown) =>
      e !== null && typeof e === 'object' && 'code' in e && e.code === 1,
  );
});
test('health reports configured live adapters instead of always claiming fixture mode', async (t) => {
  const { server } = createApi({
    CREATOR_LIVE_PROVIDER: 'openai',
    OPENAI_API_KEY: 'sk-test-not-a-real-key',
    CREATOR_SOURCE_FETCH: 'live',
    CREATOR_SOURCE_HOSTS: 'example.org',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const { port } = server.address() as { port: number };
  const raw = await (await fetch(`http://127.0.0.1:${port}/api/health`)).text();
  const health = parse(HealthSchema, JSON.parse(raw));
  assert.equal(health.data_mode, 'live_configured');
  assert.equal(health.live_enabled, true);
  assert.deepEqual(health.live, {
    model: 'configured_unverified',
    sources: 'configured_unverified',
  });
  assert.ok(!raw.includes('sk-test'), 'the key never appears in health');
});
