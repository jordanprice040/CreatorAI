// Stages the installed studio's runtime resources (ADR-0041) into apps/desktop/.bundle/studio:
// node/node.exe, a single-file service bundle, the executor's worker bridge, config and the
// production UI. Uses only already-installed pinned tools (tsc, vite); no network.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const out = join(root, 'apps/desktop/.bundle/studio');
const step = (m) => console.log(`[bundle] ${m}`);
const node = (args, cwd = root) =>
  execFileSync(process.execPath, args, { cwd, stdio: 'inherit' });

step('compiling TypeScript');
node(['node_modules/typescript/bin/tsc', '-b']);
step('type-checking and building the production UI');
node(
  ['../../node_modules/typescript/bin/tsc', '--noEmit'],
  join(root, 'apps/web'),
);
const { build } = await import(
  new URL(
    'file:///' +
      join(root, 'node_modules/vite/dist/node/index.js').replaceAll('\\', '/'),
  )
);
await build({
  root: join(root, 'apps/web'),
  configFile: join(root, 'apps/web/vite.config.ts'),
  logLevel: 'warn',
});

rmSync(out, { recursive: true, force: true });
step('bundling the studio service');
await build({
  root,
  configFile: false,
  logLevel: 'warn',
  publicDir: false,
  ssr: { noExternal: true, target: 'node' },
  build: {
    ssr: join(root, 'apps/api/dist/studio-main.js'),
    outDir: join(out, 'service/app/dist'),
    emptyOutDir: true,
    minify: false,
    target: 'node22',
    // Relative `new URL(..., import.meta.url)` file reads keep the repository layout:
    // service/app/dist -> ../../../config and ../worker, staged below.
    assetsInlineLimit: 0,
    rolldownOptions: {
      external: ['pg-native'],
      output: {
        format: 'es',
        entryFileNames: 'studio.mjs',
        codeSplitting: false,
      },
    },
  },
});
const bundled = readFileSync(join(out, 'service/app/dist/studio.mjs'), 'utf8');
for (const ref of [
  '../../../config/spending.json',
  '../worker/bridge.py',
  '../worker/terminal.py',
])
  if (!bundled.includes(ref))
    throw new Error(`Bundle rewrote a runtime file reference: ${ref}`);

step('staging runtime, worker bridge, configuration and UI');
mkdirSync(join(out, 'node'), { recursive: true });
copyFileSync(process.execPath, join(out, 'node/node.exe'));
mkdirSync(join(out, 'service/app/worker'), { recursive: true });
for (const f of ['bridge.py', 'recipe.py', 'terminal.py'])
  copyFileSync(
    join(root, 'packages/executor/worker', f),
    join(out, 'service/app/worker', f),
  );
cpSync(join(root, 'config'), join(out, 'config'), { recursive: true });
cpSync(join(root, 'apps/web/dist'), join(out, 'web'), { recursive: true });

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
}
const git = (args) =>
  execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const manifest = {
  format: 'creator-desktop-bundle/1',
  built_at: new Date().toISOString(),
  source_commit: git(['rev-parse', 'HEAD']),
  source_dirty: git(['status', '--porcelain', '--untracked-files=no']) !== '',
  node_version: process.version,
  files: files(out).map((f) => {
    const bytes = readFileSync(f);
    return {
      path: relative(out, f).split(sep).join('/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
      bytes: statSync(f).size,
    };
  }),
};
writeFileSync(
  join(out, 'bundle-manifest.json'),
  JSON.stringify(manifest, null, 2) + '\n',
);
if (!existsSync(join(out, 'web/index.html')))
  throw new Error('UI missing from bundle');
step(
  `staged ${manifest.files.length} files from ${manifest.source_commit.slice(0, 12)}${manifest.source_dirty ? ' (uncommitted changes)' : ''} with Node ${process.version}`,
);
