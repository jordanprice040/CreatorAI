import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type test from 'node:test';
import type {
  AutonomyMode,
  StartDiscoveryRequest,
  WorkflowDetail,
} from '@creator/contracts';
import type { DiscoveryScenario } from '@creator/domain';
import {
  ProposalStore,
  ORCHESTRATOR_ACTOR_ID,
  type CommandContext,
} from '@creator/db';
import { ModelBroker, type ModelAdapter } from '@creator/broker';
import { Worker } from '@creator/orchestrator';
import {
  FIXTURE_SOURCE_POLICY,
  FixtureSourceAdapter,
  SourceBroker,
} from '@creator/research';
import { freshDatabase } from './pg-harness.js';

export const owner: CommandContext = { actorId: randomUUID() };
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();
const fixturePricing = JSON.parse(
  readFileSync(
    new URL('../../config/pricing/fixture-model-v1.json', import.meta.url),
    'utf8',
  ),
) as Record<string, unknown>;

/** A discovery-ready fixture workspace on a fresh database, or null when it is skipped. */
export async function discoverySetup(
  t: test.TestContext,
  adapter: ModelAdapter,
) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ProposalStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  await store.ensureActor({
    id: ORCHESTRATOR_ACTOR_ID,
    kind: 'agent',
    display_name: 'Workflow worker',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Discovery',
    record_mode: 'fixture',
  });
  const pricing = await store.createPricing(owner, ws.id, fixturePricing);
  const envelope = await store.createEnvelope(owner, ws.id, {
    parent_id: null,
    kind: 'global',
    run_id: null,
    name: 'Owner budget',
    cap_nano_usd: '100000000000',
    starts_at: null,
    ends_at: null,
    max_in_flight: 32,
  });
  const sources = new SourceBroker(
    store,
    { fixture: new FixtureSourceAdapter(), live: null },
    { fixture: FIXTURE_SOURCE_POLICY, live: null },
  );
  const broker = new ModelBroker(
    store,
    { fixture: adapter, live: null },
    { retryCapMs: 10 },
  );
  const worker = new Worker(store, broker, {
    leaseMs: 5000,
    heartbeatMs: 1000,
  });

  async function run(mode: AutonomyMode = 'human_in_loop') {
    const condition =
      mode === 'human_only'
        ? 'human_only'
        : mode === 'autonomous_within_scope'
          ? 'autonomous'
          : 'human_in_loop';
    const r = await store.createEntity(owner, ws.id, {
      kind: 'run',
      title: `${mode} discovery run`,
      body: {
        state: 'queued',
        experiment_condition: condition,
        discovery_method:
          mode === 'human_only' ? 'human_defined' : 'structured',
        config_hash: null,
      },
    });
    const control = await store.registerRun(owner, ws.id, {
      run: { id: r.id, version: 1 },
      autonomy_mode: mode,
      stage_gates: null,
      initial_grants: [],
    });
    if (mode !== 'human_only') {
      await store.createStandingGrant(owner, ws.id, {
        run_id: control.run_id,
        action_types: ['model.generate', 'model.summarize'],
        target_kind: null,
        max_amount_nano_usd: '2000000000',
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['synthetic'],
        expires_at: inHours(24),
        rationale: 'Fixture discovery calls for this run.',
      });
      await store.createStandingGrant(owner, ws.id, {
        run_id: control.run_id,
        action_types: ['source.fetch'],
        target_kind: null,
        max_amount_nano_usd: null,
        allow_irreversible: false,
        allow_external_effects: false,
        data_classes: ['public'],
        expires_at: inHours(24),
        rationale: 'Fetch the fixture corpus for this run.',
      });
    }
    return control.run_id;
  }

  /** Fetches the scenario's pages, records its claims and support, brief and catalog. */
  async function seed(s: DiscoveryScenario, runId: string) {
    const sourceOf: Record<string, { id: string; version: number }> = {};
    for (const url of s.fetch) {
      const r = await sources.fetch(owner, ws.id, runId, {
        url,
        task_id: null,
        logical_operation_id: randomUUID(),
        justification: `Evidence for ${s.title}.`,
      });
      assert.ok(r.source_id, `${url} fetched or recorded (${r.state})`);
      sourceOf[url] = { id: r.source_id, version: r.source_version! };
    }
    const evidence: StartDiscoveryRequest['evidence'] = [];
    for (const c of s.claims) {
      const claim = await store.createEntity(owner, ws.id, {
        kind: 'claim',
        title: c.statement.slice(0, 120),
        body: {
          statement: c.statement,
          basis: 'observation',
          uncertainty: 'Synthetic fixture claim.',
        },
      });
      for (const e of c.support) {
        const src = sourceOf[e.url]!;
        if (e.evidence === 'inaccessible_source') {
          await store.addClaimSupport(owner, ws.id, claim.id, {
            evidence: 'inaccessible_source',
            claim_version: 1,
            source_id: src.id,
            source_version: src.version,
            rationale: 'The page could not be read (fixture).',
          });
          continue;
        }
        const detail = await store.getSource(owner, ws.id, src.id);
        const passage = detail.passages.find((x) =>
          x.excerpt?.includes(e.needle),
        );
        assert.ok(passage, `passage "${e.needle}" in ${e.url}`);
        await store.addClaimSupport(owner, ws.id, claim.id, {
          evidence: 'passage',
          claim_version: 1,
          passage_id: passage.id,
          stance: e.stance,
          support_type: e.support_type,
          quote: e.quote,
          rationale: 'Assessed against the passage text (fixture).',
        });
      }
      evidence.push({ claim_id: claim.id, bears_on: c.bears_on });
    }
    for (const k of s.catalog)
      await store.createEntity(owner, ws.id, {
        kind: k.kind,
        title: k.title,
        body: { summary: k.summary, uncertainty: 'Synthetic catalog entry.' },
      });
    const brief = await store.createEntity(owner, ws.id, {
      kind: 'search_brief',
      title: s.title,
      body: s.brief,
    });
    return { brief, evidence };
  }

  function request(
    s: DiscoveryScenario,
    seeded: Awaited<ReturnType<typeof seed>>,
    over: Partial<StartDiscoveryRequest> = {},
  ): StartDiscoveryRequest {
    return {
      brief: { id: seeded.brief.id, version: 1 },
      evidence: seeded.evidence,
      perspectives: s.perspectives,
      excluded: s.excluded,
      max_revisions: 1,
      max_age_days: 180,
      envelope_id: envelope.id,
      pricing_snapshot_id: pricing.id,
      data_class: 'synthetic',
      limits: {
        max_children: 5,
        max_concurrency: 2,
        max_depth: 1,
        max_attempts: 1,
        max_repairs: 1,
        max_calls: 24,
        max_output_tokens: 4000,
        call_timeout_ms: 5000,
        max_wall_seconds: 600,
      },
      ...over,
    };
  }

  async function discover(
    s: DiscoveryScenario,
    over: Partial<StartDiscoveryRequest> = {},
  ): Promise<{
    detail: WorkflowDetail;
    runId: string;
    seeded: Awaited<ReturnType<typeof seed>>;
  }> {
    const runId = await run();
    const seeded = await seed(s, runId);
    const started = await store.startDiscovery(
      owner,
      ws.id,
      runId,
      request(s, seeded, over),
    );
    await worker.settle();
    return {
      detail: await store.getWorkflow(owner, ws.id, started.workflow.id),
      runId,
      seeded,
    };
  }

  return { db, store, ws, worker, broker, run, seed, request, discover };
}
