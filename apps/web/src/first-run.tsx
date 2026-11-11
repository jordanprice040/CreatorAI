import { useState } from 'react';
import type { StudioFacts } from './next-rules.js';
import {
  firstRunHiddenKey,
  firstRunSteps,
  showFirstRun,
  type FirstRunFacts,
} from './first-run-rules.js';
import type { View } from './pages.js';

// ADR-0082 (P19): "Getting started", shown on Chat and Path until the workspace has a scored
// option and a proposal or spec. One step at a time, each with one button to the tab where it
// happens. It reads the same facts as the what's-next line and starts nothing itself.

export const firstRunFacts = (f: StudioFacts): FirstRunFacts => ({
  fixture: f.fixture,
  budgets: f.budgets,
  pricing: f.pricing,
  claims: f.claims,
  problems: f.problems,
  alternatives: f.alternatives,
  scorecards: f.scorecards,
  specs: f.specs,
  ...(f.proposals === undefined ? {} : { proposals: f.proposals }),
  built: f.product !== null,
});

const readHidden = (key: string) => {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
};

export function FirstRun({
  facts,
  actor,
  ws,
  open,
}: {
  facts: StudioFacts | null;
  actor: string;
  ws: string;
  open: (view: View) => void;
}) {
  const key = firstRunHiddenKey(actor, ws);
  const [hidden, setHidden] = useState(() => readHidden(key));
  if (!facts) return null;
  const f = firstRunFacts(facts);
  if (!showFirstRun(f, hidden)) return null;
  const { steps, current } = firstRunSteps(f);
  return (
    <section className="panel first-run" aria-labelledby="first-run-h">
      <h2 id="first-run-h">Getting started</h2>
      <p className="small">
        From an empty workspace to a scored option and a proposal or build
        request, one step at a time. Each button opens the tab where the step
        happens; nothing starts until you press that tab&apos;s own button.
      </p>
      <ol className="path-stages">
        {steps.map((s, i) => {
          const state = s.done ? 'done' : i === current ? 'next' : 'later';
          return (
            <li
              key={s.key}
              className={`path-stage stage-${state}`}
              aria-current={i === current ? 'step' : undefined}
            >
              <span className="path-mark" aria-hidden="true">
                {s.done ? '✓' : i + 1}
              </span>
              <div className="path-body">
                <p className="path-head">
                  <strong>{s.label}</strong>{' '}
                  <span className={`badge path-state state-${state}`}>
                    {s.done ? 'Done' : i === current ? 'Next' : 'Later'}
                  </span>
                </p>
                {i === current && <p>{s.text}</p>}
              </div>
              {i === current && (
                <button
                  type="button"
                  className="secondary strong"
                  onClick={() => open(s.action.view)}
                >
                  {s.action.label}
                </button>
              )}
            </li>
          );
        })}
      </ol>
      <button
        type="button"
        className="text small"
        onClick={() => {
          setHidden(true);
          try {
            localStorage.setItem(key, '1');
          } catch {
            // Blocked storage: hidden until the page reloads.
          }
        }}
      >
        Hide getting started for this workspace
      </button>
    </section>
  );
}
