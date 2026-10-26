// Execution binding v2: unchanged frozen packets, explicit schema-28 runtime identity.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BenchmarkManifestSchema } from '../packages/contracts/dist/index.js';
import {
  canonicalHash,
  checkOutput,
  checkDiscoveryOutput,
  discoveryRoleInput,
  DISCOVERY_PROMPT_HASH,
  DISCOVERY_ROLE_VERSION,
} from '../packages/domain/dist/index.js';
import { FOLLOWUP_LIMITS } from './discovery-followup-core.mjs';
export { checkSeparateReview } from './check-discovery-followup.mjs';
export const FOLLOWUP_DIR = 'tracking/evidence/discovery-followup-v2/';
export const PACKET_DIR = 'tracking/evidence/discovery-followup-v1/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');

export async function verifyRuntimeBindings(plan) {
  for (const [path, hash] of Object.entries(plan.source_sha256))
    assert.equal(sha(await readFile(path)), hash, path);
}

export function assertExecutionBinding(plan, frozen, runtime, packaged) {
  assert.equal(plan.format, 'discovery-followup-execution/2');
  assert.equal(plan.packet_freeze_hash, canonicalHash(frozen));
  assert.equal(plan.packet_freeze_path, PACKET_DIR + 'freeze.json');
  assert.equal(plan.runtime_candidate_plan_hash, canonicalHash(runtime));
  for (const key of [
    'workspace_id',
    'connection_id',
    'model_id',
    'install_dir',
  ])
    assert.equal(plan[key], runtime[key], key);
  assert.equal(plan.model_id, frozen.model_id);
  assert.equal(plan.required_schema, 28);
  assert.equal(plan.required_schema, runtime.schema_to);
  assert.equal(plan.bundle_manifest_sha256, runtime.bundle_manifest_sha256);
  assert.equal(plan.desktop_payload_sha256, packaged.packaged_desktop_sha256);
  assert.equal(
    packaged.installed_desktop_sha256,
    packaged.packaged_desktop_sha256,
  );
  assert.equal(plan.installer_sha256, packaged.installer_sha256);
  assert.equal(plan.installer_sha256, runtime.installer_sha256);
  assert.equal(plan.proposed_settings_hash, runtime.settings_hash);
  assert.equal(plan.role_prompt_hash, frozen.prompt_hash);
  assert.deepEqual(plan.limits, FOLLOWUP_LIMITS);
  assert.equal(plan.provider_availability_max_age_ms, 900000);
  assert.equal(plan.min_held_out_cases_per_class, 4);
  assert.deepEqual(plan.floor, { numerator: 1, denominator: 1 });
  assert.equal(plan.settings_changes, false);
  assert.equal(plan.installation_required, false);
  assert.equal(plan.migration_required, false);
  assert.deepEqual(plan.automatic_next_actions, []);
}

export async function checkFollowup({ requirePlan = true } = {}) {
  const frozen = await read(PACKET_DIR + 'freeze.json');
  assert.equal(
    canonicalHash(frozen),
    '55da91cabef9163692508132e936b9a2e5df9815f071ca93642db0cd091f2266',
  );
  assert.equal(frozen.prompt_hash, DISCOVERY_PROMPT_HASH);
  assert.equal(frozen.role_version, DISCOVERY_ROLE_VERSION);
  assert.deepEqual(frozen.limits, FOLLOWUP_LIMITS);
  const bytes = await readFile(frozen.controls_path);
  assert.equal(sha(bytes), frozen.controls_sha256);
  const controls = JSON.parse(bytes);
  assert.equal(
    sha(await readFile(PACKET_DIR + 'review-plan.json')),
    frozen.review_plan_sha256,
  );
  const manifests = [],
    transport = [];
  let checks = 0;
  for (const f of frozen.files) {
    const bytes = await readFile(f.path);
    assert.equal(sha(bytes), f.sha256);
    const manifest = BenchmarkManifestSchema.parse(JSON.parse(bytes));
    assert.equal(canonicalHash(manifest), f.canonical_hash);
    assert.equal(manifest.fixture, false);
    assert.equal(manifest.data_class, 'synthetic');
    assert.equal(manifest.cases.length, 6);
    assert.equal(
      manifest.cases.filter((c) => c.split === 'development').length,
      2,
    );
    assert.equal(
      manifest.cases.filter((c) => c.split === 'held_out').length,
      4,
    );
    for (const c of manifest.cases) {
      assert.equal(c.check.context.packet_hash, canonicalHash(c.check.packet));
      const ctl = controls.find((x) => x.case_id === c.case_id);
      const rendered = discoveryRoleInput(
        c.check.task_kind,
        c.check.context,
        c.check.packet,
        ctl.inputs,
      );
      assert.equal(
        c.input[0].text,
        rendered
          .filter((m) => m.role === 'system')
          .map((m) => m.text)
          .join('\n'),
      );
      assert.equal(
        c.input[1].text,
        JSON.stringify(rendered.filter((m) => m.role === 'user')),
      );
      assert.deepEqual(
        c.check.context.inputs.map((i) => i.output_hash),
        ctl.inputs.map((i) => canonicalHash(i.output)),
      );
      assert.ok(
        c.input.reduce((n, m) => n + m.text.length, 0) <=
          FOLLOWUP_LIMITS.max_input_chars,
      );
      const score = (json, check = c.check) =>
        checkOutput(
          check,
          { text: JSON.stringify(json), json },
          { succeeded: true, reason_code: 'offline_rebind_control' },
        );
      assert.equal(score(ctl.gold), 'accepted');
      checks++;
      assert.equal(
        checkDiscoveryOutput(
          c.check.task_kind,
          ctl.negative,
          c.check.packet,
          c.check.context,
        ).ok,
        true,
      );
      checks++;
      const stale = structuredClone(c.check);
      stale.context.packet_hash = '0'.repeat(64);
      const forged = structuredClone(ctl.gold);
      if (forged.claim_refs) forged.claim_refs = ['C99'];
      else
        forged.reviews[0].findings = [
          {
            type: 'weak_evidence',
            detail: 'Invented source.',
            claim_refs: ['C99'],
            catalog_ref: null,
          },
        ];
      for (const bad of [
        {},
        { ...ctl.gold, extra: true },
        { ...ctl.gold, fixture: true },
        forged,
        ctl.negative,
      ]) {
        assert.notEqual(score(bad), 'accepted');
        checks++;
      }
      assert.notEqual(score(ctl.gold, stale), 'accepted');
      checks++;
      assert.equal(
        score(ctl.manual_negative),
        'accepted',
        'Preserve disclosed substantive-review blind spot.',
      );
      checks++;
    }
    const creation_bytes = Buffer.byteLength(
      JSON.stringify({
        expected_version: 8,
        model_id: frozen.model_id,
        manifest,
        min_held_out_cases: 4,
        floor: { numerator: 1, denominator: 1 },
      }),
    );
    assert.ok(creation_bytes <= 131072);
    transport.push({
      task_class: manifest.task_class,
      creation_bytes,
      max_input_chars: Math.max(
        ...manifest.cases.map((c) =>
          c.input.reduce((n, m) => n + m.text.length, 0),
        ),
      ),
    });
    manifests.push(manifest);
  }
  assert.equal(checks, 108);
  assert.deepEqual(
    manifests.map((m) => m.task_class),
    ['candidate_generation', 'scoring'],
  );
  assert.equal(
    new Set(manifests.flatMap((m) => m.cases.map((c) => c.case_id))).size,
    12,
  );
  // Historical evidence bytes stay immutable. Old source_bindings are historical
  // runtime identity, NOT a claim that schema-27 source matches this repair.
  for (const [path, hash] of Object.entries(frozen.prior_evidence))
    assert.equal(sha(await readFile(path)), hash, path);
  const runtime = await read(
    'tracking/evidence/availability-recheck-implementation/candidate-plan.json',
  );
  const packaged = await read(
    'tracking/evidence/availability-recheck-implementation/packaged-identity.json',
  );
  await verifyRuntimeBindings(runtime);
  if (!requirePlan)
    return {
      frozen,
      manifests,
      controls,
      runtime,
      packaged,
      checks,
      transport,
    };
  const plan = await read(FOLLOWUP_DIR + 'execution-plan.json');
  assertExecutionBinding(plan, frozen, runtime, packaged);
  await verifyRuntimeBindings(plan);
  return {
    frozen,
    manifests,
    controls,
    runtime,
    packaged,
    checks,
    transport,
    plan,
  };
}
