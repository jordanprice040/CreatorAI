// F4 (ADR-0128): writes the update manifest (`creator-agent-update.json`) that goes beside the
// installer in a private GitHub release. The installed app refuses the installer unless its
// size and SHA-256 match this file. It only reads and hashes; it publishes nothing.
//
//   node apps/desktop/update-manifest.mjs <installer.exe> [--notes "text"] [--out <file>]
//
// The version comes from tauri.conf.json (it must be higher than the installed app's, and the
// release tag must be that version or v<version>); the commit from the staged bundle, which
// must have been built from a clean checkout; the database layout from the built migrations.
import { createHash } from 'node:crypto';
import {
  createReadStream,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MANIFEST_ASSET = 'creator-agent-update.json';
export const MANIFEST_FORMAT = 'creator-agent-update/1';
const here = dirname(fileURLToPath(import.meta.url));

export function safeInstallerName(n) {
  return (
    n.length <= 200 &&
    n.toLowerCase().endsWith('.exe') &&
    !n.startsWith('.') &&
    /^[A-Za-z0-9 ._-]+$/.test(n)
  );
}

async function sha256(path) {
  const h = createHash('sha256');
  for await (const chunk of createReadStream(path)) h.update(chunk);
  return h.digest('hex');
}

/** Builds the manifest; every input is explicit so tests need no build. */
export async function buildManifest({
  installer,
  version,
  bundle,
  schemaVersion,
  notes,
}) {
  if (!/^(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})\.(0|[1-9]\d{0,8})$/.test(version))
    throw new Error(`"${version}" is not a version like 1.2.3`);
  const name = basename(installer);
  if (!safeInstallerName(name))
    throw new Error(`"${name}" must be a plain .exe file name`);
  if (bundle.format !== 'creator-desktop-bundle/1')
    throw new Error('Unknown bundle manifest format');
  if (!/^[0-9a-f]{40}$/.test(bundle.source_commit))
    throw new Error('The bundle does not name its source commit');
  if (bundle.source_dirty)
    throw new Error(
      'The bundle was built with uncommitted changes; release builds come from a clean checkout',
    );
  if (!Number.isSafeInteger(schemaVersion) || schemaVersion < 1)
    throw new Error('Unknown database layout');
  if (notes !== undefined && [...notes].length > 4000)
    throw new Error('Notes are longer than 4000 characters');
  const size = statSync(installer).size;
  if (size < 1 || size > 1024 ** 3)
    throw new Error('The installer size is out of range');
  return {
    format: MANIFEST_FORMAT,
    version,
    schema_version: schemaVersion,
    source_commit: bundle.source_commit,
    built_at: bundle.built_at,
    installer: { name, size, sha256: await sha256(installer) },
    ...(notes ? { notes } : {}),
  };
}

async function main(argv) {
  const args = [...argv];
  const installer = args.shift();
  if (!installer)
    throw new Error(
      'Usage: node apps/desktop/update-manifest.mjs <installer.exe> [--notes "text"] [--out <file>]',
    );
  let notes;
  let out;
  while (args.length) {
    const flag = args.shift();
    if (flag === '--notes') notes = args.shift();
    else if (flag === '--out') out = args.shift();
    else throw new Error(`Unknown option ${flag}`);
  }
  const conf = JSON.parse(
    readFileSync(join(here, 'src-tauri/tauri.conf.json'), 'utf8'),
  );
  // The app reports its Cargo.toml version; the installer carries tauri.conf.json's.
  const cargo = /^version = "([^"]+)"/m.exec(
    readFileSync(join(here, 'src-tauri/Cargo.toml'), 'utf8'),
  )?.[1];
  if (cargo !== conf.version)
    throw new Error(
      `Cargo.toml says ${cargo}, tauri.conf.json says ${conf.version}; raise both to the release version`,
    );
  const bundle = JSON.parse(
    readFileSync(join(here, '.bundle/studio/bundle-manifest.json'), 'utf8'),
  );
  const { migrations } = await import(
    pathToFileURL(resolve(here, '../../packages/db/dist/migrations.js')).href
  );
  const manifest = await buildManifest({
    installer: resolve(installer),
    version: conf.version,
    bundle,
    schemaVersion: migrations.at(-1).version,
    notes,
  });
  const target = resolve(
    out ?? join(dirname(resolve(installer)), MANIFEST_ASSET),
  );
  writeFileSync(target, JSON.stringify(manifest, null, 2) + '\n');
  console.log(
    `wrote ${target}: ${manifest.version}, ${manifest.installer.name}, sha256 ${manifest.installer.sha256}`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
