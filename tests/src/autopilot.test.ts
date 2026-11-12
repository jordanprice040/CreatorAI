import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import {
  AutopilotConfigSchema,
  AutopilotSchema,
  ContractError,
  WebDiscoveryScopeSchema,
  autopilotSummary,
  routinePolicySummary,
  type AutopilotConfig,
  type AutopilotStep,
  type ErrorCode,
  type ExplorationResult,
  type RankedCandidate,
  type RoutinePolicyInput,
  type ScorecardBody,
  type SelectionReport,
  type WebDiscovery,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  autopilotChildLimits,
  autopilotChoice,
  checkSelection,
  nextAutopilotStage,
  pickExplored,
  refusalOutcome,
} from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { ConnectionStore } from '@creator/db';
import {
  AutopilotRunner,
  DEFAULT_OWNER_ACTOR_ID,
  autopilotKey,
  createApi,
  type AutopilotWeb,
} from '@creator/api';
import { discoverySetup, owner } from './discovery-harness.js';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';

// P13 (ADR-0092): an autopilot runs one run's main path with the forms' own server operations,
// admitted by the run's routine approvals, and stops with an honest reason when a step needs a
// person, an approval, or more than its limits allow.

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

// ---- Fixed rules (no database) -------------------------------------------------------------

const step = (
  stage: AutopilotStep['stage'],
  state: AutopilotStep['state'] = 'done',
  option: AutopilotStep['option'] = null,
): AutopilotStep => ({
  stage,
  attempt: 1,
  state,
  child: null,
  calls: 0,
  problem: null,
  option,
  request: null,
  key: null,
  note: '',
  started_at: new Date().toISOString(),
  finished_at: null,
});

test('steps follow the main path; a software choice goes to spec, any other to a proposal', () => {
  assert.equal(nextAutopilotStage({ research: null }, []), 'explore');
  assert.equal(nextAutopilotStage({ research: {} as never }, []), 'research');
  const path = ['explore', 'brief', 'discover', 'assess'] as const;
  const steps: AutopilotStep[] = [];
  const seen: string[] = [];
  for (const s of path) {
    steps.push(step(s));
    seen.push(nextAutopilotStage({ research: null }, steps)!);
  }
  assert.deepEqual(seen, ['brief', 'discover', 'assess', 'select']);
  const opt = (kind: string) => ({ id: 'x', version: 1, kind, title: 't' });
  assert.equal(
    nextAutopilotStage({ research: null }, [
      ...steps,
      step('select', 'done', opt('build')),
    ]),
    'spec',
  );
  assert.equal(
    nextAutopilotStage({ research: null }, [
      ...steps,
      step('select', 'done', opt('use_existing')),
    ]),
    'proposal',
  );
  assert.equal(
    nextAutopilotStage({ research: null }, [...steps, step('proposal')]),
    null,
  );
  // A stopped step does not count as done.
  assert.equal(
    nextAutopilotStage({ research: null }, [
      step('explore'),
      step('brief', 'stopped'),
    ]),
    'brief',
  );
});

test("a step's limits come out of what the autopilot has left, and a step that cannot fit stops", () => {
  const base = {
    route: 'subscription' as const,
    timeout_ms: 120_000,
    per_run: 40,
    remaining: 100,
    seconds_left: 7200,
  };
  const d = autopilotChildLimits({ ...base, stage: 'discover', width: 5 });
  assert.ok(d.ok);
  if (d.ok) {
    assert.equal(d.calls, 24);
    assert.equal(d.limits.max_children, 5);
    // Plan routes: one job at a time, one attempt per call (the connection's rule).
    assert.equal(d.limits.max_concurrency, 1);
    assert.equal(d.limits.max_attempts, 1);
    assert.equal(d.limits.call_timeout_ms, 120_000);
    assert.ok(d.limits.max_wall_seconds <= 7200);
  }
  // Fewer calls left than the step needs at least: limit reached, nothing started.
  const thin = autopilotChildLimits({
    ...base,
    stage: 'discover',
    width: 5,
    remaining: 6,
  });
  assert.equal(thin.ok, false);
  if (!thin.ok) {
    assert.equal(thin.outcome, 'limit_reached');
    assert.match(
      thin.reason,
      /needs at least 7 model calls; the autopilot has 6 left/,
    );
  }
  // A per-run cap below the floor names the cap to raise.
  const cap = autopilotChildLimits({
    ...base,
    stage: 'assess',
    width: 4,
    per_run: 3,
  });
  assert.equal(cap.ok, false);
  if (!cap.ok) assert.match(cap.reason, /per-run cap of 3/);
  // The end time bounds the wall time; too little time stops the step.
  const late = autopilotChildLimits({
    ...base,
    stage: 'explore',
    width: 1,
    seconds_left: 30,
  });
  assert.equal(late.ok, false);
  if (!late.ok) assert.equal(late.outcome, 'limit_reached');
  const short = autopilotChildLimits({
    ...base,
    stage: 'explore',
    width: 1,
    seconds_left: 200,
  });
  assert.ok(short.ok && short.limits.max_wall_seconds === 200);
  // API route: the metered 30 s call bound and two jobs at a time for discovery.
  const api = autopilotChildLimits({
    ...base,
    route: 'api',
    timeout_ms: null,
    per_run: null,
    stage: 'discover',
    width: 3,
  });
  assert.ok(
    api.ok &&
      api.limits.call_timeout_ms === 30_000 &&
      api.limits.max_concurrency === 2,
  );
});

test('the first exploration candidate goes on; duplicates and thin ones never do', () => {
  const entry = (ref: string, disposition: string) => ({
    ref,
    title: `Problem ${ref}`,
    disposition,
    reasons: [],
    duplicate_of: null,
    claims: [
      {
        ref: 'C1',
        claim_id: 'AAAAAAAA-0000-4000-8000-000000000001',
        version: 1,
        status: 'supported',
        statement: 's',
        contrary: false,
      },
      {
        ref: 'C1',
        claim_id: 'aaaaaaaa-0000-4000-8000-000000000001',
        version: 1,
        status: 'supported',
        statement: 's',
        contrary: false,
      },
    ],
  });
  const result = (cands: unknown[]) =>
    ({
      outcome: 'candidates',
      candidates: cands,
    }) as unknown as ExplorationResult;
  const p = pickExplored(
    result([entry('E1', 'duplicate'), entry('E2', 'candidate')]),
  );
  assert.ok(p.ok);
  if (p.ok) {
    assert.equal(p.ref, 'E2');
    assert.deepEqual(p.claims, ['aaaaaaaa-0000-4000-8000-000000000001']);
  }
  const none = pickExplored(result([entry('E1', 'insufficient_evidence')]));
  assert.equal(none.ok, false);
  if (!none.ok) {
    assert.equal(none.outcome, 'insufficient_evidence');
    assert.match(none.reason, /E1 insufficient evidence/);
  }
});

const score = (n: number) => ({
  numerator: String(n * 10),
  denominator: '10',
  display: `${n}.0`,
});
const cand = (
  id: string,
  kind: string,
  rank: number | null,
  o: Partial<RankedCandidate> = {},
): RankedCandidate => ({
  alternative: { id, version: 1, kind, title: `Option ${id}` },
  status: rank === null ? 'incomplete' : 'complete',
  score: rank === null ? null : score(5 - rank),
  range: null,
  unknown_criteria: [],
  rank,
  overlaps_with: [],
  disagreements: [],
  scorecards: [],
  gates: {
    ethics_access: 'clear',
    discovery: 'candidate',
    humility: 'not_applicable',
    blocked: {},
  },
  ...o,
});
const report = (
  suit: RankedCandidate[],
  opp: RankedCandidate[] = [],
  topChanged = false,
): SelectionReport => {
  const ranking = (
    rubric: 'suitability' | 'opportunity',
    c: RankedCandidate[],
  ) => ({
    rubric,
    rubric_version: 'v',
    rubric_hash: 'a'.repeat(64),
    candidates: c,
    excluded: [],
    sensitivity: {
      shortlist_size: 3,
      baseline: [],
      scenarios: [
        {
          name: 'double cost',
          weights: {},
          ranking: [],
          shortlist: [],
          shortlist_changed: topChanged,
          top_changed: topChanged,
        },
      ],
      stable: !topChanged,
      note: 'n',
    },
  });
  return {
    report_version: 'selection-report/1',
    problem: { id: 'p', version: 2, title: 'P' },
    opportunity: ranking('opportunity', opp),
    suitability: ranking('suitability', suit),
    report_hash: 'b'.repeat(64),
  };
};

test('the choice rule advances only a clear, stable, unblocked first place; everything else stops for a person', () => {
  const ok = autopilotChoice(
    report([
      cand('a', 'use_existing', 1),
      cand('b', 'change_process', 2),
      cand('c', 'human_led', null),
    ]),
  );
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.option.id, 'a');
    const d = Object.fromEntries(
      ok.request.dispositions.map((x) => [x.alternative.id, x.disposition]),
    );
    assert.deepEqual(d, { a: 'recommend_alternative', b: 'defer', c: 'defer' });
    assert.equal(ok.request.override_reason, null);
    // The request passes the same check the selection route makes: no override needed.
    const check = checkSelection(
      report([
        cand('a', 'use_existing', 1),
        cand('b', 'change_process', 2),
        cand('c', 'human_led', null),
      ]),
      ok.request,
    );
    assert.deepEqual(check.invalid, []);
    assert.deepEqual(check.blocked, []);
    assert.equal(check.override_reason_missing, false);
  }
  const tie = autopilotChoice(
    report([cand('a', 'use_existing', 1), cand('b', 'human_led', 1)]),
  );
  assert.ok(
    !tie.ok &&
      tie.outcome === 'needs_person' &&
      /tie for first/.test(tie.reason),
  );
  const unstable = autopilotChoice(
    report([cand('a', 'use_existing', 1), cand('b', 'human_led', 2)], [], true),
  );
  assert.ok(
    !unstable.ok &&
      unstable.outcome === 'needs_person' &&
      /double cost/.test(unstable.reason),
  );
  const unscored = autopilotChoice(report([cand('a', 'use_existing', null)]));
  assert.ok(
    !unscored.ok &&
      unscored.outcome === 'needs_person' &&
      /unknown ratings are not neutral/.test(unscored.reason),
  );
  const blocked = autopilotChoice(
    report([
      cand('a', 'use_existing', 1, {
        gates: {
          ethics_access: 'not_assessed',
          discovery: 'candidate',
          humility: 'not_applicable',
          blocked: {
            recommend_alternative: ['A person must confirm ethics and access.'],
          },
        },
      }),
    ]),
  );
  assert.ok(
    !blocked.ok &&
      blocked.outcome === 'needs_person' &&
      /must confirm ethics/.test(blocked.reason),
  );
  const rejected = autopilotChoice(
    report([
      cand('a', 'use_existing', 1, {
        gates: {
          ethics_access: 'clear',
          discovery: 'rejected',
          humility: 'not_applicable',
          blocked: {},
        },
      }),
    ]),
  );
  assert.ok(!rejected.ok && rejected.outcome === 'no_eligible_option');
  assert.ok(!autopilotChoice(report([])).ok);
  // Software: it must also lead the opportunity ranking alone, or an override (a judgment) is needed.
  const sw = cand('s', 'build', 1);
  const built = autopilotChoice(
    report([sw, cand('b', 'use_existing', 2)], [cand('s', 'build', 1)]),
  );
  assert.ok(
    built.ok &&
      built.request.dispositions[0]!.disposition === 'select_for_build',
  );
  const outranked = autopilotChoice(
    report(
      [sw, cand('b', 'use_existing', 2)],
      [cand('s', 'build', 2), cand('h', 'hybrid', 1)],
    ),
  );
  assert.ok(
    !outranked.ok &&
      outranked.outcome === 'needs_person' &&
      /override/.test(outranked.reason),
  );
});

test('refusals map to honest outcomes; the summary says what never happens', () => {
  assert.equal(refusalOutcome('SCOPE_EXCEEDED'), 'limit_reached');
  assert.equal(refusalOutcome('BUDGET_EXCEEDED'), 'limit_reached');
  assert.equal(refusalOutcome('ACCESS_DENIED'), 'needs_authority');
  assert.equal(refusalOutcome('INVALID_CONTRACT'), 'failed');
  assert.equal(refusalOutcome(null), 'failed');
  assert.notEqual(
    autopilotKey('A', 'explore', 1),
    autopilotKey('a', 'explore', 2),
  );
  assert.equal(
    autopilotKey('A', 'explore', 1),
    autopilotKey('a', 'explore', 1),
  );
  assert.match(autopilotKey('a', 'select', 1), /^[A-Za-z0-9_.:-]{8,200}$/);
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
  const policy = (
    stages: RoutinePolicyInput['stages'] = ['model_work', 'selection'],
    over: Partial<RoutinePolicyInput> = {},
  ): RoutinePolicyInput => ({
    stages,
    data_classes: ['synthetic'],
    max_actions: 50,
    max_total_nano_usd: '100000000000',
    stop_on: ['person_rejects'],
    expires_at: inHours(4),
    rationale: 'Test autopilot policy.',
    ...over,
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
    limits: { max_calls: 80, ends_at: inHours(2) },
    ...over,
  });
  const body = (c: AutopilotConfig) => ({
    config: c,
    summary_seen: autopilotSummary(c),
  });
  const start = async (runId: string, c = config()) => {
    const a = await runner.start(owner, s!.ws.id, runId, body(c));
    await runner.settled(a.id);
    return store.getAutopilot(owner, s!.ws.id, a.id);
  };
  const seed = async () =>
    s!.seed(
      DISCOVERY_SCENARIOS.find((x) => x.key === 'existing_tool')!,
      await run(null),
    );
  return { ...s, store, runner, run, policy, config, body, start, seed };
}

test('an autopilot runs explore → brief → discover → assess, stops at a tie for a person, and finishes with a proposal after Continue', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const a = await h.start(runId);
  AutopilotSchema.parse(a);
  assert.equal(a.state, 'finished');
  assert.equal(a.outcome, 'needs_person', a.explanation);
  assert.deepEqual(
    a.steps.map((s) => [s.stage, s.state]),
    [
      ['explore', 'done'],
      ['brief', 'done'],
      ['discover', 'done'],
      ['assess', 'done'],
      ['select', 'stopped'],
    ],
  );
  // The fixture rates every option the same: a tie is never broken by a rule.
  assert.match(a.explanation, /tie for first on suitability/);
  // Each step kept its exact request and key; the calls it set aside add up, within the limit.
  for (const s of a.steps.filter((x) =>
    ['explore', 'discover', 'assess'].includes(x.stage),
  )) {
    assert.ok(s.request && s.key && s.child?.kind === 'workflow');
    assert.equal(
      (s.request.limits as { max_calls: number }).max_calls,
      s.calls,
    );
  }
  assert.equal(
    a.calls_reserved,
    a.steps.reduce((n, s) => n + s.calls, 0),
  );
  assert.ok(a.calls_reserved <= 80);
  // Nothing was selected and no decision was raised for the owner.
  const problem = a.steps[2]!.problem!;
  assert.equal(
    (await h.store.listSelections(owner, h.ws.id, problem.id)).length,
    0,
  );
  // Every model call of the run was admitted (by the run's grants or its routine policy).
  const audit = await h.store.listDecisions(owner, h.ws.id, { runId });
  assert.equal(audit.length, 0);

  // A person scores one non-code option higher and confirms its gates; Continue tries the
  // stopped step again and the autopilot finishes with a proposal.
  const rep = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const target = rep.suitability.candidates.find(
    (c) => c.alternative.kind === 'use_existing',
  )!;
  const cards = (await h.store.listEntities(owner, h.ws.id, {
    kind: 'scorecard',
  })) as {
    id: string;
    version: number;
    body: unknown;
  }[];
  for (const sc of target.scorecards) {
    const sys = cards.find((c) => c.id === sc.id)!;
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
  await rejects(
    'VERSION_CONFLICT',
    h.runner.retry(owner, h.ws.id, a.id, { expected_version: a.version - 1 }),
  );
  const cont = await h.runner.retry(owner, h.ws.id, a.id, {
    expected_version: a.version,
  });
  assert.equal(cont.state, 'running');
  await h.runner.settled(a.id);
  const b = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(b.outcome, 'proposal', b.explanation);
  assert.deepEqual(
    b.steps.slice(4).map((s) => [s.stage, s.attempt, s.state]),
    [
      ['select', 1, 'stopped'],
      ['select', 2, 'done'],
      ['proposal', 1, 'done'],
    ],
  );
  const chosen = b.steps[5]!;
  assert.equal(chosen.option!.id, target.alternative.id);
  const sel = (await h.store.listSelections(owner, h.ws.id, problem.id))[0]!;
  assert.equal(sel.run_id, runId);
  assert.match(sel.rationale, /unattended autopilot/);
  for (const d of sel.dispositions)
    assert.equal(
      d.disposition,
      d.alternative.id === target.alternative.id
        ? 'recommend_alternative'
        : 'defer',
    );
  // The selection was admitted by the run's routine policy, not by a person's approval.
  const admissions = await h.store.listAdmissions(owner, h.ws.id, runId);
  const select = admissions.find(
    (x) => x.binding.action_type === 'candidate.select',
  )!;
  assert.equal(select.reason_code, 'covered_by_routine_policy');
  const proposal = b.steps[6]!.child!;
  assert.equal(proposal.kind, 'proposal');
  const detail = await h.store.proposalDetail(owner, h.ws.id, proposal.id);
  assert.equal(detail.proposal.body.alternative.id, target.alternative.id);
  // A finished autopilot cannot be continued again.
  await rejects(
    'INVALID_TRANSITION',
    h.runner.retry(owner, h.ws.id, a.id, { expected_version: b.version }),
    /cannot continue/,
  );
});

test('a start is refused without routine approvals that cover its steps, with a changed summary, by a non-owner, or beside a running one', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const ws = h.ws.id;
  // No policy at all: it says to turn routine approvals on; a campaign never approves itself.
  await rejects(
    'ACCESS_DENIED',
    h.runner.start(owner, ws, await h.run(null), h.body(h.config())),
    /Turn on routine approvals.*never approves steps itself/,
  );
  // A policy without the selection stage, or ending before the autopilot would.
  await rejects(
    'ACCESS_DENIED',
    h.runner.start(
      owner,
      ws,
      await h.run(h.policy(['model_work'])),
      h.body(h.config()),
    ),
    /do not cover selection \(candidate\.select\)/,
  );
  await rejects(
    'ACCESS_DENIED',
    h.runner.start(
      owner,
      ws,
      await h.run(h.policy(undefined, { expires_at: inHours(1) })),
      h.body(h.config()),
    ),
    /end at .* before the autopilot would/,
  );
  const runId = await h.run();
  // What the owner confirmed must be what runs.
  const c = h.config();
  await rejects(
    'VERSION_CONFLICT',
    h.runner.start(owner, ws, runId, {
      config: c,
      summary_seen: autopilotSummary({ ...c, max_revisions: 0 }),
    }),
  );
  // An editor cannot start one.
  const editor = { actorId: '00000000-0000-4000-8000-0000000000e1' };
  await h.store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'Editor',
  });
  await h.store.addMember(owner, ws, editor.actorId, 'editor');
  await rejects('ACCESS_DENIED', h.runner.start(editor, ws, runId, h.body(c)));
  // One running autopilot per run.
  const slow = new AutopilotRunner(h.store, null, { pollMs: 60_000 });
  const first = await slow.start(owner, ws, runId, h.body(c));
  await rejects(
    'INVALID_TRANSITION',
    h.store.startAutopilot(owner, ws, runId, h.body(c)),
    /already running/,
  );
  await slow.cancel(owner, ws, first.id, {
    expected_version: (await h.store.getAutopilot(owner, ws, first.id)).version,
  });
  await slow.settled(first.id);
  assert.equal(
    (await h.store.getAutopilot(owner, ws, first.id)).outcome,
    'cancelled',
  );
});

test('an empty workspace ends as insufficient evidence; a tight call limit stops before a step that cannot fit', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const empty = await h.start(await h.run());
  assert.equal(empty.outcome, 'insufficient_evidence', empty.explanation);
  assert.equal(empty.steps.at(-1)!.stage, 'explore');

  await h.seed();
  const runId = await h.run();
  const tight = await h.start(
    runId,
    h.config({ limits: { max_calls: 6, ends_at: inHours(2) } }),
  );
  assert.equal(tight.outcome, 'limit_reached', tight.explanation);
  assert.match(
    tight.explanation,
    /Find the problem and options needs at least 7 model calls; the autopilot has 4 left/,
  );
  assert.deepEqual(
    tight.steps.map((s) => [s.stage, s.state]),
    [
      ['explore', 'done'],
      ['brief', 'done'],
      ['discover', 'stopped'],
    ],
  );
  // Nothing was started for the step that did not fit.
  assert.equal(tight.steps[2]!.child, null);
  const wfs = await h.store.listWorkflows(owner, h.ws.id, { runId });
  assert.equal(wfs.length, 1, 'only the exploration ran');
  assert.equal(tight.calls_reserved, 2);
});

test('stopping an autopilot cancels the workflow it is waiting on and keeps what was made', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  let id = '';
  let stopped = false;
  const runner = new AutopilotRunner(h.store, null, {
    pollMs: 5,
    onWait: async () => {
      if (stopped || !id) return;
      stopped = true;
      const a = await h.store.getAutopilot(owner, h.ws.id, id);
      await runner.cancel(owner, h.ws.id, id, {
        expected_version: a.version,
        reason: 'Test stop.',
      });
    },
  });
  const c = h.config();
  id = (await runner.start(owner, h.ws.id, runId, h.body(c))).id;
  await runner.settled(id);
  const a = await h.store.getAutopilot(owner, h.ws.id, id);
  assert.equal(a.outcome, 'cancelled');
  assert.match(a.explanation, /Test stop/);
  const last = a.steps.at(-1)!;
  assert.equal(last.state, 'stopped');
  const wf = await h.store.getWorkflow(owner, h.ws.id, last.child!.id);
  await h.worker.settle();
  const after = await h.store.getWorkflow(owner, h.ws.id, last.child!.id);
  assert.equal(wf.workflow.control, 'cancel');
  assert.equal(after.workflow.state, 'cancelled');
  await rejects(
    'INVALID_TRANSITION',
    runner.retry(owner, h.ws.id, id, { expected_version: a.version }),
    /ended cancelled cannot continue/,
  );
});

test('a restarted studio carries a running autopilot on without starting a step twice', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  // The first studio stops (shutdown) while the exploration is out.
  let first: AutopilotRunner | null = null;
  first = new AutopilotRunner(h.store, null, {
    pollMs: 5,
    onWait: async () => {
      void first!.close();
    },
  });
  const started = await first.start(owner, h.ws.id, runId, h.body(h.config()));
  await first.settled(started.id);
  const mid = await h.store.getAutopilot(owner, h.ws.id, started.id);
  assert.equal(mid.state, 'running');
  assert.equal(mid.steps.length, 1);
  const explore = mid.steps[0]!;
  assert.equal(explore.state, 'running');
  // Worst case: the step's record lost the workflow id it started (crash between the start and
  // recording it). Its key repeats the same start, so the same workflow comes back.
  await h.store.advanceAutopilot(owner, h.ws.id, started.id, mid.version, {
    steps: [{ ...explore, child: null }],
  });
  const second = new AutopilotRunner(h.store, null, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  await second.recover();
  await second.settled(started.id);
  const done = await h.store.getAutopilot(owner, h.ws.id, started.id);
  assert.equal(done.outcome, 'needs_person', done.explanation);
  assert.equal(
    done.steps[0]!.child!.id,
    explore.child!.id,
    'the same exploration',
  );
  const kinds = (await h.store.listWorkflows(owner, h.ws.id, { runId })).map(
    (w) => w.role,
  );
  assert.deepEqual(kinds.filter((k) => k === 'r01_exploration').length, 1);
  assert.deepEqual(kinds.filter((k) => k === 'r02_discovery').length, 1);
  assert.deepEqual(kinds.filter((k) => k === 'r08_assessment').length, 1);
});

test('revoking the routine approvals stops Continue; continuing never repeats finished steps', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const a = await h.start(runId);
  assert.equal(a.outcome, 'needs_person');
  const policy = (await h.store.listRoutinePolicies(owner, h.ws.id)).find(
    (p) => p.policy.run_id === runId,
  )!.policy;
  await h.store.revokeRoutinePolicy(owner, h.ws.id, policy.id, {
    expected_version: policy.version,
    reason: 'Test revoke.',
  });
  await rejects(
    'ACCESS_DENIED',
    h.runner.retry(owner, h.ws.id, a.id, { expected_version: a.version }),
    /Turn on routine approvals/,
  );
  // With approvals on again, Continue retries only the stopped choice (still a tie here).
  const p = h.policy();
  await h.store.setRoutinePolicy(owner, h.ws.id, runId, {
    ...p,
    summary_seen: routinePolicySummary(p),
  });
  await h.runner.retry(owner, h.ws.id, a.id, { expected_version: a.version });
  await h.runner.settled(a.id);
  const b = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(b.outcome, 'needs_person');
  assert.deepEqual(
    b.steps.map((s) => `${s.stage}:${s.attempt}`),
    ['explore:1', 'brief:1', 'discover:1', 'assess:1', 'select:1', 'select:2'],
  );
  assert.equal(b.calls_reserved, a.calls_reserved);
});

test('searching the web first: needs research and evidence covered; its outcome is kept, and a failed search stops the autopilot', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const research = {
    connection_id: '00000000-0000-4000-8000-0000000000c1',
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const c = h.config({ research });
  // The schema refuses web search on data that is not public or synthetic.
  assert.equal(
    AutopilotConfigSchema.safeParse({ ...c, data_class: 'approved_private' })
      .success,
    false,
  );
  await rejects(
    'ACCESS_DENIED',
    h.runner.start(owner, h.ws.id, await h.run(), h.body(c)),
    /do not cover evidence, research/,
  );
  const full = h.policy(['research', 'evidence', 'model_work', 'selection'], {
    data_classes: ['public', 'synthetic'],
  });
  // A stand-in for P12's runner: the autopilot only starts it, reads it and waits.
  let reads = 0;
  const started: unknown[] = [];
  const outcome = { state: 'done', explanation: 'Read 2 pages.' };
  const web: AutopilotWeb = {
    start: async (_ctx, _ws, _run, body) => {
      started.push(body);
      return { id: '00000000-0000-4000-8000-0000000000d1' };
    },
    read: async () =>
      ({
        id: '00000000-0000-4000-8000-0000000000d1',
        version: 1,
        state: reads++ === 0 ? 'searching' : outcome.state,
        explanation: outcome.explanation,
        proposals: [
          { decision: 'admitted', check: 'verified' },
          { decision: 'pending', check: 'verified' },
        ],
      }) as unknown as WebDiscovery,
    isActive: () => true,
    resume: async () => null,
    cancel: async () => null,
  };
  const runner = new AutopilotRunner(h.store, web, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  const runId = await h.run(full);
  const a = await runner.start(owner, h.ws.id, runId, h.body(c));
  await runner.settled(a.id);
  const done = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.deepEqual(started, [research]);
  assert.equal(done.steps[0]!.stage, 'research');
  assert.equal(done.steps[0]!.calls, 2);
  assert.match(
    done.steps[0]!.note,
    /1 claim added by the run's routine approvals; 1 checked claim wait/,
  );
  assert.equal(done.steps[1]!.stage, 'explore');
  assert.equal(done.outcome, 'needs_person', done.explanation);

  outcome.state = 'failed';
  outcome.explanation = 'The search request failed.';
  reads = 0;
  const runId2 = await h.run(full);
  const b = await runner.start(owner, h.ws.id, runId2, h.body(c));
  await runner.settled(b.id);
  const failed = await h.store.getAutopilot(owner, h.ws.id, b.id);
  assert.equal(failed.outcome, 'failed');
  assert.match(
    failed.explanation,
    /web search ended failed: The search request failed/,
  );
  assert.equal(failed.steps.length, 1);
});

test('HTTP: start, list, read, stop and a refused continue go through the workspace routes', async (t) => {
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
  const me = { actorId: DEFAULT_OWNER_ACTOR_ID };
  const store = api.store!;
  const ws = await store.createWorkspace(me, {
    name: 'Autopilot API',
    record_mode: 'fixture',
  });
  const r = await store.createEntity(me, ws.id, {
    kind: 'run',
    title: 'Autopilot run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const run = await store.registerRun(me, ws.id, {
    run: { id: r.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
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
  const pricing = await store.createPricing(
    me,
    ws.id,
    JSON.parse(
      readFileSync(
        new URL('../../config/pricing/fixture-model-v1.json', import.meta.url),
        'utf8',
      ),
    ),
  );
  const envelope = await store.createEnvelope(me, ws.id, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Owner budget',
    cap_nano_usd: '100000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 4,
  });
  // The worker is off here, so the exploration stays queued while the autopilot waits on it.
  const c: AutopilotConfig = AutopilotConfigSchema.parse({
    resource_setup: {
      kind: 'api',
      envelope_id: envelope.id,
      pricing_snapshot_id: pricing.id,
    },
    data_class: 'synthetic',
    limits: { max_calls: 40, ends_at: inHours(2) },
  });
  const body = { config: c, summary_seen: autopilotSummary(c) };
  const refused = await call('POST', `runs/${run.run_id}/autopilots`, body);
  assert.equal(refused.status, 403);
  assert.match(refused.body.error.message, /Turn on routine approvals/);
  const p: RoutinePolicyInput = {
    stages: ['model_work', 'selection'],
    data_classes: ['synthetic'],
    max_actions: 10,
    max_total_nano_usd: null,
    stop_on: [],
    expires_at: inHours(3),
    rationale: 'API test.',
  };
  await store.setRoutinePolicy(me, ws.id, run.run_id, {
    ...p,
    summary_seen: routinePolicySummary(p),
  });
  const made = await call('POST', `runs/${run.run_id}/autopilots`, body);
  assert.equal(made.status, 201, JSON.stringify(made.body));
  AutopilotSchema.parse(made.body);
  const list = await call('GET', `autopilots?run=${run.run_id}`);
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.map((a: { id: string }) => a.id),
    [made.body.id],
  );
  const read = await call('GET', `autopilots/${made.body.id}`);
  const stop = await call('POST', `autopilots/${made.body.id}/cancel`, {
    expected_version: read.body.version,
    reason: 'API test stop.',
  });
  assert.equal(stop.status, 200, JSON.stringify(stop.body));
  assert.equal(stop.body.outcome, 'cancelled');
  const again = await call('POST', `autopilots/${made.body.id}/continue`, {
    expected_version: stop.body.version,
  });
  assert.equal(again.status, 409);
});
