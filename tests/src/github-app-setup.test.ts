import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPublicKey,
  generateKeyPairSync,
  randomUUID,
  verify,
} from 'node:crypto';
import { createServer, type Server } from 'node:http';
import {
  ContractError,
  type ErrorCode,
  type GitHubAppSetup,
  type GitHubConnection,
} from '@creator/contracts';
import { ContextStore, type CommandContext } from '@creator/db';
import { classifyResponse } from '@creator/domain';
import {
  GITHUB_APP_PERMISSIONS,
  GitHubAppSetupService,
  GitHubService,
  MemoryVault,
  githubAppManifest,
  refusalWording,
  appTokenWording,
  githubAnswer,
  LiveGitHub,
  parseConversion,
  startPage,
} from '@creator/broker';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { freshDatabase } from './pg-harness.js';

/** The page's step rule (type-only imports, so it loads on its own). */
async function loadSetupStep() {
  const source = await readFile(
    'apps/web/src/github-app-setup-rules.ts',
    'utf8',
  );
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {} as {
    setupStep: (s: GitHubAppSetup | null) => string;
    pollsGitHub: (step: string) => boolean;
  };
  new Function('exports', code)(exports);
  return Object.assign(exports.setupStep, { polls: exports.pollsGitHub });
}

// ADR-0132 (P32) acceptance against a loopback stand-in for GitHub (labelled: nothing here
// reaches github.com). The "browser" is this test following the studio's loopback pages and
// GitHub's redirects by hand.
const rejects = (code: ErrorCode, p: Promise<unknown>) =>
  assert.rejects(
    p,
    (e: unknown) => e instanceof ContractError && e.code === code,
  );
const owner: CommandContext = { actorId: randomUUID() };
const editor: CommandContext = { actorId: randomUUID() };
const ACCOUNT = { login: 'fixture-owner', id: 4_100_001, type: 'User' };
const OTHER = { login: 'someone-else', id: 4_100_999, type: 'User' };
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  privateKeyEncoding: { type: 'pkcs1', format: 'pem' },
  publicKeyEncoding: { type: 'spki', format: 'pem' },
});
const PEM = privateKey as unknown as string;
const LIMITS = {
  repo_prefix: 'creator-agent-',
  branch_prefix: 'creator/',
  max_repositories: 3,
  max_mutations_per_hour: 30,
  max_open_prs_per_repo: 3,
};

/** A loopback GitHub: manifest conversions and app-JWT reads, checking the JWT's signature. */
async function fakeGitHub() {
  const state = {
    conversions: 0,
    installations: [] as unknown[],
    conversion: 201,
    jwtIss: [] as string[],
  };
  const pub = createPublicKey(PEM);
  const jwtOk = (auth: string | undefined) => {
    const [h, p, sig] = (auth ?? '').replace(/^Bearer /, '').split('.');
    if (!h || !p || !sig) return false;
    const good = verify(
      'RSA-SHA256',
      Buffer.from(`${h}.${p}`),
      pub,
      Buffer.from(sig, 'base64url'),
    );
    if (good)
      state.jwtIss.push(
        String(JSON.parse(Buffer.from(p, 'base64url').toString()).iss),
      );
    return good;
  };
  const server: Server = createServer((req, res) => {
    const json = (status: number, v: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(v));
    };
    const url = new URL(req.url ?? '/', 'http://x');
    const conv = /^\/app-manifests\/([^/]+)\/conversions$/.exec(url.pathname);
    if (req.method === 'POST' && conv) {
      state.conversions++;
      if (conv[1] !== 'good-code' || state.conversion !== 201)
        return json(state.conversion === 201 ? 404 : state.conversion, {
          message: 'Not Found',
        });
      return json(201, {
        id: 777001,
        slug: 'creator-agent-abc123',
        node_id: 'x',
        client_id: 'Iv23fixtureclient',
        client_secret: 'fixture-client-secret',
        webhook_secret: null,
        pem: PEM,
        name: 'Creator Agent abc123',
        html_url: 'https://github.com/apps/creator-agent-abc123',
        owner: { ...ACCOUNT, node_id: 'y' },
      });
    }
    if (req.method === 'GET' && url.pathname === '/app/installations') {
      if (!jwtOk(req.headers.authorization))
        return json(401, { message: 'Bad credentials' });
      return json(200, state.installations);
    }
    const one = /^\/app\/installations\/(\d+)$/.exec(url.pathname);
    if (req.method === 'GET' && one) {
      if (!jwtOk(req.headers.authorization))
        return json(401, { message: 'Bad credentials' });
      return json(200, { id: Number(one[1]), account: ACCOUNT });
    }
    json(404, { message: 'Not Found' });
  });
  await new Promise<void>((ok) => server.listen(0, '127.0.0.1', ok));
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  return { state, base, close: () => server.close() };
}

async function setup(t: test.TestContext, mode: 'real' | 'fixture' = 'real') {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ContextStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  await store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'editor',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'GitHub App',
    record_mode: mode,
  });
  await store.addMember(owner, ws.id, editor.actorId, 'editor');
  const gh = await fakeGitHub();
  t.after(gh.close);
  const vault = new MemoryVault();
  const opened: string[] = [];
  const service = (
    o: { env?: Record<string, string>; vault?: MemoryVault | null } = {},
  ) => {
    const s = new GitHubAppSetupService(store, {
      env: o.env ?? { CREATOR_GITHUB: 'live' },
      vault: o.vault === undefined ? vault : o.vault,
      endpoints: { api: gh.base, web: gh.base },
      allowLoopbackEndpoints: true,
      openBrowser: (u) => opened.push(u),
    });
    t.after(() => s.close());
    return s;
  };
  return { db, store, ws, gh, vault, opened, service };
}

/** The browser's part: the start page's form, then GitHub's redirect back to the studio. */
async function followStart(startUrl: string) {
  const page = await fetch(startUrl);
  assert.equal(page.status, 200);
  const csp = page.headers.get('content-security-policy') ?? '';
  const html = await page.text();
  const action = /action="([^"]+)"/.exec(html)![1]!.replace(/&amp;/g, '&');
  const manifest = JSON.parse(
    /name="manifest" value="([^"]+)"/
      .exec(html)![1]!
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&amp;/g, '&'),
  ) as ReturnType<typeof githubAppManifest>;
  return { csp, action, manifest };
}

test('P32 GitHub App: create, install and connect from the studio; key only in the vault', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ws, gh, vault, opened } = s;
  const setupStep = await loadSetupStep();
  const svc = s.service();
  const started = await svc.begin(owner, ws.id, {
    organization: null,
    open_browser: true,
  });
  assert.deepEqual(opened, [started.start_url]);
  assert.equal(started.setup.status, 'waiting_for_github');
  assert.match(
    started.start_url,
    /^http:\/\/127\.0\.0\.1:\d+\/github-app\/start\?state=/,
  );
  const state = new URL(started.start_url).searchParams.get('state')!;

  // A link without this attempt's state is refused and records nothing.
  const local = new URL(started.start_url).origin;
  const forged = await fetch(
    `${local}/github-app/created?code=good-code&state=nope`,
  );
  assert.equal(forged.status, 400);
  assert.equal(gh.state.conversions, 0);

  const { csp, action, manifest } = await followStart(started.start_url);
  assert.equal(action, `${gh.base}/settings/apps/new?state=${state}`);
  assert.match(csp, /form-action http:\/\/127\.0\.0\.1:\d+;/);
  assert.match(csp, /script-src 'nonce-/);
  assert.equal(manifest.public, false);
  assert.deepEqual(manifest.default_permissions, GITHUB_APP_PERMISSIONS);
  assert.equal('hook_attributes' in manifest, false);
  assert.equal(manifest.redirect_url, `${local}/github-app/created`);
  assert.equal(manifest.setup_url, `${local}/github-app/installed`);

  // GitHub sends the browser back with the one-time code; the studio sends it on to install.
  // Review M-1: two arrivals at once (a reload while the exchange runs) spend the code once.
  const [back, twin] = await Promise.all(
    [1, 2].map(() =>
      fetch(`${manifest.redirect_url}?code=good-code&state=${state}`, {
        redirect: 'manual',
      }),
    ),
  );
  assert.equal(back!.status, 302);
  assert.equal(twin!.status, 302);
  assert.equal(gh.state.conversions, 1);
  assert.equal(vault.entries().length, 1);
  assert.equal(
    back!.headers.get('location'),
    `${gh.base}/apps/creator-agent-abc123/installations/new?state=${state}`,
  );
  // A later reload of that redirect does not spend the code again either.
  const again = await fetch(
    `${manifest.redirect_url}?code=good-code&state=${state}`,
    { redirect: 'manual' },
  );
  assert.equal(again.status, 302);
  assert.equal(gh.state.conversions, 1);
  const created = (await store.listGitHubAppSetups(owner, ws.id))[0]!;
  assert.equal(created.status, 'app_created');
  assert.equal(created.app?.slug, 'creator-agent-abc123');
  assert.deepEqual(created.app?.owner, ACCOUNT);
  assert.equal(setupStep(created), 'install');
  const entries = vault.entries();
  assert.equal(entries.length, 1);
  assert.ok(entries[0]!.includes('PRIVATE KEY'));
  assert.ok(entries[0]!.startsWith('{"private_key_pem":'));
  assert.equal(setupStep.polls(setupStep(created)), true);
  // Review M-1: a late failure of the exchange cannot fail an app that was created.
  assert.equal(
    (
      await store.failGitHubAppSetup(
        owner,
        ws.id,
        created.id,
        'GitHub refused the code (404).',
      )
    ).status,
    'app_created',
  );
  // Review L-2: GitHub's install redirect without state gets a neutral answer, not an error.
  const plain = await fetch(
    `${manifest.setup_url}?installation_id=1&setup_action=install`,
  );
  assert.equal(plain.status, 200);
  assert.match(await plain.text(), /press Check installation/);
  // Review 2 N-2: that visit asks GitHub once; a reload right after does not ask again.
  for (let i = 0; i < 100 && gh.state.jwtIss.length === 0; i++)
    await new Promise((r) => setTimeout(r, 10));
  const asked = gh.state.jwtIss.length;
  assert.equal(asked, 1);
  const reload = await fetch(`${manifest.setup_url}?setup_action=install`);
  assert.equal(reload.status, 200);
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(gh.state.jwtIss.length, asked);

  // Not installed yet: the check says so and changes nothing.
  await rejects('NOT_FOUND', svc.checkInstallation(owner, ws.id, created.id));
  // GitHub's setup redirect is only a hint; an installation on another account is ignored.
  gh.state.installations = [
    { id: 55, account: OTHER, repository_selection: 'all' },
  ];
  const hint = await fetch(
    `${manifest.setup_url}?installation_id=55&setup_action=install&state=${state}`,
  );
  assert.match(await hint.text(), /not installed on fixture-owner yet/);
  assert.equal(
    (await store.getGitHubAppSetup(owner, ws.id, created.id)).status,
    'app_created',
  );
  gh.state.installations.push({
    id: 4242,
    account: ACCOUNT,
    repository_selection: 'selected',
  });
  const done = await fetch(
    `${manifest.setup_url}?installation_id=4242&setup_action=install&state=${state}`,
  );
  assert.match(await done.text(), /^Installed/);
  assert.ok(gh.state.jwtIss.every((i) => i === 'Iv23fixtureclient'));
  const installed = await store.getGitHubAppSetup(owner, ws.id, created.id);
  assert.equal(installed.status, 'installed');
  assert.deepEqual(installed.installation, {
    id: 4242,
    account: ACCOUNT,
    repository_selection: 'selected',
  });
  // Checking again is harmless.
  await svc.checkInstallation(owner, ws.id, created.id);

  // Only the owner connects; the connection is an ordinary unverified live one.
  await rejects(
    'ACCESS_DENIED',
    svc.connect(editor, ws.id, created.id, {
      label: 'GitHub',
      limits: LIMITS,
      required_checks: [],
      included_repositories: [],
    }),
  );
  const { setup: connected, connection } = await svc.connect(
    owner,
    ws.id,
    created.id,
    {
      label: 'GitHub (fixture-owner)',
      limits: LIMITS,
      required_checks: ['ci'],
      included_repositories: [],
    },
  );
  assert.equal(connected.status, 'connected');
  assert.equal(connected.connection_id, connection.id);
  assert.equal(connection.status, 'unverified');
  assert.equal(connection.body.mode, 'live');
  assert.deepEqual(connection.body.owner, ACCOUNT);
  assert.equal(connection.body.credential.kind, 'app_vault');
  assert.equal(connection.body.webhook_secret_env, null);

  // A finished setup does not move again.
  await rejects('INVALID_TRANSITION', svc.abandon(owner, ws.id, created.id));
  await assert.rejects(
    s.db.pool.query(
      `update github_app_setups set status = 'abandoned' where id = $1`,
      [created.id],
    ),
    /finished GitHub app setup cannot change/,
  );

  // Verify reads the installation with the sealed key; only the vault holds it.
  const github = new GitHubService(store, {
    env: { CREATOR_GITHUB: 'live' },
    vault,
    appBases: { apiBase: gh.base, gitBase: gh.base },
    pushSource: () => {
      throw new Error('no pushes here');
    },
  });
  const verified = await github.verify(owner, ws.id, connection.id);
  assert.equal(verified.connection.status, 'active');
  const { rows } = await s.db.pool.query(
    `select (select count(*) from audit_events where payload::text like '%PRIVATE KEY%')
          + (select count(*) from github_app_setups where row_to_json(github_app_setups)::text like '%PRIVATE KEY%')
          + (select count(*) from github_connections where row_to_json(github_connections)::text like '%PRIVATE KEY%')
          + (select count(*) from audit_events where payload::text like '%good-code%') as n`,
  );
  assert.equal(Number(rows[0].n), 0);
  // Without the key on this computer the connection cannot reach GitHub.
  const noKey = new GitHubService(store, {
    env: { CREATOR_GITHUB: 'live' },
    vault: new MemoryVault(),
    appBases: { apiBase: gh.base, gitBase: gh.base },
    pushSource: () => '',
  });
  await assert.rejects(
    noKey.verify(owner, ws.id, connection.id),
    /app key for this connection is not on this computer/,
  );
  assert.equal(setupStep(connected), 'connected');
  assert.equal(setupStep.polls('connected'), false);

  // Review L-4: revoking the app connection deletes its sealed key and says so in the journal.
  const current = await store.getGitHubConnection(owner, ws.id, connection.id);
  const revoked = await github.revoke(owner, ws.id, connection.id, {
    expected_version: current.version,
    reason: 'Done with the trial.',
  });
  assert.equal(revoked.status, 'revoked');
  assert.equal(revoked.key_forget_failed, undefined);
  assert.equal(vault.entries().length, 0);
  const ev = await s.db.pool.query(
    `select payload from audit_events where action = 'github.connection_revoked'`,
  );
  assert.equal(ev.rows[0].payload.app_key, 'forgotten_on_revoke');
  await assert.rejects(
    github.verify(owner, ws.id, connection.id),
    (e: unknown) => e instanceof ContractError,
  );
});

test('P32 review M-2: a refused repository creation on a personal account says what to do', () => {
  const conn = (
    kind: 'app_vault' | 'fine_grained_pat',
    type: 'User' | 'Organization',
  ) =>
    ({
      body: {
        owner: { login: 'o', id: 1, type },
        credential:
          kind === 'app_vault'
            ? {
                kind,
                app_id: 1,
                app_slug: 'a',
                app_client_id: 'c',
                key_ref: 'k',
                installation_id: 2,
              }
            : {
                kind,
                token_env: 'CREATOR_GITHUB_TOKEN',
                expires_at: '2026-12-01T00:00:00.000Z',
              },
      },
    }) as unknown as GitHubConnection;
  const refused = {
    state: 'failed',
    reason_code: 'permission_missing',
    explanation: 'GitHub refused the request.',
  } as const;
  const res = { status: 403, headers: {}, data: null, message: '' };
  assert.match(
    (
      refusalWording(
        refused,
        'repo_create',
        conn('app_vault', 'User'),
        res,
      ) as {
        explanation: string;
      }
    ).explanation,
    /Create the repository on GitHub and add it to the app’s installation; to let Creator Agent use it, set up the connection again with the repository listed/,
  );
  for (const [kind, c] of [
    ['repo_create', conn('app_vault', 'Organization')],
    ['repo_create', conn('fine_grained_pat', 'User')],
    ['push', conn('app_vault', 'User')],
  ] as const)
    assert.equal(refusalWording(refused, kind, c, res), refused);
  // P32 live trial: a rate limit or a refused App token keeps its own wording.
  const limited = {
    state: 'failed',
    reason_code: 'provider_rate_limited',
    explanation: 'GitHub rate limit.',
  } as const;
  assert.equal(
    refusalWording(limited, 'repo_create', conn('app_vault', 'User'), res),
    limited,
  );
  assert.equal(
    refusalWording(refused, 'repo_create', conn('app_vault', 'User'), {
      ...res,
      stage: 'app_token',
    }),
    refused,
  );
  assert.equal(
    refusalWording(refused, 'repo_create', conn('app_vault', 'User'), {
      ...res,
      status: 404,
    }),
    refused,
  );
});

test('P32 GitHub App setup refusals: live off, no vault, fixture workspace, editor, hand-made app_vault', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ws } = s;
  await rejects(
    'LIVE_DISABLED',
    s.service({ env: {} }).begin(owner, ws.id, {
      organization: null,
      open_browser: false,
    }),
  );
  await rejects(
    'INVALID_CONFIG',
    s.service({ vault: null }).begin(owner, ws.id, {
      organization: null,
      open_browser: false,
    }),
  );
  await rejects(
    'ACCESS_DENIED',
    s
      .service()
      .begin(editor, ws.id, { organization: null, open_browser: false }),
  );
  assert.equal((await store.listGitHubAppSetups(owner, ws.id)).length, 0);
  // The generic route cannot point a connection at a sealed key.
  await rejects(
    'SCOPE_EXCEEDED',
    store.registerGitHubConnection(owner, ws.id, {
      label: 'Sneaky',
      mode: 'live',
      owner: ACCOUNT,
      credential: {
        kind: 'app_vault',
        app_id: 1,
        app_slug: 'x',
        app_client_id: 'y',
        key_ref: `github-app-key/${randomUUID()}`,
        installation_id: 2,
      },
      webhook_secret_env: null,
      limits: LIMITS,
      required_checks: [],
      included_repositories: [],
    }),
  );
  const fixtureWs = await store.createWorkspace(owner, {
    name: 'Fixture',
    record_mode: 'fixture',
  });
  await rejects(
    'SCOPE_EXCEEDED',
    s.service().begin(owner, fixtureWs.id, {
      organization: null,
      open_browser: false,
    }),
  );
});

test('P32 GitHub App setup: a refused code fails without a key; restart expires; abandon drops the key', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ws, gh, vault } = s;
  const setupStep = await loadSetupStep();
  const svc = s.service();
  // GitHub refuses the code (expired or reused): failed, nothing sealed.
  const a = await svc.begin(owner, ws.id, {
    organization: 'acme-org',
    open_browser: false,
  });
  const st = new URL(a.start_url).searchParams.get('state')!;
  const { action, manifest } = await followStart(a.start_url);
  assert.ok(
    action.startsWith(`${gh.base}/organizations/acme-org/settings/apps/new?`),
  );
  const bad = await fetch(
    `${manifest.redirect_url}?code=stale-code&state=${st}`,
    {
      redirect: 'manual',
    },
  );
  assert.equal(bad.status, 502);
  const failed = await store.getGitHubAppSetup(owner, ws.id, a.setup.id);
  assert.equal(failed.status, 'failed');
  assert.match(failed.failure ?? '', /refused the code \(404\)/);
  assert.equal(setupStep(failed), 'retry');
  assert.equal(vault.entries().length, 0);

  // A second start retires a setup still waiting, and its old link stops working.
  const b = await svc.begin(owner, ws.id, {
    organization: null,
    open_browser: false,
  });
  const c = await svc.begin(owner, ws.id, {
    organization: null,
    open_browser: false,
  });
  assert.equal(
    (await store.getGitHubAppSetup(owner, ws.id, b.setup.id)).status,
    'expired',
  );
  await assert.rejects(fetch(b.start_url));
  // An expired setup no longer accepts an app.
  await rejects(
    'INVALID_TRANSITION',
    store.recordGitHubAppCreated(owner, ws.id, b.setup.id, {
      app: {
        id: 1,
        slug: 'x',
        client_id: 'y',
        name: 'x',
        owner: { login: ACCOUNT.login, id: ACCOUNT.id, type: 'User' },
        html_url: 'https://github.com/apps/x',
      },
      key_ref: `github-app-key/${randomUUID()}`,
    }),
  );

  // Created, then abandoned: the sealed key is deleted; connecting is refused.
  const cs = new URL(c.start_url).searchParams.get('state')!;
  const m = (await followStart(c.start_url)).manifest;
  await fetch(`${m.redirect_url}?code=good-code&state=${cs}`, {
    redirect: 'manual',
  });
  assert.equal(vault.entries().length, 1);
  await rejects(
    'INVALID_TRANSITION',
    svc.connect(owner, ws.id, c.setup.id, {
      label: 'GitHub',
      limits: LIMITS,
      required_checks: [],
      included_repositories: [],
    }),
  );
  const gone = await svc.abandon(owner, ws.id, c.setup.id);
  assert.equal(gone.status, 'abandoned');
  assert.equal(vault.entries().length, 0);
  await rejects(
    'INVALID_TRANSITION',
    svc.checkInstallation(owner, ws.id, c.setup.id),
  );
});

test('P32 manifest, start page and conversion parsing', async () => {
  const setupStep = await loadSetupStep();
  const m = githubAppManifest({
    name: 'Creator Agent x',
    redirect_url: 'http://127.0.0.1:1/a',
    setup_url: 'http://127.0.0.1:1/b',
  });
  assert.equal(m.public, false);
  assert.equal(m.default_permissions.checks, 'read');
  assert.equal('workflows' in m.default_permissions, false);
  const page = startPage({
    action: 'https://github.com/settings/apps/new?state=a"b',
    manifest: { name: '</script><b>' },
  });
  assert.ok(!page.html.includes('</script><b>'));
  assert.ok(page.html.includes('state=a&quot;b'));
  assert.match(page.csp, /form-action https:\/\/github\.com;/);
  const ok = {
    id: 5,
    slug: 'a-b',
    client_id: 'Iv1',
    pem: PEM,
    html_url: 'https://github.com/apps/a-b',
    name: 'A',
    owner: ACCOUNT,
  };
  assert.equal(parseConversion(ok)?.app.slug, 'a-b');
  assert.equal(parseConversion({ ...ok, pem: 'not a key' }), null);
  assert.equal(parseConversion({ ...ok, slug: '../x' }), null);
  assert.equal(parseConversion({ ...ok, owner: { login: 'x' } }), null);
  assert.equal(setupStep(null), 'start');
});

test('P32 review 2 N-1: a key that cannot be deleted does not fail a committed revoke', async () => {
  const conn = {
    status: 'revoked',
    body: {
      credential: {
        kind: 'app_vault',
        app_id: 1,
        app_slug: 'a',
        app_client_id: 'c',
        key_ref: 'github-app-key/00000000-0000-4000-8000-000000000001',
        installation_id: 2,
      },
    },
  } as unknown as GitHubConnection;
  const vault = new MemoryVault();
  vault.delete = async () => {
    throw new Error('EBUSY: the key file is locked');
  };
  const service = new GitHubService(
    { revokeGitHubConnection: async () => conn } as never,
    { env: { CREATOR_GITHUB: 'live' }, vault, pushSource: () => '' },
  );
  const out = await service.revoke(owner, randomUUID(), randomUUID(), {});
  assert.equal(out.status, 'revoked');
  assert.equal(out.key_forget_failed, true);
});

test('P32 PR #244 review: a refused App token is kept as the token step and says the change was not sent', async () => {
  const calls: string[] = [];
  const gh = new LiveGitHub({
    credential: {
      kind: 'app_installation',
      client_id: 'Iv23fixtureclient',
      private_key: PEM,
      installation_id: 42,
    },
    apiBase: 'http://127.0.0.1:9',
    fetch: (async (url: string | URL) => {
      calls.push(String(url));
      return new Response(
        JSON.stringify({ message: 'Resource not accessible by integration' }),
        {
          status: 403,
          headers: { 'x-accepted-github-permissions': 'administration=write' },
        },
      );
    }) as typeof fetch,
  });
  const res = await gh.createRepository(
    { login: 'fixture-owner', type: 'User' },
    'creator-agent-x',
    '',
  );
  // Only the token request was made; the creation itself was never sent.
  assert.deepEqual(calls, [
    'http://127.0.0.1:9/app/installations/42/access_tokens',
  ]);
  assert.equal(res.stage, 'app_token');
  assert.deepEqual(githubAnswer(res).github_answer, {
    status: 403,
    step: 'app_token',
    message: 'Resource not accessible by integration',
    rate_limit_remaining: null,
    retry_after: null,
    accepted_permissions: 'administration=write',
  });
  const cls = {
    state: 'failed',
    reason_code: 'permission_missing',
    explanation: 'GitHub refused the request.',
  } as const;
  const worded = appTokenWording(cls, res);
  assert.match(
    (worded as { explanation: string }).explanation,
    /refused an App token for this change \(403\), so the change was not sent/,
  );
  // A refusal of the call itself keeps the call's wording.
  // Review 2 L-1: no token handed out (no answer, or the studio could not sign) means the
  // change was never sent: failed, not unknown, so a retry needs no Reconcile.
  const silent = await new LiveGitHub({
    credential: {
      kind: 'app_installation',
      client_id: 'Iv23fixtureclient',
      private_key: PEM,
      installation_id: 42,
    },
    apiBase: 'http://127.0.0.1:9',
    fetch: (async () => {
      throw new Error('connection reset');
    }) as typeof fetch,
  }).createRepository(
    { login: 'fixture-owner', type: 'User' },
    'creator-agent-x',
    '',
  );
  assert.equal(silent.stage, 'app_token');
  assert.equal(classifyResponse(silent).state, 'unknown');
  const notSent = appTokenWording(classifyResponse(silent), silent);
  assert.equal(notSent.state, 'failed');
  assert.equal(
    (notSent as { reason_code: string }).reason_code,
    'app_token_unavailable',
  );
  assert.match(
    (notSent as { explanation: string }).explanation,
    /did not hand out an App token \(no answer\), so the change was not sent/,
  );
  const unsigned = await new LiveGitHub({
    credential: {
      kind: 'app_installation',
      client_id: 'Iv23fixtureclient',
      private_key: 'not a key',
      installation_id: 42,
    },
    apiBase: 'http://127.0.0.1:9',
    fetch: (async () => {
      throw new Error('never called');
    }) as typeof fetch,
  }).createRepository(
    { login: 'fixture-owner', type: 'User' },
    'creator-agent-x',
    '',
  );
  assert.equal(unsigned.stage, 'studio');
  assert.equal(
    appTokenWording(classifyResponse(unsigned), unsigned).state,
    'failed',
  );
  const { stage: _stage, ...call } = res;
  assert.equal(appTokenWording(cls, call), cls);
});
