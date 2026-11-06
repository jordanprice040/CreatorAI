// ADR-0078 (P15 slice 1): the static-web/1 recipe. Contract and recipe rules, the build and
// package path with fixture roles and the test-double executor (not isolation evidence), the
// checker's verdict rules, the preview frame host, and an opt-in run of the real checker in
// Bubblewrap with the pinned headless browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { request, type Server } from 'node:http';
import { join, resolve } from 'node:path';
import {
  ArtifactSupervisor,
  BuildSupervisor,
  ExecutionSupervisor,
  ProductSupervisor,
  WEB_QA_RUNTIME,
  WEB_TEMPLATE,
  browserResult,
  casePassed,
  digest,
  qaPassed,
  type Binding,
  type BuildPlan,
  type BuildPorts,
  type Execution,
} from '@creator/executor';
import {
  BuildManifestSchema,
  SpecContentSchema,
  buildBlockers,
  formatBrowserStep,
  parseBrowserStep,
  parseBrowserSteps,
  specRecipe,
  taskRecipe,
  type BrokerCallRequest,
  type BrokerCallResult,
  type SpecBody,
  type SpecContent,
} from '@creator/contracts';
import {
  BUILD_FIXTURE_SPEC,
  frozenBrowserCases,
  taskHashes,
} from '@creator/domain';
import {
  createPreviewServer,
  siteFile,
} from '../../apps/api/dist/artifacts.js';
import { TestDoubleExecutor } from './artifact-double.js';

const ROOT = resolve('.');
const BENCH = join(ROOT, 'config/web-benchmarks/p15-small-signup-v1');
const benchSpec = (): SpecContent =>
  JSON.parse(readFileSync(join(BENCH, 'spec.json'), 'utf8')).content;
const reference = (name: string) =>
  readFileSync(join(BENCH, 'reference/site', name), 'utf8');

test('typed browser steps parse, format back and refuse malformed lines', () => {
  const text = [
    'fill #name = Ada Lovelace',
    'fill #name =',
    'select #plan = pro',
    'press #email = Enter',
    'check #terms',
    'click button.save',
    'goto #/about',
    'expect text #out = Hello, Ada!',
    'expect contains #out = Hola',
    'expect visible #err',
    'expect hidden ul li.empty',
    'expect count #plan option = 2',
    'expect title = Sign up',
  ].join('\n');
  const r = parseBrowserSteps(text);
  assert.ok('steps' in r, JSON.stringify(r));
  assert.deepEqual(r.steps[1], {
    action: 'fill',
    selector: '#name',
    value: '',
  });
  assert.deepEqual(r.steps[10], {
    action: 'expect_hidden',
    selector: 'ul li.empty',
  });
  assert.deepEqual(r.steps[11], {
    action: 'expect_count',
    selector: '#plan option',
    count: 2,
  });
  for (const s of r.steps) {
    const again = parseBrowserStep(formatBrowserStep(s));
    assert.ok('step' in again);
    assert.deepEqual(again.step, s);
  }
  for (const bad of [
    'run alert(1)',
    'fill #name',
    'press #name = F5',
    'expect count li = many',
    'goto https://example.com',
    'expect text = no selector',
  ])
    assert.ok('error' in parseBrowserStep(bad), bad);
  const line = parseBrowserSteps('click #a\n\nnope');
  assert.ok('error' in line && line.error.startsWith('Line 3:'));
});

test('the frozen checks choose the recipe; mixed, uncovered and unscoped web tasks are refused in words', () => {
  const web = SpecContentSchema.parse(benchSpec());
  assert.equal(taskRecipe(web, 'T1'), 'static-web/1');
  assert.equal(specRecipe(web), 'static-web/1');
  assert.deepEqual(buildBlockers(web, 'T1', 'synthetic'), []);
  const python = SpecContentSchema.parse(BUILD_FIXTURE_SPEC);
  assert.equal(taskRecipe(python, 'T1'), 'python-build/1');
  assert.equal(specRecipe(python), 'python-build/1');

  const noHeldOut = structuredClone(web);
  for (const a of noHeldOut.acceptance_checks)
    for (const c of a.browser_cases ?? []) c.held_out = false;
  assert.match(buildBlockers(noHeldOut, 'T1').join(' '), /held out/);
  const empty = structuredClone(web);
  delete empty.acceptance_checks[0]!.browser_cases;
  assert.equal(taskRecipe(empty, 'T1'), null);
  assert.match(buildBlockers(empty, 'T1').join(' '), /no browser cases/);
  const unscoped = structuredClone(web);
  unscoped.tasks[0]!.file_scope = ['src'];
  assert.match(buildBlockers(unscoped, 'T1').join(' '), /site/);

  // One task with both kinds of check.
  const mixed = structuredClone(web);
  mixed.acceptance_checks.push({
    ...structuredClone(python.acceptance_checks[0]!),
    key: 'A9',
  });
  mixed.tasks[0]!.acceptance.push('A9');
  assert.equal(taskRecipe(mixed, 'T1'), null);
  assert.match(buildBlockers(mixed, 'T1').join(' '), /mixes browser checks/);
  // Two tasks of different kinds in one spec: a product builds one kind.
  const two = structuredClone(web);
  two.acceptance_checks.push({
    ...structuredClone(python.acceptance_checks[0]!),
    key: 'A9',
  });
  two.tasks.push({
    ...structuredClone(two.tasks[0]!),
    key: 'T2',
    acceptance: ['A9'],
    file_scope: ['src'],
  });
  assert.equal(specRecipe(two), 'mixed');
  // A case without an expect step is not a check.
  const noExpect = structuredClone(benchSpec());
  noExpect.acceptance_checks[0]!.browser_cases![0]!.steps = [
    { action: 'click', selector: '#submit' },
  ];
  assert.equal(SpecContentSchema.safeParse(noExpect).success, false);
});

/** A web product with the benchmark spec, fixture roles and the test-double executor. */
async function webSetup(t: test.TestContext) {
  const parent = resolve('.verification/web-recipe-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const spec: SpecBody = {
    ...benchSpec(),
    format: 'spec/1',
    alternative: { id: randomUUID(), version: 1 },
    selection_id: randomUUID(),
  };
  const binding: Binding = {
    workspace_id: randomUUID(),
    owner_id: randomUUID(),
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: digest('web spec'),
    freeze_id: randomUUID(),
    tasks: [{ key: 'T1', hash: taskHashes(spec).T1!, file_scope: ['site'] }],
  };
  const products = new ProductSupervisor(join(root, 'products'));
  const product = await products.create(binding, undefined, 'static-web/1');
  const task = await products.createTask(
    product.id,
    'T1',
    product.initial_commit,
    binding,
  );
  const double = new TestDoubleExecutor(products);
  const cases = frozenBrowserCases(spec, spec.tasks[0]!.acceptance).map(
    ({ held_out: _, ...c }) => c,
  );
  const plan: BuildPlan = {
    format: 'build-plan/1',
    run_id: randomUUID(),
    envelope_id: randomUUID(),
    pricing_snapshot_id: randomUUID(),
    humility_review: { id: randomUUID(), version: 1 },
    data_class: 'synthetic',
    max_repairs: 0,
    max_calls: 2,
    timeout_ms: 10000,
    max_output_tokens: 8000,
    deadline: new Date(Date.now() + 300000).toISOString(),
    cases,
  };
  const packets: { role: string; packet: Record<string, unknown> }[] = [];
  const ports: BuildPorts = {
    current: async () => ({ binding, spec }),
    assertActive: async () => {},
    authorize: async () => ({ verdict: 'allow', fixture: true }),
    call: async (_run, r: BrokerCallRequest) => {
      const role = r.input[0]!.text.split('/')[0]!;
      const packet = JSON.parse(r.input[1]!.text) as Record<string, unknown> & {
        candidate: string;
        spec_hash: string;
        task_hash: string;
        files: { path: string; hash: string }[];
      };
      packets.push({ role, packet });
      const before = (p: string) =>
        packet.files.find((f) => f.path === p)?.hash ?? null;
      const json =
        role === 'builder'
          ? {
              summary: 'Sign-up page',
              blocker: null,
              submission: {
                expected_commit: packet.candidate,
                changes: ['index.html', 'style.css', 'app.js'].map((n) => ({
                  path: `site/${n}`,
                  before_hash: before(`site/${n}`),
                  content: reference(n),
                })),
              },
            }
          : {
              candidate: packet.candidate,
              spec_hash: packet.spec_hash,
              task_hash: packet.task_hash,
              verdict: 'approve',
              findings: [],
            };
      return {
        status: 'succeeded',
        reason_code: 'fixture',
        explanation: 'Test-only port',
        logical_operation_id: r.logical_operation_id,
        attempts: [],
        output: { text: JSON.stringify(json), json, vector: null },
        decision_id: null,
        fixture: true,
        replayed: false,
      } satisfies BrokerCallResult;
    },
  };
  return {
    products,
    product,
    task,
    binding,
    spec,
    double,
    plan,
    ports,
    packets,
  };
}

test('a static web product starts from the reviewed site template and records its recipe', async (t) => {
  const s = await webSetup(t);
  assert.equal(s.product.recipe, 'static-web/1');
  assert.deepEqual(
    (
      await s.products.committedFiles(
        s.product.id,
        s.task.id,
        s.product.initial_commit,
      )
    )
      .map((f) => f.path)
      .sort(),
    Object.keys(WEB_TEMPLATE).sort(),
  );
  // The manifest's recipe and template hash are bound together.
  assert.equal((await s.products.product(s.product.id)).recipe, 'static-web/1');
});

test('a web build sends web QA rules, hides held-out cases, verifies and packages a static-web/1 manifest', async (t) => {
  const s = await webSetup(t);
  const builds = new BuildSupervisor(s.products, s.double);
  const outcome = await builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    s.plan,
    s.ports,
  );
  assert.equal(outcome.state, 'verified_candidate', outcome.reason);
  const builder = s.packets.find((p) => p.role === 'builder')!.packet;
  assert.deepEqual(builder.qa_runtime, WEB_QA_RUNTIME);
  // Only the 4 visible cases travel; held-out pages and steps never do.
  assert.equal((builder.cases as unknown[]).length, 4);
  assert.equal(builder.held_out_cases, 6);
  const text = JSON.stringify(s.packets);
  for (const heldOut of ['kim@site.org', 'Welcome, Grace!', 'al@example'])
    assert.ok(!text.includes(heldOut), `held-out value ${heldOut} leaked`);
  assert.ok(!text.includes('browser_cases'));
  // Every QA run was a browser case on the web recipe.
  assert.equal(s.double.runs.length, 10);
  assert.ok(s.double.runs.every((r) => 'steps' in (r.input as object)));

  const artifacts = new ArtifactSupervisor(s.products, s.double);
  const { manifest } = await artifacts.package(
    s.product.id,
    outcome.id,
    s.ports,
  );
  BuildManifestSchema.parse(manifest);
  assert.equal(manifest.state, 'verified');
  assert.equal(manifest.toolchain.recipe, 'static-web/1');
  assert.equal(manifest.template.id, 'static-site/1');
  assert.equal(manifest.dependencies.kind, 'static-files-only');
  assert.deepEqual(manifest.startup.command.slice(0, 3), [
    'python3',
    '-m',
    'http.server',
  ]);
  assert.equal(manifest.tests.cases.length, 10);
  assert.ok(manifest.tests.cases.every((c) => 'steps' in c));
  assert.ok(
    manifest.limitations.some((l) => /not isolation evidence/.test(l)),
    'test-double backend is labelled',
  );
  assert.ok(manifest.package.files.some((f) => f.path === 'site/app.js'));
});

test('recipes do not cross: CLI cases are refused for a web product and browser cases for a Python one', async (t) => {
  const s = await webSetup(t);
  const builds = new BuildSupervisor(s.products, s.double);
  // A CLI plan against the web product's frozen browser checks.
  const cli = {
    ...s.plan,
    cases: [
      { check_key: 'A1', args: [], stdin: '', stdout: 'x\n', exit_code: 0 },
    ],
  };
  await assert.rejects(
    builds.run(s.product.id, s.task.id, s.product.initial_commit, cli, s.ports),
    /cases frozen in the spec/,
  );
  // The executor refuses a CLI run of a web product before any job directory exists.
  const real = new ExecutionSupervisor(s.products);
  await assert.rejects(
    real.run(
      s.product.id,
      s.task.id,
      s.product.initial_commit,
      s.binding,
      () => {},
      {
        check_key: 'A1',
        args: [],
        stdin: '',
        stdout: '',
        exit_code: 0,
      },
    ),
    /runs only frozen browser cases/,
  );
  // On a host without the reviewed backend, a browser case is recorded blocked, never passed.
  const e = await real.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    s.binding,
    () => {},
    s.plan.cases[0]!,
  );
  assert.equal(e.recipe, 'static-web/1');
  assert.equal(e.state, 'blocked');
  assert.equal(qaPassed(e, s.product.initial_commit, s.plan.cases[0]!), false);
  // A Python product made from the same binding refuses the web plan: its recipe is fixed.
  const py = await s.products.create(s.binding);
  const pyTask = await s.products.createTask(
    py.id,
    'T1',
    py.initial_commit,
    s.binding,
  );
  await assert.rejects(
    builds.run(py.id, pyTask.id, py.initial_commit, s.plan, s.ports),
    /automated acceptance check/,
  );
});

test('a browser case passes only on one complete, clean checker result for this recipe', () => {
  const c = {
    check_key: 'A1',
    page: '/',
    steps: [
      { action: 'click' as const, selector: '#go' },
      { action: 'expect_visible' as const, selector: '#out' },
    ],
  };
  const result = (over: Record<string, unknown> = {}) =>
    JSON.stringify({
      format: 'browser-qa/1',
      passed: true,
      reason: null,
      steps: [
        { index: 0, passed: true, detail: 'done' },
        { index: 1, passed: true, detail: 'passed' },
      ],
      page_errors: [],
      outbound: [],
      ...over,
    });
  const e = (log: string, more: Partial<Execution> = {}): Execution => ({
    id: randomUUID(),
    product_id: randomUUID(),
    task_id: randomUUID(),
    commit: 'a'.repeat(40),
    recipe: 'static-web/1',
    recipe_hash: digest('r'),
    policy_hash: digest('p'),
    input_hash: digest('i'),
    state: 'succeeded',
    started_at: new Date().toISOString(),
    finished_at: new Date().toISOString(),
    environment: { acceptance_hash: digest(JSON.stringify(c)) },
    log,
    exit_code: 0,
    reason: null,
    ...more,
  });
  assert.equal(qaPassed(e(result()), 'a'.repeat(40), c), true);
  assert.equal(casePassed(e(result()), c), true);
  const failing = [
    e(result({ passed: false })),
    e(result({ steps: [{ index: 0, passed: true, detail: 'done' }] })),
    e(result({ page_errors: ['TypeError'] })),
    e(result({ outbound: ['https://cdn.example/x.js'] })),
    e(result() + '\n' + result()),
    e('not json'),
    e(result(), { recipe: 'python-build/1' }),
    e(result(), { exit_code: 1 }),
    e(result(), { reason: 'deadline' }),
    e(result(), { environment: { acceptance_hash: digest('other') } }),
  ];
  for (const x of failing)
    assert.equal(qaPassed(x, 'a'.repeat(40), c), false, x.log);
  assert.equal(browserResult('{"format":"browser-qa/1"}'), null);
});

test('frame-host paths map only to files under site/', () => {
  assert.equal(siteFile('/'), 'site/index.html');
  assert.equal(siteFile('/about.html'), 'site/about.html');
  assert.equal(siteFile('/css/'), 'site/css/index.html');
  assert.equal(siteFile('/a%20b.js'), 'site/a b.js');
  for (const bad of [
    '/../readme.md',
    '/%2e%2e/readme.md',
    '//x',
    '/a/./b',
    '/%E0%A4%A',
    '/a\\b',
  ])
    assert.equal(siteFile(bad), null, bad);
});

/** The preview server with a fake store and package: HTTP behaviour of both hosts. */
async function previewHarness(t: test.TestContext, recipe = 'static-web/1') {
  const id = randomUUID();
  let sessionHash: string | null = null;
  const live = { ok: true };
  const claims: boolean[] = [];
  const record = {
    summary: { id: randomUUID(), manifest_sha256: digest('m') },
    manifest: {
      id: randomUUID(),
      repository: { commit: 'a'.repeat(40) },
      spec: { version: 1 },
      toolchain: { recipe, backend: 'wsl2-bwrap-systemd' },
      startup: { command: ['python3'] },
    },
  };
  const preview = {
    lifetime: 'timed',
    expires_at: new Date(Date.now() + 600000).toISOString(),
    idle_grace_seconds: null,
    manifest_sha256: digest('m'),
    runs_used: 0,
    max_runs: 5,
  };
  const { ContractError } = await import('@creator/contracts');
  const store = {
    openPreview: async () => {
      const s = 'session-' + randomUUID();
      sessionHash = digest(s);
      return s;
    },
    previewAccess: async (_id: string, s: string, claim: boolean) => {
      claims.push(claim);
      if (!live.ok || digest(s) !== sessionHash)
        throw new ContractError(
          'ACCESS_DENIED',
          'Preview session is not valid.',
        );
      return {
        preview,
        record,
        guide: null,
        workspace_id: randomUUID(),
        actor_id: randomUUID(),
        product_id: randomUUID(),
      };
    },
    previewFrame: async (pid: string) => {
      if (pid !== id || !live.ok || !sessionHash)
        throw new ContractError('ACCESS_DENIED', 'Preview access was stopped.');
      return { session_hash: sessionHash, record, product_id: randomUUID() };
    },
  };
  const files = [
    { path: 'readme.md', content: Buffer.from('# private readme') },
    {
      path: 'site/index.html',
      content: Buffer.from('<!doctype html><title>x</title>'),
    },
    { path: 'site/app.js', content: Buffer.from("'use strict';") },
    { path: 'site/data.bin', content: Buffer.from('x') },
  ];
  const artifacts = {
    open: async () => ({
      files,
      manifest: record.manifest,
      archive: Buffer.alloc(0),
    }),
  };
  const server: Server = createPreviewServer(
    store as never,
    artifacts as never,
    null,
  );
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => new Promise<void>((r) => server.close(() => r())));
  const port = (server.address() as { port: number }).port;
  const call = (
    host: string,
    path: string,
    o: {
      method?: string;
      cookie?: string;
      body?: string;
      origin?: string;
    } = {},
  ) =>
    new Promise<{
      status: number;
      headers: Record<string, unknown>;
      body: string;
    }>((ok, no) => {
      const req = request(
        {
          host: '127.0.0.1',
          port,
          path,
          method: o.method ?? 'GET',
          headers: {
            Host: host,
            ...(o.cookie ? { Cookie: o.cookie } : {}),
            ...(o.origin ? { Origin: o.origin } : {}),
            ...(o.body ? { 'Content-Type': 'application/json' } : {}),
          },
        },
        (res) => {
          let body = '';
          res.on('data', (d: Buffer) => (body += d.toString()));
          res.on('end', () =>
            ok({ status: res.statusCode!, headers: res.headers, body }),
          );
        },
      );
      req.on('error', no);
      req.end(o.body);
    });
  const self = `127.0.0.1:${port}`;
  const open = await call(self, `/preview/${id}?ticket=t`);
  const cookie = String((open.headers['set-cookie'] as string[])[0]).split(
    ';',
  )[0]!;
  return { id, port, self, call, cookie, live, claims };
}

test('a web preview page frames the site on its own *.localhost origin with a token bound to the session', async (t) => {
  const h = await previewHarness(t);
  const page = await h.call(h.self, `/preview/${h.id}`, { cookie: h.cookie });
  assert.equal(page.status, 200);
  const src = /<iframe class="site" src="http:\/\/([^/"]+)\/"/.exec(
    page.body,
  )?.[1];
  assert.ok(src, page.body);
  assert.match(
    src!,
    new RegExp(
      `^w${h.id.replaceAll('-', '')}-[0-9a-f]{24}\\.localhost:${h.port}$`,
    ),
  );
  assert.match(
    page.body,
    /sandbox="allow-scripts allow-forms allow-same-origin allow-modals"/,
  );
  assert.match(
    String(page.headers['content-security-policy']),
    new RegExp(`frame-src http://${src!.replace('.', '\\.')}`),
  );

  const index = await h.call(src!, '/');
  assert.equal(index.status, 200);
  assert.equal(index.body, '<!doctype html><title>x</title>');
  const csp = String(index.headers['content-security-policy']);
  for (const d of [
    "connect-src 'none'",
    "form-action 'none'",
    `frame-ancestors http://${h.self}`,
  ])
    assert.ok(csp.includes(d), d);
  assert.equal(index.headers['set-cookie'], undefined);
  assert.equal(
    (await h.call(src!, '/app.js')).headers['content-type'],
    'text/javascript; charset=utf-8',
  );
  // Only site/ files of known types; nothing else in the package is reachable.
  assert.equal((await h.call(src!, '/../readme.md')).status, 404);
  assert.equal((await h.call(src!, '/data.bin')).status, 404);
  assert.equal((await h.call(src!, '/missing.html')).status, 404);
  assert.notEqual((await h.call(src!, '/', { method: 'POST' })).status, 200);
  // A forged token, or the same token on another preview id, is refused.
  const forged = src!.replace(/-[0-9a-f]{24}\./, `-${'0'.repeat(24)}.`);
  assert.equal((await h.call(forged, '/')).status, 403);
  // A new link (new session) ends the old frame.
  await h.call(h.self, `/preview/${h.id}?ticket=t2`);
  assert.equal((await h.call(src!, '/')).status, 403);
});

test('a web preview has no command runs; the run is refused before one is claimed', async (t) => {
  const h = await previewHarness(t);
  const r = await h.call(h.self, `/preview/${h.id}/run`, {
    method: 'POST',
    cookie: h.cookie,
    origin: `http://${h.self}`,
    body: JSON.stringify({ args: [], stdin: '' }),
  });
  assert.equal(r.status, 409);
  assert.match(r.body, /no command runs/);
  assert.ok(!h.claims.includes(true), 'no run was claimed');
});

test('a stopped web preview serves nothing from its frame host', async (t) => {
  const h = await previewHarness(t);
  const page = await h.call(h.self, `/preview/${h.id}`, { cookie: h.cookie });
  const src = /<iframe class="site" src="http:\/\/([^/"]+)\/"/.exec(
    page.body,
  )![1]!;
  h.live.ok = false;
  assert.equal((await h.call(src, '/')).status, 403);
});

const browserDir = process.env.CREATOR_TEST_BROWSER_DIR;
const canRun =
  !!browserDir &&
  existsSync(join(browserDir, 'chrome-headless-shell')) &&
  spawnSync('bwrap', ['--version']).status === 0;
test(
  'REAL CHECKER: the frozen benchmark reference passes in Bubblewrap with the pinned browser and every listed known failure is caught',
  {
    skip: canRun
      ? false
      : 'set CREATOR_TEST_BROWSER_DIR to the pinned headless browser and install bwrap',
  },
  async () => {
    const bench = await import(join(ROOT, 'scripts/p15-web-benchmark.mjs'));
    assert.deepEqual(await bench.verify(), []);
    const s = bench.score(
      'p15-small-signup-v1',
      join(BENCH, 'reference'),
      browserDir,
    );
    assert.equal(s.passed, 10, JSON.stringify(s.results));
    for (const m of bench.mutants('p15-small-signup-v1', browserDir))
      assert.ok(m.caught, `${m.id} not caught: ${JSON.stringify(m)}`);
  },
);
