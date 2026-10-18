import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ContractError, type ErrorCode } from '@creator/contracts';
import { DISCOVERY_SCENARIOS } from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { segments } from '@creator/db';
import { discoverySetup, owner } from './discovery-harness.js';

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;
const all = ['record', 'passage', 'decision', 'activity'] as const;
const query = (q: string, over: Record<string, unknown> = {}) => ({
  q,
  types: [...all],
  kind: null,
  status: null,
  limit: 20,
  ...over,
});
const text = (s: { text: string }[]) => s.map((x) => x.text).join('');

test('segments split highlight markers without losing text', () => {
  assert.deepEqual(segments('a \u0002b\u0003 c'), [
    { text: 'a ', match: false },
    { text: 'b', match: true },
    { text: ' c', match: false },
  ]);
  assert.deepEqual(segments(null), []);
});

test('search finds records, passages, decisions and activity by text and by id', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { detail } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  await s.store.drainOutbox();

  const r = await s.store.search(owner, s.ws.id, query('no-show'));
  assert.equal(r.mode, 'text');
  assert.equal(r.fixture, true);
  assert.ok(
    r.hits.some((h) => h.type === 'record' && h.kind === 'alternative'),
  );
  assert.ok(r.hits.some((h) => h.type === 'passage'));
  const hit = r.hits.find((h) => h.type === 'record')!;
  assert.ok(
    hit.snippet.some((x) => x.match),
    'matched words are marked',
  );
  assert.ok(
    (r.counts.record ?? 0) >= r.hits.filter((h) => h.type === 'record').length,
  );

  // A passage hit opens its source; its text is the stored excerpt.
  const passages = await s.store.search(
    owner,
    s.ws.id,
    query('23 percent', { types: ['passage'] }),
  );
  assert.equal(passages.hits[0]?.subject?.kind, 'source');
  assert.match(text(passages.hits[0]!.snippet), /23 percent/);
  assert.equal(passages.hits[0]?.status, 'current');

  // Filters apply to records; the limit caps hits but not the count.
  const alts = await s.store.search(
    owner,
    s.ws.id,
    query('', { types: ['record'], kind: 'alternative', limit: 2 }),
  );
  assert.equal(alts.mode, 'browse');
  assert.ok(alts.hits.every((h) => h.kind === 'alternative'));
  assert.equal(alts.hits.length, 2);
  assert.equal(alts.counts.record, 5);
  assert.equal(alts.truncated, true);

  // Full id and an 8-character prefix (as the interface abbreviates ids).
  const exact = await s.store.search(owner, s.ws.id, query(problem.id));
  assert.equal(exact.mode, 'id');
  assert.deepEqual(
    exact.hits.filter((h) => h.type === 'record').map((h) => [h.id, h.match]),
    [[problem.id, 'id']],
  );
  assert.ok(
    exact.hits.some(
      (h) => h.type === 'activity' && h.subject?.id === problem.id,
    ),
  );
  const prefix = await s.store.search(
    owner,
    s.ws.id,
    query(problem.id.slice(0, 8)),
  );
  assert.ok(
    prefix.hits.some((h) => h.id === problem.id && h.match === 'id_prefix'),
  );

  // Activity search reads only safe summaries.
  const history = await s.store.search(
    owner,
    s.ws.id,
    query('workflow', { types: ['activity'] }),
  );
  assert.ok(history.hits.length > 0);
  assert.ok(history.hits.every((h) => h.type === 'activity'));

  await rejects(
    'INVALID_CONTRACT',
    s.store.search(owner, s.ws.id, query('x', { types: [] })),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.search(owner, s.ws.id, query('x', { limit: 500 })),
  );
});

test('search checks membership before snippets and counts, and redaction leaves nothing to find', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { detail, seeded } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const secret = await s.store.createEntity(owner, s.ws.id, {
    kind: 'idea',
    title: 'Zebracorn roster',
    body: {
      summary: 'A zebracorn rota for the clinic',
      uncertainty: 'Untested',
    },
  });
  // Another workspace's records never appear here, and are never counted.
  const other = await s.store.createWorkspace(owner, {
    name: 'Other',
    record_mode: 'fixture',
  });
  await s.store.createEntity(owner, other.id, {
    kind: 'idea',
    title: 'Quokkaline plan',
    body: { summary: 'Only in the other workspace', uncertainty: 'Untested' },
  });
  const none = await s.store.search(owner, s.ws.id, query('quokkaline'));
  assert.deepEqual(none.hits, []);
  assert.ok(Object.values(none.counts).every((n) => n === 0));

  // A non-member learns nothing: not results, not counts, not that the workspace exists.
  const stranger = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Stranger',
  });
  await rejects(
    'NOT_FOUND',
    s.store.search(stranger, s.ws.id, query('zebracorn')),
  );
  await rejects(
    'NOT_FOUND',
    s.store.search(stranger, s.ws.id, query(secret.id)),
  );
  await rejects('NOT_FOUND', s.store.activity(stranger, s.ws.id));
  await rejects('NOT_FOUND', s.store.overview(stranger, s.ws.id));
  await rejects('NOT_FOUND', s.store.actors(stranger, s.ws.id));
  await rejects('NOT_FOUND', s.store.comparison(stranger, s.ws.id, problem.id));
  // A viewer may read.
  const viewer = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: viewer.actorId,
    kind: 'human',
    display_name: 'Viewer',
  });
  await s.store.addMember(owner, s.ws.id, viewer.actorId, 'viewer');
  const seen = await s.store.search(viewer, s.ws.id, query('zebracorn'));
  assert.deepEqual(
    seen.hits.filter((h) => h.type === 'record').map((h) => h.id),
    [secret.id],
  );

  // Redacted: the words are gone from search; the id still finds a tombstone with no text.
  await s.store.redactEntity(owner, s.ws.id, secret.id, {
    expected_version: 1,
    reason_code: 'privacy',
  });
  const after = await s.store.search(owner, s.ws.id, query('zebracorn'));
  assert.equal(after.counts.record, 0);
  const tomb = await s.store.search(
    owner,
    s.ws.id,
    query(secret.id, { types: ['record'] }),
  );
  assert.equal(tomb.hits[0]?.status, 'redacted');
  assert.equal(tomb.hits[0]?.title, '[redacted]');
  assert.doesNotMatch(JSON.stringify(tomb), /zebracorn/i);

  // A redacted source takes its passages out of search.
  const claimId = seeded.evidence[0]!.claim_id;
  const ev = await s.store.claimEvidence(owner, s.ws.id, claimId);
  const sourceId = ev.rows[0]!.support.source_id;
  const before = await s.store.search(
    owner,
    s.ws.id,
    query('23 percent', { types: ['passage'] }),
  );
  assert.ok(before.hits.some((h) => h.subject?.id === sourceId));
  const src = await s.store.getEntity(owner, s.ws.id, sourceId);
  await s.store.redactEntity(owner, s.ws.id, sourceId, {
    expected_version: src.entity.version,
    reason_code: 'privacy',
  });
  const gone = await s.store.search(
    owner,
    s.ws.id,
    query('23 percent', { types: ['passage'] }),
  );
  assert.ok(!gone.hits.some((h) => h.subject?.id === sourceId));
});

test('activity names the actor, filters by action and pages; overview counts one workspace', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { detail, runId } = await s.discover(software);
  await s.store.drainOutbox();
  const page = await s.store.activity(owner, s.ws.id, { limit: 5 });
  assert.equal(page.entries.length, 5);
  assert.ok(page.next_before);
  assert.ok(page.entries.every((e) => e.actor.display_name.length > 0));
  const older = await s.store.activity(owner, s.ws.id, {
    limit: 5,
    before: page.next_before!,
  });
  assert.ok(
    BigInt(older.entries[0]!.sequence) < BigInt(page.entries[4]!.sequence),
  );
  const wf = await s.store.activity(owner, s.ws.id, { action: 'workflow.' });
  assert.ok(wf.entries.length > 0);
  assert.ok(wf.entries.every((e) => e.action.startsWith('workflow.')));
  assert.ok(
    wf.entries.some((e) => e.actor.kind === 'agent'),
    'worker steps name the worker',
  );
  const actors = await s.store.actors(owner, s.ws.id);
  assert.ok(actors.some((a) => a.id === owner.actorId && a.kind === 'human'));
  assert.ok(actors.some((a) => a.kind === 'agent'));
  const about = await s.store.activity(owner, s.ws.id, {
    subjectId: detail.workflow.id,
  });
  assert.ok(about.entries.length > 0);
  await rejects(
    'INVALID_CONTRACT',
    s.store.activity(owner, s.ws.id, { action: "x'; drop" }),
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.activity(owner, s.ws.id, { before: '-1' }),
  );

  const o = await s.store.overview(owner, s.ws.id);
  assert.equal(o.workspace.role, 'owner');
  assert.equal(o.records.find((r) => r.kind === 'alternative')?.active, 5);
  assert.equal(o.workflows.succeeded, 1);
  assert.equal(o.runs.active, 1);
  assert.ok(BigInt(o.budget.incurred) > 0n);
  assert.equal(o.budget.cap, '100000000000');

  // Cancelling the run is reflected, and nothing from another workspace is counted.
  await s.store.cancelRun(owner, s.ws.id, runId, { reason: 'Test stop' });
  const other = await s.store.createWorkspace(owner, {
    name: 'Empty',
    record_mode: 'fixture',
  });
  const empty = await s.store.overview(owner, other.id);
  assert.deepEqual(empty.records, []);
  assert.equal(empty.budget.envelopes, 0);
  assert.equal((await s.store.overview(owner, s.ws.id)).runs.cancelled, 1);
});

test('comparison gathers a problem, its alternatives and claim evidence', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { detail } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const cmp = await s.store.comparison(owner, s.ws.id, problem.id);
  assert.equal(cmp.problem.id, problem.id);
  assert.equal(cmp.workflow_id, detail.workflow.id);
  assert.equal(cmp.brief?.kind, 'search_brief');
  assert.equal(cmp.alternatives.length, 5);
  assert.ok(cmp.claims.length > 0);
  assert.ok(cmp.claims.every((c) => c.evidence.claim.id));
  // An assumption recorded for the discovery run appears with the comparison.
  assert.equal(cmp.run_id, detail.workflow.run_id);
  assert.deepEqual(cmp.assumptions, []);
  const assumption = await s.store.createEntity(owner, s.ws.id, {
    kind: 'assumption',
    title: 'Clinics will share exports',
    body: {
      statement: 'Clinics will share appointment exports.',
      consequence_if_wrong: 'No data to flag from.',
      would_change_decision: 'A clinic refuses to export.',
      status: 'unresolved',
      materiality: 'material',
      reversible: true,
      cheap_test: null,
      run_id: detail.workflow.run_id,
    },
  });
  const again = await s.store.comparison(owner, s.ws.id, problem.id);
  assert.deepEqual(
    again.assumptions.map((a) => a.id),
    [assumption.id],
  );
  const alt = cmp.alternatives[0]!.entity;
  await rejects('NOT_FOUND', s.store.comparison(owner, s.ws.id, alt.id));
});
