import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  ProductSupervisor,
  ExecutionSupervisor,
  BuildSupervisor,
  RoundDraft,
  PatchRefusedError,
  buildPlanSchema,
  digest,
  gradePatchCase,
  readBuildProgress,
  type Binding,
  type BuildPlan,
  type BuildPorts,
  type PlanRoleResult,
} from '@creator/executor';
import { TestDoubleExecutor } from './artifact-double.js';
import {
  BUILD_ROLE_PROMPTS,
  BUILD_FIXTURE_SPEC,
  BUILD_FIXTURE_CASES,
  BUILD_FIXTURE_SOURCE,
  LEGACY_BUILDER_PROMPT,
  buildFixtureAnswer,
  taskHashes,
} from '@creator/domain';
import {
  BUILD_APPROVAL_MAX_REPAIRS,
  BUILD_APPROVAL_MAX_REQUESTS,
  MAX_BUILD_CASES,
  buildDeadlineMs,
  type SpecBody,
} from '@creator/contracts';

/**
 * ADR-0109 (B4): builder/2 rounds in parts and edits, the raised per-build caps, and the build
 * time limit. Builds here use the plan-role route with a test-double executor, so QA runs no
 * program; the opt-in WSL2 gates cover real execution.
 */
const gitOut = (dir: string, args: string[]) =>
  execFileSync('git', ['-C', dir, ...args], { encoding: 'utf8' }).trim();
const head = async (dir: string) => gitOut(dir, ['rev-parse', 'HEAD']);

async function setup(t: test.TestContext) {
  const parent = resolve('.verification/build-parts-tests');
  await mkdir(parent, { recursive: true });
  const root = await mkdtemp(join(parent, 'case-'));
  t.after(async () => {
    assert.ok(root.startsWith(parent));
    await rm(root, { recursive: true, force: true });
  });
  const spec: SpecBody = {
    ...structuredClone(BUILD_FIXTURE_SPEC),
    format: 'spec/1',
    alternative: { id: randomUUID(), version: 1 },
    selection_id: randomUUID(),
  };
  const binding: Binding = {
    workspace_id: randomUUID(),
    owner_id: randomUUID(),
    spec_id: randomUUID(),
    spec_version: 1,
    spec_hash: digest('spec'),
    freeze_id: randomUUID(),
    tasks: [{ key: 'T1', hash: taskHashes(spec).T1!, file_scope: ['src'] }],
  };
  const products = new ProductSupervisor(join(root, 'products'));
  const product = await products.create(binding);
  const task = await products.createTask(
    product.id,
    'T1',
    product.initial_commit,
    binding,
  );
  const builds = new BuildSupervisor(
    products,
    new TestDoubleExecutor(products),
  );
  const plan: BuildPlan = {
    format: 'build-plan/1',
    run_id: randomUUID(),
    envelope_id: randomUUID(),
    pricing_snapshot_id: randomUUID(),
    humility_review: { id: randomUUID(), version: 1 },
    data_class: 'synthetic',
    max_repairs: 0,
    max_calls: 4,
    timeout_ms: 120000,
    max_output_tokens: 3000,
    deadline: new Date(Date.now() + 300000).toISOString(),
    cases: structuredClone(BUILD_FIXTURE_CASES),
    plan_roles: { connection_id: randomUUID(), model_id: 'fixture-plan' },
  };
  const packets: { role: string; packet: Record<string, any> }[] = [];
  /** The builder's answer for each builder request in turn (the fixture answers the reviewer). */
  let builder: (packet: Record<string, any>, n: number) => unknown = () => {
    throw new Error('no builder script');
  };
  const ok = (text: string): PlanRoleResult => ({
    request_id: randomUUID(),
    status: 'succeeded',
    reason_code: 'ok',
    text,
    fixture: true,
  });
  const ports: BuildPorts = {
    current: async () => ({ binding, spec }),
    assertActive: async () => {},
    authorize: async () => ({ verdict: 'allow', fixture: true }),
    call: async () => {
      throw new Error('plan-role builds never use the broker');
    },
    planRolesReady: async () => [],
    planRole: async (target, request) => {
      const packet = JSON.parse(request.input) as Record<string, any>;
      packets.push({ role: target.role, packet });
      if (target.role === 'reviewer')
        return ok(
          buildFixtureAnswer([
            { role: 'system', text: BUILD_ROLE_PROMPTS.reviewer },
            { role: 'user', text: request.input },
          ])!,
        );
      const n = packets.filter((p) => p.role === 'builder').length;
      return ok(JSON.stringify(builder(packet, n)));
    },
  };
  const tree = products.worktree(product.id, task.id);
  const main = await readFile(join(tree, 'src/main.py'), 'utf8');
  return {
    products,
    product,
    task,
    builds,
    plan,
    ports,
    packets,
    tree,
    main,
    script: (fn: typeof builder) => {
      builder = fn;
    },
    run: (over: Partial<BuildPlan> = {}, extra: Partial<BuildPorts> = {}) =>
      builds.run(
        product.id,
        task.id,
        product.initial_commit,
        { ...plan, ...over },
        { ...ports, ...extra },
      ),
    dir: (buildId: string) => join(products.dir(product.id), 'builds', buildId),
  };
}

const answer = (
  packet: Record<string, any>,
  changes: unknown[],
  complete?: boolean,
) => ({
  summary: 'part',
  submission: {
    expected_commit: packet.candidate,
    changes,
    ...(complete === undefined ? {} : { complete }),
  },
  blocker: null,
});
const hashOf = (packet: Record<string, any>, path: string) =>
  (packet.files as { path: string; hash: string }[]).find(
    (f) => f.path === path,
  )!.hash;

test('a round in parts is applied as one commit after its last part, then reviewed once', async (t) => {
  const s = await setup(t);
  s.script((p, n) => {
    if (n === 1)
      return answer(
        p,
        [
          {
            path: 'src/util.py',
            before_hash: null,
            content: 'STEPS = 1\n',
          },
        ],
        false,
      );
    if (n === 2)
      return answer(
        p,
        [
          // Edits an existing file, and edits the file part 1 wrote (its staged content).
          {
            path: 'src/main.py',
            before_hash: hashOf(p, 'src/main.py'),
            content: BUILD_FIXTURE_SOURCE,
          },
          {
            path: 'src/util.py',
            before_hash: null,
            edits: [{ find: 'STEPS = 1', replace: 'STEPS = 4' }],
          },
        ],
        false,
      );
    return answer(p, [
      {
        path: 'src/util.py',
        before_hash: null,
        edits: [{ find: 'STEPS = 4', replace: 'STEPS = 4  # four steps' }],
      },
    ]);
  });
  const result = await s.run({ max_calls: 4 });
  assert.equal(result.state, 'verified_candidate', result.reason);
  assert.equal(result.calls, 4);
  assert.deepEqual(
    s.packets.map((p) => p.role),
    ['builder', 'builder', 'builder', 'reviewer'],
  );
  const builders = s.packets.filter((p) => p.role === 'builder');
  // Every part sees the same candidate and committed files; nothing was applied in between.
  for (const b of builders) {
    assert.equal(b.packet.candidate, s.product.initial_commit);
    assert.ok(Array.isArray(b.packet.answer_rules));
  }
  assert.deepEqual(
    builders.map((b) => [
      b.packet.round.part,
      b.packet.round.further_parts_allowed,
    ]),
    [
      [1, 2],
      [2, 1],
      [3, 0],
    ],
  );
  assert.deepEqual(builders[1]!.packet.round.staged, [
    {
      path: 'src/util.py',
      hash: digest('STEPS = 1\n'),
      content: 'STEPS = 1\n',
    },
  ]);
  assert.deepEqual(
    builders[2]!.packet.round.staged.map((f: { path: string }) => f.path),
    ['src/util.py', 'src/main.py'],
  );
  // One commit on the base, holding every part.
  assert.equal(
    gitOut(s.tree, ['rev-list', '--count', 'HEAD']),
    '2',
    'template commit plus one round commit',
  );
  assert.equal(
    await readFile(join(s.tree, 'src/util.py'), 'utf8'),
    'STEPS = 4  # four steps\n',
  );
  assert.equal(
    await readFile(join(s.tree, 'src/main.py'), 'utf8'),
    BUILD_FIXTURE_SOURCE,
  );
  // The build folder names each call's round and part, and the Build page counts the parts.
  const dir = s.dir(result.id);
  const intents = await Promise.all(
    [1, 2, 3, 4].map(async (n) =>
      JSON.parse(await readFile(join(dir, `call-${n}-intent.json`), 'utf8')),
    ),
  );
  assert.deepEqual(
    intents.map((i) => [i.role, i.round, i.part]),
    [
      ['builder', 0, 1],
      ['builder', 0, 2],
      ['builder', 0, 3],
      ['reviewer', 0, undefined],
    ],
  );
  const files = await readdir(dir);
  for (const f of ['part-0-1.json', 'part-0-2.json', 'part-0-3.json'])
    assert.ok(files.includes(f), f);
  const progress = await readBuildProgress({
    dir,
    heldOut: [false, true],
    running: false,
  });
  assert.equal(progress.rounds.length, 1);
  assert.equal(progress.rounds[0]!.parts, 3);
  assert.equal(progress.rounds[0]!.builder, 'answered');
  assert.equal(progress.rounds[0]!.reviewer, 'answered');
  assert.deepEqual(progress.rounds[0]!.candidate?.files.sort(), [
    'src/main.py',
    'src/util.py',
  ]);
});

test('a build stopped mid-round applies none of its parts', async (t) => {
  const s = await setup(t);
  s.script((p, n) => {
    if (n === 1)
      return answer(
        p,
        [{ path: 'src/util.py', before_hash: null, content: 'x = 1\n' }],
        false,
      );
    throw new Error('connection lost');
  });
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /connection lost/);
  assert.equal(result.commit, s.product.initial_commit);
  assert.equal(await head(s.tree), s.product.initial_commit);
  await assert.rejects(readFile(join(s.tree, 'src/util.py'), 'utf8'));
  const files = await readdir(s.dir(result.id));
  assert.ok(files.includes('part-0-1.json'));
  assert.ok(!files.some((f) => f.startsWith('candidate-')));
});

test('an edit against the wrong base is refused as repair feedback, never applied', async (t) => {
  const s = await setup(t);
  s.script((p, n) => {
    if (n === 1)
      return answer(p, [
        {
          path: 'src/main.py',
          before_hash: hashOf(p, 'src/main.py'),
          edits: [{ find: 'print("not in the file")', replace: 'pass' }],
        },
      ]);
    return answer(p, [
      {
        path: 'src/main.py',
        before_hash: hashOf(p, 'src/main.py'),
        content: BUILD_FIXTURE_SOURCE,
      },
    ]);
  });
  const result = await s.run({ max_repairs: 1, max_calls: 4 });
  assert.equal(result.state, 'verified_candidate', result.reason);
  assert.equal(result.repairs, 1);
  const builders = s.packets.filter((p) => p.role === 'builder');
  assert.equal(builders.length, 2);
  assert.match(
    builders[1]!.packet.feedback.refused_patch.reason,
    /Edit 1 of src\/main\.py does not apply: its find text occurs 0 times/,
  );
  // An edit whose before_hash is not the file's is stale, like a whole-file change.
  const draft = new RoundDraft([
    {
      path: 'src/a.py',
      hash: digest('a = 1\na = 1\n'),
      content: 'a = 1\na = 1\n',
    },
  ]);
  assert.throws(
    () =>
      draft.add([
        {
          path: 'src/a.py',
          before_hash: digest('other'),
          edits: [{ find: 'a', replace: 'b' }],
        },
      ]),
    (e: unknown) => e instanceof PatchRefusedError && /Stale/.test(String(e)),
  );
  // Ambiguous: the find text occurs twice.
  assert.throws(
    () =>
      draft.add([
        {
          path: 'src/a.py',
          before_hash: digest('a = 1\na = 1\n'),
          edits: [{ find: 'a = 1', replace: 'a = 2' }],
        },
      ]),
    /occurs 2 times/,
  );
  // Edits need a file to edit.
  assert.throws(
    () =>
      draft.add([
        {
          path: 'src/b.py',
          before_hash: null,
          edits: [{ find: 'x', replace: 'y' }],
        },
      ]),
    /Edits need an existing file/,
  );
  // A refused part leaves the draft as it was; a file new in the round and deleted again is gone.
  assert.equal(draft.parts, 0);
  assert.deepEqual(draft.view(), []);
  draft.add([{ path: 'src/c.py', before_hash: null, content: 'c' }]);
  draft.add([{ path: 'src/c.py', before_hash: null, content: null }]);
  assert.deepEqual(draft.changes(), []);
  assert.equal(draft.parts, 2);
});

test('a builder that asks for another part with no request left has its round refused', async (t) => {
  const s = await setup(t);
  s.script((p) =>
    answer(
      p,
      [{ path: 'src/util.py', before_hash: null, content: 'x = 1\n' }],
      false,
    ),
  );
  // Two requests: one builder part and the reviewer, so no further part is allowed.
  const result = await s.run({ max_calls: 2 });
  assert.equal(result.state, 'checkpoint');
  assert.match(
    result.reason,
    /Repair limit reached; the last patch was refused: The builder asked for another part, but no request is left/,
  );
  assert.equal(s.packets[0]!.packet.round.further_parts_allowed, 0);
  assert.equal(s.packets.length, 1);
  assert.equal(await head(s.tree), s.product.initial_commit);
});

test('a frozen study build keeps the builder/1 prompt, packet and one-part answer', async (t) => {
  const s = await setup(t);
  const seen: string[] = [];
  s.script((p) => {
    seen.push(JSON.stringify(p));
    return answer(p, [
      {
        path: 'src/main.py',
        before_hash: hashOf(p, 'src/main.py'),
        edits: [{ find: 'import json', replace: 'import json  # x' }],
      },
    ]);
  });
  const prompts: string[] = [];
  const result = await s.run(
    {},
    {
      legacyBuilder: true,
      planRole: async (target, request) => {
        prompts.push(target.role);
        return s.ports.planRole!(target, request);
      },
    },
  );
  // builder/1 has no edits: the answer does not satisfy its patch contract.
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /patch contract/);
  const packet = JSON.parse(seen[0]!) as Record<string, unknown>;
  assert.ok(!('answer_rules' in packet) && !('round' in packet));
  const intent = JSON.parse(
    await readFile(join(s.dir(result.id), 'intent.json'), 'utf8'),
  ) as { prompts: { builder: string } };
  assert.equal(intent.prompts.builder, LEGACY_BUILDER_PROMPT);
  const call = JSON.parse(
    await readFile(join(s.dir(result.id), 'call-1-intent.json'), 'utf8'),
  ) as { instructions: string };
  assert.equal(call.instructions, LEGACY_BUILDER_PROMPT);
  assert.ok(BUILD_ROLE_PROMPTS.builder.startsWith('builder/2:'));
});

test('per-build caps are 30 cases, 5 repair rounds and 20 requests, and the time limit counts them', () => {
  const base = {
    format: 'build-plan/1',
    run_id: randomUUID(),
    envelope_id: randomUUID(),
    pricing_snapshot_id: randomUUID(),
    humility_review: { id: randomUUID(), version: 1 },
    data_class: 'synthetic',
    timeout_ms: 120000,
    max_output_tokens: 3000,
    deadline: new Date().toISOString(),
  };
  const cases = (n: number) =>
    Array.from({ length: n }, () => structuredClone(BUILD_FIXTURE_CASES[0]!));
  const ok = (max_repairs: number, max_calls: number, n: number) =>
    buildPlanSchema.safeParse({
      ...base,
      max_repairs,
      max_calls,
      cases: cases(n),
    }).success;
  assert.equal(MAX_BUILD_CASES, 30);
  assert.equal(BUILD_APPROVAL_MAX_REPAIRS, 5);
  assert.equal(BUILD_APPROVAL_MAX_REQUESTS, 20);
  assert.ok(ok(5, 20, 30));
  assert.ok(!ok(6, 20, 30));
  assert.ok(!ok(5, 21, 30));
  assert.ok(!ok(5, 20, 31));
  // Without stated work the old limits stand; with it, every case of every round and every
  // request counts, plus 10 minutes, capped below the approval's 24 hours.
  assert.equal(buildDeadlineMs(0, 1), 30 * 60_000);
  assert.equal(
    buildDeadlineMs(0, 5, {
      requests: 20,
      cases: 30,
      recipe: 'python-build/1',
    }),
    20 * 120_000 + 6 * 30 * 40_000 + 10 * 60_000,
  );
  assert.equal(
    buildDeadlineMs(0, 0, { requests: 2, cases: 3, recipe: 'static-web/1' }),
    30 * 60_000,
    'never under 30 minutes',
  );
});

test('the builder qualification grader takes a one-part builder/2 answer and refuses parts', async (t) => {
  const s = await setup(t);
  const check = {
    kind: 'patch_cases' as const,
    file_scope: ['src'],
    cases: structuredClone(BUILD_FIXTURE_CASES).slice(0, 1),
  };
  const grade = (a: unknown) =>
    gradePatchCase(
      { products: s.products, executor: new ExecutionSupervisor(s.products) },
      randomUUID(),
      check,
      JSON.stringify(a),
    );
  const sub = (changes: unknown[], complete?: boolean) => ({
    summary: 's',
    submission: {
      expected_commit: '0'.repeat(40),
      changes,
      ...(complete === undefined ? {} : { complete }),
    },
    blocker: null,
  });
  const parts = await grade(
    sub([{ path: 'src/x.py', before_hash: null, content: 'x' }], false),
  );
  assert.equal(parts.signal, 'acceptance_check_failed');
  assert.match(parts.detail!, /one part only/);
  // Edits apply to the template's files; one that does not apply is a refused change.
  const wrong = await grade(
    sub([
      {
        path: 'src/main.py',
        before_hash: digest(s.main),
        edits: [{ find: 'not in the template', replace: 'x' }],
      },
    ]),
  );
  assert.equal(wrong.signal, 'acceptance_check_failed');
  assert.match(
    wrong.detail!,
    /did not apply \(src\/main\.py\).*occurs 0 times/,
  );
  // A valid edit gets past the patch to the cases (which fail closed without the WSL2 worker).
  const edited = await grade(
    sub([
      {
        path: 'src/main.py',
        before_hash: digest(s.main),
        edits: [
          {
            find: s.main.split('\n')[0]!,
            replace: s.main.split('\n')[0]! + ' ',
          },
        ],
      },
    ]),
  );
  assert.doesNotMatch(edited.detail ?? '', /did not apply/);
});
