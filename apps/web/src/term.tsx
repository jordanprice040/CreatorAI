import { useEffect, useId, useState, type ReactNode } from 'react';
import { useViewMode } from './view-mode.js';
import {
  TERMS,
  TERM_KEYS,
  TIP_CLOSED,
  nextTip,
  type TermKey,
} from './terms.js';
import './term.css';

// F12 term help: in the Standard view, one of the studio's own words gets a dotted underline
// and a short definition on hover, keyboard focus or a tap. The term is a button, so Tab
// reaches it, and its definition is its accessible description, so a screen reader reads the
// definition with the term without opening anything. The Advanced view shows plain text.

export function Term({
  term,
  children,
}: {
  term: TermKey;
  /** The words as they read on the page; the term's own label when left out. */
  children?: ReactNode;
}) {
  const { standard } = useViewMode();
  const id = useId();
  const [tip, setTip] = useState(TIP_CLOSED);
  const on = (e: Parameters<typeof nextTip>[1]) => setTip((s) => nextTip(s, e));
  // Escape dismisses a definition opened by hover too, without moving the pointer.
  useEffect(() => {
    if (!tip.open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(TIP_CLOSED);
    };
    document.addEventListener('keydown', key);
    return () => document.removeEventListener('keydown', key);
  }, [tip.open]);
  const words = children ?? TERMS[term].label;
  if (!standard) return <>{words}</>;
  return (
    <span
      className="term-wrap"
      onMouseEnter={() => on('enter')}
      onMouseLeave={() => on('leave')}
    >
      <button
        type="button"
        className="term"
        aria-describedby={`${id}-def`}
        aria-expanded={tip.open}
        aria-controls={`${id}-def`}
        onFocus={() => on('focus')}
        onBlur={() => on('blur')}
        onClick={() => on('click')}
        onKeyDown={(e) => {
          // Close this definition only; a dialog around it stays open.
          if (e.key === 'Escape' && tip.open) {
            e.stopPropagation();
            on('escape');
          }
        }}
      >
        {words}
      </button>
      <span
        id={`${id}-def`}
        role="tooltip"
        className="term-tip"
        hidden={!tip.open}
      >
        <strong>{TERMS[term].label}:</strong> {TERMS[term].definition}
      </span>
    </span>
  );
}

/** Every term and its definition, for Settings: the same words the pages use. */
export function TermList() {
  return (
    <dl className="term-list">
      {TERM_KEYS.map((k) => (
        <div key={k}>
          <dt>{TERMS[k].label}</dt>
          <dd>{TERMS[k].definition}</dd>
        </div>
      ))}
    </dl>
  );
}
