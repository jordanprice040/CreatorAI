import { z, id, timestamp, counter } from './primitives.js';
import { TimeZoneSchema } from './catalog.js';

// N1 of the notifications plan (ADR-0116, migration 70): durable, per-person notification
// records. A notification only links to the place to act; it never approves, continues, spends
// or admits anything, and making one calls no model. N1 holds the records, the producers, the
// person-scoped routes and the atomic claim; the bell, toasts and Settings come with N2, and
// Windows notifications with N3.

/** How an event reaches a person: interrupt (toast or Windows), toast only, or the inbox only. */
export const NotificationModeSchema = z.enum([
  'interrupt',
  'toast_only',
  'inbox',
]);
export type NotificationMode = z.infer<typeof NotificationModeSchema>;

export const NotificationSeveritySchema = z.enum([
  'needs_you',
  'warning',
  'info',
]);
export type NotificationSeverity = z.infer<typeof NotificationSeveritySchema>;

export const NotificationGroupSchema = z.enum([
  'runs',
  'approvals',
  'claims',
  'qualification',
  'spending',
  'connections',
  'builds',
  'studio',
]);
export type NotificationGroup = z.infer<typeof NotificationGroupSchema>;

export const NotificationEventKeySchema = z.enum([
  'autopilot.needs_you',
  'autopilot.waiting',
  'autopilot.limit',
  'autopilot.failed',
  'autopilot.proposal',
  'autopilot.cancelled',
  'claims.held',
  'approval.asked',
  'qualification.passed',
  'qualification.queue_done',
  'qualification.failures',
  'spend.50',
  'spend.80',
  'spend.95',
  'spend.100',
  'spend.refused',
  'spend.waiting',
  'connection.blocked',
  'connection.attention',
  'build.ready',
  'workflow.finished',
  'studio.maintenance',
  // N2 (ADR-0130): system rows a person cannot route elsewhere; Settings does not list them.
  'studio.digest',
  'studio.test',
]);
export type NotificationEventKey = z.infer<typeof NotificationEventKeySchema>;

export interface NotificationEventInfo {
  group: NotificationGroup;
  severity: NotificationSeverity;
  /** The plan's default (§3); a person can change any row in Settings. */
  default: NotificationMode;
  label: string;
  /** Shown in Settings only in the Advanced view. */
  advanced?: true;
  /**
   * N2 (ADR-0130): made by the studio itself (the quiet-hours digest, a test you asked for).
   * Not listed in Settings, and a saved choice never changes how it is shown.
   */
  system?: true;
}

/** The event catalog: group, severity, default and the Settings label of every event. */
export const NOTIFICATION_EVENTS: Record<
  NotificationEventKey,
  NotificationEventInfo
> = {
  'autopilot.needs_you': {
    group: 'runs',
    severity: 'needs_you',
    default: 'interrupt',
    label: 'Run blocked, needs you',
  },
  'autopilot.waiting': {
    group: 'runs',
    severity: 'info',
    default: 'inbox',
    label: 'Your run is waiting for the workspace owner',
  },
  'autopilot.limit': {
    group: 'runs',
    severity: 'warning',
    default: 'interrupt',
    label: 'Run stopped on a limit',
  },
  'autopilot.failed': {
    group: 'runs',
    severity: 'warning',
    default: 'interrupt',
    label: 'Run step failed',
  },
  'autopilot.proposal': {
    group: 'runs',
    severity: 'info',
    default: 'inbox',
    label: 'Proposal ready',
  },
  'autopilot.cancelled': {
    group: 'runs',
    severity: 'info',
    default: 'inbox',
    label: 'Run cancelled by someone else',
  },
  'claims.held': {
    group: 'claims',
    severity: 'needs_you',
    default: 'interrupt',
    label: 'Web claims held for you',
  },
  'approval.asked': {
    group: 'approvals',
    severity: 'needs_you',
    default: 'interrupt',
    label: 'Approval waiting',
  },
  'qualification.passed': {
    group: 'qualification',
    severity: 'info',
    default: 'inbox',
    label: 'Qualification passed',
  },
  'qualification.queue_done': {
    group: 'qualification',
    severity: 'info',
    default: 'inbox',
    label: 'Qualification queue completed',
  },
  'qualification.failures': {
    group: 'qualification',
    severity: 'warning',
    default: 'interrupt',
    label: 'Qualification failures need attention',
  },
  'spend.50': {
    group: 'spending',
    severity: 'info',
    default: 'inbox',
    label: 'Spend at 50%',
  },
  'spend.80': {
    group: 'spending',
    severity: 'warning',
    default: 'interrupt',
    label: 'Spend at 80%',
  },
  'spend.95': {
    group: 'spending',
    severity: 'warning',
    default: 'interrupt',
    label: 'Spend at 95%',
  },
  'spend.100': {
    group: 'spending',
    severity: 'warning',
    default: 'interrupt',
    label: 'Spend at 100%',
  },
  'spend.refused': {
    group: 'spending',
    severity: 'needs_you',
    default: 'interrupt',
    label: 'Work stopped: a paid dispatch was refused',
  },
  'spend.waiting': {
    group: 'spending',
    severity: 'info',
    default: 'inbox',
    label: 'Your run is waiting on the spending limit',
  },
  'connection.blocked': {
    group: 'connections',
    severity: 'warning',
    default: 'interrupt',
    label: 'Connection stopped work',
  },
  'connection.attention': {
    group: 'connections',
    severity: 'info',
    default: 'inbox',
    label: 'Connection needs attention',
  },
  'build.ready': {
    group: 'builds',
    severity: 'info',
    default: 'toast_only',
    label: 'Build finished / preview ready',
  },
  'workflow.finished': {
    group: 'runs',
    severity: 'info',
    default: 'inbox',
    label: 'Workflow finished',
  },
  'studio.maintenance': {
    group: 'studio',
    severity: 'info',
    default: 'inbox',
    label: 'Background job failing',
    advanced: true,
  },
  'studio.digest': {
    group: 'studio',
    severity: 'needs_you',
    default: 'interrupt',
    label: 'Still needs you after quiet hours',
    system: true,
  },
  'studio.test': {
    group: 'studio',
    severity: 'info',
    default: 'interrupt',
    label: 'Test notification',
    system: true,
  },
};

/** "needs you" items and spend refusals: what the quiet-hours urgent override lets through (N2). */
export const URGENT_NOTIFICATION_EVENTS: readonly NotificationEventKey[] = [
  'autopilot.needs_you',
  'claims.held',
  'approval.asked',
  'spend.refused',
];

const clock = z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/);

export const NotificationPreferencesBodySchema = z.strictObject({
  /** Only rows the person changed; any other event uses its default. */
  events: z.partialRecord(NotificationEventKeySchema, NotificationModeSchema),
  quiet_hours: z.strictObject({
    enabled: z.boolean(),
    start: clock,
    end: clock,
    tz: TimeZoneSchema,
    /** 0 = Sunday … 6 = Saturday; the day the window starts on. */
    days: z.array(z.number().int().min(0).max(6)).max(7),
    urgent_override: z.boolean(),
  }),
  muted_workspaces: z.array(id).max(200),
  windows_hide_details: z.boolean(),
});
export type NotificationPreferencesBody = z.infer<
  typeof NotificationPreferencesBodySchema
>;

export const DEFAULT_NOTIFICATION_PREFERENCES: NotificationPreferencesBody = {
  events: {},
  quiet_hours: {
    enabled: false,
    start: '22:00',
    end: '07:00',
    tz: 'UTC',
    days: [0, 1, 2, 3, 4, 5, 6],
    urgent_override: false,
  },
  muted_workspaces: [],
  windows_hide_details: false,
};

export const NotificationPreferencesSchema = z.strictObject({
  /** 0 when the person has never saved; the defaults then apply. */
  version: z.number().int().min(0),
  body: NotificationPreferencesBodySchema,
  updated_at: timestamp.nullable(),
});
export type NotificationPreferences = z.infer<
  typeof NotificationPreferencesSchema
>;

export const SetNotificationPreferencesRequestSchema = z.strictObject({
  expected_version: z.number().int().min(0),
  body: NotificationPreferencesBodySchema,
});

/** The mode an event uses for a person: their own choice, else the catalog default. */
export function notificationMode(
  body: Pick<NotificationPreferencesBody, 'events'>,
  key: NotificationEventKey,
): NotificationMode {
  const info = NOTIFICATION_EVENTS[key];
  if (info.system) return info.default;
  return body.events[key] ?? info.default;
}

/** "HH:MM" as minutes after midnight. */
const minutesOf = (hhmm: string) =>
  Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** The weekday (0 = Sunday) and minutes after midnight of `at` in an IANA time zone. */
export function localClock(
  at: Date,
  tz: string,
): { day: number; minutes: number } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at);
  const part = (t: string) => parts.find((p) => p.type === t)?.value ?? '';
  return {
    day: Math.max(0, WEEKDAYS.indexOf(part('weekday'))),
    minutes: (Number(part('hour')) % 24) * 60 + Number(part('minute')),
  };
}

/**
 * N2 (ADR-0130): whether quiet hours hold interruptions at `at`. The window starts on each
 * listed day and may cross midnight (22:00 to 07:00 listed for Friday covers Saturday
 * morning). A window that starts and ends at the same minute is empty.
 */
export function quietHoursActive(
  q: NotificationPreferencesBody['quiet_hours'],
  at: Date,
): boolean {
  if (!q.enabled || q.days.length === 0) return false;
  const start = minutesOf(q.start);
  const end = minutesOf(q.end);
  if (start === end) return false;
  const { day, minutes } = localClock(at, q.tz);
  if (start < end)
    return q.days.includes(day) && minutes >= start && minutes < end;
  if (minutes >= start) return q.days.includes(day);
  return minutes < end && q.days.includes((day + 6) % 7);
}

/**
 * N2 (ADR-0130): what a new notification's interruption becomes for one person. A workspace
 * mute beats everything; inside quiet hours an interruption is held for the digest unless the
 * urgent override lets an urgent event through.
 */
export function interruptStateFor(
  prefs: NotificationPreferencesBody,
  n: {
    eventKey: NotificationEventKey;
    workspaceId: string | null;
    batched: boolean;
    interrupt: boolean;
  },
  at: Date,
): 'pending' | 'held_quiet' | 'none' {
  const info = NOTIFICATION_EVENTS[n.eventKey];
  if (notificationMode(prefs, n.eventKey) === 'inbox') return 'none';
  if (n.batched || !n.interrupt) return 'none';
  if (info.system) return 'pending';
  if (n.workspaceId !== null && prefs.muted_workspaces.includes(n.workspaceId))
    return 'none';
  if (!quietHoursActive(prefs.quiet_hours, at)) return 'pending';
  if (
    prefs.quiet_hours.urgent_override &&
    URGENT_NOTIFICATION_EVENTS.includes(n.eventKey)
  )
    return 'pending';
  return 'held_quiet';
}

/**
 * In-app routes only (`#/<page>/<tab>?ws=…&id=…`): a notification never carries an external
 * URL, a script or anything a browser would leave the studio for.
 */
export const NOTIFICATION_LINK_PATTERN =
  /^#\/[a-z]+(?:\/[a-z]+)?(?:\?(?:[a-z]+=[A-Za-z0-9:._-]{1,80})(?:&[a-z]+=[A-Za-z0-9:._-]{1,80}){0,3})?$/;
export const NotificationLinkSchema = z
  .string()
  .max(300)
  .regex(NOTIFICATION_LINK_PATTERN);

export const NotificationInterruptStateSchema = z.enum([
  'pending',
  'claimed',
  'none',
  'held_quiet',
  'expired',
]);
export const NotificationViaSchema = z.enum(['toast', 'windows', 'digest']);

export const NotificationSchema = z.strictObject({
  id,
  workspace_id: id.nullable(),
  event_key: NotificationEventKeySchema,
  group: NotificationGroupSchema,
  severity: NotificationSeveritySchema,
  mode: NotificationModeSchema,
  title: z.string().min(1).max(140),
  body: z.string().max(400),
  link: NotificationLinkSchema,
  subject_kind: z.string().max(40),
  subject_id: z.string().max(80),
  occurrences: counter.min(1),
  interrupt_state: NotificationInterruptStateSchema,
  interrupted_via: NotificationViaSchema.nullable(),
  interrupted_at: timestamp.nullable(),
  batch_id: id.nullable(),
  first_at: timestamp,
  last_at: timestamp,
  read_at: timestamp.nullable(),
  dismissed_at: timestamp.nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationPageSchema = z.strictObject({
  items: z.array(NotificationSchema).max(100),
  /** Pass back as `cursor` for the next, older page; null at the end. */
  next_cursor: z.string().max(200).nullable(),
});
export type NotificationPage = z.infer<typeof NotificationPageSchema>;

/** The bell: the newest items, "needs you" first, and the unread count. */
export const RecentNotificationsSchema = z.strictObject({
  unread: counter,
  items: z.array(NotificationSchema).max(20),
});
export type RecentNotifications = z.infer<typeof RecentNotificationsSchema>;

export const ClaimNotificationRequestSchema = z.strictObject({
  via: z.enum(['toast', 'windows']),
});

/** N2 (ADR-0130): the result of "Send test" in Settings › Notifications. */
export const NotificationTestSchema = z.strictObject({ id });

export const NotificationClaimSchema = z.strictObject({
  id,
  interrupt_state: z.literal('claimed'),
  interrupted_via: z.enum(['toast', 'windows']),
  interrupted_at: timestamp,
});
export type NotificationClaim = z.infer<typeof NotificationClaimSchema>;
