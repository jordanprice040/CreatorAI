// GET-only diagnostics plus pure admission replay. No provider-triggering endpoint.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import {
  PlanConnectionDetailSchema,
  PlanAdmissionRequestSchema,
} from '../packages/contracts/dist/index.js';
import { admissionBlockers } from '../packages/domain/dist/index.js';
const dir = 'tracking/evidence/approved-availability-check-2026-10-22/';
const scope = JSON.parse(await readFile(dir + 'authorization.json', 'utf8'));
const grant = JSON.parse(await readFile(dir + 'grant-result.json', 'utf8'));
let input = '';
for await (const c of process.stdin) input += c;
const secret = JSON.parse(input);
input = '';
const api = async (path) => {
  const r = await fetch('http://127.0.0.1:4310/api/' + path, {
    headers: { Cookie: `creator_session=${secret.session.token}` },
    signal: AbortSignal.timeout(15000),
  });
  assert.ok(r.ok);
  return r.json();
};
try {
  assert.equal((await api('auth/session')).authenticated, true);
  const path = `workspaces/${scope.workspace_id}/plan-connections/${scope.connection_id}`;
  const { sign_in_attempt, ...raw } = await api(path);
  const d = PlanConnectionDetailSchema.parse(raw);
  const requests = await api(path + '/requests');
  const before = JSON.parse(await readFile(dir + 'before.json', 'utf8'));
  const beforeIds = new Set(before.request_ids);
  const instructions =
    'This is a connection check from Creator Agent. Reply with exactly the word: ok';
  const text = 'Reply with exactly: ok';
  const request = PlanAdmissionRequestSchema.parse({
    connection_id: scope.connection_id,
    logical_operation_id: randomUUID(),
    path: 'responses',
    purpose: 'verification',
    model_id: scope.model_id,
    task_class: null,
    data_class: 'synthetic',
    run_id: null,
    build_id: null,
    grant_id: grant.id,
    qualification_id: null,
    input_chars: instructions.length + text.length,
  });
  const savedGrant = d.grants.find((g) => g.id === grant.id);
  const blockers = admissionBlockers({
    connection: d.connection,
    request,
    access: d.model_access,
    qualifications: d.qualifications,
    grant: savedGrant ?? null,
    usage: { ...d.usage, run_requests: 0, build_requests: 0 },
    now: new Date(),
  });
  const result = {
    observed_at: new Date().toISOString(),
    diagnostic_mode: 'GET_only_and_pure_admission_replay',
    blockers,
    model_access: d.model_access.filter(
      (a) => a.model_id === scope.model_id && a.path === 'responses',
    ),
    grant: savedGrant,
    quota: d.connection.quota,
    settings_hash: d.connection.settings_hash,
    credits: d.connection.credits.state,
    usage: d.usage,
    saved_requests: requests.length,
    new_request_ids: requests
      .filter((r) => !beforeIds.has(r.id))
      .map((r) => r.id),
    qualification_states_unchanged:
      JSON.stringify(before.qualifications) ===
      JSON.stringify(
        d.qualifications.map((q) => ({
          id: q.id,
          state: q.state,
          manifest_hash: q.manifest_hash,
        })),
      ),
    provider_calls_from_this_diagnostic: 0,
    retry: false,
  };
  await writeFile(
    dir + 'refusal-diagnosis.json',
    JSON.stringify(result, null, 2) + '\n',
    { flag: 'wx' },
  );
  console.log(JSON.stringify(result));
} finally {
  delete secret.session;
}
