import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import ts from 'typescript';
import {
  BenchmarkManifestSchema,
  PLAN_RESPONSES_TASK_CLASSES,
} from '@creator/contracts';
import { BUILD_ROLE_PROMPTS, BUILD_ROLE_TASK_CLASSES } from '@creator/domain';

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
  };
  new Function('require', 'exports', code)(
    (name: string) =>
      name === './oversight.js'
        ? { words: (s: string) => s.replaceAll('_', ' ') }
        : require(name),
    exports,
  );
  return exports;
}

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
