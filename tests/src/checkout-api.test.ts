import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { ContractError } from '@creator/contracts';
import { NANO_PER_CENT } from '@creator/domain';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { verifiedRelease } from './payments-harness.js';

const SECRET = 'whsec_checkout_fixture_0123456789';

// Runbook step 3: the Payments page's checkout screen, through the HTTP routes it calls. The
// test buyer drives the labelled simulated processor; only a correctly signed delivery
// through the webhook path changes access or the ledger.
test('checkout screen routes: test buyer, signed delivery, duplicates, out-of-order events, refunds and disputes', async (t) => {
  const closers: (() => Promise<void>)[] = [];
  t.after(async () => {
    for (const c of closers) await c();
  });
  const db = await freshDatabase(t);
  if (!db) return;
  const start = async () => {
    const api = createApi(
      {
        CREATOR_DATABASE_URL: db.url,
        CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
        CREATOR_WORKER: 'off',
        CREATOR_PAYMENTS_HOOK: SECRET,
      },
      {},
    );
    api.server.listen(0, '127.0.0.1');
    await once(api.server, 'listening');
    closers.push(api.close);
    await api.ready();
    const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
    const auth = await login(base);
    const call = async (path: string, body?: unknown) => {
      const r = await fetch(`${base}/${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers:
          body === undefined
            ? auth.read
            : { 'Content-Type': 'application/json', ...auth.write },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return { status: r.status, body: (await r.json()) as any };
    };
    return { api, base, call };
  };
  const { api, base, call } = await start();
  const ws = (
    await call('workspaces', { name: 'Checkout', record_mode: 'fixture' })
  ).body.id as string;
  const w = `workspaces/${ws}`;
  const conn = (
    await call(`${w}/payment-connections`, {
      label: 'Simulated processor',
      processor: 'fixture',
      mode: 'fixture',
      account_id: 'acct_fixture0001',
      secret_key_env: null,
      webhook_secret_env: 'CREATOR_PAYMENTS_HOOK',
    })
  ).body;
  await call(`${w}/payment-connections/${conn.id}/verify`, {});
  const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };
  const release = await verifiedRelease(api.store!, db.pool, ws, owner);
  const offer = (
    await call(`${w}/payment-offers`, {
      connection_id: conn.id,
      artifact_id: release.artifact_id,
      manifest_sha256: release.manifest_sha256,
      label: 'Fixture app',
      price_nano_usd: (2500n * NANO_PER_CENT).toString(),
    })
  ).body;
  const back = `${base}/payments/return`;
  const open = async (customer_ref: string) => {
    const r = await call(`${w}/payment-checkouts`, {
      offer_id: offer.id,
      customer_ref,
      success_url: back,
      cancel_url: back,
    });
    assert.equal(r.status, 201);
    assert.equal(r.body.state, 'open');
    return r.body.id as string;
  };
  const access = async (customer: string) =>
    (
      await call(
        `${w}/entitlements/check?artifact_id=${release.artifact_id}&customer_ref=${customer}`,
      )
    ).body.granted as boolean;
  const entitlement = async (customer: string) =>
    (await call(`${w}/entitlements?customer_ref=${customer}`)).body[0]
      ?.status as string | undefined;
  const act = (id: string, action: string) =>
    call(`${w}/payment-checkouts/${id}/buyer`, { action });
  const deliver = async (id: string, event_id: string, signature = 'valid') => {
    const r = await call(`${w}/payment-checkouts/${id}/deliver`, {
      event_id,
      signature,
    });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    return r.body.events.find((e: any) => e.id === event_id).deliveries.at(-1);
  };

  assert.deepEqual((await call(`${w}/payment-checkouts`)).body, []);
  const a = await open('buyer-a');
  assert.equal((await call(`${w}/payment-checkouts`)).body[0].id, a);
  let state = (await call(`${w}/payment-checkouts/${a}/buyer`)).body;
  assert.deepEqual(
    [state.available, state.payment, state.allowed],
    [true, null, ['pay']],
  );

  // Paying queues an event; nothing is granted until a signed delivery is read back.
  state = (await act(a, 'pay')).body;
  assert.equal(state.payment.amount_cents, 2500);
  assert.equal(state.events.length, 1);
  const paid = state.events[0].id as string;
  assert.equal(await access('buyer-a'), false);
  // A second pay on the same checkout is refused: one checkout, one payment.
  assert.equal((await act(a, 'pay')).status, 409);
  for (const bad of ['wrong_secret', 'expired']) {
    const d = await deliver(a, paid, bad);
    assert.equal(d.http_status, 400, bad);
    assert.equal(await access('buyer-a'), false, bad);
  }
  assert.equal(
    (await call(`${w}/payment-connections/${conn.id}/events`)).body.length,
    0,
    'Refused signatures leave no durable receipt.',
  );
  assert.deepEqual(
    await deliver(a, paid).then((d: any) => d.outcome),
    'applied',
  );
  assert.equal(await access('buyer-a'), true);
  assert.equal((await deliver(a, paid)).outcome, 'duplicate');
  let balances = (await call(`${w}/ledger/balances`)).body;
  assert.equal(balances.total_nano, '0');
  assert.equal(balances.balances.revenue, (-2500n * NANO_PER_CENT).toString());

  // A dispute suspends access; losing it revokes for good.
  state = (await act(a, 'dispute')).body;
  assert.deepEqual(state.allowed.sort(), [
    'dispute_lost',
    'dispute_won',
    'settle',
  ]);
  await deliver(a, state.events.at(-1).id);
  assert.equal(await entitlement('buyer-a'), 'suspended');
  state = (await act(a, 'dispute_lost')).body;
  await deliver(a, state.events.at(-1).id);
  assert.equal(await entitlement('buyer-a'), 'revoked');
  assert.equal((await act(a, 'refund')).status, 409);

  // Out of order: the refund's event arrives before the payment's. Both read the processor,
  // so access ends revoked and the ledger matches either way round.
  const b = await open('buyer-b');
  const bPaid = (await act(b, 'pay')).body.events[0].id as string;
  const bRefund = (await act(b, 'refund')).body.events[1].id as string;
  assert.equal((await deliver(b, bRefund)).outcome, 'applied');
  assert.equal(await entitlement('buyer-b'), 'revoked');
  assert.equal(await access('buyer-b'), false);
  await deliver(b, bPaid);
  assert.equal(await entitlement('buyer-b'), 'revoked');
  balances = (await call(`${w}/ledger/balances`)).body;
  assert.equal(balances.total_nano, '0');
  assert.equal(balances.balances.refunds, (2500n * NANO_PER_CENT).toString());

  // A request the processor would not accept is refused before anything changes.
  assert.equal((await act(b, 'teleport')).status, 400);
  assert.equal(
    (
      await call(`${w}/payment-checkouts/${b}/deliver`, {
        event_id: 'evt_fxtestmissing',
        signature: 'valid',
      })
    ).status,
    404,
  );

  // Editors and viewers can't list checkouts or act as the test buyer.
  const store = api.store!;
  for (const role of ['editor', 'viewer'] as const) {
    const actor = { actorId: randomUUID() };
    await store.ensureActor({
      id: actor.actorId,
      kind: 'human',
      display_name: role,
    });
    await store.addMember(owner, ws, actor.actorId, role);
    for (const [name, write] of [
      ['list', () => store.listCheckouts(actor, ws)],
      ['test buyer', () => store.testBuyerTarget(actor, ws, a, 'pay')],
    ] as const)
      await assert.rejects(
        write(),
        (e: unknown) =>
          e instanceof ContractError && e.code === 'ACCESS_DENIED',
        `${role}: ${name}`,
      );
  }

  // A newer build of the same spec replaces the release: new checkouts for its old offer
  // are refused, so nobody pays for the replaced one.
  const h = (s: string) => createHash('sha256').update(s).digest('hex');
  await db.pool.query(
    `insert into artifact_manifests (id, workspace_id, entity_id, product_id, spec_id,
       spec_version, freeze_id, commit, state, manifest, manifest_sha256, archive_sha256,
       created_by, created_at)
     select $1, workspace_id, entity_id, product_id, spec_id, spec_version, freeze_id,
       commit, state, manifest, $2, archive_sha256, created_by, created_at + interval '1 second'
     from artifact_manifests where id = $3`,
    [randomUUID(), h('newer'), release.artifact_id],
  );
  const refused = await call(`${w}/payment-checkouts`, {
    offer_id: offer.id,
    customer_ref: 'buyer-c',
    success_url: back,
    cancel_url: back,
  });
  assert.equal(refused.status, 409);
  assert.match(
    refused.body.message ?? JSON.stringify(refused.body),
    /replaced/,
  );

  // The simulated processor lives in API memory: after a restart the test buyer says so.
  const again = await start();
  const after = (await again.call(`${w}/payment-checkouts/${b}/buyer`)).body;
  assert.deepEqual(
    [after.available, after.allowed, after.events],
    [false, [], []],
  );
  assert.equal(
    (
      await again.call(`${w}/payment-checkouts/${b}/buyer`, {
        action: 'settle',
      })
    ).status,
    409,
  );
});
