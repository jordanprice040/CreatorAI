import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  GATE_OVERRIDE_NOTE,
  type ErrorCode,
  type SelectRequest,
  type SelectionReport,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  FIXTURE_SPEC,
  RUNBOOK_FIXTURE_SPEC,
  fixtureDispositions,
  fixtureHumilityReview,
  fixtureScorecards,
  readZip,
} from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { ProjectReportStore } from '@creator/db';
import { discoverySetup, owner } from './discovery-harness.js';

// ADR-0138 (Jordan, November 28): the owner's warned gate override in Decide, and a build of a
// spec covered by the Decide humility review of the option version it builds.

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

/** A scored clinic discovery run; the build option has no humility review yet. */
async function scoredNoReview(s: Setup) {
  const { detail, runId, seeded } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const evidence = seeded.evidence.map((e) => ({ id: e.claim_id, version: 1 }));
  const first = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const alts = first.suitability.candidates.map((c) => c.alternative);
  for (const card of fixtureScorecards(alts, evidence))
    await s.store.recordScorecard(owner, s.ws.id, card);
  return { runId, problem, evidence, alts };
}
const request = (
  report: SelectionReport,
  over: Partial<SelectRequest> = {},
): SelectRequest => ({
  problem: { id: report.problem.id, version: report.problem.version },
  report_hash: report.report_hash,
  dispositions: fixtureDispositions(report),
  override_reason:
    'Reminders are recommended too; no coordinator is funded this quarter (test).',
  rationale: 'Test selection.',
  shortlist_size: 3,
  data_class: 'synthetic',
  ...over,
});
async function approveAndRetry<T extends { status: string }>(
  s: Setup,
  first: T & { admission: { decision_id: string | null } },
  again: () => Promise<T>,
): Promise<T> {
  if (first.status !== 'needs_human') return first;
  const d = await s.store.getDecision(
    owner,
    s.ws.id,
    first.admission.decision_id!,
  );
  await s.store.answerDecision(owner, s.ws.id, d.id, {
    choice: 'approve_once',
    option_id: null,
    rationale: 'Approved for this exact version (test).',
    coverage_hash: d.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: null,
    interruption: null,
  });
  return again();
}
const REASON = 'I accept the build without a humility review for this test.';
const pass = (...alternatives: string[]) => ({
  reason: REASON,
  alternatives,
  confirmed: true as const,
});

test('ADR-0138: only the owner passes gates, never a choice the kind rules out; every reason is recorded and a freeze keeps them', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, alts } = await scoredNoReview(s);
  const build = alts.find((a) => a.kind === 'build')!;
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const row = report.suitability.candidates.find(
    (c) => c.alternative.id === build.id,
  )!;
  assert.ok(
    row.gates.blocked.select_for_build?.includes(
      'No humility review of this exact version.',
    ),
  );
  // Without an override the gate refuses, as before.
  await rejects(
    'INVALID_TRANSITION',
    s.store.select(owner, s.ws.id, runId, request(report)),
    /humility review/,
  );
  const PASS = pass(build.id);
  // An autopilot step cannot pass gates, even under the owner's actor.
  await rejects(
    'ACCESS_DENIED',
    s.store.select(
      { ...owner, autopilot: { id: randomUUID() } },
      s.ws.id,
      runId,
      request(report, { gate_override: PASS }),
    ),
    /Only the workspace owner/,
  );
  // Review 1 L-5: nor can an editor, or a tester account holding the owner role.
  const editor = { actorId: randomUUID() };
  const tester = { actorId: randomUUID() };
  for (const [a, n] of [
    [editor, 'editor'],
    [tester, 'tester'],
  ] as const) {
    await s.store.ensureActor({
      id: a.actorId,
      kind: 'human',
      display_name: n,
    });
    await s.store.addMember(
      owner,
      s.ws.id,
      a.actorId,
      n === 'editor' ? 'editor' : 'owner',
    );
  }
  await s.db.pool.query(
    `insert into tester_accounts (actor_id, issuer, subject, workspace_role, expires_at, created_by)
     values ($1, 'https://issuer.example', 'tester', 'editor', now() + interval '1 day', $2)`,
    [tester.actorId, owner.actorId],
  );
  for (const who of [editor, tester])
    await rejects(
      'ACCESS_DENIED',
      s.store.select(
        who,
        s.ws.id,
        runId,
        request(report, { gate_override: PASS }),
      ),
      /Only the workspace owner/,
    );
  // Review 1 L-2: the override passes the options it names, and only options gates block.
  const other = alts.find((a) => a.id !== build.id)!;
  await rejects(
    'INVALID_TRANSITION',
    s.store.select(
      owner,
      s.ws.id,
      runId,
      request(report, { gate_override: pass(other.id) }),
    ),
    /humility review/,
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.select(
      owner,
      s.ws.id,
      runId,
      request(report, { gate_override: pass(build.id, other.id) }),
    ),
    /names an option whose chosen gates do not block it/,
  );
  // A choice the option's kind rules out is never passed (custom software is not recommended).
  const ruledOut = request(report, {
    gate_override: PASS,
    dispositions: fixtureDispositions(report).map((d) =>
      d.alternative.id === build.id
        ? { ...d, disposition: 'recommend_alternative' as const }
        : d,
    ),
  });
  await rejects(
    'INVALID_TRANSITION',
    s.store.select(owner, s.ws.id, runId, ruledOut),
    /recommend alternative/,
  );
  // Nothing was admitted by the refused attempts.
  assert.equal(
    (await s.store.listAdmissions(owner, s.ws.id, runId)).filter(
      (x) => x.binding.action_type === 'candidate.select',
    ).length,
    0,
  );
  // The owner passes it: recorded with every reason, labelled, with its own audit event.
  const req = request(report, { gate_override: PASS });
  const done = await approveAndRetry(
    s,
    await s.store.select(owner, s.ws.id, runId, req),
    () => s.store.select(owner, s.ws.id, runId, req),
  );
  assert.equal(done.status, 'recorded', done.admission.explanation);
  const sel = done.selection!;
  assert.equal(sel.gate_override_reason, REASON);
  assert.deepEqual(sel.gate_overrides, [
    {
      alternative: { id: build.id, version: build.version },
      disposition: 'select_for_build',
      reasons: row.gates.blocked.select_for_build,
    },
  ]);
  assert.ok(sel.rationale.startsWith(GATE_OVERRIDE_NOTE));
  const listed = (
    await s.store.listSelections(owner, s.ws.id, problem.id)
  ).find((x) => x.id === sel.id)!;
  assert.deepEqual(listed.gate_overrides, sel.gate_overrides);
  const events = await s.db.pool.query<{ payload: Record<string, unknown> }>(
    `select payload from audit_events where action = 'selection.gate_overridden'
       and subject_id = $1`,
    [sel.id],
  );
  assert.equal(events.rowCount, 1);
  assert.equal(events.rows[0]!.payload.reason, REASON);
  // The table refuses an override row without its reason (thesis evidence stays complete).
  await assert.rejects(
    s.db.pool.query(
      `insert into selections (id, workspace_id, run_id, problem_id, problem_version,
         report_hash, report, dispositions, overrides, override_reason, rationale,
         admission_id, actor_id, gate_overrides)
       select $1, workspace_id, run_id, problem_id, problem_version, report_hash, report,
         dispositions, overrides, override_reason, rationale, admission_id, actor_id,
         gate_overrides from selections where id = $2`,
      [randomUUID(), sel.id],
    ),
    /selections_gate_override_check/,
  );

  // The freeze honors the gate the owner passed (it reads the same) and nothing else.
  const spec = await s.store.createSpec(owner, s.ws.id, {
    selection_id: sel.id,
    alternative: { id: build.id, version: build.version },
    title: 'No-show flags prototype',
    content: FIXTURE_SPEC,
  });
  const status = await s.store.specStatus(owner, s.ws.id, spec.spec.id);
  assert.deepEqual(status.blockers, []);
  const freezeReq = {
    spec: { id: spec.spec.id, version: 1 },
    justification: 'Freeze for build (test).',
    data_class: 'synthetic' as const,
  };
  const frozen = await approveAndRetry(
    s,
    await s.store.freezeSpec(owner, s.ws.id, runId, freezeReq),
    () => s.store.freezeSpec(owner, s.ws.id, runId, freezeReq),
  );
  assert.equal(frozen.status, 'frozen', frozen.admission.explanation);

  // Once a humility review clears the gate, an override has nothing to pass and is refused.
  const claims = (
    await s.store.listEntities(owner, s.ws.id, { kind: 'claim' })
  ).map((c) => ({ id: c.id, version: c.version }));
  await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review: no-show flags',
    body: fixtureHumilityReview(
      { id: build.id, version: build.version },
      claims.slice(0, 3),
    ),
  });
  const cleared = await s.store.selectionReport(owner, s.ws.id, problem.id);
  await rejects(
    'INVALID_CONTRACT',
    s.store.select(
      owner,
      s.ws.id,
      runId,
      request(cleared, { gate_override: pass(build.id) }),
    ),
    /No gate blocks/,
  );
});

test('ADR-0138: a build of a spec is covered by the Decide humility review of the exact option version it builds', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, evidence, alts } = await scoredNoReview(s);
  const build = alts.find((a) => a.kind === 'build')!;
  const hybrid = alts.find((a) => a.kind === 'hybrid')!;
  const review = await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review: no-show flags',
    body: fixtureHumilityReview(
      { id: build.id, version: build.version },
      evidence,
    ),
  });
  const other = await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review of another option',
    body: fixtureHumilityReview(
      { id: hybrid.id, version: hybrid.version },
      evidence,
    ),
  });
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const req = request(report);
  const sel = await approveAndRetry(
    s,
    await s.store.select(owner, s.ws.id, runId, req),
    () => s.store.select(owner, s.ws.id, runId, req),
  );
  assert.equal(sel.status, 'recorded', sel.admission.explanation);
  const spec = await s.store.createSpec(owner, s.ws.id, {
    selection_id: sel.selection!.id,
    alternative: { id: build.id, version: build.version },
    title: 'No-show flags prototype',
    content: RUNBOOK_FIXTURE_SPEC,
  });
  const commit = (humility: { id: string; version: number }) =>
    s.store.admitAction(owner, s.ws.id, runId, {
      action_type: 'product.commit_build',
      task_id: null,
      target: { id: spec.spec.id, version: 1 },
      spec_hash: spec.spec.content_hash,
      amount_nano_usd: null,
      data_class: 'synthetic',
      assumption_ids: [],
      humility_review: humility,
      flags: [],
      justification: 'Build the frozen spec (test).',
    });
  // The option's own review from Decide covers the spec it was written from.
  const covered = await commit({ id: review.id, version: 1 });
  assert.notEqual(covered.reason_code, 'humility_gate_failed');
  // A review of another option does not.
  const wrong = await commit({ id: other.id, version: 1 });
  assert.equal(wrong.reason_code, 'humility_gate_failed');
  assert.match(wrong.explanation, /different subject/);
  // Review 1 L-4: the runbook export reports the same review, as the option's, and as accepted.
  const out = await s.store.specRunbook(owner, s.ws.id, spec.spec.id);
  const dec = readZip(out.archive)
    .find((f) => f.path === 'DECISIONS.md')!
    .content.toString('utf8');
  assert.match(
    dec,
    new RegExp(
      `review ${review.id.slice(0, 8)}, of option “[^”]+” version ${build.version}, the version this spec builds`,
    ),
  );
  assert.match(dec, /pre-build gate accepts this review/);
  assert.doesNotMatch(out.manifest.warnings.join(' '), /humility/);
});

test('ADR-0138 review 1: a gate reason that changes after the override blocks the freeze; the project report lists the override', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, evidence, alts } = await scoredNoReview(s);
  const build = alts.find((a) => a.kind === 'build')!;
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const req = request(report, { gate_override: pass(build.id) });
  const done = await approveAndRetry(
    s,
    await s.store.select(owner, s.ws.id, runId, req),
    () => s.store.select(owner, s.ws.id, runId, req),
  );
  assert.equal(done.status, 'recorded', done.admission.explanation);
  const spec = await s.store.createSpec(owner, s.ws.id, {
    selection_id: done.selection!.id,
    alternative: { id: build.id, version: build.version },
    title: 'No-show flags prototype',
    content: FIXTURE_SPEC,
  });
  assert.deepEqual(
    (await s.store.specStatus(owner, s.ws.id, spec.spec.id)).blockers,
    [],
  );
  // A review with a serious unresolved ethical problem changes the gate's reason.
  const body = fixtureHumilityReview(
    { id: build.id, version: build.version },
    evidence,
  );
  await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review: no-show flags',
    body: {
      ...body,
      ethical: { status: 'unresolved_serious', note: 'Unresolved (test).' },
    },
  });
  assert.match(
    (await s.store.specStatus(owner, s.ws.id, spec.spec.id)).blockers.join(' '),
    /unresolved serious ethical problem/,
  );
  // M-1: the project report keeps the override apart, with its reason and every gate passed.
  const md = (
    await new ProjectReportStore(s.db.pool).projectReport(owner, s.ws.id)
  ).markdown;
  assert.match(
    md,
    /Owner override, gates passed without their checks\. Reason: I accept the build without a humility review/,
  );
  assert.match(md, /No humility review of this exact version/);
});

test('ADR-0138: custom software taken to validation gets a validation plan as its proposal', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, alts } = await scoredNoReview(s);
  const build = alts.find((a) => a.kind === 'build')!;
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const req = request(report, {
    dispositions: fixtureDispositions(report).map((d) =>
      d.alternative.id === build.id
        ? { ...d, disposition: 'proceed_to_validation' as const }
        : d,
    ),
  });
  const sel = await approveAndRetry(
    s,
    await s.store.select(owner, s.ws.id, runId, req),
    () => s.store.select(owner, s.ws.id, runId, req),
  );
  assert.equal(sel.status, 'recorded', sel.admission.explanation);
  const draft = await s.store.proposalDraft(owner, s.ws.id, build.id);
  assert.match(draft.title, /^Validation plan: /);
  assert.equal(draft.body.response, 'build');
  assert.match(draft.body.summary, /^A validation plan for custom software/);
  const made = await s.store.createProposal(owner, s.ws.id, {
    title: draft.title,
    body: draft.body,
  });
  assert.equal(made.proposal.body.response, 'build');
});
