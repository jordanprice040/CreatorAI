import test from 'node:test';
import assert from 'node:assert/strict';
import { AssessmentPacketSchema, type ClaimEvidence } from '@creator/contracts';
import {
  ASSESSMENTS_PER_REQUEST,
  assessmentPreviewHash,
  assessmentsPerRequest,
  assessmentRequestChars,
  assessmentRoleInput,
  buildAssessmentPacket,
  canonicalHash,
  packetForOptions,
  planTaskText,
} from '@creator/domain';

// P25 (ADR-0085): assessment requests sized to the route's per-request input cap, counted the
// way plan admission counts them, with one claim set shared by every request.

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const NOW = new Date('2026-11-11T12:00:00.000Z');
const fill = (t: string, len: number) =>
  `${t} `.repeat(Math.ceil(len / (t.length + 1))).slice(0, len);

function claimEvidence(n: number, statementLength = 120): ClaimEvidence {
  const s =
    `Claim ${n}: ` +
    'people report that the current workaround takes too long. '.repeat(40);
  return {
    claim: {
      id: uid(1000 + n),
      version: 1,
      title: `Claim ${n}`,
      statement: s.slice(0, statementLength),
      basis: 'observation',
    },
    status: 'supported',
    labels: ['single_source'],
    explanation: 'One source.',
    independent_origins: 1,
    contrary_origins: 0,
    max_age_days: 180,
    rows: [1, 2].map((k) => ({
      support: {
        id: uid(5000 + n * 10 + k),
        workspace_id: uid(1),
        claim_id: uid(1000 + n),
        claim_version: 1,
        source_id: uid(3000 + n),
        source_version: 1,
        passage_id: null,
        stance: 'supports' as const,
        support_type: 'quotation' as const,
        quote: `"Quoted" passage ${k} for claim ${n}. ` + 'x'.repeat(250),
        rationale: 'It says so.',
        link_id: null,
        asserted_by: uid(2),
        created_at: NOW.toISOString(),
        retracted_at: null,
        retraction_reason: null,
      },
      freshness: 'current' as const,
      counted: true,
      origin_cluster: uid(4000 + n),
      source_title: `Source ${n}`,
      source_url: `https://example.org/source-${n}`,
      source_current_version: 1,
    })),
  };
}
const option = (n: number, kind: string, long: boolean) => ({
  id: uid(2000 + n),
  version: 1,
  kind,
  title: `Option ${n} ${kind}`,
  rationale: long
    ? fill(`Option ${n} rationale with "quotes" and detail`, 1400)
    : `Option ${n} helps.`,
  tradeoffs: long
    ? Array.from({ length: 8 }, (_, i) =>
        fill(`Trade-off ${i} of option ${n}`, 320),
      )
    : ['Costs time.'],
  uncertainty: long
    ? fill('Not yet known whether people would switch', 700)
    : 'Unknown demand.',
});
const problem = {
  id: uid(9),
  version: 3,
  title: 'Slow intake',
  statement: 'Intake takes too long for small clinics.',
  affected_group: 'Small clinics',
  outcome_measure: 'Minutes per intake',
};
const small = () => ({
  problem,
  alternatives: [option(1, 'build', false), option(2, 'process', false)],
  claims: [1, 2, 3].map((n) => ({
    relation: (n === 3 ? 'contradicts' : 'supports') as
      'supports' | 'contradicts',
    evidence: claimEvidence(n),
  })),
  now: NOW,
});
const mid = (n: number) => ({
  id: uid(2000 + n),
  version: 1,
  kind: 'build',
  title: `Option ${n}`,
  rationale: fill(`Option ${n} rationale`, 500),
  tradeoffs: [0, 1, 2].map((i) => fill(`Trade ${i}`, 150)),
  uncertainty: fill('Unknown', 200),
});
const large = (cap: number, options = 'long') => ({
  problem,
  alternatives: Array.from({ length: 8 }, (_, i) =>
    options === 'mid'
      ? mid(i + 1)
      : option(i + 1, i % 3 === 2 ? 'process' : 'build', true),
  ),
  claims: Array.from({ length: 30 }, (_, i) => ({
    relation: 'supports' as const,
    evidence: claimEvidence(i + 1, 600),
  })),
  now: NOW,
  input_cap: cap,
  route: 'plan' as const,
});

test('a small problem that fit one request before is unchanged: same packet hashes, one request', () => {
  const plan = buildAssessmentPacket(small());
  assert.ok(plan.ok);
  // Computed with the ADR-0074 builder on main 5ee86e9 for the same input.
  assert.equal(
    canonicalHash(plan.packet),
    '8e3c9fc8d7317a5c06ce0dc729407478613c720757229dc1f58373935fedcb95',
  );
  assert.equal(
    assessmentPreviewHash(plan.packet),
    'aac12447bae0879015b008c9f84229ca0fd3f68908a818afe77a9ac5142b0a5c',
  );
  assert.deepEqual(plan.batches, [['O1', 'O2']]);
  assert.equal(plan.claims_left_out, 0);
});

test('eight long options and thirty claims: every request is under the cap and reads the same claims; what is left out is said', () => {
  for (const cap of [24_000, 40_000, 120_000]) {
    const plan = buildAssessmentPacket(large(cap));
    assert.ok(plan.ok, `cap ${cap}`);
    AssessmentPacketSchema.parse(plan.packet);
    assert.equal(plan.input_cap, cap);
    assert.ok(plan.batches.length > 1, 'split into several requests');
    assert.deepEqual(
      plan.batches.flat(),
      plan.packet.options.map((o) => o.ref),
      'every option in exactly one request, in order',
    );
    for (const [i, refs] of plan.batches.entries()) {
      const part = packetForOptions(plan.packet, refs);
      assert.ok(
        part.options.reduce((n, o) => n + o.rubrics.length, 0) <=
          ASSESSMENTS_PER_REQUEST,
      );
      // The same claims (refs and content) in every request.
      assert.deepEqual(part.claims, plan.packet.claims);
      const chars = assessmentRequestChars(part);
      assert.equal(chars, plan.request_chars[i]);
      assert.ok(chars <= cap, `request ${i} ${chars} > ${cap}`);
    }
    // Nothing dropped silently: the count is in the packet the model reads.
    assert.equal(plan.packet.claims.length + plan.claims_left_out, 30);
    assert.equal(plan.claims_over_max, 0);
    if (plan.claims_left_out)
      assert.ok(
        plan.packet.notes.some((n) =>
          n.startsWith(`${plan.claims_left_out} linked claims were not read`),
        ),
      );
  }
  // Raising the cap (Jordan's "approve a larger packet") reads more evidence.
  const at = (cap: number) => {
    const p = buildAssessmentPacket(large(cap));
    assert.ok(p.ok);
    return p.packet.claims.length;
  };
  assert.equal(at(24_000), 4);
  assert.ok(at(40_000) > at(24_000));
  assert.equal(at(120_000), 30);
});

test('the cap that reads every claim is reported, and reads them all', () => {
  const plan = buildAssessmentPacket(large(24_000));
  assert.ok(plan.ok);
  assert.ok(plan.cap_for_all !== null && plan.cap_for_all > 24_000);
  assert.equal(plan.cap_for_all % 1000, 0);
  const all = buildAssessmentPacket(large(plan.cap_for_all!));
  assert.ok(all.ok);
  assert.equal(all.claims_left_out, 0);
  assert.equal(all.cap_for_all, null);
  // Every larger cap reads them all too, so rounding the hint up is safe (re-review L-A).
  for (let k = 1; k <= 30; k++) {
    const above = buildAssessmentPacket(large(plan.cap_for_all! + k * 1000));
    assert.ok(above.ok);
    assert.equal(above.claims_left_out, 0, `cap_for_all + ${k},000`);
  }
  const under = buildAssessmentPacket(large(plan.cap_for_all! - 1000));
  assert.ok(under.ok);
  assert.ok(under.claims_left_out > 0, 'the smallest such cap, to a thousand');
});

test('a finer split is used only when it reads clearly more claims (it costs more requests)', () => {
  // Eight mid-sized options at 32,000: one option per request would read 10 claims in 8
  // requests; two per request read 9 in 4, so the 4-request split is kept.
  const plan = buildAssessmentPacket(large(32_000, 'mid'));
  assert.ok(plan.ok);
  assert.equal(plan.batches.length, 4);
  assert.equal(plan.packet.claims.length, 9);
  // When the finer split reads many more claims it is used: long options at 24,000.
  const long = buildAssessmentPacket(large(24_000));
  assert.ok(long.ok);
  assert.equal(long.batches.length, 8);
});

test('claims past the 30-claim maximum are counted apart: no cap reads them', () => {
  const plan = buildAssessmentPacket({
    problem,
    alternatives: [mid(1)],
    claims: Array.from({ length: 40 }, (_, i) => ({
      relation: 'supports' as const,
      evidence: claimEvidence(i + 1, 100),
    })),
    now: NOW,
    input_cap: 200_000,
    route: 'plan',
  });
  assert.ok(plan.ok);
  assert.equal(plan.packet.claims.length, 30);
  assert.equal(plan.claims_left_out, 0);
  assert.equal(plan.claims_over_max, 10);
  assert.equal(plan.cap_for_all, null);
  assert.ok(
    plan.packet.notes.some((n) =>
      n.startsWith(
        '10 more linked claims were not read: one assessment reads at most 30',
      ),
    ),
  );
  assert.ok(!plan.packet.notes.some((n) => /input characters/.test(n)));
});

test('the count matches what the worker sends to plan admission (instructions plus JSON input)', () => {
  const plan = buildAssessmentPacket(large(40_000));
  assert.ok(plan.ok);
  const part = packetForOptions(plan.packet, plan.batches[0]);
  const t = planTaskText(assessmentRoleInput(part));
  assert.equal(
    assessmentRequestChars(part),
    t.instructions.length + t.input.length,
  );
  assert.equal(JSON.parse(t.input)[0].role, 'user');
});

test('one option that does not fit alone is refused with what it needs and where to raise the cap', () => {
  const plan = buildAssessmentPacket(large(12_000));
  assert.equal(plan.ok, false);
  if (plan.ok) return;
  assert.ok(plan.needed > 12_000);
  // Led by the option's title; the internal ref means nothing in Decide.
  assert.match(plan.problem, /^The option “Option 1 build”/);
  assert.doesNotMatch(plan.problem, /O1/);
  assert.match(plan.problem, /12,000 per request/);
  assert.match(plan.problem, /Change caps/);
  // On an API or local route there is no connection cap to raise.
  const api = buildAssessmentPacket({ ...large(12_000), route: 'other' });
  assert.equal(api.ok, false);
  if (api.ok) return;
  assert.doesNotMatch(api.problem, /cap under Models/);
  assert.match(api.problem, /Shorten its rationale or trade-offs\.$/);
});

test('ADR-0091: claims linked to an option are read, tagged with it, and come first so a tight cap still covers each option', () => {
  const base = large(24_000);
  const extra = option(9, 'build', true);
  const plan = buildAssessmentPacket({
    ...base,
    alternatives: [...base.alternatives, extra],
    claims: [
      ...base.claims.slice(0, 10),
      // Option-only claims: one on O5, one on O6 and O2, one on the ninth (not assessed).
      {
        relation: 'supports' as const,
        evidence: claimEvidence(31, 600),
        options: [uid(2005)],
        problem: false,
      },
      {
        relation: 'supports' as const,
        evidence: claimEvidence(32, 600),
        options: [uid(2006).toUpperCase(), uid(2002)],
        problem: false,
      },
      {
        relation: 'supports' as const,
        evidence: claimEvidence(33, 600),
        options: [extra.id],
        problem: false,
      },
    ],
  });
  assert.ok(plan.ok);
  AssessmentPacketSchema.parse(plan.packet);
  // Each option's first own claim in option order, then the problem's claims.
  assert.deepEqual(
    plan.packet.claims
      .slice(0, 2)
      .map((c) => [c.claim_id, c.options, c.relation]),
    [
      [uid(1032), ['O2', 'O6'], 'supports'],
      [uid(1031), ['O5'], 'supports'],
    ],
  );
  assert.ok(plan.packet.claims.slice(2).every((c) => c.options === undefined));
  // The ninth option's claim is neither read nor counted as left out.
  assert.ok(!plan.packet.claims.some((c) => c.claim_id === uid(1033)));
  assert.equal(plan.packet.claims.length + plan.claims_left_out, 12);
  assert.ok(plan.packet.notes.some((n) => /with an options list/.test(n)));
  const cov = Object.fromEntries(
    plan.option_coverage.map((c) => [c.ref, [c.linked, c.read]]),
  );
  assert.deepEqual(cov, {
    O1: [0, 0],
    O2: [1, 1],
    O3: [0, 0],
    O4: [0, 0],
    O5: [1, 1],
    O6: [1, 1],
    O7: [0, 0],
    O8: [0, 0],
  });
  // A claim linked to the problem and an option keeps its problem relation and its tag.
  const both = buildAssessmentPacket({
    ...small(),
    claims: [
      {
        relation: 'contradicts' as const,
        evidence: claimEvidence(1),
        options: [uid(2002)],
      },
    ],
  });
  assert.ok(both.ok);
  assert.deepEqual(
    both.packet.claims.map((c) => [c.relation, c.options]),
    [['contradicts', ['O2']]],
  );
  assert.deepEqual(
    both.option_coverage.map((c) => c.read),
    [0, 1],
  );
});

test('ADR-0091: requests also fit the answer cap: fewer assessments per request under a smaller output cap', () => {
  assert.equal(assessmentsPerRequest(), ASSESSMENTS_PER_REQUEST);
  assert.equal(assessmentsPerRequest(16_000), 3);
  assert.equal(assessmentsPerRequest(32_000), 4);
  assert.equal(assessmentsPerRequest(2_000), 1);
  const per = (outputCap?: number) => {
    const plan = buildAssessmentPacket({
      ...large(200_000, 'mid'),
      ...(outputCap ? { output_cap: outputCap } : {}),
    });
    assert.ok(plan.ok);
    return plan.batches.map((refs) =>
      packetForOptions(plan.packet, refs).options.reduce(
        (n, o) => n + o.rubrics.length,
        0,
      ),
    );
  };
  assert.ok(per().every((n) => n <= 4));
  assert.ok(per(16_000).every((n) => n <= 3));
  assert.ok(per(16_000).length > per().length);
  // One option still goes alone even when its two rubrics pass the per-request number.
  assert.ok(per(2_000).every((n) => n <= 2));
});
