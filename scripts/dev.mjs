import { createServer } from 'vite';
import { createApi } from '../apps/api/dist/index.js';

const {
  server: api,
  preview,
  config,
  ready,
  close,
  authMode,
  loginCode,
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
    `Fixture API: http://${config.host}:${config.api_port}/api/health`,
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
    `Fixture provider only, no real AI; ${records}. Restart after backend edits. Ctrl+C stops both servers.`,
  );
  console.log(
    authMode === 'oidc'
      ? 'Sign-in: OIDC (open the web page and choose Sign in).'
      : loginCode
        ? `Sign-in (local development, this run only): http://${config.host}:${config.web_port}/#login=${loginCode}\n  or: pnpm cli login ${loginCode}`
        : 'Sign-in: development code from CREATOR_DEV_LOGIN_CODE.',
  );
} catch (error) {
  console.error(error.message);
  await close();
  await web?.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    await close();
    await web?.close();
  });
