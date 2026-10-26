// Offline research runner freeze. Existing installed candidate is not rebuilt.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../packages/domain/dist/index.js';
import { FOLLOWUP_LIMITS } from './discovery-research-core.mjs';
const read = async (p) => JSON.parse(await readFile(p, 'utf8')),
  hash = async (p) =>
    createHash('sha256')
      .update(await readFile(p))
      .digest('hex');
const dir = 'tracking/evidence/discovery-research14-runner/';
const scope = await read(
    'tracking/evidence/discovery-semantics-v2-runner/execution-plan-v3.json',
  ),
  frozen = await read('tracking/evidence/discovery-research14-v2/freeze.json'),
  candidate = await read(
    'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
  );
const reviewPath =
    'tracking/evidence/discovery-research14-v2-review-2026-10-22/reviewer-receipt.json',
  review = await read(reviewPath);
assert.equal(review.status, 'supported_bounded_offline_packet');
assert.equal(review.packet_freeze_hash, canonicalHash(frozen));
for (const [p, h] of Object.entries(review.artifact_sha256))
  assert.equal(await hash(p), h, p);
const paths = [
  ...Object.keys(candidate.source_sha256),
  reviewPath,
  'tracking/evidence/discovery-research14-v2/freeze.json',
  'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
  'tracking/evidence/discovery-semantics-v2-runner/execution-plan-v3.json',
  'tracking/evidence/discovery-semantics-v2-installation/installation-receipt.json',
  'scripts/discovery-research-core.mjs',
  'scripts/check-discovery-research14-v2.mjs',
  'scripts/check-discovery-research-runner.mjs',
  'scripts/check-discovery-semantics-runner.mjs',
  'scripts/qualify-discovery-research14.mjs',
  'scripts/qualify-discovery-research14.ps1',
  'scripts/prepare-discovery-research-runner.mjs',
  'tests/discovery-research-runner.test.mjs',
  'tests/src/discovery-research-runner.test.ts',
];
const plan = {
  format: 'discovery-research14-executable-plan/1',
  prepared_at: new Date().toISOString(),
  status: 'pending_runner_review_and_new_exact_owner_live_decision',
  packet_freeze_path: 'tracking/evidence/discovery-research14-v2/freeze.json',
  packet_freeze_hash: canonicalHash(frozen),
  candidate_plan_hash: canonicalHash(candidate),
  workspace_id: scope.workspace_id,
  connection_id: scope.connection_id,
  model_id: scope.model_id,
  studio_home: scope.studio_home,
  install_dir: scope.install_dir,
  required_schema: 28,
  role_version: frozen.role_version,
  prompt_hash: frozen.prompt_hash,
  bundle_manifest_sha256: scope.bundle_manifest_sha256,
  desktop_payload_sha256: scope.desktop_payload_sha256,
  installer_sha256: scope.installer_sha256,
  installation_plan_hash: scope.installation_plan_hash,
  proposed_settings_hash: scope.proposed_settings_hash,
  provider_availability_max_age_ms: 900000,
  min_held_out_cases_per_class: 4,
  floor: { numerator: 1, denominator: 1 },
  limits: FOLLOWUP_LIMITS,
  task_classes: ['research_synthesis'],
  runner_review_required: true,
  installation_receipt_required: true,
  installation_required: false,
  automatic_next_action: false,
  settings_changes: false,
  migration_required: false,
  source_sha256: Object.fromEntries(
    await Promise.all([...new Set(paths)].map(async (p) => [p, await hash(p)])),
  ),
  provider_calls: 0,
};
await mkdir(dir, { recursive: true });
await writeFile(
  dir + 'execution-plan.json',
  JSON.stringify(plan, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    execution_plan_hash: canonicalHash(plan),
    source_bindings: Object.keys(plan.source_sha256).length,
    provider_calls: 0,
  }),
);
