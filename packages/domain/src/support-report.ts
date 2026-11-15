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
const HIDDEN = '[hidden]';

/** Names that identify the person or machine; replaced wherever they appear. */
export type SupportIdentity = { userNames: string[]; hostNames: string[] };

type Rule = { re: RegExp; to: string | ((...m: string[]) => string) };

const KEYWORDS =
  'token|secret|password|passwd|passphrase|pwd|api[_-]?key|apikey|access[_-]?key|private[_-]?key|client[_-]?secret|session[_-]?id|sessionid|session|cookie|authorization|auth[_-]?token|credential|credentials|signature|sig';

// Order matters: whole headers and blocks first, then named values, then shapes that are
// secrets on their own, then personal names and paths.
const RULES: Rule[] = [
  {
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z ]*PRIVATE KEY-----|$)/g,
    to: `${HIDDEN} private key`,
  },
  { re: /\b(set-cookie|cookie)(\s*[:=]\s*)[^\r\n]+/gi, to: `$1$2${HIDDEN}` },
  {
    re: /\b(bearer|basic)(\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    to: `$1$2${HIDDEN}`,
  },
  // Credentials inside a URL: scheme://user:password@host.
  { re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi, to: `$1${HIDDEN}@` },
  // name=value, name: value, "name": "value", ?name=value for secret-looking names.
  {
    re: new RegExp(
      `(["']?\\b[A-Za-z0-9_.-]*(?:${KEYWORDS})[A-Za-z0-9_.-]*["']?)(\\s*[:=]\\s*)(["']?)([^\\s"'&,;(){}\\[\\]]+)`,
      'gi',
    ),
    to: (_m, name, sep, quote) => `${name}${sep}${quote}${HIDDEN}`,
  },
  {
    re: /\b(?:sk|rk|pk)[-_](?:live|test|proj|ant|svcacct)?[-_]?[A-Za-z0-9_-]{16,}/g,
    to: HIDDEN,
  },
  {
    re: /\b(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g,
    to: HIDDEN,
  },
  { re: /\bxox[abprs]-[A-Za-z0-9-]{10,}/g, to: HIDDEN },
  { re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g, to: HIDDEN },
  { re: /\bAIza[0-9A-Za-z_-]{30,}/g, to: HIDDEN },
  { re: /\bwhsec_[A-Za-z0-9+/=_-]{10,}/g, to: HIDDEN },
  {
    re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g,
    to: HIDDEN,
  },
  { re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, to: '[email]' },
  // Personal folders: C:\Users\<name>, C:/Users/<name>, /home/<name>, /Users/<name>.
  {
    re: /\b([A-Za-z]:[\\/]+(?:Users|Documents and Settings)[\\/]+)[^\\/\s"'<>|]+/gi,
    to: '$1[user]',
  },
  { re: /(^|[\s"'(=:])(\/(?:home|Users)\/)[^/\s"'<>]+/g, to: '$1$2[user]' },
  { re: /(%USERPROFILE%|\$HOME|~)(?=[\\/])/g, to: '[home]' },
];

// Long opaque strings that are not plain hex (commits and hashes stay readable).
const OPAQUE = /\b[A-Za-z0-9+/_-]{32,}={0,2}/g;
const isOpaqueSecret = (s: string) =>
  !/^[0-9a-f]+$/i.test(s) &&
  /[0-9]/.test(s) &&
  /[A-Za-z]/.test(s) &&
  !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s);

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
  let out = text;
  for (const r of RULES)
    out = out.replace(r.re, (...m: unknown[]) => {
      hidden++;
      const args = m.slice(0, -2) as string[];
      return typeof r.to === 'string'
        ? r.to.replace(/\$(\d)/g, (_x, i: string) => args[Number(i)] ?? '')
        : r.to(...args);
    });
  out = out.replace(OPAQUE, (s) => {
    if (!isOpaqueSecret(s)) return s;
    hidden++;
    return HIDDEN;
  });
  for (const [names, to] of [
    [identity.userNames, '[user]'],
    [identity.hostNames, '[host]'],
  ] as const)
    for (const n of names) {
      if (n.trim().length < 3) continue;
      out = out.replace(new RegExp(escape(n.trim()), 'gi'), () => {
        hidden++;
        return to;
      });
    }
  return { text: out, hidden };
}

const clip = (s: string | null) =>
  s === null
    ? null
    : s.replace(/\s+/g, ' ').trim().slice(0, DETAIL_MAX) || null;
const tag = (fixture: boolean | null) =>
  fixture === true ? ' (fixture)' : fixture === false ? ' (real)' : '';

/** Plain text, one fact per line, so it pastes cleanly into an email or an issue. */
export function renderSupportReport(
  f: SupportFacts,
  identity?: SupportIdentity,
): { text: string; hidden: number } {
  const L: string[] = [];
  const a = f.app;
  L.push('Creator Agent support report');
  L.push(`Generated: ${f.generated_at}`);
  L.push(
    'Built from this studio’s own records. Secrets, emails, personal folders and account names are hidden.',
  );
  L.push('');
  L.push('## App');
  L.push(`Version: ${a.version}`);
  L.push(`Commit: ${a.build_commit ?? 'not recorded (development build)'}`);
  L.push(`Schema: ${a.schema_version ?? 'unknown'}`);
  L.push(`Deployment: ${a.mode} (${a.environment})`);
  L.push(`OS: ${a.os.platform} ${a.os.release} ${a.os.arch}`);
  L.push(`Node: ${a.node}`);
  L.push('');
  L.push('## Health');
  L.push(`Ready: ${f.readiness.ready ? 'yes' : 'no'}`);
  for (const c of f.readiness.checks)
    L.push(`- ${c.name}: ${c.ok ? 'OK' : 'failing'}. ${clip(c.detail) ?? ''}`);
  for (const m of f.maintenance)
    L.push(
      `- maintenance ${m.job}: ${m.error_code ? `last run failed (${m.error_code})` : 'OK'}`,
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
        `- worker ${d.id} "${d.label}": ${d.availability}, last seen ${d.last_seen_at ?? 'never'}`,
      );
  }
  L.push('');
  L.push('## Connections');
  if (!f.connections) L.push('Not available.');
  else if (f.connections.length === 0) L.push('None set up.');
  else
    for (const c of f.connections)
      L.push(
        `- ${c.kind} ${c.id}${tag(c.fixture)} "${c.label}": ${c.state}` +
          `${c.reason ? ` (${clip(c.reason)})` : ''}` +
          `, ${c.problems_24h} failed or unknown requests in the last day`,
      );
  L.push('');
  L.push(`## Last ${SUPPORT_FAILURE_LIMIT} errors and failed steps`);
  if (!f.failures) L.push('Not available.');
  else if (f.failures.length === 0) L.push('None recorded.');
  else
    for (const x of f.failures.slice(0, SUPPORT_FAILURE_LIMIT))
      L.push(
        `- ${x.at} ${x.source} ${x.id}${tag(x.fixture)}` +
          `${x.workspace_id ? ` workspace ${x.workspace_id}` : ''}: ${x.state}` +
          `${x.detail ? `. ${clip(x.detail)}` : ''}`,
      );
  if (f.unavailable.length) {
    L.push('');
    L.push('## Not included');
    for (const u of f.unavailable) L.push(`- ${u}`);
  }
  return redactSupportText(L.join('\n') + '\n', identity);
}
