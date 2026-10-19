import { z, parse } from '@creator/contracts';
const port = z
  .string()
  .regex(/^[1-9][0-9]{0,4}$/)
  .transform(Number)
  .pipe(z.number().int().min(1024).max(65535));
export const ServiceConfigSchema = z
  .strictObject({
    // Hosted deployments may listen on all interfaces behind their TLS proxy (X06).
    host: z.enum(['127.0.0.1', '0.0.0.0']),
    api_port: port,
    web_port: port,
    /** Separate origin for private previews; never the management API or web origin. */
    preview_port: port,
    deployment_mode: z.enum(['local', 'hosted']),
    data_mode: z.literal('fixture'),
    provider: z.literal('fixture'),
    live_enabled: z.literal('false'),
  })
  .refine(
    (c) => new Set([c.api_port, c.web_port, c.preview_port]).size === 3,
    'API, web and preview ports must differ.',
  )
  .refine(
    (c) => c.host === '127.0.0.1' || c.deployment_mode === 'hosted',
    'Local deployment listens on 127.0.0.1 only.',
  );
export function serviceConfig(env: Record<string, string | undefined>) {
  return parse(
    ServiceConfigSchema,
    {
      host: env.CREATOR_LISTEN_HOST ?? env.CREATOR_HOST ?? '127.0.0.1',
      api_port: env.CREATOR_API_PORT ?? '4310',
      web_port: env.CREATOR_WEB_PORT ?? '5173',
      preview_port: env.CREATOR_PREVIEW_PORT ?? '4320',
      deployment_mode: env.CREATOR_DEPLOYMENT_MODE ?? 'local',
      data_mode: env.CREATOR_DATA_MODE ?? 'fixture',
      provider: env.CREATOR_PROVIDER ?? 'fixture',
      live_enabled: env.CREATOR_LIVE_ENABLED ?? 'false',
    },
    'INVALID_CONFIG',
  );
}
export type ServiceConfig = ReturnType<typeof serviceConfig>;

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);
const httpUrl = z.url({ protocol: /^https?$/ });
const AuthConfigSchema = z
  .strictObject({
    deployment_mode: z.enum(['local', 'hosted']),
    mode: z.enum(['dev_local', 'oidc']),
    session_hours: z
      .string()
      .regex(/^[1-9][0-9]?$/)
      .transform(Number)
      .pipe(z.number().int().min(1).max(24)),
    cookie_secure: z.enum(['true', 'false']).transform((v) => v === 'true'),
    dev_login_code: z
      .string()
      .regex(/^[A-Za-z0-9_-]{32,200}$/)
      .nullable(),
    oidc: z
      .strictObject({
        issuer: httpUrl,
        client_id: z.string().min(1).max(200),
        client_secret: z.string().min(1).max(500).nullable(),
        redirect_uri: httpUrl,
        owner_subject: z.string().min(1).max(255),
        web_origin: httpUrl,
      })
      .nullable(),
  })
  .superRefine((c, ctx) => {
    const issue = (message: string) =>
      ctx.addIssue({ code: 'custom', message });
    if (c.deployment_mode === 'hosted') {
      if (c.mode === 'dev_local')
        issue(
          'Development login is a local fixture and is refused in hosted mode; configure OIDC.',
        );
      if (!c.cookie_secure) issue('Hosted sessions require secure cookies.');
      if (c.oidc && !c.oidc.issuer.startsWith('https:'))
        issue('Hosted OIDC requires an https issuer.');
    }
    if (c.mode === 'oidc' && !c.oidc)
      issue(
        'OIDC mode needs CREATOR_OIDC_ISSUER, _CLIENT_ID, _REDIRECT_URI and _OWNER_SUBJECT.',
      );
    if (c.mode === 'dev_local' && c.oidc)
      issue('OIDC settings are present but CREATOR_AUTH_MODE is dev_local.');
    if (c.oidc) {
      const issuer = new URL(c.oidc.issuer);
      if (issuer.protocol === 'http:' && !LOOPBACK_HOSTS.has(issuer.hostname))
        issue('A plain-http OIDC issuer is accepted only on loopback.');
    }
  });
/** Session and login configuration. Never log the returned secrets. */
export function authConfig(env: Record<string, string | undefined>) {
  const oidc =
    env.CREATOR_OIDC_ISSUER !== undefined
      ? {
          issuer: env.CREATOR_OIDC_ISSUER,
          client_id: env.CREATOR_OIDC_CLIENT_ID,
          client_secret: env.CREATOR_OIDC_CLIENT_SECRET || null,
          redirect_uri: env.CREATOR_OIDC_REDIRECT_URI,
          owner_subject: env.CREATOR_OIDC_OWNER_SUBJECT,
          web_origin:
            env.CREATOR_WEB_ORIGIN ??
            `http://127.0.0.1:${env.CREATOR_WEB_PORT ?? '5173'}`,
        }
      : null;
  const hosted = env.CREATOR_DEPLOYMENT_MODE === 'hosted';
  return parse(
    AuthConfigSchema,
    {
      deployment_mode: env.CREATOR_DEPLOYMENT_MODE ?? 'local',
      mode: env.CREATOR_AUTH_MODE ?? (oidc ? 'oidc' : 'dev_local'),
      session_hours: env.CREATOR_SESSION_HOURS ?? '12',
      cookie_secure: env.CREATOR_COOKIE_SECURE ?? (hosted ? 'true' : 'false'),
      dev_login_code: env.CREATOR_DEV_LOGIN_CODE ?? null,
      oidc,
    },
    'INVALID_CONFIG',
  );
}
export type AuthConfig = ReturnType<typeof authConfig>;
