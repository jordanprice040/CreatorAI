import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { MarketingStore, type CommandContext } from '@creator/db';
import { ContractError, MarketingDraftRequestSchema } from '@creator/contracts';
import { canonicalHash, marketingContent } from '@creator/domain';
import { freshDatabase } from './pg-harness.js';
import { marketingRelease } from './marketing-harness.js';

async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new MarketingStore(db.pool);
  const ctx: CommandContext = { actorId: randomUUID() };
  await store.ensureActor({
    id: ctx.actorId,
    kind: 'human',
    display_name: 'Fixture owner',
  });
  const ws = (
    await store.createWorkspace(ctx, {
      name: 'X08 fixture',
      record_mode: 'fixture',
    })
  ).id;
  const release = await marketingRelease(store, db.pool, ws, ctx);
  const campaign = await store.draftCampaign(ctx, ws, release.request);
  const grant = await store.grantCampaign(ctx, ws, campaign.id, {
    content_hash: campaign.content_hash,
    max_deliveries: 3,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    budget_nano_usd: '0',
    rationale: 'Local fixture only.',
  });
  return { ...db, store, ctx, ws, ...release, campaign, grant };
}
const denied = (p: Promise<unknown>) =>
  assert.rejects(p, (e: unknown) => e instanceof ContractError);

test('X08 closed contracts reject live channels, real recipients, paid budgets and injected claims', () => {
  const base = {
    artifact_id: randomUUID(),
    manifest_sha256: 'a'.repeat(64),
    channel: 'local_fixture',
    budget_nano_usd: '0',
    audience: {
      description: 'Reviewers',
      provenance: 'Synthetic',
      recipients: ['test:a'],
    },
    experiment: {
      hypothesis: 'Test',
      metric: 'feedback_received',
      success_threshold: 1,
      price_hypothesis_cents: null,
      stop_rule: 'Owner cancel',
    },
  };
  assert.ok(MarketingDraftRequestSchema.safeParse(base).success);
  for (const changed of [
    { channel: 'email' },
    { budget_nano_usd: '1' },
    { claims: ['1000 users'] },
    { audience: { ...base.audience, recipients: ['person@example.com'] } },
  ])
    assert.equal(
      MarketingDraftRequestSchema.safeParse({ ...base, ...changed }).success,
      false,
    );
});

test('X08 evidence-bound draft, concurrent duplicate delivery, unknown reconciliation, measured feedback and restart', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ctx, ws, campaign, grant, pool } = s;
  const content = marketingContent(s.manifest, s.request, true);
  assert.match(content.label, /SYNTHETIC/);
  assert.match(content.landing_page, /No testimonials/);
  assert.equal(
    content.claims[0]!.execution_id,
    s.manifest.tests.package[0]!.execution_id,
  );
  assert.equal(content.claims[0]!.manifest_sha256, s.request.manifest_sha256);
  const failed = structuredClone(s.manifest);
  failed.tests.package[0]!.passed = false;
  assert.throws(
    () => marketingContent(failed, s.request, true),
    /complete verified/,
  );
  const req = {
    grant_id: grant.id,
    recipient: 'test:one',
    simulation: 'unknown_after_accept',
  };
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      store.deliverCampaign(ctx, ws, campaign.id, req),
    ),
  );
  assert.equal(new Set(results.map((d) => d.id)).size, 1);
  const id = String(results[0]!.id);
  assert.equal(
    (await pool.query('select count(*) from marketing_fixture_receipts'))
      .rows[0].count,
    '1',
  );
  const restarted = new MarketingStore(pool);
  const before = await restarted.inspectCampaign(ctx, ws, campaign.id);
  assert.equal(before.deliveries[0].state, 'unknown');
  assert.equal(
    (
      await restarted.deliverCampaign(ctx, ws, campaign.id, {
        ...req,
        simulation: 'delivered',
      })
    ).state,
    'unknown',
  );
  await denied(
    restarted.observeMarketing(ctx, ws, campaign.id, {
      delivery_id: id,
      event_key: 'f1',
      metric: 'feedback_received',
      note: 'Too early.',
    }),
  );
  const final = await restarted.reconcileMarketing(ctx, ws, campaign.id, id);
  assert.equal(final.state, 'delivered');
  assert.match(String(final.native_id), /^fixture:/);
  await restarted.reconcileMarketing(ctx, ws, campaign.id, id);
  const observation = {
    delivery_id: id,
    event_key: 'f1',
    metric: 'feedback_received',
    note: 'Synthetic feedback.',
  };
  const first = await restarted.observeMarketing(
    ctx,
    ws,
    campaign.id,
    observation,
  );
  assert.equal(
    (await restarted.observeMarketing(ctx, ws, campaign.id, observation)).id,
    first.id,
  );
  await denied(
    restarted.observeMarketing(ctx, ws, campaign.id, {
      ...observation,
      note: 'Changed observation.',
    }),
  );
  const summary = await restarted.inspectCampaign(ctx, ws, campaign.id);
  assert.equal(summary.measurement.observed, 1);
  assert.equal(summary.measurement.delivered, 1);
  assert.equal(summary.grants[0].used, 1);
  assert.equal(summary.measurement.spent_nano_usd, '0');
  assert.equal(
    (await pool.query('select count(*) from marketing_fixture_receipts'))
      .rows[0].count,
    '1',
  );
  await assert.rejects(
    pool.query('update marketing_campaigns set content=$2 where id=$1', [
      campaign.id,
      '{}',
    ]),
    /immutable/,
  );
});

test('X08 suppression, exact audience, revocation, cancellation, expiry and concurrency caps deny disallowed sends', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ctx, ws, campaign, grant, pool } = s;
  const send = (recipient: string, g = grant.id) =>
    store.deliverCampaign(ctx, ws, campaign.id, {
      grant_id: g,
      recipient,
      simulation: 'delivered',
    });
  await denied(send('test:outside'));
  await store.suppressMarketing(ctx, ws, {
    recipient: 'test:one',
    reason: 'Opt out.',
  });
  await denied(send('test:one'));
  const limited = await store.grantCampaign(ctx, ws, campaign.id, {
    content_hash: campaign.content_hash,
    max_deliveries: 1,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    budget_nano_usd: '0',
    rationale: 'One test.',
  });
  const settled = await Promise.allSettled([
    send('test:two', limited.id),
    send('test:three', limited.id),
  ]);
  assert.equal(settled.filter((x) => x.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((x) => x.status === 'rejected').length, 1);
  const unsent = settled[0]!.status === 'rejected' ? 'test:two' : 'test:three';
  await store.controlCampaign(
    ctx,
    ws,
    campaign.id,
    { reason: 'Revoke.' },
    grant.id,
  );
  await denied(send(unsent));
  const expired = await store.grantCampaign(ctx, ws, campaign.id, {
    content_hash: campaign.content_hash,
    max_deliveries: 1,
    expires_at: new Date(Date.now() + 60000).toISOString(),
    budget_nano_usd: '0',
    rationale: 'Expiry test.',
  });
  await pool.query(
    "update marketing_grants set expires_at=clock_timestamp()-interval '1 second' where id=$1",
    [expired.id],
  );
  await denied(send(unsent, expired.id));
  await store.controlCampaign(ctx, ws, campaign.id, { reason: 'Cancel.' });
  await denied(
    store.grantCampaign(ctx, ws, campaign.id, {
      content_hash: campaign.content_hash,
      max_deliveries: 1,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      budget_nano_usd: '0',
      rationale: 'Cannot restart.',
    }),
  );
  assert.equal(
    (await pool.query('select count(*) from marketing_fixture_receipts'))
      .rows[0].count,
    '1',
  );
});

test('X08 stale evidence, altered drafts and cross-workspace/agent authority are refused', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ctx, ws, campaign, grant, pool } = s;
  await denied(
    store.draftCampaign(ctx, ws, {
      ...s.request,
      manifest_sha256: '0'.repeat(64),
    }),
  );
  await denied(
    store.grantCampaign(ctx, ws, campaign.id, {
      content_hash: '0'.repeat(64),
      max_deliveries: 1,
      expires_at: new Date(Date.now() + 60000).toISOString(),
      budget_nano_usd: '0',
      rationale: 'Wrong binding.',
    }),
  );
  const other = (
    await store.createWorkspace(ctx, { name: 'Other', record_mode: 'fixture' })
  ).id;
  await denied(store.inspectCampaign(ctx, other, campaign.id));
  await denied(store.draftCampaign(ctx, other, s.request));
  const agent = { actorId: randomUUID() };
  await store.ensureActor({
    id: agent.actorId,
    kind: 'agent',
    display_name: 'Agent',
  });
  await store.addMember(ctx, ws, agent.actorId, 'owner');
  await denied(store.draftCampaign(agent, ws, s.request));
  const row = (
    await pool.query('select * from entities where id=$1', [s.manifest.spec.id])
  ).rows[0];
  await store.reviseEntity(ctx, ws, row.id, {
    expected_version: 1,
    title: 'Revised spec',
    body: row.body,
    reason: 'Invalidates campaign evidence.',
    corrects_version: null,
  });
  await denied(
    store.deliverCampaign(ctx, ws, campaign.id, {
      grant_id: grant.id,
      recipient: 'test:one',
      simulation: 'delivered',
    }),
  );
  assert.equal(
    (await store.inspectCampaign(ctx, ws, campaign.id)).evidence_status,
    'stale_or_unavailable',
  );
  const changed = {
    ...s.request,
    audience: { ...s.request.audience, recipients: ['test:changed'] },
  };
  assert.notEqual(canonicalHash(changed), canonicalHash(s.request));
});

test('X08 abandoned pre-adapter intent reconciles as definitively unsent and never redispatches', async (t) => {
  const s = await setup(t);
  if (!s) return;
  const { store, ctx, ws, campaign, grant, pool } = s;
  const id = randomUUID();
  // Labelled crash seam: committed intent exists, adapter transaction never ran.
  await pool.query(
    `insert into marketing_deliveries(id,workspace_id,campaign_id,grant_id,recipient,content_hash,state,simulation)
    values($1,$2,$3,$4,'test:one',$5,'dispatching','delivered')`,
    [id, ws, campaign.id, grant.id, campaign.content_hash],
  );
  assert.equal(
    (await store.reconcileMarketing(ctx, ws, campaign.id, id)).state,
    'failed',
  );
  assert.equal(
    (
      await store.deliverCampaign(ctx, ws, campaign.id, {
        grant_id: grant.id,
        recipient: 'test:one',
        simulation: 'delivered',
      })
    ).id,
    id,
  );
  assert.equal(
    (await pool.query('select count(*) from marketing_fixture_receipts'))
      .rows[0].count,
    '0',
  );
  const delivered = await store.deliverCampaign(ctx, ws, campaign.id, {
    grant_id: grant.id,
    recipient: 'test:two',
    simulation: 'failed_before_accept',
  });
  assert.equal(delivered.state, 'failed');
});
