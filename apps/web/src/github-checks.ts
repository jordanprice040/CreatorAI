import type { GitHubPullChecks } from '@creator/contracts';

// No runtime imports, so tests can load this file on its own.
const STEP: Record<string, string> = {
  repository: 'the repository',
  pull: 'the pull request',
  check_runs: 'check runs',
  statuses: 'commit statuses',
};
/**
 * Plain reading of a checks read. A refused read (review M-1) is said as such, so an expired or
 * revoked token never reads as "no pull request" or "no checks".
 */
export function checksSummary(read: GitHubPullChecks): string {
  const refused = read.refusals.map(
    (r) =>
      `Could not read ${STEP[r.step]} (${r.status ?? 'no response'}): ${r.message}`,
  );
  const pullRefused = read.refusals.some(
    (r) => r.step === 'pull' || r.step === 'repository',
  );
  const head = read.pull
    ? `#${read.pull.number} ${read.pull.merged ? 'merged' : read.pull.state} · ${read.pull.head_ref} → ${read.pull.base_ref} · head ${read.pull.head_sha.slice(0, 12)} · ${
        read.checks.length
          ? read.checks
              .map(
                (c) =>
                  `${c.name}: ${c.conclusion ?? c.status} (${c.source === 'status' ? 'status' : 'check run'})`,
              )
              .join(', ')
          : read.refusals.length
            ? 'checks unknown'
            : 'no checks reported on this head'
      }`
    : pullRefused
      ? 'Pull request not read.'
      : 'GitHub has no pull request with that number in this repository.';
  const note =
    read.pull && !read.check_runs_readable
      ? ' Check runs (GitHub Actions) are not readable with a fine-grained token; only commit statuses are shown.'
      : '';
  return [head, ...refused].join(' ') + note;
}
