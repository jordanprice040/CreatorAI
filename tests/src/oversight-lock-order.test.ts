import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';
import {
  ContractError,
  routinePolicySummary,
  type ActionRequest,
  type ErrorCode,
  type RoutinePolicyInput,
} from '@creator/contracts';
import {
  AUDIT_CHAIN_LOCK,
  OversightStore,
  type CommandContext,
} from '@creator/db';
import { freshDatabase } from './pg-harness.js';

// ADR-0098: oversight writes take their locks in one order (run, decision, routine policy,
// grant) and every row lock before the audit lock. Each test parks the transactions at the
// point where the old order deadlocked, by holding a lock both need, and then lets them go.
const owner: CommandContext = { actorId: randomUUID() };
const agent: CommandContext = { actorId: randomUUID() };
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();

/** Waits until `n` sessions in this test database wait on a lock (from #180's tests). */
async function lockWaiters(pool: Pool, n: number, ms = 10_000) {
  const end = Date.now() + ms;
  for (;;) {
    const { rows } = await pool.query(
      `select count(*)::int as n from pg_stat_activity
        where datname = current_database() and wait_event_type = 'Lock'`,
    );
    if (rows[0].n >= n) return;
    if (Date.now() > end)
      throw new Error(`timed out waiting for ${n} lock waiters`);
    await new Promise((r) => setTimeout(r, 20));
  }
}

/** Holds a lock in its own transaction until `release` is called. */
async function hold(pool: Pool, sql: string, params: unknown[]) {
  const c = await pool.connect();
  await c.query('begin');
  await c.query(sql, params);
  return async () => {
    await c.query('commit');
    c.release();
  };
}
const holdAudit = (pool: Pool) =>
  hold(pool, 'select pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);

const routine = (): RoutinePolicyInput & { summary_seen: string[] } => {
  const input: RoutinePolicyInput = {
    stages: ['model_work', 'selection'],
    data_classes: ['synthetic'],
    max_actions: 20,
    max_total_nano_usd: null,
    stop_on: [],
    expires_at: inHours(24),
    rationale: 'Routine synthetic work for this run.',
  };
  return { ...input, summary_seen: routinePolicySummary(input) };
};

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new OversightStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  await store.ensureActor({
    id: agent.actorId,
    kind: 'agent',
    display_name: 'Builder agent',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Lock order',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, agent.actorId, 'editor');
  const idea = await store.createEntity(owner, ws.id, {
    kind: 'idea',
    title: 'Shared roster',
    body: { summary: 'One roster.', uncertainty: 'Synthetic.' },
  });
  async function run(withRoutine = false) {
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: 'Supervised run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    return store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: 'supervised',
      stage_gates: null,
      initial_grants: [],
      routine_policy: withRoutine ? routine() : null,
    });
  }
  const action: ActionRequest = {
    action_type: 'record.revise',
    task_id: null,
    target: { id: idea.id, version: idea.version },
    spec_hash: null,
    amount_nano_usd: null,
    data_class: 'synthetic',
    assumption_ids: [],
    humility_review: null,
    flags: [],
    justification: 'Synthetic test action.',
  };
  /** A pending authorization decision on the run, raised by an uncovered action. */
  async function pending(runId: string) {
    const a = await store.admitAction(agent, ws.id, runId, action);
    assert.ok(a.decision_id, 'the action should ask a person');
    return store.getDecision(owner, ws.id, a.decision_id);
  }
  const runGrant = (runId: string) =>
    store.createStandingGrant(owner, ws.id, {
      run_id: runId,
      action_types: ['record.revise'],
      target_kind: null,
      max_amount_nano_usd: null,
      allow_irreversible: false,
      allow_external_effects: false,
      data_classes: ['synthetic'],
      expires_at: inHours(1),
      rationale: 'Routine synthetic edits.',
    });
  const cancel = (runId: string) =>
    store.cancelRun(owner, ws.id, runId, { reason: 'Stopped by owner.' });
  return { db, store, ws, run, action, pending, runGrant, cancel };
}

const deadlock = (r: PromiseSettledResult<unknown>) =>
  r.status === 'rejected' && /deadlock/i.test(String(r.reason));
const fulfilled = (r: PromiseSettledResult<unknown>) =>
  assert.equal(
    r.status,
    'fulfilled',
    String(r.status === 'rejected' && r.reason),
  );
const refused = (r: PromiseSettledResult<unknown>, ...codes: ErrorCode[]) =>
  assert.ok(
    r.status === 'rejected' &&
      r.reason instanceof ContractError &&
      codes.includes(r.reason.code),
    String(r.status === 'rejected' ? r.reason : 'it succeeded'),
  );

test('cancelling a run while its run grant is revoked never deadlocks', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run();
  await s.pending(run.run_id);
  const grant = await s.runGrant(run.run_id);
  const release = await holdAudit(s.db.pool);
  // The cancel locks the run, closes the pending decision and waits for the audit lock.
  const cancel = s.cancel(run.run_id);
  await lockWaiters(s.db.pool, 1);
  // The old revoke locked the grant here and then waited for the audit lock, so the cancel,
  // once it had the audit lock, waited on the grant: a cycle. Now it waits for the run first.
  const revoke = s.store.revokeGrant(owner, s.ws.id, grant.id, {
    expected_version: grant.version,
    reason: 'No longer needed.',
  });
  await lockWaiters(s.db.pool, 2);
  await release();
  const [c, r] = await Promise.allSettled([cancel, revoke]);
  assert.ok(
    !deadlock(c) && !deadlock(r),
    String(
      c.status === 'rejected' ? c.reason : r.status === 'rejected' && r.reason,
    ),
  );
  fulfilled(c);
  // The cancel revoked the grant first, so the revoke finds a newer version.
  refused(r, 'VERSION_CONFLICT');
  const after = (await s.store.listGrants(owner, s.ws.id)).find(
    (g) => g.id === grant.id,
  )!;
  assert.equal(after.status, 'revoked');
  assert.equal(after.revoke_reason, 'Run cancelled');
});

test('revoking a routine policy grant while the policy is revised never deadlocks', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run(true);
  const [policy] = (await s.store.listRoutinePolicies(owner, s.ws.id)).map(
    (v) => v.policy,
  );
  const grant = (await s.store.listGrants(owner, s.ws.id)).find(
    (g) => g.id === policy!.grant_id,
  )!;
  const release = await holdAudit(s.db.pool);
  // The revoke locks the grant, writes it and waits for the audit lock; the old code then
  // locked the policy row.
  const revoke = s.store.revokeGrant(owner, s.ws.id, grant.id, {
    expected_version: grant.version,
    reason: 'No longer needed.',
  });
  await lockWaiters(s.db.pool, 1);
  // The revision locks the run and the policy, then wants the grant.
  const revise = s.store.reviseRoutinePolicy(owner, s.ws.id, policy!.id, {
    expected_version: policy!.version,
    ...routine(),
    max_actions: 5,
    summary_seen: routinePolicySummary({ ...routine(), max_actions: 5 }),
  });
  await lockWaiters(s.db.pool, 2);
  await release();
  const [r, v] = await Promise.allSettled([revoke, revise]);
  assert.ok(
    !deadlock(r) && !deadlock(v),
    String(
      r.status === 'rejected' ? r.reason : v.status === 'rejected' && v.reason,
    ),
  );
  fulfilled(r);
  // The policy went with its grant, so the revision is refused rather than reviving it.
  refused(v, 'VERSION_CONFLICT', 'INVALID_TRANSITION');
  const [after] = await s.store.listRoutinePolicies(owner, s.ws.id);
  assert.equal(after!.policy.status, 'revoked');
  assert.equal(after!.policy.run_id, run.run_id);
});

test('approving a decision once while its run is cancelled never deadlocks', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run();
  const d = await s.pending(run.run_id);
  // The approval's new grant checks its creator before its run; holding the creator's actor
  // row parks the approval after it has locked the decision and before it touches the run.
  const release = await hold(
    s.db.pool,
    'select 1 from actors where id = $1 for update',
    [owner.actorId],
  );
  const answer = s.store.answerDecision(owner, s.ws.id, d.id, {
    choice: 'approve_once',
    option_id: null,
    rationale: 'Reviewed.',
    coverage_hash: d.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: 900,
    interruption: null,
  });
  await lockWaiters(s.db.pool, 1);
  // The old cancel locked the run here and waited on the decision, while the approval's grant
  // then waited on the run. Now the approval holds the run before the decision.
  const cancel = s.cancel(run.run_id);
  await lockWaiters(s.db.pool, 2);
  await release();
  const [a, c] = await Promise.allSettled([answer, cancel]);
  assert.ok(
    !deadlock(a) && !deadlock(c),
    String(
      a.status === 'rejected' ? a.reason : c.status === 'rejected' && c.reason,
    ),
  );
  fulfilled(a);
  fulfilled(c);
  // The cancel came second, so it revoked the one-time grant the approval created.
  const grants = await s.store.listGrants(owner, s.ws.id);
  assert.equal(grants.length, 1);
  assert.equal(grants[0]!.status, 'revoked');
});

test('an admission that expires a decision while its run is cancelled never deadlocks', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run();
  const d = await s.pending(run.run_id);
  await s.db.pool.query(
    `update decision_requests set created_at = now() - interval '2 minutes',
       expires_at = now() - interval '1 minute' where id = $1`,
    [d.id],
  );
  const release = await holdAudit(s.db.pool);
  // The old admission expired the decision and waited for the audit lock before locking the
  // run; the cancel then locked the run and waited on the decision.
  const admit = s.store.admitAction(agent, s.ws.id, run.run_id, s.action);
  await lockWaiters(s.db.pool, 1);
  const cancel = s.cancel(run.run_id);
  await lockWaiters(s.db.pool, 2);
  await release();
  const [a, c] = await Promise.allSettled([admit, cancel]);
  assert.ok(
    !deadlock(a) && !deadlock(c),
    String(
      a.status === 'rejected' ? a.reason : c.status === 'rejected' && c.reason,
    ),
  );
  fulfilled(a);
  fulfilled(c);
  assert.equal(
    (await s.store.getDecision(owner, s.ws.id, d.id)).status,
    'expired',
  );
});

test('an admission that expires a decision while a workspace grant is revoked never deadlocks', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run();
  const d = await s.pending(run.run_id);
  await s.db.pool.query(
    `update decision_requests set created_at = now() - interval '2 minutes',
       expires_at = now() - interval '1 minute' where id = $1`,
    [d.id],
  );
  const grant = await s.store.createStandingGrant(owner, s.ws.id, {
    run_id: null,
    action_types: ['record.revise'],
    target_kind: null,
    max_amount_nano_usd: null,
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: inHours(1),
    rationale: 'Routine synthetic edits anywhere.',
  });
  const release = await holdAudit(s.db.pool);
  // The old admission expired the decision and waited for the audit lock before locking the
  // grants; the revoke then locked the grant and waited for the audit lock too.
  const admit = s.store.admitAction(agent, s.ws.id, run.run_id, s.action);
  await lockWaiters(s.db.pool, 1);
  const revoke = s.store.revokeGrant(owner, s.ws.id, grant.id, {
    expected_version: grant.version,
    reason: 'No longer needed.',
  });
  await lockWaiters(s.db.pool, 2);
  await release();
  const [a, r] = await Promise.allSettled([admit, revoke]);
  assert.ok(
    !deadlock(a) && !deadlock(r),
    String(
      a.status === 'rejected' ? a.reason : r.status === 'rejected' && r.reason,
    ),
  );
  fulfilled(a);
  fulfilled(r);
  // The admission locked the grant first, so it was still active for it.
  assert.equal(a.status === 'fulfilled' && a.value.verdict, 'allow');
});
