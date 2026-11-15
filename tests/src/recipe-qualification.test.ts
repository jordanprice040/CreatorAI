// ADR-0105 (B1): build (recipe) qualifications in the app. The frozen v5 benchmarks and their
// scorer, then the runner end to end on a fixture plan connection with the test-double executor
// (not isolation evidence): admission per attempt, early stop, replacement after a lost lease,
// the owner's Stop, and which records lift the "unqualified trial" label.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
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
  ROLE_CAUSED_STOPS,
  onlyBusyRefusal,
  refusalError,
  importsLedger,
  hasTopLevelFunction,
  infrastructureStop,
  loadRecipeBenchmark,
  recipeFreezeProblems,
  structureBar,
} from '@creator/executor';
import {
  RecipeQualificationRunner,
  sendWhenFree,
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
  // Re-review N-1: a module that can't be read as Python fails, as v4's parse did.
  for (const [content, why] of [
    ['def f(): pass\ndef g(\n', /a bracket is never closed/],
    ["def f(): pass\nx = 'open\n", /a string is never closed/],
    ['def f(): pass\nx = 1)\n', /closed that was never opened/],
    ['def f(): pass\nx = 1 \\', /continues past the end/],
  ] as const) {
    const bad = ok.map((f) =>
      f.path === 'src/ledger/report.py' ? { ...f, content } : f,
    );
    assert.match(
      structureBar(bad).detail,
      /report\.py can't be read as Python/,
    );
    assert.match(structureBar(bad).detail, why);
  }
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
  // Review 1 L-1: the v4 grader's rule, read as Python: strings and comments are not code.
  assert.equal(hasTopLevelFunction('"""\ndef x(): pass\n"""\nX = 1\n'), false);
  assert.equal(hasTopLevelFunction("s = 'def x(): pass'\n"), false);
  assert.equal(
    hasTopLevelFunction('@dec\ndef f(a,\n      b):\n    pass\n'),
    true,
  );
  assert.equal(hasTopLevelFunction('async def f():\n    pass\n'), false);
  assert.equal(importsLedger('import os, ledger\n'), true);
  assert.equal(importsLedger('import os, ledger.rules as r\n'), true);
  assert.equal(
    importsLedger('from .ledger.report import (\n    a,\n    b,\n)\n'),
    true,
  );
  assert.equal(
    importsLedger('def main():\n    from ledger import parse\n'),
    true,
  );
  assert.equal(importsLedger('if True: import ledger\n'), true);
  assert.equal(importsLedger('s = "import ledger"\n# import ledger\n'), false);
  assert.equal(importsLedger('"""\nfrom ledger import x\n"""\n'), false);
  assert.equal(importsLedger('import ledgers\nfrom . import ledger\n'), false);
  // Review 1 L-2 and M-1: only a request that got no answer, or one refused at admission, is
  // infrastructure; an answer the role itself caused to fail is the model's work.
  for (const code of [
    'network_error',
    'provider_error',
    'stream_interrupted',
    'rate_limited',
    'auth_failed',
    'token_unavailable',
    'claude_usage_limit',
    'claude_sign_in_invalid',
    'unavailable',
  ])
    assert.equal(
      infrastructureStop(`Error: Role stopped: failed ${code}`),
      true,
      code,
    );
  for (const code of ROLE_CAUSED_STOPS)
    assert.equal(
      infrastructureStop(`Error: Role stopped: failed ${code}`),
      false,
      code,
    );
  // Re-review L-1: a refusal keeps its codes; the input cap and the attempt's own limit are
  // the roles' work, every other refusal is not.
  const refused = (reasons: { code: string; text: string }[]) =>
    String(
      refusalError(
        new ContractError(
          'ACCESS_DENIED',
          'This plan request is not admitted.',
          reasons.map((r) => r.text),
          reasons,
        ),
      ),
    );
  for (const [code, text, infra] of [
    ['request_open', 'An earlier plan request has an unknown outcome.', true],
    ['daily_cap_reached', 'The studio daily request cap is reached.', true],
    ['sign_in', 'Not signed in with ChatGPT.', true],
    [
      'cap_reached',
      'The request input is larger than the per-request input cap.',
      false,
    ],
  ] as const)
    assert.equal(infrastructureStop(refused([{ code, text }])), infra, code);
  assert.equal(
    infrastructureStop(
      refused([
        { code: 'request_open', text: 'Another plan request is running.' },
        { code: 'cap_reached', text: 'The request input is too large.' },
      ]),
    ),
    false,
  );
  const notCovered = (detail: string) =>
    String(
      refusalError(
        new ContractError(
          'ACCESS_DENIED',
          'This build qualification request is not covered by its start.',
          [detail],
        ),
      ),
    );
  assert.equal(
    infrastructureStop(notCovered('This attempt has used its 8 requests.')),
    false,
  );
  assert.match(
    notCovered('This attempt has used its 8 requests.'),
    /^Error: Plan request refused \(attempt_request_limit\)/,
  );
  assert.equal(
    infrastructureStop(
      notCovered('The request names another build than the attempt recorded.'),
    ),
    true,
  );
  assert.equal(refusalError(new Error('x')), null);
  // Re-review L-3: only "another request is running" makes a role request wait.
  const busy = (code: string, text: string) =>
    new ContractError('ACCESS_DENIED', 'x', [text], [{ code, text }]);
  assert.equal(
    onlyBusyRefusal(
      busy(
        'request_open',
        'Another plan request is already running (one at a time).',
      ),
    ),
    true,
  );
  assert.equal(
    onlyBusyRefusal(
      busy('request_open', 'An earlier plan request has an unknown outcome.'),
    ),
    false,
  );
  // Re-review L-2: one rule for a refused model on every route.
  assert.equal(
    infrastructureStop('Error: Role stopped: failed model_refused'),
    false,
  );
});

test('review 1 N-3: tool leftovers beside a benchmark neither break nor join its freeze', async (t) => {
  await mkdir(resolve('.verification'), { recursive: true });
  const tmp = await mkdtemp(join(resolve('.verification'), 'recipe-freeze-'));
  t.after(() => rm(tmp, { recursive: true, force: true }));
  const id = 'p14-small-wordtally-v5';
  await cp(
    fileURLToPath(path(`config/recipe-benchmarks/${id}/`)),
    join(tmp, id),
    {
      recursive: true,
    },
  );
  await mkdir(join(tmp, id, 'reference/src/__pycache__'), { recursive: true });
  await writeFile(
    join(tmp, id, 'reference/src/__pycache__/main.cpython-312.pyc'),
    'x',
  );
  await writeFile(join(tmp, id, '.DS_Store'), 'x');
  const root = pathToFileURL(`${tmp}/`);
  assert.deepEqual(await recipeFreezeProblems(id, root), []);
  await writeFile(join(tmp, id, 'reference/src/extra.py'), 'x = 1\n');
  assert.match(
    (await recipeFreezeProblems(id, root)).join(' '),
    /reference\/src\/extra\.py was added after the freeze/,
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
  const answer = {
    id: 'p15-small-signup-v5' as string,
    reviewer: 'approve',
    /** Awaited before each answer, so a test can act while a request is in flight. */
    before: async () => {},
  };
  const fake = await fakePlan({
    beforeResponse: () => answer.before(),
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

test('review 1 M-1: an unknown outcome refuses Start, and mid-run it stops the qualification instead of failing the model', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  const verification = (
    await s.db.pool.query(
      'select id, state from plan_requests where connection_id = $1',
      [s.conn.id],
    )
  ).rows[0] as { id: string; state: string };
  const mark = (state: string) =>
    s.db.pool.query('update plan_requests set state = $2 where id = $1', [
      verification.id,
      state,
    ]);
  await mark('unknown');
  await rejects(
    'INVALID_TRANSITION',
    s.start('p15-small-signup-v5'),
    /An earlier plan request on this connection has an unknown outcome/,
  );
  await mark(verification.state);
  const q = await s.start('p15-small-signup-v5');
  // While the builder's request is in flight, an earlier request's outcome becomes unknown (as
  // a Claude answer cut off at its time limit does). The reviewer's request is then refused at
  // admission: that judges nothing about the roles.
  let calls = 0;
  s.answer.before = async () => {
    if (++calls === 1) await mark('unknown');
  };
  const sent = s.fake.responseRequests.length;
  const done = await s.run(q.id);
  assert.deepEqual(s.errors, []);
  assert.equal(done.state, 'stopped', done.reason ?? '');
  assert.match(
    done.reason!,
    /Stopped before attempt 1 \(its replacement\), which was not started: an earlier plan request/,
  );
  assert.deepEqual(
    done.attempts.map((a) => a.state),
    ['invalid'],
    'refused at admission is no verdict, and no replacement is spent on a refusal',
  );
  assert.match(done.attempts[0]!.reason!, /infrastructure/);
  assert.equal(
    s.fake.responseRequests.length - sent,
    1,
    'only the builder request was sent',
  );
});

test('review 1 M-1: another request running makes a qualification wait; one left running past its limit stops it', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  const q = await s.start('p15-small-signup-v5');
  const id = (
    await s.db.pool.query(
      'select id from plan_requests where connection_id = $1',
      [s.conn.id],
    )
  ).rows[0].id as string;
  await s.db.pool.query(
    "update plan_requests set state = 'in_flight', started_at = clock_timestamp() where id = $1",
    [id],
  );
  assert.equal((await s.store.leaseRecipeQualification('a', 60_000))?.id, q.id);
  const wait = await s.store.nextRecipeAttempt(q.id, 'a', 4);
  assert.equal(wait.kind, 'wait');
  let r = await s.store.getRecipeQualification(owner, s.ws.id, q.id);
  assert.equal(r.state, 'running');
  assert.equal(r.attempts.length, 0, 'nothing was started or spent');
  assert.match(r.reason!, /Waiting for another plan request/);
  // The runner leaves it for a short wait instead of taking it again at once.
  assert.equal(await s.store.leaseRecipeQualification('b', 60_000), null);
  await s.db.pool.query(
    "update plan_requests set started_at = clock_timestamp() - interval '1 hour' where id = $1",
    [id],
  );
  assert.deepEqual(await s.store.nextRecipeAttempt(q.id, 'a', 4), {
    kind: 'end',
  });
  r = await s.store.getRecipeQualification(owner, s.ws.id, q.id);
  assert.equal(r.state, 'stopped');
  assert.match(r.reason!, /running past its time limit/);
  assert.equal(r.attempts.length, 0);
});

test('review 1 N-2: Stop during a running attempt voids it; the build it cut short is never recorded as a failure', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  const q = await s.start('p15-small-signup-v5');
  let calls = 0;
  s.answer.before = async () => {
    // L-3: Stop needs no version, so a page that read an older one can still stop it.
    if (++calls === 1)
      await s.store.stopRecipeQualification(owner, s.ws.id, q.id, {});
  };
  const sent = s.fake.responseRequests.length;
  const done = await s.run(q.id);
  assert.deepEqual(s.errors, []);
  assert.equal(done.state, 'stopped');
  assert.equal(done.reason, 'Stopped by the owner.');
  assert.deepEqual(
    done.attempts.map((a) => a.state),
    ['invalid'],
  );
  assert.equal(
    done.attempts[0]!.reason,
    'Stopped by the owner before a verdict.',
  );
  assert.equal(done.attempts[0]!.result, null, 'the late outcome was dropped');
  assert.equal(
    s.fake.responseRequests.length - sent,
    1,
    'nothing more was sent after Stop',
  );
});

test('re-review N-5: the runner waits for another request, then runs the qualification to its verdict', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  const q = await s.start('p15-small-signup-v5');
  const id = (
    await s.db.pool.query(
      'select id from plan_requests where connection_id = $1',
      [s.conn.id],
    )
  ).rows[0].id as string;
  const before = (
    await s.db.pool.query(
      'select state, started_at from plan_requests where id = $1',
      [id],
    )
  ).rows[0] as { state: string; started_at: Date };
  await s.db.pool.query(
    "update plan_requests set state = 'in_flight', started_at = clock_timestamp() where id = $1",
    [id],
  );
  let r = await s.run(q.id);
  assert.equal(r.state, 'running');
  assert.equal(r.attempts.length, 0);
  assert.match(r.reason!, /Waiting for another plan request/);
  // The other request settles; the short lease lapses and the runner takes it again.
  await s.db.pool.query(
    'update plan_requests set state = $2, started_at = $3 where id = $1',
    [id, before.state, before.started_at],
  );
  await s.db.pool.query(
    'update recipe_qualifications set lease_until = clock_timestamp() where id = $1',
    [q.id],
  );
  r = await s.run(q.id);
  assert.deepEqual(s.errors, []);
  assert.equal(r.state, 'qualified', r.reason ?? '');
  assert.deepEqual(
    r.attempts.map((a) => a.state),
    ['passed', 'passed', 'passed'],
  );
});

test('re-review N-4: a lost sign-in stops the qualification before an attempt is started', async (t) => {
  const s = await setup(t);
  if (!s) return;
  await s.qualifyRoles();
  const q = await s.start('p15-small-signup-v5');
  await s.db.pool.query(
    `update plan_connections set sign_in = jsonb_set(sign_in, '{state}', '"reauthorization_required"')
      where id = $1`,
    [s.conn.id],
  );
  const r = await s.run(q.id);
  assert.equal(r.state, 'stopped');
  assert.equal(r.attempts.length, 0, 'no attempt or replacement was spent');
  assert.match(r.reason!, /Stopped before attempt 1.*can't take requests now/);
});

test('re-review L-3: a role request waits while another request runs, within its bound', async () => {
  const busy = () =>
    new ContractError(
      'ACCESS_DENIED',
      'This plan request is not admitted.',
      ['Another plan request is already running (one at a time).'],
      [
        {
          code: 'request_open',
          text: 'Another plan request is already running (one at a time).',
        },
      ],
    );
  let n = 0;
  assert.equal(
    await sendWhenFree(
      async () => {
        if (++n < 3) throw busy();
        return 'sent';
      },
      { pollMs: 1 },
    ),
    'sent',
  );
  assert.equal(n, 3);
  // Past the bound, the refusal becomes a coded build reason (infrastructure).
  const late = await sendWhenFree(
    async () => {
      throw busy();
    },
    { pollMs: 1, boundMs: 5 },
  ).catch((e: unknown) => String(e));
  assert.match(late, /^Error: Plan request refused \(request_open\)/);
  assert.equal(infrastructureStop(late), true);
  // Stop ends the wait at once.
  let tries = 0;
  await sendWhenFree(
    async () => {
      tries++;
      throw busy();
    },
    { pollMs: 1, stopped: () => true },
  ).catch(() => {});
  assert.equal(tries, 1);
});
