import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useViewMode } from './view-mode.js';
import {
  FreezeOutcomeSchema,
  SelectionReportSchema,
  SelectionSchema,
  SpecStatusSchema,
  StoredEntitySchema,
  z,
  type FreezeOutcome,
  type RubricRanking,
  type Selection,
  type SelectionReport,
  type SessionInfo,
  type SpecStatus,
  type StoredEntity,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { useDesktopApp } from './desktop-app.js';
import {
  alternativeCounts,
  clip,
  problemLabel,
  RecordOptions,
  type View,
} from './ui.js';
import { useOnShow } from './page-active.js';
import { newestFirst } from './versions.js';
import { Fold, FoldAll, useFolds, type Folds } from './fold.js';

const GATE_LABEL: Record<string, string> = {
  clear: 'clear',
  unresolved: 'unresolved',
  not_assessed: 'not assessed',
};

/** P18: a ranking folded to one line: size, leader, open gates and shortlist stability. */
export function Ranking({
  id,
  folds,
  title,
  ranking,
  names,
}: {
  id: string;
  folds: Folds;
  title: string;
  ranking: RubricRanking;
  names: Map<string, string>;
}) {
  const { standard } = useViewMode();
  const changed = ranking.sensitivity.scenarios.filter(
    (s) => s.shortlist_changed,
  );
  const top = ranking.candidates.find((c) => c.rank === 1);
  const openGates = ranking.candidates.filter(
    (c) =>
      c.gates.ethics_access !== 'clear' ||
      !['not_applicable', 'passing'].includes(c.gates.humility),
  ).length;
  const n = ranking.candidates.length;
  return (
    <Fold
      id={id}
      folds={folds}
      summary={
        <>
          <span className="fold-title">{title}</span>{' '}
          <small>· {ranking.rubric_version}</small>
          <span className="fold-line small">
            {n} candidate{n === 1 ? '' : 's'}
            {top
              ? ` · first: ${clip(top.alternative.title, 60)} (${top.score?.display ?? words(top.status)})`
              : n
                ? ' · none fully scored'
                : ''}
            {openGates > 0 &&
              ` · ${openGates} with a gate not clear (no score clears a gate)`}
            {ranking.sensitivity.baseline.length > 0 &&
              (ranking.sensitivity.stable
                ? ' · shortlist stable'
                : ' · shortlist sensitive to weights')}
          </span>
        </>
      }
    >
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
                          .map((id) =>
                            clip(
                              names.get(id) ??
                                (standard
                                  ? 'an option no longer listed'
                                  : id.slice(0, 8)),
                              40,
                            ),
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
    </Fold>
  );
}

/**
 * Freezes the shown specification version under a run. Freezing is an admitted action: the
 * server may ask for an approval first, which is answered under Decisions; the request is
 * then sent again unchanged. Nothing here grants the approval itself.
 */
function FreezeSpec({
  base,
  session,
  spec,
  selectionRun,
  dataClass,
  open,
  frozen,
}: {
  base: string;
  session: SessionInfo;
  spec: SpecStatus;
  /** The run that made the spec's selection; the server freezes only under that run. */
  selectionRun: string;
  dataClass: 'synthetic' | 'public';
  open: (view: View, id?: string) => void;
  frozen: () => void;
}) {
  const { standard } = useViewMode();
  const runId = selectionRun;
  const [justification, setJustification] = useState('');
  const [outcome, setOutcome] = useState<FreezeOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function freeze(e?: FormEvent) {
    e?.preventDefault();
    if (!runId || !justification.trim()) return;
    setBusy(true);
    setError('');
    setOutcome(null);
    try {
      const r = await api(
        FreezeOutcomeSchema,
        `${base}/runs/${runId}/spec-freezes`,
        {
          csrf: session.csrf_token,
          body: {
            spec: { id: spec.spec.id, version: spec.spec.version },
            justification: justification.trim(),
            data_class: dataClass,
          },
        },
      );
      setOutcome(r);
      if (r.status === 'frozen') frozen();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form className="freeze" onSubmit={(e) => void freeze(e)}>
      <h4>Freeze v{spec.spec.version}</h4>
      <p className="small">
        A frozen version fixes the tasks and acceptance checks a build is held
        to. Later edits make a new version and show which tasks changed.
      </p>
      <p className="small">
        {standard
          ? 'Recorded under the run that made this spec’s selection.'
          : `Recorded under run ${selectionRun.slice(0, 8)}, the run that made this spec’s selection.`}
      </p>
      <label htmlFor="frz-why">Why this version is ready</label>
      <textarea
        id="frz-why"
        rows={2}
        maxLength={1000}
        value={justification}
        onChange={(e) => setJustification(e.target.value)}
      />
      <div className="actions">
        <button
          className="primary"
          type="submit"
          disabled={busy || !runId || !justification.trim()}
        >
          {busy ? 'Freezing…' : 'Freeze this version'}
        </button>
      </div>
      <div aria-live="polite">
        {outcome?.status === 'frozen' && (
          <p className="notice ok">
            Frozen. The tasks above now show as frozen.
          </p>
        )}
        {outcome?.status === 'needs_human' && (
          <div className="notice">
            <strong>Waiting for your approval.</strong>{' '}
            <span>{outcome.admission.explanation}</span>{' '}
            {outcome.admission.decision_id && (
              <button
                className="secondary"
                type="button"
                onClick={() =>
                  open('decisions', outcome.admission.decision_id!)
                }
              >
                Open the decision
              </button>
            )}{' '}
            <button
              className="secondary strong"
              type="button"
              disabled={busy}
              onClick={() => void freeze()}
            >
              I approved it: freeze again
            </button>
          </div>
        )}
        {(outcome?.status === 'denied' || outcome?.status === 'deferred') && (
          <p className="error">
            {words(outcome.status)} ({words(outcome.admission.reason_code)}):{' '}
            {outcome.admission.explanation}
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </div>
    </form>
  );
}

/** "· 3 unchanged, 1 changed, 1 removed" for a folded task list. */
function taskCounts(spec: SpecStatus): string {
  const n = new Map<string, number>();
  for (const t of spec.tasks) n.set(t.status, (n.get(t.status) ?? 0) + 1);
  if (spec.removed_tasks.length) n.set('removed', spec.removed_tasks.length);
  return n.size
    ? `· ${[...n].map(([k, v]) => `${v} ${words(k)}`).join(', ')}`
    : '';
}

/**
 * Rankings, selections and specifications. Scores are computed from the current
 * scorecards; a selection is recorded under Compare and decide, and a specification
 * version can be frozen here. Approvals for either appear under Decisions.
 */
export function Scoring({
  session,
  workspace: current,
  focus,
  onFocus,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  /** The problem whose report is shown, kept in the page address. */
  focus: string;
  onFocus: (problemId: string) => void;
  open: (view: View, id?: string) => void;
}) {
  const { standard } = useViewMode();
  const desktop = useDesktopApp();
  const workspace = current.id;
  const [problems, setProblems] = useState<StoredEntity[]>([]);
  const [counts, setCounts] = useState<ReadonlyMap<string, number>>(new Map());
  const problem = focus;
  const focusRef = useRef(focus);
  focusRef.current = focus;
  const setProblem = (u: string | ((c: string) => string)) =>
    onFocus(typeof u === 'function' ? u(focus) : u);
  const [alternatives, setAlternatives] = useState<StoredEntity[]>([]);
  const [report, setReport] = useState<SelectionReport | null>(null);
  const [selections, setSelections] = useState<Selection[]>([]);
  const [specs, setSpecs] = useState<StoredEntity[]>([]);
  const [spec, setSpec] = useState<SpecStatus | null>(null);
  const [specRun, setSpecRun] = useState<string | null>(null);
  /** Every problem, archived ones too: a spec's selection may belong to any of them. */
  const [allProblemIds, setAllProblemIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const base = `workspaces/${workspace}`;

  async function loadWorkspace() {
    if (!workspace) return;
    setError('');
    try {
      const [p, a, s] = await Promise.all([
        api(z.array(StoredEntitySchema), `${base}/entities?kind=problem`),
        api(z.array(StoredEntitySchema), `${base}/entities?kind=alternative`),
        api(z.array(StoredEntitySchema), `${base}/entities?kind=specification`),
      ]);
      const active = newestFirst(p.filter((x) => x.status === 'active'));
      const c = await alternativeCounts(base, active);
      setProblems(active);
      setAllProblemIds(p.map((x) => x.id));
      setCounts(c);
      setAlternatives(a);
      setSpecs(newestFirst(s.filter((x) => x.body?.format === 'spec/1')));
      // Read the address now, not when the load started: a pick made while the counts
      // were loading must not be replaced by the default.
      const cur = focusRef.current;
      // Open on the newest problem unless the page was opened for a specific one.
      if (!active.some((x) => x.id === cur)) setProblem(active[0]?.id ?? '');
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
  // Shown again after work elsewhere (a discovery, a new score, a freeze): read the problems,
  // specs and the open problem's report again. The chosen problem and typed fields stay.
  const [shown, setShown] = useState(0);
  useOnShow(() => {
    void loadWorkspace();
    setShown((n) => n + 1);
    // An open spec may have been frozen or approved elsewhere (audit L-10).
    if (spec) void openSpec(spec.spec.id, true);
  });
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
  }, [problem, workspace, shown]);
  // PR #125 review N-1: only the latest open may write, so a slow re-read on return can't put
  // back a spec the person has since moved away from.
  const specSeq = useRef(0);
  async function openSpec(id: string, refresh = false) {
    const mine = ++specSeq.current;
    setError('');
    try {
      // A spec freezes only under the run that made its selection; find that run before
      // showing the freeze form, so it never offers a run the server would refuse.
      const selectionId = specs.find((s) => s.id === id)?.body?.selection_id;
      const [status, ...lists] = await Promise.all([
        api(SpecStatusSchema, `${base}/specs/${id}`),
        ...allProblemIds.map((pid) =>
          api(
            z.array(SelectionSchema),
            `${base}/problems/${pid}/selections`,
          ).catch(() => []),
        ),
      ]);
      if (mine !== specSeq.current) return;
      const run =
        lists.flat().find((s) => s.id === selectionId)?.run_id ?? null;
      // A re-read whose selection lists failed keeps the run it found before, so an open
      // Freeze form is not replaced by "Couldn't find the run".
      setSpecRun((before) => (refresh && run === null ? before : run));
      setSpec(status);
    } catch (e) {
      if (mine === specSeq.current) setError(message(e));
    }
  }
  const names = new Map(alternatives.map((a) => [a.id, a.title]));
  const fixture = current.record_mode === 'fixture';
  // P18: rankings, selections and the open spec's task list fold to one line each. An open
  // spec that is not frozen shows its tasks, since freezing them is the step waiting.
  const rankFolds = useFolds([]);
  const selectionFolds = useFolds([]);
  const taskFolds = useFolds(
    spec && !spec.frozen_current ? [`tasks:${spec.spec.id}`] : [],
  );

  return (
    <section className="panel records" aria-labelledby="sel-title">
      <h2 id="sel-title">Rankings, selections and specs</h2>
      <p>
        Scores are transparent prioritization aids from reviewers&apos; 1–5
        ratings, not probabilities or measured impact. Unknown ratings are never
        averaged away. Ethics, access and the humility review are gates that no
        score can clear. Record a selection under Decide, then freeze its
        specification here. Approvals appear under Monitor › Approvals.
      </p>
      <div className="filters">
        <label htmlFor="sel-problem" className="inline">
          Problem
        </label>
        <select
          id="sel-problem"
          value={problem}
          onChange={(e) => setProblem(e.target.value)}
        >
          {problems.length === 0 && <option value="">No problems yet</option>}
          <RecordOptions
            list={problems}
            label={(p) => problemLabel(p, counts)}
          />
        </select>
        <button className="secondary" onClick={() => void loadWorkspace()}>
          Refresh
        </button>
      </div>
      {fixture && <span className="badge">SYNTHETIC · FIXTURE REVIEWERS</span>}
      {loading && <p className="small">Computing the report…</p>}
      {!loading && problems.length === 0 && (
        <p className="small">
          No problem records yet. Run a discovery
          {desktop ? (
            ''
          ) : (
            <>
              {' '}
              (or <code>pnpm cli seed-selection</code>)
            </>
          )}{' '}
          to create candidates.
        </p>
      )}
      {report && (
        <>
          <div className="fold-head">
            <h3>Rankings</h3>
            <FoldAll
              ids={['opportunity', 'suitability']}
              folds={rankFolds}
              label="rankings"
            />
          </div>
          <Ranking
            id="opportunity"
            folds={rankFolds}
            title="Software opportunity"
            ranking={report.opportunity}
            names={names}
          />
          <Ranking
            id="suitability"
            folds={rankFolds}
            title="Solution suitability (all responses)"
            ranking={report.suitability}
            names={names}
          />
          <p className="small">
            {standard ? (
              'A selection is tied to this exact report, so a decision is never made on a changed report.'
            ) : (
              <>
                Report <code>{report.report_hash.slice(0, 12)}</code> · a
                selection must name this hash, so a decision is never made on a
                changed report.
              </>
            )}
          </p>
        </>
      )}
      {report && (
        <>
          <div className="fold-head">
            <h3>Selections</h3>
            <FoldAll
              ids={selections.map((s) => s.id)}
              folds={selectionFolds}
              label="selections"
            />
          </div>
          {selections.length === 0 ? (
            <p className="small">No selection recorded for this problem.</p>
          ) : (
            <ol className="selections">
              {selections.map((s) => (
                <li key={s.id}>
                  <Fold
                    id={s.id}
                    folds={selectionFolds}
                    summary={
                      <>
                        <strong>{s.current ? 'Current' : 'Replaced'}</strong> ·{' '}
                        {when(s.created_at)} ·{' '}
                        <span className="fold-title">
                          {clip(s.rationale, 120)}
                        </span>{' '}
                        <small>
                          · {s.dispositions.length} option
                          {s.dispositions.length === 1 ? '' : 's'}
                          {s.overrides.length > 0 ? ' · with override' : ''}
                        </small>
                      </>
                    }
                  >
                    <p className="small">{s.rationale}</p>
                    <ul>
                      {s.dispositions.map((d) => (
                        <li key={d.alternative.id}>
                          <span className="kind">{words(d.disposition)}</span>{' '}
                          {clip(
                            names.get(d.alternative.id.toLowerCase()) ??
                              (standard
                                ? 'An option no longer listed'
                                : d.alternative.id.slice(0, 8)),
                            80,
                          )}
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
                        Override of the {o.ranking} ranking: advanced at
                        original rank {o.original_rank ?? 'unranked'} (
                        {o.original_score ?? 'no score'}) over{' '}
                        {o.outranked_by
                          .map((b) => `rank ${b.rank} (${b.score})`)
                          .join(', ')}
                        . Reason: {s.override_reason}
                      </p>
                    ))}
                  </Fold>
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
          <Fold
            id={`tasks:${spec.spec.id}`}
            folds={taskFolds}
            summary={
              <>
                <span className="fold-title">Tasks ({spec.tasks.length})</span>{' '}
                <small>{taskCounts(spec)}</small>
              </>
            }
          >
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
          </Fold>
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
          {!spec.frozen_current &&
            spec.blockers.length === 0 &&
            spec.problems.length === 0 &&
            current.role !== 'viewer' &&
            (specRun ? (
              <FreezeSpec
                key={`${spec.spec.id}:${spec.spec.version}`}
                base={base}
                session={session}
                spec={spec}
                selectionRun={specRun}
                dataClass={fixture ? 'synthetic' : 'public'}
                open={open}
                frozen={() => void openSpec(spec.spec.id)}
              />
            ) : (
              <p className="error">
                Couldn&apos;t find the run that made this spec&apos;s selection,
                and a spec can only be frozen under that run.{' '}
                <button
                  className="secondary"
                  onClick={() => void openSpec(spec.spec.id)}
                >
                  Try again
                </button>
              </p>
            ))}
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
