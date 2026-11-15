import { pathStages, type StudioFacts } from './next-rules.js';
import { placeLabel, type View } from './pages.js';

const STATE_TEXT = {
  done: 'Done',
  skipped: 'Not needed',
  next: 'Next',
  running: 'In progress',
  blocked: 'Blocked',
  later: 'Later',
} as const;

/**
 * Projects › Path: the main path from evidence to a product you can try, one row per stage.
 * Each row says whether it is done, next, in progress or blocked; the current one says what to
 * do or why it is blocked and opens the tab where that happens, and later ones say what they
 * will need. Read-only: every step still goes through its own tab and the server's gates.
 */
export function PathView({
  facts,
  open,
}: {
  facts: StudioFacts | null;
  open: (view: View) => void;
}) {
  if (!facts)
    return (
      <section className="panel">
        <h2>Path</h2>
        <p className="small">Reading where this workspace stands…</p>
      </section>
    );
  // When every stage is done, the line above the tabs carries the closing step (revise, or
  // finished); repeating it under the list said the same thing twice (PR #101 review L-1).
  const { stages } = pathStages(facts);
  return (
    <section className="panel">
      <h2>Path</h2>
      <p className="small">
        The main path for the idea you worked on most recently. After Selection
        it branches: software goes on to a spec, a build and a product you can
        try; a non-code choice goes to a proposal and its review. Each step
        happens on its own tab; this list shows where you are and what each step
        needs.
      </p>
      <ol className="path-stages">
        {stages.map((s, i) => (
          <li
            key={s.key}
            className={`path-stage stage-${s.state}`}
            aria-current={
              s.state !== 'done' && s.state !== 'skipped' && s.state !== 'later'
                ? 'step'
                : undefined
            }
          >
            <span className="path-mark" aria-hidden="true">
              {s.state === 'done' ? '✓' : s.state === 'skipped' ? '–' : i + 1}
            </span>
            <div className="path-body">
              <p className="path-head">
                <strong>{s.label}</strong>{' '}
                <span className={`badge path-state state-${s.state}`}>
                  {STATE_TEXT[s.state]}
                </span>
              </p>
              {s.text && (
                <p className={s.state === 'later' ? 'small' : undefined}>
                  {s.state === 'later' ? `Will need: ${s.text}` : s.text}
                </p>
              )}
            </div>
            <button
              type="button"
              className={
                s.state === 'next' || s.state === 'blocked'
                  ? 'secondary strong'
                  : 'text'
              }
              onClick={() => open(s.view)}
            >
              Open {placeLabel(s.view, 'path')}
            </button>
          </li>
        ))}
      </ol>
    </section>
  );
}
