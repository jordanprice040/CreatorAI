import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractError,
  type ErrorCode,
  type SelectRequest,
  type SelectionReport,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  FIXTURE_SPEC,
  fixtureDispositions,
  fixtureHumilityReview,
  fixtureScorecards,
  fixtureSpecRevision,
} from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { discoverySetup, owner } from './discovery-harness.js';

const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === code &&
      (!message || message.test(e.message)),
  );
const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;
type Setup = NonNullable<Awaited<ReturnType<typeof discoverySetup>>>;
const byKind = (r: SelectionReport['suitability'], kind: string) =>
  r.candidates.find((c) => c.alternative.kind === kind)!;

/** A finished clinic discovery run, scored by the fixture reviewers, with a humility review. */
async function scored(s: Setup) {
  const { detail, runId, seeded } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const evidence = seeded.evidence.map((e) => ({ id: e.claim_id, version: 1 }));
  const first = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const alts = first.suitability.candidates.map((c) => c.alternative);
  for (const card of fixtureScorecards(alts, evidence))
    await s.store.recordScorecard(owner, s.ws.id, card);
  const build = alts.find((a) => a.kind === 'build')!;
  await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review: no-show flags',
    body: fixtureHumilityReview(
      { id: build.id, version: build.version },
      evidence,
    ),
  });
  return { runId, problem, evidence, build };
}
const approve = async (s: Setup, decisionId: string) => {
  const d = await s.store.getDecision(owner, s.ws.id, decisionId);
  return s.store.answerDecision(owner, s.ws.id, decisionId, {
    choice: 'approve_once',
    option_id: null,
    rationale: 'Approved for this exact version (test).',
    coverage_hash: d.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: null,
    interruption: null,
  });
};
function request(
  report: SelectionReport,
  over: Partial<SelectRequest> = {},
): SelectRequest {
  return {
    problem: { id: report.problem.id, version: report.problem.version },
    report_hash: report.report_hash,
    dispositions: fixtureDispositions(report),
    override_reason:
      'Reminders are recommended too; no coordinator is funded this quarter (test).',
    rationale: 'Test selection.',
    shortlist_size: 3,
    data_class: 'synthetic',
    ...over,
  };
}
/** Selects, approves the one-time authorization the run asks for, and selects again. */
async function selectApproved(s: Setup, runId: string, req: SelectRequest) {
  const asked = await s.store.select(owner, s.ws.id, runId, req);
  assert.equal(asked.status, 'needs_human', asked.admission.explanation);
  await approve(s, asked.admission.decision_id!);
  const done = await s.store.select(owner, s.ws.id, runId, req);
  assert.equal(done.status, 'recorded', done.admission.explanation);
  return done.selection!;
}

test('score arithmetic and unknowns are reproducible; incomplete stays labeled; ties and disagreement show', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { problem } = await scored(s);
  const a = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const b = await s.store.selectionReport(owner, s.ws.id, problem.id);
  assert.deepEqual(a, b);
  assert.equal(a.report_hash, b.report_hash);

  // Opportunity: two reviewers 58.3 and 54.2; the mean is kept exactly (225/4) and shown once.
  const build = byKind(a.opportunity, 'build');
  assert.equal(build.status, 'complete');
  assert.deepEqual(build.score, {
    numerator: '225',
    denominator: '4',
    display: '56.3',
  });
  assert.equal(build.rank, 1);
  assert.deepEqual(
    build.disagreements.map((d) => [
      d.criterion,
      d.ratings.map((r) => r.rating).sort(),
    ]),
    [['differentiation', [2, 3]]],
  );
  assert.deepEqual(
    [build.range!.lower.display, build.range!.upper.display],
    ['54.2', '58.3'],
  );
  // Unknown is not neutral: no score, no rank, bounds at 1 and 5, never renormalized.
  const hybrid = byKind(a.opportunity, 'hybrid');
  assert.equal(hybrid.status, 'incomplete');
  assert.equal(hybrid.score, null);
  assert.equal(hybrid.rank, null);
  assert.deepEqual(hybrid.unknown_criteria, ['differentiation']);
  assert.deepEqual(
    [hybrid.range!.lower.display, hybrid.range!.upper.display],
    ['45.8', '62.5'],
  );
  assert.ok(hybrid.overlaps_with.includes(build.alternative.id));
  // Non-software responses are excluded from the opportunity ranking, not scored low.
  assert.equal(a.opportunity.excluded.length, 3);
  // Suitability: the existing tool leads; software and the duplicate process change tie.
  const suit = a.suitability;
  assert.equal(byKind(suit, 'use_existing').score!.display, '66.7');
  assert.equal(byKind(suit, 'use_existing').rank, 1);
  assert.equal(byKind(suit, 'human_led').rank, 2);
  assert.equal(byKind(suit, 'build').rank, 3);
  assert.equal(byKind(suit, 'change_process').rank, 3);
  assert.ok(
    byKind(suit, 'build').overlaps_with.includes(
      byKind(suit, 'change_process').alternative.id,
    ),
  );
  // Sensitivity is recorded per weight scenario.
  assert.equal(suit.sensitivity.scenarios.length, 12);
  // Top three, widened to keep the tie at the boundary unbroken.
  assert.equal(suit.sensitivity.baseline.length, 4);
  // The duplicate keeps its discovery disposition as a gate on advancing it.
  assert.equal(byKind(suit, 'change_process').gates.discovery, 'duplicate');
  assert.ok(byKind(suit, 'change_process').gates.blocked.recommend_alternative);
});

test('human overrides retain original scores and ranks, with reason, actor and time', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem } = await scored(s);
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  await rejects(
    'INVALID_CONTRACT',
    s.store.select(
      owner,
      s.ws.id,
      runId,
      request(report, { override_reason: null }),
    ),
    /override reason/,
  );
  // A changed report since it was read is refused rather than decided blindly.
  await rejects(
    'VERSION_CONFLICT',
    s.store.select(
      owner,
      s.ws.id,
      runId,
      request(report, { report_hash: 'a'.repeat(64) }),
    ),
  );
  const selection = await selectApproved(s, runId, request(report));
  assert.equal(selection.current, true);
  assert.equal(selection.actor_id, owner.actorId);
  assert.ok(selection.override_reason);
  const human = byKind(report.suitability, 'human_led');
  const build = byKind(report.suitability, 'build');
  assert.deepEqual(selection.overrides, [
    {
      alternative: build.alternative.id,
      ranking: 'suitability',
      original_rank: 3,
      original_score: '54.2',
      outranked_by: [{ id: human.alternative.id, rank: 2, score: '58.3' }],
    },
  ]);
  // The stored report is the original; scorecards are unchanged by the override.
  assert.deepEqual(selection.report, report);
  assert.deepEqual(
    await s.store.selectionReport(owner, s.ws.id, problem.id),
    report,
  );
  const listed = await s.store.listSelections(owner, s.ws.id, problem.id);
  assert.equal(listed.length, 1);
  assert.equal(listed[0]!.report_hash, report.report_hash);
  await s.store.drainOutbox();
  const history = await s.store.listHistory(owner, s.ws.id, {
    subjectId: selection.id,
  });
  assert.ok(history.some((h) => h.action === 'selection.recorded'));
});

test('a high score cannot bypass an unresolved gate, and non-code responses never become build-ready', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, evidence, build } = await scored(s);
  let report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  // An existing tool cannot be selected for build, however it scores.
  const tool = byKind(report.suitability, 'use_existing');
  const forceTool = request(report, {
    dispositions: request(report).dispositions.map((d) =>
      d.alternative.id === tool.alternative.id
        ? { ...d, disposition: 'select_for_build' }
        : d,
    ),
  });
  await rejects(
    'INVALID_TRANSITION',
    s.store.select(owner, s.ws.id, runId, forceTool),
    /no software to build/,
  );
  // A perfect score with an unresolved ethics question stays blocked, override or not.
  const perfect = fixtureScorecards([build], evidence).find(
    (c) => c.body.rubric === 'suitability',
  )!;
  await s.store.recordScorecard(owner, s.ws.id, {
    title: 'Second reviewer: ethics open',
    body: {
      ...perfect.body,
      reviewer: { kind: 'human', label: 'Reviewer C' },
      ratings: Object.fromEntries(
        Object.entries(perfect.body.ratings).map(([k, r]) => [
          k,
          { ...r, rating: 5, evidence_refs: evidence.slice(0, 1) },
        ]),
      ),
      gates: {
        ...perfect.body.gates,
        ethics: {
          status: 'unresolved',
          note: 'Double-booking may lengthen waits for patients with disabilities.',
        },
      },
    },
  });
  report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const gated = byKind(report.suitability, 'build');
  assert.equal(gated.gates.ethics_access, 'unresolved');
  assert.ok(
    gated.gates.blocked.select_for_build?.some((r) => /ethics/.test(r)),
  );
  await rejects(
    'INVALID_TRANSITION',
    s.store.select(owner, s.ws.id, runId, request(report)),
    /ethics or access question is unresolved/,
  );
  // No admission was attempted, so nothing asked a person to approve around the gate.
  assert.equal(
    (await s.store.listAdmissions(owner, s.ws.id, runId)).filter(
      (x) => x.binding.action_type === 'candidate.select',
    ).length,
    0,
  );
});

test('a gate raised after selection stops the freeze; an incomplete or unreviewed build is blocked', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, evidence, build } = await scored(s);
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const selection = await selectApproved(s, runId, request(report));
  const spec = await s.store.createSpec(owner, s.ws.id, {
    selection_id: selection.id,
    alternative: { id: build.id, version: build.version },
    title: 'No-show flags prototype',
    content: FIXTURE_SPEC,
  });
  assert.deepEqual(spec.problems, []);
  assert.deepEqual(spec.blockers, []);
  // Archive the humility review: the build gate now fails and the freeze is refused.
  const reviews = await s.store.listEntities(owner, s.ws.id, {
    kind: 'humility_review',
  });
  await s.store.archiveEntity(owner, s.ws.id, reviews[0]!.id, {
    expected_version: 1,
    reason: 'Withdrawn for re-review (test).',
  });
  const status = await s.store.specStatus(owner, s.ws.id, spec.spec.id);
  assert.ok(status.blockers.some((b) => /humility review/i.test(b)));
  await rejects(
    'INVALID_TRANSITION',
    s.store.freezeSpec(owner, s.ws.id, runId, {
      spec: { id: spec.spec.id, version: 1 },
      justification: 'Freeze for build (test).',
      data_class: 'synthetic',
    }),
    /humility review/i,
  );
  void evidence;
});

test('spec changes invalidate affected task and approval versions; frozen tasks keep their hashes', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, build } = await scored(s);
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const selection = await selectApproved(s, runId, request(report));
  const created = await s.store.createSpec(owner, s.ws.id, {
    selection_id: selection.id,
    alternative: { id: build.id, version: build.version },
    title: 'No-show flags prototype',
    content: FIXTURE_SPEC,
  });
  const specId = created.spec.id;
  assert.ok(created.tasks.every((x) => x.status === 'unfrozen'));
  const freeze = (version: number) =>
    s.store.freezeSpec(owner, s.ws.id, runId, {
      spec: { id: specId, version },
      justification: 'Freeze for build (test).',
      data_class: 'synthetic',
    });
  // v1 needs a person's approval of exactly v1.
  const asked = await freeze(1);
  assert.equal(asked.status, 'needs_human');
  await approve(s, asked.admission.decision_id!);
  // The spec changes before the freeze: the v1 approval cannot freeze v2.
  const revised = await s.store.reviseSpec(owner, s.ws.id, specId, {
    expected_version: 1,
    title: 'No-show flags prototype',
    content: fixtureSpecRevision(FIXTURE_SPEC),
    reason: 'Printable list requested (test).',
  });
  assert.equal(revised.spec.version, 2);
  await rejects('VERSION_CONFLICT', freeze(1));
  const again = await freeze(2);
  assert.equal(again.status, 'needs_human');
  assert.notEqual(again.admission.decision_id, asked.admission.decision_id);
  await approve(s, again.admission.decision_id!);
  const frozen = await freeze(2);
  assert.equal(frozen.status, 'frozen', frozen.admission.explanation);
  assert.equal(frozen.freeze!.spec.version, 2);
  let status = await s.store.specStatus(owner, s.ws.id, specId);
  assert.equal(status.frozen_current, true);
  assert.ok(status.tasks.every((x) => x.status === 'frozen'));
  // Freezing the same version twice is refused; the approval was single-use anyway.
  await rejects('DUPLICATE', freeze(2));

  // A change to T2 invalidates T2 and everything downstream of it; T1 keeps its frozen hash.
  const v3 = {
    ...fixtureSpecRevision(FIXTURE_SPEC),
    tasks: fixtureSpecRevision(FIXTURE_SPEC).tasks.map((x) =>
      x.key === 'T2'
        ? {
            ...x,
            deliverable: 'Rate calculation, bands and a calibration table',
          }
        : x,
    ),
  };
  status = await s.store.reviseSpec(owner, s.ws.id, specId, {
    expected_version: 2,
    title: 'No-show flags prototype',
    content: v3,
    reason: 'Calibration table (test).',
  });
  assert.equal(status.frozen_current, false);
  assert.equal(status.latest_freeze!.spec.version, 2);
  assert.deepEqual(
    status.tasks.map((x) => [x.key, x.status]),
    [
      ['T1', 'frozen'],
      ['T2', 'changed'],
      ['T3', 'changed'],
      ['T4', 'changed'],
    ],
  );
  // A risk-note edit changes the version (approval invalid) but no task.
  status = await s.store.reviseSpec(owner, s.ws.id, specId, {
    expected_version: 3,
    title: 'No-show flags prototype',
    content: {
      ...v3,
      tasks: fixtureSpecRevision(FIXTURE_SPEC).tasks,
      risks: [],
    },
    reason: 'Drop risk note (test).',
  });
  assert.ok(status.tasks.every((x) => x.status === 'frozen'));
  assert.equal(status.frozen_current, false);
  await s.store.drainOutbox();
  const history = await s.store.listHistory(owner, s.ws.id, {
    subjectId: specId,
  });
  const revisedEvents = history.filter((h) => h.action === 'spec.revised');
  assert.equal(revisedEvents.length, 3);
  assert.ok(history.some((h) => h.action === 'spec.frozen'));
});

test('invalid task graphs cannot be frozen; specs and scorecards bypass no checks', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, build, evidence } = await scored(s);
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const selection = await selectApproved(s, runId, request(report));
  const bad = {
    ...FIXTURE_SPEC,
    tasks: FIXTURE_SPEC.tasks.map((x) =>
      x.key === 'T1'
        ? { ...x, depends_on: ['T3'] }
        : x.key === 'T4'
          ? { ...x, depends_on: [], file_scope: ['src/web/print'] }
          : x,
    ),
  };
  const spec = await s.store.createSpec(owner, s.ws.id, {
    selection_id: selection.id,
    alternative: { id: build.id, version: build.version },
    title: 'Broken graph',
    content: bad,
  });
  assert.deepEqual(
    spec.problems.map((p) => p.code),
    ['cycle'],
  );
  await rejects(
    'INVALID_TRANSITION',
    s.store.freezeSpec(owner, s.ws.id, runId, {
      spec: { id: spec.spec.id, version: 1 },
      justification: 'Freeze (test).',
      data_class: 'synthetic',
    }),
    /cycle/,
  );
  const parallel = await s.store.reviseSpec(owner, s.ws.id, spec.spec.id, {
    expected_version: 1,
    title: 'Parallel owners',
    content: {
      ...bad,
      tasks: bad.tasks.map((x) =>
        x.key === 'T1' ? { ...x, depends_on: [] } : x,
      ),
    },
    reason: 'Remove cycle (test).',
  });
  assert.deepEqual(
    parallel.problems.map((p) => p.code),
    ['ownership_conflict'],
  );
  // Only a select-for-build alternative gets a spec.
  const tool = byKind(report.suitability, 'use_existing');
  await rejects(
    'INVALID_TRANSITION',
    s.store.createSpec(owner, s.ws.id, {
      selection_id: selection.id,
      alternative: {
        id: tool.alternative.id,
        version: tool.alternative.version,
      },
      title: 'Spec for a tool recommendation',
      content: FIXTURE_SPEC,
    }),
  );
  // The generic record API cannot write either managed form.
  await rejects(
    'INVALID_CONTRACT',
    s.store.createEntity(owner, s.ws.id, {
      kind: 'scorecard',
      title: 'Sneaky',
      body: fixtureScorecards([build], evidence)[0]!.body,
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.createEntity(owner, s.ws.id, {
      kind: 'specification',
      title: 'Sneaky',
      body: {
        format: 'spec/1',
        alternative: { id: build.id, version: build.version },
        selection_id: selection.id,
        ...FIXTURE_SPEC,
      },
    }),
  );
  // A rating without evidence is refused; unknown needs no evidence.
  const card = fixtureScorecards([build], evidence)[0]!.body;
  await rejects(
    'INVALID_CONTRACT',
    s.store.recordScorecard(owner, s.ws.id, {
      title: 'No evidence',
      body: {
        ...card,
        ratings: {
          ...card.ratings,
          urgency: { rating: 5, evidence_refs: [], rationale: 'Trust me.' },
        },
      },
    }),
  );
  await rejects(
    'MISSING_EVIDENCE',
    s.store.recordScorecard(owner, s.ws.id, {
      title: 'Phantom evidence',
      body: {
        ...card,
        ratings: {
          ...card.ratings,
          urgency: {
            rating: 5,
            evidence_refs: [{ id: build.id, version: 1 }],
            rationale: 'Cites the alternative itself.',
          },
        },
      },
    }),
  );
});

test('a later selection replaces an earlier one; the replaced selection cannot seed a spec', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, build } = await scored(s);
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const first = await selectApproved(s, runId, request(report));
  const deferAll = request(report, {
    dispositions: request(report).dispositions.map((d) => ({
      ...d,
      disposition: 'defer',
      reasons: ['Paused pending funding (test).'],
    })),
    override_reason: null,
    rationale: 'Everything deferred (test).',
  });
  const second = await selectApproved(s, runId, deferAll);
  assert.deepEqual(second.overrides, []);
  const listed = await s.store.listSelections(owner, s.ws.id, problem.id);
  assert.deepEqual(
    listed.map((x) => [x.id, x.current]),
    [
      [second.id, true],
      [first.id, false],
    ],
  );
  await rejects(
    'INVALID_TRANSITION',
    s.store.createSpec(owner, s.ws.id, {
      selection_id: first.id,
      alternative: { id: build.id, version: build.version },
      title: 'Stale',
      content: FIXTURE_SPEC,
    }),
    /later selection/,
  );
});

test('selection follows run policy: preauthorized autonomous selection, otherwise deferred', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { problem } = await scored(s);
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const grant = await s.store.createStandingGrant(owner, s.ws.id, {
    run_id: null,
    action_types: ['candidate.select'],
    target_kind: 'problem',
    max_amount_nano_usd: null,
    allow_irreversible: false,
    allow_external_effects: false,
    data_classes: ['synthetic'],
    expires_at: new Date(Date.now() + 3_600_000).toISOString(),
    rationale: 'Autonomous runs may record selections (test).',
  });
  const autonomous = async (initial: { id: string; version: number }[]) => {
    const r = await s.store.createEntity(owner, s.ws.id, {
      kind: 'run',
      title: 'Autonomous selection run',
      body: {
        state: 'queued',
        experiment_condition: 'autonomous',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    return (
      await s.store.registerRun(owner, s.ws.id, {
        run: { id: r.id, version: 1 },
        autonomy_mode: 'autonomous_within_scope',
        stage_gates: null,
        initial_grants: initial,
      })
    ).run_id;
  };
  const without = await s.store.select(
    owner,
    s.ws.id,
    await autonomous([]),
    request(report),
  );
  assert.equal(without.status, 'deferred');
  assert.equal(without.admission.decision_id, null);
  assert.equal(without.selection, null);
  const covered = await s.store.select(
    owner,
    s.ws.id,
    await autonomous([{ id: grant.id, version: grant.version }]),
    request(report),
  );
  assert.equal(covered.status, 'recorded', covered.admission.explanation);
  assert.equal(covered.admission.decision_id, null);
});
