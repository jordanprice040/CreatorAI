import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  ExplorationPacketSchema,
  SearchBriefBodySchema,
  WorkflowDetailSchema,
  WorkflowSchema,
  type ErrorCode,
  type ExplorationResult,
  type ExplorerOutput,
  type StartExplorationRequest,
  type WorkflowDetail,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  EXPLORATION_MARKER,
  MAX_EXPLORATION_PACKET_CHARS,
  buildExplorationPacket,
  checkExplorationOutput,
  disposeExploration,
  hostMatches,
  mentions,
} from '@creator/domain';
import {
  FixtureAdapter,
  usage,
  type AdapterOutcome,
  type AdapterRequest,
  type ModelAdapter,
} from '@creator/broker';
import { discoverySetup, owner } from './discovery-harness.js';

// C53 "Explore for me" (ADR-0065): no theme in, an evidenced shortlist or an honest empty
// result out, decided by application code on the T05 workflow path.

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const scenario = (key: string) =>
  DISCOVERY_SCENARIOS.find((s) => s.key === key)!;
const result = (d: WorkflowDetail): ExplorationResult => {
  assert.ok(
    d.workflow.result?.exploration,
    `finished with an exploration result (${d.workflow.reason})`,
  );
  return d.workflow.result.exploration;
};
const answer = (json: unknown): AdapterOutcome => ({
  kind: 'completed',
  response_id: 'scripted',
  text: JSON.stringify(json),
  vector: null,
  usage: usage(40, 30, {}),
  incomplete_reason: null,
});

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
  explores() {
    return this.calls.filter((c) =>
      c.input[0]!.text.includes(EXPLORATION_MARKER),
    ).length;
  }
}

const card = (over: Partial<ExplorerOutput['candidates'][number]> = {}) => ({
  title: 'Missed first appointments at rural clinics',
  affected_users: 'Rural clinic patients and schedulers',
  observable_pain:
    'Many first appointments are missed and the slots go unused.',
  why_chosen: 'C1 reports the rate directly.',
  current_alternatives: ['Day-before reminder calls'],
  outcome_measure: 'First-appointment no-show rate',
  next_question: 'How many slots could be refilled?',
  uncertainty: 'One report; not independently confirmed.',
  fields: ['Clinic scheduling', 'Airline revenue management'] as [
    string,
    string,
  ],
  claim_refs: ['C1'],
  contrary_refs: [],
  catalog_ref: null,
  ...over,
});

async function setup(t: test.TestContext, adapter: ModelAdapter) {
  const s = await discoverySetup(t, adapter);
  if (!s) return null;
  const envelope = (await s.store.listEnvelopes(owner, s.ws.id))[0]!;
  const pricing = (await s.store.listPricing(owner, s.ws.id))[0]!;
  const request = (
    over: Partial<StartExplorationRequest> = {},
  ): StartExplorationRequest => ({
    scope: {
      interests: [],
      target_groups: [],
      exclusions: [],
      only_hosts: [],
      excluded_hosts: [],
      max_candidates: 3,
      max_claims: 30,
      max_age_days: 180,
      leave_out: [],
    },
    resource_setup: {
      kind: 'api',
      envelope_id: envelope.id,
      pricing_snapshot_id: pricing.id,
    },
    data_class: 'synthetic',
    limits: {
      max_children: 1,
      max_concurrency: 1,
      max_depth: 1,
      max_attempts: 1,
      max_repairs: 1,
      max_calls: 2,
      max_output_tokens: 4000,
      call_timeout_ms: 5000,
      max_wall_seconds: 600,
    },
    ...over,
  });
  const explore = async (over: Partial<StartExplorationRequest> = {}) => {
    const runId = await s.run();
    const started = await s.store.startExploration(
      owner,
      s.ws.id,
      runId,
      request(over),
    );
    await s.worker.settle();
    return s.store.getWorkflow(owner, s.ws.id, started.workflow.id);
  };
  return { ...s, request, explore };
}

test('no theme in: an evidenced shortlist, a brief from a pick, the same brief on a repeat', async (t) => {
  const adapter = new Recording();
  const s = await setup(t, adapter);
  if (!s) return;
  const seedRun = await s.run();
  await s.seed(scenario('software'), seedRun);
  const detail = await s.explore();
  assert.equal(detail.workflow.state, 'succeeded', detail.workflow.reason);
  assert.equal(detail.workflow.role, 'r01_exploration');
  // What the app reads must satisfy the contract (the list and the detail).
  WorkflowDetailSchema.parse(detail);
  for (const w of await s.store.listWorkflows(owner, s.ws.id, {}))
    WorkflowSchema.parse(w);
  assert.equal(adapter.explores(), 1);
  const r = result(detail);
  assert.equal(r.outcome, 'candidates');
  assert.ok(r.candidates.length >= 1 && r.candidates.length <= 3);
  const pick = r.candidates.find((c) => c.disposition === 'candidate')!;
  assert.ok(pick.claims.length >= 1);
  // The explorer read only recorded claims and says so.
  assert.ok(r.not_searched.notes.some((n) => /did not search the web/.test(n)));
  const packet = await s.store.explorationPacket(
    owner,
    s.ws.id,
    detail.workflow.id,
  );
  assert.equal(packet.packet_hash, r.packet_hash);
  assert.equal(packet.packet.claims.length, 6);
  // The catalog includes existing search briefs, so a brief already made is a duplicate later.
  assert.ok(packet.packet.catalog.some((k) => k.kind === 'search_brief'));

  const made = await s.store.createExploredBrief(
    owner,
    s.ws.id,
    detail.workflow.id,
    pick.ref,
    { reason: 'Test pick.' },
  );
  assert.equal(made.created, true);
  assert.equal(made.brief.kind, 'search_brief');
  SearchBriefBodySchema.parse(made.brief.body);
  const again = await s.store.createExploredBrief(
    owner,
    s.ws.id,
    detail.workflow.id,
    pick.ref,
    {},
  );
  assert.equal(again.created, false);
  assert.equal(again.brief.id, made.brief.id);
  await rejects(
    'NOT_FOUND',
    s.store.createExploredBrief(owner, s.ws.id, detail.workflow.id, 'E5', {}),
  );
  await s.store.drainOutbox();
  const history = await s.store.listHistory(owner, s.ws.id, {
    subject: made.brief.id,
  } as never);
  assert.ok(
    history.some((h) => h.action === 'exploration.brief_created'),
    'the pick is audited with the exploration',
  );
  // PR #131 review L-2/L-5: the preview shows what would be sent, without the pick's brief
  // (no workflow used it), and a claim the owner leaves out is not sent.
  const scope = s.request().scope;
  const preview = await s.store.previewExploration(owner, s.ws.id, scope);
  assert.ok(preview.chars <= preview.limit);
  assert.ok(!preview.packet.catalog.some((k) => k.id === made.brief.id));
  const skip = preview.packet.claims[0]!.claim_id;
  const fewer = await s.store.previewExploration(owner, s.ws.id, {
    ...scope,
    leave_out: [skip],
  });
  assert.equal(fewer.packet.claims.length, preview.packet.claims.length - 1);
  assert.ok(!fewer.packet.claims.some((c) => c.claim_id === skip));
  assert.equal(fewer.packet.not_searched.left_out_by_owner, 1);
  // Cards carry each cited claim's statement for display (review L-3).
  assert.ok(pick.claims.every((c) => c.statement.length > 0));
});

test('an empty workspace gives an honest empty result, and exclusions and websites narrow the packet', async (t) => {
  const adapter = new Recording();
  const s = await setup(t, adapter);
  if (!s) return;
  const empty = await s.explore();
  assert.equal(empty.workflow.state, 'succeeded');
  assert.equal(empty.workflow.result?.outcome, 'insufficient_evidence');
  assert.match(
    empty.workflow.result?.explanation ?? '',
    /No sufficiently supported problem/,
  );
  assert.equal(result(empty).outcome, 'no_candidates');

  const seedRun = await s.run();
  await s.seed(scenario('software'), seedRun);
  const narrowed = await s.explore({
    scope: {
      ...s.request().scope,
      exclusions: ['no-show'],
      excluded_hosts: ['journal.fixture.test'],
    },
  });
  const packet = await s.store.explorationPacket(
    owner,
    s.ws.id,
    narrowed.workflow.id,
  );
  const ns = packet.packet.not_searched;
  assert.ok(ns.excluded_by_topic >= 1, 'the no-show claim is left out');
  assert.ok(ns.excluded_by_website >= 1, 'journal claims are left out');
  for (const c of packet.packet.claims) {
    assert.ok(!mentions(c.statement, 'no-show'));
    assert.ok(c.passages.every((p) => !p.url.includes('journal.fixture.test')));
  }
  const only = await s.explore({
    scope: { ...s.request().scope, only_hosts: ['*.example.org'] },
  });
  const onlyPacket = await s.store.explorationPacket(
    owner,
    s.ws.id,
    only.workflow.id,
  );
  assert.equal(onlyPacket.packet.claims.length, 0);
  assert.equal(result(only).outcome, 'no_candidates');
});

test('a bad answer is repaired once; insufficient and excluded picks never become briefs', async (t) => {
  let n = 0;
  const adapter = new Recording((req) => {
    if (!req.input[0]!.text.includes(EXPLORATION_MARKER)) return null;
    n += 1;
    const text = req.input[1]!.text;
    const claims = (
      JSON.parse(text.slice(text.indexOf('\n') + 1)) as {
        claims: { ref: string; status: string }[];
      }
    ).claims;
    const good = claims.find((c) => c.status === 'supported')!.ref;
    const weak = claims.find(
      (c) => !['supported', 'contested'].includes(c.status),
    )!.ref;
    if (n === 1)
      return answer({
        summary: 'Cites a claim that is not there.',
        candidates: [card({ claim_refs: ['C99'] })],
        directions: [],
        not_covered: [],
      });
    return answer({
      summary: 'Three problems.',
      candidates: [
        card({
          title: 'Front-desk reminder calls take staff hours',
          observable_pain: 'Staff spend mornings phoning patients to confirm.',
          claim_refs: [good],
        }),
        card({
          title: 'Library e-book licence limits for students',
          observable_pain: 'Students cannot borrow course books in time.',
          fields: ['Libraries', 'Queueing'],
          claim_refs: [weak],
        }),
        card({
          title: 'Weekend volunteer shortages at the food bank',
          observable_pain:
            'Saturday shifts are understaffed and food bank lines grow.',
          fields: ['Volunteering', 'Shift scheduling'],
          claim_refs: [good],
        }),
      ],
      directions: [
        {
          direction: 'Pharmacy queues',
          why: 'Not in the packet.',
          question: 'Who waits?',
        },
      ],
      not_covered: ['Costs'],
    });
  });
  const s = await setup(t, adapter);
  if (!s) return;
  const seedRun = await s.run();
  await s.seed(scenario('software'), seedRun);
  await s.seed(scenario('insufficient'), seedRun);
  const detail = await s.explore({
    scope: { ...s.request().scope, exclusions: ['food bank'] },
  });
  assert.equal(detail.workflow.state, 'succeeded', detail.workflow.reason);
  const tasks = detail.tasks.filter((x) => x.kind === 'explore');
  assert.equal(tasks.length, 2);
  assert.equal(tasks[0]!.reason, 'invalid_output');
  assert.equal(tasks[1]!.repair, 1);
  const r = result(detail);
  assert.equal(r.directions.length, 1);
  assert.deepEqual(
    r.candidates.map((c) => c.disposition),
    ['candidate', 'insufficient_evidence', 'excluded'],
  );
  for (const ref of ['E2', 'E3'])
    await rejects(
      'INVALID_TRANSITION',
      s.store.createExploredBrief(owner, s.ws.id, detail.workflow.id, ref, {}),
    );
});

test('start is refused for human-only runs, replays on retry, and stops on cancel', async (t) => {
  const adapter = new Recording();
  const s = await setup(t, adapter);
  if (!s) return;
  const human = await s.run('human_only');
  await rejects(
    'HUMAN_ONLY_DENIED',
    s.store.startExploration(owner, s.ws.id, human, s.request()),
  );
  // A retried click with the same key returns the same exploration, not a second one.
  const runId = await s.run();
  const key = { ...owner, idempotencyKey: `explore-${randomUUID()}` };
  const a = await s.store.startExploration(key, s.ws.id, runId, s.request());
  const b = await s.store.startExploration(key, s.ws.id, runId, s.request());
  assert.equal(a.workflow.id, b.workflow.id);
  const cancelled = await s.store.controlWorkflow(
    owner,
    s.ws.id,
    a.workflow.id,
    'cancel',
    { expected_version: a.workflow.version, reason: 'Owner stop.' },
  );
  assert.equal(cancelled.workflow.state, 'cancelled');
  await s.worker.settle();
  assert.equal(adapter.explores(), 0, 'nothing was sent after the cancel');
  await rejects(
    'INVALID_TRANSITION',
    s.store.createExploredBrief(owner, s.ws.id, a.workflow.id, 'E1', {}),
  );
});

test('rules: host patterns, whole-word topics, ref checks and duplicates', () => {
  assert.ok(hostMatches('a.example.org', '*.example.org'));
  assert.ok(!hostMatches('example.org', '*.example.org'));
  assert.ok(!hostMatches('badexample.org', '*.example.org'));
  assert.ok(mentions('Food bank lines', 'food bank'));
  assert.ok(!mentions('Foodbanks', 'food bank'));
  const packet = buildExplorationPacket({
    scope: {
      interests: [],
      target_groups: [],
      exclusions: [],
      only_hosts: [],
      excluded_hosts: [],
      max_candidates: 1,
      max_claims: 30,
      max_age_days: 180,
      leave_out: [],
    },
    evidence: [],
    catalog: [
      {
        id: randomUUID(),
        kind: 'problem',
        version: 1,
        title: 'Missed first appointments at rural clinics',
        summary: 'First appointments are missed.',
      },
    ],
    now: new Date(),
  });
  const out = {
    summary: 'x',
    candidates: [card(), card()],
    directions: [],
    not_covered: [],
  };
  const tooMany = checkExplorationOutput(out, packet);
  assert.equal(tooMany.ok, false);
  const noRefs = checkExplorationOutput(
    { ...out, candidates: [card()] },
    packet,
  );
  assert.equal(noRefs.ok, false, 'C1 is not in an empty packet');
  const r = disposeExploration({
    packet: {
      ...packet,
      claims: [
        {
          ref: 'C1',
          claim_id: randomUUID(),
          version: 1,
          statement: 's',
          basis: 'observation',
          status: 'supported',
          labels: [],
          independent_origins: 1,
          contrary_origins: 0,
          passages: [],
        },
      ],
    },
    packet_hash: 'a'.repeat(64),
    task: {
      id: randomUUID(),
      output_hash: 'b'.repeat(64),
      output: { ...out, candidates: [card()] } as ExplorerOutput,
    },
  });
  assert.equal(r.candidates[0]!.disposition, 'duplicate');
  assert.equal(r.candidates[0]!.duplicate_of?.kind, 'problem');
  assert.equal(r.outcome, 'no_candidates');
  // A record the packet had no room for still counts as a duplicate (review N-6).
  const claimC1 = {
    ref: 'C1',
    claim_id: randomUUID(),
    version: 1,
    statement: 's',
    basis: 'observation' as const,
    status: 'supported' as const,
    labels: [],
    independent_origins: 1,
    contrary_origins: 0,
    passages: [],
  };
  const hidden = disposeExploration({
    packet: { ...packet, catalog: [], claims: [claimC1] },
    packet_hash: 'a'.repeat(64),
    task: {
      id: randomUUID(),
      output_hash: 'b'.repeat(64),
      output: { ...out, candidates: [card()] } as ExplorerOutput,
    },
    catalog: packet.catalog.map(({ ref: _ref, ...k }) => k),
  });
  assert.equal(hidden.candidates[0]!.disposition, 'duplicate');
  assert.ok(!/\(K\d+\)/.test(hidden.candidates[0]!.reasons[0]!));
});

test('a large workspace fits the one-message limit: newest claims first, the rest counted (review M-1)', () => {
  const long = (n: number, w: string) =>
    `${w} `.repeat(Math.ceil(n / (w.length + 1))).slice(0, n);
  const evidence = Array.from({ length: 40 }, (_, i) => {
    const id = randomUUID();
    return {
      claim: {
        id,
        version: 1,
        title: `Claim ${i}`,
        statement: long(150, `volunteers${i}`),
        basis: 'observation' as const,
      },
      status: 'supported' as const,
      labels: [],
      explanation: '',
      independent_origins: 1,
      contrary_origins: 0,
      max_age_days: 180,
      rows: Array.from({ length: 3 }, (_, j) => ({
        support: {
          id: randomUUID(),
          workspace_id: randomUUID(),
          claim_id: id,
          claim_version: 1,
          source_id: randomUUID(),
          source_version: 1,
          passage_id: randomUUID(),
          stance: 'supports' as const,
          support_type: null,
          quote: long(160, 'quoted'),
          rationale: 'r',
          link_id: null,
          asserted_by: randomUUID(),
          created_at: new Date().toISOString(),
          retracted_at: null,
          retraction_reason: null,
        },
        freshness: 'current' as const,
        counted: true,
        origin_cluster: randomUUID(),
        source_title: 'Source',
        source_url: `https://www${j}.example.org/${'path/'.repeat(10)}${i}`,
        source_current_version: 1,
      })),
    };
  });
  const catalog = Array.from({ length: 60 }, (_, i) => ({
    id: randomUUID(),
    kind: 'problem' as const,
    version: 1,
    title: long(500, `title${i}`),
    summary: long(400, `summary${i}`),
  }));
  const packet = buildExplorationPacket({
    scope: {
      interests: [],
      target_groups: [],
      exclusions: [],
      only_hosts: [],
      excluded_hosts: [],
      max_candidates: 3,
      max_claims: 30,
      max_age_days: 180,
      leave_out: [evidence[1]!.claim.id],
    },
    evidence: evidence as never,
    catalog,
    now: new Date(),
    unscanned: 5,
  });
  const size = JSON.stringify(packet).length;
  assert.ok(
    size <= MAX_EXPLORATION_PACKET_CHARS,
    `packet is ${size} characters`,
  );
  assert.ok(packet.claims.length >= 10, `${packet.claims.length} claims fit`);
  assert.ok(packet.claims.length < 30);
  // Newest first, contiguous: the claims read are the newest ones not left out.
  const expected = evidence
    .filter((_, i) => i !== 1)
    .slice(0, packet.claims.length)
    .map((e) => e.claim.id);
  assert.deepEqual(
    packet.claims.map((c) => c.claim_id),
    expected,
  );
  assert.equal(packet.not_searched.left_out_by_owner, 1);
  assert.equal(packet.not_searched.beyond_limit, 39 - packet.claims.length + 5);
  assert.ok(packet.not_searched.catalog_beyond_limit > 0);
  assert.ok(packet.catalog.length >= 1);
  assert.ok(
    packet.not_searched.notes.some((n) => /not read: the packet holds/.test(n)),
  );
  assert.ok(
    packet.not_searched.notes.some((n) => /not shown to the explorer/.test(n)),
  );
  ExplorationPacketSchema.parse(packet);
});
