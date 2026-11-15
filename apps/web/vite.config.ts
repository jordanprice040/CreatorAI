import { createReadStream, readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path, { dirname, join } from 'node:path';
import { defineConfig, type Plugin } from 'vite';
import { serviceConfig } from '@creator/domain';
import { inNodeModules, packageRoot, rootOf } from './src/package-root.js';
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
  // Review N-2: also its licence files (LICENSE_QUICKJS, LICENSE_PDFJS_QUICKJS).
  const keep = (name: string) => !/quickjs/i.test(name);
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

/** The studio's file-viewer libraries, always listed (some reach the build only as assets or workers). */
const VIEWER_PACKAGES = [
  'pdfjs-dist',
  'docx-preview',
  'xlsx',
  'jszip',
  'lowlight',
  'highlight.js',
];

/**
 * Review L-3: the licence of every package bundled into the web app, collected from the module
 * graph (plus the viewer libraries, which reach the build as assets or workers too) into
 * THIRD_PARTY_LICENSES.txt next to index.html, so the app and the installed app ship them.
 */
function thirdPartyLicenses(): Plugin {
  const require = createRequire(import.meta.url);
  return {
    name: 'creator-third-party-licenses',
    apply: 'build',
    generateBundle() {
      const roots = new Set<string>();
      for (const id of this.getModuleIds()) {
        const r = rootOf(id.replace(/\\/g, '/').split('?')[0]!);
        if (r) roots.add(r);
      }
      // The viewer libraries and, because some ship prebuilt bundles (JSZip carries pako), every
      // package they depend on.
      const walked = new Set<string>();
      const add = (name: string, from: NodeRequire) => {
        let entry: string;
        try {
          // Some packages do not export ./package.json: walk up from their entry instead.
          entry = from.resolve(name);
        } catch {
          return;
        }
        // A Node built-in (readable-stream's "util") is not a bundled package.
        if (!inNodeModules(entry, path)) return;
        // Forward slashes on every platform, so the walk also stops at the package on Windows.
        const d = packageRoot(entry, path);
        if (walked.has(d)) return;
        walked.add(d);
        roots.add(d);
        const deps = Object.keys(
          JSON.parse(readFileSync(join(d, 'package.json'), 'utf8'))
            .dependencies ?? {},
        );
        const req = createRequire(join(d, 'package.json'));
        for (const dep of deps) add(dep, req);
      };
      for (const p of VIEWER_PACKAGES) add(p, require);
      const blocks = new Map<string, string>();
      for (const root of roots) {
        let pkg: { name?: string; version?: string; license?: string };
        try {
          pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
        } catch {
          continue;
        }
        if (!pkg.name || pkg.name.startsWith('@creator/')) continue;
        const file = readdirSync(root).find((f) =>
          /^(licen[cs]e|copying)(\.|$)/i.test(f),
        );
        const text = file
          ? readFileSync(join(root, file), 'utf8').trim()
          : `Licence: ${pkg.license ?? 'not stated'} (no licence file in the package).`;
        blocks.set(
          `${pkg.name}@${pkg.version ?? ''}`,
          `${pkg.name} ${pkg.version ?? ''} (${pkg.license ?? 'licence not stated'})\n\n${text}`,
        );
      }
      const body = [...blocks.keys()]
        .sort()
        .map((k) => blocks.get(k))
        .join(`\n\n${'='.repeat(78)}\n\n`);
      this.emitFile({
        type: 'asset',
        fileName: 'THIRD_PARTY_LICENSES.txt',
        source: `Third-party software bundled with Creator Agent's web app.\n\n${'='.repeat(78)}\n\n${body}\n`,
      });
    },
  };
}

export default defineConfig({
  plugins: [pdfjsAssets(), thirdPartyLicenses()],
  worker: { format: 'es' },
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
