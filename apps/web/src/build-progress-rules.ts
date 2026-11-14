// B3: pure rules for the Build page's timeline, stop reasons and results. No imports, so they
// can be tested without a browser. They only choose words; the server decides every state.

/** What GET /products returns for a task's newest build (packages/executor build-progress). */
export interface CaseFailure {
  index: number;
  check_key: string;
  held_out: boolean;
  unfinished: boolean;
  kind?: 'cli' | 'browser' | undefined;
  args?: string[] | undefined;
  stdin?: string | undefined;
  expected_stdout?: string | undefined;
  expected_exit?: number | undefined;
  actual_stdout?: string | undefined;
  actual_exit?: number | null | undefined;
  state?: string | undefined;
  reason?: string | null | undefined;
  page?: string | undefined;
  steps?: number | undefined;
  failed_step?: { index: number; detail: string } | null | undefined;
  page_errors?: string[] | undefined;
  outbound?: string[] | undefined;
  unsupported?: string[] | undefined;
}
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
  requests: number;
  approved: boolean;
  rounds: BuildRound[];
  now: {
    step: 'approval' | 'builder' | 'reviewer' | 'testing' | 'deciding';
    round: number;
    case?: number | undefined;
    since: string;
  } | null;
}

export type Tone = 'done' | 'now' | 'failed' | 'waiting';
export interface TimelineLine {
  tone: Tone;
  text: string;
}
export interface TimelineGroup {
  title: string;
  lines: TimelineLine[];
}

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** "First try" or "Repair round 1 of 2". */
export function roundTitle(round: number, maxRepairs: number) {
  return round === 0 ? 'First try' : `Repair round ${round} of ${maxRepairs}`;
}

/** "42 s" or "3 min 5 s" since an ISO time; empty when the time is unreadable. */
export function elapsed(since: string, now: number): string {
  const s = Math.max(0, Math.round((now - Date.parse(since)) / 1000));
  if (!Number.isFinite(s)) return '';
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min ${s % 60} s`;
}

/** The one line that says what a running build is doing now. */
export function nowLine(p: BuildProgress, now: number): string | null {
  const n = p.now;
  if (!n) return null;
  const repair =
    n.round > 0 ? ` (repair round ${n.round} of ${p.max_repairs})` : '';
  const what =
    n.step === 'approval'
      ? 'Checking the approval and the connection before anything is sent'
      : n.step === 'builder'
        ? n.round === 0
          ? 'The builder is writing the code'
          : `The builder is fixing what failed${repair}`
        : n.step === 'reviewer'
          ? `The reviewer is reading the new code${repair}`
          : n.step === 'testing'
            ? `Testing: case ${n.case ?? 1} of ${p.cases}${repair}`
            : 'Deciding what comes next';
  const t = elapsed(n.since, now);
  return t ? `${what} (${t} so far).` : `${what}.`;
}

function builderLine(r: BuildRound, p: BuildProgress): TimelineLine | null {
  if (r.builder === 'writing')
    return {
      tone: 'now',
      text:
        r.round === 0
          ? 'Builder is writing the code'
          : 'Builder is fixing what failed',
    };
  if (r.builder === 'failed')
    return { tone: 'failed', text: 'The builder request failed' };
  if (r.refused)
    return {
      tone: 'failed',
      text: `The studio refused the builder's change: ${r.refused.reason}. It changed nothing${
        p.max_repairs > r.round ? ' and counts as a repair round' : ''
      }.`,
    };
  if (r.candidate)
    return {
      tone: 'done',
      text: r.candidate.kept
        ? 'Builder kept the last build’s code, to be reviewed and tested again'
        : `Builder changed ${plural(r.candidate.files.length, 'file')}: ${r.candidate.files.slice(0, 6).join(', ')}${
            r.candidate.files.length > 6 ? ', …' : ''
          }`,
    };
  if (r.builder === 'answered')
    return { tone: 'done', text: 'Builder answered' };
  return null;
}

function reviewLine(r: BuildRound): TimelineLine | null {
  if (r.reviewer === 'reading')
    return { tone: 'now', text: 'Reviewer is reading the new code' };
  if (r.reviewer === 'failed')
    return { tone: 'failed', text: 'The reviewer request failed' };
  if (!r.review) return null;
  if (r.review.verdict === 'approve' && r.review.findings.length === 0)
    return { tone: 'done', text: 'Reviewer approved it with no findings' };
  if (r.review.verdict === 'blocked')
    return { tone: 'failed', text: 'Reviewer blocked it' };
  return {
    tone: 'failed',
    text: `Reviewer asked for changes (${plural(r.review.findings.length, 'finding')})`,
  };
}

function testsLine(
  r: BuildRound,
  p: BuildProgress,
  testing: number | null,
): TimelineLine | null {
  const t = r.tests;
  if (testing !== null)
    return { tone: 'now', text: `Testing case ${testing} of ${p.cases}` };
  if (!t.ran) return null;
  if (t.unfinished)
    return {
      tone: 'failed',
      text: 'The test sandbox could not finish a case, so nothing was judged',
    };
  const hidden = p.held_out
    ? ` (${plural(p.held_out, 'hidden case')} the builder never saw)`
    : '';
  if (t.failed === 0 && t.ran === p.cases)
    return { tone: 'done', text: `All ${p.cases} test cases passed${hidden}` };
  return {
    tone: 'failed',
    text: `${t.failed} of ${p.cases} test cases failed`,
  };
}

/** The build as rounds of steps, oldest first. */
export function timeline(
  p: BuildProgress,
  state: string,
): { groups: TimelineGroup[]; footer: TimelineLine | null } {
  const groups: TimelineGroup[] = [];
  const approval: TimelineLine = p.approved
    ? {
        tone: 'done',
        text: `Approved once: covers up to ${plural(p.max_calls, 'model request')} and ${plural(p.max_repairs, 'repair round')}`,
      }
    : {
        tone:
          p.now?.step === 'approval'
            ? 'now'
            : state === 'running'
              ? 'waiting'
              : 'failed',
        text:
          p.now?.step === 'approval'
            ? 'Checking the approval'
            : 'Not approved yet',
      };
  groups.push({ title: 'Before building', lines: [approval] });
  for (const r of p.rounds) {
    const lines: TimelineLine[] = [];
    const testing =
      p.now?.step === 'testing' && p.now.round === r.round
        ? (p.now.case ?? 1)
        : null;
    for (const l of [
      builderLine(r, p),
      reviewLine(r),
      testsLine(r, p, testing),
    ])
      if (l) lines.push(l);
    if (lines.length)
      groups.push({ title: roundTitle(r.round, p.max_repairs), lines });
  }
  const used = `${plural(p.requests, 'model request')} of ${p.max_calls} used`;
  const footer: TimelineLine | null =
    state === 'verified_candidate'
      ? {
          tone: 'done',
          text: `Verified: the reviewer approved it and every test passed. ${used}.`,
        }
      : state === 'running'
        ? { tone: 'now', text: `${used} so far.` }
        : { tone: 'failed', text: `Stopped. ${used}.` };
  return { groups, footer };
}

/** The newest round that was tested or reviewed: what "Why did it fail?" explains. */
export function judgedRound(p: BuildProgress): BuildRound | null {
  return (
    [...p.rounds]
      .reverse()
      .find(
        (r) =>
          r.failures.length ||
          (r.review && r.review.findings.length) ||
          r.refused,
      ) ?? null
  );
}

export interface StopExplanation {
  /** What happened, in plain words. */
  headline: string;
  /** The one thing to do next. */
  next: string;
}

const REQUEST_CODES: Record<string, StopExplanation> = {
  rate_limited: {
    headline: 'The plan asked the studio to slow down',
    next: 'Wait a few minutes, then press Start build again.',
  },
  output_cap_exceeded: {
    headline: 'The answer was longer than the connection allows',
    next: 'Raise the output limit under Connections, or narrow the task in the spec.',
  },
  studio_output_cap: {
    headline: 'The answer was longer than the connection allows',
    next: 'Raise the output limit under Connections, or narrow the task in the spec.',
  },
  auth_failed: {
    headline: 'The connection is signed out',
    next: 'Sign in again under Connections, then build again.',
  },
  token_unavailable: {
    headline: 'The connection is signed out',
    next: 'Sign in again under Connections, then build again.',
  },
  claude_sign_in_invalid: {
    headline: 'Claude Code is signed out',
    next: 'Sign in to Claude Code again, then build again.',
  },
  claude_usage_limit: {
    headline: 'Your Claude plan’s usage limit is reached',
    next: 'Wait for the limit to reset, then build again.',
  },
};
const FLAKY = new Set([
  'network_error',
  'provider_error',
  'stream_interrupted',
  'incomplete',
  'malformed_response',
  'no_stream',
]);

/**
 * Why a build stopped and the one next step, from the stop reason the build recorded. A
 * reason in no known shape keeps its own words (`fallback`) with a general next step.
 */
export function stopExplanation(
  reason: string,
  p: BuildProgress | null,
  fallback: string,
): StopExplanation {
  const t = reason.replace(/^(Contract)?Error: /, '');
  let m: RegExpExecArray | null;
  if ((m = /^Build admission ([a-z_]+)/.exec(t)))
    return m[1] === 'waiting_human' || m[1] === 'needs_human'
      ? {
          headline: 'The build is waiting for your approval',
          next: 'Approve it once below, then press Start build. One approval covers the whole build.',
        }
      : {
          headline: 'The build was not approved',
          next: 'Press Start build to ask again.',
        };
  if (
    (m = /The worker did not finish check (\S+) \((\w+)(?::\s*([^;]*))?/.exec(
      t,
    ))
  ) {
    const isolation = /isolation unavailable|WSL2/i.test(m[3] ?? '');
    return {
      headline: isolation
        ? `The test sandbox is not available here, so check ${m[1]} never ran`
        : `The test sandbox did not finish check ${m[1]}`,
      next:
        m[2] === 'cleanup_required'
          ? 'Press Recover, then build again. The code so far is kept.'
          : isolation
            ? 'Tests run only in WSL2 on Windows. Start WSL2 on this PC, then build again; the code so far is kept and is not resent.'
            : 'Build again once the sandbox runs; the code so far is kept.',
    };
  }
  if ((m = /^Repair limit reached; the last patch was refused: (.*)$/s.exec(t)))
    return {
      headline: `The builder’s last fix was refused by the studio (${m[1]!.replace(/\.$/, '')})`,
      next: 'Press Start build to continue from the last tested code, or narrow the task in the spec.',
    };
  if (/^Repair limit reached/.test(t)) {
    const repairs = p?.max_repairs ?? 0;
    return {
      headline:
        repairs > 0
          ? `Still failing after ${plural(repairs, 'repair round')}`
          : 'The first try failed and this build allowed no repair round',
      next: 'Read “Why did it fail?” below. If a case expects the wrong thing, fix it in the spec; otherwise press Start build to give the builder more rounds from its last code.',
    };
  }
  if (/^Reviewer blocked candidate/.test(t))
    return {
      headline: 'The reviewer blocked the code',
      next: 'Read the reviewer’s findings below. If the spec asks for something unsafe or impossible, revise it; otherwise build again.',
    };
  if ((m = /^Builder blocked: (.*)$/s.exec(t)))
    return {
      headline: `The builder said it could not do this: ${m[1]!.replace(/\.$/, '')}`,
      next: 'Make the task clear and possible in the spec, freeze it, and build again.',
    };
  if (/^Build call cap reached/.test(t))
    return {
      headline: 'The build used all of its model requests',
      next: 'Press Start build to continue from the last code with a new approval.',
    };
  if (/^Build deadline reached/.test(t))
    return {
      headline: 'The build ran out of time',
      next: 'Press Start build to continue from the last code with a new time limit.',
    };
  if ((m = /^Plan roles are not ready: (.*)$/s.exec(t)))
    return {
      headline: `The connection can’t run builds yet: ${m[1]!.replace(/\.$/, '')}`,
      next: 'Fix it under Connections, then build again.',
    };
  if (/daily request cap|daily_cap_reached/i.test(t))
    return {
      headline: 'Today’s plan request limit is used up',
      next: 'Build again after midnight UTC, or raise the daily limit under Connections.',
    };
  if (/per-run request cap|cap_reached/i.test(t))
    return {
      headline: 'This run’s request limit is used up',
      next: 'Raise the per-run limit under Connections, or build in a new run.',
    };
  if ((m = /^Role stopped: \w+ (\S+)/.exec(t))) {
    const code = m[1]!;
    if (REQUEST_CODES[code]) return REQUEST_CODES[code];
    if (FLAKY.has(code))
      return {
        headline: 'A model request failed on the way (network or provider)',
        next: 'Press Start build again; it continues from the last code.',
      };
    return {
      headline: `A model request stopped (${code.replace(/_/g, ' ')})`,
      next: 'Press Start build again; if it stops the same way, check the connection under Connections.',
    };
  }
  if (
    /Role context exceeds|Task file context exceeds|max_input|input cap/i.test(
      t,
    )
  )
    return {
      headline: 'The code is too large to send in one request',
      next: 'Raise the connection’s input limit under Connections, or narrow the task’s files in the spec.',
    };
  if (/^Review is not bound/.test(t))
    return {
      headline: 'The reviewer answered about different code',
      next: 'Press Start build again.',
    };
  if (/Stale build candidate|Changed candidate/.test(t))
    return {
      headline: 'The task’s files changed while the build ran',
      next: 'Reload the page, then press Start build.',
    };
  return {
    headline: fallback,
    next: 'Press Start build again. If it stops the same way, switch to Advanced to see the full record.',
  };
}

/** Every file the build changed, across its rounds, in first-changed order. */
export function changedFiles(p: BuildProgress): string[] {
  const out: string[] = [];
  for (const r of p.rounds)
    for (const f of r.candidate?.files ?? []) if (!out.includes(f)) out.push(f);
  return out;
}

/** How to run a downloaded package outside the studio, per system. */
export function runSteps(
  recipe: 'python-build/1' | 'static-web/1',
  archive: string,
): { system: string; lines: string[]; note: string }[] {
  const folder = 'my-product';
  if (recipe === 'static-web/1')
    return [
      {
        system: 'Windows (PowerShell)',
        lines: [
          `mkdir ${folder}; tar -xf ${archive} -C ${folder}`,
          `py -3 -m http.server 8000 --bind 127.0.0.1 --directory ${folder}\\site`,
        ],
        note: 'Open http://127.0.0.1:8000/ in your browser; press Ctrl+C to stop.',
      },
      {
        system: 'macOS or Linux',
        lines: [
          `mkdir ${folder} && tar -xf ${archive} -C ${folder}`,
          `python3 -m http.server 8000 --bind 127.0.0.1 --directory ${folder}/site`,
        ],
        note: 'Open http://127.0.0.1:8000/ in your browser; press Ctrl+C to stop.',
      },
    ];
  return [
    {
      system: 'Windows (PowerShell)',
      lines: [
        `mkdir ${folder}; tar -xf ${archive} -C ${folder}`,
        `cd ${folder}; py -3 -I src\\main.py`,
      ],
      note: 'Add the arguments your spec describes after main.py.',
    },
    {
      system: 'macOS or Linux',
      lines: [
        `mkdir ${folder} && tar -xf ${archive} -C ${folder}`,
        `cd ${folder} && python3 -I src/main.py`,
      ],
      note: 'Add the arguments your spec describes after main.py.',
    },
  ];
}

/** What a verified build checked, and the honest list of what it did not. */
export function testedSummary(
  p: BuildProgress,
  recipe: 'python-build/1' | 'static-web/1',
): { tested: string[]; untested: string[] } {
  const visible = p.cases - p.held_out;
  const repairs = p.rounds.length - 1;
  const tested = [
    `${plural(p.cases, 'test case')} passed on this exact code: ${visible} you can see in the spec and ${p.held_out} hidden from the builder and reviewer.`,
    recipe === 'static-web/1'
      ? 'Each case ran in a locked-down sandbox with no network, in a pinned headless Chrome.'
      : 'Each case ran in a locked-down sandbox with no network, files or packages.',
    'A separate reviewer read the code and approved it with no findings.',
    repairs > 0
      ? `It took ${plural(repairs, 'repair round')}: the first try failed and was fixed.`
      : 'It passed on the first try.',
  ];
  const untested = [
    `Anything the ${plural(p.cases, 'case')} do not cover: other inputs, very large inputs and speed.`,
    recipe === 'static-web/1'
      ? 'Other browsers, phone-sized screens and accessibility were not tested.'
      : 'Other Python versions and Windows or macOS were not tested; the sandbox is Linux.',
    'Nobody has used it for real yet: try it before you rely on it.',
  ];
  return { tested, untested };
}
