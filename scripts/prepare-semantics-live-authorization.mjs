import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../packages/domain/dist/index.js';
const d = 'tracking/evidence/discovery-semantics-v2-live-authorization/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = async (p) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
const suite = await read(
  'tracking/evidence/discovery-semantics-v2-runner/execution-plan-v3.json',
);
assert.equal(
  canonicalHash(suite),
  '4fb62a439113717dbca5e97399a17b4479aae6cc93ba799fd9d3e600a37b280c',
);
const candidate = await read(
  'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
);
for (const [p, h] of Object.entries(candidate.source_sha256))
  assert.equal(await hash(p), h, p);
const paths = [
  ...Object.keys(candidate.source_sha256),
  'scripts/recheck-semantics-v2-availability.mjs',
  'scripts/check-semantics-live-authorization.mjs',
  'scripts/run-semantics-v2-approved-live.ps1',
  'scripts/prepare-semantics-live-authorization.mjs',
  'tests/semantics-live-authorization.test.mjs',
  'tests/src/semantics-live-authorization.test.ts',
  'tracking/evidence/discovery-semantics-v2-runner/execution-plan-v3.json',
  'tracking/evidence/discovery-semantics-v2-runner-review-2026-10-22/reviewer-receipt.json',
  'tracking/evidence/discovery-semantics-v2-installation/installation-receipt.json',
  'tracking/evidence/discovery-semantics-v2-installation/installed-result.json',
];
const sources = Object.fromEntries(
  await Promise.all([...new Set(paths)].map(async (p) => [p, await hash(p)])),
);
const a = {
  format: 'semantics-v2-availability-plan/1',
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
  format: 'semantics-live-authorization/1',
  prepared_at: new Date().toISOString(),
  status: 'pending_independent_review_and_owner_decision',
  studio_home: suite.studio_home,
  candidate_plan_hash: canonicalHash(candidate),
  availability_plan_hash: canonicalHash(a),
  suite_execution_plan_hash: canonicalHash(suite),
  availability_purpose: 'availability_recheck',
  max_provider_requests: 13,
  max_availability_requests: 1,
  max_suite_requests: 12,
  retries: 0,
  credits: 'confirmed_off',
  settings_changes: false,
  quota_reset: false,
  automatic_next_action: false,
  suite_limits: suite.limits,
  sequence:
    'One intent-bound synthetic availability recheck; stop on failure/unknown; then exact reviewed suite only after all unchanged preflight gates pass. No retry or further refresh.',
  suite_review_receipt:
    'tracking/evidence/discovery-semantics-v2-runner-review-2026-10-22/reviewer-receipt.json',
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
    max_requests: 13,
    source_bindings: Object.keys(sources).length,
    provider_calls: 0,
  }),
);
