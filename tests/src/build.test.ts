import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, rm, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  ProductSupervisor,
  ExecutionSupervisor,
  BuildSupervisor,
  digest,
  type Binding,
  type BuildPlan,
  type BuildPorts,
} from '@creator/executor';
import {
  BUILD_FIXTURE_SPEC,
  BUILD_FIXTURE_CASES,
  BUILD_FIXTURE_SOURCE,
  buildFixtureAnswer,
  frozenCases,
  taskHashes,
} from '@creator/domain';
import type {
  SpecBody,
  BrokerCallRequest,
  BrokerCallResult,
} from '@creator/contracts';

async function setup(t: test.TestContext) {
  const parent = resolve('.verification/build-tests');
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
  const executor = new ExecutionSupervisor(products);
  const builds = new BuildSupervisor(products, executor);
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
    max_output_tokens: 3000,
    deadline: new Date(Date.now() + 300000).toISOString(),
    cases: structuredClone(BUILD_FIXTURE_CASES),
  };
  const requests: BrokerCallRequest[] = [];
  let script = (r: BrokerCallRequest) =>
    JSON.parse(buildFixtureAnswer(r.input)!);
  let active = true;
  const ports: BuildPorts = {
    current: async () => ({ binding, spec }),
    assertActive: async () => {
      if (!active) throw new Error('run cancelled');
    },
    authorize: async () => ({ verdict: 'allow', fixture: true }),
    call: async (_run, r) => {
      requests.push(r);
      const json: unknown = script(r);
      return {
        status: 'succeeded',
        reason_code: 'fixture',
        explanation: 'Test-only port; real broker tested separately',
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
    root,
    products,
    product,
    task,
    binding,
    spec,
    builds,
    executor,
    plan,
    ports,
    requests,
    script: (fn: typeof script) => {
      script = fn;
    },
    cancel: () => {
      active = false;
    },
    run: () =>
      builds.run(product.id, task.id, product.initial_commit, plan, ports),
  };
}

test('builder rejects missing acceptance coverage, stale task hashes and cancelled runs before calls', async (t) => {
  const s = await setup(t);
  s.plan.cases.pop();
  await assert.rejects(s.run(), /cases frozen in the spec/);
  // A build cannot swap in weaker cases of its own: the frozen ones are bound by the task hash.
  s.plan.cases = structuredClone(BUILD_FIXTURE_CASES);
  s.plan.cases[1]!.stdout = 'anything\n';
  await assert.rejects(s.run(), /cases frozen in the spec/);
  s.plan.cases = structuredClone(BUILD_FIXTURE_CASES);
  s.spec.tasks[0]!.deliverable = 'Changed';
  await assert.rejects(s.run(), /hash mismatch/);
  s.cancel();
  await assert.rejects(s.run(), /cancelled/);
  assert.equal(s.requests.length, 0);
});

test('unsupported builder success claims never become verification or execute code', async (t) => {
  const s = await setup(t);
  s.script(() => ({
    summary: 'All tests passed!',
    submission: null,
    blocker: null,
  }));
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /no submitted patch/);
  assert.equal((await s.executor.executions(s.product.id)).length, 0);
  assert.equal(s.requests.length, 1);
});

test('admission refusal and expired deadlines dispatch no models', async (t) => {
  const s = await setup(t);
  s.ports.authorize = async () => {
    throw new Error('admission denied');
  };
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /admission denied/);
  assert.equal(s.requests.length, 0);
  s.plan.deadline = new Date(Date.now() - 1000).toISOString();
  await assert.rejects(s.run(), /deadline/);
  assert.equal(s.requests.length, 0);
});

test('concurrent builds are refused; cancellation after a role result preserves its trace without applying it', async (t) => {
  const s = await setup(t);
  const original = s.ports.call;
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  s.ports.call = async (run, r) => {
    entered();
    await held;
    return original(run, r);
  };
  const running = s.run();
  await started;
  await assert.rejects(s.run(), /locked/);
  s.cancel();
  release();
  const result = await running;
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /cancelled/);
  assert.equal(result.commit, s.product.initial_commit);
  assert.equal(s.requests.length, 1);
  const trace = JSON.parse(
    await readFile(
      join(
        s.products.dir(s.product.id),
        'builds',
        result.id,
        'call-1-outcome.json',
      ),
      'utf8',
    ),
  );
  assert.equal(trace.status, 'succeeded');
});

test('scoped tools reject builder policy edits and retain the original code', async (t) => {
  const s = await setup(t);
  s.script(() => ({
    summary: 'success',
    blocker: null,
    submission: {
      expected_commit: s.product.initial_commit,
      changes: [
        { path: 'readme.md', before_hash: null, content: 'scope expansion' },
      ],
    },
  }));
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /scope exceeded/);
  assert.equal(result.commit, s.product.initial_commit);
});

test('fresh review excludes builder claims; a mismatched reviewed commit fails before QA', async (t) => {
  const s = await setup(t);
  s.script((r) => {
    const value = JSON.parse(buildFixtureAnswer(r.input)!);
    if (r.input[0]!.text.startsWith('builder/'))
      value.summary = 'SECRET_BUILDER_SUCCESS_CLAIM';
    else value.candidate = 'f'.repeat(40);
    return value;
  });
  const result = await s.run();
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /not bound/);
  assert.equal(s.requests.length, 2);
  assert.equal(s.requests[1]!.input.length, 2);
  assert.ok(!JSON.stringify(s.requests[1]).includes('SECRET_BUILDER'));
  assert.equal((await s.executor.executions(s.product.id)).length, 0);
  assert.equal(
    await readFile(
      join(s.products.worktree(s.product.id, s.task.id), 'src/main.py'),
      'utf8',
    ),
    BUILD_FIXTURE_SOURCE,
  );
});

const real = process.env.CREATOR_TEST_ISOLATION === 'wsl2';
test(
  'real bounded builder verifies normal and error flows; changed commits and frozen specs invalidate evidence',
  { skip: !real && 'Real WSL2 gate is opt-in' },
  async (t) => {
    const s = await setup(t);
    const result = await s.run();
    assert.equal(result.state, 'verified_candidate', JSON.stringify(result));
    assert.equal(result.calls, 2);
    assert.equal((await s.executor.executions(s.product.id)).length, 2);
    assert.equal(
      (await s.builds.status(s.product.id, result.id, s.ports)).state,
      'verified_candidate',
    );
    const restarted = new BuildSupervisor(
      s.products,
      new ExecutionSupervisor(s.products),
    );
    assert.equal(
      (await restarted.status(s.product.id, result.id, s.ports)).commit,
      result.commit,
    );
    await s.products.apply(
      s.product.id,
      s.task.id,
      {
        expected_commit: result.commit,
        changes: [
          {
            path: 'src/main.py',
            before_hash: digest(BUILD_FIXTURE_SOURCE),
            content: 'print("broken")\n',
          },
        ],
      },
      s.binding,
    );
    await assert.rejects(
      s.builds.status(s.product.id, result.id, s.ports),
      /Changed candidate/,
    );
    s.binding.spec_hash = digest('changed');
    await assert.rejects(
      s.builds.status(s.product.id, result.id, s.ports),
      /specification or task hashes changed/,
    );
  },
);

test(
  'real QA rejects broken behavior even when both roles claim success; bounded repairs preserve commits',
  { skip: !real && 'Real WSL2 gate is opt-in' },
  async (t) => {
    const s = await setup(t);
    s.plan.max_repairs = 2;
    s.plan.max_calls = 6;
    let cycle = 0;
    s.script((r) => {
      const packet = JSON.parse(r.input[1]!.text);
      const value = JSON.parse(buildFixtureAnswer(r.input)!);
      if (r.input[0]!.text.startsWith('builder/')) {
        cycle++;
        value.submission.changes[0].content = `print("broken ${cycle}")\n`;
      } else {
        value.verdict = 'approve';
        value.findings = [];
      }
      assert.equal(
        value.submission?.expected_commit ?? value.candidate,
        packet.candidate,
      );
      return value;
    });
    const result = await s.run();
    assert.equal(result.state, 'checkpoint');
    assert.match(result.reason, /Repair limit/);
    assert.equal(result.repairs, 2);
    assert.equal(result.calls, 6);
    assert.equal((await s.executor.executions(s.product.id)).length, 6);
    assert.match(
      await readFile(
        join(s.products.worktree(s.product.id, s.task.id), 'src/main.py'),
        'utf8',
      ),
      /broken 3/,
    );
  },
);

test('held-out QA cases never reach a role packet, and a task without one is refused', async (t) => {
  const s = await setup(t);
  await s.run();
  assert.ok(s.requests.length >= 1);
  const held = BUILD_FIXTURE_CASES[1]!;
  for (const r of s.requests) {
    const packet = r.input[1]!.text;
    assert.equal(packet.includes(JSON.stringify(held.stdout)), false);
    assert.equal(packet.includes(JSON.stringify(held.args)), false);
    const parsed = JSON.parse(packet) as {
      cases: { check_key: string }[];
      held_out_cases: number;
    };
    assert.deepEqual(
      parsed.cases.map((c) => c.check_key),
      ['A1'],
    );
    assert.equal(parsed.held_out_cases, 1);
  }
  assert.equal(held.check_key, 'A2');
  const before = s.requests.length;
  s.spec.acceptance_checks[1]!.cases![0]!.held_out = false;
  await assert.rejects(s.run(), /held-out case/);
  assert.equal(s.requests.length, before);
});

test('the ChatGPT-plan Codex builder still goes through scoped patches and an independent broker review', async (t) => {
  const s = await setup(t);
  const plan = {
    ...s.plan,
    codex_plan_builder: {
      connection_id: randomUUID(),
      model_id: 'fixture-plan-model',
    },
  };
  const missing = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    s.ports,
  );
  assert.equal(missing.state, 'checkpoint');
  assert.match(missing.reason, /Codex plan builder is not configured/);
  assert.equal(s.requests.length, 0);
  const packets: Record<string, unknown>[] = [];
  const ports: BuildPorts = {
    ...s.ports,
    codexBuilder: async (target, packet) => {
      assert.equal(target.model_id, 'fixture-plan-model');
      packets.push(packet);
      // The fixture's own builder answer stands in for a Codex workspace diff.
      const answer = JSON.parse(
        buildFixtureAnswer([
          { role: 'system', text: 'builder/1: fixture' },
          { role: 'user', text: JSON.stringify(packet) },
        ])!,
      ) as { submission: unknown };
      return {
        summary: 'CODEX_SUMMARY_CLAIM',
        submission: answer.submission,
        blocker: null,
      };
    },
  };
  const result = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    ports,
  );
  assert.equal(packets.length, 1);
  assert.equal(s.requests.length, 1, 'only the reviewer used the broker');
  assert.ok(s.requests[0]!.input[0]!.text.startsWith('independent-reviewer/'));
  assert.ok(!JSON.stringify(s.requests[0]).includes('CODEX_SUMMARY_CLAIM'));
  // Held-out expectations never reach the Codex packet either.
  const assigned = s.spec.tasks.find((x) => x.key === 'T1')!.acceptance;
  const heldOut = frozenCases(s.spec, assigned).filter((c) => c.held_out);
  assert.ok(heldOut.length > 0);
  for (const c of heldOut)
    assert.ok(!JSON.stringify(packets[0]).includes(JSON.stringify(c.stdout)));
  assert.notEqual(
    result.commit,
    s.product.initial_commit,
    'the patch was applied as a scoped change',
  );
  if (process.env.CREATOR_TEST_ISOLATION !== 'wsl2')
    assert.equal(result.state, 'checkpoint');
});

test('a Codex builder change outside the task scope is refused by the scoped patch tool', async (t) => {
  const s = await setup(t);
  const plan = {
    ...s.plan,
    codex_plan_builder: {
      connection_id: randomUUID(),
      model_id: 'fixture-plan-model',
    },
  };
  const result = await s.builds.run(
    s.product.id,
    s.task.id,
    s.product.initial_commit,
    plan,
    {
      ...s.ports,
      codexBuilder: async (_target, packet) => ({
        summary: 's',
        submission: {
          expected_commit: packet.candidate,
          changes: [{ path: 'policy.json', before_hash: null, content: '{}' }],
        },
        blocker: null,
      }),
    },
  );
  assert.equal(result.state, 'checkpoint');
  assert.match(result.reason, /scope/);
  assert.equal(result.commit, s.product.initial_commit);
  assert.equal(s.requests.length, 0);
});
