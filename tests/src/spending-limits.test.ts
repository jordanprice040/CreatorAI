import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import type { PoolClient } from 'pg';
import type {
  BrokerCallRequest,
  StudyAttempt,
  StudyInput,
} from '@creator/contracts';
import { createApi } from '@creator/api';
import {
  BudgetStore,
  budgetRefusal,
  StudyStore,
  type CommandContext,
} from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

const owner: CommandContext = { actorId: randomUUID() };
const pricingFile = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../config/pricing/${name}.json`, import.meta.url),
      'utf8',
    ),
  ) as Record<string, unknown>;
// "hello" with 100 output tokens at the documented gpt-6-astra rates (see budget.test.ts).
const EXPOSURE = 101n * 12_500n + 100n * 50_000n;
const ASTRA = { provider: 'openai' as const, model_id: 'gpt-6-astra' };

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new BudgetStore(db.pool, { lateWindowMs: 0 });
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  // A ceiling of ten calls stands in for the owner's $20; the narrower limits sit under it.
  store.spending = {
    ...store.spending,
    ceiling_nano_usd: String(EXPOSURE * 10n),
    effective_from: new Date(Date.now() - 60_000).toISOString(),
  };
  async function workspace(mode: 'fixture' | 'real') {
    const ws = await store.createWorkspace(owner, {
      name: `Limits ${mode}`,
      record_mode: mode,
    });
    const pricing = await store.createPricing(
      owner,
      ws.id,
      pricingFile(mode === 'real' ? 'openai-gpt-6-astra' : 'fixture-model-v1'),
    );
    const envelope = await store.createEnvelope(owner, ws.id, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Large budget',
      cap_nano_usd: String(EXPOSURE * 1000n),
      starts_at: null,
      ends_at: null,
      max_in_flight: 32,
    });
    async function run() {
      const r = await store.createEntity(owner, ws.id, {
        kind: 'run',
        title: 'Run',
        body: {
          state: 'queued',
          experiment_condition: 'human_in_loop',
          discovery_method: 'structured',
          config_hash: null,
        },
      });
      const control = await store.registerRun(owner, ws.id, {
        run: { id: r.id, version: 1 },
        autonomy_mode: 'human_in_loop',
        stage_gates: null,
        initial_grants: [],
      });
      await store.createStandingGrant(owner, ws.id, {
        run_id: control.run_id,
        action_types: ['model.generate'],
        target_kind: null,
        max_amount_nano_usd: '100000000',
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['synthetic'],
        expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        rationale: 'Limit test calls.',
      });
      return control.run_id;
    }
    const request = (): BrokerCallRequest => ({
      envelope_id: envelope.id,
      action_type: 'model.generate',
      task_id: null,
      logical_operation_id: randomUUID(),
      pricing_snapshot_id: pricing.id,
      data_class: 'synthetic',
      input: [{ role: 'user', text: 'hello' }],
      max_output_tokens: 100,
      output_format: 'text',
      tool: null,
      max_attempts: 1,
      timeout_ms: 5000,
      justification: 'Limit test call.',
    });
    const prepare = (runId: string) =>
      store.prepareAttempt(owner, ws.id, runId, request(), {
        provider: mode === 'real' ? 'openai' : 'fixture',
        model_id: mode === 'real' ? 'gpt-6-astra' : 'fixture-model-v1',
        adapterAvailable: true,
        requestHash: 'a'.repeat(64),
        attempt: 1,
        timeoutMs: 5000,
      });
    return { ws, run, prepare };
  }
  let version = 0;
  const setLimits = async (
    perRun: bigint | null,
    perModel: { provider: 'openai'; model_id: string; calls: bigint }[] = [],
  ) => {
    const view = await store.setSpendLimits(owner, {
      expected_version: version,
      limits: {
        per_run_nano_usd: perRun === null ? null : String(EXPOSURE * perRun),
        per_model: perModel.map((m) => ({
          provider: m.provider,
          model_id: m.model_id,
          limit_nano_usd: String(EXPOSURE * m.calls),
        })),
      },
      reason: 'Owner set narrower limits for a test.',
    });
    version = view.version;
    return view;
  };
  /** What StudyStore.holdBudget writes for an open final attempt: a t15-final hold at its cap. */
  const openFinalHold = async (
    ws: string,
    runId: string,
    cap: bigint | null,
  ) => {
    const studyId = randomUUID();
    const attemptId = randomUUID();
    await db.pool.query(
      `insert into studies(id, workspace_id, manifest, manifest_hash, created_by)
       values ($1, $2, '{}', $3, $4)`,
      [studyId, ws, 'b'.repeat(64), owner.actorId],
    );
    await db.pool.query(
      `insert into study_attempts(id, study_id, workspace_id, run_id, assignment, context, context_hash, ordinal)
       values ($1, $2, $3, $4, '{}', '{}', $5, 1)`,
      [attemptId, studyId, ws, runId, 'c'.repeat(64)],
    );
    if (cap !== null)
      await db.pool.query(
        `insert into study_budget_holds(attempt_id, ledger, cap_nano, ledger_cap_nano)
         values ($1, 't15-final', $2, $3)`,
        [attemptId, String(cap), '20000000000'],
      );
    return { studyId, attemptId };
  };
  return { db, store, workspace, setLimits, openFinalHold };
}

const reason = (p: { kind: string; reservation: { reason_code: string } }) =>
  p.kind === 'reserved' ? 'reserved' : p.reservation.reason_code;

test('no narrower limits by default: only the overall ceiling applies', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  const view = await s.store.spendLimits(owner);
  assert.equal(view.version, 0);
  assert.deepEqual(view.limits, { per_run_nano_usd: null, per_model: [] });
  assert.deepEqual(view.history, []);
  const run = await a.run();
  for (let i = 0; i < 10; i += 1)
    assert.equal(reason(await a.prepare(run)), 'reserved');
  assert.equal(reason(await a.prepare(run)), 'runtime_ceiling');
});

test('the per-run limit stops one run; other runs and fixture workspaces carry on', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  await s.setLimits(2n);
  const first = await a.run();
  const second = await a.run();
  assert.equal(reason(await a.prepare(first)), 'reserved');
  assert.equal(reason(await a.prepare(first)), 'reserved');
  const over = await a.prepare(first);
  assert.equal(reason(over), 'runtime_run_limit');
  assert.equal(over.reservation.reserved, '0');
  assert.equal(reason(await a.prepare(second)), 'reserved');
  // Fixture amounts are simulated units, never money, so no limit counts them.
  const f = await s.workspace('fixture');
  const fr = await f.run();
  for (let i = 0; i < 4; i += 1)
    assert.equal(reason(await f.prepare(fr)), 'reserved');
  // The view shows what each counted run has used or holds, highest first.
  const view = await s.store.spendLimits(owner);
  assert.deepEqual(
    view.top_runs.map((r) => [r.run_id, r.exposure_nano_usd]),
    [
      [first, String(EXPOSURE * 2n)],
      [second, String(EXPOSURE)],
    ],
  );
});

test('a per-model limit counts that model across every workspace; other models are unaffected', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  await s.setLimits(null, [
    { provider: 'openai', model_id: 'gpt-6-astra', calls: 3n },
    { provider: 'openai', model_id: 'some-other-model', calls: 1n },
  ]);
  const b = await s.workspace('real');
  const ra = await a.run();
  const rb = await b.run();
  assert.equal(reason(await a.prepare(ra)), 'reserved');
  assert.equal(reason(await b.prepare(rb)), 'reserved');
  assert.equal(reason(await a.prepare(ra)), 'reserved');
  // The 1-call limit on another model did not stop three astra calls; astra's own limit does.
  assert.equal(reason(await b.prepare(rb)), 'runtime_model_limit');
  const view = await s.store.spendLimits(owner);
  const astra = view.models.find((m) => m.model_id === ASTRA.model_id);
  assert.equal(astra?.limit_nano_usd, String(EXPOSURE * 3n));
  assert.equal(astra?.exposure_nano_usd, String(EXPOSURE * 3n));
  assert.equal(astra?.known, true);
  const other = view.models.find((m) => m.model_id === 'some-other-model');
  assert.equal(other?.exposure_nano_usd, '0');
  // Only the limit names it, so Settings can say no pricing or call uses that id.
  assert.equal(other?.known, false);
});

test('every applicable limit applies: run, model and the overall ceiling', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // The run limit is reached first...
  const a = await s.workspace('real');
  await s.setLimits(2n, [{ ...ASTRA, calls: 5n }]);
  const r1 = await a.run();
  const r2 = await a.run();
  const r3 = await a.run();
  assert.equal(reason(await a.prepare(r1)), 'reserved');
  assert.equal(reason(await a.prepare(r1)), 'reserved');
  assert.equal(reason(await a.prepare(r1)), 'runtime_run_limit');
  // ...then the model limit, across runs that are each under their own limit...
  assert.equal(reason(await a.prepare(r2)), 'reserved');
  assert.equal(reason(await a.prepare(r2)), 'reserved');
  assert.equal(reason(await a.prepare(r3)), 'reserved');
  assert.equal(reason(await a.prepare(r3)), 'runtime_model_limit');
  // ...and a later, lower overall ceiling wins over a higher narrower limit.
  await s.setLimits(null, [{ ...ASTRA, calls: 9n }]);
  await s.store.setRuntimeCeiling(owner, {
    expected_version: 0,
    ceiling_nano_usd: String(EXPOSURE * 5n),
    reason: 'Owner lowered the overall ceiling.',
  });
  assert.equal(reason(await a.prepare(r3)), 'runtime_ceiling');
});

test('only the spending manager changes limits, with a reason, never above the ceiling', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.workspace('real');
  const body = {
    expected_version: 0,
    limits: { per_run_nano_usd: String(EXPOSURE), per_model: [] },
    reason: 'Owner set a per-run limit.',
  };
  const agent: CommandContext = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: agent.actorId,
    kind: 'agent',
    display_name: 'Worker agent',
  });
  // ADR-0113: a person who owns a workspace of their own is still not the spending manager.
  const stranger: CommandContext = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Owns another workspace',
  });
  await s.store.createWorkspace(stranger, {
    name: 'Their own',
    record_mode: 'real',
  });
  for (const who of [agent, stranger]) {
    await assert.rejects(s.store.spendLimits(who), { code: 'ACCESS_DENIED' });
    await assert.rejects(s.store.setSpendLimits(who, body), {
      code: 'ACCESS_DENIED',
    });
  }
  // Above the ceiling, the same model twice, a fixture model and an empty reason are refused.
  const bad = [
    { per_run_nano_usd: String(EXPOSURE * 11n), per_model: [] },
    {
      per_run_nano_usd: null,
      per_model: [{ ...ASTRA, limit_nano_usd: String(EXPOSURE * 11n) }],
    },
    {
      per_run_nano_usd: null,
      per_model: [
        { ...ASTRA, limit_nano_usd: '1' },
        { ...ASTRA, limit_nano_usd: '2' },
      ],
    },
    {
      per_run_nano_usd: null,
      per_model: [
        {
          provider: 'fixture',
          model_id: 'fixture-model-v1',
          limit_nano_usd: '1',
        },
      ],
    },
  ];
  for (const limits of bad)
    await assert.rejects(s.store.setSpendLimits(owner, { ...body, limits }), {
      code: 'INVALID_CONTRACT',
    });
  await assert.rejects(
    s.store.setSpendLimits(owner, { ...body, reason: ' ' }),
    {
      code: 'INVALID_CONTRACT',
    },
  );
  // A limit equal to the ceiling is allowed; the first save is version 1.
  const set = await s.store.setSpendLimits(owner, {
    ...body,
    limits: { per_run_nano_usd: String(EXPOSURE * 10n), per_model: [] },
  });
  assert.equal(set.version, 1);
  assert.equal(set.history[0]?.previous.per_run_nano_usd, null);
  // A stale page cannot overwrite it, and saving the same limits again is refused.
  await assert.rejects(s.store.setSpendLimits(owner, body), {
    code: 'VERSION_CONFLICT',
  });
  await assert.rejects(
    s.store.setSpendLimits(owner, {
      ...body,
      expected_version: 1,
      limits: set.limits,
    }),
    { code: 'INVALID_CONTRACT' },
  );
  // Removing every limit is a recorded change too.
  const cleared = await s.store.setSpendLimits(owner, {
    expected_version: 1,
    limits: { per_run_nano_usd: null, per_model: [] },
    reason: 'Owner removed the per-run limit.',
  });
  assert.equal(cleared.version, 2);
  const events = await s.db.pool.query(
    "select actor_id, subject_version from audit_events where action = 'spending.limits_changed' order by sequence",
  );
  assert.deepEqual(
    events.rows.map((r) => [r.actor_id, r.subject_version]),
    [
      [owner.actorId, 1],
      [owner.actorId, 2],
    ],
  );
  await assert.rejects(
    s.db.pool.query("update runtime_limit_changes set reason = 'x'"),
  );
});

test('concurrent saves from one version: exactly one wins, the other gets a version conflict', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.workspace('real');
  const save = (calls: bigint) =>
    s.store.setSpendLimits(owner, {
      expected_version: 0,
      limits: { per_run_nano_usd: String(EXPOSURE * calls), per_model: [] },
      reason: 'Two tabs saving at once.',
    });
  const results = await Promise.allSettled([save(1n), save(2n)]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  const lost = results.find((r) => r.status === 'rejected');
  assert.equal((lost as PromiseRejectedResult).reason.code, 'VERSION_CONFLICT');
});

test('concurrent dispatches from different workspaces never pass a per-model limit', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // Each workspace has its own envelope, so only the runtime-ceiling lock serializes them.
  const a = await s.workspace('real');
  const b = await s.workspace('real');
  await s.setLimits(null, [{ ...ASTRA, calls: 3n }]);
  const runs = await Promise.all([a.run(), a.run(), b.run(), b.run()]);
  const calls = [...runs, ...runs].map((run, i) =>
    (i % 4 < 2 ? a : b).prepare(run),
  );
  const outcomes = (await Promise.all(calls)).map(reason);
  assert.equal(outcomes.filter((r) => r === 'reserved').length, 3);
  assert.equal(
    outcomes.filter((r) => r === 'runtime_model_limit').length,
    outcomes.length - 3,
  );
  const view = await s.store.spendLimits(owner);
  assert.equal(
    view.models.find((m) => m.model_id === ASTRA.model_id)?.exposure_nano_usd,
    String(EXPOSURE * 3n),
  );
});

test("a per-run limit cannot be set below an open final study attempt's held cap", async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  await s.openFinalHold(a.ws.id, await a.run(), EXPOSURE * 3n);
  await assert.rejects(s.setLimits(2n), { code: 'INVALID_CONTRACT' });
  assert.equal((await s.setLimits(3n)).version, 1);
});

class HoldProbe extends StudyStore {
  hold(c: PoolClient, ws: string, a: StudyAttempt, input: StudyInput) {
    return this.holdBudget(c, owner, ws, a, input);
  }
}

test('a final study attempt whose cap is above the per-run limit is refused before it starts', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  await s.setLimits(2n);
  const probe = new HoldProbe(s.db.pool);
  probe.spending = s.store.spending;
  const attempt = async (cap: bigint) => {
    const runId = await a.run();
    const { studyId, attemptId } = await s.openFinalHold(a.ws.id, runId, null);
    const c = await s.db.pool.connect();
    try {
      await c.query('begin');
      const refused = await probe.hold(
        c,
        a.ws.id,
        {
          id: attemptId,
          study_id: studyId,
          workspace_id: a.ws.id,
          run_id: runId,
        } as StudyAttempt,
        {
          governance: {},
          synthetic: false,
          config: { max_cost_nano_usd: String(cap) },
        } as unknown as StudyInput,
      );
      await c.query('commit');
      return { refused, attemptId };
    } catch (e) {
      await c.query('rollback');
      throw e;
    } finally {
      c.release();
    }
  };
  const over = await attempt(EXPOSURE * 3n);
  assert.equal(over.refused?.ledger, 'runtime-run-limit');
  const events = await s.db.pool.query(
    "select payload from study_events where attempt_id = $1 and kind = 'budget_refused'",
    [over.attemptId],
  );
  // ADR-0113 (review L-1): the study's event names the limit but holds no studio-wide amount;
  // the amounts are in the record only the spending manager reads.
  const limit = String(EXPOSURE * 2n);
  assert.equal(events.rows[0]?.payload.ledger, 'runtime-run-limit');
  assert.equal(events.rows[0]?.payload.amounts, 'studio_spending_manager_only');
  assert.ok(!JSON.stringify(events.rows[0]?.payload).includes(limit));
  const message = budgetRefusal(over.refused!);
  assert.ok(
    !JSON.stringify([message.message, message.details]).includes(limit),
  );
  const refusals = (await s.store.spendLimits(owner)).recent_refusals;
  assert.equal(refusals[0]?.study_attempt_id, over.attemptId);
  assert.equal(refusals[0]?.reservation_id, null);
  assert.equal(refusals[0]?.reason_code, 'runtime_run_limit');
  assert.match(
    refusals[0]!.explanation,
    new RegExp(`per-run limit of ${limit}`),
  );
  // Above the overall ceiling, the ceiling refuses first, also without amounts.
  const ceiling = await attempt(EXPOSURE * 11n);
  assert.equal(ceiling.refused?.ledger, 'runtime-ceiling');
  assert.ok(!JSON.stringify(ceiling.refused).includes(String(EXPOSURE * 10n)));
  assert.equal(
    (await s.store.spendLimits(owner)).recent_refusals[0]?.reason_code,
    'runtime_ceiling',
  );
  // At the limit it is held.
  const fits = await attempt(EXPOSURE * 2n);
  assert.equal(fits.refused, null);
});

test('a limit save waits for an uncommitted study hold and then sees it', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  const probe = new HoldProbe(s.db.pool);
  probe.spending = s.store.spending;
  const runId = await a.run();
  const { studyId, attemptId } = await s.openFinalHold(a.ws.id, runId, null);
  const c = await s.db.pool.connect();
  try {
    // A final attempt places a hold of three calls and has not committed yet.
    await c.query('begin');
    const refused = await probe.hold(
      c,
      a.ws.id,
      { id: attemptId, study_id: studyId } as StudyAttempt,
      {
        governance: {},
        synthetic: false,
        config: { max_cost_nano_usd: String(EXPOSURE * 3n) },
      } as unknown as StudyInput,
    );
    assert.equal(refused, null);
    // A per-run limit of two calls must not slip in underneath it.
    const save = s.setLimits(2n).then(
      () => 'saved',
      (e: { code?: string }) => e.code,
    );
    await new Promise((r) => setTimeout(r, 300));
    await c.query('commit');
    assert.equal(await save, 'INVALID_CONTRACT');
  } finally {
    c.release();
  }
});

test('the limits route needs a signed-in session, and a write needs its CSRF token', async (t) => {
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
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const url = `${base}/settings/spending-limits`;
  const body = JSON.stringify({
    expected_version: 0,
    limits: { per_run_nano_usd: '1000000000', per_model: [] },
    reason: 'Route test.',
  });
  assert.equal((await fetch(url)).status, 401);
  const auth = await login(base);
  // Signed in on a studio with no spending manager yet: refused by the store (ADR-0113).
  assert.equal((await fetch(url, { headers: auth.read })).status, 403);
  await fetch(`${base}/workspaces`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.write },
    body: JSON.stringify({ name: 'Limits route', record_mode: 'real' }),
  });
  const view = await fetch(url, { headers: auth.read });
  assert.equal(view.status, 200);
  assert.equal(((await view.json()) as { version: number }).version, 0);
  const noCsrf = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.read },
    body,
  });
  assert.equal(noCsrf.status, 403);
  const saved = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.write },
    body,
  });
  assert.equal(saved.status, 200);
  assert.equal(((await saved.json()) as { version: number }).version, 1);
});
