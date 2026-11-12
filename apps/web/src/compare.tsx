import { useEffect, useState, type FormEvent } from 'react';
import {
  EntityDetailSchema,
  ProblemComparisonSchema,
  RunControlSchema,
  SelectOutcomeSchema,
  SelectionReportSchema,
  SelectionSchema,
  SelectionDispositionSchema,
  StoredEntitySchema,
  kindAllows,
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
  RecordOptions,
  runNames,
  shortId,
  useLoad,
  type View,
} from './ui.js';
import { newestFirst } from './versions.js';
import { Fold, FoldAll, useFolds } from './fold.js';
import { firstNeeding, groupByReason, nameList } from './fold-state.js';
import { runLabel } from './labels.js';
import { HumilityForm } from './humility.js';
import { ResponseExplanationPanel } from './proposals.js';
import { ScoreOption } from './scorecard.js';
import { AssessmentLines, AutoAssess, RangeWhy } from './assess.js';
import { LinkClaims } from './link-claims.js';
import { Routine, WhatWillHappen } from './routine.js';
import {
  decideRoutineSummary,
  dispositionCounts,
  overrideMatters,
  overrideSummary,
  runSource,
} from './decide-routine.js';
import {
  carryDecisions,
  formGate,
  needsReview,
  rowReasons,
} from './carry-decisions.js';

/** What still needs the owner's look, in words, for the line above Record. */
function pendingReviews(
  g: ReturnType<typeof formGate>,
  overrideText: string,
  /** P18: options are folded, so the line names the ones that hold the record back. */
  name: (id: string) => string,
  incomplete: string[],
): string[] {
  const out: string[] = [];
  const n = g.unreviewed.length;
  if (n)
    out.push(
      `keep or change ${n} flagged option${n === 1 ? '' : 's'} (${nameList(g.unreviewed.map(name))})`,
    );
  // Review L-4: a new, untouched option is already named as flagged above.
  incomplete = incomplete.filter((id) => !g.unreviewed.includes(id));
  if (incomplete.length)
    out.push(
      `give a disposition, reason and “would reverse if” for ${incomplete.length} option${incomplete.length === 1 ? '' : 's'} (${nameList(incomplete.map(name))})`,
    );
  if (g.stale_reasons.length)
    out.push(
      `rewrite or keep the reasons written for an earlier choice (${nameList(g.stale_reasons.map(name))})`,
    );
  if (g.rationale_review) out.push('review the overall rationale');
  if (g.override_review) out.push('review the override reason');
  else if (g.override_needed && !overrideText.trim())
    out.push('give an override reason');
  if (g.problem_review) out.push('confirm the revised problem');
  return out;
}

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
  folds,
}: {
  c: ClaimEvidence;
  relation: string;
  open: (view: View, id?: string) => void;
  folds: ReturnType<typeof useFolds>;
}) {
  return (
    <li className="claim">
      <Fold
        id={c.claim.id}
        folds={folds}
        summary={
          <>
            <span className={`kind ev-${c.status}`}>{words(c.status)}</span>{' '}
            <span className="fold-title">
              {clip(c.claim.statement ?? c.claim.title, 140)}
            </span>{' '}
            <small>
              · {words(relation)} the problem · {c.independent_origins}{' '}
              independent origin{c.independent_origins === 1 ? '' : 's'}
              {c.contrary_origins ? `, ${c.contrary_origins} contrary` : ''}
            </small>
          </>
        }
      >
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
                onClick={() =>
                  open('evidence', `source:${r.support.source_id}`)
                }
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
      </Fold>
    </li>
  );
}

type Row = {
  disposition: SelectionDisposition | '';
  reasons: string;
  reverse_if: string;
  /** The recorded reasons while the joined text is untouched (see rowReasons). */
  reasons_list?: string[];
};

/**
 * One problem's alternatives side by side, with the evidence behind the problem and each
 * option's scores and gates, then a selection. The server decides whether the selection
 * needs your approval (supervised gates) and refuses gated or non-code builds.
 */
/**
 * Review L-3: claims a scorecard cites that neither the problem's claims nor the newest-500
 * claim list name (an option claim past that list), read by id so they are named, not numbered.
 */
async function citedPastList(
  base: string,
  scorecards: StoredEntity[],
  known: string[],
): Promise<{ id: string; title: string }[]> {
  const have = new Set(known.map((x) => x.toLowerCase()));
  const cited = new Set<string>();
  for (const c of scorecards) {
    const ratings = (c.body?.ratings ?? {}) as Record<
      string,
      { evidence_refs?: { id: string }[] }
    >;
    for (const r of Object.values(ratings))
      for (const e of r?.evidence_refs ?? [])
        if (!have.has(e.id.toLowerCase())) cited.add(e.id.toLowerCase());
  }
  const read = await Promise.all(
    [...cited].slice(0, 60).map((x) =>
      api(EntityDetailSchema, `${base}/entities/${x}`).then(
        (r) => ({ id: r.entity.id, title: r.entity.title }),
        () => null,
      ),
    ),
  );
  return read.filter((x) => x !== null);
}

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
    const list = newestFirst(
      await api(
        z.array(StoredEntitySchema),
        `${base}/entities?kind=problem&status=active`,
      ),
    );
    return { list, counts: await alternativeCounts(base, list) };
  }, [workspace.id]);
  const problemList = problems.data?.list;
  const counts = problems.data?.counts ?? new Map<string, number>();
  useEffect(() => {
    // Open on the newest problem unless the page was opened for a specific one.
    if (!focus && problems.data?.list[0]) onFocus(problems.data.list[0].id);
  }, [problems.data, focus]);
  const detail = useLoad(async () => {
    if (!focus) return null;
    const [cmp, report, selections, runs, names, scorecards, claimNames] =
      await Promise.all([
        api(ProblemComparisonSchema, `${base}/problems/${focus}/comparison`),
        api(SelectionReportSchema, `${base}/problems/${focus}/report`),
        api(z.array(SelectionSchema), `${base}/problems/${focus}/selections`),
        api(z.array(RunControlSchema), `${base}/runs`),
        runNames(base),
        api(
          z.array(StoredEntitySchema),
          `${base}/entities?kind=scorecard&status=active`,
        ),
        // ADR-0091: an assessment also cites claims linked to an option, so name them all.
        api(z.array(StoredEntitySchema), `${base}/entities?kind=claim`).catch(
          () => [],
        ),
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
      runs: newestFirst(runs.filter((r) => r.state === 'active')),
      names,
      wf,
      scorecards,
      claimNames: [
        ...claimNames.map((c) => ({ id: c.id, title: c.title })),
        ...(await citedPastList(base, scorecards, [
          ...claimNames.map((c) => c.id),
          ...cmp.claims.map((c) => c.evidence.claim.id),
        ])),
      ],
    };
  }, [workspace.id, focus]);

  // Only what the owner edits here; untouched options show the carried decision.
  const [rows, setRows] = useState<Record<string, Row>>({});
  const [rationaleEdit, setRationale] = useState<string | null>(null);
  const [overrideEdit, setOverride] = useState<string | null>(null);
  const [problemConfirmed, setProblemConfirmed] = useState(false);
  // "Keep" confirmations, bound to what they were pressed for (see formGate).
  const [rationaleKept, setRationaleKept] = useState<string | null>(null);
  const [overrideKept, setOverrideKept] = useState<string | null>(null);
  const [reasonsKept, setReasonsKept] = useState<Record<string, string>>({});
  const [humilityFor, setHumilityFor] = useState<string | null>(null);
  /** ADR-0074: "Edit" on an automatic assessment opens the scoring form on it. */
  // ADR-0091: the "Link claims" panels open in place (one problem, one option at a time).
  const [linkingProblem, setLinkingProblem] = useState(false);
  const [linkingOption, setLinkingOption] = useState('');
  const [scorePick, setScorePick] = useState<{
    optionId: string;
    rubric: 'suitability' | 'opportunity';
    /** The system card whose Edit was pressed (review M-3); absent, the person's own card. */
    systemId?: string;
    n: number;
  } | null>(null);
  const [runId, setRunId] = useState('');
  const [outcome, setOutcome] = useState<SelectOutcome | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    setRows({});
    setRationale(null);
    setOverride(null);
    setProblemConfirmed(false);
    setRationaleKept(null);
    setOverrideKept(null);
    setReasonsKept({});
    setOutcome(null);
    setError('');
    setHumilityFor(null);
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
  const humilityAlt = alts.find((a) => a.entity.id === humilityFor);
  // The latest selection's decisions carry over to the current report; only options whose
  // own inputs changed are flagged, and those need a look before recording.
  const latest = d?.selections.find((s) => s.current) ?? null;
  const carried = d
    ? carryDecisions(
        latest,
        d.report,
        alts.map((a) => ({ id: a.entity.id, version: a.entity.version })),
      )
    : null;
  const review = carried ? needsReview(carried) : [];
  const rationale = rationaleEdit ?? carried?.rationale ?? '';
  const override = overrideEdit ?? carried?.override_reason ?? '';
  const row = (id: string): Row =>
    rows[id] ??
    (carried?.options[id]?.row as Row | undefined) ?? {
      disposition: '',
      reasons: '',
      reverse_if: '',
    };
  const setRow = (id: string, patch: Partial<Row>) => {
    setRows((r) => ({ ...r, [id]: { ...row(id), ...patch } }));
    // An option being edited stays open, even once it no longer needs attention.
    rowFolds.set(id, true);
  };
  const gate =
    carried && d
      ? formGate(carried, latest, d.report, {
          edited: Object.keys(rows),
          dispositions: Object.fromEntries(
            alts.map((a) => [a.entity.id, row(a.entity.id).disposition]),
          ),
          rationale_edited: rationaleEdit !== null,
          override_edited: overrideEdit !== null,
          texts: Object.fromEntries(
            alts.map((a) => {
              const r = row(a.entity.id);
              return [
                a.entity.id,
                { reasons: r.reasons, reverse_if: r.reverse_if },
              ];
            }),
          ),
          rationale_kept: rationaleKept,
          override_kept: overrideKept,
          reasons_kept: reasonsKept,
          problem_confirmed: problemConfirmed,
        })
      : null;
  const unreviewed = gate?.unreviewed ?? [];
  // Recording the same decision on the same report under the same run would only
  // duplicate it; another run is a different record.
  const unchanged = !!gate?.unchanged && runId === latest?.run_id;
  const complete =
    alts.length > 0 &&
    alts.every((a) => {
      const r = row(a.entity.id);
      return r.disposition && r.reasons.trim() && r.reverse_if.trim();
    }) &&
    unreviewed.length === 0 &&
    !unchanged &&
    !gate?.override_review &&
    !gate?.problem_review &&
    !gate?.rationale_review &&
    !gate?.stale_reasons.length &&
    !(gate?.override_needed && !override.trim()) &&
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
        reasons: rowReasons(r),
        reverse_if: r.reverse_if.trim(),
      };
    }),
    // PR #95 re-review L-4: a reason the current choices do not need is not stored.
    override_reason: gate?.override_needed ? override.trim() || null : null,
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
      if (r.status === 'recorded') {
        // The new selection becomes the one carried forward.
        setRows({});
        setRationale(null);
        setOverride(null);
        setProblemConfirmed(false);
        setRationaleKept(null);
        setOverrideKept(null);
        setReasonsKept({});
        detail.reload();
      }
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
  // P18: options, claims and history are one-line summaries that expand on click. Only the
  // first option that needs the person opens by default; anything that blocks recording is
  // also named in the summary and in the line above Record.
  const altIds = alts.map((a) => a.entity.id);
  const optionName = (id: string) =>
    clip(alts.find((a) => a.entity.id === id)?.entity.title ?? shortId(id), 60);
  const incomplete = altIds.filter((id) => {
    const r = row(id);
    return !(r.disposition && r.reasons.trim() && r.reverse_if.trim());
  });
  const changedSince = (id: string) =>
    !!carried?.from && carried.options[id]?.status !== 'kept';
  // Review L-1: "changed since" stays true after the person reviews an option, so the
  // default follows what is still unreviewed and moves on to the next one.
  const needsYou = (id: string) =>
    unreviewed.includes(id) ||
    !!gate?.stale_reasons.includes(id) ||
    incomplete.includes(id);
  const claimFolds = useFolds([]);
  const altFolds = useFolds(firstNeeding(altIds, changedSince));
  const rowFolds = useFolds(viewer ? [] : firstNeeding(altIds, needsYou));
  const historyFolds = useFolds([]);
  // Review L-2, re-review R-3/R3-1/R3-2: the blocked choices a person can do something
  // about. A choice the option's kind rules out (kindAllows) never becomes available, so it
  // stays in the dropdown only; the rest are grouped by reason so a shared one shows once.
  const clearable = (id: string) => {
    const kind = String(
      alts.find((a) => a.entity.id === id)?.entity.body?.kind ?? '',
    );
    return SelectionDispositionSchema.options.flatMap((o) => {
      const why = suit.get(id)?.gates.blocked[o];
      return why?.length && kindAllows(kind, o)
        ? [[DISPOSITION_NOTE[o], why] as const]
        : [];
    });
  };
  // P19 follow-up: Standard folds the run choice, and the override reason while it does not
  // matter, each under one line; Advanced shows them open, in the same order as before. The
  // override field never moves: its fold only opens (review M-1).
  const chosenRun = d?.runs.find((r) => r.run_id === runId);
  const source = runSource(runId, d?.cmp.run_id ?? null);
  const routineSummary = decideRoutineSummary({
    label: chosenRun && d ? runLabel(chosenRun, d.names) : '',
    source,
  });
  const blockedCount = (id: string) => clearable(id).length;
  const blockedText = (id: string) =>
    groupByReason(clearable(id))
      .map((g) => `${clip(g.reason, 90)} Blocks: ${g.choices.join(', ')}.`)
      .join(' ');
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
          {problemList && (
            <RecordOptions
              list={problemList}
              label={(p) => problemLabel(p, counts)}
            />
          )}
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
            No problem records yet. Start one under Discover; a finished
            discovery writes one.
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

            <div className="fold-head">
              <h3>Evidence behind the problem</h3>
              <FoldAll
                ids={d.cmp.claims.map((c) => c.evidence.claim.id)}
                folds={claimFolds}
                label="claims"
              />
            </div>
            {!viewer && (
              <p className="small">
                <button
                  type="button"
                  className="text"
                  aria-expanded={linkingProblem}
                  onClick={() => setLinkingProblem((v) => !v)}
                >
                  {linkingProblem ? 'Close' : 'Link claims to this problem'}
                </button>{' '}
                <span className="muted">
                  Recorded claims become evidence an assessment reads.
                </span>
              </p>
            )}
            {linkingProblem && (
              <LinkClaims
                session={session}
                workspace={workspace}
                target={{
                  id: d.cmp.problem.id,
                  version: d.cmp.problem.version,
                  kind: 'problem',
                  title: d.cmp.problem.title,
                }}
                onLinked={detail.reload}
                open={open}
              />
            )}
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
                    folds={claimFolds}
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

            <div className="fold-head">
              <h3>Alternatives side by side</h3>
              <FoldAll ids={altIds} folds={altFolds} label="alternatives" />
            </div>
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
                      <Fold
                        id={a.entity.id}
                        folds={altFolds}
                        summary={
                          <>
                            <span className="kind">
                              {words(String(a.entity.body?.kind ?? ''))}
                            </span>
                            {changedSince(a.entity.id) && (
                              <span className="kind flag">
                                {carried?.options[a.entity.id]?.status === 'new'
                                  ? 'New since your decision'
                                  : 'Changed since your decision'}
                              </span>
                            )}
                            <strong
                              id={`alt-${a.entity.id}`}
                              className="fold-title"
                            >
                              {a.entity.title}
                            </strong>
                            <span className="fold-line small">
                              Suitability {score(s)}
                              {o ? ` · Opportunity ${score(o)}` : ''} · Ethics
                              and access{' '}
                              <span
                                className={`gate-${s?.gates.ethics_access ?? 'not_assessed'}`}
                              >
                                {words(
                                  s?.gates.ethics_access ?? 'not_assessed',
                                )}
                              </span>
                              {s && s.gates.humility !== 'not_applicable' && (
                                <>
                                  {' '}
                                  · Humility{' '}
                                  <span className={`gate-${s.gates.humility}`}>
                                    {words(s.gates.humility)}
                                  </span>
                                </>
                              )}
                              {blockedCount(a.entity.id) > 0 &&
                                ` · ${blockedCount(a.entity.id)} choice${blockedCount(a.entity.id) === 1 ? '' : 's'} blocked`}
                            </span>
                          </>
                        }
                      >
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
                            <dd>
                              {a.scorecards} scorecard
                              {a.scorecards === 1 ? '' : 's'}
                            </dd>
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
                        <AssessmentLines
                          rubrics={[
                            { rubric: 'suitability', cand: s },
                            { rubric: 'opportunity', cand: o },
                          ]}
                          cards={d.scorecards}
                          claims={[
                            ...d.cmp.claims.map((c) => c.evidence.claim),
                            ...d.claimNames,
                          ]}
                          canEdit={!viewer}
                          onEdit={(rubric, systemId) =>
                            setScorePick({
                              optionId: a.entity.id,
                              rubric,
                              systemId,
                              n: Date.now(),
                            })
                          }
                        />
                        {s && s.unknown_criteria.length > 0 && (
                          <p className="small">
                            Unknown: {s.unknown_criteria.map(words).join(', ')}
                          </p>
                        )}
                        {[
                          { rubric: 'suitability' as const, cand: s },
                          { rubric: 'opportunity' as const, cand: o },
                        ].map(({ rubric, cand }) =>
                          cand ? (
                            <RangeWhy
                              key={rubric}
                              rubric={rubric}
                              cand={cand}
                              cards={d.scorecards}
                              canEdit={!viewer}
                              onFill={(systemId) =>
                                setScorePick({
                                  optionId: a.entity.id,
                                  rubric,
                                  ...(systemId ? { systemId } : {}),
                                  n: Date.now(),
                                })
                              }
                            />
                          ) : null,
                        )}
                        {!viewer && (
                          <p className="small">
                            <button
                              type="button"
                              className="text"
                              aria-expanded={linkingOption === a.entity.id}
                              onClick={() =>
                                setLinkingOption((v) =>
                                  v === a.entity.id ? '' : a.entity.id,
                                )
                              }
                            >
                              {linkingOption === a.entity.id
                                ? 'Close'
                                : 'Link claims to this option'}
                            </button>
                          </p>
                        )}
                        {linkingOption === a.entity.id && (
                          <LinkClaims
                            session={session}
                            workspace={workspace}
                            target={{
                              id: a.entity.id,
                              version: a.entity.version,
                              kind: 'alternative',
                              title: a.entity.title,
                            }}
                            problemTitle={d.cmp.problem.title}
                            onLinked={detail.reload}
                            open={open}
                          />
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
                          Uncertainty:{' '}
                          {String(a.entity.body?.uncertainty ?? '—')}
                        </p>
                        {hr && (
                          <p className="small">
                            Humility review:{' '}
                            {words(String(hr.disposition ?? ''))}; would change
                            course if {String(hr.change_course_trigger ?? '—')}
                          </p>
                        )}
                        {!viewer &&
                          ['build', 'hybrid'].includes(
                            String(a.entity.body?.kind ?? ''),
                          ) &&
                          !humilityFor && (
                            <button
                              type="button"
                              className="text"
                              onClick={() => setHumilityFor(a.entity.id)}
                            >
                              {hr &&
                              (hr.subject as { version?: number } | undefined)
                                ?.version === a.entity.version
                                ? 'Review again'
                                : hr
                                  ? `Review v${a.entity.version} (the review is of an older version)`
                                  : 'Add a humility review'}
                            </button>
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
                      </Fold>
                    </article>
                  );
                })}
              </div>
            )}
            {humilityAlt && (
              <HumilityForm
                key={`${humilityAlt.entity.id}:${humilityAlt.entity.version}`}
                base={base}
                session={session}
                subject={{
                  id: humilityAlt.entity.id,
                  version: humilityAlt.entity.version,
                  label: humilityAlt.entity.title,
                }}
                claims={d.cmp.claims.map((c) => c.evidence)}
                subjectKind={
                  humilityAlt.entity.body?.kind === 'hybrid'
                    ? 'hybrid'
                    : 'software'
                }
                {...(humilityAlt.humility_review
                  ? { earlier: humilityAlt.humility_review }
                  : {})}
                prefill={{
                  whose_perspective: String(
                    d.cmp.problem.body?.affected_group ?? '',
                  ),
                  outcome_that_matters: String(
                    d.cmp.brief?.body?.outcome_measure ?? '',
                  ),
                }}
                cancel={() => setHumilityFor(null)}
                saved={() => {
                  setHumilityFor(null);
                  detail.reload();
                }}
              />
            )}
            {alts.length > 0 && (
              <AutoAssess
                session={session}
                workspace={workspace}
                problem={d.cmp.problem}
                onRecorded={detail.reload}
                open={open}
              />
            )}
            {alts.length > 0 && !viewer && (
              <ScoreOption
                pick={scorePick}
                base={base}
                session={session}
                options={alts.map((a) => ({
                  entity: a.entity,
                  kind: String(a.entity.body?.kind ?? ''),
                }))}
                claims={d.cmp.claims.map((c) => c.evidence)}
                scorecards={d.scorecards}
                prefill={{
                  target_users: String(
                    d.cmp.problem.body?.affected_group ?? '',
                  ),
                  measurable_outcome: String(
                    d.cmp.brief?.body?.outcome_measure ?? '',
                  ),
                }}
                saved={detail.reload}
              />
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
                  {d.report.report_hash.slice(0, 12)}.
                </p>
                {carried?.from && latest && (
                  <p
                    className={`notice${review.length === 0 ? ' ok' : ''}`}
                    role="status"
                  >
                    {carried.same_report ? (
                      <span>
                        Filled in from your current decision of{' '}
                        {when(latest.created_at)}. Nothing has changed since;
                        edit any option and record again to replace it.
                      </span>
                    ) : (
                      <span>
                        <strong>
                          {review.length === 0
                            ? 'Your decisions still apply.'
                            : `${review.length} of ${alts.length} option${alts.length === 1 ? '' : 's'} changed since your decision.`}
                        </strong>{' '}
                        Filled in from your decision of{' '}
                        {when(latest.created_at)}.{' '}
                        {review.length === 0
                          ? 'Scores or gates changed for no option you decided, so record it again to bind it to the current report.'
                          : 'Look at the flagged options and keep or change them; the rest stay as you decided.'}
                        {carried.problem_version_changed &&
                          ' The problem itself was revised since: read it above and confirm your decision still fits it.'}
                        {carried.dropped > 0 &&
                          ` ${carried.dropped} option${carried.dropped === 1 ? ' you decided is' : 's you decided are'} no longer part of this problem.`}
                      </span>
                    )}
                  </p>
                )}
                {carried?.problem_version_changed && (
                  <p className="small">
                    <label>
                      <input
                        type="checkbox"
                        checked={problemConfirmed}
                        onChange={(e) => setProblemConfirmed(e.target.checked)}
                      />
                      I read the revised problem and my decision still applies
                      (or I changed it below).
                    </label>
                  </p>
                )}
                <FoldAll ids={altIds} folds={rowFolds} label="options" />
                {alts.map((a) => {
                  const s = suit.get(a.entity.id);
                  const r = row(a.entity.id);
                  const id = a.entity.id;
                  const c = carried?.from ? carried.options[id] : undefined;
                  const flagged = review.includes(id);
                  const state = unreviewed.includes(id)
                    ? c?.status === 'new'
                      ? 'New option: decide it'
                      : 'Changed since you decided: review it'
                    : gate?.stale_reasons.includes(id)
                      ? 'Reasons were written for another choice'
                      : incomplete.includes(id)
                        ? 'Needs a disposition, reason and “would reverse if”'
                        : c?.status === 'kept'
                          ? 'Kept from your last decision'
                          : '';
                  return (
                    <Fold
                      key={id}
                      id={id}
                      folds={rowFolds}
                      className="decide-option"
                      summary={
                        <>
                          <span className="fold-title">
                            {clip(a.entity.title, 120)}
                          </span>
                          <span className="fold-line small">
                            {r.disposition
                              ? DISPOSITION_NOTE[r.disposition]
                              : 'Not decided'}
                            {state && (
                              <>
                                {' · '}
                                <span
                                  className={
                                    needsYou(id) ? 'fold-attention' : undefined
                                  }
                                >
                                  {state}
                                </span>
                              </>
                            )}
                          </span>
                          {blockedText(id) && (
                            <span className="fold-line small">
                              Blocked by gates: {blockedText(id)}
                            </span>
                          )}
                        </>
                      }
                    >
                      <fieldset
                        className={
                          flagged && !rows[id]
                            ? 'flagged'
                            : c?.status === 'new'
                              ? 'flagged new'
                              : undefined
                        }
                      >
                        <legend className="sr-only">
                          {clip(a.entity.title, 120)}
                        </legend>
                        {c && c.status === 'kept' && (
                          <p className="small">
                            Kept from your last decision; nothing about this
                            option changed.
                            {c.notes.length > 0 && ` ${c.notes.join('; ')}.`}
                          </p>
                        )}
                        {c && c.status !== 'kept' && (
                          <div className="carry-flag">
                            <strong>
                              {c.status === 'new'
                                ? 'New option: decide it.'
                                : rows[id] && r.disposition
                                  ? 'Reviewed.'
                                  : 'Review: this changed since you decided it.'}
                            </strong>
                            {c.status !== 'new' && (
                              <ul>
                                {[...c.changes, ...c.notes].map((x) => (
                                  <li key={x}>{x}</li>
                                ))}
                              </ul>
                            )}
                            {c.status === 'changed' && !rows[id] && (
                              <button
                                type="button"
                                className="secondary"
                                onClick={() => setRow(id, {})}
                              >
                                Keep my decision
                              </button>
                            )}
                          </div>
                        )}
                        <label htmlFor={`dis-${id}`}>Disposition</label>
                        <select
                          id={`dis-${id}`}
                          value={r.disposition}
                          onChange={(e) =>
                            setRow(id, {
                              disposition: e.target
                                .value as SelectionDisposition,
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
                        {gate?.stale_reasons.includes(id) && (
                          <div className="carry-flag">
                            <strong>
                              These reasons were written for “
                              {words(
                                latest?.dispositions.find(
                                  (x) =>
                                    x.alternative.id.toLowerCase() ===
                                    id.toLowerCase(),
                                )?.disposition ?? '',
                              )}
                              ”.
                            </strong>{' '}
                            Rewrite them for the new choice, or keep them if
                            they still apply.
                            <div>
                              <button
                                type="button"
                                className="secondary"
                                onClick={() =>
                                  setReasonsKept((k) => ({
                                    ...k,
                                    [id]: r.disposition,
                                  }))
                                }
                              >
                                Keep these reasons
                              </button>
                            </div>
                          </div>
                        )}
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
                            <label htmlFor={`rev-${id}`}>
                              Would reverse if
                            </label>
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
                    </Fold>
                  );
                })}
                <label htmlFor="dec-rationale">Overall rationale</label>
                <textarea
                  id="dec-rationale"
                  rows={2}
                  maxLength={1200}
                  value={rationale}
                  onChange={(e) => {
                    setRationale(e.target.value);
                    // Typing binds the rationale to the choices as they are now; a later
                    // change of choices flags it again (PR #95 re-review L-2).
                    if (gate) setRationaleKept(gate.rationale_signature);
                  }}
                />
                {gate?.rationale_review && rationale.trim() && (
                  <div className="carry-flag">
                    <strong>Review the overall rationale.</strong> It was
                    written for your earlier decision, and the options or your
                    choices are different now. Keep it if it still explains this
                    decision, or rewrite it.
                    <div>
                      <button
                        type="button"
                        className="secondary"
                        onClick={() =>
                          setRationaleKept(gate.rationale_signature)
                        }
                      >
                        Keep this rationale
                      </button>
                    </div>
                  </div>
                )}
                <Routine
                  summary={overrideSummary(gate, override)}
                  open={overrideMatters(gate, override)}
                >
                  <label htmlFor="dec-override">
                    Override reason (needed when you advance a lower-ranked
                    option)
                  </label>
                  <input
                    id="dec-override"
                    maxLength={1200}
                    value={override}
                    onChange={(e) => {
                      setOverride(e.target.value);
                      if (gate) setOverrideKept(gate.override_signature);
                    }}
                  />
                  {gate && !gate.override_needed && override.trim() && (
                    <p className="small">
                      Not needed for these choices: no option is advanced over a
                      higher-ranked one, so this reason is not recorded.
                    </p>
                  )}
                  {gate?.override_review && (
                    <div className="carry-flag">
                      <strong>Review the override reason.</strong>{' '}
                      {override.trim()
                        ? 'The options this reason compares have changed. Keep it if it still explains the choice, or rewrite it.'
                        : 'Your choices now advance an option over higher-ranked options; give a reason.'}
                      {override.trim() && (
                        <div>
                          <button
                            type="button"
                            className="secondary"
                            onClick={() =>
                              gate && setOverrideKept(gate.override_signature)
                            }
                          >
                            Keep this reason
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </Routine>
                {/* Opens only once the runs are loaded and none is active; runId is empty for a moment
                    before the first run is picked, and a fold opened then would stay open. */}
                <Routine summary={routineSummary} open={d.runs.length === 0}>
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
                        {runLabel(r, d.names)}
                        {r.run_id === d.cmp.run_id
                          ? ' (found this problem)'
                          : ''}
                      </option>
                    ))}
                  </select>
                </Routine>
                {gate &&
                  pendingReviews(gate, override, optionName, incomplete)
                    .length > 0 && (
                    <p className="small">
                      Before you can record:{' '}
                      {pendingReviews(
                        gate,
                        override,
                        optionName,
                        incomplete,
                      ).join('; ')}
                      .
                    </p>
                  )}
                <WhatWillHappen
                  items={[
                    {
                      label: 'Selection',
                      value: `Records ${
                        dispositionCounts(
                          alts.map((a) => row(a.entity.id).disposition),
                          DISPOSITION_NOTE,
                        ) || 'no dispositions yet'
                      } for ${alts.length} option${alts.length === 1 ? '' : 's'}, bound to report ${d.report.report_hash.slice(0, 12)}`,
                    },
                    {
                      label: 'Run',
                      value: chosenRun
                        ? runLabel(chosenRun, d.names)
                        : 'No active run: start or resume one first',
                      ...(source !== 'none' && {
                        source:
                          source === 'found'
                            ? 'the run that found this problem'
                            : 'chosen here',
                      }),
                    },
                    {
                      label: 'Override reason',
                      value: gate?.override_needed
                        ? override.trim()
                          ? 'Recorded with the selection'
                          : 'Needed before you can record'
                        : 'Not needed: no option is advanced over a higher-ranked one',
                    },
                    {
                      label: 'Data class',
                      value:
                        workspace.record_mode === 'fixture'
                          ? 'Synthetic'
                          : 'Public',
                      source:
                        workspace.record_mode === 'fixture'
                          ? 'fixture workspace'
                          : 'real workspace',
                    },
                  ]}
                  note="Nothing is recorded until you press the button below, and the server checks the report, the gates and the run again; if the run needs your approval, it waits on Approvals. Every disposition, reason and rationale is only what you wrote."
                />
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

            <ResponseExplanationPanel
              base={base}
              problemId={focus}
              reloadKey={`${d.report.report_hash}:${latest?.id ?? ''}`}
              open={open}
            />

            <div className="fold-head">
              <h3>Selection history</h3>
              <FoldAll
                ids={d.selections.map((s) => s.id)}
                folds={historyFolds}
                label="selections"
              />
            </div>
            {d.selections.length === 0 ? (
              <Empty>No selection recorded for this problem yet.</Empty>
            ) : (
              <ol className="rows">
                {d.selections.map((s) => (
                  <li key={s.id}>
                    <Fold
                      id={s.id}
                      folds={historyFolds}
                      summary={
                        <>
                          <strong>{s.current ? 'Current' : 'Replaced'}</strong>{' '}
                          · {when(s.created_at)} ·{' '}
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
                              · {x.reasons.join(' ')} · reverse if{' '}
                              {x.reverse_if}
                            </small>
                          </li>
                        ))}
                      </ul>
                      {s.overrides.length > 0 && (
                        <p className="override">
                          Override: {s.override_reason}
                        </p>
                      )}
                    </Fold>
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
