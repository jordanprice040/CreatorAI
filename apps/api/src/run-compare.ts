import {
  ContractError,
  RUN_COMPARISON_LABEL,
  RUN_COMPARISON_MAX_BUILDS,
  RUN_COMPARISON_MAX_OPTIONS,
  RunComparisonRequestSchema,
  RunComparisonSchema,
  comparisonCautions,
  parse,
  type Autopilot,
  type RankedCandidate,
  type RunComparison,
  type RunComparisonSide,
  type Selection,
} from '@creator/contracts';
import type { CommandContext, ConnectionStore } from '@creator/db';

// ADR-0120 (F7): two autopilots side by side. Every value is read from the records through the
// store's own reads, each of which checks the caller's role in the workspace, so a caller who
// cannot read either autopilot gets the store's refusal and nothing of the other. No model call,
// no write, no score of its own.

export const RUN_COMPARE_ROUTE =
  /^\/api\/workspaces\/([^/]+)\/(run-comparison)$/;

/** The reads a comparison needs; the studio's store has them all. */
export type RunCompareStore = Pick<
  ConnectionStore,
  | 'getAutopilot'
  | 'getEntity'
  | 'getWebDiscovery'
  | 'getWorkflow'
  | 'getSelection'
  | 'selectionReport'
  | 'proposalDetail'
  | 'listArtifacts'
>;

const ADVANCING = new Set([
  'select_for_build',
  'proceed_to_validation',
  'recommend_alternative',
]);

/** A record the autopilot made that has since gone (redacted or removed) reads as absent. */
async function maybe<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch (e) {
    if (e instanceof ContractError && e.code === 'NOT_FOUND') return null;
    throw e;
  }
}

const seconds = (from: string, to: string) =>
  Math.max(0, Math.round((Date.parse(to) - Date.parse(from)) / 1000));

function ranked(
  candidates: readonly RankedCandidate[],
  selection: Selection | null,
): RunComparisonSide['options']['ranked'] {
  const disposition = (altId: string) =>
    selection?.dispositions.find(
      (d) => d.alternative.id.toLowerCase() === altId.toLowerCase(),
    )?.disposition ?? null;
  return [...candidates]
    .sort((x, y) => (x.rank ?? 1e9) - (y.rank ?? 1e9))
    .slice(0, RUN_COMPARISON_MAX_OPTIONS)
    .map((c) => ({
      id: c.alternative.id,
      title: c.alternative.title,
      kind: c.alternative.kind,
      rank: c.rank,
      score: c.score?.display ?? null,
      disposition: disposition(c.alternative.id),
    }));
}

/** One column: what this autopilot recorded, read now. */
export async function comparisonSide(
  store: RunCompareStore,
  ctx: CommandContext,
  ws: string,
  a: Autopilot,
  now = new Date(),
): Promise<RunComparisonSide> {
  const childIds = (kind: string) => [
    ...new Set(
      a.steps.filter((s) => s.child?.kind === kind).map((s) => s.child!.id),
    ),
  ];
  // The problem: the last step that carried one.
  const problemRef =
    [...a.steps].reverse().find((s) => s.problem)?.problem ??
    a.config.start?.problem ??
    null;
  const problemEntity = problemRef
    ? await maybe(store.getEntity(ctx, ws, problemRef.id))
    : null;
  const problem =
    problemRef && problemEntity
      ? {
          id: problemEntity.entity.id,
          version: problemRef.version,
          title: problemEntity.entity.title,
        }
      : null;

  // Evidence: the web search it ran, and the claims linked to its problem now.
  let leads = 0,
    pagesRead = 0,
    proposed = 0,
    admitted = 0,
    searchRequests = 0;
  const searches = childIds('web_discovery');
  for (const d of searches) {
    const w = await maybe(store.getWebDiscovery(ctx, ws, d));
    if (!w) continue;
    // Review L-2: the search and the reading are plan requests too.
    searchRequests +=
      (w.search_request_id ? 1 : 0) + (w.read_request_id ? 1 : 0);
    leads += w.leads.length;
    pagesRead += w.leads.filter((l) => l.retrieval_state === 'fetched').length;
    proposed += w.proposals.length;
    admitted += w.proposals.filter((p) => p.decision === 'admitted').length;
  }
  const into = problemEntity?.incoming ?? [];

  // The choice and the options: its own selection when it recorded one.
  const selectionId = childIds('selection').at(-1) ?? null;
  // Review L-4: read by id, so a problem with many later selections never hides it.
  const selection = selectionId
    ? await maybe(store.getSelection(ctx, ws, selectionId))
    : null;
  let options: RunComparisonSide['options'];
  if (selection)
    options = {
      scores_from: 'selection',
      count: selection.report.suitability.candidates.length,
      ranked: ranked(selection.report.suitability.candidates, selection),
    };
  else if (
    problemRef &&
    a.steps.some((s) => s.stage === 'assess' || s.stage === 'select')
  ) {
    const report = await maybe(store.selectionReport(ctx, ws, problemRef.id));
    options = report
      ? {
          scores_from: 'current',
          count: report.suitability.candidates.length,
          ranked: ranked(report.suitability.candidates, null),
        }
      : { scores_from: 'none', count: 0, ranked: [] };
  } else options = { scores_from: 'none', count: 0, ranked: [] };

  let choice: RunComparisonSide['choice'] = null;
  const advanced = selection?.dispositions.find((d) =>
    ADVANCING.has(d.disposition),
  );
  const chosenStep = [...a.steps]
    .reverse()
    .find(
      (s) =>
        s.option &&
        (s.stage === 'select' || s.stage === 'proposal' || s.stage === 'spec'),
    );
  if (selection && advanced) {
    const alt = selection.report.suitability.candidates.find(
      (c) =>
        c.alternative.id.toLowerCase() ===
        advanced.alternative.id.toLowerCase(),
    )?.alternative;
    choice = {
      id: advanced.alternative.id,
      title: alt?.title ?? chosenStep?.option?.title ?? '(untitled option)',
      kind: alt?.kind ?? chosenStep?.option?.kind ?? 'unknown',
      disposition: advanced.disposition,
      by: selection.autopilot_id === a.id ? 'autopilot' : 'person',
      rationale: selection.rationale,
    };
  } else if (chosenStep?.option)
    choice = {
      id: chosenStep.option.id,
      title: chosenStep.option.title,
      kind: chosenStep.option.kind,
      disposition: null,
      by: 'unknown',
      rationale: null,
    };

  const proposalId = childIds('proposal').at(-1);
  const pd = proposalId
    ? await maybe(store.proposalDetail(ctx, ws, proposalId))
    : null;
  const proposal = pd
    ? {
        id: pd.proposal.id,
        version: pd.proposal.version,
        title: pd.proposal.title,
      }
    : null;

  // Builds: packages built from a spec written on this autopilot's selection.
  const builds: RunComparisonSide['builds'] = [];
  if (selection) {
    const specSelection = new Map<string, string | null>();
    // Review L-3: newest first, so the cap never drops the current package.
    // Review n-5: one spec read per distinct spec, each its own transaction; fine at today's
    // sizes, a single query if workspaces grow to many packages.
    const arts = [...(await store.listArtifacts(ctx, ws))].sort((x, y) =>
      y.created_at.localeCompare(x.created_at),
    );
    for (const art of arts) {
      if (builds.length >= RUN_COMPARISON_MAX_BUILDS) break;
      if (!specSelection.has(art.spec.id)) {
        const spec = await maybe(store.getEntity(ctx, ws, art.spec.id));
        const sel = (
          spec?.entity.body as { selection_id?: unknown } | undefined
        )?.selection_id;
        specSelection.set(art.spec.id, typeof sel === 'string' ? sel : null);
      }
      if (specSelection.get(art.spec.id)?.toLowerCase() === selection.id)
        builds.push({
          id: art.id,
          state: art.state,
          current: art.current,
          created_at: art.created_at,
        });
    }
  }

  // Requests, money and models from its workflows.
  let attempts = 0,
    planRequests = 0,
    reserved = 0n,
    incurred = 0n,
    unknown = 0n;
  const models = new Set<string>();
  const setup = a.config.resource_setup;
  if (setup.kind !== 'api') models.add(setup.model_id);
  if (a.config.research) models.add(a.config.research.model_id);
  for (const w of childIds('workflow')) {
    const d = await maybe(store.getWorkflow(ctx, ws, w));
    if (!d) continue;
    attempts += d.usage.attempts;
    planRequests += d.subscription_usage?.requests ?? 0;
    reserved += BigInt(d.usage.reserved);
    incurred += BigInt(d.usage.incurred);
    unknown += BigInt(d.usage.unknown);
    for (const r of d.reservations) models.add(r.model_id);
  }

  const end = a.finished_at ?? now.toISOString();
  const working = a.steps.reduce(
    (n, s) => n + seconds(s.started_at, s.finished_at ?? end),
    0,
  );
  const elapsed = seconds(a.created_at, end);

  return {
    autopilot: {
      id: a.id,
      run_id: a.run_id,
      fixture: a.fixture,
      state: a.state,
      stage: a.stage,
      outcome: a.outcome,
      explanation: a.explanation,
      config_hash: a.config_hash,
      policy_version: a.policy_version,
      route: setup.kind,
      models: [...models].sort().slice(0, 10),
      started_at_stage: a.config.start?.stage ?? 'start',
    },
    problem,
    evidence: {
      searched_web: searches.length > 0,
      leads,
      pages_read: pagesRead,
      claims_proposed: proposed,
      claims_admitted: admitted,
      problem_supports: into.filter((l) => l.relation === 'supports').length,
      problem_contradicts: into.filter((l) => l.relation === 'contradicts')
        .length,
    },
    options,
    stops: a.steps
      .filter((s) => s.state === 'stopped')
      .map((s) => ({
        stage: s.stage,
        attempt: s.attempt,
        kind: s.stop_kind ?? null,
        note: s.note,
        decision_id: s.asked ?? null,
        at: s.finished_at ?? s.started_at,
      })),
    choice,
    proposal,
    builds,
    requests: {
      used: a.calls_reserved,
      limit: a.config.limits.max_calls,
      model_attempts: attempts,
      plan_requests: planRequests + searchRequests,
    },
    money: {
      reserved: reserved.toString(),
      incurred: incurred.toString(),
      unknown: unknown.toString(),
    },
    time: {
      started_at: a.created_at,
      finished_at: a.finished_at,
      elapsed_seconds: elapsed,
      working_seconds: Math.min(working, elapsed),
    },
  };
}

/** Two autopilots of one workspace, side by side. Both are read with the caller's own role. */
export async function compareRuns(
  store: RunCompareStore,
  ctx: CommandContext,
  ws: string,
  raw: unknown,
  now = new Date(),
): Promise<RunComparison> {
  const req = parse(RunComparisonRequestSchema, raw);
  if (req.a.toLowerCase() === req.b.toLowerCase())
    throw new ContractError(
      'INVALID_CONTRACT',
      'Pick two different autopilots to compare.',
    );
  // getAutopilot checks the caller may read this workspace and that the autopilot is in it.
  const [x, y] = [
    await store.getAutopilot(ctx, ws, req.a),
    await store.getAutopilot(ctx, ws, req.b),
  ];
  const a = await comparisonSide(store, ctx, ws, x, now);
  const b = await comparisonSide(store, ctx, ws, y, now);
  return parse(
    RunComparisonSchema,
    {
      label: RUN_COMPARISON_LABEL,
      workspace_id: x.workspace_id,
      same_problem: !!a.problem && a.problem.id === b.problem?.id,
      cautions: comparisonCautions(a, b),
      a,
      b,
      read_at: now.toISOString(),
    },
    'INTERNAL_ERROR',
  );
}

/** GET `/api/workspaces/:ws/run-comparison?a=<autopilot>&b=<autopilot>`. Read only. */
export async function runCompareRoutes(r: {
  store: RunCompareStore;
  ctx: CommandContext;
  ws: string;
  method: string;
  url: URL;
  send: (status: number, value: unknown, mutated: boolean) => Promise<boolean>;
}): Promise<boolean> {
  if (r.method !== 'GET') return false;
  const p = r.url.searchParams;
  return r.send(
    200,
    await compareRuns(r.store, r.ctx, r.ws, {
      a: p.get('a') ?? '',
      b: p.get('b') ?? '',
    }),
    false,
  );
}
