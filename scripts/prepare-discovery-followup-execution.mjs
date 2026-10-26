// Bind the already-built v5 runtime and external fresh manifests; no install or calls.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../packages/domain/dist/index.js';
import { checkFollowup, FOLLOWUP_DIR } from './check-discovery-followup.mjs';
import { FOLLOWUP_LIMITS } from './discovery-followup-core.mjs';

const { frozen } = await checkFollowup({ requirePlan: false });
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const old = await read(
  'tracking/evidence/discovery-qualification-v5/execution-plan.json',
);
const stage = 'apps/desktop/.bundle/studio/bundle-manifest.json';
const bytes = await readFile(stage);
assert.equal(sha(bytes), frozen.candidate_manifest_sha256);
const bundle = JSON.parse(bytes);
for (const f of bundle.files)
  assert.equal(
    sha(await readFile('apps/desktop/.bundle/studio/' + f.path)),
    f.sha256,
    f.path,
  );
const log = await readFile(FOLLOWUP_DIR + 'tests-final.tap', 'utf8');
assert.match(log, /# pass 14\b/);
assert.match(log, /# fail 0\b/);
assert.match(log, /# skipped 0\b/);
const extra = [
  'scripts/discovery-followup-core.mjs',
  'scripts/prepare-discovery-followup.mjs',
  'scripts/check-discovery-followup.mjs',
  'scripts/qualify-discovery-followup.mjs',
  'scripts/qualify-discovery-followup.ps1',
  'scripts/prepare-discovery-followup-execution.mjs',
  'tests/src/discovery-followup.test.mjs',
  FOLLOWUP_DIR + 'freeze.json',
  FOLLOWUP_DIR + 'review-plan.json',
  FOLLOWUP_DIR + 'tests-final.tap',
  frozen.controls_path,
  ...frozen.files.map((f) => f.path),
  'tracking/evidence/discovery-followup-proposal/review-packet.json',
  'tracking/evidence/discovery-followup-proposal/review-response-template.json',
  stage,
];
const source_sha256 = { ...frozen.source_bindings, ...frozen.prior_evidence };
for (const p of extra) source_sha256[p] = sha(await readFile(p));
const plan = {
  format: 'discovery-followup-execution/1',
  status:
    'prepared_pending_separate_review_provider_availability_and_exact_approval',
  prepared_at: new Date().toISOString(),
  preparation_hash: canonicalHash(frozen),
  workspace_id: old.workspace_id,
  connection_id: old.connection_id,
  model_id: old.model_id,
  proposed_settings_hash: old.proposed_settings_hash,
  role_prompt_hash: frozen.prompt_hash,
  required_schema: 27,
  install_dir: old.install_dir,
  bundle_manifest_sha256: frozen.candidate_manifest_sha256,
  candidate_mode: 'unchanged_v5_runtime_with_external_frozen_manifests',
  installation_required: false,
  settings_changes: false,
  migration_required: false,
  limits: FOLLOWUP_LIMITS,
  min_held_out_cases_per_class: 4,
  floor: { numerator: 1, denominator: 1 },
  source_sha256,
  prior_review_packet_hash: canonicalHash(
    await read(
      'tracking/evidence/discovery-followup-proposal/review-packet.json',
    ),
  ),
  provider_availability_max_age_ms: 900000,
  stop_conditions: [
    'unsuccessful',
    'refused',
    'unknown',
    'quota',
    'deadline',
    'cancelled',
    'binding_mismatch',
  ],
  historical_evidence_policy:
    'Do not resume v5 or pool historical successes. Research qualification remains narrow; candidate/scoring require this new suite and separate substantive review.',
  pending: [
    'Separate substantive acceptance of exact prior outputs',
    'Fresh provider-available state, no older than 15 minutes, without a quota probe or reset in this runner',
    'Exact scoped approval hash and fresh installed/settings/usage/idle-state preflight',
  ],
  automatic_next_actions: [],
};
const save = (name, value) =>
  writeFile(FOLLOWUP_DIR + name, JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
  });
await save('execution-plan.json', plan);
await save('preparation-result.json', {
  prepared_at: new Date().toISOString(),
  state: plan.status,
  freeze_hash: canonicalHash(frozen),
  execution_plan_hash: canonicalHash(plan),
  source_bindings: Object.keys(source_sha256).length,
  staged_resources_verified: bundle.files.length,
  installed_resources_checked_now: false,
  affected_tests: {
    pass: 14,
    fail: 0,
    skipped: 0,
    type: 'offline_contract_and_injected_adapter_control_loop',
  },
  local_controls: frozen.local_controls,
  transport: frozen.transport,
  live_calls: 0,
  installation_performed: false,
  settings_changed: false,
  historical_evidence_preserved: true,
  independent_substantive_review: 'required_not_performed',
});
console.log(
  JSON.stringify({
    execution_plan_hash: canonicalHash(plan),
    freeze_hash: canonicalHash(frozen),
    source_bindings: Object.keys(source_sha256).length,
    staged_resources: bundle.files.length,
    live_calls: 0,
  }),
);
