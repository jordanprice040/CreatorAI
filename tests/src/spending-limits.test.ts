import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { BrokerCallRequest } from '@creator/contracts';
import { BudgetStore, type CommandContext } from '@creator/db';
import { freshDatabase } from './pg-harness.js';

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
  return { db, store, workspace, setLimits };
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
  const other = view.models.find((m) => m.model_id === 'some-other-model');
  assert.equal(other?.exposure_nano_usd, '0');
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

test('only a workspace owner changes limits, with a reason, never above the ceiling', async (t) => {
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
  const stranger: CommandContext = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Not an owner',
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

test('a limit change and a paid dispatch serialize: concurrent saves from one version, one wins', async (t) => {
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
