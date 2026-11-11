import test from 'node:test';
import assert from 'node:assert/strict';
import { AssessmentPacketSchema, type ClaimEvidence } from '@creator/contracts';
import {
  ASSESSMENTS_PER_REQUEST,
  assessmentPreviewHash,
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
const large = (cap: number) => ({
  problem,
  alternatives: Array.from({ length: 8 }, (_, i) =>
    option(i + 1, i % 3 === 2 ? 'process' : 'build', true),
  ),
  claims: Array.from({ length: 30 }, (_, i) => ({
    relation: 'supports' as const,
    evidence: claimEvidence(i + 1, 600),
  })),
  now: NOW,
  input_cap: cap,
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
  assert.ok(at(24_000) >= 1);
  assert.ok(at(40_000) > at(24_000));
  assert.equal(at(120_000), 30);
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
  assert.match(plan.problem, /Option O1/);
  assert.match(plan.problem, /12,000 per request/);
  assert.match(plan.problem, /Change caps/);
});
