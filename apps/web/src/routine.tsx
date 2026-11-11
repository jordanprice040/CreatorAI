import { useEffect, useId, useRef, type ReactNode } from 'react';
import { useViewMode } from './view-mode.js';

// ADR-0082 (P19): the two pieces every Standard form uses. A routine group folds under a
// one-line summary of its current values and where they came from; "What will happen" lists,
// before the button, what pressing it does. Advanced shows the same groups open. Neither
// changes what the form submits, and the server checks every request as before.

/**
 * A routine group: folded under its summary in Standard, open in Advanced. `open` opens it
 * (a field inside needs fixing); it never closes a fold the person opened.
 */
export function Routine({
  summary,
  open,
  reopen,
  onClose,
  children,
}: {
  summary: string;
  open?: boolean;
  /** Changing it opens the fold again while `open` holds (e.g. Expand all pressed). */
  reopen?: number;
  /** Called when the person closes the fold (only the person closes one). */
  onClose?: () => void;
  children: ReactNode;
}) {
  const { standard } = useViewMode();
  const fold = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (open && fold.current) fold.current.open = true;
  }, [open, standard, reopen]);
  if (!standard) return <>{children}</>;
  return (
    <details
      className="routine"
      ref={fold}
      onToggle={(e) => {
        // A nested <details> (a section's own fold) toggling bubbles here too; only the
        // person closing this fold counts (re-review L-A).
        if (e.target === e.currentTarget && !e.currentTarget.open) onClose?.();
      }}
    >
      <summary>{summary}</summary>
      {children}
    </details>
  );
}

export type Happening = { label: string; value: string; source?: string };

/** What pressing the form's button will do, shown before it in both modes. */
export function WhatWillHappen({
  items,
  note,
}: {
  items: readonly Happening[];
  /** One closing line; defaults to the usual "nothing happens until you press it". */
  note?: string;
}) {
  const id = useId();
  return (
    <section className="what-happens" aria-labelledby={id}>
      <h4 id={id}>What will happen</h4>
      <dl>
        {items.map((i) => (
          <div key={i.label}>
            <dt>{i.label}</dt>
            <dd>
              {i.value}
              {i.source && <span className="source"> · {i.source}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="small">
        {note ??
          'Nothing happens until you press the button below, and the server checks it again. Defaults never add evidence, permissions, qualifications or higher caps.'}
      </p>
    </section>
  );
}
