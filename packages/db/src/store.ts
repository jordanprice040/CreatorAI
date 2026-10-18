import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import {
  ContractError,
  parse,
  z,
  isAllowedLink,
  provenanceOrigin,
  lifecycleField,
  MAX_BODY_BYTES,
  UNMANAGED_KINDS,
  StoredBodySchemas,
  CreateWorkspaceRequestSchema,
  CreateEntityRequestSchema,
  ReviseEntityRequestSchema,
  ArchiveEntityRequestSchema,
  RedactEntityRequestSchema,
  CreateLinkRequestSchema,
  RetractLinkRequestSchema,
  StoredKindSchema,
  StoredStatusSchema,
  id as idSchema,
  type StoredKind,
  type StoredEntity,
  type StoredVersion,
  type StoredLink,
  type Workspace,
  type HistoryEntry,
  type EntityDetail,
} from '@creator/contracts';
import { canonicalHash } from '@creator/domain';

export interface Actor {
  id: string;
  kind: 'human' | 'agent' | 'system';
  display_name: string;
}
/** Who is acting and why. Actor identity is asserted by the caller; authentication is T03. */
export interface CommandContext {
  actorId: string;
  correlationId?: string;
  causationId?: string | null;
  idempotencyKey?: string;
}
export type Role = 'owner' | 'editor' | 'viewer';
export type Row = Record<string, unknown>;

const AUDIT_CHAIN_LOCK = 4_310_001;
const HISTORY_CONSUMER = 'history_projection';
export const iso = (v: unknown) =>
  v instanceof Date ? v.toISOString() : String(v);
export const fail = (
  code: ConstructorParameters<typeof ContractError>[0],
  m: string,
) => new ContractError(code, m);

export function toEntity(r: Row): StoredEntity {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    kind: StoredKindSchema.parse(r.kind),
    version: Number(r.version),
    status: StoredStatusSchema.parse(r.status),
    fixture: Boolean(r.fixture),
    title: String(r.title),
    body: (r.body as Record<string, unknown> | null) ?? null,
    content_hash: String(r.content_hash),
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
function toVersion(r: Row): StoredVersion {
  return {
    version: Number(r.version),
    status: StoredStatusSchema.parse(r.status),
    title: String(r.title),
    body: (r.body as Record<string, unknown> | null) ?? null,
    content_hash: String(r.content_hash),
    reason: r.reason === null ? null : String(r.reason),
    corrects_version:
      r.corrects_version === null ? null : Number(r.corrects_version),
    actor_id: String(r.actor_id),
    created_at: iso(r.created_at),
  };
}
function toLink(r: Row): StoredLink {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    relation: r.relation as StoredLink['relation'],
    from: {
      id: String(r.from_id),
      kind: StoredKindSchema.parse(r.from_kind),
      version: Number(r.from_version),
    },
    to: {
      id: String(r.to_id),
      kind: StoredKindSchema.parse(r.to_kind),
      version: Number(r.to_version),
    },
    rationale: String(r.rationale),
    asserted_by: String(r.asserted_by),
    created_at: iso(r.created_at),
    retracted_at: r.retracted_at === null ? null : iso(r.retracted_at),
    retraction_reason:
      r.retraction_reason === null ? null : String(r.retraction_reason),
  };
}
function toHistory(r: Row): HistoryEntry {
  return {
    event_id: String(r.event_id),
    sequence: String(r.sequence),
    workspace_id: String(r.workspace_id),
    occurred_at: iso(r.occurred_at),
    actor_id: String(r.actor_id),
    action: String(r.action),
    subject_kind: String(r.subject_kind),
    subject_id: String(r.subject_id),
    subject_version:
      r.subject_version === null ? null : Number(r.subject_version),
    content_hash: r.content_hash === null ? null : String(r.content_hash),
    correlation_id: String(r.correlation_id),
    causation_id: r.causation_id === null ? null : String(r.causation_id),
    summary: String(r.summary),
  };
}
export function isPgError(
  e: unknown,
  code: string,
  constraint?: string,
): boolean {
  return (
    e !== null &&
    typeof e === 'object' &&
    'code' in e &&
    e.code === code &&
    (constraint === undefined ||
      ('constraint' in e && e.constraint === constraint))
  );
}
function validateBody(
  kind: StoredKind,
  body: unknown,
): Record<string, unknown> {
  const schema: z.ZodType<Record<string, unknown>> = StoredBodySchemas[kind];
  const parsed = parse(schema, body);
  if (Buffer.byteLength(JSON.stringify(parsed)) > MAX_BODY_BYTES)
    throw fail(
      'BODY_TOO_LARGE',
      'Record bodies hold references; store large content as an artifact.',
    );
  return parsed;
}
/** UUIDs are compared as strings and hashed, so normalize them to PostgreSQL's lowercase form. */
export const uuid = (
  v: string,
  code: 'NOT_FOUND' | 'INVALID_CONTRACT' = 'NOT_FOUND',
) => parse(idSchema, v, code).toLowerCase();
export function normalize(ctx: CommandContext): CommandContext {
  return {
    ...ctx,
    actorId: uuid(ctx.actorId, 'INVALID_CONTRACT'),
    ...(ctx.correlationId === undefined
      ? {}
      : { correlationId: uuid(ctx.correlationId, 'INVALID_CONTRACT') }),
    causationId:
      ctx.causationId === undefined || ctx.causationId === null
        ? null
        : uuid(ctx.causationId, 'INVALID_CONTRACT'),
  };
}
const contentHash = (kind: string, title: string, body: unknown) =>
  canonicalHash({ kind, title, body });

/** Safe history wording: kinds, versions and relations only, never titles or bodies. */
function summarize(action: string, kind: string, version: unknown, p: Row) {
  switch (action) {
    case 'workspace.created':
      return `Created ${String(p.record_mode)} workspace`;
    case 'member.added':
      return `Added ${String(p.role)} member`;
    case 'entity.created':
      return `Created ${kind} v${String(version)}`;
    case 'entity.revised':
      return `Revised ${kind} to v${String(version)}`;
    case 'entity.corrected':
      return `Corrected ${kind} v${String(p.corrects_version)} with v${String(version)}`;
    case 'entity.archived':
      return `Archived ${kind} at v${String(version)}`;
    case 'entity.redacted':
      return `Redacted ${kind}; tombstone v${String(version)} keeps identity and hashes only`;
    case 'link.created':
    case 'link.retracted':
      return `${action === 'link.created' ? 'Linked' : 'Retracted link'} ${String(p.from_kind)} v${String(p.from_version)} ${String(p.relation)} ${String(p.to_kind)} v${String(p.to_version)}`;
    case 'auth.session_started':
      return `Signed in (${String(p.method)})`;
    case 'auth.session_ended':
      return 'Signed out';
    case 'run.registered':
      return `Registered ${String(p.autonomy_mode)} run`;
    case 'run.cancelled':
      return `Cancelled run; ${String(p.closed_decisions)} pending decisions closed`;
    case 'grant.created':
    case 'grant.revised':
    case 'grant.revoked':
    case 'grant.consumed':
      return `${action.slice(6)[0]?.toUpperCase()}${action.slice(7)} ${String(p.scope)} grant v${String(version)}`;
    case 'decision.requested':
      return `Requested ${String(p.kind)} decision (${String(p.reason)})`;
    case 'decision.answered':
      return `Answered decision: ${String(p.choice)}`;
    case 'decision.closed':
      return `Closed decision as ${String(p.status)}`;
    case 'pricing.recorded':
      return `Recorded ${String(p.basis)} pricing for ${String(p.provider)}/${String(p.model_id)}`;
    case 'budget.funded':
    case 'budget.allocated':
      return `${action === 'budget.funded' ? 'Funded' : 'Allocated'} ${String(p.kind)} budget of ${String(p.cap_nano)} nano-USD${p.fixture ? ' (simulated)' : ''}`;
    case 'budget.closed':
      return `Closed budget; returned ${String(p.returned_nano)} nano-USD to its parent`;
    case 'budget.reserved':
      return `Reserved ${String(p.reserved_nano)} for ${String(p.action_type)} attempt ${String(p.attempt)}`;
    case 'budget.denied':
      return `Did not send ${String(p.action_type)} (${String(p.reason_code)})`;
    case 'budget.settled':
      return `Charged ${String(p.incurred_nano)} of ${String(p.reserved_nano)} reserved`;
    case 'budget.released':
      return `Released ${String(p.reserved_nano)} uncharged (${String(p.reason_code)})`;
    case 'budget.unknown':
      return `Holding ${String(p.reserved_nano)} for an unknown outcome (${String(p.reason_code)})`;
    case 'budget.late_result_conflict':
      return 'A late provider result arrived for a call already reconciled as uncharged';
    case 'action.evaluated':
      return `Action ${String(p.action_type)}: ${String(p.verdict)} (${String(p.reason_code)})`;
    default:
      return action;
  }
}

interface EventInput {
  workspaceId: string | null;
  action: string;
  subjectKind: string;
  subjectId: string;
  subjectVersion: number | null;
  contentHash: string | null;
  payload: Row;
  relatedIds?: string[];
}

export class Store {
  constructor(protected readonly pool: Pool) {}

  protected async tx<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      const value = await fn(client);
      await client.query('commit');
      return value;
    } catch (error) {
      await client.query('rollback').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Appends one hash-chained audit event and its outbox message in the caller's transaction.
   * The chain is tamper-evident only against edits that do not also rewrite later hashes;
   * a database superuser can still rewrite everything.
   */
  protected async append(c: PoolClient, ctx: CommandContext, e: EventInput) {
    await c.query('select pg_advisory_xact_lock($1)', [AUDIT_CHAIN_LOCK]);
    const prev = await c.query<{ event_hash: string }>(
      'select event_hash from audit_events order by sequence desc limit 1',
    );
    const clock = await c.query<{ now: Date }>(
      `select date_trunc('milliseconds', clock_timestamp()) as now`,
    );
    const eventId = randomUUID();
    const correlationId = ctx.correlationId ?? randomUUID();
    const causationId = ctx.causationId ?? null;
    const occurredAt = (clock.rows[0]?.now ?? new Date()).toISOString();
    const previousHash = prev.rows[0]?.event_hash ?? null;
    const payload = { ...e.payload, related_ids: e.relatedIds ?? [] };
    const eventHash = canonicalHash({
      previous_hash: previousHash,
      id: eventId,
      workspace_id: e.workspaceId,
      occurred_at: occurredAt,
      actor_id: ctx.actorId,
      action: e.action,
      subject_kind: e.subjectKind,
      subject_id: e.subjectId,
      subject_version: e.subjectVersion,
      content_hash: e.contentHash,
      correlation_id: correlationId,
      causation_id: causationId,
      payload,
    });
    const inserted = await c.query<{ sequence: string }>(
      `insert into audit_events (id, workspace_id, occurred_at, actor_id, action,
         subject_kind, subject_id, subject_version, content_hash, correlation_id,
         causation_id, payload, previous_hash, event_hash)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) returning sequence`,
      [
        eventId,
        e.workspaceId,
        occurredAt,
        ctx.actorId,
        e.action,
        e.subjectKind,
        e.subjectId,
        e.subjectVersion,
        e.contentHash,
        correlationId,
        causationId,
        payload,
        previousHash,
        eventHash,
      ],
    );
    await c.query(
      'insert into outbox (event_id, sequence, topic) values ($1, $2, $3)',
      [eventId, inserted.rows[0]?.sequence, e.action],
    );
    return eventId;
  }

  protected async role(
    c: PoolClient,
    ws: string,
    actorId: string,
    write: boolean,
  ) {
    const { rows } = await c.query<{ role: Role }>(
      'select role from workspace_members where workspace_id = $1 and actor_id = $2',
      [ws, actorId],
    );
    const role = rows[0]?.role;
    // Non-members cannot learn whether a workspace exists.
    if (!role) throw fail('NOT_FOUND', 'Workspace not found.');
    if (write && role === 'viewer')
      throw fail('ACCESS_DENIED', 'This actor can only read the workspace.');
    return role;
  }

  /** Replays a stored response for a repeated idempotency key, or rejects a changed request. */
  protected async idempotent<T>(
    ws: string,
    ctx: CommandContext,
    request: unknown,
    run: (c: PoolClient) => Promise<T>,
  ): Promise<T> {
    const key = ctx.idempotencyKey;
    const requestHash = canonicalHash({ actor: ctx.actorId, request });
    const replay = async () => {
      const { rows } = await this.pool.query<{
        request_hash: string;
        response: T;
      }>(
        'select request_hash, response from command_receipts where workspace_id = $1 and idempotency_key = $2',
        [ws, key],
      );
      const row = rows[0];
      if (!row) return undefined;
      if (row.request_hash !== requestHash)
        throw fail(
          'IDEMPOTENCY_CONFLICT',
          'Idempotency key was already used for a different request.',
        );
      return row.response;
    };
    if (key === undefined) return this.tx(run);
    if (!/^[A-Za-z0-9_.:-]{8,200}$/.test(key))
      throw fail(
        'INVALID_CONTRACT',
        'Idempotency key must be 8–200 safe characters.',
      );
    const earlier = await replay();
    if (earlier !== undefined) return earlier;
    try {
      return await this.tx(async (c) => {
        const value = await run(c);
        await c.query(
          'insert into command_receipts (workspace_id, idempotency_key, request_hash, response) values ($1, $2, $3, $4)',
          [ws, key, requestHash, JSON.stringify(value)],
        );
        return value;
      });
    } catch (error) {
      if (!isPgError(error, '23505', 'command_receipts_pkey')) throw error;
      const raced = await replay();
      if (raced === undefined) throw error;
      return raced;
    }
  }

  async ensureActor(actor: Actor): Promise<void> {
    await this.pool.query(
      'insert into actors (id, kind, display_name) values ($1, $2, $3) on conflict (id) do nothing',
      [uuid(actor.id, 'INVALID_CONTRACT'), actor.kind, actor.display_name],
    );
  }

  async createWorkspace(ctx: CommandContext, raw: unknown): Promise<Workspace> {
    ctx = normalize(ctx);
    const req = parse(CreateWorkspaceRequestSchema, raw);
    return this.tx(async (c) => {
      const wsId = randomUUID();
      const { rows } = await c.query(
        `insert into workspaces (id, name, record_mode, fixture, created_by)
         values ($1, $2, $3, $4, $5) returning created_at`,
        [
          wsId,
          req.name,
          req.record_mode,
          req.record_mode === 'fixture',
          ctx.actorId,
        ],
      );
      await c.query(
        `insert into workspace_members (workspace_id, actor_id, role) values ($1, $2, 'owner')`,
        [wsId, ctx.actorId],
      );
      await this.append(c, ctx, {
        workspaceId: wsId,
        action: 'workspace.created',
        subjectKind: 'workspace',
        subjectId: wsId,
        subjectVersion: null,
        contentHash: null,
        payload: { record_mode: req.record_mode },
      });
      return {
        id: wsId,
        name: req.name,
        record_mode: req.record_mode,
        role: 'owner' as const,
        created_at: iso(rows[0]?.created_at),
      };
    });
  }

  async addMember(
    ctx: CommandContext,
    ws: string,
    actorId: string,
    role: Role,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    actorId = uuid(actorId, 'INVALID_CONTRACT');
    return this.tx(async (c) => {
      if ((await this.role(c, ws, ctx.actorId, true)) !== 'owner')
        throw fail('ACCESS_DENIED', 'Only owners can change membership.');
      await c.query(
        'insert into workspace_members (workspace_id, actor_id, role) values ($1, $2, $3)',
        [ws, actorId, role],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'member.added',
        subjectKind: 'actor',
        subjectId: actorId,
        subjectVersion: null,
        contentHash: null,
        payload: { role },
      });
    });
  }

  async listWorkspaces(ctx: CommandContext): Promise<Workspace[]> {
    ctx = normalize(ctx);
    const { rows } = await this.pool.query(
      `select w.id, w.name, w.record_mode, m.role, w.created_at
       from workspaces w join workspace_members m on m.workspace_id = w.id
       where m.actor_id = $1 order by w.created_at, w.id`,
      [ctx.actorId],
    );
    return rows.map((r: Row) => ({
      id: String(r.id),
      name: String(r.name),
      record_mode: r.record_mode as Workspace['record_mode'],
      role: r.role as Role,
      created_at: iso(r.created_at),
    }));
  }

  async createEntity(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateEntityRequestSchema, raw);
    if (UNMANAGED_KINDS.includes(req.kind))
      throw fail(
        'INVALID_CONTRACT',
        `Create ${req.kind}s through the decision and grant API, where their authority is enforced.`,
      );
    const body = validateBody(req.kind, req.body);
    const lifecycle = lifecycleField[req.kind];
    if (lifecycle && body[lifecycle.field] !== lifecycle.initial)
      throw fail(
        'INVALID_TRANSITION',
        `A new ${req.kind} starts at ${lifecycle.field}=${lifecycle.initial}; only domain transitions may move it.`,
      );
    return this.idempotent(ws, ctx, { op: 'create', req }, async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const entityId = randomUUID();
      const hash = contentHash(req.kind, req.title, body);
      const { rows } = await c.query(
        `insert into entities (id, workspace_id, fixture, kind, version, status, title, body, content_hash, created_by)
         select $1, w.id, w.fixture, $3, 1, 'active', $4, $5, $6, $7 from workspaces w where w.id = $2
         returning *`,
        [entityId, ws, req.kind, req.title, body, hash, ctx.actorId],
      );
      const eventId = await this.append(c, ctx, {
        workspaceId: ws,
        action: 'entity.created',
        subjectKind: req.kind,
        subjectId: entityId,
        subjectVersion: 1,
        contentHash: hash,
        payload: { kind: req.kind },
      });
      await c.query(
        `insert into entity_versions (entity_id, workspace_id, version, status, title, body, content_hash, reason, corrects_version, actor_id, event_id)
         values ($1, $2, 1, 'active', $3, $4, $5, null, null, $6, $7)`,
        [entityId, ws, req.title, body, hash, ctx.actorId, eventId],
      );
      return toEntity(rows[0] as Row);
    });
  }

  protected async lockCurrent(
    c: PoolClient,
    ws: string,
    entityId: string,
    expected: number,
  ) {
    const { rows } = await c.query(
      'select * from entities where workspace_id = $1 and id = $2 for update',
      [ws, entityId],
    );
    const row = rows[0] as Row | undefined;
    if (!row) throw fail('NOT_FOUND', 'Record not found.');
    if (Number(row.version) !== expected)
      throw fail(
        'VERSION_CONFLICT',
        `Expected version ${expected}, but the record is at ${String(row.version)}.`,
      );
    return toEntity(row);
  }

  private async writeVersion(
    c: PoolClient,
    ctx: CommandContext,
    current: StoredEntity,
    next: {
      status: StoredEntity['status'];
      title: string;
      body: Record<string, unknown> | null;
      hash: string;
      reason: string | null;
      corrects: number | null;
      action: string;
      payload: Row;
    },
  ) {
    const version = current.version + 1;
    const { rows } = await c.query(
      `update entities set version = $3, status = $4, title = $5, body = $6, content_hash = $7, updated_at = now()
       where workspace_id = $1 and id = $2 and version = $8 returning *`,
      [
        current.workspace_id,
        current.id,
        version,
        next.status,
        next.title,
        next.body,
        next.hash,
        current.version,
      ],
    );
    if (!rows[0])
      throw fail('VERSION_CONFLICT', 'Record changed concurrently.');
    const eventId = await this.append(c, ctx, {
      workspaceId: current.workspace_id,
      action: next.action,
      subjectKind: current.kind,
      subjectId: current.id,
      subjectVersion: version,
      contentHash: next.hash,
      payload: { kind: current.kind, ...next.payload },
    });
    await c.query(
      `insert into entity_versions (entity_id, workspace_id, version, status, title, body, content_hash, reason, corrects_version, actor_id, event_id)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
      [
        current.id,
        current.workspace_id,
        version,
        next.status,
        next.title,
        next.body,
        next.hash,
        next.reason,
        next.corrects,
        ctx.actorId,
        eventId,
      ],
    );
    return toEntity(rows[0] as Row);
  }

  /** Appends a new immutable version; a correction names the version it supersedes. */
  async reviseEntity(
    ctx: CommandContext,
    ws: string,
    entityId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    entityId = uuid(entityId);
    const req = parse(ReviseEntityRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const current = await this.lockCurrent(
        c,
        ws,
        entityId,
        req.expected_version,
      );
      if (current.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          `A ${current.status} record cannot be revised.`,
        );
      const body = validateBody(current.kind, req.body);
      const lifecycle = lifecycleField[current.kind];
      if (
        lifecycle &&
        body[lifecycle.field] !== current.body?.[lifecycle.field]
      )
        throw fail(
          'INVALID_TRANSITION',
          `${lifecycle.field} changes only through a domain lifecycle transition.`,
        );
      if (
        req.corrects_version !== null &&
        req.corrects_version > current.version
      )
        throw fail(
          'INVALID_CONTRACT',
          'A correction must name an existing version.',
        );
      const hash = contentHash(current.kind, req.title, body);
      if (hash === current.content_hash)
        throw fail(
          'DUPLICATE',
          'Revision is identical to the current version.',
        );
      return this.writeVersion(c, ctx, current, {
        status: 'active',
        title: req.title,
        body,
        hash,
        reason: req.reason,
        corrects: req.corrects_version,
        action:
          req.corrects_version === null ? 'entity.revised' : 'entity.corrected',
        payload:
          req.corrects_version === null
            ? {}
            : { corrects_version: req.corrects_version },
      });
    });
  }

  async archiveEntity(
    ctx: CommandContext,
    ws: string,
    entityId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    entityId = uuid(entityId);
    const req = parse(ArchiveEntityRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const current = await this.lockCurrent(
        c,
        ws,
        entityId,
        req.expected_version,
      );
      if (current.status !== 'active')
        throw fail(
          'INVALID_TRANSITION',
          `A ${current.status} record cannot be archived.`,
        );
      return this.writeVersion(c, ctx, current, {
        status: 'archived',
        title: current.title,
        body: current.body,
        hash: current.content_hash,
        reason: req.reason,
        corrects: null,
        action: 'entity.archived',
        payload: {},
      });
    });
  }

  /**
   * Removes titles, bodies and reasons from every version and leaves a tombstone. Identity,
   * versions, content hashes, links and audit events remain; audit payloads never held content.
   */
  async redactEntity(
    ctx: CommandContext,
    ws: string,
    entityId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    entityId = uuid(entityId);
    const req = parse(RedactEntityRequestSchema, raw);
    return this.tx(async (c) => {
      if ((await this.role(c, ws, ctx.actorId, true)) !== 'owner')
        throw fail('ACCESS_DENIED', 'Only owners can redact records.');
      const current = await this.lockCurrent(
        c,
        ws,
        entityId,
        req.expected_version,
      );
      if (current.status === 'redacted')
        throw fail('INVALID_TRANSITION', 'Record is already redacted.');
      await c.query(
        `update entity_versions set body = null, title = '[redacted]', reason = null
         where workspace_id = $1 and entity_id = $2`,
        [ws, entityId],
      );
      const hash = canonicalHash({
        kind: current.kind,
        redacted_from: current.content_hash,
        reason_code: req.reason_code,
      });
      return this.writeVersion(c, ctx, current, {
        status: 'redacted',
        title: '[redacted]',
        body: null,
        hash,
        reason: null,
        corrects: null,
        action: 'entity.redacted',
        payload: { reason_code: req.reason_code },
      });
    });
  }

  async getEntity(
    ctx: CommandContext,
    ws: string,
    entityId: string,
  ): Promise<EntityDetail> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    entityId = uuid(entityId);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const entity = await c.query(
        'select * from entities where workspace_id = $1 and id = $2',
        [ws, entityId],
      );
      if (!entity.rows[0]) throw fail('NOT_FOUND', 'Record not found.');
      const versions = await c.query(
        'select * from entity_versions where workspace_id = $1 and entity_id = $2 order by version',
        [ws, entityId],
      );
      const links = await c.query(
        `select * from entity_links where workspace_id = $1 and (from_id = $2 or to_id = $2)
         order by created_at, id`,
        [ws, entityId],
      );
      const all = links.rows.map((r: Row) => toLink(r));
      return {
        entity: toEntity(entity.rows[0] as Row),
        versions: versions.rows.map((r: Row) => toVersion(r)),
        outgoing: all.filter((l) => l.from.id === entityId),
        incoming: all.filter((l) => l.to.id === entityId),
      };
    });
  }

  async listEntities(
    ctx: CommandContext,
    ws: string,
    filter: { kind?: string; status?: string } = {},
  ): Promise<StoredEntity[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const kind =
      filter.kind === undefined ? null : parse(StoredKindSchema, filter.kind);
    const status =
      filter.status === undefined
        ? null
        : parse(StoredStatusSchema, filter.status);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from entities where workspace_id = $1
           and ($2::text is null or kind = $2) and ($3::text is null or status = $3)
         order by created_at, id limit 500`,
        [ws, kind, status],
      );
      return rows.map((r: Row) => toEntity(r));
    });
  }

  async createLink(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<StoredLink> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const parsed = parse(CreateLinkRequestSchema, raw);
    const req = {
      ...parsed,
      from: { ...parsed.from, id: parsed.from.id.toLowerCase() },
      to: { ...parsed.to, id: parsed.to.id.toLowerCase() },
    };
    return this.idempotent(ws, ctx, { op: 'link', req }, async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const endpoints = await c.query(
        'select id, workspace_id, kind, version, status from entities where id = any($1::uuid[]) for share',
        [[req.from.id, req.to.id]],
      );
      const find = async (ref: { id: string; version: number }) => {
        const row = endpoints.rows.find((r: Row) => r.id === ref.id) as
          Row | undefined;
        if (!row) throw fail('NOT_FOUND', 'Link endpoint not found.');
        if (row.workspace_id !== ws) {
          const member = await c.query(
            'select 1 from workspace_members where workspace_id = $1 and actor_id = $2',
            [row.workspace_id, ctx.actorId],
          );
          if (member.rowCount === 0)
            throw fail('NOT_FOUND', 'Link endpoint not found.');
          throw fail('SCOPE_EXCEEDED', 'Cross-workspace link denied.');
        }
        if (row.status === 'redacted')
          throw fail(
            'INVALID_TRANSITION',
            'Redacted records accept no new links.',
          );
        if (ref.version > Number(row.version))
          throw fail('NOT_FOUND', 'Link endpoint version not found.');
        return { kind: String(row.kind), id: ref.id, version: ref.version };
      };
      const from = await find(req.from);
      const to = await find(req.to);
      if (
        !isAllowedLink(req.relation, from, to) ||
        (from.id === to.id && req.relation !== 'supersedes')
      )
        throw fail(
          'INVALID_CONTRACT',
          `${from.kind} cannot ${req.relation} ${to.kind}.`,
        );
      const linkId = randomUUID();
      let inserted;
      try {
        inserted = await c.query(
          `insert into entity_links (id, workspace_id, relation, from_id, from_kind, from_version, to_id, to_kind, to_version, rationale, asserted_by)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) returning *`,
          [
            linkId,
            ws,
            req.relation,
            from.id,
            from.kind,
            from.version,
            to.id,
            to.kind,
            to.version,
            req.rationale,
            ctx.actorId,
          ],
        );
      } catch (error) {
        if (isPgError(error, '23505', 'entity_links_active'))
          throw fail('DUPLICATE', 'An identical active link already exists.');
        throw error;
      }
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'link.created',
        subjectKind: 'link',
        subjectId: linkId,
        subjectVersion: null,
        contentHash: null,
        payload: {
          relation: req.relation,
          from_kind: from.kind,
          from_version: from.version,
          to_kind: to.kind,
          to_version: to.version,
        },
        relatedIds: [from.id, to.id],
      });
      return toLink(inserted.rows[0] as Row);
    });
  }

  async retractLink(
    ctx: CommandContext,
    ws: string,
    linkId: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    linkId = uuid(linkId);
    const req = parse(RetractLinkRequestSchema, raw);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, true);
      const { rows } = await c.query(
        `update entity_links set retracted_at = now(), retracted_by = $3, retraction_reason = $4
         where workspace_id = $1 and id = $2 and retracted_at is null returning *`,
        [ws, linkId, ctx.actorId, req.reason],
      );
      const row = rows[0] as Row | undefined;
      if (!row) throw fail('NOT_FOUND', 'Active link not found.');
      const link = toLink(row);
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'link.retracted',
        subjectKind: 'link',
        subjectId: linkId,
        subjectVersion: null,
        contentHash: null,
        payload: {
          relation: link.relation,
          from_kind: link.from.kind,
          from_version: link.from.version,
          to_kind: link.to.kind,
          to_version: link.to.version,
        },
        relatedIds: [link.from.id, link.to.id],
      });
      return link;
    });
  }

  /**
   * Walks active typed links toward origins (upstream) or descendants (downstream), so
   * lineage is many-to-many rather than a single parent ID.
   */
  async lineage(
    ctx: CommandContext,
    ws: string,
    entityId: string,
    direction: 'upstream' | 'downstream',
    maxDepth = 8,
  ): Promise<{ depth: number; link: StoredLink }[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    entityId = uuid(entityId);
    const originIsTo = Object.entries(provenanceOrigin)
      .filter(([, side]) => side === 'to')
      .map(([relation]) => relation);
    const [near, far] =
      direction === 'upstream'
        ? ['descendant_id', 'origin_id']
        : ['origin_id', 'descendant_id'];
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `with recursive edges as (
           select id,
             case when relation = any($4::text[]) then to_id else from_id end as origin_id,
             case when relation = any($4::text[]) then from_id else to_id end as descendant_id
           from entity_links where workspace_id = $1 and retracted_at is null
         ), walk (link_id, next_id, depth, path) as (
           select e.id, e.${far}, 1, array[e.id] from edges e where e.${near} = $2
           union all
           select e.id, e.${far}, w.depth + 1, w.path || e.id
           from walk w join edges e on e.${near} = w.next_id
           where w.depth < $3 and not e.id = any(w.path)
         )
         select distinct on (l.id) w.depth, l.*
         from walk w join entity_links l on l.id = w.link_id
         order by l.id, w.depth`,
        [ws, entityId, maxDepth, originIsTo],
      );
      return rows
        .map((r: Row) => ({ depth: Number(r.depth), link: toLink(r) }))
        .sort(
          (a, b) =>
            a.depth - b.depth ||
            a.link.created_at.localeCompare(b.link.created_at),
        );
    });
  }

  async listHistory(
    ctx: CommandContext,
    ws: string,
    filter: { subjectId?: string; limit?: number } = {},
  ): Promise<HistoryEntry[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const subject =
      filter.subjectId === undefined ? null : uuid(filter.subjectId);
    const limit = Math.min(Math.max(filter.limit ?? 200, 1), 500);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from history_projection where workspace_id = $1
           and ($2::uuid is null or subject_id = $2 or $2 = any(related_ids))
         order by sequence desc limit $3`,
        [ws, subject, limit],
      );
      return rows.map((r: Row) => toHistory(r));
    });
  }

  /** Idempotent consumer: the inbox row makes repeated delivery of one event a no-op. */
  private async project(c: PoolClient, eventId: string): Promise<boolean> {
    const claim = await c.query(
      'insert into consumer_inbox (consumer, event_id) values ($1, $2) on conflict do nothing',
      [HISTORY_CONSUMER, eventId],
    );
    if (claim.rowCount === 0) return false;
    const { rows } = await c.query('select * from audit_events where id = $1', [
      eventId,
    ]);
    const e = rows[0] as Row | undefined;
    if (!e) throw fail('NOT_FOUND', 'Audit event not found.');
    const payload = e.payload as Row;
    const related = Array.isArray(payload.related_ids)
      ? payload.related_ids
      : [];
    await c.query(
      `insert into history_projection (event_id, sequence, workspace_id, occurred_at, actor_id, action,
         subject_kind, subject_id, subject_version, content_hash, correlation_id, causation_id, related_ids, summary)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [
        e.id,
        e.sequence,
        e.workspace_id,
        e.occurred_at,
        e.actor_id,
        e.action,
        e.subject_kind,
        e.subject_id,
        e.subject_version,
        e.content_hash,
        e.correlation_id,
        e.causation_id,
        related,
        summarize(
          String(e.action),
          String(e.subject_kind),
          e.subject_version,
          payload,
        ),
      ],
    );
    return true;
  }

  /** Delivers one outbox message. Safe to call repeatedly (at-least-once delivery). */
  async deliver(eventId: string): Promise<boolean> {
    eventId = uuid(eventId);
    return this.tx(async (c) => {
      const applied = await this.project(c, eventId);
      await c.query(
        'update outbox set attempts = attempts + 1, delivered_at = coalesce(delivered_at, now()) where event_id = $1',
        [eventId],
      );
      return applied;
    });
  }

  /** Relays pending outbox messages in database order; concurrent relays skip claimed rows. */
  async drainOutbox(batch = 100): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.tx(async (c) => {
        const { rows } = await c.query<{ event_id: string }>(
          `select event_id from outbox where delivered_at is null
           order by sequence limit $1 for update skip locked`,
          [batch],
        );
        for (const r of rows) {
          await this.project(c, r.event_id);
          await c.query(
            'update outbox set attempts = attempts + 1, delivered_at = now() where event_id = $1',
            [r.event_id],
          );
        }
        return rows.length;
      });
      total += n;
      if (n < batch) return total;
    }
  }

  /** Recomputes the audit hash chain; returns the first broken sequence, if any. */
  async verifyAuditChain(): Promise<{
    ok: boolean;
    events: number;
    broken_at: string | null;
  }> {
    const { rows } = await this.pool.query(
      'select * from audit_events order by sequence',
    );
    let previous: string | null = null;
    for (const e of rows as Row[]) {
      const expected = canonicalHash({
        previous_hash: previous,
        id: e.id,
        workspace_id: e.workspace_id,
        occurred_at: iso(e.occurred_at),
        actor_id: e.actor_id,
        action: e.action,
        subject_kind: e.subject_kind,
        subject_id: e.subject_id,
        subject_version: e.subject_version,
        content_hash: e.content_hash,
        correlation_id: e.correlation_id,
        causation_id: e.causation_id,
        payload: e.payload,
      });
      if (e.previous_hash !== previous || e.event_hash !== expected)
        return {
          ok: false,
          events: rows.length,
          broken_at: String(e.sequence),
        };
      previous = String(e.event_hash);
    }
    return { ok: true, events: rows.length, broken_at: null };
  }
}
