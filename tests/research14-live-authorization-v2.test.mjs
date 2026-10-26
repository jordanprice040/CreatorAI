import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import {
  assertScope,
  check,
  DIR,
} from '../scripts/check-research14-live-authorization-v2.mjs';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const p = await read(DIR + 'authorization-plan.json'),
  a = await read(DIR + 'availability-plan.json'),
  s = await read(
    'tracking/evidence/discovery-research14-runner/execution-plan.json',
  );
// The live run this authorization admitted has finished, and the studio's sources
// have changed since it was reviewed. The spent authorization must now be refused.
test('spent combined authorization is refused against the changed tree, without secrets', async () => {
  await assert.rejects(check());
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
      'scripts/run-research14-v2-approved-live.ps1',
      '-ApprovedAuthorizationHash',
      '581dd0e6e30b3626a80a0657a6e169d5e11b9e6361a3c2c721a04919db7e8286',
      '-AuthorizationReviewReceipt',
      'missing-review.json',
    ],
    { encoding: 'utf8', timeout: 30000 },
  );
  assert.notEqual(r.status, 0);
  // Either the stale-source gate or the approval gate refuses first.
  assert.match(
    r.stdout + r.stderr,
    /Exact new combined approval required|ERR_ASSERTION/,
  );
  assert.doesNotMatch(r.stdout + r.stderr, /session.dpapi|Unprotect/);
});
