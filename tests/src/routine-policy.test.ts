import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  routinePolicySummary,
  type ActionRequest,
  type AutonomyMode,
  type Decision,
  type ErrorCode,
  type RoutinePolicyInput,
} from '@creator/contracts';
import { OversightStore, type CommandContext } from '@creator/db';
import { freshDatabase } from './pg-harness.js';

// ADR-0079 (P10): routine approvals. These run against PostgreSQL through the store, the
// same path the API uses.
const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const agent: CommandContext = { actorId: randomUUID() };
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();

// One end time for every policy here, so only the fields a test changes differ.
const until = inHours(24);
const policy = (p: Partial<RoutinePolicyInput> = {}) => {
  const input: RoutinePolicyInput = {
    stages: ['model_work', 'selection', 'spec_freeze', 'build'],
    data_classes: ['synthetic'],
    max_actions: 20,
    max_total_nano_usd: null,
    stop_on: [],
    expires_at: until,
    rationale: 'Routine synthetic work for this run.',
    ...p,
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
    name: 'Routine approvals',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, agent.actorId, 'editor');
  const idea = await store.createEntity(owner, ws.id, {
    kind: 'idea',
    title: 'Shared roster',
    body: { summary: 'One roster.', uncertainty: 'Synthetic.' },
  });
  async function runEntity(mode: AutonomyMode, config_hash: string | null) {
    return store.createEntity(owner, ws.id, {
      kind: 'run',
      title: `${mode} run`,
      body: {
        state: 'queued',
        experiment_condition:
          mode === 'human_only'
            ? 'human_only'
            : mode === 'autonomous_within_scope'
              ? 'autonomous'
              : 'human_in_loop',
        discovery_method:
          mode === 'human_only' ? 'human_defined' : 'structured',
        config_hash,
      },
    });
  }
  async function run(
    mode: AutonomyMode,
    routine_policy: ReturnType<typeof policy> | null,
    config_hash: string | null = null,
    by: CommandContext = owner,
  ) {
    const r = await runEntity(mode, config_hash);
    return store.registerRun(by, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: mode,
      stage_gates: null,
      initial_grants: [],
      routine_policy,
    });
  }
  const action = (a: Partial<ActionRequest> = {}): ActionRequest => ({
    action_type: 'candidate.select',
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
  const model = (a: Partial<ActionRequest> = {}) =>
    action({ action_type: 'model.generate', target: null, ...a });
  const admit = (runId: string, a: ActionRequest, by = agent) =>
    store.admitAction(by, ws.id, runId, a);
  const answer = (d: Decision, choice: string) =>
    store.answerDecision(owner, ws.id, d.id, {
      choice,
      option_id: null,
      rationale: 'Reviewed.',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: 900,
      interruption: null,
    });
  const view = async (runId: string) =>
    (await store.listRoutinePolicies(owner, ws.id)).find(
      (v) => v.policy.run_id === runId,
    )!;
  return { db, store, ws, idea, run, action, model, admit, answer, view };
}

/** A product with a humility review whose disposition and ethical status the test chooses. */
async function reviewed(
  s: NonNullable<Awaited<ReturnType<typeof setup>>>,
  disposition: string,
  ethical: string,
) {
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
  const review = await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Roster humility review',
    body: {
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
    },
  });
  return s.action({
    action_type: 'product.commit_build',
    target: { id: product.id, version: 1 },
    humility_review: { id: review.id, version: 1 },
  });
}

test('a supervised run with a routine policy goes through model work, selection, spec freeze and build without one decision', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised', policy());
  const steps = [
    s.model(),
    s.model({ action_type: 'model.summarize' }),
    s.action(),
    s.action({ action_type: 'spec.freeze' }),
    await reviewed(s, 'build', 'none_identified'),
  ];
  const v0 = await s.view(run.run_id);
  for (const step of steps) {
    const a = await s.admit(run.run_id, step);
    assert.equal(a.verdict, 'allow', step.action_type);
    assert.equal(a.reason_code, 'covered_by_routine_policy');
    assert.match(a.explanation, /no person approved this step individually/);
    assert.equal(a.decision_id, null);
    // The admission names the policy's own grant at the version the owner confirmed.
    assert.deepEqual(a.covered_by, {
      grant_id: v0.policy.grant_id,
      grant_version: v0.policy.grant_version,
    });
  }
  assert.equal((await s.store.listDecisions(owner, s.ws.id)).length, 0);
  const v = await s.view(run.run_id);
  assert.equal(v.used_actions, steps.length);
  assert.equal(v.state, 'active');
  assert.equal(v.recent.length, steps.length);
  // No approve-once record was manufactured: the only grant is the policy's standing one.
  const grants = await s.store.listGrants(owner, s.ws.id);
  assert.deepEqual(
    grants.map((g) => [g.scope, g.status, g.allow_external_effects]),
    [['standing', 'active', false]],
  );
  // The run keeps its mode and condition; the policy changed neither.
  const listed = (await s.store.listRuns(owner, s.ws.id))[0]!;
  assert.equal(listed.autonomy_mode, 'supervised');
  assert.equal(listed.experiment_condition, 'human_in_loop');
  assert.ok(listed.stage_gates.includes('spec.freeze'));
  assert.equal((await s.store.verifyAuditChain()).ok, true);
});

test('without a policy the same supervised steps still ask, and a run set up without one cannot gain one', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised', null);
  const a = await s.admit(run.run_id, s.action());
  assert.equal(a.verdict, 'request_human');
  assert.equal(a.reason_code, 'stage_gate');
  assert.deepEqual(await s.store.listRoutinePolicies(owner, s.ws.id), []);
  // Registering the same run again (the only way a policy is created) is refused.
  const entity = (await s.store.listRuns(owner, s.ws.id))[0]!;
  await assert.rejects(
    s.store.registerRun(owner, s.ws.id, {
      run: { id: entity.run_id, version: 1 },
      autonomy_mode: 'supervised',
      stage_gates: null,
      initial_grants: [],
      routine_policy: policy(),
    }),
  );
  assert.deepEqual(await s.store.listRoutinePolicies(owner, s.ws.id), []);
});

test('steps outside the policy stop and ask; publishing, payments and other data are never covered', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run(
    'supervised',
    policy({ stages: ['selection'], max_total_nano_usd: '1000' }),
  );
  const asks = async (a: ActionRequest, reason: string) => {
    const r = await s.admit(run.run_id, a);
    assert.equal(r.verdict, 'request_human', a.action_type);
    assert.equal(r.reason_code, reason);
    assert.ok(r.decision_id);
  };
  // A stage the owner did not choose.
  await asks(s.action({ action_type: 'spec.freeze' }), 'stage_gate');
  await asks(
    s.action({ action_type: 'source.fetch', target: null }),
    'outside_grant',
  );
  // External effects are outside every routine policy.
  await asks(s.action({ action_type: 'release.publish' }), 'stage_gate');
  await asks(
    s.action({
      action_type: 'payment.charge',
      target: null,
      amount_nano_usd: '10',
    }),
    'outside_grant',
  );
  await asks(
    s.action({ action_type: 'github.write', target: null }),
    'outside_grant',
  );
  // Another data class.
  await asks(s.action({ data_class: 'private_approved' }), 'stage_gate');
  // Owner-only actions stay denied.
  assert.equal(
    (
      await s.admit(
        run.run_id,
        s.action({ action_type: 'policy.change', target: null }),
      )
    ).reason_code,
    'owner_only_action',
  );
  assert.equal((await s.view(run.run_id)).used_actions, 0);
  // The covered stage still goes through.
  assert.equal((await s.admit(run.run_id, s.action())).verdict, 'allow');
});

test('a policy is refused for autonomous, human-only and study runs, from an agent, and with a summary that does not match', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await rejects('INVALID_CONTRACT', s.run('autonomous_within_scope', policy()));
  await rejects('INVALID_CONTRACT', s.run('human_only', policy()));
  await rejects(
    'INVALID_CONTRACT',
    s.run('human_in_loop', policy(), 'a'.repeat(64)),
  );
  await rejects('ACCESS_DENIED', s.run('supervised', policy(), null, agent));
  // The owner confirmed a summary for 20 steps; the request asks for 500.
  await rejects(
    'VERSION_CONFLICT',
    s.run('supervised', { ...policy(), max_actions: 500 }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.run('supervised', policy({ expires_at: inHours(24 * 91) })),
  );
  assert.deepEqual(await s.store.listRoutinePolicies(owner, s.ws.id), []);
  // Human-only runs keep their model denial.
  const human = await s.run('human_only', null);
  assert.equal(
    (await s.admit(human.run_id, s.model())).reason_code,
    'human_only_model_denied',
  );
});

test('the step limit pauses honestly; an approval keeps the work going; a confirmed change resumes and is versioned', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('human_in_loop', policy({ max_actions: 2 }));
  assert.equal((await s.admit(run.run_id, s.model())).verdict, 'allow');
  assert.equal((await s.admit(run.run_id, s.model())).verdict, 'allow');
  // The policy's grant is not an ordinary standing grant: past the limit it covers nothing,
  // even an action no stage gate holds.
  const third = await s.admit(run.run_id, s.model());
  assert.equal(third.verdict, 'request_human');
  assert.equal(third.reason_code, 'outside_grant');
  assert.match(third.explanation, /limit of 2 steps is used up/);
  let v = await s.view(run.run_id);
  assert.equal(v.state, 'paused');
  assert.match(v.state_reason!, /used up/);
  const d = await s.store.getDecision(owner, s.ws.id, third.decision_id!);
  assert.match(d.uncertainty, /Routine approvals did not cover it/);
  // A person's one-time approval admits exactly that step; nothing was lost.
  await s.answer(d, 'approve_once');
  const once = await s.admit(run.run_id, s.model());
  assert.equal(once.verdict, 'allow');
  assert.equal(once.reason_code, 'covered');
  assert.equal((await s.view(run.run_id)).used_actions, 2);

  // A stale version, an unconfirmed summary and an agent are all refused.
  const wider = policy({ max_actions: 4 });
  await rejects(
    'VERSION_CONFLICT',
    s.store.reviseRoutinePolicy(owner, s.ws.id, v.policy.id, {
      ...wider,
      expected_version: 7,
    }),
  );
  await rejects(
    'VERSION_CONFLICT',
    s.store.reviseRoutinePolicy(owner, s.ws.id, v.policy.id, {
      ...wider,
      max_actions: 9,
      expected_version: 1,
    }),
  );
  await rejects(
    'ACCESS_DENIED',
    s.store.reviseRoutinePolicy(agent, s.ws.id, v.policy.id, {
      ...wider,
      expected_version: 1,
    }),
  );
  const revised = await s.store.reviseRoutinePolicy(
    owner,
    s.ws.id,
    v.policy.id,
    { ...wider, expected_version: 1 },
  );
  assert.equal(revised.version, 2);
  assert.equal(revised.grant_version, v.policy.grant_version + 1);
  const after = await s.admit(run.run_id, s.model());
  assert.equal(after.reason_code, 'covered_by_routine_policy');
  assert.equal(after.covered_by!.grant_version, revised.grant_version);
  // Narrowing below what is used pauses again.
  const narrowed = await s.store.reviseRoutinePolicy(
    owner,
    s.ws.id,
    v.policy.id,
    { ...policy({ max_actions: 1 }), expected_version: 2 },
  );
  assert.equal(narrowed.version, 3);
  assert.equal((await s.admit(run.run_id, s.model())).verdict, 'request_human');
  v = await s.view(run.run_id);
  assert.equal(v.used_actions, 3);
  const history = await s.db.pool.query(
    'select version, change from routine_policy_versions where policy_id = $1 order by version',
    [v.policy.id],
  );
  assert.deepEqual(
    history.rows.map((r) => [r.version, r.change]),
    [
      [1, 'created'],
      [2, 'widened'],
      [3, 'narrowed'],
    ],
  );
  await assert.rejects(
    s.db.pool.query('update routine_policy_versions set change = $1', [
      'narrowed',
    ]),
  );
  assert.equal((await s.store.verifyAuditChain()).ok, true);
});

test('the money total counts each admitted step and never covers an amount when no total is set', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run(
    'human_in_loop',
    policy({ stages: ['model_work'], max_total_nano_usd: '100' }),
  );
  const paid = (n: string) => s.model({ amount_nano_usd: n });
  assert.equal((await s.admit(run.run_id, paid('60'))).verdict, 'allow');
  const over = await s.admit(run.run_id, paid('41'));
  assert.equal(over.verdict, 'request_human');
  assert.match(over.explanation, /past the policy's total/);
  assert.equal((await s.admit(run.run_id, paid('40'))).verdict, 'allow');
  assert.equal((await s.view(run.run_id)).used_nano_usd, '100');
  // A single step above the whole total is simply not covered.
  assert.equal(
    (await s.admit(run.run_id, paid('101'))).verdict,
    'request_human',
  );
  const free = await s.run('human_in_loop', policy({ stages: ['model_work'] }));
  assert.equal(
    (await s.admit(free.run_id, paid('1'))).verdict,
    'request_human',
  );
  assert.equal((await s.admit(free.run_id, s.model())).verdict, 'allow');
});

test('value questions, a serious ethical problem and a failed humility review are not covered by a policy', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised', policy());
  const flagged = s.action({
    flags: [
      {
        reason: 'stakeholder_conflict',
        note: 'Two groups want opposite outcomes.',
        evidence_refs: [],
      },
    ],
  });
  const f = await s.admit(run.run_id, flagged);
  assert.equal(f.verdict, 'request_human');
  assert.equal(f.reason_code, 'stakeholder_conflict');
  const ethical = await s.admit(
    run.run_id,
    await reviewed(s, 'build', 'unresolved_serious'),
  );
  assert.equal(ethical.verdict, 'request_human');
  assert.equal(ethical.reason_code, 'ethical_judgment');
  const failed = await s.admit(
    run.run_id,
    await reviewed(s, 'use_existing', 'none_identified'),
  );
  assert.equal(failed.verdict, 'deny');
  assert.equal(failed.reason_code, 'humility_gate_failed');
  // A material assumption asks as well.
  const assumption = await s.store.createEntity(owner, s.ws.id, {
    kind: 'assumption',
    title: 'Volunteers have phones',
    body: {
      statement: 'Every volunteer has a phone.',
      consequence_if_wrong: 'Reminders reach no one.',
      would_change_decision: 'A paper roster instead.',
      status: 'unresolved',
      materiality: 'material',
      reversible: false,
      cheap_test: null,
      run_id: null,
    },
  });
  const m = await s.admit(
    run.run_id,
    s.action({ assumption_ids: [assumption.id] }),
  );
  assert.equal(m.reason_code, 'material_assumption');
  assert.equal((await s.view(run.run_id)).used_actions, 0);
  // Once the person answers the value question with "proceed", the policy admits the step.
  const d = await s.store.getDecision(owner, s.ws.id, f.decision_id!);
  await s.store.answerDecision(owner, s.ws.id, d.id, {
    choice: 'choose_option',
    option_id: 'proceed',
    rationale: 'The groups agreed.',
    coverage_hash: d.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: 500,
    interruption: null,
  });
  assert.equal(
    (await s.admit(run.run_id, flagged)).reason_code,
    'covered_by_routine_policy',
  );
});

test('an ordinary covering grant is used first, so the policy limit is not spent on it', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('human_in_loop', policy({ max_actions: 1 }));
  await s.store.createStandingGrant(owner, s.ws.id, {
    run_id: run.run_id,
    action_types: ['model.generate'],
    target_kind: null,
    max_amount_nano_usd: null,
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: inHours(2),
    rationale: 'Model calls for this run.',
  });
  for (let i = 0; i < 3; i++)
    assert.equal((await s.admit(run.run_id, s.model())).reason_code, 'covered');
  assert.equal((await s.view(run.run_id)).used_actions, 0);
});

test('concurrent steps never pass the limit', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised', policy({ max_actions: 3 }));
  const results = await Promise.all(
    Array.from({ length: 8 }, () => s.admit(run.run_id, s.model())),
  );
  assert.equal(results.filter((r) => r.verdict === 'allow').length, 3);
  assert.equal(results.filter((r) => r.verdict === 'request_human').length, 5);
  assert.equal((await s.view(run.run_id)).used_actions, 3);
});

test('stopping the run revokes the policy, and a stop racing with steps leaves nothing admitted afterwards', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised', policy());
  const settled = await Promise.all([
    ...Array.from({ length: 4 }, () => s.admit(run.run_id, s.model())),
    s.store.cancelRun(owner, s.ws.id, run.run_id, { reason: 'Stop.' }),
    ...Array.from({ length: 4 }, () => s.admit(run.run_id, s.model())),
  ]);
  const admissions = settled.filter(
    (r): r is Awaited<ReturnType<typeof s.admit>> => 'verdict' in r,
  );
  for (const a of admissions)
    assert.ok(
      a.reason_code === 'covered_by_routine_policy' ||
        a.reason_code === 'run_cancelled',
      a.reason_code,
    );
  const late = await s.admit(run.run_id, s.model());
  assert.equal(late.reason_code, 'run_cancelled');
  const v = await s.view(run.run_id);
  assert.equal(v.state, 'revoked');
  assert.equal(v.policy.revoke_reason, 'Run cancelled');
  assert.equal(
    v.used_actions,
    admissions.filter((a) => a.verdict === 'allow').length,
  );
  await rejects(
    'INVALID_TRANSITION',
    s.store.reviseRoutinePolicy(owner, s.ws.id, v.policy.id, {
      ...policy(),
      expected_version: v.policy.version,
    }),
  );
});

test('revoking stops routine admission at once and is final; the policy grant cannot be edited as a grant', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run('supervised', policy());
  assert.equal((await s.admit(run.run_id, s.action())).verdict, 'allow');
  const v = await s.view(run.run_id);
  const grant = (await s.store.listGrants(owner, s.ws.id))[0]!;
  await rejects(
    'INVALID_TRANSITION',
    s.store.reviseGrant(owner, s.ws.id, grant.id, {
      expected_version: grant.version,
      action_types: ['model.generate', 'release.publish'],
      target_kind: null,
      max_amount_nano_usd: null,
      allow_irreversible: true,
      allow_external_effects: true,
      data_classes: ['synthetic'],
      expires_at: inHours(48),
      rationale: 'Widen without the summary.',
    }),
  );
  await rejects(
    'ACCESS_DENIED',
    s.store.revokeRoutinePolicy(agent, s.ws.id, v.policy.id, {
      expected_version: 1,
      reason: 'Agent tries.',
    }),
  );
  const revoked = await s.store.revokeRoutinePolicy(
    owner,
    s.ws.id,
    v.policy.id,
    { expected_version: 1, reason: 'No longer wanted.' },
  );
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.revoke_reason, 'No longer wanted.');
  const next = await s.admit(run.run_id, s.action());
  assert.equal(next.verdict, 'request_human');
  assert.equal(next.reason_code, 'stage_gate');
  await rejects(
    'INVALID_TRANSITION',
    s.store.reviseRoutinePolicy(owner, s.ws.id, v.policy.id, {
      ...policy(),
      expected_version: revoked.version,
    }),
  );

  // Revoking the policy's grant from the grant list revokes the policy too.
  const other = await s.run('supervised', policy());
  const g = (await s.store.listGrants(owner, s.ws.id)).find(
    (x) => x.run_id === other.run_id,
  )!;
  await s.store.revokeGrant(owner, s.ws.id, g.id, {
    expected_version: g.version,
    reason: 'Revoked from the grant list.',
  });
  assert.equal((await s.view(other.run_id)).state, 'revoked');
  assert.equal(
    (await s.admit(other.run_id, s.action())).verdict,
    'request_human',
  );
});

test('the chosen stop conditions pause the policy: a rejection until it is confirmed again, an unknown paid outcome until reconciled', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run(
    'supervised',
    policy({
      stages: ['selection', 'model_work'],
      stop_on: ['person_rejects', 'unknown_outcome'],
    }),
  );
  assert.equal((await s.admit(run.run_id, s.action())).verdict, 'allow');
  // Something outside the policy asks, and the owner rejects it.
  const asked = await s.admit(
    run.run_id,
    s.action({ action_type: 'spec.freeze' }),
  );
  await s.answer(
    await s.store.getDecision(owner, s.ws.id, asked.decision_id!),
    'reject',
  );
  const stopped = await s.admit(run.run_id, s.action());
  assert.equal(stopped.verdict, 'request_human');
  assert.match(stopped.explanation, /rejected a decision/);
  let v = await s.view(run.run_id);
  assert.equal(v.state, 'paused');
  // Confirming the same policy again resumes it.
  const again = await s.store.reviseRoutinePolicy(owner, s.ws.id, v.policy.id, {
    ...policy({
      stages: ['selection', 'model_work'],
      stop_on: ['person_rejects', 'unknown_outcome'],
    }),
    expected_version: 1,
  });
  assert.equal(again.version, 2);
  assert.equal((await s.admit(run.run_id, s.model())).verdict, 'allow');

  // A paid call whose outcome is unknown pauses the policy until it is reconciled.
  const envelope = randomUUID();
  const reservation = randomUUID();
  await s.db.pool.query(
    `insert into budget_envelopes (id, workspace_id, fixture, kind, name, status, cap_nano,
       max_in_flight, created_by) values ($1, $2, true, 'global', 'Test', 'active', 1000, 1, $3)`,
    [envelope, s.ws.id, owner.actorId],
  );
  await s.db.pool.query(
    `insert into budget_reservations (id, workspace_id, fixture, envelope_id, run_id,
       logical_operation_id, attempt, request_hash, action_type, provider, model_id, status,
       reason_code, explanation, reserved_nano, created_by, finished_at)
     values ($1, $2, true, $3, $4, $5, 1, $6, 'model.generate', 'fixture', 'fixture-model-v1',
       'unknown', 'timeout', 'No answer came back.', 10, $7, now())`,
    [
      reservation,
      s.ws.id,
      envelope,
      run.run_id,
      randomUUID(),
      'b'.repeat(64),
      owner.actorId,
    ],
  );
  const unknown = await s.admit(run.run_id, s.model());
  assert.equal(unknown.verdict, 'request_human');
  assert.match(unknown.explanation, /unknown outcome/);
  v = await s.view(run.run_id);
  assert.equal(v.state, 'paused');
  await s.db.pool.query(
    `update budget_reservations set status = 'released' where id = $1`,
    [reservation],
  );
  assert.equal((await s.admit(run.run_id, s.model())).verdict, 'allow');
});
