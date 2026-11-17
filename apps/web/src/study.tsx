import { useEffect, useRef, useState } from 'react';
import {
  z,
  StudySummarySchema,
  StudyAttemptSchema,
  StudyEffortStepSchema,
  STUDY_EFFORT_IDLE_MS,
  STUDY_EFFORT_TIMER_VERSION,
  STUDY_EFFORT_REFUSAL,
  type StudyAttempt,
  type StudyEffort,
  type StudyEffortStep,
  type StudySummary,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { useOnShow } from './page-active.js';
import {
  EffortClock,
  afterRefusal,
  effortText,
  stepOnOpen,
  type EffortTotals,
} from './effort-timer.js';
import './study-effort.css';

const Entry = z.object({
  id: z.string(),
  kind: z.string(),
  payload: z.unknown(),
  content_hash: z.string(),
});
const Detail = z.object({
  manifest: z.unknown(),
  attempts: z.array(StudyAttemptSchema),
});
export function Studies({
  workspace,
  session,
}: {
  workspace: Workspace;
  session: SessionInfo;
}) {
  const [studies, setStudies] = useState<z.infer<typeof StudySummarySchema>[]>(
    [],
  );
  const [selected, setSelected] = useState('');
  const [attempts, setAttempts] = useState<StudyAttempt[]>([]);
  const [attempt, setAttempt] = useState<StudyAttempt | null>(null);
  const [context, setContext] = useState<unknown>(null);
  const [entries, setEntries] = useState<z.infer<typeof Entry>[]>([]);
  const [content, setContent] = useState('');
  const [minutes, setMinutes] = useState('0');
  const [waitSeconds, setWaitSeconds] = useState('0');
  const [artifactKind, setArtifactKind] = useState('document');
  const [savedArtifact, setSavedArtifact] = useState<{
    id: string;
    content_hash: string;
  } | null>(null);
  const [expected, setExpected] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  // ADR-0122 (F13), ADR-0129: the running step's timer, and the attempt's timed steps. A step
  // runs while the participant has a human-only or assisted attempt open, and the next
  // intervention, saved entry or finish ends it.
  const [step, setStep] = useState<StudyEffortStep | null>(null);
  // Read by startStep after a save, when the `step` captured by the save handler is stale.
  const stepRef = useRef<StudyEffortStep | null>(null);
  const [starting, setStarting] = useState(false);
  const [effortSteps, setEffortSteps] = useState<StudyEffortStep[]>([]);
  const clock = useRef<EffortClock | null>(null);
  // Review M-3: steps of attempts the person left while the page stayed open, with their clocks
  // still running (the time away counts as "page not in front"), by attempt id.
  const parked = useRef(
    new Map<string, { step: StudyEffortStep; clock: EffortClock }>(),
  );
  const attemptPanel = useRef<HTMLDivElement | null>(null);
  const [, setTick] = useState(0);
  const timing = step !== null;
  useEffect(() => {
    if (!timing) return;
    const now = () => performance.now();
    const edited = () => clock.current?.edited(now());
    const visibility = () =>
      clock.current?.visibility(now(), document.visibilityState === 'visible');
    const focus = () => clock.current?.focus(now(), true);
    const blur = () => clock.current?.focus(now(), false);
    const panel = attemptPanel.current;
    for (const kind of ['input', 'keydown', 'change'] as const)
      panel?.addEventListener(kind, edited);
    document.addEventListener('visibilitychange', visibility);
    window.addEventListener('focus', focus);
    window.addEventListener('blur', blur);
    const timer = window.setInterval(() => setTick((n) => n + 1), 1000);
    return () => {
      for (const kind of ['input', 'keydown', 'change'] as const)
        panel?.removeEventListener(kind, edited);
      document.removeEventListener('visibilitychange', visibility);
      window.removeEventListener('focus', focus);
      window.removeEventListener('blur', blur);
      window.clearInterval(timer);
    };
  }, [timing]);
  /** Set once the person picks a study, so the automatic open never overrides them. */
  const picked = useRef(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `workspaces/${workspace.id}`;
  async function load() {
    const list = await api(z.array(StudySummarySchema), `${base}/studies`);
    setStudies(list);
    return list;
  }
  useEffect(() => {
    setSelected('');
    picked.current = false;
    // Another workspace's attempts are not timed here; their open steps stay unfinished.
    parked.current.clear();
    clock.current = null;
    stepRef.current = null;
    setStep(null);
    setAttempt(null);
    setAttempts([]);
    setContext(null);
    // Open the newest study straight away so the page shows its attempts, not an empty picker,
    // unless the workspace changed or the person already picked one while the list loaded.
    let stale = false;
    void load()
      .then((list) => {
        const newest = list.reduce<StudySummary | null>(
          (a, b) => (!a || b.created_at > a.created_at ? b : a),
          null,
        );
        if (newest && !stale && !picked.current) return openStudy(newest.id);
      })
      .catch((e) => {
        if (!stale) setError(message(e));
      });
    return () => {
      stale = true;
    };
  }, [workspace.id]);
  useOnShow(() => void load().catch((e) => setError(message(e))));
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    // While a step is timed, a studio request in flight is the person's waiting time.
    const timed = clock.current;
    timed?.requestStarted(performance.now());
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      timed?.requestEnded(performance.now());
      setBusy(false);
    }
  }
  function stopTiming() {
    if (stepRef.current) parked.current.delete(stepRef.current.attempt_id);
    clock.current = null;
    stepRef.current = null;
    setStep(null);
  }
  /** Leaves the running step for another attempt or study; its clock keeps counting, as away. */
  function parkTiming() {
    const s = stepRef.current;
    const c = clock.current;
    if (s && c) {
      c.visibility(performance.now(), false);
      parked.current.set(s.attempt_id, { step: s, clock: c });
    }
    clock.current = null;
    stepRef.current = null;
    setStep(null);
  }
  async function loadEffort(attemptId: string) {
    const steps = await api(
      z.array(StudyEffortStepSchema),
      `${base}/study-attempts/${attemptId}/effort-steps`,
    );
    setEffortSteps(steps);
    return steps;
  }
  /** Times `s` on this page from now (a new step, or one continued after a return). */
  function runStep(s: StudyEffortStep) {
    clock.current = new EffortClock(
      performance.now(),
      {
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
      },
      STUDY_EFFORT_IDLE_MS,
    );
    stepRef.current = s;
    setStep(s);
  }
  /** Only the assigned person's own steps on a human-only or assisted attempt are timed. */
  function timedFor(a: StudyAttempt) {
    return (
      a.condition !== 'autonomous' &&
      a.state === 'assigned' &&
      a.participant_actor_id.toLowerCase() === session.actor_id.toLowerCase()
    );
  }
  async function startStep(target: StudyAttempt | null = attempt) {
    if (!target || stepRef.current || starting) return;
    setStarting(true);
    let started: StudyEffortStep;
    try {
      started = await api(
        StudyEffortStepSchema,
        `${base}/study-attempts/${target.id}/effort-steps`,
        { body: {}, csrf: session.csrf_token },
      );
    } finally {
      setStarting(false);
    }
    runStep(started);
    await loadEffort(target.id);
  }
  /**
   * After a save ended the step, times the next one. Returns a sentence to add to the save's
   * notice when it can't start (past the time cap, say), so one message says both (review N-2).
   */
  async function nextStep(attemptId: string): Promise<string> {
    try {
      await startStep();
      return '';
    } catch (e) {
      await loadEffort(attemptId);
      return ` No further steps are timed: ${message(e)}`;
    }
  }
  /** The running step's totals, to send with the record that ends it. */
  function stepEffort(): StudyEffort | undefined {
    const s = stepRef.current;
    const c = clock.current;
    return s && c
      ? {
          step_id: s.id,
          timer_version: STUDY_EFFORT_TIMER_VERSION,
          ...c.totals(performance.now()),
        }
      : undefined;
  }
  /**
   * Saves a record that ends the running step, with its measured time when one is running.
   * If the studio refuses the save while it carries timing, the timer stops so that saving
   * again records the work without it (the record matters more than its timing).
   */
  async function writeEnding(action: string, body: object) {
    const effort = stepEffort();
    try {
      const result = await write(action, {
        ...body,
        ...(effort ? { effort } : {}),
      });
      if (effort) stopTiming();
      return { result, timed: effort !== undefined };
    } catch (e) {
      // Review M-1: only a refusal of the timing itself stops the timer; any other refusal
      // (a submit before an entry, say) leaves the step running, since nothing was saved.
      if (effort && afterRefusal(message(e), STUDY_EFFORT_REFUSAL) === 'stop') {
        stopTiming();
        throw new Error(
          `${message(e)} The step timer has stopped; save again to record this without its time.`,
        );
      }
      throw e;
    }
  }
  async function openStudy(id: string) {
    setSelected(id);
    parkTiming();
    setAttempt(null);
    setContext(null);
    if (!id) {
      setAttempts([]);
      return;
    }
    const d = await api(Detail, `${base}/studies/${id}`);
    setAttempts(d.attempts);
  }
  async function openAttempt(a: StudyAttempt) {
    // Review M-2: a second click on the attempt being timed keeps its step running.
    const same = stepRef.current?.attempt_id === a.id;
    if (!same) {
      parkTiming();
      setEffortSteps([]);
    }
    setEntries(
      await api(z.array(Entry), `${base}/study-attempts/${a.id}/entries`),
    );
    setAttempt(a);
    setConfirmStop(false);
    setContent('');
    setSavedArtifact(null);
    setContext(
      await api(z.unknown(), `${base}/study-attempts/${a.id}/context`),
    );
    if (a.condition !== 'autonomous') await loadEffort(a.id);
    // ADR-0129: opening the attempt times it. Coming back to it while the page stayed open
    // resumes its kept clock, so nothing measured is lost. After a reload there is no clock, so a
    // new step starts and the old one stays unfinished. If a new step can't start (past the
    // time cap, say), the readout says the timer is not running and offers Start.
    const plan = stepOnOpen({
      timed: timedFor(a),
      running: stepRef.current,
      attemptId: a.id,
      parked: parked.current.has(a.id),
    });
    const kept = parked.current.get(a.id);
    if (plan.kind === 'resume' && kept) {
      parked.current.delete(a.id);
      const now = performance.now();
      kept.clock.visibility(now, document.visibilityState === 'visible');
      kept.clock.focus(now, document.hasFocus());
      clock.current = kept.clock;
      stepRef.current = kept.step;
      setStep(kept.step);
    }
    if (plan.kind === 'start') await startStep(a).catch(() => undefined);
  }
  async function write(action: string, body: unknown) {
    if (!attempt) return;
    const result = await api(
      z.unknown(),
      `${base}/study-attempts/${attempt.id}/${action}`,
      {
        body,
        csrf: session.csrf_token,
      },
    );
    setEntries(
      await api(z.array(Entry), `${base}/study-attempts/${attempt.id}/entries`),
    );
    return result;
  }
  return (
    <section className="panel">
      <h2>Study runner</h2>
      <span className="badge">Synthetic · draft protocol</span>
      <p>
        Fixture assignments test the study workflow. They are not empirical
        results. Consent and recruitment remain unresolved.
      </p>
      <button
        className="primary"
        disabled={busy || workspace.record_mode !== 'fixture'}
        onClick={() =>
          void perform(async () => {
            const s = await api(
              z.object({ study: StudySummarySchema }),
              `${base}/studies/seed`,
              { body: {}, csrf: session.csrf_token },
            );
            picked.current = true;
            await load();
            await openStudy(s.study.id);
          })
        }
      >
        Create synthetic three-arm study
      </button>
      <label>
        Study
        <select
          value={selected}
          onChange={(e) => {
            picked.current = true;
            void perform(() => openStudy(e.target.value));
          }}
        >
          <option value="">Choose a study</option>
          {studies.map((s) => (
            <option key={s.id} value={s.id}>
              {s.title} · {s.id.slice(0, 8)}
            </option>
          ))}
        </select>
      </label>
      {selected && (
        <button
          className="secondary"
          disabled={busy}
          onClick={() =>
            void perform(async () => {
              const data = await api(
                z.unknown(),
                `${base}/studies/${selected}/export`,
              );
              const url = URL.createObjectURL(
                new Blob([JSON.stringify(data, null, 2)], {
                  type: 'application/json',
                }),
              );
              const a = document.createElement('a');
              a.href = url;
              a.download = `synthetic-study-${selected}.json`;
              a.click();
              URL.revokeObjectURL(url);
              setNotice('Synthetic study export downloaded.');
            })
          }
        >
          Export study
        </button>
      )}
      {selected && (
        <div className="actions">
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void perform(() => openStudy(selected))}
          >
            Refresh outcomes
          </button>
          <button
            className="secondary"
            disabled={busy}
            onClick={() =>
              void perform(async () => {
                const study = studies.find((x) => x.id === selected)!;
                await api(z.unknown(), `${base}/studies/${selected}/assign`, {
                  csrf: session.csrf_token,
                  body: {
                    manifest_hash: study.manifest_hash,
                    participant_actor_id: session.actor_id,
                    participant_code: 'synthetic-owner',
                    prior_familiarity:
                      'Same synthetic operator; not independent participants.',
                    condition: 'autonomous',
                    comparison: 'discovery',
                    discovery_method: 'open_ended',
                    continuation_of: null,
                  },
                });
                await openStudy(selected);
              })
            }
          >
            Add open-ended fixture baseline
          </button>
        </div>
      )}
      <ul className="attempt-list">
        {attempts.map((a) => (
          <li key={a.id}>
            <button
              className="secondary"
              aria-pressed={attempt?.id === a.id}
              onClick={() => void perform(() => openAttempt(a))}
            >
              #{a.order} · {a.condition.replaceAll('_', ' ')} · {a.state}
            </button>
            {!a.primary &&
              ' · assisted continuation, excluded from primary comparison'}
          </li>
        ))}
      </ul>
      {attempt && (
        <div className="panel" ref={attemptPanel}>
          <h3>
            {attempt.condition === 'human_only'
              ? 'Human-only workspace'
              : 'Assigned attempt'}
          </h3>
          <p>
            Assigned condition: {attempt.condition}. Generative helpers are
            unavailable here. Entries are preserved verbatim. Code is stored,
            never executed on the studio host.
          </p>
          <details>
            <summary>Frozen participant context</summary>
            <pre>{JSON.stringify(context, null, 2)}</pre>
          </details>
          {attempt.condition !== 'autonomous' &&
            attempt.state === 'assigned' && (
              <div className="study-effort">
                <TimerReadout
                  busy={busy}
                  onStart={() => void perform(() => startStep())}
                  timer={
                    attempt.participant_actor_id.toLowerCase() !==
                    session.actor_id.toLowerCase()
                      ? { state: 'not_participant' }
                      : step && clock.current
                        ? {
                            state: 'running',
                            totals: clock.current.totals(performance.now()),
                          }
                        : { state: starting ? 'starting' : 'off' }
                  }
                />
                <span className="study-effort-note">
                  Your time on this attempt is timed in steps: each{' '}
                  {attempt.condition === 'human_in_loop'
                    ? 'saved intervention or entry'
                    : 'saved entry'}{' '}
                  ends one and starts the next, and submitting or stopping ends
                  the last. Active means this page is in front and you edited in
                  the last minute; time on the page without editing (reading,
                  say) is counted on its own. The timer measures time only; your
                  reported minutes below stay your own report.
                  {attempt.synthetic &&
                    ' This is a synthetic study, so it times the operator testing the workflow, not a participant.'}
                </span>
              </div>
            )}
          {attempt.condition !== 'autonomous' && effortSteps.length > 0 && (
            <EffortSummary
              steps={effortSteps}
              running={step?.id ?? null}
              synthetic={attempt.synthetic}
            />
          )}
          {attempt.condition !== 'human_only' && (
            <button
              disabled={busy || attempt.state !== 'assigned'}
              onClick={() =>
                void perform(async () => {
                  await api(
                    z.unknown(),
                    `${base}/study-attempts/${attempt.id}/execute`,
                    { body: {}, csrf: session.csrf_token, timeoutMs: 40000 },
                  );
                  await openStudy(selected);
                  setNotice(
                    'Synthetic execution dispatched. Refresh the study to inspect its outcome.',
                  );
                })
              }
            >
              Execute frozen fixture workflow
            </button>
          )}
          {attempt.state === 'needs_human' &&
            attempt.condition === 'autonomous' && (
              <button
                disabled={busy}
                onClick={() =>
                  void perform(async () => {
                    await api(
                      z.unknown(),
                      `${base}/studies/${selected}/assign`,
                      {
                        csrf: session.csrf_token,
                        body: {
                          manifest_hash: attempt.manifest_hash,
                          participant_actor_id: session.actor_id,
                          participant_code: attempt.participant_code,
                          prior_familiarity:
                            'Assisted continuation of prior stopped attempt.',
                          condition: 'human_in_loop',
                          discovery_method: attempt.discovery_method,
                          comparison: attempt.comparison,
                          continuation_of: attempt.id,
                        },
                      },
                    );
                    await openStudy(selected);
                  })
                }
              >
                Create separate assisted continuation
              </button>
            )}
          <details>
            <summary>Saved entries and checks ({entries.length})</summary>
            {entries.map((e) => (
              <details key={e.id}>
                <summary>
                  {e.kind.replaceAll('_', ' ')} - {e.content_hash.slice(0, 12)}
                </summary>
                <pre>{JSON.stringify(e.payload, null, 2)}</pre>
              </details>
            ))}
          </details>
          <label>
            Entry type
            <select
              value={artifactKind}
              onChange={(e) => setArtifactKind(e.target.value)}
            >
              <option value="document">Document</option>
              <option value="code">Code (stored only)</option>
              <option value="artifact">Artifact text</option>
            </select>
          </label>
          <label>
            Your document or code
            <textarea
              rows={8}
              value={content}
              maxLength={24000}
              disabled={
                attempt.condition === 'autonomous' ||
                attempt.state !== 'assigned'
              }
              onChange={(e) => setContent(e.target.value)}
            />
          </label>
          <button
            disabled={
              busy ||
              !content.trim() ||
              attempt.condition === 'autonomous' ||
              attempt.state !== 'assigned'
            }
            onClick={() =>
              void perform(async () => {
                const { result: saved, timed } = await writeEnding(
                  'artifacts',
                  {
                    kind: artifactKind,
                    name: 'Participant submission',
                    content,
                  },
                );
                setSavedArtifact(saved as { id: string; content_hash: string });
                // ADR-0129: the saved entry ended the step; the next one is timed from now.
                const more = timed ? await nextStep(attempt.id) : '';
                setNotice(
                  (timed
                    ? 'Saved verbatim with an immutable content hash, with the measured step time.'
                    : 'Saved verbatim with an immutable content hash.') + more,
                );
              })
            }
          >
            Save entry
          </button>
          {savedArtifact && (
            <div>
              <label>
                Text to check for
                <input
                  value={expected}
                  onChange={(e) => setExpected(e.target.value)}
                />
              </label>
              <button
                disabled={busy || !expected}
                onClick={() =>
                  void perform(async () => {
                    const result = await write('tests', {
                      artifact_id: savedArtifact.id,
                      artifact_hash: savedArtifact.content_hash,
                      check: 'contains',
                      expected,
                    });
                    setNotice(
                      z.object({ passed: z.boolean() }).parse(result).passed
                        ? 'Text check passed for the saved artifact.'
                        : 'Text check failed for the saved artifact.',
                    );
                  })
                }
              >
                Run conventional text check
              </button>
            </div>
          )}
          {attempt.condition === 'human_in_loop' &&
            attempt.state === 'assigned' && (
              <InterventionEditor
                busy={busy}
                save={(body) =>
                  perform(async () => {
                    const { timed } = await writeEnding(
                      'interventions',
                      body as object,
                    );
                    // The intervention ended the step; the next one is timed from now
                    // (review M-1 of #221).
                    const more = timed ? await nextStep(attempt.id) : '';
                    if (!timed) await loadEffort(attempt.id);
                    setNotice(
                      (timed
                        ? 'Intervention, reported effort and measured step time saved.'
                        : 'Intervention and reported effort saved.') + more,
                    );
                  })
                }
              />
            )}
          <label>
            Reported waiting seconds
            <input
              type="number"
              min="0"
              max="86400"
              value={waitSeconds}
              onChange={(e) => setWaitSeconds(e.target.value)}
            />
          </label>
          <label>
            Reported active minutes
            <input
              type="number"
              min="0"
              max="1440"
              value={minutes}
              onChange={(e) => setMinutes(e.target.value)}
            />
          </label>
          <div className="actions split">
            <button
              disabled={busy || attempt.state !== 'assigned'}
              onClick={() =>
                void perform(async () => {
                  const { timed } = await writeEnding('finish', {
                    status: 'submitted',
                    summary:
                      'Participant submitted saved work; not independently verified.',
                    human_active_minutes: Number(minutes),
                    human_wait_seconds: Number(waitSeconds),
                  });
                  await openStudy(selected);
                  setNotice(
                    timed
                      ? 'Submission recorded with the measured time of its last step. This is not a verified-success rating.'
                      : 'Submission recorded. This is not a verified-success rating.',
                  );
                })
              }
            >
              Submit saved work
            </button>
            {confirmStop ? (
              <span
                className="confirm-inline"
                role="group"
                aria-label="Stop attempt"
              >
                {attempt.condition === 'autonomous'
                  ? 'Stop this autonomous attempt? It is marked as needing a person; an assisted continuation can follow, outside the primary comparison.'
                  : 'Stop this attempt? It is recorded as cancelled and can’t be resumed.'}{' '}
                <button
                  className="secondary"
                  onClick={() => setConfirmStop(false)}
                >
                  Keep working
                </button>
                <button
                  className="secondary danger"
                  disabled={busy || attempt.state !== 'assigned'}
                  onClick={() =>
                    void perform(async () => {
                      setConfirmStop(false);
                      await writeEnding('finish', {
                        status:
                          attempt.condition === 'autonomous'
                            ? 'needs_human'
                            : 'cancelled',
                        summary: 'Stopped by operator.',
                        human_active_minutes: Number(minutes),
                        human_wait_seconds: Number(waitSeconds),
                      });
                      await openStudy(selected);
                    })
                  }
                >
                  Stop attempt
                </button>
              </span>
            ) : (
              <button
                className="secondary stop"
                disabled={busy || attempt.state !== 'assigned'}
                onClick={() => setConfirmStop(true)}
              >
                Stop attempt…
              </button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
    </section>
  );
}

function EffortSummary({
  steps,
  running,
  synthetic,
}: {
  steps: StudyEffortStep[];
  running: string | null;
  synthetic: boolean;
}) {
  const timed = steps.flatMap((s) => (s.measured ? [s.measured] : []));
  const total = (k: keyof EffortTotals) =>
    effortText(timed.reduce((n, m) => n + m[k], 0));
  // The step being timed now is not unfinished; one left open earlier (reload, other attempt) is.
  const open = steps.filter((s) => !s.measured && s.id !== running).length;
  return (
    <p className="study-effort-summary">
      Measured on this attempt: {timed.length} timed{' '}
      {timed.length === 1 ? 'step' : 'steps'} · active {total('active_ms')} ·
      waiting on the studio {total('wait_ms')} · on the page, not editing{' '}
      {total('idle_ms')} · page not in front {total('away_ms')}
      {open > 0 && ` · ${open} unfinished`}
      {steps.some((s) => s.measured?.ended_by === 'finish') &&
        ' · finish timed'}
      {synthetic && ' (synthetic: the operator, not a participant)'}
    </p>
  );
}

type TimerView =
  | { state: 'running'; totals: EffortTotals }
  | { state: 'starting' | 'off' | 'not_participant' };

function TimerReadout({
  timer,
  busy,
  onStart,
}: {
  timer: TimerView;
  busy: boolean;
  onStart: () => void;
}) {
  if (timer.state === 'running') {
    const t = timer.totals;
    return (
      <span>
        <strong>Timing this step</strong> · active {effortText(t.active_ms)} ·
        waiting on the studio {effortText(t.wait_ms)} · on the page, not editing{' '}
        {effortText(t.idle_ms)} · page not in front {effortText(t.away_ms)}
      </span>
    );
  }
  if (timer.state === 'starting') return <span>Starting the step timer…</span>;
  if (timer.state === 'not_participant')
    return (
      <span>
        Not timed: only the person assigned to this attempt has their steps
        timed.
      </span>
    );
  return (
    <span>
      Timer not running.{' '}
      <button
        type="button"
        className="secondary"
        disabled={busy}
        onClick={onStart}
      >
        Start timing this step
      </button>
    </span>
  );
}

function InterventionEditor({
  busy,
  save,
}: {
  busy: boolean;
  save: (body: unknown) => Promise<void>;
}) {
  const [fields, setFields] = useState({
    type: 'judgment',
    gate: 'dynamic',
    reason: '',
    trigger: '',
    stage: '',
    data_shown: '',
    human_input: '',
    resulting_change: '',
    prevented_problem: 'unknown',
    human_active_minutes: '0',
    wait_seconds: '0',
  });
  const labels = {
    reason: 'Reason',
    trigger: 'Trigger',
    stage: 'Stage',
    data_shown: 'Information shown',
    human_input: 'Human response',
    resulting_change: 'Resulting change',
  };
  return (
    <details>
      <summary>Record human intervention</summary>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void save({
            ...fields,
            human_active_minutes: Number(fields.human_active_minutes),
            wait_seconds: Number(fields.wait_seconds),
          });
        }}
      >
        <label>
          Intervention type
          <select
            value={fields.type}
            onChange={(e) => setFields({ ...fields, type: e.target.value })}
          >
            {['clarification', 'judgment', 'authorization', 'feedback'].map(
              (v) => (
                <option key={v}>{v}</option>
              ),
            )}
          </select>
        </label>
        <label>
          Gate
          <select
            value={fields.gate}
            onChange={(e) => setFields({ ...fields, gate: e.target.value })}
          >
            <option>fixed</option>
            <option>dynamic</option>
          </select>
        </label>
        {Object.entries(labels).map(([key, label]) => (
          <label key={key}>
            {label}
            <textarea
              required
              maxLength={8000}
              value={fields[key as keyof typeof fields]}
              onChange={(e) => setFields({ ...fields, [key]: e.target.value })}
            />
          </label>
        ))}
        <label>
          Prevented a problem?
          <select
            value={fields.prevented_problem}
            onChange={(e) =>
              setFields({ ...fields, prevented_problem: e.target.value })
            }
          >
            <option>unknown</option>
            <option>yes</option>
            <option>no</option>
          </select>
        </label>
        <label>
          Reported active response minutes
          <input
            type="number"
            min="0"
            max="1440"
            value={fields.human_active_minutes}
            onChange={(e) =>
              setFields({ ...fields, human_active_minutes: e.target.value })
            }
          />
        </label>
        <label>
          Reported wait seconds
          <input
            type="number"
            min="0"
            max="86400"
            value={fields.wait_seconds}
            onChange={(e) =>
              setFields({ ...fields, wait_seconds: e.target.value })
            }
          />
        </label>
        <button disabled={busy}>Save intervention</button>
      </form>
    </details>
  );
}
