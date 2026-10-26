// Static packet validation only; never a live execution entry point.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BenchmarkManifestSchema } from '../packages/contracts/dist/index.js';
import {
  canonicalHash,
  discoveryRoleInput,
  checkOutput,
  checkDiscoveryOutput,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
} from '../packages/domain/dist/index.js';
import { FOLLOWUP_LIMITS } from './discovery-followup-core.mjs';
const dir = 'tracking/evidence/discovery-semantics-v1/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const f = await read(dir + 'freeze.json');
assert.equal(
  canonicalHash(f),
  '92635f76d187a51c3f356847f65d13d48dbdc31235feda8b31efe5841f2f5b59',
);
assert.equal(f.role_version, DISCOVERY_ROLE_VERSION);
assert.equal(f.prompt_hash, DISCOVERY_PROMPT_HASH);
assert.deepEqual(f.limits, FOLLOWUP_LIMITS);
assert.deepEqual(f.held_out_floor, {
  cases_per_class: 4,
  numerator: 1,
  denominator: 1,
});
for (const [p, h] of Object.entries(f.source_sha256))
  assert.equal(sha(await readFile(p)), h, p);
assert.equal(
  canonicalHash({
    kind: f.candidate_identity_kind,
    role_version: f.role_version,
    prompt_hash: f.prompt_hash,
    source_sha256: f.source_sha256,
  }),
  f.candidate_hash,
);
assert.equal(sha(await readFile(f.controls_path)), f.controls_sha256);
assert.equal(
  sha(await readFile(dir + 'review-plan.json')),
  f.review_plan_sha256,
);
assert.equal(
  sha(
    await readFile('tracking/evidence/discovery-followup-v2/live-result.json'),
  ),
  f.historical_live_result_sha256,
);
const history = await read(
  'tracking/evidence/discovery-followup-v2/live-result.json',
);
for (const [p, h] of Object.entries(history.artifact_sha256))
  assert.equal(sha(await readFile(p)), h, p);
const controls = await read(f.controls_path),
  review = await read(dir + 'review-plan.json');
assert.equal(controls.length, 12);
assert.equal(review.cases.length, 12);
let count = 0;
for (const file of f.files) {
  const bytes = await readFile(file.path);
  assert.equal(sha(bytes), file.sha256);
  const m = BenchmarkManifestSchema.parse(JSON.parse(bytes));
  assert.equal(canonicalHash(m), file.manifest_hash);
  assert.equal(m.fixture, false);
  assert.equal(m.cases.filter((c) => c.split === 'development').length, 2);
  assert.equal(m.cases.filter((c) => c.split === 'held_out').length, 4);
  for (const c of m.cases) {
    const ctrl = controls.find((x) => x.case_id === c.case_id),
      r = review.cases.find((x) => x.case_id === c.case_id);
    assert.ok(ctrl && r);
    assert.equal(r.candidate_hash, f.candidate_hash);
    assert.equal(r.output_hash, null);
    assert.equal(r.result, 'not_reviewed');
    assert.equal(r.packet_hash, canonicalHash(c.check.packet));
    assert.equal(c.check.context.packet_hash, canonicalHash(c.check.packet));
    for (let i = 0; i < ctrl.inputs.length; i++)
      assert.equal(
        c.check.context.inputs[i].output_hash,
        canonicalHash(ctrl.inputs[i].output),
      );
    const input = discoveryRoleInput(
      c.check.task_kind,
      c.check.context,
      c.check.packet,
      ctrl.inputs,
    );
    assert.equal(
      c.input[0].text,
      input
        .filter((x) => x.role === 'system')
        .map((x) => x.text)
        .join('\n'),
    );
    assert.equal(
      c.input[1].text,
      JSON.stringify(input.filter((x) => x.role === 'user')),
    );
    assert.ok(c.input.reduce((n, x) => n + x.text.length, 0) <= 24000);
    const score = (j, check = c.check) =>
      checkOutput(
        check,
        { json: j, text: JSON.stringify(j) },
        { succeeded: true, reason_code: 'offline_control' },
      );
    assert.equal(score(ctrl.gold), 'accepted');
    count++;
    assert.ok(
      checkDiscoveryOutput(
        c.check.task_kind,
        ctrl.negative,
        c.check.packet,
        c.check.context,
      ).ok,
    );
    assert.notEqual(score(ctrl.negative), 'accepted');
    count += 2;
    const forged = structuredClone(ctrl.gold);
    if (forged.claim_refs) forged.claim_refs = ['C99'];
    else
      forged.reviews[0].findings = [
        {
          type: 'weak_evidence',
          detail: 'Invalid claim ref',
          claim_refs: ['C99'],
          catalog_ref: null,
        },
      ];
    for (const bad of [
      forged,
      {},
      { ...ctrl.gold, extra: true },
      { ...ctrl.gold, fixture: true },
    ]) {
      assert.notEqual(score(bad), 'accepted');
      count++;
    }
    const stale = structuredClone(c.check);
    stale.context.packet_hash = '0'.repeat(64);
    assert.notEqual(score(ctrl.gold, stale), 'accepted');
    count++;
    assert.equal(score(ctrl.manual_negative), 'accepted');
    count++;
  }
  assert.ok(
    Buffer.byteLength(
      JSON.stringify({
        expected_version: 1,
        model_id: 'gpt-6-astra',
        manifest: m,
        min_held_out_cases: 4,
        floor: { numerator: 1, denominator: 1 },
      }),
    ) <= 131072,
  );
}
assert.equal(count, 108);
assert.equal(f.installed_candidate_bound, false);
assert.equal(f.execution_plan_ready, false);
console.log(
  JSON.stringify({
    state: 'offline_packet_checks_passed',
    cases: 12,
    controls: count,
    source_bindings: Object.keys(f.source_sha256).length,
    candidate_hash: f.candidate_hash,
    freeze_hash: canonicalHash(f),
    provider_calls: 0,
    live_execution_ready: false,
  }),
);
