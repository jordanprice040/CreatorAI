import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import type pg from 'pg';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import {
  BudgetStore,
  migrate,
  SPENDING_WAIT_EXPLANATION,
  type CommandContext,
} from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// ADR-0113 (S0): one studio spending manager. Owning or creating a workspace never grants the
// studio-wide ceiling, limits or spend views, and a refused run's starter sees no amounts.

const pricing = JSON.parse(
  readFileSync(
    new URL('../../config/pricing/openai-gpt-6-astra.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
// "hello" with 100 output tokens at the documented gpt-6-astra rates (see budget.test.ts).
const EXPOSURE = 101n * 12_500n + 100n * 50_000n;

/** A real workspace's run with a grant and an envelope, ready for one paid dispatch. */
async function dispatchable(
  store: BudgetStore,
  ctx: CommandContext,
  wsId: string,
) {
  const snapshot = await store.createPricing(ctx, wsId, pricing);
  const envelope = await store.createEnvelope(ctx, wsId, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Large budget',
    cap_nano_usd: String(EXPOSURE * 1000n),
    starts_at: null,
    ends_at: null,
    max_in_flight: 32,
  });
  const r = await store.createEntity(ctx, wsId, {
    kind: 'run',
    title: 'Run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const control = await store.registerRun(ctx, wsId, {
    run: { id: r.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
  });
  await store.createStandingGrant(ctx, wsId, {
    run_id: control.run_id,
    action_types: ['model.generate'],
    target_kind: null,
    max_amount_nano_usd: '100000000',
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    rationale: 'Spending manager test call.',
  });
  const runId = control.run_id;
  const prepare = () =>
    store.prepareAttempt(
      ctx,
      wsId,
      runId,
      {
        envelope_id: envelope.id,
        action_type: 'model.generate',
        task_id: null,
        logical_operation_id: randomUUID(),
        pricing_snapshot_id: snapshot.id,
        data_class: 'synthetic',
        input: [{ role: 'user', text: 'hello' }],
        max_output_tokens: 100,
        output_format: 'text',
        tool: null,
        max_attempts: 1,
        timeout_ms: 5000,
        justification: 'Spending manager test call.',
      },
      {
        provider: 'openai',
        model_id: 'gpt-6-astra',
        adapterAvailable: true,
        requestHash: 'a'.repeat(64),
        attempt: 1,
        timeoutMs: 5000,
      },
    );
  return { runId, prepare };
}

test('S0-1: only the spending manager reads or changes studio spending; a refused starter sees no amounts', async (t) => {
  let closeApi = async () => {};
  t.after(() => closeApi());
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const store = api.store!;
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const json = { 'Content-Type': 'application/json' };

  // Person A signs in and creates the studio's first workspace: A becomes the manager.
  const a = await login(base);
  const createWs = async (headers: Record<string, string>, name: string) => {
    const r = await fetch(`${base}/workspaces`, {
      method: 'POST',
      headers: { ...json, ...headers },
      body: JSON.stringify({ name, record_mode: 'real' }),
    });
    assert.equal(r.status, 201);
    return ((await r.json()) as { id: string }).id;
  };
  await createWs(a.write, 'A');
  // Person B, another human with a session of their own, owns a workspace too.
  const bId = randomUUID();
  await store.ensureActor({ id: bId, kind: 'human', display_name: 'B' });
  const session = await store.createSession(bId, 'dev_local', null, 1);
  const bCookie = `creator_session=${session.token}`;
  const b = {
    read: { Cookie: bCookie },
    write: { Cookie: bCookie, 'X-CSRF-Token': session.session.csrf_token },
  };
  const bWs = await createWs(b.write, 'B');

  const spending = `${base}/settings/spending`;
  const limits = `${base}/settings/spending-limits`;
  const ceilingBody = (v: number, nano: string) =>
    JSON.stringify({
      expected_version: v,
      ceiling_nano_usd: nano,
      reason: 'S0 test.',
    });
  const limitsBody = (v: number) =>
    JSON.stringify({
      expected_version: v,
      // A per-run limit below one call, so the next real dispatch is refused.
      limits: { per_run_nano_usd: String(EXPOSURE - 1n), per_model: [] },
      reason: 'S0 test.',
    });

  // 1. A reads the ceiling and limits and changes both.
  const readA = await fetch(spending, { headers: a.read });
  assert.equal(readA.status, 200);
  assert.equal(
    ((await readA.json()) as { spending_manager_actor_id: string })
      .spending_manager_actor_id,
    DEFAULT_OWNER_ACTOR_ID,
  );
  assert.equal((await fetch(limits, { headers: a.read })).status, 200);
  const setCeiling = await fetch(spending, {
    method: 'POST',
    headers: { ...json, ...a.write },
    body: ceilingBody(0, '21000000000'),
  });
  assert.equal(setCeiling.status, 200);
  assert.equal(((await setCeiling.json()) as { version: number }).version, 1);
  const setLimits = await fetch(limits, {
    method: 'POST',
    headers: { ...json, ...a.write },
    body: limitsBody(0),
  });
  assert.equal(setLimits.status, 200);
  assert.equal(((await setLimits.json()) as { version: number }).version, 1);

  // 2–3. B is refused on every read and change, before and after creating a second workspace,
  // and the refusal carries no amounts.
  const bRefused = async () => {
    for (const r of [
      await fetch(spending, { headers: b.read }),
      await fetch(limits, { headers: b.read }),
      await fetch(spending, {
        method: 'POST',
        headers: { ...json, ...b.write },
        body: ceilingBody(1, '50000000000'),
      }),
      await fetch(limits, {
        method: 'POST',
        headers: { ...json, ...b.write },
        body: limitsBody(1),
      }),
    ]) {
      assert.equal(r.status, 403);
      const text = await r.text();
      assert.match(text, /studio spending manager/);
      for (const amount of ['21000000000', String(EXPOSURE - 1n), 'nano'])
        assert.ok(!text.includes(amount), `403 body leaks ${amount}`);
    }
  };
  await bRefused();
  await createWs(b.write, 'B second');
  await bRefused();

  // 4. A's per-run limit refuses a dispatch in B's run. B reads that run's record: the reason
  // code and the waiting text, with no studio-wide amounts.
  const run = await dispatchable(store, { actorId: bId }, bWs);
  const denied = await run.prepare();
  assert.equal(denied.kind, 'denied');
  assert.equal(denied.reservation.reason_code, 'runtime_run_limit');
  const seen = await fetch(
    `${base}/workspaces/${bWs}/reservations?run=${run.runId}`,
    { headers: b.read },
  );
  assert.equal(seen.status, 200);
  const records = (await seen.json()) as {
    reason_code: string;
    explanation: string;
  }[];
  assert.equal(records.length, 1);
  assert.equal(records[0]!.reason_code, 'runtime_run_limit');
  assert.equal(records[0]!.explanation, SPENDING_WAIT_EXPLANATION);
  assert.doesNotMatch(records[0]!.explanation, /\d/);
  // The details, with amounts, are A's to read.
  const view = (await (await fetch(limits, { headers: a.read })).json()) as {
    recent_refusals: {
      reservation_id: string;
      workspace_id: string;
      run_id: string;
      reason_code: string;
      explanation: string;
    }[];
  };
  assert.equal(view.recent_refusals.length, 1);
  const detail = view.recent_refusals[0]!;
  assert.equal(detail.reservation_id, denied.reservation.id);
  assert.equal(detail.workspace_id, bWs);
  assert.equal(detail.run_id, run.runId);
  assert.equal(detail.reason_code, 'runtime_run_limit');
  assert.match(detail.explanation, new RegExp(`this needs ${EXPOSURE}`));
  // The detail record cannot be rewritten.
  await assert.rejects(
    db.pool.query(`update spending_refusals set explanation = 'x'`),
  );
});

/** Puts the database back at schema 68, as it was before S0. */
async function beforeS0(pool: pg.Pool) {
  await pool.query('drop table spending_refusals');
  await pool.query('drop table studio_spending_manager');
  await pool.query('delete from schema_migrations where version = 69');
}
const managerRow = async (pool: pg.Pool) =>
  (
    await pool.query<{ actor_id: string; source: string }>(
      'select actor_id, source from studio_spending_manager',
    )
  ).rows;
/** A ceiling or limit change as a pre-S0 workspace owner could make it. */
async function pastChange(
  pool: pg.Pool,
  table: 'runtime_ceiling_changes' | 'runtime_limit_changes',
  actorId: string,
) {
  const { rows } = await pool.query<{ id: string }>(
    'select id from audit_events order by sequence limit 1',
  );
  const n = await pool.query<{ v: number }>(
    `select coalesce(max(version), 0) + 1 as v from ${table}`,
  );
  if (table === 'runtime_ceiling_changes')
    await pool.query(
      `insert into runtime_ceiling_changes (version, ceiling_nano, previous_nano, reason, actor_id, event_id)
       values ($1, 20000000000, 20000000000, 'before S0', $2, $3)`,
      [n.rows[0]!.v, actorId, rows[0]!.id],
    );
  else
    await pool.query(
      `insert into runtime_limit_changes (version, limits, previous, reason, actor_id, event_id)
       values ($1, '{"per_run_nano_usd":null,"per_model":[]}', '{"per_run_nano_usd":null,"per_model":[]}', 'before S0', $2, $3)`,
      [n.rows[0]!.v, actorId, rows[0]!.id],
    );
}

test('S0-1 upgrade: the latest ceiling or limit changer becomes the manager, else the oldest workspace owner', async (t) => {
  for (const scenario of [
    'latest-ceiling',
    'latest-limit',
    'oldest-owner',
  ] as const) {
    const db = await freshDatabase(t);
    if (!db) return;
    const store = new BudgetStore(db.pool);
    const a: CommandContext = { actorId: randomUUID() };
    const b: CommandContext = { actorId: randomUUID() };
    const agent: CommandContext = { actorId: randomUUID() };
    await store.ensureActor({
      id: a.actorId,
      kind: 'human',
      display_name: 'A',
    });
    await store.ensureActor({
      id: b.actorId,
      kind: 'human',
      display_name: 'B',
    });
    await store.ensureActor({
      id: agent.actorId,
      kind: 'agent',
      display_name: 'Agent',
    });
    // An agent's workspace is oldest, then B's, then A's.
    await store.createWorkspace(agent, { name: 'Agent', record_mode: 'real' });
    await store.createWorkspace(b, { name: 'B', record_mode: 'real' });
    await store.createWorkspace(a, { name: 'A', record_mode: 'real' });
    await beforeS0(db.pool);
    if (scenario !== 'oldest-owner')
      await pastChange(db.pool, 'runtime_ceiling_changes', a.actorId);
    if (scenario === 'latest-limit')
      await pastChange(db.pool, 'runtime_limit_changes', b.actorId);
    assert.deepEqual(await migrate(db.pool), [69]);
    const expected = {
      'latest-ceiling': [a.actorId, 'upgrade_latest_change'],
      'latest-limit': [b.actorId, 'upgrade_latest_change'],
      'oldest-owner': [b.actorId, 'upgrade_oldest_owner'],
    }[scenario];
    assert.deepEqual(
      (await managerRow(db.pool)).map((r) => [r.actor_id, r.source]),
      [expected],
      scenario,
    );
    // The other person is refused, whatever workspaces they own.
    const other = expected[0] === a.actorId ? b : a;
    await assert.rejects(store.runtimeCeiling(other), {
      code: 'ACCESS_DENIED',
    });
    assert.equal(
      (await store.runtimeCeiling({ actorId: expected[0]! }))
        .spending_manager_actor_id,
      expected[0],
    );
  }
});

test('a new studio: the first person to create a workspace becomes the manager, once', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new BudgetStore(db.pool);
  const people: string[] = [randomUUID(), randomUUID(), randomUUID()];
  const system: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: system.actorId,
    kind: 'system',
    display_name: 'Ops',
  });
  for (const id of people)
    await store.ensureActor({ id, kind: 'human', display_name: 'Person' });
  // No workspace yet: nobody manages spending, and nobody can read it.
  assert.deepEqual(await managerRow(db.pool), []);
  await assert.rejects(store.runtimeCeiling({ actorId: people[0]! }), {
    code: 'ACCESS_DENIED',
  });
  // A system actor's workspace (a seeded sample, say) assigns no one.
  await store.createWorkspace(system, {
    name: 'Sample',
    record_mode: 'fixture',
  });
  assert.deepEqual(await managerRow(db.pool), []);
  // Three people create their first workspaces at once: exactly one becomes the manager.
  await Promise.all(
    people.map((id) =>
      store.createWorkspace(
        { actorId: id },
        { name: 'Mine', record_mode: 'real' },
      ),
    ),
  );
  const rows = await managerRow(db.pool);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]!.source, 'first_workspace');
  assert.ok(people.includes(rows[0]!.actor_id));
  const assigned = await db.pool.query<{ actor_id: string }>(
    `select actor_id from audit_events where action = 'workspace.created'
       and payload->>'spending_manager_assigned' = 'true'`,
  );
  assert.deepEqual(
    assigned.rows.map((r) => r.actor_id),
    [rows[0]!.actor_id],
  );
  for (const id of people.filter((p) => p !== rows[0]!.actor_id)) {
    await assert.rejects(store.runtimeCeiling({ actorId: id }), {
      code: 'ACCESS_DENIED',
    });
    await assert.rejects(store.spendLimits({ actorId: id }), {
      code: 'ACCESS_DENIED',
    });
  }
  // The record cannot be rewritten or removed.
  await assert.rejects(
    db.pool.query(`update studio_spending_manager set actor_id = $1`, [
      people.find((p) => p !== rows[0]!.actor_id),
    ]),
  );
  await assert.rejects(db.pool.query('delete from studio_spending_manager'));
});
