import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  PROPOSAL_DRAFT_INSTRUCTIONS,
  proposalDraftInput,
  readSectionDrafts,
  type ErrorCode,
  type ProposalBody,
} from '@creator/contracts';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { FixtureAdapter, PlanConnectionService } from '@creator/broker';
import { discoverySetup, owner } from './discovery-harness.js';
import {
  FAKE_MODEL as MODEL,
  connect,
  fakeHost,
  filled,
  nonCodeSelected,
} from './proposal-harness.js';
import { fakeCalls } from './claude-fake.js';

// UX pass P-2 and P-5 (ADR-0101) on PostgreSQL: the overview says where the newest selection
// sends the path, and "Draft the missing sections" asks the chat model (a fake `claude`) for
// model drafts that change nothing until a person uses them and saves a new version.

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

test('draft replies: only asked plan sections are read; unknown notes are kept; the rest is dropped', () => {
  const got = readSectionDrafts(
    '```json\n' +
      JSON.stringify({
        sections: {
          methods: { text: '  Suggested: turn on reminders. ' },
          ethics_risks: { unknown: 'Who may see patient phone numbers.' },
          evidence: { text: 'Invented evidence' },
          costs: { text: '$500' },
          roles: { text: '' },
          objectives: 'Suggested: fewer no-shows.',
          timeline: { text: 'x'.repeat(3001) },
        },
      }) +
      '\n```',
    ['methods', 'ethics_risks', 'roles', 'objectives', 'timeline'],
  );
  assert.deepEqual(got.values, {
    methods: { state: 'written', text: 'Suggested: turn on reminders.' },
    ethics_risks: {
      state: 'unknown',
      text: 'Who may see patient phone numbers.',
    },
    objectives: { state: 'written', text: 'Suggested: fewer no-shows.' },
  });
  // evidence and costs are never drafted; an empty and a too-long text are dropped, not cut.
  assert.equal(got.dropped, 4);
  assert.equal(readSectionDrafts('Sure!', ['methods']).readable, false);
  assert.equal(
    readSectionDrafts('{"values": {"methods": "x"}}', ['methods']).readable,
    false,
  );
});

test('draft input: record text is escaped, and written sections drop longest first to fit', () => {
  const base = {
    title: 'Turn on <reminders>',
    summary: 'Use the reminder tool.',
    problem_title: 'No-shows',
    response: 'use existing',
    option_title: 'Reminder tool',
    references: [{ label: 'R1', statement: 'Clinics see 20% no-shows.' }],
    asked: ['methods', 'objectives'] as const,
  };
  const wide = proposalDraftInput({
    ...base,
    written: [
      { key: 'problem_users', text: 'Patients miss slots.' },
      { key: 'background', text: 'long '.repeat(200) },
    ],
    maxChars: 50_000,
  })!;
  assert.match(wide.input, /Turn on &lt;reminders&gt;/);
  assert.match(wide.input, /\[R1\] Clinics see 20% no-shows\./);
  assert.match(wide.input, /key: methods \(Methods and step-by-step procedure/);
  assert.equal(wide.sections_sent, 2);
  const tight = proposalDraftInput({
    ...base,
    written: [
      { key: 'problem_users', text: 'Patients miss slots.' },
      { key: 'background', text: 'long '.repeat(200) },
    ],
    maxChars: 900,
  })!;
  assert.equal(tight.sections_sent, 1);
  assert.doesNotMatch(tight.input, /long long/);
  assert.match(tight.input, /Patients miss slots/);
  assert.equal(
    proposalDraftInput({ ...base, written: [], maxChars: 100 }),
    null,
  );
});

const REPLY = JSON.stringify({
  sections: {
    objectives: { text: 'Suggested: fewer missed appointments [R1].' },
    methods: { text: 'Suggested: turn on SMS reminders 48 hours ahead.' },
    ethics_risks: { unknown: 'Who may see patient phone numbers.' },
    evidence: { text: 'Made-up evidence.' },
  },
});

test('the overview says where the newest selection sends the path, and the proposal stage moves with it (P-2)', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const none = await s.store.overview(owner, s.ws.id);
  assert.deepEqual(none.selections, { count: 0, latest: null });
  const { tool, selection } = await nonCodeSelected(s);
  const chosen = await s.store.overview(owner, s.ws.id);
  assert.equal(chosen.selections.count, 1);
  assert.equal(chosen.selections.latest?.id, selection.id);
  assert.equal(chosen.selections.latest?.route, 'non_code');
  assert.equal(chosen.selections.latest?.proposal, null);
  const draft = await s.store.proposalDraft(owner, s.ws.id, tool.id);
  const v1 = await s.store.createProposal(owner, s.ws.id, {
    title: draft.title,
    body: draft.body,
  });
  const p1 = (await s.store.overview(owner, s.ws.id)).selections.latest
    ?.proposal;
  assert.equal(p1?.id, v1.proposal.id);
  assert.equal(
    p1?.unknown_core,
    5,
    'objectives, methods, testing, ethics and next tasks',
  );
  assert.equal(p1?.reviewed, false);
  const v2 = await s.store.reviseProposal(owner, s.ws.id, v1.proposal.id, {
    expected_version: 1,
    title: draft.title,
    body: filled(draft.body),
    reason: 'Filled in (test).',
  });
  const review = (verdict: 'ready' | 'revise') =>
    s.store.reviewProposal(owner, s.ws.id, v2.proposal.id, {
      version: 2,
      content_hash: v2.proposal.content_hash,
      verdict,
      marks: {
        completeness: 'pass',
        citation_fidelity: 'pass',
        feasibility: 'pass',
        access: 'pass',
      },
      comments: verdict === 'revise' ? 'Tighten the timeline (test).' : '',
    });
  await review('revise');
  const asked = (await s.store.overview(owner, s.ws.id)).selections.latest
    ?.proposal;
  assert.equal(asked?.unknown_core, 0);
  assert.deepEqual([asked?.reviewed, asked?.revise], [false, true]);
  // The newest review of the current version counts.
  await review('ready');
  const ready = (await s.store.overview(owner, s.ws.id)).selections.latest
    ?.proposal;
  assert.deepEqual([ready?.reviewed, ready?.revise], [true, false]);
  // An archived problem's selection no longer counts.
  await s.store.archiveEntity(owner, s.ws.id, selection.problem.id, {
    expected_version: selection.problem.version,
    reason: 'Done with it (test).',
  });
  assert.deepEqual((await s.store.overview(owner, s.ws.id)).selections, {
    count: 0,
    latest: null,
  });
});

test('draft the missing sections: owner and chat rules, drafts only, marks checked by the studio, redaction clears words (P-5)', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const store = new ConnectionStore(s.db.pool);
  const host = fakeHost(REPLY);
  const service = new PlanConnectionService({
    store,
    vault: null,
    claudeCode: host,
    claudeCodeFixtureEnv: { CREATOR_CLAUDE_STAND_IN: 'fake' },
  });
  const conn = await connect(store, s.ws.id, service);
  const runs = () =>
    fakeCalls(host.config_dir).filter((x) => x.args[0] === '-p');
  const { tool } = await nonCodeSelected(s);
  const start = await store.proposalDraft(owner, s.ws.id, tool.id);
  const v1 = await store.createProposal(owner, s.ws.id, {
    title: 'Turn on <reminders>',
    body: start.body,
  });
  const pid = v1.proposal.id;
  const draft = (who: CommandContext, over: Record<string, unknown> = {}) =>
    service.proposalSectionDraft(who, s.ws.id, pid, {
      client_id: randomUUID(),
      version: 1,
      sections: ['objectives', 'methods', 'ethics_risks'],
      ...over,
    });
  const before = runs().length;

  // Drafting uses the owner's chat model: off means refused before anything is recorded.
  await rejects('ACCESS_DENIED', draft(owner), /Chat answers are turned off/);
  await store.setChatSettings(owner, s.ws.id, {
    expected_version: 0,
    enabled: true,
    connection_id: conn.id,
    model_id: MODEL,
    include_snapshot: false,
    daily_limit: 10,
  });
  // The proposal is a studio record, so the owner's "keep studio records here" holds.
  await rejects('ACCESS_DENIED', draft(owner), /studio records/);
  await store.setChatSettings(owner, s.ws.id, {
    expected_version: 1,
    enabled: true,
    connection_id: conn.id,
    model_id: MODEL,
    include_snapshot: true,
    daily_limit: 10,
  });
  // Only an owner asks; only plan sections; only the version read; only unknown sections.
  const editor: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'editor',
  });
  await store.addMember(owner, s.ws.id, editor.actorId, 'editor');
  await rejects('ACCESS_DENIED', draft(editor));
  await rejects('INVALID_CONTRACT', draft(owner, { sections: ['evidence'] }));
  await rejects('INVALID_CONTRACT', draft(owner, { sections: ['costs'] }));
  await rejects('VERSION_CONFLICT', draft(owner, { version: 2 }));
  assert.equal(runs().length, before, 'nothing was sent');
  assert.deepEqual(
    await store.listProposalSectionDrafts(owner, s.ws.id, pid),
    [],
  );

  const cid = randomUUID();
  const done = await draft(owner, { client_id: cid });
  assert.equal(done.state, 'completed', done.reason ?? '');
  assert.deepEqual(done.values, {
    objectives: {
      state: 'written',
      text: 'Suggested: fewer missed appointments [R1].',
    },
    methods: {
      state: 'written',
      text: 'Suggested: turn on SMS reminders 48 hours ahead.',
    },
    ethics_risks: {
      state: 'unknown',
      text: 'Who may see patient phone numbers.',
    },
  });
  assert.equal(done.dropped, 1, 'evidence was not asked for');
  assert.equal(runs().length, before + 1);
  const sent = runs().at(-1)!;
  assert.equal(sent.system, PROPOSAL_DRAFT_INSTRUCTIONS);
  assert.equal(sent.stdin, done.sent?.input);
  assert.match(done.sent?.input ?? '', /Title: Turn on &lt;reminders&gt;/);
  assert.match(done.sent?.input ?? '', /\[R1\] /);
  assert.match(done.sent?.input ?? '', /key: ethics_risks/);
  // A retried press returns the same draft and sends nothing; the proposal is unchanged.
  assert.equal((await draft(owner, { client_id: cid })).id, done.id);
  assert.equal(runs().length, before + 1);
  const still = await store.proposalDetail(owner, s.ws.id, pid);
  assert.equal(still.proposal.version, 1);
  assert.equal(still.proposal.body.sections.methods.state, 'unknown');

  // Using drafts: the studio sets the model and whether the text was edited.
  const use = (body: ProposalBody): ProposalBody => ({
    ...body,
    sections: {
      ...body.sections,
      methods: {
        state: 'written',
        text: 'Suggested: turn on SMS reminders 48 hours ahead.',
        claims: [],
        draft: { id: done.id, model_id: 'someone-else', edited: true },
      },
      objectives: {
        state: 'written',
        text: 'Fewer missed appointments, as measured in [R1].',
        claims: [],
        draft: { id: done.id, model_id: MODEL, edited: false },
      },
    },
  });
  const revise = (body: ProposalBody, expected_version = 1) =>
    store.reviseProposal(owner, s.ws.id, pid, {
      expected_version,
      title: v1.proposal.title,
      body,
      reason: 'Used model drafts (test).',
    });
  // A mark must name a draft of that section for this proposal.
  const wrong = use(start.body);
  wrong.sections.ethics_risks = {
    state: 'written',
    text: 'Something.',
    claims: [],
    draft: { id: done.id, model_id: MODEL, edited: false },
  };
  await rejects(
    'INVALID_CONTRACT',
    revise(wrong),
    /not a draft of that section/,
  );
  const stray = use(start.body);
  stray.sections.methods.draft = {
    id: randomUUID(),
    model_id: MODEL,
    edited: false,
  };
  await rejects('INVALID_CONTRACT', revise(stray));
  // A new proposal has no drafts to name.
  await rejects(
    'INVALID_CONTRACT',
    store.createProposal(owner, s.ws.id, {
      title: 'Another',
      body: use(start.body),
    }),
  );
  const v2 = await revise(use(start.body));
  assert.deepEqual(v2.proposal.body.sections.methods.draft, {
    id: done.id,
    model_id: MODEL,
    edited: false,
  });
  assert.equal(v2.proposal.body.sections.objectives.draft?.edited, true);
  // The export says which text came from a model, and what is still unknown.
  const md = (await store.proposalExport(owner, s.ws.id, pid, 2)).markdown;
  assert.match(
    md,
    /_Model draft by claude-test-model, accepted by a person\._/,
  );
  assert.match(
    md,
    /_Model draft by claude-test-model, accepted by a person and edited\._/,
  );
  assert.match(md, /\*\*Unknown yet\.\*\*/);
  // Written sections are not drafted again.
  await rejects(
    'INVALID_TRANSITION',
    draft(owner, { version: 2, sections: ['methods'] }),
    /still unknown/,
  );

  // Settled drafts never change, and the audit trail holds ids and keys, never the words.
  await assert.rejects(
    s.db.pool.query(
      `update proposal_section_drafts set draft_values = '{}' where id = $1`,
      [done.id],
    ),
    /change only once/,
  );
  const audit = await s.db.pool.query(
    `select action, payload::text as p from audit_events
      where workspace_id = $1 and action like 'proposal.section_draft%' order by sequence`,
    [s.ws.id],
  );
  assert.deepEqual(
    audit.rows.map((r) => r.action),
    ['proposal.section_draft_requested', 'proposal.section_drafted'],
  );
  for (const r of audit.rows) assert.doesNotMatch(String(r.p), /SMS reminders/);

  // Redacting the proposal clears the draft's words; the record of the request stays.
  await store.redactEntity(owner, s.ws.id, pid, {
    expected_version: 2,
    reason_code: 'privacy',
  });
  const row = (
    await s.db.pool.query(
      'select input, text, draft_values, state, redacted_at from proposal_section_drafts where id = $1',
      [done.id],
    )
  ).rows[0];
  assert.equal(row.input, '');
  assert.equal(row.text, '');
  assert.deepEqual(row.draft_values, {});
  assert.equal(row.state, 'completed');
  assert.ok(row.redacted_at);
  const listed = await store.listProposalSectionDrafts(owner, s.ws.id, pid);
  assert.equal(listed[0]?.sent, null);
  assert.deepEqual(listed[0]?.values, {});
});
