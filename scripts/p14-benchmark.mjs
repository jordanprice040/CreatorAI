#!/usr/bin/env node
// P14 repo benchmarks: check the frozen definitions and score a built package against them.
//
//   node scripts/p14-benchmark.mjs verify
//   node scripts/p14-benchmark.mjs score <benchmark-id> <product-dir> [--runner bwrap|direct] [--trusted]
//   node scripts/p14-benchmark.mjs freeze        (once per benchmark version; refuses to overwrite)
//
// `score` runs generated code. The default runner is Bubblewrap with no network and a read-only
// copy of the product (Linux or WSL2). `--runner direct` runs it without isolation and is
// refused unless `--trusted` is given: use it only for the reference solutions in this
// repository or inside a throwaway container, never on the studio host with real data.
// Needs `pnpm build:code` first (it reads the spec schema from packages/contracts/dist).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
} from 'node:fs';
import { join, relative, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const BENCH_ROOT = join(ROOT, 'config', 'repo-benchmarks');
export const FREEZE_FILE = join(BENCH_ROOT, 'FREEZE.json');
export const BENCHMARKS = [
  'p14-small-wordtally-v1',
  'p14-larger-ledgercheck-v1',
];
const CASE_TIMEOUT_MS = 20000;

const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const readJson = (p) => JSON.parse(readFileSync(p, 'utf8'));

function walk(dir) {
  return readdirSync(dir)
    .flatMap((name) => {
      const p = join(dir, name);
      if (name === '__pycache__') return [];
      return statSync(p).isDirectory() ? walk(p) : [p];
    })
    .sort();
}

/** Every file that the freeze binds, relative to config/repo-benchmarks, with its hash. */
export function frozenFiles() {
  const out = {};
  for (const b of BENCHMARKS)
    for (const p of walk(join(BENCH_ROOT, b)))
      out[relative(BENCH_ROOT, p).split('\\').join('/')] = sha256(
        readFileSync(p),
      );
  return out;
}

export function loadBenchmark(id) {
  if (!BENCHMARKS.includes(id)) throw new Error(`Unknown benchmark ${id}`);
  const dir = join(BENCH_ROOT, id);
  const spec = readJson(join(dir, 'spec.json'));
  const ext = existsSync(join(dir, 'extended-cases.json'))
    ? readJson(join(dir, 'extended-cases.json')).cases
    : [];
  const cases = spec.content.acceptance_checks.flatMap((a) =>
    (a.cases ?? []).map((c, i) => ({ id: `${a.key}.${i + 1}`, ...c })),
  );
  return {
    dir,
    spec,
    cases,
    extended: ext,
    expectations: readJson(join(dir, 'expectations.json')),
  };
}

/** Problems with the frozen definitions; empty when they are intact and buildable. */
export async function verify() {
  const { SpecContentSchema, buildBlockers, MAX_BUILD_CASES } = await import(
    join(ROOT, 'packages/contracts/dist/index.js')
  );
  const problems = [];
  if (!existsSync(FREEZE_FILE)) problems.push('FREEZE.json is missing');
  else {
    const freeze = readJson(FREEZE_FILE);
    const now = frozenFiles();
    for (const [path, hash] of Object.entries(freeze.files))
      if (now[path] !== hash) problems.push(`${path} changed after the freeze`);
    for (const path of Object.keys(now))
      if (!(path in freeze.files))
        problems.push(`${path} was added after the freeze`);
  }
  for (const id of BENCHMARKS) {
    const b = loadBenchmark(id);
    const parsed = SpecContentSchema.safeParse(b.spec.content);
    if (!parsed.success)
      problems.push(
        `${id}: spec does not match the studio's spec schema: ${parsed.error.message}`,
      );
    else
      for (const t of parsed.data.tasks)
        for (const msg of buildBlockers(parsed.data, t.key, 'synthetic'))
          problems.push(`${id} ${t.key}: ${msg}`);
    if (b.cases.length > MAX_BUILD_CASES)
      problems.push(`${id}: more than ${MAX_BUILD_CASES} build cases`);
    if (b.expectations.benchmark_id !== id || b.spec.benchmark_id !== id)
      problems.push(`${id}: benchmark id mismatch`);
  }
  return problems;
}

function runner(kind, productDir, python) {
  const dir = resolve(productDir);
  if (kind === 'direct')
    return (c) =>
      spawnSync(python, ['-I', '-B', 'src/main.py', ...c.args], {
        cwd: dir,
        input: c.stdin,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: '/nonexistent',
        },
        timeout: CASE_TIMEOUT_MS,
        maxBuffer: 1 << 20,
      });
  return (c) =>
    spawnSync(
      'bwrap',
      [
        '--unshare-all',
        '--die-with-parent',
        '--new-session',
        '--ro-bind',
        '/usr',
        '/usr',
        '--symlink',
        'usr/bin',
        '/bin',
        '--symlink',
        'usr/lib',
        '/lib',
        '--symlink',
        'usr/lib64',
        '/lib64',
        ...(existsSync('/etc/alternatives')
          ? ['--ro-bind', '/etc/alternatives', '/etc/alternatives']
          : []),
        '--proc',
        '/proc',
        '--dev',
        '/dev',
        '--tmpfs',
        '/tmp',
        '--ro-bind',
        dir,
        '/work',
        '--chdir',
        '/work',
        '--clearenv',
        '--setenv',
        'PATH',
        '/usr/bin:/bin',
        '--setenv',
        'HOME',
        '/nonexistent',
        '/usr/bin/python3',
        '-I',
        '-B',
        'src/main.py',
        ...c.args,
      ],
      { input: c.stdin, timeout: CASE_TIMEOUT_MS, maxBuffer: 1 << 20 },
    );
}

const STRUCTURE_CHECK = `
import ast, json, pathlib, sys
root = pathlib.Path(sys.argv[1])
out = {}
for name in ('parse', 'rules', 'report'):
    p = root / 'src' / 'ledger' / (name + '.py')
    tree = ast.parse(p.read_text()) if p.is_file() else None
    out[name] = bool(tree) and any(isinstance(n, ast.FunctionDef) for n in tree.body)
main = root / 'src' / 'main.py'
tree = ast.parse(main.read_text()) if main.is_file() else None
out['main_imports_ledger'] = bool(tree) and any(
    (isinstance(n, ast.ImportFrom) and (n.module or '').split('.')[0] == 'ledger') or
    (isinstance(n, ast.Import) and any(a.name.split('.')[0] == 'ledger' for a in n.names))
    for n in ast.walk(tree))
print(json.dumps(out))
`;

/** Score a product directory (holding src/main.py) against a frozen benchmark. */
export function score(
  id,
  productDir,
  { kind = 'bwrap', python = 'python3' } = {},
) {
  const b = loadBenchmark(id);
  const run = runner(kind, productDir, python);
  const one = (c) => {
    const r = run(c);
    const stdout = r.stdout?.toString() ?? '';
    const pass = !r.error && r.status === c.exit_code && stdout === c.stdout;
    return {
      id: c.id,
      held_out: c.held_out ?? true,
      pass,
      exit_code: r.status,
      ...(pass
        ? {}
        : {
            stdout: stdout.slice(0, 400),
            error:
              r.error?.message ??
              (r.stderr?.toString().slice(-400) || undefined),
          }),
    };
  };
  const build = b.cases.map(one);
  const extended = b.extended.map(one);
  let structure = null;
  if (b.spec.scale === 'larger') {
    // Parses (never runs) the candidate's source.
    const r = spawnSync(
      python,
      ['-I', '-c', STRUCTURE_CHECK, resolve(productDir)],
      { timeout: CASE_TIMEOUT_MS },
    );
    structure =
      r.status === 0
        ? JSON.parse(r.stdout.toString())
        : { error: r.stderr.toString().slice(0, 400) };
  }
  const count = (xs) => ({
    passed: xs.filter((x) => x.pass).length,
    total: xs.length,
  });
  const structureOk =
    structure === null ||
    (!structure.error && Object.values(structure).every(Boolean));
  return {
    format: 'p14-score/1',
    benchmark_id: id,
    frozen_spec_sha256: sha256(readFileSync(join(b.dir, 'spec.json'))),
    runner: kind,
    build: count(build),
    build_held_out: count(build.filter((x) => x.held_out)),
    extended: count(extended),
    structure,
    pass:
      build.every((x) => x.pass) &&
      extended.every((x) => x.pass) &&
      structureOk,
    failures: [...build, ...extended].filter((x) => !x.pass),
  };
}

async function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'verify') {
    const problems = await verify();
    for (const p of problems) console.error(`FAIL ${p}`);
    if (problems.length) process.exit(1);
    console.log(
      `OK ${BENCHMARKS.length} frozen benchmarks intact and buildable`,
    );
    return;
  }
  if (cmd === 'freeze') {
    if (existsSync(FREEZE_FILE))
      throw new Error(
        'FREEZE.json exists: a frozen version is never re-frozen; add a new benchmark version instead',
      );
    writeFileSync(
      FREEZE_FILE,
      JSON.stringify(
        {
          format: 'p14-benchmark-freeze/1',
          frozen_at: new Date().toISOString(),
          frozen_before_any_run: true,
          benchmarks: BENCHMARKS,
          files: frozenFiles(),
        },
        null,
        2,
      ) + '\n',
    );
    console.log('Frozen');
    return;
  }
  if (cmd === 'score') {
    const [id, dir, ...flags] = rest;
    if (!id || !dir)
      throw new Error(
        'usage: score <benchmark-id> <product-dir> [--runner bwrap|direct] [--trusted]',
      );
    const kind = flags.includes('--runner')
      ? flags[flags.indexOf('--runner') + 1]
      : 'bwrap';
    if (kind !== 'bwrap' && kind !== 'direct')
      throw new Error('runner is bwrap or direct');
    if (kind === 'direct' && !flags.includes('--trusted'))
      throw new Error(
        '--runner direct runs generated code without isolation; add --trusted only for the reference solutions or a throwaway container',
      );
    const result = score(id, dir, { kind });
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.pass ? 0 : 1);
  }
  throw new Error(
    'usage: verify | score <benchmark-id> <product-dir> | freeze',
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  main(process.argv.slice(2)).catch((e) => {
    console.error(e.message);
    process.exit(2);
  });
