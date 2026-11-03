import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  AllocateRequestSchema,
  AttestRailRequestSchema,
  CommitmentRequestSchema,
  ContractError,
  CreateCheckoutRequestSchema,
  CreateOfferRequestSchema,
  PAYMENTS_POLICY_VERSION,
  PaymentSnapshotSchema,
  PayoutSnapshotSchema,
  BalanceSnapshotSchema,
  RecordOwnerFundingRequestSchema,
  RegisterPaymentConnectionRequestSchema,
  RegisterRailRequestSchema,
  RevokePaymentConnectionRequestSchema,
  SetRailStatusRequestSchema,
  SetReinvestmentPolicyRequestSchema,
  parse,
  type Allocation,
  type BalanceSnapshot,
  type Capacity,
  type Checkout,
  type Entitlement,
  type LedgerAccount,
  type LedgerEntry,
  type Offer,
  type PaymentConnection,
  type PaymentSnapshot,
  type PayoutSnapshot,
  type ReinvestmentPolicy,
} from '@creator/contracts';
import {
  NANO_PER_CENT,
  canonicalHash,
  consume,
  correction,
  entitlementFor,
  nextEntitlementStatus,
  paymentEconomics,
  paymentEntries,
  payoutEntries,
  periodStart,
  tightest,
  trancheCap,
  type Postings,
} from '@creator/domain';
import { DesktopJobStore } from './desktop-job-store.js';
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

// X07 store: processor connections, offers, an immutable double-entry ledger keyed by economic
// transaction, entitlements and reinvestment. Only snapshots the backend read from the
// processor reach the ledger; a webhook body or a checkout redirect never does.

/** A processor-balance observation is usable this long; an owner attestation a day. */
export const PROCESSOR_BALANCE_TTL_MS = 15 * 60_000;
export const ATTESTATION_TTL_MS = 24 * 3_600_000;
/** Holdback applied to earnings that settle while no reinvestment policy exists. */
const DEFAULT_HOLDBACK_DAYS = 30;
const REINVEST_LOCK = 'creator:reinvest:';

const big = (v: unknown) =>
  BigInt(v === null || v === undefined ? 0 : String(v));
const s = (v: bigint) => v.toString();
const pos = (v: bigint) => (v > 0n ? v : 0n);

function toConnection(r: Row): PaymentConnection {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    fixture: Boolean(r.fixture),
    version: Number(r.version),
    status: r.status as PaymentConnection['status'],
    body: r.body as PaymentConnection['body'],
    body_hash: String(r.body_hash),
    verification: (r.verification as PaymentConnection['verification']) ?? null,
    status_reason: (r.status_reason as string | null) ?? null,
    created_at: iso(r.created_at),
    updated_at: iso(r.updated_at),
  };
}
function toOffer(r: Row): Offer {
  return {
    id: String(r.id),
    workspace_id: String(r.workspace_id),
    connection_id: String(r.connection_id),
    product_id: String(r.product_id),
    artifact_id: String(r.artifact_id),
    manifest_sha256: String(r.manifest_sha256),
    label: String(r.label),
    price_nano_usd: String(r.price_nano),
    status: r.status as Offer['status'],
    created_at: iso(r.created_at),
  };
}
function toCheckout(r: Row): Checkout {
  return {
    id: String(r.id),
    offer_id: String(r.offer_id),
    customer_ref: String(r.customer_ref),
    state: r.state as Checkout['state'],
    processor_session_id: (r.processor_session_id as string | null) ?? null,
    url: (r.url as string | null) ?? null,
    reason: (r.reason as string | null) ?? null,
    created_at: iso(r.created_at),
  };
}
function toEntitlement(r: Row): Entitlement {
  return {
    id: String(r.id),
    offer_id: String(r.offer_id),
    payment_id: String(r.payment_id),
    customer_ref: String(r.customer_ref),
    product_id: String(r.product_id),
    artifact_id: String(r.artifact_id),
    manifest_sha256: String(r.manifest_sha256),
    status: r.status as Entitlement['status'],
    reason: String(r.reason),
    version: Number(r.version),
    updated_at: iso(r.updated_at),
  };
}

export type WebhookOutcome =
  'applied' | 'rejected' | 'duplicate' | 'deferred' | 'ignored';
export interface EventMeta {
  processor_event_id: string;
  event_type: string;
  payload_hash: string;
}

export class PaymentStore extends DesktopJobStore {
  async #fixtureWorkspace(c: PoolClient, ws: string) {
    const { rows } = await c.query<{ fixture: boolean }>(
      'select fixture from workspaces where id = $1',
      [ws],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Workspace not found.');
    return rows[0].fixture;
  }
  async #connection(
    c: PoolClient,
    ws: string | null,
    id: string,
    lock = false,
  ) {
    const { rows } = await c.query(
      `select * from payment_connections where id = $1 ${ws ? 'and workspace_id = $2' : ''}${lock ? ' for update' : ''}`,
      ws ? [uuid(id), ws] : [uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Payment connection not found.');
    return toConnection(rows[0] as Row);
  }
  async #reinvestLock(c: PoolClient, ws: string) {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [
      REINVEST_LOCK + ws,
    ]);
  }

  // ---- Connections --------------------------------------------------------------------------

  /** A newer read fences an older one; no database connection is held during processor I/O. */
  async #readObservation<T>(
    ctx: CommandContext,
    connectionId: string,
    observed: T | (() => Promise<T>),
    ws?: string,
    railId?: string,
  ) {
    const epoch = await this.tx(async (c) => {
      const conn = await this.#connection(
        c,
        ws ? uuid(ws) : null,
        connectionId,
        true,
      );
      if (ws) await this.requireOwner(c, conn.workspace_id, ctx.actorId);
      this.#usable(conn, false);
      const { rows } = await c.query(
        'update payment_connections set observation_epoch=observation_epoch+1 where id=$1 returning observation_epoch::text as epoch',
        [conn.id],
      );
      await this.append(c, ctx, {
        workspaceId: conn.workspace_id,
        action: 'payment.observation_started',
        subjectKind: 'payment_connection',
        subjectId: conn.id,
        subjectVersion: conn.version,
        contentHash: null,
        payload: { epoch: rows[0].epoch },
      });
      return String(rows[0].epoch);
    });
    try {
      return {
        epoch,
        value:
          typeof observed === 'function'
            ? await (observed as () => Promise<T>)()
            : observed,
      };
    } catch (e) {
      if (
        railId &&
        ws &&
        e instanceof ContractError &&
        ['STORAGE_UNAVAILABLE', 'ACCESS_DENIED'].includes(e.code)
      )
        await this.setRailStatus(
          ctx,
          ws,
          railId,
          {
            status: 'unavailable',
            reason:
              'Processor balance observation failed; verify the rail before restoring availability.',
          },
          { connectionId, epoch },
        );
      throw e;
    }
  }
  async #checkObservation(c: PoolClient, connectionId: string, epoch: string) {
    const r = await c.query(
      'select observation_epoch::text as epoch from payment_connections where id=$1',
      [connectionId],
    );
    if (r.rows[0]?.epoch !== epoch)
      throw fail(
        'VERSION_CONFLICT',
        'A newer processor observation started; retry this read rather than applying stale state.',
      );
  }

  /**
   * Registers a processor connection in a fixture workspace. Real workspaces would need live
   * payments, which are not built: test-mode money is not money, so it never funds real budgets.
   */
  async registerPaymentConnection(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const body = parse(RegisterPaymentConnectionRequestSchema, raw);
    return this.idempotent(
      ws,
      ctx,
      { op: 'payment.connect', body },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        if (!(await this.#fixtureWorkspace(c, ws)))
          throw fail(
            'LIVE_DISABLED',
            'Real workspaces need live payments, which are not activated; use a fixture workspace for fixture and test-mode processors.',
          );
        const id = randomUUID();
        if (body.processor === 'stripe') {
          await c.query('select pg_advisory_xact_lock(hashtext($1))', [
            'creator:stripe-account:' + body.account_id,
          ]);
          const existing = await c.query(
            "select id from payment_connections where body->>'processor' = 'stripe' and body->>'account_id' = $1",
            [body.account_id],
          );
          if (existing.rowCount)
            throw fail(
              'DUPLICATE',
              'This Stripe account is already registered. Reusing its identity prevents counting the same economic transaction twice.',
            );
        }
        const bodyHash = canonicalHash(body);
        const { rows } = await c.query(
          `insert into payment_connections (id, workspace_id, fixture, version, status, body,
           body_hash, created_by) values ($1,$2,true,1,'unverified',$3,$4,$5) returning *`,
          [id, ws, JSON.stringify(body), bodyHash, ctx.actorId],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'payment.connection_registered',
          subjectKind: 'payment_connection',
          subjectId: id,
          subjectVersion: 1,
          contentHash: bodyHash,
          payload: {
            processor: body.processor,
            mode: body.mode,
            policy_version: PAYMENTS_POLICY_VERSION,
          },
        });
        return toConnection(rows[0] as Row);
      },
    );
  }
  async #setConnection(
    c: PoolClient,
    ctx: CommandContext,
    conn: PaymentConnection,
    status: PaymentConnection['status'],
    reason: string | null,
    verification?: PaymentConnection['verification'],
  ) {
    const { rows } = await c.query(
      `update payment_connections set status = $2, status_reason = $3,
         verification = coalesce($4::jsonb, verification), version = version + 1,
         updated_at = clock_timestamp() where id = $1 returning *`,
      [
        conn.id,
        status,
        reason,
        verification ? JSON.stringify(verification) : null,
      ],
    );
    const next = toConnection(rows[0] as Row);
    await this.append(c, ctx, {
      workspaceId: conn.workspace_id,
      action: `payment.connection_${status}`,
      subjectKind: 'payment_connection',
      subjectId: conn.id,
      subjectVersion: next.version,
      contentHash: conn.body_hash,
      payload: { from: conn.status, to: status, reason },
    });
    return next;
  }
  /** Records what the processor said the credential belongs to; only a match activates. */
  async recordPaymentVerification(
    ctx: CommandContext,
    ws: string,
    id: string,
    observed: { id: string; livemode: boolean } | { error: string },
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const conn = await this.#connection(c, ws, id, true);
      if (conn.status === 'revoked')
        throw fail('INVALID_TRANSITION', 'The connection is revoked.');
      const at = new Date().toISOString();
      if ('error' in observed)
        return this.#setConnection(
          c,
          ctx,
          conn,
          conn.status === 'active' ? 'active' : 'unverified',
          observed.error,
          {
            checked_at: at,
            result: 'refused',
            observed_account: null,
            reason: observed.error.slice(0, 500),
          },
        );
      const result = observed.livemode
        ? 'live_refused'
        : observed.id === conn.body.account_id
          ? 'match'
          : 'wrong_account';
      const reason =
        result === 'match'
          ? 'Account matches the configured account.'
          : result === 'live_refused'
            ? 'The credential is live; live payments are not activated.'
            : 'The credential belongs to a different account.';
      return this.#setConnection(
        c,
        ctx,
        conn,
        result === 'match' ? 'active' : 'rejected',
        reason,
        {
          checked_at: at,
          result,
          observed_account: observed.id.slice(0, 200),
          reason,
        },
      );
    });
  }
  async revokePaymentConnection(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RevokePaymentConnectionRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const conn = await this.#connection(c, ws, id, true);
      if (conn.version !== req.expected_version)
        throw fail('VERSION_CONFLICT', 'The connection changed; reload it.');
      if (conn.status === 'revoked')
        throw fail('INVALID_TRANSITION', 'Already revoked.');
      return this.#setConnection(c, ctx, conn, 'revoked', req.reason);
    });
  }
  async listPaymentConnections(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        'select * from payment_connections where workspace_id = $1 order by created_at limit 100',
        [ws],
      );
      return rows.map((r) => toConnection(r as Row));
    });
  }
  async getPaymentConnection(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.#connection(c, ws, id);
    });
  }
  /** For the webhook receiver, which is authenticated by signature, not by a session. */
  async paymentConnectionForWebhook(id: string) {
    if (!/^[0-9a-f-]{36}$/i.test(id))
      throw fail('NOT_FOUND', 'Payment connection not found.');
    return this.tx((c) => this.#connection(c, null, id));
  }

  // ---- Offers and checkout ------------------------------------------------------------------

  /**
   * A release and whether it is current as Gallery computes it: the latest build of its spec,
   * for the spec's current version. A replaced release is not sold (2026-10-26 review).
   */
  async #release(c: PoolClient, ws: string, artifactId: string) {
    const { rows } = await c.query(
      `select a.product_id, a.manifest_sha256, a.state,
         (e.version = a.spec_version and not exists (
           select 1 from artifact_manifests b where b.workspace_id = a.workspace_id
             and b.spec_id = a.spec_id and b.created_at > a.created_at)) as current
       from artifact_manifests a join entities e on e.id = a.spec_id
       where a.workspace_id = $1 and a.id = $2`,
      [ws, artifactId],
    );
    return rows[0] as Row | undefined;
  }

  async createOffer(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateOfferRequestSchema, raw);
    return this.idempotent(ws, ctx, { op: 'payment.offer', req }, async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const conn = await this.#connection(c, ws, req.connection_id);
      if (conn.status !== 'active')
        throw fail('INVALID_TRANSITION', 'The connection is not active.');
      const price = BigInt(req.price_nano_usd);
      if (price === 0n || price % NANO_PER_CENT !== 0n)
        throw fail(
          'INVALID_CONTRACT',
          'Prices are a positive whole number of cents.',
        );
      // Current as Gallery computes it: the latest build of its spec, for the spec's current
      // version. A replaced release is not offered for sale (2026-10-26 review).
      const manifest = await this.#release(c, ws, uuid(req.artifact_id));
      if (!manifest) throw fail('NOT_FOUND', 'Release (artifact) not found.');
      if (manifest.state !== 'verified')
        throw fail('MISSING_EVIDENCE', 'Only a verified release can be sold.');
      if (manifest.current !== true)
        throw fail(
          'INVALID_TRANSITION',
          'This release has been replaced by a newer build or spec version; sell the current one.',
        );
      if (manifest.manifest_sha256 !== req.manifest_sha256)
        throw fail(
          'EVIDENCE_MISMATCH',
          'The manifest hash does not match the release.',
        );
      const id = randomUUID();
      const { rows } = await c.query(
        `insert into payment_offers (id, workspace_id, connection_id, product_id, artifact_id,
           manifest_sha256, label, price_nano, status, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,'active',$9) returning *`,
        [
          id,
          ws,
          conn.id,
          String(manifest.product_id),
          uuid(req.artifact_id),
          req.manifest_sha256,
          req.label,
          s(price),
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'payment.offer_created',
        subjectKind: 'payment_offer',
        subjectId: id,
        subjectVersion: null,
        contentHash: req.manifest_sha256,
        payload: { price_nano: s(price), artifact_id: req.artifact_id },
        relatedIds: [req.artifact_id, conn.id],
      });
      return toOffer(rows[0] as Row);
    });
  }
  async archiveOffer(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const { rows } = await c.query(
        `update payment_offers set status = 'archived' where workspace_id = $1 and id = $2
         and status = 'active' returning *`,
        [ws, uuid(id)],
      );
      if (!rows[0])
        throw fail('INVALID_TRANSITION', 'No active offer with that id.');
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'payment.offer_archived',
        subjectKind: 'payment_offer',
        subjectId: String(rows[0].id),
        subjectVersion: null,
        contentHash: null,
        payload: {},
      });
      return toOffer(rows[0] as Row);
    });
  }
  /** Newest first, one page of at most 200 (audit L-9); `before` reads the next older page. */
  async listOffers(ctx: CommandContext, ws: string, page?: PageRequest) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const { before, limit } = readPage(page, 200);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await checkPageStart(c, 'payment_offers', ws, before);
      const { rows } = await c.query(
        `select * from payment_offers where workspace_id = $1
           and ${olderThan('payment_offers', 2)}
         order by ${newestOrder('payment_offers')} limit $3`,
        [ws, before, limit],
      );
      return rows.map((r) => toOffer(r as Row));
    });
  }
  /** What the service needs to ask the processor for a checkout session. */
  async checkoutTarget(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CreateCheckoutRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const { rows } = await c.query(
        'select * from payment_offers where workspace_id = $1 and id = $2',
        [ws, uuid(req.offer_id)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Offer not found.');
      const offer = toOffer(rows[0] as Row);
      if (offer.status !== 'active')
        throw fail('INVALID_TRANSITION', 'The offer is archived.');
      const conn = await this.#connection(c, ws, offer.connection_id);
      if (conn.status !== 'active')
        throw fail('INVALID_TRANSITION', 'The connection is not active.');
      // The offer was for the current release when created; a later build or spec version
      // replaces it, and a buyer must not pay for the replaced one.
      if ((await this.#release(c, ws, offer.artifact_id))?.current !== true)
        throw fail(
          'INVALID_TRANSITION',
          'This offer sells a release that has been replaced; archive it and offer the current release.',
        );
      return { req, offer, connection: conn };
    });
  }
  async listCheckouts(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const { rows } = await c.query(
        'select * from payment_checkouts where workspace_id = $1 order by created_at desc limit 50',
        [ws],
      );
      return rows.map((r) => toCheckout(r as Row));
    });
  }
  /**
   * An owner-only test buyer acting on an open checkout of the simulated processor, in a
   * fixture workspace. Records who asked; the processor change itself is in memory and
   * reaches the ledger only through a signed delivery.
   */
  async testBuyerTarget(
    ctx: CommandContext,
    ws: string,
    checkoutId: string,
    request: string | null,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      if (!(await this.#fixtureWorkspace(c, ws)))
        throw fail(
          'LIVE_DISABLED',
          'The test buyer works only in fixture workspaces.',
        );
      const { rows } = await c.query(
        'select * from payment_checkouts where workspace_id = $1 and id = $2',
        [ws, uuid(checkoutId)],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Checkout not found.');
      const checkout = toCheckout(rows[0] as Row);
      if (checkout.state !== 'open' || !checkout.processor_session_id)
        throw fail('INVALID_TRANSITION', 'This checkout never opened.');
      const { rows: o } = await c.query(
        'select * from payment_offers where workspace_id = $1 and id = $2',
        [ws, checkout.offer_id],
      );
      const offer = toOffer(o[0] as Row);
      const connection = await this.#connection(c, ws, offer.connection_id);
      if (connection.body.processor !== 'fixture')
        throw fail(
          'INVALID_TRANSITION',
          'Only the simulated processor has a test buyer; for Stripe test mode, pay on the checkout page and forward its webhooks.',
        );
      if (request)
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'payment.test_buyer_requested',
          subjectKind: 'payment_checkout',
          subjectId: checkout.id,
          subjectVersion: null,
          contentHash: null,
          payload: { request },
          relatedIds: [offer.id, connection.id],
        });
      return { checkout, offer, connection };
    });
  }
  async recordCheckout(
    ctx: CommandContext,
    ws: string,
    offer: Offer,
    customerRef: string,
    result: { session_id: string; url: string } | { error: string },
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      const id = randomUUID();
      const ok = 'session_id' in result;
      const { rows } = await c.query(
        `insert into payment_checkouts (id, workspace_id, offer_id, customer_ref, state,
           processor_session_id, url, reason, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9) returning *`,
        [
          id,
          ws,
          offer.id,
          customerRef,
          ok ? 'open' : 'failed',
          ok ? result.session_id : null,
          ok ? result.url : null,
          ok ? null : result.error.slice(0, 500),
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: ok ? 'payment.checkout_opened' : 'payment.checkout_failed',
        subjectKind: 'payment_checkout',
        subjectId: id,
        subjectVersion: null,
        contentHash: null,
        payload: { offer_id: offer.id },
        relatedIds: [offer.id],
      });
      return toCheckout(rows[0] as Row);
    });
  }

  // ---- Webhook receipts ---------------------------------------------------------------------

  async recordPaymentEvent(
    connectionId: string,
    status: Exclude<WebhookOutcome, 'applied'>,
    reason: string,
    meta: Partial<EventMeta> & { payload_hash: string },
  ) {
    await this.pool.query(
      `insert into payment_events (id, connection_id, processor_event_id, event_type, status,
         reason, payload_hash) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        randomUUID(),
        connectionId,
        meta.processor_event_id?.slice(0, 200) ?? null,
        meta.event_type?.slice(0, 100) ?? null,
        status,
        reason.slice(0, 500),
        meta.payload_hash,
      ],
    );
  }
  async paymentEventApplied(connectionId: string, eventId: string) {
    const { rows } = await this.pool.query(
      `select 1 from payment_events where connection_id = $1 and processor_event_id = $2
       and status = 'applied'`,
      [connectionId, eventId],
    );
    return rows.length > 0;
  }
  async listPaymentEvents(
    ctx: CommandContext,
    ws: string,
    connectionId: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await this.#connection(c, ws, connectionId);
      const { rows } = await c.query(
        `select processor_event_id, event_type, status, reason, received_at from payment_events
         where connection_id = $1 order by received_at desc limit 200`,
        [uuid(connectionId)],
      );
      return rows.map((r) => ({
        processor_event_id: r.processor_event_id as string | null,
        event_type: r.event_type as string | null,
        status: String(r.status),
        reason: String(r.reason),
        received_at: iso(r.received_at),
      }));
    });
  }
  /** Marks a verified event applied, or reports it as a duplicate (inside the caller's tx). */
  async #claimEvent(
    c: PoolClient,
    connectionId: string,
    meta: EventMeta | null,
  ) {
    if (!meta) return true;
    try {
      await c.query('savepoint claim_event');
      await c.query(
        `insert into payment_events (id, connection_id, processor_event_id, event_type, status,
           reason, payload_hash) values ($1,$2,$3,$4,'applied','Applied from a backend read.',$5)`,
        [
          randomUUID(),
          connectionId,
          meta.processor_event_id,
          meta.event_type,
          meta.payload_hash,
        ],
      );
      await c.query('release savepoint claim_event');
      return true;
    } catch (e) {
      await c.query('rollback to savepoint claim_event');
      if ((e as { code?: string }).code === '23505') return false;
      throw e;
    }
  }

  // ---- Ledger -------------------------------------------------------------------------------

  async #current(c: PoolClient, ws: string, key: string): Promise<Postings> {
    const { rows } = await c.query(
      `select p.account, sum(p.amount_nano) as amount from finance_postings p
       join finance_entries e on e.id = p.entry_id
       where e.workspace_id = $1 and e.economic_key = $2 group by p.account`,
      [ws, key],
    );
    const out: Postings = new Map();
    for (const r of rows as Row[])
      if (big(r.amount) !== 0n)
        out.set(r.account as LedgerAccount, big(r.amount));
    return out;
  }
  /** Brings one economic key to the desired postings: nothing, an original, or a correction. */
  async #post(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    key: string,
    desired: Postings,
    memo: string,
    snapshotId: string | null,
  ) {
    await c.query('select pg_advisory_xact_lock(hashtext($1))', [
      `creator:ledger:${ws}:${key}`,
    ]);
    const delta = correction(desired, await this.#current(c, ws, key));
    if (delta.size === 0) return null;
    const { rows } = await c.query<{ n: number }>(
      `select coalesce(max(revision), 0)::int as n from finance_entries
       where workspace_id = $1 and economic_key = $2`,
      [ws, key],
    );
    const revision = (rows[0]?.n ?? 0) + 1;
    const id = randomUUID();
    const eventId = await this.append(c, ctx, {
      workspaceId: ws,
      action: revision === 1 ? 'finance.posted' : 'finance.corrected',
      subjectKind: 'finance_entry',
      subjectId: id,
      subjectVersion: revision,
      contentHash: null,
      payload: {
        economic_key: key,
        postings: Object.fromEntries([...delta].map(([a, v]) => [a, s(v)])),
      },
    });
    await c.query(
      `insert into finance_entries (id, workspace_id, economic_key, revision, kind, memo,
         snapshot_id, actor_id, event_id) values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [
        id,
        ws,
        key,
        revision,
        revision === 1 ? 'original' : 'correction',
        (revision === 1 ? memo : `Correction: ${memo}`).slice(0, 500),
        snapshotId,
        ctx.actorId,
        eventId,
      ],
    );
    for (const [account, amount] of delta)
      await c.query(
        'insert into finance_postings (entry_id, account, amount_nano) values ($1,$2,$3)',
        [id, account, s(amount)],
      );
    return id;
  }
  async #reconcileKeys(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    prefix: string,
    desired: Map<string, { memo: string; postings: Postings }>,
    snapshotId: string,
  ) {
    // Keys posted before but absent now (a refund that later failed) are brought to zero.
    const { rows } = await c.query<{ economic_key: string }>(
      `select distinct economic_key from finance_entries where workspace_id = $1
       and economic_key like $2`,
      [ws, `${prefix}:%`],
    );
    const keys = new Set([
      ...desired.keys(),
      ...rows.map((r) => r.economic_key),
    ]);
    let posted = 0;
    for (const key of [...keys].sort()) {
      const want = desired.get(key);
      const id = await this.#post(
        c,
        ctx,
        ws,
        key,
        want?.postings ?? new Map(),
        want?.memo ?? `No longer reported by the processor (${key}).`,
        snapshotId,
      );
      if (id) posted += 1;
    }
    return posted;
  }
  async #snapshot(
    c: PoolClient,
    conn: PaymentConnection,
    kind: 'payment' | 'payout' | 'balance',
    objectId: string | null,
    body: unknown,
  ) {
    const id = randomUUID();
    await c.query(
      `insert into payment_snapshots (id, workspace_id, connection_id, object_kind, object_id,
         snapshot, snapshot_hash) values ($1,$2,$3,$4,$5,$6,$7)`,
      [
        id,
        conn.workspace_id,
        conn.id,
        kind,
        objectId,
        JSON.stringify(body),
        canonicalHash(body),
      ],
    );
    return id;
  }
  #usable(conn: PaymentConnection, livemode: boolean) {
    if (conn.status !== 'active')
      throw fail('INVALID_TRANSITION', 'The payment connection is not active.');
    if (livemode)
      throw fail(
        'LIVE_DISABLED',
        'A live-mode object was refused; live payments are not activated.',
      );
  }

  /**
   * Applies one authoritative payment snapshot: ledger keys, entitlement, and the earnings
   * tranche once funds settle. With `event`, the event is claimed once in the same transaction.
   */
  async applyPaymentSnapshot(
    ctx: CommandContext,
    connectionId: string,
    observed: PaymentSnapshot | (() => Promise<PaymentSnapshot>),
    event: EventMeta | null,
    ws?: string,
  ): Promise<{ outcome: 'applied' | 'duplicate'; posted: number }> {
    ctx = normalize(ctx);
    const observation = await this.#readObservation(
      ctx,
      connectionId,
      observed,
      ws,
    );
    return this.tx(async (c) => {
      const conn = await this.#connection(
        c,
        ws ? uuid(ws) : null,
        connectionId,
      );
      if (ws) await this.requireOwner(c, conn.workspace_id, ctx.actorId);
      const wsId = conn.workspace_id;
      await this.#reinvestLock(c, wsId);
      // Recheck and lock the connection after waiting; revocation must fence dispatch.
      const current = await this.#connection(c, wsId, conn.id, true);
      this.#usable(current, false);
      await this.#checkObservation(c, conn.id, observation.epoch);
      if (!(await this.#claimEvent(c, conn.id, event)))
        return { outcome: 'duplicate' as const, posted: 0 };
      const snap = parse(PaymentSnapshotSchema, observation.value);
      this.#usable(current, snap.livemode);
      if (snap.currency !== 'usd')
        throw fail('INVALID_CONTRACT', 'Only USD payments are recorded.');
      const snapshotId = await this.#snapshot(
        c,
        conn,
        'payment',
        snap.id,
        snap,
      );
      const prefix = `${conn.id}:${snap.id}`;
      const posted = await this.#reconcileKeys(
        c,
        ctx,
        wsId,
        prefix,
        paymentEntries(prefix, snap),
        snapshotId,
      );
      await this.#entitlement(c, ctx, conn, snap);
      await this.#tranche(c, ctx, conn, snap);
      return { outcome: 'applied' as const, posted };
    });
  }
  async applyPayoutSnapshot(
    ctx: CommandContext,
    connectionId: string,
    observed: PayoutSnapshot | (() => Promise<PayoutSnapshot>),
    event: EventMeta | null,
    ws?: string,
  ): Promise<{ outcome: 'applied' | 'duplicate'; posted: number }> {
    ctx = normalize(ctx);
    const observation = await this.#readObservation(
      ctx,
      connectionId,
      observed,
      ws,
    );
    return this.tx(async (c) => {
      const conn = await this.#connection(
        c,
        ws ? uuid(ws) : null,
        connectionId,
      );
      if (ws) await this.requireOwner(c, conn.workspace_id, ctx.actorId);
      await this.#reinvestLock(c, conn.workspace_id);
      const current = await this.#connection(
        c,
        conn.workspace_id,
        conn.id,
        true,
      );
      this.#usable(current, false);
      await this.#checkObservation(c, conn.id, observation.epoch);
      if (!(await this.#claimEvent(c, conn.id, event)))
        return { outcome: 'duplicate' as const, posted: 0 };
      const snap = parse(PayoutSnapshotSchema, observation.value);
      this.#usable(current, snap.livemode);
      if (snap.currency !== 'usd')
        throw fail('INVALID_CONTRACT', 'Only USD payouts are recorded.');
      const snapshotId = await this.#snapshot(c, conn, 'payout', snap.id, snap);
      const prefix = `${conn.id}:${snap.id}`;
      const posted = await this.#reconcileKeys(
        c,
        ctx,
        conn.workspace_id,
        prefix,
        payoutEntries(prefix, snap),
        snapshotId,
      );
      return { outcome: 'applied' as const, posted };
    });
  }
  /** Seed money the owner put in. It is funding, never earnings, and never a tranche. */
  async recordOwnerFunding(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RecordOwnerFundingRequestSchema, raw);
    return this.idempotent(
      ws,
      ctx,
      { op: 'finance.owner_funding', req },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        const amount = BigInt(req.amount_nano_usd);
        if (amount === 0n)
          throw fail('INVALID_CONTRACT', 'Funding must be positive.');
        const id = await this.#post(
          c,
          ctx,
          ws,
          `owner_funding:${randomUUID()}`,
          new Map<LedgerAccount, bigint>([
            ['bank', amount],
            ['owner_funding', -amount],
          ]),
          `Owner funding: ${req.evidence}`,
          null,
        );
        return { entry_id: id };
      },
    );
  }
  async ledgerBalances(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select p.account, sum(p.amount_nano) as amount, count(distinct e.id)::int as entries
         from finance_postings p join finance_entries e on e.id = p.entry_id
         where e.workspace_id = $1 group by p.account order by p.account`,
        [ws],
      );
      const balances: Record<string, string> = {};
      let total = 0n;
      for (const r of rows as Row[]) {
        // Accounts that net to zero (a reversed payout, a won dispute) are left out.
        if (big(r.amount) !== 0n)
          balances[String(r.account)] = String(r.amount);
        total += big(r.amount);
      }
      return { balances, total_nano: s(total) };
    });
  }
  async listLedger(ctx: CommandContext, ws: string): Promise<LedgerEntry[]> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select e.*, coalesce(json_agg(json_build_object('account', p.account,
           'amount_nano', p.amount_nano::text) order by p.account), '[]') as postings
         from finance_entries e join finance_postings p on p.entry_id = e.id
         where e.workspace_id = $1 group by e.id order by e.created_at, e.economic_key,
         e.revision limit 1000`,
        [ws],
      );
      return rows.map((r) => ({
        id: String(r.id),
        economic_key: String(r.economic_key),
        revision: Number(r.revision),
        kind: r.kind as LedgerEntry['kind'],
        memo: String(r.memo),
        postings: r.postings as LedgerEntry['postings'],
        created_at: iso(r.created_at),
      }));
    });
  }

  // ---- Entitlements -------------------------------------------------------------------------

  async #entitlement(
    c: PoolClient,
    ctx: CommandContext,
    conn: PaymentConnection,
    snap: PaymentSnapshot,
  ) {
    const offerId = snap.metadata.offer_id;
    if (!offerId || !/^[0-9a-f-]{36}$/i.test(offerId)) return;
    const { rows: o } = await c.query(
      'select * from payment_offers where workspace_id = $1 and id = $2 and connection_id = $3',
      [conn.workspace_id, offerId.toLowerCase(), conn.id],
    );
    if (!o[0]) return;
    const offer = toOffer(o[0] as Row);
    const wanted = entitlementFor(snap, {
      id: offer.id,
      price_nano: BigInt(offer.price_nano_usd),
    });
    const { rows: e } = await c.query(
      'select * from entitlements where connection_id = $1 and payment_id = $2 for update',
      [conn.id, snap.id],
    );
    const current = e[0] ? toEntitlement(e[0] as Row) : null;
    if (!wanted) return;
    const customer = snap.metadata.customer_ref;
    if (!current && (!customer || !/^[A-Za-z0-9_.:-]{3,100}$/.test(customer)))
      return;
    const status = nextEntitlementStatus(
      current?.status ?? null,
      wanted.status,
    );
    if (current && current.status === status) return;
    let row: Row;
    if (!current) {
      const { rows } = await c.query(
        `insert into entitlements (id, workspace_id, offer_id, connection_id, payment_id,
           customer_ref, product_id, artifact_id, manifest_sha256, status, reason, version)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,1) returning *`,
        [
          randomUUID(),
          conn.workspace_id,
          offer.id,
          conn.id,
          snap.id,
          customer,
          offer.product_id,
          offer.artifact_id,
          offer.manifest_sha256,
          status,
          wanted.reason,
        ],
      );
      row = rows[0] as Row;
    } else {
      const { rows } = await c.query(
        `update entitlements set status = $2, reason = $3, version = version + 1,
           updated_at = clock_timestamp() where id = $1 returning *`,
        [current.id, status, wanted.reason],
      );
      row = rows[0] as Row;
    }
    const next = toEntitlement(row);
    await this.append(c, ctx, {
      workspaceId: conn.workspace_id,
      action: `entitlement.${status}`,
      subjectKind: 'entitlement',
      subjectId: next.id,
      subjectVersion: next.version,
      contentHash: next.manifest_sha256,
      payload: {
        from: current?.status ?? null,
        to: status,
        payment_id: snap.id,
      },
      relatedIds: [offer.id, offer.artifact_id],
    });
  }
  async listEntitlements(
    ctx: CommandContext,
    ws: string,
    filter: { offer_id?: string; customer_ref?: string } = {},
    page?: PageRequest,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    // Newest first, one page of at most 500 (audit L-9); `before` reads the next older page.
    const { before, limit } = readPage(page, 500);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await checkPageStart(c, 'entitlements', ws, before);
      const { rows } = await c.query(
        `select * from entitlements where workspace_id = $1
         and ($2::uuid is null or offer_id = $2) and ($3::text is null or customer_ref = $3)
         and ${olderThan('entitlements', 4)}
         order by ${newestOrder('entitlements')} limit $5`,
        [
          ws,
          filter.offer_id ? uuid(filter.offer_id) : null,
          filter.customer_ref ?? null,
          before,
          limit,
        ],
      );
      return rows.map((r) => toEntitlement(r as Row));
    });
  }
  /** Access to one release: only an active entitlement from a verified payment counts. */
  async checkEntitlement(
    ctx: CommandContext,
    ws: string,
    artifactId: string,
    customerRef: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    if (!/^[A-Za-z0-9_.:-]{3,100}$/.test(customerRef))
      throw fail('INVALID_CONTRACT', 'Malformed customer reference.');
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from entitlements where workspace_id = $1 and artifact_id = $2
         and customer_ref = $3 and status = 'active' order by created_at limit 1`,
        [ws, uuid(artifactId), customerRef],
      );
      const e = rows[0] ? toEntitlement(rows[0] as Row) : null;
      return {
        granted: e !== null,
        entitlement: e,
        manifest_sha256: e?.manifest_sha256 ?? null,
      };
    });
  }

  // ---- Reinvestment -------------------------------------------------------------------------

  async #policy(c: PoolClient, ws: string): Promise<ReinvestmentPolicy | null> {
    const { rows } = await c.query(
      `select * from reinvestment_policies where workspace_id = $1 order by version desc limit 1`,
      [ws],
    );
    const r = rows[0] as Row | undefined;
    if (!r) return null;
    return {
      ...(r.body as Omit<
        ReinvestmentPolicy,
        'version' | 'anchor_at' | 'created_at'
      >),
      version: Number(r.version),
      anchor_at: iso(r.anchor_at),
      created_at: iso(r.created_at),
    };
  }
  async setReinvestmentPolicy(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const body = parse(SetReinvestmentPolicyRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      await this.#reinvestLock(c, ws);
      const prev = await this.#policy(c, ws);
      const version = (prev?.version ?? 0) + 1;
      await c.query(
        `insert into reinvestment_policies (workspace_id, version, body, anchor_at, created_by)
         values ($1,$2,$3,coalesce($4::timestamptz, clock_timestamp()),$5)`,
        [
          ws,
          version,
          JSON.stringify(body),
          prev?.anchor_at ?? null,
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'reinvestment.policy_set',
        subjectKind: 'reinvestment_policy',
        subjectId: ws,
        subjectVersion: version,
        contentHash: canonicalHash(body),
        payload: { enabled: body.enabled, eligible_bps: body.eligible_bps },
      });
      return (await this.#policy(c, ws))!;
    });
  }
  async getReinvestmentPolicy(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return this.#policy(c, ws);
    });
  }
  /**
   * Creates the payment's tranche when its funds settle and lowers its cap after later losses.
   * Consumption above a lowered cap becomes a loss to reclaim; until it is covered, new
   * allocations are refused. Pending funds never make a tranche.
   */
  async #tranche(
    c: PoolClient,
    ctx: CommandContext,
    conn: PaymentConnection,
    snap: PaymentSnapshot,
  ) {
    const econ = paymentEconomics(snap);
    const ws = conn.workspace_id;
    const { rows } = await c.query(
      'select * from earnings_tranches where connection_id = $1 and payment_id = $2 for update',
      [conn.id, snap.id],
    );
    const t = rows[0] as Row | undefined;
    if (!t) {
      if (!econ.settled || snap.currency !== 'usd') return;
      const policy = await this.#policy(c, ws);
      const bps = policy?.eligible_bps ?? 0;
      const holdback = policy?.holdback_days ?? DEFAULT_HOLDBACK_DAYS;
      const settledAt = econ.settled_at!;
      const eligibleAt = new Date(
        Date.parse(settledAt) + holdback * 86_400_000,
      ).toISOString();
      const id = randomUUID();
      const cap = trancheCap(econ.earned, econ.loss, bps);
      await c.query(
        `insert into earnings_tranches (id, workspace_id, connection_id, payment_id, bps,
           policy_version, earned_nano, loss_nano, cap_nano, disputed, settled_at, eligible_at)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [
          id,
          ws,
          conn.id,
          snap.id,
          bps,
          policy?.version ?? null,
          s(econ.earned),
          s(econ.loss),
          s(cap),
          econ.dispute_open,
          settledAt,
          eligibleAt,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'reinvestment.tranche_settled',
        subjectKind: 'earnings_tranche',
        subjectId: id,
        subjectVersion: null,
        contentHash: null,
        payload: {
          earned_nano: s(econ.earned),
          cap_nano: s(cap),
          eligible_at: eligibleAt,
        },
      });
      return;
    }
    const loss = econ.loss > big(t.loss_nano) ? econ.loss : big(t.loss_nano);
    const oldCap = big(t.cap_nano);
    const lowered = trancheCap(big(t.earned_nano), loss, Number(t.bps));
    const cap = lowered < oldCap ? lowered : oldCap;
    const consumed = big(t.consumed_nano);
    const clawedBefore = big(t.clawed_nano);
    const excess = pos(consumed - clawedBefore - cap);
    await c.query(
      `update earnings_tranches set loss_nano = $2, cap_nano = $3, clawed_nano = $4,
         disputed = $5 where id = $1`,
      [
        String(t.id),
        s(loss),
        s(cap),
        s(clawedBefore + excess),
        econ.dispute_open,
      ],
    );
    if (excess > 0n) {
      const lossId = randomUUID();
      await c.query(
        `insert into reinvestment_losses (id, workspace_id, tranche_id, amount_nano)
         values ($1,$2,$3,$4)`,
        [lossId, ws, String(t.id), s(excess)],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'reinvestment.loss_recorded',
        subjectKind: 'reinvestment_loss',
        subjectId: lossId,
        subjectVersion: null,
        contentHash: null,
        payload: { amount_nano: s(excess), payment_id: snap.id },
        relatedIds: [String(t.id)],
      });
      await this.#settleLosses(c, ctx, ws);
    }
  }
  /** Reclaims unused reinvested authority (newest first), then repays from eligible earnings. */
  async #settleLosses(c: PoolClient, ctx: CommandContext, ws: string) {
    const outstanding = async () => {
      const { rows } = await c.query(
        `select * from reinvestment_losses where workspace_id = $1
         and amount_nano > reclaimed_nano + repaid_nano order by created_at for update`,
        [ws],
      );
      return rows as Row[];
    };
    let losses = await outstanding();
    if (losses.length === 0) return 0n;
    const fixture = await this.#fixtureWorkspace(c, ws);
    const { rows: envs } = await c.query(
      `select e.*, r.allocation_id from reinvestment_envelopes r
       join budget_envelopes e on e.id = r.envelope_id
       where e.workspace_id = $1 and e.status = 'active' order by r.created_at desc for update of e`,
      [ws],
    );
    for (const e of envs as Row[]) {
      if (losses.length === 0) break;
      // Only an idle envelope can give authority back: in-flight work keeps what it holds.
      if (
        big(e.reserved_nano) !== 0n ||
        big(e.unknown_nano) !== 0n ||
        big(e.allocated_nano) !== 0n
      )
        continue;
      const unspent = pos(big(e.cap_nano) - big(e.incurred_nano));
      let take = 0n;
      for (const l of losses) {
        const need =
          big(l.amount_nano) - big(l.reclaimed_nano) - big(l.repaid_nano);
        const t = need < unspent - take ? need : unspent - take;
        if (t <= 0n) continue;
        await c.query(
          'update reinvestment_losses set reclaimed_nano = reclaimed_nano + $2 where id = $1',
          [String(l.id), s(t)],
        );
        take += t;
      }
      if (take === 0n) continue;
      await c.query(
        `update budget_envelopes set status = 'closed', closed_at = now(), version = version + 1
         where id = $1`,
        [String(e.id)],
      );
      const eventId = await this.append(c, ctx, {
        workspaceId: ws,
        action: 'reinvestment.reclaimed',
        subjectKind: 'envelope',
        subjectId: String(e.id),
        subjectVersion: Number(e.version) + 1,
        contentHash: null,
        payload: { reclaimed_nano: s(take), unspent_nano: s(unspent) },
        relatedIds: [String(e.allocation_id)],
      });
      await this.journal(c, ctx, ws, eventId, 'close', String(e.id), {});
      const rest = unspent - take;
      if (rest > 0n)
        await this.#fundEnvelope(c, ctx, ws, fixture, {
          allocationId: String(e.allocation_id),
          name: String(e.name),
          cap: rest,
          maxInFlight: Number(e.max_in_flight),
          replaces: String(e.id),
        });
      losses = await outstanding();
    }
    if (losses.length > 0) {
      const tranches = await this.#eligibleTranches(c, ws);
      for (const l of losses) {
        const need =
          big(l.amount_nano) - big(l.reclaimed_nano) - big(l.repaid_nano);
        const { uses } = consume(tranches, need);
        let paid = 0n;
        for (const u of uses) {
          await this.#useTranche(c, u.tranche_id, u.amount, null, String(l.id));
          const tr = tranches.find((x) => x.id === u.tranche_id)!;
          tr.remaining -= u.amount;
          paid += u.amount;
        }
        if (paid > 0n)
          await c.query(
            'update reinvestment_losses set repaid_nano = repaid_nano + $2 where id = $1',
            [String(l.id), s(paid)],
          );
      }
    }
    const { rows } = await c.query(
      `select coalesce(sum(amount_nano - reclaimed_nano - repaid_nano), 0) as n
       from reinvestment_losses where workspace_id = $1`,
      [ws],
    );
    return big((rows[0] as Row).n);
  }
  async settleReinvestmentLosses(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      await this.#reinvestLock(c, ws);
      return { outstanding_nano: s(await this.#settleLosses(c, ctx, ws)) };
    });
  }
  async #eligibleTranches(c: PoolClient, ws: string) {
    const { rows } = await c.query(
      `select id, cap_nano + clawed_nano - consumed_nano as remaining from earnings_tranches
       where workspace_id = $1 and eligible_at <= clock_timestamp() and not disputed
       and cap_nano + clawed_nano - consumed_nano > 0
       order by eligible_at, id for update`,
      [ws],
    );
    return (rows as Row[]).map((r) => ({
      id: String(r.id),
      remaining: big(r.remaining),
    }));
  }
  async #useTranche(
    c: PoolClient,
    trancheId: string,
    amount: bigint,
    allocationId: string | null,
    lossId: string | null,
  ) {
    await c.query(
      'update earnings_tranches set consumed_nano = consumed_nano + $2 where id = $1',
      [trancheId, s(amount)],
    );
    await c.query(
      `insert into tranche_uses (id, tranche_id, allocation_id, loss_id, amount_nano)
       values ($1,$2,$3,$4,$5)`,
      [randomUUID(), trancheId, allocationId, lossId, s(amount)],
    );
  }
  /** A new root envelope: reinvested authority is its own budget, journalled as funding. */
  async #fundEnvelope(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    fixture: boolean,
    e: {
      allocationId: string;
      name: string;
      cap: bigint;
      maxInFlight: number;
      replaces: string | null;
    },
  ) {
    const id = randomUUID();
    await c.query(
      `insert into budget_envelopes (id, workspace_id, fixture, parent_id, kind, run_id, name,
         status, cap_nano, max_in_flight, starts_at, ends_at, created_by)
       values ($1,$2,$3,null,'global',null,$4,'active',$5,$6,null,null,$7)`,
      [
        id,
        ws,
        fixture,
        e.name.slice(0, 200),
        s(e.cap),
        e.maxInFlight,
        ctx.actorId,
      ],
    );
    const eventId = await this.append(c, ctx, {
      workspaceId: ws,
      action: 'budget.funded',
      subjectKind: 'envelope',
      subjectId: id,
      subjectVersion: 1,
      contentHash: null,
      payload: {
        kind: 'global',
        cap_nano: s(e.cap),
        fixture,
        source: 'reinvestment',
        allocation_id: e.allocationId,
      },
      relatedIds: e.replaces ? [e.replaces] : [],
    });
    await this.journal(c, ctx, ws, eventId, 'fund', id, {});
    await c.query(
      `insert into reinvestment_envelopes (envelope_id, allocation_id, replaces)
       values ($1,$2,$3)`,
      [id, e.allocationId, e.replaces],
    );
    return id;
  }
  /** Every bound on new reinvestment, computed separately inside the reinvestment lock. */
  async #capacity(
    c: PoolClient,
    ws: string,
  ): Promise<Capacity & { period_start: string | null }> {
    const policy = await this.#policy(c, ws);
    const { rows: lossRows } = await c.query(
      `select coalesce(sum(amount_nano - reclaimed_nano - repaid_nano), 0) as n
       from reinvestment_losses where workspace_id = $1`,
      [ws],
    );
    const outstanding = big((lossRows[0] as Row).n);
    const tranches = await this.#eligibleTranches(c, ws);
    const eligible = tranches.reduce((a, t) => a + t.remaining, 0n);
    const { rows: tr } = await c.query(
      `select coalesce(sum(earned_nano - loss_nano), 0) as n from earnings_tranches
       where workspace_id = $1`,
      [ws],
    );
    const retained = big((tr[0] as Row).n);
    // Spending inside reinvested envelopes (and their descendants) is a use of earlier
    // surplus, already counted through the allocation; everything else is an operating cost.
    const { rows: envs } = await c.query(
      `select e.id, e.parent_id, e.status, e.cap_nano, e.incurred_nano, e.unknown_nano,
         r.envelope_id is not null as reinvested
       from budget_envelopes e left join reinvestment_envelopes r on r.envelope_id = e.id
       where e.workspace_id = $1`,
      [ws],
    );
    const byId = new Map((envs as Row[]).map((e) => [String(e.id), e]));
    const underReinvestment = (e: Row): boolean => {
      for (
        let x: Row | undefined = e;
        x;
        x = x.parent_id ? byId.get(String(x.parent_id)) : undefined
      )
        if (x.reinvested) return true;
      return false;
    };
    let costs = 0n;
    let allocatedNet = 0n;
    let unspentReinvested = 0n;
    for (const e of envs as Row[]) {
      if (e.reinvested) {
        const spent = big(e.incurred_nano) + big(e.unknown_nano);
        if (e.status === 'closed') allocatedNet += spent;
        else {
          allocatedNet += big(e.cap_nano);
          unspentReinvested += pos(big(e.cap_nano) - big(e.incurred_nano));
        }
      } else if (!underReinvestment(e))
        costs += big(e.incurred_nano) + big(e.unknown_nano);
    }
    const surplus = retained - costs - allocatedNet;
    const { rows: rails } = await c.query(
      `select r.id, r.label, r.status, r.kind, pc.status as connection_status,
         o.available_nano, o.expires_at
       from funding_rails r
       left join payment_connections pc on pc.id = r.connection_id
       left join lateral (select available_nano, expires_at from rail_observations
         where rail_id = r.id order by observed_at desc limit 1) o on true
       where r.workspace_id = $1 order by r.created_at`,
      [ws],
    );
    let railsAvailable = 0n;
    const unavailable: string[] = [];
    for (const r of rails as Row[]) {
      const fresh = r.expires_at && Date.parse(iso(r.expires_at)) > Date.now();
      const connOk =
        r.kind !== 'processor_balance' || r.connection_status === 'active';
      if (r.status === 'available' && fresh && connOk)
        railsAvailable += pos(big(r.available_nano));
      else
        unavailable.push(
          `${String(r.label)}: ${r.status !== 'available' ? 'marked unavailable' : !connOk ? 'connection not active' : 'no fresh balance'}`,
        );
    }
    const { rows: cm } = await c.query(
      `select coalesce(sum(amount_nano), 0) as n from finance_commitments
       where workspace_id = $1 and status = 'open'`,
      [ws],
    );
    const commitments = big((cm[0] as Row).n);
    const reserve = BigInt(policy?.min_reserve_nano_usd ?? '0');
    const liquidity =
      railsAvailable - reserve - commitments - unspentReinvested - outstanding;
    let periodRemaining = 0n;
    let start: string | null = null;
    if (policy) {
      start = periodStart(
        Date.parse(policy.anchor_at),
        policy.period_days,
        Date.now(),
      ).toISOString();
      const { rows: pa } = await c.query(
        `select coalesce(sum(amount_nano), 0) as n from reinvestment_allocations
         where workspace_id = $1 and period_start = $2`,
        [ws, start],
      );
      periodRemaining = pos(
        BigInt(policy.period_cap_nano_usd) - big((pa[0] as Row).n),
      );
    }
    const enabled = policy?.enabled === true;
    const frozen = outstanding > 0n;
    const picked = !enabled
      ? { capacity: 0n, binding: 'policy_disabled' }
      : frozen
        ? { capacity: 0n, binding: 'losses_outstanding' }
        : tightest([
            { name: 'eligible_tranches', value: eligible },
            { name: 'surplus', value: surplus },
            { name: 'usable_liquidity', value: liquidity },
            { name: 'period_cap', value: periodRemaining },
          ]);
    return {
      enabled,
      frozen,
      policy_version: policy?.version ?? null,
      eligible_tranches_nano: s(eligible),
      surplus_nano: s(surplus),
      usable_liquidity_nano: s(liquidity),
      period_remaining_nano: s(periodRemaining),
      outstanding_losses_nano: s(outstanding),
      capacity_nano: s(picked.capacity),
      binding: picked.binding,
      parts: {
        retained_earnings_nano: s(retained),
        costs_outside_reinvestment_nano: s(pos(costs)),
        allocated_net_nano: s(pos(allocatedNet)),
        rails_available_nano: s(railsAvailable),
        unavailable_rails: unavailable,
        min_reserve_nano: s(reserve),
        commitments_nano: s(commitments),
        unspent_reinvested_nano: s(unspentReinvested),
      },
      period_start: start,
    };
  }
  async reinvestmentCapacity(
    ctx: CommandContext,
    ws: string,
  ): Promise<Capacity> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await this.#reinvestLock(c, ws);
      const { period_start: _p, ...cap } = await this.#capacity(c, ws);
      return cap;
    });
  }
  /**
   * Turns eligible settled earnings into a new budget envelope. Each tranche is consumed once
   * under the workspace's reinvestment lock; a partial use keeps the tranche's remainder.
   */
  async allocateReinvestment(
    ctx: CommandContext,
    ws: string,
    raw: unknown,
  ): Promise<Allocation> {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(AllocateRequestSchema, raw);
    return this.idempotent(
      ws,
      ctx,
      { op: 'reinvestment.allocate', req },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        await this.#reinvestLock(c, ws);
        const portfolio =
          req.target === 'portfolio'
            ? (
                await c.query(
                  'select version from portfolio_policies where workspace_id=$1',
                  [ws],
                )
              ).rows[0]
            : null;
        if (req.target === 'portfolio' && !portfolio)
          throw fail(
            'INVALID_TRANSITION',
            'This workspace has no portfolio policy to allocate to.',
          );
        await this.#settleLosses(c, ctx, ws);
        const cap = await this.#capacity(c, ws);
        const requested = BigInt(req.amount_nano_usd);
        if (requested === 0n)
          throw fail('INVALID_CONTRACT', 'Allocate a positive amount.');
        const capacity = BigInt(cap.capacity_nano);
        if (capacity === 0n || (requested > capacity && !req.allow_partial))
          throw new ContractError(
            'BUDGET_EXCEEDED',
            `Reinvestment capacity is ${s(capacity)} nano-USD (bound: ${cap.binding}); ${s(requested)} was asked.`,
            [cap.binding],
          );
        const amount = requested < capacity ? requested : capacity;
        const tranches = await this.#eligibleTranches(c, ws);
        const { uses, shortfall } = consume(tranches, amount);
        if (shortfall > 0n)
          throw fail(
            'BUDGET_EXCEEDED',
            'Eligible earnings changed; try again.',
          );
        const id = randomUUID();
        const fixture = await this.#fixtureWorkspace(c, ws);
        const { period_start, ...capacityRecord } = cap;
        // Envelope, then the allocation naming it, then the link back (foreign-key order).
        const envelopeId = randomUUID();
        await c.query(
          `insert into budget_envelopes (id, workspace_id, fixture, parent_id, kind, run_id, name,
           status, cap_nano, max_in_flight, created_by)
         values ($1,$2,$3,null,'global',null,$4,'active',$5,$6,$7)`,
          [
            envelopeId,
            ws,
            fixture,
            req.envelope_name,
            s(amount),
            req.max_in_flight,
            ctx.actorId,
          ],
        );
        await c.query(
          `insert into reinvestment_allocations (id, workspace_id, policy_version, period_start,
           requested_nano, amount_nano, envelope_id, capacity, created_by)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [
            id,
            ws,
            cap.policy_version,
            period_start,
            s(requested),
            s(amount),
            envelopeId,
            JSON.stringify(capacityRecord),
            ctx.actorId,
          ],
        );
        const eventId = await this.append(c, ctx, {
          workspaceId: ws,
          action: 'budget.funded',
          subjectKind: 'envelope',
          subjectId: envelopeId,
          subjectVersion: 1,
          contentHash: null,
          payload: {
            kind: 'global',
            cap_nano: s(amount),
            fixture,
            source: 'reinvestment',
            allocation_id: id,
          },
        });
        await this.journal(c, ctx, ws, eventId, 'fund', envelopeId, {});
        await c.query(
          'insert into reinvestment_envelopes (envelope_id, allocation_id, replaces) values ($1,$2,null)',
          [envelopeId, id],
        );
        for (const u of uses)
          await this.#useTranche(c, u.tranche_id, u.amount, id, null);
        if (portfolio)
          await c.query(
            'insert into reinvestment_portfolio_allocations (allocation_id, workspace_id, portfolio_policy_version) values ($1,$2,$3)',
            [id, ws, Number(portfolio.version)],
          );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'reinvestment.allocated',
          subjectKind: 'reinvestment_allocation',
          subjectId: id,
          subjectVersion: null,
          contentHash: canonicalHash(capacityRecord),
          payload: {
            amount_nano: s(amount),
            requested_nano: s(requested),
            binding: cap.binding,
            tranches: uses.length,
            target: portfolio ? 'portfolio' : 'standalone',
          },
          relatedIds: [envelopeId],
        });
        return {
          id,
          amount_nano_usd: s(amount),
          requested_nano_usd: s(requested),
          envelope_id: envelopeId,
          target: portfolio ? ('portfolio' as const) : ('standalone' as const),
          policy_version: cap.policy_version!,
          period_start: period_start!,
          uses: uses.map((u) => ({
            tranche_id: u.tranche_id,
            amount_nano_usd: s(u.amount),
          })),
          created_at: new Date().toISOString(),
        };
      },
    );
  }
  /** Newest settled first, one page of at most 500 (audit L-9); `before` reads older ones. */
  async listTranches(ctx: CommandContext, ws: string, page?: PageRequest) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const { before, limit } = readPage(page, 500);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await checkPageStart(c, 'earnings_tranches', ws, before);
      const { rows } = await c.query(
        `select id, payment_id, bps, earned_nano::text, loss_nano::text, cap_nano::text,
           consumed_nano::text, clawed_nano::text, disputed, settled_at, eligible_at
         from earnings_tranches where workspace_id = $1
           and ${olderThan('earnings_tranches', 2)}
         order by ${newestOrder('earnings_tranches')} limit $3`,
        [ws, before, limit],
      );
      return rows.map((r) => ({
        ...(r as Row),
        settled_at: iso(r.settled_at),
        eligible_at: iso(r.eligible_at),
      }));
    });
  }
  /** Newest first, one page of at most 200 (audit L-9); `before` reads the next older page. */
  async listAllocations(ctx: CommandContext, ws: string, page?: PageRequest) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const { before, limit } = readPage(page, 200);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      await checkPageStart(c, 'reinvestment_allocations', ws, before);
      const { rows } = await c.query(
        `select a.id, a.amount_nano::text, a.requested_nano::text, a.envelope_id,
           a.policy_version, a.period_start, a.created_at,
           case when exists (select 1 from reinvestment_portfolio_allocations p where p.allocation_id = a.id)
             then 'portfolio' else 'standalone' end as target,
           coalesce((select json_agg(r.envelope_id order by r.created_at)
             from reinvestment_envelopes r where r.allocation_id = a.id), '[]') as envelopes
         from reinvestment_allocations a where a.workspace_id = $1
           and ${olderThan('reinvestment_allocations', 2, 'a')}
         order by ${newestOrder('reinvestment_allocations', 'a')} limit $3`,
        [ws, before, limit],
      );
      return rows.map((r) => ({
        ...(r as Row),
        period_start: iso(r.period_start),
        created_at: iso(r.created_at),
      }));
    });
  }

  // ---- Funding rails and commitments --------------------------------------------------------

  async registerRail(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(RegisterRailRequestSchema, raw);
    return this.idempotent(ws, ctx, { op: 'finance.rail', req }, async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      if (req.connection_id) await this.#connection(c, ws, req.connection_id);
      if (req.connection_id) {
        await this.#reinvestLock(c, ws);
        const existing = await c.query(
          'select id from funding_rails where connection_id = $1',
          [req.connection_id],
        );
        if (existing.rowCount)
          throw fail(
            'INVALID_CONTRACT',
            'This processor connection already has a funding rail. Reuse that rail.',
          );
      }
      const id = randomUUID();
      await c.query(
        `insert into funding_rails (id, workspace_id, kind, connection_id, label, status, version,
           created_by) values ($1,$2,$3,$4,$5,'available',1,$6)`,
        [
          id,
          ws,
          req.kind,
          req.connection_id?.toLowerCase() ?? null,
          req.label,
          ctx.actorId,
        ],
      );
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'finance.rail_registered',
        subjectKind: 'funding_rail',
        subjectId: id,
        subjectVersion: 1,
        contentHash: null,
        payload: { kind: req.kind },
      });
      return { id, ...req, status: 'available' as const };
    });
  }
  async setRailStatus(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
    observation?: { connectionId: string; epoch: string },
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(SetRailStatusRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      await this.#reinvestLock(c, ws);
      if (observation) {
        const conn = await this.#connection(
          c,
          ws,
          observation.connectionId,
          true,
        );
        if (conn.status !== 'active') return { status: 'unchanged' };
        const r = await c.query(
          'select observation_epoch::text as epoch from payment_connections where id=$1',
          [conn.id],
        );
        if (r.rows[0]?.epoch !== observation.epoch)
          return { status: 'unchanged' };
      }
      const { rows } = await c.query(
        `update funding_rails set status = $3, status_reason = $4, version = version + 1
         where workspace_id = $1 and id = $2 returning id, status, version`,
        [ws, uuid(id), req.status, req.reason],
      );
      if (!rows[0]) throw fail('NOT_FOUND', 'Funding rail not found.');
      await this.append(c, ctx, {
        workspaceId: ws,
        action: `finance.rail_${req.status}`,
        subjectKind: 'funding_rail',
        subjectId: uuid(id),
        subjectVersion: Number(rows[0].version),
        contentHash: null,
        payload: { reason: req.reason },
      });
      return rows[0] as Row;
    });
  }
  async #rail(c: PoolClient, ws: string, id: string) {
    const { rows } = await c.query(
      'select * from funding_rails where workspace_id = $1 and id = $2',
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Funding rail not found.');
    return rows[0] as Row;
  }
  /** The owner's dated statement of money on a rail the processor cannot report. */
  async attestRail(ctx: CommandContext, ws: string, id: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(AttestRailRequestSchema, raw);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const rail = await this.#rail(c, ws, id);
      if (rail.kind !== 'owner_attested')
        throw fail(
          'INVALID_CONTRACT',
          'Processor balances come from the processor.',
        );
      await c.query(
        `insert into rail_observations (id, rail_id, available_nano, pending_nano, source, evidence,
           expires_at, actor_id) values ($1,$2,$3,0,'owner_attestation',$4,$5,$6)`,
        [
          randomUUID(),
          String(rail.id),
          req.available_nano_usd,
          req.evidence,
          new Date(Date.now() + ATTESTATION_TTL_MS).toISOString(),
          ctx.actorId,
        ],
      );
      return {
        rail_id: String(rail.id),
        available_nano: req.available_nano_usd,
      };
    });
  }
  async railConnection(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const rail = await this.#rail(c, ws, id);
      if (rail.kind !== 'processor_balance')
        throw fail(
          'INVALID_CONTRACT',
          'Owner-attested rails are attested, not read.',
        );
      return this.#connection(c, ws, String(rail.connection_id));
    });
  }
  async recordRailBalance(
    ctx: CommandContext,
    ws: string,
    id: string,
    observed: BalanceSnapshot | (() => Promise<BalanceSnapshot>),
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const initial = await this.railConnection(ctx, ws, id);
    const observation = await this.#readObservation(
      ctx,
      initial.id,
      observed,
      ws,
      id,
    );
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      await this.#reinvestLock(c, ws);
      const rail = await this.#rail(c, ws, id);
      const conn = await this.#connection(
        c,
        ws,
        String(rail.connection_id),
        true,
      );
      this.#usable(conn, false);
      await this.#checkObservation(c, conn.id, observation.epoch);
      const balance = parse(BalanceSnapshotSchema, observation.value);
      this.#usable(conn, balance.livemode);
      await this.#snapshot(c, conn, 'balance', null, balance);
      await c.query(
        `insert into rail_observations (id, rail_id, available_nano, pending_nano, source, evidence,
           expires_at, actor_id) values ($1,$2,$3,$4,'processor_api',$5,$6,$7)`,
        [
          randomUUID(),
          String(rail.id),
          s(BigInt(balance.available_cents) * NANO_PER_CENT),
          s(BigInt(balance.pending_cents) * NANO_PER_CENT),
          `Read from the ${conn.body.processor} balance API.`,
          new Date(Date.now() + PROCESSOR_BALANCE_TTL_MS).toISOString(),
          ctx.actorId,
        ],
      );
      return {
        rail_id: String(rail.id),
        available_nano: s(BigInt(balance.available_cents) * NANO_PER_CENT),
        pending_nano: s(BigInt(balance.pending_cents) * NANO_PER_CENT),
      };
    });
  }
  async listRails(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select r.id, r.kind, r.label, r.status, r.status_reason, r.connection_id,
           o.available_nano::text, o.source, o.observed_at, o.expires_at
         from funding_rails r left join lateral (select * from rail_observations
           where rail_id = r.id order by observed_at desc limit 1) o on true
         where r.workspace_id = $1 order by r.created_at`,
        [ws],
      );
      return rows.map((r) => ({
        ...(r as Row),
        observed_at: r.observed_at ? iso(r.observed_at) : null,
        expires_at: r.expires_at ? iso(r.expires_at) : null,
      }));
    });
  }
  async addCommitment(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(CommitmentRequestSchema, raw);
    return this.idempotent(
      ws,
      ctx,
      { op: 'finance.commitment', req },
      async (c) => {
        await this.requireOwner(c, ws, ctx.actorId);
        if (BigInt(req.amount_nano_usd) === 0n)
          throw fail('INVALID_CONTRACT', 'A commitment is a positive amount.');
        const id = randomUUID();
        await c.query(
          `insert into finance_commitments (id, workspace_id, kind, label, amount_nano, status,
           created_by) values ($1,$2,$3,$4,$5,'open',$6)`,
          [id, ws, req.kind, req.label, req.amount_nano_usd, ctx.actorId],
        );
        await this.append(c, ctx, {
          workspaceId: ws,
          action: 'finance.commitment_opened',
          subjectKind: 'finance_commitment',
          subjectId: id,
          subjectVersion: null,
          contentHash: null,
          payload: { kind: req.kind, amount_nano: req.amount_nano_usd },
        });
        return { id, ...req, status: 'open' as const };
      },
    );
  }
  /**
   * Every open commitment (capacity holds all of them back), then the 100 most recently
   * closed.
   */
  async listCommitments(ctx: CommandContext, ws: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const { rows } = await c.query(
        `select * from ((select id, kind, label, amount_nano::text as amount_nano_usd, status, created_at, closed_at
           from finance_commitments where workspace_id = $1 and status = 'open'
           order by created_at desc)
         union all
         (select id, kind, label, amount_nano::text, status, created_at, closed_at
           from finance_commitments where workspace_id = $1 and status = 'closed'
           order by closed_at desc limit 100)) c
         order by status = 'closed', coalesce(closed_at, created_at) desc`,
        [ws],
      );
      return rows.map((r) => ({
        ...(r as Row),
        created_at: iso(r.created_at),
        closed_at: r.closed_at ? iso(r.closed_at) : null,
      }));
    });
  }
  async closeCommitment(ctx: CommandContext, ws: string, id: string) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.requireOwner(c, ws, ctx.actorId);
      const { rows } = await c.query(
        `update finance_commitments set status = 'closed', closed_at = clock_timestamp()
         where workspace_id = $1 and id = $2 and status = 'open' returning id`,
        [ws, uuid(id)],
      );
      if (!rows[0])
        throw fail('INVALID_TRANSITION', 'No open commitment with that id.');
      await this.append(c, ctx, {
        workspaceId: ws,
        action: 'finance.commitment_closed',
        subjectKind: 'finance_commitment',
        subjectId: uuid(id),
        subjectVersion: null,
        contentHash: null,
        payload: {},
      });
      return { id: uuid(id), status: 'closed' as const };
    });
  }
}
