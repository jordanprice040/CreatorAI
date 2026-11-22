import type { ReactNode } from 'react';
import { useViewMode } from './view-mode.js';

/**
 * Jordan's Standard-mode simplification (November 22): an explanation that Advanced shows in
 * full and Standard folds behind a one-line summary. `short` is the line Standard shows (no
 * line: "About this"); the full text opens in place. Native <details>, so the keyboard and
 * screen readers work, and the closed text stays in the page for find-in-page in Advanced.
 * Use it for page and section introductions only: never put a blocker, an error, an amount the
 * person confirms or the only copy of what a button does inside it.
 */
export function Explain({
  short,
  children,
  block,
  className = 'small',
}: {
  short?: ReactNode;
  children: ReactNode;
  /** The children hold block elements (lists, several paragraphs): wrap them in a div. */
  block?: boolean;
  className?: string;
}) {
  const { standard } = useViewMode();
  const body = block ? (
    <div className={className}>{children}</div>
  ) : (
    <p className={className}>{children}</p>
  );
  if (!standard) return body;
  return (
    <details className="explain-fold">
      <summary>
        {short ? <span className="explain-short">{short}</span> : null}
        <span className="explain-more">
          <span className="when-closed">{short ? 'More' : 'About this'}</span>
          <span className="when-open">Less</span>
        </span>
      </summary>
      {body}
    </details>
  );
}

/**
 * A titled list of points (what a run does, the routine approvals it gets). Advanced shows it
 * open as before; Standard folds the points under the title with their count, opened in place.
 * The text is the same in both, so a checkbox that confirms "I have read" still covers it.
 */
export function PointList({
  title,
  points,
}: {
  title: ReactNode;
  points: readonly string[];
}) {
  const { standard } = useViewMode();
  const list = (
    <ul>
      {points.map((l) => (
        <li key={l}>{l}</li>
      ))}
    </ul>
  );
  if (!standard)
    return (
      <>
        <p>
          <strong>{title}</strong>
        </p>
        {list}
      </>
    );
  return (
    <details className="point-list">
      <summary>
        <strong>{title}</strong>{' '}
        <span className="point-count">
          {points.length} point{points.length === 1 ? '' : 's'}, open to read
        </span>
      </summary>
      {list}
    </details>
  );
}

/**
 * A whole section that Standard shows closed under its title, and Advanced shows open as before.
 * The section's own heading stays in the page (only visually collapsed while folded), so jump
 * links and `reveal` still find it; `reveal` opens the fold first.
 */
export function SectionFold({
  title,
  hint,
  anchor,
  children,
}: {
  title: ReactNode;
  /** One line under the title while it is closed. */
  hint?: ReactNode;
  /** The address's item id that opens this fold on arrival, e.g. `team-profile`. */
  anchor?: string;
  children: ReactNode;
}) {
  const { standard } = useViewMode();
  if (!standard) return <>{children}</>;
  return (
    <details
      className="section-fold"
      open={anchor ? addressId() === anchor : undefined}
    >
      <summary>
        <span className="section-fold-title">{title}</span>
        {hint ? <span className="section-fold-hint">{hint}</span> : null}
      </summary>
      {children}
    </details>
  );
}

function addressId(): string {
  try {
    return (
      new URLSearchParams(location.hash.split('?')[1] ?? '').get('id') ?? ''
    );
  } catch {
    return '';
  }
}
