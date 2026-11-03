// Turns the Settings "Evidence websites" text box into host rules (ADR-0056). No imports, so
// the tests can load it without a browser. The server validates every entry again.

/**
 * PR #103 review L3: `*.` under a shared public suffix (`*.co.uk`, `*.github.io`) is close to
 * "any public website" without its warnings, so it is refused. Not a full public suffix list:
 * a two-label parent whose first label is a usual registry label under a two-letter country
 * code, plus common shared hosting domains. Mirrors packages/contracts research.ts (the server checks again).
 */
const SHARED_PARENT_LABELS = new Set([
  'ac',
  'co',
  'com',
  'edu',
  'go',
  'gov',
  'govt',
  'ltd',
  'me',
  'ne',
  'net',
  'nhs',
  'or',
  'org',
  'plc',
  'sch',
]);
const SHARED_HOSTING = new Set([
  'appspot.com',
  'azurewebsites.net',
  'blogspot.com',
  'cloudfront.net',
  'firebaseapp.com',
  'github.io',
  'gitlab.io',
  'herokuapp.com',
  'netlify.app',
  'pages.dev',
  'substack.com',
  'vercel.app',
  'web.app',
  'wordpress.com',
  'workers.dev',
]);
export function sharedSuffixWildcard(host: string): boolean {
  if (!host.startsWith('*.')) return false;
  const parent = host.slice(2);
  const labels = parent.split('.');
  return (
    SHARED_HOSTING.has(parent) ||
    (labels.length === 2 &&
      labels[1]!.length === 2 &&
      SHARED_PARENT_LABELS.has(labels[0]!))
  );
}

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
    if (host.length > 253 || !HOST.test(host) || sharedSuffixWildcard(host)) {
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
