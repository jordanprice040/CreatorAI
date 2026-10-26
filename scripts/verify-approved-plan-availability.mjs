// One explicitly approved availability recovery. Never starts qualification.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { PlanConnectionDetailSchema } from '../packages/contracts/dist/index.js';
import { canonicalHash } from '../packages/domain/dist/index.js';
import { checkFollowup } from './check-discovery-followup.mjs';

const dir = 'tracking/evidence/approved-availability-check-2026-10-22/';
const { plan } = await checkFollowup();
const scope = {
  connection_id: plan.connection_id,
  workspace_id: plan.workspace_id,
  model_id: plan.model_id,
  settings_hash: plan.proposed_settings_hash,
  max_new_provider_requests: 1,
  quota_observation_reset: true,
  grant_path: 'responses',
  grant_expiry_minutes: 10,
  max_request_ms: 120000,
  max_output_chars: 16000,
  retries: 0,
  new_metered_spend_nano_usd: '0',
  qualification_dispatch: false,
  authorization:
    'Owner approved the exact one-request recovery scope after DISCOVERY_STARTUP_READINESS_2026-10-22.md; user: I approve that.',
};
if (process.argv[2] === '--check') {
  console.log(JSON.stringify({ state: 'static_scope_valid', scope, calls: 0 }));
  process.exit(0);
}
assert.equal(process.argv[2], '--run-approved-once');
await mkdir(dir, { recursive: true });
const save = (name, value) =>
  writeFile(dir + name, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
await save('operation.lock', {
  started_at: new Date().toISOString(),
  scope_hash: canonicalHash(scope),
});
await save('authorization.json', scope);
await save('script-binding.json', {
  sha256: createHash('sha256')
    .update(await readFile(new URL(import.meta.url)))
    .digest('hex'),
  followup_plan_hash: canonicalHash(plan),
});
let input = '';
for await (const c of process.stdin) input += c;
const secret = JSON.parse(input);
input = '';
let csrf,
  dispatchStarted = false,
  dispatchResponse = null;
const base = `workspaces/${plan.workspace_id}/plan-connections/${plan.connection_id}`;
const api = async (path, body, timeout = 15000) => {
  const r = await fetch('http://127.0.0.1:4310/api/' + path, {
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    headers: {
      Cookie: `creator_session=${secret.session.token}`,
      ...(body
        ? { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf }
        : {}),
    },
    signal: AbortSignal.timeout(timeout),
  });
  assert.ok(
    r.ok,
    `Studio ${body ? 'POST' : 'GET'} ${path}: HTTP ${r.status}; no retry.`,
  );
  return r.json();
};
const detail = async () => {
  const { sign_in_attempt, ...value } = await api(base);
  return PlanConnectionDetailSchema.parse(value);
};
const snapshot = (d) => ({
  observed_at: new Date().toISOString(),
  version: d.connection.version,
  settings_hash: d.connection.settings_hash,
  quota: d.connection.quota,
  credits: d.connection.credits.state,
  caps: d.connection.settings.caps,
  usage: d.usage,
  blockers: d.blockers,
  qualifications: d.qualifications.map((q) => ({
    id: q.id,
    state: q.state,
    manifest_hash: q.manifest_hash,
  })),
});
const guard = (d) => {
  assert.equal(d.connection.fixture, false);
  assert.equal(d.connection.settings_hash, scope.settings_hash);
  assert.equal(d.connection.credits.state, 'confirmed_off');
  assert.equal(
    d.connection.settings.caps.shared.max_model_requests_per_day,
    40,
  );
  assert.equal(d.connection.settings.caps.shared.max_in_flight, 1);
  assert.equal(d.connection.settings.caps.responses.request_timeout_ms, 120000);
  assert.equal(d.connection.settings.caps.responses.max_output_chars, 16000);
  assert.equal(d.usage.in_flight, 0);
  assert.equal(d.usage.unresolved, 0);
  assert.ok(d.usage.last_24h_requests < 40);
};
try {
  const session = await api('auth/session');
  assert.equal(session.authenticated, true);
  csrf = session.csrf_token;
  const before = await detail();
  guard(before);
  assert.equal(before.connection.quota.state, 'exhausted');
  const expectedBlocker =
    'The ChatGPT plan usage limit was reached. Plan requests pause; check ChatGPT Settings > Usage.';
  assert.ok(
    before.blockers.length === 1 && before.blockers[0] === expectedBlocker,
    'Only the known quota observation may be reset.',
  );
  const oldRequests = await api(base + '/requests');
  await save('before.json', {
    ...snapshot(before),
    request_ids: oldRequests.map((r) => r.id),
  });
  await save('quota-recheck-intent.json', {
    expected_version: before.connection.version,
    previous_quota: before.connection.quota,
  });
  const reset = await api(base + '/quota-recheck', {
    expected_version: before.connection.version,
  });
  await save('quota-recheck-result.json', reset);
  const resetDetail = await detail();
  guard(resetDetail);
  assert.equal(resetDetail.connection.quota.state, 'unknown');
  assert.deepEqual(resetDetail.blockers, []);
  await save('grant-intent.json', {
    expected_version: resetDetail.connection.version,
    model_id: scope.model_id,
    path: 'responses',
    expires_in_minutes: 10,
  });
  const grant = await api(base + '/verification-grants', {
    expected_version: resetDetail.connection.version,
    model_id: scope.model_id,
    path: 'responses',
    expires_in_minutes: 10,
  });
  await save('grant-result.json', grant);
  assert.equal(grant.max_requests, 1);
  assert.equal(grant.used, 0);
  assert.equal(grant.connection_id, scope.connection_id);
  assert.equal(grant.model_id, scope.model_id);
  await save('verification-intent.json', {
    grant_id: grant.id,
    model_id: scope.model_id,
    max_new_provider_requests: 1,
    no_retry: true,
  });
  dispatchStarted = true;
  // Sole provider-triggering endpoint. No request loop or fallback exists.
  dispatchResponse = await api(
    base + '/verify',
    { grant_id: grant.id, model_id: scope.model_id },
    135000,
  );
  await save('verification-result.json', dispatchResponse);
  const after = await detail();
  const requests = await api(base + '/requests');
  const oldIds = new Set(oldRequests.map((r) => r.id));
  const added = requests.filter((r) => !oldIds.has(r.id));
  await save('after.json', {
    ...snapshot(after),
    total_requests: requests.length,
    new_requests: added,
  });
  assert.ok(
    added.length <= 1,
    'Concurrent/unexpected provider activity detected; do not dispatch more.',
  );
  assert.equal(after.connection.settings_hash, scope.settings_hash);
  assert.equal(after.connection.credits.state, 'confirmed_off');
  assert.deepEqual(
    after.qualifications.map((q) => ({
      id: q.id,
      state: q.state,
      manifest_hash: q.manifest_hash,
    })),
    snapshot(before).qualifications,
  );
  const result = {
    completed_at: new Date().toISOString(),
    verified: dispatchResponse.verified,
    request_id: dispatchResponse.request_id,
    outcome: dispatchResponse.outcome,
    quota: after.connection.quota,
    usage: after.usage,
    new_requests: added.length,
    remaining_daily_requests: 40 - after.usage.last_24h_requests,
    credits: after.connection.credits.state,
    settings_unchanged: true,
    qualification_dispatched: false,
    retry: false,
  };
  await save('result.json', result);
  console.log(JSON.stringify(result));
} catch (e) {
  await save('stopped.json', {
    at: new Date().toISOString(),
    message: e.message,
    dispatch_started: dispatchStarted,
    response_observed: dispatchResponse !== null,
    retry: false,
    recovery:
      'Read-only inspection/reconciliation only. Never delete operation.lock or repeat this approval.',
  });
  throw e;
} finally {
  delete secret.session;
}
