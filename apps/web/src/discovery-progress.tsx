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

/**
 * Reveals a heading on the page that is shown once it is there (review N-1, L-2): after moving
 * to Discover, which may be mounting for the first time, it looks a few times. `reveal` opens
 * the Discover panel that holds it.
 */
export function revealWhenShown(heading: string) {
  whenShown(heading, (page) => reveal(page, heading));
}

/**
 * Runs `then` once the page in view holds `heading` (it may be mounting for the first time),
 * looking every 100 ms for up to 2 s.
 */
export function whenShown(heading: string, then: (page: Element) => void) {
  let tries = 0;
  const look = () => {
    const page = document.querySelector('.draft-page:not([hidden])');
    if (page?.querySelector(`#${CSS.escape(heading)}`)) then(page);
    else if (++tries < 20) setTimeout(look, 100);
  };
  setTimeout(look, 0);
}

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
  // Tell the page when a discovery it was showing as live has finished, and remember which
  // ones were live while the page was open (Decide keeps listing those once they finish).
  const wasLive = useRef(new Set<string>());
  const [seenLive, setSeenLive] = useState<ReadonlySet<string>>(new Set());
  // Decide lists a finished discovery only when it ran while the page was open (its earlier
  // results are already in the Problem list and on Discover), and not when its problem is the
  // one open. Applied before the cap (review M-1), so it never hides a line that would fit.
  const include = (w: Workflow) =>
    where === 'discover'
      ? true
      : seenLive.has(w.id) &&
        w.result?.discovery?.catalog_records.problem?.id !== skipProblem;
  const rows = d.data
    ? shownDiscoveries(d.data.list, Date.now(), hidden, keep, include)
    : [];
  // Every live discovery is listed, so polling runs while any is live (review M-1).
  const anyLive = rows.some((w) => !w.finished_at);
  usePoll(d.refresh, 3000, anyLive);
  // Review N-3: finished lines after the first are folded, so the start choices stay near.
  const [more, setMore] = useState(false);
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
    reveal(sectionRef.current, `dp-${where}-${keep}`);
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

  const all = rows.map((wf) => ({
    wf,
    line: discoveryLine(wf, d.data?.tasks.get(wf.id) ?? null),
  }));
  if (all.length === 0 && !error && !d.error) return null;
  const firstDone = all.findIndex(({ wf }) => wf.finished_at);
  const foldable = firstDone < 0 ? 0 : all.length - (firstDone + 1);
  const folded = more ? 0 : foldable;
  const shown = all.slice(0, all.length - folded);
  // Review L-1: the workflow controls are owner-only on the server.
  const owner = workspace.role === 'owner';
  const onDiscover = where === 'discover';
  // Review N-5: Discover and Decide stay mounted together, so the id names the page too.
  const titleId = `dp-title-${where}-${workspace.id}`;
  // Review N-2: screen readers hear when a discovery's state changes, not every step count.
  const states = all
    .map(
      ({ wf, line }) =>
        `${runName(wf.run_id, d.data?.names ?? new Map()) || 'Discovery'}: ${TONE_TEXT[line.tone]}`,
    )
    .join('; ');
  return (
    <section
      className="discovery-progress"
      aria-labelledby={titleId}
      ref={sectionRef}
    >
      <h3 id={titleId}>Discoveries</h3>
      <p className="sr-only" role="status">
        {states}
      </p>
      <StaleNote stale={d.stale} />
      {d.error && (
        <p className="error" role="alert">
          Could not read discoveries: {d.error}{' '}
          <button type="button" className="text" onClick={d.reload}>
            Try again
          </button>
        </p>
      )}
      <ul>
        {shown.map(({ wf, line }) => {
          const name = runName(wf.run_id, d.data?.names ?? new Map());
          return (
            <li key={wf.id} id={`dp-${where}-${wf.id}`} tabIndex={-1}>
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
                        onClick={() => {
                          // Review N-1: on its Search the web panel.
                          open('submit');
                          revealWhenShown('web-title');
                        }}
                      >
                        Search the web
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
                {!wf.finished_at && owner && (
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
      {foldable > 0 && (
        <button
          type="button"
          className="text small"
          aria-expanded={more}
          onClick={() => setMore((m) => !m)}
        >
          {more
            ? 'Show fewer finished discoveries'
            : `Show ${foldable} more finished`}
        </button>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
