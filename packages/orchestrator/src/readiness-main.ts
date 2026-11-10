import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  evaluateReadiness,
  readinessMarkdown,
  type OwnerPilot,
  type Register,
} from './readiness.js';

// `pnpm readiness [--out report.md]` checks config/readiness.json and config/owner-pilot.json
// against context/REQUIREMENTS.md and the evidence on disk. Exit 0 = ready, 3 = not ready
// (honest, expected today), 2 = the register itself is inconsistent.
// `pnpm readiness pilot-check` checks only the owner pilot's gate: its plan while it has not finished,
// and its evidence once it is completed.
const root = resolve(fileURLToPath(new URL('../../../', import.meta.url)));
const args = process.argv.slice(2);
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const registerBytes = read('config/readiness.json');
const register = JSON.parse(registerBytes) as Register;
const pilot = JSON.parse(read('config/owner-pilot.json')) as OwnerPilot;
const result = evaluateReadiness(
  register,
  pilot,
  read('context/REQUIREMENTS.md'),
  (p) => existsSync(join(root, p)),
  registerBytes,
);
if (args[0] === 'pilot-check') {
  console.log(JSON.stringify(result.pilot, null, 2));
  process.exit(result.pilot.ready ? 0 : 3);
}
let commit = 'unknown';
try {
  commit = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  const dirty = execFileSync('git', ['status', '--porcelain'], {
    cwd: root,
    encoding: 'utf8',
    windowsHide: true,
  }).trim();
  if (dirty) commit += ' (working tree has uncommitted changes)';
} catch {
  // An extracted archive has no Git metadata; the report says so.
}
const out = args.indexOf('--out');
if (out !== -1) {
  const path = args[out + 1];
  if (!path) throw new Error('--out needs a file path');
  writeFileSync(resolve(path), readinessMarkdown(result, register, commit));
}
console.log(
  JSON.stringify(
    {
      verdict: result.verdict,
      commit,
      register_sha256: result.register_sha256,
      problems: result.problems,
      not_ready: [...result.requirements, ...result.integrations]
        .filter((r) => !r.ready)
        .map((r) => `${r.id}: ${r.missing.join(', ')}`),
      pilot: result.pilot,
    },
    null,
    2,
  ),
);
process.exit(result.problems.length ? 2 : result.verdict === 'ready' ? 0 : 3);
