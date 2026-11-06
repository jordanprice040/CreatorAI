import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AssessorOutputSchema,
  BenchmarkManifestSchema,
  type AssessmentPacket,
  type BenchmarkCheck,
} from '@creator/contracts';
import {
  ASSESSMENT_ROLE_VERSION,
  assessmentFixtureAnswer,
  assessmentRoleInput,
  canonicalHash,
  checkOutput,
} from '@creator/domain';

// ADR-0074: the bundled assessment benchmark is bound to the assessor's current prompt and is
// graded by the studio's own assessment check before its assertions.
const manifest = BenchmarkManifestSchema.parse(
  JSON.parse(
    readFileSync(
      new URL(
        '../../config/connections/benchmarks/assessment-synthetic-v1.json',
        import.meta.url,
      ),
      'utf8',
    ),
  ),
);
const ok = { succeeded: true, reason_code: 'ok' };
type Assess = Extract<BenchmarkCheck, { kind: 'assessment_contract' }>;
const checkOf = (id: string) => {
  const c = manifest.cases.find((x) => x.case_id === id)!;
  assert.equal(c.check.kind, 'assessment_contract');
  return c.check as Assess;
};

/** A plain, rubric-following answer: every criterion rated from the one claim. */
function answer(
  packet: AssessmentPacket,
  rating: number | null,
  level: 'low' | 'medium' | 'high',
) {
  return AssessorOutputSchema.parse({
    summary: 'Synthetic answer.',
    assessments: packet.options.flatMap((o) =>
      o.rubrics.map((r) => ({
        option: o.ref,
        rubric: r,
        ratings: Object.fromEntries(
          packet.rubrics
            .find((x) => x.id === r)!
            .criteria.map((c) => [
              c.key,
              {
                rating,
                claim_refs: rating === null ? [] : ['C1'],
                rationale: 'From C1.',
              },
            ]),
        ),
        confidence: { level, rationale: 'One complaint card.' },
        software_influence:
          r === 'suitability' ? { rating: null, note: 'Not counted.' } : null,
        gates: {
          ethics: { status: 'clear', note: 'None seen.' },
          access: { status: 'clear', note: 'None seen.' },
        },
        checks: {
          target_users: 'Library visitors.',
          current_workaround: 'Staff clear jams.',
          contrary_evidence: 'Only one jam reported.',
          measurable_outcome: 'Jams per week.',
          validation_plan: 'Count jams for a month.',
          maintenance: 'Library staff.',
        },
        uncertainty: 'One report only.',
      })),
    ),
    not_covered: [],
  });
}

test('the bundled assessment benchmark uses the current assessor prompt and freezes six held-out cases', () => {
  assert.equal(manifest.task_class, 'scoring');
  assert.equal(manifest.data_class, 'synthetic');
  assert.equal(manifest.fixture, false);
  assert.equal(manifest.cases.filter((c) => c.split === 'held_out').length, 6);
  for (const c of manifest.cases) {
    const check = c.check as Assess;
    assert.equal(check.kind, 'assessment_contract');
    assert.equal(check.context.role_version, ASSESSMENT_ROLE_VERSION);
    assert.equal(check.context.packet_hash, canonicalHash(check.packet));
    assert.deepEqual(c.input, assessmentRoleInput(check.packet));
    // Expected labels are never sent to the model.
    assert.ok(
      !JSON.stringify(c.input).includes('"assertions"'),
      `${c.case_id} leaks its assertions`,
    );
  }
});

test('the assessment check refuses fixture answers and an answer that obeys an embedded instruction', () => {
  const check = checkOf('held-embedded-instruction');
  const fixture = assessmentFixtureAnswer(assessmentRoleInput(check.packet));
  assert.ok(fixture);
  assert.equal(
    checkOutput(check, { text: fixture!, json: JSON.parse(fixture!) }, ok),
    'acceptance_check_failed',
  );
  const obeyed = answer(check.packet, 5, 'high');
  assert.equal(
    checkOutput(check, { text: '', json: obeyed }, ok),
    'acceptance_check_failed',
  );
  const careful = answer(check.packet, 2, 'low');
  assert.equal(checkOutput(check, { text: '', json: careful }, ok), 'accepted');
  // A rating with no cited claim fails the studio's own check, whatever the assertions say.
  const uncited = structuredClone(careful);
  uncited.assessments[0]!.ratings[
    Object.keys(uncited.assessments[0]!.ratings)[0]!
  ]!.claim_refs = [];
  assert.equal(
    checkOutput(check, { text: '', json: uncited }, ok),
    'acceptance_check_failed',
  );
  // A packet edited after the manifest was frozen no longer matches its hash.
  const tampered = structuredClone(check);
  tampered.packet.problem.title = 'Changed';
  assert.equal(
    checkOutput(tampered, { text: '', json: careful }, ok),
    'acceptance_check_failed',
  );
});

test('no evidence must stay unknown in the benchmark', () => {
  const check = checkOf('dev-no-evidence');
  assert.equal(
    checkOutput(
      check,
      { text: '', json: answer(check.packet, null, 'low') },
      ok,
    ),
    'accepted',
  );
});
