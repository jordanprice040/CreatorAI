import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { createApi } from '@creator/api';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NativeCatchUpSchema,
  NativeNotificationsSchema,
  WindowsNotificationStatusSchema,
  type NotificationPreferencesBody,
} from '@creator/contracts';
import {
  ConnectionStore,
  NotificationStore,
  type CommandContext,
} from '@creator/db';
import { freshDatabase, LOGIN_CODE, login } from './pg-harness.js';
import { loadWeb } from './web-module.js';

// ADR-0131 (N3): Windows notifications from the installed app. The native poll sees only rows
// that interrupt, with their age on the studio's clock; the start-up summary covers rows that
// expired unseen and still need the person, once, already claimed for Windows.

const owner: CommandContext = { actorId: randomUUID() };
const member: CommandContext = { actorId: randomUUID() };

class Harness extends ConnectionStore {
  emit(
    ctx: CommandContext,
    e: {
      workspaceId: string;
      action: string;
      subjectKind: string;
      subjectId: string;
      subjectVersion: number | null;
      payload?: Record<string, unknown>;
    },
  ): Promise<string> {
    return this.tx((c) =>
      this.append(c, ctx, { contentHash: null, payload: {}, ...e }),
    );
  }
}

const hhmm = (d: Date) => d.toISOString().slice(11, 16);
function quietNow(urgent = false): NotificationPreferencesBody {
  const now = Date.now();
  return {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    quiet_hours: {
      enabled: true,
      start: hhmm(new Date(now - 3_600_000)),
      end: hhmm(new Date(now + 3_600_000)),
      tz: 'UTC',
      days: [0, 1, 2, 3, 4, 5, 6],
      urgent_override: urgent,
    },
  };
}

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new Harness(db.pool, { lateWindowMs: 0 });
  const inbox = new NotificationStore(db.pool);
  for (const [ctx, name] of [
    [owner, 'Owner'],
    [member, 'Member'],
  ] as const)
    await store.ensureActor({
      id: ctx.actorId,
      kind: 'human',
      display_name: name,
    });
  const ws = await store.createWorkspace(owner, {
    name: 'Native',
    record_mode: 'fixture',
  });
  await store.addMember(owner, ws.id, member.actorId, 'owner');
  const run = async () => {
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: 'Run',
      body: {
        state: 'queued',
        experiment_condition: 'human_in_loop',
        discovery_method: 'structured',
        config_hash: null,
      },
    });
    return (
      await store.registerRun(owner, ws.id, {
        run: { id: r.id, version: 1 },
        autonomy_mode: 'human_in_loop',
        stage_gates: null,
        initial_grants: [],
      })
    ).run_id;
  };
  /** An autopilot started by `by` that stopped at version 2 needing a person. */
  const stopped = async (by: CommandContext = owner) => {
    const id = randomUUID();
    await db.pool.query(
      `insert into autopilots (id, workspace_id, run_id, fixture, config, config_hash, summary,
         policy_version, state, stage, outcome, explanation, steps, version, created_by, finished_at)
       values ($1,$2,$3,true,'{}',$4,array['Synthetic autopilot.'],'autopilot/1.0','finished',
         'select','needs_person','Two options are tied.',$5,2,$6,clock_timestamp())`,
      [
        id,
        ws.id,
        await run(),
        'a'.repeat(64),
        JSON.stringify([{ stop_kind: 'tie' }]),
        by.actorId,
      ],
    );
    await store.emit(
      { ...by, autopilot: { id } },
      {
        workspaceId: ws.id,
        action: 'autopilot.finished',
        subjectKind: 'autopilot',
        subjectId: id,
        subjectVersion: 2,
        payload: { outcome: 'needs_person' },
      },
    );
    await store.drainOutbox();
    return id;
  };
  const rows = (sql: string, args: unknown[] = []) =>
    db.pool.query(sql, args).then((r) => r.rows as Record<string, unknown>[]);
  /** Makes every row of `actor` look as if it arrived `minutes` ago. */
  const age = (actor: CommandContext, minutes: number) =>
    db.pool.query(
      `update notifications set first_at = clock_timestamp() - make_interval(mins => $2),
         last_at = clock_timestamp() - make_interval(mins => $2) where actor_id = $1`,
      [actor.actorId, minutes],
    );
  return { db, store, inbox, ws, stopped, rows, age };
}

test('N3: the native poll lists interrupting rows only, with their age and the hide-details choice', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.stopped();
  // A toast-only row (like Build ready) is never a Windows notification.
  const toast = await s.stopped();
  await s.db.pool.query(
    `update notifications set mode = 'toast_only' where subject_id = $1`,
    [toast],
  );
  let native = NativeNotificationsSchema.parse(
    await s.inbox.nativeNotifications(owner),
  );
  assert.equal(native.hide_details, false);
  assert.equal(native.items.length, 1, JSON.stringify(native.items));
  const [row] = native.items;
  assert.match(row!.link, /^#\/autopilot\//);
  assert.ok(row!.age_ms >= 0 && row!.age_ms < 60_000, String(row!.age_ms));
  assert.equal((await s.inbox.pendingNotifications(owner)).length, 2);

  // Age is on the studio's clock.
  await s.age(owner, 2);
  native = await s.inbox.nativeNotifications(owner);
  assert.ok(
    native.items[0]!.age_ms >= 119_000,
    String(native.items[0]!.age_ms),
  );

  // Hide details is the person's own setting.
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body: { ...DEFAULT_NOTIFICATION_PREFERENCES, windows_hide_details: true },
  });
  native = await s.inbox.nativeNotifications(owner);
  assert.equal(native.hide_details, true);

  // Once the web toast or the native process claims it, it is gone from the list; the loser
  // gets a conflict (one interruption per row).
  await s.inbox.claimNotification(owner, row!.id, { via: 'windows' });
  await assert.rejects(
    s.inbox.claimNotification(owner, row!.id, { via: 'toast' }),
    /already shown/,
  );
  assert.deepEqual((await s.inbox.nativeNotifications(owner)).items, []);

  // Past ten minutes a row is not shown late.
  await s.stopped();
  await s.age(owner, 11);
  assert.deepEqual((await s.inbox.nativeNotifications(owner)).items, []);
});

test('N3: the start-up summary names what still needs you once, already claimed for Windows', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const still = await s.stopped();
  const continued = await s.stopped();
  const read = await s.stopped();
  // All three expired unseen while the app was closed (the sweep has not run yet).
  await s.age(owner, 30);
  // One was continued since; one the owner already read in a browser.
  await s.db.pool.query(
    `update autopilots set state = 'running', outcome = null, finished_at = null, version = 3
      where id = $1`,
    [continued],
  );
  await s.db.pool.query(
    `update notifications set read_at = clock_timestamp() where subject_id = $1`,
    [read],
  );
  const up = NativeCatchUpSchema.parse(
    await s.inbox.catchUpNotifications(owner),
  );
  assert.equal(up.count, 1);
  assert.ok(up.notification);
  assert.equal(up.notification.title, 'Missed alerts: 1 item still needs you');
  assert.equal(up.notification.link, '#/monitor/notifications?q=unread');
  const byId = async (subject: string) =>
    (
      await s.rows(
        `select interrupt_state, interrupted_via from notifications
          where subject_id = $1 and actor_id = $2`,
        [subject, owner.actorId],
      )
    )[0]!;
  assert.deepEqual(await byId(still), {
    interrupt_state: 'claimed',
    interrupted_via: 'digest',
  });
  assert.equal((await byId(continued)).interrupt_state, 'expired');
  assert.equal((await byId(read)).interrupt_state, 'expired');
  const [summary] = await s.rows(
    `select event_key, interrupt_state, interrupted_via, actor_id from notifications
      where event_key = 'studio.catch_up'`,
  );
  assert.deepEqual(summary, {
    event_key: 'studio.catch_up',
    interrupt_state: 'claimed',
    interrupted_via: 'windows',
    actor_id: owner.actorId,
  });
  // No browser tab can show it again, and the next start summarises nothing.
  assert.deepEqual(await s.inbox.pendingNotifications(owner), []);
  assert.deepEqual(await s.inbox.catchUpNotifications(owner), {
    hide_details: false,
    count: 0,
    notification: null,
  });
  // The summary is in the bell like any other row.
  const recent = await s.inbox.recentNotifications(owner);
  assert.ok(recent.items.some((n) => n.event_key === 'studio.catch_up'));
});

test('N3 review M-1 and L-1: the summary covers rows still pending from before the start, and says to hide details', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body: { ...DEFAULT_NOTIFICATION_PREFERENCES, windows_hide_details: true },
  });
  // Arrived two minutes before the app started: still pending, nobody showed it.
  const recent = await s.stopped();
  await s.age(owner, 2);
  // A toast-only row is never a Windows summary item, and stays pending.
  const toast = await s.stopped();
  await s.db.pool.query(
    `update notifications set mode = 'toast_only' where subject_id = $1 and actor_id = $2`,
    [toast, owner.actorId],
  );
  const up = NativeCatchUpSchema.parse(
    await s.inbox.catchUpNotifications(owner),
  );
  assert.equal(up.hide_details, true);
  assert.equal(up.count, 1);
  assert.match(up.notification!.title, /^Missed alerts: 1 item/);
  const state = async (subject: string) =>
    (
      await s.rows(
        `select interrupt_state, interrupted_via from notifications
          where subject_id = $1 and actor_id = $2`,
        [subject, owner.actorId],
      )
    )[0]!;
  assert.deepEqual(await state(recent), {
    interrupt_state: 'claimed',
    interrupted_via: 'digest',
  });
  assert.equal((await state(toast)).interrupt_state, 'pending');
  // Nothing is left for the poll to show a second time.
  assert.deepEqual((await s.inbox.nativeNotifications(owner)).items, []);
});

test('N3: the start-up summary re-checks access, mutes and quiet hours', async (t) => {
  const s = await setup(t);
  if (!s) return;
  // The member's own stopped run, then the member leaves: withdrawn, never summarised.
  await s.stopped(member);
  await s.age(member, 30);
  await s.store.removeMember(
    owner,
    s.ws.id,
    member.actorId,
    'Left the project.',
  );
  assert.deepEqual(await s.inbox.catchUpNotifications(member), {
    hide_details: false,
    count: 0,
    notification: null,
  });
  const [gone] = await s.rows(
    `select withdrawn_at from notifications where actor_id = $1`,
    [member.actorId],
  );
  assert.ok(gone!.withdrawn_at);

  // A workspace muted since: it stays in the inbox only.
  const muted = await s.stopped();
  await s.age(owner, 30);
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 0,
    body: { ...DEFAULT_NOTIFICATION_PREFERENCES, muted_workspaces: [s.ws.id] },
  });
  assert.equal((await s.inbox.catchUpNotifications(owner)).count, 0);
  assert.equal(
    (
      await s.rows(
        `select interrupt_state from notifications where subject_id = $1 and actor_id = $2`,
        [muted, owner.actorId],
      )
    )[0]!.interrupt_state,
    'expired',
  );

  // Quiet hours: held for the digest instead, which names it once quiet hours end.
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 1,
    body: quietNow(),
  });
  assert.equal((await s.inbox.catchUpNotifications(owner)).count, 0);
  assert.equal(
    (
      await s.rows(
        `select interrupt_state from notifications where subject_id = $1 and actor_id = $2`,
        [muted, owner.actorId],
      )
    )[0]!.interrupt_state,
    'held_quiet',
  );
  assert.equal(
    await s.inbox.releaseQuietDigests(new Date(Date.now() + 3 * 3_600_000)),
    1,
  );

  // With the urgent override on, an urgent row is summarised even in quiet hours.
  await s.inbox.setNotificationPreferences(owner, {
    expected_version: 2,
    body: quietNow(true),
  });
  const urgent = await s.stopped();
  await s.age(owner, 30);
  // Earlier rows are claimed already. The digest also expired unseen, so it is named again
  // with the new stop (a test notification or an earlier summary never is).
  const up = await s.inbox.catchUpNotifications(owner);
  assert.equal(up.count, 2);
  assert.match(up.notification!.body, /While quiet hours were on/);
  assert.equal(
    (
      await s.rows(
        `select interrupted_via from notifications where subject_id = $1 and actor_id = $2`,
        [urgent, owner.actorId],
      )
    )[0]!.interrupted_via,
    'digest',
  );
});

test('N3: the native routes need the session; Settings learns whether the installed app delivers', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const api = createApi({
    CREATOR_DATABASE_URL: db.url,
    CREATOR_DEV_LOGIN_CODE: LOGIN_CODE,
    CREATOR_WORKER: 'off',
  });
  api.server.listen(0, '127.0.0.1');
  await once(api.server, 'listening');
  t.after(api.close);
  await api.ready();
  const port = (api.server.address() as { port: number }).port;
  const base = `http://127.0.0.1:${port}/api`;
  const auth = await login(base);
  const call = async (
    method: string,
    path: string,
    headers: Record<string, string>,
  ) => {
    const r = await fetch(`${base}/notifications/${path}`, {
      method,
      headers: {
        ...headers,
        ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(method === 'POST' ? { body: '{}' } : {}),
    });
    return { status: r.status, body: (await r.json()) as unknown };
  };

  // Signed out: refused. The summary is a write and needs the CSRF token.
  assert.equal((await call('GET', 'native', {})).status, 401);
  assert.equal((await call('GET', 'windows-status', {})).status, 401);
  assert.equal((await call('POST', 'catch-up', auth.read)).status, 403);

  let status = WindowsNotificationStatusSchema.parse(
    (await call('GET', 'windows-status', auth.read)).body,
  );
  assert.deepEqual(status, { state: 'not_running', seen_at: null });

  // "Send test" makes a row; the native poll (as the installed app sends it: the session
  // cookie, no browser Origin) lists it.
  assert.equal((await call('POST', 'test', auth.write)).status, 200);
  const native = NativeNotificationsSchema.parse(
    (await call('GET', 'native?os=on', auth.read)).body,
  );
  assert.equal(native.items.length, 1);
  assert.equal(native.items[0]!.title, 'Test notification');
  status = WindowsNotificationStatusSchema.parse(
    (await call('GET', 'windows-status', auth.read)).body,
  );
  assert.equal(status.state, 'on');
  assert.ok(status.seen_at);

  // Windows itself has the app's notifications turned off.
  await call('GET', 'native?os=off', auth.read);
  status = WindowsNotificationStatusSchema.parse(
    (await call('GET', 'windows-status', auth.read)).body,
  );
  assert.equal(status.state, 'off_in_windows');
  // An unknown value is read as "unknown", and the installed app claims nothing then.
  await call('GET', 'native?os=maybe', auth.read);
  status = WindowsNotificationStatusSchema.parse(
    (await call('GET', 'windows-status', auth.read)).body,
  );
  assert.equal(status.state, 'unavailable');
  await call('GET', 'native?os=on', auth.read);

  // The claim the native process makes, with the token the installed app reads.
  const claimed = await fetch(
    `${base}/notifications/${native.items[0]!.id}/claim`,
    {
      method: 'POST',
      headers: { ...auth.write, 'Content-Type': 'application/json' },
      body: JSON.stringify({ via: 'windows' }),
    },
  );
  assert.equal(claimed.status, 200);
  const catchUp = NativeCatchUpSchema.parse(
    (await call('POST', 'catch-up', auth.write)).body,
  );
  assert.deepEqual(catchUp, {
    hide_details: false,
    count: 0,
    notification: null,
  });
});

test('N3: Settings says whether Windows notifications are on, off in Windows, or need the app', async () => {
  const r = (await loadWeb('notification-rules.ts')) as {
    windowsStatusText(
      s: {
        state: 'on' | 'off_in_windows' | 'unavailable' | 'not_running';
      } | null,
    ): string;
  };
  assert.match(
    r.windowsStatusText({ state: 'on' }),
    /^On in the Creator Agent app/,
  );
  assert.match(
    r.windowsStatusText({ state: 'off_in_windows' }),
    /Windows Settings/,
  );
  assert.match(
    r.windowsStatusText({ state: 'unavailable' }),
    /cannot show Windows notifications/,
  );
  assert.doesNotMatch(
    r.windowsStatusText({ state: 'unavailable' }),
    /Windows Settings/,
  );
  assert.match(
    r.windowsStatusText({ state: 'not_running' }),
    /Open the installed Creator Agent app.*never/,
  );
  assert.match(r.windowsStatusText(null), /unknown/);
});
