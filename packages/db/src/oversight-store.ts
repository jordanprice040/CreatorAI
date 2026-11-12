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
  ROUTINE_POLICY_VERSION,
  ROUTINE_STAGE_ACTIONS,
  RoutinePolicyRequestSchema,
  ReviseRoutinePolicyRequestSchema,
  RevokeRoutinePolicyRequestSchema,
  routinePolicySummary,
  routinePolicyWidens,
  type RoutinePolicy,
  type RoutinePolicyInput,
  type RoutinePolicyView,
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
  type HumilitySubjectKind,
  standingAllowed,
  standingDraft,
  type HumilityVerdict,
} from '@creator/domain';
import { routineStopReason } from './routine-stops.js';
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
export function toRoutinePolicy(r: Row): RoutinePolicy {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    run_id: String(r.run_id),
    version: Number(r.version),
    status: r.status as RoutinePolicy['status'],
    grant_id: String(r.grant_id),
    grant_version: Number(r.grant_version),
    stages: r.stages as RoutinePolicy['stages'],
    data_classes: r.data_classes as RoutinePolicy['data_classes'],
    max_actions: Number(r.max_actions),
    max_total_nano_usd:
      r.max_total_nano_usd === null ? null : String(r.max_total_nano_usd),
    stop_on: r.stop_on as RoutinePolicy['stop_on'],
    expires_at: iso(r.expires_at),
    rationale: String(r.rationale),
    summary: r.summary as string[],
    policy_version: String(r.policy_version),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    confirmed_at: iso(r.confirmed_at),
    revoked_at: nullableIso(r.revoked_at),
    revoke_reason: r.revoke_reason === null ? null : String(r.revoke_reason),
  };
}
const policyInput = (p: RoutinePolicy): RoutinePolicyInput => ({
  stages: p.stages,
  data_classes: p.data_classes,
  max_actions: p.max_actions,
  max_total_nano_usd: p.max_total_nano_usd,
  stop_on: p.stop_on,
  expires_at: p.expires_at,
  rationale: p.rationale,
});
const GRANT_COLUMNS = `id, workspace_id, version, scope, status, run_id, action_types,
  target_kind, target, spec_hash, max_amount_nano_usd, allow_irreversible,
  allow_external_effects, data_classes, expires_at, decision_id, policy_version,
  rationale, created_by`;

/**
 * Sessions, runs under oversight, grants, decision requests and action admission.
 * Every change commits with its audit event and outbox row, as in the record store.
 */
export class OversightStore extends Store {
  protected async actorKind(c: PoolClient, actorId: string) {
    const { rows } = await c.query<{ kind: 'human' | 'agent' | 'system' }>(
      'select kind from actors where id = $1',
      [actorId],
    );
    if (!rows[0]) throw fail('ACCESS_DENIED', 'Unknown actor.');
    return rows[0].kind;
  }
  /** Policy changes (grants, run registration, cancellation) are owner actions by a person. */
  protected async requireOwner(
    c: PoolClient,
    ws: string,
    actorId: string,
    refusal = 'Only a workspace owner, signed in as a person, can change oversight policy.',
  ) {
    await this.role(c, ws, actorId, true);
    if (!(await this.isPolicyOwner(c, ws, actorId)))
      throw fail('ACCESS_DENIED', refusal);
  }

  /**
   * Whether `requireOwner` would let this actor through, without throwing: the owner role,
   * signed in as a person, and not a tester account (ADR-0075). Pages use it to offer only the
   * owner actions the server will accept (ADR-0094 review L-1).
   */
  protected async isPolicyOwner(
    c: PoolClient,
    ws: string,
    actorId: string,
  ): Promise<boolean> {
    const role = await this.role(c, ws, actorId, false);
    // ADR-0075: tester accounts are never workspace owners for policy purposes.
    return (
      role === 'owner' &&
      (await this.actorKind(c, actorId)) === 'human' &&
      !(await this.isTester(c, actorId))
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
         values ($1, $2, $3, $4, $5, least(now() + make_interval(hours => $6),
           (select expires_at from tester_accounts where actor_id = $2)))
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
      const routine = req.routine_policy
        ? this.checkRoutineInput(req.routine_policy)
        : null;
      if (routine)
        this.checkRoutineRun(req.autonomy_mode, run.body?.config_hash ?? null);
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
          routine_policy: routine !== null,
        },
      });
      if (routine) await this.insertRoutinePolicy(c, ctx, ws, runId, routine);
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
      // ADR-0098: lock order is run, decision, routine policy, grant, and every row lock is
      // taken before the first audit append; a revoke waiting on the audit lock while holding
      // the grant would otherwise deadlock with this cancel.
      await c.query(
        `select 1 from routine_policies where workspace_id = $1 and run_id = $2
           and status = 'active' order by id for update`,
        [ws, runId],
      );
      const grants = await c.query(
        `select * from grants where workspace_id = $1 and run_id = $2 and status = 'active'
          order by id for update`,
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
    // ADR-0079: however a policy's grant is revoked (the policy, the grant list, a stopped
    // run), the policy is recorded as revoked with it. ADR-0098: the policy row is written
    // before the audit append, and callers lock it before the grant (lockGrantForWrite).
    let policy: RoutinePolicy | null = null;
    if (action === 'grant.revoked') {
      const revoked = await c.query(
        `update routine_policies set status = 'revoked', version = version + 1,
           grant_version = $2, revoked_at = clock_timestamp(), revoke_reason = $3
         where grant_id = $1 and status = 'active' returning *`,
        [
          grant.id,
          grant.version,
          String(change.revoke_reason ?? 'Revoked').slice(0, 500),
        ],
      );
      if (revoked.rows[0]) policy = toRoutinePolicy(revoked.rows[0] as Row);
    }
    await this.recordGrantVersion(c, ctx, grant, action);
    if (policy) await this.recordRoutineVersion(c, ctx, policy, 'revoked');
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
  /**
   * ADR-0098: locks a grant for a direct change in the oversight lock order: its run (which
   * cancels and admissions hold first), then its routine policy, then the grant itself.
   */
  private async lockGrantForWrite(
    c: PoolClient,
    ws: string,
    grantId: string,
    expected: number,
  ) {
    const { rows } = await c.query(
      'select run_id from grants where workspace_id = $1 and id = $2',
      [ws, grantId],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Grant not found.');
    if (rows[0].run_id) await this.lockRun(c, ws, String(rows[0].run_id));
    await c.query(
      'select 1 from routine_policies where grant_id = $1 for update',
      [grantId],
    );
    return this.lockGrant(c, ws, grantId, expected);
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
      const g = await this.lockGrantForWrite(
        c,
        ws,
        grantId,
        req.expected_version,
      );
      if (g.scope !== 'standing' || g.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          'Only active standing grants can be revised.',
        );
      if (
        (
          await c.query('select 1 from routine_policies where grant_id = $1', [
            g.id,
          ])
        ).rowCount
      )
        throw fail(
          'INVALID_TRANSITION',
          'This grant belongs to a routine approval policy. Change the policy instead, so its summary is confirmed again.',
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
      const g = await this.lockGrantForWrite(
        c,
        ws,
        grantId,
        req.expected_version,
      );
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

  // ---- Routine approval policies (ADR-0079) ---------------------------------------------

  /** Which runs may have routine approvals at all, at setup or later. */
  private checkRoutineRun(mode: AutonomyMode, configHash: unknown) {
    if (mode !== 'supervised' && mode !== 'human_in_loop')
      throw fail(
        'INVALID_CONTRACT',
        'Routine approvals are for supervised and human-in-the-loop runs. An autonomous run has only its initial grants, and a human-only run makes every decision by hand.',
      );
    // A run configured by a study keeps its frozen condition exactly.
    if (configHash !== null)
      throw fail(
        'INVALID_CONTRACT',
        'A study run keeps its frozen conditions; routine approvals cannot be added to it.',
      );
  }
  /**
   * Turns routine approvals on for a run that is already going (owner decision, November 10):
   * a run set up without a policy, or one whose policy was revoked. It is the same owner
   * action as at setup, with the summary confirmed; the run's mode, condition and stage gates
   * do not change. A run with an active policy is changed through its revisions instead.
   */
  async setRoutinePolicy(
    ctx: CommandContext,
    ws: string,
    runId: string,
    raw: unknown,
  ): Promise<RoutinePolicy> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const input = this.checkRoutineInput(
      parse(RoutinePolicyRequestSchema, raw),
    );
    return this.idempotent(
      ws,
      ctx,
      { op: 'routine_policy.set', runId, input },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        const run = await this.lockRun(c, ws, runId);
        if (run.state !== 'active')
          throw fail('INVALID_TRANSITION', 'The run was cancelled.');
        // Review M-1: the run record can be revised by any editor, so "is this a study run"
        // is read from records nobody can change: a study attempt for the run, or the
        // config hash of the run version that was registered. The current record counts too.
        const study = await c.query(
          `select (select v.body->>'config_hash' from run_controls r
                     join entity_versions v
                       on v.entity_id = r.run_id and v.version = r.run_version
                    where r.workspace_id = $1 and r.run_id = $2) as registered,
                  (select body->>'config_hash' from entities
                    where workspace_id = $1 and id = $2 and kind = 'run') as current,
                  exists (select 1 from study_attempts
                           where workspace_id = $1 and run_id = $2) as attempt`,
          [ws, runId],
        );
        const sr = study.rows[0] as Row;
        this.checkRoutineRun(
          run.autonomy_mode,
          sr.attempt ? 'study_attempt' : (sr.registered ?? sr.current ?? null),
        );
        const active = await c.query(
          `select 1 from routine_policies where workspace_id = $1 and run_id = $2
             and status = 'active'`,
          [ws, runId],
        );
        if (active.rowCount)
          throw fail(
            'INVALID_TRANSITION',
            'This run already has routine approvals. Change that policy instead.',
          );
        return this.insertRoutinePolicy(c, ctx, ws, runId, input);
      },
    );
  }
  /** Normalises the chosen values and refuses a summary that is not the one they produce. */
  private checkRoutineInput(
    req: RoutinePolicyInput & { summary_seen: string[] },
  ): RoutinePolicyInput {
    const { summary_seen, ...rest } = req;
    const ms = Date.parse(rest.expires_at) - Date.now();
    if (ms <= 0 || ms > 90 * 86_400_000)
      throw fail(
        'INVALID_CONTRACT',
        'Routine approvals need an end time within 90 days.',
      );
    const input: RoutinePolicyInput = {
      ...rest,
      stages: [...rest.stages].sort(),
      data_classes: [...rest.data_classes].sort(),
      stop_on: [...rest.stop_on].sort(),
      expires_at: new Date(rest.expires_at).toISOString(),
    };
    const summary = routinePolicySummary(input);
    if (
      summary.length !== summary_seen.length ||
      summary.some((line, i) => line !== summary_seen[i])
    )
      throw fail(
        'VERSION_CONFLICT',
        'The summary you confirmed does not match these settings. Review the summary again.',
      );
    return input;
  }
  /** The fields of the one grant a policy owns. External effects are never allowed. */
  private routineGrantFields(p: RoutinePolicyInput) {
    return {
      action_types: [
        ...new Set(p.stages.flatMap((s) => ROUTINE_STAGE_ACTIONS[s])),
      ],
      target_kind: null,
      max_amount_nano_usd: p.max_total_nano_usd,
      allow_irreversible: p.stages.includes('spec_freeze'),
      allow_external_effects: false,
      data_classes: p.data_classes,
      expires_at: p.expires_at,
      rationale: `Routine approval policy: ${p.rationale}`.slice(0, 1200),
    };
  }
  private async recordRoutineVersion(
    c: PoolClient,
    ctx: CommandContext,
    policy: RoutinePolicy,
    change: 'created' | 'widened' | 'narrowed' | 'reconfirmed' | 'revoked',
  ) {
    const eventId = await this.append(c, ctx, {
      workspaceId: policy.workspace_id,
      action: `routine_policy.${change === 'created' || change === 'revoked' ? change : 'revised'}`,
      subjectKind: 'routine_policy',
      subjectId: policy.id,
      subjectVersion: policy.version,
      contentHash: canonicalHash(policy),
      payload: {
        change,
        stages: policy.stages,
        max_actions: policy.max_actions,
        max_total_nano_usd: policy.max_total_nano_usd,
        expires_at: policy.expires_at,
        grant_version: policy.grant_version,
      },
      relatedIds: [policy.run_id, policy.grant_id],
    });
    await c.query(
      `insert into routine_policy_versions (policy_id, version, snapshot, change, actor_id,
         event_id) values ($1, $2, $3, $4, $5, $6)`,
      [
        policy.id,
        policy.version,
        JSON.stringify(policy),
        change,
        ctx.actorId,
        eventId,
      ],
    );
  }
  private async insertRoutinePolicy(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    runId: string,
    input: RoutinePolicyInput,
  ) {
    const grant = await this.insertGrant(c, ctx, ws, {
      scope: 'standing',
      run_id: runId,
      target: null,
      spec_hash: null,
      decision_id: null,
      ...this.routineGrantFields(input),
    });
    const { rows } = await c.query(
      `insert into routine_policies (id, workspace_id, run_id, version, status, grant_id,
         grant_version, stages, data_classes, max_actions, max_total_nano_usd, stop_on,
         expires_at, rationale, summary, policy_version, created_by)
       values ($1,$2,$3,1,'active',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) returning *`,
      [
        randomUUID(),
        ws,
        runId,
        grant.id,
        grant.version,
        input.stages,
        input.data_classes,
        input.max_actions,
        input.max_total_nano_usd,
        input.stop_on,
        input.expires_at,
        input.rationale,
        routinePolicySummary(input),
        ROUTINE_POLICY_VERSION,
        ctx.actorId,
      ],
    );
    const policy = toRoutinePolicy(rows[0] as Row);
    await this.recordRoutineVersion(c, ctx, policy, 'created');
    return policy;
  }
  /** What a policy's grant has admitted so far: steps, and the sum of their stated amounts. */
  private async routineUsage(c: PoolClient, grantId: string) {
    const { rows } = await c.query<{ n: string; total: string }>(
      `select count(*)::text as n,
              coalesce(sum((binding->>'amount_nano_usd')::numeric), 0)::text as total
         from action_admissions where grant_id = $1 and verdict = 'allow'`,
      [grantId],
    );
    return { actions: Number(rows[0]!.n), nano: BigInt(rows[0]!.total) };
  }
  /**
   * Why an active policy admits nothing more now (null: it can admit). The amount is the
   * step being admitted, or null when only the policy's own state is asked about.
   */
  private async routineBlocked(
    c: PoolClient,
    p: RoutinePolicy,
    amount: string | null,
  ): Promise<string | null> {
    const used = await this.routineUsage(c, p.grant_id);
    if (used.actions >= p.max_actions)
      return `Its limit of ${p.max_actions} step${p.max_actions === 1 ? '' : 's'} is used up.`;
    if (
      amount !== null &&
      p.max_total_nano_usd !== null &&
      used.nano + BigInt(amount) > BigInt(p.max_total_nano_usd)
    )
      return `This step would take its admitted amounts past the policy's total of ${p.max_total_nano_usd} nano-USD.`;
    return routineStopReason(c, p);
  }
  /**
   * The run's policy for admission: its grant (left out of ordinary grant matching) and why
   * it cannot admit this step now. Null when the run has no active policy.
   */
  private async routineFor(
    c: PoolClient,
    ws: string,
    runId: string,
    grants: readonly Grant[],
    amount: string | null,
  ) {
    const { rows } = await c.query(
      `select * from routine_policies where workspace_id = $1 and run_id = $2
         and status = 'active'`,
      [ws, runId],
    );
    if (!rows[0]) return null;
    const policy = toRoutinePolicy(rows[0] as Row);
    const grant = grants.find((g) => g.id === policy.grant_id);
    // The grant must be exactly the one this policy version recorded.
    if (!grant || grant.version !== policy.grant_version) return null;
    return {
      policy,
      grant,
      blocked: await this.routineBlocked(c, policy, amount),
    };
  }
  private async lockRoutinePolicy(
    c: PoolClient,
    ws: string,
    policyId: string,
    expected: number,
  ) {
    const found = await c.query(
      'select run_id from routine_policies where workspace_id = $1 and id = $2',
      [ws, policyId],
    );
    if (!found.rows[0])
      throw fail('NOT_FOUND', 'Routine approval policy not found.');
    // The run lock is what admissions take, so a change never interleaves with one.
    const run = await this.lockRun(c, ws, String(found.rows[0].run_id));
    const { rows } = await c.query(
      'select * from routine_policies where id = $1 for update',
      [policyId],
    );
    const policy = toRoutinePolicy(rows[0] as Row);
    if (policy.version !== expected)
      throw fail(
        'VERSION_CONFLICT',
        `Expected policy version ${expected}, but it is at ${policy.version}.`,
      );
    if (policy.status !== 'active')
      throw fail(
        'INVALID_TRANSITION',
        'This routine approval policy was revoked. Turn routine approvals on again for the run to set a new one.',
      );
    return { run, policy };
  }
  /**
   * Changes a policy. Any change is an owner action that confirms the new summary; one that
   * permits more is recorded as widened. Builds approved under the earlier version stop at
   * their next request, because the grant behind them changed.
   */
  async reviseRoutinePolicy(
    ctx: CommandContext,
    ws: string,
    policyId: string,
    raw: unknown,
  ): Promise<RoutinePolicy> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    policyId = uuid(policyId);
    const { expected_version, ...rest } = parse(
      ReviseRoutinePolicyRequestSchema,
      raw,
    );
    const input = this.checkRoutineInput(rest);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const { run, policy } = await this.lockRoutinePolicy(
        c,
        ws,
        policyId,
        expected_version,
      );
      if (run.state !== 'active')
        throw fail('INVALID_TRANSITION', 'The run was cancelled.');
      const grant = await this.lockGrant(
        c,
        ws,
        policy.grant_id,
        policy.grant_version,
      );
      const next = await this.writeGrant(
        c,
        ctx,
        grant,
        'grant.revised',
        this.routineGrantFields(input),
      );
      const { rows } = await c.query(
        `update routine_policies set version = version + 1, grant_version = $2, stages = $3,
           data_classes = $4, max_actions = $5, max_total_nano_usd = $6, stop_on = $7,
           expires_at = $8, rationale = $9, summary = $10, confirmed_at = clock_timestamp()
         where id = $1 returning *`,
        [
          policy.id,
          next.version,
          input.stages,
          input.data_classes,
          input.max_actions,
          input.max_total_nano_usd,
          input.stop_on,
          input.expires_at,
          input.rationale,
          routinePolicySummary(input),
        ],
      );
      const revised = toRoutinePolicy(rows[0] as Row);
      const prev = policyInput(policy);
      await this.recordRoutineVersion(
        c,
        ctx,
        revised,
        routinePolicyWidens(prev, input)
          ? 'widened'
          : canonicalHash({ ...prev, rationale: '' }) ===
              canonicalHash({ ...input, rationale: '' })
            ? 'reconfirmed'
            : 'narrowed',
      );
      return revised;
    });
  }
  async revokeRoutinePolicy(
    ctx: CommandContext,
    ws: string,
    policyId: string,
    raw: unknown,
  ): Promise<RoutinePolicy> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    policyId = uuid(policyId);
    const req = parse(RevokeRoutinePolicyRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const { policy } = await this.lockRoutinePolicy(
        c,
        ws,
        policyId,
        req.expected_version,
      );
      const grant = await this.lockGrant(
        c,
        ws,
        policy.grant_id,
        policy.grant_version,
      );
      await this.writeGrant(c, ctx, grant, 'grant.revoked', {
        status: 'revoked',
        revoke_reason: req.reason,
      });
      const { rows } = await c.query(
        'select * from routine_policies where id = $1',
        [policy.id],
      );
      return toRoutinePolicy(rows[0] as Row);
    });
  }
  /** Every routine policy in the workspace, with what it admitted and whether it admits now. */
  async listRoutinePolicies(
    ctx: CommandContext,
    ws: string,
  ): Promise<RoutinePolicyView[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from routine_policies where workspace_id = $1
          order by created_at desc, id limit 200`,
        [ws],
      );
      const out: RoutinePolicyView[] = [];
      for (const r of rows) {
        const policy = toRoutinePolicy(r as Row);
        const used = await this.routineUsage(c, policy.grant_id);
        const recent = await c.query(
          `select id, binding->>'action_type' as action_type, grant_version, created_at
             from action_admissions where grant_id = $1 and verdict = 'allow'
            order by created_at desc, id limit 20`,
          [policy.grant_id],
        );
        const blocked =
          policy.status === 'active'
            ? await this.routineBlocked(c, policy, null)
            : null;
        const expired = Date.parse(policy.expires_at) <= Date.now();
        out.push({
          policy,
          used_actions: used.actions,
          used_nano_usd: used.nano.toString(),
          state:
            policy.status === 'revoked'
              ? 'revoked'
              : expired
                ? 'expired'
                : blocked
                  ? 'paused'
                  : 'active',
          state_reason:
            policy.status === 'revoked'
              ? (policy.revoke_reason ?? 'Revoked.')
              : expired
                ? 'Its end time has passed. Change the policy to set a new one.'
                : blocked,
          recent: recent.rows.map((a: Row) => ({
            admission_id: String(a.id),
            action_type: a.action_type as ActionType,
            policy_grant_version: Number(a.grant_version),
            created_at: iso(a.created_at),
          })),
        });
      }
      return out;
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
      // ADR-0098: the run is locked before the decision, as a cancel does. An approval's
      // grant references the run, so holding the decision and then waiting on the run
      // deadlocked with a cancel that held the run and waited on the decision.
      const owning = await c.query(
        'select run_id from decision_requests where workspace_id = $1 and id = $2',
        [ws, decisionId],
      );
      if (!owning.rows[0]) throw fail('NOT_FOUND', 'Decision not found.');
      const run = await this.lockRun(c, ws, String(owning.rows[0].run_id));
      const locked = await c.query(
        'select * from decision_requests where workspace_id = $1 and id = $2 for update',
        [ws, decisionId],
      );
      const row = locked.rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Decision not found.');
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

  /** Grants as ordinary admission may match them: every routine policy's own grant left out. */
  private async withoutRoutineGrants(
    c: PoolClient,
    ws: string,
    grants: readonly Grant[],
  ) {
    const owned = new Set(
      (
        await c.query<{ grant_id: string }>(
          'select grant_id from routine_policies where workspace_id = $1',
          [ws],
        )
      ).rows.map((r) => String(r.grant_id)),
    );
    return grants.filter((g) => !owned.has(g.id));
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
    const all = (
      await c.query(
        `select * from grants where workspace_id = $1 and status = 'active'
           and (run_id is null or run_id = $2) order by scope, created_at`,
        [ws, runId],
      )
    ).rows.map((r: Row) => toGrant(r));
    const routine = await this.routineFor(
      c,
      ws,
      runId,
      all,
      binding.amount_nano_usd,
    );
    const grants = await this.withoutRoutineGrants(c, ws, all);
    return evaluateAction({
      routine,
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

  /**
   * ADR-0098: the grants an admission in this run may use, locked. A caller that will append to
   * the audit log before it admits (several claims in one transaction, say) calls this first,
   * after the run lock, so no admission waits on a grant while holding the audit lock.
   */
  protected async lockAdmissionGrants(
    c: PoolClient,
    ws: string,
    runId: string,
  ) {
    const { rows } = await c.query(
      `select * from grants where workspace_id = $1 and status = 'active'
         and (run_id is null or run_id = $2) order by scope, created_at, id for update`,
      [ws, runId],
    );
    return rows.map((r: Row) => toGrant(r));
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
      // ADR-0098: the run and the grants are locked before expiring decisions, which locks
      // decision rows and appends. A cancel holds the run and then waits on its decisions, and
      // a revoke holds its grant and then waits for the audit lock.
      const run = await this.lockRun(c, ws, runId);
      const allGrants = await this.lockAdmissionGrants(c, ws, runId);
      await this.expireDue(c, ctx, ws);
      const { binding, stale } = await this.bind(c, ws, runId, req);
      await portfolioEffectFence(c, ws, runId, ctx.idempotencyKey);
      const hash = bindingHash(binding);
      // ADR-0079: a policy's grant is never matched as an ordinary grant; only the policy
      // path below may use it, with the policy's limits and stop conditions.
      const routine = await this.routineFor(
        c,
        ws,
        runId,
        allGrants,
        binding.amount_nano_usd,
      );
      const grants = (await this.withoutRoutineGrants(c, ws, allGrants)).filter(
        (g) => !excludeGrantIds?.has(g.id),
      );
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
          binding.target
            ? await this.humilitySubjectKind(c, ws, binding.target.id)
            : 'software',
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
            routine,
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
                : `No grant covers this ${s.reversible ? 'reversible' : 'irreversible'} action.${
                    'routine_note' in verdict && verdict.routine_note
                      ? ` Routine approvals did not cover it: ${verdict.routine_note}`
                      : ''
                  }`),
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
          ...(outcome.verdict === 'allow' &&
          routine &&
          coveredBy?.id === routine.grant.id
            ? {
                routine_policy: {
                  id: routine.policy.id,
                  version: routine.policy.version,
                },
              }
            : {}),
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
        await this.humilitySubjectKind(c, ws, subjectId),
      );
    });
  }

  /**
   * ADR-0077 (pilot F9): a hybrid option, or a spec written from one, is a hybrid subject; the
   * humility gate then reads the hybrid comparison. Anything else is judged as software-only.
   */
  protected async humilitySubjectKind(
    c: PoolClient,
    ws: string,
    subjectId: string,
  ): Promise<HumilitySubjectKind> {
    const { rows } = await c.query<{ kind: string; body: Row | null }>(
      'select kind, body from entities where workspace_id = $1 and id = $2',
      [ws, subjectId.toLowerCase()],
    );
    const e = rows[0];
    if (!e?.body) return 'software';
    if (e.kind === 'alternative')
      return e.body.kind === 'hybrid' ? 'hybrid' : 'software';
    // A spec is judged by the option version it was written from (review L-6), not by
    // whatever that option says now.
    const alt = e.body.alternative as Row | undefined;
    if (
      e.kind === 'specification' &&
      typeof alt?.id === 'string' &&
      Number.isInteger(alt.version)
    ) {
      const v = await c.query<{ body: Row | null }>(
        `select v.body from entity_versions v join entities a on a.id = v.entity_id
          where a.workspace_id = $1 and a.kind = 'alternative' and v.entity_id = $2
            and v.version = $3`,
        [ws, alt.id.toLowerCase(), alt.version],
      );
      return v.rows[0]?.body?.kind === 'hybrid' ? 'hybrid' : 'software';
    }
    return 'software';
  }
}
