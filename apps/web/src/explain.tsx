import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
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
 * The lines of a confirmed summary that Standard never folds: its limits (money, steps, end
 * time), its data classes and what it never does. Review 1 of #255, M-1.
 */
export const KEPT_POINT =
  /^(Limits|Data|Never covered|Still stops and asks you):|^It never /;

/** Whether every list has been opened (Standard), so "I have read both summaries" is true. */
export function allOpened(
  opened: ReadonlySet<string>,
  lists: readonly (readonly string[])[],
): boolean {
  // A list with nothing folded is all in view, so it counts as read (re-review L-A).
  return lists.every(
    (l) => l.every((p) => KEPT_POINT.test(p)) || opened.has(l.join('\n')),
  );
}

/**
 * The summaries a person opened on this form. In Standard a confirm box that says "I have read"
 * stays disabled until each folded summary was opened once; Advanced shows them open, so every
 * list counts as read. A changed summary is a new list and needs opening again.
 */
export function useReadLists() {
  const { standard } = useViewMode();
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set());
  return {
    mark: (points: readonly string[]) =>
      setOpened((s) =>
        s.has(points.join('\n')) ? s : new Set(s).add(points.join('\n')),
      ),
    read: (...lists: (readonly string[])[]) =>
      !standard || allOpened(opened, lists),
  };
}

/**
 * A titled list of points (what a run does, the routine approvals it gets). Advanced shows it
 * open as before. Standard keeps the limits and "never" lines (KEPT_POINT) in view and folds
 * the rest under the title with their count; `onOpen` tells a confirm box it was read.
 */
export function PointList({
  title,
  points,
  onOpen,
}: {
  title: ReactNode;
  points: readonly string[];
  onOpen?: (points: readonly string[]) => void;
}) {
  const { standard } = useViewMode();
  const list = (items: readonly string[]) => (
    <ul>
      {items.map((l) => (
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
        {list(points)}
      </>
    );
  const kept = points.filter((l) => KEPT_POINT.test(l));
  const rest = points.filter((l) => !KEPT_POINT.test(l));
  return (
    <div className="point-list">
      <p>
        <strong>{title}</strong>
      </p>
      {kept.length > 0 && list(kept)}
      {rest.length > 0 && (
        // Keyed by the text: a changed summary (a new end time, other limits) shows closed
        // again, so it is opened and read again (re-review L-A).
        <details
          key={points.join('\n')}
          onToggle={(e) => {
            if (e.currentTarget.open) onOpen?.(points);
          }}
        >
          <summary>
            {rest.length} more point{rest.length === 1 ? '' : 's'}, open to read
          </summary>
          {list(rest)}
        </details>
      )}
    </div>
  );
}

/** Lets a panel inside a SectionFold say its current state on the closed fold (M-2). */
const SectionState = createContext<((line: string) => void) | null>(null);

/**
 * Called by a panel inside a SectionFold with its current state in a few words ("All off",
 * "Gates: you clear them"). Standard shows it on the closed fold; Advanced ignores it.
 */
export function useSectionState(line: string | null) {
  const set = useContext(SectionState);
  useEffect(() => {
    if (set && line !== null) set(line);
  }, [set, line]);
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
  /** One line under the title while it has no state to show. */
  hint?: ReactNode;
  /** The address's item id that opens this fold on arrival, e.g. `team-profile`. */
  anchor?: string;
  children: ReactNode;
}) {
  const { standard } = useViewMode();
  const [state, setState] = useState('');
  const ref = useRef<HTMLDetailsElement>(null);
  // Review 1 of #255, N-3: an address naming this section (Decide's "Team profile" link)
  // opens it and scrolls to it, on arrival and when the address changes later while the
  // page stays open (re-review N-B).
  useEffect(() => {
    if (!anchor) return;
    const go = () => {
      if (addressId() !== anchor) return;
      if (ref.current) ref.current.open = true;
      const el =
        ref.current?.querySelector('summary') ??
        document.getElementById(anchor);
      el?.scrollIntoView({ block: 'start' });
    };
    go();
    window.addEventListener('hashchange', go);
    return () => window.removeEventListener('hashchange', go);
  }, [anchor]);
  if (!standard) return <>{children}</>;
  return (
    <details ref={ref} className="section-fold">
      <summary>
        <span className="section-fold-title">{title}</span>
        {state ? (
          <span className="section-fold-state">{state}</span>
        ) : hint ? (
          <span className="section-fold-hint">{hint}</span>
        ) : null}
      </summary>
      <SectionState.Provider value={setState}>{children}</SectionState.Provider>
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

/**
 * Autopilot friction pass (November 28): "Open both summaries above" did not say which
 * summaries or where they open, and the confirm box stayed greyed out with no other hint. This
 * names them and opens every folded summary of its form in one press (each opened list counts
 * as read through its own toggle, as when opened by hand).
 */
export function OpenSummariesHint({ names }: { names: readonly string[] }) {
  return (
    <p className="small muted">
      To tick the box, read the{' '}
      {names.length === 2 ? 'two summaries' : 'summaries'} above (
      {names.map((n) => `“${n}”`).join(' and ')}): open each one’s “more points,
      open to read” line.{' '}
      <button
        type="button"
        className="secondary"
        onClick={(e) => {
          const form = e.currentTarget.closest('form') ?? document;
          const folds = [
            ...form.querySelectorAll<HTMLDetailsElement>(
              '.point-list details:not([open])',
            ),
          ];
          for (const d of folds) d.open = true;
          folds[0]?.closest('.point-list')?.scrollIntoView({ block: 'start' });
        }}
      >
        Open them here
      </button>
    </p>
  );
}
