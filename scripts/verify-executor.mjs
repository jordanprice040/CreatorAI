import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { FIXTURE_SPEC } from '../packages/domain/dist/index.js';
// Synthetic owner CLI -> authenticated API -> frozen spec -> real WSL worker.
const dir = '.verification/t11-cli';
mkdirSync(dir, { recursive: true });
mkdirSync('tracking/evidence/t11', { recursive: true });
const env = { ...process.env, CREATOR_SESSION_FILE: `${dir}/session.json` };
if (!env.CREATOR_API_URL || !env.CREATOR_DEV_LOGIN_CODE)
  throw new Error('Set the disposable fixture API origin and login code');
const cli = (...args) => {
  let output;
  try {
    output = execFileSync(
      process.execPath,
      ['apps/cli/dist/main.js', ...args],
      { env, encoding: 'utf8', timeout: 90000 },
    );
  } catch (error) {
    throw new Error(error.stdout || error.message);
  }
  if (args[0] === 'product-build')
    return JSON.parse(output.slice(output.indexOf('\n') + 1));
  return JSON.parse(output);
};
const file = (name, value) => {
  const path = `${dir}/${name}.json`;
  writeFileSync(path, JSON.stringify(value));
  return path;
};
cli('login', env.CREATOR_DEV_LOGIN_CODE);
const seed = cli('seed-selection');
const workspace = seed.workspace.id;
const specId = seed.spec.id;
const status = cli('spec', workspace, specId);
assert.equal(status.frozen_current, false);
assert.throws(
  () => cli('product-init', workspace, specId),
  /current active frozen/,
);
const freezeFile = JSON.stringify({
  spec: { id: specId, version: status.spec.version },
  justification: 'Synthetic T11 execution acceptance only.',
  data_class: 'synthetic',
});
const requested = cli('spec-freeze', workspace, seed.run, freezeFile);
if (requested.status === 'needs_human') {
  const decision = cli('decision', workspace, requested.admission.decision_id);
  cli(
    'answer',
    workspace,
    decision.id,
    decision.coverage.coverage_hash,
    'approve_once',
    'Synthetic exact-version build authorization.',
  );
}
const frozen =
  requested.status === 'frozen'
    ? requested
    : cli('spec-freeze', workspace, seed.run, freezeFile);
assert.equal(frozen.status, 'frozen');
const p = cli('product-init', workspace, specId);
const task = cli('product-task', p.id, 'T1', p.initial_commit);
const changed = cli(
  'product-patch',
  p.id,
  task.id,
  file('patch', {
    expected_commit: p.initial_commit,
    changes: [
      {
        path: 'src/import/check.py',
        before_hash: null,
        content: 'def valid(value):\n    return isinstance(value, str)\n',
      },
    ],
  }),
);
const build = cli('product-build', p.id, task.id, changed.commit);
assert.equal(build.state, 'succeeded', JSON.stringify(build));
assert.match(build.log, /checklist\/1/);
const merged = cli(
  'product-integrate',
  p.id,
  task.id,
  p.initial_commit,
  changed.commit,
);
assert.equal(merged.state, 'integrated');
assert.equal(cli('product-status', p.id).executions[0].id, build.id);
cli(
  'spec-revise',
  workspace,
  specId,
  JSON.stringify({
    expected_version: status.spec.version,
    title: status.spec.title,
    content: FIXTURE_SPEC,
    reason: 'Synthetic changed spec invalidates further product mutation.',
  }),
);
assert.throws(
  () => cli('product-task', p.id, 'T2', merged.commit),
  /current active frozen|specification/,
);
cli('logout');
assert.throws(() => cli('product-status', p.id), /401/);
const evidence = {
  synthetic: true,
  empirical_results: false,
  passed: true,
  workspace_id: workspace,
  spec_id: specId,
  product: p,
  task,
  patch: changed,
  build,
  integration: merged,
  checks: [
    'unfrozen spec denied',
    'authenticated owner',
    'exact frozen spec and task hashes',
    'scoped patch',
    'real constrained template build',
    'local integration',
    'changed spec denied',
    'unauthenticated status denied',
  ],
};
writeFileSync(
  'tracking/evidence/t11/cli-acceptance.json',
  JSON.stringify(evidence, null, 2) + '\n',
);
console.log(
  JSON.stringify({ passed: true, product_id: p.id, execution_id: build.id }),
);
