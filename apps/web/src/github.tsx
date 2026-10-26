import { useState, type FormEvent } from 'react';
import {
  GitHubConnectionSchema,
  GitHubDeliverySchema,
  GitHubOperationSchema,
  GitHubRepositorySchema,
  GitHubReviewSchema,
  RunControlSchema,
  z,
  type GitHubConnection,
  type GitHubOperation,
  type GitHubOperationParams,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { Empty, Status, shortId, useLoad, type View } from './ui.js';

/** The simulated GitHub account fixture workspaces talk to (FixtureGitHub's default). */
const FIXTURE_OWNER = { login: 'fixture-owner', id: 4_100_001 };
const lines = (s: string) =>
  s
    .split('\n')
    .map((x) => x.trim())
    .filter(Boolean);
const CONNECTION_STATUS: Record<string, string> = {
  unverified: 'not verified yet',
  active: 'verified',
  credential_rejected: 'credential rejected',
  access_revoked: 'access revoked',
  revoked: 'revoked by you',
};
const OP_KINDS: [GitHubOperationParams['kind'], string][] = [
  ['repo_create', 'Create a private repository'],
  ['branch_create', 'Create a branch'],
  ['push', 'Push a product commit'],
  ['issue_create', 'Open an issue'],
  ['pr_open', 'Open a pull request'],
  ['pr_merge', 'Merge a reviewed pull request'],
];

/**
 * Scoped GitHub management (X04, docs/GITHUB.md): connections, the repositories the studio
 * manages, operations and reviews. Every change goes through the server's admission and
 * limits; this page only asks. Fixture workspaces talk to a simulated GitHub.
 */
export function GitHub({
  session,
  workspace,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const fixture = workspace.record_mode === 'fixture';
  const viewer = workspace.role === 'viewer';
  const data = useLoad(async () => {
    const [connections, repositories, operations, runs] = await Promise.all([
      api(z.array(GitHubConnectionSchema), `${base}/github-connections`),
      api(z.array(GitHubRepositorySchema), `${base}/github-repositories`),
      api(z.array(GitHubOperationSchema), `${base}/github-operations`),
      api(z.array(RunControlSchema), `${base}/runs`),
    ]);
    return {
      connections,
      repositories,
      operations: [...operations].reverse(),
      runs: runs.filter((r) => r.state === 'active'),
    };
  }, [workspace.id]);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [attention, setAttention] = useState(false);
  const [busy, setBusy] = useState(false);
  const act: Act = async (work) => {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const r = await work();
      // A string is a plain success; { text, attention } marks a result that needs a look.
      setNotice(typeof r === 'string' ? r : r.text);
      setAttention(typeof r !== 'string' && r.attention);
      data.reload();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };
  const d = data.data;
  const active = d?.connections.filter((c) => c.status === 'active') ?? [];

  return (
    <section className="panel" aria-labelledby="gh-title">
      <h2 id="gh-title">GitHub</h2>
      <p>
        Creator Agent keeps its own work in private repositories it creates, and
        touches an existing repository only if you list it on a connection.
        Every change asks the run&apos;s permissions first and is recorded;
        merges need an approving review of the exact commit and passing checks.
      </p>
      {fixture ? (
        <p className="notice">
          Fixture workspace: this talks to a simulated GitHub account (
          {FIXTURE_OWNER.login}). Nothing reaches github.com.
        </p>
      ) : (
        <p className="small">
          A real workspace reaches github.com only when live GitHub is turned on
          for the studio and a connection is verified. The token or app key
          stays in the studio&apos;s environment; this page names it but never
          sees it.
        </p>
      )}
      <div aria-live="polite">
        {notice && (
          <p className={attention ? 'notice' : 'notice ok'}>{notice}</p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
      <Status
        loading={data.loading && !d}
        error={data.error}
        retry={data.reload}
      >
        {d && (
          <>
            <h3>Connections</h3>
            {d.connections.length === 0 ? (
              <Empty>No GitHub connection yet. Add one below.</Empty>
            ) : (
              <ul className="rows gh-connections">
                {d.connections.map((c) => (
                  <ConnectionRow
                    key={c.id}
                    c={c}
                    base={base}
                    session={session}
                    busy={busy}
                    viewer={viewer}
                    act={act}
                  />
                ))}
              </ul>
            )}
            {!viewer && (
              <details className="gh-add">
                <summary>Add a connection</summary>
                <AddConnection
                  base={base}
                  session={session}
                  fixture={fixture}
                  busy={busy}
                  act={act}
                />
              </details>
            )}

            <h3>Repositories</h3>
            {d.repositories.length === 0 ? (
              <Empty>
                No managed repositories. Verifying a connection adds the ones it
                lists; creating one is an operation below.
              </Empty>
            ) : (
              <ul className="rows">
                {d.repositories.map((r) => (
                  <li key={r.id}>
                    <strong>{r.full_name}</strong>{' '}
                    <span
                      className={`badge ${r.status === 'active' ? 'ok' : 'bad'}`}
                    >
                      {words(r.status)}
                    </span>
                    <small>
                      {' '}
                      ·{' '}
                      {r.origin === 'created'
                        ? 'created by the studio'
                        : 'listed by you'}{' '}
                      · default branch {r.default_branch}
                      {r.status_reason ? ` · ${r.status_reason}` : ''}
                    </small>
                  </li>
                ))}
              </ul>
            )}

            <h3>Operations</h3>
            {!viewer && active.length > 0 && (
              <details className="gh-add">
                <summary>Ask for a change</summary>
                <NewOperation
                  base={base}
                  session={session}
                  connections={active}
                  repositories={d.repositories.filter(
                    (r) => r.status === 'active',
                  )}
                  runs={d.runs}
                  dataClass={fixture ? 'synthetic' : 'public'}
                  busy={busy}
                  act={act}
                  open={open}
                />
              </details>
            )}
            {!viewer && active.length === 0 && (
              <p className="small">Changes need a verified connection.</p>
            )}
            {d.operations.length === 0 ? (
              <Empty>No operations yet.</Empty>
            ) : (
              <ul className="rows">
                {d.operations.map((o) => (
                  <OperationRow
                    key={o.id}
                    o={o}
                    repoName={
                      d.repositories.find((r) => r.id === o.repository_id)
                        ?.full_name ?? null
                    }
                    canAct={!viewer}
                    busy={busy}
                    reconcile={() =>
                      act(async () => {
                        const r = await api(
                          GitHubOperationSchema,
                          `${base}/github-operations/${o.id}/reconcile`,
                          { csrf: session.csrf_token, body: {} },
                        );
                        return `Checked GitHub: ${words(r.state)}.`;
                      })
                    }
                  />
                ))}
              </ul>
            )}

            {!viewer && d.repositories.length > 0 && (
              <details className="gh-add">
                <summary>Record a pull request review</summary>
                <RecordReview
                  base={base}
                  session={session}
                  repositories={d.repositories}
                  busy={busy}
                  act={act}
                />
              </details>
            )}
          </>
        )}
      </Status>
    </section>
  );
}

type Act = (
  work: () => Promise<string | { text: string; attention: boolean }>,
) => Promise<void>;

function ConnectionRow({
  c,
  base,
  session,
  busy,
  viewer,
  act,
}: {
  c: GitHubConnection;
  base: string;
  session: SessionInfo;
  busy: boolean;
  viewer: boolean;
  act: Act;
}) {
  const [revoking, setRevoking] = useState(false);
  const [reason, setReason] = useState('');
  const [deliveries, setDeliveries] = useState<
    z.infer<typeof GitHubDeliverySchema>[] | null
  >(null);
  const [deliveriesError, setDeliveriesError] = useState('');
  const b = c.body;
  const ok = c.status === 'active';
  return (
    <li>
      <div>
        <strong>{b.label}</strong>{' '}
        <span
          className={`badge ${ok ? 'ok' : c.status === 'unverified' ? 'warn' : 'bad'}`}
        >
          {CONNECTION_STATUS[c.status] ?? words(c.status)}
        </span>
        <small>
          {' '}
          · {b.mode} · {b.owner.login} ({b.owner.type.toLowerCase()}) ·{' '}
          {b.credential.kind === 'fixture'
            ? 'simulated credential'
            : b.credential.kind === 'fine_grained_pat'
              ? `token in ${b.credential.token_env}, expires ${when(b.credential.expires_at)}`
              : `app key in ${b.credential.private_key_env}`}
        </small>
      </div>
      <small>
        New repositories start with <code>{b.limits.repo_prefix}</code>,
        branches with <code>{b.limits.branch_prefix}</code> · up to{' '}
        {b.limits.max_repositories} repositories,{' '}
        {b.limits.max_mutations_per_hour} changes an hour,{' '}
        {b.limits.max_open_prs_per_repo} open pull requests each ·{' '}
        {b.required_checks.length === 0
          ? 'no required checks, so merges are refused'
          : `merges need ${b.required_checks.join(', ')}`}
      </small>
      {c.verification && (
        <p className="small">
          Last checked {when(c.verification.checked_at)}:{' '}
          {words(c.verification.result)}
          {c.verification.reason ? ` · ${c.verification.reason}` : ''}
        </p>
      )}
      {c.status_reason && c.status_reason !== c.verification?.reason && (
        <p className="small">{c.status_reason}</p>
      )}
      {!viewer && c.status !== 'revoked' && (
        <div className="actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void act(async () => {
                const r = await api(
                  z.strictObject({
                    connection: GitHubConnectionSchema,
                    repositories: z.array(GitHubRepositorySchema),
                  }),
                  `${base}/github-connections/${c.id}/verify`,
                  { csrf: session.csrf_token, body: {} },
                );
                return `${r.connection.body.label}: ${CONNECTION_STATUS[r.connection.status] ?? words(r.connection.status)}.`;
              })
            }
          >
            Verify the account
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void (async () => {
                try {
                  setDeliveries(
                    deliveries
                      ? null
                      : await api(
                          z.array(GitHubDeliverySchema),
                          `${base}/github-connections/${c.id}/deliveries`,
                        ),
                  );
                } catch (err) {
                  setDeliveriesError(message(err));
                }
              })()
            }
          >
            {deliveries ? 'Hide webhook deliveries' : 'Webhook deliveries'}
          </button>
          {!revoking ? (
            <button
              className="secondary stop"
              disabled={busy}
              onClick={() => setRevoking(true)}
            >
              Revoke…
            </button>
          ) : (
            <span className="confirm-inline" role="group" aria-label="Revoke">
              Revoke {b.label} for good? It can&apos;t be verified or used
              again; repositories stay listed, but nothing more is done in them
              through it.
              <label className="inline" htmlFor={`revoke-${c.id}`}>
                Why
              </label>
              <input
                id={`revoke-${c.id}`}
                autoFocus
                value={reason}
                maxLength={500}
                onChange={(e) => setReason(e.target.value)}
              />
              <button className="secondary" onClick={() => setRevoking(false)}>
                Keep
              </button>
              <button
                className="secondary danger"
                disabled={busy || !reason.trim()}
                onClick={() =>
                  void act(async () => {
                    await api(
                      GitHubConnectionSchema,
                      `${base}/github-connections/${c.id}/revoke`,
                      {
                        csrf: session.csrf_token,
                        body: {
                          expected_version: c.version,
                          reason: reason.trim(),
                        },
                      },
                    );
                    setRevoking(false);
                    return `${b.label} revoked. It can't be used again.`;
                  })
                }
              >
                Revoke for good
              </button>
            </span>
          )}
        </div>
      )}
      {deliveriesError && (
        <p className="error" role="alert">
          Couldn&apos;t load deliveries: {deliveriesError}
        </p>
      )}
      {deliveries && (
        <ul className="rows">
          {deliveries.length === 0 && <li className="small">No deliveries.</li>}
          {deliveries.map((x) => (
            <li key={x.id} className="small">
              {when(x.received_at)} · {x.event}
              {x.action ? `.${x.action}` : ''} · {words(x.status)}
              {x.effects.length ? ` · ${x.effects.join('; ')}` : ''}
            </li>
          ))}
        </ul>
      )}
    </li>
  );
}

function AddConnection({
  base,
  session,
  fixture,
  busy,
  act,
}: {
  base: string;
  session: SessionInfo;
  fixture: boolean;
  busy: boolean;
  act: Act;
}) {
  const [label, setLabel] = useState(fixture ? 'Simulated GitHub' : '');
  const [login, setLogin] = useState(fixture ? FIXTURE_OWNER.login : '');
  const [ownerId, setOwnerId] = useState(
    fixture ? String(FIXTURE_OWNER.id) : '',
  );
  const [ownerType, setOwnerType] = useState<'User' | 'Organization'>('User');
  const [credKind, setCredKind] = useState<
    'fine_grained_pat' | 'app_installation'
  >('app_installation');
  const [tokenEnv, setTokenEnv] = useState('CREATOR_GITHUB_TOKEN');
  const [expires, setExpires] = useState('');
  const [clientId, setClientId] = useState('');
  const [keyEnv, setKeyEnv] = useState('CREATOR_GITHUB_APP_KEY');
  const [installation, setInstallation] = useState('');
  const [webhookEnv, setWebhookEnv] = useState('');
  const [repoPrefix, setRepoPrefix] = useState('creator-agent-');
  const [branchPrefix, setBranchPrefix] = useState('creator/');
  const [maxRepos, setMaxRepos] = useState('3');
  const [perHour, setPerHour] = useState('30');
  const [openPrs, setOpenPrs] = useState('3');
  const [checks, setChecks] = useState('');
  const [included, setIncluded] = useState('');
  function submit(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      const body = {
        label: label.trim(),
        mode: fixture ? 'fixture' : 'live',
        owner: { login: login.trim(), id: Number(ownerId), type: ownerType },
        credential: fixture
          ? { kind: 'fixture' }
          : credKind === 'fine_grained_pat'
            ? {
                kind: 'fine_grained_pat',
                token_env: tokenEnv.trim(),
                expires_at: new Date(expires).toISOString(),
              }
            : {
                kind: 'app_installation',
                app_client_id: clientId.trim(),
                private_key_env: keyEnv.trim(),
                installation_id: Number(installation),
              },
        webhook_secret_env: webhookEnv.trim() || null,
        limits: {
          repo_prefix: repoPrefix.trim(),
          branch_prefix: branchPrefix.trim(),
          max_repositories: Number(maxRepos),
          max_mutations_per_hour: Number(perHour),
          max_open_prs_per_repo: Number(openPrs),
        },
        required_checks: lines(checks),
        included_repositories: lines(included).map((l) => {
          const [idText, ...name] = l.split(/\s+/);
          return { github_id: Number(idText), full_name: name.join(' ') };
        }),
      };
      const c = await api(
        GitHubConnectionSchema,
        `${base}/github-connections`,
        {
          csrf: session.csrf_token,
          body,
        },
      );
      return `${c.body.label} added. Verify it before asking for changes.`;
    });
  }
  return (
    <form onSubmit={submit} className="gh-form">
      <div className="two">
        <div>
          <label htmlFor="ghc-label">Name</label>
          <input
            id="ghc-label"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ghc-type">Account type</label>
          <select
            id="ghc-type"
            value={ownerType}
            onChange={(e) =>
              setOwnerType(e.target.value as 'User' | 'Organization')
            }
          >
            <option value="User">Personal account</option>
            <option value="Organization">Organization</option>
          </select>
        </div>
        <div>
          <label htmlFor="ghc-login">GitHub login</label>
          <input
            id="ghc-login"
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ghc-id">Numeric account id</label>
          <input
            id="ghc-id"
            inputMode="numeric"
            value={ownerId}
            onChange={(e) => setOwnerId(e.target.value)}
          />
        </div>
      </div>
      {!fixture && (
        <>
          <label htmlFor="ghc-cred">Credential</label>
          <select
            id="ghc-cred"
            value={credKind}
            onChange={(e) =>
              setCredKind(
                e.target.value as 'fine_grained_pat' | 'app_installation',
              )
            }
          >
            <option value="app_installation">
              GitHub App installation (recommended: reads checks, short-lived
              tokens)
            </option>
            <option value="fine_grained_pat">
              Fine-grained personal access token
            </option>
          </select>
          {credKind === 'fine_grained_pat' ? (
            <div className="two">
              <div>
                <label htmlFor="ghc-tenv">
                  Environment variable holding the token
                </label>
                <input
                  id="ghc-tenv"
                  value={tokenEnv}
                  onChange={(e) => setTokenEnv(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="ghc-exp">
                  Token expiry you chose on GitHub
                </label>
                <input
                  id="ghc-exp"
                  type="datetime-local"
                  value={expires}
                  onChange={(e) => setExpires(e.target.value)}
                />
              </div>
            </div>
          ) : (
            <div className="two">
              <div>
                <label htmlFor="ghc-client">App client id</label>
                <input
                  id="ghc-client"
                  value={clientId}
                  onChange={(e) => setClientId(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="ghc-inst">Installation id</label>
                <input
                  id="ghc-inst"
                  inputMode="numeric"
                  value={installation}
                  onChange={(e) => setInstallation(e.target.value)}
                />
              </div>
              <div>
                <label htmlFor="ghc-key">
                  Environment variable holding the app key
                </label>
                <input
                  id="ghc-key"
                  value={keyEnv}
                  onChange={(e) => setKeyEnv(e.target.value)}
                />
              </div>
            </div>
          )}
          <label htmlFor="ghc-hook">Webhook secret variable (optional)</label>
          <input
            id="ghc-hook"
            placeholder="CREATOR_GITHUB_WEBHOOK_SECRET"
            value={webhookEnv}
            onChange={(e) => setWebhookEnv(e.target.value)}
          />
          <p className="small">
            Names only: put the secret itself in the studio&apos;s environment.
            Variable names start with CREATOR_GITHUB_.
          </p>
        </>
      )}
      <div className="two">
        <div>
          <label htmlFor="ghc-rp">New repository names start with</label>
          <input
            id="ghc-rp"
            value={repoPrefix}
            onChange={(e) => setRepoPrefix(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ghc-bp">Studio branches start with</label>
          <input
            id="ghc-bp"
            value={branchPrefix}
            onChange={(e) => setBranchPrefix(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ghc-mr">Most repositories it may create</label>
          <input
            id="ghc-mr"
            inputMode="numeric"
            value={maxRepos}
            onChange={(e) => setMaxRepos(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ghc-ph">Most changes per hour</label>
          <input
            id="ghc-ph"
            inputMode="numeric"
            value={perHour}
            onChange={(e) => setPerHour(e.target.value)}
          />
        </div>
        <div>
          <label htmlFor="ghc-op">Most open pull requests per repository</label>
          <input
            id="ghc-op"
            inputMode="numeric"
            value={openPrs}
            onChange={(e) => setOpenPrs(e.target.value)}
          />
        </div>
      </div>
      <label htmlFor="ghc-checks">
        Checks every merge must pass (one per line; none means no merges)
      </label>
      <textarea
        id="ghc-checks"
        rows={2}
        value={checks}
        onChange={(e) => setChecks(e.target.value)}
      />
      <label htmlFor="ghc-incl">
        Existing repositories it may use (one per line: numeric id, then
        owner/name)
      </label>
      <textarea
        id="ghc-incl"
        rows={2}
        placeholder="123456789 jordanprice040/example"
        value={included}
        onChange={(e) => setIncluded(e.target.value)}
      />
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={
            busy ||
            !label.trim() ||
            !login.trim() ||
            !ownerId.trim() ||
            (!fixture && credKind === 'fine_grained_pat' && !expires)
          }
        >
          Add connection
        </button>
      </div>
    </form>
  );
}

function NewOperation({
  base,
  session,
  connections,
  repositories,
  runs,
  dataClass,
  busy,
  act,
  open,
}: {
  base: string;
  session: SessionInfo;
  connections: GitHubConnection[];
  repositories: z.infer<typeof GitHubRepositorySchema>[];
  runs: z.infer<typeof RunControlSchema>[];
  dataClass: 'synthetic' | 'public';
  busy: boolean;
  act: Act;
  open: (view: View, id?: string) => void;
}) {
  // Lists change under a mounted form (a repository created, a connection revoked), so each
  // choice falls back to the first valid option rather than keeping a stale or empty id.
  const [connPick, setConnectionId] = useState('');
  const connectionId = connections.some((c) => c.id === connPick)
    ? connPick
    : (connections[0]?.id ?? '');
  const [runPick, setRunId] = useState('');
  const runId = runs.some((r) => r.run_id === runPick)
    ? runPick
    : (runs[0]?.run_id ?? '');
  const [kind, setKind] =
    useState<GitHubOperationParams['kind']>('repo_create');
  const [repoPick, setRepoId] = useState('');
  const repoId = repositories.some((r) => r.id === repoPick)
    ? repoPick
    : (repositories[0]?.id ?? '');
  const [f, setF] = useState<Record<string, string>>({});
  const [justification, setJustification] = useState('');
  const [last, setLast] = useState<GitHubOperation | null>(null);
  const v = (k: string) => f[k] ?? '';
  const field = (
    k: string,
    label: string,
    opts: { area?: boolean; placeholder?: string | undefined } = {},
  ) => (
    <>
      <label htmlFor={`gho-${k}`}>{label}</label>
      {opts.area ? (
        <textarea
          id={`gho-${k}`}
          rows={3}
          value={v(k)}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
        />
      ) : (
        <input
          id={`gho-${k}`}
          placeholder={opts.placeholder}
          value={v(k)}
          onChange={(e) => setF({ ...f, [k]: e.target.value })}
        />
      )}
    </>
  );
  function params(): GitHubOperationParams {
    switch (kind) {
      case 'repo_create':
        return { kind, name: v('name').trim(), description: v('description') };
      case 'branch_create':
        return {
          kind,
          repository_id: repoId,
          branch: v('branch').trim(),
          from_sha: v('from_sha').trim(),
        };
      case 'push':
        return {
          kind,
          repository_id: repoId,
          branch: v('branch').trim(),
          product_id: v('product_id').trim(),
          sha: v('sha').trim(),
          base_sha: v('base_sha').trim() || null,
        };
      case 'issue_create':
        return {
          kind,
          repository_id: repoId,
          title: v('title').trim(),
          body: v('body'),
        };
      case 'pr_open':
        return {
          kind,
          repository_id: repoId,
          head_branch: v('head').trim(),
          base_branch: v('base').trim(),
          title: v('title').trim(),
          body: v('body'),
        };
      case 'pr_merge':
        return {
          kind,
          repository_id: repoId,
          pr_number: Number(v('pr')),
          reviewed_head_sha: v('head_sha').trim(),
          merge_method: v('method') === 'squash' ? 'squash' : 'merge',
        };
    }
  }
  function submit(e: FormEvent) {
    e.preventDefault();
    void act(async () => {
      const o = await api(GitHubOperationSchema, `${base}/github-operations`, {
        csrf: session.csrf_token,
        body: {
          connection_id: connectionId,
          run_id: runId,
          task_id: null,
          data_class: dataClass,
          justification: justification.trim(),
          params: params(),
        },
      });
      setLast(o);
      return {
        text:
          o.state === 'refused'
            ? `Not sent: ${o.explanation}`
            : `${words(o.state).replace(/^./, (ch) => ch.toUpperCase())}: ${o.explanation}`,
        attention: !['succeeded', 'reconciled_succeeded'].includes(o.state),
      };
    });
  }
  return (
    <form onSubmit={submit} className="gh-form">
      <div className="two">
        <div>
          <label htmlFor="gho-conn">Connection</label>
          <select
            id="gho-conn"
            value={connectionId}
            onChange={(e) => setConnectionId(e.target.value)}
          >
            {connections.map((c) => (
              <option key={c.id} value={c.id}>
                {c.body.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="gho-run">Under run</label>
          <select
            id="gho-run"
            value={runId}
            onChange={(e) => setRunId(e.target.value)}
          >
            {runs.length === 0 && <option value="">No active runs</option>}
            {runs.map((r) => (
              <option key={r.run_id} value={r.run_id}>
                {words(r.autonomy_mode)} run {shortId(r.run_id)}
              </option>
            ))}
          </select>
        </div>
      </div>
      <label htmlFor="gho-kind">Change</label>
      <select
        id="gho-kind"
        value={kind}
        onChange={(e) =>
          setKind(e.target.value as GitHubOperationParams['kind'])
        }
      >
        {OP_KINDS.map(([k, l]) => (
          <option
            key={k}
            value={k}
            disabled={k !== 'repo_create' && repositories.length === 0}
          >
            {l}
          </option>
        ))}
      </select>
      {kind !== 'repo_create' && (
        <>
          <label htmlFor="gho-repo">Repository</label>
          <select
            id="gho-repo"
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
          >
            {repositories.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
        </>
      )}
      {kind === 'repo_create' && (
        <>
          {field('name', 'Repository name (must use the connection’s prefix)', {
            placeholder: connections.find((c) => c.id === connectionId)?.body
              .limits.repo_prefix,
          })}
          {field('description', 'Description (optional)')}
        </>
      )}
      {kind === 'branch_create' && (
        <>
          {field('branch', 'New branch (must use the branch prefix)')}
          {field('from_sha', 'Start from commit (40-character SHA)')}
        </>
      )}
      {kind === 'push' && (
        <>
          {field('branch', 'Branch')}
          {field('product_id', 'Product record id')}
          {field('sha', 'Commit to push (SHA)')}
          {field(
            'base_sha',
            'Where the remote branch is now (SHA; empty for a new branch)',
          )}
        </>
      )}
      {(kind === 'issue_create' || kind === 'pr_open') && (
        <>
          {kind === 'pr_open' && field('head', 'From branch')}
          {kind === 'pr_open' && field('base', 'Into branch')}
          {field('title', 'Title')}
          {field('body', 'Description', { area: true })}
        </>
      )}
      {kind === 'pr_merge' && (
        <>
          {field('pr', 'Pull request number')}
          {field('head_sha', 'Reviewed head commit (SHA)')}
          <label htmlFor="gho-method">Merge as</label>
          <select
            id="gho-method"
            value={v('method') || 'merge'}
            onChange={(e) => setF({ ...f, method: e.target.value })}
          >
            <option value="merge">Merge commit</option>
            <option value="squash">Squash</option>
          </select>
        </>
      )}
      <label htmlFor="gho-why">Why</label>
      <textarea
        id="gho-why"
        rows={2}
        maxLength={1200}
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || !connectionId || !runId || !justification.trim()}
        >
          Ask for this change
        </button>
      </div>
      {last && last.state === 'refused' && (
        <p className="small">
          Not sent. If it needs your approval, answer it under{' '}
          <button
            type="button"
            className="text"
            onClick={() => open('decisions')}
          >
            Decisions
          </button>{' '}
          and ask again.
        </p>
      )}
    </form>
  );
}

function OperationRow({
  o,
  repoName,
  canAct,
  busy,
  reconcile,
}: {
  o: GitHubOperation;
  repoName: string | null;
  canAct: boolean;
  busy: boolean;
  reconcile: () => Promise<void>;
}) {
  const label = OP_KINDS.find(([k]) => k === o.kind)?.[1] ?? words(o.kind);
  const tone =
    o.state === 'succeeded' || o.state === 'reconciled_succeeded'
      ? 'ok'
      : o.state === 'unknown' || o.state === 'dispatched'
        ? 'warn'
        : 'bad';
  return (
    <li>
      <span className={`badge ${tone}`}>{words(o.state)}</span> {label}
      {repoName ? ` · ${repoName}` : ''}
      <small>
        {' '}
        · {when(o.created_at)} · {words(o.reason_code)}: {o.explanation}
      </small>
      {canAct && (o.state === 'unknown' || o.state === 'dispatched') && (
        <>
          {' '}
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void reconcile()}
          >
            Check GitHub
          </button>
        </>
      )}
    </li>
  );
}

function RecordReview({
  base,
  session,
  repositories,
  busy,
  act,
}: {
  base: string;
  session: SessionInfo;
  repositories: z.infer<typeof GitHubRepositorySchema>[];
  busy: boolean;
  act: Act;
}) {
  const [repoPick, setRepoId] = useState('');
  const repoId = repositories.some((r) => r.id === repoPick)
    ? repoPick
    : (repositories[0]?.id ?? '');
  const [pr, setPr] = useState('');
  const [sha, setSha] = useState('');
  const [verdict, setVerdict] = useState<'approve' | 'request_changes'>(
    'approve',
  );
  const [note, setNote] = useState('');
  return (
    <form
      className="gh-form"
      onSubmit={(e) => {
        e.preventDefault();
        void act(async () => {
          await api(GitHubReviewSchema, `${base}/github-reviews`, {
            csrf: session.csrf_token,
            body: {
              repository_id: repoId,
              pr_number: Number(pr),
              head_sha: sha.trim(),
              verdict,
              note: note.trim(),
            },
          });
          return 'Review recorded for that exact commit.';
        });
      }}
    >
      <p className="small">
        A merge needs an approving review of the exact head commit from someone
        other than whoever pushed it.
      </p>
      <div className="two">
        <div>
          <label htmlFor="ghr-repo">Repository</label>
          <select
            id="ghr-repo"
            value={repoId}
            onChange={(e) => setRepoId(e.target.value)}
          >
            {repositories.map((r) => (
              <option key={r.id} value={r.id}>
                {r.full_name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="ghr-pr">Pull request number</label>
          <input
            id="ghr-pr"
            inputMode="numeric"
            value={pr}
            onChange={(e) => setPr(e.target.value)}
          />
        </div>
      </div>
      <label htmlFor="ghr-sha">Head commit you reviewed (SHA)</label>
      <input
        id="ghr-sha"
        value={sha}
        onChange={(e) => setSha(e.target.value)}
      />
      <label htmlFor="ghr-verdict">Verdict</label>
      <select
        id="ghr-verdict"
        value={verdict}
        onChange={(e) =>
          setVerdict(e.target.value as 'approve' | 'request_changes')
        }
      >
        <option value="approve">Approve</option>
        <option value="request_changes">Request changes</option>
      </select>
      <label htmlFor="ghr-note">Note</label>
      <textarea
        id="ghr-note"
        rows={2}
        value={note}
        onChange={(e) => setNote(e.target.value)}
      />
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={
            busy || !repoId || !pr.trim() || !sha.trim() || !note.trim()
          }
        >
          Record review
        </button>
      </div>
    </form>
  );
}
