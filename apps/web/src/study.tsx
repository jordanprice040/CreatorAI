import { useEffect, useRef, useState } from 'react';
import {
  z,
  StudySummarySchema,
  StudyAttemptSchema,
  StudyEffortStepSchema,
  STUDY_EFFORT_IDLE_MS,
  STUDY_EFFORT_TIMER_VERSION,
  type StudyAttempt,
  type StudyEffort,
  type StudyEffortStep,
  type StudySummary,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message } from './oversight.js';
import { useOnShow } from './page-active.js';
import { EffortClock, effortText, type EffortTotals } from './effort-timer.js';
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
  // ADR-0122 (F13): the current intervention step's timer, and the attempt's timed steps.
  const [step, setStep] = useState<StudyEffortStep | null>(null);
  // Read by startStep after a save, when the `step` captured by the save handler is stale.
  const stepRef = useRef<StudyEffortStep | null>(null);
  const [starting, setStarting] = useState(false);
  const editorOpen = useRef(false);
  const [effortSteps, setEffortSteps] = useState<StudyEffortStep[]>([]);
  const clock = useRef<EffortClock | null>(null);
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
    clock.current = null;
    stepRef.current = null;
    setStep(null);
  }
  async function loadEffort(attemptId: string) {
    setEffortSteps(
      await api(
        z.array(StudyEffortStepSchema),
        `${base}/study-attempts/${attemptId}/effort-steps`,
      ),
    );
  }
  async function startStep() {
    if (!attempt || stepRef.current || starting) return;
    setStarting(true);
    let started: StudyEffortStep;
    try {
      started = await api(
        StudyEffortStepSchema,
        `${base}/study-attempts/${attempt.id}/effort-steps`,
        { body: {}, csrf: session.csrf_token },
      );
    } finally {
      setStarting(false);
    }
    clock.current = new EffortClock(
      performance.now(),
      {
        visible: document.visibilityState === 'visible',
        focused: document.hasFocus(),
      },
      STUDY_EFFORT_IDLE_MS,
    );
    stepRef.current = started;
    setStep(started);
    await loadEffort(attempt.id);
  }
  async function openStudy(id: string) {
    setSelected(id);
    stopTiming();
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
    // A step left open on another attempt stays on record as unfinished.
    stopTiming();
    setEffortSteps([]);
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
    if (a.condition === 'human_in_loop') await loadEffort(a.id);
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
                const saved = await write('artifacts', {
                  kind: artifactKind,
                  name: 'Participant submission',
                  content,
                });
                setSavedArtifact(saved as { id: string; content_hash: string });
                setNotice('Saved verbatim with an immutable content hash.');
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
                synthetic={attempt.synthetic}
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
                onToggle={(open) => {
                  editorOpen.current = open;
                }}
                onStart={() => void perform(startStep)}
                save={(body) =>
                  perform(async () => {
                    const c = clock.current;
                    const effort: StudyEffort | undefined =
                      step && c
                        ? {
                            step_id: step.id,
                            timer_version: STUDY_EFFORT_TIMER_VERSION,
                            ...c.totals(performance.now()),
                          }
                        : undefined;
                    await write('interventions', {
                      ...(body as object),
                      ...(effort ? { effort } : {}),
                    });
                    stopTiming();
                    await loadEffort(attempt.id);
                    setNotice(
                      effort
                        ? 'Intervention, reported effort and measured step time saved.'
                        : 'Intervention and reported effort saved.',
                    );
                    // Review M-1 (#221): the editor stays open, so the next intervention is
                    // a new step and is timed from now.
                    if (editorOpen.current) await startStep();
                  })
                }
              />
            )}
          {attempt.condition === 'human_in_loop' && effortSteps.length > 0 && (
            <EffortSummary
              steps={effortSteps}
              running={step?.id ?? null}
              synthetic={attempt.synthetic}
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
                  await write('finish', {
                    status: 'submitted',
                    summary:
                      'Participant submitted saved work; not independently verified.',
                    human_active_minutes: Number(minutes),
                    human_wait_seconds: Number(waitSeconds),
                  });
                  await openStudy(selected);
                  setNotice(
                    'Submission recorded. This is not a verified-success rating.',
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
                      await write('finish', {
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
  synthetic,
  timer,
  onToggle,
  onStart,
  save,
}: {
  busy: boolean;
  synthetic: boolean;
  timer: TimerView;
  onToggle: (open: boolean) => void;
  onStart: () => void;
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
    <details
      onToggle={(e) => {
        const open = e.currentTarget.open;
        onToggle(open);
        if (open && timer.state === 'off') onStart();
      }}
    >
      <summary>Record human intervention</summary>
      <div className="study-effort">
        <TimerReadout timer={timer} busy={busy} onStart={onStart} />
        <span className="study-effort-note">
          Active means this page is in front and you edited in the last minute;
          time on the page without editing (reading, say) is counted on its own.
          Saving the intervention ends the step and, while this form stays open,
          starts timing the next one. The timer measures time only.
          {synthetic &&
            ' This is a synthetic study, so it times the operator testing the workflow, not a participant.'}
        </span>
      </div>
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
