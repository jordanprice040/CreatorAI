import { createApi } from './index.js';
import { portHolder, portInUseText } from './ports.js';
import { guardStudio } from './studio-guard.js';

/** ADR-0108: a busy port names its holder. `dev:api` alone never moves (dev:web wouldn't follow). */
const listenError =
  (what: string, port: number, setting: string) =>
  (e: NodeJS.ErrnoException) => {
    process.exitCode = 1;
    if (e.code !== 'EADDRINUSE') return console.error(`${what}${e.message}`);
    void portHolder(port).then((holder) =>
      console.error(
        `${what}${portInUseText(port, holder)} Close that program, or set ${setting} to a free port.`,
      ),
    );
  };
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
// ADR-0108 (review 2 L-3): `pnpm dev:api` runs the in-process workflow worker too, so it
// holds the one-studio-per-database lock like `pnpm dev` (not in a hosted deployment).
// Until the servers are set up below, losing the lock ends the process outright (review 3
// N-2); afterwards `shutdown` closes the API and its worker first.
let shutdown: () => Promise<void> = async () => process.exit(1);
const guard = await guardStudio(
  process.env,
  `pnpm dev:api, process ${process.pid}`,
  (message) => {
    console.error(message);
    process.exitCode = 1;
    void shutdown();
  },
);
if (!guard.ok) {
  console.error(guard.message);
  process.exit(1);
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
    inference,
  } = createApi(process.env);
  if (deployment.mode === 'hosted')
    console.log(
      `Hosted ${deployment.environment} deployment of ${deployment.build_commit}: ${deployment.api_origin} (readiness at /api/ready; not verified until an owner records a verification).`,
    );
  server.on('error', listenError('', config.api_port, 'CREATOR_API_PORT'));
  ready().then(
    () => undefined,
    (e: unknown) =>
      console.error(
        `Records unavailable: ${e instanceof Error ? e.message : 'database error'}`,
      ),
  );
  server.listen(config.api_port, config.host, () =>
    console.log(
      `Creator Agent API: http://${config.host}:${config.api_port}/api/health (${inference.api_model ? `API adapter ${inference.api_model} configured, unverified` : 'no live API adapter configured at startup (a workspace owner can save an OpenAI key in Models and connections)'}; plan connections ${inference.plan_connections ? 'available when configured' : 'unavailable without saved records'}; ${process.env.CREATOR_DATABASE_URL || process.env.CREATOR_DATABASE_URL_FILE ? 'PostgreSQL records' : 'no persistence: CREATOR_DATABASE_URL unset'})\nCalls require the matching settings, grants and resource limits.\n${loginNotice(authMode, loginCode, config.web_port)}`,
    ),
  );
  preview.on(
    'error',
    listenError(
      'Preview origin: ',
      config.preview_port,
      'CREATOR_PREVIEW_PORT',
    ),
  );
  preview.listen(config.preview_port, config.host, () =>
    console.log(
      `Private previews: http://${config.host}:${config.preview_port} (separate origin)`,
    ),
  );
  let stopping: Promise<void> | null = null;
  shutdown = () =>
    (stopping ??= (async () => {
      await close();
      await guard.lock?.release();
    })());
  for (const signal of ['SIGINT', 'SIGTERM'] as const)
    process.on(signal, () => void shutdown());
} catch (error) {
  console.error(
    error instanceof Error ? error.message : 'Invalid configuration',
  );
  await guard.lock?.release();
  process.exitCode = 1;
}
