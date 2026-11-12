import { useState } from 'react';
import {
  GateConfirmationSchema,
  capabilityLabel,
  type RankedCandidate,
  type SessionInfo,
} from '@creator/contracts';
import { ApiError, api, message, when } from './oversight.js';

type Detail = NonNullable<RankedCandidate['gates']['gate_details']>[number];

const GATE = { ethics: 'Ethics', access: 'Access' } as const;
const STATE: Record<Detail['state'], string> = {
  clear: 'clear',
  confirmed: 'confirmed by you',
  auto_cleared: 'cleared by your gate rule',
  unresolved: 'concern raised',
  not_assessed: 'needs your confirmation',
};

const ANSWER = {
  fail: 'failed',
  unknown: 'unknown',
  missing: 'not answered',
} as const;

/** What a person can do about one gate, in plain words (ADR-0090). */
export function gateGuidance(d: Detail): string | null {
  if (d.state === 'unresolved' && d.concerns.some((x) => x.by === 'person'))
    return 'A person raised this on their own scorecard; they resolve it by revising that scorecard.';
  if (d.state === 'unresolved')
    return d.gate === 'access'
      ? 'To resolve: say what the team can do in Settings › Team profile (tick it or run a built-in check), then assess again. If it is fine as it is, confirm it here.'
      : 'To resolve: check the concern against your evidence and add what answers it, then assess again. If it is fine as it is, confirm it here.';
  if (d.state === 'not_assessed' && d.assessed === false)
    return 'Nothing has assessed this yet. Assess the option or score it yourself first.';
  if (
    d.state === 'not_assessed' &&
    d.gate === 'access' &&
    d.rule === 'team_profile'
  )
    return 'Your gate rule clears access once the automatic assessment reads a team profile that answers at least one question. Answer one in Settings › Team profile and assess again, or confirm it here.';
  if (d.state === 'not_assessed' && d.rule === 'checklist') {
    const r = d.checklist;
    if (!r)
      return 'Your gate rule clears this once the automatic assessment answers your gate checklist and every item for this gate passes. Add an item for this gate in Settings › Team profile and assess again, or confirm it here.';
    if (r.failing.length)
      return 'Your gate checklist did not pass (the items are listed above). Add what answers them to your evidence or team profile and assess again, or confirm it here.';
    if (d.gate === 'access' && !r.needs.length)
      return 'The assessment named nothing this option needs, so the app had nothing to confirm in your team profile. Confirm it here if access is fine.';
    if (r.needs_missing.length)
      return 'Every item passed, but the app couldn’t confirm every needed capability in your team profile (listed above). Run its built-in check on this computer, or tick it in Settings › Team profile when no check can test it, then look again.';
  }
  if (d.state === 'not_assessed' && d.rule && d.rule !== 'owner')
    return 'Only the automatic assessment looked at this, and your gate rule doesn’t clear it. Confirm it here or score the option yourself.';
  if (d.state === 'not_assessed')
    return d.gate === 'access'
      ? 'Only the automatic assessment looked at this, and on its own it can’t clear a gate. Confirm it here, score the option yourself, or choose who clears gates in Settings › Team profile.'
      : 'Only the automatic assessment looked at this, and it can’t clear an ethics gate. Confirm it here, score the option yourself, or let the model’s word clear it in Settings › Team profile.';
  return null;
}

/**
 * Each gate of one option: its state, every concern with who raised it, what to do about it,
 * and the owner's one-click confirmation with a one-line reason.
 */
export function GateLines({
  cand,
  alternative,
  base,
  problemId,
  session,
  canConfirm,
  onOpenSettings,
  onDone,
}: {
  cand: RankedCandidate | undefined;
  alternative: { id: string; version: number };
  base: string;
  problemId: string;
  session: SessionInfo;
  canConfirm: boolean;
  onOpenSettings: () => void;
  onDone: () => void;
}) {
  const details = cand?.gates.gate_details;
  const [open, setOpen] = useState<Detail['gate'] | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Nothing to say when people's scorecards already cleared both gates.
  if (!details?.length || details.every((d) => d.state === 'clear'))
    return null;
  async function confirm(d: Detail) {
    setBusy(true);
    setError('');
    try {
      await api(
        GateConfirmationSchema,
        `${base}/problems/${problemId}/gate-confirmations`,
        {
          csrf: session.csrf_token,
          body: {
            alternative,
            gate: d.gate,
            reason: reason.trim(),
            concerns_seen: d.concerns.map((x) => x.scorecard),
          },
        },
      );
      setOpen(null);
      setReason('');
      onDone();
    } catch (err) {
      if (err instanceof ApiError && err.code === 'VERSION_CONFLICT') onDone();
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="gate-lines">
      {details.map((d) => {
        const guidance = gateGuidance(d);
        const confirmable =
          canConfirm &&
          d.assessed !== false &&
          (d.state === 'not_assessed' ||
            d.state === 'auto_cleared' ||
            (d.state === 'unresolved' &&
              !d.concerns.some((x) => x.by === 'person')));
        return (
          <section key={d.gate} className="gate-line">
            <p className="small">
              <strong>{GATE[d.gate]}:</strong>{' '}
              <span
                className={`gate-${d.state === 'confirmed' || d.state === 'auto_cleared' ? 'clear' : d.state}`}
              >
                {d.state === 'auto_cleared'
                  ? d.confirmation?.rule_mode === 'model'
                    ? 'cleared on the model’s word (no person looked)'
                    : d.confirmation?.rule_mode === 'team_profile'
                      ? 'cleared by the model, from your team profile (no person looked)'
                      : d.confirmation?.rule_mode === 'checklist'
                        ? 'cleared by your gate checklist (no person looked)'
                        : STATE[d.state]
                  : STATE[d.state]}
              </span>
              {d.confirmation && (
                <>
                  {' '}
                  · {d.confirmation.reason}
                  {d.confirmation.by === 'owner' &&
                    ` (${when(d.confirmation.created_at)})`}
                </>
              )}
            </p>
            {d.concerns.length > 0 && (
              <ul className="small">
                {d.concerns.map((x) => (
                  <li key={x.scorecard}>
                    {x.by === 'system' ? 'Automatic assessment' : x.reviewer}:{' '}
                    {x.note}
                  </li>
                ))}
              </ul>
            )}
            {d.checklist &&
              (d.checklist.failing.length > 0 ||
                d.checklist.needs_missing.length > 0) && (
                <ul className="small checklist-misses">
                  {d.checklist.failing.map((f) => (
                    <li key={f.item}>
                      Checklist {f.item} {ANSWER[f.answer]}: {f.text} — {f.note}
                    </li>
                  ))}
                  {d.checklist.needs_missing.length > 0 && (
                    <li>
                      Needed, not confirmed in your team profile:{' '}
                      {d.checklist.needs_missing
                        .map(capabilityLabel)
                        .join(', ')}
                    </li>
                  )}
                </ul>
              )}
            {d.stale_confirmation && (
              <p className="small">
                Your earlier confirmation no longer counts:{' '}
                {d.stale_confirmation}
              </p>
            )}
            {guidance && d.state !== 'confirmed' && (
              <p className="small">
                {guidance}{' '}
                {d.gate === 'access' && d.state === 'unresolved' && (
                  <button className="text" onClick={onOpenSettings}>
                    Open the team profile
                  </button>
                )}
              </p>
            )}
            {confirmable &&
              (open === d.gate ? (
                <div className="actions">
                  <label htmlFor={`gate-reason-${alternative.id}-${d.gate}`}>
                    Why is {d.gate} fine for this option?
                  </label>
                  <input
                    id={`gate-reason-${alternative.id}-${d.gate}`}
                    maxLength={300}
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                  <button
                    disabled={busy || reason.trim().length < 3}
                    onClick={() => void confirm(d)}
                  >
                    {busy ? 'Saving…' : 'Clear: I confirm'}
                  </button>
                  <button
                    className="secondary"
                    disabled={busy}
                    onClick={() => setOpen(null)}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="secondary"
                  onClick={() => {
                    setOpen(d.gate);
                    setReason('');
                    setError('');
                  }}
                >
                  Clear {d.gate}: I confirm
                </button>
              ))}
          </section>
        );
      })}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
