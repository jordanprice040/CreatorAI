import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ClaimEvidenceSchema,
  PlanConnectionSchema,
  PlanConnectionDetailSchema,
  DISCOVERY_TASK_CLASSES,
  EnvelopeSchema,
  EvidenceRoleSchema,
  GrantSchema,
  NAE_GRAND_CHALLENGES,
  PricingSnapshotSchema,
  ResponseTypeSchema,
  RunControlSchema,
  SearchBriefBodySchema,
  StartDiscoveryRequestSchema,
  StoredEntitySchema,
  WorkflowDetailSchema,
  WorkflowSchema,
  z,
  type ClaimEvidence,
  type EvidenceRole,
  type ResponseType,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, words } from './oversight.js';
import { NO_CLI_IN_DESKTOP, useDesktopApp } from './desktop-app.js';
import { money } from './budgets.js';
import { ThemeIntent } from './theme-intent.js';
import { Empty, Status, shortId, useLoad, type View } from './ui.js';
import { usePageActive } from './page-drafts.js';

const lines = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);
const LIVE = [
  'queued',
  'running',
  'waiting_dependency',
  'waiting_human',
  'paused_operator',
  'reconciling',
];
const ROLE_LABEL: Record<EvidenceRole, string> = {
  problem: 'the problem',
  affected_users: 'who is affected',
  urgency: 'urgency',
  workaround: 'current workaround',
  existing_tool: 'an existing tool',
  tool_gap: 'a tool gap',
  data: 'available data',
  mechanism: 'a cross-field mechanism',
};
const LIMITS = {
  max_children: 5,
  max_concurrency: 2,
  max_depth: 1,
  max_attempts: 1,
  max_repairs: 1,
  max_calls: 24,
  max_output_tokens: 4000,
  call_timeout_ms: 10_000,
  max_wall_seconds: 900,
};

const FIELD_NAMES: Record<string, string> = {
  theme: 'Theme',
  fields: 'Fields',
  target_users: 'Target users',
  measurable_problem: 'Measurable problem',
  outcome_measure: 'What would be measured',
  data_and_tools: 'Data and tools',
  time_limit: 'Time limit',
  budget_limit: 'Budget limit',
  constraints: 'Constraints',
  context: 'Context',
};
const fieldName = (path: PropertyKey[]) =>
  path[0] === 'fields' && typeof path[1] === 'number'
    ? path[1] === 0
      ? 'First field'
      : 'Second field'
    : (FIELD_NAMES[String(path[0] ?? '')] ?? words(String(path[0] ?? 'brief')));
/** Validation messages in words a person would use. */
const plain = (m: string) =>
  /expected (string|array) to have >=1/.test(m)
    ? 'required'
    : /expected string to have <=/.test(m)
      ? 'too long'
      : m;

/**
 * Submits a theme as a versioned search brief and starts a discovery run on the server.
 * Evidence comes from claims already recorded with sources; the locator does not search the
 * web itself. Every response type is either run or left out with a reason.
 */
export function Submit({
  session,
  workspace,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  open: (view: View, id?: string) => void;
}) {
  const desktop = useDesktopApp();
  const base = `workspaces/${workspace.id}`;
  const ctx = useLoad(async () => {
    let connectionError = '';
    const [claims, runs, workflows, envelopes, pricing, connections] =
      await Promise.all([
        api(
          z.array(StoredEntitySchema),
          `${base}/entities?kind=claim&status=active`,
        ),
        api(z.array(RunControlSchema), `${base}/runs`),
        api(z.array(WorkflowSchema), `${base}/workflows`),
        api(z.array(EnvelopeSchema), `${base}/budgets`),
        api(z.array(PricingSnapshotSchema), `${base}/pricing`),
        api(z.array(PlanConnectionSchema), `${base}/plan-connections`).catch(
          (e) => {
            connectionError = `Could not load connections: ${message(e)}`;
            return [];
          },
        ),
      ]);
    const planDetails = await Promise.all(
      connections.map((conn) =>
        api(
          PlanConnectionDetailSchema.passthrough(),
          `${base}/plan-connections/${conn.id}`,
        ).catch((e) => {
          connectionError = `Could not load connection details: ${message(e)}`;
          return null;
        }),
      ),
    );
    const evidence = new Map<string, ClaimEvidence>();
    await Promise.all(
      claims.map((c) =>
        api(ClaimEvidenceSchema, `${base}/claims/${c.id}/evidence`)
          .then((e) => evidence.set(c.id, e))
          .catch(() => undefined),
      ),
    );
    const busy = new Set(
      workflows.filter((w) => LIVE.includes(w.state)).map((w) => w.run_id),
    );
    return {
      claims,
      evidence,
      runs: runs.filter(
        (r) =>
          r.state === 'active' &&
          r.autonomy_mode !== 'human_only' &&
          !busy.has(r.run_id),
      ),
      envelopes: envelopes.filter((e) => e.status === 'active'),
      pricing,
      planDetails: planDetails.filter((p) => p !== null),
      connectionError,
    };
  }, [workspace.id]);
  // The page stays mounted while hidden (PageDrafts), so reload claims and run setup each time
  // it is shown again; typed fields are kept.
  const active = usePageActive();
  const wasActive = useRef(active);
  useEffect(() => {
    if (active && !wasActive.current) ctx.reload();
    wasActive.current = active;
  }, [active]);

  const [theme, setTheme] = useState('');
  const [fieldA, setFieldA] = useState('');
  const [fieldB, setFieldB] = useState('');
  const [users, setUsers] = useState('');
  const [context, setContext] = useState('');
  const [problem, setProblem] = useState('');
  const [measure, setMeasure] = useState('');
  const [data, setData] = useState('');
  const [timeLimit, setTimeLimit] = useState('Six weeks');
  const [budgetLimit, setBudgetLimit] = useState(
    workspace.record_mode === 'fixture'
      ? 'Fixture budget only; no paid services'
      : 'No extra metered spending',
  );
  const [seed, setSeed] = useState('');
  const [constraints, setConstraints] = useState(
    workspace.record_mode === 'fixture'
      ? 'Synthetic data only.'
      : 'Use permitted public evidence only.',
  );
  const [roles, setRoles] = useState<Record<string, EvidenceRole[]>>({});
  const [openClaims, setOpenClaims] = useState<ReadonlySet<string>>(new Set());
  const [excluded, setExcluded] = useState<
    Partial<Record<ResponseType, string>>
  >({});
  const [runChoice, setRunChoice] = useState('new');
  const [newMode, setNewMode] = useState<'human_in_loop' | 'supervised'>(
    'human_in_loop',
  );
  const [allowCalls, setAllowCalls] = useState(true);
  const [envelopeId, setEnvelopeId] = useState('');
  const [pricingId, setPricingId] = useState('');
  const [resourceKind, setResourceKind] = useState<'api' | 'subscription'>(
    workspace.record_mode === 'fixture' ? 'api' : 'subscription',
  );
  const [connectionId, setConnectionId] = useState('');
  const [planModel, setPlanModel] = useState('');
  const [dataClass, setDataClass] = useState<
    'synthetic' | 'public' | 'private_approved'
  >(workspace.record_mode === 'fixture' ? 'synthetic' : 'public');
  const [revisions, setRevisions] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [tried, setTried] = useState(false);

  const brief = {
    theme: theme.trim(),
    fields: [fieldA.trim(), fieldB.trim()],
    target_users: users.trim(),
    context: context.trim() || null,
    measurable_problem: problem.trim(),
    outcome_measure: measure.trim(),
    data_and_tools: lines(data),
    time_limit: timeLimit.trim(),
    budget_limit: budgetLimit.trim(),
    nae_seed: seed || null,
    constraints: lines(constraints),
  };
  const briefCheck = SearchBriefBodySchema.safeParse(brief);
  const issues = useMemo(
    () =>
      briefCheck.success
        ? []
        : briefCheck.error.issues.map(
            (i) => `${fieldName(i.path)}: ${plain(i.message)}`,
          ),
    [JSON.stringify(brief)],
  );
  const evidence = Object.entries(roles)
    .filter(([, r]) => r.length > 0)
    .map(([claim_id, bears_on]) => ({ claim_id, bears_on }));
  const perspectives = ResponseTypeSchema.options.filter(
    (p) => excluded[p] === undefined,
  );
  const exclusions = ResponseTypeSchema.options
    .filter((p) => excluded[p] !== undefined)
    .map((p) => ({ perspective: p, reason: (excluded[p] ?? '').trim() }));
  const c = ctx.data;
  const envelope = envelopeId || c?.envelopes[0]?.id || '';
  const price = pricingId || c?.pricing[0]?.id || '';
  const plan = connectionId
    ? c?.planDetails.find((p) => p.connection.id === connectionId)
    : c?.planDetails[0];
  const model =
    planModel ||
    plan?.model_access.find(
      (a) => a.path === 'responses' && a.access === 'verified',
    )?.model_id ||
    '';
  const planBlockers =
    resourceKind === 'subscription'
      ? [
          ...(c?.connectionError ? [c.connectionError] : []),
          ...(plan?.blockers ?? [
            'Add and verify a ChatGPT-plan connection in Models and connections.',
          ]),
          ...(plan &&
          !plan.connection.settings.allowed_data_classes.includes(dataClass)
            ? [
                'This connection does not permit the selected evidence sharing class.',
              ]
            : []),
          ...[...new Set(Object.values(DISCOVERY_TASK_CLASSES))]
            .filter(
              (tc) =>
                !plan?.qualifications.some(
                  (q) =>
                    q.model_id === model &&
                    q.task_class === tc &&
                    q.state === 'qualified',
                ),
            )
            .map(
              (tc) => `Model is not qualified for ${tc.replaceAll('_', ' ')}.`,
            ),
        ]
      : [];
  const limits =
    resourceKind === 'subscription'
      ? {
          ...LIMITS,
          max_concurrency: 1,
          max_attempts: 1,
          max_calls: Math.min(
            LIMITS.max_calls,
            plan?.connection.settings.caps.responses.max_requests_per_run ?? 10,
          ),
          // A plan call streams for up to the connection's accepted timeout (e.g. 120 s); the
          // 10 s default would cut live calls off mid-stream and leave unknown outcomes.
          call_timeout_ms:
            plan?.connection.settings.caps.responses.request_timeout_ms ??
            LIMITS.call_timeout_ms,
        }
      : LIMITS;
  const request = {
    brief: { id: '00000000-0000-4000-8000-000000000000', version: 1 },
    evidence,
    perspectives,
    excluded: exclusions,
    max_revisions: revisions,
    max_age_days: 180,
    ...(resourceKind === 'subscription'
      ? {
          resource_setup: {
            kind: 'subscription',
            connection_id: plan?.connection.id ?? '',
            model_id: model,
            settings_hash: plan?.connection.settings_hash ?? '',
            max_output_chars: Math.min(
              100000,
              plan?.connection.settings.caps.responses.max_output_chars ??
                16000,
            ),
          },
        }
      : {
          envelope_id: envelope || '00000000-0000-4000-8000-000000000000',
          pricing_snapshot_id: price || '00000000-0000-4000-8000-000000000000',
        }),
    data_class: dataClass,
    limits,
  };
  const reqCheck = StartDiscoveryRequestSchema.safeParse(request);
  const reqIssues = reqCheck.success
    ? []
    : reqCheck.error.issues.map((i) =>
        i.path[0] === 'evidence'
          ? 'Evidence: attach at least one claim and say what it bears on'
          : plain(i.message),
      );
  const ready =
    briefCheck.success &&
    reqCheck.success &&
    (resourceKind === 'subscription'
      ? !!model && planBlockers.length === 0
      : !!envelope && !!price);

  /** Attaching a claim opens its role chips; detaching clears whatever roles it had. */
  function attach(claim: string, on: boolean) {
    setOpenClaims((s) => {
      const next = new Set(s);
      if (on) next.add(claim);
      else next.delete(claim);
      return next;
    });
    if (!on)
      setRoles((r) => {
        const { [claim]: _dropped, ...rest } = r;
        return rest;
      });
  }
  function toggle(claim: string, role: EvidenceRole) {
    setRoles((r) => {
      const cur = r[claim] ?? [];
      return {
        ...r,
        [claim]: cur.includes(role)
          ? cur.filter((x) => x !== role)
          : [...cur, role],
      };
    });
  }
  async function submit(e: FormEvent) {
    e.preventDefault();
    setTried(true);
    if (!ready) return;
    setBusy(true);
    setError('');
    try {
      const created = await api(StoredEntitySchema, `${base}/entities`, {
        csrf: session.csrf_token,
        body: { kind: 'search_brief', title: brief.theme, body: brief },
      });
      let runId = runChoice;
      if (runChoice === 'new') {
        const run = await api(StoredEntitySchema, `${base}/entities`, {
          csrf: session.csrf_token,
          body: {
            kind: 'run',
            title: `Discovery: ${brief.theme}`.slice(0, 300),
            body: {
              state: 'queued',
              experiment_condition: 'human_in_loop',
              discovery_method: 'structured',
              config_hash: null,
            },
          },
        });
        runId = (
          await api(RunControlSchema, `${base}/runs`, {
            csrf: session.csrf_token,
            body: {
              run: { id: run.id, version: 1 },
              autonomy_mode: newMode,
              stage_gates: null,
              initial_grants: [],
            },
          })
        ).run_id;
        if (allowCalls)
          await api(GrantSchema, `${base}/grants`, {
            csrf: session.csrf_token,
            body: {
              run_id: runId,
              action_types: ['model.generate', 'model.summarize'],
              target_kind: null,
              max_amount_nano_usd:
                resourceKind === 'subscription' ? null : '2000000000',
              allow_irreversible: false,
              allow_external_effects: false,
              data_classes: [dataClass],
              expires_at: new Date(Date.now() + 86_400_000).toISOString(),
              rationale:
                `Model calls for the discovery run on “${brief.theme}”, granted from the submit form.`.slice(
                  0,
                  300,
                ),
            },
          });
      }
      const started = await api(
        WorkflowDetailSchema,
        `${base}/runs/${runId}/discoveries`,
        {
          csrf: session.csrf_token,
          body: {
            ...request,
            brief: { id: created.id, version: created.version },
          },
          timeoutMs: 15000,
        },
      );
      open('runs', started.workflow.id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }
  const viewer = workspace.role === 'viewer';
  return (
    <section className="panel" aria-labelledby="sub-title">
      <h2 id="sub-title">Submit a theme</h2>
      <p>
        Two ways in: save a rough theme as a draft and plan it later, or fill in
        the full brief under{' '}
        <button
          type="button"
          className="text"
          // The address hash holds the route, so scroll instead of linking.
          // Kept-alive pages can repeat the id, so look inside this page only.
          onClick={(e) =>
            e.currentTarget
              .closest('section')
              ?.querySelector('#discover')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
        >
          Discover from existing claims
        </button>{' '}
        to start a discovery run now.
      </p>
      <ThemeIntent key={workspace.id} session={session} workspace={workspace} />
      <h3 id="discover">Discover from existing claims</h3>
      <p>
        A theme becomes a versioned search brief and a discovery run: a locator
        narrows it to affected users and an observable problem, then each
        response type is proposed independently and critiqued. Evidence is the
        claims you attach, with their recorded sources; the locator does not
        search the web.
      </p>
      {workspace.record_mode === 'fixture' && (
        <p className="notice">
          Fixture workspace: the deterministic adapter answers from rules over
          the evidence packet. Its proposals are placeholders, not reasoning.
        </p>
      )}
      {viewer && (
        <p className="error">You can read this workspace but not start runs.</p>
      )}
      <Status loading={ctx.loading} error={ctx.error} retry={ctx.reload}>
        {c && (
          <form
            noValidate
            onSubmit={(e) => void submit(e)}
            aria-describedby="sub-issues"
          >
            <fieldset>
              <legend>The brief</legend>
              <label htmlFor="b-theme">Theme (specific setting or group)</label>
              <input
                id="b-theme"
                required
                maxLength={300}
                value={theme}
                onChange={(e) => setTheme(e.target.value)}
              />
              <div className="two">
                <div>
                  <label htmlFor="b-fa">First field</label>
                  <input
                    id="b-fa"
                    required
                    maxLength={300}
                    value={fieldA}
                    onChange={(e) => setFieldA(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="b-fb">Second field</label>
                  <input
                    id="b-fb"
                    required
                    maxLength={300}
                    value={fieldB}
                    onChange={(e) => setFieldB(e.target.value)}
                  />
                </div>
              </div>
              <label htmlFor="b-users">Target users</label>
              <input
                id="b-users"
                required
                maxLength={300}
                value={users}
                onChange={(e) => setUsers(e.target.value)}
              />
              <label htmlFor="b-ctx">Context or geography (optional)</label>
              <input
                id="b-ctx"
                maxLength={300}
                value={context}
                onChange={(e) => setContext(e.target.value)}
              />
              <label htmlFor="b-prob">Measurable problem</label>
              <textarea
                id="b-prob"
                required
                rows={3}
                maxLength={1200}
                value={problem}
                onChange={(e) => setProblem(e.target.value)}
              />
              <label htmlFor="b-meas">
                What would be measured to tell it improved
              </label>
              <input
                id="b-meas"
                required
                maxLength={300}
                value={measure}
                onChange={(e) => setMeasure(e.target.value)}
              />
              <label htmlFor="b-data">
                Data and tools you may use (one per line)
              </label>
              <textarea
                id="b-data"
                rows={2}
                value={data}
                onChange={(e) => setData(e.target.value)}
              />
              <div className="two">
                <div>
                  <label htmlFor="b-time">Time limit</label>
                  <input
                    id="b-time"
                    required
                    maxLength={300}
                    value={timeLimit}
                    onChange={(e) => setTimeLimit(e.target.value)}
                  />
                </div>
                <div>
                  <label htmlFor="b-budget">
                    Solution budget constraint (separate from run limits)
                  </label>
                  <input
                    id="b-budget"
                    required
                    maxLength={300}
                    value={budgetLimit}
                    onChange={(e) => setBudgetLimit(e.target.value)}
                  />
                </div>
              </div>
              <label htmlFor="b-seed">
                NAE Grand Challenge seed (optional; inspires, never replaces the
                theme)
              </label>
              <select
                id="b-seed"
                value={seed}
                onChange={(e) => setSeed(e.target.value)}
              >
                <option value="">None</option>
                {NAE_GRAND_CHALLENGES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              <label htmlFor="b-cons">Constraints (one per line)</label>
              <textarea
                id="b-cons"
                rows={2}
                value={constraints}
                onChange={(e) => setConstraints(e.target.value)}
              />
            </fieldset>

            <fieldset>
              <legend>Evidence: what each claim bears on</legend>
              <p className="small">
                Tick the claims this brief rests on, then mark what each one
                supports.
              </p>
              {c.claims.length === 0 ? (
                <Empty>
                  No claims in this workspace yet. In the Evidence view,
                  register a run, fetch a page and cite its passages in claims
                  {desktop ? (
                    '.'
                  ) : (
                    <>
                      {' '}
                      (or <code>pnpm cli seed-research</code>).
                    </>
                  )}
                </Empty>
              ) : (
                <ul className="rows claims-pick">
                  {c.claims.map((cl) => {
                    const ev = c.evidence.get(cl.id);
                    const attached =
                      openClaims.has(cl.id) || (roles[cl.id]?.length ?? 0) > 0;
                    return (
                      <li key={cl.id}>
                        <label className="claim-attach">
                          <input
                            type="checkbox"
                            checked={attached}
                            onChange={(e) => attach(cl.id, e.target.checked)}
                          />
                          <span
                            className={`kind ev-${ev?.status ?? 'insufficient'}`}
                          >
                            {ev ? words(ev.status) : 'unknown'}
                          </span>{' '}
                          {String(cl.body?.statement ?? cl.title)}
                        </label>
                        {attached && (
                          <div
                            className="chips"
                            role="group"
                            aria-label={`What “${cl.title.slice(0, 60)}” bears on`}
                          >
                            {EvidenceRoleSchema.options.map((r) => (
                              <label key={r} className="chip">
                                <input
                                  type="checkbox"
                                  checked={roles[cl.id]?.includes(r) ?? false}
                                  onChange={() => toggle(cl.id, r)}
                                />
                                {ROLE_LABEL[r]}
                              </label>
                            ))}
                          </div>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="small">
                {evidence.length} claims attached (1–30 needed)
                {openClaims.size > evidence.length
                  ? '. A ticked claim counts once you mark what it supports.'
                  : '.'}
              </p>
            </fieldset>

            <fieldset>
              <legend>Responses to propose</legend>
              <p className="small">
                Each type is proposed independently. Leave one out only with a
                reason; at least one must not be new software.
              </p>
              <ul className="rows">
                {ResponseTypeSchema.options.map((p) => (
                  <li key={p}>
                    <label className="chip">
                      <input
                        type="checkbox"
                        checked={excluded[p] === undefined}
                        onChange={() =>
                          setExcluded((x) => {
                            const n = { ...x };
                            if (n[p] === undefined) n[p] = '';
                            else delete n[p];
                            return n;
                          })
                        }
                      />
                      {words(p)}
                    </label>
                    {excluded[p] !== undefined && (
                      <input
                        aria-label={`Why ${words(p)} is left out`}
                        placeholder="Why it does not apply"
                        maxLength={300}
                        value={excluded[p]}
                        onChange={(e) =>
                          setExcluded((x) => ({ ...x, [p]: e.target.value }))
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
              <label htmlFor="b-rev">Revision rounds after critique</label>
              <select
                id="b-rev"
                value={revisions}
                onChange={(e) => setRevisions(Number(e.target.value))}
              >
                {[0, 1, 2].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset>
              <legend>Run, budget and permission</legend>
              <label htmlFor="b-run">Run</label>
              <select
                id="b-run"
                value={runChoice}
                onChange={(e) => setRunChoice(e.target.value)}
              >
                <option value="new">Register a new run</option>
                {c.runs.map((r) => (
                  <option key={r.run_id} value={r.run_id}>
                    Existing {words(r.autonomy_mode)} run {shortId(r.run_id)}
                  </option>
                ))}
              </select>
              {runChoice === 'new' && (
                <>
                  <label htmlFor="b-mode">Oversight</label>
                  <select
                    id="b-mode"
                    value={newMode}
                    onChange={(e) =>
                      setNewMode(e.target.value as typeof newMode)
                    }
                  >
                    <option value="human_in_loop">
                      Human in the loop (asks at stage gates)
                    </option>
                    <option value="supervised">
                      Supervised (asks before every consequential step)
                    </option>
                  </select>
                  <label className="chip">
                    <input
                      type="checkbox"
                      checked={allowCalls}
                      onChange={(e) => setAllowCalls(e.target.checked)}
                    />
                    Let this run make model calls on the selected data class for
                    24 hours,{' '}
                    {resourceKind === 'subscription'
                      ? 'within the subscription caps shown below; no API spending'
                      : `up to 2 ${workspace.record_mode === 'fixture' ? 'simulated units' : 'dollars'} per call`}{' '}
                    (a standing permission you can revoke under Decisions)
                  </label>
                  {!allowCalls && (
                    <p className="small">
                      Without it, each model call waits for your approval.
                    </p>
                  )}
                </>
              )}
              <button
                type="button"
                className="secondary"
                onClick={() => ctx.reload()}
              >
                Refresh run setup
              </button>
              <label htmlFor="b-route">Model access</label>
              <select
                id="b-route"
                value={resourceKind}
                onChange={(e) =>
                  setResourceKind(e.target.value as 'api' | 'subscription')
                }
              >
                <option value="subscription">
                  ChatGPT plan · subscription quota
                </option>
                <option value="api">API / fixture · budget and pricing</option>
              </select>
              <label htmlFor="b-data-class">Evidence sharing class</label>
              <select
                id="b-data-class"
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
              {resourceKind === 'subscription' ? (
                <>
                  <label htmlFor="b-connection">Connection</label>
                  <select
                    id="b-connection"
                    value={plan?.connection.id ?? ''}
                    onChange={(e) => {
                      setConnectionId(e.target.value);
                      setPlanModel('');
                    }}
                  >
                    {!c.planDetails.length && (
                      <option value="">No plan connection</option>
                    )}
                    {c.planDetails.map((p) => (
                      <option key={p.connection.id} value={p.connection.id}>
                        {p.connection.label}
                      </option>
                    ))}
                  </select>
                  <label htmlFor="b-plan-model">Verified model</label>
                  <select
                    id="b-plan-model"
                    value={model}
                    onChange={(e) => setPlanModel(e.target.value)}
                  >
                    {!model && <option value="">No verified model</option>}
                    {plan?.model_access
                      .filter(
                        (a) =>
                          a.path === 'responses' && a.access === 'verified',
                      )
                      .map((a) => (
                        <option key={a.model_id} value={a.model_id}>
                          {a.model_id}
                        </option>
                      ))}
                  </select>
                  <p className="small">
                    Subscription quota; no API pricing or money envelope. One
                    model job, at most {limits.max_calls} requests,{' '}
                    {limits.max_wall_seconds} seconds per workflow and{' '}
                    {Math.min(
                      100000,
                      plan?.connection.settings.caps.responses
                        .max_output_chars ?? 16000,
                    )}{' '}
                    characters per response. Provider allowance is shared and
                    may be unavailable. No paid fallback or search is included.
                  </p>
                  {planBlockers.length > 0 && (
                    <ul className="error">
                      {planBlockers.map((b) => (
                        <li key={b}>{b}</li>
                      ))}
                    </ul>
                  )}
                </>
              ) : (
                <>
                  <label htmlFor="b-env">Budget</label>
                  <select
                    id="b-env"
                    value={envelope}
                    onChange={(e) => setEnvelopeId(e.target.value)}
                  >
                    {c.envelopes.length === 0 && (
                      <option value="">No active budget</option>
                    )}
                    {c.envelopes.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} · {money(e.available, e.fixture)} available
                      </option>
                    ))}
                  </select>
                  <label htmlFor="b-price">Pricing snapshot</label>
                  <select
                    id="b-price"
                    value={price}
                    onChange={(e) => setPricingId(e.target.value)}
                  >
                    {c.pricing.length === 0 && (
                      <option value="">No pricing snapshot</option>
                    )}
                    {c.pricing.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.body.provider}/{p.body.model_id} · {p.body.basis}
                      </option>
                    ))}
                  </select>
                  {(c.envelopes.length === 0 || c.pricing.length === 0) && (
                    <p className="error">
                      A discovery run needs an active budget (Budgets view) and
                      a pricing snapshot
                      {workspace.record_mode === 'fixture' ? (
                        <> (Budgets view: Add fixture pricing).</>
                      ) : desktop ? (
                        <>; adding a pricing snapshot {NO_CLI_IN_DESKTOP}.</>
                      ) : (
                        <>
                          {' '}
                          (<code>pnpm cli pricing-add</code>).
                        </>
                      )}
                    </p>
                  )}
                </>
              )}
            </fieldset>

            <div id="sub-issues" aria-live="polite">
              {tried && [...issues, ...reqIssues].length > 0 && (
                <ul className="small issues">
                  {[...issues, ...reqIssues].slice(0, 8).map((i) => (
                    <li key={i}>{i}</li>
                  ))}
                </ul>
              )}
            </div>
            <button className="primary" type="submit" disabled={busy || viewer}>
              {busy ? 'Starting…' : 'Save brief and start discovery'}
              <span aria-hidden="true">→</span>
            </button>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
          </form>
        )}
      </Status>
    </section>
  );
}
