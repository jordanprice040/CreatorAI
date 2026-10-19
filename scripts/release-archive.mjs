import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';

// X10 reproducibility package for one exact commit.
//   --build <commit> <new-dir>   git archive -> creator-agent-<commit>.tar + MANIFEST.json
//   --verify <dir>               re-reads the tar: every file's sha256 and Git blob id match the
//                                manifest, nothing extra or missing, tar hash matches, and (when
//                                this checkout has the commit) blob ids match `git ls-tree`
//   --extract <dir> <new-dir>    verified extraction, for a clean install/build/check
const sha256 = (b) => createHash('sha256').update(b).digest('hex');
const blobId = (b) =>
  createHash('sha1').update(`blob ${b.length}\0`).update(b).digest('hex');
const git = (args, opts = {}) =>
  execFileSync('git', args, { windowsHide: true, maxBuffer: 1 << 30, ...opts });

/** Minimal reader for the ustar/pax archives `git archive` writes. */
export function readTar(bytes) {
  const files = [];
  let comment = null;
  let longName = null;
  for (let off = 0; off + 512 <= bytes.length;) {
    const h = bytes.subarray(off, off + 512);
    if (h.every((x) => x === 0)) break;
    const str = (a, n) =>
      h
        .subarray(a, a + n)
        .toString('utf8')
        .replace(/\0.*$/s, '');
    const size = parseInt(str(124, 12).trim() || '0', 8);
    const type = String.fromCharCode(h[156] || 48);
    const prefix = str(345, 155);
    const body = bytes.subarray(off + 512, off + 512 + size);
    off += 512 + Math.ceil(size / 512) * 512;
    if (type === 'g' || type === 'x') {
      const text = body.toString('utf8');
      for (const m of text.matchAll(/^\d+ ([^=]+)=(.*)$/gm)) {
        if (type === 'g' && m[1] === 'comment') comment = m[2];
        if (type === 'x' && m[1] === 'path') longName = m[2];
      }
      continue;
    }
    const path =
      longName ?? (prefix ? `${prefix}/${str(0, 100)}` : str(0, 100));
    longName = null;
    if (type === '5') continue;
    assert.ok(type === '0', `Refuse non-regular entry (${type}): ${path}`);
    assert.ok(
      !path.startsWith('/') &&
        !path.split('/').includes('..') &&
        !path.includes('\\'),
      `Refuse unsafe path: ${path}`,
    );
    files.push({ path, bytes: Buffer.from(body) });
  }
  return { comment, files };
}

function verify(dir) {
  const manifest = JSON.parse(readFileSync(join(dir, 'MANIFEST.json'), 'utf8'));
  assert.equal(manifest.schema, 'release-archive/1');
  const tarBytes = readFileSync(join(dir, manifest.tar));
  assert.equal(sha256(tarBytes), manifest.tar_sha256, 'Tar hash differs');
  const { comment, files } = readTar(tarBytes);
  assert.equal(comment, manifest.commit, 'Tar is not from the manifest commit');
  const want = new Map(manifest.files.map((f) => [f.path, f]));
  assert.equal(want.size, manifest.files.length, 'Duplicate manifest path');
  for (const f of files) {
    const m = want.get(f.path);
    assert.ok(m, `File not in manifest: ${f.path}`);
    assert.equal(sha256(f.bytes), m.sha256, `sha256 differs: ${f.path}`);
    assert.equal(blobId(f.bytes), m.blob, `Git blob differs: ${f.path}`);
    want.delete(f.path);
  }
  assert.equal(
    want.size,
    0,
    `Missing from tar: ${[...want.keys()].slice(0, 5)}`,
  );
  let tree = 'not checked (commit not in this checkout)';
  try {
    const rows = git(['ls-tree', '-r', manifest.commit], { encoding: 'utf8' })
      .trim()
      .split('\n')
      .map((r) => r.split('\t'))
      .map(([meta, path]) => [path, meta.split(' ')[2]]);
    const blobs = new Map(manifest.files.map((f) => [f.path, f.blob]));
    assert.equal(rows.length, blobs.size, 'File count differs from the commit');
    for (const [path, blob] of rows)
      assert.equal(blobs.get(path), blob, `Commit blob differs: ${path}`);
    tree = 'matches git ls-tree';
  } catch (e) {
    if (e instanceof assert.AssertionError) throw e;
  }
  console.log(
    `Verified ${files.length} files of ${manifest.commit}; tar sha256 ${manifest.tar_sha256}; ${tree}.`,
  );
  return { manifest, files };
}

const [mode, a, b] = process.argv.slice(2);
if (mode === '--build') {
  assert.ok(a && b, 'Usage: --build <commit> <new-dir>');
  const out = resolve(b);
  assert.ok(!existsSync(out), 'Use a new output directory');
  const commit = git(['rev-parse', '--verify', `${a}^{commit}`], {
    encoding: 'utf8',
  }).trim();
  const tar = git(['archive', '--format=tar', commit]);
  const { comment, files } = readTar(tar);
  assert.equal(comment, commit);
  mkdirSync(out, { recursive: true });
  const name = `creator-agent-${commit.slice(0, 12)}.tar`;
  writeFileSync(join(out, name), tar);
  writeFileSync(
    join(out, 'MANIFEST.json'),
    `${JSON.stringify(
      {
        schema: 'release-archive/1',
        commit,
        tree: git(['rev-parse', `${commit}^{tree}`], {
          encoding: 'utf8',
        }).trim(),
        tar: name,
        tar_sha256: sha256(tar),
        files: files
          .map((f) => ({
            path: f.path,
            bytes: f.bytes.length,
            sha256: sha256(f.bytes),
            blob: blobId(f.bytes),
          }))
          .sort((x, y) => x.path.localeCompare(y.path)),
      },
      null,
      2,
    )}\n`,
  );
  verify(out);
} else if (mode === '--verify') {
  assert.ok(a, 'Usage: --verify <dir>');
  verify(resolve(a));
} else if (mode === '--extract') {
  assert.ok(a && b, 'Usage: --extract <dir> <new-dir>');
  const out = resolve(b);
  assert.ok(!existsSync(out), 'Use a new output directory');
  const { files } = verify(resolve(a));
  for (const f of files) {
    const target = resolve(out, f.path);
    assert.ok(target.startsWith(out + sep), `Refuse escape: ${f.path}`);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, f.bytes);
  }
  console.log(`Extracted ${files.length} files into ${out}`);
} else {
  console.error(
    'Usage: node scripts/release-archive.mjs --build <commit> <new-dir> | --verify <dir> | --extract <dir> <new-dir>',
  );
  process.exit(2);
}
