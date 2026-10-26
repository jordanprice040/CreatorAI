// Read-only replay of frozen evidence; writes only a new review receipt.
import assert from 'node:assert/strict';
import { readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalHash, checkOutput } from '../packages/domain/dist/index.js';

const base = 'tracking/evidence/discovery-qualification-v5/';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const before = new Map();
for (const name of await readdir(base, { withFileTypes: true })) {
  if (name.isFile() && name.name !== 'offline-review-receipt.json')
    before.set(base + name.name, sha(await readFile(base + name.name)));
}
const freeze = await json(base + 'freeze.json');
const plan = await json(base + 'execution-plan.json');
assert.equal(canonicalHash(freeze), plan.preparation_hash);
assert.equal(
  canonicalHash(plan),
  '68c59f330da54b3e22933f5e789f520edec3abbcdbf985666ccec5a4f89af37d',
);
const cases = new Map();
for (const file of freeze.files) {
  const bytes = await readFile(file.path);
  assert.equal(sha(bytes), file.sha256);
  const manifest = JSON.parse(bytes);
  assert.equal(canonicalHash(manifest), file.canonical_hash);
  for (const c of manifest.cases) cases.set(c.case_id, c);
}
const raw = await json(base + 'raw-results.json');
const author = await json(base + 'author-review.json');
const reviews = await json(base + 'review-plan.json');
const completed = raw.filter((r) => r.outcome.kind === 'completed');
assert.equal(raw.length, 11);
assert.equal(completed.length, 10);
const outputs = completed.map((r) => {
  const c = cases.get(r.case_id);
  assert.ok(c);
  assert.equal(sha(r.outcome.text), r.outcome.output_hash);
  assert.equal(
    author.outputs.find((a) => a.case_id === r.case_id).output_hash,
    r.outcome.output_hash,
  );
  assert.ok(reviews.cases.find((a) => a.case_id === r.case_id));
  assert.equal(canonicalHash(c.check.packet), c.check.context.packet_hash);
  assert.equal(
    checkOutput(
      c.check,
      { text: r.outcome.text, json: JSON.parse(r.outcome.text) },
      { succeeded: true, reason_code: 'offline_replay' },
    ),
    'accepted',
  );
  return {
    case_id: r.case_id,
    request_id: r.request_id,
    split: r.split,
    packet_hash: c.check.context.packet_hash,
    output_hash: r.outcome.output_hash,
    frozen_check: 'accepted',
  };
});
assert.equal(
  raw[10].outcome.reason_code,
  'subscription_sharing_usage_limit_exceeded',
);
const remaining = [...cases.values()]
  .filter((c) => !completed.some((r) => r.case_id === c.case_id))
  .map((c) => ({
    case_id: c.case_id,
    task_kind: c.check.task_kind,
    split: c.split,
    state: raw.some((r) => r.case_id === c.case_id)
      ? 'provider_quota_failure_no_answer'
      : 'unattempted',
  }));
assert.equal(remaining.length, 8);
for (const [path, hash] of before)
  assert.equal(sha(await readFile(path)), hash, path);
const receipt = {
  format: 'discovery-v5-offline-review/1',
  reviewed_at: new Date().toISOString(),
  reviewer:
    'Codex coding-agent second-pass review; not independent of authoring history',
  independent_substantive_acceptance: 'required_not_performed',
  report: 'docs/DISCOVERY_V5_OFFLINE_REVIEW.md',
  candidate_manifest_sha256: plan.bundle_manifest_sha256,
  freeze_hash: canonicalHash(freeze),
  execution_plan_hash: canonicalHash(plan),
  outputs,
  remaining,
  preserved_inputs: Object.fromEntries(before),
  live_calls: 0,
  original_grades_changed: false,
};
await writeFile(
  base + 'offline-review-receipt.json',
  JSON.stringify(receipt, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(
  'Verified 10 output hashes and frozen checks; 8 cases lack completed answers (1 quota failure, 7 unattempted). Original top-level evidence unchanged.',
);
