import { useState } from 'react';
import {
  PlanQualificationResultsSchema,
  latestDecided,
  forDiscover,
  forWebDiscovery,
  planWaitMs,
  type PlanConnection,
  type PlanQualification,
  type QualificationQueue,
} from '@creator/contracts';
import assessment from '../../../config/connections/benchmarks/assessment-synthetic-v1.json';
import specification from '../../../config/connections/benchmarks/specification-synthetic-v1.json';
import summarization from '../../../config/connections/benchmarks/summarization-synthetic-v1.json';
import builder from '../../../config/connections/benchmarks/t12-builder-v1.json';
import reviewer from '../../../config/connections/benchmarks/t12-reviewer-v2.json';
import webDiscovery from '../../../config/connections/benchmarks/web-discovery-v2.json';
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
  webDiscovery,
].map((m) => ({
  manifest: m,
  name: m.name,
  task_class: m.task_class,
  held_out: m.cases.filter((c) => c.split === 'held_out').length,
  development: m.cases.filter((c) => c.split !== 'held_out').length,
  // ADR-0086: shares research synthesis with the discovery locator but admits only web discovery.
  web: m.name.startsWith('web-discovery-'),
}));

/** Start, run and finish a qualification of one verified model on one bundled benchmark. */
export function QualifyModel({
  base,
  connection,
  models,
  qualifications,
  queue = null,
  requestsLeft = null,
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
  /** ADR-0088 (P24): the connection's newest qualification queue, if any. */
  queue?: QualificationQueue | null;
  /** Plan requests left in the connection's rolling 24-hour cap, if known (review N-4). */
  requestsLeft?: number | null;
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
  // P24: tasks ticked for "Qualify selected", and a finished queue the person hid.
  const [ticked, setTicked] = useState<string[]>([]);
  const [hidden, setHidden] = useState('');
  // Review N-3: a refused queue start shows next to the buttons that made it.
  const [queueError, setQueueError] = useState('');
  const allowed = connection.settings.allowed_task_classes;
  const running = qualifications.filter((q) => q.state === 'running');
  // ADR-0084: whether a Run is executing comes from the server, so leaving the page, a
  // workspace switch or a second window cannot show a running qualification as idle. The
  // press made here counts too, until the next read reports it.
  const executing = (q: PlanQualification) =>
    q.executing === true || runningId === q.id;
  const anyExecuting = running.some(executing);
  // ADR-0088: while a queue works on this connection, it alone sends requests here.
  const queueRunning = queue?.state === 'running';
  const locked = busy || anyExecuting || queueRunning;
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
    ? benchmarkState(
        qualifications,
        pick,
        chosen.task_class,
        allowed,
        chosen.web,
      )
    : null;
  const several = queueChoices(qualifications, pick, allowed);
  const eligible = several.filter((x) => x.eligible);
  const chosenSeveral = eligible.filter((x) => ticked.includes(x.name));
  function startQueue(list: typeof eligible) {
    setError('');
    setOutcome('');
    setQueueError('');
    void act(
      `${p}/qualification-queues`,
      queueBody(connection.version, pick, list),
      30_000,
      setQueueError,
    ).then((out) => {
      if (out) setTicked([]);
    });
  }
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
                    benchmarkState(
                      qualifications,
                      pick,
                      b.task_class,
                      allowed,
                      b.web,
                    ),
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
          <QueueChoices
            id={connection.id}
            model={pick}
            choices={several}
            ticked={ticked}
            setTicked={setTicked}
            locked={locked || !pick}
            requestsLeft={requestsLeft}
            dailyCap={
              connection.settings.caps.shared?.max_model_requests_per_day ??
              null
            }
            error={queueError}
            onStart={() => startQueue(chosenSeveral)}
            onStartAll={() => startQueue(eligible)}
          />
        </>
      )}
      {queue && queue.id !== hidden && (
        <QueueProgress
          queue={queue}
          busy={busy}
          onCancel={() => {
            setError('');
            void act(
              `plan-qualification-queues/${queue.id}/cancel`,
              {},
              undefined,
              setError,
            );
          }}
          onHide={() => setHidden(queue.id)}
        />
      )}
      {running.map((q) => {
        // The bundled benchmark of this task class, if there is one: a qualification started
        // elsewhere may use another manifest, so the count is an upper bound only (L-2).
        // Review 5 N-2: of the same kind too (web discovery or not), since both are research
        // synthesis.
        const b = BENCHMARKS.find(
          (x) =>
            x.task_class === q.task_class &&
            x.web === (q.admits_web_discovery === true),
        );
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
  web = false,
): BenchmarkState {
  if (!allowed.includes(task)) return { kind: 'not_allowed' };
  // PR #173 review 4 L-B: a web-discovery benchmark reads only web records, and the others
  // never read them, though both are research synthesis.
  const own = web
    ? forWebDiscovery(qualifications)
    : forDiscover(qualifications);
  const started = own.find(
    (q) =>
      q.state === 'running' && q.model_id === model && q.task_class === task,
  );
  if (started) return { kind: 'started', qualification: started };
  const latest = latestDecided(own, model, task);
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

/** One benchmark as a choice for "Qualify several tasks" (P24, items 2, 3 and 17). */
export interface QueueChoice {
  name: string;
  task_class: string;
  requests: number;
  /** Allowed here and not yet qualified (new, last run failed, or started and not finished). */
  eligible: boolean;
  state: BenchmarkState;
}

/**
 * The bundled benchmarks for "Qualify several tasks", in the order a queue runs them. A queue
 * only takes tasks not yet qualified: a failed re-run would replace a pass (ADR-0052), so a
 * qualified task is re-run on its own, on purpose. One that is started is taken over as it is.
 */
export function queueChoices(
  qualifications: readonly PlanQualification[],
  model: string,
  allowed: readonly string[],
): QueueChoice[] {
  return BENCHMARKS.map((b) => {
    const web = b.web;
    const state = benchmarkState(
      qualifications,
      model,
      b.task_class,
      allowed,
      web,
    );
    // Review of PR #176, L-3: a started re-run of a qualified task is still qualified (the
    // newest decided one counts), so it is run on its own, not queued. A web-discovery
    // benchmark reads only its own lane (P12).
    const own = web
      ? forWebDiscovery(qualifications)
      : forDiscover(qualifications);
    const qualified =
      latestDecided(own, model, b.task_class)?.state === 'qualified';
    return {
      name: b.name,
      task_class: b.task_class,
      requests: b.development + b.held_out,
      eligible:
        state.kind !== 'not_allowed' &&
        state.kind !== 'qualified' &&
        !qualified,
      state,
    };
  });
}

/** The request that queues `list` for `model`; the pass bar is every held-out case, as Start. */
export function queueBody(
  version: number,
  model: string,
  list: readonly { name: string }[],
) {
  return {
    expected_version: version,
    model_id: model,
    items: list.map((x) => {
      const b = BENCHMARKS.find((y) => y.name === x.name)!;
      return {
        manifest: b.manifest,
        min_held_out_cases: b.held_out,
        floor: { numerator: 1, denominator: 1 },
      };
    }),
  };
}

function QueueChoices({
  id,
  model,
  choices,
  ticked,
  setTicked,
  locked,
  requestsLeft = null,
  dailyCap = null,
  error = '',
  onStart,
  onStartAll,
}: {
  id: string;
  model: string;
  choices: QueueChoice[];
  ticked: string[];
  setTicked: (f: (t: string[]) => string[]) => void;
  locked: boolean;
  requestsLeft?: number | null;
  /** The connection's plan requests a day (review 3 of PR #176, L-2). */
  dailyCap?: number | null;
  error?: string;
  onStart: () => void;
  onStartAll: () => void;
}) {
  const eligible = choices.filter((c) => c.eligible);
  const picked = eligible.filter((c) => ticked.includes(c.name));
  const blocked = choices.filter((c) => c.state.kind === 'not_allowed');
  const requests = (l: QueueChoice[]) => l.reduce((n, c) => n + c.requests, 0);
  // The warning is about what Qualify selected would send, or Qualify all when none is ticked.
  const over = picked.length ? picked : eligible;
  const overCap = dailyCap !== null && requests(over) > dailyCap;
  return (
    <div className="qualify-several" role="group" aria-labelledby={`qs-${id}`}>
      <p id={`qs-${id}`}>
        <strong>Qualify several tasks</strong>
      </p>
      {eligible.length === 0 ? (
        <p className="small">
          {model} has no task left to qualify here
          {blocked.length
            ? `; ${blocked.map((c) => words(c.task_class)).join(', ')} ${blocked.length === 1 ? 'is' : 'are'} not allowed on this connection`
            : ''}
          .
        </p>
      ) : (
        <>
          <p className="small">
            Tick the tasks to qualify {model} for. The studio runs them one
            after another, so you can leave this page. Each one is checked and
            counted against this connection&apos;s caps when its turn comes, and
            a failure or a refusal stops the queue there.
          </p>
          {eligible.map((c) => (
            <label key={c.name} className="qualify-choice">
              <input
                type="checkbox"
                checked={ticked.includes(c.name)}
                disabled={locked}
                onChange={(e) => {
                  const on = e.target.checked;
                  setTicked((t) =>
                    on ? [...t, c.name] : t.filter((x) => x !== c.name),
                  );
                }}
              />{' '}
              {words(c.task_class)} · {c.name} (up to {c.requests} plan
              requests)
              {c.state.kind === 'started'
                ? c.state.qualification.executing
                  ? ' · running now'
                  : ' · started; a queue continues it'
                : c.state.kind === 'failed'
                  ? ' · last run failed'
                  : ''}
            </label>
          ))}
          {blocked.length > 0 && (
            <p className="small">
              Not allowed on this connection, so not offered:{' '}
              {blocked.map((c) => words(c.task_class)).join(', ')}. To allow
              one, choose it as the Benchmark above and press &quot;Allow this
              task&quot;, or change them under Change caps or allowed work.
            </p>
          )}
          <div className="inline-form">
            <button
              type="button"
              disabled={locked || picked.length === 0}
              onClick={onStart}
            >
              Qualify selected
              {picked.length
                ? ` (${picked.length}, up to ${requests(picked)} plan requests)`
                : ''}
            </button>
            <button
              type="button"
              className="secondary"
              disabled={locked}
              onClick={onStartAll}
            >
              Qualify all ({eligible.length}, up to {requests(eligible)} plan
              requests)
            </button>
          </div>
          {overCap && (
            <p className="small" role="note">
              {over === picked
                ? 'The selected tasks need'
                : 'Qualify all needs'}{' '}
              up to {requests(over)} plan requests, more than this
              connection&apos;s cap of {dailyCap} in any 24 hours, so the queue
              stops at the cap partway through. Its answered cases are kept:
              queue the rest once requests free up, 24 hours after each was
              sent.
            </p>
          )}
          {requestsLeft !== null && (
            <p className="small">
              {Math.max(0, requestsLeft)} plan request
              {requestsLeft === 1 ? '' : 's'} left in this connection&apos;s
              24-hour cap
              {!overCap && requestsLeft < requests(eligible)
                ? '; a queue that needs more stops at the cap, and its answered cases are kept'
                : ''}
              .
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </>
      )}
    </div>
  );
}

const ITEM_STATE: Record<QualificationQueue['items'][number]['state'], string> =
  {
    waiting: 'waiting',
    running: 'running',
    qualified: 'qualified',
    failed: 'did not qualify',
    stopped: 'stopped',
    cancelled: 'not started',
  };

/** Where a queue stands, in the Qualify section; finished ones can be hidden. */
export function QueueProgress({
  queue,
  busy,
  onCancel,
  onHide,
}: {
  queue: QualificationQueue;
  busy: boolean;
  onCancel: () => void;
  onHide: () => void;
}) {
  const ended = queue.items.filter(
    (i) => i.state !== 'waiting' && i.state !== 'running',
  ).length;
  const running = queue.state === 'running';
  return (
    <div className="qualify-queue" role="status">
      <p>
        {running
          ? `Qualifying ${queue.model_id} one task after another: ${ended} of ${queue.items.length} done. You can leave this page; it carries on.`
          : queue.state === 'done'
            ? `The queue for ${queue.model_id} finished: ${queue.items.filter((i) => i.state === 'qualified').length} of ${queue.items.length} qualified.`
            : `The queue for ${queue.model_id} ${queue.state === 'cancelled' ? 'was cancelled' : 'stopped'}${queue.reason ? `. ${queue.reason}` : '.'}`}
        {running && !queue.active
          ? ' Waiting for the studio to pick it up (after a restart this takes up to two minutes).'
          : ''}
      </p>
      <ol className="small">
        {queue.items.map((i) => (
          <li key={i.position}>
            {words(i.task_class)} · {i.manifest_name}: {ITEM_STATE[i.state]}
            {i.reason &&
            i.state !== 'cancelled' &&
            // Review N-2: a stop reason the queue line already gives is not repeated.
            !(queue.reason ?? '').includes(i.reason)
              ? ` (${i.reason})`
              : ''}
          </li>
        ))}
      </ol>
      {running ? (
        <button
          type="button"
          className="secondary"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel the queue (the task now running finishes)
        </button>
      ) : (
        <button type="button" className="text" onClick={onHide}>
          Hide
        </button>
      )}
    </div>
  );
}
