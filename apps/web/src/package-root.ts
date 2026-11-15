import type { PlatformPath } from 'node:path';

// Build-time helpers for the third-party licence list in vite.config.ts. They live here, not in
// the config, so a Node test can run them with Windows and POSIX path rules on any machine. The
// web app itself never imports this module.

/** The package directory a forward-slash path sits in under node_modules, or null. */
export function rootOf(id: string): string | null {
  const i = id.lastIndexOf('/node_modules/');
  if (i < 0) return null;
  const rest = id.slice(i + 14).split('/');
  const n = rest[0]?.startsWith('@') ? 2 : 1;
  return id.slice(0, i + 14) + rest.slice(0, n).join('/');
}

/**
 * The directory, in forward slashes, of the package whose resolved entry file is `entry`
 * (a native path for the platform `path` describes). Throws when no package directory is found
 * above it, so the licence list never silently drops a package or reads a drive root.
 */
export function packageRoot(
  entry: string,
  path: Pick<PlatformPath, 'dirname' | 'sep'>,
): string {
  const file = entry.split(path.sep).join('/');
  let d = path.dirname(file);
  while (rootOf(`${d}/x`) !== d) {
    const up = path.dirname(d);
    if (up === d) throw new Error(`No package directory above ${entry}.`);
    d = up;
  }
  return d;
}

/** Whether a resolved entry path (native separators) lies under node_modules. */
export function inNodeModules(
  entry: string,
  path: Pick<PlatformPath, 'sep'>,
): boolean {
  return entry.split(path.sep).join('/').includes('/node_modules/');
}
