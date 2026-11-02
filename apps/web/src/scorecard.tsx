import { useEffect, useState, type FormEvent } from 'react';
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
  CHECK_LABELS,
  draftFromBody,
  draftToBody,
  emptyDraft,
  refKey,
  rubricsFor,
  type GateChoice,
  type RatingChoice,
  type RubricKey,
  type ScorecardBodyShape,
  type ScorecardDraft,
} from './scorecard-fields.js';

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
}: {
  base: string;
  session: SessionInfo;
  options: Option[];
  claims: ClaimEvidence[];
  scorecards: StoredEntity[];
  prefill: { target_users?: string; measurable_outcome?: string };
  saved: () => void;
}) {
  const [optionId, setOptionId] = useState('');
  const [rubric, setRubric] = useState<RubricKey>('suitability');
  const [draft, setDraft] = useState<ScorecardDraft | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState('');

  const reviewer = session.display_name.trim().slice(0, 300) || 'Owner';
  const option = options.find((o) => o.entity.id === optionId);
  const rubrics = option ? rubricsFor(option.kind) : [];
  const def = RUBRICS[rubric];
  const criteria = def.criteria.map((c) => c.key);
  const existing = option
    ? yours(scorecards, option.entity.id, rubric, reviewer)
    : undefined;
  const offered = new Set(
    claims.map((c) => refKey({ id: c.claim.id, version: c.claim.version })),
  );

  // A new option or rubric starts a new draft: your earlier card's values, or empty.
  useEffect(() => {
    setErrors({});
    setReason('');
    if (!option) return setDraft(null);
    if (!rubricsFor(option.kind).includes(rubric)) {
      setRubric('suitability');
      return;
    }
    setDraft(
      existing
        ? draftFromBody(existing.body as ScorecardBodyShape, criteria)
        : emptyDraft(criteria, prefill),
    );
  }, [optionId, rubric, existing?.id, existing?.version]);

  const set = (f: (d: ScorecardDraft) => ScorecardDraft) =>
    setDraft((d) => (d ? f(structuredClone(d)) : d));
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
                body: out.body,
                reason: reason.trim().slice(0, 300),
              }
            : { title, body: out.body },
        },
      );
      setDone(
        existing
          ? 'Scorecard revised. The ranking above now uses your new ratings.'
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
              onChange={(e) => setRubric(e.target.value as RubricKey)}
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
          {existing && (
            <p className="notice" role="status">
              Revising your {RUBRIC_NAME[rubric].toLowerCase()} scorecard (v
              {existing.version}, {when(existing.updated_at)}). Saving keeps the
              earlier ratings in its history
              {(existing.body as ScorecardBodyShape).subject.version !==
              option.entity.version
                ? ` and moves it from option v${(existing.body as ScorecardBodyShape).subject.version} to v${option.entity.version}, so check every rating against the current option`
                : ''}
              .
            </p>
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
                    now (kept unless you untick:{' '}
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
                    ).
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
            <legend>Checks</legend>
            <p className="small">
              Short answers; write &quot;unknown&quot; where you do not know.
            </p>
            {(
              Object.keys(CHECK_LABELS) as (keyof ScorecardDraft['checks'])[]
            ).map((k) => (
              <div key={k}>
                <label htmlFor={`sc-check-${k}`}>
                  {CHECK_LABELS[k]}
                  <input
                    id={`sc-check-${k}`}
                    maxLength={300}
                    value={draft.checks[k]}
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
            ))}
            <p className="small">
              Existing tools or approaches you looked at
              {draft.alternatives_checked.length === 0 && ': none listed yet'}.
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
                      checked_on: new Date().toISOString().slice(0, 10),
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
          {existing && (
            <>
              <label htmlFor="sc-reason">
                Why you are changing your scores
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
