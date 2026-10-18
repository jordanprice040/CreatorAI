import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  studyManifest,
  studyContext,
  SYNTHETIC_STUDY,
  canonicalHash,
} from '@creator/domain';
import { StudyStore } from '@creator/db';
import { Worker } from '@creator/orchestrator';
import { FixtureAdapter, ModelBroker } from '@creator/broker';
import { freshDatabase } from './pg-harness.js';

test('manifest changes bind packet/config; baseline context excludes rubric and structured prompt', () => {
  const frozen = studyManifest(SYNTHETIC_STUDY);
  for (const changed of [
    {
      ...SYNTHETIC_STUDY,
      packet: {
        ...SYNTHETIC_STUDY.packet,
        problem: 'Changed',
        structured_brief: {
          ...SYNTHETIC_STUDY.packet.structured_brief,
          measurable_problem: 'Changed',
        },
      },
    },
    { ...SYNTHETIC_STUDY, config: { ...SYNTHETIC_STUDY.config, max_calls: 8 } },
  ])
    assert.notEqual(studyManifest(changed).manifest_hash, frozen.manifest_hash);
  assert.throws(() =>
    studyManifest({
      ...SYNTHETIC_STUDY,
      packet: {
        ...SYNTHETIC_STUDY.packet,
        problem: 'Different problem for one arm',
      },
    }),
  );
  const baseline = studyContext(SYNTHETIC_STUDY, {
    condition: 'autonomous',
    discovery_method: 'open_ended',
  });
  assert.equal('rubric' in baseline, false);
  assert.doesNotMatch(
    baseline.prompt.text,
    /skeptic|rubric|independent alternatives/,
  );
  assert.throws(() =>
    studyManifest({ ...SYNTHETIC_STUDY, hidden_label: 'LEAK' }),
  );
  assert.throws(() =>
    studyContext(SYNTHETIC_STUDY, {
      condition: 'human_only',
      discovery_method: 'structured',
    }),
  );
});

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new StudyStore(db.pool),
    owner = { actorId: randomUUID() },
    person = { actorId: randomUUID() },
    grader = { actorId: randomUUID() };
  for (const actor of [owner, person, grader])
    await store.ensureActor({
      id: actor.actorId,
      kind: 'human',
      display_name: 'Synthetic test actor',
    });
  const ws = await store.createWorkspace(owner, {
    name: 'Synthetic study',
    record_mode: 'fixture',
  });
  const study = await store.createStudy(owner, ws.id, SYNTHETIC_STUDY);
  const assign = (
    condition: 'autonomous' | 'human_only' | 'human_in_loop',
    over: Record<string, unknown> = {},
  ) =>
    store.assignStudy(owner, ws.id, study.id, {
      manifest_hash: study.manifest_hash,
      participant_actor_id: person.actorId,
      participant_code: 'P01',
      prior_familiarity: 'Synthetic only',
      condition,
      discovery_method:
        condition === 'human_only' ? 'human_defined' : 'structured',
      continuation_of: null,
      ...over,
    });
  return { db, store, owner, person, grader, ws, study, assign };
}

test('study participant and grader isolation, frozen records, terminal failures and complete repeatable export', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, owner, person, grader, ws, study, assign, db } = s;
  const a = await assign('autonomous');
  const b = await assign('human_in_loop');
  const c = await assign('human_only');
  assert.equal(
    new Set([a.workspace_id, b.workspace_id, c.workspace_id]).size,
    3,
  );
  await store.grantGrader(owner, ws.id, study.id, { actor_id: grader.actorId });
  await store.graderMaterial(grader, ws.id, study.id, {
    kind: 'hidden_test',
    content: 'SECRET_GRADER_SENTINEL',
  });
  await assert.rejects(store.graderMaterial(person, ws.id, study.id));
  await assert.rejects(store.graderMaterial(owner, ws.id, study.id));
  await assert.rejects(
    store.grantGrader(owner, ws.id, study.id, { actor_id: person.actorId }),
  );
  await assert.rejects(
    assign('human_only', { participant_actor_id: grader.actorId }),
  );
  await assert.rejects(assign('autonomous', { manifest_hash: '0'.repeat(64) }));
  await assert.rejects(store.listEntities(person, a.workspace_id, {}));
  await store.writeAttempt(person, ws.id, b.id, 'artifacts', {
    kind: 'document',
    name: 'B output',
    content: 'OTHER_ARM_SENTINEL',
  });
  const context = await store.participantContext(person, ws.id, c.id);
  assert.doesNotMatch(
    JSON.stringify(context),
    /OTHER_ARM_SENTINEL|SECRET_GRADER_SENTINEL/,
  );
  assert.equal(c.context_hash, canonicalHash(context.context));
  await assert.rejects(
    store.writeAttempt(person, ws.id, c.id, 'artifacts', {
      kind: 'document',
      name: 'x',
      content: 'text',
      context: { hidden_label: 'injected' },
    }),
  );
  const intervention = {
    type: 'judgment',
    gate: 'dynamic',
    reason: 'Missing stakeholder choice',
    trigger: 'uncertainty',
    stage: 'selection',
    data_shown: 'Frozen packet',
    human_input: 'Use a checklist',
    resulting_change: 'Prefer existing document',
    prevented_problem: 'unknown',
    human_active_minutes: 2,
    wait_seconds: 4,
  };
  await assert.rejects(
    store.writeAttempt(person, ws.id, a.id, 'interventions', intervention),
  );
  await store.writeAttempt(person, ws.id, b.id, 'interventions', intervention);
  await store.writeAttempt(person, ws.id, a.id, 'finish', {
    status: 'needs_human',
    summary: 'Needs stakeholder choice.',
    human_active_minutes: 0,
    human_wait_seconds: 0,
  });
  await assert.rejects(
    store.writeAttempt(person, ws.id, a.id, 'finish', {
      status: 'submitted',
      summary: 'Relabeled',
      human_active_minutes: 0,
      human_wait_seconds: 0,
    }),
  );
  const continuation = await assign('human_in_loop', { continuation_of: a.id });
  assert.equal(continuation.primary, false);
  const artifact = await store.writeAttempt(person, ws.id, c.id, 'artifacts', {
    kind: 'document',
    name: 'answer',
    content: 'A shared checklist.',
  });
  assert.ok('content_hash' in artifact);
  const checked = await store.writeAttempt(person, ws.id, c.id, 'tests', {
    artifact_id: artifact.id,
    artifact_hash: artifact.content_hash,
    check: 'contains',
    expected: 'checklist',
  });
  assert.equal('passed' in checked && checked.passed, true);
  await assert.rejects(
    store.writeAttempt(person, ws.id, b.id, 'tests', {
      artifact_id: artifact.id,
      artifact_hash: artifact.content_hash,
      check: 'contains',
      expected: 'checklist',
    }),
  );
  await store.writeAttempt(person, ws.id, c.id, 'finish', {
    status: 'submitted',
    summary: 'Unverified participant submission.',
    human_active_minutes: 3,
    human_wait_seconds: 0,
  });
  await assert.rejects(
    db.pool.query('update studies set manifest_hash=$1 where id=$2', [
      '0'.repeat(64),
      study.id,
    ]),
  );
  const exported = await store.exportStudy(owner, ws.id, study.id);
  assert.equal(exported.attempts.length, 4);
  assert.equal(exported.empirical_results, false);
  assert.equal(
    exported.attempts.find((x) => x.id === a.id)!.state,
    'needs_human',
  );
  assert.equal(
    exported.export_hash,
    (await store.exportStudy(owner, ws.id, study.id)).export_hash,
  );
  assert.doesNotMatch(JSON.stringify(exported), /SECRET_GRADER_SENTINEL/);
  assert.ok(exported.raw_events.some((e) => e.kind === 'tests'));
  await assert.rejects(store.exportStudy(person, ws.id, study.id));
});

test('human-only denies every broker action and helper with zero adapter calls and durable denial evidence', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, owner, person, ws, assign } = s;
  const a = await assign('human_only');
  const pricing = await store.createPricing(
    owner,
    a.workspace_id,
    JSON.parse(readFileSync('config/pricing/fixture-model-v1.json', 'utf8')),
  );
  const envelope = await store.createEnvelope(owner, a.workspace_id, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Synthetic',
    cap_nano_usd: '1000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 1,
  });
  const adapter = new FixtureAdapter();
  const broker = new ModelBroker(store, { fixture: adapter, live: null });
  for (const action_type of [
    'model.generate',
    'model.summarize',
    'model.embed',
    'tool.search_public',
  ]) {
    const result = await broker.call(owner, a.workspace_id, a.run_id, {
      envelope_id: envelope.id,
      action_type,
      task_id: null,
      logical_operation_id: randomUUID(),
      pricing_snapshot_id: pricing.id,
      data_class: 'synthetic',
      input: [
        { role: 'user', text: 'Do not help this human-only participant' },
      ],
      max_output_tokens: 100,
      output_format: 'text',
      tool: action_type === 'tool.search_public' ? 'search_public' : null,
      max_attempts: 1,
      timeout_ms: 5000,
      justification: 'Synthetic denial test',
    });
    assert.equal(result.status, 'denied');
  }
  for (const helper of [
    'model.generate',
    'model.summarize',
    'model.rewrite',
    'model.complete',
    'tool.metered',
    'workflow',
    'discovery',
  ]) {
    const result = await store.writeAttempt(person, ws.id, a.id, 'helpers', {
      helper,
    });
    assert.equal('allowed' in result && result.allowed, false);
  }
  assert.equal(adapter.calls, 0);
  assert.equal(
    (await store.attemptEntries(person, ws.id, a.id)).filter(
      (x) => x.kind === 'helper_denied',
    ).length,
    7,
  );
  const exported = await store.exportStudy(owner, ws.id, a.study_id);
  assert.equal(exported.attempts[0]!.reservations.length, 4);
});

test('real structured worker and open-ended broker paths stay inside frozen study contexts', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, owner, ws, assign } = s;
  const adapter = new FixtureAdapter(),
    broker = new ModelBroker(store, { fixture: adapter, live: null });
  const baseline = await assign('autonomous', {
    discovery_method: 'open_ended',
    comparison: 'discovery',
  });
  const prepared = await store.prepareStudyExecution(owner, ws.id, baseline.id);
  assert.doesNotMatch(
    JSON.stringify(prepared.request.input),
    /skeptic|rubric|structured_brief/,
  );
  const changed = await broker.call(
    owner,
    baseline.workspace_id,
    baseline.run_id,
    {
      ...prepared.request,
      logical_operation_id: randomUUID(),
      input: [{ role: 'user', text: 'SECRET_FROM_OTHER_ARM' }],
    },
  );
  assert.equal(changed.status, 'denied');
  assert.equal(adapter.calls, 0);
  // A denial cannot consume the authorized logical operation; use the exact request next.
  const result = await broker.call(
    owner,
    baseline.workspace_id,
    baseline.run_id,
    prepared.request,
  );
  assert.equal(result.status, 'succeeded');
  await store.recordBaselineOutcome(owner, ws.id, baseline.id, result);
  const structured = await assign('autonomous');
  const p = await store.prepareStudyExecution(owner, ws.id, structured.id);
  const workflow = await store.startDiscovery(
    { ...owner, idempotencyKey: `study:${structured.id}:workflow` },
    structured.workspace_id,
    structured.run_id,
    p.request,
  );
  const worker = new Worker(store, broker);
  await worker.settle();
  const completed = await store.getWorkflow(
    owner,
    structured.workspace_id,
    workflow.workflow.id,
  );
  assert.ok(completed.workflow.finished_at);
  assert.equal(
    completed.workflow.result?.outcome,
    'insufficient_evidence',
    'Unverified snapshots must not become verified supporting evidence.',
  );
  const detail = await store.studyDetail(owner, ws.id, structured.study_id);
  assert.equal(
    detail.attempts.find((a) => a.id === structured.id)!.state,
    'failed',
  );
  assert.equal(
    detail.attempts.find((a) => a.id === baseline.id)!.state,
    'submitted',
  );
  const human = await assign('human_only');
  await assert.rejects(store.prepareStudyExecution(owner, ws.id, human.id));
  await assert.rejects(
    store.startDiscovery(owner, human.workspace_id, human.run_id, p.request),
  );
  await assert.rejects(
    store.startWorkflow(owner, human.workspace_id, human.run_id, {
      role: 'r05_skeptic',
      subject: p.request.brief,
      constraints: [],
      perspectives: ['test'],
      envelope_id: p.request.envelope_id,
      pricing_snapshot_id: p.request.pricing_snapshot_id,
      data_class: 'synthetic',
      limits: p.request.limits,
    }),
  );
});

test('concurrent finish preserves one outcome; changed structured inputs and cross-participant reads are refused', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, owner, person, grader, ws, assign, db } = s;
  const a = await assign('human_only');
  await assert.rejects(store.participantContext(grader, ws.id, a.id));
  const outcomes = await Promise.allSettled(
    ['failed', 'needs_human'].map((status) =>
      store.writeAttempt(person, ws.id, a.id, 'finish', {
        status,
        summary: 'Synthetic race',
        human_active_minutes: 0,
        human_wait_seconds: 0,
      }),
    ),
  );
  assert.equal(outcomes.filter((x) => x.status === 'fulfilled').length, 1);
  const rows = await db.pool.query(
    "select * from study_events where attempt_id=$1 and kind='finished'",
    [a.id],
  );
  assert.equal(rows.rowCount, 1);
  const ai = await assign('autonomous');
  const p = await store.prepareStudyExecution(owner, ws.id, ai.id);
  const request = p.request as { evidence: { claim_id: string }[] };
  await store.reviseEntity(
    owner,
    ai.workspace_id,
    request.evidence[0]!.claim_id,
    {
      expected_version: 1,
      title: 'Tampered packet',
      body: {
        statement: 'OTHER_ARM_OUTPUT',
        basis: 'observation',
        uncertainty: 'Synthetic injected material',
      },
      reason: 'Attempt to alter frozen context',
      corrects_version: null,
    },
  );
  await assert.rejects(
    store.startDiscovery(owner, ai.workspace_id, ai.run_id, p.request),
  );
  assert.equal(
    (
      await db.pool.query(
        'select count(*)::int as n from workflows where run_id=$1',
        [ai.run_id],
      )
    ).rows[0]!.n,
    0,
  );
});

test('late outputs retain charges and artifacts without completing an expired assignment; stopped attempts deny further dispatch', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, owner, person, ws, assign } = s;
  const a = await assign('autonomous', {
    comparison: 'discovery',
    discovery_method: 'open_ended',
  });
  const prepared = await store.prepareStudyExecution(owner, ws.id, a.id);
  const adapter = new FixtureAdapter(),
    broker = new ModelBroker(store, { fixture: adapter, live: null });
  const result = await broker.call(
    owner,
    a.workspace_id,
    a.run_id,
    prepared.request,
  );
  assert.equal(result.status, 'succeeded');
  const clock = t.mock.method(
    Date,
    'now',
    () => Date.parse(a.created_at) + 3_601_000,
  );
  try {
    assert.equal(
      (await store.recordBaselineOutcome(owner, ws.id, a.id, result)).state,
      'failed',
    );
  } finally {
    clock.mock.restore();
  }
  const exported = await store.exportStudy(owner, ws.id, a.study_id);
  assert.ok(
    BigInt(exported.attempts[0]!.measurements.known_simulated_spend_nano_usd) >
      0n,
  );
  assert.ok(exported.raw_events.some((e) => e.kind === 'artifacts'));
  assert.equal(
    exported.raw_events.find((e) => e.kind === 'finished')!.payload.outcome,
    'deadline_exceeded',
  );
  const stopped = await assign('autonomous');
  const p = await store.prepareStudyExecution(owner, ws.id, stopped.id);
  await store.writeAttempt(person, ws.id, stopped.id, 'finish', {
    status: 'cancelled',
    summary: 'Operator stop',
    human_active_minutes: 0,
    human_wait_seconds: 0,
  });
  await assert.rejects(
    store.startDiscovery(
      owner,
      stopped.workspace_id,
      stopped.run_id,
      p.request,
    ),
  );
  const denied = await broker.call(
    owner,
    stopped.workspace_id,
    stopped.run_id,
    {
      ...prepared.request,
      envelope_id: p.request.envelope_id,
      pricing_snapshot_id: p.request.pricing_snapshot_id,
      logical_operation_id: randomUUID(),
    },
  );
  assert.equal(denied.status, 'denied');
  assert.equal(denied.reason_code, 'study_stopped');
  assert.equal(adapter.calls, 1);
});

test('seed retries return the same assignments and agent identities cannot receive grader material', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, owner, ws } = s;
  const ctx = { ...owner, idempotencyKey: 'synthetic-seed-retry-1' };
  const first = await store.seedStudy(ctx, ws.id),
    second = await store.seedStudy(ctx, ws.id);
  assert.deepEqual(first, second);
  const agentId = randomUUID();
  await store.ensureActor({
    id: agentId,
    kind: 'agent',
    display_name: 'Synthetic agent',
  });
  await assert.rejects(
    store.grantGrader(owner, ws.id, first.study.id, { actor_id: agentId }),
  );
});
