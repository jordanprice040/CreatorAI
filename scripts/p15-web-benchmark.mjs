#!/usr/bin/env node
// P15 static web benchmarks (ADR-0078). The grader is the studio's own reviewed checker,
// packages/executor/worker/web_recipe.py, frozen by hash with each benchmark version.
//
//   node scripts/p15-web-benchmark.mjs verify
//   node scripts/p15-web-benchmark.mjs score <benchmark-id> <product-dir> [--browser <dir>]
//   node scripts/p15-web-benchmark.mjs mutants <benchmark-id> [--browser <dir>]
//   node scripts/p15-web-benchmark.mjs freeze <benchmark-id>   (once; refuses to overwrite)
//
// `score` checks the browser with the bridge's own check, then runs generated pages in it inside
// the bridge's exact Bubblewrap list (Linux or WSL2); only the systemd unit is left out, and any
// host difference is reported as sandbox_deviations. <product-dir> holds site/. `--browser`
// defaults to the directory install_browser.py writes. `verify` needs
// `pnpm build:code` (it reads the spec schema from contracts/dist).
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  lstatSync,
  readdirSync,
  readlinkSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const DIR = join(ROOT, 'config/web-benchmarks');
export const CHECKER = join(ROOT, 'packages/executor/worker/web_recipe.py');
export const BENCHMARKS = ['p15-small-signup-v4'];
const BROWSER_VERSION = '156.0.8078.47';
export const DEFAULT_BROWSER = join(
  homedir(),
  '.local/share/creator-agent/browser',
  `chrome-headless-shell-${BROWSER_VERSION}`,
);
const sha = (b) => createHash('sha256').update(b).digest('hex');

function files(dir) {
  const out = [];
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...files(p));
    else out.push(p);
  }
  return out;
}
/** SHA-256 of every frozen file of a benchmark, and of the checker that grades it. */
export function hashes(id) {
  const base = join(DIR, id);
  const out = {};
  for (const f of files(base))
    if (relative(base, f) !== 'FREEZE.json')
      out[relative(base, f).replaceAll('\\', '/')] = sha(readFileSync(f));
  out['checker:web_recipe.py'] = sha(readFileSync(CHECKER));
  return out;
}
export function freezeProblems(id) {
  const path = join(DIR, id, 'FREEZE.json');
  if (!existsSync(path)) return [`${id}: not frozen`];
  const frozen = JSON.parse(readFileSync(path, 'utf8')).files;
  const now = hashes(id);
  const problems = [];
  for (const k of new Set([...Object.keys(frozen), ...Object.keys(now)]))
    if (frozen[k] !== now[k])
      problems.push(
        `${id}: ${k} ${!now[k] ? 'is missing' : !frozen[k] ? 'was added' : 'changed'} since the freeze`,
      );
  return problems;
}
export function load(id) {
  if (!BENCHMARKS.includes(id)) throw new Error(`Unknown benchmark ${id}`);
  const read = (f) => JSON.parse(readFileSync(join(DIR, id, f), 'utf8'));
  const spec = read('spec.json');
  const cases = spec.content.acceptance_checks.flatMap((a) =>
    a.browser_cases.map((c, i) => ({ id: `${a.key}.${i + 1}`, ...c })),
  );
  return { spec, cases, expectations: read('expectations.json') };
}
export async function verify() {
  const {
    SpecContentSchema,
    buildBlockers,
    taskRecipe,
    MAX_BUILD_CASES,
    RECIPE_BENCHMARKS,
  } = await import(
    pathToFileURL(join(ROOT, 'packages/contracts/dist/index.js')).href
  );
  const problems = [];
  // Review L-10: the version the studio qualifies against must be one published here.
  if (!BENCHMARKS.includes(RECIPE_BENCHMARKS['static-web/1']))
    problems.push(
      `RECIPE_BENCHMARKS names ${RECIPE_BENCHMARKS['static-web/1']}, which is not published`,
    );
  for (const id of BENCHMARKS) {
    problems.push(...freezeProblems(id));
    const b = load(id);
    const parsed = SpecContentSchema.safeParse(b.spec.content);
    if (!parsed.success) {
      problems.push(`${id}: spec does not match the studio's spec schema`);
      continue;
    }
    if (JSON.stringify(parsed.data) !== JSON.stringify(b.spec.content))
      problems.push(`${id}: spec changes when the studio parses it`);
    for (const t of parsed.data.tasks) {
      for (const msg of buildBlockers(parsed.data, t.key, 'synthetic'))
        problems.push(`${id} ${t.key}: ${msg}`);
      if (taskRecipe(parsed.data, t.key) !== 'static-web/1')
        problems.push(`${id} ${t.key}: does not build with static-web/1`);
    }
    if (b.cases.length > MAX_BUILD_CASES)
      problems.push(`${id}: more than ${MAX_BUILD_CASES} studio cases`);
    for (const m of b.expectations.known_failure_cases)
      for (const c of m.caught_by)
        if (!b.cases.some((x) => x.id === c))
          problems.push(`${id}: mutant ${m.id} names unknown case ${c}`);
  }
  return problems;
}

const BRIDGE_DIR = join(ROOT, 'packages/executor/worker');
/** Runs a function of the reviewed bridge (bridge.py) and returns its JSON result. */
function bridge(call, ...args) {
  const code = `import json, sys\nsys.path.insert(0, sys.argv[1])\nimport bridge\nprint(json.dumps(${call}))`;
  const r = spawnSync(
    '/usr/bin/python3',
    ['-I', '-c', code, BRIDGE_DIR, ...args],
    {
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  if (r.status !== 0)
    throw new Error(
      (r.stderr || r.error?.message || 'bridge call failed')
        .trim()
        .split('\n')
        .pop(),
    );
  return JSON.parse(r.stdout);
}
/** Every path a symlink chain passes through (Debian alternatives hop through /etc). */
function linkHops(path) {
  const hops = [path];
  for (let i = 0; i < 10 && lstatSync(path).isSymbolicLink(); i++) {
    path = resolve(dirname(path), readlinkSync(path));
    hops.push(path);
  }
  return hops;
}
/** The bridge's own browser check (owner, modes, symlinks, pinned tree hash). */
export function verifyBrowser(browser = DEFAULT_BROWSER) {
  bridge('str(bridge.verify_browser(sys.argv[2]))', browser);
}
/**
 * The bridge's exact Bubblewrap list for a web QA run (studio QA adds only the systemd unit).
 * One host difference is allowed and reported: where /usr/bin/python3 resolves outside /usr
 * (Debian alternatives), /etc/alternatives is bound read-only so the same interpreter starts.
 */
export function sandboxArgs(productDir, acceptance, browser = DEFAULT_BROWSER) {
  const args = bridge(
    'bridge.sandbox_args(bridge.WEB_POLICY, sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5])',
    resolve(productDir),
    CHECKER,
    browser,
    acceptance,
  );
  const deviations = [];
  if (linkHops('/usr/bin/python3').some((h) => !h.startsWith('/usr/'))) {
    args.splice(1, 0, '--ro-bind', '/etc/alternatives', '/etc/alternatives');
    deviations.push(
      '/etc/alternatives bound read-only (host python3 resolves through it)',
    );
  }
  return { args, deviations };
}
/** One case in the reviewed checker under the bridge's Bubblewrap list; the checker's result line. */
export function runCase(productDir, c, browser = DEFAULT_BROWSER) {
  const job = mkdtempSync(join(tmpdir(), 'p15-case-'));
  try {
    writeFileSync(
      join(job, 'acceptance.json'),
      JSON.stringify({ page: c.page, steps: c.steps }),
    );
    const { args } = sandboxArgs(
      productDir,
      join(job, 'acceptance.json'),
      browser,
    );
    const r = spawnSync(args[0], args.slice(1), {
      encoding: 'utf8',
      timeout: 70000,
    });
    let result = null;
    try {
      result = JSON.parse(r.stdout);
    } catch {
      result = {
        passed: false,
        reason: (r.stderr || r.error?.message || 'no result').slice(0, 300),
      };
    }
    return { exit_code: r.status, ...result };
  } finally {
    rmSync(job, { recursive: true, force: true });
  }
}
export function score(id, productDir, browser = DEFAULT_BROWSER) {
  const problems = freezeProblems(id);
  if (problems.length) throw new Error(`Freeze broken: ${problems.join('; ')}`);
  verifyBrowser(browser);
  const { cases } = load(id);
  const results = cases.map((c) => {
    const r = runCase(productDir, c, browser);
    return {
      id: c.id,
      held_out: c.held_out,
      passed: r.exit_code === 0 && r.passed === true,
      reason: r.reason ?? null,
      failed_step: r.steps?.find((s) => !s.passed) ?? null,
    };
  });
  const freeze = sha(readFileSync(join(DIR, id, 'FREEZE.json')));
  return {
    benchmark_id: id,
    freeze_sha256: freeze,
    checker_sha256: sha(readFileSync(CHECKER)),
    sandbox: 'bridge.py sandbox_args (WEB_POLICY), without the systemd unit',
    sandbox_deviations: sandboxArgs(productDir, '/dev/null', browser)
      .deviations,
    passed: results.filter((r) => r.passed).length,
    total: results.length,
    held_out_passed: results.filter((r) => r.held_out && r.passed).length,
    held_out_total: results.filter((r) => r.held_out).length,
    results,
  };
}
/** Each listed known failure, applied to the reference, must fail at least one case it names. */
export function mutants(id, browser = DEFAULT_BROWSER) {
  const { expectations } = load(id);
  return expectations.known_failure_cases.map((m) => {
    const dir = mkdtempSync(join(tmpdir(), 'p15-mutant-'));
    try {
      cpSync(join(DIR, id, 'reference'), dir, { recursive: true });
      for (const e of m.edits) {
        const file = join(dir, e.file);
        const text = readFileSync(file, 'utf8');
        if (!text.includes(e.find))
          return {
            id: m.id,
            caught: false,
            problem: `find text not in ${e.file}`,
          };
        writeFileSync(file, text.replace(e.find, e.replace));
      }
      const s = score(id, dir, browser);
      const failed = s.results.filter((r) => !r.passed).map((r) => r.id);
      // Review N-1: a hostile page must fail for its own reason, so a broken detector cannot
      // hide behind an unrelated failure such as a timeout.
      const caught = s.results.some(
        (r) =>
          !r.passed &&
          m.caught_by.includes(r.id) &&
          (!m.reason_contains || (r.reason ?? '').includes(m.reason_contains)),
      );
      return {
        id: m.id,
        caught,
        failed,
        reasons: Object.fromEntries(
          s.results.filter((r) => !r.passed).map((r) => [r.id, r.reason]),
        ),
      };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [cmd, id, dir] = process.argv.slice(2);
  const flag = process.argv.indexOf('--browser');
  const browser = flag > 0 ? process.argv[flag + 1] : DEFAULT_BROWSER;
  const print = (v) => console.log(JSON.stringify(v, null, 2));
  if (cmd === 'verify') {
    const p = await verify();
    print({ ok: !p.length, problems: p });
    process.exit(p.length ? 1 : 0);
  } else if (cmd === 'score') print(score(id, dir, browser));
  else if (cmd === 'mutants') print(mutants(id, browser));
  else if (cmd === 'freeze') {
    const path = join(DIR, id, 'FREEZE.json');
    if (existsSync(path))
      throw new Error('Already frozen; publish a new version');
    writeFileSync(
      path,
      JSON.stringify(
        {
          format: 'p15-web-benchmark-freeze/1',
          benchmark_id: id,
          files: hashes(id),
        },
        null,
        2,
      ) + '\n',
    );
    print({ frozen: id });
  } else {
    console.error(
      'usage: verify | score <id> <dir> | mutants <id> | freeze <id>',
    );
    process.exit(2);
  }
}
