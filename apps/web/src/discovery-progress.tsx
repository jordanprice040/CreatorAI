import { useEffect, useRef, useState } from 'react';
import {
  WorkflowDetailSchema,
  WorkflowSchema,
  z,
  type SessionInfo,
  type Workflow,
  type WorkflowTask,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { usePoll } from './page-active.js';
import { clipText, runName } from './labels.js';
import { reveal, runNames, StaleNote, useLoad, type View } from './ui.js';
import { useViewMode } from './view-mode.js';
import {
  discoveryLine,
  shownDiscoveries,
  type ProgressTone,
} from './discovery-progress-rules.js';

const TONE_TEXT: Record<ProgressTone, string> = {
  running: 'Running',
  waiting: 'Needs you',
  done: 'Finished',
  stopped: 'Stopped',
};

const hiddenKey = (actor: string, ws: string) =>
  `creator.hiddenDiscoveries.${actor}.${ws}`;
function readHidden(key: string): Set<string> {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(key) ?? '[]');
    return new Set(
      Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [],
    );
  } catch {
    return new Set();
  }
}

/**
 * Final UX pass P-6 (ADR-0103): the workspace's discoveries in plain words, where the work is
 * (Discover and Decide), with what to do next, so starting one no longer leaves Projects for
 * Monitor › Runs. Live ones are read again every few seconds while the page is shown.
 */
export function DiscoveryProgress({
  session,
  workspace,
  open,
  where,
  keep = '',
  skipProblem = '',
  onFinished,
}: {
  session: SessionInfo;
  workspace: Workspace;
  open: (view: View, id?: string) => void;
  /** The page it sits on: Discover reveals its own Search the web panel; Decide links to it. */
  where: 'discover' | 'decide';
  /** The discovery just started here: always listed, and scrolled to once it shows. */
  keep?: string;
  /** Decide's open problem: a finished line about it would only repeat the page. */
  skipProblem?: string;
  /** Called when a listed discovery finishes, so the page can read its new records. */
  onFinished?: () => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const { standard } = useViewMode();
  const key = hiddenKey(session.actor_id, workspace.id);
  const [hidden, setHidden] = useState(() => readHidden(key));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const d = useLoad(async () => {
    const [list, names] = await Promise.all([
      api(z.array(WorkflowSchema), `${base}/workflows`),
      runNames(base),
    ]);
    const live = list.filter(
      (w) => w.role === 'r02_discovery' && !w.finished_at,
    );
    const tasks = new Map<string, WorkflowTask[]>();
    await Promise.all(
      live.map((w) =>
        api(WorkflowDetailSchema, `${base}/workflows/${w.id}`)
          .then((x) => tasks.set(w.id, x.tasks))
          .catch(() => undefined),
      ),
    );
    return { list, names, tasks };
  }, [workspace.id, keep]);
  const rows = d.data
    ? shownDiscoveries(d.data.list, Date.now(), hidden, keep)
    : [];
  const anyLive = rows.some((w) => !w.finished_at);
  usePoll(d.refresh, 3000, anyLive);

  // Tell the page when a discovery it was showing as live has finished, and remember which
  // ones were live while the page was open (Decide keeps listing those once they finish).
  const wasLive = useRef(new Set<string>());
  const [seenLive, setSeenLive] = useState<ReadonlySet<string>>(new Set());
  useEffect(() => {
    if (!d.data) return;
    const nowLive = new Set(
      d.data.list
        .filter((w) => w.role === 'r02_discovery' && !w.finished_at)
        .map((w) => w.id),
    );
    if ([...wasLive.current].some((id) => !nowLive.has(id))) onFinished?.();
    wasLive.current = nowLive;
    if ([...nowLive].some((id) => !seenLive.has(id)))
      setSeenLive(new Set([...seenLive, ...nowLive]));
  }, [d.data]);

  // Show the discovery just started once its line is on the page.
  const sectionRef = useRef<HTMLElement>(null);
  const shownKeep = useRef('');
  useEffect(() => {
    if (!keep || shownKeep.current === keep) return;
    if (!rows.some((w) => w.id === keep)) return;
    shownKeep.current = keep;
    reveal(sectionRef.current, `dp-${keep}`);
  });

  function hide(id: string) {
    const next = new Set(hidden).add(id);
    setHidden(next);
    try {
      localStorage.setItem(key, JSON.stringify([...next].slice(-50)));
    } catch {
      // Only this browser's convenience: the line just shows again next time.
    }
  }
  async function control(wf: Workflow, action: 'pause' | 'resume' | 'cancel') {
    setError('');
    setBusy(wf.id);
    try {
      await api(WorkflowDetailSchema, `${base}/workflows/${wf.id}/${action}`, {
        csrf: session.csrf_token,
        body: {
          expected_version: wf.version,
          reason: `${action[0]!.toUpperCase()}${action.slice(1)} chosen in the discovery progress list.`,
        },
      });
      d.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy('');
    }
  }

  const shown = rows
    .map((wf) => ({
      wf,
      line: discoveryLine(wf, d.data?.tasks.get(wf.id) ?? null),
    }))
    // Decide lists a finished discovery only when it ran while the page was open; its earlier
    // results are already in the Problem list (and on Discover).
    .filter(
      ({ wf }) =>
        where === 'discover' || !wf.finished_at || seenLive.has(wf.id),
    )
    .filter(
      ({ wf, line }) =>
        !wf.finished_at || wf.id === keep || line.problemId !== skipProblem,
    );
  if (shown.length === 0 && !error && !d.error) return null;
  const viewer = workspace.role === 'viewer';
  const onDiscover = where === 'discover';
  return (
    <section
      className="discovery-progress"
      aria-labelledby={`dp-title-${workspace.id}`}
      ref={sectionRef}
    >
      <h3 id={`dp-title-${workspace.id}`}>Discoveries</h3>
      <StaleNote stale={d.stale} />
      {d.error && (
        <p className="error" role="alert">
          Could not read discoveries: {d.error}{' '}
          <button type="button" className="text" onClick={d.reload}>
            Try again
          </button>
        </p>
      )}
      <ul aria-live="polite">
        {shown.map(({ wf, line }) => {
          const name = runName(wf.run_id, d.data?.names ?? new Map());
          return (
            <li key={wf.id} id={`dp-${wf.id}`} tabIndex={-1}>
              <p>
                <span className={`badge dp-${line.tone}`}>
                  {TONE_TEXT[line.tone]}
                </span>{' '}
                <strong>{name ? clipText(name, 80) : 'Discovery'}</strong>{' '}
                <span className="muted">
                  · started {when(wf.created_at)}
                  {wf.fixture ? ' · fixture rules, not a model' : ''}
                </span>
              </p>
              <p className="small">{line.text}</p>
              <div className="actions">
                {line.next === 'decide' && line.problemId && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => open('compare', line.problemId!)}
                  >
                    {where === 'decide' ? 'Open its problem' : 'Open in Decide'}
                  </button>
                )}
                {line.next === 'approvals' && (
                  <button
                    type="button"
                    className="secondary"
                    onClick={() => open('decisions')}
                  >
                    Open Approvals
                  </button>
                )}
                {line.next === 'evidence' && (
                  <>
                    {onDiscover ? (
                      <button
                        type="button"
                        className="secondary"
                        onClick={(e) => reveal(e.currentTarget, 'web-title')}
                      >
                        Search the web
                      </button>
                    ) : (
                      <button
                        type="button"
                        className="secondary"
                        onClick={() => open('submit')}
                      >
                        Open Discover
                      </button>
                    )}
                    <button
                      type="button"
                      className="secondary"
                      onClick={() => open('evidence')}
                    >
                      Sources and claims
                    </button>
                  </>
                )}
                {!wf.finished_at && !viewer && (
                  <>
                    {wf.control === 'pause' ? (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy === wf.id}
                        onClick={() => void control(wf, 'resume')}
                      >
                        Resume
                      </button>
                    ) : (
                      wf.control === 'run' && (
                        <button
                          type="button"
                          className="secondary"
                          disabled={busy === wf.id}
                          onClick={() => void control(wf, 'pause')}
                        >
                          Pause
                        </button>
                      )
                    )}
                    {wf.control !== 'cancel' && (
                      <button
                        type="button"
                        className="secondary"
                        disabled={busy === wf.id}
                        onClick={() => void control(wf, 'cancel')}
                      >
                        Cancel
                      </button>
                    )}
                  </>
                )}
                {wf.finished_at && wf.id !== keep && (
                  <button
                    type="button"
                    className="text"
                    onClick={() => hide(wf.id)}
                  >
                    Hide
                  </button>
                )}
                {!standard && (
                  <button
                    type="button"
                    className="text"
                    onClick={() => open('runs', wf.id)}
                  >
                    Run details →
                  </button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
