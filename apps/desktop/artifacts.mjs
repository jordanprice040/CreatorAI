import { createHash, randomUUID } from 'node:crypto';
import { lstat, mkdir, open, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { BuildManifestSchema } from '../../packages/contracts/dist/index.js';
import { canonical } from '../../packages/executor/dist/files.js';
import { readTar } from '../../packages/executor/dist/tar.js';

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const MAX_ARCHIVE = 1024 * 1024;
const MAX_MANIFEST = 256 * 1024;

async function boundedRead(path, limit) {
  await canonical(path);
  const handle = await open(path, 'r');
  try {
    const stat = await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > limit)
      throw new Error('Expected a bounded, unlinked regular file');
    const buffer = Buffer.alloc(limit + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        length,
        buffer.length - length,
      );
      if (bytesRead === 0) break;
      length += bytesRead;
    }
    if (length > limit) throw new Error('File grew past limit');
    return buffer.subarray(0, length);
  } finally {
    await handle.close();
  }
}

/** Verify exact downloaded bytes against a separately obtained, scoped catalog identity. */
export function verifyArtifact(manifestBytes, archive, expected) {
  if (manifestBytes.length > MAX_MANIFEST || archive.length > MAX_ARCHIVE)
    throw new Error('Artifact input limit exceeded');
  if (
    !/^[a-f0-9]{64}$/.test(expected.manifest_sha256 ?? '') ||
    sha256(manifestBytes) !== expected.manifest_sha256
  )
    throw new Error('Manifest hash mismatch');
  const manifest = BuildManifestSchema.parse(
    JSON.parse(manifestBytes.toString('utf8')),
  );
  if (
    manifest.workspace_id !== expected.workspace_id ||
    manifest.id !== expected.artifact_id
  )
    throw new Error('Artifact scope mismatch');
  if (manifest.availability.source_archive.state !== 'available')
    throw new Error('Source archive unavailable');
  if (
    archive.length > MAX_ARCHIVE ||
    archive.length !== manifest.package.bytes ||
    sha256(archive) !== manifest.package.sha256
  )
    throw new Error('Archive hash or size mismatch');
  const files = readTar(archive);
  if (files.length !== manifest.package.files.length)
    throw new Error('File inventory mismatch');
  const inventory = new Map(
    manifest.package.files.map((file) => [file.path, file]),
  );
  if (inventory.size !== files.length)
    throw new Error('Duplicate manifest path');
  for (const file of files) {
    const declared = inventory.get(file.path);
    if (
      !declared ||
      file.content.length !== declared.bytes ||
      sha256(file.content) !== declared.sha256
    )
      throw new Error('File inventory mismatch');
  }
  return manifest;
}

/** Local owner-controlled cache only; no extraction, launch, authority, or offline mutations. */
export async function importArtifact({
  root,
  manifestPath,
  archivePath,
  expected,
}) {
  const manifestBytes = await boundedRead(manifestPath, MAX_MANIFEST);
  const archive = await boundedRead(archivePath, MAX_ARCHIVE);
  const manifest = verifyArtifact(manifestBytes, archive, expected);
  await canonical(root, true);
  await mkdir(root, { recursive: true, mode: 0o700 });
  await canonical(root);
  const temporary = join(root, `.pending-${randomUUID()}`);
  await mkdir(temporary, { mode: 0o700 });
  // A crash leaves a visibly pending directory, never a verified cache entry.
  const receipt = {
    format: 'desktop-artifact-cache/1',
    cached_at: new Date().toISOString(),
    workspace_id: manifest.workspace_id,
    artifact_id: manifest.id,
    manifest_sha256: expected.manifest_sha256,
    offline: 'read_only_snapshot',
    authorization: 'online_revalidation_required',
  };
  for (const [name, bytes] of [
    ['manifest.json', manifestBytes],
    ['source.tar', archive],
    ['receipt.json', Buffer.from(JSON.stringify(receipt, null, 2) + '\n')],
  ]) {
    const handle = await open(join(temporary, name), 'wx', 0o600);
    try {
      await handle.writeFile(bytes);
      await handle.sync();
    } finally {
      await handle.close();
    }
  }
  // Unique entry prevents clobbering existing files or a concurrent import.
  const destination = join(root, `${expected.manifest_sha256}-${randomUUID()}`);
  await rename(temporary, destination);
  return { directory: destination, receipt };
}

export async function inspectArtifact(directory, expected) {
  await canonical(directory);
  if (!(await lstat(directory)).isDirectory())
    throw new Error('Expected cache directory');
  const manifestBytes = await boundedRead(
    join(directory, 'manifest.json'),
    MAX_MANIFEST,
  );
  const archive = await boundedRead(join(directory, 'source.tar'), MAX_ARCHIVE);
  const manifest = verifyArtifact(manifestBytes, archive, expected);
  const receipt = JSON.parse(
    (await boundedRead(join(directory, 'receipt.json'), 4096)).toString('utf8'),
  );
  if (
    receipt.format !== 'desktop-artifact-cache/1' ||
    !Number.isFinite(Date.parse(receipt.cached_at)) ||
    receipt.workspace_id !== manifest.workspace_id ||
    receipt.artifact_id !== manifest.id ||
    receipt.manifest_sha256 !== expected.manifest_sha256
  )
    throw new Error('Cache receipt mismatch');
  return {
    manifest,
    cached_at: receipt.cached_at,
    offline: 'read_only_snapshot',
    authorization: 'online_revalidation_required',
  };
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const [command, root, manifestPath, archivePath, identityPath, ...extra] =
      process.argv.slice(2);
    if (command === 'inspect' && root && manifestPath && !archivePath) {
      const expected = JSON.parse(
        (await boundedRead(manifestPath, 4096)).toString('utf8'),
      );
      console.log(
        JSON.stringify(await inspectArtifact(root, expected), null, 2),
      );
    } else if (command === 'import' && identityPath && !extra.length) {
      const expected = JSON.parse(
        (await boundedRead(identityPath, 4096)).toString('utf8'),
      );
      console.log(
        JSON.stringify(
          await importArtifact({ root, manifestPath, archivePath, expected }),
          null,
          2,
        ),
      );
    } else {
      throw new Error(
        'Usage: node apps/desktop/artifacts.mjs import CACHE MANIFEST ARCHIVE EXPECTED_IDENTITY_JSON | inspect ENTRY EXPECTED_IDENTITY_JSON',
      );
    }
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : 'Artifact import failed',
    );
    process.exitCode = 1;
  }
}
