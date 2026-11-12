import { useEffect, useState } from 'react';
import {
  AUTOMATION_LEVEL_TEXT,
  AUTOMATION_SELECTION_ACTIONS,
  AUTOPILOT_RETRYABLE,
  AUTOPILOT_MIN_CALLS,
  AutopilotConfigSchema,
  AutopilotSchema,
  RoutinePolicyViewSchema,
  RunAutomationSchema,
  RunControlSchema,
  StoredEntitySchema,
  automationStagesNeeded,
  autopilotSummary,
  policyCovering,
  policyInputOf,
  restRoutinePolicy,
  routinePolicySummary,
  runAutomationSummary,
  selectionRoutinePolicy,
  z,
  type AutomationLevel,
  type Autopilot,
  type RoutinePolicyInput,
  type RoutinePolicyView,
  routineStopFix,
  routineIdleReasons,
  type RunAutomation,
  type RunControl,
  type SessionInfo,
  type Workspace,
} from '@creator/contracts';
import { api, message, when } from './oversight.js';
import { newestFirst } from './versions.js';
import { runLabel } from './labels.js';
import {
  AUTOPILOTS_CHANGED,
  loadRoutes,
  pickRoute,
  planOf,
  resourceSetupOf,
  routesOf,
} from './autopilot-routes.js';
import { Empty, Status, useLoad } from './ui.js';

// P33 (ADR-0099): how much of a project is automated. Four levels, each a preset over what
// already exists: Manual; Automate selection (a standing level on the run that starts a
// selection-only autopilot whenever an assessment on the run finishes); Automate the rest (an
// autopilot entering the path at a recorded problem); Whole process (Run it for me, above). The
// run's routine approvals are set or widened here as a preset the owner confirms as one summary,
// through the same routes as Monitor › Approvals; the server checks everything again.

type DataClass = 'synthetic' | 'public' | 'private_approved';

/** What a run is automated at now, read from its records. */
export function currentLevel(
  runId: string,
  automations: readonly RunAutomation[],
  /** Newest first, as the server lists them. */
  autopilots: readonly Pick<
    Autopilot,
    'run_id' | 'state' | 'config' | 'outcome' | 'automation_id'
  >[],
): { level: AutomationLevel; note: string } {
  const standing = automations.find(
    (a) => a.run_id === runId && a.state === 'active',
  );
  if (standing)
    return {
      level: 'selection',
      note: `since ${when(standing.created_at)}; ${standing.started} choice${standing.started === 1 ? '' : 's'} started so far`,
    };
  // The newest autopilot on the run, while it works or waits for you to continue it.
  const latest = autopilots.find((a) => a.run_id === runId);
  if (
    latest &&
    (latest.state === 'running' ||
      (latest.outcome !== null && AUTOPILOT_RETRYABLE.includes(latest.outcome)))
  ) {
    // An autopilot a selection level started that is still working or waiting after the level
    // ended: the run is Manual now (review L-3, review 2 N-1).
    if (latest.automation_id)
      return {
        level: 'manual',
        note:
          latest.state === 'running'
            ? 'a choice Automate selection started is still working; stop it under Run it for me'
            : 'a choice Automate selection started is waiting for you; see Run it for me',
      };
    const note =
      latest.state === 'running'
        ? 'its autopilot is working now; stop it under Run it for me'
        : 'its autopilot stopped and waits for you; see Run it for me';
    return { level: latest.config.start ? 'rest' : 'whole', note };
  }
  return { level: 'manual', note: 'you take every step' };
}

/**
 * The routine approvals step a level needs on the run: a new policy (none active), a revision
 * of the active one (it does not cover the level yet), or nothing (it already covers it).
 */
export function policyStep(
  view: RoutinePolicyView | undefined,
  fresh: RoutinePolicyInput,
  need: {
    stages: RoutinePolicyInput['stages'];
    extraActions: number;
  },
):
  | { kind: 'new'; input: RoutinePolicyInput }
  | { kind: 'revise'; input: RoutinePolicyInput; view: RoutinePolicyView }
  | { kind: 'covered'; view: RoutinePolicyView } {
  if (!view) return { kind: 'new', input: fresh };
  const next = policyCovering(policyInputOf(view.policy), {
    stages: need.stages,
    data_classes: fresh.data_classes,
    ends_at: fresh.expires_at,
    extraActions: need.extraActions,
    max_total_nano_usd: fresh.max_total_nano_usd,
    used: view.used_actions,
    used_nano_usd: view.used_nano_usd,
  });
  return next
    ? { kind: 'revise', input: next, view }
    : { kind: 'covered', view };
}

export function Automation({
  session,
  workspace,
}: {
  session: SessionInfo;
  workspace: Workspace;
}) {
  const base = `workspaces/${workspace.id}`;
  const owner = workspace.role === 'owner';
  const fixture = workspace.record_mode === 'fixture';
  const ctx = useLoad(async () => {
    const [runs, names, policies, automations, autopilots, problems, routing] =
      await Promise.all([
        api(z.array(RunControlSchema), `${base}/runs`),
        api(
          z.array(z.object({ id: z.string(), title: z.string() })),
          `${base}/entities?kind=run`,
        ).catch(() => []),
        api(z.array(RoutinePolicyViewSchema), `${base}/routine-policies`),
        api(z.array(RunAutomationSchema), `${base}/automations`),
        api(z.array(AutopilotSchema), `${base}/autopilots`),
        api(
          z.array(StoredEntitySchema),
          `${base}/entities?kind=problem&status=active`,
        ).catch(() => []),
        loadRoutes(base),
      ]);
    return {
      runs: newestFirst(runs).filter(
        (r) =>
          r.state === 'active' &&
          (r.autonomy_mode === 'supervised' ||
            r.autonomy_mode === 'human_in_loop') &&
          r.experiment_condition !== 'human_only',
      ),
      names: new Map(names.map((n) => [n.id, n.title])),
      policies,
      automations,
      autopilots,
      problems: newestFirst(problems.filter((p) => p.status === 'active')),
      routing,
    };
  }, [workspace.id]);
  const c = ctx.data;
  const watching =
    (c?.autopilots.some((a) => a.state === 'running') ?? false) ||
    (c?.automations.some((a) => a.state === 'active') ?? false);
  useEffect(() => {
    if (!watching) return;
    const t = setInterval(() => ctx.refresh(), 10_000);
    return () => clearInterval(t);
  }, [watching]);

  const [runId, setRunId] = useState('');
  const run: RunControl | undefined =
    c?.runs.find((r) => r.run_id === runId) ?? c?.runs[0];
  const [level, setLevel] = useState<'selection' | 'rest' | 'whole'>(
    'selection',
  );
  const routes = routesOf(c?.routing ?? null, fixture);
  const [routeKey, setRouteKey] = useState('');
  const route = pickRoute(routes, routeKey, fixture);
  const plan = planOf(c?.routing ?? null, route);
  const [dataClass, setDataClass] = useState<DataClass>(
    fixture ? 'synthetic' : 'public',
  );
  const [problemId, setProblemId] = useState('');
  const problem = c?.problems.find((p) => p.id === problemId) ?? c?.problems[0];
  const [startAt, setStartAt] = useState<'assess' | 'select'>('assess');
  const [maxCalls, setMaxCalls] = useState(30);
  const [hours, setHours] = useState(24);
  const [money, setMoney] = useState(5);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [endsAt, setEndsAt] = useState(() => endAfter(24));
  useEffect(() => setEndsAt(endAfter(hours)), [hours]);
  // Any change needs the summaries read again.
  useEffect(
    () => setConfirmed(false),
    [
      run?.run_id,
      level,
      route?.key,
      dataClass,
      problem?.id,
      startAt,
      maxCalls,
      endsAt,
      money,
    ],
  );

  const standing = c?.automations.find(
    (a) => a.run_id === run?.run_id && a.state === 'active',
  );
  const view = c?.policies.find(
    (v) => v.policy.run_id === run?.run_id && v.policy.status === 'active',
  );
  const moneyNano =
    route?.kind === 'api' && level === 'rest' && startAt === 'assess'
      ? String(BigInt(Math.round(money * 100)) * 10_000_000n)
      : null;

  // "Automate selection": the level's config and its policy preset.
  const selectionConfig = {
    resource_setup: resourceSetupOf(c?.routing ?? null, route),
    data_class: dataClass,
    ends_at: endsAt,
  };
  // "Automate the rest": an autopilot entering at the chosen problem.
  const restDraft = AutopilotConfigSchema.safeParse({
    resource_setup: resourceSetupOf(c?.routing ?? null, route),
    data_class: dataClass,
    limits: {
      max_calls: startAt === 'select' ? AUTOPILOT_MIN_CALLS : maxCalls,
      ends_at: endsAt,
    },
    start: problem
      ? {
          stage: startAt,
          problem: { id: problem.id, version: problem.version },
        }
      : null,
  });
  const restConfig = restDraft.success ? restDraft.data : null;

  const step =
    level === 'selection'
      ? policyStep(view, selectionRoutinePolicy(selectionConfig), {
          stages: automationStagesNeeded('selection'),
          extraActions: AUTOMATION_SELECTION_ACTIONS,
        })
      : level === 'rest' && restConfig
        ? policyStep(view, restRoutinePolicy(restConfig, moneyNano), {
            stages: automationStagesNeeded('rest', { start: startAt }),
            extraActions: restConfig.limits.max_calls + 20,
          })
        : null;
  const levelSummary =
    level === 'selection'
      ? runAutomationSummary(selectionConfig)
      : level === 'rest' && restConfig
        ? autopilotSummary(restConfig)
        : [];

  const blockers = [
    ...(!run
      ? [
          'There is no active supervised or human-in-the-loop run. Start one from Discover, or use Run it for me for the whole process.',
        ]
      : []),
    ...(level !== 'whole' && !route
      ? [
          'Add a model under Models and connections (a verified plan model) or a budget with pricing first.',
        ]
      : []),
    ...(level !== 'whole' ? (plan?.blockers ?? []) : []),
    ...(level === 'selection' && standing
      ? [
          'This run already automates selection. Set it back to Manual below to change it.',
        ]
      : []),
    ...(level === 'rest' && !problem
      ? ['There is no recorded problem yet; run discovery first.']
      : []),
    ...(level === 'rest' && !restDraft.success
      ? restDraft.error.issues.map((i) => i.message)
      : []),
    // Used-up steps or a passed end time are what the widened approvals fix, so Apply goes
    // ahead with them; a stop condition (a rejected decision, an unknown outcome) is the
    // owner's to look at first, even alongside those (review 2 L-1, review 3 L-1).
    ...(level !== 'whole' && view && view.state !== 'revoked'
      ? view.stop_reason
        ? [
            `This run's routine approvals stopped: ${view.stop_reason} ${routineStopFix(view.stop_reason)}`,
          ]
        : view.state === 'paused' && view.used_actions < view.policy.max_actions
          ? [
              `This run's routine approvals admit nothing now: ${view.state_reason ?? view.state}. Fix that under Monitor › Approvals first.`,
            ]
          : []
      : []),
    ...(level !== 'whole' && hours > 24 * 90
      ? ['Choose at most 2160 hours (90 days).']
      : []),
  ];
  const ready =
    owner &&
    !busy &&
    level !== 'whole' &&
    !!step &&
    levelSummary.length > 0 &&
    confirmed &&
    blockers.length === 0;

  async function apply() {
    if (!ready || !run || !step) return;
    // The form may have stayed open: an end time that is (nearly) here is set again, and the
    // owner reads the summaries again before applying (review N-3).
    if (Date.parse(endsAt) < Date.now() + 5 * 60_000) {
      setEndsAt(endAfter(hours));
      setError(
        'The end time came too close while the form was open; it was set again. Read the summaries again and confirm.',
      );
      return;
    }
    setBusy(true);
    setError('');
    try {
      // The approvals change goes in the same request, so it is made only if the level or
      // autopilot starts (review L-1).
      const routine_policy =
        step.kind === 'new'
          ? {
              kind: 'new' as const,
              policy: {
                ...step.input,
                summary_seen: routinePolicySummary(step.input),
              },
            }
          : step.kind === 'revise'
            ? {
                kind: 'revise' as const,
                policy_id: step.view.policy.id,
                policy: {
                  ...step.input,
                  summary_seen: routinePolicySummary(step.input),
                  expected_version: step.view.policy.version,
                },
              }
            : null;
      if (level === 'selection')
        await api(
          RunAutomationSchema,
          `${base}/runs/${run.run_id}/automation`,
          {
            csrf: session.csrf_token,
            body: {
              level: 'selection',
              config: selectionConfig,
              summary_seen: runAutomationSummary(selectionConfig),
              routine_policy,
            },
          },
        );
      else if (restConfig)
        await api(AutopilotSchema, `${base}/runs/${run.run_id}/autopilots`, {
          csrf: session.csrf_token,
          body: {
            config: restConfig,
            summary_seen: autopilotSummary(restConfig),
            routine_policy,
          },
          timeoutMs: 30_000,
        });
      setConfirmed(false);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      ctx.refresh();
      // Run it for me lists every autopilot, including the ones started here.
      window.dispatchEvent(new Event(AUTOPILOTS_CHANGED));
    }
  }

  async function manual(a: RunAutomation) {
    setBusy(true);
    setError('');
    try {
      await api(RunAutomationSchema, `${base}/automations/${a.id}/stop`, {
        csrf: session.csrf_token,
        body: {
          expected_version: a.version,
          reason: 'Set to Manual from the Discover page.',
        },
      });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
      ctx.refresh();
      window.dispatchEvent(new Event(AUTOPILOTS_CHANGED));
    }
  }

  const name = (id: string) => {
    const r = c?.runs.find((x) => x.run_id === id);
    return r && c ? runLabel(r, c.names) : `run ${id.slice(0, 8)}`;
  };

  return (
    <section className="explore" aria-labelledby="automation-title">
      <h3 id="automation-title">How much is automated</h3>
      <p>
        Choose how much of a project the studio does for you. Every level uses
        routine approvals made for that run only, which you confirm here as one
        summary; the studio never approves its own steps. Publishing, messages,
        payments, value questions and an ethics gate only the model cleared
        always stop for you.
      </p>
      <ul className="small">
        {(['manual', 'selection', 'rest', 'whole'] as const).map((l) => (
          <li key={l}>
            <strong>{AUTOMATION_LEVEL_TEXT[l].label}:</strong>{' '}
            {AUTOMATION_LEVEL_TEXT[l].text}
          </li>
        ))}
      </ul>
      <Status loading={ctx.loading} error={ctx.error} retry={ctx.reload}>
        {c && (
          <>
            {c.runs.length > 0 && (
              <>
                <label htmlFor="am-run">Project (run)</label>
                <select
                  id="am-run"
                  value={run?.run_id ?? ''}
                  onChange={(e) => setRunId(e.target.value)}
                >
                  {c.runs.map((r) => (
                    <option key={r.run_id} value={r.run_id}>
                      {runLabel(r, c.names)}
                    </option>
                  ))}
                </select>
                {run && (
                  <p className="small" aria-live="polite">
                    {(() => {
                      const now = currentLevel(
                        run.run_id,
                        c.automations,
                        c.autopilots,
                      );
                      return `Now: ${AUTOMATION_LEVEL_TEXT[now.level].label} (${now.note}).`;
                    })()}
                    {view
                      ? ` Routine approvals: ${view.state}, ${view.used_actions} of ${view.policy.max_actions} steps used.`
                      : ' No routine approvals on this run yet.'}
                  </p>
                )}
              </>
            )}
            {owner ? (
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  void apply();
                }}
              >
                <fieldset>
                  <legend>Level</legend>
                  {(['selection', 'rest', 'whole'] as const).map((l) => (
                    <label key={l} className="check">
                      <input
                        type="radio"
                        name="am-level"
                        checked={level === l}
                        onChange={() => setLevel(l)}
                      />{' '}
                      {AUTOMATION_LEVEL_TEXT[l].label}
                    </label>
                  ))}
                </fieldset>
                {level === 'whole' ? (
                  <p className="notice">
                    The whole process runs on a new run, so nothing here
                    changes. Use{' '}
                    <button
                      type="button"
                      className="text"
                      onClick={(e) =>
                        e.currentTarget
                          .closest('section')
                          ?.parentElement?.querySelector('#autopilot-title')
                          ?.scrollIntoView({ behavior: 'smooth' })
                      }
                    >
                      Run it for me
                    </button>{' '}
                    above.
                  </p>
                ) : (
                  <>
                    {level === 'rest' && (
                      <>
                        <label htmlFor="am-problem">
                          Start from the problem
                        </label>
                        <select
                          id="am-problem"
                          value={problem?.id ?? ''}
                          onChange={(e) => setProblemId(e.target.value)}
                        >
                          {c.problems.map((p) => (
                            <option key={p.id} value={p.id}>
                              {p.title} · v{p.version} · {when(p.created_at)}
                            </option>
                          ))}
                        </select>
                        <fieldset>
                          <legend>Where it starts</legend>
                          <label className="check">
                            <input
                              type="radio"
                              name="am-start"
                              checked={startAt === 'assess'}
                              onChange={() => setStartAt('assess')}
                            />{' '}
                            Assess every option, then choose
                          </label>
                          <label className="check">
                            <input
                              type="radio"
                              name="am-start"
                              checked={startAt === 'select'}
                              onChange={() => setStartAt('select')}
                            />{' '}
                            Choose from the scores already recorded (no model
                            call)
                          </label>
                        </fieldset>
                      </>
                    )}
                    <label htmlFor="am-route">Model</label>
                    <select
                      id="am-route"
                      value={route?.key ?? ''}
                      onChange={(e) => setRouteKey(e.target.value)}
                    >
                      {routes.map((r) => (
                        <option key={r.key} value={r.key}>
                          {r.label}
                        </option>
                      ))}
                    </select>
                    {level === 'selection' && (
                      <p className="small">
                        Choosing makes no model call; the model named here is
                        only recorded with each choice.
                      </p>
                    )}
                    <label htmlFor="am-class">Evidence sharing class</label>
                    <select
                      id="am-class"
                      value={dataClass}
                      onChange={(e) =>
                        setDataClass(e.target.value as DataClass)
                      }
                    >
                      <option value="synthetic">Synthetic</option>
                      <option value="public">Public</option>
                      <option value="private_approved">
                        Private · approved provider sharing required
                      </option>
                    </select>
                    <div className="two">
                      {level === 'rest' && startAt === 'assess' && (
                        <div>
                          <label htmlFor="am-calls">Model calls in all</label>
                          <input
                            id="am-calls"
                            type="number"
                            min={AUTOPILOT_MIN_CALLS}
                            value={maxCalls}
                            onChange={(e) =>
                              setMaxCalls(Number(e.target.value))
                            }
                          />
                        </div>
                      )}
                      <div>
                        <label htmlFor="am-hours">Stop after (hours)</label>
                        <input
                          id="am-hours"
                          type="number"
                          min={1}
                          max={2160}
                          value={hours}
                          onChange={(e) => setHours(Number(e.target.value))}
                        />
                      </div>
                    </div>
                    {level === 'rest' &&
                      startAt === 'assess' &&
                      route?.kind === 'api' && (
                        <>
                          <label htmlFor="am-money">
                            Money limit (
                            {fixture ? 'simulated units' : 'dollars'})
                          </label>
                          <input
                            id="am-money"
                            type="number"
                            min={0}
                            step={0.5}
                            value={money}
                            onChange={(e) => setMoney(Number(e.target.value))}
                          />
                        </>
                      )}
                    {step && levelSummary.length > 0 && (
                      <div className="notice">
                        <p>
                          <strong>
                            What {AUTOMATION_LEVEL_TEXT[level].label} does
                          </strong>
                        </p>
                        <ul>
                          {levelSummary.map((l) => (
                            <li key={l}>{l}</li>
                          ))}
                        </ul>
                        <p>
                          <strong>
                            {step.kind === 'new'
                              ? 'Routine approvals this run gets'
                              : step.kind === 'revise'
                                ? `This run’s routine approvals, widened to cover it${
                                    step.view.state !== 'active'
                                      ? ` (now they admit nothing: ${routineIdleReasons(step.view).join(' ')})`
                                      : ''
                                  }`
                                : `This run’s routine approvals already cover it (${step.view.policy.max_actions - step.view.used_actions} of ${step.view.policy.max_actions} steps left)`}
                          </strong>
                        </p>
                        <ul>
                          {(step.kind === 'covered'
                            ? step.view.policy.summary
                            : routinePolicySummary(step.input)
                          ).map((l) => (
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
                      I have read both summaries; apply them to this run.
                    </label>
                    {blockers.length > 0 && (
                      <ul className="error">
                        {blockers.map((b) => (
                          <li key={b}>{b}</li>
                        ))}
                      </ul>
                    )}
                    <button type="submit" disabled={!ready}>
                      {busy
                        ? 'Applying…'
                        : `${AUTOMATION_LEVEL_TEXT[level].label} on this run`}
                    </button>
                  </>
                )}
                {error && (
                  <p className="error" role="alert">
                    {error}
                  </p>
                )}
              </form>
            ) : (
              <p className="small">
                Only the workspace owner can change how a project is automated.
              </p>
            )}
            {c.automations.length === 0 ? (
              <Empty>No run automates selection yet.</Empty>
            ) : (
              c.automations.slice(0, 5).map((a) => (
                <article
                  key={a.id}
                  className="card"
                  aria-label="Automate selection"
                >
                  <p>
                    <strong>
                      Automate selection ·{' '}
                      {a.state === 'active' ? 'on' : 'set back to Manual'}
                    </strong>{' '}
                    <span className="small">
                      {name(a.run_id)} · set {when(a.created_at)} · {a.started}{' '}
                      choice{a.started === 1 ? '' : 's'} started
                    </span>
                  </p>
                  {a.stop_reason && <p className="small">{a.stop_reason}</p>}
                  {a.autopilots.length > 0 && (
                    <ul className="small">
                      {a.autopilots.map((p) => (
                        <li key={p.id}>
                          {when(p.created_at)}:{' '}
                          {p.state === 'running'
                            ? 'choosing now'
                            : (p.outcome ?? '').replaceAll('_', ' ')}{' '}
                          (see Run it for me above for its steps)
                        </li>
                      ))}
                    </ul>
                  )}
                  {owner && a.state === 'active' && (
                    <button
                      className="secondary"
                      disabled={busy}
                      onClick={() => void manual(a)}
                    >
                      Set back to Manual
                    </button>
                  )}
                </article>
              ))
            )}
          </>
        )}
      </Status>
    </section>
  );
}

function endAfter(hours: number): string {
  const h = Number.isFinite(hours) && hours > 0 ? hours : 0;
  // On the minute, and never past 90 days (the server's limit), rounding down there.
  const latest =
    Math.floor((Date.now() + 90 * 86_400_000 - 60_000) / 60_000) * 60_000;
  return new Date(
    Math.min(Math.ceil((Date.now() + h * 3_600_000) / 60_000) * 60_000, latest),
  ).toISOString();
}
