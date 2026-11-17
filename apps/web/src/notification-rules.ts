import {
  NOTIFICATION_EVENTS,
  type Notification,
  type NotificationEventKey,
  type NotificationGroup,
  type NotificationMode,
  type NotificationPreferencesBody,
} from '@creator/contracts';

// ADR-0130 (N2): the bell, toasts and Settings › Notifications, as pure rules so they load in
// tests without a browser.

/** The bell's count: "99+" past 99, nothing at 0. */
export function unreadLabel(n: number): string {
  return n <= 0 ? '' : n > 99 ? '99+' : String(n);
}

/**
 * Which pending rows this window may try to show as a toast: only rows that arrived (by the
 * server's clock) at or after the window last became visible. Anything older arrived while
 * nobody was looking: it stays in the inbox and is never shown late (plan §4, "no catch-up
 * toast"; review L-4 of #235). `tried` holds the ids this window already claimed or lost.
 */
export function toastCandidates(
  pending: readonly Notification[],
  visibleSince: number,
  tried: ReadonlySet<string>,
): Notification[] {
  return pending.filter(
    (n) =>
      n.interrupt_state === 'pending' &&
      n.mode !== 'inbox' &&
      Date.parse(n.first_at) >= visibleSince &&
      !tried.has(n.id),
  );
}

/**
 * The server's clock minus this browser's, from a response's `Date` header (whole seconds).
 * The header is rounded down, so the offset can be up to a second low; `toastCandidates`
 * callers subtract a second more so a row that arrives just as the window shows still counts.
 */
export function serverOffsetMs(
  dateHeader: string | null,
  sentAt: number,
  receivedAt: number,
): number {
  const server = dateHeader ? Date.parse(dateHeader) : NaN;
  if (!Number.isFinite(server)) return 0;
  return server + 500 - (sentAt + receivedAt) / 2;
}

/**
 * Adds a toast that was just won. At most `max` are shown: "needs you" toasts stay until
 * closed, so the oldest other toast leaves first (review N-1); only when every toast needs
 * you does the oldest of them leave.
 */
export function withToast(
  toasts: readonly Notification[],
  n: Notification,
  max = 4,
): Notification[] {
  if (toasts.some((x) => x.id === n.id)) return [...toasts];
  const next = [...toasts, n];
  while (next.length > max) {
    const drop = next.findIndex((x) => x.severity !== 'needs_you');
    next.splice(drop === -1 ? 0 : drop, 1);
  }
  return next;
}

/** How long a toast stays: "needs you" stays until closed, the rest leave after a while. */
export function toastLifetimeMs(
  n: Pick<Notification, 'severity'>,
): number | null {
  return n.severity === 'needs_you'
    ? null
    : n.severity === 'warning'
      ? 15_000
      : 8_000;
}

/** The events Settings lists: never the studio's own system rows. */
export function listedEvents(advanced: boolean): NotificationEventKey[] {
  return (Object.keys(NOTIFICATION_EVENTS) as NotificationEventKey[]).filter(
    (k) =>
      !NOTIFICATION_EVENTS[k].system &&
      (advanced || !NOTIFICATION_EVENTS[k].advanced),
  );
}

export const GROUP_LABEL: Record<NotificationGroup, string> = {
  runs: 'Runs and autopilots',
  approvals: 'Approvals',
  claims: 'Held web claims',
  qualification: 'Qualifications',
  spending: 'Spending',
  connections: 'Connections',
  builds: 'Builds',
  studio: 'Studio',
};

export function eventsOf(group: NotificationGroup, advanced: boolean) {
  return listedEvents(advanced).filter(
    (k) => NOTIFICATION_EVENTS[k].group === group,
  );
}

/** The groups Settings lists in Standard view, in the catalog's order. */
export function listedGroups(advanced: boolean): NotificationGroup[] {
  const out: NotificationGroup[] = [];
  for (const k of listedEvents(advanced)) {
    const g = NOTIFICATION_EVENTS[k].group;
    if (!out.includes(g)) out.push(g);
  }
  return out;
}

/**
 * A group's row in Standard view. "Defaults" means each event in it does what the catalog
 * says (some interrupt, some only reach the inbox); "Inbox only" means none interrupt; any
 * other mix was set in Advanced and reads "Custom".
 */
export type GroupChoice = 'defaults' | 'inbox' | 'custom';

export function groupChoice(
  events: NotificationPreferencesBody['events'],
  group: NotificationGroup,
): GroupChoice {
  const keys = eventsOf(group, true);
  if (keys.every((k) => events[k] === undefined)) return 'defaults';
  if (keys.every((k) => events[k] === 'inbox')) return 'inbox';
  if (
    keys.every((k) => (events[k] ?? NOTIFICATION_EVENTS[k].default) === 'inbox')
  )
    return 'inbox';
  if (
    keys.every(
      (k) =>
        (events[k] ?? NOTIFICATION_EVENTS[k].default) ===
        NOTIFICATION_EVENTS[k].default,
    )
  )
    return 'defaults';
  return 'custom';
}

/** Sets a whole group from Standard view; Advanced rows of other groups are kept. */
export function setGroup(
  events: NotificationPreferencesBody['events'],
  group: NotificationGroup,
  choice: Exclude<GroupChoice, 'custom'>,
): NotificationPreferencesBody['events'] {
  const next = { ...events };
  for (const k of eventsOf(group, true)) {
    if (choice === 'defaults') delete next[k];
    else next[k] = 'inbox';
  }
  return next;
}

/** Sets one event from Advanced view; its catalog default is stored as no choice at all. */
export function setEvent(
  events: NotificationPreferencesBody['events'],
  key: NotificationEventKey,
  mode: NotificationMode,
): NotificationPreferencesBody['events'] {
  const next = { ...events };
  if (mode === NOTIFICATION_EVENTS[key].default) delete next[key];
  else next[key] = mode;
  return next;
}

/** The modes an event offers: "Toast only" only where it is the default (Build ready). */
export function modesOf(key: NotificationEventKey): NotificationMode[] {
  return NOTIFICATION_EVENTS[key].default === 'toast_only'
    ? ['interrupt', 'toast_only', 'inbox']
    : ['interrupt', 'inbox'];
}

export const MODE_LABEL: Record<NotificationMode, string> = {
  interrupt: 'Interrupt',
  toast_only: 'Toast only',
  inbox: 'Inbox only',
};

/** "Run blocked, needs you" and so on: what in a group interrupts by default, for Standard. */
export function groupSummary(group: NotificationGroup): string {
  const keys = eventsOf(group, false);
  const by = (m: NotificationMode) =>
    keys.filter((k) => NOTIFICATION_EVENTS[k].default === m);
  const loud = by('interrupt');
  const toast = by('toast_only');
  const names = (ks: NotificationEventKey[]) =>
    ks.map((k) => NOTIFICATION_EVENTS[k].label).join('; ');
  if (loud.length === keys.length) return 'All interrupt by default.';
  if (toast.length === keys.length)
    return `Toast only by default: ${names(toast)} (never a Windows notification).`;
  if (!loud.length && !toast.length) return 'Inbox only by default.';
  const parts = [
    loud.length ? `Interrupts by default: ${names(loud)}.` : '',
    toast.length ? `Toast only by default: ${names(toast)}.` : '',
  ].filter(Boolean);
  return `${parts.join(' ')} The rest go to the inbox.`;
}

/** Every IANA time zone this browser knows, for the quiet-hours field's suggestions. */
export function timeZones(): string[] {
  try {
    const list = (
      Intl as { supportedValuesOf?: (k: string) => string[] }
    ).supportedValuesOf?.('timeZone');
    return list && list.length ? list : ['UTC'];
  } catch {
    return ['UTC'];
  }
}

/** The browser's own IANA time zone, for quiet hours set up the first time. */
export function browserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * N3 (ADR-0131): the Windows line in Settings › Notifications, from the installed app's last
 * poll. Null means the status could not be read.
 */
export function windowsStatusText(
  status: {
    state: 'on' | 'off_in_windows' | 'unavailable' | 'not_running';
  } | null,
): string {
  if (!status) return 'Status unknown right now.';
  if (status.state === 'on')
    return 'On in the Creator Agent app on this computer.';
  if (status.state === 'off_in_windows')
    return 'The app is running, but Windows does not allow its notifications. Turn them on for Creator Agent in Windows Settings › System › Notifications. Until then, alerts wait in the bell.';
  if (status.state === 'unavailable')
    return 'The app is running, but this copy cannot show Windows notifications (for example a developer build). Alerts wait in the bell.';
  return 'Open the installed Creator Agent app and sign in to use Windows notifications. A browser tab never shows them.';
}
