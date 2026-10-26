// Static frozen packet checker; no API, credentials or provider access.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BenchmarkManifestSchema } from '../packages/contracts/dist/index.js';
import {
  canonicalHash,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
  discoveryRoleInput,
  checkOutput,
  checkDiscoveryOutput,
} from '../packages/domain/dist/index.js';
const dir = 'tracking/evidence/discovery-research14-v2/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = async (p) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
const f = await read(dir + 'freeze.json');
assert.equal(
  canonicalHash(f),
  'c0576b32481fc2f682a71d7506ef10fe4866382d065dbeb45e68d937395142d4',
);
assert.equal(f.role_version, DISCOVERY_ROLE_VERSION);
assert.equal(f.prompt_hash, DISCOVERY_PROMPT_HASH);
for (const [p, h] of Object.entries(f.source_sha256))
  assert.equal(await hash(p), h, p);
const candidate = await read(f.candidate_plan_path);
assert.equal(canonicalHash(candidate), f.candidate_plan_hash);
assert.equal(candidate.bundle_manifest_sha256, f.installed_manifest_sha256);
assert.equal(
  await hash(
    'C:/Users/jorda/AppData/Local/Creator Agent/studio/bundle-manifest.json',
  ),
  f.installed_manifest_sha256,
);
assert.equal(await hash(f.controls_path), f.controls_sha256);
assert.equal(await hash(dir + 'review-plan.json'), f.review_plan_sha256);
const ctrls = await read(f.controls_path),
  review = await read(dir + 'review-plan.json');
assert.equal(review.cases.length, 6);
let checks = 0;
for (const file of f.files) {
  assert.equal(await hash(file.path), file.sha256);
  const m = BenchmarkManifestSchema.parse(await read(file.path));
  assert.equal(canonicalHash(m), file.manifest_hash);
  assert.equal(m.fixture, false);
  assert.equal(m.task_class, 'research_synthesis');
  assert.equal(m.cases.filter((c) => c.split === 'development').length, 2);
  assert.equal(m.cases.filter((c) => c.split === 'held_out').length, 4);
  for (const c of m.cases) {
    assert.equal(c.check.task_kind, 'locate');
    assert.equal(c.check.context.role_version, DISCOVERY_ROLE_VERSION);
    assert.equal(c.check.context.packet_hash, canonicalHash(c.check.packet));
    const input = discoveryRoleInput(
      'locate',
      c.check.context,
      c.check.packet,
      [],
    );
    assert.equal(c.input[0].text, input[0].text);
    assert.equal(
      c.input[1].text,
      JSON.stringify(input.filter((m) => m.role === 'user')),
    );
    const r = review.cases.find((r) => r.case_id === c.case_id);
    assert.equal(r.packet_hash, canonicalHash(c.check.packet));
    assert.equal(r.candidate_hash, f.candidate_plan_hash);
    assert.equal(r.checklist.length, 3);
    assert.equal(r.result, 'not_reviewed');
    assert.equal(r.output_hash, null);
    const ctrl = ctrls.find((v) => v.case_id === c.case_id);
    const score = (j, check = c.check) =>
      checkOutput(
        check,
        { json: j, text: JSON.stringify(j) },
        { succeeded: true, reason_code: 'offline_control' },
      );
    assert.equal(score(ctrl.gold), 'accepted');
    checks++;
    assert.ok(
      checkDiscoveryOutput(
        'locate',
        ctrl.negative,
        c.check.packet,
        c.check.context,
      ).ok,
    );
    assert.notEqual(score(ctrl.negative), 'accepted');
    checks += 2;
    const forged = structuredClone(ctrl.gold);
    forged.urgency.claim_refs = ['C99'];
    for (const bad of [
      forged,
      {},
      { ...ctrl.gold, extra: true },
      { ...ctrl.gold, fixture: true },
    ]) {
      assert.notEqual(score(bad), 'accepted');
      checks++;
    }
    const stale = structuredClone(c.check);
    stale.context.packet_hash = '0'.repeat(64);
    assert.notEqual(score(ctrl.gold, stale), 'accepted');
    checks++;
    assert.equal(score(ctrl.manual_negative), 'accepted');
    checks++;
    assert.ok(c.input.reduce((n, m) => n + m.text.length, 0) <= 24000);
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
assert.equal(checks, 54);
assert.equal(f.limits.max_new_requests, 6);
assert.equal(f.limits.retries, 0);
assert.equal(f.limits.max_wall_ms, 720000);
assert.equal(f.min_held_out_cases, 4);
assert.deepEqual(f.floor, { numerator: 1, denominator: 1 });
console.log(
  JSON.stringify({
    state: 'offline_packet_checks_passed',
    cases: 6,
    controls: checks,
    freeze_hash: canonicalHash(f),
    candidate_plan_hash: f.candidate_plan_hash,
    installed_manifest_matches: true,
    provider_calls: 0,
    live_execution_ready: false,
  }),
);
