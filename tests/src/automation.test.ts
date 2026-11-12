import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import {
  AUTOMATION_SELECTION_ACTIONS,
  AUTOPILOT_MIN_CALLS,
  ContractError,
  automationAutopilotConfig,
  automationStagesNeeded,
  autopilotSummary,
  policyCovering,
  restRoutinePolicy,
  routinePolicySummary,
  runAutomationSummary,
  selectionRoutinePolicy,
  type AutopilotConfig,
  type ErrorCode,
  type RoutinePolicyInput,
  type RunAutomationConfig,
} from '@creator/contracts';
import { DISCOVERY_SCENARIOS } from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { ConnectionStore } from '@creator/db';
import {
  AutopilotRunner,
  DEFAULT_OWNER_ACTOR_ID,
  createApi,
} from '@creator/api';
import { discoverySetup, owner } from './discovery-harness.js';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// P33 (ADR-0099): automation levels are presets over routine approvals (ADR-0079) and the P13
// autopilot (ADR-0092). "Automate selection" is a standing level on a run that starts a
// selection-only autopilot when an assessment on the run finishes; "Automate the rest" is an
// autopilot entering part way. Nothing here grants authority: the run's policy admits each step.

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
const api = {
  kind: 'api' as const,
  envelope_id: '00000000-0000-4000-8000-0000000000e9',
  pricing_snapshot_id: '00000000-0000-4000-8000-0000000000ea',
};

// ---- Presets (no database) -----------------------------------------------------------------

test('each level asks the run’s routine approvals for exactly the stages its steps need', () => {
  assert.deepEqual(automationStagesNeeded('selection'), ['selection']);
  assert.deepEqual(automationStagesNeeded('rest', { start: 'select' }), [
    'selection',
  ]);
  assert.deepEqual(automationStagesNeeded('rest', { start: 'assess' }), [
    'model_work',
    'selection',
  ]);
  assert.deepEqual(automationStagesNeeded('whole', { research: true }), [
    'evidence',
    'model_work',
    'research',
    'selection',
  ]);
  const ends = inHours(5);
  const sel = selectionRoutinePolicy({ data_class: 'public', ends_at: ends });
  assert.deepEqual(sel.stages, ['selection']);
  assert.deepEqual(sel.data_classes, ['public']);
  assert.equal(sel.max_actions, AUTOMATION_SELECTION_ACTIONS);
  // No money: choosing states no amount, and an amount with no cap is never covered.
  assert.equal(sel.max_total_nano_usd, null);
  assert.equal(sel.expires_at, new Date(ends).toISOString());
  // The selection autopilot it starts: enters at select, the smallest call limit, ends with it.
  const cfg: RunAutomationConfig = {
    resource_setup: api,
    data_class: 'public',
    ends_at: ends,
  };
  const ap = automationAutopilotConfig(cfg, {
    id: '00000000-0000-4000-8000-0000000000a9',
    version: 3,
  });
  assert.deepEqual(ap.start, {
    stage: 'select',
    problem: { id: '00000000-0000-4000-8000-0000000000a9', version: 3 },
  });
  assert.equal(ap.limits.max_calls, AUTOPILOT_MIN_CALLS);
  assert.equal(ap.research, null);
  assert.match(
    autopilotSummary(ap).join(' '),
    /makes no model call before choosing/,
  );
  const summary = runAutomationSummary(cfg).join(' ');
  assert.match(summary, /It makes no model call/);
  assert.match(
    summary,
    /cleared only on the model’s word, it stops and asks you/,
  );
  assert.match(summary, /never publishes, sends messages, spends money/);
  // "Automate the rest" uses P13's preset with its own reason.
  const rest = restRoutinePolicy(
    { ...ap, start: { stage: 'assess', problem: ap.start!.problem } },
    '5000000000',
  );
  assert.deepEqual(rest.stages, ['model_work', 'selection']);
  assert.equal(rest.max_total_nano_usd, '5000000000');
  assert.match(rest.rationale, /Automate the rest/);
});

test('an active policy that covers a level is kept; one that does not is widened, never narrowed', () => {
  const current: RoutinePolicyInput = {
    stages: ['model_work', 'research'],
    data_classes: ['synthetic'],
    max_actions: 40,
    max_total_nano_usd: '1000000000',
    stop_on: ['person_rejects'],
    expires_at: inHours(48),
    rationale: 'Mine.',
  };
  assert.equal(
    policyCovering(current, {
      stages: ['model_work'],
      data_classes: ['synthetic'],
      ends_at: inHours(4),
      extraActions: 20,
    }),
    null,
  );
  const wider = policyCovering(current, {
    stages: ['selection'],
    data_classes: ['public'],
    ends_at: inHours(72),
    extraActions: 20,
    max_total_nano_usd: '500000000',
  })!;
  assert.deepEqual(wider.stages, ['model_work', 'research', 'selection']);
  assert.deepEqual(wider.data_classes, ['public', 'synthetic']);
  assert.equal(wider.max_actions, 60);
  // A smaller money limit never lowers the owner's own; stop conditions and reason stay.
  assert.equal(wider.max_total_nano_usd, '1000000000');
  assert.deepEqual(wider.stop_on, ['person_rejects']);
  assert.equal(wider.rationale, 'Mine.');
  assert.ok(Date.parse(wider.expires_at) > Date.parse(current.expires_at));
  // A longer end time alone is a widening too.
  assert.ok(
    policyCovering(current, {
      stages: ['model_work'],
      data_classes: ['synthetic'],
      ends_at: inHours(96),
      extraActions: 0,
    }),
  );
});

// ---- Store and runner (PostgreSQL, fixture model) ------------------------------------------

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
  const resource_setup = {
    kind: 'api' as const,
    envelope_id: envelope.id,
    pricing_snapshot_id: pricing.id,
  };
  const policy = (
    stages: RoutinePolicyInput['stages'] = ['model_work', 'selection'],
  ): RoutinePolicyInput => ({
    stages,
    data_classes: ['synthetic'],
    max_actions: 50,
    max_total_nano_usd: '100000000000',
    stop_on: ['person_rejects'],
    expires_at: inHours(4),
    rationale: 'Test automation policy.',
  });
  async function run(p: RoutinePolicyInput | null = policy()) {
    const id = await s!.run();
    if (p)
      await store.setRoutinePolicy(owner, s!.ws.id, id, {
        ...p,
        summary_seen: routinePolicySummary(p),
      });
    return id;
  }
  const config = (over: Partial<AutopilotConfig> = {}): AutopilotConfig => ({
    resource_setup,
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
    limits: { max_calls: 80, ends_at: inHours(2) },
    start: null,
    ...over,
  });
  const level = (over: Partial<RunAutomationConfig> = {}) => {
    const c: RunAutomationConfig = {
      resource_setup,
      data_class: 'synthetic',
      ends_at: inHours(3),
      ...over,
    };
    return {
      level: 'selection' as const,
      config: c,
      summary_seen: runAutomationSummary(c),
    };
  };
  /** A whole-process autopilot on its own run, to record a problem with options. */
  const problem = async () => {
    await s.seed(
      DISCOVERY_SCENARIOS.find((x) => x.key === 'existing_tool')!,
      await run(null),
    );
    const c = config();
    const a = await runner.start(owner, s.ws.id, await run(), {
      config: c,
      summary_seen: autopilotSummary(c),
    });
    await runner.settled(a.id);
    const done = await store.getAutopilot(owner, s.ws.id, a.id);
    return done.steps.find((x) => x.stage === 'discover')!.problem!;
  };
  /** A person's assessment of the problem on a run (not an autopilot's step). */
  const assess = async (runId: string, p: { id: string; version: number }) => {
    const preview = await store.previewAssessment(owner, s.ws.id, p.id, null);
    const started = await store.startAssessment(owner, s.ws.id, runId, {
      problem: p,
      resource_setup,
      data_class: 'synthetic',
      limits: {
        max_children: 8,
        max_concurrency: 1,
        max_depth: 1,
        max_attempts: 1,
        max_repairs: 1,
        max_calls: 16,
        max_output_tokens: 8000,
        call_timeout_ms: 5000,
        max_wall_seconds: 600,
      },
      preview_hash: preview.preview_hash,
    });
    await s.worker.settle();
    return started.workflow.id;
  };
  /** One look by the studio, then wait for what it started. */
  const tick = async () => {
    await runner.automate();
    for (const a of await store.listAutopilots(owner, s.ws.id))
      await runner.settled(a.id);
  };
  return {
    ...s,
    store,
    runner,
    run,
    policy,
    config,
    level,
    problem,
    assess,
    tick,
  };
}

test('Automate selection: an assessment that finishes on the run starts one selection autopilot, recorded as the level’s', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const p = await h.problem();
  const runId = await h.run();
  // An assessment before the level was set is not acted on.
  await h.assess(runId, p);
  const set = await h.store.setRunAutomation(owner, h.ws.id, runId, h.level());
  assert.equal(set.state, 'active');
  assert.equal(set.started, 0);
  await h.tick();
  assert.equal(
    (await h.store.listRunAutomations(owner, h.ws.id))[0]!.started,
    0,
  );
  const wf = await h.assess(runId, p);
  await h.tick();
  const [lvl] = await h.store.listRunAutomations(owner, h.ws.id);
  assert.equal(lvl!.started, 1);
  const a = await h.store.getAutopilot(owner, h.ws.id, lvl!.autopilots[0]!.id);
  assert.equal(a.automation_id, set.id);
  assert.equal(a.run_id, runId);
  assert.deepEqual(a.config.start?.stage, 'select');
  assert.equal(a.config.start?.problem.id, p.id);
  // The fixture's options tie, so the fixed rule stops for a person instead of choosing.
  assert.deepEqual(
    a.steps.map((s) => [s.stage, s.state]),
    [['select', 'stopped']],
  );
  assert.equal(a.outcome, 'needs_person', a.explanation);
  assert.equal(a.calls_reserved, 0);
  // Its start is in the audit log under the Autopilot actor, naming the level and assessment.
  const ev = await h.db.pool.query(
    `select payload from audit_events where action = 'autopilot.started' and subject_id = $1`,
    [a.id],
  );
  assert.equal(ev.rows[0].payload.automation_id, set.id);
  assert.equal(ev.rows[0].payload.assessment_workflow_id, wf);
  assert.equal(ev.rows[0].payload.autopilot.started_by, owner.actorId);
  // Each assessment is acted on once.
  await h.tick();
  assert.equal(
    (await h.store.listRunAutomations(owner, h.ws.id))[0]!.started,
    1,
  );
  // Setting the run back to Manual stops it; a later assessment starts nothing.
  const stopped = await h.store.stopRunAutomation(owner, h.ws.id, set.id, {
    expected_version: set.version,
  });
  assert.equal(stopped.state, 'stopped');
  assert.match(stopped.stop_reason ?? '', /Manual/);
  await h.assess(runId, p);
  await h.tick();
  assert.equal(
    (await h.store.listRunAutomations(owner, h.ws.id))[0]!.started,
    1,
  );
  await rejects(
    'INVALID_TRANSITION',
    h.store.stopRunAutomation(owner, h.ws.id, set.id, {}),
  );
});

test('Automate selection is refused without covering approvals, with a changed summary, by a non-owner, or twice', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const ws = h.ws.id;
  await rejects(
    'ACCESS_DENIED',
    h.store.setRunAutomation(owner, ws, await h.run(null), h.level()),
    /Turn on routine approvals/,
  );
  await rejects(
    'ACCESS_DENIED',
    h.store.setRunAutomation(
      owner,
      ws,
      await h.run(h.policy(['model_work'])),
      h.level(),
    ),
    /do not cover selection/,
  );
  const runId = await h.run(h.policy(['selection']));
  await rejects(
    'ACCESS_DENIED',
    h.store.setRunAutomation(
      owner,
      ws,
      runId,
      h.level({ data_class: 'public' }),
    ),
    /do not cover public data/,
  );
  // The approvals end in 4 hours; a level that would outlast them is refused.
  await rejects(
    'ACCESS_DENIED',
    h.store.setRunAutomation(
      owner,
      ws,
      runId,
      h.level({ ends_at: inHours(6) }),
    ),
    /end at/,
  );
  await rejects(
    'VERSION_CONFLICT',
    h.store.setRunAutomation(owner, ws, runId, {
      ...h.level(),
      summary_seen: ['Something else.'],
    }),
  );
  const stranger = { actorId: '00000000-0000-4000-8000-0000000000b7' };
  await assert.rejects(
    h.store.setRunAutomation(stranger, ws, runId, h.level()),
  );
  await h.store.setRunAutomation(owner, ws, runId, h.level());
  await rejects(
    'INVALID_TRANSITION',
    h.store.setRunAutomation(
      owner,
      ws,
      runId,
      h.level({ ends_at: inHours(2) }),
    ),
    /already automates selection/,
  );
});

test('Automate selection stops itself when the run’s approvals no longer cover it or its end time passes, and leaves an autopilot’s own assessment to that autopilot', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const p = await h.problem();
  const runId = await h.run();
  const set = await h.store.setRunAutomation(owner, h.ws.id, runId, h.level());
  // The owner revokes the run's routine approvals; the next look stops the level with why.
  const [view] = (await h.store.listRoutinePolicies(owner, h.ws.id)).filter(
    (v) => v.policy.run_id === runId,
  );
  await h.store.revokeRoutinePolicy(owner, h.ws.id, view!.policy.id, {
    expected_version: view!.policy.version,
    reason: 'Test revoke.',
  });
  await h.assess(runId, p);
  await h.tick();
  const [lvl] = await h.store.listRunAutomations(owner, h.ws.id);
  assert.equal(lvl!.id, set.id);
  assert.equal(lvl!.state, 'stopped');
  assert.match(lvl!.stop_reason ?? '', /no longer cover it/);
  assert.equal(lvl!.started, 0);
  // An assessment made by an autopilot's own step is the autopilot's to choose on.
  const run2 = await h.run();
  await h.store.setRunAutomation(owner, h.ws.id, run2, h.level());
  const c = h.config({ start: { stage: 'assess', problem: p } });
  const a = await h.runner.start(owner, h.ws.id, run2, {
    config: c,
    summary_seen: autopilotSummary(c),
  });
  await h.runner.settled(a.id);
  await h.tick();
  const now = (await h.store.listRunAutomations(owner, h.ws.id)).find(
    (x) => x.run_id === run2,
  )!;
  assert.equal(now.started, 0);
  // The end time passing stops it as well.
  await h.db.pool.query(
    `update run_automations set config = jsonb_set(config, '{ends_at}', to_jsonb($2::text))
      where id = $1`,
    [now.id, new Date(Date.now() - 1000).toISOString()],
  );
  await h.tick();
  const ended = (await h.store.listRunAutomations(owner, h.ws.id)).find(
    (x) => x.id === now.id,
  )!;
  assert.equal(ended.state, 'stopped');
  assert.equal(ended.stop_reason, 'Its end time passed.');
});

test('HTTP: set, list and set back to Manual go through the workspace routes', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const app = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
    CREATOR_PORTFOLIO_SCHEDULER: 'off',
  });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  let closed: Promise<void> | null = null;
  t.after(() => (closed ??= app.close()));
  await app.ready();
  const origin = `http://127.0.0.1:${(app.server.address() as { port: number }).port}/api`;
  const auth = await login(origin);
  const me = { actorId: DEFAULT_OWNER_ACTOR_ID };
  const store = app.store!;
  const ws = await store.createWorkspace(me, {
    name: 'Automation API',
    record_mode: 'fixture',
  });
  const r = await store.createEntity(me, ws.id, {
    kind: 'run',
    title: 'Automated run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const p = selectionRoutinePolicy({
    data_class: 'synthetic',
    ends_at: inHours(5),
  });
  const run = await store.registerRun(me, ws.id, {
    run: { id: r.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
    routine_policy: { ...p, summary_seen: routinePolicySummary(p) },
  });
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${origin}/workspaces/${ws.id}/${path}`, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(method === 'GET' ? auth.read : auth.write),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    return { status: res.status, body: (await res.json()) as any };
  };
  const cfg: RunAutomationConfig = {
    resource_setup: api,
    data_class: 'synthetic',
    ends_at: inHours(4),
  };
  const set = await call('POST', `runs/${run.run_id}/automation`, {
    level: 'selection',
    config: cfg,
    summary_seen: runAutomationSummary(cfg),
  });
  assert.equal(set.status, 201, JSON.stringify(set.body));
  assert.equal(set.body.state, 'active');
  const list = await call('GET', 'automations');
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.map((x: { id: string }) => x.id),
    [set.body.id],
  );
  const stop = await call('POST', `automations/${set.body.id}/stop`, {
    expected_version: set.body.version,
  });
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  assert.equal(stop.body.state, 'stopped');
  const again = await call('POST', `automations/${set.body.id}/stop`, {});
  assert.equal(again.status, 409);
});
