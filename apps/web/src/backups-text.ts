import type { BackupEntry, BackupRun, BackupsView } from '@creator/contracts';

// ADR-0123 (F1): the words Settings › Backups uses, kept apart from the page so they can be
// checked without a browser.

export const KIND_LABEL: Record<BackupEntry['kind'], string> = {
  manual: 'Made by you',
  daily: 'Daily',
  pre_upgrade: 'Before an upgrade',
  adopt: 'When this studio was set up from another',
  other: 'Other',
};

/** Bytes in the units Windows Explorer shows (1 KB = 1024 bytes), one decimal from MB up. */
export function sizeText(bytes: number): string {
  if (bytes < 1024) return `${bytes} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let n = bytes / 1024;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

const TRIGGER: Record<BackupRun['trigger'], string> = {
  manual: 'Backup',
  daily: 'Daily backup',
  check: 'Check',
  restore: 'Restore',
};

/** One line for a recorded run: what it was, on which backup, and how it ended. */
export function runLine(r: BackupRun): string {
  const what = `${TRIGGER[r.trigger]}${r.backup_name ? ` of ${r.backup_name}` : ''}`;
  if (r.status === 'running')
    return r.trigger === 'manual' || r.trigger === 'daily'
      ? `Backing up to ${r.backup_name ?? 'a new folder'}…`
      : r.trigger === 'check'
        ? `Checking ${r.backup_name ?? 'a backup'}…`
        : `Restoring ${r.backup_name ?? 'a backup'}…`;
  if (r.status === 'interrupted') return `${what}: interrupted`;
  if (r.status === 'failed') return `${what}: failed`;
  const res = r.result ?? {};
  if (r.trigger === 'check')
    return `${what}: every hash matched (${num(res.files)} file(s))`;
  if (r.trigger === 'restore')
    return `${what}: restored into database ${str(res.database_name)} and folder ${str(res.products_root)}, verified (${num(res.workspaces)} workspace(s), ${num(res.artifacts_checked)} package(s) checked)`;
  const removed = Array.isArray(res.removed) ? res.removed.length : 0;
  return `${what}: done${typeof res.bytes === 'number' ? `, ${sizeText(res.bytes)}` : ''}${removed ? `; ${removed} older daily backup(s) removed` : ''}`;
}
const num = (v: unknown) => (typeof v === 'number' ? v : 0);
const str = (v: unknown) => (typeof v === 'string' ? v : '?');

/** What the daily line says, from the settings and the last attempt's UTC day. */
export function dailyText(v: BackupsView, today: string): string {
  if (!v.settings.daily_enabled)
    return 'Off. Backups are made only when you press Back up now.';
  const keep = `keeps the newest ${v.settings.keep_daily}`;
  return v.last_daily_day === today
    ? `On while the app runs; today's has been taken. It ${keep}.`
    : `On while the app runs; today's is taken within about 10 minutes of the app running. It ${keep}.`;
}

/** A restore target's database name, suggested from the backup's name. */
export function suggestDatabase(name: string): string {
  const base = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
  return `restored_${base}`.slice(0, 63).replace(/_+$/, '');
}
