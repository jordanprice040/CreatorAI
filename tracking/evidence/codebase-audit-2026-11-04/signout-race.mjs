import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { ConnectionStore } from '../../../packages/db/dist/index.js';
import {
  MemoryVault,
  PlanConnectionService,
} from '../../../packages/broker/dist/index.js';
import { freshDatabase } from '../../../tests/dist/pg-harness.js';
import { fakePlan } from '../../../tests/dist/plan-fakes.js';

const cleanup = [];
const db = await freshDatabase({
  after(fn) {
    cleanup.push(fn);
  },
  skip() {
    throw Error('test DB required');
  },
});
const fake = await fakePlan();
try {
  const store = new ConnectionStore(db.pool);
  const ctx = { actorId: randomUUID() };
  await store.ensureActor({
    id: ctx.actorId,
    kind: 'human',
    display_name: 'Audit synthetic owner',
  });
  const ws = await store.createWorkspace(ctx, {
    name: 'Audit signout race',
    record_mode: 'fixture',
  });
  const settings = JSON.parse(
    await readFile(
      new URL('../../../config/connections/chatgpt-plan.json', import.meta.url),
      'utf8',
    ),
  );
  const conn = await store.createPlanConnection(ctx, ws.id, {
    label: 'Audit fixture',
    settings,
  });
  const service = new PlanConnectionService({
    store,
    vault: new MemoryVault(),
    fixtureEndpoints: { auth_base: fake.auth_base, api_base: fake.api_base },
    callbackPort: 0,
    openBrowser() {},
  });
  const first = await service.beginSignIn(ctx, ws.id, conn.id, {
    open_browser: false,
  });
  await fake.approve(first.authorization_url);
  for (
    let n = 0;
    n < 100 && service.signInStatus(conn.id)?.state === 'pending';
    n++
  )
    await new Promise((r) => setTimeout(r, 10));
  assert.equal(
    (await store.planConnectionDetail(ctx, ws.id, conn.id)).connection.sign_in
      .state,
    'signed_in',
  );
  const attempt = await service.beginSignIn(ctx, ws.id, conn.id, {
    open_browser: false,
  });
  await service.signOut(ctx, ws.id, conn.id);
  assert.equal(
    (await store.planConnectionDetail(ctx, ws.id, conn.id)).connection.sign_in
      .state,
    'signed_out',
  );
  await fake.approve(attempt.authorization_url);
  for (
    let n = 0;
    n < 100 && service.signInStatus(conn.id)?.state === 'pending';
    n++
  )
    await new Promise((r) => setTimeout(r, 10));
  const state = (await store.planConnectionDetail(ctx, ws.id, conn.id))
    .connection.sign_in.state;
  console.log(
    JSON.stringify({
      after_signout: 'signed_out',
      after_old_callback: state,
      attempt: service.signInStatus(conn.id)?.state,
      fixture_only: true,
    }),
  );
  assert.equal(
    state,
    'signed_in',
    'reproduces: old browser callback reverses sign-out',
  );
} finally {
  await fake.close();
  for (const fn of cleanup.reverse()) await fn();
}
