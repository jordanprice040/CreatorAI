import { FixButtons, type FixContext } from './fix-buttons.js';
import type { FixAction } from './fix-here.js';
import type { View } from './pages.js';

/** One reason an action cannot run yet, with the tab that can fix it when there is one. */
export type BlockedReason = {
  text: string;
  fix?: { view: View; label: string };
  /** ADR-0087: the owner's fixes for this reason, offered in place (needs `fixes`). */
  acts?: FixAction[];
};

/**
 * P04: the one way the studio says why an action cannot run yet: a heading naming the action,
 * each specific reason on its own line, and a button to the tab that fixes it. Used by
 * Discover and Build; chat states its own refusals in its replies. It only explains: every
 * gate stays on the server.
 */
export function Blocked({
  action,
  reasons,
  open,
  id,
  fixes,
}: {
  /** What cannot happen yet, e.g. "start this discovery". */
  action: string;
  reasons: readonly BlockedReason[];
  open?: (view: View) => void;
  id?: string;
  /** ADR-0087: where in-place fixes are pressed; without it only the tab links show. */
  fixes?: FixContext | null;
}) {
  if (reasons.length === 0) return null;
  // The same fix offered for several reasons is shown once, after the last of them.
  const lastFix = new Map<string, number>();
  reasons.forEach((r, i) => r.fix && lastFix.set(r.fix.view, i));
  return (
    <div className="notice blocked" role="note" id={id}>
      <p>
        <strong>Can't {action} yet</strong>
      </p>
      <ul>
        {reasons.map((r, i) => (
          <li key={`${i}-${r.text}`}>
            {r.text}
            <FixButtons acts={r.acts} fix={fixes} />
            {r.fix && open && lastFix.get(r.fix.view) === i && (
              <>
                {' '}
                <button
                  type="button"
                  className="text"
                  onClick={() => open(r.fix!.view)}
                >
                  {r.fix.label}
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
