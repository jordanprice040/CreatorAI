// Research-only static identity/review gates. No credentials, API or provider access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { canonicalHash } from '../packages/domain/dist/index.js';
import { FOLLOWUP_LIMITS } from './discovery-research-core.mjs';
import {
  sha,
  verifyHashes,
  assertInstalledFiles,
  assertInstallation,
  assertConnectionReady,
} from './check-discovery-semantics-runner.mjs';
export {
  sha,
  verifyHashes,
  assertInstalledFiles,
  assertInstallation,
  assertConnectionReady,
};
export const FOLLOWUP_DIR = 'tracking/evidence/discovery-research14-runner/';
export const PLAN_PATH = FOLLOWUP_DIR + 'execution-plan.json';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const scope = await read(
  'tracking/evidence/discovery-semantics-v2-runner/execution-plan-v3.json',
);
export function assertExecutionBinding(plan, frozen, candidate) {
  assert.equal(plan.format, 'discovery-research14-executable-plan/1');
  assert.equal(
    plan.packet_freeze_path,
    'tracking/evidence/discovery-research14-v2/freeze.json',
  );
  assert.equal(plan.packet_freeze_hash, canonicalHash(frozen));
  assert.equal(plan.candidate_plan_hash, canonicalHash(candidate));
  assert.equal(plan.candidate_plan_hash, frozen.candidate_plan_hash);
  for (const k of [
    'workspace_id',
    'connection_id',
    'model_id',
    'studio_home',
    'install_dir',
    'required_schema',
    'bundle_manifest_sha256',
    'desktop_payload_sha256',
    'installer_sha256',
    'installation_plan_hash',
    'provider_availability_max_age_ms',
    'proposed_settings_hash',
  ])
    assert.equal(plan[k], scope[k], k);
  assert.equal(plan.role_version, frozen.role_version);
  assert.equal(plan.prompt_hash, frozen.prompt_hash);
  assert.equal(plan.required_schema, 28);
  assert.equal(plan.min_held_out_cases_per_class, 4);
  assert.deepEqual(plan.floor, { numerator: 1, denominator: 1 });
  assert.deepEqual(plan.limits, FOLLOWUP_LIMITS);
  assert.equal(plan.limits.max_new_requests, frozen.limits.max_new_requests);
  assert.equal(plan.limits.max_wall_ms, frozen.limits.max_wall_ms);
  assert.deepEqual(plan.task_classes, ['research_synthesis']);
  for (const k of [
    'automatic_next_action',
    'settings_changes',
    'migration_required',
  ])
    assert.equal(plan[k], false);
  assert.equal(plan.runner_review_required, true);
  assert.equal(plan.installation_receipt_required, true);
  assert.equal(plan.bundle_manifest_sha256, candidate.bundle_manifest_sha256);
  assert.equal(plan.desktop_payload_sha256, candidate.packaged_desktop_sha256);
}
export function assertRunnerReview(receipt, plan, bytes) {
  assert.equal(receipt.status, 'supported_research_runner');
  assert.equal(receipt.reviewer_type, 'model');
  assert.equal(receipt.prior_implementation_involvement, false);
  assert.equal(receipt.execution_plan_hash, canonicalHash(plan));
  assert.equal(receipt.artifact_sha256[PLAN_PATH], sha(bytes));
  for (const [p, h] of Object.entries(plan.source_sha256))
    assert.equal(receipt.artifact_sha256[p], h, p);
}
export async function checkFollowup() {
  execFileSync(
    process.execPath,
    ['scripts/check-discovery-research14-v2.mjs'],
    { stdio: 'pipe' },
  );
  const frozen = await read(
      'tracking/evidence/discovery-research14-v2/freeze.json',
    ),
    candidate = await read(
      'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
    ),
    bytes = await readFile(PLAN_PATH),
    plan = JSON.parse(bytes);
  assertExecutionBinding(plan, frozen, candidate);
  await verifyHashes(plan.source_sha256);
  const rp = await read(
    'tracking/evidence/discovery-research14-v2-review-2026-10-22/reviewer-receipt.json',
  );
  assert.equal(rp.status, 'supported_bounded_offline_packet');
  assert.equal(rp.packet_freeze_hash, canonicalHash(frozen));
  await verifyHashes(rp.artifact_sha256);
  assert.equal(
    sha(await readFile(candidate.installer_path)),
    plan.installer_sha256,
  );
  const manifests = await Promise.all(frozen.files.map((f) => read(f.path)));
  assert.equal(manifests.length, 1);
  assert.equal(manifests[0].task_class, 'research_synthesis');
  assert.equal(manifests[0].cases.length, 6);
  assert.ok(manifests[0].cases.every((c) => c.check.task_kind === 'locate'));
  return { plan, planBytes: bytes, frozen, manifests };
}
