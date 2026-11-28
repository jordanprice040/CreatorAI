import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import {
  ContractError,
  RunbookSummarySchema,
  type ErrorCode,
} from '@creator/contracts';
import {
  DISCOVERY_SCENARIOS,
  RUNBOOK_FIXTURE_SPEC,
  fixtureDispositions,
  fixtureHumilityReview,
  fixtureScorecards,
  readZip,
  validateRunbook,
} from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { discoverySetup, owner } from './discovery-harness.js';
import { LOGIN_CODE, login } from './pg-harness.js';

// ADR-0080 (P16): the runbook export end to end on PostgreSQL: a frozen spec and a non-code
// proposal each leave the studio as a standalone archive, by version, with nothing withheld
// material inside, and reading it changes nothing.

const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === code &&
      (!message || message.test(e.message)),
  );
const software = DISCOVERY_SCENARIOS.find((s) => s.key === 'software')!;
type Setup = NonNullable<Awaited<ReturnType<typeof discoverySetup>>>;
const text = (files: ReturnType<typeof readZip>, path: string) =>
  files.find((f) => f.path === path)!.content.toString('utf8');

/** Clinic discovery, scores, a selection that builds one option and recommends another, a spec. */
async function specced(s: Setup) {
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
  const freeze = async (version: number) => {
    const f = {
      spec: { id: spec.spec.id, version },
      justification: 'Freeze for build (test).',
      data_class: 'synthetic' as const,
    };
    const first = await s.store.freezeSpec(owner, s.ws.id, runId, f);
    if (first.status === 'frozen') return first.freeze!;
    assert.equal(first.status, 'needs_human', first.admission.explanation);
    await approve(first.admission.decision_id!);
    const done = await s.store.freezeSpec(owner, s.ws.id, runId, f);
    assert.equal(done.status, 'frozen', done.admission.explanation);
    return done.freeze!;
  };
  return { runId, problem, evidence, build, tool, selection, spec, freeze };
}

test('a spec runbook is exported by version from the records, frozen or not', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { problem, build, selection, spec, freeze, evidence } =
    await specced(s);
  const specId = spec.spec.id;

  // Before any freeze the export works and says the requirements are a draft.
  const draft = await s.store.specRunbook(owner, s.ws.id, specId);
  assert.equal(draft.manifest.freeze, null);
  assert.match(draft.manifest.warnings.join(' '), /not frozen/);
  assert.equal(draft.name, 'word-tally-synthetic-runbook-v1.zip');

  const frozen = await freeze(1);
  const out = await s.store.specRunbook(owner, s.ws.id, specId);
  const files = readZip(out.archive);
  assert.deepEqual(validateRunbook(files), []);
  const m = out.manifest;
  assert.equal(m.kind, 'software');
  assert.deepEqual(m.subject, {
    type: 'specification',
    id: specId,
    version: 1,
    content_hash: spec.spec.content_hash,
    saved_at: m.subject.saved_at,
  });
  assert.equal(m.freeze?.id, frozen.id);
  assert.equal(m.freeze?.content_hash, spec.spec.content_hash);
  assert.deepEqual(m.problem, { id: problem.id, version: problem.version });
  assert.deepEqual(m.option, { id: build.id, version: build.version });
  assert.deepEqual(m.selection, { id: selection.id, current: true });
  assert.equal(m.withheld.held_out_cases, 2);
  assert.doesNotMatch(
    files.map((f) => f.content.toString('utf8')).join('\n'),
    /only-held-out-line-zq7|"held_out"/,
  );
  // The selection's own words and the problem's linked claims are in the bundle.
  const dec = text(files, 'DECISIONS.md');
  assert.match(dec, /was selected for a build/);
  assert.match(dec, /The manual flagging pilot shows no fewer unused slots/);
  assert.match(dec, /\*\*Requirements frozen\*\*/);
  const ev = text(files, 'EVIDENCE.md');
  assert.match(ev, /\*\*\[R1\]\*\*/);
  assert.ok(evidence.some((e) => ev.includes(e.id.slice(0, 8))));
  // No humility review of the spec yet: the review of the option version it builds (written in
  // Decide) is reported as the option's, as a build admission accepts it (ADR-0138, review 1 L-4).
  assert.match(
    dec,
    /Should-this-be-software review\*\* \(review [0-9a-f]{8}, of option “[^”]+” version \d+, the version this spec builds\)/,
  );
  assert.doesNotMatch(out.manifest.warnings.join(' '), /humility/);
  // The same version exports the same bytes.
  const again = await s.store.specRunbook(owner, s.ws.id, specId, 1);
  assert.ok(again.archive.equals(out.archive));

  // A humility review of the spec is reported with the version it judged.
  await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Humility review: the spec',
    body: fixtureHumilityReview({ id: specId, version: 1 }, evidence),
  });
  const reviewed = await s.store.specRunbook(owner, s.ws.id, specId);
  assert.match(
    text(readZip(reviewed.archive), 'DECISIONS.md'),
    /Should-this-be-software review\*\* \(review [0-9a-f]{8}, of spec version 1\)/,
  );
  assert.match(
    text(readZip(reviewed.archive), 'DECISIONS.md'),
    /pre-build gate accepts this review for this spec version/,
  );
  assert.doesNotMatch(reviewed.manifest.warnings.join(' '), /humility/);

  // A revision is a new, unfrozen version; version 1 still exports as frozen.
  const content = structuredClone(RUNBOOK_FIXTURE_SPEC);
  content.scope.push('Print a usage line with --help');
  await s.store.reviseSpec(owner, s.ws.id, specId, {
    expected_version: 1,
    title: 'Word tally (synthetic)',
    content,
    reason: 'Help text requested (test).',
  });
  const v2 = await s.store.specRunbook(owner, s.ws.id, specId);
  assert.equal(v2.version, 2);
  assert.equal(v2.manifest.freeze, null);
  assert.match(
    v2.manifest.warnings.join(' '),
    /version 2 of the spec, which is not frozen \(version 1 is\)/,
  );
  // The spec's own review judged version 1, so it does not clear version 2; the review of the
  // option version both spec versions build does, as it would for a build (ADR-0138).
  assert.doesNotMatch(v2.manifest.warnings.join(' '), /humility/);
  assert.match(
    text(readZip(v2.archive), 'DECISIONS.md'),
    /of option “[^”]+” version \d+, the version this spec builds\)/,
  );
  assert.match(
    text(readZip(v2.archive), 'REQUIREMENTS.md'),
    /Print a usage line/,
  );
  const v1 = await s.store.specRunbook(owner, s.ws.id, specId, 1);
  assert.equal(v1.manifest.freeze?.id, frozen.id);
  assert.doesNotMatch(
    text(readZip(v1.archive), 'REQUIREMENTS.md'),
    /Print a usage line/,
  );
  await rejects('NOT_FOUND', s.store.specRunbook(owner, s.ws.id, specId, 9));

  // A task plan that cannot be ordered is refused with the reason.
  const broken = structuredClone(content);
  broken.tasks[0]!.depends_on = ['T3'];
  await s.store.reviseSpec(owner, s.ws.id, specId, {
    expected_version: 2,
    title: 'Word tally (synthetic)',
    content: broken,
    reason: 'Broken on purpose (test).',
  });
  await rejects(
    'INVALID_CONTRACT',
    s.store.specRunbook(owner, s.ws.id, specId),
    /Fix the spec’s task plan/,
  );

  // Someone outside the workspace gets nothing; an entity of another kind is not a spec.
  const stranger = { actorId: randomUUID() };
  await s.store.ensureActor({
    id: stranger.actorId,
    kind: 'human',
    display_name: 'Stranger',
  });
  await assert.rejects(s.store.specRunbook(stranger, s.ws.id, specId, 1));
  await rejects('NOT_FOUND', s.store.specRunbook(owner, s.ws.id, build.id));
  // Exporting recorded nothing: no new version and no new freeze.
  const status = await s.store.specStatus(owner, s.ws.id, specId);
  assert.equal(status.spec.version, 3);
  assert.equal(status.latest_freeze?.id, frozen.id);
});

test('runbook API: manifest, archive download, save to Files, proposals, and a viewer reads only', async (t) => {
  let closeApi = async () => undefined as unknown;
  t.after(() => closeApi());
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { tool, spec, freeze } = await specced(s);
  await freeze(1);
  const draft = await s.store.proposalDraft(owner, s.ws.id, tool.id);
  const proposal = await s.store.createProposal(owner, s.ws.id, {
    title: draft.title,
    body: draft.body,
  });
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
  await s.store.addMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'editor');
  const specPath = `workspaces/${s.ws.id}/specs/${spec.spec.id}/runbook`;
  const propPath = `workspaces/${s.ws.id}/proposals/${proposal.proposal.id}/runbook`;
  const post = (p: string, body: unknown) =>
    fetch(`${base}/${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });

  const summary = await fetch(`${base}/${specPath}`, { headers: auth.read });
  assert.equal(summary.status, 200);
  const sum = RunbookSummarySchema.parse(await summary.json());
  assert.equal(sum.manifest.kind, 'software');
  assert.equal(sum.manifest.prompts.length, 6);

  const dl = await fetch(`${base}/${specPath}?format=zip&version=1`, {
    headers: auth.read,
  });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/zip');
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.match(
    dl.headers.get('content-disposition')!,
    /^attachment; filename="word-tally-synthetic-runbook-v1\.zip"/,
  );
  const bytes = Buffer.from(await dl.arrayBuffer());
  assert.equal(bytes.length, sum.archive_bytes);
  assert.deepEqual(validateRunbook(readZip(bytes)), []);
  assert.equal(
    (await fetch(`${base}/${specPath}?version=x`, { headers: auth.read }))
      .status,
    400,
  );
  assert.equal(
    (await fetch(`${base}/${specPath}?version=7`, { headers: auth.read }))
      .status,
    404,
  );

  // Saved to Files once, linked to the spec; the same version again keeps the one copy.
  const saved = await post(specPath, { upload_key: randomUUID() });
  assert.equal(saved.status, 201);
  const file = ((await saved.json()) as { file: { id: string; name: string } })
    .file;
  assert.equal(file.name, 'word-tally-synthetic-runbook-v1.zip');
  const again = await post(specPath, { version: 1, upload_key: randomUUID() });
  assert.ok(again.status === 200 || again.status === 201, `${again.status}`);
  assert.equal(
    ((await again.json()) as { file: { id: string } }).file.id,
    file.id,
  );
  const linked = await fetch(`${base}/workspaces/${s.ws.id}/files/${file.id}`, {
    headers: auth.read,
  });
  assert.ok(JSON.stringify(await linked.json()).includes(spec.spec.id));

  // The non-code proposal leaves as an action runbook with its unknowns named.
  const action = await fetch(`${base}/${propPath}?format=zip`, {
    headers: auth.read,
  });
  assert.equal(action.status, 200);
  const actionFiles = readZip(Buffer.from(await action.arrayBuffer()));
  assert.deepEqual(validateRunbook(actionFiles), []);
  const manifest = JSON.parse(text(actionFiles, 'manifest.json')) as {
    kind: string;
    subject: { id: string; type: string };
    warnings: string[];
  };
  assert.equal(manifest.kind, 'action');
  assert.equal(manifest.subject.id, proposal.proposal.id);
  assert.match(manifest.warnings.join(' '), /still unknown/);
  assert.match(text(actionFiles, 'PLAN.md'), /## Evidence/);
  assert.match(
    text(actionFiles, 'DECISIONS.md'),
    /recommended instead of building software/,
  );
  const savedAction = await post(propPath, { upload_key: randomUUID() });
  assert.equal(savedAction.status, 201);

  // As a viewer: reading and downloading work, saving to Files is refused.
  await s.store.removeMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'Test');
  await s.store.addMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'viewer');
  assert.equal(
    (await fetch(`${base}/${specPath}?format=zip`, { headers: auth.read }))
      .status,
    200,
  );
  assert.equal(
    (await post(specPath, { upload_key: randomUUID() })).status,
    403,
  );
  // Outside the workspace: nothing.
  await s.store.removeMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'Test');
  const gone = await fetch(`${base}/${specPath}`, { headers: auth.read });
  assert.ok(gone.status === 403 || gone.status === 404, `${gone.status}`);
});
