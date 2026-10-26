// Offline diagnostic controls only. Never edits frozen manifests or dispatches work.
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { BenchmarkManifestSchema } from '../packages/contracts/dist/index.js';
import { checkOutput, checkDiscoveryOutput } from '../packages/domain/dist/index.js';
const root = 'config/connections/benchmarks/discovery-synthetic-v3/';
const out = 'tracking/evidence/discovery-assertion-semantics/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const sha = (b) => createHash('sha256').update(b).digest('hex');
const controls = await read(root + 'author-controls.json');
const plan = await read('tracking/evidence/discovery-qualification-v3/execution-plan.json');
const bindings = { ...plan.source_sha256 };
for (const v of ['discovery-qualification-prep', 'discovery-qualification-v2', 'discovery-v2-transport-repair', 'discovery-qualification-v3']) {
  bindings[`tracking/evidence/${v}/run.lock`] = sha(await readFile(`tracking/evidence/${v}/run.lock`));
}
for (const f of ['freeze.json', 'raw-results.json', 'execution-outcome.json', 'failure-diagnostic.json', 'postrun-state.json']) {
  const p = 'tracking/evidence/discovery-qualification-v3/' + f;
  bindings[p] = sha(await readFile(p));
}
const verify = async () => {
  for (const [p, h] of Object.entries(bindings)) assert.equal(sha(await readFile(p)), h, p);
};
await verify();
const cases = [];
for (const k of ['research_synthesis', 'candidate_generation', 'scoring']) {
  const path = root + k + '.json';
  bindings[path] = sha(await readFile(path));
  cases.push(...BenchmarkManifestSchema.parse(await read(path)).cases);
}
const inventory = cases.map((c) => ({
  case_id: c.case_id, kind: c.check.task_kind, split: c.split,
  assertions: c.check.assertions.map((a) => ({ ...a, classification:
    a.path[0] === 'novelty' ? 'representation_specific_not_required_by_model_contract' :
    a.path[0] === 'perspective' || a.path[0] === 'response_to_findings' ? 'production_rule_also_checked_structurally' :
    a.path[0] === 'evidence_strength' ? 'case_specific_operational_rubric_label_not_entailment' :
    a.path[0] === 'software_warranted' || a.path[0] === 'recommendation' ? 'case_specific_decision_label_requires_reason_review' :
    'presence_or_reference_proxy_requires_substantive_review',
  })),
}));
const probes = [];
function probe(c, name, json, expected, limitation = null) {
  const production = checkDiscoveryOutput(c.check.task_kind, json, c.check.packet, c.check.context);
  const actual = checkOutput(c.check, { json, text: JSON.stringify(json) }, { succeeded: true, reason_code: 'ok' });
  assert.equal(actual, expected, `${c.case_id}: ${name}`);
  probes.push({ case_id: c.case_id, name, expected, actual, production_valid: production.ok, limitation });
}
for (const c of cases) {
  const ctrl = controls.find((x) => x.case_id === c.case_id);
  probe(c, 'frozen author gold', ctrl.gold, 'accepted');
  probe(c, 'frozen objective negative', ctrl.negative, 'acceptance_check_failed');
  probe(c, 'frozen false-narrative control', ctrl.manual_negative, 'accepted', 'Automated acceptance does not establish substantive truth.');
  if (['propose', 'revise'].includes(c.check.task_kind)) {
    const j = structuredClone(ctrl.gold);
    j.novelty = 'This is routine use of known methods; originality has not been established.';
    probe(c, 'synthetic no-originality prose alternative', j, 'acceptance_check_failed', 'Permitted representation fails exact-null grading; not a passing replacement grade.');
  }
  if (c.check.task_kind === 'locate') {
    const j = structuredClone(ctrl.gold);
    j.gaps = ['There are uncertainties.'];
    probe(c, 'consequential limitations removed', j, 'accepted', 'Nonempty gaps do not establish coverage or fidelity.');
  }
}
const revision = cases.find((c) => c.check.task_kind === 'revise');
const revised = structuredClone(controls.find((c) => c.case_id === revision.case_id).gold);
revised.response_to_findings = 'The proposal was reviewed and this is a complete response.';
probe(revision, 'nonempty text ignores two findings', revised, 'accepted', 'No per-finding coverage or agreement/disagreement entailment.');
const five = cases.find((c) => c.case_id === 'skeptic-dev-five-proposals');
const fiveGold = controls.find((c) => c.case_id === five.case_id).gold;
const swapped = structuredClone(fiveGold);
[swapped.reviews[0].findings, swapped.reviews[1].findings] = [swapped.reviews[1].findings, swapped.reviews[0].findings];
probe(five, 'duplicate finding moved from P2 to P1', swapped, 'accepted', 'Global wildcard checks lose proposal/finding association.');
const split = structuredClone(fiveGold);
split.reviews[1].findings[0].catalog_ref = null;
split.reviews[2].findings[0].catalog_ref = 'K1';
probe(five, 'catalog ref detached from duplicate finding', split, 'accepted', 'Separate existential checks do not bind type, catalog and proposal together.');
const permuted = structuredClone(fiveGold);
permuted.reviews.reverse();
probe(five, 'semantics-preserving review permutation', permuted, 'accepted');
const maintenance = cases.find((c) => c.case_id === 'skeptic-held-maintenance');
const testless = structuredClone(controls.find((c) => c.case_id === maintenance.case_id).gold);
testless.reviews[0].cheaper_test = 'Perform a test.';
probe(maintenance, 'nonempty but unspecified cheaper test', testless, 'accepted', 'Nonempty prose does not establish a bounded disconfirming test.');
const raw = await read('tracking/evidence/discovery-qualification-v3/raw-results.json');
const live = raw.at(-1);
const liveCase = cases.find((c) => c.case_id === live.case_id);
probe(liveCase, 'exact preserved live output diagnostic', JSON.parse(live.outcome.text), 'acceptance_check_failed');
await verify();
await mkdir(out, { recursive: true });
for (const [file, value] of Object.entries({
  'inventory.json': inventory,
  'probes.json': probes,
  'preserved-bindings.json': bindings,
  'result.json': {
    date_local: '2026-10-21', mode: 'offline_author_diagnostics_only',
    cases: cases.length, task_kinds: [...new Set(cases.map((c) => c.check.task_kind))],
    assertions: inventory.reduce((n, c) => n + c.assertions.length, 0),
    probes_executed: probes.length, expected_results_matched: probes.length,
    all_bindings_unchanged: true, new_provider_calls: 0, runtime_changes: false,
    historical_grades_changed: false,
    limitation: 'Synthetic mutations and author-visible controls diagnose scorer behavior, not independent model performance. Semantic judgments still require qualified independent review.',
  },
})) await writeFile(out + file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ cases: cases.length, assertions: inventory.reduce((n, c) => n + c.assertions.length, 0), probes_executed: probes.length, all_expected_results_matched: true, frozen_bindings_unchanged: true }));
