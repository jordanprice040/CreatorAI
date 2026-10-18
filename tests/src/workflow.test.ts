import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';
import {
  ContractError,
  type AutonomyMode,
  type ErrorCode,
  type StartWorkflowRequest,
  type WorkflowDetail,
} from '@creator/contracts';
import {
  ORCHESTRATOR_ACTOR_ID,
  WorkflowStore,
  type CommandContext,
} from '@creator/db';
import {
  FixtureAdapter,
  ModelBroker,
  usage,
  type AdapterOutcome,
  type AdapterRequest,
  type ModelAdapter,
} from '@creator/broker';
import { Worker } from '@creator/orchestrator';
import { freshDatabase } from './pg-harness.js';

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();
const fixturePricing = JSON.parse(
  readFileSync(
    new URL('../../config/pricing/fixture-model-v1.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/** Fixture-provider double whose script decides each call; counts what reached it. */
class ScriptedAdapter implements ModelAdapter {
  readonly provider = 'fixture' as const;
  readonly model_id = 'fixture-model-v1';
  readonly live = false;
  calls: AdapterRequest[] = [];
  constructor(
    private readonly script: (
      req: AdapterRequest,
      signal: AbortSignal,
      n: number,
    ) => Promise<AdapterOutcome>,
  ) {}
  call(req: AdapterRequest, signal: AbortSignal) {
    this.calls.push(req);
    return this.script(req, signal, this.calls.length);
  }
}
const answer = (json: unknown): AdapterOutcome => ({
  kind: 'completed',
  response_id: `resp-${randomUUID()}`,
  text: JSON.stringify(json),
  vector: null,
  usage: usage(40, 30, {}),
  incomplete_reason: null,
});
const critique = {
  summary: 'Weak evidence that a roster tool beats a shared sheet.',
  objections: [
    {
      claim: 'A shared spreadsheet already covers this.',
      severity: 'high',
      evidence_needed: 'Observed failures of the existing sheet.',
    },
  ],
};
const synthesis = {
  summary: 'Investigate before building.',
  disposition: 'investigate',
  disconfirming_test: 'Run the shared sheet for two weeks.',
};
const byKind = (req: AdapterRequest) =>
  answer(req.action === 'model.summarize' ? synthesis : critique);

async function setup(t: test.TestContext, adapter: ModelAdapter) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new WorkflowStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  await store.ensureActor({
    id: ORCHESTRATOR_ACTOR_ID,
    kind: 'agent',
    display_name: 'Workflow worker',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Workflows',
    record_mode: 'fixture',
  });
  const pricing = await store.createPricing(owner, ws.id, fixturePricing);
  const idea = await store.createEntity(owner, ws.id, {
    kind: 'idea',
    title: 'Shared roster',
    body: {
      summary: 'One roster app for the club.',
      uncertainty: 'Synthetic.',
    },
  });
  const envelope = await store.createEnvelope(owner, ws.id, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Owner budget',
    cap_nano_usd: '1000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 32,
  });
  const brokerFor = (s: WorkflowStore, a: ModelAdapter = adapter) =>
    new ModelBroker(s, { fixture: a, live: null }, { retryCapMs: 10 });
  const worker = (
    s: WorkflowStore = store,
    b: ModelBroker = brokerFor(s),
    leaseMs = 5000,
  ) => new Worker(s, b, { leaseMs, heartbeatMs: Math.floor(leaseMs / 4) });
  async function run(mode: AutonomyMode = 'human_in_loop', grant = true) {
    const condition =
      mode === 'human_only'
        ? 'human_only'
        : mode === 'autonomous_within_scope'
          ? 'autonomous'
          : 'human_in_loop';
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: `${mode} run`,
      body: {
        state: 'queued',
        experiment_condition: condition,
        discovery_method:
          mode === 'human_only' ? 'human_defined' : 'structured',
        config_hash: null,
      },
    });
    const control = await store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: mode,
      stage_gates: null,
      initial_grants: [],
    });
    if (grant)
      await store.createStandingGrant(owner, ws.id, {
        run_id: control.run_id,
        action_types: ['model.generate', 'model.summarize'],
        target_kind: null,
        max_amount_nano_usd: '100000000',
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['synthetic'],
        expires_at: inHours(24),
        rationale: 'Routine fixture review calls for this run.',
      });
    return control.run_id;
  }
  const request = (
    perspectives = ['evidence', 'existing tools'],
    limits: Partial<StartWorkflowRequest['limits']> = {},
  ): StartWorkflowRequest => ({
    role: 'r05_skeptic',
    subject: { id: idea.id, version: 1 },
    constraints: ['Synthetic data only.'],
    perspectives,
    envelope_id: envelope.id,
    pricing_snapshot_id: pricing.id,
    data_class: 'synthetic',
    limits: {
      max_children: 4,
      max_concurrency: 1,
      max_depth: 1,
      max_attempts: 1,
      max_repairs: 1,
      max_calls: 12,
      max_output_tokens: 400,
      call_timeout_ms: 5000,
      max_wall_seconds: 600,
      ...limits,
    },
  });
  return { db, store, ws, idea, envelope, brokerFor, worker, run, request };
}

test('a workflow runs to a structured result and continues after a restart', async (t) => {
  const first = new FixtureAdapter();
  const s = await setup(t, first);
  if (!s) return;
  const runId = await s.run();
  const started = await s.store.startWorkflow(
    owner,
    s.ws.id,
    runId,
    s.request(),
  );
  assert.equal(started.workflow.state, 'running');
  // Concurrency 1: one critique delegated, the synthesis waits on its dependencies.
  assert.deepEqual(started.tasks.map((x) => [x.kind, x.state]).sort(), [
    ['critique', 'queued'],
    ['synthesis', 'waiting_dependency'],
  ]);
  await rejects(
    'DUPLICATE',
    s.store.startWorkflow(owner, s.ws.id, runId, s.request()),
  );
  // Worker A completes one task, then the "process" goes away.
  const a = s.worker();
  await a.tick();
  await a.stop();
  const mid = await s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
  assert.equal(
    mid.tasks.filter((x) => x.state === 'succeeded').length,
    1,
    'one checkpointed step before the restart',
  );
  // A new pool, store, broker and worker: nothing in memory survives, only the database.
  const pool = new pg.Pool({ connectionString: s.db.url, max: 4 });
  pool.on('error', () => undefined);
  const second = new FixtureAdapter();
  const store2 = new WorkflowStore(pool);
  const b = s.worker(store2, s.brokerFor(store2, second));
  await b.settle();
  const done = await store2.getWorkflow(owner, s.ws.id, started.workflow.id);
  await pool.end();
  assert.equal(done.workflow.state, 'succeeded');
  assert.equal(done.workflow.result?.outcome, 'succeeded');
  assert.equal(done.workflow.result?.fixture, true);
  assert.ok(done.workflow.result?.synthesis?.summary);
  assert.equal(
    first.calls + second.calls,
    3,
    'two critiques and one synthesis',
  );
  assert.equal(first.calls, 1, 'the completed step was not repeated');
  assert.equal(done.usage.attempts, 3);
  assert.ok(BigInt(done.usage.incurred) > 0n);
  assert.equal(done.usage.unknown, '0');
  // Synthesis context names its inputs by hash; every task kept its own logical operation.
  const synth = done.tasks.find((x) => x.kind === 'synthesis')!;
  assert.equal(synth.context.inputs.length, 2);
  assert.equal(new Set(done.tasks.map((x) => x.logical_operation_id)).size, 3);
  await s.store.drainOutbox();
  const history = await s.store.listHistory(owner, s.ws.id, {
    subjectId: started.workflow.id,
  });
  assert.ok(history.some((h) => h.action === 'workflow.finished'));
  // A finished workflow is immutable.
  await rejects(
    'INVALID_TRANSITION',
    s.store.controlWorkflow(owner, s.ws.id, started.workflow.id, 'pause', {
      expected_version: done.workflow.version,
      reason: 'Too late.',
    }),
  );
});

test('heartbeats keep a live lease past its first expiry, and refuse a stale token', async (t) => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const adapter = new ScriptedAdapter(async (req, _signal, n) => {
    if (n === 1) await gate;
    return byKind(req);
  });
  const s = await setup(t, adapter);
  if (!s) return;
  t.after(open);
  const runId = await s.run();
  const { workflow } = await s.store.startWorkflow(
    owner,
    s.ws.id,
    runId,
    s.request(['evidence']),
  );
  const a = s.worker(s.store, s.brokerFor(s.store), 300);
  await a.tick();
  for (let i = 0; i < 50 && adapter.calls.length < 1; i += 1) await sleep(10);
  assert.equal(adapter.calls.length, 1, 'worker A is in a slow provider call');
  // Three lease lengths later, A's heartbeats have kept the lease: B finds nothing to take.
  await sleep(900);
  const b = s.worker(s.store, s.brokerFor(s.store), 300);
  await b.tick();
  const view = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  const task = view.tasks.find((x) => x.kind === 'critique')!;
  assert.equal(task.deliveries, 1, 'a live lease is not redelivered');
  assert.equal(task.state, 'leased');
  assert.deepEqual(
    await s.store.heartbeat(task.id, '999999999', 300),
    { held: false, cancel: false },
    'a token that does not hold the lease extends nothing',
  );
  open();
  await a.settle();
  const done = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  assert.equal(done.workflow.state, 'succeeded');
  assert.equal(adapter.calls.length, 2);
});

test('a crashed worker loses its lease; the stale worker cannot commit and nothing is sent twice', async (t) => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const adapter = new ScriptedAdapter(async (req, _signal, n) => {
    if (n === 1) await gate;
    return byKind(req);
  });
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  const { workflow } = await s.store.startWorkflow(
    owner,
    s.ws.id,
    runId,
    s.request(['evidence']),
  );
  const a = s.worker(s.store, s.brokerFor(s.store), 300);
  await a.tick();
  for (let i = 0; i < 50 && adapter.calls.length < 1; i += 1) await sleep(10);
  assert.equal(adapter.calls.length, 1, 'worker A is in the provider call');
  a.stallHeartbeats = true;
  await sleep(450);
  // Worker B takes the expired lease (duplicate delivery of the same task).
  const b = s.worker(s.store, s.brokerFor(s.store), 300);
  await b.tick();
  await b.settle(5);
  let view = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  const task = view.tasks.find((x) => x.kind === 'critique')!;
  assert.equal(task.deliveries, 2, 'the task was delivered twice');
  assert.equal(task.state, 'reconciling', 'in-flight call is not re-sent');
  assert.equal(adapter.calls.length, 1);
  // A finishes its call: the broker records the charge once, but A's commit is fenced off.
  open();
  await a.stop();
  view = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  assert.equal(
    view.tasks.find((x) => x.id === task.id)!.deliveries,
    2,
    'stale worker changed nothing',
  );
  await rejects(
    'LEASE_LOST',
    s.store.commitTask({ actorId: ORCHESTRATOR_ACTOR_ID }, task.id, '1', {
      state: 'failed',
      reason: 'stale',
    }),
  );
  // B picks up the recorded result instead of calling again, then finishes.
  await b.settle();
  view = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  assert.equal(view.workflow.state, 'succeeded');
  assert.equal(view.tasks.find((x) => x.id === task.id)!.reason, 'late_result');
  assert.equal(
    adapter.calls.length,
    2,
    'one critique call, one synthesis call',
  );
  assert.equal(
    view.reservations.filter((r) => r.status === 'settled').length,
    2,
  );
});

test('a workflow waits for a decision, survives duplicate wake-ups, then completes', async (t) => {
  const adapter = new ScriptedAdapter(async (req) => byKind(req));
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run('human_in_loop', false);
  const { workflow } = await s.store.startWorkflow(
    owner,
    s.ws.id,
    runId,
    s.request(['evidence']),
  );
  const w = s.worker();
  for (const kind of ['critique', 'synthesis'] as const) {
    await w.settle();
    const view = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
    assert.equal(view.workflow.state, 'waiting_human');
    const waiting = view.tasks.find((x) => x.state === 'waiting_human')!;
    assert.equal(waiting.kind, kind);
    assert.equal(adapter.calls.length, kind === 'critique' ? 0 : 1);
    const d = await s.store.getDecision(owner, s.ws.id, waiting.decision_id!);
    assert.equal(d.kind, 'authorization');
    await s.store.answerDecision(owner, s.ws.id, d.id, {
      choice: 'approve_once',
      option_id: null,
      rationale: 'Fine for synthetic data.',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: 800,
      interruption: 'useful',
    });
    // Deliver the answer event, then deliver it again: the task wakes exactly once.
    const { rows } = await s.db.pool.query<{ id: string }>(
      `select id from audit_events where action = 'decision.answered' and subject_id = $1`,
      [d.id],
    );
    await s.store.deliver(rows[0]!.id);
    await s.store.deliver(rows[0]!.id);
    const woken: WorkflowDetail = await s.store.getWorkflow(
      owner,
      s.ws.id,
      workflow.id,
    );
    const task = woken.tasks.find((x) => x.id === waiting.id)!;
    assert.equal(task.state, 'queued');
    assert.equal(task.version, waiting.version + 1, 'one wake-up, not two');
  }
  await w.settle();
  const done = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  assert.equal(done.workflow.state, 'succeeded');
  assert.equal(
    adapter.calls.length,
    2,
    'each call was sent once, after approval',
  );
});

test('cancellation stops delegation and keeps in-flight exposure held', async (t) => {
  const adapter = new ScriptedAdapter(
    (_req, signal) =>
      new Promise((_resolve, reject) =>
        signal.addEventListener('abort', () => reject(new Error('aborted'))),
      ),
  );
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  const { workflow } = await s.store.startWorkflow(
    owner,
    s.ws.id,
    runId,
    s.request(['evidence', 'existing tools', 'maintenance']),
  );
  const broker = s.brokerFor(s.store);
  const w = s.worker(s.store, broker, 400);
  await w.tick();
  for (let i = 0; i < 50 && adapter.calls.length < 1; i += 1) await sleep(10);
  const before = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  // Closing the page is not cancellation: the workflow is still running on the server.
  assert.equal(before.workflow.state, 'running');
  const cancelled = await s.store.controlWorkflow(
    owner,
    s.ws.id,
    workflow.id,
    'cancel',
    { expected_version: before.workflow.version, reason: 'Owner stop.' },
  );
  assert.equal(cancelled.workflow.control, 'cancel');
  // The worker learns of the cancel from its heartbeat (as a separate process would).
  await w.settle();
  const done = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  assert.equal(done.workflow.state, 'cancelled');
  assert.equal(done.workflow.result?.outcome, 'cancelled');
  assert.equal(
    done.tasks.filter((x) => x.kind === 'critique').length,
    1,
    'no further critiques were delegated',
  );
  assert.equal(adapter.calls.length, 1);
  assert.equal(done.usage.in_flight, 0);
  assert.ok(BigInt(done.usage.unknown) > 0n, 'in-flight exposure stays held');
  assert.equal(done.reservations[0]?.status, 'unknown');
});

test('autonomous runs stop as needs-human; human-only and unbounded workflows never start', async (t) => {
  const adapter = new ScriptedAdapter(async (req) => byKind(req));
  const s = await setup(t, adapter);
  if (!s) return;
  const auto = await s.run('autonomous_within_scope', false);
  const { workflow } = await s.store.startWorkflow(
    owner,
    s.ws.id,
    auto,
    s.request(['evidence']),
  );
  await s.worker().settle();
  const done = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  assert.equal(done.workflow.state, 'failed');
  assert.equal(done.workflow.result?.outcome, 'needs_human');
  assert.equal(adapter.calls.length, 0, 'nothing reached the provider');
  assert.equal(
    (await s.store.listDecisions(owner, s.ws.id, { runId: auto })).length,
    0,
    'an autonomous run cannot ask for task-specific help',
  );
  const human = await s.run('human_only', false);
  await rejects(
    'HUMAN_ONLY_DENIED',
    s.store.startWorkflow(owner, s.ws.id, human, s.request()),
  );
  const other = await s.run();
  await rejects(
    'INVALID_CONTRACT',
    s.store.startWorkflow(
      owner,
      s.ws.id,
      other,
      s.request(['a', 'b', 'c'], { max_calls: 3 }),
    ),
  );
  // The worker agent may submit actions but is not an owner: it cannot start or steer work.
  await rejects(
    'ACCESS_DENIED',
    s.store.startWorkflow(
      { actorId: ORCHESTRATOR_ACTOR_ID },
      s.ws.id,
      other,
      s.request(),
    ),
  );
});

test('a malformed answer is repaired within limits; pause holds dispatch until resume', async (t) => {
  const adapter = new ScriptedAdapter(async (req, _s, n) =>
    n === 1 ? { ...answer({}), text: 'not json' } : byKind(req),
  );
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  const { workflow } = await s.store.startWorkflow(
    owner,
    s.ws.id,
    runId,
    s.request(['evidence']),
  );
  const w = s.worker();
  await w.tick();
  await w.stop();
  let view = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  const paused = await s.store.controlWorkflow(
    owner,
    s.ws.id,
    workflow.id,
    'pause',
    { expected_version: view.workflow.version, reason: 'Check first.' },
  );
  assert.equal(paused.workflow.state, 'paused_operator');
  await s.worker().settle();
  view = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  assert.equal(adapter.calls.length, 1, 'paused: nothing new dispatched');
  await s.store.controlWorkflow(owner, s.ws.id, workflow.id, 'resume', {
    expected_version: view.workflow.version,
    reason: 'Go on.',
  });
  await s.worker().settle();
  view = await s.store.getWorkflow(owner, s.ws.id, workflow.id);
  assert.equal(view.workflow.state, 'succeeded');
  const critiques = view.tasks.filter((x) => x.kind === 'critique');
  assert.deepEqual(
    critiques.map((x) => [x.repair, x.state, x.reason]),
    [
      [0, 'failed', 'malformed_output'],
      [1, 'succeeded', 'succeeded'],
    ],
    'the failed attempt is preserved next to its repair',
  );
  assert.equal(critiques[1]?.repair_of, critiques[0]?.id);
  assert.equal(adapter.calls.length, 3);
});
