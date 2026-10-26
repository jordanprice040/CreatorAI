import { useEffect, useState, type FormEvent } from 'react';
import {
  ProblemComparisonSchema,
  RunControlSchema,
  SelectOutcomeSchema,
  SelectionReportSchema,
  SelectionSchema,
  SelectionDispositionSchema,
  StoredEntitySchema,
  WorkflowDetailSchema,
  z,
  type ClaimEvidence,
  type RankedCandidate,
  type SelectOutcome,
  type SelectionDisposition,
  type SessionInfo,
  type StoredEntity,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import {
  Empty,
  Status,
  alternativeCounts,
  clip,
  problemLabel,
  richestProblem,
  shortId,
  useLoad,
  type View,
} from './ui.js';

const FRESH_NOTE: Record<string, string> = {
  current: 'current',
  stale: 'older than the freshness limit',
  changed: 'source changed since quoted',
  inaccessible: 'source could not be read',
  removed: 'source removed',
  claim_changed: 'claim changed since',
  retracted: 'support retracted',
};
const DISPOSITION_NOTE: Record<SelectionDisposition, string> = {
  select_for_build: 'Select for a bounded build',
  proceed_to_validation: 'Validate before building',
  recommend_alternative: 'Recommend (no new software)',
  research_further: 'Research further',
  defer: 'Defer',
  reject: 'Reject',
};

function ClaimCard({
  c,
  relation,
  open,
}: {
  c: ClaimEvidence;
  relation: string;
  open: (view: View, id?: string) => void;
}) {
  return (
    <li className="claim">
      <div>
        <span className={`kind ev-${c.status}`}>{words(c.status)}</span>{' '}
        <small>{words(relation)} the problem</small>
      </div>
      <p>{c.claim.statement ?? c.claim.title}</p>
      <p className="small">
        {c.explanation} {c.independent_origins} independent origin
        {c.independent_origins === 1 ? '' : 's'}
        {c.contrary_origins ? `, ${c.contrary_origins} contrary` : ''}.
      </p>
      {c.labels.length > 0 && (
        <ul className="small labels">
          {c.labels.map((l) => (
            <li key={l}>{l}</li>
          ))}
        </ul>
      )}
      <ul className="passages">
        {c.rows.slice(0, 6).map((r) => (
          <li key={r.support.id} className={r.counted ? '' : 'not-counted'}>
            <small>
              {words(r.support.stance)}
              {r.support.support_type
                ? ` · ${words(r.support.support_type)}`
                : ''}{' '}
              ·{' '}
              <span className={`fresh-${r.freshness}`}>
                {FRESH_NOTE[r.freshness] ?? words(r.freshness)}
              </span>
              {r.counted ? '' : ' · not counted'}
            </small>
            {r.support.quote && <blockquote>“{r.support.quote}”</blockquote>}
            <button
              className="text"
              onClick={() => open('evidence', `source:${r.support.source_id}`)}
            >
              {r.source_title}
            </button>
          </li>
        ))}
        {c.rows.length === 0 && (
          <li className="small">
            No support recorded: this claim is unsupported.
          </li>
        )}
      </ul>
      <button
        className="text"
        onClick={() => open('evidence', `claim:${c.claim.id}`)}
      >
        All evidence for this claim →
      </button>
    </li>
  );
}

type Row = {
  disposition: SelectionDisposition | '';
  reasons: string;
  reverse_if: string;
};

/**
 * One problem's alternatives side by side, with the evidence behind the problem and each
 * option's scores and gates, then a selection. The server decides whether the selection
 * needs your approval (supervised gates) and refuses gated or non-code builds.
 */
export function Compare({
  session,
  workspace,
  focus,
  onFocus,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  focus: string;
  onFocus: (problemId: string) => void;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const problems = useLoad(async () => {
    const list = await api(
      z.array(StoredEntitySchema),
      `${base}/entities?kind=problem&status=active`,
    );
    return { list, counts: await alternativeCounts(base, list) };
  }, [workspace.id]);
  const problemList = problems.data?.list;
  const counts = problems.data?.counts ?? new Map<string, number>();
  useEffect(() => {
    if (!focus && problems.data?.list[0])
      onFocus(richestProblem(problems.data.list, problems.data.counts));
  }, [problems.data, focus]);
  const detail = useLoad(async () => {
    if (!focus) return null;
    const [cmp, report, selections, runs] = await Promise.all([
      api(ProblemComparisonSchema, `${base}/problems/${focus}/comparison`),
      api(SelectionReportSchema, `${base}/problems/${focus}/report`),
      api(z.array(SelectionSchema), `${base}/problems/${focus}/selections`),
      api(z.array(RunControlSchema), `${base}/runs`),
    ]);
    const wf = cmp.workflow_id
      ? await api(
          WorkflowDetailSchema,
          `${base}/workflows/${cmp.workflow_id}`,
        ).catch(() => null)
      : null;
    return {
      cmp,
      report,
      selections,
      runs: runs.filter((r) => r.state === 'active'),
      wf,
    };
  }, [workspace.id, focus]);

  const [rows, setRows] = useState<Record<string, Row>>({});
  const [rationale, setRationale] = useState('');
  const [override, setOverride] = useState('');
  const [runId, setRunId] = useState('');
  const [outcome, setOutcome] = useState<SelectOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows({});
    setOutcome(null);
    setError('');
  }, [focus]);
  const d = detail.data;
  useEffect(() => {
    if (d)
      setRunId((c) =>
        d.runs.some((r) => r.run_id === c)
          ? c
          : d.cmp.run_id && d.runs.some((r) => r.run_id === d.cmp.run_id)
            ? d.cmp.run_id
            : (d.runs[0]?.run_id ?? ''),
      );
  }, [d]);

  const suit = new Map(
    d?.report.suitability.candidates.map((c) => [c.alternative.id, c]) ?? [],
  );
  const opp = new Map(
    d?.report.opportunity.candidates.map((c) => [c.alternative.id, c]) ?? [],
  );
  const proposals = new Map(
    (d?.wf?.workflow.result?.discovery?.catalog_records.alternatives ?? []).map(
      (a) => [
        a.id,
        d?.wf?.workflow.result?.discovery?.proposals.find(
          (p) => p.proposal === a.proposal,
        ),
      ],
    ),
  );
  const alts = d?.cmp.alternatives ?? [];
  const row = (id: string): Row =>
    rows[id] ?? { disposition: '', reasons: '', reverse_if: '' };
  const setRow = (id: string, patch: Partial<Row>) =>
    setRows((r) => ({ ...r, [id]: { ...row(id), ...patch } }));
  const complete =
    alts.length > 0 &&
    alts.every((a) => {
      const r = row(a.entity.id);
      return r.disposition && r.reasons.trim() && r.reverse_if.trim();
    }) &&
    rationale.trim().length > 0 &&
    !!runId;
  const request = () => ({
    problem: { id: d!.report.problem.id, version: d!.report.problem.version },
    report_hash: d!.report.report_hash,
    dispositions: alts.map((a) => {
      const r = row(a.entity.id);
      return {
        alternative: { id: a.entity.id, version: a.entity.version },
        disposition: r.disposition,
        reasons: [r.reasons.trim()],
        reverse_if: r.reverse_if.trim(),
      };
    }),
    override_reason: override.trim() || null,
    rationale: rationale.trim(),
    shortlist_size: 3,
    data_class: workspace.record_mode === 'fixture' ? 'synthetic' : 'public',
  });
  async function select(e?: FormEvent) {
    e?.preventDefault();
    if (!d || !complete) return;
    setBusy(true);
    setError('');
    try {
      const r = await api(
        SelectOutcomeSchema,
        `${base}/runs/${runId}/selections`,
        {
          csrf: session.csrf_token,
          body: request(),
        },
      );
      setOutcome(r);
      if (r.status === 'recorded') detail.reload();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const score = (c: RankedCandidate | undefined) =>
    !c
      ? 'not ranked'
      : c.score
        ? `${c.score.display}${c.rank ? ` · rank ${c.rank}` : ''}`
        : `${words(c.status)}${c.range ? ` (${c.range.lower.display}–${c.range.upper.display})` : ''}`;
  const viewer = workspace.role === 'viewer';
  return (
    <section className="panel" aria-labelledby="cmp-title">
      <h2 id="cmp-title">Compare and decide</h2>
      <p>
        Read each option against the same evidence before choosing. Scores are
        prioritization aids from reviewers’ ratings, not measured impact; gates
        (ethics and access, humility review) are separate and no score clears
        them.
      </p>
      <div className="filters">
        <label htmlFor="cmp-problem" className="inline">
          Problem
        </label>
        <select
          id="cmp-problem"
          value={focus}
          onChange={(e) => onFocus(e.target.value)}
        >
          {problemList?.length === 0 && (
            <option value="">No problems yet</option>
          )}
          {problemList?.map((p) => (
            <option key={p.id} value={p.id}>
              {problemLabel(p, counts)}
            </option>
          ))}
        </select>
        <button className="secondary" onClick={detail.reload}>
          Refresh
        </button>
      </div>
      <Status
        loading={problems.loading}
        error={problems.error}
        retry={problems.reload}
      >
        {problemList?.length === 0 && (
          <Empty>
            No problem records yet. Submit a theme; a finished discovery writes
            one.
          </Empty>
        )}
      </Status>
      <Status
        loading={detail.loading && !d}
        error={detail.error}
        retry={detail.reload}
      >
        {d && (
          <>
            <article className="problem" aria-labelledby="cmp-ptitle">
              <h3 id="cmp-ptitle" className="question">
                {d.cmp.problem.title}
              </h3>
              <p>{String(d.cmp.problem.body?.statement ?? '')}</p>
              <p className="small">
                Affects: {String(d.cmp.problem.body?.affected_group ?? '—')} ·
                Uncertainty: {String(d.cmp.problem.body?.uncertainty ?? '—')}
              </p>
              {d.cmp.brief && (
                <p className="small">
                  From the brief “{d.cmp.brief.title}”
                  {d.cmp.brief.body?.outcome_measure
                    ? `, measured by: ${String(d.cmp.brief.body.outcome_measure)}`
                    : ''}
                  .
                </p>
              )}
              {d.cmp.workflow_id && (
                <button
                  className="text"
                  onClick={() => open('runs', d.cmp.workflow_id!)}
                >
                  Discovery run {shortId(d.cmp.workflow_id)} →
                </button>
              )}
            </article>

            <h3>Evidence behind the problem</h3>
            {d.cmp.claims.length === 0 ? (
              <Empty>
                No claims are linked to this problem: its evidence is
                incomplete.
              </Empty>
            ) : (
              <ul className="claims">
                {d.cmp.claims.map((c) => (
                  <ClaimCard
                    key={c.evidence.claim.id}
                    c={c.evidence}
                    relation={c.relation}
                    open={open}
                  />
                ))}
              </ul>
            )}
            <p className="small">
              Passages count as current for {d.cmp.max_age_days} days after
              retrieval.
            </p>

            <h3>Assumptions for this run</h3>
            {d.cmp.assumptions.length === 0 ? (
              <Empty>
                No assumptions recorded for the run that found this problem.
              </Empty>
            ) : (
              <ul className="rows">
                {d.cmp.assumptions.map((a: StoredEntity) => (
                  <li key={a.id}>
                    <span className="kind">{String(a.body?.status ?? '')}</span>{' '}
                    {String(a.body?.statement ?? a.title)}
                    <small>
                      {' '}
                      · if wrong: {String(
                        a.body?.consequence_if_wrong ?? '—',
                      )}{' '}
                      · {String(a.body?.materiality ?? '')}
                    </small>
                  </li>
                ))}
              </ul>
            )}

            <h3>Alternatives side by side</h3>
            {alts.length === 0 ? (
              <Empty>No alternatives were derived from this problem.</Empty>
            ) : (
              <div className="compare-grid" role="list">
                {alts.map((a) => {
                  const s = suit.get(a.entity.id);
                  const o = opp.get(a.entity.id);
                  const p = proposals.get(a.entity.id);
                  const hr = a.humility_review?.body as
                    Record<string, unknown> | undefined;
                  return (
                    <article
                      key={a.entity.id}
                      className="alt"
                      role="listitem"
                      aria-labelledby={`alt-${a.entity.id}`}
                    >
                      <span className="kind">
                        {words(String(a.entity.body?.kind ?? ''))}
                      </span>
                      <h4 id={`alt-${a.entity.id}`}>{a.entity.title}</h4>
                      <p className="small">
                        {String(a.entity.body?.rationale ?? '')}
                      </p>
                      <dl>
                        <div>
                          <dt>Suitability</dt>
                          <dd className={`score-${s?.status ?? 'unscored'}`}>
                            {score(s)}
                          </dd>
                        </div>
                        <div>
                          <dt>Software opportunity</dt>
                          <dd>{o ? score(o) : 'not a software option'}</dd>
                        </div>
                        <div>
                          <dt>Reviews</dt>
                          <dd>{a.scorecards} scorecards</dd>
                        </div>
                        <div>
                          <dt>Ethics and access</dt>
                          <dd
                            className={`gate-${s?.gates.ethics_access ?? 'not_assessed'}`}
                          >
                            {words(s?.gates.ethics_access ?? 'not_assessed')}
                          </dd>
                        </div>
                        {s && s.gates.humility !== 'not_applicable' && (
                          <div>
                            <dt>Humility review</dt>
                            <dd className={`gate-${s.gates.humility}`}>
                              {words(s.gates.humility)}
                            </dd>
                          </div>
                        )}
                        {p && (
                          <div>
                            <dt>Discovery</dt>
                            <dd>
                              {words(p.disposition)}
                              {p.verdict ? ` · skeptic: ${p.verdict}` : ''}
                            </dd>
                          </div>
                        )}
                      </dl>
                      {s && s.unknown_criteria.length > 0 && (
                        <p className="small">
                          Unknown: {s.unknown_criteria.map(words).join(', ')}
                        </p>
                      )}
                      {s && s.disagreements.length > 0 && (
                        <p className="small">
                          Reviewers differ on{' '}
                          {s.disagreements
                            .map((x) => words(x.criterion))
                            .join(', ')}
                        </p>
                      )}
                      <p className="small">
                        Trade-offs:{' '}
                        {(
                          a.entity.body?.tradeoffs as string[] | undefined
                        )?.join('; ') ?? '—'}
                      </p>
                      <p className="small">
                        Uncertainty: {String(a.entity.body?.uncertainty ?? '—')}
                      </p>
                      {hr && (
                        <p className="small">
                          Humility review: {words(String(hr.disposition ?? ''))}
                          ; would change course if{' '}
                          {String(hr.change_course_trigger ?? '—')}
                        </p>
                      )}
                      {p && p.dissent.length > 0 && (
                        <details>
                          <summary>
                            Skeptic dissent ({p.dissent.length})
                          </summary>
                          <ul>
                            {p.dissent.map((x, i) => (
                              <li key={i}>{x}</li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </article>
                  );
                })}
              </div>
            )}
            <p className="small">
              Full rankings and sensitivity:{' '}
              <button className="text" onClick={() => open('scores', focus)}>
                Scores and specs →
              </button>
            </p>

            {alts.length > 0 && !viewer && (
              <form
                className="decide"
                onSubmit={(e) => void select(e)}
                aria-labelledby="decide-title"
              >
                <h3 id="decide-title">Decide</h3>
                <p className="small">
                  Give every option a disposition, a reason and what would
                  reverse it. Blocked choices are disabled with the gate that
                  blocks them. This decision binds report{' '}
                  {d.report.report_hash.slice(0, 12)}; a changed report needs a
                  new decision.
                </p>
                {alts.map((a) => {
                  const s = suit.get(a.entity.id);
                  const r = row(a.entity.id);
                  const id = a.entity.id;
                  return (
                    <fieldset key={id}>
                      <legend>{clip(a.entity.title, 120)}</legend>
                      <label htmlFor={`dis-${id}`}>Disposition</label>
                      <select
                        id={`dis-${id}`}
                        value={r.disposition}
                        onChange={(e) =>
                          setRow(id, {
                            disposition: e.target.value as SelectionDisposition,
                          })
                        }
                      >
                        <option value="">Choose…</option>
                        {SelectionDispositionSchema.options.map((o) => {
                          const blocked = s?.gates.blocked[o];
                          return (
                            <option
                              key={o}
                              value={o}
                              disabled={!!blocked?.length}
                            >
                              {DISPOSITION_NOTE[o]}
                              {blocked?.length
                                ? ` (blocked: ${blocked[0]})`
                                : ''}
                            </option>
                          );
                        })}
                      </select>
                      <div className="two">
                        <div>
                          <label htmlFor={`why-${id}`}>Reason</label>
                          <input
                            id={`why-${id}`}
                            maxLength={300}
                            value={r.reasons}
                            onChange={(e) =>
                              setRow(id, { reasons: e.target.value })
                            }
                          />
                        </div>
                        <div>
                          <label htmlFor={`rev-${id}`}>Would reverse if</label>
                          <input
                            id={`rev-${id}`}
                            maxLength={300}
                            value={r.reverse_if}
                            onChange={(e) =>
                              setRow(id, { reverse_if: e.target.value })
                            }
                          />
                        </div>
                      </div>
                    </fieldset>
                  );
                })}
                <label htmlFor="dec-rationale">Overall rationale</label>
                <textarea
                  id="dec-rationale"
                  rows={2}
                  maxLength={1200}
                  value={rationale}
                  onChange={(e) => setRationale(e.target.value)}
                />
                <label htmlFor="dec-override">
                  Override reason (needed when you advance a lower-ranked
                  option)
                </label>
                <input
                  id="dec-override"
                  maxLength={1200}
                  value={override}
                  onChange={(e) => setOverride(e.target.value)}
                />
                <label htmlFor="dec-run">Record under run</label>
                <select
                  id="dec-run"
                  value={runId}
                  onChange={(e) => setRunId(e.target.value)}
                >
                  {d.runs.length === 0 && (
                    <option value="">No active run</option>
                  )}
                  {d.runs.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {words(r.autonomy_mode)} run {shortId(r.run_id)}
                      {r.run_id === d.cmp.run_id ? ' (found this problem)' : ''}
                    </option>
                  ))}
                </select>
                <button
                  className="primary"
                  type="submit"
                  disabled={busy || !complete}
                >
                  {busy ? 'Submitting…' : 'Record this selection'}
                  <span aria-hidden="true">→</span>
                </button>
                <div aria-live="polite">
                  {outcome && outcome.status === 'recorded' && (
                    <p className="notice ok">
                      Selection recorded. It now appears in the history below
                      and in Activity.
                    </p>
                  )}
                  {outcome && outcome.status === 'needs_human' && (
                    <div className="notice">
                      <strong>Waiting for your approval.</strong>
                      <span>{outcome.admission.explanation}</span>
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
                      )}
                      <button
                        className="secondary strong"
                        type="button"
                        onClick={() => void select()}
                      >
                        I approved it: submit again
                      </button>
                    </div>
                  )}
                  {outcome &&
                    (outcome.status === 'denied' ||
                      outcome.status === 'deferred') && (
                      <p className="error">
                        {words(outcome.status)} (
                        {words(outcome.admission.reason_code)}):{' '}
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
            )}

            <h3>Selection history</h3>
            {d.selections.length === 0 ? (
              <Empty>No selection recorded for this problem yet.</Empty>
            ) : (
              <ol className="rows">
                {d.selections.map((s) => (
                  <li key={s.id}>
                    <strong>{s.current ? 'Current' : 'Replaced'}</strong> ·{' '}
                    {when(s.created_at)} · {s.rationale}
                    <ul>
                      {s.dispositions.map((x) => (
                        <li key={x.alternative.id}>
                          <span className="kind">{words(x.disposition)}</span>{' '}
                          {clip(
                            alts.find((a) => a.entity.id === x.alternative.id)
                              ?.entity.title ?? shortId(x.alternative.id),
                            80,
                          )}
                          <small>
                            {' '}
                            · {x.reasons.join(' ')} · reverse if {x.reverse_if}
                          </small>
                        </li>
                      ))}
                    </ul>
                    {s.overrides.length > 0 && (
                      <p className="override">Override: {s.override_reason}</p>
                    )}
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </Status>
    </section>
  );
}
