// Independent U02 reproductions for the auth follow-up (fixture only). Real ConnectionStore on a
// disposable PostgreSQL named by CREATOR_TEST_DATABASE_URL, an observing MemoryVault and the
// loopback fake plan. No provider, credential or studio database is used. One JSON line each.
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
  for (let i = 0; i < 500; i++) {
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

class ObservedVault extends MemoryVault {
  live = new Set();
  async put(ref, v) {
    await super.put(ref, v);
    this.live.add(ref);
  }
  async delete(ref) {
    await super.delete(ref);
    this.live.delete(ref);
  }
}

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
  const vault = new ObservedVault();
  const deps = {
    store,
    vault,
    fixtureEndpoints: { auth_base: fake.auth_base, api_base: fake.api_base },
    openBrowser() {},
    callbackPort: 0,
  };
  const service = new PlanConnectionService(deps);
  const ws = await store.createWorkspace(owner, {
    name: 'U02 follow-up review',
    record_mode: 'fixture',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'Fixture plan',
    settings,
  });
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  const ref = async () =>
    (await store.planCredentialRef(owner, ws.id, conn.id)).credential_ref;
  const begin = (svc = service) =>
    svc.beginSignIn(owner, ws.id, conn.id, { open_browser: false });
  const finish = async (svc, started) => {
    await fake.approve(started.authorization_url);
    await until(() => svc.signInStatus(conn.id)?.state !== 'pending');
    return svc.signInStatus(conn.id);
  };
  const signIn = async (svc = service) => finish(svc, await begin(svc));
  const credits = async () => {
    const c = await current();
    await store.attestPlanCredits(owner, ws.id, c.id, {
      expected_version: c.version,
      statement: CREDITS_OFF_STATEMENT,
      checked_on: '2026-10-20',
    });
  };
  const caps = async () => {
    const c = await current();
    await store.acceptPlanCaps(owner, ws.id, c.id, {
      expected_version: c.version,
      settings_hash: c.settings_hash,
    });
  };
  const ready = async () => {
    await credits();
    await caps();
    return current();
  };
  const expire = async () => {
    const r = await ref();
    await vault.put(r, {
      ...(await vault.get(r)),
      expires_at: new Date(0).toISOString(),
    });
  };
  const grant = async () => {
    const c = await current();
    return store.createPlanVerificationGrant(owner, ws.id, c.id, {
      expected_version: c.version,
      model_id: 'm',
      path: 'responses',
      expires_in_minutes: 5,
    });
  };
  const invoke = (svc, g) =>
    svc.invoke(owner, ws.id, {
      connection_id: conn.id,
      logical_operation_id: randomUUID(),
      purpose: 'verification',
      model_id: 'm',
      task_class: null,
      data_class: 'synthetic',
      run_id: null,
      grant_id: g.id,
      instructions: 'fixture',
      input: 'fixture',
    });
  const requests = () => store.planRequests(owner, ws.id, conn.id);
  const done = async () => {
    for (const fn of cleanup.reverse()) await fn();
  };
  return {
    db,
    store,
    owner,
    fake,
    vault,
    deps,
    service,
    ws,
    conn,
    current,
    ref,
    begin,
    finish,
    signIn,
    credits,
    caps,
    ready,
    expire,
    grant,
    invoke,
    requests,
    done,
  };
}
const out = (o) => console.log(JSON.stringify({ fixture_only: true, ...o }));
const scenario = async (name, f) => {
  try {
    await f(name);
  } catch (e) {
    out({ scenario: name, harness_error: String(e?.stack ?? e).slice(0, 800) });
  }
};
// A service whose fetch to /responses waits on a gate.
const gatedResponses = (s, g) =>
  new PlanConnectionService({
    ...s.deps,
    fetchImpl: async (url, init) => {
      if (String(url).endsWith('/responses')) {
        g.enter();
        await g.g;
      }
      return fetch(url, init);
    },
  });
const st = (c) => [c.sign_in.state, c.version];

// R1 positive control: the current credential's 401 requires reauthorization and bumps version.
await scenario('current_credential_401', async (name) => {
  const s = await setup({
    responses: [{ kind: 'error', status: 401, code: 'invalid_token' }],
  });
  try {
    await s.signIn();
    await s.ready();
    const g = await s.grant();
    const before = await s.current();
    const r = await s.invoke(s.service, g);
    const after = await s.current();
    out({
      scenario: name,
      outcome: r.outcome.kind,
      before: st(before),
      after: st(after),
      request: (await s.requests())[0].state,
    });
  } finally {
    await s.done();
  }
});

// R2 old admission held between token and bind while Disconnect + replacement login happen.
await scenario('replacement_login_before_bind', async (name) => {
  const s = await setup();
  try {
    await s.signIn();
    await s.ready();
    const g = await s.grant();
    const hold = gate();
    // Proxy (not Object.create) so the store's private fields still resolve.
    const store = new Proxy(s.store, {
      get(target, prop) {
        if (prop === 'bindPlanRequestCredential')
          return async (...a) => {
            hold.enter();
            await hold.g;
            return target.bindPlanRequestCredential(...a);
          };
        const v = target[prop];
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
    const svc = new PlanConnectionService({ ...s.deps, store });
    const p = s.invoke(svc, g);
    await hold.e;
    await s.service.signOut(s.owner, s.ws.id, s.conn.id);
    await s.signIn();
    const before = await s.current();
    hold.open();
    const r = await p;
    const after = await s.current();
    out({
      scenario: name,
      outcome: [r.outcome.kind, r.outcome.reason_code],
      responses_sent: s.fake.responseRequests.length,
      before: st(before),
      after: st(after),
      requests: (await s.requests()).map((x) => [x.state, x.reason_code]),
    });
  } finally {
    await s.done();
  }
});

// R3 late 401 for a request bound to A after the same login refreshed A -> B.
await scenario('late_401_after_same_login_refresh', async (name) => {
  const s = await setup({
    refresh: 'rotate',
    responses: [{ kind: 'error', status: 401, code: 'invalid_token' }],
  });
  try {
    await s.signIn();
    await s.ready();
    const g = await s.grant();
    const h = gate();
    const p = s.invoke(gatedResponses(s, h), g);
    await h.e;
    await s.expire();
    await s.service.accessToken(s.owner, s.ws.id, s.conn.id);
    const before = await s.current();
    h.open();
    await p;
    const after = await s.current();
    out({ scenario: name, before: st(before), after: st(after) });
  } finally {
    await s.done();
  }
});

// R4 stale account observation: the old login's usage-limit result arrives after Disconnect and a
// new login. Sign-in state is fenced; is the quota observation?
await scenario('stale_quota_after_new_login', async (name) => {
  const s = await setup({
    responses: [
      {
        kind: 'error',
        status: 429,
        code: 'subscription_sharing_usage_limit_exceeded',
      },
    ],
  });
  try {
    await s.signIn();
    await s.ready();
    const g = await s.grant();
    const h = gate();
    const p = s.invoke(gatedResponses(s, h), g);
    await h.e;
    await s.service.signOut(s.owner, s.ws.id, s.conn.id);
    await s.signIn();
    const before = await s.current();
    h.open();
    await p;
    const after = await s.current();
    const detail = await s.store.planConnectionDetail(
      s.owner,
      s.ws.id,
      s.conn.id,
    );
    out({
      scenario: name,
      before: [...st(before), before.quota.state],
      after: [...st(after), after.quota.state],
      blockers: detail.blockers.slice(0, 3),
    });
  } finally {
    await s.done();
  }
});

// R5 Disconnect while the browser callback's token exchange is in progress.
await scenario('disconnect_during_code_exchange', async (name) => {
  const s = await setup();
  try {
    await s.signIn();
    const h = gate();
    const svc = new PlanConnectionService({
      ...s.deps,
      fetchImpl: async (url, init) => {
        if (
          String(url).endsWith('/oauth/token') &&
          String(init?.body).includes('authorization_code')
        ) {
          h.enter();
          await h.g;
        }
        return fetch(url, init);
      },
    });
    const started = await s.begin(svc);
    const approved = s.fake.approve(started.authorization_url);
    await h.e;
    await s.service.signOut(s.owner, s.ws.id, s.conn.id);
    h.open();
    await approved;
    await until(() => svc.signInStatus(s.conn.id)?.state !== 'pending');
    out({
      scenario: name,
      attempt: svc.signInStatus(s.conn.id),
      state: (await s.current()).sign_in.state,
      ref: await s.ref(),
      vault_entries: s.vault.live.size,
    });
  } finally {
    await s.done();
  }
});

// R6 Two services each start a browser sign-in; both callbacks succeed at the provider.
await scenario('competing_sign_ins_two_services', async (name) => {
  const s = await setup();
  try {
    const a = new PlanConnectionService(s.deps);
    const b = new PlanConnectionService(s.deps);
    const sa = await s.begin(a);
    const sb = await s.begin(b);
    const ra = await s.finish(a, sa);
    const rb = await s.finish(b, sb);
    const r = await s.ref();
    out({
      scenario: name,
      first: ra.state,
      second: [rb.state, rb.code ?? null],
      state: (await s.current()).sign_in.state,
      vault_entries: s.vault.live.size,
      current_ref_in_vault: s.vault.live.has(r),
    });
  } finally {
    await s.done();
  }
});

// R7 First sign-in survives credits, a settings edit and cap acceptance while the browser waits.
await scenario('owner_changes_during_first_sign_in', async (name) => {
  const s = await setup();
  try {
    const started = await s.begin();
    await s.credits();
    let c = await s.current();
    await s.store.updatePlanSettings(s.owner, s.ws.id, c.id, {
      expected_version: c.version,
      settings: {
        ...c.settings,
        caps: {
          ...c.settings.caps,
          responses: {
            ...c.settings.caps.responses,
            max_input_chars: c.settings.caps.responses.max_input_chars - 1,
          },
        },
      },
    });
    await s.caps();
    const r = await s.finish(s.service, started);
    c = await s.current();
    out({
      scenario: name,
      attempt: r.state,
      state: c.sign_in.state,
      vault_entries: s.vault.live.size,
    });
  } finally {
    await s.done();
  }
});

// R8 Sign in again; a refresh rotates A -> B meanwhile; completion must remove B (A is gone).
await scenario('refresh_during_sign_in_again_cleanup', async (name) => {
  const s = await setup({ refresh: 'rotate' });
  try {
    await s.signIn();
    const a = await s.ref();
    const started = await s.begin();
    await s.expire();
    await s.service.accessToken(s.owner, s.ws.id, s.conn.id);
    const b = await s.ref();
    const r = await s.finish(s.service, started);
    const c = await s.ref();
    out({
      scenario: name,
      attempt: r.state,
      refs_distinct: new Set([a, b, c]).size === 3,
      a_in_vault: s.vault.live.has(a),
      b_in_vault: s.vault.live.has(b),
      current_in_vault: s.vault.live.has(c),
      vault_entries: s.vault.live.size,
    });
  } finally {
    await s.done();
  }
});

// R9 Stress: a 401 request racing Disconnect + replacement sign-in from another service, with
// varied timing. Looks for deadlocks, unsettled requests or a newer login wrongly invalidated.
await scenario('concurrency_stress', async (name) => {
  const N = 16;
  const tally = { iterations: N, errors: [], unsettled: 0, final: {} };
  for (let i = 0; i < N; i++) {
    const s = await setup({
      responses: [{ kind: 'error', status: 401, code: 'invalid_token' }],
    });
    try {
      await s.signIn();
      await s.ready();
      const g = await s.grant();
      const other = new PlanConnectionService(s.deps);
      const res = await Promise.allSettled([
        (async () => {
          await sleep(i % 4);
          return s.invoke(other, g);
        })(),
        (async () => {
          await sleep(i % 3);
          await s.service.signOut(s.owner, s.ws.id, s.conn.id);
          return s.signIn();
        })(),
      ]);
      for (const r of res)
        if (r.status === 'rejected')
          tally.errors.push(String(r.reason?.code ?? r.reason).slice(0, 160));
      const reqs = await s.requests();
      tally.unsettled += reqs.filter((x) => x.state === 'in_flight').length;
      const c = await s.current();
      // Was the request admitted under the login that is current at the end?
      const gen = (
        await s.db.pool.query(
          'select r.auth_generation = c.auth_generation as same from plan_requests r join plan_connections c on c.id = r.connection_id',
        )
      ).rows[0].same;
      const key = `${c.sign_in.state}/admitted_under_final_login=${gen}/sent=${s.fake.responseRequests.length}/${res[0].value?.outcome?.reason_code ?? 'err'}`;
      tally.final[key] = (tally.final[key] ?? 0) + 1;
    } finally {
      await s.done();
    }
  }
  out({ scenario: name, ...tally });
});
