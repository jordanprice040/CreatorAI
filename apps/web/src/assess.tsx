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
  type RankedCandidate,
  type ScorecardBody,
  type SessionInfo,
  type StoredEntity,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import { newestFirst } from './versions.js';
import { envelopesFor } from './build-defaults.js';
import { useLoad, type View } from './ui.js';

// P08 automatic assessments (ADR-0074). One request rates every option of this problem on the
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
    const [workflows, envelopes, pricing, connections, preview] =
      await Promise.all([
        api(z.array(WorkflowSchema), `${base}/workflows`),
        api(z.array(EnvelopeSchema), `${base}/budgets`),
        api(z.array(PricingSnapshotSchema), `${base}/pricing`),
        api(z.array(PlanConnectionSchema), `${base}/plan-connections`).catch(
          () => [],
        ),
        api(
          AssessmentPreviewSchema,
          `${base}/problems/${problem.id}/assessment-preview`,
        ).then(
          (data) => ({ data, error: '' }),
          (e: unknown) => ({ data: null, error: message(e) }),
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
      preview,
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
  const [openId, setOpenId] = useState('');
  const [showSent, setShowSent] = useState(false);

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
  const preview = c?.preview.data ?? null;
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
    ...(c?.preview.error ? [c.preview.error] : []),
    ...(resourceKind === 'subscription'
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
  const latest = c?.runs[0];
  const running = !!latest && LIVE.has(latest.state);
  const ready =
    !busy &&
    !!preview &&
    owner &&
    !running &&
    blockers.length === 0 &&
    StartAssessmentRequestSchema.safeParse(request).success;

  async function start() {
    if (!ready) return;
    setBusy(true);
    setError('');
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
        One model request rates every option of this problem on the rubrics that
        apply, citing the claims linked to it, or says unknown. The studio
        checks every reference, records one scorecard per option and rubric, and
        computes the totals and ranks itself. You can edit any rating below as
        your own scorecard; the original stays. Only you can clear an ethics or
        access gate, and nothing is selected for you.
      </p>
      {ctx.error && <p className="error">{ctx.error}</p>}
      {c && (
        <>
          {preview && (
            <p className="small">
              Will send {preview.packet.options.length} option
              {preview.packet.options.length === 1 ? '' : 's'} and{' '}
              {preview.packet.claims.length} linked claim
              {preview.packet.claims.length === 1 ? '' : 's'} (
              {preview.chars.toLocaleString()} of{' '}
              {preview.limit.toLocaleString()} characters).{' '}
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
          {showSent && preview && <Packet packet={preview.packet} />}
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
                  ? 'One request on your plan (plus one retry if the answer is malformed), within the connection’s accepted caps. No API spending.'
                  : `Metered under ${envelope?.name ?? 'no budget'}; at most two calls.`}{' '}
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
          ) : (
            <p className="small">Only the workspace owner can start one.</p>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
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
              {c.ref} · {words(c.relation)} · {words(c.status)} ·{' '}
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
