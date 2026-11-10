import { ContractError, z, parse } from '@creator/contracts';
import { canonicalHash } from './rules.js';

/**
 * X06 deployment profile. Local is the default and needs nothing new. Hosted is explicit:
 * one of the test, staging or live environments, public https origins behind a TLS proxy,
 * a separate preview host, a build commit, durable product storage and a metrics token.
 * Nothing here activates anything; it only refuses unsafe or ambiguous configurations.
 */
export const DeploymentEnvironmentSchema = z.enum([
  'local',
  'test',
  'staging',
  'live',
]);
export type DeploymentEnvironment = z.infer<typeof DeploymentEnvironmentSchema>;

const origin = z
  .url({ protocol: /^https$/ })
  .refine((u) => {
    const url = new URL(u);
    return (
      !url.username &&
      !url.password &&
      url.pathname === '/' &&
      !url.search &&
      !url.hash
    );
  }, 'Must be a bare https origin with no path, query or credentials.')
  .transform((u) => new URL(u).origin);

const HostedSchema = z
  .strictObject({
    mode: z.literal('hosted'),
    environment: z.enum(['test', 'staging', 'live']),
    listen_host: z.enum(['127.0.0.1', '0.0.0.0']),
    build_commit: z
      .string()
      .regex(/^[0-9a-f]{40}$/, 'CREATOR_BUILD_COMMIT must be a full git SHA.'),
    web_origin: origin,
    api_origin: origin,
    preview_origin: origin,
    products_root: z
      .string()
      .regex(
        /^(\/|[A-Za-z]:[\\/])/,
        'CREATOR_PRODUCTS_ROOT must be an absolute path on durable storage.',
      ),
    metrics_token: z
      .string()
      .regex(
        /^[A-Za-z0-9_-]{32,200}$/,
        'CREATOR_METRICS_TOKEN must be 32-200 URL-safe characters.',
      ),
  })
  .superRefine((c, ctx) => {
    const host = (o: string) => new URL(o).hostname;
    const p = host(c.preview_origin);
    for (const other of [host(c.web_origin), host(c.api_origin)])
      if (p === other || p.endsWith(`.${other}`) || other.endsWith(`.${p}`))
        ctx.addIssue({
          code: 'custom',
          message:
            'The preview origin needs its own host, not the web or API host or a parent/child of it, so previews never share the sign-in cookie.',
        });
  });

export type DeploymentConfig =
  | {
      mode: 'local';
      environment: 'local';
      listen_host: '127.0.0.1';
      build_commit: string | null;
      web_origin: null;
      api_origin: null;
      preview_origin: null;
      products_root: string;
      metrics_token: string | null;
    }
  | z.infer<typeof HostedSchema>;

/** Reads the deployment profile. Never log the returned metrics token. */
export function deploymentConfig(
  env: Record<string, string | undefined>,
): DeploymentConfig {
  const mode = env.CREATOR_DEPLOYMENT_MODE ?? 'local';
  if (mode === 'local') {
    if (env.CREATOR_ENVIRONMENT && env.CREATOR_ENVIRONMENT !== 'local')
      throw new ContractError(
        'INVALID_CONFIG',
        'Test, staging and live are hosted environments; set CREATOR_DEPLOYMENT_MODE=hosted.',
      );
    const commit = env.CREATOR_BUILD_COMMIT;
    if (commit !== undefined && !/^[0-9a-f]{40}$/.test(commit))
      throw new ContractError(
        'INVALID_CONFIG',
        'CREATOR_BUILD_COMMIT must be a full git SHA.',
      );
    const token = env.CREATOR_METRICS_TOKEN;
    if (token !== undefined && !/^[A-Za-z0-9_-]{32,200}$/.test(token))
      throw new ContractError(
        'INVALID_CONFIG',
        'CREATOR_METRICS_TOKEN must be 32-200 URL-safe characters.',
      );
    return {
      mode: 'local',
      environment: 'local',
      listen_host: '127.0.0.1',
      build_commit: commit ?? null,
      web_origin: null,
      api_origin: null,
      preview_origin: null,
      products_root: env.CREATOR_PRODUCTS_ROOT ?? '.creator/products',
      metrics_token: token ?? null,
    };
  }
  if (mode !== 'hosted')
    throw new ContractError(
      'INVALID_CONFIG',
      'CREATOR_DEPLOYMENT_MODE must be local or hosted.',
    );
  return parse(
    HostedSchema,
    {
      mode,
      environment: env.CREATOR_ENVIRONMENT,
      listen_host: env.CREATOR_LISTEN_HOST ?? '127.0.0.1',
      build_commit: env.CREATOR_BUILD_COMMIT,
      web_origin: env.CREATOR_PUBLIC_WEB_ORIGIN,
      api_origin:
        env.CREATOR_PUBLIC_API_ORIGIN ?? env.CREATOR_PUBLIC_WEB_ORIGIN,
      preview_origin: env.CREATOR_PUBLIC_PREVIEW_ORIGIN,
      products_root: env.CREATOR_PRODUCTS_ROOT,
      metrics_token: env.CREATOR_METRICS_TOKEN,
    },
    'INVALID_CONFIG',
  );
}

/**
 * Hash of everything that defines a deployment except secrets. A recorded verification
 * binds to it, so a changed origin, commit, auth issuer or adapter switch makes it stale.
 */
export function deploymentConfigHash(
  d: DeploymentConfig,
  env: Record<string, string | undefined>,
): string {
  const { metrics_token: _token, ...rest } = d;
  return canonicalHash({
    ...rest,
    auth_mode: env.CREATOR_AUTH_MODE ?? null,
    oidc_issuer: env.CREATOR_OIDC_ISSUER ?? null,
    oidc_client_id: env.CREATOR_OIDC_CLIENT_ID ?? null,
    oidc_owner_subject: env.CREATOR_OIDC_OWNER_SUBJECT ?? null,
    live_provider: env.CREATOR_LIVE_PROVIDER ?? null,
    live_model: env.CREATOR_OPENAI_MODEL ?? null,
    source_fetch: env.CREATOR_SOURCE_FETCH ?? null,
    source_hosts: env.CREATOR_SOURCE_HOSTS ?? null,
    github: env.CREATOR_GITHUB ?? null,
    worker: env.CREATOR_WORKER ?? 'on',
  });
}

/** Host header values a deployment answers to; loopback stays allowed for local probes. */
export function allowedHosts(d: DeploymentConfig, port: number): string[] {
  const local = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (d.mode === 'local') return local;
  return [...new Set([new URL(d.api_origin).host, ...local])];
}

const SECRET_FILE = /^((?:CREATOR|OPENAI)_[A-Z0-9_]+)_FILE$/;
/**
 * Settings whose name ends in `_FILE` but name a path the program itself reads and writes,
 * not a secret to load: the CLI's sign-in state. Without this, setting it in the terminal
 * that starts the API or the migrations stopped them with "could not be read".
 */
const PATH_SETTINGS = new Set(['CREATOR_SESSION_FILE']);
/**
 * Secrets management: `NAME_FILE=/run/secrets/x` loads NAME from that file (the Docker and
 * systemd credentials convention), so secrets need not sit in the environment or in an env
 * file. Setting both forms is refused. Returns the merged environment and which names came
 * from files; never the values.
 */
export function resolveSecretFiles(
  env: Record<string, string | undefined>,
  read: (path: string) => string,
): { env: Record<string, string | undefined>; from_files: string[] } {
  const out = { ...env };
  const from: string[] = [];
  for (const [key, path] of Object.entries(env)) {
    const m = SECRET_FILE.exec(key);
    if (!m || PATH_SETTINGS.has(key) || path === undefined || path === '')
      continue;
    const name = m[1]!;
    if (env[name] !== undefined && env[name] !== '')
      throw new ContractError(
        'INVALID_CONFIG',
        `Set ${name} or ${key}, not both.`,
      );
    let value: string;
    try {
      value = read(path).replace(/\r?\n$/, '');
    } catch {
      throw new ContractError('INVALID_CONFIG', `${key} could not be read.`);
    }
    if (!value)
      throw new ContractError('INVALID_CONFIG', `${key} names an empty file.`);
    out[name] = value;
    delete out[key];
    from.push(name);
  }
  return { env: out, from_files: from.sort() };
}

/** Names that hold credentials; config-check reports where each came from, never its value. */
export const SECRET_NAMES = [
  'CREATOR_DATABASE_URL',
  'CREATOR_OIDC_CLIENT_SECRET',
  'CREATOR_METRICS_TOKEN',
  'CREATOR_DEV_LOGIN_CODE',
  'OPENAI_API_KEY',
  'CREATOR_BRAVE_SEARCH_API_KEY',
] as const;

// Monitoring: alert rules are evaluated locally from metrics. Delivering an alert anywhere
// outside the deployment (email, pager, chat) is an outbound message and is not built here.
export const AlertRuleSchema = z.strictObject({
  id: z.string().regex(/^[a-z0-9_]{1,60}$/),
  metric: z.string().regex(/^[a-z0-9_]{1,80}$/),
  above: z.number().nonnegative(),
  severity: z.enum(['info', 'warning', 'critical']),
  summary: z.string().min(1).max(300),
});
export const AlertRulesSchema = z.strictObject({
  version: z.string().min(1).max(40),
  delivery: z.literal('none'),
  rules: z.array(AlertRuleSchema).max(50),
});
export type AlertRules = z.infer<typeof AlertRulesSchema>;
export type Alert = z.infer<typeof AlertRuleSchema> & {
  value: number | null;
  state: 'firing' | 'ok' | 'no_data';
};
export function evaluateAlerts(
  rules: AlertRules,
  metrics: Record<string, number | null>,
): Alert[] {
  return rules.rules.map((r) => {
    const value = metrics[r.metric];
    return {
      ...r,
      value: value ?? null,
      state:
        value === undefined || value === null
          ? 'no_data'
          : value > r.above
            ? 'firing'
            : 'ok',
    };
  });
}

export const RetentionSchema = z.strictObject({
  version: z.string().min(1).max(40),
  /** Expired or revoked sign-in sessions, kept this long for investigation. */
  auth_sessions_days: z.number().int().min(1).max(3650),
  oidc_logins_days: z.number().int().min(1).max(3650),
  desktop_challenges_days: z.number().int().min(1).max(3650),
});
export type Retention = z.infer<typeof RetentionSchema>;

/** What `POST /api/ops/verifications` needs to record a live verification. */
export function liveConfirmation(commit: string, configHash: string): string {
  return `verify live ${commit.slice(0, 12)} ${configHash.slice(0, 12)}`;
}
