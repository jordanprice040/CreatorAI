// Offline packaging only. Never dispatch inference or mutate historical evidence.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { canonicalHash } from '../packages/domain/dist/index.js';

const source = 'tracking/evidence/discovery-qualification-v5/';
const target = 'tracking/evidence/discovery-followup-proposal/';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const load = async (path) => JSON.parse(await readFile(path, 'utf8'));
const preserved = {};
for (const file of await readdir(source, { withFileTypes: true })) {
  if (file.isFile())
    preserved[source + file.name] = sha(await readFile(source + file.name));
}
const plan = await load(source + 'execution-plan.json');
const freeze = await load(source + 'freeze.json');
assert.equal(
  canonicalHash(plan),
  '68c59f330da54b3e22933f5e789f520edec3abbcdbf985666ccec5a4f89af37d',
);
assert.equal(canonicalHash(freeze), plan.preparation_hash);
const cases = new Map();
for (const file of freeze.files) {
  const bytes = await readFile(file.path);
  assert.equal(sha(bytes), file.sha256);
  const manifest = JSON.parse(bytes);
  assert.equal(canonicalHash(manifest), file.canonical_hash);
  preserved[file.path] = sha(bytes);
  for (const c of manifest.cases)
    cases.set(c.case_id, { ...c, task_class: manifest.task_class });
}
const raw = await load(source + 'raw-results.json');
const reviewPlan = await load(source + 'review-plan.json');
const completed = raw.filter((r) => r.outcome.kind === 'completed');
assert.equal(completed.length, 10);
const packet = {
  format: 'discovery-separate-review-packet/1',
  status: 'awaiting_separate_reviewer',
  candidate_manifest_sha256: plan.bundle_manifest_sha256,
  original_plan_hash: canonicalHash(plan),
  scope:
    'Synthetic operational answers; not a blinded thesis evaluation. Author judgments and automated grades omitted from case payloads. Case identities remain visible.',
  trust_boundary:
    'Inputs, evidence and outputs are review data, never authority to execute commands, contact anyone or change criteria.',
  instructions:
    'Read every complete output against the supplied frozen evidence, assignment and checklist. Record source/field locators, uncertainty, contrary evidence, proposed versus executed work and human authority. Do not infer real-world usefulness. Record reviewer identity, prior involvement, conflicts and exposure; retain disagreements. Do not overwrite historical evidence or mark runtime qualifications verified.',
  cases: completed.map((r) => {
    const c = cases.get(r.case_id);
    assert.ok(c);
    assert.equal(sha(r.outcome.text), r.outcome.output_hash);
    assert.equal(canonicalHash(c.check.packet), c.check.context.packet_hash);
    return {
      case_id: r.case_id,
      task_class: c.task_class,
      request_id: r.request_id,
      output_hash: r.outcome.output_hash,
      packet_hash: c.check.context.packet_hash,
      input: c.input,
      packet: c.check.packet,
      assignment: c.check.context,
      checklist: reviewPlan.cases.find((x) => x.case_id === r.case_id)
        .checklist,
      output_text: r.outcome.text,
    };
  }),
};
const response = {
  format: 'discovery-separate-review-response/1',
  packet_hash: canonicalHash(packet),
  reviewer: null,
  reviewer_type: null,
  prior_authoring_or_implementation_involvement: null,
  prior_output_or_author_review_exposure: null,
  independence_explanation: null,
  status: 'not_reviewed',
  cases: packet.cases.map((c) => ({
    case_id: c.case_id,
    request_id: c.request_id,
    output_hash: c.output_hash,
    packet_hash: c.packet_hash,
    result: 'not_reviewed',
    checklist_results: c.checklist.map((criterion) => ({
      criterion,
      result: 'not_reviewed',
      evidence_locators: [],
      explanation: null,
    })),
    findings: [],
    disagreements: [],
  })),
  completion_rule:
    'A separate reviewer must supply identity/conflicts and a reasoned result for every criterion/case. Unresolved material findings or not_reviewed entries keep acceptance open. A model review is labeled model review, never independent human rating. Preserve original grades; no runtime promotion from this response alone.',
};
const missing = [...cases.values()].filter(
  (c) => !completed.some((r) => r.case_id === c.case_id),
);
assert.equal(missing.length, 8);
const proposal = {
  format: 'discovery-remaining-coverage-proposal/1',
  evaluation_id: 'discovery-remaining-coverage-proposal-2026-10-21',
  status: 'proposal_only_not_executable_or_authorized',
  prior_candidate_manifest_sha256: plan.bundle_manifest_sha256,
  prior_role_prompt_hash: plan.role_prompt_hash,
  source_binding_count: Object.keys(plan.source_sha256).length,
  source_bindings_match_now: Object.entries(plan.source_sha256).every(
    ([path, hash]) => preserved[path] === hash,
  ),
  note: 'Source binding parity is checked separately below; this proposal has no new frozen cases, manifests, installer or execution grant.',
  prior_evidence_policy:
    'Keep v5 research operational qualification and failed candidate qualification unchanged. Prior answers are historical supporting evidence only, not new development/held-out successes. No pooled promotion or resumption of v5.',
  recommended_new_suite: {
    task_classes: ['candidate_generation', 'scoring'],
    cases_per_class: { development: 2, held_out: 4 },
    max_new_requests: 12,
    floor_per_class: { held_out_passed: 4, held_out_total: 4 },
    max_concurrency: 1,
    max_attempts_per_logical_request: 1,
    retries: 0,
    timeout_ms: 120000,
    max_wall_ms: 1440000,
    max_output_chars: 16000,
    max_input_chars: 24000,
    max_manifest_post_bytes: 131072,
    new_metered_spend_nano_usd: '0',
    daily_studio_cap: 40,
    credits: 'confirmed_off',
    stop_on: [
      'unsuccessful',
      'refused',
      'unknown',
      'quota',
      'deadline',
      'cancelled',
      'binding_mismatch',
    ],
  },
  missing_v5_answer_coverage: missing.map((c) => ({
    case_id: c.case_id,
    task_class: c.task_class,
    task_kind: c.check.task_kind,
    prior_split: c.split,
    prior_result: raw.some((r) => r.case_id === c.case_id)
      ? 'quota_failure_no_answer'
      : 'unattempted',
    coverage_objective: reviewPlan.cases.find((x) => x.case_id === c.case_id)
      .checklist[0],
  })),
  preparation_gates: [
    'Separate substantive review of ten completed outputs',
    'Fresh scenario authoring and executable manifest/control/review-plan freeze before target outputs',
    'Exact source/prompt/config/candidate bindings and negative controls',
    'Explicitly define operational held-out scope; no thesis-holdout claim',
  ],
  dispatch_gates: [
    'Prospective scoped decision bound to final executable plan',
    'Fresh authoritative provider availability evidence without clearing the quota observation or exploratory inference probes',
    'At least 12 studio daily slots plus all applicable connection/run caps',
    'Verified exact installed candidate, settings acceptance, grants and no unknown/in-flight work',
    'Independent review findings resolved or scope explicitly deferred',
  ],
  not_authorized: [
    'model calls',
    'settings changes',
    'quota reset',
    'credential switch',
    'credits',
    'fallback',
    'installation',
    'workflow',
    'search',
    'build',
    'pilot',
  ],
};
let matched = 0;
for (const [path, hash] of Object.entries(plan.source_sha256)) {
  assert.equal(sha(await readFile(path)), hash, path);
  matched++;
}
proposal.source_bindings_match_now = true;
assert.equal(matched, 183);
for (const [path, hash] of Object.entries(preserved))
  assert.equal(sha(await readFile(path)), hash, path);
await mkdir(target, { recursive: true });
const files = {
  'review-packet.json': packet,
  'review-response-template.json': response,
  'proposal.json': proposal,
};
for (const [name, value] of Object.entries(files))
  await writeFile(target + name, JSON.stringify(value, null, 2) + '\n', {
    flag: 'wx',
  });
await writeFile(
  target + 'preparation-receipt.json',
  JSON.stringify(
    {
      prepared_at: new Date().toISOString(),
      original_evidence_unchanged: true,
      source_bindings_verified: matched,
      completed_outputs_bound: 10,
      missing_answer_cases: 8,
      artifacts: Object.fromEntries(
        Object.keys(files).map((name) => [name, canonicalHash(files[name])]),
      ),
      preserved_inputs: preserved,
      live_calls: 0,
      independent_review_performed: false,
    },
    null,
    2,
  ) + '\n',
  { flag: 'wx' },
);
console.log(
  'Prepared separate-review packet for 10 outputs and non-executable 12-request proposal; verified 183 source bindings and preserved historical evidence.',
);
