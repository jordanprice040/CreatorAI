import type { PoolClient } from 'pg';
import {
  ClaimNotificationRequestSchema,
  NOTIFICATION_EVENTS,
  NotificationGroupSchema,
  SetNotificationPreferencesRequestSchema,
  parse,
  z,
  type Notification,
  type NotificationClaim,
  type NotificationEventKey,
  type NotificationGroup,
  type NotificationPage,
  type NotificationPreferences,
  type RecentNotifications,
} from '@creator/contracts';
import {
  Store,
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';
import {
  notificationPreferencesIn,
  notifyMaintenanceFailing,
} from './notifications.js';
import { isSpendingManagerIn } from './spending-manager.js';

/** A pending interruption older than this is not shown any more; it stays in the inbox. */
export const NOTIFICATION_PENDING_MS = 10 * 60 * 1000;
/** Retention: 90 days or the newest 1,000 per person, whichever keeps more. */
export const NOTIFICATION_KEEP_DAYS = 90;
export const NOTIFICATION_KEEP_LATEST = 1000;

const PAGE = 50;

/**
 * Who may see a row now: its own workspace's members, and for studio-wide spending rows only
 * the studio spending manager (ADR-0113). Rows are checked again at every read, so a person
 * who lost access no longer sees what they cannot open.
 */
const VISIBLE = `n.actor_id = $1 and n.withdrawn_at is null and (
  (n.workspace_id is not null and exists (select 1 from workspace_members m
     where m.workspace_id = n.workspace_id and m.actor_id = n.actor_id))
  or (n.workspace_id is null and (n.event_key not like 'spend.%' or $2::boolean)))`;

function toNotification(r: Row): Notification {
  const key = String(r.event_key) as NotificationEventKey;
  return {
    id: String(r.id),
    workspace_id: r.workspace_id ? String(r.workspace_id) : null,
    event_key: key,
    group: NOTIFICATION_EVENTS[key].group,
    severity: r.severity as Notification['severity'],
    mode: r.mode as Notification['mode'],
    title: String(r.title),
    body: String(r.body),
    link: String(r.link),
    subject_kind: String(r.subject_kind),
    subject_id: String(r.subject_id),
    occurrences: Number(r.occurrences),
    interrupt_state: r.interrupt_state as Notification['interrupt_state'],
    interrupted_via:
      (r.interrupted_via as Notification['interrupted_via']) ?? null,
    interrupted_at: r.interrupted_at ? iso(r.interrupted_at) : null,
    batch_id: r.batch_id ? String(r.batch_id) : null,
    first_at: iso(r.first_at),
    last_at: iso(r.last_at),
    read_at: r.read_at ? iso(r.read_at) : null,
    dismissed_at: r.dismissed_at ? iso(r.dismissed_at) : null,
  };
}

const groupKeys = (g: NotificationGroup) =>
  Object.entries(NOTIFICATION_EVENTS)
    .filter(([, v]) => v.group === g)
    .map(([k]) => k);

/**
 * ADR-0116 (N1): the person-scoped notification routes. Every method reads and changes only
 * the signed-in person's own rows; none approves, continues, spends or admits anything.
 */
export class NotificationStore extends Store {
  async #manager(c: PoolClient, actorId: string) {
    return isSpendingManagerIn(c, actorId);
  }

  /** View all: newest first, by group, workspace or unread, in pages. */
  async notifications(
    ctxIn: CommandContext,
    q: {
      cursor?: string | null;
      group?: string | null;
      workspace?: string | null;
      unread?: boolean;
    } = {},
  ): Promise<NotificationPage> {
    const ctx = normalize(ctxIn);
    const group = q.group ? parse(NotificationGroupSchema, q.group) : null;
    const ws = q.workspace ? uuid(q.workspace, 'INVALID_CONTRACT') : null;
    let after: { at: string; id: string } | null = null;
    if (q.cursor) {
      const m = /^([0-9T:.\-Z]{20,30})\|([0-9a-f-]{36})$/.exec(q.cursor);
      if (!m) throw fail('INVALID_CONTRACT', 'Unknown cursor.');
      after = { at: m[1]!, id: m[2]! };
    }
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `select n.* from notifications n where ${VISIBLE}
           and n.dismissed_at is null
           and ($3::text[] is null or n.event_key = any($3))
           and ($4::uuid is null or n.workspace_id = $4)
           and (not $5::boolean or n.read_at is null)
           and ($6::timestamptz is null or (n.last_at, n.id) < ($6::timestamptz, $7::uuid))
         order by n.last_at desc, n.id desc limit $8`,
        [
          ctx.actorId,
          await this.#manager(c, ctx.actorId),
          group ? groupKeys(group) : null,
          ws,
          q.unread === true,
          after?.at ?? null,
          after?.id ?? null,
          PAGE + 1,
        ],
      );
      const items = rows.slice(0, PAGE).map((r) => toNotification(r as Row));
      const last = items.at(-1);
      return {
        items,
        next_cursor:
          rows.length > PAGE && last ? `${last.last_at}|${last.id}` : null,
      };
    });
  }

  /** The bell: the unread count and the newest items, unread "needs you" first. */
  async recentNotifications(
    ctxIn: CommandContext,
  ): Promise<RecentNotifications> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      const manager = await this.#manager(c, ctx.actorId);
      const unread = await c.query<{ n: number }>(
        `select count(*)::int as n from notifications n where ${VISIBLE}
           and n.dismissed_at is null and n.read_at is null`,
        [ctx.actorId, manager],
      );
      const { rows } = await c.query(
        `select n.* from notifications n where ${VISIBLE} and n.dismissed_at is null
          order by (n.read_at is null and n.severity = 'needs_you') desc, n.last_at desc, n.id desc
          limit 20`,
        [ctx.actorId, manager],
      );
      return {
        unread: Number(unread.rows[0]?.n ?? 0),
        items: rows.map((r) => toNotification(r as Row)),
      };
    });
  }

  /**
   * Rows that may still interrupt (the native poll and the web toast, N2–N3). Access is checked
   * again first: a row whose person lost access is withdrawn and never delivered.
   */
  async pendingNotifications(ctxIn: CommandContext): Promise<Notification[]> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.#withdrawLost(c, ctx.actorId);
      const { rows } = await c.query(
        `select n.* from notifications n where ${VISIBLE}
           and n.interrupt_state = 'pending' and n.dismissed_at is null
           and n.first_at > clock_timestamp() - make_interval(secs => $3::double precision / 1000)
         order by n.first_at limit 50`,
        [
          ctx.actorId,
          await this.#manager(c, ctx.actorId),
          NOTIFICATION_PENDING_MS,
        ],
      );
      return rows.map((r) => toNotification(r as Row));
    });
  }

  async #withdrawLost(c: PoolClient, actorId: string) {
    await c.query(
      `update notifications n set withdrawn_at = clock_timestamp(),
         interrupt_state = case when n.interrupt_state = 'pending' then 'none' else n.interrupt_state end
        where n.actor_id = $1 and n.withdrawn_at is null and not (${VISIBLE})`,
      [actorId, await this.#manager(c, actorId)],
    );
  }

  /**
   * One interruption per notification: a toast or a Windows notification may be shown only by
   * the caller that wins this claim. Everyone else gets VERSION_CONFLICT (409). A toast-only
   * row is never claimed for Windows.
   */
  async claimNotification(
    ctxIn: CommandContext,
    idIn: string,
    raw: unknown,
  ): Promise<NotificationClaim> {
    const ctx = normalize(ctxIn);
    const id = uuid(idIn);
    const { via } = parse(ClaimNotificationRequestSchema, raw);
    return this.tx(async (c) => {
      await this.#withdrawLost(c, ctx.actorId);
      const { rows } = await c.query(
        `update notifications n set interrupt_state = 'claimed', interrupted_via = $4,
           interrupted_at = clock_timestamp()
         where n.id = $3 and ${VISIBLE} and n.interrupt_state = 'pending'
           and n.dismissed_at is null and ($4 = 'toast' or n.mode = 'interrupt')
           and n.first_at > clock_timestamp() - make_interval(secs => $5::double precision / 1000)
         returning n.id, n.interrupted_via, n.interrupted_at`,
        [
          ctx.actorId,
          await this.#manager(c, ctx.actorId),
          id,
          via,
          NOTIFICATION_PENDING_MS,
        ],
      );
      const r = rows[0] as Row | undefined;
      if (r)
        return {
          id: String(r.id),
          interrupt_state: 'claimed' as const,
          interrupted_via: via,
          interrupted_at: iso(r.interrupted_at),
        };
      const own = await c.query(
        `select 1 from notifications n where n.id = $3 and ${VISIBLE}`,
        [ctx.actorId, await this.#manager(c, ctx.actorId), id],
      );
      if (!own.rowCount) throw fail('NOT_FOUND', 'Notification not found.');
      throw fail(
        'VERSION_CONFLICT',
        'This notification was already shown, or it does not interrupt.',
      );
    });
  }

  async #mark(
    ctxIn: CommandContext,
    idIn: string,
    column: 'read_at' | 'dismissed_at',
  ): Promise<Notification> {
    const ctx = normalize(ctxIn);
    const id = uuid(idIn);
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `update notifications n set ${column} = coalesce(n.${column}, clock_timestamp())
           ${column === 'dismissed_at' ? ', read_at = coalesce(n.read_at, clock_timestamp())' : ''}
         where n.id = $3 and ${VISIBLE} returning n.*`,
        [ctx.actorId, await this.#manager(c, ctx.actorId), id],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Notification not found.');
      return toNotification(rows[0] as Row);
    });
  }

  readNotification(ctx: CommandContext, id: string) {
    return this.#mark(ctx, id, 'read_at');
  }
  dismissNotification(ctx: CommandContext, id: string) {
    return this.#mark(ctx, id, 'dismissed_at');
  }

  async readAllNotifications(ctxIn: CommandContext): Promise<{ read: number }> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      const r = await c.query(
        `update notifications n set read_at = clock_timestamp()
          where ${VISIBLE} and n.read_at is null`,
        [ctx.actorId, await this.#manager(c, ctx.actorId)],
      );
      return { read: r.rowCount ?? 0 };
    });
  }

  async notificationPreferences(
    ctxIn: CommandContext,
  ): Promise<NotificationPreferences> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      const p = await notificationPreferencesIn(c, ctx.actorId);
      return {
        version: p.version,
        body: p.body,
        updated_at: p.at ? iso(p.at) : null,
      };
    });
  }

  /** A stale `expected_version` (another window saved first) is refused. */
  async setNotificationPreferences(
    ctxIn: CommandContext,
    raw: unknown,
  ): Promise<NotificationPreferences> {
    const ctx = normalize(ctxIn);
    const req = parse(SetNotificationPreferencesRequestSchema, raw);
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `insert into notification_preferences (actor_id, version, body) values ($1, 1, $2)
         on conflict (actor_id) do update set body = excluded.body,
           version = notification_preferences.version + 1, updated_at = clock_timestamp()
         where notification_preferences.version = $3
         returning version, body, updated_at`,
        [ctx.actorId, JSON.stringify(req.body), req.expected_version],
      );
      const r = rows[0] as Row | undefined;
      // A first save expects 0; a row that exists means another window saved first.
      if (!r || (req.expected_version === 0 && Number(r.version) !== 1))
        throw fail(
          'VERSION_CONFLICT',
          'Your notification settings changed in another window; reload and try again.',
        );
      return {
        version: Number(r.version),
        body: req.body,
        updated_at: iso(r.updated_at),
      };
    });
  }

  /**
   * The maintenance pass: pending interruptions older than ten minutes expire (inbox only), and
   * rows beyond retention are removed. Removing a notification never touches its source record.
   */
  async sweepNotifications(): Promise<{ expired: number; removed: number }> {
    return this.tx(async (c) => {
      const expired = await c.query(
        `update notifications set interrupt_state = 'expired'
          where interrupt_state = 'pending'
            and first_at <= clock_timestamp() - make_interval(secs => $1::double precision / 1000)`,
        [NOTIFICATION_PENDING_MS],
      );
      const removed = await c.query(
        `delete from notifications where id in (
           select id from (select id, last_at, row_number() over (
               partition by actor_id order by last_at desc, id desc) as rank
             from notifications) x
            where x.rank > $1
              and x.last_at < clock_timestamp() - make_interval(days => $2))`,
        [NOTIFICATION_KEEP_LATEST, NOTIFICATION_KEEP_DAYS],
      );
      return { expired: expired.rowCount ?? 0, removed: removed.rowCount ?? 0 };
    });
  }

  /** A background job failing for more than ten minutes, for the studio's owner (Advanced). */
  async notifyMaintenance(
    ownerId: string,
    job: string,
    code: string,
    now = new Date(),
  ): Promise<void> {
    const actorId = uuid(ownerId, 'INVALID_CONTRACT');
    const name = parse(z.string().regex(/^[a-z_]{1,40}$/), job);
    const hour = now
      .toISOString()
      .slice(0, 13)
      .replace(/[^0-9]/g, '');
    await this.tx(async (c) => {
      const { rows } = await c.query(
        `select 1 from actors where id = $1 and kind = 'human'`,
        [actorId],
      );
      if (!rows.length) return;
      await notifyMaintenanceFailing(c, {
        actorId,
        job: name,
        code: code.slice(0, 48),
        hour,
      });
    });
  }
}
