import { z, id, hash, timestamp, version } from './primitives.js';
import { DataClassSchema } from './oversight.js';

// X04 scoped GitHub management. A connection names one verified owner, one credential
// reference and the limits the studio stays inside; nothing here is permission by itself
// (grants are). Credentials are named by environment variable, never stored.
export const GITHUB_POLICY_VERSION = 'github/1.0' as const;
/** REST API version sent on every call (docs.github.com, checked October 19, 2026). */
export const GITHUB_API_VERSION = '2026-03-10' as const;

const note = z.string().trim().min(1).max(1200);
const label = z.string().trim().min(1).max(200);
const envName = z.string().regex(/^CREATOR_GITHUB_[A-Z0-9_]{1,60}$/);
const login = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/);
const githubId = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
export const sha = z.string().regex(/^[a-f0-9]{40}$/);
export const repoName = z.string().regex(/^[a-z0-9][a-z0-9._-]{0,99}$/);
/** Git ref names checked by domain code as well (no '..', '@{', '.lock', control chars). */
export const branchName = z
  .string()
  .regex(/^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$/);

const clientId = z.string().regex(/^[A-Za-z0-9._-]{1,100}$/);
const appSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{0,99}$/);
/** ADR-0132: the vault entry holding a studio-created GitHub App's private key. */
export const githubAppKeyRef = z
  .string()
  .regex(
    /^github-app-key\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
  );

export const GitHubCredentialSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('fixture') }),
  z.strictObject({
    kind: z.literal('fine_grained_pat'),
    token_env: envName,
    /** The expiry the owner chose when creating the token; refusal starts there. */
    expires_at: timestamp,
  }),
  z.strictObject({
    kind: z.literal('app_installation'),
    app_client_id: clientId,
    private_key_env: envName,
    installation_id: githubId,
  }),
  // ADR-0132 (P32): a GitHub App the owner created from the studio. Its private key is sealed in
  // the studio's protected vault under key_ref; only the in-app setup writes this kind.
  z.strictObject({
    kind: z.literal('app_vault'),
    app_id: githubId,
    app_slug: appSlug,
    app_client_id: clientId,
    key_ref: githubAppKeyRef,
    installation_id: githubId,
  }),
]);
export type GitHubCredential = z.infer<typeof GitHubCredentialSchema>;
/** ADR-0062: the owner sets these numeric limits with no upper limit; each must be at least 1. */
export const GitHubLimitsSchema = z.strictObject({
  /** Repositories the studio creates must start with this prefix. */
  repo_prefix: z.string().regex(/^[a-z0-9][a-z0-9-]{1,30}-$/),
  /** Branches the studio creates or pushes must start with this prefix. */
  branch_prefix: z.string().regex(/^[a-z0-9][a-z0-9-]{0,30}\/$/),
  max_repositories: z.number().int().min(1),
  max_mutations_per_hour: z.number().int().min(1),
  max_open_prs_per_repo: z.number().int().min(1),
});
export const RegisterGitHubConnectionRequestSchema = z
  .strictObject({
    label,
    mode: z.enum(['fixture', 'live']),
    owner: z.strictObject({
      login,
      id: githubId,
      type: z.enum(['User', 'Organization']),
    }),
    credential: GitHubCredentialSchema,
    webhook_secret_env: envName.nullable(),
    limits: GitHubLimitsSchema,
    /** Check names every merge must see passing on the exact head; empty refuses all merges. */
    required_checks: z.array(z.string().trim().min(1).max(200)).max(20),
    /** Existing repositories are outside scope unless listed here by immutable id. */
    included_repositories: z
      .array(z.strictObject({ github_id: githubId, full_name: label }))
      .max(20),
  })
  .superRefine((c, ctx) => {
    if ((c.mode === 'fixture') !== (c.credential.kind === 'fixture'))
      ctx.addIssue({
        code: 'custom',
        message:
          'Fixture connections use the fixture credential, and only they do.',
      });
    if (new Set(c.required_checks).size !== c.required_checks.length)
      ctx.addIssue({ code: 'custom', message: 'Required checks repeat.' });
  });
export type GitHubConnectionBody = z.infer<
  typeof RegisterGitHubConnectionRequestSchema
>;
export const GitHubConnectionStatusSchema = z.enum([
  'unverified',
  'active',
  'credential_rejected',
  'access_revoked',
  'revoked',
]);
export const GitHubIdentitySchema = z.strictObject({
  login,
  id: githubId,
  type: z.enum(['User', 'Organization']),
});
export type GitHubIdentity = z.infer<typeof GitHubIdentitySchema>;
export const GitHubConnectionSchema = z.strictObject({
  id,
  workspace_id: id,
  fixture: z.boolean(),
  version,
  status: GitHubConnectionStatusSchema,
  body: RegisterGitHubConnectionRequestSchema,
  body_hash: hash,
  verification: z
    .strictObject({
      checked_at: timestamp,
      result: z.enum(['match', 'wrong_owner', 'refused']),
      observed: GitHubIdentitySchema.nullable(),
      reason: z.string().max(500),
      token_expires_at: timestamp.nullable(),
    })
    .nullable(),
  status_reason: z.string().max(500).nullable(),
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
});
/**
 * Review 2 N-1 (ADR-0132): what revoke answers. The connection is revoked even when the app key
 * could not be deleted from this computer just then (`key_forget_failed`).
 */
export const GitHubRevokeResultSchema = GitHubConnectionSchema.extend({
  key_forget_failed: z.literal(true).optional(),
});
export type GitHubRevokeResult = z.infer<typeof GitHubRevokeResultSchema>;

export type GitHubConnection = z.infer<typeof GitHubConnectionSchema>;
export const RevokeGitHubConnectionRequestSchema = z.strictObject({
  expected_version: version,
  reason: z.string().trim().min(1).max(500),
});

export const GitHubRepositorySchema = z.strictObject({
  id,
  workspace_id: id,
  connection_id: id,
  github_id: githubId,
  owner_id: githubId,
  full_name: label,
  default_branch: z.string().max(200),
  origin: z.enum(['created', 'included']),
  status: z.enum(['active', 'access_lost', 'quarantined']),
  status_reason: z.string().max(500).nullable(),
  created_operation_id: id.nullable(),
  created_at: timestamp,
  updated_at: timestamp,
});
export type GitHubRepository = z.infer<typeof GitHubRepositorySchema>;

// Operations. The caller names a kind and its parameters; the action type, admission and
// limits come from the application, and the local push source is resolved by the server.
const common = {
  connection_id: id,
  run_id: id,
  task_id: id.nullable(),
  data_class: DataClassSchema,
  justification: note,
};
export const GitHubOperationParamsSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('repo_create'),
    name: repoName,
    description: z.string().max(350),
  }),
  z.strictObject({
    kind: z.literal('branch_create'),
    repository_id: id,
    branch: branchName,
    from_sha: sha,
  }),
  z.strictObject({
    kind: z.literal('push'),
    repository_id: id,
    branch: branchName,
    product_id: id,
    sha,
    /** The commit the remote branch is at now; null for a new branch. */
    base_sha: sha.nullable(),
  }),
  z.strictObject({
    kind: z.literal('issue_create'),
    repository_id: id,
    title: z.string().trim().min(1).max(256),
    body: z.string().max(8000),
  }),
  z.strictObject({
    kind: z.literal('pr_open'),
    repository_id: id,
    head_branch: branchName,
    base_branch: branchName,
    title: z.string().trim().min(1).max(256),
    body: z.string().max(8000),
  }),
  z.strictObject({
    kind: z.literal('pr_merge'),
    repository_id: id,
    pr_number: githubId,
    reviewed_head_sha: sha,
    merge_method: z.enum(['merge', 'squash']),
  }),
]);
export type GitHubOperationParams = z.infer<typeof GitHubOperationParamsSchema>;
export type GitHubOperationKind = GitHubOperationParams['kind'];
export const GitHubOperationRequestSchema = z.strictObject({
  ...common,
  params: GitHubOperationParamsSchema,
});
export type GitHubOperationRequest = z.infer<
  typeof GitHubOperationRequestSchema
>;
export const GitHubOperationStateSchema = z.enum([
  'refused',
  'dispatched',
  'succeeded',
  'failed',
  'unknown',
  'reconciled_succeeded',
  'reconciled_absent',
]);
export const GitHubOperationSchema = z.strictObject({
  id,
  workspace_id: id,
  connection_id: id,
  run_id: id,
  kind: z.string().max(40),
  action_type: z.string().max(40).nullable(),
  repository_id: id.nullable(),
  params: GitHubOperationParamsSchema,
  intent_hash: hash,
  admission_id: id.nullable(),
  state: GitHubOperationStateSchema,
  reason_code: z.string().max(80),
  explanation: z.string().max(1200),
  /** Observations the gate used (merge: PR head, checks, review), recorded with the intent. */
  gate: z.record(z.string(), z.unknown()).nullable(),
  result: z.record(z.string(), z.unknown()).nullable(),
  fixture: z.boolean(),
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
});
export type GitHubOperation = z.infer<typeof GitHubOperationSchema>;

export const RecordGitHubReviewRequestSchema = z.strictObject({
  repository_id: id,
  pr_number: githubId,
  head_sha: sha,
  verdict: z.enum(['approve', 'request_changes']),
  note,
});
export const GitHubReviewSchema = z.strictObject({
  id,
  workspace_id: id,
  repository_id: id,
  pr_number: githubId,
  head_sha: sha,
  verdict: z.enum(['approve', 'request_changes']),
  note,
  reviewer_id: id,
  created_at: timestamp,
});
export type GitHubReview = z.infer<typeof GitHubReviewSchema>;

/** What the adapter observed about a pull request and its checks right before a merge. */
export const CheckObservationSchema = z.strictObject({
  name: z.string().max(200),
  head_sha: sha,
  source: z.enum(['check_run', 'status']),
  status: z.enum(['queued', 'in_progress', 'completed', 'pending']),
  conclusion: z.string().max(40).nullable(),
});
export type CheckObservation = z.infer<typeof CheckObservationSchema>;
export const PullObservationSchema = z.strictObject({
  number: githubId,
  state: z.enum(['open', 'closed']),
  merged: z.boolean(),
  head_sha: sha,
  head_ref: z.string().max(200),
  base_ref: z.string().max(200),
  merge_commit_sha: sha.nullable(),
});
export type PullObservation = z.infer<typeof PullObservationSchema>;

/** P22: a read-only look at one pull request's head and the checks GitHub reports on it. */
export const GitHubPullChecksSchema = z.strictObject({
  repository_id: id,
  read_at: timestamp,
  pull: PullObservationSchema.nullable(),
  checks: z.array(CheckObservationSchema).max(200),
  /** False with a fine-grained token: GitHub only lets it read commit statuses. */
  check_runs_readable: z.boolean(),
  /**
   * Review M-1: reads GitHub did not answer (an expired or refused token, rate limit, 5xx or no
   * response). Non-empty means `pull` and `checks` are not evidence of absence.
   */
  refusals: z
    .array(
      z.strictObject({
        step: z.enum(['repository', 'pull', 'check_runs', 'statuses']),
        status: z.number().int().nullable(),
        message: z.string().max(300),
      }),
    )
    .max(3),
});
export type GitHubPullChecks = z.infer<typeof GitHubPullChecksSchema>;

export const GitHubDeliverySchema = z.strictObject({
  id,
  connection_id: id,
  delivery_id: z.string().max(100),
  event: z.string().max(100),
  action: z.string().max(100).nullable(),
  payload_hash: hash,
  status: z.enum(['accepted', 'rejected_signature']),
  effects: z.array(z.string().max(300)),
  received_at: timestamp,
});
export type GitHubDelivery = z.infer<typeof GitHubDeliverySchema>;

// ADR-0132 (P32): the GitHub App the owner creates and installs from the studio (manifest flow),
// so no token or key is made by hand. The studio exchanges GitHub's one-time code for the app's
// key, seals it in the protected vault, finds the installation with the app's own JWT and then
// registers an ordinary live connection that still needs Verify, grants and admission.
/** GitHub gives an hour to finish the manifest handshake. */
export const GITHUB_APP_SETUP_MS = 60 * 60 * 1000;
export const GitHubAppSetupStatusSchema = z.enum([
  'waiting_for_github',
  'app_created',
  'installed',
  'connected',
  'failed',
  'abandoned',
  'expired',
]);
export type GitHubAppSetupStatus = z.infer<typeof GitHubAppSetupStatusSchema>;
export const GitHubAppSetupSchema = z.strictObject({
  id,
  workspace_id: id,
  status: GitHubAppSetupStatusSchema,
  /** Null: the app is registered on the owner's personal account. */
  organization: login.nullable(),
  app: z
    .strictObject({
      id: githubId,
      slug: appSlug,
      client_id: clientId,
      name: z.string().max(200),
      owner: GitHubIdentitySchema,
      html_url: z.string().url().max(500),
    })
    .nullable(),
  installation: z
    .strictObject({
      id: githubId,
      account: GitHubIdentitySchema,
      repository_selection: z.enum(['all', 'selected']),
    })
    .nullable(),
  connection_id: id.nullable(),
  failure: z.string().max(500).nullable(),
  created_by: id,
  created_at: timestamp,
  updated_at: timestamp,
});
export type GitHubAppSetup = z.infer<typeof GitHubAppSetupSchema>;
export const BeginGitHubAppSetupRequestSchema = z.strictObject({
  organization: login.nullable(),
  /** False for the CLI and tests: the reply's start_url is opened by hand. */
  open_browser: z.boolean(),
});
export const GitHubAppSetupStartSchema = z.strictObject({
  setup: GitHubAppSetupSchema,
  /** A loopback page on this computer that sends the app description to GitHub. */
  start_url: z.string().url(),
  expires_in_s: z.number().int().positive(),
});
/** The connection the finished setup registers: everything but owner and credential. */
export const ConnectGitHubAppSetupRequestSchema = z.strictObject({
  label,
  limits: GitHubLimitsSchema,
  required_checks: z.array(z.string().trim().min(1).max(200)).max(20),
  included_repositories: z
    .array(z.strictObject({ github_id: githubId, full_name: label }))
    .max(20),
});
export type ConnectGitHubAppSetupRequest = z.infer<
  typeof ConnectGitHubAppSetupRequestSchema
>;
