import { usePageActive, usePoll } from './page-active.js';
import type { SitesHandoff } from './past-project.js';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  EXPLORATION_TASK_CLASS,
  EnvelopeSchema,
  ExplorationPreviewSchema,
  ExploreScopeSchema,
  GrantSchema,
  PlanConnectionDetailSchema,
  PlanConnectionSchema,
  PricingSnapshotSchema,
  RunControlSchema,
  StartExplorationRequestSchema,
  StoredEntitySchema,
  WORKFLOW_WALL_MAX_SECONDS,
  WorkflowDetailSchema,
  WorkflowSchema,
  isDiscoveryQualified,
  z,
  type ExplorationPacket,
  type ExplorationPreview,
  type ExplorationResult,
  type SearchBriefBody,
  type SessionInfo,
  type Workflow,
  type WorkflowDetail,
  type Workspace,
  forWebDiscovery,
  isQualified,
} from '@creator/contracts';
import { api, message, refusalsOf, when, words } from './oversight.js';
import {
  FixOutcome,
  FixButtons,
  FixRow,
  qualifierFor,
  routeFixes,
  useQualifyOffers,
  type FixContext,
} from './fix-buttons.js';
import { refusalFixes, type FixAction } from './fix-here.js';
import { newestFirst } from './versions.js';
import { OPEN_EXPLORATION } from './autopilot-routes.js';
import { envelopesFor } from './build-defaults.js';
import { Empty, Status, reveal, useLoad, type View } from './ui.js';
import { preferredRoute } from './model-choice.js';
import { missingTaskTexts } from './discover-defaults.js';
import {
  ChoiceNote,
  responsesModels,
  routePlans,
  useModelChoice,
} from './model-switch.js';
import { Explain } from './explain.js';

// C53 "Explore for me" (ADR-0065). No theme: the studio reads claims already recorded here
// and one explorer request proposes a short list of evidenced problems. Application rules
// mark duplicates, excluded topics and thin evidence; a pick becomes a search brief that the
// owner edits in the form below before any discovery run starts.

const list = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);
const hosts = (s: string) =>
  list(s).map((h) =>
    h
      .replace(/^https?:\/\//i, '')
      .replace(/\/.*$/, '')
      .toLowerCase(),
  );
const LIMITS = {
  max_children: 1,
  max_concurrency: 1,
  max_depth: 1 as const,
  max_attempts: 1,
  max_repairs: 1,
  max_calls: 2,
  max_output_tokens: 6000,
  call_timeout_ms: 60_000,
  max_wall_seconds: 600,
};
const DISPOSITION: Record<string, string> = {
  candidate: 'Candidate',
  duplicate: 'Already in the studio',
  insufficient_evidence: 'Not enough evidence',
  excluded: 'Excluded topic',
};
const LIVE = new Set([
  'queued',
  'running',
  'waiting_dependency',
  'waiting_human',
  'paused_operator',
  'reconciling',
]);

export interface ExploredPick {
  brief: { id: string; version: number; body: SearchBriefBody };
  /** Cited claims, and whether each one weighs against the problem. */
  claims: { claim_id: string; contrary: boolean }[];
}

const clip = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;
const hostOf = (url: string) => {
  try {
    return new URL(url).hostname;
  } catch {
    return url;
  }
};

export function Explore({
  session,
  workspace,
  onUse,
  open,
  sites = null,
}: {
  session: SessionInfo;
  workspace: Workspace;
  onUse: (pick: ExploredPick) => void;
  open: (view: View, id?: string) => void;
  /** F9 (ADR-0125): websites copied from a past project's exploration. */
  sites?: SitesHandoff;
}) {
  const base = `workspaces/${workspace.id}`;
  // ADR-0087: the server's discovery benchmarks, so a fix can qualify a discovery task.
  useQualifyOffers(base);
  const fixture = workspace.record_mode === 'fixture';
  const ctx = useLoad(async () => {
    const [workflows, envelopes, pricing, connections, claims] =
      await Promise.all([
        api(z.array(WorkflowSchema), `${base}/workflows`),
        api(z.array(EnvelopeSchema), `${base}/budgets`),
        api(z.array(PricingSnapshotSchema), `${base}/pricing`),
        api(z.array(PlanConnectionSchema), `${base}/plan-connections`).catch(
          () => [],
        ),
        api(
          z.array(StoredEntitySchema),
          `${base}/entities?kind=claim&status=active`,
        ),
      ]);
    const details = (
      await Promise.all(
        connections.map((c) =>
          api(
            PlanConnectionDetailSchema.passthrough(),
            `${base}/plan-connections/${c.id}`,
          ).catch(() => null),
        ),
      )
    ).filter((d) => d !== null);
    return {
      explorations: newestFirst(
        workflows.filter((w) => w.role === 'r01_exploration'),
      ).slice(0, 8),
      envelopes: envelopesFor(
        newestFirst(envelopes.filter((e) => e.status === 'active')),
        '',
      ),
      pricing: newestFirst(pricing),
      details,
      claims: claims.length,
    };
  }, [workspace.id]);

  const [interests, setInterests] = useState('');
  const [groups, setGroups] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [only, setOnly] = useState('');
  const [skip, setSkip] = useState('');
  useEffect(() => {
    if (!sites) return;
    if (sites.only !== undefined) setOnly(sites.only);
    if (sites.skip !== undefined) setSkip(sites.skip);
  }, [sites?.nonce]);
  const [maxCandidates, setMaxCandidates] = useState(3);
  const [maxClaims, setMaxClaims] = useState(30);
  const [resourceKind, setResourceKind] = useState<'subscription' | 'api'>(
    fixture ? 'api' : 'subscription',
  );
  const [connectionId, setConnectionId] = useState('');
  const [planModel, setPlanModel] = useState('');
  const [dataClass, setDataClass] = useState<
    'synthetic' | 'public' | 'private_approved'
  >(fixture ? 'synthetic' : 'public');
  /** Claims the owner chose not to send, with their text so they can be sent again. */
  const [leaveOut, setLeaveOut] = useState<Map<string, string>>(new Map());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorFixes, setErrorFixes] = useState<FixAction[]>([]);
  const [openId, setOpenId] = useState('');
  const [openedAt, setOpenedAt] = useState('');
  // The autopilot's stopped card opens its exploration here. Only the Explore on the page in
  // view answers (kept-alive pages and Chat cards have their own), inside its own section.
  const active = usePageActive();
  const activeRef = useRef(active);
  activeRef.current = active;
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    const open = (e: Event) => {
      const { id, at } = (e as CustomEvent<{ id: string; at: string }>).detail;
      if (!id || !activeRef.current || !sectionRef.current) return;
      setOpenId(id);
      setOpenedAt(at);
      ctx.refresh();
      reveal(sectionRef.current, 'explore-title');
    };
    window.addEventListener(OPEN_EXPLORATION, open);
    return () => window.removeEventListener(OPEN_EXPLORATION, open);
  }, [workspace.id]);

  const c = ctx.data;
  // ADR-0081: with nothing picked here, start from the current model in the top bar.
  const choice = useModelChoice(workspace);
  const first = c?.details[0];
  const route = preferredRoute(
    routePlans(c?.details ?? [], [EXPLORATION_TASK_CLASS], dataClass),
    choice,
    [EXPLORATION_TASK_CLASS],
    {
      connection: first?.connection.id ?? '',
      model: first ? (responsesModels(first)[0] ?? '') : '',
    },
  );
  const plan = c?.details.find(
    (p) => p.connection.id === (connectionId || route.connection),
  );
  const verified =
    plan?.model_access.filter(
      (a) => a.path === 'responses' && a.access === 'verified',
    ) ?? [];
  const model =
    (verified.some((a) => a.model_id === planModel) ? planModel : '') ||
    (plan && plan.connection.id === route.connection ? route.model : '') ||
    verified[0]?.model_id ||
    '';
  const routeShown =
    !connectionId && !planModel
      ? route
      : { ...route, fromChoice: false, choiceUnavailable: false };
  const envelope = c?.envelopes[0];
  const price = c?.pricing[0];
  const timeout =
    plan?.connection.settings.caps.responses.request_timeout_ms ??
    LIMITS.call_timeout_ms;
  const limits =
    resourceKind === 'subscription'
      ? {
          ...LIMITS,
          call_timeout_ms: timeout,
          max_wall_seconds: Math.min(
            WORKFLOW_WALL_MAX_SECONDS,
            Math.max(
              LIMITS.max_wall_seconds,
              Math.ceil((2 * timeout) / 1000) + 60,
            ),
          ),
        }
      : { ...LIMITS, call_timeout_ms: 30_000 };
  const scope = {
    interests: list(interests),
    target_groups: list(groups),
    exclusions: list(exclusions),
    only_hosts: hosts(only),
    excluded_hosts: hosts(skip),
    max_candidates: maxCandidates,
    max_claims: maxClaims,
    max_age_days: 180,
    leave_out: [...leaveOut.keys()],
  };
  const scopeCheck = ExploreScopeSchema.safeParse(scope);
  // What this scope would send now (PR #131 review L-2), read again when the scope changes.
  const scopeKey = JSON.stringify(scope);
  const [preview, setPreview] = useState<{
    key: string;
    data: ExplorationPreview | null;
    error: string;
  } | null>(null);
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!scopeCheck.success) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(() => {
      api(ExplorationPreviewSchema, `${base}/exploration-preview`, {
        csrf: session.csrf_token,
        body: scope,
      }).then(
        (data) =>
          seq === previewSeq.current &&
          setPreview({ key: scopeKey, data, error: '' }),
        (e) =>
          seq === previewSeq.current &&
          setPreview({ key: scopeKey, data: null, error: message(e) }),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [scopeKey, workspace.id, ctx.data]);
  const current = preview?.key === scopeKey ? preview : null;
  const packet = current?.data?.packet;
  const request = {
    scope,
    resource_setup:
      resourceKind === 'subscription'
        ? {
            kind: 'subscription' as const,
            connection_id: plan?.connection.id ?? '',
            model_id: model,
            settings_hash: plan?.connection.settings_hash ?? '',
            max_output_chars:
              plan?.connection.settings.caps.responses.max_output_chars ??
              16000,
          }
        : {
            kind: 'api' as const,
            envelope_id: envelope?.id ?? '',
            pricing_snapshot_id: price?.id ?? '',
          },
    data_class: dataClass,
    limits,
  };
  // As the server admits Explore (P27 review L-4): the discovery role's newest decided
  // qualification counts, so a later failure withdraws a pass (ADR-0052), and a
  // web-discovery qualification does not count (ADR-0086).
  const explorationQualified = Boolean(
    plan &&
    isDiscoveryQualified(plan.qualifications, model, EXPLORATION_TASK_CLASS),
  );
  const blockers =
    resourceKind === 'subscription'
      ? [
          ...(plan?.blockers ?? [
            'Add and verify a plan connection under Models and connections.',
          ]),
          ...(plan && !model ? ['No verified model on this connection.'] : []),
          ...(plan &&
          !plan.connection.settings.allowed_data_classes.includes(dataClass)
            ? ['This connection does not permit the selected sharing class.']
            : []),
          ...(plan && model && !explorationQualified
            ? [
                // P23 item 8: name the reason when the task is not allowed here at all,
                // and only fixes that exist (review of PR #172, M-1).
                ...missingTaskTexts(
                  model,
                  [EXPLORATION_TASK_CLASS],
                  plan.connection.settings.allowed_task_classes,
                ),
                // ADR-0086: a web-discovery qualification is also research synthesis but
                // covers only Search the web; say so, since Models lists it as qualified.
                ...(isQualified(
                  forWebDiscovery(plan.qualifications),
                  model,
                  EXPLORATION_TASK_CLASS,
                )
                  ? [
                      'Its web-discovery qualification covers only Search the web; Explore for me needs “research synthesis for discovery” under Qualify a model.',
                    ]
                  : []),
              ]
            : []),
        ]
      : [
          ...(envelope ? [] : ['No active shared budget (Monitor › Budgets).']),
          ...(price ? [] : ['No pricing snapshot (Monitor › Budgets).']),
        ];
  // ADR-0087 (P27): the owner fixes the route's refusals here, without leaving Explore.
  const fixes: FixContext = {
    base,
    place: 'explore',
    csrf: session.csrf_token,
    owner: workspace.role === 'owner',
    onDone: () => ctx.refresh(),
  };
  const blockerFixes =
    resourceKind === 'subscription'
      ? routeFixes({
          plan,
          dataClass,
          model,
          missing:
            plan && !explorationQualified ? [EXPLORATION_TASK_CLASS] : [],
          role: 'discovery',
        })
      : [];
  const scopeIssues = scopeCheck.success
    ? []
    : scopeCheck.error.issues.map((i) => i.message);
  const ready =
    !busy &&
    !!packet &&
    workspace.role === 'owner' &&
    scopeIssues.length === 0 &&
    blockers.length === 0 &&
    StartExplorationRequestSchema.safeParse(request).success;

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
    setErrorFixes([]);
    // What a refused start leaves behind is undone (PR #131 review L-1).
    let runId = '';
    let grant: { id: string; version: number } | null = null;
    try {
      const stamp = new Date().toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const run = await api(StoredEntitySchema, `${base}/entities`, {
        csrf: session.csrf_token,
        body: {
          kind: 'run',
          title: `Explore for me · ${stamp}`,
          body: {
            state: 'queued',
            experiment_condition: 'human_in_loop',
            discovery_method: 'structured',
            config_hash: null,
          },
        },
      });
      const control = await api(RunControlSchema, `${base}/runs`, {
        csrf: session.csrf_token,
        body: {
          run: { id: run.id, version: 1 },
          autonomy_mode: 'human_in_loop',
          stage_gates: null,
          initial_grants: [],
        },
      });
      runId = control.run_id;
      grant = await api(GrantSchema, `${base}/grants`, {
        csrf: session.csrf_token,
        body: {
          run_id: control.run_id,
          action_types: ['model.generate'],
          target_kind: null,
          max_amount_nano_usd:
            resourceKind === 'subscription' ? null : '2000000000',
          allow_irreversible: false,
          allow_external_effects: false,
          data_classes: [dataClass],
          expires_at: new Date(Date.now() + 86_400_000).toISOString(),
          rationale:
            'The one explorer request of “Explore for me”, granted from Discover.',
        },
      });
      const started = await api(
        WorkflowDetailSchema,
        `${base}/runs/${control.run_id}/explorations`,
        {
          csrf: session.csrf_token,
          body: { ...request, preview_hash: current?.data?.preview_hash },
          timeoutMs: 30_000,
        },
      );
      setOpenId(started.workflow.id);
      ctx.refresh();
    } catch (err) {
      // A start that timed out here may still have begun on the server: if the run has an
      // exploration, show it instead of undoing it (PR #131 re-review R-N1).
      const begun = runId
        ? await api(z.array(WorkflowSchema), `${base}/workflows`)
            .then((all) =>
              all.find(
                (w) => w.run_id === runId && w.role === 'r01_exploration',
              ),
            )
            .catch(() => undefined)
        : undefined;
      if (begun) {
        setOpenId(begun.id);
        ctx.refresh();
        return;
      }
      setError(message(err));
      setErrorFixes(
        refusalFixes(
          refusalsOf(err),
          'discovery',
          plan ? qualifierFor('discovery', plan.connection) : () => false,
        ),
      );
      // A changed preview is read again so the owner can check it before retrying.
      ctx.refresh();
      const undo = 'Explore for me did not start.';
      if (grant)
        await api(GrantSchema, `${base}/grants/${grant.id}/revoke`, {
          csrf: session.csrf_token,
          body: { expected_version: grant.version, reason: undo },
        }).catch(() => undefined);
      if (runId)
        await api(RunControlSchema, `${base}/runs/${runId}/cancel`, {
          csrf: session.csrf_token,
          body: { reason: undo },
        }).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const shown = openId || c?.explorations[0]?.id || '';
  return (
    <section
      className="explore"
      aria-labelledby="explore-title"
      ref={sectionRef}
    >
      <h3 id="explore-title">Explore for me</h3>
      <Explain
        short="No theme needed: the studio proposes problems from the claims you already have."
        className=""
      >
        No theme needed. The studio reads the claims already recorded in this
        workspace (newest first) and asks one model for up to {maxCandidates}{' '}
        specific problems, each citing those claims. App rules then mark
        duplicates, excluded topics and thin evidence. Nothing is fetched, built
        or sent anywhere else, and an empty answer is a real answer.
      </Explain>
      <Status
        loading={ctx.loading}
        error={ctx.error}
        stale={ctx.stale}
        retry={ctx.reload}
      >
        {c && (
          <>
            {c.claims === 0 && (
              <p className="notice">
                This workspace has no recorded claims yet, so the explorer can
                only suggest directions to research. Add sources and claims
                under Evidence for evidenced problems.
              </p>
            )}
            <form onSubmit={(e) => void start(e)} noValidate>
              <details>
                <summary>Narrow it (optional)</summary>
                <div className="two">
                  <div>
                    <label htmlFor="x-interests">Interests or fields</label>
                    <input
                      id="x-interests"
                      placeholder="e.g. scheduling, small clinics"
                      value={interests}
                      onChange={(e) => setInterests(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="x-groups">Who it might help</label>
                    <input
                      id="x-groups"
                      placeholder="e.g. volunteers, students"
                      value={groups}
                      onChange={(e) => setGroups(e.target.value)}
                    />
                  </div>
                </div>
                <label htmlFor="x-exclusions">Topics to leave out</label>
                <input
                  id="x-exclusions"
                  placeholder="Separate with commas"
                  value={exclusions}
                  onChange={(e) => setExclusions(e.target.value)}
                />
                <div className="two">
                  <div>
                    <label htmlFor="x-only">
                      Only claims from these websites
                    </label>
                    <input
                      id="x-only"
                      placeholder="www.example.org, *.example.gov"
                      value={only}
                      onChange={(e) => setOnly(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="x-skip">
                      Skip claims citing these websites
                    </label>
                    <input
                      id="x-skip"
                      value={skip}
                      onChange={(e) => setSkip(e.target.value)}
                    />
                  </div>
                </div>
                <div className="two">
                  <div>
                    <label htmlFor="x-max">Problems to propose</label>
                    <select
                      id="x-max"
                      value={maxCandidates}
                      onChange={(e) => setMaxCandidates(Number(e.target.value))}
                    >
                      {[1, 2, 3, 4, 5].map((n) => (
                        <option key={n} value={n}>
                          Up to {n}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label htmlFor="x-claims">Claims to read</label>
                    <select
                      id="x-claims"
                      value={maxClaims}
                      onChange={(e) => setMaxClaims(Number(e.target.value))}
                    >
                      {[10, 20, 30].map((n) => (
                        <option key={n} value={n}>
                          Newest {n}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </details>
              <details>
                <summary>
                  Model access:{' '}
                  {resourceKind === 'subscription'
                    ? `${plan?.connection.label ?? 'no plan connection'}${model ? ` · ${model}` : ''} · $0`
                    : 'API / fixture budget'}
                </summary>
                <label htmlFor="x-route">Route</label>
                <select
                  id="x-route"
                  value={resourceKind}
                  onChange={(e) =>
                    setResourceKind(e.target.value as typeof resourceKind)
                  }
                >
                  <option value="subscription">
                    Plan connection · subscription quota, $0
                  </option>
                  <option value="api">
                    API / fixture · budget and pricing
                  </option>
                </select>
                {resourceKind === 'subscription' && (
                  <div className="two">
                    <div>
                      <label htmlFor="x-conn">Connection</label>
                      <select
                        id="x-conn"
                        value={plan?.connection.id ?? ''}
                        onChange={(e) => {
                          setConnectionId(e.target.value);
                          setPlanModel('');
                        }}
                      >
                        {!c.details.length && (
                          <option value="">No plan connection</option>
                        )}
                        {c.details.map((p) => (
                          <option key={p.connection.id} value={p.connection.id}>
                            {p.connection.label}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label htmlFor="x-model">Verified model</label>
                      <select
                        id="x-model"
                        value={model}
                        onChange={(e) => setPlanModel(e.target.value)}
                      >
                        {!model && <option value="">No verified model</option>}
                        {verified.map((a) => (
                          <option key={a.model_id} value={a.model_id}>
                            {a.model_id}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                )}
                {resourceKind === 'subscription' && (
                  <ChoiceNote
                    route={routeShown}
                    choice={choice}
                    task="Explore"
                    labelOf={(id) =>
                      c.details.find((p) => p.connection.id === id)?.connection
                        .label ?? id
                    }
                    onUse={(conn, m) => {
                      setConnectionId(conn);
                      setPlanModel(m);
                    }}
                  />
                )}
                <label htmlFor="x-class">Evidence sharing class</label>
                <select
                  id="x-class"
                  value={dataClass}
                  onChange={(e) =>
                    setDataClass(e.target.value as typeof dataClass)
                  }
                >
                  <option value="synthetic">Synthetic</option>
                  <option value="public">Public</option>
                  <option value="private_approved">
                    Private · approved provider sharing required
                  </option>
                </select>
                <p className="small">
                  {resourceKind === 'subscription'
                    ? `One request on your plan (plus one retry if the answer is malformed), within the connection's accepted caps. No API spending and no paid fallback.`
                    : `Metered under ${envelope?.name ?? 'no budget'}; at most two calls.`}{' '}
                  Starting registers a new run with a 24-hour permission for
                  this request only; if the start is refused, both are closed
                  again.
                </p>
              </details>
              <Preview
                preview={preview}
                stale={!current}
                dataClass={dataClass}
                model={
                  resourceKind === 'subscription' ? model : 'the API model'
                }
                leaveOut={leaveOut}
                setLeaveOut={setLeaveOut}
              />
              {[...scopeIssues, ...blockers].length > 0 && (
                <ul className="error small">
                  {[...scopeIssues, ...blockers].map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {blockers.length > 0 && (
                <FixRow acts={blockerFixes} fix={fixes} />
              )}
              <FixOutcome fix={fixes} />
              {workspace.role !== 'owner' && (
                <p className="small">Only the workspace owner can explore.</p>
              )}
              <button className="primary" type="submit" disabled={!ready}>
                {busy ? 'Starting…' : 'Explore for me'}
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
                  <FixButtons acts={errorFixes} fix={fixes} />
                </p>
              )}
            </form>
            {c.explorations.length > 0 && (
              <>
                <label htmlFor="x-pick">Explorations</label>
                <select
                  id="x-pick"
                  value={shown}
                  onChange={(e) => setOpenId(e.target.value)}
                >
                  {c.explorations.map((w) => (
                    <option key={w.id} value={w.id}>
                      {when(w.created_at)} · {words(w.state)}
                    </option>
                  ))}
                  {shown && !c.explorations.some((w) => w.id === shown) && (
                    <option value={shown}>
                      {openedAt ? `${when(openedAt)} · ` : ''}opened from the
                      autopilot
                    </option>
                  )}
                </select>
              </>
            )}
            {shown && (
              <Exploration
                key={shown}
                base={base}
                session={session}
                id={shown}
                fixture={fixture}
                owner={workspace.role !== 'viewer'}
                onUse={onUse}
                open={open}
                onFinished={ctx.refresh}
              />
            )}
          </>
        )}
      </Status>
    </section>
  );
}

/** One exploration: live state while it runs, then the shortlist and what was not read. */
function Exploration({
  base,
  session,
  id,
  fixture,
  owner,
  onUse,
  onFinished,
  open,
}: {
  base: string;
  session: SessionInfo;
  id: string;
  fixture: boolean;
  owner: boolean;
  onUse: (pick: ExploredPick) => void;
  onFinished: () => void;
  open: (view: View, id?: string) => void;
}) {
  const d = useLoad(
    () => api(WorkflowDetailSchema, `${base}/workflows/${id}`),
    [id],
  );
  const wf: Workflow | undefined = d.data?.workflow;
  const live = wf ? LIVE.has(wf.state) : false;
  // PR #191 review R-L1: polled while shown, and a failed read keeps polling (it shows stale).
  usePoll(d.refresh, 2000, live);
  useEffect(() => {
    if (wf?.finished_at) onFinished();
  }, [wf?.finished_at]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState<ExplorationPacket | null>(null);

  async function showSent() {
    if (sent) return setSent(null);
    setBusy('packet');
    setError('');
    try {
      const r = await api(
        z.object({ packet: z.unknown() }).passthrough(),
        `${base}/workflows/${id}/exploration-packet`,
      );
      setSent(r.packet as ExplorationPacket);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }

  async function cancel(detail: WorkflowDetail) {
    setBusy('cancel');
    setError('');
    try {
      await api(WorkflowDetailSchema, `${base}/workflows/${id}/cancel`, {
        csrf: session.csrf_token,
        body: {
          expected_version: detail.workflow.version,
          reason: 'Stopped from Explore for me.',
        },
      });
      d.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }
  async function use(entry: ExplorationResult['candidates'][number]) {
    setBusy(entry.ref);
    setError('');
    try {
      const made = await api(
        z.object({ brief: StoredEntitySchema, created: z.boolean() }),
        `${base}/workflows/${id}/explored-briefs`,
        {
          csrf: session.csrf_token,
          body: { candidate: entry.ref, reason: 'Chosen in Explore for me.' },
        },
      );
      onUse({
        brief: {
          id: made.brief.id,
          version: made.brief.version,
          body: made.brief.body as SearchBriefBody,
        },
        claims: entry.claims.map((x) => ({
          claim_id: x.claim_id,
          contrary: x.contrary,
        })),
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy('');
    }
  }

  return (
    <Status
      loading={d.loading}
      error={d.error}
      stale={d.stale}
      retry={d.reload}
    >
      {d.data && wf && (
        <div className="exploration" aria-live="polite">
          {live ? (
            <p className="notice">
              Exploring… {words(wf.reason)}.{' '}
              {owner && (
                <button
                  type="button"
                  className="text"
                  disabled={!!busy}
                  onClick={() => void cancel(d.data!)}
                >
                  Stop
                </button>
              )}
            </p>
          ) : (
            <Result
              result={wf.result?.exploration ?? null}
              explanation={wf.result?.explanation ?? wf.reason}
              fixture={fixture || wf.fixture}
              owner={owner}
              busy={busy}
              onUse={(e) => void use(e)}
              open={open}
            />
          )}
          <p>
            <button
              type="button"
              className="text"
              disabled={busy === 'packet'}
              onClick={() => void showSent()}
            >
              {sent
                ? 'Hide what was sent'
                : busy === 'packet'
                  ? 'Reading…'
                  : 'Show what was sent to the model'}
            </button>
          </p>
          {sent && <Sent packet={sent} />}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </Status>
  );
}

function Result({
  result,
  explanation,
  fixture,
  owner,
  busy,
  onUse,
  open,
}: {
  result: ExplorationResult | null;
  explanation: string;
  fixture: boolean;
  owner: boolean;
  busy: string;
  onUse: (e: ExplorationResult['candidates'][number]) => void;
  open: (view: View, id?: string) => void;
}) {
  if (!result) return <p className="error">{explanation}</p>;
  const order = (x: { disposition: string }) =>
    x.disposition === 'candidate' ? 0 : 1;
  const cards = [...result.candidates].sort((a, b) => order(a) - order(b));
  return (
    <>
      <p>
        <strong>{explanation}</strong>
        {fixture && ' Fixture explorer: rules over the packet, not reasoning.'}
      </p>
      {result.summary && <p className="small">{result.summary}</p>}
      {!cards.length && (
        <Empty>No problem was proposed from the claims read.</Empty>
      )}
      <ol className="shortlist">
        {cards.map((e) => (
          <li key={e.ref} className={`card ${e.disposition}`}>
            <h4>
              {e.title}{' '}
              <span
                className={`badge ${e.disposition === 'candidate' ? 'ok' : ''}`}
              >
                {DISPOSITION[e.disposition]}
              </span>
            </h4>
            <dl>
              <dt>Who</dt>
              <dd>{e.card.affected_users}</dd>
              <dt>Problem</dt>
              <dd>{e.card.observable_pain}</dd>
              <dt>Why this</dt>
              <dd>{e.card.why_chosen}</dd>
              {e.card.current_alternatives.length > 0 && (
                <>
                  <dt>Today</dt>
                  <dd>{e.card.current_alternatives.join('; ')}</dd>
                </>
              )}
              <dt>Measure</dt>
              <dd>{e.card.outcome_measure}</dd>
              <dt>Next question</dt>
              <dd>{e.card.next_question}</dd>
              <dt>Uncertainty</dt>
              <dd>{e.card.uncertainty}</dd>
              <dt>Evidence</dt>
              <dd>
                <ul className="cited">
                  {e.claims.map((x) => (
                    <li key={`${x.ref}-${x.contrary}`}>
                      <button
                        type="button"
                        className="text"
                        title="Open this claim under Sources"
                        onClick={() => open('evidence', `claim:${x.claim_id}`)}
                      >
                        {clip(x.statement, 160)}
                      </button>{' '}
                      <span className="small">
                        {words(x.status)}
                        {x.contrary && (
                          <strong className="against"> · weighs against</strong>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              </dd>
            </dl>
            <ul className="small">
              {e.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
            {e.disposition === 'candidate' && owner && (
              <button
                type="button"
                className="secondary"
                disabled={!!busy}
                onClick={() => onUse(e)}
              >
                {busy === e.ref ? 'Making the brief…' : 'Use as a brief'}
              </button>
            )}
          </li>
        ))}
      </ol>
      {result.directions.length > 0 && (
        <>
          <h4>Directions to research (not evidenced yet)</h4>
          <ul className="small">
            {result.directions.map((x, i) => (
              <li key={i}>
                <strong>{x.direction}.</strong> {x.why} Question: {x.question}
              </li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>What was not read or assessed</summary>
        <ul className="small">
          {[...result.not_searched.notes, ...result.not_covered].map((n, i) => (
            <li key={i}>{n}</li>
          ))}
        </ul>
      </details>
    </>
  );
}

/**
 * What this scope would send now: counts, every claim with its websites (each can be left
 * out) and the existing records compared for duplicates (PR #131 review L-2).
 */
function Preview({
  preview,
  stale,
  dataClass,
  model,
  leaveOut,
  setLeaveOut,
}: {
  preview: { data: ExplorationPreview | null; error: string } | null;
  /** The scope changed and is being read again; the last result stays open meanwhile. */
  stale: boolean;
  dataClass: string;
  model: string;
  leaveOut: Map<string, string>;
  setLeaveOut: (m: Map<string, string>) => void;
}) {
  if (!preview) return <p className="small">Reading what would be sent…</p>;
  if (!preview.data)
    return stale ? (
      <p className="small">Reading what would be sent…</p>
    ) : (
      <p className="error small" role="alert">
        {preview.error}
      </p>
    );
  const { packet, chars, limit } = preview.data;
  const toggle = (id: string, text: string) => {
    const next = new Map(leaveOut);
    if (next.has(id)) next.delete(id);
    else next.set(id, text);
    setLeaveOut(next);
  };
  return (
    <details className="preview">
      <summary>
        Sends {packet.claims.length} claim
        {packet.claims.length === 1 ? '' : 's'} and {packet.catalog.length}{' '}
        existing record{packet.catalog.length === 1 ? '' : 's'} to{' '}
        {model || 'the model'} ({chars.toLocaleString()} of{' '}
        {limit.toLocaleString()} characters)
        {stale && ' · updating…'}
      </summary>
      <p className="small">
        Everything listed goes to the model provider as {words(dataClass)}{' '}
        evidence. Leave out any claim that may not be shared that way.
      </p>
      <ul className="sent">
        {packet.claims.map((c) => (
          <li key={c.claim_id}>
            <label className="claim-attach">
              <input
                type="checkbox"
                checked
                onChange={() => toggle(c.claim_id, c.statement)}
              />
              <span>
                {clip(c.statement, 200)}{' '}
                <span className="small">
                  {words(c.status)} ·{' '}
                  {[...new Set(c.passages.map((x) => hostOf(x.url)))].join(
                    ', ',
                  )}
                </span>
              </span>
            </label>
          </li>
        ))}
        {[...leaveOut].map(([id, text]) => (
          <li key={id} className="left-out">
            <label className="claim-attach">
              <input
                type="checkbox"
                checked={false}
                onChange={() => toggle(id, text)}
              />
              <span>
                <s>{clip(text, 200)}</s> <span className="small">left out</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      {packet.catalog.length > 0 && (
        <p className="small">
          Shown to the explorer as already in the studio:{' '}
          {packet.catalog.map((k) => clip(k.title, 60)).join('; ')}
        </p>
      )}
      <ul className="small">
        {packet.not_searched.notes.map((n, i) => (
          <li key={i}>{n}</li>
        ))}
      </ul>
    </details>
  );
}

/** The packet an exploration read, as it was sent. */
function Sent({ packet }: { packet: ExplorationPacket }) {
  return (
    <div className="preview">
      <p className="small">
        {packet.claims.length} claim{packet.claims.length === 1 ? '' : 's'} and{' '}
        {packet.catalog.length} existing record
        {packet.catalog.length === 1 ? '' : 's'}, assessed{' '}
        {when(packet.assessed_at)}.
      </p>
      <ul className="sent">
        {packet.claims.map((c) => (
          <li key={c.claim_id}>
            <strong>{c.ref}</strong> {clip(c.statement, 200)}{' '}
            <span className="small">
              {words(c.status)} ·{' '}
              {[...new Set(c.passages.map((x) => hostOf(x.url)))].join(', ')}
            </span>
          </li>
        ))}
      </ul>
      {packet.catalog.length > 0 && (
        <p className="small">
          Shown to the explorer as already in the studio:{' '}
          {packet.catalog.map((k) => clip(k.title, 60)).join('; ')}
        </p>
      )}
    </div>
  );
}
