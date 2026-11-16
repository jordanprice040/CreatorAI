import test from 'node:test';
import assert from 'node:assert/strict';
import {
  AUTO_RESUME_MAX_CHECKS,
  AUTOPILOT_SETTINGS_DEFAULT,
  AUTOPILOT_USAGE_NOTE,
  AutopilotConfigSchema,
  ContractError,
  WebDiscoveryScopeSchema,
  autoResumeView,
  autoResumeWaitMs,
  autopilotStepConnection,
  autopilotRequestFloor,
  autopilotSummary,
  routinePolicySummary,
  type Autopilot,
  type AutopilotConfig,
  type AutopilotStep,
  type ErrorCode,
  type RoutinePolicyInput,
  type WebDiscovery,
} from '@creator/contracts';
import { FixtureAdapter } from '@creator/broker';
import { AUTOPILOT_ACTOR_ID, ConnectionStore } from '@creator/db';
import { AutopilotRunner, type AutopilotWeb } from '@creator/api';
import { discoverySetup, owner } from './discovery-harness.js';

// ADR-0124 (F2): the usage check before an autopilot starts counts what the start check counts
// beside what admission reads, and an opted-in autopilot continues by itself after a usage
// limit only when it is due, the connection is checked again, and everything Continue checks
// still holds.

const H = 3_600_000;
const inHours = (h: number) => new Date(Date.now() + h * H).toISOString();
const CONN = '00000000-0000-4000-8000-0000000000c1';
const OTHER = '00000000-0000-4000-8000-0000000000c2';
const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === code &&
      (!message || message.test(e.message)),
  );

const plan = (id = CONN) => ({
  kind: 'subscription' as const,
  connection_id: id,
  model_id: 'gpt-test',
  settings_hash: 'a'.repeat(64),
  max_output_chars: 16000,
});
const research = (id = CONN) => ({
  connection_id: id,
  model_id: 'gpt-test',
  scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
  input_hash: 'c'.repeat(64),
});
const draft = (over: Record<string, unknown> = {}): AutopilotConfig =>
  AutopilotConfigSchema.parse({
    resource_setup: plan(),
    data_class: 'public',
    limits: { max_calls: 40, ends_at: inHours(6) },
    ...over,
  });

// ---- Pure rules ----------------------------------------------------------------------------

test('ADR-0124: the request count is the start check’s per-step floor, per connection', () => {
  // explore 2 + discovery (5 types + 2) + assessment 2 = 11; research on the same connection +2.
  assert.equal(autopilotRequestFloor(draft(), CONN), 11);
  assert.equal(
    autopilotRequestFloor(draft({ research: research() }), CONN),
    13,
  );
  // Research on another plan connection counts there only.
  const split = draft({ research: research(OTHER) });
  assert.equal(autopilotRequestFloor(split, CONN), 11);
  assert.equal(autopilotRequestFloor(split, OTHER), 2);
  // Part-way starts: assessment needs its floor; selection makes no model call.
  const problem = { id: '00000000-0000-4000-8000-0000000000aa', version: 1 };
  assert.equal(
    autopilotRequestFloor(draft({ start: { stage: 'assess', problem } }), CONN),
    2,
  );
  assert.equal(
    autopilotRequestFloor(draft({ start: { stage: 'select', problem } }), CONN),
    0,
  );
  assert.equal(autopilotRequestFloor(draft(), OTHER), 0);
});

test('ADR-0124: the opt-in is off unless ticked, plan routes only, and named in the confirmed summary', () => {
  const off = draft();
  assert.equal(off.resume_after_limit, undefined);
  assert.ok(!autopilotSummary(off).some((l) => /continues by itself/.test(l)));
  const on = draft({ resume_after_limit: true });
  const line = autopilotSummary(on).find((l) => /continues by itself/.test(l));
  assert.match(
    line ?? '',
    new RegExp(
      `at most ${AUTO_RESUME_MAX_CHECKS} times\\), only inside this run's routine approvals, its call limit and its end time`,
    ),
  );
  const api = AutopilotConfigSchema.safeParse({
    ...on,
    resource_setup: {
      kind: 'api',
      envelope_id: CONN,
      pricing_snapshot_id: OTHER,
    },
  });
  assert.ok(!api.success);
  assert.match(api.error.issues[0]!.message, /for a plan connection/);
});

test('ADR-0124: waits are 1, 2, then 4 hours; the view says when it checks, and never past its end time', () => {
  assert.deepEqual(
    [0, 1, 2, 3, 7].map((n) => autoResumeWaitMs(n) / H),
    [1, 2, 4, 4, 4],
  );
  const now = Date.parse('2026-11-16T10:00:00Z');
  const stopped = (
    kind: AutopilotStep['stop_kind'],
    finished = '2026-11-16T09:30:00Z',
  ): AutopilotStep => ({
    stage: 'explore',
    attempt: 1,
    state: 'stopped',
    child: null,
    calls: 0,
    problem: null,
    option: null,
    request: null,
    key: null,
    note: '',
    stop_kind: kind,
    started_at: finished,
    finished_at: finished,
  });
  const a = (
    over: Partial<Pick<Autopilot, 'state' | 'outcome' | 'steps'>> = {},
    ends = '2026-11-16T20:00:00Z',
  ) => ({
    config: draft({
      resume_after_limit: true,
      limits: { max_calls: 40, ends_at: ends },
    }),
    state: 'finished' as const,
    outcome: 'limit_reached' as const,
    steps: [stopped('usage_limit')],
    approvals_ended_at: null,
    ...over,
  });
  const fresh = { checks: 0, turned_off_at: null };
  assert.equal(
    autoResumeView({ ...a(), config: draft() }, fresh, now),
    undefined,
    'not opted in',
  );
  assert.deepEqual(autoResumeView(a(), fresh, now), {
    state: 'waiting',
    checks: 0,
    max: AUTO_RESUME_MAX_CHECKS,
    next_check_at: '2026-11-16T10:30:00.000Z',
    turned_off_at: null,
  });
  // The second check waits 2 hours from the latest stop.
  assert.equal(
    autoResumeView(a(), { checks: 1, turned_off_at: null }, now)?.next_check_at,
    '2026-11-16T11:30:00.000Z',
  );
  // Review 1 L-2: the daily cap waits on the same schedule (and then also needs room).
  const daily = autoResumeView(
    a({ steps: [stopped('daily_cap')] }),
    fresh,
    now,
  );
  assert.equal(daily?.state, 'waiting');
  assert.equal(daily?.next_check_at, '2026-11-16T10:30:00.000Z');
  // Other stops, a cancel, a running one, a passed or too-close end time: not waiting.
  for (const v of [
    a({ steps: [stopped('run_cap')] }),
    a({ steps: [stopped('connection')] }),
    a({ outcome: 'cancelled' }),
    a({ state: 'running', outcome: null }),
  ])
    assert.equal(autoResumeView(v, fresh, now)?.state, 'on');
  assert.equal(
    autoResumeView(a({}, '2026-11-16T09:59:00Z'), fresh, now)?.state,
    'on',
    'end time passed',
  );
  assert.equal(
    autoResumeView(a({}, '2026-11-16T10:20:00Z'), fresh, now)?.state,
    'on',
    'next check after the end time',
  );
  assert.equal(
    autoResumeView(
      a(),
      { checks: 0, turned_off_at: '2026-11-16T09:40:00Z' },
      now,
    )?.state,
    'turned_off',
  );
  assert.equal(
    autoResumeView(
      a(),
      { checks: AUTO_RESUME_MAX_CHECKS, turned_off_at: null },
      now,
    )?.state,
    'used_up',
  );
});

// ---- With the database ---------------------------------------------------------------------

/** A plan connection as admission reads it; `quota` and the counts are the test's to change. */
function fakeConnection(state: { quota: string; version: number }) {
  return {
    id: CONN,
    kind: 'chatgpt',
    label: 'ChatGPT plan',
    version: state.version,
    caps_accepted_at: '2026-11-01T00:00:00.000Z',
    sign_in: { state: 'signed_in', plan_usage_granted: true },
    credits: { state: 'confirmed_off' },
    eligibility: { state: 'eligible' },
    quota: { state: state.quota },
    settings: {
      caps: {
        responses: { max_requests_per_run: 30 },
        shared: { max_model_requests_per_day: 50 },
      },
    },
  };
}

type FakeState = {
  quota: string;
  version: number;
  dayUsed: number;
  runUsed: number;
};

/** Two fake plan connections: CONN (the fields on the store) and OTHER (`other`). */
class FakePlan extends ConnectionStore {
  quota = 'exhausted';
  version = 3;
  dayUsed = 45;
  runUsed = 0;
  other: FakeState = { quota: 'unknown', version: 7, dayUsed: 0, runUsed: 0 };
  resets: string[] = [];
  #state(id: string): FakeState | null {
    const k = id.toLowerCase();
    return k === CONN ? this : k === OTHER ? this.other : null;
  }
  override async planRunRoomIn(
    ...args: Parameters<ConnectionStore['planRunRoomIn']>
  ) {
    const st = this.#state(args[3])!;
    return {
      per_run: 30,
      used: st.runUsed,
      daily_left: Math.max(0, 50 - st.dayUsed),
      daily_cap: 50,
    };
  }
  override async planConnectionDetail(
    ...args: Parameters<ConnectionStore['planConnectionDetail']>
  ) {
    const st = this.#state(args[2]);
    if (!st) return super.planConnectionDetail(...args);
    return {
      connection: { ...fakeConnection(st), id: args[2].toLowerCase() },
      usage: { last_24h_requests: st.dayUsed, extra_requests: 0 },
    } as unknown as Awaited<
      ReturnType<ConnectionStore['planConnectionDetail']>
    >;
  }
  override async resetPlanQuotaObservation(
    ...args: Parameters<ConnectionStore['resetPlanQuotaObservation']>
  ) {
    const st = this.#state(args[2])!;
    if (args[3] !== st.version)
      throw new ContractError('VERSION_CONFLICT', 'Stale (test).');
    this.resets.push(
      `${args[0].autopilot ? 'autopilot' : 'person'}:${st === this ? '' : 'other:'}${args[3]}`,
    );
    st.quota = 'unknown';
    st.version += 1;
    return null as unknown as Awaited<
      ReturnType<ConnectionStore['resetPlanQuotaObservation']>
    >;
  }
}

async function setup(t: test.TestContext) {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return null;
  const store = new FakePlan(s.db.pool);
  let searches = 0;
  // The web search fails while the plan's usage limit holds, as the live runs saw.
  const web: AutopilotWeb = {
    accept: async () => null,
    start: async () => {
      searches += 1;
      return { id: '00000000-0000-4000-8000-0000000000d4' };
    },
    read: async () =>
      ({
        id: '00000000-0000-4000-8000-0000000000d4',
        version: 1,
        state: 'failed',
        explanation: 'The search failed (test).',
        proposals: [],
      }) as unknown as WebDiscovery,
    isActive: () => true,
    resume: async () => null,
    cancel: async () => null,
  };
  const runner = new AutopilotRunner(store, web, {
    pollMs: 5,
    onWait: () => s.worker.settle(),
  });
  await store.saveAutopilotSettings(owner, s.ws.id, {
    expected_version: 0,
    values: AUTOPILOT_SETTINGS_DEFAULT,
  });
  const policy: RoutinePolicyInput = {
    stages: ['evidence', 'model_work', 'research', 'selection'],
    data_classes: ['public', 'synthetic'],
    max_actions: 60,
    max_total_nano_usd: '100000000000',
    stop_on: ['person_rejects'],
    expires_at: inHours(8),
    rationale: 'Test autopilot policy.',
  };
  const run = async () => {
    const id = await s.run();
    await store.setRoutinePolicy(owner, s.ws.id, id, {
      ...policy,
      summary_seen: routinePolicySummary(policy),
    });
    return id;
  };
  const config = (over: Record<string, unknown> = {}) =>
    draft({
      research: research(),
      data_class: 'public',
      resume_after_limit: true,
      ...over,
    });
  /** Starts an autopilot that stops on the plan's usage limit at its search. */
  const stoppedOnLimit = async (over: Record<string, unknown> = {}) => {
    const runId = await run();
    const c = config(over);
    const a = await runner.start(owner, s.ws.id, runId, {
      config: c,
      summary_seen: autopilotSummary(c),
    });
    await runner.settled(a.id);
    const done = await store.getAutopilot(owner, s.ws.id, a.id);
    assert.equal(done.steps.at(-1)?.stop_kind, 'usage_limit', done.explanation);
    return done;
  };
  /** Moves the last stop back in time, so the next check is due. */
  const stoppedHoursAgo = async (a: Autopilot, hours: number) => {
    const at = new Date(Date.now() - hours * H).toISOString();
    await s.db.pool.query(
      `update autopilots set steps = jsonb_set(steps, $3::text[], to_jsonb($4::text))
        where workspace_id = $1 and id = $2`,
      [s.ws.id, a.id, `{${a.steps.length - 1},finished_at}`, at],
    );
  };
  const audit = async (id: string, action: string) =>
    (
      await s.db.pool.query(
        `select actor_id, payload from audit_events
          where subject_id = $1 and action = $2 order by sequence`,
        [id, action],
      )
    ).rows as { actor_id: string; payload: Record<string, unknown> }[];
  return {
    ...s,
    store,
    runner,
    run,
    config,
    stoppedOnLimit,
    stoppedHoursAgo,
    audit,
    searches: () => searches,
  };
}

test('ADR-0124: the usage check shows needed beside left from the same counts as the start check and admission', async (t) => {
  const h = await setup(t);
  if (!h) return;
  // A new run: none used on it; 45 of 50 used today; the plan usage limit not yet seen.
  h.store.quota = 'unknown';
  const fresh = await h.runner.usageCheck(owner, h.ws.id, {
    config: h.config(),
  });
  assert.equal(fresh.note, AUTOPILOT_USAGE_NOTE);
  assert.match(fresh.note, /plan account's own usage limit is not visible/);
  const c = fresh.connections[0]!;
  assert.deepEqual(
    {
      need: c.need,
      up_to: c.up_to,
      per_run_left: c.per_run_left,
      daily_left: c.daily_left,
      daily_cap: c.daily_cap,
      fit: c.fit,
    },
    {
      need: 13,
      up_to: 30,
      per_run_left: 30,
      daily_left: 5,
      daily_cap: 50,
      fit: 'daily',
    },
  );
  assert.match(c.line, /needs at least 13 requests/);
  assert.match(c.line, /5 of its 50 daily requests left today/);
  assert.match(c.line, /continue by itself once the cap has room again/);
  // An existing run that has used 20: the per-run cap cannot hold it, and the start says the
  // same number.
  h.store.dayUsed = 0;
  h.store.runUsed = 20;
  const runId = await h.run();
  const onRun = await h.runner.usageCheck(owner, h.ws.id, {
    config: h.config(),
    run_id: runId,
  });
  assert.equal(onRun.connections[0]!.fit, 'per_run');
  assert.equal(onRun.connections[0]!.per_run_left, 10);
  await rejects(
    'LIMIT_EXCEEDED',
    h.runner.start(owner, h.ws.id, runId, {
      config: h.config(),
      summary_seen: autopilotSummary(h.config()),
    }),
    /has 10 of the plan connection's 30 requests per run left, and a whole process needs at least 13/,
  );
  // The plan's usage limit seen: blocked, with admission's own words.
  h.store.runUsed = 0;
  h.store.quota = 'exhausted';
  const blocked = await h.runner.usageCheck(owner, h.ws.id, {
    config: h.config(),
  });
  assert.equal(blocked.connections[0]!.fit, 'blocked');
  assert.equal(blocked.connections[0]!.quota, 'exhausted');
  assert.ok(blocked.connections[0]!.blockers.length > 0);
});

test('ADR-0124: after a usage-limit stop it waits, rechecks the connection, then continues as the autopilot, audited', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const a = await h.stoppedOnLimit();
  assert.equal(h.searches(), 1);
  assert.equal(a.auto_resume?.state, 'waiting');
  assert.equal(a.auto_resume?.checks, 0);
  assert.ok(a.auto_resume?.next_check_at);
  // Not due yet: nothing happens, and the connection is left alone.
  await h.runner.resumeDue();
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, a.id)).version,
    a.version,
  );
  assert.deepEqual(h.store.resets, []);
  // The store refuses an early continue on its own too.
  await rejects(
    'INVALID_TRANSITION',
    h.store.autoResumeAutopilot(
      { actorId: owner.actorId, autopilot: { id: a.id } },
      h.ws.id,
      a.id,
      a.version,
    ),
    /checks the limit again/,
  );
  // Only the autopilot itself, for its starter, may continue it this way.
  await h.stoppedHoursAgo(a, 2);
  await rejects(
    'ACCESS_DENIED',
    h.store.autoResumeAutopilot(owner, h.ws.id, a.id, a.version),
  );
  // Due: the connection is read again; the stale "used up" mark is cleared only after the
  // continue is recorded, and the step's own request is the check.
  await h.runner.resumeDue();
  const resumed = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.ok(resumed.version > a.version);
  assert.deepEqual(h.store.resets, ['autopilot:3']);
  await h.runner.settled(a.id);
  assert.equal(h.searches(), 2, 'the stopped step was tried again');
  const after = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(after.auto_resume?.checks, 1);
  const continued = await h.audit(a.id, 'autopilot.continued');
  assert.equal(continued.length, 1);
  assert.equal(continued[0]!.actor_id, AUTOPILOT_ACTOR_ID);
  assert.equal(continued[0]!.payload.auto_resume, 1);
  assert.match(
    String(continued[0]!.payload.reason),
    /checked first \(1 of 8\)/,
  );
});

test('ADR-0124: it never continues when turned off, past its end time, on a cancelled run, or when the connection needs fixing', async (t) => {
  const h = await setup(t);
  if (!h) return;
  // Turned off by the owner (an autopilot cannot), audited, repeatable.
  const off = await h.stoppedOnLimit();
  await rejects(
    'HUMAN_ONLY_DENIED',
    h.store.turnOffAutoResume(
      { actorId: owner.actorId, autopilot: { id: off.id } },
      h.ws.id,
      off.id,
      {},
    ),
  );
  const turned = await h.runner.turnOffAutoResume(owner, h.ws.id, off.id, {
    expected_version: off.version,
  });
  assert.equal(turned.auto_resume?.state, 'turned_off');
  const again = await h.runner.turnOffAutoResume(owner, h.ws.id, off.id, {});
  assert.equal(again.version, turned.version);
  assert.equal((await h.audit(off.id, 'autopilot.auto_resume_off')).length, 1);
  await h.stoppedHoursAgo(turned, 2);
  await h.runner.resumeDue();
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, off.id)).state,
    'finished',
  );

  // Past its end time.
  const late = await h.stoppedOnLimit();
  await h.stoppedHoursAgo(late, 2);
  await h.db.pool.query(
    `update autopilots set config = jsonb_set(config, '{limits,ends_at}', to_jsonb($2::text))
      where id = $1`,
    [late.id, new Date(Date.now() - 60_000).toISOString()],
  );
  const lateNow = await h.store.getAutopilot(owner, h.ws.id, late.id);
  assert.equal(lateNow.auto_resume?.state, 'on');
  await h.runner.resumeDue();
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, late.id)).version,
    lateNow.version,
  );

  // Its run was cancelled: Continue's own check refuses, and the connection is left alone.
  const gone = await h.stoppedOnLimit();
  await h.stoppedHoursAgo(gone, 2);
  await h.store.cancelRun(owner, h.ws.id, gone.run_id, {
    reason: 'Cancelled for the test.',
  });
  await h.runner.resumeDue();
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, gone.id)).state,
    'finished',
  );
  assert.deepEqual(h.store.resets, []);

  // The connection needs signing in again: no continue, nothing cleared.
  const signin = await h.stoppedOnLimit();
  await h.stoppedHoursAgo(signin, 2);
  const real = h.store.planConnectionDetail.bind(h.store);
  h.store.planConnectionDetail = (async (
    ...args: Parameters<ConnectionStore['planConnectionDetail']>
  ) => {
    const d = (await real(...args)) as unknown as {
      connection: { sign_in: { state: string } };
    };
    d.connection.sign_in = { state: 'reauthorization_required' };
    return d;
  }) as typeof h.store.planConnectionDetail;
  await h.runner.resumeDue();
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, signin.id)).state,
    'finished',
  );
  assert.deepEqual(h.store.resets, []);
});

test('ADR-0124: a daily-cap stop continues once the cap has room for the stopped step, sending nothing to check', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const a = await h.stoppedOnLimit();
  // Recorded as a daily-cap stop (the connection's own cap, which the studio can read).
  await h.db.pool.query(
    `update autopilots set steps = jsonb_set(steps, $2::text[], '"daily_cap"')
      where id = $1`,
    [a.id, `{${a.steps.length - 1},stop_kind}`],
  );
  h.store.quota = 'unknown';
  h.store.dayUsed = 40;
  // Review 1 L-2: not before its wait, even with room.
  await h.runner.resumeDue();
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, a.id)).state,
    'finished',
  );
  await h.stoppedHoursAgo(a, 2);
  h.store.dayUsed = 49; // 1 left; the search needs 2.
  await h.runner.resumeDue();
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, a.id)).state,
    'finished',
  );
  h.store.dayUsed = 40;
  await h.runner.resumeDue();
  await h.runner.settled(a.id);
  assert.equal(h.searches(), 2);
  assert.deepEqual(h.store.resets, [], 'nothing to clear for the daily cap');
  const continued = await h.audit(a.id, 'autopilot.continued');
  assert.match(String(continued[0]!.payload.reason), /daily request cap/);
});

test('review 1 M-1: a stopped gather search is rechecked on the research connection it used', async (t) => {
  const h = await setup(t);
  if (!h) return;
  assert.equal(
    autopilotStepConnection(
      { research: research(OTHER), resource_setup: plan() },
      'gather',
    ),
    OTHER,
  );
  assert.equal(
    autopilotStepConnection(
      { research: null, resource_setup: plan() },
      'gather',
    ),
    CONN,
  );
  assert.equal(
    autopilotStepConnection(
      { research: research(OTHER), resource_setup: plan() },
      'assess',
    ),
    CONN,
  );
  const a = await h.stoppedOnLimit();
  // Recorded as a gather round's search on a separate research connection.
  await h.db.pool.query(
    `update autopilots set
       config = jsonb_set(config, '{research,connection_id}', to_jsonb($2::text)),
       steps = jsonb_set(steps, $3::text[], '"gather"')
     where id = $1`,
    [a.id, OTHER, `{${a.steps.length - 1},stage}`],
  );
  await h.stoppedHoursAgo(a, 2);
  // The main connection is clear, but the research one is still marked used up and full today.
  h.store.quota = 'unknown';
  h.store.dayUsed = 0;
  h.store.other = { quota: 'exhausted', version: 7, dayUsed: 50, runUsed: 0 };
  await h.runner.resumeDue();
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, a.id)).state,
    'finished',
  );
  assert.deepEqual(h.store.resets, []);
  // Room on the research connection: it continues, and that connection's mark is cleared.
  h.store.other.dayUsed = 10;
  await h.runner.resumeDue();
  await h.runner.settled(a.id);
  assert.deepEqual(h.store.resets, ['autopilot:other:7']);
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, a.id)).auto_resume?.checks,
    1,
  );
});

test('review 1 L-3: a usage-limit stop with no per-run room left is not continued and nothing is cleared', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const a = await h.stoppedOnLimit();
  await h.stoppedHoursAgo(a, 2);
  h.store.runUsed = 29; // 1 left; the search needs 2.
  await h.runner.resumeDue();
  const still = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(still.state, 'finished');
  assert.equal(still.auto_resume?.checks, 0);
  assert.deepEqual(h.store.resets, []);
});

test('review 1 N-5: two checks racing continue once; the eighth continue is the last', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const a = await h.stoppedOnLimit();
  await h.stoppedHoursAgo(a, 2);
  const second = new AutopilotRunner(h.store, null, { pollMs: 5 });
  await Promise.all([h.runner.resumeDue(), second.resumeDue()]);
  await Promise.all([h.runner.settled(a.id), second.settled(a.id)]);
  assert.equal((await h.audit(a.id, 'autopilot.continued')).length, 1);
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, a.id)).auto_resume?.checks,
    1,
  );
  // Used up: shown as such, left off the waiting list, and the database refuses a ninth.
  h.store.quota = 'exhausted';
  const b = await h.stoppedOnLimit();
  await h.db.pool.query(
    'update autopilots set resume_checks = $2 where id = $1',
    [b.id, AUTO_RESUME_MAX_CHECKS],
  );
  const used = await h.store.getAutopilot(owner, h.ws.id, b.id);
  assert.equal(used.auto_resume?.state, 'used_up');
  assert.ok(
    !(await h.store.autopilotsAwaitingResume()).some((x) => x.id === b.id),
  );
  await assert.rejects(
    h.db.pool.query('update autopilots set resume_checks = $2 where id = $1', [
      b.id,
      AUTO_RESUME_MAX_CHECKS + 1,
    ]),
    /autopilots_resume_checks_check/,
  );
});

test('review 1 L-1/L-4/N-2: the waiting list skips stops that cannot continue; per-run wording follows the start check', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const a = await h.stoppedOnLimit();
  assert.ok(
    (await h.store.autopilotsAwaitingResume()).some((x) => x.id === a.id),
  );
  // A stop on the per-run cap never continues by itself, so it is not listed.
  await h.db.pool.query(
    `update autopilots set steps = jsonb_set(steps, $2::text[], '"run_cap"') where id = $1`,
    [a.id, `{${a.steps.length - 1},stop_kind}`],
  );
  assert.ok(
    !(await h.store.autopilotsAwaitingResume()).some((x) => x.id === a.id),
  );
  // Research on its own connection with too little per-run room: a warning, not a refusal.
  h.store.quota = 'unknown';
  h.store.dayUsed = 0;
  h.store.other = { quota: 'unknown', version: 7, dayUsed: 0, runUsed: 29 };
  const runId = await h.run();
  const check = await h.runner.usageCheck(owner, h.ws.id, {
    config: h.config({ research: research(OTHER) }),
    run_id: runId,
  });
  const other = check.connections.find((c) => c.connection_id === OTHER)!;
  assert.equal(other.fit, 'per_run');
  assert.equal(other.up_to, 1);
  assert.match(other.line, /It will stop when the per-run cap is reached/);
  assert.doesNotMatch(other.line, /start is refused/);
  assert.match(other.line, /for the web search, more if it gathers evidence/);
  // A start at selection makes no model request: no connection line.
  const problem = { id: '00000000-0000-4000-8000-0000000000aa', version: 1 };
  const select = await h.runner.usageCheck(owner, h.ws.id, {
    config: h.config({ research: null, start: { stage: 'select', problem } }),
  });
  assert.equal(select.connections.length, 0);
});
