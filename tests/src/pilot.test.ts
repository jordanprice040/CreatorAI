import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BLOCKING_DECISIONS,
  PROPOSED_PROTOCOL,
  canonicalHash,
  classifyAttempt,
  estimateDesigns,
  freezeProtocol,
  instrumentationChecks,
  reviewerPacket,
  type PilotAttempt,
} from '@creator/domain';
import { StudyStore } from '@creator/db';
import { FixtureAdapter, ModelBroker } from '@creator/broker';
import { runPilotRehearsal } from '@creator/orchestrator';
import { freshDatabase } from './pg-harness.js';

const proposalHash = canonicalHash(PROPOSED_PROTOCOL);
const allAnswered = () =>
  BLOCKING_DECISIONS.map((d) => ({
    id: d.id,
    choice: d.recommendation,
    rationale: 'Owner test answer',
  }));

test('freeze stays blocked until every research decision is answered against the exact proposal', () => {
  const none = freezeProtocol(PROPOSED_PROTOCOL, {
    proposal_hash: proposalHash,
    decisions: [],
  });
  assert.equal(none.status, 'blocked');
  assert.deepEqual(
    none.status === 'blocked' && none.blocking,
    BLOCKING_DECISIONS.map((d) => d.id),
  );
  const deferred = allAnswered().map((d) =>
    d.id === 'RD5-human-subjects' ? { ...d, choice: 'Pending review' } : d,
  );
  const partial = freezeProtocol(PROPOSED_PROTOCOL, {
    proposal_hash: proposalHash,
    decisions: deferred,
  });
  assert.deepEqual(partial.status === 'blocked' && partial.blocking, [
    'RD5-human-subjects',
  ]);
  assert.equal(
    freezeProtocol(PROPOSED_PROTOCOL, {
      proposal_hash: '0'.repeat(64),
      decisions: allAnswered(),
    }).status,
    'blocked',
    'Answers recorded against another proposal cannot freeze this one.',
  );
  assert.equal(
    freezeProtocol(PROPOSED_PROTOCOL, {
      proposal_hash: proposalHash,
      decisions: [
        ...allAnswered(),
        { id: 'RD99', choice: 'x', rationale: 'y' },
      ],
    }).status,
    'blocked',
  );
  const adopted = freezeProtocol(PROPOSED_PROTOCOL, {
    proposal_hash: proposalHash,
    decisions: allAnswered(),
  });
  assert.equal(adopted.status, 'adopted');
  const changed = freezeProtocol(PROPOSED_PROTOCOL, {
    proposal_hash: proposalHash,
    decisions: allAnswered().map((d) =>
      d.id === 'RD7-design-counts' ? { ...d, choice: 'minimal' } : d,
    ),
  });
  assert.notEqual(
    adopted.status === 'adopted' && adopted.freeze_hash,
    changed.status === 'adopted' && changed.freeze_hash,
  );
});

const base: PilotAttempt = {
  arm: 'C',
  id: '11111111-1111-4111-8111-111111111111',
  workspace_id: '22222222-2222-4222-8222-222222222222',
  condition: 'human_only',
  discovery_method: 'human_defined',
  state: 'submitted',
  primary: true,
  time_cap_seconds: 60,
  finish: { status: 'submitted' },
  measurements: { wall_seconds: 10, calls: 0, human_active_minutes: 0 },
  reservations: [],
  events: [{ kind: 'finished', payload: {} }],
  context: { packet: 'neutral' },
  human_source: 'scripted_rehearsal',
};
const failed = (attempts: PilotAttempt[], packet: unknown = { items: [] }) =>
  instrumentationChecks({
    attempts,
    sentinels: ['LEAK_SENTINEL'],
    export_hashes: [['a', 'a']],
    reviewer_packet: packet,
    reviewer_key: Object.fromEntries(attempts.map((a, i) => [i, a.id])),
  })
    .filter((c) => c.status === 'fail')
    .map((c) => c.id);

test('instrumentation checks catch leaks, unblinded packets, hidden model use and impossible timing', () => {
  assert.deepEqual(failed([base]), []);
  assert.deepEqual(failed([{ ...base, context: { x: 'LEAK_SENTINEL' } }]), [
    'contamination.cross_arm_and_grader',
  ]);
  assert.deepEqual(failed([base], { items: [{ note: 'human_only arm' }] }), [
    'reviewer.blinding',
  ]);
  assert.deepEqual(failed([base], { items: [{ ref: base.workspace_id }] }), [
    'reviewer.blinding',
  ]);
  assert.deepEqual(
    failed([
      {
        ...base,
        reservations: [{ status: 'settled' }],
        measurements: { ...base.measurements, calls: 1 },
      },
    ]),
    ['contamination.human_only_no_model.C'],
  );
  const assisted: PilotAttempt = {
    ...base,
    arm: 'B',
    condition: 'human_in_loop',
    discovery_method: 'structured',
    finish: { status: 'submitted', outcome: 'insufficient_evidence' },
    measurements: { wall_seconds: 10, calls: 1, human_active_minutes: 1 },
    events: [
      {
        kind: 'interventions',
        payload: { wait_seconds: 30, human_active_minutes: 0 },
      },
      { kind: 'finished', payload: {} },
    ],
  };
  assert.deepEqual(failed([assisted]), ['timing.interventions.B']);
  assert.deepEqual(
    failed([{ ...base, finish: null, state: 'assigned' }]).sort(),
    ['metrics.terminal'],
  );
  assert.deepEqual(failed([base, { ...base, id: randomUUID() }]), [
    'contamination.separate_workspaces',
  ]);
});

test('failures are classified as instrumentation or substantive and both are kept', () => {
  assert.equal(
    classifyAttempt({ ...base, finish: null }).class,
    'instrumentation',
  );
  assert.equal(
    classifyAttempt({
      ...base,
      measurements: { unknown_simulated_exposure_nano_usd: '5' },
    }).class,
    'instrumentation',
  );
  assert.equal(
    classifyAttempt({
      ...base,
      state: 'needs_human',
      finish: { status: 'needs_human', outcome: 'needs_human' },
    }).class,
    'substantive',
  );
  assert.equal(
    classifyAttempt({ ...base, state: 'failed', finish: { status: 'failed' } })
      .class,
    'instrumentation',
  );
});

test('reviewer packet order and codes depend on the seed, never on condition', () => {
  const items = [1, 2, 3].map((n) => ({
    attempt_id: `0000000${n}-0000-4000-8000-000000000000`,
    task: 't',
    text: null,
  }));
  const a = reviewerPacket(items, 's1'),
    b = reviewerPacket(items, 's2');
  assert.equal(Object.keys(a.key).length, 3);
  assert.notDeepEqual(Object.keys(a.key), Object.keys(b.key));
  assert.doesNotMatch(JSON.stringify(a.packet), /0000000[123]-/);
});

test('design estimate is an exact upper bound from caps and documented rates', () => {
  const [minimal] = estimateDesigns({
    max_calls: 7,
    max_output_tokens: 2000,
    observed_max_input_tokens: 1000,
    time_cap_minutes: 60,
    implementation_time_cap_minutes: 90,
    reviewer_minutes_per_item: 15,
  });
  // 7 calls x (1000 x $10/M + 2000 x $50/M) = $0.77 per AI run; 8 AI runs.
  assert.equal(minimal!.ai_runs, 8);
  assert.equal(minimal!.max_ai_exposure_usd, '6.16');
  assert.equal(minimal!.max_participant_hours, 7);
});

test('pilot rehearsal runs every arm through the real study path and freezes only with owner answers', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new StudyStore(db.pool);
  const owner = { actorId: randomUUID() },
    stranger = { actorId: randomUUID() };
  for (const a of [owner, stranger])
    await store.ensureActor({
      id: a.actorId,
      kind: 'human',
      display_name: 'Pilot test actor',
    });
  const adapter = new FixtureAdapter();
  const broker = new ModelBroker(store, { fixture: adapter, live: null });
  const result = await runPilotRehearsal(store, broker, owner);
  const pkg = result.package;
  const again = await runPilotRehearsal(store, broker, owner);
  assert.equal(again.package.reproducible_digest, pkg.reproducible_digest);
  assert.notEqual(again.package.workspace_id, pkg.workspace_id);
  assert.equal(pkg.empirical_results, false);
  assert.deepEqual(
    pkg.flow.map((f) => f.arm),
    ['A', 'B', 'C', 'D-structured', 'D-open'],
  );
  assert.deepEqual(
    pkg.checks.filter((c) => c.status === 'fail'),
    [],
    'Every instrumentation check passes on the rehearsal.',
  );
  assert.ok(pkg.flow.every((f) => f.state !== 'assigned'));
  assert.equal(
    pkg.flow.find((f) => f.arm === 'C')!.human_source,
    'scripted_rehearsal',
  );
  assert.equal(
    adapter.calls,
    8,
    'Only the four AI arms of each run reach the adapter.',
  );
  assert.doesNotMatch(
    JSON.stringify(result.reviewer_packet),
    /autonomous|human_only|open_ended|structured/,
  );
  assert.equal(Object.keys(result.reviewer_key.codes).length, 5);
  const proposal = { proposal_hash: proposalHash, decisions: [] };
  await assert.rejects(
    store.freezeStudyProtocol(owner, pkg.workspace_id, proposal),
    (e: Error & { details?: string[] }) =>
      e.details?.length === BLOCKING_DECISIONS.length,
  );
  await assert.rejects(
    store.freezeStudyProtocol(stranger, pkg.workspace_id, {
      ...proposal,
      decisions: allAnswered(),
    }),
  );
  const frozen = await store.freezeStudyProtocol(owner, pkg.workspace_id, {
    ...proposal,
    decisions: allAnswered(),
  });
  assert.equal(frozen.status, 'adopted');
  const audit = await db.pool.query(
    "select content_hash from audit_events where action='study.protocol_frozen'",
  );
  assert.equal(audit.rows[0]?.content_hash, frozen.freeze_hash);
});
