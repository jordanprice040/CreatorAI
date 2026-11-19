import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changedPaths, studioGit, TooManyPathsError } from '@creator/broker';
import { githubActionType } from '@creator/domain';

// Audit 2026-11-19 H-1: the paths a push changes decide github.write versus
// github.workflow_change, so the list must be whole (stdout only, never cut) or refused.
function repo(t: test.TestContext) {
  const dir = mkdtempSync(join(tmpdir(), 'creator-paths-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const git = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Fixture',
        GIT_AUTHOR_EMAIL: 'f@invalid',
        GIT_COMMITTER_NAME: 'Fixture',
        GIT_COMMITTER_EMAIL: 'f@invalid',
      },
    })
      .toString()
      .trim();
  git('init', '-q', '-b', 'main');
  const write = (path: string, text: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
  };
  const commit = () => {
    git('add', '-A');
    git('commit', '-q', '-m', 'edit');
    return git('rev-parse', 'HEAD');
  };
  return { dir, git, write, commit };
}

const push = (sha: string, base: string | null) => ({
  kind: 'push' as const,
  repository_id: '00000000-0000-4000-8000-000000000000',
  branch: 'creator/feature',
  product_id: '00000000-0000-4000-8000-000000000001',
  sha,
  base_sha: base,
});

test('a long push keeps every path, so a workflow path sorted last still gates', async (t) => {
  const r = repo(t);
  r.write('README.md', 'base');
  const base = r.commit();
  // 240 long paths that sort before ".github" (as '-' does), then the workflow file.
  const pad = 'x'.repeat(60);
  for (let i = 0; i < 240; i++)
    r.write(`-gen/${pad}/file-${String(i).padStart(3, '0')}.txt`, `v${i}`);
  r.write('.github/workflows/zz.yml', 'on: push');
  const sha = r.commit();
  for (const b of [base, null]) {
    const paths = await changedPaths(r.dir, b, sha);
    assert.equal(paths.length, b ? 241 : 242);
    assert.ok(paths.every((p) => !p.includes('\n')));
    assert.ok(paths.includes('.github/workflows/zz.yml'));
    assert.equal(
      githubActionType(push(sha, b) as never, paths),
      'github.workflow_change',
    );
  }
});

test('moving a workflow file out of .github lists its old path too', async (t) => {
  const r = repo(t);
  r.write('.github/workflows/ci.yml', 'on: push\n'.repeat(20));
  const base = r.commit();
  mkdirSync(join(r.dir, 'docs'));
  r.git('mv', '.github/workflows/ci.yml', 'docs/ci.yml');
  const sha = r.commit();
  const paths = await changedPaths(r.dir, base, sha);
  assert.deepEqual(paths, ['.github/workflows/ci.yml', 'docs/ci.yml']);
});

test('a list over the limit is refused whole, never cut', async (t) => {
  const r = repo(t);
  r.write('README.md', 'base');
  const base = r.commit();
  for (let i = 0; i < 12; i++) r.write(`src/f${i}.txt`, `v${i}`);
  const sha = r.commit();
  assert.equal((await changedPaths(r.dir, base, sha, 12)).length, 12);
  await assert.rejects(
    changedPaths(r.dir, base, sha, 11),
    (e: unknown) =>
      e instanceof TooManyPathsError && /12 paths; at most 11/.test(e.message),
  );
});

test('Git keeps stdout and stderr apart', async (t) => {
  const r = repo(t);
  r.write('README.md', 'base');
  const head = r.commit();
  const g = await studioGit(r.dir, [
    'show-ref',
    '--verify',
    'refs/heads/main',
    'refs/heads/no-such-ref',
  ]);
  assert.notEqual(g.code, 0);
  assert.equal(g.stdout.trim(), `${head} refs/heads/main`);
  assert.match(g.stderr, /no-such-ref/);
  assert.doesNotMatch(g.stdout, /no-such-ref/);
  assert.equal(g.stdoutOverflow, false);
});
