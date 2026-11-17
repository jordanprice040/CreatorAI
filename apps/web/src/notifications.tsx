import { useCallback, useEffect, useRef, useState } from 'react';
import {
  NotificationClaimSchema,
  NotificationSchema,
  RecentNotificationsSchema,
  z,
  type Notification,
  type RecentNotifications,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import {
  serverOffsetMs,
  toastCandidates,
  toastLifetimeMs,
  unreadLabel,
  withToast,
} from './notification-rules.js';
import './notifications.css';

// ADR-0130 (N2): the bell in the top bar and the in-app toasts. Both ride one 15-second poll
// that pauses while the window is hidden. A toast is shown only after this window wins the
// row's claim, so two windows (or, with N3, the desktop app) never show the same alert twice.
// Notifications only link: there is no approve, continue or spend button anywhere here.

const POLL_MS = 15_000;
/** Sent on `window` when this window changed notifications (a test sent, a row read). */
export const NOTIFICATIONS_CHANGED = 'creator:notifications-changed';
export const notificationsChanged = () =>
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

function useVisible() {
  const [visible, setVisible] = useState(
    typeof document === 'undefined' ? true : !document.hidden,
  );
  useEffect(() => {
    const change = () => setVisible(!document.hidden);
    document.addEventListener('visibilitychange', change);
    return () => document.removeEventListener('visibilitychange', change);
  }, []);
  return visible;
}

export type NotificationFeed = ReturnType<typeof useNotifications>;

/**
 * The person's bell (unread count and newest rows) and the toasts this window won. Rows that
 * were already waiting when the window became visible are never shown late: they stay in the
 * bell (plan §4).
 */
export function useNotifications(csrf: string, enabled: boolean) {
  const visible = useVisible();
  const [recent, setRecent] = useState<RecentNotifications | null>(null);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Notification[]>([]);
  /** When this window last became visible, by this browser's clock; null while hidden. */
  const visibleAt = useRef<number | null>(null);
  const tried = useRef(new Set<string>());
  const seq = useRef(0);

  const load = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const sentAt = Date.now();
      const [bell, sent] = await Promise.all([
        api(RecentNotificationsSchema, 'notifications/recent'),
        fetch('/api/notifications/pending', {
          signal: AbortSignal.timeout(5000),
        }),
      ]);
      const receivedAt = Date.now();
      const body: unknown = await sent.json();
      if (!sent.ok) {
        const e = (body as { error?: { message?: string } } | null)?.error;
        throw new Error(e?.message ?? `API error ${sent.status}`);
      }
      const pending = z.array(NotificationSchema).parse(body);
      if (mine !== seq.current) return;
      setRecent(bell);
      setError('');
      if (document.hidden || visibleAt.current === null) return;
      // Review L-4 of #235: the cutoff is the moment the window became visible, on the
      // server's clock (one second of slack for the Date header's rounding).
      const since =
        visibleAt.current +
        serverOffsetMs(sent.headers.get('date'), sentAt, receivedAt) -
        1000;
      for (const n of toastCandidates(pending, since, tried.current)) {
        tried.current.add(n.id);
        try {
          await api(NotificationClaimSchema, `notifications/${n.id}/claim`, {
            csrf,
            body: { via: 'toast' },
            quiet: true,
          });
          setToasts((t) => withToast(t, n));
        } catch {
          // Another window (or the desktop app) showed it, or it stopped interrupting.
        }
      }
    } catch (e) {
      if (mine === seq.current) setError(message(e));
    }
  }, [csrf]);

  useEffect(() => {
    // Hidden: nothing that arrives now is ever shown late; the cutoff restarts on return.
    if (!visible || !enabled) {
      visibleAt.current = null;
      return;
    }
    visibleAt.current = Date.now();
    void load();
    const timer = window.setInterval(() => void load(), POLL_MS);
    window.addEventListener(NOTIFICATIONS_CHANGED, load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(NOTIFICATIONS_CHANGED, load);
    };
  }, [visible, enabled, load]);

  async function mark(id: string, verb: 'read' | 'dismiss') {
    try {
      await api(NotificationSchema, `notifications/${id}/${verb}`, {
        csrf,
        body: {},
        quiet: true,
      });
    } catch (e) {
      setError(message(e));
    }
    void load();
  }
  async function readAll() {
    try {
      await api(
        z.strictObject({ read: z.number() }),
        'notifications/read-all',
        {
          csrf,
          body: {},
          quiet: true,
        },
      );
    } catch (e) {
      setError(message(e));
    }
    void load();
  }
  return {
    recent,
    error,
    toasts,
    closeToast: (id: string) => setToasts((t) => t.filter((x) => x.id !== id)),
    read: (id: string) => mark(id, 'read'),
    dismiss: (id: string) => mark(id, 'dismiss'),
    readAll,
    reload: load,
  };
}

const ago = (iso: string, now: number) => {
  const mins = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} h ago`;
  return new Date(iso).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
};

/** One row of the bell or the history page. */
export function NotificationRow({
  n,
  now,
  onOpen,
  onRead,
  onDismiss,
}: {
  n: Notification;
  now: number;
  onOpen: () => void;
  onRead?: () => void;
  onDismiss?: () => void;
}) {
  const unread = n.read_at === null;
  return (
    <li
      className="notification-row"
      data-unread={unread ? 'true' : undefined}
      data-severity={n.severity}
    >
      <span className="notification-mark" aria-hidden="true" />
      <div className="notification-text">
        <p className="notification-title">
          {unread && <span className="sr-only">Unread: </span>}
          {n.severity === 'needs_you' && (
            <span className="notification-tag">Needs you</span>
          )}
          {n.title}
          {n.occurrences > 1 && (
            <span
              className="notification-count"
              title={`${n.occurrences} times`}
            >
              ×{n.occurrences}
            </span>
          )}
        </p>
        {n.body && <p className="notification-body">{n.body}</p>}
        <p className="notification-meta">
          <time
            dateTime={n.last_at}
            title={new Date(n.last_at).toLocaleString()}
          >
            {ago(n.last_at, now)}
          </time>
        </p>
      </div>
      <div className="notification-actions">
        <button className="secondary nf-open" onClick={onOpen}>
          Open
        </button>
        {unread && onRead && (
          <button className="text small" onClick={onRead}>
            Mark read
          </button>
        )}
        {onDismiss && (
          <button className="text small" onClick={onDismiss}>
            Remove
          </button>
        )}
      </div>
    </li>
  );
}

/** The bell: the unread count, and a panel with the newest rows, "needs you" first. */
export function NotificationBell({
  feed,
  openLink,
  viewAll,
  settings,
}: {
  feed: NotificationFeed;
  openLink: (link: string) => void;
  viewAll: () => void;
  settings: () => void;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const close = (e: KeyboardEvent | MouseEvent) => {
      const d = ref.current;
      if (!d?.open) return;
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Escape') return;
        d.open = false;
        // Review N-4: back to the bell, so the keyboard is where it was.
        d.querySelector('summary')?.focus();
      } else if (!d.contains(e.target as Node)) d.open = false;
    };
    document.addEventListener('keydown', close);
    document.addEventListener('mousedown', close);
    return () => {
      document.removeEventListener('keydown', close);
      document.removeEventListener('mousedown', close);
    };
  }, []);
  const unread = feed.recent?.unread ?? 0;
  const label = unreadLabel(unread);
  const shut = () => {
    if (ref.current) ref.current.open = false;
  };
  return (
    <details
      className="bell"
      ref={ref}
      onToggle={(e) => {
        if (e.currentTarget.open) {
          setNow(Date.now());
          void feed.reload();
        }
      }}
    >
      <summary
        className="bell-summary"
        aria-label={
          unread ? `Notifications, ${unread} unread` : 'Notifications'
        }
        title="Notifications"
      >
        <svg
          className="icon"
          viewBox="0 0 24 24"
          width="16"
          height="16"
          aria-hidden="true"
          focusable="false"
        >
          <path d="M6 16V11a6 6 0 1112 0v5l1.5 2h-15zM10 20.5a2 2 0 004 0" />
        </svg>
        {label && (
          <span className="bell-count" aria-hidden="true">
            {label}
          </span>
        )}
      </summary>
      <div className="bell-panel" role="region" aria-label="Notifications">
        <div className="bell-head">
          <h2>Notifications</h2>
          {unread > 0 && (
            <button className="text small" onClick={() => void feed.readAll()}>
              Mark all read
            </button>
          )}
        </div>
        {feed.error && <p className="error small">{feed.error}</p>}
        {!feed.recent && !feed.error && <p className="small">Loading…</p>}
        {feed.recent && feed.recent.items.length === 0 && (
          <p className="small bell-empty">
            Nothing yet. You&apos;ll be told here when an autopilot stops, an
            approval waits or a build is ready.
          </p>
        )}
        {feed.recent && feed.recent.items.length > 0 && (
          <ul className="notification-list">
            {feed.recent.items.map((n) => (
              <NotificationRow
                key={n.id}
                n={n}
                now={now}
                onOpen={() => {
                  shut();
                  if (!n.read_at) void feed.read(n.id);
                  openLink(n.link);
                }}
                onRead={() => void feed.read(n.id)}
              />
            ))}
          </ul>
        )}
        <div className="bell-foot">
          <button
            className="text small"
            onClick={() => {
              shut();
              viewAll();
            }}
          >
            View all
          </button>
          <button
            className="text small"
            onClick={() => {
              shut();
              settings();
            }}
          >
            Settings
          </button>
        </div>
      </div>
    </details>
  );
}

function Toast({
  n,
  onOpen,
  onClose,
}: {
  n: Notification;
  onOpen: () => void;
  onClose: () => void;
}) {
  const [paused, setPaused] = useState(false);
  const life = toastLifetimeMs(n);
  useEffect(() => {
    if (life === null || paused) return;
    const t = window.setTimeout(onClose, life);
    return () => window.clearTimeout(t);
  }, [life, paused]);
  return (
    <li
      className="toast"
      data-severity={n.severity}
      role={n.severity === 'needs_you' ? 'alert' : 'status'}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocus={() => setPaused(true)}
      onBlur={() => setPaused(false)}
    >
      <div className="toast-text">
        <p className="toast-title">
          {n.severity === 'needs_you' && (
            <span className="notification-tag">Needs you</span>
          )}
          {n.title}
        </p>
        {n.body && <p className="toast-body">{n.body}</p>}
      </div>
      <div className="toast-actions">
        <button className="secondary nf-open" onClick={onOpen}>
          Open
        </button>
        <button
          className="ghost icon-button toast-close"
          aria-label="Close"
          title="Close (it stays in the bell)"
          onClick={onClose}
        >
          <svg
            className="icon"
            viewBox="0 0 24 24"
            width="14"
            height="14"
            aria-hidden="true"
            focusable="false"
          >
            <path d="M6 6l12 12M18 6L6 18" />
          </svg>
        </button>
      </div>
    </li>
  );
}

/** The toasts this window won, newest last, in the corner of the window. */
export function Toasts({
  feed,
  openLink,
}: {
  feed: NotificationFeed;
  openLink: (link: string) => void;
}) {
  if (!feed.toasts.length) return null;
  return (
    <ol className="toasts" aria-label="New notifications">
      {feed.toasts.map((n) => (
        <Toast
          key={n.id}
          n={n}
          onClose={() => feed.closeToast(n.id)}
          onOpen={() => {
            feed.closeToast(n.id);
            void feed.read(n.id);
            openLink(n.link);
          }}
        />
      ))}
    </ol>
  );
}
