import type { Prefill } from './prefill.js';
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type ReactNode,
} from 'react';
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
  RuntimeCeilingSchema,
  SearchBriefBodySchema,
  StartDiscoveryRequestSchema,
  StoredEntitySchema,
  WorkflowDetailSchema,
  WorkflowSchema,
  WORKFLOW_WALL_MAX_SECONDS,
  z,
  type ClaimEvidence,
  type EvidenceRole,
  type ResponseType,
  type SessionInfo,
  type Workspace,
  isDiscoveryQualified,
} from '@creator/contracts';
import { api, message, refusalsOf, words } from './oversight.js';
import {
  FixOutcome,
  FixButtons,
  qualifierFor,
  useQualifyOffers,
  type FixContext,
} from './fix-buttons.js';
import { refusalFixes, type FixAction } from './fix-here.js';
import { newestFirst } from './versions.js';
import { envelopesFor } from './build-defaults.js';
import { money } from './budgets.js';
import { ThemeIntent } from './theme-intent.js';
import { Explore, type ExploredPick } from './explore.js';
import { Autopilot } from './autopilot.js';
import { Automation } from './automation.js';
import { WebDiscover } from './web-discovery.js';
import {
  Empty,
  SHOW_PANEL,
  Status,
  reveal,
  runNames,
  useLoad,
  type View,
} from './ui.js';
import { DiscoveryProgress } from './discovery-progress.js';
import {
  firstPanel,
  isPanel,
  panelKey,
  panelsFor,
  type DiscoverPanel,
} from './discover-panels.js';
import { runLabel } from './labels.js';
import { preferredRoute } from './model-choice.js';
import { ChoiceNote, routePlans, useModelChoice } from './model-switch.js';
import {
  RoutineFields,
  routineIssues,
  routineRequest,
  routineStart,
  type RoutineDraft,
} from './routine-policy.js';
import { Blocked, type BlockedReason } from './blocked.js';
import {
  SOURCE_TEXT,
  defaultPlanChoice,
  discoverSetupBlockers,
  parsePreset,
  plansOffered,
  presetKey,
  routeText,
  sourceOf,
  startingSettings,
  studioDefaults,
  type DataClass,
  type Oversight,
  type RouteKind,
  type RoutineSettings,
} from './discover-defaults.js';
import { ViewModeSwitch, useViewMode } from './view-mode.js';

/** This person's saved Discover preset for a workspace; empty when none or unreadable. */
function readPreset(actor: string, ws: string, fixture: boolean) {
  try {
    const raw = localStorage.getItem(presetKey(actor, ws));
    return raw ? parsePreset(JSON.parse(raw), fixture) : {};
  } catch {
    return {};
  }
}
const DISCOVERY_CLASSES = [...new Set(Object.values(DISCOVERY_TASK_CLASSES))];

/** Key-order-free JSON, so a stored brief (jsonb reorders keys) compares with the form. */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .sort()
          .map(
            (k) =>
              `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`,
          )
          .join(',')}}`
      : JSON.stringify(v);
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
      ? 'First subject area'
      : 'Second subject area'
    : (FIELD_NAMES[String(path[0] ?? '')] ?? words(String(path[0] ?? 'brief')));
/** Validation messages in words a person would use. */
const plain = (m: string) =>
  /expected (string|array) to have >=1/.test(m)
    ? 'required'
    : /expected string to have <=/.test(m)
      ? 'too long'
      : m;

type Issue = { text: string; field?: string | undefined };

/** The form control that holds a brief field, for taking the person to it (review L-3). */
const FIELD_IDS: Record<string, string> = {
  theme: '#b-theme',
  target_users: '#b-users',
  context: '#b-ctx',
  measurable_problem: '#b-prob',
  outcome_measure: '#b-meas',
  data_and_tools: '#b-data',
  time_limit: '#b-time',
  budget_limit: '#b-budget',
  constraints: '#b-cons',
};
const fieldTarget = (path: PropertyKey[]): string | undefined =>
  path[0] === 'fields'
    ? path[1] === 1
      ? '#b-fb'
      : '#b-fa'
    : FIELD_IDS[String(path[0])];

/** Opens any folds around the field, then moves focus to it. */
function focusField(selector: string) {
  const el = document.querySelector<HTMLElement>(selector);
  if (!el) return;
  for (
    let d = el.closest('details');
    d;
    d = d.parentElement?.closest('details') ?? null
  )
    d.open = true;
  el.focus();
  el.scrollIntoView({ block: 'center' });
}

/** Where several values came from, in one short phrase for a fold's summary (review L-6). */
function sourcesText(entries: readonly (readonly [string, string])[]): string {
  const changed = entries.filter(([, s]) => s !== SOURCE_TEXT.studio);
  if (!changed.length) return 'studio defaults';
  if (
    changed.length === entries.length &&
    new Set(changed.map(([, s]) => s)).size === 1
  )
    return `all ${changed[0]![1]}`;
  return changed.map(([n, s]) => `${n}: ${s}`).join(', ');
}

/**
 * Submits a theme as a versioned search brief and starts a discovery run on the server.
 * Evidence comes from claims already recorded with sources; the locator does not search the
 * web itself. Every response type is either run or left out with a reason.
 */
export function Submit({
  session,
  workspace,
  open,
  prefill = null,
}: {
  session: SessionInfo;
  workspace: Workspace;
  open: (view: View, id?: string) => void;
  /** An idea handed over from Chat as the brief's theme. */
  prefill?: Prefill;
}) {
  const base = `workspaces/${workspace.id}`;
  // ADR-0087: the server's discovery benchmarks, so a fix can qualify a discovery task.
  useQualifyOffers(base);
  const ctx = useLoad(async () => {
    let connectionError = '';
    const [claims, runs, workflows, envelopes, pricing, connections, names] =
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
        runNames(base),
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
    // P04 review L-6: the owner's overall spending ceiling, shown before starting. Reading it
    // may be refused (not an owner); the panel then just leaves it out.
    const ceiling = await api(RuntimeCeilingSchema, 'settings/spending').catch(
      () => null,
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
      claims: newestFirst(claims),
      evidence,
      names,
      runs: newestFirst(
        runs.filter(
          (r) =>
            r.state === 'active' &&
            r.autonomy_mode !== 'human_only' &&
            !busy.has(r.run_id),
        ),
      ),
      envelopes: newestFirst(envelopes.filter((e) => e.status === 'active')),
      pricing: newestFirst(pricing),
      planDetails: planDetails.filter((p) => p !== null),
      connectionError,
      ceiling,
    };
  }, [workspace.id]);
  // useLoad reads again, quietly, each time this page is shown (coming back from Decisions
  // or anywhere), so the current state shows without a manual refresh; typed fields are kept.

  const [theme, setTheme] = useState('');
  // ADR-0082 (P19): Discover's Guided/Advanced choice is now the app-wide Standard/Advanced.
  const { standard: guided, set: setViewMode } = useViewMode();
  // P-7 (ADR-0103): one start panel open at a time. The others stay mounted, hidden, so what
  // was typed or picked in them is kept; this browser remembers the last one per workspace.
  const sectionRef = useRef<HTMLElement>(null);
  const savedPanelKey = panelKey(session.actor_id, workspace.id);
  const [panel, setPanel] = useState<DiscoverPanel>(() => {
    let saved: string | null = null;
    try {
      saved = localStorage.getItem(savedPanelKey);
    } catch {
      // No storage: start on the first panel.
    }
    return firstPanel(saved, guided);
  });
  function choose(next: DiscoverPanel) {
    setPanel(next);
    try {
      localStorage.setItem(savedPanelKey, next);
    } catch {
      // Only this browser's convenience.
    }
  }
  // `reveal` asks for a closed panel when a link aims inside it (ui.tsx).
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const show = (e: Event) => {
      const want = (e as CustomEvent<string>).detail;
      if (isPanel(want)) choose(want);
    };
    el.addEventListener(SHOW_PANEL, show);
    return () => el.removeEventListener(SHOW_PANEL, show);
  }, [savedPanelKey]);
  // P-6: the discovery started here, shown in plain words on this page instead of Runs.
  const [startedId, setStartedId] = useState('');
  useEffect(() => {
    if (!prefill) return;
    setTheme(prefill.value.slice(0, 300));
    prefill.used();
    choose('claims');
  }, [prefill?.nonce]);
  const fixture = workspace.record_mode === 'fixture';
  // P04: routine fields start from the studio defaults with this person's saved preset for
  // this workspace laid over them; the summary below says where each value came from.
  const [preset, setPreset] = useState<Partial<RoutineSettings>>(() =>
    readPreset(session.actor_id, workspace.id, fixture),
  );
  const start = startingSettings(fixture, preset);
  const [fieldA, setFieldA] = useState('');
  const [fieldB, setFieldB] = useState('');
  const [users, setUsers] = useState('');
  const [context, setContext] = useState('');
  const [problem, setProblem] = useState('');
  const [measure, setMeasure] = useState('');
  const [data, setData] = useState(start.dataAndTools);
  const [timeLimit, setTimeLimit] = useState(start.timeLimit);
  const [budgetLimit, setBudgetLimit] = useState(start.budgetLimit);
  const [seed, setSeed] = useState('');
  const [constraints, setConstraints] = useState(start.constraints);
  const [roles, setRoles] = useState<Record<string, EvidenceRole[]>>({});
  const [openClaims, setOpenClaims] = useState<ReadonlySet<string>>(new Set());
  const [excluded, setExcluded] = useState<
    Partial<Record<ResponseType, string>>
  >({});
  const [runChoice, setRunChoice] = useState('new');
  const [newMode, setNewMode] = useState<Oversight>(start.oversight);
  const [allowCalls, setAllowCalls] = useState(start.allowCalls);
  // ADR-0079: off until the owner turns it on here; a preset never carries it.
  const [routine, setRoutine] = useState<RoutineDraft>(() =>
    routineStart(start.dataClass),
  );
  const [envelopeId, setEnvelopeId] = useState('');
  const [pricingId, setPricingId] = useState('');
  const [resourceKind, setResourceKind] = useState<RouteKind>(start.route);
  const [connectionId, setConnectionId] = useState('');
  const [planModel, setPlanModel] = useState('');
  const [dataClass, setDataClass] = useState<DataClass>(start.dataClass);
  const [revisions, setRevisions] = useState(start.revisions);
  const [presetNote, setPresetNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errorFixes, setErrorFixes] = useState<FixAction[]>([]);
  const [tried, setTried] = useState(false);
  /** A brief made from an exploration pick; reused on submit while the form still matches it. */
  const [explored, setExplored] = useState<ExploredPick['brief'] | null>(null);
  /** Claims a pick cited against its problem, labelled in the list below. */
  const [against, setAgainst] = useState<ReadonlySet<string>>(new Set());
  function takePick(pick: ExploredPick) {
    const b = pick.brief.body;
    setTheme(b.theme);
    setFieldA(b.fields[0]);
    setFieldB(b.fields[1]);
    setUsers(b.target_users);
    setContext(b.context ?? '');
    setProblem(b.measurable_problem);
    setMeasure(b.outcome_measure);
    setData(b.data_and_tools.join('\n'));
    setTimeLimit(b.time_limit);
    setBudgetLimit(b.budget_limit);
    setSeed(b.nae_seed ?? '');
    setConstraints(b.constraints.join('\n'));
    const known = new Set(ctx.data?.claims.map((x) => x.id) ?? []);
    const picked = pick.claims.filter((x) => known.has(x.claim_id));
    // Supporting claims start as bearing on the problem only; claims cited against it are
    // attached with no role, labelled, for the owner to decide (PR #131 review L-6).
    setRoles(
      Object.fromEntries(
        picked
          .filter((x) => !x.contrary)
          .map((x) => [x.claim_id, ['problem'] as EvidenceRole[]]),
      ),
    );
    setAgainst(
      new Set(
        picked
          .filter(
            (x) =>
              x.contrary &&
              !picked.some((y) => !y.contrary && y.claim_id === x.claim_id),
          )
          .map((x) => x.claim_id),
      ),
    );
    setOpenClaims(new Set(picked.map((x) => x.claim_id)));
    setExplored(pick.brief);
    setTried(false);
    reveal(sectionRef.current, 'discover');
  }

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
  const issues: Issue[] = useMemo(
    () =>
      briefCheck.success
        ? []
        : briefCheck.error.issues.map((i) => ({
            text: `${fieldName(i.path)}: ${plain(i.message)}`,
            field: fieldTarget(i.path),
          })),
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
  // A run or task budget belongs to its own run; a new run can use only a shared one. Only the
  // budgets this run may use are offered, and a pick made for another run is dropped.
  const usableEnvelopes = c
    ? envelopesFor(c.envelopes, runChoice === 'new' ? '' : runChoice)
    : [];
  const envelope =
    (usableEnvelopes.some((e) => e.id === envelopeId) ? envelopeId : '') ||
    usableEnvelopes[0]?.id ||
    '';
  const price = pricingId || c?.pricing[0]?.id || '';
  // P04: with nothing chosen, the default is a connection that can actually run a discovery
  // (no blockers, allows the data class, a verified model qualified for every step), not
  // simply the first one listed. A choice the person made is kept and its blockers shown.
  const verifiedModels = (p: NonNullable<typeof c>['planDetails'][number]) =>
    p.model_access
      .filter((a) => a.path === 'responses' && a.access === 'verified')
      .map((a) => a.model_id);
  const planDefault = defaultPlanChoice(
    (c?.planDetails ?? []).map((p) => ({
      id: p.connection.id,
      blockers: p.blockers,
      allowedDataClasses: p.connection.settings.allowed_data_classes,
      models: verifiedModels(p).map((m) => ({
        id: m,
        qualified: DISCOVERY_CLASSES.filter((tc) =>
          isDiscoveryQualified(p.qualifications, m, tc),
        ),
      })),
    })),
    dataClass,
    DISCOVERY_CLASSES,
  );
  // ADR-0081: with nothing picked here, the current model from the top bar comes before the
  // P04 default; when it is not qualified for every step the form says so (ChoiceNote).
  const choice = useModelChoice(workspace);
  const route = preferredRoute(
    routePlans(c?.planDetails ?? [], DISCOVERY_CLASSES, dataClass),
    choice,
    DISCOVERY_CLASSES,
    planDefault,
  );
  const plan = c?.planDetails.find(
    (p) => p.connection.id === (connectionId || route.connection),
  );
  // Review L-1: a picked model counts only while it belongs to the connection in use.
  const model =
    (plan && verifiedModels(plan).includes(planModel) ? planModel : '') ||
    (plan && plan.connection.id === route.connection ? route.model : '') ||
    (plan ? verifiedModels(plan)[0] : '') ||
    '';
  const setup: BlockedReason[] = discoverSetupBlockers({
    route: resourceKind,
    connectionError: c?.connectionError ?? '',
    plan: plan
      ? {
          id: plan.connection.id,
          blockers: plan.blockers,
          ...(plan.refusals ? { refusals: plan.refusals } : {}),
          allowedDataClasses: plan.connection.settings.allowed_data_classes,
          allowedTaskClasses: plan.connection.settings.allowed_task_classes,
        }
      : null,
    dataClass,
    model,
    unqualified: model
      ? DISCOVERY_CLASSES.filter(
          (tc) => !isDiscoveryQualified(plan?.qualifications ?? [], model, tc),
        )
      : [],
    envelopes: c?.envelopes.length ?? 0,
    usableEnvelopes: usableEnvelopes.length,
    pricing: c?.pricing.length ?? 0,
    fixture,
    canQualify: plan ? qualifierFor('discovery', plan.connection) : () => false,
  }).map((b) => ({
    text: b.text,
    ...(b.fix ? { fix: b.fix } : {}),
    ...(b.acts ? { acts: b.acts } : {}),
  }));
  // ADR-0087 (P27): the owner fixes a refusal here, without leaving Discover.
  const fixes: FixContext = {
    base,
    place: 'submit',
    csrf: session.csrf_token,
    owner: workspace.role === 'owner',
    onDone: () => ctx.refresh(),
  };
  const planTimeout =
    plan?.connection.settings.caps.responses.request_timeout_ms ??
    LIMITS.call_timeout_ms;
  const planCalls = Math.min(
    LIMITS.max_calls,
    plan?.connection.settings.caps.responses.max_requests_per_run ?? 10,
  );
  const limits =
    resourceKind === 'subscription'
      ? {
          ...LIMITS,
          max_concurrency: 1,
          max_attempts: 1,
          max_calls: planCalls,
          // A plan call streams for up to the connection's accepted timeout (e.g. 120 s); the
          // 10 s default would cut live calls off mid-stream and leave unknown outcomes.
          call_timeout_ms: planTimeout,
          // ADR-0062: the timeout has no owner maximum, so the workflow's wall time grows to
          // hold every allowed call at that timeout, one at a time (never under the default).
          // Clamped to the schema's ceiling (PR #123 re-review L-3).
          max_wall_seconds: Math.min(
            WORKFLOW_WALL_MAX_SECONDS,
            Math.max(
              LIMITS.max_wall_seconds,
              Math.ceil((planCalls * planTimeout) / 1000) + 60,
            ),
          ),
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
            max_output_chars:
              plan?.connection.settings.caps.responses.max_output_chars ??
              16000,
          },
        }
      : {
          envelope_id: envelope || '00000000-0000-4000-8000-000000000000',
          pricing_snapshot_id: price || '00000000-0000-4000-8000-000000000000',
        }),
    data_class: dataClass,
    limits,
  };
  const current: RoutineSettings = {
    timeLimit,
    budgetLimit,
    constraints,
    dataAndTools: data,
    dataClass,
    revisions,
    oversight: newMode,
    allowCalls,
    route: resourceKind,
  };
  const sourceText = <K extends keyof RoutineSettings>(
    k: K,
    v: RoutineSettings[K],
  ) => SOURCE_TEXT[sourceOf(k, v, fixture, preset)];
  const existingRun = c?.runs.find((r) => r.run_id === runChoice);
  const accessText = routeText(
    resourceKind,
    plan?.connection,
    model,
    fixture,
    usableEnvelopes.find((e) => e.id === envelope)?.name,
  );
  const routeSummary = `${runChoice === 'new' ? 'New run' : 'Existing run'} · ${accessText} · ${sourcesText(
    [
      ['access', sourceText('route', resourceKind)],
      ['sharing', sourceText('dataClass', dataClass)],
      ...(runChoice === 'new'
        ? ([
            ['oversight', sourceText('oversight', newMode)],
            ['model calls', sourceText('allowCalls', allowCalls)],
          ] as const)
        : []),
    ],
  )}`;
  // Review L-6: the limits a returning person is most likely to reach, as they stand now.
  const chosenEnvelope = usableEnvelopes.find((e) => e.id === envelope);
  const ceiling = c?.ceiling ?? null;
  const ceilingLeft = ceiling
    ? money(
        (
          BigInt(ceiling.ceiling_nano_usd) - BigInt(ceiling.exposure_nano_usd)
        ).toString(),
        false,
      )
    : null;
  const ceilingsText =
    resourceKind === 'subscription'
      ? plan
        ? `${plan.usage.last_24h_requests} of ${plan.connection.settings.caps.shared.max_model_requests_per_day + plan.usage.extra_requests} plan requests used on this connection in the last 24 hours${plan.usage.extra_requests ? ` (including ${plan.usage.extra_requests} extra)` : ''}`
        : 'No connection yet'
      : [
          chosenEnvelope
            ? `Budget ${chosenEnvelope.name}: ${money(chosenEnvelope.available, chosenEnvelope.fixture)} available`
            : 'No budget yet',
          !fixture && ceiling
            ? `overall spending ceiling ${money(ceiling.ceiling_nano_usd, false)}, ${ceilingLeft} left`
            : null,
        ]
          .filter(Boolean)
          .join('; ');
  const happens: Happening[] = [
    {
      label: 'Run',
      value:
        runChoice === 'new'
          ? `A new run, ${newMode === 'supervised' ? 'supervised: it asks before every consequential step' : 'human in the loop: it asks at stage gates'}`
          : `Continues ${existingRun && c ? runLabel(existingRun, c.names) : 'the chosen run'}`,
      source:
        runChoice === 'new' ? sourceText('oversight', newMode) : 'changed here',
    },
    {
      label: 'Model calls',
      value:
        runChoice !== 'new'
          ? "Use the chosen run's own permissions"
          : allowCalls
            ? `Allowed for 24 hours on ${dataClass.replace('_', ' ')} data, revocable under Monitor › Approvals`
            : 'Each call waits for your approval',
      source:
        runChoice === 'new' ? sourceText('allowCalls', allowCalls) : undefined,
    },
    {
      label: 'Routine approvals',
      value:
        runChoice !== 'new'
          ? 'As the chosen run was set up'
          : !routine.enabled
            ? 'Off: the run asks you as its oversight setting says'
            : routine.confirmed
              ? `On for ${routine.stages.length} kind${routine.stages.length === 1 ? '' : 's'} of step, up to ${routine.maxActions} steps; revocable under Monitor › Approvals`
              : 'Chosen but not confirmed yet: read the summary and tick the box',
      source:
        runChoice === 'new' && !routine.enabled
          ? 'studio default'
          : 'changed here',
    },
    {
      label: 'Model access',
      value: accessText,
      source: sourceText('route', resourceKind),
    },
    {
      label: 'Limits',
      value:
        resourceKind === 'subscription'
          ? `At most ${limits.max_calls} plan requests, ${Math.round(limits.call_timeout_ms / 1000)} s each, ${limits.max_wall_seconds} s in all; no API spending`
          : runChoice === 'new' && !allowCalls
            ? `At most ${limits.max_calls} calls, each waiting for your approval and charged to the budget, ${limits.max_wall_seconds} s in all`
            : `At most ${limits.max_calls} calls, up to 2 ${fixture ? 'simulated units' : 'dollars'} each from the budget, ${limits.max_wall_seconds} s in all`,
      source:
        resourceKind === 'subscription' && plan
          ? 'connection caps'
          : 'studio default',
    },
    {
      label: 'Ceilings',
      value: ceilingsText,
    },
    {
      label: 'Evidence sharing',
      value: `${dataClass.replace('_', ' ')} data only`,
      source: sourceText('dataClass', dataClass),
    },
    {
      label: 'Output',
      value: `Proposals for ${perspectives.length} response type${perspectives.length === 1 ? '' : 's'}, each critiqued, with ${revisions} revision round${revisions === 1 ? '' : 's'}; you compare them under Projects › Decide`,
    },
  ];
  function savePreset() {
    const saved = parsePreset(current, fixture);
    try {
      localStorage.setItem(
        presetKey(session.actor_id, workspace.id),
        JSON.stringify(saved),
      );
      setPreset(saved);
      setPresetNote(
        'Saved as your starting settings for this workspace in this browser.',
      );
    } catch {
      setPresetNote('This browser blocks saving settings; nothing was saved.');
    }
  }
  function clearPreset() {
    try {
      localStorage.removeItem(presetKey(session.actor_id, workspace.id));
    } catch {
      // Nothing stored to remove.
    }
    setPreset({});
    const d = studioDefaults(fixture);
    setTimeLimit(d.timeLimit);
    setBudgetLimit(d.budgetLimit);
    setConstraints(d.constraints);
    setData(d.dataAndTools);
    setDataClass(d.dataClass);
    setRevisions(d.revisions);
    setNewMode(d.oversight);
    setAllowCalls(d.allowCalls);
    setResourceKind(d.route);
    setPresetNote(
      'Back to the studio defaults. Routine settings changed on this visit were reset too; the brief and claims are unchanged.',
    );
  }
  const reqCheck = StartDiscoveryRequestSchema.safeParse(request);
  const reqIssues: Issue[] = reqCheck.success
    ? []
    : reqCheck.error.issues.map((i) =>
        i.path[0] === 'evidence'
          ? {
              text: 'Evidence: attach at least one claim and say what it bears on',
              field: '.claims-pick input[type=checkbox]',
            }
          : i.path[0] === 'excluded' && typeof i.path[1] === 'number'
            ? {
                text: `Left-out response type: ${plain(i.message)}`,
                field: `#b-ex-${exclusions[i.path[1]]?.perspective ?? ''}`,
              }
            : { text: plain(i.message) },
      );
  const routineBlocks =
    runChoice === 'new'
      ? [
          ...routineIssues(routine),
          ...(routine.enabled && !routine.dataClasses.includes(dataClass)
            ? [
                `Routine approvals: add ${dataClass.replace('_', ' ')} data, the class this run uses, or its steps will each ask.`,
              ]
            : []),
        ].map((text) => ({ text, field: '#b-routine-on' }))
      : [];
  const allIssues = [...issues, ...reqIssues, ...routineBlocks];
  const ready =
    briefCheck.success &&
    reqCheck.success &&
    routineBlocks.length === 0 &&
    setup.length === 0 &&
    (resourceKind === 'subscription' ? !!model : !!envelope && !!price);

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
    if (!ready) {
      // Review L-3: take the person to the first field to fix, opening its fold.
      const first = allIssues.find((i) => i.field);
      if (first?.field) focusField(first.field);
      return;
    }
    setBusy(true);
    setError('');
    setErrorFixes([]);
    try {
      // An unedited exploration pick keeps its own brief (and its audited link to the
      // exploration); any edit saves a new brief as before.
      const replaced = explored && stable(explored.body) !== stable(brief);
      const created =
        explored && !replaced
          ? explored
          : await api(StoredEntitySchema, `${base}/entities`, {
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
              routine_policy: routineRequest(routine),
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
      // The pick's own brief was replaced by the edited one: archive it so it does not linger
      // as an unused brief (PR #131 review L-5). Best effort; the discovery has started.
      if (replaced && explored)
        await api(z.unknown(), `${base}/entities/${explored.id}/archive`, {
          csrf: session.csrf_token,
          body: {
            expected_version: explored.version,
            reason: 'Replaced by an edited brief before discovery started.',
          },
        }).catch(() => undefined);
      setExplored(null);
      setAgainst(new Set());
      setStartedId(started.workflow.id);
    } catch (err) {
      setError(message(err));
      setErrorFixes(
        refusalFixes(
          refusalsOf(err),
          'discovery',
          plan ? qualifierFor('discovery', plan.connection) : () => false,
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  const viewer = workspace.role === 'viewer';
  return (
    <section
      className="panel short-title"
      aria-labelledby="sub-title"
      ref={sectionRef}
    >
      <h2 id="sub-title">Discover</h2>
      <div className="start-choices" role="group" aria-label="How to start">
        {panelsFor(guided, panel).map((c) => (
          <button
            key={c.key}
            type="button"
            className="start-choice"
            aria-expanded={panel === c.key}
            aria-controls={`discover-panel-${c.key}`}
            onClick={() => choose(c.key)}
          >
            <strong>{c.label}</strong>
            <span>{c.text}</span>
          </button>
        ))}
      </div>
      {guided && panel !== 'theme' && (
        // Review N-4 and re-review N-C: the switch's whole effect is in visible text, not a tooltip.
        <p className="choices-more small">
          <button
            type="button"
            className="text small"
            aria-describedby="theme-advanced-note"
            onClick={() => {
              setViewMode('advanced');
              choose('theme');
            }}
          >
            Switch to Advanced to start with a theme
          </button>{' '}
          <span id="theme-advanced-note">
            Advanced lists every tab on all your devices; switch back at the
            foot of the page list.
          </span>
        </p>
      )}
      {/* Review N-3: below the start choices, so they stay on a phone's first screen. */}
      <DiscoveryProgress
        key={`progress-${workspace.id}`}
        session={session}
        workspace={workspace}
        open={open}
        where="discover"
        keep={startedId}
      />
      <div
        id="discover-panel-explore"
        data-panel="explore"
        hidden={panel !== 'explore'}
      >
        <Explore
          key={`explore-${workspace.id}`}
          session={session}
          workspace={workspace}
          onUse={takePick}
          open={open}
        />
      </div>
      <div id="discover-panel-web" data-panel="web" hidden={panel !== 'web'}>
        <WebDiscover
          key={`web-${workspace.id}`}
          session={session}
          workspace={workspace}
        />
      </div>
      <div
        id="discover-panel-autopilot"
        data-panel="autopilot"
        hidden={panel !== 'autopilot'}
      >
        <Autopilot
          key={`autopilot-${workspace.id}`}
          session={session}
          workspace={workspace}
        />
      </div>
      <div
        id="discover-panel-automation"
        data-panel="automation"
        hidden={panel !== 'automation'}
      >
        <Automation
          key={`automation-${workspace.id}`}
          session={session}
          workspace={workspace}
        />
      </div>
      <div
        id="discover-panel-theme"
        data-panel="theme"
        hidden={panel !== 'theme'}
      >
        <ThemeIntent
          key={workspace.id}
          session={session}
          workspace={workspace}
        />
      </div>
      <div
        id="discover-panel-claims"
        data-panel="claims"
        hidden={panel !== 'claims'}
      >
        <h3 id="discover">Discover from existing claims</h3>
        <ViewModeSwitch compact />
        <p className="small">
          Write what you know, attach the claims it rests on, and start.
          Evidence is only the claims you attach; the locator does not search
          the web.
          {guided &&
            ' Routine settings use the defaults shown under each fold.'}
        </p>
        {explored && (
          <p className="notice">
            Filled from an Explore for me pick, with its cited claims attached:
            supporting ones marked as bearing on the problem, ones cited against
            it labelled and left for you to mark. Check every field and claim
            before starting; if you change the brief, it is saved as a new brief
            and the pick's brief is archived.
          </p>
        )}
        {workspace.record_mode === 'fixture' && (
          <p className="notice">
            Fixture workspace: the deterministic adapter answers from rules over
            the evidence packet. Its proposals are placeholders, not reasoning.
          </p>
        )}
        {viewer && (
          <p className="error">
            You can read this workspace but not start runs.
          </p>
        )}
        <Status
          loading={ctx.loading}
          error={ctx.error}
          stale={ctx.stale}
          retry={ctx.reload}
        >
          {c && (
            <form
              noValidate
              onSubmit={(e) => void submit(e)}
              aria-describedby="sub-issues"
            >
              <fieldset>
                <legend>The brief</legend>
                <label htmlFor="b-theme">
                  Theme (specific setting or group)
                </label>
                <input
                  id="b-theme"
                  required
                  maxLength={300}
                  value={theme}
                  onChange={(e) => setTheme(e.target.value)}
                />
                <div className="two">
                  <div>
                    <label htmlFor="b-fa">
                      First subject area (for example nursing)
                    </label>
                    <input
                      id="b-fa"
                      required
                      maxLength={300}
                      value={fieldA}
                      onChange={(e) => setFieldA(e.target.value)}
                    />
                  </div>
                  <div>
                    <label htmlFor="b-fb">
                      Second subject area (for example logistics)
                    </label>
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
                <Fold
                  guided={guided}
                  summary={`Routine details: ${timeLimit.trim() || 'no time limit'} · ${lines(constraints).length} constraint${lines(constraints).length === 1 ? '' : 's'} · ${sourcesText(
                    [
                      ['time limit', sourceText('timeLimit', timeLimit)],
                      ['budget', sourceText('budgetLimit', budgetLimit)],
                      ['constraints', sourceText('constraints', constraints)],
                      ['data and tools', sourceText('dataAndTools', data)],
                    ],
                  )}`}
                >
                  <label htmlFor="b-ctx">Context or geography (optional)</label>
                  <input
                    id="b-ctx"
                    maxLength={300}
                    value={context}
                    onChange={(e) => setContext(e.target.value)}
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
                    NAE Grand Challenge seed (optional; inspires, never replaces
                    the theme)
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
                </Fold>
              </fieldset>

              <fieldset>
                <legend>Evidence: what each claim bears on</legend>
                <p className="small">
                  Tick the claims this brief rests on, then mark what each one
                  supports.
                </p>
                {c.claims.length === 0 ? (
                  <Empty>
                    No claims in this workspace yet. Record a source and cite
                    its passages in a claim first, or use Explore for me once
                    there are some.{' '}
                    <button
                      type="button"
                      className="text"
                      onClick={() => open('evidence')}
                    >
                      Open Sources and claims
                    </button>
                  </Empty>
                ) : (
                  <ul className="rows claims-pick">
                    {c.claims.map((cl) => {
                      const ev = c.evidence.get(cl.id);
                      const attached =
                        openClaims.has(cl.id) ||
                        (roles[cl.id]?.length ?? 0) > 0;
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
                            {against.has(cl.id) && (
                              <strong className="against">
                                {' '}
                                · cited against the pick
                              </strong>
                            )}
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
                  {evidence.length} claim{evidence.length === 1 ? '' : 's'}{' '}
                  attached (1–30 needed)
                  {openClaims.size > evidence.length
                    ? '. A ticked claim counts once you mark what it supports.'
                    : '.'}
                </p>
              </fieldset>

              <fieldset>
                <legend>Responses to propose</legend>
                <Fold
                  guided={guided}
                  summary={`${perspectives.length} of ${ResponseTypeSchema.options.length} response types · ${revisions} revision round${revisions === 1 ? '' : 's'} · ${sourceText('revisions', revisions)}`}
                >
                  <p className="small">
                    Each type is proposed independently. Leave one out only with
                    a reason; at least one must not be new software.
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
                            id={`b-ex-${p}`}
                            aria-label={`Why ${words(p)} is left out`}
                            placeholder="Why it does not apply"
                            maxLength={300}
                            value={excluded[p]}
                            onChange={(e) =>
                              setExcluded((x) => ({
                                ...x,
                                [p]: e.target.value,
                              }))
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
                </Fold>
              </fieldset>

              <fieldset>
                <legend>Run, model and permission</legend>
                <Fold guided={guided} summary={routeSummary}>
                  <label htmlFor="b-run">Run</label>
                  <select
                    id="b-run"
                    value={runChoice}
                    onChange={(e) => setRunChoice(e.target.value)}
                  >
                    <option value="new">Register a new run</option>
                    {c.runs.map((r) => (
                      <option key={r.run_id} value={r.run_id}>
                        Existing: {runLabel(r, c.names)}
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
                        Let this run make model calls on the selected data class
                        for 24 hours,{' '}
                        {resourceKind === 'subscription'
                          ? 'within the subscription caps shown below; no API spending'
                          : `up to 2 ${workspace.record_mode === 'fixture' ? 'simulated units' : 'dollars'} per call`}{' '}
                        (a standing permission you can revoke under Monitor ›
                        Approvals)
                      </label>
                      {!allowCalls && (
                        <p className="small">
                          Without it, each model call waits for your approval.
                        </p>
                      )}
                      <RoutineFields
                        draft={routine}
                        onChange={setRoutine}
                        idPrefix="b-routine"
                        runDataClass={dataClass}
                      />
                    </>
                  )}
                  {runChoice !== 'new' && (
                    <p className="small">
                      This run keeps its own routine approvals. To turn them on,
                      change or revoke them for it, open Monitor › Approvals.
                    </p>
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
                      {plansOffered(
                        c.planDetails.map((p) => p.connection.kind),
                      )}{' '}
                      · subscription quota
                    </option>
                    <option value="api">
                      API / fixture · budget and pricing
                    </option>
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
                        onChange={(e) => {
                          // Picking a model pins its connection, so a later change of the
                          // default cannot pair it with another connection (review L-1).
                          setPlanModel(e.target.value);
                          if (plan) setConnectionId(plan.connection.id);
                        }}
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
                      <ChoiceNote
                        route={
                          !connectionId && !planModel
                            ? route
                            : {
                                ...route,
                                fromChoice: false,
                                choiceUnavailable: false,
                              }
                        }
                        choice={choice}
                        task="Discover"
                        labelOf={(id) =>
                          c.planDetails.find((p) => p.connection.id === id)
                            ?.connection.label ?? id
                        }
                        onUse={(conn, m) => {
                          setConnectionId(conn);
                          setPlanModel(m);
                        }}
                      />
                      <p className="small">
                        Subscription quota; no API pricing or money envelope.
                        One model job, at most {limits.max_calls} requests,{' '}
                        {limits.max_wall_seconds} seconds per workflow and{' '}
                        {Math.min(
                          100000,
                          plan?.connection.settings.caps.responses
                            .max_output_chars ?? 16000,
                        )}{' '}
                        characters per response. Provider allowance is shared
                        and may be unavailable. No paid fallback or search is
                        included.
                      </p>
                    </>
                  ) : (
                    <>
                      <label htmlFor="b-env">Budget</label>
                      <select
                        id="b-env"
                        value={envelope}
                        onChange={(e) => setEnvelopeId(e.target.value)}
                      >
                        {usableEnvelopes.length === 0 && (
                          <option value="">
                            {c.envelopes.length === 0
                              ? 'No active budget'
                              : 'No budget this run can use'}
                          </option>
                        )}
                        {usableEnvelopes.map((e) => (
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
                    </>
                  )}
                </Fold>
              </fieldset>

              <WhatHappens
                items={happens}
                presetSaved={Object.keys(preset).length > 0}
                onSave={savePreset}
                onClear={clearPreset}
                note={presetNote}
                disabled={viewer}
              />
              <Blocked
                action="start this discovery"
                reasons={setup}
                open={(v) => open(v)}
                fixes={fixes}
              />
              <FixOutcome fix={fixes} />
              <div id="sub-issues" aria-live="polite">
                {tried && allIssues.length > 0 && (
                  <ul className="small issues">
                    {allIssues.slice(0, 8).map((i) => (
                      <li key={i.text}>
                        {i.field ? (
                          <button
                            type="button"
                            className="text"
                            onClick={() => focusField(i.field!)}
                          >
                            {i.text}
                          </button>
                        ) : (
                          i.text
                        )}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <button
                className="primary"
                type="submit"
                disabled={busy || viewer}
              >
                {busy ? 'Starting…' : 'Save brief and start discovery'}
                <span aria-hidden="true">→</span>
              </button>
              {error && (
                <p className="error" role="alert">
                  {error}
                  <FixButtons acts={errorFixes} fix={fixes} />
                </p>
              )}
            </form>
          )}
        </Status>
      </div>
    </section>
  );
}

type Happening = { label: string; value: string; source?: string | undefined };

/** Guided shows a routine group folded under a one-line summary; Advanced shows it open. */
function Fold({
  guided,
  summary,
  children,
}: {
  guided: boolean;
  summary: string;
  children: ReactNode;
}) {
  return guided ? (
    <details className="routine">
      <summary>{summary}</summary>
      {children}
    </details>
  ) : (
    <>{children}</>
  );
}

/**
 * P04: what starting will do and the effective limits, each with where its value came from,
 * shown before anything starts. A saved preset only fills these routine settings.
 */
function WhatHappens({
  items,
  presetSaved,
  onSave,
  onClear,
  note,
  disabled,
}: {
  items: readonly Happening[];
  presetSaved: boolean;
  onSave: () => void;
  onClear: () => void;
  note: string;
  disabled: boolean;
}) {
  return (
    <section className="what-happens" aria-labelledby="wh-title">
      <h4 id="wh-title">What will happen</h4>
      <dl>
        {items.map((i) => (
          <div key={i.label}>
            <dt>{i.label}</dt>
            <dd>
              {i.value}
              {i.source && <span className="source"> · {i.source}</span>}
            </dd>
          </div>
        ))}
      </dl>
      <p className="small">
        Nothing starts until you press the button below, and the server checks
        every permission, cap and qualification again. Defaults never add
        evidence, permissions or qualifications.
      </p>
      <div className="actions">
        <button
          type="button"
          className="secondary"
          onClick={onSave}
          disabled={disabled}
        >
          Save these settings as my defaults here
        </button>
        {presetSaved && (
          <button type="button" className="text" onClick={onClear}>
            Back to studio defaults (resets these routine settings)
          </button>
        )}
      </div>
      {note && (
        <p className="small" role="status">
          {note}
        </p>
      )}
    </section>
  );
}
