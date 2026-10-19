import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const forbidden = (path) =>
  /(^|\/)(node_modules|dist|\.git|\.creator|private|raw-exports)(\/|$)/i.test(
    path,
  ) ||
  /(^|\/)(\.env(?:\..*)?|.*\.pem|.*\.key|session\.json|assignment-key\.json|reviewer-key\.private\.json)$/i.test(
    path,
  ) ||
  path.endsWith('.tsbuildinfo');
assert.equal(forbidden('config/evaluation.json'), false);
for (const path of [
  '.env.docker',
  'private/assignment-key.json',
  'x/session.json',
  'a/secret.pem',
]) {
  assert.equal(forbidden(path), true);
}
function files(root, prefix = '') {
  return readdirSync(join(root, prefix))
    .sort()
    .flatMap((name) => {
      const path = prefix ? `${prefix}/${name}` : name;
      const stat = lstatSync(join(root, path));
      assert.ok(!stat.isSymbolicLink(), `Refuse link: ${path}`);
      return stat.isDirectory() ? files(root, path) : [path];
    });
}
function verify(root) {
  const manifest = JSON.parse(
    readFileSync(join(root, 'MANIFEST.json'), 'utf8'),
  );
  const seen = new Set();
  for (const entry of manifest.files) {
    assert.ok(!seen.has(entry.path), 'Duplicate manifest path');
    seen.add(entry.path);
    assert.ok(
      !entry.path.includes('..') &&
        !entry.path.includes('\\') &&
        !entry.path.startsWith('/'),
    );
    assert.ok(!forbidden(entry.path), `Excluded path leaked: ${entry.path}`);
    assert.equal(
      sha(readFileSync(join(root, entry.path))),
      entry.sha256,
      entry.path,
    );
  }
  assert.deepEqual(
    files(root)
      .filter((p) => p !== 'MANIFEST.json')
      .sort(),
    [...seen].sort(),
  );
  console.log(
    `Verified ${seen.size} file hashes; no extra files or forbidden paths.`,
  );
}
const [mode, input, output] = process.argv.slice(2);
if (mode === '--verify') {
  verify(resolve(input));
} else {
  assert.equal(
    mode,
    '--build',
    'Usage: --build <clean-source> <new-output-dir> | --verify <extracted-root>',
  );
  const repo = resolve('.');
  const source = resolve(input);
  const out = resolve(output);
  assert.ok(
    out.startsWith(`${repo}\\`) || out.startsWith(`${repo}/`),
    'Output must be inside workspace',
  );
  assert.ok(!existsSync(out), 'Use a new output directory');
  const payload = join(out, 'payload');
  mkdirSync(payload, { recursive: true });
  const entries = [];
  const exclusions = [];
  const copy = (root, path, dest, origin) => {
    if (forbidden(path)) {
      exclusions.push(`${origin}:${path}`);
      return;
    }
    const bytes = readFileSync(join(root, path));
    assert.ok(
      !/sk-(?:proj-)?[A-Za-z0-9_-]{35,}/.test(bytes.toString('utf8')),
      `Potential provider secret: ${path}`,
    );
    const target = join(payload, dest);
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(join(root, path), target);
    const prior = entries.findIndex((e) => e.path === dest);
    if (prior !== -1) entries.splice(prior, 1);
    entries.push({
      path: dest,
      sha256: sha(bytes),
      bytes: bytes.length,
      origin,
    });
  };
  // Only tracked paths from the fixed source commit, never its generated runtime files.
  const tracked = execFileSync(
    'git',
    ['ls-tree', '-r', '3e9026f12d85d5eb6fd933e217176fae30be61c3'],
    { encoding: 'utf8', windowsHide: true },
  )
    .trim()
    .split('\n');
  for (const row of tracked) {
    const [metadata, path] = row.split('\t');
    if (
      /^(apps|packages|tests|scripts|config|context|agents|templates|docs|\.github\/workflows)\//.test(
        path,
      ) ||
      /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|tsconfig.*\.json|\.prettierrc\.json|\.node-version|\.gitignore|compose\.yaml|README\.md|PROJECT_CONTEXT\.md|PROMPT_LIBRARY\.md)$/.test(
        path,
      )
    ) {
      const bytes = readFileSync(join(source, path));
      const blob = createHash('sha1')
        .update(`blob ${bytes.length}\0`)
        .update(bytes)
        .digest('hex');
      assert.equal(
        blob,
        metadata.split(' ')[2],
        `Source differs from fixed commit: ${path}`,
      );
      copy(source, path, `source/${path}`, 'upstream:3e9026f');
    } else exclusions.push(`unselected:${path}`);
  }
  for (const path of [
    'docs/thesis',
    'tracking/evidence/t18',
    'tracking/evidence/t19',
  ]) {
    for (const child of files(join(repo, path))) {
      const full = `${path}/${child}`;
      if (
        /^tracking\/evidence\/t19\/(creator-agent-t19\.tar(?:\.sha256)?|release-validation\.json|archive-.*\.log)$/.test(
          full,
        ) ||
        /\/demo-output\/[^/]+\/input\//.test(full)
      ) {
        exclusions.push(`unselected:${full}`);
        continue;
      }
      copy(repo, full, `source/${full}`, 'T18/T19 evidence overlay');
    }
  }
  for (const path of [
    'tracking/BUILD_STATUS.md',
    'tracking/SESSION_HANDOFF.md',
    'tracking/DECISIONS.md',
    'docs/PILOT_AND_PROTOCOL.md',
    'scripts/t19-archive.mjs',
    'scripts/t19-rehearsal.mjs',
    'tests/src/artifact-cli.test.ts',
    'tests/src/workflow-api.test.ts',
  ]) {
    copy(repo, path, `source/${path}`, 'local documented overlay');
  }
  for (const path of [
    'tracking/evidence/t17/REQUIREMENTS_EVIDENCE.md',
    'tracking/evidence/t17/verification.json',
  ]) {
    copy(source, path, `source/${path}`, 'upstream:3e9026f');
  }
  writeFileSync(
    join(payload, 'MANIFEST.json'),
    `${JSON.stringify(
      {
        schema: 't19-archive/1',
        source_commit: '3e9026f12d85d5eb6fd933e217176fae30be61c3',
        study: 'proposed, unfrozen; empirical results unavailable',
        privacy:
          'No real participant data supplied; synthetic private keys and raw fixture inputs excluded. Source code can regenerate synthetic keys locally.',
        files: entries.sort((a, b) => a.path.localeCompare(b.path)),
        exclusions: exclusions.sort(),
      },
      null,
      2,
    )}\n`,
  );
  verify(payload);
  const archive = join(out, 'creator-agent-t19.tar');
  execFileSync('tar', ['-cf', archive, '-C', payload, '.'], {
    windowsHide: true,
  });
  writeFileSync(
    `${archive}.sha256`,
    `${sha(readFileSync(archive))}  creator-agent-t19.tar\n`,
  );
  const unpacked = join(out, 'readback');
  mkdirSync(unpacked);
  execFileSync('tar', ['-xf', archive, '-C', unpacked], { windowsHide: true });
  verify(unpacked);
  // Prove the readback check rejects a changed byte, then restore and reverify.
  const probe = manifestProbe(unpacked, entries[0].path);
  assert.throws(() => verify(unpacked));
  writeFileSync(probe.path, probe.bytes);
  verify(unpacked);
  console.log(`Archive created and read back: ${relative(repo, archive)}`);
}
function manifestProbe(root, path) {
  const full = join(root, path);
  const bytes = readFileSync(full);
  writeFileSync(full, Buffer.concat([bytes, Buffer.from('\nTAMPER-CHECK')]));
  return { path: full, bytes };
}
