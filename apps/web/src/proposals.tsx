import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CORE_PROPOSAL_SECTIONS,
  PROPOSAL_KINDS,
  PROPOSAL_SECTIONS,
  PROPOSAL_SECTION_LABELS,
  PROPOSAL_SECTION_MAX,
  ProblemComparisonSchema,
  ProposalDetailSchema,
  ProposalDraftSchema,
  ProposalSummarySchema,
  ResponseExplanationSchema,
  SelectionSchema,
  StoredEntitySchema,
  WorkspaceFileSchema,
  z,
  type ClaimEvidence,
  type ProposalBody,
  type ProposalChecks,
  type ProposalDetail,
  type ProposalDraft,
  type ProposalSection,
  type ResponseExplanation,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { Empty, Status, StaleNote, clip, useLoad, type View } from './ui.js';
import { Markdown } from './markdown-view.js';
import { newestFirst } from './versions.js';
import { RunbookExport } from './runbook.js';
import {
  Fold,
  FoldAll,
  useFoldChoices,
  useFolds,
  type FoldChoices,
} from './fold.js';
import { firstNeeding } from './fold-state.js';
import { Routine, WhatWillHappen } from './routine.js';
import { useViewMode } from './view-mode.js';
import {
  FOLDED_PROPOSAL_SECTIONS,
  foldedSectionsSummary,
  revisionReasonSummary,
  sectionCounts,
} from './decide-routine.js';

// ADR-0077 (P09): why a response was chosen (shown on Decide), and the Proposals tab, where a
// recommended non-code option gets a versioned proposal people write, check, review, revise,
// download as Markdown and save to Files. Nothing here says a plan was carried out or works.

const RESPONSE: Record<string, string> = {
  use_existing: 'Existing tool',
  change_process: 'Process change',
  human_led: 'Human-led',
  hybrid: 'Hybrid',
  investigate: 'Investigate',
  build: 'Custom software',
};
/**
 * The option's response type and title, without saying the type twice when the title already
 * starts with it ("Human-led: Human-led: …" read as a stutter).
 */
export function kindTitle(kind: string, title: string): string {
  const label = RESPONSE[kind] ?? words(kind);
  const head = /^([^:]{1,40}):\s/.exec(title)?.[1]?.trim().toLowerCase();
  const known = [
    label,
    ...Object.values(RESPONSE),
    'Software',
    'Use the existing tool',
  ].map((x) => x.toLowerCase());
  return head && known.includes(head) ? title : `${label}: ${title}`;
}
const STATE_TEXT = {
  written: 'Written',
  unknown: 'Unknown yet',
  not_applicable: 'Not applicable',
} as const;
const MARK_TEXT = {
  pass: 'Looks right',
  concern: 'Concern',
  not_checked: 'Not checked',
} as const;
const MARKS = [
  ['completeness', 'Completeness'],
  ['citation_fidelity', 'Citations match the evidence'],
  ['feasibility', 'Feasible as described'],
  ['access', 'Access and ethics'],
] as const;

/** Why the chosen response was chosen, and the software routes it was compared against. */
export function ResponseExplanationPanel({
  base,
  problemId,
  reloadKey,
  open,
}: {
  base: string;
  problemId: string;
  /** Changes when the page records something, so the explanation is read again. */
  reloadKey: string;
  open: (view: View, id?: string) => void;
}) {
  // Audit (final UX pass): no problem chosen yet means nothing to explain; asking anyway
  // requested `problems//explanation` and logged a 404 on every Decide visit.
  const x = useLoad(
    async () =>
      problemId
        ? api(
            ResponseExplanationSchema,
            `${base}/problems/${problemId}/explanation`,
          )
        : null,
    [base, problemId, reloadKey],
  );
  const proposals = useLoad(
    async () =>
      problemId
        ? api(
            z.array(ProposalSummarySchema),
            `${base}/proposals?problem=${problemId}`,
          )
        : [],
    [base, problemId, reloadKey],
  );
  const e = x.data;
  if (!e || e.basis === 'none')
    return x.error ? <p className="error">{x.error}</p> : null;
  return (
    <section className="panel explain" aria-labelledby="explain-head">
      <h3 id="explain-head">Why this response</h3>
      <StaleNote stale={x.stale || proposals.stale} />
      <p>{e.summary}</p>
      {e.selection?.report_changed && (
        <p className="notice small">
          Scores or gates changed since the selection was recorded; the
          comparison uses today’s scores.
        </p>
      )}
      {e.chosen.map((c) => {
        const proposal = proposals.data?.find(
          (p) => p.alternative.id === c.alternative.id,
        );
        const canPropose =
          (PROPOSAL_KINDS as readonly string[]).includes(c.alternative.kind) &&
          (c.disposition === 'recommend_alternative' ||
            c.disposition === 'proceed_to_validation');
        return (
          <div key={c.alternative.id} className="explain-chosen">
            <h4>{kindTitle(c.alternative.kind, c.alternative.title)}</h4>
            {c.reasons.length > 0 && (
              <ul className="small">
                {c.reasons.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            {c.reverse_if && (
              <p className="small">
                <strong>Would change if:</strong> {c.reverse_if}
              </p>
            )}
            {canPropose && (
              <button
                className="secondary"
                onClick={() =>
                  open('proposals', proposal ? proposal.id : undefined)
                }
              >
                {proposal ? 'Open its proposal' : 'Write a proposal'}
              </button>
            )}
          </div>
        );
      })}
      {e.software_avenues.length > 0 && (
        <>
          <h4>
            {e.non_code
              ? 'Software-assisted routes, and what would make them preferable'
              : 'Other software routes'}
          </h4>
          {e.software_avenues.map((a) => (
            <details key={a.option.alternative.id} className="explain-avenue">
              <summary>
                {kindTitle(
                  a.option.alternative.kind,
                  a.option.alternative.title,
                )}{' '}
                <small>
                  ·{' '}
                  {a.option.rank !== null
                    ? `rank ${a.option.rank}${a.option.score ? `, ${a.option.score}` : ''}`
                    : a.option.status === 'unscored'
                      ? 'not scored'
                      : 'incomplete scores'}
                  {a.option.disposition
                    ? ` · ${words(a.option.disposition)}`
                    : ''}
                </small>
              </summary>
              {(a.option.rationale || a.humility?.software_part) && (
                <p className="small">
                  <strong>How software could help:</strong>{' '}
                  {a.humility?.software_part || a.option.rationale}
                </p>
              )}
              {a.humility && (
                <p className="small">
                  Humility review: {words(a.humility.state)}
                  {a.humility.reasons.length
                    ? ` (${a.humility.reasons.join(' ')})`
                    : ''}
                  .
                </p>
              )}
              <p className="small">
                <strong>Would become preferable if:</strong>
              </p>
              <ul className="small">
                {a.would_prefer_if.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </details>
          ))}
        </>
      )}
      {e.criteria.length > 0 && e.software_avenues.length > 0 && (
        <details>
          <summary className="small">Ratings by criterion</summary>
          <div className="table-wrap">
            <table className="ranking">
              <thead>
                <tr>
                  <th scope="col">Criterion</th>
                  {[
                    ...e.chosen,
                    ...e.software_avenues.map((a) => a.option),
                  ].map((o) => (
                    <th scope="col" key={o.alternative.id}>
                      {clip(o.alternative.title, 40)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {e.criteria.map((c) => (
                  <tr key={c.criterion}>
                    <th scope="row">{c.label}</th>
                    {[
                      ...e.chosen,
                      ...e.software_avenues.map((a) => a.option),
                    ].map((o) => (
                      <td key={o.alternative.id}>
                        {c.ratings[o.alternative.id] ?? 'unknown'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      <p className="small">{e.notes[0]}</p>
    </section>
  );
}

type Eligible = {
  problem: { id: string; title: string };
  option: { id: string; version: number; title: string; kind: string };
};

/** The Proposals tab: list, start from a recommended non-code option, edit and review. */
export function Proposals({
  session,
  workspace,
  focus,
  onFocus,
}: {
  session: SessionInfo;
  workspace: Workspace;
  focus: string;
  onFocus: (id: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const writer = workspace.role !== 'viewer';
  const [draft, setDraft] = useState<{
    draft: ProposalDraft;
    eligible: Eligible;
  } | null>(null);
  const [error, setError] = useState('');
  const list = useLoad(async () => {
    const [proposals, problems, alts] = await Promise.all([
      api(z.array(ProposalSummarySchema), `${base}/proposals`),
      api(
        z.array(StoredEntitySchema),
        `${base}/entities?kind=problem&status=active`,
      ),
      api(
        z.array(StoredEntitySchema),
        `${base}/entities?kind=alternative&status=active`,
      ),
    ]);
    const selections = await Promise.all(
      problems.map((p) =>
        api(z.array(SelectionSchema), `${base}/problems/${p.id}/selections`),
      ),
    );
    const eligible: Eligible[] = [];
    selections.forEach((sels, i) => {
      const current = sels.find((s) => s.current);
      for (const d of current?.dispositions ?? []) {
        if (
          d.disposition !== 'recommend_alternative' &&
          d.disposition !== 'proceed_to_validation'
        )
          continue;
        const a = alts.find((x) => x.id === d.alternative.id.toLowerCase());
        const kind = String(a?.body?.kind ?? '');
        if (!a || !(PROPOSAL_KINDS as readonly string[]).includes(kind))
          continue;
        if (proposals.some((p) => p.alternative.id === a.id)) continue;
        eligible.push({
          problem: { id: problems[i]!.id, title: problems[i]!.title },
          option: { id: a.id, version: a.version, title: a.title, kind },
        });
      }
    });
    return { proposals, eligible };
  }, [workspace.id]);
  useEffect(() => {
    if (focus) setDraft(null);
  }, [focus]);
  // Review L-6: the sections the person opened stay open across saves, which remount the
  // editor; picking another proposal or starting a new one starts afresh.
  const [sectionChoices, setSectionChoices] = useFoldChoices();
  // Re-review R-2/R2-1/R4-1: the choices belong to one proposal (or to the unsaved draft,
  // 'draft'). Opening any other proposal, any way, starts afresh; the draft's own first save
  // hands its choices to the new id.
  const choicesFor = useRef(focus);
  useEffect(() => {
    if (focus && choicesFor.current !== focus) {
      if (choicesFor.current) setSectionChoices({});
      choicesFor.current = focus;
    }
  }, [focus]);

  async function start(e: Eligible) {
    setError('');
    try {
      const d = await api(
        ProposalDraftSchema,
        `${base}/proposals/draft?alternative=${e.option.id}`,
      );
      setDraft({ draft: d, eligible: e });
      setSectionChoices({});
      choicesFor.current = 'draft';
      onFocus('');
    } catch (err) {
      setError(message(err));
    }
  }
  const items = list.data?.proposals ?? [];
  return (
    <div className="proposals-layout">
      <section className="panel" aria-labelledby="proposals-head">
        <h2 id="proposals-head">Proposals</h2>
        <p className="small">
          When a recommended response is not new software, write it up here as a
          plan people can use: what to do, with which evidence, how to tell
          whether it worked. Each save is a new version; reviews belong to the
          version they read.
        </p>
        <Status
          loading={list.loading}
          error={list.error}
          stale={list.stale}
          retry={list.reload}
        >
          {list.data && list.data.eligible.length > 0 && writer && (
            <>
              <h3>Ready for a proposal</h3>
              <ul className="rows">
                {list.data.eligible.map((e) => (
                  <li key={e.option.id}>
                    <span>
                      {kindTitle(e.option.kind, e.option.title)}{' '}
                      <small>· {clip(e.problem.title, 80)}</small>
                    </span>{' '}
                    <button className="secondary" onClick={() => start(e)}>
                      Start a proposal
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
          {error && <p className="error">{error}</p>}
          <h3>Saved proposals</h3>
          {items.length === 0 ? (
            <Empty>
              No proposals yet. On Decide, record a selection that recommends an
              existing tool, a process change, a human-led or hybrid response;
              it then appears above.
            </Empty>
          ) : (
            <ul className="rows">
              {items.map((p) => (
                <li key={p.id}>
                  <button
                    className={`text${p.id === focus ? ' current' : ''}`}
                    aria-current={p.id === focus ? 'true' : undefined}
                    onClick={() => onFocus(p.id)}
                  >
                    {p.title}
                  </button>{' '}
                  <small>
                    · {RESPONSE[p.response]} · v{p.version}
                    {p.status !== 'active' ? ` · ${p.status}` : ''} ·{' '}
                    {when(p.updated_at)}
                  </small>
                </li>
              ))}
            </ul>
          )}
        </Status>
      </section>
      {draft && !focus && (
        <ProposalEditor
          key={`new:${draft.eligible.option.id}`}
          base={base}
          session={session}
          writer={writer}
          start={draft.draft}
          detail={null}
          foldChoices={[sectionChoices, setSectionChoices]}
          saved={(id) => {
            setDraft(null);
            list.reload();
            choicesFor.current = id;
            onFocus(id);
          }}
        />
      )}
      {focus && (
        <ProposalView
          key={focus}
          base={base}
          session={session}
          writer={writer}
          id={focus}
          changed={list.refresh}
          foldChoices={[sectionChoices, setSectionChoices]}
        />
      )}
    </div>
  );
}

function ProposalView({
  base,
  session,
  writer,
  id,
  changed,
  foldChoices,
}: {
  base: string;
  session: SessionInfo;
  writer: boolean;
  id: string;
  changed: () => void;
  foldChoices: FoldChoices;
}) {
  const [version, setVersion] = useState<number | null>(null);
  const d = useLoad(
    () =>
      api(
        ProposalDetailSchema,
        `${base}/proposals/${id}${version ? `?version=${version}` : ''}`,
      ),
    [base, id, version],
  );
  return (
    <Status
      loading={d.loading && !d.data}
      error={d.error}
      stale={d.stale}
      retry={d.reload}
    >
      {d.data && (
        <ProposalEditor
          key={`${id}:${d.data.shown_version}:${d.data.proposal.version}`}
          base={base}
          session={session}
          writer={writer}
          start={null}
          detail={d.data}
          foldChoices={foldChoices}
          pickVersion={(v) =>
            setVersion(v === d.data!.proposal.version ? null : v)
          }
          saved={() => {
            setVersion(null);
            d.refresh();
            changed();
          }}
        />
      )}
    </Status>
  );
}

function ChecksList({
  checks,
  label,
}: {
  checks: ProposalChecks;
  label: string;
}) {
  const blockers = checks.checks.filter((c) => c.level === 'blocker');
  const warnings = checks.checks.filter((c) => c.level === 'warning');
  return (
    <div className="proposal-checks" aria-label={label}>
      <p>
        <strong>
          {checks.ready_for_review
            ? 'Ready for review'
            : checks.complete
              ? 'Complete, with blockers'
              : 'Not complete yet'}
        </strong>{' '}
        <small>
          · {checks.written} written, {checks.unknown} unknown,{' '}
          {checks.not_applicable} not applicable · {label}
        </small>
      </p>
      {blockers.length + warnings.length > 0 && (
        <ul className="small">
          {blockers.map((c, i) => (
            <li key={`b${i}`} className="error">
              {c.message}
            </li>
          ))}
          {warnings.map((c, i) => (
            <li key={`w${i}`}>{c.message}</li>
          ))}
          {checks.blockers + checks.warnings > checks.checks.length && (
            <li>
              …and {checks.blockers + checks.warnings - checks.checks.length}{' '}
              more, not listed (only the first 200 are kept).
            </li>
          )}
        </ul>
      )}
      <p className="small">
        These checks are about the document (sections, citations, changes since
        it was written). They do not show that the plan works.
      </p>
    </div>
  );
}

function ProposalEditor({
  base,
  session,
  writer,
  start,
  detail,
  pickVersion,
  saved,
  foldChoices,
}: {
  base: string;
  session: SessionInfo;
  writer: boolean;
  /** A fresh draft (not saved yet), or null when editing a saved proposal. */
  start: ProposalDraft | null;
  detail: ProposalDetail | null;
  pickVersion?: (v: number) => void;
  saved: (id: string) => void;
  foldChoices: FoldChoices;
}) {
  const initial = start
    ? { title: start.title, body: start.body }
    : { title: detail!.proposal.title, body: detail!.proposal.body };
  const [title, setTitle] = useState(initial.title);
  const [body, setBody] = useState<ProposalBody>(() =>
    structuredClone(initial.body),
  );
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const older = !!detail && detail.shown_version !== detail.proposal.version;
  const editable =
    writer && (!detail || (!older && detail.proposal.status === 'active'));
  const claims = useLoad(
    () =>
      api(
        ProblemComparisonSchema,
        `${base}/problems/${initial.body.problem.id}/comparison`,
      ).then((c) => c.claims),
    [base, initial.body.problem.id],
  );
  const offered: { relation: string; evidence: ClaimEvidence }[] =
    claims.data ?? [];
  const setSection = (
    k: ProposalSection,
    patch: Partial<ProposalBody['sections'][ProposalSection]>,
  ) => {
    setBody((b) => ({
      ...b,
      sections: { ...b.sections, [k]: { ...b.sections[k], ...patch } },
    }));
    // A section being edited stays open once it no longer needs attention.
    sectionFolds.set(k, true);
  };
  const dirty =
    title !== initial.title ||
    JSON.stringify(body) !== JSON.stringify(initial.body);

  async function save(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setNote('');
    try {
      const out = detail
        ? await api(
            ProposalDetailSchema,
            `${base}/proposals/${detail.proposal.id}/revisions`,
            {
              csrf: session.csrf_token,
              body: {
                expected_version: detail.proposal.version,
                title,
                body,
                reason: reason.trim() || 'Edited',
              },
            },
          )
        : await api(ProposalDetailSchema, `${base}/proposals`, {
            csrf: session.csrf_token,
            idempotencyKey: crypto.randomUUID(),
            body: { title, body },
          });
      saved(out.proposal.id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  async function toFiles() {
    if (!detail) return;
    setNote('');
    setError('');
    try {
      const out = await api(
        z.object({ file: WorkspaceFileSchema, stored: z.boolean() }).loose(),
        `${base}/proposals/${detail.proposal.id}/files`,
        {
          csrf: session.csrf_token,
          body: {
            version: detail.shown_version,
            upload_key: crypto.randomUUID(),
          },
        },
      );
      setNote(
        out.stored
          ? `Saved to Files as ${out.file.name}.`
          : `Files already has this export (${out.file.name}).`,
      );
    } catch (err) {
      setError(message(err));
    }
  }
  const checks = detail?.checks ?? start?.checks ?? null;
  const v = detail?.shown_version;
  // P18: sections fold to one line; the first required section not written yet opens.
  // The checks (blockers included) stay above the sections, never inside one.
  // Review L-3: a section a check blocks (no claim cited, a cited claim missing or stale)
  // needs the person too, not only a required section that is not written.
  const sectionBlocker = (k: ProposalSection) =>
    checks?.checks.find((c) => c.level === 'blocker' && c.section === k);
  const sectionNeeds = (k: ProposalSection) =>
    (CORE_PROPOSAL_SECTIONS.includes(k) &&
      body.sections[k].state !== 'written') ||
    !!sectionBlocker(k);
  const sectionFolds = useFolds(
    editable ? firstNeeding(PROPOSAL_SECTIONS, sectionNeeds) : [],
    foldChoices,
  );
  // P19 follow-up: Standard keeps the required sections, contrary evidence and assumptions in
  // view and folds the other optional sections under one line; Advanced keeps the P18 order.
  const { standard } = useViewMode();
  const [expanded, setExpanded] = useState(0);
  const folded: readonly ProposalSection[] = FOLDED_PROPOSAL_SECTIONS;
  const inView = PROPOSAL_SECTIONS.filter((k) => !folded.includes(k));
  const sectionFold = (k: ProposalSection) => {
    const s = body.sections[k];
    const core = CORE_PROPOSAL_SECTIONS.includes(k);
    const cited = new Set(s.claims.map((c) => c.id));
    return (
      <Fold
        key={k}
        id={k}
        folds={sectionFolds}
        className="proposal-fold"
        summary={
          <>
            <span className="fold-title">{PROPOSAL_SECTION_LABELS[k]}</span>
            <small>
              {core ? ' · required' : ''} ·{' '}
              <span className={sectionNeeds(k) ? 'fold-attention' : undefined}>
                {STATE_TEXT[s.state]}
                {sectionBlocker(k) && s.state === 'written'
                  ? `, blocked: ${clip(sectionBlocker(k)!.message, 100)}`
                  : ''}
              </span>
              {s.claims.length > 0
                ? ` · ${s.claims.length} cited claim${s.claims.length === 1 ? '' : 's'}`
                : ''}
            </small>
            {s.text.trim() && (
              <span className="fold-line small">
                {clip(s.text.trim(), 120)}
              </span>
            )}
          </>
        }
      >
        <fieldset className="proposal-section">
          <legend className="sr-only">
            {PROPOSAL_SECTION_LABELS[k]}
            {core ? ' · required' : null}
          </legend>
          <label>
            State{' '}
            <select
              value={s.state}
              disabled={!editable}
              onChange={(e) =>
                setSection(k, {
                  state: e.target.value as typeof s.state,
                })
              }
            >
              {(['written', 'unknown', 'not_applicable'] as const)
                .filter((x) => !(core && x === 'not_applicable'))
                .map((x) => (
                  <option key={x} value={x}>
                    {STATE_TEXT[x]}
                  </option>
                ))}
            </select>
          </label>
          <textarea
            aria-label={`${PROPOSAL_SECTION_LABELS[k]} text`}
            rows={s.state === 'written' ? 5 : 2}
            value={s.text}
            maxLength={PROPOSAL_SECTION_MAX}
            disabled={!editable}
            placeholder={
              s.state === 'unknown'
                ? 'What is not known yet (optional)'
                : s.state === 'not_applicable'
                  ? 'Why it does not apply'
                  : 'Plain text; Markdown shows as typed in the saved file'
            }
            onChange={(e) => setSection(k, { text: e.target.value })}
          />
          {(k === 'evidence' ||
            k === 'contrary_evidence' ||
            s.claims.length > 0) && (
            <details open={s.claims.length > 0}>
              <summary className="small">
                Cited claims ({s.claims.length})
              </summary>
              <ul className="small claim-picks">
                {offered.map((c) => (
                  <li key={c.evidence.claim.id}>
                    <label>
                      <input
                        type="checkbox"
                        disabled={!editable}
                        checked={cited.has(c.evidence.claim.id)}
                        onChange={(e) =>
                          setSection(k, {
                            claims: e.target.checked
                              ? [
                                  ...s.claims,
                                  {
                                    id: c.evidence.claim.id,
                                    version: c.evidence.claim.version,
                                  },
                                ].slice(0, 20)
                              : s.claims.filter(
                                  (x) => x.id !== c.evidence.claim.id,
                                ),
                          })
                        }
                      />{' '}
                      {clip(
                        c.evidence.claim.statement ?? c.evidence.claim.title,
                        160,
                      )}{' '}
                      <small>
                        · {c.relation} · v{c.evidence.claim.version} ·{' '}
                        {words(c.evidence.status)}
                      </small>
                    </label>
                  </li>
                ))}
                {s.claims
                  .filter(
                    (x) => !offered.some((c) => c.evidence.claim.id === x.id),
                  )
                  .map((x) => (
                    <li key={x.id}>
                      {standard
                        ? 'A claim from earlier'
                        : `Claim ${x.id.slice(0, 8)} v${x.version}`}{' '}
                      (not linked to this problem now){' '}
                      {editable && (
                        <button
                          type="button"
                          className="text"
                          onClick={() =>
                            setSection(k, {
                              claims: s.claims.filter((y) => y.id !== x.id),
                            })
                          }
                        >
                          Remove
                        </button>
                      )}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </fieldset>
      </Fold>
    );
  };
  return (
    <section className="panel proposal" aria-labelledby="proposal-head">
      <h2 id="proposal-head">
        {detail ? title : 'New proposal (not saved yet)'}
      </h2>
      <p className="small">
        {detail
          ? `${kindTitle(body.response, detail.option_title)} · problem: ${detail.problem_title}`
          : `${RESPONSE[body.response]} · drafted from the records; sections nobody has filled in are marked unknown`}
      </p>
      {detail && (
        <div className="actions">
          <label>
            Version{' '}
            <select
              value={v}
              onChange={(e) => pickVersion?.(Number(e.target.value))}
            >
              {detail.versions.map((x) => (
                <option key={x.version} value={x.version}>
                  v{x.version} · {when(x.created_at)}
                  {x.reason ? ` · ${clip(x.reason, 50)}` : ''}
                  {x.version === detail.proposal.version ? ' (current)' : ''}
                </option>
              ))}
            </select>
          </label>
          <a
            className="button secondary"
            href={`/api/${base}/proposals/${detail.proposal.id}/export?version=${v}`}
            download
          >
            Download Markdown (v{v})
          </a>
          {writer && (
            <button className="secondary" type="button" onClick={toFiles}>
              Save v{v} to Files
            </button>
          )}
          <button
            className="text"
            type="button"
            onClick={() => setPreview((p) => !p)}
          >
            {preview ? 'Edit view' : 'Preview'}
          </button>
        </div>
      )}
      {detail && v !== undefined && (
        <RunbookExport
          key={`${detail.proposal.id}:${v}`}
          base={base}
          session={session}
          subject="proposals"
          id={detail.proposal.id}
          version={v}
          writer={writer}
        />
      )}
      {older && (
        <p className="notice small">
          You are reading version {v}. Pick the current version to edit or
          review.
        </p>
      )}
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
      {checks && (
        <ChecksList
          checks={checks}
          label={detail ? `checks of v${v} as saved` : 'checks of this draft'}
        />
      )}
      {preview ? (
        <div className="proposal-preview">
          {PROPOSAL_SECTIONS.map((k) => (
            <section key={k}>
              <h3>{PROPOSAL_SECTION_LABELS[k]}</h3>
              {body.sections[k].state === 'written' ? (
                <Markdown text={body.sections[k].text} />
              ) : (
                <p className="small">
                  <strong>{STATE_TEXT[body.sections[k].state]}.</strong>{' '}
                  {body.sections[k].text}
                </p>
              )}
            </section>
          ))}
          {checks && checks.references.length > 0 && (
            <section>
              <h3>References</h3>
              <ol className="small">
                {checks.references.map((r) => (
                  <li key={r.label}>
                    [{r.label}] {r.statement}{' '}
                    <small>
                      · cited at v{r.claim.version}
                      {r.current_version !== null &&
                      r.current_version !== r.claim.version
                        ? `, now v${r.current_version} (statement shown is v${r.current_version})`
                        : ''}{' '}
                      · {words(r.relation)} · evidence {words(r.status)}
                    </small>
                    {r.sources.length > 0 && (
                      <ul>
                        {r.sources.map((s, i) => (
                          <li key={i}>
                            {s.title || s.url} <small>({s.url})</small>
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}
        </div>
      ) : (
        <form onSubmit={save} className="proposal-form">
          <label>
            Title
            <input
              value={title}
              maxLength={300}
              disabled={!editable}
              onChange={(e) => setTitle(e.target.value)}
            />
          </label>
          <label>
            Summary
            <textarea
              rows={2}
              value={body.summary}
              maxLength={1200}
              disabled={!editable}
              onChange={(e) =>
                setBody((b) => ({ ...b, summary: e.target.value }))
              }
            />
          </label>
          <FoldAll
            ids={PROPOSAL_SECTIONS}
            folds={sectionFolds}
            label="sections"
            onExpand={() => setExpanded((n) => n + 1)}
          />
          {(standard ? inView : PROPOSAL_SECTIONS).map(sectionFold)}
          {standard && (
            <Routine
              summary={foldedSectionsSummary(
                folded.map((k) => body.sections[k].state),
                folded.filter((k) => !!sectionBlocker(k)).length,
              )}
              open={folded.some(
                (k) => sectionFolds.isOpen(k) || !!sectionBlocker(k),
              )}
              // Review N-2, re-review L-A: closing the group closes its sections, and Expand all
              // opens it again even while a blocked section keeps `open` true.
              reopen={expanded}
              onClose={() => sectionFolds.setAll(folded, false)}
            >
              {folded.map(sectionFold)}
            </Routine>
          )}
          {editable && detail && (
            <Routine summary={revisionReasonSummary(reason)}>
              <label>
                What changed{' '}
                <input
                  value={reason}
                  maxLength={300}
                  placeholder="e.g. Answered review feedback on costs"
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
            </Routine>
          )}
          {editable && (
            <WhatWillHappen
              items={[
                {
                  label: 'Proposal',
                  value: detail
                    ? `Saves version ${detail.proposal.version + 1} of “${clip(title, 80)}”; version ${detail.proposal.version} stays as it was`
                    : `Saves a new proposal “${clip(title, 80)}”`,
                },
                {
                  label: 'Sections',
                  value: sectionCounts(
                    PROPOSAL_SECTIONS.map((k) => ({
                      required: CORE_PROPOSAL_SECTIONS.includes(k),
                      state: body.sections[k].state,
                    })),
                  ),
                },
                ...(detail
                  ? [
                      {
                        label: 'What changed',
                        value: reason.trim() || 'Edited',
                        source: reason.trim() ? 'written here' : 'default',
                      },
                    ]
                  : []),
                {
                  label: 'Checks',
                  value:
                    'Run again on the saved version; a review can say “Ready to use” only once every required section is written and no check finds a blocker',
                },
              ]}
              note="Nothing is saved until you press the button below. A proposal is a document: saving it sends nothing anywhere and starts no work."
            />
          )}
          {editable && (
            <div className="actions">
              <button
                className="primary"
                disabled={busy || (!!detail && !dirty)}
              >
                {detail
                  ? `Save as version ${detail.proposal.version + 1}`
                  : 'Save proposal'}
              </button>
            </div>
          )}
          {error && <p className="error">{error}</p>}
          <StaleNote stale={claims.stale} />
        </form>
      )}
      {detail && (
        <Reviews
          base={base}
          session={session}
          detail={detail}
          canReview={
            writer && !older && detail.proposal.status === 'active' && !dirty
          }
          reviewed={() => saved(detail.proposal.id)}
        />
      )}
    </section>
  );
}

function Reviews({
  base,
  session,
  detail,
  canReview,
  reviewed,
}: {
  base: string;
  session: SessionInfo;
  detail: ProposalDetail;
  canReview: boolean;
  reviewed: () => void;
}) {
  const [verdict, setVerdict] = useState<'ready' | 'revise'>('revise');
  // "Ready" can't stay chosen once the checks say the version isn't ready (e.g. after a save).
  const canBeReady = detail.checks.ready_for_review;
  useEffect(() => {
    if (!canBeReady) setVerdict('revise');
  }, [canBeReady, detail.proposal.version]);
  const [marks, setMarks] = useState<
    Record<(typeof MARKS)[number][0], keyof typeof MARK_TEXT>
  >({
    completeness: 'not_checked',
    citation_fidelity: 'not_checked',
    feasibility: 'not_checked',
    access: 'not_checked',
  });
  const [comments, setComments] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api(
        ProposalDetailSchema,
        `${base}/proposals/${detail.proposal.id}/reviews`,
        {
          csrf: session.csrf_token,
          idempotencyKey: crypto.randomUUID(),
          body: {
            version: detail.proposal.version,
            content_hash: detail.proposal.content_hash,
            verdict,
            marks,
            comments: comments.trim(),
          },
        },
      );
      setComments('');
      reviewed();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-labelledby="reviews-head" className="proposal-reviews">
      <h3 id="reviews-head">Reviews</h3>
      {detail.reviews.length === 0 ? (
        <Empty>No reviews yet.</Empty>
      ) : (
        <ul className="rows">
          {newestFirst(
            detail.reviews.map((r) => ({ ...r, updated_at: r.created_at })),
          ).map((r) => (
            <li key={r.id}>
              <strong>{r.verdict === 'ready' ? 'Ready' : 'Revise'}</strong>{' '}
              <small>
                · v{r.version}
                {r.current ? '' : ' (an earlier version)'} · {r.reviewer_name}
                {r.self_review
                  ? ' (self-review: saved this version)'
                  : ''} · {when(r.created_at)}
              </small>
              <div className="small">
                {MARKS.map(([k, label]) => (
                  <span key={k} className="chip">
                    {label}: {MARK_TEXT[r.marks[k]]}
                  </span>
                ))}
              </div>
              {r.comments && <p className="small">{r.comments}</p>}
            </li>
          ))}
        </ul>
      )}
      {canReview && (
        <form onSubmit={submit} className="proposal-review-form">
          <p className="small">
            Review version {detail.proposal.version} as it is saved. A later
            version keeps this review, marked as for an earlier version.
          </p>
          <fieldset>
            <legend>Verdict</legend>
            {(['revise', 'ready'] as const).map((x) => (
              <label key={x}>
                <input
                  type="radio"
                  name="verdict"
                  checked={verdict === x}
                  disabled={x === 'ready' && !detail.checks.ready_for_review}
                  onChange={() => setVerdict(x)}
                />{' '}
                {x === 'ready' ? 'Ready to use' : 'Needs revision'}
              </label>
            ))}
            {!detail.checks.ready_for_review && (
              <p className="small">
                “Ready to use” opens once every core section is written and no
                check finds a blocker.
              </p>
            )}
          </fieldset>
          {MARKS.map(([k, label]) => (
            <label key={k}>
              {label}{' '}
              <select
                value={marks[k]}
                onChange={(e) =>
                  setMarks((m) => ({
                    ...m,
                    [k]: e.target.value as keyof typeof MARK_TEXT,
                  }))
                }
              >
                {(Object.keys(MARK_TEXT) as (keyof typeof MARK_TEXT)[]).map(
                  (x) => (
                    <option key={x} value={x}>
                      {MARK_TEXT[x]}
                    </option>
                  ),
                )}
              </select>
            </label>
          ))}
          <label>
            Comments{verdict === 'revise' ? ' (what to revise)' : ''}
            <textarea
              rows={3}
              maxLength={4000}
              value={comments}
              onChange={(e) => setComments(e.target.value)}
            />
          </label>
          <button className="secondary" disabled={busy}>
            Save review
          </button>
          {error && <p className="error">{error}</p>}
        </form>
      )}
    </section>
  );
}

export type { ResponseExplanation };
