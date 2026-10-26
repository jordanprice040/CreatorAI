import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../packages/domain/dist/index.js';
const d = 'tracking/evidence/discovery-research14-live-authorization-v2/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = async (p) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
const suite = await read(
  'tracking/evidence/discovery-research14-runner/execution-plan.json',
);
assert.equal(
  canonicalHash(suite),
  'a96eed07aa0372e55d7880a62b57f6c0f5726b3ea6c559617af3f9119e11469a',
);
const candidate = await read(
  'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
);
for (const [p, h] of Object.entries(candidate.source_sha256))
  assert.equal(await hash(p), h, p);
const paths = [
  ...Object.keys(candidate.source_sha256),
  'tracking/evidence/discovery-research14-live-authorization/authorization-plan.json',
  'tracking/evidence/discovery-research14-live-authorization/operation.lock',
  'tracking/evidence/discovery-research14-live-authorization/availability/operation.lock',
  'tracking/evidence/discovery-research14-live-authorization/availability/stopped.json',
  'tracking/evidence/discovery-research14-live-authorization/stopped-reconciliation.json',
  'tracking/evidence/discovery-research14-readiness/authenticated-readiness-d20dbd32-f3b3-4fa1-a6f7-1ad7c5ad22c8.json',
  'tracking/evidence/discovery-research14-readiness/full-record-reconciliation.json',
  'scripts/recheck-research14-v2-availability.mjs',
  'scripts/check-research14-live-authorization-v2.mjs',
  'scripts/run-research14-v2-approved-live.ps1',
  'scripts/prepare-research14-live-authorization-v2.mjs',
  'tests/research14-live-authorization-v2.test.mjs',
  'tests/src/research14-live-authorization-v2.test.ts',
  'tracking/evidence/discovery-research14-runner/execution-plan.json',
  'tracking/evidence/discovery-research14-runner-review-2026-10-22/reviewer-receipt.json',
  'tracking/evidence/discovery-semantics-v2-installation/installation-receipt.json',
  'tracking/evidence/discovery-semantics-v2-installation/installed-result.json',
];
const sources = Object.fromEntries(
  await Promise.all([...new Set(paths)].map(async (p) => [p, await hash(p)])),
);
const a = {
  format: 'research14-availability-plan/1',
  status: 'pending_new_owner_decision',
  owner_authorization:
    'Requires exact new combined authorization; past approvals consumed or different candidate.',
  workspace_id: suite.workspace_id,
  connection_id: suite.connection_id,
  model_id: suite.model_id,
  settings_hash: suite.proposed_settings_hash,
  install_dir: suite.install_dir,
  bundle_manifest_sha256: suite.bundle_manifest_sha256,
  desktop_payload_sha256: suite.desktop_payload_sha256,
  candidate_plan_hash: canonicalHash(candidate),
  suite_execution_plan_hash: canonicalHash(suite),
  max_new_provider_requests: 1,
  retries: 0,
  max_request_ms: 120000,
  credits: 'confirmed_off',
  quota_reset: false,
  settings_changes: false,
  source_sha256: sources,
};
const p = {
  format: 'research14-live-authorization/1',
  previous_stopped_authorization_hash:
    '581dd0e6e30b3626a80a0657a6e169d5e11b9e6361a3c2c721a04919db7e8286',
  previous_attempt_provider_requests: 0,
  prepared_at: new Date().toISOString(),
  status: 'pending_independent_review_and_owner_decision',
  studio_home: suite.studio_home,
  candidate_plan_hash: canonicalHash(candidate),
  availability_plan_hash: canonicalHash(a),
  suite_execution_plan_hash: canonicalHash(suite),
  availability_purpose: 'availability_recheck',
  max_provider_requests: 7,
  max_availability_requests: 1,
  max_suite_requests: 6,
  retries: 0,
  credits: 'confirmed_off',
  settings_changes: false,
  quota_reset: false,
  automatic_next_action: false,
  suite_limits: suite.limits,
  sequence:
    'One intent-bound synthetic availability recheck; stop on failure/unknown; then exact reviewed suite only after all unchanged preflight gates pass. No retry or further refresh.',
  suite_review_receipt:
    'tracking/evidence/discovery-research14-runner-review-2026-10-22/reviewer-receipt.json',
  installation_receipt:
    'tracking/evidence/discovery-semantics-v2-installation/installation-receipt.json',
  source_sha256: sources,
};
await mkdir(d, { recursive: true });
for (const [n, v] of [
  ['availability-plan.json', a],
  ['authorization-plan.json', p],
])
  await writeFile(d + n, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    authorization_hash: canonicalHash(p),
    availability_hash: canonicalHash(a),
    max_requests: 7,
    source_bindings: Object.keys(sources).length,
    provider_calls: 0,
  }),
);
