import { ViewModeSwitch } from './view-mode.js';
import { useEffect, useState, type FormEvent } from 'react';
import {
  RuntimeCeilingSchema,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { ApiError, api, message, when } from './oversight.js';
import { usePageActive } from './page-drafts.js';
import { money } from './budgets.js';
import { usdToNano } from './amounts.js';
import { SpendingLimits } from './spending-limits.js';
import { EvidenceSites } from './evidence-sites.js';
import { TeamProfilePanel } from './team-profile.js';
import { Status, useLoad, type View } from './ui.js';

/**
 * Settings: the owner's overall ceiling on real spending (ADR-0043), the narrower per-run
 * and per-model limits under it (ADR-0044), the workspace's evidence websites (ADR-0056),
 * plus pointers to the
 * other places preferences live. Changing the ceiling is a deliberate, recorded act by the
 * signed-in person; agents and workers have no route to it.
 */
export function Settings({
  session,
  workspace,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  open: (view: View, id?: string) => void;
}) {
  const data = useLoad(
    () => api(RuntimeCeilingSchema, 'settings/spending'),
    [],
  );
  const c = data.data;
  /**
   * What the person reviewed. While the confirm step is open, reloads pause and the request
   * names this version, so a change elsewhere is a conflict, never a silent new baseline.
   */
  const [snap, setSnap] = useState<{
    version: number;
    ceiling: string;
    exposure: string;
  } | null>(null);
  const reviewing = snap !== null;
  // The ceiling can change in another tab or window, so read it again whenever this page is
  // shown or the window regains focus; a save always shows the server's answer.
  const active = usePageActive();
  useEffect(() => {
    if (active && !snap) data.reload();
  }, [active]);
  useEffect(() => {
    if (!active || snap) return;
    const on = () => data.reload();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, [active, snap]);
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const next = usdToNano(amount);
  const base = snap?.ceiling ?? c?.ceiling_nano_usd;
  const raising =
    base !== undefined && next !== null && BigInt(next) > BigInt(base);
  const same =
    c && next !== null && BigInt(next) === BigInt(c.ceiling_nano_usd);
  const left = c
    ? BigInt(c.ceiling_nano_usd) - BigInt(c.exposure_nano_usd)
    : 0n;

  function review(e: FormEvent) {
    e.preventDefault();
    setError('');
    setNotice('');
    if (c && next !== null && !same && reason.trim())
      setSnap({
        version: c.version,
        ceiling: c.ceiling_nano_usd,
        exposure: c.exposure_nano_usd,
      });
  }
  async function confirm() {
    if (!snap || next === null) return;
    setBusy(true);
    setError('');
    try {
      const updated = await api(RuntimeCeilingSchema, 'settings/spending', {
        csrf: session.csrf_token,
        body: {
          expected_version: snap.version,
          ceiling_nano_usd: next,
          reason: reason.trim(),
        },
      });
      data.reload();
      setNotice(
        `Ceiling set to ${money(updated.ceiling_nano_usd, false)}. It applies to the next paid call.`,
      );
      setAmount('');
      setReason('');
      setSnap(null);
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        data.reload();
        setError(
          'The ceiling changed elsewhere while you were deciding. The page now shows the latest; review your change again.',
        );
      } else setError(message(err));
      setSnap(null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel" aria-labelledby="settings-title">
      <h2 id="settings-title">Settings</h2>
      <h3>Studio view</h3>
      <p className="small">
        Your own choice, saved for you on this studio so it follows you to other
        browsers and the desktop app. Standard folds routine settings behind
        their defaults (shown in each fold&apos;s summary) and lists the
        everyday tabs; Launch, Workers and Study still open from links. Advanced
        opens every setting and lists every tab. Both send the same requests,
        and the server checks them the same way.
      </p>
      <ViewModeSwitch />
      <h3>Overall spending ceiling</h3>
      <p>
        The most Creator Agent may spend on real model and tool calls, across
        every workspace. Each call reserves its maximum cost first and is
        refused if it would pass this ceiling. Fixture workspaces use simulated
        units and are not counted. Only you can change it here; agents
        can&apos;t.
      </p>
      <Status
        loading={data.loading && !c}
        error={data.error}
        stale={data.stale}
        retry={data.reload}
      >
        {c && (
          <>
            <dl className="facts ceiling">
              <dt>Ceiling</dt>
              <dd>
                <strong>{money(c.ceiling_nano_usd, false)}</strong>{' '}
                <small>
                  {c.source === 'config'
                    ? 'the reviewed starting value'
                    : `version ${c.version}, set ${when(c.history[0]!.created_at)}`}
                </small>
              </dd>
              <dt>Counted since</dt>
              <dd>{when(c.counted_since)}</dd>
              <dt>Used or held</dt>
              <dd>
                {money(c.exposure_nano_usd, false)}{' '}
                <small>settled cost plus calls in flight or unknown</small>
              </dd>
              <dt>Left</dt>
              <dd>{money((left < 0n ? 0n : left).toString(), false)}</dd>
            </dl>
            {c.unknown_calls > 0 && (
              <p className="notice">
                {c.unknown_calls} paid call(s) have an unknown cost. No new paid
                call is sent until they are reconciled under{' '}
                <button className="text" onClick={() => open('budgets')}>
                  Budgets
                </button>
                , whatever the ceiling.
              </p>
            )}

            <form className="ceiling-form" onSubmit={review}>
              <label htmlFor="ceiling-amount">New ceiling (US dollars)</label>
              <input
                id="ceiling-amount"
                inputMode="decimal"
                placeholder={money(c.ceiling_nano_usd, false).slice(1)}
                value={amount}
                disabled={reviewing}
                onChange={(e) => setAmount(e.target.value)}
              />
              {amount.trim() && next === null && (
                <p className="error">
                  Enter an amount like 50 or 12.50, with no more than nine
                  decimal places.
                </p>
              )}
              {same && <p className="small">That is the current ceiling.</p>}
              <label htmlFor="ceiling-reason">Why</label>
              <textarea
                id="ceiling-reason"
                rows={2}
                maxLength={1200}
                value={reason}
                disabled={reviewing}
                onChange={(e) => setReason(e.target.value)}
              />
              {!reviewing ? (
                <div className="actions">
                  <button
                    className="secondary strong"
                    type="submit"
                    disabled={next === null || !!same || !reason.trim()}
                  >
                    Review change
                  </button>
                </div>
              ) : (
                <div className="notice" role="group" aria-label="Confirm">
                  <p>
                    {raising ? 'Raise' : 'Lower'} the overall ceiling from{' '}
                    <strong>{money(snap!.ceiling, false)}</strong> to{' '}
                    <strong>{money(next!, false)}</strong>?{' '}
                    {raising
                      ? 'This allows more real money to be spent on paid calls.'
                      : BigInt(next!) < BigInt(snap!.exposure)
                        ? 'That is below what is already used or held, so no new paid call will be sent until you raise it again.'
                        : 'New paid calls stop once this amount is reached.'}{' '}
                    The change and your reason are recorded.
                  </p>
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
                        : raising
                          ? 'Raise the ceiling'
                          : 'Lower the ceiling'}
                    </button>
                  </div>
                </div>
              )}
              <div aria-live="polite">
                {notice && <p className="notice ok">{notice}</p>}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </div>
            </form>

            <h4>Changes</h4>
            {c.history.length === 0 ? (
              <p className="small">
                No changes yet. The ceiling is the reviewed starting value of{' '}
                {money(c.configured_nano_usd, false)}.
              </p>
            ) : (
              <ol className="rows">
                {c.history.map((h) => (
                  <li key={h.version}>
                    v{h.version} · {money(h.previous_nano_usd, false)} →{' '}
                    <strong>{money(h.ceiling_nano_usd, false)}</strong>
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

      <SpendingLimits session={session} />

      <EvidenceSites
        key={workspace.id}
        session={session}
        workspace={workspace}
      />

      <TeamProfilePanel
        key={`team-${workspace.id}`}
        session={session}
        workspace={workspace}
      />

      <h3>Elsewhere</h3>
      <ul className="rows">
        <li>
          Per-workspace and per-run budgets:{' '}
          <button className="text" onClick={() => open('budgets')}>
            Monitor › Budgets
          </button>
        </li>
        <li>
          Model sign-in and connections:{' '}
          <button className="text" onClick={() => open('models')}>
            Models and connections
          </button>
        </li>
        <li>
          Model caps (requests a day, per run, timeouts): Change caps on{' '}
          <button className="text" onClick={() => open('models')}>
            Models and connections
          </button>
        </li>
        <li>
          Light or dark: the sun and moon button at the top right of every page.
        </li>
        <li>
          What happens when you close the window, and starting at sign-in: the
          desktop app&apos;s status window.
        </li>
      </ul>
    </section>
  );
}
