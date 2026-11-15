import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { loadWeb } from './web-module.js';

// The licence list's package walk (apps/web/src/package-root.ts, used by vite.config.ts). PR #212:
// on Windows it compared backslash paths, walked up to the drive root and failed the build with
// "ENOENT C:\package.json". These run the walk with both platforms' path rules.
type Walk = {
  packageRoot: (entry: string, p: typeof path.win32) => string;
  inNodeModules: (entry: string, p: typeof path.win32) => boolean;
};

test('the licence walk finds the package directory with Windows paths', async () => {
  const m = (await loadWeb('package-root.ts')) as Walk;
  const w = path.win32;
  const pnpm =
    'C:\\dev\\creator_agent\\node_modules\\.pnpm\\pdfjs-dist@6.5.438\\node_modules\\pdfjs-dist\\build\\pdf.mjs';
  assert.equal(m.inNodeModules(pnpm, w), true);
  assert.equal(
    m.packageRoot(pnpm, w),
    'C:/dev/creator_agent/node_modules/.pnpm/pdfjs-dist@6.5.438/node_modules/pdfjs-dist',
  );
  assert.equal(
    m.packageRoot('C:\\a\\node_modules\\@scope\\pkg\\dist\\deep\\index.js', w),
    'C:/a/node_modules/@scope/pkg',
  );
  // A UNC checkout too.
  assert.equal(
    m.packageRoot(
      '\\\\host\\share\\app\\node_modules\\jszip\\lib\\index.js',
      w,
    ),
    '//host/share/app/node_modules/jszip',
  );
  // A built-in resolves to its bare name and is skipped, not walked.
  assert.equal(m.inNodeModules('util', w), false);
  // No package above the entry: a clear error, never a read at the drive root.
  assert.throws(
    () => m.packageRoot('C:\\a\\node_modules\\stray.js', w),
    /No package directory above C:\\a\\node_modules\\stray\.js/,
  );
});

test('the licence walk finds the package directory with POSIX paths', async () => {
  const m = (await loadWeb('package-root.ts')) as Walk;
  const p = path.posix as unknown as typeof path.win32;
  assert.equal(
    m.packageRoot('/srv/app/node_modules/.pnpm/x@1/node_modules/x/lib/a.js', p),
    '/srv/app/node_modules/.pnpm/x@1/node_modules/x',
  );
  // A backslash is an ordinary character in a POSIX name, so it is kept as it is.
  assert.equal(
    m.packageRoot('/srv/a\\b/node_modules/y/index.js', p),
    '/srv/a\\b/node_modules/y',
  );
  assert.equal(m.inNodeModules('/srv/app/src/x.js', p), false);
  assert.throws(() => m.packageRoot('/node_modules/stray.js', p), /No package/);
});
