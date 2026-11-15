import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  CREDITS_OFF_STATEMENT,
  ContractError,
  SPEC_DRAFT_INSTRUCTIONS,
  SpecDraftedMarkSchema,
  heldOutOf,
  type ErrorCode,
  type SelectRequest,
  type SpecContent,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  canonicalHash,
  fixtureDispositions,
  fixtureHumilityReview,
  fixtureScorecards,
} from '@creator/domain';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { freshDatabase } from './pg-harness.js';
import { FixtureAdapter, PlanConnectionService } from '@creator/broker';
import { discoverySetup, owner } from './discovery-harness.js';
import { FAKE_MODEL as MODEL, connect, fakeHost } from './proposal-harness.js';
import { SUBSCRIBED, fakeCalls, setFake } from './claude-fake.js';

// ADR-0107 (B2) on PostgreSQL: Draft the spec, Add an edge case and Explain this case on
// Build › Write a spec. Drafts go only to a model qualified on spec-cases-v2, only for the
// option the current selection chose for build, only at the owner's press; each is one
// specification task outside any run. Nothing in a spec changes until the person saves it, and
// a saved spec records which drafts went into it, whether they were edited and whether the
// held-out pick is still the studio's.

const rejects = (code: ErrorCode, p: Promise<unknown>, detail?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(
      e.code,
      code,
      `${e.code}: ${e.message} ${e.details.join(' | ')}`,
    );
    if (detail) assert.match([e.message, ...e.details].join(' | '), detail);
    return true;
  });
const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;
const bench = (name: string) =>
  JSON.parse(
    readFileSync(
      new URL(
        `../../config/connections/benchmarks/${name}.json`,
        import.meta.url,
      ),
      'utf8',
    ),
  ) as Record<string, unknown>;

const cliCase = (stdin: string, stdout: string) => ({
  args: [],
  stdin,
  stdout,
  exit_code: 0,
});
const SPEC_REPLY = JSON.stringify({
  title: 'No-show flag tool',
  notes: 'Assumed one appointment per line.',
  spec: {
    audience: 'Clinic front desk',
    problem_statement: 'Front desks need to see likely no-shows.',
    user_flows: [{ key: 'F1', name: 'Flag', steps: ['Paste the list'] }],
    scope: ['Flags lines with two or more past no-shows'],
    non_goals: ['Sending reminders'],
    acceptance_checks: [
      {
        key: 'A1',
        flow: 'F1',
        statement: 'Flags repeat no-shows',
        measure: 'Exact output',
        method: 'automated_test',
        cases: [
          cliCase('ann 2\n', 'ann FLAG\n'),
          cliCase('bob 0\n', 'bob\n'),
          cliCase('', ''),
        ],
      },
      {
        key: 'A2',
        statement: 'Rejects bad lines',
        measure: 'Exit code',
        method: 'automated_test',
        cases: [
          { args: [], stdin: 'x\n', stdout: 'line 1: invalid\n', exit_code: 1 },
          {
            args: [],
            stdin: 'a b c\n',
            stdout: 'line 1: invalid\n',
            exit_code: 1,
          },
        ],
      },
    ],
    risks: [],
    tasks: [
      {
        key: 'T1',
        title: 'Write the tool',
        role: 'builder',
        file_scope: ['src'],
        depends_on: [],
        acceptance: ['A1', 'A2'],
        deliverable: 'src/main.py',
      },
    ],
  },
});
const EDGE_REPLY = JSON.stringify({
  case: { args: [], stdin: 'cy 10\n', stdout: 'cy FLAG\n', exit_code: 0 },
  why: 'Two digits of no-shows.',
});
const EXPLAIN_REPLY = JSON.stringify({
  explanation: 'Ann missed two visits, so the line is flagged.',
});

test('spec drafts: qualified route only, owner press only, one specification task each; replies are drafts and saved specs carry an honest mark', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  // A clinic discovery, scored, with the build option selected for build.
  const { detail, runId, seeded } = await s.discover(software);
  const problem = detail.workflow.result!.discovery!.catalog_records.problem!;
  const evidence = seeded.evidence.map((e) => ({ id: e.claim_id, version: 1 }));
  const first = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const alts = first.suitability.candidates.map((c) => c.alternative);
  for (const card of fixtureScorecards(alts, evidence))
    await s.store.recordScorecard(owner, s.ws.id, card);
  const build = alts.find((a) => a.kind === 'build')!;
  const tool = alts.find((a) => a.kind === 'use_existing')!;
  await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review: no-show flags',
    body: fixtureHumilityReview(
      { id: build.id, version: build.version },
      evidence,
    ),
  });
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const req: SelectRequest = {
    problem: { id: report.problem.id, version: report.problem.version },
    report_hash: report.report_hash,
    dispositions: fixtureDispositions(report),
    override_reason:
      'Reminders are recommended too; no coordinator is funded this quarter (test).',
    rationale: 'Test selection.',
    shortlist_size: 3,
    data_class: 'synthetic',
  };
  const asked = await s.store.select(owner, s.ws.id, runId, req);
  const decision = await s.store.getDecision(
    owner,
    s.ws.id,
    asked.admission.decision_id!,
  );
  await s.store.answerDecision(owner, s.ws.id, decision.id, {
    choice: 'approve_once',
    option_id: null,
    rationale: 'Approved for this exact version (test).',
    coverage_hash: decision.coverage.coverage_hash,
    standing_expires_at: null,
    time_spent_ms: null,
    interruption: null,
  });
  const selection = (await s.store.select(owner, s.ws.id, runId, req))
    .selection!;

  const store = new ConnectionStore(s.db.pool);
  const host = fakeHost(SPEC_REPLY);
  const service = new PlanConnectionService({
    store,
    vault: null,
    claudeCode: host,
    claudeCodeFixtureEnv: { CREATOR_CLAUDE_STAND_IN: 'fake' },
  });
  const conn = await connect(store, s.ws.id, service);
  const runs = () =>
    fakeCalls(host.config_dir).filter((x) => x.args[0] === '-p');
  const reply = (text: string) =>
    setFake(host.config_dir, { status: SUBSCRIBED, text });
  const alternative = { id: build.id, version: build.version };
  const ask = (who: CommandContext, over: Record<string, unknown> = {}) =>
    service.specDraft(who, s.ws.id, {
      client_id: randomUUID(),
      kind: 'spec',
      selection_id: selection.id,
      alternative,
      product: 'cli',
      connection_id: conn.id,
      model_id: MODEL,
      check: null,
      case_index: null,
      ...over,
    });
  const qualify = async (
    manifest: Record<string, unknown>,
    floor = { numerator: 1, denominator: 1 },
  ) =>
    s.db.pool.query(
      `insert into plan_qualifications (id,connection_id,model_id,task_class,manifest,manifest_hash,min_held_out_cases,floor,state,development,held_out,created_by,decided_at)
       values ($1,$2,$3,'specification',$4,$5,5,$6,'qualified',$7,$7,$8,clock_timestamp())`,
      [
        randomUUID(),
        conn.id,
        MODEL,
        JSON.stringify(manifest),
        canonicalHash(manifest),
        JSON.stringify(floor),
        JSON.stringify({ total: 5, passed: 5 }),
        owner.actorId,
      ],
    );
  const before = runs().length;

  // Not qualified: no route, and a press is refused before anything is recorded or sent.
  assert.deepEqual((await store.specDraftRoutes(owner, s.ws.id)).routes, []);
  await rejects(
    'ACCESS_DENIED',
    ask(owner),
    /not qualified for drafting specs/,
  );
  // The older acceptance-check labelling benchmark does not admit drafts.
  await qualify(bench('specification-synthetic-v1'));
  assert.deepEqual((await store.specDraftRoutes(owner, s.ws.id)).routes, []);
  await rejects('ACCESS_DENIED', ask(owner), /spec-cases-v2/);
  // Review 1 of PR #206, L-1: a hand-made manifest with a weaker bar never admits, even with
  // the exact instructions and inputs.
  const weak = bench('spec-cases-v2') as { cases: Record<string, any>[] };
  weak.cases = weak.cases.slice(0, 2).map((c) => ({
    ...c,
    check: { ...c.check, mutants: c.check.mutants.slice(0, 1), min_caught: 1 },
  }));
  await qualify(weak);
  assert.deepEqual((await store.specDraftRoutes(owner, s.ws.id)).routes, []);
  // Review 2 of PR #206, L-1: nor does the bundled file under a lowered pass bar.
  await qualify(bench('spec-cases-v2'), { numerator: 0, denominator: 1 });
  assert.deepEqual((await store.specDraftRoutes(owner, s.ws.id)).routes, []);
  await qualify(bench('spec-cases-v2'));
  // L-3: drafting is for command-line programs only.
  await rejects(
    'INVALID_CONTRACT',
    ask(owner, { product: 'web' }),
    /command-line programs only/,
  );
  // N-2: a connection that does not allow specification work or the selection's data class
  // is not listed, and a press there is refused in words before anything is recorded.
  const settings = async (sql: string) =>
    s.db.pool.query(
      `update plan_connections set settings = ${sql} where id = $1`,
      [conn.id],
    );
  await settings(
    `jsonb_set(settings, '{allowed_task_classes}', (settings->'allowed_task_classes') - 'specification')`,
  );
  assert.deepEqual((await store.specDraftRoutes(owner, s.ws.id)).routes, []);
  await rejects(
    'ACCESS_DENIED',
    ask(owner),
    /does not allow specification work/,
  );
  await settings(
    `jsonb_set(settings, '{allowed_task_classes}', (settings->'allowed_task_classes') || '["specification"]')`,
  );
  await settings(
    `jsonb_set(settings, '{allowed_data_classes}', (settings->'allowed_data_classes') - 'synthetic')`,
  );
  assert.equal(
    (await store.specDraftRoutes(owner, s.ws.id)).routes.length,
    1,
    'without a selection the data class is not known',
  );
  assert.deepEqual(
    (await store.specDraftRoutes(owner, s.ws.id, selection.id)).routes,
    [],
  );
  await rejects('ACCESS_DENIED', ask(owner), /does not allow synthetic data/);
  await settings(
    `jsonb_set(settings, '{allowed_data_classes}', (settings->'allowed_data_classes') || '["synthetic"]')`,
  );
  assert.deepEqual(
    (await store.specDraftRoutes(owner, s.ws.id, selection.id)).routes.map(
      (r) => [r.connection_id, r.model_id],
    ),
    [[conn.id, MODEL]],
  );
  assert.deepEqual(
    (await store.specDraftRoutes(owner, s.ws.id)).routes.map((r) => [
      r.connection_id,
      r.model_id,
    ]),
    [[conn.id, MODEL]],
  );
  // Only the owner asks, and only for the option the selection chose for build.
  const editor: CommandContext = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'editor',
  });
  await s.store.addMember(owner, s.ws.id, editor.actorId, 'editor');
  await rejects('ACCESS_DENIED', ask(editor));
  await rejects(
    'INVALID_TRANSITION',
    ask(owner, { alternative: { id: tool.id, version: tool.version } }),
    /did not choose this option version for build/,
  );
  await rejects(
    'INVALID_TRANSITION',
    ask(owner, {
      alternative: { ...alternative, version: alternative.version + 1 },
    }),
  );
  assert.equal(runs().length, before, 'nothing was sent');
  assert.deepEqual(await store.listSpecDrafts(owner, s.ws.id, build.id), []);

  // A whole-spec draft: one specification task, outside any run, under the fixed instructions.
  const cid = randomUUID();
  const spec = await ask(owner, { client_id: cid });
  assert.equal(spec.state, 'completed', spec.reason ?? '');
  assert.equal(runs().length, before + 1);
  const sent = runs().at(-1)!;
  assert.equal(sent.system, SPEC_DRAFT_INSTRUCTIONS);
  assert.equal(sent.stdin, spec.sent?.input);
  assert.match(spec.sent?.input ?? '', /<task>draft_spec<\/task>/);
  const pr = (
    await s.db.pool.query(
      `select r.purpose, r.task_class, r.run_id, r.data_class from plan_requests r
         join spec_drafts d on d.plan_request_id = r.id where d.id = $1`,
      [spec.id],
    )
  ).rows[0];
  assert.deepEqual(pr, {
    purpose: 'task',
    task_class: 'specification',
    run_id: null,
    data_class: 'synthetic',
  });
  assert.equal(spec.result?.kind, 'spec');
  if (spec.result?.kind !== 'spec') return;
  const drafted = spec.result.content;
  // The studio picked the held-out cases: one from each check (three and two cases).
  assert.equal(spec.result.picks.length, 2);
  assert.deepEqual(heldOutOf(drafted), spec.result.picks);
  // The empty-output case is named in plain words; nothing is an error.
  assert.ok(spec.problems.some((p) => p.code === 'no_output'));
  assert.equal(
    spec.problems.some((p) => p.level === 'error'),
    false,
  );
  // A retried press returns the same draft and sends nothing.
  assert.equal((await ask(owner, { client_id: cid })).id, spec.id);
  assert.equal(runs().length, before + 1);

  // The draft's own request is the only one it covers, and only once.
  const admit = (op: string, who: CommandContext = owner) =>
    store.admitPlanRequest(
      who,
      s.ws.id,
      {
        connection_id: conn.id,
        logical_operation_id: op,
        path: 'responses',
        purpose: 'task',
        model_id: MODEL,
        task_class: 'specification',
        data_class: 'synthetic',
        run_id: null,
        build_id: null,
        grant_id: null,
        qualification_id: null,
        input_chars: 10,
      },
      undefined,
      undefined,
      undefined,
      undefined,
      { draft_id: spec.id },
    );
  await rejects(
    'ACCESS_DENIED',
    admit(randomUUID()),
    /already made its request/,
  );
  await rejects(
    'ACCESS_DENIED',
    admit(randomUUID()),
    /not this draft’s own request/,
  );

  // An edge case for A1, as the form has it now, and an explanation of its first case.
  const a1 = drafted.acceptance_checks[0]!;
  const check = {
    key: a1.key,
    statement: a1.statement,
    measure: a1.measure,
    method: 'automated_test' as const,
    cases: a1.cases!,
    browser_cases: [],
    scope: drafted.scope,
  };
  reply(EDGE_REPLY);
  const edge = await ask(owner, { kind: 'edge_case', check });
  assert.equal(edge.result?.kind, 'edge_case', edge.reason ?? '');
  if (edge.result?.kind !== 'edge_case') return;
  assert.equal(edge.result.check, 'A1');
  assert.match(edge.sent?.input ?? '', /<task>edge_case<\/task>/);
  reply(EXPLAIN_REPLY);
  const explained = await ask(owner, {
    kind: 'explain_case',
    check,
    case_index: 0,
  });
  assert.equal(explained.result?.kind, 'explain_case');
  // A reply that is not the asked JSON is kept as a failed read, with the reason in words.
  reply('Sure! Here is a spec.');
  const unread = await ask(owner);
  assert.equal(unread.state, 'completed');
  assert.equal(unread.result, null);
  assert.match(unread.reason ?? '', /not the JSON the studio asked for/);
  assert.equal(
    (await store.listSpecDrafts(owner, s.ws.id, build.id)).length,
    4,
  );

  // Saving: the mark names the drafts; an explanation or a failed read cannot be named.
  const save = (content: SpecContent, draft_ids?: string[]) =>
    s.store.createSpec(owner, s.ws.id, {
      selection_id: selection.id,
      alternative,
      title: 'No-show flag tool',
      content,
      ...(draft_ids ? { draft_ids } : {}),
    });
  for (const bad of [explained.id, unread.id, randomUUID()])
    await rejects(
      'INVALID_CONTRACT',
      save(drafted, [spec.id, bad]),
      /cannot be recorded with it/,
    );
  const created = await save(drafted, [spec.id]);
  const mark = (body: unknown) =>
    SpecDraftedMarkSchema.parse((body as { drafted?: unknown }).drafted);
  const entity = async () =>
    (await s.store.getEntity(owner, s.ws.id, created.spec.id)).entity.body;
  assert.deepEqual(mark(await entity()), {
    drafts: [{ id: spec.id, kind: 'spec', model_id: MODEL }],
    edited: false,
    held_out: 'studio_pick',
  });
  // A revision adding the suggested edge case as it was suggested is not an edit.
  const withEdge = structuredClone(drafted);
  withEdge.acceptance_checks[0]!.cases!.push({
    ...edge.result.case!,
    held_out: false,
  });
  const revise = (
    content: SpecContent,
    version: number,
    draft_ids?: string[],
  ) =>
    s.store.reviseSpec(owner, s.ws.id, created.spec.id, {
      expected_version: version,
      title: 'No-show flag tool',
      content,
      reason: 'Used the model drafts (test).',
      ...(draft_ids ? { draft_ids } : {}),
    });
  await revise(withEdge, 1, [edge.id]);
  assert.deepEqual(mark(await entity()), {
    drafts: [
      { id: spec.id, kind: 'spec', model_id: MODEL },
      { id: edge.id, kind: 'edge_case', model_id: MODEL },
    ],
    edited: false,
    held_out: 'studio_pick',
  });
  // A later revision that moves the held-out pick and changes an output says so, without
  // naming any draft again.
  const changed = structuredClone(withEdge);
  for (const a of changed.acceptance_checks)
    for (const x of a.cases ?? []) x.held_out = !x.held_out;
  changed.acceptance_checks[1]!.cases![0]!.stdout = 'line 1: not valid\n';
  await revise(changed, 2);
  const last = mark(await entity());
  assert.deepEqual(
    [last.edited, last.held_out, last.drafts.length],
    [true, 'changed', 2],
  );
  // A spec written without drafts carries no mark.
  const plain = await s.store.createSpec(owner, s.ws.id, {
    selection_id: selection.id,
    alternative,
    title: 'Written by hand',
    content: drafted,
  });
  assert.equal(
    (
      (await s.store.getEntity(owner, s.ws.id, plain.spec.id)).entity.body as {
        drafted?: unknown;
      }
    ).drafted,
    undefined,
  );

  // Redacting the option clears every draft's words; the outcomes stay.
  const alt = await s.store.getEntity(owner, s.ws.id, build.id);
  await s.store.redactEntity(owner, s.ws.id, build.id, {
    expected_version: alt.entity.version,
    reason_code: 'owner_request',
  });
  const after = await store.listSpecDrafts(owner, s.ws.id, build.id);
  assert.equal(after.length, 4);
  for (const d of after) {
    assert.equal(d.result, null);
    assert.equal(d.sent, null);
    assert.deepEqual(d.problems, []);
  }
  const words = await s.db.pool.query(
    `select count(*)::int as n from spec_drafts
      where id = any($1::uuid[]) and (input <> '' or coalesce(text, '') <> '' or result is not null)`,
    [after.map((d) => d.id)],
  );
  assert.equal(words.rows[0].n, 0);
});

test('review 2 of PR #206, L-1: a start of spec-cases-v2 runs under the server’s pass bar, whatever the request asked for', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  const w = await store.createWorkspace(owner, {
    name: 'B2 real',
    record_mode: 'real',
  });
  let c = await store.createPlanConnection(owner, w.id, {
    label: 'ChatGPT plan',
    settings: JSON.parse(
      readFileSync(
        new URL('../../config/connections/chatgpt-plan.json', import.meta.url),
        'utf8',
      ),
    ),
  });
  await store.attestPlanCredits(owner, w.id, c.id, {
    expected_version: c.version,
    statement: CREDITS_OFF_STATEMENT,
    checked_on: '2026-11-15',
  });
  c = (await store.planConnectionDetail(owner, w.id, c.id)).connection;
  c = await store.acceptPlanCaps(owner, w.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  await db.pool.query(
    `insert into plan_model_access (connection_id, model_id, path, access, request_id)
     values ($1, 'm', 'responses', 'verified', $2)`,
    [c.id, randomUUID()],
  );
  // Every one of the five held-out programs must pass, even when a start asks for 0 of 1.
  const started = await store.startPlanQualification(owner, w.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    manifest: bench('spec-cases-v2'),
    min_held_out_cases: 3,
    floor: { numerator: 0, denominator: 1 },
  });
  assert.equal(started.min_held_out_cases, 5);
  assert.deepEqual(started.floor, { numerator: 1, denominator: 1 });
  // Other benchmarks keep the bar their start asked for.
  const other = await store.startPlanQualification(owner, w.id, c.id, {
    expected_version: (await store.planConnectionDetail(owner, w.id, c.id))
      .connection.version,
    model_id: 'm',
    manifest: bench('summarization-synthetic-v1'),
    min_held_out_cases: 3,
    floor: { numerator: 2, denominator: 3 },
  });
  assert.equal(other.min_held_out_cases, 3);
  assert.deepEqual(other.floor, { numerator: 2, denominator: 3 });
  const version = async () =>
    (await store.planConnectionDetail(owner, w.id, c.id)).connection.version;
  const start = async (manifest: Record<string, unknown>) =>
    store.startPlanQualification(owner, w.id, c.id, {
      expected_version: await version(),
      model_id: 'm',
      manifest: manifest as never,
      min_held_out_cases: 5,
      floor: { numerator: 1, denominator: 1 },
    });
  // Review 1 of PR #210, N-1: a hand-made start of the frozen v1 file, or of any copy that is
  // not the bundled file, is refused before it spends a request.
  const v1 = bench('spec-cases-v1');
  await assert.rejects(
    start(v1),
    /spec-cases-v1 is kept as it ran; qualify on spec-cases-v2/,
  );
  const copy = bench('spec-cases-v2');
  copy.name = 'spec-cases-mine';
  await assert.rejects(start(copy), /only on the bundled spec-cases-v2 file/);
  // Review 1 of PR #210, L-1: v2 reuses v1's held-out cases under a new prompt, so a view of
  // v1's held-out results (ADR-0052) refuses a v2 start; with no view it went ahead above.
  const v1Id = randomUUID();
  await db.pool.query(
    `insert into plan_qualifications (id,connection_id,model_id,task_class,manifest,manifest_hash,min_held_out_cases,floor,state,development,held_out,created_by,decided_at)
     values ($1,$2,'m','specification',$3,$4,5,$5,'failed',$6,$6,$7,clock_timestamp())`,
    [
      v1Id,
      c.id,
      JSON.stringify(v1),
      canonicalHash(v1),
      JSON.stringify({ numerator: 1, denominator: 1 }),
      JSON.stringify({ total: 5, passed: 0 }),
      owner.actorId,
    ],
  );
  await db.pool.query(
    `insert into plan_connection_events (id, connection_id, kind, body, actor_id)
     values ($1,$2,'qualification_held_out_viewed',$3,$4)`,
    [
      randomUUID(),
      c.id,
      { qualification_id: v1Id, task_class: 'specification' },
      owner.actorId,
    ],
  );
  await assert.rejects(
    start(bench('spec-cases-v2')),
    /5 held-out cases were viewed .* \(ADR-0052\)/,
  );
});
