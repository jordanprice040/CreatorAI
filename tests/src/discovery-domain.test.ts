import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  PLAN_REQUEST_TIMEOUT_MAX_MS,
  EvidencePacketSchema,
  SearchBriefBodySchema,
  StartDiscoveryRequestSchema,
  WORKFLOW_WALL_MAX_SECONDS,
  type DiscoveryTaskContext,
  type EvidencePacket,
  type PacketClaim,
  type ProposalOutput,
  type WorkflowLimits,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  MAX_PACKET_CHARS,
  assessSufficiency,
  buildPacket,
  canonicalHash,
  catalogMatches,
  checkDiscoveryOutput,
  coordinateDiscovery,
  discoveryFixtureAnswer,
  discoveryRoleInput,
  disposeDiscovery,
  type CoordinatorTask,
  type DiscoveryView,
  type DispositionTask,
} from '@creator/domain';

// Pure discovery rules (T07); these run without PostgreSQL.

const limits: WorkflowLimits = {
  max_children: 5,
  max_concurrency: 4,
  max_depth: 1,
  max_attempts: 1,
  max_repairs: 1,
  max_calls: 24,
  max_output_tokens: 4000,
  call_timeout_ms: 5000,
  max_wall_seconds: 600,
};
const brief = DISCOVERY_SCENARIOS[0]!.brief;
const claim = (
  ref: string,
  bears_on: PacketClaim['bears_on'],
  status: PacketClaim['status'],
  statement = `Claim ${ref} statement.`,
): PacketClaim => ({
  ref,
  claim_id: randomUUID(),
  version: 1,
  statement,
  basis: 'observation',
  bears_on,
  status,
  labels: [],
  independent_origins: status === 'supported' ? 1 : 0,
  contrary_origins: 0,
  passages: [],
});
function packet(
  claims: PacketClaim[],
  catalog: EvidencePacket['catalog'] = [],
): EvidencePacket {
  return {
    packet_version: 'discovery-packet/1',
    kind: 'untrusted_evidence/1',
    authority: 'none',
    brief: {
      id: randomUUID(),
      version: 1,
      content_hash: 'a'.repeat(64),
      title: 'Brief',
      body: brief,
    },
    claims,
    catalog,
    sufficiency: assessSufficiency(claims),
    max_age_days: 180,
    assessed_at: new Date().toISOString(),
  };
}
const ctx = (
  over: Partial<DiscoveryTaskContext> = {},
): DiscoveryTaskContext => ({
  context_version: 'discovery-context/1',
  role_version: 'r02-discovery/1.0',
  packet_hash: 'b'.repeat(64),
  perspective: null,
  proposal: null,
  round: 0,
  inputs: [],
  catalog_matches: [],
  ...over,
});
/** Runs the fixture role for a task and returns its parsed answer. */
const fixture = (
  kind: 'locate' | 'propose' | 'skeptic',
  p: EvidencePacket,
  c: DiscoveryTaskContext,
  inputs: { label: string; kind: 'locate' | 'propose'; output: unknown }[] = [],
) =>
  JSON.parse(
    discoveryFixtureAnswer(discoveryRoleInput(kind, c, p, inputs))!,
  ) as unknown;

test('search briefs: Grand Challenge seeds must be narrowed and the two fields must differ', () => {
  assert.equal(SearchBriefBodySchema.safeParse(brief).success, true);
  assert.equal(
    SearchBriefBodySchema.safeParse({
      ...brief,
      theme: 'advance  health informatics',
    }).success,
    false,
  );
  assert.equal(
    SearchBriefBodySchema.safeParse({
      ...brief,
      fields: ['Retail', ' retail '],
    }).success,
    false,
  );
  assert.equal(
    SearchBriefBodySchema.safeParse({ ...brief, nae_seed: 'Cure boredom' })
      .success,
    false,
  );
  assert.equal(
    SearchBriefBodySchema.safeParse({ ...brief, outcome_measure: '' }).success,
    false,
  );
});

test('start requests name every response type and include a non-software option', () => {
  const base = {
    brief: { id: randomUUID(), version: 1 },
    evidence: [{ claim_id: randomUUID(), bears_on: ['problem'] }],
    perspectives: ['software', 'existing_tool', 'process_change'],
    excluded: [
      { perspective: 'human_led', reason: 'Out of scope.' },
      { perspective: 'hybrid', reason: 'Out of scope.' },
    ],
    max_revisions: 1,
    envelope_id: randomUUID(),
    pricing_snapshot_id: randomUUID(),
    data_class: 'synthetic',
    limits,
  };
  assert.equal(StartDiscoveryRequestSchema.safeParse(base).success, true);
  assert.equal(StartDiscoveryRequestSchema.parse(base).max_age_days, 180);
  const bad = (over: object) =>
    StartDiscoveryRequestSchema.safeParse({ ...base, ...over }).success;
  assert.equal(
    bad({ excluded: base.excluded.slice(1) }),
    false,
    'unexplained omission',
  );
  assert.equal(
    bad({
      perspectives: ['software', 'existing_tool'],
      excluded: [
        ...base.excluded,
        { perspective: 'existing_tool', reason: 'x' },
      ],
    }),
    false,
    'named twice',
  );
  assert.equal(bad({ max_revisions: 3 }), false, 'revision cap');
  assert.equal(
    bad({ limits: { ...limits, max_calls: 4 } }),
    false,
    'calls must cover the minimum run',
  );
  // ADR-0062 (PR #123 review M-2): a plan-backed run's calls follow the connection's request
  // timeout, which may exceed 10 minutes now, with a wall time to match; API runs keep the
  // broker's 600 s per-call bound. The plan output cap has no 100,000-character ceiling.
  const plan = {
    ...base,
    envelope_id: undefined,
    pricing_snapshot_id: undefined,
    resource_setup: {
      kind: 'subscription',
      connection_id: randomUUID(),
      model_id: 'gpt-x',
      settings_hash: 'a'.repeat(64),
      max_output_chars: 400_000,
    },
    limits: {
      ...limits,
      max_concurrency: 1,
      call_timeout_ms: 3_600_000,
      max_wall_seconds: 24 * 3600 + 60,
    },
  };
  const planCheck = StartDiscoveryRequestSchema.safeParse(plan);
  assert.equal(planCheck.success, true, JSON.stringify(planCheck.error));
  assert.equal(
    bad({ limits: { ...limits, call_timeout_ms: 900_000 } }),
    false,
    'API calls stay within 600 s',
  );
  assert.equal(bad({ limits: { ...limits, call_timeout_ms: 600_000 } }), true);
  assert.equal(
    bad({ limits: { ...limits, max_wall_seconds: 86_401 } }),
    false,
    'API runs end within a day',
  );
  // Re-review L-3: Submit's wall time at the very top of the range, clamped, is accepted.
  const top = Math.min(
    WORKFLOW_WALL_MAX_SECONDS,
    Math.ceil((60 * PLAN_REQUEST_TIMEOUT_MAX_MS) / 1000) + 60,
  );
  assert.equal(
    StartDiscoveryRequestSchema.safeParse({
      ...plan,
      limits: {
        ...plan.limits,
        max_calls: 60,
        call_timeout_ms: PLAN_REQUEST_TIMEOUT_MAX_MS,
        max_wall_seconds: top,
      },
    }).success,
    true,
  );
  assert.equal(
    StartDiscoveryRequestSchema.safeParse({
      ...plan,
      limits: {
        ...plan.limits,
        max_wall_seconds: WORKFLOW_WALL_MAX_SECONDS + 1,
      },
    }).success,
    false,
  );
});

test('sufficiency depends on current problem evidence; other gaps are named', () => {
  const ok = assessSufficiency([claim('C1', ['problem'], 'contested')]);
  assert.equal(ok.verdict, 'sufficient');
  assert.match(ok.reasons.join(' '), /problem is contested/);
  assert.match(
    ok.reasons.join(' '),
    /No claim in the packet addresses data availability/,
  );
  const none = assessSufficiency([
    claim('C1', ['problem'], 'inferred'),
    claim('C2', ['problem', 'data'], 'inaccessible'),
  ]);
  assert.equal(none.verdict, 'insufficient');
  assert.equal(none.by_role.problem, 'inferred');
  assert.equal(none.by_role.data, 'inaccessible');
});

test('duplicates are found by deterministic word overlap with the catalog', () => {
  const catalog = [
    {
      ref: 'K1',
      id: randomUUID(),
      kind: 'idea' as const,
      version: 1,
      title: 'Phone patients the day before appointments to confirm attendance',
      summary: 'Reception calls each booked patient.',
    },
    {
      ref: 'K2',
      id: randomUUID(),
      kind: 'problem' as const,
      version: 1,
      title: 'Saturday shifts are short',
      summary: '',
    },
  ];
  const [m] = catalogMatches(
    {
      title:
        'Front-desk staff phone patients the day before appointments to confirm attendance.',
      mechanism: 'Make it routine.',
    },
    catalog,
  );
  assert.equal(m?.entry.ref, 'K1');
  assert.equal(m?.duplicate, true);
  assert.deepEqual(
    catalogMatches(
      { title: 'Predict no-shows from exports', mechanism: 'Overbooking.' },
      catalog,
    ),
    [],
  );
});

test('answers are checked against the packet, the brief fields and the task', () => {
  const p = packet([
    claim('C1', ['problem'], 'supported'),
    claim(
      'C2',
      ['mechanism'],
      'supported',
      'Overbooking levels set from historical no-show rates fill seats expected to go empty.',
    ),
  ]);
  const locator = fixture('locate', p, ctx()) as Record<string, unknown> & {
    cross_field: Record<string, unknown>;
  };
  assert.equal(checkDiscoveryOutput('locate', locator, p, ctx()).ok, true);
  const cited = checkDiscoveryOutput(
    'locate',
    {
      ...locator,
      gaps: [],
      urgency: { frequency: 'x', severity: 'low', claim_refs: ['C7'] },
    },
    p,
    ctx(),
  );
  assert.deepEqual(cited, {
    ok: false,
    problem: 'cites C7, not in the packet',
  });
  const wrongFields = {
    ...locator,
    cross_field: { ...locator.cross_field, to_field: 'astronomy' },
  };
  assert.equal(checkDiscoveryOutput('locate', wrongFields, p, ctx()).ok, false);
  const namesOnly = {
    ...locator,
    cross_field: {
      ...locator.cross_field,
      transferred_mechanism:
        'Airline revenue management and primary care scheduling, combined.',
    },
  };
  assert.deepEqual(checkDiscoveryOutput('locate', namesOnly, p, ctx()), {
    ok: false,
    problem: 'cross_field names the fields but no mechanism that transfers',
  });
  const neither = {
    ...locator,
    cross_field: null,
    cross_field_absent_reason: null,
  };
  assert.equal(checkDiscoveryOutput('locate', neither, p, ctx()).ok, false);

  const designer = ctx({ perspective: 'software', proposal: 'P1' });
  const proposal = fixture('propose', p, designer) as ProposalOutput;
  assert.equal(checkDiscoveryOutput('propose', proposal, p, designer).ok, true);
  assert.equal(
    checkDiscoveryOutput(
      'propose',
      proposal,
      p,
      ctx({ perspective: 'hybrid', proposal: 'P1' }),
    ).ok,
    false,
    'answers for its own perspective only',
  );
  assert.equal(
    checkDiscoveryOutput('revise', proposal, p, designer).ok,
    false,
    'revision must answer findings',
  );

  const skepticCtx = ctx({
    inputs: [
      {
        task_id: randomUUID(),
        output_hash: 'c'.repeat(64),
        kind: 'propose',
        label: 'P1 software',
      },
      {
        task_id: randomUUID(),
        output_hash: 'd'.repeat(64),
        kind: 'propose',
        label: 'P2 hybrid',
      },
    ],
  });
  const review = { verdict: 'stands', findings: [], cheaper_test: null };
  assert.equal(
    checkDiscoveryOutput(
      'skeptic',
      { summary: 'x', reviews: [{ proposal: 'P1', ...review }] },
      p,
      skepticCtx,
    ).ok,
    false,
    'every proposal is reviewed',
  );
  assert.equal(
    checkDiscoveryOutput(
      'skeptic',
      {
        summary: 'x',
        reviews: [
          { proposal: 'P1', ...review },
          {
            proposal: 'P2',
            ...review,
            findings: [
              {
                type: 'duplicate',
                detail: 'x',
                claim_refs: [],
                catalog_ref: 'K4',
              },
            ],
          },
        ],
      },
      p,
      skepticCtx,
    ).ok,
    false,
    'catalog refs must exist',
  );
});

const view = (
  tasks: CoordinatorTask[],
  over: Partial<DiscoveryView> = {},
): DiscoveryView => ({
  state: 'running',
  control: 'run',
  limits,
  perspectives: ['software', 'existing_tool', 'process_change'],
  deadline_at: new Date(Date.now() + 60_000).toISOString(),
  steps: 0,
  tasks,
  now: new Date(),
  max_revisions: 1,
  sufficient: true,
  ...over,
});
const task = (
  kind: CoordinatorTask['kind'],
  ordinal: number,
  state: CoordinatorTask['state'] = 'succeeded',
  over: Partial<CoordinatorTask> = {},
): CoordinatorTask => ({
  id: randomUUID(),
  kind,
  ordinal,
  round: 0,
  repair: 0,
  state,
  reason: state,
  ...over,
});
const delegated = (plan: ReturnType<typeof coordinateDiscovery>) =>
  plan.actions.flatMap((a) =>
    a.type === 'delegate' ? [`${a.kind}:${a.ordinal}:${a.round}`] : [],
  );

test('the coordinator runs locator, independent proposals, skeptic and bounded revision in order', () => {
  assert.deepEqual(delegated(coordinateDiscovery(view([]))), ['locate:0:0']);
  const locate = task('locate', 0);
  const first = coordinateDiscovery(view([locate]));
  assert.deepEqual(delegated(first), [
    'propose:0:0',
    'propose:1:0',
    'propose:2:0',
  ]);
  for (const a of first.actions)
    if (a.type === 'delegate') assert.deepEqual(a.inputs, [locate.id]);
  // Concurrency bounds parallel proposals.
  assert.equal(
    delegated(
      coordinateDiscovery(
        view([locate], { limits: { ...limits, max_concurrency: 2 } }),
      ),
    ).length,
    2,
  );
  // Insufficient evidence ends the run after the locator.
  const stop = coordinateDiscovery(view([locate], { sufficient: false }));
  assert.equal(stop.terminal?.outcome, 'insufficient_evidence');
  assert.equal(stop.actions.length, 0);

  const proposals = [0, 1, 2].map((i) => task('propose', i));
  const sk = coordinateDiscovery(view([locate, ...proposals]));
  assert.deepEqual(delegated(sk), ['skeptic:0:0']);
  const skInputs =
    sk.actions[0]!.type === 'delegate' ? sk.actions[0]!.inputs : [];
  assert.deepEqual(
    skInputs,
    proposals.map((p) => p.id),
  );

  const skeptic = task('skeptic', 0, 'succeeded', {
    output: {
      summary: 's',
      reviews: [
        { proposal: 'P1', verdict: 'revise', findings: [], cheaper_test: null },
        { proposal: 'P2', verdict: 'stands', findings: [], cheaper_test: null },
        { proposal: 'P3', verdict: 'reject', findings: [], cheaper_test: null },
      ],
    },
  });
  const rev = coordinateDiscovery(view([locate, ...proposals, skeptic]));
  assert.deepEqual(delegated(rev), ['revise:0:1']);
  // With no revisions allowed, the run ends and keeps the objection as dissent.
  const capped = coordinateDiscovery(
    view([locate, ...proposals, skeptic], { max_revisions: 0 }),
  );
  assert.equal(capped.terminal?.outcome, 'succeeded');
  assert.match(capped.terminal!.explanation, /revision limit \(0\)/);
  // Not enough calls left for a revision round: stop rather than overspend.
  const broke = coordinateDiscovery(
    view([locate, ...proposals, skeptic], {
      limits: { ...limits, max_calls: 6 },
    }),
  );
  assert.match(broke.terminal!.explanation, /call budget/);

  const revised = task('revise', 0, 'succeeded', { round: 1 });
  const second = coordinateDiscovery(
    view([locate, ...proposals, skeptic, revised]),
  );
  assert.deepEqual(delegated(second), ['skeptic:0:1']);
  const secondInputs =
    second.actions[0]!.type === 'delegate' ? second.actions[0]!.inputs : [];
  assert.deepEqual(secondInputs, [
    revised.id,
    proposals[1]!.id,
    proposals[2]!.id,
  ]);
  const done = coordinateDiscovery(
    view([
      locate,
      ...proposals,
      skeptic,
      revised,
      task('skeptic', 0, 'succeeded', {
        round: 1,
        output: {
          summary: 's',
          reviews: [
            {
              proposal: 'P1',
              verdict: 'revise',
              findings: [],
              cheaper_test: null,
            },
          ],
        },
      }),
    ]),
  );
  assert.equal(
    done.terminal?.outcome,
    'succeeded',
    'the revision cap of 1 is reached',
  );
});

test('independence problems are reported when a first proposal could read another answer', () => {
  const p = packet([claim('C1', ['problem'], 'supported')]);
  const hash = canonicalHash(p);
  const locate = {
    ...task('locate', 0),
    context: ctx({ packet_hash: hash }),
    context_hash: 'e'.repeat(64),
    output_hash: 'f'.repeat(64),
    output: fixture('locate', p, ctx()),
  };
  const designer = (i: number, inputs: DiscoveryTaskContext['inputs']) => {
    const c = ctx({
      packet_hash: hash,
      perspective: 'software',
      proposal: `P${i + 1}`,
      inputs,
    });
    return {
      ...task('propose', i),
      context: c,
      context_hash: canonicalHash(c),
      output_hash: 'a'.repeat(64),
      output: fixture('propose', p, c),
    } as DispositionTask;
  };
  const fromLocator = [
    {
      task_id: locate.id,
      output_hash: locate.output_hash,
      kind: 'locate' as const,
      label: 'locator',
    },
  ];
  const leaky = designer(1, [
    ...fromLocator,
    {
      task_id: randomUUID(),
      output_hash: 'a'.repeat(64),
      kind: 'propose',
      label: 'P1 software',
    },
  ]);
  const result = disposeDiscovery({
    packet: p,
    packet_hash: hash,
    perspectives: ['software', 'existing_tool'],
    excluded: [],
    tasks: [locate as DispositionTask, designer(0, fromLocator), leaky],
    stopped_insufficient: false,
  });
  assert.equal(result.independence.verified, false);
  assert.match(
    result.independence.problems.join(' '),
    /P2 could read a propose output/,
  );
  // Without a skeptic pass nothing becomes a candidate.
  assert.ok(result.proposals.every((x) => x.disposition !== 'candidate'));
});

test('live run 2026-11-14: a large catalog gets only the room the brief and claims leave, and what is left out is counted', () => {
  const evidence = [1, 2].map((n) => ({
    claim: {
      claim: {
        id: randomUUID(),
        version: 1,
        title: `Claim ${n}`,
        statement:
          `Practice staff spend hours on prior authorization ${n}. `.repeat(20),
        basis: 'observation' as const,
      },
      status: 'supported' as const,
      labels: [],
      explanation: '',
      independent_origins: 1,
      contrary_origins: 0,
      max_age_days: 180,
      rows: [],
    },
    bears_on: ['problem' as const],
  }));
  // 40 records with full-length summaries, as in a workspace that has been used for a while.
  const catalog = Array.from({ length: 40 }, (_, i) => ({
    id: randomUUID(),
    kind: 'alternative' as const,
    version: 1,
    title: `Recorded option ${i + 1} for a problem the studio already has`,
    summary: 'A rationale that fills the summary to its cap. '
      .repeat(9)
      .slice(0, 400),
  }));
  const p = buildPacket({
    brief: {
      id: randomUUID(),
      version: 1,
      content_hash: 'a'.repeat(64),
      title: 'Prior authorization',
      body: brief,
    },
    evidence,
    catalog,
    max_age_days: 180,
    now: new Date('2026-11-14T00:00:00Z'),
  });
  assert.ok(JSON.stringify(p).length <= MAX_PACKET_CHARS);
  assert.equal(p.claims.length, 2, 'every claim is kept');
  assert.ok(p.catalog.length > 0 && p.catalog.length < 40);
  assert.equal(p.catalog_beyond_limit, 40 - p.catalog.length);
  // Newest first, refs numbered as kept, and the packet still passes its contract.
  assert.equal(p.catalog[0]!.id, catalog[0]!.id);
  assert.deepEqual(
    p.catalog.map((c) => c.ref),
    p.catalog.map((_, i) => `K${i + 1}`),
  );
  EvidencePacketSchema.parse(p);
  // A small catalog fits whole and says nothing about leaving entries out.
  const small = buildPacket({
    brief: p.brief,
    evidence,
    catalog: catalog.slice(0, 3),
    max_age_days: 180,
    now: new Date('2026-11-14T00:00:00Z'),
  });
  assert.equal(small.catalog.length, 3);
  assert.equal('catalog_beyond_limit' in small, false);
});
