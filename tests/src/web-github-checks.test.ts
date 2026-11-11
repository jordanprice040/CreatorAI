import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

// P22 nit: the plain reading of a GitHub checks read. The module has only a type import, so it
// loads on its own.
async function load() {
  const source = await readFile('apps/web/src/github-checks.ts', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as { checksSummary: (read: unknown) => string };
  new Function('exports', code)(exports);
  return exports.checksSummary;
}
const pull = {
  number: 1,
  state: 'open',
  merged: false,
  head_sha: 'b'.repeat(40),
  head_ref: 'creator/p22-trial',
  base_ref: 'creator/p22-base',
  merge_commit_sha: null,
};
const read = (over: Record<string, unknown>) => ({
  repository_id: 'r',
  read_at: '2026-11-11T00:00:00Z',
  pull,
  checks: [],
  check_runs_readable: true,
  refusals: [],
  ...over,
});

test('checksSummary: checks, empty, refused and missing reads read differently', async () => {
  const summary = await load();
  // Checks on the head, by source.
  assert.equal(
    summary(
      read({
        checks: [
          {
            name: 'ci',
            status: 'completed',
            conclusion: 'success',
            source: 'check_run',
          },
          {
            name: 'lint',
            status: 'pending',
            conclusion: null,
            source: 'status',
          },
        ],
      }),
    ),
    `#1 open · creator/p22-trial → creator/p22-base · head ${'b'.repeat(12)} · ci: success (check run), lint: pending (status)`,
  );
  // An empty answer is evidence of no checks.
  assert.match(summary(read({})), /no checks reported on this head$/);
  // A refused statuses read is never "no checks".
  const refused = summary(
    read({
      refusals: [{ step: 'statuses', status: 403, message: 'Forbidden' }],
    }),
  );
  assert.match(refused, /checks unknown/);
  assert.match(refused, /Could not read commit statuses \(403\): Forbidden/);
  assert.doesNotMatch(refused, /no checks reported/);
  // No such pull request (404) vs a refused pull or repository read.
  assert.equal(
    summary(read({ pull: null })),
    'GitHub has no pull request with that number in this repository.',
  );
  for (const step of ['pull', 'repository']) {
    const s = summary(
      read({
        pull: null,
        refusals: [{ step, status: null, message: 'timeout' }],
      }),
    );
    assert.match(s, /^Pull request not read\./);
    assert.match(s, /\(no response\): timeout/);
    assert.doesNotMatch(s, /no pull request/);
  }
  // A fine-grained token says check runs are not readable.
  assert.match(
    summary(read({ check_runs_readable: false })),
    /not readable with a fine-grained token/,
  );
});
