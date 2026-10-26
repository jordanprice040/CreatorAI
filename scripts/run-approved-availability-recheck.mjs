// Exactly one newly approved availability check on the reviewed schema-28 candidate.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { PlanConnectionDetailSchema } from '../packages/contracts/dist/index.js';
import { canonicalHash } from '../packages/domain/dist/index.js';
const dir = 'tracking/evidence/availability-recheck-live-2026-10-22/';
const plan = JSON.parse(
  await readFile(
    'tracking/evidence/availability-recheck-implementation/candidate-plan.json',
    'utf8',
  ),
);
const sha = (b) => createHash('sha256').update(b).digest('hex');
for (const [p, h] of Object.entries(plan.source_sha256))
  assert.equal(sha(await readFile(p)), h, p);
const bundleBytes = await readFile(
  join(plan.install_dir, 'studio/bundle-manifest.json'),
);
assert.equal(sha(bundleBytes), plan.bundle_manifest_sha256);
for (const f of JSON.parse(bundleBytes).files) {
  assert.ok(!f.path.includes('..') && !/^(?:[a-z]:|[\\/])/i.test(f.path));
  assert.equal(
    sha(await readFile(join(plan.install_dir, 'studio', f.path))),
    f.sha256,
    f.path,
  );
}
assert.equal(plan.max_new_provider_requests, 1);
assert.equal(plan.retries, 0);
if (process.argv[2] === '--check') {
  console.log(
    JSON.stringify({
      state: 'static_check_passed',
      plan_hash: canonicalHash(plan),
      new_provider_calls: 0,
    }),
  );
  process.exit(0);
}
assert.equal(process.argv[2], '--run-approved-once');
await mkdir(dir, { recursive: true });
const save = (name, data) =>
  writeFile(dir + name, JSON.stringify(data, null, 2) + '\n', { flag: 'wx' });
await save('operation.lock', {
  plan_hash: canonicalHash(plan),
  started_at: new Date().toISOString(),
});
let raw = '';
for await (const c of process.stdin) raw += c;
const secret = JSON.parse(raw);
raw = '';
let csrf,
  endpointAttempted = false;
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
  const value = await r.json();
  if (!r.ok) {
    await save('http-refusal.json', { path, status: r.status, value });
    throw Error(`HTTP ${r.status}; stop without retry.`);
  }
  return value;
};
const detail = async () => {
  const { sign_in_attempt, ...d } = await api(base);
  return PlanConnectionDetailSchema.parse(d);
};
const summarize = (d) => ({
  observed_at: new Date().toISOString(),
  settings_hash: d.connection.settings_hash,
  credits: d.connection.credits.state,
  quota: d.connection.quota,
  usage: d.usage,
  model_access: d.model_access,
  qualifications: d.qualifications,
  blockers: d.blockers,
});
try {
  const session = await api('auth/session');
  assert.equal(session.authenticated, true);
  csrf = session.csrf_token;
  const before = await detail();
  assert.equal(before.connection.fixture, false);
  assert.equal(before.connection.settings_hash, plan.settings_hash);
  assert.equal(before.connection.credits.state, 'confirmed_off');
  assert.equal(
    before.connection.settings.caps.shared.max_model_requests_per_day,
    40,
  );
  assert.equal(before.connection.settings.caps.shared.max_in_flight, 1);
  assert.equal(
    before.connection.settings.caps.responses.request_timeout_ms,
    120000,
  );
  assert.equal(
    before.connection.settings.caps.responses.max_output_chars,
    16000,
  );
  assert.deepEqual(before.blockers, []);
  assert.equal(before.usage.in_flight, 0);
  assert.equal(before.usage.unresolved, 0);
  assert.ok(before.usage.last_24h_requests < 40);
  assert.ok(
    before.model_access.some(
      (a) =>
        a.model_id === plan.model_id &&
        a.path === 'responses' &&
        a.access === 'verified',
    ),
  );
  const oldRequests = await api(base + '/requests');
  await save('before.json', {
    ...summarize(before),
    request_ids: oldRequests.map((r) => r.id),
  });
  const body = {
    expected_version: before.connection.version,
    model_id: plan.model_id,
    path: 'responses',
    expires_in_minutes: 10,
    intent: 'availability_recheck',
  };
  await save('grant-intent.json', body);
  const grant = await api(base + '/verification-grants', body);
  await save('grant.json', grant);
  assert.equal(grant.intent, 'availability_recheck');
  assert.equal(grant.used, 0);
  assert.equal(grant.max_requests, 1);
  assert.equal(grant.connection_id, plan.connection_id);
  assert.equal(grant.model_id, plan.model_id);
  await save('dispatch-intent.json', {
    grant_id: grant.id,
    model_id: plan.model_id,
    purpose: 'availability_recheck',
    max_requests: 1,
    retry: false,
    owner_authorization: plan.owner_authorization,
  });
  endpointAttempted = true;
  const result = await api(
    base + '/availability-recheck',
    { grant_id: grant.id, model_id: plan.model_id },
    135000,
  );
  await save('provider-result.json', result);
  const after = await detail();
  const requests = await api(base + '/requests');
  const oldIds = new Set(oldRequests.map((r) => r.id));
  const added = requests.filter((r) => !oldIds.has(r.id));
  await save('after.json', {
    ...summarize(after),
    saved_requests: requests.length,
    new_requests: added,
  });
  assert.equal(added.length, 1);
  assert.equal(added[0].id, result.request_id);
  assert.equal(added[0].purpose, 'availability_recheck');
  assert.equal(added[0].grant_id, grant.id);
  assert.deepEqual(after.model_access, before.model_access);
  assert.deepEqual(after.qualifications, before.qualifications);
  assert.equal(after.connection.settings_hash, plan.settings_hash);
  assert.equal(after.connection.credits.state, 'confirmed_off');
  const summary = {
    finished_at: new Date().toISOString(),
    ...result,
    quota: after.connection.quota,
    usage: after.usage,
    remaining_daily_requests: 40 - after.usage.last_24h_requests,
    new_requests: 1,
    saved_requests: requests.length,
    access_and_qualifications_unchanged: true,
    settings_and_credits_unchanged: true,
    retry: false,
    qualification_dispatched: false,
    plan_hash: canonicalHash(plan),
  };
  await save('result.json', summary);
  console.log(JSON.stringify(summary));
} catch (e) {
  await save('stopped.json', {
    at: new Date().toISOString(),
    message: e.message,
    endpoint_attempted: endpointAttempted,
    retry: false,
    instruction:
      'Preserve lock; only read-only inspection/reconciliation next.',
  });
  throw e;
} finally {
  delete secret.session;
}
