import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import {
  AUTOPILOT_SETTINGS_DEFAULT,
  cutWords,
  PROPOSAL_DRAFTABLE_SECTIONS,
  type ProposalSectionDraft,
  MODEL_ONLY_ETHICS_NOTE,
  autopilotMaySearch,
  autopilotNextSteps,
  autopilotRoutinePolicy,
  handsOff,
  isHandsOff,
  handsOffMissing,
  AUTOPILOT_SETTING_TEXT,
  settingIsOn,
  settingOn,
  AUTOPILOT_MIN_CALLS,
  AutopilotConfigSchema,
  AutopilotSchema,
  autopilotContinuable,
  autopilotPlannedStages,
  stopsOnOpenRequest,
  autopilotEndsApprovals,
  ContractError,
  WebDiscoveryScopeSchema,
  autopilotSummary,
  routinePolicySummary,
  type AutopilotConfig,
  type AutopilotStage,
  type AutopilotStep,
  type ErrorCode,
  type ExplorationResult,
  type RankedCandidate,
  type RoutinePolicyInput,
  type ScorecardBody,
  type Selection,
  type SelectionReport,
  type WebDiscovery,
  ExplorationResultSchema,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  autopilotChildLimits,
  autopilotChoice,
  scenarioWords,
  autopilotProblem,
  checkSelection,
  notAdmitted,
  nextAutopilotStage,
  personChoice,
  pickExplored,
  refusalOutcome,
  suggestClaims,
} from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { AUTOPILOT_ACTOR_ID, ConnectionStore, FileStore } from '@creator/db';
import {
  AutopilotRunner,
  DEFAULT_OWNER_ACTOR_ID,
  autopilotKey,
  capAlso,
  createApi,
  failedNote,
  fitNote,
  gatherQuestion,
  namesOf,
  nextGatherQuestion,
  refusalKind,
  refusalStop,
  AUTO_CLOSE_MAX,
  stalledNote,
  spentCandidates,
  spentSettled,
  trimSpent,
  unknownCount,
  type SpentDetail,
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
      /cost counts double/.test(unstable.reason),
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
  // Review 1 of #213, H-1: past its end time it cannot continue (the server says EXPIRED),
  // so the Autopilot page and its nav count stop offering it. The approvals rule ignores it.
  const limits = (endsAt: string) => ({
    config: {
      limits: { max_calls: 40, ends_at: endsAt },
    } as AutopilotConfig,
  });
  const T = Date.parse('2026-11-15T12:00:00Z');
  const ended = { ...finished, ...limits('2026-11-15T11:59:59Z') };
  const expired = autopilotContinuable(ended, T);
  assert.ok(
    !expired.ok &&
      expired.reason === 'Its end time has passed; start a new autopilot.',
  );
  assert.ok(
    autopilotContinuable({ ...finished, ...limits('2026-11-15T12:00:01Z') }, T)
      .ok,
  );
  assert.equal(autopilotEndsApprovals(ended), false);
  // The server reads its next steps at the real time, so this end time is long past.
  const endedNext = autopilotNextSteps({
    ...ended,
    ...limits('2020-01-01T00:00:00Z'),
    steps: [{ ...step('select', 'stopped'), stop_kind: 'tie' }],
  });
  assert.ok(!endedNext.some((n) => n.kind === 'allow_and_continue'));
  assert.ok(!endedNext.some((n) => n.kind === 'continue'));
  assert.ok(endedNext.some((n) => n.kind === 'new_autopilot'));
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
  // ADR-0101: a stand-in for the chat model's section drafts, recording what was asked.
  const drafted: { proposalId: string; body: Record<string, unknown> }[] = [];
  let draftReply: (
    body: Record<string, unknown>,
  ) => Promise<ProposalSectionDraft> = async (body) =>
    ({
      id: randomUUID(),
      state: 'completed',
      model_id: 'chat-test-model',
      values: {
        objectives: { state: 'written', text: 'Suggested: fewer no-shows.' },
      },
      sections: body.sections,
      reason: null,
    }) as unknown as ProposalSectionDraft;
  const runner = new AutopilotRunner(store, null, {
    pollMs: 5,
    onWait: () => s.worker.settle(),
    drafts: async (_ctx, _ws, proposalId, body) => {
      drafted.push({ proposalId, body: body as Record<string, unknown> });
      return draftReply(body as Record<string, unknown>);
    },
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
  return {
    ...s,
    store,
    runner,
    run,
    policy,
    config,
    body,
    start,
    seed,
    drafted,
    replyWith: (f: typeof draftReply) => {
      draftReply = f;
    },
  };
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
  // Each step kept its exact request and key; a finished step keeps only the calls its work
  // used (live rerun, November 15), never more than it set aside, and they add up within the limit.
  for (const s of a.steps.filter((x) =>
    ['explore', 'discover', 'assess'].includes(x.stage),
  )) {
    assert.ok(s.request && s.key && s.child?.kind === 'workflow');
    const detail = await h.store.getWorkflow(owner, h.ws.id, s.child.id);
    const used = Math.max(
      detail.usage.attempts,
      detail.subscription_usage?.requests ?? 0,
    );
    assert.equal(
      s.calls,
      Math.min(used, (s.request.limits as { max_calls: number }).max_calls),
    );
  }
  assert.ok(
    a.steps.some(
      (s) =>
        s.request?.limits &&
        s.calls < (s.request.limits as { max_calls: number }).max_calls,
    ),
    'a step that used less than its worst case gave the rest back',
  );
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
  // ADR-0101 (P-5): with the owner's setting on, the autopilot asks for drafts of the saved
  // proposal's unknown plan sections.
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...AUTOPILOT_SETTINGS_DEFAULT, draft_proposal_sections: true },
  });
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
  // It asked once, for exactly the draftable sections still unknown in version 1, and only
  // reports the drafts: the proposal is unchanged until a person uses them.
  assert.equal(h.drafted.length, 1);
  assert.equal(h.drafted[0]!.proposalId, proposal.id);
  assert.equal(h.drafted[0]!.body.version, 1);
  // Review 1 L-2: the request was one call of the autopilot's own limit.
  assert.equal(b.steps[6]!.calls, 1);
  assert.match(String(h.drafted[0]!.body.client_id), /^[0-9a-f-]{36}$/);
  assert.deepEqual(
    h.drafted[0]!.body.sections,
    PROPOSAL_DRAFTABLE_SECTIONS.filter(
      (k) => detail.proposal.body.sections[k].state === 'unknown',
    ),
  );
  assert.ok((h.drafted[0]!.body.sections as string[]).length > 0);
  assert.equal(detail.proposal.version, 1);
  assert.match(
    b.steps[6]!.note,
    /chat-test-model drafted Objectives; each draft waits under its section until a person uses it/,
  );
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
    accept: async () => null,
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
  // ADR-0101: with the drafting setting off, the chat model is not asked.
  assert.equal(h.drafted.length, 0);
  assert.doesNotMatch(b.steps.at(-1)!.note, /chat model|drafted [A-Z]/);
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
  // ADR-0101: a refused draft request never stops the autopilot; the proposal is saved and the
  // step says why nothing was drafted.
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...AUTOPILOT_SETTINGS_DEFAULT, draft_proposal_sections: true },
  });
  h.replyWith(async () => {
    throw new ContractError('ACCESS_DENIED', 'Chat answers are turned off.');
  });
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
  assert.equal(h.drafted.length, 1);
  assert.match(
    c.steps.at(-1)!.note,
    /The chat model was not asked to draft its missing sections: Chat answers are turned off/,
  );
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
  // The exploration gives back the call it set aside but did not use (live rerun, November 15),
  // so finding the problem and options fits; assessing them then does not.
  assert.equal(tight.steps[0]!.calls, 1);
  assert.match(
    tight.explanation,
    /Assess the options needs at least 3 model calls; the autopilot has 0 left/,
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
      ['discover', 'done'],
      ['assess', 'stopped'],
    ],
  );
  // Nothing was started for the step that did not fit.
  assert.equal(tight.steps[3]!.child, null);
  const wfs = await h.store.listWorkflows(owner, h.ws.id, { runId });
  assert.equal(wfs.length, 2, 'only the exploration and discovery ran');
  assert.equal(tight.calls_reserved, 8);
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
    accept: async () => null,
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
    accept: async () => null,
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

test('ADR-0101 review 1 L-2: Stop does not wait for the chat model’s section drafts', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const first = await h.start(runId);
  const problem = first.steps[2]!.problem!;
  await ownerChooses(h, runId, problem.id, 'use_existing');
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...AUTOPILOT_SETTINGS_DEFAULT, draft_proposal_sections: true },
  });
  // The chat model never answers while the autopilot waits.
  let answer: (d: ProposalSectionDraft) => void = () => undefined;
  h.replyWith(
    () =>
      new Promise<ProposalSectionDraft>((resolve) => {
        answer = resolve;
      }),
  );
  const a = await h.runner.start(
    owner,
    h.ws.id,
    await h.run(h.policy(['selection'])),
    h.body(h.config({ start: { stage: 'select', problem } })),
  );
  await until(async () => h.drafted.length === 1);
  await h.runner.cancel(owner, h.ws.id, a.id, { reason: 'Test stop.' });
  const done = await Promise.race([
    h.runner.settled(a.id).then(() => true),
    new Promise<false>((r) => setTimeout(() => r(false), 5000)),
  ]);
  assert.ok(done, 'Stop waited for the draft reply');
  assert.equal(
    (await h.store.getAutopilot(owner, h.ws.id, a.id)).state,
    'finished',
  );
  answer({ state: 'failed' } as ProposalSectionDraft);
});

// ---- ADR-0100: the owner's autopilot settings and planned fallbacks ----------------------------

const OFF = AUTOPILOT_SETTINGS_DEFAULT;
const ranged = (lower: number, upper: number) => ({
  lower: score(lower),
  upper: score(upper),
});

test('ADR-0100: settings let the choice rule go past a stop, and the request it makes passes the selection checks', () => {
  // Unknown ratings: stop by default; with the worst case, the best lower end is chosen.
  const unknowns = report([
    cand('a', 'use_existing', null, {
      range: ranged(2, 5),
      unknown_criteria: ['maintenance_burden'],
    }),
    cand('b', 'change_process', 1, { range: ranged(3, 3) }),
  ]);
  const stop = autopilotChoice(unknowns, OFF);
  assert.ok(!stop.ok);
  assert.equal(stop.kind, 'unknown_ratings');
  assert.deepEqual(
    stop.options?.map((o) => o.id),
    ['a'],
  );
  const worst = autopilotChoice(unknowns, {
    ...OFF,
    choose_with_unknowns: true,
  });
  assert.ok(worst.ok);
  assert.equal(worst.option.id, 'b');
  assert.equal(worst.fallbacks[0]!.setting, 'choose_with_unknowns');
  assert.ok(worst.request.override_reason);
  const check = checkSelection(unknowns, worst.request);
  assert.deepEqual(check.invalid, []);
  assert.equal(check.override_reason_missing, false);
  // A partly scored option whose worst case is best is chosen past a fully scored one; the
  // request names the override (the fully scored one ranks above it).
  const past = report([
    cand('a', 'use_existing', null, {
      range: ranged(4, 5),
      unknown_criteria: ['stakeholder_acceptability'],
    }),
    cand('b', 'change_process', 1, { range: ranged(3, 3) }),
  ]);
  const p = autopilotChoice(past, { ...OFF, choose_with_unknowns: true });
  assert.ok(p.ok);
  assert.equal(p.option.id, 'a');
  assert.equal(checkSelection(past, p.request).override_reason_missing, false);

  // A tie: stops by default; break_ties uses the opportunity rank.
  const tie = report(
    [cand('a', 'use_existing', 1), cand('b', 'change_process', 1)],
    [cand('a', 'use_existing', 2), cand('b', 'change_process', 1)],
  );
  const t1 = autopilotChoice(tie, OFF);
  assert.ok(!t1.ok);
  assert.equal(t1.kind, 'tie');
  const t2 = autopilotChoice(tie, { ...OFF, break_ties: true });
  assert.ok(t2.ok);
  assert.equal(t2.option.id, 'b');
  assert.match(t2.fallbacks[0]!.note, /fixed order/);
  // ADR-0139: a tie the scores cannot separate goes to the option that builds least, then
  // the title (whatever order the report lists them in).
  const least = autopilotChoice(
    report([
      cand('s', 'build', 1),
      cand('h', 'hybrid', 1),
      cand('p', 'change_process', 1),
    ]),
    { ...OFF, break_ties: true },
  );
  assert.ok(least.ok);
  assert.equal(least.option.id, 'p');
  assert.match(least.fallbacks[0]!.note, /builds least/);
  const byTitle = autopilotChoice(
    report([
      cand('b', 'use_existing', 1, {
        alternative: {
          id: 'b',
          version: 1,
          kind: 'use_existing',
          title: 'Beta',
        },
      }),
      cand('a', 'use_existing', 1, {
        alternative: {
          id: 'a',
          version: 1,
          kind: 'use_existing',
          title: 'Alpha',
        },
      }),
    ]),
    { ...OFF, break_ties: true },
  );
  assert.ok(byTitle.ok);
  assert.equal(byTitle.option.id, 'a');
  // Only options alike in every rule (kind and title too) still stop.
  const flat = autopilotChoice(
    report([
      cand('a', 'use_existing', 1, {
        alternative: {
          id: 'a',
          version: 1,
          kind: 'use_existing',
          title: 'Same',
        },
      }),
      cand('b', 'use_existing', 1, {
        alternative: {
          id: 'b',
          version: 1,
          kind: 'use_existing',
          title: 'Same',
        },
      }),
    ]),
    { ...OFF, break_ties: true },
  );
  assert.ok(!flat.ok);
  assert.equal(flat.kind, 'tie');

  // A close ranking: kept with keep_close_leader.
  const close = report(
    [cand('a', 'use_existing', 1), cand('b', 'change_process', 2)],
    [],
    true,
  );
  const c1 = autopilotChoice(close, OFF);
  assert.ok(!c1.ok);
  assert.equal(c1.kind, 'close_ranking');
  const c2 = autopilotChoice(close, { ...OFF, keep_close_leader: true });
  assert.ok(c2.ok);
  assert.equal(c2.option.id, 'a');

  // A blocked first option: the next one the rule may advance, with an override reason.
  const blocked = report([
    cand('a', 'use_existing', 1, {
      gates: {
        ethics_access: 'unresolved',
        discovery: 'candidate',
        humility: 'not_applicable',
        blocked: { recommend_alternative: ['The ethics gate is open.'] },
      },
    }),
    cand('b', 'change_process', 2),
  ]);
  const b1 = autopilotChoice(blocked, OFF);
  assert.ok(!b1.ok);
  assert.equal(b1.kind, 'gate_blocked');
  // Live rerun 3: the choice reads as a verb, and a long gate reason keeps the last sentence.
  assert.match(b1.reason, /ranks first but cannot be recommended yet/);
  const longGate = report([
    cand('a', 'use_existing', 1, {
      gates: {
        ethics_access: 'unresolved',
        discovery: 'candidate',
        humility: 'not_applicable',
        blocked: {
          recommend_alternative: [
            'Access: ' + 'staff time is missing '.repeat(60),
          ],
        },
      },
    }),
  ]);
  const g1 = autopilotChoice(longGate, OFF);
  assert.ok(!g1.ok);
  assert.match(g1.reason, /\w… Resolve it/);
  assert.match(
    g1.reason,
    /Resolve it, or choose under Decide yourself, then continue\.$/,
  );
  const b2 = autopilotChoice(blocked, { ...OFF, next_candidate: true });
  assert.ok(b2.ok);
  assert.equal(b2.option.id, 'b');
  assert.ok(b2.request.override_reason);
  assert.equal(
    b2.request.dispositions.find((d) => d.alternative.id === 'a')!.disposition,
    'defer',
  );
  assert.equal(
    checkSelection(blocked, b2.request).override_reason_missing,
    false,
  );
  // A decline ranked first is the honest result, never skipped.
  const decline = autopilotChoice(
    report([cand('a', 'decline', 1), cand('b', 'change_process', 2)]),
    { ...OFF, next_candidate: true },
  );
  assert.ok(!decline.ok);
  assert.equal(decline.outcome, 'no_eligible_option');

  // Hands-off turns on every fallback except the ethics switch.
  const h = handsOff(OFF);
  assert.equal(h.choose_model_ethics, false);
  // ADR-0101: asking the chat model for proposal drafts is part of Hands-off.
  assert.equal(h.draft_proposal_sections, true);
  assert.ok(isHandsOff(h));
  assert.equal(
    handsOff({ ...OFF, choose_model_ethics: true }).choose_model_ethics,
    true,
  );
  assert.deepEqual(settingOn(OFF, 'gather_evidence'), {
    ...OFF,
    gather_evidence: true,
    max_extra_searches: 1,
  });
});

test('ADR-0100: steps are sized from what is left of the per-run cap; next steps name the setting', () => {
  const base = {
    stage: 'assess' as const,
    route: 'subscription' as const,
    timeout_ms: 60_000,
    per_run: 10,
    remaining: 30,
    seconds_left: 3600,
    width: 2,
  };
  const ok = autopilotChildLimits({ ...base, per_run_used: 6 });
  assert.ok(ok.ok);
  assert.equal(ok.calls, 4);
  const capped = autopilotChildLimits({ ...base, per_run_used: 8 });
  assert.ok(!capped.ok);
  assert.equal(capped.kind, 'run_cap');
  assert.match(
    capped.reason,
    /used 8 of the plan connection's 10 requests per run/,
  );
  assert.equal(capped.final, undefined);

  // The exploration's next candidate, then none left.
  const r = {
    candidates: [
      { ref: 'E1', title: 'one', disposition: 'candidate', claims: [] },
      { ref: 'E2', title: 'dup', disposition: 'duplicate', claims: [] },
      { ref: 'E3', title: 'three', disposition: 'candidate', claims: [] },
    ],
  } as unknown as ExplorationResult;
  const second = pickExplored(r, 1);
  assert.ok(second.ok);
  assert.equal(second.ref, 'E3');
  assert.equal(pickExplored(r, 2).ok, false);

  const stopped = (kind: AutopilotStep['stop_kind']) => ({
    state: 'finished' as const,
    outcome: 'needs_person' as const,
    steps: [{ ...step('select', 'stopped'), stop_kind: kind }],
  });
  const tie = autopilotNextSteps(stopped('tie'));
  assert.equal(tie[0]!.kind, 'allow_and_continue');
  assert.equal(tie[0]!.setting, 'break_ties');
  assert.ok(tie.some((n) => n.kind === 'decide'));
  // A stop no setting covers offers its own next step only.
  const cap = autopilotNextSteps({
    ...stopped('run_cap'),
    outcome: 'limit_reached',
  });
  assert.deepEqual(
    cap.map((n) => n.kind),
    ['models'],
  );
  // Continue cannot get past a spec: no allow, and a new autopilot is suggested.
  const spec = autopilotNextSteps({
    state: 'finished',
    outcome: 'needs_person',
    steps: [
      { ...step('spec', 'stopped'), stop_kind: 'spec', no_retry: 'Yours.' },
    ],
  });
  assert.ok(!spec.some((n) => n.kind === 'allow_and_continue'));
  assert.ok(spec.some((n) => n.kind === 'spec'));
});

test('ADR-0100: a web search the settings allow is covered by the run’s approvals only on a plan route with public data', () => {
  const c = AutopilotConfigSchema.parse({
    resource_setup: {
      kind: 'subscription',
      connection_id: '00000000-0000-4000-8000-0000000000c1',
      model_id: 'm',
      settings_hash: 'a'.repeat(64),
      max_output_chars: 16000,
    },
    data_class: 'public',
    limits: { max_calls: 30, ends_at: inHours(2) },
  });
  assert.deepEqual(autopilotRoutinePolicy(c, null).stages, [
    'model_work',
    'selection',
  ]);
  assert.deepEqual(
    autopilotRoutinePolicy(c, null, { gatherSearch: true }).stages,
    ['evidence', 'model_work', 'research', 'selection'],
  );
  assert.equal(
    autopilotMaySearch({ ...c, data_class: 'private_approved' }, true),
    false,
  );
  assert.equal(
    autopilotMaySearch(
      { ...c, start: { stage: 'select', problem: { id: 'p', version: 1 } } },
      true,
    ),
    false,
  );
});

test('ADR-0100: the server copy of the claim suggestion rule matches the web’s', async () => {
  const source = readFileSync('apps/web/src/claim-suggest.ts', 'utf8');
  const start = source.indexOf('export type SuggestableClaim');
  const end = source.indexOf(
    "/** Whether a claim's title or statement contains",
  );
  const server = readFileSync('packages/domain/src/claim-suggest.ts', 'utf8');
  // Same rule, apart from the server's generic claim type.
  const norm = (s: string) =>
    s
      .replace('<C extends SuggestableClaim>', '')
      .replace('claims: readonly C[]', 'claims: readonly SuggestableClaim[]')
      .replace('): C[] {', '): SuggestableClaim[] {')
      .trim();
  assert.equal(
    norm(server.slice(server.indexOf('export type SuggestableClaim'))),
    norm(source.slice(start, end)),
  );
  assert.deepEqual(
    suggestClaims({ title: 'csvkit statistics' }, [
      { id: 'a', title: 'csvkit csvstat', text: 'per-column statistics' },
      { id: 'b', title: 'OpenRefine', text: 'needs Java' },
    ]).map((x) => x.id),
    ['a'],
  );
});

test('ADR-0101 review 1 L-3: Hands-off saved before drafting joined it reads as off, naming only drafting', async (t) => {
  const h = await setup(t);
  if (!h) return;
  // A row saved by the November 14 build with #193: Hands-off, without the drafting switch.
  const { draft_proposal_sections: _, ...before } = handsOff(OFF);
  await h.db.pool.query(
    `insert into autopilot_settings (workspace_id, settings, version, updated_by)
     values ($1, $2, 1, $3)`,
    [h.ws.id, JSON.stringify(before), owner.actorId],
  );
  const s = await h.store.autopilotSettings(owner, h.ws.id);
  assert.equal(s.values.draft_proposal_sections, false);
  assert.ok(!isHandsOff(s.values));
  assert.deepEqual(handsOffMissing(s.values), ['draft_proposal_sections']);
  assert.match(
    AUTOPILOT_SETTING_TEXT.draft_proposal_sections.text,
    /Part of Hands-off since November 14, 2026/,
  );
  // Nothing else of the saved Hands-off changed.
  assert.deepEqual(handsOff(s.values), {
    ...s.values,
    draft_proposal_sections: true,
  });
});

test('ADR-0100: only the owner saves the settings, by named version, audited; an autopilot never does', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const s0 = await h.store.autopilotSettings(owner, h.ws.id);
  assert.equal(s0.version, 0);
  assert.deepEqual(s0.values, AUTOPILOT_SETTINGS_DEFAULT);
  assert.equal(s0.can_change, true);
  const s1 = await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: handsOff(OFF),
  });
  assert.equal(s1.version, 1);
  assert.ok(isHandsOff(s1.values));
  await rejects(
    'VERSION_CONFLICT',
    h.store.saveAutopilotSettings(owner, h.ws.id, {
      expected_version: 0,
      values: OFF,
    }),
  );
  await rejects(
    'HUMAN_ONLY_DENIED',
    h.store.saveAutopilotSettings(
      { ...owner, autopilot: { id: '00000000-0000-4000-8000-0000000000e1' } },
      h.ws.id,
      { expected_version: 1, values: OFF },
    ),
  );
  const audit = await h.db.pool.query(
    `select payload from audit_events where action = 'autopilot_settings.saved'
      and workspace_id = $1`,
    [h.ws.id],
  );
  assert.equal(audit.rowCount, 1);
  assert.equal(audit.rows[0].payload.after.gather_evidence, true);
});

test('ADR-0100: discovery links the claims each option cites; a tie stop offers Allow and continue, which saves the setting and continues in one step', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  // Gathering evidence on (no searches: this autopilot uses an API route) links cited claims.
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...OFF, gather_evidence: true, max_extra_searches: 1 },
  });
  const runId = await h.run();
  const a = await h.start(runId);
  assert.equal(a.outcome, 'needs_person', a.explanation);
  const last = a.steps.at(-1)!;
  assert.equal(last.stop_kind, 'tie');
  const view = h.runner.with(a);
  assert.equal(view.next?.[0]?.setting, 'break_ties');
  // Each option's cited packet claims now support it (the assessor reads them).
  const problem = a.steps.find((s) => s.stage === 'discover')!.problem!;
  const cited = await h.db.pool.query(
    `select l.to_id from entity_links l
       join entity_links o on o.from_id = l.to_id and o.to_id = $2 and o.relation = 'derived_from'
      where l.workspace_id = $1 and l.relation = 'supports' and l.to_kind = 'alternative'
        and l.rationale like 'Cited by P%'`,
    [h.ws.id, problem.id],
  );
  assert.ok(cited.rowCount! > 0, 'options got their cited claims');

  // A stale settings version is refused and changes nothing.
  await rejects(
    'VERSION_CONFLICT',
    h.runner.allowAndContinue(owner, h.ws.id, a.id, {
      expected_version: a.version,
      settings_version: 7,
      setting: 'break_ties',
    }),
  );
  // A setting this stop does not name is refused.
  await rejects(
    'INVALID_CONTRACT',
    h.runner.allowAndContinue(owner, h.ws.id, a.id, {
      expected_version: a.version,
      settings_version: 1,
      setting: 'choose_model_ethics',
    }),
  );
  assert.equal((await h.store.autopilotSettings(owner, h.ws.id)).version, 1);
  const b = await h.runner.allowAndContinue(owner, h.ws.id, a.id, {
    expected_version: a.version,
    settings_version: 1,
    setting: 'break_ties',
  });
  assert.equal(b.state, 'running');
  await h.runner.settled(a.id);
  const s = await h.store.autopilotSettings(owner, h.ws.id);
  assert.equal(s.version, 2);
  assert.equal(s.values.break_ties, true);
  const cont = await h.db.pool.query(
    `select payload from audit_events where action = 'autopilot.continued' and subject_id = $1`,
    [a.id],
  );
  assert.equal(cont.rows[0].payload.allowed, 'break_ties');
  // The fixture rates every option the same; since ADR-0139 the fixed order still puts one
  // first, and the fixture's discovery did not recommend it, so it stops there instead.
  const c = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(c.steps.at(-1)!.stop_kind, 'not_advanceable', c.explanation);
  assert.match(c.explanation, /not advanced/);
});

test('ADR-0139: when everything an exploration finds is already recorded, "Try the next candidate" goes on with the recorded problem', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  // The first autopilot records a problem; then an option of it repeats each card the fixture
  // explorer writes (as in the audit's phase A, where every card repeated a recorded one).
  const first = await h.start(await h.run());
  const problem = first.steps[2]!.problem!;
  const ex = await h.store.getWorkflow(
    owner,
    h.ws.id,
    first.steps[0]!.child!.id,
  );
  const cards = ExplorationResultSchema.parse(
    ex.workflow.result?.exploration,
  ).candidates;
  assert.ok(cards.length);
  for (const c of cards) {
    const alt = await h.store.createEntity(owner, h.ws.id, {
      kind: 'alternative',
      title: c.card.title,
      body: {
        kind: 'use_existing',
        rationale: c.card.observable_pain,
        tradeoffs: ['Test option.'],
        uncertainty: 'Test option.',
      },
    });
    await h.store.createLink(owner, h.ws.id, {
      relation: 'derived_from',
      from: { id: alt.id, version: alt.version },
      to: problem,
      rationale: 'Repeats an explorer card.',
    });
  }
  // Off: a second autopilot finds only repeats and stops at thin evidence.
  const off = await h.start(await h.run());
  assert.equal(off.steps.at(-1)!.stop_kind, 'thin_evidence', off.explanation);
  assert.match(off.explanation, /duplicate/);
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...AUTOPILOT_SETTINGS_DEFAULT, next_candidate: true },
  });
  const on = await h.start(await h.run());
  assert.deepEqual(
    on.steps.map((s) => [s.stage, s.state]),
    [
      ['explore', 'done'],
      ['assess', 'done'],
      ['select', 'stopped'],
    ],
    on.explanation,
  );
  const explore = on.steps[0]!;
  const recorded = (
    await h.store.getEntity(owner, h.ws.id, explore.problem!.id)
  ).entity;
  assert.equal(recorded.id, problem.id);
  assert.equal(recorded.status, 'active');
  assert.equal(explore.fallback?.setting, 'next_candidate');
  assert.equal(explore.fallback?.instead_of, 'thin_evidence');
  assert.match(explore.note, /already recorded as the problem/);
  assert.equal(on.steps[1]!.problem?.id, recorded.id);
  assert.deepEqual(autopilotProblem(on.config, on.steps), on.steps[1]!.problem);
});

test('ADR-0100: with the owner’s ethics setting on, the autopilot chooses past model-only ethics and flags it on the selection and proposal', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  await h.store.setGateRule(owner, h.ws.id, {
    expected_version: 0,
    mode: 'model',
  });
  const runId = await h.run();
  const a = await h.start(runId);
  const problem = a.steps[2]!.problem!;
  const rep = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const target = rep.suitability.candidates.find(
    (c) => c.alternative.kind === 'use_existing',
  )!;
  await personScores(
    h,
    problem.id,
    (c) => c.alternative.id !== target.alternative.id,
    1,
  );
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: {
      ...OFF,
      choose_model_ethics: true,
      draft_proposal_sections: true,
    },
  });
  // ADR-0101 review 1 L-4: a person's draft already on its way comes back in place of a new
  // one, and the note says so instead of calling it a failure.
  h.replyWith(
    async (body) =>
      ({
        id: randomUUID(),
        state: 'pending',
        model_id: 'chat-test-model',
        values: {},
        sections: body.sections,
        reason: null,
      }) as unknown as ProposalSectionDraft,
  );
  await h.runner.retry(owner, h.ws.id, a.id, { expected_version: a.version });
  await h.runner.settled(a.id);
  const b = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(b.outcome, 'proposal', b.explanation);
  assert.equal(h.drafted.length, 1);
  assert.match(
    b.steps.at(-1)!.note,
    /A draft of its missing sections was already on its way; it will appear under the sections/,
  );
  assert.doesNotMatch(b.steps.at(-1)!.note, /failed/);
  const sel = (await h.store.listSelections(owner, h.ws.id, problem.id)).find(
    (x) => x.current,
  )!;
  assert.ok(sel.autopilot_id);
  assert.ok(sel.rationale.startsWith(MODEL_ONLY_ETHICS_NOTE));
  const chosen = b.steps.find(
    (s) => s.stage === 'select' && s.state === 'done',
  )!;
  assert.equal(chosen.fallback?.setting, 'choose_model_ethics');
  const decisions = await h.store.listDecisions(owner, h.ws.id, { runId });
  assert.equal(decisions.length, 0, 'no ethics question was asked');
  const recorded = await h.db.pool.query(
    `select payload from audit_events where action = 'selection.recorded' and subject_id = $1`,
    [sel.id],
  );
  assert.equal(recorded.rows[0].payload.model_only_ethics, true);
  const proposal = b.steps.at(-1)!.child!;
  const made = await h.store.getEntity(owner, h.ws.id, proposal.id);
  assert.match(
    (made.entity.body as { summary: string }).summary,
    /^Ethics checked by the model only/,
  );
});

test('ADR-0100: thin evidence gathers with the explorer’s questions up to the search limit, then stops saying what it tried; the autopilot’s links are its own', async (t) => {
  const h = await setup(t);
  if (!h) return;
  // No claims at all: exploration finds no candidate.
  const started: { scope: { question: string | null } }[] = [];
  let n = 0;
  const web: AutopilotWeb = {
    accept: async () => null,
    start: async (_ctx, _ws, _run, body) => {
      started.push(body as never);
      return { id: `00000000-0000-4000-8000-0000000000f${++n}` };
    },
    read: async (_c, _w, id) =>
      ({
        id,
        version: 1,
        state: 'done',
        explanation: 'Read 1 page.',
        proposals: [{ decision: 'admitted', check: 'verified' }],
      }) as unknown as WebDiscovery,
    isActive: () => true,
    resume: async () => null,
    cancel: async () => null,
  };
  const runner = new AutopilotRunner(h.store, web, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  // An API route cannot search the web: the stop says so instead of gathering.
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...handsOff(OFF), max_extra_searches: 2 },
  });
  const runId = await h.run();
  const a = await runner.start(owner, h.ws.id, runId, h.body(h.config()));
  await runner.settled(a.id);
  const done = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(done.outcome, 'insufficient_evidence', done.explanation);
  assert.equal(done.steps.at(-1)!.stop_kind, 'thin_evidence');
  assert.match(
    done.explanation,
    /could not gather more evidence: Web search runs only on a ChatGPT plan connection/,
  );
  assert.equal(started.length, 0);
  // With a search route (the autopilot's own research connection), it gathers once per allowed
  // search, then stops with what it tried. A search adds what the run's approvals admit (the
  // stand-in admits one claim each time, but records none, so exploring finds nothing again).
  const research = {
    connection_id: '00000000-0000-4000-8000-0000000000c1',
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const full = h.policy(['research', 'evidence', 'model_work', 'selection'], {
    data_classes: ['public', 'synthetic'],
  });
  const runId2 = await h.run(full);
  const b = await runner.start(
    owner,
    h.ws.id,
    runId2,
    h.body(
      h.config({
        research,
        explore: { ...h.config().explore, interests: ['volunteers'] },
      }),
    ),
  );
  await runner.settled(b.id);
  const g = await h.store.getAutopilot(owner, h.ws.id, b.id);
  const gathers = g.steps.filter((s) => s.stage === 'gather');
  assert.equal(
    gathers.length,
    2,
    JSON.stringify(g.steps.map((s) => [s.stage, s.state, s.note])),
  );
  assert.ok(gathers.every((s) => s.calls === 2 && s.request?.question));
  assert.equal(started.length, 3, 'the research step and two gather searches');
  const explores = g.steps.filter((s) => s.stage === 'explore');
  assert.ok(explores.every((s) => s.state === 'stopped'));
  assert.equal(explores[0]!.fallback?.setting, 'gather_evidence');
  assert.equal(explores.at(-1)!.stop_kind, 'thin_evidence');
  assert.equal(g.outcome, 'insufficient_evidence');
  assert.match(g.explanation, /2 of the 2 extra web searches/);
  // Every step has its own key, including the second exploration.
  const keys = g.steps.map((s) => s.key).filter(Boolean);
  assert.equal(new Set(keys).size, keys.length);
});

test('ADR-0100: linking suggested claims is the autopilot’s, audited, and never repeats a link', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const a = await h.start(runId);
  const problem = a.steps.find((s) => s.stage === 'discover')!.problem!;
  const rep = await h.store.selectionReport(owner, h.ws.id, problem.id);
  const opt = rep.suitability.candidates[0]!.alternative;
  // A recorded claim that names the option, with no source fetched from the web behind it.
  const note = await h.store.createEntity(owner, h.ws.id, {
    kind: 'claim',
    title: `${opt.title} works for this`,
    body: {
      statement: `${opt.title} handles the problem well.`,
      basis: 'observation',
      uncertainty: 'test',
    },
  });
  const ap = { ...owner, autopilot: { id: a.id } };
  // Review 1 L-5: on public or synthetic data it is never linked unattended.
  const pub = await h.store.autopilotLinkClaims(
    ap,
    h.ws.id,
    problem.id,
    [opt.id],
    'synthetic',
  );
  assert.ok(pub.every((m) => m.claim_id !== note.id));
  // An autopilot on approved private data may link it.
  const made = await h.store.autopilotLinkClaims(
    ap,
    h.ws.id,
    problem.id,
    [opt.id],
    'approved_private',
  );
  assert.ok(made.some((m) => m.to_id === opt.id && m.claim_id === note.id));
  const again = await h.store.autopilotLinkClaims(
    ap,
    h.ws.id,
    problem.id,
    [opt.id],
    'approved_private',
  );
  assert.equal(again.filter((m) => m.to_id === opt.id).length, 0);
  // Re-review 2 N-5: on public data, a claim backed only by sources fetched from the web is
  // linked. The new claim takes a copy of a seeded support whose page was fetched.
  const opt2 = rep.suitability.candidates[1]!.alternative;
  const backed = await h.store.createEntity(owner, h.ws.id, {
    kind: 'claim',
    title: `${opt2.title} works for this`,
    body: {
      statement: `${opt2.title} handles the problem well.`,
      basis: 'observation',
      uncertainty: 'test',
    },
  });
  const support = (
    await h.db.pool.query(
      `select cs.id, cs.link_id, cs.claim_id from claim_support cs
        where cs.workspace_id = $1 and cs.stance = 'supports' and cs.retracted_at is null
          and exists (select 1 from source_retrievals r
            where r.source_id = cs.source_id and r.state = 'fetched')
        limit 1`,
      [h.ws.id],
    )
  ).rows[0] as { id: string; link_id: string; claim_id: string };
  const linkId = randomUUID();
  await h.db.pool.query(
    `insert into entity_links select (jsonb_populate_record(null::entity_links,
       to_jsonb(l) || jsonb_build_object('id', $2::uuid)
         || case when l.from_id = $3::uuid
              then jsonb_build_object('from_id', $4::uuid, 'from_version', 1)
              else jsonb_build_object('to_id', $4::uuid, 'to_version', 1) end)).*
       from entity_links l where l.id = $1`,
    [support.link_id, linkId, support.claim_id, backed.id],
  );
  await h.db.pool.query(
    `insert into claim_support select (jsonb_populate_record(null::claim_support,
       to_jsonb(cs) || jsonb_build_object('id', $2::uuid, 'claim_id', $3::uuid,
         'claim_version', 1, 'link_id', $4::uuid))).*
       from claim_support cs where cs.id = $1`,
    [support.id, randomUUID(), backed.id, linkId],
  );
  // ADR-0134: a claim quoting an uploaded document is not public, though its source is
  // recorded like a fetched page, so it is never linked on public data.
  const doc = (
    await new FileStore(h.db.pool).uploadFile(owner, h.ws.id, {
      bytes: Buffer.from(
        `Our own notes: ${opt2.title} handles the problem well.`,
      ),
      name: 'private-notes.txt',
      declaredType: null,
      uploadKey: randomUUID(),
      linkEntityId: null,
      keepDuplicate: true,
    })
  ).file;
  const fromDoc = await h.store.sourceFromFile(owner, h.ws.id, {
    file_id: doc.id,
    file_version: 1,
  });
  const privateClaim = await h.store.createEntity(owner, h.ws.id, {
    kind: 'claim',
    title: `${opt2.title} works for us`,
    body: {
      statement: `${opt2.title} handles the problem well, say our notes.`,
      basis: 'observation',
      uncertainty: 'test',
    },
  });
  await h.store.addClaimSupport(owner, h.ws.id, privateClaim.id, {
    evidence: 'passage',
    claim_version: 1,
    passage_id: (await h.store.getSource(owner, h.ws.id, fromDoc.source.id))
      .passages[0]!.id,
    stance: 'supports',
    support_type: 'observation',
    quote: 'handles the problem well',
    rationale: 'Our notes say so.',
  });
  const linked = await h.store.autopilotLinkClaims(
    ap,
    h.ws.id,
    problem.id,
    [opt2.id],
    'public',
  );
  assert.ok(
    linked.some((m) => m.to_id === opt2.id && m.claim_id === backed.id),
    JSON.stringify(linked),
  );
  assert.ok(
    linked.every((m) => m.claim_id !== privateClaim.id),
    JSON.stringify(linked),
  );
  const row = await h.db.pool.query(
    `select asserted_by, rationale from entity_links where to_id = $1 and rationale like 'Its title%'`,
    [opt.id],
  );
  assert.equal(row.rows[0].asserted_by, AUTOPILOT_ACTOR_ID);
});

test('P-12: a web search whose claims wait for a person stops the autopilot; Allow accepts them and goes on without searching again', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const research = {
    connection_id: '00000000-0000-4000-8000-0000000000c1',
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const c = h.config({ research });
  let accepted = 0;
  const started: unknown[] = [];
  const web: AutopilotWeb = {
    accept: async () => {
      accepted += 1;
      return null;
    },
    start: async (_ctx, _ws, _run, body) => {
      started.push(body);
      return { id: '00000000-0000-4000-8000-0000000000d2' };
    },
    read: async () =>
      ({
        id: '00000000-0000-4000-8000-0000000000d2',
        version: 1,
        state: 'done',
        explanation: 'Read 2 pages.',
        proposals: [
          {
            decision: accepted ? 'admitted' : 'pending',
            check: 'verified',
            basis: 'observation',
          },
          { decision: 'pending', check: 'verified', basis: 'inference' },
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
  const runId = await h.run(
    h.policy(['research', 'evidence', 'model_work', 'selection'], {
      data_classes: ['public', 'synthetic'],
    }),
  );
  const a = await runner.start(owner, h.ws.id, runId, h.body(c));
  await runner.settled(a.id);
  const stopped = runner.with(await h.store.getAutopilot(owner, h.ws.id, a.id));
  assert.equal(stopped.outcome, 'needs_person', stopped.explanation);
  assert.equal(stopped.steps.length, 1, 'held before exploring');
  assert.equal(stopped.steps[0]!.stop_kind, 'claims_held');
  assert.match(
    stopped.explanation,
    /1 claim whose only check is that the quotes were found/,
  );
  assert.equal(stopped.next?.[0]?.setting, 'accept_quote_checked_claims');
  assert.equal(accepted, 0);
  // Hands-off leaves this switch as it was.
  assert.equal(handsOff(OFF).accept_quote_checked_claims, false);
  assert.ok(
    isHandsOff({ ...handsOff(OFF), accept_quote_checked_claims: true }),
  );
  assert.equal(stopped.calls_reserved, 2, 'the search set aside its 2 calls');

  // Live run 2026-11-14: Continue with nothing added stops again without a search of its own,
  // sets nothing aside and keeps the search it is about.
  await runner.retry(owner, h.ws.id, a.id, {
    expected_version: stopped.version,
  });
  await runner.settled(a.id);
  const again = runner.with(await h.store.getAutopilot(owner, h.ws.id, a.id));
  assert.equal(again.outcome, 'needs_person');
  assert.equal(again.steps.length, 2);
  assert.equal(again.steps[1]!.stop_kind, 'claims_held');
  assert.deepEqual(again.steps[1]!.child, {
    kind: 'web_discovery',
    id: '00000000-0000-4000-8000-0000000000d2',
  });
  assert.equal(again.steps[1]!.calls, 0);
  assert.equal(again.calls_reserved, 2);
  assert.equal(started.length, 1, 'Continue did not search again');
  assert.match(
    again.next?.find((n) => n.kind === 'continue')?.detail ?? '',
    /while claims still wait and none were added, it stops here again/,
  );

  // A later Allow still goes on from that first search instead of searching again.
  await runner.allowAndContinue(owner, h.ws.id, a.id, {
    expected_version: again.version,
    settings_version: 0,
    setting: 'accept_quote_checked_claims',
  });
  await runner.settled(a.id);
  const b = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(
    (await h.store.autopilotSettings(owner, h.ws.id)).values
      .accept_quote_checked_claims,
    true,
  );
  assert.equal(accepted, 1);
  assert.equal(started.length, 1, 'no second search');
  assert.equal(b.steps[2]!.stage, 'research');
  assert.equal(b.steps[2]!.state, 'done');
  assert.equal(b.steps[2]!.calls, 0);
  assert.match(
    b.steps[2]!.note,
    /Went on from the earlier web search: 1 claim added/,
  );
  assert.equal(b.steps[3]!.stage, 'explore');
});

test('P-11: approvals made with an autopilot end when it ends, stay while it waits for a person, and approvals the run had keep their terms', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const p = h.policy();
  const own = {
    ...h.body(h.config()),
    routine_policy: {
      kind: 'new' as const,
      policy: { ...p, summary_seen: routinePolicySummary(p) },
    },
  };
  const runId = await h.run(null);
  const a = await h.runner.start(owner, h.ws.id, runId, own);
  await h.runner.settled(a.id);
  const tie = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(tie.outcome, 'needs_person', tie.explanation);
  assert.ok(tie.routine_policy_id);
  assert.equal(tie.approvals_ended_at, null, 'kept while it waits for you');
  const policyOf = async (id: string) =>
    (await h.store.listRoutinePolicies(owner, h.ws.id)).find(
      (v) => v.policy.id === id,
    )!.policy;
  assert.equal((await policyOf(tie.routine_policy_id!)).status, 'active');
  // The owner chooses; Continue goes on to a proposal, and its own approvals end with it.
  const problem = tie.steps.find((x) => x.stage === 'discover')!.problem!;
  await ownerChooses(h, runId, problem.id);
  // ADR-0101 review 1 L-2: the draft request is a call of the autopilot's own limit; with
  // none left, the proposal is saved and the chat model is not asked.
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...AUTOPILOT_SETTINGS_DEFAULT, draft_proposal_sections: true },
  });
  await h.db.pool.query(
    `update autopilots set calls_reserved = (config #>> '{limits,max_calls}')::int
      where id = $1`,
    [a.id],
  );
  await h.runner.retry(owner, h.ws.id, a.id, { expected_version: tie.version });
  await h.runner.settled(a.id);
  const done = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(done.outcome, 'proposal', done.explanation);
  assert.equal(h.drafted.length, 0);
  assert.match(
    done.steps.at(-1)!.note,
    /not asked to draft its missing sections: the autopilot’s call limit is used up/,
  );
  assert.equal(done.steps.at(-1)!.calls, 0);
  assert.ok(done.approvals_ended_at);
  const ended = await policyOf(tie.routine_policy_id!);
  assert.equal(ended.status, 'revoked');
  assert.match(
    String(ended.revoke_reason),
    /autopilot they were made for ended \(proposal\)/,
  );
  // A finished autopilot whose approvals ended cannot continue, and says why.
  const can = autopilotContinuable({
    ...tie,
    approvals_ended_at: new Date().toISOString(),
  });
  assert.ok(
    !can.ok &&
      /routine approvals made for this autopilot ended/.test(can.reason),
  );

  // Approvals the run already had are not the autopilot's: they keep their own terms.
  const runId2 = await h.run();
  const b = await h.start(
    runId2,
    h.config({ start: { stage: 'assess', problem } }),
  );
  assert.equal(b.state, 'finished', b.explanation);
  assert.equal(b.routine_policy_id, null);
  assert.equal(b.approvals_ended_at, null);
  const kept = (await h.store.listRoutinePolicies(owner, h.ws.id)).find(
    (v) => v.policy.run_id === runId2,
  )!.policy;
  assert.equal(kept.status, 'active');
});

test('review 1 M-1: a thin-evidence stop offers Allow and continue and keeps the autopilot’s own approvals while it waits', async (t) => {
  const h = await setup(t);
  if (!h) return;
  // No claims at all: exploration finds no candidate.
  const p = h.policy();
  const runId = await h.run(null);
  const a = await h.runner.start(owner, h.ws.id, runId, {
    ...h.body(h.config()),
    routine_policy: {
      kind: 'new' as const,
      policy: { ...p, summary_seen: routinePolicySummary(p) },
    },
  });
  await h.runner.settled(a.id);
  const thin = h.runner.with(await h.store.getAutopilot(owner, h.ws.id, a.id));
  assert.equal(thin.outcome, 'insufficient_evidence', thin.explanation);
  assert.equal(thin.steps.at(-1)!.stop_kind, 'thin_evidence');
  assert.ok(autopilotContinuable(thin).ok);
  assert.equal(thin.next?.[0]?.setting, 'gather_evidence');
  assert.equal(thin.approvals_ended_at, null, 'it waits for you');
  await h.runner.allowAndContinue(owner, h.ws.id, a.id, {
    expected_version: thin.version,
    settings_version: 0,
    setting: 'gather_evidence',
  });
  await h.runner.settled(a.id);
  const b = await h.store.getAutopilot(owner, h.ws.id, a.id);
  // It explored again; an API route cannot search the web, so it says so and waits again.
  assert.equal(b.steps.filter((s) => s.stage === 'explore').length, 2);
  assert.match(b.explanation, /could not gather more evidence/);
  const s = await h.store.autopilotSettings(owner, h.ws.id);
  assert.equal(s.values.gather_evidence, true);
  assert.ok(s.values.max_extra_searches >= 1);
  // Re-review 2 L-1: with the setting on and no way to search, Continue would only stop here
  // again. The stop is final: the approvals end and a new autopilot is offered, not Allow.
  const read = await h.runner.withNext(owner, h.ws.id, b);
  assert.ok(b.steps.at(-1)!.no_retry, 'final');
  assert.ok(b.approvals_ended_at, 'its approvals ended');
  assert.ok(!read.next?.some((n) => n.kind === 'allow_and_continue'));
  assert.ok(read.next?.some((n) => n.kind === 'new_autopilot'));
  await rejects(
    'INVALID_TRANSITION',
    h.runner.allowAndContinue(owner, h.ws.id, a.id, {
      expected_version: b.version,
      settings_version: s.version,
      setting: 'gather_evidence',
    }),
  );
  assert.equal(
    (await h.store.autopilotSettings(owner, h.ws.id)).version,
    s.version,
    'no settings version saved for nothing',
  );
});

test('re-review 2 L-1: a setting already on is not offered again, and an Allow that would change nothing is refused', async (t) => {
  // The next steps leave out Allow when the owner's settings already have it on.
  const tie = {
    state: 'finished' as const,
    outcome: 'needs_person' as const,
    steps: [{ stage: 'select', state: 'stopped', stop_kind: 'tie' } as never],
  };
  assert.equal(autopilotNextSteps(tie, OFF)[0]?.kind, 'allow_and_continue');
  assert.ok(
    !autopilotNextSteps(tie, { ...OFF, break_ties: true }).some(
      (n) => n.kind === 'allow_and_continue',
    ),
  );
  assert.ok(settingIsOn({ ...OFF, retry_failed: 2 }, 'retry_failed'));
  assert.ok(!settingIsOn({ ...OFF, gather_evidence: true }, 'gather_evidence'));
  // The store refuses an Allow of a setting that is already on (a stale card or a direct call).
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const a = await h.start(runId);
  if (a.steps.at(-1)?.stop_kind !== 'tie') return; // The fixture's tie is what this needs.
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...OFF, break_ties: true },
  });
  await rejects(
    'INVALID_TRANSITION',
    h.runner.allowAndContinue(owner, h.ws.id, a.id, {
      expected_version: a.version,
      settings_version: 1,
      setting: 'break_ties',
    }),
    /already on/,
  );
  const next = await h.runner.withNext(owner, h.ws.id, a);
  assert.ok(!next.next?.some((n) => n.kind === 'allow_and_continue'));
  assert.ok(
    next.next?.some((n) => n.kind === 'continue' || n.kind === 'decide'),
  );
});

test('review 1 L-7: an autopilot’s own approvals end when it is cancelled while running and when a step fails, and Continue is then refused', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const research = {
    connection_id: '00000000-0000-4000-8000-0000000000c1',
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  let state = 'searching';
  const web: AutopilotWeb = {
    accept: async () => null,
    start: async () => ({ id: '00000000-0000-4000-8000-0000000000d3' }),
    read: async () =>
      ({
        id: '00000000-0000-4000-8000-0000000000d3',
        version: 1,
        state,
        explanation: 'The search stopped (test).',
        proposals: [],
      }) as unknown as WebDiscovery,
    isActive: () => true,
    resume: async () => null,
    cancel: async () => null,
  };
  const runner = new AutopilotRunner(h.store, web, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  const p = h.policy(['research', 'evidence', 'model_work', 'selection'], {
    data_classes: ['public', 'synthetic'],
  });
  const own = {
    ...h.body(h.config({ research })),
    routine_policy: {
      kind: 'new' as const,
      policy: { ...p, summary_seen: routinePolicySummary(p) },
    },
  };
  const policyOf = async (id: string) =>
    (await h.store.listRoutinePolicies(owner, h.ws.id)).find(
      (v) => v.policy.id === id,
    )!.policy;
  // Cancelled while its search runs.
  const a = await runner.start(owner, h.ws.id, await h.run(null), own);
  await until(
    async () =>
      !!(await h.store.getAutopilot(owner, h.ws.id, a.id)).steps[0]?.child,
  );
  const cancelled = await runner.cancel(owner, h.ws.id, a.id, {
    reason: 'Test stop.',
  });
  await runner.settled(a.id);
  assert.ok(cancelled.approvals_ended_at);
  const ended = await policyOf(cancelled.routine_policy_id!);
  assert.equal(ended.status, 'revoked');
  assert.match(String(ended.revoke_reason), /\(cancelled\)/);
  // A failed step (no retries allowed): its approvals end, and Continue is refused.
  state = 'failed';
  const b = await runner.start(owner, h.ws.id, await h.run(null), own);
  await runner.settled(b.id);
  const failed = await h.store.getAutopilot(owner, h.ws.id, b.id);
  assert.equal(failed.outcome, 'failed', failed.explanation);
  assert.ok(failed.approvals_ended_at);
  assert.equal((await policyOf(failed.routine_policy_id!)).status, 'revoked');
  await rejects(
    'INVALID_TRANSITION',
    runner.retry(owner, h.ws.id, b.id, { expected_version: failed.version }),
    /routine approvals made for this autopilot ended/,
  );
});

test('review 1 L-2: a plan refusal is read by its code, not its words', () => {
  const refused = (code: string, text: string) =>
    new ContractError(
      'ACCESS_DENIED',
      'This plan request is not admitted.',
      [text],
      [{ code, text }],
    );
  assert.equal(
    refusalKind(
      refused(
        'caps_not_accepted',
        'The owner has not accepted the current caps and allowed work (request, daily, time and output caps; data and task classes).',
      ),
    ),
    'connection',
  );
  assert.equal(
    refusalKind(
      refused(
        'daily_cap_reached',
        'The studio daily request cap for this connection is reached.',
      ),
    ),
    'daily_cap',
  );
  assert.equal(
    refusalKind(refused('cap_reached', 'The per-run request cap is reached.')),
    'run_cap',
  );
  // Autopilot friction pass (November 28): an earlier request with no recorded outcome is its
  // own stop, fixed under Models and connections, not an approval or a setup fault.
  assert.equal(
    refusalKind(
      refused(
        'request_open',
        'An earlier plan request has an unknown outcome; reconcile it in Models and connections.',
      ),
    ),
    'open_request',
  );
  assert.equal(
    refusalKind(
      new ContractError(
        'ACCESS_DENIED',
        'This plan request is not admitted.',
        ['Unknown outcome.', 'Caps not accepted.'],
        [
          { code: 'request_open', text: 'Unknown outcome.' },
          { code: 'caps_not_accepted', text: 'Caps not accepted.' },
        ],
      ),
    ),
    'connection',
    'a setup fault beside it is still named as the connection',
  );
  // Re-review 2 N-1: a connection that is not set up is named first, whatever else is used up.
  assert.equal(
    refusalKind(
      new ContractError(
        'ACCESS_DENIED',
        'This plan request is not admitted.',
        ['Caps not accepted.', 'The daily request cap is reached.'],
        [
          {
            code: 'daily_cap_reached',
            text: 'The daily request cap is reached.',
          },
          { code: 'caps_not_accepted', text: 'Caps not accepted.' },
        ],
      ),
    ),
    'connection',
  );
  assert.equal(
    autopilotNextSteps({
      state: 'finished',
      outcome: 'needs_authority',
      steps: [
        {
          stage: 'explore',
          state: 'stopped',
          stop_kind: 'connection',
        } as never,
      ],
    })[0]?.kind,
    'models',
  );
});

test('review 1 L-3: a whole process that cannot fit under what is left of the per-run cap is refused at the start', async (t) => {
  const h = await setup(t);
  if (!h) return;
  class Room extends ConnectionStore {
    override async planRunRoomIn() {
      return { per_run: 10, used: 4, daily_left: 50 };
    }
  }
  const runner = new AutopilotRunner(new Room(h.db.pool), null, { pollMs: 5 });
  const c = h.config({
    resource_setup: {
      kind: 'subscription',
      connection_id: '00000000-0000-4000-8000-0000000000c1',
      model_id: 'm',
      settings_hash: 'a'.repeat(64),
      max_output_chars: 16000,
    },
  });
  await rejects(
    'LIMIT_EXCEEDED',
    runner.start(owner, h.ws.id, await h.run(), h.body(c)),
    /has 6 of the plan connection's 10 requests per run left, and a whole process needs at least 11/,
  );
  assert.equal((await h.store.listAutopilots(owner, h.ws.id)).length, 0);
});

test('re-review 2 L-2: the start check counts what each step needs from the config: 5 response types and research on 10 requests cannot start', async (t) => {
  const h = await setup(t);
  if (!h) return;
  let checked = 0;
  class Fresh extends ConnectionStore {
    override async planRunRoomIn() {
      checked += 1;
      return { per_run: 10, used: 0, daily_left: 50 };
    }
  }
  const runner = new AutopilotRunner(new Fresh(h.db.pool), null, {
    pollMs: 5,
  });
  const conn = '00000000-0000-4000-8000-0000000000c1';
  const plan = {
    kind: 'subscription' as const,
    connection_id: conn,
    model_id: 'm',
    settings_hash: 'a'.repeat(64),
    max_output_chars: 16000,
  };
  const research = {
    connection_id: conn,
    model_id: 'm',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  // The live run 2 case: explore 2 + discovery (5 types + 2) + assessment 2 + research 2 = 13.
  await rejects(
    'LIMIT_EXCEEDED',
    runner.start(
      owner,
      h.ws.id,
      await h.run(),
      h.body(h.config({ resource_setup: plan, research })),
    ),
    /has 10 of the plan connection's 10 requests per run left, and a whole process needs at least 13/,
  );
  // Two response types and no research need 8, which fits: the start goes on to its other checks.
  const two = h.config({
    resource_setup: plan,
    perspectives: ['software', 'process_change'],
    excluded: (['existing_tool', 'human_led', 'hybrid'] as const).map(
      (perspective) => ({ perspective, reason: 'Not in this test.' }),
    ),
  });
  const other = await runner
    .start(owner, h.ws.id, await h.run(), h.body(two))
    .then(
      () => null,
      (e: unknown) => e,
    );
  assert.doesNotMatch(String(other), /whole process needs/);
  assert.equal(checked, 2, String(other));
});

test('re-review 2 N-2: a repeated start the idempotency key recorded returns the autopilot without checking room again', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  const runId = await h.run();
  const ctx = { ...owner, idempotencyKey: 'autopilot-start-repeat-1' };
  const body = h.body(h.config());
  let checks = 0;
  const first = await h.store.startAutopilot(
    ctx,
    h.ws.id,
    runId,
    body,
    async () => {
      checks += 1;
    },
  );
  const again = await h.store.startAutopilot(
    ctx,
    h.ws.id,
    runId,
    body,
    async () => {
      checks += 1;
      throw new Error('the room check ran on a repeated start');
    },
  );
  assert.equal(again.id, first.id);
  assert.equal(checks, 1);
  await h.store.cancelAutopilot(owner, h.ws.id, first.id, {
    expected_version: (await h.store.getAutopilot(owner, h.ws.id, first.id))
      .version,
    reason: 'Test.',
  });
});

test('review 1 L-4: a discovery a person runs gets no cited-claim links, even with Gather evidence on', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...OFF, gather_evidence: true, max_extra_searches: 1 },
  });
  await h.seed();
  const cited = await h.db.pool.query(
    `select 1 from entity_links where workspace_id = $1 and rationale like 'Cited by P%'`,
    [h.ws.id],
  );
  assert.equal(cited.rowCount, 0);
});

/** A research-only autopilot whose web search is the given stand-in (review 1 of #202). */
async function researchAutopilot(
  h: NonNullable<Awaited<ReturnType<typeof setup>>>,
  web: AutopilotWeb,
) {
  const research = {
    connection_id: '00000000-0000-4000-8000-0000000000c1',
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const runner = new AutopilotRunner(h.store, web, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  const runId = await h.run(
    h.policy(['research', 'evidence', 'model_work', 'selection'], {
      data_classes: ['public', 'synthetic'],
    }),
  );
  const a = await runner.start(
    owner,
    h.ws.id,
    runId,
    h.body(h.config({ research })),
  );
  await runner.settled(a.id);
  return h.store.getAutopilot(owner, h.ws.id, a.id);
}
const webStub = (start: AutopilotWeb['start']): AutopilotWeb => ({
  accept: async () => null,
  start,
  read: async () => {
    throw new Error('Reading failed (test).');
  },
  isActive: () => true,
  resume: async () => null,
  cancel: async () => null,
});

test('live run 2026-11-14: a step refused before it sent anything gives back the calls it set aside, also on a retry', async (t) => {
  const h = await setup(t);
  if (!h) return;
  let starts = 0;
  const refusing = webStub(async () => {
    starts += 1;
    throw new ContractError(
      'INVALID_CONTRACT',
      'Refused before any request (test).',
    );
  });
  const b = await researchAutopilot(h, refusing);
  assert.equal(b.outcome, 'failed', b.explanation);
  assert.match(b.explanation, /Refused before any request/);
  assert.equal(starts, 1);
  assert.ok(
    b.steps.every((s) => s.child === null && s.calls === 0),
    JSON.stringify(b.steps),
  );
  assert.equal(b.calls_reserved, 0, 'nothing stays set aside for a refusal');

  // Review 1 L-6: with one retry allowed, both refused attempts give their calls back.
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...AUTOPILOT_SETTINGS_DEFAULT, retry_failed: 1 },
  });
  starts = 0;
  const c = await researchAutopilot(h, refusing);
  assert.equal(c.outcome, 'failed', c.explanation);
  assert.equal(starts, 2, 'tried twice');
  assert.equal(c.steps.length, 2);
  assert.ok(
    c.steps.every((s) => s.calls === 0),
    JSON.stringify(c.steps),
  );
  assert.equal(c.calls_reserved, 0);
});

test('review 1 of #202 L-5: a start that returned keeps its calls set aside even when recording it failed', async (t) => {
  const h = await setup(t);
  if (!h) return;
  // The search starts (so it may have spent), then recording its child fails once.
  let failNext = false;
  const advance = h.store.advanceAutopilot.bind(h.store);
  h.store.advanceAutopilot = async (...args) => {
    if (failNext) {
      failNext = false;
      throw new Error('Recording failed (test).');
    }
    return advance(...args);
  };
  const b = await researchAutopilot(
    h,
    webStub(async () => {
      failNext = true;
      return { id: '00000000-0000-4000-8000-0000000000d4' };
    }),
  );
  h.store.advanceAutopilot = advance;
  assert.equal(b.outcome, 'failed', b.explanation);
  assert.match(b.explanation, /Recording failed/);
  assert.equal(b.steps[0]!.child, null, 'the child was never recorded');
  assert.equal(b.steps[0]!.calls, 2, 'unknown spend is not zero');
  assert.equal(b.calls_reserved, 2);
});

test('re-review of #202 L-2: a discovery start that committed and then threw a plain error keeps its calls set aside', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  // The store commits the discovery, then its follow-up read fails (not a refusal).
  const start = h.store.startDiscovery.bind(h.store);
  h.store.startDiscovery = async (...args) => {
    await start(...args);
    throw new Error('The read after the start failed (test).');
  };
  const a = await h.start(await h.run());
  h.store.startDiscovery = start;
  assert.equal(a.outcome, 'failed', a.explanation);
  const discover = a.steps.find((s) => s.stage === 'discover')!;
  assert.match(discover.note, /The read after the start failed/);
  assert.equal(discover.child, null);
  assert.ok(discover.calls > 0, 'the step may have spent');
  assert.equal(
    a.calls_reserved,
    a.steps.reduce((n, s) => n + s.calls, 0),
  );
});

test('third review of #202 N-1: a start that committed and then threw a refusal keeps its calls set aside', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  // The discovery commits (its receipt is written), then a later read is refused.
  const start = h.store.startDiscovery.bind(h.store);
  h.store.startDiscovery = async (...args) => {
    await start(...args);
    throw new ContractError(
      'ACCESS_DENIED',
      'The read after the start was refused (test).',
    );
  };
  const a = await h.start(await h.run());
  h.store.startDiscovery = start;
  // A refused role check stops for a person's authority.
  assert.equal(a.outcome, 'needs_authority', a.explanation);
  const discover = a.steps.find((s) => s.stage === 'discover')!;
  assert.match(discover.note, /The read after the start was refused/);
  assert.equal(discover.child, null);
  assert.ok(discover.calls > 0, 'it committed, so it may have spent');
  assert.ok(await h.store.commandCommitted(h.ws.id, discover.key!));
  assert.equal(
    a.calls_reserved,
    a.steps.reduce((n, s) => n + s.calls, 0),
  );
});

test('re-review of #202 L-1: a stop note with an emoji across the cut stores without a lone surrogate', async (t) => {
  const h = await setup(t);
  if (!h) return;
  // "The web search ended failed: " is 29 characters; the emoji starts at 1199.
  const explanation = 'a'.repeat(1199 - 29) + '😀 and more after the cut';
  const b = await researchAutopilot(h, {
    ...webStub(async () => ({ id: '00000000-0000-4000-8000-0000000000d5' })),
    read: async () =>
      ({
        id: '00000000-0000-4000-8000-0000000000d5',
        version: 1,
        state: 'failed',
        explanation,
        proposals: [],
      }) as unknown as WebDiscovery,
  });
  assert.equal(b.outcome, 'failed', b.explanation);
  const note = b.steps[0]!.note;
  assert.equal(note.length, 1199);
  assert.doesNotMatch(note, /[\uD800-\uDBFF]$/);
  assert.equal(b.explanation, note);
});

test('live rerun (November 15): notes are cut at a word, keep their ending, and name at most three options', () => {
  // A short text is kept whole; a long one ends at a word with an ellipsis, within the limit.
  assert.equal(cutWords('Short note.', 40), 'Short note.');
  const long =
    'Gathering evidence for Habit tracker and Weekly planning ritual';
  const cut = cutWords(long, 30);
  assert.ok(cut.length <= 30, cut);
  assert.match(cut, /…$/);
  assert.ok(long.startsWith(cut.slice(0, -1).trimEnd()));
  assert.doesNotMatch(cut, /\bH…$/);
  // The ending (what happens next) survives a long reason; the reason is cut instead.
  const note = fitNote(
    'x '.repeat(400).trim(),
    'Gathering evidence, then assessing again.',
    120,
  );
  assert.ok(note.length <= 120, String(note.length));
  assert.match(note, /Gathering evidence, then assessing again\.$/);
  // Up to three names, then a count of the rest.
  assert.equal(namesOf(['A', 'B']), '“A”, “B”');
  assert.equal(namesOf(['A', 'B', 'C', 'D', 'E']), '“A”, “B”, “C” and 2 more');
  assert.equal(namesOf([]), '');
  // A gather question names the unknowns, the option and the problem, within 300 characters.
  assert.equal(
    gatherQuestion(
      { title: 'Shift swap board', unknown: ['effort', 'time_to_value'] },
      'Volunteers miss shifts',
    ),
    'What evidence shows the effort and time to value of “Shift swap board” as a response to “Volunteers miss shifts”?',
  );
  assert.match(
    gatherQuestion({ title: 'Board', unknown: [] }, 'P'),
    /^What evidence bears on “Board”/,
  );
  assert.ok(
    gatherQuestion({ title: 'x'.repeat(400), unknown: ['effort'] }, 'P')
      .length <= 300,
  );
  assert.equal(
    gatherQuestion(null, 'Volunteers miss shifts'),
    'Volunteers miss shifts',
  );
  // An empty reason leaves only what happens next, with no leading space (review 1 N-4).
  assert.equal(fitNote('', 'Gathering evidence.', 120), 'Gathering evidence.');
  assert.equal(
    fitNote('  ', 'Gathering evidence.', 120),
    'Gathering evidence.',
  );
  // An empty ending leaves the reason alone, with no trailing space (review 2).
  assert.equal(fitNote('Nothing new.', '', 120), 'Nothing new.');
});

test('review 1 L-1/L-4: unused calls go back only from finished, settled workflows, from the step that holds them', () => {
  const X = '00000000-0000-4000-8000-0000000000a1';
  const Y = '00000000-0000-4000-8000-0000000000a2';
  const step = (
    state: AutopilotStep['state'],
    calls: number,
    child: string,
  ): AutopilotStep =>
    ({
      stage: 'discover',
      state,
      calls,
      child: { kind: 'workflow', id: child },
    }) as unknown as AutopilotStep;
  const ap = (steps: AutopilotStep[]) =>
    ({
      steps,
      calls_reserved: steps.reduce((n, s) => n + s.calls, 0) + 2,
    }) as unknown as Parameters<typeof trimSpent>[0];
  const done = (
    attempts: number,
    extra: Partial<SpentDetail> = {},
  ): SpentDetail => ({
    workflow: { state: 'succeeded' },
    usage: { attempts, in_flight: 0 },
    subscription_usage: null,
    ...extra,
  });
  const one = ap([step('running', 24, X)]);
  // Settled: keeps what it used.
  const t = trimSpent(one, new Map([[X, done(5)]]));
  assert.equal(t.steps[0]!.calls, 5);
  assert.equal(t.calls_reserved, one.calls_reserved - 19);
  // Plan requests count when they are more than the attempts.
  const plan = trimSpent(
    one,
    new Map([
      [
        X,
        done(2, {
          subscription_usage: { requests: 9, in_flight: 0, unresolved: 0 },
        }),
      ],
    ]),
  );
  assert.equal(plan.steps[0]!.calls, 9);
  // Unknown is not zero: an unresolved or in-flight plan request, an API request in flight or
  // a workflow still working keeps the whole reservation.
  for (const d of [
    done(1, {
      subscription_usage: { requests: 1, in_flight: 0, unresolved: 1 },
    }),
    done(1, {
      subscription_usage: { requests: 1, in_flight: 1, unresolved: 0 },
    }),
    done(1, { usage: { attempts: 1, in_flight: 1 } }),
    { ...done(1), workflow: { state: 'running' } },
  ])
    assert.equal(trimSpent(one, new Map([[X, d]])), one);
  // Only a finished workflow with nothing in flight or unresolved is read once and kept.
  assert.equal(spentSettled(done(1)), true);
  assert.equal(
    spentSettled(done(1, { usage: { attempts: 1, in_flight: 1 } })),
    false,
  );
  assert.equal(
    spentSettled({ ...done(1), workflow: { state: 'running' } }),
    false,
  );
  // Never more than it set aside: a workflow that used it all changes nothing.
  assert.equal(trimSpent(one, new Map([[X, done(30)]])), one);
  // A step stopped before its workflow finished keeps the reservation; the step that carries
  // the workflow on sets nothing aside, so the stopped step is the one trimmed.
  const carried = ap([step('stopped', 24, X), step('running', 0, X)]);
  assert.deepEqual(spentCandidates(carried), [X]);
  const c = trimSpent(carried, new Map([[X, done(5)]]));
  assert.deepEqual(
    c.steps.map((s) => s.calls),
    [5, 0],
  );
  assert.equal(c.calls_reserved, carried.calls_reserved - 19);
  // Trimming again changes nothing (no double give-back).
  assert.equal(trimSpent(c, new Map([[X, done(5)]])), c);
  // A failed workflow and its retry: each keeps what it used; the total stays the sum.
  const retry = ap([step('stopped', 7, X), step('running', 7, Y)]);
  assert.deepEqual(spentCandidates(retry).sort(), [X, Y].sort());
  const r = trimSpent(
    retry,
    new Map([
      [X, { ...done(2), workflow: { state: 'failed' } }],
      [Y, done(3)],
    ]),
  );
  assert.deepEqual(
    r.steps.map((s) => s.calls),
    [2, 3],
  );
  assert.equal(r.calls_reserved, retry.calls_reserved - 9);
  // Done steps and stopped steps that hold nothing are not read again.
  assert.deepEqual(
    spentCandidates(ap([step('done', 5, X), step('stopped', 0, Y)])),
    [],
  );
});

test('review 1 L-3: a later gather round never repeats a question; it moves to the next option, then the problem', () => {
  const opts = [
    { title: 'Swap board', unknown: ['effort'] },
    { title: 'Reminder texts', unknown: [] },
  ];
  const asked = new Set<string>();
  const first = nextGatherQuestion(opts, 'Volunteers miss shifts', asked)!;
  assert.equal(first.about, 'Swap board');
  asked.add(first.question.toLowerCase());
  const second = nextGatherQuestion(opts, 'Volunteers miss shifts', asked)!;
  assert.equal(second.about, 'Reminder texts');
  asked.add(second.question.toLowerCase());
  const third = nextGatherQuestion(opts, 'Volunteers miss shifts', asked)!;
  assert.equal(third.about, null);
  assert.equal(third.question, 'Volunteers miss shifts');
  asked.add(third.question.toLowerCase());
  assert.equal(
    nextGatherQuestion(opts, 'Volunteers miss shifts', asked),
    undefined,
  );
});

test('live rerun 3 (November 15): a usage-limit refusal is a limit to wait out, not an approval or a broken connection', () => {
  const quota = new ContractError(
    'ACCESS_DENIED',
    'This plan request is not admitted.',
    ['The ChatGPT plan usage limit was reached.'],
    [
      {
        code: 'quota_exhausted',
        text: 'The ChatGPT plan usage limit was reached. Plan requests pause; check ChatGPT Settings > Usage.',
      },
    ],
  );
  assert.deepEqual(refusalStop(quota), {
    outcome: 'limit_reached',
    kind: 'usage_limit',
  });
  // Other refusals keep their outcome.
  const caps = new ContractError(
    'ACCESS_DENIED',
    'Not admitted.',
    ['x'],
    [{ code: 'caps_not_accepted', text: 'x' }],
  );
  assert.equal(refusalStop(caps).kind, 'connection');
  assert.equal(refusalStop(caps).outcome, 'needs_authority');
  // The finished autopilot offers Continue, not "Fix the connection".
  const next = autopilotNextSteps({
    state: 'finished',
    outcome: 'limit_reached',
    steps: [
      {
        stage: 'assess',
        state: 'stopped',
        stop_kind: 'usage_limit',
      } as unknown as AutopilotStep,
    ],
  });
  // PR #211 review 1 L-1/N-2: recheck usage first (the connection stays marked used up until
  // then), in words that fit any plan.
  assert.equal(next[0]?.kind, 'models');
  assert.match(next[0]!.label, /Recheck usage once the limit resets/);
  assert.doesNotMatch(next[0]!.detail, /ChatGPT/);
  // N-1: a refusal that also needs the connection fixed says so first.
  const both = new ContractError(
    'ACCESS_DENIED',
    'Not admitted.',
    ['x'],
    [
      { code: 'quota_exhausted', text: 'x' },
      { code: 'sign_in', text: 'x' },
    ],
  );
  assert.equal(refusalStop(both).kind, 'connection');
  const capped = new ContractError(
    'ACCESS_DENIED',
    'Not admitted.',
    ['x'],
    [
      { code: 'quota_exhausted', text: 'x' },
      { code: 'daily_cap_reached', text: 'x' },
    ],
  );
  assert.equal(refusalStop(capped).kind, 'usage_limit');
  // Review 2 N-4: the cap that was also reached is named with its own step.
  assert.match(
    capAlso(capped),
    /daily request cap was reached too; add requests/,
  );
  assert.equal(capAlso(quota), '');
  // Review 3: only the per-run cap is named as such; another cap is quoted.
  const capOf = (text: string) =>
    capAlso(
      new ContractError(
        'ACCESS_DENIED',
        'Not admitted.',
        ['x'],
        [
          { code: 'quota_exhausted', text: 'x' },
          { code: 'cap_reached', text },
        ],
      ),
    );
  assert.match(
    capOf('The per-run request cap was reached.'),
    /per-run request cap/,
  );
  const input = capOf('The input is above the per-request input cap.');
  assert.doesNotMatch(input, /per-run/);
  assert.match(
    input,
    /A connection cap was reached too \(The input is above the per-request input cap\)/,
  );
  assert.equal(capAlso(both), '');
});

test('PR #211 review 1 N-3/N-4/N-5: a short reason stays, the stall note names both counts, reason codes read as words', () => {
  const note = fitNote('Stopped.', 'x '.repeat(750), 1200);
  assert.ok(note.startsWith('Stopped. '), note.slice(0, 40));
  assert.ok(note.length <= 1200);
  assert.equal(
    stalledNote(1, 2),
    'The last round of evidence left 2 unknown ratings, more than the 1 before it, so it stops gathering and the choice is yours.',
  );
  assert.match(stalledNote(2, 2), /left 2 unknown ratings, the same as the 2/);
  assert.equal(
    failedNote('Assess the options', {
      state: 'failed',
      reason: 'invalid_output',
    }),
    'Assess the options failed: invalid output.',
  );
});

test('live rerun 3: notes and questions stay whole, and a failed step says why once', () => {
  assert.equal(
    failedNote('Assess the options', { state: 'failed', reason: 'failed' }),
    'Assess the options failed.',
  );
  assert.equal(
    failedNote('Assess the options', {
      state: 'failed',
      reason: 'The model answer was not valid.',
    }),
    'Assess the options failed: The model answer was not valid.',
  );
  assert.equal(
    failedNote('Find the problem', { state: 'cancelled', reason: null }),
    'Find the problem was cancelled.',
  );
  // Long titles and three unknowns: the question keeps its closing quote and question mark.
  const q = gatherQuestion(
    {
      title:
        'Conditional handoff protocol with existing-system support; defer a custom build until the pilot shows where the handoffs fail',
      unknown: [
        'feasibility_burden',
        'maintenance_burden',
        'stakeholder_acceptability',
      ],
    },
    'Disparate systems delay nonprofit operations because staff re-enter the same records in several tools every week',
  );
  assert.ok(q.length <= 300, String(q.length));
  assert.match(q, /”\?$/);
  assert.match(q, /feasibility burden and maintenance burden of/);
  assert.doesNotMatch(q, /stakeholder/);
  // A long ending leaves the reason at least two fifths of the note.
  const reason =
    'Choose stopped: 3 options are not fully scored (unknown: feasibility burden).';
  const note = fitNote(reason, 'x '.repeat(400).trim(), 120);
  assert.ok(note.length <= 120);
  assert.ok(note.startsWith('Choose stopped: 3 options'), note);
});

test('live rerun 3: gathering counts the unknown ratings it asked about', () => {
  const rows = [
    { unknown_criteria: ['effort', 'maintenance'] },
    { unknown_criteria: ['acceptability'] },
  ];
  assert.equal(unknownCount('unknown_ratings', rows), 3);
  assert.equal(unknownCount('gate_blocked', rows), null);
});

test('live rerun 3: weight scenarios read in words, not criterion keys', () => {
  assert.equal(
    scenarioWords([{ name: 'without evidence_support' }]),
    'evidence support is left out',
  );
  assert.equal(
    scenarioWords([
      { name: 'without evidence_support' },
      { name: 'double maintenance_burden' },
    ]),
    'evidence support is left out or maintenance burden counts double',
  );
});

test('PR #211 review 1 L-2a: a failed step while the plan usage limit holds stops on the limit and is not retried', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const conn = '00000000-0000-4000-8000-0000000000c1';
  class Exhausted extends ConnectionStore {
    override async planRunRoomIn() {
      return { per_run: 40, used: 0, daily_left: 50 };
    }
    override async planConnectionDetail(
      ...args: Parameters<ConnectionStore['planConnectionDetail']>
    ) {
      if (args[2] !== conn) return super.planConnectionDetail(...args);
      return {
        connection: { quota: { state: 'exhausted' } },
      } as unknown as Awaited<
        ReturnType<ConnectionStore['planConnectionDetail']>
      >;
    }
  }
  let starts = 0;
  const web: AutopilotWeb = {
    ...webStub(async () => {
      starts += 1;
      return { id: '00000000-0000-4000-8000-0000000000d4' };
    }),
    read: async () =>
      ({
        id: '00000000-0000-4000-8000-0000000000d4',
        version: 1,
        state: 'failed',
        explanation: 'The search failed (test).',
        proposals: [],
      }) as unknown as WebDiscovery,
  };
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...OFF, retry_failed: 2 },
  });
  const runner = new AutopilotRunner(new Exhausted(h.db.pool), web, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  const research = {
    connection_id: conn,
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const plan = {
    kind: 'subscription' as const,
    connection_id: conn,
    model_id: 'gpt-test',
    settings_hash: 'a'.repeat(64),
    max_output_chars: 16000,
  };
  const runId = await h.run(
    h.policy(['research', 'evidence', 'model_work', 'selection'], {
      data_classes: ['public', 'synthetic'],
    }),
  );
  const a = await runner.start(
    owner,
    h.ws.id,
    runId,
    h.body(h.config({ resource_setup: plan, research })),
  );
  await runner.settled(a.id);
  const done = runner.with(await h.store.getAutopilot(owner, h.ws.id, a.id));
  assert.equal(starts, 1, 'not retried');
  assert.equal(done.steps.length, 1, JSON.stringify(done.steps));
  assert.equal(done.outcome, 'limit_reached', done.explanation);
  assert.equal(done.steps[0]!.stop_kind, 'usage_limit');
  assert.match(done.explanation, /recheck usage under Models and connections/);
  assert.ok(autopilotContinuable(done).ok);
  assert.equal(done.next?.[0]?.kind, 'models');
  assert.match(done.next![0]!.label, /Recheck usage/);
});

test('PR #211 review 1 L-2b: a gather round that leaves as many unknown ratings stops gathering and says so', async (t) => {
  const h = await setup(t);
  if (!h) return;
  await h.seed();
  // The assessment rates every option; this stand-in leaves the first choosable one with an
  // unknown rating on every read, so evidence never shrinks the unknowns.
  class Unknown extends ConnectionStore {
    override async selectionReport(
      ...args: Parameters<ConnectionStore['selectionReport']>
    ) {
      const r = await super.selectionReport(...args);
      const c = r.suitability.candidates.find(
        (x) => x.gates.discovery === 'candidate',
      );
      if (c)
        Object.assign(c, {
          rank: null,
          score: null,
          unknown_criteria: ['adoption_cost'],
        });
      return r;
    }
  }
  let n = 0;
  const web: AutopilotWeb = {
    accept: async () => null,
    start: async () => ({
      id: `00000000-0000-4000-8000-0000000000e${++n}`,
    }),
    read: async (_c, _w, id) =>
      ({
        id,
        version: 1,
        state: 'done',
        explanation: 'Read 1 page.',
        proposals: [{ decision: 'admitted', check: 'verified' }],
      }) as unknown as WebDiscovery,
    isActive: () => true,
    resume: async () => null,
    cancel: async () => null,
  };
  await h.store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: { ...OFF, gather_evidence: true, max_extra_searches: 3 },
  });
  const runner = new AutopilotRunner(new Unknown(h.db.pool), web, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  const research = {
    connection_id: '00000000-0000-4000-8000-0000000000c1',
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const runId = await h.run(
    h.policy(['research', 'evidence', 'model_work', 'selection'], {
      data_classes: ['public', 'synthetic'],
    }),
  );
  const a = await runner.start(
    owner,
    h.ws.id,
    runId,
    h.body(h.config({ research })),
  );
  await runner.settled(a.id);
  const done = await h.store.getAutopilot(owner, h.ws.id, a.id);
  const trail = JSON.stringify(
    done.steps.map((s) => [s.stage, s.state, s.stop_kind, s.note]),
  );
  const gathers = done.steps.filter((s) => s.stage === 'gather');
  assert.equal(gathers.length, 1, trail);
  assert.equal(gathers[0]!.request?.unknowns, 1, trail);
  assert.equal(done.outcome, 'needs_person', trail);
  assert.equal(done.steps.at(-1)!.stop_kind, 'unknown_ratings', trail);
  assert.match(
    done.explanation,
    /left 1 unknown rating, the same as the 1 before it, so it stops gathering/,
  );
});

test('autopilot friction pass (November 28): a stop on a request with no recorded outcome points at Models and connections, and Continue waits until it is closed', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const conn = '00000000-0000-4000-8000-0000000000c1';
  let open = 1;
  class Holding extends ConnectionStore {
    override async planRunRoomIn() {
      return { per_run: 40, used: 0, daily_left: 50 };
    }
    override async planConnectionDetail(
      ...args: Parameters<ConnectionStore['planConnectionDetail']>
    ) {
      if (args[2] !== conn) return super.planConnectionDetail(...args);
      return {
        connection: { quota: { state: 'ok' } },
        open_requests: Array.from({ length: open }, () => ({})),
      } as unknown as Awaited<
        ReturnType<ConnectionStore['planConnectionDetail']>
      >;
    }
  }
  let starts = 0;
  const web = webStub(async () => {
    starts += 1;
    throw new ContractError(
      'ACCESS_DENIED',
      "Web search can't start on this connection now.",
      [
        'An earlier plan request has an unknown outcome; reconcile it in Models and connections.',
      ],
      [
        {
          code: 'request_open',
          text: 'An earlier plan request has an unknown outcome; reconcile it in Models and connections.',
        },
      ],
    );
  });
  const runner = new AutopilotRunner(new Holding(h.db.pool), web, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  const research = {
    connection_id: conn,
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const runId = await h.run(
    h.policy(['research', 'evidence', 'model_work', 'selection'], {
      data_classes: ['public', 'synthetic'],
    }),
  );
  const a = await runner.start(
    owner,
    h.ws.id,
    runId,
    h.body(h.config({ research })),
  );
  await runner.settled(a.id);
  const done = runner.with(await h.store.getAutopilot(owner, h.ws.id, a.id));
  assert.equal(starts, 1);
  assert.equal(done.outcome, 'needs_authority', done.explanation);
  assert.equal(done.steps.at(-1)!.stop_kind, 'open_request');
  assert.ok(stopsOnOpenRequest(done.steps.at(-1)));
  // ADR-0137: the one-click setting comes first, then closing it by hand.
  assert.equal(
    done.next?.[0]?.setting,
    'close_unknown_plan_requests',
    JSON.stringify(done.next),
  );
  assert.ok(done.next?.some((n) => n.kind === 'models'));
  assert.ok(
    !done.next?.some((n) => n.kind === 'approvals'),
    'nothing waits under Approvals for it',
  );
  assert.ok(autopilotContinuable(done).ok);

  // While the request stays open, Continue is refused without taking a step or calling out.
  await rejects(
    'INVALID_TRANSITION',
    runner.retry(owner, h.ws.id, a.id, { expected_version: done.version }),
    /no recorded outcome yet/,
  );
  const same = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(same.version, done.version, 'no attempt was recorded');
  assert.equal(same.steps.length, done.steps.length);
  assert.equal(starts, 1);

  // Once it is closed, Continue tries the step again.
  open = 0;
  const cont = await runner.retry(owner, h.ws.id, a.id, {
    expected_version: done.version,
  });
  await runner.settled(cont.id);
  assert.equal(starts, 2, 'tried again after the request was closed');
});

test('autopilot friction pass (November 28): a stop recorded before the open-request kind is still read as one', () => {
  assert.ok(
    stopsOnOpenRequest({
      stop_kind: 'connection',
      note: "Explore the evidence was refused: Exploration can't start on this connection now. An earlier plan request has an unknown outcome; reconcile it in Models and connections.",
    }),
  );
  assert.ok(
    !stopsOnOpenRequest({
      stop_kind: 'connection',
      note: 'Discover was refused: Caps not accepted.',
    }),
  );
  assert.ok(!stopsOnOpenRequest(undefined));
});

test('ADR-0137: with Close unknown plan requests on, an open-request stop closes them and tries again, at most AUTO_CLOSE_MAX times', async (t) => {
  const h = await setup(t);
  if (!h) return;
  const conn = '00000000-0000-4000-8000-0000000000c1';
  let closes = 0;
  class Closing extends ConnectionStore {
    override async planRunRoomIn() {
      return { per_run: 40, used: 0, daily_left: 50 };
    }
    override async autoClosePlanRequests(
      ...args: Parameters<ConnectionStore['autoClosePlanRequests']>
    ) {
      assert.equal(args[2], conn, 'the step’s own connection');
      assert.equal(args[0].autopilot?.id, args[3].toLowerCase());
      closes += 1;
      return [randomUUID()];
    }
  }
  let starts = 0;
  const web = webStub(async () => {
    starts += 1;
    throw new ContractError(
      'ACCESS_DENIED',
      "Web search can't start on this connection now.",
      ['An earlier plan request has an unknown outcome.'],
      [
        {
          code: 'request_open',
          text: 'An earlier plan request has an unknown outcome.',
        },
      ],
    );
  });
  const store = new Closing(h.db.pool);
  await store.saveAutopilotSettings(owner, h.ws.id, {
    expected_version: 0,
    values: {
      ...AUTOPILOT_SETTINGS_DEFAULT,
      close_unknown_plan_requests: true,
    },
  });
  const runner = new AutopilotRunner(store, web, {
    pollMs: 5,
    onWait: () => h.worker.settle(),
  });
  const research = {
    connection_id: conn,
    model_id: 'gpt-test',
    scope: WebDiscoveryScopeSchema.parse({ interests: ['volunteers'] }),
    input_hash: 'c'.repeat(64),
  };
  const runId = await h.run(
    h.policy(['research', 'evidence', 'model_work', 'selection'], {
      data_classes: ['public', 'synthetic'],
    }),
  );
  const a = await runner.start(
    owner,
    h.ws.id,
    runId,
    h.body(h.config({ research })),
  );
  await runner.settled(a.id);
  const done = await h.store.getAutopilot(owner, h.ws.id, a.id);
  assert.equal(closes, AUTO_CLOSE_MAX);
  assert.equal(starts, AUTO_CLOSE_MAX + 1);
  const fallbacks = done.steps.filter(
    (s) => s.fallback?.setting === 'close_unknown_plan_requests',
  );
  assert.equal(fallbacks.length, AUTO_CLOSE_MAX);
  assert.ok(fallbacks.every((s) => s.stop_kind === 'open_request'));
  assert.match(fallbacks[0]!.note, /it ran, or the studio cannot tell/);
  // Past the bound it stops for the owner as before, with nothing set aside for refusals.
  assert.equal(done.outcome, 'needs_authority', done.explanation);
  assert.equal(done.steps.at(-1)!.stop_kind, 'open_request');
  assert.equal(done.calls_reserved, 0);
});

test('Jordan, November 28: the planned steps are the main path still ahead', () => {
  const step = (stage: AutopilotStage, request: unknown = null) =>
    ({ stage, request }) as unknown as AutopilotStep;
  assert.deepEqual(
    autopilotPlannedStages({ stage: 'assess', steps: [step('assess')] }),
    ['select', 'proposal'],
  );
  // A stopped one that Continue picks up still has its own step ahead.
  assert.deepEqual(
    autopilotPlannedStages(
      { stage: 'explore', steps: [step('explore')] },
      true,
    ),
    ['explore', 'brief', 'discover', 'assess', 'select', 'proposal'],
  );
  // A gather fallback goes back to its step; the fallback itself is never planned.
  assert.deepEqual(
    autopilotPlannedStages({
      stage: 'gather',
      steps: [step('gather', { then: 'assess' })],
    }),
    ['assess', 'select', 'proposal'],
  );
  assert.deepEqual(
    autopilotPlannedStages({ stage: 'proposal', steps: [] }),
    [],
  );
  assert.deepEqual(autopilotPlannedStages({ stage: 'spec', steps: [] }), []);
});
