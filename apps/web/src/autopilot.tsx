import { Explain, PointList, useReadLists } from './explain.js';
import {
  useEffect,
  useRef,
  useState,
  type FormEvent,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  AUTOPILOT_MIN_CALLS,
  AUTOPILOT_RETRYABLE,
  autopilotContinuable,
  AUTOPILOT_STAGE_LABEL,
  AutopilotConfigSchema,
  AutopilotSchema,
  EvidenceRoleSchema,
  ExplorationPreviewSchema,
  RunControlSchema,
  StoredEntitySchema,
  WebDiscoveryPreviewSchema,
  autopilotRoutinePolicy,
  cutText,
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
  OPEN_EXPLORATION,
  loadRoutes,
  pickRoute,
  planOf,
  resourceSetupOf,
  routesOf,
} from './autopilot-routes.js';
import { Empty, Status, reveal, useLoad } from './ui.js';
import { usePoll } from './page-active.js';
import { useEndTime } from './end-time.js';
import { AllowAndContinue } from './autopilot-next.js';
import {
  AutoResumeStatus,
  ResumeChoice,
  UsageCheckNote,
  useUsageCheck,
} from './autopilot-usage.js';
import { useAutopilotSettings } from './autopilot-settings.js';
import { heldClaimsSetting } from './autopilot-held.js';
import { routeHash, type View } from './pages.js';
import { revealWhenShown, whenShown } from './discovery-progress.js';

// P13 (ADR-0092): "Run it for me". One form sets up a new run with routine approvals covering
// exactly the autopilot's steps and starts the autopilot; the owner confirms both summaries.
// Since November 15 it sits on its own Autopilot page (Jordan's request), with the autopilots
// that are working or waiting for you first, each with its steps, why it stopped, what to do
// next and Stop or Continue; then the start form; then earlier autopilots, folded. The
// autopilot itself runs on the server; leaving the page does not stop it.

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
const TitledSchema = z.object({ id: z.string(), title: z.string() });
/** A name cut at a word, with an ellipsis, for a card's header. */
const shortName = (t: string, n: number) => {
  if (t.length <= n) return t;
  const cut = t.slice(0, n);
  const space = cut.lastIndexOf(' ');
  return `${(space > n / 2 ? cut.slice(0, space) : cut).replace(/[\s,:;.]+$/, '')}…`;
};
const list = (s: string) =>
  s
    .split(/\n|,/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Working now, or stopped and waiting for the person to continue it. */
export const autopilotCurrent = (a: AutopilotRecord) =>
  a.state === 'running' ||
  (a.state === 'finished' && !!a.outcome && autopilotContinuable(a).ok);

export function Autopilot({
  session,
  workspace,
  open,
  between,
  focus = '',
}: {
  session: SessionInfo;
  workspace: Workspace;
  /** Opens another tab, for the next steps that are taken elsewhere (Decide, Discover). */
  open: (view: View, id?: string) => void;
  /** Shown after the start form and before the earlier autopilots (the page's other parts). */
  between?: ReactNode;
  /** An autopilot id from the address (`#/autopilot/run?ws=…&id=…`): its card is shown. */
  focus?: string;
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
  // Review 1 of #213, L-4: each card names its run and problem, so two cards differ. Read on
  // their own, not with the list polled every 3 s, and again only when an autopilot names a
  // run or problem not read yet (review 2, L-3).
  const [names, setNames] = useState<Map<string, string>>(new Map());
  const wanted = (c?.autopilots ?? [])
    .flatMap((a) => [a.run_id, a.config.start?.problem.id ?? ''])
    .filter((id) => id && !names.has(id));
  const missing = [...new Set(wanted)].sort().join(',');
  useEffect(() => {
    if (!missing) return;
    let live = true;
    void Promise.all([
      api(z.array(TitledSchema), `${base}/entities?kind=run`).catch(() => []),
      api(z.array(TitledSchema), `${base}/entities?kind=problem`).catch(
        () => [],
      ),
    ]).then(([runs, problems]) => {
      if (!live) return;
      const next = new Map(names);
      for (const e of [...runs, ...problems]) next.set(e.id, e.title);
      // An id with no record keeps an empty name, so it is not asked for again.
      for (const id of missing.split(',')) if (!next.has(id)) next.set(id, '');
      setNames(next);
    });
    return () => {
      live = false;
    };
  }, [missing, workspace.id]);
  // A link to one autopilot (`id` in the address) opens its card, unfolding Earlier autopilots
  // when it is there, once the list has loaded.
  const shownFocus = useRef('');
  useEffect(() => {
    if (!focus || !c || shownFocus.current === focus) return;
    const el = document.getElementById(`autopilot-card-${focus}`);
    if (!el) return;
    shownFocus.current = focus;
    const fold = el.closest('details');
    if (fold) fold.open = true;
    reveal(el, `autopilot-card-${focus}`);
  }, [focus, c]);
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
  const [question, setQuestion] = useState('');
  const [groups, setGroups] = useState('');
  const [exclusions, setExclusions] = useState('');
  const [roles, setRoles] = useState<EvidenceRole[]>(['problem']);
  const [maxCalls, setMaxCalls] = useState(60);
  // ADR-0124 (F2): continue by itself after a usage limit (plan connections only; off by default).
  const [resume, setResume] = useState(false);
  const [hours, setHours] = useState(4);
  const [money, setMoney] = useState(5);
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  // Stop and Continue answer on the card that was pressed (review 1 of #213, L-3).
  const [controlError, setControlError] = useState<{
    id: string;
    text: string;
  } | null>(null);
  // Review 1 of #213, H-1: an autopilot can pass its end time while the page is open, and then
  // it can no longer continue; drawing again each half minute moves it to Earlier autopilots.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 30_000);
    return () => clearInterval(t);
  }, []);
  // The end time is fixed while the owner reads the summary, so the summary read is the one
  // sent. It is worked out again when the hours change, and when the page comes back into view
  // unless the summary is confirmed (then only once the end time is close or past).
  const [endsAt, renewEnd] = useEndTime(hours, undefined, confirmed);
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
    question: question.trim() ? cutText(question.trim(), 300) : null,
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
    ...(resume && route?.kind === 'plan' ? { resume_after_limit: true } : {}),
  });
  const config: AutopilotConfig | null = draft.success ? draft.data : null;
  // Final UX pass K-2: the explorer reads only claims with a passage, so say before the start
  // how many in this scope it can read (from the same preview Explore for me shows).
  const exploreKey = config ? JSON.stringify(config.explore) : '';
  const [readable, setReadable] = useState<{
    key: string;
    read: number;
    without: number;
  } | null>(null);
  const previewSeq = useRef(0);
  useEffect(() => {
    if (!owner || !config) return;
    const seq = ++previewSeq.current;
    const t = setTimeout(() => {
      api(ExplorationPreviewSchema, `${base}/exploration-preview`, {
        csrf: session.csrf_token,
        body: config.explore,
      }).then(
        (p) =>
          seq === previewSeq.current &&
          setReadable({
            key: exploreKey,
            read: p.packet.claims.length,
            without: p.packet.not_searched.without_passages,
          }),
        () => seq === previewSeq.current && setReadable(null),
      );
    }, 400);
    return () => clearTimeout(t);
  }, [exploreKey, workspace.id, c?.autopilots.length]);
  const passages = readable?.key === exploreKey ? readable : null;
  // Final UX pass K-9: every step shares the autopilot's one run, so a plan connection's
  // per-run request cap is the real limit on the calls.
  const perRun =
    route?.kind === 'plan'
      ? (plan?.connection.settings.caps.responses.max_requests_per_run ?? null)
      : null;
  // ADR-0124 (F2): requests needed beside what the plan connection has left (new run: none used).
  const usage = useUsageCheck(
    base,
    session,
    config,
    owner && route?.kind === 'plan',
    c?.autopilots.length,
  );
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
  // Review 1 of #255, M-1: in Standard the box is offered once both folded summaries were opened.
  const lists = useReadLists();
  const listsRead =
    !!config &&
    !!policy &&
    lists.read(autopilotSummary(config), routinePolicySummary(policy));
  const blockers = [
    ...(!route
      ? [
          'Add a model under Models and connections (a verified plan model) or a budget with pricing first.',
        ]
      : []),
    ...(plan?.blockers ?? []),
    // Live check follow-up 5: with no model or budget yet, the empty ids fail the draft too;
    // the line above already says what to add, so the raw "Invalid UUID" lines are not shown.
    ...(route && !draft.success
      ? draft.error.issues.map((i) => i.message)
      : []),
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
    listsRead &&
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
      // Live autopilot findings (November 14): the box never stays ticked after a start, even
      // one that failed or timed out after the server began it, so one more click on Start
      // cannot begin another whole run. The next start also counts its hours from now (K-3).
      setConfirmed(false);
      renewEnd();
      setBusy(false);
    }
  }

  async function control(a: AutopilotRecord, what: 'cancel' | 'continue') {
    setBusy(true);
    setControlError(null);
    try {
      await api(AutopilotSchema, `${base}/autopilots/${a.id}/${what}`, {
        csrf: session.csrf_token,
        body:
          what === 'cancel'
            ? { reason: 'Stopped from the Autopilot page.' }
            : { expected_version: a.version },
      });
    } catch (err) {
      setControlError({ id: a.id, text: message(err) });
    } finally {
      setBusy(false);
      // Final UX pass K-3: the next start counts its hours from now, not from the page load.
      renewEnd();
      ctx.refresh();
    }
  }

  const current = c?.autopilots.filter(autopilotCurrent) ?? [];
  const earlier =
    c?.autopilots.filter((a) => !autopilotCurrent(a)).slice(0, 10) ?? [];

  function card(a: AutopilotRecord, now: boolean) {
    const can = autopilotContinuable(a);
    const offered =
      owner &&
      a.state === 'finished' &&
      !!a.outcome &&
      (AUTOPILOT_RETRYABLE.includes(a.outcome) || can.ok);
    const line = (s: AutopilotRecord['steps'][number], i: number) => (
      <li key={i} value={i + 1}>
        {MARK[s.state]} {AUTOPILOT_STAGE_LABEL[s.stage]}
        {s.attempt > 1 ? ` (try ${s.attempt})` : ''}:{' '}
        {repeats && i === a.steps.length - 1 ? 'see above.' : s.note}
      </li>
    );
    // Review 1 of #213, L-5: on a current card the last three steps show and the earlier ones
    // fold, so Continue stays near the top however many times it was tried.
    const shown = now ? a.steps.slice(-3) : a.steps;
    const folded = now ? a.steps.slice(0, -3) : [];
    const last = a.steps.at(-1);
    // N-5 (review 2, N-1): the stop's reason shows once, above the next step; the last step
    // then points to it instead of repeating it.
    const repeats =
      !!last?.note &&
      (last.note === a.explanation ||
        last.note.includes(a.explanation.slice(0, 120)) ||
        a.explanation.includes(last.note.slice(0, 120)));
    const run = names.get(a.run_id);
    const problem = a.config.start?.problem
      ? names.get(a.config.start.problem.id)
      : undefined;
    const steps = (
      <>
        {folded.length > 0 && (
          <details>
            <summary>Earlier steps ({folded.length})</summary>
            <ol className="small">{folded.map((s, i) => line(s, i))}</ol>
          </details>
        )}
        <ol className="small">
          {shown.map((s, i) => line(s, folded.length + i))}
        </ol>
      </>
    );
    const actions = (
      // Stop, Continue and Allow and continue, apart so no two buttons touch.
      <div className="card-actions">
        {owner && a.state === 'running' && (
          <button
            className="secondary"
            disabled={busy}
            onClick={() => void control(a, 'cancel')}
          >
            Stop
          </button>
        )}
        {offered &&
          (can.ok ? (
            <button
              className="secondary strong"
              disabled={busy}
              onClick={() => void control(a, 'continue')}
            >
              Continue the autopilot from{' '}
              {AUTOPILOT_STAGE_LABEL[a.stage].toLowerCase()}
            </button>
          ) : (
            <p className="small">{can.reason}</p>
          ))}
        {!owner && now && a.state === 'finished' && (
          <p className="small">The workspace owner can continue it.</p>
        )}
        <AutoResumeStatus
          a={a}
          base={base}
          session={session}
          owner={owner}
          onDone={() => ctx.refresh()}
        />
        <AllowAndContinue
          a={a}
          base={base}
          session={session}
          owner={owner}
          onDone={() => ctx.refresh()}
        />
        {controlError?.id === a.id && (
          <p className="error" role="alert">
            {controlError.text}
          </p>
        )}
      </div>
    );
    return (
      <article
        key={a.id}
        id={`autopilot-card-${a.id}`}
        className={now && a.state === 'finished' ? 'card waiting' : 'card'}
        aria-label="Autopilot"
      >
        <p>
          <strong>
            {a.state === 'running'
              ? `Working: ${AUTOPILOT_STAGE_LABEL[a.stage].toLowerCase()}`
              : // Review 2 of #213, L-1: a stop that can no longer continue is not waiting.
                !now &&
                  a.outcome &&
                  AUTOPILOT_RETRYABLE.includes(a.outcome) &&
                  !can.ok
                ? `Ended: ${can.reason.startsWith('Its end time') ? 'its end time passed' : 'it cannot continue'}`
                : (OUTCOME_LABEL[a.outcome ?? ''] ?? words(a.outcome ?? ''))}
          </strong>{' '}
          <span className="small">
            {a.automation_id
              ? 'Automate selection · '
              : a.config.start
                ? 'Automate the rest · '
                : ''}
            {problem ? `${shortName(problem, 70)} · ` : ''}
            {run ? `${shortName(run, 50)} · ` : ''}
            started {when(a.created_at)} · {a.calls_reserved} of{' '}
            {a.config.limits.max_calls} calls set aside
            {now
              ? a.state === 'running'
                ? ` · stops by ${when(a.config.limits.ends_at)}`
                : ` · can continue until ${when(a.config.limits.ends_at)}`
              : ''}
            {a.state === 'running' && !a.active
              ? ' · not being driven by this studio process (it carries on after a restart)'
              : ''}
          </span>
        </p>
        <p>{a.explanation}</p>
        {now ? (
          <>
            {owner && a.state === 'finished' && a.outcome && (
              <NextAfterStop
                autopilot={a}
                workspace={workspace}
                acceptsHeld={!!settings?.accept_quote_checked_claims}
                open={open}
              />
            )}
            {actions}
            {steps}
          </>
        ) : (
          <>
            {/* An older one's steps are folded; it can no longer continue. */}
            <details>
              <summary>Its steps ({a.steps.length})</summary>
              {steps}
            </details>
            {owner && a.state === 'finished' && a.outcome && (
              <NextAfterStop
                autopilot={a}
                workspace={workspace}
                acceptsHeld={!!settings?.accept_quote_checked_claims}
                open={open}
              />
            )}
            {actions}
          </>
        )}
      </article>
    );
  }

  return (
    <>
      <section className="explore" aria-labelledby="autopilot-now-title">
        <h3 id="autopilot-now-title">Working or waiting for you</h3>
        <Status
          loading={ctx.loading}
          error={ctx.error}
          stale={ctx.stale}
          retry={ctx.reload}
        >
          {c &&
            (current.length === 0 ? (
              <Empty>
                No autopilot is working or waiting for you. Start one below.
              </Empty>
            ) : (
              <>
                <p className="small">
                  A stopped autopilot waits here until its end time, then moves
                  to Earlier autopilots.{' '}
                  {owner
                    ? 'Do what its card says, then press Continue on that card.'
                    : 'The workspace owner can continue it.'}
                </p>
                {current.map((a) => card(a, true))}
              </>
            ))}
        </Status>
      </section>
      <section className="explore" aria-labelledby="autopilot-title">
        <h3 id="autopilot-title">Start an autopilot</h3>
        <Explain
          short="The studio takes each step for you and stops when you are needed."
          className=""
        >
          The studio takes the whole path for you, one step after another:{' '}
          {researchOn ? 'search the web, ' : ''}explore the claims, write a
          brief from the first candidate problem, run discovery, assess every
          option, choose by a fixed rule, and save a proposal for a non-code
          option. Each step is the same server step the forms use, admitted by
          routine approvals made for this run only. It stops and says why when a
          step needs you: a tie or close ranking, ethics and access to confirm,
          a software option (its spec stays with you), or a limit.
        </Explain>
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
                  {researchOn && (
                    <>
                      <label htmlFor="ap-question">
                        Question for the search (optional)
                      </label>
                      <input
                        id="ap-question"
                        maxLength={300}
                        value={question}
                        aria-describedby={
                          !question.trim() && !list(interests).length
                            ? 'ap-question-hint'
                            : undefined
                        }
                        onChange={(e) => setQuestion(e.target.value)}
                      />
                      {!question.trim() && !list(interests).length && (
                        <p className="small" id="ap-question-hint">
                          With no question or interests, the search starts from
                          broad public topics, and its claims may have little to
                          do with each other.
                        </p>
                      )}
                    </>
                  )}
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
                      {perRun !== null && maxCalls > perRun && (
                        <p
                          className="small model-note model-note-warn"
                          role="note"
                        >
                          This connection allows {perRun} model requests per
                          run, and every step shares the autopilot's one run, so
                          it stops after {perRun}
                          {perRun < AUTOPILOT_MIN_CALLS
                            ? ', before the shortest path can finish'
                            : ''}
                          . Raise the per-run cap under Models and connections,
                          or set fewer calls here.
                        </p>
                      )}
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
                  // N-14: read top to bottom, without the flex row's gaps.
                  <div className="notice stacked">
                    <PointList
                      title="What the autopilot does"
                      points={autopilotSummary(config)}
                      onOpen={lists.mark}
                    />
                    {passages && (
                      // Not part of the summary the owner confirms, so kept outside its list
                      // (review 1 of #192, N-2 and N-3).
                      <p className="small">
                        {passages.read === 0
                          ? 'No claim in this scope has a passage to read yet'
                          : `The explorer can read ${passages.read} claim${passages.read === 1 ? '' : 's'} in this scope`}
                        {researchOn ? ' before the web search adds more' : ''}
                        {passages.without > 0
                          ? `; ${passages.without} without a passage ${passages.without === 1 ? 'is' : 'are'} not read`
                          : ''}
                        .{' '}
                        {passages.without > 0 && (
                          <a
                            href={routeHash({
                              view: 'evidence',
                              ws: workspace.id,
                              id: '',
                              q: '',
                            })}
                          >
                            Cite passages in Sources and claims
                          </a>
                        )}
                      </p>
                    )}
                    <UsageCheckNote {...usage} />
                    <PointList
                      title="Routine approvals for its new run"
                      points={routinePolicySummary(policy)}
                      onOpen={lists.mark}
                    />
                  </div>
                )}
                {route?.kind === 'plan' && (
                  <ResumeChoice checked={resume} onChange={setResume} />
                )}
                <label className="check">
                  <input
                    type="checkbox"
                    checked={confirmed && listsRead}
                    disabled={!listsRead}
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />{' '}
                  I have read both summaries; start a new run with these routine
                  approvals and run the autopilot on it. The approvals end when
                  the autopilot ends, except while it waits for me.
                </label>
                {!listsRead && config && policy && (
                  <p className="small muted">
                    Open both summaries above to confirm them.
                  </p>
                )}
                {blockers.length > 0 && (
                  <ul className="error">
                    {[...new Set(blockers)].map((b) => (
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
          </>
        )}
      </section>
      {between}
      {earlier.length > 0 && (
        <section className="explore" aria-label="Earlier autopilots">
          <details>
            <summary>Earlier autopilots ({earlier.length})</summary>
            {earlier.map((a) => card(a, false))}
          </details>
        </section>
      )}
    </>
  );
}

/**
 * Final UX pass K-1: what the person can do after an autopilot stops, as links to the place
 * where they do it. Continue (below it) is mentioned only when it is offered (review 1 of
 * #192, M-1).
 */
function NextAfterStop({
  autopilot: a,
  workspace,
  acceptsHeld,
  open,
}: {
  autopilot: AutopilotRecord;
  workspace: Workspace;
  acceptsHeld: boolean;
  open: (view: View, id?: string) => void;
}) {
  const href = (
    view: 'evidence' | 'compare' | 'decisions' | 'proposals',
    id = '',
  ) => routeHash({ view, ws: workspace.id, id, q: '' });
  const go = (id: string) => (e: MouseEvent<HTMLButtonElement>) =>
    reveal(e.currentTarget, id);
  const canContinue = autopilotContinuable(a).ok;
  const last = a.steps.at(-1);
  const exploration = [...a.steps]
    .reverse()
    .find((s) => s.stage === 'explore' && s.child?.kind === 'workflow')?.child;
  const exploreStarted =
    [...a.steps].reverse().find((s) => s.child === exploration)?.started_at ??
    '';
  const openExploration = exploration && (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        // On Discover › Explore for me, its own tab.
        open('submit');
        // Once Explore for me is on the page in view, it opens its panel and the exploration.
        whenShown('explore-title', () =>
          window.dispatchEvent(
            new CustomEvent(OPEN_EXPLORATION, {
              detail: { id: exploration.id, at: exploreStarted },
            }),
          ),
        );
      }}
    >
      Open the exploration
    </button>
  );
  // Search the web is a Discover panel; it opens there, since this page has no search form.
  const searchWeb = (
    <button
      type="button"
      className="secondary"
      onClick={() => {
        open('submit');
        revealWhenShown('web-title');
      }}
    >
      Search the web
    </button>
  );
  const decide = (
    <a className="button secondary" href={href('compare')}>
      Open Decide
    </a>
  );
  const then = canContinue
    ? ', then press Continue on this card.'
    : ', then start a new autopilot.';
  // Every candidate the explorer found is already a recorded problem (review 1 of #192, L-6).
  // The note lists each candidate's disposition, e.g. "(E1 duplicate; E2 insufficient
  // evidence)"; every one must be a duplicate (review 2 of #192, L-B).
  const dispositions =
    /\(([^)]*)\)/
      .exec(last?.note ?? '')?.[1]
      ?.split(';')
      .map((x) => x.trim()) ?? [];
  const allDuplicates =
    a.outcome === 'insufficient_evidence' &&
    dispositions.length > 0 &&
    dispositions.every((x) => /\bduplicate$/.test(x));
  let text = '';
  let actions: ReactNode = null;
  switch (a.outcome) {
    case 'insufficient_evidence':
    case 'no_eligible_option':
      if (allDuplicates) {
        text =
          'Next: what it found is already recorded as problems. Work on those under Projects › Decide, or leave out their topics (Narrow it and set limits) and start again.';
        actions = (
          <>
            {decide}
            {openExploration}
          </>
        );
        break;
      }
      text =
        a.outcome === 'insufficient_evidence'
          ? 'Next: give it more to read. Cite a passage for claims that have none, or search the web for new claims, then start the autopilot again.'
          : 'Next: read why each option cannot go ahead in the exploration and under Decide; more evidence, or a person’s judgment there, can change it.';
      actions = (
        <>
          {openExploration}
          {searchWeb}
          <a className="button secondary" href={href('evidence')}>
            Sources and claims
          </a>
        </>
      );
      break;
    case 'needs_person':
      // P-12: quote-checked web claims wait under Search the web, not Decide. While the setting
      // is off and claims still wait, Continue with none added stops here again (#202, L-2).
      if (last?.stop_kind === 'claims_held') {
        const again =
          canContinue && a.next?.some((n) => n.kind === 'allow_and_continue')
            ? ' While claims still wait and none were added, it stops here again.'
            : '';
        text = `Next: read the claims its web search found and add the ones you agree with under Projects › Discover › Search the web${then}${again} ${heldClaimsSetting(a, canContinue, acceptsHeld)}`;
        actions = (
          <>
            {searchWeb}
            <button
              type="button"
              className="secondary"
              onClick={go('autopilot-settings-title')}
            >
              Autopilot settings
            </button>
          </>
        );
        break;
      }
      text = `Next: this step is yours. Make the choice under Projects › Decide (or write the proposal under Proposals)${then} Autopilot settings below choose which stops it may handle on its own.`;
      actions = (
        <>
          {decide}
          <button
            type="button"
            className="secondary"
            onClick={go('autopilot-settings-title')}
          >
            Autopilot settings
          </button>
        </>
      );
      break;
    case 'needs_authority':
      text = `Next: approve the waiting action under Monitor › Approvals${then}`;
      actions = (
        <a
          className="button secondary"
          href={href('decisions', last?.asked ?? '')}
        >
          Open Approvals
        </a>
      );
      break;
    case 'limit_reached':
      text = canContinue
        ? 'Next: press Continue to carry on with what is left, or start a new autopilot with more calls or hours.'
        : 'Next: start a new autopilot with more calls or hours (Narrow it and set limits). What this one made is kept.';
      break;
    case 'failed':
      text = canContinue
        ? 'Next: read the last step’s note above. Continue tries that step again.'
        : 'Next: read the last step’s note above, then start a new autopilot.';
      break;
    case 'proposal':
      text = 'Next: read and finish the proposal under Projects › Proposals.';
      actions = (
        <a className="button secondary" href={href('proposals')}>
          Open Proposals
        </a>
      );
      break;
    default:
      return null;
  }
  return (
    <div className="next-after-stop">
      <p>
        <strong>{text}</strong>
      </p>
      {actions && <div className="actions">{actions}</div>}
    </div>
  );
}
