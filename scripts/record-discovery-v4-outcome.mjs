// Offline binding of the stopped run; no dispatch or reconciliation.
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const dir = 'tracking/evidence/discovery-qualification-v4/';
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
assert.equal(raw.length, 6);
assert.equal(post.counts.plan_requests - pre.counts.plan_requests, 6);
assert.equal(post.counts.workflows, 0);
assert.equal(post.leased, 0);
assert.equal(post.detail.usage.in_flight, 0);
assert.equal(post.detail.usage.unresolved, 1);
assert.equal(post.detail.connection.settings_hash, plan.proposed_settings_hash);
for (const r of raw.slice(0, 5)) {
  assert.equal(r.outcome.kind, 'completed');
  assert.equal(r.signal, 'accepted');
  assert.equal(hash(r.outcome.text), r.outcome.output_hash);
}
assert.equal(raw[5].outcome.kind, 'unknown');
assert.equal(raw[5].outcome.reason_code, 'timeout');
const request = post.requests.find((r) => r.id === raw[5].request_id);
assert.equal(request.state, 'unknown');
const elapsed = Date.parse(request.finished_at) - Date.parse(request.started_at);
const notes = [
 'Separates copied counts from distinct faults, independent origins and measured recurrence; retains unknown severity, causes and alternatives.',
 'Recognizes stipulated independent corroboration within the simulation, preserves denominators and matching windows, and denies real-world validation or demonstrated intervention benefit.',
 'Does not combine lots/envelopes or incompatible windows; proposes human reconciliation rather than inventing a count or completed action.',
 'Does not generalize retired ferry observations to the current procedure; defers with unknown urgency.',
 'Describes conditional paired-identifier transfer with an unevaluated physical alternative, no software benefit claim and unresolved cause.',
];
await save('author-review.json', {
  reviewer: 'Codex coding-agent author; not independent human review',
  independent_substantive_review: 'required_not_performed',
  outputs: raw.slice(0, 5).map((r, i) => ({ case_id: r.case_id, request_id: r.request_id, output_hash: r.outcome.output_hash, observation: notes[i] })),
  unknown_case: { case_id: raw[5].case_id, request_id: raw[5].request_id, review: 'No complete output or hash available; no substantive grade inferred.' },
});
await save('execution-outcome.json', {
  date_local: '2026-10-21', owner_authorization: 'I approve all that',
  approved_execution_plan_hash: '58dff31c4e9484689ff9c533c71337c44b97e6a52e8c1025a82562850af8d721',
  installed_manifest_sha256: plan.bundle_manifest_sha256,
  verified_source_files: Object.keys(plan.source_sha256).length,
  verified_installed_files: manifest.files.length,
  attempted: 6, completed: 5, accepted: 5, unknown: 1, retries: 0, unattempted: 12,
  research: { state: 'running_unresolved', qualification_id: '887288bb-ce7f-4edb-b11f-7f1494b146e3', observed_development_passes: 2, observed_held_out_passes: 3, remaining_held_out: 'one unknown timeout; no acceptance inferred' },
  unknown_request: { ...raw[5], elapsed_ms: elapsed },
  candidate_generation: 'not_attempted', scoring: 'not_attempted',
  postrun_counts: post.counts,
  request_states: post.requests.reduce((a, r) => ({ ...a, [r.state]: (a[r.state] ?? 0) + 1 }), {}),
  in_flight: 0, unresolved: 1, leased_tasks: 0,
  settings_unchanged: true, migration: false, owner_reconciliation_performed: false,
  substantive_review: 'Independent review required; author observations do not establish acceptance.',
  metered_fallback: false, credits_activation: false, workflow_search_build_pilot_launch: false,
  diagnostic: 'Local deadline elapsed after partial streaming; no response.completed observed. Response ID and 1653-character count retained, without complete text/hash/token count. Unknown is not proof of no execution or a completed usable result. Adapter has no implemented retrieval/reconciliation observer; store:false was configured. No quota exhaustion was observed.',
  next_eligible_prompt: 'Review timeout/stream recovery and evidence-backed reconciliation of the retained request. Do not retry, fabricate completion or clear unknown to continue; preserve the frozen run and lock. Any subsequent qualification requires its own prospective decision.',
});
console.log(JSON.stringify({ attempted: raw.length, completed: 5, unknown: 1, elapsed_ms: elapsed, verified_source_files: Object.keys(plan.source_sha256).length, verified_installed_files: manifest.files.length }));
