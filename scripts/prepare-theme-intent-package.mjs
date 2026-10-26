// Freeze the reviewed theme-intent distributable and a declarative upgrade plan. No activation.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import {
  canonicalHash,
  DISCOVERY_PROMPT_HASH,
  DISCOVERY_ROLE_VERSION,
} from '../packages/domain/dist/index.js';
const d = 'tracking/evidence/theme-intent-package-2026-10-23/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = async (p) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
const reviewPath =
  'tracking/evidence/theme-intent-repair-review-2026-10-23/reviewer-receipt.json';
const review = await read(reviewPath);
assert.equal(review.status, 'supported_repair');
for (const [p, h] of Object.entries(review.artifact_sha256))
  assert.equal(await hash(p), h, p);
const prior = await read(
  'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
);
const staging = 'apps/desktop/.bundle/studio',
  payload = '.verification/theme-intent-nsis-payload';
const manifest = await read(staging + '/bundle-manifest.json');
assert.equal(
  await hash(payload + '/studio/bundle-manifest.json'),
  await hash(staging + '/bundle-manifest.json'),
);
for (const f of manifest.files) {
  assert.ok(!f.path.includes('..') && !/^(?:[a-z]:|[\\/])/i.test(f.path));
  for (const root of [staging, payload + '/studio'])
    assert.equal(await hash(join(root, f.path)), f.sha256, f.path);
}
const service = await readFile(
  staging + '/service/app/dist/studio.mjs',
  'utf8',
);
for (const marker of [
  'theme-intent/1',
  'theme-research-plan/1',
  'theme_intent_drafts',
  'not_authorized',
  'r02-discovery/1.4',
])
  assert.ok(service.includes(marker), marker);
const parity = await read(d + 'migration-role-parity.json');
assert.equal(parity.prior_migration_sql_and_metadata_unchanged, 28);
assert.equal(parity.new_schema, 29);
const archive = '.verification/theme-intent-artifacts-2026-10-23';
await mkdir(archive);
await cp(staging, archive + '/studio', {
  recursive: true,
  errorOnExist: true,
  force: false,
});
const installer =
  'apps/desktop/src-tauri/target/release/bundle/nsis/Creator Agent_0.1.0_x64-setup.exe';
await cp(installer, archive + '/Creator Agent_0.1.0_x64-setup.exe', {
  errorOnExist: true,
  force: false,
});
await cp(
  payload + '/creator-desktop.exe',
  archive + '/packaged-creator-desktop.exe',
  { errorOnExist: true, force: false },
);
const original = await read(
  'tracking/evidence/theme-intent-implementation-2026-10-23/implementation-receipt.json',
);
const paths = [
  ...new Set([
    ...Object.keys(prior.source_sha256),
    ...Object.keys(original.artifact_sha256),
    ...Object.keys(review.artifact_sha256),
    reviewPath,
    'tests/src/theme-intent-navigation.test.ts',
    'tests/dist/theme-intent-navigation.test.js',
    'scripts/verify-theme-intent-guard.playwright.js',
    'scripts/prepare-theme-intent-package.mjs',
    'apps/desktop/build-studio.mjs',
    'apps/desktop/src-tauri/tauri.conf.json',
    'apps/desktop/src-tauri/tauri.local-bundle.conf.json',
    'apps/desktop/src-tauri/Cargo.toml',
    'apps/desktop/src-tauri/Cargo.lock',
    '.verification/theme-intent-build.cmd',
    ...[
      'prepackage.json',
      'migration-role-parity.json',
      'staged-upgrade-tests.tap',
      'stage.log',
      'native-build.log',
      'extraction.log',
    ].map((p) => d + p),
  ]),
];
const sources = {};
for (const p of paths) sources[p] = await hash(p);
const candidate = {
  format: 'theme-intent-distributable/1',
  prepared_at: new Date().toISOString(),
  status: 'packaged_not_installed_package_review_pending',
  source_commit: manifest.source_commit,
  source_dirty: manifest.source_dirty,
  schema: 29,
  role_version: DISCOVERY_ROLE_VERSION,
  prompt_hash: DISCOVERY_PROMPT_HASH,
  reviewed_theme_ui_sha256: review.source_sha256,
  bundle_manifest_sha256: await hash(staging + '/bundle-manifest.json'),
  resource_count: manifest.files.length,
  installer_path: archive + '/Creator Agent_0.1.0_x64-setup.exe',
  installer_sha256: await hash(installer),
  packaged_desktop_path: archive + '/packaged-creator-desktop.exe',
  packaged_desktop_sha256: await hash(payload + '/creator-desktop.exe'),
  loose_build_desktop_sha256: await hash(
    'apps/desktop/src-tauri/target/release/creator-desktop.exe',
  ),
  archived_bundle_dir: archive + '/studio',
  extracted_payload_dir: payload,
  source_sha256: sources,
  provider_calls: 0,
  installed: false,
};
const plan = {
  format: 'theme-intent-installation-plan/1',
  status: 'prospective_not_executed_new_exact_owner_approval_required',
  candidate_plan_hash: canonicalHash(candidate),
  installer_path: candidate.installer_path,
  installer_sha256: candidate.installer_sha256,
  packaged_desktop_sha256: candidate.packaged_desktop_sha256,
  target_install_dir: 'C:/Users/jorda/AppData/Local/Creator Agent',
  studio_home: 'C:/Users/jorda/AppData/Local/com.creatoragent.studio',
  expected_predecessor_manifest_sha256: prior.bundle_manifest_sha256,
  expected_predecessor_native_sha256: prior.packaged_desktop_sha256,
  expected_target_manifest_sha256: candidate.bundle_manifest_sha256,
  expected_target_resources: candidate.resource_count,
  expected_predecessor_schema: 28,
  required_schema: 29,
  migration_required: true,
  migration_versions: [29],
  migration_mechanism:
    'Supported desktop approve_migration / migrateStudio: verified backup first, locked migration; never migrate operational state during packaging',
  settings_changes: false,
  provider_calls: 0,
  automatic_workflow: false,
  installation_helper_status:
    'new schema29-aware executable backup/install/preservation helper and affected review required before approval request',
  preconditions: [
    'Exact package/plan review supported; executable upgrade helper and pre-secret gates reviewed',
    'New exact owner approval for installation and backup-first schema28-to29 migration',
    'Owner fully quits Creator Agent; no active/unknown model requests or leased/nonterminal workflow work',
    'Fresh supported database/products backup plus protected config/DPAPI/plan-credential copy; verify hashes',
    'Fresh full installed-program rollback copy plus retained predecessor installer; verify hashes',
    'Capture current request/grant/access/qualification/settings hashes and confirm schema28 before mutation',
  ],
  postconditions: [
    'Pinned installer exits zero and installed native/manifest/all71resources match candidate',
    'Supported migration applies only29 and preserves existing records/settings/grants/access/qualifications',
    'Authenticated local health/session and saved model status checked without provider dispatch',
    'Verify theme save/resume and unsaved-navigation repair through installed UI before normal work; record any test-only records explicitly',
  ],
  rollback: {
    previous_installer_path: prior.installer_path,
    previous_installer_sha256: prior.installer_sha256,
    old_binary_cannot_run_schema29: true,
    after_migration_requires_verified_schema28_backup_restore: true,
    instruction:
      'Stop on failure; preserve evidence/locks. Do not merely reinstall schema28 binaries over schema29. Restore the verified pre-upgrade database/products/config and prior program together under an explicit recovery decision before allowing new work.',
    restore_rehearsal_claimed: false,
  },
  authorization_inherited: false,
  backups_created_for_this_install: false,
};
for (const [name, value] of [
  ['candidate-plan.json', candidate],
  ['installation-plan.json', plan],
])
  await writeFile(d + name, JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
  });
console.log(
  JSON.stringify({
    candidate_hash: canonicalHash(candidate),
    installation_plan_hash: canonicalHash(plan),
    runtime_manifest: candidate.bundle_manifest_sha256,
    installer_sha256: candidate.installer_sha256,
    packaged_native_sha256: candidate.packaged_desktop_sha256,
    resources: manifest.files.length,
    source_bindings: paths.length,
    provider_calls: 0,
    installed: false,
  }),
);
