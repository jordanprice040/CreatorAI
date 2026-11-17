import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// F4 (ADR-0128): the release script writes exactly the manifest the installed app parses
// (deny_unknown_fields on the Rust side), with the installer's real size and SHA-256, and
// refuses a bundle built from uncommitted changes.
type Build = (o: {
  installer: string;
  version: string;
  bundle: Record<string, unknown>;
  schemaVersion: number;
  notes?: string;
}) => Promise<Record<string, unknown> & { installer: Record<string, unknown> }>;
const script = (await import(
  pathToFileURL(resolve('apps/desktop/update-manifest.mjs')).href
)) as { buildManifest: Build; MANIFEST_FORMAT: string };
const example = JSON.parse(
  await readFile(
    resolve('apps/desktop/src-tauri/src/update-manifest-example.json'),
    'utf8',
  ),
) as Record<string, unknown> & { installer: Record<string, unknown> };
const bundle = {
  format: 'creator-desktop-bundle/1',
  built_at: '2026-11-17T10:00:00.000Z',
  source_commit: 'a'.repeat(40),
  source_dirty: false,
};

test('the update manifest has the app-readable shape and the installer hash', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'creator-update-manifest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const installer = join(dir, 'Creator Agent_0.2.0_x64-setup.exe');
  const bytes = Buffer.from('MZ installer bytes');
  await writeFile(installer, bytes);
  const m = await script.buildManifest({
    installer,
    version: '0.2.0',
    bundle,
    schemaVersion: 79,
    notes: 'Fixes',
  });
  assert.deepEqual(Object.keys(m).sort(), Object.keys(example).sort());
  assert.deepEqual(
    Object.keys(m.installer).sort(),
    Object.keys(example.installer).sort(),
  );
  assert.equal(m.format, script.MANIFEST_FORMAT);
  assert.equal(m.installer.size, bytes.length);
  assert.equal(
    m.installer.sha256,
    createHash('sha256').update(bytes).digest('hex'),
  );
  assert.equal(m.source_commit, 'a'.repeat(40));
  // No notes, no notes field (the app treats it as optional).
  const plain = await script.buildManifest({
    installer,
    version: '0.2.0',
    bundle,
    schemaVersion: 79,
  });
  assert.equal('notes' in plain, false);
});

test('the update manifest refuses dirty bundles, odd versions and unsafe names', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'creator-update-manifest-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const installer = join(dir, 'setup.exe');
  await writeFile(installer, 'MZ');
  const base = { installer, version: '0.2.0', bundle, schemaVersion: 79 };
  await assert.rejects(
    script.buildManifest({
      ...base,
      bundle: { ...bundle, source_dirty: true },
    }),
    /uncommitted changes/,
  );
  for (const version of ['0.2', 'v0.2.0', '0.02.0', '1.0.0-beta'])
    await assert.rejects(script.buildManifest({ ...base, version }), /version/);
  const odd = join(dir, 'setup;calc.exe');
  await writeFile(odd, 'MZ');
  await assert.rejects(
    script.buildManifest({ ...base, installer: odd }),
    /plain \.exe/,
  );
  const msi = join(dir, 'setup.msi');
  await writeFile(msi, 'MZ');
  await assert.rejects(
    script.buildManifest({ ...base, installer: msi }),
    /plain \.exe/,
  );
});
