import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  ActionType,
  CheckObservation,
  GitHubConnectionBody,
  GitHubIdentity,
  GitHubOperationParams,
  PullObservation,
} from '@creator/contracts';
import { canonicalHash } from './rules.js';

// X04 rules for scoped GitHub management. Pure functions: the store and the adapters supply
// observations; these decide what is allowed and how a provider response is classified.

export interface Refusal {
  reason_code: string;
  explanation: string;
}
const refuse = (reason_code: string, explanation: string): Refusal => ({
  reason_code,
  explanation,
});

/** Git ref rules (git check-ref-format) plus the connection's branch prefix. */
export function branchRefusal(name: string, prefix: string): Refusal | null {
  if (
    name.includes('..') ||
    name.includes('@{') ||
    name.includes('//') ||
    name.endsWith('/') ||
    name.endsWith('.') ||
    name.endsWith('.lock') ||
    name.split('/').some((p) => p.startsWith('.') || p.endsWith('.lock'))
  )
    return refuse('invalid_branch', `"${name}" is not a valid branch name.`);
  if (!name.startsWith(prefix))
    return refuse(
      'branch_prefix',
      `Studio branches must start with "${prefix}".`,
    );
  return null;
}
export function repoNameRefusal(name: string, prefix: string): Refusal | null {
  if (!name.startsWith(prefix) || name.length === prefix.length)
    return refuse(
      'repo_prefix',
      `Studio repositories must be named "${prefix}<name>".`,
    );
  if (name.endsWith('.git') || name === '.' || name === '..')
    return refuse('invalid_repo_name', `"${name}" is not a usable name.`);
  return null;
}

/** Workflow and action definitions run with the repository's CI authority. */
export const isWorkflowPath = (p: string) =>
  /^\.github\/(workflows|actions)\//.test(p);

/** The action a person must have granted for these parameters (and pushed paths). */
export function githubActionType(
  params: GitHubOperationParams,
  changedPaths: readonly string[] | null,
): ActionType {
  switch (params.kind) {
    case 'repo_create':
      return 'github.repo_create';
    case 'pr_merge':
      return 'github.merge';
    case 'push':
      return (changedPaths ?? []).some(isWorkflowPath)
        ? 'github.workflow_change'
        : 'github.write';
    default:
      return 'github.write';
  }
}

/**
 * The exact external effect an approval covers. A merge binds the reviewed head, its checks
 * and its review; a push binds the commit and the paths it changes.
 */
export function githubIntentHash(v: {
  connection_id: string;
  repository_github_id: number | null;
  params: GitHubOperationParams;
  changed_paths: readonly string[] | null;
  required_checks: readonly string[] | null;
  review_id: string | null;
}): string {
  return canonicalHash({ format: 'github-intent/1', ...v });
}

export interface LimitInput {
  body: GitHubConnectionBody;
  params: GitHubOperationParams;
  /** Repositories the studio created, counting creations whose outcome is unknown. */
  createdRepositories: number;
  mutationsLastHour: number;
  openPullRequests: number;
  /** Operations with this intent still unknown: the effect may already exist. */
  unknownSameIntent: number;
  unknownCreates: number;
}
/** Prefix, count and rate limits from the connection; checked before admission. */
export function limitRefusal(i: LimitInput): Refusal | null {
  const { limits } = i.body;
  if (i.unknownSameIntent > 0)
    return refuse(
      'reconcile_first',
      'An identical operation has an unknown outcome; reconcile it before trying again.',
    );
  if (i.mutationsLastHour >= limits.max_mutations_per_hour)
    return refuse(
      'rate_limit',
      `This connection allows ${limits.max_mutations_per_hour} GitHub changes per hour.`,
    );
  const p = i.params;
  switch (p.kind) {
    case 'repo_create':
      if (i.unknownCreates > 0)
        return refuse(
          'reconcile_first',
          'A repository creation has an unknown outcome; reconcile it before creating another.',
        );
      if (i.createdRepositories >= limits.max_repositories)
        return refuse(
          'repository_limit',
          `This connection may create at most ${limits.max_repositories} repositories.`,
        );
      return repoNameRefusal(p.name, limits.repo_prefix);
    case 'branch_create':
    case 'push':
      return branchRefusal(p.branch, limits.branch_prefix);
    case 'pr_open':
      if (i.openPullRequests >= limits.max_open_prs_per_repo)
        return refuse(
          'pull_request_limit',
          `At most ${limits.max_open_prs_per_repo} studio pull requests may be open per repository.`,
        );
      return branchRefusal(p.head_branch, limits.branch_prefix);
    default:
      return null;
  }
}

/** Does the account behind the credential match the owner the connection names? */
export function identityRefusal(
  owner: GitHubConnectionBody['owner'],
  observed: GitHubIdentity,
): Refusal | null {
  if (observed.id !== owner.id || observed.type !== owner.type)
    return refuse(
      'wrong_owner',
      `The credential belongs to ${observed.type} ${observed.login} (${observed.id}), not ${owner.type} ${owner.login} (${owner.id}).`,
    );
  return null;
}

export interface MergeGateInput {
  params: Extract<GitHubOperationParams, { kind: 'pr_merge' }>;
  pull: PullObservation;
  requiredChecks: readonly string[];
  checks: readonly CheckObservation[];
  /** Whether this credential could read check runs (fine-grained tokens cannot). */
  checkRunsReadable: boolean;
  review: {
    id: string;
    head_sha: string;
    verdict: 'approve' | 'request_changes';
    reviewer_id: string;
  } | null;
  /** Actors who pushed this head through the studio; they cannot be its reviewer. */
  headAuthors: readonly string[];
}
/** Merge only the exact reviewed head with every required check passing on it. */
export function mergeRefusal(g: MergeGateInput): Refusal | null {
  if (g.pull.merged || g.pull.state !== 'open')
    return refuse('pull_not_open', 'The pull request is not open.');
  if (g.pull.head_sha !== g.params.reviewed_head_sha)
    return refuse(
      'stale_head',
      `The pull request head is ${g.pull.head_sha.slice(0, 12)}, not the reviewed ${g.params.reviewed_head_sha.slice(0, 12)}.`,
    );
  if (!g.review || g.review.head_sha !== g.pull.head_sha)
    return refuse(
      'review_missing',
      'No review is recorded for this exact head.',
    );
  if (g.review.verdict !== 'approve')
    return refuse(
      'review_not_approved',
      'The latest review of this head requests changes.',
    );
  if (g.headAuthors.includes(g.review.reviewer_id))
    return refuse(
      'review_not_independent',
      'The reviewer pushed this head; review must come from someone else.',
    );
  if (g.requiredChecks.length === 0)
    return refuse(
      'required_checks_missing',
      'The connection names no required checks, so nothing shows this head passes.',
    );
  for (const name of g.requiredChecks) {
    const seen = g.checks.filter(
      (c) => c.name === name && c.head_sha === g.pull.head_sha,
    );
    if (seen.length === 0)
      return refuse(
        'check_missing',
        g.checkRunsReadable
          ? `Required check "${name}" has not reported on this head.`
          : `Required check "${name}" has no commit status on this head, and this credential cannot read check runs (fine-grained tokens cannot use the Checks API).`,
      );
    if (seen.some((c) => c.status !== 'completed'))
      return refuse(
        'check_pending',
        `Required check "${name}" has not finished.`,
      );
    if (seen.some((c) => c.conclusion !== 'success'))
      return refuse(
        'check_failed',
        `Required check "${name}" did not succeed on this head.`,
      );
  }
  return null;
}

export type ResponseClass =
  | { state: 'succeeded' }
  | { state: 'failed'; reason_code: string; explanation: string }
  | { state: 'unknown'; reason_code: string; explanation: string };
/**
 * How a GitHub response settles a mutation. No response, a timeout or a 5xx may have taken
 * effect, so they are unknown until reconciled; 4xx responses are definitive refusals.
 */
export function classifyResponse(r: {
  status: number | null;
  headers?: Record<string, string>;
  message?: string;
}): ResponseClass {
  const s = r.status;
  const h = r.headers ?? {};
  const m = (r.message ?? '').slice(0, 300);
  if (s === null)
    return {
      state: 'unknown',
      reason_code: 'no_response',
      explanation: `No response from GitHub${m ? `: ${m}` : ''}; the change may or may not exist.`,
    };
  if (s >= 200 && s < 300) return { state: 'succeeded' };
  if (s >= 500)
    return {
      state: 'unknown',
      reason_code: 'server_error',
      explanation: `GitHub answered ${s}; the change may or may not exist.`,
    };
  const fail = (reason_code: string, explanation: string): ResponseClass => ({
    state: 'failed',
    reason_code,
    explanation,
  });
  if (s === 401)
    return fail(
      'credential_rejected',
      'GitHub rejected the credential (expired or revoked).',
    );
  if (
    s === 429 ||
    (s === 403 && (h['x-ratelimit-remaining'] === '0' || /rate limit/i.test(m)))
  )
    return fail(
      'provider_rate_limited',
      `GitHub rate limit${h['retry-after'] ? `; retry after ${h['retry-after']}s` : ''}.`,
    );
  if (s === 403)
    return fail(
      'permission_missing',
      `GitHub refused the request${h['x-accepted-github-permissions'] ? `; it needs ${h['x-accepted-github-permissions']}` : ''}.`,
    );
  if (s === 404)
    return fail(
      'not_accessible',
      'GitHub reports not found: the resource is gone or outside this credential’s repositories.',
    );
  if (s === 409)
    return fail('stale_head', 'The head moved; GitHub refused the change.');
  if (s === 405) return fail('not_mergeable', 'GitHub cannot merge this.');
  if (s === 422)
    return fail('validation_failed', `GitHub rejected the request: ${m}`);
  return fail('rejected', `GitHub answered ${s}: ${m}`);
}

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(secret, raw body), compared in constant time. */
export function webhookSignatureValid(
  secret: string,
  raw: Buffer,
  header: string | undefined,
): boolean {
  if (!header || !/^sha256=[a-f0-9]{64}$/.test(header)) return false;
  const expected = Buffer.from(
    `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
  );
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export interface WebhookEffect {
  kind:
    | 'repository_access_lost'
    | 'repository_public'
    | 'connection_access_revoked';
  github_ids: number[];
  note: string;
}
const num = (v: unknown) =>
  typeof v === 'number' && Number.isSafeInteger(v) && v > 0 ? v : null;
/**
 * A verified delivery is evidence that something changed, never authority. Only losses of
 * access or privacy are acted on; everything else is recorded and re-read before use.
 */
export function webhookEffects(
  event: string,
  payload: unknown,
): WebhookEffect[] {
  const p = (payload ?? {}) as Record<string, unknown>;
  const action = typeof p.action === 'string' ? p.action : '';
  const repo = num((p.repository as Record<string, unknown> | undefined)?.id);
  if (event === 'installation_repositories' && action === 'removed') {
    const ids = Array.isArray(p.repositories_removed)
      ? p.repositories_removed
          .map((r) => num((r as Record<string, unknown>)?.id))
          .filter((x): x is number => x !== null)
      : [];
    return ids.length
      ? [
          {
            kind: 'repository_access_lost',
            github_ids: ids,
            note: 'Removed from the installation.',
          },
        ]
      : [];
  }
  if (
    (event === 'installation' && ['deleted', 'suspend'].includes(action)) ||
    (event === 'github_app_authorization' && action === 'revoked')
  )
    return [
      {
        kind: 'connection_access_revoked',
        github_ids: [],
        note: `${event} ${action}`,
      },
    ];
  if (event === 'repository' && repo !== null) {
    if (action === 'publicized')
      return [
        {
          kind: 'repository_public',
          github_ids: [repo],
          note: 'The repository was made public outside the studio.',
        },
      ];
    if (['deleted', 'transferred', 'archived'].includes(action))
      return [
        {
          kind: 'repository_access_lost',
          github_ids: [repo],
          note: `The repository was ${action}.`,
        },
      ];
  }
  return [];
}
