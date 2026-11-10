// P16 (ADR-0080): the committed synthetic runbook bundle that an independent implementer
// consumes. `write` regenerates it from the synthetic fixture; `verify` (the default) checks
// that the committed files are exactly what the current code exports and that they validate
// from their bytes alone. Run after `pnpm build:code`. No database, model or network.
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  RUNBOOK_FIXTURE_INPUT,
  softwareRunbook,
  validateRunbook,
} from '../packages/domain/dist/index.js';

const root = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  'tracking',
  'evidence',
  'runbook-export',
  'synthetic-bundle',
);
const { files, manifest } = softwareRunbook(
  structuredClone(RUNBOOK_FIXTURE_INPUT),
);
async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(relative(root, p).split('\\').join('/'));
  }
  return out;
}
if (process.argv[2] === 'write') {
  await rm(root, { recursive: true, force: true });
  for (const f of files) {
    await mkdir(dirname(join(root, f.path)), { recursive: true });
    await writeFile(join(root, f.path), f.content);
  }
  console.log(
    `wrote ${files.length} files, bundle hash ${manifest.bundle_hash}`,
  );
} else {
  const onDisk = (await walk(root)).sort();
  const problems = [];
  const expected = files.map((f) => f.path).sort();
  if (JSON.stringify(onDisk) !== JSON.stringify(expected))
    problems.push('the committed file list differs from the export');
  const read = [];
  for (const f of files) {
    const content = await readFile(join(root, f.path)).catch(() => null);
    if (!content) continue;
    read.push({ path: f.path, content });
    if (!content.equals(f.content)) problems.push(`${f.path} differs`);
  }
  problems.push(...validateRunbook(read));
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error('Run: node scripts/p16-runbook-example.mjs write');
    process.exit(1);
  }
  console.log(
    `ok: ${files.length} committed files match the export, bundle hash ${manifest.bundle_hash}`,
  );
}
