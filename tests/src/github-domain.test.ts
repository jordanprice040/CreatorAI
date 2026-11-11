import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer, type IncomingMessage } from 'node:http';
import { createHmac, generateKeyPairSync, verify } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GITHUB_API_VERSION } from '@creator/contracts';
import {
  branchRefusal,
  classifyResponse,
  githubActionType,
  webhookEffects,
  webhookSignatureValid,
} from '@creator/domain';
import { LiveGitHub, repositoryRefusal } from '@creator/broker';

test('X04 rules: branch names, workflow paths, response classes and webhook signatures', () => {
  assert.equal(branchRefusal('creator/feature-1', 'creator/'), null);
  for (const bad of [
    'creator/../main',
    'creator/x.lock',
    'creator/',
    'creator/a//b',
    'creator/@{x}',
    'creator/.hidden',
  ])
    assert.equal(
      branchRefusal(bad, 'creator/')?.reason_code,
      'invalid_branch',
      bad,
    );
  assert.equal(branchRefusal('main', 'creator/')?.reason_code, 'branch_prefix');
  const push = (paths: string[]) =>
    githubActionType(
      {
        kind: 'push',
        repository_id: '00000000-0000-4000-8000-000000000001',
        branch: 'creator/x',
        product_id: '00000000-0000-4000-8000-000000000002',
        sha: 'a'.repeat(40),
        base_sha: null,
      },
      paths,
    );
  assert.equal(push(['src/a.ts', '.github/CODEOWNERS']), 'github.write');
  assert.equal(
    push(['src/a.ts', '.github/workflows/ci.yml']),
    'github.workflow_change',
  );
  assert.equal(
    push(['.github/actions/setup/action.yml']),
    'github.workflow_change',
  );

  // Only answers GitHub gave settle a mutation; silence and 5xx stay unknown.
  assert.equal(classifyResponse({ status: null }).state, 'unknown');
  assert.equal(classifyResponse({ status: 502 }).state, 'unknown');
  assert.equal(classifyResponse({ status: 201 }).state, 'succeeded');
  const reason = (r: Parameters<typeof classifyResponse>[0]) => {
    const c = classifyResponse(r);
    return c.state === 'succeeded' ? 'succeeded' : c.reason_code;
  };
  assert.equal(reason({ status: 401 }), 'credential_rejected');
  assert.equal(
    reason({ status: 403, headers: { 'x-ratelimit-remaining': '0' } }),
    'provider_rate_limited',
  );
  assert.equal(
    reason({
      status: 403,
      message: 'You have exceeded a secondary rate limit',
    }),
    'provider_rate_limited',
  );
  assert.equal(
    reason({
      status: 403,
      headers: { 'x-accepted-github-permissions': 'contents=write' },
    }),
    'permission_missing',
  );
  assert.equal(reason({ status: 404 }), 'not_accessible');
  assert.equal(reason({ status: 409 }), 'stale_head');

  const raw = Buffer.from('{"action":"publicized","repository":{"id":7}}');
  const sig = `sha256=${createHmac('sha256', 's3cret').update(raw).digest('hex')}`;
  assert.equal(webhookSignatureValid('s3cret', raw, sig), true);
  assert.equal(webhookSignatureValid('other', raw, sig), false);
  assert.equal(
    webhookSignatureValid('s3cret', Buffer.from(`${raw.toString()} `), sig),
    false,
  );
  assert.equal(webhookSignatureValid('s3cret', raw, undefined), false);
  assert.deepEqual(
    webhookEffects('repository', JSON.parse(raw.toString())).map((e) => e.kind),
    ['repository_public'],
  );
  // Events that would grant or widen anything have no effect.
  assert.deepEqual(
    webhookEffects('installation_repositories', {
      action: 'added',
      repositories_added: [{ id: 9 }],
    }),
    [],
  );
  assert.deepEqual(webhookEffects('member', { action: 'added' }), []);
});

interface Seen {
  method: string;
  path: string;
  auth: string;
  version: string;
  body: Record<string, unknown> | null;
}
async function loopbackGitHub(
  handle: (s: Seen) => {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  },
) {
  const seen: Seen[] = [];
  const read = async (req: IncomingMessage) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const text = Buffer.concat(chunks).toString();
    return text ? (JSON.parse(text) as Record<string, unknown>) : null;
  };
  const server = createServer((req, res) => {
    void read(req).then((body) => {
      const s: Seen = {
        method: req.method ?? '',
        path: req.url ?? '',
        auth: String(req.headers.authorization ?? ''),
        version: String(req.headers['x-github-api-version'] ?? ''),
        body,
      };
      seen.push(s);
      const r = handle(s);
      res.writeHead(r.status, {
        'Content-Type': 'application/json',
        ...(r.headers ?? {}),
      });
      res.end(JSON.stringify(r.body));
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as { port: number }).port;
  return {
    base: `http://127.0.0.1:${port}`,
    seen,
    close: () => new Promise((r) => server.close(r)),
  };
}
const SHA = 'c'.repeat(40);
const repo = { github_id: 501, full_name: 'acct/ca-app' };

test('X04 REST contract: fine-grained token reads statuses only and binds merges to the head', async (t) => {
  const gh = await loopbackGitHub((s) => {
    if (s.path === '/user')
      return {
        status: 200,
        body: { login: 'acct', id: 11, type: 'User' },
        headers: {
          'github-authentication-token-expiration': '2026-12-01 10:00:00 UTC',
        },
      };
    if (s.path === '/user/repos')
      return {
        status: 201,
        body: {
          id: 501,
          full_name: 'acct/ca-app',
          private: true,
          owner: { id: 11, login: 'acct' },
          default_branch: 'main',
        },
      };
    if (s.path.endsWith(`/commits/${SHA}/status`))
      return {
        status: 200,
        body: { sha: SHA, statuses: [{ context: 'ci', state: 'success' }] },
      };
    if (s.path.endsWith('/merge'))
      return { status: 409, body: { message: 'Head branch was modified.' } };
    return { status: 404, body: { message: 'Not Found' } };
  });
  t.after(gh.close);
  const a = new LiveGitHub({
    credential: { kind: 'fine_grained_pat', token: 'pat-secret' },
    apiBase: gh.base,
  });
  const who = await a.identity();
  assert.deepEqual(who.identity, { login: 'acct', id: 11, type: 'User' });
  assert.equal(who.token_expires_at, '2026-12-01T10:00:00.000Z');
  const created = await a.createRepository(
    { login: 'acct', type: 'User' },
    'ca-app',
    'x',
  );
  assert.equal(created.status, 201);
  const checks = await a.checks(repo, SHA);
  assert.equal(checks.check_runs_readable, false);
  assert.deepEqual(
    checks.checks.map((c) => `${c.source}:${c.name}:${c.conclusion}`),
    ['status:ci:success'],
  );
  const merge = await a.merge(repo, 3, SHA, 'squash');
  assert.equal(merge.status, 409);
  for (const s of gh.seen) {
    assert.equal(s.auth, 'Bearer pat-secret');
    assert.equal(s.version, GITHUB_API_VERSION);
  }
  assert.equal(
    gh.seen.find((s) => s.path === '/user/repos')?.body?.private,
    true,
  );
  assert.deepEqual(gh.seen.find((s) => s.path.endsWith('/merge'))?.body, {
    sha: SHA,
    merge_method: 'squash',
  });
  assert.ok(
    !gh.seen.some((s) => s.path.includes('check-runs')),
    'fine-grained tokens never call the Checks API',
  );
});

test('X04 REST contract: app installation tokens are minted per repository and permission', async (t) => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', {
    modulusLength: 2048,
  });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  let minted = 0;
  const gh = await loopbackGitHub((s) => {
    if (s.auth.startsWith('Bearer ey')) {
      // App JWT: RS256 over header.payload, issuer is the client id, at most 10 minutes.
      const [h, p, sig] = s.auth.slice(7).split('.');
      assert.ok(
        verify(
          'RSA-SHA256',
          Buffer.from(`${h}.${p}`),
          publicKey,
          Buffer.from(sig!, 'base64url'),
        ),
      );
      const claims = JSON.parse(
        Buffer.from(p!, 'base64url').toString(),
      ) as Record<string, number | string>;
      assert.equal(claims.iss, 'Iv1.fixture');
      assert.ok(Number(claims.exp) - Number(claims.iat) <= 600);
      if (s.path === '/app/installations/77')
        return {
          status: 200,
          body: { account: { login: 'acct', id: 11, type: 'Organization' } },
        };
      minted++;
      return {
        status: 201,
        body: {
          token: `inst-${minted}`,
          expires_at: new Date(Date.now() + 3_600_000).toISOString(),
        },
      };
    }
    if (s.path.endsWith('/check-runs?filter=latest&per_page=100'))
      return {
        status: 200,
        body: {
          check_runs: [
            {
              name: 'ci',
              head_sha: SHA,
              status: 'completed',
              conclusion: 'success',
            },
          ],
        },
      };
    if (s.path.endsWith('/status'))
      return { status: 200, body: { sha: SHA, statuses: [] } };
    if (s.path.endsWith('/issues')) return { status: 201, body: { number: 4 } };
    return { status: 500, body: {} };
  });
  t.after(gh.close);
  const a = new LiveGitHub({
    credential: {
      kind: 'app_installation',
      client_id: 'Iv1.fixture',
      private_key: pem,
      installation_id: 77,
    },
    apiBase: gh.base,
  });
  assert.deepEqual((await a.identity()).identity, {
    login: 'acct',
    id: 11,
    type: 'Organization',
  });
  const checks = await a.checks(repo, SHA);
  assert.equal(checks.check_runs_readable, true);
  assert.deepEqual(
    checks.checks.map((c) => `${c.source}:${c.name}:${c.conclusion}`),
    ['check_run:ci:success'],
  );
  assert.equal((await a.createIssue(repo, 'T', '')).status, 201);
  assert.equal((await a.createIssue(repo, 'T2', '')).status, 201);
  const mints = gh.seen.filter((s) => s.path.endsWith('/access_tokens'));
  assert.deepEqual(
    mints.map((m) => m.body),
    [
      { repository_ids: [501], permissions: { checks: 'read' } },
      { repository_ids: [501], permissions: { statuses: 'read' } },
      { repository_ids: [501], permissions: { issues: 'write' } },
    ],
  );
  // The second issue reused the cached, still-valid token for the same scope.
  assert.equal(
    gh.seen
      .filter((s) => s.path.endsWith('/issues'))
      .map((s) => s.auth)
      .join(),
    'Bearer inst-3,Bearer inst-3',
  );
  // A 5xx while minting leaves the call unanswered, not refused.
  const r = await a.createBranch(
    { github_id: 502, full_name: 'acct/ca-b' },
    'creator/x',
    SHA,
  );
  assert.equal(r.status, 500);
});

test('X04 Git contract: pushes exact commits without force; the token stays out of output and config', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'creator-x04-git-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync('git', args, {
      cwd,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
        ...(process.env.SystemRoot
          ? { SystemRoot: process.env.SystemRoot }
          : {}),
        GIT_AUTHOR_NAME: 'b',
        GIT_AUTHOR_EMAIL: 'b@invalid',
        GIT_COMMITTER_NAME: 'b',
        GIT_COMMITTER_EMAIL: 'b@invalid',
      },
    })
      .toString()
      .trim();
  mkdirSync(join(root, 'remote', 'acct'), { recursive: true });
  git(join(root, 'remote', 'acct'), 'init', '-q', '--bare', 'ca-app.git');
  const src = join(root, 'src');
  mkdirSync(src);
  git(src, 'init', '-q', '-b', 'main');
  writeFileSync(join(src, 'a.txt'), '1');
  git(src, 'add', '-A');
  git(src, 'commit', '-q', '-m', 'one');
  const one = git(src, 'rev-parse', 'HEAD');
  writeFileSync(join(src, 'a.txt'), '2');
  git(src, 'commit', '-q', '-am', 'two');
  const two = git(src, 'rev-parse', 'HEAD');
  // A Git base other than github.com exists only for this contract test (a local bare repo).
  const a = new LiveGitHub({
    credential: { kind: 'fine_grained_pat', token: 'pat-never-in-argv' },
    gitBase: pathToFileURL(join(root, 'remote')).href,
  });
  const r = { github_id: 1, full_name: 'acct/ca-app' };
  assert.equal((await a.push(r, 'creator/x', two, src, false)).status, 200);
  assert.equal(
    git(join(root, 'remote', 'acct', 'ca-app.git'), 'rev-parse', 'creator/x'),
    two,
  );
  // Moving the branch backwards would need a force push, which is never sent.
  const back = await a.push(r, 'creator/x', one, src, false);
  assert.equal(back.status, 409);
  assert.equal(
    git(join(root, 'remote', 'acct', 'ca-app.git'), 'rev-parse', 'creator/x'),
    two,
  );
  assert.ok(!JSON.stringify(back).includes('pat-never-in-argv'));
  // The credential never lands in the product repository's config.
  assert.ok(!git(src, 'config', '--list', '--local').includes('extraheader'));
});

test('P22 review M-1: a refused pull or statuses read is a refusal, a 404 is "no pull request"', async (t) => {
  let mode:
    | 'ok'
    | 'expired'
    | 'statuses_forbidden'
    | 'unavailable'
    | 'rate_limited'
    | 'secondary_limit'
    | 'malformed' = 'ok';
  const gh = await loopbackGitHub((s) => {
    if (mode === 'expired')
      return { status: 401, body: { message: 'Bad credentials' } };
    if (mode === 'unavailable')
      return { status: 503, body: { message: 'Service Unavailable' } };
    if (mode === 'rate_limited')
      return {
        status: 403,
        headers: { 'x-ratelimit-remaining': '0' },
        body: { message: 'API rate limit exceeded' },
      };
    if (mode === 'secondary_limit')
      return {
        status: 403,
        headers: { 'retry-after': '60' },
        body: { message: 'You have exceeded a secondary rate limit' },
      };
    if (mode === 'malformed') return { status: 200, body: { id: 'x' } };
    if (s.path.endsWith('/pulls/1'))
      return {
        status: 200,
        body: {
          state: 'open',
          merged: false,
          head: { sha: SHA, ref: 'creator/p22-trial' },
          base: { ref: 'creator/p22-base' },
        },
      };
    if (s.path.endsWith(`/commits/${SHA}/status`))
      return mode === 'statuses_forbidden'
        ? {
            status: 403,
            body: {
              message: 'Resource not accessible by personal access token',
            },
          }
        : { status: 200, body: { sha: SHA, statuses: [] } };
    return { status: 404, body: { message: 'Not Found' } };
  });
  t.after(gh.close);
  const a = new LiveGitHub({
    credential: { kind: 'fine_grained_pat', token: 'pat-secret' },
    apiBase: gh.base,
  });
  // Read, with no statuses: an empty list that is evidence of absence.
  const read = await a.pullRead(repo, 1);
  assert.equal(read.refusal, null);
  assert.equal(read.pull?.head_sha, SHA);
  assert.deepEqual(await a.checks(repo, SHA), {
    checks: [],
    check_runs_readable: false,
    refusals: [],
  });
  // No such pull request: not a refusal.
  assert.deepEqual(await a.pullRead(repo, 2), { pull: null, refusal: null });
  // A refused statuses read is reported, not shown as "no checks".
  mode = 'statuses_forbidden';
  const partial = await a.checks(repo, SHA);
  assert.deepEqual(partial.checks, []);
  assert.deepEqual(
    partial.refusals.map((r) => `${r.step}:${r.status}`),
    ['statuses:403'],
  );
  // An expired or revoked token is a refusal, not "no pull request".
  mode = 'expired';
  const refused = await a.pullRead(repo, 1);
  assert.equal(refused.pull, null);
  assert.deepEqual(refused.refusal, {
    step: 'pull',
    status: 401,
    message: 'Bad credentials',
  });
  // The merge gate's pull() keeps its old meaning: nothing usable was read.
  assert.equal(await a.pull(repo, 1), null);
  // Re-review N-L1: the repository lookup keeps GitHub's real status. A 401 is an access
  // problem; a 503 is GitHub not answering, never "the token may be expired".
  const denied = await a.repositoryRead(repo.github_id);
  assert.equal(denied.repository, null);
  assert.equal(denied.refusal?.status, 401);
  assert.match(denied.refusal!.message, /expired or revoked/);
  mode = 'unavailable';
  const down = await a.repositoryRead(repo.github_id);
  assert.equal(down.refusal?.step, 'repository');
  assert.equal(down.refusal?.status, 503);
  assert.match(down.refusal!.message, /did not answer.*Try again/);
  assert.doesNotMatch(down.refusal!.message, /expired|revoked/);
  // Re-review N2-L1: GitHub answers a rate limit with 403 too; that is "try again", not the
  // token, and GitHub's own message is kept.
  for (const m of ['rate_limited', 'secondary_limit'] as const) {
    mode = m;
    const limited = await a.repositoryRead(repo.github_id);
    assert.equal(limited.refusal?.status, 403);
    assert.match(limited.refusal!.message, /rate-limiting.*Try again/);
    assert.match(limited.refusal!.message, /GitHub said: .*rate limit/);
    assert.doesNotMatch(limited.refusal!.message, /expired|revoked/);
    assert.ok(limited.refusal!.message.length <= 300);
  }
  // A 200 whose body is not a repository is an unreadable reply, not "did not answer".
  mode = 'malformed';
  const odd = await a.repositoryRead(repo.github_id);
  assert.equal(odd.refusal?.status, 200);
  assert.match(odd.refusal!.message, /could not be read/);
});

test('P22 nits: a secondary rate limit without retry-after, and a read with no answer, are worded as such', () => {
  const r = (status: number | null, message: string, headers = {}) =>
    repositoryRefusal({ status, headers, data: null, message });
  const secondary = r(403, 'You have exceeded a secondary rate limit.');
  assert.match(secondary.message, /rate-limiting.*Try again/);
  assert.doesNotMatch(secondary.message, /expired|revoked/);
  // A plain 403 without any rate-limit sign still points at the credential.
  assert.match(
    r(403, 'Resource not accessible by personal access token').message,
    /expired or revoked/,
  );
  // No HTTP answer: the detail is the studio's own error, never "GitHub said".
  const hung = r(null, 'timeout');
  assert.equal(hung.status, null);
  assert.match(
    hung.message,
    /did not answer.*Studio error, no answer from GitHub: timeout/,
  );
  assert.doesNotMatch(hung.message, /GitHub said/);
  assert.match(
    r(503, 'Service Unavailable').message,
    /GitHub said: Service Unavailable/,
  );
});

test('P22 nits: GitHub App token failures say what failed, not "try again"', async (t) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  let mint: {
    status: number;
    body: unknown;
    headers?: Record<string, string>;
  } = {
    status: 422,
    body: {
      message:
        'There is at least one repository that does not exist or is not accessible to the parent installation.',
    },
  };
  const gh = await loopbackGitHub((s) =>
    s.path.endsWith('/access_tokens')
      ? mint
      : { status: 500, body: { message: 'should not be reached' } },
  );
  t.after(gh.close);
  const app = (private_key: string) =>
    new LiveGitHub({
      credential: {
        kind: 'app_installation',
        client_id: 'Iv1.fixture',
        private_key,
        installation_id: 77,
      },
      apiBase: gh.base,
    });
  // A private key that cannot sign: GitHub is never asked, and retrying will not help.
  const local = await app('not a private key').repositoryRead(repo.github_id);
  assert.equal(gh.seen.length, 0);
  assert.equal(local.refusal?.status, null);
  assert.match(local.refusal!.message, /could not get a GitHub App token/);
  assert.match(local.refusal!.message, /check the App credential/);
  assert.doesNotMatch(local.refusal!.message, /Try again|did not answer/);
  assert.doesNotMatch(local.refusal!.message, /not a private key/);
  // The repository was removed from the installation: GitHub refused the token (422).
  const removed = await app(pem).repositoryRead(repo.github_id);
  assert.equal(removed.refusal?.status, 422);
  assert.match(removed.refusal!.message, /refused a GitHub App token/);
  assert.match(removed.refusal!.message, /GitHub said: There is at least one/);
  assert.doesNotMatch(removed.refusal!.message, /did not answer|Try again/);
  // A rate-limited token request is still "try again".
  mint = {
    status: 403,
    headers: { 'x-ratelimit-remaining': '0' },
    body: { message: 'API rate limit exceeded' },
  };
  const limited = await app(pem).repositoryRead(repo.github_id);
  assert.match(limited.refusal!.message, /rate-limiting.*Try again/);
  // Nothing past the token step was requested.
  assert.ok(gh.seen.every((s) => s.path.endsWith('/access_tokens')));
});

test('P22 re-review 5: the App token step is named, and its 404 is never "no such pull request"', async (t) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  let mint: { status: number; body: unknown } = {
    status: 404,
    body: { message: 'Not Found' },
  };
  const gh = await loopbackGitHub((s) =>
    s.path.endsWith('/access_tokens')
      ? mint
      : { status: 500, body: { message: 'should not be reached' } },
  );
  t.after(gh.close);
  const a = new LiveGitHub({
    credential: {
      kind: 'app_installation',
      client_id: 'Iv1.fixture',
      private_key: pem,
      installation_id: 77,
    },
    apiBase: gh.base,
  });
  // L-1: the installation is gone (404 on the token request): a refusal, not "no pull request".
  const gone = await a.pullRead(repo, 1);
  assert.equal(gone.pull, null);
  assert.equal(gone.refusal?.step, 'pull');
  assert.equal(gone.refusal?.status, 404);
  assert.match(gone.refusal!.message, /refused a GitHub App token/);
  // Nit 1: a 401 at the token step points at the App credential.
  mint = {
    status: 401,
    body: { message: 'A JSON web token could not be decoded' },
  };
  const badKey = await a.repositoryRead(repo.github_id);
  assert.match(badKey.refusal!.message, /App id or private key may be wrong/);
  assert.doesNotMatch(badKey.refusal!.message, /no longer be installed/);
  // Nit 2: a 5xx, or a 201 without a token, names the token step, not the read.
  for (const m of [
    { status: 502, body: { message: 'Bad Gateway' } },
    { status: 201, body: {} },
  ]) {
    mint = m;
    for (const r of [
      (await a.repositoryRead(repo.github_id)).refusal!,
      (await a.checks(repo, SHA)).refusals[0]!,
    ]) {
      assert.equal(r.status, m.status);
      assert.match(
        r.message,
        /did not give a GitHub App token \(the token step failed\)/,
      );
      assert.doesNotMatch(r.message, /repository read/);
    }
  }
  assert.ok(gh.seen.every((s) => s.path.endsWith('/access_tokens')));
});

test('P22 re-review 6: a 429 at the App token step is a rate limit; its reply is never read as checks', async (t) => {
  const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
  let mint: { status: number; body: unknown } = { status: 429, body: {} };
  const gh = await loopbackGitHub((s) =>
    s.path.endsWith('/access_tokens')
      ? mint
      : { status: 500, body: { message: 'should not be reached' } },
  );
  t.after(gh.close);
  const a = new LiveGitHub({
    credential: {
      kind: 'app_installation',
      client_id: 'Iv1.fixture',
      private_key: pem,
      installation_id: 77,
    },
    apiBase: gh.base,
  });
  // A bare 429, no rate-limit headers or message.
  const limited = await a.repositoryRead(repo.github_id);
  assert.equal(limited.refusal?.status, 429);
  assert.match(limited.refusal!.message, /rate-limiting.*Try again/);
  // A token reply without a token, shaped like check results, gives no checks.
  mint = {
    status: 201,
    body: {
      sha: SHA,
      check_runs: [
        {
          name: 'ci',
          head_sha: SHA,
          status: 'completed',
          conclusion: 'success',
        },
      ],
      statuses: [{ context: 'lint', state: 'success' }],
    },
  };
  const c = await a.checks(repo, SHA);
  assert.deepEqual(c.checks, []);
  assert.deepEqual(
    c.refusals.map((r) => `${r.step}:${r.status}`),
    ['check_runs:201', 'statuses:201'],
  );
  assert.ok(gh.seen.every((s) => s.path.endsWith('/access_tokens')));
});
