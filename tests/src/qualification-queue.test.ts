import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CREDITS_OFF_STATEMENT,
  ContractError,
  type PlanConnection,
} from '@creator/contracts';
import {
  ConnectionStore,
  NotificationStore,
  offeredDiscoveryBenchmarks,
  type CommandContext,
} from '@creator/db';
import {
  MemoryVault,
  PlanConnectionService,
  QualificationQueueRunner,
} from '@creator/broker';
import { canonicalHash } from '@creator/domain';
import { freshDatabase } from './pg-harness.js';
import { fakePlan, type FakePlanOptions } from './plan-fakes.js';

// ADR-0088 (P24): queued qualifications run one after another in the studio, each started and
// admitted on its own when its turn comes; a failure, a refusal or a cancel stops the queue.

const root = new URL('../../', import.meta.url);
const read = (p: string) =>
  JSON.parse(readFileSync(new URL(p, root), 'utf8')) as Record<string, unknown>;
const SETTINGS = read(
  'config/connections/chatgpt-plan.json',
) as unknown as PlanConnection['settings'];
const FIXTURE = read('config/routing/benchmark.fixture.json');
/** The fixture benchmark (10 cases, 8 held out) relabelled for another task class. */
const bench = (task_class: string) => ({
  ...FIXTURE,
  name: `fixture-${task_class}-v1`,
  task_class,
});
const CASES = (FIXTURE.cases as unknown[]).length;
const GOOD = { kind: 'text' as const, text: '{"fixture":true,"summary":"s"}' };
const BAD = { kind: 'text' as const, text: 'not json' };
const owner: CommandContext = { actorId: randomUUID() };
const until = async (f: () => boolean | Promise<boolean>, ms = 10000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const refused = (p: Promise<unknown>, code: string, m: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(e.code, code, e.message);
    assert.match(e.message, m);
    return true;
  });

async function setup(t: test.TestContext, opts: FakePlanOptions = {}) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const fake = await fakePlan(opts);
  t.after(() => fake.close());
  const service = new PlanConnectionService({
    store,
    vault: new MemoryVault(),
    fixtureEndpoints: { auth_base: fake.auth_base, api_base: fake.api_base },
    openBrowser: () => {},
    callbackPort: 0,
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Queue fixture',
    record_mode: 'fixture',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  const s = await service.beginSignIn(owner, ws.id, conn.id, {
    open_browser: false,
  });
  assert.equal(await fake.approve(s.authorization_url), 200);
  await until(() => service.signInStatus(conn.id)?.state !== 'pending');
  let c = await current();
  await store.attestPlanCredits(owner, ws.id, c.id, {
    expected_version: c.version,
    statement: CREDITS_OFF_STATEMENT,
    checked_on: '2026-11-11',
  });
  c = await current();
  await store.acceptPlanCaps(owner, ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  c = await current();
  const grant = await store.createPlanVerificationGrant(owner, ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  await service.verifyModel(owner, ws.id, c.id, {
    id: grant.id,
    model_id: 'm',
  });
  const queue = async (tasks: string[]) =>
    store.startQualificationQueue(owner, ws.id, conn.id, {
      expected_version: (await current()).version,
      model_id: 'm',
      items: tasks.map((tc) => ({
        manifest: bench(tc),
        min_held_out_cases: 8,
        floor: { numerator: 1, denominator: 1 },
      })),
    });
  const runner = (holder?: string, leaseMs?: number) =>
    new QualificationQueueRunner(
      { store, service, ...(leaseMs ? { leaseMs } : {}) },
      holder,
    );
  const quals = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).qualifications;
  const detailQueue = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id))
      .qualification_queue!;
  /** Responses-route calls sent so far, after the one verification call. */
  const sent = () => fake.responseRequests.length - 1;
  return {
    db,
    store,
    service,
    fake,
    ws,
    conn,
    current,
    queue,
    runner,
    quals,
    detailQueue,
    sent,
  };
}

test('ADR-0088: a queue runs its tasks in order, each started once, and finishes', async (t) => {
  let hold = false;
  let release = () => {};
  let held = new Promise<void>((r) => (release = r));
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
    beforeResponse: async () => {
      if (hold) await held;
    },
  });
  if (!s) return;
  const q = await s.queue(['summarization', 'specification', 'scoring']);
  assert.equal(q.state, 'running');
  assert.deepEqual(
    q.items.map((i) => [i.task_class, i.state, i.qualification_id]),
    [
      ['summarization', 'waiting', null],
      ['specification', 'waiting', null],
      ['scoring', 'waiting', null],
    ],
  );
  // Queueing starts nothing and sends nothing.
  assert.equal((await s.quals()).length, 0);
  assert.equal(s.sent(), 0);
  hold = true;
  const r = s.runner();
  await r.sweep();
  await until(() => s.sent() > 0);
  // Progress is read from the server: Activity, the detail and the qualification's own flag.
  const now = await s.store.activityNow(owner, s.ws.id);
  const item = now.items.find((i) => i.kind === 'qualification_queue');
  assert.ok(item, 'the queue shows in Activity');
  assert.equal(item.active, true);
  assert.match(item.detail, /0 of 3 done · now summarization/);
  const running = await s.detailQueue();
  assert.equal(running.active, true);
  assert.equal(running.items[0]!.state, 'running');
  assert.equal(
    (await s.quals()).find((x) => x.task_class === 'summarization')?.executing,
    true,
  );
  // A Run pressed by hand while the queue works here is refused before anything is sent.
  const qid = running.items[0]!.qualification_id!;
  await refused(
    s.service.runQualification(owner, s.ws.id, qid),
    'INVALID_TRANSITION',
    /queue is qualifying tasks/,
  );
  // So is a start by hand (PR #177 review 8 N-1): the queue would later meet that run.
  await refused(
    s.store.startPlanQualification(owner, s.ws.id, s.conn.id, {
      expected_version: (await s.current()).version,
      model_id: 'm',
      manifest: bench('summarization'),
      min_held_out_cases: 8,
      floor: { numerator: 1, denominator: 1 },
    }),
    'INVALID_TRANSITION',
    /queue is qualifying tasks/,
  );
  hold = false;
  release();
  held = Promise.resolve();
  await r.idle();
  const done = await s.detailQueue();
  assert.equal(done.state, 'done');
  assert.equal(done.reason, null);
  assert.deepEqual(
    done.items.map((i) => i.state),
    ['qualified', 'qualified', 'qualified'],
  );
  assert.equal(s.sent(), 3 * CASES, 'every case of every task sent once');
  const qs = await s.quals();
  assert.equal(qs.length, 3, 'one qualification per task');
  const order = [...qs]
    .sort((a, b) => a.created_at.localeCompare(b.created_at))
    .map((x) => x.task_class);
  assert.deepEqual(order, ['summarization', 'specification', 'scoring']);
  assert.ok(
    done.items.every((i) => qs.some((x) => x.id === i.qualification_id)),
  );
  // Gone from Activity once finished; the lease was released.
  const after = await s.store.activityNow(owner, s.ws.id);
  assert.ok(!after.items.some((i) => i.kind === 'qualification_queue'));
  const lease = await s.db.pool.query(
    'select lease_holder from plan_qualification_queues where id = $1',
    [q.id],
  );
  assert.equal(lease.rows[0].lease_holder, null);
  // Each start is audited with its queue.
  const events = await s.db.pool.query(
    `select body from plan_connection_events where kind = 'qualification_started'`,
  );
  assert.equal(events.rows.length, 3);
  assert.ok(events.rows.every((e) => e.body.queue_id === q.id));
  // ADR-0116 (N1): each pass is an inbox row in the queue's batch, and the finished queue one
  // more; nothing interrupts.
  await s.store.drainOutbox();
  const told = (await new NotificationStore(s.db.pool).notifications(owner))
    .items;
  assert.deepEqual(
    told.map((n) => [n.event_key, n.batch_id, n.interrupt_state]).sort(),
    [
      ['qualification.passed', q.id, 'none'],
      ['qualification.passed', q.id, 'none'],
      ['qualification.passed', q.id, 'none'],
      ['qualification.queue_done', null, 'none'],
    ],
  );
  assert.equal(
    told.find((n) => n.event_key === 'qualification.queue_done')!.title,
    'Qualification queue completed: 3 of 3 qualified',
  );
});

test('ADR-0088: a failed qualification stops the queue and nothing after it starts', async (t) => {
  // Verification, then the first task's cases all answer badly, so it fails.
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, BAD],
  });
  if (!s) return;
  const queued = await s.queue(['summarization', 'specification', 'scoring']);
  const r = s.runner();
  await r.sweep();
  await r.idle();
  const q = await s.detailQueue();
  assert.equal(q.state, 'stopped');
  assert.match(q.reason ?? '', /summarization did not qualify \(0 of 8/);
  assert.deepEqual(
    q.items.map((i) => i.state),
    ['failed', 'cancelled', 'cancelled'],
  );
  assert.match(q.items[1]!.reason ?? '', /queue stopped before it/);
  assert.equal(s.sent(), CASES, 'only the failed task was sent');
  assert.equal((await s.quals()).length, 1, 'nothing else was started');
  // A stopped queue is not picked up again.
  await r.sweep();
  await r.idle();
  assert.equal(s.sent(), CASES);
  // ADR-0116 (N1) check 12b: one summary interrupts; the failed attempt is an inbox row in the
  // batch with no pop-up of its own.
  await s.store.drainOutbox();
  const told = (await new NotificationStore(s.db.pool).notifications(owner))
    .items;
  assert.deepEqual(
    told.map((n) => [n.title, n.batch_id, n.interrupt_state]).sort(),
    [
      ['1 of 3 qualifications failed; 2 were not started', null, 'pending'],
      ['Qualification failed: summarization on m', queued.id, 'none'],
    ].sort(),
  );
});

test('ADR-0116 check 12c: a standalone qualification that fails alerts once, titled for itself', async (t) => {
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, BAD],
  });
  if (!s) return;
  const qual = await s.store.startPlanQualification(owner, s.ws.id, s.conn.id, {
    expected_version: (await s.current()).version,
    model_id: 'm',
    manifest: bench('summarization'),
    min_held_out_cases: 8,
    floor: { numerator: 1, denominator: 1 },
  });
  await s.service.runQualification(owner, s.ws.id, qual.id);
  await s.store.drainOutbox();
  const told = (await new NotificationStore(s.db.pool).notifications(owner))
    .items;
  assert.deepEqual(
    told.map((n) => [n.event_key, n.title, n.batch_id, n.interrupt_state]),
    [
      [
        'qualification.failures',
        'Qualification failed: summarization on m',
        null,
        'pending',
      ],
    ],
  );
});

test('ADR-0116 review L-3: a queue the studio stops before any task starts is one inbox row', async (t) => {
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
  });
  if (!s) return;
  const q = await s.queue(['summarization', 'specification']);
  const holder = randomUUID();
  assert.ok(await s.store.leaseQualificationQueue(holder, 60_000));
  await s.store.abandonQualificationQueue(q.id, holder, 'test stop');
  const after = await s.detailQueue();
  assert.equal(after.state, 'stopped');
  assert.deepEqual(
    after.items.map((i) => i.state),
    ['cancelled', 'cancelled'],
  );
  await s.store.drainOutbox();
  const told = (await new NotificationStore(s.db.pool).notifications(owner))
    .items;
  assert.deepEqual(
    told.map((n) => [n.event_key, n.title, n.interrupt_state]),
    [
      [
        'qualification.queue_done',
        'Qualification queue stopped: 0 of 2 qualified; 2 were not started',
        'none',
      ],
    ],
  );
});

test('ADR-0088: cancelling mid-queue lets the running task finish and starts nothing else', async (t) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let hold = false;
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
    beforeResponse: async () => {
      if (hold) await held;
    },
  });
  if (!s) return;
  const q = await s.queue(['summarization', 'specification']);
  hold = true;
  const r = s.runner();
  await r.sweep();
  await until(() => s.sent() > 0);
  const cancelled = await s.store.cancelQualificationQueue(
    owner,
    s.ws.id,
    q.id,
  );
  assert.equal(cancelled.state, 'cancelled');
  assert.match(cancelled.reason ?? '', /already running finishes on its own/);
  assert.deepEqual(
    cancelled.items.map((i) => i.state),
    ['running', 'cancelled'],
  );
  await refused(
    s.store.cancelQualificationQueue(owner, s.ws.id, q.id),
    'INVALID_TRANSITION',
    /already finished/,
  );
  hold = false;
  release();
  await r.idle();
  const after = await s.detailQueue();
  assert.equal(after.state, 'cancelled');
  assert.deepEqual(
    after.items.map((i) => i.state),
    ['qualified', 'cancelled'],
  );
  assert.equal(s.sent(), CASES, 'the cancelled task sent nothing');
  const qs = await s.quals();
  assert.deepEqual(
    qs.map((x) => x.task_class),
    ['summarization'],
  );
  // With the queue over, a Run by hand is allowed again (it is refused as finished here).
  await refused(
    s.service.runQualification(owner, s.ws.id, qs[0]!.id),
    'INVALID_TRANSITION',
    /already finished/,
  );
});

test('ADR-0088: a crash between two runs records the first and starts the next once', async (t) => {
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
  });
  if (!s) return;
  const q = await s.queue(['summarization', 'specification', 'scoring']);
  // Process A takes the lease, runs the first task to its decision and dies before recording it.
  const a = randomUUID();
  assert.ok(await s.store.leaseQualificationQueue(a, 60_000));
  const first = await s.store.nextQueuedQualification(q.id, a);
  assert.equal(first.kind, 'run');
  const out = await s.service.runQualification(
    owner,
    s.ws.id,
    first.kind === 'run' ? first.qualification_id : '',
    q.id,
  );
  assert.equal(out.state, 'decided');
  // While A's lease is live, nobody else takes the queue.
  assert.equal(
    await s.store.leaseQualificationQueue(randomUUID(), 60_000),
    null,
  );
  // A second process asking with a holder that does not own the lease gets nothing to run.
  assert.deepEqual(await s.store.nextQueuedQualification(q.id, randomUUID()), {
    kind: 'end',
  });
  // The lease expires (A is gone). B takes over.
  await s.db.pool.query(
    `update plan_qualification_queues set lease_until = clock_timestamp() - interval '1 second' where id = $1`,
    [q.id],
  );
  const b = s.runner(randomUUID());
  // Two sweeps at once in B, and a third process, still run each task once.
  const c = s.runner(randomUUID());
  await Promise.all([b.sweep(), c.sweep()]);
  await Promise.all([b.idle(), c.idle()]);
  const done = await s.detailQueue();
  assert.equal(done.state, 'done');
  assert.deepEqual(
    done.items.map((i) => i.state),
    ['qualified', 'qualified', 'qualified'],
  );
  const qs = await s.quals();
  assert.equal(qs.length, 3, 'no task was started twice');
  assert.equal(s.sent(), 3 * CASES, 'no case was sent twice');
  const cases = await s.db.pool.query(
    `select qualification_id, case_id, count(*)::int as n from plan_requests
      where qualification_id is not null group by 1, 2 having count(*) > 1`,
  );
  assert.equal(cases.rows.length, 0);
});

test('ADR-0088: a crash after the next task started resumes that qualification, not a new one', async (t) => {
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
  });
  if (!s) return;
  const q = await s.queue(['summarization', 'specification']);
  const a = randomUUID();
  assert.ok(await s.store.leaseQualificationQueue(a, 60_000));
  const first = await s.store.nextQueuedQualification(q.id, a);
  assert.equal(first.kind, 'run');
  // A dies right after the start was recorded, before sending anything.
  await s.db.pool.query(
    `update plan_qualification_queues set lease_until = clock_timestamp() - interval '1 second' where id = $1`,
    [q.id],
  );
  const r = s.runner();
  await r.sweep();
  await r.idle();
  const done = await s.detailQueue();
  assert.equal(done.state, 'done');
  assert.equal(
    done.items[0]!.qualification_id,
    first.kind === 'run' ? first.qualification_id : null,
  );
  assert.equal((await s.quals()).length, 2);
  assert.equal(s.sent(), 2 * CASES);
});

test('ADR-0088: a later task is admitted when its turn comes, so a cap change refuses it', async (t) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let hold = false;
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
    beforeResponse: async () => {
      if (hold) await held;
    },
  });
  if (!s) return;
  await s.queue(['summarization', 'specification', 'scoring']);
  hold = true;
  const r = s.runner();
  await r.sweep();
  await until(() => s.sent() > 0);
  // While the first task runs, the owner stops allowing specification and accepts the caps.
  let c = await s.current();
  await s.store.updatePlanSettings(owner, s.ws.id, c.id, {
    expected_version: c.version,
    settings: {
      ...c.settings,
      allowed_task_classes: c.settings.allowed_task_classes.filter(
        (x) => x !== 'specification',
      ),
    },
  });
  c = await s.current();
  await s.store.acceptPlanCaps(owner, s.ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  hold = false;
  release();
  await r.idle();
  const q = await s.detailQueue();
  assert.equal(q.state, 'stopped');
  assert.deepEqual(
    q.items.map((i) => i.state),
    ['qualified', 'stopped', 'cancelled'],
  );
  assert.match(q.items[1]!.reason ?? '', /specification was not started/);
  assert.match(q.reason ?? '', /Stopped at specification.*not allowed/);
  assert.equal(q.items[1]!.qualification_id, null);
  assert.equal(s.sent(), CASES, 'nothing was sent for the refused task');
});

test('ADR-0088: caps changed and not accepted again stop the queue at the next request', async (t) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let hold = false;
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
    beforeResponse: async () => {
      if (hold) await held;
    },
  });
  if (!s) return;
  await s.queue(['summarization', 'specification']);
  hold = true;
  const r = s.runner();
  await r.sweep();
  await until(() => s.sent() > 0);
  const c = await s.current();
  await s.store.updatePlanSettings(owner, s.ws.id, c.id, {
    expected_version: c.version,
    settings: {
      ...c.settings,
      caps: {
        ...c.settings.caps,
        responses: { ...c.settings.caps.responses, max_requests_per_run: 9 },
      },
    },
  });
  hold = false;
  release();
  await r.idle();
  const q = await s.detailQueue();
  assert.equal(q.state, 'stopped');
  // The first task's remaining cases and the second task were refused by admission per request.
  assert.equal(q.items[0]!.state, 'stopped');
  assert.match(q.reason ?? '', /Stopped at summarization/);
  assert.match(q.reason ?? '', /not accepted the current caps/);
  assert.equal(q.items[1]!.state, 'cancelled');
  assert.equal(s.sent(), 1, 'only the case already in flight was sent');
});

test('ADR-0088: a queue takes only allowed tasks not yet qualified, one queue per connection, owner only', async (t) => {
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
  });
  if (!s) return;
  // A started qualification with the same benchmark is taken over, not started again.
  const started = await s.store.startPlanQualification(
    owner,
    s.ws.id,
    s.conn.id,
    {
      expected_version: (await s.current()).version,
      model_id: 'm',
      manifest: bench('summarization'),
      min_held_out_cases: 8,
      floor: { numerator: 1, denominator: 1 },
    },
  );
  await refused(
    s.queue(['summarization', 'summarization']),
    'INVALID_CONTRACT',
    /once/,
  );
  await refused(s.queue(['code_build']), 'SCOPE_EXCEEDED', /not allowed/);
  const q = await s.queue(['summarization']);
  assert.equal(q.items[0]!.qualification_id, started.id);
  assert.equal(q.items[0]!.state, 'running');
  await refused(s.queue(['specification']), 'DUPLICATE', /already qualifying/);
  // Someone who is not the owner cannot cancel it.
  const other: CommandContext = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: other.actorId,
    kind: 'human',
    display_name: 'other',
  });
  await assert.rejects(
    s.store.cancelQualificationQueue(other, s.ws.id, q.id),
    ContractError,
  );
  const r = s.runner();
  await r.sweep();
  await r.idle();
  assert.equal((await s.detailQueue()).state, 'done');
  assert.equal((await s.quals()).length, 1, 'the started one was run');
  assert.equal(s.sent(), CASES);
  // Qualified now, so a new queue refuses it.
  await refused(
    s.queue(['summarization']),
    'INVALID_TRANSITION',
    /already qualified for summarization/,
  );
  // A stale version is refused (the person saw an older connection).
  await refused(
    s.store.startQualificationQueue(owner, s.ws.id, s.conn.id, {
      expected_version: 1,
      model_id: 'm',
      items: [
        {
          manifest: bench('specification'),
          min_held_out_cases: 8,
          floor: { numerator: 1, denominator: 1 },
        },
      ],
    }),
    'VERSION_CONFLICT',
    /changed/,
  );
});

test('PR #176 review M-1: a task stopped or cancelled mid-run can be queued again', async (t) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let hold = false;
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
    beforeResponse: async () => {
      if (hold) await held;
    },
  });
  if (!s) return;
  // Stopped on a refusal: caps changed and not accepted again while the first task runs.
  const first = await s.queue(['summarization', 'specification']);
  hold = true;
  const r = s.runner();
  await r.sweep();
  await until(() => s.sent() > 0);
  let c = await s.current();
  await s.store.updatePlanSettings(owner, s.ws.id, c.id, {
    expected_version: c.version,
    settings: {
      ...c.settings,
      caps: {
        ...c.settings.caps,
        responses: { ...c.settings.caps.responses, max_requests_per_run: 9 },
      },
    },
  });
  hold = false;
  release();
  await r.idle();
  const stopped = await s.detailQueue();
  assert.equal(stopped.state, 'stopped');
  assert.match(stopped.reason ?? '', /queue the rest again/);
  c = await s.current();
  await s.store.acceptPlanCaps(owner, s.ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  // Following that advice queues the started task again and takes it over.
  const again = await s.queue(['summarization', 'specification']);
  assert.equal(
    again.items[0]!.qualification_id,
    stopped.items[0]!.qualification_id,
  );
  await r.sweep();
  await r.idle();
  assert.equal((await s.detailQueue()).state, 'done');
  assert.equal((await s.quals()).length, 2);
  assert.equal(s.sent(), 2 * CASES, 'answered cases were not sent again');
  const old = await s.store.planQualificationQueue(owner, s.ws.id, first.id);
  assert.equal(old.items[0]!.state, 'stopped');

  // Cancelled while its task was started, and the studio stopped before recording it.
  const third = await s.queue(['scoring', 'candidate_generation']);
  const a = randomUUID();
  assert.ok(await s.store.leaseQualificationQueue(a, 60_000));
  const next = await s.store.nextQueuedQualification(third.id, a);
  assert.equal(next.kind, 'run');
  await s.store.cancelQualificationQueue(owner, s.ws.id, third.id);
  const fourth = await s.queue(['scoring']);
  assert.equal(
    fourth.items[0]!.qualification_id,
    next.kind === 'run' ? next.qualification_id : null,
  );
  const handed = await s.store.planQualificationQueue(owner, s.ws.id, third.id);
  assert.equal(handed.items[0]!.state, 'stopped');
  assert.match(handed.items[0]!.reason ?? '', /Taken over by a later queue/);
});

test('PR #176 review L-1: a runner whose lease lapsed mid-run does not take its own queue again', async (t) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let hold = false;
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
    beforeResponse: async () => {
      if (hold) await held;
    },
  });
  if (!s) return;
  const q = await s.queue(['summarization']);
  hold = true;
  const r = s.runner();
  await r.sweep();
  await until(() => s.sent() > 0);
  // The lease lapses (a database outage or a sleep) while the run goes on; the next poll comes.
  await s.db.pool.query(
    `update plan_qualification_queues set lease_until = clock_timestamp() - interval '1 second' where id = $1`,
    [q.id],
  );
  await r.sweep();
  hold = false;
  release();
  await r.idle();
  const done = await s.detailQueue();
  assert.equal(done.state, 'done', done.reason ?? '');
  assert.equal(done.items[0]!.state, 'qualified');
  assert.equal(s.sent(), CASES);
});

test('PR #176 review L-2: the same unexpected error three times stops the queue with its reason', async (t) => {
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
  });
  if (!s) return;
  await s.queue(['summarization']);
  const errors: unknown[] = [];
  const broken = {
    leaseQualificationQueue: s.store.leaseQualificationQueue.bind(s.store),
    renewQualificationQueueLease: s.store.renewQualificationQueueLease.bind(
      s.store,
    ),
    releaseQualificationQueueLease: s.store.releaseQualificationQueueLease.bind(
      s.store,
    ),
    recordQueuedRun: s.store.recordQueuedRun.bind(s.store),
    abandonQualificationQueue: s.store.abandonQualificationQueue.bind(s.store),
    nextQueuedQualification: async () => {
      throw new Error('relation is broken');
    },
  };
  const r = new QualificationQueueRunner({
    store: broken,
    service: s.service,
    onError: (e) => errors.push(e),
  });
  for (let i = 1; i <= 2; i++) {
    await r.sweep();
    await r.idle();
    // A blip is retried: still running after one or two failures.
    assert.equal((await s.detailQueue()).state, 'running');
  }
  await r.sweep();
  await r.idle();
  const q = await s.detailQueue();
  assert.equal(q.state, 'stopped');
  assert.match(
    q.reason ?? '',
    /could not continue this queue \(relation is broken\)/,
  );
  assert.equal(q.items[0]!.state, 'cancelled');
  assert.equal(errors.length, 3);
  assert.equal(s.sent(), 0);
});

test('PR #176 review L-4: a queue cannot start while a Run is going on the connection', async (t) => {
  let release = () => {};
  const held = new Promise<void>((r) => (release = r));
  let hold = false;
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
    beforeResponse: async () => {
      if (hold) await held;
    },
  });
  if (!s) return;
  const q = await s.store.startPlanQualification(owner, s.ws.id, s.conn.id, {
    expected_version: (await s.current()).version,
    model_id: 'm',
    manifest: bench('summarization'),
    min_held_out_cases: 8,
    floor: { numerator: 1, denominator: 1 },
  });
  hold = true;
  const run = s.service.runQualification(owner, s.ws.id, q.id);
  await until(() => s.sent() > 0);
  await refused(
    s.queue(['specification']),
    'INVALID_TRANSITION',
    /running on this connection now/,
  );
  hold = false;
  release();
  await run;
  // Once it finished, the queue starts.
  assert.equal((await s.queue(['specification'])).state, 'running');
});

test('PR #176 re-review L-2b: an error that recurs when recording a result also stops the queue', async (t) => {
  const s = await setup(t, {
    responses: [{ kind: 'text', text: 'ok' }, GOOD],
  });
  if (!s) return;
  await s.queue(['summarization']);
  let runs = 0;
  const errors: unknown[] = [];
  const r = new QualificationQueueRunner({
    store: {
      leaseQualificationQueue: s.store.leaseQualificationQueue.bind(s.store),
      renewQualificationQueueLease: s.store.renewQualificationQueueLease.bind(
        s.store,
      ),
      releaseQualificationQueueLease:
        s.store.releaseQualificationQueueLease.bind(s.store),
      nextQueuedQualification: s.store.nextQueuedQualification.bind(s.store),
      abandonQualificationQueue: s.store.abandonQualificationQueue.bind(
        s.store,
      ),
      recordQueuedRun: async () => {
        throw new Error('cannot record');
      },
    },
    // A run that stops on a provider outcome and leaves the qualification started: each poll
    // would otherwise run it again.
    service: {
      runQualification: async () => {
        runs++;
        return { state: 'stopped' as const, reason: 'quota_exhausted' };
      },
    },
    onError: (e) => errors.push(e),
  });
  for (let i = 1; i <= 2; i++) {
    await r.sweep();
    await r.idle();
    assert.equal((await s.detailQueue()).state, 'running');
  }
  await r.sweep();
  await r.idle();
  const q = await s.detailQueue();
  assert.equal(q.state, 'stopped');
  assert.match(
    q.reason ?? '',
    /could not continue this queue \(cannot record\)/,
  );
  assert.equal(q.items[0]!.state, 'stopped');
  assert.equal(runs, 3, 'run three times, then no more');
  await r.sweep();
  await r.idle();
  assert.equal(runs, 3);
  assert.equal(errors.length, 3);
});

test('PR #176 review 3 L-1 and N-2: research synthesis is queued per lane, locator and web discovery apart', async (t) => {
  const s = await setup(t, { responses: [{ kind: 'text', text: 'ok' }, GOOD] });
  if (!s) return;
  // Fixture copies, since the test connection is a fixture one.
  const WEB = {
    ...read('config/connections/benchmarks/web-discovery-v2.json'),
    fixture: true,
  };
  const OLD_WEB = {
    ...read('config/connections/benchmarks/web-discovery-v1.json'),
    fixture: true,
  };
  const item = (manifest: Record<string, unknown>) => ({
    manifest,
    min_held_out_cases: 3,
    floor: { numerator: 1, denominator: 1 },
  });
  const queueOf = async (...manifests: Record<string, unknown>[]) =>
    s.store.startQualificationQueue(owner, s.ws.id, s.conn.id, {
      expected_version: (await s.current()).version,
      model_id: 'm',
      items: manifests.map(item),
    });
  // Two web discovery benchmarks are one lane, whatever their role version (N-2).
  await refused(
    queueOf(WEB, { ...WEB, name: 'web-discovery-copy' }),
    'INVALID_CONTRACT',
    /once/,
  );
  await refused(queueOf(OLD_WEB, WEB), 'INVALID_CONTRACT', /once/);
  // The locator benchmark and web discovery share a task class but not a lane.
  const both = await queueOf(bench('research_synthesis'), WEB);
  assert.deepEqual(
    both.items.map((i) => i.state),
    ['waiting', 'waiting'],
  );
  await s.store.cancelQualificationQueue(owner, s.ws.id, both.id);
  // A decided research synthesis qualification, then made a web discovery pass by giving it
  // the current web benchmark (the fixture locator benchmark is not a current Discover role,
  // so on its own it qualifies nothing).
  await s.queue(['research_synthesis']);
  const r = s.runner();
  await r.sweep();
  await r.idle();
  const [locator] = await s.quals();
  assert.equal(locator!.state, 'qualified');
  assert.equal(locator!.admits_web_discovery, false);
  // A web discovery pass, and no locator pass, refuses web discovery only.
  await s.db.pool.query(
    `update plan_qualifications set manifest = $2, manifest_hash = $3 where id = $1`,
    [locator!.id, WEB, canonicalHash(WEB)],
  );
  assert.equal((await s.quals())[0]!.admits_web_discovery, true);
  await refused(
    queueOf(WEB),
    'INVALID_TRANSITION',
    /already qualified for research synthesis/,
  );
  assert.equal(
    (await queueOf(bench('research_synthesis'))).items[0]!.state,
    'waiting',
  );
});

test('PR #176 review 4 N-A: a locator pass refuses the locator only, web discovery still accepted', async (t) => {
  const s = await setup(t, { responses: [{ kind: 'text', text: 'ok' }, GOOD] });
  if (!s) return;
  const WEB = {
    ...read('config/connections/benchmarks/web-discovery-v2.json'),
    fixture: true,
  };
  const LOC = read(
    'config/connections/benchmarks/discovery-research14-v2/research_synthesis.json',
  );
  const queueOf = async (m: Record<string, unknown>, held = 3) =>
    s.store.startQualificationQueue(owner, s.ws.id, s.conn.id, {
      expected_version: (await s.current()).version,
      model_id: 'm',
      items: [
        {
          manifest: m,
          min_held_out_cases: held,
          floor: { numerator: 1, denominator: 1 },
        },
      ],
    });
  await s.queue(['research_synthesis']);
  const r = s.runner();
  await r.sweep();
  await r.idle();
  const [q] = await s.quals();
  assert.equal(q!.state, 'qualified');
  // The current Discover locator benchmark, given to the decided row: a recognised locator pass.
  await s.db.pool.query(
    `update plan_qualifications set manifest = $2, manifest_hash = $3 where id = $1`,
    [q!.id, LOC, canonicalHash(LOC)],
  );
  const after = (await s.quals())[0]!;
  assert.equal(after.prompt_current, true);
  assert.equal(after.admits_web_discovery, false);
  await refused(
    queueOf({ ...LOC, name: 'loc-copy' }, 4),
    'INVALID_TRANSITION',
    /already qualified for research synthesis/,
  );
  assert.equal((await queueOf(WEB)).items[0]!.state, 'waiting');
});

test('ADR-0088 with ADR-0089: a queue takes offered discovery benchmarks by name and keeps scoring roles apart', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  // A real connection ready to qualify 'm' (the offered discovery benchmarks are real ones);
  // the verified access row is written directly, as in the P34 tests.
  const ws = await store.createWorkspace(owner, {
    name: 'Queue real',
    record_mode: 'real',
  });
  let c = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  await store.attestPlanCredits(owner, ws.id, c.id, {
    expected_version: c.version,
    statement: CREDITS_OFF_STATEMENT,
    checked_on: '2026-11-11',
  });
  c = (await store.planConnectionDetail(owner, ws.id, c.id)).connection;
  await store.acceptPlanCaps(owner, ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  await db.pool.query(
    `insert into plan_model_access (connection_id, model_id, path, access, request_id)
     values ($1, 'm', 'responses', 'verified', $2)`,
    [c.id, randomUUID()],
  );
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, c.id)).connection;
  const skeptic = offeredDiscoveryBenchmarks().find(
    (b) => b.task_class === 'scoring',
  )!;
  const ASSESS = read(
    'config/connections/benchmarks/assessment-synthetic-v3.json',
  );
  const assess = {
    manifest: ASSESS,
    min_held_out_cases: (ASSESS.cases as { split: string }[]).filter(
      (k) => k.split === 'held_out',
    ).length,
    floor: { numerator: 1, denominator: 1 },
  };
  const queueOf = async (...items: unknown[]) =>
    store.startQualificationQueue(owner, ws.id, c.id, {
      expected_version: (await current()).version,
      model_id: 'm',
      items,
    });
  await refused(
    queueOf({ benchmark: 'not-offered-v1' }),
    'INVALID_CONTRACT',
    /not a benchmark the app offers/,
  );
  // The assessor and the discovery skeptic are both scoring, qualified apart: one queue can
  // hold both, and the named one is loaded from the frozen file.
  const both = await queueOf(assess, { benchmark: skeptic.name });
  assert.deepEqual(
    both.items.map((i) => [i.task_class, i.manifest_name, i.manifest_hash]),
    [
      ['scoring', ASSESS.name, canonicalHash(ASSESS)],
      ['scoring', skeptic.name, skeptic.manifest_hash],
    ],
  );
  await store.cancelQualificationQueue(owner, ws.id, both.id);
  // A discovery-skeptic pass refuses the skeptic only; the assessor is still taken.
  const q = await store.startPlanQualification(owner, ws.id, c.id, {
    expected_version: (await current()).version,
    model_id: 'm',
    benchmark: skeptic.name,
  });
  await db.pool.query(
    `update plan_qualifications set state = 'qualified', decided_at = now() where id = $1`,
    [q.id],
  );
  const after = (await store.planConnectionDetail(owner, ws.id, c.id))
    .qualifications[0]!;
  assert.equal(after.admits_discovery, true);
  await refused(
    queueOf({ benchmark: skeptic.name }),
    'INVALID_TRANSITION',
    /already qualified for scoring \(discovery\)/,
  );
  assert.equal((await queueOf(assess)).items[0]!.state, 'waiting');
});
