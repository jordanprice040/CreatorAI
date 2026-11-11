import { useState } from 'react';
import {
  PlanQualificationResultsSchema,
  latestDecided,
  planWaitMs,
  type PlanConnection,
  type PlanQualification,
} from '@creator/contracts';
import assessment from '../../../config/connections/benchmarks/assessment-synthetic-v1.json';
import specification from '../../../config/connections/benchmarks/specification-synthetic-v1.json';
import summarization from '../../../config/connections/benchmarks/summarization-synthetic-v1.json';
import builder from '../../../config/connections/benchmarks/t12-builder-v1.json';
import reviewer from '../../../config/connections/benchmarks/t12-reviewer-v2.json';
import { AllowTasks } from './allow-tasks.js';
import { api, words } from './oversight.js';

/**
 * The frozen benchmarks this app can start a plan qualification with (audit item 4, piece 4).
 * They are the files under config/connections/benchmarks that a Responses plan role uses
 * today; t12-reviewer-v1 is left out because its reviewer prompt was replaced (ADR-0049) and
 * the server refuses it. assessment-synthetic-v1 qualifies the automatic assessor (ADR-0074).
 * The server checks the manifest, the task class, the data class and
 * that the model is verified before it records anything.
 */
export const BENCHMARKS = [
  specification,
  summarization,
  builder,
  reviewer,
  assessment,
].map((m) => ({
  manifest: m,
  name: m.name,
  task_class: m.task_class,
  held_out: m.cases.filter((c) => c.split === 'held_out').length,
  development: m.cases.filter((c) => c.split !== 'held_out').length,
}));

/** Start, run and finish a qualification of one verified model on one bundled benchmark. */
export function QualifyModel({
  base,
  connection,
  models,
  qualifications,
  busy,
  preferred = null,
  act,
}: {
  /** The workspace's API path, e.g. `workspaces/<id>`. */
  base: string;
  connection: Pick<
    PlanConnection,
    'id' | 'kind' | 'version' | 'fixture' | 'settings' | 'caps_accepted_at'
  >;
  /** Models verified on the Responses path of this connection. */
  models: string[];
  /** Every qualification on this connection, as the server last reported them. */
  qualifications: PlanQualification[];
  busy: boolean;
  /** ADR-0081: the current model, preselected when it is verified on this connection. */
  preferred?: string | null;
  act: (
    path: string,
    body: unknown,
    timeoutMs?: number,
    local?: (error: string) => void,
  ) => Promise<unknown>;
}) {
  const [model, setModel] = useState('');
  const [bench, setBench] = useState('');
  // Errors and run results stay next to this form (review of PR #115, L-3), and a run locks
  // only these buttons, not the whole page (L-4).
  const [error, setError] = useState('');
  const [outcome, setOutcome] = useState('');
  const [runningId, setRunningId] = useState('');
  const [confirmFinish, setConfirmFinish] = useState('');
  const allowed = connection.settings.allowed_task_classes;
  const running = qualifications.filter((q) => q.state === 'running');
  // ADR-0084: whether a Run is executing comes from the server, so leaving the page, a
  // workspace switch or a second window cannot show a running qualification as idle. The
  // press made here counts too, until the next read reports it.
  const executing = (q: PlanQualification) =>
    q.executing === true || runningId === q.id;
  const anyExecuting = running.some(executing);
  const locked = busy || anyExecuting;
  async function run(q: PlanQualification) {
    setError('');
    setOutcome('');
    setRunningId(q.id);
    try {
      // PR #123 re-review L-1: one plan call per benchmark case, each up to the connection's
      // request timeout, which has no 300 s maximum any more (ADR-0062).
      let cases = 0;
      try {
        cases = (
          await api(
            PlanQualificationResultsSchema,
            `${base}/plan-qualifications/${q.id}`,
          )
        ).cases.length;
      } catch {
        cases = 0;
      }
      const out = await act(
        `plan-qualifications/${q.id}/run`,
        {},
        Math.max(
          3_600_000,
          // Plus 2 minutes a case for grading a patch in the worker (third review L-2).
          planWaitMs(
            connection.settings.caps.responses.request_timeout_ms + 120_000,
            cases,
          ),
        ),
        setError,
      );
      setOutcome(runOutcome(q, out));
    } finally {
      setRunningId('');
    }
  }
  async function finish(q: PlanQualification) {
    setError('');
    setOutcome('');
    setConfirmFinish('');
    const out = (await act(
      `plan-qualifications/${q.id}/finish`,
      {},
      undefined,
      setError,
    )) as { state?: string; reason?: string | null } | null;
    if (out?.state)
      setOutcome(
        `${words(q.task_class)} on ${q.model_id}: ${words(out.state)}${out.reason ? `. ${out.reason}` : '.'}`,
      );
  }
  const chosen = BENCHMARKS.find((b) => b.name === bench);
  const p = `plan-connections/${connection.id}`;
  const pick =
    (models.includes(model) ? model : '') ||
    (preferred && models.includes(preferred) ? preferred : '') ||
    models[0] ||
    '';
  const state = chosen
    ? benchmarkState(qualifications, pick, chosen.task_class, allowed)
    : null;
  return (
    <fieldset>
      <legend>Qualify a model for a task</legend>
      <p>
        A qualification runs one frozen benchmark against a verified model. It
        sends one plan request per case, counted against this connection&apos;s
        caps, and stays at $0 on a plan. Every held-out case must pass for the
        model to qualify. Starting records the qualification only; nothing is
        sent until you press Run.
      </p>
      {connection.fixture ? (
        <p className="small">
          These benchmarks are real (synthetic data, not fixtures), so they
          qualify only real connections.
        </p>
      ) : models.length === 0 ? (
        <p className="small">
          Verify a model above first: only a verified model can be qualified.
        </p>
      ) : (
        <>
          <div className="inline-form">
            <label htmlFor={`q-model-${connection.id}`} className="inline">
              Model
            </label>
            <select
              id={`q-model-${connection.id}`}
              value={pick}
              onChange={(e) => setModel(e.target.value)}
            >
              {models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <label htmlFor={`q-bench-${connection.id}`} className="inline">
              Benchmark
            </label>
            <select
              id={`q-bench-${connection.id}`}
              value={bench}
              onChange={(e) => setBench(e.target.value)}
            >
              <option value="">Choose a task</option>
              {BENCHMARKS.map((b) => (
                <option key={b.name} value={b.name}>
                  {words(b.task_class)} · {b.name} ({b.development} practice +{' '}
                  {b.held_out} held out)
                  {benchmarkTag(
                    benchmarkState(qualifications, pick, b.task_class, allowed),
                  )}
                </option>
              ))}
            </select>
          </div>
          {chosen && state && (
            <>
              {state.kind === 'not_allowed' ? (
                <p className="small">
                  {words(chosen.task_class)} is not allowed on this connection,
                  so it can&apos;t be qualified yet.{' '}
                  <AllowTasks
                    connection={connection}
                    tasks={[chosen.task_class]}
                    label="Allow this task"
                    busy={locked}
                    act={act}
                    onError={setError}
                  />
                </p>
              ) : (
                <p className="small">
                  {state.kind === 'qualified'
                    ? `${pick} is qualified for ${words(chosen.task_class)} (${decidedWords(state.latest)}). A re-run is recorded as a new qualification, and the newest decided one counts, so a failed re-run replaces this pass. `
                    : state.kind === 'failed'
                      ? `${pick}'s last qualification for ${words(chosen.task_class)} failed (${decidedWords(state.latest)}). `
                      : ''}
                  {state.kind === 'started'
                    ? 'Already started: press Run on it below.'
                    : `Uses up to ${chosen.development + chosen.held_out} plan requests when run. Pass bar: all ${chosen.held_out} held-out cases.`}
                </p>
              )}
              {state.kind !== 'not_allowed' && state.kind !== 'started' && (
                <button
                  type="button"
                  disabled={locked || !pick}
                  onClick={() => {
                    setError('');
                    setOutcome('');
                    void act(
                      `${p}/qualifications`,
                      {
                        expected_version: connection.version,
                        model_id: pick,
                        manifest: chosen.manifest,
                        min_held_out_cases: chosen.held_out,
                        floor: { numerator: 1, denominator: 1 },
                      },
                      undefined,
                      setError,
                    );
                  }}
                >
                  {state.kind === 'qualified'
                    ? 'Start a re-run'
                    : state.kind === 'failed'
                      ? 'Start qualification again'
                      : 'Start qualification'}
                </button>
              )}
              {anyExecuting && state.kind !== 'started' && (
                <p className="small">
                  A qualification on this connection is running; it sends one
                  request at a time, so wait for it to finish before starting
                  another.
                </p>
              )}
            </>
          )}
        </>
      )}
      {running.map((q) => {
        // The bundled benchmark of this task class, if there is one: a qualification started
        // elsewhere may use another manifest, so the count is an upper bound only (L-2).
        const b = BENCHMARKS.find((x) => x.task_class === q.task_class);
        const n = b ? b.development + b.held_out : null;
        return (
          <div key={q.id} className="qualify-row" role="group">
            <span>
              {words(q.task_class)} on {q.model_id} is started.
              {executing(q) &&
                ' Running: one plan request per case; this can take several minutes, and it carries on if you leave this page.'}
            </span>
            <button type="button" disabled={locked} onClick={() => void run(q)}>
              {executing(q)
                ? 'Running…'
                : `Run${n ? ` (up to ${n} plan requests; answered cases are skipped)` : ''}`}
            </button>
            {confirmFinish === q.id ? (
              <span className="notice small">
                Finishing now records every unanswered case as failed, and a
                failed result stays listed.{' '}
                <button
                  type="button"
                  className="secondary"
                  disabled={locked}
                  onClick={() => void finish(q)}
                >
                  Finish anyway
                </button>{' '}
                <button
                  type="button"
                  className="text"
                  onClick={() => setConfirmFinish('')}
                >
                  Keep it open
                </button>
              </span>
            ) : (
              <button
                type="button"
                className="secondary"
                disabled={locked}
                onClick={() => setConfirmFinish(q.id)}
              >
                Finish and record the result
              </button>
            )}
          </div>
        );
      })}
      {outcome && (
        <p className="small" role="status">
          {outcome}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}

/**
 * What a Run press ended with, in words (review of PR #115, M-1). The server answers 200 with
 * `stopped` and a reason when a case is refused (caps, sign-in, Claude Code missing), or
 * `decided` with the recorded qualification once every case has an answer.
 */
export function runOutcome(
  q: { task_class: string; model_id: string },
  out: unknown,
): string {
  const o = (out ?? {}) as {
    state?: string;
    reason?: string;
    qualification?: {
      state: string;
      reason: string | null;
      held_out: { passed: number; total: number };
    };
  };
  const what = `${words(q.task_class)} on ${q.model_id}`;
  if (o.state === 'stopped')
    return `${what} stopped: ${words(o.reason ?? 'unknown reason')}. Answered cases are kept. Fix the cause and press Run to continue with the rest, or Finish to record the result now.`;
  if (o.state === 'decided' && o.qualification)
    return `${what}: ${words(o.qualification.state)} (${o.qualification.held_out.passed} of ${o.qualification.held_out.total} held-out cases passed)${o.qualification.reason ? `. ${o.qualification.reason}` : '.'}`;
  return '';
}

/**
 * Where one benchmark's task stands for the chosen model (P23, items 11 and 17): not allowed on
 * this connection, already started, qualified or failed by the newest decided qualification
 * (ADR-0052), or never qualified.
 */
export type BenchmarkState =
  | { kind: 'not_allowed' }
  | { kind: 'started'; qualification: PlanQualification }
  | { kind: 'qualified' | 'failed'; latest: PlanQualification }
  | { kind: 'new' };

export function benchmarkState(
  qualifications: readonly PlanQualification[],
  model: string,
  task: string,
  allowed: readonly string[],
): BenchmarkState {
  if (!allowed.includes(task)) return { kind: 'not_allowed' };
  const started = qualifications.find(
    (q) =>
      q.state === 'running' && q.model_id === model && q.task_class === task,
  );
  if (started) return { kind: 'started', qualification: started };
  const latest = latestDecided(qualifications, model, task);
  if (latest?.state === 'qualified' || latest?.state === 'failed')
    return { kind: latest.state, latest };
  return { kind: 'new' };
}

function benchmarkTag(s: BenchmarkState): string {
  switch (s.kind) {
    case 'not_allowed':
      return ' · not allowed on this connection yet';
    case 'started':
      return ' · started';
    case 'qualified':
      // Short, so the option fits the select; the line below it has the score (PR #172 N-2).
      return ` · qualified${s.latest.decided_at ? ` ${new Date(s.latest.decided_at).toLocaleDateString()}` : ''}`;
    case 'failed':
      return ' · last run failed';
    default:
      return '';
  }
}

/** "on 11/11/2026, 8 of 8 held-out cases passed" for a decided qualification. */
function decidedWords(q: PlanQualification): string {
  const when = q.decided_at
    ? `on ${new Date(q.decided_at).toLocaleDateString()}, `
    : '';
  return `${when}${q.held_out.passed} of ${q.held_out.total} held-out cases passed`;
}
