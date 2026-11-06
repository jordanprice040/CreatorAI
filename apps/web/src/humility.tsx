import { useState, type FormEvent, type ReactNode } from 'react';
import {
  HumilityVerdictSchema,
  StoredEntitySchema,
  type ClaimEvidence,
  type SessionInfo,
  type StoredEntity,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { clip } from './ui.js';
import {
  DISPOSITIONS,
  OPTION_KEYS,
  OPTION_LABELS,
  draftFromBody,
  draftToBody,
  earlierJudgments,
  emptyHumilityDraft,
  gatePreview,
  refKey,
  type Disposition,
  type EthicalStatus,
  type HumilityBodyShape,
  type HumilityDraft,
} from './humility-fields.js';

const ETHICS: { value: EthicalStatus; label: string }[] = [
  { value: 'none_identified', label: 'None identified' },
  { value: 'resolved', label: 'Found and resolved' },
  { value: 'unresolved_serious', label: 'Serious and unresolved' },
];

/**
 * "Humility review": before building, compare custom software with an existing tool, a
 * process change, human-led work, a hybrid and deferring or declining, for one exact version
 * of an option (Decide) or a spec (Build). It is stored as a `humility_review` record through
 * the existing entities route; the gate verdict is read back from the server.
 */
export function HumilityForm({
  base,
  session,
  subject,
  claims = [],
  earlier,
  prefill,
  saved,
  cancel,
  subjectKind = 'software',
}: {
  /** ADR-0077: a hybrid option (or its spec) is judged on the hybrid comparison. */
  subjectKind?: 'software' | 'hybrid';
  base: string;
  session: SessionInfo;
  subject: { id: string; version: number; label: string };
  /** Claims the comparisons may cite (the problem's, on Decide). */
  claims?: ClaimEvidence[];
  /** An earlier review to start from: of this subject's older version, or the spec's option. */
  earlier?: StoredEntity;
  prefill: { whose_perspective?: string; outcome_that_matters?: string };
  saved: () => void;
  cancel: () => void;
}) {
  const [d, setD] = useState<HumilityDraft>(() =>
    earlier
      ? draftFromBody(earlier.body as unknown as HumilityBodyShape)
      : emptyHumilityDraft(prefill),
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const before = earlier
    ? earlierJudgments(earlier.body as unknown as HumilityBodyShape)
    : null;
  const earlierSubject = earlier
    ? (earlier.body as unknown as HumilityBodyShape).subject
    : null;
  const was = (v: string) =>
    before ? <small className="earlier"> (earlier: {words(v)})</small> : null;
  const set = (f: (x: HumilityDraft) => void) =>
    setD((x) => {
      const y = structuredClone(x);
      f(y);
      return y;
    });
  const err = (k: string) =>
    errors[k] ? (
      <span id={`hf-${k}-error`} className="error">
        {errors[k]}
      </span>
    ) : null;
  const aria = (k: string) =>
    errors[k]
      ? { 'aria-invalid': true, 'aria-describedby': `hf-${k}-error` }
      : {};
  const box = (
    k: string,
    label: ReactNode,
    value: string,
    onChange: (v: string) => void,
    rows = 2,
  ) => (
    <div className="sf-field">
      <label htmlFor={`hf-${k}`}>
        {label}
        <textarea
          id={`hf-${k}`}
          rows={rows}
          value={value}
          {...aria(k)}
          onChange={(e) => onChange(e.target.value)}
        />
      </label>
      {err(k)}
    </div>
  );
  const parsed = draftToBody(d, subject);
  const preview = parsed.body ? gatePreview(parsed.body, subjectKind) : [];
  const offered = new Set(
    claims.map((c) => refKey({ id: c.claim.id, version: c.claim.version })),
  );

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError('');
    const out = draftToBody(d, subject);
    if (!out.body) {
      setErrors(out.errors);
      return;
    }
    setErrors({});
    setBusy(true);
    try {
      const review = await api(StoredEntitySchema, `${base}/entities`, {
        csrf: session.csrf_token,
        body: {
          kind: 'humility_review',
          title: clip(
            `Humility review: ${subject.label} v${subject.version}`,
            300,
          ),
          body: out.body,
        },
      });
      // The review is saved now: a retry would make a second one, so close the form even if
      // reading the gate back fails (the page reloads its verdict either way).
      await api(
        HumilityVerdictSchema,
        `${base}/entities/${review.id}/humility-gate`,
      ).catch(() => undefined);
      saved();
    } catch (x) {
      setError(message(x));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      className="spec-form humility-form"
      onSubmit={(e) => void submit(e)}
      aria-labelledby="hf-h"
    >
      <h3 id="hf-h">
        Humility review of {clip(subject.label, 80)} v{subject.version}
      </h3>
      <p className="small">
        Before building, compare custom software honestly with the other ways to
        meet the need. Only a review that recommends building, finds software
        viable and cites evidence admits a build of this exact version.
        {earlier &&
          earlierSubject &&
          ` Started from the review of ${earlierSubject.id.toLowerCase() === subject.id.toLowerCase() ? `v${earlierSubject.version}` : `the option this builds (v${earlierSubject.version})`}, saved ${when(earlier.updated_at)}: its text and claims are kept, but every viability call, the ethics status and the recommendation must be picked again for v${subject.version}.`}
      </p>
      <fieldset>
        <legend>The need</legend>
        {box(
          'outcome_that_matters',
          'The outcome that matters',
          d.outcome_that_matters,
          (v) => set((x) => (x.outcome_that_matters = v)),
        )}
        {box(
          'whose_perspective',
          'Whose view this takes',
          d.whose_perspective,
          (v) => set((x) => (x.whose_perspective = v)),
        )}
      </fieldset>
      <fieldset>
        <legend>What the evidence says (one point per line)</legend>
        {box(
          'supported',
          'Supported',
          d.supported,
          (v) => set((x) => (x.supported = v)),
          3,
        )}
        {box('inferred', 'Inferred', d.inferred, (v) =>
          set((x) => (x.inferred = v)),
        )}
        {box('disputed', 'Disputed', d.disputed, (v) =>
          set((x) => (x.disputed = v)),
        )}
        {box('unknown', 'Unknown', d.unknown, (v) =>
          set((x) => (x.unknown = v)),
        )}
      </fieldset>
      <fieldset>
        <legend>The options compared</legend>
        {OPTION_KEYS.map((k) => {
          const c = d.comparisons[k];
          const stray = c.evidence.filter((r) => !offered.has(r));
          return (
            <div key={k} className="sf-item">
              <strong>{OPTION_LABELS[k]}</strong>
              {box(
                `comparisons.${k}.assessment`,
                'Assessment',
                c.assessment,
                (v) => set((x) => (x.comparisons[k].assessment = v)),
              )}
              <div
                role="radiogroup"
                aria-label={`${OPTION_LABELS[k]}: viable?`}
                className="sf-picks"
                {...aria(`comparisons.${k}.viable`)}
              >
                <span className="small">
                  Viable?{was(before?.viable[k] ?? '')}
                </span>
                {(['yes', 'no'] as const).map((v) => (
                  <label key={v}>
                    <input
                      type="radio"
                      name={`hf-${k}-viable`}
                      checked={c.viable === v}
                      onChange={() => set((x) => (x.comparisons[k].viable = v))}
                    />
                    {v === 'yes' ? 'Yes' : 'No'}
                  </label>
                ))}
              </div>
              {err(`comparisons.${k}.viable`)}
              {claims.length > 0 && (
                <details open={c.evidence.length > 0 || undefined}>
                  <summary>
                    Evidence ({c.evidence.length} claim
                    {c.evidence.length === 1 ? '' : 's'})
                  </summary>
                  {claims.map((x) => {
                    const r = refKey({
                      id: x.claim.id,
                      version: x.claim.version,
                    });
                    return (
                      <label key={r} className="sf-check claim-pick">
                        <input
                          type="checkbox"
                          checked={c.evidence.includes(r)}
                          onChange={(e) =>
                            set((y) => {
                              const ev = y.comparisons[k].evidence;
                              y.comparisons[k].evidence = e.target.checked
                                ? [...ev, r]
                                : ev.filter((z) => z !== r);
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
                <fieldset className="small">
                  <legend>
                    From the earlier review (not in this list; untick to drop)
                  </legend>
                  {stray.map((r) => (
                    <label key={r} className="sf-check claim-pick">
                      <input
                        type="checkbox"
                        checked
                        onChange={() =>
                          set((y) => {
                            y.comparisons[k].evidence = y.comparisons[
                              k
                            ].evidence.filter((z) => z !== r);
                          })
                        }
                      />
                      Claim {r.slice(0, 8)}… v{r.slice(r.lastIndexOf('@') + 1)}
                    </label>
                  ))}
                </fieldset>
              )}
              {err(`comparisons.${k}.evidence`)}
            </div>
          );
        })}
      </fieldset>
      <fieldset>
        <legend>If software is part of it</legend>
        {box('software_part', 'What software would do', d.software_part, (v) =>
          set((x) => (x.software_part = v)),
        )}
        {box('human_part', 'What people would still do', d.human_part, (v) =>
          set((x) => (x.human_part = v)),
        )}
        {box(
          'burden_risks',
          'Burdens and risks it adds (one per line)',
          d.burden_risks,
          (v) => set((x) => (x.burden_risks = v)),
        )}
        {box(
          'disconfirming_test',
          'A test that could show it is the wrong choice',
          d.disconfirming_test,
          (v) => set((x) => (x.disconfirming_test = v)),
        )}
        {box(
          'change_course_trigger',
          'What would make you change course',
          d.change_course_trigger,
          (v) => set((x) => (x.change_course_trigger = v)),
        )}
      </fieldset>
      <fieldset>
        <legend>Ethics</legend>
        <div className="inline-form">
          <label htmlFor="hf-ethical.status" className="inline">
            Status{was(before?.ethical ?? '')}
          </label>
          <select
            id="hf-ethical.status"
            value={d.ethical.status}
            {...aria('ethical.status')}
            onChange={(e) =>
              set((x) => (x.ethical.status = e.target.value as EthicalStatus))
            }
          >
            <option value="">Choose</option>
            {ETHICS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
        {err('ethical.status')}
        {box('ethical.note', 'Note', d.ethical.note, (v) =>
          set((x) => (x.ethical.note = v)),
        )}
      </fieldset>
      <fieldset>
        <legend>Your recommendation</legend>
        <div className="inline-form">
          <label htmlFor="hf-disposition" className="inline">
            Recommend{was(before?.disposition ?? '')}
          </label>
          <select
            id="hf-disposition"
            value={d.disposition}
            {...aria('disposition')}
            onChange={(e) =>
              set((x) => (x.disposition = e.target.value as Disposition))
            }
          >
            <option value="">Choose</option>
            {DISPOSITIONS.map((o) => (
              <option key={o} value={o}>
                {words(o)}
              </option>
            ))}
          </select>
        </div>
        {err('disposition')}
        {box(
          'rationale',
          'Why (a short explanation, not your full reasoning)',
          d.rationale,
          (v) => set((x) => (x.rationale = v)),
        )}
        {box(
          'dissent',
          'Disagreements to keep on record (one per line, optional)',
          d.dissent,
          (v) => set((x) => (x.dissent = v)),
        )}
      </fieldset>
      {parsed.body && (
        <div className={`notice${preview.length ? '' : ' ok'}`} role="status">
          {preview.length ? (
            <>
              <strong>
                Saved as it is, this review does not admit a build by itself:
              </strong>
              <ul>
                {preview.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
              That can be the right answer: the review records it either way.
            </>
          ) : (
            'Saved as it is, this review admits a build of this exact version.'
          )}
        </div>
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
          Save humility review
        </button>
        <button type="button" className="secondary" onClick={cancel}>
          Cancel
        </button>
      </div>
    </form>
  );
}
