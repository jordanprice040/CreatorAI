// Frozen P14 grader, set repair-v1 (part of repair-v1/FREEZE.json). A copy of the v4 grader whose
// only change is the benchmark list below; it decides pass or fail, so any change to it is a new
// benchmark version. The CLI wrapper is scripts/p14-benchmark.mjs (--set repair-v1). B3 (build
// capability plan, 2026-11-14): a fair task with easy-to-miss rules, to observe a live repair round.
//
// Grading rules (mirror studio QA where it can, see packages/executor/worker/bridge.py, recipe.py):
// - Every .py file under the product is compiled first; a compile error fails every case.
// - Each case runs `python3 -I -B src/main.py <args>` from the product root with the case stdin.
// - stdout and stderr are merged in one log (the studio's systemd pipe does the same) and the log
//   must equal the expected stdout exactly; the exit code must match.
// - Limits inside the case: 10 s CPU, 64 open files, 8 MiB file size (as recipe.py), 20 s wall.
//   The studio's 256 MiB memory, 32 tasks and 50% CPU quota are systemd limits this grader does not
//   reproduce; the difference is part of the frozen rules.
// - Larger benchmark only: the structure check parses (never runs) the source.
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const BENCH_ROOT = dirname(fileURLToPath(import.meta.url));
export const FREEZE_FILE = join(BENCH_ROOT, 'FREEZE.json');
export const GRADER_FILE = fileURLToPath(import.meta.url);
export const BENCHMARKS = ['p14-repair-v1'];
const CASE_TIMEOUT_MS = 20000;

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
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
const rel = (root, p) => relative(root, p).split('\\').join('/');

/** Every file the freeze binds (both benchmark folders and this grader), with its SHA-256. */
export function frozenFiles() {
  const out = { 'grader.mjs': sha256(readFileSync(GRADER_FILE)) };
  for (const b of BENCHMARKS)
    for (const p of walk(join(BENCH_ROOT, b)))
      out[rel(BENCH_ROOT, p)] = sha256(readFileSync(p));
  return out;
}

/** Hash-only freeze check (needs no build). Empty when every frozen file is intact. */
export function freezeProblems() {
  if (!existsSync(FREEZE_FILE)) return ['FREEZE.json is missing'];
  const problems = [];
  const freeze = readJson(FREEZE_FILE);
  const now = frozenFiles();
  for (const [path, hash] of Object.entries(freeze.files))
    if (now[path] !== hash) problems.push(`${path} changed after the freeze`);
  for (const path of Object.keys(now))
    if (!(path in freeze.files))
      problems.push(`${path} was added after the freeze`);
  return problems;
}

export function loadBenchmark(id) {
  if (!BENCHMARKS.includes(id)) throw new Error(`Unknown benchmark ${id}`);
  const dir = join(BENCH_ROOT, id);
  const spec = readJson(join(dir, 'spec.json'));
  const extended = existsSync(join(dir, 'extended-cases.json'))
    ? readJson(join(dir, 'extended-cases.json')).cases
    : [];
  const cases = spec.content.acceptance_checks.flatMap((a) =>
    (a.cases ?? []).map((c, i) => ({ id: `${a.key}.${i + 1}`, ...c })),
  );
  return {
    dir,
    spec,
    cases,
    extended: extended.map((c) => ({ ...c, held_out: true })),
    expectations: readJson(join(dir, 'expectations.json')),
  };
}

// Runs inside the sandbox: compile check, or one case with merged output, limits and usage.
const CASE_WRAPPER = `
import json, pathlib, resource, subprocess, sys
mode = sys.argv[1]
if mode == 'compile':
    bad = []
    for p in sorted(pathlib.Path('.').rglob('*.py')):
        try:
            compile(p.read_bytes(), str(p), 'exec')
        except (SyntaxError, ValueError) as e:
            bad.append('%s: %s' % (p, e))
    sys.stdout.write('\\n'.join(bad))
    sys.exit(1 if bad else 0)
def limits():
    resource.setrlimit(resource.RLIMIT_CPU, (10, 10))
    resource.setrlimit(resource.RLIMIT_NOFILE, (64, 64))
    resource.setrlimit(resource.RLIMIT_FSIZE, (8 << 20, 8 << 20))
r = subprocess.run([sys.executable, '-I', '-B', 'src/main.py', *sys.argv[2:]],
                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, preexec_fn=limits,
                   env={'PATH': '/usr/bin:/bin', 'HOME': '/nonexistent'})
u = resource.getrusage(resource.RUSAGE_CHILDREN)
sys.stdout.buffer.write(r.stdout)
sys.stderr.write(json.dumps({'cpu_s': round(u.ru_utime + u.ru_stime, 3), 'max_rss_kb': u.ru_maxrss}))
sys.exit(r.returncode if r.returncode >= 0 else 128 - r.returncode)
`;

function runner(kind, productDir, python) {
  const dir = resolve(productDir);
  const argv = (extra) => ['-I', '-B', '-c', CASE_WRAPPER, ...extra];
  if (kind === 'direct')
    return (extra, input) =>
      spawnSync(python, argv(extra), {
        cwd: dir,
        input,
        env: {
          PATH: process.env.PATH ?? '/usr/bin:/bin',
          HOME: '/nonexistent',
        },
        timeout: CASE_TIMEOUT_MS,
        maxBuffer: 1 << 20,
      });
  return (extra, input) =>
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
        ...argv(extra),
      ],
      { input, timeout: CASE_TIMEOUT_MS, maxBuffer: 1 << 20 },
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

/** SHA-256 over the product's files (path and content), so a score names the exact package. */
export function treeHash(productDir) {
  const root = resolve(productDir);
  const h = createHash('sha256');
  for (const p of walk(root))
    h.update(`${rel(root, p)}\0${sha256(readFileSync(p))}\n`);
  return h.digest('hex');
}

/** Score a product directory (holding src/main.py) against a frozen benchmark. */
export function score(
  id,
  productDir,
  { kind = 'bwrap', python = 'python3' } = {},
) {
  const problems = freezeProblems();
  if (problems.length)
    throw new Error(`Refusing to score: ${problems.join('; ')}`);
  const b = loadBenchmark(id);
  const run = runner(kind, productDir, python);
  const compiled = run(['compile'], '');
  const compileError =
    compiled.status === 0
      ? null
      : (
          compiled.stdout?.toString() ||
          compiled.error?.message ||
          'compile failed'
        ).slice(0, 400);
  const one = (c) => {
    if (compileError)
      return {
        id: c.id,
        held_out: c.held_out,
        pass: false,
        error: 'compile failed',
      };
    const r = run(['case', ...c.args], c.stdin);
    const log = r.stdout?.toString() ?? '';
    let usage = null;
    try {
      usage = JSON.parse(r.stderr?.toString() || 'null');
    } catch {
      usage = null;
    }
    const pass = !r.error && r.status === c.exit_code && log === c.stdout;
    return {
      id: c.id,
      held_out: c.held_out,
      pass,
      exit_code: r.status,
      usage,
      ...(pass
        ? {}
        : {
            log: log.slice(0, 400),
            error:
              r.error?.message ??
              (usage ? undefined : r.stderr?.toString().slice(-400)),
          }),
    };
  };
  const build = b.cases.map(one);
  const extended = b.extended.map(one);
  let structure = null;
  if (b.spec.scale === 'larger') {
    const r = spawnSync(
      python,
      ['-I', '-c', STRUCTURE_CHECK, resolve(productDir)],
      {
        timeout: CASE_TIMEOUT_MS,
      },
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
  const all = [...build, ...extended];
  const usages = all.map((x) => x.usage).filter(Boolean);
  return {
    format: 'p14-score/2',
    benchmark_id: id,
    freeze_sha256: sha256(readFileSync(FREEZE_FILE)),
    grader_sha256: sha256(readFileSync(GRADER_FILE)),
    frozen_spec_sha256: sha256(readFileSync(join(b.dir, 'spec.json'))),
    product_tree_sha256: treeHash(productDir),
    runner: kind,
    compile_error: compileError,
    build: count(build),
    build_held_out: count(build.filter((x) => x.held_out)),
    extended: count(extended),
    structure,
    resources: {
      max_case_cpu_s: Math.max(0, ...usages.map((u) => u.cpu_s)),
      max_case_rss_kb: Math.max(0, ...usages.map((u) => u.max_rss_kb)),
    },
    pass: !compileError && all.every((x) => x.pass) && structureOk,
    failures: all.filter((x) => !x.pass),
  };
}

function canonical(v) {
  if (Array.isArray(v)) return v.map(canonical);
  if (v !== null && typeof v === 'object')
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, canonical(v[k])]),
    );
  return v;
}
/** The studio's spec content hash rule (packages/domain/src/rules.ts canonicalHash). */
export const canonicalHash = (v) => sha256(JSON.stringify(canonical(v)));

/**
 * Compare the spec stored in the studio with the frozen spec.json. `stored` is the studio's spec
 * record: { title, content_hash, body } where body is the stored `spec/1` body. The content hash
 * is recomputed (studio rule: canonicalHash({kind, title, body})), so the file must be the stored
 * version, and the body minus format/alternative/selection_id must equal the frozen content.
 */
export function compareSpec(id, stored) {
  const b = loadBenchmark(id);
  const problems = [];
  const { body, title, content_hash: hash } = stored ?? {};
  if (!body || typeof title !== 'string' || typeof hash !== 'string')
    return ['The stored spec needs title, content_hash and body'];
  if (canonicalHash({ kind: 'specification', title, body }) !== hash)
    problems.push(
      'content_hash does not match title and body: not the stored version',
    );
  const { format, alternative, selection_id, ...content } = body;
  if (format !== 'spec/1') problems.push('body format is not spec/1');
  if (!alternative || !selection_id)
    problems.push('body lacks alternative or selection_id');
  const want = JSON.stringify(canonical(b.spec.content));
  const got = JSON.stringify(canonical(content));
  if (want !== got) {
    for (const key of new Set([
      ...Object.keys(b.spec.content),
      ...Object.keys(content),
    ]))
      if (
        JSON.stringify(canonical(b.spec.content[key])) !==
        JSON.stringify(canonical(content[key]))
      )
        problems.push(`field ${key} differs from the frozen spec.json`);
  }
  return problems;
}
