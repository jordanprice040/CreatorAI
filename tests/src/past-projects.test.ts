import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { PastProjectsSchema, type ExplorationResult } from '@creator/contracts';
import { DISCOVERY_SCENARIOS } from '@creator/domain';
import { FixtureAdapter } from '@creator/broker';
import { discoverySetup, owner } from './discovery-harness.js';

// F9 "Start a similar project" (ADR-0125): the server's read model of past discovery runs.
// It carries the setup a new project may start from and nothing that belongs to the past run
// itself (claims, evidence roles, decisions, approvals, budgets).

const scenario = (key: string) =>
  DISCOVERY_SCENARIOS.find((s) => s.key === key)!;

test('past projects: setup only, newest first, exploration websites, one per brief, no claims', async (t) => {
  const s = await discoverySetup(t, new FixtureAdapter());
  if (!s) return;
  const ws = s.ws.id;
  assert.deepEqual(await s.store.pastProjects(owner, ws), []);

  // Claims and a written brief, then an exploration limited by websites and a brief picked
  // from it (before any discovery, so the pick is not a duplicate of a used brief).
  const seeded = await s.seed(scenario('software'), await s.run());
  const envelope = (await s.store.listEnvelopes(owner, ws))[0]!;
  const pricing = (await s.store.listPricing(owner, ws))[0]!;
  const exploreRun = await s.run();
  const explored = await s.store.startExploration(owner, ws, exploreRun, {
    scope: {
      interests: [],
      target_groups: [],
      exclusions: [],
      only_hosts: [],
      excluded_hosts: ['skip.example', 'ads.example'],
      max_candidates: 3,
      max_claims: 30,
      max_age_days: 180,
      leave_out: [],
    },
    resource_setup: {
      kind: 'api',
      envelope_id: envelope.id,
      pricing_snapshot_id: pricing.id,
    },
    data_class: 'synthetic',
    limits: {
      max_children: 1,
      max_concurrency: 1,
      max_depth: 1,
      max_attempts: 1,
      max_repairs: 1,
      max_calls: 2,
      max_output_tokens: 4000,
      call_timeout_ms: 5000,
      max_wall_seconds: 600,
    },
  });
  await s.worker.settle();
  const exploration = await s.store.getWorkflow(
    owner,
    ws,
    explored.workflow.id,
  );
  const shortlist = exploration.workflow.result?.exploration as
    ExplorationResult | undefined;
  const pick = shortlist?.candidates.find((c) => c.disposition === 'candidate');
  assert.ok(pick, exploration.workflow.reason);
  const made = await s.store.createExploredBrief(
    owner,
    ws,
    explored.workflow.id,
    pick.ref,
    { reason: 'Test pick.' },
  );

  // A plain discovery from the written brief.
  const first = await s.store.startDiscovery(
    owner,
    ws,
    await s.run(),
    s.request(scenario('software'), seeded),
  );
  await s.worker.settle();
  const secondRun = await s.run('supervised');
  const second = await s.store.startDiscovery(
    owner,
    ws,
    secondRun,
    s.request(scenario('software'), seeded, {
      brief: { id: made.brief.id, version: 1 },
      max_revisions: 2,
    }),
  );
  await s.worker.settle();

  const list = PastProjectsSchema.parse(await s.store.pastProjects(owner, ws));
  // Only discoveries are projects: the exploration itself is not listed.
  assert.deepEqual(
    list.map((p) => p.workflow_id),
    [second.workflow.id, first.workflow.id],
  );
  const [fromPick, plain] = list as [
    (typeof list)[number],
    (typeof list)[number],
  ];
  // The brief as that run used it, its Discover settings, websites and route.
  assert.deepEqual(fromPick.brief.body, made.brief.body);
  assert.equal(fromPick.brief.version, 1);
  assert.equal(fromPick.settings.max_revisions, 2);
  assert.equal(fromPick.settings.max_age_days, 180);
  assert.equal(fromPick.settings.data_class, 'synthetic');
  assert.equal(fromPick.settings.oversight, 'supervised');
  assert.deepEqual(
    fromPick.settings.perspectives,
    scenario('software').perspectives,
  );
  assert.deepEqual(fromPick.settings.excluded, scenario('software').excluded);
  assert.deepEqual(fromPick.sites, {
    exploration_id: explored.workflow.id,
    only_hosts: [],
    excluded_hosts: ['skip.example', 'ads.example'],
  });
  assert.deepEqual(fromPick.connection, { kind: 'api' });
  // A brief written by hand has no exploration and so no website lists.
  assert.deepEqual(plain.sites, {
    exploration_id: null,
    only_hosts: [],
    excluded_hosts: [],
  });
  assert.equal(plain.settings.oversight, 'human_in_loop');
  assert.equal(plain.settings.max_revisions, 1);

  // No claim, budget or price list is carried: not even an id.
  const text = JSON.stringify(list);
  for (const e of seeded.evidence)
    assert.ok(!text.includes(e.claim_id), 'no claim ids');
  assert.ok(!text.includes(envelope.id), 'no budget');
  assert.ok(!text.includes(pricing.id), 'no price list');

  // The same brief run again is one entry, the newest run.
  const thirdRun = await s.run();
  const third = await s.store.startDiscovery(
    owner,
    ws,
    thirdRun,
    s.request(scenario('software'), seeded),
  );
  await s.worker.settle();
  const again = await s.store.pastProjects(owner, ws);
  assert.deepEqual(
    again.map((p) => p.workflow_id),
    [third.workflow.id, second.workflow.id],
  );

  // A redacted brief is skipped rather than guessed at.
  await s.store.redactEntity(owner, ws, made.brief.id, {
    expected_version: 1,
    reason_code: 'owner_request',
  });
  assert.deepEqual(
    (await s.store.pastProjects(owner, ws)).map((p) => p.workflow_id),
    [third.workflow.id],
  );

  // Someone outside the workspace reads nothing.
  await assert.rejects(s.store.pastProjects({ actorId: randomUUID() }, ws));
});
