// Prospective execution rebind only: never rewrites packets or dispatches calls.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { canonicalHash } from '../packages/domain/dist/index.js';
import {
  checkFollowup,
  checkSeparateReview,
  FOLLOWUP_DIR,
  PACKET_DIR,
} from './check-discovery-followup-v2.mjs';
import { FOLLOWUP_LIMITS } from './discovery-followup-core.mjs';
const { frozen, runtime, packaged, checks, transport } = await checkFollowup({
  requirePlan: false,
});
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const responsePath =
  'tracking/evidence/discovery-separate-review-2026-10-22/v5-review-response.json';
const packetPath =
  'tracking/evidence/discovery-followup-proposal/review-packet.json';
const response = await read(responsePath),
  packet = await read(packetPath);
checkSeparateReview(packet, response);
const log = await readFile(FOLLOWUP_DIR + 'tests-final.tap', 'utf8');
assert.match(log, /# pass 17\b/);
assert.match(log, /# fail 0\b/);
assert.match(log, /# skipped 0\b/);
const installedBytes = await readFile(
  join(runtime.install_dir, 'studio/bundle-manifest.json'),
);
assert.equal(sha(installedBytes), runtime.bundle_manifest_sha256);
const installed = JSON.parse(installedBytes);
for (const f of installed.files) {
  assert.ok(!f.path.includes('..') && !/^(?:[a-z]:|[\\/])/i.test(f.path));
  assert.equal(
    sha(await readFile(join(runtime.install_dir, 'studio', f.path))),
    f.sha256,
    f.path,
  );
}
assert.equal(
  sha(await readFile(join(runtime.install_dir, 'creator-desktop.exe'))),
  packaged.packaged_desktop_sha256,
);
const save = (name, value) =>
  writeFile(FOLLOWUP_DIR + name, JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
  });
await mkdir(FOLLOWUP_DIR, { recursive: true });
const oldReview = await read(PACKET_DIR + 'review-plan.json');
const review = {
  ...oldReview,
  format: 'discovery-substantive-review-plan/execution-2',
  execution_identity: 'discovery-followup-v2',
  original_review_plan_sha256: frozen.review_plan_sha256,
  scope:
    'Same author-visible synthetic operational cases and checklist criteria; newly bound to schema-28 candidate, not new cases or thesis holdouts. No target outputs exist.',
  cases: oldReview.cases.map((c) => ({
    ...c,
    candidate_hash: runtime.bundle_manifest_sha256,
  })),
};
await save('review-plan.json', review);
const source_sha256 = { ...runtime.source_sha256, ...frozen.prior_evidence };
const paths = [
  'scripts/check-discovery-followup-v2.mjs',
  'scripts/qualify-discovery-followup-v2.mjs',
  'scripts/qualify-discovery-followup-v2.ps1',
  'scripts/prepare-discovery-followup-v2-execution.mjs',
  'scripts/discovery-followup-core.mjs',
  'scripts/check-discovery-followup.mjs',
  'scripts/qualify-discovery-followup.mjs',
  'scripts/qualify-discovery-followup.ps1',
  'tests/src/discovery-followup-v2.test.mjs',
  'tests/src/discovery-followup.test.mjs',
  PACKET_DIR + 'execution-plan.json',
  PACKET_DIR + 'freeze.json',
  PACKET_DIR + 'review-plan.json',
  frozen.controls_path,
  ...frozen.files.map((f) => f.path),
  FOLLOWUP_DIR + 'review-plan.json',
  FOLLOWUP_DIR + 'tests-final.tap',
  'tracking/evidence/availability-recheck-implementation/candidate-plan.json',
  'tracking/evidence/availability-recheck-implementation/packaged-identity.json',
  'tracking/evidence/availability-recheck-implementation/migration-result.json',
  'tracking/evidence/availability-recheck-implementation/after-upgrade.json',
  'tracking/evidence/availability-recheck-live-2026-10-22/final-result.json',
  'tracking/evidence/availability-recheck-live-2026-10-22/provider-result.json',
  'tracking/evidence/availability-recheck-review-2026-10-22/reviewer-receipt.json',
  'tracking/evidence/discovery-separate-review-2026-10-22/reviewer-receipt.json',
  responsePath,
  packetPath,
];
for (const path of paths) source_sha256[path] = sha(await readFile(path));
const plan = {
  format: 'discovery-followup-execution/2',
  status: 'prepared_pending_exact_owner_approval_and_fresh_preflight',
  prepared_at: new Date().toISOString(),
  evaluation_id: 'discovery-followup-v2',
  packet_identity: 'discovery-followup-v1',
  packet_freeze_path: PACKET_DIR + 'freeze.json',
  packet_freeze_hash: canonicalHash(frozen),
  predecessor_execution_plan_hash: canonicalHash(
    await read(PACKET_DIR + 'execution-plan.json'),
  ),
  runtime_candidate_plan_hash: canonicalHash(runtime),
  workspace_id: runtime.workspace_id,
  connection_id: runtime.connection_id,
  model_id: runtime.model_id,
  proposed_settings_hash: runtime.settings_hash,
  role_prompt_hash: frozen.prompt_hash,
  required_schema: 28,
  install_dir: runtime.install_dir,
  bundle_manifest_sha256: runtime.bundle_manifest_sha256,
  desktop_payload_sha256: packaged.packaged_desktop_sha256,
  installer_sha256: runtime.installer_sha256,
  candidate_mode: 'installed_schema28_runtime_with_unchanged_frozen_packets',
  installation_required: false,
  settings_changes: false,
  migration_required: false,
  limits: FOLLOWUP_LIMITS,
  min_held_out_cases_per_class: 4,
  floor: { numerator: 1, denominator: 1 },
  provider_availability_max_age_ms: 900000,
  prior_review_packet_hash: canonicalHash(packet),
  prior_review_response_path: responsePath,
  prior_review_response_sha256: sha(await readFile(responsePath)),
  source_sha256,
  historical_evidence_policy:
    'New prospective execution identity for the same unattempted packet, not a resumption of v5 or a replay. No historical successes pooled; original cases, grades and plans stay unchanged.',
  stop_conditions: [
    'unsuccessful',
    'refused',
    'unknown',
    'quota',
    'deadline',
    'cancelled',
    'binding_mismatch',
  ],
  manual_review:
    'Separate review of future exact outputs remains required; structural acceptance is not source entailment or real-world usefulness.',
  pending: [
    'Separate review of this new execution binding',
    'Exact scoped owner execution decision',
    'Fresh quota/cap/settings/installed/idle-state preflight; no implicit availability refresh',
  ],
  automatic_next_actions: [],
};
await save('execution-plan.json', plan);
await save('preparation-result.json', {
  prepared_at: new Date().toISOString(),
  state: plan.status,
  execution_plan_hash: canonicalHash(plan),
  packet_freeze_hash: canonicalHash(frozen),
  source_bindings: Object.keys(source_sha256).length,
  installed_resources_verified: installed.files.length,
  desktop_payload_verified: true,
  offline_tests: { passed: 17, failed: 0, skipped: 0 },
  local_controls: checks,
  transport,
  original_packet_and_criteria_unchanged: true,
  original_plans_preserved: true,
  target_outputs_created: 0,
  provider_calls: 0,
  installation_performed: false,
  settings_changed: false,
});
console.log(
  JSON.stringify({
    plan_hash: canonicalHash(plan),
    packet_freeze_hash: canonicalHash(frozen),
    source_bindings: Object.keys(source_sha256).length,
    installed_resources: installed.files.length,
    tests: 17,
    controls: checks,
    provider_calls: 0,
  }),
);
