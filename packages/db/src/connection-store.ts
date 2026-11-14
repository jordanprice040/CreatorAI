import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BenchmarkCheckSchema,
  AcceptPlanCapsRequestSchema,
  GrantExtraRequestsRequestSchema,
  type PlanExtra,
  PLAN_EXTRA_HOURS,
  AttestCreditsRequestSchema,
  ContractError,
  CreatePlanConnectionRequestSchema,
  CopyPlanConnectionRequestSchema,
  type CopyPlanConnectionResult,
  CreateVerificationGrantRequestSchema,
  PlanAdmissionRequestSchema,
  BuildApprovalRequestSchema,
  BUILD_APPROVAL_MAX_MS,
  PlanSettlementSchema,
  ReconcilePlanRequestSchema,
  StartPlanQualificationRequestSchema,
  StartQualificationQueueRequestSchema,
  StartOfferedQualificationRequestSchema,
  latestDecided,
  type QualificationQueue,
  UpdatePlanSettingsRequestSchema,
  WithdrawCreditsRequestSchema,
  parse,
  z,
  DISCOVERY_TASK_CLASSES,
  EXPLORATION_TASK_CLASS,
  ASSESSMENT_TASK_CLASS,
  workflowTaskClass,
  type WorkflowResourceSetup,
  type WorkflowLimits,
  type Workflow,
  type Admission,
  type BuildApproval,
  type BuildApprovalResult,
  type PlanAdmissionRequest,
  WEB_DISCOVERY_TASK_CLASS,
  type PlanConnection,
  type PlanConnectionDetail,
  type PlanModelAccess,
  type PlanQualification,
  type PlanQualificationResults,
  type PlanRequest,
  type PlanSettlement,
  type PlanVerificationGrant,
  type PlanProvider,
  type PlanSettings,
  type UsageSummary,
  CHAT_HISTORY_TURNS,
  CHAT_INSTRUCTIONS,
  CHAT_INSTRUCTIONS_VERSION,
  CHAT_ACTION_LABEL,
  CHAT_FILL_INSTRUCTIONS,
  CHAT_FILL_INSTRUCTIONS_VERSION,
  CHAT_FILL_OUTPUT_MAX,
  ChatActionFillQuestionSchema,
  ChatActionFillRequestSchema,
  CHAT_FILL_TEXT_MAX,
  fillType,
  fillableKey,
  readFillValues,
  type ChatActionFill,
  type ChatActionFillQuestion,
  type ChatActionFillState,
  ChatAnswerRequestSchema,
  ChatCreateRequestSchema,
  ChatMessageRequestSchema,
  ChatSettingsRequestSchema,
  SetModelChoiceRequestSchema,
  SetViewPreferenceRequestSchema,
  type ViewPreference,
  WorkspaceNoteRequestSchema,
  NoteArchiveRequestSchema,
  NoteCreateRequestSchema,
  NoteRenameRequestSchema,
  NOTES_PER_PERSON_MAX,
  type ActivityNow,
  type WorkspaceNote,
  type WorkspaceNoteList,
  ChatRenameRequestSchema,
  ChatActionCreateRequestSchema,
  ChatActionOutcomeRequestSchema,
  ChatActionUpdateRequestSchema,
  ChatActionVersionRequestSchema,
  readProposedAction,
  type ChatAction,
  type ChatActionSent,
  chatTitle,
  classifyChat,
  resolveChatContext,
  type ChatAnswer,
  type ChatAnswerState,
  type ChatConversation,
  type ChatDeleted,
  type ChatDetail,
  type ChatSettings,
  type ModelChoice,
  type ModelChoiceResult,
  type ChatMessage,
  usageOffStatement,
  CLAUDE_CODE_MIN_VERSION,
  claudeCodeVersionSupported,
  PROPOSAL_DRAFT_INSTRUCTIONS,
  PROPOSAL_DRAFT_INSTRUCTIONS_VERSION,
  PROPOSAL_DRAFT_OUTPUT_MAX,
  PROPOSAL_SECTIONS,
  ProposalSectionDraftRequestSchema,
  proposalDraftInput,
  readSectionDrafts,
  type ProposalSectionDraft,
  type ProposalSectionDraftState,
} from '@creator/contracts';
import {
  BUILD_ROLE_PROMPTS,
  BUILD_ROLE_TASK_CLASSES,
  assessmentRoleInput,
  ASSESSMENT_ROLE_VERSION,
  admissionRefusals,
  dailyCap,
  nextRequestAt,
  canonicalHash,
  connectionBlockers,
  connectionRefusals,
  qualificationDecision,
  type BuildRole,
  type PlanChatAllowance,
  type PlanUsageCounts,
  READER_PROMPT,
  SCOUT_PROMPT,
  WEB_DISCOVERY_ROLE_VERSION,
  readerInput,
  scoutInput,
} from '@creator/domain';
import { AutomationStore } from './automation-store.js';
import {
  webDiscoveryRequestGate,
  type WebDiscoveryBinding,
} from './web-discovery-gates.js';
import { usageSummary } from './usage-summary.js';
import { toSectionDraft } from './proposal-store.js';
import {
  CHAT_ANSWER_STALE_POINT,
  chatAnswers,
  chatConversation,
  chatConversations,
  chatInput,
  chatMessages,
  chatSettings,
  chatSnapshot,
  chatStudyOpen,
  chatSelected,
  chatUsed24h,
  toChatAnswer,
  toChatMessage,
} from './chat-store.js';
import {
  cardVersion,
  chatAction,
  chatActionEvents,
  chatActionStale,
  chatActionFills,
  chatActions,
  fillInput,
  toChatAction,
  toChatActionFill,
} from './chat-action-store.js';
import { toRun } from './oversight-store.js';
import {
  activityNow,
  PLAN_REQUEST_STALE_AFTER,
  workspaceNote,
  workspaceNotes,
} from './sidebar-store.js';
import {
  admitsDiscovery,
  currentForDiscoveryRole,
  offeredDiscoveryBenchmark,
  offeredDiscoveryBenchmarks,
} from './discovery-benchmarks.js';
import {
  buildApprovalBlockers,
  buildApprovalScopeNote,
  toBuildApproval,
} from './build-approvals.js';
import {
  fail,
  iso,
  isPgError,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

// §2.2/§2.4 ChatGPT-plan connection store. Admission takes a row lock on the connection, reads
// the usage window and decides with the deterministic rules in @creator/domain, so two
// concurrent requests cannot both pass a cap. Tokens never reach this store.

/** Observations an adapter or relay made about the account while settling a request. */
export interface PlanObservation {
  eligibility?: 'eligible' | 'not_eligible' | 'temporarily_unavailable';
  quota?: 'available' | 'exhausted' | 'unavailable';
  sign_in_invalid?: boolean;
  model_refused?: boolean;
  reason_code?: string | null;
  upstream_request_id?: string | null;
  /** Qualification only: the objective signal the service computed from the output. */
  signal?: string;
  /** Qualification only: why the studio's grader failed, kept so it is not mistaken for the model's. */
  grader_error?: string;
  /** Qualification only: where a non-passing answer failed, in plain words (F10). */
  grader_detail?: string;
  workflow_output_text?: string;
}

const PLAN_LOCK = 'creator:plan-connection:';

/**
 * Settings a connection kind cannot use (ADR-0050). Claude Code has no Codex path, so it can
 * never take code_build or Codex builds, and its plan names are Claude's.
 */
function kindSettingsIssues(kind: PlanProvider, s: PlanSettings): string[] {
  const out: string[] = [];
  if (kind === 'claude_code') {
    if (s.allowed_task_classes.includes('code_build'))
      out.push(
        'Claude Code connections cannot take code_build (no Codex path).',
      );
    if (s.caps.codex.max_builds_per_day !== 0)
      out.push(
        'Claude Code connections have no Codex builds; set max_builds_per_day to 0.',
      );
    if (s.plan_type === 'plus')
      out.push('Claude plans are Pro or Max; plus is a ChatGPT plan.');
  } else if (s.plan_type === 'max')
    out.push('max is a Claude plan; ChatGPT plans are Plus or Pro.');
  return out;
}

/** What `claude auth status` (and `claude --version`) reported, as the studio read it. */
export interface ClaudeCodeStatusObservation {
  logged_in: boolean;
  /** Claude Code's documented values: none, claude.ai, oauth_token, api_key, api_key_helper, third_party. */
  auth_method: string;
  api_provider: string | null;
  account_label: string | null;
  cli_version: string;
}
const nullable = (v: unknown) =>
  v === null || v === undefined ? null : String(v);

function toConnection(r: Row): PlanConnection {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    fixture: Boolean(r.fixture),
    kind: (r.kind ?? 'chatgpt_plan') as PlanConnection['kind'],
    label: String(r.label),
    version: Number(r.version),
    settings: r.settings as PlanConnection['settings'],
    settings_hash: String(r.settings_hash),
    caps_accepted_at: r.caps_accepted_at ? iso(r.caps_accepted_at) : null,
    ext_agent_host_id: String(r.ext_agent_host_id),
    sign_in: r.sign_in as PlanConnection['sign_in'],
    credits: {
      ...(r.credits as PlanConnection['credits']),
      // JSONB retains PostgreSQL's offset timestamp spelling; the wire contract
      // requires UTC ISO dates, just like the ordinary timestamptz columns.
      confirmed_at: (r.credits as PlanConnection['credits']).confirmed_at
        ? new Date(
            (r.credits as PlanConnection['credits']).confirmed_at!,
          ).toISOString()
        : null,
    },
    eligibility: r.eligibility as PlanConnection['eligibility'],
    quota: r.quota as PlanConnection['quota'],
    status_reason: nullable(r.status_reason),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
const toAccess = (r: Row): PlanModelAccess => ({
  connection_id: String(r.connection_id),
  model_id: String(r.model_id),
  path: r.path as PlanModelAccess['path'],
  access: r.access as PlanModelAccess['access'],
  reason_code: nullable(r.reason_code),
  request_id: String(r.request_id),
  verified_at: iso(r.verified_at),
});
const toGrant = (r: Row): PlanVerificationGrant => ({
  id: String(r.id),
  connection_id: String(r.connection_id),
  model_id: String(r.model_id),
  path: r.path as PlanVerificationGrant['path'],
  max_requests: 1,
  used: Number(r.used),
  expires_at: iso(r.expires_at),
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  intent: (r.intent ?? 'model_access') as PlanVerificationGrant['intent'],
});
/** ADR-0088: a locked queue row with its workspace. */
interface QueueRow {
  id: string;
  workspace_id: string;
  connection_id: string;
  model_id: string;
  state: string;
  lease_holder: string | null;
  created_by: string;
}
const words = (s: string) => s.replace(/_/g, ' ');
type QueueRole = 'assessment' | 'discovery' | 'web_discovery' | null;
/**
 * ADR-0089 (after P34): the role a benchmark qualifies, from its checks, as the app's
 * `manifestRole`: assessment, discovery or web discovery checks, or none (a task class with one
 * role). Any role version counts (review 3 of PR #176, N-2), so an outdated benchmark shares its
 * role with the current one.
 */
const manifestRole = (manifest: { cases?: unknown }): QueueRole => {
  const cases = Array.isArray(manifest.cases) ? manifest.cases : [];
  const kinds = new Set(
    cases.map((item: { check?: unknown }) => {
      const parsed = BenchmarkCheckSchema.safeParse(item?.check);
      return parsed.success ? parsed.data.kind : undefined;
    }),
  );
  if (kinds.size === 1 && kinds.has('assessment_contract')) return 'assessment';
  if (kinds.size === 1 && kinds.has('discovery_contract')) return 'discovery';
  if (
    kinds.size > 0 &&
    [...kinds].every(
      (k) => k === 'web_scout_contract' || k === 'web_reader_contract',
    )
  )
    return 'web_discovery';
  return null;
};
/** The role a qualification is admitted for (ADR-0089); none for one-role tasks or old prompts. */
const qualificationRole = (q: PlanQualification): QueueRole =>
  q.admits_assessment === true
    ? 'assessment'
    : q.admits_discovery === true
      ? 'discovery'
      : q.admits_web_discovery === true
        ? 'web_discovery'
        : null;
const clip = (s: string) => (s.length > 1200 ? `${s.slice(0, 1199)}…` : s);

/**
 * Review of PR #176, M-1: a started qualification taken over by a new queue may still be linked
 * to a running item of a queue that stopped or was cancelled (its run was refused, or it was
 * cancelled and the studio stopped before recording it). That old item hands it over.
 */
async function releaseEndedLinks(c: PoolClient, ids: string[]) {
  if (!ids.length) return;
  await c.query(
    `update plan_qualification_queue_items i set state = 'stopped', reason = 'Taken over by a later queue.'
       from plan_qualification_queues q
      where q.id = i.queue_id and q.state <> 'running' and i.state = 'running'
        and i.qualification_id = any($1::uuid[])`,
    [ids],
  );
}

async function runningQueueId(
  c: PoolClient,
  connectionId: string,
): Promise<string | null> {
  const { rows } = await c.query(
    `select id from plan_qualification_queues where connection_id = $1 and state = 'running'`,
    [connectionId],
  );
  return rows[0] ? String((rows[0] as Row).id) : null;
}

async function toQueue(c: PoolClient, r: Row): Promise<QualificationQueue> {
  const items = await c.query(
    'select * from plan_qualification_queue_items where queue_id = $1 order by position',
    [r.id],
  );
  return {
    id: String(r.id),
    connection_id: String(r.connection_id),
    model_id: String(r.model_id),
    state: r.state as QualificationQueue['state'],
    reason: nullable(r.reason),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    finished_at: r.finished_at ? iso(r.finished_at) : null,
    active: r.state === 'running' && Boolean(r.leased),
    items: (items.rows as Row[]).map((i) => ({
      position: Number(i.position),
      task_class:
        i.task_class as QualificationQueue['items'][number]['task_class'],
      manifest_name: String((i.manifest as { name: string }).name).slice(
        0,
        200,
      ),
      manifest_hash: String(i.manifest_hash),
      qualification_id: nullable(i.qualification_id),
      state: i.state as QualificationQueue['items'][number]['state'],
      reason: nullable(i.reason),
    })),
  };
}
const toQualification = (r: Row): PlanQualification => ({
  id: String(r.id),
  connection_id: String(r.connection_id),
  model_id: String(r.model_id),
  task_class: r.task_class as PlanQualification['task_class'],
  manifest_hash: String(r.manifest_hash),
  min_held_out_cases: Number(r.min_held_out_cases),
  floor: r.floor as PlanQualification['floor'],
  state: r.state as PlanQualification['state'],
  development: r.development as PlanQualification['development'],
  held_out: r.held_out as PlanQualification['held_out'],
  reason: nullable(r.reason),
  created_by: String(r.created_by),
  created_at: iso(r.created_at),
  decided_at: r.decided_at ? iso(r.decided_at) : null,
  prompt_current:
    currentForBuildRole(r) &&
    (currentForDiscoveryRole(r) ||
      currentForAssessmentRole(r) ||
      currentForWebDiscoveryRole(r)),
  admits_assessment: currentForAssessmentRole(r),
  admits_discovery: admitsDiscovery(r),
  admits_web_discovery: currentForWebDiscoveryRole(r),
});
const toRequest = (r: Row): PlanRequest => ({
  id: String(r.id),
  connection_id: String(r.connection_id),
  logical_operation_id: String(r.logical_operation_id),
  path: r.path as PlanRequest['path'],
  purpose: r.purpose as PlanRequest['purpose'],
  model_id: String(r.model_id),
  task_class: (r.task_class as PlanRequest['task_class']) ?? null,
  data_class: r.data_class as PlanRequest['data_class'],
  run_id: nullable(r.run_id),
  build_id: nullable(r.build_id),
  state: r.state as PlanRequest['state'],
  reason_code: nullable(r.reason_code),
  upstream_request_id: nullable(r.upstream_request_id),
  output_tokens: r.output_tokens === null ? null : Number(r.output_tokens),
  output_chars: r.output_chars === null ? null : Number(r.output_chars),
  output_hash: nullable(r.output_hash),
  started_at: iso(r.started_at),
  finished_at: r.finished_at ? iso(r.finished_at) : null,
});

/**
 * A build-role qualification counts only for the exact current T12 role prompt: one decided on
 * an older prompt (builder/1 after a builder/2, reviewer/1 now) never admits the new contract.
 */
function currentForBuildRole(r: Row): boolean {
  const role = (
    Object.entries(BUILD_ROLE_TASK_CLASSES) as [BuildRole, string][]
  ).find(([, cls]) => cls === r.task_class)?.[0];
  if (!role) return true;
  const m = r.manifest as {
    cases?: { input?: { role: string; text: string }[] }[];
  };
  return (
    !!m.cases?.length &&
    canonicalHash(m) === r.manifest_hash &&
    m.cases.every((k) => {
      const system = (k.input ?? []).filter((x) => x.role === 'system');
      return (
        system.length === 1 && system[0]!.text === BUILD_ROLE_PROMPTS[role]
      );
    })
  );
}

/**
 * ADR-0074: a scoring qualification admits automatic assessments only when every case is an
 * assessment check whose system message is the assessor's current prompt for that packet. The
 * discovery skeptic's scoring qualification does not admit assessments, nor the reverse.
 */
function currentForAssessmentRole(r: Row): boolean {
  if (String(r.task_class) !== 'scoring') return false;
  const manifest = r.manifest as {
    cases?: { input?: { role: string; text: string }[]; check?: unknown }[];
  };
  if (!manifest.cases?.length || canonicalHash(manifest) !== r.manifest_hash)
    return false;
  return manifest.cases.every((item) => {
    const parsed = BenchmarkCheckSchema.safeParse(item.check);
    if (!parsed.success || parsed.data.kind !== 'assessment_contract')
      return false;
    const check = parsed.data;
    if (
      check.context.role_version !== ASSESSMENT_ROLE_VERSION ||
      check.context.packet_hash !== canonicalHash(check.packet)
    )
      return false;
    return (
      item.input
        ?.filter((m) => m.role === 'system')
        .map((m) => m.text)
        .join('\n\n') === assessmentRoleInput(check.packet)[0]!.text
    );
  });
}

/**
 * ADR-0086: a research-synthesis qualification admits web discovery only when every case is a
 * web scout or reader check on the current role version and its system message is that
 * stage's current prompt, and both stages are covered. It never admits Explore or the locator,
 * and their qualifications never admit web discovery.
 */
export function currentForWebDiscoveryRole(r: Row): boolean {
  if (String(r.task_class) !== WEB_DISCOVERY_TASK_CLASS) return false;
  const manifest = r.manifest as {
    cases?: { input?: { role: string; text: string }[]; check?: unknown }[];
  };
  if (!manifest.cases?.length || canonicalHash(manifest) !== r.manifest_hash)
    return false;
  const stages = new Set<string>();
  for (const item of manifest.cases) {
    const parsed = BenchmarkCheckSchema.safeParse(item.check);
    if (
      !parsed.success ||
      (parsed.data.kind !== 'web_scout_contract' &&
        parsed.data.kind !== 'web_reader_contract') ||
      parsed.data.role_version !== WEB_DISCOVERY_ROLE_VERSION
    )
      return false;
    const system = (item.input ?? [])
      .filter((m) => m.role === 'system')
      .map((m) => m.text)
      .join('\n\n');
    const user = (item.input ?? [])
      .filter((m) => m.role === 'user')
      .map((m) => m.text)
      .join('\n\n');
    // PR #173 review N-1: the case's input is the stage's input for its own scope or packet.
    if (
      system !==
        (parsed.data.kind === 'web_scout_contract'
          ? SCOUT_PROMPT
          : READER_PROMPT) ||
      user !==
        (parsed.data.kind === 'web_scout_contract'
          ? scoutInput(parsed.data.scope)
          : readerInput(parsed.data.packet))
    )
      return false;
    stages.add(parsed.data.kind);
  }
  return stages.size === 2;
}

/**
 * PR #86 review L-5 (ADR-0052): what identifies a held-out case apart from the role prompt,
 * and the prompt a benchmark gives its model. A case is the same case when everything but its
 * system message matches; the prompt is the set of system messages across the cases.
 */
export type ManifestCase = {
  case_id: string;
  split: string;
  input: { role: string; text: string }[];
  output_format?: unknown;
  check?: unknown;
};
export const heldOutKeys = (cases: readonly ManifestCase[]) =>
  cases
    .filter((k) => k.split === 'held_out')
    .map((k) =>
      canonicalHash({
        input: k.input.filter((m) => m.role !== 'system'),
        output_format: k.output_format ?? null,
        check: withoutRoleVersion(k.check),
      }),
    );
/**
 * PR #130 review L-1: a discovery check names the role version (and the packet's hash, which
 * follows the packet already in the key), so a revised discovery role would change every key.
 * The role's prompt sits in the system message, which the prompt hash covers.
 */
function withoutRoleVersion(check: unknown): unknown {
  const c = check as {
    kind?: string;
    context?: Record<string, unknown>;
  } | null;
  // PR #173 review 3 L-1: a web check names its role version at the top level; the stage's
  // prompt is its system message, which `heldOutPrompts` covers case by case.
  if (c?.kind === 'web_scout_contract' || c?.kind === 'web_reader_contract') {
    const { role_version: _v, ...rest } = c as Record<string, unknown>;
    return rest;
  }
  if (c?.kind !== 'discovery_contract' || !c.context) return check ?? null;
  const { role_version: _v, packet_hash: _p, ...context } = c.context;
  return { ...c, context };
}
export const promptHash = (cases: readonly ManifestCase[]) =>
  canonicalHash(
    [
      ...new Set(
        cases.flatMap((k) => [
          ...k.input.filter((m) => m.role === 'system').map((m) => m.text),
          // A discovery role's version counts as part of its prompt.
          ...((k.check as { context?: { role_version?: string } } | undefined)
            ?.context?.role_version
            ? [
                `role:${(k.check as { context: { role_version: string } }).context.role_version}`,
              ]
            : []),
        ]),
      ),
    ].sort(),
  );
/**
 * PR #173 review 3 L-1: the prompt each held-out case gives its model, in `heldOutKeys` order.
 * A benchmark with several stages (web discovery's scout and reader) revises one stage's prompt
 * without changing the other's, so a viewed case is compared with its own stage's prompt.
 */
export const heldOutPrompts = (cases: readonly ManifestCase[]) =>
  cases.filter((k) => k.split === 'held_out').map((k) => promptHash([k]));
/**
 * ADR-0052: how many of a manifest's held-out cases one recorded view showed under a different
 * prompt. A view recorded before per-case prompts were stored compares the whole prompt.
 */
export function heldOutSeen(
  view: {
    prompt_hash: string;
    held_out: string[];
    held_out_prompts?: string[];
  },
  cases: readonly ManifestCase[],
): number {
  const keys = heldOutKeys(cases);
  if (!view.held_out_prompts) {
    if (view.prompt_hash === promptHash(cases)) return 0;
    const now = new Set(keys);
    return view.held_out.filter((k) => now.has(k)).length;
  }
  const prompts = heldOutPrompts(cases);
  const now = new Map(keys.map((k, i) => [k, prompts[i]!]));
  return view.held_out.filter(
    (k, i) => now.has(k) && now.get(k) !== view.held_out_prompts![i],
  ).length;
}
const HELD_OUT_VIEWED = 'qualification_held_out_viewed';

/** ADR-0081: one person's model choice in a workspace; version 0 when never chosen. */
async function modelChoice(
  c: PoolClient,
  ws: string,
  actor: string,
  lock = false,
): Promise<ModelChoice> {
  const { rows } = await c.query(
    `select * from model_choices where workspace_id = $1 and actor_id = $2${lock ? ' for update' : ''}`,
    [ws, actor],
  );
  const r = rows[0] as Row | undefined;
  return {
    workspace_id: ws,
    connection_id: r ? String(r.connection_id) : null,
    model_id: r ? String(r.model_id) : null,
    version: Number(r?.version ?? 0),
    updated_at: r ? iso(r.updated_at) : null,
  };
}

/** ADR-0094: admission's counts plus the window's start times and extras, read together. */
type WindowUsage = PlanUsageCounts & {
  extras: PlanExtra[];
  starts_ms: number[];
  now_ms: number;
};

export class ConnectionStore extends AutomationStore {
  /**
   * PR #126 review L-1: chat answers this studio process has begun and not yet finished. A reply
   * can come back only to the process that sent the request, so these are the answers that are
   * really still on their way, whatever the connection's timeout says now. Empty after a
   * restart, when the stored timeout rule alone applies.
   */
  readonly #liveChatAnswers = new Set<string>();
  /** ADR-0096: fills this studio process is still waiting on. */
  readonly #liveChatFills = new Set<string>();
  /** ADR-0101: proposal drafts this process is still waiting on. */
  readonly #liveSectionDrafts = new Set<string>();
  /**
   * ADR-0064: plan requests this studio process admitted and has not settled yet. The owner
   * cannot close one of these from the app, whatever its age: its result can still come back.
   * Empty after a restart, when the time rule alone applies (requests run by the worker process
   * are covered by the time rule only).
   */
  readonly #livePlanRequests = new Set<string>();
  /**
   * ADR-0084 (P23): qualifications whose Run loop this studio process is executing now. A Run
   * is one long request, so a page that was left or a second window could press Run again and
   * start a second loop for the same qualification (review of PR #169, M-1). The claim is taken
   * and checked with no await in between, so two presses in this process cannot both get it.
   * Empty after a restart; a case still in flight from before is caught by the database check
   * in `claimQualificationRun`.
   */
  readonly #runningQualifications = new Set<string>();

  // ---- Owner configuration --------------------------------------------------------------

  async createPlanConnection(
    ctxIn: CommandContext,
    ws: string,
    body: unknown,
  ): Promise<PlanConnection> {
    const ctx = normalize(ctxIn);
    const req = parse(CreatePlanConnectionRequestSchema, body);
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const issues = kindSettingsIssues(req.kind, req.settings);
      if (issues.length)
        throw new ContractError(
          'INVALID_CONTRACT',
          'These settings do not fit this connection type.',
          issues,
        );
      const w = await c.query('select fixture from workspaces where id = $1', [
        ws,
      ]);
      const id = await this.#insertConnection(
        c,
        ctx,
        ws,
        Boolean(w.rows[0]?.fixture),
        req.kind,
        req.label,
        req.settings,
        {},
      );
      return this.#connection(c, ws, id);
    });
  }

  /**
   * ADR-0095 (P30): copies a connection's settings (caps, allowed data and tasks) into another
   * workspace the same person owns. The copy is a new connection with its own version and host
   * id: it starts not signed in, with no model checks, qualifications, credits statement or
   * accepted caps, so nothing the source earned stands in for the copy. The source row is not
   * changed. A ChatGPT sign-in is not shared, because its refresh token rotates and is bound to
   * the source's host id; the owner signs in once in the target.
   */
  async copyPlanConnection(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ): Promise<CopyPlanConnectionResult> {
    const ctx = normalize(ctxIn);
    const req = parse(CopyPlanConnectionRequestSchema, body);
    const refusal = 'Only the owner of both workspaces can copy a connection.';
    return this.tx(async (c) => {
      const source = uuid(ws);
      const target = uuid(req.target_workspace_id);
      await this.#requireCopyOwner(c, source, ctx.actorId, refusal);
      if (target === source)
        throw fail(
          'INVALID_CONTRACT',
          'Choose another workspace; the connection is already in this one.',
        );
      await this.#requireCopyOwner(c, target, ctx.actorId, refusal);
      const conn = await this.#lock(c, source, uuid(id));
      if (conn.version !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'The connection changed; reload it and try again.',
        );
      const w = await c.query('select fixture from workspaces where id = $1', [
        target,
      ]);
      const fixture = Boolean(w.rows[0]?.fixture);
      // Fixture workspaces hold synthetic records only; their connections stay apart.
      if (fixture !== conn.fixture)
        throw fail(
          'INVALID_CONTRACT',
          fixture
            ? "A real workspace's connection cannot be copied into a fixture workspace."
            : "A fixture workspace's connection cannot be copied into a real workspace.",
        );
      // Review 1 N-1: the source passed these checks when saved; a rule added since applies too.
      const issues = kindSettingsIssues(conn.kind, conn.settings);
      if (issues.length)
        throw new ContractError(
          'INVALID_CONTRACT',
          "This connection's settings no longer fit its type; change them here before copying.",
          issues,
        );
      // Re-review 3 L3-1: read without a row lock. Saving Chat answers locks their row first and
      // the connection row second (its foreign key); this copy already holds the connection, so
      // locking the Chat answers row here as well could deadlock with such a save.
      // Re-review 3 N3-1: checked before anything is written.
      const from = req.chat_answers ? await chatSettings(c, source) : null;
      if (
        from &&
        req.chat_answers_version !== undefined &&
        from.version !== req.chat_answers_version
      )
        throw fail(
          'VERSION_CONFLICT',
          'Chat answers here changed since you opened this; read the note again and copy.',
        );
      const label = req.label ?? conn.label;
      // Review 4 L4-1: every row is written before the first audit append (which takes the
      // global audit lock to commit); a Chat answers save in the target writes its row first
      // and appends second, so appending earlier here could deadlock with it.
      const audit: Parameters<ConnectionStore['append']>[2][] = [];
      const copied = await this.#insertConnection(
        c,
        ctx,
        target,
        fixture,
        conn.kind,
        label,
        conn.settings,
        {
          copied_from: {
            workspace_id: source,
            connection_id: conn.id,
            version: conn.version,
            settings_hash: conn.settings_hash,
          },
        },
        audit,
      );
      let chat: CopyPlanConnectionResult['chat_answers'] = 'not_requested';
      let chatOn: boolean | null = null;
      if (from) {
        if (from.connection_id !== conn.id) chat = 'source_not_using';
        else {
          const put = await c.query(
            `insert into chat_settings (workspace_id, enabled, connection_id, model_id,
               include_snapshot, daily_limit, version, updated_by)
             values ($1,$2,$3,$4,$5,$6,1,$7)
             on conflict (workspace_id) do nothing`,
            [
              target,
              from.enabled,
              copied,
              from.model_id,
              from.include_snapshot,
              from.daily_limit,
              ctx.actorId,
            ],
          );
          if (put.rowCount) {
            chat = 'copied';
            chatOn = from.enabled;
            const next = {
              enabled: from.enabled,
              connection_id: copied,
              model_id: from.model_id,
              include_snapshot: from.include_snapshot,
              daily_limit: from.daily_limit,
            };
            audit.push({
              workspaceId: target,
              action: 'chat.settings_changed',
              subjectKind: 'chat_settings',
              subjectId: target,
              subjectVersion: 1,
              contentHash: canonicalHash(next),
              payload: { ...next, copied_from_workspace: source },
            });
          } else chat = 'target_has_own';
        }
      }
      // The source's own record says where it was copied; its row and version stay as they are.
      audit.push({
        workspaceId: source,
        action: 'connection.copied',
        subjectKind: 'plan_connection',
        subjectId: conn.id,
        subjectVersion: conn.version,
        contentHash: conn.settings_hash,
        payload: {
          target_workspace_id: target,
          copy_connection_id: copied,
          label,
          chat_answers: chat,
        },
      });
      for (const e of audit) await this.append(c, ctx, e);
      return {
        source_connection_id: conn.id,
        target_workspace_id: target,
        connection: await this.#connection(c, target, copied),
        chat_answers: chat,
        chat_answers_enabled: chatOn,
      };
    });
  }

  /**
   * Review 1 N-2: a viewer, editor or tester of either workspace gets the copy's own refusal;
   * a workspace the person is not in stays NOT_FOUND.
   */
  async #requireCopyOwner(
    c: PoolClient,
    ws: string,
    actorId: string,
    refusal: string,
  ) {
    try {
      await this.requireOwner(c, ws, actorId, refusal);
    } catch (e) {
      if (e instanceof ContractError && e.code === 'ACCESS_DENIED')
        throw fail('ACCESS_DENIED', refusal);
      throw e;
    }
  }

  /** One new connection row, its first event and its audit record; returns the new id. */
  async #insertConnection(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    fixture: boolean,
    kind: PlanConnection['kind'],
    label: string,
    settings: PlanConnection['settings'],
    origin: Row,
    /**
     * Review 4 L4-1: when given, the audit record is pushed here for the caller to append after
     * its own row writes. Every append takes one global lock held to commit, so rows go first.
     */
    later?: Parameters<ConnectionStore['append']>[2][],
  ): Promise<string> {
    // Names are unique per workspace; the lock makes two saves of one name meet here, so the
    // second gets DUPLICATE instead of a unique-index error.
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [
      `plan-connection-label:${ws}`,
    ]);
    const exists = await c.query(
      'select 1 from plan_connections where workspace_id = $1 and label = $2',
      [ws, label],
    );
    if (exists.rowCount)
      throw fail(
        'DUPLICATE',
        'copied_from' in origin
          ? 'That workspace already has a connection with this name; choose another name.'
          : 'A connection with this name exists.',
      );
    const id = randomUUID();
    await c.query(
      `insert into plan_connections (id, workspace_id, fixture, version, label, settings,
           settings_hash, ext_agent_host_id, sign_in, credits, eligibility, quota, created_by, kind)
         values ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [
        id,
        ws,
        fixture,
        label,
        settings,
        canonicalHash(settings),
        // One host id per connection record, generated before the first sign-in (SIWC).
        `urn:uuid:${randomUUID()}`,
        {
          state: 'not_signed_in',
          issued_client_id: null,
          account_label: null,
          scopes: [],
          plan_usage_granted: false,
          verified_at: null,
          access_expires_at: null,
        },
        {
          state: 'unconfirmed',
          checked_on: null,
          confirmed_at: null,
          confirmed_by: null,
        },
        {
          state: 'unknown',
          reason_code: null,
          upstream_request_id: null,
          observed_at: null,
        },
        { state: 'unknown', reason_code: null, observed_at: null },
        ctx.actorId,
        kind,
      ],
    );
    await this.#event(
      c,
      id,
      'created',
      {
        kind,
        label,
        settings_hash: canonicalHash(settings),
        ...origin,
      },
      ctx,
    );
    const created = {
      workspaceId: ws,
      action: 'connection.created',
      subjectKind: 'plan_connection',
      subjectId: id,
      subjectVersion: 1,
      contentHash: canonicalHash(settings),
      payload: { kind, label, ...origin },
    };
    if (later) later.push(created);
    else await this.append(c, ctx, created);
    return id;
  }

  /**
   * ADR-0089 (P34): the discovery benchmarks Qualify a model offers, newest current manifest per
   * task class, without the manifests themselves. Any member may read it.
   */
  async planBenchmarks(ctxIn: CommandContext, ws: string) {
    const ctx = normalize(ctxIn);
    await this.tx((c) => this.role(c, uuid(ws), ctx.actorId, false));
    return {
      benchmarks: offeredDiscoveryBenchmarks().map(
        ({ manifest: _m, ...b }) => b,
      ),
    };
  }

  async listPlanConnections(
    ctxIn: CommandContext,
    ws: string,
  ): Promise<PlanConnection[]> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const { rows } = await c.query(
        'select * from plan_connections where workspace_id = $1 order by created_at',
        [ws],
      );
      return rows.map((r) => toConnection(r as Row));
    });
  }

  /**
   * The usage indicator (runbook step 9): plan requests against the studio's caps, the app's
   * own plan use, and API spending against the ceiling for those allowed to see it. Read-only.
   */
  async usageSummary(ctxIn: CommandContext, ws: string): Promise<UsageSummary> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const owner = await this.isCeilingOwner(c, ctx.actorId);
      return usageSummary(
        c,
        uuid(ws),
        this.spending,
        owner,
        (r) => connectionBlockers(toConnection(r)),
        await this.isPolicyOwner(c, uuid(ws), ctx.actorId),
      );
    });
  }

  /** ADR-0055: a workspace's chat conversations, newest activity first; `q` searches them. */
  async listChats(
    ctxIn: CommandContext,
    ws: string,
    q = '',
  ): Promise<ChatConversation[]> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return chatConversations(c, uuid(ws), q);
    });
  }

  async chatDetail(
    ctxIn: CommandContext,
    ws: string,
    id: string,
  ): Promise<ChatDetail> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const conversation = await chatConversation(c, uuid(ws), uuid(id));
      return {
        conversation,
        messages: await chatMessages(c, conversation.id),
        answers: await chatAnswers(c, conversation.id),
        actions: await chatActions(c, conversation.id),
        fills: await chatActionFills(c, conversation.id),
      };
    });
  }

  /** Starts a conversation. Editors and owners only; viewers read. */
  async createChat(
    ctxIn: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ChatConversation> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatCreateRequestSchema, raw ?? {});
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      const id = randomUUID();
      const title = req.title ?? 'New conversation';
      await c.query(
        `insert into chat_conversations (id, workspace_id, title, created_by)
         values ($1, $2, $3, $4)`,
        [id, uuid(ws), title, ctx.actorId],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.started',
        subjectKind: 'chat_conversation',
        subjectId: id,
        subjectVersion: null,
        contentHash: canonicalHash({ title }),
        payload: {},
      });
      return chatConversation(c, uuid(ws), id);
    });
  }

  async renameChat(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ): Promise<ChatConversation> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatRenameRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      await chatConversation(c, uuid(ws), uuid(id), true);
      await c.query(
        `update chat_conversations set title = $3, updated_at = clock_timestamp()
         where workspace_id = $1 and id = $2`,
        [uuid(ws), uuid(id), req.title],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.renamed',
        subjectKind: 'chat_conversation',
        subjectId: uuid(id),
        subjectVersion: null,
        contentHash: canonicalHash({ title: req.title }),
        payload: {},
      });
      return chatConversation(c, uuid(ws), uuid(id));
    });
  }

  /**
   * ADR-0063: deletes a conversation with its messages and answers. Owners delete any; editors
   * only ones they started that hold nothing from anyone else; viewers none. Refused while an answer is still on its way, so a
   * reply can never come back to a conversation that is gone. The audit event keeps ids and
   * counts only, never the words; plan requests stay, so usage and daily limits are unchanged.
   */
  async deleteChat(
    ctxIn: CommandContext,
    ws: string,
    id: string,
  ): Promise<ChatDeleted> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      const role = await this.role(c, uuid(ws), ctx.actorId, true);
      const conversation = await chatConversation(c, uuid(ws), uuid(id), true);
      if (role !== 'owner' && conversation.created_by !== ctx.actorId)
        throw fail(
          'ACCESS_DENIED',
          'Only the owner or the person who started this conversation can delete it.',
        );
      // PR #124 review L-2: an editor never deletes anyone else's words. Answers are always
      // asked for by an owner, so a conversation with any answer is the owner's to delete.
      if (role !== 'owner') {
        const others = await c.query(
          `select 1 from chat_messages where conversation_id = $1 and author_id <> $2
           union all
           select 1 from chat_answers where conversation_id = $1
           union all
           select 1 from chat_action_fills where conversation_id = $1
           limit 1`,
          [conversation.id, ctx.actorId],
        );
        if (others.rows.length)
          throw fail(
            'ACCESS_DENIED',
            'This conversation has messages or model answers from someone else, so only the owner can delete it.',
          );
      }
      // ADR-0062: a pending answer counts as live until its connection's request timeout plus
      // 15 minutes, the same point at which a stopped studio's answer is closed as failed.
      // That reads the current timeout, so an answer this studio is still waiting on blocks
      // too, even if the owner lowered the timeout since (PR #124 timeout review L-1). After a
      // restart nothing is waiting, so a request the stopped studio left in flight does not
      // block forever (PR #126 review L-1).
      const pending = await c.query(
        `select 1 from chat_answers ca where ca.conversation_id = $1 and ca.state = 'pending'
           and (ca.created_at >= ${CHAT_ANSWER_STALE_POINT} or ca.id = any($2::uuid[]))
         limit 1`,
        [conversation.id, [...this.#liveChatAnswers]],
      );
      if (pending.rows.length)
        throw fail(
          'INVALID_TRANSITION',
          'An answer is still on its way in this conversation. Delete it once the answer is back.',
        );
      // ADR-0096: the same for a card's fill on its way.
      const filling = await c.query(
        `select 1 from chat_action_fills ca where ca.conversation_id = $1 and ca.state = 'pending'
           and (ca.created_at >= ${CHAT_ANSWER_STALE_POINT} or ca.id = any($2::uuid[]))
         limit 1`,
        [conversation.id, [...this.#liveChatFills]],
      );
      if (filling.rows.length)
        throw fail(
          'INVALID_TRANSITION',
          "A card's fill is still on its way in this conversation. Delete it once the fill is back.",
        );
      const answers = Number(
        (
          await c.query(
            'select count(*)::int as n from chat_answers where conversation_id = $1',
            [conversation.id],
          )
        ).rows[0]?.n ?? 0,
      );
      await c.query(
        'delete from chat_conversations where workspace_id = $1 and id = $2',
        [uuid(ws), conversation.id],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.deleted',
        subjectKind: 'chat_conversation',
        subjectId: conversation.id,
        subjectVersion: null,
        contentHash: canonicalHash({ id: conversation.id }),
        payload: { messages: conversation.messages, answers },
      });
      return {
        id: conversation.id,
        messages: conversation.messages,
        answers,
      };
    });
  }

  /**
   * Adds the person's message. The server decides its intent with `classifyChat`; a repeated
   * `client_id` returns the message already saved (a retried send), and the same id with other
   * text is refused. A conversation still called "New conversation" takes its title from its
   * first message. Saving a message starts nothing.
   */
  async postChatMessage(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ): Promise<{ message: ChatMessage; duplicate: boolean }> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatMessageRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      const conversation = await chatConversation(c, uuid(ws), uuid(id), true);
      const existing = await c.query(
        'select * from chat_messages where conversation_id = $1 and client_id = $2',
        [conversation.id, req.client_id],
      );
      if (existing.rows[0]) {
        const message = toChatMessage(existing.rows[0] as Row);
        if (
          message.text !== req.text ||
          message.author_id !== ctx.actorId ||
          message.scope !== req.scope ||
          message.selected.join() !== req.selected.join()
        )
          throw new ContractError(
            'IDEMPOTENCY_CONFLICT',
            'This message id was already used for a different message.',
          );
        return { message, duplicate: true };
      }
      // ADR-0070: picked records must be this workspace's active records of a pickable kind.
      if (req.selected.length) {
        const found = await chatSelected(c, uuid(ws), req.selected);
        if (found.missing > 0)
          throw fail(
            'INVALID_CONTRACT',
            'A picked record is not an active problem, idea, spec, product or run in this workspace.',
          );
      }
      // PR #136 review L4: an explicit studio context the owner's setting does not allow is
      // refused here, so no unanswerable message is saved.
      if (
        (req.scope === 'project' || req.scope === 'selected') &&
        !(await chatSettings(c, uuid(ws))).include_snapshot
      )
        throw fail(
          'ACCESS_DENIED',
          'Studio records are turned off for chat answers (Models and connections › Chat answers). Choose General or Automatic, or ask the owner to turn them on.',
        );
      const { intent, target } = classifyChat(req.text, req.scope);
      const messageId = randomUUID();
      const { rows } = await c.query(
        `insert into chat_messages (id, workspace_id, conversation_id, seq, client_id,
           author_id, text, intent, target, scope, selected)
         values ($1, $2, $3,
           (select coalesce(max(seq), 0) + 1 from chat_messages where conversation_id = $3),
           $4, $5, $6, $7, $8, $9, $10::uuid[])
         returning *`,
        [
          messageId,
          uuid(ws),
          conversation.id,
          req.client_id,
          ctx.actorId,
          req.text,
          intent,
          target,
          req.scope,
          req.selected,
        ],
      );
      await c.query(
        `update chat_conversations
         set updated_at = clock_timestamp(),
             title = case when title = 'New conversation' and $3 = 0 then $4 else title end
         where workspace_id = $1 and id = $2`,
        [uuid(ws), conversation.id, conversation.messages, chatTitle(req.text)],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.message',
        subjectKind: 'chat_conversation',
        subjectId: conversation.id,
        subjectVersion: null,
        contentHash: canonicalHash({ text: req.text }),
        // The words stay in the conversation; the audit trail records only what kind of ask it was.
        payload: {
          message_id: messageId,
          intent,
          scope: req.scope,
          selected: req.selected.length,
        },
      });
      return { message: toChatMessage(rows[0] as Row), duplicate: false };
    });
  }

  /**
   * ADR-0083 (P20): puts an action card in a conversation. Editors and owners; the card only
   * holds answers and the versions they were made from, so creating one starts nothing. A
   * repeated `client_id` returns the card already made.
   */
  async createChatAction(
    ctxIn: CommandContext,
    ws: string,
    conversationId: string,
    raw: unknown,
  ): Promise<ChatAction> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatActionCreateRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      const conversation = await chatConversation(
        c,
        uuid(ws),
        uuid(conversationId),
        true,
      );
      const prior = (
        await c.query(
          'select * from chat_actions where conversation_id = $1 and client_id = $2',
          [conversation.id, req.client_id],
        )
      ).rows[0] as Row | undefined;
      if (prior) {
        const card = toChatAction(prior);
        if (card.kind !== req.kind || card.created_by !== ctx.actorId)
          throw new ContractError(
            'IDEMPOTENCY_CONFLICT',
            'This card id was already used for a different card.',
          );
        return card;
      }
      if (req.message_id) {
        const m = await c.query(
          'select 1 from chat_messages where conversation_id = $1 and id = $2',
          [conversation.id, uuid(req.message_id)],
        );
        if (!m.rows.length) throw fail('NOT_FOUND', 'Message not found.');
      }
      // Review L-5: a card sent again keeps where it came from.
      let origin: ChatAction['origin'] = 'studio';
      let answerId: string | null = null;
      if (req.again_of) {
        const src = (
          await c.query(
            'select * from chat_actions where conversation_id = $1 and id = $2',
            [conversation.id, uuid(req.again_of)],
          )
        ).rows[0] as Row | undefined;
        if (!src)
          throw fail('NOT_FOUND', 'The card to send again was not found.');
        const was = toChatAction(src);
        if (
          was.kind !== req.kind ||
          was.state === 'draft' ||
          was.state === 'sending'
        )
          throw fail(
            'INVALID_CONTRACT',
            'Only a finished card of the same kind can be sent again.',
          );
        origin = was.origin;
        answerId = was.answer_id;
      }
      const id = randomUUID();
      const { rows } = await c.query(
        `insert into chat_actions (id, workspace_id, conversation_id, client_id, message_id,
           answer_id, again_of, origin, kind, input, subjects, state, version, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'draft', 1, $12) returning *`,
        [
          id,
          uuid(ws),
          conversation.id,
          req.client_id,
          req.message_id ? uuid(req.message_id) : null,
          answerId,
          req.again_of ? uuid(req.again_of) : null,
          origin,
          req.kind,
          JSON.stringify(req.input),
          JSON.stringify(req.subjects),
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.action_proposed',
        subjectKind: 'chat_conversation',
        subjectId: conversation.id,
        subjectVersion: null,
        contentHash: canonicalHash({ kind: req.kind, input: req.input }),
        payload: {
          action_id: id,
          kind: req.kind,
          origin,
          answer_id: answerId,
          again_of: req.again_of,
        },
      });
      return toChatAction(rows[0] as Row);
    });
  }

  /** ADR-0083: saves the answers of a card that is still a draft (guided questions). */
  async updateChatAction(
    ctxIn: CommandContext,
    ws: string,
    conversationId: string,
    actionId: string,
    raw: unknown,
  ): Promise<ChatAction> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatActionUpdateRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      await chatConversation(c, uuid(ws), uuid(conversationId), true);
      const card = await chatAction(
        c,
        uuid(ws),
        uuid(conversationId),
        uuid(actionId),
      );
      cardVersion(card, req.expected_version);
      if (card.state !== 'draft')
        throw fail(
          'INVALID_TRANSITION',
          'This card was already sent or put away; ask for a new one.',
        );
      const { rows } = await c.query(
        `update chat_actions set input = $2, subjects = $3, version = version + 1
         where id = $1 returning *`,
        [card.id, JSON.stringify(req.input), JSON.stringify(req.subjects)],
      );
      return toChatAction(rows[0] as Row);
    });
  }

  /**
   * ADR-0083: the person pressed Send. Refused as stale (and recorded so) when a record the
   * card was made from changed; otherwise the card moves to `sending` and a
   * `chat.action_sent` event names the person who sent it. Its id goes with every request the
   * browser then makes through the form's routes, so the trail links them to this send.
   */
  async sendChatAction(
    ctxIn: CommandContext,
    ws: string,
    conversationId: string,
    actionId: string,
    raw: unknown,
  ): Promise<ChatActionSent> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatActionVersionRequestSchema, raw);
    const r = await this.tx(
      async (c): Promise<{ stale: ChatAction } | { sent: ChatActionSent }> => {
        await this.role(c, uuid(ws), ctx.actorId, true);
        await chatConversation(c, uuid(ws), uuid(conversationId), true);
        const card = await chatAction(
          c,
          uuid(ws),
          uuid(conversationId),
          uuid(actionId),
        );
        cardVersion(card, req.expected_version);
        if (card.state !== 'draft')
          throw fail(
            'INVALID_TRANSITION',
            card.state === 'sending'
              ? 'This card is already being sent.'
              : 'This card was already sent or put away; ask for a new one.',
          );
        const stale = await chatActionStale(c, uuid(ws), card.subjects);
        if (stale) {
          const { rows } = await c.query(
            `update chat_actions set state = 'stale', reason = $2, version = version + 1,
               finished_at = clock_timestamp()
             where id = $1 returning *`,
            [card.id, stale.slice(0, 2000)],
          );
          await this.append(c, ctx, {
            workspaceId: uuid(ws),
            action: 'chat.action_stale',
            subjectKind: 'chat_conversation',
            subjectId: card.conversation_id,
            subjectVersion: null,
            contentHash: canonicalHash({ id: card.id, stale }),
            payload: { action_id: card.id, kind: card.kind },
          });
          // Committed as stale: the refusal below says why, and nothing was sent.
          return { stale: toChatAction(rows[0] as Row) };
        }
        const eventId = await this.append(c, ctx, {
          workspaceId: uuid(ws),
          action: 'chat.action_sent',
          subjectKind: 'chat_conversation',
          subjectId: card.conversation_id,
          subjectVersion: null,
          contentHash: canonicalHash({ input: card.input }),
          payload: {
            action_id: card.id,
            kind: card.kind,
            origin: card.origin,
            answer_id: card.answer_id,
            again_of: card.again_of,
            subjects: card.subjects.map((s) => ({
              kind: s.kind,
              id: s.id,
              version: s.version,
            })),
          },
        });
        const { rows } = await c.query(
          `update chat_actions set state = 'sending', version = version + 1, sent_by = $2,
             sent_at = clock_timestamp(), sent_event_id = $3
           where id = $1 returning *`,
          [card.id, ctx.actorId, eventId],
        );
        return {
          sent: { action: toChatAction(rows[0] as Row), causation_id: eventId },
        };
      },
    );
    if ('stale' in r)
      throw new ContractError(
        'VERSION_CONFLICT',
        r.stale.reason ?? 'A record this card was made from changed.',
      );
    return r.sent;
  }

  /**
   * ADR-0083: how a send ended, as the browser saw the form's routes answer. Only the person who
   * sent it reports it. The store does not take the browser's word alone: it counts the audit
   * events that name the send as their cause, so "done" means the route recorded something, a
   * refusal after something was recorded is `partial`, and success with nothing recorded is
   * `unconfirmed`.
   */
  async finishChatAction(
    ctxIn: CommandContext,
    ws: string,
    conversationId: string,
    actionId: string,
    raw: unknown,
  ): Promise<ChatAction> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatActionOutcomeRequestSchema, raw);
    return this.tx(async (c) => {
      // Review N-4: a sender who lost the editor role since Send can still record how the send
      // ended (only the sender may, below); otherwise the card would stay "sending" for good.
      await this.role(c, uuid(ws), ctx.actorId, false);
      await chatConversation(c, uuid(ws), uuid(conversationId), true);
      const card = await chatAction(
        c,
        uuid(ws),
        uuid(conversationId),
        uuid(actionId),
      );
      if (card.state !== 'sending') return card;
      if (card.sent_by !== ctx.actorId)
        throw fail(
          'ACCESS_DENIED',
          'Only the person who sent this card records how it ended.',
        );
      const trail = await chatActionEvents(
        c,
        uuid(ws),
        card.sent_event_id!,
        ctx.actorId,
      );
      const events = trail.count;
      // Review N-3: the records come from the browser; mark which ones the trail confirms.
      const records = req.records.map((x) => ({
        ...x,
        in_trail: trail.subjects.has(x.id),
      }));
      const state =
        req.ok === true
          ? events > 0
            ? 'done'
            : 'unconfirmed'
          : req.ok === false
            ? trail.work > 0
              ? 'partial'
              : 'refused'
            : trail.work > 0
              ? 'unconfirmed'
              : 'refused';
      // Re-review 2 N-10: a lost send whose only events record a refusal saved nothing.
      const reason =
        req.ok === null
          ? state === 'refused'
            ? events > 0
              ? 'The page lost track of this send; only a refusal was recorded. Nothing was saved.'
              : 'The page lost track of this send before any request was recorded. Nothing was saved.'
            : 'The page lost track of this send after something was recorded. Check the records it names.'
          : state === 'unconfirmed'
            ? 'The page reported success, but no recorded event names this send.'
            : req.message;
      const outcome = {
        code: req.code,
        message: req.message,
        records,
        events,
      };
      const { rows } = await c.query(
        `update chat_actions set state = $2, reason = $3, outcome = $4, version = version + 1,
           finished_at = clock_timestamp()
         where id = $1 returning *`,
        [
          card.id,
          state,
          reason?.slice(0, 2000) ?? null,
          JSON.stringify(outcome),
        ],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.action_finished',
        subjectKind: 'chat_conversation',
        subjectId: card.conversation_id,
        subjectVersion: null,
        contentHash: canonicalHash({ id: card.id, state, outcome }),
        payload: {
          action_id: card.id,
          kind: card.kind,
          state,
          code: req.code,
          events,
          records: records.map((x) => ({
            id: x.id,
            kind: x.kind,
            in_trail: x.in_trail,
          })),
        },
      });
      return toChatAction(rows[0] as Row);
    });
  }

  /** ADR-0083: puts a draft card away. Nothing was sent. */
  async dismissChatAction(
    ctxIn: CommandContext,
    ws: string,
    conversationId: string,
    actionId: string,
    raw: unknown,
  ): Promise<ChatAction> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatActionVersionRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      await chatConversation(c, uuid(ws), uuid(conversationId), true);
      const card = await chatAction(
        c,
        uuid(ws),
        uuid(conversationId),
        uuid(actionId),
      );
      cardVersion(card, req.expected_version);
      if (card.state !== 'draft')
        throw fail(
          'INVALID_TRANSITION',
          'Only a card that was not sent can be put away.',
        );
      const { rows } = await c.query(
        `update chat_actions set state = 'dismissed', version = version + 1,
           finished_at = clock_timestamp()
         where id = $1 returning *`,
        [card.id],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.action_dismissed',
        subjectKind: 'chat_conversation',
        subjectId: card.conversation_id,
        subjectVersion: null,
        contentHash: canonicalHash({ id: card.id }),
        payload: { action_id: card.id, kind: card.kind },
      });
      return toChatAction(rows[0] as Row);
    });
  }

  /** ADR-0073: the signed-in person's own notes in this workspace. Any member, any role. */
  async listWorkspaceNotes(
    ctxIn: CommandContext,
    ws: string,
  ): Promise<WorkspaceNoteList> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return { notes: await workspaceNotes(c, uuid(ws), ctx.actorId) };
    });
  }

  /** ADR-0073: one of the person's notes, with its text. Another person's note is not found. */
  async workspaceNote(
    ctxIn: CommandContext,
    ws: string,
    note: string,
  ): Promise<WorkspaceNote> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return workspaceNote(c, uuid(ws), ctx.actorId, uuid(note));
    });
  }

  /**
   * ADR-0073: starts a named note. Notes are personal scratch, so a viewer may keep them too,
   * and no audit event is written: their names and text never enter the activity history.
   */
  async createWorkspaceNote(
    ctxIn: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<WorkspaceNote> {
    const ctx = normalize(ctxIn);
    const req = parse(NoteCreateRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      // Serializes one person's creates in a workspace so the count below cannot be raced.
      await c.query(
        `select pg_advisory_xact_lock(hashtextextended('personal_notes:' || $1 || ':' || $2, 0))`,
        [uuid(ws), ctx.actorId],
      );
      const { rows } = await c.query(
        'select count(*)::int as n from personal_notes where workspace_id = $1 and actor_id = $2',
        [uuid(ws), ctx.actorId],
      );
      if (Number((rows[0] as Row).n) >= NOTES_PER_PERSON_MAX)
        throw fail(
          'LIMIT_EXCEEDED',
          `You can keep up to ${NOTES_PER_PERSON_MAX} notes in a workspace. Archived notes count too; reuse one of them.`,
        );
      const id = randomUUID();
      await c.query(
        `insert into personal_notes (id, workspace_id, actor_id, title, text, version)
         values ($1, $2, $3, $4, $5, 1)`,
        [id, uuid(ws), ctx.actorId, req.title, req.text],
      );
      return workspaceNote(c, uuid(ws), ctx.actorId, id);
    });
  }

  /**
   * ADR-0073: saves a note's text. A stale `expected_version` (another window saved first) is
   * refused with VERSION_CONFLICT; the check is in the write itself. An archived note is
   * read-only until it is restored.
   */
  async saveWorkspaceNote(
    ctxIn: CommandContext,
    ws: string,
    note: string,
    raw: unknown,
  ): Promise<WorkspaceNote> {
    const ctx = normalize(ctxIn);
    const req = parse(WorkspaceNoteRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const current = await workspaceNote(
        c,
        uuid(ws),
        ctx.actorId,
        uuid(note),
        true,
      );
      if (current.status === 'archived')
        throw fail(
          'INVALID_TRANSITION',
          'This note is archived. Restore it to edit it.',
        );
      if (current.version !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'This note was saved from another window since you opened it.',
        );
      if (current.text === req.text) return current;
      const { rowCount } = await c.query(
        `update personal_notes set text = $4, version = version + 1,
           updated_at = clock_timestamp()
         where workspace_id = $1 and actor_id = $2 and id = $3 and version = $5`,
        [uuid(ws), ctx.actorId, uuid(note), req.text, req.expected_version],
      );
      if (rowCount !== 1)
        throw fail(
          'VERSION_CONFLICT',
          'This note was saved from another window since you opened it.',
        );
      return workspaceNote(c, uuid(ws), ctx.actorId, uuid(note));
    });
  }

  /** ADR-0073: renames a note. The text and its version are untouched. */
  async renameWorkspaceNote(
    ctxIn: CommandContext,
    ws: string,
    note: string,
    raw: unknown,
  ): Promise<WorkspaceNote> {
    const ctx = normalize(ctxIn);
    const req = parse(NoteRenameRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      await workspaceNote(c, uuid(ws), ctx.actorId, uuid(note), true);
      await c.query(
        `update personal_notes set title = $4, updated_at = clock_timestamp()
         where workspace_id = $1 and actor_id = $2 and id = $3`,
        [uuid(ws), ctx.actorId, uuid(note), req.title],
      );
      return workspaceNote(c, uuid(ws), ctx.actorId, uuid(note));
    });
  }

  /** ADR-0073: archives or restores a note. Archiving keeps the text; nothing is deleted. */
  async setWorkspaceNoteArchived(
    ctxIn: CommandContext,
    ws: string,
    note: string,
    raw: unknown,
  ): Promise<WorkspaceNote> {
    const ctx = normalize(ctxIn);
    const req = parse(NoteArchiveRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const current = await workspaceNote(
        c,
        uuid(ws),
        ctx.actorId,
        uuid(note),
        true,
      );
      const status = req.archived ? 'archived' : 'active';
      if (current.status === status) return current;
      await c.query(
        `update personal_notes set status = $4, updated_at = clock_timestamp()
         where workspace_id = $1 and actor_id = $2 and id = $3`,
        [uuid(ws), ctx.actorId, uuid(note), status],
      );
      return workspaceNote(c, uuid(ws), ctx.actorId, uuid(note));
    });
  }

  /** ADR-0060: what is running now in the workspace, for the sidebar. Members may read it. */
  async activityNow(ctxIn: CommandContext, ws: string): Promise<ActivityNow> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return {
        items: await activityNow(c, uuid(ws)),
        generated_at: new Date().toISOString(),
      };
    });
  }

  /**
   * ADR-0082 (P19): the signed-in person's Standard/Advanced choice. Any signed-in person
   * (owner or tester) reads and sets only their own; it is presentation, never authority.
   */
  async viewPreference(ctxIn: CommandContext): Promise<ViewPreference> {
    const ctx = normalize(ctxIn);
    const { rows } = await this.pool.query(
      `select view_mode, version, updated_at from person_preferences where actor_id = $1`,
      [ctx.actorId],
    );
    const r = rows[0] as Row | undefined;
    return r
      ? {
          view_mode: r.view_mode as ViewPreference['view_mode'],
          version: Number(r.version),
          updated_at: iso(r.updated_at),
        }
      : { view_mode: 'standard', version: 0, updated_at: null };
  }

  /** A stale `expected_version` (another tab or device changed it) is refused. */
  async setViewPreference(
    ctxIn: CommandContext,
    raw: unknown,
  ): Promise<ViewPreference> {
    const ctx = normalize(ctxIn);
    const req = parse(SetViewPreferenceRequestSchema, raw);
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `select version from person_preferences where actor_id = $1 for update`,
        [ctx.actorId],
      );
      const current = rows[0] ? Number((rows[0] as Row).version) : 0;
      if (current !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'Your view choice changed in another window; reload and try again.',
        );
      const { rows: out } = await c.query(
        `insert into person_preferences (actor_id, view_mode, version)
         values ($1, $2, 1)
         on conflict (actor_id) do update set view_mode = excluded.view_mode,
           version = person_preferences.version + 1, updated_at = clock_timestamp()
         where person_preferences.version = $3
         returning view_mode, version, updated_at`,
        [ctx.actorId, req.view_mode, req.expected_version],
      );
      // A first save has no row to lock: a simultaneous first save lands first and this
      // one then finds a row whose version is not the expected 0, so nothing is returned.
      if (!out[0])
        throw fail(
          'VERSION_CONFLICT',
          'Your view choice changed in another window; reload and try again.',
        );
      const r = out[0] as Row;
      return {
        view_mode: r.view_mode as ViewPreference['view_mode'],
        version: Number(r.version),
        updated_at: iso(r.updated_at),
      };
    });
  }

  /** ADR-0057: the workspace's chat-answer setting; members may read it. */
  async chatSettings(ctxIn: CommandContext, ws: string): Promise<ChatSettings> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return chatSettings(c, uuid(ws));
    });
  }

  /**
   * ADR-0057: only the owner turns chat answers on or off, or changes the connection, model,
   * snapshot or daily limit. A stale `expected_version` is refused; the change is audited.
   */
  async setChatSettings(
    ctxIn: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ChatSettings> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatSettingsRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const current = await chatSettings(c, uuid(ws), true);
      if (current.version !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'The chat setting changed since you opened it; reload and try again.',
        );
      if (req.connection_id)
        await this.#connection(c, uuid(ws), req.connection_id);
      const next = {
        enabled: req.enabled,
        connection_id: req.connection_id,
        model_id: req.model_id,
        include_snapshot: req.include_snapshot,
        daily_limit: req.daily_limit,
      };
      // PR #180 re-review 5 L5-1: the version is checked again inside the write. A first save
      // reads no row (nothing to lock), so another first write (a second tab, or a connection
      // copy bringing Chat answers along) can land before this insert; the update then matches
      // no row and this save is refused instead of overwriting it.
      const wrote = await c.query(
        `insert into chat_settings (workspace_id, enabled, connection_id, model_id,
           include_snapshot, daily_limit, version, updated_by)
         values ($1,$2,$3,$4,$5,$6,1,$7)
         on conflict (workspace_id) do update set enabled = excluded.enabled,
           connection_id = excluded.connection_id, model_id = excluded.model_id,
           include_snapshot = excluded.include_snapshot, daily_limit = excluded.daily_limit,
           version = chat_settings.version + 1, updated_by = excluded.updated_by,
           updated_at = clock_timestamp()
         where chat_settings.version = $8`,
        [
          uuid(ws),
          next.enabled,
          next.connection_id,
          next.model_id,
          next.include_snapshot,
          next.daily_limit,
          ctx.actorId,
          current.version,
        ],
      );
      if (!wrote.rowCount)
        throw fail(
          'VERSION_CONFLICT',
          'The chat setting changed since you opened it; reload and try again.',
        );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.settings_changed',
        subjectKind: 'chat_settings',
        subjectId: uuid(ws),
        subjectVersion: current.version + 1,
        contentHash: canonicalHash(next),
        payload: next,
      });
      return chatSettings(c, uuid(ws));
    });
  }

  /** ADR-0081: the caller's current connection and model in this workspace (version 0: none). */
  async modelChoice(ctxIn: CommandContext, ws: string): Promise<ModelChoice> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return modelChoice(c, uuid(ws), ctx.actorId);
    });
  }

  /**
   * ADR-0081: the owner switches their current connection and model. Only a model with
   * verified Responses access on a connection of this workspace can be chosen; qualification
   * is checked by each task where it is used, never assumed here. A saved chat-answer setting
   * follows the switch in the same transaction (audited as a chat setting change); a started
   * run is never touched, because its route is recorded on the run.
   */
  async setModelChoice(
    ctxIn: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<ModelChoiceResult> {
    const ctx = normalize(ctxIn);
    const req = parse(SetModelChoiceRequestSchema, raw);
    return this.tx(async (c) => {
      const w = uuid(ws);
      await this.requireOwner(c, w, ctx.actorId);
      const current = await modelChoice(c, w, ctx.actorId, true);
      if (current.version !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'Your model choice changed since you opened it; reload and try again.',
        );
      const connection = await this.#connection(c, w, req.connection_id);
      const access = await this.#access(c, connection.id);
      if (
        !access.some(
          (a) =>
            a.model_id === req.model_id &&
            a.path === 'responses' &&
            a.access === 'verified',
        )
      )
        throw fail(
          'INVALID_CONTRACT',
          `${req.model_id} is not verified on ${connection.label}. Verify it under Models and connections first.`,
        );
      const next = {
        connection_id: connection.id,
        model_id: req.model_id,
      };
      // Review L-2: a first switch has no row to lock, so the write itself checks the version:
      // a concurrent first switch updates nothing and is refused as out of date.
      const written = await c.query(
        `insert into model_choices (workspace_id, actor_id, connection_id, model_id, version)
         values ($1,$2,$3,$4,1)
         on conflict (workspace_id, actor_id) do update set
           connection_id = excluded.connection_id, model_id = excluded.model_id,
           version = model_choices.version + 1, updated_at = clock_timestamp()
         where model_choices.version = $5`,
        [
          w,
          ctx.actorId,
          next.connection_id,
          next.model_id,
          req.expected_version,
        ],
      );
      if (written.rowCount !== 1)
        throw fail(
          'VERSION_CONFLICT',
          'Your model choice changed since you opened it; reload and try again.',
        );
      // PR #180 re-review 6 L6-1: the Chat answers row is locked and written before the first
      // audit append (which holds the global audit lock to commit); a Chat answers save locks
      // that row first and appends second, so appending earlier could deadlock with it.
      // Chat follows only a setting the owner has saved; an unsaved one already starts from
      // the choice on its form. Enabled, snapshot and daily limit stay as they are.
      const chat = await chatSettings(c, w, true);
      let chatUpdated = false;
      let chatEvent: Parameters<ConnectionStore['append']>[2] | null = null;
      if (
        chat.version > 0 &&
        (chat.connection_id !== next.connection_id ||
          chat.model_id !== next.model_id)
      ) {
        await c.query(
          `update chat_settings set connection_id = $2, model_id = $3,
             version = version + 1, updated_by = $4, updated_at = clock_timestamp()
           where workspace_id = $1`,
          [w, next.connection_id, next.model_id, ctx.actorId],
        );
        const payload = {
          enabled: chat.enabled,
          connection_id: next.connection_id,
          model_id: next.model_id,
          include_snapshot: chat.include_snapshot,
          daily_limit: chat.daily_limit,
        };
        chatEvent = {
          workspaceId: w,
          action: 'chat.settings_changed',
          subjectKind: 'chat_settings',
          subjectId: w,
          subjectVersion: chat.version + 1,
          contentHash: canonicalHash(payload),
          payload: { ...payload, via: 'model_switch' },
        };
        chatUpdated = true;
      }
      await this.append(c, ctx, {
        workspaceId: w,
        action: 'model_choice.changed',
        subjectKind: 'model_choice',
        subjectId: ctx.actorId,
        subjectVersion: current.version + 1,
        contentHash: canonicalHash(next),
        payload: {
          ...next,
          previous: current.connection_id
            ? {
                connection_id: current.connection_id,
                model_id: current.model_id,
              }
            : null,
        },
      });
      if (chatEvent) await this.append(c, ctx, chatEvent);
      return {
        choice: await modelChoice(c, w, ctx.actorId),
        chat_updated: chatUpdated,
      };
    });
  }

  /**
   * ADR-0057: records the request for one model answer and works out exactly what will be sent.
   * Owner only. A retried click (same `client_id`) returns the answer already recorded, and a
   * message with a pending or completed answer returns that answer instead of asking again.
   * Nothing is sent here: the plan request is admitted separately, under its own checks.
   */
  async beginChatAnswer(
    ctxIn: CommandContext,
    ws: string,
    conversationId: string,
    messageId: string,
    raw: unknown,
  ): Promise<{
    answer: ChatAnswer;
    replay: boolean;
    instructions: string;
    input: string;
    logical_operation_id: string;
  }> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatAnswerRequestSchema, raw);
    const begun = await this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const conversation = await chatConversation(
        c,
        uuid(ws),
        uuid(conversationId),
        true,
      );
      const msg = (
        await c.query(
          'select * from chat_messages where conversation_id = $1 and id = $2',
          [conversation.id, uuid(messageId)],
        )
      ).rows[0] as Row | undefined;
      if (!msg) throw fail('NOT_FOUND', 'Message not found.');
      // An answer left pending by a studio that stopped mid-request is closed as failed, so
      // the message can be asked again. Its plan request, if one was sent, stays unresolved
      // and blocks new requests on the connection until the owner reconciles it (in Models
      // and connections, ADR-0064).
      // ADR-0062: the request timeout has no 5-minute maximum any more, so an answer counts
      // as abandoned only after its connection's request timeout plus 15 minutes (never under
      // 15 minutes). Answers this studio is still waiting on are skipped whatever the timeout
      // says (PR #126), so a live request is never closed early and asked a second time. The
      // current timeout is read, not the one at the start (PR #123 review L-2): only after a
      // restart can a lowered timeout close an answer early, and even then the question cannot
      // be sent twice while that plan request is in flight or unresolved (max_in_flight is 1).
      await c.query(
        `update chat_answers ca set state = 'failed', finished_at = clock_timestamp(),
           reason = 'The studio stopped before this answer was recorded. Nothing more is known about it.'
         where ca.message_id = $1 and ca.state = 'pending'
           and ca.created_at < ${CHAT_ANSWER_STALE_POINT}
           and not (ca.id = any($2::uuid[]))`,
        [msg.id, [...this.#liveChatAnswers]],
      );
      const prior = (
        await c.query(
          `select * from chat_answers where message_id = $1
           and (client_id = $2 or state in ('pending','completed'))
           order by (client_id = $2) desc limit 1`,
          [msg.id, req.client_id],
        )
      ).rows[0] as Row | undefined;
      if (prior)
        return {
          answer: toChatAnswer(prior),
          replay: true,
          instructions: CHAT_INSTRUCTIONS,
          input: String(prior.input),
          logical_operation_id: String(prior.logical_operation_id),
        };
      const settings = await chatSettings(c, uuid(ws));
      if (!settings.enabled || !settings.connection_id || !settings.model_id)
        throw fail(
          'ACCESS_DENIED',
          'Chat answers are turned off. The owner can turn them on in Models and connections.',
        );
      const conn = await this.#connection(c, uuid(ws), settings.connection_id);
      // ADR-0070: the context comes from the person's choice on the message, or fixed rules
      // when it was Automatic. Studio records go only where the owner's setting allows them;
      // an explicit choice it does not allow is refused before anything is recorded or sent.
      const message = toChatMessage(msg);
      const resolved = resolveChatContext({
        scope: message.scope,
        text: message.text,
        allowStudio: settings.include_snapshot,
      });
      if (!resolved.ok) throw fail('ACCESS_DENIED', resolved.reason);
      let reason = resolved.reason;
      // PR #136 review L1 / PR #139 re-review L-B: a General or Selected records answer gets
      // earlier answers only when they were made without studio records, so its context is
      // exactly what it says. Only My projects (the snapshot) keeps them. The person's own
      // earlier messages always go.
      const turns = await c.query(
        `select m.seq, m.text, a.text as answer,
           (a.context in ('project','selected') or (a.context is null and a.snapshot)) as studio
         from chat_messages m
         left join lateral (select text, context, snapshot from chat_answers
           where message_id = m.id and state = 'completed'
           order by created_at desc limit 1) a on true
         where m.conversation_id = $1 and m.seq < $2
         order by m.seq desc limit $3`,
        [conversation.id, msg.seq, CHAT_HISTORY_TURNS],
      );
      const history: { who: 'person' | 'assistant'; text: string }[] = [];
      let withheld = 0;
      for (const t of turns.rows.reverse() as Row[]) {
        history.push({ who: 'person', text: String(t.text) });
        if (!t.answer) continue;
        if (resolved.context !== 'project' && t.studio) withheld += 1;
        else history.push({ who: 'assistant', text: String(t.answer) });
      }
      if (withheld > 0)
        reason = `${reason} ${withheld} earlier ${withheld === 1 ? 'answer that used' : 'answers that used'} studio records ${withheld === 1 ? 'was' : 'were'} left out; your earlier messages were included.`;
      const snapshot =
        resolved.context === 'project' ? await chatSnapshot(c, uuid(ws)) : null;
      const picked =
        resolved.context === 'selected'
          ? await chatSelected(c, uuid(ws), message.selected)
          : null;
      if (picked && picked.records.length === 0)
        throw fail(
          'ACCESS_DENIED',
          'None of the picked records is still active, so nothing was sent. Pick other records or choose General.',
        );
      if (picked && picked.missing > 0)
        reason = `${reason} ${picked.missing} picked ${picked.missing === 1 ? 'record is' : 'records are'} no longer active and ${picked.missing === 1 ? 'was' : 'were'} left out.`;
      const built = chatInput({
        snapshot,
        selected: picked?.text ?? null,
        history,
        question: String(msg.text),
        maxChars: Math.max(
          500,
          conn.settings.caps.responses.max_input_chars -
            CHAT_INSTRUCTIONS.length,
        ),
      });
      const context = built.snapshot ? resolved.context : 'general';
      if (resolved.context !== 'general' && !built.snapshot)
        reason = `${reason} The studio records were left out because the question alone fills the connection's input limit.`;
      const id = randomUUID();
      const op = randomUUID();
      const { rows } = await c.query(
        `insert into chat_answers (id, workspace_id, conversation_id, message_id, client_id, state,
           connection_id, connection_kind, fixture, model_id, logical_operation_id,
           instructions_version, instructions_hash, history_items, snapshot, input, input_hash,
           created_by, context, context_reason, context_records)
         values ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)
         returning *`,
        [
          id,
          uuid(ws),
          conversation.id,
          msg.id,
          req.client_id,
          conn.id,
          conn.kind,
          conn.fixture,
          settings.model_id,
          op,
          CHAT_INSTRUCTIONS_VERSION,
          createHash('sha256').update(CHAT_INSTRUCTIONS).digest('hex'),
          built.history_items,
          built.snapshot,
          built.input,
          createHash('sha256').update(built.input).digest('hex'),
          ctx.actorId,
          context,
          reason.slice(0, 600),
          JSON.stringify(
            context === 'selected' && picked ? picked.records : [],
          ),
        ],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.answer_requested',
        subjectKind: 'chat_conversation',
        subjectId: conversation.id,
        subjectVersion: null,
        contentHash: canonicalHash({ input: built.input }),
        // Ids and route only; the words stay in the conversation.
        payload: {
          answer_id: id,
          message_id: String(msg.id),
          connection_id: conn.id,
          model_id: settings.model_id,
          context,
        },
      });
      return {
        answer: toChatAnswer(rows[0] as Row),
        replay: false,
        instructions: CHAT_INSTRUCTIONS,
        input: built.input,
        logical_operation_id: op,
      };
    });
    if (!begun.replay) this.#liveChatAnswers.add(begun.answer.id);
    return begun;
  }

  /**
   * ADR-0096 (P31): records one "Fill in with <model>" press on a draft card and works out
   * exactly what will be sent. Owner only, like chat answers, and only while chat answers are
   * on (the same connection, model, daily limit and private-data rule apply at admission).
   * Only the card's descriptive text questions may be asked about (`fillableKey`); a retried
   * press (same `client_id`) or a fill still on its way returns that fill. Nothing is sent
   * here, and nothing on the card changes.
   */
  async beginChatActionFill(
    ctxIn: CommandContext,
    ws: string,
    conversationId: string,
    actionId: string,
    raw: unknown,
  ): Promise<{
    fill: ChatActionFill;
    replay: boolean;
    input: string;
    logical_operation_id: string;
    connection_id: string;
    questions: ChatActionFillQuestion[];
  }> {
    const ctx = normalize(ctxIn);
    const req = parse(ChatActionFillRequestSchema, raw);
    const begun = await this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const conversation = await chatConversation(
        c,
        uuid(ws),
        uuid(conversationId),
        true,
      );
      const card = await chatAction(
        c,
        uuid(ws),
        conversation.id,
        uuid(actionId),
      );
      // A fill left pending by a studio that stopped mid-request is closed as failed (the same
      // stale point as chat answers), so the card can be filled again.
      await c.query(
        `update chat_action_fills ca set state = 'failed', finished_at = clock_timestamp(),
           reason = 'The studio stopped before this fill was recorded. Nothing more is known about it.'
         where ca.action_id = $1 and ca.state = 'pending'
           and ca.created_at < ${CHAT_ANSWER_STALE_POINT}
           and not (ca.id = any($2::uuid[]))`,
        [card.id, [...this.#liveChatFills]],
      );
      const prior = (
        await c.query(
          `select * from chat_action_fills where action_id = $1
           and (client_id = $2 or state = 'pending')
           order by (client_id = $2) desc limit 1`,
          [card.id, req.client_id],
        )
      ).rows[0] as Row | undefined;
      if (prior)
        return {
          fill: toChatActionFill(prior),
          replay: true,
          input: String(prior.input),
          logical_operation_id: String(prior.logical_operation_id),
          connection_id: String(prior.connection_id),
          questions: parse(
            z.array(ChatActionFillQuestionSchema),
            prior.questions,
          ),
        };
      if (card.state !== 'draft')
        throw fail(
          'INVALID_TRANSITION',
          'Only a card that has not been sent can be filled in.',
        );
      cardVersion(card, req.expected_version);
      const refused = req.questions.filter(
        (q) => !fillableKey(card.kind, q.key),
      );
      if (refused.length)
        throw fail(
          'ACCESS_DENIED',
          `A model may propose only a card's descriptive text, never a pick, a rating, a gate, a reason or a routine setting (${refused.map((q) => q.key).join(', ')}).`,
        );
      // Review L-3: each question's length and its answer so far come from the server (the
      // card as saved), not from the page; only its wording comes from the page.
      const questions: ChatActionFillQuestion[] = req.questions.map((q) => {
        const saved = card.input[q.key];
        const { current: _sent, ...rest } = q;
        return {
          ...rest,
          type: fillType(q.key),
          ...(typeof saved === 'string' && saved.trim()
            ? { current: saved.slice(0, CHAT_FILL_TEXT_MAX.long) }
            : {}),
        };
      });
      const settings = await chatSettings(c, uuid(ws));
      if (!settings.enabled || !settings.connection_id || !settings.model_id)
        throw fail(
          'ACCESS_DENIED',
          'Chat answers are turned off. The owner can turn them on in Models and connections.',
        );
      const conn = await this.#connection(c, uuid(ws), settings.connection_id);
      // Review N-6: say so before anything is recorded when the cap cannot hold a fill at all.
      const room =
        conn.settings.caps.responses.max_input_chars -
        CHAT_FILL_INSTRUCTIONS.length;
      if (room < 500)
        throw fail(
          'INVALID_CONTRACT',
          `The connection's input limit (${conn.settings.caps.responses.max_input_chars} characters) is too small for a fill's instructions and questions, so nothing was sent. Fill the card in by hand, or raise the limit in Models and connections.`,
        );
      // The person's messages always go. Model answers that used studio records go only when
      // the owner's chat setting lets studio records go (ADR-0070), as do the card's records.
      const records = settings.include_snapshot;
      const turns = await c.query(
        `select m.text, a.text as answer,
           (a.context in ('project','selected') or (a.context is null and a.snapshot)) as studio
         from chat_messages m
         left join lateral (select text, context, snapshot from chat_answers
           where message_id = m.id and state = 'completed'
           order by created_at desc limit 1) a on true
         where m.conversation_id = $1
         order by m.seq desc limit $2`,
        [conversation.id, CHAT_HISTORY_TURNS],
      );
      const history: { who: 'person' | 'assistant'; text: string }[] = [];
      for (const t of turns.rows.reverse() as Row[]) {
        history.push({ who: 'person', text: String(t.text) });
        if (t.answer && (records || !t.studio))
          history.push({ who: 'assistant', text: String(t.answer) });
      }
      const built = fillInput({
        step: CHAT_ACTION_LABEL[card.kind],
        history,
        questions,
        records,
        maxChars: room,
      });
      if (!built)
        throw fail(
          'INVALID_CONTRACT',
          "The card's questions alone are longer than the connection's input limit, so nothing was sent. Fill it in by hand.",
        );
      const id = randomUUID();
      const op = randomUUID();
      const { rows } = await c.query(
        `insert into chat_action_fills (id, workspace_id, conversation_id, action_id, client_id,
           state, connection_id, connection_kind, fixture, model_id, logical_operation_id,
           instructions_version, instructions_hash, questions, records, history_items, input,
           input_hash, created_by)
         values ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
         returning *`,
        [
          id,
          uuid(ws),
          conversation.id,
          card.id,
          req.client_id,
          conn.id,
          conn.kind,
          conn.fixture,
          settings.model_id,
          op,
          CHAT_FILL_INSTRUCTIONS_VERSION,
          createHash('sha256').update(CHAT_FILL_INSTRUCTIONS).digest('hex'),
          JSON.stringify(questions),
          records,
          built.history_items,
          built.input,
          createHash('sha256').update(built.input).digest('hex'),
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.action_fill_requested',
        subjectKind: 'chat_conversation',
        subjectId: conversation.id,
        subjectVersion: null,
        contentHash: canonicalHash({ input: built.input }),
        // Ids, route and question keys only; the words stay with the fill.
        payload: {
          fill_id: id,
          action_id: card.id,
          kind: card.kind,
          connection_id: conn.id,
          model_id: settings.model_id,
          keys: questions.map((q) => q.key),
          records,
        },
      });
      return {
        fill: toChatActionFill(rows[0] as Row),
        replay: false,
        input: built.input,
        logical_operation_id: op,
        connection_id: conn.id,
        questions,
      };
    });
    if (!begun.replay) this.#liveChatFills.add(begun.fill.id);
    return begun;
  }

  /** ADR-0096: records how a pending fill ended, with the proposals the studio could read. */
  async finishChatActionFill(
    ctxIn: CommandContext,
    ws: string,
    fillId: string,
    outcome: {
      state: Exclude<ChatActionFillState, 'pending'>;
      plan_request_id: string | null;
      text: string | null;
      reason: string | null;
    },
  ): Promise<ChatActionFill> {
    const ctx = normalize(ctxIn);
    try {
      return await this.tx(async (c) => {
        const cur = (
          await c.query(
            'select * from chat_action_fills where workspace_id = $1 and id = $2 for update',
            [uuid(ws), uuid(fillId)],
          )
        ).rows[0] as Row | undefined;
        if (!cur)
          throw fail(
            'NOT_FOUND',
            'The card or its conversation was deleted while this fill was on its way, so the proposals were not kept. The plan request is still counted.',
          );
        if (cur.state !== 'pending') return toChatActionFill(cur);
        const text =
          outcome.state === 'completed' ? (outcome.text ?? '') : null;
        const questions = parse(
          z.array(ChatActionFillQuestionSchema),
          cur.questions,
        );
        const read =
          text === null
            ? { values: {}, dropped: 0, readable: true }
            : readFillValues(text.slice(0, CHAT_FILL_OUTPUT_MAX), questions);
        const n = Object.keys(read.values).length;
        const reason =
          text === null
            ? (outcome.reason?.slice(0, 2000) ?? null)
            : !read.readable
              ? 'The reply was not the JSON the studio asked for, so nothing was proposed.'
              : n === 0
                ? `The model proposed nothing it could support from the conversation${read.dropped ? ` (${read.dropped} ${read.dropped === 1 ? 'proposal was' : 'proposals were'} left out)` : ''}.`
                : read.dropped
                  ? `${read.dropped} ${read.dropped === 1 ? 'proposal was' : 'proposals were'} left out: not a question asked, not text, empty or too long.`
                  : null;
        const { rows } = await c.query(
          `update chat_action_fills set state = $2, plan_request_id = $3, text = $4,
             output_hash = $5, fill_values = $6, dropped = $7, reason = $8,
             finished_at = clock_timestamp()
           where id = $1 returning *`,
          [
            cur.id,
            outcome.state,
            outcome.plan_request_id || null,
            text,
            text === null
              ? null
              : createHash('sha256').update(text).digest('hex'),
            JSON.stringify(read.values),
            read.dropped,
            reason,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: uuid(ws),
          action: 'chat.action_filled',
          subjectKind: 'chat_conversation',
          subjectId: String(cur.conversation_id),
          subjectVersion: null,
          contentHash: canonicalHash({ state: outcome.state, text }),
          payload: {
            fill_id: String(cur.id),
            action_id: String(cur.action_id),
            state: outcome.state,
            model_id: String(cur.model_id),
            plan_request_id: outcome.plan_request_id || null,
            proposed: Object.keys(read.values),
            dropped: read.dropped,
          },
        });
        return toChatActionFill(rows[0] as Row);
      });
    } finally {
      this.#liveChatFills.delete(fillId);
    }
  }

  /**
   * ADR-0101 (UX pass P-5): records one "Draft the missing sections" press on a saved
   * proposal and works out exactly what will be sent. Owner only, on the owner's chat model
   * (Chat answers on, and studio records allowed to go, since the proposal is a studio
   * record); the chat admission rules and daily limit apply when it is sent. Only sections a
   * model may draft (`PROPOSAL_DRAFTABLE_SECTIONS`) that are unknown in the version read may be
   * asked for. A retried press (same `client_id`) or a draft still on its way returns that
   * draft. Nothing is sent here, and nothing in the proposal changes.
   */
  /**
   * ADR-0101: a draft left pending by a studio that stopped mid-request is closed as failed
   * once past the chat answers' stale point (review 1 M-1: on every read too, so the page's
   * button is not held by it). If its proposal was redacted meanwhile, its words go as well
   * (review 1 L-1).
   */
  async #closeStaleSectionDrafts(c: PoolClient, ws: string, pid: string) {
    await c.query(
      `update proposal_section_drafts ca set state = 'failed', finished_at = clock_timestamp(),
         reason = 'The studio stopped before this draft was recorded. Nothing more is known about it.',
         input = case when e.status = 'redacted' then '' else ca.input end,
         redacted_at = case when e.status = 'redacted' then clock_timestamp() else null end
         from entities e
       where e.workspace_id = ca.workspace_id and e.id = ca.proposal_id
         and ca.workspace_id = $1 and ca.proposal_id = $2 and ca.state = 'pending'
         and ca.created_at < ${CHAT_ANSWER_STALE_POINT}
         and not (ca.id = any($3::uuid[]))`,
      [ws, pid, [...this.#liveSectionDrafts]],
    );
  }

  /** The proposal's drafts, newest first, after closing any a stopped studio left pending. */
  override async listProposalSectionDrafts(
    ctxIn: CommandContext,
    ws: string,
    proposalId: string,
  ): Promise<ProposalSectionDraft[]> {
    const ctx = normalize(ctxIn);
    await this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      await this.#closeStaleSectionDrafts(c, uuid(ws), uuid(proposalId));
    });
    return super.listProposalSectionDrafts(ctx, ws, proposalId);
  }

  async beginProposalSectionDraft(
    ctxIn: CommandContext,
    ws: string,
    proposalId: string,
    raw: unknown,
  ): Promise<{
    draft: ProposalSectionDraft;
    replay: boolean;
    input: string;
    logical_operation_id: string;
    connection_id: string;
  }> {
    const ctx = normalize(ctxIn);
    const req = parse(ProposalSectionDraftRequestSchema, raw);
    const pid = uuid(proposalId);
    // Read outside the write: the version, its sections, titles and references.
    const detail = await this.proposalDetail(ctx, ws, pid);
    const begun = await this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const cur = (
        await c.query(
          `select id, version, status from entities
            where workspace_id = $1 and id = $2 and kind = 'proposal' for update`,
          [uuid(ws), pid],
        )
      ).rows[0] as Row | undefined;
      if (!cur) throw fail('NOT_FOUND', 'Proposal not found.');
      await this.#closeStaleSectionDrafts(c, uuid(ws), pid);
      const prior = (
        await c.query(
          `select * from proposal_section_drafts where proposal_id = $1
             and (client_id = $2 or state = 'pending')
           order by (client_id = $2) desc limit 1`,
          [pid, req.client_id],
        )
      ).rows[0] as Row | undefined;
      if (prior)
        return {
          draft: toSectionDraft(prior),
          replay: true,
          input: String(prior.input),
          logical_operation_id: String(prior.logical_operation_id),
          connection_id: String(prior.connection_id),
        };
      if (cur.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          `A ${String(cur.status)} proposal cannot be drafted.`,
        );
      if (
        Number(cur.version) !== req.version ||
        detail.proposal.version !== req.version
      )
        throw fail(
          'VERSION_CONFLICT',
          'The proposal has a newer version; read it again before drafting.',
        );
      const body = detail.proposal.body;
      const written = req.sections.filter(
        (k) => body.sections[k].state !== 'unknown',
      );
      if (written.length)
        throw fail(
          'INVALID_TRANSITION',
          `Only sections that are still unknown are drafted (${written.join(', ')} ${written.length === 1 ? 'is' : 'are'} not).`,
        );
      const settings = await chatSettings(c, uuid(ws));
      if (!settings.enabled || !settings.connection_id || !settings.model_id)
        throw fail(
          'ACCESS_DENIED',
          'Drafting uses your chat model, and Chat answers are turned off. The owner can turn them on in Models and connections.',
        );
      if (!settings.include_snapshot)
        throw fail(
          'ACCESS_DENIED',
          'Drafting sends this proposal and its cited claims to your chat model, and your chat setting keeps studio records in the studio. Allow studio records in Chat answers (Models and connections) to draft, or write the sections yourself.',
        );
      const conn = await this.#connection(c, uuid(ws), settings.connection_id);
      const room =
        conn.settings.caps.responses.max_input_chars -
        PROPOSAL_DRAFT_INSTRUCTIONS.length;
      const built =
        room < 500
          ? null
          : proposalDraftInput({
              title: detail.proposal.title,
              summary: body.summary,
              problem_title: detail.problem_title,
              response: body.response.replaceAll('_', ' '),
              option_title: detail.option_title,
              written: PROPOSAL_SECTIONS.filter(
                (k) =>
                  body.sections[k].state === 'written' &&
                  body.sections[k].text.trim(),
              ).map((k) => ({ key: k, text: body.sections[k].text })),
              references: detail.checks.references.map((r) => ({
                label: r.label,
                statement: r.statement,
              })),
              asked: req.sections,
              maxChars: room,
            });
      if (!built)
        throw fail(
          'INVALID_CONTRACT',
          `The connection's input limit (${conn.settings.caps.responses.max_input_chars} characters) cannot hold the drafting instructions, the proposal's header and references, so nothing was sent. Write the sections yourself, or raise the limit in Models and connections.`,
        );
      const id = randomUUID();
      const op = randomUUID();
      const { rows } = await c.query(
        `insert into proposal_section_drafts (id, workspace_id, proposal_id, proposal_version,
           client_id, state, connection_id, connection_kind, fixture, model_id,
           logical_operation_id, instructions_version, instructions_hash, sections,
           sections_sent, input, input_hash, requested_by)
         values ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         returning *`,
        [
          id,
          uuid(ws),
          pid,
          req.version,
          req.client_id,
          conn.id,
          conn.kind,
          conn.fixture,
          settings.model_id,
          op,
          PROPOSAL_DRAFT_INSTRUCTIONS_VERSION,
          createHash('sha256')
            .update(PROPOSAL_DRAFT_INSTRUCTIONS)
            .digest('hex'),
          JSON.stringify(req.sections),
          built.sections_sent,
          built.input,
          createHash('sha256').update(built.input).digest('hex'),
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'proposal.section_draft_requested',
        subjectKind: 'proposal',
        subjectId: pid,
        subjectVersion: req.version,
        contentHash: canonicalHash({ input: built.input }),
        // Ids, route and section keys only; the words stay with the draft.
        payload: {
          draft_id: id,
          connection_id: conn.id,
          model_id: settings.model_id,
          sections: req.sections,
        },
      });
      return {
        draft: toSectionDraft(rows[0] as Row),
        replay: false,
        input: built.input,
        logical_operation_id: op,
        connection_id: conn.id,
      };
    });
    if (!begun.replay) this.#liveSectionDrafts.add(begun.draft.id);
    return begun;
  }

  /** ADR-0101: records how a pending draft ended, with the drafts the studio could read. */
  async finishProposalSectionDraft(
    ctxIn: CommandContext,
    ws: string,
    draftId: string,
    outcome: {
      state: Exclude<ProposalSectionDraftState, 'pending'>;
      plan_request_id: string | null;
      text: string | null;
      reason: string | null;
    },
  ): Promise<ProposalSectionDraft> {
    const ctx = normalize(ctxIn);
    try {
      return await this.tx(async (c) => {
        const cur = (
          await c.query(
            `select d.*, e.status as proposal_status from proposal_section_drafts d
               join entities e on e.workspace_id = d.workspace_id and e.id = d.proposal_id
              where d.workspace_id = $1 and d.id = $2 for update of d`,
            [uuid(ws), uuid(draftId)],
          )
        ).rows[0] as Row | undefined;
        if (!cur) throw fail('NOT_FOUND', 'Draft not found.');
        if (cur.state !== 'pending') return toSectionDraft(cur);
        const reply =
          outcome.state === 'completed' ? (outcome.text ?? '') : null;
        const asked = (cur.sections ?? []) as ProposalSectionDraft['sections'];
        const read =
          reply === null
            ? { values: {}, dropped: 0, readable: true }
            : readSectionDrafts(
                reply.slice(0, PROPOSAL_DRAFT_OUTPUT_MAX),
                asked,
              );
        const n = Object.keys(read.values).length;
        const reason =
          reply === null
            ? (outcome.reason?.slice(0, 2000) ?? null)
            : !read.readable
              ? 'The reply was not the JSON the studio asked for, so nothing was drafted.'
              : n === 0
                ? `The model drafted nothing${read.dropped ? ` (${read.dropped} ${read.dropped === 1 ? 'draft was' : 'drafts were'} left out)` : ''}.`
                : read.dropped
                  ? `${read.dropped} ${read.dropped === 1 ? 'draft was' : 'drafts were'} left out: not a section asked for, empty or too long.`
                  : null;
        // The proposal was redacted while this draft was on its way: keep the outcome, not the words.
        const redacted = cur.proposal_status === 'redacted';
        const { rows } = await c.query(
          `update proposal_section_drafts set state = $2, plan_request_id = $3, text = $4,
             output_hash = $5, draft_values = $6, dropped = $7, reason = $8,
             finished_at = clock_timestamp(),
             input = case when $9 then '' else input end,
             redacted_at = case when $9 then clock_timestamp() else null end
           where id = $1 returning *`,
          [
            cur.id,
            outcome.state,
            outcome.plan_request_id || null,
            reply === null ? null : redacted ? '' : reply,
            reply === null
              ? null
              : createHash('sha256').update(reply).digest('hex'),
            JSON.stringify(redacted ? {} : read.values),
            read.dropped,
            reason,
            redacted,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: uuid(ws),
          action: 'proposal.section_drafted',
          subjectKind: 'proposal',
          subjectId: String(cur.proposal_id),
          subjectVersion: Number(cur.proposal_version),
          contentHash: canonicalHash({ state: outcome.state, text: reply }),
          payload: {
            draft_id: String(cur.id),
            state: outcome.state,
            model_id: String(cur.model_id),
            plan_request_id: outcome.plan_request_id || null,
            drafted: Object.keys(read.values),
            dropped: read.dropped,
          },
        });
        return toSectionDraft(rows[0] as Row);
      });
    } finally {
      this.#liveSectionDrafts.delete(draftId);
    }
  }

  /** ADR-0057: records how a pending chat answer ended. A settled answer never changes. */
  async finishChatAnswer(
    ctxIn: CommandContext,
    ws: string,
    answerId: string,
    outcome: {
      state: Exclude<ChatAnswerState, 'pending'>;
      plan_request_id: string | null;
      text: string | null;
      reason: string | null;
    },
  ): Promise<ChatAnswer> {
    const ctx = normalize(ctxIn);
    try {
      return await this.#finishChatAnswer(ctx, ws, answerId, outcome);
    } finally {
      this.#liveChatAnswers.delete(answerId);
    }
  }

  async #finishChatAnswer(
    ctx: CommandContext,
    ws: string,
    answerId: string,
    outcome: {
      state: Exclude<ChatAnswerState, 'pending'>;
      plan_request_id: string | null;
      text: string | null;
      reason: string | null;
    },
  ): Promise<ChatAnswer> {
    return this.tx(async (c) => {
      const cur = (
        await c.query(
          'select * from chat_answers where workspace_id = $1 and id = $2 for update',
          [uuid(ws), uuid(answerId)],
        )
      ).rows[0] as Row | undefined;
      // PR #124 timeout review L-1: today the only way a begun answer disappears is its
      // conversation being deleted; say so instead of a bare "not found".
      if (!cur)
        throw fail(
          'NOT_FOUND',
          'The conversation was deleted while this answer was on its way, so the answer was not kept. The plan request is still counted.',
        );
      if (cur.state !== 'pending') return toChatAnswer(cur);
      const text = outcome.state === 'completed' ? (outcome.text ?? '') : null;
      const { rows } = await c.query(
        `update chat_answers set state = $2, plan_request_id = $3, text = $4, output_hash = $5,
           reason = $6, finished_at = clock_timestamp()
         where id = $1 returning *`,
        [
          cur.id,
          outcome.state,
          outcome.plan_request_id || null,
          text,
          text === null
            ? null
            : createHash('sha256').update(text).digest('hex'),
          outcome.reason?.slice(0, 2000) ?? null,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: uuid(ws),
        action: 'chat.answered',
        subjectKind: 'chat_conversation',
        subjectId: String(cur.conversation_id),
        subjectVersion: null,
        contentHash: canonicalHash({ state: outcome.state, text }),
        payload: {
          answer_id: String(cur.id),
          state: outcome.state,
          model_id: String(cur.model_id),
          connection_kind: String(cur.connection_kind),
          plan_request_id: outcome.plan_request_id || null,
        },
      });
      // ADR-0083: an answer may suggest one studio step. It becomes a draft card the person
      // checks and sends; the model's hints only prefill answers, and nothing is sent here.
      const proposed = text === null ? null : readProposedAction(text);
      if (proposed?.found && proposed.ok) {
        const actionId = randomUUID();
        const input = {
          ...(proposed.hints.text ? { hint_text: proposed.hints.text } : {}),
          ...(proposed.hints.url ? { hint_url: proposed.hints.url } : {}),
        };
        await c.query(
          `insert into chat_actions (id, workspace_id, conversation_id, client_id, message_id,
             answer_id, origin, kind, input, subjects, state, version, created_by)
           values ($1, $2, $3, $4, $5, $6, 'model', $7, $8, '[]', 'draft', 1, $9)`,
          [
            actionId,
            uuid(ws),
            String(cur.conversation_id),
            randomUUID(),
            String(cur.message_id),
            String(cur.id),
            proposed.kind,
            JSON.stringify(input),
            ctx.actorId,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: uuid(ws),
          action: 'chat.action_proposed',
          subjectKind: 'chat_conversation',
          subjectId: String(cur.conversation_id),
          subjectVersion: null,
          contentHash: canonicalHash({ kind: proposed.kind, input }),
          payload: {
            action_id: actionId,
            kind: proposed.kind,
            origin: 'model',
            answer_id: String(cur.id),
          },
        });
      }
      return toChatAnswer(rows[0] as Row);
    });
  }

  async planConnectionDetail(
    ctxIn: CommandContext,
    ws: string,
    id: string,
  ): Promise<PlanConnectionDetail> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return this.#detail(c, ws, uuid(id), ctx.actorId);
    });
  }

  async updatePlanSettings(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const req = parse(UpdatePlanSettingsRequestSchema, body);
    return this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'settings_changed',
      async (c, conn) => {
        const issues = kindSettingsIssues(conn.kind, req.settings);
        if (issues.length)
          throw new ContractError(
            'INVALID_CONTRACT',
            'These settings do not fit this connection type.',
            issues,
          );
        // Any change to the settings withdraws the owner's acceptance of the caps.
        await c.query(
          `update plan_connections set settings = $2, settings_hash = $3, caps_accepted_at = null,
           caps_accepted_by = null where id = $1`,
          [conn.id, req.settings, canonicalHash(req.settings)],
        );
        return { settings_hash: canonicalHash(req.settings) };
      },
    );
  }

  async acceptPlanCaps(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const req = parse(AcceptPlanCapsRequestSchema, body);
    return this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'caps_accepted',
      async (c, conn) => {
        if (conn.settings_hash !== req.settings_hash)
          throw fail(
            'VERSION_CONFLICT',
            'The caps changed; review the current ones before accepting.',
          );
        await c.query(
          `update plan_connections set caps_accepted_at = clock_timestamp(), caps_accepted_by = $2 where id = $1`,
          [conn.id, ctx.actorId],
        );
        return { settings_hash: req.settings_hash, caps: conn.settings.caps };
      },
    );
  }

  async attestPlanCredits(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const req = parse(AttestCreditsRequestSchema, body);
    return this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'credits_confirmed_off',
      async (c, conn) => {
        if (req.statement !== usageOffStatement(conn.kind))
          throw fail(
            'INVALID_CONTRACT',
            'That statement is for the other kind of connection.',
          );
        await c.query(
          `update plan_connections set credits = jsonb_build_object('state','confirmed_off',
           'checked_on', $2::text, 'confirmed_at', to_jsonb(clock_timestamp()), 'confirmed_by', $3::text)
         where id = $1`,
          [conn.id, req.checked_on, ctx.actorId],
        );
        return { statement: req.statement, checked_on: req.checked_on };
      },
    );
  }

  async withdrawPlanCredits(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const req = parse(WithdrawCreditsRequestSchema, body);
    return this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'credits_unconfirmed',
      async (c, conn) => {
        await c.query(
          `update plan_connections set credits = '{"state":"unconfirmed","checked_on":null,"confirmed_at":null,"confirmed_by":null}'::jsonb where id = $1`,
          [conn.id],
        );
        return { reason: req.reason };
      },
    );
  }

  async createPlanVerificationGrant(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const req = parse(CreateVerificationGrantRequestSchema, body);
    let grant: PlanVerificationGrant | null = null;
    await this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      req.intent === 'availability_recheck'
        ? 'availability_recheck_approved'
        : 'verification_approved',
      async (c, conn) => {
        if (conn.kind === 'claude_code' && req.path !== 'responses')
          throw fail(
            'INVALID_CONTRACT',
            'Claude Code connections have the direct path only.',
          );
        const blockers = connectionBlockers(conn);
        if (blockers.length)
          throw new ContractError(
            'INVALID_TRANSITION',
            'The connection is not ready for a live call.',
            blockers,
          );
        const gid = randomUUID();
        const { rows } = await c.query(
          `insert into plan_verification_grants (id, connection_id, model_id, path, max_requests, expires_at, created_by, intent)
         values ($1,$2,$3,$4,1, clock_timestamp() + make_interval(mins => $5), $6, $7) returning *`,
          [
            gid,
            conn.id,
            req.model_id,
            req.path,
            req.expires_in_minutes,
            ctx.actorId,
            req.intent ?? 'model_access',
          ],
        );
        grant = toGrant(rows[0] as Row);
        return {
          grant_id: gid,
          model_id: req.model_id,
          path: req.path,
          intent: req.intent ?? 'model_access',
        };
      },
    );
    return grant!;
  }

  /** The owner records the outcome of a request whose result is unknown or stuck in flight. */
  async reconcilePlanRequest(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    requestId: string,
    body: unknown,
  ) {
    const ctx = normalize(ctxIn);
    const req = parse(ReconcilePlanRequestSchema, body);
    // PR #128 review L-2: refuse before taking any lock. Settling locks the request row before
    // the connection, the reverse of this path, so closing a request at the moment it settles
    // could deadlock and lose the real result. The check inside the transaction stays too.
    const waiting = () =>
      fail(
        'INVALID_TRANSITION',
        'The studio is still waiting on this request. It can be closed once it finishes, or after the studio restarts.',
      );
    if (this.#livePlanRequests.has(String(uuid(requestId)))) throw waiting();
    return this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'request_reconciled',
      async (c, conn) => {
        const observed = await c.query(
          `select pr.output_chars, pr.state, ${PLAN_REQUEST_STALE_AFTER} <= clock_timestamp() as overdue
           from plan_requests pr join plan_connections pc on pc.id = pr.connection_id
           where pr.id=$1 and pr.connection_id=$2
           and pr.state in ('unknown','in_flight') for update of pr`,
          [uuid(requestId), conn.id],
        );
        // ADR-0064: an in-flight request may still be running. It can be closed only once this
        // studio is not waiting on it and it is past the running-now panel's stale point (its
        // timeout plus 15 minutes, at least 45 minutes), so a live result is never overwritten.
        const open = observed.rows[0] as Row | undefined;
        if (open?.state === 'in_flight') {
          if (this.#livePlanRequests.has(String(uuid(requestId))))
            throw waiting();
          if (!open.overdue)
            throw fail(
              'INVALID_TRANSITION',
              'This request may still be running. It can be closed once its timeout plus 15 minutes (at least 45 minutes) has passed.',
            );
        }
        if (
          req.outcome === 'did_not_run' &&
          Number(observed.rows[0]?.output_chars ?? 0) > 0
        )
          throw fail(
            'INVALID_TRANSITION',
            'Cannot record did_not_run: this request has observed output.',
          );
        const r = await c.query(
          `update plan_requests set state = 'reconciled', reason_code = $3, finished_at = coalesce(finished_at, clock_timestamp())
         where id = $1 and connection_id = $2 and state in ('unknown','in_flight') returning id`,
          [uuid(requestId), conn.id, `owner_${req.outcome}`],
        );
        if (!r.rowCount)
          throw fail(
            'INVALID_TRANSITION',
            'That request has no unresolved outcome.',
          );
        return { request_id: requestId, outcome: req.outcome, note: req.note };
      },
    );
  }

  /** Owner says to try the plan again after a usage limit; the next request re-observes it. */
  async resetPlanQuotaObservation(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    expectedVersion: number,
  ) {
    const ctx = normalize(ctxIn);
    return this.#ownerChange(
      ctx,
      ws,
      id,
      expectedVersion,
      'quota_recheck',
      async (c, conn) => {
        await c.query(
          `update plan_connections set quota = '{"state":"unknown","reason_code":null,"observed_at":null}'::jsonb where id = $1`,
          [conn.id],
        );
        return { previous: conn.quota.state };
      },
    );
  }

  // ---- Sign-in state (written by the studio's OAuth service, never by a browser) ----------

  async recordPlanSignIn(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    s: {
      issued_client_id: string;
      account_label: string;
      scopes: string[];
      access_expires_at: string;
      credential_ref: string;
      expected_auth_generation: string;
    },
  ) {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const conn = await this.#lock(c, ws, uuid(id));
      if (conn.kind !== 'chatgpt_plan')
        throw fail(
          'INVALID_TRANSITION',
          'Only ChatGPT plan connections sign in through the studio.',
        );
      const previous = (
        await c.query(
          'select auth_generation, credential_ref from plan_connections where id = $1',
          [conn.id],
        )
      ).rows[0];
      if (String(previous.auth_generation) !== s.expected_auth_generation)
        throw fail(
          'VERSION_CONFLICT',
          'The login changed during sign-in. Start a new sign-in.',
        );
      if (
        conn.sign_in.issued_client_id &&
        conn.sign_in.issued_client_id !== s.issued_client_id
      )
        throw fail(
          'EVIDENCE_MISMATCH',
          'This sign-in belongs to a different registration.',
        );
      const granted = s.scopes.includes('chatgpt.tokens.use.direct');
      await c.query(
        `update plan_connections set version = version + 1, auth_generation = auth_generation + 1, updated_at = clock_timestamp(),
           credential_ref = $2, sign_in = $3, status_reason = null where id = $1`,
        [
          conn.id,
          s.credential_ref,
          {
            state: 'signed_in',
            issued_client_id: s.issued_client_id,
            account_label: s.account_label,
            scopes: [...s.scopes].sort(),
            plan_usage_granted: granted,
            verified_at: new Date().toISOString(),
            access_expires_at: s.access_expires_at,
          },
        ],
      );
      await this.#event(
        c,
        conn.id,
        'signed_in',
        { scopes: s.scopes, plan_usage_granted: granted },
        ctx,
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'connection.signed_in',
        subjectKind: 'plan_connection',
        subjectId: conn.id,
        subjectVersion: conn.version + 1,
        contentHash: null,
        payload: { plan_usage_granted: granted },
      });
      return {
        connection: await this.#connection(c, ws, conn.id),
        replaced_credential_ref: nullable(previous.credential_ref),
      };
    });
  }

  /**
   * ADR-0050: records one `claude auth status` check of the owner's own Claude Code CLI. The
   * studio holds no Claude credential; signed in means Claude Code reported a claude.ai login.
   * Anything else (API key, long-lived token, helper, cloud provider) is recorded as not
   * granting plan usage, so requests stay blocked rather than billing another account.
   */
  async recordClaudeCodeStatus(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    s: ClaudeCodeStatusObservation,
  ) {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const conn = await this.#lock(c, ws, uuid(id));
      if (conn.kind !== 'claude_code')
        throw fail(
          'INVALID_TRANSITION',
          'This check is for Claude Code connections.',
        );
      const supported = claudeCodeVersionSupported(s.cli_version);
      const subscription =
        supported &&
        s.logged_in &&
        s.auth_method === 'claude.ai' &&
        (s.api_provider === null || s.api_provider === 'firstParty');
      const state = s.logged_in ? 'signed_in' : 'not_signed_in';
      const reason = !supported
        ? `Claude Code ${s.cli_version} is older than ${CLAUDE_CODE_MIN_VERSION}; run claude update, then check again.`
        : !s.logged_in
          ? 'Claude Code reported that it is not signed in.'
          : subscription
            ? null
            : `Claude Code is signed in with ${s.auth_method}${s.api_provider && s.api_provider !== 'firstParty' ? ` (${s.api_provider})` : ''}, not a Claude subscription login.`;
      await c.query(
        `update plan_connections set version = version + 1, auth_generation = auth_generation + 1, updated_at = clock_timestamp(),
           sign_in = $2, status_reason = $3 where id = $1`,
        [
          conn.id,
          {
            state,
            // The CLI version that answered, so a later upgrade is visible in the record.
            issued_client_id: `claude-code/${s.cli_version}`.slice(0, 200),
            account_label: s.account_label,
            scopes: [],
            plan_usage_granted: subscription,
            verified_at: new Date().toISOString(),
            access_expires_at: null,
          },
          reason,
        ],
      );
      const body = {
        logged_in: s.logged_in,
        auth_method: s.auth_method,
        api_provider: s.api_provider,
        cli_version: s.cli_version,
        plan_usage_granted: subscription,
      };
      await this.#event(c, conn.id, 'claude_code_checked', body, ctx);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'connection.claude_code_checked',
        subjectKind: 'plan_connection',
        subjectId: conn.id,
        subjectVersion: conn.version + 1,
        contentHash: null,
        payload: body,
      });
      return this.#connection(c, ws, conn.id);
    });
  }

  async planCredentialRef(
    ctxIn: CommandContext,
    ws: string,
    id: string,
  ): Promise<{
    connection: PlanConnection;
    credential_ref: string | null;
    auth_generation: string;
  }> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      const { rows } = await c.query(
        'select * from plan_connections where workspace_id = $1 and id = $2',
        [ws, uuid(id)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Connection not found.');
      return {
        connection: toConnection(rows[0] as Row),
        credential_ref: nullable(rows[0].credential_ref),
        auth_generation: String(rows[0].auth_generation),
      };
    });
  }

  async recordPlanAccessRefresh(
    connectionId: string,
    oldRef: string,
    newRef: string,
    accessExpiresAt: string,
  ) {
    const result = await this.pool.query(
      `update plan_connections set credential_ref = $3,
         sign_in = jsonb_set(sign_in, '{access_expires_at}', to_jsonb($4::text)),
         version = version + 1, updated_at = clock_timestamp()
       where id = $1 and credential_ref = $2 and sign_in->>'state' = 'signed_in'`,
      [uuid(connectionId), oldRef, newRef, accessExpiresAt],
    );
    return result.rowCount === 1;
  }

  async markPlanReauthorizationRequired(
    connectionId: string,
    reason: string,
    credentialRef: string,
  ) {
    await this.pool.query(
      `update plan_connections set version = version + 1, updated_at = clock_timestamp(),
         sign_in = jsonb_set(sign_in, '{state}', '"reauthorization_required"'), status_reason = $2
       where id = $1 and credential_ref = $3 and sign_in->>'state' = 'signed_in'`,
      [uuid(connectionId), reason.slice(0, 1200), credentialRef],
    );
  }

  async recordPlanSignOut(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    remoteRevocationConfirmed: boolean,
  ) {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const conn = await this.#lock(c, ws, uuid(id));
      // Keeps the issued client id and host id for a later sign-in to the same registration.
      const old = await c.query(
        'select credential_ref from plan_connections where id = $1',
        [conn.id],
      );
      await c.query(
        `update plan_connections set version = version + 1, auth_generation = auth_generation + 1, updated_at = clock_timestamp(),
           credential_ref = null,
           sign_in = jsonb_build_object('state','signed_out','issued_client_id', sign_in->'issued_client_id',
             'account_label', sign_in->'account_label','scopes','[]'::jsonb,'plan_usage_granted',false,
             'verified_at',null,'access_expires_at',null),
           status_reason = $2 where id = $1`,
        [
          conn.id,
          conn.kind === 'claude_code'
            ? 'Disconnected in the studio. Claude Code itself stays signed in; run claude auth logout to sign it out.'
            : remoteRevocationConfirmed
              ? null
              : 'Signed out locally; OpenAI did not confirm the revocation. You can also disconnect Creator Agent in ChatGPT Settings.',
        ],
      );
      await this.#event(
        c,
        conn.id,
        'signed_out',
        { remote_revocation_confirmed: remoteRevocationConfirmed },
        ctx,
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'connection.signed_out',
        subjectKind: 'plan_connection',
        subjectId: conn.id,
        subjectVersion: conn.version + 1,
        contentHash: null,
        payload: { remote_revocation_confirmed: remoteRevocationConfirmed },
      });
      return {
        connection: await this.#connection(c, ws, conn.id),
        credential_ref: nullable(old.rows[0].credential_ref),
      };
    });
  }

  /** Late remote revocation cannot overwrite a newer sign-in or owner change. */
  async recordPlanRevocation(
    ctx: CommandContext,
    ws: string,
    id: string,
    version: number,
    confirmed: boolean,
  ) {
    ctx = normalize(ctx);
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const conn = await this.#lock(c, ws, uuid(id));
      if (
        conn.version === version &&
        conn.sign_in.state === 'signed_out' &&
        confirmed
      ) {
        await c.query(
          'update plan_connections set status_reason = null, version = version + 1, updated_at = clock_timestamp() where id = $1',
          [conn.id],
        );
        await this.#event(c, conn.id, 'sign_out_revocation_confirmed', {}, ctx);
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'connection.revocation_confirmed',
          subjectKind: 'plan_connection',
          subjectId: conn.id,
          subjectVersion: conn.version + 1,
          contentHash: null,
          payload: { remote_revocation_confirmed: true },
        });
      }
      return this.#connection(c, ws, conn.id);
    });
  }

  // ---- Admission and settlement ---------------------------------------------------------

  /**
   * Admits one upstream plan request or refuses it with every reason. On success the request
   * row is in flight and counts against every cap until it settles.
   */
  /** ADR-0086: research-synthesis qualifications bound to the current web discovery prompts. */
  async #webDiscoveryQualifications(
    c: PoolClient,
    id: string,
  ): Promise<PlanQualification[]> {
    const rows = await c.query(
      'select * from plan_qualifications where connection_id=$1',
      [id],
    );
    return rows.rows
      .filter((r) => currentForWebDiscoveryRole(r as Row))
      .map((r) => toQualification(r as Row));
  }

  async #discoveryQualifications(
    c: PoolClient,
    id: string,
    role: Workflow['role'] = 'r02_discovery',
  ): Promise<PlanQualification[]> {
    const rows = await c.query(
      'select * from plan_qualifications where connection_id=$1',
      [id],
    );
    return rows.rows
      .filter((r) =>
        role === 'r08_assessment'
          ? currentForAssessmentRole(r as Row)
          : currentForDiscoveryRole(r as Row),
      )
      .map((r) => toQualification(r as Row));
  }

  protected override async checkSubscriptionWorkflow(
    c: PoolClient,
    _ctx: CommandContext,
    ws: string,
    runId: string,
    setup: Extract<WorkflowResourceSetup, { kind: 'subscription' }>,
    limits: WorkflowLimits,
    dataClass: Workflow['data_class'],
    role: Workflow['role'] = 'r02_discovery',
  ): Promise<void> {
    const assigned = await c.query(
      'select 1 from study_attempts where workspace_id=$1 and run_id=$2',
      [ws, runId],
    );
    if (assigned.rowCount)
      throw fail(
        'SCOPE_EXCEEDED',
        'Subscription discovery is not supported for frozen study assignments.',
      );
    const conn = await this.#lock(c, ws, setup.connection_id);
    if (conn.settings_hash !== setup.settings_hash)
      throw fail(
        'VERSION_CONFLICT',
        'Connection settings changed; refresh run setup.',
      );
    if (limits.max_concurrency !== 1 || limits.max_attempts !== 1)
      throw fail(
        'SCOPE_EXCEEDED',
        'Subscription workflows require one job at a time and one attempt per logical call.',
      );
    if (
      limits.call_timeout_ms >
        conn.settings.caps.responses.request_timeout_ms ||
      setup.max_output_chars > conn.settings.caps.responses.max_output_chars ||
      limits.max_calls > conn.settings.caps.responses.max_requests_per_run
    )
      throw fail(
        'SCOPE_EXCEEDED',
        'Workflow limits exceed accepted connection caps.',
      );
    const access = await this.#access(c, conn.id);
    const qualifications = await this.#discoveryQualifications(
      c,
      conn.id,
      role,
    );
    const usage = await this.#usage(c, conn.id, runId, null);
    const classes: (
      | typeof EXPLORATION_TASK_CLASS
      | (typeof DISCOVERY_TASK_CLASSES)[keyof typeof DISCOVERY_TASK_CLASSES]
    )[] =
      role === 'r01_exploration'
        ? [EXPLORATION_TASK_CLASS]
        : role === 'r08_assessment'
          ? [ASSESSMENT_TASK_CLASS]
          : [...new Set(Object.values(DISCOVERY_TASK_CLASSES))];
    const refusals = classes.flatMap((task_class) =>
      admissionRefusals({
        connection: conn,
        access,
        qualifications,
        grant: null,
        usage,
        now: new Date(),
        request: {
          connection_id: conn.id,
          logical_operation_id: randomUUID(),
          path: 'responses',
          purpose: 'task',
          model_id: setup.model_id,
          task_class,
          data_class: dataClass,
          run_id: runId,
          build_id: null,
          grant_id: null,
          qualification_id: null,
          input_chars: 0,
        },
      }),
    );
    if (refusals.length) {
      // ADR-0087: each refusal keeps its code, so the page can offer its fix in place.
      const seen = new Set<string>();
      const unique = refusals.filter(
        (x) => !seen.has(x.text) && Boolean(seen.add(x.text)),
      );
      throw new ContractError(
        'ACCESS_DENIED',
        role === 'r01_exploration'
          ? "Exploration can't start on this connection now."
          : role === 'r08_assessment'
            ? "Assessment can't start on this connection now."
            : "Discovery can't start on this connection now.",
        unique.map((x) => x.text),
        unique,
      );
    }
  }

  /**
   * ADR-0100: plan requests this run has used on the connection, its per-run cap, and what the
   * daily cap leaves, so an autopilot sizes each step from what is actually left.
   */
  async planRunRoom(
    ctxIn: CommandContext,
    ws: string,
    connectionId: string,
    runId: string,
  ): Promise<{ per_run: number; used: number; daily_left: number }> {
    return this.tx((c) =>
      this.planRunRoomIn(c, ctxIn, ws, connectionId, runId),
    );
  }
  /**
   * `planRunRoom` on a transaction the caller holds (round 3 nit: the autopilot's start check
   * reads it on the start's own connection instead of opening a second one). Reads only; a
   * refusal is thrown before any statement fails, so the caller's transaction stays usable.
   */
  async planRunRoomIn(
    c: PoolClient,
    ctxIn: CommandContext,
    ws: string,
    connectionId: string,
    runId: string,
  ): Promise<{ per_run: number; used: number; daily_left: number }> {
    const ctx = normalize(ctxIn);
    await this.role(c, uuid(ws), ctx.actorId, false);
    const conn = await this.#connection(c, uuid(ws), uuid(connectionId));
    const usage = await this.#usage(c, conn.id, uuid(runId), null);
    const caps = conn.settings.caps;
    return {
      per_run: caps.responses.max_requests_per_run,
      used: usage.run_requests,
      daily_left: Math.max(0, dailyCap(caps, usage) - usage.last_24h_requests),
    };
  }

  /**
   * Why T12 plan build-role requests for this run would be refused now (ADR-0048, ADR-0054),
   * without writing anything: owner, run state, study assignment, and room on this connection
   * for at least one builder and one reviewer request (F11). The requests themselves are
   * covered by the build's one approval, so no model.generate grant is needed on the run.
   */
  async planBuildRolesRunBlockers(
    ctxIn: CommandContext,
    ws: string,
    runId: string,
    connectionId: string,
  ): Promise<string[]> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      const out: string[] = [];
      const role = await this.role(c, uuid(ws), ctx.actorId, false);
      if (role !== 'owner')
        out.push('Only the workspace owner can run plan roles.');
      const r = (
        await c.query(
          'select * from run_controls where workspace_id = $1 and run_id = $2',
          [uuid(ws), uuid(runId)],
        )
      ).rows[0];
      if (!r) return [...out, 'The run is not registered for oversight.'];
      const run = toRun(r as Row);
      if (
        run.state !== 'active' ||
        run.experiment_condition === 'human_only' ||
        run.autonomy_mode === 'human_only'
      )
        out.push(
          'The run is cancelled or human-only; no model request is admitted.',
        );
      const study = await c.query(
        'select 1 from study_attempts where workspace_id=$1 and run_id=$2',
        [uuid(ws), run.run_id],
      );
      if (study.rows[0])
        out.push('Plan build roles are not used for frozen study assignments.');
      const conn = await this.#connection(c, uuid(ws), uuid(connectionId));
      const usage = await this.#usage(c, conn.id, run.run_id, null);
      const caps = conn.settings.caps;
      const runRoom = caps.responses.max_requests_per_run - usage.run_requests;
      const dayRoom = dailyCap(caps, usage) - usage.last_24h_requests;
      if (runRoom < 2)
        out.push(
          `This run has room for ${Math.max(0, runRoom)} more plan request${runRoom === 1 ? '' : 's'} on this connection; a build needs at least 2 (builder and reviewer). Raise the per-run cap in Settings or use a fresh run.`,
        );
      if (dayRoom < 2)
        out.push(
          `The connection's daily cap leaves room for ${Math.max(0, dayRoom)} more request${dayRoom === 1 ? '' : 's'}; a build needs at least 2.`,
        );
      return out;
    });
  }

  /**
   * ADR-0054: the one approval of one build. Admits product.commit_build for the build's frozen
   * spec once and, when allowed, records the approval with the build's stated limits in the
   * same transaction. Its repair rounds and plan role requests check this record instead of
   * asking again. The studio writes the justification the person sees; the caller cannot.
   */
  async admitBuild(
    ctxIn: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<BuildApprovalResult> {
    const ctx = normalize(ctxIn);
    const req = parse(BuildApprovalRequestSchema, raw);
    ws = uuid(ws);
    runId = uuid(runId);
    if (Date.parse(req.expires_at) <= Date.now())
      throw fail('EXPIRED', 'The build deadline has already passed.');
    if (Date.parse(req.expires_at) > Date.now() + BUILD_APPROVAL_MAX_MS)
      throw fail(
        'INVALID_CONTRACT',
        'A build approval lasts at most 24 hours; set an earlier build deadline.',
      );
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const prior = await c.query(
        'select 1 from build_approvals where id = $1',
        [req.build_id],
      );
      if (prior.rows[0])
        throw fail('DUPLICATE', 'This build already has its approval.');
      // Re-review L-A: a one-time approval belongs to the build that asked for it. Leave out
      // one-time grants for this spec on this run whose ask does not cover this build (or that no build asked
      // for), so they cannot shadow a standing grant or the approval this build did get; and
      // when one was asked for exactly this scope, prefer it over a wider one. Leaving grants
      // out only narrows authority; the scope check below still guards the grant that is used.
      const exclude = new Set<string>();
      const onceGrants = (
        await c.query(
          `select g.id, a.route, a.connection_id, a.model_id, a.request_limit, a.max_repairs,
                  a.decision_id as asked
             from grants g left join build_approval_asks a on a.decision_id = g.decision_id
            where g.workspace_id = $1 and g.run_id = $2 and g.status = 'active'
              and g.scope = 'once' and 'product.commit_build' = any(g.action_types)
              and lower(g.target->>'id') = lower($3) and (g.target->>'version')::int = $4
              and g.spec_hash = $5`,
          [ws, runId, req.spec.id, req.spec.version, req.spec_hash],
        )
      ).rows as Row[];
      const fitting: Row[] = [];
      for (const g of onceGrants) {
        const fits =
          g.asked !== null &&
          g.route === req.route &&
          (g.connection_id ?? null) === req.connection_id &&
          (g.model_id ?? null) === req.model_id &&
          req.request_limit <= Number(g.request_limit) &&
          req.max_repairs <= Number(g.max_repairs);
        if (fits) fitting.push(g);
        else exclude.add(String(g.id));
      }
      const exact = (g: Row) =>
        Number(g.request_limit) === req.request_limit &&
        Number(g.max_repairs) === req.max_repairs;
      if (fitting.some(exact))
        for (const g of fitting) if (!exact(g)) exclude.add(String(g.id));
      const connectionLabel = req.connection_id
        ? ((
            await c.query<{ label: string }>(
              'select label from plan_connections where id = $1 and workspace_id = $2',
              [req.connection_id, ws],
            )
          ).rows[0]?.label ?? null)
        : null;
      const admission = await this.admitIn(
        c,
        ctx,
        ws,
        runId,
        {
          action_type: 'product.commit_build',
          task_id: null,
          target: req.spec,
          spec_hash: req.spec_hash,
          amount_nano_usd: null,
          data_class: req.data_class,
          assumption_ids: [],
          humility_review: req.humility_review,
          flags: [],
          justification:
            'T12 build of the frozen specification: scoped builder patches, a fresh independent review and isolated acceptance execution, under one approval (ADR-0054).',
        },
        undefined,
        buildApprovalScopeNote(req, connectionLabel),
        exclude,
      );
      if (admission.verdict !== 'allow' || !admission.covered_by) {
        // The scope this build asks the person to approve. The decision is shared by builds of
        // the same spec and run; the first ask fixes its scope, as it fixes its wording.
        if (admission.decision_id)
          await c.query(
            `insert into build_approval_asks (decision_id, workspace_id, route, connection_id,
               model_id, request_limit, max_repairs, created_by)
             values ($1,$2,$3,$4,$5,$6,$7,$8) on conflict (decision_id) do nothing`,
            [
              admission.decision_id,
              ws,
              req.route,
              req.connection_id,
              req.model_id,
              req.request_limit,
              req.max_repairs,
              ctx.actorId,
            ],
          );
        return { admission, approval: null };
      }
      const grant = (
        await c.query(
          'select scope, decision_id, expires_at from grants where id = $1',
          [admission.covered_by.grant_id],
        )
      ).rows[0] as Row;
      // Review M-1: a one-time grant from a build's decision admits only a build within the
      // scope that decision showed: same route, connection and model, no more requests or
      // repair rounds. Refusing rolls the whole admission back, so the grant is not used.
      if (grant.scope === 'once') {
        const ask = grant.decision_id
          ? ((
              await c.query(
                'select * from build_approval_asks where decision_id = $1',
                [grant.decision_id],
              )
            ).rows[0] as Row | undefined)
          : undefined;
        if (!ask)
          throw fail(
            'SCOPE_EXCEEDED',
            'This one-time approval was not asked for by a build, so it does not say what a build may do. Revoke it under Grants and start the build again to ask.',
          );
        if (
          ask.route !== req.route ||
          (ask.connection_id ?? null) !== req.connection_id ||
          (ask.model_id ?? null) !== req.model_id ||
          req.request_limit > Number(ask.request_limit) ||
          req.max_repairs > Number(ask.max_repairs)
        )
          throw fail(
            'SCOPE_EXCEEDED',
            `This build differs from the one you approved (${String(ask.route).replaceAll('_', ' ')}, up to ${Number(ask.max_repairs)} repair rounds and ${Number(ask.request_limit)} requests). Start it with those settings, or revoke that approval under Grants and ask again.`,
          );
      }
      // The approval ends at the build deadline or when the grant behind it expires.
      const expires = new Date(
        Math.min(Date.parse(req.expires_at), Date.parse(iso(grant.expires_at))),
      ).toISOString();
      const { rows } = await c
        .query(
          `insert into build_approvals (id, workspace_id, run_id, product_id, task_id, spec_id,
           spec_version, spec_hash, plan_hash, route, connection_id, model_id, data_class,
           request_limit, max_repairs, humility_review_id, humility_review_version,
           admission_id, grant_id, grant_version, decision_id, expires_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         returning *`,
          [
            req.build_id,
            ws,
            runId,
            req.product_id,
            req.task_id,
            req.spec.id,
            req.spec.version,
            req.spec_hash,
            req.plan_hash,
            req.route,
            req.connection_id,
            req.model_id,
            req.data_class,
            req.request_limit,
            req.max_repairs,
            req.humility_review.id,
            req.humility_review.version,
            admission.id,
            admission.covered_by.grant_id,
            admission.covered_by.grant_version,
            grant.decision_id ?? null,
            expires,
            ctx.actorId,
          ],
        )
        .catch((e: unknown) => {
          // Two starts of one build racing: the loser is a duplicate, not a database error.
          if (isPgError(e, '23505', 'build_approvals_pkey'))
            throw fail('DUPLICATE', 'This build already has its approval.');
          throw e;
        });
      const approval: BuildApproval = toBuildApproval(rows[0] as Row);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'build.approved',
        subjectKind: 'build',
        subjectId: approval.id,
        subjectVersion: null,
        contentHash: approval.plan_hash,
        payload: {
          route: approval.route,
          request_limit: approval.request_limit,
          max_repairs: approval.max_repairs,
          admission_id: approval.admission_id,
          grant_id: approval.grant_id,
        },
        relatedIds: [runId, approval.spec.id, approval.admission_id],
      });
      return { admission, approval };
    });
  }

  async admitPlanRequest(
    ctxIn: CommandContext,
    ws: string,
    body: unknown,
    qualificationCase?: { case_id: string; split: 'development' | 'held_out' },
    workflow?: { task_id: string; lease_token: string; input_hash: string },
    /** ADR-0086: a web discovery's search or reading request, covered by its start. */
    webDiscovery?: WebDiscoveryBinding,
  ): Promise<{
    request_id: string;
    connection: PlanConnection;
    replay?: Row;
    admission?: Admission;
  }> {
    const ctx = normalize(ctxIn);
    const req: PlanAdmissionRequest = parse(PlanAdmissionRequestSchema, body);
    if ((req.purpose === 'qualification') !== Boolean(qualificationCase))
      throw fail(
        'INVALID_CONTRACT',
        'Qualification requests name exactly one benchmark case.',
      );
    const out = await this.#admitPlanRequest(
      ctx,
      ws,
      req,
      qualificationCase,
      workflow,
      webDiscovery,
    );
    // ADR-0064: a newly admitted request is live in this process until it is settled.
    if (out.request_id && !out.replay && !out.admission)
      this.#livePlanRequests.add(out.request_id);
    return out;
  }

  async #admitPlanRequest(
    ctx: CommandContext,
    ws: string,
    req: PlanAdmissionRequest,
    qualificationCase:
      { case_id: string; split: 'development' | 'held_out' } | undefined,
    workflow:
      { task_id: string; lease_token: string; input_hash: string } | undefined,
    webDiscovery?: WebDiscoveryBinding,
  ): Promise<{
    request_id: string;
    connection: PlanConnection;
    replay?: Row;
    admission?: Admission;
  }> {
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      let wf: Row | undefined;
      let task: Row | undefined;
      if (workflow) {
        const peek = await c.query(
          'select t.workflow_id, w.run_id from workflow_tasks t join workflows w on w.id = t.workflow_id where t.id=$1 and w.workspace_id=$2',
          [uuid(workflow.task_id), ws],
        );
        // ADR-0098 (re-review 2 M-1): the run is locked before the workflow, as every workflow
        // writer does (lockWorkflowRun); the later lockRun re-locks a row already held.
        if (peek.rows[0])
          await this.lockRun(c, ws, String(peek.rows[0].run_id));
        wf = (
          await c.query(
            'select * from workflows where id=$1 and workspace_id=$2 for update',
            [peek.rows[0]?.workflow_id, ws],
          )
        ).rows[0];
        task = (
          await c.query('select * from workflow_tasks where id=$1 for update', [
            workflow.task_id,
          ])
        ).rows[0];
        if (
          !wf ||
          !task ||
          task.state !== 'leased' ||
          task.lease_token !== workflow.lease_token ||
          new Date(String(task.lease_expires_at)).getTime() <= Date.now()
        )
          throw fail(
            'LEASE_LOST',
            'The workflow task lease is no longer held.',
          );
        const setup = wf.resource_setup as Extract<
          WorkflowResourceSetup,
          { kind: 'subscription' }
        >;
        if (
          setup?.kind !== 'subscription' ||
          setup.connection_id !== req.connection_id ||
          setup.model_id !== req.model_id ||
          req.purpose !== 'task' ||
          req.run_id !== wf.run_id ||
          req.data_class !== wf.data_class ||
          req.logical_operation_id !== task.logical_operation_id ||
          workflowTaskClass(String(task.kind)) !== req.task_class
        )
          throw fail(
            'SCOPE_EXCEEDED',
            'Plan request does not match the pinned workflow task.',
          );
        if (
          wf.control !== 'run' ||
          wf.finished_at ||
          new Date(String(wf.deadline_at)).getTime() <= Date.now()
        )
          throw fail(
            'INVALID_TRANSITION',
            'Workflow is paused, cancelled, terminal or expired.',
          );
      }
      if (wf) await this.lockRun(c, ws, String(wf.run_id));
      // A build-role task outside a workflow (ADR-0048) still needs a live, AI-enabled run.
      const buildRole =
        req.purpose === 'task' &&
        !workflow &&
        (req.task_class === 'patch_build' ||
          req.task_class === 'independent_review');
      if (buildRole) {
        await this.requireOwner(c, uuid(ws), ctx.actorId);
        if (!req.run_id)
          throw fail(
            'INVALID_CONTRACT',
            'A plan build-role request names its run.',
          );
        const run = await this.lockRun(c, ws, req.run_id);
        if (
          run.state !== 'active' ||
          run.experiment_condition === 'human_only' ||
          run.autonomy_mode === 'human_only'
        )
          throw fail(
            'INVALID_TRANSITION',
            'The run is cancelled or human-only; no model request is admitted.',
          );
        // Frozen study arms keep their adopted routes (CODEX_INTEGRATION §4.1).
        const study = await c.query(
          'select 1 from study_attempts where workspace_id=$1 and run_id=$2',
          [ws, req.run_id],
        );
        if (study.rows[0])
          throw fail(
            'SCOPE_EXCEEDED',
            'Plan build roles are not used for frozen study assignments.',
          );
      }
      // ADR-0086: the discovery's start is the one approval for its two requests; the
      // binding is checked under the discovery's lock, before the connection's.
      if (webDiscovery)
        await webDiscoveryRequestGate(
          c,
          uuid(ws),
          ctx.actorId,
          req,
          webDiscovery,
          (runId) => this.lockRun(c, ws, runId),
          () => this.requireOwner(c, uuid(ws), ctx.actorId),
        );
      const conn = await this.#lock(c, ws, req.connection_id);
      if (
        wf &&
        conn.settings_hash !==
          (wf.resource_setup as { settings_hash: string }).settings_hash
      )
        throw fail(
          'VERSION_CONFLICT',
          'Connection settings changed after workflow setup.',
        );
      const dup = await c.query(
        'select * from plan_requests where logical_operation_id = $1',
        [req.logical_operation_id],
      );
      if (workflow && dup.rows[0]) {
        const prior = dup.rows[0];
        if (
          prior.connection_id !== conn.id ||
          prior.workflow_task_id !== workflow.task_id ||
          prior.input_hash !== workflow.input_hash
        )
          throw fail('EVIDENCE_MISMATCH', 'Replayed workflow request changed.');
        return {
          request_id: String(prior.id),
          connection: conn,
          replay: prior,
        };
      }
      if (dup.rowCount)
        throw fail(
          'DUPLICATE',
          'This logical operation was already dispatched.',
        );
      const usage = await this.#usage(c, conn.id, req.run_id, req.build_id);
      const access = await this.#access(c, conn.id);
      const qualifications = wf
        ? await this.#discoveryQualifications(
            c,
            conn.id,
            wf.role as Workflow['role'],
          )
        : webDiscovery
          ? await this.#webDiscoveryQualifications(c, conn.id)
          : await this.#qualifications(c, conn.id, true);
      // ADR-0057: a chat answer is the owner's, under the workspace's chat setting.
      let chat: PlanChatAllowance | null = null;
      if (req.purpose === 'chat') {
        await this.requireOwner(c, uuid(ws), ctx.actorId);
        // Review L-4: read without a row lock. The connection lock above already serializes
        // chat requests, and locking chat_settings here could deadlock with a settings save.
        const settings = await chatSettings(c, uuid(ws));
        chat = {
          enabled: settings.enabled,
          connection_id: settings.connection_id,
          model_id: settings.model_id,
          daily_limit: settings.daily_limit,
          used_24h: await chatUsed24h(c, conn.id),
          study_open: await chatStudyOpen(c, uuid(ws)),
        };
      }
      let grant: PlanVerificationGrant | null = null;
      if (req.grant_id) {
        const g = await c.query(
          'select * from plan_verification_grants where id = $1 for update',
          [req.grant_id],
        );
        grant = g.rows[0] ? toGrant(g.rows[0] as Row) : null;
      }
      const refusals = admissionRefusals({
        connection: conn,
        request: req,
        access,
        qualifications,
        grant,
        usage,
        chat,
        now: new Date(),
      });
      if (refusals.length)
        throw new ContractError(
          'ACCESS_DENIED',
          'This plan request is not admitted.',
          refusals.map((x) => x.text),
          refusals,
        );
      if (workflow && wf && task) {
        const n = await c.query(
          'select count(*)::int as n from plan_requests p join workflow_tasks t on t.id=p.workflow_task_id where t.workflow_id=$1',
          [wf.id],
        );
        if (n.rows[0].n >= (wf.limits as WorkflowLimits).max_calls)
          throw fail('SCOPE_EXCEEDED', 'Workflow request cap is reached.');
        const admission = await this.admitIn(c, ctx, ws, String(wf.run_id), {
          action_type: 'model.generate',
          task_id: String(task.id),
          target: null,
          spec_hash: String(task.context_hash),
          amount_nano_usd: null,
          data_class: req.data_class,
          assumption_ids: [],
          humility_review: null,
          flags: [],
          justification: `Subscription discovery task ${task.kind}; connection ${conn.id}; model ${req.model_id}.`,
        });
        if (admission.verdict !== 'allow')
          return { request_id: '', connection: conn, admission };
      }
      if (buildRole) {
        // ADR-0054: covered by the build's one approval, within its stated request limit.
        const blocked = await buildApprovalBlockers(
          c,
          uuid(ws),
          ctx.actorId,
          {
            build_id: req.build_id!,
            run_id: req.run_id!,
            model_id: req.model_id,
            data_class: req.data_class,
          },
          conn.id,
          Date.now(),
        );
        if (blocked.length)
          throw new ContractError(
            'ACCESS_DENIED',
            'This build-role request is not covered by its build approval.',
            blocked,
          );
      }
      if (grant)
        await c.query(
          'update plan_verification_grants set used = 1 where id = $1',
          [grant.id],
        );
      const rid = randomUUID();
      const auth = (
        await c.query(
          'select auth_generation, credential_ref from plan_connections where id = $1',
          [conn.id],
        )
      ).rows[0];
      await c.query(
        `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose, model_id,
           task_class, data_class, run_id, build_id, grant_id, qualification_id, case_id, case_split,
           state, created_by, auth_generation, credential_ref)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'in_flight',$15,$16,$17)`,
        [
          rid,
          conn.id,
          req.logical_operation_id,
          req.path,
          req.purpose,
          req.model_id,
          req.task_class,
          req.data_class,
          req.run_id,
          req.build_id,
          req.grant_id,
          req.qualification_id,
          qualificationCase?.case_id ?? null,
          qualificationCase?.split ?? null,
          ctx.actorId,
          auth.auth_generation,
          auth.credential_ref,
        ],
      );
      if (workflow)
        await c.query(
          'update plan_requests set workflow_task_id=$2, input_hash=$3 where id=$1',
          [rid, workflow.task_id, workflow.input_hash],
        );
      if (webDiscovery)
        await c.query(
          `update web_discoveries set ${webDiscovery.stage === 'search' ? 'search_request_id' : 'read_request_id'} = $2,
             version = version + 1, updated_at = clock_timestamp() where id = $1`,
          [uuid(webDiscovery.discovery_id), rid],
        );
      return { request_id: rid, connection: conn };
    });
  }

  /** Bind the actual credential after any refresh, just before dispatch. Never cross logins. */
  async bindPlanRequestCredential(
    requestId: string,
    credentialRef: string | null,
  ): Promise<void> {
    return this.tx(async (c) => {
      // Same lock order as settlement: request first, then connection.
      const request = (
        await c.query('select * from plan_requests where id = $1 for update', [
          uuid(requestId),
        ])
      ).rows[0];
      if (!request || request.state !== 'in_flight')
        throw fail('INVALID_TRANSITION', 'The plan request is not in flight.');
      const conn = (
        await c.query(
          'select auth_generation, credential_ref, sign_in from plan_connections where id = $1 for update',
          [request.connection_id],
        )
      ).rows[0];
      if (
        request.auth_generation == null ||
        String(request.auth_generation) !== String(conn.auth_generation) ||
        conn.sign_in.state !== 'signed_in' ||
        credentialRef !== conn.credential_ref
      )
        throw fail(
          'UNAUTHENTICATED',
          'The login changed before dispatch. This request was not sent.',
        );
      await c.query(
        'update plan_requests set credential_ref = $2 where id = $1',
        [request.id, credentialRef],
      );
    });
  }

  /** Records how an admitted request ended, plus what it showed about the account. */
  async settlePlanRequest(
    requestId: string,
    raw: PlanSettlement,
    observed: PlanObservation = {},
  ): Promise<PlanRequest> {
    const s = parse(PlanSettlementSchema, raw);
    try {
      return await this.#settlePlanRequest(requestId, s, observed);
    } finally {
      this.#livePlanRequests.delete(String(uuid(requestId)));
    }
  }

  async #settlePlanRequest(
    requestId: string,
    s: PlanSettlement,
    observed: PlanObservation,
  ): Promise<PlanRequest> {
    return this.tx(async (c) => {
      const { rows } = await c.query(
        'select * from plan_requests where id = $1 for update',
        [uuid(requestId)],
      );
      const r = rows[0] as Row | undefined;
      if (!r) throw fail('NOT_FOUND', 'Plan request not found.');
      if (r.state !== 'in_flight')
        throw fail('INVALID_TRANSITION', 'The request already settled.');
      const conn = await c.query(
        'select * from plan_connections where id = $1 for update',
        [r.connection_id],
      );
      const now = new Date().toISOString();
      await c.query(
        `update plan_requests set state = $2, reason_code = $3, upstream_request_id = $4,
           output_tokens = $5, output_chars = $6, output_hash = $7, signal = $8, output_text = $9, finished_at = clock_timestamp()
         where id = $1`,
        [
          r.id,
          s.state,
          s.state === 'completed'
            ? observed.grader_error
              ? `grader_error: ${observed.grader_error}`.slice(0, 200)
              : (observed.grader_detail?.slice(0, 200) ?? null)
            : s.reason_code,
          s.upstream_request_id,
          s.state === 'completed' ? s.output_tokens : null,
          s.output_chars,
          s.state === 'completed' ? s.output_hash : null,
          observed.signal ?? null,
          // Workflow answers feed their task; qualification answers (synthetic or public data
          // only) are kept so a failed case can be explained (ADR-0049).
          (r.workflow_task_id ||
            (r.qualification_id &&
              ['synthetic', 'public'].includes(String(r.data_class)))) &&
          s.state === 'completed'
            ? (observed.workflow_output_text ?? null)
            : null,
        ],
      );
      const updates: string[] = [];
      const values: unknown[] = [r.connection_id];
      const set = (col: string, value: unknown) => {
        values.push(value);
        updates.push(`${col} = $${values.length}`);
      };
      // Account observations (eligibility, quota, model access) describe the login that sent the
      // request. One that ended after Disconnect or a replacement login is recorded on the request
      // but never rewrites the newer login. A same-login refresh keeps the generation, so it counts.
      const sameLogin =
        r.auth_generation != null &&
        String(r.auth_generation) === String(conn.rows[0].auth_generation);
      const eligibility = !sameLogin
        ? undefined
        : (observed.eligibility ??
          (s.state === 'completed' ? 'eligible' : undefined));
      if (eligibility)
        set('eligibility', {
          state: eligibility,
          reason_code: observed.reason_code ?? null,
          upstream_request_id:
            observed.upstream_request_id ?? s.upstream_request_id,
          observed_at: now,
        });
      const quota = !sameLogin
        ? undefined
        : (observed.quota ??
          (s.state === 'completed' ? 'available' : undefined));
      if (quota)
        set('quota', {
          state: quota,
          reason_code: observed.reason_code ?? null,
          observed_at: now,
        });
      const currentCredential =
        sameLogin &&
        r.credential_ref === conn.rows[0].credential_ref &&
        (conn.rows[0].sign_in as { state: string }).state === 'signed_in';
      if (observed.sign_in_invalid && currentCredential) {
        set('sign_in', {
          ...(conn.rows[0].sign_in as object),
          state: 'reauthorization_required',
        });
        updates.push('version = version + 1');
      }
      if (updates.length)
        await c.query(
          `update plan_connections set ${updates.join(', ')}, updated_at = clock_timestamp() where id = $1`,
          values,
        );
      if (r.purpose === 'verification') {
        const verified = s.state === 'completed';
        if (sameLogin && (verified || observed.model_refused))
          await c.query(
            `insert into plan_model_access (connection_id, model_id, path, access, reason_code, request_id)
             values ($1,$2,$3,$4,$5,$6)
             on conflict (connection_id, model_id, path) do update set access = excluded.access,
               reason_code = excluded.reason_code, request_id = excluded.request_id, verified_at = clock_timestamp()`,
            [
              r.connection_id,
              r.model_id,
              r.path,
              verified ? 'verified' : 'refused',
              verified ? null : (observed.reason_code ?? null),
              r.id,
            ],
          );
        await this.#event(
          c,
          String(r.connection_id),
          verified ? 'model_verified' : 'model_verification_failed',
          {
            model_id: r.model_id,
            path: r.path,
            request_id: r.id,
            state: s.state,
          },
          { actorId: String(r.created_by) },
        );
      }
      if (r.purpose === 'availability_recheck')
        await this.#event(
          c,
          String(r.connection_id),
          'availability_checked',
          {
            model_id: r.model_id,
            path: r.path,
            request_id: r.id,
            state: s.state,
            reason_code: s.state === 'completed' ? null : s.reason_code,
          },
          { actorId: String(r.created_by) },
        );
      const after = await c.query('select * from plan_requests where id = $1', [
        r.id,
      ]);
      return toRequest(after.rows[0] as Row);
    });
  }

  // ---- Qualification -------------------------------------------------------------------

  async startPlanQualification(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ) {
    const ctx = normalize(ctxIn);
    // ADR-0089: a benchmark named by the app is loaded here from the frozen files, only if
    // it is the one offered (newest and current for the discovery role); every check below
    // still applies to it.
    const named =
      body && typeof body === 'object' && 'benchmark' in body
        ? parse(StartOfferedQualificationRequestSchema, body)
        : null;
    const req = named
      ? (() => {
          const b = offeredDiscoveryBenchmark(named.benchmark);
          return parse(StartPlanQualificationRequestSchema, {
            expected_version: named.expected_version,
            model_id: named.model_id,
            manifest: b.manifest,
            min_held_out_cases: b.held_out,
            floor: { numerator: 1, denominator: 1 },
          });
        })()
      : parse(StartPlanQualificationRequestSchema, body);
    let q: PlanQualification | null = null;
    await this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'qualification_started',
      async (c, conn) => {
        // PR #177 review 8 N-1: a start by hand while a queue runs would leave a started run
        // the queue later meets and stops on (a different benchmark of the same task).
        if (await runningQueueId(c, conn.id))
          throw fail(
            'INVALID_TRANSITION',
            'A queue is qualifying tasks on this connection one after another. Wait for it to finish, or cancel it under Models and connections › Qualify several tasks, then start this one.',
          );
        await this.#checkQualificationStart(c, conn, req);
        q = await this.#insertQualification(c, conn, req, ctx.actorId);
        return {
          qualification_id: q.id,
          manifest_hash: q.manifest_hash,
        };
      },
    );
    return q!;
  }

  /**
   * Everything a qualification start checks before it records anything: the task and data
   * class are allowed here, a build role uses its exact prompt, fixture matches fixture, the
   * model is verified, held-out cases were not viewed under another prompt (ADR-0052) and there
   * are enough of them. ADR-0088: a queued qualification runs the same checks when its turn
   * comes, against the connection as it is then.
   */
  async #checkQualificationStart(
    c: PoolClient,
    conn: PlanConnection,
    req: Pick<
      z.infer<typeof StartPlanQualificationRequestSchema>,
      'model_id' | 'manifest' | 'min_held_out_cases'
    >,
  ) {
    const tc = req.manifest.task_class;
    if (
      !conn.settings.allowed_task_classes.includes(tc as never) ||
      tc === 'code_build'
    )
      throw fail(
        'SCOPE_EXCEEDED',
        `Task class ${tc} is not allowed for Responses qualification here.`,
      );
    // A build-role class is qualified for the exact T12 prompt it will serve (ADR-0048).
    const role = (
      Object.entries(BUILD_ROLE_TASK_CLASSES) as [BuildRole, string][]
    ).find(([, cls]) => cls === tc)?.[0];
    if (
      role &&
      req.manifest.cases.some(
        (k) =>
          k.input.filter((m) => m.role === 'system').length !== 1 ||
          k.input.find((m) => m.role === 'system')!.text !==
            BUILD_ROLE_PROMPTS[role],
      )
    )
      throw fail(
        'INVALID_CONTRACT',
        `Every ${tc} case must use exactly the T12 ${role} prompt.`,
      );
    if (!conn.settings.allowed_data_classes.includes(req.manifest.data_class))
      throw fail(
        'SCOPE_EXCEEDED',
        'The benchmark data class is not allowed on this connection.',
      );
    if (req.manifest.fixture !== conn.fixture)
      throw fail(
        'INVALID_CONTRACT',
        'Fixture benchmarks qualify only fixture connections, and real ones only real ones.',
      );
    const verified = (await this.#access(c, conn.id)).some(
      (a) =>
        a.model_id === req.model_id &&
        a.path === 'responses' &&
        a.access === 'verified',
    );
    if (!verified)
      throw fail(
        'INVALID_TRANSITION',
        'Verify model access before qualifying it.',
      );
    const heldOut = req.manifest.cases.filter(
      (x) => x.split === 'held_out',
    ).length;
    // ADR-0052: held-out cases whose results someone has viewed no longer test a prompt
    // revised after that view. Retrying the same prompt on them stays allowed.
    const views = await c.query(
      `select e.body, e.created_at, q.manifest from plan_connection_events e
         join plan_connections p on p.id = e.connection_id
         left join plan_qualifications q on q.id::text = e.body->>'qualification_id'
        where p.workspace_id = $1 and e.kind = $2 and e.body->>'task_class' = $3
        order by e.created_at`,
      [conn.workspace_id, HELD_OUT_VIEWED, tc],
    );
    for (const v of views.rows as Row[]) {
      // PR #173 review 4 L-A: a view's keys are recomputed from the benchmark it showed, so
      // views recorded under an older key format are checked like new ones.
      const shown = (v.manifest as { cases?: ManifestCase[] } | null)?.cases;
      const seen = heldOutSeen(
        shown
          ? {
              prompt_hash: promptHash(shown),
              held_out: heldOutKeys(shown),
              held_out_prompts: heldOutPrompts(shown),
            }
          : (v.body as Parameters<typeof heldOutSeen>[0]),
        req.manifest.cases,
      );
      if (seen)
        throw fail(
          'INVALID_CONTRACT',
          `${seen} held-out case${seen === 1 ? ' was' : 's were'} viewed on ${iso(v.created_at).slice(0, 10)} under a different ${tc} prompt, so ${seen === 1 ? 'it no longer tests' : 'they no longer test'} this one fairly (ADR-0052). Freeze a benchmark with fresh held-out cases.`,
        );
    }
    if (heldOut < req.min_held_out_cases)
      throw fail(
        'INVALID_CONTRACT',
        'The manifest has fewer held-out cases than the minimum.',
      );
  }

  async #insertQualification(
    c: PoolClient,
    conn: PlanConnection,
    req: Pick<
      z.infer<typeof StartPlanQualificationRequestSchema>,
      'model_id' | 'manifest' | 'min_held_out_cases' | 'floor'
    >,
    actorId: string,
  ): Promise<PlanQualification> {
    const tc = req.manifest.task_class;
    const qid = randomUUID();
    try {
      const { rows } = await c.query(
        `insert into plan_qualifications (id, connection_id, model_id, task_class, manifest, manifest_hash,
         min_held_out_cases, floor, state, development, held_out, created_by)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'running','{"passed":0,"total":0}','{"passed":0,"total":0}',$9) returning *`,
        [
          qid,
          conn.id,
          req.model_id,
          tc,
          req.manifest,
          canonicalHash(req.manifest),
          req.min_held_out_cases,
          req.floor,
          actorId,
        ],
      );
      return toQualification(rows[0] as Row);
    } catch (e) {
      if ((e as { code?: string }).code === '23505')
        throw fail(
          'DUPLICATE',
          'A qualification for this model and task class is already running.',
        );
      throw e;
    }
  }

  async planQualificationManifest(
    ctxIn: CommandContext,
    ws: string,
    qid: string,
  ) {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      // Run sends paid requests on the owner's connection and records the outcome; like
      // starting a qualification it is the owner's alone (ADR-0087, P27 review L-3).
      await this.requireOwner(
        c,
        uuid(ws),
        ctx.actorId,
        'Only the workspace owner, signed in as a person, can run a qualification.',
      );
      const { rows } = await c.query(
        `select q.*, p.workspace_id from plan_qualifications q join plan_connections p on p.id = q.connection_id
         where q.id = $1 and p.workspace_id = $2`,
        [uuid(qid), ws],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Qualification not found.');
      const done = await c.query(
        'select case_id, state from plan_requests where qualification_id = $1',
        [qid],
      );
      return {
        qualification: toQualification(rows[0] as Row),
        manifest: rows[0].manifest as z.infer<
          typeof StartPlanQualificationRequestSchema
        >['manifest'],
        attempted_cases: done.rows.map((x) => String(x.case_id)),
        // In flight or with no known outcome: finishing refuses both, so Run must too
        // (review of PR #172, L-2).
        unresolved_cases: done.rows.filter(
          (x) => x.state === 'in_flight' || x.state === 'unknown',
        ).length,
        // ADR-0088: the queue working on this connection, if any; only it may run here.
        queue_id: await runningQueueId(c, String(rows[0].connection_id)),
      };
    });
  }

  /**
   * ADR-0084 (P23): claims the Run of one qualification for this process, or refuses. Call it
   * with what `planQualificationManifest` just read, and call the returned release when the
   * loop ends. Refuses a qualification that is already being run here, one with a case still
   * in flight or of unknown outcome (a run in another studio process, an answer cut off, or one
   * cut off by a restart), and one that has already finished.
   */
  claimQualificationRun(
    read: {
      qualification: PlanQualification;
      unresolved_cases: number;
      queue_id?: string | null;
    },
    queueId: string | null = null,
  ): () => void {
    const key = String(uuid(read.qualification.id));
    // ADR-0088: while a queue qualifies tasks on this connection one by one, a Run pressed by
    // hand would compete with it for the one request at a time the connection allows.
    if (read.queue_id && read.queue_id !== queueId)
      throw fail(
        'INVALID_TRANSITION',
        'A queue is qualifying tasks on this connection one after another. Wait for it to finish, or cancel it under Models and connections › Qualify several tasks, then press Run.',
      );
    if (this.#runningQualifications.has(key))
      throw fail(
        'INVALID_TRANSITION',
        'This qualification is already running. Its cases are being sent one by one; this page shows when it finishes.',
      );
    if (read.qualification.state !== 'running')
      throw fail('INVALID_TRANSITION', 'The qualification already finished.');
    if (read.unresolved_cases > 0)
      throw fail(
        'INVALID_TRANSITION',
        'A case of this qualification is still in flight or has no known outcome (sent from another window, cut off, or from before the studio restarted). Close it under Running now once it can be closed, then press Run again.',
      );
    this.#runningQualifications.add(key);
    return () => {
      this.#runningQualifications.delete(key);
    };
  }

  // ---- Qualification queue (ADR-0088, P24) ---------------------------------------------

  /**
   * Queues several qualifications of one model on one connection, to be run one after another
   * by the studio. Owner only, against the version the person saw. Every task must be allowed
   * and not yet qualified (a failed re-run would replace a pass, ADR-0052); one already started
   * with the same benchmark is taken over as it is. Each item is still checked and admitted on
   * its own when its turn comes; nothing is started or sent here.
   */
  async startQualificationQueue(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ): Promise<QualificationQueue> {
    const ctx = normalize(ctxIn);
    const parsed = parse(StartQualificationQueueRequestSchema, body);
    // ADR-0089: a discovery benchmark offered by name is loaded here, as Start does; a name
    // that is not offered (or no longer current) is refused.
    const req = {
      ...parsed,
      items: parsed.items.map((i) => {
        if (!('benchmark' in i)) return i;
        const b = offeredDiscoveryBenchmark(i.benchmark);
        // Review 5 of PR #176, N-4: through the Start request's bounds, as Start does.
        const { manifest, min_held_out_cases, floor } = parse(
          StartPlanQualificationRequestSchema,
          {
            expected_version: parsed.expected_version,
            model_id: parsed.model_id,
            manifest: b.manifest,
            min_held_out_cases: b.held_out,
            floor: { numerator: 1, denominator: 1 },
          },
        );
        return { manifest, min_held_out_cases, floor };
      }),
    };
    const tasks = req.items.map((i) => i.manifest.task_class);
    // ADR-0086 and ADR-0089: one task class can serve two roles (scoring: the assessor and the
    // discovery skeptic; research synthesis: the locator and web discovery), qualified apart,
    // so a task's role is part of what may appear once.
    const lanes = req.items.map(
      (i) => `${i.manifest.task_class}:${manifestRole(i.manifest)}`,
    );
    if (new Set(lanes).size !== lanes.length)
      throw fail(
        'INVALID_CONTRACT',
        'Each task can be in a queue once; choose one benchmark per task.',
      );
    const queueId = randomUUID();
    await this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'qualification_queue_started',
      async (c, conn) => {
        if (await runningQueueId(c, conn.id))
          throw fail(
            'DUPLICATE',
            'A queue is already qualifying tasks on this connection. Wait for it to finish, or cancel it first.',
          );
        const quals = await this.#qualifications(c, conn.id);
        // Review of PR #176, L-4: a Run already executing here (by hand, or the task a
        // cancelled queue lets finish) holds the connection's one request at a time.
        if (quals.some((q) => q.executing))
          throw fail(
            'INVALID_TRANSITION',
            'A qualification is running on this connection now, and it sends one request at a time. Wait for it to finish, then queue the tasks.',
          );
        const links: (string | null)[] = [];
        for (const item of req.items) {
          const tc = item.manifest.task_class;
          const role = manifestRole(item.manifest);
          const own = quals.filter((q) => qualificationRole(q) === role);
          if (latestDecided(own, req.model_id, tc)?.state === 'qualified')
            throw fail(
              'INVALID_TRANSITION',
              `${req.model_id} is already qualified for ${words(tc)}${role ? ` (${words(role)})` : ''}. A queue only takes tasks not yet qualified; start a re-run of it on its own.`,
            );
          const started = quals.find(
            (q) =>
              q.state === 'running' &&
              q.model_id === req.model_id &&
              q.task_class === tc,
          );
          if (started && started.manifest_hash !== canonicalHash(item.manifest))
            throw fail(
              'INVALID_TRANSITION',
              `A different ${words(tc)} benchmark is already started for ${req.model_id}. Run or finish it first.`,
            );
          if (!started)
            await this.#checkQualificationStart(c, conn, {
              model_id: req.model_id,
              ...item,
            });
          links.push(started?.id ?? null);
        }
        await c.query(
          `insert into plan_qualification_queues (id, connection_id, model_id, state, created_by)
           values ($1,$2,$3,'running',$4)`,
          [queueId, conn.id, req.model_id, ctx.actorId],
        );
        await releaseEndedLinks(
          c,
          links.filter((x): x is string => !!x),
        );
        for (const [position, item] of req.items.entries())
          await c.query(
            `insert into plan_qualification_queue_items (queue_id, position, task_class, manifest,
               manifest_hash, min_held_out_cases, floor, qualification_id, state)
             values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [
              queueId,
              position,
              item.manifest.task_class,
              item.manifest,
              canonicalHash(item.manifest),
              item.min_held_out_cases,
              item.floor,
              links[position],
              links[position] ? 'running' : 'waiting',
            ],
          );
        return {
          queue_id: queueId,
          model_id: req.model_id,
          task_classes: tasks,
        };
      },
    );
    return this.#withQueue(ws, queueId);
  }

  /** One queue, for any workspace member. */
  async planQualificationQueue(
    ctxIn: CommandContext,
    ws: string,
    queueId: string,
  ): Promise<QualificationQueue> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return this.#queue(c, uuid(ws), uuid(queueId));
    });
  }

  /**
   * Owner only. Items not yet started are cancelled; a qualification already running finishes
   * on its own and is recorded as usual (a cancel never cuts a case off mid-answer).
   */
  async cancelQualificationQueue(
    ctxIn: CommandContext,
    ws: string,
    queueId: string,
  ): Promise<QualificationQueue> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const q = await this.#lockQueue(c, uuid(ws), uuid(queueId));
      if (q.state !== 'running')
        throw fail('INVALID_TRANSITION', 'The queue already finished.');
      const running = await c.query(
        `select 1 from plan_qualification_queue_items where queue_id = $1 and state = 'running'`,
        [q.id],
      );
      await this.#endQueue(
        c,
        q,
        'cancelled',
        running.rowCount
          ? 'Cancelled. The qualification that was already running finishes on its own; the rest were not started.'
          : 'Cancelled before the next qualification started.',
        ctx,
      );
      return this.#queue(c, uuid(ws), q.id);
    });
  }

  /**
   * For the studio's queue runner: takes the lease of one running queue that no live process
   * holds (none yet, released, or expired after a crash). Returns null when there is none.
   */
  async leaseQualificationQueue(
    holder: string,
    leaseMs: number,
    /** Queues this runner is already working on (review of PR #176, L-1). */
    exclude: readonly string[] = [],
  ): Promise<{ id: string; workspace_id: string; created_by: string } | null> {
    const { rows } = await this.pool.query(
      `update plan_qualification_queues q
          set lease_holder = $1, lease_until = clock_timestamp() + make_interval(secs => $2::double precision / 1000)
        where q.id = (select id from plan_qualification_queues
                       where state = 'running' and (lease_until is null or lease_until < clock_timestamp())
                         and not (id = any($3::uuid[]))
                       order by created_at limit 1 for update skip locked)
        returning q.id, q.created_by,
          (select workspace_id from plan_connections p where p.id = q.connection_id) as workspace_id`,
      [uuid(holder), leaseMs, exclude.map((x) => uuid(x))],
    );
    const r = rows[0] as Row | undefined;
    return r
      ? {
          id: String(r.id),
          workspace_id: String(r.workspace_id),
          created_by: String(r.created_by),
        }
      : null;
  }

  /** Keeps a held lease alive; false when another process took it over. */
  async renewQualificationQueueLease(
    queueId: string,
    holder: string,
    leaseMs: number,
  ): Promise<boolean> {
    const r = await this.pool.query(
      `update plan_qualification_queues
          set lease_until = clock_timestamp() + make_interval(secs => $3::double precision / 1000)
        where id = $1 and lease_holder = $2`,
      [uuid(queueId), uuid(holder), leaseMs],
    );
    return (r.rowCount ?? 0) > 0;
  }

  async releaseQualificationQueueLease(queueId: string, holder: string) {
    await this.pool.query(
      `update plan_qualification_queues set lease_holder = null, lease_until = null
        where id = $1 and lease_holder = $2`,
      [uuid(queueId), uuid(holder)],
    );
  }

  /**
   * The queue's next qualification to run, started now if it was waiting. Its start is checked
   * against the connection as it is now (owner, allowed task and data class, verified model,
   * fixture, held-out views), exactly as a start by hand, and recorded in the same transaction
   * that links it to the queue, so a crash cannot start it twice. A refused start stops the
   * queue there and says why. A qualification decided while no process held the queue (a crash
   * after its last case, or a Finish by hand) is recorded first. `end` means nothing is left to
   * run: the queue finished, stopped, was cancelled, or this holder lost the lease.
   */
  async nextQueuedQualification(
    queueId: string,
    holder: string,
  ): Promise<
    | { kind: 'run'; qualification_id: string; position: number }
    | { kind: 'end' }
  > {
    return this.tx(async (c) => {
      const q = await this.#lockQueue(c, null, uuid(queueId));
      const ctx = normalize({ actorId: q.created_by });
      for (;;) {
        if (q.state !== 'running' || q.lease_holder !== uuid(holder))
          return { kind: 'end' };
        const { rows } = await c.query(
          `select * from plan_qualification_queue_items
            where queue_id = $1 and state in ('waiting','running') order by position limit 1`,
          [q.id],
        );
        const item = rows[0] as Row | undefined;
        if (!item) {
          await this.#endQueue(c, q, 'done', null, ctx);
          return { kind: 'end' };
        }
        const position = Number(item.position);
        if (item.state === 'running') {
          const qual = await this.#qualificationRow(
            c,
            String(item.qualification_id),
          );
          if (qual.state === 'running')
            return {
              kind: 'run',
              qualification_id: qual.id,
              position,
            };
          await this.#queueItemDecided(c, q, position, qual, ctx);
          continue;
        }
        await c.query('savepoint queue_start');
        try {
          await this.requireOwner(c, q.workspace_id, q.created_by);
          const conn = await this.#lock(c, q.workspace_id, q.connection_id);
          const tc = String(item.task_class);
          const quals = await this.#qualifications(c, conn.id);
          const started = quals.find(
            (x) =>
              x.state === 'running' &&
              x.model_id === q.model_id &&
              x.task_class === tc,
          );
          let qid: string;
          if (started) {
            // Started by hand while it waited: run that one if it is the same benchmark.
            if (started.manifest_hash !== String(item.manifest_hash))
              throw fail(
                'INVALID_TRANSITION',
                `A different ${words(tc)} benchmark was started for ${q.model_id} by hand. Run or finish it, then queue the rest again.`,
              );
            qid = started.id;
            await releaseEndedLinks(c, [qid]);
          } else {
            const req = {
              model_id: q.model_id,
              manifest: item.manifest as z.infer<
                typeof StartPlanQualificationRequestSchema
              >['manifest'],
              min_held_out_cases: Number(item.min_held_out_cases),
              floor: item.floor as PlanQualification['floor'],
            };
            await this.#checkQualificationStart(c, conn, req);
            const made = await this.#insertQualification(
              c,
              conn,
              req,
              q.created_by,
            );
            qid = made.id;
            const payload = {
              qualification_id: qid,
              manifest_hash: made.manifest_hash,
              queue_id: q.id,
            };
            await this.#event(
              c,
              conn.id,
              'qualification_started',
              payload,
              ctx,
            );
            await this.append(c, ctx, {
              workspaceId: q.workspace_id,
              action: 'connection.qualification_started',
              subjectKind: 'plan_qualification',
              subjectId: qid,
              subjectVersion: null,
              contentHash: made.manifest_hash,
              payload,
            });
          }
          await c.query(
            `update plan_qualification_queue_items set qualification_id = $3, state = 'running'
              where queue_id = $1 and position = $2`,
            [q.id, position, qid],
          );
          await c.query('release savepoint queue_start');
          return { kind: 'run', qualification_id: qid, position };
        } catch (e) {
          if (!(e instanceof ContractError)) throw e;
          await c.query('rollback to savepoint queue_start');
          const reason = clip(
            `${words(String(item.task_class))} was not started: ${[e.message, ...e.details].join(' ')}`,
          );
          await c.query(
            `update plan_qualification_queue_items set state = 'stopped', reason = $3
              where queue_id = $1 and position = $2`,
            [q.id, position, reason],
          );
          await this.#endQueue(c, q, 'stopped', `Stopped at ${reason}`, ctx);
          return { kind: 'end' };
        }
      }
    });
  }

  /**
   * After the runner's Run of the queue's current qualification returned or threw. A decided
   * qualification is recorded (a failure stops the queue); one still running was stopped by a
   * refusal or error, which stops the queue with `reason`. Returns whether to go on.
   */
  async recordQueuedRun(
    queueId: string,
    holder: string,
    position: number,
    reason: string,
  ): Promise<boolean> {
    return this.tx(async (c) => {
      const q = await this.#lockQueue(c, null, uuid(queueId));
      const ctx = normalize({ actorId: q.created_by });
      const { rows } = await c.query(
        `select * from plan_qualification_queue_items where queue_id = $1 and position = $2`,
        [q.id, position],
      );
      const item = rows[0] as Row | undefined;
      if (item?.state === 'running') {
        const qual = await this.#qualificationRow(
          c,
          String(item.qualification_id),
        );
        if (qual.state !== 'running')
          await this.#queueItemDecided(c, q, position, qual, ctx);
        else {
          const why = clip(`${words(String(item.task_class))}: ${reason}`);
          await c.query(
            `update plan_qualification_queue_items set state = 'stopped', reason = $3
              where queue_id = $1 and position = $2`,
            [q.id, position, why],
          );
          if (q.state === 'running')
            await this.#endQueue(
              c,
              q,
              'stopped',
              clip(
                `Stopped at ${why.replace(/[.\s]+$/, '')}. Its answered cases are kept: fix the cause, then press Run on it, or queue the rest again.`,
              ),
              ctx,
            );
        }
      }
      return q.state === 'running' && q.lease_holder === uuid(holder);
    });
  }

  /**
   * Review of PR #176, L-2: the runner could not go on (the same unexpected error several times
   * in a row). Stops the queue with a plain reason instead of leaving it "running" and retried
   * forever; answered cases stay, and the tasks can be queued again.
   */
  async abandonQualificationQueue(
    queueId: string,
    holder: string,
    reason: string,
  ): Promise<void> {
    await this.tx(async (c) => {
      const q = await this.#lockQueue(c, null, uuid(queueId));
      // The runner has released its lease by now; another process holding it is left alone.
      if (
        q.state !== 'running' ||
        (q.lease_holder !== null && q.lease_holder !== uuid(holder))
      )
        return;
      const ctx = normalize({ actorId: q.created_by });
      await c.query(
        `update plan_qualification_queue_items set state = 'stopped', reason = $2
          where queue_id = $1 and state = 'running'`,
        [q.id, clip(`The studio could not continue: ${reason}`)],
      );
      await this.#endQueue(
        c,
        q,
        'stopped',
        clip(
          `Stopped: the studio could not continue this queue (${reason.replace(/[.\s]+$/, '')}). Answered cases are kept; queue the tasks again to continue.`,
        ),
        ctx,
      );
    });
  }

  async #qualificationRow(c: PoolClient, id: string) {
    const { rows } = await c.query(
      'select * from plan_qualifications where id = $1',
      [id],
    );
    return toQualification(rows[0] as Row);
  }

  /** Records a decided qualification on its item; a failure stops the queue there. */
  async #queueItemDecided(
    c: PoolClient,
    q: QueueRow,
    position: number,
    qual: PlanQualification,
    ctx: CommandContext,
  ) {
    const passed = qual.state === 'qualified';
    const score = `${qual.held_out.passed} of ${qual.held_out.total} held-out cases passed`;
    await c.query(
      `update plan_qualification_queue_items set state = $3, reason = $4
        where queue_id = $1 and position = $2`,
      [q.id, position, passed ? 'qualified' : 'failed', clip(score)],
    );
    if (!passed && q.state === 'running')
      await this.#endQueue(
        c,
        q,
        'stopped',
        clip(
          `Stopped: ${words(qual.task_class)} did not qualify (${score}). The tasks after it were not started.`,
        ),
        ctx,
      );
  }

  /** Ends a running queue; items that never started are marked cancelled. */
  async #endQueue(
    c: PoolClient,
    q: QueueRow,
    state: 'done' | 'stopped' | 'cancelled',
    reason: string | null,
    ctx: CommandContext,
  ) {
    await c.query(
      `update plan_qualification_queue_items set state = 'cancelled', reason = $2
        where queue_id = $1 and state = 'waiting'`,
      [
        q.id,
        state === 'cancelled'
          ? 'Cancelled before it started.'
          : 'Not started: the queue stopped before it.',
      ],
    );
    await c.query(
      `update plan_qualification_queues set state = $2, reason = $3, finished_at = clock_timestamp()
        where id = $1`,
      [q.id, state, reason],
    );
    q.state = state;
    const payload = { queue_id: q.id, model_id: q.model_id, state, reason };
    await this.#event(
      c,
      q.connection_id,
      `qualification_queue_${state}`,
      payload,
      ctx,
    );
    await this.append(c, ctx, {
      workspaceId: q.workspace_id,
      action: `connection.qualification_queue_${state}`,
      subjectKind: 'plan_qualification_queue',
      subjectId: q.id,
      subjectVersion: null,
      contentHash: null,
      payload,
    });
  }

  async #lockQueue(
    c: PoolClient,
    ws: string | null,
    id: string,
  ): Promise<QueueRow> {
    const { rows } = await c.query(
      `select q.*, p.workspace_id from plan_qualification_queues q
         join plan_connections p on p.id = q.connection_id
        where q.id = $1 and ($2::uuid is null or p.workspace_id = $2) for update of q`,
      [id, ws],
    );
    const r = rows[0] as Row | undefined;
    if (!r) throw fail('NOT_FOUND', 'Qualification queue not found.');
    return {
      id: String(r.id),
      workspace_id: String(r.workspace_id),
      connection_id: String(r.connection_id),
      model_id: String(r.model_id),
      state: String(r.state),
      lease_holder: nullable(r.lease_holder),
      created_by: String(r.created_by),
    };
  }

  async #withQueue(ws: string, id: string) {
    return this.tx((c) => this.#queue(c, uuid(ws), id));
  }

  async #queue(
    c: PoolClient,
    ws: string,
    id: string,
  ): Promise<QualificationQueue> {
    const { rows } = await c.query(
      `select q.*, q.lease_until > clock_timestamp() as leased from plan_qualification_queues q
         join plan_connections p on p.id = q.connection_id
        where q.id = $1 and p.workspace_id = $2`,
      [id, ws],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Qualification queue not found.');
    return toQueue(c, rows[0] as Row);
  }

  async #newestQueue(
    c: PoolClient,
    connectionId: string,
  ): Promise<QualificationQueue | null> {
    const { rows } = await c.query(
      `select q.*, q.lease_until > clock_timestamp() as leased from plan_qualification_queues q
        where q.connection_id = $1 order by q.created_at desc limit 1`,
      [connectionId],
    );
    return rows[0] ? toQueue(c, rows[0] as Row) : null;
  }

  /**
   * Tallies recorded signals and decides; cases that never ran count as not accepted. While a
   * Run loop holds the qualification, only that loop may finish it (`fromRun`); a Finish from
   * another window is refused (review of PR #172, N-1).
   */
  async finishPlanQualification(
    ctxIn: CommandContext,
    ws: string,
    qid: string,
    fromRun = false,
  ) {
    const ctx = normalize(ctxIn);
    if (!fromRun && this.#runningQualifications.has(String(uuid(qid))))
      throw fail(
        'INVALID_TRANSITION',
        'This qualification is running. Wait for the Run to finish; it records the result itself once every case has an answer.',
      );
    return this.tx(async (c) => {
      // Finishing records every unanswered case as failed, and a failure withdraws an earlier
      // pass (ADR-0052): the owner's alone, as Run is (P27 re-review L-2). The Run loop's own
      // finish already passed that check.
      if (fromRun) await this.role(c, uuid(ws), ctx.actorId, true);
      else
        await this.requireOwner(
          c,
          uuid(ws),
          ctx.actorId,
          'Only the workspace owner, signed in as a person, can finish a qualification.',
        );
      const { rows } = await c.query(
        `select q.* from plan_qualifications q join plan_connections p on p.id = q.connection_id
         where q.id = $1 and p.workspace_id = $2 for update of q`,
        [uuid(qid), ws],
      );
      const q = rows[0] ? toQualification(rows[0] as Row) : null;
      if (!q) throw fail('NOT_FOUND', 'Qualification not found.');
      if (q.state !== 'running')
        throw fail('INVALID_TRANSITION', 'The qualification already finished.');
      const unresolved = await c.query(
        `select 1 from plan_requests where qualification_id = $1 and state in ('in_flight','unknown')`,
        [qid],
      );
      if (unresolved.rowCount)
        throw fail(
          'INVALID_TRANSITION',
          'A qualification case is still unresolved.',
        );
      const manifest = rows[0].manifest as {
        cases: { case_id: string; split: string }[];
      };
      const results = await c.query(
        'select case_id, case_split, signal from plan_requests where qualification_id = $1',
        [qid],
      );
      const accepted = new Set(
        results.rows
          .filter((x) => x.signal === 'accepted')
          .map((x) => String(x.case_id)),
      );
      const tally = (split: string) => {
        const cases = manifest.cases.filter((x) => x.split === split);
        return {
          passed: cases.filter((x) => accepted.has(x.case_id)).length,
          total: cases.length,
        };
      };
      const development = tally('development');
      const held_out = tally('held_out');
      const decision = qualificationDecision({
        held_out,
        min_held_out_cases: q.min_held_out_cases,
        floor: q.floor,
      });
      await c.query(
        `update plan_qualifications set state = $2, development = $3, held_out = $4, reason = $5,
           decided_at = clock_timestamp() where id = $1`,
        [
          qid,
          decision.qualified ? 'qualified' : 'failed',
          development,
          held_out,
          decision.reason,
        ],
      );
      await this.#event(
        c,
        q.connection_id,
        decision.qualified ? 'task_qualified' : 'task_qualification_failed',
        {
          qualification_id: qid,
          model_id: q.model_id,
          task_class: q.task_class,
          held_out,
          development,
        },
        ctx,
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'connection.qualification_decided',
        subjectKind: 'plan_qualification',
        subjectId: qid,
        subjectVersion: null,
        contentHash: q.manifest_hash,
        payload: {
          qualified: decision.qualified,
          task_class: q.task_class,
          model_id: q.model_id,
        },
      });
      const after = await c.query(
        'select * from plan_qualifications where id = $1',
        [qid],
      );
      return toQualification(after.rows[0] as Row);
    });
  }

  /**
   * A qualification with each benchmark case as it was graded (F10): the stored answer, the
   * grader's signal and its reason, in manifest order. Readable by any workspace member; answers
   * are kept only for synthetic or public data (ADR-0049).
   */
  async planQualificationResults(
    ctxIn: CommandContext,
    ws: string,
    qid: string,
  ): Promise<PlanQualificationResults> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const { rows } = await c.query(
        `select q.* from plan_qualifications q join plan_connections p on p.id = q.connection_id
         where q.id = $1 and p.workspace_id = $2`,
        [uuid(qid), ws],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Qualification not found.');
      const manifest = rows[0].manifest as {
        name?: unknown;
        cases: { case_id: string; split: 'development' | 'held_out' }[];
      };
      const requests = await c.query(
        `select id, case_id, state, signal, reason_code, output_chars, output_text, started_at
         from plan_requests where qualification_id = $1`,
        [qid],
      );
      const byCase = new Map(
        requests.rows.map((r) => [String(r.case_id), r as Row]),
      );
      // PR #86 review L-5: these results show held-out outcomes, reasons and answers, so the
      // view is recorded once per person, and a later benchmark that reuses these held-out
      // cases with a different prompt is refused (startPlanQualification).
      const full = rows[0].manifest as { cases: ManifestCase[] };
      if (
        full.cases.some((k) => k.split === 'held_out' && byCase.has(k.case_id))
      ) {
        const seen = await c.query(
          `select 1 from plan_connection_events where connection_id = $1 and kind = $2
             and actor_id = $3 and body->>'qualification_id' = $4`,
          [
            rows[0].connection_id,
            HELD_OUT_VIEWED,
            ctx.actorId,
            String(rows[0].id),
          ],
        );
        if (!seen.rowCount)
          await this.#event(
            c,
            String(rows[0].connection_id),
            HELD_OUT_VIEWED,
            {
              qualification_id: String(rows[0].id),
              task_class: String(rows[0].task_class),
              manifest_hash: String(rows[0].manifest_hash),
              prompt_hash: promptHash(full.cases),
              held_out: heldOutKeys(full.cases),
              held_out_prompts: heldOutPrompts(full.cases),
            },
            ctx,
          );
      }
      return {
        qualification: toQualification(rows[0] as Row),
        manifest_name:
          typeof manifest.name === 'string'
            ? manifest.name.slice(0, 200)
            : null,
        cases: manifest.cases.map((m) => {
          const r = byCase.get(m.case_id);
          return {
            case_id: m.case_id,
            split: m.split,
            request_id: r ? String(r.id) : null,
            state: r ? (r.state as PlanRequest['state']) : null,
            signal: r ? nullable(r.signal) : null,
            reason: r ? nullable(r.reason_code) : null,
            output_chars:
              r && r.output_chars !== null ? Number(r.output_chars) : null,
            answer: r ? nullable(r.output_text) : null,
            started_at: r ? iso(r.started_at) : null,
          };
        }),
      };
    });
  }

  async planRequests(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    limit = 50,
  ): Promise<PlanRequest[]> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      await this.#connection(c, ws, uuid(id));
      const { rows } = await c.query(
        'select * from plan_requests where connection_id = $1 order by started_at desc limit $2',
        [id, Math.min(Math.max(1, limit), 200)],
      );
      return rows.map((r) => toRequest(r as Row));
    });
  }

  // ---- Internals ----------------------------------------------------------------------

  async #ownerChange<T extends Row>(
    ctx: CommandContext,
    ws: string,
    id: string,
    expectedVersion: number,
    kind: string,
    change: (c: PoolClient, conn: PlanConnection) => Promise<T>,
  ): Promise<PlanConnection> {
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const conn = await this.#lock(c, ws, uuid(id));
      if (conn.version !== expectedVersion)
        throw fail(
          'VERSION_CONFLICT',
          'The connection changed; reload it and try again.',
        );
      const payload = await change(c, conn);
      await c.query(
        'update plan_connections set version = version + 1, updated_at = clock_timestamp() where id = $1',
        [conn.id],
      );
      await this.#event(c, conn.id, kind, payload, ctx);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: `connection.${kind}`,
        subjectKind: 'plan_connection',
        subjectId: conn.id,
        subjectVersion: conn.version + 1,
        contentHash: null,
        payload,
      });
      return this.#connection(c, ws, conn.id);
    });
  }

  async #lock(c: PoolClient, ws: string, id: string): Promise<PlanConnection> {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [
      PLAN_LOCK + id,
    ]);
    const { rows } = await c.query(
      'select * from plan_connections where workspace_id = $1 and id = $2 for update',
      [ws, id],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Connection not found.');
    return toConnection(rows[0] as Row);
  }

  async #connection(
    c: PoolClient,
    ws: string,
    id: string,
  ): Promise<PlanConnection> {
    const { rows } = await c.query(
      'select * from plan_connections where workspace_id = $1 and id = $2',
      [ws, id],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Connection not found.');
    return toConnection(rows[0] as Row);
  }

  async #detail(
    c: PoolClient,
    ws: string,
    id: string,
    actorId: string,
  ): Promise<PlanConnectionDetail> {
    const connection = await this.#connection(c, ws, id);
    const grants = await c.query(
      'select * from plan_verification_grants where connection_id = $1 order by created_at desc limit 20',
      [id],
    );
    const usage = await this.#usage(c, id, null, null);
    const open = await c.query(
      `select pr.*, ${PLAN_REQUEST_STALE_AFTER} as closable_after,
         ${PLAN_REQUEST_STALE_AFTER} <= clock_timestamp() as overdue
       from plan_requests pr join plan_connections pc on pc.id = pr.connection_id
       where pr.connection_id = $1 and pr.state in ('in_flight','unknown')
       order by pr.started_at, pr.id`,
      [id],
    );
    const rechecks = await c.query(
      `select distinct on (model_id, path) model_id, path, id, state, reason_code, finished_at
       from plan_requests
       where connection_id = $1 and purpose = 'availability_recheck' and finished_at is not null
       order by model_id, path, finished_at desc, id`,
      [id],
    );
    return {
      connection,
      last_rechecks: (rechecks.rows as Row[]).map((r) => ({
        model_id: String(r.model_id),
        path: r.path as 'responses' | 'codex',
        request_id: String(r.id),
        state: String(r.state),
        reason_code: r.reason_code === null ? null : String(r.reason_code),
        finished_at: new Date(r.finished_at as string).toISOString(),
      })),
      model_access: await this.#access(c, id),
      qualifications: await this.#qualifications(c, id),
      grants: grants.rows.map((r) => toGrant(r as Row)),
      usage: {
        last_24h_requests: usage.last_24h_requests,
        last_24h_codex_builds: usage.last_24h_codex_builds,
        in_flight: usage.in_flight,
        unresolved: usage.unresolved,
        extra_requests: usage.extra_requests,
        extras: usage.extras,
        next_frees_at: this.#nextFreesAt(connection, usage),
        can_add_extra:
          usage.last_24h_requests >=
            dailyCap(connection.settings.caps, usage) &&
          (await this.isPolicyOwner(c, ws, actorId)),
      },
      open_requests: (open.rows as Row[]).map((r) => {
        const flying = r.state === 'in_flight';
        const waiting = flying && this.#livePlanRequests.has(String(r.id));
        return {
          request: toRequest(r),
          closable: !flying || (!waiting && Boolean(r.overdue)),
          waiting,
          closable_after: flying ? iso(r.closable_after) : null,
        };
      }),
      blockers: connectionBlockers(connection),
      refusals: connectionRefusals(connection),
      qualification_queue: await this.#newestQueue(c, id),
    };
  }

  async #usage(
    c: PoolClient,
    id: string,
    runId: string | null,
    buildId: string | null,
  ): Promise<WindowUsage> {
    const { rows } = await c.query(
      `select
         coalesce(array_agg(started_at order by started_at)
           filter (where started_at > clock_timestamp() - interval '24 hours'), '{}') as starts,
         clock_timestamp() as now,
         count(distinct build_id) filter (where path = 'codex' and started_at > clock_timestamp() - interval '24 hours') as builds,
         count(*) filter (where $2::uuid is not null and run_id = $2 and path = 'responses') as run,
         count(*) filter (where $3::uuid is not null and build_id = $3) as build,
         count(*) filter (where state = 'in_flight') as in_flight,
         count(*) filter (where state = 'unknown') as unresolved
       from plan_requests where connection_id = $1`,
      [id, runId, buildId],
    );
    const r = rows[0] as Row;
    const extras = await this.#extras(c, id);
    // The window's count and its start times come from one statement (re-review 2 N-3), so
    // "full", the offer and the next-request time agree.
    const starts = (r.starts as Date[]).map((d) => new Date(d).getTime());
    return {
      last_24h_requests: starts.length,
      starts_ms: starts,
      now_ms: new Date(r.now as Date).getTime(),
      last_24h_codex_builds: Number(r.builds),
      run_requests: Number(r.run),
      build_requests: Number(r.build),
      in_flight: Number(r.in_flight),
      unresolved: Number(r.unresolved),
      extra_requests: extras.reduce((n, x) => n + x.requests, 0),
      extras,
    };
  }

  /**
   * ADR-0094 (review L-3, re-review 2 N-2): when one more request is admitted, by the same rule
   * as the usage indicator (`nextRequestAt`), from the counts `#usage` read.
   */
  #nextFreesAt(conn: PlanConnection, usage: WindowUsage): string | null {
    const t = nextRequestAt(
      usage.starts_ms,
      conn.settings.caps.shared.max_model_requests_per_day,
      usage.extras.map((x) => ({
        requests: x.requests,
        expires_ms: Date.parse(x.expires_at),
      })),
      usage.now_ms,
    );
    return t === null ? null : new Date(t).toISOString();
  }

  /** ADR-0094: a connection's unexpired extra requests, soonest expiry first. */
  async #extras(c: PoolClient, id: string): Promise<PlanExtra[]> {
    const { rows } = await c.query(
      `select requests, expires_at from plan_extra_requests
        where connection_id = $1 and expires_at > clock_timestamp()
        order by expires_at, granted_at`,
      [id],
    );
    return (rows as Row[]).map((x) => ({
      requests: Number(x.requests),
      expires_at: iso(x.expires_at),
    }));
  }

  /**
   * ADR-0094 (P29, walk item 6): the owner adds 20 requests to a connection's daily cap for the
   * next 24 hours, the length of the rolling window, so only the window in use now is raised.
   * Offered only while the cap (with any earlier extra) is used up, and again each time it runs
   * out; a second press after the first succeeded is refused because there is room again. The
   * configured cap, recorded usage, the provider's own limit and the runtime spending ceiling
   * are not changed. The connection's version moves on and the grant is audited.
   */
  async grantExtraRequests(
    ctxIn: CommandContext,
    ws: string,
    id: string,
    body: unknown,
  ): Promise<PlanConnection> {
    const ctx = normalize(ctxIn);
    const req = parse(GrantExtraRequestsRequestSchema, body);
    return this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'extra_requests_granted',
      async (c, conn) => {
        const usage = await this.#usage(c, conn.id, null, null);
        const configured = conn.settings.caps.shared.max_model_requests_per_day;
        const cap = dailyCap(conn.settings.caps, usage);
        if (usage.last_24h_requests < cap)
          throw fail(
            'INVALID_TRANSITION',
            `This connection still has room today (${usage.last_24h_requests} of ${cap} requests used); extra requests are added only once the daily cap is used up.`,
          );
        const { rows } = await c.query(
          `insert into plan_extra_requests (id, connection_id, requests, configured_cap,
             used_at_grant, settings_hash, connection_version, granted_by, expires_at)
           values ($1,$2,$3,$4,$5,$6,$7,$8, clock_timestamp() + make_interval(hours => $9))
           returning id, granted_at, expires_at`,
          [
            randomUUID(),
            conn.id,
            req.requests,
            configured,
            usage.last_24h_requests,
            conn.settings_hash,
            conn.version,
            ctx.actorId,
            PLAN_EXTRA_HOURS,
          ],
        );
        const g = rows[0] as Row;
        return {
          grant_id: String(g.id),
          requests: req.requests,
          configured_cap: configured,
          used_at_grant: usage.last_24h_requests,
          cap_before: cap,
          cap_now: cap + req.requests,
          granted_at: iso(g.granted_at),
          expires_at: iso(g.expires_at),
          summary: `Added ${req.requests} requests to today's cap (${cap} → ${cap + req.requests}) until ${iso(g.expires_at)}; the configured cap stays ${configured}.`,
        };
      },
    );
  }

  async #access(c: PoolClient, id: string): Promise<PlanModelAccess[]> {
    const { rows } = await c.query(
      'select * from plan_model_access where connection_id = $1 order by model_id, path',
      [id],
    );
    return rows.map((r) => toAccess(r as Row));
  }

  /** All of a connection's qualifications, or with `current` only those that may admit work. */
  async #qualifications(
    c: PoolClient,
    id: string,
    current = false,
  ): Promise<PlanQualification[]> {
    const { rows } = await c.query(
      'select * from plan_qualifications where connection_id = $1 order by created_at desc',
      [id],
    );
    return (rows as Row[])
      .filter((r) => !current || currentForBuildRole(r))
      .map((r) => {
        const q = toQualification(r);
        // ADR-0084: say which started qualification this process is running now, so the page
        // reads it from here instead of remembering a press it may have lost.
        return q.state === 'running'
          ? { ...q, executing: this.#runningQualifications.has(q.id) }
          : q;
      });
  }

  /** Qualifications that may admit work now: build-role ones only under the current prompts. */
  async planAdmittingQualifications(
    ctxIn: CommandContext,
    ws: string,
    id: string,
  ): Promise<PlanQualification[]> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const conn = await c.query(
        'select id from plan_connections where id = $1 and workspace_id = $2',
        [uuid(id), uuid(ws)],
      );
      if (!conn.rows[0]) throw fail('NOT_FOUND', 'Plan connection not found.');
      return this.#qualifications(c, uuid(id), true);
    });
  }

  // ---- ADR-0093 (P28): a workspace's own OpenAI API key -----------------------------------
  // The key is in the studio's vault; these rows hold its reference, model and last four.

  /** What any member may see: never the key or its vault reference. */
  async workspaceApiKey(
    ctxIn: CommandContext,
    ws: string,
  ): Promise<WorkspaceApiKey | null> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const { rows } = await c.query(
        `select model_id, last_four, version, saved_at, saved_by from workspace_api_keys
          where workspace_id = $1 and provider = 'openai'`,
        [uuid(ws)],
      );
      return rows[0] ? toApiKey(rows[0] as Row) : null;
    });
  }

  /**
   * The vault reference a model call from this workspace reads. Members only (a call's own
   * grant, budget and admission decide whether it may spend); the reference never leaves the
   * studio process.
   */
  async workspaceApiKeyRef(
    ctxIn: CommandContext,
    ws: string,
  ): Promise<{ credential_ref: string; model_id: string } | null> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const { rows } = await c.query(
        `select credential_ref, model_id from workspace_api_keys
          where workspace_id = $1 and provider = 'openai'`,
        [uuid(ws)],
      );
      return rows[0]
        ? {
            credential_ref: String(rows[0].credential_ref),
            model_id: String(rows[0].model_id),
          }
        : null;
    });
  }

  /**
   * Saves or replaces the key's record (owner only, real workspaces only). The caller has
   * already sealed the key under `credential_ref`; the replaced reference is returned so the
   * caller removes that vault entry.
   */
  async saveWorkspaceApiKey(
    ctxIn: CommandContext,
    ws: string,
    k: {
      model_id: string;
      last_four: string;
      credential_ref: string;
      expected_version: number | null;
    },
  ): Promise<{
    saved: WorkspaceApiKey;
    replaced_credential_ref: string | null;
  }> {
    const ctx = normalize(ctxIn);
    const w = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(
        c,
        w,
        ctx.actorId,
        'Only the workspace owner, signed in as a person, can add or change its API key.',
      );
      const fx = await c.query('select fixture from workspaces where id = $1', [
        w,
      ]);
      if (fx.rows[0]?.fixture)
        throw fail(
          'INVALID_TRANSITION',
          'Fixture workspaces never use a real API key.',
        );
      const old = (
        await c.query(
          `select credential_ref, version from workspace_api_keys
            where workspace_id = $1 and provider = 'openai' for update`,
          [w],
        )
      ).rows[0];
      const current = old ? Number(old.version) : null;
      if (current !== k.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          current === null
            ? 'This workspace has no saved key now. Reload and try again.'
            : 'The saved key changed since this page was read. Reload and try again.',
        );
      // A first save never overwrites one saved meanwhile, and a replace changes only the
      // version it read, so a vault entry is never left without its record.
      const { rows } = old
        ? await c.query(
            `update workspace_api_keys set model_id = $2, credential_ref = $3, last_four = $4,
               version = version + 1, saved_by = $5, saved_at = clock_timestamp()
             where workspace_id = $1 and provider = 'openai' and version = $6
             returning model_id, last_four, version, saved_at, saved_by`,
            [
              w,
              k.model_id,
              k.credential_ref,
              k.last_four,
              ctx.actorId,
              current,
            ],
          )
        : await c.query(
            `insert into workspace_api_keys
               (workspace_id, fixture, provider, model_id, credential_ref, last_four, version, saved_by)
             values ($1, false, 'openai', $2, $3, $4, 1, $5)
             on conflict (workspace_id, provider) do nothing
             returning model_id, last_four, version, saved_at, saved_by`,
            [w, k.model_id, k.credential_ref, k.last_four, ctx.actorId],
          );
      if (!rows[0])
        throw fail(
          'VERSION_CONFLICT',
          'The saved key changed since this page was read. Reload and try again.',
        );
      const saved = toApiKey(rows[0] as Row);
      await this.append(c, ctx, {
        workspaceId: w,
        action: old ? 'api_key.replaced' : 'api_key.saved',
        subjectKind: 'api_key',
        subjectId: w,
        subjectVersion: saved.version,
        contentHash: null,
        payload: {
          provider: 'openai',
          model_id: saved.model_id,
          last_four: saved.last_four,
        },
      });
      return {
        saved,
        replaced_credential_ref: old ? String(old.credential_ref) : null,
      };
    });
  }

  /** Review 1 N-6: re-points the saved key at another model (owner only); the key is kept. */
  async changeWorkspaceApiKeyModel(
    ctxIn: CommandContext,
    ws: string,
    modelId: string,
    expectedVersion: number,
  ): Promise<WorkspaceApiKey> {
    const ctx = normalize(ctxIn);
    const w = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(
        c,
        w,
        ctx.actorId,
        'Only the workspace owner, signed in as a person, can change its API key.',
      );
      // Review 2 N-4: the same model is not a change (no new version, no audit row).
      const same = await c.query(
        `select model_id, last_four, version, saved_at, saved_by from workspace_api_keys
          where workspace_id = $1 and provider = 'openai' and version = $2 and model_id = $3`,
        [w, expectedVersion, modelId],
      );
      if (same.rows[0]) return toApiKey(same.rows[0] as Row);
      const { rows } = await c.query(
        `update workspace_api_keys set model_id = $3, version = version + 1,
           saved_by = $4, saved_at = clock_timestamp()
         where workspace_id = $1 and provider = 'openai' and version = $2
         returning model_id, last_four, version, saved_at, saved_by`,
        [w, expectedVersion, modelId, ctx.actorId],
      );
      if (!rows[0])
        throw fail(
          'VERSION_CONFLICT',
          'The saved key changed or was removed since this page was read. Reload and try again.',
        );
      const saved = toApiKey(rows[0] as Row);
      await this.append(c, ctx, {
        workspaceId: w,
        action: 'api_key.model_changed',
        subjectKind: 'api_key',
        subjectId: w,
        subjectVersion: saved.version,
        contentHash: null,
        payload: {
          provider: 'openai',
          model_id: saved.model_id,
          last_four: saved.last_four,
        },
      });
      return saved;
    });
  }

  /** Removes the key's record (owner only); returns the vault reference to delete. */
  async removeWorkspaceApiKey(
    ctxIn: CommandContext,
    ws: string,
    expectedVersion: number,
  ): Promise<{ credential_ref: string }> {
    const ctx = normalize(ctxIn);
    const w = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(
        c,
        w,
        ctx.actorId,
        'Only the workspace owner, signed in as a person, can remove its API key.',
      );
      const { rows } = await c.query(
        `delete from workspace_api_keys
          where workspace_id = $1 and provider = 'openai' and version = $2
          returning credential_ref, model_id, last_four, version`,
        [w, expectedVersion],
      );
      if (!rows[0])
        throw fail(
          'VERSION_CONFLICT',
          'The saved key changed or was removed since this page was read. Reload and try again.',
        );
      await this.append(c, ctx, {
        workspaceId: w,
        action: 'api_key.removed',
        subjectKind: 'api_key',
        subjectId: w,
        subjectVersion: Number(rows[0].version),
        contentHash: null,
        payload: {
          provider: 'openai',
          model_id: String(rows[0].model_id),
          last_four: String(rows[0].last_four),
        },
      });
      return { credential_ref: String(rows[0].credential_ref) };
    });
  }

  async #event(
    c: PoolClient,
    connectionId: string,
    kind: string,
    body: Row,
    ctx: { actorId: string },
  ) {
    await c.query(
      'insert into plan_connection_events (id, connection_id, kind, body, actor_id) values ($1,$2,$3,$4,$5)',
      [randomUUID(), connectionId, kind, body, ctx.actorId],
    );
  }
}

/** ADR-0093: what is shown of a workspace's saved OpenAI API key. */
export interface WorkspaceApiKey {
  model_id: string;
  last_four: string;
  version: number;
  saved_at: string;
  saved_by: string;
}
function toApiKey(r: Row): WorkspaceApiKey {
  return {
    model_id: String(r.model_id),
    last_four: String(r.last_four),
    version: Number(r.version),
    saved_at: new Date(r.saved_at as string).toISOString(),
    saved_by: String(r.saved_by),
  };
}
