import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ADVANCING_DISPOSITIONS,
  AssessmentPacketSchema,
  ConfirmGatesResultSchema,
  ContractError,
  GateConfirmationSchema,
  advanceOutlook,
  kindAllows,
  routinePolicySummary,
  type RoutineStage,
  type SelectRequest,
  type AssessorOutput,
  type ErrorCode,
  type RankedCandidate,
  type ScorecardBody,
  type SelectionDisposition,
  type StartAssessmentRequest,
} from '@creator/contracts';
import {
  ASSESSMENT_MARKER,
  DISCOVERY_SCENARIOS,
  assessmentFixtureAnswer,
  modelClearedEthics,
} from '@creator/domain';
import {
  FixtureAdapter,
  usage,
  type AdapterOutcome,
  type AdapterRequest,
  type ModelAdapter,
} from '@creator/broker';
import { studioMachine } from '@creator/db';
import { discoverySetup, owner } from './discovery-harness.js';
import { LOGIN_CODE, login } from './pg-harness.js';
import { createApi } from '@creator/api';
import { once } from 'node:events';

// ADR-0090: the team profile goes with every assessment and is the owner's alone; the owner
// confirms a gate seen exactly as it is now; a later concern or option version makes the
// confirmation stale; the owner's auto-clear rule clears only the access gate, and only what
// assessments that read a profile answering something found no concern in.

const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === code &&
      (!message || message.test(e.message)),
  );
const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;

/** The fixture assessor, optionally raising an access concern on every option. */
class Assessor implements ModelAdapter {
  readonly provider = 'fixture' as const;
  readonly model_id = 'fixture-model-v1';
  readonly live = false;
  readonly inner = new FixtureAdapter();
  access: string | null = null;
  packets: unknown[] = [];
  call(req: AdapterRequest, signal: AbortSignal) {
    if (!req.input[0]!.text.includes(ASSESSMENT_MARKER))
      return this.inner.call(req, signal);
    const text = req.input[1]!.text;
    this.packets.push(
      AssessmentPacketSchema.parse(JSON.parse(text.slice(text.indexOf('{')))),
    );
    const out = JSON.parse(
      assessmentFixtureAnswer(
        req.input.map((m) => ({ role: m.role, text: m.text })),
      )!,
    ) as AssessorOutput;
    if (this.access)
      for (const a of out.assessments)
        a.gates.access = { status: 'unresolved', note: this.access };
    return Promise.resolve<AdapterOutcome>({
      kind: 'completed',
      response_id: 'scripted',
      text: JSON.stringify(out),
      vector: null,
      usage: usage(40, 30, {}),
      incomplete_reason: null,
    });
  }
}

async function setup(t: test.TestContext) {
  const adapter = new Assessor();
  const s = await discoverySetup(t, adapter);
  if (!s) return null;
  const envelope = (await s.store.listEnvelopes(owner, s.ws.id))[0]!;
  const pricing = (await s.store.listPricing(owner, s.ws.id))[0]!;
  const { detail } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const request = (): StartAssessmentRequest => ({
    problem: { id: problem.id, version: problem.version },
    resource_setup: {
      kind: 'api',
      envelope_id: envelope.id,
      pricing_snapshot_id: pricing.id,
    },
    data_class: 'synthetic',
    limits: {
      max_children: 4,
      max_concurrency: 1,
      max_depth: 1,
      max_attempts: 1,
      max_repairs: 1,
      max_calls: 8,
      max_output_tokens: 8000,
      call_timeout_ms: 5000,
      max_wall_seconds: 600,
    },
  });
  const assess = async () => {
    const runId = await s.run();
    const started = await s.store.startAssessment(
      owner,
      s.ws.id,
      runId,
      request(),
    );
    await s.worker.settle();
    const w = await s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
    assert.equal(w.workflow.state, 'succeeded');
    return w;
  };
  const report = () => s.store.selectionReport(owner, s.ws.id, problem.id);
  const editor = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'Editor',
  });
  await s.store.addMember(owner, s.ws.id, editor.actorId, 'editor');
  return { ...s, adapter, problem, assess, report, editor };
}
const gate = (c: RankedCandidate, g: 'ethics' | 'access') =>
  c.gates.gate_details!.find((d) => d.gate === g)!;

test('the team profile is the owner’s, versioned, read by every assessment, and a change marks assessments stale', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const machine = studioMachine();
  const host = { machine, checks: true };
  const empty = await s.store.teamProfile(owner, s.ws.id, host);
  assert.equal(empty.version, 0);
  assert.equal(empty.can_edit, true);
  assert.equal(empty.machine, machine);
  // Only the owner gets the host name; in a hosted deployment nobody does.
  const seen = await s.store.teamProfile(s.editor, s.ws.id, host);
  assert.deepEqual([seen.can_edit, seen.machine], [false, null]);
  const hosted = await s.store.teamProfile(owner, s.ws.id, {
    machine,
    checks: false,
  });
  assert.deepEqual([hosted.machine, hosted.checks_available], [null, false]);
  const body = {
    expected_version: 0,
    capabilities: [
      { key: 'python', status: 'yes' },
      {
        key: 'installs_allowed',
        status: 'yes',
        note: 'Admin rights on lab PCs',
      },
      { key: 'docker', status: 'unknown' },
    ],
    notes: 'Data never leaves the lab.',
  };
  // An editor (an agent can be one) cannot write it, nor record a check.
  await rejects(
    'ACCESS_DENIED',
    s.store.saveTeamProfile(s.editor, s.ws.id, body, host),
    /Only the workspace owner/,
  );
  await rejects(
    'ACCESS_DENIED',
    s.store.requireTeamProfileOwner(s.editor, s.ws.id),
  );
  const v1 = await s.store.saveTeamProfile(owner, s.ws.id, body, host);
  assert.equal(v1.version, 1);
  assert.deepEqual(
    v1.profile.capabilities.map((c) => c.key),
    ['python', 'installs_allowed'],
  );
  await rejects(
    'VERSION_CONFLICT',
    s.store.saveTeamProfile(owner, s.ws.id, body, host),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.saveTeamProfile(
      owner,
      s.ws.id,
      { ...body, expected_version: 1 },
      host,
    ),
    /Nothing changed/,
  );
  const javaCheck = () => ({
    command: 'java -version',
    detail: 'Java 21.0.2',
    output_hash: 'b'.repeat(64),
    machine,
    checked_at: new Date().toISOString(),
  });
  const v2 = await s.store.recordCapabilityCheck(
    owner,
    s.ws.id,
    { expected_version: 1, capability: 'java' },
    javaCheck(),
    host,
  );
  assert.equal(v2.version, 2);
  assert.equal(
    v2.profile.capabilities.find((c) => c.key === 'java')?.basis,
    'check',
  );
  // Another member sees the check but not the computer it ran on.
  const read = await s.store.teamProfile(s.editor, s.ws.id, host);
  assert.equal(
    read.profile.capabilities.find((c) => c.key === 'java')?.check?.machine,
    '',
  );

  // The packet carries the profile (without the computer's name); the cards record its version.
  const preview = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  assert.equal(preview.packet.team?.version, 2);
  assert.ok(!JSON.stringify(preview.packet).includes(machine));
  await s.assess();
  const sent = s.adapter.packets.at(-1) as { team?: { version: number } };
  assert.equal(sent.team?.version, 2);
  const r1 = await s.report();
  for (const c of r1.suitability.candidates)
    assert.ok(c.scorecards.every((x) => x.system && !x.stale));
  const cards = await s.store.listEntities(owner, s.ws.id, {
    kind: 'scorecard',
  });
  assert.ok(
    cards.every(
      (c) => (c.body as ScorecardBody).assessment?.team_version === 2,
    ),
  );

  // Re-checking and finding the same is refused as unchanged: no new version, nothing stale.
  await rejects(
    'INVALID_CONTRACT',
    s.store.recordCapabilityCheck(
      owner,
      s.ws.id,
      { expected_version: 2, capability: 'java' },
      javaCheck(),
      host,
    ),
    /already says/,
  );
  assert.ok(
    (await s.report()).suitability.candidates
      .flatMap((c) => c.scorecards)
      .every((x) => !x.stale),
  );

  // #186 review N-1: a selection recorded now matches today's report until the team changes.
  const before = await s.report();
  const req = {
    problem: { id: before.problem.id, version: before.problem.version },
    report_hash: before.report_hash,
    dispositions: before.suitability.candidates.map((c) => ({
      alternative: { id: c.alternative.id, version: c.alternative.version },
      disposition: 'defer' as const,
      reasons: ['Waiting on the team profile (test).'],
      reverse_if: 'The team can run it.',
    })),
    override_reason: 'Nothing advances yet (test).',
    rationale: 'Defer every option for now (test).',
    shortlist_size: 3,
    data_class: 'synthetic' as const,
  };
  const runId = await s.run();
  let picked = await s.store.select(owner, s.ws.id, runId, req);
  if (picked.status === 'needs_human') {
    const d = await s.store.getDecision(
      owner,
      s.ws.id,
      picked.admission.decision_id!,
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
    picked = await s.store.select(owner, s.ws.id, runId, req);
  }
  assert.equal(picked.status, 'recorded', picked.admission.explanation);
  const x0 = await s.store.responseExplanation(owner, s.ws.id, s.problem.id);
  assert.equal(x0.selection?.report_changed, false);

  // A change to what the model reads makes those assessments out of date until assessed again.
  await s.store.saveTeamProfile(
    owner,
    s.ws.id,
    { ...body, expected_version: 2, notes: 'Data may go to our own server.' },
    host,
  );
  const r2 = await s.report();
  const stale = r2.suitability.candidates.flatMap((c) => c.scorecards);
  assert.ok(stale.length && stale.every((x) => x.stale));
  assert.ok(
    stale.every((x) =>
      (x.stale_reasons ?? []).some((r) =>
        /team profile, or the computer its checks ran on, changed/.test(r),
      ),
    ),
  );
  // #178 merge review L-1: the response explanation reads the same report, so team-stale
  // cards stop counting there too (status, rank and score agree with Compare).
  const x = await s.store.responseExplanation(owner, s.ws.id, s.problem.id);
  const seenIn = new Map(
    [...x.chosen, ...x.others].map((o) => [
      o.alternative.id.toLowerCase(),
      [o.status, o.rank, o.score],
    ]),
  );
  // The recorded selection's report no longer matches today's, and the explanation says so.
  assert.equal(x.basis, 'selection');
  assert.equal(x.selection?.report_changed, true);
  assert.ok(
    x.notes.some((n) => /changed since the selection was recorded/.test(n)),
  );
  let compared = 0;
  for (const c of r2.suitability.candidates) {
    const o = seenIn.get(c.alternative.id.toLowerCase());
    if (!o) continue; // software options are listed under software_avenues
    assert.deepEqual(o, [c.status, c.rank, c.score?.display ?? null]);
    compared++;
  }
  assert.ok(
    compared > 0,
    'the explanation lists at least one option to compare',
  );
});

test('the owner confirms a gate as it is now; a newer concern makes it stale; the owner chooses who clears: team profile (access only) or the model’s word', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const host = { machine: studioMachine(), checks: true };
  // Nothing assessed yet: there is nothing to confirm.
  const before = (await s.report()).suitability.candidates[0]!;
  assert.equal(gate(before, 'ethics').assessed, false);
  await rejects(
    'INVALID_TRANSITION',
    s.store.confirmGate(owner, s.ws.id, s.problem.id, {
      alternative: {
        id: before.alternative.id,
        version: before.alternative.version,
      },
      gate: 'ethics',
      reason: 'Looks fine to me.',
      concerns_seen: [],
    }),
    /Nothing has assessed ethics/,
  );
  s.adapter.access =
    'Nothing in the packet shows the team can install Python tools (csvkit needs Python and pip).';
  await s.assess();
  let report = await s.report();
  const [first, second] = report.suitability.candidates;
  assert.ok(first && second, 'the scenario has at least two options');
  const access = gate(first, 'access');
  assert.equal(access.state, 'unresolved');
  assert.ok(access.concerns.length >= 1);
  assert.ok(access.concerns.every((x) => x.by === 'system'));
  assert.equal(gate(first, 'ethics').state, 'not_assessed');
  assert.equal(first.gates.ethics_access, 'unresolved');
  // The blocked reason says which gate, who raised it and what it said.
  assert.ok(
    (first.gates.blocked.proceed_to_validation ?? []).some(
      (r) =>
        /ethics or access question is unresolved/.test(r) &&
        /Access \(automatic assessment\): Nothing in the packet shows/.test(r),
    ),
  );
  const confirm = (
    who: { actorId: string },
    c: RankedCandidate,
    g: 'ethics' | 'access',
    seen = gate(c, g).concerns.map((x) => x.scorecard),
  ) =>
    s.store.confirmGate(who, s.ws.id, s.problem.id, {
      alternative: { id: c.alternative.id, version: c.alternative.version },
      gate: g,
      reason: 'The team installs Python packages on lab PCs.',
      concerns_seen: seen,
    });
  await rejects('ACCESS_DENIED', confirm(s.editor, first, 'access'));
  // A confirmation must have seen every concern raised now.
  await rejects('VERSION_CONFLICT', confirm(owner, first, 'access', []));
  await confirm(owner, first, 'access');
  report = await s.report();
  let row = report.suitability.candidates.find(
    (c) => c.alternative.id === first.alternative.id,
  )!;
  assert.equal(gate(row, 'access').state, 'confirmed');
  assert.equal(gate(row, 'access').confirmation?.by, 'owner');
  // Ethics was only looked at by the assessment, so it still needs the owner.
  assert.equal(row.gates.ethics_access, 'not_assessed');
  await confirm(owner, row, 'ethics');
  row = (await s.report()).suitability.candidates.find(
    (c) => c.alternative.id === first.alternative.id,
  )!;
  assert.equal(row.gates.ethics_access, 'clear');
  assert.ok(
    !(row.gates.blocked.proceed_to_validation ?? []).some((r) =>
      /ethics|access/i.test(r),
    ),
  );
  await rejects(
    'INVALID_TRANSITION',
    confirm(owner, row, 'ethics'),
    /already confirmed/,
  );
  // The system cards' own ratings and gates are kept unchanged.
  const sys = await s.store.listEntities(owner, s.ws.id, { kind: 'scorecard' });
  assert.ok(
    sys
      .filter((c) => c.status === 'active')
      .every(
        (c) => (c.body as ScorecardBody).gates.access.status === 'unresolved',
      ),
  );

  // A newer assessment raises the concern again on new cards: the confirmation goes stale.
  await s.assess();
  row = (await s.report()).suitability.candidates.find(
    (c) => c.alternative.id === first.alternative.id,
  )!;
  assert.equal(gate(row, 'access').state, 'unresolved');
  assert.match(
    gate(row, 'access').stale_confirmation ?? '',
    /newer automatic assessment raised a concern/,
  );

  // Who clears gates: the owner by default, the owner's choice alone.
  const rule = await s.store.gateRule(owner, s.ws.id);
  assert.deepEqual([rule.version, rule.mode], [0, 'owner']);
  await rejects(
    'ACCESS_DENIED',
    s.store.setGateRule(s.editor, s.ws.id, {
      expected_version: 0,
      mode: 'model',
    }),
  );
  await s.store.setGateRule(owner, s.ws.id, {
    expected_version: 0,
    mode: 'team_profile',
  });
  s.adapter.access = null;
  await s.assess();
  const other = async () =>
    (await s.report()).suitability.candidates.find(
      (c) => c.alternative.id === second.alternative.id,
    )!;
  // No team profile was read, so nothing is cleared from it.
  assert.equal(gate(await other(), 'access').state, 'not_assessed');
  // A profile that answers no capability (notes only) is not enough either.
  await s.store.saveTeamProfile(
    owner,
    s.ws.id,
    { expected_version: 0, capabilities: [], notes: 'Small team.' },
    host,
  );
  await s.assess();
  assert.equal(gate(await other(), 'access').state, 'not_assessed');
  await s.store.saveTeamProfile(
    owner,
    s.ws.id,
    {
      expected_version: 1,
      capabilities: [{ key: 'python', status: 'yes' }],
      notes: 'Small team.',
    },
    host,
  );
  await s.assess();
  let row2 = await other();
  assert.equal(gate(row2, 'access').state, 'auto_cleared');
  assert.equal(gate(row2, 'access').confirmation?.by, 'rule');
  assert.equal(gate(row2, 'access').confirmation?.rule_mode, 'team_profile');
  // The team profile never clears ethics: the model's "clear" there still needs a person.
  assert.equal(gate(row2, 'ethics').state, 'not_assessed');
  assert.equal(row2.gates.ethics_access, 'not_assessed');
  // A concern raised by the assessment still blocks.
  s.adapter.access = 'The team cannot run Java on its computers.';
  await s.assess();
  assert.equal(gate(await other(), 'access').state, 'unresolved');

  // On the model's word (Jordan's explicit choice): ethics clears too, marked as such.
  await s.store.setGateRule(owner, s.ws.id, {
    expected_version: 1,
    mode: 'model',
  });
  row2 = await other();
  assert.equal(gate(row2, 'ethics').state, 'auto_cleared');
  assert.equal(gate(row2, 'ethics').confirmation?.rule_mode, 'model');
  assert.match(
    gate(row2, 'ethics').confirmation?.reason ?? '',
    /No person looked/,
  );
  // A concern still blocks on the model's word too.
  assert.equal(gate(row2, 'access').state, 'unresolved');
  s.adapter.access = null;
  await s.assess();
  row2 = await other();
  assert.equal(gate(row2, 'access').state, 'auto_cleared');
  assert.equal(row2.gates.ethics_access, 'clear');
  // Jordan's yes (November 12): a run's selection that advances an option whose ethics only the
  // model cleared carries the ethical-judgment stop; holding or rejecting it does not.
  const report2 = await s.report();
  const pick = (disposition: SelectionDisposition) => [
    { alternative: { id: second.alternative.id }, disposition },
  ];
  assert.equal(
    modelClearedEthics(report2, pick('proceed_to_validation')),
    true,
  );
  assert.equal(modelClearedEthics(report2, pick('select_for_build')), true);
  assert.equal(modelClearedEthics(report2, pick('defer')), false);
  assert.equal(gate(row2, 'ethics').rule, 'model');

  // End to end (review 3 L-2): an agent selecting under a routine policy is stopped for a
  // person; the owner selecting by hand is not; "proceed" lets the same request through.
  const agent = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: agent.actorId,
    kind: 'agent',
    display_name: 'Selection agent',
  });
  await s.store.addMember(owner, s.ws.id, agent.actorId, 'editor');
  const routineRun = async () => {
    const runId = await s.run();
    const input = {
      stages: ['model_work', 'selection'] as RoutineStage[],
      data_classes: ['synthetic' as const],
      max_actions: 20,
      max_total_nano_usd: null,
      stop_on: [],
      expires_at: new Date(Date.now() + 3_600_000).toISOString(),
      rationale: 'Routine synthetic selection (test).',
    };
    await s.store.setRoutinePolicy(owner, s.ws.id, runId, {
      ...input,
      summary_seen: routinePolicySummary(input),
    });
    return runId;
  };
  const selectReq = async (advance: boolean): Promise<SelectRequest> => {
    const r = await s.report();
    // An option whose ethics only the model cleared, and that may proceed to validation.
    const lead = r.suitability.candidates.find(
      (c) =>
        !(c.gates.blocked.proceed_to_validation ?? []).length &&
        gate(c, 'ethics').confirmation?.rule_mode === 'model',
    );
    assert.ok(lead, 'an option may proceed on a model-cleared ethics gate');
    return {
      problem: { id: r.problem.id, version: r.problem.version },
      report_hash: r.report_hash,
      dispositions: r.suitability.candidates.map((c) => ({
        alternative: { id: c.alternative.id, version: c.alternative.version },
        disposition:
          advance && c.alternative.id === lead.alternative.id
            ? ('proceed_to_validation' as const)
            : ('defer' as const),
        reasons: ['Synthetic disposition (test).'],
        reverse_if: 'New evidence (test).',
      })),
      override_reason: advance ? 'Validate this option first (test).' : null,
      rationale: 'Routine selection (test).',
      shortlist_size: 3,
      data_class: 'synthetic',
    };
  };
  // Deferring everything advances nothing, so the agent is not stopped.
  const deferred = await s.store.select(
    agent,
    s.ws.id,
    await routineRun(),
    await selectReq(false),
  );
  assert.equal(deferred.status, 'recorded', deferred.admission.explanation);
  const agentRun = await routineRun();
  const advanceReq = await selectReq(true);
  const stopped = await s.store.select(agent, s.ws.id, agentRun, advanceReq);
  assert.equal(stopped.status, 'needs_human');
  assert.equal(stopped.selection, null);
  const asked = await s.store.getDecision(
    owner,
    s.ws.id,
    stopped.admission.decision_id!,
  );
  assert.match(JSON.stringify(asked), /model’s word only/);
  // The owner selecting by hand under the same kind of policy is that person.
  const byHand = await s.store.select(
    owner,
    s.ws.id,
    await routineRun(),
    advanceReq,
  );
  assert.equal(byHand.status, 'recorded', byHand.admission.explanation);
  await s.store.answerDecision(owner, s.ws.id, asked.id, {
    choice: 'choose_option',
    option_id: 'proceed',
    rationale: 'I read the option; ethics is fine (test).',
    coverage_hash: asked.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: 500,
    interruption: null,
  });
  const retried = await s.store.select(agent, s.ws.id, agentRun, advanceReq);
  assert.equal(retried.status, 'recorded', retried.admission.explanation);

  // Back to the owner: every clear the rule made ends.
  await s.store.setGateRule(owner, s.ws.id, {
    expected_version: 2,
    mode: 'owner',
  });
  row2 = await other();
  assert.equal(gate(row2, 'access').state, 'not_assessed');
  assert.equal(gate(row2, 'ethics').state, 'not_assessed');
  assert.equal(
    modelClearedEthics(await s.report(), pick('proceed_to_validation')),
    false,
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.setGateRule(owner, s.ws.id, {
      expected_version: 3,
      mode: 'owner',
    }),
    /already how gates clear/,
  );
});

// UX pass P-4 (as Jordan revised it): one step confirms ethics and access for the options the
// owner ticks, one shared reason per gate, any option with its own reason instead; all or none.
test('the owner confirms several options’ gates in one step, with shared or own reasons recorded per option and gate', async (t) => {
  const s = await setup(t);
  if (!s) return;
  s.adapter.access =
    'Nothing in the packet shows the team can install Python tools (csvkit needs Python and pip).';
  await s.assess();
  const report = await s.report();
  const [first, second] = report.suitability.candidates;
  assert.ok(first && second, 'the scenario has at least two options');
  // The gate's reason comes first in every advancing choice the kind allows, so the page can
  // tell "only the gate blocks it" from "something else does too" (advanceOutlook).
  for (const c of report.suitability.candidates) {
    assert.notEqual(c.gates.ethics_access, 'clear');
    for (const d of ADVANCING_DISPOSITIONS.filter((x) =>
      kindAllows(c.alternative.kind, x),
    ))
      assert.match(
        c.gates.blocked[d]![0]!,
        /^(An ethics or access question is unresolved|Only the automatic assessment looked at ethics or access|Ethics and access have not been assessed|Your gate checklist did not clear)/,
      );
    assert.notEqual(advanceOutlook(c).state, 'now');
  }
  const item = (
    c: RankedCandidate,
    g: 'ethics' | 'access',
    reason: string | null = null,
  ) => ({
    alternative: { id: c.alternative.id, version: c.alternative.version },
    gate: g,
    concerns_seen: gate(c, g).concerns.map((x) => x.scorecard),
    reason,
  });
  const shared = {
    ethics: 'Public data only; no people are affected.',
    access: 'The team installs Python packages on lab PCs.',
  };
  const all = [
    item(first, 'ethics'),
    item(first, 'access'),
    item(second, 'ethics'),
    item(
      second,
      'access',
      'This one runs on the shared server, where pip is allowed.',
    ),
  ];
  await rejects(
    'ACCESS_DENIED',
    s.store.confirmGates(s.editor, s.ws.id, s.problem.id, {
      shared,
      items: all,
    }),
  );
  // A request must say which reason applies to every item, and names each option and gate once.
  await rejects(
    'INVALID_CONTRACT',
    s.store.confirmGates(owner, s.ws.id, s.problem.id, {
      shared: { ...shared, ethics: null },
      items: all,
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.confirmGates(owner, s.ws.id, s.problem.id, {
      shared,
      items: [...all, item(first, 'ethics')],
    }),
  );
  // One item that cannot be confirmed (a concern the page did not show) refuses the whole step,
  // naming the option; nothing is written.
  await rejects(
    'VERSION_CONFLICT',
    s.store.confirmGates(owner, s.ws.id, s.problem.id, {
      shared,
      items: [...all.slice(0, 3), { ...all[3]!, concerns_seen: [] }],
    }),
    new RegExp(
      `${second.alternative.title.slice(0, 20).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}.*access.*Nothing was confirmed`,
    ),
  );
  const untouched = await s.report();
  assert.ok(
    untouched.suitability.candidates.every((c) =>
      c.gates.gate_details!.every((d) => d.state !== 'confirmed'),
    ),
  );
  const done = await s.store.confirmGates(owner, s.ws.id, s.problem.id, {
    shared,
    items: all,
  });
  assert.equal(done.confirmations.length, 4);
  assert.deepEqual(
    done.confirmations.map((x) => [
      x.confirmation.alternative_id,
      x.confirmation.gate,
      x.reason_from,
      x.confirmation.reason,
    ]),
    [
      [first.alternative.id, 'ethics', 'shared', shared.ethics],
      [first.alternative.id, 'access', 'shared', shared.access],
      [second.alternative.id, 'ethics', 'shared', shared.ethics],
      [
        second.alternative.id,
        'access',
        'own',
        'This one runs on the shared server, where pip is allowed.',
      ],
    ],
  );
  // The audit log ties the four to one step and says whose reason applied to each.
  const ev = await s.db.pool.query(
    `select subject_id, payload from audit_events where action = 'gate.confirmed'
      and workspace_id = $1 order by sequence`,
    [s.ws.id],
  );
  assert.equal(ev.rows.length, 4);
  assert.ok(ev.rows.every((r) => r.payload.batch_id === done.batch_id));
  assert.deepEqual(
    ev.rows.map((r) => [r.payload.gate, r.payload.reason_from]),
    [
      ['ethics', 'shared'],
      ['access', 'shared'],
      ['ethics', 'shared'],
      ['access', 'own'],
    ],
  );
  const after = await s.report();
  for (const id of [first.alternative.id, second.alternative.id]) {
    const c = after.suitability.candidates.find(
      (x) => x.alternative.id === id,
    )!;
    assert.equal(c.gates.ethics_access, 'clear');
    assert.equal(gate(c, 'access').confirmation?.by, 'owner');
    assert.notEqual(advanceOutlook(c).state, 'after_gates');
  }
  // Confirmed gates are not confirmed twice, in one step or alone.
  await rejects(
    'INVALID_TRANSITION',
    s.store.confirmGates(owner, s.ws.id, s.problem.id, {
      shared,
      items: [item(first, 'ethics')],
    }),
    /already confirmed/,
  );
});

// Review L-4: the one-step route over HTTP: `/batch` reaches the one-step confirmation, writes
// need the CSRF token, and the single route still confirms one gate.
test('the one-step and single gate confirmation routes over HTTP', async (t) => {
  const s = await setup(t);
  if (!s) return;
  s.adapter.access =
    'Nothing in the packet shows the team can install Python tools (csvkit needs Python and pip).';
  await s.assess();
  const [first, second] = (await s.report()).suitability.candidates;
  assert.ok(first && second);
  const api = createApi({
    CREATOR_DATABASE_URL: s.db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const base = `http://127.0.0.1:${(api.server.address() as { port: number }).port}/api`;
  const auth = await login(base);
  const me = (await (
    await fetch(`${base}/auth/session`, { headers: auth.read })
  ).json()) as { actor_id: string };
  await s.store.addMember(owner, s.ws.id, me.actor_id, 'owner');
  const root = `${base}/workspaces/${s.ws.id}/problems/${s.problem.id}/gate-confirmations`;
  const send = (
    path: string,
    body: unknown,
    headers: Record<string, string> = auth.write,
  ) =>
    fetch(`${root}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    });
  const item = (c: RankedCandidate, g: 'ethics' | 'access') => ({
    alternative: { id: c.alternative.id, version: c.alternative.version },
    gate: g,
    concerns_seen: gate(c, g).concerns.map((x) => x.scorecard),
  });
  const batch = {
    shared: {
      ethics: 'Public data only; no people are affected.',
      access: null,
    },
    items: [{ ...item(first, 'ethics'), reason: null }],
  };
  assert.equal((await send('/batch', batch, auth.read)).status, 403);
  assert.equal(
    (await fetch(`${root}/batch`, { headers: auth.read })).status,
    404,
  );
  const done = await send('/batch', batch);
  assert.equal(done.status, 201);
  const result = ConfirmGatesResultSchema.parse(await done.json());
  assert.deepEqual(
    result.confirmations.map((x) => [x.confirmation.gate, x.reason_from]),
    [['ethics', 'shared']],
  );
  // A body for the single route is not a one-step request, and the other way round.
  assert.equal(
    (
      await send('/batch', {
        ...item(second, 'ethics'),
        reason: 'Fine for this option.',
      })
    ).status,
    400,
  );
  const one = await send('', {
    ...item(second, 'ethics'),
    reason: 'Fine for this option.',
  });
  assert.equal(one.status, 201);
  assert.equal(GateConfirmationSchema.parse(await one.json()).gate, 'ethics');
  assert.equal((await send('', batch)).status, 400);
});
