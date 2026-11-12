import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ContractError, type ErrorCode } from '@creator/contracts';
import { canonicalHash } from '@creator/domain';
import {
  Store,
  migrate,
  assertSchemaCurrent,
  databaseUrl,
  type CommandContext,
} from '@creator/db';
import { freshDatabase } from './pg-harness.js';

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const pgRejects = (code: string, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e !== null && typeof e === 'object' && 'code' in e && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const viewer: CommandContext = { actorId: randomUUID() };
const outsider: CommandContext = { actorId: randomUUID() };
async function setup(store: Store) {
  for (const [ctx, name] of [
    [owner, 'Owner'],
    [viewer, 'Viewer'],
    [outsider, 'Outsider'],
  ] as const)
    await store.ensureActor({
      id: ctx.actorId,
      kind: 'human',
      display_name: name,
    });
}
const H = (s: string) => canonicalHash(s);
const bodies = {
  source: {
    url: 'https://example.org/report',
    retrieval_status: 'available',
    content_hash: H('report bytes'),
    retrieved_at: '2026-10-18T00:00:00.000Z',
    published_at: null,
    independent_origin: 'example.org',
    observation: 'Synthetic observation for a storage test.',
    uncertainty: 'Synthetic; not research.',
  },
  claim: {
    statement: 'Volunteers lose track of shifts.',
    basis: 'observation',
    uncertainty: 'One source.',
  },
  problem: {
    statement: 'Shift coverage gaps.',
    affected_group: 'Food bank volunteers',
    uncertainty: 'Unvalidated.',
  },
  idea: { summary: 'A shared roster.', uncertainty: 'Untested.' },
  product: { stage: 'captured', summary: 'Synthetic product record.' },
  run: {
    state: 'queued',
    experiment_condition: 'human_in_loop',
    discovery_method: 'structured',
    config_hash: null,
  },
  task: {
    state: 'queued',
    role: 'builder',
    goal: 'Produce a fixture artifact.',
  },
  artifact: {
    storage_uri: 'fixture://artifacts/roster.zip',
    sha256: H('zip'),
    bytes: 1024,
    media_type: 'application/zip',
  },
};

test('migrations apply once, refuse edited history, and gate an unmigrated schema', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  assert.deepEqual(await migrate(db.pool), []);
  assert.equal(await assertSchemaCurrent(db.pool), 58);
  await db.pool.query(
    `update schema_migrations set checksum = repeat('0', 64) where version = 1`,
  );
  await rejects('INVALID_CONFIG', migrate(db.pool));
  await rejects('INVALID_CONFIG', assertSchemaCurrent(db.pool));
  await db.pool.query('drop table schema_migrations');
  await rejects('STORAGE_UNAVAILABLE', assertSchemaCurrent(db.pool));
  assert.throws(
    () => databaseUrl('postgresql://u:p@db.example.com/x'),
    ContractError,
  );
  assert.equal(databaseUrl(undefined), null);
});

test('many-to-many lineage: one product from two ideas, one idea with two descendants, task to artifact', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new Store(db.pool);
  await setup(store);
  const ws = await store.createWorkspace(owner, {
    name: 'Lineage fixture',
    record_mode: 'fixture',
  });
  const make = async (kind: keyof typeof bodies, title: string) =>
    store.createEntity(owner, ws.id, { kind, title, body: bodies[kind] });
  const link = (
    relation: string,
    from: { id: string; version: number },
    to: { id: string; version: number },
  ) =>
    store.createLink(owner, ws.id, {
      relation,
      from: { id: from.id, version: from.version },
      to: { id: to.id, version: to.version },
      rationale: `${relation} in synthetic lineage test`,
    });
  const source = await make('source', 'Volunteer report');
  const claim = await make('claim', 'Shift tracking claim');
  const problem = await make('problem', 'Coverage gaps');
  const ideaA = await make('idea', 'Shared roster');
  const ideaB = await make('idea', 'Reminder texts');
  const product = await make('product', 'Roster with reminders');
  const sibling = await make('product', 'Paper roster kit');
  const run = await make('run', 'Fixture run');
  const task = await make('task', 'Package roster');
  const artifact = await make('artifact', 'Roster bundle');
  assert.equal(source.fixture, true);
  await link('supports', source, claim);
  await link('supports', claim, problem);
  await link('derived_from', ideaA, problem);
  await link('derived_from', ideaB, problem);
  await link('derived_from', product, ideaA);
  await link('derived_from', product, ideaB);
  await link('derived_from', sibling, ideaA);
  await link('part_of', task, run);
  await link('derived_from', artifact, task);

  const productDetail = await store.getEntity(owner, ws.id, product.id);
  assert.deepEqual(
    productDetail.outgoing.map((l) => l.to.id).sort(),
    [ideaA.id, ideaB.id].sort(),
  );
  const ideaDetail = await store.getEntity(owner, ws.id, ideaA.id);
  assert.deepEqual(
    ideaDetail.incoming
      .filter((l) => l.relation === 'derived_from')
      .map((l) => l.from.id)
      .sort(),
    [product.id, sibling.id].sort(),
  );
  const ends = (
    steps: { link: { from: { id: string }; to: { id: string } } }[],
  ) => new Set(steps.flatMap((s) => [s.link.from.id, s.link.to.id]));
  // Upstream of the product reaches both ideas, the problem, the claim and the source.
  const upstream = ends(
    await store.lineage(owner, ws.id, product.id, 'upstream'),
  );
  for (const e of [ideaA, ideaB, problem, claim, source])
    assert.ok(upstream.has(e.id));
  assert.ok(!upstream.has(sibling.id));
  // Downstream of the source reaches both products through both ideas.
  const downstream = ends(
    await store.lineage(owner, ws.id, source.id, 'downstream'),
  );
  for (const e of [claim, problem, ideaA, ideaB, product, sibling])
    assert.ok(downstream.has(e.id));
  assert.ok(!downstream.has(task.id));
  const descendants = await store.lineage(owner, ws.id, ideaA.id, 'downstream');
  assert.deepEqual(
    descendants.map((s) => s.link.from.id).sort(),
    [product.id, sibling.id].sort(),
  );
  const fromArtifact = await store.lineage(
    owner,
    ws.id,
    artifact.id,
    'upstream',
  );
  assert.deepEqual(
    fromArtifact.map((s) => [s.depth, s.link.to.id]),
    [
      [1, task.id],
      [2, run.id],
    ],
  );
  await rejects('INVALID_CONTRACT', link('derived_from', artifact, source));
  await rejects('DUPLICATE', link('derived_from', product, ideaA));
  await rejects(
    'NOT_FOUND',
    link('derived_from', product, { id: ideaA.id, version: 9 }),
  );
});

test('optimistic versions reject stale and concurrent writes; corrections append instead of editing', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new Store(db.pool);
  await setup(store);
  const ws = await store.createWorkspace(owner, {
    name: 'Versions',
    record_mode: 'real',
  });
  const idea = await store.createEntity(owner, ws.id, {
    kind: 'idea',
    title: 'Roster',
    body: bodies.idea,
  });
  assert.equal(idea.fixture, false);
  const revise = (
    expected: number,
    summary: string,
    corrects: number | null = null,
  ) =>
    store.reviseEntity(owner, ws.id, idea.id, {
      expected_version: expected,
      title: 'Roster',
      body: { ...bodies.idea, summary },
      reason: 'Clarified summary',
      corrects_version: corrects,
    });
  assert.equal((await revise(1, 'A shared roster with owners.')).version, 2);
  await rejects('VERSION_CONFLICT', revise(1, 'Stale writer'));
  const raced = await Promise.allSettled([
    revise(2, 'Writer one'),
    revise(2, 'Writer two'),
  ]);
  assert.equal(raced.filter((r) => r.status === 'fulfilled').length, 1);
  const loser = raced.find((r) => r.status === 'rejected');
  assert.ok(
    loser &&
      loser.status === 'rejected' &&
      loser.reason instanceof ContractError,
  );
  assert.equal(loser.reason.code, 'VERSION_CONFLICT');
  const corrected = await revise(3, 'Correct summary after review', 2);
  const detail = await store.getEntity(owner, ws.id, idea.id);
  assert.deepEqual(
    detail.versions.map((v) => v.version),
    [1, 2, 3, 4],
  );
  assert.equal(
    detail.versions[1]?.body?.summary,
    'A shared roster with owners.',
  );
  assert.equal(detail.versions[3]?.corrects_version, 2);
  assert.equal(corrected.version, 4);
  await pgRejects(
    'P0001',
    db.pool.query(
      `update entity_versions set reason = 'edited' where entity_id = $1`,
      [idea.id],
    ),
  );
  await pgRejects(
    'P0001',
    db.pool.query('delete from entity_versions where entity_id = $1', [
      idea.id,
    ]),
  );
  await pgRejects(
    'P0001',
    db.pool.query(`update audit_events set action = 'x'`),
  );
  await rejects(
    'INVALID_TRANSITION',
    store.createEntity(owner, ws.id, {
      kind: 'product',
      title: 'P',
      body: { ...bodies.product, stage: 'building' },
    }),
  );
  const product = await store.createEntity(owner, ws.id, {
    kind: 'product',
    title: 'P',
    body: bodies.product,
  });
  await rejects(
    'INVALID_TRANSITION',
    store.reviseEntity(owner, ws.id, product.id, {
      expected_version: 1,
      title: 'P',
      body: { ...bodies.product, stage: 'released' },
      reason: 'skip ahead',
      corrects_version: null,
    }),
  );
  const archived = await store.archiveEntity(owner, ws.id, product.id, {
    expected_version: 1,
    reason: 'Superseded',
  });
  assert.equal(archived.status, 'archived');
  await rejects(
    'INVALID_TRANSITION',
    store.archiveEntity(owner, ws.id, product.id, {
      expected_version: 2,
      reason: 'again',
    }),
  );
  await rejects(
    'BODY_TOO_LARGE',
    store.createEntity(owner, ws.id, {
      kind: 'assessment',
      title: 'Large',
      body: {
        rubric_version: 'draft',
        summary: '€'.repeat(2000),
        evidence_confidence: 'low',
        // Character limits pass, but multi-byte text exceeds the stored byte budget.
        ethical_concerns: Array.from({ length: 20 }, () => '€'.repeat(500)),
      },
    }),
  );
  await rejects(
    'INVALID_CONTRACT',
    store.createEntity(owner, ws.id, {
      kind: 'artifact',
      title: 'Inline',
      body: { ...bodies.artifact, storage_uri: 'data:text/plain,secret' },
    }),
  );
});

test('access scopes: non-members cannot see, viewers cannot write, cross-workspace links fail in code and schema', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new Store(db.pool);
  await setup(store);
  const one = await store.createWorkspace(owner, {
    name: 'One',
    record_mode: 'fixture',
  });
  const two = await store.createWorkspace(owner, {
    name: 'Two',
    record_mode: 'fixture',
  });
  const real = await store.createWorkspace(owner, {
    name: 'Real',
    record_mode: 'real',
  });
  await store.addMember(owner, one.id, viewer.actorId, 'viewer');
  const a = await store.createEntity(owner, one.id, {
    kind: 'idea',
    title: 'A',
    body: bodies.idea,
  });
  const b = await store.createEntity(owner, two.id, {
    kind: 'product',
    title: 'B',
    body: bodies.product,
  });
  await rejects(
    'SCOPE_EXCEEDED',
    store.createLink(owner, two.id, {
      relation: 'derived_from',
      from: { id: b.id, version: 1 },
      to: { id: a.id, version: 1 },
      rationale: 'cross scope',
    }),
  );
  await rejects('NOT_FOUND', store.getEntity(outsider, one.id, a.id));
  await rejects('NOT_FOUND', store.getEntity(owner, two.id, a.id));
  await rejects('NOT_FOUND', store.listHistory(outsider, one.id));
  assert.equal((await store.getEntity(viewer, one.id, a.id)).entity.id, a.id);
  await rejects(
    'ACCESS_DENIED',
    store.createEntity(viewer, one.id, {
      kind: 'idea',
      title: 'V',
      body: bodies.idea,
    }),
  );
  await rejects(
    'ACCESS_DENIED',
    store.addMember(viewer, one.id, outsider.actorId, 'editor'),
  );
  assert.deepEqual(
    (await store.listWorkspaces(viewer)).map((w) => w.id),
    [one.id],
  );
  // Schema backstop: composite foreign keys reject cross-workspace links and fixture/real mixing.
  await pgRejects(
    '23503',
    db.pool.query(
      `insert into entity_links (id, workspace_id, relation, from_id, from_kind, from_version, to_id, to_kind, to_version, rationale, asserted_by)
     values ($1, $2, 'derived_from', $3, 'product', 1, $4, 'idea', 1, 'bypass', $5)`,
      [randomUUID(), two.id, b.id, a.id, owner.actorId],
    ),
  );
  await pgRejects(
    '23503',
    db.pool.query(
      `insert into entities (id, workspace_id, fixture, kind, version, status, title, body, content_hash, created_by)
     values ($1, $2, true, 'idea', 1, 'active', 'mixed', '{}', repeat('a', 64), $3)`,
      [randomUUID(), real.id, owner.actorId],
    ),
  );
});

test('outbox projection is idempotent under duplicate and concurrent delivery', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new Store(db.pool);
  await setup(store);
  const correlationId = randomUUID();
  const ctx = { ...owner, correlationId };
  const ws = await store.createWorkspace(ctx, {
    name: 'Outbox',
    record_mode: 'fixture',
  });
  const idea = await store.createEntity(ctx, ws.id, {
    kind: 'idea',
    title: 'I',
    body: bodies.idea,
  });
  const product = await store.createEntity(ctx, ws.id, {
    kind: 'product',
    title: 'P',
    body: bodies.product,
  });
  await store.createLink({ ...ctx, causationId: randomUUID() }, ws.id, {
    relation: 'derived_from',
    from: { id: product.id, version: 1 },
    to: { id: idea.id, version: 1 },
    rationale: 'r',
  });
  const pending = await db.pool.query<{ n: string }>(
    'select count(*) as n from outbox where delivered_at is null',
  );
  assert.equal(pending.rows[0]?.n, '4');
  assert.deepEqual(
    await store.listHistory(owner, ws.id),
    [],
    'history is a projection, filled only by delivery',
  );
  assert.equal(await store.drainOutbox(), 4);
  const history = await store.listHistory(owner, ws.id);
  assert.equal(history.length, 4);
  assert.ok(history.every((h) => h.correlation_id === correlationId));
  const events = await db.pool.query<{ id: string }>(
    'select id from audit_events order by sequence',
  );
  for (const e of events.rows) assert.equal(await store.deliver(e.id), false);
  await db.pool.query('update outbox set delivered_at = null');
  const relays = await Promise.all([
    store.drainOutbox(1),
    store.drainOutbox(1),
    store.drainOutbox(2),
  ]);
  assert.equal(
    relays.reduce((s, n) => s + n, 0),
    4,
  );
  assert.equal((await store.listHistory(owner, ws.id)).length, 4);
  const projected = await db.pool.query<{ n: string }>(
    'select count(*) as n from history_projection',
  );
  assert.equal(projected.rows[0]?.n, '4');
  const ideaHistory = await store.listHistory(owner, ws.id, {
    subjectId: idea.id,
  });
  assert.deepEqual(
    ideaHistory.map((h) => h.action),
    ['link.created', 'entity.created'],
  );
  assert.deepEqual(await store.verifyAuditChain(), {
    ok: true,
    events: 4,
    broken_at: null,
  });
});

test('idempotency keys replay one create and reject a changed request', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new Store(db.pool);
  await setup(store);
  const ws = await store.createWorkspace(owner, {
    name: 'Keys',
    record_mode: 'fixture',
  });
  const ctx = { ...owner, idempotencyKey: 'create-idea-0001' };
  const request = { kind: 'idea', title: 'Once', body: bodies.idea };
  const [first, second] = await Promise.all([
    store.createEntity(ctx, ws.id, request),
    store.createEntity(ctx, ws.id, request),
  ]);
  assert.equal(first.id, second.id);
  assert.equal(
    (await store.listEntities(owner, ws.id, { kind: 'idea' })).length,
    1,
  );
  await rejects(
    'IDEMPOTENCY_CONFLICT',
    store.createEntity(ctx, ws.id, { ...request, title: 'Changed' }),
  );
});

test('redaction leaves a non-sensitive tombstone; links, hashes and audit chain survive; tampering is detected', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new Store(db.pool);
  await setup(store);
  const ws = await store.createWorkspace(owner, {
    name: 'Redaction',
    record_mode: 'real',
  });
  const secretTitle = 'Private interview notes from J. Doe';
  const source = await store.createEntity(owner, ws.id, {
    kind: 'source',
    title: secretTitle,
    body: { ...bodies.source, observation: 'Sensitive detail' },
  });
  const claim = await store.createEntity(owner, ws.id, {
    kind: 'claim',
    title: 'Claim',
    body: bodies.claim,
  });
  await store.createLink(owner, ws.id, {
    relation: 'supports',
    from: { id: source.id, version: 1 },
    to: { id: claim.id, version: 1 },
    rationale: 'Quoted passage',
  });
  await store.addMember(owner, ws.id, viewer.actorId, 'editor');
  await rejects(
    'ACCESS_DENIED',
    store.redactEntity(viewer, ws.id, source.id, {
      expected_version: 1,
      reason_code: 'privacy',
    }),
  );
  const tombstone = await store.redactEntity(owner, ws.id, source.id, {
    expected_version: 1,
    reason_code: 'privacy',
  });
  assert.equal(tombstone.status, 'redacted');
  assert.equal(tombstone.body, null);
  const detail = await store.getEntity(owner, ws.id, source.id);
  assert.ok(
    detail.versions.every((v) => v.body === null && v.title === '[redacted]'),
  );
  assert.equal(detail.versions[0]?.content_hash, source.content_hash);
  assert.equal(detail.outgoing.length, 1);
  await store.drainOutbox();
  const dump = JSON.stringify(
    (await db.pool.query('select * from entities')).rows.concat(
      (await db.pool.query('select * from entity_versions')).rows,
      (await db.pool.query('select * from audit_events')).rows,
      (await db.pool.query('select * from history_projection')).rows,
    ),
  );
  assert.ok(!dump.includes('J. Doe') && !dump.includes('Sensitive detail'));
  await rejects(
    'INVALID_TRANSITION',
    store.createLink(owner, ws.id, {
      relation: 'supports',
      from: { id: source.id, version: 2 },
      to: { id: claim.id, version: 1 },
      rationale: 'after redaction',
    }),
  );
  await rejects(
    'INVALID_TRANSITION',
    store.reviseEntity(owner, ws.id, source.id, {
      expected_version: 2,
      title: 'x',
      body: bodies.source,
      reason: 'restore',
      corrects_version: null,
    }),
  );
  assert.equal((await store.verifyAuditChain()).ok, true);
  // The chain is tamper-evident to anyone who rereads it, not tamper-proof against the table owner.
  await db.pool.query(
    'alter table audit_events disable trigger audit_events_append_only',
  );
  await db.pool.query(
    `update audit_events set payload = payload || '{"kind":"forged"}' where sequence = 2`,
  );
  await db.pool.query(
    'alter table audit_events enable trigger audit_events_append_only',
  );
  assert.deepEqual(await store.verifyAuditChain(), {
    ok: false,
    events: 6,
    broken_at: '2',
  });
});

test('record lists come newest first, so a capped list keeps the newest', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new Store(db.pool);
  await setup(store);
  const ws = await store.createWorkspace(owner, {
    name: 'Order',
    record_mode: 'fixture',
  });
  const made: string[] = [];
  // One more than the list's cap of 500: the oldest is the one left out.
  for (let i = 0; i < 501; i++)
    made.push(
      (
        await store.createEntity(owner, ws.id, {
          kind: 'idea',
          title: `Idea ${i}`,
          body: bodies.idea,
        })
      ).id,
    );
  const listed = await store.listEntities(owner, ws.id, { kind: 'idea' });
  assert.equal(listed.length, 500);
  assert.equal(listed[0]!.id, made[500], 'the newest record leads');
  assert.equal(listed[499]!.id, made[1]);
  assert.ok(
    !listed.some((e) => e.id === made[0]),
    'the oldest is past the cap',
  );
});
