// Independent v4 review: verify receipt hash maps, prior-version preservation, bindings and
// historical source-bound run receipts. Read-only; imports no helper code.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
const ROOT = process.argv[2];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hash = async (p) => sha(await readFile(join(ROOT, p)));
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const dir = 'tracking/evidence/theme-intent-upgrade-helper-v4-2026-10-24/';
const r = await read(dir + 'repair-receipt.json');
const out = { checked_at: new Date().toISOString(), node: process.version, mismatches: [] };
async function check(label, map) {
  let n = 0;
  for (const [p, h] of Object.entries(map)) {
    n++;
    let a;
    try {
      a = await hash(p);
    } catch (e) {
      a = 'ERR ' + e.code;
    }
    if (a !== h) out.mismatches.push({ label, path: p, expected: h, actual: a });
  }
  out[label] = n;
}
await check('v4_helper_sha256', r.helper_sha256);
await check('v4_artifact_sha256', r.artifact_sha256);
const v3 = await read('tracking/evidence/theme-intent-upgrade-helper-v3-2026-10-23/repair-receipt.json');
await check('v3_artifact_sha256', v3.artifact_sha256);
await check('v3_helper_sha256', v3.helper_sha256);
const v3review = await read('tracking/evidence/theme-intent-upgrade-helper-v3-review-2026-10-24/reviewer-receipt.json');
await check('v3_review_artifact_sha256', v3review.artifact_sha256);
const v2 = await read('tracking/evidence/theme-intent-upgrade-helper-v2-2026-10-23/repair-receipt.json');
await check('v2_artifact_sha256', v2.artifact_sha256);
await check('v2_helper_sha256', v2.helper_sha256);
out.helper_subset_of_artifacts = Object.entries(r.helper_sha256).every(([p, h]) => r.artifact_sha256[p] === h);
// v4 runtime bindings differ from v3 only in the versioned helper files; the pg closure is shared.
out.v4_vs_v3_binding_differences = Object.keys(r.helper_sha256)
  .filter((p) => !p.startsWith('scripts/'))
  .filter((p) => v3.helper_sha256[p] !== r.helper_sha256[p]);
const live = JSON.parse(
  execFileSync(process.execPath, [join(ROOT, 'scripts/theme-intent-upgrade-v4.mjs'), '--bindings'], { cwd: ROOT }).toString(),
);
out.bindings_count = Object.keys(live).length;
out.bindings_equal_receipt =
  JSON.stringify(Object.entries(live).sort()) === JSON.stringify(Object.entries(r.helper_sha256).sort());
out.bindings_key_order_equal = JSON.stringify(live) === JSON.stringify(r.helper_sha256);
out.runs = {};
for (const label of ['first', 'verified']) {
  const before = await read(dir + `${label}-sources-before.json`);
  for (const kind of ['guards', 'e2e']) {
    const run = await read(dir + `${label}-${kind}-run.json`);
    const tap = await readFile(join(ROOT, dir + `${label}-${kind}.tap`), 'utf8');
    const count = (k) => Number((tap.match(new RegExp('# ' + k + ' ([0-9]+)')) || [])[1]);
    const srcMismatch = [];
    for (const [p, h] of Object.entries(run.source_sha256)) if ((await hash(p)) !== h) srcMismatch.push(p);
    out.runs[label + '_' + kind] = {
      format: run.format,
      exit_code: run.exit_code,
      timed_out: run.timed_out,
      sources_unchanged: run.sources_unchanged,
      tap_sha256_matches: sha(tap) === run.tap_sha256,
      tap_sha256: run.tap_sha256,
      tests: count('tests'),
      pass: count('pass'),
      fail: count('fail'),
      skipped: count('skipped'),
      todo: count('todo'),
      cancelled: count('cancelled'),
      not_ok_lines: (tap.match(/^\s*not ok/gm) || []).length,
      ok_lines: (tap.match(/^\s*ok \d+/gm) || []).length,
      source_entries: Object.keys(run.source_sha256).length,
      source_mismatches_now: srcMismatch,
      helper_entries_not_matching_run: Object.entries(r.helper_sha256)
        .filter(([p, h]) => run.source_sha256[p] !== h)
        .map(([p]) => p),
      source_equals_sources_before: JSON.stringify(run.source_sha256) === JSON.stringify(before.source_sha256),
      started_at: before.started_at,
      ended_at: run.ended_at,
    };
  }
}
// What changed between the first and the verified bound run (claim: only test setup).
const f = (await read(dir + 'first-e2e-run.json')).source_sha256;
const v = (await read(dir + 'verified-e2e-run.json')).source_sha256;
out.first_to_verified_changed_sources = [...new Set([...Object.keys(f), ...Object.keys(v)])].filter((p) => f[p] !== v[p]);
out.total_v4_receipt_hashes = out.v4_helper_sha256 + out.v4_artifact_sha256;
console.log(JSON.stringify(out, null, 2));
