import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createHash, randomUUID } from 'node:crypto';
import { ContractError } from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  RUNBOOK_FIXTURE_SPEC,
  fixtureDispositions,
  fixtureHumilityReview,
  fixtureScorecards,
  projectReportFileName,
  projectReportMarkdown,
  type ProjectReportInput,
} from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { ProjectReportStore } from '@creator/db';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { discoverySetup, owner } from './discovery-harness.js';
import { LOGIN_CODE, login } from './pg-harness.js';

// ADR-0117 (F3): the project report. A Markdown file built from the workspace's records alone:
// claims carry their quotes and source locators, rejected options and dissent appear, money
// matches the budget records, access is the workspace's own, fixture data is labelled, held-out
// cases and secrets never leave, and reading it changes nothing.

const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

function emptyInput(): ProjectReportInput {
  return {
    workspace: { id: randomUUID(), name: 'Clinic', record_mode: 'real' },
    records_as_of: '2026-11-15T10:00:00.000Z',
    generated_at: '2026-11-15T12:00:00.000Z',
    problems: [],
    problems_omitted: 0,
    claims_not_listed: 0,
    humility: [],
    interventions: [],
    interventions_omitted: 0,
    specs: [],
    builds: [],
    proposals: [],
    autopilots: [],
    money: {
      attempts: {},
      settled_nano: '0',
      unknown_exposure_nano: '0',
      unknown_attempts: 0,
      in_flight_attempts: 0,
      providers: {},
      envelopes: [],
      plan_requests: {},
    },
  };
}

test('report text: secrets and personal paths removed, record text cannot forge structure, held-out counted only', () => {
  const input = emptyInput();
  input.workspace.name = 'Clinic # Fake heading';
  input.problems.push({
    id: randomUUID(),
    version: 2,
    status: 'active',
    title: 'Missed appointments\n## Injected heading',
    statement:
      'Key sk-proj-ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789abcd leaked here.',
    affected_group: 'Staff at C:\\Users\\Jordan Price\\Documents\\notes.txt',
    uncertainty: 'medium',
    claims: [
      {
        id: randomUUID(),
        version: 1,
        statement: 'Half of slots go unused.',
        basis: 'observation',
        relation: 'contradicts',
        for_option: null,
        evidence_status: 'supported',
        labels: [],
        sources: [
          {
            source_id: randomUUID(),
            source_version: 1,
            title: 'Survey',
            url: 'https://example.test/survey',
            stance: 'contradicts',
            freshness: 'current',
            quote: 'only a third were unused',
            locator: 'paragraph 2, characters 10–40',
          },
        ],
      },
    ],
    claims_omitted: 3,
    options: [],
    comparison_note: null,
    selections: [],
  });
  input.specs.push({
    id: randomUUID(),
    version: 1,
    status: 'active',
    title: 'Spec',
    freeze: null,
    checks: [
      {
        key: 'A1',
        statement: 'Counts words',
        method: 'automated_test',
        cases: 2,
        held_out: 1,
      },
    ],
  });
  input.money.unknown_attempts = 1;
  input.money.unknown_exposure_nano = '1500000000';
  input.money.attempts = { unknown: 1 };
  input.money.providers = { openai: 1 };
  const { markdown, redactions } = projectReportMarkdown(input);
  assert.doesNotMatch(markdown, /sk-proj-ABCDEF/);
  assert.doesNotMatch(markdown, /Jordan Price/);
  assert.deepEqual(redactions, { secrets: 1, paths: 1 });
  assert.match(markdown, /1 credential and 1 personal folder path/);
  // Record text stays on its line and its markup is escaped.
  assert.doesNotMatch(markdown, /^## Injected heading/m);
  assert.match(markdown, /^# Project report: Clinic \\# Fake heading$/m);
  assert.match(markdown, /\*\*Contrary claim\*\*/);
  assert.match(
    markdown,
    /<https:\/\/example\.test\/survey> \(source [0-9a-f]{8} v1; contradicts; current; paragraph 2, characters 10–40\) — “only a third were unused”/,
  );
  assert.match(markdown, /and 3 more claims, not listed here/);
  assert.match(markdown, /2 shown, 1 held out \(not shown\)/);
  assert.match(markdown, /\*\*Not frozen\.\*\*/);
  assert.match(
    markdown,
    /holding up to \$1\.500000000\. Unknown is not zero\./,
  );
  // A real workspace is not labelled as fixture.
  assert.doesNotMatch(markdown, /Fixture workspace/);
  assert.equal(
    projectReportFileName('Clinic # Fake heading', input.generated_at),
    'clinic-fake-heading-report-2026-11-15.md',
  );
  assert.equal(
    projectReportFileName(
      'sk-proj-ABCDEFGHIJKLMNOPQRSTUVWX',
      input.generated_at,
    ),
    'project-report-2026-11-15.md',
  );
});

type Setup = NonNullable<Awaited<ReturnType<typeof discoverySetup>>>;

/** Discovery, scores, a person's selection (build one option, reject the rest), a frozen spec. */
async function project(s: Setup) {
  const { detail, runId, seeded } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const evidence = seeded.evidence.map((e) => ({ id: e.claim_id, version: 1 }));
  const first = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const alts = first.suitability.candidates.map((c) => c.alternative);
  for (const card of fixtureScorecards(alts, evidence))
    await s.store.recordScorecard(owner, s.ws.id, card);
  const build = alts.find((a) => a.kind === 'build')!;
  await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review: no-show flags',
    body: {
      ...fixtureHumilityReview(
        { id: build.id, version: build.version },
        evidence,
      ),
      dissent: ['A front-desk lead thinks reminders alone would do (test).'],
    },
  });
  const approve = async (decisionId: string) => {
    const d = await s.store.getDecision(owner, s.ws.id, decisionId);
    await s.store.answerDecision(owner, s.ws.id, decisionId, {
      choice: 'approve_once',
      option_id: null,
      rationale: 'Approved for this exact version (test).',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    });
  };
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const req = {
    problem: { id: report.problem.id, version: report.problem.version },
    report_hash: report.report_hash,
    dispositions: fixtureDispositions(report),
    override_reason:
      'Reminders are recommended too; no coordinator is funded this quarter (test).',
    rationale: 'Build the flags; turn on reminders meanwhile (test).',
    shortlist_size: 3,
    data_class: 'synthetic' as const,
  };
  const asked = await s.store.select(owner, s.ws.id, runId, req);
  assert.equal(asked.status, 'needs_human', asked.admission.explanation);
  await approve(asked.admission.decision_id!);
  const selection = (await s.store.select(owner, s.ws.id, runId, req))
    .selection!;
  const spec = await s.store.createSpec(owner, s.ws.id, {
    selection_id: selection.id,
    alternative: { id: build.id, version: build.version },
    title: 'Word tally (synthetic)',
    content: RUNBOOK_FIXTURE_SPEC,
  });
  const f = {
    spec: { id: spec.spec.id, version: 1 },
    justification: 'Freeze for build (test).',
    data_class: 'synthetic' as const,
  };
  let frozen = await s.store.freezeSpec(owner, s.ws.id, runId, f);
  if (frozen.status !== 'frozen') {
    await approve(frozen.admission.decision_id!);
    frozen = await s.store.freezeSpec(owner, s.ws.id, runId, f);
  }
  assert.equal(frozen.status, 'frozen', frozen.admission.explanation);
  return {
    runId,
    problem,
    evidence,
    alts,
    build,
    selection,
    spec,
    freeze: frozen.freeze!,
  };
}

test('a project report is built from the records, with access, fixture labels and money from the budget', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const store = new ProjectReportStore(s.db.pool);
  const { problem, evidence, alts, build, selection, spec, freeze } =
    await project(s);
  // A claim that backs one option (not the problem) is listed with that option named.
  const problemNow = await s.store.getEntity(owner, s.ws.id, problem.id);
  const optionClaim = evidence.find(
    (e) => !problemNow.incoming.some((l) => l.from.id === e.id),
  )!;
  await s.store.createLink(owner, s.ws.id, {
    relation: 'supports',
    from: optionClaim,
    to: { id: build.id, version: build.version },
    rationale: 'Backs the build option (test).',
  });

  // One build record (a failed QA case) with feedback, as the build supervisor would leave it.
  const artifact = await s.store.createEntity(owner, s.ws.id, {
    kind: 'artifact',
    title: 'Word tally package',
    body: {
      storage_uri: 'fixture://word-tally',
      sha256: sha('pkg'),
      bytes: 10,
      media_type: 'application/x-tar',
    },
  });
  const manifestId = randomUUID();
  await s.db.pool.query(
    `insert into artifact_manifests (id, workspace_id, entity_id, product_id, spec_id,
       spec_version, freeze_id, commit, state, manifest, manifest_sha256, archive_sha256,
       created_by)
     values ($1,$2,$3,$4,$5,1,$6,$7,'failed',$8,$9,$10,$11)`,
    [
      manifestId,
      s.ws.id,
      artifact.id,
      randomUUID(),
      spec.spec.id,
      freeze.id,
      'a'.repeat(40),
      {
        build: { calls: 3, repairs: 1, fixture_roles: true },
        toolchain: { recipe: 'python-cli/1' },
        tests: {
          build_qa: [
            { check_key: 'A1', passed: true, reason: null },
            {
              check_key: 'A2',
              passed: false,
              reason: 'Expected 3 words, got 2 (test).',
            },
          ],
          package: [{ check_key: 'A1', passed: true, reason: null }],
        },
        costs: { settled_nano_usd: '0', unsettled_attempts: 0 },
        limitations: ['Counts ASCII words only (test).'],
      },
      sha(manifestId),
      sha('archive'),
      owner.actorId,
    ],
  );

  const before = (
    await s.db.pool.query('select count(*)::int as n from audit_events')
  ).rows[0].n;
  const out = await store.projectReport(owner, s.ws.id);
  const md = out.markdown;
  assert.match(out.name, /^discovery-report-\d{4}-\d{2}-\d{2}\.md$/);

  // Fixture data is labelled.
  assert.match(
    md,
    /\*\*Fixture workspace\.\*\* Every record in this report is synthetic/,
  );
  assert.match(md, /fixture \(synthetic\) record/);
  assert.ok(
    md.includes(
      `**Supporting claim** for the option “${build.title.slice(0, 30)}`,
    ),
    'option claim listed with its option',
  );
  assert.ok(md.includes(optionClaim.id.slice(0, 8)));
  // Problem and affected users.
  const p = await s.store.getEntity(owner, s.ws.id, problem.id);
  assert.ok(md.includes(String(p.entity.body!.affected_group).slice(0, 30)));
  // Every listed source line carries its URL; quotes appear with their source and locator.
  const claimLines = md
    .split('\n')
    .filter((l) => /^ {2}- .*\(source [0-9a-f]{8} v\d+;/.test(l));
  assert.ok(claimLines.length > 0, 'claims with sources are listed');
  for (const l of claimLines) assert.match(l, /<https?:\/\/[^>]+>/);
  assert.ok(
    claimLines.some((l) => /paragraph \d+, characters \d+–\d+\) — “/.test(l)),
    'at least one quote carries its passage locator',
  );
  // Every option appears, the rejected and recommended ones too, with the selection's reasons.
  for (const a of alts) assert.ok(md.includes(a.title.slice(0, 20)), a.title);
  const dispositions = selection.dispositions.map((d) => d.disposition);
  assert.ok(dispositions.length > 1);
  assert.match(md, /selected for a build\. Reasons: /);
  assert.match(md, /Would change if: /);
  assert.match(md, /Override of the ranking: Reminders are recommended too/);
  // Dissent from the humility review.
  assert.match(
    md,
    /Dissent: A front-desk lead thinks reminders alone would do/,
  );
  // People's decisions and interventions, and only people's.
  assert.match(
    md,
    /Owner \(person\): Answered a request \(authorization\): Allow candidate\.select/,
  );
  assert.match(md, /Owner \(person\): Recorded a selection for problem/);
  assert.match(
    md,
    /Owner \(person\): Froze spec Word tally \(synthetic\) version 1/,
  );
  // The frozen spec, its checks counted, held-out cases never shown.
  assert.match(
    md,
    new RegExp(`Frozen: version 1 on .* content hash ${freeze.content_hash}`),
  );
  assert.match(md, /held out \(not shown\)/);
  assert.doesNotMatch(md, /only-held-out-line-zq7/);
  // The build with its QA result, failure reason, limitation and fixture roles.
  assert.match(md, /### Build [0-9a-f]{8} — failed/);
  assert.match(
    md,
    /QA \(frozen cases, including held-out ones\): 1 of 2 passed/,
  );
  assert.match(md, /Failed A2: Expected 3 words, got 2 \(test\)\./);
  assert.match(md, /fixture roles \(no model wrote this code\)/);
  assert.match(md, /Limitation: Counts ASCII words only/);

  // Money matches the budget records exactly.
  const money = (
    await s.db.pool.query(
      `select count(*)::int as n,
          coalesce(sum(incurred_nano) filter (where status = 'settled'), 0)::text as settled
         from budget_reservations where workspace_id = $1`,
      [s.ws.id],
    )
  ).rows[0];
  assert.ok(money.n > 0, 'the fixture discovery made paid-request attempts');
  assert.match(md, new RegExp(`- Paid-request attempts: ${money.n} \\(`));
  const settled = BigInt(money.settled);
  const dollars = `${settled / 1_000_000_000n}.${(settled % 1_000_000_000n).toString().padStart(9, '0')}`;
  assert.ok(md.includes(`- Settled spend: $${dollars}`), dollars);
  assert.match(
    md,
    /\| Owner budget \| global \| active \| \$100\.000000000 \|/,
  );

  // Reading changed nothing.
  const after = (
    await s.db.pool.query('select count(*)::int as n from audit_events')
  ).rows[0].n;
  assert.equal(after, before);

  // Access is the workspace's own: a viewer reads it, a stranger learns nothing.
  const viewer = { actorId: randomUUID() };
  const stranger = { actorId: randomUUID() };
  for (const a of [viewer, stranger])
    await s.store.ensureActor({
      id: a.actorId,
      kind: 'human',
      display_name: 'Someone',
    });
  await s.store.addMember(owner, s.ws.id, viewer.actorId, 'viewer');
  assert.match(
    (await store.projectReport(viewer, s.ws.id)).markdown,
    /Word tally/,
  );
  await assert.rejects(
    store.projectReport(stranger, s.ws.id),
    (e: unknown) => e instanceof ContractError && e.code === 'NOT_FOUND',
  );
  assert.ok(build.id);
});

test('project report API: a Markdown download for members, nothing else', async (t) => {
  let closeApi = async () => undefined as unknown;
  t.after(() => closeApi());
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  await project(s);
  const api = createApi({
    CREATOR_DATABASE_URL: s.db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  closeApi = api.close;
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const path = `${base}/workspaces/${s.ws.id}/project-report`;

  // Not a member yet: the workspace is not found.
  assert.equal((await fetch(path, { headers: auth.read })).status, 404);
  await s.store.addMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'viewer');
  const res = await fetch(path, { headers: auth.read });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  assert.match(
    res.headers.get('content-disposition')!,
    /^attachment; filename="discovery-report-\d{4}-\d{2}-\d{2}\.md"/,
  );
  const md = await res.text();
  assert.match(md, /^# Project report: Discovery$/m);
  assert.match(md, /## Requests and money/);
  // The report is read-only.
  const post = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...auth.write },
    body: '{}',
  });
  assert.equal(post.status, 404);
});
