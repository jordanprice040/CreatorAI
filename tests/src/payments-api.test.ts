import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { FixtureProcessor } from '@creator/broker';
import { NANO_PER_CENT } from '@creator/domain';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { verifiedRelease } from './payments-harness.js';

const exec = promisify(execFile);
const SECRET = 'whsec_api_fixture_0123456789';

// X07 through the real API and CLI with the labelled fixture processor: the checkout redirect
// grants nothing, a signed delivery over HTTP does, and unsigned deliveries are refused.
test('X07 API and CLI: offer, checkout, inert return page, signed webhook, entitlement and capacity', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const processors = new Map<string, FixtureProcessor>();
  const api = createApi(
    {
      CREATOR_DATABASE_URL: db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
      CREATOR_WORKER: 'off',
      CREATOR_PAYMENTS_HOOK: SECRET,
    },
    {
      paymentFixture: (conn) => {
        const p =
          processors.get(conn.id) ?? new FixtureProcessor(conn.body.account_id);
        processors.set(conn.id, p);
        return p;
      },
    },
  );
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const post = async (path: string, body: unknown) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const cliEnv = {
    ...process.env,
    CREATOR_API_URL: `http://127.0.0.1:${port}`,
    CREATOR_SESSION_FILE: join(
      await mkdtemp(join(tmpdir(), 'creator-cli-')),
      's.json',
    ),
  };
  const cli = async (...args: string[]) =>
    JSON.parse(
      (
        await exec(process.execPath, ['apps/cli/dist/main.js', ...args], {
          env: cliEnv,
          timeout: 30000,
        })
      ).stdout,
    );
  await cli('login', LOGIN_CODE);
  const ws = (
    await post('workspaces', { name: 'Payments API', record_mode: 'fixture' })
  ).body.id as string;
  const conn = await cli(
    'pay-connect',
    ws,
    JSON.stringify({
      label: 'Fixture processor',
      processor: 'fixture',
      mode: 'fixture',
      account_id: 'acct_fixture0001',
      secret_key_env: null,
      webhook_secret_env: 'CREATOR_PAYMENTS_HOOK',
    }),
  );
  assert.equal(conn.status, 'unverified');
  assert.equal((await cli('pay-verify', ws, conn.id)).status, 'active');
  const release = await verifiedRelease(api.store!, db.pool, ws, {
    actorId: DEFAULT_OWNER_ACTOR_ID,
  });
  const offer = await cli(
    'offer-create',
    ws,
    JSON.stringify({
      connection_id: conn.id,
      artifact_id: release.artifact_id,
      manifest_sha256: release.manifest_sha256,
      label: 'Fixture app',
      price_nano_usd: (2500n * NANO_PER_CENT).toString(),
    }),
  );
  const checkout = await cli(
    'checkout',
    ws,
    JSON.stringify({
      offer_id: offer.id,
      customer_ref: 'cust-api',
      success_url: `http://127.0.0.1:${port}/api/payments/return`,
      cancel_url: `http://127.0.0.1:${port}/api/payments/return`,
    }),
  );
  assert.equal(checkout.state, 'open');
  // A return URL that tries to carry an access flag is refused outright.
  assert.equal(
    (
      await post(`workspaces/${ws}/payment-checkouts`, {
        offer_id: offer.id,
        customer_ref: 'cust-api',
        success_url: 'http://127.0.0.1/x?paid=1',
        cancel_url: 'http://127.0.0.1/y',
      })
    ).status,
    400,
  );
  const fx = processors.get(conn.id)!;
  const pi = fx.pay(checkout.processor_session_id);
  // The buyer returns with whatever parameters they like: nothing is granted.
  const back = await fetch(
    `${base}/payments/return?session_id=${checkout.processor_session_id}&paid=true`,
  );
  assert.equal(back.status, 200);
  assert.equal(((await back.json()) as { granted: boolean }).granted, false);
  assert.equal(
    (await cli('entitlement-check', ws, release.artifact_id, 'cust-api'))
      .granted,
    false,
  );
  // Unsigned and forged deliveries over HTTP are refused; a signed one is applied.
  const hookUrl = `${base}/payments/webhooks/${conn.id}`;
  const forged = fx.event(
    'payment_intent.succeeded',
    { object: 'payment_intent', id: pi },
    'whsec_wrong',
  );
  const unsigned = await fetch(hookUrl, { method: 'POST', body: forged.raw });
  assert.equal(unsigned.status, 400);
  const bad = await fetch(hookUrl, {
    method: 'POST',
    headers: { 'Stripe-Signature': forged.signature },
    body: forged.raw,
  });
  assert.equal(bad.status, 400);
  const good = fx.event(
    'payment_intent.succeeded',
    { object: 'payment_intent', id: pi },
    SECRET,
  );
  const ok = await fetch(hookUrl, {
    method: 'POST',
    headers: {
      'Stripe-Signature': good.signature,
      'Content-Type': 'application/json',
    },
    body: good.raw,
  });
  assert.equal(ok.status, 200);
  assert.equal(((await ok.json()) as { outcome: string }).outcome, 'applied');
  const granted = await cli(
    'entitlement-check',
    ws,
    release.artifact_id,
    'cust-api',
  );
  assert.equal(granted.granted, true);
  assert.equal(granted.manifest_sha256, release.manifest_sha256);
  const again = await fetch(hookUrl, {
    method: 'POST',
    headers: { 'Stripe-Signature': good.signature },
    body: good.raw,
  });
  assert.equal(
    ((await again.json()) as { outcome: string }).outcome,
    'duplicate',
  );
  const balances = await cli('ledger-balances', ws);
  assert.equal(balances.total_nano, '0');
  assert.equal(balances.balances.revenue, (-2500n * NANO_PER_CENT).toString());
  assert.equal((await cli('pay-events', ws, conn.id)).length, 4);
  // Reinvestment is off until the owner sets a policy.
  assert.equal((await cli('reinvest', ws)).binding, 'policy_disabled');
  assert.equal(await cli('reinvest-policy', ws), null);
});
