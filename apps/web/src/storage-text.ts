// ADR-0121 (F10): words and numbers for the Storage page. No imports, so tests load it directly.

/** Bytes in the units a person reads: 0 bytes, 812 bytes, 4.2 KB, 18 MB, 1.3 GB. */
export function sizeText(n: number | null): string {
  if (n === null) return 'not measured';
  if (n < 1024) return `${n} bytes`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/** The confirming button's words, naming how many and how much. */
export function removeLabel(count: number, bytes: number): string {
  return `Remove ${count} build workspace${count === 1 ? '' : 's'} (${sizeText(bytes)})`;
}

/** One sentence on a finished cleanup. */
export function resultText(r: {
  removed: number;
  failed: number;
  bytes_freed: number;
  packages_changed: number;
}): string {
  const parts = [
    `Removed ${r.removed} build workspace${r.removed === 1 ? '' : 's'}, freeing ${sizeText(r.bytes_freed)}.`,
  ];
  if (r.failed)
    parts.push(
      `${r.failed} ${r.failed === 1 ? 'was' : 'were'} left alone; the reasons are below.`,
    );
  parts.push(
    r.packages_changed
      ? `${r.packages_changed} verified package${r.packages_changed === 1 ? ' no longer matches its' : 's no longer match their'} recorded hashes. Look at ${r.packages_changed === 1 ? 'it' : 'them'} before building or sharing.`
      : 'Every verified package still matches its recorded hashes.',
  );
  return parts.join(' ');
}
