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
  const offered = await Promise.all(
    files.map(
      async (f) =>
        (JSON.parse(await readFile(f, 'utf8')) as { task_class: string })
          .task_class,
    ),
  );
  // ADR-0089 (P34): plus the discovery benchmarks the server offers.
  const discovery = offeredDiscoveryBenchmarks().map((b) => b.task_class);
  assert.deepEqual(inApp, [...new Set([...offered, ...discovery])].sort());
});

// qualify.tsx with its sibling import stubbed; the benchmark files and React load for real.
async function loadQualify() {
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
      admits?: 'assessment' | 'discovery' | null,
    ) => { kind: string };
    QualifyModel: (props: Record<string, unknown>) => unknown;
  };
  new Function('require', 'exports', code)(
    (name: string) =>
      name === './oversight.js'
        ? { words: (s: string) => s.replaceAll('_', ' '), api: async () => {} }
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
  assert.match(some, /scoring for assessments · assessment-synthetic-v1/);
  // A started discovery qualification shows Run with that benchmark's request count.
  const started = html(
    ['research_synthesis'],
    [
      qualification({
        task_class: 'research_synthesis',
        manifest_hash: discovery[0]!.manifest_hash,
      }),
    ],
  );
  assert.match(started, /research synthesis on gpt-6-astra is started/);
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
