import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import {
  AUTOPILOT_MIN_CALLS,
  AutopilotConfigSchema,
  AutopilotSchema,
  autopilotContinuable,
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
  type Selection,
  type SelectionReport,
  type WebDiscovery,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  autopilotChildLimits,
  autopilotChoice,
  autopilotProblem,
  checkSelection,
  notAdmitted,
  nextAutopilotStage,
  personChoice,
  pickExplored,
  refusalOutcome,
} from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { AUTOPILOT_ACTOR_ID, ConnectionStore } from '@creator/db';
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
      cand('c', 'human_led', null, {
        gates: {
          ethics_access: 'clear',
          discovery: 'rejected',
          humility: 'not_applicable',
          blocked: {},
        },
      }),
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
        cand('c', 'human_led', null, {
          gates: {
            ethics_access: 'clear',
            discovery: 'rejected',
            humility: 'not_applicable',
            blocked: {},
          },
        }),
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
      /unknown ratings are not neutral/i.test(unscored.reason),
  );
  // Review M-2: an option that could be chosen and is not fully scored stops the rule, even when
  // another option ranks first; the person sees which criteria are unknown.
  const partly = autopilotChoice(
    report([
      cand('a', 'use_existing', 1),
      cand('c', 'human_led', null, {
        unknown_criteria: ['adoption_cost'],
      }),
    ]),
  );
  assert.ok(
    !partly.ok &&
      partly.outcome === 'needs_person' &&
      /Option c.*adoption cost/.test(partly.reason),
  );
  // Review N-5: an option discovery did not keep as a candidate (one a person added later) is
  // never advanced by the rule.
  const added = autopilotChoice(
    report([
      cand('a', 'use_existing', 1, {
        gates: {
          ethics_access: 'clear',
          discovery: null,
          humility: 'not_applicable',
          blocked: {},
        },
      }),
    ]),
  );
  assert.ok(!added.ok && added.outcome === 'no_eligible_option');
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

test('a person’s choice under Decide carries the autopilot on; part-way starts and Continue limits', () => {
  const since = '2026-11-12T00:00:00.000Z';
  const sel = (o: Partial<Selection> = {}): Selection =>
    ({
      id: 's',
      workspace_id: 'w',
      run_id: 'r',
      problem: { id: 'p', version: 2 },
      report_hash: 'b'.repeat(64),
      report: report([cand('a', 'use_existing', 1), cand('b', 'build', 1)]),
      dispositions: [
        {
          alternative: { id: 'a', version: 1 },
          disposition: 'recommend_alternative',
          reasons: ['Mine.'],
          reverse_if: 'x',
        },
        {
          alternative: { id: 'b', version: 1 },
          disposition: 'defer',
          reasons: ['Later.'],
          reverse_if: 'x',
        },
      ],
      overrides: [],
      override_reason: null,
      rationale: 'Mine.',
      admission_id: 'ad',
      actor_id: 'person',
      autopilot_id: null,
      created_at: '2026-11-12T01:00:00.000Z',
      current: true,
      ...o,
    }) as Selection;
  const carry = personChoice(sel(), since);
  assert.ok(carry.kind === 'carry' && carry.option.id === 'a');
  assert.equal(carry.kind === 'carry' && carry.option.kind, 'use_existing');
  // Not the person's, not current, or older than the autopilot: the rule runs as before.
  assert.equal(personChoice(sel({ autopilot_id: 'ap' }), since).kind, 'none');
  assert.equal(personChoice(sel({ current: false }), since).kind, 'none');
  assert.equal(
    personChoice(sel({ created_at: '2026-11-11T00:00:00.000Z' }), since).kind,
    'none',
  );
  assert.equal(personChoice(null, since).kind, 'none');
  const none = personChoice(
    sel({
      dispositions: sel().dispositions.map((d) => ({
        ...d,
        disposition: 'defer' as const,
      })),
    }),
    since,
  );
  assert.ok(none.kind === 'stop' && none.outcome === 'no_eligible_option');
  const build = personChoice(
    sel({
      dispositions: [
        { ...sel().dispositions[0]!, disposition: 'defer' },
        { ...sel().dispositions[1]!, disposition: 'select_for_build' },
      ],
    }),
    since,
  );
  assert.ok(build.kind === 'carry' && build.option.kind === 'build');
  assert.equal(
    nextAutopilotStage({ research: null }, [
      step('select', 'done', build.kind === 'carry' ? build.option : null),
    ]),
    'spec',
  );

  // Review L-8: an autopilot can enter at assessment or selection of a recorded problem.
  const start = { stage: 'select' as const, problem: { id: 'p', version: 3 } };
  assert.equal(nextAutopilotStage({ research: null, start }, []), 'select');
  assert.deepEqual(autopilotProblem({ start }, []), { id: 'p', version: 3 });
  assert.equal(autopilotProblem({ start: null }, []), null);

  // Review L-3 and N-4: Continue cannot get past a stop marked final, or a full step list.
  const finished = {
    state: 'finished' as const,
    outcome: 'needs_person' as const,
    steps: [step('select', 'stopped')],
  };
  assert.ok(autopilotContinuable(finished).ok);
  const spec = autopilotContinuable({
    ...finished,
    steps: [{ ...step('spec', 'stopped'), no_retry: 'The spec is yours.' }],
  });
  assert.ok(!spec.ok && spec.reason === 'The spec is yours.');
  assert.ok(
    !autopilotContinuable({
      ...finished,
      steps: Array.from({ length: 56 }, () => step('select', 'stopped')),
    }).ok,
  );
  assert.ok(
    !autopilotContinuable({ ...finished, outcome: 'proposal' as const }).ok,
  );
  // Review N-2: fewer calls than the shortest path needs is refused up front.
  assert.equal(AUTOPILOT_MIN_CALLS, 8);
  const lim = autopilotChildLimits({
    stage: 'discover',
    route: 'api',
    timeout_ms: null,
    per_run: null,
    remaining: 3,
    seconds_left: 7200,
    width: 2,
  });
  assert.ok(!lim.ok && /cannot be raised/.test(lim.final ?? ''));
  const capped = autopilotChildLimits({
    stage: 'discover',
    route: 'subscription',
    timeout_ms: null,
    per_run: 3,
    remaining: 100,
    seconds_left: 7200,
    width: 2,
  });
  assert.ok(!capped.ok && capped.final === undefined);
  // Review 3 N-1: web search first takes 2 more calls, so fewer than 10 are refused.
  const research = {
    connection_id: '00000000-0000-4000-8000-0000000000c1',
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const base = {
    resource_setup: {
      kind: 'api',
      envelope_id: '00000000-0000-4000-8000-0000000000e9',
      pricing_snapshot_id: '00000000-0000-4000-8000-0000000000ea',
    },
    data_class: 'public',
    research,
  };
  assert.equal(
    AutopilotConfigSchema.safeParse({
      ...base,
      limits: { max_calls: 9, ends_at: inHours(2) },
    }).success,
    false,
  );
  assert.ok(
    AutopilotConfigSchema.safeParse({
      ...base,
      limits: { max_calls: 10, ends_at: inHours(2) },
    }).success,
  );
  // Review 2 N-1: the Approvals sentence and the open question only while it is open.
  const pending = notAdmitted('Option a', {
    reason_code: 'request_human',
    explanation: 'A person decides.',
    decision_id: '00000000-0000-4000-8000-0000000000f1',
  });
  assert.match(pending.note, /question also waits under Monitor › Approvals/);
  assert.equal(pending.asked, '00000000-0000-4000-8000-0000000000f1');
  const answered = notAdmitted('Option a', {
    reason_code: 'already_answered_reject',
    explanation: 'You answered no.',
    decision_id: '00000000-0000-4000-8000-0000000000f1',
  });
  assert.doesNotMatch(answered.note, /Approvals/);
  assert.equal(answered.asked, null);
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
    start: null,
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
  // Review H-1: the selection names the autopilot, not the owner, as the one who chose.
  assert.equal(sel.actor_id, AUTOPILOT_ACTOR_ID);
  assert.equal(sel.autopilot_id, a.id);
  const recordedBy = await h.db.pool.query(
    `select actor_id, payload from audit_events where action = 'selection.recorded'
      and subject_id = $1`,
    [sel.id],
  );
  assert.equal(recordedBy.rows[0].actor_id, AUTOPILOT_ACTOR_ID);
  assert.deepEqual(recordedBy.rows[0].payload.autopilot, {
    id: a.id,
    started_by: owner.actorId,
  });
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

type Harness = NonNullable<Awaited<ReturnType<typeof setup>>>;
/** A person scores the options `pick` chooses (replacing the automatic cards), gates clear. */
async function personScores(
  h: Harness,
  problemId: string,
  pick: (c: RankedCandidate) => boolean,
  rating: number,
) {
  const rep = await h.store.selectionReport(owner, h.ws.id, problemId);
  const cards = (await h.store.listEntities(owner, h.ws.id, {
    kind: 'scorecard',
  })) as { id: string; version: number; body: unknown }[];
  for (const c of rep.suitability.candidates.filter(pick))
    for (const sc of c.scorecards) {
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
              { ...v, rating, rationale: 'Owner knowledge (test).' },
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
}

/** The owner clears one option's gates in one click (ADR-0090) and chooses it under Decide. */
async function ownerChooses(
  h: Harness,
  runId: string,
  problemId: string,
  kind = 'use_existing',
  shortlistSize = 3,
) {
  let rep = await h.store.selectionReport(
    owner,
    h.ws.id,
    problemId,
    shortlistSize,
  );
  const target = rep.suitability.candidates.find(
    (c) => c.alternative.kind === kind,
  )!;
  for (const gate of ['ethics', 'access'] as const)
    await h.store.confirmGate(owner, h.ws.id, problemId, {
      alternative: {
        id: target.alternative.id,
        version: target.alternative.version,
      },
      gate,
      reason: 'I checked this one (test).',
      concerns_seen:
        target.gates.gate_details
          ?.find((d) => d.gate === gate)
          ?.concerns.map((x) => x.scorecard) ?? [],
    });
  rep = await h.store.selectionReport(owner, h.ws.id, problemId, shortlistSize);
  const out = await h.store.select(owner, h.ws.id, runId, {
    problem: { id: rep.problem.id, version: rep.problem.version },
    report_hash: rep.report_hash,
    dispositions: rep.suitability.candidates.map((c) => ({
      alternative: { id: c.alternative.id, version: c.alternative.version },
      disposition:
        c.alternative.id === target.alternative.id
          ? 'recommend_alternative'
          : 'defer',
      reasons: ['My call between tied options (test).'],
      reverse_if: 'New evidence.',
    })),
    override_reason: null,
    rationale: 'I chose between the tied options (test).',
    shortlist_size: shortlistSize,
    data_class: 'synthetic',
  });
  assert.equal(out.status, 'recorded', out.admission.explanation);
  return { target, selection: out.selection! };
}

const until = async (check: () => Promise<boolean>, ms = 20_000) => {
  const end = Date.now() + ms;
  while (!(await check())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 10));
  }
};

test('review 2 L-2: an autopilot started at a problem you already chose for keeps your choice', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const first = await h.start(runId);
  const problem = first.steps[2]!.problem!;
  const { target, selection } = await ownerChooses(h, runId, problem.id);
  // Later, an autopilot is started part way at the same problem (P33's "automate the rest").
  const later = await h.start(
    await h.run(h.policy(['selection'])),
    h.config({ start: { stage: 'select', problem } }),
  );
  assert.equal(later.outcome, 'proposal', later.explanation);
  const chose = later.steps[0]!;
  assert.equal(chose.child!.id, selection.id);
  assert.equal(chose.option!.id, target.alternative.id);
  // The owner's selection stays the current one; the autopilot recorded none of its own.
  const sels = await h.store.listSelections(owner, h.ws.id, problem.id);
  assert.deepEqual(
    sels.map((x) => [x.id, x.current, x.autopilot_id]),
    [[selection.id, true, null]],
  );
});

test('review 2 L-1: the end time stops the step’s workflow on every path; a child started as Stop came in is stopped', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  // End time (review 1 L-2, the driver's check): a studio stops while the exploration is out,
  // the end time passes, and the next studio finishes the autopilot and cancels the workflow.
  let first: AutopilotRunner | null = null;
  first = new AutopilotRunner(h.store, null, {
    pollMs: 5,
    onWait: async () => {
      void first!.close();
    },
  });
  const runId = await h.run();
  const a = await first.start(owner, h.ws.id, runId, h.body(h.config()));
  await first.settled(a.id);
  const mid = await h.store.getAutopilot(owner, h.ws.id, a.id);
  const wf = mid.steps[0]!.child!.id;
  await h.db.pool.query(
    `update autopilots set config = jsonb_set(config, '{limits,ends_at}', to_jsonb($2::text))
      where id = $1`,
    [a.id, new Date(Date.now() - 1000).toISOString()],
  );
  const second = new AutopilotRunner(h.store, null, { pollMs: 5 });
  await second.recover();
  await second.settled(a.id);
  const late = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(late.outcome, 'limit_reached', late.explanation);
  assert.equal(
    (await h.store.getWorkflow(owner, h.ws.id, wf)).workflow.state,
    'cancelled',
  );

  // Review 1 L-1: Stop lands between the web search's start and its record. The runner cancels
  // the search it just started; the stop route could not see it.
  const research = {
    connection_id: '00000000-0000-4000-8000-0000000000c1',
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const full = h.policy(['research', 'evidence', 'model_work', 'selection'], {
    data_classes: ['public', 'synthetic'],
  });
  const cancelled: string[] = [];
  let stopping: { id: string } | null = null;
  const web: AutopilotWeb = {
    start: async () => {
      const cur = await h.store.getAutopilot(owner, h.ws.id, stopping!.id);
      await h.store.cancelAutopilot(owner, h.ws.id, cur.id, {});
      return { id: '00000000-0000-4000-8000-0000000000d2' };
    },
    read: async (_c, _w, id) =>
      ({ id, version: 1, state: 'searching' }) as unknown as WebDiscovery,
    isActive: () => true,
    resume: async () => null,
    cancel: async (_c, _w, id) => {
      cancelled.push(id);
      return null;
    },
  };
  const runner = new AutopilotRunner(h.store, web, { pollMs: 5 });
  const c = h.config({
    research,
    limits: { max_calls: 80, ends_at: inHours(2) },
  });
  const b = await h.store.startAutopilot(
    owner,
    h.ws.id,
    await h.run(full),
    h.body(c),
  );
  stopping = b;
  await runner.recover();
  await runner.settled(b.id);
  assert.deepEqual(cancelled, ['00000000-0000-4000-8000-0000000000d2']);
  const stopped = await h.store.getAutopilot(owner, h.ws.id, b.id);
  assert.equal(stopped.outcome, 'cancelled');
  assert.equal(stopped.steps[0]!.child, null);
});

test('review 2 L-1: a running autopilot no driver holds is picked up within the recovery interval; 60 steps at most', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const watcher = new AutopilotRunner(h.store, null, {
    pollMs: 5,
    recoverMs: 20,
    onWait: () => h.worker.settle(),
  });
  t.after(() => watcher.close());
  watcher.watch();
  // Started without any driver (as if the driver died on an error it could not record).
  const a = await h.store.startAutopilot(
    owner,
    h.ws.id,
    await h.run(),
    h.body(h.config()),
  );
  await until(async () => watcher.isActive(a.id));
  await watcher.settled(a.id);
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, a.id)).outcome,
    'needs_person',
  );
  await watcher.close();

  // Review 1 N-4: the store and the database refuse more than 60 steps.
  const b = await h.store.startAutopilot(
    owner,
    h.ws.id,
    await h.run(),
    h.body(h.config()),
  );
  const many = Array.from({ length: 61 }, () => step('explore', 'stopped'));
  await rejects(
    'LIMIT_EXCEEDED',
    h.store.advanceAutopilot(owner, h.ws.id, b.id, b.version, { steps: many }),
    /at most 60 steps/,
  );
  await assert.rejects(
    h.db.pool.query('update autopilots set steps = $2 where id = $1', [
      b.id,
      JSON.stringify(many),
    ]),
    /autopilots_steps_max/,
  );
  await h.store.cancelAutopilot(owner, h.ws.id, b.id, {});
});

test('review M-1: after a tie, a choice recorded under Decide is the one Continue goes on with', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const a = await h.start(runId);
  assert.equal(a.outcome, 'needs_person', a.explanation);
  assert.match(a.explanation, /tie for first.*Choose one under Decide/);
  const problem = a.steps[2]!.problem!;
  let rep = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const target = rep.suitability.candidates.find(
    (c) => c.alternative.kind === 'use_existing',
  )!;
  // The owner clears the target's gates in one click (ADR-0090) and chooses it by hand.
  for (const gate of ['ethics', 'access'] as const)
    await h.store.confirmGate(owner, h.ws.id, problem.id, {
      alternative: {
        id: target.alternative.id,
        version: target.alternative.version,
      },
      gate,
      reason: 'I checked this one (test).',
      concerns_seen:
        target.gates.gate_details
          ?.find((d) => d.gate === gate)
          ?.concerns.map((x) => x.scorecard) ?? [],
    });
  rep = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const mine = await h.store.select(owner, h.ws.id, runId, {
    problem: { id: rep.problem.id, version: rep.problem.version },
    report_hash: rep.report_hash,
    dispositions: rep.suitability.candidates.map((c) => ({
      alternative: { id: c.alternative.id, version: c.alternative.version },
      disposition:
        c.alternative.id === target.alternative.id
          ? 'recommend_alternative'
          : 'defer',
      reasons: ['My call between tied options (test).'],
      reverse_if: 'New evidence.',
    })),
    override_reason: null,
    rationale: 'I chose between the tied options (test).',
    shortlist_size: 3,
    data_class: 'synthetic',
  });
  assert.equal(mine.status, 'recorded', mine.admission.explanation);
  // A person's selection is the person's.
  assert.equal(mine.selection!.actor_id, owner.actorId);
  assert.equal(mine.selection!.autopilot_id, null);
  await h.runner.retry(owner, h.ws.id, a.id, { expected_version: a.version });
  await h.runner.settled(a.id);
  const b = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(b.outcome, 'proposal', b.explanation);
  const chose = b.steps.find(
    (s) => s.stage === 'select' && s.state === 'done',
  )!;
  assert.equal(chose.child!.id, mine.selection!.id);
  assert.equal(chose.option!.id, target.alternative.id);
  assert.match(chose.note, /your choice under Decide/);
  // The autopilot recorded no selection of its own.
  const sels = await h.store.listSelections(owner, h.ws.id, problem.id);
  assert.equal(sels.length, 1);
});

test('review H-1: with gates cleared on the model’s word, the autopilot’s choice stops and asks a person', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  await h.store.setGateRule(owner, h.ws.id, {
    expected_version: 0,
    mode: 'model',
  });
  const runId = await h.run();
  const a = await h.start(runId);
  assert.equal(a.outcome, 'needs_person', a.explanation);
  const problem = a.steps[2]!.problem!;
  const rep = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const target = rep.suitability.candidates.find(
    (c) => c.alternative.kind === 'use_existing',
  )!;
  // The target keeps only the automatic cards, its ethics cleared by the rule; a person scores
  // the other options lower, so the target ranks first alone.
  await personScores(
    h,
    problem.id,
    (c) => c.alternative.id !== target.alternative.id,
    1,
  );
  const row = (
    await h.store.selectionReport(owner, h.ws.id, problem.id)
  ).suitability.candidates.find(
    (c) => c.alternative.id === target.alternative.id,
  )!;
  assert.equal(row.rank, 1);
  assert.equal(
    row.gates.gate_details?.find((d) => d.gate === 'ethics')?.state,
    'auto_cleared',
  );
  await h.runner.retry(owner, h.ws.id, a.id, { expected_version: a.version });
  await h.runner.settled(a.id);
  const b = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(b.outcome, 'needs_authority', b.explanation);
  assert.match(b.explanation, /A person decides/);
  assert.equal(
    (await h.store.listSelections(owner, h.ws.id, problem.id)).length,
    0,
  );
  const decisions = await h.store.listDecisions(owner, h.ws.id, { runId });
  assert.equal(decisions.length, 1);
  assert.equal(decisions[0]!.reason, 'ethical_judgment');
  // The question was asked by the autopilot, on the owner's authority.
  const asked = await h.db.pool.query(
    `select actor_id, payload from audit_events where action = 'decision.requested'
      and subject_id = $1`,
    [decisions[0]!.id],
  );
  assert.equal(asked.rows[0].actor_id, AUTOPILOT_ACTOR_ID);
  // The ethics question is the person's: choosing by hand under Decide is that answer, and
  // Continue goes on with it (review M-1). A person's choice is not flagged.
  const now = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const mine = await h.store.select(owner, h.ws.id, runId, {
    problem: { id: now.problem.id, version: now.problem.version },
    report_hash: now.report_hash,
    dispositions: now.suitability.candidates.map((c) => ({
      alternative: { id: c.alternative.id, version: c.alternative.version },
      disposition:
        c.alternative.id === target.alternative.id
          ? 'recommend_alternative'
          : 'defer',
      reasons: ['I looked at its ethics (test).'],
      reverse_if: 'New evidence.',
    })),
    override_reason: null,
    rationale: 'I looked at its ethics myself (test).',
    shortlist_size: 3,
    data_class: 'synthetic',
  });
  assert.equal(mine.status, 'recorded', mine.admission.explanation);
  await h.runner.retry(owner, h.ws.id, a.id, { expected_version: b.version });
  await h.runner.settled(a.id);
  const c = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(c.outcome, 'proposal', c.explanation);
  const carriedOn = c.steps.find(
    (s) => s.stage === 'select' && s.state === 'done',
  )!;
  assert.equal(carriedOn.child!.id, mine.selection!.id);
  // Review 3 N-3: the stopped step names the question it left open, and the carried choice
  // says that question is answered by it.
  assert.equal(
    c.steps.filter((s) => s.stage === 'select' && s.state === 'stopped').at(-1)!
      .asked,
    decisions[0]!.id,
  );
  assert.match(carriedOn.note, /leave it to expire/);
});

test('review L-8: an autopilot can start at the choice of a recorded problem, under selection approvals only', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const first = await h.start(await h.run());
  const problem = first.steps[2]!.problem!;
  const runId = await h.run(h.policy(['selection']));
  const c = h.config({ start: { stage: 'select', problem } });
  await rejects(
    'VERSION_CONFLICT',
    h.store.startAutopilot(
      owner,
      h.ws.id,
      runId,
      h.body(
        h.config({
          start: {
            stage: 'select',
            problem: { ...problem, version: problem.version + 1 },
          },
        }),
      ),
    ),
    /now version/,
  );
  const a = await h.start(runId, c);
  assert.deepEqual(
    a.steps.map((s) => [s.stage, s.state]),
    [['select', 'stopped']],
  );
  assert.match(a.explanation, /tie for first/);
  assert.equal(a.calls_reserved, 0);
});

test('a start is refused without routine approvals that cover its steps, with a changed summary, by a non-owner, or beside a running one', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const ws = h.ws.id;
  // No policy at all: it says to turn routine approvals on; an autopilot never approves itself.
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
    h.config({ limits: { max_calls: 8, ends_at: inHours(2) } }),
  );
  assert.equal(tight.outcome, 'limit_reached', tight.explanation);
  assert.match(
    tight.explanation,
    /Find the problem and options needs at least 7 model calls; the autopilot has 6 left/,
  );
  // Review L-3: its own call limit cannot be raised, so Continue is refused with what to do.
  assert.match(tight.steps.at(-1)!.no_retry ?? '', /start a new autopilot/);
  await rejects(
    'INVALID_TRANSITION',
    h.runner.retry(owner, h.ws.id, tight.id, {
      expected_version: tight.version,
    }),
    /cannot be raised/,
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
  // Close the studio before the database is dropped: a driver that is still stopping its step
  // (review L-1 cancels a workflow it started just as Stop came in) must finish first.
  let closed: Promise<void> | null = null;
  const close = () => (closed ??= api.close());
  t.after(close);
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
  await close();
});

test('review 3: the end time passing while a step waits cancels the web search and the workflow', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const realNow = Date.now;
  t.after(() => {
    Date.now = realNow;
  });
  // Web search: the search never finishes; the end time passes during a wait.
  const cancelled: string[] = [];
  const web: AutopilotWeb = {
    start: async () => ({ id: '00000000-0000-4000-8000-0000000000e1' }),
    read: async (_c, _w, id) =>
      ({ id, version: 1, state: 'searching' }) as unknown as WebDiscovery,
    isActive: () => true,
    resume: async () => null,
    cancel: async (_c, _w, id) => {
      cancelled.push(id);
      return null;
    },
  };
  let waits = 0;
  const later = async () => {
    if (++waits === 2) {
      const base = realNow();
      Date.now = () => base + 3 * 3600_000;
    }
  };
  const runner = new AutopilotRunner(h.store, web, {
    pollMs: 5,
    onWait: later,
  });
  const full = h.policy(['research', 'evidence', 'model_work', 'selection'], {
    data_classes: ['public', 'synthetic'],
  });
  const c = h.config({
    research: {
      connection_id: '00000000-0000-4000-8000-0000000000c1',
      model_id: 'gpt-test',
      scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
      input_hash: 'c'.repeat(64),
    },
    limits: { max_calls: 80, ends_at: inHours(2) },
  });
  const a = await runner.start(owner, h.ws.id, await h.run(full), h.body(c));
  await runner.settled(a.id);
  Date.now = realNow;
  const done = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(done.outcome, 'limit_reached', done.explanation);
  assert.deepEqual(cancelled, ['00000000-0000-4000-8000-0000000000e1']);

  // Workflow: exploration never settles; the end time passes during a wait.
  waits = 0;
  const r2 = new AutopilotRunner(h.store, null, { pollMs: 5, onWait: later });
  const b = await r2.start(owner, h.ws.id, await h.run(), h.body(h.config()));
  await r2.settled(b.id);
  Date.now = realNow;
  const late = await h.store.getAutopilot(owner, h.ws.id, b.id);
  assert.equal(late.outcome, 'limit_reached', late.explanation);
  assert.equal(
    (await h.store.getWorkflow(owner, h.ws.id, late.steps[0]!.child!.id))
      .workflow.state,
    'cancelled',
  );
});

test('review 3 L-1: a start at assessment does not carry a choice made on the scores before it', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const first = await h.start(runId);
  const problem = first.steps[2]!.problem!;
  const { selection } = await ownerChooses(h, runId, problem.id);
  const later = await h.start(
    await h.run(),
    h.config({ start: { stage: 'assess', problem } }),
  );
  assert.deepEqual(
    later.steps.map((s) => [s.stage, s.state]),
    [
      ['assess', 'done'],
      ['select', 'stopped'],
    ],
  );
  assert.equal(later.outcome, 'needs_person', later.explanation);
  assert.match(
    later.explanation,
    /made on other scores than the current ones, before this autopilot’s assessment/,
  );
  // The person's choice stays current and untouched.
  const sels = await h.store.listSelections(owner, h.ws.id, problem.id);
  assert.deepEqual(
    sels.map((x) => [x.id, x.current]),
    [[selection.id, true]],
  );
});

test('review 4 L-1: a start at assessment does not end on an older choice that advanced nothing', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const first = await h.start(runId);
  const problem = first.steps[2]!.problem!;
  // The person defers every option under Decide.
  const rep = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const out = await h.store.select(owner, h.ws.id, runId, {
    problem: { id: rep.problem.id, version: rep.problem.version },
    report_hash: rep.report_hash,
    dispositions: rep.suitability.candidates.map((c) => ({
      alternative: { id: c.alternative.id, version: c.alternative.version },
      disposition: 'defer',
      reasons: ['Not yet (test).'],
      reverse_if: 'New evidence.',
    })),
    override_reason: null,
    rationale: 'Deferring all (test).',
    shortlist_size: 3,
    data_class: 'synthetic',
  });
  assert.equal(out.status, 'recorded', out.admission.explanation);
  const later = await h.start(
    await h.run(),
    h.config({ start: { stage: 'assess', problem } }),
  );
  assert.deepEqual(
    later.steps.map((s) => [s.stage, s.state]),
    [
      ['assess', 'done'],
      ['select', 'stopped'],
    ],
  );
  // It asks the person to look again at the new scores, and Continue stays open.
  assert.equal(later.outcome, 'needs_person', later.explanation);
  assert.match(
    later.explanation,
    /Your choice under Decide was made on other scores than the current ones, before this autopilot’s assessment/,
  );
  assert.ok(autopilotContinuable(later).ok);
  const sels = await h.store.listSelections(owner, h.ws.id, problem.id);
  assert.deepEqual(
    sels.map((x) => [x.id, x.current]),
    [[out.selection!.id, true]],
  );
});

test('review 4 N-1: a choice made at another shortlist size is checked at that size and carried on', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const first = await h.start(runId);
  const problem = first.steps[2]!.problem!;
  const { target, selection } = await ownerChooses(
    h,
    runId,
    problem.id,
    'use_existing',
    4,
  );
  assert.equal(selection.report.suitability.sensitivity.shortlist_size, 4);
  const later = await h.start(
    await h.run(h.policy(['selection'])),
    h.config({ start: { stage: 'select', problem } }),
  );
  assert.equal(later.outcome, 'proposal', later.explanation);
  assert.equal(later.steps[0]!.child!.id, selection.id);
  assert.equal(later.steps[0]!.option!.id, target.alternative.id);
});
