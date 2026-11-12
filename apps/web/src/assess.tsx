import { useEffect, useState } from 'react';
import {
  ASSESSMENT_TASK_CLASS,
  AssessmentPreviewSchema,
  EnvelopeSchema,
  GrantSchema,
  PlanConnectionDetailSchema,
  PlanConnectionSchema,
  PricingSnapshotSchema,
  RunControlSchema,
  StartAssessmentRequestSchema,
  StoredEntitySchema,
  WORKFLOW_WALL_MAX_SECONDS,
  WorkflowDetailSchema,
  WorkflowSchema,
  RUBRICS,
  latestDecided,
  z,
  type AssessmentPacket,
  type AssessmentPreview,
  type RankedCandidate,
  type ScorecardBody,
  type SessionInfo,
  type StoredEntity,
  type Workspace,
} from '@creator/contracts';
import {
  ApiError,
  api,
  message,
  refusalsOf,
  when,
  words,
} from './oversight.js';
import {
  FixOutcome,
  FixButtons,
  FixRow,
  qualifierFor,
  routeFixes,
  type FixContext,
} from './fix-buttons.js';
import { refusalFixes, type FixAction } from './fix-here.js';
import { newestFirst } from './versions.js';
import { envelopesFor } from './build-defaults.js';
import { useLoad, type View } from './ui.js';
import { LinkClaims } from './link-claims.js';
import { rangeEnds } from './claim-suggest.js';
import { preferredRoute } from './model-choice.js';
import {
  ChoiceNote,
  responsesModels,
  routePlans,
  useModelChoice,
} from './model-switch.js';

// P08 automatic assessments (ADR-0074). Requests of a few options each rate every option on the
// rubrics that apply, citing the claims linked to it. The studio checks the answer, writes one
// system scorecard per option and rubric, and computes totals and ranks itself; a person edits
// any rating as their own scorecard, and only a person clears an ethics or access gate.

const LIMITS = {
  max_children: 1,
  max_concurrency: 1,
  max_depth: 1 as const,
  max_attempts: 1,
  max_repairs: 1,
  max_calls: 2,
  max_output_tokens: 8000,
  call_timeout_ms: 60_000,
  max_wall_seconds: 600,
};
const LIVE = new Set([
  'queued',
  'running',
  'waiting_dependency',
  'waiting_human',
  'paused_operator',
  'reconciling',
]);

export function AutoAssess({
  session,
  workspace,
  problem,
  onRecorded,
  open,
}: {
  session: SessionInfo;
  workspace: Workspace;
  problem: StoredEntity;
  onRecorded: () => void;
  open: (view: View, id?: string) => void;
}) {
  const base = `workspaces/${workspace.id}`;
  const fixture = workspace.record_mode === 'fixture';
  const owner = workspace.role === 'owner';
  const ctx = useLoad(async () => {
    const [workflows, envelopes, pricing, connections] = await Promise.all([
      api(z.array(WorkflowSchema), `${base}/workflows`),
      api(z.array(EnvelopeSchema), `${base}/budgets`),
      api(z.array(PricingSnapshotSchema), `${base}/pricing`),
      api(z.array(PlanConnectionSchema), `${base}/plan-connections`).catch(
        () => [],
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
      runs: newestFirst(
        workflows.filter(
          (w) =>
            w.role === 'r08_assessment' &&
            w.subject.id.toLowerCase() === problem.id.toLowerCase(),
        ),
      ).slice(0, 5),
      envelopes: envelopesFor(
        newestFirst(envelopes.filter((e) => e.status === 'active')),
        '',
      ),
      pricing: newestFirst(pricing),
      details,
    };
  }, [workspace.id, problem.id, problem.version]);

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
  const [errorFixes, setErrorFixes] = useState<FixAction[]>([]);
  const [openId, setOpenId] = useState('');
  const [showSent, setShowSent] = useState(false);

  const c = ctx.data;
  // ADR-0081: with nothing picked here, start from the current model in the top bar.
  const choice = useModelChoice(workspace);
  const first = c?.details[0];
  const route = preferredRoute(
    routePlans(c?.details ?? [], [ASSESSMENT_TASK_CLASS], dataClass, true),
    choice,
    [ASSESSMENT_TASK_CLASS],
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
  // ADR-0085: the requests are sized to the chosen connection's input cap, so the preview is
  // read again when the connection or its accepted settings change.
  const capConnection =
    resourceKind === 'subscription' ? (plan?.connection.id ?? '') : '';
  const pv = useLoad(async () => {
    if (resourceKind === 'subscription' && !c) return null;
    return api(
      AssessmentPreviewSchema,
      `${base}/problems/${problem.id}/assessment-preview${capConnection ? `?connection=${capConnection}` : ''}`,
    ).then(
      (data) => ({ data, error: '', tooLarge: false }),
      (e: unknown) => ({
        data: null,
        error: message(e),
        // Only the size refusal (an option that does not fit alone) is fixed by a larger cap.
        tooLarge: e instanceof ApiError && e.code === 'BODY_TOO_LARGE',
      }),
    );
  }, [
    workspace.id,
    problem.id,
    problem.version,
    resourceKind,
    capConnection,
    plan?.connection.settings_hash ?? '',
    !!c,
  ]);
  const previewRead = pv.data;
  const preview = previewRead?.data ?? null;
  // Too large, or evidence left out for size: the owner can raise the connection's input cap.
  const capHelp =
    owner &&
    resourceKind === 'subscription' &&
    !!plan &&
    (!!previewRead?.tooLarge || (preview?.claims_left_out ?? 0) > 0);
  const linked = preview
    ? preview.packet.claims.length +
      preview.claims_left_out +
      preview.claims_over_max
    : 0;
  // One request per batch of options, each with one retry for a malformed answer.
  const requests = preview?.requests ?? 1;
  // On a plan connection the calls stay within its accepted per-run cap; a retry is dropped
  // before a request is (ADR-0085: finer splits can mean up to eight requests).
  const perRun =
    resourceKind === 'subscription'
      ? (plan?.connection.settings.caps.responses.max_requests_per_run ?? null)
      : null;
  const sized = {
    ...LIMITS,
    max_children: requests,
    max_calls:
      perRun === null
        ? 2 * requests
        : Math.max(requests, Math.min(2 * requests, perRun)),
  };
  const limits =
    resourceKind === 'subscription'
      ? {
          ...sized,
          call_timeout_ms: timeout,
          max_wall_seconds: Math.min(
            WORKFLOW_WALL_MAX_SECONDS,
            Math.max(
              LIMITS.max_wall_seconds,
              Math.ceil((2 * requests * timeout) / 1000) + 60,
            ),
          ),
        }
      : {
          ...sized,
          call_timeout_ms: 30_000,
          max_wall_seconds: Math.min(
            WORKFLOW_WALL_MAX_SECONDS,
            Math.max(LIMITS.max_wall_seconds, 60 * requests + 60),
          ),
        };
  const request = {
    problem: { id: problem.id, version: problem.version },
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
    ...(preview ? { preview_hash: preview.preview_hash } : {}),
  };
  const blockers = [
    ...(previewRead?.error ? [previewRead.error] : []),
    ...(resourceKind === 'subscription'
      ? [
          ...(plan?.blockers ?? [
            'Add and verify a plan connection under Models and connections.',
          ]),
          ...(plan && !model ? ['No verified model on this connection.'] : []),
          ...(perRun !== null && preview && requests > perRun
            ? [
                `This assessment takes ${requests} requests and ${plan?.connection.label ?? 'the connection'} allows ${perRun} per run. Raise its requests per run under Change caps or allowed work.`,
              ]
            : []),
          ...(plan &&
          !plan.connection.settings.allowed_data_classes.includes(dataClass)
            ? ['This connection does not permit the selected sharing class.']
            : []),
          ...(plan &&
          model &&
          latestDecided(
            plan.qualifications.filter((q) => q.admits_assessment === true),
            model,
            ASSESSMENT_TASK_CLASS,
          )?.state !== 'qualified'
            ? [
                `${model} has no current scoring qualification. Qualify it on the "assessment" benchmark under Models and connections first (the discovery skeptic's scoring qualification does not count).`,
              ]
            : []),
        ]
      : [
          ...(envelope ? [] : ['No active shared budget (Monitor › Budgets).']),
          ...(price ? [] : ['No pricing snapshot (Monitor › Budgets).']),
        ]),
  ];
  // ADR-0087 (P27): the owner fixes the route's refusals here, without leaving Decide.
  const fixes: FixContext = {
    base,
    place: 'assess',
    csrf: session.csrf_token,
    owner,
    onDone: () => ctx.refresh(),
  };
  const blockerFixes =
    resourceKind === 'subscription'
      ? routeFixes({
          plan,
          dataClass,
          model,
          missing:
            plan &&
            model &&
            latestDecided(
              plan.qualifications.filter((q) => q.admits_assessment === true),
              model,
              ASSESSMENT_TASK_CLASS,
            )?.state !== 'qualified'
              ? [ASSESSMENT_TASK_CLASS]
              : [],
          role: 'assessment',
        })
      : [];
  const latest = c?.runs[0];
  const running = !!latest && LIVE.has(latest.state);
  const ready =
    !busy &&
    !!preview &&
    !pv.loading &&
    owner &&
    !running &&
    blockers.length === 0 &&
    StartAssessmentRequestSchema.safeParse(request).success;

  async function start() {
    if (!ready) return;
    setBusy(true);
    setError('');
    setErrorFixes([]);
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
          title: `Assess automatically · ${stamp}`,
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
            'The one assessor request of “Assess automatically”, granted from Compare and decide.',
        },
      });
      const started = await api(
        WorkflowDetailSchema,
        `${base}/runs/${control.run_id}/assessments`,
        { csrf: session.csrf_token, body: request, timeoutMs: 30_000 },
      );
      setOpenId(started.workflow.id);
      ctx.refresh();
      pv.refresh();
    } catch (err) {
      const begun = runId
        ? await api(z.array(WorkflowSchema), `${base}/workflows`)
            .then((all) =>
              all.find(
                (w) => w.run_id === runId && w.role === 'r08_assessment',
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
          'assessment',
          plan ? qualifierFor('assessment', plan.connection) : () => false,
        ),
      );
      ctx.refresh();
      const undo = 'The automatic assessment did not start.';
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

  const shown = openId || latest?.id || '';
  return (
    <section className="assess" aria-labelledby="assess-title">
      <h3 id="assess-title">Automatic assessment</h3>
      <p className="small">
        The model rates every option of this problem (a few options per request)
        on the rubrics that apply, citing the claims linked to it, or says
        unknown. The studio checks every reference, records one scorecard per
        option and rubric, and computes the totals and ranks itself. You can
        edit any rating below as your own scorecard; the original stays. Only
        you can clear an ethics or access gate, and nothing is selected for you.
      </p>
      {ctx.error && <p className="error">{ctx.error}</p>}
      {c && (
        <>
          {preview && (
            <p className="small">
              Will send {preview.packet.options.length} option
              {preview.packet.options.length === 1 ? '' : 's'} and{' '}
              {preview.packet.claims.length} linked claim
              {preview.packet.claims.length === 1 ? '' : 's'}
              {preview.requests > 1
                ? ` in ${preview.requests} requests of a few options each, every request with the same claims; the largest is ${preview.chars.toLocaleString()} of ${preview.limit.toLocaleString()} characters.`
                : ` in one request (${preview.chars.toLocaleString()} of ${preview.limit.toLocaleString()} characters).`}{' '}
              {preview.packet.notes.slice(0, -1).join(' ')}{' '}
              <button
                type="button"
                className="text"
                onClick={() => setShowSent((v) => !v)}
              >
                {showSent
                  ? 'Hide what would be sent'
                  : 'Show what would be sent'}
              </button>
            </p>
          )}
          {preview && (
            <Coverage
              session={session}
              workspace={workspace}
              problem={problem}
              preview={preview}
              open={open}
              onLinked={() => {
                pv.refresh();
                onRecorded();
              }}
            />
          )}
          {showSent && preview && (
            <>
              <p className="small">
                Request sizes:{' '}
                {preview.request_chars
                  .map((n) => n.toLocaleString())
                  .join(', ')}{' '}
                of {preview.limit.toLocaleString()} characters each.
              </p>
              <Packet packet={preview.packet} />
            </>
          )}
          {capHelp && (
            <p className="small">
              {preview && preview.claims_left_out > 0
                ? `${preview.claims_left_out} linked claim${preview.claims_left_out === 1 ? ' is' : 's are'} left out to fit ${plan.connection.label}’s input cap of ${preview.limit.toLocaleString()} characters per request. `
                : ''}
              {preview && preview.cap_for_all
                ? `Reading all of them needs an input cap of about ${preview.cap_for_all.toLocaleString()} characters per request (about ${Math.round(preview.cap_for_all / 4).toLocaleString()} tokens). `
                : ''}
              To send a larger packet, raise the input cap under “Change caps or
              allowed work” on {plan.connection.label} (the provider must accept
              requests that large too).{' '}
              <button
                type="button"
                className="text"
                onClick={() => open('models')}
              >
                Open Models and connections
              </button>
            </p>
          )}
          {owner && (
            <details>
              <summary>
                Model access:{' '}
                {resourceKind === 'subscription'
                  ? `${plan?.connection.label ?? 'no plan connection'}${model ? ` · ${model}` : ''} · $0`
                  : 'API / fixture budget'}
              </summary>
              <label htmlFor="as-route">Route</label>
              <select
                id="as-route"
                value={resourceKind}
                onChange={(e) =>
                  setResourceKind(e.target.value as typeof resourceKind)
                }
              >
                <option value="subscription">
                  Plan connection · subscription quota, $0
                </option>
                <option value="api">API / fixture · budget and pricing</option>
              </select>
              {resourceKind === 'subscription' && (
                <div className="two">
                  <div>
                    <label htmlFor="as-conn">Connection</label>
                    <select
                      id="as-conn"
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
                    <label htmlFor="as-model">Verified model</label>
                    <select
                      id="as-model"
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
                  task="Assess"
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
              <label htmlFor="as-class">Evidence sharing class</label>
              <select
                id="as-class"
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
                  ? `${requests === 1 ? 'One request' : `${requests} requests (a few options each, so every answer fits the connection’s answer and input caps)`} on your plan, plus ${sized.max_calls - requests === requests ? 'one retry each' : `${sized.max_calls - requests} ${sized.max_calls - requests === 1 ? 'retry' : 'retries'} in all`} if an answer is malformed, within the connection’s accepted caps. No API spending.`
                  : `Metered under ${envelope?.name ?? 'no budget'}; at most ${2 * requests} calls.`}{' '}
                Starting registers a new run with a 24-hour permission for this
                request only.
              </p>
            </details>
          )}
          {owner && blockers.length > 0 && (
            <ul className="error small">
              {blockers.map((b) => (
                <li key={b}>{b}</li>
              ))}
            </ul>
          )}
          {blockers.length > 0 && <FixRow acts={blockerFixes} fix={fixes} />}
          <FixOutcome fix={fixes} />
          {owner ? (
            <button
              type="button"
              className="primary"
              disabled={!ready}
              onClick={() => void start()}
            >
              {busy
                ? 'Starting…'
                : running
                  ? 'Assessing…'
                  : latest
                    ? 'Assess again'
                    : 'Assess automatically'}
            </button>
          ) : null}
          {owner && preview && linked > 0 ? (
            <span className="small">
              {' '}
              Rates on {preview.packet.claims.length} of {linked} linked claim
              {linked === 1 ? '' : 's'}.
            </span>
          ) : null}
          {owner ? null : (
            <p className="small">Only the workspace owner can start one.</p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
              <FixButtons acts={errorFixes} fix={fixes} />
            </p>
          )}
          {shown && (
            <Run
              key={shown}
              base={base}
              session={session}
              id={shown}
              owner={owner}
              onFinished={() => {
                ctx.refresh();
                onRecorded();
              }}
              open={open}
            />
          )}
        </>
      )}
    </section>
  );
}

/**
 * ADR-0091: before assessing, the options with no claim of their own in the packet. Their
 * ratings rest on the problem's claims alone, so they are likely to come back unknown and
 * their ranges wide. Each can be fixed in place: link recorded claims, or find evidence on
 * the web. Assessing anyway stays possible.
 */
function Coverage({
  session,
  workspace,
  problem,
  preview,
  open,
  onLinked,
}: {
  session: SessionInfo;
  workspace: Workspace;
  problem: StoredEntity;
  preview: AssessmentPreview;
  open: (view: View, id?: string) => void;
  onLinked: () => void;
}) {
  const [openRef, setOpenRef] = useState('');
  const canLink = workspace.role !== 'viewer';
  const bare = preview.option_coverage.filter((c) => c.read === 0);
  if (!bare.length) return null;
  const total = preview.packet.options.length;
  const shared = preview.problem_claims_read;
  const option = (ref: string) =>
    preview.packet.options.find((o) => o.ref === ref)!;
  const toggle = (key: string) => setOpenRef((k) => (k === key ? '' : key));
  return (
    <div className="notice assess-coverage">
      <p>
        <strong>
          {bare.length === total
            ? total === 1
              ? 'The option has no claim of its own.'
              : `None of the ${total} options has a claim of its own.`
            : `${bare.length} of ${total} options have no claim of their own.`}
        </strong>{' '}
        {shared
          ? `They are rated only on the ${shared} claim${shared === 1 ? '' : 's'} about the problem, so ratings that evidence does not cover come back unknown and widen their score ranges (as far as 0–100).`
          : 'With no evidence at all, every rating comes back unknown and every range is 0–100.'}{' '}
        Link evidence first, or assess anyway.
      </p>
      <ul>
        {bare.map((c) => {
          const o = option(c.ref);
          return (
            <li key={c.ref}>
              {o.title}
              <span className="muted">
                {' '}
                ·{' '}
                {c.linked
                  ? `${c.linked} linked claim${c.linked === 1 ? '' : 's'} not read (input cap or the 30-claim limit)`
                  : 'no linked claim'}
              </span>
              {canLink && (
                <>
                  {' '}
                  <button
                    type="button"
                    className="text"
                    aria-expanded={openRef === c.ref}
                    onClick={() => toggle(c.ref)}
                  >
                    {openRef === c.ref ? 'Close' : 'Link claims'}
                  </button>
                </>
              )}
              {openRef === c.ref && (
                <LinkClaims
                  session={session}
                  workspace={workspace}
                  target={{
                    id: o.alternative_id,
                    version: o.version,
                    kind: 'alternative',
                    title: o.title,
                  }}
                  problemTitle={problem.title}
                  onLinked={onLinked}
                  open={open}
                />
              )}
            </li>
          );
        })}
      </ul>
      {canLink && (
        <p className="small">
          Evidence about the problem as a whole?{' '}
          <button
            type="button"
            className="text"
            aria-expanded={openRef === 'problem'}
            onClick={() => toggle('problem')}
          >
            {openRef === 'problem' ? 'Close' : 'Link claims to the problem'}
          </button>
        </p>
      )}
      {openRef === 'problem' && (
        <LinkClaims
          session={session}
          workspace={workspace}
          target={{
            id: problem.id,
            version: problem.version,
            kind: 'problem',
            title: problem.title,
          }}
          onLinked={onLinked}
          open={open}
        />
      )}
    </div>
  );
}

function Run({
  base,
  session,
  id,
  owner,
  onFinished,
  open,
}: {
  base: string;
  session: SessionInfo;
  id: string;
  owner: boolean;
  onFinished: () => void;
  open: (view: View, id?: string) => void;
}) {
  const d = useLoad(
    () => api(WorkflowDetailSchema, `${base}/workflows/${id}`),
    [id],
  );
  const wf = d.data?.workflow;
  const live = wf ? LIVE.has(wf.state) : false;
  useEffect(() => {
    if (!live) return;
    const t = setTimeout(() => d.refresh(), 2000);
    return () => clearTimeout(t);
  }, [live, d.data]);
  const [wasLive, setWasLive] = useState(false);
  useEffect(() => {
    if (live) setWasLive(true);
    else if (wasLive && wf?.finished_at) onFinished();
  }, [live, wf?.finished_at]);
  const [error, setError] = useState('');
  const [sent, setSent] = useState<AssessmentPacket | null>(null);
  if (!wf) return d.error ? <p className="error">{d.error}</p> : null;
  const r = wf.result?.assessment;
  async function stop() {
    setError('');
    try {
      await api(WorkflowDetailSchema, `${base}/workflows/${id}/cancel`, {
        csrf: session.csrf_token,
        body: {
          expected_version: wf!.version,
          reason: 'Stopped from Compare and decide.',
        },
      });
      d.refresh();
    } catch (e) {
      setError(message(e));
    }
  }
  async function packet() {
    if (sent) return setSent(null);
    try {
      const p = await api(
        z.object({ packet: z.unknown() }).passthrough(),
        `${base}/workflows/${id}/assessment-packet`,
      );
      setSent(p.packet as AssessmentPacket);
    } catch (e) {
      setError(message(e));
    }
  }
  return (
    <div className="assess-run" role="status">
      <p className="small">
        <span className={`badge wf-${wf.state}`}>{words(wf.state)}</span>{' '}
        Started {when(wf.created_at)}
        {wf.fixture ? ' · fixture rules, not a model' : ''}.{' '}
        {wf.result?.explanation ?? (live ? 'Waiting for the assessor…' : '')}{' '}
        <button className="text" onClick={() => open('runs', wf.id)}>
          Run details →
        </button>
        {live && owner && (
          <>
            {' '}
            <button className="text" onClick={() => void stop()}>
              Stop
            </button>
          </>
        )}
      </p>
      {r && (
        <>
          {r.summary && <p className="small">Assessor: {r.summary}</p>}
          {r.scorecards.some((s) => s.unknown.length) && (
            <p className="small">
              Unknown (not enough evidence):{' '}
              {r.scorecards
                .filter((s) => s.unknown.length)
                .map(
                  (s) =>
                    `${s.option} ${words(s.rubric)}: ${s.unknown.map(words).join(', ')}`,
                )
                .join('; ')}
              .
            </p>
          )}
          {[...r.notes, ...r.not_covered].length > 0 && (
            <ul className="small">
              {[...r.notes, ...r.not_covered].map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          )}
          <button className="text" onClick={() => void packet()}>
            {sent ? 'Hide what was sent' : 'Show what was sent to the model'}
          </button>
          {sent && <Packet packet={sent} />}
        </>
      )}
      {error && <p className="error">{error}</p>}
    </div>
  );
}

function Packet({ packet }: { packet: AssessmentPacket }) {
  return (
    <div className="sent small">
      <p>
        Problem v{packet.problem.version}: {packet.problem.title}
      </p>
      <ol>
        {packet.options.map((o) => (
          <li key={o.ref}>
            {o.ref} · {words(o.kind)} · {o.title} (v{o.version}; rated on{' '}
            {o.rubrics.map(words).join(' and ')})
          </li>
        ))}
      </ol>
      {packet.claims.length ? (
        <ul>
          {packet.claims.map((c) => (
            <li key={c.ref}>
              {c.ref} · {words(c.relation)}
              {c.options ? ` ${c.options.join(', ')}` : ''} · {words(c.status)}{' '}
              ·{' '}
              {c.statement.length > 200
                ? `${c.statement.slice(0, 199)}…`
                : c.statement}
            </li>
          ))}
        </ul>
      ) : (
        <p>No claims are linked to this problem.</p>
      )}
      <p>
        Rubrics:{' '}
        {packet.rubrics
          .map((r) => `${r.version} (${r.hash.slice(0, 8)})`)
          .join(', ')}
      </p>
    </div>
  );
}

/**
 * Who rated an option on each rubric, as the ranking counts it: the automatic assessment, a
 * person's edit that replaces it, stale cards and why. Each system card opens to its full
 * explanation (review M-2). "Edit" opens the scoring form on that exact system card.
 */
export function AssessmentLines({
  rubrics,
  cards,
  claims,
  canEdit,
  onEdit,
}: {
  rubrics: {
    rubric: 'suitability' | 'opportunity';
    cand: RankedCandidate | undefined;
  }[];
  /** The stored scorecards, for each system card's ratings, rationales and provenance. */
  cards: StoredEntity[];
  /** Claims linked to the problem, to name the claims a rating cites. */
  claims: { id: string; title: string }[];
  canEdit: boolean;
  onEdit: (rubric: 'suitability' | 'opportunity', systemId: string) => void;
}) {
  const lines = rubrics.flatMap(({ rubric, cand }) =>
    (cand?.scorecards ?? []).map((s) => ({ rubric, s })),
  );
  if (!lines.length) return null;
  const name = (r: string) =>
    r === 'suitability' ? 'Suitability' : 'Software opportunity';
  return (
    <ul className="small assess-lines">
      {lines.map(({ rubric, s }) => {
        const card = cards.find((c) => c.id === s.id);
        return (
          <li key={s.id}>
            <strong>{name(rubric)}</strong>:{' '}
            {s.system ? 'Automatic assessment' : s.reviewer}
            {s.edit_of
              ? ` (${s.reviewer}’s edit of the automatic assessment)`
              : ''}{' '}
            ·{' '}
            {s.score
              ? s.score.display
              : `${s.lower.display}–${s.upper.display}`}
            {s.superseded_by
              ? ' · replaced by a person’s edit, not counted'
              : s.stale
                ? ' · stale, not counted'
                : ''}
            {s.stale && s.stale_reasons?.length ? (
              <ul>
                {s.stale_reasons.slice(0, 4).map((r) => (
                  <li key={r}>{r}</li>
                ))}
              </ul>
            ) : null}
            {canEdit && s.system && !s.superseded_by && !s.stale && (
              <>
                {' '}
                <button
                  type="button"
                  className="text"
                  onClick={() => onEdit(rubric, s.id)}
                >
                  Edit
                </button>
              </>
            )}
            {s.system && card && (
              <SystemExplanation card={card} claims={claims} />
            )}
          </li>
        );
      })}
    </ul>
  );
}

/**
 * ADR-0091: why an option's score is a range, not a number. Unknown ratings count as 1 at the
 * low end and 5 at the high end, and the range spans every counted card, so this names the
 * card behind each end, how many unknowns it holds, and the fix: fill them in (a person's
 * card replacing the automatic one) or link evidence and assess again. Ranges are not
 * narrowed by leaving cards out (Jordan, 2026-11-11: "keep it honest").
 */
export function RangeWhy({
  rubric,
  cand,
  cards,
  canEdit,
  ownCardId,
  formOpensSystem,
  onFill,
}: {
  rubric: 'suitability' | 'opportunity';
  cand: RankedCandidate;
  cards: StoredEntity[];
  canEdit: boolean;
  /** The person's own card for this option and rubric, if they have one. */
  ownCardId: string | undefined;
  /** With no card of their own, whether the scoring form would open an automatic card. */
  formOpensSystem: boolean;
  /** Opens the scoring form: on that automatic card, or on the person's own card. */
  onFill: (systemId: string | null) => void;
}) {
  if (cand.score || !cand.range) return null;
  const num = (x: { numerator: string; denominator: string }) =>
    Number(x.numerator) / Number(x.denominator);
  const unknownOf = (id: string) => {
    const b = cards.find((c) => c.id === id)?.body as ScorecardBody | undefined;
    return b
      ? Object.values(b.ratings).filter((r) => r.rating === null).length
      : 0;
  };
  const rows = cand.scorecards.map((c) => ({
    ...c,
    unknown: unknownOf(c.id),
    counted: !c.stale && !c.superseded_by,
  }));
  const ends = rangeEnds(
    rows.map((r) => ({
      id: r.id,
      lower: num(r.lower),
      upper: num(r.upper),
      unknown: r.unknown,
      counted: r.counted,
    })),
  );
  const byId = new Map(rows.map((r) => [r.id, r]));
  const label = (id: string) => {
    const r = byId.get(id)!;
    return r.system
      ? 'the automatic assessment'
      : r.edit_of
        ? `${r.reviewer}’s edit`
        : `${r.reviewer}’s card`;
  };
  const describe = (list: { id: string; unknown: number }[], at: 1 | 5) =>
    list
      .map(
        (e) =>
          `${label(e.id)}${e.unknown ? ` (${e.unknown} unknown rating${e.unknown === 1 ? '' : 's'} counted as ${at} of 5)` : ''}`,
      )
      .join(' and ');
  const name =
    rubric === 'suitability' ? 'Suitability' : 'Software opportunity';
  // The cards with unknowns that the person can fill in: an automatic card through an edit
  // that replaces it, or their own card.
  const fillable = [
    ...new Map(
      [...ends.low, ...ends.high]
        .filter((e) => e.unknown > 0)
        .map((e) => [e.id, byId.get(e.id)!]),
    ).values(),
  ];
  const ownFillable =
    !!ownCardId &&
    fillable.some((r) => r.id.toLowerCase() === ownCardId.toLowerCase());
  const startsOwn = !ownCardId && !formOpensSystem;
  const spread =
    ends.low.length &&
    ends.high.length &&
    !ends.low.some((l) => ends.high.some((h) => h.id === l.id));
  return (
    <div className="small range-why">
      <p>
        <strong>
          {name} {cand.range.lower.display}–{cand.range.upper.display}
        </strong>
        : the low end comes from {describe(ends.low, 1)}; the high end from{' '}
        {describe(ends.high, 5)}.
        {spread
          ? ' The cards disagree, so the range spans both.'
          : ' Unknown is not a neutral score: each unknown rating could be anything from 1 to 5.'}
      </p>
      {canEdit && fillable.length > 0 && (
        <p>
          To narrow it,{' '}
          {fillable
            .filter((r) => r.system)
            .map((r) => (
              <span key={r.id}>
                <button
                  type="button"
                  className="text"
                  onClick={() => onFill(r.id)}
                >
                  fill in the automatic assessment’s unknowns
                </button>{' '}
                (your edit replaces it; the original stays),{' '}
              </span>
            ))}
          {/* Re-review 3 N-1/N-2: the person can fill their own card, or start one when the
              form would not open an automatic card instead; another member's card is not
              theirs to fill. */}
          {ownFillable ? (
            <>
              <button
                type="button"
                className="text"
                onClick={() => onFill(null)}
              >
                fill in your card’s unknowns
              </button>
              ,{' '}
            </>
          ) : startsOwn ? (
            <>
              <button
                type="button"
                className="text"
                onClick={() => onFill(null)}
              >
                score this option yourself
              </button>
              ,{' '}
            </>
          ) : null}
          {fillable.some((r) => r.system) || ownFillable || startsOwn
            ? 'or '
            : ''}
          link evidence to this option and assess again.
        </p>
      )}
    </div>
  );
}

/** One system scorecard's ratings, rationales, cited claims, confidence and provenance. */
function SystemExplanation({
  card,
  claims,
}: {
  card: StoredEntity;
  claims: { id: string; title: string }[];
}) {
  const b = card.body as unknown as ScorecardBody | undefined;
  const a = b?.assessment;
  if (!b || !a) return null;
  const criteria = RUBRICS[b.rubric].criteria;
  const claimName = (id: string, version: number) => {
    const c = claims.find((x) => x.id.toLowerCase() === id.toLowerCase());
    return `${c ? c.title : `claim ${id.slice(0, 8)}`} (v${version})`;
  };
  return (
    <details className="assess-why">
      <summary>Why these ratings</summary>
      <dl>
        {criteria.map((c) => {
          const r = b.ratings[c.key];
          if (!r) return null;
          return (
            <div key={c.key}>
              <dt>
                {c.label}: {r.rating === null ? 'unknown' : `${r.rating} of 5`}
              </dt>
              <dd>
                {r.rationale || 'No rationale given.'}
                {r.evidence_refs.length > 0 && (
                  <span className="muted">
                    {' '}
                    Cites:{' '}
                    {r.evidence_refs
                      .map((e) => claimName(e.id, e.version))
                      .join('; ')}
                    .
                  </span>
                )}
              </dd>
            </div>
          );
        })}
        <div>
          <dt>Confidence: {b.confidence.level}</dt>
          <dd>{b.confidence.rationale}</dd>
        </div>
        {b.software_influence && (
          <div>
            <dt>
              Software influence (not counted):{' '}
              {b.software_influence.rating ?? 'unknown'}
            </dt>
            <dd>{b.software_influence.note}</dd>
          </div>
        )}
        <div>
          <dt>Ethics and access (a person confirms)</dt>
          <dd>
            Ethics {words(b.gates.ethics.status)}: {b.gates.ethics.note} Access{' '}
            {words(b.gates.access.status)}: {b.gates.access.note}
          </dd>
        </div>
        <div>
          <dt>Uncertainty</dt>
          <dd>{a.uncertainty}</dd>
        </div>
      </dl>
      <p className="muted">
        {a.route === 'fixture'
          ? 'Fixture rules'
          : `${a.model_id}${a.provider ? ` via ${a.provider}` : ''} (${a.route})`}{' '}
        · assessed {new Date(card.created_at).toLocaleString()} · problem v
        {a.problem.version} · {a.role_version} · prompt{' '}
        {a.prompt_hash.slice(0, 8)} · rubric {b.rubric_version} · workflow{' '}
        {a.workflow_id.slice(0, 8)}
      </p>
    </details>
  );
}
