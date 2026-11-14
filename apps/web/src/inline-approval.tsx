import { useEffect, useRef, useState } from 'react';
import { DecisionSchema } from '@creator/contracts';
import { Coverage, api, message, when } from './oversight.js';
import {
  decisionApproved,
  decisionOutcome,
  inlineApprovable,
} from './inline-approval-rules.js';
import { StaleNote, useLoad } from './ui.js';

// UX pass P-3: when the owner's own action stops for the owner's approval (recording a
// selection, freezing a spec, starting a build), the approval is shown where they acted. It is
// the same decision record, answered through the same route as on Monitor › Approvals: the
// coverage shown is what approve-once permits, a typed reason is required, the study's
// "worth asking?" answer is offered, and the server checks that the target has not changed.
// Anyone else's request still goes to Approvals; the action can always be sent again here.

export function InlineApproval({
  workspace,
  decisionId,
  csrf,
  owner,
  actorId,
  approveLabel,
  initialReason = '',
  onApproved,
  againLabel,
  retryLabel,
  afterText,
  openApprovals,
  fixture = false,
}: {
  workspace: string;
  /** Fixture workspaces count simulated units, not dollars (the maximum's unit). */
  fixture?: boolean;
  decisionId: string;
  csrf: string;
  owner: boolean;
  /** The signed-in person: only their own request is approved here (review M-1). */
  actorId: string;
  /** The approve button, e.g. "Approve once and record the selection". */
  approveLabel: string;
  /** Filled into the reason box (the person's own words from the form); editable. */
  initialReason?: string;
  /** Sends the action again: run once approved here, and offered whenever it may help. */
  onApproved?: () => void | Promise<void>;
  /** The resend button once approved, e.g. "I approved it: submit again". */
  againLabel?: string;
  /** The resend button when nothing was approved (re-review N-1), e.g. "Submit again". */
  retryLabel?: string;
  /** Without `onApproved`: what to do once approved. */
  afterText?: string;
  openApprovals: () => void;
}) {
  const opened = useRef(Date.now());
  const decision = useLoad(
    () =>
      api(DecisionSchema, `workspaces/${workspace}/decisions/${decisionId}`),
    [workspace, decisionId],
  );
  // Review L-2: approving in Approvals (another page or window) shows here on return.
  // Re-review L-1: quiet refreshes, so a failed read keeps the form and shows the stale note.
  // useLoad already refreshes when the page is shown again.
  const reload = useRef(decision.refresh);
  reload.current = decision.refresh;
  useEffect(() => {
    const on = () => reload.current();
    window.addEventListener('focus', on);
    return () => window.removeEventListener('focus', on);
  }, []);
  const [reason, setReason] = useState(initialReason);
  const [interruption, setInterruption] = useState<
    '' | 'useful' | 'unnecessary'
  >('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);
  const d = decision.data;
  async function again() {
    if (!onApproved) return;
    setBusy(true);
    try {
      await onApproved();
    } finally {
      setBusy(false);
    }
  }
  const resendButton = (label: string | undefined) =>
    onApproved &&
    label && (
      <button
        className="secondary strong"
        type="button"
        disabled={busy}
        onClick={() => void again()}
      >
        {label}
      </button>
    );
  const resend = resendButton(againLabel);
  const retry = resendButton(retryLabel ?? againLabel);
  const fallback = (
    <button className="secondary" type="button" onClick={openApprovals}>
      Open it in Monitor › Approvals
    </button>
  );
  if (decision.loading && !d)
    return <p className="small">Loading the approval…</p>;
  if (!d)
    return (
      <p className="small">
        {decision.error ? `${decision.error} ` : ''}
        {fallback} {retry}
      </p>
    );
  if (approved || decisionApproved(d))
    return (
      <p className="small">
        {approved
          ? 'Approved once.'
          : `This request was ${decisionOutcome(d)}.`}{' '}
        {resend ?? afterText}
      </p>
    );
  const can = inlineApprovable(d, { owner, actorId });
  if (!can.ok)
    return (
      <p className="small">
        <StaleNote stale={decision.stale} />
        {can.why} {fallback} {retry}
      </p>
    );
  async function approve() {
    setBusy(true);
    setError('');
    try {
      await api(
        DecisionSchema,
        `workspaces/${workspace}/decisions/${decisionId}/answer`,
        {
          csrf,
          body: {
            choice: 'approve_once',
            option_id: null,
            rationale: reason.trim(),
            coverage_hash: d!.coverage.coverage_hash,
            standing_expires_at: null,
            time_spent_ms: Math.min(86_400_000, Date.now() - opened.current),
            interruption: interruption || null,
          },
        },
      );
      setApproved(true);
      if (onApproved) await onApproved();
    } catch (e) {
      setError(message(e));
      decision.refresh();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="inline-approval" aria-label="Approve here">
      <StaleNote stale={decision.stale} />
      <p className="small">
        <strong>You asked for this, and you approve it.</strong> Approve it
        here, once: it is the same decision record as in Monitor › Approvals.
        Asked {when(d.created_at)}.
      </p>
      <p className="small">{d.question}</p>
      <dl>
        <div>
          <dt>Uncertainty</dt>
          <dd>{d.uncertainty}</dd>
        </div>
        <div>
          <dt>If wrong</dt>
          <dd>{d.consequence_if_wrong}</dd>
        </div>
      </dl>
      <Coverage d={d} fixture={fixture} />
      <label htmlFor={`inline-why-${d.id}`}>
        Your reason for approving (required, brief)
      </label>
      <textarea
        id={`inline-why-${d.id}`}
        rows={2}
        maxLength={1200}
        value={reason}
        onChange={(e) => setReason(e.target.value)}
      />
      <label htmlFor={`inline-int-${d.id}`}>
        Was this question worth asking?
      </label>
      <select
        id={`inline-int-${d.id}`}
        value={interruption}
        onChange={(e) => setInterruption(e.target.value as typeof interruption)}
      >
        <option value="">No answer</option>
        <option value="useful">Yes, useful</option>
        <option value="unnecessary">No, an unnecessary interruption</option>
      </select>
      <div className="actions">
        <button
          className="primary"
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => void approve()}
        >
          {busy ? 'Approving…' : approveLabel}
        </button>
        {fallback}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
