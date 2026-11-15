import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildBlockers,
  connectionDataBlocker,
  contractDataClass,
  dataClassName,
  type SpecContent,
} from '@creator/contracts';
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
  // ADR-0109: a build runs at most 30 cases (it was 10).
  many.acceptance_checks[0]!.cases = Array.from({ length: 30 }, () => ({
    ...c,
  }));
  assert.match(
    buildBlockers(many, 'T1')[0]!,
    /31 test cases across its checks, and a build runs at most 30/,
  );
  many.acceptance_checks[0]!.cases.pop();
  assert.ok(
    !buildBlockers(many, 'T1').some((b) => /test cases across/.test(b)),
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

test('build blockers: the build data class must cover every frozen data contract', () => {
  assert.equal(contractDataClass(BUILD_FIXTURE_SPEC), 'synthetic');
  for (const c of ['synthetic', 'public', 'private_approved'] as const)
    assert.deepEqual(buildBlockers(BUILD_FIXTURE_SPEC, 'T1', c), []);

  const pub = clone(BUILD_FIXTURE_SPEC);
  pub.data_contracts[0]!.data_class = 'public';
  assert.equal(contractDataClass(pub), 'public');
  const why = buildBlockers(pub, 'T1', 'synthetic');
  assert.match(
    why[0]!,
    /^The spec's data contract "checklist\/1" \(public\) is above the synthetic data this build is classified for\. A fixture workspace builds only with synthetic data/,
  );
  assert.match(why.at(-1)!, /Revise the spec/);
  assert.deepEqual(buildBlockers(pub, 'T1', 'public'), []);
  // Without a class (the spec-row note before a plan exists) the contracts are not judged.
  assert.deepEqual(buildBlockers(pub, 'T1'), []);

  const priv = clone(BUILD_FIXTURE_SPEC);
  priv.data_contracts.push({
    name: 'roster',
    description: 'Approved private roster',
    data_class: 'private_approved',
  });
  assert.equal(contractDataClass(priv), 'private_approved');
  assert.match(
    buildBlockers(priv, 'T1', 'public')[0]!,
    /"roster" \(approved private\) is above the public data .* Classify the build for approved private data \(the plan's data_class "private_approved"\)/,
  );
  assert.deepEqual(buildBlockers(priv, 'T1', 'private_approved'), []);
});

test('connection data blocker: a plan connection must allow the build data class', () => {
  assert.equal(
    connectionDataBlocker(['synthetic', 'public'], 'public', 'My plan'),
    null,
  );
  const why = connectionDataBlocker(
    ['synthetic', 'public'],
    'private_approved',
    'My plan',
  );
  assert.match(
    why!,
    /^The plan connection "My plan" doesn't allow approved private data, and this build is classified for it\. Allow approved private data under Models and connections › Change caps or allowed work, then accept the changed caps/,
  );
  assert.equal(dataClassName('private_approved'), 'approved private');
  assert.equal(dataClassName('public'), 'public');
});
