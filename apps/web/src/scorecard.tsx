import { useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  RUBRICS,
  StoredEntitySchema,
  type ClaimEvidence,
  type SessionInfo,
  type StoredEntity,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { clip } from './ui.js';
import {
  CHECK_DEFAULT,
  OPEN_CHECKS,
  CHECK_LABELS,
  draftFromBody,
  draftFromSystem,
  draftToBody,
  earlierPicks,
  emptyDraft,
  refKey,
  rubricsFor,
  type GateChoice,
  type RatingChoice,
  type RubricKey,
  type ScorecardBodyShape,
  type ScorecardDraft,
} from './scorecard-fields.js';
import { Routine, WhatWillHappen } from './routine.js';

const RUBRIC_NAME: Record<RubricKey, string> = {
  suitability: 'Solution suitability',
  opportunity: 'Software opportunity',
};
const RATINGS: RatingChoice[] = ['1', '2', '3', '4', '5', 'unknown'];
const GATES: { value: GateChoice; label: string }[] = [
  { value: 'clear', label: 'Clear: no concern found' },
  { value: 'resolved', label: 'Resolved: a concern was found and dealt with' },
  { value: 'unresolved', label: 'Unresolved: blocks building' },
];

type Option = { entity: StoredEntity; kind: string };

/**
 * Your active scorecard of this option on this rubric, if you have one to revise. Records
 * carry the reviewer's label, not an account, so a card is yours when it is a human card
 * under your display name; another member's card is never offered for revision.
 */
const yours = (
  cards: StoredEntity[],
  optionId: string,
  rubric: RubricKey,
  label: string,
) =>
  cards.find((c) => {
    const b = c.body as ScorecardBodyShape | undefined;
    return (
      c.status === 'active' &&
      b?.rubric === rubric &&
      b.subject.id.toLowerCase() === optionId &&
      b.reviewer.kind === 'human' &&
      b.reviewer.label === label
    );
  });

/**
 * "Score an option" on Compare and decide: one reviewer's ratings of one option version on
 * one rubric (context/SCORING_RUBRIC.md). The owner picks every rating, gate and confidence
 * level; only the problem's affected group and the brief's outcome measure are filled in.
 */
export function ScoreOption({
  base,
  session,
  options,
  claims,
  scorecards,
  prefill,
  saved,
  pick,
}: {
  base: string;
  session: SessionInfo;
  options: Option[];
  claims: ClaimEvidence[];
  scorecards: StoredEntity[];
  prefill: { target_users?: string; measurable_outcome?: string };
  saved: () => void;
  /** ADR-0074: open the form on this option and rubric ("Edit the assessment"). */
  pick?: {
    optionId: string;
    rubric: RubricKey;
    /** The system card whose Edit was pressed (review M-3). */
    systemId?: string;
    n: number;
  } | null;
}) {
  const [optionId, setOptionId] = useState('');
  const [picked, setRubric] = useState<RubricKey>('suitability');
  /** The owner's edits, bound to the option, rubric and card they were made for. */
  const [edits, setEdits] = useState<{
    key: string;
    draft: ScorecardDraft;
    reason: string;
  } | null>(null);
  /** A human card under another label the owner said is theirs (review L-1). */
  const [claimed, setClaimed] = useState<string | null>(null);
  /** The system card the owner chose to edit, from its Edit button (review M-3). */
  const [target, setTarget] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  useEffect(() => {
    if (!pick) return;
    setDone('');
    setClaimed(null);
    setTarget(pick.systemId ?? null);
    setOptionId(pick.optionId);
    setRubric(pick.rubric);
    document
      .getElementById('score-title')
      ?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [pick?.n]);
  const reviewer = session.display_name.trim().slice(0, 300) || 'Owner';
  const option = options.find((o) => o.entity.id === optionId);
  const rubrics = option ? rubricsFor(option.kind) : [];
  // A rubric the option does not offer falls back in the same render, never after it.
  const rubric: RubricKey = rubrics.includes(picked) ? picked : 'suitability';
  const def = RUBRICS[rubric];
  const criteria = def.criteria.map((c) => c.key);
  const humanCards = option
    ? scorecards.filter((c) => {
        const b = c.body as ScorecardBodyShape | undefined;
        return (
          c.status === 'active' &&
          b?.rubric === rubric &&
          b.subject.id.toLowerCase() === option.entity.id &&
          b.reviewer.kind === 'human'
        );
      })
    : [];
  const existing = option
    ? (humanCards.find((c) => c.id === claimed) ??
      yours(scorecards, option.entity.id, rubric, reviewer))
    : undefined;
  const others = humanCards.filter((c) => c.id !== existing?.id);
  const existingBody = existing?.body as ScorecardBodyShape | undefined;
  /** ADR-0074: the current automatic assessments of this option on this rubric. */
  const systemCards = option
    ? scorecards.filter((c) => {
        const b = c.body as ScorecardBodyShape | undefined;
        return (
          c.status === 'active' &&
          b?.rubric === rubric &&
          !!b.assessment &&
          b.subject.id.toLowerCase() === option.entity.id &&
          b.subject.version === option.entity.version
        );
      })
    : [];
  /**
   * The system card this form edits: the one whose Edit was pressed, or with no card of the
   * owner's, the current one. Review M-3: when the owner's card replaces an older assessment
   * (or none), editing a newer one moves the owner's card on to replace it.
   */
  const chosen =
    systemCards.find((c) => c.id === target) ??
    (!existing ? systemCards[0] : undefined);
  const systemCard =
    chosen &&
    existingBody?.edit_of?.scorecard.id.toLowerCase() ===
      chosen.id.toLowerCase()
      ? undefined
      : chosen;
  const systemBody = systemCard?.body as ScorecardBodyShape | undefined;
  /** The owner's card moves on to replace a newer automatic assessment. */
  const repoint = !!existing && !!systemCard;
  /** A card of an older option version: its judgments must be made again (review M-1). */
  const olderCard =
    !!existingBody &&
    !!option &&
    existingBody.subject.version !== option.entity.version;
  const offered = new Set(
    claims.map((c) => refKey({ id: c.claim.id, version: c.claim.version })),
  );
  /** The current version of each linked claim, by claim id, for swapping older citations. */
  const current = new Map(
    claims.map((c) => [
      c.claim.id.toLowerCase(),
      refKey({ id: c.claim.id, version: c.claim.version }),
    ]),
  );

  // The draft is derived in the same render as the option, rubric and card it belongs to,
  // so the fields never render against another rubric's draft (review H-1).
  const draftKey = option
    ? `${option.entity.id}:${option.entity.version}:${rubric}:${existing?.id ?? ''}:${existing?.version ?? ''}:${systemCard?.id ?? ''}`
    : '';
  const fresh = useMemo(
    () =>
      !option
        ? null
        : systemBody
          ? draftFromSystem(systemBody, criteria)
          : existingBody
            ? draftFromBody(existingBody, criteria, !olderCard)
            : emptyDraft(criteria, prefill),
    [draftKey],
  );
  const draft = edits?.key === draftKey ? edits.draft : fresh;
  const reason = edits?.key === draftKey ? edits.reason : '';
  useEffect(() => setErrors({}), [draftKey]);
  const set = (f: (d: ScorecardDraft) => ScorecardDraft) => {
    if (draft)
      setEdits({ key: draftKey, draft: f(structuredClone(draft)), reason });
  };
  const setReason = (r: string) => {
    if (draft) setEdits({ key: draftKey, draft, reason: r });
  };
  const earlier = olderCard ? earlierPicks(existingBody!) : null;
  const err = (k: string) =>
    errors[k] ? (
      <span id={`sc-${k}-error`} className="error">
        {errors[k]}
      </span>
    ) : null;
  const invalid = (k: string) =>
    errors[k]
      ? { 'aria-invalid': true, 'aria-describedby': `sc-${k}-error` }
      : {};

  // ADR-0082 (P19): the checks are routine: unanswered ones say "unknown" until changed.
  const checkField = (k: keyof ScorecardDraft['checks']) => (
    <div key={k}>
      <label htmlFor={`sc-check-${k}`}>
        {CHECK_LABELS[k]}
        <input
          id={`sc-check-${k}`}
          maxLength={300}
          value={draft?.checks[k] ?? ''}
          {...invalid(`checks.${k}`)}
          onChange={(e) =>
            set((d) => {
              d.checks[k] = e.target.value;
              return d;
            })
          }
        />
      </label>
      {err(`checks.${k}`)}
    </div>
  );
  // "Evidence against it" and today's workaround are judgments, so they stay outside the fold.
  const checkKeys = Object.keys(
    CHECK_LABELS,
  ) as (keyof ScorecardDraft['checks'])[];
  const foldedChecks = checkKeys.filter((k) => !OPEN_CHECKS.includes(k));
  const answered = draft
    ? foldedChecks.filter((k) => {
        const v = draft.checks[k].trim();
        return v && v.toLowerCase() !== CHECK_DEFAULT;
      }).length
    : 0;
  const tools = draft?.alternatives_checked.length ?? 0;
  const checksSummary = `Other checks: ${answered} of ${foldedChecks.length} answered, the rest “unknown” · ${tools === 0 ? 'no existing tools listed' : `${tools} existing tool${tools === 1 ? '' : 's'} listed`}`;

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!option || !draft) return;
    setDone('');
    setError('');
    const out = draftToBody(draft, {
      rubric,
      rubricVersion: def.version,
      criteria,
      subject: { id: option.entity.id, version: option.entity.version },
      reviewer,
    });
    const errs = { ...(out.errors ?? {}) };
    if (existing && !reason.trim())
      errs.reason = 'Say why you are changing your scores.';
    if (systemCard && !reason.trim())
      errs.reason = 'Say why you are changing the automatic assessment.';
    if (Object.keys(errs).length) {
      setErrors(errs);
      return;
    }
    setErrors({});
    setBusy(true);
    const title = clip(`${RUBRIC_NAME[rubric]}: ${option.entity.title}`, 300);
    try {
      await api(
        StoredEntitySchema,
        existing
          ? `${base}/scorecards/${existing.id}/revisions`
          : `${base}/scorecards`,
        {
          csrf: session.csrf_token,
          body: existing
            ? {
                expected_version: existing.version,
                title,
                // A revision keeps the system card its first version replaced (ADR-0074),
                // unless the owner is editing a newer assessment (review M-3).
                body:
                  repoint && systemCard && out.body
                    ? {
                        ...out.body,
                        edit_of: {
                          scorecard: {
                            id: systemCard.id,
                            version: systemCard.version,
                          },
                          reason: reason.trim().slice(0, 300),
                        },
                      }
                    : existingBody?.edit_of
                      ? { ...out.body, edit_of: existingBody.edit_of }
                      : out.body,
                reason: reason.trim().slice(0, 300),
              }
            : {
                title,
                body:
                  systemCard && out.body
                    ? {
                        ...out.body,
                        edit_of: {
                          scorecard: {
                            id: systemCard.id,
                            version: systemCard.version,
                          },
                          reason: reason.trim().slice(0, 300),
                        },
                      }
                    : out.body,
              },
        },
      );
      setDone(
        repoint
          ? 'Your scorecard now replaces the newer automatic assessment. Its earlier ratings are kept in its history, and the assessment is kept as it was, marked as replaced.'
          : existing
            ? 'Scorecard revised. The ranking above now uses your new ratings.'
            : systemCard
              ? 'Your edit is saved as your own scorecard. The automatic assessment is kept as it was, marked as replaced, and the ranking now counts your ratings instead.'
              : 'Scorecard saved. The ranking above now includes it.',
      );
      saved();
    } catch (x) {
      setError(message(x));
    } finally {
      setBusy(false);
    }
  }

  const cardsFor = option
    ? scorecards.filter(
        (c) =>
          c.status === 'active' &&
          (
            c.body as ScorecardBodyShape | undefined
          )?.subject.id.toLowerCase() === option.entity.id,
      )
    : [];

  return (
    <form
      className="score-form"
      onSubmit={(e) => void submit(e)}
      aria-labelledby="score-title"
    >
      <h3 id="score-title">Score an option</h3>
      <p className="small">
        Rate one option on one rubric. Every rating is your judgment: pick
        Unknown when the evidence does not tell you, and it stays unknown in the
        ranking rather than being averaged away. A rating needs at least one
        claim behind it.
      </p>
      <div className="filters">
        <label htmlFor="sc-option" className="inline">
          Option
        </label>
        <select
          id="sc-option"
          value={optionId}
          onChange={(e) => {
            setDone('');
            setClaimed(null);
            setOptionId(e.target.value);
          }}
        >
          <option value="">Choose an option to score</option>
          {options.map((o) => (
            <option key={o.entity.id} value={o.entity.id}>
              {clip(o.entity.title, 90)} ({words(o.kind)}, v{o.entity.version})
            </option>
          ))}
        </select>
        {rubrics.length > 1 && (
          <>
            <label htmlFor="sc-rubric" className="inline">
              Rubric
            </label>
            <select
              id="sc-rubric"
              value={rubric}
              onChange={(e) => {
                setClaimed(null);
                setRubric(e.target.value as RubricKey);
              }}
            >
              {rubrics.map((r) => (
                <option key={r} value={r}>
                  {RUBRIC_NAME[r]}
                </option>
              ))}
            </select>
          </>
        )}
      </div>
      {scorecards.length >= 500 && (
        <p className="small">
          This workspace has more than 500 active scorecards and only the newest
          500 are read here, so an older card of yours may not be found for
          revision.
        </p>
      )}
      {done && (
        <p className="notice ok" role="status">
          {done}
        </p>
      )}
      {option && cardsFor.length > 0 && (
        <p className="small">
          Scorecards of this option:{' '}
          {cardsFor
            .map((c) => {
              const b = c.body as ScorecardBodyShape;
              const old = b.subject.version !== option.entity.version;
              return `${RUBRIC_NAME[b.rubric]} by ${b.reviewer.label} (${words(b.reviewer.kind)}, ${when(c.updated_at)}${old ? `, rates v${b.subject.version}: not counted` : ''})`;
            })
            .join('; ')}
          .
        </p>
      )}
      {option && draft && (
        <>
          {systemCard && systemBody && (
            <p className="notice" role="status">
              Starting from the automatic assessment of{' '}
              {when(systemCard.updated_at)} ({systemBody.reviewer.label}). Its
              ratings, evidence and notes are filled in for you to change; the
              ethics and access gates are yours to pick, because an automatic
              assessment never clears them. Saving records your own scorecard
              that replaces it in the ranking. The automatic assessment is kept
              as it was.
            </p>
          )}
          {existing && (
            <p className="notice" role="status">
              Revising your {RUBRIC_NAME[rubric].toLowerCase()} scorecard (v
              {existing.version}, {when(existing.updated_at)}). Saving keeps the
              earlier ratings in its history.
              {olderCard &&
                ` It rates option v${existingBody!.subject.version}, and the option is now v${option.entity.version}, so the ranking does not count it. Your reasons, notes and evidence are kept as a start, but every rating, gate and the confidence must be picked again for v${option.entity.version}; your earlier picks are shown beside each one.`}
            </p>
          )}
          {others.length > 0 && (
            <div className="notice" role="status">
              {existing
                ? 'There are other human scorecards on this rubric: '
                : `There is already a human scorecard on this rubric under another name, and saving a new one adds a second card the ranking also counts: `}
              {others.map((c) => (
                <span key={c.id}>
                  {(c.body as ScorecardBodyShape).reviewer.label} (
                  {when(c.updated_at)}){' '}
                  <button
                    type="button"
                    className="text"
                    onClick={() => setClaimed(c.id)}
                  >
                    This one is mine: revise it
                  </button>{' '}
                </span>
              ))}
            </div>
          )}
          {claims.length === 0 && (
            <p className="small">
              No claims are linked to this problem, so every rating can only be
              Unknown.
            </p>
          )}
          {def.criteria.map((c) => {
            const r = draft.ratings[c.key]!;
            const stray = r.evidence.filter((k) => !offered.has(k));
            return (
              <fieldset key={c.key}>
                <legend>{c.label}</legend>
                <p className="small">
                  1: {c.anchors[1]} · 3: {c.anchors[3]} · 5: {c.anchors[5]}
                </p>
                <div
                  role="radiogroup"
                  aria-label={`${c.label} rating`}
                  className="choices"
                  {...invalid(`ratings.${c.key}.rating`)}
                >
                  {RATINGS.map((v) => (
                    <label key={v}>
                      <input
                        type="radio"
                        name={`sc-${c.key}`}
                        checked={r.rating === v}
                        onChange={() =>
                          set((d) => {
                            d.ratings[c.key]!.rating = v;
                            return d;
                          })
                        }
                      />
                      {v === 'unknown' ? 'Unknown' : v}
                    </label>
                  ))}
                </div>
                {earlier && (
                  <p className="small">
                    Your v{existingBody!.subject.version} rating:{' '}
                    {earlier.ratings[c.key] ?? '—'}
                  </p>
                )}
                {err(`ratings.${c.key}.rating`)}
                {claims.length > 0 && (
                  <details open={r.evidence.length > 0 || undefined}>
                    <summary>
                      Evidence ({r.evidence.length} claim
                      {r.evidence.length === 1 ? '' : 's'})
                    </summary>
                    {claims.map((x) => {
                      const k = refKey({
                        id: x.claim.id,
                        version: x.claim.version,
                      });
                      return (
                        <label key={k} className="claim-pick">
                          <input
                            type="checkbox"
                            checked={r.evidence.includes(k)}
                            onChange={(e) =>
                              set((d) => {
                                const ev = d.ratings[c.key]!.evidence;
                                d.ratings[c.key]!.evidence = e.target.checked
                                  ? [...ev, k]
                                  : ev.filter((y) => y !== k);
                                return d;
                              })
                            }
                          />
                          {clip(x.claim.title, 140)}{' '}
                          <small>
                            ({words(x.status)}, v{x.claim.version})
                          </small>
                        </label>
                      );
                    })}
                  </details>
                )}
                {stray.length > 0 && (
                  <p className="small">
                    Also cites {stray.length} claim version
                    {stray.length === 1 ? '' : 's'} not linked to this problem
                    now. Saving needs the current version of every cited claim,
                    so an older version is refused.{' '}
                    {stray.some((k) => current.has(k.split('@')[0]!)) && (
                      <>
                        <button
                          type="button"
                          className="text"
                          onClick={() =>
                            set((d) => {
                              const ev = d.ratings[c.key]!.evidence.map(
                                (y) => current.get(y.split('@')[0]!) ?? y,
                              );
                              d.ratings[c.key]!.evidence = [...new Set(ev)];
                              return d;
                            })
                          }
                        >
                          Cite the current versions
                        </button>{' '}
                        or{' '}
                      </>
                    )}
                    <button
                      type="button"
                      className="text"
                      onClick={() =>
                        set((d) => {
                          d.ratings[c.key]!.evidence = d.ratings[
                            c.key
                          ]!.evidence.filter((y) => offered.has(y));
                          return d;
                        })
                      }
                    >
                      remove them
                    </button>
                    .
                  </p>
                )}
                {err(`ratings.${c.key}.evidence`)}
                <label htmlFor={`sc-${c.key}-why`}>
                  Reason
                  <textarea
                    id={`sc-${c.key}-why`}
                    rows={2}
                    maxLength={1200}
                    value={r.rationale}
                    {...invalid(`ratings.${c.key}.rationale`)}
                    onChange={(e) =>
                      set((d) => {
                        d.ratings[c.key]!.rationale = e.target.value;
                        return d;
                      })
                    }
                  />
                </label>
                {err(`ratings.${c.key}.rationale`)}
              </fieldset>
            );
          })}
          {rubric === 'suitability' && (
            <fieldset>
              <legend>Software influence (recorded, not scored)</legend>
              <p className="small">
                How much software could change the outcome for this option. It
                is kept apart from the suitability total, so options without
                software are not marked down.
              </p>
              <div
                role="radiogroup"
                aria-label="Software influence rating"
                className="choices"
              >
                {RATINGS.map((v) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name="sc-influence"
                      checked={draft.influence.rating === v}
                      onChange={() =>
                        set((d) => {
                          d.influence.rating = v;
                          return d;
                        })
                      }
                    />
                    {v === 'unknown' ? 'Unknown' : v}
                  </label>
                ))}
              </div>
              {earlier?.influence && (
                <p className="small">
                  Your v{existingBody!.subject.version} rating:{' '}
                  {earlier.influence}
                </p>
              )}
              {err('influence.rating')}
              <label htmlFor="sc-influence-note">
                Note
                <textarea
                  id="sc-influence-note"
                  rows={2}
                  maxLength={1200}
                  value={draft.influence.note}
                  {...invalid('influence.note')}
                  onChange={(e) =>
                    set((d) => {
                      d.influence.note = e.target.value;
                      return d;
                    })
                  }
                />
              </label>
              {err('influence.note')}
            </fieldset>
          )}
          {(['ethics', 'access'] as const).map((g) => (
            <fieldset key={g}>
              <legend>
                {g === 'ethics' ? 'Ethics gate' : 'Access gate'}{' '}
                <small>(no score can clear an unresolved gate)</small>
              </legend>
              <label htmlFor={`sc-${g}`}>
                Status
                <select
                  id={`sc-${g}`}
                  value={draft[g].status}
                  {...invalid(`${g}.status`)}
                  onChange={(e) =>
                    set((d) => {
                      d[g].status = e.target.value as GateChoice;
                      return d;
                    })
                  }
                >
                  <option value="">Choose</option>
                  {GATES.map((x) => (
                    <option key={x.value} value={x.value}>
                      {x.label}
                    </option>
                  ))}
                </select>
              </label>
              {earlier && (
                <p className="small">
                  Your v{existingBody!.subject.version} status:{' '}
                  {words(earlier[g])}
                </p>
              )}
              {err(`${g}.status`)}
              <label htmlFor={`sc-${g}-note`}>
                Note
                <textarea
                  id={`sc-${g}-note`}
                  rows={2}
                  maxLength={1200}
                  value={draft[g].note}
                  {...invalid(`${g}.note`)}
                  onChange={(e) =>
                    set((d) => {
                      d[g].note = e.target.value;
                      return d;
                    })
                  }
                />
              </label>
              {err(`${g}.note`)}
            </fieldset>
          ))}
          <fieldset>
            <legend>What argues against it</legend>
            <p className="small">
              Short answers; write &quot;unknown&quot; only if you looked and do
              not know.
            </p>
            {OPEN_CHECKS.map((k) => checkField(k))}
          </fieldset>
          <Routine
            summary={checksSummary}
            open={Object.keys(errors).some(
              (k) =>
                k.startsWith('checks.') &&
                !OPEN_CHECKS.some((o) => k === `checks.${o}`),
            )}
          >
            <fieldset>
              <legend>Other checks</legend>
              <p className="small">
                Short answers; write &quot;unknown&quot; where you do not know.
              </p>
              {foldedChecks.map((k) => checkField(k))}
              <p className="small">
                Existing tools or approaches you looked at
                {draft.alternatives_checked.length === 0 && ': none listed yet'}
                .
              </p>
              {draft.alternatives_checked.map((a, i) => (
                <div key={i} className="inline-form">
                  <label htmlFor={`sc-alt-${i}`} className="inline">
                    Name
                  </label>
                  <input
                    id={`sc-alt-${i}`}
                    maxLength={300}
                    value={a.name}
                    {...invalid(`checks.alternatives_checked.${i}.name`)}
                    onChange={(e) =>
                      set((d) => {
                        d.alternatives_checked[i]!.name = e.target.value;
                        return d;
                      })
                    }
                  />
                  <label htmlFor={`sc-alt-${i}-on`} className="inline">
                    Checked on
                  </label>
                  <input
                    id={`sc-alt-${i}-on`}
                    type="date"
                    value={a.checked_on}
                    {...invalid(`checks.alternatives_checked.${i}.checked_on`)}
                    onChange={(e) =>
                      set((d) => {
                        d.alternatives_checked[i]!.checked_on = e.target.value;
                        return d;
                      })
                    }
                  />
                  <button
                    type="button"
                    className="text"
                    onClick={() =>
                      set((d) => {
                        d.alternatives_checked.splice(i, 1);
                        return d;
                      })
                    }
                  >
                    Remove
                  </button>
                  {err(`checks.alternatives_checked.${i}.name`)}
                  {err(`checks.alternatives_checked.${i}.checked_on`)}
                </div>
              ))}
              {draft.alternatives_checked.length < 20 && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() =>
                    set((d) => {
                      d.alternatives_checked.push({
                        name: '',
                        checked_on: '',
                      });
                      return d;
                    })
                  }
                >
                  Add one you checked
                </button>
              )}
              {err('checks.alternatives_checked')}
            </fieldset>
          </Routine>
          <fieldset>
            <legend>Confidence</legend>
            <label htmlFor="sc-confidence">
              How confident are you in these ratings?
              <select
                id="sc-confidence"
                value={draft.confidence.level}
                {...invalid('confidence.level')}
                onChange={(e) =>
                  set((d) => {
                    d.confidence.level = e.target
                      .value as ScorecardDraft['confidence']['level'];
                    return d;
                  })
                }
              >
                <option value="">Choose</option>
                <option value="low">Low</option>
                <option value="medium">Medium</option>
                <option value="high">High</option>
              </select>
            </label>
            {earlier && (
              <p className="small">
                Your v{existingBody!.subject.version} confidence:{' '}
                {earlier.confidence}
              </p>
            )}
            {err('confidence.level')}
            <label htmlFor="sc-confidence-why">
              Why
              <textarea
                id="sc-confidence-why"
                rows={2}
                maxLength={1200}
                value={draft.confidence.rationale}
                {...invalid('confidence.rationale')}
                onChange={(e) =>
                  set((d) => {
                    d.confidence.rationale = e.target.value;
                    return d;
                  })
                }
              />
            </label>
            {err('confidence.rationale')}
          </fieldset>
          {(existing || systemCard) && (
            <>
              <label htmlFor="sc-reason">
                {systemCard
                  ? 'Why you are changing the automatic assessment'
                  : 'Why you are changing your scores'}
                <input
                  id="sc-reason"
                  maxLength={300}
                  value={reason}
                  {...invalid('reason')}
                  onChange={(e) => setReason(e.target.value)}
                />
              </label>
              {err('reason')}
            </>
          )}
          {Object.keys(errors).length > 0 && (
            <p className="error" role="alert">
              {Object.keys(errors).length} field
              {Object.keys(errors).length === 1 ? ' needs' : 's need'} a look
              (marked above).
            </p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <WhatWillHappen
            items={[
              {
                label: 'Scorecard',
                value: `${existing ? `Revises your ${RUBRIC_NAME[rubric].toLowerCase()} scorecard` : `Saves your ${RUBRIC_NAME[rubric].toLowerCase()} scorecard`} of “${clip(option.entity.title, 80)}” v${option.entity.version}, as ${reviewer || 'you'}`,
              },
              {
                label: 'Ranking',
                value: systemCard
                  ? 'It replaces the automatic assessment in the ranking under Decide; that assessment is kept as it was'
                  : 'It counts in the ranking under Decide; an unresolved gate still holds the option back',
              },
              { label: 'Checks', value: checksSummary },
            ]}
            note="Nothing is saved until you press the button below. Ratings, gates and confidence are only what you picked; the defaults fill nothing but unanswered checks with “unknown”."
          />
          <div className="actions">
            <button type="submit" disabled={busy}>
              {existing ? 'Save revised scorecard' : 'Save scorecard'}
            </button>
          </div>
        </>
      )}
    </form>
  );
}
