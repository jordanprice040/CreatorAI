import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { ContractError, type ErrorCode } from '@creator/contracts';
import { sourcePolicyHash } from '@creator/domain';
import { ResearchStore, type CommandContext } from '@creator/db';
import {
  FIXTURE_SOURCE_POLICY,
  FixtureSourceAdapter,
  SourceBroker,
  sourceConfigFromEnv,
  type SourceAdapter,
} from '@creator/research';
import { freshDatabase } from './pg-harness.js';

// ADR-0056: evidence websites in Settings. Owner-only, versioned, logged, and read on every
// live fetch; "any public website" still never reaches a private or local address.

const rejects = (code: ErrorCode, p: Promise<unknown>, re?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(e.code, code, e.message);
    if (re) assert.match(e.message, re);
    return true;
  });
const owner: CommandContext = { actorId: randomUUID() };
const editor: CommandContext = { actorId: randomUUID() };
const agent: CommandContext = { actorId: randomUUID() };
const inHours = (h: number) =>
  new Date(Date.now() + h * 3_600_000).toISOString();

/** A stand-in for the live adapter: answers every request with a small page, no network. */
function fakeLive(): SourceAdapter & { contacted: string[] } {
  const contacted: string[] = [];
  return {
    kind: 'http',
    contacted,
    fetchHop: async ({ url }) => {
      contacted.push(url.toString());
      return {
        kind: 'response',
        status: 200,
        location: null,
        content_type: 'text/html; charset=utf-8',
        content_encoding: null,
        body: Buffer.from(
          `<html><head><title>${url.hostname}</title></head><body><p>Frame-perfect input timing practice notes from ${url.hostname}, written for this test.</p></body></html>`,
        ),
        truncated: false,
      };
    },
  };
}

async function setup(t: test.TestContext, env: Record<string, string>) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ResearchStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  await store.ensureActor({
    id: editor.actorId,
    kind: 'human',
    display_name: 'Editor',
  });
  await store.ensureActor({
    id: agent.actorId,
    kind: 'agent',
    display_name: 'Research agent',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Real research',
    record_mode: 'real',
  });
  await store.addMember(owner, ws.id, editor.actorId, 'editor');
  await store.addMember(owner, ws.id, agent.actorId, 'editor');
  const config = sourceConfigFromEnv({ CREATOR_SOURCE_FETCH: 'live', ...env });
  const live = fakeLive();
  const broker = new SourceBroker(
    store,
    { fixture: new FixtureSourceAdapter(), live },
    { fixture: FIXTURE_SOURCE_POLICY, live: config.policy },
  );
  const r = await store.createEntity(owner, ws.id, {
    kind: 'run',
    title: 'Evidence run',
    body: {
      state: 'queued',
      experiment_condition: 'human_in_loop',
      discovery_method: 'structured',
      config_hash: null,
    },
  });
  const control = await store.registerRun(owner, ws.id, {
    run: { id: r.id, version: 1 },
    autonomy_mode: 'human_in_loop',
    stage_gates: null,
    initial_grants: [],
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
    rationale: 'Fetch approved public sources for this run.',
  });
  const fetch = (url: string) =>
    broker.fetch(owner, ws.id, control.run_id, {
      url,
      task_id: null,
      logical_operation_id: randomUUID(),
      justification: 'Evidence for the input-timing problem.',
    });
  return { db, store, ws, broker, live, fetch };
}

test('only a human workspace owner can change evidence websites, and stale pages conflict', async (t) => {
  const s = await setup(t, { CREATOR_SOURCE_HOSTS: 'www.speedrun.com' });
  if (!s) return;
  let view = await s.broker.evidenceSites(owner, s.ws.id);
  assert.equal(view.source, 'startup');
  assert.equal(view.version, 0);
  assert.deepEqual(view.hosts, ['www.speedrun.com']);
  // Members can read the list in force, but not change it; nor can an agent.
  assert.equal((await s.broker.evidenceSites(editor, s.ws.id)).mode, 'listed');
  const body = {
    expected_version: 0,
    mode: 'any_public',
    hosts: ['www.speedrun.com'],
    reason: 'Pilot needs wider sources.',
  };
  await rejects(
    'ACCESS_DENIED',
    s.broker.changeEvidenceSites(editor, s.ws.id, body),
  );
  await rejects(
    'ACCESS_DENIED',
    s.broker.changeEvidenceSites(agent, s.ws.id, body),
  );
  // Nothing changed is refused rather than logged.
  await rejects(
    'INVALID_CONTRACT',
    s.broker.changeEvidenceSites(owner, s.ws.id, { ...body, mode: 'listed' }),
    /Nothing changed/,
  );
  view = await s.broker.changeEvidenceSites(owner, s.ws.id, body);
  assert.equal(view.source, 'settings');
  assert.equal(view.version, 1);
  assert.equal(view.mode, 'any_public');
  assert.equal(view.history[0]!.previous_mode, 'listed');
  assert.deepEqual(view.history[0]!.previous_hosts, ['www.speedrun.com']);
  // A page still showing version 0 cannot overwrite version 1.
  await rejects(
    'VERSION_CONFLICT',
    s.broker.changeEvidenceSites(owner, s.ws.id, {
      ...body,
      mode: 'listed',
      hosts: [],
    }),
  );
  // The change is one audit event with its reason, and the record cannot be edited.
  const ev = await s.db.pool.query(
    `select payload from audit_events where action = 'evidence_sites.changed'`,
  );
  assert.equal(ev.rowCount, 1);
  assert.equal(ev.rows[0].payload.reason, 'Pilot needs wider sources.');
  await assert.rejects(
    s.db.pool.query(`update evidence_site_changes set mode = 'listed'`),
  );
  // Invalid entries never reach the database.
  for (const hosts of [
    ['192.168.1.1'],
    ['https://x.org/a'],
    ['a.org', 'a.org'],
  ])
    await rejects(
      'INVALID_CONTRACT',
      s.broker.changeEvidenceSites(owner, s.ws.id, {
        ...body,
        expected_version: 1,
        mode: 'listed',
        hosts,
      }),
    );
});

test('a saved change applies to the next fetch, with its own policy hash and no restart', async (t) => {
  const s = await setup(t, { CREATOR_SOURCE_HOSTS: 'www.speedrun.com' });
  if (!s) return;
  const startupHash = (await s.broker.evidenceSites(owner, s.ws.id))
    .policy_hash;
  assert.equal(startupHash, sourcePolicyHash(s.broker.livePolicy!));
  const before = await s.fetch('https://tasvideos.org/Movies');
  assert.equal(before.state, 'blocked');
  assert.equal(before.reason_code, 'host_not_approved');

  // Subdomain pattern: covers subdomains, not the bare domain.
  let view = await s.broker.changeEvidenceSites(owner, s.ws.id, {
    expected_version: 0,
    mode: 'listed',
    hosts: ['www.speedrun.com', '*.tasvideos.org'],
    reason: 'Add TASVideos.',
  });
  assert.notEqual(view.policy_hash, startupHash);
  const sub = await s.fetch('https://www.tasvideos.org/Movies');
  assert.equal(sub.state, 'fetched', sub.explanation ?? '');
  assert.equal(sub.policy_hash, view.policy_hash);
  assert.equal(
    (await s.fetch('https://tasvideos.org/Movies')).state,
    'blocked',
  );

  // Any public website: an unlisted public host is fetched; local names never are.
  view = await s.broker.changeEvidenceSites(owner, s.ws.id, {
    expected_version: 1,
    mode: 'any_public',
    hosts: [],
    reason: 'Allow any public site for this pilot.',
  });
  const anySite = await s.fetch('https://example-speedrun-wiki.org/frames');
  assert.equal(anySite.state, 'fetched', anySite.explanation ?? '');
  assert.equal(anySite.policy_hash, view.policy_hash);
  const contactedBefore = s.live.contacted.length;
  for (const url of [
    'https://192.168.0.10/',
    'https://localhost/',
    'https://nas.local/',
    'https://router.home.arpa/',
  ]) {
    const r = await s.fetch(url);
    assert.equal(r.state, 'blocked', url);
  }
  assert.equal(s.live.contacted.length, contactedBefore, 'never contacted');

  // Back to an empty list: nothing is approved, every fetch is refused with a clear reason.
  view = await s.broker.changeEvidenceSites(owner, s.ws.id, {
    expected_version: 2,
    mode: 'listed',
    hosts: [],
    reason: 'Pause evidence fetching.',
  });
  assert.equal(view.policy_hash, null);
  const none = await s.fetch('https://www.speedrun.com/x');
  assert.equal(none.state, 'blocked');
  assert.equal(none.reason_code, 'no_websites_approved');
});

test('a studio started with no websites has the adapter but approves nothing until Settings does', async (t) => {
  const s = await setup(t, {});
  if (!s) return;
  const view = await s.broker.evidenceSites(owner, s.ws.id);
  assert.equal(view.live_available, true);
  assert.equal(view.policy_hash, null);
  assert.equal(
    (await s.fetch('https://www.speedrun.com/x')).reason_code,
    'no_websites_approved',
  );
  await s.broker.changeEvidenceSites(owner, s.ws.id, {
    expected_version: 0,
    mode: 'listed',
    hosts: ['www.speedrun.com'],
    reason: 'First approved site.',
  });
  assert.equal((await s.fetch('https://www.speedrun.com/x')).state, 'fetched');
});

test('with live fetching off for the deployment, changes are refused', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ResearchStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'Owner',
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Off',
    record_mode: 'real',
  });
  const broker = new SourceBroker(
    store,
    { fixture: new FixtureSourceAdapter(), live: null },
    { fixture: FIXTURE_SOURCE_POLICY, live: null },
  );
  assert.equal(
    (await broker.evidenceSites(owner, ws.id)).live_available,
    false,
  );
  await rejects(
    'INVALID_CONFIG',
    broker.changeEvidenceSites(owner, ws.id, {
      expected_version: 0,
      mode: 'any_public',
      hosts: [],
      reason: 'Try it.',
    }),
  );
});
