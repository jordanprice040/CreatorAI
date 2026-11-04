// Independent F1/F2 review: reconcile the repair receipt and the follow-up receipt with current bytes.
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
const h = (p) => { if (!existsSync(p)) return null; const b = readFileSync(p); return { bytes: b.length, sha256: createHash('sha256').update(b).digest('hex') }; };
const check = (label, map) => {
  let ok = 0; const bad = [];
  for (const [p, want] of Object.entries(map)) { const got = h(p); if (got && got.sha256 === want.sha256 && got.bytes === want.bytes) ok++; else bad.push(p); }
  console.log(`${label}: ${ok}/${Object.keys(map).length} match${bad.length ? '; differ: ' + bad.join(', ') : ''}`);
  return bad;
};
const rp = 'tracking/evidence/codebase-auth-f1f2-repairs-2026-11-04/receipt.json';
const r = JSON.parse(readFileSync(rp, 'utf8'));
console.log('f1f2 receipt', h(rp));
check('f1f2 file_hashes', r.file_hashes);
check('f1f2 log_hashes', r.log_hashes);
const f = JSON.parse(readFileSync('tracking/evidence/codebase-auth-followup-2026-11-04/receipt.json', 'utf8'));
const bad = [...check('followup file_hashes', f.file_hashes), ...check('followup prior_unchanged_hashes', f.prior_unchanged_hashes ?? {})];
const listed = new Set(Object.keys(r.file_hashes));
console.log('followup entries changed but NOT in f1f2 receipt:', bad.filter((p) => !listed.has(p)));
