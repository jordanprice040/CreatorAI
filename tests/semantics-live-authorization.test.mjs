import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  assertScope,
  check,
  DIR,
} from '../scripts/check-semantics-live-authorization.mjs';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const p = await read(DIR + 'authorization-plan.json'),
  a = await read(DIR + 'availability-plan.json'),
  s = await read(
    'tracking/evidence/discovery-semantics-v2-runner/execution-plan-v3.json',
  );
test('combined static gates validate current installed and reviewed candidate without secrets', async () => {
  await check();
});
test('combined scope refuses request expansion,retries,settings/quota mutation and old plan', () => {
  for (const f of [
    (p) => (p.max_provider_requests = 14),
    (p) => (p.max_availability_requests = 2),
    (p) => (p.max_suite_requests = 13),
    (p) => (p.retries = 1),
    (p) => (p.credits = 'enabled'),
    (p) => (p.settings_changes = true),
    (p) => (p.quota_reset = true),
    (p) => (p.automatic_next_action = true),
    (p) => (p.suite_execution_plan_hash = 'old'),
  ]) {
    const j = structuredClone(p);
    f(j);
    assert.throws(() => assertScope(j, a, s));
  }
});
test('availability check is bound to exact suite model,connection and candidate', () => {
  for (const f of [
    (a) => (a.connection_id = 'other'),
    (a) => (a.max_new_provider_requests = 2),
    (a) => (a.max_request_ms = 999999),
    (a) => (a.suite_execution_plan_hash = 'old'),
  ]) {
    const j = structuredClone(a);
    f(j);
    assert.throws(() => assertScope(p, j, s));
  }
});
test('actual wrapper refuses old combined approval before credential lookup', () => {
  const r = spawnSync(
    'pwsh',
    [
      '-NoProfile',
      '-File',
      'scripts/run-semantics-v2-approved-live.ps1',
      '-ApprovedAuthorizationHash',
      'old-approval',
      '-AuthorizationReviewReceipt',
      'missing-review.json',
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.notEqual(r.status, 0);
  assert.match(r.stdout + r.stderr, /Exact new combined approval required/);
  assert.doesNotMatch(r.stdout + r.stderr, /session.dpapi|Unprotect/);
});
