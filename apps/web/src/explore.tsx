import { useEffect, useState, type FormEvent } from 'react';
import {
  EXPLORATION_TASK_CLASS,
  EnvelopeSchema,
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
  z,
  type ExplorationResult,
  type SearchBriefBody,
  type SessionInfo,
  type Workflow,
  type WorkflowDetail,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { newestFirst } from './versions.js';
import { envelopesFor } from './build-defaults.js';
import { Empty, Status, useLoad } from './ui.js';

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
  /** Cited claims: supporting ones bear on the problem and who is affected. */
  claims: { claim_id: string; contrary: boolean }[];
}

export function Explore({
  session,
  workspace,
  onUse,
}: {
  session: SessionInfo;
  workspace: Workspace;
  onUse: (pick: ExploredPick) => void;
}) {
  const base = `workspaces/${workspace.id}`;
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
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [openId, setOpenId] = useState('');

  const c = ctx.data;
  const plan = connectionId
    ? c?.details.find((p) => p.connection.id === connectionId)
    : c?.details[0];
  const verified =
    plan?.model_access.filter(
      (a) => a.path === 'responses' && a.access === 'verified',
    ) ?? [];
  const model =
    (verified.some((a) => a.model_id === planModel) ? planModel : '') ||
    verified[0]?.model_id ||
    '';
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
  };
  const scopeCheck = ExploreScopeSchema.safeParse(scope);
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
          ...(plan &&
          model &&
          !plan.qualifications.some(
            (q) =>
              q.model_id === model &&
              q.task_class === EXPLORATION_TASK_CLASS &&
              q.state === 'qualified',
          )
            ? [
                `${model} is not qualified for research synthesis (the discovery locator's qualification). Qualify it under Models and connections first.`,
              ]
            : []),
        ]
      : [
          ...(envelope ? [] : ['No active shared budget (Monitor › Budgets).']),
          ...(price ? [] : ['No pricing snapshot (Monitor › Budgets).']),
        ];
  const scopeIssues = scopeCheck.success
    ? []
    : scopeCheck.error.issues.map((i) => i.message);
  const ready =
    !busy &&
    workspace.role === 'owner' &&
    scopeIssues.length === 0 &&
    blockers.length === 0 &&
    StartExplorationRequestSchema.safeParse(request).success;

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!ready) return;
    setBusy(true);
    setError('');
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
      await api(GrantSchema, `${base}/grants`, {
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
        { csrf: session.csrf_token, body: request, timeoutMs: 20_000 },
      );
      setOpenId(started.workflow.id);
      ctx.refresh();
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  }

  const shown = openId || c?.explorations[0]?.id || '';
  return (
    <section className="explore" aria-labelledby="explore-title">
      <h3 id="explore-title">Explore for me</h3>
      <p>
        No theme needed. The studio reads the claims already recorded in this
        workspace (newest first) and asks one model for up to {maxCandidates}{' '}
        specific problems, each citing those claims. App rules then mark
        duplicates, excluded topics and thin evidence. Nothing is fetched, built
        or sent anywhere else, and an empty answer is a real answer.
      </p>
      <Status loading={ctx.loading} error={ctx.error} retry={ctx.reload}>
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
                  this request only.
                </p>
              </details>
              {[...scopeIssues, ...blockers].length > 0 && (
                <ul className="error small">
                  {[...scopeIssues, ...blockers].map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
              {workspace.role !== 'owner' && (
                <p className="small">Only the workspace owner can explore.</p>
              )}
              <button className="primary" type="submit" disabled={!ready}>
                {busy ? 'Starting…' : 'Explore for me'}
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
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
}: {
  base: string;
  session: SessionInfo;
  id: string;
  fixture: boolean;
  owner: boolean;
  onUse: (pick: ExploredPick) => void;
  onFinished: () => void;
}) {
  const d = useLoad(
    () => api(WorkflowDetailSchema, `${base}/workflows/${id}`),
    [id],
  );
  const wf: Workflow | undefined = d.data?.workflow;
  const live = wf ? LIVE.has(wf.state) : false;
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => d.refresh(), 2000);
    return () => clearTimeout(t);
  }, [live, d.data]);
  useEffect(() => {
    if (wf?.finished_at) onFinished();
  }, [wf?.finished_at]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

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
    <Status loading={d.loading} error={d.error} retry={d.reload}>
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
            />
          )}
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
}: {
  result: ExplorationResult | null;
  explanation: string;
  fixture: boolean;
  owner: boolean;
  busy: string;
  onUse: (e: ExplorationResult['candidates'][number]) => void;
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
                {e.claims
                  .map(
                    (x) =>
                      `${x.ref} ${words(x.status)}${x.contrary ? ' (against)' : ''}`,
                  )
                  .join(' · ')}
              </dd>
            </dl>
            <ul className="small">
              {e.reasons.map((r) => (
                <li key={r}>{r}</li>
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
            {result.directions.map((x) => (
              <li key={x.direction}>
                <strong>{x.direction}.</strong> {x.why} Question: {x.question}
              </li>
            ))}
          </ul>
        </>
      )}
      <details>
        <summary>What was not read or assessed</summary>
        <ul className="small">
          {[...result.not_searched.notes, ...result.not_covered].map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      </details>
    </>
  );
}
