import { createSign, createHash } from 'node:crypto';
import {
  GITHUB_API_VERSION,
  type CheckObservation,
  type GitHubIdentity,
  type PullObservation,
} from '@creator/contracts';
import {
  changedPaths,
  commitExists,
  isAncestor,
  studioGit,
} from './github-git.js';

// X04 GitHub adapters: a deterministic fixture and a REST/Git adapter. Adapters only perform
// and observe; the store and GitHubService decide what may run and how outcomes settle.

export interface RepoRef {
  github_id: number;
  full_name: string;
}
export interface RepoObservation {
  github_id: number;
  owner: { id: number; login: string };
  full_name: string;
  private: boolean;
  default_branch: string;
  created_at: string | null;
}
/** A mutation's raw outcome; `status: null` means no answer (the effect may exist). */
export interface GitHubResponse {
  status: number | null;
  headers: Record<string, string>;
  data: Record<string, unknown> | null;
  message: string;
}
export interface ReadRefusal {
  step: 'pull' | 'check_runs' | 'statuses';
  status: number | null;
  message: string;
}
export interface PullRead {
  pull: PullObservation | null;
  refusal: ReadRefusal | null;
}
const readRefusal = (
  step: ReadRefusal['step'],
  r: GitHubResponse,
): ReadRefusal => ({
  step,
  status: r.status,
  message: (
    r.message || (r.status === null ? 'no response' : `HTTP ${r.status}`)
  ).slice(0, 300),
});
export interface GitHubAdapter {
  readonly live: boolean;
  identity(): Promise<{
    identity: GitHubIdentity | null;
    token_expires_at: string | null;
    response: GitHubResponse;
  }>;
  repositoryById(id: number): Promise<RepoObservation | null>;
  repositoryByName(fullName: string): Promise<RepoObservation | null>;
  createRepository(
    owner: { login: string; type: 'User' | 'Organization' },
    name: string,
    description: string,
  ): Promise<GitHubResponse>;
  branchSha(repo: RepoRef, branch: string): Promise<string | null>;
  createBranch(
    repo: RepoRef,
    branch: string,
    sha: string,
  ): Promise<GitHubResponse>;
  push(
    repo: RepoRef,
    branch: string,
    sha: string,
    sourceDir: string,
    workflows: boolean,
  ): Promise<GitHubResponse>;
  createIssue(
    repo: RepoRef,
    title: string,
    body: string,
  ): Promise<GitHubResponse>;
  findIssue(
    repo: RepoRef,
    title: string,
    since: string,
  ): Promise<number | null>;
  openPull(
    repo: RepoRef,
    head: string,
    base: string,
    title: string,
    body: string,
  ): Promise<GitHubResponse>;
  findOpenPull(repo: RepoRef, head: string): Promise<number | null>;
  pull(repo: RepoRef, number: number): Promise<PullObservation | null>;
  /**
   * P22 review M-1: the same read, keeping why it failed. `refusal` is null for a pull request
   * that was read and for a plain 404 (no such pull request); any other failure is a refusal.
   */
  pullRead(repo: RepoRef, number: number): Promise<PullRead>;
  checks(
    repo: RepoRef,
    sha: string,
  ): Promise<{
    checks: CheckObservation[];
    check_runs_readable: boolean;
    /** A check-runs or statuses read GitHub did not answer with 200; the list is then partial. */
    refusals: ReadRefusal[];
  }>;
  merge(
    repo: RepoRef,
    number: number,
    sha: string,
    method: 'merge' | 'squash',
  ): Promise<GitHubResponse>;
}

const ok = (
  status: number,
  data: Record<string, unknown> | null = null,
): GitHubResponse => ({ status, headers: {}, data, message: '' });
const err = (status: number | null, message: string): GitHubResponse => ({
  status,
  headers: {},
  data: null,
  message,
});
const hex40 = (seed: string) => createHash('sha1').update(seed).digest('hex');

type FixtureFault =
  'no_response_after_effect' | 'no_response_before_effect' | number;
interface FixtureRepo extends RepoObservation {
  branches: Map<string, string>;
  issues: { number: number; title: string; created_at: string }[];
  pulls: Map<number, PullObservation>;
  checks: CheckObservation[];
  next: number;
}

/**
 * Deterministic in-memory GitHub for fixture workspaces and tests. Pushes still read the real
 * local product repository (the commit must exist and descend from the remote head).
 */
export class FixtureGitHub implements GitHubAdapter {
  readonly live = false;
  #repos = new Map<number, FixtureRepo>();
  #faults = new Map<string, FixtureFault>();
  #nextId = 900_001;
  #revoked = false;
  #lost = new Set<number>();
  calls: string[] = [];
  constructor(
    readonly account: GitHubIdentity = {
      login: 'fixture-owner',
      id: 4_100_001,
      type: 'User',
    },
  ) {}

  /** Test seams: inject one fault, revoke the credential, drop a repository from scope. */
  failNext(method: string, fault: FixtureFault) {
    this.#faults.set(method, fault);
  }
  revoke() {
    this.#revoked = true;
  }
  loseAccess(githubId: number) {
    this.#lost.add(githubId);
  }
  /** Seeds a repository that exists outside the studio (e.g. a personal one). */
  seedRepository(name: string, opts: { private: boolean; ownerId?: number }) {
    const id = this.#nextId++;
    const owner = {
      id: opts.ownerId ?? this.account.id,
      login: this.account.login,
    };
    this.#repos.set(id, {
      github_id: id,
      owner,
      full_name: `${owner.login}/${name}`,
      private: opts.private,
      default_branch: 'main',
      created_at: '2026-01-01T00:00:00.000Z',
      branches: new Map(),
      issues: [],
      pulls: new Map(),
      checks: [],
      next: 1,
    });
    return id;
  }
  setCheck(
    githubId: number,
    sha: string,
    name: string,
    conclusion: string | null,
    source: CheckObservation['source'] = 'check_run',
  ) {
    const r = this.#repo(githubId);
    r.checks = r.checks.filter((c) => !(c.name === name && c.head_sha === sha));
    r.checks.push({
      name,
      head_sha: sha,
      source,
      status: conclusion === null ? 'in_progress' : 'completed',
      conclusion,
    });
  }
  /** Someone else pushes to the pull request's branch. */
  moveHead(githubId: number, number: number, sha: string) {
    const r = this.#repo(githubId);
    const p = r.pulls.get(number);
    if (!p) throw new Error('No such fixture pull request');
    p.head_sha = sha;
    r.branches.set(p.head_ref, sha);
  }
  repoState(githubId: number) {
    return this.#repo(githubId);
  }

  #repo(id: number) {
    const r = this.#repos.get(id);
    if (!r) throw new Error('No such fixture repository');
    return r;
  }
  #visible(id: number) {
    const r = this.#repos.get(id);
    return r && !this.#lost.has(id) && r.owner.id === this.account.id
      ? r
      : null;
  }
  async #run(
    method: string,
    effect: () => Promise<GitHubResponse> | GitHubResponse,
    repo?: RepoRef,
  ): Promise<GitHubResponse> {
    this.calls.push(method);
    const fault = this.#faults.get(method);
    this.#faults.delete(method);
    if (this.#revoked) return err(401, 'Bad credentials');
    if (repo && !this.#visible(repo.github_id)) return err(404, 'Not Found');
    if (fault === 'no_response_before_effect')
      return err(null, 'connection reset');
    if (typeof fault === 'number') return err(fault, `fixture ${fault}`);
    const r = await effect();
    return fault === 'no_response_after_effect'
      ? err(null, 'timeout after send')
      : r;
  }

  async identity() {
    this.calls.push('identity');
    if (this.#revoked)
      return {
        identity: null,
        token_expires_at: null,
        response: err(401, 'Bad credentials'),
      };
    return {
      identity: this.account,
      token_expires_at: null,
      response: ok(200),
    };
  }
  async repositoryById(id: number) {
    if (this.#revoked) return null;
    const r = this.#visible(id);
    return r ? this.#obs(r) : null;
  }
  async repositoryByName(fullName: string) {
    if (this.#revoked) return null;
    const r = [...this.#repos.values()].find(
      (x) => x.full_name === fullName && this.#visible(x.github_id),
    );
    return r ? this.#obs(r) : null;
  }
  #obs(r: FixtureRepo): RepoObservation {
    return {
      github_id: r.github_id,
      owner: r.owner,
      full_name: r.full_name,
      private: r.private,
      default_branch: r.default_branch,
      created_at: r.created_at,
    };
  }
  createRepository(
    owner: { login: string; type: 'User' | 'Organization' },
    name: string,
  ) {
    return this.#run('createRepository', () => {
      const fullName = `${owner.login}/${name}`;
      if ([...this.#repos.values()].some((r) => r.full_name === fullName))
        return err(422, 'name already exists on this account');
      const id = this.seedRepository(name, { private: true });
      // auto_init: one initial commit on main, like GitHub's README commit.
      const r = this.#repo(id);
      r.branches.set('main', hex40(`init:${fullName}`));
      r.created_at = new Date().toISOString();
      return ok(201, { ...this.#obs(r) });
    });
  }
  async branchSha(repo: RepoRef, branch: string) {
    const r = this.#visible(repo.github_id);
    return r?.branches.get(branch) ?? null;
  }
  createBranch(repo: RepoRef, branch: string, sha: string) {
    return this.#run(
      'createBranch',
      () => {
        const r = this.#repo(repo.github_id);
        if (r.branches.has(branch)) return err(422, 'Reference already exists');
        if (![...r.branches.values()].includes(sha))
          return err(422, 'Object does not exist');
        r.branches.set(branch, sha);
        return ok(201, { ref: `refs/heads/${branch}`, sha });
      },
      repo,
    );
  }
  push(repo: RepoRef, branch: string, sha: string, sourceDir: string) {
    return this.#run(
      'push',
      async () => {
        const r = this.#repo(repo.github_id);
        if (!(await commitExists(sourceDir, sha)))
          return err(422, 'commit not in the local repository');
        const current = r.branches.get(branch);
        if (current && !(await isAncestor(sourceDir, current, sha)))
          return err(409, 'non-fast-forward');
        r.branches.set(branch, sha);
        return ok(200, { ref: `refs/heads/${branch}`, sha });
      },
      repo,
    );
  }
  createIssue(repo: RepoRef, title: string) {
    return this.#run(
      'createIssue',
      () => {
        const r = this.#repo(repo.github_id);
        const number = r.next++;
        r.issues.push({ number, title, created_at: new Date().toISOString() });
        return ok(201, { number });
      },
      repo,
    );
  }
  async findIssue(repo: RepoRef, title: string, since: string) {
    const r = this.#visible(repo.github_id);
    return (
      r?.issues.find(
        (i) =>
          i.title === title && Date.parse(i.created_at) >= Date.parse(since),
      )?.number ?? null
    );
  }
  openPull(repo: RepoRef, head: string, base: string) {
    return this.#run(
      'openPull',
      () => {
        const r = this.#repo(repo.github_id);
        const headSha = r.branches.get(head);
        if (!headSha || !r.branches.has(base))
          return err(422, 'head or base branch missing');
        if (
          [...r.pulls.values()].some(
            (p) => p.head_ref === head && p.state === 'open',
          )
        )
          return err(422, 'A pull request already exists');
        const number = r.next++;
        r.pulls.set(number, {
          number,
          state: 'open',
          merged: false,
          head_sha: headSha,
          head_ref: head,
          base_ref: base,
          merge_commit_sha: null,
        });
        return ok(201, { number, head_sha: headSha });
      },
      repo,
    );
  }
  async findOpenPull(repo: RepoRef, head: string) {
    const r = this.#visible(repo.github_id);
    return (
      [...(r?.pulls.values() ?? [])].find(
        (p) => p.head_ref === head && p.state === 'open',
      )?.number ?? null
    );
  }
  async pull(repo: RepoRef, number: number) {
    return (await this.pullRead(repo, number)).pull;
  }
  async pullRead(repo: RepoRef, number: number): Promise<PullRead> {
    if (this.#revoked)
      return {
        pull: null,
        refusal: { step: 'pull', status: 401, message: 'Bad credentials' },
      };
    const p = this.#visible(repo.github_id)?.pulls.get(number);
    return { pull: p ? { ...p } : null, refusal: null };
  }
  async checks(repo: RepoRef, sha: string) {
    const r = this.#visible(repo.github_id);
    return {
      checks: (r?.checks ?? []).filter((c) => c.head_sha === sha),
      check_runs_readable: true,
      refusals: [] as ReadRefusal[],
    };
  }
  merge(repo: RepoRef, number: number, sha: string) {
    return this.#run(
      'merge',
      () => {
        const r = this.#repo(repo.github_id);
        const p = r.pulls.get(number);
        if (!p) return err(404, 'Not Found');
        if (p.state !== 'open')
          return err(405, 'Pull Request is not mergeable');
        if (p.head_sha !== sha)
          return err(
            409,
            'Head branch was modified. Review and try the merge again.',
          );
        const merged = hex40(`merge:${repo.full_name}:${number}:${sha}`);
        Object.assign(p, {
          state: 'closed',
          merged: true,
          merge_commit_sha: merged,
        });
        r.branches.set(p.base_ref, merged);
        return ok(200, { merged: true, sha: merged });
      },
      repo,
    );
  }
}

// ---- Live REST and Git adapter ------------------------------------------------------------

export interface LiveGitHubOptions {
  credential:
    | { kind: 'fine_grained_pat'; token: string }
    | {
        kind: 'app_installation';
        client_id: string;
        private_key: string;
        installation_id: number;
      };
  /** Contract tests point these at loopback servers; deployments leave the defaults. */
  apiBase?: string;
  gitBase?: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
type Permissions = Record<string, 'read' | 'write'>;

/**
 * REST (API version 2026-03-10) and Git-over-HTTPS adapter. App installation tokens are
 * minted per call, limited to the one repository and the permissions that endpoint needs;
 * a fine-grained token is used as configured and never falls back to anything broader.
 */
export class LiveGitHub implements GitHubAdapter {
  readonly live = true;
  readonly #api: string;
  readonly #git: string;
  readonly #fetch: typeof fetch;
  readonly #timeout: number;
  #minted = new Map<string, { token: string; expires: number }>();
  constructor(private readonly opts: LiveGitHubOptions) {
    this.#api = (opts.apiBase ?? 'https://api.github.com').replace(/\/$/, '');
    this.#git = (opts.gitBase ?? 'https://github.com').replace(/\/$/, '');
    this.#fetch = opts.fetch ?? fetch;
    this.#timeout = opts.timeoutMs ?? 20_000;
  }

  #jwt(): string {
    const c = this.opts.credential;
    if (c.kind !== 'app_installation') throw new Error('Not an app credential');
    const b64 = (v: unknown) =>
      Buffer.from(JSON.stringify(v)).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat: now - 60, exp: now + 540, iss: c.client_id })}`;
    const sig = createSign('RSA-SHA256').update(unsigned).sign(c.private_key);
    return `${unsigned}.${sig.toString('base64url')}`;
  }
  /** Token for one call: the PAT, or an installation token scoped to these repos/permissions. */
  async #token(repoIds: number[] | null, permissions: Permissions) {
    const c = this.opts.credential;
    if (c.kind === 'fine_grained_pat') return c.token;
    const key = JSON.stringify([repoIds, permissions]);
    const cached = this.#minted.get(key);
    if (cached && cached.expires - Date.now() > 300_000) return cached.token;
    const r = await this.#call(
      'POST',
      `/app/installations/${c.installation_id}/access_tokens`,
      `Bearer ${this.#jwt()}`,
      { ...(repoIds ? { repository_ids: repoIds } : {}), permissions },
    );
    const token = r.data?.token;
    if (r.status !== 201 || typeof token !== 'string')
      throw Object.assign(new Error('installation token refused'), {
        response: r,
      });
    this.#minted.set(key, {
      token,
      expires: Date.parse(String(r.data?.expires_at)) || Date.now(),
    });
    return token;
  }
  async #call(
    method: string,
    path: string,
    auth: string,
    body?: unknown,
  ): Promise<GitHubResponse> {
    try {
      const res = await this.#fetch(`${this.#api}${path}`, {
        method,
        redirect: 'manual',
        signal: AbortSignal.timeout(this.#timeout),
        headers: {
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': GITHUB_API_VERSION,
          'User-Agent': 'creator-agent-studio',
          Authorization: auth,
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      const headers: Record<string, string> = {};
      for (const h of [
        'x-ratelimit-remaining',
        'x-ratelimit-reset',
        'retry-after',
        'x-accepted-github-permissions',
        'github-authentication-token-expiration',
      ]) {
        const v = res.headers.get(h);
        if (v !== null) headers[h] = v.slice(0, 200);
      }
      const text = await res.text();
      let data: Record<string, unknown> | null = null;
      try {
        const parsed = JSON.parse(text) as unknown;
        data =
          parsed && typeof parsed === 'object' && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : { items: parsed };
      } catch {
        data = null;
      }
      const message =
        typeof data?.message === 'string' ? data.message.slice(0, 300) : '';
      return { status: res.status, headers, data, message };
    } catch (e) {
      return err(
        null,
        (e as Error).name === 'TimeoutError' ? 'timeout' : 'network error',
      );
    }
  }
  async #rest(
    method: string,
    path: string,
    scope: { repo: number | null; permissions: Permissions },
    body?: unknown,
  ): Promise<GitHubResponse> {
    let token: string;
    try {
      token = await this.#token(
        scope.repo === null ? null : [scope.repo],
        scope.permissions,
      );
    } catch (e) {
      const r = (e as { response?: GitHubResponse }).response;
      return r ?? err(null, 'installation token unavailable');
    }
    return this.#call(method, path, `Bearer ${token}`, body);
  }

  async identity() {
    const c = this.opts.credential;
    const r =
      c.kind === 'fine_grained_pat'
        ? await this.#call('GET', '/user', `Bearer ${c.token}`)
        : await this.#call(
            'GET',
            `/app/installations/${c.installation_id}`,
            `Bearer ${this.#jwt()}`,
          );
    const a = (c.kind === 'fine_grained_pat' ? r.data : r.data?.account) as
      Record<string, unknown> | undefined;
    const identity =
      r.status === 200 &&
      a &&
      typeof a.login === 'string' &&
      typeof a.id === 'number' &&
      (a.type === 'User' || a.type === 'Organization')
        ? { login: a.login, id: a.id, type: a.type as GitHubIdentity['type'] }
        : null;
    const exp = r.headers['github-authentication-token-expiration'];
    const parsed = exp
      ? Date.parse(exp.replace(' UTC', 'Z').replace(' ', 'T'))
      : NaN;
    return {
      identity,
      token_expires_at: Number.isNaN(parsed)
        ? null
        : new Date(parsed).toISOString(),
      response: r,
    };
  }
  #repoObs(d: Record<string, unknown> | null): RepoObservation | null {
    const o = d?.owner as Record<string, unknown> | undefined;
    if (
      !d ||
      typeof d.id !== 'number' ||
      typeof d.full_name !== 'string' ||
      typeof o?.id !== 'number'
    )
      return null;
    return {
      github_id: d.id,
      owner: { id: o.id, login: String(o.login) },
      full_name: d.full_name,
      private: d.private === true,
      default_branch: String(d.default_branch ?? 'main'),
      created_at: typeof d.created_at === 'string' ? d.created_at : null,
    };
  }
  async repositoryById(id: number) {
    const r = await this.#rest('GET', `/repositories/${id}`, {
      repo: id,
      permissions: { metadata: 'read' },
    });
    return r.status === 200 ? this.#repoObs(r.data) : null;
  }
  async repositoryByName(fullName: string) {
    const r = await this.#rest('GET', `/repos/${fullName}`, {
      repo: null,
      permissions: { metadata: 'read' },
    });
    return r.status === 200 ? this.#repoObs(r.data) : null;
  }
  createRepository(
    owner: { login: string; type: 'User' | 'Organization' },
    name: string,
    description: string,
  ) {
    return this.#rest(
      'POST',
      owner.type === 'Organization'
        ? `/orgs/${owner.login}/repos`
        : '/user/repos',
      { repo: null, permissions: { administration: 'write' } },
      {
        name,
        description,
        private: true,
        auto_init: true,
        has_wiki: false,
        has_projects: false,
        delete_branch_on_merge: false,
      },
    );
  }
  async branchSha(repo: RepoRef, branch: string) {
    const r = await this.#rest(
      'GET',
      `/repos/${repo.full_name}/git/ref/heads/${encodeURI(branch)}`,
      { repo: repo.github_id, permissions: { contents: 'read' } },
    );
    const sha = (r.data?.object as Record<string, unknown> | undefined)?.sha;
    return r.status === 200 && typeof sha === 'string' ? sha : null;
  }
  createBranch(repo: RepoRef, branch: string, sha: string) {
    return this.#rest(
      'POST',
      `/repos/${repo.full_name}/git/refs`,
      { repo: repo.github_id, permissions: { contents: 'write' } },
      { ref: `refs/heads/${branch}`, sha },
    );
  }
  async push(
    repo: RepoRef,
    branch: string,
    sha: string,
    sourceDir: string,
    workflows: boolean,
  ): Promise<GitHubResponse> {
    let token: string;
    try {
      token = await this.#token([repo.github_id], {
        contents: 'write',
        ...(workflows ? { workflows: 'write' } : {}),
      });
    } catch (e) {
      return (
        (e as { response?: GitHubResponse }).response ??
        err(null, 'token unavailable')
      );
    }
    const remote = `${this.#git}/${repo.full_name}.git`;
    const url = new URL(remote);
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    const config: [string, string][] = [
      [`protocol.${url.protocol.slice(0, -1)}.allow`, 'always'],
      [`http.${url.origin}/.extraHeader`, `Authorization: Basic ${basic}`],
    ];
    // No '+' prefix: a push never rewrites the remote branch.
    const r = await studioGit(
      sourceDir,
      [
        'push',
        '--porcelain',
        '--no-verify',
        remote,
        `${sha}:refs/heads/${branch}`,
      ],
      { config, secret: basic, timeoutMs: this.#timeout * 3 },
    );
    const out = r.output.split(token).join('***');
    if (r.code === 0) return ok(200, { ref: `refs/heads/${branch}`, sha });
    if (r.code === null) return err(null, 'git push did not finish');
    if (/non-fast-forward|\[rejected\]|fetch first/i.test(out))
      return err(409, 'non-fast-forward');
    if (/workflow/i.test(out) && /refusing|permission/i.test(out))
      return err(403, 'refusing workflow change without workflows permission');
    if (/Authentication failed|invalid credentials|401/i.test(out))
      return err(401, 'authentication failed');
    if (/403|denied|not allowed/i.test(out)) return err(403, out.slice(0, 300));
    if (/not found|404/i.test(out)) return err(404, 'repository not found');
    return err(null, out.slice(0, 300));
  }
  createIssue(repo: RepoRef, title: string, body: string) {
    return this.#rest(
      'POST',
      `/repos/${repo.full_name}/issues`,
      { repo: repo.github_id, permissions: { issues: 'write' } },
      { title, body },
    );
  }
  async findIssue(repo: RepoRef, title: string, since: string) {
    const r = await this.#rest(
      'GET',
      `/repos/${repo.full_name}/issues?state=all&since=${encodeURIComponent(since)}&per_page=100`,
      { repo: repo.github_id, permissions: { issues: 'read' } },
    );
    const items = (r.data?.items ?? []) as Record<string, unknown>[];
    const hit = items.find(
      (i) => i.title === title && i.pull_request === undefined,
    );
    return typeof hit?.number === 'number' ? hit.number : null;
  }
  openPull(
    repo: RepoRef,
    head: string,
    base: string,
    title: string,
    body: string,
  ) {
    return this.#rest(
      'POST',
      `/repos/${repo.full_name}/pulls`,
      { repo: repo.github_id, permissions: { pull_requests: 'write' } },
      { head, base, title, body, draft: false },
    );
  }
  async findOpenPull(repo: RepoRef, head: string) {
    const owner = repo.full_name.split('/')[0]!;
    const r = await this.#rest(
      'GET',
      `/repos/${repo.full_name}/pulls?state=open&head=${encodeURIComponent(`${owner}:${head}`)}`,
      { repo: repo.github_id, permissions: { pull_requests: 'read' } },
    );
    const items = (r.data?.items ?? []) as Record<string, unknown>[];
    return typeof items[0]?.number === 'number' ? items[0].number : null;
  }
  async pull(repo: RepoRef, number: number): Promise<PullObservation | null> {
    return (await this.pullRead(repo, number)).pull;
  }
  async pullRead(repo: RepoRef, number: number): Promise<PullRead> {
    const r = await this.#rest(
      'GET',
      `/repos/${repo.full_name}/pulls/${number}`,
      { repo: repo.github_id, permissions: { pull_requests: 'read' } },
    );
    const d = r.data;
    const head = d?.head as Record<string, unknown> | undefined;
    const base = d?.base as Record<string, unknown> | undefined;
    if (r.status === 404) return { pull: null, refusal: null };
    if (r.status !== 200 || !d || typeof head?.sha !== 'string')
      return { pull: null, refusal: readRefusal('pull', r) };
    const pull: PullObservation = {
      number,
      state: d.state === 'open' ? 'open' : 'closed',
      merged: d.merged === true,
      head_sha: head.sha,
      head_ref: String(head.ref ?? ''),
      base_ref: String(base?.ref ?? ''),
      merge_commit_sha:
        d.merged === true && typeof d.merge_commit_sha === 'string'
          ? d.merge_commit_sha
          : null,
    };
    return { pull, refusal: null };
  }
  async checks(repo: RepoRef, sha: string) {
    const out: CheckObservation[] = [];
    const refusals: ReadRefusal[] = [];
    // Fine-grained personal access tokens cannot call the Checks API (GitHub docs,
    // "Fine-grained personal access tokens limitations"); they read commit statuses only.
    const readable = this.opts.credential.kind === 'app_installation';
    if (readable) {
      const r = await this.#rest(
        'GET',
        `/repos/${repo.full_name}/commits/${sha}/check-runs?filter=latest&per_page=100`,
        { repo: repo.github_id, permissions: { checks: 'read' } },
      );
      if (r.status !== 200) refusals.push(readRefusal('check_runs', r));
      for (const c of (r.data?.check_runs ?? []) as Record<string, unknown>[])
        if (typeof c.name === 'string' && c.head_sha === sha)
          out.push({
            name: c.name,
            head_sha: sha,
            source: 'check_run',
            status:
              c.status === 'completed'
                ? 'completed'
                : c.status === 'queued'
                  ? 'queued'
                  : 'in_progress',
            conclusion: typeof c.conclusion === 'string' ? c.conclusion : null,
          });
    }
    const s = await this.#rest(
      'GET',
      `/repos/${repo.full_name}/commits/${sha}/status`,
      { repo: repo.github_id, permissions: { statuses: 'read' } },
    );
    if (s.status !== 200) refusals.push(readRefusal('statuses', s));
    if (s.data?.sha === sha)
      for (const st of (s.data?.statuses ?? []) as Record<string, unknown>[])
        if (typeof st.context === 'string')
          out.push({
            name: st.context,
            head_sha: sha,
            source: 'status',
            status: st.state === 'pending' ? 'pending' : 'completed',
            conclusion:
              st.state === 'pending' ? null : String(st.state ?? 'error'),
          });
    return { checks: out, check_runs_readable: readable, refusals };
  }
  merge(
    repo: RepoRef,
    number: number,
    sha: string,
    method: 'merge' | 'squash',
  ) {
    return this.#rest(
      'PUT',
      `/repos/${repo.full_name}/pulls/${number}/merge`,
      {
        repo: repo.github_id,
        permissions: { contents: 'write', pull_requests: 'write' },
      },
      { sha, merge_method: method },
    );
  }
}

/** Reads the connection's credential from the API process environment, nowhere else. */
export function liveGitHubFromEnv(
  env: Record<string, string | undefined>,
  credential:
    | { kind: 'fixture' }
    | { kind: 'fine_grained_pat'; token_env: string }
    | {
        kind: 'app_installation';
        app_client_id: string;
        private_key_env: string;
        installation_id: number;
      },
): LiveGitHub | null {
  if (credential.kind === 'fixture') return null;
  // No base-URL override from the environment: the credential only ever goes to GitHub.
  const base = {};
  if (credential.kind === 'fine_grained_pat') {
    const token = env[credential.token_env];
    return token
      ? new LiveGitHub({
          credential: { kind: 'fine_grained_pat', token },
          ...base,
        })
      : null;
  }
  const key = env[credential.private_key_env];
  return key
    ? new LiveGitHub({
        credential: {
          kind: 'app_installation',
          client_id: credential.app_client_id,
          private_key: key.replace(/\\n/g, '\n'),
          installation_id: credential.installation_id,
        },
        ...base,
      })
    : null;
}
export { changedPaths };
