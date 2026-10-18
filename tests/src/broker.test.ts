import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import {
  ContractError,
  type AutonomyMode,
  type BrokerCallRequest,
  type ErrorCode,
  type MeteredAction,
} from '@creator/contracts';
import { BudgetStore, type CommandContext } from '@creator/db';
import {
  FixtureAdapter,
  ModelBroker,
  usage,
  type AdapterOutcome,
  type AdapterRequest,
  type ModelAdapter,
} from '@creator/broker';
import { freshDatabase } from './pg-harness.js';

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const agent: CommandContext = { actorId: randomUUID() };
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();
const fixturePricing = JSON.parse(
  readFileSync(
    new URL('../../config/pricing/fixture-model-v1.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;
// "hello" → 5 bytes + 32 + 64 = 101 input tokens at the highest input rate (12 500), plus
// 100 output tokens at 50 000: the maximum exposure the broker must reserve.
const EXPOSURE = 101n * 12_500n + 100n * 50_000n;
const ACTUAL = 3n * 10_000n + 24n * 50_000n; // fixture usage: ceil(5/4)+8 input, 24 output

/** Test double: counts calls; the script decides each outcome. */
class ScriptedAdapter implements ModelAdapter {
  readonly provider = 'fixture' as const;
  readonly model_id = 'fixture-model-v1';
  readonly live = false;
  calls = 0;
  constructor(
    private readonly script: (
      req: AdapterRequest,
      signal: AbortSignal,
      n: number,
    ) => Promise<AdapterOutcome>,
  ) {}
  call(req: AdapterRequest, signal: AbortSignal) {
    this.calls += 1;
    return this.script(req, signal, this.calls);
  }
}
const completed = (input = 3, output = 24, text = 'ok'): AdapterOutcome => ({
  kind: 'completed',
  response_id: `resp-${randomUUID()}`,
  text,
  vector: null,
  usage: usage(input, output, {}),
  incomplete_reason: null,
});

async function setup(
  t: test.TestContext,
  adapter: ModelAdapter = new FixtureAdapter(),
  opts: { lateWindowMs?: number } = {},
) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new BudgetStore(db.pool, opts);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  await store.ensureActor({
    id: agent.actorId,
    kind: 'agent',
    display_name: 'Agent',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Budget',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, agent.actorId, 'editor');
  const pricing = await store.createPricing(owner, ws.id, fixturePricing);
  const broker = new ModelBroker(
    store,
    { fixture: adapter, live: null },
    {
      retryCapMs: 20,
      ...(opts.lateWindowMs === undefined
        ? {}
        : { lateWindowMs: opts.lateWindowMs }),
    },
  );
  async function run(mode: AutonomyMode = 'human_in_loop', grants = true) {
    const condition =
      mode === 'human_only'
        ? 'human_only'
        : mode === 'autonomous_within_scope'
          ? 'autonomous'
          : 'human_in_loop';
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: `${mode} run`,
      body: {
        state: 'queued',
        experiment_condition: condition,
        discovery_method:
          mode === 'human_only' ? 'human_defined' : 'structured',
        config_hash: null,
      },
    });
    const control = await store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: mode,
      stage_gates: null,
      initial_grants: [],
    });
    if (grants && mode !== 'autonomous_within_scope')
      await store.createStandingGrant(owner, ws.id, {
        run_id: control.run_id,
        action_types: [
          'model.generate',
          'model.summarize',
          'model.embed',
          'tool.search_public',
        ],
        target_kind: null,
        max_amount_nano_usd: '100000000',
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['synthetic'],
        expires_at: inHours(24),
        rationale: 'Routine fixture model calls for this run.',
      });
    return control.run_id;
  }
  const envelope = (cap: bigint, extra: Record<string, unknown> = {}) =>
    store.createEnvelope(owner, ws.id, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Owner budget',
      cap_nano_usd: String(cap),
      starts_at: null,
      ends_at: null,
      max_in_flight: 32,
      ...extra,
    });
  const request = (
    envelopeId: string,
    over: Partial<BrokerCallRequest> = {},
  ): BrokerCallRequest => ({
    envelope_id: envelopeId,
    action_type: 'model.generate' as MeteredAction,
    task_id: null,
    logical_operation_id: randomUUID(),
    pricing_snapshot_id: pricing.id,
    data_class: 'synthetic',
    input: [{ role: 'user', text: 'hello' }],
    max_output_tokens: 100,
    output_format: 'text',
    tool: null,
    max_attempts: 1,
    timeout_ms: 5000,
    justification: 'Test call.',
    ...over,
  });
  async function balanced(envelopeId: string) {
    const e = await store.getEnvelope(owner, ws.id, envelopeId);
    const j = await store.journalBalances(ws.id, envelopeId);
    assert.deepEqual(
      {
        allocated: e.allocated,
        reserved: e.reserved,
        unknown: e.unknown,
        incurred: e.incurred,
      },
      j,
      'journal re-derives the envelope balances',
    );
    return e;
  }
  return { db, store, broker, ws, pricing, run, envelope, request, balanced };
}

test('concurrent reservations cannot overspend an envelope', async (t) => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const adapter = new ScriptedAdapter(async () => {
    await gate;
    return completed();
  });
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  // Room for exactly three maximum exposures.
  const env = await s.envelope(EXPOSURE * 3n + EXPOSURE / 2n);
  let decided = 0;
  const calls = Array.from({ length: 8 }, () =>
    s.broker.call(owner, s.ws.id, runId, s.request(env.id)).then((result) => {
      decided += 1;
      return result;
    }),
  );
  // Let every reservation decide before any call finishes.
  // A fixed sleep can release the gate while a queued admission is still waiting
  // on a database lock, legitimately allowing it to spend newly released funds.
  t.after(open);
  const deadline = Date.now() + 4500;
  while (decided < 5 && Date.now() < deadline) await sleep(20);
  assert.equal(
    decided,
    5,
    'all five over-cap admissions finish before settlement',
  );
  const during = await s.balanced(env.id);
  assert.equal(during.reserved, String(EXPOSURE * 3n));
  assert.equal(during.in_flight, 3);
  open();
  const results = await Promise.all(calls);
  assert.equal(adapter.calls, 3, 'only reserved calls reached the provider');
  assert.equal(results.filter((r) => r.status === 'succeeded').length, 3);
  const denied = results.filter((r) => r.status === 'denied');
  assert.equal(denied.length, 5);
  assert.ok(denied.every((r) => r.reason_code === 'budget_exceeded'));
  const after = await s.balanced(env.id);
  assert.equal(after.reserved, '0');
  assert.equal(after.incurred, String(ACTUAL * 3n));
  assert.ok(BigInt(after.incurred) <= BigInt(after.cap));
  // The database refuses an overspend even if application code were bypassed.
  await assert.rejects(
    s.db.pool.query(
      'update budget_envelopes set reserved_nano = cap_nano where id = $1',
      [env.id],
    ),
  );
});

test('concurrent parent calls and child carve-outs cannot both take the last budget (S07)', async (t) => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const adapter = new ScriptedAdapter(async () => {
    await gate;
    return completed();
  });
  const s = await setup(t, adapter);
  if (!s) return;
  t.after(open);
  const runId = await s.run();
  // Room for exactly two maximum exposures, contested by parent calls and child envelopes.
  const parent = await s.envelope(EXPOSURE * 2n + EXPOSURE / 2n);
  let decided = 0;
  const calls = Array.from({ length: 4 }, () =>
    s.broker
      .call(owner, s.ws.id, runId, s.request(parent.id))
      .then((r) => ((decided += 1), r)),
  );
  const carve = Array.from({ length: 4 }, (_, i) =>
    s.store
      .createEnvelope(owner, s.ws.id, {
        parent_id: parent.id,
        kind: 'run',
        run_id: runId,
        name: `Child ${i}`,
        cap_nano_usd: String(EXPOSURE),
        starts_at: null,
        ends_at: null,
        max_in_flight: 1,
      })
      .then(
        () => ((decided += 1), true),
        (e: unknown) => {
          decided += 1;
          assert.ok(e instanceof ContractError && e.code === 'BUDGET_EXCEEDED');
          return false;
        },
      ),
  );
  const deadline = Date.now() + 4500;
  while (decided < 6 && Date.now() < deadline) await sleep(20);
  const during = await s.balanced(parent.id);
  assert.ok(
    BigInt(during.allocated) + BigInt(during.reserved) <= BigInt(during.cap),
    'allocation plus reservation never exceeds the cap',
  );
  open();
  const results = await Promise.all(calls);
  const created = (await Promise.all(carve)).filter(Boolean).length;
  const reserved = results.filter((r) => r.status === 'succeeded').length;
  assert.equal(
    reserved + created,
    2,
    'exactly the authority that existed was used',
  );
  assert.equal(adapter.calls, reserved);
  assert.ok(
    results
      .filter((r) => r.status === 'denied')
      .every((r) => r.reason_code === 'budget_exceeded'),
  );
});

test('in-flight limit bounds concurrency independently of money', async (t) => {
  let open!: () => void;
  const gate = new Promise<void>((resolve) => (open = resolve));
  const adapter = new ScriptedAdapter(async () => {
    await gate;
    return completed();
  });
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  const env = await s.envelope(EXPOSURE * 100n, { max_in_flight: 2 });
  let decided = 0;
  const calls = Array.from({ length: 4 }, () =>
    s.broker.call(owner, s.ws.id, runId, s.request(env.id)).then((result) => {
      decided += 1;
      return result;
    }),
  );
  t.after(open);
  const deadline = Date.now() + 4500;
  while (decided < 2 && Date.now() < deadline) await sleep(20);
  assert.equal(
    decided,
    2,
    'both concurrent over-limit admissions finish before settlement',
  );
  assert.equal((await s.balanced(env.id)).in_flight, 2);
  open();
  const results = await Promise.all(calls);
  assert.equal(adapter.calls, 2);
  assert.equal(
    results.filter((r) => r.reason_code === 'concurrency_limit').length,
    2,
  );
});

test('a denied call never reaches the provider', async (t) => {
  const adapter = new FixtureAdapter();
  const s = await setup(t, adapter);
  if (!s) return;
  const hil = await s.run();
  const other = await s.run();
  const humanOnly = await s.run('human_only', false);
  const autonomous = await s.run('autonomous_within_scope');
  const ungranted = await s.run('human_in_loop', false);
  const cancelled = await s.run();
  await s.store.cancelRun(owner, s.ws.id, cancelled, {
    reason: 'Stopped by owner.',
  });
  const env = await s.envelope(EXPOSURE * 10n);
  const tiny = await s.envelope(EXPOSURE - 1n);
  const otherRunEnv = await s.store.createEnvelope(owner, s.ws.id, {
    parent_id: env.id,
    kind: 'run',
    run_id: other,
    name: 'Other run',
    cap_nano_usd: String(EXPOSURE * 2n),
    starts_at: null,
    ends_at: null,
    max_in_flight: 3,
  });
  const expired = await s.store.createEnvelope(owner, s.ws.id, {
    parent_id: env.id,
    kind: 'period',
    run_id: null,
    name: 'Last month',
    cap_nano_usd: String(EXPOSURE * 2n),
    starts_at: new Date(Date.now() - 60 * 86_400_000).toISOString(),
    ends_at: new Date(Date.now() - 30 * 86_400_000).toISOString(),
    max_in_flight: 3,
  });
  const cases: [string, string, BrokerCallRequest][] = [
    ['human_only', humanOnly, s.request(env.id)],
    ['cancelled', cancelled, s.request(env.id)],
    [
      'pricing_missing',
      hil,
      s.request(env.id, { pricing_snapshot_id: randomUUID() }),
    ],
    [
      'unpriced tool',
      hil,
      s.request(env.id, {
        action_type: 'tool.search_public',
        tool: 'paid_scraper',
      }),
    ],
    ['budget_exceeded', hil, s.request(tiny.id)],
    ['envelope_scope', hil, s.request(otherRunEnv.id)],
    ['outside_period', hil, s.request(expired.id)],
    ['autonomous without grant', autonomous, s.request(env.id)],
    ['no grant (asks a person)', ungranted, s.request(env.id)],
    ['limit_exceeded', hil, s.request(env.id, { max_output_tokens: 9000 })],
  ];
  const outcomes: Record<string, string> = {};
  for (const [label, run, req] of cases) {
    const r = await s.broker.call(owner, s.ws.id, run, req);
    assert.ok(
      ['denied', 'needs_human'].includes(r.status),
      `${label}: ${r.status}`,
    );
    assert.equal(r.attempts[0]?.reserved, '0');
    outcomes[label] = `${r.status}:${r.reason_code}`;
  }
  assert.equal(adapter.calls, 0, JSON.stringify(outcomes));
  assert.equal(outcomes.pricing_missing, 'denied:pricing_missing');
  assert.equal(outcomes['unpriced tool'], 'denied:pricing_missing');
  assert.equal(outcomes.budget_exceeded, 'denied:budget_exceeded');
  assert.equal(outcomes.envelope_scope, 'denied:envelope_scope');
  assert.equal(outcomes.outside_period, 'denied:outside_period');
  assert.equal(outcomes.limit_exceeded, 'denied:limit_exceeded');
  assert.match(outcomes.human_only!, /^denied:/);
  assert.match(outcomes.cancelled!, /^denied:/);
  // A person is asked for the exact amount; the autonomous run cannot ask and defers.
  const asked = await s.broker.call(
    owner,
    s.ws.id,
    ungranted,
    s.request(env.id),
  );
  assert.equal(asked.status, 'needs_human');
  assert.ok(asked.decision_id);
  const decision = await s.store.getDecision(owner, s.ws.id, asked.decision_id);
  assert.equal(decision.kind, 'authorization');
  assert.equal(decision.binding?.amount_nano_usd, String(EXPOSURE));
  assert.match(outcomes['autonomous without grant']!, /^needs_human:/);
  const e = await s.balanced(env.id);
  assert.equal(e.reserved, '0');
  assert.equal(e.incurred, '0');
  // A real workspace with no live adapter is denied, never served by the fixture.
  const real = await s.store.createWorkspace(owner, {
    name: 'Real',
    record_mode: 'real',
  });
  const r = await s.store.createEntity(owner, real.id, {
    kind: 'run',
    title: 'Real run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  await s.store.registerRun(owner, real.id, {
    run: { id: r.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
  });
  await rejects(
    'SCOPE_EXCEEDED',
    s.store.createPricing(owner, real.id, fixturePricing),
  );
  const realEnv = await s.store.createEnvelope(owner, real.id, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Real budget',
    cap_nano_usd: '1000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 1,
  });
  const live = await s.broker.call(owner, real.id, r.id, s.request(realEnv.id));
  assert.equal(live.reason_code, 'live_provider_not_configured');
  assert.equal(adapter.calls, 0);
});

test('late results reconcile without duplicate charge; replays never re-dispatch', async (t) => {
  const adapter = new ScriptedAdapter(async () => {
    await sleep(400);
    return completed(3, 24, 'late answer');
  });
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  const env = await s.envelope(EXPOSURE * 4n);
  const req = s.request(env.id, { timeout_ms: 100 });
  const first = await s.broker.call(owner, s.ws.id, runId, req);
  assert.equal(first.status, 'unknown');
  assert.equal(first.reason_code, 'timeout');
  let e = await s.balanced(env.id);
  assert.equal(
    e.unknown,
    String(EXPOSURE),
    'exposure held while the outcome is unknown',
  );
  assert.equal(e.available, String(EXPOSURE * 3n));
  await s.broker.idle();
  e = await s.balanced(env.id);
  assert.equal(e.unknown, '0');
  assert.equal(e.incurred, String(ACTUAL));
  const [settled] = await s.store.listReservations(owner, s.ws.id, {
    operationId: req.logical_operation_id,
  });
  assert.equal(settled?.status, 'settled');
  assert.equal(settled?.usage_source, 'fixture');
  assert.equal(settled?.reason_code, 'settled_late');
  // The same late result delivered again changes nothing.
  const again = await s.store.finishAttempt(owner, settled!.id, {
    kind: 'settle',
    usage: usage(3, 24, {}),
    source: 'late_provider_response',
    providerResponseId: settled!.provider_response_id,
    result: { status: 'succeeded' },
  });
  assert.equal(again.changed, false);
  const { rows } = await s.db.pool.query(
    'select count(*)::int as n from usage_records where reservation_id = $1',
    [settled!.id],
  );
  assert.equal(rows[0].n, 1);
  // Duplicate delivery of the request returns the stored outcome without a second call.
  const replay = await s.broker.call(owner, s.ws.id, runId, req);
  assert.equal(replay.replayed, true);
  assert.equal(replay.status, 'succeeded');
  assert.equal(replay.output?.text, 'late answer');
  assert.equal(adapter.calls, 1);
  e = await s.balanced(env.id);
  assert.equal(e.incurred, String(ACTUAL));
  // Reusing the operation id for a different request is refused.
  await rejects(
    'IDEMPOTENCY_CONFLICT',
    s.broker.call(owner, s.ws.id, runId, { ...req, max_output_tokens: 50 }),
  );
});

test(
  'concurrent duplicate deliveries dispatch once',
  { timeout: 20000 },
  async (t) => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    t.after(() => release());
    const adapter = new ScriptedAdapter(async () => {
      await held;
      return completed();
    });
    const s = await setup(t, adapter);
    if (!s) return;
    const runId = await s.run();
    const env = await s.envelope(EXPOSURE * 10n);
    const req = s.request(env.id);
    let duplicates = 0;
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        s.broker.call(owner, s.ws.id, runId, req).then((result) => {
          if (result.replayed && ++duplicates === 3) release();
          return result;
        }),
      ),
    );
    assert.equal(adapter.calls, 1);
    assert.equal(results.filter((r) => !r.replayed).length, 1);
    assert.ok(
      results.filter((r) => r.replayed).every((r) => r.status === 'in_flight'),
    );
    const e = await s.balanced(env.id);
    assert.equal(e.incurred, String(ACTUAL));
  },
);

test('rate limits release and retry; malformed output is charged; unknown outcomes need owner reconciliation', async (t) => {
  const plan: AdapterOutcome[] = [
    {
      kind: 'rejected',
      reason_code: 'rate_limited',
      retry_after_ms: 5,
      message: 'Slow down.',
    },
    completed(3, 24, 'second try'),
    completed(3, 24, 'not json'),
    {
      kind: 'unknown',
      reason_code: 'provider_error',
      message: 'Provider error 502.',
    },
    { kind: 'unknown', reason_code: 'network_error', message: 'Reset.' },
  ];
  const adapter = new ScriptedAdapter(async (_r, _s, n) => plan[n - 1]!);
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  const env = await s.envelope(EXPOSURE * 10n);
  const retried = await s.broker.call(
    owner,
    s.ws.id,
    runId,
    s.request(env.id, { max_attempts: 2 }),
  );
  assert.equal(retried.status, 'succeeded');
  assert.deepEqual(
    retried.attempts.map((a) => [a.status, a.incurred]),
    [
      ['released', null],
      ['settled', String(ACTUAL)],
    ],
  );
  const malformed = await s.broker.call(
    owner,
    s.ws.id,
    runId,
    s.request(env.id, { output_format: 'json' }),
  );
  assert.equal(malformed.status, 'failed');
  assert.equal(malformed.reason_code, 'malformed_output');
  assert.equal(
    malformed.attempts[0]?.incurred,
    String(ACTUAL),
    'a malformed answer still costs',
  );
  const lost = await s.broker.call(owner, s.ws.id, runId, s.request(env.id));
  assert.equal(lost.status, 'unknown');
  const reset = await s.broker.call(owner, s.ws.id, runId, s.request(env.id));
  let e = await s.balanced(env.id);
  assert.equal(e.unknown, String(EXPOSURE * 2n));
  // Only the owner reconciles, and only once.
  await rejects(
    'ACCESS_DENIED',
    s.store.reconcile(agent, s.ws.id, lost.attempts[0]!.id, {
      outcome: 'no_charge',
      evidence: 'x',
    }),
  );
  await s.store.reconcile(owner, s.ws.id, lost.attempts[0]!.id, {
    outcome: 'no_charge',
    evidence: 'Provider usage page shows no request at that time.',
  });
  const charged = await s.store.reconcile(
    owner,
    s.ws.id,
    reset.attempts[0]!.id,
    {
      outcome: 'charged',
      usage: usage(50, 10, {}),
      provider_response_id: null,
      evidence: 'Provider usage export row for the request.',
    },
  );
  assert.equal(charged.status, 'settled');
  assert.equal(charged.usage_source, 'owner_reconciliation');
  await rejects(
    'INVALID_TRANSITION',
    s.store.reconcile(owner, s.ws.id, reset.attempts[0]!.id, {
      outcome: 'no_charge',
      evidence: 'again',
    }),
  );
  e = await s.balanced(env.id);
  assert.equal(e.unknown, '0');
  assert.equal(e.incurred, String(ACTUAL * 2n + 50n * 10_000n + 10n * 50_000n));
  assert.equal(adapter.calls, 5);
});

test('cancellation stops new calls and keeps in-flight exposure held', async (t) => {
  const adapter = new ScriptedAdapter(
    (_r, signal) =>
      new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(new Error('aborted')));
      }),
  );
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  const env = await s.envelope(EXPOSURE * 4n);
  const pending = s.broker.call(owner, s.ws.id, runId, s.request(env.id));
  await sleep(200);
  await s.store.cancelRun(owner, s.ws.id, runId, { reason: 'Owner stop.' });
  assert.equal(s.broker.cancelRun(runId), 1);
  const r = await pending;
  assert.equal(r.status, 'cancelled');
  assert.equal(r.attempts[0]?.status, 'unknown');
  const after = await s.broker.call(owner, s.ws.id, runId, s.request(env.id));
  assert.equal(after.status, 'denied');
  assert.equal(adapter.calls, 1);
  const e = await s.balanced(env.id);
  assert.equal(
    e.unknown,
    String(EXPOSURE),
    'a cancelled call may still have been charged',
  );
});

test('a lost worker leaves exposure unknown, not released', async (t) => {
  const s = await setup(t, new FixtureAdapter(), { lateWindowMs: 0 });
  if (!s) return;
  const runId = await s.run();
  const env = await s.envelope(EXPOSURE * 2n);
  // A reservation whose dispatcher crashed before reporting.
  const req = s.request(env.id, { timeout_ms: 100 });
  const prep = await s.store.prepareAttempt(owner, s.ws.id, runId, req, {
    provider: 'fixture',
    model_id: 'fixture-model-v1',
    adapterAvailable: true,
    requestHash: 'a'.repeat(64),
    attempt: 1,
    timeoutMs: 100,
  });
  assert.equal(prep.kind, 'reserved');
  await sleep(200);
  assert.equal(await s.store.sweepStale(owner), 1);
  const e = await s.balanced(env.id);
  assert.equal(e.reserved, '0');
  assert.equal(e.unknown, String(EXPOSURE));
});

test('child envelopes conserve authority; rollups do not double count; overrun blocks', async (t) => {
  const adapter = new ScriptedAdapter(async (_r, _s, n) =>
    // The second answer reports more usage than the bound: the charge is recorded honestly.
    n === 2 ? completed(200_000, 0) : completed(),
  );
  const s = await setup(t, adapter);
  if (!s) return;
  const runId = await s.run();
  const root = await s.envelope(EXPOSURE * 10n);
  const period = await s.store.createEnvelope(owner, s.ws.id, {
    parent_id: root.id,
    kind: 'period',
    run_id: null,
    name: 'October',
    cap_nano_usd: String(EXPOSURE * 6n),
    starts_at: new Date(Date.now() - 86_400_000).toISOString(),
    ends_at: inHours(24 * 30),
    max_in_flight: 3,
  });
  const runEnv = await s.store.createEnvelope(owner, s.ws.id, {
    parent_id: period.id,
    kind: 'run',
    run_id: runId,
    name: 'Run',
    cap_nano_usd: String(EXPOSURE * 4n),
    starts_at: null,
    ends_at: null,
    max_in_flight: 3,
  });
  await rejects(
    'BUDGET_EXCEEDED',
    s.store.createEnvelope(owner, s.ws.id, {
      parent_id: period.id,
      kind: 'run',
      run_id: runId,
      name: 'Too much',
      cap_nano_usd: String(EXPOSURE * 3n),
      starts_at: null,
      ends_at: null,
      max_in_flight: 1,
    }),
  );
  await rejects(
    'ACCESS_DENIED',
    s.store.createEnvelope(agent, s.ws.id, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'Self-funded',
      cap_nano_usd: '1',
      starts_at: null,
      ends_at: null,
      max_in_flight: 1,
    }),
  );
  const ok = await s.broker.call(owner, s.ws.id, runId, s.request(runEnv.id));
  assert.equal(ok.status, 'succeeded');
  const rootView = await s.balanced(root.id);
  assert.equal(
    rootView.incurred,
    '0',
    'child spending is not counted on the parent',
  );
  assert.equal(rootView.rollup_incurred, String(ACTUAL));
  assert.equal(rootView.allocated, String(EXPOSURE * 6n));
  // Closing a normal child returns only its unspent remainder.
  const spare = await s.store.createEnvelope(owner, s.ws.id, {
    parent_id: period.id,
    kind: 'run',
    run_id: runId,
    name: 'Spare',
    cap_nano_usd: String(EXPOSURE),
    starts_at: null,
    ends_at: null,
    max_in_flight: 1,
  });
  const before = await s.store.getEnvelope(owner, s.ws.id, period.id);
  const closed = await s.store.closeEnvelope(owner, s.ws.id, spare.id, {
    expected_version: spare.version,
    reason: 'Unused.',
  });
  assert.equal(closed.status, 'closed');
  const afterClose = await s.balanced(period.id);
  assert.equal(
    BigInt(before.allocated) - BigInt(afterClose.allocated),
    EXPOSURE,
  );
  // A sibling under the same period, funded before anything goes wrong.
  const sibling = await s.store.createEnvelope(owner, s.ws.id, {
    parent_id: period.id,
    kind: 'run',
    run_id: runId,
    name: 'Sibling',
    cap_nano_usd: String(EXPOSURE),
    starts_at: null,
    ends_at: null,
    max_in_flight: 1,
  });
  // Overrun: the provider charged more than the bound. Recorded truthfully, then blocked.
  const over = await s.broker.call(owner, s.ws.id, runId, s.request(runEnv.id));
  assert.equal(over.status, 'succeeded');
  const r = await s.balanced(runEnv.id);
  assert.equal(r.status, 'overrun');
  const blocked = await s.broker.call(
    owner,
    s.ws.id,
    runId,
    s.request(runEnv.id),
  );
  assert.equal(blocked.reason_code, 'envelope_inactive');
  assert.equal(adapter.calls, 2);
  // The excess also counts against every ancestor: the period and the root are now past their
  // caps, so the sibling cannot spend and nothing new can be carved out (audit 2026-10-18 #4).
  const siblingCall = await s.broker.call(
    owner,
    s.ws.id,
    runId,
    s.request(sibling.id),
  );
  assert.equal(siblingCall.reason_code, 'ancestor_overrun');
  for (const parentId of [period.id, root.id])
    await rejects(
      'BUDGET_EXCEEDED',
      s.store.createEnvelope(owner, s.ws.id, {
        parent_id: parentId,
        kind: 'run',
        run_id: runId,
        name: 'After overrun',
        cap_nano_usd: '1',
        starts_at: null,
        ends_at: null,
        max_in_flight: 1,
      }),
    );
  assert.equal(adapter.calls, 2);
  assert.ok(BigInt(r.incurred) > BigInt(r.cap));
});
