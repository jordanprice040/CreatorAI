import { createApi } from './index.js';
export function loginNotice(
  mode: string,
  code: string | null,
  webPort: number,
): string {
  if (mode === 'oidc')
    return 'Sign-in: OIDC (open the web page and choose Sign in).';
  if (!code) return 'Sign-in: development code from CREATOR_DEV_LOGIN_CODE.';
  return `Sign-in (local development, this run only): open http://127.0.0.1:${webPort}/#login=${code}\n  or run: pnpm cli login ${code}`;
}
try {
  const {
    server,
    preview,
    config,
    ready,
    close,
    authMode,
    loginCode,
    deployment,
  } = createApi(process.env);
  if (deployment.mode === 'hosted')
    console.log(
      `Hosted ${deployment.environment} deployment of ${deployment.build_commit}: ${deployment.api_origin} (readiness at /api/ready; not verified until an owner records a verification).`,
    );
  server.on('error', (e) => {
    console.error(e.message);
    process.exitCode = 1;
  });
  ready().then(
    () => undefined,
    (e: unknown) =>
      console.error(
        `Records unavailable: ${e instanceof Error ? e.message : 'database error'}`,
      ),
  );
  server.listen(config.api_port, config.host, () =>
    console.log(
      `Creator Agent API: http://${config.host}:${config.api_port}/api/health (no live calls; ${process.env.CREATOR_DATABASE_URL || process.env.CREATOR_DATABASE_URL_FILE ? 'PostgreSQL records' : 'no persistence: CREATOR_DATABASE_URL unset'})\n${loginNotice(authMode, loginCode, config.web_port)}`,
    ),
  );
  preview.on('error', (e) => console.error(`Preview origin: ${e.message}`));
  preview.listen(config.preview_port, config.host, () =>
    console.log(
      `Private previews: http://${config.host}:${config.preview_port} (separate origin)`,
    ),
  );
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => void close());
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Invalid configuration',
  );
  process.exitCode = 1;
}
