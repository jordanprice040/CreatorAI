// Offline diagnostic only. Never writes to v1 artifacts, production settings or model APIs.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import {
  canonicalHash,
  checkDiscoveryOutput,
  checkOutput,
  DISCOVERY_PROMPT_HASH,
} from '../packages/domain/dist/index.js';
const root = new URL('../', import.meta.url);
const read = async (p) => JSON.parse(await readFile(new URL(p, root), 'utf8'));
const base = 'tracking/evidence/discovery-qualification-prep/';
const freeze = await read(base + 'freeze.json');
const plan = await read(base + 'execution-plan.json');
assert.equal(
  canonicalHash(plan),
  'de5297fdbd86635a6301cf6a53147cebec4bcf467d77dabbfa56132dc16346b4',
);
assert.equal(DISCOVERY_PROMPT_HASH, freeze.prompt_hash);
for (const [p, h] of Object.entries(plan.source_sha256))
  assert.equal(
    createHash('sha256')
      .update(await readFile(new URL(p, root)))
      .digest('hex'),
    h,
    p,
  );
const strict = [];
for (const f of freeze.files) {
  const bytes = await readFile(new URL(f.path, root));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), f.sha256);
  const manifest = JSON.parse(bytes);
  assert.equal(canonicalHash(manifest), f.canonical_hash);
  for (const c of manifest.cases)
    for (const a of c.check.assertions)
      if (
        a.path.join('.') === 'evidence_strength' &&
        a.op === 'equals' &&
        a.value === 'well_supported'
      )
        strict.push(c.case_id);
}
assert.deepEqual(strict, ['dev-transfer', 'held-source-instruction']);
const manifest = await read(
  freeze.files.find((f) => f.path.includes('research_synthesis')).path,
);
const c = manifest.cases.find((c) => c.case_id === 'dev-transfer');
const raw = await read(base + 'raw-results.json');
assert.equal(raw.length, 1);
const output = JSON.parse(raw[0].outcome.text);
const contract = checkDiscoveryOutput(
  c.check.task_kind,
  output,
  c.check.packet,
  c.check.context,
);
assert.equal(contract.ok, true);
assert.equal(output.evidence_strength, 'exploratory');
assert.equal(
  checkOutput(
    c.check,
    { text: raw[0].outcome.text, json: output },
    { succeeded: true, reason_code: 'ok' },
  ),
  'acceptance_check_failed',
);
assert.ok(output.cross_field.claim_refs.includes('C3'));
assert.ok(output.cross_field.transferred_mechanism.trim());
const proposal = await read(
  'config/connections/benchmarks/discovery-synthetic-v2/proposal.json',
);
assert.equal(proposal.status, 'design_proposal_not_executable');
assert.equal(proposal.cases.length, 18);
assert.equal(new Set(proposal.cases.map((c) => c.id)).size, 18);
for (const task of ['research_synthesis', 'candidate_generation', 'scoring']) {
  const cases = proposal.cases.filter((c) => c.task_class === task);
  assert.equal(cases.filter((c) => c.split === 'development').length, 2);
  assert.equal(cases.filter((c) => c.split === 'held_out').length, 4);
  assert.ok(
    cases.every(
      (c) => c.prospective_checks.length >= 3 && c.scenario.length > 60,
    ),
  );
}
assert.ok(proposal.cases.some((c) => c.kind === 'revise'));
assert.ok(
  proposal.cases.every((c) => !c.scenario.toLowerCase().includes('archive')),
);
await mkdir(new URL('tracking/evidence/discovery-rubric-review/', root), {
  recursive: true,
});
const report = {
  at: new Date().toISOString(),
  state: 'offline_review_complete_v2_design_only',
  new_provider_calls: 0,
  original_plan_hash: canonicalHash(plan),
  original_manifest_bytes_unchanged: true,
  source_bindings_verified: Object.keys(plan.source_sha256).length,
  original_run_lock_preserved: !!(
    await readFile(new URL(base + 'run.lock', root), 'utf8')
  ).trim(),
  strict_confidence_cases: strict,
  production_contract_passed: contract.ok,
  original_frozen_signal: 'acceptance_check_failed',
  original_outcome_unchanged: true,
  diagnostic:
    'Label scope is ambiguous; review does not retroactively qualify the response.',
  proposal_hash: canonicalHash(proposal),
  proposed_cases: 18,
  live_execution_authorized: false,
};
await writeFile(
  new URL('tracking/evidence/discovery-rubric-review/result.json', root),
  JSON.stringify(report, null, 2) + '\n',
  { flag: 'wx' },
);
console.log(JSON.stringify(report));
