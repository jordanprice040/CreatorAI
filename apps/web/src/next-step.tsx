import { useEffect, useRef, useState } from 'react';
import {
  ArtifactSummarySchema,
  EnvelopeSchema,
  FeedbackSchema,
  OverviewSchema,
  PlanConnectionSchema,
  PricingSnapshotSchema,
  ProposalSummarySchema,
  SpecStatusSchema,
  StoredEntitySchema,
  z,
  type Workspace,
} from '@creator/contracts';
import { api, STUDIO_CHANGED } from './oversight.js';
import {
  decisionsNote,
  failedNote,
  feedbackCounts,
  lineStyle,
  nextStep,
  pathBanner,
  pathSpecReviewed,
  workflowCounts,
  type BuildState,
  type StudioFacts,
} from './next-rules.js';
import { productVersions } from './versions.js';
import { buildMark } from './activity-marks.js';
import { artifactForBuild } from './build-defaults.js';
import { placeLabel, type View } from './pages.js';

// The products list as the build page reads it (apps/api/src/products.ts); only what the
// next-step line needs.
const ProductsSchema = z.array(
  z.object({
    product: z.object({
      id: z.string(),
      binding: z.object({ spec_id: z.string(), spec_version: z.number() }),
    }),
    builds: z.array(
      z.object({
        started_at: z.string(),
        state: z.string(),
        commit: z.string().nullable(),
        package: z.object({ state: z.string() }).nullable(),
      }),
    ),
  }),
);

const BUILD_STATES: readonly string[] = [
  'running',
  'checkpoint',
  'failed',
  'interrupted',
];

async function readFacts(
  workspace: Workspace,
  desktop: boolean,
): Promise<StudioFacts> {
  const base = `workspaces/${workspace.id}`;
  const fixture = workspace.record_mode === 'fixture';
  // A list that could not be read gives the Build tab no activity keys (never a false dot).
  let unread = false;
  const [
    overview,
    pricing,
    budgets,
    specs,
    reviews,
    products,
    artifacts,
    plans,
    proposals,
  ] = await Promise.all([
    api(OverviewSchema, `${base}/overview`),
    api(z.array(PricingSnapshotSchema), `${base}/pricing`),
    api(z.array(EnvelopeSchema), `${base}/budgets`),
    api(z.array(StoredEntitySchema), `${base}/entities?kind=specification`),
    api(z.array(StoredEntitySchema), `${base}/entities?kind=humility_review`),
    api(ProductsSchema, `${base}/products`).catch(() => {
      unread = true;
      return [];
    }),
    api(z.array(ArtifactSummarySchema), `${base}/artifacts`).catch(() => {
      unread = true;
      return [];
    }),
    fixture
      ? Promise.resolve(null)
      : api(z.array(PlanConnectionSchema), `${base}/plan-connections`).catch(
          () => null,
        ),
    api(z.array(ProposalSummarySchema), `${base}/proposals`).catch(() => null),
  ]);
  // Freeze state for the specs changed most recently; a long tail of old specs adds nothing.
  const recent = [...specs]
    .sort((a, b) => Date.parse(b.updated_at) - Date.parse(a.updated_at))
    .slice(0, 5);
  const status = await Promise.all(
    recent.map((s) =>
      api(SpecStatusSchema, `${base}/specs/${s.id}`).catch(() => null),
    ),
  );
  const frozen = status.filter((s) => s?.frozen_current);
  // A humility review counts only for the frozen version it reviews (a revision needs its own),
  // and only for the spec the path is about: the most recently changed frozen one.
  const reviewed = pathSpecReviewed(
    frozen.map((s) => ({ id: s!.spec.id, version: s!.spec.version })),
    reviews,
  );
  const steps = workflowCounts(overview.workflows);
  const count = (kind: string) =>
    overview.records.find((r) => r.kind === kind)?.active ?? 0;
  const latest = productVersions(products)[0]?.versions[0];
  const newest = latest?.builds[0];
  // Trying the newest package means recording feedback on it, which finishes the Try stage.
  const pkg =
    latest && newest
      ? artifactForBuild(artifacts, newest, latest.product.binding)
      : undefined;
  const feedback = pkg
    ? await api(z.array(FeedbackSchema), `${base}/artifacts/${pkg.id}/feedback`)
        .then(feedbackCounts)
        .catch(() => undefined)
    : undefined;
  const build: BuildState = !newest
    ? 'none'
    : newest.state === 'verified_candidate'
      ? 'verified'
      : BUILD_STATES.includes(newest.state)
        ? (newest.state as BuildState)
        : 'failed';
  return {
    ...(unread
      ? {}
      : {
          buildKeys: { ws: workspace.id, keys: buildMark(products, artifacts) },
        }),
    fixture,
    owner: workspace.role === 'owner',
    desktop,
    pending: overview.decisions.pending,
    // Only steps someone can still act on block; a failed step is finished and shown as a note.
    attention: steps.attention,
    failed: steps.failed,
    runs: overview.runs.active,
    budgets: budgets.filter((b) => b.status === 'active').length,
    pricing: pricing.length,
    sources: overview.sources.count,
    claims: count('claim'),
    problems: count('problem'),
    alternatives: count('alternative'),
    scorecards: count('scorecard'),
    reviewed,
    specs: specs.length,
    frozenSpecs: frozen.length,
    product: latest
      ? {
          current: frozen.some(
            (s) =>
              s!.spec.id === latest.product.binding.spec_id &&
              s!.spec.version === latest.product.binding.spec_version,
          ),
          build,
          packaging: newest?.package?.state === 'running',
          // Package jobs are forgotten when the API restarts; the Gallery artifact is the record.
          packaged: newest?.package?.state === 'done' || pkg !== undefined,
          ...(feedback ? { feedback } : {}),
        }
      : null,
    artifacts: artifacts.length,
    ...(proposals ? { proposals: proposals.length } : {}),
    selection: {
      count: overview.selections.count,
      route: overview.selections.latest?.route ?? null,
      proposal: overview.selections.latest?.proposal
        ? {
            title: overview.selections.latest.proposal.title,
            unknownCore: overview.selections.latest.proposal.unknown_core,
            reviewed: overview.selections.latest.proposal.reviewed,
            revise: overview.selections.latest.proposal.revise,
          }
        : null,
    },
    planConnections: plans ? plans.length : null,
  };
}

/**
 * The workspace facts behind the what's-next line, the Path tab and the nav badges. Read
 * again whenever the tab changes, after any action the studio sends, and every 15 seconds
 * while the window is visible; a failed read gives null, which hides the line rather than
 * guessing.
 */
export function useStudioFacts(
  workspace: Workspace | null,
  view: View,
  /** The desktop app has no command line yet; read outside its context provider. */
  desktop: boolean,
): StudioFacts | null {
  const [facts, setFacts] = useState<StudioFacts | null>(null);
  const seq = useRef(0);
  useEffect(() => {
    setFacts(null);
  }, [workspace?.id]);
  useEffect(() => {
    if (!workspace) return;
    const read = () => {
      const mine = ++seq.current;
      readFacts(workspace, desktop)
        .then((f) => {
          if (mine === seq.current) setFacts(f);
        })
        .catch(() => {
          if (mine === seq.current) setFacts(null);
        });
    };
    read();
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') read();
    }, 15_000);
    // Any action anywhere in the studio (a form, a button) can move the path on, so read
    // again as soon as one finishes instead of waiting for the next tick.
    let soon: ReturnType<typeof setTimeout> | undefined;
    const changed = () => {
      clearTimeout(soon);
      soon = setTimeout(read, 300);
    };
    window.addEventListener(STUDIO_CHANGED, changed);
    return () => {
      clearInterval(t);
      clearTimeout(soon);
      window.removeEventListener(STUDIO_CHANGED, changed);
      seq.current++;
    };
  }, [workspace?.id, workspace?.role, view, desktop]);
  return facts;
}

const LEAD = { blocked: 'Blocked', clear: 'All clear', next: 'Next' } as const;

/**
 * One line above the tabs: what comes next on this tab, or why it is blocked, with a button
 * to the tab that takes the step, named by page and tab when it is on another page.
 */
export function NextStep({
  facts,
  view,
  open,
}: {
  facts: StudioFacts | null;
  view: View;
  open: (view: View) => void;
}) {
  if (!facts) return null;
  const step = nextStep(view, facts);
  const note = decisionsNote(view, facts);
  const failed = failedNote(view, facts);
  const notes = (
    <>
      {note && (
        <p className="small">
          {note}.{' '}
          <button
            type="button"
            className="text"
            onClick={() => open('decisions')}
          >
            Open {placeLabel('decisions', view)}
          </button>
        </p>
      )}
      {failed && (
        <p className="small">
          {failed}.{' '}
          {view !== 'runs' && (
            <button type="button" className="text" onClick={() => open('runs')}>
              Open {placeLabel('runs', view)}
            </button>
          )}
        </p>
      )}
    </>
  );
  // Outside Projects the line would only repeat the path's step, so it shrinks to a summary,
  // shown in the same Next banner as everywhere else (P-15).
  if (lineStyle(view, facts) === 'short') {
    const path = pathBanner(facts);
    return (
      <aside
        className={`next-step next-${path.tone}`}
        aria-label="What's next on the main path"
      >
        <p>
          <strong>{LEAD[path.tone]}:</strong> {path.text}{' '}
          {path.view !== view && (
            <button
              type="button"
              className="text"
              onClick={() => open(path.view)}
            >
              Open {placeLabel(path.view, view)}
            </button>
          )}
        </p>
        {notes}
      </aside>
    );
  }
  const lead = LEAD[step.tone];
  return (
    <aside
      className={`next-step next-${step.tone}`}
      aria-label="What's next on this page"
    >
      <p>
        <strong>{lead}:</strong> {step.text}{' '}
        {step.action && step.action.view !== view && (
          <button
            type="button"
            className="text"
            onClick={() => open(step.action!.view)}
          >
            Open {placeLabel(step.action.view, view)}
          </button>
        )}
      </p>
      {notes}
    </aside>
  );
}
