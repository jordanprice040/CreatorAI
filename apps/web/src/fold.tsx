import { useState, type ReactNode } from 'react';
import { chooseAll, foldIsOpen } from './fold-state.js';

/**
 * P18: open state for one list of collapsible items. It lives in the page component, and
 * pages stay mounted while hidden, so what the person opened stays open while the app is.
 * `attention`: the items open until the person toggles them (see firstNeeding).
 */
export type Folds = {
  isOpen: (id: string) => boolean;
  set: (id: string, open: boolean) => void;
  setAll: (ids: readonly string[], open: boolean) => void;
};

export function useFolds(attention: readonly string[]): Folds {
  const [chosen, setChosen] = useState<Record<string, boolean>>({});
  return {
    isOpen: (id) => foldIsOpen(chosen, id, attention),
    set: (id, open) =>
      setChosen((c) => (c[id] === open ? c : { ...c, [id]: open })),
    setAll: (ids, open) => setChosen((c) => chooseAll(c, ids, open)),
  };
}

/**
 * One item shown as a one-line summary that expands on click. Native <details>, so the
 * keyboard (Enter/Space on the summary) and screen readers (expanded/collapsed) work
 * without extra code. Closed content stays in the page, so form fields keep their values.
 * Never put the reason an action is blocked only inside: show it in the summary too.
 */
export function Fold({
  id,
  folds,
  summary,
  children,
  className,
}: {
  id: string;
  folds: Folds;
  summary: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const open = folds.isOpen(id);
  return (
    <details
      className={`fold${className ? ` ${className}` : ''}`}
      open={open}
      onToggle={(e) => {
        // Also fires when React sets `open`; only a real change is recorded as a choice.
        const now = e.currentTarget.open;
        if (now !== folds.isOpen(id)) folds.set(id, now);
      }}
    >
      <summary>{summary}</summary>
      <div className="fold-body">{children}</div>
    </details>
  );
}

/** Expand all / Collapse all for a list, shown when it has two or more items. */
export function FoldAll({
  ids,
  folds,
  label,
}: {
  ids: readonly string[];
  folds: Folds;
  /** What the list holds, e.g. "options", for screen readers. */
  label: string;
}) {
  if (ids.length < 2) return null;
  const allOpen = ids.every((id) => folds.isOpen(id));
  const allClosed = ids.every((id) => !folds.isOpen(id));
  return (
    <div className="fold-all" role="group" aria-label={`Show or hide ${label}`}>
      <button
        type="button"
        className="text"
        disabled={allOpen}
        onClick={() => folds.setAll(ids, true)}
      >
        Expand all
      </button>
      <button
        type="button"
        className="text"
        disabled={allClosed}
        onClick={() => folds.setAll(ids, false)}
      >
        Collapse all
      </button>
    </div>
  );
}
