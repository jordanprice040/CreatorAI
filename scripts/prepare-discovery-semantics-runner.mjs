// Exact executable-plan freeze, offline only; no studio or provider access.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../packages/domain/dist/index.js';
const d = 'tracking/evidence/discovery-semantics-v2-runner/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = async (p) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
const binding = await read(
    'tracking/evidence/discovery-semantics-v2-package/execution-binding.json',
  ),
  candidate = await read(
    'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
  );
const rp =
    'tracking/evidence/discovery-semantics-v2-package-review-2026-10-22/reviewer-receipt.json',
  review = await read(rp);
assert.equal(review.status, 'supported_exact_package_and_declarative_bindings');
for (const [p, h] of Object.entries(review.artifact_sha256))
  assert.equal(await hash(p), h, p);
const paths = [
  ...Object.keys(candidate.source_sha256),
  rp,
  'tracking/evidence/discovery-semantics-v2-package/candidate-plan.json',
  'tracking/evidence/discovery-semantics-v2-package/installation-plan.json',
  'tracking/evidence/discovery-semantics-v2-package/execution-binding.json',
  'scripts/check-discovery-semantics-v2.mjs',
  'scripts/check-discovery-semantics-runner.mjs',
  'scripts/qualify-discovery-semantics-v2.mjs',
  'scripts/qualify-discovery-semantics-v2.ps1',
  'scripts/prepare-discovery-semantics-runner.mjs',
  'tests/discovery-semantics-runner.test.mjs',
  'tests/src/discovery-semantics-runner.test.ts',
];
const plan = {
  ...binding,
  format: 'discovery-semantics-executable-plan/1',
  status:
    'implemented_pending_runner_review_installation_and_exact_owner_decision',
  prepared_at: new Date().toISOString(),
  binding_hash: canonicalHash(binding),
  candidate_plan_hash: canonicalHash(candidate),
  studio_home: 'C:/Users/jorda/AppData/Local/com.creatoragent.studio',
  proposed_settings_hash: binding.settings_hash,
  runner_review_required: true,
  installation_receipt_required: true,
  source_sha256: Object.fromEntries(
    await Promise.all([...new Set(paths)].map(async (p) => [p, await hash(p)])),
  ),
  dispatch_ready: false,
  runner_required: false,
  supersedes_executable_plan: 'execution-plan-v2.json',
  unresolved_gates: [
    'Independent exact executable-plan/runner review',
    'Verified supported local installation with record/backup evidence',
    'Exact executable-plan owner decision and fresh preflight',
  ],
};
await mkdir(d, { recursive: true });
await writeFile(
  d + 'execution-plan-v3.json',
  JSON.stringify(plan, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  JSON.stringify({
    execution_plan_hash: canonicalHash(plan),
    source_bindings: Object.keys(plan.source_sha256).length,
    provider_calls: 0,
    dispatch_ready: false,
  }),
);
