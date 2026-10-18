import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  BLOCKING_DECISIONS,
  PROPOSED_PROTOCOL,
  admitSlot,
  blindedPackets,
  buildSchedule,
  canonicalHash,
  flowTable,
  rehearsalFreeze,
  retryPermitted,
  scanBlinding,
  type AttemptRecord,
  type EvaluationAuthority,
  type FrozenProtocol,
} from '@creator/domain';
import { StudyStore } from '@creator/db';
import { FixtureAdapter, ModelBroker } from '@creator/broker';
import {
  planFinalEvaluation,
  rehearsalTasks,
  runEvaluationRehearsal,
} from '@creator/orchestrator';
import { freshDatabase } from './pg-harness.js';

const tasks = rehearsalTasks();
const rehearsal: EvaluationAuthority = {
  mode: 'rehearsal',
  live_ai: { enabled: false, verified_model_id: null },
  final_study_records: false,
  ai_implementation: false,
};
const code = (e: unknown) => (e as { code: string }).code;

test('the schedule binds the exact freeze and frozen counts and refuses anything else', () => {
  const freeze = rehearsalFreeze();
  const s = buildSchedule(freeze, tasks, 'seed-a');
  // 6 autonomy tasks x 3 arms + 2 themes x 2 repeats x 2 methods.
  assert.equal(s.slots.length, 26);
  assert.equal(s.freeze_origin, 'rehearsal');
  for (const t of tasks.filter((x) => x.role === 'autonomy'))
    assert.deepEqual(
      s.slots
        .filter((x) => x.task_key === t.key)
        .map((x) => x.arm)
        .sort(),
      ['A', 'B', 'C'],
    );
  assert.equal(
    buildSchedule(freeze, tasks, 'seed-a').schedule_hash,
    s.schedule_hash,
  );
  const other = buildSchedule(freeze, tasks, 'seed-b');
  assert.notDeepEqual(
    other.slots.map((x) => x.slot_id),
    s.slots.map((x) => x.slot_id),
    'The seed changes the run order, not the slots.',
  );
  assert.deepEqual(
    other.slots.map((x) => x.slot_id).sort(),
    s.slots.map((x) => x.slot_id).sort(),
  );

  const refused = (f: FrozenProtocol, t = tasks) => {
    try {
      buildSchedule(f, t, 'seed-a');
      return null;
    } catch (e) {
      return code(e);
    }
  };
  assert.equal(refused(freeze, tasks.slice(1)), 'INVALID_CONTRACT');
  const pilot = tasks.map((t, i) =>
    i ? t : { ...t, packet: { ...t.packet, version: 'pilot-autonomy/1' } },
  );
  assert.equal(refused(freeze, pilot), 'INVALID_CONTRACT');
  assert.equal(
    refused({ ...freeze, freeze_hash: '0'.repeat(64) }),
    'EVIDENCE_MISMATCH',
  );
  // An adopted freeze recorded against an older proposal must be re-frozen.
  const stale = {
    ...freeze.manifest,
    proposal: { ...PROPOSED_PROTOCOL, version: 'older' },
  };
  stale.proposal_hash = canonicalHash(stale.proposal);
  assert.equal(
    refused({
      origin: 'adopted',
      manifest: stale,
      freeze_hash: canonicalHash(stale),
    }),
    'VERSION_CONFLICT',
  );
});

test('admission is deterministic and final runs never fall back to fixtures or simulated people', () => {
  const s = buildSchedule(rehearsalFreeze(), tasks, 'seed-a');
  const final = { ...rehearsal, mode: 'final' as const };
  for (const slot of s.slots) {
    const a = admitSlot(slot, final);
    assert.equal(a.admitted, false, `${slot.arm} must be blocked today`);
  }
  const live = {
    ...final,
    live_ai: { enabled: true, verified_model_id: 'verified-model' },
    final_study_records: true,
  };
  const a = s.slots.find((x) => x.arm === 'A' && x.stratum === 'decision')!;
  assert.deepEqual(admitSlot(a, live), {
    admitted: true,
    ai: 'live',
    human: null,
  });
  assert.equal(
    admitSlot(a, {
      ...live,
      live_ai: { enabled: true, verified_model_id: null },
    }).admitted,
    false,
    'Enabled dispatch without a verified model id is not authority.',
  );
  const implA = s.slots.find(
    (x) => x.arm === 'A' && x.stratum === 'implementation',
  )!;
  assert.equal(admitSlot(implA, live).admitted, false);
  const implC = s.slots.find(
    (x) => x.arm === 'C' && x.stratum === 'implementation',
  )!;
  assert.deepEqual(admitSlot(implC, rehearsal), {
    admitted: true,
    ai: null,
    human: 'scripted_rehearsal',
  });
});

const record = (over: Partial<AttemptRecord>): AttemptRecord => ({
  attempt_id: randomUUID(),
  state: 'failed',
  finish: { status: 'failed' },
  measurements: {},
  produced_output: false,
  human_source: 'none',
  ...over,
});

test('one retry is allowed only for an infrastructure failure before any output', () => {
  assert.equal(retryPermitted([record({})]), true);
  assert.equal(retryPermitted([record({ produced_output: true })]), false);
  assert.equal(
    retryPermitted([
      record({
        finish: { status: 'failed', outcome: 'insufficient_evidence' },
      }),
    ]),
    false,
    'A task outcome is substantive, not infrastructure.',
  );
  assert.equal(retryPermitted([record({}), record({})]), false);
  assert.equal(retryPermitted([]), false);
});

test('the flow table keeps every slot and cannot hide a run behind a block', () => {
  const s = buildSchedule(rehearsalFreeze(), tasks, 'seed-a');
  const admissions = new Map(
    s.slots.map((x) => [x.slot_id, admitSlot(x, rehearsal)]),
  );
  const [first, second] = s.slots.filter(
    (x) => admissions.get(x.slot_id)!.admitted,
  );
  const blocked = s.slots.find((x) => !admissions.get(x.slot_id)!.admitted)!;
  const failedRun = record({});
  const retry = record({ state: 'submitted', finish: { status: 'submitted' } });
  const flow = flowTable(
    s,
    admissions,
    new Map([[first!.slot_id, [failedRun, retry]]]),
    new Map([[second!.slot_id, 'Owner deferred']]),
  );
  assert.equal(flow.length, s.slots.length);
  const row = (id: string) => flow.find((f) => f.slot_id === id)!;
  assert.equal(row(first!.slot_id).state, 'submitted');
  assert.equal(
    row(first!.slot_id).attempts.length,
    2,
    'The failed attempt is kept.',
  );
  assert.equal(row(first!.slot_id).attempts[1]!.retry_of, failedRun.attempt_id);
  assert.equal(row(second!.slot_id).state, 'deferred');
  assert.equal(row(blocked.slot_id).state, 'blocked');
  assert.ok(row(blocked.slot_id).reasons.length);
  assert.ok(flow.some((f) => f.state === 'missing'));
  assert.throws(
    () =>
      flowTable(
        s,
        admissions,
        new Map([[blocked.slot_id, [record({})]]]),
        new Map(),
      ),
    /blocked slot/,
  );
});

test('reviewer packets are identically formatted, reordered per reviewer and scanned for leaks', () => {
  const items = [1, 2, 3, 4].map((n) => ({
    slot_id: `slot-${n}`.padEnd(20, 'x'),
    attempt_id: randomUUID(),
    task_key: 'k',
    problem: 'A structured problem statement.',
    outcome: 'Asked outcome.',
    text: n === 1 ? null : `Answer ${n}\r\nline  `,
  }));
  const p = blindedPackets({ items, reviewers: ['r1', 'r2'], secret: 's1' });
  const q = blindedPackets({ items, reviewers: ['r1', 'r2'], secret: 's2' });
  assert.notDeepEqual(Object.keys(p.key.codes), Object.keys(q.key.codes));
  assert.notDeepEqual(p.key.reviewer_orders.r1, p.key.reviewer_orders.r2);
  assert.match(
    p.files['reviewers/r1/items/item-01.md']!,
    /^# Item 01\n\nCode: /,
  );
  assert.ok(Object.values(p.files).every((f) => !f.includes('\r')));
  const forbidden = items.flatMap((i) => [i.slot_id, i.attempt_id]);
  const task = ['A structured problem statement.', 'Asked outcome.'];
  assert.deepEqual(scanBlinding(p.files, forbidden, task), {
    failures: [],
    flags: [],
  });
  assert.equal(
    scanBlinding(p.files, forbidden).failures.length,
    8,
    'Without the shared-task allowance the task text would be treated as template.',
  );
  const leak = (path: string, body: string) =>
    scanBlinding({ ...p.files, [path]: body }, forbidden, task);
  assert.equal(
    leak('reviewers/r1/README.md', 'Arm A first').failures.length,
    1,
  );
  assert.equal(
    leak('reviewers/r1/items/human_only.md', 'x').failures.length,
    1,
  );
  assert.equal(
    leak(
      'reviewers/r1/items/item-09.md',
      `## Submission\n\nsee ${items[0]!.attempt_id}`,
    ).failures.length,
    1,
  );
  const flagged = leak(
    'reviewers/r1/items/item-09.md',
    '## Submission\n\nAs an AI I tried the structured approach.',
  );
  assert.deepEqual(flagged.failures, []);
  assert.equal(
    flagged.flags.length,
    1,
    'Submission text is flagged, never rewritten.',
  );
});

test('rehearsal executes the frozen schedule shape and final mode refuses without an adopted freeze', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new StudyStore(db.pool);
  const owner = { actorId: randomUUID() };
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Evaluation test owner',
  });
  const adapter = new FixtureAdapter();
  const broker = new ModelBroker(store, { fixture: adapter, live: null });
  const r = await runEvaluationRehearsal(store, broker, owner, { secret: 'a' });
  const pkg = r.package;
  assert.deepEqual(
    pkg.checks.filter((c) => c.status === 'fail'),
    [],
  );
  assert.equal(pkg.empirical_results, false);
  assert.equal(pkg.flow.length, 26);
  assert.deepEqual(pkg.counts, {
    blocked: 4,
    submitted: 8,
    failed: 12,
    cancelled: 1,
    deferred: 1,
  });
  assert.ok(
    pkg.flow
      .filter((f) => f.state === 'blocked')
      .every((f) => f.arm !== 'C' && f.reasons.length),
    'Only AI implementation slots are blocked in the rehearsal.',
  );
  assert.equal(
    pkg.flow
      .filter((f) => f.condition !== 'autonomous' && f.attempts.length)
      .every((f) =>
        f.attempts.every((a) => a.human_source === 'scripted_rehearsal'),
      ),
    true,
  );
  assert.ok(pkg.functional_checks.length >= 1);
  assert.equal(pkg.model_self_ratings.used_as_ratings, false);
  // Hidden metadata stays in the private key and raw exports, never in reviewer files.
  const reviewerText = JSON.stringify(r.reviewer_files);
  for (const f of pkg.flow)
    for (const a of f.attempts) assert.ok(!reviewerText.includes(a.attempt_id));
  assert.doesNotMatch(
    reviewerText,
    /autonomous|human_only|open_ended|human_in_loop/,
  );
  assert.equal(
    Object.keys(r.private_key.codes).length,
    pkg.reviewer_packets.items,
  );
  const again = await runEvaluationRehearsal(store, broker, owner, {
    secret: 'b',
  });
  assert.equal(again.package.reproducible_digest, pkg.reproducible_digest);

  // Final mode: no freeze, no schedule.
  const ws = (
    await store.createWorkspace(owner, {
      name: 'Final',
      record_mode: 'fixture',
    })
  ).id;
  const authority = {
    live_ai: { enabled: false, verified_model_id: null },
    final_study_records: false,
    ai_implementation: false,
  };
  await assert.rejects(
    planFinalEvaluation(store, owner, ws, tasks, authority),
    (e: Error & { details?: string[] }) =>
      e.details?.length === BLOCKING_DECISIONS.length,
  );
  // With an adopted freeze (test answers in a throwaway database), every slot is blocked with reasons.
  await store.freezeStudyProtocol(owner, ws, {
    proposal_hash: canonicalHash(PROPOSED_PROTOCOL),
    decisions: BLOCKING_DECISIONS.map((d) => ({
      id: d.id,
      choice: d.recommendation,
      rationale: 'Test answer',
    })),
  });
  const final = await planFinalEvaluation(store, owner, ws, tasks, authority);
  assert.equal(final.package.freeze.origin, 'adopted');
  assert.deepEqual(final.package.counts, { blocked: 26 });
  assert.deepEqual(
    final.package.checks.filter((c) => c.status === 'fail'),
    [],
  );
  assert.equal(final.package.reviewer_packets.items, 0);
  const audit = await db.pool.query(
    "select content_hash from audit_events where workspace_id=$1 and action='evaluation.schedule_planned'",
    [ws],
  );
  assert.equal(
    audit.rows[0]?.content_hash,
    final.package.schedule.schedule_hash,
  );
  await assert.rejects(
    planFinalEvaluation(store, owner, ws, tasks.slice(2), authority),
    (e: Error) => code(e) === 'INVALID_CONTRACT',
  );
  const stranger = { actorId: randomUUID() };
  await store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Stranger',
  });
  await assert.rejects(
    planFinalEvaluation(store, stranger, ws, tasks, authority),
  );
});
