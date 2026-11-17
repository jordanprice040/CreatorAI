import { useEffect, useState, type FormEvent } from 'react';
import {
  NOTIFICATION_EVENTS,
  NotificationModeSchema,
  NotificationPreferencesSchema,
  NotificationTestSchema,
  quietHoursActive,
  type NotificationPreferences,
  type NotificationPreferencesBody,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { ApiError, api, message } from './oversight.js';
import { useViewMode } from './view-mode.js';
import {
  GROUP_LABEL,
  MODE_LABEL,
  browserTimeZone,
  eventsOf,
  groupChoice,
  groupSummary,
  listedGroups,
  modesOf,
  setEvent,
  setGroup,
} from './notification-rules.js';
import { notificationsChanged } from './notifications.js';

// ADR-0130 (N2): Settings › Notifications, the signed-in person's own choices. How you are
// interrupted, what you are told about, quiet hours, muted workspaces. Saved as one versioned
// row (ADR-0116); a save from another window first is a conflict, never a silent overwrite.

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function NotificationSettings({
  session,
  workspaces,
}: {
  session: SessionInfo;
  workspaces: readonly Workspace[];
}) {
  const { standard } = useViewMode();
  const [saved, setSaved] = useState<NotificationPreferences | null>(null);
  const [draft, setDraft] = useState<NotificationPreferencesBody | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [testNote, setTestNote] = useState('');

  async function load() {
    try {
      const p = await api(
        NotificationPreferencesSchema,
        'notification-preferences',
      );
      setSaved(p);
      setDraft(p.body);
      setError('');
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    void load();
  }, []);

  const dirty =
    saved !== null &&
    draft !== null &&
    JSON.stringify(saved.body) !== JSON.stringify(draft);

  async function save(e: FormEvent) {
    e.preventDefault();
    if (!saved || !draft) return;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const p = await api(
        NotificationPreferencesSchema,
        'notification-preferences',
        {
          csrf: session.csrf_token,
          body: { expected_version: saved.version, body: draft },
          quiet: true,
        },
      );
      setSaved(p);
      setDraft(p.body);
      setNotice('Saved. New notifications follow these settings.');
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') {
        await load();
        setError(
          'Your notification settings changed in another window. This page now shows the latest; make your change again.',
        );
      } else setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function sendTest() {
    setTestNote('');
    try {
      await api(NotificationTestSchema, 'notifications/test', {
        csrf: session.csrf_token,
        body: {},
        quiet: true,
      });
      setTestNote(
        'Sent. A toast appears in this window in a moment, and the bell keeps it.',
      );
      notificationsChanged();
    } catch (e) {
      setTestNote(message(e));
    }
  }

  if (!draft || !saved)
    return (
      <section className="panel" aria-labelledby="notify-settings-title">
        <h2 id="notify-settings-title">Notifications</h2>
        {error ? (
          <p className="error" role="alert">
            {error}{' '}
            <button className="text" onClick={() => void load()}>
              Try again
            </button>
          </p>
        ) : (
          <p className="small">Loading…</p>
        )}
      </section>
    );

  const set = (patch: Partial<NotificationPreferencesBody>) => {
    setNotice('');
    setDraft({ ...draft, ...patch });
  };
  const q = draft.quiet_hours;
  const setQuiet = (patch: Partial<typeof q>) =>
    set({ quiet_hours: { ...q, ...patch } });
  const quietNow = quietHoursActive(q, new Date());

  return (
    <section className="panel" aria-labelledby="notify-settings-title">
      <h2 id="notify-settings-title">Notifications</h2>
      <p>
        Your own choices, for you only. Every notification goes to the bell at
        the top of the page; these settings decide which ones also interrupt
        you. Notifications only link to the place to act. They never approve,
        continue or spend anything, and they cost nothing.
      </p>
      <form onSubmit={(e) => void save(e)}>
        <h3>How you&apos;re interrupted</h3>
        <p>
          While a studio window is visible, an alert appears as a small toast in
          its corner, once. If the window is hidden when something happens, it
          waits in the bell and is not shown late.
        </p>
        <p className="small">
          <strong>Windows notifications:</strong> not available yet. They come
          with a later update of the installed app; until then, alerts show only
          in a visible studio window.
        </p>
        <p>
          <button
            type="button"
            className="secondary"
            onClick={() => void sendTest()}
          >
            Send test
          </button>{' '}
          {testNote && (
            <span className="small" role="status">
              {testNote}
            </span>
          )}
        </p>
        <label className="notify-check">
          <input
            type="checkbox"
            checked={draft.windows_hide_details}
            onChange={(e) => set({ windows_hide_details: e.target.checked })}
          />
          Hide details on Windows (show only &quot;Creator Agent needs
          you&quot;; applies once Windows notifications are available)
        </label>

        <h3>What you&apos;re told about</h3>
        <p className="small">
          {standard
            ? 'One row per kind. Advanced view lists every event.'
            : 'Every event. "Interrupt" shows a toast (or, later, a Windows notification); "Inbox only" just adds it to the bell.'}
        </p>
        <ul className="notify-modes">
          {standard
            ? listedGroups(false).map((g) => {
                const choice = groupChoice(draft.events, g);
                const id = `notify-group-${g}`;
                return (
                  <li key={g}>
                    <div className="notify-mode-name">
                      <label htmlFor={id}>
                        <strong>{GROUP_LABEL[g]}</strong>
                      </label>
                      <p className="small">{groupSummary(g)}</p>
                    </div>
                    <select
                      id={id}
                      value={choice}
                      onChange={(e) =>
                        set({
                          events: setGroup(
                            draft.events,
                            g,
                            e.target.value === 'inbox' ? 'inbox' : 'defaults',
                          ),
                        })
                      }
                    >
                      <option value="defaults">Interrupt as listed</option>
                      <option value="inbox">Inbox only</option>
                      {choice === 'custom' && (
                        <option value="custom" disabled>
                          Custom (set in Advanced)
                        </option>
                      )}
                    </select>
                  </li>
                );
              })
            : listedGroups(true).flatMap((g) =>
                eventsOf(g, true).map((k) => {
                  const id = `notify-event-${k.replace('.', '-')}`;
                  const info = NOTIFICATION_EVENTS[k];
                  return (
                    <li key={k}>
                      <div className="notify-mode-name">
                        <label htmlFor={id}>{info.label}</label>
                        <p className="small">
                          {GROUP_LABEL[g]} · default:{' '}
                          {MODE_LABEL[info.default].toLowerCase()}
                        </p>
                      </div>
                      <select
                        id={id}
                        value={draft.events[k] ?? info.default}
                        onChange={(e) =>
                          set({
                            events: setEvent(
                              draft.events,
                              k,
                              NotificationModeSchema.parse(e.target.value),
                            ),
                          })
                        }
                      >
                        {modesOf(k).map((m) => (
                          <option key={m} value={m}>
                            {MODE_LABEL[m]}
                          </option>
                        ))}
                      </select>
                    </li>
                  );
                }),
              )}
        </ul>

        <h3>Quiet hours</h3>
        <label className="notify-check">
          <input
            type="checkbox"
            checked={q.enabled}
            onChange={(e) =>
              setQuiet({
                enabled: e.target.checked,
                // First time on: the browser's own time zone, not UTC.
                ...(e.target.checked && saved.version === 0 && q.tz === 'UTC'
                  ? { tz: browserTimeZone() }
                  : {}),
              })
            }
          />
          Hold interruptions during quiet hours
        </label>
        {q.enabled && (
          <>
            <p className="small">
              Notifications still reach the bell. Anything that would have
              interrupted you is held, and when quiet hours end you get one
              summary of what still needs you (anything resolved meanwhile is
              left out).
              {quietNow ? ' Quiet hours are on right now.' : ''}
            </p>
            <div className="notify-quiet">
              <label>
                From
                <input
                  type="time"
                  value={q.start}
                  required
                  onChange={(e) => setQuiet({ start: e.target.value })}
                />
              </label>
              <label>
                To
                <input
                  type="time"
                  value={q.end}
                  required
                  onChange={(e) => setQuiet({ end: e.target.value })}
                />
              </label>
              <label>
                Time zone
                <input
                  value={q.tz}
                  required
                  maxLength={64}
                  onChange={(e) => setQuiet({ tz: e.target.value.trim() })}
                />
              </label>
            </div>
            <fieldset className="notify-days">
              <legend className="small">Starting on</legend>
              {DAYS.map((d, i) => (
                <label key={d}>
                  <input
                    type="checkbox"
                    checked={q.days.includes(i)}
                    onChange={(e) =>
                      setQuiet({
                        days: e.target.checked
                          ? [...q.days, i].sort()
                          : q.days.filter((x) => x !== i),
                      })
                    }
                  />
                  {d}
                </label>
              ))}
            </fieldset>
            <label className="notify-check">
              <input
                type="checkbox"
                checked={q.urgent_override}
                onChange={(e) =>
                  setQuiet({ urgent_override: e.target.checked })
                }
              />
              Let urgent items through anyway (a run that needs you, an
              approval, held claims, refused spending)
            </label>
          </>
        )}

        {workspaces.length > 0 && (
          <>
            <h3>Muted workspaces</h3>
            <p className="small">
              A muted workspace never interrupts you, even with the urgent
              override, and is left out of the quiet-hours summary. Its
              notifications still reach the bell.
            </p>
            <ul className="rows">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <label className="notify-check">
                    <input
                      type="checkbox"
                      checked={draft.muted_workspaces.includes(w.id)}
                      onChange={(e) =>
                        set({
                          muted_workspaces: e.target.checked
                            ? [...draft.muted_workspaces, w.id]
                            : draft.muted_workspaces.filter((x) => x !== w.id),
                        })
                      }
                    />
                    {w.name}
                  </label>
                </li>
              ))}
            </ul>
          </>
        )}

        <h3>Phone and email</h3>
        <p className="small">Not available yet.</p>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="small" role="status">
            {notice}
          </p>
        )}
        <p>
          <button type="submit" disabled={!dirty || busy}>
            {busy ? 'Saving…' : 'Save notification settings'}
          </button>{' '}
          {dirty && (
            <button
              type="button"
              className="text"
              onClick={() => {
                setDraft(saved.body);
                setNotice('');
              }}
            >
              Undo changes
            </button>
          )}
        </p>
      </form>
    </section>
  );
}
