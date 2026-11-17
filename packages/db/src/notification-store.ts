import type { PoolClient } from 'pg';
import {
  ClaimNotificationRequestSchema,
  NOTIFICATION_EVENTS,
  NotificationGroupSchema,
  SetNotificationPreferencesRequestSchema,
  notificationMode,
  parse,
  quietHoursActive,
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
  notify,
  notifyMaintenanceFailing,
} from './notifications.js';
import { randomUUID } from 'node:crypto';
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
   * Rows that may still interrupt (the native poll and the web toast, N2–N3), newest first, so
   * a backlog of older pending rows never hides a new one (review L-5 of #235). Access is checked
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
         order by n.first_at desc, n.id desc limit 50`,
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
         interrupt_state = case when n.interrupt_state in ('pending', 'held_quiet') then 'none'
           else n.interrupt_state end
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

  /**
   * N2 (ADR-0130): "Send test" in Settings › Notifications. One row for the person asking,
   * ready to interrupt, so the next poll of a visible window shows it as a toast. A test sent
   * within the last ten seconds is returned instead of making another.
   */
  async sendTestNotification(ctxIn: CommandContext): Promise<{ id: string }> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await c.query('select pg_advisory_xact_lock($1, hashtext($2))', [
        4_310_130,
        ctx.actorId,
      ]);
      const recent = await c.query<{ id: string }>(
        `select id from notifications where actor_id = $1 and event_key = 'studio.test'
           and first_at > clock_timestamp() - interval '10 seconds' limit 1`,
        [ctx.actorId],
      );
      if (recent.rows[0]) return { id: String(recent.rows[0].id) };
      const key = randomUUID();
      const r = await notify(c, {
        actorId: ctx.actorId,
        workspaceId: null,
        eventKey: 'studio.test',
        title: 'Test notification',
        body: 'Notifications work in this window. Nothing needs you.',
        link: '#/settings/notifications',
        subjectKind: 'test',
        subjectId: key,
        dedupeKey: `test:${key}`,
        sourceKey: `test:${key}`,
      });
      if (!r)
        throw fail('VERSION_CONFLICT', 'The test was not recorded; try again.');
      return { id: r.id };
    });
  }

  /**
   * N2 (ADR-0130): once a person's quiet hours have ended, the interruptions they held become
   * one digest. Each held row is checked again first: a run continued since, an approval
   * answered or claims decided are left out quietly, and a row the person lost access to is
   * withdrawn. What still needs them is marked delivered by the digest, and the digest itself
   * interrupts once (toast or Windows). Returns the number of digests made.
   */
  async releaseQuietDigests(now = new Date()): Promise<number> {
    const { rows: people } = await this.pool.query<{ actor_id: string }>(
      `select distinct actor_id from notifications where interrupt_state = 'held_quiet'`,
    );
    let made = 0;
    for (const { actor_id } of people) {
      const done = await this.tx(async (c) => {
        await c.query('select pg_advisory_xact_lock($1, hashtext($2))', [
          4_310_131,
          actor_id,
        ]);
        const prefs = await notificationPreferencesIn(c, actor_id);
        if (quietHoursActive(prefs.body.quiet_hours, now)) return false;
        await this.#withdrawLost(c, actor_id);
        const { rows } = await c.query(
          `select * from notifications where actor_id = $1 and interrupt_state = 'held_quiet'
             and withdrawn_at is null order by first_at for update`,
          [actor_id],
        );
        const open: Row[] = [];
        for (const r of rows as Row[]) {
          // Review M-1: a mute or an "Inbox only" choice made since the row was held wins.
          const key = String(r.event_key) as NotificationEventKey;
          const quiet =
            (r.workspace_id !== null &&
              prefs.body.muted_workspaces.includes(String(r.workspace_id))) ||
            notificationMode(prefs.body, key) === 'inbox';
          const still =
            !quiet &&
            r.dismissed_at === null &&
            r.read_at === null &&
            (await stillOpen(c, r));
          if (still) open.push(r);
          else
            await c.query(
              `update notifications set interrupt_state = 'none' where id = $1`,
              [r.id],
            );
        }
        if (!open.length) return false;
        await c.query(
          `update notifications set interrupt_state = 'claimed', interrupted_via = 'digest',
             interrupted_at = clock_timestamp() where id = any($1::uuid[])`,
          [open.map((r) => r.id)],
        );
        const first = String(open[0]!.id);
        const n = open.length;
        // Review L-1: say "need you" only of rows that do.
        const needs = open.filter((r) => r.severity === 'needs_you').length;
        const items = (k: number) => `${k} item${k === 1 ? '' : 's'}`;
        const title =
          needs === n
            ? `While quiet hours were on: ${items(n)} still need${n === 1 ? 's' : ''} you`
            : needs > 0
              ? `While quiet hours were on: ${items(n)} to look at, ${needs} still need${needs === 1 ? 's' : ''} you`
              : `While quiet hours were on: ${items(n)} to look at`;
        const titles = open
          .slice(0, 3)
          .map((r) => String(r.title))
          .join(' · ');
        await notify(c, {
          actorId: actor_id,
          workspaceId: null,
          eventKey: 'studio.digest',
          title,
          severity: needs > 0 ? 'needs_you' : 'warning',
          body: n > 3 ? `${titles} · and ${n - 3} more` : titles,
          link: '#/monitor/notifications?q=unread',
          subjectKind: 'digest',
          subjectId: first,
          dedupeKey: `digest:${first}`,
          sourceKey: `digest:${first}`,
          now,
        });
        return true;
      });
      if (done) made++;
    }
    return made;
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

/**
 * Whether a held row still needs its person (N2, ADR-0130): the same autopilot stop (its
 * version unchanged), an approval still pending at the same version, or a discovery that
 * still holds claims, a refused run still active with no paid dispatch since, a connection
 * whose sign-in expired still signed out. Other rows (spend warnings, failures, a plan's usage
 * limit) stay relevant.
 */
async function stillOpen(c: PoolClient, r: Row): Promise<boolean> {
  const kind = String(r.subject_kind);
  const id = String(r.subject_id);
  const version = /:v(\d+)$/.exec(String(r.dedupe_key))?.[1];
  if (kind === 'autopilot') {
    const { rows } = await c.query(
      `select 1 from autopilots where id = $1::uuid and state = 'finished'
         and ($2::int is null or version = $2::int)`,
      [id, version ?? null],
    );
    return rows.length > 0;
  }
  if (kind === 'decision') {
    const { rows } = await c.query(
      `select 1 from decision_requests where id = $1::uuid and status = 'pending'
         and ($2::int is null or version = $2::int)`,
      [id, version ?? null],
    );
    return rows.length > 0;
  }
  if (kind === 'run') {
    // Review L-2: a refused or waiting run is still stopped while it is active and no paid
    // dispatch was admitted for it since the row was last updated.
    const { rows } = await c.query(
      `select 1 from run_controls rc where rc.run_id = $1::uuid and rc.state = 'active'
         and not exists (select 1 from budget_reservations b where b.run_id = rc.run_id
           and b.status in ('in_flight', 'settled', 'unknown') and b.created_at > $2)`,
      [id, r.last_at],
    );
    return rows.length > 0;
  }
  if (kind === 'plan_connection' && /:sign_in:/.test(String(r.dedupe_key))) {
    // A connection whose sign-in expired is resolved once it is signed in again.
    const { rows } = await c.query(
      `select 1 from plan_connections where id = $1::uuid
         and coalesce(sign_in->>'state', '') <> 'signed_in'`,
      [id],
    );
    return rows.length > 0;
  }
  if (kind === 'web_discovery') {
    const { rows } = await c.query(
      `select 1 from web_discovery_claims where discovery_id = $1::uuid
         and decision = 'pending' limit 1`,
      [id],
    );
    return rows.length > 0;
  }
  return true;
}
