import { readFile, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from '@creator/contracts';
import { browserResult } from './build.js';

/**
 * B3: what a build folder shows about a build, for the Build page's timeline, "Why did it
 * fail?" and results. Read only from the files the build writes as it goes (intent, admission,
 * call, candidate, refusal, review, QA, outcome), so a running build, a stopped one and one
 * left by a closed app read the same way and nothing new is recorded.
 *
 * Held-out cases stay hidden: a failed held-out case is named by its check only, never its
 * inputs, expected output or what the program printed. Owner-facing text is bounded.
 */
export const TEXT_MAX = 1500;
const cut = (s: string) =>
  s.length > TEXT_MAX
    ? `${s.slice(0, TEXT_MAX)}\n… (${s.length - TEXT_MAX} more characters)`
    : s;

const roleCall = z.object({ role: z.enum(['builder', 'reviewer']) });
const callOutcome = z.object({
  status: z.string(),
  reason_code: z.string().optional(),
});
const candidateFile = z.object({
  commit: z.string(),
  changed_files: z.array(z.string()),
  kept: z.boolean().optional(),
});
const refusedFile = z.object({
  reason: z.string(),
  details: z.array(z.string()),
});
const reviewFile = z.object({
  verdict: z.enum(['approve', 'changes_requested', 'blocked']),
  findings: z.array(z.string()),
});
const qaFile = z.object({
  check: z.record(z.string(), z.unknown()),
  execution: z.object({
    state: z.string(),
    log: z.string(),
    exit_code: z.number().nullable(),
    reason: z.string().nullable(),
  }),
  passed: z.boolean(),
  unfinished: z.boolean().optional(),
});

export type CaseFailure =
  | { index: number; check_key: string; held_out: true; unfinished: boolean }
  | {
      index: number;
      check_key: string;
      held_out: false;
      unfinished: boolean;
      kind: 'cli';
      args: string[];
      stdin: string;
      expected_stdout: string;
      expected_exit: number;
      actual_stdout: string;
      actual_exit: number | null;
      state: string;
      reason: string | null;
    }
  | {
      index: number;
      check_key: string;
      held_out: false;
      unfinished: boolean;
      kind: 'browser';
      page: string;
      steps: number;
      failed_step: { index: number; detail: string } | null;
      reason: string | null;
      page_errors: string[];
      outbound: string[];
      unsupported: string[];
      state: string;
    };

export interface BuildRound {
  round: number;
  builder: 'writing' | 'answered' | 'failed' | null;
  refused: { reason: string; details: string[] } | null;
  candidate: { files: string[]; kept: boolean } | null;
  reviewer: 'reading' | 'answered' | 'failed' | null;
  review: { verdict: string; findings: string[] } | null;
  tests: { ran: number; passed: number; failed: number; unfinished: number };
  failures: CaseFailure[];
}

export interface BuildProgress {
  route: 'plan_roles' | 'codex_plan' | 'broker';
  max_repairs: number;
  max_calls: number;
  cases: number;
  held_out: number;
  /** Requests counted against `max_calls` (role calls). */
  requests: number;
  /** Codex builder turns, counted apart from `max_calls` (0 on other routes). */
  codex_turns: number;
  approved: boolean;
  rounds: BuildRound[];
  /** While the build runs: the step it is on now and since when. */
  now: {
    step: 'approval' | 'builder' | 'reviewer' | 'testing' | 'deciding';
    round: number;
    /** 1-based case being tested. */
    case?: number;
    since: string;
  } | null;
}

interface Inputs {
  dir: string;
  /** Per plan case, whether it is held out (from the frozen spec). */
  heldOut: readonly boolean[];
  running: boolean;
}

/** Reads one build folder. Throws only when the intent is missing or unreadable. */
export async function readBuildProgress({
  dir,
  heldOut,
  running,
}: Inputs): Promise<BuildProgress> {
  const names = new Set(await readdir(dir));
  const json = async (name: string): Promise<unknown> =>
    JSON.parse(await readFile(join(dir, name), 'utf8'));
  const optional = async <T>(name: string, schema: z.ZodType<T>) => {
    if (!names.has(name)) return null;
    const r = schema.safeParse(await json(name).catch(() => null));
    return r.success ? r.data : null;
  };
  const when = async (name: string) =>
    (await stat(join(dir, name))).mtime.toISOString();
  const intent = z
    .object({
      plan: z.object({
        max_repairs: z.number(),
        max_calls: z.number(),
        cases: z.array(z.record(z.string(), z.unknown())),
        plan_roles: z.unknown().optional(),
        codex_plan_builder: z.unknown().optional(),
      }),
    })
    .parse(await json('intent.json'));
  const plan = intent.plan;
  const route = plan.plan_roles
    ? 'plan_roles'
    : plan.codex_plan_builder
      ? 'codex_plan'
      : 'broker';

  // Role requests in order: call-N for plan roles and the broker, codex-N for the Codex builder.
  type Call = {
    role: 'builder' | 'reviewer';
    done: boolean;
    ok: boolean;
    file: string;
  };
  const calls: Call[] = [];
  for (let n = 1; names.has(`call-${n}-intent.json`); n++) {
    const role = await optional(`call-${n}-intent.json`, roleCall);
    const out = await optional(`call-${n}-outcome.json`, callOutcome);
    calls.push({
      role: role?.role ?? 'builder',
      done: out !== null,
      ok: out?.status === 'succeeded',
      file: `call-${n}-intent.json`,
    });
  }
  // Rounds by cycle index, from whichever files the round left.
  let last = -1;
  for (const n of names) {
    const m =
      /^(?:candidate|refused|review|admission|codex)-(\d+)(?:-[a-z]+)?\.json$/.exec(
        n,
      ) ?? /^qa-(\d+)-\d+\.json$/.exec(n);
    if (m) last = Math.max(last, Number(m[1]));
  }
  // Builder calls mark rounds too (a round whose builder is still writing has no other file).
  const builderCalls = calls.filter((c) => c.role === 'builder');
  last = Math.max(last, builderCalls.length - 1);
  const rounds: BuildRound[] = [];
  let reviewerSeen = 0;
  for (let r = 0; r <= last; r++) {
    const refused = await optional(`refused-${r}.json`, refusedFile);
    const candidate = await optional(`candidate-${r}.json`, candidateFile);
    const review = await optional(`review-${r}.json`, reviewFile);
    let builder: BuildRound['builder'] = null;
    if (route === 'codex_plan') {
      if (names.has(`codex-${r}-intent.json`))
        builder = names.has(`codex-${r}-outcome.json`) ? 'answered' : 'writing';
    } else {
      const call = builderCalls[r];
      if (call)
        builder = !call.done ? 'writing' : call.ok ? 'answered' : 'failed';
    }
    // A reviewer call belongs to a round that has a candidate (refused rounds have none).
    let reviewer: BuildRound['reviewer'] = null;
    if (candidate) {
      const reviewerCalls = calls.filter((c) => c.role === 'reviewer');
      const call = reviewerCalls[reviewerSeen++];
      if (call)
        reviewer = !call.done ? 'reading' : call.ok ? 'answered' : 'failed';
    }
    const tests = { ran: 0, passed: 0, failed: 0, unfinished: 0 };
    const failures: CaseFailure[] = [];
    for (let i = 0; i < plan.cases.length; i++) {
      const qa = await optional(`qa-${r}-${i}.json`, qaFile);
      if (!qa) continue;
      tests.ran++;
      const unfinished = qa.unfinished === true;
      if (unfinished) tests.unfinished++;
      else if (qa.passed) tests.passed++;
      else tests.failed++;
      if (qa.passed) continue;
      failures.push(
        failureOf(i, plan.cases[i]!, qa, heldOut[i] ?? true, unfinished),
      );
    }
    rounds.push({
      round: r,
      builder,
      refused,
      candidate: candidate
        ? {
            files: candidate.changed_files.slice(0, 100),
            kept: candidate.kept === true,
          }
        : null,
      reviewer,
      review: review
        ? {
            verdict: review.verdict,
            findings: review.findings.slice(0, 20).map(cut),
          }
        : null,
      tests,
      failures,
    });
  }

  let now: BuildProgress['now'] = null;
  if (running && !names.has('outcome.json')) {
    const round = rounds.at(-1);
    const r = round?.round ?? 0;
    const lastCall = calls.at(-1);
    const latest = async (files: string[]) => {
      const times = await Promise.all(
        files.filter((f) => names.has(f)).map((f) => when(f)),
      );
      return times.sort().at(-1) ?? (await when('intent.json'));
    };
    if (!names.has('admission-0.json'))
      now = { step: 'approval', round: 0, since: await when('intent.json') };
    else if (lastCall && !lastCall.done)
      now = {
        step: lastCall.role === 'builder' ? 'builder' : 'reviewer',
        round: r,
        since: await when(lastCall.file),
      };
    else if (route === 'codex_plan' && round?.builder === 'writing')
      now = {
        step: 'builder',
        round: r,
        since: await when(`codex-${r}-intent.json`),
      };
    else if (round?.review && round.tests.ran < plan.cases.length)
      now = {
        step: 'testing',
        round: r,
        case: round.tests.ran + 1,
        since: await latest([
          `review-${r}.json`,
          ...plan.cases.map((_, i) => `qa-${r}-${i}.json`),
        ]),
      };
    else
      now = {
        step: 'deciding',
        round: r,
        since: await latest([
          lastCall?.file ?? 'intent.json',
          `refused-${r}.json`,
          `review-${r}.json`,
          ...plan.cases.map((_, i) => `qa-${r}-${i}.json`),
        ]),
      };
  }
  return {
    route,
    max_repairs: plan.max_repairs,
    max_calls: plan.max_calls,
    cases: plan.cases.length,
    held_out: heldOut.filter(Boolean).length,
    requests: calls.length,
    codex_turns:
      route === 'codex_plan'
        ? [...names].filter((n) => /^codex-\d+-intent\.json$/.test(n)).length
        : 0,
    approved: names.has('admission-0.json'),
    rounds,
    now,
  };
}

function failureOf(
  index: number,
  c: Record<string, unknown>,
  qa: z.infer<typeof qaFile>,
  held: boolean,
  unfinished: boolean,
): CaseFailure {
  const check_key = String(c.check_key ?? '');
  // Held out: the check only. Its inputs, expected output and the program's output stay hidden.
  if (held) return { index, check_key, held_out: true, unfinished };
  const e = qa.execution;
  if (Array.isArray(c.steps)) {
    const r = browserResult(e.log);
    const step = r?.steps.find((s) => !s.passed) ?? null;
    return {
      index,
      check_key,
      held_out: false,
      unfinished,
      kind: 'browser',
      page: String(c.page ?? ''),
      steps: c.steps.length,
      failed_step: step
        ? { index: step.index, detail: cut(step.detail) }
        : null,
      reason: r?.reason ? cut(r.reason) : e.reason ? cut(e.reason) : null,
      page_errors: (r?.page_errors ?? []).slice(0, 5).map(cut),
      outbound: (r?.outbound ?? []).slice(0, 5).map(cut),
      unsupported: (r?.unsupported ?? []).slice(0, 5).map(cut),
      state: e.state,
    };
  }
  return {
    index,
    check_key,
    held_out: false,
    unfinished,
    kind: 'cli',
    args: Array.isArray(c.args) ? c.args.map(String) : [],
    stdin: cut(String(c.stdin ?? '')),
    expected_stdout: cut(String(c.stdout ?? '')),
    expected_exit: Number(c.exit_code ?? 0),
    actual_stdout: cut(e.log),
    actual_exit: e.exit_code,
    state: e.state,
    reason: e.reason ? cut(e.reason) : null,
  };
}
