import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ContractError,
  type Admission,
  type Decision,
  type ErrorCode,
  type ScorecardBody,
  type SelectRequest,
} from '@creator/contracts';
import { FIXTURE_SPEC, fixtureHumilityReview } from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import { createApi, DEFAULT_OWNER_ACTOR_ID } from '@creator/api';
import { discoverySetup, owner } from './discovery-harness.js';
import { LOGIN_CODE, login } from './pg-harness.js';
import { dispositions, filled, nonCodeSelected } from './proposal-harness.js';

const { Client } = pg;

// ADR-0077 (P09): the response explanation and versioned non-code proposals, end to end on
// PostgreSQL. A non-code choice ends with a downloadable proposal and review/revision support.

const rejects = (code: ErrorCode, p: Promise<unknown>, message?: RegExp) =>
  assert.rejects(
    p,
    (e: unknown) =>
      e instanceof ContractError &&
      e.code === code &&
      (!message || message.test(e.message)),
  );
test('a non-code choice is explained with its software routes and what would change it', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { problem, build, hybrid, tool, selection } = await nonCodeSelected(s);
  const x = await s.store.responseExplanation(owner, s.ws.id, problem.id);
  assert.equal(x.basis, 'selection');
  assert.equal(x.selection?.id, selection.id);
  assert.equal(x.non_code, true);
  assert.equal(x.response, 'an existing tool');
  assert.deepEqual(
    x.chosen.map((c) => c.alternative.id),
    [tool.id],
  );
  assert.equal(x.chosen[0]!.disposition, 'recommend_alternative');
  assert.match(x.chosen[0]!.reverse_if!, /already configured/);
  // Both software routes are shown, with what would make each preferable.
  const ids = x.software_avenues.map((a) => a.option.alternative.id).sort();
  assert.deepEqual(ids, [build.id, hybrid.id].sort());
  const b = x.software_avenues.find(
    (a) => a.option.alternative.id === build.id,
  )!;
  assert.equal(b.humility?.state, 'passing');
  assert.match(b.humility!.software_part, /Risk flags/);
  assert.ok(b.would_prefer_if.some((w) => /change-course trigger/.test(w)));
  assert.ok(
    b.behind_on.length > 0 &&
      b.behind_on.every((g) => Number(g.rating) < Number(g.leader_rating)),
  );
  // The hybrid has an unknown criterion: shown as unknown, not as a low score.
  const h = x.software_avenues.find(
    (a) => a.option.alternative.id === hybrid.id,
  )!;
  assert.ok(h.unknown.length > 0);
  assert.ok(h.unknown.every((g) => g.rating === null));
  assert.equal(h.humility, null);
  assert.ok(h.blockers.some((r) => /humility/i.test(r)));
  assert.ok(x.notes.some((n) => /not a model/.test(n)));
  // Deterministic: the same records give the same explanation.
  assert.deepEqual(
    await s.store.responseExplanation(owner, s.ws.id, problem.id),
    x,
  );
});

test('the humility gate judges a hybrid on the hybrid comparison (pilot F9)', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { evidence, hybrid } = await nonCodeSelected(s);
  const body = fixtureHumilityReview(
    { id: hybrid.id, version: hybrid.version },
    evidence,
  );
  body.comparisons.software.viable = false; // software alone is not viable...
  body.disposition = 'hybrid'; // ...but the hybrid is, and it is what gets built.
  const review = await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Hybrid review',
    body,
  });
  const v = await s.store.humilityVerdict(owner, s.ws.id, review.id);
  assert.equal(v.build_admissible, true, v.reasons.join(' '));
  body.comparisons.hybrid.viable = false;
  const again = await s.store.reviseEntity(owner, s.ws.id, review.id, {
    expected_version: 1,
    title: 'Hybrid review',
    body,
    reason: 'Hybrid not viable (test).',
    corrects_version: null,
  });
  const no = await s.store.humilityVerdict(owner, s.ws.id, again.id);
  assert.equal(no.build_admissible, false);
  assert.deepEqual(no.reasons, ['The review found the hybrid not viable.']);
});

test('a build of a spec written from a hybrid is admitted on the hybrid comparison (review L-6)', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { runId, problem, evidence, hybrid } = await nonCodeSelected(s);
  // Complete the hybrid's opportunity assessment (the fixture leaves one criterion unknown).
  const cards = await s.store.listEntities(owner, s.ws.id, {
    kind: 'scorecard',
  });
  const card = cards.find((c) => {
    const b = c.body as unknown as ScorecardBody;
    return b.subject.id === hybrid.id && b.rubric === 'opportunity';
  })!;
  const rated = structuredClone(card.body) as unknown as ScorecardBody;
  rated.ratings.differentiation = {
    rating: 3,
    evidence_refs: evidence.slice(0, 2),
    rationale: 'Rated 3 (test).',
  };
  await s.store.reviseScorecard(owner, s.ws.id, card.id, {
    expected_version: card.version,
    title: card.title,
    body: rated,
    reason: 'Differentiation rated (test).',
  });
  const hybridReview = (subject: { id: string; version: number }) => {
    const body = fixtureHumilityReview(subject, evidence);
    body.comparisons.software.viable = false; // software alone is not viable...
    body.disposition = 'hybrid'; // ...the hybrid is what gets built.
    return body;
  };
  await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Hybrid humility review',
    body: hybridReview({ id: hybrid.id, version: hybrid.version }),
  });
  const report = await s.store.selectionReport(owner, s.ws.id, problem.id);
  const req: SelectRequest = {
    problem: { id: report.problem.id, version: report.problem.version },
    report_hash: report.report_hash,
    dispositions: dispositions(report).map((d) =>
      d.alternative.id === hybrid.id
        ? {
            ...d,
            disposition: 'select_for_build' as const,
            reasons: ['The hybrid is the viable build (test).'],
          }
        : d,
    ),
    override_reason: 'The hybrid goes to a spec (test).',
    rationale: 'Build the hybrid; keep reminders recommended.',
    shortlist_size: 3,
    data_class: 'synthetic',
  };
  let picked = await s.store.select(owner, s.ws.id, runId, req);
  if (picked.status === 'needs_human') {
    const d = await s.store.getDecision(
      owner,
      s.ws.id,
      picked.admission.decision_id!,
    );
    await s.store.answerDecision(owner, s.ws.id, d.id, {
      choice: 'approve_once',
      option_id: null,
      rationale: 'Approved (test).',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    });
    picked = await s.store.select(owner, s.ws.id, runId, req);
  }
  assert.equal(picked.status, 'recorded', picked.admission.explanation);
  const spec = await s.store.createSpec(owner, s.ws.id, {
    selection_id: picked.selection!.id,
    alternative: { id: hybrid.id, version: hybrid.version },
    title: 'Hybrid no-show flags',
    content: FIXTURE_SPEC,
  });
  const specRef = { id: spec.spec.id, version: spec.spec.version };
  const review = await s.store.createEntity(owner, s.ws.id, {
    kind: 'humility_review',
    title: 'Spec humility review',
    body: hybridReview(specRef),
  });
  const verdict = await s.store.humilityVerdict(owner, s.ws.id, review.id);
  assert.equal(verdict.build_admissible, true, verdict.reasons.join(' '));
  // The admission path reads the same kind: the build is admitted once a person approves the
  // exact action (the run has no standing grant for it), with no humility refusal on the way.
  const commit = {
    action_type: 'product.commit_build' as const,
    task_id: null,
    target: specRef,
    spec_hash: null,
    amount_nano_usd: null,
    data_class: 'synthetic' as const,
    assumption_ids: [],
    humility_review: { id: review.id, version: 1 },
    flags: [],
    justification: 'Commit the hybrid build (test).',
  };
  let admission: Admission = await s.store.admitAction(
    owner,
    s.ws.id,
    runId,
    commit,
  );
  for (let i = 0; i < 3 && admission.verdict === 'request_human'; i++) {
    assert.ok(
      !admission.reasons.some((r) => /humility/.test(r)),
      admission.reasons.join(' '),
    );
    const d: Decision = await s.store.getDecision(
      owner,
      s.ws.id,
      admission.decision_id!,
    );
    assert.equal(d.kind, 'authorization');
    await s.store.answerDecision(owner, s.ws.id, d.id, {
      choice: 'approve_once',
      option_id: null,
      rationale: 'Approved this exact build (test).',
      coverage_hash: d.coverage.coverage_hash,
      standing_expires_at: null,
      time_spent_ms: null,
      interruption: null,
    });
    admission = await s.store.admitAction(owner, s.ws.id, runId, commit);
  }
  assert.equal(admission.verdict, 'allow', admission.explanation);
});

test('a proposal is drafted from records, versioned, checked, reviewed and exported', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { problem, build, human, tool, selection } = await nonCodeSelected(s);
  // Only an advanced non-code option gets a proposal; software goes to a spec instead.
  await rejects(
    'INVALID_CONTRACT',
    s.store.proposalDraft(owner, s.ws.id, build.id),
    /spec and a build/,
  );
  await rejects(
    'INVALID_TRANSITION',
    s.store.proposalDraft(owner, s.ws.id, human.id),
    /recommends this option/,
  );
  const draft = await s.store.proposalDraft(owner, s.ws.id, tool.id);
  assert.equal(draft.body.response, 'use_existing');
  assert.equal(draft.body.selection_id, selection.id);
  // Filled only from records; nothing invented: methods, costs and objectives stay unknown.
  for (const k of ['objectives', 'methods', 'costs', 'next_tasks'] as const)
    assert.equal(draft.body.sections[k].state, 'unknown', k);
  assert.equal(draft.body.sections.evidence.state, 'written');
  assert.ok(draft.body.sections.evidence.claims.length > 0);
  // Review L-1: the draft cites claims and never copies their statements into the text.
  for (const r of draft.checks.references)
    for (const k of ['evidence', 'contrary_evidence'] as const)
      assert.ok(
        !draft.body.sections[k].text.includes(r.statement),
        `${k} copies ${r.label}`,
      );
  assert.match(draft.body.sections.evidence.text, /listed under References/);
  // Review L-4: a title is one line.
  await rejects(
    'INVALID_CONTRACT',
    s.store.createProposal(owner, s.ws.id, {
      title: 'Proposal\n## References',
      body: draft.body,
    }),
  );
  assert.equal(draft.checks.complete, false);
  assert.ok(draft.checks.checks.some((c) => c.code === 'core_unknown'));
  // The generic record path refuses the kind.
  await rejects(
    'INVALID_CONTRACT',
    s.store.createEntity(owner, s.ws.id, {
      kind: 'proposal',
      title: draft.title,
      body: draft.body,
    }),
    /proposal API/,
  );
  // A citation must be a claim of this workspace.
  const bad = structuredClone(draft.body);
  bad.sections.methods = {
    state: 'written',
    text: 'Steps.',
    claims: [{ id: tool.id, version: tool.version }],
  };
  await rejects(
    'MISSING_EVIDENCE',
    s.store.createProposal(owner, s.ws.id, { title: draft.title, body: bad }),
  );
  const v1 = await s.store.createProposal(owner, s.ws.id, {
    title: draft.title,
    body: draft.body,
  });
  assert.equal(v1.proposal.version, 1);
  assert.equal(v1.checks.ready_for_review, false);
  assert.equal(
    v1.checks.references.length,
    draft.body.sections.evidence.claims.length,
  );
  assert.ok(v1.checks.references.every((r) => r.relation === 'supports'));
  // A revision keeps its problem and option.
  await rejects(
    'INVALID_CONTRACT',
    s.store.reviseProposal(owner, s.ws.id, v1.proposal.id, {
      expected_version: 1,
      title: draft.title,
      body: {
        ...filled(draft.body),
        alternative: { id: build.id, version: build.version },
      },
      reason: 'Switch option (test).',
    }),
    /keeps the proposal/,
  );
  const v2 = await s.store.reviseProposal(owner, s.ws.id, v1.proposal.id, {
    expected_version: 1,
    title: draft.title,
    body: filled(draft.body),
    reason: 'Filled the unknown sections (test).',
  });
  assert.equal(v2.proposal.version, 2);
  assert.equal(v2.checks.complete, true);
  assert.equal(
    v2.checks.ready_for_review,
    true,
    JSON.stringify(v2.checks.checks),
  );
  assert.deepEqual(
    v2.versions.map((v) => v.version),
    [2, 1],
  );
  // Reviews bind to the exact version read.
  const review = {
    version: 1,
    content_hash: v1.proposal.content_hash,
    verdict: 'revise' as const,
    marks: {
      completeness: 'concern' as const,
      citation_fidelity: 'pass' as const,
      feasibility: 'not_checked' as const,
      access: 'not_checked' as const,
    },
    comments: 'Costs need a range.',
  };
  await rejects(
    'VERSION_CONFLICT',
    s.store.reviewProposal(owner, s.ws.id, v1.proposal.id, review),
  );
  // Review L-3: "ready" is refused for a version the checks do not find ready.
  const unready = await s.store.createProposal(owner, s.ws.id, {
    title: `${draft.title} (second)`,
    body: draft.body,
  });
  await rejects(
    'INVALID_TRANSITION',
    s.store.reviewProposal(owner, s.ws.id, unready.proposal.id, {
      ...review,
      version: 1,
      content_hash: unready.proposal.content_hash,
      verdict: 'ready',
    }),
    /not ready for review/,
  );
  await rejects(
    'INVALID_CONTRACT',
    s.store.reviewProposal(owner, s.ws.id, v1.proposal.id, {
      ...review,
      version: 2,
      content_hash: v2.proposal.content_hash,
      comments: '',
    }),
    /what to revise/,
  );
  const reviewed = await s.store.reviewProposal(
    owner,
    s.ws.id,
    v1.proposal.id,
    {
      ...review,
      version: 2,
      content_hash: v2.proposal.content_hash,
    },
  );
  assert.equal(reviewed.reviews.length, 1);
  assert.equal(reviewed.reviews[0]!.current, true);
  // The owner saved v2 and reviewed it: shown as a self-review, not an independent one.
  assert.equal(reviewed.reviews[0]!.self_review, true);
  // Review N-1: reviews are append-only.
  const sql = new Client({ connectionString: s.db.url });
  await sql.connect();
  try {
    await assert.rejects(
      sql.query(`update proposal_reviews set verdict = 'ready'`),
      /append-only/,
    );
    await assert.rejects(
      sql.query('delete from proposal_reviews'),
      /append-only/,
    );
  } finally {
    await sql.end();
  }
  const body3 = structuredClone(filled(draft.body));
  body3.sections.costs.text =
    'About 2 staff hours per clinic; licence cost unknown.';
  const v3 = await s.store.reviseProposal(owner, s.ws.id, v1.proposal.id, {
    expected_version: 2,
    title: draft.title,
    body: body3,
    reason: 'Answered review feedback on costs.',
  });
  assert.equal(v3.reviews[0]!.current, false);
  assert.equal(v3.reviews[0]!.version, 2);
  // Older versions stay readable with their own content.
  const old = await s.store.proposalDetail(owner, s.ws.id, v1.proposal.id, 1);
  assert.equal(old.shown_version, 1);
  assert.equal(old.proposal.body.sections.methods.state, 'unknown');
  // Markdown export of the exact version.
  const md = await s.store.proposalExport(owner, s.ws.id, v1.proposal.id, 1);
  // Review L-2: the same version exports the same bytes.
  assert.equal(
    (await s.store.proposalExport(owner, s.ws.id, v1.proposal.id, 1)).markdown,
    md.markdown,
  );
  assert.match(md.markdown, /- Version saved \S+/);
  assert.doesNotMatch(md.markdown, /Exported /);
  assert.match(md.name, /-v1\.md$/);
  assert.match(md.markdown, /^# Proposal: /);
  assert.match(
    md.markdown,
    /## Methods and step-by-step procedure\n\n\*\*Unknown yet\.\*\*/,
  );
  assert.match(md.markdown, /## References\n\n- \[R1\] /);
  assert.match(md.markdown, /has not been carried out/);
  assert.match(
    md.markdown,
    new RegExp(`version 1, content hash ${v1.proposal.content_hash}`),
  );
  // A changed problem shows as a check, not silently.
  const p = await s.store.getEntity(owner, s.ws.id, problem.id);
  await s.store.reviseEntity(owner, s.ws.id, problem.id, {
    expected_version: p.entity.version,
    title: p.entity.title,
    body: { ...p.entity.body, uncertainty: 'Changed for the test.' },
    reason: 'Test change.',
    corrects_version: null,
  });
  const after = await s.store.proposalDetail(owner, s.ws.id, v1.proposal.id);
  assert.ok(after.checks.checks.some((c) => c.code === 'problem_changed'));
  // Review N-2: the problem filter ignores the id's letter case.
  const list = await s.store.listProposals(
    owner,
    s.ws.id,
    problem.id.toUpperCase(),
  );
  assert.deepEqual(
    list.map((x) => [x.id, x.version]).sort(),
    [
      [unready.proposal.id, 1],
      [v1.proposal.id, 3],
    ].sort(),
  );
});

test('proposal API: Markdown download, save to Files, and a viewer cannot change it', async (t) => {
  let closeApi = async () => undefined as unknown;
  t.after(() => closeApi());
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const { problem, tool } = await nonCodeSelected(s);
  const draft = await s.store.proposalDraft(owner, s.ws.id, tool.id);
  const made = await s.store.createProposal(owner, s.ws.id, {
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
  const path = `workspaces/${s.ws.id}/proposals/${made.proposal.id}`;
  const post = (p: string, body: unknown) =>
    fetch(`${base}/${p}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...auth.write },
      body: JSON.stringify(body),
    });

  const dl = await fetch(`${base}/${path}/export?version=1`, {
    headers: auth.read,
  });
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'text/markdown; charset=utf-8');
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.match(
    dl.headers.get('content-disposition')!,
    /^attachment; filename="proposal-.*-v1\.md"/,
  );
  assert.match(await dl.text(), /## Evidence/);
  const bad = await fetch(`${base}/${path}/export?version=x`, {
    headers: auth.read,
  });
  assert.equal(bad.status, 400);

  const explained = await fetch(
    `${base}/workspaces/${s.ws.id}/problems/${problem.id}/explanation`,
    { headers: auth.read },
  );
  assert.equal(explained.status, 200);
  assert.equal(
    ((await explained.json()) as { non_code: boolean }).non_code,
    true,
  );

  const saved = await post(`${path}/files`, {
    version: 1,
    upload_key: randomUUID(),
  });
  assert.equal(saved.status, 201);
  const file = (
    (await saved.json()) as {
      file: { id: string; name: string; links: { id: string }[] };
    }
  ).file;
  assert.match(file.name, /-v1\.md$/);
  // Review L-2: the export is deterministic, so a second save keeps the one copy.
  const again = await post(`${path}/files`, {
    version: 1,
    upload_key: randomUUID(),
  });
  assert.ok(again.status === 200 || again.status === 201, `${again.status}`);
  assert.equal(
    ((await again.json()) as { file: { id: string } }).file.id,
    file.id,
  );
  const linked = await fetch(`${base}/workspaces/${s.ws.id}/files/${file.id}`, {
    headers: auth.read,
  });
  assert.ok(JSON.stringify(await linked.json()).includes(made.proposal.id));

  // As a viewer: reading works, writing is refused.
  await s.store.removeMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'Test');
  await s.store.addMember(owner, s.ws.id, DEFAULT_OWNER_ACTOR_ID, 'viewer');
  const read = await fetch(`${base}/${path}`, { headers: auth.read });
  assert.equal(read.status, 200);
  const review = await post(`${path}/reviews`, {
    version: 1,
    content_hash: made.proposal.content_hash,
    verdict: 'ready',
    marks: {
      completeness: 'pass',
      citation_fidelity: 'pass',
      feasibility: 'pass',
      access: 'pass',
    },
    comments: '',
  });
  assert.equal(review.status, 403);
  const revise = await post(`${path}/revisions`, {
    expected_version: 1,
    title: draft.title,
    body: draft.body,
    reason: 'Viewer edit (test).',
  });
  assert.equal(revise.status, 403);
});
