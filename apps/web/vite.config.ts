import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { serviceConfig } from '@creator/domain';
const config = serviceConfig(process.env);

/**
 * ADR-0106: pdf.js reads character maps, the standard fonts and its image decoders from files
 * next to the app, never from a CDN. This copies them from the installed pdfjs-dist into the
 * build under /pdfjs/ and serves the same files in development. The scripting engine
 * (quickjs) is left out: the studio never runs a PDF's own scripts.
 */
function pdfjsAssets(): Plugin {
  const require = createRequire(import.meta.url);
  const root = dirname(require.resolve('pdfjs-dist/package.json'));
  const dirs = ['cmaps', 'iccs', 'standard_fonts', 'wasm'];
  const keep = (name: string) => !name.startsWith('quickjs');
  const files = () =>
    dirs.flatMap((d) =>
      readdirSync(join(root, d))
        .filter(keep)
        .map((f) => `${d}/${f}`),
    );
  return {
    name: 'creator-pdfjs-assets',
    configureServer(server) {
      server.middlewares.use('/pdfjs/', (req, res, next) => {
        // Only <dir>/<file> under those folders; nothing else is reachable.
        const [dir, name, ...rest] = (req.url ?? '')
          .split('?')[0]!
          .replace(/^\/+/, '')
          .split('/');
        if (
          rest.length ||
          !dir ||
          !name ||
          !dirs.includes(dir) ||
          !/^\w[\w.-]*$/.test(name) ||
          !keep(name)
        )
          return next();
        const file = join(root, dir, name);
        try {
          if (!statSync(file).isFile()) return next();
        } catch {
          return next();
        }
        res.setHeader(
          'Content-Type',
          name.endsWith('.wasm')
            ? 'application/wasm'
            : 'application/octet-stream',
        );
        createReadStream(file).pipe(res);
      });
    },
    generateBundle() {
      for (const f of files())
        this.emitFile({
          type: 'asset',
          fileName: `pdfjs/${f}`,
          source: readFileSync(join(root, f)),
        });
    },
  };
}

export default defineConfig({
  plugins: [pdfjsAssets()],
  server: {
    host: config.host,
    port: config.web_port,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${config.host}:${config.api_port}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: config.host,
    port: config.web_port,
    strictPort: true,
    proxy: {
      '/api': {
        target: `http://${config.host}:${config.api_port}`,
        changeOrigin: true,
      },
    },
  },
});
