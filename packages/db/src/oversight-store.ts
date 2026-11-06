import { createHash, randomBytes, randomUUID } from 'node:crypto';
import {
  portfolioActionGate,
  portfolioEffectFence,
} from './portfolio-gates.js';
import type { PoolClient } from 'pg';
import {
  ContractError,
  parse,
  OVERSIGHT_POLICY_VERSION,
  RegisterRunRequestSchema,
  CancelRunRequestSchema,
  CreateStandingGrantRequestSchema,
  ReviseGrantRequestSchema,
  RevokeGrantRequestSchema,
  ActionRequestSchema,
  CreateDecisionRequestSchema,
  AnswerDecisionRequestSchema,
  AssumptionBodySchema,
  type ActionRequest,
  type ActionType,
  type Admission,
  type AutonomyMode,
  type Binding,
  type Decision,
  type DecisionKind,
  type Grant,
  type HumanReason,
  type RunControl,
  type SessionInfo,
} from '@creator/contracts';
import {
  ACTION_REGISTRY,
  DEFAULT_STAGE_GATES,
  bindingHash,
  canonicalHash,
  checkAnswer,
  conditionFor,
  coverageHash,
  evaluateAction,
  humilityGate,
  standingAllowed,
  standingDraft,
  type HumilityVerdict,
} from '@creator/domain';
import {
  Store,
  fail,
  iso,
  normalize,
  toEntity,
  uuid,
  type CommandContext,
  type Role,
  type Row,
} from './store.js';

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const nullableIso = (v: unknown) => (v === null ? null : iso(v));
const DECISION_TTL_MS = 72 * 3_600_000;

export function toRun(r: Row): RunControl {
  return {
    run_id: String(r.run_id),
    workspace_id: String(r.workspace_id),
    autonomy_mode: r.autonomy_mode as AutonomyMode,
    experiment_condition:
      r.experiment_condition as RunControl['experiment_condition'],
    policy_version: String(r.policy_version),
    stage_gates: r.stage_gates as ActionType[],
    initial_grants: r.initial_grants as RunControl['initial_grants'],
    state: r.state as RunControl['state'],
    cancel_reason: r.cancel_reason === null ? null : String(r.cancel_reason),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    cancelled_at: nullableIso(r.cancelled_at),
  };
}
export function toGrant(r: Row): Grant {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    version: Number(r.version),
    scope: r.scope as Grant['scope'],
    status: r.status as Grant['status'],
    run_id: r.run_id === null ? null : String(r.run_id),
    action_types: r.action_types as ActionType[],
    target_kind: r.target_kind === null ? null : String(r.target_kind),
    target: (r.target as Grant['target']) ?? null,
    spec_hash: r.spec_hash === null ? null : String(r.spec_hash),
    max_amount_nano_usd:
      r.max_amount_nano_usd === null ? null : String(r.max_amount_nano_usd),
    allow_irreversible: Boolean(r.allow_irreversible),
    allow_external_effects: Boolean(r.allow_external_effects),
    data_classes: r.data_classes as Grant['data_classes'],
    expires_at: iso(r.expires_at),
    decision_id: r.decision_id === null ? null : String(r.decision_id),
    policy_version: String(r.policy_version),
    rationale: String(r.rationale),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    revoked_at: nullableIso(r.revoked_at),
    revoke_reason: r.revoke_reason === null ? null : String(r.revoke_reason),
  };
}
function toAdmission(r: Row): Admission {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    run_id: String(r.run_id),
    verdict: r.verdict as Admission['verdict'],
    outcome: r.outcome as Admission['outcome'],
    reason_code: String(r.reason_code),
    reasons: r.reasons as HumanReason[],
    explanation: String(r.explanation),
    policy_version: String(r.policy_version),
    binding: r.binding as Binding,
    binding_hash: String(r.binding_hash),
    covered_by:
      r.grant_id === null
        ? null
        : {
            grant_id: String(r.grant_id),
            grant_version: Number(r.grant_version),
          },
    provisional_assumptions: (r.provisional_assumptions as string[]) ?? [],
    decision_id: r.decision_id === null ? null : String(r.decision_id),
    actor_id: String(r.actor_id),
    created_at: iso(r.created_at),
  };
}
const GRANT_COLUMNS = `id, workspace_id, version, scope, status, run_id, action_types,
  target_kind, target, spec_hash, max_amount_nano_usd, allow_irreversible,
  allow_external_effects, data_classes, expires_at, decision_id, policy_version,
  rationale, created_by`;

/**
 * Sessions, runs under oversight, grants, decision requests and action admission.
 * Every change commits with its audit event and outbox row, as in the record store.
 */
export class OversightStore extends Store {
  private async actorKind(c: PoolClient, actorId: string) {
    const { rows } = await c.query<{ kind: 'human' | 'agent' | 'system' }>(
      'select kind from actors where id = $1',
      [actorId],
    );
    if (!rows[0]) throw fail('ACCESS_DENIED', 'Unknown actor.');
    return rows[0].kind;
  }
  /** Policy changes (grants, run registration, cancellation) are owner actions by a person. */
  protected async requireOwner(c: PoolClient, ws: string, actorId: string) {
    const role = await this.role(c, ws, actorId, true);
    // ADR-0075: tester accounts are never workspace owners for policy purposes.
    if (
      role !== 'owner' ||
      (await this.actorKind(c, actorId)) !== 'human' ||
      (await this.isTester(c, actorId))
    )
      throw fail(
        'ACCESS_DENIED',
        'Only a workspace owner, signed in as a person, can change oversight policy.',
      );
  }

  // ---- Sessions -------------------------------------------------------------------------

  async createSession(
    actorId: string,
    method: 'dev_local' | 'oidc',
    subject: string | null,
    hours: number,
  ): Promise<{ token: string; session: SessionInfo }> {
    actorId = uuid(actorId, 'INVALID_CONTRACT');
    const secret = token();
    const csrf = token();
    return this.tx(async (c) => {
      const { rows } = await c.query(
        `insert into auth_sessions (token_hash, actor_id, method, subject, csrf_token, expires_at)
         values ($1, $2, $3, $4, $5, now() + make_interval(hours => $6))
         returning expires_at, (select display_name from actors where id = $2) as display_name,
           exists(select 1 from tester_accounts where actor_id = $2) as tester`,
        [sha256(secret), actorId, method, subject, csrf, hours],
      );
      await this.append(
        c,
        { actorId },
        {
          workspaceId: null,
          action: 'auth.session_started',
          subjectKind: 'actor',
          subjectId: actorId,
          subjectVersion: null,
          contentHash: null,
          payload: { method },
        },
      );
      return {
        token: secret,
        session: {
          authenticated: true as const,
          actor_id: actorId,
          display_name: String(rows[0]?.display_name),
          method,
          csrf_token: csrf,
          expires_at: iso(rows[0]?.expires_at),
          account: rows[0]?.tester ? ('tester' as const) : ('owner' as const),
        },
      };
    });
  }
  /** Resolves a presented session token; expired or revoked sessions resolve to nothing. */
  async session(secret: string): Promise<SessionInfo | null> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) return null;
    const { rows } = await this.pool.query(
      // ADR-0075: a tester's session ends with the account's expiry or disabling.
      `select s.actor_id, s.method, s.csrf_token, s.expires_at, a.display_name,
              t.actor_id is not null as tester
       from auth_sessions s join actors a on a.id = s.actor_id
       left join tester_accounts t on t.actor_id = s.actor_id
       where s.token_hash = $1 and s.revoked_at is null and s.expires_at > now()
         and (t.actor_id is null or (t.disabled_at is null and t.expires_at > now()))`,
      [sha256(secret)],
    );
    const r = rows[0] as Row | undefined;
    if (!r) return null;
    return {
      authenticated: true,
      actor_id: String(r.actor_id),
      display_name: String(r.display_name),
      method: r.method as SessionInfo['method'],
      csrf_token: String(r.csrf_token),
      expires_at: iso(r.expires_at),
      account: r.tester ? 'tester' : 'owner',
    };
  }
  async endSession(secret: string): Promise<void> {
    await this.tx(async (c) => {
      const { rows } = await c.query<{ actor_id: string }>(
        `update auth_sessions set revoked_at = now()
         where token_hash = $1 and revoked_at is null returning actor_id`,
        [sha256(secret)],
      );
      const actorId = rows[0]?.actor_id;
      if (actorId)
        await this.append(
          c,
          { actorId },
          {
            workspaceId: null,
            action: 'auth.session_ended',
            subjectKind: 'actor',
            subjectId: actorId,
            subjectVersion: null,
            contentHash: null,
            payload: {},
          },
        );
    });
  }
  async saveOidcLogin(state: string, verifier: string, nonce: string) {
    await this.pool.query(
      `insert into oidc_logins (state_hash, code_verifier, nonce, expires_at)
       values ($1, $2, $3, now() + interval '10 minutes')`,
      [sha256(state), verifier, nonce],
    );
  }
  /** Single use: a replayed or late callback finds nothing. */
  async takeOidcLogin(state: string) {
    const { rows } = await this.pool.query<{
      code_verifier: string;
      nonce: string;
    }>(
      `update oidc_logins set consumed_at = now()
       where state_hash = $1 and consumed_at is null and expires_at > now()
       returning code_verifier, nonce`,
      [sha256(state)],
    );
    return rows[0] ?? null;
  }

  /**
   * ADR-0075: the tester actor allow-listed for this verified (issuer, subject), if the account
   * is neither disabled nor expired. Anyone else is refused at sign-in.
   */
  async activeTester(issuer: string, subject: string): Promise<string | null> {
    const { rows } = await this.pool.query<{ actor_id: string }>(
      `select actor_id from tester_accounts
       where issuer = $1 and subject = $2 and disabled_at is null and expires_at > now()`,
      [issuer.replace(/\/+$/, ''), subject],
    );
    return rows[0]?.actor_id ?? null;
  }

  // ---- Runs -----------------------------------------------------------------------------

  protected async lockRun(c: PoolClient, ws: string, runId: string) {
    const { rows } = await c.query(
      'select * from run_controls where workspace_id = $1 and run_id = $2 for update',
      [ws, runId],
    );
    if (!rows[0])
      throw fail('NOT_FOUND', 'Run is not registered for oversight.');
    return toRun(rows[0] as Row);
  }

  async registerRun(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RegisterRunRequestSchema, raw);
    const runId = req.run.id.toLowerCase();
    return this.idempotent(ws, ctx, { op: 'run.register', req }, async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const entity = await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'run'`,
        [ws, runId],
      );
      const run = entity.rows[0] ? toEntity(entity.rows[0] as Row) : null;
      if (!run) throw fail('NOT_FOUND', 'Run record not found.');
      if (run.version !== req.run.version || run.status !== 'active')
        throw fail(
          'VERSION_CONFLICT',
          'Register the current, active run version.',
        );
      const condition = String(run.body?.experiment_condition);
      if (conditionFor(req.autonomy_mode) !== condition)
        throw fail(
          'INVALID_CONTRACT',
          `A ${condition.replaceAll('_', ' ')} run cannot use ${req.autonomy_mode.replaceAll('_', ' ')} mode.`,
        );
      if (
        req.autonomy_mode !== 'autonomous_within_scope' &&
        req.initial_grants.length
      )
        throw fail(
          'INVALID_CONTRACT',
          'Only autonomous runs take an initial grant packet; other modes use current grants.',
        );
      for (const g of req.initial_grants) {
        const { rows } = await c.query(
          `select version, status, scope, run_id from grants where workspace_id = $1 and id = $2`,
          [ws, g.id.toLowerCase()],
        );
        const row = rows[0] as Row | undefined;
        if (!row) throw fail('NOT_FOUND', 'Initial grant not found.');
        if (
          Number(row.version) !== g.version ||
          row.status !== 'active' ||
          row.run_id !== null
        )
          throw fail(
            'VERSION_CONFLICT',
            'Initial grants must be active, workspace-wide and at their current version.',
          );
      }
      const gates = req.stage_gates ?? DEFAULT_STAGE_GATES[req.autonomy_mode];
      const initial = req.initial_grants.map((g) => ({
        id: g.id.toLowerCase(),
        version: g.version,
      }));
      const { rows } = await c.query(
        `insert into run_controls (workspace_id, run_id, run_version, autonomy_mode,
           experiment_condition, policy_version, stage_gates, initial_grants, state, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9) returning *`,
        [
          ws,
          runId,
          run.version,
          req.autonomy_mode,
          condition,
          OVERSIGHT_POLICY_VERSION,
          [...new Set(gates)],
          JSON.stringify(initial),
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'run.registered',
        subjectKind: 'run',
        subjectId: runId,
        subjectVersion: run.version,
        contentHash: run.content_hash,
        payload: {
          autonomy_mode: req.autonomy_mode,
          stage_gates: [...new Set(gates)],
          initial_grants: initial,
        },
      });
      return toRun(rows[0] as Row);
    });
  }

  async listRuns(ctx: CommandContext, ws: string): Promise<RunControl[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from run_controls where workspace_id = $1 order by created_at desc, run_id desc',
        [ws],
      );
      return rows.map((r: Row) => toRun(r));
    });
  }

  /** Stop overrides pending approval: open decisions close and run-scoped grants are revoked. */
  async cancelRun(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(CancelRunRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const run = await this.lockRun(c, ws, runId);
      if (run.state === 'cancelled') return run;
      const { rows } = await c.query(
        `update run_controls set state = 'cancelled', cancelled_at = now(),
           cancelled_by = $3, cancel_reason = $4
         where workspace_id = $1 and run_id = $2 returning *`,
        [ws, runId, ctx.actorId, req.reason],
      );
      const closed = await c.query<{ id: string; version: number }>(
        `update decision_requests set status = 'cancelled', closed_reason = 'run_cancelled',
           version = version + 1
         where workspace_id = $1 and run_id = $2 and status = 'pending' returning id, version`,
        [ws, runId],
      );
      for (const d of closed.rows)
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'decision.closed',
          subjectKind: 'decision',
          subjectId: d.id,
          subjectVersion: d.version,
          contentHash: null,
          payload: { status: 'cancelled', reason: 'run_cancelled' },
          relatedIds: [runId],
        });
      const grants = await c.query(
        `select * from grants where workspace_id = $1 and run_id = $2 and status = 'active' for update`,
        [ws, runId],
      );
      for (const g of grants.rows)
        await this.writeGrant(c, ctx, toGrant(g as Row), 'grant.revoked', {
          status: 'revoked',
          revoke_reason: 'Run cancelled',
        });
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'run.cancelled',
        subjectKind: 'run',
        subjectId: runId,
        subjectVersion: null,
        contentHash: null,
        payload: { closed_decisions: closed.rowCount ?? 0 },
      });
      return toRun(rows[0] as Row);
    });
  }

  // ---- Grants ---------------------------------------------------------------------------

  protected async insertGrant(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    g: Omit<
      Grant,
      | 'id'
      | 'workspace_id'
      | 'version'
      | 'status'
      | 'created_by'
      | 'created_at'
      | 'revoked_at'
      | 'revoke_reason'
      | 'policy_version'
    >,
  ): Promise<Grant> {
    const { rows } = await c.query(
      `insert into grants (${GRANT_COLUMNS})
       values ($1, $2, 1, $3, 'active', $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)
       returning *`,
      [
        randomUUID(),
        ws,
        g.scope,
        g.run_id,
        g.action_types,
        g.target_kind,
        g.target === null ? null : JSON.stringify(g.target),
        g.spec_hash,
        g.max_amount_nano_usd,
        g.allow_irreversible,
        g.allow_external_effects,
        g.data_classes,
        g.expires_at,
        g.decision_id,
        OVERSIGHT_POLICY_VERSION,
        g.rationale,
        ctx.actorId,
      ],
    );
    const grant = toGrant(rows[0] as Row);
    await this.recordGrantVersion(c, ctx, grant, 'grant.created');
    return grant;
  }
  private async recordGrantVersion(
    c: PoolClient,
    ctx: CommandContext,
    grant: Grant,
    action: string,
  ) {
    const eventId = await this.append(c, ctx, {
      workspaceId: grant.workspace_id,
      action,
      subjectKind: 'grant',
      subjectId: grant.id,
      subjectVersion: grant.version,
      contentHash: canonicalHash(grant),
      payload: { scope: grant.scope, status: grant.status },
      relatedIds: [grant.run_id, grant.decision_id].filter(
        (v): v is string => v !== null,
      ),
    });
    await c.query(
      'insert into grant_versions (grant_id, version, snapshot, actor_id, event_id) values ($1, $2, $3, $4, $5)',
      [grant.id, grant.version, JSON.stringify(grant), ctx.actorId, eventId],
    );
  }
  private async writeGrant(
    c: PoolClient,
    ctx: CommandContext,
    current: Grant,
    action: 'grant.revised' | 'grant.revoked' | 'grant.consumed',
    change: Row,
  ): Promise<Grant> {
    const sets: string[] = [];
    const values: unknown[] = [current.id, current.version];
    for (const [k, v] of Object.entries(change)) {
      values.push(
        Array.isArray(v) || v === null || typeof v !== 'object'
          ? v
          : JSON.stringify(v),
      );
      sets.push(`${k} = $${values.length}`);
    }
    if (change.status === 'revoked') {
      values.push(ctx.actorId);
      sets.push('revoked_at = now()', `revoked_by = $${values.length}`);
    }
    if (change.status === 'consumed') sets.push('consumed_at = now()');
    const { rows } = await c.query(
      `update grants set version = version + 1, ${sets.join(', ')}
       where id = $1 and version = $2 returning *`,
      values,
    );
    if (!rows[0]) throw fail('VERSION_CONFLICT', 'Grant changed concurrently.');
    const grant = toGrant(rows[0] as Row);
    await this.recordGrantVersion(c, ctx, grant, action);
    return grant;
  }
  private async lockGrant(
    c: PoolClient,
    ws: string,
    grantId: string,
    expected: number,
  ) {
    const { rows } = await c.query(
      'select * from grants where workspace_id = $1 and id = $2 for update',
      [ws, grantId],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Grant not found.');
    const grant = toGrant(rows[0] as Row);
    if (grant.version !== expected)
      throw fail(
        'VERSION_CONFLICT',
        `Expected grant version ${expected}, but it is at ${grant.version}.`,
      );
    return grant;
  }
  private checkExpiry(expiresAt: string) {
    const ms = Date.parse(expiresAt) - Date.now();
    if (ms <= 0 || ms > 90 * 86_400_000)
      throw fail('INVALID_CONTRACT', 'A grant needs an expiry within 90 days.');
  }

  /** A standing grant is the versioned "auto-approve" setting; only an owner creates one. */
  async createStandingGrant(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateStandingGrantRequestSchema, raw);
    this.checkExpiry(req.expires_at);
    return this.idempotent(ws, ctx, { op: 'grant.create', req }, async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const runId = req.run_id?.toLowerCase() ?? null;
      if (runId) {
        const run = await this.lockRun(c, ws, runId);
        if (run.state !== 'active')
          throw fail('INVALID_TRANSITION', 'The run was cancelled.');
      }
      return this.insertGrant(c, ctx, ws, {
        scope: 'standing',
        run_id: runId,
        action_types: [...new Set(req.action_types)],
        target_kind: req.target_kind,
        target: null,
        spec_hash: null,
        max_amount_nano_usd: req.max_amount_nano_usd,
        allow_irreversible: req.allow_irreversible,
        allow_external_effects: req.allow_external_effects,
        data_classes: [...new Set(req.data_classes)],
        expires_at: new Date(req.expires_at).toISOString(),
        decision_id: null,
        rationale: req.rationale,
      });
    });
  }
  async reviseGrant(
    ctx: CommandContext,
    ws: string,
    grantId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    grantId = uuid(grantId);
    const req = parse(ReviseGrantRequestSchema, raw);
    this.checkExpiry(req.expires_at);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const g = await this.lockGrant(c, ws, grantId, req.expected_version);
      if (g.scope !== 'standing' || g.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          'Only active standing grants can be revised.',
        );
      return this.writeGrant(c, ctx, g, 'grant.revised', {
        action_types: [...new Set(req.action_types)],
        target_kind: req.target_kind,
        max_amount_nano_usd: req.max_amount_nano_usd,
        allow_irreversible: req.allow_irreversible,
        allow_external_effects: req.allow_external_effects,
        data_classes: [...new Set(req.data_classes)],
        expires_at: new Date(req.expires_at).toISOString(),
        rationale: req.rationale,
      });
    });
  }
  async revokeGrant(
    ctx: CommandContext,
    ws: string,
    grantId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    grantId = uuid(grantId);
    const req = parse(RevokeGrantRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const g = await this.lockGrant(c, ws, grantId, req.expected_version);
      if (g.status !== 'active')
        throw fail('INVALID_TRANSITION', `Grant is already ${g.status}.`);
      return this.writeGrant(c, ctx, g, 'grant.revoked', {
        status: 'revoked',
        revoke_reason: req.reason,
      });
    });
  }
  async listGrants(ctx: CommandContext, ws: string): Promise<Grant[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from grants where workspace_id = $1 order by created_at desc, id limit 500',
        [ws],
      );
      return rows.map((r: Row) => toGrant(r));
    });
  }

  // ---- Bindings and decisions -----------------------------------------------------------

  /** Binds an action to the current version and content hash of its target. */
  private async bind(
    c: PoolClient,
    ws: string,
    runId: string,
    req: ActionRequest,
  ): Promise<{ binding: Binding; stale: boolean }> {
    let target: Binding['target'] = null;
    let stale = false;
    if (req.target) {
      const { rows } = await c.query(
        'select * from entities where workspace_id = $1 and id = $2',
        [ws, req.target.id.toLowerCase()],
      );
      const e = rows[0] ? toEntity(rows[0] as Row) : null;
      if (!e) throw fail('NOT_FOUND', 'Action target not found.');
      stale = e.version !== req.target.version || e.status !== 'active';
      const version = await c.query<{ content_hash: string }>(
        'select content_hash from entity_versions where entity_id = $1 and version = $2',
        [e.id, req.target.version],
      );
      if (!version.rows[0])
        throw fail('NOT_FOUND', 'Target version not found.');
      target = {
        id: e.id,
        version: req.target.version,
        content_hash: version.rows[0].content_hash,
        kind: e.kind,
      };
    }
    return {
      binding: {
        action_type: req.action_type,
        run_id: runId,
        target,
        spec_hash: req.spec_hash,
        amount_nano_usd: req.amount_nano_usd,
        data_class: req.data_class,
      },
      stale,
    };
  }
  /** Is the bound target still exactly what the person would be approving? */
  private async bindingCurrent(c: PoolClient, binding: Binding | null) {
    if (!binding?.target) return true;
    const { rows } = await c.query(
      'select version, status, content_hash from entities where id = $1',
      [binding.target.id],
    );
    const r = rows[0] as Row | undefined;
    return (
      !!r &&
      Number(r.version) === binding.target.version &&
      r.status === 'active' &&
      r.content_hash === binding.target.content_hash
    );
  }
  private async toDecision(
    c: PoolClient,
    r: Row,
    run: RunControl,
  ): Promise<Decision> {
    const binding = (r.binding as Binding | null) ?? null;
    const req = r.request as Row;
    const kind = r.kind as DecisionKind;
    const current = await this.bindingCurrent(c, binding);
    const once = kind === 'authorization' ? binding : null;
    const standing =
      once && standingAllowed(once, run.stage_gates)
        ? standingDraft(once)
        : null;
    const response = (r.response as Row | null) ?? null;
    return {
      id: String(r.id),
      workspace_id: String(r.workspace_id),
      run_id: String(r.run_id),
      task_id: r.task_id === null ? null : String(r.task_id),
      version: Number(r.version),
      kind,
      reason: r.reason as HumanReason,
      status: r.status as Decision['status'],
      question: String(req.question),
      evidence_refs: req.evidence_refs as Decision['evidence_refs'],
      uncertainty: String(req.uncertainty),
      consequence_if_wrong: String(req.consequence_if_wrong),
      options: req.options as Decision['options'],
      recommendation: (req.recommendation as string | null) ?? null,
      recommendation_reason:
        (req.recommendation_reason as string | null) ?? null,
      blocked_work: req.blocked_work as string[],
      unblocked_work: req.unblocked_work as string[],
      binding,
      binding_hash: r.binding_hash === null ? null : String(r.binding_hash),
      expires_at: iso(r.expires_at),
      requested_by: String(r.requested_by),
      created_at: iso(r.created_at),
      response: response
        ? {
            choice: response.choice as NonNullable<
              Decision['response']
            >['choice'],
            option_id: (response.option_id as string | null) ?? null,
            rationale: String(response.rationale),
            responder_id: String(response.responder_id),
            responded_at: String(response.responded_at),
            time_spent_ms: (response.time_spent_ms as number | null) ?? null,
            interruption:
              (response.interruption as 'useful' | 'unnecessary' | null) ??
              null,
            grant_id: r.grant_id === null ? null : String(r.grant_id),
          }
        : null,
      closed_reason: r.closed_reason === null ? null : String(r.closed_reason),
      coverage: {
        once,
        standing,
        coverage_hash: coverageHash({
          decision_id: String(r.id),
          decision_version: Number(r.version),
          once,
          standing,
          current,
        }),
        current,
      },
    };
  }
  /** Closes pending requests past their expiry, with an audit event for each. */
  private async expireDue(c: PoolClient, ctx: CommandContext, ws: string) {
    const { rows } = await c.query<{
      id: string;
      version: number;
      run_id: string;
    }>(
      `update decision_requests set status = 'expired', closed_reason = 'expired', version = version + 1
       where workspace_id = $1 and status = 'pending' and expires_at <= now()
       returning id, version, run_id`,
      [ws],
    );
    for (const d of rows)
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'decision.closed',
        subjectKind: 'decision',
        subjectId: d.id,
        subjectVersion: d.version,
        contentHash: null,
        payload: { status: 'expired', reason: 'expired' },
        relatedIds: [d.run_id],
      });
  }
  private async insertDecision(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    run: RunControl,
    d: {
      kind: DecisionKind;
      reason: HumanReason;
      task_id: string | null;
      request: Row;
      binding: Binding | null;
      expires_at: string;
    },
  ): Promise<{ row: Row; created: boolean }> {
    const hash = d.binding ? bindingHash(d.binding) : null;
    const dedupe = canonicalHash({
      kind: d.kind,
      reason: d.reason,
      binding_hash: hash,
      question: d.request.question,
      options: d.request.options,
    });
    const existing = await c.query(
      `select * from decision_requests where workspace_id = $1 and run_id = $2
         and dedupe_key = $3 and status in ('pending', 'answered')
       order by created_at desc limit 1`,
      [ws, run.run_id, dedupe],
    );
    const prior = existing.rows[0] as Row | undefined;
    // A pending or negatively answered question is not asked again. An approval that no
    // longer covers (used up, revoked, expired) does not stand for the next action, so ask again.
    const approved = ['approve_once', 'approve_standing'].includes(
      String((prior?.response as Row | null)?.choice),
    );
    if (prior && (prior.status === 'pending' || !approved))
      return { row: prior, created: false };
    const id = randomUUID();
    const { rows } = await c.query(
      `insert into decision_requests (id, workspace_id, run_id, task_id, version, kind, reason,
         status, dedupe_key, request, binding, binding_hash, expires_at, requested_by)
       values ($1, $2, $3, $4, 1, $5, $6, 'pending', $7, $8, $9, $10, $11, $12) returning *`,
      [
        id,
        ws,
        run.run_id,
        d.task_id,
        d.kind,
        d.reason,
        dedupe,
        JSON.stringify(d.request),
        d.binding === null ? null : JSON.stringify(d.binding),
        hash,
        d.expires_at,
        ctx.actorId,
      ],
    );
    await this.append(c, ctx, {
      workspaceId: ws,
      action: 'decision.requested',
      subjectKind: 'decision',
      subjectId: id,
      subjectVersion: 1,
      contentHash: dedupe,
      payload: { kind: d.kind, reason: d.reason, binding_hash: hash },
      relatedIds: [
        run.run_id,
        ...(d.binding?.target ? [d.binding.target.id] : []),
      ],
    });
    return { row: rows[0] as Row, created: true };
  }

  /** Explicit request for human input. Autonomous runs cannot ask for task-specific help. */
  async requestDecision(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(CreateDecisionRequestSchema, raw);
    const ttl = Date.parse(req.expires_at) - Date.now();
    if (ttl <= 0 || ttl > 30 * 86_400_000)
      throw fail(
        'INVALID_CONTRACT',
        'A decision request needs an expiry within 30 days.',
      );
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const run = await this.lockRun(c, ws, runId);
      if (run.state !== 'active')
        throw fail('INVALID_TRANSITION', 'The run was cancelled.');
      if (run.autonomy_mode === 'autonomous_within_scope')
        throw fail(
          'SCOPE_EXCEEDED',
          'Autonomous runs cannot obtain task-specific human input; defer or stop instead.',
        );
      const bound = req.action
        ? await this.bind(c, ws, runId, req.action)
        : null;
      if (bound?.stale)
        throw fail(
          'VERSION_CONFLICT',
          'The action target is not at its current version.',
        );
      const { row } = await this.insertDecision(c, ctx, ws, run, {
        kind: req.kind,
        reason: req.reason,
        task_id: req.task_id,
        request: {
          question: req.question,
          evidence_refs: req.evidence_refs,
          uncertainty: req.uncertainty,
          consequence_if_wrong: req.consequence_if_wrong,
          options: req.options,
          recommendation: req.recommendation,
          recommendation_reason: req.recommendation_reason,
          blocked_work: req.blocked_work,
          unblocked_work: req.unblocked_work,
        },
        binding: bound?.binding ?? null,
        expires_at: new Date(req.expires_at).toISOString(),
      });
      return this.toDecision(c, row, run);
    });
  }

  async listDecisions(
    ctx: CommandContext,
    ws: string,
    filter: { status?: string; runId?: string } = {},
  ): Promise<Decision[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const runId = filter.runId === undefined ? null : uuid(filter.runId);
    return this.tx(async (c) => {
      const role = await this.role(c, ws, ctx.actorId, false);
      if (role !== 'viewer') await this.expireDue(c, ctx, ws);
      const { rows } = await c.query(
        `select * from decision_requests where workspace_id = $1
           and ($2::text is null or status = $2) and ($3::uuid is null or run_id = $3)
         order by created_at desc, id limit 200`,
        [ws, filter.status ?? null, runId],
      );
      const runs = new Map<string, RunControl>();
      const out: Decision[] = [];
      for (const r of rows as Row[]) {
        const id = String(r.run_id);
        if (!runs.has(id)) {
          const run = await c.query(
            'select * from run_controls where workspace_id = $1 and run_id = $2',
            [ws, id],
          );
          runs.set(id, toRun(run.rows[0] as Row));
        }
        out.push(await this.toDecision(c, r, runs.get(id)!));
      }
      return out;
    });
  }
  async getDecision(ctx: CommandContext, ws: string, decisionId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    decisionId = uuid(decisionId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from decision_requests where workspace_id = $1 and id = $2',
        [ws, decisionId],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Decision not found.');
      const run = await c.query(
        'select * from run_controls where workspace_id = $1 and run_id = $2',
        [ws, (rows[0] as Row).run_id],
      );
      return this.toDecision(c, rows[0] as Row, toRun(run.rows[0] as Row));
    });
  }

  /**
   * Records a person's answer. Repeating the identical answer returns the recorded result;
   * a different second answer is refused. Expired or superseded requests close instead.
   */
  async answerDecision(
    ctx: CommandContext,
    ws: string,
    decisionId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    decisionId = uuid(decisionId);
    const answer = parse(AnswerDecisionRequestSchema, raw);
    const answerHash = canonicalHash({
      actor: ctx.actorId,
      answer: { ...answer, time_spent_ms: null },
    });
    const result = await this.tx(async (c) => {
      const role: Role = await this.role(c, ws, ctx.actorId, true);
      const locked = await c.query(
        'select * from decision_requests where workspace_id = $1 and id = $2 for update',
        [ws, decisionId],
      );
      const row = locked.rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Decision not found.');
      const run = toRun(
        (
          await c.query(
            'select * from run_controls where workspace_id = $1 and run_id = $2',
            [ws, row.run_id],
          )
        ).rows[0] as Row,
      );
      if (row.status === 'answered') {
        if ((row.response as Row).answer_hash === answerHash)
          return { decision: await this.toDecision(c, row, run) };
        throw fail(
          'DUPLICATE',
          'This decision was already answered differently.',
        );
      }
      const decision = await this.toDecision(c, row, run);
      try {
        checkAnswer({
          kind: decision.kind,
          status: decision.status,
          expiresAt: decision.expires_at,
          runState: run.state,
          options: decision.options,
          coverageHash: decision.coverage.coverage_hash,
          coverageCurrent: decision.coverage.current,
          standingOffered: decision.coverage.standing !== null,
          responderKind: await this.actorKind(c, ctx.actorId),
          responderRole: role,
          now: Date.now(),
          answer,
        });
      } catch (error) {
        const close =
          error instanceof ContractError && decision.status === 'pending'
            ? error.code === 'EXPIRED'
              ? 'expired'
              : error.code === 'VERSION_CONFLICT' && !decision.coverage.current
                ? 'superseded'
                : null
            : null;
        if (!close) throw error;
        const closed = await c.query<{ version: number }>(
          `update decision_requests set status = $3, closed_reason = $4, version = version + 1
           where id = $1 and workspace_id = $2 returning version`,
          [
            decisionId,
            ws,
            close,
            close === 'expired' ? 'expired' : 'target_changed',
          ],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'decision.closed',
          subjectKind: 'decision',
          subjectId: decisionId,
          subjectVersion: closed.rows[0]?.version ?? null,
          contentHash: null,
          payload: { status: close, reason: close },
          relatedIds: [run.run_id],
        });
        return { error };
      }
      let grantId: string | null = null;
      const b = decision.binding;
      if (b && answer.choice === 'approve_once') {
        const g = await this.insertGrant(c, ctx, ws, {
          scope: 'once',
          run_id: b.run_id,
          action_types: [b.action_type],
          target_kind: b.target?.kind ?? null,
          target: b.target,
          spec_hash: b.spec_hash,
          max_amount_nano_usd: b.amount_nano_usd,
          allow_irreversible: !ACTION_REGISTRY[b.action_type].reversible,
          allow_external_effects:
            ACTION_REGISTRY[b.action_type].external_effect,
          data_classes: [b.data_class],
          expires_at: decision.expires_at,
          decision_id: decisionId,
          rationale: answer.rationale,
        });
        grantId = g.id;
      } else if (
        b &&
        answer.choice === 'approve_standing' &&
        decision.coverage.standing
      ) {
        const g = await this.insertGrant(c, ctx, ws, {
          scope: 'standing',
          ...decision.coverage.standing,
          target: null,
          spec_hash: null,
          expires_at: new Date(answer.standing_expires_at!).toISOString(),
          decision_id: decisionId,
          rationale: answer.rationale,
        });
        grantId = g.id;
      }
      const response = {
        choice: answer.choice,
        option_id: answer.option_id,
        rationale: answer.rationale,
        responder_id: ctx.actorId,
        responded_at: new Date().toISOString(),
        time_spent_ms: answer.time_spent_ms,
        interruption: answer.interruption,
        answer_hash: answerHash,
      };
      const { rows } = await c.query(
        `update decision_requests set status = 'answered', response = $3, answered_by = $4,
           answered_at = now(), grant_id = $5, version = version + 1
         where id = $1 and workspace_id = $2 returning *`,
        [decisionId, ws, JSON.stringify(response), ctx.actorId, grantId],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'decision.answered',
        subjectKind: 'decision',
        subjectId: decisionId,
        subjectVersion: Number((rows[0] as Row).version),
        contentHash: answerHash,
        payload: {
          choice: answer.choice,
          option_id: answer.option_id,
          grant_id: grantId,
        },
        relatedIds: [run.run_id, ...(grantId ? [grantId] : [])],
      });
      return { decision: await this.toDecision(c, rows[0] as Row, run) };
    });
    if ('error' in result) throw result.error;
    return result.decision;
  }

  // ---- Admission ------------------------------------------------------------------------

  /**
   * Evaluates one proposed action for a run just before its effect. The verdict, its policy
   * version and the exact binding are recorded; approve-once grants are consumed atomically.
   */
  async admitAction(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<Admission> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const req = parse(ActionRequestSchema, raw);
    return this.idempotent(ws, ctx, { op: 'admit', runId, req }, (c) =>
      this.admitIn(c, ctx, ws, runId, req),
    );
  }

  /** Admission inside the caller's transaction, so the broker can reserve atomically with it. */
  /**
   * Read-only dry run of a target-free admission: the verdict admitIn would reach from the
   * current grants, without consuming a grant, raising a decision or writing anything.
   */
  protected async wouldAdmit(
    c: PoolClient,
    ws: string,
    runId: string,
    req: ActionRequest,
  ) {
    const run = toRun(
      (
        await c.query(
          'select * from run_controls where workspace_id = $1 and run_id = $2',
          [ws, runId],
        )
      ).rows[0] ??
        (() => {
          throw fail('NOT_FOUND', 'Run is not registered for oversight.');
        })(),
    );
    const { binding } = await this.bind(c, ws, runId, req);
    const grants = (
      await c.query(
        `select * from grants where workspace_id = $1 and status = 'active'
           and (run_id is null or run_id = $2) order by scope, created_at`,
        [ws, runId],
      )
    ).rows.map((r: Row) => toGrant(r));
    return evaluateAction({
      mode: run.autonomy_mode,
      runState: run.state,
      stageGates: run.stage_gates,
      binding,
      grants,
      initialGrants: run.initial_grants,
      assumptions: [],
      humility: null,
      flags: [],
      resolvedReasons: [],
      now: Date.now(),
    });
  }

  protected async admitIn(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    runId: string,
    req: ActionRequest,
    /** What a person would be approving when there is no target record (e.g. a URL). */
    subjectLabel?: string,
    /** What approving covers, when more than the bound action itself (ADR-0054 builds). */
    approveConsequence?: string,
    /** Active grants this admission must not use (ADR-0054: one-time approvals of other builds). */
    excludeGrantIds?: ReadonlySet<string>,
  ): Promise<Admission> {
    {
      await this.role(c, ws, ctx.actorId, true);
      await this.expireDue(c, ctx, ws);
      const run = await this.lockRun(c, ws, runId);
      const { binding, stale } = await this.bind(c, ws, runId, req);
      await portfolioEffectFence(c, ws, runId, ctx.idempotencyKey);
      const hash = bindingHash(binding);
      const grants = (
        await c.query(
          `select * from grants where workspace_id = $1 and status = 'active'
             and (run_id is null or run_id = $2) order by scope, created_at for update`,
          [ws, runId],
        )
      ).rows
        .map((r: Row) => toGrant(r))
        .filter((g) => !excludeGrantIds?.has(g.id));
      const assumptions = [];
      for (const id of req.assumption_ids) {
        const { rows } = await c.query(
          `select * from entities where workspace_id = $1 and id = $2 and kind = 'assumption'`,
          [ws, id.toLowerCase()],
        );
        if (!rows[0]) throw fail('NOT_FOUND', 'Assumption not found.');
        const e = toEntity(rows[0] as Row);
        const body = parse(AssumptionBodySchema, e.body);
        if (body.run_id !== null && body.run_id !== runId)
          throw fail(
            'SCOPE_EXCEEDED',
            'That assumption belongs to another run.',
          );
        assumptions.push({ id: e.id, status: e.status, body });
      }
      let humility: HumilityVerdict | null = null;
      if (req.humility_review) {
        const { rows } = await c.query(
          `select * from entities where workspace_id = $1 and id = $2 and kind = 'humility_review'`,
          [ws, req.humility_review.id.toLowerCase()],
        );
        if (!rows[0]) throw fail('NOT_FOUND', 'Humility review not found.');
        const e = toEntity(rows[0] as Row);
        humility = humilityGate(
          {
            id: e.id,
            version: req.humility_review.version,
            status:
              e.version === req.humility_review.version
                ? e.status
                : 'superseded',
            body: e.body,
          },
          binding.target,
        );
      }
      const resolved = (
        await c.query<{ reason: HumanReason }>(
          `select reason from decision_requests where workspace_id = $1 and run_id = $2
             and binding_hash = $3 and status = 'answered' and kind <> 'authorization'
             and response->>'choice' = 'choose_option' and response->>'option_id' = 'proceed'`,
          [ws, runId, hash],
        )
      ).rows.map((r) => r.reason);
      let verdict = stale
        ? {
            verdict: 'deny' as const,
            outcome: 'denied' as const,
            reason_code: 'target_stale',
            reasons: [],
            explanation:
              'The action names a target version that is no longer current.',
            covered_by: null,
            provisional_assumptions: [],
            decision_kind: null,
            policy_version: OVERSIGHT_POLICY_VERSION,
          }
        : evaluateAction({
            mode: run.autonomy_mode,
            runState: run.state,
            stageGates: run.stage_gates,
            binding,
            grants,
            initialGrants: run.initial_grants,
            assumptions,
            humility,
            flags: req.flags.map((f) => f.reason),
            resolvedReasons: resolved,
            now: Date.now(),
          });
      const portfolioReason =
        run.state === 'active'
          ? await portfolioActionGate(c, ws, runId, req.action_type)
          : null;
      if (portfolioReason)
        verdict = {
          ...verdict,
          verdict: 'deny',
          outcome: 'denied',
          reason_code: portfolioReason,
          explanation: 'Portfolio admission refused: ' + portfolioReason,
          covered_by: null,
          decision_kind: null,
        };
      let outcome = { ...verdict };
      let decisionId: string | null = null;
      let coveredBy = verdict.covered_by;
      if (verdict.verdict === 'allow' && coveredBy?.scope === 'once')
        coveredBy = await this.writeGrant(c, ctx, coveredBy, 'grant.consumed', {
          status: 'consumed',
        });
      if (verdict.verdict === 'request_human' && verdict.decision_kind) {
        const first = verdict.reason_code as HumanReason;
        const s = ACTION_REGISTRY[binding.action_type];
        const authorization = verdict.decision_kind === 'authorization';
        const subject = binding.target
          ? `${binding.target.kind} v${binding.target.version}`
          : (subjectLabel?.slice(0, 300) ?? 'this run');
        const { row, created } = await this.insertDecision(c, ctx, ws, run, {
          kind: verdict.decision_kind,
          reason: first,
          task_id: req.task_id,
          binding,
          expires_at: new Date(Date.now() + DECISION_TTL_MS).toISOString(),
          request: {
            question: authorization
              ? `Allow ${binding.action_type} on ${subject}?`
              : `Proceed with ${binding.action_type} on ${subject} despite: ${first.replaceAll('_', ' ')}?`,
            evidence_refs: req.flags
              .flatMap((f) => f.evidence_refs)
              .slice(0, 30),
            uncertainty:
              req.flags
                .map((f) => f.note)
                .join(' ')
                .slice(0, 1200) ||
              (assumptions.length
                ? 'A referenced assumption is material or refuted.'
                : `No grant covers this ${s.reversible ? 'reversible' : 'irreversible'} action.`),
            consequence_if_wrong: s.external_effect
              ? 'An external effect that cannot be taken back.'
              : s.reversible
                ? 'Internal, reversible work may need redoing.'
                : 'An internal commitment that is hard to reverse.',
            options: authorization
              ? [
                  {
                    id: 'approve',
                    label: 'Approve',
                    consequence:
                      approveConsequence ?? 'The action may proceed as bound.',
                  },
                  {
                    id: 'reject',
                    label: 'Reject',
                    consequence: 'The action does not happen.',
                  },
                  {
                    id: 'defer',
                    label: 'Defer',
                    consequence: 'The work waits; nothing else changes.',
                  },
                ]
              : [
                  {
                    id: 'proceed',
                    label: 'Proceed',
                    consequence:
                      'This concern is accepted for this exact action.',
                  },
                  {
                    id: 'revise',
                    label: 'Revise',
                    consequence: 'The work is changed before asking again.',
                  },
                  {
                    id: 'defer',
                    label: 'Defer',
                    consequence: 'The work waits; nothing else changes.',
                  },
                ],
            recommendation: null,
            recommendation_reason: null,
            blocked_work: [`${binding.action_type} on ${subject}`],
            unblocked_work: ['Other covered work in this run'],
            justification: req.justification,
          },
        });
        decisionId = String(row.id);
        if (!created && row.status === 'answered') {
          // Already answered "no" (reject, defer, revise, request evidence): do not ask again.
          const choice = String((row.response as Row).choice);
          outcome = {
            ...verdict,
            verdict: choice === 'reject' ? 'deny' : 'defer',
            outcome: choice === 'reject' ? 'denied' : 'needs_human',
            reason_code: `already_answered_${choice}`,
            explanation: `A person already answered this exact question: ${choice.replaceAll('_', ' ')}.`,
          };
        }
      }
      const id = randomUUID();
      const { rows } = await c.query(
        `insert into action_admissions (id, workspace_id, run_id, binding, binding_hash, verdict,
           outcome, reason_code, reasons, explanation, policy_version, grant_id, grant_version,
           provisional_assumptions, decision_id, actor_id)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) returning *`,
        [
          id,
          ws,
          runId,
          JSON.stringify(binding),
          hash,
          outcome.verdict,
          outcome.outcome,
          outcome.reason_code,
          outcome.reasons,
          outcome.explanation,
          outcome.policy_version,
          outcome.verdict === 'allow' ? coveredBy!.id : null,
          outcome.verdict === 'allow' ? verdict.covered_by!.version : null,
          outcome.provisional_assumptions,
          decisionId,
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'action.evaluated',
        subjectKind: 'admission',
        subjectId: id,
        subjectVersion: null,
        contentHash: hash,
        payload: {
          action_type: binding.action_type,
          verdict: outcome.verdict,
          reason_code: outcome.reason_code,
          policy_version: outcome.policy_version,
        },
        relatedIds: [
          runId,
          ...(binding.target ? [binding.target.id] : []),
          ...(decisionId ? [decisionId] : []),
        ],
      });
      return toAdmission(rows[0] as Row);
    }
  }

  async listAdmissions(
    ctx: CommandContext,
    ws: string,
    runId: string,
  ): Promise<Admission[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from action_admissions where workspace_id = $1 and run_id = $2
         order by created_at desc, id limit 200`,
        [ws, runId],
      );
      return rows.map((r: Row) => toAdmission(r));
    });
  }

  /** Evaluates the humility gate for a stored review against its subject's current version. */
  async humilityVerdict(ctx: CommandContext, ws: string, reviewId: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    reviewId = uuid(reviewId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from entities where workspace_id = $1 and id = $2 and kind = 'humility_review'`,
        [ws, reviewId],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Humility review not found.');
      const e = toEntity(rows[0] as Row);
      if (e.status === 'redacted')
        throw fail('NOT_FOUND', 'Humility review was redacted.');
      const subjectId = String((e.body?.subject as Row).id);
      const subject = await c.query(
        'select version from entities where workspace_id = $1 and id = $2',
        [ws, subjectId],
      );
      if (!subject.rows[0])
        throw fail('NOT_FOUND', 'Reviewed subject not found.');
      return humilityGate(
        { id: e.id, version: e.version, status: e.status, body: e.body },
        { id: subjectId, version: Number((subject.rows[0] as Row).version) },
      );
    });
  }
}
