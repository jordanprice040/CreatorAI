// Bind local preparation artifacts only; never installs, reads secrets or dispatches calls.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  canonicalHash,
  DISCOVERY_PROMPT_HASH,
} from '../packages/domain/dist/index.js';
const root = new URL('../', import.meta.url),
  dir = new URL('tracking/evidence/discovery-qualification-v3/', root);
const bytes = (p) => readFile(new URL(p, root));
const read = async (p) => JSON.parse(await bytes(p));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const freeze = await read(
  'tracking/evidence/discovery-qualification-v3/freeze.json',
);
assert.equal(freeze.prompt_hash, DISCOVERY_PROMPT_HASH);
const stagePath = 'apps/desktop/.bundle/studio/bundle-manifest.json';
const bundleBytes = await bytes(stagePath),
  bundle = JSON.parse(bundleBytes);
assert.equal(
  sha(
    await bytes(
      'apps/desktop/src-tauri/target/release/studio/bundle-manifest.json',
    ),
  ),
  sha(bundleBytes),
);
for (const f of freeze.files) {
  assert.equal(sha(await bytes(f.path)), f.sha256);
  const name = f.path.replace(/^config\//, 'config/');
  assert.equal(
    bundle.files.find((b) => b.path === name)?.sha256,
    f.sha256,
    'Packaged cases must match final freeze.',
  );
}
assert.equal(
  bundle.files.find(
    (b) =>
      b.path ===
      'config/connections/benchmarks/discovery-synthetic-v3/author-controls.json',
  )?.sha256,
  freeze.controls_sha256,
);
const previous = await read(
  'tracking/evidence/discovery-v2-transport-repair/execution-plan.json',
);
const sourcePaths = [
  'scripts/prepare-discovery-qualification-v3.mjs',
  'scripts/prepare-discovery-v3-execution.mjs',
  'scripts/qualify-plan-discovery-v3.mjs',
  'scripts/qualify-plan-discovery-v3.ps1',
  'tests/src/discovery-qualification-v3.test.ts',
  'tests/src/discovery-output-contract.test.ts',
  'tests/src/discovery-contract-fixtures.ts',
  'config/connections/benchmarks/discovery-synthetic-v3/proposal.json',
  'tracking/evidence/discovery-qualification-v2/stopped.json',
  'tracking/evidence/discovery-qualification-v2/preflight-state.json',
  'tracking/evidence/discovery-qualification-v2/postrun-state.json',
  'tracking/evidence/discovery-qualification-v2/run.lock',
  'apps/api/src/index.ts',
  'apps/api/dist/index.js',
  'tests/src/plan-connections-api.test.ts',
  'scripts/qualify-discovery-transport-repair.mjs',
  'scripts/qualify-discovery-transport-repair.ps1',
  'scripts/prepare-discovery-transport-repair.mjs',
  ...Object.keys(previous.source_sha256),
  'scripts/qualify-plan-discovery-v2.mjs',
  'scripts/qualify-plan-discovery-v2.ps1',
  'scripts/prepare-discovery-qualification-v2.mjs',
  'scripts/prepare-discovery-v2-execution.mjs',
  'tests/src/discovery-qualification-v2.test.ts',
  'tests/src/discovery-qualification.test.ts',
  'tests/src/subscription-workflow.test.ts',
  'tests/src/plan-connections.test.ts',
  'config/connections/benchmarks/discovery-synthetic-v3/author-controls.json',
  'config/connections/benchmarks/discovery-synthetic-v2/proposal.json',
];
const source_sha256 = {};
for (const p of new Set(sourcePaths)) source_sha256[p] = sha(await bytes(p));
const installer =
  'apps/desktop/src-tauri/target/release/bundle/nsis/Creator Agent_0.1.0_x64-setup.exe';
const installerHash = sha(await bytes(installer));
const installedHash = sha(
  await readFile(
    'C:/Users/jorda/AppData/Local/Creator Agent/studio/bundle-manifest.json',
  ),
);
assert.equal(
  installedHash,
  previous.bundle_manifest_sha256,
  'Installed candidate changed; review upgrade scope.',
);
const testLog = (
  await bytes('tracking/evidence/discovery-qualification-v3/tests.tap')
).toString();
assert.match(testLog, /# pass 56\b/);
assert.match(testLog, /# fail 0\b/);
assert.match(testLog, /# skipped 0\b/);
const plan = {
  format: 'discovery-qualification-execution/3',
  status: 'prepared_pending_specific_owner_approval',
  prepared_at: new Date().toISOString(),
  preparation_hash: canonicalHash(freeze),
  workspace_id: previous.workspace_id,
  connection_id: previous.connection_id,
  model_id: freeze.model_id,
  max_new_requests: 18,
  metered_spend_nano_usd: '0',
  retries: 0,
  max_concurrency: 1,
  max_wall_ms: 2160000,
  min_held_out_cases_per_class: 4,
  floor: { numerator: 1, denominator: 1 },
  role_prompt_hash: DISCOVERY_PROMPT_HASH,
  proposed_settings_hash: previous.proposed_settings_hash,
  settings_changes: false,
  migration_required: false,
  required_schema: 27,
  install_dir: previous.install_dir,
  expected_installed_before_manifest_sha256: installedHash,
  bundle_manifest_sha256: sha(bundleBytes),
  installer_path: installer,
  installer_sha256: installerHash,
  source_sha256,
  manual_review:
    'Required separately; operational contract acceptance is not substantive approval. Retain exact output/candidate hashes, reviewer identity, findings and disagreements.',
  note: 'New role1.2 and fresh v3 frozen cases; not authorized by prior installation/run grants. Install only after matching approval and active/unknown-work checks. Preserve all prior failures and locks. No automatic workflow/search/pilot/build launch.',
};
await writeFile(
  new URL('execution-plan.json', dir),
  JSON.stringify(plan, null, 2) + '\n',
  { flag: 'wx' },
);
await writeFile(
  new URL('result.json', dir),
  JSON.stringify(
    {
      state: 'prepared_only',
      at: new Date().toISOString(),
      execution_plan_hash: canonicalHash(plan),
      freeze_hash: canonicalHash(freeze),
      installer_sha256: installerHash,
      bundle_manifest_sha256: sha(bundleBytes),
      source_bindings: Object.keys(source_sha256).length,
      affected_tests: { passed: 56, failed: 0, skipped: 0 },
      local_scorer_controls: 144,
      new_provider_calls: 0,
      installed: false,
      settings_changed: false,
      migration_required: false,
      original_failed_run_preserved: true,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    state: plan.status,
    execution_plan_hash: canonicalHash(plan),
    installer_sha256: installerHash,
    bundle_manifest_sha256: plan.bundle_manifest_sha256,
    source_bindings: Object.keys(source_sha256).length,
  }),
);
