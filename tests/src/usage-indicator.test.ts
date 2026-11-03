import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ContractError,
  UsageSummarySchema,
  type PlanConnection,
} from '@creator/contracts';
import { createApi } from '@creator/api';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// Runbook step 9 usage indicator: read-only plan and API usage. These checks pin that the
// numbers shown are the numbers admission enforces (same rows, same rolling window), that
// cost is shown only to the ceiling's audience, and that the route never writes.

const SETTINGS = JSON.parse(
  readFileSync(
    new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
    'utf8',
  ),
) as PlanConnection['settings'];
const owner: CommandContext = { actorId: randomUUID() };
const HOUR = 3_600_000;

test('usage summary matches admission counts, the rolling window and the per-run cap', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Usage',
    record_mode: 'real',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  const quiet = await store.createPlanConnection(owner, ws.id, {
    label: 'Unused',
    settings: SETTINGS,
  });
  const runA = randomUUID();
  const runB = randomUUID();
  const now = Date.now();
  const add = async (
    agoMs: number,
    o: { run?: string; state?: string; path?: string; build?: string } = {},
  ) =>
    db.pool.query(
      `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose,
         model_id, data_class, run_id, build_id, state, created_by, started_at)
       values ($1, $2, $3, $4, $5, 'm', 'synthetic', $6, $7, $8, $9, $10)`,
      [
        randomUUID(),
        conn.id,
        randomUUID(),
        o.path ?? 'responses',
        o.path === 'codex' ? 'codex_build' : 'task',
        o.run ?? null,
        o.build ?? null,
        o.state ?? 'completed',
        owner.actorId,
        new Date(now - agoMs),
      ],
    );
  // Outside the window: counts in totals and the run's lifetime count only.
  await add(30 * HOUR, { run: runA });
  await add(30 * HOUR, { run: runB });
  // Inside the window.
  const oldest = 20 * HOUR;
  const newest = 1 * HOUR;
  await add(oldest, { run: runA });
  await add(5 * HOUR, { state: 'unknown' });
  await add(newest, { path: 'codex', build: randomUUID() });

  const u = await store.usageSummary(owner, ws.id);
  UsageSummarySchema.parse(u);
  const p = u.plans.find((x) => x.connection_id === conn.id)!;
  // The indicator's "used" is exactly what admission counts against the daily cap.
  const detail = await store.planConnectionDetail(owner, ws.id, conn.id);
  assert.equal(p.daily.used, detail.usage.last_24h_requests);
  assert.equal(p.daily.used, 3);
  const cap = SETTINGS.caps.shared.max_model_requests_per_day;
  assert.equal(p.daily.cap, cap);
  assert.equal(p.daily.remaining, cap - 3);
  const near = (iso: string | null, ms: number) =>
    assert.ok(iso && Math.abs(Date.parse(iso) - ms) < 2000, `${iso} vs ${ms}`);
  near(p.daily.next_frees_at, now - oldest + 24 * HOUR);
  near(p.daily.clears_at, now - newest + 24 * HOUR);
  assert.deepEqual(p.codex_builds, {
    used: 1,
    cap: SETTINGS.caps.codex.max_builds_per_day,
  });
  // Run A had a request in the window, so it is listed with its lifetime count (2), which
  // is what the per-run cap counts; run B's last request is older than 24 hours.
  assert.deepEqual(
    p.runs.map((r) => [r.run_id, r.requests, r.cap]),
    [[runA, 2, SETTINGS.caps.responses.max_requests_per_run]],
  );
  assert.equal(p.unresolved, 1);
  assert.equal(p.total_requests, 5);
  assert.equal(p.provider_quota.state, conn.quota.state);
  // A connection that is not signed in refuses every request whatever the count says; the
  // indicator carries admission's own reasons.
  assert.deepEqual(p.blockers, detail.blockers);
  assert.ok(p.blockers.some((b) => /Not signed in/.test(b)));
  const q = u.plans.find((x) => x.connection_id === quiet.id)!;
  assert.equal(q.daily.used, 0);
  assert.equal(q.daily.next_frees_at, null);
  assert.deepEqual(u.app, {
    plan_requests_24h: 3,
    plan_requests_7d: 5,
    plan_requests_total: 5,
  });

  // At the cap, remaining is zero (never negative).
  for (let i = p.daily.used; i < cap + 2; i++) await add(2 * HOUR);
  const full = (await store.usageSummary(owner, ws.id)).plans.find(
    (x) => x.connection_id === conn.id,
  )!;
  assert.equal(full.daily.remaining, 0);
  // Used is cap + 2 (a lowered cap gives the same shape), so admission allows one more only
  // after three requests leave the window: the 20 h, 5 h and first 2 h old ones. The oldest
  // leaving alone is not enough.
  assert.equal(full.daily.used, cap + 2);
  near(full.daily.next_frees_at, now - 2 * HOUR + 24 * HOUR);
});

test('an active run at its lifetime cap stays listed after 24 hours; a stopped one does not', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Usage',
    record_mode: 'real',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  const run = async () => {
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: 'run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    return (
      await store.registerRun(owner, ws.id, {
        run: { id: r.id, version: 1 },
        autonomy_mode: 'human_in_loop',
        stage_gates: null,
        initial_grants: [],
      })
    ).run_id;
  };
  const capped = await run();
  const stopped = await run();
  const under = await run();
  const idle = await run();
  const archived = await run();
  const cap = SETTINGS.caps.responses.max_requests_per_run;
  const add = (run_id: string, n: number, age = '30 hours') =>
    db.pool.query(
      `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose,
         model_id, data_class, run_id, state, created_by, started_at)
       select gen_random_uuid(), $1, gen_random_uuid(), 'responses', 'task', 'm', 'synthetic',
              $2, 'completed', $3, clock_timestamp() - $5::interval
         from generate_series(1, $4)`,
      [conn.id, run_id, owner.actorId, n, age],
    );
  await add(capped, cap);
  await add(stopped, cap);
  await add(under, cap - 1);
  await add(idle, cap, '8 days');
  await add(archived, cap);
  await store.cancelRun(owner, ws.id, stopped, { reason: 'stop' });
  await store.archiveEntity(owner, ws.id, archived, {
    expected_version: 1,
    reason: 'done with it',
  });
  const p = (await store.usageSummary(owner, ws.id)).plans[0]!;
  // Admission still refuses the capped run (it counts the run's whole life), so the panel keeps
  // showing it; the stopped run and the run under its cap leave with the 24-hour window. A
  // capped run with no request for 7 days, or an archived one, leaves too (PR #96 review L-2).
  assert.deepEqual(
    p.runs.map((r) => [r.run_id, r.requests]),
    [[capped, cap]],
  );
});

test('the usage summary does not wait for the runtime ceiling lock', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Usage',
    record_mode: 'real',
  });
  // Another transaction (a paid dispatch or a ceiling save) holds the ceiling lock.
  const holder = await db.pool.connect();
  try {
    await holder.query('begin');
    await holder.query(
      "select pg_advisory_xact_lock(hashtext('runtime-ceiling'))",
    );
    const read = store.usageSummary(owner, ws.id);
    const timeout = new Promise<'blocked'>((resolve) =>
      setTimeout(() => resolve('blocked'), 3000).unref(),
    );
    const outcome = await Promise.race([read, timeout]);
    assert.notEqual(
      outcome,
      'blocked',
      'the display read queued behind the lock',
    );
    assert.ok((outcome as Awaited<typeof read>).api_cost);
  } finally {
    await holder.query('rollback');
    holder.release();
  }
});

test('API cost follows the ceiling in force and is shown only to its audience', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Usage',
    record_mode: 'real',
  });
  let u = await store.usageSummary(owner, ws.id);
  assert.equal(u.api_cost?.ceiling_nano_usd, store.spending.ceiling_nano_usd);
  assert.equal(u.api_cost?.exposure_nano_usd, '0');
  assert.equal(u.api_cost?.remaining_nano_usd, store.spending.ceiling_nano_usd);
  assert.equal(u.api_cost_hidden_reason, null);
  // A ceiling changed in Settings is the one shown.
  await store.setRuntimeCeiling(owner, {
    expected_version: 0,
    ceiling_nano_usd: '25000000000',
    reason: 'test change',
  });
  u = await store.usageSummary(owner, ws.id);
  assert.equal(u.api_cost?.ceiling_nano_usd, '25000000000');

  // A viewer who owns no workspace sees plan usage but not the cost.
  const viewer: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: viewer.actorId,
    kind: 'human',
    display_name: 'viewer',
  });
  await store.addMember(owner, ws.id, viewer.actorId, 'viewer');
  const v = await store.usageSummary(viewer, ws.id);
  assert.equal(v.api_cost, null);
  assert.match(v.api_cost_hidden_reason ?? '', /owns a workspace/);
  // A non-member cannot learn the workspace exists.
  const stranger: CommandContext = { actorId: randomUUID() };
  await assert.rejects(
    store.usageSummary(stranger, ws.id),
    (e: unknown) => e instanceof ContractError && e.code === 'NOT_FOUND',
  );
});

test('usage route is a signed-in, read-only GET', async (t) => {
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
  const created = await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.write },
    body: JSON.stringify({ name: 'Usage', record_mode: 'fixture' }),
  });
  const ws = ((await created.json()) as { id: string }).id;
  const anon = await fetch(`${base}/workspaces/${ws}/usage`);
  assert.equal(anon.status, 401);
  const ok = await fetch(`${base}/workspaces/${ws}/usage`, {
    headers: auth.read,
  });
  assert.equal(ok.status, 200);
  const body = UsageSummarySchema.parse(await ok.json());
  assert.equal(body.workspace_id, ws);
  assert.deepEqual(body.plans, []);
  assert.ok(body.api_cost);
  const post = await fetch(`${base}/workspaces/${ws}/usage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.write },
    body: '{}',
  });
  assert.equal(post.status, 404);
});
