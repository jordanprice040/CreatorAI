// What each page should say comes next, or why it is blocked. Pure rules over a small set
// of workspace facts, with no imports, so they can be tested without a browser. The page
// itself still enforces nothing: every gate stays on the server, and these lines only
// point at the page where the next step happens.

/** The tab that can take the step. Mirrors the view keys in pages.ts. */
export type StepView =
  | 'chat'
  | 'path'
  | 'overview'
  | 'submit'
  | 'catalog'
  | 'files'
  | 'compare'
  | 'proposals'
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
  | 'payments'
  | 'autopilot';

export type BuildState =
  'none' | 'running' | 'verified' | 'checkpoint' | 'failed' | 'interrupted';

/** What the studio knows about one workspace, read from its own API. */
export type StudioFacts = {
  /**
   * Activity-dot keys for the Build tab (activity-marks.ts `buildMark`), read with the same
   * products and artifacts lists, tagged with the workspace they belong to.
   */
  buildKeys?: { ws: string; keys: readonly string[] };
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
    /**
     * Feedback recorded on the newest package (the one Try opens): trying it means recording
     * feedback, so this is what finishes the Try stage. `accepted` counts items accepted for a
     * revision that has not been written yet; `undecided` counts items still to accept or
     * decline. Absent when not packaged or when the package could not be read.
     */
    feedback?: { total: number; accepted: number; undecided: number };
  } | null;
  artifacts: number;
  /** ADR-0082: proposals in the workspace, for the first-run path; absent when unread. */
  proposals?: number;
  /**
   * UX pass P-2: selections recorded (active problems with one) and where the newest sends
   * the path: a spec for software, a proposal for a non-code choice, or neither. Absent when
   * unread, and then the Path keeps to the software route as before.
   */
  selection?: SelectionFacts;
  /** Model plan connections; null when not checked (fixture workspaces). */
  planConnections: number | null;
  /**
   * Autopilots working now, and stopped ones waiting for the person to continue them; left
   * out when the list could not be read (the Autopilot nav count then shows nothing).
   */
  autopilots?: { running: number; waiting: number };
};

/** Where the newest selection sends the main path (UX pass P-2). */
export type SelectionFacts = {
  count: number;
  /** null when no selection is recorded yet. */
  route: 'software' | 'non_code' | 'none' | null;
  /** For a non-code route, the proposal the path is about; null when none is saved yet. */
  proposal: {
    title: string;
    /** Required sections not written yet. */
    unknownCore: number;
    /** The newest review of its current version says ready. */
    reviewed: boolean;
    /** The newest review of its current version asks for changes. */
    revise: boolean;
  } | null;
};

/** The newest selection's route, when one is recorded and was read. */
const routeOf = (f: StudioFacts) => f.selection?.route ?? null;
/** A selection is recorded (or, when selections were not read, a spec stands for one). */
const selected = (f: StudioFacts) =>
  f.specs > 0 || (f.selection?.count ?? 0) > 0;

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
  /** The tab that takes the step; the page names it from the page map ("Projects › Build"). */
  action?: { view: StepView };
};

const plural = (n: number, one: string, many = `${one}s`) =>
  `${n} ${n === 1 ? one : many}`;

/**
 * The next step along the studio's main path: evidence, discovery, scoring, selection,
 * spec, freeze, build, package, try. Approvals are left to `nextStep`, which puts them first.
 */
export function pipelineStep(f: StudioFacts): Step {
  if (f.claims === 0)
    return {
      tone: 'next',
      text: 'Gather evidence: fetch approved sources and record the claims a discovery will use.',
      action: { view: 'evidence' },
    };
  if (f.problems === 0)
    return {
      tone: 'next',
      text: 'Start a discovery from your claims to find problems and options.',
      action: { view: 'submit' },
    };
  if (f.alternatives > 0 && f.scorecards === 0)
    return {
      tone: 'next',
      text: 'Score the proposed options: open Projects › Decide and use Score an option for each one.',
      action: { view: 'compare' },
    };
  if (!selected(f))
    return {
      tone: 'next',
      text: 'Record a selection under Projects › Decide. A software choice then gets a spec under Projects › Build (Write a spec); a non-code choice is written up under Projects › Proposals.',
      action: { view: 'compare' },
    };
  const route = routeOf(f);
  if (route === 'non_code') return proposalStep(f);
  if (route === 'none') return NO_ROUTE_STEP;
  if (f.specs === 0)
    return {
      tone: 'next',
      text: 'Write a spec for the option your selection chose to build: Projects › Build, Write a spec.',
      action: { view: 'build' },
    };
  if (f.frozenSpecs === 0)
    return {
      tone: 'next',
      text: 'Freeze the spec so it can be built.',
      action: { view: 'scores' },
    };
  if (!f.reviewed)
    return {
      tone: 'next',
      text: 'Add a humility review of the frozen spec version under Projects › Build (Add a humility review). A build needs one.',
      action: { view: 'build' },
    };
  return productStep(f);
}

/** The newest selection advanced nothing to a spec or a proposal: the path ends there. */
const NO_ROUTE_STEP: Step = {
  tone: 'clear',
  text: 'Your newest selection chose no option to build and none to write up as a proposal (it deferred, rejected, kept researching or sent software to validation). Gather more evidence, or record another selection under Projects › Decide when you want to go on.',
  action: { view: 'compare' },
};

/**
 * UX pass P-2: the non-code branch after a selection. Write the proposal, finish its required
 * sections, then review it; a proposal whose current version is reviewed as ready finishes the
 * path. The review is about the document; it does not show that the plan works.
 */
function proposalStep(f: StudioFacts): Step {
  const p = f.selection?.proposal ?? null;
  const proposals = { view: 'proposals' } as const;
  if (!p)
    return {
      tone: 'next',
      text: 'Write up the option your selection recommended: Projects › Proposals, Start a proposal.',
      action: proposals,
    };
  if (p.unknownCore > 0)
    return {
      tone: 'next',
      text: `Finish the proposal “${p.title}”: ${plural(p.unknownCore, 'required section')} ${p.unknownCore === 1 ? 'is' : 'are'} still Unknown yet. Write ${p.unknownCore === 1 ? 'it' : 'them'}, or use Draft the missing sections and accept the drafts you agree with.`,
      action: proposals,
    };
  if (!p.reviewed)
    return {
      tone: 'next',
      text: p.revise
        ? `Revise the proposal “${p.title}” from its review, then review the new version.`
        : `Review the proposal “${p.title}” under Projects › Proposals: mark it ready, or ask for changes.`,
      action: proposals,
    };
  return {
    tone: 'clear',
    text: `This idea's path is finished: the proposal “${p.title}” is reviewed as ready. Carrying it out happens outside the studio; start a new discovery when you want another idea.`,
    action: { view: 'submit' },
  };
}

/** Where the latest product stands, and the one thing to do about it. */
function productStep(f: StudioFacts): Step {
  const p = f.product;
  const build = { view: 'build' } as const;
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
        text: 'A build is running. The Build tab updates while it runs.',
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
          text: 'Packaging is running. The package appears under Try when it finishes.',
          action: build,
        };
      if (!p.packaged)
        return {
          tone: 'next',
          text: 'The build is verified. Package it, then try it under Try.',
          action: build,
        };
      return tryStep(p.feedback);
  }
}

/**
 * Counts for the facts from one package's feedback list. Praise ("works as intended") is a
 * finished answer, not something to accept or decline, so it never counts as waiting for a
 * decision or as accepted for a revision (PR #101 review M-1).
 */
export function feedbackCounts(
  list: readonly { category: string; status: string }[],
): { total: number; accepted: number; undecided: number } {
  const actionable = list.filter((f) => f.category !== 'praise');
  return {
    total: list.length,
    accepted: actionable.filter((f) => f.status === 'accepted').length,
    undecided: actionable.filter((f) => f.status === 'submitted').length,
  };
}

/** Plain words for how much feedback there is, e.g. "1 feedback item". */
const items = (n: number) => plural(n, 'feedback item');

/**
 * After packaging: Try is done once feedback is recorded on the newest package. Then the path
 * either has accepted feedback to revise from, or it is finished for this product.
 */
function tryStep(
  feedback: { total: number; accepted: number; undecided: number } | undefined,
): Step {
  const gallery = { view: 'gallery' } as const;
  if (!feedback || feedback.total === 0)
    return {
      tone: 'next',
      text: 'Try the newest package in its private preview and record your feedback; feedback can start a revision.',
      action: gallery,
    };
  if (feedback.accepted > 0)
    return {
      tone: 'next',
      text:
        feedback.accepted === 1
          ? 'Revise the spec from your accepted feedback item: open the package under Try and press “Revise the spec from this feedback”. The revision is frozen, reviewed and built like the first version.'
          : `Revise the spec once from your ${feedback.accepted} accepted feedback items: open the package under Try, press “Revise the spec from this feedback” on one of them and make all their changes in that one revision. The revision is frozen, reviewed and built like the first version.`,
      action: gallery,
    };
  if (feedback.undecided > 0)
    return {
      tone: 'clear',
      text: `You tried the newest package and recorded ${items(feedback.total)}. Accept one under Try to start a revision, or start a new discovery when you want another product.`,
      action: gallery,
    };
  return {
    tone: 'clear',
    text: `This product's path is finished: you tried the newest package and recorded ${items(feedback.total)}. Start a new discovery when you want another product.`,
    action: { view: 'submit' },
  };
}

const decisionsAction = { view: 'decisions' } as const;

/** Pages that are not on the main path: what they need, and otherwise where the path is. */
function optional(f: StudioFacts, what: string, needsPackage = false): Step {
  if (needsPackage && f.artifacts === 0)
    return {
      tone: 'blocked',
      text: `${what} needs a packaged product, and nothing is packaged yet.`,
      action: { view: 'build' },
    };
  const path = pipelineStep(f);
  return { ...path, text: `${what} is optional. Main path: ${path.text}` };
}

/** What this page says comes next, or why it is blocked. */
export function nextStep(view: StepView, f: StudioFacts): Step {
  switch (view) {
    case 'chat':
      // The front door: waiting approvals first, then the path's own step.
      if (f.pending > 0)
        return {
          tone: 'next',
          text: `${plural(f.pending, 'decision')} ${f.pending === 1 ? 'waits' : 'wait'} for you.`,
          action: decisionsAction,
        };
      return pathStages(f).step;
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
          action: { view: 'runs' },
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
          text: 'There is no active run. A discovery registers one, or register one under Sources.',
          action: { view: 'evidence' },
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
          // P-14: Fetch needs a run, so with none the line names that step first.
          text:
            f.runs === 0
              ? 'Register a run for fetching below, then fetch approved sources and record the claims a discovery will use, or let Discover › Search the web find pages.'
              : 'Fetch approved sources below and record the claims a discovery will use.',
        };
      return pipelineStep(f);
    case 'submit':
      if (f.claims === 0)
        return {
          tone: 'blocked',
          text: 'A discovery works from recorded claims, and there are none yet.',
          action: { view: 'evidence' },
        };
      if (f.budgets === 0)
        return {
          tone: 'blocked',
          text: 'A discovery needs an active budget.',
          action: { view: 'budgets' },
        };
      if (f.problems === 0)
        return { tone: 'next', text: 'Start a discovery below.' };
      return pipelineStep(f);
    case 'compare':
      if (f.problems === 0)
        return {
          tone: 'blocked',
          text: 'There is nothing to compare until a discovery records problems and options.',
          action: { view: 'submit' },
        };
      if (f.alternatives > 0 && f.scorecards === 0)
        return {
          tone: 'next',
          text: 'Score the options below: assess them automatically, or score one yourself.',
        };
      if (!selected(f) && f.scorecards > 0)
        return {
          tone: 'next',
          text: 'Record a selection below. A software choice then gets a spec under Projects › Build (Write a spec); a non-code choice is written up under Projects › Proposals.',
        };
      return pipelineStep(f);
    case 'scores':
      if (f.problems === 0)
        return {
          tone: 'blocked',
          text: 'There is nothing to score until a discovery records problems and options.',
          action: { view: 'submit' },
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
          action: { view: 'scores' },
        };
      if (f.budgets === 0 || f.pricing === 0)
        return {
          tone: 'blocked',
          text: `A build records ${f.budgets === 0 ? 'an active budget' : 'a pricing snapshot'}, and there is none.`,
          action: { view: 'budgets' },
        };
      if (!f.owner)
        return { tone: 'blocked', text: 'Only the workspace owner can build.' };
      return pipelineStep(f);
    case 'gallery':
      if (f.artifacts === 0)
        return {
          tone: 'blocked',
          text: 'Nothing is packaged yet. Package a verified build first.',
          action: { view: 'build' },
        };
      // The newest package: the path's own step, so Try never says "All clear" while an
      // earlier stage (a humility review, say) is still open. At Try or later that step is
      // try it, then revise from feedback or finish (PR #101 review L-3).
      if (
        f.product?.current &&
        f.product.build === 'verified' &&
        f.product.packaged
      )
        return pathStages(f).step;
      return {
        tone: 'next',
        text: 'Try a package in its private preview and record your feedback; feedback can start a revision.',
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
    case 'path':
      // The Path list's own step, budget and owner blocks included, so the line above the
      // tabs and the list never disagree (PR #97 review M-1).
      return pathStages(f).step;
    case 'proposals':
      // ADR-0077: proposals are the non-code branch; software goes on to a spec instead.
      if (f.problems === 0)
        return {
          tone: 'blocked',
          text: 'A proposal starts from a recommended option, and no discovery has recorded problems yet.',
          action: { view: 'submit' },
        };
      if (routeOf(f) === 'non_code') return proposalStep(f);
      return {
        tone: 'next',
        text: 'Write up a recommended non-code option as a proposal below. Software options go to a spec under Build instead.',
      };
    case 'autopilot':
      if (f.autopilots && f.autopilots.waiting > 0)
        return {
          tone: 'next',
          text: `${plural(f.autopilots.waiting, 'autopilot')} ${f.autopilots.waiting === 1 ? 'waits' : 'wait'} for you below: do what its card says, then press Continue on it.`,
        };
      if (f.autopilots && f.autopilots.running > 0)
        return {
          tone: 'clear',
          text: `${plural(f.autopilots.running, 'autopilot')} ${f.autopilots.running === 1 ? 'is' : 'are'} working; its steps show below as they happen.`,
        };
      return pipelineStep(f);
    case 'catalog':
    case 'files':
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
  // A finished or running path has no "next" to name; say where it stands instead.
  return {
    ...path,
    tone: 'clear',
    text: `${lead} ${path.tone === 'clear' ? path.text : `Next: ${path.text}`}`,
  };
}

/** A pointer to waiting decisions, for pages whose own line is about something else. */
export function decisionsNote(view: StepView, f: StudioFacts) {
  if (
    f.pending === 0 ||
    view === 'decisions' ||
    view === 'overview' ||
    view === 'chat'
  )
    return null;
  return `${plural(f.pending, 'decision')} ${f.pending === 1 ? 'waits' : 'wait'} for you`;
}

/** Failed run steps, shown on Monitor's Overview and Runs as a note: they finished and block nothing. */
export function failedNote(view: StepView, f: StudioFacts) {
  if (f.failed === 0 || (view !== 'overview' && view !== 'runs')) return null;
  return `${plural(f.failed, 'run step')} failed earlier; open ${f.failed === 1 ? 'it' : 'one'} under Monitor › Runs to see why`;
}

export type StageState =
  'done' | 'skipped' | 'next' | 'running' | 'blocked' | 'later';
export type Stage = {
  key: string;
  label: string;
  state: StageState;
  /** For the current stage, what to do or why it is blocked; for a later one, what it will need. */
  text: string | null;
  /** The tab where this stage happens. */
  view: StepView;
};

/**
 * Prerequisites outside the path itself that would stop a stage, as the server enforces them
 * (budgets, pricing, owner role). Shown on the current stage as the reason it is blocked and on
 * later stages as what they will need, so a block is never a surprise.
 */
function stageNeeds(key: string, f: StudioFacts): Step | null {
  if (key === 'discovery' && f.budgets === 0)
    return {
      tone: 'blocked',
      text: 'A discovery needs an active budget, even on the $0 plan route.',
      action: { view: 'budgets' },
    };
  if ((key === 'build' || key === 'package') && !f.owner)
    return {
      tone: 'blocked',
      text: `Only the workspace owner can ${key}.`,
    };
  // Packaging needs only a verified build and its owner; budget and pricing are build-only.
  if (key === 'build') {
    if (f.budgets === 0 || f.pricing === 0)
      return {
        tone: 'blocked',
        text: `A build records ${f.budgets === 0 ? 'an active budget' : 'a pricing snapshot'}, and there is none.`,
        action: { view: 'budgets' },
      };
  }
  return null;
}

/**
 * The main path as stages for Projects › Path: which are done, which one is next (or blocked,
 * and why), and what the later ones will need. It reads the same facts and wording as the
 * what's-next line, so the two never disagree; the server still enforces every gate.
 */
export function pathStages(f: StudioFacts): {
  stages: Stage[];
  step: Step;
  /** Every stage is done; `step` is then the closing line (revise, or start another). */
  finished: boolean;
} {
  const p = f.product;
  const built = p !== null && p.current && p.build === 'verified';
  const route = routeOf(f);
  type Row = { key: string; label: string; done: boolean; view: StepView };
  const head: Row[] = [
    {
      key: 'evidence',
      label: 'Evidence',
      done: f.claims > 0,
      view: 'evidence',
    },
    {
      key: 'discovery',
      label: 'Discovery',
      done: f.problems > 0,
      view: 'submit',
    },
    {
      key: 'scores',
      label: 'Scores',
      // Mirrors pipelineStep: scoring is due only while options exist and none is scored.
      done: f.problems > 0 && !(f.alternatives > 0 && f.scorecards === 0),
      view: 'compare',
    },
    {
      key: 'selection',
      label: 'Selection',
      done: selected(f),
      view: 'compare',
    },
  ];
  // UX pass P-2: the path branches after Selection. A non-code choice goes to Proposal and
  // Review; a selection that advanced nothing ends there; software (and a path whose
  // selections were not read) goes on to Spec, Freeze, Humility review, Build, Package, Try.
  const proposal = f.selection?.proposal ?? null;
  const branch: Row[] =
    route === 'non_code'
      ? [
          {
            key: 'proposal',
            label: 'Proposal',
            done: proposal !== null && proposal.unknownCore === 0,
            view: 'proposals',
          },
          {
            key: 'proposal_review',
            label: 'Review',
            done:
              proposal !== null &&
              proposal.unknownCore === 0 &&
              proposal.reviewed,
            view: 'proposals',
          },
        ]
      : route === 'none'
        ? []
        : [
            { key: 'spec', label: 'Spec', done: f.specs > 0, view: 'build' },
            {
              key: 'freeze',
              label: 'Freeze',
              done: f.frozenSpecs > 0,
              view: 'scores',
            },
            {
              key: 'review',
              label: 'Humility review',
              done: f.frozenSpecs > 0 && f.reviewed,
              view: 'build',
            },
            { key: 'build', label: 'Build', done: built, view: 'build' },
            {
              key: 'package',
              label: 'Package',
              done: built && p !== null && p.packaged,
              view: 'build',
            },
            {
              key: 'try',
              label: 'Try',
              // Trying means recording feedback on the newest package; the step after it
              // (revise, or nothing) is the path's closing line rather than another stage.
              done:
                built &&
                p !== null &&
                p.packaged &&
                (p.feedback?.total ?? 0) > 0,
              view: 'gallery',
            },
          ];
  const list = [...head, ...branch];
  // Stages are done in order: a later record does not count past an earlier gap.
  // When every stage is done the path is finished and no stage is current.
  const current = list.findIndex((s) => !s.done);
  const finished = current < 0;
  const path = pipelineStep(f);
  // A step in progress (a running build or packaging) needs no one, so nothing blocks it.
  const needs =
    finished || path.tone === 'clear'
      ? null
      : stageNeeds(list[current]!.key, f);
  const step: Step = needs ?? path;
  const stages = list.map((s, i): Stage => {
    if (finished || i < current)
      return {
        ...s,
        // Scoring is skipped when discovery proposed no options: not done, not needed.
        state:
          s.key === 'scores' && f.alternatives === 0 && f.scorecards === 0
            ? 'skipped'
            : 'done',
        text: null,
      };
    if (i === current)
      return {
        key: s.key,
        label: s.label,
        view: step.action?.view ?? s.view,
        state:
          step.tone === 'blocked'
            ? 'blocked'
            : step.tone === 'clear'
              ? 'running'
              : 'next',
        text: step.text,
      };
    return {
      key: s.key,
      label: s.label,
      view: s.view,
      state: 'later',
      text:
        stageNeeds(s.key, f)?.text ??
        // Before any selection the route is not known yet; say where each choice goes.
        (s.key === 'spec' && !selected(f)
          ? 'a software choice at Selection. A non-code choice goes to Proposal and Review instead.'
          : null),
    };
  });
  return { stages, step, finished };
}

/** The tabs of the Projects page, where the main path happens (mirrors pages.ts). */
const PROJECT_VIEWS: readonly StepView[] = [
  'path',
  'submit',
  'compare',
  'proposals',
  'scores',
  'build',
  'gallery',
  'payments',
  'marketing',
  'portfolio',
];

/**
 * P-15 (final UX pass): the short path summary in the Next banner's own shape, so every page
 * shows guidance the same way: a lead ("Next", "Blocked", "All clear"), one sentence, and the
 * page that takes the step.
 */
export function pathBanner(f: StudioFacts): {
  tone: Step['tone'];
  text: string;
  view: StepView;
} {
  const { stages, step, finished } = pathStages(f);
  if (finished) {
    const route = routeOf(f);
    if (route === 'non_code')
      return {
        tone: 'clear',
        text: 'The main path is finished: the proposal is reviewed as ready.',
        view: 'path',
      };
    if (route === 'none')
      return {
        tone: 'next',
        text: 'Record another selection: the last one advanced no option.',
        view: 'compare',
      };
    return step.tone === 'next'
      ? {
          tone: 'next',
          text: 'Revise this product from your feedback on the main path.',
          view: step.action?.view ?? 'gallery',
        }
      : {
          tone: 'clear',
          text: 'The main path is finished for this product.',
          view: 'path',
        };
  }
  const s = stages.find((x) => x.state !== 'done' && x.state !== 'skipped')!;
  if (s.state === 'blocked')
    return {
      tone: 'blocked',
      text: `${s.label} on the main path is blocked.`,
      view: s.view,
    };
  return {
    tone: 'next',
    text:
      s.state === 'running'
        ? `${s.label} is in progress on the main path.`
        : `Go to the ${s.label} step on the main path.`,
    view: s.view,
  };
}

/**
 * Whether a page shows the full what's-next line or only the short path summary. The full
 * line is for Projects, where the path happens, and for any page whose line is about the
 * page itself (an approval waiting, no budget yet, no plan connected). Elsewhere it would
 * only repeat the path's step on every page, so a short summary with a link is enough.
 */
export function lineStyle(view: StepView, f: StudioFacts): 'full' | 'short' {
  if (PROJECT_VIEWS.includes(view)) return 'full';
  const text = nextStep(view, f).text;
  const repeats =
    text === pipelineStep(f).text ||
    text === pathStages(f).step.text ||
    (view === 'decisions' && f.pending === 0);
  return repeats ? 'short' : 'full';
}
