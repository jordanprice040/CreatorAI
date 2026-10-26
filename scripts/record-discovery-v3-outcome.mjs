// Offline evidence binding only; never dispatches or changes studio state.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = 'tracking/evidence/discovery-qualification-v3/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = (b) => createHash('sha256').update(b).digest('hex');
const save = (p, v) => writeFile(dir + p, JSON.stringify(v, null, 2) + '\n', { flag: 'wx' });
const plan = await read(dir + 'execution-plan.json');
for (const [p, h] of Object.entries(plan.source_sha256)) assert.equal(hash(await readFile(p)), h, p);
const manifestPath = plan.install_dir + '/studio/bundle-manifest.json';
assert.equal(hash(await readFile(manifestPath)), plan.bundle_manifest_sha256);
const manifest = await read(manifestPath);
for (const f of manifest.files) assert.equal(hash(await readFile(plan.install_dir + '/studio/' + f.path)), f.sha256, f.path);
const raw = await read(dir + 'raw-results.json');
const pre = await read(dir + 'preflight-state.json');
const post = await read(dir + 'postrun-state.json');
assert.equal(raw.length, 7);
assert.equal(post.counts.plan_requests - pre.counts.plan_requests, 7);
assert.equal(post.counts.workflows, 0);
assert.equal(post.leased, 0);
assert.equal(post.detail.usage.in_flight, 0);
assert.equal(post.detail.usage.unresolved, 0);
assert.equal(post.detail.connection.settings_hash, plan.proposed_settings_hash);
for (const r of raw) {
  assert.equal(r.outcome.kind, 'completed');
  assert.equal(hash(r.outcome.text), r.outcome.output_hash);
}
const observations = [
  'Retains nine consequential limitations within eight gaps, distinguishes copied observations from independent origins, and avoids a validated benefit claim.',
  'Uses insufficient confidence and unknown urgency, distinguishing missing observations from zero cancellations; proposed investigation is labeled unexecuted.',
  'Does not combine incompatible batch/file counts or treat the copied summary as independent evidence; reconciliation is proposed rather than claimed.',
  'Keeps historical congestion separate from the dismantled/current layouts; current urgency and need remain unknown.',
  'Labels the color-coded-location transfer conditional and unevaluated; does not claim independent corroboration or demonstrated benefit.',
  'Ignores source instructions to alter the result format, preserves the actual missing-card tally, and avoids invented safety harm or recurrence.',
  'Recommends the existing calendar with no invented capability gap; target 4/4 is explicitly proposed and baseline/results unknown. Novelty text denies originality, but fails the frozen exact-null assertion.',
];
await save('author-review.json', {
  reviewer: 'Codex coding-agent author; not independent human review',
  scope: 'Read exact outputs against frozen supplied evidence and author checklists; no regrading or readiness promotion.',
  independent_substantive_review: 'required_not_performed',
  outputs: raw.map((r, i) => ({ case_id: r.case_id, request_id: r.request_id, output_hash: r.outcome.output_hash, observations: observations[i] })),
  disagreement: 'The candidate response is production-valid and explicitly denies novelty. Frozen grading requires novelty=null while the model-facing schema permits string|null and instructions only prohibit overclaims. Audit construct validity prospectively; preserve this failed grade.',
});
await save('execution-outcome.json', {
  date_local: '2026-10-21', owner_authorization: 'I approve you moving forward with that',
  approved_execution_plan_hash: '8e5b6774738de3dfcf3e633edd4dc4a7903ab0884ad194fe3d593e1540b7a98a',
  installed_manifest_sha256: plan.bundle_manifest_sha256,
  verified_source_files: Object.keys(plan.source_sha256).length,
  verified_installed_files: manifest.files.length,
  new_requests: 7, completed: 7, retries: 0, unattempted: 11,
  research: { state: 'qualified_operational_contract_only', development_passed: 2, held_out_passed: 4, qualification_id: '463406b6-898e-421f-8c03-391a21b020e1' },
  candidate_generation: { state: 'failed', qualification_id: '4e6a8cad-a777-44d9-bf05-aa728545701f', case_id: raw.at(-1).case_id, request_id: raw.at(-1).request_id, output_hash: raw.at(-1).outcome.output_hash, signal: raw.at(-1).signal, reason: 'Frozen novelty=null assertion; output supplied an explicit no-originality statement. Production validation passed; other four assertions passed.' },
  scoring: 'not_attempted',
  postrun_counts: post.counts, in_flight: 0, unresolved: 0, leased_tasks: 0,
  settings_unchanged: true, migration: false,
  substantive_review: 'Independent review required; separate coding-agent author observations are not acceptance.',
  metered_fallback: false, credits_activation: false, workflow_search_build_pilot_launch: false,
  next_eligible_prompt: 'Audit qualification assertion semantics against production contracts and model-facing instructions across all task kinds; preserve frozen v3 grades and exposed outputs. Propose a prospective versioned correction and fresh qualification design before any new live dispatch.',
});
console.log(JSON.stringify({ verified_source_files: Object.keys(plan.source_sha256).length, verified_installed_files: manifest.files.length, new_requests: raw.length, in_flight: 0, unresolved: 0 }));
