import { useState } from 'react';
import {
  GATE_OVERRIDE_NOTE,
  kindAllows,
  SelectionDispositionSchema,
  type RankedCandidate,
  type SelectionDisposition,
} from '@creator/contracts';

// ADR-0138 (Jordan, November 28): what blocks an option's choices, each with the step that clears
// it, and the owner's warned override that passes the gates instead. Passing is only a mark on
// the form until the selection is recorded; the server checks again that the owner sent it.

/** The blocked choices an override may pass (a choice the kind rules out never is). */
export function passable(
  kind: string,
  cand: RankedCandidate | undefined,
): { disposition: SelectionDisposition; reasons: string[] }[] {
  return SelectionDispositionSchema.options.flatMap((o) => {
    const why = cand?.gates.blocked[o] ?? [];
    return why.length && kindAllows(kind, o)
      ? [{ disposition: o, reasons: why }]
      : [];
  });
}

/** What to do about one gate reason, from its text (the gate rules write these sentences). */
export type GateStep = 'ethics' | 'opportunity' | 'humility' | 'other';
export function gateStep(reason: string): GateStep {
  if (/humility review/i.test(reason)) return 'humility';
  if (/opportunity/i.test(reason)) return 'opportunity';
  if (/ethic|access|gate checklist/i.test(reason)) return 'ethics';
  return 'other';
}

export const OVERRIDE_WARNING =
  'Passing gates records this choice without the checks the studio uses to keep a decision honest (complete scores, ethics and access, a humility review). It is saved as an owner override with your reason and every gate it passed, shown on the selection, in Activity and in the project report, so an override can be told apart from a cleared gate. A build still needs a passing humility review of the option (or its spec) before it starts; an autopilot never passes gates for you.';

export function GateClear({
  title,
  kind,
  cand,
  owner,
  passed,
  reason,
  onReason,
  onPass,
  onUndo,
  onHumility,
  onScore,
  onAutomate,
  choices,
}: {
  title: string;
  kind: string;
  cand: RankedCandidate | undefined;
  /** The workspace owner may pass gates; others see only the steps. */
  owner: boolean;
  passed: boolean;
  reason: string;
  onReason: (v: string) => void;
  onPass: () => void;
  onUndo: () => void;
  onHumility: (() => void) | null;
  onScore: (() => void) | null;
  onAutomate: () => void;
  /** How a disposition reads in the form. */
  choices: (d: SelectionDisposition) => string;
}) {
  const [warning, setWarning] = useState(false);
  const [sure, setSure] = useState(false);
  const blocked = passable(kind, cand);
  if (!blocked.length) return null;
  const steps = new Set(blocked.flatMap((b) => b.reasons.map(gateStep)));
  if (passed)
    return (
      <div className="carry-flag gate-passed" role="status">
        <strong>You are passing the gates for “{title}”.</strong>{' '}
        {GATE_OVERRIDE_NOTE} The blocked choices (
        {blocked.map((b) => choices(b.disposition)).join(', ')}) can now be
        chosen; recording saves your reason with every gate passed.{' '}
        <button type="button" className="text" onClick={onUndo}>
          Don’t pass them
        </button>
      </div>
    );
  return (
    <details className="gate-clear">
      <summary>
        Clear what blocks this option ({blocked.length} choice
        {blocked.length === 1 ? '' : 's'})
      </summary>
      <ul className="small">
        {blocked.map((b) => (
          <li key={b.disposition}>
            <strong>{choices(b.disposition)}:</strong> {b.reasons.join(' ')}
          </li>
        ))}
      </ul>
      <p className="small">Clear them here:</p>
      <ul className="small">
        {steps.has('ethics') && (
          <li>
            Ethics and access: confirm them on the option above, or for several
            options at once under “Which options can advance”.
          </li>
        )}
        {steps.has('opportunity') && (
          <li>
            Unknown opportunity ratings: fill them yourself{' '}
            {onScore && (
              <button type="button" className="text" onClick={onScore}>
                Fill the ratings
              </button>
            )}
            , or let the automatic assessment run again (Assess automatically
            above).
          </li>
        )}
        {steps.has('humility') && onHumility && (
          <li>
            Humility review:{' '}
            <button type="button" className="text" onClick={onHumility}>
              Write it now
            </button>
            . A build of this option’s spec uses the same review; you will not
            be asked again.
          </li>
        )}
        {steps.has('other') && (
          <li>
            Discovery’s verdict on this option (for example a duplicate) is not
            a step you can redo here; a new discovery run may change it, or you
            can pass the gate below (the verdict stays as it is).
          </li>
        )}
        <li>
          Or let an autopilot do it: with “Decide for me” on (Autopilot
          settings), it assesses, gathers evidence and records the choice
          itself, taking blocked software to validation first.{' '}
          <button type="button" className="text" onClick={onAutomate}>
            Automate this problem
          </button>
        </li>
      </ul>
      {owner && !warning && (
        <button
          type="button"
          className="secondary"
          onClick={() => setWarning(true)}
        >
          Pass these gates myself…
        </button>
      )}
      {owner && warning && (
        <div className="notice policy" role="alert">
          <p className="small">
            <strong>Pass the gates for “{title}”?</strong> {OVERRIDE_WARNING}
          </p>
          <label htmlFor={`gate-reason-${cand?.alternative.id ?? ''}`}>
            Why you pass them (one reason for every option you pass in this
            selection, saved with it)
          </label>
          <input
            id={`gate-reason-${cand?.alternative.id ?? ''}`}
            maxLength={1200}
            value={reason}
            onChange={(e) => onReason(e.target.value)}
          />
          <label className="inline">
            <input
              type="checkbox"
              checked={sure}
              onChange={(e) => setSure(e.target.checked)}
            />{' '}
            I understand this is recorded as my override.
          </label>
          <div>
            <button
              type="button"
              disabled={!sure || !reason.trim()}
              onClick={() => {
                setWarning(false);
                setSure(false);
                onPass();
              }}
            >
              Pass the gates
            </button>{' '}
            <button
              type="button"
              className="text"
              onClick={() => {
                setWarning(false);
                setSure(false);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </details>
  );
}
