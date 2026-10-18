import { createServer } from 'vite';
import { createApi } from '../apps/api/dist/index.js';

const { server: api, config } = createApi(process.env);
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
  console.log(
    'Fixture only. No persistence or real AI. Restart after backend edits. Ctrl+C stops both servers.',
  );
} catch (error) {
  console.error(error.message);
  api.closeAllConnections();
  api.close();
  await web?.close();
  process.exitCode = 1;
}
for (const signal of ['SIGINT', 'SIGTERM'])
  process.on(signal, async () => {
    api.closeAllConnections();
    api.close();
    await web?.close();
  });
