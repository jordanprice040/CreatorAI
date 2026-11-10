import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  ContractError,
  GitHubLimitsSchema,
  type ErrorCode,
  type GitHubConnection,
  type GitHubOperation,
} from '@creator/contracts';
import { ContextStore, type CommandContext } from '@creator/db';
import { FixtureGitHub, GitHubService } from '@creator/broker';
import { freshDatabase } from './pg-harness.js';

// X04 acceptance on the fixture GitHub (labelled: no live GitHub call is made here). Covers
// wrong owner, stale head, missing checks, uncertain effects, revocation and scope limits.
const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const agent: CommandContext = { actorId: randomUUID() };
const reviewer: CommandContext = { actorId: randomUUID() };
const webhookActor: CommandContext = { actorId: randomUUID() };
const OWNER = { login: 'fixture-owner', id: 4_100_001, type: 'User' as const };
const SECRET = 'fixture-webhook-secret-0123456789';

function gitRepo() {
  const dir = mkdtempSync(join(tmpdir(), 'creator-x04-'));
  const run = (...args: string[]) =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        GIT_CONFIG_NOSYSTEM: '1',
        GIT_CONFIG_GLOBAL: '/dev/null',
        GIT_AUTHOR_NAME: 'Fixture builder',
        GIT_AUTHOR_EMAIL: 'builder@invalid',
        GIT_COMMITTER_NAME: 'Fixture builder',
        GIT_COMMITTER_EMAIL: 'builder@invalid',
      },
    })
      .toString()
      .trim();
  run('init', '-q', '-b', 'main');
  const commit = (path: string, text: string) => {
    mkdirSync(join(dir, path, '..'), { recursive: true });
    writeFileSync(join(dir, path), text);
    run('add', '-A');
    run('commit', '-q', '-m', `edit ${path}`);
    return run('rev-parse', 'HEAD');
  };
  return {
    dir,
    run,
    commit,
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ContextStore(db.pool);
  for (const [a, kind] of [
    [owner, 'human'],
    [agent, 'agent'],
    [reviewer, 'human'],
    [webhookActor, 'system'],
  ] as const)
    await store.ensureActor({ id: a.actorId, kind, display_name: kind });
  const local = gitRepo();
  t.after(local.cleanup);
  const fixtures = new Map<string, FixtureGitHub>();
  const service = (
    env: Record<string, string | undefined> = {},
    live?: FixtureGitHub,
  ) =>
    new GitHubService(store, {
      env: { CREATOR_GITHUB_HOOK_SECRET: SECRET, ...env },
      pushSource: () => local.dir,
      fixture: (c) => {
        const f = fixtures.get(c.body.label) ?? new FixtureGitHub(OWNER);
        fixtures.set(c.body.label, f);
        return f;
      },
      // A labelled stand-in for the live adapter: real-workspace rules with no network.
      ...(live ? { live: () => live } : {}),
    });
  async function workspace(mode: 'fixture' | 'real', actions: string[]) {
    const ws = await store.createWorkspace(owner, {
      name: `GitHub ${mode}`,
      record_mode: mode,
    });
    await store.addMember(owner, ws.id, agent.actorId, 'editor');
    await store.addMember(owner, ws.id, reviewer.actorId, 'editor');
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: 'GitHub run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    const control = await store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: 'human_in_loop',
      stage_gates: null,
      initial_grants: [],
    });
    if (actions.length)
      await store.createStandingGrant(owner, ws.id, {
        run_id: control.run_id,
        action_types: actions,
        target_kind: null,
        max_amount_nano_usd: null,
        allow_irreversible: true,
        allow_external_effects: true,
        data_classes: ['synthetic'],
        expires_at: new Date(Date.now() + 86_400_000).toISOString(),
        rationale: 'Owner-approved routine GitHub work on studio repositories.',
      });
    return { ws: ws.id, run: control.run_id };
  }
  const connection = (
    label: string,
    over: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    label,
    mode: 'fixture',
    owner: OWNER,
    credential: { kind: 'fixture' },
    webhook_secret_env: 'CREATOR_GITHUB_HOOK_SECRET',
    limits: {
      repo_prefix: 'ca-',
      branch_prefix: 'creator/',
      max_repositories: 2,
      max_mutations_per_hour: 40,
      max_open_prs_per_repo: 2,
    },
    required_checks: ['ci'],
    included_repositories: [],
    ...over,
  });
  return { store, service, fixtures, local, workspace, connection };
}
const op = (
  conn: GitHubConnection,
  run: string,
  params: Record<string, unknown>,
) => ({
  connection_id: conn.id,
  run_id: run,
  task_id: null,
  data_class: 'synthetic',
  justification: 'Fixture GitHub acceptance step.',
  params,
});
const state = (o: GitHubOperation) => `${o.state}:${o.reason_code}`;

test('X04 owner verification, scope limits, push, review, checks and exact-head merge', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, local, fixtures } = s;
  const svc = s.service();
  const { ws, run } = await s.workspace('fixture', [
    'github.repo_create',
    'github.write',
    'github.merge',
  ]);

  // Wrong owner: the credential's account is not the configured owner.
  fixtures.set(
    'wrong',
    new FixtureGitHub({ login: 'someone-else', id: 77, type: 'User' }),
  );
  const wrong = await store.registerGitHubConnection(
    owner,
    ws,
    s.connection('wrong'),
  );
  await rejects(
    'ACCESS_DENIED',
    store.registerGitHubConnection(agent, ws, s.connection('x')),
  );
  const checked = await svc.verify(owner, ws, wrong.id);
  assert.equal(checked.connection.status, 'unverified');
  assert.equal(checked.connection.verification?.result, 'wrong_owner');
  const blocked = await svc.operate(
    owner,
    ws,
    op(wrong, run, { kind: 'repo_create', name: 'ca-app', description: '' }),
  );
  assert.equal(state(blocked), 'refused:connection_unverified');
  assert.deepEqual(fixtures.get('wrong')!.calls, ['identity']);

  // Verified owner; an included personal repository that is public stays out of use.
  const gh = new FixtureGitHub(OWNER);
  fixtures.set('main', gh);
  const personal = gh.seedRepository('school-notes', { private: false });
  const conn = (
    await svc.verify(
      owner,
      ws,
      (
        await store.registerGitHubConnection(
          owner,
          ws,
          s.connection('main', {
            included_repositories: [
              { github_id: personal, full_name: 'fixture-owner/school-notes' },
            ],
          }),
        )
      ).id,
    )
  ).connection;
  assert.equal(conn.status, 'active');
  const [included] = await store.listGitHubRepositories(owner, ws);
  assert.equal(included?.status, 'quarantined');

  // Prefix and count limits refuse before anything is sent.
  const badName = await svc.operate(
    owner,
    ws,
    op(conn, run, { kind: 'repo_create', name: 'myapp', description: '' }),
  );
  assert.equal(state(badName), 'refused:repo_prefix');
  const created = await svc.operate(
    agent,
    ws,
    op(conn, run, {
      kind: 'repo_create',
      name: 'ca-app',
      description: 'Studio product',
    }),
  );
  assert.equal(state(created), 'succeeded:succeeded');
  const repo = (await store.listGitHubRepositories(owner, ws)).find(
    (r) => r.origin === 'created',
  )!;
  assert.equal(repo.status, 'active');
  assert.equal(gh.repoState(repo.github_id).private, true);
  assert.equal(
    state(
      await svc.operate(
        agent,
        ws,
        op(conn, run, { kind: 'repo_create', name: 'ca-two', description: '' }),
      ),
    ),
    'succeeded:succeeded',
  );
  assert.equal(
    state(
      await svc.operate(
        agent,
        ws,
        op(conn, run, {
          kind: 'repo_create',
          name: 'ca-three',
          description: '',
        }),
      ),
    ),
    'refused:repository_limit',
  );

  // Push a local commit to a studio branch; branch prefix enforced; workflow edits need their own grant.
  const c1 = local.commit('src/app.txt', 'v1');
  const outside = await svc.operate(
    agent,
    ws,
    op(conn, run, {
      kind: 'push',
      repository_id: repo.id,
      branch: 'main',
      product_id: randomUUID(),
      sha: c1,
      base_sha: null,
    }),
  );
  assert.equal(state(outside), 'refused:branch_prefix');
  const pushed = await svc.operate(
    agent,
    ws,
    op(conn, run, {
      kind: 'push',
      repository_id: repo.id,
      branch: 'creator/feature',
      product_id: randomUUID(),
      sha: c1,
      base_sha: null,
    }),
  );
  assert.equal(state(pushed), 'succeeded:succeeded');
  const before = local.run('rev-parse', 'HEAD');
  const wf = local.commit('.github/workflows/ci.yml', 'on: push');
  const workflow = await svc.operate(
    agent,
    ws,
    op(conn, run, {
      kind: 'push',
      repository_id: repo.id,
      branch: 'creator/feature',
      product_id: randomUUID(),
      sha: wf,
      base_sha: c1,
    }),
  );
  assert.equal(workflow.action_type, 'github.workflow_change');
  assert.equal(state(workflow), 'refused:admission_waiting_human');
  assert.equal(
    gh.repoState(repo.github_id).branches.get('creator/feature'),
    c1,
  );
  local.run('reset', '-q', '--hard', before);
  // A stale base is refused instead of overwriting the remote branch.
  const c2 = local.commit('src/app.txt', 'v2');
  const stale = await svc.operate(
    agent,
    ws,
    op(conn, run, {
      kind: 'push',
      repository_id: repo.id,
      branch: 'creator/feature',
      product_id: randomUUID(),
      sha: c2,
      base_sha: null,
    }),
  );
  assert.equal(state(stale), 'refused:stale_base');
  assert.equal(
    state(
      await svc.operate(
        agent,
        ws,
        op(conn, run, {
          kind: 'push',
          repository_id: repo.id,
          branch: 'creator/feature',
          product_id: randomUUID(),
          sha: c2,
          base_sha: c1,
        }),
      ),
    ),
    'succeeded:succeeded',
  );

  const pr = await svc.operate(
    agent,
    ws,
    op(conn, run, {
      kind: 'pr_open',
      repository_id: repo.id,
      head_branch: 'creator/feature',
      base_branch: 'main',
      title: 'Add app',
      body: '',
    }),
  );
  assert.equal(state(pr), 'succeeded:succeeded');
  const number = pr.result?.number as number;
  const merge = (sha: string) =>
    svc.operate(
      agent,
      ws,
      op(conn, run, {
        kind: 'pr_merge',
        repository_id: repo.id,
        pr_number: number,
        reviewed_head_sha: sha,
        merge_method: 'merge',
      }),
    );
  assert.equal(state(await merge(c2)), 'refused:review_missing');
  // The actor who pushed this head cannot be its reviewer.
  await store.recordGitHubReview(agent, ws, {
    repository_id: repo.id,
    pr_number: number,
    head_sha: c2,
    verdict: 'approve',
    note: 'Looks fine to me.',
  });
  assert.equal(state(await merge(c2)), 'refused:review_not_independent');
  await store.recordGitHubReview(reviewer, ws, {
    repository_id: repo.id,
    pr_number: number,
    head_sha: c2,
    verdict: 'approve',
    note: 'Reviewed diff and tests at this head.',
  });
  // Missing, pending and failed checks on the exact head.
  assert.equal(state(await merge(c2)), 'refused:check_missing');
  gh.setCheck(repo.github_id, c1, 'ci', 'success'); // an older head's pass does not count
  assert.equal(state(await merge(c2)), 'refused:check_missing');
  gh.setCheck(repo.github_id, c2, 'ci', null);
  assert.equal(state(await merge(c2)), 'refused:check_pending');
  gh.setCheck(repo.github_id, c2, 'ci', 'failure');
  assert.equal(state(await merge(c2)), 'refused:check_failed');
  // P22: the owner can read the pull request's head and checks without journaling anything;
  // other members cannot use the connection's credential to read.
  const opsBefore = (await store.listGitHubOperations(owner, ws)).length;
  const read = await svc.pullChecks(owner, ws, repo.id, number);
  assert.equal(read.pull?.head_sha, c2);
  assert.deepEqual(
    read.checks.map((x) => `${x.name}:${x.conclusion}`),
    ['ci:failure'],
  );
  assert.equal((await store.listGitHubOperations(owner, ws)).length, opsBefore);
  await assert.rejects(svc.pullChecks(agent, ws, repo.id, number), /owner/i);
  assert.equal((await svc.pullChecks(owner, ws, repo.id, 9999)).pull, null);
  gh.setCheck(repo.github_id, c2, 'ci', 'success');
  // Someone pushes after review: the reviewed head is stale, and so are its approval and checks.
  const c3 = local.commit('src/app.txt', 'v3');
  gh.moveHead(repo.github_id, number, c3);
  assert.equal(state(await merge(c2)), 'refused:stale_head');
  assert.equal(state(await merge(c3)), 'refused:review_missing');
  await store.recordGitHubReview(reviewer, ws, {
    repository_id: repo.id,
    pr_number: number,
    head_sha: c3,
    verdict: 'approve',
    note: 'Re-reviewed the new head.',
  });
  gh.setCheck(repo.github_id, c3, 'ci', 'success');
  // The head moving between our read and GitHub's merge is refused by GitHub's sha check (409).
  gh.failNext('merge', 409);
  assert.equal(state(await merge(c3)), 'failed:stale_head');
  const merged = await merge(c3);
  assert.equal(state(merged), 'succeeded:succeeded');
  assert.equal((merged.gate?.pull as { head_sha: string }).head_sha, c3);
  assert.equal(gh.repoState(repo.github_id).pulls.get(number)?.merged, true);
  // Every dispatched change was admitted under a grant; refusals before admission sent nothing.
  const ops = await store.listGitHubOperations(owner, ws);
  for (const o of ops)
    if (o.state !== 'refused')
      assert.ok(o.admission_id, `${o.kind} was admitted`);
});

test('X04 uncertain effects reconcile from GitHub; no retry while unknown', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, local, fixtures } = s;
  const svc = s.service();
  const { ws, run } = await s.workspace('fixture', [
    'github.repo_create',
    'github.write',
    'github.merge',
  ]);
  const gh = new FixtureGitHub(OWNER);
  fixtures.set('main', gh);
  const conn = (
    await svc.verify(
      owner,
      ws,
      (await store.registerGitHubConnection(owner, ws, s.connection('main')))
        .id,
    )
  ).connection;

  // Created on GitHub, but the answer was lost.
  gh.failNext('createRepository', 'no_response_after_effect');
  const lost = await svc.operate(
    agent,
    ws,
    op(conn, run, { kind: 'repo_create', name: 'ca-app', description: '' }),
  );
  assert.equal(state(lost), 'unknown:no_response');
  assert.equal((await store.listGitHubRepositories(owner, ws)).length, 0);
  // Neither the same creation nor any other creation proceeds until it is reconciled.
  assert.equal(
    state(
      await svc.operate(
        agent,
        ws,
        op(conn, run, { kind: 'repo_create', name: 'ca-app', description: '' }),
      ),
    ),
    'refused:reconcile_first',
  );
  assert.equal(
    state(
      await svc.operate(
        agent,
        ws,
        op(conn, run, {
          kind: 'repo_create',
          name: 'ca-other',
          description: '',
        }),
      ),
    ),
    'refused:reconcile_first',
  );
  await rejects(
    'INVALID_TRANSITION',
    svc.reconcile(
      agent,
      ws,
      (
        await svc.operate(
          agent,
          ws,
          op(conn, run, { kind: 'repo_create', name: 'ca-x', description: '' }),
        )
      ).id,
    ),
  );
  const adopted = await svc.reconcile(agent, ws, lost.id);
  assert.equal(state(adopted), 'reconciled_succeeded:found_on_github');
  const [repo] = await store.listGitHubRepositories(owner, ws);
  assert.equal(repo?.created_operation_id, lost.id);
  assert.equal(repo?.status, 'active');

  // Lost before it reached GitHub: reconciliation finds nothing and the push may be retried.
  const c1 = local.commit('a.txt', '1');
  gh.failNext('push', 'no_response_before_effect');
  const push = {
    kind: 'push',
    repository_id: repo!.id,
    branch: 'creator/a',
    product_id: randomUUID(),
    sha: c1,
    base_sha: null,
  };
  const unsent = await svc.operate(agent, ws, op(conn, run, push));
  assert.equal(state(unsent), 'unknown:no_response');
  assert.equal(
    state(await svc.reconcile(agent, ws, unsent.id)),
    'reconciled_absent:absent_on_github',
  );
  assert.equal(
    state(await svc.operate(agent, ws, op(conn, run, push))),
    'succeeded:succeeded',
  );

  // A merge whose answer was lost is settled by reading the pull request.
  const pr = await svc.operate(
    agent,
    ws,
    op(conn, run, {
      kind: 'pr_open',
      repository_id: repo!.id,
      head_branch: 'creator/a',
      base_branch: 'main',
      title: 'A',
      body: '',
    }),
  );
  const number = pr.result?.number as number;
  await store.recordGitHubReview(reviewer, ws, {
    repository_id: repo!.id,
    pr_number: number,
    head_sha: c1,
    verdict: 'approve',
    note: 'Reviewed.',
  });
  gh.setCheck(repo!.github_id, c1, 'ci', 'success');
  gh.failNext('merge', 'no_response_after_effect');
  const m = await svc.operate(
    agent,
    ws,
    op(conn, run, {
      kind: 'pr_merge',
      repository_id: repo!.id,
      pr_number: number,
      reviewed_head_sha: c1,
      merge_method: 'squash',
    }),
  );
  assert.equal(state(m), 'unknown:no_response');
  assert.equal(
    state(await svc.reconcile(agent, ws, m.id)),
    'reconciled_succeeded:found_on_github',
  );
  await rejects('INVALID_TRANSITION', svc.reconcile(agent, ws, m.id));
  // The journal refuses rewriting a settled outcome.
  await assert.rejects(
    (store as unknown as { pool: import('pg').Pool }).pool.query(
      `update github_operations set state = 'unknown' where id = $1`,
      [m.id],
    ),
  );

  // A retried request with the same idempotency key is answered from the journal, not resent.
  const keyed = { ...agent, idempotencyKey: 'x04-issue-0001' };
  const issue = op(conn, run, {
    kind: 'issue_create',
    repository_id: repo!.id,
    title: 'Track feedback',
    body: '',
  });
  const first = await svc.operate(keyed, ws, issue);
  const again = await svc.operate(keyed, ws, issue);
  assert.equal(again.id, first.id);
  assert.equal(gh.calls.filter((c) => c === 'createIssue').length, 1);
});

test('X04 revocation, expiry, lost scope and verified, deduplicated webhooks', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, local, fixtures } = s;
  const svc = s.service();
  const { ws, run } = await s.workspace('fixture', [
    'github.repo_create',
    'github.write',
  ]);
  const gh = new FixtureGitHub(OWNER);
  fixtures.set('main', gh);
  const conn = (
    await svc.verify(
      owner,
      ws,
      (await store.registerGitHubConnection(owner, ws, s.connection('main')))
        .id,
    )
  ).connection;
  await svc.operate(
    agent,
    ws,
    op(conn, run, { kind: 'repo_create', name: 'ca-a', description: '' }),
  );
  await svc.operate(
    agent,
    ws,
    op(conn, run, { kind: 'repo_create', name: 'ca-b', description: '' }),
  );
  const [a, b] = await store.listGitHubRepositories(owner, ws);

  // Webhooks: a bad signature is recorded and ignored; a good one applies once per delivery id.
  const hook = async (
    event: string,
    delivery: string,
    payload: unknown,
    secret = SECRET,
  ) => {
    const raw = Buffer.from(JSON.stringify(payload));
    return svc.receiveWebhook(
      webhookActor,
      conn.id,
      {
        event,
        delivery,
        signature: `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`,
      },
      raw,
    );
  };
  const publicize = { action: 'publicized', repository: { id: a!.github_id } };
  assert.equal(
    (await hook('repository', 'd-1', publicize, 'wrong-secret')).status,
    401,
  );
  assert.equal(
    (await store.listGitHubRepositories(owner, ws))[0]?.status,
    'active',
  );
  const accepted = await hook('repository', 'd-2', publicize);
  assert.equal(accepted.status, 200);
  assert.deepEqual((accepted.body as { duplicate: boolean }).duplicate, false);
  const redelivered = await hook('repository', 'd-2', publicize);
  assert.equal((redelivered.body as { duplicate: boolean }).duplicate, true);
  const deliveries = await store.listGitHubDeliveries(owner, ws, conn.id);
  assert.deepEqual(
    deliveries.map((d) => d.status),
    ['rejected_signature', 'accepted'],
  );
  const issue = (id: string) =>
    op(conn, run, {
      kind: 'issue_create',
      repository_id: id,
      title: 'T',
      body: '',
    });
  assert.equal(
    state(await svc.operate(agent, ws, issue(a!.id))),
    'refused:repository_quarantined',
  );

  // Selected-repository scope removed: GitHub no longer returns it, so nothing is sent.
  gh.loseAccess(b!.github_id);
  assert.equal(
    state(await svc.operate(agent, ws, issue(b!.id))),
    'refused:repository_unreadable',
  );
  await hook('installation_repositories', 'd-3', {
    action: 'removed',
    repositories_removed: [{ id: b!.github_id }],
  });
  assert.equal(
    (await store.listGitHubRepositories(owner, ws))[1]?.status,
    'access_lost',
  );

  // Credential revoked at GitHub: the 401 marks the connection and later calls are not made.
  const c1 = local.commit('x.txt', '1');
  const conn2 = (
    await svc.verify(
      owner,
      ws,
      (await store.registerGitHubConnection(owner, ws, s.connection('second')))
        .id,
    )
  ).connection;
  const gh2 = fixtures.get('second')!;
  const r2 = await svc.operate(
    agent,
    ws,
    op(conn2, run, { kind: 'repo_create', name: 'ca-c', description: '' }),
  );
  assert.equal(state(r2), 'succeeded:succeeded');
  gh2.revoke();
  const repoC = (await store.listGitHubRepositories(owner, ws)).find(
    (r) => r.connection_id === conn2.id,
  )!;
  const push = {
    kind: 'push',
    repository_id: repoC.id,
    branch: 'creator/x',
    product_id: randomUUID(),
    sha: c1,
    base_sha: null,
  };
  const denied = await svc.operate(agent, ws, op(conn2, run, push));
  // The repository read fails first under a revoked credential, so nothing is sent.
  assert.equal(state(denied), 'refused:repository_unreadable');
  const callsBefore = gh2.calls.length;
  const created = await svc.operate(
    agent,
    ws,
    op(conn2, run, { kind: 'repo_create', name: 'ca-d', description: '' }),
  );
  assert.equal(state(created), 'failed:credential_rejected');
  assert.equal(
    (await store.getGitHubConnection(owner, ws, conn2.id)).status,
    'credential_rejected',
  );
  assert.equal(
    state(
      await svc.operate(
        agent,
        ws,
        op(conn2, run, { kind: 'repo_create', name: 'ca-e', description: '' }),
      ),
    ),
    'refused:connection_credential_rejected',
  );
  assert.equal(gh2.calls.length, callsBefore + 1);

  // Owner revocation is final and refuses before any call.
  const current = await store.getGitHubConnection(owner, ws, conn.id);
  await rejects(
    'ACCESS_DENIED',
    store.revokeGitHubConnection(agent, ws, conn.id, {
      expected_version: current.version,
      reason: 'x',
    }),
  );
  await store.revokeGitHubConnection(owner, ws, conn.id, {
    expected_version: current.version,
    reason: 'Project paused.',
  });
  const n = gh.calls.length;
  assert.equal(
    state(
      await svc.operate(
        agent,
        ws,
        op(conn, run, { kind: 'repo_create', name: 'ca-f', description: '' }),
      ),
    ),
    'refused:connection_revoked',
  );
  assert.equal(gh.calls.length, n);
  await rejects('INVALID_TRANSITION', svc.verify(owner, ws, conn.id));
});

test('X04 real workspaces: live off by default, expired tokens and missing grants send nothing', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store } = s;
  // Stand-in for GitHub behind the live adapter interface; no network call is made.
  const standIn = new FixtureGitHub(OWNER);
  const { ws, run } = await s.workspace('real', []);
  const live = (expires: string) =>
    s.connection('live', {
      mode: 'live',
      credential: {
        kind: 'fine_grained_pat',
        token_env: 'CREATOR_GITHUB_TOKEN',
        expires_at: expires,
      },
    });
  await rejects(
    'SCOPE_EXCEEDED',
    store.registerGitHubConnection(owner, ws, s.connection('fixture')),
  );
  const conn = await store.registerGitHubConnection(
    owner,
    ws,
    live(new Date(Date.now() + 86_400_000).toISOString()),
  );
  // Off by default: verification cannot even read the account.
  await rejects('LIVE_DISABLED', s.service().verify(owner, ws, conn.id));
  const on = s.service({ CREATOR_GITHUB: 'live' }, standIn);
  const active = (await on.verify(owner, ws, conn.id)).connection;
  assert.equal(active.status, 'active');
  const off = await s
    .service()
    .operate(
      agent,
      ws,
      op(active, run, { kind: 'repo_create', name: 'ca-app', description: '' }),
    );
  assert.equal(state(off), 'refused:live_disabled');
  // Live on, but no grant covers a GitHub mutation in this run: a person is asked, nothing sent.
  const ungranted = await on.operate(
    agent,
    ws,
    op(active, run, { kind: 'repo_create', name: 'ca-app', description: '' }),
  );
  assert.equal(state(ungranted), 'refused:admission_waiting_human');
  assert.deepEqual(standIn.calls, ['identity']);
  // A token past the expiry the owner recorded is refused before any call.
  const old = await store.registerGitHubConnection(
    owner,
    ws,
    live(new Date(Date.now() + 1000).toISOString()),
  );
  const oldActive = (await on.verify(owner, ws, old.id)).connection;
  await new Promise((r) => setTimeout(r, 1100));
  const expired = await on.operate(
    agent,
    ws,
    op(oldActive, run, {
      kind: 'repo_create',
      name: 'ca-app',
      description: '',
    }),
  );
  assert.equal(state(expired), 'refused:credential_expired');
  assert.deepEqual(standIn.calls, ['identity', 'identity']);
});

test('GitHub connection limits have no maximum, only a minimum of 1 (ADR-0062)', () => {
  const limits = {
    repo_prefix: 'ca-',
    branch_prefix: 'creator/',
    max_repositories: 5_000,
    max_mutations_per_hour: 100_000,
    max_open_prs_per_repo: 1_000,
  };
  assert.ok(GitHubLimitsSchema.safeParse(limits).success);
  for (const k of [
    'max_repositories',
    'max_mutations_per_hour',
    'max_open_prs_per_repo',
  ] as const)
    for (const bad of [0, 1.5, -1])
      assert.ok(
        !GitHubLimitsSchema.safeParse({ ...limits, [k]: bad }).success,
        `${k} ${bad}`,
      );
});
