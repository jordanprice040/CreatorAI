import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  copyFileSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  BenchmarkManifestSchema,
  CREDITS_OFF_STATEMENT,
  ContractError,
  type PlanConnection,
} from '@creator/contracts';
import {
  BENCHMARKS_ROOT,
  ConnectionStore,
  DISCOVERY_BENCHMARK_DIRS,
  currentForDiscoveryRole,
  heldOutKeys,
  offeredDiscoveryBenchmark,
  offeredDiscoveryBenchmarks,
  type CommandContext,
} from '@creator/db';
import { canonicalHash } from '@creator/domain';
import { freshDatabase } from './pg-harness.js';

// ADR-0089 (P34): Qualify a model offers the discovery roles from server-chosen benchmarks.

const root = new URL('../../', import.meta.url);
const SETTINGS = JSON.parse(
  readFileSync(new URL('config/connections/chatgpt-plan.json', root), 'utf8'),
) as PlanConnection['settings'];
const owner: CommandContext = { actorId: randomUUID() };
const refused = (p: Promise<unknown> | (() => unknown), message: RegExp) =>
  assert.rejects(
    typeof p === 'function' ? async () => p() : p,
    (e: unknown) => {
      assert.ok(e instanceof ContractError, String(e));
      assert.equal(e.code, 'INVALID_CONTRACT', e.message);
      assert.match(e.message, message);
      return true;
    },
  );

test('every frozen discovery benchmark folder is in the newest-first list', () => {
  const dirs = readdirSync(
    new URL('config/connections/benchmarks/', root),
  ).filter((d) => d.startsWith('discovery-'));
  assert.deepEqual(
    [...DISCOVERY_BENCHMARK_DIRS].sort(),
    dirs.sort(),
    'a newly frozen discovery folder must be placed in DISCOVERY_BENCHMARK_DIRS (newest first)',
  );
});

test('the app offers a role-current real benchmark for every discovery step', () => {
  const offered = offeredDiscoveryBenchmarks();
  // If the discovery role prompts change, this fails until a new benchmark is frozen for the
  // new prompts, so the app never silently loses Qualify for a discovery step.
  assert.deepEqual(
    offered.map((b) => [b.task_class, b.name]),
    [
      ['research_synthesis', 'plan-discovery-research14-v2-research_synthesis'],
      [
        'candidate_generation',
        'plan-discovery-semantics-v2-candidate_generation',
      ],
      ['scoring', 'plan-discovery-semantics-v2-scoring'],
    ],
  );
  for (const b of offered) {
    assert.equal(b.manifest.fixture, false);
    assert.equal(b.manifest_hash, canonicalHash(b.manifest));
    assert.ok(b.held_out >= 3, `${b.name}: the server needs 3 held-out cases`);
    assert.equal(b.held_out + b.development, b.manifest.cases.length);
    assert.ok(
      currentForDiscoveryRole({
        task_class: b.task_class,
        manifest: b.manifest,
        manifest_hash: b.manifest_hash,
      }),
    );
  }
});

test('a stale manifest is never offered or started, and the list order decides "newest"', async () => {
  // discovery-synthetic-v5 was frozen for r02-discovery/1.3; the role is now newer.
  assert.deepEqual(
    offeredDiscoveryBenchmarks(BENCHMARKS_ROOT, ['discovery-synthetic-v5']),
    [],
  );
  await refused(
    () =>
      offeredDiscoveryBenchmark(
        'plan-discovery-research_synthesis-synthetic-v5',
      ),
    /not a benchmark the app offers/,
  );
  await refused(
    () => offeredDiscoveryBenchmark('no-such-benchmark'),
    /not a benchmark the app offers/,
  );
  // Two current folders: the first listed wins.
  assert.deepEqual(
    offeredDiscoveryBenchmarks(BENCHMARKS_ROOT, [
      'discovery-semantics-v1',
      'discovery-semantics-v2',
    ]).map((b) => b.name),
    [
      'plan-discovery-semantics-v1-candidate_generation',
      'plan-discovery-semantics-v1-scoring',
    ],
  );
  // A newer folder whose prompt no longer matches the role is skipped for the next one, as
  // happens when the role changes: here the newest copy has one edited system message.
  const tmp = mkdtempSync(join(tmpdir(), 'p34-bench-'));
  mkdirSync(join(tmp, 'edited'));
  mkdirSync(join(tmp, 'discovery-semantics-v2'));
  const src = new URL(
    'config/connections/benchmarks/discovery-semantics-v2/candidate_generation.json',
    root,
  );
  copyFileSync(
    src,
    join(tmp, 'discovery-semantics-v2/candidate_generation.json'),
  );
  const edited = JSON.parse(readFileSync(src, 'utf8'));
  edited.name = 'edited-candidate_generation';
  edited.cases[0].input[0].text += ' Also be brief.';
  writeFileSync(
    join(tmp, 'edited/candidate_generation.json'),
    JSON.stringify(edited),
  );
  const tmpRoot = pathToFileURL(`${tmp}/`);
  assert.deepEqual(
    offeredDiscoveryBenchmarks(tmpRoot, [
      'edited',
      'discovery-semantics-v2',
    ]).map((b) => b.name),
    ['plan-discovery-semantics-v2-candidate_generation'],
  );
});

test('ADR-0089: start a discovery qualification by name; stale names, fixture mismatch and seen held-out cases are refused', async (t) => {
  const db = await freshDatabase(t);
  if (!db) return;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  // A connection ready to qualify 'm': credits attested, caps accepted, model verified (the
  // access row is written directly; verification itself is tested elsewhere).
  const ready = async (fixture: boolean) => {
    const w = await store.createWorkspace(owner, {
      name: fixture ? 'P34 fixture' : 'P34 real',
      record_mode: fixture ? 'fixture' : 'real',
    });
    let c = await store.createPlanConnection(owner, w.id, {
      label: 'ChatGPT plan',
      settings: SETTINGS,
    });
    await store.attestPlanCredits(owner, w.id, c.id, {
      expected_version: c.version,
      statement: CREDITS_OFF_STATEMENT,
      checked_on: '2026-10-20',
    });
    c = (await store.planConnectionDetail(owner, w.id, c.id)).connection;
    c = await store.acceptPlanCaps(owner, w.id, c.id, {
      expected_version: c.version,
      settings_hash: c.settings_hash,
    });
    await db.pool.query(
      `insert into plan_model_access (connection_id, model_id, path, access, request_id)
       values ($1, 'm', 'responses', 'verified', $2)`,
      [c.id, randomUUID()],
    );
    return { ws: w, conn: c };
  };
  const fx = await ready(true);
  const seen = await ready(false);
  const { ws } = await ready(false);
  let conn = (await store.listPlanConnections(owner, ws.id))[0]!;
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  assert.equal(conn.fixture, false);
  assert.ok(conn.settings.allowed_task_classes.includes('research_synthesis'));

  // The list: summaries only, never the manifests.
  const listed = await store.planBenchmarks(owner, ws.id);
  assert.deepEqual(
    listed.benchmarks.map((b) => b.task_class),
    ['research_synthesis', 'candidate_generation', 'scoring'],
  );
  assert.ok(listed.benchmarks.every((b) => !('manifest' in b)));
  await assert.rejects(
    store.planBenchmarks({ actorId: randomUUID() }, ws.id),
    'a non-member cannot read it',
  );

  const start = (benchmark: string, on = { ws, conn }) =>
    store.startPlanQualification(owner, on.ws.id, on.conn.id, {
      expected_version: on.conn.version,
      model_id: 'm',
      benchmark,
    });
  const research = listed.benchmarks[0]!;
  // The benchmarks are real, so a fixture connection keeps refusing them.
  await refused(start(research.name, fx), /real ones only real ones/);
  await refused(
    start('plan-discovery-research_synthesis-synthetic-v5'),
    /not a benchmark the app offers/,
  );
  // ADR-0052 is unchanged: held-out cases viewed under another prompt still refuse the start.
  const manifest = BenchmarkManifestSchema.parse(
    JSON.parse(
      readFileSync(
        new URL(
          'config/connections/benchmarks/discovery-research14-v2/research_synthesis.json',
          root,
        ),
        'utf8',
      ),
    ),
  );
  await db.pool.query(
    `insert into plan_connection_events (id, connection_id, kind, body, actor_id)
     values ($1,$2,'qualification_held_out_viewed',$3,$4)`,
    [
      randomUUID(),
      seen.conn.id,
      {
        task_class: 'research_synthesis',
        prompt_hash: 'f'.repeat(64),
        held_out: heldOutKeys(manifest.cases),
      },
      owner.actorId,
    ],
  );
  await refused(start(research.name, seen), /ADR-0052/);
  // PR #173 review 4 item 6: web discovery is research synthesis too, but its held-out keys are
  // its own, so a view of the web benchmark under another prompt never refuses the locator.
  const web = BenchmarkManifestSchema.parse(
    JSON.parse(
      readFileSync(
        new URL('config/connections/benchmarks/web-discovery-v2.json', root),
        'utf8',
      ),
    ),
  );
  assert.equal(web.task_class, 'research_synthesis');
  const webKeys = heldOutKeys(web.cases);
  await db.pool.query(
    `insert into plan_connection_events (id, connection_id, kind, body, actor_id)
     values ($1,$2,'qualification_held_out_viewed',$3,$4)`,
    [
      randomUUID(),
      conn.id,
      {
        task_class: 'research_synthesis',
        prompt_hash: 'e'.repeat(64),
        held_out: webKeys,
        held_out_prompts: webKeys.map(() => 'e'.repeat(64)),
      },
      owner.actorId,
    ],
  );
  const q = await start(research.name);
  assert.equal(q.state, 'running');
  assert.equal(q.task_class, 'research_synthesis');
  assert.equal(q.manifest_hash, research.manifest_hash);
  assert.equal(q.min_held_out_cases, research.held_out);
  assert.deepEqual(q.floor, { numerator: 1, denominator: 1 });
  assert.equal(q.admits_discovery, true);
  assert.equal(q.prompt_current, true);
  // The same model and task cannot be started twice while this one runs.
  conn = await current();
  await assert.rejects(start(research.name), /already running/);

  // PR #175 re-review 2 N-3: both directions, through the view format the app records (one
  // naming the qualification whose results it showed, recomputed from that stored manifest).
  const both = await ready(false);
  for (const m of ['m2', 'm3'])
    await db.pool.query(
      `insert into plan_model_access (connection_id, model_id, path, access, request_id)
       values ($1, $2, 'responses', 'verified', $3)`,
      [both.conn.id, m, randomUUID()],
    );
  const fresh = async () =>
    (await store.planConnectionDetail(owner, both.ws.id, both.conn.id))
      .connection;
  const viewed = (qualification_id: string, cases: typeof web.cases) =>
    db.pool.query(
      `insert into plan_connection_events (id, connection_id, kind, body, actor_id)
       values ($1,$2,'qualification_held_out_viewed',$3,$4)`,
      [
        randomUUID(),
        both.conn.id,
        {
          task_class: 'research_synthesis',
          qualification_id,
          prompt_hash: 'e'.repeat(64),
          held_out: heldOutKeys(cases),
          held_out_prompts: heldOutKeys(cases).map(() => 'e'.repeat(64)),
        },
        owner.actorId,
      ],
    );
  const webHeld = web.cases.filter((c) => c.split === 'held_out').length;
  const startWeb = async (model_id: string) =>
    store.startPlanQualification(owner, both.ws.id, both.conn.id, {
      expected_version: (await fresh()).version,
      model_id,
      manifest: web,
      min_held_out_cases: webHeld,
      floor: { numerator: 1, denominator: 1 },
    });
  const startLocate = async (model_id: string) =>
    store.startPlanQualification(owner, both.ws.id, both.conn.id, {
      expected_version: (await fresh()).version,
      model_id,
      benchmark: research.name,
    });
  // A viewed web qualification does not refuse the locator...
  const webQ = await startWeb('m');
  assert.equal(webQ.admits_web_discovery, true);
  await viewed(webQ.id, web.cases);
  const locateQ = await startLocate('m2');
  assert.equal(locateQ.admits_discovery, true);
  // ...and a viewed locate qualification does not refuse web discovery.
  await viewed(locateQ.id, manifest.cases);
  assert.equal((await startWeb('m3')).admits_web_discovery, true);
});
