// Shared static gate. Reads local artifacts only; safe before credential lookup.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BenchmarkManifestSchema } from '../packages/contracts/dist/index.js';
import {
  canonicalHash,
  checkOutput,
  discoveryRoleInput,
  DISCOVERY_PROMPT_HASH,
  DISCOVERY_ROLE_VERSION,
} from '../packages/domain/dist/index.js';
import { FOLLOWUP_LIMITS } from './discovery-followup-core.mjs';

export const FOLLOWUP_DIR = 'tracking/evidence/discovery-followup-v1/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
export async function checkFollowup({ requirePlan = true } = {}) {
  const frozen = await read(FOLLOWUP_DIR + 'freeze.json');
  assert.equal(frozen.prompt_hash, DISCOVERY_PROMPT_HASH);
  assert.equal(frozen.role_version, DISCOVERY_ROLE_VERSION);
  assert.deepEqual(frozen.limits, FOLLOWUP_LIMITS);
  const controlsBytes = await readFile(frozen.controls_path);
  assert.equal(sha(controlsBytes), frozen.controls_sha256);
  const controls = JSON.parse(controlsBytes);
  assert.equal(
    sha(await readFile(FOLLOWUP_DIR + 'review-plan.json')),
    frozen.review_plan_sha256,
  );
  const manifests = [];
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
      const control = controls.find((x) => x.case_id === c.case_id);
      const rendered = discoveryRoleInput(
        c.check.task_kind,
        c.check.context,
        c.check.packet,
        control.inputs,
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
        control.inputs.map((i) => canonicalHash(i.output)),
      );
      assert.ok(
        c.input.reduce((n, m) => n + m.text.length, 0) <=
          FOLLOWUP_LIMITS.max_input_chars,
      );
      assert.equal(
        checkOutput(
          c.check,
          { text: JSON.stringify(control.gold), json: control.gold },
          { succeeded: true, reason_code: 'offline_control' },
        ),
        'accepted',
      );
    }
    assert.ok(
      Buffer.byteLength(
        JSON.stringify({
          expected_version: 8,
          model_id: frozen.model_id,
          manifest,
          min_held_out_cases: 4,
          floor: { numerator: 1, denominator: 1 },
        }),
      ) <= 131072,
    );
    manifests.push(manifest);
  }
  assert.deepEqual(
    manifests.map((m) => m.task_class),
    ['candidate_generation', 'scoring'],
  );
  assert.equal(
    new Set(manifests.flatMap((m) => m.cases.map((c) => c.case_id))).size,
    12,
  );
  for (const [path, hash] of Object.entries({
    ...frozen.source_bindings,
    ...frozen.prior_evidence,
  }))
    assert.equal(sha(await readFile(path)), hash, path);
  if (!requirePlan) return { frozen, manifests, controls };
  const plan = await read(FOLLOWUP_DIR + 'execution-plan.json');
  assert.equal(plan.preparation_hash, canonicalHash(frozen));
  assert.equal(plan.bundle_manifest_sha256, frozen.candidate_manifest_sha256);
  assert.deepEqual(plan.limits, FOLLOWUP_LIMITS);
  assert.equal(plan.required_schema, 27);
  assert.equal(
    plan.proposed_settings_hash,
    '5c3c7fcaf4a47d928e607c6677f54a70eece1e07c92b423e75f143d9a022e533',
  );
  for (const [path, hash] of Object.entries(plan.source_sha256))
    assert.equal(sha(await readFile(path)), hash, path);
  return { frozen, manifests, controls, plan };
}

export function checkSeparateReview(packet, response) {
  assert.equal(
    response.packet_hash,
    canonicalHash(packet),
    'Review must bind the exact v5 output packet.',
  );
  assert.equal(response.status, 'completed');
  assert.ok(
    typeof response.reviewer === 'string' &&
      response.reviewer.trim().length > 0,
  );
  assert.ok(['human', 'model'].includes(response.reviewer_type));
  assert.equal(
    response.prior_authoring_or_implementation_involvement,
    false,
    'Reviewer must be separate from authorship.',
  );
  assert.ok(
    typeof response.prior_output_or_author_review_exposure === 'string' &&
      response.prior_output_or_author_review_exposure.trim().length > 0,
  );
  assert.ok(
    typeof response.independence_explanation === 'string' &&
      response.independence_explanation.trim().length > 0,
  );
  assert.equal(response.cases.length, packet.cases.length);
  assert.equal(
    new Set(response.cases.map((c) => c.case_id)).size,
    packet.cases.length,
  );
  for (const expected of packet.cases) {
    const c = response.cases.find((r) => r.case_id === expected.case_id);
    assert.ok(c);
    for (const key of ['request_id', 'output_hash', 'packet_hash'])
      assert.equal(c[key], expected[key]);
    assert.equal(c.result, 'supported');
    assert.equal(c.checklist_results.length, expected.checklist.length);
    for (const [i, r] of c.checklist_results.entries()) {
      assert.equal(r.criterion, expected.checklist[i]);
      assert.equal(r.result, 'supported');
      assert.ok(
        typeof r.explanation === 'string' && r.explanation.trim().length > 0,
      );
      assert.ok(
        r.evidence_locators.length > 0 &&
          r.evidence_locators.every(
            (v) => typeof v === 'string' && v.trim().length > 0,
          ),
      );
    }
    assert.ok(Array.isArray(c.findings) && Array.isArray(c.disagreements));
    for (const finding of [...c.findings, ...c.disagreements]) {
      assert.equal(
        finding.resolved,
        true,
        'Unresolved findings require a separately reviewed plan, not a bypass.',
      );
      assert.ok(
        typeof finding.resolution === 'string' &&
          finding.resolution.trim().length > 0,
      );
    }
  }
}
