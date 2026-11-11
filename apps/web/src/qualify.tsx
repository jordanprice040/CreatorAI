import { useEffect, useState } from 'react';
import {
  DiscoveryBenchmarksSchema,
  PlanQualificationResultsSchema,
  latestDecided,
  planWaitMs,
  type DiscoveryBenchmark,
  type PlanConnection,
  type PlanQualification,
} from '@creator/contracts';
import assessment from '../../../config/connections/benchmarks/assessment-synthetic-v1.json';
import specification from '../../../config/connections/benchmarks/specification-synthetic-v1.json';
import summarization from '../../../config/connections/benchmarks/summarization-synthetic-v1.json';
import builder from '../../../config/connections/benchmarks/t12-builder-v1.json';
import reviewer from '../../../config/connections/benchmarks/t12-reviewer-v2.json';
import webDiscovery from '../../../config/connections/benchmarks/web-discovery-v2.json';
import { AllowTasks } from './allow-tasks.js';
import {
  forRole,
  manifestRole,
  qualificationTask,
  roleOf,
  roleTask,
  runningFor,
  type Admits,
} from './qualification-role.js';
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
  webDiscovery,
].map((m) => ({
  manifest: m,
  name: m.name,
  task_class: m.task_class,
  held_out: m.cases.filter((c) => c.split === 'held_out').length,
  development: m.cases.filter((c) => c.split !== 'held_out').length,
}));

/**
 * Which qualifications count for a benchmark's own role (ADR-0089): the assessment benchmark's
 * scoring counts only for assessments, the discovery benchmarks' only for discovery, and (with
 * P12) the web discovery benchmark's only for Search the web, so a pass on one never shows
 * another as qualified. See qualification-role.ts.
 */
export type { Admits };

/** One benchmark in the list: bundled with the app, or offered by the server (discovery). */
export interface Offer {
  name: string;
  task_class: string;
  development: number;
  held_out: number;
  admits: Admits;
  /** Server-offered benchmarks carry their manifest hash, to match a started qualification. */
  manifest_hash: string | null;
  /** The start request body after `expected_version` and `model_id`. */
  start: Record<string, unknown>;
}

/**
 * The benchmarks Qualify a model lists: the bundled ones, then the discovery benchmarks the
 * server offers (ADR-0089: the newest manifest per discovery task class that matches the current
 * role prompts; the server picks them and loads the manifest itself when one is started).
 */
export function offers(discovery: readonly DiscoveryBenchmark[]): Offer[] {
  return [
    ...BENCHMARKS.map((b) => ({
      name: b.name,
      task_class: b.task_class,
      development: b.development,
      held_out: b.held_out,
      // Read from the manifest's checks, so a bundled benchmark of another role (P12's web
      // discovery) gets its own tag without a change here (PR #175 review M-2).
      admits: manifestRole(b.manifest),
      manifest_hash: null,
      start: {
        manifest: b.manifest,
        min_held_out_cases: b.held_out,
        floor: { numerator: 1, denominator: 1 },
      },
    })),
    ...discovery.map((b) => ({
      name: b.name,
      task_class: b.task_class,
      development: b.development,
      held_out: b.held_out,
      admits: 'discovery' as const,
      manifest_hash: b.manifest_hash,
      start: { benchmark: b.name },
    })),
  ];
}

/** The task in the benchmark list, with the role when one task class serves two roles. */
export const offerTask = (o: Pick<Offer, 'task_class' | 'admits'>): string =>
  roleTask(o.task_class, o.admits);

/** Start, run and finish a qualification of one verified model on one bundled benchmark. */
export function QualifyModel({
  base,
  connection,
  models,
  qualifications,
  busy,
  preferred = null,
  discovery: given,
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
  /** The server's discovery benchmarks; read from `plan-benchmarks` when not given. */
  discovery?: DiscoveryBenchmark[];
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
  const [loaded, setLoaded] = useState<DiscoveryBenchmark[] | null>(null);
  const [loadError, setLoadError] = useState('');
  useEffect(() => {
    if (given) return;
    let live = true;
    setLoadError('');
    api(DiscoveryBenchmarksSchema, `${base}/plan-benchmarks`).then(
      (r) => live && setLoaded(r.benchmarks),
      (e: unknown) =>
        live &&
        setLoadError(
          `Could not load the discovery benchmarks: ${e instanceof Error ? e.message : String(e)}`,
        ),
    );
    return () => {
      live = false;
    };
  }, [base, given]);
  const list = offers(given ?? loaded ?? []);
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
        `${qualificationTask(q)} on ${q.model_id}: ${words(out.state)}${out.reason ? `. ${out.reason}` : '.'}`,
      );
  }
  const chosen = list.find((b) => b.name === bench);
  const p = `plan-connections/${connection.id}`;
  const pick =
    (models.includes(model) ? model : '') ||
    (preferred && models.includes(preferred) ? preferred : '') ||
    models[0] ||
    '';
  const state = chosen
    ? benchmarkState(
        qualifications,
        pick,
        chosen.task_class,
        allowed,
        chosen.admits,
      )
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
              {list.map((b) => (
                <option key={b.name} value={b.name}>
                  {offerTask(b)} · {b.name} ({b.development} practice +{' '}
                  {b.held_out} held out)
                  {benchmarkTag(
                    benchmarkState(
                      qualifications,
                      pick,
                      b.task_class,
                      allowed,
                      b.admits,
                    ),
                  )}
                </option>
              ))}
            </select>
          </div>
          {loadError && <p className="small">{loadError}</p>}
          {chosen && state && (
            <>
              {state.kind === 'not_allowed' ? (
                <p className="small">
                  {offerTask(chosen)} is not allowed on this connection, so it
                  can&apos;t be qualified yet.{' '}
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
                    ? `${pick} is qualified for ${offerTask(chosen)} (${decidedWords(state.latest)}). A re-run is recorded as a new qualification, and the newest decided one counts, so a failed re-run replaces this pass. `
                    : state.kind === 'failed'
                      ? `${pick}'s last qualification for ${offerTask(chosen)} failed (${decidedWords(state.latest)}). `
                      : ''}
                  {state.kind === 'started'
                    ? 'Already started: press Run on it below.'
                    : state.kind === 'other_running'
                      ? // PR #175 review L-1: the server runs one qualification per model and
                        // task class, so the other role's must be run or finished first.
                        `A ${qualificationTask(state.qualification)} qualification of ${pick} is started; run or finish it below first, since one qualification per model and task runs at a time.`
                      : `Uses up to ${chosen.development + chosen.held_out} plan requests when run. Pass bar: all ${chosen.held_out} held-out cases.`}
                </p>
              )}
              {state.kind !== 'not_allowed' &&
                state.kind !== 'started' &&
                state.kind !== 'other_running' && (
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
                          ...chosen.start,
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
              {anyExecuting &&
                state.kind !== 'started' &&
                state.kind !== 'other_running' && (
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
        // The offered benchmark with this manifest, else one of this task class and role: a
        // qualification started elsewhere may use another manifest, so the count is an upper
        // bound only (L-2; PR #173 review 5 N-2: web discovery and the locator are both
        // research synthesis).
        const b =
          list.find((x) => x.manifest_hash === q.manifest_hash) ??
          list.find(
            (x) => x.task_class === q.task_class && x.admits === roleOf(q),
          );
        const n = b ? b.development + b.held_out : null;
        return (
          <div key={q.id} className="qualify-row" role="group">
            <span>
              {qualificationTask(q)} on {q.model_id} is started.
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
  q: {
    task_class: string;
    model_id: string;
    admits_assessment?: boolean | undefined;
    admits_discovery?: boolean | undefined;
    prompt_current?: boolean | undefined;
  },
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
  const what = `${qualificationTask(q)} on ${q.model_id}`;
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
  | { kind: 'other_running'; qualification: PlanQualification }
  | { kind: 'qualified' | 'failed'; latest: PlanQualification }
  | { kind: 'new' };

export function benchmarkState(
  qualifications: readonly PlanQualification[],
  model: string,
  task: string,
  allowed: readonly string[],
  admits: Admits = null,
): BenchmarkState {
  if (!allowed.includes(task)) return { kind: 'not_allowed' };
  // The server runs one qualification per model and task class at a time, whatever its role;
  // one of another role blocks this start and is named as such (PR #175 review L-1).
  const running = runningFor(qualifications, model, task, admits);
  if (running.kind !== 'free') return running;
  // Qualified or failed counts only this benchmark's role (ADR-0089), and an untagged one never
  // borrows a tagged role's pass (PR #175 review M-2).
  const latest = latestDecided(forRole(qualifications, admits), model, task);
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
    case 'other_running':
      // PR #175 re-review 2 N-2: a running row on an older prompt has no role of its own.
      return roleOf(s.qualification)
        ? ' · another role is running'
        : ' · another run is started';
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
