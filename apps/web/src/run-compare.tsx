import { useEffect, useState } from 'react';
import {
  AutopilotSchema,
  RUN_COMPARISON_LABEL,
  RunComparisonSchema,
  z,
  type Autopilot,
  type RunComparisonSide,
  type Workspace,
} from '@creator/contracts';
import { api } from './oversight.js';
import { Status, shortId, useLoad } from './ui.js';
import {
  compareRows,
  defaultPair,
  outcomeText,
  pairFrom,
  stageName,
  stopKindName,
} from './run-compare-rules.js';
import type { View } from './pages.js';
import './run-compare.css';

// ADR-0120 (F7): two autopilots side by side, read only. It answers "did the other model or
// setting do better here?" from the records each one left; it is labelled as a comparison of
// two runs, never a study result.

const TitledSchema = z.object({ id: z.string(), title: z.string() });

function problemOf(a: Autopilot): string {
  return (
    [...a.steps].reverse().find((s) => s.problem)?.problem?.id ??
    a.config.start?.problem.id ??
    ''
  );
}

function pickLabel(a: Autopilot, names: Map<string, string>): string {
  const when = new Date(a.created_at).toLocaleString();
  const problem = names.get(problemOf(a));
  const outcome =
    a.state === 'running'
      ? 'running'
      : (a.outcome ?? 'finished').replaceAll('_', ' ');
  return `${when} · ${outcome}${problem ? ` · ${problem.slice(0, 60)}` : ''} · ${shortId(a.id)}`;
}

export function RunCompare({
  workspace,
  focus,
  onFocus,
  open,
}: {
  workspace: Workspace;
  /** `a,b` autopilot ids from the address. */
  focus: string;
  onFocus: (id: string) => void;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const list = useLoad(async () => {
    const [autopilots, problems] = await Promise.all([
      api(z.array(AutopilotSchema), `${base}/autopilots`),
      api(z.array(TitledSchema), `${base}/entities?kind=problem`).catch(
        () => [],
      ),
    ]);
    return {
      autopilots: [...autopilots].sort((x, y) =>
        y.created_at.localeCompare(x.created_at),
      ),
      names: new Map(problems.map((p) => [p.id, p.title])),
    };
  }, [workspace.id]);
  const autopilots = list.data?.autopilots ?? [];
  const pair = defaultPair(autopilots, focus);
  const [a, setA] = useState(pair?.[0] ?? '');
  const [b, setB] = useState(pair?.[1] ?? '');
  // Fill the pickers once the list arrives (or the address names a pair).
  useEffect(() => {
    const p = defaultPair(autopilots, focus);
    if (!p) return;
    setA((x) => (x && pairFrom(focus) === null ? x : p[0]));
    setB((x) => (x && pairFrom(focus) === null ? x : p[1]));
  }, [list.data, focus]);

  const ready = !!a && !!b && a !== b;
  const cmp = useLoad(
    async () =>
      ready
        ? api(
            RunComparisonSchema,
            `${base}/run-comparison?a=${encodeURIComponent(a)}&b=${encodeURIComponent(b)}`,
          )
        : null,
    [workspace.id, a, b],
  );
  const choose = (na: string, nb: string) => {
    setA(na);
    setB(nb);
    if (na && nb && na !== nb) onFocus(`${na},${nb}`);
  };
  const names = list.data?.names ?? new Map<string, string>();
  const c = cmp.data;
  const rows = c ? compareRows(c) : [];

  return (
    <section className="panel run-compare" aria-labelledby="run-compare-title">
      <h2 id="run-compare-title">Compare two runs</h2>
      <p className="run-compare-label" role="note">
        <strong>{RUN_COMPARISON_LABEL}</strong> One problem, one try each, read
        from what each autopilot recorded. It shows where they differed, not
        which way of working is better.
      </p>
      <Status
        loading={list.loading}
        error={list.error}
        stale={list.stale}
        retry={list.reload}
      >
        {autopilots.length < 2 ? (
          <p className="small">
            Comparing needs two autopilots in this workspace. Start one from the
            Autopilot tab.{' '}
            <button
              type="button"
              className="text small"
              onClick={() => open('autopilot')}
            >
              Open Autopilot
            </button>
          </p>
        ) : (
          <div className="run-compare-pick">
            <label>
              Left
              <select value={a} onChange={(e) => choose(e.target.value, b)}>
                <option value="">Choose an autopilot</option>
                {autopilots.map((x) => (
                  <option key={x.id} value={x.id} disabled={x.id === b}>
                    {pickLabel(x, names)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Right
              <select value={b} onChange={(e) => choose(a, e.target.value)}>
                <option value="">Choose an autopilot</option>
                {autopilots.map((x) => (
                  <option key={x.id} value={x.id} disabled={x.id === a}>
                    {pickLabel(x, names)}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              className="secondary small"
              disabled={!ready}
              onClick={() => choose(b, a)}
            >
              Swap
            </button>
          </div>
        )}
      </Status>
      {ready && (
        <Status
          loading={cmp.loading}
          error={cmp.error}
          stale={cmp.stale}
          retry={cmp.reload}
        >
          {c && (
            <>
              {c.cautions.length > 0 && (
                <div className="run-compare-cautions" role="note">
                  <p className="small">Read the columns with care:</p>
                  <ul className="small">
                    {c.cautions.map((t) => (
                      <li key={t}>{t}</li>
                    ))}
                  </ul>
                </div>
              )}
              <div className="table-wrap">
                <table className="ranking run-compare-table">
                  <caption className="small">
                    {c.same_problem
                      ? 'Both worked on the same problem.'
                      : 'They worked on different problems.'}{' '}
                    Rows that differ are marked ≠.
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">
                        <span className="sr-only">What</span>
                      </th>
                      <ColumnHead side={c.a} name="Left" />
                      <ColumnHead side={c.b} name="Right" />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r, i) => (
                      <tr
                        key={`${r.group}-${r.label}`}
                        className={
                          (r.differs ? 'differs' : '') +
                          (i > 0 && rows[i - 1]!.group !== r.group
                            ? ' group-start'
                            : '')
                        }
                      >
                        <th scope="row">
                          {r.differs && (
                            <>
                              <span className="differs-mark" aria-hidden="true">
                                ≠{' '}
                              </span>
                              <span className="sr-only">Differs: </span>
                            </>
                          )}
                          {r.label}
                        </th>
                        <td>{r.a}</td>
                        <td>{r.b}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="run-compare-columns">
                <SideDetail side={c.a} name="Left" open={open} />
                <SideDetail side={c.b} name="Right" open={open} />
              </div>
              <p className="small run-compare-muted">
                Read {new Date(c.read_at).toLocaleString()}. Claims on a problem
                and scores where no choice was recorded can change after an
                autopilot ends.
              </p>
            </>
          )}
        </Status>
      )}
    </section>
  );
}

function ColumnHead({ side, name }: { side: RunComparisonSide; name: string }) {
  return (
    <th scope="col">
      {name}: {outcomeText(side)}
      <span className="small run-compare-muted">
        {' '}
        · {shortId(side.autopilot.id)}
        {side.autopilot.fixture ? ' · fixture' : ''}
      </span>
    </th>
  );
}

function SideDetail({
  side,
  name,
  open,
}: {
  side: RunComparisonSide;
  name: string;
  open: (view: View, id?: string) => void;
}) {
  return (
    <article className="run-compare-side" aria-label={`${name} autopilot`}>
      <h3>
        {name}: {side.problem?.title ?? 'No problem reached'}
      </h3>
      <p className="small">{side.autopilot.explanation}</p>
      <h4>
        Options
        {side.options.scores_from === 'current' ? ' (scores as of now)' : ''}
      </h4>
      {side.options.ranked.length ? (
        <ol className="small">
          {side.options.ranked.map((o) => (
            <li key={o.id}>
              {o.title}{' '}
              <span className="run-compare-muted">
                · {o.kind.replaceAll('_', ' ')}
                {o.score ? ` · ${o.score}` : ' · not scored'}
                {o.disposition
                  ? ` · ${o.disposition.replaceAll('_', ' ')}`
                  : ''}
              </span>
            </li>
          ))}
        </ol>
      ) : (
        <p className="small run-compare-muted">No options were scored.</p>
      )}
      {side.options.count > side.options.ranked.length && (
        <p className="small run-compare-muted">
          {side.options.count - side.options.ranked.length} more not shown.
        </p>
      )}
      <h4>Stops</h4>
      {side.stops.length ? (
        <ul className="small">
          {side.stops.map((s) => (
            <li key={`${s.stage}-${s.attempt}`}>
              {stageName(s.stage)} (try {s.attempt})
              {s.kind ? `, ${stopKindName(s.kind)}` : ''}:{' '}
              {s.note || 'No note.'}
              {s.decision_id && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="text small"
                    onClick={() => open('decisions', s.decision_id!)}
                  >
                    Open the question
                  </button>
                </>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="small run-compare-muted">It never stopped.</p>
      )}
      {side.choice?.rationale && (
        <>
          <h4>Why this choice</h4>
          <p className="small">{side.choice.rationale}</p>
        </>
      )}
      <p className="small">
        <button
          type="button"
          className="text small"
          onClick={() => open('autopilot', side.autopilot.id)}
        >
          Open this autopilot
        </button>
        {side.proposal && (
          <>
            {' · '}
            <button
              type="button"
              className="text small"
              onClick={() => open('proposals', side.proposal!.id)}
            >
              Open its proposal
            </button>
          </>
        )}
      </p>
    </article>
  );
}
