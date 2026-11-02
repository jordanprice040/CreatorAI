import test from 'node:test';
import assert from 'node:assert/strict';
import { buildBlockers, type SpecContent } from '@creator/contracts';
import { BUILD_FIXTURE_SPEC, FIXTURE_SPEC } from '@creator/domain';

const clone = (s: SpecContent): SpecContent => structuredClone(s);

test('build blockers: a buildable task has none; a check with no cases is said in words', () => {
  assert.deepEqual(buildBlockers(BUILD_FIXTURE_SPEC, 'T1'), []);

  const none = clone(BUILD_FIXTURE_SPEC);
  delete none.acceptance_checks[0]!.cases;
  const why = buildBlockers(none, 'T1');
  assert.match(why[0]!, /^Check A1 of task T1 has no test cases\./);
  assert.match(why[0]!, /Add a case/);
  assert.match(why.at(-1)!, /Revise the spec/);
  assert.ok(!why.join(' ').includes('Too small'));
  // The seeded fixture spec (the review's case): its builder task's check has no cases.
  assert.match(
    buildBlockers(FIXTURE_SPEC, 'T1')[0]!,
    /^Check A1 of task T1 has no test cases\./,
  );
  assert.match(
    buildBlockers(FIXTURE_SPEC, 'T2')[0]!,
    /depend on no other task/,
  );

  const both = clone(BUILD_FIXTURE_SPEC);
  for (const a of both.acceptance_checks) delete a.cases;
  assert.match(
    buildBlockers(both, 'T1')[0]!,
    /^Checks A1 and A2 of task T1 have no test cases\./,
  );
});

test('build blockers: other methods, too many cases, no held-out case, wrong task', () => {
  const manual = clone(BUILD_FIXTURE_SPEC);
  manual.acceptance_checks[1]!.method = 'manual_review';
  assert.match(
    buildBlockers(manual, 'T1')[0]!,
    /^Check A2 \(manual review\) of task T1 is not an automated test\./,
  );

  const many = clone(BUILD_FIXTURE_SPEC);
  const c = many.acceptance_checks[0]!.cases![0]!;
  many.acceptance_checks[0]!.cases = Array.from({ length: 10 }, () => ({
    ...c,
  }));
  assert.match(
    buildBlockers(many, 'T1')[0]!,
    /11 test cases across its checks, and a build runs at most 10/,
  );

  const seen = clone(BUILD_FIXTURE_SPEC);
  seen.acceptance_checks[1]!.cases![0]!.held_out = false;
  assert.match(buildBlockers(seen, 'T1')[0]!, /is held out/);

  const unchecked = clone(BUILD_FIXTURE_SPEC);
  unchecked.tasks[0]!.acceptance = [];
  assert.match(buildBlockers(unchecked, 'T1')[0]!, /no acceptance checks/);

  assert.deepEqual(buildBlockers(BUILD_FIXTURE_SPEC, 'T9'), [
    'Task T9 is not in this spec version.',
  ]);
});
