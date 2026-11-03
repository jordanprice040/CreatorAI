import { useEffect, useState, type FormEvent } from 'react';
import {
  EVIDENCE_SITES_MAX,
  EvidenceSitesSchema,
  type EvidenceSiteMode,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { ApiError, api, message, when } from './oversight.js';
import { usePageActive } from './page-drafts.js';
import { parseSiteList, siteChanges } from './site-list.js';
import { Status, useLoad } from './ui.js';

const MODE_LABEL: Record<EvidenceSiteMode, string> = {
  listed: 'Only these websites',
  any_public: 'Any public website',
};

/**
 * Settings › Evidence websites (ADR-0056). Which websites the studio may fetch evidence
 * from in this workspace. Any member can see the list in force; only the workspace owner,
 * signed in as a person, can change it, with a reason, and every change is recorded. A
 * change applies to the next fetch, with no restart. Every fetch still needs its run's
 * grant, and private or local-network addresses are refused whatever is chosen here.
 */
export function EvidenceSites({
  session,
  workspace,
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const path = `workspaces/${workspace.id}/evidence-sites`;
  const data = useLoad(() => api(EvidenceSitesSchema, path), [workspace.id]);
  const d = data.data;
  const fixture = workspace.record_mode === 'fixture';
  const [mode, setMode] = useState<EvidenceSiteMode>('listed');
  const [text, setText] = useState('');
  const [reason, setReason] = useState('');
  const [editing, setEditing] = useState(false);
  /** The version reviewed; reloads pause while the confirm step is open. */
  const [snap, setSnap] = useState<{
    version: number;
    mode: EvidenceSiteMode;
    hosts: string[];
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const active = usePageActive();
  useEffect(() => {
    if (active && !snap && !editing) data.reload();
  }, [active]);

  const parsed = parseSiteList(text);
  const tooMany = parsed.hosts.length > EVIDENCE_SITES_MAX;
  const changes = d
    ? siteChanges(d, { mode, hosts: parsed.hosts })
    : ([] as string[]);
  const turningOn = !!d && d.mode !== 'any_public' && mode === 'any_public';

  function startEdit() {
    if (!d) return;
    setMode(d.mode);
    setText(d.hosts.join('\n'));
    setReason('');
    setError('');
    setNotice('');
    setEditing(true);
  }
  function review(e: FormEvent) {
    e.preventDefault();
    setError('');
    if (
      d &&
      changes.length &&
      !parsed.invalid.length &&
      !tooMany &&
      reason.trim()
    )
      setSnap({ version: d.version, mode: d.mode, hosts: d.hosts });
  }
  async function confirm() {
    if (!snap) return;
    setBusy(true);
    setError('');
    try {
      await api(EvidenceSitesSchema, path, {
        csrf: session.csrf_token,
        body: {
          expected_version: snap.version,
          // PR #103 review L6: while the startup list applies (version 0), the server also
          // checks it is still the list this page showed.
          ...(snap.version === 0
            ? { expected_startup: { mode: snap.mode, hosts: snap.hosts } }
            : {}),
          mode,
          hosts: parsed.hosts,
          reason: reason.trim(),
        },
      });
      data.reload();
      setNotice('Saved. The next evidence fetch in this workspace uses it.');
      setEditing(false);
      setSnap(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        data.reload();
        setError(
          'The evidence websites changed elsewhere while you were deciding. Cancel and start again from the latest list.',
        );
      } else setError(message(err));
      setSnap(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h3>Evidence websites</h3>
      <p>
        Where Creator Agent may fetch pages to quote as evidence in{' '}
        <strong>{workspace.name}</strong>. Each fetch still needs its run&apos;s
        approval, only secure (https) pages are read, and addresses on your own
        computer or home network are always refused. Fetched text is treated as
        evidence, never as instructions. Only the workspace owner can change
        this; agents can&apos;t.
      </p>
      <Status
        loading={data.loading && !d}
        error={data.error}
        retry={data.reload}
      >
        {d && (
          <>
            {fixture && (
              <p className="notice">
                This is a fixture workspace: it always uses the built-in fixture
                sources, so these settings can&apos;t be changed here.
              </p>
            )}
            {!fixture && !d.live_available && (
              <p className="notice">
                Live evidence fetching is turned off for this studio, so these
                settings have no effect here. Real workspaces in the desktop app
                have it on.
              </p>
            )}
            <dl className="facts">
              <dt>Allowed</dt>
              <dd>
                <strong>{MODE_LABEL[d.mode]}</strong>{' '}
                <small>
                  {d.source === 'startup'
                    ? 'the list from the desktop status window'
                    : `version ${d.version}, set ${when(d.history[0]!.created_at)}`}
                </small>
              </dd>
              <dt>{d.mode === 'any_public' ? 'Also listed' : 'Websites'}</dt>
              <dd>
                {d.hosts.length
                  ? d.hosts.join(', ')
                  : d.mode === 'any_public'
                    ? 'none needed'
                    : 'None yet, so no evidence can be fetched.'}
              </dd>
            </dl>
            {!editing ? (
              <div className="actions">
                <button
                  className="secondary"
                  disabled={!d.live_available || fixture}
                  onClick={startEdit}
                >
                  Change evidence websites
                </button>
              </div>
            ) : (
              <form className="sites-form" onSubmit={review}>
                <fieldset disabled={snap !== null}>
                  <legend>Which websites</legend>
                  {(['listed', 'any_public'] as const).map((m) => (
                    <label
                      key={m}
                      className="choice"
                      htmlFor={`sites-mode-${m}`}
                    >
                      <input
                        id={`sites-mode-${m}`}
                        type="radio"
                        name="sites-mode"
                        checked={mode === m}
                        onChange={() => setMode(m)}
                      />{' '}
                      {MODE_LABEL[m]}
                      <small>
                        {m === 'listed'
                          ? ' Only the websites below. Safer: you choose every source.'
                          : ' Any public website you or a scheduled refresh asks for, plus the list below. Off unless you turn it on.'}
                      </small>
                    </label>
                  ))}
                  <label htmlFor="sites-list">
                    {mode === 'any_public'
                      ? 'Websites (optional with any public website)'
                      : 'Websites'}
                  </label>
                  <textarea
                    id="sites-list"
                    rows={6}
                    spellCheck={false}
                    placeholder={'www.speedrun.com\n*.nih.gov'}
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                  />
                  <p className="small">
                    One per line, up to {EVIDENCE_SITES_MAX}. Use{' '}
                    <code>*.nih.gov</code> for every subdomain of nih.gov (add{' '}
                    <code>nih.gov</code> too for the site itself). Pasting a
                    full address keeps just the website.
                  </p>
                  {parsed.invalid.length > 0 && (
                    <p className="error">
                      Not a website name: {parsed.invalid.join(', ')}. Use names
                      like www.example.org, not IP addresses, ports or paths. A{' '}
                      <code>*.</code> pattern under a shared suffix such as{' '}
                      <code>co.uk</code> or <code>github.io</code> is refused
                      too: list the websites instead.
                    </p>
                  )}
                  {tooMany && (
                    <p className="error">
                      That is {parsed.hosts.length} websites; the limit is{' '}
                      {EVIDENCE_SITES_MAX}. Use a <code>*.</code> pattern or any
                      public website instead.
                    </p>
                  )}
                  <label htmlFor="sites-reason">Why</label>
                  <textarea
                    id="sites-reason"
                    rows={2}
                    maxLength={1200}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </fieldset>
                {!snap ? (
                  <div className="actions">
                    <button
                      className="secondary strong"
                      type="submit"
                      disabled={
                        !changes.length ||
                        parsed.invalid.length > 0 ||
                        tooMany ||
                        !reason.trim()
                      }
                    >
                      Review change
                    </button>
                    <button
                      className="secondary"
                      type="button"
                      onClick={() => {
                        setEditing(false);
                        setError('');
                      }}
                    >
                      Cancel
                    </button>
                    {!changes.length && (
                      <span className="small">No changes yet.</span>
                    )}
                  </div>
                ) : (
                  <div className="notice" role="group" aria-label="Confirm">
                    <p>
                      {changes.join('. ')}. The change and your reason are
                      recorded, and the next fetch uses it.
                    </p>
                    {turningOn && (
                      <ul>
                        <li>
                          A run may quote any public page, including low-quality
                          or misleading ones. Check the website shown on each
                          claim.
                        </li>
                        <li>
                          Every site a run fetches from sees the request and
                          your computer&apos;s IP address, so it can tell what
                          you are researching.
                        </li>
                        <li>
                          Some sites&apos; terms forbid automated reading. Only
                          short excerpts are kept, and robots.txt is not
                          checked.
                        </li>
                        <li>
                          For study runs, keep this setting the same across
                          every condition you compare.
                        </li>
                      </ul>
                    )}
                    <div className="actions">
                      <button
                        className="secondary"
                        type="button"
                        disabled={busy}
                        onClick={() => setSnap(null)}
                      >
                        Back
                      </button>
                      <button
                        className="primary"
                        type="button"
                        disabled={busy}
                        onClick={() => void confirm()}
                      >
                        {busy
                          ? 'Saving…'
                          : turningOn
                            ? 'Allow any public website'
                            : 'Save evidence websites'}
                      </button>
                    </div>
                  </div>
                )}
              </form>
            )}
            <div aria-live="polite">
              {notice && <p className="notice ok">{notice}</p>}
              {error && (
                <p className="error" role="alert">
                  {error}
                </p>
              )}
            </div>
            <h4>Changes</h4>
            {d.history.length === 0 ? (
              <p className="small">
                No changes here yet.
                {d.startup_hosts.length
                  ? ` The studio started with: ${d.startup_hosts.join(', ')}.`
                  : ''}
              </p>
            ) : (
              <ol className="rows">
                {d.history.map((h) => (
                  <li key={h.version}>
                    v{h.version} · {MODE_LABEL[h.mode]} ·{' '}
                    {siteChanges(
                      { mode: h.previous_mode, hosts: h.previous_hosts },
                      h,
                    ).join('; ') || 'no difference'}
                    <small>
                      {' '}
                      · {when(h.created_at)} · {h.reason}
                    </small>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </Status>
    </>
  );
}
