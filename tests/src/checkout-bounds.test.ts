import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { PaymentService } from '@creator/broker';
import { ContractError } from '@creator/contracts';
import { NANO_PER_CENT } from '@creator/domain';
import { freshDatabase, LOGIN_CODE } from './pg-harness.js';
import { verifiedRelease } from './payments-harness.js';

const SECRET = 'whsec_checkout_bounds_0123456789';

// The test buyer's in-memory bounds (ADR-0045): a forgotten buyer can't be paid twice, and
// concurrent deliveries can't get past the per-event cap.
test('test buyer bounds: an evicted checkout reads forgotten and cannot pay again; concurrent deliveries stop at the cap', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi(
    {
      CREATOR_DATABASE_URL: db.url,
      CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
      CREATOR_WORKER: 'off',
    },
    {},
  );
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  await api.ready();
  const store = api.store!;
  const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };
  const hook = { actorId: '00000000-0000-4000-8000-000000000007' };
  const service = new PaymentService(store, {
    env: { CREATOR_PAYMENTS_HOOK: SECRET },
    testBuyerLimit: 1,
  });
  const ws = (
    await store.createWorkspace(owner, {
      name: 'Bounds',
      record_mode: 'fixture',
    })
  ).id;
  const conn = await store.registerPaymentConnection(owner, ws, {
    label: 'Simulated processor',
    processor: 'fixture',
    mode: 'fixture',
    account_id: 'acct_fixture0001',
    secret_key_env: null,
    webhook_secret_env: 'CREATOR_PAYMENTS_HOOK',
  });
  await service.verify(owner, ws, conn.id);
  const release = await verifiedRelease(store, db.pool, ws, owner);
  const offer = await store.createOffer(owner, ws, {
    connection_id: conn.id,
    artifact_id: release.artifact_id,
    manifest_sha256: release.manifest_sha256,
    label: 'Bounds app',
    price_nano_usd: (2500n * NANO_PER_CENT).toString(),
  });
  const open = async (customer_ref: string) =>
    (
      await service.checkout(owner, ws, {
        offer_id: offer.id,
        customer_ref,
        success_url: 'http://127.0.0.1/api/payments/return',
        cancel_url: 'http://127.0.0.1/api/payments/return',
      })
    ).id;

  const a = await open('buyer-a');
  const paid = await service.testBuyerAct(owner, ws, a, { action: 'pay' });
  assert.ok(paid.payment);
  // Touching a second checkout evicts the first (limit 1): it reads forgotten, offers
  // nothing, and a second payment is refused.
  const b = await open('buyer-b');
  assert.equal((await service.testBuyerState(owner, ws, b)).available, true);
  const forgotten = await service.testBuyerState(owner, ws, a);
  assert.deepEqual(
    [forgotten.available, forgotten.allowed, forgotten.payment],
    [false, [], null],
  );
  await assert.rejects(
    service.testBuyerAct(owner, ws, a, { action: 'pay' }),
    (e: unknown) =>
      e instanceof ContractError &&
      /no longer has this checkout/.test(e.message),
  );

  // Looking at the forgotten checkout did not set the live one aside.
  assert.equal((await service.testBuyerState(owner, ws, b)).available, true);

  // 25 concurrent deliveries of one event: exactly 20 are accepted, the rest refused.
  const event = (await service.testBuyerAct(owner, ws, b, { action: 'pay' }))
    .events[0]!.id;
  const results = await Promise.allSettled(
    Array.from({ length: 25 }, () =>
      service.testBuyerDeliver(owner, hook, ws, b, {
        event_id: event,
        signature: 'valid',
      }),
    ),
  );
  const refused = results.filter((r) => r.status === 'rejected');
  assert.equal(results.length - refused.length, 20);
  assert.ok(
    refused.every(
      (r) =>
        (r as PromiseRejectedResult).reason instanceof ContractError &&
        (r as PromiseRejectedResult).reason.code === 'BUDGET_EXCEEDED',
    ),
  );
  const final = await service.testBuyerState(owner, ws, b);
  assert.equal(final.events[0]!.deliveries.length, 20);
  assert.equal(
    final.events[0]!.deliveries.filter((d) => d.outcome === 'applied').length,
    1,
  );
});
