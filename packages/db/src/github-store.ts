import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  GITHUB_POLICY_VERSION,
  ConnectGitHubAppSetupRequestSchema,
  GITHUB_APP_SETUP_MS,
  GitHubOperationRequestSchema,
  RecordGitHubReviewRequestSchema,
  RegisterGitHubConnectionRequestSchema,
  RevokeGitHubConnectionRequestSchema,
  parse,
  type CheckObservation,
  type GitHubAppSetup,
  type GitHubConnection,
  type GitHubConnectionBody,
  type GitHubDelivery,
  type GitHubIdentity,
  type GitHubOperation,
  type GitHubOperationRequest,
  type GitHubRepository,
  type GitHubReview,
  type PullObservation,
} from '@creator/contracts';
import {
  canonicalHash,
  githubActionType,
  githubIntentHash,
  identityRefusal,
  limitRefusal,
  mergeRefusal,
  webhookEffects,
  type Refusal,
  type ResponseClass,
} from '@creator/domain';
import { ArtifactStore } from './artifact-store.js';
import {
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

const toConnection = (r: Row): GitHubConnection => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  fixture: Boolean(r.fixture),
  version: Number(r.version),
  status: r.status as GitHubConnection['status'],
  body: r.body as GitHubConnection['body'],
  body_hash: String(r.body_hash),
  verification: (r.verification ?? null) as GitHubConnection['verification'],
  status_reason: r.status_reason === null ? null : String(r.status_reason),
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});
const toRepository = (r: Row): GitHubRepository => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  connection_id: String(r.connection_id),
  github_id: Number(r.github_id),
  owner_id: Number(r.owner_id),
  full_name: String(r.full_name),
  default_branch: String(r.default_branch),
  origin: r.origin as GitHubRepository['origin'],
  status: r.status as GitHubRepository['status'],
  status_reason: r.status_reason === null ? null : String(r.status_reason),
  created_operation_id:
    r.created_operation_id === null ? null : String(r.created_operation_id),
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});
const toOperation = (r: Row): GitHubOperation => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  connection_id: String(r.connection_id),
  run_id: String(r.run_id),
  kind: String(r.kind),
  action_type: r.action_type === null ? null : String(r.action_type),
  repository_id: r.repository_id === null ? null : String(r.repository_id),
  params: r.params as GitHubOperation['params'],
  intent_hash: String(r.intent_hash),
  admission_id: r.admission_id === null ? null : String(r.admission_id),
  state: r.state as GitHubOperation['state'],
  reason_code: String(r.reason_code),
  explanation: String(r.explanation),
  gate: (r.gate ?? null) as GitHubOperation['gate'],
  result: (r.result ?? null) as GitHubOperation['result'],
  fixture: Boolean(r.fixture),
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  updated_at: iso(r.updated_at),
});
const toReview = (r: Row): GitHubReview => ({
  id: String(r.id),
  workspace_id: String(r.workspace_id),
  repository_id: String(r.repository_id),
  pr_number: Number(r.pr_number),
  head_sha: String(r.head_sha),
  verdict: r.verdict as GitHubReview['verdict'],
  note: String(r.note),
  reviewer_id: String(r.reviewer_id),
  created_at: iso(r.created_at),
});
const toDelivery = (r: Row): GitHubDelivery => ({
  id: String(r.id),
  connection_id: String(r.connection_id),
  delivery_id: String(r.delivery_id),
  event: String(r.event),
  action: r.action === null ? null : String(r.action),
  payload_hash: String(r.payload_hash),
  status: r.status as GitHubDelivery['status'],
  effects: r.effects as string[],
  received_at: iso(r.received_at),
});

const toSetup = (r: Row): GitHubAppSetup => {
  const status = r.status as GitHubAppSetup['status'];
  const stale =
    status === 'waiting_for_github' &&
    Date.now() - new Date(r.created_at as string).getTime() >
      GITHUB_APP_SETUP_MS;
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    // A handshake GitHub no longer accepts reads as expired before anything writes it.
    status: stale ? 'expired' : status,
    organization: r.organization === null ? null : String(r.organization),
    app: (r.app ?? null) as GitHubAppSetup['app'],
    installation: (r.installation ?? null) as GitHubAppSetup['installation'],
    connection_id: r.connection_id === null ? null : String(r.connection_id),
    failure: r.failure === null ? null : String(r.failure),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
};
const OPEN_SETUP = ['waiting_for_github', 'app_created', 'installed'];

/** What GitHubService read from GitHub just before a repository-scoped operation. */
export interface GitHubObservations {
  repository?: {
    github_id: number;
    owner_id: number;
    full_name: string;
    private: boolean;
    default_branch: string;
  } | null;
  pull?: PullObservation | null;
  checks?: CheckObservation[];
  check_runs_readable?: boolean;
  /** The remote branch head a push would move (null: the branch does not exist). */
  remote_head?: string | null;
}
export interface BeginGitHubOperation {
  operation: GitHubOperation;
  /** False when nothing may be sent: refused, or a replayed request. */
  dispatch: boolean;
  repository: GitHubRepository | null;
  connection: GitHubConnection;
}
export type GitHubOutcome =
  ResponseClass | { state: 'succeeded'; data: Record<string, unknown> | null };
/** A dispatched operation older than this lost its process and is treated as unknown. */
const STALE_DISPATCH_MS = 120_000;
const repoKinds = new Set([
  'branch_create',
  'push',
  'issue_create',
  'pr_open',
  'pr_merge',
]);

/**
 * X04 scoped GitHub management. Connections, managed repositories, the operation journal,
 * reviews and webhook deliveries. Every mutation is recorded as an intent, admitted under the
 * run's grants with its intent hash as spec_hash, and settled exactly once; outcomes GitHub
 * did not confirm stay unknown until reconciled by reading GitHub again.
 */
export class GitHubStore extends ArtifactStore {
  async #workspaceFixture(c: PoolClient, ws: string) {
    const { rows } = await c.query<{ fixture: boolean }>(
      'select fixture from workspaces where id = $1',
      [ws],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Workspace not found.');
    return rows[0].fixture;
  }
  async #connection(c: PoolClient, ws: string, id: string, lock = false) {
    const { rows } = await c.query(
      `select * from github_connections where workspace_id = $1 and id = $2${lock ? ' for update' : ''}`,
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'GitHub connection not found.');
    return toConnection(rows[0] as Row);
  }
  async #repository(c: PoolClient, ws: string, id: string, lock = false) {
    const { rows } = await c.query(
      `select * from github_repositories where workspace_id = $1 and id = $2${lock ? ' for update' : ''}`,
      [ws, uuid(id)],
    );
    if (!rows[0])
      throw fail(
        'NOT_FOUND',
        'Repository not found; only studio-managed repositories can be used.',
      );
    return toRepository(rows[0] as Row);
  }
  async #setConnection(
    c: PoolClient,
    ctx: CommandContext,
    conn: GitHubConnection,
    status: GitHubConnection['status'],
    reason: string | null,
    verification?: GitHubConnection['verification'],
    extra?: Record<string, unknown>,
  ) {
    const { rows } = await c.query(
      `update github_connections set status = $2, status_reason = $3,
         verification = coalesce($4::jsonb, verification), version = version + 1,
         updated_at = clock_timestamp() where id = $1 returning *`,
      [
        conn.id,
        status,
        reason,
        verification ? JSON.stringify(verification) : null,
      ],
    );
    const next = toConnection(rows[0] as Row);
    if (status !== conn.status)
      await this.append(c, ctx, {
        workspaceId: conn.workspace_id,
        action: `github.connection_${status}`,
        subjectKind: 'github_connection',
        subjectId: conn.id,
        subjectVersion: next.version,
        contentHash: conn.body_hash,
        payload: { from: conn.status, to: status, reason, ...extra },
      });
    return next;
  }
  async #setRepository(
    c: PoolClient,
    ctx: CommandContext,
    repo: GitHubRepository,
    next: {
      status?: GitHubRepository['status'];
      reason?: string | null;
      full_name?: string;
      default_branch?: string;
    },
  ) {
    // A quarantined repository stays quarantined; only the owner can look at it again.
    const status =
      repo.status === 'quarantined'
        ? 'quarantined'
        : (next.status ?? repo.status);
    const { rows } = await c.query(
      `update github_repositories set status = $2, status_reason = $3, full_name = $4,
         default_branch = $5, updated_at = clock_timestamp() where id = $1 returning *`,
      [
        repo.id,
        status,
        next.reason !== undefined && status !== repo.status
          ? next.reason
          : repo.status_reason,
        next.full_name ?? repo.full_name,
        next.default_branch ?? repo.default_branch,
      ],
    );
    const updated = toRepository(rows[0] as Row);
    if (status !== repo.status || updated.full_name !== repo.full_name)
      await this.append(c, ctx, {
        workspaceId: repo.workspace_id,
        action:
          status !== repo.status
            ? `github.repository_${status}`
            : 'github.repository_renamed',
        subjectKind: 'github_repository',
        subjectId: repo.id,
        subjectVersion: null,
        contentHash: null,
        payload: {
          github_id: repo.github_id,
          from: repo.full_name,
          to: updated.full_name,
          reason: updated.status_reason,
        },
      });
    return updated;
  }
  async #insertRepository(
    c: PoolClient,
    ctx: CommandContext,
    conn: GitHubConnection,
    obs: NonNullable<GitHubObservations['repository']>,
    origin: GitHubRepository['origin'],
    operationId: string | null,
  ) {
    const problems: string[] = [];
    if (obs.owner_id !== conn.body.owner.id)
      problems.push('it belongs to a different owner');
    if (!obs.private) problems.push('it is not private');
    const existing = await c.query(
      'select * from github_repositories where connection_id = $1 and github_id = $2',
      [conn.id, obs.github_id],
    );
    if (existing.rows[0]) return toRepository(existing.rows[0] as Row);
    const { rows } = await c.query(
      `insert into github_repositories (id, workspace_id, connection_id, github_id, owner_id,
         full_name, default_branch, origin, status, status_reason, created_operation_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) returning *`,
      [
        randomUUID(),
        conn.workspace_id,
        conn.id,
        obs.github_id,
        obs.owner_id,
        obs.full_name,
        obs.default_branch,
        origin,
        problems.length ? 'quarantined' : 'active',
        problems.length ? `Quarantined: ${problems.join(' and ')}.` : null,
        operationId,
      ],
    );
    const repo = toRepository(rows[0] as Row);
    await this.append(c, ctx, {
      workspaceId: conn.workspace_id,
      action:
        repo.status === 'active'
          ? `github.repository_${origin}`
          : 'github.repository_quarantined',
      subjectKind: 'github_repository',
      subjectId: repo.id,
      subjectVersion: null,
      contentHash: null,
      payload: {
        github_id: repo.github_id,
        full_name: repo.full_name,
        connection_id: conn.id,
        reason: repo.status_reason,
      },
      relatedIds: operationId ? [operationId] : [],
    });
    return repo;
  }

  // ---- Connections ----------------------------------------------------------------------

  async registerGitHubConnection(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<GitHubConnection> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const body = parse(RegisterGitHubConnectionRequestSchema, raw);
    // ADR-0132: only the in-app setup names a vault key, so a request cannot point a new
    // connection at a key another setup sealed.
    if (body.credential.kind === 'app_vault')
      throw fail(
        'SCOPE_EXCEEDED',
        'A GitHub App created in the studio is connected from its setup.',
      );
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      return this.#insertConnection(c, ctx, ws, body);
    });
  }
  async #insertConnection(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    body: GitHubConnectionBody,
  ) {
    const bodyHash = canonicalHash(body);
    const fixture = await this.#workspaceFixture(c, ws);
    if (fixture !== (body.mode === 'fixture'))
      throw fail(
        'SCOPE_EXCEEDED',
        fixture
          ? 'A fixture workspace can only hold a fixture GitHub connection.'
          : 'A real workspace cannot hold a fixture GitHub connection.',
      );
    const { rows } = await c.query(
      `insert into github_connections (id, workspace_id, fixture, version, status, body,
         body_hash, created_by) values ($1,$2,$3,1,'unverified',$4,$5,$6) returning *`,
      [randomUUID(), ws, fixture, JSON.stringify(body), bodyHash, ctx.actorId],
    );
    const conn = toConnection(rows[0] as Row);
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'github.connection_registered',
      subjectKind: 'github_connection',
      subjectId: conn.id,
      subjectVersion: 1,
      contentHash: bodyHash,
      payload: {
        owner: body.owner,
        credential_kind: body.credential.kind,
        mode: body.mode,
        policy_version: GITHUB_POLICY_VERSION,
      },
    });
    return conn;
  }
  async listGitHubConnections(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from github_connections where workspace_id = $1 order by created_at, id',
        [ws],
      );
      return rows.map((r: Row) => toConnection(r));
    });
  }
  async getGitHubConnection(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.#connection(c, ws, id);
    });
  }
  /** Owner check before verification; returns the connection for GitHubService to read. */
  async connectionForVerification(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const conn = await this.#connection(c, ws, id);
      if (conn.status === 'revoked')
        throw fail('INVALID_TRANSITION', 'This connection was revoked.');
      return conn;
    });
  }
  /**
   * Records what the credential's account actually is. Only an exact owner match (immutable
   * id and type) activates the connection; included repositories must be the owner's and
   * private, or they stay outside scope.
   */
  async recordGitHubVerification(
    ctx: CommandContext,
    ws: string,
    id: string,
    v: {
      identity: GitHubIdentity | null;
      token_expires_at: string | null;
      refusal: Refusal | null;
      included: NonNullable<GitHubObservations['repository']>[];
    },
  ): Promise<{
    connection: GitHubConnection;
    repositories: GitHubRepository[];
  }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const conn = await this.#connection(c, ws, id, true);
      if (conn.status === 'revoked')
        throw fail('INVALID_TRANSITION', 'This connection was revoked.');
      const mismatch =
        v.refusal ??
        (v.identity ? identityRefusal(conn.body.owner, v.identity) : null);
      const result = v.refusal ? 'refused' : mismatch ? 'wrong_owner' : 'match';
      const verification = {
        checked_at: new Date().toISOString(),
        result,
        observed: v.identity,
        reason:
          mismatch?.explanation ??
          'The credential belongs to the configured owner.',
        token_expires_at: v.token_expires_at,
      } as const;
      const status =
        result === 'match'
          ? 'active'
          : v.refusal?.reason_code === 'credential_rejected'
            ? 'credential_rejected'
            : 'unverified';
      const next = await this.#setConnection(
        c,
        ctx,
        conn,
        status,
        mismatch?.explanation ?? null,
        verification,
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'github.connection_verified',
        subjectKind: 'github_connection',
        subjectId: conn.id,
        subjectVersion: next.version,
        contentHash: conn.body_hash,
        payload: {
          result,
          observed: v.identity,
          reason_code: mismatch?.reason_code ?? null,
        },
      });
      const repositories: GitHubRepository[] = [];
      if (result === 'match')
        for (const inc of conn.body.included_repositories) {
          const obs = v.included.find((o) => o.github_id === inc.github_id);
          if (obs)
            repositories.push(
              await this.#insertRepository(c, ctx, next, obs, 'included', null),
            );
        }
      return { connection: next, repositories };
    });
  }
  async revokeGitHubConnection(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RevokeGitHubConnectionRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const conn = await this.#connection(c, ws, id, true);
      if (conn.version !== req.expected_version)
        throw fail('VERSION_CONFLICT', 'The connection changed; reload it.');
      if (conn.status === 'revoked') return conn;
      return this.#setConnection(
        c,
        ctx,
        conn,
        'revoked',
        req.reason,
        undefined,
        // Review L-4: GitHubService deletes a studio-created app's sealed key after this.
        conn.body.credential.kind === 'app_vault'
          ? { app_key: 'forgotten_on_revoke' }
          : undefined,
      );
    });
  }
  async listGitHubRepositories(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from github_repositories where workspace_id = $1 order by created_at, id',
        [ws],
      );
      return rows.map((r: Row) => toRepository(r));
    });
  }

  /**
   * P22: owner check before a read-only look at a pull request's checks. The repository must
   * be studio-managed, active and on an active connection; nothing is recorded or changed.
   */
  async repositoryForRead(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const repository = await this.#repository(c, ws, id);
      const connection = await this.#connection(
        c,
        ws,
        repository.connection_id,
      );
      if (repository.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          `This repository is ${repository.status.replace('_', ' ')}; it is not read again.`,
        );
      if (connection.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          'Its connection is not active; verify it first.',
        );
      return { connection, repository };
    });
  }

  // ---- Operations -----------------------------------------------------------------------

  /** Validates a request and returns what GitHubService must read before beginning it. */
  async prepareGitHubOperation(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<{
    req: GitHubOperationRequest;
    connection: GitHubConnection;
    repository: GitHubRepository | null;
  }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(GitHubOperationRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const connection = await this.#connection(c, ws, req.connection_id);
      const p = req.params;
      const repository =
        'repository_id' in p
          ? await this.#repository(c, ws, p.repository_id)
          : null;
      if (repository && repository.connection_id !== connection.id)
        throw fail(
          'SCOPE_EXCEEDED',
          'That repository belongs to another connection.',
        );
      return { req, connection, repository };
    });
  }

  /**
   * Records the intent, checks connection state, scope and limits, runs the merge gate on
   * fresh observations, and admits the action under the run's grants, all in one transaction.
   * Only a `dispatch: true` result may be sent to GitHub.
   */
  async beginGitHubOperation(
    ctx: CommandContext,
    ws: string,
    input: {
      req: GitHubOperationRequest;
      observations: GitHubObservations;
      changed_paths: string[] | null;
      live_enabled: boolean;
    },
  ): Promise<BeginGitHubOperation> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const { req, observations: obs } = input;
    const p = req.params;
    const key = ctx.idempotencyKey ?? null;
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      // The connection row lock serializes counts and rate checks for this connection.
      const conn = await this.#connection(c, ws, req.connection_id, true);
      const run = await c.query(
        'select 1 from run_controls where workspace_id = $1 and run_id = $2',
        [ws, uuid(req.run_id)],
      );
      if (!run.rows[0]) throw fail('NOT_FOUND', 'Run not found.');
      let repo =
        'repository_id' in p
          ? await this.#repository(c, ws, p.repository_id, true)
          : null;
      if (repo && repo.connection_id !== conn.id)
        throw fail(
          'SCOPE_EXCEEDED',
          'That repository belongs to another connection.',
        );
      const fixture = await this.#workspaceFixture(c, ws);
      if (key !== null) {
        const prior = await c.query(
          'select * from github_operations where workspace_id = $1 and idempotency_key = $2',
          [ws, key],
        );
        if (prior.rows[0]) {
          const op = toOperation(prior.rows[0] as Row);
          if (
            canonicalHash({
              actor: op.created_by,
              run: op.run_id,
              params: op.params,
            }) !==
            canonicalHash({ actor: ctx.actorId, run: req.run_id, params: p })
          )
            throw fail(
              'IDEMPOTENCY_CONFLICT',
              'Idempotency key was already used for a different request.',
            );
          return {
            operation: op,
            dispatch: false,
            repository: repo,
            connection: conn,
          };
        }
      }
      // Fresh observations of the repository: renames follow the immutable id; another
      // owner or a public repository is quarantined, never used.
      if (repo && obs.repository) {
        if (obs.repository.github_id !== repo.github_id)
          throw fail(
            'EVIDENCE_MISMATCH',
            'Observation is for another repository.',
          );
        const problem =
          obs.repository.owner_id !== repo.owner_id
            ? 'The repository now belongs to another owner.'
            : !obs.repository.private
              ? 'The repository is no longer private.'
              : null;
        repo = await this.#setRepository(c, ctx, repo, {
          ...(problem ? { status: 'quarantined', reason: problem } : {}),
          full_name: obs.repository.full_name,
          default_branch: obs.repository.default_branch,
        });
      }
      let gate: Record<string, unknown> | null = null;
      let review: GitHubReview | null = null;
      const refusal = await (async (): Promise<Refusal | null> => {
        if (conn.status !== 'active')
          return {
            reason_code: `connection_${conn.status}`,
            explanation:
              conn.status === 'unverified'
                ? 'The connection has not been verified against its owner.'
                : `The connection is ${conn.status.replaceAll('_', ' ')}${conn.status_reason ? `: ${conn.status_reason}` : '.'}`,
          };
        const cred = conn.body.credential;
        const expires =
          cred.kind === 'fine_grained_pat'
            ? Math.min(
                Date.parse(cred.expires_at),
                conn.verification?.token_expires_at
                  ? Date.parse(conn.verification.token_expires_at)
                  : Infinity,
              )
            : Infinity;
        if (expires <= Date.now())
          return {
            reason_code: 'credential_expired',
            explanation:
              'The connection’s token has expired; nothing was sent.',
          };
        if (!fixture && !input.live_enabled)
          return {
            reason_code: 'live_disabled',
            explanation:
              'Live GitHub is off on this API process (CREATOR_GITHUB=live is not set).',
          };
        if (repoKinds.has(p.kind)) {
          if (!repo)
            return {
              reason_code: 'repository_missing',
              explanation: 'No repository.',
            };
          if (repo.status !== 'active')
            return {
              reason_code: `repository_${repo.status}`,
              explanation:
                repo.status_reason ?? `The repository is ${repo.status}.`,
            };
          if (obs.repository === null)
            return {
              reason_code: 'repository_unreadable',
              explanation:
                'GitHub did not return this repository by its id just now; nothing was sent.',
            };
        }
        const counts = await c.query<{
          created: string;
          unknown_creates: string;
          last_hour: string;
          same_intent: string;
        }>(
          `select
             (select count(*) from github_repositories where connection_id = $1 and origin = 'created')::text as created,
             count(*) filter (where kind = 'repo_create' and state in ('dispatched','unknown'))::text as unknown_creates,
             count(*) filter (where state <> 'refused' and created_at > clock_timestamp() - interval '1 hour')::text as last_hour,
             count(*) filter (where state in ('dispatched','unknown') and params = $2::jsonb)::text as same_intent
           from github_operations where connection_id = $1`,
          [conn.id, JSON.stringify(p)],
        );
        const k = counts.rows[0]!;
        const open = repo
          ? await c.query<{ n: string }>(
              `select count(*)::text as n from github_pull_requests where repository_id = $1 and state = 'open'`,
              [repo.id],
            )
          : null;
        const limit = limitRefusal({
          body: conn.body,
          params: p,
          createdRepositories: Number(k.created),
          unknownCreates: Number(k.unknown_creates),
          mutationsLastHour: Number(k.last_hour),
          unknownSameIntent: Number(k.same_intent),
          openPullRequests: Number(open?.rows[0]?.n ?? 0),
        });
        if (limit) return limit;
        if (p.kind === 'push') {
          if (obs.remote_head === undefined)
            return {
              reason_code: 'remote_unread',
              explanation: 'The remote branch was not read.',
            };
          if (obs.remote_head !== p.base_sha)
            return {
              reason_code: 'stale_base',
              explanation: `The remote branch is at ${obs.remote_head?.slice(0, 12) ?? 'nothing'}, not the stated base.`,
            };
          gate = {
            remote_head: obs.remote_head,
            changed_paths: input.changed_paths,
          };
        }
        if (p.kind === 'pr_merge') {
          if (!obs.pull)
            return {
              reason_code: 'pull_unreadable',
              explanation: 'GitHub did not return the pull request just now.',
            };
          const reviews = await c.query(
            `select * from github_reviews where repository_id = $1 and pr_number = $2
               and head_sha = $3 order by created_at desc, id desc limit 1`,
            [repo!.id, p.pr_number, obs.pull.head_sha],
          );
          review = reviews.rows[0] ? toReview(reviews.rows[0] as Row) : null;
          const authors = await c.query<{ created_by: string }>(
            `select distinct created_by::text from github_operations where repository_id = $1
               and kind = 'push' and state in ('succeeded','reconciled_succeeded')
               and params->>'sha' = $2`,
            [repo!.id, obs.pull.head_sha],
          );
          gate = {
            pull: obs.pull,
            checks: obs.checks ?? [],
            check_runs_readable: obs.check_runs_readable ?? false,
            required_checks: conn.body.required_checks,
            review_id: review?.id ?? null,
          };
          return mergeRefusal({
            params: p,
            pull: obs.pull,
            requiredChecks: conn.body.required_checks,
            checks: obs.checks ?? [],
            checkRunsReadable: obs.check_runs_readable ?? false,
            review,
            headAuthors: authors.rows.map((r) => r.created_by),
          });
        }
        return null;
      })();
      const actionType = githubActionType(p, input.changed_paths);
      const intent = githubIntentHash({
        connection_id: conn.id,
        repository_github_id: repo?.github_id ?? null,
        params: p,
        changed_paths: input.changed_paths,
        required_checks:
          p.kind === 'pr_merge' ? conn.body.required_checks : null,
        review_id: review ? (review as GitHubReview).id : null,
      });
      const id = randomUUID();
      const insert = async (
        state: 'refused' | 'dispatched',
        reason: Refusal,
        admissionId: string | null,
      ) => {
        const { rows } = await c.query(
          `insert into github_operations (id, workspace_id, fixture, connection_id, run_id, kind,
             action_type, repository_id, params, intent_hash, idempotency_key, admission_id, state,
             reason_code, explanation, gate, created_by)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) returning *`,
          [
            id,
            ws,
            fixture,
            conn.id,
            uuid(req.run_id),
            p.kind,
            actionType,
            repo?.id ?? null,
            JSON.stringify(p),
            intent,
            key,
            admissionId,
            state,
            reason.reason_code,
            reason.explanation.slice(0, 1200),
            gate ? JSON.stringify(gate) : null,
            ctx.actorId,
          ],
        );
        const op = toOperation(rows[0] as Row);
        await this.append(c, ctx, {
          workspaceId: ws,
          action: `github.operation_${state}`,
          subjectKind: 'github_operation',
          subjectId: id,
          subjectVersion: null,
          contentHash: intent,
          payload: {
            kind: p.kind,
            action_type: actionType,
            reason_code: reason.reason_code,
            repository_github_id: repo?.github_id ?? null,
          },
          relatedIds: [
            conn.id,
            op.run_id,
            ...(repo ? [repo.id] : []),
            ...(admissionId ? [admissionId] : []),
          ],
        });
        return op;
      };
      if (refusal) {
        // The run must exist even for a refusal; foreign keys enforce it.
        return {
          operation: await insert('refused', refusal, null),
          dispatch: false,
          repository: repo,
          connection: conn,
        };
      }
      const subject =
        p.kind === 'repo_create'
          ? `create private repository ${conn.body.owner.login}/${p.name}`
          : p.kind === 'pr_merge'
            ? `merge PR #${p.pr_number} in ${repo!.full_name} at ${p.reviewed_head_sha.slice(0, 12)}`
            : `${p.kind.replace('_', ' ')} in ${repo!.full_name}`;
      const admission = await this.admitIn(
        c,
        ctx,
        ws,
        uuid(req.run_id),
        {
          action_type: actionType,
          task_id: req.task_id,
          target: null,
          spec_hash: intent,
          amount_nano_usd: null,
          data_class: req.data_class,
          assumption_ids: [],
          humility_review: null,
          flags: [],
          justification: `${subject}: ${req.justification}`.slice(0, 1200),
        },
        subject,
      );
      if (admission.outcome !== 'admitted')
        return {
          operation: await insert(
            'refused',
            {
              reason_code: `admission_${admission.outcome}`,
              explanation: admission.explanation,
            },
            admission.id,
          ),
          dispatch: false,
          repository: repo,
          connection: conn,
        };
      return {
        operation: await insert(
          'dispatched',
          {
            reason_code: 'dispatched',
            explanation: 'Admitted; sent to GitHub.',
          },
          admission.id,
        ),
        dispatch: true,
        repository: repo,
        connection: conn,
      };
    });
  }

  async #applySuccess(
    c: PoolClient,
    ctx: CommandContext,
    op: GitHubOperation,
    data: Record<string, unknown> | null,
  ) {
    const conn = await this.#connection(
      c,
      op.workspace_id,
      op.connection_id,
      true,
    );
    const p = op.params;
    if (p.kind === 'repo_create') {
      const d = data ?? {};
      const owner = d.owner as Record<string, unknown> | undefined;
      if (typeof d.github_id !== 'number' || typeof owner?.id !== 'number')
        throw fail(
          'EVIDENCE_MISMATCH',
          'Repository creation returned no repository.',
        );
      await this.#insertRepository(
        c,
        ctx,
        conn,
        {
          github_id: d.github_id,
          owner_id: owner.id,
          full_name: String(d.full_name),
          private: d.private === true,
          default_branch: String(d.default_branch ?? 'main'),
        },
        'created',
        op.id,
      );
    }
    if (p.kind === 'pr_open' && typeof data?.number === 'number')
      await c.query(
        `insert into github_pull_requests (repository_id, number, workspace_id, head_branch,
           base_branch, state, opened_operation_id) values ($1,$2,$3,$4,$5,'open',$6)
         on conflict do nothing`,
        [
          op.repository_id,
          data.number,
          op.workspace_id,
          p.head_branch,
          p.base_branch,
          op.id,
        ],
      );
    if (p.kind === 'pr_merge')
      await c.query(
        `update github_pull_requests set state = 'merged', updated_at = clock_timestamp()
           where repository_id = $1 and number = $2`,
        [op.repository_id, p.pr_number],
      );
  }
  async #lockOperation(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      'select * from github_operations where workspace_id = $1 and id = $2 for update',
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'GitHub operation not found.');
    return toOperation(rows[0] as Row);
  }
  async #settle(
    c: PoolClient,
    ctx: CommandContext,
    op: GitHubOperation,
    state: GitHubOperation['state'],
    reason: Refusal,
    result: Record<string, unknown> | null,
  ) {
    const { rows } = await c.query(
      `update github_operations set state = $2, reason_code = $3, explanation = $4,
         result = $5, updated_at = clock_timestamp() where id = $1 returning *`,
      [
        op.id,
        state,
        reason.reason_code,
        reason.explanation.slice(0, 1200),
        result ? JSON.stringify(result) : null,
      ],
    );
    const next = toOperation(rows[0] as Row);
    await this.append(c, ctx, {
      workspaceId: op.workspace_id,
      action: `github.operation_${state}`,
      subjectKind: 'github_operation',
      subjectId: op.id,
      subjectVersion: null,
      contentHash: op.intent_hash,
      payload: {
        kind: op.kind,
        from: op.state,
        reason_code: reason.reason_code,
      },
      relatedIds: [
        op.connection_id,
        op.run_id,
        ...(op.repository_id ? [op.repository_id] : []),
      ],
    });
    return next;
  }

  /** Settles a dispatched operation exactly once with what GitHub answered. */
  async finishGitHubOperation(
    ctx: CommandContext,
    ws: string,
    id: string,
    outcome: GitHubOutcome,
    data: Record<string, unknown> | null = null,
  ): Promise<GitHubOperation> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const op = await this.#lockOperation(c, ws, id);
      if (op.state !== 'dispatched')
        throw fail(
          'INVALID_TRANSITION',
          `This operation is already ${op.state}.`,
        );
      if (outcome.state === 'succeeded') {
        await this.#applySuccess(c, ctx, op, data);
        return this.#settle(
          c,
          ctx,
          op,
          'succeeded',
          {
            reason_code: 'succeeded',
            explanation: 'GitHub confirmed the change.',
          },
          data,
        );
      }
      if (outcome.state === 'failed') {
        const conn = await this.#connection(c, ws, op.connection_id, true);
        if (
          outcome.reason_code === 'credential_rejected' &&
          conn.status === 'active'
        )
          await this.#setConnection(
            c,
            ctx,
            conn,
            'credential_rejected',
            outcome.explanation,
          );
        if (outcome.reason_code === 'not_accessible' && op.repository_id)
          await this.#setRepository(
            c,
            ctx,
            await this.#repository(c, ws, op.repository_id, true),
            { status: 'access_lost', reason: outcome.explanation },
          );
      }
      // P32 live trial: a failed or unknown operation keeps what GitHub answered (status,
      // message, step, rate-limit headers), so the record can tell a refusal from a rate limit.
      return this.#settle(c, ctx, op, outcome.state, outcome, data);
    });
  }

  /** An unknown (or abandoned dispatched) operation GitHubService may now read GitHub for. */
  async operationForReconcile(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const op = await this.#lockOperation(c, ws, id);
      const abandoned =
        op.state === 'dispatched' &&
        Date.now() - Date.parse(op.updated_at) > STALE_DISPATCH_MS;
      if (op.state !== 'unknown' && !abandoned)
        throw fail(
          'INVALID_TRANSITION',
          `Only unknown operations are reconciled; this one is ${op.state}.`,
        );
      const conn = await this.#connection(c, ws, op.connection_id);
      const repo = op.repository_id
        ? await this.#repository(c, ws, op.repository_id)
        : null;
      return { operation: op, connection: conn, repository: repo };
    });
  }
  /**
   * Settles an unknown outcome from a fresh read of GitHub: the effect exists (adopt it) or it
   * does not (the intent may be tried again as a new operation).
   */
  async reconcileGitHubOperation(
    ctx: CommandContext,
    ws: string,
    id: string,
    found: {
      exists: boolean;
      data: Record<string, unknown> | null;
      note: string;
    },
  ): Promise<GitHubOperation> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      let op = await this.#lockOperation(c, ws, id);
      if (op.state === 'dispatched') {
        if (Date.now() - Date.parse(op.updated_at) <= STALE_DISPATCH_MS)
          throw fail(
            'INVALID_TRANSITION',
            'This operation is still in flight.',
          );
        op = await this.#settle(
          c,
          ctx,
          op,
          'unknown',
          {
            reason_code: 'abandoned',
            explanation:
              'The process sending this change stopped before GitHub answered.',
          },
          null,
        );
      }
      if (op.state !== 'unknown')
        throw fail(
          'INVALID_TRANSITION',
          `This operation is already ${op.state}.`,
        );
      // Review 1 L-1 (PR #244): reconciling keeps what GitHub first answered.
      const answer = op.result?.github_answer;
      const kept = answer === undefined ? null : { github_answer: answer };
      if (found.exists) {
        await this.#applySuccess(c, ctx, op, found.data);
        return this.#settle(
          c,
          ctx,
          op,
          'reconciled_succeeded',
          {
            reason_code: 'found_on_github',
            explanation: found.note,
          },
          kept ? { ...(found.data ?? {}), ...kept } : found.data,
        );
      }
      return this.#settle(
        c,
        ctx,
        op,
        'reconciled_absent',
        {
          reason_code: 'absent_on_github',
          explanation: found.note,
        },
        kept,
      );
    });
  }
  async listGitHubOperations(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from github_operations where workspace_id = $1 order by created_at, id',
        [ws],
      );
      return rows.map((r: Row) => toOperation(r));
    });
  }
  async getGitHubOperation(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from github_operations where workspace_id = $1 and id = $2',
        [ws, uuid(id)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'GitHub operation not found.');
      return toOperation(rows[0] as Row);
    });
  }

  // ---- Reviews and webhooks -------------------------------------------------------------

  async recordGitHubReview(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<GitHubReview> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RecordGitHubReviewRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const repo = await this.#repository(c, ws, req.repository_id);
      const { rows } = await c.query(
        `insert into github_reviews (id, workspace_id, repository_id, pr_number, head_sha,
           verdict, note, reviewer_id) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          randomUUID(),
          ws,
          repo.id,
          req.pr_number,
          req.head_sha,
          req.verdict,
          req.note,
          ctx.actorId,
        ],
      );
      const review = toReview(rows[0] as Row);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'github.review_recorded',
        subjectKind: 'github_review',
        subjectId: review.id,
        subjectVersion: null,
        contentHash: null,
        payload: {
          repository_github_id: repo.github_id,
          pr_number: req.pr_number,
          head_sha: req.head_sha,
          verdict: req.verdict,
        },
        relatedIds: [repo.id],
      });
      return review;
    });
  }
  /** Where a webhook for this connection is verified. No session: the signature is the check. */
  async githubWebhookTarget(connectionId: string) {
    const { rows } = await this.pool.query(
      'select * from github_connections where id = $1',
      [uuid(connectionId)],
    );
    if (!rows[0]) return null;
    const conn = toConnection(rows[0] as Row);
    return { connection: conn, secret_env: conn.body.webhook_secret_env };
  }
  /**
   * Records one delivery. A verified delivery is applied once per GitHub delivery id and only
   * ever removes access (lost repositories, public repositories, revoked installations).
   */
  async recordGitHubDelivery(
    ctx: CommandContext,
    connectionId: string,
    d: {
      delivery_id: string;
      event: string;
      payload: unknown;
      payload_hash: string;
      signature_valid: boolean;
    },
  ): Promise<{ delivery: GitHubDelivery; duplicate: boolean }> {
    ctx = normalize(ctx);
    return this.tx(async (c) => {
      const { rows: cr } = await c.query(
        'select * from github_connections where id = $1 for update',
        [uuid(connectionId)],
      );
      if (!cr[0]) throw fail('NOT_FOUND', 'GitHub connection not found.');
      let conn = toConnection(cr[0] as Row);
      const action =
        typeof (d.payload as Record<string, unknown> | null)?.action ===
        'string'
          ? String((d.payload as Record<string, unknown>).action).slice(0, 100)
          : null;
      if (d.signature_valid) {
        const prior = await c.query(
          `select * from github_webhook_deliveries where connection_id = $1 and delivery_id = $2
             and status = 'accepted'`,
          [conn.id, d.delivery_id],
        );
        if (prior.rows[0])
          return {
            delivery: toDelivery(prior.rows[0] as Row),
            duplicate: true,
          };
      }
      const notes: string[] = [];
      if (d.signature_valid && conn.status !== 'revoked')
        for (const e of webhookEffects(d.event, d.payload)) {
          if (e.kind === 'connection_access_revoked') {
            if (conn.status === 'active' || conn.status === 'unverified')
              conn = await this.#setConnection(
                c,
                ctx,
                conn,
                'access_revoked',
                e.note,
              );
            notes.push(`connection access revoked (${e.note})`);
            continue;
          }
          const repos = await c.query(
            'select * from github_repositories where connection_id = $1 and github_id = any($2::bigint[]) for update',
            [conn.id, e.github_ids],
          );
          for (const r of repos.rows) {
            const repo = toRepository(r as Row);
            await this.#setRepository(c, ctx, repo, {
              status:
                e.kind === 'repository_public' ? 'quarantined' : 'access_lost',
              reason: e.note,
            });
            notes.push(`${repo.full_name}: ${e.note}`);
          }
        }
      const { rows } = await c.query(
        `insert into github_webhook_deliveries (id, connection_id, delivery_id, event, action,
           payload_hash, status, effects) values ($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          randomUUID(),
          conn.id,
          d.delivery_id.slice(0, 100),
          d.event.slice(0, 100),
          action,
          d.payload_hash,
          d.signature_valid ? 'accepted' : 'rejected_signature',
          JSON.stringify(notes),
        ],
      );
      const delivery = toDelivery(rows[0] as Row);
      await this.append(c, ctx, {
        workspaceId: conn.workspace_id,
        action: d.signature_valid
          ? 'github.webhook_accepted'
          : 'github.webhook_rejected',
        subjectKind: 'github_webhook',
        subjectId: delivery.id,
        subjectVersion: null,
        contentHash: d.payload_hash,
        payload: {
          event: d.event,
          action,
          delivery_id: delivery.delivery_id,
          effects: notes,
        },
        relatedIds: [conn.id],
      });
      return { delivery, duplicate: false };
    });
  }
  async listGitHubDeliveries(
    ctx: CommandContext,
    ws: string,
    connectionId: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await this.#connection(c, ws, connectionId);
      const { rows } = await c.query(
        'select * from github_webhook_deliveries where connection_id = $1 order by received_at, id',
        [uuid(connectionId)],
      );
      return rows.map((r: Row) => toDelivery(r));
    });
  }

  // ---- ADR-0132 (P32): GitHub App created and installed from the studio ----------------------

  async #setup(c: PoolClient, ws: string, id: string, lock = false) {
    const { rows } = await c.query(
      `select * from github_app_setups where workspace_id = $1 and id = $2${lock ? ' for update' : ''}`,
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'GitHub App setup not found.');
    return rows[0] as Row;
  }
  async #auditSetup(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    setup: GitHubAppSetup,
    action: string,
  ) {
    // Names, ids and status only; the key and GitHub's one-time code never reach the journal.
    const payload = {
      status: setup.status,
      organization: setup.organization,
      app: setup.app && {
        id: setup.app.id,
        slug: setup.app.slug,
        owner: setup.app.owner,
      },
      installation: setup.installation,
      connection_id: setup.connection_id,
      failure: setup.failure,
    };
    await this.append(c, ctx, {
      workspaceId: ws,
      action,
      subjectKind: 'github_app_setup',
      subjectId: setup.id,
      subjectVersion: 1,
      contentHash: canonicalHash(payload),
      payload,
    });
  }
  async #moveSetup(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    id: string,
    set: string,
    values: unknown[],
    action: string,
  ) {
    const { rows } = await c.query(
      `update github_app_setups set ${set}, updated_at = now()
        where workspace_id = $1 and id = $2 returning *`,
      [ws, id, ...values],
    );
    const setup = toSetup(rows[0] as Row);
    await this.#auditSetup(c, ctx, ws, setup, action);
    return setup;
  }
  /** Owner only, real workspaces only. A newer start retires any handshake still waiting. */
  async beginGitHubAppSetup(
    ctx: CommandContext,
    ws: string,
    organization: string | null,
  ): Promise<GitHubAppSetup> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      if (await this.#workspaceFixture(c, ws))
        throw fail(
          'SCOPE_EXCEEDED',
          'A fixture workspace talks to the simulated GitHub; create a GitHub App from a real workspace.',
        );
      const { rows: waiting } = await c.query(
        `update github_app_setups set status = 'expired', updated_at = now()
          where workspace_id = $1 and status = 'waiting_for_github' returning *`,
        [ws],
      );
      for (const w of waiting)
        await this.#auditSetup(
          c,
          ctx,
          ws,
          toSetup(w as Row),
          'github.app_setup_expired',
        );
      const { rows } = await c.query(
        `insert into github_app_setups (id, workspace_id, status, organization, created_by)
         values ($1,$2,'waiting_for_github',$3,$4) returning *`,
        [randomUUID(), ws, organization, ctx.actorId],
      );
      const setup = toSetup(rows[0] as Row);
      await this.#auditSetup(c, ctx, ws, setup, 'github.app_setup_started');
      return setup;
    });
  }
  async listGitHubAppSetups(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from github_app_setups where workspace_id = $1 order by created_at desc, id limit 20',
        [ws],
      );
      return rows.map((r: Row) => toSetup(r));
    });
  }
  async getGitHubAppSetup(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return toSetup(await this.#setup(c, ws, id));
    });
  }
  /**
   * GitHub created the app and the studio sealed its key. Only a setup still waiting, inside
   * GitHub's hour, accepts it; anything else is refused so the caller can drop the sealed key.
   */
  async recordGitHubAppCreated(
    ctx: CommandContext,
    ws: string,
    id: string,
    v: { app: NonNullable<GitHubAppSetup['app']>; key_ref: string },
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const row = await this.#setup(c, ws, id, true);
      await this.requireOwner(c, ws, ctx.actorId);
      if (toSetup(row).status !== 'waiting_for_github')
        throw fail(
          'INVALID_TRANSITION',
          'This GitHub App setup is no longer waiting for GitHub.',
        );
      return this.#moveSetup(
        c,
        ctx,
        ws,
        String(row.id),
        `status = 'app_created', app = $3, key_ref = $4`,
        [JSON.stringify(v.app), v.key_ref],
        'github.app_created',
      );
    });
  }
  async failGitHubAppSetup(
    ctx: CommandContext,
    ws: string,
    id: string,
    reason: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const row = await this.#setup(c, ws, id, true);
      await this.requireOwner(c, ws, ctx.actorId);
      // Review M-1: only the code exchange fails a setup, so only one still waiting for GitHub
      // moves; an app already created (a second redirect raced the first) is left as it is.
      if (String(row.status) !== 'waiting_for_github') return toSetup(row);
      return this.#moveSetup(
        c,
        ctx,
        ws,
        String(row.id),
        `status = 'failed', failure = $3`,
        [reason.slice(0, 500)],
        'github.app_setup_failed',
      );
    });
  }
  /** The setup and its key reference, for reading the app's installations with its own JWT. */
  async githubAppSetupForInstallation(
    ctx: CommandContext,
    ws: string,
    id: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const row = await this.#setup(c, ws, id);
      const setup = toSetup(row);
      if (setup.status !== 'app_created' && setup.status !== 'installed')
        throw fail(
          'INVALID_TRANSITION',
          setup.status === 'connected'
            ? 'This GitHub App is already connected.'
            : 'Create the GitHub App first.',
        );
      return { setup, key_ref: String(row.key_ref) };
    });
  }
  async recordGitHubAppInstallation(
    ctx: CommandContext,
    ws: string,
    id: string,
    installation: NonNullable<GitHubAppSetup['installation']>,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const row = await this.#setup(c, ws, id, true);
      await this.requireOwner(c, ws, ctx.actorId);
      const setup = toSetup(row);
      if (setup.status === 'installed') {
        if (setup.installation?.id === installation.id) return setup;
        throw fail(
          'INVALID_TRANSITION',
          'The app was installed again elsewhere. Abandon this setup and start a new one.',
        );
      }
      if (setup.status !== 'app_created')
        throw fail('INVALID_TRANSITION', 'Create the GitHub App first.');
      return this.#moveSetup(
        c,
        ctx,
        ws,
        String(row.id),
        `status = 'installed', installation = $3`,
        [JSON.stringify(installation)],
        'github.app_installed',
      );
    });
  }
  /**
   * Registers the ordinary live connection for an installed app: the owner is the installation's
   * account and the credential names the sealed key. It starts unverified like any other.
   */
  async connectGitHubAppSetup(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ): Promise<{ setup: GitHubAppSetup; connection: GitHubConnection }> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(ConnectGitHubAppSetupRequestSchema, raw);
    return this.tx(async (c) => {
      const row = await this.#setup(c, ws, id, true);
      await this.requireOwner(c, ws, ctx.actorId);
      const setup = toSetup(row);
      if (setup.status !== 'installed' || !setup.app || !setup.installation)
        throw fail(
          'INVALID_TRANSITION',
          setup.status === 'app_created'
            ? 'Install the app on GitHub, then check the installation.'
            : 'This GitHub App setup cannot be connected.',
        );
      const body = parse(RegisterGitHubConnectionRequestSchema, {
        label: req.label,
        mode: 'live',
        owner: setup.installation.account,
        credential: {
          kind: 'app_vault',
          app_id: setup.app.id,
          app_slug: setup.app.slug,
          app_client_id: setup.app.client_id,
          key_ref: String(row.key_ref),
          installation_id: setup.installation.id,
        },
        webhook_secret_env: null,
        limits: req.limits,
        required_checks: req.required_checks,
        included_repositories: req.included_repositories,
      });
      const connection = await this.#insertConnection(c, ctx, ws, body);
      const done = await this.#moveSetup(
        c,
        ctx,
        ws,
        String(row.id),
        `status = 'connected', connection_id = $3`,
        [connection.id],
        'github.app_connected',
      );
      return { setup: done, connection };
    });
  }
  /**
   * Stops an unfinished setup. Returns the key reference so the service can delete the sealed
   * key; the app itself stays on GitHub until the owner deletes it there.
   */
  async abandonGitHubAppSetup(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const row = await this.#setup(c, ws, id, true);
      await this.requireOwner(c, ws, ctx.actorId);
      if (!OPEN_SETUP.includes(String(row.status)))
        throw fail(
          'INVALID_TRANSITION',
          'Only an unfinished GitHub App setup can be abandoned.',
        );
      const setup = await this.#moveSetup(
        c,
        ctx,
        ws,
        String(row.id),
        `status = 'abandoned'`,
        [],
        'github.app_setup_abandoned',
      );
      return {
        setup,
        key_ref: row.key_ref === null ? null : String(row.key_ref),
      };
    });
  }
}
