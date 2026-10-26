// Authenticated GET-only inspection. Never dispatch inference or reset quota.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { PlanConnectionDetailSchema } from '../packages/contracts/dist/index.js';
import { canonicalHash } from '../packages/domain/dist/index.js';

let input = '';
for await (const chunk of process.stdin) input += chunk;
const secret = JSON.parse(input);
input = '';
const plan = JSON.parse(
  await readFile(
    'tracking/evidence/discovery-followup-v2/execution-plan.json',
    'utf8',
  ),
);
const get = async (path) => {
  const r = await fetch('http://127.0.0.1:4310/api/' + path, {
    headers: { Cookie: `creator_session=${secret.session.token}` },
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(r.ok, `GET ${path}: HTTP ${r.status}`);
  return r.json();
};
const health = await get('health');
const session = await get('auth/session');
assert.equal(
  session.authenticated,
  true,
  'Saved owner session is not valid; do not bypass sign-in.',
);
const path = `workspaces/${plan.workspace_id}/plan-connections/${plan.connection_id}`;
const { sign_in_attempt, ...raw } = await get(path);
const detail = PlanConnectionDetailSchema.parse(raw);
const requests = await get(path + '/requests');
assert.ok(Array.isArray(requests));
const frozen = JSON.parse(await readFile(plan.packet_freeze_path, 'utf8'));
const manifests = await Promise.all(
  frozen.files.map(async (f) => JSON.parse(await readFile(f.path, 'utf8'))),
);
const alreadyAttempted = detail.qualifications
  .filter(
    (q) =>
      q.model_id === plan.model_id &&
      manifests.some(
        (m) =>
          q.task_class === m.task_class && q.manifest_hash === canonicalHash(m),
      ),
  )
  .map((q) => q.id);
delete secret.session;
const states = {};
for (const r of requests) states[r.state] = (states[r.state] ?? 0) + 1;
const now = Date.now();
const observed = Date.parse(detail.connection.quota.observed_at);
const result = {
  observed_at: new Date(now).toISOString(),
  mode: 'authenticated_GET_only',
  execution_plan_hash: canonicalHash(plan),
  already_attempted_qualification_ids: alreadyAttempted,
  packet_unattempted_in_saved_connection: alreadyAttempted.length === 0,
  health,
  authenticated: true,
  connection_id: detail.connection.id,
  settings_hash: detail.connection.settings_hash,
  settings_match_plan:
    detail.connection.settings_hash === plan.proposed_settings_hash,
  credits: detail.connection.credits.state,
  quota: detail.connection.quota,
  provider_available_fresh:
    detail.connection.quota.state === 'available' &&
    Number.isFinite(observed) &&
    observed <= now &&
    now - observed <= plan.provider_availability_max_age_ms,
  quota_observation_is_saved_state_not_live_provider_check: true,
  caps: detail.connection.settings.caps,
  usage: detail.usage,
  remaining_daily_requests:
    detail.connection.settings.caps.shared.max_model_requests_per_day -
    detail.usage.last_24h_requests,
  required_followup_requests: plan.limits.max_new_requests,
  blockers: detail.blockers,
  saved_requests: { total: requests.length, states },
  qualifications: detail.qualifications.map((q) => ({
    id: q.id,
    task_class: q.task_class,
    model_id: q.model_id,
    state: q.state,
    manifest_hash: q.manifest_hash,
  })),
  provider_calls: 0,
  settings_mutated: false,
  quota_reset: false,
};
const file = `tracking/evidence/discovery-followup-v2/authenticated-readiness-${randomUUID()}.json`;
await writeFile(file, JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ receipt: file, ...result }));
