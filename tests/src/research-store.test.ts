import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  type AutonomyMode,
  type ErrorCode,
  type SourcePolicy,
} from '@creator/contracts';
import { evidencePacket } from '@creator/domain';
import { ResearchStore, type CommandContext } from '@creator/db';
import {
  FIXTURE_SOURCE_POLICY,
  FixtureSourceAdapter,
  SourceBroker,
} from '@creator/research';
import { freshDatabase } from './pg-harness.js';

const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();
const REPORT = 'https://health.fixture.test/reports/clinic-access-2025';
const WIRE = 'https://wire.fixture.test/stories/clinic-waits';
const REPOST = 'https://news.fixture.test/2026/03/clinic-waits';
const COPY = 'https://blog.fixture.test/posts/clinic-waits-copy';
const SURVEY = 'https://journal.fixture.test/articles/wait-time-survey';

test('source cancellation aborts the socket path and adapter exceptions leave durable failures', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const run = await s.run();
  let started!: () => void;
  const began = new Promise<void>((resolve) => {
    started = resolve;
  });
  const broker = new SourceBroker(
    s.store,
    {
      live: null,
      fixture: {
        kind: 'fixture',
        fetchHop: async ({ signal }) => {
          started();
          return new Promise((resolve) =>
            signal.addEventListener(
              'abort',
              () =>
                resolve({
                  kind: 'error',
                  reason_code: 'timeout',
                  explanation: 'Aborted',
                }),
              { once: true },
            ),
          );
        },
      },
    },
    { live: null, fixture: FIXTURE_SOURCE_POLICY },
  );
  const req = {
    url: REPORT,
    task_id: null,
    logical_operation_id: randomUUID(),
    justification: 'Cancellation check.',
  };
  const pending = broker.fetch(owner, s.ws.id, run, req);
  await began;
  assert.equal(broker.cancelRun(run.toUpperCase()), 1);
  const out = await pending;
  assert.equal(out.state, 'failed');
  assert.equal(out.reason_code, 'run_cancelled');
  assert.equal(broker.cancelRun(run), 0);
  const broken = new SourceBroker(
    s.store,
    {
      live: null,
      fixture: {
        kind: 'fixture',
        fetchHop: async () => {
          throw new Error('adapter failed');
        },
      },
    },
    { live: null, fixture: FIXTURE_SOURCE_POLICY },
  );
  const failed = await broken.fetch(owner, s.ws.id, run, {
    ...req,
    logical_operation_id: randomUUID(),
  });
  assert.equal(failed.state, 'failed');
  assert.equal(failed.reason_code, 'adapter_error');
});

async function setup(
  t: test.TestContext,
  policy: Partial<SourcePolicy> = {},
  record_mode: 'fixture' | 'real' = 'fixture',
) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ResearchStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Research',
    record_mode,
  });
  const adapter = new FixtureSourceAdapter();
  const broker = new SourceBroker(
    store,
    { fixture: adapter, live: null },
    { fixture: { ...FIXTURE_SOURCE_POLICY, ...policy }, live: null },
  );
  async function run(mode: AutonomyMode = 'human_in_loop', grant = true) {
    const condition =
      mode === 'human_only'
        ? 'human_only'
        : mode === 'autonomous_within_scope'
          ? 'autonomous'
          : 'human_in_loop';
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: `${mode} research run`,
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
    if (grant)
      await store.createStandingGrant(owner, ws.id, {
        run_id: control.run_id,
        action_types: ['source.fetch'],
        target_kind: null,
        max_amount_nano_usd: null,
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['public'],
        expires_at: inHours(24),
        rationale: 'Fetch approved public sources for this run.',
      });
    return control.run_id;
  }
  const fetch = (runId: string, url: string, op = randomUUID()) =>
    broker.fetch(owner, ws.id, runId, {
      url,
      task_id: null,
      logical_operation_id: op,
      justification: 'Evidence for the clinic-wait problem brief.',
    });
  const claim = (
    statement: string,
    basis: 'observation' | 'inference' = 'observation',
  ) =>
    store.createEntity(owner, ws.id, {
      kind: 'claim',
      title: statement.slice(0, 80),
      body: { statement, basis, uncertainty: 'Fixture claim.' },
    });
  const passages = async (sourceId: string) =>
    (await store.getSource(owner, ws.id, sourceId)).passages;
  const find = async (sourceId: string, needle: string) => {
    const p = (await passages(sourceId)).find((x) =>
      x.excerpt?.includes(needle),
    );
    assert.ok(p, `passage containing "${needle}"`);
    return p;
  };
  const support = (
    claimId: string,
    claimVersion: number,
    passageId: string,
    stance: 'supports' | 'contradicts' | 'does_not_support',
    quote: string | null,
    support_type:
      | 'source_assertion'
      | 'quotation'
      | 'observation'
      | 'inference' = 'observation',
  ) =>
    store.addClaimSupport(owner, ws.id, claimId, {
      evidence: 'passage',
      claim_version: claimVersion,
      passage_id: passageId,
      stance,
      support_type,
      quote,
      rationale: 'Assessed against the passage text.',
    });
  return {
    db,
    store,
    ws,
    adapter,
    broker,
    run,
    fetch,
    claim,
    passages,
    find,
    support,
  };
}

test('supporting and non-supporting passages; fabricated quotes are refused', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const runId = await s.run();
  const r = await s.fetch(runId, REPORT);
  assert.equal(r.state, 'fetched');
  assert.equal(r.source_version, 1);
  assert.equal(r.changed, true);
  assert.ok(r.admission_id, 'every fetch is admitted');
  const detail = await s.store.getSource(owner, s.ws.id, r.source_id!);
  assert.equal(detail.source.published_at, '2026-03-02T09:00:00.000Z');
  // Site chrome (nav, footer) is kept as passages too; offsets cover the whole page text.
  assert.equal(detail.passages.length, 6);
  for (const p of detail.passages)
    assert.equal(p.locator.text_hash, r.text_hash);
  const c = await s.claim(
    'Rural first-appointment waits rose between 2022 and 2025.',
  );
  const figure = await s.find(r.source_id!, '41 days');
  const scope = await s.find(r.source_id!, 'does not measure why');
  await s.support(
    c.id,
    1,
    figure.id,
    'supports',
    'was 41 days, up from 29 days in 2022',
  );
  await s.support(c.id, 1, scope.id, 'does_not_support', null);
  // Invented or misplaced quotes cannot become citations.
  await rejects(
    'EVIDENCE_MISMATCH',
    s.support(
      c.id,
      1,
      scope.id,
      'supports',
      'waits more than doubled in rural clinics',
    ),
  );
  const urban = await s.find(r.source_id!, 'Urban clinics');
  await rejects(
    'EVIDENCE_MISMATCH',
    s.support(
      c.id,
      1,
      urban.id,
      'supports',
      'was 41 days, up from 29 days in 2022',
    ),
  );
  await rejects(
    'DUPLICATE',
    s.support(c.id, 1, figure.id, 'supports', 'was 41 days, up from 29'),
  );
  const ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.status, 'supported');
  assert.equal(ev.independent_origins, 1);
  assert.ok(ev.labels.includes('single source'));
  assert.ok(ev.labels.includes('some reviewed passages do not support it'));
  assert.deepEqual(
    ev.rows.map((x) => [x.support.stance, x.freshness, x.counted]),
    [
      ['supports', 'current', true],
      ['does_not_support', 'current', false],
    ],
  );
  // The catalog link binds the exact source and claim versions.
  const claimDetail = await s.store.getEntity(owner, s.ws.id, c.id);
  assert.deepEqual(
    claimDetail.incoming.map((l) => [
      l.relation,
      l.from.id,
      l.from.version,
      l.to.version,
    ]),
    [['supports', r.source_id, 1, 1]],
  );
  // A revised claim needs fresh assessment; old rows no longer count.
  await s.store.reviseEntity(owner, s.ws.id, c.id, {
    expected_version: 1,
    title: 'Rural waits rose sharply',
    body: {
      statement:
        'Rural first-appointment waits rose sharply between 2022 and 2025.',
      basis: 'observation',
      uncertainty: 'Fixture claim.',
    },
    reason: 'Sharper wording',
    corrects_version: null,
  });
  const revised = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(revised.status, 'insufficient');
  assert.ok(revised.rows.every((x) => x.freshness === 'claim_changed'));
  await rejects(
    'VERSION_CONFLICT',
    s.support(c.id, 1, urban.id, 'does_not_support', null),
  );
});

test('reposts form one origin; an independent source contests the claim', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const runId = await s.run();
  const wire = await s.fetch(runId, WIRE);
  const repost = await s.fetch(runId, REPOST);
  const copy = await s.fetch(runId, COPY);
  const sources = await s.store.listSources(owner, s.ws.id);
  const byId = new Map(sources.map((x) => [x.id, x]));
  const cluster = byId.get(wire.source_id!)!.origin_cluster;
  assert.equal(byId.get(repost.source_id!)!.origin_cluster, cluster);
  assert.match(
    byId.get(repost.source_id!)!.cluster_reason,
    /wire\.fixture\.test/,
  );
  assert.equal(byId.get(copy.source_id!)!.origin_cluster, cluster);
  assert.match(byId.get(copy.source_id!)!.cluster_reason, /same text/);
  assert.equal(byId.get(wire.source_id!)!.cluster_size, 3);
  const c = await s.claim(
    'Rural first-appointment waits rose between 2022 and 2025.',
  );
  for (const r of [wire, repost, copy]) {
    const p = await s.find(r.source_id!, '41 days');
    await s.support(
      c.id,
      1,
      p.id,
      'supports',
      'was 41 days in 2025, up from 29 days in 2022',
      'source_assertion',
    );
  }
  let ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.status, 'supported');
  assert.equal(ev.independent_origins, 1, 'three reposts are one origin');
  assert.ok(ev.labels.some((l) => l.startsWith('single origin')));
  assert.ok(
    ev.labels.includes('rests on source assertions, not observed data'),
  );
  const survey = await s.fetch(runId, SURVEY);
  const fell = await s.find(survey.source_id!, 'fell slightly');
  await s.support(
    c.id,
    1,
    fell.id,
    'contradicts',
    'fell slightly, from a mean of 35 days in 2022 to 33 days in 2025',
  );
  ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.status, 'contested');
  assert.equal(ev.contrary_origins, 1);
  const claimDetail = await s.store.getEntity(owner, s.ws.id, c.id);
  assert.ok(claimDetail.incoming.some((l) => l.relation === 'contradicts'));
  const report = await s.fetch(runId, REPORT);
  const figure = await s.find(report.source_id!, '41 days');
  await s.support(
    c.id,
    1,
    figure.id,
    'supports',
    'was 41 days, up from 29 days in 2022',
  );
  ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.independent_origins, 2);
  // Retracting the contrary evidence retracts its catalog link too.
  const contrary = ev.rows.find((x) => x.support.stance === 'contradicts')!;
  await s.store.retractClaimSupport(owner, s.ws.id, contrary.support.id, {
    reason: 'Different measure (self-reported)',
  });
  ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.status, 'supported');
  const after = await s.store.getEntity(owner, s.ws.id, c.id);
  assert.ok(
    after.incoming
      .filter((l) => l.relation === 'contradicts')
      .every((l) => l.retracted_at),
  );
});

test('a changed source version invalidates earlier support until re-assessed', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const runId = await s.run();
  const first = await s.fetch(runId, REPORT);
  const c = await s.claim(
    'Rural first-appointment waits rose between 2022 and 2025.',
  );
  const old = await s.find(first.source_id!, '41 days');
  await s.support(
    c.id,
    1,
    old.id,
    'supports',
    'was 41 days, up from 29 days in 2022',
  );
  const second = await s.fetch(runId, REPORT);
  assert.equal(second.state, 'fetched');
  assert.equal(second.changed, true);
  assert.equal(second.source_id, first.source_id);
  assert.equal(second.source_version, 2);
  assert.notEqual(second.content_hash, first.content_hash);
  let ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.status, 'needs_recheck');
  assert.equal(ev.rows[0]!.freshness, 'changed');
  assert.ok(ev.labels.includes('a cited source changed since it was assessed'));
  await rejects(
    'VERSION_CONFLICT',
    s.support(c.id, 1, old.id, 'does_not_support', null),
  );
  const corrected = await s.find(first.source_id!, '38 days');
  assert.equal(corrected.source_version, 2);
  await s.support(
    c.id,
    1,
    corrected.id,
    'supports',
    'was 38 days, up from 29 days in 2022',
  );
  ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.status, 'supported');
  // Version history keeps both texts' hashes; an identical re-fetch adds no version.
  const third = await s.fetch(runId, REPORT);
  assert.equal(third.changed, false);
  assert.equal(third.source_version, 2);
  const entity = await s.store.getEntity(owner, s.ws.id, first.source_id!);
  assert.deepEqual(
    entity.versions.map((v) => v.version),
    [1, 2],
  );
  // A tiny freshness window makes even current support stale.
  const strict = await s.store.claimEvidence(owner, s.ws.id, c.id, 0);
  assert.equal(strict.status, 'needs_recheck');
  assert.ok(
    strict.labels.includes('a cited source is older than the freshness window'),
  );
});

test('inaccessible and removed sources are labeled, never filled in', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const runId = await s.run();
  const paywalled = await s.fetch(
    runId,
    'https://journal.fixture.test/articles/paywalled-study',
  );
  assert.equal(paywalled.state, 'inaccessible');
  assert.equal(paywalled.http_status, 403);
  assert.equal(paywalled.content_hash, null);
  const src = await s.store.getSource(owner, s.ws.id, paywalled.source_id!);
  assert.equal(src.source.retrieval_status, 'inaccessible');
  assert.equal(src.passages.length, 0);
  const c = await s.claim(
    'A randomized study found shorter waits after triage changes.',
  );
  await s.store.addClaimSupport(owner, s.ws.id, c.id, {
    evidence: 'inaccessible_source',
    claim_version: 1,
    source_id: paywalled.source_id!,
    source_version: 1,
    rationale: 'Cited by a news story; the study itself is paywalled.',
  });
  let ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.status, 'inaccessible');
  assert.equal(ev.rows[0]!.counted, false);

  const brief = await s.fetch(
    runId,
    'https://health.fixture.test/reports/staffing-brief',
  );
  assert.equal(brief.state, 'fetched');
  const c2 = await s.claim(
    'Rural clinics had many vacant nursing posts in 2025.',
  );
  const vac = await s.find(brief.source_id!, '18 percent');
  await s.support(
    c2.id,
    1,
    vac.id,
    'supports',
    '18 percent of nursing posts vacant in 2025',
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.addClaimSupport(owner, s.ws.id, c2.id, {
      evidence: 'inaccessible_source',
      claim_version: 1,
      source_id: brief.source_id!,
      source_version: 1,
      rationale: 'It is available; this must cite a passage.',
    }),
  );
  const gone = await s.fetch(
    runId,
    'https://health.fixture.test/reports/staffing-brief',
  );
  assert.equal(gone.state, 'removed');
  assert.equal(gone.source_version, 2);
  ev = await s.store.claimEvidence(owner, s.ws.id, c2.id);
  assert.equal(ev.rows[0]!.freshness, 'removed');
  assert.equal(ev.status, 'inaccessible');
  assert.ok(ev.labels.includes('a cited source is inaccessible or removed'));
});

test('redirects and URLs that reach inward are blocked before any contact', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const runId = await s.run();
  const metadata = await s.fetch(
    runId,
    'https://health.fixture.test/go/latest-report',
  );
  assert.equal(metadata.state, 'blocked');
  assert.equal(metadata.reason_code, 'private_address');
  assert.deepEqual(metadata.redirects, [
    { url: 'https://health.fixture.test/go/latest-report', status: 302 },
  ]);
  const portal = await s.fetch(
    runId,
    'https://health.fixture.test/go/staff-portal',
  );
  assert.equal(portal.state, 'blocked');
  assert.equal(
    portal.reason_code,
    'private_address',
    'approved name, private DNS answer',
  );
  const downgrade = await s.fetch(
    runId,
    'https://health.fixture.test/go/insecure',
  );
  assert.equal(downgrade.reason_code, 'protocol_not_allowed');
  assert.deepEqual(s.adapter.calls, [
    'https://health.fixture.test/go/latest-report',
    'https://health.fixture.test/go/staff-portal',
    'https://intranet.fixture.test/admin',
    'https://health.fixture.test/go/insecure',
  ]);
  const calls = s.adapter.calls.length;
  for (const [url, reason] of [
    ['https://169.254.169.254/latest/meta-data/', 'private_address'],
    [
      'http://health.fixture.test/reports/clinic-access-2025',
      'protocol_not_allowed',
    ],
    ['https://user:secret@health.fixture.test/', 'credentials_in_url'],
    ['https://evil.example/', 'host_not_approved'],
  ] as const) {
    const r = await s.fetch(runId, url);
    assert.deepEqual(
      [r.state, r.reason_code, r.admission_id],
      ['blocked', reason, null],
    );
  }
  assert.equal(
    s.adapter.calls.length,
    calls,
    'refused URLs never reach the adapter',
  );
  assert.equal((await s.store.listSources(owner, s.ws.id)).length, 0);
});

test('retrieved instructions change nothing: no grants, decisions, policy or extra fetches', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const runId = await s.run();
  const grants = await s.store.listGrants(owner, s.ws.id);
  const runs = await s.store.listRuns(owner, s.ws.id);
  const decisions = await s.store.listDecisions(owner, s.ws.id, {});
  const r = await s.fetch(
    runId,
    'https://forum.fixture.test/threads/clinic-tips',
  );
  assert.equal(r.state, 'fetched');
  assert.equal(r.instruction_like, true);
  assert.deepEqual(s.adapter.calls, [
    'https://forum.fixture.test/threads/clinic-tips',
  ]);
  const detail = await s.store.getSource(owner, s.ws.id, r.source_id!);
  assert.equal(detail.source.instruction_like, true);
  const flagged = detail.passages.filter((p) => p.instruction_like);
  assert.equal(
    flagged.length,
    2,
    'visible and hidden instructions are both labeled',
  );
  assert.deepEqual(await s.store.listGrants(owner, s.ws.id), grants);
  assert.deepEqual(await s.store.listRuns(owner, s.ws.id), runs);
  assert.deepEqual(await s.store.listDecisions(owner, s.ws.id, {}), decisions);
  const admissions = await s.store.listAdmissions(owner, s.ws.id, runId);
  assert.deepEqual(
    admissions.map((a) => a.binding.action_type),
    ['source.fetch'],
    'only the requested fetch was admitted',
  );
  assert.deepEqual(
    (await s.store.listRetrievals(owner, s.ws.id)).map((x) => x.requested_url),
    ['https://forum.fixture.test/threads/clinic-tips'],
  );
  // Passed onward, the text stays inside an inert evidence packet.
  const packet = JSON.parse(
    evidencePacket(
      flagged.map((p) => ({
        source_id: r.source_id!,
        source_version: 1,
        passage_id: p.id,
        url: r.final_url!,
        excerpt: p.excerpt,
      })),
    ),
  ) as { authority: string };
  assert.equal(packet.authority, 'none');
});

test('byte, time, type and retention limits; failures keep no content', async (t) => {
  const s = await setup(t, { timeout_ms: 300 });
  if (!s) return;
  const runId = await s.run();
  const huge = await s.fetch(
    runId,
    'https://health.fixture.test/files/huge-report',
  );
  assert.deepEqual(
    [huge.state, huge.reason_code, huge.source_id],
    ['too_large', 'byte_limit', null],
  );
  const zip = await s.fetch(
    runId,
    'https://health.fixture.test/files/archive.zip',
  );
  assert.equal(zip.state, 'unsupported_type');
  assert.ok(zip.content_hash);
  assert.equal(zip.source_id, null);
  const slow = await s.fetch(runId, 'https://health.fixture.test/slow');
  assert.deepEqual([slow.state, slow.reason_code], ['failed', 'timeout']);
  const flaky = await s.fetch(runId, 'https://health.fixture.test/flaky');
  assert.deepEqual(
    [flaky.state, flaky.reason_code, flaky.source_id],
    ['failed', 'http_503', null],
  );
  const licensed = await s.fetch(
    runId,
    'https://licensed.fixture.test/datasets/clinic-panel',
  );
  assert.equal(licensed.state, 'fetched');
  const passages = await s.passages(licensed.source_id!);
  assert.ok(passages.length > 0);
  assert.ok(
    passages.every((p) => p.excerpt === null),
    'hash-only retention keeps no text',
  );
  const c = await s.claim('Rural waits averaged about 40 days in 2025.');
  await rejects(
    'EVIDENCE_MISMATCH',
    s.support(c.id, 1, passages[1]!.id, 'supports', 'averaged 40 days in 2025'),
  );
});

test('admission, idempotency, run limits and no fixture fallback in real workspaces', async (t) => {
  const s = await setup(t, { max_fetches_per_run: 2 });
  if (!s) return;
  const noGrant = await s.run('human_in_loop', false);
  const asked = await s.fetch(noGrant, REPORT);
  assert.equal(asked.state, 'needs_human');
  assert.ok(asked.decision_id);
  const decision = await s.store.getDecision(
    owner,
    s.ws.id,
    asked.decision_id!,
  );
  assert.match(decision.question, /clinic-access-2025/);
  assert.equal(
    s.adapter.calls.length,
    0,
    'nothing is fetched while a person decides',
  );
  // Approve-once covers exactly that URL: the next attempt at it is admitted, another URL is not.
  await s.store.answerDecision(owner, s.ws.id, decision.id, {
    choice: 'approve_once',
    option_id: null,
    rationale: 'This report is a reasonable source.',
    coverage_hash: decision.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: null,
    interruption: null,
  });
  assert.equal((await s.fetch(noGrant, WIRE)).state, 'needs_human');
  assert.equal((await s.fetch(noGrant, REPORT)).state, 'fetched');
  assert.equal(
    (await s.fetch(noGrant, REPORT)).state,
    'needs_human',
    'the grant was used once',
  );
  s.adapter.calls.length = 0;

  const runId = await s.run();
  const op = randomUUID();
  const first = await s.fetch(runId, REPORT, op);
  const again = await s.fetch(runId, REPORT, op);
  assert.equal(again.id, first.id);
  assert.equal(again.replayed, true);
  assert.equal(s.adapter.calls.length, 1);
  await rejects('IDEMPOTENCY_CONFLICT', s.fetch(runId, WIRE, op));
  await s.fetch(runId, WIRE);
  const third = await s.fetch(runId, SURVEY);
  assert.deepEqual(
    [third.state, third.reason_code],
    ['denied', 'fetch_limit_reached'],
  );

  // Human-only runs may fetch (no model is involved); a cancelled run may not.
  const human = await s.run('human_only');
  assert.equal((await s.fetch(human, SURVEY)).state, 'fetched');
  await s.store.cancelRun(owner, s.ws.id, human, { reason: 'Study ended' });
  assert.equal((await s.fetch(human, WIRE)).state, 'denied');

  const real = await setup(t, {}, 'real');
  if (!real) return;
  const realRun = await real.run();
  const denied = await real.fetch(realRun, REPORT);
  assert.deepEqual(
    [denied.state, denied.reason_code, denied.adapter],
    ['denied', 'live_fetch_not_configured', 'none'],
  );
  assert.equal(real.adapter.calls.length, 0);
});

test('concurrent fetches of one URL record one source; a lost attempt is closed on sweep', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const runId = await s.run();
  const results = await Promise.all(
    Array.from({ length: 4 }, () => s.fetch(runId, WIRE)),
  );
  assert.equal(new Set(results.map((r) => r.source_id)).size, 1);
  assert.equal(results.filter((r) => r.changed).length, 1);
  assert.equal((await s.store.listSources(owner, s.ws.id)).length, 1);

  // Simulate a crash after admission: the in-flight row is swept as interrupted.
  const op = randomUUID();
  const req = {
    url: SURVEY,
    task_id: null,
    logical_operation_id: op,
    justification: 'Crash test.',
  };
  const begun = await s.store.beginRetrieval(owner, s.ws.id, runId, req, {
    requestHash: 'a'.repeat(64),
    policyHash: 'b'.repeat(64),
    adapter: 'fixture',
    urlKey: SURVEY,
    block: null,
    maxFetchesPerRun: 100,
    staleAfterMs: 60_000,
  });
  assert.equal(begun.kind, 'go');
  assert.equal(await s.store.sweepRetrievals(owner, 0), 1);
  const list = await s.store.listRetrievals(owner, s.ws.id, { runId });
  const lost = list.find((x) => x.logical_operation_id === op)!;
  assert.deepEqual([lost.state, lost.reason_code], ['failed', 'interrupted']);
});

test('only the broker records retrievals, and redaction removes kept text', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const runId = await s.run();
  const r = await s.fetch(runId, REPORT);
  await rejects(
    'INVALID_CONTRACT',
    s.store.createEntity(owner, s.ws.id, {
      kind: 'source',
      title: 'Forged retrieval',
      body: {
        url: 'https://health.fixture.test/forged',
        retrieval_status: 'available',
        content_hash: 'c'.repeat(64),
        retrieved_at: new Date().toISOString(),
        published_at: null,
        independent_origin: 'invented',
        observation: 'Never fetched.',
        uncertainty: 'All of it.',
        retrieval: {
          retrieval_id: randomUUID(),
          final_url: 'https://health.fixture.test/forged',
          access: 'public',
          extraction: 'extracted',
          retention: 'excerpts',
          text_hash: 'd'.repeat(64),
          canonical_url: null,
          origin_cluster: randomUUID(),
          policy_hash: 'e'.repeat(64),
        },
      },
    }),
  );
  const current = await s.store.getEntity(owner, s.ws.id, r.source_id!);
  await rejects(
    'INVALID_TRANSITION',
    s.store.reviseEntity(owner, s.ws.id, r.source_id!, {
      expected_version: 1,
      title: 'Edited',
      body: current.entity.body!,
      reason: 'Manual edit',
      corrects_version: null,
    }),
  );
  const c = await s.claim(
    'Rural first-appointment waits rose between 2022 and 2025.',
  );
  const figure = await s.find(r.source_id!, '41 days');
  await s.support(
    c.id,
    1,
    figure.id,
    'supports',
    'was 41 days, up from 29 days in 2022',
  );
  await s.store.redactEntity(owner, s.ws.id, r.source_id!, {
    expected_version: 1,
    reason_code: 'license',
  });
  const left = await s.db.pool.query(
    'select count(*)::int as n from source_passages where source_id = $1 and excerpt is not null',
    [r.source_id],
  );
  assert.equal(left.rows[0].n, 0);
  const ev = await s.store.claimEvidence(owner, s.ws.id, c.id);
  assert.equal(ev.rows[0]!.support.quote, null);
  const refetch = await s.fetch(runId, REPORT);
  assert.equal(refetch.reason_code, 'source_redacted');
  const after = await s.db.pool.query(
    'select count(*)::int as n from source_passages where source_id = $1 and excerpt is not null',
    [r.source_id],
  );
  assert.equal(
    after.rows[0].n,
    0,
    'a re-fetch does not bring redacted text back',
  );
  // The database itself refuses edits to kept passages.
  await assert.rejects(
    s.db.pool.query(
      "update source_passages set excerpt = 'tampered' where source_id = $1",
      [r.source_id],
    ),
  );
});
