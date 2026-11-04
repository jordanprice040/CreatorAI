// Local receipt assembly only. Does not execute tests or change prior receipts.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync, readdirSync } from 'node:fs';

const dir = 'tracking/evidence/codebase-auth-followup-2026-11-04';
const run = '.verification/auth-followup-2026-11-04';
const read = (p) => readFileSync(p, 'utf8');
const json = (p) => JSON.parse(read(p));
const hash = (p) => ({
  bytes: statSync(p).size,
  sha256: createHash('sha256').update(readFileSync(p)).digest('hex'),
});
const write = (p, value) =>
  writeFileSync(p, JSON.stringify(value, null, 2) + '\n');
const summary = (file) => {
  const log = read(file);
  const result = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped']) {
    const matches = [
      ...log.matchAll(new RegExp(`^# ${key} (\\d+)\\r?$`, 'gm')),
    ];
    assert.equal(matches.length, 1, `${file}: missing/ambiguous ${key}`);
    result[key] = Number(matches[0][1]);
  }
  assert.equal(result.fail, 0);
  assert.equal(result.cancelled, 0);
  return result;
};

const old = json('tracking/evidence/codebase-repairs-2026-11-04/receipt.json');
const followupPaths = new Set([
  'packages/broker/src/plan-service.ts',
  'packages/db/src/connection-store.ts',
  'tests/src/plan-connections.test.ts',
  'tests/src/claude-code.test.ts',
  'docs/CURRENT_STATUS.md',
  'tracking/BUILD_STATUS.md',
  'tracking/SESSION_HANDOFF.md',
  'tracking/DECISIONS.md',
  'tracking/INTEGRATIONS.md',
]);
const preserved = {};
for (const [p, expected] of Object.entries(old.file_hashes)) {
  if (followupPaths.has(p)) continue;
  assert.deepEqual(
    hash(p),
    expected,
    `Earlier artifact unexpectedly changed: ${p}`,
  );
  preserved[p] = expected;
}
for (const entry of json(
  'tracking/evidence/codebase-repairs-2026-11-04/document-archives.json',
).files) {
  assert.deepEqual(hash(entry.archive), {
    bytes: entry.bytes,
    sha256: entry.sha256,
  });
}
for (const [p, expected] of Object.entries(
  old.frozen_upgrade_sources_unchanged,
)) {
  assert.equal(hash(p).sha256, expected, `Frozen source changed: ${p}`);
}
// This report is also an exact copy of the user-supplied independent review.
assert.deepEqual(
  hash('docs/CODEBASE_REPAIRS_INDEPENDENT_REVIEW_2026-11-04.md'),
  hash(
    'C:/Users/jorda/Downloads/CODEBASE_REPAIRS_INDEPENDENT_REVIEW_2026-11-04.md',
  ),
);

const races = read(`${run}/reviewer-races-after.log`)
  .trim()
  .split(/\r?\n/)
  .map(JSON.parse);
assert.equal(races.length, 6);
assert.ok(races.every((r) => r.fixture_only && !r.harness_error));
assert.equal(races[0].state, 'signed_out');
assert.equal(races[1].after_late_result, 'signed_out');
assert.equal(races[2].after_late_result, 'signed_in');
assert.equal(races[1].after_version, races[1].before_version);
assert.equal(races[2].after_version, races[2].before_version);
assert.equal(races[3].attempt.state, 'completed');
assert.equal(races[4].attempt.state, 'completed');
assert.deepEqual(races[5].results, ['token', 'token']);
assert.equal(races[5].refresh_requests, 1);

const browserPath =
  'tracking/evidence/codebase-repairs-independent-review-2026-11-04/browser.json';
const browser = json(browserPath);
const assets = readdirSync('apps/web/dist/assets');
const main = browser.assets_initial.find((s) => s.startsWith('index-'));
const models = browser.models_loaded_on_navigation;
assert.ok(assets.includes(main) && assets.includes(models));
const buildLog = read(`${run}/web-build.log`);
assert.ok(buildLog.includes(main) && buildLog.includes(models));
const bundle = json('apps/desktop/.bundle/studio/bundle-manifest.json');
for (const asset of [main, models]) {
  const entry = bundle.files.find((f) => f.path === `web/assets/${asset}`);
  assert.ok(entry);
  assert.deepEqual(hash(`apps/web/dist/assets/${asset}`), {
    bytes: entry.bytes,
    sha256: entry.sha256,
  });
}
write(`${dir}/browser-binding-correction.json`, {
  finding: 'L2',
  original_browser_receipt_preserved: true,
  correction:
    'Original repair browser walk used earlier asset IDs. Use the independent reviewer browser walk for the final reviewed UI; fresh follow-up build matches those IDs.',
  independent_browser_receipt: { path: browserPath, ...hash(browserPath) },
  assets: Object.fromEntries(
    [main, models].map((p) => [p, hash(`apps/web/dist/assets/${p}`)]),
  ),
  fresh_build_log: {
    path: `${run}/web-build.log`,
    ...hash(`${run}/web-build.log`),
  },
  new_browser_walk_executed: false,
  ui_changed_in_followup: false,
  reviewed_bundle_asset_hashes_match: true,
  scope:
    'Independent UI evidence only. Follow-up server changes have separate synthetic contract checks and await independent review.',
});

const list = (args) =>
  execFileSync('git', args, { encoding: 'utf8' })
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
const candidatePaths = [
  ...new Set([
    ...list(['diff', '--name-only', '--diff-filter=ACMRT']),
    ...list(['ls-files', '--others', '--exclude-standard']),
  ]),
]
  .filter((p) => p !== '.codex/config.toml' && p !== `${dir}/receipt.json`)
  .sort();
const logNames = [
  'regressions-before.log',
  'regressions-after.log',
  'reviewer-races-after.log',
  'full-tests.log',
  'safety.log',
  'tsc-final.log',
  'web-typecheck.log',
  'web-build.log',
  'format-final.log',
  'diff-check.log',
  'cleanup.log',
];
const fileHashes = Object.fromEntries(
  [
    ...new Set([
      ...candidatePaths,
      ...logNames.map((p) => `${run}/${p}`),
      'packages/db/dist/connection-store.js',
      'packages/db/dist/migrations.js',
      'packages/broker/dist/plan-service.js',
      'tests/dist/plan-connections.test.js',
      'tests/dist/storage.test.js',
      'tests/dist/claude-code.test.js',
    ]),
  ].map((p) => [p, hash(p)]),
);
write(`${dir}/receipt.json`, {
  schema: 'creator-codebase-auth-followup/1',
  recorded_at: new Date().toISOString(),
  baseline_commit: execFileSync('git', ['rev-parse', 'HEAD'], {
    encoding: 'utf8',
  }).trim(),
  candidate:
    'Uncommitted working tree; hashes exclude this receipt and preserved user config',
  migration: 41,
  findings: {
    M1: 'repaired in source',
    L1: 'repaired in source',
    L2: 'additive evidence correction',
    L3: 'current open-items list restored',
  },
  checks: {
    full_database_suite: summary(`${run}/full-tests.log`),
    current_safety_suite: summary(`${run}/safety.log`),
    initial_red_regressions:
      '7 failures reproduced before implementation; diagnostic log retained',
    focused_regressions: summary(`${run}/regressions-after.log`),
    unchanged_reviewer_reproducer: '6 scenarios asserted',
    typescript_build: 'exit 0',
    web_typecheck: 'exit 0',
    web_build: 'exit 0; large-chunk warning retained',
    format_check: 'exit 0',
    git_diff_check: 'exit 0',
    verification_environment:
      'Node 22.23.4; disposable PostgreSQL 18.6 on loopback port 55449; fake providers only',
  },
  prior_repair_artifacts_reconciled: Object.keys(preserved).length,
  prior_unchanged_hashes: preserved,
  prior_receipt: hash(
    'tracking/evidence/codebase-repairs-2026-11-04/receipt.json',
  ),
  file_hashes: fileHashes,
  boundaries: {
    independent_followup_review: 'pending',
    full_product_acceptance: 'partial',
    live_provider_calls: false,
    installed_app_changed: false,
    operational_database_changed: false,
    staged_bundle:
      'unchanged historical schema-40 artifact; not a schema-41 release',
    original_audit_repair_review_evidence:
      'preserved; prior receipt intentionally binds earlier source bytes',
    old_open_items: ['#77 L-1', '#90 N-4', '#128 N-6', '#129 N-4'],
    source_detail_missing_for: ['#77 L-1', '#128 N-6'],
    user_config: {
      path: '.codex/config.toml',
      ...hash('.codex/config.toml'),
      status: 'pre-existing user change preserved',
    },
  },
  resource_cleanup: read(`${run}/cleanup.log`).trim(),
  next_eligible_prompt:
    'U02 independent review of the exact follow-up candidate; no automatic milestone or activation',
});
console.log(
  JSON.stringify({
    checks: json(`${dir}/receipt.json`).checks,
    prior_artifacts_reconciled: Object.keys(preserved).length,
    bound_files: Object.keys(fileHashes).length,
  }),
);
