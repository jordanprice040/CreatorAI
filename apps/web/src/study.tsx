import { useEffect, useState } from 'react';
import {
  z,
  StudySummarySchema,
  StudyAttemptSchema,
  type StudyAttempt,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message } from './oversight.js';

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

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const base = `workspaces/${workspace.id}`;
  async function load() {
    setStudies(await api(z.array(StudySummarySchema), `${base}/studies`));
  }
  useEffect(() => {
    setSelected('');
    setAttempt(null);
    setAttempts([]);
    setContext(null);
    void load().catch((e) => setError(message(e)));
  }, [workspace.id]);
  async function perform(fn: () => Promise<void>) {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await fn();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  async function openStudy(id: string) {
    setSelected(id);
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
    setEntries(
      await api(z.array(Entry), `${base}/study-attempts/${a.id}/entries`),
    );
    setAttempt(a);
    setContent('');
    setSavedArtifact(null);
    setContext(
      await api(z.unknown(), `${base}/study-attempts/${a.id}/context`),
    );
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
          onChange={(e) => void perform(() => openStudy(e.target.value))}
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
      <ul>
        {attempts.map((a) => (
          <li key={a.id}>
            <button
              className="secondary"
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
        <div className="panel">
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
                save={(body) =>
                  perform(async () => {
                    await write('interventions', body);
                    setNotice('Intervention and reported effort saved.');
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
          <button
            className="secondary"
            disabled={busy || attempt.state !== 'assigned'}
            onClick={() =>
              void perform(async () => {
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
          Active response minutes
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
          Wait seconds
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
