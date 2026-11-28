// ADR-0133: the thesis AI-only run (docs/thesis/AI_ONLY_RUN_PROTOCOL.md). Its six held-out build
// tasks are frozen, load with the studio limits they were frozen with, and lift no build label;
// each reference solution meets every frozen expected result; each listed known failure (an exact
// edit of the reference, tests/fixtures/ai-run-mutants.json) fails every case it names; the
// structure bar passes the larger references; the protocol manifest holds; and the frozen outcome
// coding scores records as the protocol says. Runs the references with the local python3 (not
// isolation evidence). The records in the analysis tests are synthetic stand-ins, not results.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';
import {
  AI_RUN_TASK_IDS,
  MAX_BUILD_CASES,
  buildBlockers,
  RECIPE_BENCHMARK_IDS,
  RECIPE_BENCHMARK_INFO,
  RECIPE_BENCHMARKS,
  recipeQualificationMaxRequests,
} from '@creator/contracts';
import { frozenCases } from '@creator/domain';
import {
  loadRecipeBenchmark,
  packageStructureBar,
  recipeFreezeProblems,
} from '@creator/executor';
import {
  currentRolePromptHashes,
  firstBuilderInputFloor,
} from '../../apps/api/dist/recipe-qualification.js';
import { pythonScriptArgs } from './local-python.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const at = (p: string) => join(ROOT, p);
const json = (p: string) => JSON.parse(readFileSync(at(p), 'utf8')) as unknown;
const python = spawnSync('python3', ['--version']).status === 0;

interface Case {
  args: string[];
  stdin: string;
  stdout: string;
  exit_code: number;
  held_out?: boolean;
}
interface Expectations {
  attempts: number;
  scale: string;
  build_plan_caps: Record<string, number | string>;
  known_failure_cases: { id: string; caught_by: string[] }[];
  structure?: {
    entry: string;
    package: string;
    package_dir: string;
    modules: string[];
  };
}
function task(id: string) {
  const dir = `config/recipe-benchmarks/${id}`;
  const spec = json(`${dir}/spec.json`) as {
    content: { acceptance_checks: { key: string; cases: Case[] }[] };
  };
  const extended = (
    json(`${dir}/extended-cases.json`) as { cases: (Case & { id: string })[] }
  ).cases;
  const cases = new Map<string, Case>();
  for (const a of spec.content.acceptance_checks)
    a.cases.forEach((c, i) => cases.set(`${a.key}.${i + 1}`, c));
  for (const e of extended) cases.set(e.id, e);
  return {
    dir: at(dir),
    reference: at(`${dir}/reference`),
    cases,
    expectations: json(`${dir}/expectations.json`) as Expectations,
  };
}
function run(dir: string, c: Case) {
  const r = spawnSync(
    'python3',
    pythonScriptArgs(['-I', '-B'], 'src/main.py', c.args),
    {
      cwd: dir,
      input: c.stdin,
      encoding: 'utf8',
      timeout: 20_000,
    },
  );
  return r.stdout + r.stderr === c.stdout && r.status === c.exit_code;
}
function files(dir: string): { path: string; content: string }[] {
  const walk = (d: string): string[] =>
    readdirSync(d)
      .filter((n) => n !== '__pycache__')
      .flatMap((n) =>
        statSync(join(d, n)).isDirectory() ? walk(join(d, n)) : [join(d, n)],
      );
  return walk(dir)
    .sort()
    .map((f) => ({
      path: relative(dir, f).split('\\').join('/'),
      content: readFileSync(f, 'utf8'),
    }));
}
const MUTANTS = (
  json('tests/fixtures/ai-run-mutants.json') as {
    tasks: Record<string, Record<string, [string, string, string][]>>;
  }
).tasks;

test('ADR-0133: the six run tasks are frozen, intact, one attempt each, and load with their frozen limits', async () => {
  assert.equal(AI_RUN_TASK_IDS.length, 6);
  // The frozen run order: ascending SHA-256 of the id (protocol section 3).
  const { createHash } = await import('node:crypto');
  const key = (id: string) => createHash('sha256').update(id).digest('hex');
  assert.deepEqual(
    [...AI_RUN_TASK_IDS],
    [...AI_RUN_TASK_IDS].sort((a, b) => key(a).localeCompare(key(b))),
  );
  for (const id of AI_RUN_TASK_IDS) {
    assert.ok((RECIPE_BENCHMARK_IDS as readonly string[]).includes(id), id);
    assert.deepEqual(await recipeFreezeProblems(id), [], id);
    const b = await loadRecipeBenchmark(id);
    const info = RECIPE_BENCHMARK_INFO[id];
    assert.equal(info.attempts, 1, id);
    assert.equal(info.copied_from, null, id);
    assert.equal(info.recipe, 'python-build/1', id);
    assert.equal(b.extended.length, info.extended_cases, id);
    assert.equal(
      recipeQualificationMaxRequests(info),
      2 * info.caps.max_calls,
      id,
    );
    // The spec is buildable as the studio stores it, with synthetic data.
    assert.deepEqual(buildBlockers(b.content, 'T1', 'synthetic'), [], id);
    const studio = frozenCases(b.content, b.content.tasks[0]!.acceptance);
    assert.ok(studio.length <= MAX_BUILD_CASES, id);
    // Held-out discipline: every check has a held-out case, and most studio cases are held out.
    const held = studio.filter((c) => c.held_out).length;
    assert.ok(
      held * 2 > studio.length,
      `${id}: ${held} of ${studio.length} held out`,
    );
    for (const a of b.content.acceptance_checks)
      assert.ok(
        a.cases!.some((c) => c.held_out),
        `${id} ${a.key} has no held-out case`,
      );
    // Start can admit the first builder request under the 60,000 cap the run requires.
    assert.equal(info.min_input_chars, 60_000);
    assert.ok(firstBuilderInputFloor(b) < info.min_input_chars, id);
    assert.equal(b.structure !== null, info.scale === 'larger', id);
  }
});

test('ADR-0133: a pass on a run task lifts no build label', () => {
  for (const list of Object.values(RECIPE_BENCHMARKS))
    for (const id of AI_RUN_TASK_IDS)
      assert.ok(!(list as readonly string[]).includes(id), id);
});

test(
  'ADR-0133: each reference meets every frozen expected result',
  { skip: !python && 'python3 missing' },
  () => {
    for (const id of AI_RUN_TASK_IDS) {
      const t = task(id);
      for (const [label, c] of t.cases)
        assert.ok(run(t.reference, c), `${id} ${label}`);
    }
  },
);

test(
  'ADR-0133: each listed known failure fails every case it names',
  { skip: !python && 'python3 missing' },
  () => {
    for (const id of AI_RUN_TASK_IDS) {
      const t = task(id);
      const listed = t.expectations.known_failure_cases;
      assert.deepEqual(
        Object.keys(MUTANTS[id]!).sort(),
        listed.map((k) => k.id).sort(),
        `${id}: one mutant per listed known failure`,
      );
      for (const k of listed) {
        assert.ok(k.caught_by.length > 0, `${id} ${k.id}`);
        const tmp = mkdtempSync(join(tmpdir(), 'ai-run-'));
        try {
          cpSync(t.reference, tmp, { recursive: true });
          for (const [file, from, to] of MUTANTS[id]![k.id]!) {
            const p = join(tmp, 'src', file);
            const text = readFileSync(p, 'utf8');
            assert.equal(
              text.split(from).length,
              2,
              `${id} ${k.id}: edit applies once`,
            );
            writeFileSync(p, text.replace(from, to));
          }
          for (const label of k.caught_by) {
            const c = t.cases.get(label);
            assert.ok(c, `${id} ${k.id}: ${label} exists`);
            assert.ok(!run(tmp, c), `${id} ${k.id}: ${label} should fail`);
          }
        } finally {
          rmSync(tmp, { recursive: true, force: true });
        }
      }
    }
  },
);

test('ADR-0133: the structure bar passes the larger references and fails a missing module', () => {
  for (const id of AI_RUN_TASK_IDS) {
    const t = task(id);
    const rule = t.expectations.structure;
    if (!rule) continue;
    const ref = files(t.reference);
    assert.equal(packageStructureBar(ref, rule).passed, true, id);
    const gone = ref.filter(
      (f) => f.path !== `${rule.package_dir}/${rule.modules[0]}.py`,
    );
    assert.equal(packageStructureBar(gone, rule).passed, false, id);
  }
});

// ---- The protocol manifest and the frozen outcome coding ---------------------------------

const SCRIPT = at('scripts/ai-run-analysis.mjs');
const { verifyTaskFiles } = (await import(
  new URL('../../scripts/ai-run-analysis.mjs', import.meta.url).href
)) as { verifyTaskFiles: (id: string, root?: string) => string[] };
const manifest = json('config/thesis-ai-run/PROTOCOL.json') as {
  tasks: { id: string; scale: string; freeze_sha256: string }[];
  route: {
    model_id: string;
    builder_prompt_sha256: string;
    reviewer_prompt_sha256: string;
  };
};

test('ADR-0133: the protocol manifest holds and names the current tasks and role prompts', () => {
  const r = spawnSync('node', [SCRIPT, 'verify'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.deepEqual(
    manifest.tasks.map((t) => [t.id, t.scale]),
    AI_RUN_TASK_IDS.map((id) => [id, RECIPE_BENCHMARK_INFO[id].scale]),
  );
  const prompts = currentRolePromptHashes();
  assert.equal(
    manifest.route.builder_prompt_sha256,
    prompts.builder_prompt_sha256,
  );
  assert.equal(
    manifest.route.reviewer_prompt_sha256,
    prompts.reviewer_prompt_sha256,
  );
  assert.equal(manifest.route.model_id, 'gpt-6-astra');
});

let n = 0;
const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
/** A synthetic record in the studio's shape (RecipeQualificationRecord). */
function record(
  id: string,
  state: 'qualified' | 'not_qualified' | 'stopped',
  attempt: 'passed' | 'failed' | 'invalid' | null,
  extra: Record<string, unknown> = {},
) {
  const t = manifest.tasks.find((x) => x.id === id)!;
  const bars =
    attempt === 'passed'
      ? [
          'build_verified',
          'requests_within_cap',
          'package_verified',
          'extended_cases',
        ].map((key) => ({ key, passed: true, detail: '' }))
      : [
          { key: 'build_verified', passed: false, detail: '' },
          { key: 'requests_within_cap', passed: true, detail: '' },
        ];
  return {
    id: uuid(),
    workspace_id: uuid(),
    connection_id: RUN_CONNECTION,
    recipe: 'python-build/1',
    benchmark_id: id,
    model_id: 'gpt-6-astra',
    builder_prompt_sha256: manifest.route.builder_prompt_sha256,
    reviewer_prompt_sha256: manifest.route.reviewer_prompt_sha256,
    freeze_sha256: t.freeze_sha256,
    max_input_chars: 60000,
    source: 'in_app',
    fixture: false,
    state,
    attempts_needed: 1,
    passed: attempt === 'passed' ? 1 : 0,
    reason: null,
    evidence: null,
    attempts: attempt
      ? [
          {
            id: uuid(),
            slot: 1,
            replaces: null,
            state: attempt,
            reason: attempt === 'failed' ? 'QA failed' : null,
            product_id: null,
            build_id: null,
            request_limit: 6,
            requests: attempt === 'invalid' ? 1 : 2,
            repairs: attempt === 'invalid' ? null : 0,
            result:
              attempt === 'invalid'
                ? null
                : {
                    bars,
                    build_reason: null,
                    manifest_sha256: null,
                    archive_sha256: null,
                    extended:
                      attempt === 'passed'
                        ? { passed: 17, total: 17, failed: [] }
                        : null,
                    wall_ms: 60000,
                  },
            started_at: '2026-11-20T10:00:00.000Z',
            finished_at: '2026-11-20T10:01:00.000Z',
          },
        ]
      : [],
    executing: false,
    version: 1,
    created_by: uuid(),
    created_at: `2026-11-20T10:0${n % 10}:00.000Z`,
    finished_at: '2026-11-20T10:30:00.000Z',
    ...extra,
  };
}
const RUN_CONNECTION = 'c0000000-0000-4000-8000-000000000001';
const OPENED = '2026-11-19T12:00:00Z';
function analyze(
  records: unknown[],
  markdown = false,
  args: string[] = ['--opened', OPENED, '--connection', RUN_CONNECTION],
) {
  const dir = mkdtempSync(join(tmpdir(), 'ai-run-records-'));
  try {
    records.forEach((r, i) =>
      writeFileSync(
        join(dir, `record-${String(i).padStart(2, '0')}.json`),
        JSON.stringify(r),
      ),
    );
    const r = spawnSync(
      'node',
      [SCRIPT, 'analyze', dir, ...args, ...(markdown ? ['--markdown'] : [])],
      {
        encoding: 'utf8',
      },
    );
    return { status: r.status, out: r.stdout, err: r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('ADR-0133: outcome coding keeps every task in the denominator and the first verdict final', () => {
  const [loans, tickets, fares, shifts, grades] = manifest.tasks.map(
    (t) => t.id,
  );
  const stoppedFirst = record(tickets!, 'stopped', 'invalid', {
    created_at: '2026-11-20T09:00:00.000Z',
  });
  const restart = record(tickets!, 'qualified', 'passed', {
    created_at: '2026-11-20T11:00:00.000Z',
  });
  const r = analyze([
    record(loans!, 'qualified', 'passed'),
    stoppedFirst,
    restart,
    record(fares!, 'not_qualified', 'failed', {
      created_at: '2026-11-20T09:00:00.000Z',
    }),
    // A record after the decided one is ignored and reported, never a second chance.
    record(fares!, 'qualified', 'passed', {
      created_at: '2026-11-20T12:00:00.000Z',
    }),
    record(shifts!, 'stopped', null),
    record(grades!, 'qualified', 'passed'),
    // ai-run-recipe-v1 never ran.
  ]);
  assert.equal(r.status, 0, r.out + r.err);
  const res = JSON.parse(r.out) as {
    primary: {
      completed: number;
      of: number;
      small: { completed: number };
      larger: { completed: number };
    };
    tasks: {
      id: string;
      outcome: string;
      first_failed_bar: string | null;
      restarts?: number;
    }[];
    deviations: string[];
  };
  assert.deepEqual(res.primary.completed, 3);
  assert.equal(res.primary.of, 6);
  assert.equal(res.primary.larger.completed, 2);
  assert.equal(res.primary.small.completed, 1);
  assert.deepEqual(
    res.tasks.map((t) => t.outcome),
    [
      'completed',
      'completed',
      'not_completed',
      'no_verdict',
      'completed',
      'not_run',
    ],
  );
  assert.equal(res.tasks[1]!.restarts, 1);
  assert.equal(res.tasks[2]!.first_failed_bar, 'build_verified');
  assert.equal(res.deviations.length, 1);
  assert.match(
    res.deviations[0]!,
    /ai-run-fares-v1: 1 record\(s\) started after the decided one/,
  );
  const md = analyze([record(loans!, 'qualified', 'passed')], true);
  assert.match(
    md.out,
    /^Primary: 1 of 6 tasks completed \(small 0 of 3, larger 1 of 3\)\./,
  );
});

test('ADR-0133: records that break the protocol are refused before anything is scored', () => {
  const id = manifest.tasks[0]!.id;
  for (const [extra, problem] of [
    [{ freeze_sha256: 'a'.repeat(64) }, /is not the frozen/],
    [{ fixture: true }, /fixture connection/],
    [{ model_id: 'another-model' }, /model another-model/],
    [{ attempts_needed: 3 }, /3 attempts/],
    [{ max_input_chars: 24000 }, /input cap 24000/],
    // Review 1 L-5: an in-app record always carries a cap; a missing one is a problem.
    [{ max_input_chars: null }, /input cap null/],
    [
      { builder_prompt_sha256: 'b'.repeat(64) },
      /builder_prompt_sha256 is not the frozen/,
    ],
    [{ benchmark_id: 'p14-xl-v1' }, /not a task of this run/],
    [{ state: 'running' }, /still running/],
  ] as const) {
    const r = analyze([record(id, 'qualified', 'passed', extra)]);
    assert.equal(r.status, 1, JSON.stringify(extra));
    assert.match(r.out, problem);
  }
  const prompts = analyze([
    record(id, 'qualified', 'passed'),
    record(manifest.tasks[1]!.id, 'qualified', 'passed', {
      reviewer_prompt_sha256: 'c'.repeat(64),
    }),
  ]);
  assert.equal(prompts.status, 1);
  assert.match(prompts.out, /reviewer_prompt_sha256 is not the frozen/);
  // The window opening and the run connection are required, and the opening needs a zone.
  for (const args of [
    ['--connection', RUN_CONNECTION],
    ['--opened', OPENED],
    ['--opened', '2026-11-19T12:00:00', '--connection', RUN_CONNECTION],
  ]) {
    const r = analyze([record(id, 'qualified', 'passed')], false, args);
    assert.equal(r.status, 1, args.join(' '));
    assert.match(r.out, /--opened|--connection/);
  }
});

type Coded = {
  primary: { completed: number };
  tasks: { id: string; outcome: string; restarts?: number }[];
  deviations: string[];
};

test('ADR-0133 review 1 M-1: one restart only; a second restart is ignored, even when it passes', () => {
  const id = manifest.tasks[3]!.id;
  const at = (h: number) => ({
    created_at: `2026-11-21T${String(h).padStart(2, '0')}:00:00.000Z`,
  });
  const twoRestarts = analyze([
    record(id, 'stopped', 'invalid', at(9)),
    record(id, 'stopped', null, at(10)),
    record(id, 'qualified', 'passed', at(11)),
  ]);
  assert.equal(twoRestarts.status, 0, twoRestarts.out);
  const a = JSON.parse(twoRestarts.out) as Coded;
  assert.equal(a.tasks[3]!.outcome, 'no_verdict');
  assert.equal(a.primary.completed, 0);
  assert.deepEqual(a.deviations, [
    `${id}: 1 record(s) after the one allowed restart were ignored`,
  ]);
  const threeStops = JSON.parse(
    analyze([
      record(id, 'stopped', null, at(9)),
      record(id, 'stopped', null, at(10)),
      record(id, 'stopped', null, at(11)),
    ]).out,
  ) as Coded;
  assert.equal(threeStops.tasks[3]!.outcome, 'no_verdict');
  assert.equal(threeStops.deviations.length, 1);
  // One restart is allowed and is not a deviation.
  const one = JSON.parse(
    analyze([
      record(id, 'stopped', null, at(9)),
      record(id, 'not_qualified', 'failed', at(10)),
    ]).out,
  ) as Coded;
  assert.equal(one.tasks[3]!.outcome, 'not_completed');
  assert.equal(one.tasks[3]!.restarts, 1);
  assert.deepEqual(one.deviations, []);
});

test('ADR-0133 review 1 M-3 and L-7: records outside the window or on another connection are not part of the run', () => {
  const [loans, tickets, fares, shifts] = manifest.tasks.map((t) => t.id);
  const r = analyze([
    // Before the freeze merged: ignored, so loans counts from its in-window record.
    record(loans!, 'not_qualified', 'failed', {
      created_at: '2026-11-19T11:59:59.000Z',
    }),
    record(loans!, 'qualified', 'passed', {
      created_at: '2026-11-19T12:00:00.000Z',
    }),
    // The last instant of November 27 anywhere on Earth is still inside.
    record(tickets!, 'qualified', 'passed', {
      created_at: '2026-11-28T11:59:59.000Z',
    }),
    // After the window: ignored, so the task is not run.
    record(fares!, 'qualified', 'passed', {
      created_at: '2026-12-25T10:00:00.000Z',
    }),
    // A start on another connection (a test on the installed app, say): ignored.
    record(shifts!, 'qualified', 'passed', {
      connection_id: 'c0000000-0000-4000-8000-000000000002',
      model_id: 'another-model',
    }),
  ]);
  assert.equal(r.status, 0, r.out);
  const res = JSON.parse(r.out) as Coded;
  assert.deepEqual(
    res.tasks.slice(0, 4).map((t) => t.outcome),
    ['completed', 'completed', 'not_run', 'not_run'],
  );
  assert.equal(res.primary.completed, 2);
  assert.equal(res.deviations.length, 3);
  assert.match(res.deviations.join('\n'), /before the window opened/);
  assert.match(res.deviations.join('\n'), /after the window closed/);
  assert.match(res.deviations.join('\n'), /is not part of the run/);
});

test('ADR-0133 review 1 L-6: verify checks every frozen task file and refuses added ones', () => {
  const id = manifest.tasks[5]!.id;
  const root = mkdtempSync(join(tmpdir(), 'ai-run-verify-'));
  try {
    cpSync(
      join(ROOT, 'config/recipe-benchmarks', id),
      join(root, 'config/recipe-benchmarks', id),
      { recursive: true },
    );
    cpSync(
      join(ROOT, 'packages/executor/src'),
      join(root, 'packages/executor/src'),
      { recursive: true },
    );
    assert.deepEqual(verifyTaskFiles(id, root), []);
    const spec = join(root, 'config/recipe-benchmarks', id, 'spec.json');
    writeFileSync(spec, readFileSync(spec, 'utf8') + ' ');
    writeFileSync(
      join(root, 'config/recipe-benchmarks', id, 'reference/extra.py'),
      '',
    );
    const problems = verifyTaskFiles(id, root);
    assert.ok(
      problems.some((p) => /spec\.json changed/.test(p)),
      problems.join(),
    );
    assert.ok(
      problems.some((p) => /extra\.py is not frozen/.test(p)),
      problems.join(),
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
