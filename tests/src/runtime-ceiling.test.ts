import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import type { BrokerCallRequest } from '@creator/contracts';
import {
  BudgetStore,
  ceilingRefusal,
  readSpendingConfig,
  runtimeExposure,
  type CommandContext,
} from '@creator/db';
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

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new BudgetStore(db.pool, { lateWindowMs: 0 });
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  // A small ceiling stands in for the owner's $20 so a few calls reach it.
  store.spending = {
    ...store.spending,
    ceiling_nano_usd: String(EXPOSURE * 3n),
    effective_from: new Date(Date.now() - 60_000).toISOString(),
  };
  async function workspace(mode: 'fixture' | 'real') {
    const ws = await store.createWorkspace(owner, {
      name: `Ceiling ${mode}`,
      record_mode: mode,
    });
    const pricing = await store.createPricing(
      owner,
      ws.id,
      pricingFile(mode === 'real' ? 'openai-gpt-6-astra' : 'fixture-model-v1'),
    );
    // Each workspace's own budget is far above the ceiling: the ceiling still decides.
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
        rationale: 'Ceiling test calls.',
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
      justification: 'Ceiling test call.',
    });
    const prepare = (runId: string, timeoutMs = 5000) =>
      store.prepareAttempt(owner, ws.id, runId, request(), {
        provider: mode === 'real' ? 'openai' : 'fixture',
        model_id: mode === 'real' ? 'gpt-6-astra' : 'fixture-model-v1',
        adapterAvailable: true,
        requestHash: 'a'.repeat(64),
        attempt: 1,
        timeoutMs,
      });
    return { ws, run, prepare };
  }
  return { db, store, workspace };
}

const reason = (p: { kind: string; reservation: { reason_code: string } }) =>
  p.kind === 'reserved' ? 'reserved' : p.reservation.reason_code;

test('the config records the owner decision: $20 overall as the starting value', () => {
  const c = readSpendingConfig();
  assert.equal(c.ceiling_usd, '20.00');
  assert.equal(c.ceiling_nano_usd, '20000000000');
  assert.equal(c.decided_by, 'Jordan');
});

test('the runtime ceiling spans real workspaces; fixture workspaces are not money', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  const b = await s.workspace('real');
  const runA = await a.run();
  const runB = await b.run();
  // Two calls in one workspace and one in another fill the ceiling exactly.
  assert.equal(reason(await a.prepare(runA)), 'reserved');
  assert.equal(reason(await a.prepare(runA)), 'reserved');
  assert.equal(reason(await b.prepare(runB)), 'reserved');
  const over = await b.prepare(runB);
  assert.equal(reason(over), 'runtime_ceiling');
  assert.equal(over.reservation.reserved, '0');
  // A fixture workspace is unaffected: its amounts are simulated units, never money.
  const f = await s.workspace('fixture');
  const runF = await f.run();
  for (let i = 0; i < 5; i += 1)
    assert.equal(reason(await f.prepare(runF)), 'reserved');
});

test('a paid call with an unknown cost blocks every new paid dispatch until reconciled', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  const runA = await a.run();
  assert.equal(reason(await a.prepare(runA, 50)), 'reserved');
  await sleep(150);
  assert.equal(await s.store.sweepStale(owner), 1); // the worker never reported back
  const blocked = await a.prepare(runA);
  assert.equal(reason(blocked), 'runtime_unknown_cost');
  const other = await s.workspace('real');
  assert.equal(
    reason(await other.prepare(await other.run())),
    'runtime_unknown_cost',
  );
});

test('an open final study attempt counts at its full cap; its own calls are not counted twice', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  const studyRun = await a.run();
  const otherRun = await a.run();
  // What StudyStore.holdBudget writes for a final attempt: a t15-final hold at its cap.
  const studyId = randomUUID();
  const attemptId = randomUUID();
  await s.db.pool.query(
    `insert into studies(id, workspace_id, manifest, manifest_hash, created_by)
     values ($1, $2, '{}', $3, $4)`,
    [studyId, a.ws.id, 'b'.repeat(64), owner.actorId],
  );
  await s.db.pool.query(
    `insert into study_attempts(id, study_id, workspace_id, run_id, assignment, context, context_hash, ordinal)
     values ($1, $2, $3, $4, '{}', '{}', $5, 1)`,
    [attemptId, studyId, a.ws.id, studyRun, 'c'.repeat(64)],
  );
  await s.db.pool.query(
    `insert into study_budget_holds(attempt_id, ledger, cap_nano, ledger_cap_nano)
     values ($1, 't15-final', $2, $3)`,
    [attemptId, String(EXPOSURE * 2n), String(EXPOSURE * 3n)],
  );
  // Only one call's worth is left for everything else.
  assert.equal(reason(await a.prepare(otherRun)), 'reserved');
  assert.equal(reason(await a.prepare(otherRun)), 'runtime_ceiling');
  // The study's own calls are inside its held cap, so only the unknown-cost rule applies to
  // them. (Study calls are fixture-provider only until a real model is verified, so this is
  // read through the exposure query rather than a real-workspace study call.)
  const c = await s.db.pool.connect();
  try {
    await c.query('begin');
    const held = await runtimeExposure(c, s.store.spending, {
      ws: a.ws.id,
      runId: studyRun,
    });
    const other = await runtimeExposure(c, s.store.spending, {
      ws: a.ws.id,
      runId: otherRun,
    });
    await c.query('rollback');
    assert.equal(held.exposure_nano_usd, String(EXPOSURE * 3n));
    assert.equal(held.covered_by_hold, true);
    assert.equal(other.covered_by_hold, false);
    assert.equal(ceilingRefusal(held, EXPOSURE), null);
    assert.equal(
      ceilingRefusal(other, EXPOSURE)?.reason_code,
      'runtime_ceiling',
    );
  } finally {
    c.release();
  }
});

test('a workspace owner changes the ceiling in Settings; agents, viewers and stale pages cannot', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const a = await s.workspace('real');
  const runA = await a.run();
  for (let i = 0; i < 3; i += 1)
    assert.equal(reason(await a.prepare(runA)), 'reserved');
  assert.equal(reason(await a.prepare(runA)), 'runtime_ceiling');

  const before = await s.store.runtimeCeiling(owner);
  assert.equal(before.source, 'config');
  assert.equal(before.version, 0);
  assert.equal(before.ceiling_nano_usd, String(EXPOSURE * 3n));
  assert.equal(before.exposure_nano_usd, String(EXPOSURE * 3n));

  // An agent, and a person who owns no workspace, can neither read nor change it.
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
  const raise = {
    expected_version: 0,
    ceiling_nano_usd: String(EXPOSURE * 5n),
    reason: 'Owner raised the limit for the pilot.',
  };
  for (const who of [agent, stranger]) {
    await assert.rejects(s.store.runtimeCeiling(who), {
      code: 'ACCESS_DENIED',
    });
    await assert.rejects(s.store.setRuntimeCeiling(who, raise), {
      code: 'ACCESS_DENIED',
    });
  }

  // Settings accepts at most 15 whole-dollar digits; the server holds the same bound.
  await assert.rejects(
    s.store.setRuntimeCeiling(owner, {
      ...raise,
      ceiling_nano_usd: '1' + '0'.repeat(24),
    }),
    { code: 'INVALID_CONTRACT' },
  );
  const raised = await s.store.setRuntimeCeiling(owner, raise);
  assert.equal(raised.source, 'settings');
  assert.equal(raised.version, 1);
  assert.equal(raised.ceiling_nano_usd, String(EXPOSURE * 5n));
  assert.equal(raised.history[0]?.previous_nano_usd, String(EXPOSURE * 3n));
  // The raise takes effect for the very next dispatch.
  assert.equal(reason(await a.prepare(runA)), 'reserved');

  // A page that loaded version 0 cannot overwrite version 1, and a no-op is refused.
  await assert.rejects(s.store.setRuntimeCeiling(owner, raise), {
    code: 'VERSION_CONFLICT',
  });
  await assert.rejects(
    s.store.setRuntimeCeiling(owner, { ...raise, expected_version: 1 }),
    { code: 'INVALID_CONTRACT' },
  );
  // Lowering below what is already counted stops new dispatch but changes no history.
  const lowered = await s.store.setRuntimeCeiling(owner, {
    expected_version: 1,
    ceiling_nano_usd: String(EXPOSURE),
    reason: 'Owner paused new spending.',
  });
  assert.equal(lowered.version, 2);
  assert.equal(reason(await a.prepare(runA)), 'runtime_ceiling');

  const events = await s.db.pool.query(
    "select actor_id, subject_version from audit_events where action = 'spending.ceiling_changed' order by sequence",
  );
  assert.deepEqual(
    events.rows.map((r) => [r.actor_id, r.subject_version]),
    [
      [owner.actorId, 1],
      [owner.actorId, 2],
    ],
  );
  await assert.rejects(
    s.db.pool.query(
      'update runtime_ceiling_changes set ceiling_nano = 0 where version = 1',
    ),
  );
});

test('the refusal rule: unknown costs first, then what is left', () => {
  const e = {
    ceiling_nano_usd: '100',
    exposure_nano_usd: '60',
    unknown_calls: 0,
    covered_by_hold: false,
  };
  assert.equal(ceilingRefusal(e, 40n), null);
  assert.equal(ceilingRefusal(e, 41n)?.reason_code, 'runtime_ceiling');
  assert.equal(ceilingRefusal({ ...e, covered_by_hold: true }, 41n), null);
  assert.equal(
    ceilingRefusal({ ...e, unknown_calls: 1, covered_by_hold: true }, 1n)
      ?.reason_code,
    'runtime_unknown_cost',
  );
});
