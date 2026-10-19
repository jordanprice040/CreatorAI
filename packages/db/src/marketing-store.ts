import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  MarketingDraftRequestSchema,
  MarketingGrantRequestSchema,
  MarketingDeliveryRequestSchema,
  MarketingSuppressionRequestSchema,
  MarketingObservationSchema,
  MarketingReasonSchema,
  parse,
  type MarketingDraftRequest,
} from '@creator/contracts';
import { canonicalHash, marketingContent } from '@creator/domain';
import { PaymentStore } from './payment-store.js';
import {
  fail,
  normalize,
  uuid,
  iso,
  type CommandContext,
  type Row,
} from './store.js';

type CampaignRow = Row & {
  id: string;
  artifact_id: string;
  request: MarketingDraftRequest;
  content_hash: string;
  cancelled: boolean;
  content: ReturnType<typeof marketingContent>;
};
export class MarketingStore extends PaymentStore {
  // Serializes caps, suppression, cancellation and the local transactional sink.
  private async marketingLock(c: PoolClient, ctx: CommandContext, ws: string) {
    await this.requireOwner(c, ws, ctx.actorId);
    await c.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [
      'marketing:' + ws,
    ]);
  }
  private async campaign(
    c: PoolClient,
    ws: string,
    id: string,
  ): Promise<CampaignRow> {
    const { rows } = await c.query(
      'select * from marketing_campaigns where workspace_id=$1 and id=$2',
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Campaign not found.');
    return rows[0] as CampaignRow;
  }
  private async currentMarketing(c: PoolClient, ws: string, a: CampaignRow) {
    const artifact = await this.marketingArtifact(c, ws, a.artifact_id);
    if (
      !artifact.summary.current ||
      artifact.summary.state !== 'verified' ||
      artifact.summary.manifest_sha256 !== a.request.manifest_sha256
    )
      throw fail(
        'EVIDENCE_MISMATCH',
        'Campaign evidence is stale or no longer verified. Create a new draft and grant.',
      );
    const { rows } = await c.query(
      'select fixture from workspaces where id=$1',
      [ws],
    );
    const content = marketingContent(
      artifact.manifest,
      a.request,
      Boolean(rows[0]?.fixture),
    );
    if (canonicalHash({ request: a.request, content }) !== a.content_hash)
      throw fail('EVIDENCE_MISMATCH', 'Campaign content binding changed.');
    return artifact;
  }
  private async marketingArtifact(c: PoolClient, ws: string, id: string) {
    // Registration takes a share lock on the same spec. Hold an exclusive lock
    // through local acceptance so revisions/new artifacts cannot race the gate.
    const { rows } = await c.query(
      `select e.status from artifact_manifests a
      join entities e on e.id=a.spec_id and e.workspace_id=a.workspace_id
      where a.workspace_id=$1 and a.id=$2 for update of e`,
      [ws, uuid(id)],
    );
    if (!rows[0]) throw fail('NOT_FOUND', 'Artifact not found.');
    if (rows[0].status !== 'active')
      throw fail('EVIDENCE_MISMATCH', 'Specification is not active.');
    return this.artifact(c, ws, id);
  }
  private marketingEvent(
    c: PoolClient,
    ctx: CommandContext,
    ws: string,
    id: string,
    action: string,
    payload: Row = {},
  ) {
    return this.append(c, ctx, {
      workspaceId: ws,
      action: 'marketing.' + action,
      subjectKind: 'marketing_campaign',
      subjectId: id,
      subjectVersion: 1,
      contentHash:
        typeof payload.content_hash === 'string' ? payload.content_hash : null,
      payload,
    });
  }
  async draftCampaign(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(MarketingDraftRequestSchema, raw);
    if (
      new Set(req.audience.recipients).size !== req.audience.recipients.length
    )
      throw fail('INVALID_CONTRACT', 'Duplicate audience members.');
    if (req.experiment.success_threshold > req.audience.recipients.length)
      throw fail('INVALID_CONTRACT', 'Threshold exceeds bounded audience.');
    return this.idempotent(
      ws,
      ctx,
      { op: 'marketing.draft', req },
      async (c) => {
        await this.marketingLock(c, ctx, ws);
        const a = await this.marketingArtifact(c, ws, req.artifact_id);
        if (
          !a.summary.current ||
          a.summary.state !== 'verified' ||
          a.summary.manifest_sha256 !== req.manifest_sha256
        )
          throw fail(
            'EVIDENCE_MISMATCH',
            'Select an exact current verified artifact manifest.',
          );
        const { rows: workspaces } = await c.query(
          'select fixture from workspaces where id=$1',
          [ws],
        );
        const fixture = Boolean(workspaces[0]?.fixture);
        if (
          !fixture &&
          (a.manifest.build.fixture_roles ||
            a.manifest.toolchain.backend !== 'wsl2-bwrap-systemd')
        )
          throw fail(
            'EVIDENCE_MISMATCH',
            'Synthetic verification cannot substantiate a real product campaign.',
          );
        const content = marketingContent(a.manifest, req, fixture);
        const contentHash = canonicalHash({ request: req, content });
        const { rows } = await c.query(
          `insert into marketing_campaigns(id,workspace_id,artifact_id,request,content,content_hash,created_by)
         values($1,$2,$3,$4,$5,$6,$7) returning *`,
          [
            randomUUID(),
            ws,
            req.artifact_id,
            JSON.stringify(req),
            JSON.stringify(content),
            contentHash,
            ctx.actorId,
          ],
        );
        await this.marketingEvent(c, ctx, ws, String(rows[0].id), 'drafted', {
          content_hash: contentHash,
          artifact_id: req.artifact_id,
        });
        return rows[0] as CampaignRow;
      },
    );
  }
  async listCampaigns(ctx: CommandContext, ws: string) {
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      return (
        await c.query(
          'select * from marketing_campaigns where workspace_id=$1 order by created_at,id limit 200',
          [ws],
        )
      ).rows as CampaignRow[];
    });
  }
  async inspectCampaign(ctx: CommandContext, ws: string, id: string) {
    ws = uuid(ws);
    return this.tx(async (c) => {
      await this.role(c, ws, ctx.actorId, false);
      const campaign = await this.campaign(c, ws, id);
      let evidence_status = 'current';
      try {
        await this.currentMarketing(c, ws, campaign);
      } catch {
        evidence_status = 'stale_or_unavailable';
      }
      const deliveries = (
        await c.query(
          'select * from marketing_deliveries where workspace_id=$1 and campaign_id=$2 order by created_at',
          [ws, id],
        )
      ).rows;
      const grants = (
        await c.query(
          'select * from marketing_grants where workspace_id=$1 and campaign_id=$2 order by created_at',
          [ws, id],
        )
      ).rows;
      const observations = (
        await c.query(
          'select * from marketing_observations where workspace_id=$1 and campaign_id=$2 order by created_at',
          [ws, id],
        )
      ).rows;
      const suppressions = (
        await c.query(
          'select recipient,reason from marketing_suppressions where workspace_id=$1',
          [ws],
        )
      ).rows;
      return {
        campaign,
        evidence_status,
        grants,
        deliveries,
        observations,
        suppressions,
        measurement: {
          mode: 'fixture_only_not_traffic_or_demand',
          delivered: deliveries.filter((d) => d.state === 'delivered').length,
          observed: observations.filter(
            (o) => o.metric === campaign.request.experiment.metric,
          ).length,
          threshold: campaign.request.experiment.success_threshold,
          budget_nano_usd: '0',
          spent_nano_usd: '0',
        },
      };
    });
  }
  async grantCampaign(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(MarketingGrantRequestSchema, raw);
    return this.tx(async (c) => {
      await this.marketingLock(c, ctx, ws);
      const a = await this.campaign(c, ws, id);
      await this.currentMarketing(c, ws, a);
      if (a.cancelled || a.content_hash !== req.content_hash)
        throw fail(
          'VERSION_CONFLICT',
          'Grant must bind the active exact campaign.',
        );
      const now = Date.now(),
        expiry = Date.parse(req.expires_at);
      if (expiry <= now || expiry > now + 30 * 86400000)
        throw fail('INVALID_CONTRACT', 'Grant expiry must be within 30 days.');
      if (req.max_deliveries > a.request.audience.recipients.length)
        throw fail('INVALID_CONTRACT', 'Cap exceeds exact audience.');
      const { rows } = await c.query(
        `insert into marketing_grants(id,workspace_id,campaign_id,content_hash,expires_at,max_deliveries,rationale,budget_nano,created_by)
         values($1,$2,$3,$4,$5,$6,$7,0,$8) returning *`,
        [
          randomUUID(),
          ws,
          id,
          req.content_hash,
          req.expires_at,
          req.max_deliveries,
          req.rationale,
          ctx.actorId,
        ],
      );
      await this.marketingEvent(c, ctx, ws, id, 'granted', {
        grant_id: rows[0].id,
        content_hash: req.content_hash,
      });
      return rows[0];
    });
  }
  async controlCampaign(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
    grantId?: string,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(MarketingReasonSchema, raw);
    return this.tx(async (c) => {
      await this.marketingLock(c, ctx, ws);
      await this.campaign(c, ws, id);
      const result = grantId
        ? await c.query(
            'update marketing_grants set revoked=true where workspace_id=$1 and campaign_id=$2 and id=$3 returning *',
            [ws, id, uuid(grantId)],
          )
        : await c.query(
            'update marketing_campaigns set cancelled=true where workspace_id=$1 and id=$2 returning *',
            [ws, id],
          );
      if (!result.rows[0]) throw fail('NOT_FOUND', 'Grant not found.');
      await this.marketingEvent(
        c,
        ctx,
        ws,
        id,
        grantId ? 'revoked' : 'cancelled',
        { reason: req.reason, ...(grantId ? { grant_id: grantId } : {}) },
      );
      return result.rows[0];
    });
  }
  async suppressMarketing(ctx: CommandContext, ws: string, raw: unknown) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(MarketingSuppressionRequestSchema, raw);
    return this.tx(async (c) => {
      await this.marketingLock(c, ctx, ws);
      const { rows } = await c.query(
        `insert into marketing_suppressions(workspace_id,recipient,reason,created_by) values($1,$2,$3,$4)
         on conflict(workspace_id,recipient) do nothing returning *`,
        [ws, req.recipient, req.reason, ctx.actorId],
      );
      await this.marketingEvent(c, ctx, ws, ws, 'suppressed', {
        recipient: req.recipient,
        reason: req.reason,
      });
      return rows[0] ?? { ...req, already_suppressed: true };
    });
  }
  private async allowedMarketing(
    c: PoolClient,
    ws: string,
    a: CampaignRow,
    grant: Row | undefined,
    recipient: string,
  ) {
    if (
      a.cancelled ||
      !grant ||
      grant.revoked ||
      Date.parse(iso(grant.expires_at)) <= Date.now() ||
      grant.content_hash !== a.content_hash ||
      grant.campaign_id !== a.id
    )
      throw fail(
        'ACCESS_DENIED',
        'Campaign cancelled or grant missing, stale, expired or revoked.',
      );
    if (!a.request.audience.recipients.includes(recipient))
      throw fail('ACCESS_DENIED', 'Recipient outside exact audience.');
    if (
      (
        await c.query(
          'select 1 from marketing_suppressions where workspace_id=$1 and recipient=$2',
          [ws, recipient],
        )
      ).rowCount
    )
      throw fail('ACCESS_DENIED', 'Recipient opted out or suppressed.');
    await this.currentMarketing(c, ws, a);
  }
  /** Persist intent before the adapter; duplicate requests always return the original. */
  async deliverCampaign(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(MarketingDeliveryRequestSchema, raw);
    const admitted = await this.tx(async (c) => {
      await this.marketingLock(c, ctx, ws);
      const a = await this.campaign(c, ws, id);
      const prior = (
        await c.query(
          'select * from marketing_deliveries where campaign_id=$1 and recipient=$2',
          [id, req.recipient],
        )
      ).rows[0];
      if (prior) return { row: prior, fresh: false };
      const grant = (
        await c.query(
          'select * from marketing_grants where workspace_id=$1 and id=$2',
          [ws, req.grant_id],
        )
      ).rows[0];
      await this.allowedMarketing(c, ws, a, grant, req.recipient);
      if (Number(grant.used) >= Number(grant.max_deliveries))
        throw fail('ACCESS_DENIED', 'Delivery cap exhausted.');
      await c.query('update marketing_grants set used=used+1 where id=$1', [
        req.grant_id,
      ]);
      const { rows } = await c.query(
        `insert into marketing_deliveries(id,workspace_id,campaign_id,grant_id,recipient,content_hash,state,simulation)
         values($1,$2,$3,$4,$5,$6,'dispatching',$7) returning *`,
        [
          randomUUID(),
          ws,
          id,
          req.grant_id,
          req.recipient,
          a.content_hash,
          req.simulation,
        ],
      );
      await this.marketingEvent(c, ctx, ws, id, 'intent', {
        delivery_id: rows[0].id,
        recipient: req.recipient,
        content_hash: a.content_hash,
      });
      return { row: rows[0], fresh: true };
    });
    if (!admitted.fresh) return admitted.row;
    // The local adapter accepts under the same lock as suppression and cancellation.
    await this.tx(async (c) => {
      await this.marketingLock(c, ctx, ws);
      const a = await this.campaign(c, ws, id);
      const intent = (
        await c.query('select state from marketing_deliveries where id=$1', [
          admitted.row.id,
        ])
      ).rows[0];
      if (intent?.state !== 'dispatching') return; // A reconciler fenced this suspended dispatcher.
      const grant = (
        await c.query(
          'select * from marketing_grants where workspace_id=$1 and id=$2',
          [ws, req.grant_id],
        )
      ).rows[0];
      let outcome = 'delivered',
        reason = 'Local fixture accepted; no real message sent.';
      try {
        await this.allowedMarketing(c, ws, a, grant, req.recipient);
      } catch (e) {
        outcome = 'suppressed';
        reason = (e as Error).message;
      }
      if (
        outcome === 'delivered' &&
        req.simulation === 'failed_before_accept'
      ) {
        outcome = 'failed';
        reason = 'Simulated definitive non-delivery.';
      }
      const native = 'fixture:' + String(admitted.row.id);
      await c.query(
        `insert into marketing_fixture_receipts(delivery_id,native_id,outcome,content_hash,reason) values($1,$2,$3,$4,$5)`,
        [admitted.row.id, native, outcome, a.content_hash, reason],
      );
      await this.marketingEvent(c, ctx, ws, id, 'fixture_receipt', {
        delivery_id: admitted.row.id,
        native_id: native,
        outcome,
      });
    });
    return this.finishMarketingDelivery(
      ctx,
      ws,
      id,
      String(admitted.row.id),
      req.simulation === 'unknown_after_accept',
    );
  }
  private async finishMarketingDelivery(
    ctx: CommandContext,
    ws: string,
    id: string,
    deliveryId: string,
    unknown = false,
  ) {
    return this.tx(async (c) => {
      await this.marketingLock(c, ctx, ws);
      await this.campaign(c, ws, id);
      const d = (
        await c.query(
          'select * from marketing_deliveries where workspace_id=$1 and campaign_id=$2 and id=$3',
          [ws, id, uuid(deliveryId)],
        )
      ).rows[0];
      if (!d) throw fail('NOT_FOUND', 'Delivery not found.');
      if (!['dispatching', 'unknown'].includes(d.state)) return d;
      const receipt = (
        await c.query(
          'select * from marketing_fixture_receipts where delivery_id=$1',
          [d.id],
        )
      ).rows[0];
      // No receipt definitively means the transactional local sink did not accept.
      const state = unknown ? 'unknown' : (receipt?.outcome ?? 'failed');
      const reason = unknown
        ? 'Simulated lost acknowledgement; reconcile, never resend.'
        : (receipt?.reason ??
          'No local sink receipt; intent closed without delivery.');
      const { rows } = await c.query(
        `update marketing_deliveries set state=$2,native_id=$3,reason=$4,updated_at=clock_timestamp() where id=$1 returning *`,
        [d.id, state, unknown ? null : (receipt?.native_id ?? null), reason],
      );
      await this.marketingEvent(c, ctx, ws, id, 'delivery_' + state, {
        delivery_id: d.id,
        reason,
      });
      return rows[0];
    });
  }
  async reconcileMarketing(
    ctx: CommandContext,
    ws: string,
    id: string,
    deliveryId: string,
  ) {
    return this.finishMarketingDelivery(
      normalize(ctx),
      uuid(ws),
      id,
      deliveryId,
    );
  }
  async observeMarketing(
    ctx: CommandContext,
    ws: string,
    id: string,
    raw: unknown,
  ) {
    ctx = normalize(ctx);
    ws = uuid(ws);
    const req = parse(MarketingObservationSchema, raw);
    return this.tx(async (c) => {
      await this.marketingLock(c, ctx, ws);
      const a = await this.campaign(c, ws, id);
      const d = (
        await c.query(
          "select * from marketing_deliveries where workspace_id=$1 and campaign_id=$2 and id=$3 and state='delivered'",
          [ws, id, req.delivery_id],
        )
      ).rows[0];
      if (!d || req.metric !== a.request.experiment.metric)
        throw fail(
          'INVALID_CONTRACT',
          'Observation requires delivered fixture and the frozen outcome metric.',
        );
      const prior = (
        await c.query(
          'select * from marketing_observations where campaign_id=$1 and (event_key=$2 or (delivery_id=$3 and metric=$4))',
          [id, req.event_key, req.delivery_id, req.metric],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.event_key !== req.event_key ||
          prior.delivery_id !== req.delivery_id ||
          prior.metric !== req.metric ||
          prior.note !== req.note
        )
          throw fail(
            'VERSION_CONFLICT',
            'Observation identity already used for another observation.',
          );
        return prior;
      }
      const { rows } = await c.query(
        `insert into marketing_observations(id,workspace_id,campaign_id,delivery_id,event_key,metric,note,created_by)
         values($1,$2,$3,$4,$5,$6,$7,$8) returning *`,
        [
          randomUUID(),
          ws,
          id,
          req.delivery_id,
          req.event_key,
          req.metric,
          req.note,
          ctx.actorId,
        ],
      );
      await this.marketingEvent(c, ctx, ws, id, 'fixture_observation', {
        observation_id: rows[0].id,
        metric: req.metric,
      });
      return rows[0];
    });
  }
}
