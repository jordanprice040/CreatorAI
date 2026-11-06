import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  CreateProposalRequestSchema,
  PROPOSAL_MAX_CITED_CLAIMS,
  PROPOSAL_SECTIONS,
  ProposalBodySchema,
  type ProposalBody,
  type ProposalSection,
} from '@creator/contracts';
import {
  fixtureHumilityReview,
  humilityGate,
  proposalChecks,
  proposalFileName,
  proposalMarkdown,
  sectionMarkdown,
  type ChecksContext,
} from '@creator/domain';

// ADR-0077 (P09) pure rules: the hybrid humility gate (pilot F9), proposal checks (completeness,
// citation fidelity, freshness) and the Markdown export. No database.

const ref = () => ({ id: randomUUID(), version: 1 });

test('humility gate: a hybrid is judged on the hybrid comparison, software-only stays strict', () => {
  const subject = ref();
  const body = fixtureHumilityReview(subject, [ref()]);
  body.comparisons.software.viable = false;
  const review = { id: randomUUID(), version: 1, status: 'active', body };
  // The F9 case: software alone not viable, the hybrid is, disposition build.
  assert.equal(humilityGate(review, subject, 'hybrid').build_admissible, true);
  assert.deepEqual(humilityGate(review, subject).reasons, [
    'The review found custom software not viable.',
  ]);
  // "hybrid" recommends building a hybrid, not plain software.
  body.disposition = 'hybrid';
  assert.equal(humilityGate(review, subject, 'hybrid').build_admissible, true);
  body.comparisons.software.viable = true;
  assert.match(
    humilityGate(review, subject, 'software').reasons.join(' '),
    /recommends hybrid, not building/,
  );
  // Other non-build dispositions never admit a hybrid build.
  body.disposition = 'use_existing';
  assert.equal(humilityGate(review, subject, 'hybrid').build_admissible, false);
  body.disposition = 'build';
  body.comparisons.hybrid.viable = false;
  assert.deepEqual(humilityGate(review, subject, 'hybrid').reasons, [
    'The review found the hybrid not viable.',
  ]);
  // The ethics gate and evidence rule are unchanged for hybrids.
  body.comparisons.hybrid.viable = true;
  body.ethical.status = 'unresolved_serious';
  const v = humilityGate(review, subject, 'hybrid');
  assert.equal(v.build_admissible, false);
  assert.equal(v.needs_judgment, true);
});

function body(
  over: Partial<
    Record<ProposalSection, ProposalBody['sections'][ProposalSection]>
  > = {},
): ProposalBody {
  const sections = Object.fromEntries(
    PROPOSAL_SECTIONS.map((k) => [
      k,
      { state: 'written', text: `About ${k}.`, claims: [] },
    ]),
  ) as unknown as ProposalBody['sections'];
  return {
    format: 'proposal/1',
    problem: { id: randomUUID(), version: 2 },
    alternative: { id: randomUUID(), version: 1 },
    response: 'change_process',
    selection_id: randomUUID(),
    summary: 'A process change.',
    sections: { ...sections, ...over },
  };
}
const ctxFor = (
  b: ProposalBody,
  claims: ChecksContext['claims'] = new Map(),
  contrary: string[] = [],
): ChecksContext => ({
  problem_version: b.problem.version,
  option: { version: b.alternative.version, status: 'active' },
  selection_current: true,
  claims,
  contrary_linked: contrary,
});
const claim = (over: Partial<ReturnType<typeof base>> = {}) => ({
  ...base(),
  ...over,
});
function base() {
  return {
    version: 1,
    status: 'active',
    statement: 'Staff miss the hand-off when shifts change.',
    evidence_status: 'supported',
    relation: 'supports' as 'supports' | 'contradicts' | 'not_linked',
    sources: [
      {
        title: 'Shift report',
        url: 'https://example.org/report',
        stance: 'supports',
        freshness: 'current',
        quote: 'hand-offs were missed',
      },
    ],
  };
}

test('proposal schema: core sections always apply; written needs text; unknown may be empty', () => {
  const ok = body({ costs: { state: 'unknown', text: '', claims: [] } });
  assert.equal(ProposalBodySchema.safeParse(ok).success, true);
  const na = body({
    methods: { state: 'not_applicable', text: 'No steps.', claims: [] },
  });
  assert.equal(ProposalBodySchema.safeParse(na).success, false);
  const empty = body({ roles: { state: 'written', text: '  ', claims: [] } });
  assert.equal(ProposalBodySchema.safeParse(empty).success, false);
  const naOk = body({
    roles: {
      state: 'not_applicable',
      text: 'One person does everything.',
      claims: [],
    },
  });
  assert.equal(ProposalBodySchema.safeParse(naOk).success, true);
});

test('proposal checks: completeness, citation fidelity and freshness are reported, not hidden', () => {
  const c1 = ref();
  const c2 = ref();
  const c3 = ref();
  const missing = ref();
  const b = body({
    evidence: { state: 'written', text: 'See below.', claims: [c1, c2] },
    contrary_evidence: {
      state: 'written',
      text: 'Some disagree.',
      claims: [c1],
    },
    methods: { state: 'unknown', text: '', claims: [] },
    timeline: { state: 'unknown', text: '', claims: [] },
    materials: { state: 'written', text: 'Forms.', claims: [missing] },
  });
  const claims = new Map([
    [c1.id, claim()],
    [c2.id, claim({ version: 3, relation: 'not_linked' })],
    [c3.id, claim({ relation: 'contradicts' })],
  ]);
  const r = proposalChecks(b, ctxFor(b, claims, [c3.id]));
  const codes = r.checks.map((c) => `${c.level}:${c.code}:${c.section}`);
  assert.equal(r.complete, false);
  assert.equal(r.ready_for_review, false);
  assert.ok(codes.includes('blocker:core_unknown:methods'));
  assert.ok(codes.includes('warning:section_unknown:timeline'));
  assert.ok(codes.includes('warning:claim_changed:evidence'));
  assert.ok(codes.includes('warning:claim_unlinked:evidence'));
  assert.ok(codes.includes('warning:contrary_supports:contrary_evidence'));
  assert.ok(codes.includes('warning:contrary_uncited:contrary_evidence'));
  assert.ok(codes.includes('blocker:claim_missing:materials'));
  // References: one per claim, in first-citation order, with sources.
  assert.deepEqual(
    r.references.map((x) => [x.label, x.claim.id]),
    [
      ['R1', c1.id],
      ['R2', c2.id],
      ['R3', missing.id],
    ],
  );
  assert.equal(r.references[2]!.status, 'missing');
  assert.equal(r.references[0]!.sources[0]!.url, 'https://example.org/report');

  // An evidence section without citations, and a changed or inactive subject.
  const b2 = body();
  const r2 = proposalChecks(b2, {
    ...ctxFor(b2),
    problem_version: 3,
    option: { version: 1, status: 'archived' },
    selection_current: false,
  });
  const codes2 = r2.checks.map((c) => c.code);
  assert.ok(codes2.includes('evidence_uncited'));
  assert.ok(codes2.includes('problem_changed'));
  assert.ok(codes2.includes('option_inactive'));
  assert.ok(codes2.includes('selection_replaced'));
  assert.equal(r2.complete, true);
  assert.equal(r2.ready_for_review, false);

  const b3 = body({
    evidence: { state: 'written', text: 'Cited.', claims: [c1] },
  });
  const r3 = proposalChecks(b3, ctxFor(b3, new Map([[c1.id, claim()]])));
  assert.deepEqual(r3.checks, []);
  assert.equal(r3.ready_for_review, true);
});

test('proposal Markdown: every section in order, unknowns labelled, references and provenance', () => {
  const c1 = ref();
  const b = body({
    evidence: { state: 'written', text: 'Hand-offs are missed.', claims: [c1] },
    costs: { state: 'unknown', text: 'Licence price not known.', claims: [] },
    roles: { state: 'not_applicable', text: 'One person.', claims: [] },
  });
  const checks = proposalChecks(b, ctxFor(b, new Map([[c1.id, claim()]])));
  const md = proposalMarkdown({
    id: randomUUID(),
    version: 4,
    title: 'Proposal: Shift hand-off checklist',
    content_hash: 'a'.repeat(64),
    body: b,
    checks,
    problem_title: 'Missed hand-offs',
    option_title: 'Hand-off checklist',
    saved_at: '2026-11-06T12:00:00.000Z',
  });
  const heads = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  // Every section in order, then the references, then the open checks (costs is unknown).
  assert.equal(heads.length, PROPOSAL_SECTIONS.length + 2);
  assert.deepEqual(heads.slice(-2), ['References', 'Open checks']);
  assert.match(
    md,
    /- Warning: Cost estimates and unknowns is marked unknown\./,
  );
  assert.match(md, /\*\*Unknown\.\*\* Licence price not known\./);
  assert.match(md, /\*\*Not applicable\.\*\* One person\./);
  assert.match(md, /Cited: \[R1\]/);
  assert.match(md, /- \[R1\] Staff miss the hand-off/);
  assert.match(md, /https:\/\/example\.org\/report \(supports, current\)/);
  assert.match(md, /version 4, content hash a{64}/);
  assert.match(md, /has not been carried out/);
  assert.match(md, /- Version saved 2026-11-06T12:00:00\.000Z/);
  assert.equal(
    proposalFileName('Proposal: Shift hand-off / checklist', 4),
    'proposal-shift-hand-off-checklist-v4.md',
  );
  assert.equal(proposalFileName('ÄÖ', 1), 'ao-v1.md');
  assert.equal(proposalFileName('???', 2), 'proposal-v2.md');
});

test('export: section text cannot forge headings; titles are one line (review L-4)', () => {
  assert.equal(
    sectionMarkdown(
      'Plan\n## References\n   # x\n<h2>y</h2>\nTitle\n---\n===\n- a list item',
    ),
    'Plan\n\\## References\n   \\# x\n\\<h2>y</h2>\nTitle\n\\---\n\\===\n- a list item',
  );
  const b = body({
    methods: {
      state: 'written',
      text: 'Step one.\n## References\n- [R1] forged',
      claims: [],
    },
  });
  const md = proposalMarkdown({
    id: randomUUID(),
    version: 1,
    title: 'Plain title',
    content_hash: 'b'.repeat(64),
    body: b,
    checks: proposalChecks(b, ctxFor(b)),
    problem_title: 'Problem\n## Forged',
    option_title: 'Option',
    saved_at: '2026-11-06T12:00:00.000Z',
  });
  assert.equal([...md.matchAll(/^## References$/gm)].length, 1);
  assert.equal([...md.matchAll(/^## Forged/gm)].length, 0);
  const req = (title: string) =>
    CreateProposalRequestSchema.safeParse({ title, body: body() }).success;
  assert.equal(req('A fine title'), true);
  assert.equal(req('Two\nlines'), false);
  assert.equal(req('Tab\there'), false);
  assert.equal(req('Line\u2028separator'), false);
});

test('a proposal cites at most the reference limit of distinct claims (review L-7)', () => {
  const refs = (n: number) => Array.from({ length: n }, ref);
  const split = (all: ReturnType<typeof ref>[]) => ({
    evidence: {
      state: 'written' as const,
      text: 'E.',
      claims: all.slice(0, 20),
    },
    methods: {
      state: 'written' as const,
      text: 'M.',
      claims: all.slice(20, 40),
    },
    materials: {
      state: 'written' as const,
      text: 'T.',
      claims: all.slice(40, 60),
    },
    costs: { state: 'written' as const, text: 'C.', claims: all.slice(60, 80) },
  });
  const ok = body(split(refs(PROPOSAL_MAX_CITED_CLAIMS)));
  assert.equal(ProposalBodySchema.safeParse(ok).success, true);
  const r = proposalChecks(ok, ctxFor(ok));
  assert.equal(r.references.length, PROPOSAL_MAX_CITED_CLAIMS);
  const over = body(split(refs(PROPOSAL_MAX_CITED_CLAIMS + 1)));
  const parsed = ProposalBodySchema.safeParse(over);
  assert.equal(parsed.success, false);
  assert.match(
    JSON.stringify(parsed.error?.issues),
    /at most 60 different claims/,
  );
});
