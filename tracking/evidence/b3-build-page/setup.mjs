// Puts the frozen repair benchmark's spec into the seeded spec and freezes it (approving the
// freeze once), through the CLI against the throwaway studio. Usage: node setup.mjs [spec.json title]
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const cli = (...a) =>
  JSON.parse(
    execFileSync(process.execPath, ['apps/cli/dist/main.js', ...a], {
      env: process.env,
    }).toString(),
  );
cli('login', process.env.CREATOR_DEV_LOGIN_CODE);
// A second run reuses the first seed (B3_WS, B3_SPEC, B3_RUN) instead of seeding again.
const seed = process.env.B3_WS
  ? {
      workspace: { id: process.env.B3_WS },
      spec: { id: process.env.B3_SPEC },
      run: process.env.B3_RUN,
    }
  : cli('seed-selection');
const ws = seed.workspace.id,
  specId = seed.spec.id;
const content = JSON.parse(
  readFileSync(
    process.argv[2] ??
      'config/repo-benchmarks/repair-v1/p14-repair-v1/spec.json',
    'utf8',
  ),
).content;
const before = cli('spec', ws, specId);
const revised = cli(
  'spec-revise',
  ws,
  specId,
  JSON.stringify({
    expected_version: before.spec.version,
    title: process.argv[3] ?? 'Score sheet CLI',
    content,
    reason: 'B3 walk: repair benchmark spec',
  }),
);
const body = JSON.stringify({
  spec: { id: specId, version: revised.spec.version },
  justification: 'Synthetic exact freeze',
  data_class: 'synthetic',
});
const f = cli('spec-freeze', ws, seed.run, body);
if (f.status === 'needs_human') {
  const d = cli('decision', ws, f.admission.decision_id);
  cli(
    'answer',
    ws,
    d.id,
    d.coverage.coverage_hash,
    'approve_once',
    'Walk freeze',
  );
  cli('spec-freeze', ws, seed.run, body);
}
console.log(JSON.stringify({ ws, specId, run: seed.run }));
