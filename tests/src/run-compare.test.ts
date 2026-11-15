import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  RUN_COMPARISON_LABEL,
  RunComparisonSchema,
  autopilotSummary,
  comparisonCautions,
  routinePolicySummary,
  type AutopilotConfig,
  type ErrorCode,
  type RoutinePolicyInput,
  type RunComparison,
  type RunComparisonSide,
  type ScorecardBody,
} from '@creator/contracts';
import { DISCOVERY_SCENARIOS } from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { ConnectionStore } from '@creator/db';
import {
  AutopilotRunner,
  DEFAULT_OWNER_ACTOR_ID,
  compareRuns,
  createApi,
} from '@creator/api';
import { discoverySetup, owner } from './discovery-harness.js';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { loadWeb } from './web-module.js';

// ADR-0120 (F7): two autopilots side by side, read from their records with the caller's own
// access, labelled as a comparison of two runs and never a study result.

const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();
const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === code &&
      (!message || message.test(e.message)),
  );

type Rules = {
  compareRows(c: RunComparison): {
    group: string;
    label: string;
    a: string;
    b: string;
    differs: boolean;
  }[];
  duration(seconds: number): string;
  pairFrom(id: string): [string, string] | null;
  defaultPair(
    autopilots: readonly { id: string; state: string; created_at: string }[],
    fromAddress: string,
  ): [string, string] | null;
};

function side(over: Partial<RunComparisonSide> = {}): RunComparisonSide {
  return {
    autopilot: {
      id: randomUUID(),
      run_id: randomUUID(),
      fixture: true,
      state: 'finished',
      stage: 'select',
      outcome: 'needs_person',
      explanation: 'Stopped at a tie.',
      config_hash: 'a'.repeat(64),
      policy_version: 'autopilot/1.0',
      route: 'api',
      models: ['fixture-model'],
      started_at_stage: 'start',
    },
    problem: {
      id: '00000000-0000-4000-8000-000000000001',
      version: 1,
      title: 'P',
    },
    evidence: {
      searched_web: false,
      leads: 0,
      pages_read: 0,
      claims_proposed: 0,
      claims_admitted: 0,
      problem_supports: 3,
      problem_contradicts: 0,
    },
    options: { scores_from: 'selection', count: 0, ranked: [] },
    stops: [],
    choice: null,
    proposal: null,
    builds: [],
    requests: { used: 10, limit: 60, model_attempts: 10, plan_requests: 0 },
    money: { reserved: '0', incurred: '1500000000', unknown: '0' },
    time: {
      started_at: '2026-11-15T10:00:00.000Z',
      finished_at: '2026-11-15T10:05:00.000Z',
      elapsed_seconds: 300,
      working_seconds: 250,
    },
    ...over,
  };
}

test('cautions name what makes the two columns unlike, from the records only', () => {
  const a = side();
  assert.deepEqual(comparisonCautions(a, side()), []);
  const b = side({
    problem: null,
    autopilot: { ...a.autopilot, route: 'subscription', state: 'running' },
    requests: { ...a.requests, limit: 30 },
    options: { scores_from: 'current', count: 2, ranked: [] },
  });
  const out = comparisonCautions(a, b);
  assert.equal(out.length, 5);
  assert.match(out[0]!, /different problems/);
  assert.match(out.join(' '), /different model routes/);
  assert.match(out.join(' '), /still running/);
  assert.match(out.join(' '), /different request limits \(60 and 30\)/);
  assert.match(out.join(' '), /scores shown are the problem’s scores now/);
});

test('the table rows mark what differs; the pair comes from the address or the two latest finished', async () => {
  const r = (await loadWeb('run-compare-rules.ts')) as Rules;
  const a = side();
  const b = side({
    stops: [
      {
        stage: 'select',
        attempt: 1,
        kind: 'tie',
        note: 'A tie.',
        decision_id: null,
        at: '2026-11-15T10:04:00.000Z',
      },
    ],
    money: { reserved: '0', incurred: '1500000000', unknown: '0' },
  });
  const c = RunComparisonSchema.parse({
    label: RUN_COMPARISON_LABEL,
    workspace_id: randomUUID(),
    same_problem: true,
    cautions: [],
    a,
    b,
    read_at: new Date().toISOString(),
  });
  const rows = r.compareRows(c);
  const stops = rows.find((x) => x.label === 'Where it stopped')!;
  assert.equal(stops.a, 'Never stopped');
  assert.match(
    stops.b,
    /^1 stop \(at select\), 1 asked a person or a setting$/,
  );
  assert.equal(stops.differs, true);
  const money = rows.find((x) => x.label === 'Money')!;
  // Fixture amounts are simulated units, never dollars.
  assert.equal(money.a, '1.50 sim spent');
  assert.equal(money.differs, false);
  assert.equal(
    rows.find((x) => x.label === 'Time')!.a,
    '5 min 00 s in all, 4 min 10 s working',
  );
  assert.equal(r.duration(7_500), '2 h 05 min');
  assert.equal(r.duration(35), '35 s');

  assert.deepEqual(r.pairFrom('x,y'), ['x', 'y']);
  assert.equal(r.pairFrom('x,x'), null);
  assert.equal(r.pairFrom('x'), null);
  assert.equal(r.pairFrom('x,y,z'), null);
  const list = [
    { id: 'old', state: 'finished', created_at: '2026-11-15T08:00:00.000Z' },
    { id: 'run', state: 'running', created_at: '2026-11-15T11:00:00.000Z' },
    { id: 'new', state: 'finished', created_at: '2026-11-15T10:00:00.000Z' },
    { id: 'mid', state: 'finished', created_at: '2026-11-15T09:00:00.000Z' },
  ];
  assert.deepEqual(r.defaultPair(list, ''), ['mid', 'new']);
  assert.deepEqual(r.defaultPair(list, 'old,run'), ['old', 'run']);
  assert.equal(r.defaultPair(list.slice(0, 2), ''), null);
});

async function setup(t: test.TestContext) {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return null;
  const store = new ConnectionStore(s.db.pool);
  const envelope = (await s.store.listEnvelopes(owner, s.ws.id))[0]!;
  const pricing = (await s.store.listPricing(owner, s.ws.id))[0]!;
  const runner = new AutopilotRunner(store, null, {
    pollMs: 5,
    onWait: () => s.worker.settle(),
  });
  const policy: RoutinePolicyInput = {
    stages: ['model_work', 'selection'],
    data_classes: ['synthetic'],
    max_actions: 50,
    max_total_nano_usd: '100000000000',
    stop_on: ['person_rejects'],
    expires_at: inHours(4),
    rationale: 'Test autopilot policy.',
  };
  async function run() {
    const id = await s!.run();
    await store.setRoutinePolicy(owner, s!.ws.id, id, {
      ...policy,
      summary_seen: routinePolicySummary(policy),
    });
    return id;
  }
  const config = (maxCalls: number): AutopilotConfig => ({
    resource_setup: {
      kind: 'api',
      envelope_id: envelope.id,
      pricing_snapshot_id: pricing.id,
    },
    data_class: 'synthetic',
    research: null,
    explore: {
      interests: [],
      target_groups: [],
      exclusions: [],
      only_hosts: [],
      excluded_hosts: [],
      max_candidates: 3,
      max_claims: 30,
      max_age_days: 3650,
      leave_out: [],
    },
    evidence_roles: [
      'problem',
      'affected_users',
      'workaround',
      'existing_tool',
    ],
    perspectives: [
      'software',
      'existing_tool',
      'process_change',
      'human_led',
      'hybrid',
    ],
    excluded: [],
    max_revisions: 1,
    limits: { max_calls: maxCalls, ends_at: inHours(2) },
    start: null,
  });
  const start = async (runId: string, c: AutopilotConfig) => {
    const a = await runner.start(owner, s!.ws.id, runId, {
      config: c,
      summary_seen: autopilotSummary(c),
      routine_policy: null,
    });
    await runner.settled(a.id);
    return store.getAutopilot(owner, s!.ws.id, a.id);
  };
  await s.seed(
    DISCOVERY_SCENARIOS.find((x) => x.key === 'existing_tool')!,
    await s.run(),
  );
  t.after(() => runner.close());
  return { ...s, store, runner, run, config, start };
}

test('two autopilots compare side by side from their own records, read with the caller’s access', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const first = await h.start(await h.run(), h.config(80));
  const second = await h.start(await h.run(), h.config(60));
  assert.equal(first.outcome, 'needs_person', first.explanation);

  const c = await compareRuns(h.store, owner, h.ws.id, {
    a: first.id,
    b: second.id,
  });
  RunComparisonSchema.parse(c);
  assert.equal(c.label, RUN_COMPARISON_LABEL);
  assert.equal(c.a.autopilot.id, first.id);
  assert.equal(c.b.autopilot.id, second.id);
  // Its own counts, not recomputed: what the autopilot kept for its steps and its limit.
  assert.equal(c.a.requests.used, first.calls_reserved);
  assert.equal(c.a.requests.limit, 80);
  assert.equal(c.b.requests.limit, 60);
  assert.match(c.cautions.join(' '), /different request limits \(80 and 60\)/);
  // Money is what its workflows recorded, summed exactly.
  let incurred = 0n;
  let attempts = 0;
  for (const s of first.steps)
    if (s.child?.kind === 'workflow') {
      const d = await h.store.getWorkflow(owner, h.ws.id, s.child.id);
      incurred += BigInt(d.usage.incurred);
      attempts += d.usage.attempts;
    }
  assert.equal(c.a.money.incurred, incurred.toString());
  assert.equal(c.a.requests.model_attempts, attempts);
  // It stopped at the choice for a person; nothing was chosen, so the scores are today's.
  assert.deepEqual(
    c.a.stops.map((s) => s.stage),
    first.steps.filter((s) => s.state === 'stopped').map((s) => s.stage),
  );
  assert.ok(c.a.stops.some((s) => s.stage === 'select'));
  assert.equal(c.a.choice, null);
  assert.equal(c.a.options.scores_from, 'current');
  assert.ok(c.a.options.count > 0);
  assert.equal(
    c.a.problem?.id,
    [...first.steps].reverse().find((s) => s.problem)!.problem!.id,
  );
  assert.equal(
    c.same_problem,
    !!c.a.problem && c.a.problem.id === c.b.problem?.id,
  );
  assert.ok(c.a.time.working_seconds <= c.a.time.elapsed_seconds);
  assert.equal(c.a.autopilot.fixture, true);
  assert.equal(c.a.builds.length, 0);

  // A person scores one non-code option higher; Continue then chooses it and saves a
  // proposal. The comparison now reads the scores the choice was made on, and who chose.
  const problem = c.a.problem!;
  const rep = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const target = rep.suitability.candidates.find(
    (x) => x.alternative.kind === 'use_existing',
  )!;
  const cards = (await h.store.listEntities(owner, h.ws.id, {
    kind: 'scorecard',
  })) as { id: string; version: number; body: unknown }[];
  for (const sc of target.scorecards) {
    const sys = cards.find((x) => x.id === sc.id)!;
    const b = sys.body as ScorecardBody;
    const { assessment: _a, ...plain } = b;
    await h.store.recordScorecard(owner, h.ws.id, {
      title: 'Owner scores',
      body: {
        ...plain,
        reviewer: { kind: 'human', label: 'Owner' },
        ratings: Object.fromEntries(
          Object.entries(b.ratings).map(([k, v]) => [
            k,
            { ...v, rating: 5, rationale: 'Owner knowledge (test).' },
          ]),
        ),
        gates: {
          ethics: { status: 'clear', note: 'Checked (test).' },
          access: { status: 'clear', note: 'Checked (test).' },
        },
        edit_of: {
          scorecard: { id: sys.id, version: sys.version },
          reason: 'Owner knowledge (test).',
        },
      } as unknown as Record<string, unknown>,
    });
  }
  await h.runner.retry(owner, h.ws.id, first.id, {
    expected_version: first.version,
  });
  await h.runner.settled(first.id);
  const done = await h.store.getAutopilot(owner, h.ws.id, first.id);
  assert.equal(done.outcome, 'proposal', done.explanation);
  const after = await compareRuns(h.store, owner, h.ws.id, {
    a: first.id,
    b: second.id,
  });
  assert.equal(after.a.options.scores_from, 'selection');
  assert.equal(after.a.choice?.id, target.alternative.id);
  assert.equal(after.a.choice?.by, 'autopilot');
  assert.ok(after.a.choice?.disposition);
  assert.match(after.a.choice?.rationale ?? '', /unattended autopilot/);
  assert.equal(
    after.a.options.ranked.find((o) => o.id === target.alternative.id)
      ?.disposition,
    after.a.choice?.disposition,
  );
  const proposalStep = done.steps.find((x) => x.stage === 'proposal')!;
  assert.equal(after.a.proposal?.id, proposalStep.child!.id);
  // The earlier stop for a person stays in the record.
  assert.ok(after.a.stops.some((x) => x.stage === 'select'));
  assert.equal(after.a.autopilot.outcome, 'proposal');

  // Refusals: the same autopilot twice, an autopilot of another workspace, a stranger.
  await rejects(
    'INVALID_CONTRACT',
    compareRuns(h.store, owner, h.ws.id, { a: first.id, b: first.id }),
    /two different autopilots/,
  );
  await rejects(
    'INVALID_CONTRACT',
    compareRuns(h.store, owner, h.ws.id, { a: first.id, b: 'nope' }),
  );
  const other = await h.store.createWorkspace(owner, {
    name: 'Other',
    record_mode: 'fixture',
  });
  await rejects(
    'NOT_FOUND',
    compareRuns(h.store, owner, other.id, { a: first.id, b: second.id }),
  );
  await rejects(
    'NOT_FOUND',
    compareRuns(h.store, owner, h.ws.id, { a: first.id, b: randomUUID() }),
  );
  const stranger = { actorId: randomUUID() };
  await h.store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Stranger',
  });
  await assert.rejects(
    compareRuns(h.store, stranger, h.ws.id, { a: first.id, b: second.id }),
    (e: unknown) =>
      e instanceof ContractError &&
      (e.code === 'ACCESS_DENIED' || e.code === 'NOT_FOUND'),
  );
  // A viewer of the workspace may read the comparison; it writes nothing.
  await h.store.addMember(owner, h.ws.id, stranger.actorId, 'viewer');
  const seen = await compareRuns(h.store, stranger, h.ws.id, {
    a: first.id,
    b: second.id,
  });
  assert.equal(seen.a.autopilot.id, first.id);
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, first.id)).version,
    done.version,
  );
});

test('HTTP: the comparison is a read under the workspace, and refuses a bad pair', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
    CREATOR_PORTFOLIO_SCHEDULER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(() => api.close());
  await api.ready();
  const origin = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(origin);
  const ws = await api.store!.createWorkspace(
    { actorId: DEFAULT_OWNER_ACTOR_ID },
    { name: 'Compare API', record_mode: 'fixture' },
  );
  const get = async (
    q: string,
    headers: Record<string, string> = auth.read,
  ) => {
    const res = await fetch(
      `${origin}/workspaces/${ws.id}/run-comparison${q}`,
      {
        headers,
      },
    );
    return { status: res.status, body: (await res.json()) as any };
  };
  const same = randomUUID();
  const r1 = await get(`?a=${same}&b=${same}`);
  assert.equal(r1.status, 400);
  assert.match(r1.body.error.message, /two different autopilots/);
  assert.equal((await get('')).status, 400);
  assert.equal((await get(`?a=${randomUUID()}&b=${randomUUID()}`)).status, 404);
  // No session, no read.
  assert.equal((await get(`?a=${same}&b=${randomUUID()}`, {})).status, 401);
  // A write to the comparison is not a route.
  const post = await fetch(`${origin}/workspaces/${ws.id}/run-comparison`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.write },
    body: '{}',
  });
  assert.notEqual(post.status, 200);
});
