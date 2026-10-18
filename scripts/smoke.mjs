import assert from 'node:assert/strict';
import { once } from 'node:events';
import { preview } from 'vite';
import { createApi } from '../apps/api/dist/index.js';

const { server: api, config, close } = createApi(process.env);
let web;
try {
  api.listen(config.api_port, config.host);
  await once(api, 'listening');
  web = await preview({
    root: 'apps/web',
    configFile: 'apps/web/vite.config.ts',
  });
  const base = `http://${config.host}:${config.web_port}`;
  const page = await fetch(base);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /Creator Agent/);
  const health = await fetch(`${base}/api/health`);
  assert.equal(health.status, 200);
  assert.equal((await health.json()).data_mode, 'fixture');
  const demo = await fetch(`${base}/api/fixture`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: base },
    body: JSON.stringify({
      goal: 'Synthetic production-proxy smoke check',
      outcome: 'defer',
    }),
  });
  assert.equal(demo.status, 200);
  assert.equal((await demo.json()).product.stage, 'deferred');
  console.log(
    'PASS: built web page → Vite preview proxy → API health and fixture. This is HTTP smoke verification, not browser rendering.',
  );
} finally {
  await close();
  if (web) {
    web.httpServer.closeAllConnections();
    await new Promise((resolve) => web.httpServer.close(resolve));
  }
}
