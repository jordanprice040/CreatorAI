import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  AssessmentPacketSchema,
  ContractError,
  STARTER_GATE_CHECKLIST,
  type AssessmentPacket,
  type AssessorOutput,
  type ErrorCode,
  type RankedCandidate,
  type ScorecardBody,
  type SelectionDisposition,
  type StartAssessmentRequest,
  type TeamProfileBody,
} from '@creator/contracts';
import {
  ASSESSMENT_MARKER,
  DISCOVERY_SCENARIOS,
  assessmentFixtureAnswer,
  assessmentRoleInput,
  checkAssessmentOutput,
  modelClearedEthics,
  packetTeam,
  teamHash,
  verifiedCapabilities,
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

// ADR-0097: the owner's gate checklist. The assessor answers every item on suitability, a pass
// citing the packet; under the checklist rule code clears a gate only when every item for it
// passed on every current assessment, and access only when every capability the assessment
// says the option needs is Yes in the current profile, found by a check on this computer (or
// declared by the owner when no check can test it). Anything else stays open and is listed.

const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === code &&
      (!message || message.test(e.message)),
  );

// ---- Pure rules ------------------------------------------------------------------------

const v3 = JSON.parse(
  readFileSync(
    new URL(
      '../../config/connections/benchmarks/assessment-synthetic-v3.json',
      import.meta.url,
    ),
    'utf8',
  ),
) as {
  cases: { case_id: string; check: { packet: unknown } }[];
};
const packetOf = (id: string): AssessmentPacket =>
  AssessmentPacketSchema.parse(
    v3.cases.find((c) => c.case_id === id)!.check.packet,
  );
const fixtureFor = (p: AssessmentPacket) =>
  JSON.parse(assessmentFixtureAnswer(assessmentRoleInput(p))!) as Record<
    string,
    unknown
  > &
    AssessorOutput;
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x)) as T;

test('the assessor must answer every checklist item once on suitability, a pass citing the packet', () => {
  const p = packetOf('held-checklist-access-covered');
  assert.equal(p.checklist?.items.length, 3);
  const good = fixtureFor(p);
  delete (good as { fixture?: boolean }).fixture;
  assert.equal(checkAssessmentOutput(good, p).ok, true);
  const suit = (o: AssessorOutput) =>
    o.assessments.find((a) => a.rubric === 'suitability')!;
  assert.deepEqual(suit(good).access_needs, ['python']);

  const bad = (edit: (o: AssessorOutput) => void, problem: RegExp) => {
    const o = clone(good);
    edit(o);
    const r = checkAssessmentOutput(o, p);
    assert.equal(r.ok, false);
    assert.match((r as { problem: string }).problem, problem);
  };
  bad(
    (o) => delete suit(o).checklist!.K2,
    /does not answer exactly K1, K2, K3/,
  );
  bad((o) => {
    const k = suit(o).checklist!.K1!;
    k.claim_refs = [];
    k.team_refs = [];
  }, /K1 passes with nothing cited/);
  bad((o) => {
    suit(o).checklist!.K3!.team_refs = ['docker'];
  }, /team capability docker, not in the packet/);
  bad((o) => {
    suit(o).checklist!.K1!.claim_refs = ['C9'];
  }, /cites C9, not in the packet/);
  bad((o) => delete suit(o).access_needs, /does not answer the checklist/);
  bad((o) => {
    suit(o).access_needs = ['python', 'python'];
  }, /lists a needed capability twice/);
  // A fail or unknown needs no citation.
  const failing = clone(good);
  const k1 = suit(failing).checklist!.K1!;
  Object.assign(k1, { answer: 'fail', claim_refs: [], team_refs: [] });
  assert.equal(checkAssessmentOutput(failing, p).ok, true);

  // Without a checklist in the packet, an answer to one is not admissible.
  const plain = packetOf('held-access-covered');
  assert.equal(plain.checklist, undefined);
  const answer = fixtureFor(plain);
  delete (answer as { fixture?: boolean }).fixture;
  assert.equal(checkAssessmentOutput(answer, plain).ok, true);
  suit(answer).access_needs = [];
  assert.match(
    (checkAssessmentOutput(answer, plain) as { problem: string }).problem,
    /answers a checklist the packet does not ask for/,
  );
});

test('the app vouches only for a Yes found by a check on this computer, or declared when no check can test it', () => {
  const at = new Date().toISOString();
  const check = (machine: string) => ({
    command: 'python --version',
    detail: 'Python 3.12.1',
    output_hash: 'a'.repeat(64),
    machine,
    checked_at: at,
  });
  const profile: TeamProfileBody = {
    capabilities: [
      {
        key: 'python',
        status: 'yes',
        basis: 'check',
        note: null,
        check: check('lab-pc'),
      },
      {
        key: 'pip',
        status: 'yes',
        basis: 'check',
        note: null,
        check: check('old-laptop'),
      },
      {
        key: 'java',
        status: 'yes',
        basis: 'declared',
        note: null,
        check: null,
      },
      {
        key: 'installs_allowed',
        status: 'yes',
        basis: 'declared',
        note: null,
        check: null,
      },
      {
        key: 'internet',
        status: 'no',
        basis: 'declared',
        note: null,
        check: null,
      },
    ],
    notes: '',
  };
  assert.deepEqual(verifiedCapabilities(profile, 'lab-pc'), [
    'python',
    'installs_allowed',
  ]);
  assert.deepEqual(verifiedCapabilities(profile, 'old-laptop'), [
    'pip',
    'installs_allowed',
  ]);
  // The packet names each capability's key now; earlier assessments stay current.
  const team = packetTeam(profile, 3, 'lab-pc')!;
  assert.equal(team.capabilities[0]!.key, 'python');
  const legacy = {
    ...team,
    capabilities: team.capabilities.map(({ key: _k, ...c }) => c),
  };
  assert.equal(teamHash(team), teamHash(legacy));
});

// ---- Through the store -----------------------------------------------------------------

const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;

/** The fixture assessor; `edit` changes each answer before it is returned. */
class Assessor implements ModelAdapter {
  readonly provider = 'fixture' as const;
  readonly model_id = 'fixture-model-v1';
  readonly live = false;
  readonly inner = new FixtureAdapter();
  edit: ((o: AssessorOutput) => void) | null = null;
  packets: AssessmentPacket[] = [];
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
    this.edit?.(out);
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

test('the gate checklist is the owner’s and versioned; the checklist rule clears only what passed every item, and access only on capabilities the app confirmed here', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const machine = studioMachine();
  const host = { machine, checks: true };

  // Reading and saving: only the owner writes; every save is a new version.
  const empty = await s.store.gateChecklist(owner, s.ws.id);
  assert.deepEqual([empty.version, empty.items, empty.can_edit], [0, [], true]);
  assert.equal(
    (await s.store.gateChecklist(s.editor, s.ws.id)).can_edit,
    false,
  );
  const items = STARTER_GATE_CHECKLIST.map((x) => ({ ...x }));
  await rejects(
    'ACCESS_DENIED',
    s.store.saveGateChecklist(s.editor, s.ws.id, {
      expected_version: 0,
      items,
    }),
  );
  // Nothing can clear by an empty checklist, so the rule refuses it.
  await rejects(
    'INVALID_CONTRACT',
    s.store.setGateRule(owner, s.ws.id, {
      expected_version: 0,
      mode: 'checklist',
    }),
    /Save a gate checklist/,
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.saveGateChecklist(owner, s.ws.id, {
      expected_version: 0,
      items: [items[0]!, { ...items[0]! }],
    }),
    /listed twice/,
  );
  const v1 = await s.store.saveGateChecklist(owner, s.ws.id, {
    expected_version: 0,
    items,
  });
  assert.equal(v1.version, 1);
  assert.deepEqual(
    v1.items.map((x) => x.ref),
    ['K1', 'K2', 'K3', 'K4', 'K5', 'K6'],
  );
  await rejects(
    'VERSION_CONFLICT',
    s.store.saveGateChecklist(owner, s.ws.id, { expected_version: 0, items }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.saveGateChecklist(owner, s.ws.id, { expected_version: 1, items }),
    /Nothing changed/,
  );
  // An editor (an agent can be one) cannot choose the rule either.
  await rejects(
    'ACCESS_DENIED',
    s.store.setGateRule(s.editor, s.ws.id, {
      expected_version: 0,
      mode: 'checklist',
    }),
  );
  await s.store.setGateRule(owner, s.ws.id, {
    expected_version: 0,
    mode: 'checklist',
  });

  // The packet carries the checklist; the suitability cards record every answer.
  const preview = await s.store.previewAssessment(owner, s.ws.id, s.problem.id);
  assert.equal(preview.packet.checklist?.items.length, 6);
  await s.assess();
  const cards = (
    await s.store.listEntities(owner, s.ws.id, { kind: 'scorecard' })
  ).map((c) => c.body as ScorecardBody);
  for (const b of cards) {
    assert.equal(b.assessment?.checklist_version, 1);
    assert.equal(!!b.assessment?.checklist, b.rubric === 'suitability');
  }

  // No team profile: every ethics item passed (citing a claim), so ethics clears by the
  // checklist; access named no need, so the app has nothing to confirm and it stays open.
  let r = await s.report();
  for (const c of r.suitability.candidates) {
    const e = gate(c, 'ethics');
    assert.equal(e.state, 'auto_cleared');
    assert.equal(e.confirmation?.rule_mode, 'checklist');
    assert.match(e.confirmation?.reason ?? '', /all 3 ethics items/);
    const a = gate(c, 'access');
    assert.equal(a.state, 'not_assessed');
    assert.deepEqual(a.checklist?.needs, []);
  }
  const first = r.suitability.candidates[0]!;
  assert.match(
    (first.gates.blocked.proceed_to_validation ?? []).join(' '),
    /gate checklist did not clear .*no needed capability named/,
  );
  // Jordan's November 12 rule covers it: the item answers are the model's judgment.
  const pick = (disposition: SelectionDisposition) => [
    { alternative: { id: first.alternative.id }, disposition },
  ];
  assert.equal(modelClearedEthics(r, pick('proceed_to_validation')), true);

  // A check on this computer found Python; the assessment says the option needs it: the app
  // confirms it, and access clears.
  await s.store.recordCapabilityCheck(
    owner,
    s.ws.id,
    { expected_version: 0, capability: 'python' },
    {
      command: 'python --version',
      detail: 'Python 3.12.1',
      output_hash: 'c'.repeat(64),
      machine,
      checked_at: new Date().toISOString(),
    },
    host,
  );
  r = await s.report();
  assert.ok(
    r.suitability.candidates.every((c) => c.scorecards.every((x) => x.stale)),
  );
  await s.assess();
  r = await s.report();
  for (const c of r.suitability.candidates) {
    const a = gate(c, 'access');
    assert.equal(a.state, 'auto_cleared', JSON.stringify(a));
    assert.deepEqual(a.checklist?.needs, ['python']);
    assert.match(a.confirmation?.reason ?? '', /Run Python/);
  }

  // A check that ran on another computer is not this one's: the app cannot confirm it.
  await s.store.recordCapabilityCheck(
    owner,
    s.ws.id,
    { expected_version: 1, capability: 'python' },
    {
      command: 'python --version',
      detail: 'Python 3.13.0',
      output_hash: 'd'.repeat(64),
      machine: `${machine}-other`.slice(0, 120),
      checked_at: new Date().toISOString(),
    },
    host,
  );
  await s.assess();
  r = await s.report();
  for (const c of r.suitability.candidates) {
    const a = gate(c, 'access');
    assert.equal(a.state, 'not_assessed');
    assert.deepEqual(a.checklist?.needs_missing, ['python']);
  }

  // Any fail keeps the gate open and is listed with its note.
  s.adapter.edit = (o) => {
    for (const a of o.assessments)
      if (a.checklist)
        a.checklist.K2 = {
          answer: 'fail',
          claim_refs: [],
          team_refs: [],
          note: 'The option logs people without telling them.',
        };
  };
  await s.assess();
  r = await s.report();
  for (const c of r.suitability.candidates) {
    const e = gate(c, 'ethics');
    assert.equal(e.state, 'not_assessed');
    assert.deepEqual(
      e.checklist?.failing.map((f) => [f.item, f.answer, f.note]),
      [['K2', 'fail', 'The option logs people without telling them.']],
    );
  }
  assert.equal(
    modelClearedEthics(r, [
      {
        alternative: { id: r.suitability.candidates[0]!.alternative.id },
        disposition: 'proceed_to_validation',
      },
    ]),
    false,
  );

  // Changing the checklist makes every assessment out of date (it answered the old list).
  await s.store.saveGateChecklist(owner, s.ws.id, {
    expected_version: 1,
    items: items.slice(0, 5),
  });
  r = await s.report();
  for (const c of r.suitability.candidates)
    assert.ok(
      c.scorecards.every(
        (x) =>
          x.stale &&
          (x.stale_reasons ?? []).some((m) => /gate checklist changed/.test(m)),
      ),
    );
  // The rule's mode is recorded as checklist.
  assert.equal((await s.store.gateRule(owner, s.ws.id)).mode, 'checklist');
});
