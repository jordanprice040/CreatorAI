import {
  ActivityPageSchema,
  DecisionSchema,
  OverviewSchema,
  WorkflowDetailSchema,
  WorkflowSchema,
  z,
  type SessionInfo,
  type Workflow,
  type Workspace,
} from '@creator/contracts';
import { useEffect, useState } from 'react';
import { api, message, when, words } from './oversight.js';
import { money } from './budgets.js';
import { usePageActive } from './page-drafts.js';
import {
  Empty,
  STATE_NOTE,
  StateBadge,
  eventText,
  Status,
  shortId,
  useLoad,
  type View,
} from './ui.js';

const LIVE = [
  'queued',
  'running',
  'waiting_dependency',
  'waiting_human',
  'paused_operator',
  'reconciling',
];

/** Run monitor: what is running, what waits for a person, what it costs, what just happened. */
export function Overview({
  session,
  workspace,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const [error, setError] = useState('');
  const data = useLoad(async () => {
    const [overview, workflows, decisions, activity] = await Promise.all([
      api(OverviewSchema, `${base}/overview`),
      api(z.array(WorkflowSchema), `${base}/workflows`),
      api(z.array(DecisionSchema), `${base}/decisions?status=pending`),
      api(ActivityPageSchema, `${base}/activity?limit=8`),
    ]);
    return { overview, workflows, decisions, activity };
  }, [workspace.id]);
  async function control(w: Workflow, action: 'pause' | 'resume' | 'cancel') {
    setError('');
    try {
      await api(WorkflowDetailSchema, `${base}/workflows/${w.id}/${action}`, {
        csrf: session.csrf_token,
        body: {
          expected_version: w.version,
          reason: `Owner chose ${action} from the monitor.`,
        },
      });
    } catch (e) {
      setError(message(e));
    }
    data.reload();
  }
  const active = usePageActive();
  const d = data.data;
  const o = d?.overview;
  const fixture = workspace.record_mode === 'fixture';
  const live = d?.workflows.filter((w) => LIVE.includes(w.state)) ?? [];
  const recent =
    d?.workflows.filter((w) => !LIVE.includes(w.state)).slice(0, 5) ?? [];
  const viewer = workspace.role === 'viewer';
  // While anything runs or waits, refresh every few seconds so state changes show up.
  useEffect(() => {
    if (!active || live.length === 0) return;
    const t = setInterval(data.reload, 4000);
    return () => clearInterval(t);
  }, [active, live.length]);
  return (
    <section className="panel" aria-labelledby="mon-title">
      <div className="decision-head">
        <h2 id="mon-title">Monitor</h2>
        <button className="secondary" onClick={data.reload}>
          Refresh
        </button>
      </div>
      <p>
        What runs on the server, what waits for you, and what it has cost.
        Closing this page stops nothing; only Pause and Cancel do. While work is
        in progress the page refreshes itself.
      </p>
      <Status
        loading={data.loading && !d}
        error={data.error}
        retry={data.reload}
      >
        {o && d && (
          <>
            <div className="tiles">
              <button className="tile" onClick={() => open('decisions')}>
                <strong>{o.decisions.pending}</strong>
                <span>decisions waiting for you</span>
                {o.decisions.expiring_24h > 0 && (
                  <small>{o.decisions.expiring_24h} expire within a day</small>
                )}
              </button>
              <button className="tile" onClick={() => open('runs')}>
                <strong>{live.length}</strong>
                <span>workflows in progress</span>
                <small>
                  {o.runs.active} active runs · {o.runs.cancelled} cancelled
                </small>
              </button>
              <button className="tile" onClick={() => open('budgets')}>
                <strong>{money(o.budget.incurred, fixture)}</strong>
                <span>charged of {money(o.budget.cap, fixture)} funded</span>
                <small>
                  {money(o.budget.reserved, fixture)} in flight ·{' '}
                  {money(o.budget.unknown, fixture)} held unknown ·{' '}
                  {o.budget.denied_calls} calls refused
                </small>
              </button>
              <button className="tile" onClick={() => open('evidence')}>
                <strong>{o.sources.count}</strong>
                <span>sources</span>
                <small>
                  {o.sources.last_fetched_at
                    ? `last fetched ${when(o.sources.last_fetched_at)}`
                    : 'nothing fetched yet'}
                </small>
              </button>
            </div>

            <h3>Waiting for you</h3>
            {d.decisions.length === 0 ? (
              <Empty>Nothing needs you right now.</Empty>
            ) : (
              <ul className="rows">
                {d.decisions.slice(0, 6).map((x) => (
                  <li key={x.id}>
                    <span className={`badge kind-${x.kind}`}>{x.kind}</span>{' '}
                    <button
                      className="text"
                      onClick={() => open('decisions', x.id)}
                    >
                      {x.question}
                    </button>
                    <small>
                      {' '}
                      · run {shortId(x.run_id)} · expires {when(x.expires_at)}
                    </small>
                  </li>
                ))}
              </ul>
            )}

            <h3>In progress</h3>
            {live.length === 0 ? (
              <Empty>No workflow is running or waiting.</Empty>
            ) : (
              <ul className="rows">
                {live.map((w) => (
                  <li key={w.id}>
                    <StateBadge state={w.state} />{' '}
                    <button className="text" onClick={() => open('runs', w.id)}>
                      {w.role === 'r02_discovery'
                        ? 'Discovery'
                        : 'Skeptic review'}{' '}
                      {shortId(w.id)}
                    </button>
                    <small>
                      {' '}
                      · {STATE_NOTE[w.state]} · {words(w.reason)} · updated{' '}
                      {when(w.updated_at)}
                      {w.control !== 'run' ? ` · ${w.control} requested` : ''}
                    </small>
                    {!viewer && (
                      <span className="row-actions">
                        {w.control === 'run' && (
                          <button
                            className="secondary"
                            onClick={() => void control(w, 'pause')}
                          >
                            Pause
                          </button>
                        )}
                        {w.control === 'pause' && (
                          <button
                            className="secondary"
                            onClick={() => void control(w, 'resume')}
                          >
                            Resume
                          </button>
                        )}
                        {w.control !== 'cancel' && (
                          <button
                            className="secondary"
                            onClick={() => void control(w, 'cancel')}
                          >
                            Cancel
                          </button>
                        )}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {o.attention.some((a) => a.state === 'failed') && (
              <p className="small">
                Failed recently:{' '}
                {o.attention
                  .filter((a) => a.state === 'failed')
                  .map((a) => `${shortId(a.workflow_id)} (${words(a.reason)})`)
                  .join(', ')}
              </p>
            )}
            {recent.length > 0 && (
              <>
                <h3>Recently finished</h3>
                <ul className="rows">
                  {recent.map((w) => {
                    // A run can finish cleanly yet conclude something else ("insufficient
                    // evidence"); show that conclusion instead of a second "succeeded".
                    const outcome = w.result?.outcome;
                    const differs =
                      w.state === 'succeeded' && outcome && outcome !== w.state;
                    const note = outcome ?? w.reason;
                    return (
                      <li key={w.id}>
                        {differs ? (
                          <span
                            className="badge wf-outcome"
                            title="Finished; this is what the run concluded"
                          >
                            {words(outcome)}
                          </span>
                        ) : (
                          <StateBadge state={w.state} />
                        )}{' '}
                        <button
                          className="text"
                          onClick={() => open('runs', w.id)}
                        >
                          {w.role === 'r02_discovery'
                            ? 'Discovery'
                            : 'Skeptic review'}{' '}
                          {shortId(w.id)}
                        </button>
                        <small>
                          {' '}
                          {!differs && note && note !== w.state
                            ? `· ${words(note)} `
                            : ''}
                          · {when(w.finished_at ?? w.updated_at)}
                        </small>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}

            <div className="records-grid">
              <div>
                <h3>Catalog</h3>
                {o.records.length === 0 ? (
                  <Empty>No records yet. Submit a theme to start.</Empty>
                ) : (
                  <ul className="rows">
                    {o.records.map((r) => (
                      <li key={r.kind}>
                        <button
                          className="text"
                          onClick={() => open('catalog', `kind:${r.kind}`)}
                        >
                          <span className="kind">{words(r.kind)}</span>{' '}
                          {r.active} active
                        </button>
                        <small>
                          {r.archived ? ` · ${r.archived} archived` : ''}
                          {r.redacted ? ` · ${r.redacted} redacted` : ''}
                        </small>
                      </li>
                    ))}
                  </ul>
                )}
                <h3>Product stages</h3>
                {o.products.length === 0 ? (
                  <Empty>
                    No product records yet. Selecting an option doesn&apos;t
                    create one; packaged builds are listed in Gallery.
                  </Empty>
                ) : (
                  <ul className="rows">
                    {o.products.map((p) => (
                      <li key={p.id}>
                        <span className="kind">{words(p.stage)}</span>{' '}
                        <button
                          className="text"
                          onClick={() => open('catalog', p.id)}
                        >
                          {p.title}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div>
                <h3>Latest activity</h3>
                {d.activity.entries.length === 0 ? (
                  <Empty>No activity yet.</Empty>
                ) : (
                  <ol className="rows history">
                    {d.activity.entries.map((e) => (
                      <li key={e.event_id}>
                        {eventText(e.summary)}
                        <small>
                          {' '}
                          · {e.actor.display_name}
                          {e.actor.kind === 'human'
                            ? ''
                            : ` (${e.actor.kind})`}{' '}
                          · {when(e.occurred_at)}
                        </small>
                      </li>
                    ))}
                  </ol>
                )}
                <button className="text" onClick={() => open('activity')}>
                  All activity →
                </button>
              </div>
            </div>
            <p className="small">As of {when(o.generated_at)}.</p>
          </>
        )}
      </Status>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
