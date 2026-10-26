// Freeze exact distributable identity and prospective install/execution bindings.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import {
  canonicalHash,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
} from '../packages/domain/dist/index.js';
import { FOLLOWUP_LIMITS } from './discovery-followup-core.mjs';
const dir = 'tracking/evidence/discovery-semantics-v2-package/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hash = async (p) => sha(await readFile(p));
const save = (name, v) =>
  writeFile(dir + name, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const frozen = await read(
  'tracking/evidence/discovery-semantics-v2/freeze.json',
);
assert.equal(
  canonicalHash(frozen),
  'b6da3adc6061627b81036dcacee83884d6c8fe40c539368cead1f63fb139e5fa',
);
assert.equal(DISCOVERY_PROMPT_HASH, frozen.prompt_hash);
assert.equal(DISCOVERY_ROLE_VERSION, 'r02-discovery/1.4');
for (const [p, h] of Object.entries(frozen.source_sha256))
  assert.equal(await hash(p), h, p);
const rp =
    'tracking/evidence/discovery-semantics-v2-review-2026-10-22/reviewer-receipt.json',
  review = await read(rp);
assert.equal(review.status, 'supported_bounded_offline_packet');
for (const [p, h] of Object.entries(review.artifact_sha256))
  assert.equal(await hash(p), h, p);
const staging = 'apps/desktop/.bundle/studio',
  payload = '.verification/semantics-v2-nsis-payload';
const manifest = await read(staging + '/bundle-manifest.json');
const manifestHash = await hash(staging + '/bundle-manifest.json');
assert.equal(
  await hash(payload + '/studio/bundle-manifest.json'),
  manifestHash,
);
for (const f of manifest.files) {
  assert.ok(!f.path.includes('..') && !/^(?:[a-z]:|[\\/])/i.test(f.path));
  assert.equal(await hash(join(staging, f.path)), f.sha256, f.path);
  assert.equal(await hash(join(payload, 'studio', f.path)), f.sha256, f.path);
}
const service = await readFile(
  staging + '/service/app/dist/studio.mjs',
  'utf8',
);
assert.ok(
  service.includes('r02-discovery/1.4') &&
    service.includes('Finding semantics v1.4'),
);
const prior = await read(
  'tracking/evidence/availability-recheck-implementation/candidate-plan.json',
);
const installed = 'C:/Users/jorda/AppData/Local/Creator Agent';
assert.equal(
  await hash(installed + '/studio/bundle-manifest.json'),
  prior.bundle_manifest_sha256,
);
const archived = await hash(
  '.verification/semantics-v2-prepackage/prior-setup.exe',
);
assert.equal(archived, prior.installer_sha256);
const artifactDir = '.verification/discovery-semantics-v2-artifacts';
await mkdir(artifactDir);
await cp(staging, artifactDir + '/studio', {
  recursive: true,
  errorOnExist: true,
});
const installer =
  'apps/desktop/src-tauri/target/release/bundle/nsis/Creator Agent_0.1.0_x64-setup.exe';
await cp(installer, artifactDir + '/Creator Agent_0.1.0_x64-setup.exe', {
  errorOnExist: true,
});
await cp(
  payload + '/creator-desktop.exe',
  artifactDir + '/packaged-creator-desktop.exe',
  { errorOnExist: true },
);
const sourcePaths = [
  ...new Set([
    ...Object.keys(prior.source_sha256),
    ...Object.keys(frozen.source_sha256),
    'apps/desktop/build-studio.mjs',
    'apps/desktop/src-tauri/tauri.conf.json',
    'apps/desktop/src-tauri/tauri.local-bundle.conf.json',
    'apps/desktop/src-tauri/Cargo.toml',
    'apps/desktop/src-tauri/Cargo.lock',
    'scripts/bind-discovery-semantics-v2-package.mjs',
    'scripts/check-discovery-semantics-v2.mjs',
    'tracking/evidence/discovery-semantics-v2/freeze.json',
    rp,
    dir + 'tests-final.tap',
    dir + 'packet-check.json',
    dir + 'stage.log',
    dir + 'native-build-host.log',
  ]),
];
const source = Object.fromEntries(
  await Promise.all(sourcePaths.map(async (p) => [p, await hash(p)])),
);
const candidate = {
  format: 'discovery-semantics-distributable/1',
  prepared_at: new Date().toISOString(),
  status: 'packaged_not_installed_affected_review_pending',
  role_version: DISCOVERY_ROLE_VERSION,
  prompt_hash: DISCOVERY_PROMPT_HASH,
  packet_freeze_hash: canonicalHash(frozen),
  packet_local_candidate_hash: frozen.candidate_hash,
  bundle_manifest_sha256: manifestHash,
  resource_count: manifest.files.length,
  installer_path: artifactDir + '/Creator Agent_0.1.0_x64-setup.exe',
  installer_sha256: await hash(installer),
  packaged_desktop_path: artifactDir + '/packaged-creator-desktop.exe',
  packaged_desktop_sha256: await hash(payload + '/creator-desktop.exe'),
  loose_build_desktop_sha256: await hash(
    'apps/desktop/src-tauri/target/release/creator-desktop.exe',
  ),
  archived_bundle_dir: artifactDir + '/studio',
  schema: 28,
  source_sha256: source,
  provider_calls: 0,
  installed: false,
};
await save('candidate-plan.json', candidate);
const install = {
  format: 'discovery-semantics-installation-binding/1',
  candidate_plan_hash: canonicalHash(candidate),
  installer_path: candidate.installer_path,
  installer_sha256: candidate.installer_sha256,
  packaged_desktop_sha256: candidate.packaged_desktop_sha256,
  target_install_dir: installed,
  studio_home: 'C:/Users/jorda/AppData/Local/com.creatoragent.studio',
  expected_predecessor_manifest_sha256: prior.bundle_manifest_sha256,
  expected_target_manifest_sha256: manifestHash,
  expected_target_resources: manifest.files.length,
  required_schema: 28,
  migration_required: false,
  settings_changes: false,
  provider_calls: 0,
  preconditions: [
    'Affected candidate/plan review supported',
    'Owner local upgrade scope and app fully quit',
    'No active/unknown provider requests or leased/nonterminal workflows',
    'Hash-verified program rollback and supported studio-home/database backup',
    'Before-state hashes for requests/grants/access/qualifications/settings',
  ],
  postconditions: [
    'Pinned installer exits zero',
    'Installed packaged desktop and all manifest resource hashes match',
    'Schema28 and before-state hashes unchanged',
    'Owner service health and session verified without provider dispatch',
  ],
  backup_restore_rehearsal_claimed: false,
  status: 'prospective_not_executed',
};
await save('installation-plan.json', install);
const old = await read(
  'tracking/evidence/discovery-followup-v2/execution-plan.json',
);
const exec = {
  format: 'discovery-semantics-execution-binding/1',
  status: 'prospective_binding_runner_and_review_pending_no_live_authority',
  candidate_plan_hash: canonicalHash(candidate),
  installation_plan_hash: canonicalHash(install),
  packet_freeze_path: 'tracking/evidence/discovery-semantics-v2/freeze.json',
  packet_freeze_hash: canonicalHash(frozen),
  workspace_id: old.workspace_id,
  connection_id: old.connection_id,
  model_id: old.model_id,
  required_schema: 28,
  role_version: DISCOVERY_ROLE_VERSION,
  prompt_hash: DISCOVERY_PROMPT_HASH,
  settings_hash: old.proposed_settings_hash,
  install_dir: installed,
  bundle_manifest_sha256: manifestHash,
  desktop_payload_sha256: candidate.packaged_desktop_sha256,
  installer_sha256: candidate.installer_sha256,
  limits: FOLLOWUP_LIMITS,
  min_held_out_cases_per_class: 4,
  floor: { numerator: 1, denominator: 1 },
  provider_availability_max_age_ms: 900000,
  credits: 'confirmed_off',
  studio_daily_cap: 40,
  installation_required: true,
  settings_changes: false,
  migration_required: false,
  retry: false,
  automatic_next_action: false,
  provider_calls: 0,
  dispatch_ready: false,
  runner_required: true,
  unresolved_gates: [
    'Independent exact package/install/execution-binding review',
    'Supported local installation and record preservation',
    'New runner bound to exact packet/package plus negative offline admission checks',
    'Exact final executable-plan owner decision and fresh preflight (no implicit refresh)',
  ],
  review_plan_path: 'tracking/evidence/discovery-semantics-v2/review-plan.json',
  review_plan_sha256: await hash(
    'tracking/evidence/discovery-semantics-v2/review-plan.json',
  ),
};
await save('execution-binding.json', exec);
await save('preparation-result.json', {
  candidate_plan_hash: canonicalHash(candidate),
  installation_plan_hash: canonicalHash(install),
  execution_binding_hash: canonicalHash(exec),
  resource_count: manifest.files.length,
  extracted_resources_verified: manifest.files.length,
  tests: { passed: 23, failed: 0, skipped: 0 },
  controls: 108,
  installed_predecessor_unchanged: true,
  previous_installer_archived_verified: true,
  provider_calls: 0,
  installation: false,
  dispatch_ready: false,
});
console.log(
  JSON.stringify({
    candidate: canonicalHash(candidate),
    install: canonicalHash(install),
    execution_binding: canonicalHash(exec),
    resources: manifest.files.length,
    provider_calls: 0,
  }),
);
