import { createHash } from 'node:crypto';
import {
  ContractError,
  type GitHubConnection,
  type GitHubRevokeResult,
  type GitHubOperation,
  type GitHubPullChecks,
  type GitHubRepository,
} from '@creator/contracts';
import {
  classifyResponse,
  webhookSignatureValid,
  type ResponseClass,
} from '@creator/domain';
import type {
  CommandContext,
  GitHubObservations,
  GitHubStore,
} from '@creator/db';
import type { PlanVault } from './plan-vault.js';
import {
  FixtureGitHub,
  LiveGitHub,
  liveGitHubFromEnv,
  type GitHubAdapter,
  type GitHubResponse,
  type RepoObservation,
  type RepoRef,
} from './github.js';
import { changedPaths, TooManyPathsError } from './github-git.js';

export interface GitHubServiceOptions {
  /** API process environment: CREATOR_GITHUB=live and the credential variables live here. */
  env: Record<string, string | undefined>;
  /**
   * Local product repository for a push: the server resolves it and must refuse a product of
   * another workspace; callers never name a path.
   */
  pushSource: (
    productId: string,
    workspaceId: string,
  ) => Promise<string> | string;
  /** Test seam: the fixture GitHub for a connection (default: one per connection). */
  fixture?: (connection: GitHubConnection) => FixtureGitHub;
  /** Test seam: a live adapter for a connection (default: from env or, ADR-0132, the vault). */
  live?: (connection: GitHubConnection) => GitHubAdapter | null;
  /** ADR-0132: where a studio-created GitHub App's key is sealed. */
  vault?: PlanVault | null;
  /** Tests only: loopback stand-ins for api.github.com and github.com for vault-keyed apps. */
  appBases?: { apiBase: string; gitBase: string };
}
const repoData = (o: RepoObservation) => ({
  github_id: o.github_id,
  owner: o.owner,
  full_name: o.full_name,
  private: o.private,
  default_branch: o.default_branch,
});
const observed = (
  o: RepoObservation | null,
): NonNullable<GitHubObservations['repository']> | null =>
  o && {
    github_id: o.github_id,
    owner_id: o.owner.id,
    full_name: o.full_name,
    private: o.private,
    default_branch: o.default_branch,
  };
/** GitHub's own JSON and the fixture's both normalise to the repository shape the store reads. */
function createdRepository(d: Record<string, unknown> | null) {
  if (!d) return null;
  const owner = d.owner as Record<string, unknown> | undefined;
  const id = typeof d.github_id === 'number' ? d.github_id : d.id;
  return typeof id === 'number' && typeof owner?.id === 'number'
    ? {
        github_id: id,
        owner: { id: owner.id, login: String(owner.login) },
        full_name: String(d.full_name),
        private: d.private === true,
        default_branch: String(d.default_branch ?? 'main'),
      }
    : null;
}

/**
 * P32 live trial (ADR-0132): what GitHub answered to an operation that did not succeed, kept on
 * the operation so a refusal can be told from a rate limit afterwards. Status, GitHub's own
 * message, which step answered (the App token step or the call) and the rate-limit and
 * permission headers; never the body or a token.
 */
export function githubAnswer(res: GitHubResponse): Record<string, unknown> {
  return {
    github_answer: {
      status: res.status,
      step: res.stage ?? 'call',
      message: res.message.slice(0, 300),
      rate_limit_remaining: res.headers['x-ratelimit-remaining'] ?? null,
      retry_after: res.headers['retry-after'] ?? null,
      accepted_permissions:
        res.headers['x-accepted-github-permissions'] ?? null,
    },
  };
}

/**
 * Review 1 N-3 and review 2 L-1 (PR #244): when GitHub did not hand out the App token (it
 * refused, did not answer, or the studio could not sign the request), the change itself was
 * never sent. That is a plain failure, not an unknown outcome, so it says so and a retry needs
 * no Reconcile first.
 */
export function appTokenWording(
  cls: ResponseClass,
  res: GitHubResponse,
): ResponseClass {
  if (res.stage === undefined || cls.state === 'succeeded') return cls;
  const said = res.message ? ` GitHub said: ${res.message}` : '';
  if (res.stage === 'studio')
    return {
      state: 'failed',
      reason_code: 'app_token_unavailable',
      explanation:
        'The studio could not sign a GitHub App token request (check the App key), so the change was not sent.',
    };
  if (cls.state === 'unknown')
    return {
      state: 'failed',
      reason_code: 'app_token_unavailable',
      explanation: `GitHub did not hand out an App token (${res.status === null ? 'no answer' : res.status}), so the change was not sent. Try again later.${said}`,
    };
  return {
    ...cls,
    explanation:
      cls.reason_code === 'provider_rate_limited'
        ? `GitHub rate-limited the App token request, so the change was not sent. Try again later.${said}`
        : res.status === 401
          ? `GitHub did not accept the App's sign-in (App id or key), so the change was not sent.${said}`
          : `GitHub refused an App token for this change (${res.status}), so the change was not sent: the App may lack a permission or no longer be installed on this repository.${said}`,
  };
}

/**
 * Review M-2 (ADR-0132): GitHub may refuse an app installation token on `POST /user/repos`
 * (personal accounts). Say what to do instead of GitHub's bare "Resource not accessible".
 */
export function refusalWording(
  cls: ResponseClass,
  kind: string,
  conn: GitHubConnection,
  res: GitHubResponse,
): ResponseClass {
  const app =
    conn.body.credential.kind === 'app_vault' ||
    conn.body.credential.kind === 'app_installation';
  // P32 live trial: only a real permission refusal on the call itself, never a rate limit or a
  // refused app token, gets the personal-account wording.
  if (
    kind !== 'repo_create' ||
    !app ||
    conn.body.owner.type !== 'User' ||
    res.status !== 403 ||
    res.stage !== undefined ||
    cls.state !== 'failed' ||
    cls.reason_code !== 'permission_missing'
  )
    return cls;
  return {
    ...cls,
    explanation:
      'GitHub does not let this app create repositories on a personal account. Create the repository on GitHub and add it to the app’s installation; to let Creator Agent use it, set up the connection again with the repository listed (Set up another app).',
  };
}

/**
 * X04: runs GitHub operations through the store's intent journal. Reads come first (repository
 * by immutable id, remote head, pull request, checks), then the store admits and records the
 * intent, then exactly one call is made and its answer settles the operation.
 */
export class GitHubService {
  readonly liveEnabled: boolean;
  #fixtures = new Map<string, FixtureGitHub>();
  #appKeys = new Map<string, string>();
  constructor(
    private readonly store: GitHubStore,
    private readonly opts: GitHubServiceOptions,
  ) {
    const mode = opts.env.CREATOR_GITHUB ?? 'off';
    if (mode !== 'off' && mode !== 'live')
      throw new ContractError(
        'INVALID_CONFIG',
        'CREATOR_GITHUB must be off or live.',
      );
    this.liveEnabled = mode === 'live';
  }

  /** The fixture GitHub for a fixture connection (tests use it to inject faults). */
  fixtureFor(conn: GitHubConnection): FixtureGitHub {
    let f = this.#fixtures.get(conn.id);
    if (!f) {
      f =
        this.opts.fixture?.(conn) ?? new FixtureGitHub({ ...conn.body.owner });
      this.#fixtures.set(conn.id, f);
    }
    return f;
  }
  async #adapter(conn: GitHubConnection): Promise<GitHubAdapter | null> {
    const cred = conn.body.credential;
    if (cred.kind === 'fixture') return this.fixtureFor(conn);
    if (!this.liveEnabled) return null;
    if (this.opts.live) return this.opts.live(conn);
    if (cred.kind !== 'app_vault')
      return liveGitHubFromEnv(this.opts.env, cred);
    // ADR-0132: the key the in-app setup sealed; a missing vault or entry is "not set". Review
    // N-5: unsealing starts PowerShell on Windows, so a key is unsealed once per process.
    let pem = this.#appKeys.get(cred.key_ref) ?? null;
    if (!pem && this.opts.vault) {
      pem = await this.opts.vault.getGitHubAppKey(cred.key_ref);
      if (pem) this.#appKeys.set(cred.key_ref, pem);
    }
    return pem
      ? new LiveGitHub({
          credential: {
            kind: 'app_installation',
            client_id: cred.app_client_id,
            private_key: pem,
            installation_id: cred.installation_id,
          },
          ...(this.opts.appBases ?? {}),
        })
      : null;
  }
  async #need(conn: GitHubConnection) {
    const a = await this.#adapter(conn);
    if (!a)
      throw new ContractError(
        'LIVE_DISABLED',
        !this.liveEnabled
          ? 'Live GitHub is off (CREATOR_GITHUB=live is not set).'
          : conn.body.credential.kind === 'app_vault'
            ? 'The app key for this connection is not on this computer.'
            : 'The credential variable this connection names is not set on the API process.',
      );
    return a;
  }

  /**
   * Review L-4 (ADR-0132): revoking a connection to a studio-created app also deletes its sealed
   * key, which nothing else uses (one setup, one connection; the generic route refuses
   * `app_vault`). The revoke event records that the key is being forgotten.
   */
  async revoke(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ): Promise<GitHubRevokeResult> {
    const conn = await this.store.revokeGitHubConnection(ctx, ws, id, raw);
    const cred = conn.body.credential;
    if (cred.kind === 'app_vault' && conn.status === 'revoked') {
      this.#appKeys.delete(cred.key_ref);
      // Review 2 N-1: the revoke has committed; a key file that can't be deleted just now (locked
      // on Windows, say) is reported, not turned into a failed revoke.
      try {
        await this.opts.vault?.delete(cred.key_ref);
      } catch {
        return { ...conn, key_forget_failed: true };
      }
    }
    return conn;
  }

  /** Reads who the credential belongs to; only the configured owner activates the connection. */
  async verify(ctx: CommandContext, ws: string, id: string) {
    const conn = await this.store.connectionForVerification(ctx, ws, id);
    const a = await this.#need(conn);
    const who = await a.identity();
    const cls = classifyResponse(who.response);
    const refusal =
      cls.state === 'succeeded'
        ? who.identity
          ? null
          : {
              reason_code: 'identity_unreadable',
              explanation: 'GitHub returned no account.',
            }
        : { reason_code: cls.reason_code, explanation: cls.explanation };
    const included = [];
    if (!refusal)
      for (const r of conn.body.included_repositories) {
        const o = await a.repositoryById(r.github_id);
        if (o) included.push(observed(o)!);
      }
    return this.store.recordGitHubVerification(ctx, ws, id, {
      identity: who.identity,
      token_expires_at: who.token_expires_at,
      refusal,
      included,
    });
  }

  async operate(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<GitHubOperation> {
    const { req, connection, repository } =
      await this.store.prepareGitHubOperation(ctx, ws, raw);
    const a = await this.#adapter(connection);
    const p = req.params;
    const obs: GitHubObservations = {};
    let paths: string[] | null = null;
    let source: string | null = null;
    // Without an adapter nothing is read; the store records the refusal (live disabled).
    if (a && connection.status === 'active') {
      if (repository) {
        obs.repository = observed(await a.repositoryById(repository.github_id));
      }
      const ref = this.#ref(repository, obs);
      if (p.kind === 'push' && ref) {
        source = await this.opts.pushSource(p.product_id, ws);
        try {
          paths = await changedPaths(source, p.base_sha, p.sha);
        } catch (e) {
          throw new ContractError(
            'EVIDENCE_MISMATCH',
            e instanceof TooManyPathsError
              ? `${e.message} Push fewer changes at a time; a new branch lists every file it holds, so push a large repository's first commit outside the studio.`
              : 'The commit or its base is not in the product’s local repository.',
          );
        }
        obs.remote_head = await a.branchSha(ref, p.branch);
      }
      if (p.kind === 'pr_merge' && ref) {
        obs.pull = await a.pull(ref, p.pr_number);
        if (obs.pull) {
          const c = await a.checks(ref, obs.pull.head_sha);
          obs.checks = c.checks;
          obs.check_runs_readable = c.check_runs_readable;
        }
      }
    }
    const begun = await this.store.beginGitHubOperation(ctx, ws, {
      req,
      observations: obs,
      changed_paths: paths,
      live_enabled: this.liveEnabled,
    });
    if (!begun.dispatch || !a) return begun.operation;
    const op = begun.operation;
    let res: GitHubResponse;
    try {
      res = await this.#send(a, begun.connection, begun.repository, op, source);
    } catch (e) {
      res = {
        status: null,
        headers: {},
        data: null,
        message: (e as Error).message.slice(0, 200),
      };
    }
    const cls = appTokenWording(
      refusalWording(classifyResponse(res), p.kind, begun.connection, res),
      res,
    );
    const data =
      cls.state === 'succeeded'
        ? p.kind === 'repo_create'
          ? createdRepository(res.data)
          : res.data
        : githubAnswer(res);
    return this.store.finishGitHubOperation(ctx, ws, op.id, cls, data);
  }
  #ref(repo: GitHubRepository | null, obs: GitHubObservations): RepoRef | null {
    if (!repo) return null;
    return {
      github_id: repo.github_id,
      full_name: obs.repository?.full_name ?? repo.full_name,
    };
  }
  async #send(
    a: GitHubAdapter,
    conn: GitHubConnection,
    repo: GitHubRepository | null,
    op: GitHubOperation,
    source: string | null,
  ): Promise<GitHubResponse> {
    const p = op.params;
    const ref = repo && {
      github_id: repo.github_id,
      full_name: repo.full_name,
    };
    switch (p.kind) {
      case 'repo_create':
        return a.createRepository(conn.body.owner, p.name, p.description);
      case 'branch_create':
        return a.createBranch(ref!, p.branch, p.from_sha);
      case 'push':
        return a.push(
          ref!,
          p.branch,
          p.sha,
          source!,
          op.action_type === 'github.workflow_change',
        );
      case 'issue_create':
        return a.createIssue(ref!, p.title, p.body);
      case 'pr_open':
        return a.openPull(ref!, p.head_branch, p.base_branch, p.title, p.body);
      case 'pr_merge':
        return a.merge(ref!, p.pr_number, p.reviewed_head_sha, p.merge_method);
    }
  }

  /**
   * P22: reads one pull request and the checks on its current head. Read-only: no operation is
   * journaled, nothing is admitted and nothing on GitHub changes.
   */
  async pullChecks(
    ctx: CommandContext,
    ws: string,
    repositoryId: string,
    number: number,
  ): Promise<GitHubPullChecks> {
    const { connection, repository } = await this.store.repositoryForRead(
      ctx,
      ws,
      repositoryId,
    );
    const a = await this.#need(connection);
    const looked = await a.repositoryRead(repository.github_id);
    if (!looked.repository)
      return {
        repository_id: repository.id,
        read_at: new Date().toISOString(),
        pull: null,
        checks: [],
        check_runs_readable:
          connection.body.credential.kind !== 'fine_grained_pat',
        refusals: looked.refusal ? [looked.refusal] : [],
      };
    const ref = {
      github_id: repository.github_id,
      full_name: looked.repository.full_name,
    };
    const read = await a.pullRead(ref, number);
    const c = read.pull
      ? await a.checks(ref, read.pull.head_sha)
      : {
          checks: [],
          check_runs_readable:
            connection.body.credential.kind !== 'fine_grained_pat',
          refusals: [],
        };
    return {
      repository_id: repository.id,
      read_at: new Date().toISOString(),
      pull: read.pull,
      checks: c.checks,
      check_runs_readable: c.check_runs_readable,
      refusals: [...(read.refusal ? [read.refusal] : []), ...c.refusals],
    };
  }

  /** Reads GitHub to settle an unknown outcome; never repeats the change itself. */
  async reconcile(ctx: CommandContext, ws: string, id: string) {
    const {
      operation: op,
      connection,
      repository,
    } = await this.store.operationForReconcile(ctx, ws, id);
    const a = await this.#need(connection);
    const p = op.params;
    const since = new Date(Date.parse(op.created_at) - 60_000).toISOString();
    const ref = repository && {
      github_id: repository.github_id,
      full_name:
        (await a.repositoryById(repository.github_id))?.full_name ??
        repository.full_name,
    };
    let found: {
      exists: boolean;
      data: Record<string, unknown> | null;
      note: string;
    };
    switch (p.kind) {
      case 'repo_create': {
        const o = await a.repositoryByName(
          `${connection.body.owner.login}/${p.name}`,
        );
        const ours =
          o !== null &&
          (o.created_at === null ||
            Date.parse(o.created_at) >= Date.parse(since));
        found = ours
          ? {
              exists: true,
              data: repoData(o!),
              note: `Found ${o!.full_name} (id ${o!.github_id}).`,
            }
          : {
              exists: false,
              data: null,
              note: o
                ? 'A repository with that name predates this operation; it is not adopted.'
                : 'No such repository exists.',
            };
        break;
      }
      case 'branch_create':
      case 'push': {
        const want = p.kind === 'push' ? p.sha : p.from_sha;
        const head = await a.branchSha(ref!, p.branch);
        found = {
          exists: head === want,
          data:
            head === want ? { ref: `refs/heads/${p.branch}`, sha: head } : null,
          note: `The branch is at ${head?.slice(0, 12) ?? 'nothing'}.`,
        };
        break;
      }
      case 'issue_create': {
        const n = await a.findIssue(ref!, p.title, since);
        found = {
          exists: n !== null,
          data: n === null ? null : { number: n },
          note: n === null ? 'No matching issue.' : `Issue #${n} exists.`,
        };
        break;
      }
      case 'pr_open': {
        const n = await a.findOpenPull(ref!, p.head_branch);
        found = {
          exists: n !== null,
          data: n === null ? null : { number: n },
          note:
            n === null
              ? 'No open pull request from that branch.'
              : `PR #${n} is open.`,
        };
        break;
      }
      case 'pr_merge': {
        const pull = await a.pull(ref!, p.pr_number);
        if (!pull)
          throw new ContractError(
            'EVIDENCE_MISMATCH',
            'GitHub did not return the pull request; the merge stays unknown.',
          );
        const exists = pull.merged && pull.head_sha === p.reviewed_head_sha;
        found = {
          exists,
          data: exists ? { merged: true, sha: pull.merge_commit_sha } : null,
          note: pull.merged
            ? `Merged at head ${pull.head_sha.slice(0, 12)}.`
            : 'The pull request is not merged.',
        };
        break;
      }
    }
    return this.store.reconcileGitHubOperation(ctx, ws, id, found);
  }

  /**
   * Verifies X-Hub-Signature-256 with the connection's secret, then records the delivery
   * once per X-GitHub-Delivery. Returns the HTTP status to answer with.
   */
  async receiveWebhook(
    ctx: CommandContext,
    connectionId: string,
    h: {
      event: string | undefined;
      delivery: string | undefined;
      signature: string | undefined;
    },
    raw: Buffer,
  ): Promise<{ status: number; body: unknown }> {
    const target = await this.store.githubWebhookTarget(connectionId);
    const secret = target?.secret_env
      ? this.opts.env[target.secret_env]
      : undefined;
    if (!target || !secret)
      return {
        status: 404,
        body: { error: { code: 'NOT_FOUND', message: 'No webhook here.' } },
      };
    if (!h.event || !h.delivery || !/^[A-Za-z0-9-]{1,100}$/.test(h.delivery))
      return {
        status: 400,
        body: {
          error: {
            code: 'INVALID_CONTRACT',
            message: 'Missing GitHub delivery headers.',
          },
        },
      };
    const valid = webhookSignatureValid(secret, raw, h.signature);
    let payload: unknown = null;
    if (valid)
      try {
        payload = JSON.parse(raw.toString('utf8')) as unknown;
      } catch {
        return {
          status: 400,
          body: {
            error: { code: 'INVALID_CONTRACT', message: 'Malformed JSON.' },
          },
        };
      }
    const r = await this.store.recordGitHubDelivery(ctx, connectionId, {
      delivery_id: h.delivery,
      event: h.event,
      payload,
      payload_hash: createHash('sha256').update(raw).digest('hex'),
      signature_valid: valid,
    });
    return valid
      ? {
          status: 200,
          body: { duplicate: r.duplicate, effects: r.delivery.effects },
        }
      : {
          status: 401,
          body: {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Signature does not match.',
            },
          },
        };
  }
}
