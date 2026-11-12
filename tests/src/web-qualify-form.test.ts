import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import ts from 'typescript';
import {
  BenchmarkManifestSchema,
  PLAN_RESPONSES_TASK_CLASSES,
  type PlanQualification,
} from '@creator/contracts';
import { BUILD_ROLE_PROMPTS, BUILD_ROLE_TASK_CLASSES } from '@creator/domain';
import { offeredDiscoveryBenchmarks } from '@creator/db';

// React from the web app's own dependencies, the same copy qualify.tsx renders with.
const webRequire = createRequire(
  new URL('../../apps/web/src/qualify.tsx', import.meta.url),
);
const { createElement } = webRequire('react') as {
  createElement: (
    type: unknown,
    props: unknown,
    ...children: unknown[]
  ) => unknown;
};
const { renderToStaticMarkup } = webRequire('react-dom/server') as {
  renderToStaticMarkup: (element: unknown) => string;
};

// The Models page offers the benchmarks qualify.tsx imports; read the list from its source so
// a benchmark added there is checked here too.
async function bundled(): Promise<string[]> {
  const src = await readFile('apps/web/src/qualify.tsx', 'utf8');
  return [
    ...src.matchAll(
      /from '\.\.\/\.\.\/\.\.\/(config\/connections\/benchmarks\/[^']+\.json)'/g,
    ),
  ].map((m) => m[1]!);
}

test('every benchmark the app offers would pass the server checks it can know about', async () => {
  const files = await bundled();
  assert.ok(files.length >= 4);
  for (const f of files) {
    const m = BenchmarkManifestSchema.parse(
      JSON.parse(await readFile(f, 'utf8')),
    );
    assert.equal(m.fixture, false, `${f} qualifies real connections only`);
    assert.ok(
      (PLAN_RESPONSES_TASK_CLASSES as readonly string[]).includes(m.task_class),
      `${f}: ${m.task_class} is a Responses plan class`,
    );
    // The app asks for every held-out case, and the server needs at least 3.
    assert.ok(m.cases.filter((c) => c.split === 'held_out').length >= 3, f);
    // A build-role benchmark must use today's role prompt, or the server refuses it.
    const role = Object.entries(BUILD_ROLE_TASK_CLASSES).find(
      ([, cls]) => cls === m.task_class,
    )?.[0] as keyof typeof BUILD_ROLE_PROMPTS | undefined;
    if (role)
      for (const c of m.cases)
        assert.equal(
          c.input.find((x) => x.role === 'system')?.text,
          BUILD_ROLE_PROMPTS[role],
          `${f} ${c.case_id} uses the current ${role} prompt`,
        );
  }
  assert.ok(!files.some((f) => f.endsWith('t12-reviewer-v1.json')));
  // Refusal texts send people to Qualify a model only for these tasks (PR #172 review M-1).
  const defaults = await readFile('apps/web/src/discover-defaults.ts', 'utf8');
  const listed = /QUALIFY_IN_APP: readonly string\[\] = \[([^\]]*)\]/.exec(
    defaults,
  )![1]!;
  const inApp = [...listed.matchAll(/'([a-z_]+)'/g)].map((x) => x[1]!).sort();
  // ADR-0086: the web-discovery benchmark is research synthesis too, but it qualifies only
  // Search the web, not the discovery locator those refusal texts are about. The locator has
  // its own in-app benchmark now, offered by the server (ADR-0089, P34).
  const offered = await Promise.all(
    files
      .filter((f) => !/\/web-discovery-v\d+\.json$/.test(f))
      .map(
        async (f) =>
          (JSON.parse(await readFile(f, 'utf8')) as { task_class: string })
            .task_class,
      ),
  );
  assert.ok(files.some((f) => /\/web-discovery-v\d+\.json$/.test(f)));
  const discovery = offeredDiscoveryBenchmarks().map((b) => b.task_class);
  assert.deepEqual(inApp, [...new Set([...offered, ...discovery])].sort());
});

// qualification-role.ts imports types only, so it runs as transpiled.
async function loadRole() {
  const code = ts.transpileModule(
    await readFile('apps/web/src/qualification-role.ts', 'utf8'),
    { compilerOptions: { module: ts.ModuleKind.CommonJS } },
  ).outputText;
  const exports = {} as {
    forRole: <T>(qs: readonly T[], admits: string | null) => T[];
    manifestRole: (m: { cases: { check?: unknown }[] }) => string | null;
    rowLatest: <T>(qs: readonly T[], q: T) => T | null;
    qualificationTask: (q: object) => string;
    runningFor: <T>(
      qs: readonly T[],
      model: string,
      task: string,
      admits: string | null,
    ) => { kind: string; qualification?: T };
  };
  new Function('require', 'exports', code)(() => ({}), exports);
  return exports;
}

// qualify.tsx with its sibling import stubbed; the benchmark files and React load for real.
async function loadQualify() {
  const roleModule = await loadRole();
  const source = await readFile('apps/web/src/qualify.tsx', 'utf8');
  const code = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      esModuleInterop: true,
    },
  }).outputText;
  const require = createRequire(
    new URL('../../apps/web/src/qualify.tsx', import.meta.url),
  );
  const exports = {} as {
    runOutcome: (
      q: { task_class: string; model_id: string },
      out: unknown,
    ) => string;
    benchmarkState: (
      qualifications: readonly PlanQualification[],
      model: string,
      task: string,
      allowed: readonly string[],
      admits?: 'assessment' | 'discovery' | 'web_discovery' | null,
    ) => { kind: string };
    QualifyModel: (props: Record<string, unknown>) => unknown;
    offers: (discovery: readonly unknown[]) => unknown[];
    queueChoices: (
      qualifications: readonly PlanQualification[],
      model: string,
      allowed: readonly string[],
      list?: readonly unknown[],
    ) => {
      name: string;
      task_class: string;
      eligible: boolean;
      state: { kind: string };
      start: Record<string, unknown>;
    }[];
    queueBody: (
      version: number,
      model: string,
      list: readonly { start: Record<string, unknown> }[],
    ) => {
      expected_version: number;
      model_id: string;
      items: {
        manifest: { name: string; task_class: string };
        min_held_out_cases: number;
        floor: unknown;
        benchmark?: string;
      }[];
    };
  };
  new Function('require', 'exports', code)(
    (name: string) =>
      name === './qualification-role.js'
        ? roleModule
        : name === './oversight.js'
          ? {
              words: (s: string) => s.replaceAll('_', ' '),
              api: async () => {},
            }
          : name === './allow-tasks.js'
            ? {
                AllowTasks: ({ label }: { label: string }) =>
                  createElement('button', null, label),
              }
            : require(name),
    exports,
  );
  return exports;
}

const qualification = (
  over: Partial<PlanQualification> = {},
): PlanQualification => ({
  id: randomUUID(),
  connection_id: randomUUID(),
  model_id: 'gpt-6-astra',
  task_class: 'specification',
  manifest_hash: 'a'.repeat(64),
  min_held_out_cases: 3,
  floor: { numerator: 1, denominator: 1 },
  state: 'running',
  development: { passed: 0, total: 0 },
  held_out: { passed: 0, total: 0 },
  reason: null,
  created_by: randomUUID(),
  created_at: '2026-11-11T10:00:00.000Z',
  decided_at: null,
  ...over,
});

test('P23: a benchmark says whether its task is not allowed, started, qualified or failed', async () => {
  const { benchmarkState } = await loadQualify();
  const all = ['specification', 'summarization'];
  assert.equal(
    benchmarkState([], 'm', 'scoring', all).kind,
    'not_allowed',
    'a task the connection does not allow is offered to allow, not refused',
  );
  assert.equal(
    benchmarkState([], 'gpt-6-astra', 'specification', all).kind,
    'new',
  );
  const pass = qualification({
    state: 'qualified',
    decided_at: '2026-11-11T10:05:00.000Z',
    held_out: { passed: 6, total: 6 },
  });
  assert.equal(
    benchmarkState([pass], 'gpt-6-astra', 'specification', all).kind,
    'qualified',
  );
  assert.equal(
    benchmarkState([pass], 'other-model', 'specification', all).kind,
    'new',
    'another model is not qualified by it',
  );
  // ADR-0052: the newest decided qualification counts, so a later failure replaces the pass.
  const fail = qualification({
    state: 'failed',
    created_at: '2026-11-11T11:00:00.000Z',
    decided_at: '2026-11-11T11:05:00.000Z',
  });
  assert.equal(
    benchmarkState([pass, fail], 'gpt-6-astra', 'specification', all).kind,
    'failed',
  );
  assert.equal(
    benchmarkState([pass, qualification()], 'gpt-6-astra', 'specification', all)
      .kind,
    'started',
    'an open qualification of the same model and task is run, not started twice',
  );
  // PR #173 review 4 L-B: web discovery and the locator are both research synthesis; each
  // benchmark shows only its own kind of result.
  const rs = ['research_synthesis'];
  const locate = qualification({
    task_class: 'research_synthesis',
    state: 'qualified',
    decided_at: '2026-11-11T10:05:00.000Z',
    admits_discovery: true,
  });
  const webFail = qualification({
    task_class: 'research_synthesis',
    state: 'failed',
    admits_web_discovery: true,
    created_at: '2026-11-11T11:00:00.000Z',
    decided_at: '2026-11-11T11:05:00.000Z',
  });
  assert.equal(
    benchmarkState(
      [locate],
      'gpt-6-astra',
      'research_synthesis',
      rs,
      'web_discovery',
    ).kind,
    'new',
    'a locate pass does not show the web benchmark as qualified',
  );
  assert.equal(
    benchmarkState(
      [locate, webFail],
      'gpt-6-astra',
      'research_synthesis',
      rs,
      'discovery',
    ).kind,
    'qualified',
    'a newer failed web run does not replace the locate result',
  );
  assert.equal(
    benchmarkState(
      [locate, webFail],
      'gpt-6-astra',
      'research_synthesis',
      rs,
      'web_discovery',
    ).kind,
    'failed',
  );
});

test('ADR-0084: a Run the server reports as executing shows as running, with every action locked', async () => {
  const { QualifyModel } = await loadQualify();
  const connection = {
    id: randomUUID(),
    kind: 'chatgpt_plan',
    version: 3,
    fixture: false,
    caps_accepted_at: '2026-11-11T09:00:00.000Z',
    settings: {
      allowed_data_classes: ['synthetic', 'public'],
      allowed_task_classes: ['specification'],
      caps: { responses: { request_timeout_ms: 120000 } },
    },
  };
  const html = (qualifications: PlanQualification[]) =>
    renderToStaticMarkup(
      createElement(QualifyModel, {
        base: 'workspaces/w',
        connection,
        models: ['gpt-6-astra'],
        qualifications,
        busy: false,
        act: async () => null,
      }),
    );
  // Freshly mounted (after leaving the page or switching workspaces): no press remembered here,
  // and the server says the loop is running.
  const running = html([qualification({ executing: true })]);
  assert.match(running, /Running…/);
  assert.match(running, /carries on if you leave this page/);
  assert.doesNotMatch(
    running,
    /<button[^>]*type="button"(?![^>]*disabled)[^>]*>Run/,
  );
  for (const b of running.matchAll(/<button([^>]*)>/g))
    assert.match(b[1]!, /disabled/, `every button is locked: ${b[0]}`);
  // Started but not executing: Run is offered.
  const idle = html([qualification({ executing: false })]);
  assert.doesNotMatch(idle, /Running…/);
  assert.match(idle, /<button type="button">Run \(up to/);
});

test('a run that stops says why; a finished run says the result (review M-1)', async () => {
  const { runOutcome } = await loadQualify();
  const q = { task_class: 'specification', model_id: 'gpt-6-astra' };
  const stopped = runOutcome(q, {
    state: 'stopped',
    reason: 'daily_cap_reached',
  });
  assert.match(
    stopped,
    /specification on gpt-6-astra stopped: daily cap reached/,
  );
  assert.match(stopped, /press Run to continue/);
  assert.match(
    runOutcome(q, {
      state: 'decided',
      qualification: {
        state: 'failed',
        reason: '5/6 held-out cases accepted.',
        held_out: { passed: 5, total: 6 },
      },
    }),
    /failed \(5 of 6 held-out cases passed\)\. 5\/6 held-out/,
  );
  // A failed request (null) leaves no outcome line: its error shows instead.
  assert.equal(runOutcome(q, null), '');
});

test('P24: Qualify several offers allowed tasks not yet qualified and sends their benchmarks in order', async () => {
  const { queueChoices, queueBody } = await loadQualify();
  const pass = qualification({
    task_class: 'summarization',
    state: 'qualified',
    decided_at: '2026-11-11T10:05:00.000Z',
  });
  const fail = qualification({
    task_class: 'specification',
    state: 'failed',
    decided_at: '2026-11-11T10:05:00.000Z',
  });
  const choices = queueChoices([pass, fail], 'gpt-6-astra', [
    'specification',
    'summarization',
    'independent_review',
  ]);
  const byTask = Object.fromEntries(
    choices.map((c) => [c.task_class, c.eligible]),
  );
  // Qualified: re-run on its own (a failed re-run replaces the pass, ADR-0052). Not allowed:
  // allow it first. Failed or new: offered.
  assert.equal(byTask.summarization, false);
  assert.equal(byTask.scoring, false);
  assert.equal(byTask.specification, true);
  assert.equal(byTask.independent_review, true);
  // Review of PR #176, L-3: a started re-run of a qualified task is still qualified, so it is
  // not offered (the server would refuse the whole queue).
  const rerun = qualification({
    task_class: 'summarization',
    created_at: '2026-11-11T11:00:00.000Z',
  });
  assert.equal(
    queueChoices([pass, rerun], 'gpt-6-astra', [
      'specification',
      'summarization',
    ]).find((c) => c.task_class === 'summarization')?.eligible,
    false,
  );
  const body = queueBody(
    7,
    'gpt-6-astra',
    choices.filter((c) => c.eligible),
  );
  assert.equal(body.expected_version, 7);
  assert.deepEqual(
    body.items.map((i) => i.manifest.task_class),
    ['specification', 'independent_review'],
  );
  for (const i of body.items) {
    const m = BenchmarkManifestSchema.parse(i.manifest);
    assert.equal(
      i.min_held_out_cases,
      m.cases.filter((c) => c.split === 'held_out').length,
      'the pass bar is every held-out case, as Start',
    );
    assert.deepEqual(i.floor, { numerator: 1, denominator: 1 });
  }
});

test('P24: a running queue shows its progress and locks every other qualify action', async () => {
  const { QualifyModel } = await loadQualify();
  const connection = {
    id: randomUUID(),
    kind: 'chatgpt_plan',
    version: 3,
    fixture: false,
    caps_accepted_at: '2026-11-11T09:00:00.000Z',
    settings: {
      allowed_data_classes: ['synthetic', 'public'],
      allowed_task_classes: ['specification', 'summarization'],
      caps: { responses: { request_timeout_ms: 120000 } },
    },
  };
  const item = (
    position: number,
    task_class: string,
    state: string,
    reason: string | null = null,
  ) => ({
    position,
    task_class,
    manifest_name: `${task_class}-synthetic-v1`,
    manifest_hash: 'b'.repeat(64),
    qualification_id: state === 'waiting' ? null : randomUUID(),
    state,
    reason,
  });
  const queue = (over: Record<string, unknown>) => ({
    id: randomUUID(),
    connection_id: connection.id,
    model_id: 'gpt-6-astra',
    state: 'running',
    reason: null,
    created_by: randomUUID(),
    created_at: '2026-11-11T10:00:00.000Z',
    finished_at: null,
    active: true,
    items: [
      item(0, 'specification', 'qualified', '8 of 8 held-out cases passed'),
      item(1, 'summarization', 'running'),
    ],
    ...over,
  });
  const html = (q: unknown, qualifications: PlanQualification[] = []) =>
    renderToStaticMarkup(
      createElement(QualifyModel, {
        base: 'workspaces/w',
        connection,
        models: ['gpt-6-astra'],
        qualifications,
        queue: q,
        requestsLeft: 19,
        busy: false,
        act: async () => null,
      }),
    );
  const idle = html(null);
  assert.match(idle, /Qualify several tasks/);
  assert.match(idle, /Qualify all \(2, up to/);
  assert.match(idle, /Not allowed on this connection, so not offered/);
  // Review N-4: what is left of the 24-hour cap is said before queueing.
  assert.match(idle, /19 plan requests left in this connection/);
  const running = html(queue({}), [
    qualification({ task_class: 'summarization', executing: true }),
  ]);
  assert.match(running, /one task after another: 1 of 2 done/);
  assert.match(
    running,
    /specification · specification-synthetic-v1: qualified/,
  );
  for (const b of running.matchAll(/<button([^>]*)>([^<]*)/g))
    if (b[2]!.startsWith('Cancel the queue'))
      assert.doesNotMatch(b[1]!, /disabled/, 'the queue can be cancelled');
    else
      assert.match(b[1]!, /disabled/, `locked while the queue runs: ${b[0]}`);
  // No process holds the lease (after a restart): say it waits for the studio.
  assert.match(
    html(queue({ active: false })),
    /Waiting for the studio to pick it up/,
  );
  const stopped = html(
    queue({
      state: 'stopped',
      reason:
        'Stopped: summarization did not qualify (5 of 8 held-out cases passed).',
      finished_at: '2026-11-11T10:30:00.000Z',
      items: [
        item(0, 'specification', 'qualified'),
        item(1, 'summarization', 'failed', '5 of 8 held-out cases passed'),
      ],
    }),
  );
  assert.match(stopped, /stopped\. Stopped: summarization did not qualify/);
  assert.match(stopped, /summarization-synthetic-v1: did not qualify/);
  // Review N-2: the stop reason the queue line gives is not repeated on the item.
  const refusedStop = html(
    queue({
      state: 'stopped',
      reason:
        'Stopped at summarization: This plan request is not admitted. Its answered cases are kept.',
      finished_at: '2026-11-11T10:30:00.000Z',
      items: [
        item(
          0,
          'summarization',
          'stopped',
          'summarization: This plan request is not admitted.',
        ),
      ],
    }),
  );
  assert.equal(refusedStop.split('not admitted').length - 1, 1);
  assert.match(stopped, />Hide</);
  assert.doesNotMatch(stopped, /Cancel the queue/);
});

test('P24 after P12: Qualify several reads each benchmark in its own research synthesis lane (review 3 L-1)', async () => {
  const { queueChoices } = await loadQualify();
  const allowed = ['research_synthesis'];
  const web = (qs: PlanQualification[]) =>
    queueChoices(qs, 'gpt-6-astra', allowed).find(
      (c) => c.name === 'web-discovery-v2',
    )?.eligible;
  const decided = {
    task_class: 'research_synthesis' as const,
    state: 'qualified' as const,
    decided_at: '2026-11-11T10:05:00.000Z',
  };
  // ADR-0086: a locator pass does not qualify web discovery, so web discovery is still offered.
  assert.equal(
    web([qualification({ ...decided, admits_web_discovery: false })]),
    true,
  );
  assert.equal(
    web([qualification({ ...decided, admits_web_discovery: true })]),
    false,
  );
});

test('P24: Qualify several says before it starts when the queue needs more than the daily cap (review 3 L-2)', async () => {
  const { QualifyModel } = await loadQualify();
  const html = (cap: number) =>
    renderToStaticMarkup(
      createElement(QualifyModel, {
        base: 'workspaces/w',
        connection: {
          id: randomUUID(),
          kind: 'chatgpt_plan',
          version: 3,
          fixture: false,
          caps_accepted_at: '2026-11-11T09:00:00.000Z',
          settings: {
            allowed_data_classes: ['synthetic', 'public'],
            allowed_task_classes: [
              'specification',
              'summarization',
              'patch_build',
              'independent_review',
              'scoring',
              'research_synthesis',
            ],
            caps: {
              responses: { request_timeout_ms: 120000 },
              shared: { max_model_requests_per_day: cap },
            },
          },
        },
        models: ['gpt-6-astra'],
        qualifications: [],
        queue: null,
        requestsLeft: cap,
        busy: false,
        act: async () => null,
      }),
    );
  // Six bundled benchmarks: 8 + 8 + 15 + 4 + 4 + 13 plan requests on a fresh connection.
  const fresh = html(40);
  assert.match(fresh, /Qualify all \(6, up to 52 plan requests\)/);
  assert.match(
    fresh,
    /Qualify all needs up to 52 plan requests, more than this connection&#x27;s cap of 40 in any 24 hours/,
  );
  assert.doesNotMatch(html(52), /more than this connection/);
});

test('ADR-0089: the discovery benchmarks are listed with their own allow, start and qualified states', async () => {
  const { QualifyModel, benchmarkState } = await loadQualify();
  const discovery = offeredDiscoveryBenchmarks().map(
    ({ manifest: _m, ...b }) => b,
  );
  const connection = (allowed: string[]) => ({
    id: randomUUID(),
    kind: 'chatgpt_plan',
    version: 3,
    fixture: false,
    caps_accepted_at: '2026-11-11T09:00:00.000Z',
    settings: {
      allowed_data_classes: ['synthetic', 'public'],
      allowed_task_classes: allowed,
      caps: { responses: { request_timeout_ms: 120000 } },
    },
  });
  const html = (allowed: string[], qualifications: PlanQualification[] = []) =>
    renderToStaticMarkup(
      createElement(QualifyModel, {
        base: 'workspaces/w',
        connection: connection(allowed),
        models: ['gpt-6-astra'],
        qualifications,
        busy: false,
        discovery,
        act: async () => null,
      }),
    );
  const some = html(['specification', 'research_synthesis']);
  assert.match(
    some,
    /research synthesis for discovery · plan-discovery-research14-v2-research_synthesis \(2 practice \+ 4 held out\)<\/option>/,
  );
  assert.match(
    some,
    /candidate generation for discovery · plan-discovery-semantics-v2-candidate_generation[^<]*not allowed on this connection yet/,
  );
  assert.match(
    some,
    /scoring for discovery · plan-discovery-semantics-v2-scoring/,
  );
  assert.match(some, /scoring for assessments · assessment-synthetic-v3/);
  // A started discovery qualification shows Run with that benchmark's request count.
  const started = html(
    ['research_synthesis'],
    [
      qualification({
        task_class: 'research_synthesis',
        manifest_hash: discovery[0]!.manifest_hash,
        // The server derives this from the stored manifest.
        admits_discovery: true,
      }),
    ],
  );
  assert.match(
    started,
    /research synthesis for discovery on gpt-6-astra is started/,
  );
  assert.match(started, /Run \(up to 6 plan requests/);
  assert.match(started, /research synthesis for discovery[^<]*· started/);

  // A scoring pass on the assessment benchmark is not a discovery pass, nor the reverse.
  const assessed = qualification({
    task_class: 'scoring',
    state: 'qualified',
    decided_at: '2026-11-11T10:05:00.000Z',
    admits_assessment: true,
    admits_discovery: false,
  });
  const all = ['scoring'];
  assert.equal(
    benchmarkState([assessed], 'gpt-6-astra', 'scoring', all, 'assessment')
      .kind,
    'qualified',
  );
  assert.equal(
    benchmarkState([assessed], 'gpt-6-astra', 'scoring', all, 'discovery').kind,
    'new',
  );
  const skeptic = qualification({
    task_class: 'scoring',
    state: 'qualified',
    decided_at: '2026-11-11T10:05:00.000Z',
    admits_assessment: false,
    admits_discovery: true,
  });
  assert.equal(
    benchmarkState([skeptic], 'gpt-6-astra', 'scoring', all, 'discovery').kind,
    'qualified',
  );
  assert.equal(
    benchmarkState([skeptic], 'gpt-6-astra', 'scoring', all, 'assessment').kind,
    'new',
  );
});

test("PR #175 review L-1 and M-2: another role running is named, and no role borrows another role's pass", async () => {
  const { benchmarkState, QualifyModel } = await loadQualify();
  const { forRole, manifestRole } = await loadRole();
  const all = ['scoring', 'research_synthesis'];
  const assessRunning = qualification({
    task_class: 'scoring',
    admits_assessment: true,
    admits_discovery: false,
  });
  const discoveryRunning = qualification({
    task_class: 'scoring',
    admits_assessment: false,
    admits_discovery: true,
  });
  assert.equal(
    benchmarkState([assessRunning], 'gpt-6-astra', 'scoring', all, 'discovery')
      .kind,
    'other_running',
  );
  assert.equal(
    benchmarkState([assessRunning], 'gpt-6-astra', 'scoring', all, 'assessment')
      .kind,
    'started',
  );
  assert.equal(
    benchmarkState(
      [discoveryRunning],
      'gpt-6-astra',
      'scoring',
      all,
      'assessment',
    ).kind,
    'other_running',
  );
  assert.equal(
    benchmarkState(
      [discoveryRunning],
      'gpt-6-astra',
      'scoring',
      all,
      'discovery',
    ).kind,
    'started',
  );
  // The page says which one is running and offers no Start.
  const discovery = offeredDiscoveryBenchmarks().map(
    ({ manifest: _m, ...b }) => b,
  );
  const page = renderToStaticMarkup(
    createElement(QualifyModel, {
      base: 'workspaces/w',
      connection: {
        id: randomUUID(),
        kind: 'chatgpt_plan',
        version: 3,
        fixture: false,
        caps_accepted_at: '2026-11-11T09:00:00.000Z',
        settings: {
          allowed_data_classes: ['synthetic', 'public'],
          allowed_task_classes: all,
          caps: { responses: { request_timeout_ms: 120000 } },
        },
      },
      models: ['gpt-6-astra'],
      qualifications: [assessRunning],
      busy: false,
      discovery,
      act: async () => null,
    }),
  );
  assert.match(page, /scoring for discovery[^<]*another role is running/);
  assert.match(page, /scoring for assessments on gpt-6-astra is started/);

  // M-2: a web-discovery pass (P12's flag) and a locator pass never stand in for each other,
  // and an untagged benchmark never borrows either.
  const passed = (flags: object) =>
    qualification({
      task_class: 'research_synthesis',
      state: 'qualified',
      decided_at: '2026-11-11T10:05:00.000Z',
      ...flags,
    });
  const web = passed({ admits_web_discovery: true });
  const locate = passed({ admits_discovery: true });
  const state = (qs: PlanQualification[], admits: string | null) =>
    benchmarkState(
      qs,
      'gpt-6-astra',
      'research_synthesis',
      all,
      admits as never,
    ).kind;
  assert.equal(state([web], 'discovery'), 'new');
  assert.equal(state([web], 'web_discovery'), 'qualified');
  assert.equal(state([locate], 'web_discovery'), 'new');
  assert.equal(state([locate], 'discovery'), 'qualified');
  assert.equal(state([web, locate], null), 'new');
  assert.equal(forRole([web, locate], 'web_discovery').length, 1);
  // A bundled benchmark's role comes from its checks.
  assert.equal(
    manifestRole(
      JSON.parse(
        await readFile(
          'config/connections/benchmarks/assessment-synthetic-v3.json',
          'utf8',
        ),
      ),
    ),
    'assessment',
  );
  assert.equal(
    manifestRole({
      cases: [
        { check: { kind: 'web_scout_contract' } },
        { check: { kind: 'web_reader_contract' } },
      ],
    }),
    'web_discovery',
  );
  assert.equal(
    manifestRole(
      JSON.parse(
        await readFile(
          'config/connections/benchmarks/specification-synthetic-v1.json',
          'utf8',
        ),
      ),
    ),
    null,
  );
});

test('PR #175 review M-1: a discovery pass keeps counting after a failed assessment scoring run', async () => {
  const { rowLatest } = await loadRole();
  const pass = qualification({
    task_class: 'scoring',
    state: 'qualified',
    decided_at: '2026-11-11T10:05:00.000Z',
    admits_discovery: true,
    prompt_current: true,
  });
  const fail = qualification({
    task_class: 'scoring',
    state: 'failed',
    created_at: '2026-11-11T11:00:00.000Z',
    decided_at: '2026-11-11T11:05:00.000Z',
    admits_assessment: true,
    prompt_current: true,
  });
  // The newer assessment failure decides the assessment row only.
  assert.equal(rowLatest([pass, fail], pass)?.id, pass.id);
  assert.equal(rowLatest([pass, fail], fail)?.id, fail.id);
  // A newer failure of the same role does withdraw it.
  const failDiscovery = {
    ...fail,
    id: randomUUID(),
    admits_assessment: undefined,
    admits_discovery: true,
  };
  assert.equal(rowLatest([pass, failDiscovery], pass)?.state, 'failed');
  // A decided run under an older prompt never decides a current row.
  const stale = { ...failDiscovery, id: randomUUID(), prompt_current: false };
  assert.equal(rowLatest([pass, stale], pass)?.id, pass.id);
  // The Qualified tasks list uses exactly this helper (review N-B: no copied expression).
  const models = await readFile('apps/web/src/models.tsx', 'utf8');
  assert.match(models, /rowLatest\(detail\.qualifications, q\)/);
});

test('PR #175 re-review N-C: a qualification no role admits because of its prompt says so', async () => {
  const { qualificationTask } = await loadRole();
  assert.equal(
    qualificationTask({ task_class: 'scoring', admits_discovery: true }),
    'scoring for discovery',
  );
  assert.equal(
    qualificationTask({ task_class: 'scoring', prompt_current: false }),
    'scoring (older prompt)',
  );
  assert.equal(
    qualificationTask({ task_class: 'specification', prompt_current: true }),
    'specification',
  );
  const qualify = await readFile('apps/web/src/qualify.tsx', 'utf8');
  assert.match(qualify, /qualificationTask\(/);
});

test('PR #175 re-review L-A: a start of one role never runs a running qualification of another', async () => {
  const { runningFor } = await loadRole();
  const assess = qualification({
    task_class: 'scoring',
    admits_assessment: true,
  });
  const skeptic = qualification({
    task_class: 'scoring',
    admits_discovery: true,
  });
  assert.equal(
    runningFor([], 'gpt-6-astra', 'scoring', 'assessment').kind,
    'free',
  );
  assert.equal(
    runningFor(
      [{ ...skeptic, state: 'qualified' }],
      'gpt-6-astra',
      'scoring',
      'assessment',
    ).kind,
    'free',
  );
  const started = runningFor([assess], 'gpt-6-astra', 'scoring', 'assessment');
  assert.equal(started.kind, 'started');
  assert.equal(started.qualification?.id, assess.id);
  const other = runningFor([skeptic], 'gpt-6-astra', 'scoring', 'assessment');
  assert.equal(other.kind, 'other_running');
  assert.equal(other.qualification?.id, skeptic.id);
  assert.equal(
    runningFor([skeptic], 'other-model', 'scoring', 'assessment').kind,
    'free',
  );
});

test('P24 with P34: Qualify several offers the discovery benchmarks by name, per role, and not while another role runs', async () => {
  const { queueChoices, queueBody, offers } = await loadQualify();
  const discovery = offeredDiscoveryBenchmarks().map(
    ({ manifest: _m, ...b }) => b,
  );
  const list = offers(discovery);
  const allowed = ['scoring', 'research_synthesis', 'candidate_generation'];
  const choices = (qs: PlanQualification[]) =>
    queueChoices(qs, 'gpt-6-astra', allowed, list);
  const byName = (qs: PlanQualification[]) =>
    Object.fromEntries(choices(qs).map((c) => [c.name, c]));
  const skeptic = discovery.find((b) => b.task_class === 'scoring')!.name;
  const fresh = byName([]);
  for (const b of discovery) assert.equal(fresh[b.name]?.eligible, true);
  // Qualify all on a fresh connection: the six bundled benchmarks (52 plan requests) and the
  // three discovery ones (2 + 4 cases each) come to 70, above the default 40 in any 24 hours.
  assert.equal(
    queueChoices(
      [],
      'gpt-6-astra',
      [
        ...allowed,
        'specification',
        'summarization',
        'patch_build',
        'independent_review',
      ],
      list,
    ).reduce((n, c) => n + (c as unknown as { requests: number }).requests, 0),
    70,
  );
  assert.equal(fresh['assessment-synthetic-v3']?.eligible, true);
  // A discovery benchmark is queued by name; the server loads its manifest.
  assert.deepEqual(queueBody(1, 'gpt-6-astra', [fresh[skeptic]!]).items, [
    { benchmark: skeptic },
  ]);
  // An assessment pass does not qualify the discovery skeptic, and the reverse.
  const pass = {
    task_class: 'scoring' as const,
    state: 'qualified' as const,
    decided_at: '2026-11-11T10:05:00.000Z',
  };
  const assessed = byName([
    qualification({ ...pass, admits_assessment: true }),
  ]);
  assert.equal(assessed['assessment-synthetic-v3']?.eligible, false);
  assert.equal(assessed[skeptic]?.eligible, true);
  const skeptical = byName([
    qualification({ ...pass, admits_discovery: true }),
  ]);
  assert.equal(skeptical['assessment-synthetic-v3']?.eligible, true);
  assert.equal(skeptical[skeptic]?.eligible, false);
  // A started skeptic run blocks the assessor (one run per model and task class): not offered.
  const running = byName([
    qualification({ task_class: 'scoring', admits_discovery: true }),
  ]);
  assert.equal(running['assessment-synthetic-v3']?.state.kind, 'other_running');
  assert.equal(running['assessment-synthetic-v3']?.eligible, false);
  assert.equal(
    running[skeptic]?.eligible,
    true,
    'the started one is taken over',
  );
});

test('P24 review 5 N-3: with nothing else to queue, the section still says why a task waits for another role', async () => {
  const { QualifyModel } = await loadQualify();
  const page = renderToStaticMarkup(
    createElement(QualifyModel, {
      base: 'workspaces/w',
      connection: {
        id: randomUUID(),
        kind: 'chatgpt_plan',
        version: 3,
        fixture: false,
        caps_accepted_at: '2026-11-11T09:00:00.000Z',
        settings: {
          allowed_data_classes: ['synthetic', 'public'],
          allowed_task_classes: ['scoring'],
          caps: { responses: { request_timeout_ms: 120000 } },
        },
      },
      models: ['gpt-6-astra'],
      // A discovery-skeptic run is started; the assessor is the only bundled scoring choice.
      qualifications: [
        qualification({ task_class: 'scoring', admits_discovery: true }),
      ],
      discovery: [],
      queue: null,
      busy: false,
      act: async () => null,
    }),
  );
  assert.match(
    page,
    /no task left to qualify here[^<]*scoring for assessments waits while another role of the same task is started/,
  );
});
