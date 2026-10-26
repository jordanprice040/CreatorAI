// Repository-only evidence reconciliation. Never resolves operational receipt paths.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
const root = 'C:/dev/creator_agent';
const out = 'tracking/evidence/theme-intent-acceptance-readiness-2026-10-24';
const inputs = {};
function local(p) {
  if (path.isAbsolute(p) || p.split(/[\\/]/).includes('..')) throw Error('Non-repository path');
  return path.join(root, p);
}
function hash(p) {
  const h = crypto.createHash('sha256').update(fs.readFileSync(local(p))).digest('hex');
  inputs[p] = h;
  return h;
}
function read(p) { hash(p); return JSON.parse(fs.readFileSync(local(p), 'utf8')); }
const installPath = 'tracking/evidence/theme-intent-installation-v4-2026-10-24/completion-receipt.json';
const beforeDir = 'tracking/evidence/theme-intent-operational-before-v4-2026-10-24/';
const install = read(installPath);
const before = read(beforeDir + 'completion-receipt.json');
let checked = 0;
function checkMap(map, prefix = '') {
  for (const [p, expected] of Object.entries(map)) {
    if (hash(prefix + p) !== expected) throw Error('Hash mismatch: ' + p);
    checked++;
  }
}
checkMap(install.evidence_sha256);
checkMap(before.evidence_sha256, beforeDir);
const review = read('tracking/evidence/theme-intent-upgrade-helper-v4-review-2026-10-24/reviewer-receipt.json');
checkMap(review.helper_sha256);
if (JSON.stringify(review.helper_sha256) !== JSON.stringify(install.helper_sha256)) throw Error('Helper map differs');
const revision = read('tracking/evidence/theme-intent-acceptance-plan-v2-2026-10-24/revision-receipt.json');
checkMap(revision.artifact_sha256);
const run = {};
for (const name of fs.readdirSync(local(beforeDir + 'run-01'))) {
  if (name.endsWith('.json')) run[name] = read(beforeDir + 'run-01/' + name);
}
const verification = run[path.basename(install.verification.receipt)];
const business = Object.entries(run['before.json'].hashes);
if (business.length !== 114 || business.some(([k,v]) => verification.state.hashes[k] !== v)) throw Error('Business preservation mismatch');
if (verification.state.schema !== 29 || run['migration-result.json'].result.to !== 29) throw Error('Schema mismatch');
if (!(Date.parse(run['migration-result.json'].at) < Date.parse(verification.state.observed_at))) throw Error('Timeline');
const docs = [
  'docs/THEME_INTENT_ACCEPTANCE_READINESS_2026-10-24.md',
  'docs/THEME_INTENT_ACCEPTANCE_INDEPENDENT_REVIEW_PROMPT_2026-10-24.md',
  'docs/THEME_INTENT_INSTALLATION_RESULT_2026-10-24.md',
  'docs/THEME_INTENT_UPGRADE_HELPER_V4_2026-10-24.md',
  'docs/THEME_INTENT_UPGRADE_HELPER_V4_REVIEW_2026-10-24.md',
];
docs.forEach(hash);
hash(out + '/assess.mjs');
const result = {
  format: 'theme-intent-native-acceptance-readiness/1',
  recorded_at: new Date().toISOString(), status: 'blocked_for_native_session',
  independent_review: false, newer_exact_v2_review_found_in_repository: false,
  search_scope: 'rg filename inventory docs/tracking/evidence and text search docs/tracking for checklist-v2, acceptance-plan-v2 and exact checklist hash; no external chats searched',
  candidate_plan_hash: install.candidate_plan_hash, installation_plan_hash: install.installation_plan_hash,
  checks: { hash_bindings_checked: checked, mismatches: 0, helper_bindings: Object.keys(review.helper_sha256).length,
    run_json_receipts_read: Object.keys(run).length, business_table_hashes_preserved: business.length,
    schema: 29, migration_precedes_observation: true, checklist_bytes_unchanged: true },
  installed_state_basis: 'Historical pre-UI receipts only; no fresh operational inspection',
  blockers: ['independent exact-v2 checklist review', 'unknown live scheduling state', 'workspace ID/current owner-editor role and session authorization', 'continuity attestation through future first launch'],
  native_cases_executed: 0, operational_access: false, credentials_accessed: false,
  helper_executions: 0, provider_calls: 0, workflows_activated: 0, retired_checkout_accessed: false,
  full_C54: 'partial', input_sha256: inputs,
};
fs.writeFileSync(local(out + '/assessment-receipt.json'), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result.checks));
