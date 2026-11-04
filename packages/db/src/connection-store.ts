import { createHash, randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BenchmarkCheckSchema,
  AcceptPlanCapsRequestSchema,
  AttestCreditsRequestSchema,
  ContractError,
  CreatePlanConnectionRequestSchema,
  CreateVerificationGrantRequestSchema,
  PlanAdmissionRequestSchema,
  BuildApprovalRequestSchema,
  BUILD_APPROVAL_MAX_MS,
  PlanSettlementSchema,
  ReconcilePlanRequestSchema,
  StartPlanQualificationRequestSchema,
  UpdatePlanSettingsRequestSchema,
  WithdrawCreditsRequestSchema,
  parse,
  z,
  DISCOVERY_TASK_CLASSES,
  EXPLORATION_TASK_CLASS,
  workflowTaskClass,
  type WorkflowResourceSetup,
  type WorkflowLimits,
  type Workflow,
  type Admission,
  type BuildApproval,
  type BuildApprovalResult,
  type PlanAdmissionRequest,
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
  ChatAnswerRequestSchema,
  ChatCreateRequestSchema,
  ChatMessageRequestSchema,
  ChatSettingsRequestSchema,
  WorkspaceNoteRequestSchema,
  type ActivityNow,
  type WorkspaceNote,
  ChatRenameRequestSchema,
  chatTitle,
  classifyChat,
  type ChatAnswer,
  type ChatAnswerState,
  type ChatConversation,
  type ChatDeleted,
  type ChatDetail,
  type ChatSettings,
  type ChatMessage,
  usageOffStatement,
  CLAUDE_CODE_MIN_VERSION,
  claudeCodeVersionSupported,
} from '@creator/contracts';
import {
  BUILD_ROLE_PROMPTS,
  BUILD_ROLE_TASK_CLASSES,
  DISCOVERY_ROLE_VERSION,
  discoveryRoleInput,
  admissionBlockers,
  canonicalHash,
  connectionBlockers,
  qualificationDecision,
  type BuildRole,
  type PlanChatAllowance,
  type PlanUsageCounts,
} from '@creator/domain';
import { PortfolioStore } from './portfolio-store.js';
import { usageSummary } from './usage-summary.js';
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
  chatUsed24h,
  toChatAnswer,
  toChatMessage,
} from './chat-store.js';
import { toRun } from './oversight-store.js';
import {
  activityNow,
  PLAN_REQUEST_STALE_AFTER,
  workspaceNote,
} from './sidebar-store.js';
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
  prompt_current: currentForBuildRole(r) && currentForDiscoveryRole(r),
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

/** Same discovery prompt binding used for both admission and historical-result labels. */
function currentForDiscoveryRole(r: Row): boolean {
  if (
    !['research_synthesis', 'candidate_generation', 'scoring'].includes(
      String(r.task_class),
    )
  )
    return true;
  const manifest = r.manifest as {
    cases?: { input?: { role: string; text: string }[]; check?: unknown }[];
  };
  const required =
    r.task_class === 'candidate_generation'
      ? ['propose', 'revise']
      : r.task_class === 'research_synthesis'
        ? ['locate']
        : ['skeptic'];
  const kinds = new Set<string>();
  if (!manifest.cases?.length || canonicalHash(manifest) !== r.manifest_hash)
    return false;
  for (const item of manifest.cases) {
    const parsed = BenchmarkCheckSchema.safeParse(item.check);
    if (!parsed.success || parsed.data.kind !== 'discovery_contract')
      return false;
    const check = parsed.data;
    if (
      check.context.role_version !== DISCOVERY_ROLE_VERSION ||
      check.context.packet_hash !== canonicalHash(check.packet)
    )
      return false;
    const expected = discoveryRoleInput(
      check.task_kind,
      check.context,
      check.packet,
      [],
    )[0]!.text;
    if (
      item.input
        ?.filter((m) => m.role === 'system')
        .map((m) => m.text)
        .join('\n\n') !== expected
    )
      return false;
    kinds.add(check.task_kind);
  }
  return required.every((k) => kinds.has(k));
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
const HELD_OUT_VIEWED = 'qualification_held_out_viewed';

export class ConnectionStore extends PortfolioStore {
  /**
   * PR #126 review L-1: chat answers this studio process has begun and not yet finished. A reply
   * can come back only to the process that sent the request, so these are the answers that are
   * really still on their way, whatever the connection's timeout says now. Empty after a
   * restart, when the stored timeout rule alone applies.
   */
  readonly #liveChatAnswers = new Set<string>();
  /**
   * ADR-0064: plan requests this studio process admitted and has not settled yet. The owner
   * cannot close one of these from the app, whatever its age: its result can still come back.
   * Empty after a restart, when the time rule alone applies (requests run by the worker process
   * are covered by the time rule only).
   */
  readonly #livePlanRequests = new Set<string>();

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
      const id = randomUUID();
      const exists = await c.query(
        'select 1 from plan_connections where workspace_id = $1 and label = $2',
        [ws, req.label],
      );
      if (exists.rowCount)
        throw fail('DUPLICATE', 'A connection with this name exists.');
      await c.query(
        `insert into plan_connections (id, workspace_id, fixture, version, label, settings,
           settings_hash, ext_agent_host_id, sign_in, credits, eligibility, quota, created_by, kind)
         values ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          id,
          ws,
          Boolean(w.rows[0]?.fixture),
          req.label,
          req.settings,
          canonicalHash(req.settings),
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
          req.kind,
        ],
      );
      await this.#event(
        c,
        id,
        'created',
        {
          kind: req.kind,
          label: req.label,
          settings_hash: canonicalHash(req.settings),
        },
        ctx,
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'connection.created',
        subjectKind: 'plan_connection',
        subjectId: id,
        subjectVersion: 1,
        contentHash: canonicalHash(req.settings),
        payload: { kind: req.kind, label: req.label },
      });
      return this.#connection(c, ws, id);
    });
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
      return usageSummary(c, uuid(ws), this.spending, owner, (r) =>
        connectionBlockers(toConnection(r)),
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
        if (message.text !== req.text || message.author_id !== ctx.actorId)
          throw new ContractError(
            'IDEMPOTENCY_CONFLICT',
            'This message id was already used for a different message.',
          );
        return { message, duplicate: true };
      }
      const { intent, target } = classifyChat(req.text);
      const messageId = randomUUID();
      const { rows } = await c.query(
        `insert into chat_messages (id, workspace_id, conversation_id, seq, client_id,
           author_id, text, intent, target)
         values ($1, $2, $3,
           (select coalesce(max(seq), 0) + 1 from chat_messages where conversation_id = $3),
           $4, $5, $6, $7, $8)
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
        payload: { message_id: messageId, intent },
      });
      return { message: toChatMessage(rows[0] as Row), duplicate: false };
    });
  }

  /** ADR-0060: the signed-in person's own note for this workspace. Any member, any role. */
  async workspaceNote(
    ctxIn: CommandContext,
    ws: string,
  ): Promise<WorkspaceNote> {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      return workspaceNote(c, uuid(ws), ctx.actorId);
    });
  }

  /**
   * ADR-0060: saves the person's note. A stale `expected_version` (another window saved first)
   * is refused with VERSION_CONFLICT. The note is personal scratch, so a viewer may keep one
   * too, and no audit event is written: the text never enters the activity history.
   */
  async saveWorkspaceNote(
    ctxIn: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<WorkspaceNote> {
    const ctx = normalize(ctxIn);
    const req = parse(WorkspaceNoteRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, false);
      const current = await workspaceNote(c, uuid(ws), ctx.actorId, true);
      if (current.version !== req.expected_version)
        throw fail(
          'VERSION_CONFLICT',
          'These notes were saved from another window since you opened them.',
        );
      if (current.version > 0 && current.text === req.text) return current;
      // The version check is in the write itself, so two first saves racing (no row to lock
      // yet) cannot both succeed: the second insert does nothing and is refused.
      const { rowCount } =
        req.expected_version === 0
          ? await c.query(
              `insert into workspace_notes (workspace_id, actor_id, text, version)
               values ($1, $2, $3, 1) on conflict (workspace_id, actor_id) do nothing`,
              [uuid(ws), ctx.actorId, req.text],
            )
          : await c.query(
              `update workspace_notes set text = $3, version = version + 1,
                 updated_at = clock_timestamp()
               where workspace_id = $1 and actor_id = $2 and version = $4`,
              [uuid(ws), ctx.actorId, req.text, req.expected_version],
            );
      if (rowCount !== 1)
        throw fail(
          'VERSION_CONFLICT',
          'These notes were saved from another window since you opened them.',
        );
      return workspaceNote(c, uuid(ws), ctx.actorId);
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
      await c.query(
        `insert into chat_settings (workspace_id, enabled, connection_id, model_id,
           include_snapshot, daily_limit, version, updated_by)
         values ($1,$2,$3,$4,$5,$6,1,$7)
         on conflict (workspace_id) do update set enabled = excluded.enabled,
           connection_id = excluded.connection_id, model_id = excluded.model_id,
           include_snapshot = excluded.include_snapshot, daily_limit = excluded.daily_limit,
           version = chat_settings.version + 1, updated_by = excluded.updated_by,
           updated_at = clock_timestamp()`,
        [
          uuid(ws),
          next.enabled,
          next.connection_id,
          next.model_id,
          next.include_snapshot,
          next.daily_limit,
          ctx.actorId,
        ],
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
      const turns = await c.query(
        `select m.seq, m.text,
           (select a.text from chat_answers a where a.message_id = m.id and a.state = 'completed'
             order by a.created_at desc limit 1) as answer
         from chat_messages m where m.conversation_id = $1 and m.seq < $2
         order by m.seq desc limit $3`,
        [conversation.id, msg.seq, CHAT_HISTORY_TURNS],
      );
      const history: { who: 'person' | 'assistant'; text: string }[] = [];
      for (const t of turns.rows.reverse() as Row[]) {
        history.push({ who: 'person', text: String(t.text) });
        if (t.answer)
          history.push({ who: 'assistant', text: String(t.answer) });
      }
      const snapshot = settings.include_snapshot
        ? await chatSnapshot(c, uuid(ws))
        : null;
      const built = chatInput({
        snapshot,
        history,
        question: String(msg.text),
        maxChars: Math.max(
          500,
          conn.settings.caps.responses.max_input_chars -
            CHAT_INSTRUCTIONS.length,
        ),
      });
      const id = randomUUID();
      const op = randomUUID();
      const { rows } = await c.query(
        `insert into chat_answers (id, workspace_id, conversation_id, message_id, client_id, state,
           connection_id, connection_kind, fixture, model_id, logical_operation_id,
           instructions_version, instructions_hash, history_items, snapshot, input, input_hash,
           created_by)
         values ($1,$2,$3,$4,$5,'pending',$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
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
      return this.#detail(c, ws, uuid(id));
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
  async #discoveryQualifications(
    c: PoolClient,
    id: string,
  ): Promise<PlanQualification[]> {
    const rows = await c.query(
      'select * from plan_qualifications where connection_id=$1',
      [id],
    );
    return rows.rows
      .filter((r) => currentForDiscoveryRole(r as Row))
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
    const qualifications = await this.#discoveryQualifications(c, conn.id);
    const usage = await this.#usage(c, conn.id, runId, null);
    const classes: (
      | typeof EXPLORATION_TASK_CLASS
      | (typeof DISCOVERY_TASK_CLASSES)[keyof typeof DISCOVERY_TASK_CLASSES]
    )[] =
      role === 'r01_exploration'
        ? [EXPLORATION_TASK_CLASS]
        : [...new Set(Object.values(DISCOVERY_TASK_CLASSES))];
    const blockers = classes.flatMap((task_class) =>
      admissionBlockers({
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
    if (blockers.length)
      throw new ContractError(
        'ACCESS_DENIED',
        role === 'r01_exploration'
          ? 'Exploration route is not ready.'
          : 'Discovery route is not ready.',
        [...new Set(blockers)],
      );
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
      const dayRoom =
        caps.shared.max_model_requests_per_day - usage.last_24h_requests;
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
          'select workflow_id from workflow_tasks where id=$1',
          [uuid(workflow.task_id)],
        );
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
        ? await this.#discoveryQualifications(c, conn.id)
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
      const blockers = admissionBlockers({
        connection: conn,
        request: req,
        access,
        qualifications,
        grant,
        usage,
        chat,
        now: new Date(),
      });
      if (blockers.length)
        throw new ContractError(
          'ACCESS_DENIED',
          'This plan request is not admitted.',
          blockers,
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
    const req = parse(StartPlanQualificationRequestSchema, body);
    let q: PlanQualification | null = null;
    await this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'qualification_started',
      async (c, conn) => {
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
        if (
          !conn.settings.allowed_data_classes.includes(req.manifest.data_class)
        )
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
        const keys = new Set(heldOutKeys(req.manifest.cases));
        const prompt = promptHash(req.manifest.cases);
        const views = await c.query(
          `select e.body, e.created_at from plan_connection_events e
             join plan_connections p on p.id = e.connection_id
            where p.workspace_id = $1 and e.kind = $2 and e.body->>'task_class' = $3
            order by e.created_at`,
          [conn.workspace_id, HELD_OUT_VIEWED, tc],
        );
        for (const v of views.rows as Row[]) {
          const b = v.body as { prompt_hash: string; held_out: string[] };
          if (b.prompt_hash === prompt) continue;
          const seen = b.held_out.filter((k) => keys.has(k)).length;
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
              ctx.actorId,
            ],
          );
          q = toQualification(rows[0] as Row);
        } catch (e) {
          if ((e as { code?: string }).code === '23505')
            throw fail(
              'DUPLICATE',
              'A qualification for this model and task class is already running.',
            );
          throw e;
        }
        return {
          qualification_id: qid,
          manifest_hash: canonicalHash(req.manifest),
        };
      },
    );
    return q!;
  }

  async planQualificationManifest(
    ctxIn: CommandContext,
    ws: string,
    qid: string,
  ) {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
      const { rows } = await c.query(
        `select q.*, p.workspace_id from plan_qualifications q join plan_connections p on p.id = q.connection_id
         where q.id = $1 and p.workspace_id = $2`,
        [uuid(qid), ws],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Qualification not found.');
      const done = await c.query(
        'select case_id from plan_requests where qualification_id = $1',
        [qid],
      );
      return {
        qualification: toQualification(rows[0] as Row),
        manifest: rows[0].manifest as z.infer<
          typeof StartPlanQualificationRequestSchema
        >['manifest'],
        attempted_cases: done.rows.map((x) => String(x.case_id)),
      };
    });
  }

  /** Tallies recorded signals and decides; cases that never ran count as not accepted. */
  async finishPlanQualification(
    ctxIn: CommandContext,
    ws: string,
    qid: string,
  ) {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.role(c, uuid(ws), ctx.actorId, true);
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
    return {
      connection,
      model_access: await this.#access(c, id),
      qualifications: await this.#qualifications(c, id),
      grants: grants.rows.map((r) => toGrant(r as Row)),
      usage: {
        last_24h_requests: usage.last_24h_requests,
        last_24h_codex_builds: usage.last_24h_codex_builds,
        in_flight: usage.in_flight,
        unresolved: usage.unresolved,
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
    };
  }

  async #usage(
    c: PoolClient,
    id: string,
    runId: string | null,
    buildId: string | null,
  ): Promise<PlanUsageCounts> {
    const { rows } = await c.query(
      `select
         count(*) filter (where started_at > clock_timestamp() - interval '24 hours') as day,
         count(distinct build_id) filter (where path = 'codex' and started_at > clock_timestamp() - interval '24 hours') as builds,
         count(*) filter (where $2::uuid is not null and run_id = $2 and path = 'responses') as run,
         count(*) filter (where $3::uuid is not null and build_id = $3) as build,
         count(*) filter (where state = 'in_flight') as in_flight,
         count(*) filter (where state = 'unknown') as unresolved
       from plan_requests where connection_id = $1`,
      [id, runId, buildId],
    );
    const r = rows[0] as Row;
    return {
      last_24h_requests: Number(r.day),
      last_24h_codex_builds: Number(r.builds),
      run_requests: Number(r.run),
      build_requests: Number(r.build),
      in_flight: Number(r.in_flight),
      unresolved: Number(r.unresolved),
    };
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
      .map((r) => toQualification(r));
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
