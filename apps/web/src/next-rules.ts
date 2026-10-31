// What each page should say comes next, or why it is blocked. Pure rules over a small set
// of workspace facts, with no imports, so they can be tested without a browser. The page
// itself still enforces nothing: every gate stays on the server, and these lines only
// point at the page where the next step happens.

/** The page that can take the step. Mirrors the view keys in ui.tsx. */
export type StepView =
  | 'overview'
  | 'submit'
  | 'catalog'
  | 'compare'
  | 'evidence'
  | 'decisions'
  | 'runs'
  | 'budgets'
  | 'scores'
  | 'search'
  | 'activity'
  | 'studies'
  | 'build'
  | 'gallery'
  | 'desktop'
  | 'operations'
  | 'marketing'
  | 'portfolio'
  | 'models'
  | 'settings'
  | 'github'
  | 'payments';

export type BuildState =
  'none' | 'running' | 'verified' | 'checkpoint' | 'failed' | 'interrupted';

/** What the studio knows about one workspace, read from its own API. */
export type StudioFacts = {
  fixture: boolean;
  /** Only the owner can build, freeze or answer most decisions. */
  owner: boolean;
  /** The desktop app has no command line yet, so CLI-only steps say so. */
  desktop: boolean;
  pending: number;
  /** Workflow steps someone can still act on: waiting, paused or reconciling. */
  attention: number;
  /** Failed workflow steps: finished, so they are noted rather than blocking. */
  failed: number;
  runs: number;
  budgets: number;
  pricing: number;
  sources: number;
  claims: number;
  problems: number;
  alternatives: number;
  scorecards: number;
  /**
   * The frozen spec the main path is about (the most recently changed one) has an active
   * humility review of its exact frozen version. Another spec's review does not count.
   */
  reviewed: boolean;
  specs: number;
  frozenSpecs: number;
  /** The most recently worked-on product, or null when there is none. */
  product: {
    /** Its spec version is still the frozen current one. */
    current: boolean;
    build: BuildState;
    packaging: boolean;
    packaged: boolean;
  } | null;
  artifacts: number;
  /** Model plan connections; null when not checked (fixture workspaces). */
  planConnections: number | null;
};

/**
 * Workflow steps that block and that failed, from the overview's exact per-state counts. The
 * overview's attention list is capped at 20 and includes failed steps, so counting from it
 * lets many newer failures hide a waiting step (PR #90 re-review N-1).
 */
export function workflowCounts(states: Partial<Record<string, number>>): {
  attention: number;
  failed: number;
} {
  return {
    attention:
      (states.waiting_human ?? 0) +
      (states.paused_operator ?? 0) +
      (states.reconciling ?? 0),
    failed: states.failed ?? 0,
  };
}

/**
 * Whether the spec the main path is about has its humility review: the first of `frozen`
 * (frozen specs, most recently changed first) needs an active review naming its exact id and
 * frozen version. A reviewed older spec does not stand in for it (PR #90 re-review N-2).
 */
export function pathSpecReviewed(
  frozen: { id: string; version: number }[],
  reviews: { status: string; body: unknown }[],
): boolean {
  const spec = frozen[0];
  if (!spec) return false;
  return reviews.some((r) => {
    const subject = (r.body as { subject?: { id?: string; version?: number } })
      ?.subject;
    return (
      r.status === 'active' &&
      subject?.id === spec.id &&
      subject.version === spec.version
    );
  });
}

export type Step = {
  tone: 'next' | 'blocked' | 'clear';
  text: string;
  action?: { label: string; view: StepView };
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/** A command-line-only step, worded for where the person is. */
const cli = (f: StudioFacts, command: string) =>
  f.desktop
    ? 'from the command line, which the desktop app does not have yet'
    : `from the command line (pnpm cli ${command}); there is no form for it yet`;

/**
 * The next step along the studio's main path: evidence, discovery, scoring, selection,
 * spec, freeze, build, package, try. Approvals are left to `nextStep`, which puts them first.
 */
export function pipelineStep(f: StudioFacts): Step {
  if (f.claims === 0)
    return {
      tone: 'next',
      text: 'Gather evidence: fetch approved sources and record the claims a discovery will use.',
      action: { label: 'Open Evidence', view: 'evidence' },
    };
  if (f.problems === 0)
    return {
      tone: 'next',
      text: 'Start a discovery from your claims to find problems and options.',
      action: { label: 'Submit a theme', view: 'submit' },
    };
  if (f.alternatives > 0 && f.scorecards === 0)
    return {
      tone: 'next',
      text: `Score the proposed options. Scorecards are entered ${cli(f, 'scorecard')}.`,
      action: { label: 'Compare the options', view: 'compare' },
    };
  if (f.specs === 0)
    return {
      tone: 'next',
      text: `Record a selection under Compare and decide, then write its spec ${cli(f, 'spec-create')}.`,
      action: { label: 'Compare and decide', view: 'compare' },
    };
  if (f.frozenSpecs === 0)
    return {
      tone: 'next',
      text: 'Freeze the spec so it can be built.',
      action: { label: 'Open Scores and specs', view: 'scores' },
    };
  if (!f.reviewed)
    return {
      tone: 'next',
      text: `Add a humility review of the frozen spec version ${cli(f, 'humility-gate')}. A build needs one.`,
      action: { label: 'Open Build and package', view: 'build' },
    };
  return productStep(f);
}

/** Where the latest product stands, and the one thing to do about it. */
function productStep(f: StudioFacts): Step {
  const p = f.product;
  const build = { label: 'Open Build and package', view: 'build' } as const;
  if (!p || !p.current)
    return {
      tone: 'next',
      text: p
        ? 'The spec changed after the latest product was made. Create a product from the current frozen version.'
        : 'Create a product from the frozen spec, prepare its task and start a build.',
      action: build,
    };
  switch (p.build) {
    case 'none':
      return {
        tone: 'next',
        text: 'Start a build of the product.',
        action: build,
      };
    case 'running':
      return {
        tone: 'clear',
        text: 'A build is running. Build and package updates while it runs.',
        action: build,
      };
    case 'checkpoint':
      return {
        tone: 'blocked',
        text: 'The last build stopped at a checkpoint. Its reason says what it needs; then build again.',
        action: build,
      };
    case 'failed':
    case 'interrupted':
      return {
        tone: 'blocked',
        text: `The last build ${p.build === 'failed' ? 'failed' : 'did not finish'}. Read its reason, fix what it names and build again.`,
        action: build,
      };
    case 'verified':
      if (p.packaging)
        return {
          tone: 'clear',
          text: 'Packaging is running. The package appears in Gallery when it finishes.',
          action: build,
        };
      if (!p.packaged)
        return {
          tone: 'next',
          text: 'The build is verified. Package it to try it in Gallery.',
          action: build,
        };
      return {
        tone: 'next',
        text: 'Try the newest package in its private preview and record your feedback; feedback can start a revision.',
        action: { label: 'Open Gallery', view: 'gallery' },
      };
  }
}

const decisionsAction = { label: 'Open Decisions', view: 'decisions' } as const;

/** Pages that are not on the main path: what they need, and otherwise where the path is. */
function optional(f: StudioFacts, what: string, needsPackage = false): Step {
  if (needsPackage && f.artifacts === 0)
    return {
      tone: 'blocked',
      text: `${what} needs a packaged product, and nothing is packaged yet.`,
      action: { label: 'Open Build and package', view: 'build' },
    };
  const path = pipelineStep(f);
  return { ...path, text: `${what} is optional. Main path: ${path.text}` };
}

/** What this page says comes next, or why it is blocked. */
export function nextStep(view: StepView, f: StudioFacts): Step {
  switch (view) {
    case 'overview':
      if (f.pending > 0)
        return {
          tone: 'next',
          text: `${plural(f.pending, 'decision')} ${f.pending === 1 ? 'waits' : 'wait'} for you.`,
          action: decisionsAction,
        };
      if (f.attention > 0)
        return {
          tone: 'blocked',
          text: `${plural(f.attention, 'run step')} ${f.attention === 1 ? 'is' : 'are'} waiting, paused or reconciling.`,
          action: { label: 'Open Runs', view: 'runs' },
        };
      return pipelineStep(f);
    case 'decisions':
      if (f.pending > 0)
        return {
          tone: 'next',
          text: `Answer the ${plural(f.pending, 'decision')} below. Approving permits exactly the action shown.`,
        };
      return clearThen(f, 'Nothing needs you right now.');
    case 'runs':
      if (f.attention > 0)
        return {
          tone: 'blocked',
          text: `${plural(f.attention, 'run step')} ${f.attention === 1 ? 'is' : 'are'} waiting, paused or reconciling. Open one to see why.`,
        };
      if (f.runs === 0)
        return {
          tone: 'blocked',
          text: 'There is no active run. A discovery registers one, or register one under Evidence.',
          action: { label: 'Open Evidence', view: 'evidence' },
        };
      return pipelineStep(f);
    case 'budgets':
      if (f.budgets === 0)
        return {
          tone: 'next',
          text: 'Create a budget here. Discoveries and builds name one, even on the $0 plan route.',
        };
      if (f.pricing === 0)
        return {
          tone: 'next',
          text: 'Add a pricing snapshot here. Builds record the one they ran under.',
        };
      return pipelineStep(f);
    case 'evidence':
      if (f.claims === 0)
        return {
          tone: 'next',
          text: 'Fetch approved sources below and record the claims a discovery will use.',
        };
      return pipelineStep(f);
    case 'submit':
      if (f.claims === 0)
        return {
          tone: 'blocked',
          text: 'A discovery works from recorded claims, and there are none yet.',
          action: { label: 'Open Evidence', view: 'evidence' },
        };
      if (f.budgets === 0)
        return {
          tone: 'blocked',
          text: 'A discovery needs an active budget.',
          action: { label: 'Open Budgets', view: 'budgets' },
        };
      if (f.problems === 0)
        return { tone: 'next', text: 'Start a discovery below.' };
      return pipelineStep(f);
    case 'compare':
      if (f.problems === 0)
        return {
          tone: 'blocked',
          text: 'There is nothing to compare until a discovery records problems and options.',
          action: { label: 'Submit a theme', view: 'submit' },
        };
      if (f.specs === 0 && f.scorecards > 0)
        return {
          tone: 'next',
          text: `Record a selection below, then write its spec ${cli(f, 'spec-create')}.`,
        };
      return pipelineStep(f);
    case 'scores':
      if (f.problems === 0)
        return {
          tone: 'blocked',
          text: 'There is nothing to score until a discovery records problems and options.',
          action: { label: 'Submit a theme', view: 'submit' },
        };
      if (f.specs > 0 && f.frozenSpecs === 0)
        return {
          tone: 'next',
          text: 'Open the spec below and freeze it, so it can be built.',
        };
      return pipelineStep(f);
    case 'build':
      if (f.frozenSpecs === 0)
        return {
          tone: 'blocked',
          text: 'Building needs a frozen spec, and none is frozen.',
          action: { label: 'Open Scores and specs', view: 'scores' },
        };
      if (f.budgets === 0 || f.pricing === 0)
        return {
          tone: 'blocked',
          text: `A build records ${f.budgets === 0 ? 'an active budget' : 'a pricing snapshot'}, and there is none.`,
          action: { label: 'Open Budgets', view: 'budgets' },
        };
      if (!f.owner)
        return { tone: 'blocked', text: 'Only the workspace owner can build.' };
      return pipelineStep(f);
    case 'gallery':
      if (f.artifacts === 0)
        return {
          tone: 'blocked',
          text: 'Nothing is packaged yet. Package a verified build first.',
          action: { label: 'Open Build and package', view: 'build' },
        };
      return {
        tone: 'next',
        text: 'Try the newest package in its private preview and record your feedback; feedback can start a revision.',
      };
    case 'models':
      if (f.planConnections === 0)
        return {
          tone: 'next',
          text: 'Connect a model plan here. Builds on a qualified plan cost $0 in metered spend.',
        };
      return pipelineStep(f);
    case 'marketing':
      return optional(f, 'A campaign', true);
    case 'payments':
      return optional(f, 'Selling', true);
    case 'github':
      return optional(f, 'Publishing to GitHub', true);
    case 'portfolio':
      return optional(f, 'Maintaining products', true);
    case 'studies':
      return optional(f, 'The study runner');
    case 'catalog':
    case 'search':
    case 'activity':
    case 'desktop':
    case 'operations':
    case 'settings':
      return pipelineStep(f);
  }
}

function clearThen(f: StudioFacts, lead: string): Step {
  const path = pipelineStep(f);
  return { ...path, tone: 'clear', text: `${lead} Next: ${path.text}` };
}

/** A pointer to waiting decisions, for pages whose own line is about something else. */
export function decisionsNote(view: StepView, f: StudioFacts) {
  if (f.pending === 0 || view === 'decisions' || view === 'overview')
    return null;
  return `${plural(f.pending, 'decision')} ${f.pending === 1 ? 'waits' : 'wait'} for you`;
}

/** Failed run steps, shown on the monitor and Runs as a note: they finished and block nothing. */
export function failedNote(view: StepView, f: StudioFacts) {
  if (f.failed === 0 || (view !== 'overview' && view !== 'runs')) return null;
  return `${plural(f.failed, 'run step')} failed earlier; open ${f.failed === 1 ? 'it' : 'one'} under Runs to see why`;
}
