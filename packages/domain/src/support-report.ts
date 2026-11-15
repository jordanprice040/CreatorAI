// ADR-0118 (F5): a support report the owner reads and copies by hand. It is built only from
// recorded state, with no model call, and every line passes through `redactSupportText` before
// anyone sees it. Nothing here sends the report anywhere; copying is the person's own action.

export type SupportFacts = {
  generated_at: string;
  app: {
    version: string;
    build_commit: string | null;
    schema_version: number | null;
    mode: string;
    environment: string;
    node: string;
    os: { platform: string; release: string; arch: string };
  };
  readiness: {
    ready: boolean;
    checks: { name: string; ok: boolean; detail: string }[];
  };
  maintenance: { job: string; error_code: string | null }[];
  workers: {
    leases_active: number;
    leases_expired: number;
    local_jobs_open: number;
    outbox_pending: number;
    local: {
      id: string;
      label: string;
      availability: string;
      last_seen_at: string | null;
    }[];
  } | null;
  connections: SupportConnection[] | null;
  failures: SupportFailure[] | null;
  /** Sections that could not be read, with a short reason (never an error dump). */
  unavailable: string[];
};
export type SupportConnection = {
  kind: string;
  id: string;
  workspace_id: string | null;
  fixture: boolean | null;
  label: string;
  state: string;
  reason: string | null;
  problems_24h: number;
};
export type SupportFailure = {
  at: string;
  source: string;
  id: string;
  workspace_id: string | null;
  fixture: boolean | null;
  state: string;
  detail: string | null;
};

export const SUPPORT_FAILURE_LIMIT = 20;
const DETAIL_MAX = 300;
const LABEL_MAX = 80;
const HIDDEN = '[hidden]';

/**
 * Names that identify the person, their machine or their accounts; replaced wherever they
 * appear. `accountNames` are GitHub owner logins from the studio's own connections.
 */
export type SupportIdentity = {
  userNames: string[];
  hostNames: string[];
  accountNames?: string[];
};

type Rule = { re: RegExp; to: (...m: string[]) => string };
const fixed = (to: string) => () => to;

// A name is secret-looking when one of its parts (split on _ . - and camelCase) is one of
// these, or the joined name contains one of the compounds. Whole parts only, so "tokens",
// "Design" and "assignment" stay readable (review 1 L-7).
const SECRET_PARTS = new Set([
  'token',
  'secret',
  'password',
  'passwd',
  'passphrase',
  'pgpassword',
  'pwd',
  'pw',
  'pass',
  'apikey',
  'key',
  'cookie',
  'authorization',
  'auth',
  'credential',
  'credentials',
  'signature',
  'sig',
  'sid',
  'sessionid',
  'pin',
  'otp',
]);
const SECRET_COMPOUNDS =
  /(sessionid|sessiontoken|apikey|accesskey|privatekey|clientsecret|refreshtoken|accesstoken|idtoken|otpcode|authcode|mfacode|verificationcode|securitycode)/;
// Names whose value is hidden even when it is only a number: passwords, PINs and one-time
// codes are often numeric (review 2 R2-L1). Other secret names keep counts readable.
const NUMERIC_SECRET_PARTS = new Set([
  'password',
  'passwd',
  'passphrase',
  'pgpassword',
  'pwd',
  'pw',
  'pass',
  'secret',
  'pin',
  'otp',
  'code',
]);
const nameParts = (name: string) =>
  name
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/[\s_.-]+/)
    .filter(Boolean);
export function isSecretName(name: string): boolean {
  const parts = nameParts(name);
  return (
    parts.some((p) => SECRET_PARTS.has(p)) ||
    SECRET_COMPOUNDS.test(parts.join(''))
  );
}
/** Whether a lone number after this (secret) name is still hidden. */
export function hidesNumbers(name: string): boolean {
  const parts = nameParts(name);
  return (
    parts.some((p) => NUMERIC_SECRET_PARTS.has(p)) ||
    SECRET_COMPOUNDS.test(parts.join(''))
  );
}
const hideValue = (name: string, value: string) =>
  isSecretName(name) && (!/^\d+$/.test(value) || hidesNumbers(name));

// Strong words that may be followed by a value with only a space or "is" in between.
const STRONG = 'password|passwd|passphrase|pgpassword|secret|token|pwd';
// After a password word, any single word of 6 or more characters is taken as the password
// unless it is one of these (review 2 R2-L2).
const PASSWORD_WORD = /^(password|passwd|passphrase|pgpassword)$/i;
const NOT_A_PASSWORD = new Set([
  'incorrect',
  'invalid',
  'required',
  'expired',
  'missing',
  'wrong',
  'empty',
  'changed',
  'reset',
  'rejected',
  'mismatch',
  'policy',
]);
// A value after a strong word counts only when it looks like a secret, so "token limit
// reached" stays readable while "password is hunter2" does not.
const SECRETISH = /[0-9_!@#$%^&*+/=~-]/;

// Order matters: whole blocks and header lines first, then named values, then shapes that
// are secrets on their own, then accounts, emails and personal folders.
const RULES: Rule[] = [
  // A private key: up to its END line, or to the end of the line when that was cut off
  // (review 1 L-5: never to the end of the whole report).
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----(?:[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----|[^\r\n]*)/g,
    to: fixed(`${HIDDEN} private key`),
  },
  // Cookie and authorization headers: the rest of the line, whatever the scheme (M-2).
  {
    re: /\b(set-cookie|cookie|proxy-authorization|authorization|x-api-key|api-key)(["']?\s*[:=]\s*)[^\r\n]+/gi,
    to: (_m, name, sep) => `${name}${sep}${HIDDEN}`,
  },
  {
    re: /\b(bearer|basic|digest|token)(\s+)([A-Za-z0-9._~+/=-]{8,})/gi,
    to: (m, word, sp, value) =>
      SECRETISH.test(value) ? `${word}${sp}${HIDDEN}` : m,
  },
  // Credentials inside a URL: scheme://user:password@host, the password may hold "/" (L-3).
  {
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s@/?#:]*:[^\s@]+@/gi,
    to: (_m, scheme) => `${scheme}${HIDDEN}@`,
  },
  // Query parameters with short secret names (L-2).
  {
    re: /([?&;](?:key|pass|pw|pwd|auth|code|state|sig|token|secret|password|apikey|api_key|access_token|refresh_token|id_token|client_secret)=)[^&\s#"']+/gi,
    to: (_m, name) => `${name}${HIDDEN}`,
  },
  // "name": "quoted value" hides everything up to the closing quote (M-2).
  {
    re: /(["']?)([A-Za-z][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)(["'])((?:\\.|(?!\4)[^\\\r\n])*)\4/g,
    to: (m, q, name, sep, quote, value) =>
      value !== '' && hideValue(name, value)
        ? `${q}${name}${q}${sep}${quote}${HIDDEN}${quote}`
        : m,
  },
  // "password is hunter2", "PGPASSWORD hunter2" (M-2).
  {
    re: new RegExp(
      `\\b(${STRONG})(\\s+(?:is\\s+|was\\s+)?)(?!\\[hidden\\])([^\\s"',;()]{4,})`,
      'gi',
    ),
    to: (m, word, sp, value) =>
      SECRETISH.test(value) ||
      (PASSWORD_WORD.test(word) &&
        value.length >= 6 &&
        !NOT_A_PASSWORD.has(value.toLowerCase()))
        ? `${word}${sp}${HIDDEN}`
        : m,
  },
  { re: /\bglpat-[A-Za-z0-9_-]{20,}/g, to: fixed(HIDDEN) },
  {
    re: /\b(?:sk|rk|pk)[-_](?:live|test|proj|ant|svcacct)?[-_]?[A-Za-z0-9_-]{16,}/g,
    to: fixed(HIDDEN),
  },
  {
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    to: fixed(HIDDEN),
  },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, to: fixed(HIDDEN) },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, to: fixed(HIDDEN) },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/g, to: fixed(HIDDEN) },
  { re: /\bwhsec_[A-Za-z0-9+/=_-]{10,}/g, to: fixed(HIDDEN) },
  {
    re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    to: fixed(HIDDEN),
  },
  // GitHub identity refusals name both accounts: "User octo-work (5531)" (M-1). Only with
  // the numeric id, so "User rejected the request" stays readable (review 2 R2-L3).
  {
    re: /\b(?:User|Organization|Bot)\s+[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})\s*\(\d+\)/g,
    to: fixed('[account]'),
  },
  // Emails, also percent-encoded (L-4).
  {
    re: /[A-Za-z0-9._+-]+(?:%[0-9A-Fa-f]{2}[A-Za-z0-9._+-]*)*(?:@|%40)[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    to: fixed('[email]'),
  },
  // Personal folders. Windows profile names may hold spaces (M-3) but none of
  // " / \ [ ] : ; | = , + * ? < >, so the name stops there (review 2 R2-L6).
  {
    re: /\b([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/"'<>|:;=,+*?[\]\r\n]+/gi,
    to: (_m, root) => `${root}[user]`,
  },
  {
    re: /(?<![\w.-])(\/(?:var\/home|home|Users)\/)[^/\s"'<>()[\],;]+/g,
    to: (_m, root) => `${root}[user]`,
  },
  {
    re: /(%USERPROFILE%|\$HOME|~)(?=[\\/])/g,
    to: fixed('[home]'),
  },
];

// Long opaque strings. Readable when every part between - / _ . is a word, a number, hex
// (commits, hashes, uuids) or short: ids like task-<uuid>, model ids and branch names stay.
// Shorter random runs are judged whole by how often the character class changes, which is
// high for random keys and low for names like Migration2Store (review 2 R2-L4).
const OPAQUE = /[A-Za-z0-9+/_.=-]{20,}/g;
const classOf = (c: string) =>
  /[0-9]/.test(c) ? 'd' : /[A-Z]/.test(c) ? 'u' : /[a-z]/.test(c) ? 'l' : 's';
function looksRandom(run: string, min: number): boolean {
  const alnum = run.replace(/[^A-Za-z0-9]/g, '');
  if (alnum.length < min) return false;
  // Keys mix upper and lower case. Hex (commits, hashes, uuids), kebab-case and
  // SCREAMING_CASE names do not, so they stay readable.
  if (!/[A-Z]/.test(alnum) || !/[a-z]/.test(alnum)) return false;
  let changes = 0;
  for (let i = 1; i < alnum.length; i++)
    if (classOf(alnum[i]!) !== classOf(alnum[i - 1]!)) changes++;
  // Random keys change class about every other character and have few vowels; CamelCase
  // names and words with a version number (PostgreSQL16TestServer) change far less often
  // and read like words.
  const ratio = changes / (alnum.length - 1);
  const letters = alnum.replace(/[0-9]/g, '');
  const vowels =
    letters.replace(/[^aeiou]/gi, '').length / (letters.length || 1);
  return ratio >= 0.4 || vowels < 0.25 || (ratio >= 0.3 && vowels < 0.3);
}
export function isOpaqueSecret(s: string): boolean {
  const parts = s.split(/[-/_.=+]+/).filter(Boolean);
  if (parts.some((p) => looksRandom(p, 16))) return true;
  // Dotted names (files, hosts, versions) are judged by their parts only.
  if (s.includes('.')) return false;
  return looksRandom(s, 20);
}

// name=value and name: value, unquoted. Only the name and separator are matched, so a value
// that is itself "refresh_token=…" is still examined; numbers alone stay readable (L-7).
const NAMED = /(["']?)([A-Za-z][A-Za-z0-9_.-]*)\1(\s*[:=]\s*)/g;
const VALUE = /^(?!\[hidden\])[^\s"'&,;(){}[\]<>\\]+/;
function hideNamedValues(text: string): { text: string; hidden: number } {
  let out = '';
  let at = 0;
  let hidden = 0;
  NAMED.lastIndex = 0;
  for (let m = NAMED.exec(text); m; m = NAMED.exec(text)) {
    if (m.index < at) continue;
    const end = m.index + m[0].length;
    const value = VALUE.exec(text.slice(end))?.[0];
    if (!value || !hideValue(m[2]!, value)) continue;
    out += text.slice(at, end) + HIDDEN;
    at = end + value.length;
    NAMED.lastIndex = at;
    hidden++;
  }
  return { text: out + text.slice(at), hidden };
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Hides tokens, keys, cookies, passwords, emails, personal folders and the person's account
 * and machine names. Errs on hiding too much: a support report never needs a secret.
 */
export function redactSupportText(
  text: string,
  identity: SupportIdentity = { userNames: [], hostNames: [] },
): { text: string; hidden: number } {
  let hidden = 0;
  // Encoded separators would hide a path or an email from the rules (L-4, R2-N2), and
  // escaped quotes would hide a JSON body embedded in an error message (R2-M1).
  let out = text
    .replace(/\\(["\\])/g, '$1')
    .replace(/%5C/gi, '\\')
    .replace(/%2F/gi, '/')
    .replace(/%3A/gi, ':')
    .replace(/\uFF20/g, '@');
  for (const r of RULES)
    out = out.replace(r.re, (...m: unknown[]) => {
      const args = m
        .slice(0, -2)
        .map((a) => (a === undefined ? '' : a)) as string[];
      const to = r.to(...args);
      if (to !== args[0]) hidden++;
      return to;
    });
  const named = hideNamedValues(out);
  out = named.text;
  hidden += named.hidden;
  out = out.replace(OPAQUE, (s) => {
    if (!isOpaqueSecret(s)) return s;
    hidden++;
    return HIDDEN;
  });
  // Whole words only (review 2 R2-L3). Accounts and hosts match as whole tokens; an OS
  // user name also hides the rest of a word it starts, since a Windows profile name is
  // often a cut-down real name ("jorda" in "Jordan").
  // GitHub logins may hold "-", so a login only matches when no "-" joins it to more.
  for (const [names, to, rest, edge] of [
    [identity.accountNames ?? [], '[account]', '', 'A-Za-z0-9-'],
    [identity.userNames, '[user]', '[A-Za-z0-9]*', 'A-Za-z0-9'],
    [identity.hostNames, '[host]', '', 'A-Za-z0-9'],
  ] as const)
    for (const n of [...names].sort((a, b) => b.length - a.length)) {
      if (n.trim().length < 3) continue;
      const word = new RegExp(
        `(?<![${edge}])${escape(n.trim())}${rest}(?![${edge}])`,
        'gi',
      );
      out = out.replace(word, () => {
        hidden++;
        return to;
      });
    }
  return { text: out, hidden };
}

/** Plain text, one fact per line, so it pastes cleanly into an email or an issue. */
export function renderSupportReport(
  f: SupportFacts,
  identity?: SupportIdentity,
): { text: string; hidden: number } {
  let hidden = 0;
  // Each recorded field is redacted whole, then flattened to one line and cut short, so a
  // cut never splits a secret below its shape (review 1 L-5, L-6) and a field cannot forge
  // report lines (N-4).
  const field = (s: string | null, max = DETAIL_MAX): string | null => {
    if (s === null) return null;
    const r = redactSupportText(s, identity);
    hidden += r.hidden;
    const flat = r.text.replace(/\s+/g, ' ').trim();
    if (!flat) return null;
    return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
  };
  const label = (s: string) => field(s, LABEL_MAX) ?? '';
  const tag = (fixture: boolean | null) =>
    fixture === true ? ' (fixture)' : fixture === false ? ' (real)' : '';
  const L: string[] = [];
  const a = f.app;
  L.push('Creator Agent support report');
  L.push(`Generated: ${f.generated_at}`);
  L.push(
    'Built from this studio’s own records. Secrets, emails, personal folders and account names are hidden.',
  );
  L.push('');
  L.push('## App');
  L.push(`Version: ${field(a.version) ?? 'unknown'}`);
  L.push(`Commit: ${a.build_commit ?? 'not recorded (development build)'}`);
  L.push(`Schema: ${a.schema_version ?? 'unknown'}`);
  L.push(`Deployment: ${a.mode} (${a.environment})`);
  L.push(
    `OS: ${label(a.os.platform)} ${label(a.os.release)} ${label(a.os.arch)}`,
  );
  L.push(`Node: ${label(a.node)}`);
  L.push('');
  L.push('## Health');
  L.push(`Ready: ${f.readiness.ready ? 'yes' : 'no'}`);
  for (const c of f.readiness.checks)
    L.push(
      `- ${label(c.name)}: ${c.ok ? 'OK' : 'failing'}. ${field(c.detail) ?? ''}`.trimEnd(),
    );
  for (const m of f.maintenance)
    L.push(
      `- maintenance ${label(m.job)}: ${m.error_code ? `last run failed (${label(m.error_code)})` : 'OK'}`,
    );
  L.push('');
  L.push('## Workers');
  if (!f.workers) L.push('Not available.');
  else {
    const w = f.workers;
    L.push(
      `Workflow leases: ${w.leases_active} active, ${w.leases_expired} expired`,
    );
    L.push(`Local jobs open: ${w.local_jobs_open}`);
    L.push(`Outbox pending: ${w.outbox_pending}`);
    if (w.local.length === 0) L.push('Paired local workers: none');
    for (const d of w.local)
      L.push(
        `- worker ${d.id} "${label(d.label)}": ${label(d.availability)}, last seen ${d.last_seen_at ?? 'never'}`,
      );
  }
  L.push('');
  L.push('## Connections');
  if (!f.connections) L.push('Not available.');
  else if (f.connections.length === 0) L.push('None set up.');
  else
    for (const c of f.connections) {
      const reason = field(c.reason);
      L.push(
        `- ${label(c.kind)} ${c.id}${tag(c.fixture)} "${label(c.label)}": ${label(c.state)}` +
          `${reason ? ` (${reason})` : ''}` +
          `, ${c.problems_24h} failed or unknown requests in the last day`,
      );
    }
  L.push('');
  L.push(`## Last ${SUPPORT_FAILURE_LIMIT} errors and failed steps`);
  if (!f.failures) L.push('Not available.');
  else if (f.failures.length === 0) L.push('None recorded.');
  else
    for (const x of f.failures.slice(0, SUPPORT_FAILURE_LIMIT)) {
      const detail = field(x.detail);
      L.push(
        `- ${x.at} ${label(x.source)} ${label(x.id)}${tag(x.fixture)}` +
          `${x.workspace_id ? ` workspace ${x.workspace_id}` : ''}: ${label(x.state)}` +
          `${detail ? `. ${detail}` : ''}`,
      );
    }
  if (f.unavailable.length) {
    L.push('');
    L.push('## Not included');
    for (const u of f.unavailable) L.push(`- ${field(u) ?? ''}`);
  }
  // A last pass over the whole text, in case a fixed part ever carries something.
  const last = redactSupportText(L.join('\n') + '\n', identity);
  return { text: last.text, hidden: hidden + last.hidden };
}
