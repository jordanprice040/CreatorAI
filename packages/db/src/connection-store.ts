import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  BenchmarkCheckSchema,
  AcceptPlanCapsRequestSchema,
  AttestCreditsRequestSchema,
  ContractError,
  CreatePlanConnectionRequestSchema,
  CreateVerificationGrantRequestSchema,
  PlanAdmissionRequestSchema,
  PlanSettlementSchema,
  ReconcilePlanRequestSchema,
  StartPlanQualificationRequestSchema,
  UpdatePlanSettingsRequestSchema,
  WithdrawCreditsRequestSchema,
  parse,
  z,
  DISCOVERY_TASK_CLASSES,
  type WorkflowResourceSetup,
  type WorkflowLimits,
  type Workflow,
  type Admission,
  type PlanAdmissionRequest,
  type PlanConnection,
  type PlanConnectionDetail,
  type PlanModelAccess,
  type PlanQualification,
  type PlanRequest,
  type PlanSettlement,
  type PlanVerificationGrant,
} from '@creator/contracts';
import {
  DISCOVERY_ROLE_VERSION,
  discoveryRoleInput,
  admissionBlockers,
  canonicalHash,
  connectionBlockers,
  qualificationDecision,
  type PlanUsageCounts,
} from '@creator/domain';
import { PortfolioStore } from './portfolio-store.js';
import {
  fail,
  iso,
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
  workflow_output_text?: string;
}

const PLAN_LOCK = 'creator:plan-connection:';
const nullable = (v: unknown) =>
  v === null || v === undefined ? null : String(v);

function toConnection(r: Row): PlanConnection {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    fixture: Boolean(r.fixture),
    kind: 'chatgpt_plan',
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

export class ConnectionStore extends PortfolioStore {
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
           settings_hash, ext_agent_host_id, sign_in, credits, eligibility, quota, created_by)
         values ($1,$2,$3,1,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
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
        ],
      );
      await this.#event(
        c,
        id,
        'created',
        { label: req.label, settings_hash: canonicalHash(req.settings) },
        ctx,
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'connection.created',
        subjectKind: 'plan_connection',
        subjectId: id,
        subjectVersion: 1,
        contentHash: canonicalHash(req.settings),
        payload: { kind: 'chatgpt_plan', label: req.label },
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
    return this.#ownerChange(
      ctx,
      ws,
      id,
      req.expected_version,
      'request_reconciled',
      async (c, conn) => {
        const observed = await c.query(
          `select output_chars from plan_requests where id=$1 and connection_id=$2
           and state in ('unknown','in_flight') for update`,
          [uuid(requestId), conn.id],
        );
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
    },
  ) {
    const ctx = normalize(ctxIn);
    return this.tx(async (c) => {
      await this.requireOwner(c, uuid(ws), ctx.actorId);
      const conn = await this.#lock(c, ws, uuid(id));
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
        `update plan_connections set version = version + 1, updated_at = clock_timestamp(),
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
      };
    });
  }

  async recordPlanAccessRefresh(connectionId: string, accessExpiresAt: string) {
    await this.pool.query(
      `update plan_connections set sign_in = jsonb_set(sign_in, '{access_expires_at}', to_jsonb($2::text)),
         updated_at = clock_timestamp() where id = $1`,
      [uuid(connectionId), accessExpiresAt],
    );
  }

  async markPlanReauthorizationRequired(connectionId: string, reason: string) {
    await this.pool.query(
      `update plan_connections set version = version + 1, updated_at = clock_timestamp(),
         sign_in = jsonb_set(sign_in, '{state}', '"reauthorization_required"'), status_reason = $2
       where id = $1 and sign_in->>'state' = 'signed_in'`,
      [uuid(connectionId), reason.slice(0, 1200)],
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
      await c.query(
        `update plan_connections set version = version + 1, updated_at = clock_timestamp(),
           credential_ref = null,
           sign_in = jsonb_build_object('state','signed_out','issued_client_id', sign_in->'issued_client_id',
             'account_label', sign_in->'account_label','scopes','[]'::jsonb,'plan_usage_granted',false,
             'verified_at',null,'access_expires_at',null),
           status_reason = $2 where id = $1`,
        [
          conn.id,
          remoteRevocationConfirmed
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
      .filter((r) => {
        const manifest = r.manifest as {
          cases?: {
            input?: { role: string; text: string }[];
            check?: unknown;
          }[];
        };
        const required =
          r.task_class === 'candidate_generation'
            ? ['propose', 'revise']
            : r.task_class === 'research_synthesis'
              ? ['locate']
              : ['skeptic'];
        const kinds = new Set<string>();
        if (
          !manifest.cases?.length ||
          canonicalHash(manifest) !== r.manifest_hash
        )
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
      })
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
    const blockers = [
      ...new Set(Object.values(DISCOVERY_TASK_CLASSES)),
    ].flatMap((task_class) =>
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
        'Discovery route is not ready.',
        [...new Set(blockers)],
      );
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
          DISCOVERY_TASK_CLASSES[
            task.kind as keyof typeof DISCOVERY_TASK_CLASSES
          ] !== req.task_class
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
        : await this.#qualifications(c, conn.id);
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
      if (grant)
        await c.query(
          'update plan_verification_grants set used = 1 where id = $1',
          [grant.id],
        );
      const rid = randomUUID();
      await c.query(
        `insert into plan_requests (id, connection_id, logical_operation_id, path, purpose, model_id,
           task_class, data_class, run_id, build_id, grant_id, qualification_id, case_id, case_split,
           state, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'in_flight',$15)`,
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

  /** Records how an admitted request ended, plus what it showed about the account. */
  async settlePlanRequest(
    requestId: string,
    raw: PlanSettlement,
    observed: PlanObservation = {},
  ): Promise<PlanRequest> {
    const s = parse(PlanSettlementSchema, raw);
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
          s.state === 'completed' ? null : s.reason_code,
          s.upstream_request_id,
          s.state === 'completed' ? s.output_tokens : null,
          s.output_chars,
          s.state === 'completed' ? s.output_hash : null,
          observed.signal ?? null,
          r.workflow_task_id && s.state === 'completed'
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
      const eligibility =
        observed.eligibility ??
        (s.state === 'completed' ? 'eligible' : undefined);
      if (eligibility)
        set('eligibility', {
          state: eligibility,
          reason_code: observed.reason_code ?? null,
          upstream_request_id:
            observed.upstream_request_id ?? s.upstream_request_id,
          observed_at: now,
        });
      const quota =
        observed.quota ?? (s.state === 'completed' ? 'available' : undefined);
      if (quota)
        set('quota', {
          state: quota,
          reason_code: observed.reason_code ?? null,
          observed_at: now,
        });
      if (observed.sign_in_invalid)
        set('sign_in', {
          ...(conn.rows[0].sign_in as object),
          state: 'reauthorization_required',
        });
      if (updates.length)
        await c.query(
          `update plan_connections set ${updates.join(', ')}, updated_at = clock_timestamp() where id = $1`,
          values,
        );
      if (r.purpose === 'verification') {
        const verified = s.state === 'completed';
        if (verified || observed.model_refused)
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

  async #qualifications(
    c: PoolClient,
    id: string,
  ): Promise<PlanQualification[]> {
    const { rows } = await c.query(
      'select * from plan_qualifications where connection_id = $1 order by created_at desc',
      [id],
    );
    return rows.map((r) => toQualification(r as Row));
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
