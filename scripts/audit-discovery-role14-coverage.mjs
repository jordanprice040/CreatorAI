// Offline evidence coverage audit. Executes the exact compiled discovery filter only.
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import vm from 'node:vm';
import { BenchmarkCheckSchema } from '../packages/contracts/dist/index.js';
import {
  canonicalHash,
  discoveryRoleInput,
  DISCOVERY_ROLE_VERSION,
  DISCOVERY_PROMPT_HASH,
} from '../packages/domain/dist/index.js';
const dir = 'tracking/evidence/discovery-role14-coverage-audit/';
const read = async (p) => JSON.parse(await readFile(p, 'utf8'));
const hash = async (p) =>
  createHash('sha256')
    .update(await readFile(p))
    .digest('hex');
const compiledPath = 'packages/db/dist/connection-store.js',
  source = await readFile(compiledPath, 'utf8');
const begin = source.indexOf(
  '.filter((r) =>',
  source.indexOf('async #discoveryQualifications('),
);
const end = source.indexOf('.map((r) => toQualification(r))', begin);
assert.ok(begin > 0 && end > begin);
const fragment = source.slice(begin, end).trim();
const filter = (rows) =>
  vm.runInNewContext(
    'rows' + fragment,
    {
      rows,
      canonicalHash,
      BenchmarkCheckSchema,
      DISCOVERY_ROLE_VERSION,
      discoveryRoleInput,
    },
    { timeout: 1000 },
  );
const oldManifest = await read(
    'config/connections/benchmarks/discovery-synthetic-v5/research_synthesis.json',
  ),
  oldDecisions = await read(
    'tracking/evidence/discovery-qualification-v5/decisions.json',
  ),
  oldResults = await read(
    'tracking/evidence/discovery-qualification-v5/raw-results.json',
  ),
  oldReview = await read(
    'tracking/evidence/discovery-separate-review-2026-10-22/v5-review-response.json',
  );
const live = await read(
    'tracking/evidence/discovery-semantics-v2-runner/execution-outcome.json',
  ),
  newReview = await read(
    'tracking/evidence/discovery-semantics-v2-output-review-2026-10-22/review-response.json',
  );
const rows = [
  { ...oldDecisions[0], manifest: oldManifest },
  ...(await Promise.all(
    live.decisions.map(async (q) => ({
      ...q,
      manifest: await read(
        `config/connections/benchmarks/discovery-semantics-v2/${q.task_class}.json`,
      ),
    })),
  )),
];
assert.equal(canonicalHash(oldManifest), rows[0].manifest_hash);
const classifications = [];
for (const row of rows) {
  const current = filter([row]).length === 1;
  const results =
    row.task_class === 'research_synthesis'
      ? oldResults.filter((r) => r.task_class === 'research_synthesis')
      : live.results.filter((r) => r.task_class === row.task_class);
  const review =
    row.task_class === 'research_synthesis' ? oldReview : newReview;
  for (const r of results) {
    assert.equal(
      createHash('sha256').update(r.outcome.text).digest('hex'),
      r.outcome.output_hash,
    );
    assert.ok(
      review.cases.some(
        (c) =>
          c.case_id === r.case_id &&
          c.request_id === r.request_id &&
          c.output_hash === r.outcome.output_hash,
      ),
    );
  }
  const comparisons = row.manifest.cases.map((c) => {
    const expected = discoveryRoleInput(
      c.check.task_kind,
      { ...c.check.context, role_version: DISCOVERY_ROLE_VERSION },
      c.check.packet,
      [],
    )[0].text;
    const historical = c.input
      .filter((m) => m.role === 'system')
      .map((m) => m.text)
      .join('\n\n');
    return {
      case_id: c.case_id,
      saved_role_version: c.check.context.role_version,
      exact_current_system: historical === expected,
      equal_after_version_marker_only:
        historical.replaceAll('r02-discovery/1.3', 'r02-discovery/1.4') ===
        expected,
    };
  });
  classifications.push({
    task_class: row.task_class,
    qualification_id: row.id,
    saved_state: row.state,
    development: row.development,
    held_out: row.held_out,
    manifest_hash: row.manifest_hash,
    eligible_under_exact_current_compiled_filter: current,
    reviewed_outputs: results.length,
    review_scope:
      'separate_nonblinded_model_review_of_author_visible_synthetic_outputs',
    comparisons,
  });
}
assert.equal(
  classifications[0].eligible_under_exact_current_compiled_filter,
  false,
);
assert.ok(
  classifications
    .slice(1)
    .every((r) => r.eligible_under_exact_current_compiled_filter),
);
let negativeChecks = 0;
for (const change of [
  (r) => (r.manifest.cases[0].check.context.role_version = 'r02-discovery/1.3'),
  (r) => (r.manifest.cases[0].input[0].text = 'obsolete unrelated prompt'),
  (r) => (r.manifest.cases[0].check.context.packet_hash = '0'.repeat(64)),
]) {
  const row = structuredClone(rows[1]);
  change(row);
  row.manifest_hash = canonicalHash(row.manifest);
  assert.equal(filter([row]).length, 0);
  negativeChecks++;
}
const missingRevision = structuredClone(rows[1]);
missingRevision.manifest.cases = missingRevision.manifest.cases.filter(
  (c) => c.check.task_kind !== 'revise',
);
missingRevision.manifest_hash = canonicalHash(missingRevision.manifest);
assert.equal(filter([missingRevision]).length, 0);
negativeChecks++;
const paths = [
  compiledPath,
  'packages/db/src/connection-store.ts',
  'packages/domain/src/plan-admission.ts',
  'packages/domain/src/discovery.ts',
  'packages/domain/dist/discovery.js',
  'context/REQUIREMENTS.md',
  'scripts/audit-discovery-role14-coverage.mjs',
  'config/connections/benchmarks/discovery-synthetic-v5/research_synthesis.json',
  'tracking/evidence/discovery-qualification-v5/decisions.json',
  'tracking/evidence/discovery-qualification-v5/raw-results.json',
  'tracking/evidence/discovery-separate-review-2026-10-22/v5-review-response.json',
  'tracking/evidence/discovery-semantics-v2-runner/live-result.json',
  'tracking/evidence/discovery-semantics-v2-output-review-2026-10-22/review-response.json',
  'tests/src/subscription-workflow.test.ts',
];
const result = {
  format: 'discovery-role14-evidence-coverage/1',
  audited_at: new Date().toISOString(),
  mode: 'offline_exact_compiled_filter_replay_no_database',
  role_version: DISCOVERY_ROLE_VERSION,
  prompt_hash: DISCOVERY_PROMPT_HASH,
  filter_source: compiledPath,
  filter_sha256: createHash('sha256').update(fragment).digest('hex'),
  coverage: classifications,
  current_qualified_classes: 2,
  required_discovery_classes: 3,
  all_three_eligible: false,
  negative_controls_passed: negativeChecks,
  production_gate_bypass_found: false,
  production_repair_required: false,
  remaining_qualification:
    'Fresh research_synthesis locator evidence under exact current role/system/candidate binding',
  remaining_product_acceptance: [
    'Real-workspace theme with no existing claims reaches cited comparison through current qualified routes',
    'Evidence collection/search/data-sharing authority and effective limits',
    'Supported build/export/revision and owner acceptance through in-app flow',
  ],
  provider_calls: 0,
  workflow_started: false,
  old_results_changed: false,
  artifact_sha256: Object.fromEntries(
    await Promise.all(paths.map(async (p) => [p, await hash(p)])),
  ),
};
await mkdir(dir, { recursive: true });
await writeFile(dir + 'coverage.json', JSON.stringify(result, null, 2) + '\n', {
  flag: 'wx',
});
await writeFile(dir + 'compiled-filter.js', fragment + '\n', { flag: 'wx' });
console.log(
  JSON.stringify({
    current_classes: classifications.map((c) => ({
      task_class: c.task_class,
      eligible: c.eligible_under_exact_current_compiled_filter,
      outputs: c.reviewed_outputs,
    })),
    negative_controls: negativeChecks,
    provider_calls: 0,
  }),
);
