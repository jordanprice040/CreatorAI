import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ContractError,
  type ActionRequest,
  type AutonomyMode,
  type Decision,
  type ErrorCode,
} from '@creator/contracts';
import { OversightStore, type CommandContext } from '@creator/db';
import { freshDatabase } from './pg-harness.js';

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const agent: CommandContext = { actorId: randomUUID() };
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();

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
    name: 'Oversight',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, agent.actorId, 'editor');
  const idea = await store.createEntity(owner, ws.id, {
    kind: 'idea',
    title: 'Shared roster',
    body: { summary: 'One roster.', uncertainty: 'Synthetic.' },
  });
  async function run(
    mode: AutonomyMode,
    initial_grants: { id: string; version: number }[] = [],
  ) {
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
    return store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: mode,
      stage_gates: null,
      initial_grants,
    });
  }
  const standing = (
    action_types: ActionRequest['action_type'][],
    run_id: string | null = null,
    expires_at = inHours(24),
  ) =>
    store.createStandingGrant(owner, ws.id, {
      run_id,
      action_types,
      target_kind: null,
      max_amount_nano_usd: null,
      allow_irreversible: false,
      allow_external_effects: false,
      data_classes: ['synthetic'],
      expires_at,
      rationale: 'Routine synthetic edits.',
    });
  const action = (a: Partial<ActionRequest> = {}): ActionRequest => ({
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
    ...a,
  });
  const approve = (d: Decision, extra: Record<string, unknown> = {}) =>
    store.answerDecision(owner, ws.id, d.id, {
      choice: 'approve_once',
      option_id: null,
      rationale: 'Looks right.',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: 1200,
      interruption: 'useful',
      ...extra,
    });
  return { db, store, ws, idea, run, standing, action, approve };
}

test('covered routine reversible actions proceed repeatedly without creating a decision', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('human_in_loop');
  await s.standing(['record.revise']);
  for (let i = 0; i < 3; i++) {
    const a = await s.store.admitAction(owner, s.ws.id, run.run_id, s.action());
    assert.equal(a.verdict, 'allow');
    assert.equal(a.decision_id, null);
  }
  assert.equal((await s.store.listDecisions(owner, s.ws.id)).length, 0);
  assert.equal(
    (await s.store.listAdmissions(owner, s.ws.id, run.run_id)).length,
    3,
  );
  assert.equal((await s.store.verifyAuditChain()).ok, true);
});

test('approve-once covers one exact action; a changed target or an expiry needs a new decision', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised');
  const first = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action(),
  );
  assert.equal(first.verdict, 'request_human');
  // Asking again for the same thing returns the same open request.
  const repeat = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action(),
  );
  assert.equal(repeat.decision_id, first.decision_id);
  const decision = await s.store.getDecision(
    owner,
    s.ws.id,
    first.decision_id!,
  );
  assert.equal(decision.kind, 'authorization');
  assert.equal(
    decision.coverage.once?.target?.content_hash,
    first.binding.target?.content_hash,
  );
  const answered = await s.approve(decision);
  assert.equal(answered.status, 'answered');
  assert.equal(
    (await s.store.admitAction(owner, s.ws.id, run.run_id, s.action())).verdict,
    'allow',
  );
  // Used up: the next identical action asks again.
  const next = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action(),
  );
  assert.equal(next.verdict, 'request_human');
  assert.notEqual(next.decision_id, first.decision_id);

  // The target changes while the request is open: the old coverage cannot be approved.
  const pending = await s.store.getDecision(owner, s.ws.id, next.decision_id!);
  await s.store.reviseEntity(owner, s.ws.id, s.idea.id, {
    expected_version: 1,
    title: 'Shared roster',
    body: { summary: 'Roster with owners.', uncertainty: 'Synthetic.' },
    reason: 'Edit',
    corrects_version: null,
  });
  await rejects('VERSION_CONFLICT', s.approve(pending));
  assert.equal(
    (await s.store.getDecision(owner, s.ws.id, pending.id)).status,
    'superseded',
  );
  const stale = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action(),
  );
  assert.equal(stale.reason_code, 'target_stale');

  // A request that expires cannot be approved afterwards.
  const short = await s.store.requestDecision(owner, s.ws.id, run.run_id, {
    kind: 'clarification',
    reason: 'material_assumption',
    task_id: null,
    question: 'Which volunteer group is intended?',
    evidence_refs: [],
    uncertainty: 'The brief names two groups.',
    consequence_if_wrong: 'The roster serves the wrong group.',
    options: [
      {
        id: 'weekday',
        label: 'Weekday volunteers',
        consequence: 'Roster covers weekdays.',
      },
      {
        id: 'weekend',
        label: 'Weekend volunteers',
        consequence: 'Roster covers weekends.',
      },
    ],
    recommendation: null,
    recommendation_reason: null,
    blocked_work: ['Roster layout'],
    unblocked_work: ['Source review'],
    action: null,
    expires_at: new Date(Date.now() + 700).toISOString(),
  });
  await sleep(800);
  await rejects(
    'EXPIRED',
    s.store.answerDecision(owner, s.ws.id, short.id, {
      choice: 'choose_option',
      option_id: 'weekday',
      rationale: 'Weekdays.',
      coverage_hash: short.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    }),
  );
  assert.equal(
    (await s.store.getDecision(owner, s.ws.id, short.id)).status,
    'expired',
  );

  // An expired standing grant stops covering.
  const run2 = await s.run('human_in_loop');
  await s.standing(
    ['tool.search_public'],
    run2.run_id,
    new Date(Date.now() + 700).toISOString(),
  );
  const search = s.action({ action_type: 'tool.search_public', target: null });
  assert.equal(
    (await s.store.admitAction(owner, s.ws.id, run2.run_id, search)).verdict,
    'allow',
  );
  await sleep(800);
  assert.equal(
    (await s.store.admitAction(owner, s.ws.id, run2.run_id, search)).verdict,
    'request_human',
  );
  assert.equal((await s.store.verifyAuditChain()).ok, true);
});

test('duplicate answers are idempotent, conflicting second answers are refused, concurrency has one winner', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised');
  const a = await s.store.admitAction(owner, s.ws.id, run.run_id, s.action());
  const d = await s.store.getDecision(owner, s.ws.id, a.decision_id!);
  const [x, y] = await Promise.all([s.approve(d), s.approve(d)]);
  assert.equal(x.response?.grant_id, y.response?.grant_id);
  assert.equal(
    (await s.store.listGrants(owner, s.ws.id)).filter((g) => g.scope === 'once')
      .length,
    1,
  );
  await rejects(
    'DUPLICATE',
    s.store.answerDecision(owner, s.ws.id, d.id, {
      choice: 'reject',
      option_id: null,
      rationale: 'Changed my mind.',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    }),
  );
  // Racing different answers: exactly one is recorded.
  const b = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action({ action_type: 'tool.search_public', target: null }),
  );
  const d2 = await s.store.getDecision(owner, s.ws.id, b.decision_id!);
  const results = await Promise.allSettled([
    s.approve(d2),
    s.store.answerDecision(owner, s.ws.id, d2.id, {
      choice: 'reject',
      option_id: null,
      rationale: 'No.',
      coverage_hash: d2.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    }),
  ]);
  assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
  assert.ok(
    results.some(
      (r) =>
        r.status === 'rejected' &&
        r.reason instanceof ContractError &&
        r.reason.code === 'DUPLICATE',
    ),
  );
  // An agent cannot approve, even as a workspace editor.
  const c = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action({ action_type: 'assumption.log', target: null }),
  );
  const d3 = await s.store.getDecision(owner, s.ws.id, c.decision_id!);
  await rejects(
    'ACCESS_DENIED',
    s.store.answerDecision(agent, s.ws.id, d3.id, {
      choice: 'approve_once',
      option_id: null,
      rationale: 'Self-approval attempt.',
      coverage_hash: d3.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    }),
  );
  // Nor create policy for itself.
  await rejects(
    'ACCESS_DENIED',
    s.store.createStandingGrant(agent, s.ws.id, {
      run_id: null,
      action_types: ['record.revise'],
      target_kind: null,
      max_amount_nano_usd: null,
      allow_irreversible: false,
      allow_external_effects: false,
      data_classes: ['synthetic'],
      expires_at: inHours(1),
      rationale: 'Self-granted.',
    }),
  );
});

test('cancellation closes pending decisions, revokes run grants and overrides an approval', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised');
  await s.standing(['tool.search_public'], run.run_id);
  const a = await s.store.admitAction(owner, s.ws.id, run.run_id, s.action());
  const d = await s.store.getDecision(owner, s.ws.id, a.decision_id!);
  const cancelled = await s.store.cancelRun(owner, s.ws.id, run.run_id, {
    reason: 'Owner stopped the run.',
  });
  assert.equal(cancelled.state, 'cancelled');
  assert.equal(
    (await s.store.getDecision(owner, s.ws.id, d.id)).status,
    'cancelled',
  );
  await rejects('INVALID_TRANSITION', s.approve(d));
  const after = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action({ action_type: 'tool.search_public', target: null }),
  );
  assert.equal(after.verdict, 'deny');
  assert.equal(after.reason_code, 'run_cancelled');
  assert.ok(
    (await s.store.listGrants(owner, s.ws.id)).every(
      (g) => g.run_id !== run.run_id || g.status === 'revoked',
    ),
  );
});

test('autonomous runs end as needs_human, cannot ask for help, and ignore grants added after start', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const packet = await s.standing(['tool.search_public']);
  const run = await s.run('autonomous_within_scope', [
    { id: packet.id, version: packet.version },
  ]);
  const search = s.action({ action_type: 'tool.search_public', target: null });
  assert.equal(
    (await s.store.admitAction(owner, s.ws.id, run.run_id, search)).verdict,
    'allow',
  );
  // Stakeholder approval is not in the initial packet: the outcome is needs_human, deferred.
  const needs = await s.store.admitAction(owner, s.ws.id, run.run_id, {
    ...search,
    flags: [
      {
        reason: 'stakeholder_conflict',
        note: 'Coordinators and volunteers disagree.',
        evidence_refs: [],
      },
    ],
  });
  assert.equal(needs.verdict, 'defer');
  assert.equal(needs.outcome, 'needs_human');
  assert.equal(needs.decision_id, null);
  // A grant created after the run started does not widen its scope.
  await s.standing(['record.revise']);
  const edit = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action(),
  );
  assert.equal(edit.outcome, 'needs_human');
  assert.equal((await s.store.listDecisions(owner, s.ws.id)).length, 0);
  await rejects(
    'SCOPE_EXCEEDED',
    s.store.requestDecision(owner, s.ws.id, run.run_id, {
      kind: 'judgment',
      reason: 'stakeholder_conflict',
      task_id: null,
      question: 'Which group decides?',
      evidence_refs: [],
      uncertainty: 'Unclear.',
      consequence_if_wrong: 'Wrong priorities.',
      options: [
        { id: 'a', label: 'A', consequence: 'A decides.' },
        { id: 'b', label: 'B', consequence: 'B decides.' },
      ],
      recommendation: null,
      recommendation_reason: null,
      blocked_work: [],
      unblocked_work: [],
      action: null,
      expires_at: inHours(1),
    }),
  );
  // A mode that disagrees with the run's research condition is refused.
  const r = await s.store.createEntity(owner, s.ws.id, {
    kind: 'run',
    title: 'Mismatch',
    body: {
      state: 'queued',
      experiment_condition: 'autonomous',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  await rejects(
    'INVALID_CONTRACT',
    s.store.registerRun(owner, s.ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    }),
  );
});

test('human-only runs are denied model calls even with a grant, and the denial is recorded', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('human_only');
  await s.standing(['model.summarize', 'record.revise'], run.run_id);
  const denied = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action({ action_type: 'model.summarize', target: null }),
  );
  assert.equal(denied.verdict, 'deny');
  assert.equal(denied.reason_code, 'human_only_model_denied');
  assert.equal(
    (await s.store.admitAction(owner, s.ws.id, run.run_id, s.action())).verdict,
    'allow',
  );
  const log = await s.store.listAdmissions(owner, s.ws.id, run.run_id);
  assert.deepEqual(log.map((a) => a.verdict).sort(), ['allow', 'deny']);
});

test('build commitment passes the humility gate, then a judgment on ethics, then an exact approval', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised');
  const product = await s.store.createEntity(owner, s.ws.id, {
    kind: 'product',
    title: 'Roster app',
    body: { stage: 'captured', summary: 'Roster with reminders.' },
  });
  const c = (viable: boolean) => ({
    assessment: 'Synthetic comparison.',
    viable,
    evidence_refs: [{ id: s.idea.id, version: 1 }],
  });
  const body = (disposition: string, ethical: string) => ({
    subject: { id: product.id, version: 1 },
    outcome_that_matters: 'Volunteers know their shifts.',
    whose_perspective: 'Volunteers.',
    evidence: {
      supported: ['Missed shifts reported'],
      inferred: [],
      disputed: [],
      unknown: [],
    },
    comparisons: {
      software: c(true),
      existing_tool: c(true),
      process_change: c(true),
      human_led: c(false),
      hybrid: c(true),
      defer_decline: c(true),
    },
    software_part: 'Reminders.',
    human_part: 'Assigning shifts.',
    burden_risks: ['Volunteers without phones'],
    disconfirming_test: 'Paper roster for two weeks.',
    change_course_trigger: 'Paper roster removes the gaps.',
    ethical: { status: ethical, note: 'Contact details are personal data.' },
    disposition,
    rationale: 'Reminders need a link existing tools lack.',
    dissent: ['A paper roster may be enough.'],
  });
  const reviewRecord = await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Roster humility review',
    body: body('use_existing', 'none_identified'),
  });
  const commit = s.action({
    action_type: 'product.commit_build',
    target: { id: product.id, version: 1 },
    humility_review: { id: reviewRecord.id, version: 1 },
  });
  assert.equal(
    (await s.store.admitAction(owner, s.ws.id, run.run_id, commit)).reason_code,
    'humility_gate_failed',
  );
  assert.equal(
    (await s.store.humilityVerdict(owner, s.ws.id, reviewRecord.id))
      .build_admissible,
    false,
  );
  await s.store.reviseEntity(owner, s.ws.id, reviewRecord.id, {
    expected_version: 1,
    title: 'Roster humility review',
    body: body('build', 'unresolved_serious'),
    reason: 'Comparison updated',
    corrects_version: null,
  });
  const v2 = {
    ...commit,
    humility_review: { id: reviewRecord.id, version: 2 },
  };
  const ethics = await s.store.admitAction(owner, s.ws.id, run.run_id, v2);
  assert.equal(ethics.verdict, 'request_human');
  const judgment = await s.store.getDecision(
    owner,
    s.ws.id,
    ethics.decision_id!,
  );
  assert.equal(judgment.kind, 'judgment');
  assert.equal(judgment.coverage.once, null);
  // An approval cannot answer the value question.
  await rejects('INVALID_CONTRACT', s.approve(judgment));
  await s.store.answerDecision(owner, s.ws.id, judgment.id, {
    choice: 'choose_option',
    option_id: 'proceed',
    rationale: 'Only first names are stored; consent form added.',
    coverage_hash: judgment.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: 30000,
    interruption: 'useful',
  });
  const gate = await s.store.admitAction(owner, s.ws.id, run.run_id, v2);
  assert.deepEqual(gate.reasons, ['stage_gate']);
  const authorization = await s.store.getDecision(
    owner,
    s.ws.id,
    gate.decision_id!,
  );
  assert.equal(authorization.kind, 'authorization');
  // Commitment is stage-gated, so a standing approval is not offered.
  assert.equal(authorization.coverage.standing, null);
  await s.approve(authorization);
  assert.equal(
    (await s.store.admitAction(owner, s.ws.id, run.run_id, v2)).verdict,
    'allow',
  );
  assert.equal((await s.store.verifyAuditChain()).ok, true);
});

test('standing approval from a decision creates a run-scoped, expiring policy grant', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('human_in_loop');
  const a = await s.store.admitAction(owner, s.ws.id, run.run_id, s.action());
  const d = await s.store.getDecision(owner, s.ws.id, a.decision_id!);
  assert.deepEqual(d.coverage.standing?.action_types, ['record.revise']);
  assert.equal(d.coverage.standing?.run_id, run.run_id);
  const answered = await s.approve(d, {
    choice: 'approve_standing',
    standing_expires_at: inHours(48),
  });
  const g = (await s.store.listGrants(owner, s.ws.id)).find(
    (x) => x.id === answered.response?.grant_id,
  );
  assert.equal(g?.scope, 'standing');
  assert.equal(g?.run_id, run.run_id);
  for (let i = 0; i < 2; i++)
    assert.equal(
      (await s.store.admitAction(owner, s.ws.id, run.run_id, s.action()))
        .verdict,
      'allow',
    );
  // Revoking the policy stops it at once.
  await s.store.revokeGrant(owner, s.ws.id, g!.id, {
    expected_version: 1,
    reason: 'Enough edits.',
  });
  assert.equal(
    (await s.store.admitAction(owner, s.ws.id, run.run_id, s.action())).verdict,
    'request_human',
  );
  // Publishing is irreversible and external: approve-once only.
  const publish = await s.store.admitAction(
    owner,
    s.ws.id,
    run.run_id,
    s.action({ action_type: 'release.publish' }),
  );
  const pd = await s.store.getDecision(owner, s.ws.id, publish.decision_id!);
  assert.equal(pd.coverage.standing, null);
});
