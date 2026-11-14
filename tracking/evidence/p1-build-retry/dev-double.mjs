// Throwaway studio for the P-1 walk in the cloud container, where no WSL2 worker exists.
// TEST DOUBLE: acceptance cases are answered by tests/dist/artifact-double.js (it runs no
// program, and its records name the backend "test-double"). Set P1_BLOCK_FIRST=n to make
// the first n case runs report the real worker's "Isolation unavailable" block.
// Run from the repo root after `pnpm build:code`.
import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const from = (p) => pathToFileURL(resolve(p)).href;
const { createServer } = await import(
  pathToFileURL(createRequire(resolve('apps/web/package.json')).resolve('vite')).href
);
const { createApi } = await import(from('apps/api/dist/index.js'));
const { ArtifactSupervisor, ProductSupervisor } = await import(
  from('packages/executor/dist/index.js')
);
const { TestDoubleExecutor } = await import(from('tests/dist/artifact-double.js'));
const products = new ProductSupervisor(resolve(process.env.CREATOR_PRODUCTS_ROOT));
const exec = new TestDoubleExecutor(products);
let block = Number(process.env.P1_BLOCK_FIRST ?? 0);
const run = exec.run.bind(exec);
exec.run = async (...a) => {
  const r = await run(...a);
  if (block > 0 && a[5]) {
    block--;
    return { ...r, state: 'blocked', exit_code: null, log: '', reason: 'Error: Isolation unavailable: this reviewed backend requires Windows + WSL2' };
  }
  return r;
};
const api = createApi(process.env, { artifacts: new ArtifactSupervisor(products, exec) });
await new Promise((r) => api.server.listen(Number(process.env.CREATOR_API_PORT), '127.0.0.1', r));
await new Promise((r) => api.preview.listen(Number(process.env.CREATOR_PREVIEW_PORT), '127.0.0.1', r));
await api.ready();
const web = await createServer({ root: 'apps/web', configFile: 'apps/web/vite.config.ts' });
await web.listen();
console.log('ready (test-double executor)');
