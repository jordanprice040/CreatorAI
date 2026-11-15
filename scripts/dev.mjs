import { createServer } from 'vite';
import { createApi } from '../apps/api/dist/index.js';
import {
  PortPlanError,
  planDevPorts,
  portHolder,
  portInUseText,
} from '../apps/api/dist/ports.js';
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
    'Browser settings saved for the usual address do not carry over to a moved web port. `pnpm cli` needs CREATOR_API_URL when the API moved.',
  );

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
        ? `Sign-in (local development, this run only): http://${config.host}:${config.web_port}/#login=${loginCode}\n  or: pnpm cli login ${loginCode}`
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
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await close();
    await web?.close();
  });
