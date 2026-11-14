// ADR-0105 (B1): build (recipe) qualifications in the app. The frozen v5 benchmarks and their
// scorer, then the runner end to end on a fixture plan connection with the test-double executor
// (not isolation evidence): admission per attempt, early stop, replacement after a lost lease,
// the owner's Stop, and which records lift the "unqualified trial" label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join, relative, resolve } from 'node:path';
import {
  CREDITS_OFF_STATEMENT,
  ContractError,
  RECIPE_BENCHMARK_IDS,
  RECIPE_BENCHMARK_INFO,
  RECIPE_BENCHMARKS,
  RecipeBenchmarkOffersSchema,
  recipePasses,
  recipeQualificationMaxRequests,
  unqualifiedTrial,
  type ErrorCode,
  type PlanConnection,
  type RecipeQualificationRecord,
} from '@creator/contracts';
import { ConnectionStore, type CommandContext } from '@creator/db';
import { MemoryVault, PlanConnectionService } from '@creator/broker';
import { BUILD_ROLE_PROMPTS, canonicalHash } from '@creator/domain';
import {
  ProductSupervisor,
  digest,
  infrastructureStop,
  loadRecipeBenchmark,
  recipeFreezeProblems,
  structureBar,
} from '@creator/executor';
import {
  RecipeQualificationRunner,
  recipeBenchmarkOffers,
  startRecipeQualification,
} from '../../apps/api/dist/recipe-qualification.js';
import { freshDatabase } from './pg-harness.js';
import { fakePlan } from './plan-fakes.js';
import { TestDoubleExecutor } from './artifact-double.js';

const root = new URL('../../', import.meta.url);
const path = (p: string) => new URL(p, root);
const text = (p: string) => readFileSync(path(p), 'utf8');
const json = (p: string) => JSON.parse(text(p)) as Record<string, unknown>;
const SETTINGS = json(
  'config/connections/chatgpt-plan.json',
) as unknown as PlanConnection['settings'];
const owner: CommandContext = { actorId: randomUUID() };
/** The November 6 versions the v5 copies were made from. */
const SOURCES: Record<string, string> = {
  'p15-small-signup-v5': 'config/web-benchmarks/p15-small-signup-v4',
  'p14-small-wordtally-v5': 'config/repo-benchmarks/p14-small-wordtally-v2',
  'p14-larger-ledgercheck-v5':
    'config/repo-benchmarks/v4/p14-larger-ledgercheck-v4',
};
const rejects = (code: ErrorCode, p: Promise<unknown>, detail?: RegExp) =>
  assert.rejects(p, (e: unknown) => {
    assert.ok(e instanceof ContractError, String(e));
    assert.equal(
      e.code,
      code,
      `${e.code}: ${e.message} ${e.details.join(' | ')}`,
    );
    if (detail)
      assert.ok(
        [e.message, ...e.details].some((d) => detail.test(d)),
        [e.message, ...e.details].join(' | '),
      );
    return true;
  });
const until = async (f: () => boolean | Promise<boolean>, ms = 5000) => {
  const end = Date.now() + ms;
  while (!(await f())) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 20));
  }
};
function files(dir: string): string[] {
  return readdirSync(dir)
    .flatMap((n) => {
      const p = join(dir, n);
      return statSync(p).isDirectory() ? files(p) : [p];
    })
    .sort();
}
/** The reference solution of a v5 benchmark, as package-relative paths. */
function reference(id: string) {
  const dir = resolve(
    new URL(`config/recipe-benchmarks/${id}/reference/`, root).pathname,
  );
  return files(dir).map((f) => ({
    path: relative(dir, f).split('\\').join('/'),
    content: readFileSync(f, 'utf8'),
  }));
}

// ---- The frozen benchmarks ---------------------------------------------------------------

test('ADR-0105: each v5 benchmark is frozen, intact and loads with the studio limits', async () => {
  for (const id of RECIPE_BENCHMARK_IDS) {
    assert.deepEqual(await recipeFreezeProblems(id), [], id);
    const b = await loadRecipeBenchmark(id);
    assert.equal(b.info, RECIPE_BENCHMARK_INFO[id]);
    assert.equal(b.extended.length, b.info.extended_cases);
    assert.equal(
      b.freeze_sha256,
      digest(readFileSync(path(`config/recipe-benchmarks/${id}/FREEZE.json`))),
    );
    assert.equal(
      recipeQualificationMaxRequests(b.info),
      6 * b.info.caps.max_calls,
    );
  }
  const offers = RecipeBenchmarkOffersSchema.parse(
    await recipeBenchmarkOffers(),
  );
  assert.equal(
    offers.role_prompts.builder_prompt_sha256,
    digest(BUILD_ROLE_PROMPTS.builder),
  );
  assert.deepEqual(
    offers.benchmarks.map((o) => [o.id, o.freeze_problems.length]),
    RECIPE_BENCHMARK_IDS.map((id) => [id, 0]),
  );
});

test('ADR-0105: the freezes name the scorer and the web checker the studio runs', () => {
  const scorer = digest(
    readFileSync(path('packages/executor/src/recipe-scoring.ts')),
  );
  const checker = digest(
    readFileSync(path('packages/executor/worker/web_recipe.py')),
  );
  for (const id of RECIPE_BENCHMARK_IDS) {
    const f = json(`config/recipe-benchmarks/${id}/FREEZE.json`) as {
      files: Record<string, string>;
    };
    assert.equal(
      f.files['scorer:recipe-scoring.ts'],
      scorer,
      `${id}: scorer changed`,
    );
    if (RECIPE_BENCHMARK_INFO[id].recipe === 'static-web/1')
      assert.equal(
        f.files['checker:web_recipe.py'],
        checker,
        `${id}: checker changed`,
      );
  }
});

test('ADR-0105: a v5 copy has the same task, spec, cases and reference as its source', () => {
  for (const id of RECIPE_BENCHMARK_IDS) {
    const base = SOURCES[id]!;
    assert.equal(RECIPE_BENCHMARK_INFO[id].copied_from, base.split('/').at(-1));
    const a = json(`${base}/spec.json`) as { content: unknown };
    const b = json(`config/recipe-benchmarks/${id}/spec.json`) as {
      content: unknown;
    };
    assert.deepEqual(b.content, a.content, `${id}: spec content`);
    const ref = (dir: string) =>
      files(resolve(path(dir).pathname)).map((f) => [
        relative(resolve(path(dir).pathname), f),
        readFileSync(f, 'utf8'),
      ]);
    assert.deepEqual(
      ref(`config/recipe-benchmarks/${id}/reference/`),
      ref(`${base}/reference/`),
      `${id}: reference`,
    );
    if (RECIPE_BENCHMARK_INFO[id].extended_cases) {
      const x = json(`${base}/extended-cases.json`) as { cases: unknown };
      const y = json(`config/recipe-benchmarks/${id}/extended-cases.json`) as {
        cases: unknown;
      };
      assert.deepEqual(y.cases, x.cases, `${id}: extended cases`);
    }
  }
});

test('ADR-0105: the structure bar reads the package, and infrastructure stops are named exactly', () => {
  const ok = reference('p14-larger-ledgercheck-v5');
  assert.equal(structureBar(ok).passed, true);
  const noFn = ok.map((f) =>
    f.path === 'src/ledger/rules.py'
      ? { ...f, content: 'X = 1\n  def inner(): pass\n' }
      : f,
  );
  assert.match(
    structureBar(noFn).detail,
    /rules\.py has no top-level function/,
  );
  const noImport = ok.map((f) =>
    f.path === 'src/main.py'
      ? { ...f, content: '# from ledger import x\nprint(1)\n' }
      : f,
  );
  assert.match(structureBar(noImport).detail, /does not import from ledger/);
  assert.match(
    structureBar(ok.filter((f) => f.path !== 'src/ledger/parse.py')).detail,
    /parse\.py is missing/,
  );
  assert.equal(
    infrastructureStop('Error: Role stopped: failed plan_limit'),
    true,
  );
  assert.equal(
    infrastructureStop('Error: The worker did not finish check A3'),
    true,
  );
  assert.equal(
    infrastructureStop('Error: Plan roles are not ready: signed out'),
    true,
  );
  assert.equal(infrastructureStop('Error: Repair limit reached'), false);
  assert.equal(
    infrastructureStop('Reviewer blocked: Error: Role stopped: x'),
    false,
  );
});

test('ADR-0105: only a finished, non-fixture qualified record lifts the trial label, for its own roles', () => {
  assert.ok(RECIPE_BENCHMARKS['static-web/1']!.includes('p15-small-signup-v5'));
  const roles = {
    connection_id: randomUUID(),
    model_id: 'm',
    builder_prompt_sha256: digest(BUILD_ROLE_PROMPTS.builder),
    reviewer_prompt_sha256: digest(BUILD_ROLE_PROMPTS.reviewer),
  };
  const record = (
    over: Partial<RecipeQualificationRecord>,
  ): RecipeQualificationRecord => ({
    id: randomUUID(),
    workspace_id: randomUUID(),
    recipe: 'static-web/1',
    benchmark_id: 'p15-small-signup-v5',
    freeze_sha256: 'a'.repeat(64),
    source: 'in_app',
    fixture: false,
    state: 'qualified',
    attempts_needed: 3,
    passed: 3,
    reason: null,
    evidence: null,
    attempts: [],
    executing: false,
    version: 4,
    created_by: randomUUID(),
    created_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    ...roles,
    ...over,
  });
  assert.equal(
    unqualifiedTrial('static-web/1', roles, recipePasses([record({})])),
    false,
  );
  for (const other of [
    record({ fixture: true }),
    record({ state: 'not_qualified', passed: 1 }),
    record({ state: 'running', passed: 2 }),
    record({ state: 'stopped' }),
    record({ connection_id: randomUUID() }),
    record({ benchmark_id: 'p15-small-signup-v3' }),
    record({ reviewer_prompt_sha256: digest('an older reviewer prompt') }),
  ])
    assert.equal(
      unqualifiedTrial('static-web/1', roles, recipePasses([other])),
      true,
    );
});

// ---- The runner, end to end ---------------------------------------------------------------

/** A fixture connection signed in, with model m verified (and optionally both roles qualified). */
async function setup(t: test.TestContext) {
  const db = await freshDatabase(t);
  if (!db) return null;
  const store = new ConnectionStore(db.pool);
  await store.ensureActor({
    id: owner.actorId,
    kind: 'human',
    display_name: 'owner',
  });
  // The roles answer from the packet they receive: the reference solution, then an approval.
  const answer = { id: 'p15-small-signup-v5' as string, reviewer: 'approve' };
  const fake = await fakePlan({
    respond: (body) => {
      const input = (body.input as { content: string }[])[0]!.content;
      if (body.instructions === BUILD_ROLE_PROMPTS.builder) {
        const p = JSON.parse(input) as {
          candidate: string;
          files: { path: string; hash: string }[];
        };
        return JSON.stringify({
          summary: 'Reference solution',
          blocker: null,
          submission: {
            expected_commit: p.candidate,
            changes: reference(answer.id).map((f) => ({
              path: f.path,
              before_hash: p.files.find((x) => x.path === f.path)?.hash ?? null,
              content: f.content,
            })),
          },
        });
      }
      if (body.instructions === BUILD_ROLE_PROMPTS.reviewer) {
        const p = JSON.parse(input) as Record<string, string>;
        return JSON.stringify({
          candidate: p.candidate,
          spec_hash: p.spec_hash,
          task_hash: p.task_hash,
          verdict: answer.reviewer,
          findings:
            answer.reviewer === 'approve'
              ? []
              : [
                  {
                    severity: 'high',
                    title: 'Fixture',
                    detail: 'Fixture finding.',
                  },
                ],
        });
      }
      return 'ok';
    },
  });
  t.after(() => fake.close());
  const service = new PlanConnectionService({
    store,
    vault: new MemoryVault(),
    fixtureEndpoints: { auth_base: fake.auth_base, api_base: fake.api_base },
    openBrowser: () => {},
    callbackPort: 0,
  });
  const ws = await store.createWorkspace(owner, {
    name: 'Recipe fixture',
    record_mode: 'fixture',
  });
  const conn = await store.createPlanConnection(owner, ws.id, {
    label: 'ChatGPT plan',
    settings: SETTINGS,
  });
  const s = await service.beginSignIn(owner, ws.id, conn.id, {
    open_browser: false,
  });
  assert.equal(await fake.approve(s.authorization_url), 200);
  await until(() => service.signInStatus(conn.id)?.state !== 'pending');
  const current = async () =>
    (await store.planConnectionDetail(owner, ws.id, conn.id)).connection;
  let c = await current();
  await store.attestPlanCredits(owner, ws.id, c.id, {
    expected_version: c.version,
    statement: CREDITS_OFF_STATEMENT,
    checked_on: '2026-11-14',
  });
  c = await current();
  await store.acceptPlanCaps(owner, ws.id, c.id, {
    expected_version: c.version,
    settings_hash: c.settings_hash,
  });
  c = await current();
  const grant = await store.createPlanVerificationGrant(owner, ws.id, c.id, {
    expected_version: c.version,
    model_id: 'm',
    path: 'responses',
    expires_in_minutes: 5,
  });
  await service.verifyModel(owner, ws.id, c.id, {
    id: grant.id,
    model_id: 'm',
  });
  /** Both build roles qualified under the current prompts, as the T12 runs would leave them. */
  const qualifyRoles = async () => {
    for (const [task, prompt] of [
      ['patch_build', BUILD_ROLE_PROMPTS.builder],
      ['independent_review', BUILD_ROLE_PROMPTS.reviewer],
    ] as const) {
      const manifest = {
        cases: [{ input: [{ role: 'system', text: prompt }] }],
      };
      await db.pool.query(
        `insert into plan_qualifications (id, connection_id, model_id, task_class, manifest,
           manifest_hash, min_held_out_cases, floor, state, development, held_out, created_by,
           decided_at)
         values ($1,$2,'m',$3,$4,$5,3,'{}','qualified','[]','[]',$6,clock_timestamp())`,
        [
          randomUUID(),
          conn.id,
          task,
          manifest,
          canonicalHash(manifest),
          owner.actorId,
        ],
      );
    }
  };
  const parent = resolve('.verification/recipe-qualification-tests');
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(join(parent, 'case-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const products = new ProductSupervisor(join(dir, 'products'));
  const double = new TestDoubleExecutor(products);
  const errors: unknown[] = [];
  const runner = new RecipeQualificationRunner({
    store,
    service,
    products,
    executor: double,
    onError: (e) => errors.push(e),
  });
  t.after(() => runner.stop());
  const start = (benchmark_id: string) =>
    startRecipeQualification(store, owner, ws.id, conn.id, {
      benchmark_id,
      model_id: 'm',
    });
  const run = async (id: string) => {
    await runner.sweep();
    await runner.idle();
    return store.getRecipeQualification(owner, ws.id, id);
  };
  return {
    db,
    store,
    fake,
    service,
    ws,
    conn,
    answer,
    qualifyRoles,
    double,
    runner,
    start,
    run,
    errors,
  };
}

test('ADR-0105: a web qualification needs both roles qualified, then runs three attempts to qualified', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await rejects(
    'INVALID_TRANSITION',
    s.start('p15-small-signup-v5'),
    /isn't qualified as the builder/,
  );
  await rejects(
    'INVALID_TRANSITION',
    s.start('p15-small-signup-v5'),
    /isn't qualified as the reviewer/,
  );
  await s.qualifyRoles();
  const q = await s.start('p15-small-signup-v5');
  assert.equal(q.state, 'running');
  assert.equal(
    q.fixture,
    true,
    'a fixture connection says nothing about a real model',
  );
  assert.equal(q.attempts_needed, 3);
  // One build qualification at a time on a connection.
  await rejects(
    'INVALID_TRANSITION',
    s.start('p15-small-signup-v5'),
    /already running/,
  );
  const sent = s.fake.responseRequests.length;
  const done = await s.run(q.id);
  assert.deepEqual(s.errors, []);
  assert.equal(done.state, 'qualified', done.reason ?? '');
  assert.equal(done.passed, 3);
  assert.equal(done.attempts.length, 3);
  for (const a of done.attempts) {
    assert.equal(a.state, 'passed', a.reason ?? '');
    assert.equal(a.requests, 2);
    assert.ok(a.build_id && a.product_id);
    assert.deepEqual(
      a.result!.bars.map((b) => [b.key, b.passed]),
      [
        ['build_verified', true],
        ['requests_within_cap', true],
        ['package_verified', true],
      ],
    );
  }
  assert.equal(s.fake.responseRequests.length - sent, 6);
  // Every role request belongs to its attempt and build, outside any catalog run.
  const { rows } = await s.db.pool.query(
    `select run_id, build_id, recipe_attempt_id, task_class, purpose, data_class
       from plan_requests where recipe_attempt_id is not null order by started_at`,
  );
  assert.equal(rows.length, 6);
  for (const r of rows) {
    assert.equal(r.run_id, null);
    assert.equal(r.purpose, 'task');
    assert.equal(r.data_class, 'synthetic');
    const a = done.attempts.find((x) => x.id === r.recipe_attempt_id)!;
    assert.equal(r.build_id, a.build_id);
  }
  assert.deepEqual(
    rows.map((r) => r.task_class),
    [
      'patch_build',
      'independent_review',
      'patch_build',
      'independent_review',
      'patch_build',
      'independent_review',
    ],
  );
  // Nothing landed in the studio's catalog.
  const runs = await s.db.pool.query(
    "select count(*)::int as n from entities where kind = 'run'",
  );
  assert.equal(runs.rows[0].n, 0);
  // The fixture record is listed but does not lift the label.
  const list = await s.store.listRecipeQualifications(
    owner,
    s.ws.id,
    s.conn.id,
  );
  assert.equal(list.length, 1);
  assert.deepEqual(recipePasses(list), []);
  await s.db.pool.query(
    'update recipe_qualifications set fixture = false where id = $1',
    [q.id],
  );
  const roles = {
    connection_id: s.conn.id,
    model_id: 'm',
    builder_prompt_sha256: done.builder_prompt_sha256,
    reviewer_prompt_sha256: done.reviewer_prompt_sha256,
  };
  assert.equal(
    unqualifiedTrial(
      'static-web/1',
      roles,
      recipePasses(
        await s.store.listRecipeQualifications(owner, s.ws.id, s.conn.id),
      ),
    ),
    false,
  );
});

test('ADR-0105: an attempt admits only its own role requests, within its limit, while it runs', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  const q = await s.start('p15-small-signup-v5');
  const lease = await s.store.leaseRecipeQualification('holder-a', 60_000);
  assert.equal(lease?.id, q.id);
  const next = await s.store.nextRecipeAttempt(q.id, 'holder-a', 4);
  assert.equal(next.kind, 'attempt');
  if (next.kind !== 'attempt') return;
  const buildId = randomUUID();
  const role = (over: Record<string, unknown> = {}) =>
    s.service.buildRole(owner, s.ws.id, s.conn.id, {
      role: 'builder',
      model_id: 'm',
      run_id: null,
      build_id: buildId,
      data_class: 'synthetic',
      input: JSON.stringify({ candidate: 'c', files: [] }),
      timeout_ms: 5000,
      logical_operation_id: randomUUID(),
      recipe_attempt_id: next.attempt_id,
      ...over,
    } as Parameters<typeof s.service.buildRole>[3]);
  const sent = s.fake.responseRequests.length;
  // Before the attempt records its build, no build is covered.
  await rejects('ACCESS_DENIED', role());
  assert.ok(
    await s.store.recordRecipeAttemptBuild(next.attempt_id, 'holder-a', {
      product_id: randomUUID(),
      build_id: buildId,
    }),
  );
  assert.equal(
    await s.store.recordRecipeAttemptBuild(next.attempt_id, 'holder-a', {
      product_id: randomUUID(),
      build_id: randomUUID(),
    }),
    false,
    'an attempt records one build',
  );
  await rejects('ACCESS_DENIED', role({ build_id: randomUUID() }));
  await rejects('ACCESS_DENIED', role({ model_id: 'other' }));
  await rejects('NOT_FOUND', role({ recipe_attempt_id: randomUUID() }));
  assert.equal(s.fake.responseRequests.length, sent, 'nothing was sent');
  for (let i = 0; i < 4; i++) {
    const r = await role();
    assert.equal(r.status, 'succeeded');
  }
  await rejects('ACCESS_DENIED', role(), /used its 4 requests/);
  assert.equal(s.fake.responseRequests.length, sent + 4);
  // Once the owner stops it, the attempt admits nothing more.
  const before = await s.store.getRecipeQualification(owner, s.ws.id, q.id);
  const stopped = await s.store.stopRecipeQualification(owner, s.ws.id, q.id, {
    expected_version: before.version,
  });
  assert.equal(stopped.state, 'stopped');
  assert.equal(stopped.attempts[0]!.state, 'invalid');
  await rejects('ACCESS_DENIED', role());
  await rejects(
    'INVALID_TRANSITION',
    s.store.stopRecipeQualification(owner, s.ws.id, q.id, {
      expected_version: stopped.version,
    }),
  );
  assert.equal(s.fake.responseRequests.length, sent + 4);
});

test('ADR-0105: the first failed attempt ends a Python qualification as not qualified', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  s.answer.id = 'p14-small-wordtally-v5';
  // The worktree QA passes; the exported package then prints the wrong thing.
  s.double.packageOutput = 'not the expected output\n';
  const q = await s.start('p14-small-wordtally-v5');
  const done = await s.run(q.id);
  assert.deepEqual(s.errors, []);
  assert.equal(done.state, 'not_qualified', done.reason ?? '');
  assert.equal(done.attempts.length, 1, 'the rest were not run');
  assert.equal(done.attempts[0]!.state, 'failed');
  assert.match(done.reason!, /Attempt 1 failed: .*0 of 3 attempts passed/);
  const bars = done.attempts[0]!.result!.bars;
  assert.equal(bars.find((b) => b.key === 'package_verified')?.passed, false);
});

test('ADR-0105: a Python qualification passes its extended cases on the exported package', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  s.answer.id = 'p14-larger-ledgercheck-v5';
  const q = await s.start('p14-larger-ledgercheck-v5');
  const done = await s.run(q.id);
  assert.deepEqual(s.errors, []);
  assert.equal(done.state, 'qualified', done.reason ?? '');
  for (const a of done.attempts) {
    assert.deepEqual(a.result!.extended, { passed: 21, total: 21, failed: [] });
    assert.deepEqual(
      a.result!.bars.map((b) => [b.key, b.passed]),
      [
        ['build_verified', true],
        ['requests_within_cap', true],
        ['package_verified', true],
        ['extended_cases', true],
        ['structure', true],
      ],
    );
  }
});

test('ADR-0105: a reviewer that blocks fails the attempt; a lost lease voids it and it is replaced once', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  // A lost lease: the attempt never reached a verdict, so it is invalid, never re-sent.
  const q = await s.start('p15-small-signup-v5');
  assert.equal((await s.store.leaseRecipeQualification('a', 1))?.id, q.id);
  const first = await s.store.nextRecipeAttempt(q.id, 'a', 4);
  assert.equal(first.kind === 'attempt' && first.replaces, null);
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await s.store.leaseRecipeQualification('b', 1))?.id, q.id);
  assert.equal(
    await s.store.recipeAttemptRunning(
      (first as { attempt_id: string }).attempt_id,
      'a',
    ),
    false,
  );
  const second = await s.store.nextRecipeAttempt(q.id, 'b', 4);
  assert.equal(second.kind, 'attempt');
  assert.equal(second.kind === 'attempt' && second.slot, 1);
  assert.equal(
    second.kind === 'attempt' && second.replaces,
    (first as { attempt_id: string }).attempt_id,
  );
  await new Promise((r) => setTimeout(r, 30));
  assert.equal((await s.store.leaseRecipeQualification('c', 60_000))?.id, q.id);
  assert.deepEqual(await s.store.nextRecipeAttempt(q.id, 'c', 4), {
    kind: 'end',
  });
  const r = await s.store.getRecipeQualification(owner, s.ws.id, q.id);
  assert.equal(r.state, 'stopped');
  assert.match(r.reason!, /stopped twice before a verdict/);
  assert.deepEqual(
    r.attempts.map((a) => a.state),
    ['invalid', 'invalid'],
  );

  // A reviewer that blocks is a failed attempt (a verdict on the roles' work), never replaced.
  s.answer.reviewer = 'block';
  const q2 = await s.start('p15-small-signup-v5');
  const done = await s.run(q2.id);
  assert.equal(done.state, 'not_qualified', done.reason ?? '');
  assert.equal(done.attempts.length, 1);
  assert.equal(done.attempts[0]!.state, 'failed');
  assert.equal(done.attempts[0]!.result!.bars[0]!.key, 'build_verified');
  assert.equal(done.attempts[0]!.result!.bars[0]!.passed, false);
});
