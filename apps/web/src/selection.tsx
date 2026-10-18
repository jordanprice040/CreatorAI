import { useEffect, useState } from 'react';
import {
  SelectionReportSchema,
  SelectionSchema,
  SpecStatusSchema,
  StoredEntitySchema,
  WorkspaceSchema,
  z,
  type RubricRanking,
  type Selection,
  type SelectionReport,
  type SpecStatus,
  type StoredEntity,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';

const GATE_LABEL: Record<string, string> = {
  clear: 'clear',
  unresolved: 'unresolved',
  not_assessed: 'not assessed',
};

function Ranking({
  title,
  ranking,
  names,
}: {
  title: string;
  ranking: RubricRanking;
  names: Map<string, string>;
}) {
  const changed = ranking.sensitivity.scenarios.filter(
    (s) => s.shortlist_changed,
  );
  return (
    <>
      <h3>
        {title} <small>· {ranking.rubric_version}</small>
      </h3>
      {ranking.candidates.length === 0 ? (
        <p className="small">No candidates in this ranking.</p>
      ) : (
        <div className="table-wrap">
          <table className="ranking">
            <thead>
              <tr>
                <th scope="col">Rank</th>
                <th scope="col">Candidate</th>
                <th scope="col">Score</th>
                <th scope="col">Bounds</th>
                <th scope="col">Notes</th>
                <th scope="col">Gates</th>
              </tr>
            </thead>
            <tbody>
              {ranking.candidates.map((c) => (
                <tr key={c.alternative.id}>
                  <td>{c.rank ?? '—'}</td>
                  <td>
                    <span className="kind">{words(c.alternative.kind)}</span>{' '}
                    {c.alternative.title}
                  </td>
                  <td className={`score-${c.status}`}>
                    {c.score ? c.score.display : words(c.status)}
                  </td>
                  <td>
                    {c.range
                      ? `${c.range.lower.display}–${c.range.upper.display}`
                      : '—'}
                  </td>
                  <td className="small">
                    {c.unknown_criteria.length > 0 && (
                      <div>
                        Unknown: {c.unknown_criteria.map(words).join(', ')}
                      </div>
                    )}
                    {c.disagreements.length > 0 && (
                      <div>
                        Reviewers differ on{' '}
                        {c.disagreements
                          .map((d) => words(d.criterion))
                          .join(', ')}
                      </div>
                    )}
                    {c.overlaps_with.length > 0 && (
                      <div>
                        Unresolved against{' '}
                        {c.overlaps_with
                          .map(
                            (id) =>
                              names.get(id)?.slice(0, 40) ?? id.slice(0, 8),
                          )
                          .join('; ')}
                      </div>
                    )}
                    {c.scorecards.some((s) => s.stale) && (
                      <div>Stale scorecards not counted</div>
                    )}
                  </td>
                  <td className="small">
                    <div className={`gate-${c.gates.ethics_access}`}>
                      Ethics/access: {GATE_LABEL[c.gates.ethics_access]}
                    </div>
                    {c.gates.humility !== 'not_applicable' && (
                      <div className={`gate-${c.gates.humility}`}>
                        Humility: {words(c.gates.humility)}
                      </div>
                    )}
                    {c.gates.discovery && (
                      <div>Discovery: {words(c.gates.discovery)}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {ranking.excluded.length > 0 && (
        <p className="small">
          Not in this ranking: {ranking.excluded.length} non-software response
          {ranking.excluded.length === 1 ? '' : 's'} (see suitability).
        </p>
      )}
      <p className="small">
        Sensitivity (each weight removed or doubled):{' '}
        {ranking.sensitivity.baseline.length === 0
          ? 'no fully scored candidates to compare.'
          : ranking.sensitivity.stable
            ? 'the shortlist did not change.'
            : `the shortlist changes under ${changed.map((s) => s.name).join(', ')}.`}
      </p>
    </>
  );
}

/**
 * Read-only view of rankings, selections and specifications. Scores are computed from the
 * current scorecards; selecting and freezing are admitted actions done through the CLI/API,
 * and their approvals appear in Human decisions.
 */
export function Scoring() {
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [workspace, setWorkspace] = useState('');
  const [problems, setProblems] = useState<StoredEntity[]>([]);
  const [problem, setProblem] = useState('');
  const [alternatives, setAlternatives] = useState<StoredEntity[]>([]);
  const [report, setReport] = useState<SelectionReport | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [specs, setSpecs] = useState<StoredEntity[]>([]);
  const [spec, setSpec] = useState<SpecStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const base = `workspaces/${workspace}`;

  useEffect(() => {
    void (async () => {
      try {
        const list = await api(z.array(WorkspaceSchema), 'workspaces');
        setWorkspaces(list);
        setWorkspace((c) => c || (list[0]?.id ?? ''));
      } catch (e) {
        setError(message(e));
      }
    })();
  }, []);
  async function loadWorkspace() {
    if (!workspace) return;
    setError('');
    try {
      const [p, a, s] = await Promise.all([
        api(z.array(StoredEntitySchema), `${base}/entities?kind=problem`),
        api(z.array(StoredEntitySchema), `${base}/entities?kind=alternative`),
        api(z.array(StoredEntitySchema), `${base}/entities?kind=specification`),
      ]);
      setProblems(p.filter((x) => x.status === 'active'));
      setAlternatives(a);
      setSpecs(s.filter((x) => x.body?.format === 'spec/1'));
      setProblem((cur) =>
        p.some((x) => x.id === cur) ? cur : (p[0]?.id ?? ''),
      );
    } catch (e) {
      setError(message(e));
    }
  }
  useEffect(() => {
    setReport(null);
    setSelections([]);
    setSpec(null);
    void loadWorkspace();
  }, [workspace]);
  useEffect(() => {
    if (!problem) return;
    setLoading(true);
    setError('');
    void (async () => {
      try {
        const [r, s] = await Promise.all([
          api(SelectionReportSchema, `${base}/problems/${problem}/report`),
          api(
            z.array(SelectionSchema),
            `${base}/problems/${problem}/selections`,
          ),
        ]);
        setReport(r);
        setSelections(s);
      } catch (e) {
        setReport(null);
        setError(message(e));
      } finally {
        setLoading(false);
      }
    })();
  }, [problem, workspace]);
  async function openSpec(id: string) {
    setError('');
    try {
      setSpec(await api(SpecStatusSchema, `${base}/specs/${id}`));
    } catch (e) {
      setError(message(e));
    }
  }
  const names = new Map(alternatives.map((a) => [a.id, a.title]));
  const fixture =
    workspaces.find((w) => w.id === workspace)?.record_mode === 'fixture';

  return (
    <section className="panel records" aria-labelledby="sel-title">
      <div className="eyebrow">07 / SCORING AND SELECTION</div>
      <h2 id="sel-title">Rankings, selections and specs</h2>
      <p>
        Scores are transparent prioritization aids from reviewers&apos; 1–5
        ratings, not probabilities or measured impact. Unknown ratings are never
        averaged away. Ethics, access and the humility review are gates that no
        score can clear. Select and freeze through the CLI (
        <code>pnpm cli select</code>, <code>pnpm cli spec-freeze</code>);
        approvals appear under Human decisions.
      </p>
      <div className="connection">
        <label htmlFor="sel-ws" className="inline">
          Workspace
        </label>
        <select
          id="sel-ws"
          value={workspace}
          onChange={(e) => setWorkspace(e.target.value)}
        >
          {workspaces.length === 0 && (
            <option value="">No workspaces yet</option>
          )}
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name} · {w.record_mode === 'fixture' ? 'FIXTURE' : 'real'}
            </option>
          ))}
        </select>
        <label htmlFor="sel-problem" className="inline">
          Problem
        </label>
        <select
          id="sel-problem"
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
        >
          {problems.length === 0 && <option value="">No problems yet</option>}
          {problems.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title.slice(0, 80)}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={() => void loadWorkspace()}>
          Refresh
        </button>
      </div>
      {fixture && <span className="badge">SYNTHETIC · FIXTURE REVIEWERS</span>}
      {loading && <p className="small">Computing the report…</p>}
      {!loading && problems.length === 0 && (
        <p className="small">
          No problem records yet. Run a discovery (or{' '}
          <code>pnpm cli seed-selection</code>) to create candidates.
        </p>
      )}
      {report && (
        <>
          <Ranking
            title="Software opportunity"
            ranking={report.opportunity}
            names={names}
          />
          <Ranking
            title="Solution suitability (all responses)"
            ranking={report.suitability}
            names={names}
          />
          <p className="small">
            Report <code>{report.report_hash.slice(0, 12)}</code> · a selection
            must name this hash, so a decision is never made on a changed
            report.
          </p>
        </>
      )}
      {report && (
        <>
          <h3>Selections</h3>
          {selections.length === 0 ? (
            <p className="small">No selection recorded for this problem.</p>
          ) : (
            <ol className="selections">
              {selections.map((s) => (
                <li key={s.id}>
                  <strong>{s.current ? 'Current' : 'Replaced'}</strong> ·{' '}
                  {when(s.created_at)} · {s.rationale}
                  <ul>
                    {s.dispositions.map((d) => (
                      <li key={d.alternative.id}>
                        <span className="kind">{words(d.disposition)}</span>{' '}
                        {names
                          .get(d.alternative.id.toLowerCase())
                          ?.slice(0, 80) ?? d.alternative.id.slice(0, 8)}
                        <small>
                          {' '}
                          — {d.reasons.join(' ')} Reverse if: {d.reverse_if}
                        </small>
                      </li>
                    ))}
                  </ul>
                  {s.overrides.map((o) => (
                    <p
                      key={`${o.alternative}-${o.ranking}`}
                      className="override"
                    >
                      Override of the {o.ranking} ranking: advanced at original
                      rank {o.original_rank ?? 'unranked'} (
                      {o.original_score ?? 'no score'}) over{' '}
                      {o.outranked_by
                        .map((b) => `rank ${b.rank} (${b.score})`)
                        .join(', ')}
                      . Reason: {s.override_reason}
                    </p>
                  ))}
                </li>
              ))}
            </ol>
          )}
        </>
      )}
      <h3>Specifications</h3>
      {specs.length === 0 ? (
        <p className="small">No specifications in this workspace.</p>
      ) : (
        <ul className="entities">
          {specs.map((s) => (
            <li key={s.id}>
              <button
                className="text"
                aria-current={spec?.spec.id === s.id}
                onClick={() => void openSpec(s.id)}
              >
                {s.title} <small>v{s.version}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {spec && (
        <div className="spec">
          <p>
            <strong>
              v{spec.spec.version} ·{' '}
              {spec.frozen_current
                ? 'frozen'
                : spec.latest_freeze
                  ? `changed since v${spec.latest_freeze.spec.version} was frozen`
                  : 'not frozen'}
            </strong>
          </p>
          <ul>
            {spec.tasks.map((t) => (
              <li key={t.key}>
                <span className={`kind task-${t.status}`}>{t.status}</span>{' '}
                {t.key} · {t.title}
              </li>
            ))}
            {spec.removed_tasks.map((k) => (
              <li key={k}>
                <span className="kind task-removed">removed</span> {k}
              </li>
            ))}
          </ul>
          {spec.problems.length > 0 && (
            <p className="error">
              Task graph: {spec.problems.map((p) => p.detail).join(' ')}
            </p>
          )}
          {spec.blockers.length > 0 && (
            <p className="small">
              Cannot freeze now: {spec.blockers.join(' ')}
            </p>
          )}
        </div>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
