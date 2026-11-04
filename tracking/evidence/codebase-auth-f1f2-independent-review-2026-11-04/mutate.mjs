// Independent F1/F2 review: disable parts of the fix in the COMPILED store, run the new tests,
// restore the exact bytes and confirm the hash. Source files are never edited.
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const F = 'packages/db/dist/connection-store.js';
const orig = readFileSync(F);
const sha = (b) => createHash('sha256').update(b).digest('hex');
const origSha = sha(orig);
const cc = 'const currentCredential = sameLogin &&\n                r.credential_ref === conn.rows[0].credential_ref &&';
const M = {
  f1_all: [['const eligibility = !sameLogin', 'const eligibility = false'], ['const quota = !sameLogin', 'const quota = false'], ['if (sameLogin && (verified', 'if ((verified']],
  f1_quota_only: [['const quota = !sameLogin', 'const quota = false']],
  f1_eligibility_only: [['const eligibility = !sameLogin', 'const eligibility = false']],
  f1_model_access_only: [['if (sameLogin && (verified', 'if ((verified']],
  m1_state_only: [[cc, 'const currentCredential =']],
  m1_no_generation: [['const currentCredential = sameLogin &&', 'const currentCredential = true &&']],
  m1_unconditional: [['if (observed.sign_in_invalid && currentCredential)', 'if (observed.sign_in_invalid)']],
  f1_never: [['const sameLogin = r.auth_generation != null &&', 'const sameLogin = false && r.auth_generation != null &&']],
  f1_requires_same_ref: [['String(r.auth_generation) === String(conn.rows[0].auth_generation);', 'String(r.auth_generation) === String(conn.rows[0].auth_generation) && r.credential_ref === conn.rows[0].credential_ref;']],
  bind_noop: [['    async bindPlanRequestCredential(requestId, credentialRef) {\n', '    async bindPlanRequestCredential(requestId, credentialRef) {\n        return;\n']],
};
const only = process.argv[2];
const files = process.argv.slice(3);
const pattern = process.env.PATTERN;
const results = {};
try {
  for (const [name, edits] of Object.entries(M)) {
    if (only && only !== 'all' && only !== name) continue;
    let text = orig.toString('utf8');
    for (const [a, b] of edits) {
      const n = text.split(a).length - 1;
      if (n !== 1) throw new Error(`${name}: anchor found ${n} times: ${a}`);
      text = text.replace(a, b);
    }
    writeFileSync(F, text);
    const args = ['--test', '--test-concurrency=1', ...(pattern ? [`--test-name-pattern=${pattern}`] : []), ...files];
    const r = spawnSync(process.execPath, args, { encoding: 'utf8', maxBuffer: 1 << 28 });
    const out = r.stdout + r.stderr;
    writeFileSync(`.verification/auth-f1f2-review-2026-11-04/mutation-${name}.log`, out);
    const failed = [...out.matchAll(/^\s*not ok \d+ - (.+)$/gm)].map((m) => m[1]);
    const count = (k) => Number((out.match(new RegExp(`^# ${k} (\d+)`, 'm')) ?? [])[1]);
    results[name] = { exit: r.status, tests: count('tests'), pass: count('pass'), fail: count('fail'), failed };
    writeFileSync(F, orig);
  }
} finally {
  writeFileSync(F, orig);
  const restored = sha(readFileSync(F));
  results.restored = { sha256: restored, equals_original: restored === origSha };
}
console.log(JSON.stringify(results, null, 2));
