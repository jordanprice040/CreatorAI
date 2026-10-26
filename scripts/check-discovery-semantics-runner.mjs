// Admission gates shared by the real runner and offline negative tests.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { canonicalHash } from '../packages/domain/dist/index.js';
import { FOLLOWUP_LIMITS } from './discovery-followup-core.mjs';
export const FOLLOWUP_DIR = 'tracking/evidence/discovery-semantics-v2-runner/';
export const PLAN_PATH = FOLLOWUP_DIR + 'execution-plan-v3.json';
export const sha = (b) => createHash('sha256').update(b).digest('hex');
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
export async function verifyHashes(map) {
  for (const [p, h] of Object.entries(map))
    assert.equal(sha(await readFile(p)), h, p);
}
export function assertExecutionBinding(plan, binding, candidate) {
  assert.equal(plan.format, 'discovery-semantics-executable-plan/1');
  assert.equal(plan.binding_hash, canonicalHash(binding));
  assert.equal(plan.candidate_plan_hash, canonicalHash(candidate));
  for (const k of [
    'workspace_id',
    'connection_id',
    'model_id',
    'required_schema',
    'role_version',
    'prompt_hash',
    'install_dir',
    'bundle_manifest_sha256',
    'desktop_payload_sha256',
    'installer_sha256',
    'min_held_out_cases_per_class',
    'provider_availability_max_age_ms',
  ])
    assert.deepEqual(plan[k], binding[k], k);
  assert.equal(plan.proposed_settings_hash, binding.settings_hash);
  assert.deepEqual(plan.limits, FOLLOWUP_LIMITS);
  assert.deepEqual(plan.limits, binding.limits);
  assert.deepEqual(plan.floor, { numerator: 1, denominator: 1 });
  assert.deepEqual(plan.floor, binding.floor);
  assert.equal(plan.packet_freeze_hash, binding.packet_freeze_hash);
  assert.equal(plan.packet_freeze_path, binding.packet_freeze_path);
  assert.equal(plan.installation_plan_hash, binding.installation_plan_hash);
  assert.equal(plan.automatic_next_action, false);
  assert.equal(plan.settings_changes, false);
  assert.equal(plan.migration_required, false);
  assert.equal(plan.runner_review_required, true);
  assert.equal(plan.installation_receipt_required, true);
  assert.equal(candidate.bundle_manifest_sha256, plan.bundle_manifest_sha256);
  assert.equal(candidate.packaged_desktop_sha256, plan.desktop_payload_sha256);
  assert.equal(candidate.installer_sha256, plan.installer_sha256);
}
export function assertRunnerReview(receipt, plan, planBytes) {
  assert.equal(receipt.reviewer_type, 'model');
  assert.equal(receipt.prior_implementation_involvement, false);
  assert.equal(receipt.status, 'supported_bound_runner');
  assert.equal(receipt.execution_plan_hash, canonicalHash(plan));
  assert.equal(receipt.artifact_sha256[PLAN_PATH], sha(planBytes));
  for (const [p, h] of Object.entries(plan.source_sha256))
    assert.equal(receipt.artifact_sha256[p], h, p);
}
export function assertInstallation(receipt, plan) {
  assert.equal(receipt.status, 'verified_records_preserved');
  assert.equal(receipt.candidate_plan_hash, plan.candidate_plan_hash);
  assert.equal(receipt.installation_plan_hash, plan.installation_plan_hash);
  assert.equal(receipt.installed_manifest_sha256, plan.bundle_manifest_sha256);
  assert.equal(receipt.installed_desktop_sha256, plan.desktop_payload_sha256);
  assert.equal(receipt.schema, 28);
  assert.equal(receipt.records_unchanged, true);
  assert.equal(receipt.settings_unchanged, true);
  assert.equal(receipt.credits, 'confirmed_off');
  assert.equal(receipt.active_requests, 0);
  assert.equal(receipt.unknown_requests, 0);
  assert.equal(receipt.backup_verified, true);
}
export function assertConnectionReady(d, plan, remaining, now = Date.now()) {
  assert.equal(d.connection.fixture, false);
  assert.equal(d.connection.settings_hash, plan.proposed_settings_hash);
  assert.equal(d.connection.credits.state, 'confirmed_off');
  assert.equal(d.connection.quota.state, 'available');
  const observed = Date.parse(d.connection.quota.observed_at);
  assert.ok(
    Number.isFinite(observed) &&
      observed <= now &&
      now - observed <= plan.provider_availability_max_age_ms,
    'Availability must be fresh; never probe or clear here.',
  );
  assert.equal(
    d.connection.settings.caps.shared.max_model_requests_per_day,
    40,
  );
  assert.equal(d.connection.settings.caps.shared.max_in_flight, 1);
  assert.deepEqual(d.blockers, []);
  assert.equal(d.usage.in_flight, 0);
  assert.equal(d.usage.unresolved, 0);
  assert.ok(
    40 - d.usage.last_24h_requests >= remaining,
    'Insufficient studio allowance',
  );
}
export async function checkFollowup() {
  execFileSync(process.execPath, ['scripts/check-discovery-semantics-v2.mjs'], {
    stdio: 'pipe',
  });
  const frozen = await read(
    'tracking/evidence/discovery-semantics-v2/freeze.json',
  );
  const candidate = await read(
    'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
  );
  const binding = await read(
    'tracking/evidence/discovery-semantics-v2-package/execution-binding.json',
  );
  const planBytes = await readFile(PLAN_PATH);
  const plan = JSON.parse(planBytes);
  assertExecutionBinding(plan, binding, candidate);
  await verifyHashes(candidate.source_sha256);
  await verifyHashes(plan.source_sha256);
  const review = await read(
    'tracking/evidence/discovery-semantics-v2-package-review-2026-10-22/reviewer-receipt.json',
  );
  assert.equal(
    review.status,
    'supported_exact_package_and_declarative_bindings',
  );
  await verifyHashes(review.artifact_sha256);
  assert.equal(canonicalHash(frozen), plan.packet_freeze_hash);
  assert.equal(
    sha(await readFile(candidate.installer_path)),
    plan.installer_sha256,
  );
  assert.equal(
    sha(await readFile(candidate.packaged_desktop_path)),
    plan.desktop_payload_sha256,
  );
  return {
    frozen,
    plan,
    planBytes,
    manifests: await Promise.all(frozen.files.map((f) => read(f.path))),
  };
}

export async function assertInstalledFiles(plan) {
  assert.equal(
    sha(await readFile(join(plan.install_dir, 'creator-desktop.exe'))),
    plan.desktop_payload_sha256,
    'Installed desktop mismatch',
  );
  const bytes = await readFile(
    join(plan.install_dir, 'studio/bundle-manifest.json'),
  );
  assert.equal(
    sha(bytes),
    plan.bundle_manifest_sha256,
    'Installed manifest mismatch',
  );
  const manifest = JSON.parse(bytes);
  for (const f of manifest.files) {
    assert.ok(!f.path.includes('..') && !/^(?:[a-z]:|[\\/])/i.test(f.path));
    assert.equal(
      sha(await readFile(join(plan.install_dir, 'studio', f.path))),
      f.sha256,
      f.path,
    );
  }
}
