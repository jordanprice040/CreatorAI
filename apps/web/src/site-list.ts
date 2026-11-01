// Turns the Settings "Evidence websites" text box into host rules (ADR-0056). No imports, so
// the tests can load it without a browser. The server validates every entry again.

const HOST =
  /^(\*\.)?(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]*[a-z][a-z0-9-]*$/;

/**
 * One website per line (commas and spaces also separate). A pasted address keeps only its
 * host: `https://www.speedrun.com/games` becomes `www.speedrun.com`. Duplicates are dropped.
 * Entries that are not a host name, such as an IP address, are returned as problems.
 */
export function parseSiteList(text: string): {
  hosts: string[];
  invalid: string[];
} {
  const hosts: string[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/[\s,]+/)) {
    const entry = raw.trim();
    if (!entry) continue;
    let host = entry.toLowerCase();
    const scheme = /^[a-z][a-z0-9+.-]*:\/\//.exec(host);
    if (scheme) {
      host = host.slice(scheme[0].length);
      host = host.split(/[/?#]/, 1)[0]!;
      // A pasted address may carry a port or sign-in; only a bare host is accepted.
      if (host.includes('@') || host.includes(':')) {
        invalid.push(entry);
        continue;
      }
    } else if (host.endsWith('/')) host = host.slice(0, -1);
    host = host.replace(/\.$/, '');
    if (host.length > 253 || !HOST.test(host)) {
      invalid.push(entry);
      continue;
    }
    if (!hosts.includes(host)) hosts.push(host);
  }
  return { hosts, invalid };
}

/** What a save would change, in plain words, for the confirmation step. */
export function siteChanges(
  before: { mode: string; hosts: readonly string[] },
  after: { mode: string; hosts: readonly string[] },
): string[] {
  const lines: string[] = [];
  if (before.mode !== after.mode)
    lines.push(
      after.mode === 'any_public'
        ? 'Turn on "Any public website"'
        : 'Go back to only the listed websites',
    );
  const added = after.hosts.filter((h) => !before.hosts.includes(h));
  const removed = before.hosts.filter((h) => !after.hosts.includes(h));
  if (added.length) lines.push(`Add ${added.join(', ')}`);
  if (removed.length) lines.push(`Remove ${removed.join(', ')}`);
  return lines;
}
