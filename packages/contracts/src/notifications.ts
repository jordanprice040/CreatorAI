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
  return body.events[key] ?? NOTIFICATION_EVENTS[key].default;
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

export const NotificationClaimSchema = z.strictObject({
  id,
  interrupt_state: z.literal('claimed'),
  interrupted_via: z.enum(['toast', 'windows']),
  interrupted_at: timestamp,
});
export type NotificationClaim = z.infer<typeof NotificationClaimSchema>;
