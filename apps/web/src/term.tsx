import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useViewMode } from './view-mode.js';
import {
  TERMS,
  TERM_KEYS,
  GUTTER,
  TIP_CLOSED,
  nextTip,
  tipShift,
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
  const [shift, setShift] = useState(0);
  const wrap = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLSpanElement>(null);
  const on = (e: Parameters<typeof nextTip>[1]) => setTip((s) => nextTip(s, e));
  // Escape dismisses a definition opened by hover too, without moving the pointer. A tap
  // elsewhere closes a pinned one, since Safari never focuses (so never blurs) a tapped button.
  useEffect(() => {
    if (!tip.open) return;
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTip(TIP_CLOSED);
    };
    const tap = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setTip(TIP_CLOSED);
    };
    document.addEventListener('keydown', key);
    document.addEventListener('pointerdown', tap);
    return () => {
      document.removeEventListener('keydown', key);
      document.removeEventListener('pointerdown', tap);
    };
  }, [tip.open]);
  // Keep the definition inside the window: a term near the right edge moves its box left.
  useLayoutEffect(() => {
    if (!tip.open || !box.current || !wrap.current) return;
    const width = box.current.offsetWidth;
    const left = wrap.current.getClientRects()[0]?.left ?? 0;
    const room = document.documentElement.clientWidth - GUTTER;
    setShift(tipShift(left, width, room));
  }, [tip.open]);
  const words = children ?? TERMS[term].label;
  if (!standard) return <>{words}</>;
  return (
    <span
      ref={wrap}
      className="term-wrap"
      onMouseEnter={() => on('enter')}
      onMouseLeave={() => on('leave')}
    >
      <button
        type="button"
        className="term"
        data-open={tip.open || undefined}
        aria-describedby={`${id}-def`}
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
        ref={box}
        role="tooltip"
        className="term-tip"
        hidden={!tip.open}
        style={shift ? { left: `${shift}px` } : undefined}
      >
        {/* The label is for sight only: a screen reader already said the word. */}
        <strong aria-hidden="true">{TERMS[term].label}:</strong>{' '}
        <span id={`${id}-def`}>{TERMS[term].definition}</span>
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
