import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import {
  CLAIM_WORDS,
  analyze,
  renderAnalysis,
  type AnalysisFixture,
  type AnalysisInput,
} from '@creator/domain';

/**
 * File side of T16: reads an evaluation output folder (after reviewers return ratings.csv) and
 * writes standalone tables and figures. Only files listed here are read; each is hashed.
 */
export function loadAnalysisInput(dir: string): AnalysisInput {
  const root = resolve(dir);
  const sources: { path: string; sha256: string }[] = [];
  const text = (path: string) => {
    const bytes = readFileSync(join(root, path));
    sources.push({
      path: path.split(sep).join('/'),
      sha256: createHash('sha256').update(bytes).digest('hex'),
    });
    return bytes.toString('utf8');
  };
  const json = (path: string) => JSON.parse(text(path)) as unknown;
  const optional = (path: string) =>
    existsSync(join(root, path)) ? json(path) : undefined;
  const list = (path: string) =>
    existsSync(join(root, path)) ? readdirSync(join(root, path)).sort() : [];
  const input: AnalysisInput = {
    package: json('evaluation-package.json'),
    key: json(join('private', 'assignment-key.json')),
    exports: list(join('private', 'raw-exports'))
      .filter((f) => f.endsWith('.json'))
      .map((f) => ({
        key: f.slice(0, -'.json'.length),
        body: json(join('private', 'raw-exports', f)),
      })),
    ratings: list('reviewers')
      .filter((r) => existsSync(join(root, 'reviewers', r, 'ratings.csv')))
      .map((r) => ({
        reviewer: r,
        csv: text(join('reviewers', r, 'ratings.csv')),
      })),
    options: optional('analysis-options.json'),
    fixture: optional('FIXTURE.json'),
    sources,
  };
  input.sources.sort((a, b) => (a.path < b.path ? -1 : 1));
  return input;
}

function writeAll(dir: string, files: Record<string, string>) {
  for (const [name, body] of Object.entries(files)) {
    const path = join(dir, name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body);
  }
}

/** Analyzes an input folder twice from disk and writes the outputs; refuses to write into it. */
export function runAnalysis(inputDir: string, outDir: string) {
  const inRoot = resolve(inputDir);
  const outRoot = resolve(outDir);
  const rel = relative(inRoot, outRoot);
  if (!isAbsolute(rel) && !rel.startsWith('..'))
    throw new Error(
      'Write the analysis outside the evaluation folder so private/ and reviewers/ stay untouched.',
    );
  const first = analyze(loadAnalysisInput(inRoot));
  const second = analyze(loadAnalysisInput(inRoot));
  const files = renderAnalysis(first);
  const claimHits = Object.entries(files)
    .filter(([name]) => name !== 'analysis.json')
    .flatMap(([name, body]) => {
      const m = body.match(CLAIM_WORDS);
      return m ? [`${name}: "${m[0]}"`] : [];
    });
  const checks = [
    ...first.reconciliation,
    {
      id: 'reproducible.rerun_identical',
      status:
        first.analysis_hash === second.analysis_hash
          ? ('pass' as const)
          : ('fail' as const),
      detail: `Two analyses from the same files hash to ${first.analysis_hash.slice(0, 12)} and ${second.analysis_hash.slice(0, 12)}.`,
    },
    {
      id: 'claims.no_comparative_wording',
      status: claimHits.length ? ('fail' as const) : ('pass' as const),
      detail: claimHits.length
        ? claimHits.join(' ')
        : 'No inferential or superiority wording in any table, figure or report.',
    },
  ];
  writeAll(outRoot, files);
  return { analysis: first, files, checks };
}

/** Writes a fixture in the same file layout a T15 run leaves after reviewers return ratings. */
export function writeFixtureInput(dir: string, f: AnalysisFixture) {
  const files: Record<string, string> = {
    'FIXTURE.json': `${JSON.stringify(f.fixture, null, 2)}\n`,
    'evaluation-package.json': `${JSON.stringify(f.package, null, 2)}\n`,
    'private/assignment-key.json': `${JSON.stringify(f.key, null, 2)}\n`,
  };
  for (const e of f.exports)
    files[`private/raw-exports/${e.key}.json`] =
      `${JSON.stringify(e.body, null, 2)}\n`;
  for (const r of f.ratings)
    files[`reviewers/${r.reviewer}/ratings.csv`] = r.csv;
  if (f.options)
    files['analysis-options.json'] = `${JSON.stringify(f.options, null, 2)}\n`;
  writeAll(resolve(dir), files);
}
