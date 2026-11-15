import { useEffect, useState } from 'react';
import { z } from '@creator/contracts';
import {
  changedFiles,
  headlineText,
  judgedRound,
  nowParts,
  roundTitle,
  runSteps,
  stopExplanation,
  testedSummary,
  timeline,
  type BuildProgress,
  type CaseFailure,
  type Tone,
} from './build-progress-rules.js';

// B3: what GET /products returns for a task's newest build (packages/executor build-progress.ts).
const failure = z.object({
  index: z.number(),
  check_key: z.string(),
  held_out: z.boolean(),
  unfinished: z.boolean(),
  kind: z.enum(['cli', 'browser']).optional(),
  args: z.array(z.string()).optional(),
  stdin: z.string().optional(),
  expected_stdout: z.string().optional(),
  expected_exit: z.number().optional(),
  actual_stdout: z.string().optional(),
  actual_exit: z.number().nullable().optional(),
  state: z.string().optional(),
  reason: z.string().nullable().optional(),
  page: z.string().optional(),
  steps: z.number().optional(),
  failed_step: z
    .object({ index: z.number(), detail: z.string() })
    .nullable()
    .optional(),
  page_errors: z.array(z.string()).optional(),
  outbound: z.array(z.string()).optional(),
  unsupported: z.array(z.string()).optional(),
});
export const BuildProgressSchema = z.object({
  route: z.enum(['plan_roles', 'codex_plan', 'broker']),
  max_repairs: z.number(),
  max_calls: z.number(),
  cases: z.number(),
  held_out: z.number(),
  requests: z.number(),
  codex_turns: z.number().optional(),
  approved: z.boolean(),
  rounds: z.array(
    z.object({
      round: z.number(),
      builder: z.enum(['writing', 'answered', 'failed']).nullable(),
      parts: z.number().optional(),
      refused: z
        .object({ reason: z.string(), details: z.array(z.string()) })
        .nullable(),
      candidate: z
        .object({ files: z.array(z.string()), kept: z.boolean() })
        .nullable(),
      reviewer: z.enum(['reading', 'answered', 'failed']).nullable(),
      review: z
        .object({ verdict: z.string(), findings: z.array(z.string()) })
        .nullable(),
      tests: z.object({
        ran: z.number(),
        passed: z.number(),
        failed: z.number(),
        unfinished: z.number(),
      }),
      failures: z.array(failure),
    }),
  ),
  now: z
    .object({
      step: z.enum(['approval', 'builder', 'reviewer', 'testing', 'deciding']),
      round: z.number(),
      case: z.number().optional(),
      since: z.string(),
    })
    .nullable(),
}) satisfies z.ZodType<BuildProgress>;

const MARK: Record<Tone, string> = {
  done: '✓',
  now: '●',
  failed: '✕',
  waiting: '○',
};
const TONE_WORD: Record<Tone, string> = {
  done: 'Done',
  now: 'Now',
  failed: 'Stopped or failed',
  waiting: 'Not started',
};

/** Seconds tick while a build runs, so "so far" stays current between polls. */
function useNow(ticking: boolean) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!ticking) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [ticking]);
  return now;
}

/** The build's steps by round: who did what, and what the tests said. */
export function BuildTimeline({
  progress,
  state,
}: {
  progress: BuildProgress;
  state: string;
}) {
  const { groups, footer } = timeline(progress, state);
  return (
    <ol className="build-timeline" aria-label="Build steps">
      {groups.map((g) => (
        <li key={g.title}>
          <span className="build-round">{g.title}</span>
          <ul>
            {g.lines.map((l) => (
              <li key={l.text} className={`step-${l.tone}`}>
                <span className="step-mark" aria-hidden="true">
                  {MARK[l.tone]}
                </span>
                <span className="sr-only">{TONE_WORD[l.tone]}: </span>
                {l.text}
              </li>
            ))}
          </ul>
        </li>
      ))}
      {footer && (
        <li className={`build-footer step-${footer.tone}`}>{footer.text}</li>
      )}
    </ol>
  );
}

function Output({ label, text }: { label: string; text: string }) {
  return (
    <div className="output">
      <span className="output-label">{label}</span>
      <pre>{text === '' ? '(nothing)' : text}</pre>
    </div>
  );
}

function FailedCase({ f }: { f: CaseFailure }) {
  if (f.held_out)
    return (
      <li>
        <strong>Hidden case of check {f.check_key}</strong>{' '}
        {f.unfinished
          ? 'did not finish in the sandbox.'
          : `failed. Its input and expected output stay hidden on purpose; compare the code with what the spec says for ${f.check_key}.`}
      </li>
    );
  if (f.kind === 'browser')
    return (
      <li>
        <strong>
          Check {f.check_key}, page {f.page}
        </strong>
        {f.failed_step
          ? `: step ${f.failed_step.index + 1} of ${f.steps ?? '?'} failed: ${f.failed_step.detail}`
          : f.reason
            ? `: ${f.reason}`
            : ': it did not pass.'}
        {!!f.page_errors?.length && (
          <Output label="Page errors" text={f.page_errors.join('\n')} />
        )}
        {!!f.outbound?.length && (
          <Output
            label="Requests outside the site (not allowed)"
            text={f.outbound.join('\n')}
          />
        )}
        {!!f.unsupported?.length && (
          <Output label="Not supported" text={f.unsupported.join('\n')} />
        )}
      </li>
    );
  const exitDiffers = f.expected_exit !== f.actual_exit;
  return (
    <li>
      <strong>Check {f.check_key}</strong>
      {f.unfinished
        ? ': the sandbox did not finish this case.'
        : `: run with ${f.args?.length ? `arguments ${f.args.map((a) => JSON.stringify(a)).join(' ')}` : 'no arguments'}${f.stdin ? ' and the input below' : ''}.`}
      {f.stdin ? <Output label="Input" text={f.stdin} /> : null}
      <div className="output-pair">
        <Output label="Expected output" text={f.expected_stdout ?? ''} />
        <Output label="What the program printed" text={f.actual_stdout ?? ''} />
      </div>
      {exitDiffers && (
        <p className="small">
          Expected exit code {f.expected_exit}; it exited with{' '}
          {f.actual_exit ?? 'no code'}
          {f.reason ? ` (${f.reason})` : ''}.
        </p>
      )}
    </li>
  );
}

/** "Why did it fail?": the failing visible cases' expected and actual output, and findings. */
export function WhyFailed({ progress }: { progress: BuildProgress }) {
  const r = judgedRound(progress);
  if (!r) return null;
  const findings = r.review?.findings ?? [];
  return (
    <details className="why-failed">
      <summary>
        Why did it fail? (
        {roundTitle(r.round, progress.max_repairs).toLowerCase()})
      </summary>
      {r.refused && (
        <p>
          The studio refused the builder’s change: {r.refused.reason}
          {r.refused.details.length ? `: ${r.refused.details.join('; ')}` : ''}
        </p>
      )}
      {r.failures.length > 0 && (
        <ul className="failed-cases">
          {r.failures.map((f) => (
            <FailedCase key={f.index} f={f} />
          ))}
        </ul>
      )}
      {findings.length > 0 && (
        <>
          <p>
            The reviewer’s{' '}
            {r.review?.verdict === 'blocked'
              ? 'reasons for blocking'
              : 'findings'}
            :
          </p>
          <ul>
            {findings.map((f, i) => (
              <li key={i}>{f}</li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}

/** A verified build: what you got, what was and was not tested, and how to run it. */
function Results({
  progress,
  recipe,
  archive,
  fixture,
}: {
  progress: BuildProgress;
  recipe: 'python-build/1' | 'static-web/1';
  archive: string | null;
  fixture: boolean;
}) {
  const files = changedFiles(progress);
  const { tested, untested } = testedSummary(progress, recipe);
  return (
    <div className="build-results">
      {fixture && (
        <p className="small">
          <strong>Fixture build:</strong> simulated builder and reviewer in a
          fixture workspace. This shows how a result reads; it is not evidence
          that anything works.
        </p>
      )}
      <h5>What you got</h5>
      <p>
        {recipe === 'static-web/1'
          ? 'A static web page'
          : 'A Python command-line program'}{' '}
        in {files.length} {files.length === 1 ? 'file' : 'files'}:{' '}
        {files.join(', ')}.
      </p>
      <h5>What was tested</h5>
      <ul>
        {tested.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <h5>What was not tested</h5>
      <ul>
        {untested.map((t) => (
          <li key={t}>{t}</li>
        ))}
      </ul>
      <details>
        <summary>How to run it on your computer</summary>
        <p className="small">
          {archive
            ? 'Download the source archive under Try, then in the folder you saved it to:'
            : 'Package it first (the Package button), download the source archive under Try, then in the folder you saved it to:'}
        </p>
        {runSteps(recipe, archive ?? 'creator-….tar').map((s) => (
          <div key={s.system}>
            <p className="small">
              <strong>{s.system}</strong>
            </p>
            <pre className="commands">{s.lines.join('\n')}</pre>
            <p className="small">{s.note}</p>
          </div>
        ))}
        <p className="small">
          Needs Python 3 (on Windows, the python.org installer adds the{' '}
          <code>py</code> command). No packages and no network are needed.
        </p>
      </details>
    </div>
  );
}

/**
 * B3: a task's newest build, beyond its one-line row: the live step while it runs, the plain
 * reason and next step when it stopped, and the results when it verified.
 */
export function BuildDetails({
  state,
  reason,
  progress,
  recipe,
  archive,
  plain,
  fixture,
}: {
  /** The build's roles were fixture roles (simulated, not evidence of anything). */
  fixture: boolean;
  state: string;
  reason: string | null;
  progress: BuildProgress | null;
  recipe: 'python-build/1' | 'static-web/1';
  /** The downloaded archive's file name, once packaged. */
  archive: string | null;
  /** The reason in the page's plain words, used when its shape is not known. */
  plain: string;
}) {
  const running = state === 'running';
  const now = useNow(running && !!progress?.now);
  const stopped = state === 'checkpoint' || state === 'failed';
  const live = running && progress ? nowParts(progress, now) : null;
  const why =
    reason && stopped ? stopExplanation(reason, progress, plain) : null;
  return (
    <div className="build-details">
      {running && (
        <p className="build-now">
          {/* Only the step is live: the seconds tick every second and would be re-announced. */}
          <span role="status" aria-live="polite">
            {live?.step ?? 'Starting…'}
          </span>
          {live?.time ? <span> ({live.time})</span> : null}
          {live ? '.' : null}
        </p>
      )}
      {why && (
        <div className="build-stop">
          <p>
            <strong>{headlineText(why.headline)}</strong>
          </p>
          <p>
            <span className="next-label">Next:</span> {why.next}
          </p>
        </div>
      )}
      {progress && state === 'verified_candidate' && (
        <Results
          progress={progress}
          recipe={recipe}
          archive={archive}
          fixture={fixture}
        />
      )}
      {progress && stopped && <WhyFailed progress={progress} />}
      {progress &&
        (progress.rounds.length > 0 || running) &&
        (running ? (
          <BuildTimeline progress={progress} state={state} />
        ) : (
          <details>
            <summary>Steps of this build</summary>
            <BuildTimeline progress={progress} state={state} />
          </details>
        ))}
    </div>
  );
}
