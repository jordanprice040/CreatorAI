import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PoolClient } from 'pg';
import {
  ContractError,
  type AuditAnswer,
  type ErrorCode,
  type ModelRef,
} from '@creator/contracts';
import { SearchStore, type CommandContext } from '@creator/db';
import {
  FixtureAdapter,
  ModelBroker,
  SearchService,
  fixtureSearchAdapters,
  usage,
  type ModelAdapter,
} from '@creator/broker';
import { freshDatabase } from './pg-harness.js';

const root = new URL('../../', import.meta.url);
const read = (p: string) =>
  JSON.parse(readFileSync(new URL(p, root), 'utf8')) as Record<string, unknown>;
const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
    code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const editor: CommandContext = { actorId: randomUUID() };
const viewer: CommandContext = { actorId: randomUUID() };
const outsider: CommandContext = { actorId: randomUUID() };
const EMBED: ModelRef = { provider: 'fixture', model_id: 'fixture-embed-v1' };
const GEN: ModelRef = { provider: 'fixture', model_id: 'fixture-model-v1' };
const HOSTILE: ModelRef = {
  provider: 'fixture',
  model_id: 'fixture-hostile-v1',
};

/** A simulated compiler model that answers with a plan carrying SQL. */
const hostile: ModelAdapter = {
  provider: 'fixture',
  model_id: HOSTILE.model_id,
  live: false,
  call: () =>
    Promise.resolve({
      kind: 'completed',
      response_id: 'fixture-hostile',
      text: JSON.stringify({
        version: 'audit-plan/1',
        limit: 50,
        intent: 'redactions',
        window: { from: null, to: null, tz: 'UTC' },
        sql: "update entities set title = 'pwned'",
      }),
      vector: null,
      usage: usage(40, 40, {}),
      incomplete_reason: null,
    }),
};

/** Exposes the read-only transaction so the test can show a write is refused inside it. */
class ProbeStore extends SearchStore {
  probe(ctx: CommandContext, ws: string, sql: string) {
    return this.readOnly(ctx, ws, (c: PoolClient) => c.query(sql));
  }
}

const genRequest = (env: string, pricing: string, text: string) => ({
  envelope_id: env,
  action_type: 'model.generate',
  task_id: null,
  logical_operation_id: randomUUID(),
  pricing_snapshot_id: pricing,
  data_class: 'synthetic',
  input: [{ role: 'user', text }],
  max_output_tokens: 64,
  output_format: 'text',
  tool: null,
  max_attempts: 1,
  timeout_ms: 5000,
  justification: 'Synthetic X03 cost record.',
});

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ProbeStore(db.pool);
  for (const [a, kind] of [
    [owner, 'human'],
    [editor, 'human'],
    [viewer, 'human'],
    [outsider, 'human'],
  ] as const)
    await store.ensureActor({ id: a.actorId, kind, display_name: kind });
  const broker = new ModelBroker(store, {
    fixture: new FixtureAdapter(),
    live: null,
    routes: [...fixtureSearchAdapters(), hostile],
  });
  const service = new SearchService(
    store,
    broker,
    read('config/search/semantic-models.json'),
  );
  return { db, store, broker, service };
}

test('X03 acceptance: source-to-product and cost-to-run answers, shared costs once, injection, revocation and redaction', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { db, store, broker, service } = s;
  const ws = (
    await store.createWorkspace(owner, {
      name: 'X03 fixture',
      record_mode: 'fixture',
    })
  ).id;
  await store.addMember(owner, ws, editor.actorId, 'editor');
  await store.addMember(owner, ws, viewer.actorId, 'viewer');
  const u = 'Synthetic fixture; no research performed.';
  const make = (kind: string, title: string, body: unknown) =>
    store.createEntity(owner, ws, { kind, title, body });
  const link = (
    relation: string,
    from: { id: string; version: number },
    to: { id: string; version: number },
  ) =>
    store.createLink(owner, ws, {
      relation,
      from: { id: from.id, version: from.version },
      to: { id: to.id, version: to.version },
      rationale: 'Synthetic X03 lineage',
    });
  const sourceBody = (url: string) => ({
    url,
    retrieval_status: 'inaccessible',
    content_hash: null,
    retrieved_at: new Date().toISOString(),
    published_at: null,
    independent_origin: 'example.org (fixture)',
    observation: 'Fixture placeholder; not retrieved.',
    uncertainty: u,
  });
  const report = await make(
    'source',
    'Volunteer coverage report',
    sourceBody('https://example.org/report'),
  );
  const survey = await make(
    'source',
    'Confidential shift survey',
    sourceBody('https://example.org/survey'),
  );
  const claim = await make('claim', 'Volunteers miss shifts', {
    statement: 'Volunteers miss shifts when schedules change.',
    basis: 'inference',
    uncertainty: u,
  });
  const problem = await make('problem', 'Shift coverage gaps', {
    statement: 'Shifts go uncovered after schedule changes.',
    affected_group: 'Food bank volunteers (fixture)',
    uncertainty: u,
  });
  const ideaA = await make('idea', 'Shared roster', {
    summary: 'One shared roster.',
    uncertainty: u,
  });
  const ideaB = await make('idea', 'Reminder messages', {
    summary: 'Reminders before shifts.',
    uncertainty: u,
  });
  const combined = await make('product', 'Roster with reminders', {
    stage: 'captured',
    summary: 'Combines both ideas.',
  });
  const paper = await make('product', 'Printable roster kit', {
    stage: 'captured',
    summary: 'Paper roster.',
  });
  const runEntity = (title: string) =>
    make('run', title, {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    });
  const runA = await runEntity('Shared packaging run');
  const runB = await runEntity('Reminder build run');
  await link('supports', report, claim);
  await link('supports', survey, claim);
  await link('supports', claim, problem);
  await link('derived_from', ideaA, problem);
  await link('derived_from', ideaB, problem);
  await link('derived_from', combined, ideaA);
  await link('derived_from', combined, ideaB);
  const paperLink = await link('derived_from', paper, ideaA);
  // Run A serves both products (a shared expense); run B serves only the combined product.
  await link('part_of', runA, combined);
  await link('part_of', runA, paper);
  await link('part_of', runB, combined);

  for (const r of [runA, runB])
    await store.registerRun(owner, ws, {
      run: { id: r.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    });
  for (const r of [runA, runB])
    await store.createStandingGrant(owner, ws, {
      run_id: r.id,
      action_types: ['model.generate', 'model.embed'],
      target_kind: null,
      max_amount_nano_usd: '1000000000000',
      allow_irreversible: false,
      allow_external_effects: false,
      data_classes: ['synthetic'],
      expires_at: new Date(Date.now() + 86_400_000).toISOString(),
      rationale: 'Routine fixture calls for X03 checks.',
    });
  const env = (
    await store.createEnvelope(owner, ws, {
      parent_id: null,
      kind: 'global',
      run_id: null,
      name: 'X03 budget',
      cap_nano_usd: '100000000000000',
      starts_at: null,
      ends_at: null,
      max_in_flight: 32,
    })
  ).id;
  const genPricing = (
    await store.createPricing(
      owner,
      ws,
      read('config/pricing/fixture-model-v1.json'),
    )
  ).id;
  const embedPricing = (
    await store.createPricing(
      owner,
      ws,
      read('config/pricing/fixture-embed-v1.json'),
    )
  ).id;
  const hostilePricing = (
    await store.createPricing(owner, ws, {
      ...read('config/pricing/fixture-model-v1.json'),
      model_id: HOSTILE.model_id,
    })
  ).id;
  for (const [run, text] of [
    [runA, 'Package the printable roster kit.'],
    [runA, 'Write the roster layout.'],
    [runB, 'Draft reminder messages for volunteers.'],
  ] as const) {
    const r = await broker.call(
      owner,
      ws,
      run.id,
      genRequest(env, genPricing, text),
    );
    assert.equal(r.status, 'succeeded', r.explanation);
  }
  await store.drainOutbox();
  const incurred = async (runs: string[]) =>
    BigInt(
      String(
        (
          await db.pool.query(
            `select coalesce(sum(incurred_nano), 0) as n from budget_reservations
              where workspace_id = $1 and run_id = any($2::uuid[]) and status = 'settled'`,
            [ws, runs],
          )
        ).rows[0]?.n,
      ),
    ).toString();
  const costA = await incurred([runA.id]);
  const costB = await incurred([runB.id]);
  assert.notEqual(costA, '0');
  const ask = (ctx: CommandContext, question: string, tz = 'UTC') =>
    service.askQuestion(ctx, ws, { question, tz });
  const ids = (a: AuditAnswer, type: string) =>
    a.supporting.filter((x) => x.type === type).map((x) => x.id);

  // ---- Source to product, both ways, with the supporting records named ----
  const toSources = await ask(
    viewer,
    'Which sources does product "Roster with reminders" come from?',
  );
  assert.equal(toSources.status, 'answered', toSources.explanation);
  assert.equal(toSources.plan?.intent, 'source_to_product');
  assert.deepEqual(toSources.rows.map((r) => r.title).sort(), [
    'Confidential shift survey',
    'Volunteer coverage report',
  ]);
  assert.ok(ids(toSources, 'record').includes(claim.id));
  assert.ok(ids(toSources, 'link').length >= 6);
  assert.equal(toSources.read_only, true);
  const toProducts = await ask(
    viewer,
    `Which products use source ${report.id.slice(0, 8)}?`,
  );
  assert.equal(toProducts.status, 'answered', toProducts.explanation);
  assert.deepEqual(
    toProducts.rows.map((r) => r.id).sort(),
    [combined.id, paper.id].sort(),
  );

  // ---- Cost to run, and shared expenses counted once across many-to-many joins ----
  const runCost = await ask(viewer, `How much did run ${runA.id} cost?`);
  assert.equal(runCost.status, 'answered', runCost.explanation);
  assert.equal(runCost.totals?.incurred_nano, costA);
  assert.equal(runCost.totals?.calls, '2');
  const reservationIds = (
    await db.pool.query(
      'select id from budget_reservations where workspace_id = $1 and run_id = $2 order by id',
      [ws, runA.id],
    )
  ).rows.map((r: { id: string }) => r.id);
  assert.deepEqual(ids(runCost, 'reservation').sort(), reservationIds);
  assert.equal(ids(runCost, 'usage').length, 2);
  const both = await ask(
    viewer,
    'What did products "Roster with reminders" and "Printable roster kit" cost?',
  );
  assert.equal(both.status, 'answered', both.explanation);
  assert.equal(
    both.totals?.incurred_nano,
    (BigInt(costA) + BigInt(costB)).toString(),
  );
  assert.equal(both.totals?.runs, '2');
  assert.equal(both.totals?.shared_runs, '1');
  assert.equal(both.totals?.calls, '3');
  const per = Object.fromEntries(
    both.rows.map((r) => [String(r.subject_id), r]),
  );
  assert.equal(
    per[combined.id]?.incurred_nano,
    (BigInt(costA) + BigInt(costB)).toString(),
  );
  assert.equal(per[paper.id]?.incurred_nano, costA);
  assert.ok(
    both.notes.some((n) => /counts each of their charges once/.test(n)),
  );

  // ---- Lexical search over cost and model records, with coverage and time zones ----
  const costHits = await store.search(viewer, ws, {
    q: runA.id.slice(0, 8),
    types: ['cost'],
    kind: null,
    status: null,
    limit: 10,
    tz: 'America/New_York',
  });
  assert.equal(costHits.hits.length, 2);
  assert.equal(
    costHits.hits
      .reduce((n, h) => n + BigInt(h.amounts?.incurred ?? '0'), 0n)
      .toString(),
    costA,
  );
  assert.match(costHits.hits[0]!.occurred_local, /-0[45]:00$/);
  const models = await store.search(viewer, ws, {
    q: 'fixture-model',
    types: ['model'],
    kind: null,
    status: null,
    limit: 10,
  });
  assert.equal(models.hits.length, 1);
  assert.equal(
    models.hits[0]!.amounts?.incurred,
    (BigInt(costA) + BigInt(costB)).toString(),
  );
  const tomorrow = new Date(Date.now() + 2 * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const later = await store.search(viewer, ws, {
    q: '',
    types: ['record', 'cost', 'activity'],
    kind: null,
    status: null,
    limit: 10,
    from: tomorrow,
    tz: 'Pacific/Kiritimati',
  });
  assert.equal(later.hits.length, 0);
  assert.equal(later.coverage.record?.searchable, 10);

  // ---- Saved queries run with the caller's current access ----
  const saved = await store.saveQuery(editor, ws, {
    name: 'Survey mentions',
    kind: 'search',
    body: {
      q: 'survey',
      types: ['record'],
      kind: null,
      status: null,
      limit: 10,
    },
  });
  const savedQ = await store.saveQuery(editor, ws, {
    name: 'Run A cost',
    kind: 'question',
    body: { question: `How much did run ${runA.id} cost?` },
  });
  await rejects(
    'INVALID_CONTRACT',
    store.saveQuery(editor, ws, {
      name: 'Raw SQL',
      kind: 'question',
      body: { question: 'x', sql: 'drop table entities' },
    }),
  );
  await rejects(
    'ACCESS_DENIED',
    store.saveQuery(viewer, ws, {
      name: 'Viewer',
      kind: 'search',
      body: { q: '', types: ['record'], kind: null, status: null, limit: 5 },
    }),
  );
  const ran = await store.runSavedQuery(viewer, ws, saved.id);
  assert.equal(ran.kind, 'search');
  assert.ok(
    ran.kind === 'search' && ran.result.hits.some((h) => h.id === survey.id),
  );
  const ranQ = await store.runSavedQuery(viewer, ws, savedQ.id);
  assert.ok(
    ranQ.kind === 'question' && ranQ.result.totals?.incurred_nano === costA,
  );

  // ---- Semantic search: metered, ranks only access-safe candidates, replays without paying ----
  const semReq = {
    q: 'shift survey',
    types: ['record'],
    run_id: runA.id,
    envelope_id: env,
    model: EMBED,
    pricing_snapshot_id: embedPricing,
    operation_id: randomUUID(),
    data_class: 'synthetic',
    pool: 12,
    limit: 5,
    justification: 'Rank fixture records for an X03 check.',
  };
  const reservations = async () =>
    Number(
      (
        await db.pool.query(
          'select count(*) as n from budget_reservations where workspace_id = $1',
          [ws],
        )
      ).rows[0]?.n,
    );
  const before = await reservations();
  // Embedding is spending: a viewer may search lexically but cannot start metered calls.
  await rejects(
    'ACCESS_DENIED',
    service.semanticSearch(viewer, ws, {
      ...semReq,
      operation_id: randomUUID(),
    }),
  );
  const sem = await service.semanticSearch(editor, ws, semReq);
  assert.equal(sem.status, 'ranked', sem.explanation);
  assert.equal(sem.fixture, true);
  assert.ok(sem.hits.some((h) => h.id === survey.id));
  assert.equal(sem.metering.calls, sem.pool.candidates + 1);
  assert.notEqual(sem.metering.incurred, '0');
  assert.equal((await reservations()) - before, sem.metering.calls);
  const replay = await service.semanticSearch(editor, ws, semReq);
  assert.equal(replay.metering.replayed, replay.metering.calls);
  assert.equal(await reservations(), before + sem.metering.calls);
  assert.deepEqual(
    replay.hits.map((h) => h.id),
    sem.hits.map((h) => h.id),
  );

  // ---- A model-compiled question: metered, and a plan carrying SQL is refused ----
  const modelAsk = await service.askQuestion(editor, ws, {
    question: `How much did run ${runB.id} cost?`,
    compiler: 'model',
    // Metered under run A, so run B's cost is unchanged by the compile call itself.
    model_call: {
      run_id: runA.id,
      envelope_id: env,
      pricing_snapshot_id: genPricing,
      model: GEN,
      operation_id: randomUUID(),
      data_class: 'synthetic',
    },
  });
  assert.equal(modelAsk.status, 'answered', modelAsk.explanation);
  assert.equal(modelAsk.compile_call?.status, 'succeeded');
  assert.equal(modelAsk.totals?.incurred_nano, costB);
  const entityState = async () =>
    (
      await db.pool.query(
        'select id, version, title, status from entities where workspace_id = $1 order by id',
        [ws],
      )
    ).rows;
  const auditCount = async () =>
    Number(
      (await db.pool.query('select count(*) as n from audit_events')).rows[0]
        ?.n,
    );
  const stateBefore = await entityState();
  const hostileAsk = await service.askQuestion(editor, ws, {
    question: 'What was redacted?',
    compiler: 'model',
    model_call: {
      run_id: runA.id,
      envelope_id: env,
      pricing_snapshot_id: hostilePricing,
      model: HOSTILE,
      operation_id: randomUUID(),
      data_class: 'synthetic',
    },
  });
  assert.equal(hostileAsk.status, 'refused_plan');
  assert.equal(hostileAsk.plan, null);
  assert.equal(hostileAsk.rows.length, 0);
  await store.drainOutbox();
  const eventsBefore = await auditCount();

  // ---- Injected questions and plans cannot mutate ----
  for (const q of [
    `How much did run ${runA.id.slice(0, 8)}'; drop table entities; -- cost?`,
    "Which sources does product \"x'); update entities set title = 'pwned'; --\" come from?",
    'Who changed product "Roster with reminders"; delete from audit_events; --?',
  ]) {
    const a = await ask(editor, q);
    assert.ok(
      ['answered', 'needs_subject'].includes(a.status),
      `${q}: ${a.status}`,
    );
  }
  await rejects(
    'INVALID_CONTRACT',
    store.answerPlan(
      editor,
      ws,
      {
        version: 'audit-plan/1',
        limit: 5,
        intent: 'redactions',
        window: { from: null, to: null, tz: 'UTC' },
        sql: 'delete from entities',
      },
      { question: 'x', compiler: 'rules' },
    ),
  );
  await rejects(
    'INVALID_CONTRACT',
    store.answerPlan(
      editor,
      ws,
      {
        version: 'audit-plan/1',
        limit: 5,
        intent: 'redactions',
        window: { from: null, to: null, tz: "UTC'; drop table entities; --" },
      },
      { question: 'x', compiler: 'rules' },
    ),
  );
  // Even a write that reached the plan transaction would be refused by PostgreSQL.
  await assert.rejects(
    store.probe(owner, ws, "update entities set title = 'pwned'"),
    (e: unknown) => (e as { code?: string }).code === '25006',
  );
  await store.drainOutbox();
  assert.deepEqual(await entityState(), stateBefore);
  // Asking and reading append nothing to the audit chain.
  assert.equal(await auditCount(), eventsBefore);
  assert.equal((await store.verifyAuditChain()).ok, true);

  // ---- Lineage graph, export and integrity checks ----
  const graph = await store.lineageGraph(viewer, ws, combined.id, {
    direction: 'upstream',
  });
  assert.ok(
    graph.nodes.some(
      (n) =>
        n.id === survey.id &&
        n.title === 'Confidential shift survey' &&
        n.media === 'not_retrieved',
    ),
  );
  assert.equal(graph.truncated.depth, false);
  const shallow = await store.lineageGraph(viewer, ws, combined.id, {
    direction: 'upstream',
    depth: 1,
  });
  assert.equal(shallow.truncated.depth, true);
  assert.ok(shallow.nodes.every((n) => n.depth <= 1));
  const capped = await store.lineageGraph(viewer, ws, combined.id, {
    direction: 'both',
    max_nodes: 3,
  });
  assert.equal(capped.nodes.length, 3);
  assert.equal(capped.truncated.nodes, true);
  const exported = await store.exportLineage(viewer, ws, combined.id, {
    direction: 'both',
  });
  assert.deepEqual(
    (await store.verifyLineageExport(viewer, ws, exported)).problems,
    [],
  );
  const tampered = structuredClone(exported);
  tampered.graph.nodes[0]!.title = 'Edited after export';
  assert.deepEqual(
    (await store.verifyLineageExport(viewer, ws, tampered)).problems.map(
      (p) => p.code,
    ),
    ['hash_mismatch'],
  );
  const pexport = await store.exportLineage(viewer, ws, paper.id, {
    direction: 'upstream',
  });
  await store.retractLink(owner, ws, paperLink.id, {
    reason: 'Synthetic retraction for X03',
  });
  assert.ok(
    (await store.verifyLineageExport(viewer, ws, pexport)).problems.some(
      (p) => p.code === 'link_retracted' && p.id === paperLink.id,
    ),
  );

  // ---- Deleted evidence cannot leak through search, questions, lineage or exports ----
  const findSurvey = async () =>
    (
      await store.search(viewer, ws, {
        q: 'confidential survey',
        types: ['record', 'activity'],
        kind: null,
        status: null,
        limit: 20,
      })
    ).hits;
  assert.ok((await findSurvey()).some((h) => h.id === survey.id));
  await store.redactEntity(owner, ws, survey.id, {
    expected_version: 1,
    reason_code: 'privacy',
  });
  await store.drainOutbox();
  const afterHits = await findSurvey();
  assert.ok(!afterHits.some((h) => h.id === survey.id));
  assert.ok(!JSON.stringify(afterHits).includes('Confidential'));
  const cov = await store.search(viewer, ws, {
    q: 'survey',
    types: ['record'],
    kind: null,
    status: null,
    limit: 20,
  });
  assert.equal(cov.coverage.record?.excluded.redacted, 1);
  const sem2 = await service.semanticSearch(editor, ws, {
    ...semReq,
    operation_id: randomUUID(),
  });
  assert.ok(!sem2.hits.some((h) => h.id === survey.id));
  assert.ok(!JSON.stringify(sem2).includes('Confidential'));
  const afterSources = await ask(
    viewer,
    'Which sources does product "Roster with reminders" come from?',
  );
  const tomb = afterSources.rows.find((r) => r.id === survey.id);
  assert.ok(tomb, 'the redacted source stays on the path as a tombstone');
  assert.equal(tomb.title, null);
  assert.equal(tomb.status, 'redacted');
  assert.ok(!JSON.stringify(afterSources).includes('Confidential'));
  const byTitle = await ask(
    viewer,
    'Which products use source "Confidential shift survey"?',
  );
  assert.equal(byTitle.status, 'needs_subject');
  assert.ok(!JSON.stringify(byTitle.candidates).includes(survey.id));
  const redactions = await ask(viewer, 'What was redacted today?');
  assert.deepEqual(
    redactions.rows.map((r) => r.id),
    [survey.id],
  );
  assert.ok(!JSON.stringify(redactions).includes('Confidential'));
  const g2 = await store.lineageGraph(viewer, ws, combined.id, {
    direction: 'upstream',
  });
  assert.equal(g2.nodes.find((n) => n.id === survey.id)?.title, null);
  assert.ok(!JSON.stringify(g2).includes('Confidential'));
  const stale = await store.verifyLineageExport(viewer, ws, exported);
  assert.deepEqual(
    stale.problems
      .filter((p) => p.id === survey.id)
      .map((p) => p.code)
      .sort(),
    ['contains_redacted_text', 'now_redacted', 'version_changed'],
  );
  assert.equal(stale.ok, false);

  // ---- Revoked access: the removed member learns nothing more, through any path ----
  await rejects(
    'ACCESS_DENIED',
    store.removeMember(editor, ws, viewer.actorId, 'Not an owner'),
  );
  await store.removeMember(owner, ws, viewer.actorId, 'Study ended');
  await store.removeMember(owner, ws, editor.actorId, 'Study ended');
  await rejects(
    'INVALID_TRANSITION',
    store.removeMember(owner, ws, owner.actorId, 'Last owner'),
  );
  for (const who of [viewer, editor, outsider]) {
    await rejects(
      'NOT_FOUND',
      store.search(who, ws, {
        q: 'roster',
        types: ['record', 'cost', 'model'],
        kind: null,
        status: null,
        limit: 5,
      }),
    );
    await rejects('NOT_FOUND', ask(who, `How much did run ${runA.id} cost?`));
    await rejects(
      'NOT_FOUND',
      service.semanticSearch(who, ws, {
        ...semReq,
        operation_id: randomUUID(),
      }),
    );
    await rejects('NOT_FOUND', store.runSavedQuery(who, ws, saved.id));
    await rejects('NOT_FOUND', store.listSavedQueries(who, ws));
    await rejects('NOT_FOUND', store.lineageGraph(who, ws, combined.id, {}));
    await rejects('NOT_FOUND', store.exportLineage(who, ws, combined.id, {}));
    await rejects('NOT_FOUND', store.verifyLineageExport(who, ws, exported));
  }
  // The query the removed editor saved still runs for the owner, under the owner's access.
  const ownerRun = await store.runSavedQuery(owner, ws, savedQ.id);
  assert.ok(
    ownerRun.kind === 'question' && ownerRun.result.status === 'answered',
  );
  await store.drainOutbox();
  const history = await store.listHistory(owner, ws, {
    subjectId: viewer.actorId,
  });
  assert.ok(history.some((h) => h.action === 'member.removed'));
  assert.equal((await store.verifyAuditChain()).ok, true);
});

test('X03: real workspaces refuse semantic search without a verified embedding model; questions need a readable subject', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { db, store, service } = s;
  const real = (
    await store.createWorkspace(owner, {
      name: 'X03 real',
      record_mode: 'real',
    })
  ).id;
  const r = await service.semanticSearch(owner, real, {
    q: 'anything',
    run_id: randomUUID(),
    envelope_id: randomUUID(),
    model: EMBED,
    pricing_snapshot_id: randomUUID(),
    operation_id: randomUUID(),
    data_class: 'private_approved',
    justification: 'Should be refused before any call.',
  });
  assert.equal(r.status, 'failed');
  assert.equal(r.reason_code, 'no_verified_embedding_model');
  assert.equal(r.metering.calls, 0);
  assert.equal(
    Number(
      (await db.pool.query('select count(*) as n from budget_reservations'))
        .rows[0]?.n,
    ),
    0,
  );
  const unknown = await service.askQuestion(owner, real, {
    question: 'How much did run 1a2b3c4d cost?',
  });
  assert.equal(unknown.status, 'needs_subject');
  assert.equal(unknown.fixture, false);
  const unsupported = await service.askQuestion(owner, real, {
    question: 'Write me a poem',
  });
  assert.equal(unsupported.status, 'unsupported');
  assert.equal(unsupported.plan, null);
});
