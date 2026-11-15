import { randomUUID } from 'node:crypto';
import { portfolioEnvelopeGate } from './portfolio-gates.js';
import {
  ceilingRefusal,
  currentCeiling,
  lockRuntimeCeiling,
  readSpendingConfig,
  runtimeExposure,
  currentSpendLimits,
  spendLimitRefusal,
  SPENDING_WAIT_EXPLANATION,
  spendingManagerId,
} from './runtime-ceiling.js';
import type { Pool, PoolClient } from 'pg';
import {
  BUDGET_POLICY_VERSION,
  CloseEnvelopeRequestSchema,
  ContractError,
  CreateEnvelopeRequestSchema,
  PricingSnapshotBodySchema,
  ReconcileRequestSchema,
  RuntimeCeilingSchema,
  SetRuntimeCeilingRequestSchema,
  SetSpendLimitsRequestSchema,
  SpendLimitsViewSchema,
  UsageSchema,
  parse,
  type Admission,
  type BrokerCallRequest,
  type Envelope,
  type Exposure,
  type MeteredAction,
  type PricingSnapshot,
  type Provider,
  type Reservation,
  type RuntimeCeiling,
  type SpendLimits,
  type SpendLimitsView,
  type Usage,
} from '@creator/contracts';
import {
  availableOf,
  canonicalHash,
  maxExposure,
  usageCost,
} from '@creator/domain';
import { OversightStore } from './oversight-store.js';
import {
  checkPageStart,
  newestOrder,
  olderThan,
  readPage,
  type PageRequest,
} from './paging.js';
import {
  fail,
  iso,
  normalize,
  uuid,
  type CommandContext,
  type Row,
} from './store.js';

const nullableIso = (v: unknown) => (v === null ? null : iso(v));
const n = (v: unknown) => (v === null || v === undefined ? '0' : String(v));
/** How long past its timeout an in-flight attempt may stay unreported before it is unknown. */
export const LATE_RESULT_WINDOW_MS = 10 * 60_000;

export function toPricing(r: Row): PricingSnapshot {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    fixture: Boolean(r.fixture),
    snapshot_hash: String(r.snapshot_hash),
    body: r.body as PricingSnapshot['body'],
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
  };
}
function toEnvelope(r: Row): Envelope {
  const balances = {
    cap: n(r.cap_nano),
    allocated: n(r.allocated_nano),
    reserved: n(r.reserved_nano),
    unknown: n(r.unknown_nano),
    incurred: n(r.incurred_nano),
  };
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    fixture: Boolean(r.fixture),
    version: Number(r.version),
    parent_id: r.parent_id === null ? null : String(r.parent_id),
    kind: r.kind as Envelope['kind'],
    run_id: r.run_id === null ? null : String(r.run_id),
    name: String(r.name),
    status: r.status as Envelope['status'],
    ...balances,
    available: r.status === 'active' ? availableOf(balances) : '0',
    rollup_incurred: n(r.rollup_incurred ?? r.incurred_nano),
    rollup_unknown: n(r.rollup_unknown ?? r.unknown_nano),
    in_flight: Number(r.in_flight ?? 0),
    max_in_flight: Number(r.max_in_flight),
    starts_at: nullableIso(r.starts_at),
    ends_at: nullableIso(r.ends_at),
    created_by: String(r.created_by),
    created_at: iso(r.created_at),
    closed_at: nullableIso(r.closed_at),
  };
}
/**
 * withEvidence adds the owner's reconcile evidence from the stored result. Callers pass it only
 * for the owner, so the text never reaches members or a broker replay.
 */
export function toReservation(r: Row, withEvidence = false): Reservation {
  const result = (r.result as Row | null | undefined) ?? null;
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    envelope_id: String(r.envelope_id),
    run_id: String(r.run_id),
    task_id: r.task_id === null ? null : String(r.task_id),
    logical_operation_id: String(r.logical_operation_id),
    attempt: Number(r.attempt),
    action_type: r.action_type as MeteredAction,
    provider: r.provider as Provider,
    model_id: String(r.model_id),
    pricing_snapshot_id:
      r.pricing_snapshot_id === null ? null : String(r.pricing_snapshot_id),
    admission_id: r.admission_id === null ? null : String(r.admission_id),
    decision_id: r.decision_id === null ? null : String(r.decision_id),
    status: r.status as Reservation['status'],
    reason_code: String(r.reason_code),
    explanation: String(r.explanation),
    reserved: n(r.reserved_nano),
    exposure: (r.exposure as Exposure | null) ?? null,
    incurred: r.incurred_nano === null ? null : String(r.incurred_nano),
    usage: (r.usage as Usage | null) ?? null,
    usage_source: (r.usage_source as Reservation['usage_source']) ?? null,
    provider_response_id:
      r.provider_response_id === null || r.provider_response_id === undefined
        ? null
        : String(r.provider_response_id),
    reconcile_evidence:
      withEvidence && result?.reconciled === true && result.evidence
        ? String(result.evidence)
        : null,
    fixture: Boolean(r.fixture),
    created_at: iso(r.created_at),
    finished_at: nullableIso(r.finished_at),
  };
}
export const RESERVATION_SELECT = `select r.*, u.usage, u.source as usage_source
  from budget_reservations r left join usage_records u on u.reservation_id = r.id`;

/** What the broker asks the store to admit and reserve for one attempt. */
export interface AttemptPlan {
  provider: Provider;
  model_id: string;
  /** Null when no live adapter is configured for this workspace: recorded as a denial. */
  adapterAvailable: boolean;
  requestHash: string;
  attempt: number;
  timeoutMs: number;
}
export type PrepareOutcome =
  | { kind: 'reserved'; reservation: Reservation; pricing: PricingSnapshot }
  | { kind: 'denied'; reservation: Reservation; admission: Admission | null };
export type Finish =
  | {
      kind: 'settle';
      usage: Usage;
      source:
        | 'provider_response'
        | 'late_provider_response'
        | 'fixture'
        | 'owner_reconciliation';
      providerResponseId: string | null;
      /** Arrived after the attempt had already been reported unknown. */
      late?: boolean;
      result: Row;
    }
  | { kind: 'release'; reasonCode: string; explanation: string; result: Row }
  | { kind: 'unknown'; reasonCode: string; explanation: string; result: Row };

/**
 * Pricing snapshots, budget envelopes, reservations and authoritative usage (migration 3).
 * Every balance change locks the envelope row, writes a journal entry and an audit event in
 * the same transaction; database checks reject any state that would overspend a cap.
 */
export class BudgetStore extends OversightStore {
  readonly lateWindowMs: number;
  /** The owner's overall runtime ceiling (config/spending.json); callers never set it. */
  spending = readSpendingConfig();
  constructor(pool: Pool, options: { lateWindowMs?: number } = {}) {
    super(pool);
    this.lateWindowMs = options.lateWindowMs ?? LATE_RESULT_WINDOW_MS;
  }
  private async workspaceFixture(c: PoolClient, ws: string) {
    const { rows } = await c.query<{ fixture: boolean }>(
      'select fixture from workspaces where id = $1',
      [ws],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Workspace not found.');
    return rows[0].fixture;
  }
  protected async journal(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    eventId: string,
    entry: string,
    envelopeId: string,
    d: {
      allocated?: bigint;
      reserved?: bigint;
      unknown?: bigint;
      incurred?: bigint;
    },
    reservationId: string | null = null,
    counterpart: string | null = null,
  ) {
    await c.query(
      `insert into budget_journal (workspace_id, envelope_id, reservation_id,
         counterpart_envelope_id, entry, d_allocated, d_reserved, d_unknown, d_incurred,
         actor_id, event_id)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [
        ws,
        envelopeId,
        reservationId,
        counterpart,
        entry,
        String(d.allocated ?? 0n),
        String(d.reserved ?? 0n),
        String(d.unknown ?? 0n),
        String(d.incurred ?? 0n),
        ctx.actorId,
        eventId,
      ],
    );
  }
  /** Applies balance deltas; marks the envelope overrun if actual charges exceed its cap. */
  private async move(
    c: PoolClient,
    envelopeId: string,
    d: {
      allocated?: bigint;
      reserved?: bigint;
      unknown?: bigint;
      incurred?: bigint;
    },
  ) {
    await c.query(
      `update budget_envelopes set
         allocated_nano = allocated_nano + $2, reserved_nano = reserved_nano + $3,
         unknown_nano = unknown_nano + $4, incurred_nano = incurred_nano + $5,
         version = version + 1,
         status = case when status = 'active' and allocated_nano + $2 + reserved_nano + $3
           + unknown_nano + $4 + incurred_nano + $5 > cap_nano then 'overrun' else status end
       where id = $1`,
      [
        envelopeId,
        String(d.allocated ?? 0n),
        String(d.reserved ?? 0n),
        String(d.unknown ?? 0n),
        String(d.incurred ?? 0n),
      ],
    );
  }
  /**
   * Free authority after counting overruns: when a provider charged a child more than its cap,
   * the excess also counts against every ancestor, so siblings and new carve-outs cannot spend
   * a parent past its own cap. Returns the envelope's own headroom and the tightest ancestor's.
   */
  private async headroom(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      `select id, parent_id, cap_nano, allocated_nano, reserved_nano, unknown_nano, incurred_nano
       from budget_envelopes where workspace_id = $1`,
      [ws],
    );
    const byId = new Map(rows.map((r: Row) => [String(r.id), r as Row]));
    const children = new Map<string, Row[]>();
    for (const r of rows as Row[])
      if (r.parent_id)
        children.set(String(r.parent_id), [
          ...(children.get(String(r.parent_id)) ?? []),
          r,
        ]);
    const big = (v: unknown) => BigInt(n(v));
    const free = new Map<string, bigint>();
    const effective = (r: Row): bigint => {
      const key = String(r.id);
      const known = free.get(key);
      if (known !== undefined) return known;
      let value =
        big(r.cap_nano) -
        big(r.allocated_nano) -
        big(r.reserved_nano) -
        big(r.unknown_nano) -
        big(r.incurred_nano);
      for (const child of children.get(key) ?? []) {
        const childFree = effective(child);
        if (childFree < 0n) value += childFree;
      }
      free.set(key, value);
      return value;
    };
    const self = byId.get(id);
    if (!self) throw fail('NOT_FOUND', 'Budget envelope not found.');
    let ancestor: bigint | null = null;
    for (
      let p = self.parent_id ? byId.get(String(self.parent_id)) : undefined;
      p;
      p = p.parent_id ? byId.get(String(p.parent_id)) : undefined
    ) {
      const v = effective(p);
      if (ancestor === null || v < ancestor) ancestor = v;
    }
    return { own: effective(self), ancestor };
  }
  private async lockEnvelope(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      'select * from budget_envelopes where workspace_id = $1 and id = $2 for update',
      [ws, id],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Budget envelope not found.');
    return rows[0] as Row;
  }

  // ---- Owner's runtime ceiling (Settings, ADR-0043) ----------------------------------------

  /**
   * ADR-0113 (S0): the studio-wide ceiling, limits and spend views belong to one studio
   * spending manager, recorded in `studio_spending_manager`. Owning or creating a workspace
   * never grants it (it replaced ADR-0043's "any workspace owner"). Agents, system actors and
   * tester accounts never qualify, even if the row names them.
   */
  protected async isSpendingManager(c: PoolClient, actorId: string) {
    const { rows } = await c.query<{ ok: boolean }>(
      `select exists(select 1 from studio_spending_manager s join actors a on a.id = s.actor_id
          where s.actor_id = $1 and a.kind = 'human'
            and not exists(select 1 from tester_accounts t where t.actor_id = a.id)) as ok`,
      [actorId],
    );
    return rows[0]?.ok === true;
  }
  private async requireSpendingManager(c: PoolClient, actorId: string) {
    if (!(await this.isSpendingManager(c, actorId)))
      throw fail(
        'ACCESS_DENIED',
        'Only the studio spending manager can view or change the spending ceiling and limits. Owning a workspace does not grant this.',
      );
  }
  private async ceilingView(c: PoolClient): Promise<RuntimeCeiling> {
    const exposure = await runtimeExposure(c, this.spending);
    const cur = await currentCeiling(c, this.spending);
    const history = await c.query(
      `select version, ceiling_nano::text as ceiling, previous_nano::text as previous,
              reason, actor_id, created_at
         from runtime_ceiling_changes order by version desc limit 50`,
    );
    return parse(RuntimeCeilingSchema, {
      ceiling_nano_usd: cur.ceiling_nano_usd,
      source: cur.source,
      version: cur.version,
      configured_nano_usd: this.spending.ceiling_nano_usd,
      counted_since: iso(this.spending.effective_from),
      exposure_nano_usd: exposure.exposure_nano_usd,
      unknown_calls: exposure.unknown_calls,
      spending_manager_actor_id: await spendingManagerId(c),
      history: history.rows.map((r: Row) => ({
        version: Number(r.version),
        ceiling_nano_usd: String(r.ceiling),
        previous_nano_usd: String(r.previous),
        reason: String(r.reason),
        actor_id: String(r.actor_id),
        created_at: iso(r.created_at),
      })),
    });
  }
  /**
   * Reading takes the same runtime-ceiling lock a paid dispatch takes (inside
   * runtimeExposure), so the ceiling and exposure shown are one consistent moment. The read is
   * short, and a dispatch waits for it at most that long.
   */
  async runtimeCeiling(ctx: CommandContext): Promise<RuntimeCeiling> {
    ctx = normalize(ctx);
    return this.tx(async (c) => {
      await this.requireSpendingManager(c, ctx.actorId);
      return this.ceilingView(c);
    });
  }
  /**
   * Records a new ceiling version. The caller names the version it saw, so two people (or two
   * tabs) cannot silently overwrite each other; the change, its reason and its audit event
   * commit together under the same lock every paid dispatch takes to check the ceiling.
   */
  async setRuntimeCeiling(
    ctx: CommandContext,
    raw: unknown,
  ): Promise<RuntimeCeiling> {
    ctx = normalize(ctx);
    const body = parse(SetRuntimeCeilingRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireSpendingManager(c, ctx.actorId);
      await lockRuntimeCeiling(c);
      const cur = await currentCeiling(c, this.spending);
      if (body.expected_version !== cur.version)
        throw fail(
          'VERSION_CONFLICT',
          'The ceiling changed since this page loaded it; reload and decide again.',
        );
      if (BigInt(body.ceiling_nano_usd) === BigInt(cur.ceiling_nano_usd))
        throw fail(
          'INVALID_CONTRACT',
          'The new ceiling is the same as the current one.',
        );
      const version = cur.version + 1;
      const payload = {
        version,
        ceiling_nano: body.ceiling_nano_usd,
        previous_nano: cur.ceiling_nano_usd,
        reason: body.reason,
      };
      const eventId = await this.append(c, ctx, {
        workspaceId: null,
        action: 'spending.ceiling_changed',
        subjectKind: 'runtime_ceiling',
        subjectId: '00000000-0000-0000-0000-000000000000',
        subjectVersion: version,
        contentHash: canonicalHash(payload),
        payload,
      });
      await c.query(
        `insert into runtime_ceiling_changes
           (version, ceiling_nano, previous_nano, reason, actor_id, event_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          version,
          body.ceiling_nano_usd,
          cur.ceiling_nano_usd,
          body.reason,
          ctx.actorId,
          eventId,
        ],
      );
      return this.ceilingView(c);
    });
  }

  // ---- Owner's narrower spending limits (Settings, ADR-0044) -------------------------------

  private async limitsView(c: PoolClient): Promise<SpendLimitsView> {
    // The same lock a dispatch takes, so limits and counted spending are one moment.
    await lockRuntimeCeiling(c);
    const ceiling = await currentCeiling(c, this.spending);
    const cur = await currentSpendLimits(c);
    const since = this.spending.effective_from;
    const counted = `coalesce(sum(case when r.status = 'settled' then coalesce(r.incurred_nano, 0)
      when r.status in ('in_flight', 'unknown') then r.reserved_nano else 0 end), 0)::text`;
    // Every model that has a limit, a real pricing snapshot or counted real spending.
    const models = await c.query<{
      provider: string;
      model_id: string;
      exposure: string;
      known: boolean;
    }>(
      `with seen as (
         select provider, model_id from budget_reservations where not fixture
         union select p.body->>'provider', p.body->>'model_id'
           from pricing_snapshots p join workspaces w on w.id = p.workspace_id
          where not w.fixture),
       keys as (
         select provider, model_id from seen
         union select x->>'provider', x->>'model_id'
           from jsonb_array_elements($2::jsonb) x)
       select k.provider, k.model_id,
         exists(select 1 from seen s where s.provider = k.provider
           and s.model_id = k.model_id) as known, (select ${counted} from budget_reservations r
          where not r.fixture and r.created_at >= $1 and r.provider = k.provider
            and r.model_id = k.model_id) as exposure
         from keys k where k.provider in ('openai', 'brave')
        order by k.provider, k.model_id limit 200`,
      [since, JSON.stringify(cur.limits.per_model)],
    );
    const runs = await c.query<{ ws: string; run: string; exposure: string }>(
      `select r.workspace_id as ws, r.run_id as run, ${counted} as exposure
         from budget_reservations r where not r.fixture and r.created_at >= $1
        group by r.workspace_id, r.run_id
        order by sum(case when r.status = 'settled' then coalesce(r.incurred_nano, 0)
          when r.status in ('in_flight', 'unknown') then r.reserved_nano else 0 end) desc
        limit 10`,
      [since],
    );
    const history = await c.query(
      `select version, limits, previous, reason, actor_id, created_at
         from runtime_limit_changes order by version desc limit 50`,
    );
    // ADR-0113: the full refusal details, with amounts, for the manager only.
    const refusals = await c.query(
      `select s.reservation_id, s.reason_code, s.explanation, s.created_at,
              r.workspace_id, r.run_id, r.provider, r.model_id
         from spending_refusals s join budget_reservations r on r.id = s.reservation_id
        order by s.created_at desc, s.reservation_id limit 20`,
    );
    return parse(SpendLimitsViewSchema, {
      version: cur.version,
      limits: cur.limits,
      ceiling_nano_usd: ceiling.ceiling_nano_usd,
      counted_since: iso(since),
      models: models.rows.map((m) => ({
        provider: m.provider,
        model_id: m.model_id,
        limit_nano_usd:
          cur.limits.per_model.find(
            (l) => l.provider === m.provider && l.model_id === m.model_id,
          )?.limit_nano_usd ?? null,
        exposure_nano_usd: m.exposure,
        known: m.known,
      })),
      top_runs: runs.rows
        .filter((r) => BigInt(r.exposure) > 0n)
        .map((r) => ({
          workspace_id: r.ws,
          run_id: r.run,
          exposure_nano_usd: r.exposure,
        })),
      recent_refusals: refusals.rows.map((r: Row) => ({
        reservation_id: String(r.reservation_id),
        workspace_id: String(r.workspace_id),
        run_id: String(r.run_id),
        provider: String(r.provider),
        model_id: String(r.model_id),
        reason_code: String(r.reason_code),
        explanation: String(r.explanation),
        created_at: iso(r.created_at),
      })),
      history: history.rows.map((r: Row) => ({
        version: Number(r.version),
        limits: r.limits,
        previous: r.previous,
        reason: String(r.reason),
        actor_id: String(r.actor_id),
        created_at: iso(r.created_at),
      })),
    });
  }
  /** Same audience as the ceiling: the studio spending manager (ADR-0113). */
  async spendLimits(ctx: CommandContext): Promise<SpendLimitsView> {
    ctx = normalize(ctx);
    return this.tx(async (c) => {
      await this.requireSpendingManager(c, ctx.actorId);
      return this.limitsView(c);
    });
  }
  /**
   * Records a new version of the whole limit set. Each limit must fit under the ceiling in
   * force, one model appears once, and the caller names the version it saw. The change, its
   * reason and its audit event commit together under the lock every paid dispatch takes.
   * A later lower ceiling still wins: dispatch checks the ceiling and these limits both.
   */
  async setSpendLimits(
    ctx: CommandContext,
    raw: unknown,
  ): Promise<SpendLimitsView> {
    ctx = normalize(ctx);
    const body = parse(SetSpendLimitsRequestSchema, raw);
    const limits: SpendLimits = {
      per_run_nano_usd: body.limits.per_run_nano_usd,
      per_model: [...body.limits.per_model].sort((a, b) =>
        `${a.provider}/${a.model_id}`.localeCompare(
          `${b.provider}/${b.model_id}`,
        ),
      ),
    };
    const keys = limits.per_model.map((m) => `${m.provider}/${m.model_id}`);
    if (new Set(keys).size !== keys.length)
      throw fail('INVALID_CONTRACT', 'Each model can have only one limit.');
    return this.tx(async (c) => {
      await this.requireSpendingManager(c, ctx.actorId);
      await lockRuntimeCeiling(c);
      const cur = await currentSpendLimits(c);
      if (body.expected_version !== cur.version)
        throw fail(
          'VERSION_CONFLICT',
          'The limits changed since this page loaded them; reload and decide again.',
        );
      if (canonicalHash(limits) === canonicalHash(cur.limits))
        throw fail('INVALID_CONTRACT', 'These are the current limits.');
      const ceiling = BigInt(
        (await currentCeiling(c, this.spending)).ceiling_nano_usd,
      );
      const over = [
        ...(limits.per_run_nano_usd === null
          ? []
          : [{ name: 'The per-run limit', nano: limits.per_run_nano_usd }]),
        ...limits.per_model.map((m) => ({
          name: `The limit for ${m.provider}/${m.model_id}`,
          nano: m.limit_nano_usd,
        })),
      ].find((l) => BigInt(l.nano) > ceiling);
      if (over)
        throw fail(
          'INVALID_CONTRACT',
          `${over.name} is above the overall ceiling of ${ceiling} nano-USD; narrower limits must fit under it.`,
        );
      // An open final study attempt already holds its frozen cap; a per-run limit below it
      // would cut that attempt off part-way, so wait until it finishes.
      if (limits.per_run_nano_usd !== null) {
        const { rows: holds } = await c.query<{ cap: string | null }>(
          `select max(h.cap_nano)::text as cap from study_budget_holds h
            where h.ledger = 't15-final' and not exists (
              select 1 from study_events e where e.attempt_id = h.attempt_id and e.kind = 'finished')`,
        );
        const cap = holds[0]?.cap;
        if (cap && BigInt(limits.per_run_nano_usd) < BigInt(cap))
          throw fail(
            'INVALID_CONTRACT',
            `An open final study attempt holds ${cap} nano-USD; a per-run limit below that would stop it part-way. Set it after the attempt finishes.`,
          );
      }
      const version = cur.version + 1;
      const payload = {
        version,
        limits,
        previous: cur.limits,
        reason: body.reason,
      };
      const eventId = await this.append(c, ctx, {
        workspaceId: null,
        action: 'spending.limits_changed',
        subjectKind: 'runtime_limits',
        subjectId: '00000000-0000-0000-0000-000000000000',
        subjectVersion: version,
        contentHash: canonicalHash(payload),
        payload,
      });
      await c.query(
        `insert into runtime_limit_changes
           (version, limits, previous, reason, actor_id, event_id)
         values ($1, $2, $3, $4, $5, $6)`,
        [
          version,
          JSON.stringify(limits),
          JSON.stringify(cur.limits),
          body.reason,
          ctx.actorId,
          eventId,
        ],
      );
      return this.limitsView(c);
    });
  }

  // ---- Pricing ---------------------------------------------------------------------------

  async createPricing(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const body = parse(PricingSnapshotBodySchema, raw);
    return this.idempotent(
      ws,
      ctx,
      { op: 'pricing.create', body },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        const fixture = await this.workspaceFixture(c, ws);
        if (fixture !== (body.basis === 'fixture'))
          throw fail(
            'SCOPE_EXCEEDED',
            fixture
              ? 'A fixture workspace can only hold fixture pricing.'
              : 'A real workspace cannot use fixture pricing.',
          );
        const id = randomUUID();
        const hash = canonicalHash(body);
        const { rows } = await c.query(
          `insert into pricing_snapshots (id, workspace_id, fixture, provider, model_id, basis,
           body, snapshot_hash, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
          [
            id,
            ws,
            fixture,
            body.provider,
            body.model_id,
            body.basis,
            body,
            hash,
            ctx.actorId,
          ],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'pricing.recorded',
          subjectKind: 'pricing',
          subjectId: id,
          subjectVersion: null,
          contentHash: hash,
          payload: {
            provider: body.provider,
            model_id: body.model_id,
            basis: body.basis,
          },
        });
        return toPricing(rows[0] as Row);
      },
    );
  }
  async listPricing(
    ctx: CommandContext,
    ws: string,
  ): Promise<PricingSnapshot[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from pricing_snapshots where workspace_id = $1 order by created_at desc limit 100',
        [ws],
      );
      return rows.map((r: Row) => toPricing(r));
    });
  }

  // ---- Envelopes -------------------------------------------------------------------------

  private async readEnvelope(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      `with recursive tree as (
         select id from budget_envelopes where workspace_id = $1 and id = $2
         union all
         select e.id from budget_envelopes e join tree t on e.parent_id = t.id)
       select e.*,
         (select sum(x.incurred_nano) from budget_envelopes x where x.id in (select id from tree)) as rollup_incurred,
         (select sum(x.unknown_nano) from budget_envelopes x where x.id in (select id from tree)) as rollup_unknown,
         (select count(*) from budget_reservations r where r.envelope_id = e.id and r.status = 'in_flight') as in_flight
       from budget_envelopes e where e.workspace_id = $1 and e.id = $2`,
      [ws, id],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Budget envelope not found.');
    return toEnvelope(rows[0] as Row);
  }

  /**
   * An owner funds a global envelope or carves a child out of an active parent. The parent's
   * allocated balance rises by the child's cap, so authority is conserved, not duplicated.
   */
  async createEnvelope(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateEnvelopeRequestSchema, raw);
    return this.idempotent(
      ws,
      ctx,
      { op: 'envelope.create', req },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        const fixture = await this.workspaceFixture(c, ws);
        if ((req.kind === 'global') !== (req.parent_id === null))
          throw fail(
            'INVALID_CONTRACT',
            'Only a global envelope has no parent.',
          );
        if (
          (req.kind === 'run' || req.kind === 'task') !==
          (req.run_id !== null)
        )
          throw fail(
            'INVALID_CONTRACT',
            'Run and task envelopes name exactly one run.',
          );
        if (
          (req.kind === 'period') !==
          (req.starts_at !== null && req.ends_at !== null)
        )
          throw fail(
            'INVALID_CONTRACT',
            'Only period envelopes have a window.',
          );
        if (
          req.starts_at &&
          req.ends_at &&
          Date.parse(req.ends_at) <= Date.parse(req.starts_at)
        )
          throw fail('INVALID_CONTRACT', 'A period must end after it starts.');
        const runId = req.run_id?.toLowerCase() ?? null;
        if (runId) await this.lockRun(c, ws, runId);
        const id = randomUUID();
        const cap = BigInt(req.cap_nano_usd);
        let parent: Row | null = null;
        if (req.parent_id) {
          parent = await this.lockEnvelope(c, ws, req.parent_id.toLowerCase());
          if (parent.status !== 'active')
            throw fail(
              'INVALID_TRANSITION',
              'The parent envelope is not active.',
            );
          if (parent.run_id !== null && parent.run_id !== runId)
            throw fail(
              'SCOPE_EXCEEDED',
              'A child cannot leave its parent run.',
            );
          if (
            req.kind === 'global' ||
            (req.kind === 'period' && parent.kind !== 'global')
          )
            throw fail(
              'INVALID_CONTRACT',
              'A period envelope belongs under a global one.',
            );
          const head = await this.headroom(c, ws, String(parent.id));
          if (head.ancestor !== null && head.ancestor < 0n)
            throw fail(
              'BUDGET_EXCEEDED',
              'Spending under an ancestor envelope has passed its cap after an overrun.',
            );
          const available = head.own < 0n ? 0n : head.own;
          if (cap > available)
            throw fail(
              'BUDGET_EXCEEDED',
              `The parent has ${available} available; the child asks for ${cap}.`,
            );
        }
        await c.query(
          `insert into budget_envelopes (id, workspace_id, fixture, parent_id, kind, run_id, name,
           status, cap_nano, max_in_flight, starts_at, ends_at, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,'active',$8,$9,$10,$11,$12)`,
          [
            id,
            ws,
            fixture,
            parent ? String(parent.id) : null,
            req.kind,
            runId,
            req.name,
            String(cap),
            req.max_in_flight,
            req.starts_at,
            req.ends_at,
            ctx.actorId,
          ],
        );
        const eventId = await this.append(c, ctx, {
          workspaceId: ws,
          action: parent ? 'budget.allocated' : 'budget.funded',
          subjectKind: 'envelope',
          subjectId: id,
          subjectVersion: 1,
          contentHash: null,
          payload: { kind: req.kind, cap_nano: String(cap), fixture },
          relatedIds: [
            ...(parent ? [String(parent.id)] : []),
            ...(runId ? [runId] : []),
          ],
        });
        if (parent) {
          await this.move(c, String(parent.id), { allocated: cap });
          await this.journal(
            c,
            ctx,
            ws,
            eventId,
            'allocate',
            String(parent.id),
            { allocated: cap },
            null,
            id,
          );
          await this.journal(
            c,
            ctx,
            ws,
            eventId,
            'fund',
            id,
            {},
            null,
            String(parent.id),
          );
        } else await this.journal(c, ctx, ws, eventId, 'fund', id, {});
        return this.readEnvelope(c, ws, id);
      },
    );
  }

  /** Closes an idle envelope and returns its unspent authority to the parent. */
  async closeEnvelope(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    id = uuid(id);
    const req = parse(CloseEnvelopeRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const peek = await c.query<{ parent_id: string | null }>(
        'select parent_id from budget_envelopes where workspace_id = $1 and id = $2',
        [ws, id],
      );
      if (!peek.rows[0]) throw fail('NOT_FOUND', 'Budget envelope not found.');
      // Parent before child, the same order allocation uses.
      const parentId = peek.rows[0].parent_id;
      if (parentId) await this.lockEnvelope(c, ws, parentId);
      const e = await this.lockEnvelope(c, ws, id);
      if (Number(e.version) !== req.expected_version)
        throw fail('VERSION_CONFLICT', 'The envelope changed; reload it.');
      if (e.status === 'closed')
        throw fail('INVALID_TRANSITION', 'Already closed.');
      if (
        n(e.reserved_nano) !== '0' ||
        n(e.unknown_nano) !== '0' ||
        n(e.allocated_nano) !== '0'
      )
        throw fail(
          'INVALID_TRANSITION',
          'Close child envelopes and reconcile in-flight or unknown calls first.',
        );
      const remainder = BigInt(n(e.cap_nano)) - BigInt(n(e.incurred_nano));
      const returned = remainder > 0n ? remainder : 0n;
      await c.query(
        `update budget_envelopes set status = 'closed', closed_at = now(), version = version + 1
         where id = $1`,
        [id],
      );
      const eventId = await this.append(c, ctx, {
        workspaceId: ws,
        action: 'budget.closed',
        subjectKind: 'envelope',
        subjectId: id,
        subjectVersion: Number(e.version) + 1,
        contentHash: null,
        payload: { returned_nano: String(returned), reason_given: true },
        relatedIds: parentId ? [parentId] : [],
      });
      await this.journal(c, ctx, ws, eventId, 'close', id, {}, null, parentId);
      if (parentId) {
        await this.move(c, parentId, { allocated: -returned });
        await this.journal(
          c,
          ctx,
          ws,
          eventId,
          'return',
          parentId,
          { allocated: -returned },
          null,
          id,
        );
      }
      return this.readEnvelope(c, ws, id);
    });
  }

  /** Newest first, one page of at most 200 (audit L-9); `before` reads the next older page. */
  async listEnvelopes(
    ctx: CommandContext,
    ws: string,
    page?: PageRequest,
  ): Promise<Envelope[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const { before, limit } = readPage(page, 200);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await checkPageStart(c, 'budget_envelopes', ws, before);
      const { rows } = await c.query<{ id: string }>(
        `select id from budget_envelopes where workspace_id = $1
           and ${olderThan('budget_envelopes', 2)}
         order by ${newestOrder('budget_envelopes')} limit $3`,
        [ws, before, limit],
      );
      const out: Envelope[] = [];
      for (const r of rows) out.push(await this.readEnvelope(c, ws, r.id));
      return out;
    });
  }
  async getEnvelope(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    id = uuid(id);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.readEnvelope(c, ws, id);
    });
  }
  /** Re-derives balances from the journal; equal to the envelope row when conservation holds. */
  async journalBalances(ws: string, id: string) {
    const { rows } = await this.pool.query(
      `select coalesce(sum(d_allocated), 0) as allocated, coalesce(sum(d_reserved), 0) as reserved,
         coalesce(sum(d_unknown), 0) as unknown, coalesce(sum(d_incurred), 0) as incurred
       from budget_journal where workspace_id = $1 and envelope_id = $2`,
      [uuid(ws), uuid(id)],
    );
    const r = rows[0] as Row;
    return {
      allocated: n(r.allocated),
      reserved: n(r.reserved),
      unknown: n(r.unknown),
      incurred: n(r.incurred),
    };
  }

  // ---- Reservations ----------------------------------------------------------------------

  async listReservations(
    ctx: CommandContext,
    ws: string,
    filter: { envelopeId?: string; runId?: string; operationId?: string } = {},
  ): Promise<Reservation[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const role = await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `${RESERVATION_SELECT} where r.workspace_id = $1
           and ($2::uuid is null or r.envelope_id = $2)
           and ($3::uuid is null or r.run_id = $3)
           and ($4::uuid is null or r.logical_operation_id = $4)
         order by r.created_at desc, r.attempt desc limit 200`,
        [
          ws,
          filter.envelopeId ? uuid(filter.envelopeId) : null,
          filter.runId ? uuid(filter.runId) : null,
          filter.operationId ? uuid(filter.operationId) : null,
        ],
      );
      return rows.map((r: Row) => toReservation(r, role === 'owner'));
    });
  }
  /** Attempts of one logical operation, oldest first, with each attempt's stored result. */
  async operationAttempts(
    ctx: CommandContext,
    ws: string,
    operationId: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const { rows } = await this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return c.query(
        `${RESERVATION_SELECT} where r.workspace_id = $1 and r.logical_operation_id = $2
         order by r.created_at, r.attempt`,
        [ws, uuid(operationId)],
      );
    });
    return rows.map((r: Row) => ({
      reservation: toReservation(r),
      requestHash: String(r.request_hash),
      result: (r.result as Row | null) ?? null,
    }));
  }
  async isFixtureWorkspace(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.workspaceFixture(c, ws);
    });
  }

  private async insertReservation(
    c: PoolClient,
    ctx: CommandContext,
    v: {
      ws: string;
      fixture: boolean;
      envelopeId: string;
      runId: string;
      req: BrokerCallRequest;
      plan: AttemptPlan;
      pricingId: string | null;
      admission: Admission | null;
      status: 'denied' | 'in_flight';
      reasonCode: string;
      explanation: string;
      reserved: bigint;
      exposure: Exposure | null;
      result: Row | null;
    },
  ) {
    const id = randomUUID();
    const { rows } = await c.query(
      `insert into budget_reservations (id, workspace_id, fixture, envelope_id, run_id, task_id,
         logical_operation_id, attempt, request_hash, action_type, provider, model_id,
         pricing_snapshot_id, admission_id, decision_id, status, reason_code, explanation,
         reserved_nano, exposure, result, deadline_at, created_by, finished_at)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
         now() + make_interval(secs => $22::double precision / 1000), $23,
         case when $16 = 'in_flight' then null else now() end)
       returning *, null::jsonb as usage, null::text as usage_source`,
      [
        id,
        v.ws,
        v.fixture,
        v.envelopeId,
        v.runId,
        v.req.task_id?.toLowerCase() ?? null,
        v.req.logical_operation_id.toLowerCase(),
        v.plan.attempt,
        v.plan.requestHash,
        v.req.action_type,
        v.plan.provider,
        v.plan.model_id,
        v.pricingId,
        v.admission?.id ?? null,
        v.admission?.decision_id ?? null,
        v.status,
        v.reasonCode,
        v.explanation,
        String(v.reserved),
        v.exposure,
        v.result,
        v.plan.timeoutMs + this.lateWindowMs,
        ctx.actorId,
      ],
    );
    const eventId = await this.append(c, ctx, {
      workspaceId: v.ws,
      action: v.status === 'denied' ? 'budget.denied' : 'budget.reserved',
      subjectKind: 'reservation',
      subjectId: id,
      subjectVersion: null,
      contentHash: v.plan.requestHash,
      payload: {
        action_type: v.req.action_type,
        provider: v.plan.provider,
        attempt: v.plan.attempt,
        reason_code: v.reasonCode,
        reserved_nano: String(v.reserved),
        policy_version: BUDGET_POLICY_VERSION,
      },
      relatedIds: [
        v.envelopeId,
        v.runId,
        v.req.logical_operation_id.toLowerCase(),
        ...(v.admission ? [v.admission.id] : []),
      ],
    });
    if (v.status === 'in_flight') {
      await this.move(c, v.envelopeId, { reserved: v.reserved });
      await this.journal(
        c,
        ctx,
        v.ws,
        eventId,
        'reserve',
        v.envelopeId,
        { reserved: v.reserved },
        id,
      );
    }
    return toReservation(rows[0] as Row);
  }

  /**
   * One transaction: non-delegable run state, pricing, exposure bound, envelope scope, window,
   * concurrency and balance, then T03 admission, then the reservation. Anything short of
   * "allow with funds" is recorded as a denial with nothing reserved, and nothing is sent.
   */
  async prepareAttempt(
    ctx: CommandContext,
    ws: string,
    runId: string,
    req: BrokerCallRequest,
    plan: AttemptPlan,
  ): Promise<PrepareOutcome> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    runId = uuid(runId);
    const envelopeId = uuid(req.envelope_id);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const fixture = await this.workspaceFixture(c, ws);
      const run = await this.lockRun(c, ws, runId);
      const envelope = await this.lockEnvelope(c, ws, envelopeId);
      const base = { ws, fixture, envelopeId, runId, req, plan };
      const deny = async (
        reasonCode: string,
        explanation: string,
        extra: {
          pricingId?: string | null;
          exposure?: Exposure | null;
          admission?: Admission | null;
        } = {},
      ): Promise<PrepareOutcome> => ({
        kind: 'denied',
        admission: extra.admission ?? null,
        reservation: await this.insertReservation(c, ctx, {
          ...base,
          pricingId: extra.pricingId ?? null,
          admission: extra.admission ?? null,
          status: 'denied',
          reasonCode,
          explanation,
          reserved: 0n,
          exposure: extra.exposure ?? null,
          result: {
            status:
              extra.admission &&
              ['needs_human', 'waiting_human'].includes(extra.admission.outcome)
                ? 'needs_human'
                : 'denied',
          },
        }),
      });
      const portfolioBudgetReason = await portfolioEnvelopeGate(
        c,
        ws,
        runId,
        envelopeId,
      );
      if (portfolioBudgetReason)
        return deny(
          portfolioBudgetReason,
          'The budget is outside the portfolio lane allocation.',
        );
      const admissionRequest = (amount: string | null) => ({
        action_type: req.action_type,
        task_id: req.task_id,
        target: null,
        spec_hash: null,
        amount_nano_usd: amount,
        data_class: req.data_class,
        assumption_ids: [],
        humility_review: null,
        flags: [],
        justification: req.justification,
      });
      // 1–2. Non-delegable state: a cancelled or human-only run is refused by admission itself.
      // Broker search is not the conventional source browser; refuse all broker helpers.
      if (
        run.autonomy_mode === 'human_only' &&
        req.action_type === 'tool.search_public'
      )
        return deny(
          'human_only_broker_denied',
          'Human-only work cannot use model-broker tools.',
        );
      if (run.state !== 'active' || run.autonomy_mode === 'human_only') {
        const admission = await this.admitIn(
          c,
          ctx,
          ws,
          runId,
          admissionRequest(null),
        );
        return deny(admission.reason_code, admission.explanation, {
          admission,
        });
      }
      // Study runs use only application-rendered, frozen contexts. LockRun above serializes caps.
      const studyRows = await c.query(
        `select a.id,a.assignment,a.created_at,s.manifest,e.kind,e.request
        from study_attempts a join studies s on s.id=a.study_id
        left join study_execution_requests e on e.attempt_id=a.id
        where a.workspace_id=$1 and a.run_id=$2`,
        [ws, runId],
      );
      const study = studyRows.rows[0];
      if (study) {
        const frozen = study.manifest;
        const finished = await c.query(
          "select 1 from study_events where attempt_id=$1 and kind='finished'",
          [study.id],
        );
        if (
          finished.rowCount ||
          Date.now() >
            new Date(study.created_at).getTime() +
              frozen.packet.time_cap_seconds * 1000
        )
          return deny(
            'study_stopped',
            'The study attempt is terminal or past its frozen deadline.',
          );
        // A build request keeps its envelope and caps in the prepared build plan.
        const bound =
          study.kind === 'build' ? study.request?.plan : study.request;
        if (
          !bound ||
          req.envelope_id !== bound.envelope_id ||
          req.pricing_snapshot_id !== bound.pricing_snapshot_id ||
          plan.model_id !== frozen.config.model_version ||
          plan.provider !== 'fixture'
        )
          return deny(
            'study_context_denied',
            'Only the frozen study execution request is admitted.',
          );
        if (
          study.kind === 'open_ended' &&
          canonicalHash(req) !== canonicalHash(study.request)
        )
          return deny(
            'study_context_denied',
            'Baseline input cannot contain extra context or changed caps.',
          );
        if (study.kind === 'structured') {
          const task = await c.query(
            'select 1 from workflow_tasks t join workflows w on w.id=t.workflow_id where w.run_id=$1 and t.id=$2 and t.logical_operation_id=$3',
            [runId, req.task_id, req.logical_operation_id],
          );
          if (
            ctx.actorId !== '00000000-0000-4000-8000-000000000003' ||
            !task.rowCount ||
            req.action_type !== 'model.generate' ||
            req.tool !== null ||
            req.max_output_tokens > frozen.config.max_output_tokens
          )
            return deny(
              'study_context_denied',
              'Structured study calls must come from the bounded workflow worker.',
            );
        }
        if (study.kind === 'build') {
          const system = req.input[0]?.text ?? '';
          if (
            study.assignment.condition === 'human_only' ||
            req.action_type !== 'model.generate' ||
            req.tool !== null ||
            req.data_class !== bound.data_class ||
            req.max_output_tokens > bound.max_output_tokens ||
            !(
              system.startsWith('builder/1:') ||
              system.startsWith('independent-reviewer/2:')
            )
          )
            return deny(
              'study_context_denied',
              'Build study calls are limited to the builder and reviewer roles under the prepared plan.',
            );
        }
        const counts = await c.query(
          "select count(*)::int as n from budget_reservations where workspace_id=$1 and run_id=$2 and status<>'denied'",
          [ws, runId],
        );
        if (
          Number(counts.rows[0].n) >=
          (study.kind === 'build'
            ? Math.min(frozen.config.max_calls, bound.max_calls)
            : frozen.config.max_calls)
        )
          return deny('study_call_cap', 'Frozen study call cap reached.');
      }
      if (!plan.adapterAvailable)
        return deny(
          'live_provider_not_configured',
          'No live provider is configured for this real workspace; the fixture is never a substitute.',
        );
      const { rows: pr } = await c.query(
        'select * from pricing_snapshots where workspace_id = $1 and id = $2',
        [ws, req.pricing_snapshot_id.toLowerCase()],
      );
      const pricing = pr[0] ? toPricing(pr[0] as Row) : null;
      if (!pricing)
        return deny(
          'pricing_missing',
          'No pricing snapshot with that id in this workspace.',
        );
      if (
        pricing.body.provider !== plan.provider ||
        pricing.body.model_id !== plan.model_id
      )
        return deny(
          'pricing_mismatch',
          `Pricing is for ${pricing.body.provider}/${pricing.body.model_id}, not the routed model.`,
          { pricingId: pricing.id },
        );
      let exposure: Exposure;
      try {
        exposure = maxExposure(pricing.body, req);
      } catch (e) {
        if (!(e instanceof ContractError)) throw e;
        return deny(
          e.code === 'PRICING_MISSING' ? 'pricing_missing' : 'limit_exceeded',
          e.message,
          {
            pricingId: pricing.id,
          },
        );
      }
      const extra = { pricingId: pricing.id, exposure };
      // 3. Budget exposure, concurrency and bounded execution.
      if (envelope.status !== 'active')
        return deny(
          'envelope_inactive',
          `The envelope is ${String(envelope.status)}.`,
          extra,
        );
      if (envelope.run_id !== null && envelope.run_id !== runId)
        return deny(
          'envelope_scope',
          'That envelope belongs to another run.',
          extra,
        );
      const { rows: windows } = await c.query<{ ok: boolean }>(
        `with recursive chain as (
           select id, parent_id, starts_at, ends_at from budget_envelopes where id = $1
           union all
           select e.id, e.parent_id, e.starts_at, e.ends_at from budget_envelopes e
             join chain ch on e.id = ch.parent_id)
         select bool_and(starts_at is null or (now() >= starts_at and now() < ends_at)) as ok
         from chain`,
        [envelopeId],
      );
      if (!windows[0]?.ok)
        return deny(
          'outside_period',
          'The call falls outside a budget period window.',
          extra,
        );
      const { rows: flying } = await c.query<{ n: string }>(
        `select count(*) as n from budget_reservations where envelope_id = $1 and status = 'in_flight'`,
        [envelopeId],
      );
      if (Number(flying[0]?.n ?? 0) >= Number(envelope.max_in_flight))
        return deny(
          'concurrency_limit',
          `The envelope already has ${String(envelope.max_in_flight)} calls in flight.`,
          extra,
        );
      const available = BigInt(
        availableOf({
          cap: n(envelope.cap_nano),
          allocated: n(envelope.allocated_nano),
          reserved: n(envelope.reserved_nano),
          unknown: n(envelope.unknown_nano),
          incurred: n(envelope.incurred_nano),
        }),
      );
      const amount = BigInt(exposure.amount);
      const head = await this.headroom(c, ws, envelopeId);
      if (head.ancestor !== null && head.ancestor < 0n)
        return deny(
          'ancestor_overrun',
          'Spending under a parent envelope has passed its cap after an overrun; reconcile or fund it first.',
          extra,
        );
      if (amount > available || amount > head.own)
        return deny(
          'budget_exceeded',
          `Maximum exposure ${amount} exceeds the ${available} available in the envelope.`,
          extra,
        );
      // The owner's overall ceiling on real spending, across every workspace and envelope.
      if (!fixture) {
        const over = ceilingRefusal(
          await runtimeExposure(c, this.spending, { ws, runId }),
          amount,
        );
        // ADR-0113: the starter's record says the run waits on the studio limit; the amounts
        // go to a record only the studio spending manager reads.
        const spendingDeny = async (r: {
          reason_code: string;
          explanation: string;
        }) => {
          const out = await deny(
            r.reason_code,
            SPENDING_WAIT_EXPLANATION,
            extra,
          );
          await c.query(
            `insert into spending_refusals (reservation_id, reason_code, explanation)
             values ($1, $2, $3)`,
            [out.reservation.id, r.reason_code, r.explanation],
          );
          return out;
        };
        if (over) return spendingDeny(over);
        // The owner's narrower per-run and per-model limits under that ceiling (ADR-0044).
        const narrow = await spendLimitRefusal(
          c,
          this.spending,
          { ws, runId, provider: plan.provider, modelId: plan.model_id },
          amount,
        );
        if (narrow) return spendingDeny(narrow);
      }
      // 4–5. Grants, mode, stage gates (T03). The bound amount is the maximum exposure.
      const admission = await this.admitIn(
        c,
        ctx,
        ws,
        runId,
        admissionRequest(exposure.amount),
      );
      if (admission.verdict !== 'allow')
        return deny(admission.reason_code, admission.explanation, {
          ...extra,
          admission,
        });
      const reservation = await this.insertReservation(c, ctx, {
        ...base,
        ...extra,
        admission,
        status: 'in_flight',
        reasonCode: 'reserved',
        explanation: `Reserved ${amount} for attempt ${plan.attempt}.`,
        reserved: amount,
        result: null,
      });
      return { kind: 'reserved', reservation, pricing };
    });
  }

  /**
   * Records an attempt's outcome exactly once. A late or repeated report for an attempt that
   * is already settled changes nothing, so a result can never be charged twice.
   */
  async finishAttempt(
    ctx: CommandContext,
    reservationId: string,
    f: Finish,
  ): Promise<{ reservation: Reservation; changed: boolean }> {
    ctx = normalize(ctx);
    reservationId = uuid(reservationId);
    return this.tx(async (c) => {
      const peek = await c.query(
        'select workspace_id, envelope_id from budget_reservations where id = $1',
        [reservationId],
      );
      const p = peek.rows[0] as Row | undefined;
      if (!p) throw fail('NOT_FOUND', 'Reservation not found.');
      const ws = String(p.workspace_id);
      // Envelope before reservation: the order prepareAttempt uses, so the two cannot deadlock.
      await this.lockEnvelope(c, ws, String(p.envelope_id));
      const { rows } = await c.query(
        'select * from budget_reservations where id = $1 for update',
        [reservationId],
      );
      const r = rows[0] as Row;
      const from = String(r.status);
      const reread = async () =>
        toReservation(
          (
            await c.query(`${RESERVATION_SELECT} where r.id = $1`, [
              reservationId,
            ])
          ).rows[0] as Row,
        );
      if (from !== 'in_flight' && from !== 'unknown') {
        if (f.kind === 'settle' && from === 'released')
          await this.append(c, ctx, {
            workspaceId: ws,
            action: 'budget.late_result_conflict',
            subjectKind: 'reservation',
            subjectId: reservationId,
            subjectVersion: null,
            contentHash: null,
            payload: { status: from },
          });
        return { reservation: await reread(), changed: false };
      }
      if (f.kind === 'unknown' && from === 'unknown')
        return { reservation: await reread(), changed: false };
      const reserved = BigInt(n(r.reserved_nano));
      const envelopeId = String(r.envelope_id);
      const held =
        from === 'in_flight' ? { reserved: -reserved } : { unknown: -reserved };
      let status: string;
      let incurred: bigint | null = null;
      let entry: string;
      let delta: { reserved?: bigint; unknown?: bigint; incurred?: bigint };
      let reasonCode = String(r.reason_code);
      let explanation = String(r.explanation);
      if (f.kind === 'settle') {
        parse(UsageSchema, f.usage);
        const pricing = await c.query(
          'select * from pricing_snapshots where id = $1',
          [r.pricing_snapshot_id],
        );
        incurred = BigInt(
          usageCost(toPricing(pricing.rows[0] as Row).body, f.usage),
        );
        status = 'settled';
        entry = from === 'in_flight' ? 'settle' : 'resolve_unknown';
        delta = { ...held, incurred };
        reasonCode = f.late ? 'settled_late' : 'settled';
        explanation = `Charged ${incurred} of ${reserved} reserved.`;
        await c.query(
          `insert into usage_records (id, workspace_id, reservation_id, source,
             provider_response_id, usage, amount_nano, pricing_snapshot_id, actor_id)
           values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            randomUUID(),
            ws,
            reservationId,
            f.source,
            f.providerResponseId,
            f.usage,
            String(incurred),
            r.pricing_snapshot_id,
            ctx.actorId,
          ],
        );
      } else if (f.kind === 'release') {
        status = 'released';
        entry = 'release';
        delta = held;
        reasonCode = f.reasonCode;
        explanation = f.explanation;
      } else {
        status = 'unknown';
        entry = 'hold_unknown';
        delta = { reserved: -reserved, unknown: reserved };
        reasonCode = f.reasonCode;
        explanation = f.explanation;
      }
      await c.query(
        `update budget_reservations set status = $2, incurred_nano = $3, reason_code = $4,
           explanation = $5, result = $6, finished_at = coalesce(finished_at, now()),
           provider_response_id = coalesce($7, provider_response_id)
         where id = $1`,
        [
          reservationId,
          status,
          incurred === null ? null : String(incurred),
          reasonCode,
          explanation,
          f.result,
          f.kind === 'settle' ? f.providerResponseId : null,
        ],
      );
      const eventId = await this.append(c, ctx, {
        workspaceId: ws,
        action: `budget.${status}`,
        subjectKind: 'reservation',
        subjectId: reservationId,
        subjectVersion: null,
        contentHash: null,
        payload: {
          from,
          reason_code: reasonCode,
          reserved_nano: String(reserved),
          incurred_nano: incurred === null ? null : String(incurred),
        },
        relatedIds: [envelopeId, String(r.run_id)],
      });
      await this.move(c, envelopeId, delta);
      await this.journal(
        c,
        ctx,
        ws,
        eventId,
        entry,
        envelopeId,
        delta,
        reservationId,
      );
      return { reservation: await reread(), changed: true };
    });
  }

  /** Owner reconciliation of an unknown outcome from the provider's own usage records. */
  async reconcile(
    ctx: CommandContext,
    ws: string,
    reservationId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    reservationId = uuid(reservationId);
    const req = parse(ReconcileRequestSchema, raw);
    await this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const { rows } = await c.query(
        'select status from budget_reservations where workspace_id = $1 and id = $2',
        [ws, reservationId],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Reservation not found.');
      if ((rows[0] as Row).status !== 'unknown')
        throw fail(
          'INVALID_TRANSITION',
          'Only an unknown outcome can be reconciled.',
        );
    });
    const done =
      req.outcome === 'charged'
        ? await this.finishAttempt(ctx, reservationId, {
            kind: 'settle',
            usage: req.usage,
            source: 'owner_reconciliation',
            providerResponseId: req.provider_response_id,
            // The owner's evidence stays on the reservation with the outcome.
            result: {
              status: 'failed',
              reconciled: true,
              evidence: req.evidence,
            },
          })
        : await this.finishAttempt(ctx, reservationId, {
            kind: 'release',
            reasonCode: 'reconciled_no_charge',
            explanation:
              'Owner confirmed from provider records that nothing was charged.',
            // The owner's evidence stays on the reservation with the outcome.
            result: {
              status: 'failed',
              reconciled: true,
              evidence: req.evidence,
            },
          });
    // Only the owner reconciles, so the answer carries the stored evidence. It is read back
    // rather than taken from this request: a reconcile that lost a race gets the winner's
    // outcome with the winner's evidence (PR #122 review N-1).
    const { rows } = await this.pool.query(
      `${RESERVATION_SELECT} where r.id = $1`,
      [done.reservation.id],
    );
    return toReservation(rows[0] as Row, true);
  }
  /**
   * Crash recovery: an attempt still in flight past its deadline plus the late-result window
   * lost its worker. Its exposure becomes unknown — held, never silently released.
   */
  async sweepStale(ctx: CommandContext): Promise<number> {
    const { rows } = await this.pool.query<{ id: string }>(
      `select id from budget_reservations where status = 'in_flight' and deadline_at < now()`,
    );
    for (const r of rows)
      await this.finishAttempt(ctx, r.id, {
        kind: 'unknown',
        reasonCode: 'worker_lost',
        explanation:
          'No outcome was recorded before the deadline; the provider may have charged.',
        result: { status: 'unknown' },
      });
    return rows.length;
  }
}
