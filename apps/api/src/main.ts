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
  const { server, config, ready, close, authMode, loginCode } = createApi(
    process.env,
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
      `Creator Agent API: http://${config.host}:${config.api_port}/api/health (no live calls; ${process.env.CREATOR_DATABASE_URL ? 'PostgreSQL records' : 'no persistence: CREATOR_DATABASE_URL unset'})\n${loginNotice(authMode, loginCode, config.web_port)}`,
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
