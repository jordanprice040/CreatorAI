import { spawnSync } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { canonicalHash } from '../packages/domain/dist/index.js';
import {
  executeFollowup,
  FOLLOWUP_LIMITS,
} from '../scripts/discovery-followup-core.mjs';
import {
  checkFollowup,
  assertExecutionBinding,
  assertRunnerReview,
  assertInstallation,
  assertConnectionReady,
  verifyHashes,
  sha,
  FOLLOWUP_DIR,
  PLAN_PATH,
} from '../scripts/check-discovery-semantics-runner.mjs';
const { plan, planBytes, manifests } = await checkFollowup();
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const binding = await read(
    'tracking/evidence/discovery-semantics-v2-package/execution-binding.json',
  ),
  candidate = await read(
    'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
  );
test('actual binding gate rejects drift, weakened bounds and scope', () => {
  for (const change of [
    (p) => (p.model_id = 'other'),
    (p) => (p.connection_id = 'other'),
    (p) => (p.required_schema = 27),
    (p) => (p.bundle_manifest_sha256 = '0'.repeat(64)),
    (p) => (p.desktop_payload_sha256 = '0'.repeat(64)),
    (p) => (p.packet_freeze_hash = '0'.repeat(64)),
    (p) => (p.installation_plan_hash = '0'.repeat(64)),
    (p) => (p.limits.retries = 1),
    (p) => (p.floor.numerator = 0),
    (p) => (p.provider_availability_max_age_ms = 9999999),
    (p) => (p.automatic_next_action = true),
    (p) => (p.installation_receipt_required = false),
  ]) {
    const p = structuredClone(plan);
    change(p);
    assert.throws(() => assertExecutionBinding(p, binding, candidate));
  }
});
test('actual source gate refuses changed hashes', async () => {
  await assert.rejects(
    verifyHashes({
      'scripts/qualify-discovery-semantics-v2.mjs': '0'.repeat(64),
    }),
  );
});
const receipt = {
  reviewer_type: 'model',
  prior_implementation_involvement: false,
  status: 'supported_bound_runner',
  execution_plan_hash: canonicalHash(plan),
  artifact_sha256: {
    ...plan.source_sha256,
    [PLAN_PATH]: sha(planBytes),
  },
};
test('runner review must bind exact plan and every source hash', () => {
  assertRunnerReview(receipt, plan, planBytes);
  for (const change of [
    (r) => (r.status = 'pending'),
    (r) => (r.prior_implementation_involvement = true),
    (r) => (r.execution_plan_hash = '0'.repeat(64)),
    (r) =>
      delete r.artifact_sha256['scripts/qualify-discovery-semantics-v2.mjs'],
  ]) {
    const r = structuredClone(receipt);
    change(r);
    assert.throws(() => assertRunnerReview(r, plan, planBytes));
  }
});
const installed = {
  status: 'verified_records_preserved',
  candidate_plan_hash: plan.candidate_plan_hash,
  installation_plan_hash: plan.installation_plan_hash,
  installed_manifest_sha256: plan.bundle_manifest_sha256,
  installed_desktop_sha256: plan.desktop_payload_sha256,
  schema: 28,
  records_unchanged: true,
  settings_unchanged: true,
  credits: 'confirmed_off',
  active_requests: 0,
  unknown_requests: 0,
  backup_verified: true,
};
test('installation evidence required; stale candidate, active/unknown, missing backup and changed records rejected', () => {
  assertInstallation(installed, plan);
  for (const change of [
    (r) => (r.status = 'pending'),
    (r) => (r.schema = 27),
    (r) => (r.candidate_plan_hash = 'old'),
    (r) => (r.records_unchanged = false),
    (r) => (r.backup_verified = false),
    (r) => (r.active_requests = 1),
    (r) => (r.unknown_requests = 1),
  ]) {
    const r = structuredClone(installed);
    change(r);
    assert.throws(() => assertInstallation(r, plan));
  }
});
const now = Date.parse('2026-10-22T18:00:00Z');
const detail = {
  connection: {
    fixture: false,
    settings_hash: plan.proposed_settings_hash,
    credits: { state: 'confirmed_off' },
    quota: { state: 'available', observed_at: new Date(now).toISOString() },
    settings: {
      caps: { shared: { max_model_requests_per_day: 40, max_in_flight: 1 } },
    },
  },
  usage: { in_flight: 0, unresolved: 0, last_24h_requests: 28 },
  blockers: [],
};
test('live admission function rejects stale/future/unknown availability, credits, settings and capacity', () => {
  assertConnectionReady(detail, plan, 12, now);
  for (const change of [
    (d) =>
      (d.connection.quota.observed_at = new Date(now - 900001).toISOString()),
    (d) => (d.connection.quota.observed_at = new Date(now + 1).toISOString()),
    (d) => (d.connection.quota.state = 'unknown'),
    (d) => (d.connection.credits.state = 'enabled'),
    (d) => (d.connection.settings_hash = 'changed'),
    (d) => (d.usage.last_24h_requests = 29),
    (d) => (d.usage.in_flight = 1),
    (d) => (d.usage.unresolved = 1),
    (d) => (d.blockers = ['blocked']),
  ]) {
    const d = structuredClone(detail);
    change(d);
    assert.throws(() => assertConnectionReady(d, plan, 12, now));
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

test('real PowerShell wrapper rejects wrong home and missing installation before secret lookup', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'creator-static-gate-'));
  try {
    const rp = join(dir, 'review.json');
    await writeFile(rp, JSON.stringify(receipt));
    const run = spawnSync(
      'pwsh',
      [
        '-NoProfile',
        '-File',
        'scripts/qualify-discovery-semantics-v2.ps1',
        '-StudioHome',
        join(dir, 'missing-studio'),
        '-ApprovedExecutionPlanHash',
        canonicalHash(plan),
        '-SeparateReviewReceipt',
        rp,
        '-InstallationReceipt',
        join(dir, 'missing-install.json'),
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    assert.notEqual(run.status, 0);
    assert.match(
      run.stdout + run.stderr,
      /StudioHome must match plan before secrets/,
    );
    assert.doesNotMatch(
      run.stdout + run.stderr,
      /DPAPI|postgres.dpapi|session.dpapi/,
    );
  } finally {
    // Temporary test directory retained for inspection.
  }
});
