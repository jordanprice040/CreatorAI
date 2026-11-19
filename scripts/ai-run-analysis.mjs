#!/usr/bin/env node
// ADR-0133: the thesis AI-only run's frozen check and analysis (docs/thesis/AI_ONLY_RUN_PROTOCOL.md).
//
//   node scripts/ai-run-analysis.mjs verify
//       Checks that the protocol manifest (config/thesis-ai-run/PROTOCOL.json) still names the
//       protocol text and every task freeze exactly as they are now. Exit 1 on any difference.
//
//   node scripts/ai-run-analysis.mjs freeze
//       Writes the manifest once (refuses to overwrite): the protocol text, this script, every
//       task's FREEZE.json and the build role prompts current in apps/api/dist (run pnpm
//       build:code first). A change after the freeze is a new protocol version.
//
//   node scripts/ai-run-analysis.mjs analyze <records-dir> [--markdown]
//       Reads every *.json file in <records-dir> as one studio build qualification record (the
//       JSON the studio returns for GET .../recipe-qualifications, one record per file), checks the
//       records against the frozen protocol, and prints the frozen outcome table. Exit 1 when the
//       records break the protocol (the problems are printed, and nothing is scored).
//
// The coding rules below are part of the frozen protocol: changing this file after the freeze
// changes its hash in PROTOCOL.json, and `verify` then fails. Nothing here runs a model or a build.
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const MANIFEST = join(ROOT, 'config/thesis-ai-run/PROTOCOL.json');
const sha = (b) => createHash('sha256').update(b).digest('hex');
const fileSha = (rel) => sha(readFileSync(join(ROOT, rel)));

export function loadManifest() {
  return JSON.parse(readFileSync(MANIFEST, 'utf8'));
}

/** Differences between the manifest and the files it names; empty when the freeze holds. */
export function verifyManifest(m = loadManifest()) {
  const problems = [];
  if (m.format !== 'thesis-ai-run-protocol/1')
    problems.push(`unknown manifest format ${m.format}`);
  for (const [rel, want] of Object.entries(m.files)) {
    let got = null;
    try {
      got = fileSha(rel);
    } catch {
      problems.push(`${rel} is missing`);
      continue;
    }
    if (got !== want) problems.push(`${rel} changed since the freeze`);
  }
  for (const t of m.tasks) {
    const rel = `config/recipe-benchmarks/${t.id}/FREEZE.json`;
    let got = null;
    try {
      got = fileSha(rel);
    } catch {
      problems.push(`${rel} is missing`);
      continue;
    }
    if (got !== t.freeze_sha256)
      problems.push(`${rel} changed since the freeze`);
  }
  return problems;
}

/**
 * The frozen coding of one task's records (see the protocol, "Outcome coding").
 * A record is decided when one of its attempts passed or failed (a verdict on the roles' work).
 * The first decided record is the task's result. A record with no decided attempt (stopped on an
 * infrastructure fault, or never got that far) counts toward the one allowed restart.
 */
function codeTask(task, records) {
  const mine = records
    .filter((r) => r.benchmark_id === task.id)
    .sort((a, b) => a.created_at.localeCompare(b.created_at));
  const decided = (r) =>
    r.attempts.some((a) => a.state === 'passed' || a.state === 'failed');
  const deviations = [];
  const first = mine.findIndex(decided);
  const before = first === -1 ? mine : mine.slice(0, first);
  if (before.length > 2)
    deviations.push(
      `${task.id}: ${before.length} records without a verdict; the protocol allows one restart`,
    );
  if (first !== -1 && mine.length > first + 1)
    deviations.push(
      `${task.id}: ${mine.length - first - 1} record(s) started after the decided one were ignored`,
    );
  if (first === -1) {
    return {
      id: task.id,
      scale: task.scale,
      outcome: mine.length ? 'no_verdict' : 'not_run',
      completed: false,
      record_id: mine.at(-1)?.id ?? null,
      reason: mine.at(-1)?.reason ?? null,
      deviations,
    };
  }
  const r = mine[first];
  const a = r.attempts.find(
    (x) => x.state === 'passed' || x.state === 'failed',
  );
  const bars = a.result?.bars ?? [];
  const firstFailed = bars.find((b) => !b.passed)?.key ?? null;
  return {
    id: task.id,
    scale: task.scale,
    outcome: r.state === 'qualified' ? 'completed' : 'not_completed',
    completed: r.state === 'qualified',
    record_id: r.id,
    restarts: first,
    requests: a.requests,
    repairs: a.repairs,
    wall_ms: a.result?.wall_ms ?? null,
    first_failed_bar: firstFailed,
    bars: Object.fromEntries(bars.map((b) => [b.key, b.passed])),
    extended: a.result?.extended
      ? { passed: a.result.extended.passed, total: a.result.extended.total }
      : null,
    package: a.result?.archive_sha256 ?? null,
    reason: a.reason ?? r.reason ?? null,
    deviations,
  };
}

/** Checks the records against the frozen run, then codes every task. */
export function analyze(records, m = loadManifest()) {
  const problems = [];
  const ids = new Set(m.tasks.map((t) => t.id));
  const run = records.filter((r) => ids.has(r.benchmark_id));
  for (const r of records)
    if (!ids.has(r.benchmark_id))
      problems.push(
        `record ${r.id} is for ${r.benchmark_id}, not a task of this run`,
      );
  for (const r of run) {
    const task = m.tasks.find((t) => t.id === r.benchmark_id);
    if (r.freeze_sha256 !== task.freeze_sha256)
      problems.push(
        `record ${r.id}: freeze ${r.freeze_sha256} is not the frozen ${task.id}`,
      );
    if (r.fixture) problems.push(`record ${r.id} ran on a fixture connection`);
    if (r.source !== 'in_app')
      problems.push(`record ${r.id} is not an in-app run`);
    if (r.recipe !== 'python-build/1')
      problems.push(`record ${r.id}: recipe ${r.recipe}`);
    if (r.attempts_needed !== 1)
      problems.push(
        `record ${r.id}: ${r.attempts_needed} attempts, the run has 1`,
      );
    if (
      r.max_input_chars !== null &&
      r.max_input_chars < m.route.min_input_chars
    )
      problems.push(
        `record ${r.id}: input cap ${r.max_input_chars} below ${m.route.min_input_chars}`,
      );
    if (r.model_id !== m.route.model_id)
      problems.push(
        `record ${r.id}: model ${r.model_id}, the protocol names ${m.route.model_id}`,
      );
    if (r.state === 'running') problems.push(`record ${r.id} is still running`);
    for (const key of ['builder_prompt_sha256', 'reviewer_prompt_sha256'])
      if (r[key] !== m.route[key])
        problems.push(`record ${r.id}: ${key} is not the frozen role prompt`);
  }
  // One connection and one pair of role prompts for the whole run.
  for (const key of [
    'connection_id',
    'builder_prompt_sha256',
    'reviewer_prompt_sha256',
  ]) {
    const values = new Set(run.map((r) => r[key]));
    if (values.size > 1)
      problems.push(`records differ in ${key}: ${[...values].join(', ')}`);
  }
  if (problems.length) return { ok: false, problems };
  const tasks = m.tasks.map((t) => codeTask(t, run));
  const count = (pred) => tasks.filter(pred).length;
  const byScale = (scale) => ({
    completed: count((t) => t.scale === scale && t.completed),
    of: count((t) => t.scale === scale),
  });
  const withPackage = tasks.filter((t) => t.extended);
  return {
    ok: true,
    protocol: m.protocol_id,
    primary: {
      completed: count((t) => t.completed),
      of: tasks.length,
      small: byScale('small'),
      larger: byScale('larger'),
    },
    secondary: {
      outcomes: Object.fromEntries(
        ['completed', 'not_completed', 'no_verdict', 'not_run'].map((o) => [
          o,
          count((t) => t.outcome === o),
        ]),
      ),
      requests: tasks.reduce((s, t) => s + (t.requests ?? 0), 0),
      repairs: tasks.reduce((s, t) => s + (t.repairs ?? 0), 0),
      wall_ms: tasks.reduce((s, t) => s + (t.wall_ms ?? 0), 0),
      extended_cases: {
        passed: withPackage.reduce((s, t) => s + t.extended.passed, 0),
        total: withPackage.reduce((s, t) => s + t.extended.total, 0),
        tasks_with_package: withPackage.length,
      },
    },
    tasks,
    deviations: tasks.flatMap((t) => t.deviations),
    route: {
      connection_id: run[0]?.connection_id ?? null,
      model_id: run[0]?.model_id ?? null,
      builder_prompt_sha256: run[0]?.builder_prompt_sha256 ?? null,
      reviewer_prompt_sha256: run[0]?.reviewer_prompt_sha256 ?? null,
    },
  };
}

export function markdown(res) {
  const minutes = (ms) =>
    ms === null || ms === undefined ? '-' : (ms / 60000).toFixed(1);
  const lines = [
    `Primary: ${res.primary.completed} of ${res.primary.of} tasks completed ` +
      `(small ${res.primary.small.completed} of ${res.primary.small.of}, ` +
      `larger ${res.primary.larger.completed} of ${res.primary.larger.of}).`,
    '',
    '| Task | Scale | Outcome | First failed bar | Requests | Repairs | Minutes | Extended cases |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |',
  ];
  for (const t of res.tasks)
    lines.push(
      `| ${t.id} | ${t.scale} | ${t.outcome} | ${t.first_failed_bar ?? '-'} | ` +
        `${t.requests ?? '-'} | ${t.repairs ?? '-'} | ${minutes(t.wall_ms)} | ` +
        `${t.extended ? `${t.extended.passed}/${t.extended.total}` : '-'} |`,
    );
  lines.push(
    '',
    `Requests ${res.secondary.requests}, repair rounds ${res.secondary.repairs}, ` +
      `build minutes ${minutes(res.secondary.wall_ms)}. Extended held-out cases ` +
      `${res.secondary.extended_cases.passed}/${res.secondary.extended_cases.total} over ` +
      `${res.secondary.extended_cases.tasks_with_package} packages.`,
  );
  if (res.deviations.length)
    lines.push('', 'Deviations:', ...res.deviations.map((d) => `- ${d}`));
  return lines.join('\n') + '\n';
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const [cmd, dir, flag] = process.argv.slice(2);
  if (cmd === 'freeze' && !dir) {
    if (existsSync(MANIFEST))
      throw new Error('Already frozen; write a new protocol version');
    const { currentRolePromptHashes } = await import(
      join(ROOT, 'apps/api/dist/recipe-qualification.js')
    );
    const { AI_RUN_TASK_IDS, RECIPE_BENCHMARK_INFO } = await import(
      join(ROOT, 'packages/contracts/dist/index.js')
    );
    const manifest = {
      format: 'thesis-ai-run-protocol/1',
      protocol_id: 'thesis-ai-only-run-v1',
      adr: 'ADR-0133',
      frozen_on: new Date().toISOString().slice(0, 10),
      files: Object.fromEntries(
        [
          'docs/thesis/AI_ONLY_RUN_PROTOCOL.md',
          'scripts/ai-run-analysis.mjs',
        ].map((f) => [f, fileSha(f)]),
      ),
      tasks: AI_RUN_TASK_IDS.map((id) => ({
        id,
        scale: RECIPE_BENCHMARK_INFO[id].scale,
        freeze_sha256: fileSha(`config/recipe-benchmarks/${id}/FREEZE.json`),
      })),
      route: {
        where:
          'dev studio (creator_studio), Models > ChatGPT plan connection > Qualify building',
        model_id: 'gpt-6-astra',
        min_input_chars: 60000,
        ...currentRolePromptHashes(),
        metered_usd: '0.00',
      },
      run_window_ends: '2026-11-27',
    };
    writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n');
    console.log(JSON.stringify({ frozen: manifest.protocol_id }));
  } else if (cmd === 'verify' && !dir) {
    const problems = verifyManifest();
    console.log(
      JSON.stringify({ frozen: problems.length === 0, problems }, null, 2),
    );
    process.exit(problems.length ? 1 : 0);
  } else if (cmd === 'analyze' && dir && (!flag || flag === '--markdown')) {
    const problems = verifyManifest();
    if (problems.length) {
      console.log(JSON.stringify({ ok: false, problems }, null, 2));
      process.exit(1);
    }
    const records = readdirSync(dir)
      .filter((f) => f.endsWith('.json'))
      .sort()
      .map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')));
    const res = analyze(records);
    if (!res.ok) {
      console.log(JSON.stringify(res, null, 2));
      process.exit(1);
    }
    process.stdout.write(
      flag ? markdown(res) : JSON.stringify(res, null, 2) + '\n',
    );
  } else {
    console.error(
      'usage: freeze | verify | analyze <records-dir> [--markdown]',
    );
    process.exit(2);
  }
}
