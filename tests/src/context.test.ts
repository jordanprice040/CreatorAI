import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  ContractError,
  type ContextCallRequest,
  type ErrorCode,
} from '@creator/contracts';
import { ContextStore, type CommandContext } from '@creator/db';
import {
  ContextService,
  FixtureAdapter,
  FixtureBatchAdapter,
  ModelBroker,
  fixtureContextAdapters,
} from '@creator/broker';
import { capabilitiesRequestFromConfig } from '@creator/domain';
import { freshDatabase } from './pg-harness.js';

const root = new URL('../../', import.meta.url);
const read = (p: string) =>
  JSON.parse(readFileSync(new URL(p, root), 'utf8')) as unknown;
const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const agent: CommandContext = { actorId: randomUUID() };
const CTX = { provider: 'fixture' as const, model_id: 'fixture-context-v1' };
const LOSSY = { provider: 'fixture' as const, model_id: 'fixture-lossy-v1' };

// A small synthetic research corpus. The pinned notes are long enough for the simulated
// provider prompt cache (it ignores prefixes under 256 tokens, as providers do).
const pad = (s: string) =>
  `${s} ${'This standing rule applies to every task in the project and to every reviewer of its outputs. '.repeat(14)}`.trim();
const NOTES = [
  {
    key: 'constraints.md',
    locator: 'notes/constraints.md',
    text: pad('Never store participant names in the analysis tables.'),
  },
  {
    key: 'acceptance.md',
    locator: 'notes/acceptance.md',
    text: pad(
      'A report is accepted only when every figure cites its source record.',
    ),
  },
  {
    key: 'objection.md',
    locator: 'notes/objection.md',
    text: pad(
      'Reviewer objection: the sample is too small to generalise beyond the pilot.',
    ),
  },
  {
    key: 'pricing.md',
    locator: 'notes/pricing.md',
    text: 'The pilot price is 40 dollars per month. Customers in the pilot asked for annual billing. The office plants were watered on Tuesday. Someone brought cake for the birthday on Friday. The car park was resurfaced over the long weekend. A new coffee machine arrived in the kitchen.',
  },
  {
    key: 'retention.md',
    locator: 'notes/retention.md',
    text: 'Retention after ninety days was 62 percent in the pilot cohort. Churn reasons were mostly onboarding friction during the pilot.',
  },
  ...Array.from({ length: 6 }, (_, i) => ({
    key: `misc-${i + 1}.md`,
    locator: null,
    text: `Unrelated meeting minutes ${i + 1}: the team discussed parking spaces and lunch options at length.`,
  })),
];
const PINS = [
  { corpus: 'notes', key: 'constraints.md', pin: 'constraint' as const },
  {
    corpus: 'notes',
    key: 'acceptance.md',
    pin: 'acceptance_criterion' as const,
  },
  { corpus: 'notes', key: 'objection.md', pin: 'objection' as const },
];
const FACTS = ['62 percent', '40 dollars per month'];

async function setup(t: test.TestContext, batch = new FixtureBatchAdapter()) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ContextStore(db.pool);
  for (const [a, kind] of [
    [owner, 'human'],
    [agent, 'agent'],
  ] as const)
    await store.ensureActor({ id: a.actorId, kind, display_name: kind });
  const adapters = fixtureContextAdapters();
  const broker = new ModelBroker(store, {
    fixture: new FixtureAdapter(),
    live: null,
    routes: adapters,
  });
  const service = new ContextService(store, broker, [batch]);
  async function workspace(mode: 'fixture' | 'real' = 'fixture') {
    const ws = await store.createWorkspace(owner, {
      name: `Context ${mode}`,
      record_mode: mode,
    });
    await store.addMember(owner, ws.id, agent.actorId, 'editor');
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: 'Context run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    const control = await store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    });
    const grant = await store.createStandingGrant(owner, ws.id, {
      run_id: control.run_id,
      action_types: ['model.generate', 'model.summarize'],
      target_kind: null,
      max_amount_nano_usd: '1000000000',
      allow_irreversible: false,
      allow_external_effects: false,
      data_classes: ['synthetic'],
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      rationale: 'Routine fixture model calls for context checks.',
    });
    const envelope = await store.createEnvelope(owner, ws.id, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Context budget',
      cap_nano_usd: '100000000000',
      starts_at: null,
      ends_at: null,
      max_in_flight: 32,
    });
    let pricing: Record<string, string> = {};
    let registry = null;
    if (mode === 'fixture') {
      registry = await store.registerCapabilities(
        owner,
        ws.id,
        capabilitiesRequestFromConfig(
          read('config/context/provider-capabilities.fixture.json'),
          read,
        ),
      );
      for (const f of ['fixture-context-v1', 'fixture-lossy-v1'])
        pricing[f] = (
          await store.createPricing(
            owner,
            ws.id,
            read(`config/pricing/${f}.json`),
          )
        ).id;
      pricing.batch = Object.values(registry.batch_pricing_snapshot_ids)[0]!;
    } else {
      registry = await store.registerCapabilities(
        owner,
        ws.id,
        capabilitiesRequestFromConfig(
          read('config/context/provider-capabilities.json'),
          read,
        ),
      );
      pricing = {
        'gpt-6-astra': (
          await store.createPricing(
            owner,
            ws.id,
            read('config/pricing/openai-gpt-6-astra.json'),
          )
        ).id,
        batch: Object.values(registry.batch_pricing_snapshot_ids)[0]!,
      };
    }
    return {
      ws: ws.id,
      run: control.run_id,
      envelope: envelope.id,
      grant,
      pricing,
      registry,
    };
  }
  return { store, broker, service, adapters, batch, workspace };
}

type W = Awaited<
  ReturnType<NonNullable<Awaited<ReturnType<typeof setup>>>['workspace']>
>;
const packRequest = (w: W, extra: Record<string, unknown> = {}) => ({
  run_id: w.run,
  task_id: null,
  project_id: null,
  task_class: 'research_synthesis',
  data_class: 'synthetic',
  purpose: 'Summarise the pilot evidence for the decision memo.',
  query: ['pilot', 'retention', 'price'],
  token_budget: 4000,
  corpora: ['notes'],
  include: [],
  pins: PINS,
  required_facts: FACTS,
  handoffs: [],
  ...extra,
});
const callRequest = (
  w: W,
  packId: string | null,
  extra: Partial<ContextCallRequest> = {},
): ContextCallRequest => ({
  run_id: w.run,
  envelope_id: w.envelope,
  pricing_snapshot_id: w.pricing['fixture-context-v1']!,
  model: CTX,
  pack_id: packId,
  project_id: null,
  action_type: 'model.generate',
  task_id: null,
  logical_operation_id: randomUUID(),
  data_class: 'synthetic',
  messages: [
    {
      role: 'user',
      text: 'context-qa/1: QUESTION: What was retention after ninety days?',
    },
  ],
  max_output_tokens: 200,
  output_format: 'text',
  tool: null,
  max_attempts: 1,
  timeout_ms: 5000,
  justification: 'Answer a question from the pilot notes.',
  cache: { mode: 'use', max_age_seconds: 3600, deps: [] },
  ...extra,
});

test('X02 index: incremental counts, explicit removals, and record reuse', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store } = s;
  const w = await s.workspace();
  const first = await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: NOTES,
    complete: true,
  });
  assert.deepEqual(
    [first.added, first.updated, first.unchanged, first.removed, first.current],
    [NOTES.length, 0, 0, 0, NOTES.length],
  );
  const again = await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: NOTES,
    complete: true,
  });
  assert.equal(
    again.unchanged,
    NOTES.length,
    'unchanged content is not rewritten',
  );
  const changed = await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: [{ ...NOTES[4]!, text: `${NOTES[4]!.text} Updated.` }],
    complete: false,
    removed_keys: ['misc-6.md'],
  });
  assert.deepEqual(
    [changed.updated, changed.removed, changed.current],
    [1, 1, NOTES.length - 1],
  );
  const entries = await store.listIndex(agent, w.ws, 'notes');
  assert.equal(entries.find((e) => e.key === 'retention.md')?.version, 2);
  assert.equal(entries.find((e) => e.key === 'misc-6.md')?.status, 'removed');
  await rejects(
    'INVALID_CONTRACT',
    store.indexItems(agent, w.ws, {
      corpus: 'notes',
      kind: 'note',
      data_class: 'synthetic',
      items: [NOTES[0]],
      complete: false,
      removed_keys: [NOTES[0]!.key],
    }),
  );
  // Workspace records: indexing twice reuses the earlier research instead of redoing it.
  await store
    .createEntity(owner, w.ws, {
      kind: 'problem',
      title: 'Pilot onboarding friction',
      body: {
        statement: 'New pilot users stall during onboarding.',
        evidence_ids: [],
      },
    })
    .catch(() => undefined);
  const r1 = await store.indexRecords(agent, w.ws, {
    corpus: 'records',
    data_class: 'synthetic',
    kinds: ['problem', 'claim'],
  });
  const r2 = await store.indexRecords(agent, w.ws, {
    corpus: 'records',
    data_class: 'synthetic',
    kinds: ['problem', 'claim'],
  });
  assert.equal(r2.added + r2.updated, 0);
  assert.equal(r2.unchanged, r1.added);
});

test('X02 packs: pins and authority survive compaction; lossy and opaque compaction refused', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, service } = s;
  const w = await s.workspace();
  await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: NOTES,
    complete: true,
  });
  const pack = await store.buildPack(agent, w.ws, packRequest(w));
  assert.equal(pack.items[0]?.origin, 'authority', 'authority renders first');
  assert.match(pack.items[0]!.text, /model\.generate/);
  for (const p of PINS)
    assert.equal(pack.items.find((i) => i.key === p.key)?.pin, p.pin);
  assert.ok(
    pack.excluded.some(
      (e) => e.key === 'misc-1.md' && e.reason === 'not_relevant',
    ),
  );
  // Agents cannot pin authority, and a missing required fact refuses the pack.
  await rejects(
    'INVALID_CONTRACT',
    store.buildPack(
      agent,
      w.ws,
      packRequest(w, {
        pins: [{ corpus: 'notes', key: 'pricing.md', pin: 'authority' }],
      }),
    ),
  );
  await rejects(
    'MISSING_EVIDENCE',
    store.buildPack(
      agent,
      w.ws,
      packRequest(w, { required_facts: ['a fact nobody wrote'] }),
    ),
  );
  await rejects(
    'LIMIT_EXCEEDED',
    store.buildPack(agent, w.ws, packRequest(w, { token_budget: 64 })),
  );

  // Extractive compaction: deterministic, no call; pins, authority and facts all survive.
  const ex = await store.compactPack(agent, w.ws, pack.id, {
    method: 'extractive',
    token_budget: pack.tokens - 30,
  });
  assert.equal(ex.compaction.status, 'accepted', ex.compaction.explanation);
  assert.ok(ex.pack && ex.pack.tokens < pack.tokens);
  for (const p of PINS)
    assert.ok(ex.pack!.items.some((i) => i.key === p.key && i.pin === p.pin));
  assert.ok(ex.pack!.items.some((i) => i.origin === 'authority'));
  const exText = ex.pack!.items.map((i) => i.text).join('\n');
  for (const f of FACTS) assert.ok(exText.includes(f), f);
  assert.ok(!exText.includes('plants'), 'irrelevant sentences are dropped');

  // Model compaction: one metered call, then the same survival check.
  const model = await service.compactWithModel(agent, w.ws, pack.id, {
    method: 'model',
    token_budget: 2000,
    model: CTX,
    envelope_id: w.envelope,
    pricing_snapshot_id: w.pricing['fixture-context-v1'],
    logical_operation_id: randomUUID(),
    timeout_ms: 5000,
  });
  assert.equal(model.broker.status, 'succeeded');
  assert.equal(
    model.compaction.status,
    'accepted',
    model.compaction.explanation,
  );
  assert.ok(model.compaction.operation_id);
  assert.equal(model.pack!.compacted_from, pack.id);
  for (const p of PINS)
    assert.ok(
      model.pack!.items.some((i) => i.key === p.key && i.pin === p.pin),
    );

  // A lossy summary is recorded as rejected, naming what was lost; no pack is produced.
  const lossy = await service.compactWithModel(agent, w.ws, pack.id, {
    method: 'model',
    token_budget: 2000,
    model: LOSSY,
    envelope_id: w.envelope,
    pricing_snapshot_id: w.pricing['fixture-lossy-v1'],
    logical_operation_id: randomUUID(),
    timeout_ms: 5000,
  });
  assert.equal(
    lossy.broker.status,
    'succeeded',
    'the call itself succeeded and was charged',
  );
  assert.equal(lossy.compaction.status, 'rejected');
  assert.deepEqual(
    [...lossy.compaction.missing_facts].sort(),
    [...FACTS].sort(),
  );
  assert.equal(lossy.pack, null);

  // The store will not record a compaction from a call that was not made for this pack.
  await rejects(
    'MISSING_EVIDENCE',
    store.recordModelCompaction(agent, w.ws, pack.id, {
      method: 'model',
      token_budget: 2000,
      model: CTX,
      envelope_id: w.envelope,
      pricing_snapshot_id: w.pricing['fixture-context-v1'],
      logical_operation_id: randomUUID(),
      timeout_ms: 5000,
    }),
  );

  // Provider compaction: unsupported here; and opaque output is refused even when usable.
  const unsupported = await store.compactPack(agent, w.ws, pack.id, {
    method: 'provider',
    token_budget: 2000,
    model: CTX,
  });
  assert.equal(unsupported.compaction.reason_code, 'capability_unsupported');
  const caps = read('config/context/provider-capabilities.fixture.json') as {
    capabilities: {
      feature: string;
      state: string;
      output_opaque: boolean;
      evidence: string;
    }[];
    capabilities_version: string;
  };
  const opaque = caps.capabilities.find(
    (c) => c.feature === 'provider_compaction',
  )!;
  opaque.state = 'fixture';
  opaque.output_opaque = true;
  opaque.evidence =
    'Simulated opaque provider compaction for the refusal check.';
  caps.capabilities_version = 'fixture-context/opaque';
  await store.registerCapabilities(
    owner,
    w.ws,
    capabilitiesRequestFromConfig(caps, read),
  );
  const refused = await store.compactPack(agent, w.ws, pack.id, {
    method: 'provider',
    token_budget: 2000,
    model: CTX,
  });
  assert.equal(refused.compaction.status, 'refused');
  assert.equal(refused.compaction.reason_code, 'output_unverifiable');

  // Handoffs: reusable while their sources are current, excluded once one changes.
  await rejects(
    'MISSING_EVIDENCE',
    store.createHandoff(agent, w.ws, {
      pack_id: pack.id,
      summary: 'Pilot went fine.',
      from_task_id: null,
    }),
  );
  const handoff = await store.createHandoff(agent, w.ws, {
    pack_id: pack.id,
    summary:
      'Pilot: retention was 62 percent after ninety days; price 40 dollars per month.',
    from_task_id: null,
  });
  assert.deepEqual(
    handoff.pins.map((p) => p.pin).sort(),
    PINS.map((p) => p.pin).sort(),
  );
  const reuse = await store.buildPack(
    agent,
    w.ws,
    packRequest(w, {
      corpora: [],
      pins: [],
      required_facts: FACTS,
      handoffs: [handoff.id],
    }),
  );
  assert.ok(
    reuse.items.some(
      (i) => i.origin === 'handoff' && i.handoff_id === handoff.id,
    ),
  );
  // A source edit that keeps the facts: the summary is no longer trusted, the facts still hold.
  await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: [
      {
        ...NOTES[3]!,
        text: 'The pilot price is 40 dollars per month, billed monthly.',
      },
    ],
    complete: false,
  });
  const stale = await store.buildPack(
    agent,
    w.ws,
    packRequest(w, { required_facts: [], handoffs: [handoff.id] }),
  );
  assert.ok(stale.excluded.some((e) => e.reason === 'handoff_stale'));
  assert.deepEqual(
    [...stale.required_facts].sort(),
    [...FACTS].sort(),
    'carried facts stay required',
  );
  assert.ok(!stale.items.some((i) => i.origin === 'handoff'));
  // A source edit that contradicts a carried fact refuses the pack instead of hiding it.
  await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: [{ ...NOTES[3]!, text: 'The pilot price is 45 dollars per month.' }],
    complete: false,
  });
  await rejects(
    'MISSING_EVIDENCE',
    store.buildPack(
      agent,
      w.ws,
      packRequest(w, { required_facts: [], handoffs: [handoff.id] }),
    ),
  );
});

test('X02 result cache: hits re-admit, dependencies and grants invalidate, scope isolates', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, service, adapters } = s;
  const ctxModel = adapters[0]!;
  const w = await s.workspace();
  await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: NOTES,
    complete: true,
  });
  const pack = await store.buildPack(agent, w.ws, packRequest(w));
  const miss = await service.contextCall(agent, w.ws, callRequest(w, pack.id));
  assert.equal(miss.status, 'succeeded', miss.explanation);
  assert.equal(miss.cache, 'miss');
  assert.match(miss.output!.text, /62 percent/);
  const calls = ctxModel.calls;
  const hit = await service.contextCall(agent, w.ws, callRequest(w, pack.id));
  assert.equal(hit.cache, 'hit');
  assert.equal(hit.status, 'succeeded');
  assert.equal(hit.output!.text, miss.output!.text);
  assert.equal(hit.source_operation_id, miss.broker!.logical_operation_id);
  assert.ok(hit.admission_id, 'a hit passes admission like any action');
  assert.equal(ctxModel.calls, calls, 'no provider call for a hit');

  // Cache mode off still calls (and meters) the model; the prompt prefix is now cached.
  const off = await service.contextCall(
    agent,
    w.ws,
    callRequest(w, pack.id, {
      cache: { mode: 'off', max_age_seconds: 60, deps: [] },
    }),
  );
  assert.equal(off.cache, 'off');
  assert.ok(off.broker!.attempts[0]!.reserved);

  // External mutations are not cacheable actions at all.
  await rejects(
    'INVALID_CONTRACT',
    service.contextCall(
      agent,
      w.ws,
      callRequest(w, pack.id, { action_type: 'external.message' as never }),
    ),
  );

  // Another workspace never sees this entry.
  const other = await s.workspace();
  await store.indexItems(agent, other.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: NOTES,
    complete: true,
  });
  const otherPack = await store.buildPack(agent, other.ws, packRequest(other));
  const iso = await service.contextCall(
    agent,
    other.ws,
    callRequest(other, otherPack.id),
  );
  assert.equal(iso.cache, 'miss');

  // A changed source invalidates the entry for everyone; the answer is recomputed.
  await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: [
      {
        ...NOTES[4]!,
        text: 'Retention after ninety days was 64 percent in the pilot cohort.',
      },
    ],
    complete: false,
  });
  const afterChange = await service.contextCall(
    agent,
    w.ws,
    callRequest(w, pack.id),
  );
  assert.equal(
    afterChange.cache,
    'not_stored',
    'an answer on a stale pack is not stored',
  );
  assert.match(
    afterChange.cache_note ?? '',
    /changed after the pack was built|stale|source/,
  );
  const [entry] = (await store.listCache(agent, w.ws)).filter(
    (e) => e.id === miss.cache_entry_id,
  );
  assert.equal(entry?.status, 'invalidated');
  assert.match(entry?.invalidated_reason ?? '', /changed|dependency/);

  // Fresh pack, fresh entry; then revoking the grant refuses the hit (no stored permission).
  const fresh = await store.buildPack(
    agent,
    w.ws,
    packRequest(w, { required_facts: ['64 percent'] }),
  );
  const stored = await service.contextCall(
    agent,
    w.ws,
    callRequest(w, fresh.id),
  );
  assert.equal(stored.cache, 'miss');
  await store.revokeGrant(owner, w.ws, w.grant.id, {
    expected_version: w.grant.version,
    reason: 'Stop model use for this run.',
  });
  const before = ctxModel.calls;
  const refused = await service.contextCall(
    agent,
    w.ws,
    callRequest(w, fresh.id),
  );
  assert.equal(refused.cache, 'hit');
  assert.notEqual(refused.status, 'succeeded');
  assert.equal(refused.output, null);
  assert.equal(ctxModel.calls, before);

  // Usage: fixture simulation, traceable to reservations and source operations; no claim.
  const usage = await store.contextUsage(owner, w.ws, w.run);
  assert.equal(usage.provider_prompt_cache.basis, 'fixture_simulation');
  assert.ok(usage.provider_prompt_cache.cached_input_tokens > 0);
  assert.ok(usage.provider_prompt_cache.reservation_ids.length >= 3);
  assert.equal(usage.result_cache.hits, 1);
  assert.equal(usage.result_cache.refused_hits, 1);
  assert.deepEqual(usage.result_cache.source_operation_ids, [
    miss.broker!.logical_operation_id,
  ]);
  assert.ok(BigInt(usage.result_cache.avoided.incurred_nano) > 0n);
  assert.equal(usage.savings_claim, 'not_claimed_fixture');
});

test('X02 batches: capability and price checks, partial failure, unknown then late settlement', async (t) => {
  const batch = new FixtureBatchAdapter('fixture-context-v1', {
    failIds: ['b'],
    holdBack: ['c'],
  });
  const s = await setup(t, batch);
  if (!s) return;
  const { store, service } = s;
  const w = await s.workspace();
  const item = (custom_id: string) => ({
    custom_id,
    logical_operation_id: randomUUID(),
    task_id: null,
    input: [
      {
        role: 'user' as const,
        text: `Summarise note ${custom_id} for the pilot memo.`,
      },
    ],
    max_output_tokens: 50,
    output_format: 'text' as const,
  });
  const request = (extra: Record<string, unknown> = {}) => ({
    batch_operation_id: randomUUID(),
    run_id: w.run,
    envelope_id: w.envelope,
    model: CTX,
    pricing_snapshot_id: w.pricing.batch,
    action_type: 'model.generate',
    data_class: 'synthetic',
    items: ['a', 'b', 'c', 'd'].map(item),
    justification: 'Noninteractive summaries for the pilot memo.',
    ...extra,
  });
  const wrongPrice = await service.submitBatch(
    agent,
    w.ws,
    request({ pricing_snapshot_id: w.pricing['fixture-context-v1'] }),
  );
  assert.equal(wrongPrice.status, 'refused');
  assert.equal(wrongPrice.reason_code, 'batch_pricing_mismatch');
  const noCap = await service.submitBatch(
    agent,
    w.ws,
    request({
      model: LOSSY,
      pricing_snapshot_id: w.pricing['fixture-lossy-v1'],
    }),
  );
  assert.equal(noCap.reason_code, 'capability_missing');
  assert.ok(
    noCap.items.every((i) => i.reservation_id === null),
    'a refused batch reserves nothing',
  );

  const req = request();
  const submitted = await service.submitBatch(agent, w.ws, req);
  assert.equal(submitted.status, 'submitted', submitted.explanation);
  assert.ok(submitted.items.every((i) => i.status === 'in_flight'));
  const replay = await service.submitBatch(agent, w.ws, req);
  assert.equal(
    replay.id,
    submitted.id,
    'a repeated batch operation returns the recorded batch',
  );
  await rejects(
    'IDEMPOTENCY_CONFLICT',
    service.submitBatch(agent, w.ws, {
      ...req,
      justification: 'Different request, same id.',
    }),
  );

  const first = await service.pollBatch(agent, w.ws, submitted.id);
  const by = (b: typeof first, id: string) =>
    b.items.find((i) => i.custom_id === id)!;
  assert.equal(by(first, 'a').status, 'settled');
  assert.equal(
    by(first, 'b').status,
    'released',
    'a per-item provider error is not charged',
  );
  assert.equal(
    by(first, 'c').status,
    'unknown',
    'a missing result is held, not zero',
  );
  assert.equal(first.status, 'unknown');
  const second = await service.pollBatch(agent, w.ws, submitted.id);
  assert.equal(by(second, 'c').status, 'settled');
  assert.equal(by(second, 'c').late, true);
  assert.equal(second.status, 'partial');
  const third = await service.pollBatch(agent, w.ws, submitted.id);
  assert.deepEqual(
    third.items.map((i) => i.incurred_nano),
    second.items.map((i) => i.incurred_nano),
    'a repeated result is never charged twice',
  );

  // Batch items are charged at the batch price: half the synchronous fixture rate.
  const sync = await service.contextCall(
    agent,
    w.ws,
    callRequest(w, null, {
      messages: item('a').input,
      max_output_tokens: 50,
      cache: { mode: 'off', max_age_seconds: 60, deps: [] },
    }),
  );
  const syncCost = BigInt(sync.broker!.attempts[0]!.incurred!);
  assert.equal(BigInt(by(second, 'a').incurred_nano!) * 2n, syncCost);

  const usage = await store.contextUsage(owner, w.ws, w.run);
  assert.equal(usage.batches.items, 12);
  assert.equal(usage.batches.late_settled, 1);
  assert.equal(usage.batches.released, 1);
  assert.equal(usage.batches.settled, 3);
});

test('X02 batches: expiry releases, a real workspace refuses unverified capabilities', async (t) => {
  const batch = new FixtureBatchAdapter('fixture-context-v1', {
    expireIds: ['x'],
  });
  const s = await setup(t, batch);
  if (!s) return;
  const { service, store } = s;
  const w = await s.workspace();
  const items = ['x', 'y'].map((custom_id) => ({
    custom_id,
    logical_operation_id: randomUUID(),
    task_id: null,
    input: [{ role: 'user' as const, text: `Item ${custom_id}.` }],
    max_output_tokens: 20,
    output_format: 'text' as const,
  }));
  const b = await service.submitBatch(agent, w.ws, {
    batch_operation_id: randomUUID(),
    run_id: w.run,
    envelope_id: w.envelope,
    model: CTX,
    pricing_snapshot_id: w.pricing.batch,
    action_type: 'model.generate',
    data_class: 'synthetic',
    items,
    justification: 'Expiry check.',
  });
  const polled = await service.pollBatch(agent, w.ws, b.id);
  assert.equal(
    polled.items.find((i) => i.custom_id === 'x')!.reason_code,
    'batch_expired',
  );
  assert.equal(
    polled.items.find((i) => i.custom_id === 'x')!.status,
    'released',
  );
  assert.equal(polled.status, 'partial');

  const real = await s.workspace('real');
  const refused = await service.submitBatch(agent, real.ws, {
    batch_operation_id: randomUUID(),
    run_id: real.run,
    envelope_id: real.envelope,
    model: { provider: 'openai', model_id: 'gpt-6-astra' },
    pricing_snapshot_id: real.pricing.batch,
    action_type: 'model.generate',
    data_class: 'synthetic',
    items,
    justification: 'Documented capability is not verified.',
  });
  assert.equal(refused.status, 'refused');
  assert.equal(refused.reason_code, 'capability_unverified');
  await rejects(
    'SCOPE_EXCEEDED',
    store.registerCapabilities(
      owner,
      real.ws,
      capabilitiesRequestFromConfig(
        read('config/context/provider-capabilities.fixture.json'),
        read,
      ),
    ),
  );
});

test('X02 evaluation: quality maintained for the compacted pack, a starved pack fails', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, service } = s;
  const w = await s.workspace();
  await store.indexItems(agent, w.ws, {
    corpus: 'notes',
    kind: 'note',
    data_class: 'synthetic',
    items: NOTES,
    complete: true,
  });
  const baseline = await store.buildPack(agent, w.ws, packRequest(w));
  const compacted = await service.compactWithModel(agent, w.ws, baseline.id, {
    method: 'model',
    token_budget: 2000,
    model: CTX,
    envelope_id: w.envelope,
    pricing_snapshot_id: w.pricing['fixture-context-v1'],
    logical_operation_id: randomUUID(),
    timeout_ms: 5000,
  });
  assert.equal(
    compacted.compaction.status,
    'accepted',
    compacted.compaction.reason_code + ': ' + compacted.compaction.explanation,
  );
  const starved = await store.buildPack(
    agent,
    w.ws,
    packRequest(w, {
      query: ['parking'],
      pins: [],
      required_facts: [],
      token_budget: 200,
    }),
  );
  const cases = [
    {
      case_id: 'retention',
      question: 'What was retention after ninety days in the pilot?',
      check: { kind: 'contains_all', phrases: ['62 percent'] },
    },
    {
      case_id: 'price',
      question: 'What is the pilot price per month?',
      check: { kind: 'contains_all', phrases: ['40 dollars'] },
    },
  ];
  const evaluate = async (candidate: string) => {
    const ev = await store.createContextEvaluation(owner, w.ws, {
      run_id: w.run,
      envelope_id: w.envelope,
      baseline_pack_id: baseline.id,
      candidate_pack_id: candidate,
      model: CTX,
      pricing_snapshot_id: w.pricing['fixture-context-v1'],
      cases,
      max_regression: { numerator: 0, denominator: 1 },
      max_output_tokens: 200,
      timeout_ms: 5000,
      rationale:
        'Does the context change keep answers correct at lower total cost?',
    });
    return service.runContextEvaluation(owner, w.ws, ev.id);
  };
  const good = await evaluate(compacted.pack!.id);
  assert.equal(good.state, 'evaluated');
  assert.equal(good.baseline!.accepted, 2);
  assert.equal(good.candidate!.accepted, 2);
  assert.equal(good.quality_maintained, true, good.reasons.join('; '));
  assert.ok(
    BigInt(good.candidate!.overhead.incurred_nano) > 0n,
    'compaction cost counted',
  );
  assert.equal(
    BigInt(good.candidate!.total.incurred_nano),
    BigInt(good.candidate!.calls.incurred_nano) +
      BigInt(good.candidate!.overhead.incurred_nano),
  );
  assert.equal(good.savings_claim, 'not_claimed_fixture');
  const bad = await evaluate(starved.id);
  assert.equal(bad.quality_maintained, false);
  assert.equal(bad.savings_claim, 'not_claimed_quality_drop');
  const rerun = await service.runContextEvaluation(owner, w.ws, good.id);
  assert.deepEqual(rerun, good, 'an evaluated comparison is not re-run');
  const usage = await store.contextUsage(owner, w.ws, w.run);
  assert.equal(usage.evaluations.evaluated, 2);
  assert.equal(usage.evaluations.quality_maintained, 1);
  assert.equal(usage.compaction.accepted, 1);
  assert.equal(usage.compaction.operation_ids.length, 1);
});
