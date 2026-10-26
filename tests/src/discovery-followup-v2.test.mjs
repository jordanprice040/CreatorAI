import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  canonicalHash,
  checkOutput,
  checkDiscoveryOutput,
} from '../../packages/domain/dist/index.js';
import {
  checkFollowup,
  checkSeparateReview,
  assertExecutionBinding,
  verifyRuntimeBindings,
} from '../../scripts/check-discovery-followup-v2.mjs';
import {
  executeFollowup,
  FOLLOWUP_LIMITS,
} from '../../scripts/discovery-followup-core.mjs';

const { manifests, controls, frozen } = await checkFollowup({
  requirePlan: false,
});
const score = (c, json) =>
  checkOutput(
    c.check,
    { text: JSON.stringify(json), json },
    { succeeded: true, reason_code: 'offline_test' },
  );

test('schema-28 execution binding refuses stale schema, changed candidate, scope or weakened limits', async () => {
  const { runtime, packaged } = await checkFollowup({ requirePlan: false });
  const plan = {
    format: 'discovery-followup-execution/2',
    packet_freeze_path: 'tracking/evidence/discovery-followup-v1/freeze.json',
    packet_freeze_hash: canonicalHash(frozen),
    runtime_candidate_plan_hash: canonicalHash(runtime),
    required_schema: 28,
    bundle_manifest_sha256: runtime.bundle_manifest_sha256,
    desktop_payload_sha256: packaged.packaged_desktop_sha256,
    installer_sha256: runtime.installer_sha256,
    proposed_settings_hash: runtime.settings_hash,
    role_prompt_hash: frozen.prompt_hash,
    limits: structuredClone(FOLLOWUP_LIMITS),
    provider_availability_max_age_ms: 900000,
    min_held_out_cases_per_class: 4,
    floor: { numerator: 1, denominator: 1 },
    settings_changes: false,
    installation_required: false,
    migration_required: false,
    automatic_next_actions: [],
  };
  for (const key of [
    'workspace_id',
    'connection_id',
    'model_id',
    'install_dir',
  ])
    plan[key] = runtime[key];
  assertExecutionBinding(plan, frozen, runtime, packaged);
  for (const change of [
    (p) => {
      p.required_schema = 27;
    },
    (p) => {
      p.bundle_manifest_sha256 = frozen.candidate_manifest_sha256;
    },
    (p) => {
      p.desktop_payload_sha256 = runtime.desktop_sha256;
    },
    (p) => {
      p.packet_freeze_hash = '0'.repeat(64);
    },
    (p) => {
      p.model_id = 'another-model';
    },
    (p) => {
      p.connection_id = 'another-connection';
    },
    (p) => {
      p.limits.retries = 1;
    },
    (p) => {
      p.min_held_out_cases_per_class = 3;
    },
    (p) => {
      p.provider_availability_max_age_ms = 86400000;
    },
    (p) => {
      p.automatic_next_actions = ['pilot'];
    },
  ]) {
    const changed = structuredClone(plan);
    change(changed);
    assert.throws(() =>
      assertExecutionBinding(changed, frozen, runtime, packaged),
    );
  }
});

test('changed source bytes are rejected by the actual runtime binding gate', async () => {
  const { runtime } = await checkFollowup({ requirePlan: false });
  await verifyRuntimeBindings(runtime);
  const changed = structuredClone(runtime);
  const path = Object.keys(changed.source_sha256)[0];
  changed.source_sha256[path] = '0'.repeat(64);
  await assert.rejects(() => verifyRuntimeBindings(changed), /AssertionError/);
});

test('historical execution rejects repaired source while packet bytes remain frozen', async () => {
  const { checkFollowup: oldCheck } =
    await import('../../scripts/check-discovery-followup.mjs');
  await assert.rejects(
    () => oldCheck({ requirePlan: false }),
    /AssertionError/,
  );
  const oldFreeze = JSON.parse(
    await readFile(
      'tracking/evidence/discovery-followup-v1/freeze.json',
      'utf8',
    ),
  );
  assert.equal(
    canonicalHash(oldFreeze),
    '55da91cabef9163692508132e936b9a2e5df9815f071ca93642db0cd091f2266',
  );
  const current = await checkFollowup({ requirePlan: false });
  assert.equal(current.checks, 108);
  assert.equal(current.manifests.flatMap((m) => m.cases).length, 12);
});
test('12 fresh exact production packets retain all positive/negative controls and disclosed semantic limits', async () => {
  assert.equal(frozen.local_controls, 108);
  for (const m of manifests)
    for (const c of m.cases) {
      const control = controls.find((v) => v.case_id === c.case_id);
      assert.equal(score(c, control.gold), 'accepted');
      assert.equal(
        checkDiscoveryOutput(
          c.check.task_kind,
          control.negative,
          c.check.packet,
          c.check.context,
        ).ok,
        true,
      );
      assert.equal(score(c, control.negative), 'acceptance_check_failed');
      assert.equal(
        score(c, control.manual_negative),
        'accepted',
        'Structural acceptance is not source entailment.',
      );
      for (const bad of [
        {},
        { ...control.gold, fixture: true },
        { ...control.gold, extra: true },
      ])
        assert.notEqual(score(c, bad), 'accepted');
      assert.equal(control.manual_review.result, 'not_reviewed');
      assert.equal(control.manual_review.checks.length, 3);
      assert.ok(
        !c.input.some((v) => /manual_review|prospective_checks/.test(v.text)),
      );
    }
  const names = new Set(
    manifests.flatMap((m) => m.cases.map((c) => c.case_id)),
  );
  for (let version = 1; version <= 5; version++)
    for (const task of [
      'research_synthesis',
      'candidate_generation',
      'scoring',
    ]) {
      const old = JSON.parse(
        await readFile(
          `config/connections/benchmarks/discovery-synthetic-v${version}/${task}.json`,
          'utf8',
        ),
      );
      assert.ok(old.cases.every((c) => !names.has(c.case_id)));
    }
});
test('two-finding revision and identity swaps cannot masquerade as correct automatic evidence', () => {
  const revision = manifests[0].cases[5];
  assert.equal(revision.check.task_kind, 'revise');
  const ctl = controls.find((x) => x.case_id === revision.case_id);
  assert.equal(ctl.inputs[1].output.reviews[0].findings.length, 2);
  assert.match(ctl.gold.response_to_findings, /seven-versus-two/);
  assert.equal(ctl.gold.recommendation, 'not_recommended');
  for (const c of [manifests[1].cases[0], manifests[1].cases[5]]) {
    const original = controls.find((x) => x.case_id === c.case_id).gold;
    const swapped = structuredClone(original);
    [swapped.reviews[0].proposal, swapped.reviews[1].proposal] = [
      swapped.reviews[1].proposal,
      swapped.reviews[0].proposal,
    ];
    assert.notEqual(score(c, swapped), 'accepted');
    const duplicated = structuredClone(original);
    duplicated.reviews.push(structuredClone(duplicated.reviews[1]));
    assert.notEqual(score(c, duplicated), 'accepted');
  }
});
function fixture({
  failAt,
  failureKind = 'failed',
  failSignal = 'provider_error',
  throwAt,
  advanceAfter,
  clock = () => 0,
  signal,
  deadlineAt,
  extra = false,
  journalFail = false,
} = {}) {
  let calls = 0,
    starts = 0,
    finishes = 0,
    concurrent = 0,
    maxConcurrent = 0;
  const events = [],
    bounds = [];
  const run = () =>
    executeFollowup({
      manifests: extra
        ? [...manifests, { ...manifests[0], cases: [manifests[0].cases[0]] }]
        : manifests,
      now: clock,
      signal,
      deadlineAt,
      journal: async (event) => {
        events.push(event);
        if (journalFail && event.kind === 'intent') throw Error('disk full');
      },
      adapter: {
        start: async () => {
          starts++;
          return `fixture-${starts}`;
        },
        invoke: async (m, c, q, b) => {
          calls++;
          concurrent++;
          maxConcurrent = Math.max(maxConcurrent, concurrent);
          bounds.push(b);
          await Promise.resolve();
          concurrent--;
          if (advanceAfter) advanceAfter(calls);
          if (calls === throwAt) throw Error('unknown delivery exception');
          return calls === failAt
            ? { outcome: { kind: failureKind }, signal: failSignal }
            : { outcome: { kind: 'completed' }, signal: 'accepted' };
        },
        finish: async () => {
          finishes++;
          return { state: 'qualified' };
        },
      },
    });
  return {
    run,
    events,
    bounds,
    counters: () => ({ calls, starts, finishes, maxConcurrent }),
  };
}
test('actual runner control loop enforces 12 sequential attempts and intent-before-delivery', async () => {
  const f = fixture();
  const r = await f.run();
  assert.equal(r.attempted, 12);
  assert.deepEqual(f.counters(), {
    calls: 12,
    starts: 2,
    finishes: 2,
    maxConcurrent: 1,
  });
  assert.ok(
    f.bounds.every(
      (b) => b.timeout_ms === 120000 && b.max_output_chars === 16000,
    ),
  );
  assert.equal(f.events.filter((e) => e.kind === 'intent').length, 12);
  assert.equal(f.events.filter((e) => e.kind === 'outcome').length, 12);
  assert.equal(f.events[0].kind, 'intent');
});
for (const failure of [
  ['failed', 'provider_error'],
  ['unknown', 'timeout'],
  ['rejected', 'refused'],
  ['completed', 'acceptance_check_failed'],
  ['failed', 'subscription_sharing_usage_limit_exceeded'],
]) {
  test(`first ${failure.join('/')} preserves outcome and prevents retry/next class`, async () => {
    const f = fixture({
      failAt: 2,
      failureKind: failure[0],
      failSignal: failure[1],
    });
    await assert.rejects(f.run, /Stopped at/);
    assert.equal(f.counters().calls, 2);
    assert.equal(f.counters().starts, 1);
    assert.equal(f.counters().finishes, failure[0] === 'unknown' ? 0 : 1);
    assert.equal(
      f.events.filter((e) => e.kind === 'outcome').at(-1).results.length,
      2,
    );
  });
}
test('delivery exception is not retried and does not close an uncertain qualification', async () => {
  const f = fixture({ throwAt: 1 });
  await assert.rejects(f.run, /unknown delivery/);
  assert.equal(f.counters().calls, 1);
  assert.equal(f.counters().finishes, 0);
  assert.equal(f.events.at(-1).kind, 'intent');
});
test('durable-intent failure refuses delivery', async () => {
  const f = fixture({ journalFail: true });
  await assert.rejects(f.run, /disk full/);
  assert.equal(f.counters().calls, 0);
});
test('cancellation before start or after first result prevents further delivery', async () => {
  const early = new AbortController();
  early.abort();
  const a = fixture({ signal: early.signal });
  await assert.rejects(a.run, /Cancelled/);
  assert.equal(a.counters().starts, 0);
  const late = new AbortController();
  const b = fixture({ signal: late.signal, advanceAfter: () => late.abort() });
  await assert.rejects(b.run, /Stopped after outcome/);
  assert.equal(b.counters().calls, 1);
  assert.equal(b.counters().finishes, 0);
  assert.equal(b.events.at(-1).kind, 'outcome');
});
test('global deadline includes prior overhead and clamps remaining request time', async () => {
  let time = 0;
  const f = fixture({
    clock: () => time,
    deadlineAt: 50,
    advanceAfter: () => {
      time = 51;
    },
  });
  await assert.rejects(f.run, /Stopped after outcome/);
  assert.equal(f.bounds[0].timeout_ms, 50);
  assert.equal(f.counters().calls, 1);
  const already = fixture({ clock: () => 51, deadlineAt: 50 });
  await assert.rejects(already.run, /deadline/);
  assert.equal(already.counters().starts, 0);
});
test('hard request cap prevents any thirteenth request even with extra input', async () => {
  const f = fixture({ extra: true });
  await assert.rejects(f.run, /Request cap/);
  assert.equal(f.counters().calls, FOLLOWUP_LIMITS.max_new_requests);
  assert.equal(f.counters().starts, 2);
});
test('separate review gate rejects unreviewed, wrong binding, author involvement and unsupported criteria', async () => {
  const packet = JSON.parse(
    await readFile(
      'tracking/evidence/discovery-followup-proposal/review-packet.json',
      'utf8',
    ),
  );
  const template = JSON.parse(
    await readFile(
      'tracking/evidence/discovery-followup-proposal/review-response-template.json',
      'utf8',
    ),
  );
  assert.throws(() => checkSeparateReview(packet, template));
  const valid = structuredClone(template);
  valid.status = 'completed';
  valid.reviewer = 'Synthetic unit fixture; no actual reviewer';
  valid.reviewer_type = 'model';
  valid.prior_authoring_or_implementation_involvement = false;
  valid.prior_output_or_author_review_exposure = 'Fixture only';
  valid.independence_explanation = 'Synthetic contract exercise; not a review';
  for (const c of valid.cases) {
    c.result = 'supported';
    for (const r of c.checklist_results) {
      r.result = 'supported';
      r.explanation = 'Fixture only';
      r.evidence_locators = ['fixture.field'];
    }
  }
  assert.equal(valid.packet_hash, canonicalHash(packet));
  checkSeparateReview(packet, valid);
  for (const change of [
    (v) => {
      v.packet_hash = '0'.repeat(64);
    },
    (v) => {
      v.prior_authoring_or_implementation_involvement = true;
    },
    (v) => {
      v.cases[0].output_hash = '0'.repeat(64);
    },
    (v) => {
      v.cases[0].checklist_results[0].explanation = '';
    },
    (v) => {
      v.cases[0].checklist_results[0].evidence_locators = [];
    },
    (v) => {
      v.cases[0].findings = [{ resolved: false }];
    },
    (v) => {
      v.cases[1] = v.cases[0];
    },
  ]) {
    const changed = structuredClone(valid);
    change(changed);
    assert.throws(() => checkSeparateReview(packet, changed));
  }
});
