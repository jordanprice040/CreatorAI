import { useEffect, useState, type FormEvent } from 'react';
import {
  AUTOPILOT_MIN_CALLS,
  AUTOPILOT_RETRYABLE,
  autopilotContinuable,
  AUTOPILOT_STAGE_LABEL,
  AutopilotConfigSchema,
  AutopilotSchema,
  EvidenceRoleSchema,
  RunControlSchema,
  StoredEntitySchema,
  WebDiscoveryPreviewSchema,
  autopilotRoutinePolicy,
  autopilotSummary,
  routinePolicySummary,
  z,
  type Autopilot as AutopilotRecord,
  type AutopilotConfig,
  type EvidenceRole,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when, words } from './oversight.js';
import {
  AUTOPILOTS_CHANGED,
  loadRoutes,
  pickRoute,
  planOf,
  resourceSetupOf,
  routesOf,
} from './autopilot-routes.js';
import { Empty, Status, useLoad } from './ui.js';
import { usePoll } from './page-active.js';
import { useEndTime } from './end-time.js';
import { AllowAndContinue } from './autopilot-next.js';
import { useAutopilotSettings } from './autopilot-settings.js';

// P13 (ADR-0092): "Run it for me". One form sets up a new run with routine approvals covering
// exactly the autopilot's steps and starts the autopilot; the owner confirms both summaries.
// The list below shows each autopilot's steps as they happen, why it stopped, and Stop or
// Continue. The autopilot itself runs on the server; leaving the page does not stop it.

const ROLE_LABEL: Record<EvidenceRole, string> = {
  problem: 'the problem',
  affected_users: 'who is affected',
  urgency: 'urgency',
  workaround: 'the current workaround',
  existing_tool: 'an existing tool',
  tool_gap: 'a tool gap',
  data: 'available data',
  mechanism: 'a cross-field mechanism',
};
const OUTCOME_LABEL: Record<string, string> = {
  proposal: 'Finished: proposal saved',
  insufficient_evidence: 'Stopped: not enough evidence',
  no_eligible_option: 'Stopped: no option can go ahead',
  needs_person: 'Waiting for you',
  needs_authority: 'Stopped: needs an approval',
  limit_reached: 'Stopped: limit reached',
  failed: 'Stopped: a step failed',
  cancelled: 'Stopped by you',
};
const MARK: Record<string, string> = {
  done: '✓',
  running: '…',
  stopped: '✗',
  skipped: '–',
};
const list = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

export function Autopilot({
  session,
  workspace,
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const base = `workspaces/${workspace.id}`;
  // ADR-0100: a web search the owner's settings allow needs the run's approvals to cover it.
  const settings = useAutopilotSettings(base);
  const owner = workspace.role === 'owner';
  const fixture = workspace.record_mode === 'fixture';
  const ctx = useLoad(async () => {
    const [autopilots, routing] = await Promise.all([
      api(z.array(AutopilotSchema), `${base}/autopilots`),
      loadRoutes(base),
    ]);
    return { autopilots, ...routing };
  }, [workspace.id]);
  const c = ctx.data;
  // The automation levels panel starts autopilots too (P33).
  useEffect(() => {
    const again = () => ctx.refresh();
    window.addEventListener(AUTOPILOTS_CHANGED, again);
    return () => window.removeEventListener(AUTOPILOTS_CHANGED, again);
  }, [workspace.id]);
  // Read again while one runs; the server drives it, the page only watches.
  const running = c?.autopilots.some((a) => a.state === 'running') ?? false;
  usePoll(() => ctx.refresh(), 3000, running);

  const routes = routesOf(c ?? null, fixture);
  const [routeKey, setRouteKey] = useState('');
  const route = pickRoute(routes, routeKey, fixture);
  const [search, setSearch] = useState(false);
  const [interests, setInterests] = useState('');
  const [groups, setGroups] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [roles, setRoles] = useState<EvidenceRole[]>(['problem']);
  const [maxCalls, setMaxCalls] = useState(60);
  const [hours, setHours] = useState(4);
  const [money, setMoney] = useState(5);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // The end time is fixed while the owner reads the summary, so the summary read is the one
  // sent. It is worked out again when the hours change, and when the page comes back into view
  // unless the summary is confirmed (then only once the end time is close or past).
  const [endsAt] = useEndTime(hours, undefined, confirmed);
  const [pickedClass, setPickedClass] = useState<
    'synthetic' | 'public' | 'private_approved'
  >(fixture ? 'synthetic' : 'public');
  // Web search reads public pages, so the data class is public (synthetic in a fixture workspace)
  // while it is on; otherwise the owner picks it, as in Explore for me (review L-4).
  const dataClass =
    search && route?.kind === 'plan' && route.chatgpt
      ? fixture
        ? 'synthetic'
        : 'public'
      : pickedClass;
  const plan = planOf(c ?? null, route);
  const researchOn = search && route?.kind === 'plan' && route.chatgpt;
  const webScope = {
    interests: list(interests),
    target_groups: list(groups),
    question: null,
    exclusions: list(exclusions),
    excluded_hosts: [],
    max_search_calls: 3,
    max_fetches: 8,
    max_claims: 8,
  };
  const draft = AutopilotConfigSchema.safeParse({
    resource_setup: resourceSetupOf(c ?? null, route),
    data_class: dataClass,
    research: researchOn
      ? {
          connection_id: route.connection,
          model_id: route.model,
          scope: webScope,
          // Filled from the preview just before the start.
          input_hash: '0'.repeat(64),
        }
      : null,
    explore: {
      interests: list(interests),
      target_groups: list(groups),
      exclusions: list(exclusions),
    },
    evidence_roles: roles,
    limits: { max_calls: maxCalls, ends_at: endsAt },
  });
  const config: AutopilotConfig | null = draft.success ? draft.data : null;
  const moneyNano =
    route?.kind === 'api'
      ? String(BigInt(Math.round(money * 100)) * 10_000_000n)
      : null;
  const policy = config
    ? autopilotRoutinePolicy(config, moneyNano, {
        gatherSearch:
          !!settings?.gather_evidence && settings.max_extra_searches > 0,
      })
    : null;
  // PR #191 review R-N1: what the owner ticked is the two summaries as read; any change to them
  // (the end time included) unticks it, as in the automation levels panel.
  const summariesRead = JSON.stringify([
    config ? autopilotSummary(config) : null,
    policy ? routinePolicySummary(policy) : null,
  ]);
  useEffect(() => setConfirmed(false), [summariesRead]);
  const blockers = [
    ...(!route
      ? [
          'Add a model under Models and connections (a verified plan model) or a budget with pricing first.',
        ]
      : []),
    ...(plan?.blockers ?? []),
    ...(!draft.success ? draft.error.issues.map((i) => i.message) : []),
    ...(search && !researchOn
      ? [
          'Searching the web needs a ChatGPT plan model; choose one or untick the search.',
        ]
      : []),
  ];
  const ready =
    owner &&
    !busy &&
    !!config &&
    !!policy &&
    confirmed &&
    blockers.length === 0;

  async function start(e: FormEvent) {
    e.preventDefault();
    if (!ready || !config || !policy) return;
    setBusy(true);
    setError('');
    let runId = '';
    try {
      let cfg = config;
      if (cfg.research) {
        const preview = await api(
          WebDiscoveryPreviewSchema,
          `${base}/web-discovery-preview`,
          {
            csrf: session.csrf_token,
            body: cfg.research.scope,
          },
        );
        cfg = {
          ...cfg,
          research: { ...cfg.research, input_hash: preview.input_hash },
        };
      }
      const stamp = new Date().toLocaleString(undefined, {
        dateStyle: 'medium',
        timeStyle: 'short',
      });
      const run = await api(StoredEntitySchema, `${base}/entities`, {
        csrf: session.csrf_token,
        body: {
          kind: 'run',
          title: `Autopilot · ${stamp}`,
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
      // P-11: the approvals are made with the autopilot, so they end when it ends.
      await api(AutopilotSchema, `${base}/runs/${runId}/autopilots`, {
        csrf: session.csrf_token,
        body: {
          config: cfg,
          summary_seen: autopilotSummary(cfg),
          routine_policy: {
            kind: 'new',
            policy: { ...policy, summary_seen: routinePolicySummary(policy) },
          },
        },
        timeoutMs: 30_000,
      });
      setConfirmed(false);
      ctx.refresh();
    } catch (err) {
      setError(message(err));
      if (runId)
        await api(RunControlSchema, `${base}/runs/${runId}/cancel`, {
          csrf: session.csrf_token,
          body: { reason: 'The autopilot did not start.' },
        }).catch(() => undefined);
      ctx.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function control(a: AutopilotRecord, what: 'cancel' | 'continue') {
    setBusy(true);
    setError('');
    try {
      await api(AutopilotSchema, `${base}/autopilots/${a.id}/${what}`, {
        csrf: session.csrf_token,
        body:
          what === 'cancel'
            ? { reason: 'Stopped from the Discover page.' }
            : { expected_version: a.version },
      });
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
      ctx.refresh();
    }
  }

  return (
    <section className="explore" aria-labelledby="autopilot-title">
      <h3 id="autopilot-title">Run it for me (autopilot)</h3>
      <p>
        The studio takes the whole path for you, one step after another:{' '}
        {researchOn ? 'search the web, ' : ''}explore the claims, write a brief
        from the first candidate problem, run discovery, assess every option,
        choose by a fixed rule, and save a proposal for a non-code option. Each
        step is the same server step the forms use, admitted by routine
        approvals made for this run only. It stops and says why when a step
        needs you: a tie or close ranking, ethics and access to confirm, a
        software option (its spec stays with you), or a limit.
      </p>
      <Status
        loading={ctx.loading}
        error={ctx.error}
        stale={ctx.stale}
        retry={ctx.reload}
      >
        {c && (
          <>
            {owner ? (
              <form onSubmit={(e) => void start(e)} noValidate>
                <label htmlFor="ap-route">Model</label>
                <select
                  id="ap-route"
                  value={route?.key ?? ''}
                  onChange={(e) => setRouteKey(e.target.value)}
                >
                  {routes.map((r) => (
                    <option key={r.key} value={r.key}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <details>
                  <summary>Narrow it and set limits</summary>
                  <div className="two">
                    <div>
                      <label htmlFor="ap-interests">Interests or fields</label>
                      <input
                        id="ap-interests"
                        value={interests}
                        onChange={(e) => setInterests(e.target.value)}
                      />
                    </div>
                    <div>
                      <label htmlFor="ap-groups">Who it might help</label>
                      <input
                        id="ap-groups"
                        value={groups}
                        onChange={(e) => setGroups(e.target.value)}
                      />
                    </div>
                  </div>
                  <label htmlFor="ap-exclusions">Leave out topics</label>
                  <input
                    id="ap-exclusions"
                    value={exclusions}
                    onChange={(e) => setExclusions(e.target.value)}
                  />
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={search}
                      disabled={!(route?.kind === 'plan' && route.chatgpt)}
                      onChange={(e) => setSearch(e.target.checked)}
                    />{' '}
                    Search the web first (ChatGPT plan models only)
                  </label>
                  <label htmlFor="ap-class">Evidence sharing class</label>
                  <select
                    id="ap-class"
                    value={dataClass}
                    disabled={search && route?.kind === 'plan' && route.chatgpt}
                    onChange={(e) =>
                      setPickedClass(e.target.value as typeof pickedClass)
                    }
                  >
                    <option value="synthetic">Synthetic</option>
                    <option value="public">Public</option>
                    <option value="private_approved">
                      Private · approved provider sharing required
                    </option>
                  </select>
                  <p className="small">
                    {search && route?.kind === 'plan' && route.chatgpt
                      ? 'Searching the web works with public data only; untick it to work from private claims.'
                      : 'Every step sends claims of this class to the model; the connection and the run’s approvals must allow it.'}
                  </p>
                  <fieldset>
                    <legend>
                      What the chosen problem's claims show (your judgment)
                    </legend>
                    {EvidenceRoleSchema.options.map((r) => (
                      <label key={r} className="check">
                        <input
                          type="checkbox"
                          checked={roles.includes(r)}
                          onChange={(e) =>
                            setRoles((x) =>
                              e.target.checked
                                ? [...x, r]
                                : x.filter((y) => y !== r),
                            )
                          }
                        />{' '}
                        {ROLE_LABEL[r]}
                      </label>
                    ))}
                    <p className="small">
                      Discovery treats every claim of the chosen problem as
                      evidence of these. A software option needs available data
                      and a tool gap; an existing tool needs an existing tool.
                    </p>
                  </fieldset>
                  <div className="two">
                    <div>
                      <label htmlFor="ap-calls">Model calls in all</label>
                      <input
                        id="ap-calls"
                        type="number"
                        min={
                          researchOn
                            ? AUTOPILOT_MIN_CALLS + 2
                            : AUTOPILOT_MIN_CALLS
                        }
                        value={maxCalls}
                        onChange={(e) => setMaxCalls(Number(e.target.value))}
                      />
                      <p className="small">
                        At least {AUTOPILOT_MIN_CALLS}
                        {researchOn
                          ? ` (${AUTOPILOT_MIN_CALLS + 2} with web search)`
                          : ''}
                        : exploring, discovery and assessment need about that
                        many on the shortest path.
                      </p>
                    </div>
                    <div>
                      <label htmlFor="ap-hours">Stop after (hours)</label>
                      <input
                        id="ap-hours"
                        type="number"
                        min={1}
                        max={720}
                        value={hours}
                        onChange={(e) => setHours(Number(e.target.value))}
                      />
                    </div>
                  </div>
                  {route?.kind === 'api' && (
                    <>
                      <label htmlFor="ap-money">
                        Money limit ({fixture ? 'simulated units' : 'dollars'})
                      </label>
                      <input
                        id="ap-money"
                        type="number"
                        min={0}
                        step={0.5}
                        value={money}
                        onChange={(e) => setMoney(Number(e.target.value))}
                      />
                    </>
                  )}
                </details>
                {config && policy && (
                  <div className="notice">
                    <p>
                      <strong>What the autopilot does</strong>
                    </p>
                    <ul>
                      {autopilotSummary(config).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                    <p>
                      <strong>Routine approvals for its new run</strong>
                    </p>
                    <ul>
                      {routinePolicySummary(policy).map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{' '}
                  I have read both summaries; start a new run with these routine
                  approvals and run the autopilot on it. The approvals end when
                  the autopilot ends, except while it waits for me.
                </label>
                {blockers.length > 0 && (
                  <ul className="error">
                    {blockers.map((b) => (
                      <li key={b}>{b}</li>
                    ))}
                  </ul>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
                <button type="submit" disabled={!ready}>
                  {busy ? 'Starting…' : 'Start the autopilot'}
                </button>
              </form>
            ) : (
              <p className="small">
                Only the workspace owner can start an autopilot.
              </p>
            )}
            {c.autopilots.length === 0 ? (
              <Empty>No autopilot has run in this workspace yet.</Empty>
            ) : (
              c.autopilots.slice(0, 5).map((a) => (
                <article key={a.id} className="card" aria-label="Autopilot">
                  <p>
                    <strong>
                      {a.state === 'running'
                        ? `Working: ${AUTOPILOT_STAGE_LABEL[a.stage].toLowerCase()}`
                        : (OUTCOME_LABEL[a.outcome ?? ''] ??
                          words(a.outcome ?? ''))}
                    </strong>{' '}
                    <span className="small">
                      {a.automation_id
                        ? 'Automate selection · '
                        : a.config.start
                          ? 'Automate the rest · '
                          : ''}
                      started {when(a.created_at)} · {a.calls_reserved} of{' '}
                      {a.config.limits.max_calls} calls set aside
                      {a.state === 'running' && !a.active
                        ? ' · not being driven by this studio process (it carries on after a restart)'
                        : ''}
                    </span>
                  </p>
                  <p>{a.explanation}</p>
                  <ol className="small">
                    {a.steps.map((s, i) => (
                      <li key={i}>
                        {MARK[s.state]} {AUTOPILOT_STAGE_LABEL[s.stage]}
                        {s.attempt > 1 ? ` (try ${s.attempt})` : ''}: {s.note}
                      </li>
                    ))}
                  </ol>
                  {owner && a.state === 'running' && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void control(a, 'cancel')}
                    >
                      Stop
                    </button>
                  )}
                  {owner &&
                    a.state === 'finished' &&
                    a.outcome &&
                    (AUTOPILOT_RETRYABLE.includes(a.outcome) ||
                      autopilotContinuable(a).ok) &&
                    (() => {
                      const can = autopilotContinuable(a);
                      return can.ok ? (
                        <button
                          disabled={busy}
                          onClick={() => void control(a, 'continue')}
                        >
                          Continue from{' '}
                          {AUTOPILOT_STAGE_LABEL[a.stage].toLowerCase()}
                        </button>
                      ) : (
                        <p className="small">{can.reason}</p>
                      );
                    })()}
                  <AllowAndContinue
                    a={a}
                    base={base}
                    session={session}
                    owner={owner}
                    onDone={() => ctx.refresh()}
                  />
                </article>
              ))
            )}
          </>
        )}
      </Status>
    </section>
  );
}
