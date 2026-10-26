// Independent v3 review: verify receipt hash maps, bindings and source-bound run receipts. Read-only.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
const ROOT = process.argv[2];
const sha = (b) => createHash('sha256').update(b).digest('hex');
const hash = async (p) => sha(await readFile(join(ROOT, p)));
const read = async (p) => JSON.parse(await readFile(join(ROOT, p), 'utf8'));
const dir = 'tracking/evidence/theme-intent-upgrade-helper-v3-2026-10-23/';
const r = await read(dir + 'repair-receipt.json');
const out = { checked_at: new Date().toISOString(), mismatches: [] };
async function check(label, map) {
  let n = 0;
  for (const [p, h] of Object.entries(map)) {
    n++;
    let a;
    try { a = await hash(p); } catch (e) { a = 'ERR ' + e.code; }
    if (a !== h) out.mismatches.push({ label, path: p, expected: h, actual: a });
  }
  out[label] = n;
}
await check('helper_sha256', r.helper_sha256);
await check('artifact_sha256', r.artifact_sha256);
const v2 = await read('tracking/evidence/theme-intent-upgrade-helper-v2-2026-10-23/repair-receipt.json');
await check('v2_artifact_sha256', v2.artifact_sha256);
await check('v2_helper_sha256', v2.helper_sha256);
// helper map is a subset of artifact map with equal values
out.helper_subset_of_artifacts = Object.entries(r.helper_sha256).every(([p, h]) => r.artifact_sha256[p] === h);
// bindings() re-emitted by the exact CLI
const { execFileSync } = await import('node:child_process');
const live = JSON.parse(execFileSync(process.execPath, [join(ROOT, 'scripts/theme-intent-upgrade-v3.mjs'), '--bindings'], { cwd: ROOT }).toString());
out.bindings_count = Object.keys(live).length;
out.bindings_equal_receipt = JSON.stringify(Object.entries(live).sort()) === JSON.stringify(Object.entries(r.helper_sha256).sort());
out.bindings_key_order_equal = JSON.stringify(live) === JSON.stringify(r.helper_sha256);
// source-bound runs
const before = await read(dir + 'first-sources-before.json');
out.runs = {};
for (const kind of ['guards', 'e2e']) {
  const run = await read(dir + `first-${kind}-run.json`);
  const tap = await readFile(join(ROOT, dir + `first-${kind}.tap`), 'utf8');
  const count = (k) => Number((tap.match(new RegExp('# ' + k + ' ([0-9]+)')) || [])[1]);
  const srcMismatch = [];
  for (const [p, h] of Object.entries(run.source_sha256)) if ((await hash(p)) !== h) srcMismatch.push(p);
  const helperNotInRun = Object.entries(r.helper_sha256).filter(([p, h]) => run.source_sha256[p] !== h).map(([p]) => p);
  out.runs[kind] = {
    format: run.format, exit_code: run.exit_code, timed_out: run.timed_out, sources_unchanged: run.sources_unchanged,
    tap_sha256_matches: sha(tap) === run.tap_sha256, tap_bytes_sha256: sha(tap),
    tests: count('tests'), pass: count('pass'), fail: count('fail'), skipped: count('skipped'), todo: count('todo'), cancelled: count('cancelled'),
    not_ok_lines: (tap.match(/^\s*not ok/gm) || []).length,
    ok_lines: (tap.match(/^\s*ok \d+/gm) || []).length,
    source_entries: Object.keys(run.source_sha256).length,
    source_mismatches_now: srcMismatch, helper_entries_not_matching_run: helperNotInRun,
    source_equals_sources_before: JSON.stringify(run.source_sha256) === JSON.stringify(before.source_sha256),
    ended_at: run.ended_at,
  };
}
out.sources_before_started_at = before.started_at;
out.total_receipt_hashes = out.helper_sha256 + out.artifact_sha256;
console.log(JSON.stringify(out, null, 2));
