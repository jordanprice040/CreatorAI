import { useEffect, useState } from 'react';
import {
  GitHubAppSetupSchema,
  GitHubAppSetupStartSchema,
  z,
  type GitHubAppSetup,
  type SessionInfo,
} from '@creator/contracts';
import { api } from './oversight.js';
import { AddConnection, type Act } from './github.js';
import { pollsGitHub, setupStep } from './github-app-setup-rules.js';
import { useOnShow, usePoll } from './page-active.js';

const POLL_MS = 3000;

/**
 * ADR-0132 (P32): connect GitHub from the browser. Creator Agent opens GitHub with a private
 * app already described; the owner names it, creates it, installs it on the repositories they
 * choose, and the studio keeps the app key protected on this computer. No token is made by hand.
 */
export function GitHubAppSetupPanel({
  base,
  session,
  busy,
  act,
  connected,
}: {
  base: string;
  session: SessionInfo;
  busy: boolean;
  act: Act;
  /** Called once a connection is added, so the page reloads its connections. */
  connected: () => void;
}) {
  const [setups, setSetups] = useState<GitHubAppSetup[] | null>(null);
  const [startUrl, setStartUrl] = useState('');
  const [org, setOrg] = useState('');
  const [tick, setTick] = useState(0);
  const [another, setAnother] = useState(false);
  const latest = setups?.[0] ?? null;
  const step = setupStep(latest);
  useEffect(() => {
    let live = true;
    api(z.array(GitHubAppSetupSchema), `${base}/github-app-setups`)
      .then((s) => live && setSetups(s))
      .catch(() => live && setSetups([]));
    return () => {
      live = false;
    };
  }, [base, tick]);
  const reload = () => setTick((n) => n + 1);
  // While GitHub has the browser (creating, then installing), look again every few seconds,
  // but only while this page is shown and the window is visible (audit 2026-11-19 L-5); on
  // return it reads at once.
  usePoll(reload, POLL_MS, pollsGitHub(step));
  useOnShow(reload);
  const post = <T,>(schema: z.ZodType<T>, path: string, body: unknown = {}) =>
    api(schema, `${base}/github-app-setups${path}`, {
      csrf: session.csrf_token,
      body,
    });

  if (!setups) return null;
  return (
    <div className="gh-app-setup" aria-labelledby="gh-app-title">
      <h4 id="gh-app-title">Connect with GitHub (recommended)</h4>
      {step === 'connected' && latest?.app && (
        <p>
          <span className="badge ok">connected</span> Connected through{' '}
          <strong>{latest.app.name}</strong> (
          {latest.installation?.account.login ?? latest.app.owner.login}).{' '}
          {!another && (
            <button type="button" onClick={() => setAnother(true)}>
              Set up another app
            </button>
          )}
        </p>
      )}
      {(step === 'start' ||
        step === 'retry' ||
        (step === 'connected' && another)) && (
        <>
          {step === 'retry' && latest && (
            <p className="notice">
              {latest.status === 'expired'
                ? 'The last setup was not finished within the hour GitHub allows.'
                : latest.status === 'failed'
                  ? `The last setup stopped: ${latest.failure ?? 'unknown reason'}`
                  : 'The last setup was abandoned.'}{' '}
              You can start again.
            </p>
          )}
          <p className="small">
            Your browser opens GitHub with a private app already described. It
            asks to change repository contents, issues and pull requests, to
            read checks and commit statuses, and for Administration, which
            Creator Agent needs to create repositories. GitHub&apos;s
            Administration permission also covers repository settings and
            deletion; Creator Agent never uses those. You name the app and
            create it, then choose which repositories it may use. Its key stays
            protected on this computer; there is no token to copy.
          </p>
          <details>
            <summary>Create it for an organization instead</summary>
            <label htmlFor="gh-app-org">Organization login</label>
            <input
              id="gh-app-org"
              value={org}
              onChange={(e) => setOrg(e.target.value)}
            />
          </details>
          <div className="actions">
            <button
              className="primary"
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const r = await post(GitHubAppSetupStartSchema, '', {
                    organization: org.trim() || null,
                    open_browser: true,
                  });
                  setStartUrl(r.start_url);
                  reload();
                  return 'GitHub opened in your browser. Create the app there, then come back here.';
                })
              }
            >
              Create the GitHub App
            </button>
          </div>
        </>
      )}
      {step === 'waiting' && latest && (
        <>
          <p>
            <span className="badge warn">waiting for GitHub</span> Create the
            app in the browser window that opened. This page notices when it is
            done.
          </p>
          <p className="small">
            If GitHub showed an error instead, press Stop this setup below and
            note what GitHub said.
          </p>
          {startUrl && (
            <p className="small">
              No browser window? Open this address on this computer:{' '}
              <code>{startUrl}</code>
            </p>
          )}
          {abandon(latest.id)}
        </>
      )}
      {step === 'install' && latest?.app && (
        <>
          <p>
            <span className="badge ok">app created</span>{' '}
            <strong>{latest.app.name}</strong> belongs to{' '}
            {latest.app.owner.login}. Now install it and choose the repositories
            it may use. Creator Agent still only uses repositories it creates or
            that you list on the connection.
          </p>
          <div className="actions">
            <a
              className="button"
              href={`${latest.app.html_url}/installations/new`}
              target="_blank"
              rel="noreferrer noopener"
            >
              Install on GitHub
            </a>
            <button
              type="button"
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  const s = await post(
                    GitHubAppSetupSchema,
                    `/${latest.id}/installation`,
                  );
                  reload();
                  return `Installed on ${s.installation?.account.login ?? 'GitHub'}.`;
                })
              }
            >
              Check installation
            </button>
          </div>
          {abandon(latest.id)}
        </>
      )}
      {step === 'connect' && latest?.installation && latest.app && (
        <>
          <p>
            <span className="badge ok">installed</span>{' '}
            <strong>{latest.app.name}</strong> is installed on{' '}
            {latest.installation.account.login} (
            {latest.installation.repository_selection === 'all'
              ? 'all repositories'
              : 'selected repositories'}
            ). Last step: the limits Creator Agent keeps to.
          </p>
          <AddConnection
            done={() => {
              reload();
              connected();
            }}
            base={base}
            session={session}
            fixture={false}
            busy={busy}
            act={act}
            appSetup={latest}
          />
          {abandon(latest.id)}
        </>
      )}
    </div>
  );

  function abandon(id: string) {
    return (
      <details className="small">
        <summary>Stop this setup</summary>
        <p className="small">
          Creator Agent forgets the app key. The app itself stays on GitHub;
          delete it under GitHub › Settings › Developer settings › GitHub Apps.
        </p>
        <button
          type="button"
          disabled={busy}
          onClick={() =>
            void act(async () => {
              await post(GitHubAppSetupSchema, `/${id}/abandon`);
              reload();
              return 'Setup stopped and the app key removed from this computer.';
            })
          }
        >
          Stop the setup
        </button>
      </details>
    );
  }
}
