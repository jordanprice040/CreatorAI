// U02 independent review reproductions (fixture only): real ConnectionStore on a disposable
// PostgreSQL database named by CREATOR_TEST_DATABASE_URL, MemoryVault, loopback fake OAuth.
// No provider, credential or studio database is used. Prints one JSON line per scenario.
// Run from the repository root after `tsc -b`, with a supported Node.
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { CREDITS_OFF_STATEMENT } from '../../../packages/contracts/dist/index.js';
import { ConnectionStore } from '../../../packages/db/dist/index.js';
import {
  MemoryVault,
  PlanConnectionService,
} from '../../../packages/broker/dist/index.js';
import { freshDatabase } from '../../../tests/dist/pg-harness.js';
import { fakePlan } from '../../../tests/dist/plan-fakes.js';

const settings = JSON.parse(
  await readFile(
    new URL('../../../config/connections/chatgpt-plan.json', import.meta.url),
    'utf8',
  ),
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (f) => {
  for (let i = 0; i < 300; i++) {
    if (await f()) return;
    await sleep(10);
  }
  throw Error('timed out');
};
const gate = () => {
  let open, enter;
  const g = new Promise((r) => (open = r));
  const e = new Promise((r) => (enter = r));
  return { g, e, open, enter };
};

async function setup(fakeOpts = {}) {
  const cleanup = [];
  const db = await freshDatabase({
    after: (fn) => cleanup.push(fn),
    skip() {
      throw Error('test DB required');
    },
  });
  const store = new ConnectionStore(db.pool);
  const owner = { actorId: randomUUID() };
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'review synthetic owner',
  });
  const fake = await fakePlan(fakeOpts);
  cleanup.push(() => fake.close());
  const vault = new MemoryVault();
  const deps = {
    store,
    vault,
    fixtureEndpoints: { auth_base: fake.auth_base, api_base: fake.api_base },
    openBrowser() {},
    callbackPort: 0,
  };
  const service = new PlanConnectionService(deps);
  const ws = await store.createWorkspace(owner, {
    name: 'U02 review',
    record_mode: 'fixture',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'Fixture plan',
    settings,
  });
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  const signIn = async (svc = service) => {
    const s = await svc.beginSignIn(owner, ws.id, conn.id, {
      open_browser: false,
    });
    await fake.approve(s.authorization_url);
    await until(() => svc.signInStatus(conn.id)?.state !== 'pending');
    return svc.signInStatus(conn.id);
  };
  const ready = async () => {
    let c = await current();
    await store.attestPlanCredits(owner, ws.id, c.id, {
      expected_version: c.version,
      statement: CREDITS_OFF_STATEMENT,
      checked_on: '2026-10-20',
    });
    c = await current();
    await store.acceptPlanCaps(owner, ws.id, c.id, {
      expected_version: c.version,
      settings_hash: c.settings_hash,
    });
    return current();
  };
  const done = async () => {
    for (const fn of cleanup.reverse()) await fn();
  };
  return {
    store,
    owner,
    fake,
    vault,
    deps,
    service,
    ws,
    conn,
    current,
    signIn,
    ready,
    done,
  };
}
const out = (o) => console.log(JSON.stringify({ fixture_only: true, ...o }));
const scenario = async (name, f) => {
  try {
    await f();
  } catch (e) {
    out({ scenario: name, harness_error: String(e?.stack ?? e).slice(0, 600) });
  }
};

// 1. Audit reproduction: signed in -> Sign in again -> Disconnect -> old callback completes.
await scenario('audit_old_callback_after_disconnect', async () => {
  const s = await setup();
  try {
    await s.signIn();
    const again = await s.service.beginSignIn(s.owner, s.ws.id, s.conn.id, {
      open_browser: false,
    });
    await s.service.signOut(s.owner, s.ws.id, s.conn.id);
    const status = await s.fake.approve(again.authorization_url);
    await sleep(500);
    out({
      scenario: 'audit_old_callback_after_disconnect',
      callback_http: status,
      state: (await s.current()).sign_in.state,
      attempt: s.service.signInStatus(s.conn.id),
    });
  } finally {
    await s.done();
  }
});

// 2. A request in flight at Disconnect returns 401 afterwards (optionally after a newer sign-in).
async function lateUnauthorized(resign) {
  const name = resign
    ? 'late_401_after_newer_sign_in'
    : 'late_401_after_disconnect';
  await scenario(name, async () => {
    const s = await setup({
      responses: [{ kind: 'error', status: 401, code: 'invalid_token' }],
    });
    try {
      await s.signIn();
      const c = await s.ready();
      const grant = await s.store.createPlanVerificationGrant(
        s.owner,
        s.ws.id,
        c.id,
        {
          expected_version: c.version,
          model_id: 'm',
          path: 'responses',
          expires_in_minutes: 5,
        },
      );
      const g = gate();
      const svc = new PlanConnectionService({
        ...s.deps,
        fetchImpl: async (url, init) => {
          if (String(url).endsWith('/responses')) {
            g.enter();
            await g.g;
          }
          return fetch(url, init);
        },
      });
      const pending = svc
        .invoke(s.owner, s.ws.id, {
          connection_id: c.id,
          logical_operation_id: randomUUID(),
          purpose: 'verification',
          model_id: 'm',
          task_class: null,
          data_class: 'synthetic',
          run_id: null,
          grant_id: grant.id,
          instructions: 'fixture',
          input: 'fixture',
        })
        .then(
          (r) => ({ outcome: r.outcome?.kind ?? 'returned' }),
          (e) => ({ error: e.code ?? String(e) }),
        );
      await g.e;
      await s.service.signOut(s.owner, s.ws.id, s.conn.id);
      const afterDisconnect = (await s.current()).sign_in.state;
      if (resign) await s.signIn();
      const beforeLate = await s.current();
      g.open();
      const result = await pending;
      const after = await s.current();
      out({
        scenario: name,
        after_disconnect: afterDisconnect,
        before_late_result: beforeLate.sign_in.state,
        before_version: beforeLate.version,
        invoke: result,
        after_late_result: after.sign_in.state,
        after_version: after.version,
        status_reason: after.status_reason,
      });
    } finally {
      await s.done();
    }
  });
}
await lateUnauthorized(false);
await lateUnauthorized(true);

// 3. An unrelated owner change (credits confirmation) while a first sign-in waits for the browser.
await scenario('credits_confirmed_during_first_sign_in', async () => {
  const s = await setup();
  try {
    const started = await s.service.beginSignIn(s.owner, s.ws.id, s.conn.id, {
      open_browser: false,
    });
    const c = await s.current();
    await s.store.attestPlanCredits(s.owner, s.ws.id, c.id, {
      expected_version: c.version,
      statement: CREDITS_OFF_STATEMENT,
      checked_on: '2026-10-20',
    });
    await s.fake.approve(started.authorization_url);
    await until(() => s.service.signInStatus(s.conn.id)?.state !== 'pending');
    out({
      scenario: 'credits_confirmed_during_first_sign_in',
      attempt: s.service.signInStatus(s.conn.id),
      state: (await s.current()).sign_in.state,
    });
  } finally {
    await s.done();
  }
});

// 4. Token refresh by a model call while "Sign in again" waits for the browser.
await scenario('refresh_during_sign_in_again', async () => {
  const s = await setup({ refresh: 'rotate' });
  try {
    await s.signIn();
    const again = await s.service.beginSignIn(s.owner, s.ws.id, s.conn.id, {
      open_browser: false,
    });
    const ref = (await s.store.planCredentialRef(s.owner, s.ws.id, s.conn.id))
      .credential_ref;
    await s.vault.put(ref, {
      ...(await s.vault.get(ref)),
      expires_at: new Date(0).toISOString(),
    });
    await s.service.accessToken(s.owner, s.ws.id, s.conn.id);
    await s.fake.approve(again.authorization_url);
    await until(() => s.service.signInStatus(s.conn.id)?.state !== 'pending');
    out({
      scenario: 'refresh_during_sign_in_again',
      attempt: s.service.signInStatus(s.conn.id),
      state: (await s.current()).sign_in.state,
    });
  } finally {
    await s.done();
  }
});

// 5. Two service instances refresh the same expired token concurrently (rotating refresh tokens).
await scenario('two_instance_concurrent_refresh', async () => {
  const s = await setup({ refresh: 'rotate' });
  try {
    await s.signIn();
    const ref = (await s.store.planCredentialRef(s.owner, s.ws.id, s.conn.id))
      .credential_ref;
    await s.vault.put(ref, {
      ...(await s.vault.get(ref)),
      expires_at: new Date(0).toISOString(),
    });
    const other = new PlanConnectionService(s.deps);
    const both = await Promise.allSettled([
      s.service.accessToken(s.owner, s.ws.id, s.conn.id),
      other.accessToken(s.owner, s.ws.id, s.conn.id),
    ]);
    out({
      scenario: 'two_instance_concurrent_refresh',
      results: both.map((r) =>
        r.status === 'fulfilled'
          ? 'token'
          : `${r.reason.code}: ${r.reason.message}`,
      ),
      state: (await s.current()).sign_in.state,
      refresh_requests: s.fake.tokenRequests.filter(
        (r) => r.grant_type === 'refresh_token',
      ).length,
    });
  } finally {
    await s.done();
  }
});
