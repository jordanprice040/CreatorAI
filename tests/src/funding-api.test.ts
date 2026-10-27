import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { ContractError } from '@creator/contracts';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const USD = 1_000_000_000n;

// The Payments page's funding section, through the same HTTP routes the page calls: owner
// funding survives a retried request once, commitments list and close, recorded balances
// feed usable cash, and a policy alone creates no budget.
test('funding screen routes: owner funding, sources, commitments and policy', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const post = async (path: string, body: unknown, key?: string) => {
    const r = await fetch(`${base}/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...auth.write,
        ...(key ? { 'Idempotency-Key': key } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: r.status, body: (await r.json()) as any };
  };
  const get = async (path: string) =>
    (await (
      await fetch(`${base}/${path}`, { headers: auth.read })
    ).json()) as any;
  const ws = (
    await post('workspaces', { name: 'Funding screen', record_mode: 'fixture' })
  ).body.id as string;
  const w = `workspaces/${ws}`;

  // A retried owner-funding request (same key, same body) posts one entry, not two.
  const funding = { amount_nano_usd: String(40n * USD), evidence: 'Savings' };
  const first = await post(
    `${w}/ledger/owner-funding`,
    funding,
    'fund:retry-01',
  );
  const again = await post(
    `${w}/ledger/owner-funding`,
    funding,
    'fund:retry-01',
  );
  assert.equal(first.status, 201);
  assert.equal(again.body.entry_id, first.body.entry_id);
  const reused = await post(
    `${w}/ledger/owner-funding`,
    { ...funding, amount_nano_usd: String(41n * USD) },
    'fund:retry-01',
  );
  assert.equal(reused.status, 409);
  const balances = await get(`${w}/ledger/balances`);
  assert.equal(balances.balances.bank, String(40n * USD));
  assert.equal(balances.balances.owner_funding, String(-40n * USD));
  // Owner funding is not earnings and not usable cash by itself.
  let cap = await get(`${w}/reinvestment`);
  assert.equal(cap.binding, 'policy_disabled');
  assert.equal(cap.parts.rails_available_nano, '0');
  assert.deepEqual(await get(`${w}/reinvestment/tranches`), []);

  // A recorded balance on an owner-attested source counts toward usable cash.
  const rail = await post(`${w}/funding-rails`, {
    label: 'Checking',
    kind: 'owner_attested',
    connection_id: null,
  });
  assert.equal(rail.status, 201);
  assert.equal((await get(`${w}/funding-rails`))[0].available_nano, null);
  assert.equal(
    (
      await post(`${w}/funding-rails/${rail.body.id}/attest`, {
        available_nano_usd: String(10n * USD),
        evidence: 'Bank app',
      })
    ).status,
    200,
  );
  const [listed] = await get(`${w}/funding-rails`);
  assert.equal(listed.available_nano, String(10n * USD));
  assert.ok(Date.parse(listed.expires_at) > Date.now());

  // Commitments: listed open first, held back from cash, then closed once.
  const bill = await post(`${w}/commitments`, {
    kind: 'liability',
    label: 'Hosting bill',
    amount_nano_usd: String(3n * USD),
  });
  assert.equal(bill.status, 201);
  await post(`${w}/commitments`, {
    kind: 'tax',
    label: 'Quarterly tax',
    amount_nano_usd: String(2n * USD),
  });
  let commitments = await get(`${w}/commitments`);
  assert.equal(commitments.length, 2);
  assert.ok(commitments.every((c: any) => c.status === 'open'));
  cap = await get(`${w}/reinvestment`);
  assert.equal(cap.parts.commitments_nano, String(5n * USD));
  assert.equal(cap.usable_liquidity_nano, String(5n * USD));
  assert.equal(
    (await post(`${w}/commitments/${bill.body.id}/close`, {})).status,
    200,
  );
  assert.equal(
    (await post(`${w}/commitments/${bill.body.id}/close`, {})).status,
    409,
  );
  commitments = await get(`${w}/commitments`);
  assert.deepEqual(
    commitments.map((c: any) => [c.label, c.status]),
    [
      ['Quarterly tax', 'open'],
      ['Hosting bill', 'closed'],
    ],
  );
  assert.ok(commitments[1].closed_at);
  assert.equal(
    (await get(`${w}/reinvestment`)).parts.commitments_nano,
    String(2n * USD),
  );

  // A policy that is on still creates no budget without settled earnings.
  const policy = {
    enabled: true,
    eligible_bps: 2500,
    holdback_days: 30,
    period_days: 30,
    period_cap_nano_usd: String(5n * USD),
    min_reserve_nano_usd: String(1n * USD),
    rationale: 'Screen test',
  };
  const set = await post(`${w}/reinvestment/policy`, policy);
  assert.equal(set.status, 201);
  assert.equal((await get(`${w}/reinvestment/policy`)).version, 1);
  cap = await get(`${w}/reinvestment`);
  assert.equal(cap.enabled, true);
  assert.equal(cap.capacity_nano, '0');
  assert.equal(cap.binding, 'eligible_tranches');
  const refused = await post(
    `${w}/reinvestment/allocations`,
    {
      amount_nano_usd: String(USD),
      allow_partial: true,
      envelope_name: 'Reinvested earnings',
      max_in_flight: 1,
      target: 'standalone',
    },
    'reinvest:screen-01',
  );
  assert.equal(refused.status, 409);
  assert.equal(refused.body.error.code, 'BUDGET_EXCEEDED');
  assert.deepEqual(await get(`${w}/reinvestment/allocations`), []);

  // Adding a source or a commitment again with the same key (a lost response) adds nothing.
  const railBody = {
    label: 'Savings',
    kind: 'owner_attested',
    connection_id: null,
  };
  const r1 = await post(`${w}/funding-rails`, railBody, 'rail:retry-0001');
  const r2 = await post(`${w}/funding-rails`, railBody, 'rail:retry-0001');
  assert.equal(r2.body.id, r1.body.id);
  assert.equal((await get(`${w}/funding-rails`)).length, 2);
  const cBody = {
    kind: 'reserve',
    label: 'Buffer',
    amount_nano_usd: String(USD),
  };
  const c1 = await post(`${w}/commitments`, cBody, 'commit:retry-01');
  const c2 = await post(`${w}/commitments`, cBody, 'commit:retry-01');
  assert.equal(c2.body.id, c1.body.id);
  assert.equal((await get(`${w}/commitments`)).length, 3);

  // Commitments stay in their own workspace.
  const other = (
    await post('workspaces', { name: 'Other funding', record_mode: 'fixture' })
  ).body.id as string;
  await post(`workspaces/${other}/commitments`, {
    kind: 'tax',
    label: 'Other workspace tax',
    amount_nano_usd: String(7n * USD),
  });
  assert.deepEqual(
    (await get(`workspaces/${other}/commitments`)).map((c: any) => c.label),
    ['Other workspace tax'],
  );
  assert.ok(
    (await get(`${w}/commitments`)).every(
      (c: any) => c.label !== 'Other workspace tax',
    ),
  );

  // Editors and viewers can read the screen but every write the screen offers is refused.
  const store = api.store!;
  const owner = { actorId: DEFAULT_OWNER_ACTOR_ID };
  for (const role of ['editor', 'viewer'] as const) {
    const actor = { actorId: randomUUID() };
    await store.ensureActor({
      id: actor.actorId,
      kind: 'human',
      display_name: role,
    });
    await store.addMember(owner, ws, actor.actorId, role);
    assert.equal((await store.listCommitments(actor, ws)).length, 3);
    const writes: [string, () => Promise<unknown>][] = [
      ['owner funding', () => store.recordOwnerFunding(actor, ws, funding)],
      ['add source', () => store.registerRail(actor, ws, railBody)],
      [
        'record balance',
        () =>
          store.attestRail(actor, ws, rail.body.id, {
            available_nano_usd: String(USD),
            evidence: 'x',
          }),
      ],
      [
        'source status',
        () =>
          store.setRailStatus(actor, ws, rail.body.id, {
            status: 'unavailable',
            reason: 'x',
          }),
      ],
      ['add commitment', () => store.addCommitment(actor, ws, cBody)],
      ['close commitment', () => store.closeCommitment(actor, ws, c1.body.id)],
      ['policy', () => store.setReinvestmentPolicy(actor, ws, policy)],
      [
        'allocate',
        () =>
          store.allocateReinvestment(actor, ws, {
            amount_nano_usd: String(USD),
            allow_partial: true,
            envelope_name: 'x',
            max_in_flight: 1,
          }),
      ],
      ['repay losses', () => store.settleReinvestmentLosses(actor, ws)],
    ];
    for (const [name, write] of writes)
      await assert.rejects(
        write(),
        (e: unknown) =>
          e instanceof ContractError && e.code === 'ACCESS_DENIED',
        `${role}: ${name}`,
      );
  }
});
