import { createServer } from 'vite';
import { createApi } from '../apps/api/dist/index.js';

const { server: api, config, ready, close } = createApi(process.env);
let web;
try {
  await new Promise((resolve, reject) => {
    api.once('error', reject);
    api.listen(config.api_port, config.host, resolve);
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
  const records = process.env.CREATOR_DATABASE_URL
    ? await ready().then(
        () => 'records saved in PostgreSQL',
        (e) => `records unavailable (${e.message})`,
      )
    : 'no persistence (CREATOR_DATABASE_URL unset)';
  console.log(
    `Fixture provider only, no real AI; ${records}. Restart after backend edits. Ctrl+C stops both servers.`,
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
