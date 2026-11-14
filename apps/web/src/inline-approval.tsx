import { useRef, useState } from 'react';
import { DecisionSchema } from '@creator/contracts';
import { Coverage, api, message } from './oversight.js';
import { inlineApprovable } from './inline-approval-rules.js';
import { StaleNote, useLoad } from './ui.js';

// UX pass P-3: when the owner's own action stops for the owner's approval (recording a
// selection, freezing a spec, starting a build), the approval is shown where they acted. It is
// the same decision record, answered through the same route as on Monitor › Approvals: the
// coverage shown is what approve-once permits, a typed reason is required, and the server
// checks that the target has not changed. Anyone else's request still goes to Approvals.

export function InlineApproval({
  workspace,
  decisionId,
  csrf,
  owner,
  verb,
  initialReason = '',
  onApproved,
  openApprovals,
}: {
  workspace: string;
  decisionId: string;
  csrf: string;
  owner: boolean;
  /** What happens after approving, e.g. "record the selection". */
  verb: string;
  /** Filled into the reason box (the person's own words from the form); editable. */
  initialReason?: string;
  /** Runs the action again once approved; absent, the person presses it again themselves. */
  onApproved?: () => void | Promise<void>;
  openApprovals: () => void;
}) {
  const opened = useRef(Date.now());
  const decision = useLoad(
    () =>
      api(DecisionSchema, `workspaces/${workspace}/decisions/${decisionId}`),
    [workspace, decisionId],
  );
  const [reason, setReason] = useState(initialReason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [approved, setApproved] = useState(false);
  const d = decision.data;
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
        {fallback}
      </p>
    );
  const can = inlineApprovable(d, owner);
  if (
    approved ||
    (d.status === 'answered' && d.response?.choice === 'approve_once')
  )
    return (
      <p className="small">
        Approved once.{' '}
        {onApproved ? (
          <button
            className="secondary strong"
            type="button"
            disabled={busy}
            onClick={() => void onApproved()}
          >
            {verb[0]!.toUpperCase() + verb.slice(1)} now
          </button>
        ) : (
          `Now ${verb}.`
        )}
      </p>
    );
  if (!can.ok)
    return (
      <p className="small">
        {can.why} {fallback}
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
            interruption: null,
          },
        },
      );
      setApproved(true);
      if (onApproved) await onApproved();
    } catch (e) {
      setError(message(e));
      decision.reload();
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="inline-approval" aria-label="Approve here">
      <p className="small">
        <strong>You approve this yourself.</strong> Approve it here, once: it is
        the same decision record as in Monitor › Approvals.
      </p>
      <StaleNote stale={decision.stale} />
      <p className="small">{d.question}</p>
      <Coverage d={d} />
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
      <div className="actions">
        <button
          className="primary"
          type="button"
          disabled={busy || !reason.trim()}
          onClick={() => void approve()}
        >
          {busy ? 'Approving…' : `Approve once and ${verb}`}
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
