import { useEffect, useState } from 'react';
import {
  NotificationGroupSchema,
  NotificationPageSchema,
  type Notification,
  type NotificationGroup,
  type Workspace,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { GROUP_LABEL } from './notification-rules.js';
import { NotificationRow, type NotificationFeed } from './notifications.js';
import type { View } from './pages.js';

// ADR-0130 (N2): every notification of the signed-in person, newest first, by group,
// workspace or unread. The bell's "View all". Only your own rows; nothing here acts.

export function NotificationHistory({
  feed,
  workspaces,
  q,
  setQ,
  openLink,
  open,
}: {
  feed: NotificationFeed;
  workspaces: readonly Workspace[];
  /** "unread" from the address (the quiet-hours digest links here with it). */
  q: string;
  setQ: (q: string) => void;
  openLink: (link: string) => void;
  open: (view: View) => void;
}) {
  const unread = q === 'unread';
  const [group, setGroup] = useState<NotificationGroup | ''>('');
  const [ws, setWs] = useState('');
  const [items, setItems] = useState<Notification[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const now = Date.now();

  async function page(after: string | null) {
    const p = new URLSearchParams();
    if (group) p.set('group', group);
    if (ws) p.set('workspace', ws);
    if (unread) p.set('unread', '1');
    if (after) p.set('cursor', after);
    const qs = p.toString();
    return api(NotificationPageSchema, `notifications${qs ? `?${qs}` : ''}`);
  }
  useEffect(() => {
    let live = true;
    setLoading(true);
    page(null)
      .then((r) => {
        if (!live) return;
        setItems(r.items);
        setCursor(r.next_cursor);
        setError('');
      })
      .catch((e: unknown) => live && setError(message(e)))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [group, ws, unread, tick]);
  async function more() {
    if (!cursor) return;
    setLoading(true);
    try {
      const r = await page(cursor);
      setItems((x) => [...x, ...r.items]);
      setCursor(r.next_cursor);
    } catch (e) {
      setError(message(e));
    } finally {
      setLoading(false);
    }
  }
  const refresh = async (p: Promise<void>) => {
    await p;
    setTick((t) => t + 1);
  };

  return (
    <section className="panel" aria-labelledby="notification-history-title">
      <h2 id="notification-history-title">Notifications</h2>
      <p>
        Everything the studio told you about, newest first. Each one only links
        to the place to act; nothing here approves, continues or spends
        anything.{' '}
        <button className="text" onClick={() => open('notifysettings')}>
          Change what interrupts you
        </button>
      </p>
      <div className="notification-filters">
        <label>
          Kind
          <select
            value={group}
            onChange={(e) =>
              setGroup(
                e.target.value
                  ? NotificationGroupSchema.parse(e.target.value)
                  : '',
              )
            }
          >
            <option value="">All kinds</option>
            {NotificationGroupSchema.options.map((g) => (
              <option key={g} value={g}>
                {GROUP_LABEL[g]}
              </option>
            ))}
          </select>
        </label>
        {workspaces.length > 1 && (
          <label>
            Workspace
            <select value={ws} onChange={(e) => setWs(e.target.value)}>
              <option value="">All workspaces</option>
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}
        <label className="check">
          <input
            type="checkbox"
            checked={unread}
            onChange={(e) => setQ(e.target.checked ? 'unread' : '')}
          />
          Unread only
        </label>
        {(feed.recent?.unread ?? 0) > 0 && (
          <button
            className="secondary"
            onClick={() => void refresh(feed.readAll())}
          >
            Mark all read
          </button>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {!loading && !error && items.length === 0 && (
        <p className="small">
          {unread || group || ws
            ? 'Nothing matches these filters.'
            : 'No notifications yet.'}
        </p>
      )}
      {items.length > 0 && (
        <ul className="notification-list">
          {items.map((n) => (
            <NotificationRow
              key={n.id}
              n={n}
              now={now}
              onOpen={() => {
                if (!n.read_at) void feed.read(n.id);
                openLink(n.link);
              }}
              onRead={() => void refresh(feed.read(n.id))}
              onDismiss={() => void refresh(feed.dismiss(n.id))}
            />
          ))}
        </ul>
      )}
      {loading && <p className="small">Loading…</p>}
      {cursor && !loading && (
        <button className="secondary" onClick={() => void more()}>
          Show older
        </button>
      )}
    </section>
  );
}
