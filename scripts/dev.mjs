import { createServer } from 'vite';
import { createApi } from '../apps/api/dist/index.js';
import {
  PortPlanError,
  planDevPorts,
  portHolder,
  portInUseText,
} from '../apps/api/dist/ports.js';
import { guardStudio } from '../apps/api/dist/studio-guard.js';
import { DEV_PORTS } from '../packages/domain/dist/index.js';
import { requireSupportedNode } from './runtime.mjs';
import { inferenceNotice } from './dev-status.mjs';

requireSupportedNode();

// ADR-0108: choose every port before anything starts, so the API, previews, the web app and
// its /api proxy agree. A default port an unrelated program holds moves; another studio,
// an explicit port or OIDC sign-in stops here with the holder named instead.
let ports;
try {
  ports = await planDevPorts(process.env);
} catch (error) {
  if (!(error instanceof PortPlanError)) throw error;
  console.error(error.message);
  process.exit(1);
}
Object.assign(process.env, ports.env);
for (const line of ports.moved) console.warn(line);
if (ports.moved.length)
  console.warn(
    'Browser settings saved for the usual address do not carry over to a moved web port.',
  );

// ADR-0108: one studio per database, whatever ports it uses (review 1 M-1). Held until exit;
// if another studio takes it while this one's database connection is down, this one stops.
let stopping = null;
const guard = await guardStudio(
  process.env,
  `pnpm dev, web port ${ports.env.CREATOR_WEB_PORT}, process ${process.pid}`,
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
let studioLock = guard.lock;
const release = async () => {
  await studioLock?.release();
  studioLock = null;
};

/** The CLI defaults to the dev API port; name any other one (review 1 N-1). */
function cliPrefix(apiPort) {
  if (apiPort === DEV_PORTS.api) return '';
  const url = `http://127.0.0.1:${apiPort}`;
  return process.platform === 'win32'
    ? `$env:CREATOR_API_URL='${url}'; `
    : `CREATOR_API_URL=${url} `;
}

const {
  server: api,
  preview,
  config,
  ready,
  close,
  authMode,
  loginCode,
  inference,
} = createApi(process.env);
let web;
try {
  await new Promise((resolve, reject) => {
    api.once('error', reject);
    api.listen(config.api_port, config.host, resolve);
  });
  await new Promise((resolve, reject) => {
    preview.once('error', reject);
    preview.listen(config.preview_port, config.host, resolve);
  });
  web = await createServer({
    root: 'apps/web',
    configFile: 'apps/web/vite.config.ts',
  });
  await web.listen();
  console.log(
    `Creator Agent API: http://${config.host}:${config.api_port}/api/health`,
  );
  web.printUrls();
  console.log(
    `Private previews: http://${config.host}:${config.preview_port} (separate origin)`,
  );
  const records = process.env.CREATOR_DATABASE_URL
    ? await ready().then(
        () => 'records saved in PostgreSQL',
        (e) => `records unavailable (${e.message})`,
      )
    : 'no persistence (CREATOR_DATABASE_URL unset)';
  console.log(
    `${inferenceNotice(inference)} ${records}. Restart after backend edits. Ctrl+C stops both servers.`,
  );
  console.log(
    authMode === 'oidc'
      ? 'Sign-in: OIDC (open the web page and choose Sign in).'
      : loginCode
        ? `Sign-in (local development, this run only): http://${config.host}:${config.web_port}/#login=${loginCode}\n  or: ${cliPrefix(config.api_port)}pnpm cli login ${loginCode}`
        : 'Sign-in: development code from CREATOR_DEV_LOGIN_CODE.',
  );
} catch (error) {
  // A port can still be taken between the check and the listen.
  console.error(
    error.code === 'EADDRINUSE' && error.port
      ? portInUseText(error.port, await portHolder(error.port))
      : error.message,
  );
  await close();
  await web?.close();
  await release();
  process.exitCode = 1;
}
async function shutdown() {
  stopping ??= (async () => {
    await close();
    await web?.close();
    await release();
  })();
  return stopping;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, () => void shutdown());
