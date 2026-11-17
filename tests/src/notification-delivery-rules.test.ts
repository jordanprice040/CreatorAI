import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_NOTIFICATION_PREFERENCES,
  NotificationPreferencesBodySchema,
  interruptStateFor,
  notificationMode,
  quietHoursActive,
  type Notification,
  type NotificationEventKey,
  type NotificationGroup,
  type NotificationMode,
  type NotificationPreferencesBody,
} from '@creator/contracts';
import { loadWeb } from './web-module.js';

// ADR-0130 (N2): quiet hours, mutes and the toast rules, without a browser or a database.

type Events = NotificationPreferencesBody['events'];
type Rules = {
  unreadLabel(n: number): string;
  toastCandidates(
    pending: readonly Notification[],
    visibleSince: number,
    tried: ReadonlySet<string>,
  ): Notification[];
  serverOffsetMs(
    date: string | null,
    sentAt: number,
    receivedAt: number,
  ): number;
  withToast(
    t: readonly Notification[],
    n: Notification,
    max?: number,
  ): Notification[];
  groupSummary(g: NotificationGroup): string;
  toastLifetimeMs(n: Pick<Notification, 'severity'>): number | null;
  listedEvents(advanced: boolean): NotificationEventKey[];
  listedGroups(advanced: boolean): NotificationGroup[];
  groupChoice(events: Events, g: NotificationGroup): string;
  setGroup(
    events: Events,
    g: NotificationGroup,
    c: 'defaults' | 'inbox',
  ): Events;
  setEvent(
    events: Events,
    k: NotificationEventKey,
    m: NotificationMode,
  ): Events;
  modesOf(k: NotificationEventKey): NotificationMode[];
};
type Pages = { parseRoute(h: string): { view: string; q: string } };

const quiet = (
  over: Partial<NotificationPreferencesBody['quiet_hours']> = {},
): NotificationPreferencesBody['quiet_hours'] => ({
  ...DEFAULT_NOTIFICATION_PREFERENCES.quiet_hours,
  enabled: true,
  tz: 'UTC',
  ...over,
});

test('N2: quiet hours cross midnight, follow the start day and the time zone', () => {
  const q = quiet({ start: '22:00', end: '07:00', days: [5] }); // Friday nights
  // 2026-11-20 is a Friday.
  assert.equal(quietHoursActive(q, new Date('2026-11-20T21:59:00Z')), false);
  assert.equal(quietHoursActive(q, new Date('2026-11-20T22:00:00Z')), true);
  assert.equal(quietHoursActive(q, new Date('2026-11-21T06:59:00Z')), true);
  assert.equal(quietHoursActive(q, new Date('2026-11-21T07:00:00Z')), false);
  // Saturday night is not listed, and Friday morning belongs to Thursday's window.
  assert.equal(quietHoursActive(q, new Date('2026-11-21T23:00:00Z')), false);
  assert.equal(quietHoursActive(q, new Date('2026-11-20T03:00:00Z')), false);
  // A same-day window, off, empty, or with no days.
  const day = quiet({ start: '09:00', end: '17:00' });
  assert.equal(quietHoursActive(day, new Date('2026-11-20T12:00:00Z')), true);
  assert.equal(quietHoursActive(day, new Date('2026-11-20T17:00:00Z')), false);
  assert.equal(
    quietHoursActive(
      { ...day, enabled: false },
      new Date('2026-11-20T12:00:00Z'),
    ),
    false,
  );
  assert.equal(
    quietHoursActive(
      quiet({ start: '09:00', end: '09:00' }),
      new Date('2026-11-20T09:00:00Z'),
    ),
    false,
  );
  assert.equal(
    quietHoursActive({ ...day, days: [] }, new Date('2026-11-20T12:00:00Z')),
    false,
  );
  // 22:00 in New York is 03:00 UTC the next day (November: UTC-5).
  const ny = quiet({
    start: '22:00',
    end: '23:00',
    tz: 'America/New_York',
    days: [5],
  });
  assert.equal(quietHoursActive(ny, new Date('2026-11-21T03:30:00Z')), true);
  assert.equal(quietHoursActive(ny, new Date('2026-11-20T22:30:00Z')), false);
});

test('N2: a mute beats the urgent override; quiet hours hold all but urgent items when it is on', () => {
  const ws = '00000000-0000-4000-8000-000000000001';
  const at = new Date('2026-11-20T12:00:00Z');
  const base: NotificationPreferencesBody = {
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    quiet_hours: quiet({ start: '09:00', end: '17:00' }),
  };
  const state = (
    prefs: NotificationPreferencesBody,
    eventKey: NotificationEventKey,
    over: {
      workspaceId?: string | null;
      batched?: boolean;
      interrupt?: boolean;
    } = {},
  ) =>
    interruptStateFor(
      prefs,
      { eventKey, workspaceId: ws, batched: false, interrupt: true, ...over },
      at,
    );
  assert.equal(state(base, 'autopilot.needs_you'), 'held_quiet');
  // Toast only is never held for the digest (review L-1): it stays in the inbox.
  assert.equal(state(base, 'build.ready'), 'none');
  assert.equal(state(base, 'autopilot.failed'), 'held_quiet');
  assert.equal(state(base, 'workflow.finished'), 'none'); // inbox only by default
  const override = {
    ...base,
    quiet_hours: { ...base.quiet_hours, urgent_override: true },
  };
  assert.equal(state(override, 'autopilot.needs_you'), 'pending');
  assert.equal(
    state(override, 'spend.refused', { workspaceId: null }),
    'pending',
  );
  assert.equal(state(override, 'autopilot.failed'), 'held_quiet');
  const muted = { ...override, muted_workspaces: [ws] };
  assert.equal(state(muted, 'autopilot.needs_you'), 'none');
  assert.equal(state(muted, 'approval.asked'), 'none');
  // Outside quiet hours, the usual rules; batches and lower thresholds never interrupt.
  const off = { ...base, quiet_hours: { ...base.quiet_hours, enabled: false } };
  assert.equal(state(off, 'autopilot.needs_you'), 'pending');
  assert.equal(state(off, 'qualification.failures', { batched: true }), 'none');
  assert.equal(state(off, 'spend.80', { interrupt: false }), 'none');
  // The studio's own rows ignore saved choices, mutes and quiet hours.
  const stubborn = {
    ...muted,
    events: { 'studio.digest': 'inbox', 'studio.test': 'inbox' } as Events,
  };
  assert.equal(notificationMode(stubborn, 'studio.test'), 'interrupt');
  assert.equal(
    state(stubborn, 'studio.digest', { workspaceId: null }),
    'pending',
  );
  assert.equal(
    state(stubborn, 'studio.test', { workspaceId: null }),
    'pending',
  );
});

const row = (id: string, over: Partial<Notification> = {}): Notification => ({
  id,
  workspace_id: null,
  event_key: 'autopilot.needs_you',
  group: 'runs',
  severity: 'needs_you',
  mode: 'interrupt',
  title: 'Autopilot stopped',
  body: '',
  link: '#/autopilot/run',
  subject_kind: 'autopilot',
  subject_id: id,
  occurrences: 1,
  interrupt_state: 'pending',
  interrupted_via: null,
  interrupted_at: null,
  batch_id: null,
  first_at: '2026-11-17T00:00:00.000Z',
  last_at: '2026-11-17T00:00:00.000Z',
  read_at: null,
  dismissed_at: null,
  ...over,
});

test('N2 check 12d: a window toasts only rows that arrived since it became visible, once', async () => {
  const r = (await loadWeb('notification-rules.ts')) as Rules;
  const at = (iso: string) => ({ first_at: iso, last_at: iso });
  const pending = [
    row('a', at('2026-11-17T00:00:00.000Z')), // arrived before the window became visible
    row('b', at('2026-11-17T00:00:10.000Z')),
    row('c', {
      ...at('2026-11-17T00:00:10.000Z'),
      mode: 'toast_only',
      severity: 'info',
    }),
    row('d', { ...at('2026-11-17T00:00:10.000Z'), mode: 'inbox' }),
    row('e', at('2026-11-17T00:00:05.000Z')), // arrived just as it showed (review L-4)
  ];
  const since = Date.parse('2026-11-17T00:00:05.000Z');
  // "a" is older than the cutoff, "b" was already tried here, "d" is inbox only.
  assert.deepEqual(
    r.toastCandidates(pending, since, new Set(['b'])).map((n) => n.id),
    ['c', 'e'],
  );
  // The server clock from a Date header: whole seconds, so half a second is added.
  assert.equal(
    r.serverOffsetMs(
      'Tue, 17 Nov 2026 00:00:10 GMT',
      Date.parse('2026-11-17T00:00:00.000Z'),
      Date.parse('2026-11-17T00:00:00.200Z'),
    ),
    10_400,
  );
  assert.equal(r.serverOffsetMs(null, 0, 0), 0);
  // Review N-1: a fifth toast pushes out the oldest that does not need you.
  const needs = row('n1');
  const infos = ['i1', 'i2', 'i3'].map((id) => row(id, { severity: 'info' }));
  let shown = [needs, ...infos];
  shown = r.withToast(shown, row('n2'));
  assert.deepEqual(
    shown.map((n) => n.id),
    ['n1', 'i2', 'i3', 'n2'],
  );
  shown = r.withToast(shown, row('n2'));
  assert.equal(shown.length, 4);
  const all = ['x1', 'x2', 'x3', 'x4'].map((id) => row(id));
  assert.deepEqual(
    r.withToast(all, row('x5')).map((n) => n.id),
    ['x2', 'x3', 'x4', 'x5'],
  );
  assert.equal(r.toastLifetimeMs({ severity: 'needs_you' }), null);
  assert.ok((r.toastLifetimeMs({ severity: 'info' }) ?? 0) > 0);
  assert.equal(r.unreadLabel(0), '');
  assert.equal(r.unreadLabel(7), '7');
  assert.equal(r.unreadLabel(100), '99+');
});

test('N2 review N-2: preferences that route a system row are refused', () => {
  const ok = NotificationPreferencesBodySchema.safeParse({
    ...DEFAULT_NOTIFICATION_PREFERENCES,
    events: { 'build.ready': 'inbox' },
  });
  assert.ok(ok.success);
  for (const key of ['studio.digest', 'studio.test'])
    assert.equal(
      NotificationPreferencesBodySchema.safeParse({
        ...DEFAULT_NOTIFICATION_PREFERENCES,
        events: { [key]: 'inbox' },
      }).success,
      false,
    );
});

test('N2: Settings lists no system rows; a Standard group row keeps Advanced choices elsewhere', async () => {
  const r = (await loadWeb('notification-rules.ts')) as Rules;
  for (const advanced of [false, true]) {
    const keys = r.listedEvents(advanced);
    assert.ok(!keys.includes('studio.digest') && !keys.includes('studio.test'));
  }
  assert.ok(!r.listedEvents(false).includes('studio.maintenance'));
  assert.ok(r.listedEvents(true).includes('studio.maintenance'));
  assert.ok(!r.listedGroups(false).includes('studio'));
  let events: Events = r.setEvent({}, 'approval.asked', 'inbox');
  assert.equal(r.groupChoice(events, 'approvals'), 'inbox');
  events = r.setGroup(events, 'runs', 'inbox');
  assert.equal(r.groupChoice(events, 'runs'), 'inbox');
  assert.equal(events['approval.asked'], 'inbox');
  events = r.setGroup(events, 'runs', 'defaults');
  assert.equal(r.groupChoice(events, 'runs'), 'defaults');
  assert.equal(events['autopilot.needs_you'], undefined);
  // One event changed in Advanced makes the group's row "custom".
  events = r.setEvent(events, 'autopilot.proposal', 'interrupt');
  assert.equal(r.groupChoice(events, 'runs'), 'custom');
  // Choosing an event's default stores no choice at all.
  events = r.setEvent(events, 'autopilot.proposal', 'inbox');
  assert.equal(events['autopilot.proposal'], undefined);
  assert.deepEqual(r.modesOf('build.ready'), [
    'interrupt',
    'toast_only',
    'inbox',
  ]);
  assert.deepEqual(r.modesOf('approval.asked'), ['interrupt', 'inbox']);
  const pages = (await loadWeb('pages.ts')) as Pages;
  assert.equal(
    pages.parseRoute('#/monitor/notifications?q=unread').view,
    'notifications',
  );
  assert.equal(
    pages.parseRoute('#/monitor/notifications?q=unread').q,
    'unread',
  );
  assert.equal(
    pages.parseRoute('#/settings/notifications').view,
    'notifysettings',
  );
});
