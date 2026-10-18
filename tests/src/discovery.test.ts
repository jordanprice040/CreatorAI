import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractError,
  type DiscoveryResult,
  type ErrorCode,
  type LocatorOutput,
  type WorkflowDetail,
} from '@creator/contracts';
import { DISCOVERY_SCENARIOS, discoveryFixtureAnswer } from '@creator/domain';
import {
  FixtureAdapter,
  usage,
  type AdapterOutcome,
  type AdapterRequest,
  type ModelAdapter,
} from '@creator/broker';
import { discoverySetup, owner } from './discovery-harness.js';

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const scenario = (key: string) =>
  DISCOVERY_SCENARIOS.find((s) => s.key === key)!;
const result = (d: WorkflowDetail): DiscoveryResult => {
  assert.ok(
    d.workflow.result?.discovery,
    `finished with a discovery result (${d.workflow.reason})`,
  );
  return d.workflow.result.discovery;
};
const byType = (r: DiscoveryResult, p: string) =>
  r.proposals.find((x) => x.perspective === p)!;

/** Records every request and answers with the fixture model, optionally overriding one. */
class Recording implements ModelAdapter {
  readonly provider = 'fixture' as const;
  readonly model_id = 'fixture-model-v1';
  readonly live = false;
  readonly inner = new FixtureAdapter();
  calls: AdapterRequest[] = [];
  constructor(
    private readonly override: (
      req: AdapterRequest,
      n: number,
    ) => AdapterOutcome | null = () => null,
  ) {}
  call(req: AdapterRequest, signal: AbortSignal) {
    this.calls.push(req);
    return Promise.resolve(this.override(req, this.calls.length)).then(
      (o) => o ?? this.inner.call(req, signal),
    );
  }
  kinds() {
    return this.calls.map(
      (c) => /\[discovery-task:(\w+)\]/.exec(c.input[0]!.text)?.[1],
    );
  }
}
const answer = (json: unknown): AdapterOutcome => ({
  kind: 'completed',
  response_id: 'scripted',
  text: JSON.stringify(json),
  vector: null,
  usage: usage(40, 30, {}),
  incomplete_reason: null,
});

test('software-suitable case: cross-field locator, independent proposals, a known duplicate, bounded revision', async (t) => {
  const adapter = new Recording();
  const s = await discoverySetup(t, adapter);
  if (!s) return;
  const { detail } = await s.discover(scenario('software'));
  assert.equal(detail.workflow.state, 'succeeded', detail.workflow.reason);
  assert.equal(detail.workflow.role, 'r02_discovery');
  const r = result(detail);
  assert.equal(r.outcome, 'candidates');
  assert.equal(r.sufficiency.verdict, 'sufficient');

  // Cross-field reasoning: a supported mechanism that transfers, not just two field names.
  const locate = detail.tasks.find((x) => x.kind === 'locate')!;
  const brief = locate.output as LocatorOutput;
  assert.ok(brief.cross_field);
  assert.match(brief.cross_field.transferred_mechanism, /overbooking/i);
  assert.equal(r.locator?.mechanism_support, 'supported');

  // Software is a candidate after one revision; the contested evidence stays as dissent.
  const software = byType(r, 'software');
  assert.equal(software.disposition, 'candidate');
  assert.equal(software.revisions, 1);
  assert.equal(software.verdict, 'stands');
  assert.ok(software.dissent.some((d) => /contested/.test(d)));
  assert.equal(software.recommendation, 'consider');

  // The process-change proposal repeats a catalog idea: application code marks it.
  const process = byType(r, 'process_change');
  assert.equal(process.disposition, 'duplicate');
  assert.equal(process.duplicate_of?.kind, 'idea');

  // Independence: first proposals share the packet and read only the locator.
  assert.equal(
    r.independence.verified,
    true,
    r.independence.problems.join('; '),
  );
  assert.deepEqual(r.independence.shared_inputs, [locate.id]);
  const firstProposals = detail.tasks.filter((x) => x.kind === 'propose');
  assert.equal(firstProposals.length, 5);
  for (const p of firstProposals) {
    assert.equal(p.context.context_version, 'discovery-context/1');
    if (p.context.context_version !== 'discovery-context/1') continue;
    assert.equal(p.context.packet_hash, r.packet_hash);
    assert.deepEqual(
      p.context.inputs.map((i) => i.task_id),
      [locate.id],
    );
  }
  // What the provider actually received for each first proposal: system, packet, assignment
  // and the locator brief. No sibling proposal text appears in any of them.
  const proposeCalls = adapter.calls.filter((c) =>
    c.input[0]!.text.includes('[discovery-task:propose]'),
  );
  assert.equal(proposeCalls.length, 5);
  const outputs = firstProposals.map((p) => JSON.stringify(p.output));
  for (const call of proposeCalls) {
    assert.equal(call.input.length, 4);
    assert.match(call.input[3]!.text, /^Input locator /);
    const text = call.input.map((m) => m.text).join('\n');
    assert.ok(
      !/Input (P[1-5]|skeptic)/.test(text),
      'no proposal or skeptic input',
    );
    for (const o of outputs) assert.ok(!text.includes(o), 'no sibling answer');
  }
  assert.deepEqual(adapter.kinds(), [
    'locate',
    'propose',
    'propose',
    'propose',
    'propose',
    'propose',
    'skeptic',
    'revise',
    'skeptic',
  ]);
  assert.equal(r.skeptic_passes, 2);
  assert.equal(r.revision_rounds, 1);

  // The catalog now holds the problem and every proposal, linked to the brief.
  assert.ok(r.catalog_records.problem);
  assert.equal(r.catalog_records.alternatives.length, 5);
  const problem = await s.store.getEntity(
    owner,
    s.ws.id,
    r.catalog_records.problem.id,
  );
  assert.ok(
    problem.outgoing.some(
      (l) => l.relation === 'derived_from' && l.to.kind === 'search_brief',
    ),
  );
  assert.ok(
    problem.incoming.some(
      (l) => l.relation === 'supports' && l.from.kind === 'claim',
    ),
  );
  const dup = await s.store.getEntity(
    owner,
    s.ws.id,
    r.catalog_records.alternatives.find((a) => a.proposal === process.proposal)!
      .id,
  );
  assert.match(String(dup.entity.body?.uncertainty), /Disposition: duplicate/);
  assert.equal(dup.entity.body?.kind, 'change_process');
});

test('justified existing-tool choice: software is not recommended when an existing tool covers the need', async (t) => {
  const s = await discoverySetup(t, new Recording());
  if (!s) return;
  const sc = scenario('existing_tool');
  const { detail } = await s.discover(sc);
  const r = result(detail);
  assert.equal(r.outcome, 'candidates');
  const software = byType(r, 'software');
  assert.equal(software.disposition, 'not_recommended');
  assert.match(software.reasons.join(' '), /existing tool already covers/i);
  const tool = byType(r, 'existing_tool');
  assert.equal(tool.disposition, 'candidate');
  assert.equal(tool.recommendation, 'recommend');
  // Excluded response types are explained, not silently dropped.
  assert.deepEqual(
    r.excluded.map((e) => e.perspective),
    ['human_led', 'hybrid'],
  );
  // No mechanism claim: the locator says so instead of inventing one.
  const locate = detail.tasks.find((x) => x.kind === 'locate')!
    .output as LocatorOutput;
  assert.equal(locate.cross_field, null);
  assert.ok(locate.cross_field_absent_reason);
  assert.equal(r.locator?.mechanism_support, 'none');
});

test('insufficient evidence stops after the locator and proposes nothing', async (t) => {
  const adapter = new Recording();
  const s = await discoverySetup(t, adapter);
  if (!s) return;
  const { detail } = await s.discover(scenario('insufficient'));
  assert.equal(detail.workflow.state, 'succeeded');
  assert.equal(detail.workflow.result?.outcome, 'insufficient_evidence');
  const r = result(detail);
  assert.equal(r.outcome, 'insufficient_evidence');
  assert.equal(r.sufficiency.verdict, 'insufficient');
  assert.match(r.sufficiency.reasons.join(' '), /the problem is inaccessible/);
  assert.deepEqual(adapter.kinds(), ['locate']);
  assert.ok(
    r.proposals.every(
      (p) => p.disposition === 'insufficient_evidence' && p.task_id === null,
    ),
  );
  assert.equal(r.catalog_records.alternatives.length, 0);
  const problem = await s.store.getEntity(
    owner,
    s.ws.id,
    r.catalog_records.problem!.id,
  );
  assert.match(String(problem.entity.body?.uncertainty), /insufficient/);
  const locate = detail.tasks.find((x) => x.kind === 'locate')!
    .output as LocatorOutput;
  assert.equal(locate.evidence_strength, 'insufficient');
});

test('answers that cite evidence outside the packet or only name the fields are repaired, not accepted', async (t) => {
  let bad = 0;
  const adapter = new Recording((req) => {
    const text = req.input[0]!.text;
    if (!text.includes('[discovery-task:locate]') || bad >= 2) return null;
    bad += 1;
    const good = JSON.parse(
      discoveryFixtureAnswer(req.input)!,
    ) as LocatorOutput;
    return answer(
      bad === 1
        ? { ...good, urgency: { ...good.urgency, claim_refs: ['C9'] } }
        : {
            ...good,
            cross_field: {
              ...good.cross_field!,
              transferred_mechanism:
                'Airline revenue management meets primary care scheduling here.',
            },
          },
    );
  });
  const s = await discoverySetup(t, adapter);
  if (!s) return;
  const { detail } = await s.discover(scenario('software'), {
    limits: {
      max_children: 5,
      max_concurrency: 2,
      max_depth: 1,
      max_attempts: 1,
      max_repairs: 2,
      max_calls: 30,
      max_output_tokens: 4000,
      call_timeout_ms: 5000,
      max_wall_seconds: 600,
    },
  });
  const locates = detail.tasks
    .filter((x) => x.kind === 'locate')
    .sort((a, b) => a.repair - b.repair);
  assert.deepEqual(
    locates.map((x) => [x.repair, x.state, x.reason]),
    [
      [0, 'failed', 'invalid_output'],
      [1, 'failed', 'invalid_output'],
      [2, 'succeeded', 'succeeded'],
    ],
  );
  assert.equal(result(detail).outcome, 'candidates');
});

test('the revision limit is enforced and unresolved objections are kept as dissent', async (t) => {
  const adapter = new Recording();
  const s = await discoverySetup(t, adapter);
  if (!s) return;
  const { detail } = await s.discover(scenario('software'), {
    max_revisions: 0,
  });
  const r = result(detail);
  assert.equal(detail.tasks.filter((x) => x.kind === 'revise').length, 0);
  assert.equal(r.skeptic_passes, 1);
  const software = byType(r, 'software');
  assert.equal(software.verdict, 'revise');
  assert.equal(software.disposition, 'candidate');
  assert.match(software.reasons.join(' '), /still asks for revision/);
  assert.match(detail.workflow.result!.explanation, /revision limit \(0\)/);
});

test('start requests: exclusions, a non-software option, brief shape, human-only runs and changed claims', async (t) => {
  const s = await discoverySetup(t, new Recording());
  if (!s) return;
  const sc = scenario('existing_tool');
  const runId = await s.run();
  const seeded = await s.seed(sc, runId);
  const base = s.request(sc, seeded);
  // Every response type must be assigned or excluded with a reason.
  await rejects(
    'INVALID_CONTRACT',
    s.store.startDiscovery(owner, s.ws.id, runId, { ...base, excluded: [] }),
  );
  // At least one response that is not new software.
  await rejects(
    'INVALID_CONTRACT',
    s.store.startDiscovery(owner, s.ws.id, runId, {
      ...base,
      perspectives: ['software'],
      excluded: ['existing_tool', 'process_change', 'human_led', 'hybrid'].map(
        (p) => ({
          perspective: p,
          reason: 'Left out for this test.',
        }),
      ),
    }),
  );
  // A Grand Challenge cannot be the theme itself; two distinct fields are required.
  await rejects(
    'INVALID_CONTRACT',
    s.store.createEntity(owner, s.ws.id, {
      kind: 'search_brief',
      title: 'Too broad',
      body: {
        ...sc.brief,
        theme: 'Provide access to clean water',
        nae_seed: 'Provide access to clean water',
      },
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.createEntity(owner, s.ws.id, {
      kind: 'search_brief',
      title: 'Same field twice',
      body: {
        ...sc.brief,
        fields: ['Volunteer management', 'volunteer  management'],
      },
    }),
  );
  // The subject must be a search brief.
  await rejects(
    'INVALID_CONTRACT',
    s.store.startDiscovery(owner, s.ws.id, runId, {
      ...base,
      brief: { id: seeded.evidence[0]!.claim_id, version: 1 },
    }),
  );
  // Human-only runs never start model roles.
  const humanOnly = await s.run('human_only');
  await rejects(
    'HUMAN_ONLY_DENIED',
    s.store.startDiscovery(owner, s.ws.id, humanOnly, base),
  );
  // A claim revised after the packet is read cannot slip in: the packet binds its version.
  const claimId = seeded.evidence[0]!.claim_id;
  const claim = await s.store.getEntity(owner, s.ws.id, claimId);
  await s.store.reviseEntity(owner, s.ws.id, claimId, {
    expected_version: 1,
    title: claim.entity.title,
    body: { ...claim.entity.body, uncertainty: 'Revised.' },
    reason: 'Test revision.',
    corrects_version: null,
  });
  const started = await s.store.startDiscovery(owner, s.ws.id, runId, base);
  const packet = await s.store.discoveryPacket(
    owner,
    s.ws.id,
    started.workflow.id,
  );
  const c1 = packet.packet.claims[0]!;
  assert.equal(c1.version, 2);
  // Support was recorded for version 1, so it no longer counts for the revised claim.
  assert.equal(c1.status, 'insufficient');
  assert.equal(packet.packet.sufficiency.verdict, 'insufficient');
});
