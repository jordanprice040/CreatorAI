// ADR-0082 (P19): the first-run path, from an empty workspace to one useful output (a scored
// option and a proposal or a spec on its way to a build). Pure rules with no imports, so they
// load in tests without a browser. They only point at the tab where each step happens; every
// step still goes through that tab's form and the server's checks.

export type FirstRunView =
  'budgets' | 'evidence' | 'submit' | 'compare' | 'proposals' | 'build';

export type FirstRunFacts = {
  fixture: boolean;
  budgets: number;
  pricing: number;
  claims: number;
  problems: number;
  alternatives: number;
  scorecards: number;
  specs: number;
  /** Proposals in the workspace; undefined when they could not be read. */
  proposals?: number;
  /** A product exists, so a build was requested. */
  built: boolean;
};

export type FirstRunStep = {
  key: 'budget' | 'evidence' | 'discover' | 'score' | 'choose';
  label: string;
  /** What to do, in one sentence. */
  text: string;
  /** The one button of the step. */
  action: { view: FirstRunView; label: string };
  done: boolean;
};

export function firstRunSteps(f: FirstRunFacts): {
  steps: FirstRunStep[];
  /** Index of the step to do now; -1 when every step is done. */
  current: number;
} {
  const chose = f.specs > 0 || (f.proposals ?? 0) > 0 || f.built;
  const steps: FirstRunStep[] = [
    {
      key: 'evidence',
      label: 'Record evidence',
      text: f.fixture
        ? 'Register a run for fetching, fetch one of the suggested synthetic pages, and cite a passage in a claim.'
        : 'Fetch a page from an approved site and cite a passage in a claim. Claims are what discovery works from.',
      action: { view: 'evidence', label: 'Open Sources and claims' },
      done: f.claims > 0,
    },
    {
      key: 'budget',
      label: 'Set up a budget',
      text: f.fixture
        ? 'Fund a budget with the default simulated units and add fixture pricing, so a discovery can reserve its calls. No money is involved.'
        : 'Fund a $0 budget: discovery on a connected plan costs nothing but still names one.',
      action: { view: 'budgets', label: 'Open Budgets' },
      done: f.budgets > 0 && (!f.fixture || f.pricing > 0),
    },
    {
      key: 'discover',
      label: 'Discover problems and options',
      text: 'Write a short brief, tick the claims it rests on and start. Routine settings use the defaults shown.',
      action: { view: 'submit', label: 'Open Discover' },
      done: f.problems > 0,
    },
    {
      key: 'score',
      label: 'Score an option',
      text: 'Rate one proposed option on the rubric. Pick Unknown where the evidence does not tell you.',
      action: { view: 'compare', label: 'Open Decide' },
      // A discovery that proposed no options has nothing to score.
      done: f.scorecards > 0 || (f.problems > 0 && f.alternatives === 0),
    },
    {
      key: 'choose',
      label: 'Choose what to do with it',
      text: 'Record your choice under Decide. A non-code choice is then ready to write up under Proposals; for software, write a spec under Build and request a build.',
      action: { view: 'compare', label: 'Open Decide' },
      done: chose,
    },
  ];
  // Steps are taken in order: a later record does not skip an earlier gap.
  return { steps, current: steps.findIndex((s) => !s.done) };
}

/** Whether to offer the first-run path: until its last step is done, unless hidden. */
export const showFirstRun = (f: FirstRunFacts, hidden: boolean) =>
  !hidden && firstRunSteps(f).current >= 0;

export const firstRunHiddenKey = (actor: string, ws: string) =>
  `creator.firstRunHidden.${actor}.${ws}`;
